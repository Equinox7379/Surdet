import { extractSpeaker, Lexer, Parser, type AstBlock, type AstIfBlock } from '@surdet/core';
import type { SceneDocumentLine, SceneDocumentLineInput, SceneEol } from './contracts.js';

/**
 * speaker token validity 语法（用于 authoring mutation，如角色改名时校验新显示名能否作为
 * speaker token 表达）。注意：这不是行级 speaker 提取语义——“一行文本是否含 speaker、
 * speaker token 是什么”由 @surdet/core extractSpeaker 作为唯一语义事实源决定（N2）。
 */
const SPEAKER_TOKEN_SOURCE = '[^\\s：:]{1,24}';
const SPEAKER_TOKEN_RE = new RegExp(`^${SPEAKER_TOKEN_SOURCE}$`);
const INSTR_NAME_RE = /^@([^\s]+)/;

/** 字符串能否作为合法 speaker token 出现在台词行（非纯数字；parser 与角色改名迁移共享同一语法源）。 */
export function isValidSpeakerToken(token: string): boolean {
  return SPEAKER_TOKEN_RE.test(token) && !/^\d+$/.test(token)
    && !token.startsWith('@') && !token.startsWith('//');
}

export function parseSceneLine(raw: string, previousKind: string, eol: SceneEol = ''): SceneDocumentLine {
  const trimmed = raw.trimStart();
  if (trimmed.length === 0) return { kind: 'blank', raw, eol };
  if (trimmed.startsWith('//')) return { kind: 'comment', raw, eol };
  if (/^@label($|\s)/.test(trimmed)) {
    return { kind: 'label', name: trimmed.replace(/^@label\s+/, '').trim(), raw, eol };
  }
  if (trimmed.startsWith('@')) {
    const name = INSTR_NAME_RE.exec(trimmed)?.[1] ?? '';
    return { kind: 'instr', name, raw, eol };
  }
  if (/^\s/.test(raw) && (previousKind === 'choice' || previousKind === 'choice-option')) {
    return { kind: 'choice-option', raw, eol };
  }
  // N2：speaker existence 由 @surdet/core extractSpeaker 唯一决定（含 URL scheme guard、
  // 纯数字/空白/长度规则）；本函数只把已确认存在的 speaker 映射到 document model。
  const speaker = extractSpeaker(trimmed);
  if (speaker !== null) {
    const sep = trimmed[speaker.length]!;
    return {
      kind: 'text',
      speaker,
      value: trimmed.slice(speaker.length + 1).trimStart(),
      sep,
      raw,
      eol,
    };
  }
  return { kind: 'text', speaker: '', value: trimmed, sep: '：', raw, eol };
}

export function parseSceneDocument(text: string): SceneDocumentLine[] {
  if (text === '') return [parseSceneLine('', '', '')];
  const chunks = text.match(/.*?(?:\r\n|\n|\r|$)/g)?.filter((chunk) => chunk.length > 0) ?? [];
  const out: SceneDocumentLine[] = [];
  let previousKind = '';
  for (const chunk of chunks) {
    const match = /(\r\n|\n|\r)$/.exec(chunk);
    const eol = (match?.[1] ?? '') as SceneEol;
    const raw = eol.length > 0 ? chunk.slice(0, -eol.length) : chunk;
    const line = parseSceneLine(raw, previousKind, eol);
    out.push(line);
    // Blank/comment rows are transparent to the Core parser. Keep the choice
    // context across them so an indented option can still be indexed and
    // rewritten without dropping the intervening source rows.
    if ((line.kind === 'blank' || line.kind === 'comment')
      && (previousKind === 'choice' || previousKind === 'choice-option')) continue;
    previousKind = line.kind === 'instr' && line.name === 'choice' ? 'choice' : line.kind;
  }
  return out;
}

export interface SceneStructureSpan {
  /** 1-based, inclusive physical line range. */
  startLine: number;
  endLine: number;
}

export interface SceneChoiceStructureOption {
  index: number;
  label: string;
  when: string | null;
  span: SceneStructureSpan;
}

export interface SceneChoiceStructure {
  kind: 'choice';
  span: SceneStructureSpan;
  options: SceneChoiceStructureOption[];
}

export interface SceneConditionBranchStructure {
  kind: 'if' | 'elif' | 'else';
  expr: string | null;
  /** Includes the branch marker and body, excludes the next marker/@endif. */
  span: SceneStructureSpan;
  /** Excludes both the branch marker and the next marker/@endif. */
  bodySpan: SceneStructureSpan;
}

export interface SceneConditionStructure {
  kind: 'condition';
  /** Includes @if through @endif. */
  span: SceneStructureSpan;
  branches: SceneConditionBranchStructure[];
}

export interface SceneStructureDocument {
  choices: SceneChoiceStructure[];
  conditions: SceneConditionStructure[];
}

function inclusiveSpan(startLine: number, endLine: number): SceneStructureSpan {
  return { startLine, endLine };
}

/**
 * Parse the same Core AST used by compilation and expose only physical line
 * ranges needed by authoring. Comments and blank lines stay in the document;
 * their line numbers are deliberately never inferred by searching for a
 * later @endif.
 */
