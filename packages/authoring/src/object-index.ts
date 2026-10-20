import { parseSceneStructure, serializeSceneDocument, splitInstruction } from './scene-document.js';
import { readTextCatalog } from './text-catalog.js';
import { buildAssetCatalog } from './asset-catalog.js';
import type { AuthoringObject, ProjectAssetCatalog, ProjectAssetFileFact } from './contracts.js';
import type { ProjectSnapshot, ProjectSnapshotScene } from './project-snapshot.js';
import { GALLERY_PATH, readGalleryDocument, type GalleryCgEntry } from './gallery-operations.js';
import { AuthoringOperationError } from './change-session.js';
import { readGalleryReplayEntries, readGalleryEndings, readGalleryDossiers, readProjectPlugins, type ProjectPluginDeclaration } from '@surdet/core';
import { timelineIdFromPath } from './timeline-identity.js';
import { PROJECT_UI_PAGES, readProjectUi, collectVars, parseExpr, resolveProjectFontPaths, isStoryTextSource, parseTerminology, type ProjectUiNode } from '@surdet/core';
import { parseProjectConfigDocument } from './config-document.js';
import {
  analyzeCharacterCompositionReferences,
  analyzeSceneCompositionReferences,
  analyzeTimelineCompositionReferences,
  CompositionReferenceAnalysisError,
} from './composition-reference-analysis.js';

export { buildSpeakerCharacterRefs } from './composition-reference-analysis.js';

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

function spanText(scene: ProjectSnapshotScene, span: { startLine: number; endLine: number }): string {
  return serializeSceneDocument(
    scene.document.slice(Math.max(0, span.startLine - 1), Math.max(span.startLine - 1, span.endLine)),
    scene.document.find((line) => line.eol === '\r\n') === undefined ? '\n' : '\r\n',
  );
}

function spanFingerprint(scene: ProjectSnapshotScene, span: { startLine: number; endLine: number }): string {
  return fingerprint(spanText(scene, span));
}

function containsSpan(outer: { startLine: number; endLine: number }, inner: { startLine: number; endLine: number }): boolean {
  return outer.endLine >= outer.startLine
    && outer.startLine <= inner.startLine
    && outer.endLine >= inner.endLine;
}

