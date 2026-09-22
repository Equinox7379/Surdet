/**
 * surdet audit：AI 生产线内容审计与无头验收（自我迭代 第二梯队④）。
 *  1. 称谓一致性：说话人疑似笔误（编辑距离 1）与称谓变体（前缀包含）检测
 *  2. 设定名词表：content/config/terminology.json 声明规范词/变体，扫描违规使用
 *  3. 分支分析：choice 目标块行数过少的"空心分支"、无出口场景
 *  4. 节奏报告：每场景行数/字数/选择肢数/预计阅读时长
 *  5. 无头试跑：解释器从 entryScene 自动推进（文本→推进、选择→第一项、wait→立即结束、
 *     遇系统指令停止），把运行时错误拦在发布前——AI 批量产内容的验收闸门。
 *  纯分析函数不依赖 fs，可单测；cmdAudit 负责读盘与输出。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  compileScene,
  parseVariableConfig,
  Interpreter,
  SceneRegistry,
  EventBus,
  VariableStore,
  SourceError,
  levenshtein,
  auditSpeakers,
  auditTerminology,
  parseTerminology,
} from '@surdet/core';
import type { CompiledScene, CoreEventMap, ChoiceEventPayload, VarDeclaration, AuditFinding, TerminologyTerm } from '@surdet/core';
import type { VarType, VarValue } from '@surdet/core';
import { findGalFiles, sceneIdFromFile } from './scenario-loader.js';
import { lintProject } from './lint.js';

// 术语审计纯逻辑已下沉 core（编辑器术语面板共用同一实现）；此处重导出保持既有导入路径兼容
export { levenshtein, auditSpeakers, auditTerminology, parseTerminology };
export type { AuditFinding, TerminologyTerm };

export interface SceneStat {
  id: string;
  textLines: number;
  chars: number;
  choices: number;
  outEdges: number;
}

export interface AuditResult {
  findings: AuditFinding[];
  stats: SceneStat[];
  totals: { scenes: number; textLines: number; chars: number; choices: number; readingMin: number };
}

export interface AuditSourceEntry {
  id: string;
  file: string;
  source: string;
}

export function compileAuditEntries(
  entries: readonly AuditSourceEntry[],
  customInstructions: readonly string[],
): {
  compiled: Map<string, CompiledScene>;
  sceneSources: Map<string, string>;
  errors: Array<{ file: string; message: string }>;
} {
  const compiled = new Map<string, CompiledScene>();
  const sceneSources = new Map<string, string>();
  const errors: Array<{ file: string; message: string }> = [];
  for (const entry of entries) {
    if (compiled.has(entry.id)) continue;
    try {
      const scene = compileScene(entry.source, entry.file, entry.id, customInstructions);
      compiled.set(entry.id, scene);
      sceneSources.set(entry.id, entry.source);
    } catch (err) {
      errors.push({
        file: entry.file,
        message: err instanceof SourceError ? err.message : String(err),
      });
    }
  }
  return { compiled, sceneSources, errors };
}

/** 分支与出口分析：空心分支（goto 目标块文本少于 2 行）与无出口场景。
 *  sources 提供时 NO_EXIT 按源码是否含 '@end' 判断（编译器自动给每个场景追加 end 指令，编译产物无法区分显式/自动）。 */
