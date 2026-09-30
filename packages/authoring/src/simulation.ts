import {
  EventBus,
  GrowthSystem,
  Interpreter,
  SceneRegistry,
  TimelineRegistry,
  VariableStore,
  assertValidRandomSeed,
  createSeededRandomSource,
  type CoreEventMap,
  type SaveSnapshot,
  type VarDeclaration,
  type VarValue,
} from '@surdet/core';
import type { ProjectSnapshot } from './project-snapshot.js';
import { normalizeTrace, type RuntimeTraceEvent } from './runtime-trace.js';
import { timelineIdentityConflict, timelineIdentityMismatchMessage } from './timeline-identity.js';
import { createStoryCoverage, type StoryCoverage } from './story-coverage.js';

export const DEFAULT_AUTHORING_EVIDENCE_SEED = 0x5eedc0de;

export interface SimulationOptions {
  maxPaths?: number;
  maxStepsPerPath?: number;
  initialVariables?: Record<string, VarValue>;
  seed?: number;
}

export type SimulationStatus = 'passed' | 'failed' | 'incomplete';

export type SimulationPathTermination = 'ended' | 'error' | 'pruned' | 'budget-exhausted';

export interface SimulationPath {
  choices: number[];
  finalVariables: Record<string, VarValue>;
  status: 'passed' | 'failed' | 'incomplete';
  termination: SimulationPathTermination;
  prunedReason?: 'state-signature' | 'path-budget' | 'step-budget';
  error?: string;
}

export interface SimulationRuntimeError {
  scene: string | null;
  message: string;
}

export interface SimulationReport {
  status: SimulationStatus;
  entryScene: string;
  pathsExplored: number;
  choiceBranches: { total: number; visited: number };
  paths: SimulationPath[];
  budgetExhausted: boolean;
  runtimeErrors: SimulationRuntimeError[];
  endings: { ending: string; times: number }[];
  deadEndScenes: string[];
  cyclesPruned: number;
  saveRoundtrips: number;
  seed: number;
  coverage: StoryCoverage;
}

export interface ExplicitPathOptions {
  sceneId: string;
  label?: string;
  variables?: Record<string, VarValue>;
  choices: number[];
  maxSteps?: number;
  seed?: number;
}

export interface ExplicitPathReport {
  status: 'passed' | 'failed';
  sceneId: string;
  choices: number[];
  finalVariables: Record<string, VarValue>;
  events: RuntimeTraceEvent[];
  error?: string;
  seed: number;
}

function declarations(snapshot: ProjectSnapshot): VarDeclaration[] {
  const out: VarDeclaration[] = [];
  for (const [name, value] of Object.entries(snapshot.variables)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const raw = value as Record<string, unknown>;
    if (typeof raw['type'] !== 'string' || !('initial' in raw)) continue;
    out.push({ ...raw, name, type: raw['type'] as VarDeclaration['type'], initial: raw['initial'] as VarValue });
  }
  return out;
}

function cloneSnapshot(snapshot: SaveSnapshot): SaveSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as SaveSnapshot;
}

function simulationStateSignature(snapshot: SaveSnapshot): string {
  return JSON.stringify([
    snapshot.position,
    snapshot.callStack ?? [],
    snapshot.variables,
    snapshot.random ?? null,
  ]);
}

/**
 * 从项目快照构造真实 Core TimelineRegistry：headless 模拟 / 运行轨迹与 Editor Preview
 * 共享同一 timeline runtime truth。JSON 解析与 validation 输入契约一致（容忍 UTF-8 BOM）；
 * 结构非法或 ID 重复由 Core `TimelineRegistry.register` 的 validateTimeline fail-loud，
 * 本处不做任何静默跳过（验证通道不得 skip invalid 后继续给 PASS）。
 */
