import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  compileScene,
  SourceError,
  parseExpr,
  checkExprOperands,
  checkExprVars,
  parseVariableConfig,
  checkChoiceSuspects,
  collectSceneSpeakers,
  checkConsumedModifiers,
  validateJumpTarget,
  validateSceneVariables,
  validateSwitchTargets,
  collectConfigSceneRoots as collectConfigSceneRootsFromConfigs,
  type CallInstr,
  type CompiledScene,
  type ExprAst,
  type JumpInstr,
} from '@surdet/core';
import type { LintIssue } from '@surdet/core';
import { findGalFiles, sceneIdFromFile } from './scenario-loader.js';

export type { LintIssue } from '@surdet/core';

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

  const { variables, types, readonlyVars, hasConfig, customInstructions, entryScene } = loadVariables(root, issues);

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

  // 跨场景 jump/call 校验 + @scene 一致性 + 变量引用校验
  for (const [sceneId, scene] of scenes) {
    for (const instr of scene.instructions) {
      if (instr.op === 'jump' && instr.kind === 'jump') {
        validateJumpTarget(sceneId, instr as JumpInstr, sceneLabels, failedScenes, issues);
      }
      if (instr.op === 'call') {
        // @call 与 @jump 同等静态校验：目标场景/标签拼错应在 lint 发现，
        // 不拖到运行时 SceneRegistry.resolve 才抛错（AI 批量生成剧本场景需要快速反馈）
        validateJumpTarget(sceneId, instr as CallInstr, sceneLabels, failedScenes, issues, '@call');
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
      if (instr.op === 'instr') {
        checkConsumedModifiers(instr, issues);
      }
    }
    // @switch 目标标签存在性（共享检查，编辑器同用）
    validateSwitchTargets(scene, issues);
    validateSceneVariables(scene, variables, types, readonlyVars, issues, hasConfig);
    checkChoiceSuspects(scene, collectSceneSpeakers(scene), issues);
  }

  // 未使用标签（W006）+ 场景可达性（W007，需配置 entryScene；配置驱动的 hostJump 目标场景也算可达根）
  checkUnusedLabels(scenes, issues);
  checkSceneReachability(scenes, entryScene, collectConfigSceneRoots(root), issues);

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

  // growth.json 非表达式校验（审计轮4）：statGrowth 键必须已声明变量、levelEvents 场景必须存在
  lintGrowthConfig(root, variables, scenes, failedScenes, issues, hasConfig);

  const ok = issues.every((i) => i.severity !== 'error');
  return { issues, sceneCount: sceneSourceFiles.size, ok };
}

/** 加载并校验 game.config.json：variables 声明表 + 声明形状 + customInstructions。
 *  types：变量名 → 声明类型（静态类型检查用）；readonlyVars：声明为 readonly 的变量名。 */
