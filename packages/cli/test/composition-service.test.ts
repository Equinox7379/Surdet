import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintWorkingObject, stableStringify, type AuthoringObject, type TextHasher } from '@surdet/authoring';
import { NodeCompositionStore } from '../src/authoring/node-composition-store.js';
import { CompositionService } from '../src/authoring/composition-service.js';
import { NodeChangeStore as NodeChangeStoreStatic } from '../src/authoring/node-change-store.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { NodeReviewStore } from '../src/authoring/node-review-store.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';

const temporaryRoots: string[] = [];

const realHasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

interface SealedRef {
  ref: { changeId: string; capsuleId: string; artifactSha256: string };
  bytes: Buffer;
}

async function sealCandidate(
  projectRoot: string,
  name: string,
  run: (session: AgentPortSession) => Promise<void>,
): Promise<SealedRef> {
  const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
  expect((await session.invoke('change.begin', {})).ok).toBe(true);
  await run(session);
  expect((await session.invoke('project.validate', {})).ok).toBe(true);
  expect((await session.invoke('project.simulate', {})).ok).toBe(true);
  expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
  expect((await session.invoke('change.diff', {})).ok).toBe(true);
  const capsule = await generateDeliveryCapsule(session);
  expect(capsule.composition.eligibility).toBe('ready');
  await session.close();
  return {
    ref: { changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 },
    bytes: fs.readFileSync(capsule.artifactIdentity.path),
  };
}

async function setup(name: string): Promise<{
  dataDir: string;
  projectRoot: string;
  store: NodeCompositionStore;
  service: CompositionService;
  identity: string;
}> {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-comp-svc-proj-${name}-`));
  temporaryRoots.push(projectRoot);
  fs.mkdirSync(path.join(projectRoot, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-comp-svc-data-${name}-`));
  temporaryRoots.push(dataDir);
  process.env['SURDET_AGENT_DATA_DIR'] = dataDir;
  const probe = await openAgentPortSession({ projectRoot, policy: 'stage' });
  const identity = probe.projectIdentity;
  await probe.close();
  const store = new NodeCompositionStore(path.join(dataDir, identity), identity);
  const service = new CompositionService(store, identity, projectRoot, realHasher);
  return { dataDir, projectRoot, store, service, identity };
}

function treeSnapshot(root: string): Map<string, string> {
  const entries = new Map<string, string>();
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else entries.set(full, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  };
  visit(root);
  return entries;
}


