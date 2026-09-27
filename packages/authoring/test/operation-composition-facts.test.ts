import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginChange, InMemoryChangeRepository, openChange, recordValidation, runOperation, type ChangeSession } from '../src/change-session.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { buildObjectIndex } from '../src/object-index.js';
import { applySceneCreate, applyScenePatch, ensureVariable } from '../src/operations.js';
import { applyCharacterEnsure, applyCharacterRemove, applyEntrySceneSet, charactersFingerprint, entrySceneFingerprint } from '../src/config-operations.js';
import { applyTimelineCreate, applyTimelinePatch, timelineFingerprint } from '../src/timeline-operations.js';
import { createCandidateOperationPrePersistHook, resolveOperationRequirementsAtSequence, resolveReplayStateRequirementsAtSequence } from '../src/candidate-composition-guard.js';
import { inspectCandidateCompositionReadiness } from '../src/candidate-readiness.js';
import { stableStringify } from '../src/change-session.js';
import { buildCompositionManifest } from '../src/composition-manifest.js';
import type { SceneBlockInput } from '../src/contracts.js';
import { buildReplayStateBaseObjects } from '../src/composition-object-facts.js';

const hasher = { sha256: async (text: string) => createHash('sha256').update(text).digest('hex') };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const config = (change: ChangeSession) => JSON.parse(change.record.workingFiles['game.config.json']!);
const facts = (change: ChangeSession, id: string) => change.record.operations[id]!.compositionFacts!;

async function seal(change: ChangeSession) {
  return buildCompositionManifest({
    record: change.record, projectIdentity: 'wave8-fixture', semanticDiff: [],
    invocationFacts: Object.entries(change.record.operations).map(([operationId, operation]) => ({
      operationId, capabilityId: operation.compositionFacts!.capabilityId, inputSha256: sha(operation.requestHash), ok: true,
    })),
    objectFacts: {
      baseObjects: [{ objectRef: 'scene:A', references: [], fingerprint: change.record.baseFiles['content/scenario/A.gal']!.sha256 }, { objectRef: 'config:entryScene', references: ['scene:A'] }],
      baseReplayStates: [
        { objectRef: 'config:characters', expectedFingerprint: sha('{}') },
        { objectRef: 'config:fonts', expectedFingerprint: sha('{}') },
        { objectRef: 'config:stage', expectedFingerprint: sha('null') },
      { objectRef: 'config:portraits', expectedFingerprint: sha('[]') },
        { objectRef: 'scene:A', expectedFingerprint: sha('@scene A\n旁白：开场。\n@end\n') },
      ],
      workingObjects: [], baseAssetRefs: change.record.composition!.baseAssetRefs, workingAssetRefs: change.record.composition!.baseAssetRefs,
    },
  }, hasher);
}

async function candidate(baseAssetRefs: string[] = []) {
  const files = {
    'game.config.json': '{"entryScene":"A","variables":{},"characters":{}}',
    'content/scenario/A.gal': '@scene A\n旁白：开场。\n@end\n',
  };
  const snapshot = await loadProjectSnapshot({
    rootIdentity: 'wave8-fixture', listFiles: async () => Object.keys(files),
    exists: async (path) => path in files,
    readText: async (path) => { const text = files[path as keyof typeof files]; return { path, text, bytes: text.length, sha256: sha(text) }; },
  }, hasher);
  const repository = new InMemoryChangeRepository();
  const hook = createCandidateOperationPrePersistHook({ baseObjects: buildObjectIndex(snapshot).objects, baseAssetRefs, baseReplayStates: await buildReplayStateBaseObjects(snapshot, hasher) });
  return beginChange(snapshot, repository, undefined, undefined, {
    composition: { mode: 'candidate', operationFactsVersion: '1.0.0', baseAssetRefs }, beforeOperationPersist: hook,
  });
}

async function insert(change: ChangeSession, operationId: string, sceneId: string, blocks: SceneBlockInput[]) {
  const snapshot = await loadProjectSnapshot({
    rootIdentity: 'wave8-fixture', listFiles: async () => Object.keys(change.record.workingFiles),
    exists: async (path) => path in change.record.workingFiles,
    readText: async (path) => { const text = change.record.workingFiles[path]!; return { path, text, bytes: text.length, sha256: sha(text) }; },
  }, hasher);
  const anchor = buildObjectIndex(snapshot).objects.find((object) => object.objectRef.startsWith(`scene:${sceneId}/`) && object.source?.line === 1)!;
  return applyScenePatch(change, { operationId, sceneId, patch: { kind: 'insertAfter', anchor: anchor.objectRef, expectedFingerprint: anchor.fingerprint!, blocks } }, hasher);
}

