import { insertLinesAfter, parseSceneDocument, parseSceneLine, rebuildTextRaw, serializeSceneDocument, splitInstruction } from './scene-document.js';
import type {
  SceneBlockInput,
  SceneCreateInput,
  SceneDocumentLineInput,
  SceneDocumentLine,
  ScenePatchInput,
  ScenePatchOperation,
  VariableEnsureInput,
} from './contracts.js';
import { AuthoringOperationError, runOperation, stableStringify, type ChangeSession } from './change-session.js';
import { normalizeProjectPath } from './project-storage.js';

function validSceneId(sceneId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(sceneId);
}

function scenePath(sceneId: string): string {
  if (!validSceneId(sceneId)) throw new AuthoringOperationError('PATH_OUTSIDE_PROJECT', `场景 ID 非法：${sceneId}`);
  return normalizeProjectPath(`content/scenario/${sceneId}.gal`);
}

function renderChoiceOption(option: Extract<SceneBlockInput, { kind: 'choice' }>['options'][number]): string {
  let raw = `  ${option.label}`;
  if (option.when !== undefined) raw += ` [if:${option.when}]`;
  raw += ' ->';
  for (const effect of option.effects ?? []) {
    raw += ` @${effect.name}${effect.args.length > 0 ? ` ${effect.args.join(' ')}` : ''}`;
  }
  raw += ` @${option.target.kind} ${option.target.value}`;
  return raw;
}

function renderBlocks(blocks: readonly SceneBlockInput[]): SceneDocumentLineInput[] {
  const lines: SceneDocumentLineInput[] = [];
  for (const block of blocks) {
    if (block.kind === 'text') {
      const speaker = block.speaker ?? '';
      lines.push({
        kind: 'text',
        speaker,
        value: block.value,
        sep: '：',
        raw: rebuildTextRaw(speaker, block.value),
      });
    } else if (block.kind === 'label') {
      lines.push({ kind: 'label', name: block.name, raw: `@label ${block.name}` });
    } else if (block.kind === 'instruction') {
      const args = block.args ?? [];
      const modifiers = Object.entries(block.modifiers ?? {}).map(([name, value]) => `@${name}${value.length > 0 ? `=${value}` : ''}`);
      const suffix = [...args, ...modifiers].join(' ');
      lines.push({ kind: 'instr', name: block.name, raw: suffix.length > 0 ? `@${block.name} ${suffix}` : `@${block.name}` });
    } else {
      lines.push({ kind: 'instr', name: 'choice', raw: '@choice' });
      for (const option of block.options) lines.push({ kind: 'choice-option', raw: renderChoiceOption(option) });
    }
  }
  return lines;
}

function sceneIdFromTarget(target: string): string | undefined {
  const match = /^scene:([^/]+)\//.exec(target);
  return match?.[1];
}

function lineNumberFromTarget(target: string): number | undefined {
  const match = /\/[^:]+:(\d+)@/.exec(target);
  const line = match?.[1];
  return line === undefined ? undefined : Number(line);
}

function fingerprint(raw: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index++) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function previousKind(lines: readonly SceneDocumentLine[], index: number): string {
  const previous = lines[index - 1];
  if (previous === undefined) return '';
  if (previous.kind === 'instr') return previous.name === 'choice' ? 'choice' : 'instr';
  if (previous.kind === 'choice-option') return 'choice-option';
  return previous.kind;
}

function defaultEol(lines: readonly SceneDocumentLine[]): '\r\n' | '\n' {
  const found = lines.find((line) => line.eol.length > 0)?.eol;
  return found === '\r\n' ? '\r\n' : '\n';
}

function operationTarget(patch: ScenePatchOperation): string {
  return patch.kind === 'insertAfter' ? patch.anchor : patch.target;
}

function patchLineIndex(lines: readonly SceneDocumentLine[], patch: ScenePatchOperation): number {
  const lineNumber = lineNumberFromTarget(operationTarget(patch));
  if (lineNumber === undefined || lineNumber < 1 || lineNumber > lines.length) {
    throw new AuthoringOperationError('OBJECT_NOT_FOUND', `无法从 objectRef 定位行：${operationTarget(patch)}`);
  }
  return lineNumber - 1;
}

function checkPatchPrecondition(lines: readonly SceneDocumentLine[], patch: ScenePatchOperation, index: number): void {
  const actual = lines[index];
  if (actual === undefined || fingerprint(actual.raw) !== patch.expectedFingerprint) {
    throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `对象原内容指纹不匹配：${operationTarget(patch)}`);
  }
}