/** New selection contract: every plan must bind a fresh fingerprint and explicit units. */
async function planFromComparison(
  fixture: { service: {
    compare(refs: unknown[]): Promise<{ comparison: { comparisonFingerprint: string; units: Array<{ unitId: string }> } }>;
    plan(input: { candidateRefs: unknown[]; comparisonFingerprint: string; selectedUnitIds: string[]; now?: string }): Promise<{
      plan: import('@surdet/authoring').IntegrationPlan;
      identity: { sha256: string };
    }>;
  } },
  refs: unknown[],
  options: { selectedUnitIds?: string[]; now?: string } = {},
) {
  const compared = await fixture.service.compare(refs);
  return fixture.service.plan({
    candidateRefs: refs,
    comparisonFingerprint: compared.comparison.comparisonFingerprint,
    selectedUnitIds: options.selectedUnitIds ?? compared.comparison.units.map((unit) => unit.unitId),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

describe('CompositionService compare/plan/dry-run', () => {
  it('seals and replays a nested entry scene through candidate, plan and integration', async () => {
    const fixture = await setup('nested-entry-scene');
    fs.mkdirSync(path.join(fixture.projectRoot, 'content/scenario/chapter'), { recursive: true });
    fs.renameSync(path.join(fixture.projectRoot, 'content/scenario/start.gal'), path.join(fixture.projectRoot, 'content/scenario/chapter/start.gal'));
    fs.writeFileSync(path.join(fixture.projectRoot, 'content/scenario/other.gal'), '@scene other\n@end\n');
    fs.writeFileSync(path.join(fixture.projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'other', variables: {} }));
    const baseline = treeSnapshot(fixture.projectRoot);
    let expectedFiles: Record<string, string> = {};
    const first = await sealCandidate(fixture.projectRoot, 'nested-entry', async (session) => {
      expect((await session.invoke('project.entry-scene.set', { operationId: 'nested-entry', sceneId: 'start', expectedFingerprint: await realHasher.sha256(stableStringify('other')) })).ok).toBe(true);
      const { record } = (await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!;
      expect(record.operations['nested-entry']!.compositionFacts!.requiredObjects).toContainEqual(expect.objectContaining({ objectRef: 'scene:start', source: 'base' }));
      expectedFiles = record.workingFiles;
    });
    const second = await sealCandidate(fixture.projectRoot, 'other', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'other', name: 'other', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const refs = [first.ref, second.ref];
    const compared = await fixture.service.compare(refs);
    const entry = compared.comparison.units.find((unit) => unit.primaryObject === 'config:entryScene')!;
    const planned = await planFromComparison(fixture, refs, { selectedUnitIds: [entry.unitId] });
    expect(planned.plan.dryRun.status, JSON.stringify(planned.plan.dryRun)).toBe('passed');
    const executed = await fixture.service.executePlan({ planId: planned.plan.planId, artifactSha256: planned.identity.sha256, executeOperationId: 'nested-entry' });
    const { record } = (await NodeChangeStoreStatic.openByChangeId(executed.changeId))!;
    expect(record.integration?.status).toBe('READY');
    expect(record.workingFiles).toEqual(expectedFiles);
    expect(JSON.parse(record.workingFiles['game.config.json']!).entryScene).toBe('start');
    expect(record.workingFiles['content/scenario/chapter/start.gal']).toBe('@scene start\n凛：开始。\n@end\n');
    expect(record.workingFiles['content/scenario/start.gal']).toBeUndefined();
    expect(treeSnapshot(fixture.projectRoot)).toEqual(baseline);
  });

  it('rejects ambiguous entry scene identity in a candidate without advancing its record', async () => {
    const fixture = await setup('ambiguous-entry-scene');
    fs.mkdirSync(path.join(fixture.projectRoot, 'content/scenario/chapter'), { recursive: true });
    fs.writeFileSync(path.join(fixture.projectRoot, 'content/scenario/chapter/start.gal'), '@scene start\n@end\n');
    const baseline = treeSnapshot(fixture.projectRoot);
    const session = await openAgentPortSession({ projectRoot: fixture.projectRoot, policy: 'stage' });
    try {
      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      const before = (await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!.record;
      expect(await session.invoke('project.entry-scene.set', { operationId: 'ambiguous-entry', sceneId: 'start', expectedFingerprint: await realHasher.sha256(stableStringify('start')) })).toMatchObject({ ok: false, error: { code: 'OBJECT_AMBIGUOUS' } });
      expect((await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!.record).toEqual(before);
      expect(treeSnapshot(fixture.projectRoot)).toEqual(baseline);
    } finally {
      await session.close();
    }
  });

  it('retries the same entry operation after creating its missing scene producer', async () => {
    const fixture = await setup('missing-entry-producer');
    const first = await sealCandidate(fixture.projectRoot, 'repaired-entry', async (session) => {
      const input = { operationId: 'entry-retry', sceneId: 'ending', expectedFingerprint: await realHasher.sha256(stableStringify('start')) };
      const before = (await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!.record;
      expect(await session.invoke('project.entry-scene.set', input)).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY' } });
      expect((await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!.record).toEqual(before);
      expect((await session.invoke('scene.create', { operationId: 'entry-producer', sceneId: 'ending' })).ok).toBe(true);
      expect((await session.invoke('project.entry-scene.set', input)).ok).toBe(true);
      const { record } = (await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!;
      expect(record.operations['entry-retry']!.sequence).toBe(1);
      expect(record.operations['entry-retry']!.compositionFacts!.requiredObjects).toContainEqual(expect.objectContaining({ objectRef: 'scene:ending', source: 'candidate', candidateOperationSequence: 0 }));
    });
    const second = await sealCandidate(fixture.projectRoot, 'other', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'other', name: 'other', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const refs = [first.ref, second.ref];
    const compared = await fixture.service.compare(refs);
    const entry = compared.comparison.units.find((unit) => unit.primaryObject === 'config:entryScene')!;
    const planned = await planFromComparison(fixture, refs, { selectedUnitIds: [entry.unitId] });
    expect(planned.plan.dryRun.status, JSON.stringify(planned.plan.dryRun)).toBe('passed');
    expect(planned.plan.replayOperations.map((item) => item.sourceOperationId)).toEqual(['entry-producer', 'entry-retry']);
  });

  it('seals and replays a character migration using the semantic ID of a nested scene', async () => {
    const fixture = await setup('nested-character-migration');
    const characters = { rin: { name: '凛' } };
    fs.writeFileSync(path.join(fixture.projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {}, characters }));
    const nestedPath = 'content/scenario/chapter/start.gal';
    fs.mkdirSync(path.dirname(path.join(fixture.projectRoot, nestedPath)), { recursive: true });
    fs.renameSync(path.join(fixture.projectRoot, 'content/scenario/start.gal'), path.join(fixture.projectRoot, nestedPath));
    const base = treeSnapshot(fixture.projectRoot);
    let expectedFiles: Record<string, string> = {};
    const first = await sealCandidate(fixture.projectRoot, 'nested-rename', async (session) => {
      const renamed = await session.invoke('character.ensure', { operationId: 'nested-rename', id: 'rin', name: '小凛', expectedFingerprint: await realHasher.sha256(stableStringify(characters)) });
      expect(renamed.ok, JSON.stringify(renamed)).toBe(true);
      const { record } = (await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!;
      const facts = record.operations['nested-rename']!.compositionFacts!;
      expect(facts.producedObjects.map((item) => item.objectRef)).toEqual(['character:rin', 'config:characters', 'scene:start']);
      expect(facts.replayStateRequirements).toContainEqual({ objectRef: 'scene:start', source: 'base', expectedFingerprint: await realHasher.sha256('@scene start\n凛：开始。\n@end\n') });
      expectedFiles = record.workingFiles;
    });
    const second = await sealCandidate(fixture.projectRoot, 'other', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'other', name: 'other', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const refs = [first.ref, second.ref];
    const compared = await fixture.service.compare(refs);
    const rename = compared.comparison.units.find((unit) => unit.primaryObject === 'character:rin')!;
    const planned = await planFromComparison(fixture, refs, { selectedUnitIds: [rename.unitId] });
    expect(planned.plan.dryRun.status, JSON.stringify(planned.plan.dryRun)).toBe('passed');
    expect(planned.plan.dryRun.finalObjectFingerprints['scene:start']).toBe((await fingerprintWorkingObject(expectedFiles, 'scene:start', realHasher)).fingerprint);
    const executed = await fixture.service.executePlan({ planId: planned.plan.planId, artifactSha256: planned.identity.sha256, executeOperationId: 'nested-migration' });
    const { record } = (await NodeChangeStoreStatic.openByChangeId(executed.changeId))!;
    expect(record.integration?.status).toBe('READY');
    expect(record.workingFiles).toEqual(expectedFiles);
    expect(record.workingFiles[nestedPath]).toBe('@scene start\n小凛：开始。\n@end\n');
    expect(record.workingFiles['content/scenario/start.gal']).toBeUndefined();
    expect(treeSnapshot(fixture.projectRoot)).toEqual(base);
  });

  it('rejects duplicate scene basenames during candidate character migration without advancing the change', async () => {
    const fixture = await setup('ambiguous-character-migration');
    const characters = { rin: { name: '凛' } };
    fs.writeFileSync(path.join(fixture.projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {}, characters }));
    fs.mkdirSync(path.join(fixture.projectRoot, 'content/scenario/chapter'), { recursive: true });
    fs.writeFileSync(path.join(fixture.projectRoot, 'content/scenario/chapter/start.gal'), '@scene start\n@end\n');
    const baseline = treeSnapshot(fixture.projectRoot);
    const session = await openAgentPortSession({ projectRoot: fixture.projectRoot, policy: 'stage' });
    try {
      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      const before = (await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!.record;
      const result = await session.invoke('character.ensure', { operationId: 'ambiguous-rename', id: 'rin', name: '小凛', expectedFingerprint: await realHasher.sha256(stableStringify(characters)) });
      expect(result).toMatchObject({ ok: false, error: { code: 'OBJECT_AMBIGUOUS' } });
      const after = (await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!.record;
      expect(after).toEqual(before);
      expect(treeSnapshot(fixture.projectRoot)).toEqual(baseline);
    } finally {
      await session.close();
    }
  });

  it.each(['all', 'character-only'] as const)('replays rename after deleting the last old speaker with %s selected', async (selection) => {
    const fixture = await setup(`sealed-rename-${selection}`);
    const characters = { rin: { name: '凛' } };
    fs.writeFileSync(path.join(fixture.projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {}, characters }));
    const baseScene = fs.readFileSync(path.join(fixture.projectRoot, 'content/scenario/start.gal'), 'utf8');
    const first = await sealCandidate(fixture.projectRoot, 'deleted-speaker', async (session) => {
      const scene = await session.invoke('object.inspect', { objectRef: 'scene:start' });
      if (!scene.ok) throw new Error(scene.error.message);
      const target = await session.invoke('object.inspect', { objectRef: (scene.result as AuthoringObject).childRefs![1] });
      if (!target.ok) throw new Error(target.error.message);
      const object = target.result as AuthoringObject;
      expect((await session.invoke('scene.patch', { operationId: 'delete-speaker', sceneId: 'start', patch: { kind: 'removeObject', target: object.objectRef, expectedFingerprint: object.fingerprint } })).ok).toBe(true);
      expect((await session.invoke('character.ensure', { operationId: 'rename', id: 'rin', name: '小凛', expectedFingerprint: await realHasher.sha256(stableStringify(characters)) })).ok).toBe(true);
      const { record } = (await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!;
      expect(record.operations['rename']!.compositionFacts!.producedObjects.map((item) => item.objectRef)).toEqual(['character:rin', 'config:characters']);
    });
    const other = await sealCandidate(fixture.projectRoot, 'other', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'other', name: 'other', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const refs = [first.ref, other.ref];
    const compared = await fixture.service.compare(refs);
    const selectedUnitIds = compared.comparison.units.filter((unit) => unit.candidateId === `cand-${first.ref.changeId}` && (selection === 'all' || unit.primaryObject === 'character:rin')).map((unit) => unit.unitId);
    const planned = await planFromComparison(fixture, refs, { selectedUnitIds });
    expect(planned.plan.dryRun.status, JSON.stringify(planned.plan.dryRun)).toBe('passed');
    expect(planned.plan.replayOperations.map((item) => item.sourceOperationId)).toEqual(selection === 'all' ? ['rename', 'delete-speaker'] : ['rename']);
    const executed = await fixture.service.executePlan({ planId: planned.plan.planId, artifactSha256: planned.identity.sha256, executeOperationId: `sealed-${selection}` });
    const { record } = (await NodeChangeStoreStatic.openByChangeId(executed.changeId))!;
    expect(record.workingFiles['content/scenario/start.gal']).toBe(selection === 'all' ? '@scene start\n@end\n' : baseScene);
    expect(JSON.parse(record.workingFiles['game.config.json']!).characters.rin.name).toBe('小凛');
    expect(fs.readFileSync(path.join(fixture.projectRoot, 'content/scenario/start.gal'), 'utf8')).toBe(baseScene);
  });

  it('does not migrate an old speaker introduced by another candidate before the sealed rename', async () => {
    const fixture = await setup('sealed-rename-foreign-scene');
    const characters = { rin: { name: '凛' } };
    fs.writeFileSync(path.join(fixture.projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {}, characters }));
    fs.writeFileSync(path.join(fixture.projectRoot, 'content/scenario/start.gal'), '@scene start\n@end\n');
    const first = await sealCandidate(fixture.projectRoot, 'rename', async (session) => {
      const added = await session.invoke('character.ensure', { operationId: 'table-first', id: 'zeta', name: 'Zeta', expectedFingerprint: await realHasher.sha256(stableStringify(characters)) });
      if (!added.ok) throw new Error(added.error.message);
      expect((await session.invoke('character.ensure', { operationId: 'rename', id: 'rin', name: '小凛', expectedFingerprint: (added.result as { fingerprint: string }).fingerprint })).ok).toBe(true);
    });
    let foreignScene = '';
    const second = await sealCandidate(fixture.projectRoot, 'foreign-scene', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'foreign-scene', sceneId: 'other', blocks: [{ kind: 'text', speaker: '凛', value: '另一个候选的台词。' }] })).ok).toBe(true);
      const { record } = (await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!;
      foreignScene = record.workingFiles['content/scenario/other.gal']!;
    });
    const planned = await planFromComparison(fixture, [first.ref, second.ref]);
    expect(planned.plan.replayOperations.map((item) => item.sourceOperationId)).toEqual(['table-first', 'foreign-scene', 'rename']);
    expect(planned.plan.dryRun.status, JSON.stringify(planned.plan.dryRun)).toBe('passed');
    const executed = await fixture.service.executePlan({ planId: planned.plan.planId, artifactSha256: planned.identity.sha256, executeOperationId: 'foreign-scene-rename' });
    const { record } = (await NodeChangeStoreStatic.openByChangeId(executed.changeId))!;
    expect(record.workingFiles['content/scenario/other.gal']).toBe(foreignScene);
    expect(fs.existsSync(path.join(fixture.projectRoot, 'content/scenario/other.gal'))).toBe(false);
  });

  it('closes and replays successive character table writes in source order', async () => {
    const fixture = await setup('character-state-order');
    const first = await sealCandidate(fixture.projectRoot, 'characters', async (session) => {
      let expectedFingerprint = await realHasher.sha256('{}');
      for (const id of ['zeta', 'alpha']) {
        const ensured = await session.invoke('character.ensure', { operationId: id, id, name: id, expectedFingerprint });
        expect(ensured.ok, JSON.stringify(ensured)).toBe(true);
        if (ensured.ok) expectedFingerprint = (ensured.result as { fingerprint: string }).fingerprint;
      }
    });
    const second = await sealCandidate(fixture.projectRoot, 'other', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'other', name: 'other', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const compared = await fixture.service.compare([first.ref, second.ref]);
    const alpha = compared.comparison.units.find((unit) => unit.primaryObject === 'character:alpha')!;
    const planned = await planFromComparison(fixture, [first.ref, second.ref], { selectedUnitIds: [alpha.unitId] });
    expect(planned.plan.dryRun.status, JSON.stringify(planned.plan.dryRun)).toBe('passed');
    expect(planned.plan.replayOperations.map((item) => item.sourceOperationId)).toEqual(['zeta', 'alpha']);
    expect(compared.comparison.conflicts.filter((item) => item.severity === 'selection-required')).toEqual([]);
  });

  it('orders a scene patch before character migration and replays the selected full footprint', async () => {
    const fixture = await setup('migration-state-order');
    fs.writeFileSync(path.join(fixture.projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {}, characters: { rin: { name: '凛' } } }));
    const expectedFingerprint = await realHasher.sha256(stableStringify({ rin: { name: '凛' } }));
    let expectedScene = '';
    let expectedTable = '';
    let expectedFiles: Record<string, string> = {};
    const first = await sealCandidate(fixture.projectRoot, 'migration', async (session) => {
      const scene = await session.invoke('object.inspect', { objectRef: 'scene:start' });
      if (!scene.ok) throw new Error(scene.error.message);
      const target = await session.invoke('object.inspect', { objectRef: (scene.result as AuthoringObject).childRefs![1] });
      if (!target.ok) throw new Error(target.error.message);
      const object = target.result as AuthoringObject;
      expect((await session.invoke('scene.patch', { operationId: 'patch-first', sceneId: 'start', patch: { kind: 'replaceText', target: object.objectRef, expectedFingerprint: object.fingerprint, value: '选择的正文。' } })).ok).toBe(true);
      const renamed = await session.invoke('character.ensure', { operationId: 'rename-second', id: 'rin', name: '小凛', expectedFingerprint });
      expect(renamed.ok, JSON.stringify(renamed)).toBe(true);
      const { record } = (await NodeChangeStoreStatic.openByChangeId(session.activeChangeId!))!;
      expectedScene = record.workingFiles['content/scenario/start.gal']!;
      expectedFiles = record.workingFiles;
      expectedTable = await realHasher.sha256(stableStringify(JSON.parse(record.workingFiles['game.config.json']!).characters));
      expect(record.operations['rename-second']!.compositionFacts!.replayStateRequirements).toContainEqual(expect.objectContaining({ objectRef: 'scene:start', source: 'candidate', candidateOperationSequence: 0 }));
    });
    const second = await sealCandidate(fixture.projectRoot, 'other-scene', async (session) => {
      const scene = await session.invoke('object.inspect', { objectRef: 'scene:start' });
      if (!scene.ok) throw new Error(scene.error.message);
      const target = await session.invoke('object.inspect', { objectRef: (scene.result as AuthoringObject).childRefs![1] });
      if (!target.ok) throw new Error(target.error.message);
      const object = target.result as AuthoringObject;
      expect((await session.invoke('scene.patch', { operationId: 'other-scene', sceneId: 'start', patch: { kind: 'replaceText', target: object.objectRef, expectedFingerprint: object.fingerprint, value: '另一个候选的正文。' } })).ok).toBe(true);
    });
    const comparison = await fixture.service.compare([first.ref, second.ref]);
    const rename = comparison.comparison.units.find((unit) => unit.primaryObject === 'character:rin')!;
    const selectionConflicts = comparison.comparison.conflicts.filter((item) => item.severity === 'selection-required');
    expect(selectionConflicts).toHaveLength(2);
    expect(selectionConflicts.every((item) => item.objectRefs.includes('scene:start'))).toBe(true);
    const result = await fixture.service.plan({
      candidateRefs: [first.ref, second.ref], comparisonFingerprint: comparison.comparison.comparisonFingerprint,
      selectedUnitIds: [rename.unitId], conflictResolutions: selectionConflicts.map((conflict) => ({
        conflictId: conflict.conflictId, resolution: 'choose-unit', actor: 'human',
        chosenUnitId: conflict.unitIds.find((id) => comparison.comparison.units.some((unit) => unit.unitId === id && unit.candidateId === `cand-${first.ref.changeId}`))!,
      })),
    });
    expect(result.plan.replayOperations.map((item) => item.sourceOperationId)).toEqual(['patch-first', 'rename-second']);
    expect(result.plan.dryRun.status).toBe('passed');
    expect(result.plan.dryRun.finalObjectFingerprints['scene:start']).toBe((await fingerprintWorkingObject(expectedFiles, 'scene:start', realHasher)).fingerprint);
    expect(result.plan.dryRun.finalObjectFingerprints['config:characters']).toBe((await fingerprintWorkingObject(expectedFiles, 'config:characters', realHasher)).fingerprint);
    const executed = await fixture.service.executePlan({ planId: result.plan.planId, artifactSha256: result.identity.sha256, executeOperationId: 'migration-replay' });
    const { record } = (await NodeChangeStoreStatic.openByChangeId(executed.changeId))!;
    expect(record.workingFiles['content/scenario/start.gal']).toBe(expectedScene);
    expect(await realHasher.sha256(stableStringify(JSON.parse(record.workingFiles['game.config.json']!).characters))).toBe(expectedTable);
    expect(fs.readFileSync(path.join(fixture.projectRoot, 'content/scenario/start.gal'), 'utf8')).toBe('@scene start\n凛：开始。\n@end\n');
  });

  it('safely deduplicates equivalent full migration footprints from two real capsules', async () => {
    const fixture = await setup('identical-migration');
    const characters = { rin: { name: '凛' } };
    fs.writeFileSync(path.join(fixture.projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {}, characters }));
    const expectedFingerprint = await realHasher.sha256(stableStringify(characters));
    const refs: SealedRef[] = [];
    for (const name of ['one', 'two']) refs.push(await sealCandidate(fixture.projectRoot, name, async (session) => {
      expect((await session.invoke('character.ensure', { operationId: name, id: 'rin', name: '小凛', expectedFingerprint })).ok).toBe(true);
    }));
    const compared = await fixture.service.compare(refs.map((item) => item.ref));
    expect(compared.comparison.identicalGroups).toHaveLength(1);
    expect(compared.comparison.conflicts.filter((item) => item.severity === 'selection-required')).toEqual([]);
    const planned = await planFromComparison(fixture, refs.map((item) => item.ref));
    expect(planned.plan.dryRun.status).toBe('passed');
    expect(planned.plan.replayOperations).toHaveLength(1);
    expect(planned.plan.deduplicatedUnits).toHaveLength(1);
    expect(planned.plan.deduplicatedUnits[0]!.provenanceUnitIds).toHaveLength(2);
    const expectedFiles = { 'game.config.json': JSON.stringify({ characters: { rin: { name: '小凛' } } }), 'content/scenario/start.gal': '@scene start\n小凛：开始。\n@end\n' };
    for (const objectRef of ['character:rin', 'config:characters', 'scene:start']) {
      expect(planned.plan.dryRun.finalObjectFingerprints[objectRef]).toBe((await fingerprintWorkingObject(expectedFiles, objectRef, realHasher)).fingerprint);
    }
  });

  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('uses the canonical project root for the snapshot lease and contends with Authoring on one physical lock', async () => {
    const fixture = await setup('canonical-project-lease');
    const storage = await NodeProjectStorage.open(fixture.projectRoot);
    const leases = new NodeLocalLeaseManager(fixture.dataDir);
    const observed: Array<{ scope: string; resourceId: string }> = [];
    const originalAcquire = leases.acquire.bind(leases);
    leases.acquire = async (input) => {
      const handle = await originalAcquire(input);
      observed.push({ ...input });
      return handle;
    };
    const service = new CompositionService(
      fixture.store,
      fixture.identity,
      fixture.projectRoot,
      realHasher,
      leases,
    );

    await service.currentSnapshot();
    expect(observed, 'Composition snapshot did not acquire the canonical project-root lease').toEqual([
      { scope: 'project', resourceId: storage.rootIdentity },
    ]);
    expect(observed.some((entry) => entry.scope === 'change')).toBe(false);

    const expectedLockName = `${fixture.identity}.lock`;
    await leases.withProjectLease(storage.rootIdentity, async (authoringLease) => {
      expect(path.basename(authoringLease.directory)).toBe(expectedLockName);
      const projectBefore = treeSnapshot(fixture.projectRoot);
      await expect(service.currentSnapshot()).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
      expect(treeSnapshot(fixture.projectRoot)).toEqual(projectBefore);
      const physicalLocks = fs.readdirSync(path.join(fixture.dataDir, '.locks', 'projects'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.endsWith('.lock'))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
      expect(physicalLocks).toEqual([expectedLockName]);
    });
  });

  it('compares and plans two real sealed capsules end to end', async () => {
    const fixture = await setup('e2e');
    const first = await sealCandidate(fixture.projectRoot, 'one', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-alpha', sceneId: 'alpha' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'two', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-flag', name: 'flag.wave5', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const comparisonResult = await fixture.service.compare([first.ref, second.ref]);
    expect(comparisonResult.comparison.status).toBe('composable');
    expect(comparisonResult.candidates).toHaveLength(2);
    expect(comparisonResult.comparison.candidateManifests?.['cand-' + first.ref.changeId]?.operations.length).toBeGreaterThan(0);

    const planResult = await planFromComparison(fixture, [first.ref, second.ref], { now: '2026-08-24T12:00:00.000Z' });
    expect(planResult.plan.planVersion).toBe('1.0.0');
    expect(planResult.plan.dryRun.status).toBe('passed');
    expect(Object.keys(planResult.plan.dryRun.finalObjectFingerprints)).toContain('scene:alpha');
    // 同语义再 plan：同 planId 幂等回读首次封存。
    const again = await planFromComparison(fixture, [first.ref, second.ref], { now: '2026-08-24T13:00:00.000Z' });
    expect(again.plan.planId).toBe(planResult.plan.planId);
  });

  it('leaves project tree, source records and capsule bytes untouched after dry-run', async () => {
    const fixture = await setup('no-mutation');
    const first = await sealCandidate(fixture.projectRoot, 'keep-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-keep-scene', sceneId: 'keep_scene' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'keep-b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-keep-var', name: 'flag.keep', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const beforeProject = treeSnapshot(fixture.projectRoot);
    const beforeData = treeSnapshot(fixture.dataDir);
    const result = await planFromComparison(fixture, [first.ref, second.ref]);
    expect(result.plan.dryRun.status).toBe('passed');
    const afterProject = treeSnapshot(fixture.projectRoot);
    expect([...afterProject.entries()].filter(([file]) => !file.includes(`${path.sep}composition-plans${path.sep}`)))
      .toEqual([...beforeProject.entries()]);
    const afterData = treeSnapshot(fixture.dataDir);
    // 除新增 plan 目录外，data 树其余部分（含两个 source capsule）逐字节不变。
    const changed = [...afterData.entries()].filter(([file, sha]) => beforeData.get(file) !== sha);
    expect(changed.every(([file]) => file.includes(`${path.sep}composition-plans${path.sep}`))).toBe(true);
    expect(fs.readFileSync(path.join(
      fixture.dataDir, fixture.identity, first.ref.changeId, 'capsules', first.ref.capsuleId, 'payload.json',
    ))).toEqual(first.bytes);
  });

  it('matches typed replay results against plan final fingerprints', async () => {
    const fixture = await setup('fingerprints');
    const first = await sealCandidate(fixture.projectRoot, 'fp-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-fp-scene', sceneId: 'fp_scene', blocks: [{ kind: 'text', value: '初稿' }] })).ok).toBe(true);
      const scene = await session.invoke('object.inspect', { objectRef: 'scene:fp_scene' });
      if (!scene.ok) throw new Error(scene.error.message);
      const text = await session.invoke('object.inspect', { objectRef: (scene.result as AuthoringObject).childRefs![1] });
      if (!text.ok) throw new Error(text.error.message);
      const target = text.result as AuthoringObject;
      expect((await session.invoke('scene.patch', { operationId: 'op-fp-patch', sceneId: 'fp_scene', patch: { kind: 'replaceText', target: target.objectRef, expectedFingerprint: target.fingerprint, value: '定稿' } })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'fp-b', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-fp-direct', sceneId: 'fp_scene', blocks: [{ kind: 'text', value: '定稿' }] })).ok).toBe(true);
    });
    const compared = await fixture.service.compare([first.ref, second.ref]);
    expect(compared.comparison.identicalGroups).toHaveLength(1);
    const selected = compared.comparison.units.find((unit) => unit.candidateId === `cand-${first.ref.changeId}`)!;
    const result = await planFromComparison(fixture, [first.ref, second.ref], { selectedUnitIds: [selected.unitId] });
    expect(result.plan.dryRun.status).toBe('passed');
    expect(result.plan.replayOperations.map((operation) => operation.sourceOperationId)).toEqual(['op-fp-scene', 'op-fp-patch']);
    // plan 内每个 provenance 目标都能在 dry-run 指纹表中找到，且与单元封存值一致。
    expect(Object.keys(result.plan.dryRun.finalObjectFingerprints)).toContain('scene:fp_scene');
    for (const entry of result.plan.provenance) {
      if (entry.targetObject.startsWith('scene:') || entry.targetObject.startsWith('timeline:')) {
        expect(result.plan.dryRun.finalObjectFingerprints[entry.targetObject]).toBeDefined();
      }
    }
  });

  it('resolves all six working object fingerprint kinds and rejects unknown products', async () => {
    const fixture = await setup('six-object-fingerprints');
    fs.mkdirSync(path.join(fixture.projectRoot, 'content', 'timelines'), { recursive: true });
    fs.writeFileSync(path.join(fixture.projectRoot, 'content', 'scenario', 'intro.gal'), '@scene intro\n凛：开始。\n@end\n', 'utf8');
    fs.writeFileSync(path.join(fixture.projectRoot, 'content', 'timelines', 'intro_opening.json'), JSON.stringify({
      version: 1,
      id: 'intro_opening',
      durationMs: 1000,
      tracks: [],
    }), 'utf8');
    fs.writeFileSync(path.join(fixture.projectRoot, 'game.config.json'), JSON.stringify({
      entryScene: 'intro',
      variables: { 'flag.alpha': { type: 'string', initial: '' } },
      characters: { lynn: { name: '凛', avatar: 'lynn' } },
    }), 'utf8');
    const snapshot = await fixture.service.currentSnapshot();
    const objectRefs = [
      'scene:intro',
      'timeline:intro_opening',
      'variable:flag.alpha',
      'character:lynn',
      'config:characters',
      'config:entryScene',
    ];
    const draft = {
      expectedProjectRevision: snapshot.revision,
      replayOperations: [],
      provenance: objectRefs.map((targetObject) => ({
        targetObject,
        sourceCapsule: { changeId: 'chg_src', capsuleId: 'cap_src', artifactSha256: 'a'.repeat(64) },
        sourceUnitId: 'u1',
        sourceOperationIds: [],
      })),
    };
    const result = await fixture.service.dryRun(draft as never);
    expect(result.status).toBe('passed');
    expect(Object.keys(result.finalObjectFingerprints).sort()).toEqual(objectRefs.sort());

    const unknown = await fixture.service.dryRun({
      ...draft,
      provenance: [{ ...draft.provenance[0], targetObject: 'asset:bg/night' }],
    } as never);
    expect(unknown.status).toBe('failed');
    expect(unknown.errors[0]?.code).toBe('COMPOSITION_REPLAY_FAILED');
  });

  it('seals an auditable failed plan when the project has moved past the capsules', async () => {
    const fixture = await setup('stale-clash');
    const first = await sealCandidate(fixture.projectRoot, 'clash-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-clash-a', sceneId: 'clash' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'clash-b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-clash-var', name: 'flag.clash', type: 'number', initial: 0 })).ok).toBe(true);
    });
    // 项目前进：apply 会话真实 commit 一个同样创建 scene:clash 的变更（不同指纹）。
    const mover = await openAgentPortSession({ projectRoot: fixture.projectRoot, policy: 'apply' });
    expect((await mover.invoke('change.begin', {})).ok).toBe(true);
    expect((await mover.invoke('scene.create', { operationId: 'op-mover', sceneId: 'clash' })).ok).toBe(true);
    expect((await mover.invoke('project.validate', {})).ok).toBe(true);
    expect((await mover.invoke('project.simulate', {})).ok).toBe(true);
    expect((await mover.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
    expect((await mover.invoke('change.diff', {})).ok).toBe(true);
    const committed = await mover.invoke('change.commit', {});
    expect(committed.ok).toBe(true);
    await mover.close();

    const planResult = await planFromComparison(fixture, [first.ref, second.ref]);
    // plan 可审计：已封存落盘、含失败详情；dry-run 失败即不可执行。
    expect(planResult.plan.dryRun.status).toBe('failed');
    expect(planResult.plan.dryRun.errors[0]!.code).toBe('OBJECT_PRECONDITION_FAILED');
    const readBack = await fixture.store.readPlan(planResult.plan.planId, planResult.identity.sha256);
    expect(readBack.plan.dryRun.status).toBe('failed');
    expect(readBack.plan.replayOperations.length).toBeGreaterThan(0);
  });

  it('executes a passed plan without scanning the legal review namespace as a change', async () => {
    const fixture = await setup('review-namespace');
    const first = await sealCandidate(fixture.projectRoot, 'review-ns-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-review-ns-scene', sceneId: 'review_ns_scene' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'review-ns-b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-review-ns-variable', name: 'flag.review_ns', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const planned = await planFromComparison(fixture, [first.ref, second.ref]);
    expect(planned.plan.dryRun.status).toBe('passed');

    const reviewId = 'review_namespace_fixture';
    const snapshot = await fixture.service.currentSnapshot();
    const reviews = new NodeReviewStore(fixture.store.projectDirectory, fixture.identity);
    await reviews.createReview(reviewId, {
      reviewVersion: '1.0.0',
      reviewId,
      kind: 'comparison',
      projectIdentity: fixture.identity,
      expectedProjectRevision: snapshot.revision,
      comparisonFingerprint: planned.plan.comparisonFingerprint,
    });
    const reviewManifestPath = path.join(fixture.store.projectDirectory, 'reviews', 'manifest.json');
    expect(fs.existsSync(path.join(fixture.store.projectDirectory, 'reviews', reviewId, 'identity.json'))).toBe(true);
    expect(fs.existsSync(reviewManifestPath)).toBe(false);

    let result: Awaited<ReturnType<CompositionService['executePlan']>> | undefined;
    let failure: unknown;
    try {
      result = await fixture.service.executePlan({
        planId: planned.plan.planId,
        artifactSha256: planned.identity.sha256,
        executeOperationId: 'exec-review-namespace',
      });
    } catch (error) {
      failure = error;
    }
    if (failure !== undefined) {
      expect(failure).toMatchObject({
        code: 'CHANGE_STORE_CORRUPT',
        details: { changeId: 'reviews', path: reviewManifestPath },
      });
    }
    expect(failure).toBeUndefined();
    expect(result?.status).toBe('READY');
    expect(fs.existsSync(path.join(fixture.store.projectDirectory, 'reviews', reviewId, 'identity.json'))).toBe(true);
    expect(fs.existsSync(reviewManifestPath)).toBe(false);
  });

  it('keeps a corrupt chg namespace fail-loud without deleting or repairing it', async () => {
    const fixture = await setup('corrupt-change-namespace');
    const first = await sealCandidate(fixture.projectRoot, 'broken-ns-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-broken-ns-scene', sceneId: 'broken_ns_scene' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'broken-ns-b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-broken-ns-variable', name: 'flag.broken_ns', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const planned = await planFromComparison(fixture, [first.ref, second.ref]);
    expect(planned.plan.dryRun.status).toBe('passed');

    const brokenChangeId = 'chg_broken_namespace';
    const brokenDirectory = path.join(fixture.store.projectDirectory, brokenChangeId);
    const manifestPath = path.join(brokenDirectory, 'manifest.json');
    const sentinelPath = path.join(brokenDirectory, 'preserve.txt');
    fs.mkdirSync(brokenDirectory, { recursive: true });
    fs.writeFileSync(sentinelPath, 'preserve-corrupt-change', 'utf8');

    await expect(fixture.service.executePlan({
      planId: planned.plan.planId,
      artifactSha256: planned.identity.sha256,
      executeOperationId: 'exec-corrupt-change-namespace',
    })).rejects.toMatchObject({
      code: 'CHANGE_STORE_CORRUPT',
      details: { changeId: brokenChangeId, path: manifestPath },
    });
    expect(fs.existsSync(brokenDirectory)).toBe(true);
    expect(fs.existsSync(manifestPath)).toBe(false);
    expect(fs.readFileSync(sentinelPath, 'utf8')).toBe('preserve-corrupt-change');
  });
});

  it('resumes an interrupted integration exactly with a second service instance', async () => {
    const fixture = await setup('resume');
    const first = await sealCandidate(fixture.projectRoot, 'res-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-res-alpha', sceneId: 'alpha' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'res-b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-res-flag', name: 'flag.res', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const planned = await planFromComparison(fixture, [first.ref, second.ref], { now: '2026-08-24T14:00:00.000Z' });
    expect(planned.plan.dryRun.status).toBe('passed');

    // —— 进程 A：创建 integration change 并只推进第一项后“崩溃”——
    {
      const { InMemoryChangeRepository } = await import('@surdet/authoring');
      const snapshot = await fixture.service.currentSnapshot();
      const repository = new InMemoryChangeRepository();
      const probeSession = await import('@surdet/authoring').then((m) => m.beginChange(snapshot, repository, undefined, undefined, {
        integration: {
          planId: planned.plan.planId,
          planFingerprint: planned.plan.planFingerprint,
          executeOperationId: 'exec-1',
          sourceCapsules: planned.plan.sourceCapsules,
          includedUnitIds: planned.plan.selectedUnitIds,
          deduplicatedUnits: planned.plan.deduplicatedUnits,
          conflictResolutions: [],
          status: 'REPLAYING',
          nextOperationIndex: 0,
          replayedOperations: [],
        },
      }));
      void probeSession;
    }
    // 上面的 probe 使用内存 repo，不会留下磁盘 change；改为真实磁盘半成品：
    // 直接以 NodeChangeStore 为 repository 重建同样的 REPLAYING change 并只 replay 第一项。
    const authoring = await import('@surdet/authoring');
    const storage = await (await import('../src/authoring/node-project-storage.js')).NodeProjectStorage.open(fixture.projectRoot);
    const nodeStore = await (await import('../src/authoring/node-change-store.js')).NodeChangeStore.forProject(storage.rootIdentity);
    const snapshot2 = await fixture.service.currentSnapshot();
    // create 免租；随后持 change lease 只推进第一项（模拟崩溃点：receipt 已落盘、后续未跑）。
    const seeded = await authoring.beginChange(snapshot2, nodeStore, storage, undefined, {
      integration: {
        planId: planned.plan.planId,
        planFingerprint: planned.plan.planFingerprint,
        executeOperationId: 'exec-1',
        sourceCapsules: planned.plan.sourceCapsules,
        includedUnitIds: planned.plan.selectedUnitIds,
        deduplicatedUnits: planned.plan.deduplicatedUnits,
        conflictResolutions: [],
        status: 'REPLAYING',
        nextOperationIndex: 0,
        replayedOperations: [],
      },
    });
    const crashed = seeded;
    await NodeChangeStoreStatic.withChangeLease(seeded.record.changeId, async (leased) => {
      const reopened = await leased.read(seeded.record.changeId);
      const crashedSession = new authoring.ChangeSession(reopened!, leased, storage);
      await authoring.replayCompositionOperation(crashedSession, planned.plan.replayOperations[0]!, realHasher);
    });
    const headAfterCrash = await nodeStore.read(seeded.record.changeId);
    // 双阶段中断形态：领域结果已持久化，receipt 未写 → nextOperationIndex 仍为 0。
    expect(headAfterCrash?.integration?.nextOperationIndex).toBe(0);
    expect(Object.keys(headAfterCrash?.operations ?? {})).toContain(planned.plan.replayOperations[0]!.integrationOperationId);

    // —— 进程 B：全新 service instance，无 changeId，精确发现并完成剩余项 ——
    const serviceB = new CompositionService(
      new NodeCompositionStore(path.join(fixture.dataDir, fixture.identity), fixture.identity),
      fixture.identity,
      fixture.projectRoot,
      realHasher,
    );
    const result = await serviceB.executePlan({
      planId: planned.plan.planId,
      artifactSha256: planned.identity.sha256,
      executeOperationId: 'exec-1',
    });
    expect(result.status).toBe('READY');
    expect(result.nextOperationIndex).toBe(planned.plan.replayOperations.length);
    expect(result.workingRevision).toBe(planned.plan.replayOperations.length);
    expect(result.changeId).toBe(crashed.record.changeId);
  });

  it('keeps direct plans unreviewed and binds reviewed plan selections', async () => {
    const fixture = await setup('review-binding');
    const first = await sealCandidate(fixture.projectRoot, 'review-a', async (session) => {
      expect((await session.invoke('scene.create', { operationId: 'op-review-scene', sceneId: 'review_scene' })).ok).toBe(true);
    });
    const second = await sealCandidate(fixture.projectRoot, 'review-b', async (session) => {
      expect((await session.invoke('variable.ensure', { operationId: 'op-review-variable', name: 'flag.review', type: 'number', initial: 0 })).ok).toBe(true);
    });
    const compared = await fixture.service.compare([first.ref, second.ref]);
    const selectedUnitIds = compared.comparison.units.map((item) => item.unitId);
    const direct = await fixture.service.plan({
      candidateRefs: [first.ref, second.ref],
      comparisonFingerprint: compared.comparison.comparisonFingerprint,
      selectedUnitIds,
    });
    const reviewed = await fixture.service.plan({
      candidateRefs: [first.ref, second.ref],
      comparisonFingerprint: compared.comparison.comparisonFingerprint,
      selectedUnitIds,
      review: {
        reviewState: 'human-reviewed',
        reviewId: 'review-binding',
        decisionId: 'decision-binding',
        decisionFingerprint: 'decision-binding-fingerprint',
      },
    });

    expect(direct.plan.review).toEqual({ reviewState: 'unreviewed' });
    expect(direct.plan.planFingerprint).not.toBe(reviewed.plan.planFingerprint);
    const reviewedReview = reviewed.plan.review;
    expect(reviewedReview).toBeDefined();
    if (!reviewedReview || reviewedReview.reviewState !== 'human-reviewed') {
      throw new Error('reviewed plan did not retain its human review binding');
    }
    expect(reviewedReview).toMatchObject({
      reviewId: 'review-binding',
      decisionId: 'decision-binding',
      decisionFingerprint: 'decision-binding-fingerprint',
    });
    expect(reviewed.plan.planFingerprint).not.toBe(direct.plan.planFingerprint);
  });
