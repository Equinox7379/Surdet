/**
 * surdet simulate —— Node 文件系统适配器。
 *
 * 场景编译和运行模拟由 @surdet/authoring / @surdet/core 负责；本文件只把
 * 本机项目目录转换成 ProjectSnapshot，并保留历史 CLI 报告外观。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileScene, type GrowthConfig, type VarValue } from '@surdet/core';
import { parseSceneDocument, simulateSnapshot, type ProjectSnapshot, type StoryCoverage } from '@surdet/authoring';
import { findGalFiles, sceneIdFromFile } from './scenario-loader.js';
import { authoringDigest, collectTimelineFiles } from './timeline-loader.js';

export interface SimulateOptions {
  /** 路径预算（缺省 500）：choice 组合是乘积增长，超预算停止展开新路径 */
  maxPaths?: number;
  /** 单条路径步数上限（缺省 20000）：超出如实标记 budgetExhausted，不伪造运行时异常。 */
  maxStepsPerPath?: number;
  /** 开局变量注入（宿主才能设置的变量，如 battleWon=true），值按 boolean/number/string 解析 */
  assume?: Record<string, string>;
  /** evidence 模式随机种子；缺省使用 Authoring 共享默认 seed */
  seed?: number;
}

export interface SimulateReport {
  entryScene: string;
  sceneCount: number;
  pathsExplored: number;
  pathBudget: number;
  budgetExhausted: boolean;
  choiceBranches: { total: number; visited: number };
  endings: { ending: string; times: number }[];
  deadEndScenes: string[];
  cyclesPruned: number;
  saveRoundtrips: number;
  runtimeErrors: { scene: string | null; message: string }[];
  seed: number;
  coverage: StoryCoverage;
}

