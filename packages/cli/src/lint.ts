import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  compileScene,
  SourceError,
  isVarType,
  VAR_TYPES,
  parseExpr,
  collectVars,
  type ChoiceInstr,
  type CompiledScene,
  type CondJumpInstr,
  type ExprAst,
  type GenericInstr,
  type JumpInstr,
  type ModifyInstr,
  type SetInstr,
  type TextInstr,
} from '@surdet/core';
import { findGalFiles, sceneIdFromFile } from './scenario-loader.js';

/** lint 输出的一行问题 */
export interface LintIssue {
  severity: 'error' | 'warning';
  /** 完整展示文本（含 file:line:col） */
  text: string;
  code: string;
  file: string;
  line: number;
  col: number;
}

export interface LintResult {
  issues: LintIssue[];
  sceneCount: number;
  ok: boolean;
}

/**
 * 项目内容静态校验：
 *  1. 每个 .gal 场景：语法 / if 结构 / 表达式语法 / 标签 / goto 目标
 *  2. 跨场景 @jump 目标场景与标签存在性
 *  3. @scene 声明与文件名一致
 *  4. game.config.json：variables 声明形状校验 + 变量交叉校验（赋值目标与表达式引用）
 *  5. 场景 ID 重复检测
 *  6. 表达式静态类型检查（@set 类型匹配 / 条件必须 boolean / 运算符操作数类型）
 */