export function auditBranches(compiled: Map<string, CompiledScene>, entryScene: string | undefined, sources?: Map<string, string>): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const [sceneId, scene] of compiled) {
    // 空心分支：选项块内的首个 @goto 目标起、到下一个 label/jump/end/choice 之间的文本行数。
    // （编译后选项不带 jump 字段——跳转指令被编入选项块 blockStart 之后）
    for (const instr of scene.instructions) {
      if (instr.op !== 'choice') continue;
      const choice = instr as { afterIndex: number };
      for (const opt of instr.options) {
        let gotoTarget: string | null = null;
        const end = choice.afterIndex >= 0 ? choice.afterIndex : scene.instructions.length;
        for (let k = opt.blockStart; k < end; k++) {
          const nx = scene.instructions[k]!;
          if (nx.op === 'jump' && nx.kind === 'goto') { gotoTarget = nx.target; break; }
          if (nx.op === 'jump' && nx.kind === 'jump') break; // 跨场景分支：交给 NO_EXIT/节奏统计
        }
        if (gotoTarget === null) continue;
        const start = scene.labels.get(gotoTarget);
        if (start === undefined) continue; // 目标缺失由 lint 负责报
        let textCount = 0;
        for (let k = start + 1; k < scene.instructions.length; k++) {
          const nx = scene.instructions[k]!;
          if (nx.op === 'label' || nx.op === 'jump' || nx.op === 'end' || nx.op === 'choice') break;
          if (nx.op === 'text') textCount++;
        }
        if (textCount < 2) {
          findings.push({
            severity: 'warning',
            code: 'BRANCH_THIN',
            text: `${instr.file}:${instr.line}: 选项 '${opt.label}' 跳转的分支内容仅 ${textCount} 行文本，疑似空心分支（AI 生成漏写？目标 @label ${gotoTarget}）`,
            file: instr.file,
            line: instr.line,
          });
        }
      }
    }
    // 无出口场景：既无 @end 也无 @jump/@call（除入口外提示检查）
    const src = sources?.get(sceneId);
    const hasEnd = src !== undefined ? src.includes('@end') : scene.instructions.some((i) => i.op === 'end');
    const outEdges = scene.instructions.filter((i) => (i.op === 'jump' && i.kind === 'jump') || i.op === 'call').length;
    if (!hasEnd && outEdges === 0 && sceneId !== entryScene && compiled.size > 1) {
      const first = scene.instructions[0];
      findings.push({
        severity: 'info',
        code: 'NO_EXIT',
        text: `场景 '${sceneId}' 既无 @end 也无 @jump/@call 出口（文本播完即 sceneEnd；若非尾场景请检查衔接）`,
        file: first?.file ?? sceneId,
        line: first?.line ?? 0,
      });
    }
  }
  return findings;
}

/** 节奏统计：行数/字数/选择肢/出口数 + 预计阅读时长（按 300 字/分钟） */
export function auditStats(compiled: Map<string, CompiledScene>): { stats: SceneStat[]; totals: AuditResult['totals'] } {
  const stats: SceneStat[] = [];
  for (const [id, scene] of compiled) {
    let textLines = 0;
    let chars = 0;
    let choices = 0;
    let outEdges = 0;
    for (const instr of scene.instructions) {
      if (instr.op === 'text') {
        textLines++;
        chars += instr.value.length;
      } else if (instr.op === 'choice') {
        choices++;
      } else if ((instr.op === 'jump' && instr.kind === 'jump') || instr.op === 'call') {
        outEdges++;
      }
    }
    stats.push({ id, textLines, chars, choices, outEdges });
  }
  const totals = {
    scenes: stats.length,
    textLines: stats.reduce((s, x) => s + x.textLines, 0),
    chars: stats.reduce((s, x) => s + x.chars, 0),
    choices: stats.reduce((s, x) => s + x.choices, 0),
    readingMin: Math.round((stats.reduce((s, x) => s + x.chars, 0) / 300) * 10) / 10,
  };
  return { stats, totals };
}

/** 汇总审计（纯函数入口，供测试与 cmdAudit 共用） */
export function auditScenes(
  compiled: Map<string, CompiledScene>,
  terminology: TerminologyTerm[],
  entryScene: string | undefined,
  speakerFirstSeen: Map<string, { file: string; line: number }>,
  speakerCounts: Map<string, number>,
  sources?: Map<string, string>,
): AuditResult {
  const findings: AuditFinding[] = [
    ...auditSpeakers(speakerCounts, (sp) => speakerFirstSeen.get(sp) ?? { file: '', line: 0 }),
    ...auditTerminology(compiled, terminology),
    ...auditBranches(compiled, entryScene, sources),
  ];
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : a.severity === 'warning' ? -1 : 1));
  const { stats, totals } = auditStats(compiled);
  return { findings, stats, totals };
}

/* ============================ 无头试跑（验收闸门） ============================ */

export interface DryRunResult {
  steps: number;
  choicesTaken: number;
  scenesEnded: string[];
  stopped: 'ended' | 'system' | 'step-limit' | 'stall';
  finalStatus: string;
  finalScene: string | null;
  error: string | null;
}

/**
 * 无头自动推进：从 entryScene 出发一路自动播放（选择肢取过滤后的第一项、@wait 立即结束），
 * 遇到系统指令（@battle/@shop/@calendar 等宿主交互）停止并记为 system。
 * 运行时抛错（坏表达式/坏跳转/状态机异常）→ stall + error，作为验收失败项。
 */
