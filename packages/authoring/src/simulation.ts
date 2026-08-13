import {
  EventBus,
  GrowthSystem,
  Interpreter,
  SceneRegistry,
  VariableStore,
  type CoreEventMap,
  type SaveSnapshot,
  type VarDeclaration,
  type VarValue,
} from '@surdet/core';
import type { ProjectSnapshot } from './project-snapshot.js';

export interface SimulationOptions {
  maxPaths?: number;
  maxStepsPerPath?: number;
  initialVariables?: Record<string, VarValue>;
  seed?: number;
}

export type SimulationStatus = 'passed' | 'failed' | 'incomplete';

export interface SimulationPath {
  choices: number[];
  finalVariables: Record<string, VarValue>;
  status: 'passed' | 'failed';
  error?: string;
}

export interface SimulationRuntimeError {
  scene: string | null;
  message: string;
}

export interface SimulationReport {
  status: SimulationStatus;
  entryScene: string;
  choiceBranches: { total: number; visited: number };
  paths: SimulationPath[];
  budgetExhausted: boolean;
  runtimeErrors: SimulationRuntimeError[];
  endings: { ending: string; times: number }[];
  deadEndScenes: string[];
  cyclesPruned: number;
  saveRoundtrips: number;
  seed?: number;
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
  error?: string;
  seed?: number;
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

function runtimeFor(snapshot: ProjectSnapshot, initial: Record<string, VarValue> | undefined): {
  store: VariableStore;
  bus: EventBus<CoreEventMap>;
  interpreter: Interpreter;
} {
  const store = new VariableStore(declarations(snapshot));
  for (const [name, value] of Object.entries(initial ?? {})) store.set(name, value);
  const registry = new SceneRegistry();
  for (const scene of snapshot.scenes) registry.register(scene.compiled);
  const bus = new EventBus<CoreEventMap>();
  const interpreter = new Interpreter(store, bus, registry);
  if (snapshot.growthConfig !== undefined && snapshot.growthConfig !== null) {
    interpreter.setGrowth(new GrowthSystem(snapshot.growthConfig, store));
  }
  return { store, bus, interpreter };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function simulateSnapshot(
  snapshot: ProjectSnapshot,
  options: SimulationOptions = {},
): SimulationReport {
  const entryScene = snapshot.entryScene ?? snapshot.scenes[0]?.id ?? '';
  const maxPaths = options.maxPaths ?? 500;
  const maxSteps = options.maxStepsPerPath ?? 20_000;
  const { store, bus, interpreter } = runtimeFor(snapshot, options.initialVariables);
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
      ...(error === undefined ? {} : { error }),
    });
    if (error !== undefined) {
      runtimeErrors.push({ scene: interpreter.position?.sceneId ?? null, message: error });
    }
  };

  const drive = (choices: number[]): void => {
    let steps = 0;
    for (;;) {
      if (++steps > maxSteps) {
        finish(choices, 'failed', `单路径步数超过 ${maxSteps}，疑似死循环`);
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
        const signature = JSON.stringify([base.position, store.snapshot()]);
        if (seenSignatures.has(signature)) {
          cyclesPruned++;
          return;
        }
        seenSignatures.add(signature);
        const position = base.position;
        for (const option of latestChoices) {
          if (paths.length >= maxPaths) {
            budgetExhausted = true;
            return;
          }
          const branchKey = `${position?.sceneId ?? '?'}#${position?.pc ?? -1}#${option.index}`;
          choiceBranches.add(branchKey);
          interpreter.loadSnapshot(cloneSnapshot(base));
          saveRoundtrips++;
          interpreter.choose(option.index);
          drive([...choices, option.index]);
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
    interpreter.start(entryScene);
    drive([]);
  } catch (error) {
    finish([], 'failed', errorText(error));
  }

  return {
    status: runtimeErrors.length > 0 ? 'failed' : budgetExhausted ? 'incomplete' : 'passed',
    entryScene,
    choiceBranches: { total: choiceTotal, visited: choiceBranches.size },
    paths,
    budgetExhausted,
    runtimeErrors,
    endings: [...endingCounts.entries()].map(([ending, times]) => ({ ending, times })),
    deadEndScenes: [...deadEndScenes],
    cyclesPruned,
    saveRoundtrips,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  };
}

export async function runExplicitPath(
  snapshot: ProjectSnapshot,
  options: ExplicitPathOptions,
): Promise<ExplicitPathReport> {
  const { store, bus, interpreter } = runtimeFor(snapshot, options.variables);
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
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    };
  } catch (error) {
    return {
      status: 'failed',
      sceneId: options.sceneId,
      choices: options.choices.slice(0, cursor),
      finalVariables: store.snapshot(),
      error: errorText(error),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    };
  }
}