function loadVariables(
  root: string,
  issues: LintIssue[],
): { variables: Set<string>; types: Map<string, string>; readonlyVars: Set<string>; hasConfig: boolean; customInstructions: string[]; entryScene: string | undefined } {
  const cfgPath = path.join(root, 'game.config.json');
  const customInstructions: string[] = [];
  const empty = {
    variables: new Set<string>(),
    types: new Map<string, string>(),
    readonlyVars: new Set<string>(),
    hasConfig: false,
    customInstructions,
    entryScene: undefined as string | undefined,
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

  // 变量表/customInstructions/entryScene 解析与声明形状校验：与编辑器共用的 core 实现
  const parsed = parseVariableConfig(raw, cfgPath, issues);
  return { ...parsed, hasConfig: true };
}

/** W006：标签从未被 @goto/@loop/@switch（场景内）或 @jump/@call 'scene.label'（跨场景）引用 */
function checkUnusedLabels(scenes: Map<string, CompiledScene>, issues: LintIssue[]): void {
  const localRefs = new Map<string, Set<string>>();
  const crossRefs = new Set<string>();
  for (const [sceneId, scene] of scenes) {
    const refs = new Set<string>();
    localRefs.set(sceneId, refs);
    for (const instr of scene.instructions) {
      if (instr.op === 'jump' && instr.kind === 'goto' && instr.target.length > 0) {
        refs.add(instr.target);
      }
      if (instr.op === 'switch') {
        for (const c of instr.cases) refs.add(c.label);
      }
      if ((instr.op === 'jump' && instr.kind === 'jump') || instr.op === 'call') {
        const t = (instr as JumpInstr | CallInstr).target;
        const dot = t.indexOf('.');
        if (dot >= 0) crossRefs.add(t);
      }
    }
  }
  for (const [sceneId, scene] of scenes) {
    const refs = localRefs.get(sceneId)!;
    for (const [label, idx] of scene.labels) {
      if (refs.has(label) || crossRefs.has(`${sceneId}.${label}`)) continue;
      const instr = scene.instructions[idx];
      issues.push({
        severity: 'warning',
        code: 'W006',
        text: `${instr ? `${instr.file}:${instr.line}:${instr.col}: ` : ''}标签 '@label ${label}' 从未被任何 @goto/@loop/@switch/@jump/@call 引用`,
        file: instr?.file ?? '',
        line: instr?.line ?? 0,
        col: instr?.col ?? 0,
      });
    }
  }
}

/** W007：场景可达性——从 entryScene（及配置驱动的 hostJump 目标场景）出发经 @jump/@call 到不了的场景
 *  （通常是删剧情留下的孤儿文件；events/growth/calendar 配置里的宿主跳转场景不算孤儿） */
function checkSceneReachability(
  scenes: Map<string, CompiledScene>,
  entryScene: string | undefined,
  configRoots: readonly string[],
  issues: LintIssue[],
): void {
  if (!entryScene || !scenes.has(entryScene)) return;
  const edges = new Map<string, Set<string>>();
  for (const [sceneId, scene] of scenes) {
    const out = new Set<string>();
    edges.set(sceneId, out);
    for (const instr of scene.instructions) {
      if ((instr.op === 'jump' && instr.kind === 'jump') || instr.op === 'call') {
        const t = (instr as JumpInstr | CallInstr).target;
        const dot = t.indexOf('.');
        out.add(dot >= 0 ? t.slice(0, dot) : t);
      }
    }
  }
  // 可达根 = 入口场景 + 配置驱动的 hostJump 目标场景（events/growth/calendar）
  const roots = [entryScene, ...configRoots.filter((s) => scenes.has(s))];
  const seen = new Set<string>(roots);
  const queue: string[] = [...roots];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of edges.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  for (const [sceneId, scene] of scenes) {
    if (seen.has(sceneId)) continue;
    const first = scene.instructions[0];
    issues.push({
      severity: 'warning',
      code: 'W007',
      text: `${first ? `${first.file}: ` : ''}场景 '${sceneId}' 从入口场景 '${entryScene}' 不可达（无 @jump/@call 引用）`,
      file: first?.file ?? '',
      line: first?.line ?? 0,
      col: first?.col ?? 0,
    });
  }
}

// 场景级纯校验函数已下沉 @surdet/core/scene-lint（CLI 与编辑器共用，消除双源漂移）


/**
 * content/config/*.json 内 DSL 表达式的声明式扫描表。
 * 新增配置文件只需在此加一条（file + 表达式提取器 + 可选内建变量豁免）。
 * 当前覆盖：calendar.json nodes[].visibleWhen + baseCommands[].when、
 * combat.json damage.base（内建 atk/def/power）、events.json events[].when、
 * ngp.json clearCondition、achievements.json [].when。
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
      const exprs: string[] = [];
      const nodes = cfg['nodes'];
      if (Array.isArray(nodes)) {
        exprs.push(
          ...nodes
            .filter((n): n is Record<string, unknown> => !!n && typeof n === 'object')
            .map((n) => n['visibleWhen'])
            .filter((v): v is string => typeof v === 'string'),
        );
      }
      // 据点指令 when（数据驱动据点命令的触发条件）
      const cmds = cfg['baseCommands'];
      if (Array.isArray(cmds)) {
        exprs.push(
          ...cmds
            .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
            .map((c) => c['when'])
            .filter((v): v is string => typeof v === 'string'),
        );
      }
      return exprs;
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
  {
    file: 'achievements.json',
    extract: (cfg) => {
      // achievements.json 是顶层数组（非对象）：runConfigLint 已把数组原样传入
      const defs = Array.isArray(cfg) ? cfg : [];
      return defs
        .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
        .map((d) => d['when'])
        .filter((w): w is string => typeof w === 'string' && w.length > 0);
    },
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

/** 收集 content/config/*.json 中配置驱动的 hostJump 目标场景（W007 可达性额外根）。
 *  收集逻辑为 core 共享纯实现（编辑器同源复用，审计轮4 下沉）；本函数只负责文件读取。 */
function collectConfigSceneRoots(root: string): string[] {
  const configDir = path.join(root, 'content/config');
  const read = (name: string): unknown => {
    const full = path.join(configDir, name);
    if (!fs.existsSync(full)) return null;
    try {
      return JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      return null; // 解析失败由 CONFIG 校验报告，此处不重复报
    }
  };
  return collectConfigSceneRootsFromConfigs({
    events: read('events.json'),
    growth: read('growth.json'),
    calendar: read('calendar.json'),
  });
}

/** growth.json 校验（非表达式；审计轮4）：statGrowth 键必须已声明变量（V002）；levelEvents 场景必须存在（J001） */
function lintGrowthConfig(
  root: string,
  variables: Set<string>,
  scenes: Map<string, CompiledScene>,
  failedScenes: Set<string>,
  issues: LintIssue[],
  hasConfig: boolean,
): void {
  const full = path.join(root, 'content/config/growth.json');
  if (!fs.existsSync(full)) return;
  let cfg: unknown;
  try {
    cfg = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return; // 解析失败由 CONFIG 校验报告
  }
  const rel = path.join('content/config', 'growth.json');
  const profiles = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? (cfg as Record<string, unknown>).profiles : undefined;
  if (!Array.isArray(profiles)) return;
  for (const p of profiles) {
    if (!p || typeof p !== 'object') continue;
    const prof = p as Record<string, unknown>;
    const charId = typeof prof.characterId === 'string' ? prof.characterId : '?';
    const statGrowth = prof.statGrowth;
    if (hasConfig && variables.size > 0 && statGrowth && typeof statGrowth === 'object' && !Array.isArray(statGrowth)) {
      for (const varName of Object.keys(statGrowth as Record<string, unknown>)) {
        if (!variables.has(varName)) {
          issues.push({
            severity: 'error',
            code: 'V002',
            text: `${rel}: profiles[${charId}].statGrowth 引用未声明变量 '${varName}'（升级写回会运行时报错，请先在 game.config.json 声明）`,
            file: rel,
            line: 0,
            col: 0,
          });
        }
      }
    }
    const levelEvents = prof.levelEvents;
    if (levelEvents && typeof levelEvents === 'object' && !Array.isArray(levelEvents)) {
      for (const [level, sceneId] of Object.entries(levelEvents as Record<string, unknown>)) {
        if (typeof sceneId !== 'string') continue;
        if (!scenes.has(sceneId) && !failedScenes.has(sceneId)) {
          issues.push({
            severity: 'error',
            code: 'J001',
            text: `${rel}: profiles[${charId}].levelEvents[${level}] 目标场景 '${sceneId}' 不存在`,
            file: rel,
            line: 0,
            col: 0,
          });
        }
      }
    }
  }
}