export async function applySceneCreate(change: ChangeSession, input: SceneCreateInput): Promise<{ sceneId: string; path: string }> {
  const path = scenePath(input.sceneId);
  return runOperation(change, input, (record) => {
    if (record.workingFiles[path] !== undefined) {
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `场景已存在：${input.sceneId}`);
    }
    const body = renderBlocks(input.blocks ?? []);
    const bodyLines: SceneDocumentLine[] = body.map((line) => line.kind === 'text'
      ? { ...line, sep: line.sep ?? '：', eol: '\n' as const }
      : { ...line, eol: '\n' as const });
    const lines: SceneDocumentLine[] = [
      { kind: 'instr', name: 'scene', raw: `@scene ${input.sceneId}`, eol: '\n' as const },
      ...bodyLines,
      { kind: 'instr', name: 'end', raw: '@end', eol: '\n' as const },
    ];
    const text = serializeSceneDocument(lines);
    return {
      result: { sceneId: input.sceneId, path },
      workingFiles: { ...record.workingFiles, [path]: text },
    };
  });
}

export async function applyScenePatch(change: ChangeSession, input: ScenePatchInput): Promise<{ path: string; line: number; kind: string }> {
  const patch = input.patch;
  const sceneId = input.sceneId ?? sceneIdFromTarget(operationTarget(patch));
  if (sceneId === undefined) throw new AuthoringOperationError('INVALID_REQUEST', 'scene.patch 缺少 sceneId');
  const path = scenePath(sceneId);
  return runOperation(change, input, (record) => {
    const source = record.workingFiles[path];
    if (source === undefined) throw new AuthoringOperationError('PROJECT_NOT_FOUND', `场景不存在：${sceneId}`);
    const lines = parseSceneDocument(source);
    const index = patchLineIndex(lines, patch);
    checkPatchPrecondition(lines, patch, index);
    const current = lines[index]!;
    let nextLines: SceneDocumentLine[];
    if (patch.kind === 'replaceText') {
      if (current.kind !== 'text') throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'replaceText 目标不是台词对象');
      const raw = rebuildTextRaw(patch.speaker ?? current.speaker, patch.value, current.sep);
      nextLines = [...lines];
      nextLines[index] = parseSceneLine(raw, previousKind(lines, index), current.eol);
    } else if (patch.kind === 'insertAfter') {
      nextLines = insertLinesAfter(lines, index, renderBlocks(patch.blocks), defaultEol(lines));
    } else if (patch.kind === 'replaceChoiceOption') {
      if (current.kind !== 'choice-option') throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'replaceChoiceOption 目标不是选择项');
      nextLines = [...lines];
      nextLines[index] = parseSceneLine(renderChoiceOption(patch.option), previousKind(lines, index), current.eol);
    } else {
      if (current.kind === 'instr' && current.name === 'scene') {
        throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '不能移除场景声明');
      }
      nextLines = lines.filter((_, lineIndex) => lineIndex !== index);
    }
    return {
      result: { path, line: index + 1, kind: patch.kind },
      workingFiles: { ...record.workingFiles, [path]: serializeSceneDocument(nextLines, defaultEol(nextLines)) },
    };
  });
}

export async function ensureVariable(change: ChangeSession, input: VariableEnsureInput): Promise<{ name: string; created: boolean }> {
  return runOperation<{ name: string; created: boolean }>(change, input, (record) => {
    const path = 'game.config.json';
    const currentText = record.workingFiles[path] ?? '{}';
    let config: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(currentText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('config must be object');
      config = { ...(parsed as Record<string, unknown>) };
    } catch (error) {
      throw new AuthoringOperationError('PROJECT_INVALID', `game.config.json 不是对象：${String(error)}`);
    }
    const variablesValue = config['variables'];
    if (variablesValue !== undefined && (typeof variablesValue !== 'object' || variablesValue === null || Array.isArray(variablesValue))) {
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'game.config.json.variables 必须是对象');
    }
    const variables = { ...(variablesValue as Record<string, unknown> | undefined) };
    const declaration: Record<string, unknown> = { type: input.type, initial: input.initial };
    if (input.readonly !== undefined) declaration['readonly'] = input.readonly;
    if (input.min !== undefined) declaration['min'] = input.min;
    if (input.max !== undefined) declaration['max'] = input.max;
    const existing = variables[input.name];
    if (existing !== undefined) {
      if (stableStringify(existing) !== stableStringify(declaration)) {
        throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `变量合同冲突：${input.name}`);
      }
      return { result: { name: input.name, created: false }, changed: false };
    }
    variables[input.name] = declaration;
    config['variables'] = variables;
    return {
      result: { name: input.name, created: true },
      workingFiles: { ...record.workingFiles, [path]: `${JSON.stringify(config, null, 2)}\n` },
    };
  });
}
