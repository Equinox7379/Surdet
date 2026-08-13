/**
 * surdet simulate —— Node 文件系统适配器。
 *
 * 场景编译和运行模拟由 @surdet/authoring / @surdet/core 负责；本文件只把
 * 本机项目目录转换成 ProjectSnapshot，并保留历史 CLI 报告外观。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileScene, type GrowthConfig, type VarValue } from '@surdet/core';
import { parseSceneDocument, simulateSnapshot, type ProjectSnapshot } from '@surdet/authoring';
import { findGalFiles, sceneIdFromFile } from './scenario-loader.js';

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
  choiceBranches: { total: number; visited: number };
  endings: { ending: string; times: number }[];
  deadEndScenes: string[];
  cyclesPruned: number;
  saveRoundtrips: number;
  runtimeErrors: { scene: string | null; message: string }[];
}

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
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
      sha256: digest(text),
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
    sha256: digest(configText),
  };
  const growthPath = path.join(projectDir, 'content/config/growth.json');
  const growthText = fs.existsSync(growthPath)
    ? fs.readFileSync(growthPath, 'utf8').replace(/^\uFEFF/, '')
    : null;
  const growthFile = growthText === null ? null : {
    path: growthPath,
    text: growthText,
    bytes: Buffer.byteLength(growthText, 'utf8'),
    sha256: digest(growthText),
  };
  const growthConfig = growthText === null ? null : JSON.parse(growthText) as GrowthConfig;
  const projectFiles = [
    ...files,
    ...(configFile === null ? [] : [configFile]),
    ...(growthFile === null ? [] : [growthFile]),
  ];
  const variables = config && typeof config['variables'] === 'object' && config['variables'] !== null && !Array.isArray(config['variables'])
    ? config['variables'] as Record<string, unknown>
    : {};
  return {
    rootIdentity: projectDir,
    revision: digest(projectFiles.map((file) => `${file.path}\0${file.sha256}`).join('\n')),
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
    timelines: [],
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
  const initialVariables: Record<string, VarValue> = {};
  for (const [name, raw] of Object.entries(opts.assume ?? {})) initialVariables[name] = parseAssumeValue(raw);
  const report = simulateSnapshot(snapshot, {
    maxPaths: opts.maxPaths,
    maxStepsPerPath: opts.maxStepsPerPath,
    initialVariables,
  });
  return {
    entryScene: report.entryScene,
    sceneCount: snapshot.scenes.length,
    pathsExplored: report.paths.length,
    pathBudget: opts.maxPaths ?? 500,
    budgetExhausted: report.budgetExhausted,
    choiceBranches: report.choiceBranches,
    endings: report.endings,
    deadEndScenes: report.deadEndScenes,
    cyclesPruned: report.cyclesPruned,
    saveRoundtrips: report.saveRoundtrips,
    runtimeErrors: report.runtimeErrors,
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
      for (const e of report.runtimeErrors.slice(0, 20)) w(`  ✗ ${e.scene ?? '?'}：${e.message}`);
    } else {
      w('运行时错误：0 ✓');
    }
  }
  return report.runtimeErrors.length === 0 ? 0 : 1;
}