export function buildTimelineRegistry(snapshot: ProjectSnapshot): TimelineRegistry {
  const registry = new TimelineRegistry();
  for (const timeline of snapshot.timelines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(timeline.text.replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new Error(`${timeline.path}: 时间轴 JSON 解析失败（${error instanceof Error ? error.message : String(error)}）`);
    }
    // Phase 2B（A2）：canonical identity invariant 与 validation 共享同一 helper——
    // filename stem == definition.id，divergence 时 fail-loud。不做 alias/fallback/改写。
    const conflict = timelineIdentityConflict(timeline.path, parsed);
    if (conflict !== null) throw new Error(timelineIdentityMismatchMessage(conflict));
    try {
      registry.register(parsed);
    } catch (error) {
      throw new Error(`${timeline.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return registry;
}

function runtimeFor(snapshot: ProjectSnapshot, initial: Record<string, VarValue> | undefined, seed: number): {
  store: VariableStore;
  bus: EventBus<CoreEventMap>;
  interpreter: Interpreter;
} {
  const store = new VariableStore(declarations(snapshot));
  for (const [name, value] of Object.entries(initial ?? {})) store.set(name, value);
  const registry = new SceneRegistry();
  for (const scene of snapshot.scenes) registry.register(scene.compiled);
  const bus = new EventBus<CoreEventMap>();
  // timelineCatalog 为构造器第 9 参（preview.ts 同一模式；growth 维持既有 setGrowth 注入）。
  const interpreter = new Interpreter(store, bus, registry, undefined, undefined, {}, undefined, null, buildTimelineRegistry(snapshot));
  interpreter.setRandomSource(createSeededRandomSource(seed));
  if (snapshot.growthConfig !== undefined && snapshot.growthConfig !== null) {
    interpreter.setGrowth(new GrowthSystem(snapshot.growthConfig, store));
  }
  return { store, bus, interpreter };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeExplicitPathTrace(events: readonly RuntimeTraceEvent[], snapshot: ProjectSnapshot): RuntimeTraceEvent[] {
  return normalizeTrace(events).map((event) => {
    if (event.source.op !== 'instr') return event;
    const scene = snapshot.scenes.find((candidate) => candidate.id === event.source.sceneId);
    const instruction = scene?.compiled.instructions[event.source.index];
    return instruction?.op === 'instr'
      ? { ...event, source: { ...event.source, op: instruction.name } }
      : event;
  });
}

export function simulateSnapshot(
  snapshot: ProjectSnapshot,
  options: SimulationOptions = {},
): SimulationReport {
  const seed = options.seed ?? DEFAULT_AUTHORING_EVIDENCE_SEED;
  assertValidRandomSeed(seed);
  const entryScene = snapshot.entryScene ?? snapshot.scenes[0]?.id ?? '';
  const maxPaths = options.maxPaths ?? 500;
  const maxSteps = options.maxStepsPerPath ?? 20_000;
  const { store, bus, interpreter } = runtimeFor(snapshot, options.initialVariables, seed);
  const coverage = createStoryCoverage(snapshot);
  bus.on('runtimeTrace', event => coverage.observe(event));
  const choiceTotal = snapshot.scenes.reduce(
    (total, scene) => total + scene.compiled.instructions.reduce(
      (count, instr) => count + (instr.op === 'choice' ? instr.options.length : 0),
      0,
    ),
    0,
  );
  const choiceBranches = new Set<string>();
  const paths: SimulationPath[] = [];
  const runtimeErrors: SimulationRuntimeError[] = [];
  const endingCounts = new Map<string, number>();
  const deadEndScenes = new Set<string>();
  const seenSignatures = new Set<string>();
  let latestChoices: { index: number; label: string }[] = [];
  let budgetExhausted = false;
  let cyclesPruned = 0;
  let saveRoundtrips = 0;
  let pathsExplored = 0;
  let segmentSawClear = false;

  bus.on('choice', (payload) => { latestChoices = payload.options; });
  bus.on('clear', (payload) => {
    endingCounts.set(payload.ending, (endingCounts.get(payload.ending) ?? 0) + 1);
    segmentSawClear = true;
  });
  bus.on('sceneEnd', (payload) => {
    if (!segmentSawClear) deadEndScenes.add(payload.sceneId);
    segmentSawClear = false;
  });

  const finish = (choices: number[], status: SimulationPath['status'], error?: string): void => {
    paths.push({
      choices: [...choices],
      finalVariables: store.snapshot(),
      status,
      termination: error === undefined ? 'ended' : 'error',
      ...(error === undefined ? {} : { error }),
    });
    if (error !== undefined) {
      coverage.stop('runtime-error', error);
      runtimeErrors.push({ scene: interpreter.position?.sceneId ?? null, message: error });
    }
  };

  const recordPruned = (
    choices: number[],
    reason: SimulationPath['prunedReason'],
    termination: Extract<SimulationPathTermination, 'pruned' | 'budget-exhausted'>,
  ): void => {
    paths.push({
      choices: [...choices],
      finalVariables: store.snapshot(),
      status: termination === 'budget-exhausted' ? 'incomplete' : 'passed',
      termination,
      prunedReason: reason,
    });
  };

  const beginPath = (): boolean => {
    if (pathsExplored >= maxPaths) return false;
    pathsExplored++;
    return true;
  };

  const drive = (choices: number[], steps = 0): void => {
    for (;;) {
      if (++steps > maxSteps) {
        budgetExhausted = true;
        coverage.stop('step-budget', '单路径步数预算已用尽。');
        recordPruned(choices, 'step-budget', 'budget-exhausted');
        return;
      }
      try {
        if (interpreter.status === 'ended' || interpreter.status === 'idle') {
          finish(choices, 'passed');
          return;
        }
        if (interpreter.status === 'awaiting-advance') {
          interpreter.advance();
          continue;
        }
        if (interpreter.status === 'awaiting-timer') {
          interpreter.finishWait();
          continue;
        }
        if (interpreter.status !== 'awaiting-choice') {
          finish(choices, 'failed', `意外运行状态：${interpreter.status}`);
          return;
        }

        const base = interpreter.saveSnapshot();
        saveRoundtrips++;
        if (base === null) {
          finish(choices, 'failed', '无法为 choice 创建分支快照');
          return;
        }
        const signature = simulationStateSignature(base);
        if (seenSignatures.has(signature)) {
          cyclesPruned++;
          recordPruned(choices, 'state-signature', 'pruned');
          return;
        }
        seenSignatures.add(signature);
        const position = base.position;
        const visible = latestChoices;
        for (const [ordinal, option] of visible.entries()) {
          if (!beginPath()) {
            budgetExhausted = true;
            for (const skipped of visible.slice(ordinal)) coverage.pathBudget(position?.sceneId ?? '', position?.pc ?? -1, skipped.index);
            recordPruned(choices, 'path-budget', 'budget-exhausted');
            return;
          }
          const branchKey = `${position?.sceneId ?? '?'}#${position?.pc ?? -1}#${option.index}`;
          choiceBranches.add(branchKey);
          interpreter.loadSnapshot(cloneSnapshot(base));
          saveRoundtrips++;
          interpreter.choose(option.index);
          drive([...choices, option.index], steps);
        }
        return;
      } catch (error) {
        finish(choices, 'failed', errorText(error));
        return;
      }
    }
  };

  try {
    if (entryScene.length === 0) throw new Error('模拟需要 entryScene');
    if (!beginPath()) {
      budgetExhausted = true;
      recordPruned([], 'path-budget', 'budget-exhausted');
    } else {
      interpreter.start(entryScene);
      drive([]);
    }
  } catch (error) {
    finish([], 'failed', errorText(error));
  }

  return {
    status: runtimeErrors.length > 0 ? 'failed' : budgetExhausted ? 'incomplete' : 'passed',
    entryScene,
    pathsExplored,
    choiceBranches: { total: choiceTotal, visited: choiceBranches.size },
    paths,
    budgetExhausted,
    runtimeErrors,
    endings: [...endingCounts.entries()].map(([ending, times]) => ({ ending, times })),
    deadEndScenes: [...deadEndScenes],
    cyclesPruned,
    saveRoundtrips,
    seed,
    coverage: coverage.result(),
  };
}