export function parseSceneStructure(source: string, file: string, sceneId: string): SceneStructureDocument {
  const ast = new Parser().parse(new Lexer().tokenize(source, file), sceneId);
  const choices: SceneChoiceStructure[] = [];
  const conditions: SceneConditionStructure[] = [];

  const visit = (blocks: readonly AstBlock[]): void => {
    for (const block of blocks) {
      if (block.kind === 'choice') {
        const lastOptionLine = block.options.at(-1)?.pos.line ?? block.pos.line;
        choices.push({
          kind: 'choice',
          span: inclusiveSpan(block.pos.line, lastOptionLine),
          options: block.options.map((option, index) => ({
            index,
            label: option.label,
            when: option.when,
            span: inclusiveSpan(option.pos.line, option.pos.line),
          })),
        });
        continue;
      }
      if (block.kind !== 'if') continue;
      const ifBlock = block as AstIfBlock;
      const branches = ifBlock.branches.map((branch) => {
        const boundaryLine = branch.span.end.line;
        return {
          kind: branch.kind,
          expr: branch.expr,
          span: inclusiveSpan(branch.span.start.line, boundaryLine - 1),
          bodySpan: inclusiveSpan(branch.bodySpan.start.line, boundaryLine - 1),
        } satisfies SceneConditionBranchStructure;
      });
      conditions.push({
        kind: 'condition',
        span: inclusiveSpan(ifBlock.span.start.line, ifBlock.span.end.line),
        branches,
      });
      for (const branch of ifBlock.branches) visit(branch.blocks);
    }
  };

  visit(ast.blocks);
  return { choices, conditions };
}

export function serializeSceneDocument(
  lines: readonly SceneDocumentLine[],
  defaultEol: Exclude<SceneEol, ''> = '\n',
): string {
  return lines.map((line, index) => line.raw + (line.eol || (index < lines.length - 1 ? defaultEol : ''))).join('');
}

function nearestEol(lines: readonly SceneDocumentLine[], index: number, fallback: Exclude<SceneEol, ''>): Exclude<SceneEol, ''> {
  for (let cursor = Math.min(index, lines.length - 1); cursor >= 0; cursor--) {
    const eol = lines[cursor]?.eol;
    if (eol) return eol;
  }
  for (let cursor = Math.max(index + 1, 0); cursor < lines.length; cursor++) {
    const eol = lines[cursor]?.eol;
    if (eol) return eol;
  }
  return fallback;
}

function materializeLine(input: SceneDocumentLineInput, eol: SceneEol): SceneDocumentLine {
  if (input.kind === 'text') return { ...input, sep: input.sep ?? '：', eol };
  return { ...input, eol };
}

export function insertLinesAfter(
  lines: readonly SceneDocumentLine[],
  index: number,
  inserted: readonly SceneDocumentLineInput[],
  defaultEol: Exclude<SceneEol, ''> = '\n',
): SceneDocumentLine[] {
  if (inserted.length === 0) return [...lines];
  const insertionIndex = Math.min(Math.max(index + 1, 0), lines.length);
  const lineEol = nearestEol(lines, index, defaultEol);
  const existing = [...lines];
  if (insertionIndex === existing.length && existing.length > 0) {
    const last = existing[existing.length - 1]!;
    if (!last.eol) existing[existing.length - 1] = { ...last, eol: lineEol };
  }
  const newLines = inserted.map((line, insertedIndex) => {
    const isNewFinalLine = insertionIndex === lines.length && insertedIndex === inserted.length - 1;
    return materializeLine(line, isNewFinalLine ? '' : (line.eol || lineEol));
  });
  return [...existing.slice(0, insertionIndex), ...newLines, ...existing.slice(insertionIndex)];
}

export function rebuildTextRaw(speaker: string, value: string, sep = '：'): string {
  return speaker.length > 0 ? `${speaker}${sep}${value}` : value;
}

export function rebuildLabelRaw(name: string): string {
  return `@label ${name}`;
}