export function lintProject(root: string, scenarioDir = 'content/scenario'): LintResult {
  const dir = path.join(root, scenarioDir);
  const files = findGalFiles(dir);
  const issues: LintIssue[] = [];
  const scenes = new Map<string, CompiledScene>();
  const sceneLabels = new Map<string, Set<string>>();

  const { variables, types, readonlyVars, hasConfig, customInstructions } = loadVariables(root, issues);

  // 场景 ID → 首个源文件（LINT_DUP 报告冲突根因用；场景 ID = 文件名去扩展名）
  const sceneSourceFiles = new Map<string, string>();
  // 编译失败（语法/结构错误）的场景：登记以便 jump 校验给 J003 而非误报 J001
  const failedScenes = new Set<string>();

  for (const file of files) {
    const sceneId = sceneIdFromFile(file);
    const firstFile = sceneSourceFiles.get(sceneId);
    if (firstFile !== undefined) {
      issues.push({
        severity: 'error',
        code: 'LINT_DUP',
        text: `${file}: 场景 ID '${sceneId}' 与 ${firstFile} 重复（场景 ID = 文件名去扩展名，子目录下同名文件同样冲突；场景 ID 必须全局唯一）`,
        file,
        line: 0,
        col: 0,
      });
      continue;
    }
    if (sceneId.includes('.')) {
      issues.push({
        severity: 'error',
        code: 'SCENE_ID',
        text: `${file}: 场景 ID '${sceneId}' 含点号，会破坏 @jump 目标寻址（sceneId.label 按第一个点切分），请重命名文件`,
        file,
        line: 0,
        col: 0,
      });
    }

    const source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    try {
      const scene = compileScene(source, file, sceneId, customInstructions);
      sceneSourceFiles.set(sceneId, file);
      scenes.set(sceneId, scene);
      sceneLabels.set(sceneId, new Set(scene.labels.keys()));
      for (const d of scene.diagnostics) {
        issues.push({
          severity: 'warning',
          text: `${d.file}:${d.line}:${d.col}: ${d.message}${d.hint ? `（${d.hint}）` : ''} [${d.code}]`,
          code: d.code,
          file: d.file,
          line: d.line,
          col: d.col,
        });
      }
    } catch (err) {
      // 编译失败：登记场景存在（避免后续 @jump 误报 J001"目标场景不存在"，掩盖真正的编译错误）。
      // 失败场景同样计入 sceneCount / LINT_DUP 冲突判定（文件确实存在）。
      failedScenes.add(sceneId);
      sceneSourceFiles.set(sceneId, file);
      sceneLabels.set(sceneId, new Set());
      // SourceError 统一携带位置与错误码（DslError/LexError/RuntimeError 皆继承自它）
      if (err instanceof SourceError) {
        const p = err.pos;
        issues.push({
          severity: 'error',
          text: err.message,
          code: err.code ?? 'LINT',
          file: p?.file ?? file,
          line: p?.line ?? 0,
          col: p?.col ?? 0,
        });
      } else if (err instanceof Error) {
        issues.push({ severity: 'error', text: err.message, code: 'LINT', file, line: 0, col: 0 });
      } else {
        issues.push({ severity: 'error', text: String(err), code: 'LINT', file, line: 0, col: 0 });
      }
    }
  }

  // 跨场景 jump 校验 + @scene 一致性 + 变量引用校验
  for (const [sceneId, scene] of scenes) {
    for (const instr of scene.instructions) {
      if (instr.op === 'jump' && instr.kind === 'jump') {
        validateJumpTarget(sceneId, instr as JumpInstr, sceneLabels, failedScenes, issues);
      }
      if (instr.op === 'instr' && instr.name === 'scene') {
        const declared = instr.args[0];
        if (declared !== undefined && declared !== sceneId) {
          issues.push({
            severity: 'error',
            code: 'SCENE_ID',
            text: `${instr.file}:${instr.line}:${instr.col}: @scene 声明 '${declared}' 与文件名推导的场景 ID '${sceneId}' 不一致`,
            file: instr.file,
            line: instr.line,
            col: instr.col,
          });
        }
      }
    }
    validateSceneVariables(scene, variables, types, readonlyVars, issues, hasConfig);
  }

  if (hasConfig && variables.size === 0) {
    issues.push({
      severity: 'warning',
      code: 'EMPTY_VARIABLES',
      text: `${path.join(root, 'game.config.json')}: variables 为空，变量声明校验被跳过`,
      file: path.join(root, 'game.config.json'),
      line: 0,
      col: 0,
    });
  } else if (!hasConfig && files.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'NO_CONFIG',
      text: `${path.join(root, 'game.config.json')}: 未找到 game.config.json，跳过变量声明校验（@set/@mod/@if 引用未声明变量将不在 lint 暴露）`,
      file: path.join(root, 'game.config.json'),
      line: 0,
      col: 0,
    });
  }

  // content/config/*.json 内 DSL 表达式校验（visibleWhen/伤害公式/when/clearCondition）
  lintConfigExpressions(root, variables, types, issues, hasConfig);

  const ok = issues.every((i) => i.severity !== 'error');
  return { issues, sceneCount: sceneSourceFiles.size, ok };
}

/** 加载并校验 game.config.json：variables 声明表 + 声明形状 + customInstructions。
 *  types：变量名 → 声明类型（静态类型检查用）；readonlyVars：声明为 readonly 的变量名。 */
