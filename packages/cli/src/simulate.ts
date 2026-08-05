/**
 * surdet simulate —— Headless 自动模拟测试（差异化支柱 2）。
 *
 * core 完全 headless = 可以无渲染跑完整个游戏。本命令：
 *  - 自动遍历：解释器驱动全部场景，文本/wait 自动快进，choice 全分支 DFS 枚举（路径预算内）
 *  - 已访问剪枝：(定位, 变量) 状态签名去重，循环剧情自然收敛不爆炸
 *  - 存档往返冒烟：choice 分支经 saveSnapshot/loadSnapshot 走存档机制（天然验证快照一致性）
 *  - 产出报告：分支覆盖率 / 结局可达性 / 死路场景 / 运行时错误 / 循环剪枝次数
 *
 * 与 audit 的 dryRun（单路径、首选选项、遇宿主指令即停）互补：simulate 穿透宿主指令
 * （无宿主时 @battle/@calendar 等只是事件，直接继续），探索全部分支。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  compileScene,
  SourceError,
  VariableStore,
  SceneRegistry,
  Interpreter,
  EventBus,
  GrowthSystem,
} from '@surdet/core';
import type { CoreEventMap, VarValue, GrowthConfig } from '@surdet/core';
import { findGalFiles, sceneIdFromFile } from './scenario-loader.js';
import { declsFromConfig } from './audit.js';

export interface SimulateOptions {
  /** 路径预算（缺省 500）：choice 组合是乘积增长，超预算停止展开新路径 */
  maxPaths?: number;
  /** 单条路径步数上限（缺省 20000）：超出记"疑似死循环" */
  maxStepsPerPath?: number;
  /** 开局变量注入（宿主才能设置的变量，如 battleWon=true），值按 boolean/number/string 解析 */
  assume?: Record<string, string>;
}

export interface SimulateReport {
  entryScene: string;
  sceneCount: number;
  pathsExplored: number;
  pathBudget: number;
  budgetExhausted: boolean;
  /** choice 分支覆盖：静态总数（编译产物）与实际走过的分支数 */
  choiceBranches: { total: number; visited: number };
  endings: { ending: string; times: number }[];
  /** 场景结束但该段剧情未触发任何 @clear（无结局出口；宿主事件场景常见，人工甄别） */
  deadEndScenes: string[];
  cyclesPruned: number;
  saveRoundtrips: number;
  runtimeErrors: { scene: string | null; message: string }[];
}

function parseAssumeValue(raw: string): VarValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/** 编译全部场景进注册表；任何编译失败直接抛错（先跑 surdet lint 定位） */
function loadScenes(projectDir: string): { registry: SceneRegistry; choiceBranchTotal: number } {
  const dir = path.join(projectDir, 'content/scenario');
  const registry = new SceneRegistry();
  let choiceBranchTotal = 0;
  for (const file of findGalFiles(dir)) {
    const id = sceneIdFromFile(file);
    const source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const scene = compileScene(source, file, id);
    registry.register(scene);
    for (const instr of scene.instructions) {
      if (instr.op === 'choice') choiceBranchTotal += (instr as { options: unknown[] }).options.length;
    }
  }
  return { registry, choiceBranchTotal };
}

