import type { CompiledScene, TextInstr } from './dsl/ast.js';
import { inlineTextLength } from './inline-text.js';
import { decodeStageToken } from './stage.js';

export interface ProjectStats {
  sceneCount: number;
  totalTextLines: number;
  totalCharacters: number;
  choiceCount: number;
  endingCount: number;
  speakerLines: Record<string, number>;
  reachableScenes: string[];
  unreachableScenes: string[];
  /** asset key → sorted scene IDs that reference it */
  referencedAssets: Record<string, string[]>;
  /** Stable per-scene details used by editor presentation adapters. */
  perScene: Record<string, {
    totalTextLines: number;
    totalCharacters: number;
    choiceCount: number;
    choiceOptionCount: number;
    speakerLines: Record<string, number>;
  }>;
}

export interface ProjectStatsInput {
  scenes: readonly CompiledScene[];
  entryScene: string;
  additionalSceneRoots?: readonly string[];
  sourceTextByScene: Readonly<Record<string, string>>;
}

const ASSET_INSTRUCTIONS = new Set([
  'bg', 'show', 'bgm', 'ambience', 'se', 'voice', 'video', 'unlock_cg', 'unlock_music', 'unlock_text', 'unlock_profile', 'unlock_term',
]);

function targetScene(target: string): string {
  const dot = target.indexOf('.');
  return dot >= 0 ? target.slice(0, dot) : target;
}

export function computeProjectStats(input: ProjectStatsInput): ProjectStats {
  const scenes = [...input.scenes].sort((a, b) => a.sceneId.localeCompare(b.sceneId));
  const speakerLines = new Map<string, number>();
  const referencedAssets = new Map<string, Set<string>>();
  const perScene = Object.create(null) as ProjectStats['perScene'];
  const edges = new Map<string, Set<string>>();
  const sceneIds = new Set(scenes.map((scene) => scene.sceneId));
  let totalTextLines = 0;
  let totalCharacters = 0;
  let choiceCount = 0;
  let endingCount = 0;

  for (const scene of scenes) {
    const sceneSpeakerLines = new Map<string, number>();
    let sceneTextLines = 0;
    let sceneCharacters = 0;
    let sceneChoices = 0;
    let sceneChoiceOptions = 0;
    const targets = new Set<string>();
    for (const instr of scene.instructions) {
      if (instr.op === 'text') {
        const text = instr as TextInstr;
        sceneTextLines++;
        const characters = inlineTextLength(text.value);
        sceneCharacters += characters;
        totalTextLines++;
        totalCharacters += characters;
        if (text.speaker) {
          speakerLines.set(text.speaker, (speakerLines.get(text.speaker) ?? 0) + 1);
          sceneSpeakerLines.set(text.speaker, (sceneSpeakerLines.get(text.speaker) ?? 0) + 1);
        }
      } else if (instr.op === 'choice') {
        choiceCount++;
        sceneChoices++;
        sceneChoiceOptions += instr.options.length;
      } else if ((instr.op === 'jump' && instr.kind === 'jump') || instr.op === 'call') {
        const target = targetScene(instr.target);
        if (target) targets.add(target);
      } else if (instr.op === 'instr' || instr.op === 'video') {
        const name = instr.op === 'video' ? 'video' : instr.name;
        const argument = instr.op === 'video' ? instr.src : instr.args[0];
        if (name === 'clear') endingCount++;
        if (ASSET_INSTRUCTIONS.has(name) && argument) {
          const key = decodeStageToken(argument);
          if (!key.trim() || key === 'off' && name === 'ambience') continue;
          const uses = referencedAssets.get(key) ?? new Set<string>();
          uses.add(scene.sceneId);
          referencedAssets.set(key, uses);
        }
      }
    }
    edges.set(scene.sceneId, targets);
    perScene[scene.sceneId] = {
      totalTextLines: sceneTextLines,
      totalCharacters: sceneCharacters,
      choiceCount: sceneChoices,
      choiceOptionCount: sceneChoiceOptions,
      speakerLines: Object.fromEntries([...sceneSpeakerLines.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
  }

  const reachable = new Set<string>();
  const queue = [input.entryScene, ...input.additionalSceneRoots ?? []].filter(id => sceneIds.has(id));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const next of edges.get(current) ?? []) {
      if (sceneIds.has(next) && !reachable.has(next)) queue.push(next);
    }
  }

  return {
    sceneCount: scenes.length,
    totalTextLines,
    totalCharacters,
    choiceCount,
    endingCount,
    speakerLines: Object.fromEntries([...speakerLines.entries()].sort(([a], [b]) => a.localeCompare(b))),
    reachableScenes: scenes.map((scene) => scene.sceneId).filter((id) => reachable.has(id)),
    unreachableScenes: scenes.map((scene) => scene.sceneId).filter((id) => !reachable.has(id)),
    referencedAssets: Object.fromEntries(
      [...referencedAssets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, ids]) => [key, [...ids].sort((a, b) => a.localeCompare(b))]),
    ),
    perScene: Object.fromEntries(Object.entries(perScene).sort(([a], [b]) => a.localeCompare(b))),
  };
}
