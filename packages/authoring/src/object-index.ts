import { parseInlineInstructions } from '@surdet/core';
import { splitInstruction } from './scene-document.js';
import { buildAssetCatalog } from './asset-catalog.js';
import type { AuthoringObject, ProjectAssetCatalog } from './contracts.js';
import type { ProjectSnapshot, ProjectSnapshotScene } from './project-snapshot.js';

export interface ObjectIndex {
  revision: string;
  objects: AuthoringObject[];
  byRef: Map<string, AuthoringObject>;
}

function fingerprint(raw: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index++) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function anonymousRef(revision: string, sceneId: string, kind: string, line: number, raw: string): string {
  return `scene:${sceneId}/${kind}:${line}@${revision.slice(0, 8)}-${fingerprint(raw)}`;
}

function sourceOf(path: string, line: number, raw: string): { path: string; line: number; col: number; raw: string } {
  const offset = raw.length - raw.trimStart().length;
  return { path, line, col: offset + 1, raw };
}

function sceneObject(scene: ProjectSnapshotScene): AuthoringObject {
  const first = scene.document[0];
  return {
    kind: 'scene',
    semanticId: `scene:${scene.id}`,
    objectRef: `scene:${scene.id}`,
    source: sourceOf(scene.path, 1, first?.raw ?? ''),
    references: [],
    referencedBy: [],
  };
}

function addObject(objects: AuthoringObject[], object: AuthoringObject, candidates: Map<string, string[]>): void {
  objects.push(object);
  candidates.set(object.objectRef, []);
}

function addReferenceCandidate(candidates: Map<string, string[]>, objectRef: string, target: string): void {
  const current = candidates.get(objectRef);
  if (current !== undefined && !current.includes(target)) current.push(target);
}

const VARIABLE_REFERENCE_INSTRUCTIONS = new Set(['set', 'mod', 'inc', 'dec', 'toggle', 'flag', 'unflag']);

function referenceTargetsForInstruction(name: string, args: readonly string[], sceneId: string): string[] {
  if (name === 'timeline') {
    // @timeline <id> [@ blocking]：只取第一个参数为时间轴 ID，忽略修饰符 token。
    const target = args[0];
    return target !== undefined && target.length > 0 && !target.startsWith('@') ? [`timeline:${target}`] : [];
  }
  if (name === 'goto' || name === 'loop') {
    const target = args.join(' ');
    return target.length > 0 ? [`label:${sceneId}.${target}`] : [];
  }
  if (name === 'jump' || name === 'call') {
    const targetScene = args.join(' ').split('.')[0] ?? '';
    return targetScene.length > 0 ? [`scene:${targetScene}`] : [];
  }
  if (VARIABLE_REFERENCE_INSTRUCTIONS.has(name)) {
    const variable = args[0];
    return variable !== undefined && variable.length > 0 ? [`variable:${variable}`] : [];
  }
  return [];
}

function choiceOptionReferenceTargets(raw: string, scene: ProjectSnapshotScene, lineNumber: number): string[] {
  const trimmed = raw.trimStart();
  const arrowIndex = trimmed.indexOf(' -> ');
  if (arrowIndex < 0) return [];
  const inline = trimmed.slice(arrowIndex + 4).trim();
  if (inline.length === 0) return [];
  try {
    const instructions = parseInlineInstructions(inline, scene.path, lineNumber, raw.length - trimmed.length + arrowIndex + 5);
    const targets: string[] = [];
    let jumpSeen = false;
    for (const instruction of instructions) {
      if (instruction.name === 'goto' || instruction.name === 'jump') {
        if (jumpSeen) continue;
        jumpSeen = true;
      }
      for (const target of referenceTargetsForInstruction(instruction.name, instruction.args, scene.id)) {
        if (!targets.includes(target)) targets.push(target);
      }
    }
    return targets;
  } catch {
    // Invalid choice syntax is reported by shared validation; keep the source object indexable.
    return [];
  }
}