function readJsonIfExists(full: string): Record<string, unknown> | null {
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function simulateProject(projectDir: string, opts: SimulateOptions = {}): SimulateReport {
  const budget = opts.maxPaths ?? 500;
  const stepLimit = opts.maxStepsPerPath ?? 20000;

  // 入口场景与变量声明
  const gameCfg = readJsonIfExists(path.join(projectDir, 'game.config.json'));
  const entryScene = typeof gameCfg?.['entryScene'] === 'string' ? (gameCfg['entryScene'] as string) : '';
  if (entryScene.length === 0) {
    throw new Error('simulate 需要 game.config.json 声明 entryScene（模拟从入口场景出发）');
  }
  const store = new VariableStore(gameCfg ? declsFromConfig(gameCfg) : []);
  for (const [name, raw] of Object.entries(opts.assume ?? {})) {
    store.set(name, parseAssumeValue(raw)); // 未声明变量 → VariableStore 抛错，直接暴露配置缺陷
  }

  const { registry, choiceBranchTotal } = loadScenes(projectDir);
  if (!registry.has(entryScene)) {
    throw new Error(`entryScene '${entryScene}' 未找到对应场景文件（content/scenario/${entryScene}.gal）`);
  }

  // 成长系统：growth.json 存在则接线（@exp 无系统会抛运行时错误——如实报告而非静默）
  const growthCfg = readJsonIfExists(path.join(projectDir, 'content/config/growth.json'));
  const growth = growthCfg ? new GrowthSystem(growthCfg as unknown as GrowthConfig, store) : null;

  const bus = new EventBus<CoreEventMap>();
  const interp = new Interpreter(store, bus, registry, undefined, undefined, {}, undefined, growth);

  const seenSigs = new Set<string>();
  const choiceTaken = new Set<string>();
  const endingCounts = new Map<string, number>();
  const deadEnds = new Set<string>();
  const runtimeErrors: SimulateReport['runtimeErrors'] = [];
  let paths = 1;
  let budgetExhausted = false;
  let cyclesPruned = 0;
  let saveRoundtrips = 0;
  let segmentSawClear = false;
  const choicePayload: { options: number } = { options: 0 };

  bus.on('choice', (p) => { choicePayload.options = p.options.length; });
  bus.on('clear', (p) => {
    endingCounts.set(p.ending, (endingCounts.get(p.ending) ?? 0) + 1);
    segmentSawClear = true;
  });
  bus.on('sceneEnd', (p) => {
    if (!segmentSawClear) deadEnds.add(p.sceneId);
    segmentSawClear = false;
  });

  const posScene = (): string | null => interp.saveSnapshot()?.position?.sceneId ?? null;
  const recordError = (message: string): void => {
    runtimeErrors.push({ scene: posScene(), message });
  };

  /** 当前挂起点状态签名（定位 + 变量）：重入同签名 = 循环，剪枝 */
  const signature = (): string => {
    const snap = interp.saveSnapshot();
    return JSON.stringify([snap?.position ?? null, snap?.variables ?? null]);
  };

  /** 单路径驱动：推进到 choice（交给 branch）/ ended / 错误 / 步数上限 */
  const drive = (): void => {
    let steps = 0;
    for (;;) {
      const st = interp.status;
      if (st === 'ended' || st === 'idle') return;
      if (++steps > stepLimit) {
        recordError(`单路径步数超过 ${stepLimit}，疑似死循环（检查 @loop 是否有挂起点/条件出口）`);
        return;
      }
      try {
        if (st === 'awaiting-advance') { interp.advance(); continue; }
        if (st === 'awaiting-timer') { interp.finishWait(); continue; }
        if (st === 'awaiting-choice') { branch(); return; }
        recordError(`意外状态 '${st}'，模拟无法推进`);
        return;
      } catch (err) {
        recordError(err instanceof SourceError ? err.message : err instanceof Error ? err.message : String(err));
        return;
      }
    }
  };

  /** choice 分支枚举：快照恢复 + 逐选项 explore（存档往返冒烟天然发生） */
  const branch = (): void => {
    const snap = interp.saveSnapshot();
    if (!snap) return;
    saveRoundtrips++;
    const sig = signature();
    if (seenSigs.has(sig)) { cyclesPruned++; return; }
    seenSigs.add(sig);
    const optionCount = choicePayload.options;
    const choiceKey = `${snap.position?.sceneId ?? '?'}#${snap.position?.pc ?? -1}`;
    for (let i = 0; i < optionCount; i++) {
      if (paths >= budget) { budgetExhausted = true; return; }
      const ck = `${choiceKey}#${i}`;
      if (choiceTaken.has(ck)) continue;
      choiceTaken.add(ck);
      paths++;
      try {
        interp.loadSnapshot(structuredClone(snap));
        saveRoundtrips++;
      } catch (err) {
        recordError(`读档恢复失败：${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      try {
        interp.choose(i);
      } catch (err) {
        recordError(`choose(${i}) 失败：${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      drive();
    }
  };

  try {
    interp.start(entryScene);
    drive();
  } catch (err) {
    recordError(err instanceof SourceError ? err.message : err instanceof Error ? err.message : String(err));
  }

  return {
    entryScene,
    sceneCount: registry.all().length,
    pathsExplored: paths,
    pathBudget: budget,
    budgetExhausted,
    choiceBranches: { total: choiceBranchTotal, visited: choiceTaken.size },
    endings: [...endingCounts.entries()].map(([ending, times]) => ({ ending, times })),
    deadEndScenes: [...deadEnds],
    cyclesPruned,
    saveRoundtrips,
    runtimeErrors,
  };
}

/* ============================ CLI 命令 ============================ */

export async function cmdSimulate(projectDir: string, argv: string[]): Promise<number> {
  const opts: SimulateOptions = { assume: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--max-paths') opts.maxPaths = Number(argv[++i]);
    else if (a === '--max-steps') opts.maxStepsPerPath = Number(argv[++i]);
    else if (a === '--assume') {
      const kv = argv[++i] ?? '';
      const eq = kv.indexOf('=');
      if (eq > 0) opts.assume![kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }

  let report: SimulateReport;
  try {
    report = simulateProject(projectDir, opts);
  } catch (err) {
    process.stderr.write(`simulate 失败：${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const w = (s: string): void => {
      process.stdout.write(s + '\n');
    };
    w(`—— Surdet 无头模拟报告（入口：${report.entryScene}，${report.sceneCount} 场景）——`);
    w(`路径：探索 ${report.pathsExplored} 条（预算 ${report.pathBudget}${report.budgetExhausted ? '，已耗尽' : ''}）；状态签名剪枝 ${report.cyclesPruned} 次循环`);
    const cb = report.choiceBranches;
    w(`choice 分支覆盖：${cb.visited}/${cb.total}${cb.total > 0 && cb.visited === cb.total ? '（全覆盖 ✓）' : ''}`);
    w(`存档往返冒烟：${report.saveRoundtrips} 次 save/load`);
    if (report.endings.length > 0) {
      w('结局可达：' + report.endings.map((e) => `${e.ending}（${e.times} 次）`).join('、'));
    } else {
      w('结局可达：无（未发现可达的 @clear）');
    }
    if (report.deadEndScenes.length > 0) {
      w(`死路场景（结束但未触发 @clear；宿主事件场景属正常，人工甄别）：${report.deadEndScenes.join('、')}`);
    }
    if (report.runtimeErrors.length > 0) {
      w(`运行时错误（${report.runtimeErrors.length}）：`);
      for (const e of report.runtimeErrors.slice(0, 20)) {
        w(`  ✗ ${e.scene ?? '?'}：${e.message}`);
      }
    } else {
      w('运行时错误：0 ✓');
    }
  }
  return report.runtimeErrors.length === 0 ? 0 : 1;
}
