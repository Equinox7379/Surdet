/**
 * 剧本行模型：原始行文本（raw）是唯一事实来源，类型化字段只是编辑糖。
 * 用户改类型化字段 → 重建 raw；直接改 raw → 重新分类该行。序列化零失真。
 */

export type LineModel =
  | { kind: 'blank'; raw: string }
  | { kind: 'comment'; raw: string }
  | { kind: 'label'; name: string; raw: string }
  | { kind: 'choice-option'; raw: string }
  | { kind: 'text'; speaker: string; value: string; sep: string; raw: string }
  | { kind: 'instr'; name: string; raw: string };

const SPEAKER_RE = /^([^\s：:]{1,24})([：:])(.*)$/;
const INSTR_NAME_RE = /^@([^\s]+)/;

/** 分类单行（prevKind 用于识别 choice 的缩进选项行） */
export function parseLine(raw: string, prevKind: string): LineModel {
  const trimmed = raw.trimStart();
  if (trimmed.length === 0) return { kind: 'blank', raw };
  if (trimmed.startsWith('//')) return { kind: 'comment', raw };
  if (/^@label($|\s)/.test(trimmed)) {
    return { kind: 'label', name: trimmed.replace(/^@label\s+/, '').trim(), raw };
  }
  if (trimmed.startsWith('@')) {
    const name = INSTR_NAME_RE.exec(trimmed)?.[1] ?? '';
    return { kind: 'instr', name, raw };
  }
  if (/^\s/.test(raw) && (prevKind === 'choice' || prevKind === 'choice-option')) {
    return { kind: 'choice-option', raw };
  }
  const m = SPEAKER_RE.exec(trimmed);
  if (m && !/^\d+$/.test(m[1]!)) {
    // 记录原冒号形态（全角：/半角:），重建 raw 时保持原样（零失真）
    return { kind: 'text', speaker: m[1]!, value: m[3]!.trimStart(), sep: m[2]!, raw };
  }
  return { kind: 'text', speaker: '', value: trimmed, sep: '：', raw };
}

/** 解析整篇剧本为行模型 */
export function parseScript(text: string): LineModel[] {
  const lines = text.split(/\r?\n/);
  const out: LineModel[] = [];
  let prevKind = '';
  for (const raw of lines) {
    const model = parseLine(raw, prevKind);
    out.push(model);
    if (model.kind === 'instr') {
      prevKind = model.name === 'choice' ? 'choice' : 'instr';
    } else if (model.kind === 'choice-option') {
      prevKind = 'choice-option';
    } else {
      prevKind = model.kind;
    }
  }
  return out;
}

/** 序列化回剧本文本（raw 直出，零失真；eol 保持源文件换行风格，CRLF 文件保存后不变 LF） */
export function serializeScript(lines: LineModel[], eol: string = '\n'): string {
  return lines.map((l) => l.raw).join(eol);
}

/** 从类型化字段重建文本行 raw（sep 保持原冒号形态，缺省全角） */
export function rebuildTextRaw(speaker: string, value: string, sep: string = '：'): string {
  return speaker.length > 0 ? `${speaker}${sep}${value}` : value;
}

export function rebuildLabelRaw(name: string): string {
  return `@label ${name}`;
}

/** 指令行拆分：@name + 参数（引号感知，保留引号原文） */
export function splitInstr(raw: string): { name: string; args: string[] } {
  const trimmed = raw.trimStart();
  const name = INSTR_NAME_RE.exec(trimmed)?.[1] ?? '';
  const rest = trimmed.slice(1 + name.length).trim();
  if (rest.length === 0) return { name, args: [] };
  const args: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if (quote !== null) {
      cur += c;
      if (c === '\\' && i + 1 < rest.length) { cur += rest[++i]!; continue; }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      cur += c;
      quote = c;
    } else if (/\s/.test(c)) {
      if (cur.length > 0) { args.push(cur); cur = ''; }
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) args.push(cur);
  return { name, args };
}

/** 参数拼回指令行 */
export function rebuildInstrRaw(name: string, args: string[]): string {
  const clean = args.filter((a) => a.length > 0);
  return clean.length > 0 ? `@${name} ${clean.join(' ')}` : `@${name}`;
}
