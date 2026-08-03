import type {
  EofToken,
  InstructionToken,
  LabelToken,
  Token,
  TextToken,
} from './token.js';
import { SourceError, type SourcePos } from './token.js';

/** 由 lexer 抛出的语法错误（带行列定位） */
export class LexError extends SourceError {
  override readonly code: string;
  readonly file: string;
  readonly line: number;
  readonly col: number;

  constructor(code: string, message: string, file: string, line: number, col: number) {
    super(`${file}:${line}:${col}: ${message} (${code})`);
    this.name = 'LexError';
    this.code = code;
    this.file = file;
    this.line = line;
    this.col = col;
  }

  override get pos(): SourcePos {
    return { file: this.file, line: this.line, col: this.col };
  }
}

const MAX_SPEAKER_LEN = 24;

/**
 * 词法分析器：.gal 源文本 → Token 流。
 *
 * 行分类：
 *  - 空行 / // 注释：跳过
 *  - @label name：LabelToken
 *  - @instr args @mod v：InstructionToken
 *  - 其余：TextToken（含说话人前缀解析；choice 选项行保留 raw 供 parser 识别）
 *
 * 注意：
 *  - 指令行内 @ 是修饰符分隔符，修饰符值不应包含 @ 字符。
 *  - 文本行不能以 @ 或 // 开头：会被识别为指令/注释。需要这类开头时用引号包裹的
 *    参数值（如 @set msg = "@字"）或改用其他措辞。
 */
export class Lexer {
  tokenize(source: string, file: string): Token[] {
    const lines = source.split(/\r?\n/);
    const tokens: Token[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i] ?? '';
      const line = i + 1;
      const trimmed = lineText.trimStart();
      const indent = lineText.length - trimmed.length;

      if (trimmed.length === 0) continue;

      if (trimmed.startsWith('//')) {
        tokens.push({ type: 'comment', value: trimmed.slice(2), file, line, col: indent + 1 });
        continue;
      }

      if (trimmed.startsWith('@')) {
        // 严格 @label：整行必须恰为 @label name
        if (/^@label($|\s)/.test(trimmed)) {
          const m = /^@label\s+([^\s@]+)\s*$/.exec(trimmed);
          if (!m) {
            throw new LexError('L003', '@label 用法：@label name（标签名不能为空或含多余内容）', file, line, indent + 1);
          }
          const name = m[1]!;
          const col = indent + trimmed.indexOf(name) + 1;
          tokens.push({ type: 'label', name, file, line, col });
          continue;
        }
        tokens.push(this.parseInstruction(trimmed, file, line, indent));
        continue;
      }

      tokens.push(this.parseText(trimmed, lineText, file, line, indent));
    }

    const eofLine = lines.length + 1;
    tokens.push({ type: 'eof', file, line: eofLine, col: 1 });
    return tokens;
  }

  /** 解析指令行主体（以 @ 开头，不含 @label）。
   *  引号感知：参数与修饰符值可用 "…" / '…' 包裹，保留内部空格与 @，
   *  未闭合引号抛 L004。 */
  private parseInstruction(trimmed: string, file: string, line: number, indent: number): InstructionToken {
    if (/^@\s/.test(trimmed)) {
      throw new LexError('L001', '指令行 @ 后必须紧跟指令名（@name ...）', file, line, indent + 1);
    }
    const segments = splitOutsideQuotes(trimmed, '@');
    // segments[0] === ''（以 @ 开头）；真正的内容从 index 1 起
    const first = segments[1];
    if (!first) {
      throw new LexError('L001', '指令行缺少指令名（@name ...）', file, line, indent + 1);
    }
    const firstParts = this.#tokenizeArgs(first, file, line, indent);
    const name = firstParts[0];
    if (name === undefined || name.length === 0) {
      throw new LexError('L001', '指令行缺少指令名（@name ...）', file, line, indent + 1);
    }
    const args = firstParts.slice(1);
    const modifiers = new Map<string, string>();

    for (let s = 2; s < segments.length; s++) {
      const seg = segments[s]!.trim();
      if (seg.length === 0) continue;
      const parts = this.#tokenizeArgs(seg, file, line, indent);
      const keyToken = parts[0];
      if (keyToken === undefined || keyToken.length === 0) {
        throw new LexError('L002', '修饰符缺少键名（@key value）', file, line, indent + 1);
      }
      const eq = keyToken.indexOf('=');
      let key: string;
      let value: string;
      if (eq >= 0) {
        key = keyToken.slice(0, eq);
        value = [keyToken.slice(eq + 1), ...parts.slice(1)].join(' ');
      } else {
        key = keyToken;
        value = parts.slice(1).join(' ');
      }
      modifiers.set(key, value);
    }

    const col = indent + trimmed.indexOf('@') + 1;
    return { type: 'instruction', name, args, modifiers, file, line, col };
  }

  /** 引号感知参数切分；未闭合引号抛 L004（列定位到引号处） */
  #tokenizeArgs(input: string, file: string, line: number, indent: number): string[] {
    try {
      return tokenizeArgs(input);
    } catch (err) {
      if (err instanceof UnclosedQuoteError) {
        throw new LexError('L004', `参数引号未闭合（"…" 或 '…'）`, file, line, indent + 1 + err.offset);
      }
      throw err;
    }
  }

  /** 解析文本行（说话人前缀 + 内容）。raw 保留原始行（含前导缩进，choice 选项行识别用） */
  private parseText(trimmed: string, raw: string, file: string, line: number, indent: number): TextToken {
    const speaker = extractSpeaker(trimmed);
    const value = speaker === null ? trimmed : trimmed.slice(speaker.length + 1).trimStart();
    const col = indent + 1;
    return { type: 'text', raw, value, speaker, file, line, col };
  }
}

