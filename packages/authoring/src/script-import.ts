import { extractSpeaker, escapeInlineText } from '@surdet/core';
import { parseSceneLine } from './scene-document.js';
import type { SceneBlockInput } from './contracts.js';

export interface ScriptImportInput {
  format: 'text' | 'csv';
  source: string;
  /** CSV column indexes are zero-based, so duplicate header names remain selectable. */
  textColumn?: number;
  speakerColumn?: number | null;
  header?: boolean;
  /** Explicit source-speaker -> display-name mapping; empty target means narration. */
  speakerMap?: Record<string, string>;
}
export interface ScriptImportIssue { line: number; severity: 'error' | 'warning'; code: string; message: string }
export interface ScriptImportPreview {
  ready: boolean;
  columns: { index: number; label: string }[];
  mapping: { textColumn?: number; speakerColumn?: number };
  rows: { line: number; speaker: string; value: string; sourceSpeaker: string; characterIds: string[] }[];
  issues: ScriptImportIssue[];
  blocks: Extract<SceneBlockInput, { kind: 'text' }>[];
}

function encodeImportedText(speaker: string, value: string): string {
  const encoded = escapeInlineText(value);
  return !speaker && extractSpeaker(encoded) !== null
    ? encoded.replace(/[:：]/, colon => '\\' + colon)
    : encoded;
}

/** Strict comma-separated records with quoted commas/newlines and doubled quotes. */
export function csvRecords(source: string): { records: { line: number; cells: string[] }[]; issues: ScriptImportIssue[] } {
  const records: { line: number; cells: string[] }[] = [], issues: ScriptImportIssue[] = [];
  let cells: string[] = [], value = '', quoted = false, closed = false, line = 1, start = 1, pending = false;
  const fail = (message: string): void => { issues.push({ line, severity: 'error', code: 'INVALID_CSV', message }); };
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    const newline = char === '\r' || char === '\n';
    const eol = char === '\r' && source[index + 1] === '\n' ? '\r\n' : char;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { value += '"'; index++; }
        else { quoted = false; closed = true; }
      } else { value += eol; if (newline) { line++; index += eol.length - 1; } }
      continue;
    }
    if (newline || char === ',') {
      cells.push(value); value = ''; closed = false;
      if (newline) {
        if (pending || cells.length > 1 || cells[0] !== '') records.push({ line: start, cells });
        cells = []; pending = false; line++; start = line; index += eol.length - 1;
      } else pending = true;
      continue;
    }
    pending = true;
    if (closed) { fail('闭合引号后只能是逗号或换行。'); return { records, issues }; }
    if (char === '"') {
      if (value !== '') { fail('未加引号的字段中出现引号；请使用成对引号和双引号转义。'); return { records, issues }; }
      quoted = true;
    } else value += char;
  }
  if (quoted) fail(`从第 ${start} 行开始的字段缺少闭合引号。`);
  else if (pending || cells.length || value) records.push({ line: start, cells: [...cells, value] });
  return { records, issues };
}

