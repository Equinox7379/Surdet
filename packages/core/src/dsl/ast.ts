/**
 * DSL 抽象语法树与编译指令流。
 *
 * 分层：
 *  - Parser 产物：SceneAst（嵌套块，含 if/choice 结构）
 *  - Compiler 产物：CompiledScene（展平指令流 + 标签索引 + 诊断）
 */
import { SourceError, type SourcePos } from './token.js';

/* ============================ 中间表示（parser 产物） ============================ */

export interface SceneAst {
  sceneId: string;
  blocks: AstBlock[];
}

export type AstBlock =
  | { kind: 'label'; name: string; pos: SourcePos }
  | { kind: 'instr'; name: string; args: string[]; modifiers: Map<string, string>; pos: SourcePos }
  | { kind: 'text'; speaker: string | null; value: string; pos: SourcePos }
  | { kind: 'if'; expr: string; then: AstBlock[]; else: AstBlock[]; pos: SourcePos }
  | { kind: 'choice'; options: AstChoiceOption[]; pos: SourcePos };

export interface AstChoiceOption {
  /** 选项文本 */
  label: string;
  /** 可选条件表达式（空 = 恒显示） */
  when: string | null;
  /** 选中后执行的内联指令 */
  inline: AstInline[];
  /** 显式跳转目标（来自内联 @goto/@jump，编译器提取） */
  jump: { kind: 'goto' | 'jump'; target: string } | null;
  /** 选项行位置 */
  pos: SourcePos;
}

export interface AstInline {
  name: string;
  args: string[];
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

export type DslInstr =
  | TextInstr
  | GenericInstr
  | LabelInstr
  | JumpInstr
  | CondJumpInstr
  | SetInstr
  | ModifyInstr
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

  constructor(code: string, message: string, pos: SourcePos, hint?: string) {
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
