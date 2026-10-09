/**
 * DSL 抽象语法树与编译指令流。
 *
 * 分层：
 *  - Parser 产物：SceneAst（嵌套块，含 if/choice 结构）
 *  - Compiler 产物：CompiledScene（展平指令流 + 标签索引 + 诊断）
 */
import { SourceError, type SourcePos, type SourceRange } from './token.js';

/* ============================ 中间表示（parser 产物） ============================ */

export interface SceneAst {
  sceneId: string;
  blocks: AstBlock[];
}

/**
 * 源码范围。end 指向范围之后的结构标记（例如分支的下一个
 * @elif/@else/@endif，条件块的 @endif），因此调用方可以无歧义地把
 * 行范围转换为 [start.line, end.line)；对于完整条件块，span.end 是
 * @endif 本身，便于把闭合标记纳入完整块范围。
 */
export interface SourceSpan {
  start: SourcePos;
  end: SourcePos;
}

export interface AstIfBranch {
  kind: 'if' | 'elif' | 'else';
  /** @else 没有表达式。 */
  expr: string | null;
  blocks: AstBlock[];
  /** 分支头到下一个分支头或 @endif 之前的源码范围。 */
  span: SourceSpan;
  /** 分支正文范围；不包含分支头和下一个结构标记。 */
  bodySpan: SourceSpan;
}

export interface AstIfBlock {
  kind: 'if';
  expr: string;
  then: AstBlock[];
  else: AstBlock[];
  /** 保留显式 if/elif/else 分支事实，供 authoring 精确定位与编辑。 */
  branches: AstIfBranch[];
  pos: SourcePos;
  /** 从 @if 到 @endif（end 指向 @endif）的完整源码范围。 */
  span: SourceSpan;
}

export interface AstChoiceBlock {
  kind: 'choice';
  options: AstChoiceOption[];
  pos: SourcePos;
  /** 从 @choice 到下一条语义 token 的源码范围。 */
  span: SourceSpan;
}

export type AstBlock =
  | { kind: 'label'; name: string; pos: SourcePos }
  | { kind: 'instr'; name: string; args: string[]; argRanges?: SourceRange[]; modifiers: Map<string, string>; pos: SourcePos }
  | { kind: 'text'; speaker: string | null; value: string; pos: SourcePos }
  | AstIfBlock
  | AstChoiceBlock;

export interface AstChoiceOption {
  /** 选项文本 */
  label: string;
  /** 可选条件表达式（空 = 恒显示） */
  when: string | null;
  /** 选中后执行的内联指令 */
  inline: AstInline[];
  /** 显式跳转目标（来自内联 @goto/@jump，编译器提取） */
  jump: { kind: 'goto' | 'jump'; target: string; range?: SourceRange } | null;
  /** 被丢弃的额外跳转数量（第二个及以后的 @goto/@jump；编译器报 W008） */
  extraJumps?: number;
  /** 选项行位置 */
  pos: SourcePos;
  /** 选项行的源码范围（end 为该行结束列）。 */
  span: SourceSpan;
}

export interface AstInline {
  name: string;
  args: string[];
  argRanges?: SourceRange[];
  modifiers: Map<string, string>;
  pos: SourcePos;
}

/* ============================ 编译指令流（compiler 产物） ============================ */

/** 指令流基类：index 由编译器填充（程序计数器用） */
export interface DslInstrBase extends SourcePos {
  index: number;
}

/** 文本输出 */
export interface TextInstr extends DslInstrBase {
  op: 'text';
  speaker: string | null;
  value: string;
}

/** 通用指令（bg/show/voice/choice 之外的语义，解释器按 name 分派） */
export interface GenericInstr extends DslInstrBase {
  op: 'instr';
  name: string;
  args: string[];
  modifiers: Map<string, string>;
}

/** 标签锚点（解释器直接跳过） */
export interface LabelInstr extends DslInstrBase {
  op: 'label';
  name: string;
}

/** 无条件跳转：goto（本场景标签）/ jump（场景[.标签]） */
export interface JumpInstr extends DslInstrBase {
  op: 'jump';
  kind: 'goto' | 'jump';
  target: string;
  /** goto 在编译期解析为场景内标签索引；jump 保持目标字符串 */
  gotoIndex: number | null;
}