describe('candidate operation-time facts', () => {
  it('rejects unresolved media before writing, then seals scene and audio timeline dependencies', async () => {
    const blocks: SceneBlockInput[] = ['bgm', 'ambience', 'se', 'voice', 'video'].map(name => ({ kind: 'instruction', name, args: ['"同名 素材"'] }));
    const missing = await candidate(); const before = structuredClone(missing.record);
    await expect(applySceneCreate(missing, { operationId: 'media', sceneId: 'media', blocks }, hasher)).rejects.toMatchObject({
      code: 'CANDIDATE_DEPENDENCY_NOT_READY', details: { issues: expect.arrayContaining([
        expect.objectContaining({ code: 'ASSET_NOT_RESOLVED', objectRef: 'asset:voice:同名 素材' }),
        expect.objectContaining({ code: 'ASSET_NOT_RESOLVED', objectRef: 'asset:video:同名 素材' }),
      ]) },
    });
    expect(missing.record).toEqual(before);
    const refs = ['bgm', 'ambience', 'se', 'voice', 'video'].map(channel => `asset:${channel}:同名 素材`);
    const ready = await candidate(refs);
    await applySceneCreate(ready, { operationId: 'media', sceneId: 'media', blocks }, hasher);
    await applyTimelineCreate(ready, { operationId: 'timeline', timelineId: 'sound', definition: { version: 1, id: 'sound', durationMs: 1,
      tracks: [{ kind: 'audio', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'voice', key: '同名 素材' }] }] } }, hasher);
    expect(facts(ready, 'media').requiredObjects.map(ref => ref.objectRef).sort()).toEqual(refs.sort());
    expect(facts(ready, 'timeline').requiredObjects).toEqual([{ objectRef: 'asset:voice:同名 素材', source: 'base' }]);
    const sealed = await seal(ready);
    expect(sealed.eligibility, JSON.stringify(sealed)).toBe('ready');
  });
  it('returns the same early missing-producer contract for an entry-scene mutation', async () => {
    const change = await candidate();
    const before = structuredClone(change.record);
    await expect(applyEntrySceneSet(change, { operationId: 'missing-entry', sceneId: 'missing', expectedFingerprint: await entrySceneFingerprint(config(change), hasher) }, hasher)).rejects.toMatchObject({
      code: 'CANDIDATE_DEPENDENCY_NOT_READY', details: { capabilityId: 'project.entry-scene.set', issues: [expect.objectContaining({ objectRef: 'scene:missing', suggestedCapabilities: ['scene.create'] })] },
    });
    expect(change.record).toEqual(before);
  });

  it('retains an ambiguous portrait reference instead of claiming no asset dependency', async () => {
    const change = await candidate();
    await expect(applySceneCreate(change, { operationId: 'ambiguous', sceneId: 'portrait', blocks: [{ kind: 'instruction', name: 'show', args: ['rin', 'smile'] }] }, hasher)).rejects.toMatchObject({
      code: 'CANDIDATE_DEPENDENCY_NOT_READY', details: { issues: [expect.objectContaining({ code: 'REFERENCE_TARGET_AMBIGUOUS', kind: 'portrait-asset', token: 'rin:smile' })] },
    });
    expect(change.record.workingRevision).toBe(0);
  });

  it('does not attribute a later scene reference to earlier content; keeps removed references in history', async () => {
    const change = await candidate();
    await insert(change, '10', 'A', [{ kind: 'text', value: '先写对白。' }]);
    await applySceneCreate(change, { operationId: '2', sceneId: 'B' }, hasher);
    await insert(change, 'op2', 'A', [{ kind: 'instruction', name: 'jump', args: ['B'] }]);
    expect(facts(change, '10').requiredObjects).toEqual([]);
    expect(facts(change, 'op2').requiredObjects).toEqual([{ objectRef: 'scene:B', source: 'candidate', candidateOperationSequence: 1, expectedFingerprint: facts(change, '2').objectFingerprintAfter }]);
    expect(change.record.operations['10']!.sequence).toBe(0);
    expect(change.record.operations['2']!.sequence).toBe(1);
    expect(facts(change, '10').objectFingerprintAfter).not.toBe(facts(change, 'op2').objectFingerprintAfter);
    const earlier = structuredClone(facts(change, 'op2'));
    const document = change.record.workingFiles['content/scenario/A.gal']!;
    const jumpLine = document.split('\n').findIndex((line) => line === '@jump B') + 1;
    let digest = 0x811c9dc5;
    for (const char of '@jump B') { digest ^= char.charCodeAt(0); digest = Math.imul(digest, 0x01000193); }
    const fingerprint = (digest >>> 0).toString(16).padStart(8, '0');
    await applyScenePatch(change, { operationId: 'remove-jump', sceneId: 'A', patch: { kind: 'removeObject', target: `scene:A/instr:${jumpLine}@${fingerprint}`, expectedFingerprint: fingerprint } }, hasher);
    expect(facts(change, 'op2')).toEqual(earlier);
    expect(facts(change, 'remove-jump').requiredObjects).toEqual([]);
    expect(inspectCandidateCompositionReadiness(change.record).status).toBe('ready');
    const capsule = await seal(change);
    expect(capsule.eligibility).toBe('ready');
    if (capsule.eligibility !== 'ready') throw new Error(JSON.stringify(capsule.reasons));
    expect(capsule.manifest.operations.map((operation) => operation.sourceOperationId)).toEqual(['10', '2', 'op2', 'remove-jump']);
    expect(capsule.manifest.operations[0]!.requiredObjects).toEqual([]);
    expect(capsule.manifest.operations[2]!.requiredObjects).toEqual(earlier.requiredObjects);
  });

  it('rejects all missing dependencies without touching record or evidence, then accepts the same operation after creation', async () => {
    const change = await candidate();
    await recordValidation(change, { evidenceId: 'fresh', errors: 0 });
    const before = structuredClone(change.record);
    const input = { operationId: 'entry', sceneId: 'entry', blocks: [
      { kind: 'instruction' as const, name: 'bg', args: ['missing-background'] },
      { kind: 'instruction' as const, name: 'jump', args: ['ending'] },
    ] };
    await expect(applySceneCreate(change, input, hasher)).rejects.toMatchObject({ code: 'CANDIDATE_DEPENDENCY_NOT_READY', details: {
      operationApplied: false, capabilityId: 'scene.create', workingRevisionBefore: 0, workingRevisionAfter: 0,
      issues: expect.arrayContaining([expect.objectContaining({ objectRef: 'scene:ending' }), expect.objectContaining({ objectRef: 'asset:bg:missing-background' })]),
    } });
    expect(change.record).toEqual(before);
    expect(await change.repository.read(before.changeId)).toEqual(before);
    const entry = { ...input, blocks: [input.blocks[1]!] };
    await expect(applySceneCreate(change, entry, hasher)).rejects.toMatchObject({ code: 'CANDIDATE_DEPENDENCY_NOT_READY' });
    await applySceneCreate(change, { operationId: 'ending', sceneId: 'ending' }, hasher);
    await applySceneCreate(change, entry, hasher);
    expect(change.record.operations['entry']!.sequence).toBe(1);
  });

  it.each(['Continue', '未闭合的 "文案', "未闭合的 '文案"])('keeps dependencies after %s through rejection, retry and sealing', async label => {
    const change = await candidate(['asset:bg:night']);
    const before = structuredClone(change.record);
    const input = { operationId: 'quoted-choice', sceneId: 'entry', blocks: [{ kind: 'choice' as const, options: [{
      label, when: 'flag && " -> " == " -> "', effects: [{ name: 'bg', args: ['"night"'] }], target: { kind: 'jump' as const, value: 'ending' },
    }] }] };
    await expect(applySceneCreate(change, input, hasher)).rejects.toMatchObject({
      code: 'CANDIDATE_DEPENDENCY_NOT_READY', details: { issues: expect.arrayContaining([
        expect.objectContaining({ objectRef: 'variable:flag' }), expect.objectContaining({ objectRef: 'scene:ending' }),
      ]) },
    });
    expect(change.record).toEqual(before);
    expect(await change.repository.read(before.changeId)).toEqual(before);
    await ensureVariable(change, { operationId: 'flag', name: 'flag', type: 'flag', initial: true }, hasher);
    await applySceneCreate(change, { operationId: 'ending', sceneId: 'ending' }, hasher);
    await applySceneCreate(change, input, hasher);
    const dependencies = facts(change, input.operationId).requiredObjects;
    expect(dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectRef: 'asset:bg:night', source: 'base' }),
      expect.objectContaining({ objectRef: 'variable:flag', source: 'candidate', candidateOperationSequence: 0 }),
      expect.objectContaining({ objectRef: 'scene:ending', source: 'candidate', candidateOperationSequence: 1 }),
    ]));
    const sealed = await seal(change);
    expect(sealed.eligibility).toBe('ready');
    if (sealed.eligibility !== 'ready') throw new Error(JSON.stringify(sealed.reasons));
    expect(sealed.manifest.operations.find(operation => operation.sourceOperationId === input.operationId)!.requiredObjects).toEqual(dependencies);
  });

  it('rejects the second edge between newly created primary units before persistence', async () => {
    const change = await candidate();
    await applySceneCreate(change, { operationId: 'a', sceneId: 'newA' }, hasher);
    await applySceneCreate(change, { operationId: 'b', sceneId: 'newB' }, hasher);
    await insert(change, 'a-to-b', 'newA', [{ kind: 'instruction', name: 'jump', args: ['newB'] }]);
    const before = structuredClone(change.record);
    await expect(insert(change, 'b-to-a', 'newB', [{ kind: 'instruction', name: 'jump', args: ['newA'] }])).rejects.toMatchObject({
      code: 'CANDIDATE_DEPENDENCY_CYCLE', details: { operationApplied: false, unsupportedRecovery: 'mutual-empty-skeleton', cycles: [expect.objectContaining({ primaryObjects: ['scene:newA', 'scene:newB'] })] },
    });
    expect(change.record).toEqual(before);
    expect(await change.repository.read(before.changeId)).toEqual(before);
    expect(inspectCandidateCompositionReadiness(change.record).status).toBe('ready');
  });

  it('keeps local goto and a self-scene jump inside their primary unit', async () => {
    const change = await candidate();
    await applySceneCreate(change, { operationId: 'local', sceneId: 'local', blocks: [
      { kind: 'label', name: 'again' },
      { kind: 'instruction', name: 'goto', args: ['again'] },
      { kind: 'instruction', name: 'jump', args: ['local'] },
    ] }, hasher);
    expect(facts(change, 'local').requiredObjects).toEqual([]);
    expect(inspectCandidateCompositionReadiness(change.record).status).toBe('ready');
  });

  it('records no-change facts without incrementing workingRevision', async () => {
    const change = await candidate();
    const declaration = { name: 'flag', type: 'int' as const, initial: 0 };
    await ensureVariable(change, { ...declaration, operationId: 'first' }, hasher);
    await ensureVariable(change, { ...declaration, operationId: 'same' }, hasher);
    expect(change.record.workingRevision).toBe(1);
    expect(change.record.operations['same']!.sequence).toBe(1);
    expect(facts(change, 'same').producedObjects[0]).toMatchObject({ disposition: 'update', finalFingerprint: facts(change, 'first').objectFingerprintAfter });
  });

  it('captures each character table, migration and removal at its operation time', async () => {
    const change = await candidate(['asset:avatar:rin']);
    await insert(change, 'dialogue', 'A', [{ kind: 'text', speaker: '凛', value: '旧名字。' }]);
    await applyCharacterEnsure(change, { operationId: 'rin', id: 'rin', name: '凛', avatar: 'rin', expectedFingerprint: await charactersFingerprint(config(change), hasher) }, hasher);
    await applyCharacterEnsure(change, { operationId: 'rename', id: 'rin', name: '小凛', expectedFingerprint: await charactersFingerprint(config(change), hasher) }, hasher);
    const created = structuredClone(facts(change, 'rin'));
    const renamed = structuredClone(facts(change, 'rename'));
    expect(renamed.replayStateRequirements).toEqual([
      { objectRef: 'config:characters', source: 'candidate', candidateOperationSequence: 1, expectedFingerprint: created.producedObjects.find((item) => item.objectRef === 'config:characters')!.finalFingerprint },
      { objectRef: 'scene:A', source: 'candidate', candidateOperationSequence: 0, expectedFingerprint: facts(change, 'dialogue').objectFingerprintAfter },
    ]);
    expect(renamed.producedObjects).toContainEqual({ objectRef: 'scene:A', disposition: 'update', finalFingerprint: sha(change.record.workingFiles['content/scenario/A.gal']!) });
    await applyCharacterRemove(change, { operationId: 'remove', id: 'rin', expectedFingerprint: await charactersFingerprint(config(change), hasher) }, hasher);
    expect(facts(change, 'rin')).toEqual(created);
    expect(facts(change, 'rename')).toEqual(renamed);
    expect(created.producedObjects.find((item) => item.objectRef === 'config:characters')!.finalFingerprint).not.toBe(renamed.producedObjects.find((item) => item.objectRef === 'config:characters')!.finalFingerprint);
    expect(facts(change, 'remove').producedObjects).toContainEqual({ objectRef: 'character:rin', disposition: 'remove' });
    expect(facts(change, 'remove').producedObjects).toContainEqual({ objectRef: 'config:characters', disposition: 'update', finalFingerprint: sha('{}') });
    expect(facts(change, 'remove').replayStateRequirements).toEqual([{ objectRef: 'config:characters', source: 'candidate', candidateOperationSequence: 2, expectedFingerprint: renamed.producedObjects.find((item) => item.objectRef === 'config:characters')!.finalFingerprint }]);
  });

  it('rejects a state-only cycle between character units without changing record or evidence', async () => {
    const change = await candidate();
    for (const id of ['zeta', 'alpha']) await applyCharacterEnsure(change, { operationId: id, id, name: id, expectedFingerprint: await charactersFingerprint(config(change), hasher) }, hasher);
    await recordValidation(change, { evidenceId: 'state-cycle', errors: 0 });
    const before = structuredClone(change.record);
    await expect(applyCharacterEnsure(change, { operationId: 'zeta-again', id: 'zeta', name: 'Zeta', expectedFingerprint: await charactersFingerprint(config(change), hasher) }, hasher)).rejects.toMatchObject({ code: 'CANDIDATE_DEPENDENCY_CYCLE' });
    expect(change.record).toEqual(before);
    expect(await change.repository.read(before.changeId)).toEqual(before);
  });

  it('rejects migration back into a scene that already depends on this candidate character', async () => {
    const change = await candidate();
    await applyCharacterEnsure(change, { operationId: 'rin', id: 'rin', name: '凛', expectedFingerprint: await charactersFingerprint(config(change), hasher) }, hasher);
    await insert(change, 'dialogue', 'A', [{ kind: 'text', speaker: '凛', value: '旧名字。' }]);
    const before = structuredClone(change.record);
    await expect(applyCharacterEnsure(change, { operationId: 'rename', id: 'rin', name: '小凛', expectedFingerprint: await charactersFingerprint(config(change), hasher) }, hasher)).rejects.toMatchObject({ code: 'CANDIDATE_DEPENDENCY_CYCLE' });
    expect(change.record).toEqual(before);
    expect(await change.repository.read(before.changeId)).toEqual(before);
  });

  it.each(['missing', 'mismatch'])('rejects %s replay state facts before CAS and retains evidence', async (mode) => {
    const change = await candidate();
    await recordValidation(change, { evidenceId: 'untouched', errors: 0 });
    const before = structuredClone(change.record);
    const input = { operationId: 'bad-state', id: 'rin', expectedFingerprint: sha('{}') };
    await expect(runOperation(change, input, async () => ({
      result: {}, workingFiles: { ...change.record.workingFiles, 'game.config.json': '{}' },
      compositionDraft: { capabilityId: 'character.ensure', primaryObject: 'character:rin', rawReferences: [],
        producedObjects: [{ objectRef: 'character:rin', disposition: 'create', finalFingerprint: 'rin' }, { objectRef: 'config:characters', disposition: 'update', finalFingerprint: 'table-after' }], objectFingerprintAfter: 'rin',
        ...(mode === 'missing' ? {} : { replayStatePreconditions: [{ objectRef: 'config:characters', expectedFingerprint: 'not-in-base-or-history' }] }),
      },
    }))).rejects.toMatchObject({ code: 'CANDIDATE_OPERATION_FACTS_REQUIRED' });
    expect(change.record).toEqual(before);
    expect(await change.repository.read(before.changeId)).toEqual(before);
  });

  it('resolves the last matching state producer before falling back to base', async () => {
    const change = await candidate();
    await applyCharacterEnsure(change, { operationId: 'first', id: 'rin', name: '凛', expectedFingerprint: sha('{}') }, hasher);
    const state = await charactersFingerprint(config(change), hasher);
    await applyCharacterEnsure(change, { operationId: 'same', id: 'rin', name: '凛', expectedFingerprint: state }, hasher);
    const resolved = resolveReplayStateRequirementsAtSequence({
      preconditions: [{ objectRef: 'config:characters', expectedFingerprint: state }], sequence: 2,
      baseReplayStates: [{ objectRef: 'config:characters', expectedFingerprint: state }],
      priorOperations: Object.values(change.record.operations).map((operation) => ({ sequence: operation.sequence!, facts: operation.compositionFacts! })),
    });
    expect(resolved).toEqual({ ok: true, requirements: [{ objectRef: 'config:characters', expectedFingerprint: state, source: 'candidate', candidateOperationSequence: 1 }] });
  });

  it('rechecks persisted state predecessor attribution when sealing, without backfilling missing facts', async () => {
    const change = await candidate();
    for (const id of ['zeta', 'alpha']) await applyCharacterEnsure(change, { operationId: id, id, name: id, expectedFingerprint: await charactersFingerprint(config(change), hasher) }, hasher);
    expect((await seal(change)).eligibility).toBe('ready');
    const saved = structuredClone(facts(change, 'alpha'));
    facts(change, 'alpha').replayStateRequirements = [{ objectRef: 'config:characters', source: 'base', expectedFingerprint: saved.replayStatePreconditions![0]!.expectedFingerprint }];
    expect(await seal(change)).toMatchObject({ eligibility: 'unavailable', reasons: expect.arrayContaining([expect.objectContaining({ code: 'OPERATION_FACTS_INVALID', operationId: 'alpha' })]) });
    change.record.operations['alpha']!.compositionFacts = structuredClone(saved);
    delete facts(change, 'alpha').replayStatePreconditions;
    delete facts(change, 'alpha').replayStateRequirements;
    const before = structuredClone(change.record);
    expect(inspectCandidateCompositionReadiness(change.record).status).toBe('blocked');
    expect((await seal(change)).eligibility).toBe('unavailable');
    expect(change.record).toEqual(before);
  });

  it('keeps successive entryScene settings at their own time', async () => {
    const change = await candidate();
    await applySceneCreate(change, { operationId: 'b', sceneId: 'B' }, hasher);
    await applyEntrySceneSet(change, { operationId: 'entry-b', sceneId: 'B', expectedFingerprint: await entrySceneFingerprint(config(change), hasher) }, hasher);
    await applyEntrySceneSet(change, { operationId: 'entry-a', sceneId: 'A', expectedFingerprint: await entrySceneFingerprint(config(change), hasher) }, hasher);
    expect(facts(change, 'entry-b').objectFingerprintAfter).toBe(sha(stableStringify('B')));
    expect(facts(change, 'entry-a').objectFingerprintAfter).toBe(sha(stableStringify('A')));
    expect(facts(change, 'entry-b').requiredObjects[0]!.objectRef).toBe('scene:B');
    expect((await seal(change)).eligibility).toBe('ready');
  });

  it('records full timeline state predecessors for duration and track-target patches', async () => {
    const change = await candidate();
    const timelineId = 'authoring_timeline';
    const created = await applyTimelineCreate(change, {
      operationId: 'timeline-create', timelineId,
      definition: {
        version: 1, id: timelineId, durationMs: 100,
        tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 10, easing: 'linear', action: 'fade', alpha: 0 }] }],
      },
    }, hasher);
    const durationPatch = await applyTimelinePatch(change, {
      operationId: 'timeline-duration', timelineId,
      patch: { kind: 'setDuration', expectedFingerprint: created.fingerprint, durationMs: 50 },
    }, hasher);
    const afterDuration = JSON.parse(change.record.workingFiles['content/timelines/authoring_timeline.json']!);
    const trackFingerprint = await timelineFingerprint(afterDuration.tracks[0], hasher);
    await applyTimelinePatch(change, {
      operationId: 'timeline-target', timelineId,
      patch: { kind: 'setTrackTarget', expectedFingerprint: trackFingerprint, trackRef: 'timeline:authoring_timeline/track:0', target: 'screen:main' },
    }, hasher);

    expect(facts(change, 'timeline-duration').replayStatePreconditions).toEqual([
      { objectRef: 'timeline:authoring_timeline', expectedFingerprint: created.fingerprint },
      { objectRef: 'config:stage', expectedFingerprint: sha('null') },
      { objectRef: 'config:portraits', expectedFingerprint: sha('[]') },
    ]);
    expect(facts(change, 'timeline-duration').replayStateRequirements).toEqual([
      { objectRef: 'config:portraits', source: 'base', expectedFingerprint: sha('[]') },
      { objectRef: 'config:stage', source: 'base', expectedFingerprint: sha('null') },
      { objectRef: 'timeline:authoring_timeline', source: 'candidate', candidateOperationSequence: 0, expectedFingerprint: created.fingerprint },
    ]);
    expect(facts(change, 'timeline-target').replayStatePreconditions).toEqual([
      { objectRef: 'timeline:authoring_timeline', expectedFingerprint: durationPatch.fingerprint },
      { objectRef: 'config:stage', expectedFingerprint: sha('null') },
      { objectRef: 'config:portraits', expectedFingerprint: sha('[]') },
    ]);
    expect(facts(change, 'timeline-target').replayStateRequirements).toEqual([
      { objectRef: 'config:portraits', source: 'base', expectedFingerprint: sha('[]') },
      { objectRef: 'config:stage', source: 'base', expectedFingerprint: sha('null') },
      { objectRef: 'timeline:authoring_timeline', source: 'candidate', candidateOperationSequence: 1, expectedFingerprint: durationPatch.fingerprint },
    ]);
    expect(JSON.parse(change.record.workingFiles['content/timelines/authoring_timeline.json']!)).toMatchObject({
      durationMs: 50,
      tracks: [{ kind: 'screen', target: 'screen:main' }],
    });
    expect((await seal(change)).eligibility).toBe('ready');
  });

  it('keeps later timeline assets out of earlier facts', async () => {
    const change = await candidate(['asset:bg:night']);
    const created = await applyTimelineCreate(change, { operationId: 'timeline', timelineId: 'intro', definition: { version: 1, id: 'intro', durationMs: 100, tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 0 }] }] } }, hasher);
    await applyTimelinePatch(change, { operationId: 'early-patch', timelineId: 'intro', patch: { kind: 'addTrack', trackKind: 'background', expectedFingerprint: created.fingerprint } }, hasher);
    await applyTimelinePatch(change, { operationId: 'timeline-patch', timelineId: 'intro', patch: { kind: 'insertCue', trackRef: 'timeline:intro/track:1', expectedFingerprint: sha(stableStringify({ kind: 'background', cues: [] })), cue: { atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night' } } }, hasher);
    expect(facts(change, 'timeline').requiredObjects).toEqual([]);
    expect(facts(change, 'early-patch').requiredObjects).toEqual([]);
    expect(facts(change, 'timeline-patch').requiredObjects).toContainEqual({ objectRef: 'asset:bg:night', source: 'base' });
    expect((await seal(change)).eligibility).toBe('ready');
  });

  it('does not silently migrate legacy or incomplete candidate ledgers', async () => {
    const change = await candidate();
    await applySceneCreate(change, { operationId: 'b', sceneId: 'B' }, hasher);
    delete change.record.operations['b']!.compositionFacts;
    const before = structuredClone(change.record);
    await expect(applySceneCreate(change, { operationId: 'c', sceneId: 'C' }, hasher)).rejects.toMatchObject({ code: 'CANDIDATE_OPERATION_FACTS_REQUIRED' });
    expect(change.record).toEqual(before);
    expect(inspectCandidateCompositionReadiness(change.record).status).toBe('blocked');
    delete change.record.composition;
    expect(inspectCandidateCompositionReadiness(change.record)).toMatchObject({ mode: 'legacy-unclassified', status: 'legacy-unavailable' });
    const candidateWithoutHook = openChange({ ...before, operations: {} }, change.repository);
    await expect(applySceneCreate(candidateWithoutHook, { operationId: 'missing-hook', sceneId: 'C' }, hasher)).rejects.toMatchObject({ code: 'CANDIDATE_OPERATION_FACTS_REQUIRED' });
  });

  it('resolves assets only from frozen resolved identities, even if an unresolved index object exists', () => {
    expect(resolveOperationRequirementsAtSequence({
      sequence: 0, baseObjects: [{ objectRef: 'asset:bg:missing', references: [] }], baseAssetRefs: [], priorOperations: [],
      rawReferences: [{ kind: 'background-asset', scope: 'candidate-external', token: 'missing', objectRef: 'asset:bg:missing', source: { path: 'content/scenario/A.gal' } }],
    })).toMatchObject({ ok: false, issues: [{ code: 'ASSET_NOT_RESOLVED' }] });
  });
});
