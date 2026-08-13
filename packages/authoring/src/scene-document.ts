import type { SceneDocumentLine, SceneDocumentLineInput, SceneEol } from './contracts.js';

const SPEAKER_RE = /^([^\s：:]{1,24})([：:])(.*)$/;
const INSTR_NAME_RE = /^@([^\s]+)/;

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
  const match = SPEAKER_RE.exec(trimmed);
  if (match && !/^\d+$/.test(match[1]!)) {
    return {
      kind: 'text',
      speaker: match[1]!,
      value: match[3]!.trimStart(),
      sep: match[2]!,
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
    previousKind = line.kind === 'instr' && line.name === 'choice' ? 'choice' : line.kind;
  }
  return out;
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
  const rest = trimmed.slice(1 + name.length).trim();
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