function loadVariables(
  root: string,
  issues: LintIssue[],
): { variables: Set<string>; types: Map<string, string>; readonlyVars: Set<string>; hasConfig: boolean; customInstructions: string[] } {
  const cfgPath = path.join(root, 'game.config.json');
  const customInstructions: string[] = [];
  const empty = {
    variables: new Set<string>(),
    types: new Map<string, string>(),
    readonlyVars: new Set<string>(),
    hasConfig: false,
    customInstructions,
  };

  if (!fs.existsSync(cfgPath)) {
    return empty;
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch (err) {
    issues.push({
      severity: 'error',
      code: 'CONFIG',
      text: `${cfgPath}: game.config.json 解析失败：${err instanceof Error ? err.message : String(err)}`,
      file: cfgPath,
      line: 0,
      col: 0,
    });
    return { ...empty, hasConfig: true };
  }

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

  const variablesRaw = raw['variables'];
  // variables 字段缺失 → 视为空表（lintProject 统一发 EMPTY_VARIABLES 警告）
  if (variablesRaw === undefined) {
    return { variables: new Set(), types: new Map(), readonlyVars: new Set(), hasConfig: true, customInstructions };
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
    return { variables: new Set(), types: new Map(), readonlyVars: new Set(), hasConfig: true, customInstructions };
  }

  const variables = new Set<string>();
  const types = new Map<string, string>();
  const readonlyVars = new Set<string>();
  for (const [name, decl] of Object.entries(variablesRaw)) {
    variables.add(name);
    if (validateVarDecl(cfgPath, name, decl, issues) && typeof decl === 'object' && decl !== null) {
      types.set(name, (decl as { type: string }).type);
      if ((decl as { readonly?: boolean }).readonly === true) readonlyVars.add(name);
    }
  }
  return { variables, types, readonlyVars, hasConfig: true, customInstructions };
}

/** 校验单个变量声明条目形状：type 合法 + initial 存在且类型匹配。合法返回 true。 */
function validateVarDecl(cfgPath: string, name: string, decl: unknown, issues: LintIssue[]): boolean {
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
  if (!initialMatches(type, initial)) {
    issues.push({
      severity: 'error',
      code: 'VAR_DECL',
      text: `${cfgPath}: 变量 '${name}' 的 initial 与 type '${type}' 不匹配（得到 ${JSON.stringify(initial)}）`,
      file: cfgPath,
      line: 0,
      col: 0,
    });
    return false;
  }
  return true;
}

function initialMatches(type: string, initial: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof initial === 'string';
    case 'number':
      return typeof initial === 'number' && Number.isFinite(initial);
    case 'boolean':
    case 'flag':
      return typeof initial === 'boolean';
    case 'string[]':
      return Array.isArray(initial) && initial.every((v) => typeof v === 'string');
    case 'number[]':
      return Array.isArray(initial) && initial.every((v) => typeof v === 'number' && Number.isFinite(v));
    case 'object':
      return typeof initial === 'object' && initial !== null && !Array.isArray(initial);
    default:
      return false;
  }
}

