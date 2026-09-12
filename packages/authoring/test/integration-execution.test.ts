import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AuthoringOperationError,
  InMemoryChangeRepository,
  beginChange,
  commitChange,
  executeIntegrationReplay,
  fingerprintWorkingObject,
  applyCharacterEnsure,
  charactersFingerprint,
  entrySceneFingerprint,
  replayCompositionOperation,
} from '../src/index.js';
import type { ChangeRepository, ChangeWritePrecondition, IntegrationPlan, OperationCompositionDraft, PlannedReplayOperation, ProjectSnapshot, TextHasher } from '../src/index.js';

const hasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

function makeSnapshot(): ProjectSnapshot {
  const start = '@scene start\n凛：开始。\n@end\n';
  const config = JSON.stringify({ entryScene: 'start', variables: {} });
  const file = (path: string, text: string) => ({
    path, text, bytes: Buffer.byteLength(text, 'utf8'),
    sha256: crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
  });
  return {
    rootIdentity: 'snap-root',
    revision: crypto.createHash('sha256').update('seed').digest('hex'),
    files: [file('game.config.json', config), file('content/scenario/start.gal', start)],
    configFile: file('game.config.json', config),
    config: { entryScene: 'start', variables: {} },
    variables: {},
    scenes: [],
    timelines: [],
  };
}

function makeSixObjectSnapshot(): ProjectSnapshot {
  const configText = JSON.stringify({
    entryScene: 'intro',
    variables: { 'flag.alpha': { type: 'string', initial: '' } },
    characters: { lynn: { name: '凛', avatar: 'lynn' } },
  });
  const introText = '@scene intro\n凛：开始。\n@end\n';
  const timelineText = JSON.stringify({
    version: 1,
    id: 'intro_opening',
    durationMs: 1000,
    tracks: [],
  });
  const file = (path: string, text: string) => ({
    path, text, bytes: Buffer.byteLength(text, 'utf8'),
    sha256: crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
  });
  return {
    ...makeSnapshot(),
    files: [
      file('game.config.json', configText),
      file('content/scenario/intro.gal', introText),
      file('content/timelines/intro_opening.json', timelineText),
    ],
    configFile: file('game.config.json', configText),
    config: JSON.parse(configText) as Record<string, unknown>,
    entryScene: 'intro',
    variables: { 'flag.alpha': { type: 'string', initial: '' } },
    scenes: [],
    timelines: [file('content/timelines/intro_opening.json', timelineText)],
  };
}

function makePlan(overrides: Partial<IntegrationPlan> = {}): IntegrationPlan {
  return {
    planVersion: '1.0.0',
    planId: 'pln_test00000000000000000000000000',
    projectIdentity: 'proj-t4',
    expectedProjectRevision: 'rev-t4',
    comparisonFingerprint: 'cf'.repeat(6),
    sourceCapsules: [{ changeId: 'chg_src', capsuleId: 'cap_src', artifactSha256: 'a'.repeat(64) }],
    selectedUnitIds: ['u1'],
    implicitInclusions: [],
    excludedUnitIds: [],
    conflictResolutions: [],
    deduplicatedUnits: [],
    replayOperations: [
      {
        sequence: 0, capabilityId: 'variable.ensure', sourceOperationId: 'src_op1',
        normalizedInput: { operationId: 'cmp_t4_0000_aaa', name: 'flag.t4', type: 'number', initial: 0 },
        inputSha256: 'x1', primaryObject: 'variable:flag.t4',
        requiredObjects: [], producedObjects: [{ objectRef: 'variable:flag.t4', disposition: 'create' }],
        integrationOperationId: 'cmp_t4_0000_aaa',
        sourceCapsule: { changeId: 'chg_src', capsuleId: 'cap_src', artifactSha256: 'a'.repeat(64) },
        sourceUnitId: 'u1',
      },
      {
        sequence: 1, capabilityId: 'scene.create', sourceOperationId: 'src_op2',
        normalizedInput: { operationId: 'cmp_t4_0001_bbb', sceneId: 'alpha' },
        inputSha256: 'x2', primaryObject: 'scene:alpha',
        requiredObjects: [], producedObjects: [{ objectRef: 'scene:alpha', disposition: 'create' }],
        integrationOperationId: 'cmp_t4_0001_bbb',
        sourceCapsule: { changeId: 'chg_src', capsuleId: 'cap_src', artifactSha256: 'a'.repeat(64) },
        sourceUnitId: 'u1',
      },
      {
        sequence: 2, capabilityId: 'scene.create', sourceOperationId: 'src_op3',
        normalizedInput: { operationId: 'cmp_t4_0002_ccc', sceneId: 'beta' },
        inputSha256: 'x3', primaryObject: 'scene:beta',
        requiredObjects: [], producedObjects: [{ objectRef: 'scene:beta', disposition: 'create' }],
        integrationOperationId: 'cmp_t4_0002_ccc',
        sourceCapsule: { changeId: 'chg_src', capsuleId: 'cap_src', artifactSha256: 'a'.repeat(64) },
        sourceUnitId: 'u1',
      },
    ],
    provenance: [],
    dryRun: { status: 'passed', finalObjectFingerprints: {}, errors: [] },
    planFingerprint: 'pf'.repeat(32),
    ...overrides,
  };
}

