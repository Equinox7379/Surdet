import { decodeStageToken, Lexer, parseInlineInstructions } from '@surdet/core';
import { decodeInstructionArgument } from '@surdet/authoring';
import { parseScript, serializeScript, splitInstr, type LineModel } from '../model.js';
import { InstructionFieldSource } from '../instruction-field-source.js';
import { splitInlineDialogue } from './inline-markup.js';
import { instructionLabel } from '../script-presentation.js';

export type ScriptView = 'arrange' | 'manuscript' | 'source';
export type Position = 'left' | 'center' | 'right';
export interface StepRange { start: number; end: number }
export interface SourceEdit { text: string; selectedLine: number; /** Caret in the selected dialogue, when not its start. */ caret?: number }

/** UI grouping, not control-flow evaluation. Source rows and shared line kinds remain authoritative. */
export function stepAt(lines: readonly LineModel[], index: number): StepRange {
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) throw new Error('当前步骤已经不存在');
  const choiceRow = (line: LineModel | undefined): boolean => line?.kind === 'choice-option' || line?.kind === 'blank' || line?.kind === 'comment';
  let start = index;
  if (choiceRow(lines[start])) {
    while (start > 0 && choiceRow(lines[start - 1])) start--;
    const before = lines[start - 1];
    if (before?.kind === 'instr' && before.name === 'choice') start--;
    else start = index;
  }
  let end = start;
  const head = lines[start];
  if (head?.kind === 'instr' && head.name === 'choice') {
    for (let cursor = start + 1; cursor < lines.length && choiceRow(lines[cursor]); cursor++) {
      if (lines[cursor]?.kind === 'choice-option') end = cursor;
    }
    // Only separators within the actual options belong to this step. Trailing
    // comments and blank rows remain independently editable.
    if (index > end) return { start: index, end: index };
  }
  return { start, end };
}

export function scriptSteps(lines: readonly LineModel[]): StepRange[] {
  const result: StepRange[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const range = line?.kind === 'instr' && line.name === 'choice' ? stepAt(lines, index) : { start: index, end: index };
    result.push(range);
    index = range.end + 1;
  }
  return result;
}

export function sourceEol(text: string): '\r\n' | '\n' | '\r' {
  return (text.match(/\r\n|\n|\r/)?.[0] ?? '\n') as '\r\n' | '\n' | '\r';
}

function finishEdit(original: readonly LineModel[], next: LineModel[], selectedLine: number, eol: '\r\n' | '\n' | '\r'): SourceEdit {
  if (next.length === 0) return { text: '', selectedLine: 0 };
  // A last row moved into the document needs a separator. The document's terminal
  // newline belongs to the file, not to the step which happens to be last now.
  const terminal = original.at(-1)?.eol ?? '';
  const materialized = next.map((line, index) => ({
    ...line,
    eol: index === next.length - 1 ? terminal : line.eol || eol,
  }));
  return { text: serializeScript(materialized, eol), selectedLine: Math.max(0, Math.min(selectedLine, next.length - 1)) };
}

export function insertStep(text: string, index: number, inserted: readonly string[]): SourceEdit {
  if (inserted.length === 0) return { text, selectedLine: index };
  const lines = parseScript(text);
  const eol = sourceEol(text);
  const end = text.length === 0 ? -1 : stepAt(lines, index).end;
  const source = inserted.join(eol);
  const newLines = parseScript(source).map((line) => ({ ...line, eol }));
  const next = text.length === 0 ? [] : [...lines];
  next.splice(end + 1, 0, ...newLines);
  return finishEdit(lines, next, end + 1, eol);
}

/**
 * Enter replaces the selected dialogue range with a new row, retaining its speaker and local EOL.
 * Styling open at the split point is closed and reopened; a split inside a tag or ruby is refused.
 */
export function splitDialogue(text: string, index: number, start: number, end: number): SourceEdit {
  const lines = parseScript(text), line = lines[index];
  if (line?.kind !== 'text' || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end < start || end > line.value.length) throw new Error('台词或光标位置已变化，请重新选择');
  const parts = splitInlineDialogue(line.value, start, end);
  if (!parts.ok) throw new Error(parts.reason);
  const prefix = line.raw.slice(0, line.raw.length - line.value.length);
  const offset = lines.slice(0, index).reduce((size, row) => size + row.raw.length + row.eol.length, 0);
  const eol = line.eol || sourceEol(text);
  let replacement = prefix + parts.left + eol + prefix + parts.right;
  // The shared document represents a final blank row by its own EOL, not a phantom trailing token.
  if (prefix === '' && end === line.value.length && parts.reopened === 0 && index === lines.length - 1 && !line.eol) replacement += eol;
  return { text: text.slice(0, offset) + replacement + text.slice(offset + line.raw.length), selectedLine: index + 1, ...(parts.reopened ? { caret: parts.reopened } : {}) };
}

