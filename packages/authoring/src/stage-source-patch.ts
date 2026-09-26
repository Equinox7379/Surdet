import { compileScene, findChoiceArrow, splitOutsideQuotes, parseProjectStage, stagePoseFromModifiers } from '@surdet/core';
import { AuthoringOperationError } from './change-session.js';
import { instructionArgumentSpans, splitInstruction } from './scene-document.js';

export type StageEditableValues = Partial<Record<'x' | 'y' | 'scale' | 'opacity' | 'z' | 'baseHeight' | 'anchorX' | 'anchorY', number>> & { facing?: 'left' | 'right' };
const fields = ['x', 'y', 'scale', 'opacity', 'z', 'baseHeight', 'anchorX', 'anchorY', 'facing'];
const error = (message: string): never => { throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', message); };

/** Exact shared source edit for the stage workspace; it neither executes code
 * nor rewrites a neighbouring instruction after a stale object selection. */
export function patchStageSourceLine(source: string, path: string, sceneId: string, line: number, raw: string,
  instructionIndex: number, values: StageEditableValues): string {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length === 0
    || Object.keys(values).some(key => !fields.includes(key))) error('舞台修改只接受明确的变换属性');
  for (const [key, value] of Object.entries(values)) {
    if (key === 'facing' ? value !== 'left' && value !== 'right' : typeof value !== 'number' || !Number.isFinite(value)) error('舞台属性值无效');
  }
  stagePoseFromModifiers(parseProjectStage({ version: 1 }), '', new Map(Object.entries(values).map(([key, value]) => [key, String(value)])));
  const compiled = compileScene(source, path, sceneId);
  const instruction = compiled.instructions.find(value => value.index === instructionIndex);
  if (!instruction || instruction.op !== 'instr' || instruction.line !== line || !['show', 'pose', 'layer'].includes(instruction.name)) error('舞台来源已变化，请重新预览并选择准确指令');
  const write = (segment: string, inline: boolean): string => {
    const old = '@' + segment;
    const name = splitInstruction(old).name;
    if (!['show', 'pose', 'layer'].includes(name)) return error('当前来源不是可编辑的舞台指令');
    if (name === 'layer' && ('facing' in values || 'baseHeight' in values || 'anchorX' in values || 'anchorY' in values)) error('图层不支持角色校准属性');
    const remaining = { ...values } as Record<string, string | number>;
    const edits: { start: number; end: number; text: string }[] = [];
    const spans = instructionArgumentSpans(old);
    const argumentStart = name === 'show' || name === 'layer' ? 2 : 1;
    spans.forEach((span, index) => {
      if (index < argumentStart) return;
      const match = /^([A-Za-z][A-Za-z0-9]*)=/.exec(span.raw);
      if (!match) return;
      const key = match[1] === 'alpha' && values.opacity !== undefined ? 'opacity' : match[1]!;
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        edits.push({ start: span.start - 1, end: span.end - 1, text: `${key}=${String(values[key as keyof StageEditableValues])}` });
        delete remaining[key];
      }
    });
    let result = segment;
    for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    if (!inline) {
      const parts = splitOutsideQuotes(result, '@');
      for (let index = 1; index < parts.length; index++) {
        const part = parts[index]!;
        const match = /^(\s*)([A-Za-z][A-Za-z0-9]*)(?:\s*=|\s|$)/.exec(part);
        if (!match) continue;
        const key = match[2] === 'alpha' && values.opacity !== undefined ? 'opacity' : match[2]!;
        if (Object.prototype.hasOwnProperty.call(values, key)) {
          parts[index] = `${match[1]}${key}=${String(values[key as keyof StageEditableValues])}${/\s*$/.exec(part)![0]}`;
          delete remaining[key];
        }
      }
      result = parts.join('@');
    }
    const trailing = /\s*$/.exec(result)![0];
    result = result.slice(0, result.length - trailing.length);
    for (const [key, value] of Object.entries(remaining)) result += inline ? ` ${key}=${value}` : ` @${key}=${value}`;
    return result + trailing;
  };
  if (raw.trimStart().startsWith('@')) {
    const at = raw.indexOf('@'); return raw.slice(0, at + 1) + write(raw.slice(at + 1), false);
  }
  const arrow = findChoiceArrow(raw);
  if (!arrow) return error('选择项来源缺少可定位的箭头');
  const parts = splitOutsideQuotes(raw.slice(arrow.end), '@');
  const candidates = parts.flatMap((part, index) => index > 0 && ['show', 'pose', 'layer'].includes(splitInstruction('@' + part).name) ? [index] : []);
  const instructions = compiled.instructions.filter(value => value.op === 'instr' && value.line === line && ['show', 'pose', 'layer'].includes(value.name));
  const ordinal = instructions.findIndex(value => value.index === instructionIndex);
  if (candidates.length !== instructions.length || ordinal < 0) return error('内联指令无法唯一对应，未改动任何来源');
  const chosen = candidates[ordinal]!;
  parts[chosen] = write(parts[chosen]!, true);
  return raw.slice(0, arrow.end) + parts.join('@');
}