export function dryRunProject(
  registry: SceneRegistry,
  store: VariableStore,
  entryScene: string,
  maxSteps = 5000,
): DryRunResult {
  const bus = new EventBus<CoreEventMap>();
  const interp = new Interpreter(store, bus, registry);
  let hitSystem = false;
  // 对象包装：事件回调内的赋值不被 TS 控制流分析跟踪，直接 let 会被永久窄化为 null
  const choiceState: { payload: ChoiceEventPayload | null } = { payload: null };
  const scenesEnded: string[] = [];
  bus.on('system', () => { hitSystem = true; });
  bus.on('choice', (p) => { choiceState.payload = p; });
  bus.on('sceneEnd', (p) => { scenesEnded.push(p.sceneId); });

  const finish = (stopped: DryRunResult['stopped'], error: string | null, steps: number, choices: number): DryRunResult => ({
    steps,
    choicesTaken: choices,
    scenesEnded,
    stopped,
    finalStatus: interp.status,
    finalScene: interp.saveSnapshot()?.position?.sceneId ?? null,
    error,
  });

  let steps = 0;
  let choices = 0;
  try {
    interp.start(entryScene);
    while (steps < maxSteps) {
      steps++;
      if (hitSystem) return finish('system', null, steps, choices);
      const st = interp.status;
      if (st === 'ended') return finish('ended', null, steps, choices);
      if (st === 'awaiting-advance') { interp.advance(); continue; }
      if (st === 'awaiting-timer') { interp.finishWait(); continue; }
      if (st === 'awaiting-choice') {
        const opts = choiceState.payload?.options ?? [];
        if (opts.length === 0) return finish('stall', '选择肢全部被条件过滤，自动试跑无法选择（参考 W005）', steps, choices);
        choiceState.payload = null;
        interp.choose(opts[0]!.index);
        choices++;
        continue;
      }
      if (st === 'paused') return finish('system', null, steps, choices);
      return finish('stall', `意外状态 '${st}'，自动试跑无法推进`, steps, choices);
    }
    return finish('step-limit', null, steps, choices);
  } catch (err) {
    const msg = err instanceof SourceError ? err.message : String(err);
    return finish('stall', msg, steps, choices);
  }
}

/** 从 game.config 原始对象构建变量声明（无头试跑的 VariableStore 用；非法声明宽容跳过） */
export function declsFromConfig(raw: Record<string, unknown>): VarDeclaration[] {
  const out: VarDeclaration[] = [];
  const vars = raw['variables'];
  if (typeof vars !== 'object' || vars === null || Array.isArray(vars)) return out;
  for (const [name, decl] of Object.entries(vars)) {
    if (typeof decl !== 'object' || decl === null) continue;
    const d = decl as Record<string, unknown>;
    const type = d['type'];
    if (type !== 'number' && type !== 'string' && type !== 'boolean' && type !== 'flag'
      && type !== 'string[]' && type !== 'number[]' && type !== 'object') continue;
    if (!('initial' in d)) continue;
    out.push({
      name,
      type: type as VarType,
      initial: d['initial'] as VarValue,
      readonly: d['readonly'] === true,
      min: typeof d['min'] === 'number' ? d['min'] : undefined,
      max: typeof d['max'] === 'number' ? d['max'] : undefined,
    });
  }
  return out;
}

/* ============================ CLI 命令 ============================ */

/** 读取 content/config/terminology.json（可选文件；形状非法给提示不阻断；解析逻辑在 core parseTerminology） */
function loadTerminology(root: string, warn: (msg: string) => void): TerminologyTerm[] {
  const file = path.join(root, 'content/config/terminology.json');
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
    if (!Array.isArray(raw.terms)) {
      warn(`${file}: 'terms' 必须是数组（{ canonical, variants[] } 列表），已跳过名词表检查`);
      return [];
    }
    return parseTerminology(raw);
  } catch (err) {
    warn(`${file}: 解析失败（${err instanceof Error ? err.message : String(err)}），已跳过名词表检查`);
    return [];
  }
}