export function deleteStep(text: string, index: number): SourceEdit {
  const lines = parseScript(text), range = stepAt(lines, index);
  const next = [...lines];
  next.splice(range.start, range.end - range.start + 1);
  return finishEdit(lines, next, range.start, sourceEol(text));
}

export function duplicateStep(text: string, index: number): SourceEdit {
  const lines = parseScript(text), range = stepAt(lines, index);
  const next = [...lines];
  next.splice(range.end + 1, 0, ...lines.slice(range.start, range.end + 1).map((line) => ({ ...line })));
  return finishEdit(lines, next, range.end + 1, sourceEol(text));
}

export function moveStep(text: string, index: number, direction: -1 | 1): SourceEdit {
  const lines = parseScript(text), range = stepAt(lines, index), groups = scriptSteps(lines);
  const groupIndex = groups.findIndex((group) => group.start === range.start);
  const neighbour = groups[groupIndex + direction];
  if (!neighbour) return { text, selectedLine: index };
  const current = lines.slice(range.start, range.end + 1), next = [...lines];
  if (direction < 0) {
    const before = lines.slice(neighbour.start, neighbour.end + 1);
    next.splice(neighbour.start, before.length + current.length, ...current, ...before);
    return finishEdit(lines, next, neighbour.start, sourceEol(text));
  }
  const after = lines.slice(neighbour.start, neighbour.end + 1);
  next.splice(range.start, current.length + after.length, ...after, ...current);
  return finishEdit(lines, next, range.start + after.length, sourceEol(text));
}

export function moveStepBefore(text: string, index: number, beforeIndex: number): SourceEdit {
  const lines = parseScript(text), source = stepAt(lines, index), target = stepAt(lines, beforeIndex);
  if (source.start === target.start) return { text, selectedLine: index };
  const next = [...lines], moved = next.splice(source.start, source.end - source.start + 1);
  const at = target.start > source.end ? target.start - moved.length : target.start;
  next.splice(at, 0, ...moved);
  return finishEdit(lines, next, at, sourceEol(text));
}

/** The source textarea normalizes newlines. Map only its changed range back to the original bytes. */
export function applySourceTextareaEdit(source: string, textareaValue: string): string {
  const normalized = source.replace(/\r\n|\r/g, '\n');
  const next = textareaValue.replace(/\r\n|\r/g, '\n');
  if (normalized === next) return source;
  let first = 0;
  while (first < normalized.length && first < next.length && normalized[first] === next[first]) first++;
  let last = normalized.length, nextLast = next.length;
  while (last > first && nextLast > first && normalized[last - 1] === next[nextLast - 1]) { last--; nextLast--; }
  const offsets: number[] = [0];
  for (let index = 0; index < source.length;) {
    index += source[index] === '\r' && source[index + 1] === '\n' ? 2 : 1;
    offsets.push(index);
  }
  const from = offsets[first]!, to = offsets[last]!;
  const localEol = source.slice(from).match(/\r\n|\n|\r/)?.[0] ?? sourceEol(source);
  const inserted = next.slice(first, nextLast).replace(/\n/g, localEol);
  return source.slice(0, from) + inserted + source.slice(to);
}