/** Read-only conversion. It never treats imported text as instructions or creates characters. */
export function previewScriptImport(input: ScriptImportInput, characters: readonly { id: string; name?: string }[] = []): ScriptImportPreview {
  const result: ScriptImportPreview = { ready: false, columns: [], mapping: {}, rows: [], issues: [], blocks: [] };
  const issue = (line: number, severity: 'error' | 'warning', code: string, message: string): void => {
    result.issues.push({ line, severity, code, message });
  };
  const source = input.source.replace(/^\uFEFF/, '');
  if (source.includes('\0')) { issue(1, 'error', 'INVALID_TEXT', '文本含有 NUL 字符，请确认文件为 UTF-8 文字。'); return result; }
  const append = (line: number, sourceSpeaker: string, value: string): void => {
    const speaker = Object.hasOwn(input.speakerMap ?? {}, sourceSpeaker) ? input.speakerMap![sourceSpeaker]! : sourceSpeaker;
    const candidates = characters.filter(character => (character.name ?? character.id) === speaker || character.id === speaker);
    // IDs are suggestions only: no silent rename of the imported display name.
    const encoded = encodeImportedText(speaker, value);
    const parsed = parseSceneLine(speaker ? `${speaker}：${encoded}` : encoded, '');
    result.rows.push({ line, sourceSpeaker, speaker, value, characterIds: candidates.map(character => character.id) });
    if (parsed.kind !== 'text' || parsed.speaker !== speaker || parsed.value !== encoded) {
      issue(line, 'error', 'UNREPRESENTABLE_TEXT', '这行无法原样表示为台词；请修改文字或明确映射说话人，不会作为指令执行。');
    }
    if (candidates.length > 1) issue(line, 'error', 'AMBIGUOUS_SPEAKER', `说话人“${speaker}”对应多个角色，请明确改用唯一显示名或旁白。`);
    else if (speaker && candidates.length === 0) issue(line, 'warning', 'UNKNOWN_SPEAKER', `未声明说话人“${speaker}”；确认后只保留该显示名，不会自动创建角色。`);
    else if (candidates.length === 1 && candidates[0]!.name && candidates[0]!.name !== speaker) {
      issue(line, 'warning', 'SPEAKER_ID', `“${speaker}”可能是角色标识，显示名为“${candidates[0]!.name}”；可通过角色映射选择。`);
    }
  };
  if (input.format === 'text') {
    source.split(/\r\n|\n|\r/).forEach((raw, index) => {
      if (!raw.trim()) return;
      const text = raw.trimStart(), speaker = extractSpeaker(text) ?? '';
      const value = speaker ? text.slice(speaker.length + 1).trimStart() : text;
      if (text !== raw || (speaker && text.slice(speaker.length + 1) !== value)) {
        issue(index + 1, 'warning', 'LEADING_WHITESPACE', '行首或说话人分隔符后的空白按台词格式去除，请核对预览。');
      }
      append(index + 1, speaker, value);
    });
  } else {
    const parsed = csvRecords(source); result.issues.push(...parsed.issues);
    if (parsed.issues.length || !parsed.records.length) {
      if (!parsed.issues.length) issue(1, 'error', 'EMPTY_IMPORT', '没有可导入的台词。');
      return result;
    }
    const header = input.header !== false, first = parsed.records[0]!;
    result.columns = first.cells.map((label, index) => ({ index, label: header ? label : `第 ${index + 1} 列` }));
    const guess = (names: string[]): number | undefined => {
      const matches = header ? first.cells.flatMap((value, index) => names.includes(value.trim().toLowerCase()) ? [index] : []) : [];
      return matches.length === 1 ? matches[0] : undefined;
    };
    const textColumn = input.textColumn ?? guess(['text', 'dialogue', '台词', '正文', '内容']);
    const speakerColumn = input.speakerColumn === null ? undefined : input.speakerColumn ?? guess(['speaker', 'name', '角色', '说话人']);
    result.mapping = { ...(textColumn === undefined ? {} : { textColumn }), ...(speakerColumn === undefined ? {} : { speakerColumn }) };
    if (textColumn === undefined || !Number.isInteger(textColumn) || textColumn < 0 || textColumn >= first.cells.length
      || (speakerColumn !== undefined && (!Number.isInteger(speakerColumn) || speakerColumn < 0 || speakerColumn >= first.cells.length || speakerColumn === textColumn))) {
      issue(first.line, 'error', 'COLUMN_MAPPING_REQUIRED', '请选择唯一有效的台词列；说话人列不能与台词列相同。'); return result;
    }
    const ignored = first.cells.filter((_, index) => index !== textColumn && index !== speakerColumn);
    if (ignored.length) issue(first.line, 'warning', 'IGNORED_COLUMNS', `未映射的 ${ignored.length} 列不会导入。`);
    for (const record of parsed.records.slice(header ? 1 : 0)) {
      if (record.cells.length !== first.cells.length) {
        issue(record.line, 'error', 'COLUMN_COUNT', `应有 ${first.cells.length} 列，实际 ${record.cells.length} 列。`); continue;
      }
      const speaker = speakerColumn === undefined ? '' : record.cells[speakerColumn]!;
      if (/[\r\n]/.test(speaker)) { issue(record.line, 'error', 'INVALID_SPEAKER', '说话人不能跨行。'); continue; }
      const value = record.cells[textColumn]!;
      if (!value.trim()) { issue(record.line, 'error', 'EMPTY_TEXT', '台词字段为空；请修正或移除这条记录。'); continue; }
      // Quoted multiline dialogue becomes consecutive physical dialogue rows, never raw DSL.
      const lines = value.split(/\r\n|\n|\r/);
      for (const text of lines) append(record.line, speaker, text);
      if (lines.length > 1) issue(record.line, 'warning', 'MULTILINE_TEXT', `此单元格拆为 ${lines.length} 条连续台词，均保留同一说话人。`);
    }
  }
  if (!result.rows.length) issue(1, 'error', 'EMPTY_IMPORT', '没有可导入的台词。');
  result.ready = result.rows.length > 0 && !result.issues.some(item => item.severity === 'error');
  if (result.ready) result.blocks = result.rows.map(({ speaker, value }) => ({ kind: 'text', speaker, value: encodeImportedText(speaker, value) }));
  return result;
}