function sceneObject(scene: ProjectSnapshotScene): AuthoringObject {
  const first = scene.document[0];
  return {
    kind: 'scene',
    semanticId: `scene:${scene.id}`,
    objectRef: `scene:${scene.id}`,
    fingerprint: scene.file.sha256,
    source: sourceOf(scene.path, 1, first?.raw ?? ''),
    references: [],
    referencedBy: [],
    childRefs: [],
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

function addSceneObjects(
  snapshot: ProjectSnapshot,
  scene: ProjectSnapshotScene,
  objects: AuthoringObject[],
  candidates: Map<string, string[]>,
  characters: Record<string, unknown>,
): void {
  let rawReferences: ReturnType<typeof analyzeSceneCompositionReferences> = [];
  try {
    rawReferences = analyzeSceneCompositionReferences({
      sceneId: scene.id,
      path: scene.path,
      text: scene.file.text,
      characters,
    });
  } catch (error) {
    // Full scene compilation/validation owns malformed syntax. The analyzer
    // still exposes every parseable reference so an isolated bad choice does
    // not erase unrelated jump/speaker/asset edges from the index.
    if (error instanceof CompositionReferenceAnalysisError) rawReferences = error.partialReferences;
    else throw error;
  }
  const referencesByLine = new Map<number, string[]>();
  const kindOrder = new Map<string, number>([
    ['character', 0], ['variable', 1], ['timeline', 2], ['scene', 3], ['label', 4],
    ['background-asset', 5], ['portrait-asset', 6], ['avatar-asset', 7],
  ]);
  for (const reference of [...rawReferences].sort((left, right) => (
    (left.source.line ?? -1) - (right.source.line ?? -1)
    || (kindOrder.get(left.kind) ?? 99) - (kindOrder.get(right.kind) ?? 99)
    || left.token.localeCompare(right.token)
    || (left.objectRef ?? '').localeCompare(right.objectRef ?? '')
  ))) {
    if (reference.scope === 'non-composition' || reference.objectRef === undefined || reference.source.line === undefined) continue;
    const targets = referencesByLine.get(reference.source.line) ?? [];
    if (!targets.includes(reference.objectRef)) targets.push(reference.objectRef);
    referencesByLine.set(reference.source.line, targets);
    // Like timeline assets, these are referenced identities, not proof that a
    // physical file is resolved. The catalog and candidate guard own that fact.
    if (reference.kind.endsWith('-asset') && !objects.some(object => object.objectRef === reference.objectRef)) {
      // Asset identity belongs in the index, but must not masquerade as the
      // source-line object. Patch callers select the instruction/text object by
      // source.raw, while asset facts remain navigable through their own ref.
      addObject(objects, { kind: 'asset', semanticId: reference.objectRef, objectRef: reference.objectRef,
        references: [], referencedBy: [] }, candidates);
    }
  }
  const addLineReferences = (objectRef: string, lineNumber: number): void => {
    for (const target of referencesByLine.get(lineNumber) ?? []) addReferenceCandidate(candidates, objectRef, target);
  };

  addObject(objects, sceneObject(scene), candidates);
  const sceneRef = `scene:${scene.id}`;
  let currentChoiceRef: string | null = null;
  const lineObjects = new Map<number, AuthoringObject>();
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
        fingerprint: fingerprint(line.raw),
        references: [],
        referencedBy: [],
      };
      addObject(objects, object, candidates);
      lineObjects.set(lineNumber, object);
      addLineReferences(objectRef, lineNumber);
      continue;
    }
    if (line.kind === 'label') {
      currentChoiceRef = null;
      addObject(objects, {
        kind: 'label',
        semanticId: `label:${scene.id}.${line.name}`,
        objectRef: `label:${scene.id}.${line.name}`,
        fingerprint: fingerprint(line.raw),
        parentRef: sceneRef,
        source: sourceOf(scene.path, lineNumber, line.raw),
        references: [],
        referencedBy: [],
      }, candidates);
      continue;
    }
    if (line.kind === 'instr') {
      const { name, args } = splitInstruction(line.raw);
      const kind = name === 'choice' ? 'choice' : 'instruction';
      const objectRef = anonymousRef(snapshot.revision, scene.id, kind, lineNumber, line.raw);
      const object: AuthoringObject = {
        kind,
        objectRef,
        parentRef: sceneRef,
        source: sourceOf(scene.path, lineNumber, line.raw),
        fingerprint: fingerprint(line.raw),
        references: [],
        referencedBy: [],
      };
      addObject(objects, object, candidates);
      lineObjects.set(lineNumber, object);
      currentChoiceRef = name === 'choice' ? objectRef : null;
      addLineReferences(objectRef, lineNumber);
      continue;
    }
    if (line.kind === 'blank' || line.kind === 'comment') continue;
    currentChoiceRef = null;
    if (line.kind === 'text') {
      const textRef = anonymousRef(snapshot.revision, scene.id, 'text', lineNumber, line.raw);
      const object: AuthoringObject = {
        kind: 'text',
        objectRef: textRef,
        parentRef: sceneRef,
        source: sourceOf(scene.path, lineNumber, line.raw),
        fingerprint: fingerprint(line.raw),
        references: [],
        referencedBy: [],
      };
      addObject(objects, object, candidates);
      lineObjects.set(lineNumber, object);
      addLineReferences(textRef, lineNumber);
    }
  }

  // Publish exact compiled positions for stage edits, including multiple inline
  // instructions on one choice row. Authors must not derive these from line numbers.
  for (const instruction of scene.compiled.instructions) {
    if (instruction.op !== 'instr' || !['show', 'pose', 'layer'].includes(instruction.name)) continue;
    const object = lineObjects.get(instruction.line);
    if (!object || !['instruction', 'choice-option'].includes(object.kind)) continue;
    const details = (object.details ?? { stageInstructions: [] }) as { stageInstructions: unknown[] };
    details.stageInstructions.push({ instructionIndex: instruction.index, name: instruction.name,
      args: [...instruction.args], modifiers: Object.fromEntries(instruction.modifiers) });
    object.details = details;
  }

  // Structural objects are derived from the same Core parser facts as compilation.
  // Malformed scenes retain the line-level index above; structure facts are simply
  // unavailable until the scene parses again.
  let structureDocument: ReturnType<typeof parseSceneStructure> | undefined;
  try {
    structureDocument = parseSceneStructure(scene.file.text, scene.path, scene.id);
  } catch {
    structureDocument = undefined;
  }
  if (structureDocument === undefined) return;

  for (const choice of structureDocument.choices) {
    const choiceObject = lineObjects.get(choice.span.startLine);
    if (choiceObject?.kind !== 'choice') continue;
    const structureFingerprint = spanFingerprint(scene, choice.span);
    choiceObject.details = {
      structure: {
        kind: 'choice',
        fingerprint: structureFingerprint,
        span: choice.span,
        options: choice.options.map((option) => ({
          index: option.index,
          objectRef: lineObjects.get(option.span.startLine)?.objectRef,
          label: option.label,
          when: option.when,
          span: option.span,
        })),
      },
    };
  }

  const branchRefs = new Map<string, string>();
  for (const condition of structureDocument.conditions) {
    for (const branch of condition.branches) {
      branchRefs.set(`${condition.span.startLine}:${branch.span.startLine}`, `scene:${scene.id}/condition-branch:${branch.span.startLine}@${snapshot.revision.slice(0, 8)}-${spanFingerprint(scene, branch.span)}`);
    }
  }
  for (const condition of structureDocument.conditions) {
    const rootFingerprint = spanFingerprint(scene, condition.span);
    const conditionRef = `scene:${scene.id}/condition:${condition.span.startLine}@${snapshot.revision.slice(0, 8)}-${rootFingerprint}`;
    const branches = condition.branches.map((branch, index) => {
      const branchFingerprint = spanFingerprint(scene, branch.span);
      const branchRef = branchRefs.get(`${condition.span.startLine}:${branch.span.startLine}`)!;
      return {
        index,
        objectRef: branchRef,
        kind: branch.kind,
        expr: branch.expr,
        fingerprint: branchFingerprint,
        span: branch.span,
        bodySpan: branch.bodySpan,
      };
    });
    const enclosing = structureDocument.conditions
      .filter((outer) => outer !== condition)
      .flatMap((outer) => outer.branches.map((branch) => ({ outer, branch })))
      .filter(({ branch }) => containsSpan(branch.bodySpan, condition.span))
      .sort((left, right) => (
        (left.branch.bodySpan.endLine - left.branch.bodySpan.startLine)
        - (right.branch.bodySpan.endLine - right.branch.bodySpan.startLine)
      ))[0];
    const parentRef = enclosing === undefined
      ? sceneRef
      : branchRefs.get(`${enclosing.outer.span.startLine}:${enclosing.branch.span.startLine}`) ?? sceneRef;
    const header = scene.document[condition.span.startLine - 1];
    if (header === undefined) continue;
    const rootObject: AuthoringObject = {
      kind: 'condition',
      objectRef: conditionRef,
      parentRef,
      source: sourceOf(scene.path, condition.span.startLine, header.raw),
      fingerprint: rootFingerprint,
      references: [],
      referencedBy: [],
      childRefs: [],
      details: {
        structure: {
          kind: 'condition',
          fingerprint: rootFingerprint,
          span: condition.span,
          branches,
        },
      },
    };
    addObject(objects, rootObject, candidates);
    addLineReferences(conditionRef, condition.span.startLine);
    for (const branch of condition.branches) {
      const branchRef = branchRefs.get(`${condition.span.startLine}:${branch.span.startLine}`)!;
      const branchLine = scene.document[branch.span.startLine - 1];
      if (branchLine === undefined) continue;
      const branchObject: AuthoringObject = {
        kind: 'condition-branch',
        objectRef: branchRef,
        parentRef: conditionRef,
        source: sourceOf(scene.path, branch.span.startLine, branchLine.raw),
        fingerprint: spanFingerprint(scene, branch.span),
        references: [],
        referencedBy: [],
        details: {
          structure: {
            kind: 'condition-branch',
            fingerprint: spanFingerprint(scene, branch.span),
            span: branch.span,
            bodySpan: branch.bodySpan,
            index: condition.branches.indexOf(branch),
            conditionRef,
            branchKind: branch.kind,
            expr: branch.expr,
          },
        },
      };
      addObject(objects, branchObject, candidates);
      addLineReferences(branchRef, branch.span.startLine);
    }
  }
}