/** 条件跳转（@if 编译产物）：表达式为假时跳转到 target 指令 */
export interface CondJumpInstr extends DslInstrBase {
  op: 'condJump';
  expr: string;
  target: number;
}

/** @set var [=|:=|+=|-=] expr */
export interface SetInstr extends DslInstrBase {
  op: 'set';
  varName: string;
  setOp: '=' | ':=' | '+=' | '-=';
  expr: string;
}

/** @mod var +delta */
export interface ModifyInstr extends DslInstrBase {
  op: 'modify';
  varName: string;
  delta: number;
}

/** @wait ms：阻塞等待。解释器发 wait 事件后挂起（awaiting-timer），
 *  宿主计时结束调 finishWait() 恢复；玩家 advance() 可跳过剩余等待。
 *  存档定位回退到 wait 指令本身，读档重新计时。 */
export interface WaitInstr extends DslInstrBase {
  op: 'wait';
  /** 等待时长（毫秒，正整数） */
  ms: number;
}

/** @timeline id [@ blocking]：启动项目时间轴；blocking 时挂起解释器等待宿主完成。 */
export interface TimelineInstr extends DslInstrBase {
  op: 'timeline';
  id: string;
  blocking: boolean;
}

/** 选择肢（option 指令块已在流中，选中的 option 从 blockStart 开始执行） */
export interface ChoiceInstr extends DslInstrBase {
  op: 'choice';
  options: CompiledChoiceOption[];
  /** 所有选项块之后的指令索引（选项块执行完 / 无可用选项时落到此处） */
  afterIndex: number;
}

export interface CompiledChoiceOption {
  label: string;
  when: string | null;
  /** 该选项指令块的起始索引 */
  blockStart: number;
  /** 选项行位置（lint 对 when 表达式定位用） */
  pos: SourcePos;
}

/** @call sceneId[.label]：将返回点（当前场景 + 下一条指令）压入调用栈，跳转到目标场景 */
export interface CallInstr extends DslInstrBase {
  op: 'call';
  target: string;
}

/** 场景结束（文末自动追加，解释器据此切换场景/返回） */
export interface SceneEndInstr extends DslInstrBase {
  op: 'end';
}

/** @switch varName v1:label1 v2:label2 ...：按变量值跳转对应标签，无匹配则落到下一条 */
export interface SwitchInstr extends DslInstrBase {
  op: 'switch';
  varName: string;
  cases: { value: string; label: string; range?: SourceRange }[];
}

/** @video key：播放视频并阻塞（宿主播放结束/玩家点击后调 finishWait 恢复，与 @wait 同挂起语义） */
export interface VideoInstr extends DslInstrBase {
  op: 'video';
  src: string;
}

export type DslInstr =
  | TextInstr
  | GenericInstr
  | LabelInstr
  | JumpInstr
  | CondJumpInstr
  | SetInstr
  | ModifyInstr
  | WaitInstr
  | TimelineInstr
  | SwitchInstr
  | VideoInstr
  | ChoiceInstr
  | CallInstr
  | SceneEndInstr;

/** 编译诊断（warning 级，error 直接抛 DslError） */
export interface DslDiagnostic extends SourcePos {
  code: string;
  message: string;
  hint?: string;
}

/** 单个场景的编译产物 */
export interface CompiledScene {
  sceneId: string;
  /** Exact source SHA-256 for confirmed text mappings; unrelated to save instruction identity. */
  textSourceVersion?: string;
  instructions: DslInstr[];
  /** 标签 → 指令索引 */
  labels: Map<string, number>;
  /** 诊断信息 */
  diagnostics: DslDiagnostic[];
  /** 源码内容哈希（存档定位一致性校验用：剧本改动后旧存档 pc 可能指向错误指令，
   *  读档时哈希不匹配由解释器发 saveMismatch 事件提醒宿主） */
  sceneHash?: string;
}

/** 编译异常（错误级，带行列定位） */
export class DslError extends SourceError {
  override readonly pos: SourcePos;
  override readonly code: string;

  constructor(code: string, message: string, pos: SourcePos, override readonly hint?: string) {
    super(`${pos.file}:${pos.line}:${pos.col}: ${message}${hint ? `（${hint}）` : ''} [${code}]`);
    this.name = 'DslError';
    this.code = code;
    this.pos = pos;
  }
}

/** 便捷函数：从行列构造 SourcePos */
export function pos(file: string, line: number, col: number): SourcePos {
  return { file, line, col };
}