/**
 * 解析 choice 选项行内的内联指令序列。
 * 输入形如 "@goto leave_path @mod lynnTrust +2"（引号感知：引号内 @ 不拆段）。
 * 返回指令 token 数组（内联指令不解析修饰符，段 2 起每段为一条独立指令）。
 */
export function parseInlineInstructions(
  text: string,
  file: string,
  line: number,
  col: number,
): InstructionToken[] {
  const result: InstructionToken[] = [];
  const segments = splitOutsideQuotes(text, '@');
  for (let s = 1; s < segments.length; s++) {
    const seg = segments[s]!.trim();
    if (seg.length === 0) continue;
    let parts: string[];
    try {
      parts = tokenizeArgs(seg);
    } catch (err) {
      if (err instanceof UnclosedQuoteError) {
        throw new LexError('L004', `参数引号未闭合（"…" 或 '…'）`, file, line, col + err.offset);
      }
      throw err;
    }
    const name = parts[0];
    if (name === undefined || name.length === 0) continue;
    result.push({ type: 'instruction', name, args: parts.slice(1), modifiers: new Map(), file, line, col });
  }
  return result;
}

/** 从一行文本提取说话人：首个中/英文冒号前的非空短前缀（且非纯数字，避免误判时间）。 */
function extractSpeaker(trimmed: string): string | null {
  const idx = firstColonIndex(trimmed);
  if (idx <= 0) return null;
  const prefix = trimmed.slice(0, idx);
  if (prefix.length > MAX_SPEAKER_LEN) return null;
  if (/\s/.test(prefix)) return null;
  if (/^\d+$/.test(prefix)) return null;
  return prefix;
}

function firstColonIndex(s: string): number {
  const full = s.indexOf('：');
  const half = s.indexOf(':');
  if (full === -1) return half;
  if (half === -1) return full;
  return Math.min(full, half);
}

/** 引号感知：按分隔符切段，跳过引号内的分隔符（保留引号字符，供后续剥除） */
function splitOutsideQuotes(input: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (const c of input) {
    if (quote !== null) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      cur += c;
      quote = c;
    } else if (c === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** 引号感知参数切分：引号内空白/@ 不拆 token，但引号字符保留（供表达式字面量与通用值消费方处理） */
function tokenizeArgs(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let quoteStart = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quote !== null) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      cur += c;
      quote = c;
      quoteStart = i;
    } else if (/\s/.test(c)) {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
    } else {
      cur += c;
    }
  }
  if (quote !== null) throw new UnclosedQuoteError(quoteStart);
  if (cur.length > 0) out.push(cur);
  return out;
}

/** 未闭合引号错误（携带引号起始偏移，供 L004 列定位） */
class UnclosedQuoteError extends Error {
  readonly offset: number;
  constructor(offset: number) {
    super('unclosed quote');
    this.name = 'UnclosedQuoteError';
    this.offset = offset;
  }
}
