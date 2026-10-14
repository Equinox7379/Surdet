/**
 * 场景级共享校验（CLI lint 与可视化编辑器共用，消除双源逻辑漂移）。
 * 纯函数、零 fs 依赖：可安全打入浏览器端（编辑器）与 Node 端（CLI）。
 */
import { IMPLEMENTED_INSTRUCTIONS } from './dsl/compiler.js';
import { parseExpr, collectVars } from './dsl/expr-parser.js';
import { STAGE_POSE_MODIFIERS, decodeStageToken } from './stage.js';
import { BUILTIN_TRANSITIONS, BUILTIN_TRANSITION_NAMES } from './transition.js';
import type { ExprAst } from './dsl/expr-ast.js';
import { collectInterpolatedVars } from './runtime/interpreter.js';
import { VariableStore } from './state/variable-store.js';
import { isVarType, VAR_TYPES } from './state/types.js';
import type { VarDeclaration, VarValue } from './state/types.js';
import type { SourceError, SourceRange } from './dsl/token.js';
import type {
  ChoiceInstr,
  CompiledScene,
  CondJumpInstr,
  GenericInstr,
  ModifyInstr,
  SetInstr,
  TextInstr,
} from './dsl/ast.js';
import { readProjectPlugins } from './project-plugins.js';

/** 统一 lint 问题形状（CLI 与编辑器共用）；hint 为可操作的修复建议（M5 支柱1：AI 自我修正闭环，
 *  经 attachHints 按错误码补齐，lint --json 输出携带） */
export interface LintIssue {
  severity: 'error' | 'warning';
  code: string;
  text: string;
  file: string;
  line: number;
  col: number;
  /** 修复建议（写给 AI/作者：精确可操作；由 attachHints 按 code 补齐） */
  hint?: string;
  /** Exact excerpt in this validation's input, when known; end is exclusive. */
  range?: SourceRange;
}

/** Keep the same diagnostic facts across CLI, Editor and Agent failure replies. */
export function sourceErrorIssue(error: SourceError, fallbackFile: string): LintIssue {
  const p = error.pos;
  return {
    severity: 'error', code: error.code ?? 'LINT', text: error.message,
    file: p?.file ?? fallbackFile, line: p?.line ?? 0, col: p?.col ?? 0,
    ...(p?.range ? { range: p.range } : {}),
    ...(error.hint ? { hint: error.hint } : {}),
  };
}

/** 解析 game.config.json 原始对象 → 变量表/类型表/readonly 集/customInstructions/entryScene。
 *  声明形状非法推 CONFIG/VAR_DECL 问题。CLI（读文件）与编辑器（内存 JSON）共用。 */
export function parseVariableConfig(
  raw: Record<string, unknown>,
  cfgPath: string,
  issues: LintIssue[],
): {
  variables: Set<string>;
  types: Map<string, string>;
  readonlyVars: Set<string>;
  customInstructions: string[];
  entryScene: string | undefined;
} {
  const customInstructions: string[] = [];
  const custom = raw['customInstructions'];
  if (custom !== undefined) {
    if (Array.isArray(custom) && custom.every((s) => typeof s === 'string')) {
      customInstructions.push(...(custom as string[]));
    } else {
      issues.push({
        severity: 'error',
        code: 'CONFIG',
        text: `${cfgPath}: 'customInstructions' 必须是字符串数组（自定义指令名，用于消 W001 告警）`,
        file: cfgPath,
        line: 0,
        col: 0,
      });
    }
  }
  try { customInstructions.push(...readProjectPlugins({ plugins: raw.plugins }).flatMap(plugin => plugin.instructions.map(instruction => instruction.name))); }
  catch (error) { issues.push({ severity: 'error', code: 'PLUGIN_CONFIG', text: error instanceof Error ? error.message : String(error), file: cfgPath, line: 0, col: 0 }); }

  const entryRaw = raw['entryScene'];
  const entryScene = typeof entryRaw === 'string' && entryRaw.length > 0 ? entryRaw : undefined;

  const variables = new Set<string>();
  const types = new Map<string, string>();
  const readonlyVars = new Set<string>();
  const variablesRaw = raw['variables'];
  if (variablesRaw === undefined) {
    return { variables, types, readonlyVars, customInstructions, entryScene };
  }
  if (typeof variablesRaw !== 'object' || variablesRaw === null || Array.isArray(variablesRaw)) {
    issues.push({
      severity: 'error',
      code: 'CONFIG',
      text: `${cfgPath}: 'variables' 字段必须是对象（变量名 → 声明），得到 ${Array.isArray(variablesRaw) ? '数组' : typeof variablesRaw}`,
      file: cfgPath,
      line: 0,
      col: 0,
    });
    return { variables, types, readonlyVars, customInstructions, entryScene };
  }
  for (const [name, decl] of Object.entries(variablesRaw)) {
    variables.add(name);
    if (validateVarDecl(cfgPath, name, decl, issues) && typeof decl === 'object' && decl !== null) {
      types.set(name, (decl as { type: string }).type);
      if ((decl as { readonly?: boolean }).readonly === true) readonlyVars.add(name);
    }
  }
  return { variables, types, readonlyVars, customInstructions, entryScene };
}

