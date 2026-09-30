import type { ProjectSnapshot } from './project-snapshot.js';
import type { RuntimeTraceEvent } from './runtime-trace.js';

export interface StoryLocation {
  sceneId: string; file: string; index: number; line: number; col: number; sourceVersion: string;
}
export interface StoryBranch {
  location: StoryLocation; optionIndex: number; label: string;
  available: number; selected: number; conditionFalse: number; budgetStops: number;
  status: 'visited' | 'unvisited' | 'condition-not-met' | 'budget-exhausted';
}
export interface StoryCondition {
  location: StoryLocation; expression: string; optionIndex?: number; trueCount: number; falseCount: number;
}
export interface StoryCoverage {
  scenes: { sceneId: string; file: string; sourceVersion: string; visited: boolean; executedInstructions: number; totalInstructions: number }[];
  branches: StoryBranch[];
  conditions: StoryCondition[];
  stops: { kind: 'runtime-error' | 'path-budget' | 'step-budget'; location: StoryLocation | null; message: string }[];
  hostInstructions: StoryLocation[];
}

/** Records only actual Core events. Static instructions provide the unvisited inventory. */
export function createStoryCoverage(snapshot: ProjectSnapshot) {
  const byScene = new Map(snapshot.scenes.map(scene => [scene.id, scene]));
  const executed = new Map<string, Set<number>>();
  const branches = new Map<string, StoryBranch>();
  const conditions = new Map<string, StoryCondition>();
  const stops: StoryCoverage['stops'] = [];
  const hostInstructions = new Map<string, StoryLocation>();
  const custom = Array.isArray(snapshot.config.customInstructions) ? snapshot.config.customInstructions.filter((value): value is string => typeof value === 'string') : [];
  let current: StoryLocation | null = null;
  const key = (sceneId: string, index: number, optionIndex?: number) => `${sceneId}\0${index}\0${optionIndex ?? ''}`;
  const locate = (sceneId: string, index: number): StoryLocation | null => {
    const scene = byScene.get(sceneId), instruction = scene?.compiled.instructions[index];
    return scene && instruction ? { sceneId, file: scene.path, index, line: instruction.line, col: instruction.col, sourceVersion: scene.file.sha256 } : null;
  };
  for (const scene of snapshot.scenes) for (const instruction of scene.compiled.instructions) {
    const location = locate(scene.id, instruction.index)!;
    if (instruction.op === 'choice') instruction.options.forEach((option, optionIndex) => {
      const optionLocation = { ...location, line: option.pos.line, col: option.pos.col };
      branches.set(key(scene.id, instruction.index, optionIndex), { location: optionLocation, optionIndex, label: option.label,
        available: 0, selected: 0, conditionFalse: 0, budgetStops: 0, status: 'unvisited' });
      if (option.when !== null) conditions.set(key(scene.id, instruction.index, optionIndex), {
        location: optionLocation, expression: option.when, optionIndex, trueCount: 0, falseCount: 0,
      });
    });
    if (instruction.op === 'condJump') conditions.set(key(scene.id, instruction.index), {
      location, expression: instruction.expr, trueCount: 0, falseCount: 0,
    });
  }
  const observe = (event: RuntimeTraceEvent) => {
    const location = locate(event.source.sceneId, event.source.index);
    if (!location) return;
    current = location;
    if (event.kind === 'instruction') {
      const indices = executed.get(location.sceneId) ?? new Set<number>(); indices.add(location.index); executed.set(location.sceneId, indices);
      const instruction = byScene.get(location.sceneId)!.compiled.instructions[location.index]!;
      if (instruction.op === 'choice') instruction.options.forEach((option, optionIndex) => {
        if (option.when === null) branches.get(key(location.sceneId, location.index, optionIndex))!.available++;
      });
      if (instruction.op === 'instr' && ['battle', 'calendar', 'affection', 'event', 'shop', 'item', ...custom].includes(instruction.name))
        hostInstructions.set(key(location.sceneId, location.index), location);
    }
    if (event.condition) {
      const id = key(location.sceneId, location.index, event.condition.optionIndex);
      const condition = conditions.get(id);
      if (condition) { if (event.condition.result) condition.trueCount++; else condition.falseCount++; }
      if (event.condition.optionIndex !== undefined) {
        const branch = branches.get(id);
        if (branch) { if (event.condition.result) branch.available++; else branch.conditionFalse++; }
      }
    }
    if (event.choice) {
      const branch = branches.get(key(location.sceneId, location.index, event.choice.optionIndex));
      if (branch) branch.selected++;
    }
  };
  return {
    observe,
    stop(kind: StoryCoverage['stops'][number]['kind'], message: string, at = current) { stops.push({ kind, location: at, message }); },
    pathBudget(sceneId: string, index: number, optionIndex: number) {
      const branch = branches.get(key(sceneId, index, optionIndex));
      if (branch) branch.budgetStops++;
      stops.push({ kind: 'path-budget', location: branch?.location ?? locate(sceneId, index), message: '路径预算已用尽，此选项未继续执行。' });
    },
    result(): StoryCoverage {
      return {
        scenes: snapshot.scenes.map(scene => ({ sceneId: scene.id, file: scene.path, sourceVersion: scene.file.sha256,
          visited: (executed.get(scene.id)?.size ?? 0) > 0, executedInstructions: executed.get(scene.id)?.size ?? 0,
          totalInstructions: scene.compiled.instructions.length })),
        branches: [...branches.values()].map(branch => ({ ...branch, status: branch.selected ? 'visited' : branch.budgetStops ? 'budget-exhausted'
          : branch.available ? 'unvisited' : branch.conditionFalse ? 'condition-not-met' : 'unvisited' })),
        conditions: [...conditions.values()].map(condition => ({ ...condition })),
        stops: stops.map(stop => ({ ...stop })), hostInstructions: [...hostInstructions.values()],
      };
    },
  };
}