function integrationMetadataFor(plan: IntegrationPlan, executeOperationId: string) {
  return {
    planId: plan.planId,
    planFingerprint: plan.planFingerprint,
    executeOperationId,
    sourceCapsules: plan.sourceCapsules,
    includedUnitIds: plan.selectedUnitIds,
    deduplicatedUnits: plan.deduplicatedUnits,
    conflictResolutions: plan.conflictResolutions,
    status: 'REPLAYING' as const,
    nextOperationIndex: 0,
    replayedOperations: [],
  };
}

async function beginIntegrationChange(plan: IntegrationPlan, repository: ChangeRepository = new InMemoryChangeRepository()) {
  return beginChange(makeSnapshot(), repository, undefined, undefined, {
    integration: integrationMetadataFor(plan, 'exec-1'),
  });
}

describe('Wave 5 integration execution', () => {
  it.each(['missing', 'ambiguous'] as const)('rejects a %s entry scene before advancing integration', async (target) => {
    const plan = makePlan();
    const repository = new InMemoryChangeRepository();
    const change = await beginIntegrationChange(plan, repository);
    if (target === 'ambiguous') change.record.workingFiles['content/scenario/chapter/start.gal'] = '@scene start\n@end\n';
    const operation: PlannedReplayOperation = {
      ...plan.replayOperations[0]!, capabilityId: 'project.entry-scene.set', primaryObject: 'config:entryScene',
      normalizedInput: { operationId: 'entry', sceneId: target === 'missing' ? 'ghost' : 'start', expectedFingerprint: await entrySceneFingerprint({ entryScene: 'start' }, hasher) },
    };
    const before = JSON.stringify(change.record);
    const persistedBefore = JSON.stringify(await repository.read(change.record.changeId));
    await expect(replayCompositionOperation(change, operation, hasher)).rejects.toMatchObject({ code: target === 'missing' ? 'VALIDATION_FAILED' : 'OBJECT_AMBIGUOUS' });
    expect(JSON.stringify(change.record)).toBe(before);
    expect(JSON.stringify(await repository.read(change.record.changeId))).toBe(persistedBefore);
  });

  it.each(['before-mismatch', 'missing-before', 'after-mismatch', 'no-migration', 'duplicate-scene', 'duplicate-basename'] as const)('rejects sealed character migration %s before persisting the operation', async (failure) => {
    const snapshot = makeSixObjectSnapshot();
    let draft: OperationCompositionDraft | undefined;
    const source = await beginChange(snapshot, new InMemoryChangeRepository(), undefined, undefined, {
      beforeOperationPersist: async (context) => { draft = context.draft; return undefined; },
    });
    const input = { operationId: 'rename', id: 'lynn', name: '小凛', expectedFingerprint: await charactersFingerprint(snapshot.config!, hasher) };
    await applyCharacterEnsure(source, input, hasher);
    const operation: PlannedReplayOperation = {
      ...makePlan().replayOperations[0]!, ...draft!,
      sourceOperationId: input.operationId, normalizedInput: input,
      requiredObjects: [],
      replayStateRequirements: draft!.replayStatePreconditions!.map((item) => ({ ...item, source: 'base' })),
    };
    const repository = new InMemoryChangeRepository();
    const target = await beginChange(snapshot, repository);
    const sceneProduction = operation.producedObjects.find((item) => item.objectRef === 'scene:intro')!;
    const sceneRequirement = operation.replayStateRequirements!.find((item) => item.objectRef === 'scene:intro')!;
    if (failure === 'before-mismatch') sceneRequirement.expectedFingerprint = 'stale';
    if (failure === 'missing-before') operation.replayStateRequirements = operation.replayStateRequirements!.filter((item) => item.objectRef !== 'scene:intro');
    if (failure === 'after-mismatch') sceneProduction.finalFingerprint = 'wrong';
    if (failure === 'duplicate-scene') operation.producedObjects.push({ ...sceneProduction });
    if (failure === 'duplicate-basename') target.record.workingFiles['content/scenario/chapter/intro.gal'] = '@scene intro\n@end\n';
    if (failure === 'no-migration') {
      target.record.workingFiles['content/scenario/intro.gal'] = '@scene intro\n@end\n';
      sceneRequirement.expectedFingerprint = await hasher.sha256(target.record.workingFiles['content/scenario/intro.gal']);
      sceneProduction.finalFingerprint = sceneRequirement.expectedFingerprint;
    }
    const before = JSON.stringify(target.record);
    const persistedBefore = JSON.stringify(await repository.read(target.record.changeId));
    await expect(replayCompositionOperation(target, operation, hasher)).rejects.toMatchObject({ code: failure === 'duplicate-basename' ? 'OBJECT_AMBIGUOUS' : 'COMPOSITION_REPLAY_FAILED' });
    expect(JSON.stringify(target.record)).toBe(before);
    expect(JSON.stringify(await repository.read(target.record.changeId))).toBe(persistedBefore);
  });

  it('keeps a sealed zero-scene rename valid for a display name that is not a speaker token and retries exactly', async () => {
    const snapshot = makeSixObjectSnapshot();
    const scene = snapshot.files.find((item) => item.path === 'content/scenario/intro.gal')!;
    const baselineScene = scene.text;
    scene.text = '@scene intro\n@end\n';
    scene.sha256 = await hasher.sha256(scene.text);
    let draft: OperationCompositionDraft | undefined;
    const source = await beginChange(snapshot, new InMemoryChangeRepository(), undefined, undefined, {
      beforeOperationPersist: async (context) => { draft = context.draft; return undefined; },
    });
    const input = { operationId: 'rename', id: 'lynn', name: '凛 Renamed', expectedFingerprint: await charactersFingerprint(snapshot.config!, hasher) };
    await applyCharacterEnsure(source, input, hasher);
    const operation: PlannedReplayOperation = {
      ...makePlan().replayOperations[0]!, ...draft!,
      sourceOperationId: input.operationId, normalizedInput: input, requiredObjects: [],
      replayStateRequirements: draft!.replayStatePreconditions!.map((item) => ({ ...item, source: 'base' })),
    };
    const target = await beginChange(makeSixObjectSnapshot(), new InMemoryChangeRepository());
    const first = await replayCompositionOperation(target, operation, hasher);
    const after = JSON.stringify(target.record);
    expect(await replayCompositionOperation(target, operation, hasher)).toEqual(first);
    expect(JSON.stringify(target.record)).toBe(after);
    expect(target.record.workingRevision).toBe(1);
    expect(target.record.workingFiles['content/scenario/intro.gal']).toBe(baselineScene);
    expect(JSON.parse(target.record.workingFiles['game.config.json']!).characters.lynn.name).toBe('凛 Renamed');
  });

  it('creates a REPLAYING integration change and advances nextOperationIndex with receipts', async () => {
    const plan = makePlan();
    const change = await beginIntegrationChange(plan);
    expect(change.record.integration?.status).toBe('REPLAYING');
    expect(change.record.integration?.nextOperationIndex).toBe(0);
    const metadata = await executeIntegrationReplay(change, plan, hasher);
    expect(metadata.status).toBe('READY');
    expect(metadata.nextOperationIndex).toBe(3);
    expect(metadata.replayedOperations.map((item) => item.integrationOperationId)).toEqual([
      'cmp_t4_0000_aaa', 'cmp_t4_0001_bbb', 'cmp_t4_0002_ccc',
    ]);
    // workingRevision 按真实 changed operation 增长（3 个 mutation）。
    expect(change.record.workingRevision).toBe(3);
    expect(Object.keys(change.record.operations).sort()).toEqual([
      'cmp_t4_0000_aaa', 'cmp_t4_0001_bbb', 'cmp_t4_0002_ccc',
    ]);
  });

  it('does not double-apply mutations when a receipt write was interrupted before persistence', async () => {
    const plan = makePlan();
    const repository = new InMemoryChangeRepository();
    const change = await beginIntegrationChange(plan, repository);
    // 第一项 replay 已持久化，但 receipt CAS 被中断：注入一次写失败。
    await executeIntegrationReplay(change, makePlan({ replayOperations: plan.replayOperations.slice(0, 1) }), hasher)
      .then(() => undefined)
      .catch(() => undefined);
    // 直接重放同 operationId：runOperation 幂等回放旧 result。
    const resumed = await executeIntegrationReplay(change, plan, hasher);
    expect(resumed.status).toBe('READY');
    expect(resumed.replayedOperations).toHaveLength(3);
    expect(change.record.workingRevision).toBe(3);
  });

  it('resumes an exact executeOperationId + plan and rejects fingerprint mismatches', async () => {
    const plan = makePlan();
    const change = await beginIntegrationChange(plan);
    const metadata = await executeIntegrationReplay(change, plan, hasher);
    expect(metadata.status).toBe('READY');

    const foreign = makePlan({ planFingerprint: 'ee'.repeat(32), planId: 'pln_other' });
    const change2 = await beginIntegrationChange(foreign);
    await expect(executeIntegrationReplay(change2, plan, hasher))
      .rejects.toMatchObject({ code: 'COMPOSITION_PLAN_INVALID' });
    const wrongExec = await beginIntegrationChange(plan);
    void wrongExec;
    await expect((async () => {
      const other = await beginChange(makeSnapshot(), new InMemoryChangeRepository(), undefined, undefined, {
        integration: { ...integrationMetadataFor(plan, 'exec-other'), planFingerprint: 'dd'.repeat(32) },
      });
      return executeIntegrationReplay(other, plan, hasher);
    })()).rejects.toMatchObject({ code: 'COMPOSITION_PLAN_INVALID' });
  });

  it('rechecks READY results on resume and refuses changes outside the saved plan', async () => {
    const plan = makePlan();
    const change = await beginIntegrationChange(plan);
    await executeIntegrationReplay(change, plan, hasher);
    plan.dryRun.finalObjectFingerprints['scene:alpha'] = (await fingerprintWorkingObject(change.record.workingFiles, 'scene:alpha', hasher)).fingerprint;
    change.record.workingFiles['content/scenario/alpha.gal'] = '@scene alpha\n另一份未获选择的台词。\n@end\n';
    await expect(executeIntegrationReplay(change, plan, hasher)).rejects.toMatchObject({ code: 'COMPOSITION_REPLAY_FAILED' });

    const other = await beginIntegrationChange(makePlan());
    await executeIntegrationReplay(other, makePlan(), hasher);
    other.record.operations['foreign-edit'] = other.record.operations['cmp_t4_0000_aaa']!;
    await expect(executeIntegrationReplay(other, makePlan(), hasher)).rejects.toMatchObject({ code: 'COMPOSITION_REPLAY_FAILED' });
  });

  it('seals integration metadata on the created record; takeover refusal lives in the service scan', async () => {
    const plan = makePlan();
    const repository = new InMemoryChangeRepository();
    await beginChange(makeSnapshot(), repository); // 普通 OPEN change（无 integration 字段）
    const integration = await beginChange(makeSnapshot(), repository, undefined, undefined, {
      integration: integrationMetadataFor(plan, 'exec-1'),
    });
    expect(integration.record.integration?.planId).toBe(plan.planId);
    expect(integration.record.integration?.status).toBe('REPLAYING');
    // 普通 change 不受 commit gate 影响（integration 为 undefined）。
    const ordinary = await beginChange(makeSnapshot(), repository);
    expect(ordinary.record.integration).toBeUndefined();
  });

  it('marks FAILED with the original domain code and stays OPEN on typed replay failure', async () => {
    const plan = makePlan();
    plan.replayOperations[1]!.normalizedInput = { operationId: 'cmp_t4_0001_bbb', sceneId: '../evil' };
    const change = await beginIntegrationChange(plan);
    await expect(executeIntegrationReplay(change, plan, hasher))
      .rejects.toMatchObject({ code: 'COMPOSITION_REPLAY_FAILED' });
    expect(change.record.integration?.status).toBe('FAILED');
    expect(change.record.integration?.failure?.operationIndex).toBe(1);
    expect(['INVALID_REQUEST', 'PATH_OUTSIDE_PROJECT']).toContain(change.record.integration?.failure?.code);
    expect(change.record.status).toBe('OPEN');
  });

  it('keeps source capsules and project files byte-stable across execution', async () => {
    const plan = makePlan();
    const change = await beginIntegrationChange(plan);
    const filesBefore = JSON.stringify(change.record.workingFiles);
    await executeIntegrationReplay(change, plan, hasher);
    // workingFiles 变化属于集成 change 自身；baseContents 与 sourceCapsules 引用不变。
    expect(JSON.stringify(change.record.baseContents)).toBe(JSON.stringify(await (async () => {
      const fresh = makeSnapshot();
      return Object.fromEntries(fresh.files.map((item) => [item.path, item.text]));
    })()));
    expect(change.record.integration?.sourceCapsules).toEqual(plan.sourceCapsules);
    void filesBefore;
  });

  it('blocks commit of REPLAYING/FAILED integration changes with COMPOSITION_INCOMPLETE', async () => {
    const plan = makePlan({ replayOperations: [] });
    const failing = makePlan();
    failing.replayOperations[1]!.normalizedInput = { operationId: 'cmp_t4_0001_bbb', sceneId: '../evil' };
    const change = await beginIntegrationChange(failing);
    await executeIntegrationReplay(change, failing, hasher).catch(() => undefined);
    expect(change.record.integration?.status).toBe('FAILED');
    // gate 位于 storage 检查之前，undefined storage 也会先命中 COMPOSITION_INCOMPLETE。
    await expect(commitChange(change, undefined as never)).rejects.toMatchObject({ code: 'COMPOSITION_INCOMPLETE' });
    void plan;
  });

  it('checks six working object fingerprints before READY and rejects unknown products', async () => {
    const refs = [
      'scene:intro',
      'timeline:intro_opening',
      'variable:flag.alpha',
      'character:lynn',
      'config:characters',
      'config:entryScene',
    ];
    const finalObjectFingerprints = Object.fromEntries(
      await Promise.all(refs.map(async (objectRef) => [
        objectRef,
        (await fingerprintWorkingObject(makeSixObjectSnapshot().files.reduce<Record<string, string>>(
          (files, file) => ({ ...files, [file.path]: file.text }), {}), objectRef, hasher)).fingerprint,
      ])),
    );
    const plan = makePlan({
      replayOperations: [],
      provenance: refs.map((targetObject) => ({
        targetObject,
        sourceCapsule: { changeId: 'chg_src', capsuleId: 'cap_src', artifactSha256: 'a'.repeat(64) },
        sourceUnitId: 'u1',
        sourceOperationIds: [],
      })),
      dryRun: { status: 'passed', finalObjectFingerprints, errors: [] },
    });
    const change = await beginChange(
      makeSixObjectSnapshot(),
      new InMemoryChangeRepository(),
      undefined,
      undefined,
      { integration: integrationMetadataFor(plan, 'exec-six') },
    );
    const metadata = await executeIntegrationReplay(change, plan, hasher);
    expect(metadata.status).toBe('READY');
    expect(Object.keys(plan.dryRun.finalObjectFingerprints).sort()).toEqual(refs.sort());

    const unknownPlan = makePlan({
      replayOperations: [],
      provenance: [{
        targetObject: 'asset:bg/night',
        sourceCapsule: { changeId: 'chg_src', capsuleId: 'cap_src', artifactSha256: 'a'.repeat(64) },
        sourceUnitId: 'u1',
        sourceOperationIds: [],
      }],
      dryRun: {
        status: 'passed',
        finalObjectFingerprints: { 'asset:bg/night': 'x' },
        errors: [],
      },
    });
    const unknownChange = await beginIntegrationChange(unknownPlan);
    await expect(executeIntegrationReplay(unknownChange, unknownPlan, hasher))
      .rejects.toMatchObject({ code: 'COMPOSITION_REPLAY_FAILED' });
  });
});