function addSceneObjects(
  snapshot: ProjectSnapshot,
  scene: ProjectSnapshotScene,
  objects: AuthoringObject[],
  candidates: Map<string, string[]>,
): void {
  addObject(objects, sceneObject(scene), candidates);
  let currentChoiceRef: string | null = null;
  for (let index = 0; index < scene.document.length; index++) {
    const line = scene.document[index]!;
    const lineNumber = index + 1;
    if (line.kind === 'choice-option') {
      const objectRef = anonymousRef(snapshot.revision, scene.id, 'choice-option', lineNumber, line.raw);
      const object: AuthoringObject = {
        kind: 'choice-option',
        objectRef,
        ...(currentChoiceRef === null ? {} : { parentRef: currentChoiceRef }),
        source: sourceOf(scene.path, lineNumber, line.raw),
        references: [],
        referencedBy: [],
      };
      addObject(objects, object, candidates);
      for (const target of choiceOptionReferenceTargets(line.raw, scene, lineNumber)) {
        addReferenceCandidate(candidates, objectRef, target);
      }
      continue;
    }
    if (line.kind === 'label') {
      currentChoiceRef = null;
      addObject(objects, {
        kind: 'label',
        semanticId: `label:${scene.id}.${line.name}`,
        objectRef: `label:${scene.id}.${line.name}`,
        source: sourceOf(scene.path, lineNumber, line.raw),
        references: [],
        referencedBy: [],
      }, candidates);
      continue;
    }
    const sceneRef = `scene:${scene.id}`;
    if (line.kind === 'instr') {
      const { name, args } = splitInstruction(line.raw);
      const kind = name === 'choice' ? 'choice' : 'instruction';
      const objectRef = anonymousRef(snapshot.revision, scene.id, kind, lineNumber, line.raw);
      const object: AuthoringObject = {
        kind,
        objectRef,
        parentRef: sceneRef,
        source: sourceOf(scene.path, lineNumber, line.raw),
        references: [],
        referencedBy: [],
      };
      addObject(objects, object, candidates);
      currentChoiceRef = name === 'choice' ? objectRef : null;
      for (const target of referenceTargetsForInstruction(name, args, scene.id)) {
        addReferenceCandidate(candidates, objectRef, target);
      }
      continue;
    }
    currentChoiceRef = null;
    if (line.kind === 'text') {
      addObject(objects, {
        kind: 'text',
        objectRef: anonymousRef(snapshot.revision, scene.id, 'text', lineNumber, line.raw),
        parentRef: sceneRef,
        source: sourceOf(scene.path, lineNumber, line.raw),
        references: [],
        referencedBy: [],
      }, candidates);
    }
  }
}

