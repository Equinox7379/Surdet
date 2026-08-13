import { splitInstruction, type SceneDocumentLine } from './scene-document.js';
import type { AuthoringObject } from './contracts.js';
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
  candidates.get(objectRef)?.push(target);
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
      const target = /->\s*@(?:goto|jump)\s+([^\s]+)/.exec(line.raw)?.[1];
      if (target !== undefined) {
        addReferenceCandidate(candidates, objectRef, target.includes('.') ? `scene:${target.split('.')[0]}` : `label:${scene.id}.${target}`);
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
      if (name === 'goto' || name === 'loop') {
        const target = args.join(' ');
        addReferenceCandidate(candidates, objectRef, `label:${scene.id}.${target}`);
      } else if (name === 'jump' || name === 'call') {
        const target = args.join(' ').split('.')[0] ?? '';
        if (target.length > 0) addReferenceCandidate(candidates, objectRef, `scene:${target}`);
      } else if (name === 'set' || name === 'mod' || ['inc', 'dec', 'toggle', 'flag', 'unflag'].includes(name)) {
        const variable = args[0];
        if (variable !== undefined && variable.length > 0) addReferenceCandidate(candidates, objectRef, `variable:${variable}`);
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
  for (const timeline of snapshot.timelines) {
    const name = timeline.path.slice(timeline.path.lastIndexOf('/') + 1, -'.json'.length);
    addObject(objects, {
      kind: 'timeline',
      semanticId: `timeline:${name}`,
      objectRef: `timeline:${name}`,
      source: sourceOf(timeline.path, 1, timeline.text),
      references: [],
      referencedBy: [],
    }, candidates);
  }

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
  assets: string[];
  objectCount: number;
  referenceCount: number;
}

export function inspectProject(snapshot: ProjectSnapshot, index = buildObjectIndex(snapshot)): ProjectInspection {
  return {
    rootIdentity: snapshot.rootIdentity,
    revision: snapshot.revision,
    ...(snapshot.entryScene === undefined ? {} : { entryScene: snapshot.entryScene }),
    scenes: snapshot.scenes.map((scene) => ({ id: scene.id, path: scene.path })),
    variables: Object.entries(snapshot.variables).map(([name, declaration]) => ({ name, declaration })),
    assets: [],
    objectCount: index.objects.length,
    referenceCount: index.objects.reduce((total, object) => total + object.references.length, 0),
  };
}