/** @switch 目标标签存在性（J004）：目标必须是本场景标签 */
export function validateSwitchTargets(scene: CompiledScene, issues: LintIssue[]): void {
  for (const instr of scene.instructions) {
    if (instr.op !== 'switch') continue;
    for (const c of instr.cases) {
      if (!scene.labels.has(c.label)) {
        issues.push({
          severity: 'error',
          code: 'J004',
          text: `${instr.file}:${instr.line}:${instr.col}: @switch 跳转目标 '@label ${c.label}' 不存在（目标必须是本场景标签）`,
          file: instr.file,
          line: instr.line,
          col: instr.col,
          ...(c.range ? { range: c.range } : {}),
        });
      }
    }
  }
}

/** 校验单个变量声明条目形状：type 合法 + initial 存在且类型匹配。合法返回 true。 */
export function validateVarDecl(cfgPath: string, name: string, decl: unknown, issues: LintIssue[]): boolean {
  if (typeof decl !== 'object' || decl === null || Array.isArray(decl)) {
    issues.push({
      severity: 'error',
      code: 'VAR_DECL',
      text: `${cfgPath}: 变量 '${name}' 的声明必须是对象 { type, initial, ... }`,
      file: cfgPath,
      line: 0,
      col: 0,
    });
    return false;
  }
  const { type, initial } = decl as Record<string, unknown>;
  if (typeof type !== 'string' || !isVarType(type)) {
    issues.push({
      severity: 'error',
      code: 'VAR_DECL',
      text: `${cfgPath}: 变量 '${name}' 的 type 非法（应为 ${VAR_TYPES.join('/')}，得到 '${String(type)}'）`,
      file: cfgPath,
      line: 0,
      col: 0,
    });
    return false;
  }
  if (!('initial' in decl)) {
    issues.push({
      severity: 'error',
      code: 'VAR_DECL',
      text: `${cfgPath}: 变量 '${name}' 缺少 initial 初值`,
      file: cfgPath,
      line: 0,
      col: 0,
    });
    return false;
  }
  // 运行时唯一声明校验：这里不再维护一份浅层 initialMatches，避免 lint 通过而启动失败。
  // 仅使用声明字段的运行时形状，VariableStore 不会修改传入对象。
  const runtimeDecl = {
    ...(decl as Record<string, unknown>),
    name,
    type,
    initial: initial as VarValue,
  } as unknown as VarDeclaration;
  try {
    new VariableStore([runtimeDecl]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const initialPrefix = `Variable '${name}' (initial):`;
    if (message.startsWith(initialPrefix)) {
      issues.push({
        severity: 'error',
        code: 'VAR_DECL',
        text: `${cfgPath}: 变量 '${name}' 的 initial 与 type '${type}' 不匹配（得到 ${JSON.stringify(initial)}）`,
        file: cfgPath,
        line: 0,
        col: 0,
      });
    } else if (message === `Variable '${name}': min (${runtimeDecl.min}) > max (${runtimeDecl.max})，clamp 约束非法`) {
      issues.push({
        severity: 'error',
        code: 'VAR_DECL',
        text: `${cfgPath}: 变量 '${name}' 的 min (${runtimeDecl.min}) > max (${runtimeDecl.max})，clamp 约束非法`,
        file: cfgPath,
        line: 0,
        col: 0,
      });
    } else {
      issues.push({
        severity: 'error',
        code: 'VAR_DECL',
        text: `${cfgPath}: 变量 '${name}' 的声明无效（${message}）`,
        file: cfgPath,
        line: 0,
        col: 0,
      });
    }
    return false;
  }
  return true;
}

/** 收集场景内全部说话人（原始文本，供 choice 选项"疑似缩进正文"判定） */
export function collectSceneSpeakers(scene: CompiledScene): Set<string> {
  const out = new Set<string>();
  for (const instr of scene.instructions) {
    if (instr.op === 'text' && instr.speaker) out.add(instr.speaker);
  }
  return out;
}

export function validateTransitionInstructions(scene: CompiledScene, issues: LintIssue[]): void {
  for (const instr of scene.instructions) {
    if (instr.op !== 'instr' || instr.name !== 'transition') continue;
    const name = decodeStageToken(instr.args[0] ?? 'fade');
    if (BUILTIN_TRANSITIONS.has(name)) continue;
    issues.push({
      severity: 'error',
      code: 'T010',
      text: `${instr.file}:${instr.line}:${instr.col}: @transition 未知转场 '${name}'（支持 ${BUILTIN_TRANSITION_NAMES.join('/')}）`,
      file: instr.file,
      line: instr.line,
      col: instr.col,
      hint: `改用 ${BUILTIN_TRANSITION_NAMES.join('、')}；如需扩展，请先在引擎注册转场。`,
    });
  }
}

/**
 * choice 后所有缩进文本行都会被当作选项；以下形态极可能是"缩进正文被误判为选项"
 * （剧情结构静默损坏），W004 警告：
 *  - 选项的说话人前缀与同场景真实对话一致（如 '凛：'）
 *  - 选项以旁白括号开头（如 '（她沉默了片刻。）'，无说话人前缀的缩进旁白）
 * 不依赖 game.config.json（始终执行）。
 */
export function checkChoiceSuspects(scene: CompiledScene, speakers: Set<string>, issues: LintIssue[]): void {
  for (const instr of scene.instructions) {
    if (instr.op !== 'choice') continue;
    for (const opt of instr.options) {
      const prefix = /^([^\s：:]{1,24})[：:]/.exec(opt.label)?.[1];
      if (prefix !== undefined && speakers.has(prefix)) {
        issues.push({
          severity: 'warning',
          code: 'W004',
          text: `${opt.pos.file}:${opt.pos.line}:${opt.pos.col}: 选项文本 '${opt.label}' 的说话人前缀 '${prefix}' 与场景内对话一致，疑似缩进正文被误判为选项（choice 后正文请勿缩进）`,
          file: opt.pos.file,
          line: opt.pos.line,
          col: opt.pos.col,
        });
      } else if (/^[（(\[]/.test(opt.label)) {
        // 旁白/注释风格（（...）/[...]）开头：无说话人前缀的缩进旁白同样会被静默吞成选项
        issues.push({
          severity: 'warning',
          code: 'W004',
          text: `${opt.pos.file}:${opt.pos.line}:${opt.pos.col}: 选项文本 '${opt.label}' 以旁白括号开头，疑似缩进旁白被误判为选项（choice 后正文请勿缩进）`,
          file: opt.pos.file,
          line: opt.pos.line,
          col: opt.pos.col,
        });
      }
    }
  }
}

/** 变量声明交叉校验：赋值目标 + 表达式引用 + 表达式静态类型检查 + readonly 写入 */
export function validateSceneVariables(
  scene: CompiledScene,
  variables: Set<string>,
  types: Map<string, string>,
  readonlyVars: Set<string>,
  issues: LintIssue[],
  hasConfig: boolean,
): void {
  if (!hasConfig) return;

  const at = (file: string, line: number, col: number) => ({ file, line, col });

  for (const instr of scene.instructions) {
    switch (instr.op) {
      case 'text': {
        const t = instr as TextInstr;
        const p = at(t.file, t.line, t.col);
        for (const v of collectInterpolatedVars(t.value)) {
          if (!variables.has(v)) {
            issues.push({
              severity: 'error',
              code: 'V002',
              text: `${p.file}:${p.line}:${p.col}: 文本插值 '{${v}}' 引用了未声明变量 '${v}'（需在 game.config.json 的 variables 表中声明）`,
              file: p.file,
              line: p.line,
              col: p.col,
            });
          }
        }
        if (t.speaker !== null) {
          for (const v of collectInterpolatedVars(t.speaker)) {
            if (!variables.has(v)) {
              issues.push({
                severity: 'error',
                code: 'V002',
                text: `${p.file}:${p.line}:${p.col}: 说话人插值 '{${v}}' 引用了未声明变量 '${v}'（需在 game.config.json 的 variables 表中声明）`,
                file: p.file,
                line: p.line,
                col: p.col,
              });
            }
          }
        }
        break;
      }
      case 'set': {
        const s = instr as SetInstr;
        checkVarDeclared(s.varName, at(s.file, s.line, s.col), variables, issues, 'V001', '赋值目标');
        checkNotReadonly(s.varName, at(s.file, s.line, s.col), readonlyVars, issues);
        const ast = checkExpr(s.expr, at(s.file, s.line, s.col), types, issues);
        const declared = types.get(s.varName);
        if (ast && declared) checkSetType(s, declared, ast, types, issues);
        break;
      }
      case 'modify': {
        const m = instr as ModifyInstr;
        checkVarDeclared(m.varName, at(m.file, m.line, m.col), variables, issues, 'V001', '修改目标');
        checkNotReadonly(m.varName, at(m.file, m.line, m.col), readonlyVars, issues);
        break;
      }
      case 'instr': {
        const g = instr as GenericInstr;
        if (VARIABLE_INSTRUCTIONS.has(g.name)) {
          const arg0 = g.args[0];
          if (arg0 !== undefined) {
            checkVarDeclared(arg0, at(g.file, g.line, g.col), variables, issues, 'V001', `@${g.name} 目标`);
            checkNotReadonly(arg0, at(g.file, g.line, g.col), readonlyVars, issues);
          }
        }
        if (g.name === 'has_item') {
          const [source, , result] = g.args;
          const pos = at(g.file, g.line, g.col);
          if (source !== undefined) {
            checkVarDeclared(source, pos, variables, issues, 'V001', '@has_item 来源');
            const type = types.get(source);
            if (type !== undefined && type !== 'string[]') {
              issues.push({
                severity: 'error', code: 'T001', ...pos,
                text: `${g.file}:${g.line}:${g.col}: @has_item 来源变量 '${source}' 必须是 string[]，声明类型为 ${type}`,
              });
            }
          }
          if (result !== undefined) {
            checkVarDeclared(result, pos, variables, issues, 'V001', '@has_item 结果');
            checkNotReadonly(result, pos, readonlyVars, issues);
            const type = types.get(result);
            if (type !== undefined && type !== 'boolean' && type !== 'flag') {
              issues.push({
                severity: 'error', code: 'T001', ...pos,
                text: `${g.file}:${g.line}:${g.col}: @has_item 结果变量 '${result}' 必须是 boolean/flag，声明类型为 ${type}`,
              });
            }
          }
        }
        break;
      }
      case 'condJump': {
        const c = instr as CondJumpInstr;
        const p = at(c.file, c.line, c.col);
        const ast = checkExpr(c.expr, p, types, issues);
        if (ast) checkBooleanType(c.expr, ast, p, types, issues);
        break;
      }
      case 'choice': {
        const ch = instr as ChoiceInstr;
        for (const opt of ch.options) {
          for (const name of collectInterpolatedVars(opt.label)) if (!variables.has(name)) issues.push({
            severity: 'error', code: 'V002', text: `选项插值 '{${name}}' 引用了未声明变量 '${name}'`,
            file: opt.pos.file, line: opt.pos.line, col: opt.pos.col,
          });
          if (opt.when !== null) {
            const p = at(opt.pos.file, opt.pos.line, opt.pos.col);
            const ast = checkExpr(opt.when, p, types, issues);
            if (ast) checkBooleanType(opt.when, ast, p, types, issues);
          }
        }
        break;
      }
      default:
        break;
    }
  }
}

/** 直改 store 且第一个参数为变量名的指令（lint 校验声明，运行时 store 也会兜底） */
const VARIABLE_INSTRUCTIONS = new Set(['inc', 'dec', 'toggle', 'flag', 'unflag', 'add_item', 'remove_item', 'random']);

/** @show 已被渲染层消费的修饰符白名单（其余修饰符静默丢弃，lint 给 W003 提醒） */
const SHOW_CONSUMED_MODIFIERS = new Set<string>([...STAGE_POSE_MODIFIERS, 'left', 'right', 'center', 'instance']);

/**
 * system 指令（@battle/@calendar/@affection/@event/@shop/@item）：修饰符原样经解释器
 * 交付宿主（见 interpreter.ts system 分支），是文档化的宿主参数通道（如 @battle x @difficulty=hard），
 * 不属"静默丢弃"，不报 W003。
 */
const SYSTEM_INSTRUCTIONS = new Set(['battle', 'calendar', 'affection', 'event', 'shop', 'item']);

/**
 * 修饰符未消费检查（W003）：与引擎"避免静默无操作"（W002）哲学一致。
 *  - @show：舞台姿态/instance 与旧位置修饰符被消费；effect/zoom/transition 等会静默丢弃 → 提醒。
 *  - @pose/@layer/@stage：共享舞台语法严格验证修饰符，合法参数被消费。
 *  - 其余核心指令：渲染层/解释器不消费任何修饰符，带修饰符即静默丢弃 → 提醒。
 *  - system 指令：修饰符交付宿主消费 → 跳过。
 *  - 自定义指令（customInstructions）：契约由作者负责 → 跳过（不在 IMPLEMENTED 集）。
 */
export function checkConsumedModifiers(
  instr: GenericInstr,
  issues: LintIssue[],
): void {
  if (instr.modifiers.size === 0) return;
  const at = `${instr.file}:${instr.line}:${instr.col}`;
  if (instr.name === 'show') {
    for (const key of instr.modifiers.keys()) {
      if (!SHOW_CONSUMED_MODIFIERS.has(key)) {
        issues.push({
          severity: 'warning',
          code: 'W003',
          text: `${at}: @show 修饰符 '@${key}' 未被渲染层消费（支持舞台姿态、@instance 和位置修饰符，见舞台 DSL）`,
          file: instr.file,
          line: instr.line,
          col: instr.col,
        });
      }
    }
    return;
  }
  // system 指令修饰符交付宿主；自定义指令不在 IMPLEMENTED 集 → 两者都跳过
  if (instr.name === 'pose' || instr.name === 'layer' || instr.name === 'stage') return;
  if (instr.name === 'transition' && decodeStageToken(instr.args[0] ?? '') === 'rule') {
    for (const key of instr.modifiers.keys()) if (!['rule', 'soft', 'reverse'].includes(key)) issues.push({ severity: 'warning', code: 'W003',
      text: `${at}: 遮罩转场修饰符 '@${key}' 未被引擎消费`, file: instr.file, line: instr.line, col: instr.col });
    return;
  }
  if (SYSTEM_INSTRUCTIONS.has(instr.name) || !IMPLEMENTED_INSTRUCTIONS.has(instr.name)) return;
  for (const key of instr.modifiers.keys()) {
    issues.push({
      severity: 'warning',
      code: 'W003',
      text: `${at}: 指令 '@${instr.name}' 的修饰符 '@${key}' 未被引擎消费`,
      file: instr.file,
      line: instr.line,
      col: instr.col,
    });
  }
}

/** 解析表达式并做变量引用（V002）与运算符操作数类型（T003）检查。返回 AST 供类型推断。 */
function checkExpr(
  expr: string,
  pos: { file: string; line: number; col: number },
  types: Map<string, string>,
  issues: LintIssue[],
): ExprAst | null {
  let ast: ExprAst;
  try {
    ast = parseExpr(expr);
  } catch {
    // 表达式语法错误已由编译期 C005/S002 定位报告，这里跳过避免重复
    return null;
  }
  checkExprVars(expr, pos, new Set(types.keys()), issues);
  checkExprOperands(ast, types, (code, message) => {
    issues.push({
      severity: 'error',
      code,
      text: `${pos.file}:${pos.line}:${pos.col}: ${message}（表达式 '${expr}'）`,
      file: pos.file,
      line: pos.line,
      col: pos.col,
    });
  });
  return ast;
}

/** @set 类型匹配：= / := 要求推断类型与声明一致；+= / -= 要求 number */
function checkSetType(
  s: SetInstr,
  declaredType: string,
  ast: ExprAst,
  types: Map<string, string>,
  issues: LintIssue[],
): void {
  const pos = { file: s.file, line: s.line, col: s.col };
  const inferred = inferExprType(ast, types);
  if (inferred === 'unknown') return;

  if (s.setOp === '+=' || s.setOp === '-=') {
    if (inferred !== 'number') {
      issues.push({
        severity: 'error',
        code: 'T001',
        text: `${pos.file}:${pos.line}:${pos.col}: @set ${s.setOp} 要求表达式结果为 number，静态推断为 ${inferred}（'${s.expr}'）`,
        file: pos.file,
        line: pos.line,
        col: pos.col,
      });
    }
    return;
  }

  const expected = DECLARED_TO_EXPR[declaredType];
  if (expected !== undefined && inferred !== expected) {
    issues.push({
      severity: 'error',
      code: 'T001',
      text: `${pos.file}:${pos.line}:${pos.col}: @set 目标变量 '${s.varName}' 声明类型为 ${declaredType}（静态推断表达式为 ${inferred}），类型不匹配`,
      file: pos.file,
      line: pos.line,
      col: pos.col,
    });
  }
}

/** 条件语境（@if / choice when / @elif）：推断类型必须是 boolean */
function checkBooleanType(
  expr: string,
  ast: ExprAst,
  pos: { file: string; line: number; col: number },
  types: Map<string, string>,
  issues: LintIssue[],
): void {
  const t = inferExprType(ast, types);
  if (t !== 'unknown' && t !== 'boolean') {
    issues.push({
      severity: 'error',
      code: 'T002',
      text: `${pos.file}:${pos.line}:${pos.col}: 条件表达式必须为 boolean，静态推断为 ${t}（'${expr}'）`,
      file: pos.file,
      line: pos.line,
      col: pos.col,
    });
  }
}

/* ------------------------- 表达式静态类型推断 ------------------------- */

type ExprType = 'number' | 'string' | 'boolean' | 'unknown';

/** 声明类型 → 可推断的表达式类型（flag 视作 boolean；数组/对象无法经表达式构造，视为 unknown） */
const DECLARED_TO_EXPR: Record<string, ExprType> = {
  number: 'number',
  string: 'string',
  boolean: 'boolean',
  flag: 'boolean',
  'string[]': 'unknown',
  'number[]': 'unknown',
  object: 'unknown',
};

/** 推断表达式静态类型；无法确定返回 'unknown'（不据此报错） */
function inferExprType(ast: ExprAst, types: Map<string, string>): ExprType {
  switch (ast.kind) {
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'bool':
      return 'boolean';
    case 'var': {
      const t = types.get(ast.name);
      return t ? (DECLARED_TO_EXPR[t] ?? 'unknown') : 'unknown';
    }
    case 'unary':
      return ast.op === '!' ? 'boolean' : 'number';
    case 'binary': {
      const l = inferExprType(ast.left, types);
      const r = inferExprType(ast.right, types);
      switch (ast.op) {
        case '==':
        case '!=':
        case '<':
        case '<=':
        case '>':
        case '>=':
        case '&&':
        case '||':
          return 'boolean';
        case '+':
          if (l === 'string' || r === 'string') return 'string';
          if (l === 'number' && r === 'number') return 'number';
          return 'unknown';
        default:
          return l === 'number' && r === 'number' ? 'number' : 'unknown';
      }
    }
  }
}

/** 递归校验运算符操作数类型（T003）。只对两侧类型均已确定且明显不匹配时报告，避免误报。 */
export function checkExprOperands(
  ast: ExprAst,
  types: Map<string, string>,
  report: (code: string, message: string) => void,
): void {
  switch (ast.kind) {
    case 'unary': {
      const operandType = inferExprType(ast.operand, types);
      if (ast.op === '!') {
        if (operandType !== 'unknown' && operandType !== 'boolean') {
          report('T003', `'!' 需要 boolean 操作数，静态推断为 ${operandType}`);
        }
      } else if (operandType !== 'unknown' && operandType !== 'number') {
        report('T003', `'-' 需要 number 操作数，静态推断为 ${operandType}`);
      }
      checkExprOperands(ast.operand, types, report);
      return;
    }
    case 'binary': {
      const { op, left, right } = ast;
      const l = inferExprType(left, types);
      const r = inferExprType(right, types);
      if (op === '&&' || op === '||') {
        if (l !== 'unknown' && l !== 'boolean') report('T003', `'${op}' 需要 boolean 操作数，静态推断为 ${l}`);
        if (r !== 'unknown' && r !== 'boolean') report('T003', `'${op}' 需要 boolean 操作数，静态推断为 ${r}`);
      } else if (op === '<' || op === '<=' || op === '>' || op === '>=' || op === '-' || op === '*' || op === '/') {
        if (l !== 'unknown' && l !== 'number') report('T003', `'${op}' 需要 number 操作数，静态推断为 ${l}`);
        if (r !== 'unknown' && r !== 'number') report('T003', `'${op}' 需要 number 操作数，静态推断为 ${r}`);
      } else if (op === '+') {
        // 运行时 string + boolean 合法（拼接）；仅 number+boolean / boolean+boolean 会炸
        if ((l === 'boolean' || r === 'boolean') && l !== 'string' && r !== 'string') {
          report('T003', `'+' 需要 number 或 string 操作数（boolean 仅可与 string 拼接）`);
        }
      }
      checkExprOperands(left, types, report);
      checkExprOperands(right, types, report);
      return;
    }
    default:
      return;
  }
}

function checkVarDeclared(
  name: string,
  pos: { file: string; line: number; col: number },
  variables: Set<string>,
  issues: LintIssue[],
  code: string,
  role: string,
): void {
  if (!variables.has(name)) {
    issues.push({
      severity: 'error',
      code,
      text: `${pos.file}:${pos.line}:${pos.col}: ${role}变量 '${name}' 未在 game.config.json 的 variables 表中声明`,
      file: pos.file,
      line: pos.line,
      col: pos.col,
    });
  }
}

/** readonly 变量禁止写入（@set/@mod/@inc/@dec/@toggle/@flag/@unflag）——运行时 VariableStore 也会兜底。 */
function checkNotReadonly(
  name: string,
  pos: { file: string; line: number; col: number },
  readonlyVars: Set<string>,
  issues: LintIssue[],
): void {
  if (readonlyVars.has(name)) {
    issues.push({
      severity: 'error',
      code: 'V003',
      text: `${pos.file}:${pos.line}:${pos.col}: 变量 '${name}' 声明为 readonly，禁止写入`,
      file: pos.file,
      line: pos.line,
      col: pos.col,
    });
  }
}

export function checkExprVars(
  expr: string,
  pos: { file: string; line: number; col: number },
  variables: Set<string>,
  issues: LintIssue[],
): void {
  for (const v of collectVars(parseExpr(expr))) {
    if (!variables.has(v)) {
      issues.push({
        severity: 'error',
        code: 'V002',
        text: `${pos.file}:${pos.line}:${pos.col}: 表达式 '${expr}' 引用了未声明变量 '${v}'（需在 game.config.json 的 variables 表中声明）`,
        file: pos.file,
        line: pos.line,
        col: pos.col,
      });
    }
  }
}

/** @jump/@call 共用的跨场景目标校验（场景存在性 + 标签存在性 + 编译失败场景提示）。
 *  CallInstr 与 JumpInstr 同为 { target, file, line, col } 结构，按结构类型接收。 */
export function validateJumpTarget(
  fromScene: string,
  jump: { target: string; file: string; line: number; col: number; range?: SourceRange },
  sceneLabels: Map<string, Set<string>>,
  failedScenes: Set<string>,
  issues: LintIssue[],
  instrLabel: '@jump' | '@call' = '@jump',
): void {
  const target = jump.target;
  const dot = target.indexOf('.');
  const targetScene = dot >= 0 ? target.slice(0, dot) : target;
  const targetLabel = dot >= 0 ? target.slice(dot + 1) : null;

  const at = `${jump.file}:${jump.line}:${jump.col}`;

  if (targetScene === fromScene && targetLabel === null) {
    // 跳到本场景开头，允许
    return;
  }

  if (failedScenes.has(targetScene)) {
    issues.push({
      severity: 'error',
      code: 'J003',
      text: `${at}: 目标场景 '${targetScene}' 存在但编译失败，请先修复其语法/结构错误`,
      file: jump.file,
      line: jump.line,
      col: jump.col,
      ...(jump.range ? { range: jump.range } : {}),
    });
    return;
  }

  const labels = sceneLabels.get(targetScene);
  if (labels === undefined) {
    issues.push({
      severity: 'error',
      code: 'J001',
      text: `${at}: ${instrLabel} 目标场景 '${targetScene}' 不存在（目标场景必须已实现）`,
      file: jump.file,
      line: jump.line,
      col: jump.col,
      ...(jump.range ? { range: jump.range } : {}),
    });
    return;
  }

  if (targetLabel !== null && !labels.has(targetLabel)) {
    issues.push({
      severity: 'error',
      code: 'J002',
      text: `${at}: 场景 '${targetScene}' 中不存在标签 '@label ${targetLabel}'`,
      file: jump.file,
      line: jump.line,
      col: jump.col,
      ...(jump.range ? { range: jump.range } : {}),
    });
  }
}

/** 配置驱动的 hostJump 目标场景收集（CLI 与编辑器共用的纯实现；审计轮4 自 CLI 下沉）。
 *  这些场景由宿主经 hostJump 进入，无 @jump/@call 引用：W007 可达性需将其作为额外根，
 *  编辑器流程图需将其画成“宿主入口”。输入为已解析的 JSON 原始对象（core 零 fs 约束），
 *  文件读取由调用方（CLI/编辑器）自理。来源：
 *   - events.json `events[].scene` 与 `scheduled[].scene`（EventScheduler/AffectionSystem）
 *   - growth.json `profiles[].levelEvents` 值（GrowthSystem 升级事件）
 *   - calendar.json `nodes[].eventId` 与 `baseCommands[].eventId`（CalendarRunner） */
export function collectConfigSceneRoots(configs: { events?: unknown; growth?: unknown; calendar?: unknown }): string[] {
  const roots: string[] = [];
  const sceneOf = (e: unknown): string | null =>
    !!e && typeof e === 'object' && typeof (e as Record<string, unknown>).scene === 'string'
      ? ((e as Record<string, unknown>).scene as string)
      : null;
  const events = configs.events;
  if (events && typeof events === 'object') {
    for (const key of ['events', 'scheduled'] as const) {
      const list = (events as Record<string, unknown>)[key];
      if (Array.isArray(list)) for (const e of list) { const s = sceneOf(e); if (s) roots.push(s); }
    }
  }
  const growth = configs.growth;
  if (growth && typeof growth === 'object') {
    const profiles = (growth as Record<string, unknown>).profiles;
    if (Array.isArray(profiles)) {
      for (const p of profiles) {
        const lv = p && typeof p === 'object' ? (p as Record<string, unknown>).levelEvents : undefined;
        if (lv && typeof lv === 'object' && !Array.isArray(lv)) {
          for (const s of Object.values(lv as Record<string, unknown>)) if (typeof s === 'string') roots.push(s);
        }
      }
    }
  }
  const calendar = configs.calendar;
  if (calendar && typeof calendar === 'object') {
    for (const key of ['nodes', 'baseCommands'] as const) {
      const list = (calendar as Record<string, unknown>)[key];
      if (Array.isArray(list)) {
        for (const n of list) {
          const id = n && typeof n === 'object' ? (n as Record<string, unknown>).eventId : undefined;
          if (typeof id === 'string') roots.push(id);
        }
      }
    }
  }
  return roots;
}