function assetRefForCue(track: Record<string, unknown>, cue: Record<string, unknown>): string | null {
  const kind = track['kind'];
  const action = cue['action'];
  if (kind === 'background' && action === 'set') {
    const key = cue['key'];
    return typeof key === 'string' && key.length > 0 ? `asset:bg:${key}` : null;
  }
  if (kind === 'portrait' && (action === 'show' || action === 'expression')) {
    const target = track['target'];
    const expression = cue['expression'];
    if (typeof target !== 'string' || typeof expression !== 'string') return null;
    const [role, outfit = ''] = target.split(':');
    if (!role || !outfit || expression.length === 0) return null;
    return `asset:portrait:${role}:${outfit}:${expression}`;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function addTimelineObjects(
  timelinePath: string,
  timelineText: string,
  objects: AuthoringObject[],
  candidates: Map<string, string[]>,
): void {
  const name = timelinePath.slice(timelinePath.lastIndexOf('/') + 1, -'.json'.length);
  const timelineRef = `timeline:${name}`;
  let definition: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(timelineText.replace(/^\uFEFF/, ''));
    definition = asRecord(parsed);
  } catch {
    definition = null;
  }
  addObject(objects, {
    kind: 'timeline',
    semanticId: timelineRef,
    objectRef: timelineRef,
    source: sourceOf(timelinePath, 1, timelineText),
    references: [],
    referencedBy: [],
    ...(definition === null ? {} : { details: definition }),
  }, candidates);
  if (definition === null || !Array.isArray(definition['tracks'])) return;

  // 被引用资产对象：从引用处自动生成语义身份（catalog 的 resolved 状态不属于索引）。
  const ensureAsset = (ref: string, source: { path: string; line: number; raw: string }): void => {
    if (objects.some((object) => object.objectRef === ref)) return;
    addObject(objects, {
      kind: 'asset',
      semanticId: ref,
      objectRef: ref,
      source: sourceOf(source.path, source.line, source.raw),
      references: [],
      referencedBy: [],
    }, candidates);
  };

  const timelineAssets = new Set<string>();
  const tracks = definition['tracks'] as unknown[];
  tracks.forEach((rawTrack, trackIndex) => {
    const track = asRecord(rawTrack);
    if (track === null) return;
    const trackRef = `timeline:${name}/track:${trackIndex}`;
    const trackRaw = JSON.stringify(track);
    addObject(objects, {
      kind: 'track',
      objectRef: trackRef,
      parentRef: timelineRef,
      source: sourceOf(timelinePath, 1, trackRaw),
      references: [],
      referencedBy: [],
      details: track,
    }, candidates);
    const trackAssets = new Set<string>();
    const cues = Array.isArray(track['cues']) ? track['cues'] as unknown[] : [];
    cues.forEach((rawCue, cueIndex) => {
      const cue = asRecord(rawCue);
      if (cue === null) return;
      const cueRef = `timeline:${name}/track:${trackIndex}/cue:${cueIndex}`;
      const cueRaw = JSON.stringify(cue);
      addObject(objects, {
        kind: 'cue',
        objectRef: cueRef,
        parentRef: trackRef,
        source: sourceOf(timelinePath, 1, cueRaw),
        references: [],
        referencedBy: [],
        details: cue,
      }, candidates);
      const assetRef = assetRefForCue(track, cue);
      if (assetRef === null) return;
      trackAssets.add(assetRef);
      timelineAssets.add(assetRef);
      ensureAsset(assetRef, { path: timelinePath, line: 1, raw: cueRaw });
      addReferenceCandidate(candidates, cueRef, assetRef);
    });
    for (const assetRef of trackAssets) addReferenceCandidate(candidates, trackRef, assetRef);
  });
  for (const assetRef of timelineAssets) addReferenceCandidate(candidates, timelineRef, assetRef);
}

export function buildObjectIndex(snapshot: ProjectSnapshot): ObjectIndex {
  const objects: AuthoringObject[] = [];
  const candidates = new Map<string, string[]>();
  for (const scene of snapshot.scenes) addSceneObjects(snapshot, scene, objects, candidates);
  for (const [name, declaration] of Object.entries(snapshot.variables)) {
    addObject(objects, {
      kind: 'variable',
      semanticId: `variable:${name}`,
      objectRef: `variable:${name}`,
      source: {
        path: 'game.config.json',
        line: 1,
        col: 1,
        raw: JSON.stringify(declaration),
      },
      references: [],
      referencedBy: [],
    }, candidates);
  }
  for (const timeline of snapshot.timelines) addTimelineObjects(timeline.path, timeline.text, objects, candidates);

  const byRef = new Map(objects.map((object) => [object.objectRef, object]));
  for (const object of objects) {
    const targets = candidates.get(object.objectRef) ?? [];
    for (const target of targets) {
      if (!byRef.has(target)) continue;
      object.references.push(target);
      byRef.get(target)!.referencedBy.push(object.objectRef);
    }
  }
  return { revision: snapshot.revision, objects, byRef };
}

export class ObjectIndexError extends Error {
  constructor(readonly code: 'OBJECT_NOT_FOUND' | 'OBJECT_AMBIGUOUS', message: string) {
    super(message);
    this.name = 'ObjectIndexError';
  }
}

export function inspectObject(index: ObjectIndex, objectRef: string): AuthoringObject {
  const exact = index.objects.filter((object) => object.objectRef === objectRef || object.semanticId === objectRef);
  if (exact.length === 0) throw new ObjectIndexError('OBJECT_NOT_FOUND', `对象不存在：${objectRef}`);
  if (exact.length > 1) throw new ObjectIndexError('OBJECT_AMBIGUOUS', `对象不唯一：${objectRef}`);
  return exact[0]!;
}

export interface ProjectInspection {
  rootIdentity: string;
  revision: string;
  entryScene?: string;
  scenes: { id: string; path: string }[];
  variables: { name: string; declaration: unknown }[];
  /** 只读资源目录（共享 asset catalog 解析结果）；输入仅是资产路径元数据。 */
  assets: ProjectAssetCatalog;
  objectCount: number;
  referenceCount: number;
}

export function inspectProject(
  snapshot: ProjectSnapshot,
  index = buildObjectIndex(snapshot),
  assetPaths: readonly string[] = [],
): ProjectInspection {
  return {
    rootIdentity: snapshot.rootIdentity,
    revision: snapshot.revision,
    ...(snapshot.entryScene === undefined ? {} : { entryScene: snapshot.entryScene }),
    scenes: snapshot.scenes.map((scene) => ({ id: scene.id, path: scene.path })),
    variables: Object.entries(snapshot.variables).map(([name, declaration]) => ({ name, declaration })),
    assets: buildAssetCatalog(assetPaths),
    objectCount: index.objects.length,
    referenceCount: index.objects.reduce((total, object) => total + object.references.length, 0),
  };
}
