/**
 * DSL 词法单元类型。
 * lexer 按行切分 .gal 源文本。
 */

/** 指令名（运行时校验，如 bg / show / choice / if） */
export type InstructionName = string;

/** Same-file source extent: 1-based lines and UTF-16 columns, end exclusive.
 * Unlike structural SourceSpan, end is always the first character after the text. */
export interface SourceRange {
  start: { line: number; col: number };
  end: { line: number; col: number };
}

/** 带位置的源位置信息（错误定位用） */
export interface SourcePos {
  /** 源文件名 */
  file: string;
  /** 行号（从 1 开始） */
  line: number;
  /** 列号（从 1 开始） */
  col: number;
  /** Exact excerpt when known; may be narrower than the instruction's line/col anchor. */
  range?: SourceRange;
}

/** Preserve physical whitespace between arguments instead of measuring joined values. */
export function rangeOfArguments(ranges: readonly SourceRange[] | undefined, from = 0): SourceRange | undefined {
  const first = ranges?.[from];
  const last = ranges?.at(-1);
  return first && last ? { start: first.start, end: last.end } : undefined;
}

/** 可定位的源码错误基类（CLI/lint 统一按此处理，避免按具体子类分支）。
 *  子类实现 pos 返回错误所在位置（可能为 null）。 */
export abstract class SourceError extends Error {
  /** 错误码（lint/CLI 展示用，可选） */
  code?: string;
  hint?: string;
  abstract get pos(): SourcePos | null;
}

/** 普通文本行（对话/旁白原文，支持 {var} 插值与说话人前缀） */
export interface TextToken extends SourcePos {
  type: 'text';
  /** 原始行文本（含前导空白，choice 选项行解析需要） */
  raw: string;
  /** 去掉说话人前缀后的原文 */
  value: string;
  /** 说话人（冒号前缀解析结果，可为空） */
  speaker: string | null;
}

/**
 * 指令行：@name args @mod k=v
 * 例：@show lynn:armor despair @ left @ effect shake
 */
export interface InstructionToken extends SourcePos {
  type: 'instruction';
  name: InstructionName;
  /** 位置参数列表 */
  args: string[];
  /** One exact range per positional argument, before whitespace normalization. */
  argRanges?: SourceRange[];
  /** 修饰符参数（@key value / @key=value） */
  modifiers: Map<string, string>;
}

/** 标签：@label name */
export interface LabelToken extends SourcePos {
  type: 'label';
  name: string;
}

/** 文件结束 */
export interface EofToken extends SourcePos {
  type: 'eof';
}

/** 源注释（// 开头），lexer 丢弃 */
export interface CommentToken extends SourcePos {
  type: 'comment';
  value: string;
}

export type Token = TextToken | InstructionToken | LabelToken | CommentToken | EofToken;