/** 变量声明交叉校验：赋值目标 + 表达式引用 + 表达式静态类型检查 + readonly 写入 */
function validateSceneVariables(
  scene: CompiledScene,
  variables: Set<string>,
  types: Map<string, string>,
  readonlyVars: Set<string>,
  issues: LintIssue[],
  hasConfig: boolean,
): void {
  if (!hasConfig || variables.size === 0) return;

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
const VARIABLE_INSTRUCTIONS = new Set(['inc', 'dec', 'toggle', 'flag', 'unflag']);

/** 提取文本行内 {var} 插值变量（与 interpolate 规则一致：{{ 转义跳过；非法名不匹配）。 */
function collectInterpolatedVars(text: string): string[] {
  const out: string[] = [];
  const re = /\{\{|\}\}|\{([A-Za-z_\u0080-\uffff][A-Za-z0-9_$.\u0080-\uffff]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
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

/**
 * content/config/*.json 内 DSL 表达式的声明式扫描表。
 * 新增配置文件只需在此加一条（file + 表达式提取器 + 可选内建变量豁免）。
 * 当前覆盖：calendar.json nodes[].visibleWhen、combat.json damage.base（内建 atk/def/power）、
 * events.json events[].when、ngp.json clearCondition。
 */
interface ConfigExprScan {
  file: string;
  /** 该文件表达式可用的内建变量（无需在 game.config.json 声明） */
  extraAllowed?: readonly string[];
  /** 从解析后的 JSON 提取待校验的表达式字符串 */
  extract: (cfg: Record<string, unknown>) => string[];
}

const CONFIG_EXPR_SCANS: readonly ConfigExprScan[] = [
  {
    file: 'calendar.json',
    extract: (cfg) => {
      const nodes = cfg['nodes'];
      if (!Array.isArray(nodes)) return [];
      return nodes
        .filter((n): n is Record<string, unknown> => !!n && typeof n === 'object')
        .map((n) => n['visibleWhen'])
        .filter((v): v is string => typeof v === 'string');
    },
  },
  {
    file: 'combat.json',
    extraAllowed: ['atk', 'def', 'power'],
    extract: (cfg) => {
      const damage = cfg['damage'];
      if (!damage || typeof damage !== 'object') return [];
      const base = (damage as Record<string, unknown>)['base'];
      return typeof base === 'string' ? [base] : [];
    },
  },
  {
    file: 'events.json',
    extract: (cfg) => {
      const events = cfg['events'];
      if (!Array.isArray(events)) return [];
      return events
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
        .map((e) => e['when'])
        .filter((v): v is string => typeof v === 'string');
    },
  },
  {
    file: 'ngp.json',
    extract: (cfg) => (typeof cfg['clearCondition'] === 'string' ? [cfg['clearCondition'] as string] : []),
  },
];

/**
 * 校验 content/config/*.json 内的 DSL 表达式（见 CONFIG_EXPR_SCANS）。
 * 语法错误报 CONFIG_EXPR；有声明表时做变量引用（V002）与操作数类型（T003）校验。
 */
function lintConfigExpressions(
  root: string,
  variables: Set<string>,
  types: Map<string, string>,
  issues: LintIssue[],
  hasConfig: boolean,
): void {
  const configDir = path.join(root, 'content/config');
  if (!fs.existsSync(configDir)) return;
  const at = (file: string): { file: string; line: number; col: number } => ({ file, line: 0, col: 0 });

  const check = (expr: string, file: string, extraAllowed: readonly string[] = []): void => {
    let ast: ExprAst;
    try {
      ast = parseExpr(expr);
    } catch {
      issues.push({
        severity: 'error',
        code: 'CONFIG_EXPR',
        text: `${file}: 配置表达式语法错误：'${expr}'（见 docs/dsl-spec.md 表达式语言）`,
        file,
        line: 0,
        col: 0,
      });
      return;
    }
    if (!hasConfig || variables.size === 0) return;
    const allowed = new Set([...types.keys(), ...extraAllowed]);
    checkExprVars(expr, at(file), allowed, issues);
    checkExprOperands(ast, types, (code, message) => {
      issues.push({
        severity: 'error',
        code,
        text: `${file}: ${message}（表达式 '${expr}'）`,
        file,
        line: 0,
        col: 0,
      });
    });
  };

  for (const scan of CONFIG_EXPR_SCANS) {
    const cfg = readConfigJson(configDir, scan.file, issues);
    if (!cfg) continue;
    const rel = path.join('content/config', scan.file);
    for (const expr of scan.extract(cfg)) {
      check(expr, rel, scan.extraAllowed);
    }
  }
}

function readConfigJson(
  dir: string,
  name: string,
  issues: LintIssue[],
): Record<string, unknown> | null {
  const full = path.join(dir, name);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch (err) {
    issues.push({
      severity: 'error',
      code: 'CONFIG',
      text: `${full}: JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
      file: full,
      line: 0,
      col: 0,
    });
    return null;
  }
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
function checkExprOperands(
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

function checkExprVars(
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

function validateJumpTarget(
  fromScene: string,
  jump: JumpInstr,
  sceneLabels: Map<string, Set<string>>,
  failedScenes: Set<string>,
  issues: LintIssue[],
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
    });
    return;
  }

  const labels = sceneLabels.get(targetScene);
  if (labels === undefined) {
    issues.push({
      severity: 'error',
      code: 'J001',
      text: `${at}: 跨场景跳转目标场景 '${targetScene}' 不存在（@jump 目标必须已实现）`,
      file: jump.file,
      line: jump.line,
      col: jump.col,
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
    });
  }
}