function readJsonIfExists(full: string): Record<string, unknown> | null {
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loadSnapshot(projectDir: string): ProjectSnapshot {
  const config = readJsonIfExists(path.join(projectDir, 'game.config.json'));
  const entryScene = typeof config?.['entryScene'] === 'string' ? config['entryScene'] : '';
  if (entryScene.length === 0) throw new Error('simulate 需要 game.config.json 声明 entryScene（模拟从入口场景出发）');

  const customInstructions = Array.isArray(config?.['customInstructions'])
    ? config['customInstructions'].filter((value): value is string => typeof value === 'string')
    : [];
  const sceneFiles = findGalFiles(path.join(projectDir, 'content/scenario'));
  const files = sceneFiles.map((fullPath) => {
    const text = fs.readFileSync(fullPath, 'utf8').replace(/^\uFEFF/, '');
    const id = sceneIdFromFile(fullPath);
    return {
      id,
      path: fullPath,
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: authoringDigest(text),
      compiled: compileScene(text, fullPath, id, customInstructions),
    };
  });
  if (!files.some((file) => file.id === entryScene)) {
    throw new Error(`entryScene '${entryScene}' 未找到对应场景文件（content/scenario/${entryScene}.gal）`);
  }

  const configPath = path.join(projectDir, 'game.config.json');
  const configText = config === null ? null : fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  const configFile = configText === null ? null : {
    path: configPath,
    text: configText,
    bytes: Buffer.byteLength(configText, 'utf8'),
    sha256: authoringDigest(configText),
  };
  const growthPath = path.join(projectDir, 'content/config/growth.json');
  const growthText = fs.existsSync(growthPath)
    ? fs.readFileSync(growthPath, 'utf8').replace(/^\uFEFF/, '')
    : null;
  const growthFile = growthText === null ? null : {
    path: growthPath,
    text: growthText,
    bytes: Buffer.byteLength(growthText, 'utf8'),
    sha256: authoringDigest(growthText),
  };
  const growthConfig = growthText === null ? null : JSON.parse(growthText) as GrowthConfig;
  // R4-A：磁盘真实 timelines 进入 snapshot（发现规则与 lint/A3 共享自 timeline-loader），
  // simulateSnapshot → buildTimelineRegistry 由此获得真实 TimelineRegistry；
  // malformed / identity mismatch 由该链路 fail-loud，本文件不解析 timeline 语义。
  const timelineFiles = collectTimelineFiles(projectDir);
  const projectFiles = [
    ...files,
    ...(configFile === null ? [] : [configFile]),
    ...(growthFile === null ? [] : [growthFile]),
    ...timelineFiles,
  ];
  const variables = config && typeof config['variables'] === 'object' && config['variables'] !== null && !Array.isArray(config['variables'])
    ? config['variables'] as Record<string, unknown>
    : {};
  return {
    rootIdentity: projectDir,
    revision: authoringDigest(projectFiles.map((file) => `${file.path}\0${file.sha256}`).join('\n')),
    files: projectFiles,
    configFile,
    config: config ?? {},
    growthFile,
    growthConfig,
    entryScene,
    variables,
    scenes: files.map(({ id, path: scenePath, text, bytes, sha256, compiled }) => ({
      id,
      path: scenePath,
      file: { path: scenePath, text, bytes, sha256 },
      document: parseSceneDocument(text),
      compiled,
    })),
    timelines: timelineFiles,
  };
}

function parseAssumeValue(raw: string): VarValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

export function simulateProject(projectDir: string, opts: SimulateOptions = {}): SimulateReport {
  const snapshot = loadSnapshot(projectDir);
  const initialVariables: Record<string, VarValue> = Object.create(null) as Record<string, VarValue>;
  for (const [name, raw] of Object.entries(opts.assume ?? {})) {
    Object.defineProperty(initialVariables, name, {
      value: parseAssumeValue(raw), enumerable: true, writable: true, configurable: true,
    });
  }
  const report = simulateSnapshot(snapshot, {
    maxPaths: opts.maxPaths,
    maxStepsPerPath: opts.maxStepsPerPath,
    initialVariables,
    seed: opts.seed,
  });
  return {
    entryScene: report.entryScene,
    sceneCount: snapshot.scenes.length,
    pathsExplored: report.pathsExplored,
    pathBudget: opts.maxPaths ?? 500,
    budgetExhausted: report.budgetExhausted,
    choiceBranches: report.choiceBranches,
    endings: report.endings,
    deadEndScenes: report.deadEndScenes,
    cyclesPruned: report.cyclesPruned,
    saveRoundtrips: report.saveRoundtrips,
    runtimeErrors: report.runtimeErrors,
    seed: report.seed,
    coverage: report.coverage,
  };
}

/* ============================ CLI 命令 ============================ */

export async function cmdSimulate(projectDir: string, argv: string[]): Promise<number> {
  const opts: SimulateOptions = { assume: Object.create(null) as Record<string, string> };

  let report: SimulateReport;
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]!;
      if (a === '--max-paths') opts.maxPaths = Number(argv[++i]);
      else if (a === '--max-steps') opts.maxStepsPerPath = Number(argv[++i]);
      else if (a === '--seed') opts.seed = Number(argv[++i]);
      else if (a === '--assume') {
        const kv = argv[++i];
        const eq = kv?.indexOf('=') ?? -1;
        const name = eq >= 0 ? kv!.slice(0, eq) : '';
        if (kv === undefined || kv.startsWith('--') || eq < 0 || name.trim().length === 0) {
          throw new Error('--assume 必须使用 name=value 格式，变量名不能为空');
        }
        Object.defineProperty(opts.assume!, name, {
          value: kv.slice(eq + 1), enumerable: true, writable: true, configurable: true,
        });
      }
    }
    for (const [name, value] of [['--max-paths', opts.maxPaths], ['--max-steps', opts.maxStepsPerPath]] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`${name} 必须是正整数`);
    }
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
    w(`实际生效 seed：${report.seed}`);
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
      for (const e of report.runtimeErrors.slice(0, 20)) w(`  ✗ ${e.scene ?? '?'}：${e.message}`);
    } else {
      w('运行时错误：0 ✓');
    }
  }
  return report.runtimeErrors.length === 0 ? 0 : 1;
}