/** Wave 3：characters 角色表、avatar 资源与 entryScene 的配置对象与因果边。 */
function addConfigObjects(
  snapshot: ProjectSnapshot,
  objects: AuthoringObject[],
  candidates: Map<string, string[]>,
): void {
  const ensureAvatar = (avatar: string, source: { path: string; line: number; raw: string }): void => {
    const ref = `asset:avatar:${avatar}`;
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

  const configSource = (raw: string): { path: string; line: number; raw: string } => ({ path: 'game.config.json', line: 1, raw });
  const charactersValue = snapshot.config['characters'];
  if (typeof charactersValue === 'object' && charactersValue !== null && !Array.isArray(charactersValue)) {
    for (const [id, rawDeclaration] of Object.entries(charactersValue as Record<string, unknown>)) {
      const declaration = isRecordValue(rawDeclaration) ? rawDeclaration : null;
      const avatar = declaration?.['avatar'];
      const characterRef = `character:${id}`;
      const raw = typeof rawDeclaration === 'string' ? rawDeclaration : JSON.stringify(rawDeclaration);
      addObject(objects, {
        kind: 'character',
        semanticId: characterRef,
        objectRef: characterRef,
        source: sourceOf('game.config.json', 1, raw),
        references: [],
        referencedBy: [],
        ...(declaration === null ? {} : { details: declaration }),
      }, candidates);
      if (typeof avatar === 'string' && avatar.trim().length > 0) {
        for (const reference of analyzeCharacterCompositionReferences({ id, avatar })) {
          if (reference.objectRef === undefined) continue;
          ensureAvatar(avatar.trim(), configSource(raw));
          addReferenceCandidate(candidates, characterRef, reference.objectRef);
        }
      }
    }
  }

  const entryScene = snapshot.config['entryScene'];
  if (typeof entryScene === 'string' && entryScene.trim().length > 0) {
    addObject(objects, {
      kind: 'entry-scene',
      semanticId: 'config:entryScene',
      objectRef: 'config:entryScene',
      source: sourceOf('game.config.json', 1, JSON.stringify(entryScene)),
      references: [],
      referencedBy: [],
      details: entryScene,
    }, candidates);
    addReferenceCandidate(candidates, 'config:entryScene', `scene:${entryScene.trim()}`);
  }
}

function addUiObjects(snapshot: ProjectSnapshot, objects: AuthoringObject[], candidates: Map<string, string[]>): void {
  const rootRef = 'config:ui';
  const raw = JSON.stringify(snapshot.config.ui ?? null);
  addObject(objects, { kind: 'ui-config', semanticId: rootRef, objectRef: rootRef,
    source: sourceOf('game.config.json', 1, raw), fingerprint: fingerprint(raw),
    references: [], referencedBy: [], childRefs: [], details: snapshot.config.ui ?? null }, candidates);
  let ui: ReturnType<typeof readProjectUi>;
  try { ui = readProjectUi(snapshot.config); } catch { return; } // validateSnapshot owns the structural error.
  if (!ui) return;
  const fontPaths = resolveProjectFontPaths(snapshot.config);
  const ensureAsset = (ref: string, nodeRaw: string): void => {
    if (objects.some(object => object.objectRef === ref)) return;
    addObject(objects, { kind: 'asset', semanticId: ref, objectRef: ref,
      source: sourceOf('game.config.json', 1, nodeRaw), references: [], referencedBy: [] }, candidates);
  };
  const visit = (page: string, node: ProjectUiNode, parentRef: string): void => {
    const ref = `ui:${node.id}`;
    const nodeRaw = JSON.stringify(node);
    addObject(objects, { kind: 'ui-node', semanticId: ref, objectRef: ref, parentRef,
      source: sourceOf('game.config.json', 1, nodeRaw), fingerprint: fingerprint(nodeRaw),
      references: [], referencedBy: [], childRefs: [], details: { page, node } }, candidates);
    for (const asset of new Set([node.asset, node.style?.backgroundImage?.asset])) {
      if (!asset) continue;
      const assetRef = `asset:bg:${asset}`;
      ensureAsset(assetRef, nodeRaw);
      addReferenceCandidate(candidates, ref, assetRef);
      addReferenceCandidate(candidates, rootRef, assetRef);
    }
    for (const binding of [node.text, node.binding]) if (binding?.kind === 'variable') {
      addReferenceCandidate(candidates, ref, `variable:${binding.name}`);
      addReferenceCandidate(candidates, rootRef, `variable:${binding.name}`);
    }
    const conditionVariables = [node.visibleWhen, node.enabledWhen].flatMap(condition => condition === undefined ? [] : collectVars(parseExpr(condition)));
    if (node.action?.kind === 'variable-set') conditionVariables.push(node.action.name);
    for (const name of conditionVariables) {
      addReferenceCandidate(candidates, ref, `variable:${name}`);
      addReferenceCandidate(candidates, rootRef, `variable:${name}`);
    }
    {
      const path = fontPaths[node.style?.fontRole ?? 'ui'];
      if (path) {
        const assetRef = `asset:font:${path}`;
        ensureAsset(assetRef, nodeRaw);
        addReferenceCandidate(candidates, ref, assetRef);
        addReferenceCandidate(candidates, rootRef, assetRef);
      }
    }
    node.children?.forEach(child => visit(page, child, ref));
  };
  for (const page of PROJECT_UI_PAGES) {
    const root = ui.pages[page];
    if (!root) continue;
    const pageRef = `ui:page:${page}`;
    addObject(objects, { kind: 'ui-page', semanticId: pageRef, objectRef: pageRef, parentRef: rootRef,
      source: sourceOf('game.config.json', 1, JSON.stringify(root)), fingerprint: fingerprint(JSON.stringify(root)),
      references: [], referencedBy: [], childRefs: [], details: { page } }, candidates);
    visit(page, root, pageRef);
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  const name = timelineIdFromPath(timelinePath);
  const timelineRef = `timeline:${name}`;
  const timelineChildRefs: string[] = [];
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
    childRefs: timelineChildRefs,
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

  const tracks = definition['tracks'] as unknown[];
  tracks.forEach((rawTrack, trackIndex) => {
    const track = asRecord(rawTrack);
    if (track === null) return;
    const trackRef = `timeline:${name}/track:${trackIndex}`;
    timelineChildRefs.push(trackRef);
    const trackChildRefs: string[] = [];
    const trackRaw = JSON.stringify(track);
    addObject(objects, {
      kind: 'track',
      objectRef: trackRef,
      parentRef: timelineRef,
      source: sourceOf(timelinePath, 1, trackRaw),
      references: [],
      referencedBy: [],
      childRefs: trackChildRefs,
      details: track,
    }, candidates);
    const cues = Array.isArray(track['cues']) ? track['cues'] as unknown[] : [];
    cues.forEach((rawCue, cueIndex) => {
      const cue = asRecord(rawCue);
      if (cue === null) return;
      const cueRef = `timeline:${name}/track:${trackIndex}/cue:${cueIndex}`;
      trackChildRefs.push(cueRef);
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
      // Asset edges are populated below from the shared raw analyzer. Keeping
      // cue creation independent preserves malformed/opaque cue indexing.
    });
  });
  for (const reference of analyzeTimelineCompositionReferences({ timelineId: name, path: timelinePath, definition })) {
    const assetRef = reference.objectRef;
    const trackIndex = reference.source.trackIndex;
    const cueIndex = reference.source.cueIndex;
    if (assetRef === undefined || trackIndex === undefined || cueIndex === undefined) continue;
    const cueRef = `timeline:${name}/track:${trackIndex}/cue:${cueIndex}`;
    const trackRef = `timeline:${name}/track:${trackIndex}`;
    const cue = definition['tracks'] && Array.isArray(definition['tracks'])
      ? asRecord(definition['tracks'][trackIndex])?.['cues']
      : undefined;
    const cueValue = Array.isArray(cue) ? asRecord(cue[cueIndex]) : null;
    ensureAsset(assetRef, { path: timelinePath, line: 1, raw: cueValue === null ? timelineText : JSON.stringify(cueValue) });
    addReferenceCandidate(candidates, cueRef, assetRef);
    addReferenceCandidate(candidates, trackRef, assetRef);
    addReferenceCandidate(candidates, timelineRef, assetRef);
  }
}

export function buildObjectIndex(snapshot: ProjectSnapshot): ObjectIndex {
  const objects: AuthoringObject[] = [];
  const candidates = new Map<string, string[]>();
  const charactersValue = snapshot.config['characters'];
  const characters = typeof charactersValue === 'object' && charactersValue !== null && !Array.isArray(charactersValue)
    ? charactersValue as Record<string, unknown>
    : {};
  for (const scene of snapshot.scenes) addSceneObjects(snapshot, scene, objects, candidates, characters);
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
  addConfigObjects(snapshot, objects, candidates);
  addUiObjects(snapshot, objects, candidates);
  const terminology = snapshot.files.find(file => file.path === 'content/config/terminology.json');
  if (terminology) {
    try {
      for (const term of parseTerminology(parseProjectConfigDocument(terminology.text, terminology.path))) {
        const ref = `term:${term.canonical}`;
        addObject(objects, { kind: 'term', objectRef: ref, semanticId: ref, details: term,
          source: sourceOf(terminology.path, 1, JSON.stringify(term)), fingerprint: fingerprint(JSON.stringify(term)), references: [], referencedBy: [] }, candidates);
      }
    } catch { /* Config validation reports malformed terminology; other objects remain inspectable. */ }
  }
  try {
    const catalog = readTextCatalog(snapshot.config);
    addObject(objects, { kind: 'text-catalog', objectRef: 'config:textCatalog', references: [], referencedBy: [], details: catalog }, candidates);
    for (const entry of catalog?.entries ?? []) {
      const ref = `text-key:${entry.key}`;
      addObject(objects, { kind: 'text-key', objectRef: ref, semanticId: ref, parentRef: 'config:textCatalog',
        references: [], referencedBy: [], details: entry }, candidates);
      if (isStoryTextSource(entry.source)) {
        addReferenceCandidate(candidates, ref, `scene:${entry.source.sceneId}`);
        if (entry.source.label !== null) addReferenceCandidate(candidates, ref, `label:${entry.source.sceneId}.${entry.source.label}`);
      } else addReferenceCandidate(candidates, ref, entry.source.objectRef);
      for (const voice of Object.values(entry.voices ?? {})) {
        const assetRef = `asset:voice:${voice.asset}`;
        if (!objects.some(object => object.objectRef === assetRef)) addObject(objects, {
          kind: 'asset', semanticId: assetRef, objectRef: assetRef, references: [], referencedBy: [],
        }, candidates);
        addReferenceCandidate(candidates, ref, assetRef);
      }
    }
  } catch { /* Shared validation reports malformed catalog data; keep other objects inspectable. */ }
  let cgs: GalleryCgEntry[] = [];
  try {
    cgs = readGalleryDocument(snapshot.files.find((file) => file.path === GALLERY_PATH)?.text).cgs;
  } catch (error) {
    // Shared validation reports malformed gallery data; the remaining project stays inspectable.
    if (!(error instanceof AuthoringOperationError)) throw error;
  }
  for (const entry of cgs) {
    const objectRef = `gallery:cgs:${entry.id}`;
    const assetRef = `asset:bg:${entry.src ?? entry.id}`;
    addObject(objects, {
      kind: 'gallery-cg', semanticId: objectRef, objectRef, details: entry,
      source: sourceOf(GALLERY_PATH, 1, JSON.stringify(entry)), references: [], referencedBy: [],
    }, candidates);
    if (!objects.some((object) => object.objectRef === assetRef)) addObject(objects, {
      kind: 'asset', semanticId: assetRef, objectRef: assetRef, references: [], referencedBy: [],
    }, candidates);
    addReferenceCandidate(candidates, objectRef, assetRef);
  }
  for (const timeline of snapshot.timelines) addTimelineObjects(timeline.path, timeline.text, objects, candidates);
  try {
    const { document } = readGalleryDocument(snapshot.files.find(file => file.path === GALLERY_PATH)?.text);
    const dossiers = readGalleryDossiers(document);
    for (const section of ['profiles', 'terms'] as const) for (const entry of dossiers[section]) {
      const ref = `gallery:${section}:${entry.id}`;
      addObject(objects, { kind: section === 'profiles' ? 'gallery-profile' : 'gallery-term', semanticId: ref, objectRef: ref, details: entry,
        source: sourceOf(GALLERY_PATH, 1, JSON.stringify(entry)), references: [], referencedBy: [] }, candidates);
      addReferenceCandidate(candidates, ref, section === 'profiles' ? `character:${entry.character}` : `term:${entry.canonical}`);
    }
    for (const entry of readGalleryEndings(document)) {
      const ref = `gallery:endings:${entry.id}`;
      addObject(objects, { kind: 'gallery-ending', semanticId: ref, objectRef: ref, details: entry,
        source: sourceOf(GALLERY_PATH, 1, JSON.stringify(entry)), references: [], referencedBy: [] }, candidates);
    }
    for (const entry of readGalleryReplayEntries(document)) {
      const ref = `gallery:texts:${entry.id}`;
      addObject(objects, { kind: 'gallery-text', semanticId: ref, objectRef: ref, details: entry,
        source: sourceOf(GALLERY_PATH, 1, JSON.stringify(entry)), references: [], referencedBy: [] }, candidates);
      addReferenceCandidate(candidates, ref, `scene:${entry.scene}`);
      if (entry.label !== undefined) addReferenceCandidate(candidates, ref, `label:${entry.scene}.${entry.label}`);
      for (const name of Object.keys(entry.variables ?? {})) addReferenceCandidate(candidates, ref, `variable:${name}`);
    }
  } catch { /* Shared validation reports malformed replay entries; other objects remain inspectable. */ }

  const byRef = new Map(objects.map((object) => [object.objectRef, object]));
  for (const object of objects) {
    const parent = object.parentRef === undefined ? undefined : byRef.get(object.parentRef);
    if (parent?.kind === 'scene' || parent?.kind === 'choice' || parent?.kind === 'condition' || parent?.kind === 'condition-branch' || parent?.kind === 'ui-config' || parent?.kind === 'ui-page' || parent?.kind === 'ui-node') {
      (parent.childRefs ??= []).push(object.objectRef);
    }
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

export interface SceneFragmentInput {
  fromLine?: number;
  limit?: number;
  expectedRevision?: string;
  expectedWorkingRevision?: number;
}

/** Raw source and exact references are projected from the same immutable snapshot. */
export function inspectSceneFragment(snapshot: ProjectSnapshot, index: ObjectIndex, object: AuthoringObject, input: SceneFragmentInput, workingRevision?: number) {
  if (object.kind !== 'scene') throw new AuthoringOperationError('UNSUPPORTED_OBJECT_KIND', '正文片段只支持 scene 对象');
  const fromLine = input.fromLine ?? 1;
  const limit = input.limit ?? 100;
  const scene = snapshot.scenes.find((item) => item.path === object.source?.path)!;
  if (!Number.isInteger(fromLine) || fromLine < 1 || fromLine > Math.max(1, scene.document.length)
    || !Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new AuthoringOperationError('INVALID_REQUEST', '片段起始行必须在场景内，limit 必须是 1..200 的整数');
  }
  if (fromLine > 1 && (input.expectedRevision === undefined || (workingRevision !== undefined && input.expectedWorkingRevision === undefined))) {
    throw new AuthoringOperationError('INVALID_REQUEST', '续页必须携带首页的 revision；working 还需 workingRevision');
  }
  if ((input.expectedRevision !== undefined && input.expectedRevision !== snapshot.revision)
    || (input.expectedWorkingRevision !== undefined && input.expectedWorkingRevision !== workingRevision)) {
    throw new AuthoringOperationError('OBJECT_REF_STALE', '场景版本已变化，请从第一页重新读取');
  }
  const lines = scene.document.slice(fromLine - 1, fromLine - 1 + limit).map((line, offset) => ({
    line: fromLine + offset, text: line.raw, eol: line.eol,
    objectRefs: index.objects.filter((item) => item.source?.path === scene.path && item.source.line === fromLine + offset).map((item) => item.objectRef),
  }));
  const nextLine = fromLine + lines.length;
  return {
    revision: snapshot.revision, ...(workingRevision === undefined ? {} : { workingRevision }),
    fromLine, totalLines: scene.document.length, truncated: nextLine <= scene.document.length,
    ...(nextLine <= scene.document.length ? { nextLine } : {}), lines,
  };
}

export interface ProjectInspection {
  rootIdentity: string;
  revision: string;
  entryScene?: string;
  title?: string;
  scenes: { id: string; path: string }[];
  variables: { name: string; declaration: unknown }[];
  /** 角色表（Wave 3）：id/name/avatar/declaration。 */
  characters: { id: string; name?: string; avatar?: string; declaration: unknown }[];
  /** 只读资源目录（共享 asset catalog 解析结果）；输入仅是资产路径元数据。 */
  assets: ProjectAssetCatalog;
  /** Data only: inspection never imports code or grants trust. */
  plugins: ProjectPluginDeclaration[];
  objectCount: number;
  referenceCount: number;
}

export function inspectProject(
  snapshot: ProjectSnapshot,
  index = buildObjectIndex(snapshot),
  assetFiles: readonly (string | ProjectAssetFileFact)[] = [],
  gallery?: unknown,
): ProjectInspection {
  const charactersValue = snapshot.config['characters'];
  const characters = typeof charactersValue === 'object' && charactersValue !== null && !Array.isArray(charactersValue)
    ? Object.entries(charactersValue as Record<string, unknown>).map(([id, declaration]) => {
        const record = isRecordValue(declaration) ? declaration : {};
        return {
          id,
          ...(typeof record['name'] === 'string' ? { name: record['name'] } : {}),
          ...(typeof record['avatar'] === 'string' ? { avatar: record['avatar'] } : {}),
          declaration: record,
        };
      })
    : [];
  const title = typeof snapshot.config['title'] === 'string' ? snapshot.config['title'] : undefined;
  return {
    rootIdentity: snapshot.rootIdentity,
    revision: snapshot.revision,
    ...(snapshot.entryScene === undefined ? {} : { entryScene: snapshot.entryScene }),
    ...(title === undefined ? {} : { title }),
    scenes: snapshot.scenes.map((scene) => ({ id: scene.id, path: scene.path })),
    variables: Object.entries(snapshot.variables).map(([name, declaration]) => ({ name, declaration })),
    characters,
    assets: buildAssetCatalog(assetFiles, snapshot, { gallery }),
    plugins: readProjectPlugins({ plugins: snapshot.config.plugins }),
    objectCount: index.objects.length,
    referenceCount: index.objects.reduce((total, object) => total + object.references.length, 0),
  };
}