export async function runExplicitPath(
  snapshot: ProjectSnapshot,
  options: ExplicitPathOptions,
): Promise<ExplicitPathReport> {
  const seed = options.seed ?? DEFAULT_AUTHORING_EVIDENCE_SEED;
  assertValidRandomSeed(seed);
  const { store, bus, interpreter } = runtimeFor(snapshot, options.variables, seed);
  const events: RuntimeTraceEvent[] = [];
  bus.on('runtimeTrace', (event) => events.push(event));
  let latestChoices: { index: number; label: string }[] = [];
  let cursor = 0;
  bus.on('choice', (payload) => { latestChoices = payload.options; });
  try {
    interpreter.start(options.sceneId, options.label);
    let steps = 0;
    const maxSteps = options.maxSteps ?? 20_000;
    while (interpreter.status !== 'ended' && interpreter.status !== 'idle') {
      if (++steps > maxSteps) throw new Error(`单路径步数超过 ${maxSteps}，疑似死循环`);
      if (interpreter.status === 'awaiting-advance') interpreter.advance();
      else if (interpreter.status === 'awaiting-timer') interpreter.finishWait();
      else if (interpreter.status === 'awaiting-choice') {
        const next = options.choices[cursor++];
        if (next === undefined) throw new Error('显式路径在 choice 处缺少选择，不得猜测选项');
        if (!latestChoices.some((option) => option.index === next)) {
          throw new Error(`显式路径选择 ${next} 当前不可用`);
        }
        interpreter.choose(next);
      } else {
        throw new Error(`意外运行状态：${interpreter.status}`);
      }
    }
    return {
      status: 'passed',
      sceneId: options.sceneId,
      choices: options.choices.slice(0, cursor),
      finalVariables: store.snapshot(),
      events: normalizeExplicitPathTrace(events, snapshot),
      seed,
    };
  } catch (error) {
    return {
      status: 'failed',
      sceneId: options.sceneId,
      choices: options.choices.slice(0, cursor),
      finalVariables: store.snapshot(),
      events: normalizeExplicitPathTrace(events, snapshot),
      error: errorText(error),
      seed,
    };
  }
}