export function splitInstruction(raw: string): { name: string; args: string[] } {
  const trimmed = raw.trimStart();
  const name = INSTR_NAME_RE.exec(trimmed)?.[1] ?? '';
  const coreEnd = instructionModifierStart(trimmed);
  const rest = trimmed.slice(1 + name.length, coreEnd).trim();
  if (rest.length === 0) return { name, args: [] };
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < rest.length; index++) {
    const character = rest[index]!;
    if (quote !== null) {
      current += character;
      if (character === '\\' && index + 1 < rest.length) {
        current += rest[++index]!;
        continue;
      }
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      current += character;
      quote = character;
    } else if (/\s/.test(character)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (current.length > 0) args.push(current);
  return { name, args };
}

export function rebuildInstructionRaw(name: string, args: string[]): string {
  const clean = args.filter((arg) => arg.length > 0);
  return clean.length > 0 ? `@${name} ${clean.join(' ')}` : `@${name}`;
}

interface InstructionArgumentSpan {
  start: number;
  end: number;
  raw: string;
}

function instructionModifierStart(raw: string): number {
  const first = raw.search(/\S/);
  if (first < 0 || raw[first] !== '@') return raw.length;
  let quote: '"' | "'" | null = null;
  for (let cursor = first + 1; cursor < raw.length; cursor++) {
    const character = raw[cursor]!;
    if (quote !== null) {
      if (character === '\\') {
        cursor += 1;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '@') return cursor;
  }
  return raw.length;
}

export function instructionModifierTokens(raw: string): string[] {
  const start = instructionModifierStart(raw);
  if (start >= raw.length) return [];
  const segments: string[] = [];
  let segmentStart = start + 1;
  let quote: '"' | "'" | null = null;
  for (let cursor = segmentStart; cursor <= raw.length; cursor++) {
    const character = raw[cursor];
    if (cursor === raw.length || (character === '@' && quote === null)) {
      const segment = raw.slice(segmentStart, cursor).trim();
      if (segment) segments.push(segment);
      segmentStart = cursor + 1;
      continue;
    }
    if (quote !== null) {
      if (character === '\\') {
        cursor += 1;
        continue;
      }
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    }
  }
  const tokens: string[] = [];
  for (const segment of segments) {
    const parts = splitInstruction(`@modifier ${segment}`).args.map(decodeInstructionArgument);
    const first = parts.shift();
    if (first === undefined) continue;
    const equals = first.indexOf('=');
    if (equals >= 0) {
      tokens.push(
        decodeInstructionArgument(first.slice(0, equals)),
        decodeInstructionArgument(first.slice(equals + 1)),
        ...parts,
      );
    } else {
      tokens.push(first, ...parts);
    }
  }
  return tokens.filter((token) => token.length > 0);
}

function instructionArgumentSpans(raw: string): InstructionArgumentSpan[] {
  const first = raw.search(/\S/);
  if (first < 0 || raw[first] !== '@') return [];
  let cursor = first + 1;
  while (cursor < raw.length && !/\s/.test(raw[cursor]!)) cursor += 1;
  const limit = instructionModifierStart(raw);
  const spans: InstructionArgumentSpan[] = [];
  while (cursor < limit) {
    while (cursor < limit && /\s/.test(raw[cursor]!)) cursor += 1;
    if (cursor >= limit) break;
    const start = cursor;
    const quote = raw[cursor] === '"' || raw[cursor] === "'" ? raw[cursor]! : null;
    if (quote !== null) {
      cursor += 1;
      while (cursor < limit) {
        if (raw[cursor] === '\\' && cursor + 1 < limit) {
          cursor += 2;
          continue;
        }
        if (raw[cursor] === quote) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
    } else {
      while (cursor < limit && !/\s/.test(raw[cursor]!)) cursor += 1;
    }
    spans.push({ start, end: cursor, raw: raw.slice(start, cursor) });
  }
  return spans;
}

export function decodeInstructionArgument(raw: string): string {
  if (raw.length < 2) return raw;
  const quote = raw[0];
  if ((quote !== '"' && quote !== "'") || raw.at(-1) !== quote) return raw;
  return raw.slice(1, -1).replace(/\\(.)/g, '$1');
}

function encodeInstructionArgument(value: string, previous?: string): string {
  const previousQuote = previous?.[0];
  const quote = previousQuote === '"' || previousQuote === "'"
    ? previousQuote
    : /\s|["'\\]/.test(value) ? '"' : null;
  if (quote === null) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(new RegExp(`\\${quote}`, 'g'), `\\${quote}`);
  return `${quote}${escaped}${quote}`;
}

/**
 * 只替换指定指令参数，保留既有缩进、参数间空白、引号风格与行尾。
 * 缺省参数可在尾部补齐；不会重排无关 modifier。
 */
export function rewriteInstructionArgumentsRaw(
  raw: string,
  replacements: ReadonlyMap<number, string>,
): string {
  if (replacements.size === 0) return raw;
  const spans = instructionArgumentSpans(raw);
  let result = raw;
  const existing = [...replacements.entries()]
    .filter(([index]) => spans[index] !== undefined)
    .sort(([left], [right]) => right - left);
  for (const [index, value] of existing) {
    const span = spans[index]!;
    result = result.slice(0, span.start) + encodeInstructionArgument(value, span.raw) + result.slice(span.end);
  }
  const missing = [...replacements.entries()]
    .filter(([index]) => spans[index] === undefined)
    .sort(([left], [right]) => left - right);
  const appended: string[] = [];
  for (const [index, value] of missing) {
    if (index > spans.length + missing.findIndex(([candidate]) => candidate === index)) {
      throw new Error(`INSTRUCTION_ARGUMENT_GAP: ${index}`);
    }
    appended.push(encodeInstructionArgument(value));
  }
  if (appended.length > 0) {
    const modifierStart = instructionModifierStart(result);
    const before = result.slice(0, modifierStart);
    const after = result.slice(modifierStart);
    const leading = /\s$/.test(before) ? '' : ' ';
    const trailing = after.length === 0 || /^\s/.test(after) ? '' : ' ';
    result = `${before}${leading}${appended.join(' ')}${trailing}${after}`;
  }
  return result;
}