export async function cmdAudit(dir: string, opts: { noRun?: boolean }): Promise<number> {
  const out = process.stdout;
  const write = (s: string): void => { out.write(s); };

  // 第一关：lint（结构/引用完整性）——有 error 直接失败，不做内容审计（在坏地基上审计无意义）
  const lint = lintProject(dir);
  const lintErrors = lint.issues.filter((i) => i.severity === 'error');
  if (lintErrors.length > 0) {
    for (const issue of lintErrors) write(`✗ ${issue.text}\n`);
    write(`\n内容审计中止：先修复以上 ${lintErrors.length} 个 lint 错误\n`);
    return 1;
  }

  // 编译全部场景 + 配置
  const files = findGalFiles(path.join(dir, 'content/scenario'));
  const cfgPath = path.join(dir, 'game.config.json');
  let configRaw: Record<string, unknown> = {};
  if (fs.existsSync(cfgPath)) {
    try {
      configRaw = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
    } catch {
      write(`⚠ game.config.json 解析失败：变量/customInstructions/entryScene 按缺省处理\n`);
    }
  }
  const cfgIssues: { text: string }[] = [];
  const parsedCfg = parseVariableConfig(configRaw, 'game.config.json', cfgIssues as never);
  for (const i of cfgIssues) write(`⚠ ${i.text}\n`);
  const entryScene = typeof configRaw['entryScene'] === 'string' ? configRaw['entryScene'] : undefined;

  const entries: AuditSourceEntry[] = [];
  for (const file of files) {
    entries.push({
      id: sceneIdFromFile(file),
      file,
      source: fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
    });
  }
  const { compiled, sceneSources, errors } = compileAuditEntries(entries, parsedCfg.customInstructions);
  if (errors.length > 0) {
    for (const error of errors) write(`✗ ${error.file}: ${error.message}\n`);
    return 1;
  }

  const speakerCounts = new Map<string, number>();
  const speakerFirstSeen = new Map<string, { file: string; line: number }>();
  for (const scene of compiled.values()) {
    for (const instr of scene.instructions) {
      if (instr.op === 'text' && instr.speaker) {
        speakerCounts.set(instr.speaker, (speakerCounts.get(instr.speaker) ?? 0) + 1);
        if (!speakerFirstSeen.has(instr.speaker)) speakerFirstSeen.set(instr.speaker, { file: instr.file, line: instr.line });
      }
    }
  }

  // 第二关：内容审计
  const terminology = loadTerminology(dir, (m) => write(`⚠ ${m}\n`));
  const audit = auditScenes(compiled, terminology, entryScene, speakerFirstSeen, speakerCounts, sceneSources);
  for (const f of audit.findings) {
    const badge = f.severity === 'warning' ? '⚠' : 'ℹ';
    write(`${badge} [${f.code}] ${f.text}\n`);
  }

  // 节奏报告
  write(`\n—— 节奏报告 ——\n`);
  write(`场景 ${audit.totals.scenes} · 文本 ${audit.totals.textLines} 行 · ${audit.totals.chars} 字 · 选择肢 ${audit.totals.choices} 处 · 预计阅读 ${audit.totals.readingMin} 分钟\n`);
  for (const s of [...audit.stats].sort((a, b) => b.chars - a.chars)) {
    write(`  ${s.id.padEnd(20)} ${String(s.textLines).padStart(4)} 行 ${String(s.chars).padStart(6)} 字 ${String(s.choices).padStart(2)} 选择\n`);
  }

  // 第三关：无头试跑验收
  if (opts.noRun) {
    write(`\n跳过无头试跑（--no-run）\n`);
    return 0;
  }
  if (!entryScene || !compiled.has(entryScene)) {
    write(`\n⚠ 未配置有效 entryScene（game.config.json），跳过无头试跑\n`);
    return 0;
  }
  const registry = new SceneRegistry();
  for (const scene of compiled.values()) registry.register(scene);
  const store = new VariableStore(declsFromConfig(configRaw));
  const run = dryRunProject(registry, store, entryScene);
  const label: Record<DryRunResult['stopped'], string> = {
    ended: '到达 @end（剧情线播完）',
    system: '到达系统交互指令（@battle/@shop/@calendar 等，宿主交互区——ADV 链路健康）',
    'step-limit': '达到步数上限（疑似循环，检查 @loop/@goto）',
    stall: '异常停滞',
  };
  write(`\n—— 无头试跑 ——\n`);
  write(`推进 ${run.steps} 步 · 选择 ${run.choicesTaken} 次 · 结局场景 [${run.scenesEnded.join(', ') || '-'}] · 终点 ${run.finalScene ?? '-'}（${run.finalStatus}）\n`);
  write(`结果：${label[run.stopped]}\n`);
  if (run.error) {
    write(`✗ 试跑错误：${run.error}\n`);
    return 1;
  }
  if (run.stopped === 'step-limit') return 1;
  return 0;
}