export function quoteAssetArgument(value: string, previous = ''): string {
  if (/[\r\n\0]/.test(value)) throw new Error('素材名称不能包含换行或控制字符');
  const previousQuote = previous[0];
  const quote = previousQuote === '"' || previousQuote === "'" ? previousQuote : /[\s@"'\\]/.test(value) || value === '' ? '"' : '';
  return quote ? quote + value.replace(/\\/g, '\\\\').replaceAll(quote, '\\' + quote) + quote : value;
}

export function setInstructionArgument(raw: string, index: number, value: string): string {
  const { args } = splitInstr(raw);
  // A discrete picker writes a semantic value; raw/expression inputs still use B01 directly.
  const source = new InstructionFieldSource(raw, Math.max(index + 1, args.length, 1));
  return source.replace(raw, index, quoteAssetArgument(value, args[index] ?? ''));
}

interface ModifierRange { start: number; end: number; text: string }
function modifierRanges(raw: string): ModifierRange[] {
  // Accept only lexically complete instructions. This scans source delimiters for
  // a narrow position edit; it does not interpret or reserialize the DSL.
  const instruction = new Lexer().tokenize(raw, 'editor-field.gal').find((token) => token.type === 'instruction');
  if (!instruction) throw new Error('请先在原始行补全指令');
  const first = raw.search(/\S/), boundaries: number[] = [];
  let quote: string | null = null;
  for (let index = first + 1; index < raw.length; index++) {
    const c = raw[index];
    if (quote) { if (c === '\\') index++; else if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '@') boundaries.push(index);
  }
  return boundaries.map((start, index) => ({ start, end: boundaries[index + 1] ?? raw.length, text: raw.slice(start, boundaries[index + 1] ?? raw.length) }));
}

function positionModifier(text: string): Position | null {
  const bare = /^@\s*(left|center|right)\s*$/.exec(text);
  if (bare) return bare[1] as Position;
  const explicit = /^@\s*pos=(left|center|right)\s*$/.exec(text);
  return explicit ? explicit[1] as Position : null;
}

function malformedPositionModifier(text: string): boolean {
  return (/^@\s*(left|center|right)(?:\s|=)/.test(text) && positionModifier(text) === null)
    || (/^@\s*pos(?:=|\s)/.test(text) && positionModifier(text) === null);
}

export function instructionPosition(raw: string): Position | 'default' | 'ambiguous' {
  try {
    const modifiers = modifierRanges(raw);
    const matches = modifiers.filter((part) => positionModifier(part.text) !== null);
    if (matches.length > 1 || modifiers.some((part) => malformedPositionModifier(part.text))) return 'ambiguous';
    return matches.length === 1 ? positionModifier(matches[0]!.text)! : 'default';
  } catch { return 'ambiguous'; }
}

export function setInstructionPosition(raw: string, position: Position): string {
  if (!(['left', 'center', 'right'] as string[]).includes(position)) throw new Error('未知的位置');
  const positions = modifierRanges(raw).filter((part) => positionModifier(part.text) !== null);
  if (instructionPosition(raw) === 'ambiguous') throw new Error('当前行有多个位置设置，请先在原始行确认');
  const existing = positions[0];
  if (existing) {
    const next = /^@\s*pos=/.test(existing.text)
      ? existing.text.replace(/=(left|center|right)(?=\s*$)/, `=${position}`)
      : existing.text.replace(/left|center|right/, position);
    return raw.slice(0, existing.start) + next + raw.slice(existing.end);
  }
  const tail = raw.match(/[ \t]*$/)?.[0] ?? '';
  return raw.slice(0, raw.length - tail.length) + ' @ ' + position + tail;
}

/** The `@name` modifiers as Core decodes them; a bare switch reads as ''. */
export function instructionModifiers(raw: string): ReadonlyMap<string, string> {
  const instruction = new Lexer().tokenize(raw, 'editor-field.gal').find((token) => token.type === 'instruction');
  if (!instruction || instruction.type !== 'instruction') throw new Error('请先在原始行补全指令');
  return new Map([...instruction.modifiers].map(([key, value]) => [key, decodeStageToken(value)]));
}

/** Write one `@name=value` modifier (`true` writes a bare switch) or remove it with null; the rest of the line is kept as written. */
export function setInstructionModifier(raw: string, name: string, value: string | true | null): string {
  const matching = modifierRanges(raw).filter((part) => new RegExp(`^@\\s*${name}(?:\\s*=|\\s|$)`).test(part.text));
  if (matching.length > 1) throw new Error(`当前行有多个 @${name}，请先在原始行确认`);
  const written = value === null ? '' : value === true ? `@${name}` : `@${name}=${quoteAssetArgument(value)}`;
  const existing = matching[0];
  if (existing) {
    const trailing = existing.text.match(/\s*$/)![0];
    if (written) return raw.slice(0, existing.start) + written + trailing + raw.slice(existing.end);
    // The last modifier also takes the space before it.
    return existing.end === raw.length ? raw.slice(0, existing.start).replace(/[ \t]+$/, '') + trailing : raw.slice(0, existing.start) + raw.slice(existing.end);
  }
  if (!written) return raw;
  const tail = raw.match(/[ \t]*$/)?.[0] ?? '';
  return raw.slice(0, raw.length - tail.length) + ' ' + written + tail;
}

export interface SimpleChoice { text: string; condition: string; target: string; indent: string; trailing: string }
/** Only the explicitly supported single-goto form gets compact controls. All other source stays editable as source. */
export function simpleChoice(raw: string): SimpleChoice | null {
  const match = /^(\s+)(.*?)\s+->\s+(@goto\s+\S+)([ \t]*)$/.exec(raw);
  if (!match || /[\r\n]/.test(raw)) return null;
  let instructions: ReturnType<typeof parseInlineInstructions>;
  try { instructions = parseInlineInstructions(match[3]!, 'editor-choice.gal', 1, 1); }
  catch { return null; }
  if (instructions.length !== 1 || instructions[0]?.name !== 'goto' || instructions[0]?.args.length !== 1) return null;
  let label = match[2]!, condition = '';
  const when = /\s*\[if:(.*?)\]\s*$/.exec(label);
  if (when) {
    condition = when[1]!;
    if (!condition.trim()) return null;
    label = label.slice(0, when.index);
  }
  if (label.includes('[if:') || condition.includes(']')) return null;
  return { text: label, condition, target: instructions[0]!.args[0]!, indent: match[1]!, trailing: match[4]! };
}

export function writeSimpleChoice(value: SimpleChoice): string {
  if (/[\r\n]/.test(value.text + value.condition + value.target) || value.text.includes(' ->') || value.text.includes('[if:') || value.condition.includes(']') || /\s|@/.test(value.target)) {
    throw new Error('这段内容需要在完整原始行中编辑');
  }
  return `${value.indent}${value.text}${value.condition.trim() ? ` [if:${value.condition}]` : ''} -> @goto ${value.target}${value.trailing}`;
}

export interface LayoutActor { target: string; expression: string; position: Position | 'default'; line: number }
export interface EditLayout { background: { key: string; line: number } | null; actors: LayoutActor[]; dialogue: { speaker: string; value: string } | null; reason: string | null }

/** A bounded edit layout, NEVER a runtime snapshot or a validation result. No conditions, variables, time or audio are executed. */
export function projectEditLayout(lines: readonly LineModel[], selected: number): EditLayout {
  const result: EditLayout = { background: null, actors: [], dialogue: null, reason: null };
  if (!lines[selected]) return result;
  let start = 0;
  for (let index = selected; index >= 0; index--) {
    const line = lines[index];
    if (line?.kind === 'label' || line?.kind === 'instr' && line.name === 'scene') { start = index; break; }
  }
  const actors = new Map<string, LayoutActor>();
  const nonVisual = new Set(['scene', 'wait', 'voice', 'bgm', 'ambience', 'se', 'set', 'mod', 'inc', 'dec', 'toggle', 'flag', 'unflag', 'autosave', 'savepoint', 'unlock_cg', 'unlock_music', 'unlock_text', 'unlock_profile', 'unlock_term']);
  for (let index = start; index <= selected; index++) {
    const line = lines[index]!;
    if (line.kind === 'text') { if (index === selected) result.dialogue = { speaker: line.speaker, value: line.value }; continue; }
    if (line.kind === 'blank' || line.kind === 'comment' || line.kind === 'label') continue;
    if (line.kind !== 'instr') { result.reason = '分支的实际画面需要运行确认'; break; }
    const { name, args } = splitInstr(line.raw), values = args.map(decodeInstructionArgument);
    let modifiers: ModifierRange[] = [];
    try { if (name === 'bg' || name === 'show') modifiers = modifierRanges(line.raw); }
    catch { result.reason = '指令尚未输入完整，保留原文等待继续编辑'; break; }
    if ((name === 'bg' || name === 'show') && modifiers.some((part) => positionModifier(part.text) === null)) { result.reason = '包含其他演出修饰；请运行以确认画面'; break; }
    if (name === 'bg') { result.background = values[0] ? { key: values[0], line: index } : null; }
    else if (name === 'show') {
      const position = instructionPosition(line.raw);
      if (!values[0] || position === 'ambiguous') { result.reason = '人物设置需要在原始行确认'; break; }
      for (const key of actors.keys()) if (key.split(':')[0] === values[0].split(':')[0]) actors.delete(key);
      actors.set(values[0], { target: values[0], expression: values[1] || 'normal', position, line: index });
    } else if (name === 'hide') {
      for (const key of actors.keys()) if (key === values[0] || key.split(':')[0] === values[0]) actors.delete(key);
    } else if (!nonVisual.has(name)) { result.reason = `包含${instructionLabel(name)}；请运行预览查看实际画面`; break; }
  }
  if (result.reason) { result.background = null; result.actors = []; result.dialogue = null; }
  else result.actors = [...actors.values()];
  return result;
}
