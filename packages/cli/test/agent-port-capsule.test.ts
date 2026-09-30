import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadProjectSnapshot } from '@surdet/authoring';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { ChangeRecordProjectStorage } from '../src/authoring/working-project-storage.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';

const temporaryRoots: string[] = [];

function makeProject(name: string): string {
  const root = fs.mkdtempSync(path.join(process.cwd(), `.surdet-agent-capsule-${name}-`));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  return root;
}

async function openSession(name: string, policy: 'stage' | 'apply' = 'stage', resumeChangeId?: string, projectRoot?: string, sharedDataDirectory?: string): Promise<AgentPortSession> {
  const root = projectRoot ?? makeProject(name);
  const data = sharedDataDirectory ?? fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-capsule-data-'));
  if (sharedDataDirectory === undefined) temporaryRoots.push(data);
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  return openAgentPortSession({ projectRoot: root, policy, ...(resumeChangeId === undefined ? {} : { resumeChangeId }) });
}

async function stageEvidence(session: AgentPortSession): Promise<void> {
  expect((await session.invoke('project.validate', {})).ok).toBe(true);
  expect((await session.invoke('project.simulate', {})).ok).toBe(true);
  expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
  expect((await session.invoke('change.diff', {})).ok).toBe(true);
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describe('Surdet Agent Port invocation ledger and delivery capsule', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('retains failed and repaired invocations without raw input', async () => {
    const session = await openSession('failure-retention');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const failed = await session.invoke('scene.patch', {
      operationId: 'op-stale',
      sceneId: 'start',
      patch: { kind: 'removeObject', target: 'scene:start/text:0@missing', expectedFingerprint: '0'.repeat(64) },
    });
    expect(failed.ok).toBe(false);
    expect((await session.invoke('scene.create', { operationId: 'op-repair', sceneId: 'repaired' })).ok).toBe(true);
    const changeId = session.activeChangeId!;
    const opened = await NodeChangeStore.openByChangeId(changeId);
    expect(opened).not.toBeNull();
    const invocations = await opened!.store.readInvocations(changeId);
    expect(invocations).toHaveLength(3);
    expect(invocations[1]).toMatchObject({
      operationId: 'op-stale', ok: false,
      workingRevisionBefore: 0, workingRevisionAfter: 0,
    });
    expect(invocations[2]).toMatchObject({ operationId: 'op-repair', ok: true });
    for (const item of invocations) {
      expect(item.inputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(item).not.toHaveProperty('input');
      expect(item).not.toHaveProperty('text');
      expect(item).not.toHaveProperty('prompt');
    }
    await session.close();
  });

  it('keeps request identity on policy failures without accepting an invalid operationId', async () => {
    const session = await openSession('failure-identity');
    try {
      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      const denied = await session.invoke('change.recovery.execute', {
        operationId: 'op-policy-denied', recoveryToken: 'unused',
      });
      expect(denied).toMatchObject({ ok: false, error: { code: 'POLICY_BLOCKED' } });
      expect(await session.invoke('scene.create', { operationId: 42, sceneId: 'invalid' }))
        .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
      const opened = await NodeChangeStore.openByChangeId(session.activeChangeId!);
      const facts = await opened!.store.readInvocations(session.activeChangeId!);
      expect(facts[1]).toMatchObject({ operationId: 'op-policy-denied', ok: false, errorCode: 'POLICY_BLOCKED' });
      expect(facts[2]).not.toHaveProperty('operationId');
      expect(opened!.record.workingRevision).toBe(0);
      expect(Object.keys(opened!.record.operations)).toEqual([]);
    } finally { await session.close(); }
  });

  it.each(['__proto__', 'constructor'])('persists and replays prototype-named operationId %s through Agent Port', async (operationId) => {
    const session = await openSession(`prototype-operation-${operationId}`, 'apply');
    try {
      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      const input = { operationId, sceneId: `prototype_${operationId}` };
      const first = await session.invoke('scene.create', input);
      expect(first.ok).toBe(true);
      const replay = await session.invoke('scene.create', input);
      expect(replay.ok).toBe(true);
      if (!first.ok || !replay.ok) throw new Error('prototype operation failed');
      expect(replay.result).toEqual(first.result);

      const opened = await NodeChangeStore.openByChangeId(session.activeChangeId!);
      expect(opened).not.toBeNull();
      expect(Object.prototype.hasOwnProperty.call(opened!.record.operations, operationId)).toBe(true);
      expect(opened!.record.operations[operationId]!.sequence).toBe(0);
    } finally {
      await session.close();
    }
  });

  it('keeps prototype-shaped variables on the public Agent Port path', async () => {
    const session = await openSession('prototype-config', 'apply');
    try {
      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      const variable = await session.invoke('variable.ensure', {
        operationId: 'prototype-variable', name: '__proto__', type: 'number', initial: 7,
      });
      expect(variable.ok).toBe(true);

      const opened = await NodeChangeStore.openByChangeId(session.activeChangeId!);
      expect(opened).not.toBeNull();
      const config = JSON.parse(opened!.record.workingFiles['game.config.json']!) as { variables: Record<string, unknown> };
      expect(Object.prototype.hasOwnProperty.call(config.variables, '__proto__')).toBe(true);
      expect(config.variables['__proto__']).toEqual({ type: 'number', initial: 7 });
    } finally {
      await session.close();
    }
  });

  it('seals an OPEN stage capsule without mutating project files', async () => {
    const session = await openSession('stage-capsule');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    expect((await session.invoke('scene.create', { operationId: 'op-stage', sceneId: 'staged' })).ok).toBe(true);
    const before = fs.readFileSync(path.join(session.projectRoot, 'game.config.json'));
    await stageEvidence(session);
    const capsule = await generateDeliveryCapsule(session);
    expect(capsule.changeStatus).toBe('OPEN');
    expect(capsule.projectMutation).toEqual(expect.objectContaining({ occurred: false, expectedByPolicy: false }));
    expect(capsule.projectMutation.beforeRevision).toBe(capsule.projectMutation.afterRevision);
    expect(fs.readFileSync(path.join(session.projectRoot, 'game.config.json'))).toEqual(before);
    expect(capsule.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', code: 'SPEAKER_UNRESOLVED' }),
    ]));
    expect(capsule.manualReviewRequired).toContain('VALIDATION_WARNINGS');
    await session.close();
  });

  it('seals a committed apply capsule after explicit resume', async () => {
    const sharedDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-capsule-shared-data-'));
    temporaryRoots.push(sharedDataDirectory);
    const stage = await openSession('apply-capsule-stage', 'stage', undefined, undefined, sharedDataDirectory);
    expect((await stage.invoke('change.begin', {})).ok).toBe(true);
    expect((await stage.invoke('scene.create', { operationId: 'op-apply', sceneId: 'applied' })).ok).toBe(true);
    await stageEvidence(stage);
    const changeId = stage.activeChangeId!;
    await stage.close();
    const apply = await openSession('apply-capsule-apply', 'apply', changeId, stage.projectRoot, sharedDataDirectory);
    expect(apply.projectIdentity).toBe(stage.projectIdentity);
    const committed = await apply.invoke('change.commit', {});
    expect(committed.ok).toBe(true);
    const capsule = await generateDeliveryCapsule(apply);
    expect(capsule.changeStatus).toBe('COMMITTED');
    expect(capsule.projectMutation.occurred).toBe(true);
    expect(capsule.projectMutation.expectedByPolicy).toBe(true);
    expect(capsule.projectMutation.beforeRevision).not.toBe(capsule.projectMutation.afterRevision);
    await apply.close();
  });

  it('marks all prior evidence stale after a later mutation', async () => {
    const session = await openSession('freshness');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    await stageEvidence(session);
    expect((await session.invoke('scene.create', { operationId: 'op-after-evidence', sceneId: 'later' })).ok).toBe(true);
    const capsule = await generateDeliveryCapsule(session);
    expect(capsule.validation.status).toBe('stale');
    expect(capsule.simulation.status).toBe('stale');
    expect(capsule.runtime.status).toBe('stale');
    expect((capsule.objectDiff as any).freshness?.status ?? capsule.warnings).toBeDefined();
    expect(capsule.capsuleVersion).toBe('2.0.0');
    expect(capsule.contractVersion).toBe('2.29.0');
    expect(capsule.composition.eligibility).toBe('ready');
    const manifest = capsule.composition.manifest as { operations: unknown[] } | undefined;
    expect(manifest?.operations.length).toBeGreaterThan(0);
    await session.close();
  });

  it('seals explicitly selected candidate manifests in apply with persisted operation order', async () => {
    const seal = async (name: string, sceneOperationId: string, entryOperationId: string) => {
      const session = await openSession(name, 'apply');
      try {
        expect((await session.invoke('change.begin', { compositionMode: 'candidate' })).ok).toBe(true);
        expect((await session.invoke('scene.create', {
          operationId: sceneOperationId,
          sceneId: 'direct_entry',
          blocks: [{ kind: 'text', value: '直达入口。' }],
        })).ok).toBe(true);
        const inspected = await session.invoke('object.inspect', { objectRef: 'config:entryScene' });
        expect(inspected.ok).toBe(true);
        if (!inspected.ok) throw new Error(inspected.error.message);
        const entryFingerprint = (inspected.result as { fingerprint?: unknown }).fingerprint;
        expect(typeof entryFingerprint).toBe('string');
        expect((await session.invoke('project.entry-scene.set', {
          operationId: entryOperationId,
          sceneId: 'direct_entry',
          expectedFingerprint: entryFingerprint,
        })).ok).toBe(true);
        expect((await session.invoke('change.diff', {})).ok).toBe(true);

        const opened = await NodeChangeStore.openByChangeId(session.activeChangeId!);
        expect(opened).not.toBeNull();
        const record = opened!.record;
        expect(record.operations[sceneOperationId]!.sequence).toBe(0);
        expect(record.operations[entryOperationId]!.sequence).toBe(1);
        return await generateDeliveryCapsule(session);
      } finally {
        await session.close();
      }
    };

    const numeric = await seal('direct-numeric-order', '10', '2');
    expect(numeric.composition.eligibility).toBe('ready');
    if (numeric.composition.eligibility !== 'ready') return;
    const numericManifest = numeric.composition.manifest as {
      operations: Array<{ sourceOperationId: string; sequence: number; requiredObjects: unknown[] }>;
    };
    expect(numericManifest.operations.map((operation) => [operation.sourceOperationId, operation.sequence]))
      .toEqual([['10', 0], ['2', 1]]);
    expect((numeric.operations as Array<{ operationId: string }>).map((operation) => operation.operationId))
      .toEqual(['10', '2']);
    expect((numeric.objectDiff as { semantic: Array<{ operationId: string }> }).semantic.map((entry) => entry.operationId))
      .toEqual(['change.diff:content/scenario/direct_entry.gal', 'change.diff:game.config.json', '2']);
    expect(numericManifest.operations[1]!.requiredObjects).toContainEqual(expect.objectContaining({
      objectRef: 'scene:direct_entry', source: 'candidate', candidateOperationSequence: 0,
    }));

    const alphabetic = await seal('direct-alphabetic-order', 'scene-first', 'entry-second');
    expect(alphabetic.composition.eligibility).toBe('ready');
    if (alphabetic.composition.eligibility !== 'ready') return;
    const alphabeticManifest = alphabetic.composition.manifest as {
      operations: Array<{ sourceOperationId: string; sequence: number }>;
    };
    expect(alphabeticManifest.operations.map((operation) => [operation.sourceOperationId, operation.sequence]))
      .toEqual([['scene-first', 0], ['entry-second', 1]]);
    expect((alphabetic.operations as Array<{ operationId: string }>).map((operation) => operation.operationId))
      .toEqual(['scene-first', 'entry-second']);
  });

  it('keeps consecutive capsules immutable and verifies disk identity', async () => {
    const session = await openSession('immutable');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    const first = await generateDeliveryCapsule(session);
    const firstBytes = fs.readFileSync(first.artifactIdentity.path);
    const firstSha = sha256(first.artifactIdentity.path);
    const second = await generateDeliveryCapsule(session);
    expect(second.capsuleId).not.toBe(first.capsuleId);
    expect(second.artifactIdentity.path).not.toBe(first.artifactIdentity.path);
    expect(fs.readFileSync(first.artifactIdentity.path)).toEqual(firstBytes);
    expect(first.artifactIdentity.bytes).toBe(firstBytes.byteLength);
    expect(first.artifactIdentity.sha256).toBe(firstSha);
    const identityPath = path.join(path.dirname(first.artifactIdentity.path), 'identity.json');
    const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8')) as any;
    expect(identity.path).toBe(first.artifactIdentity.path);
    expect(identity.bytes).toBe(first.artifactIdentity.bytes);
    expect(identity.sha256).toBe(first.artifactIdentity.sha256);
    await session.close();
  });

  it('builds base and working snapshots from the same record adapter without disk writes', async () => {
    const session = await openSession('dual-view');
    expect((await session.invoke('change.begin', {})).ok).toBe(true);
    expect((await session.invoke('scene.create', { operationId: 'op-dual-view', sceneId: 'dual_view' })).ok).toBe(true);
    const changeId = session.activeChangeId!;
    const opened = await NodeChangeStore.openByChangeId(changeId);
    expect(opened).not.toBeNull();
    const record = opened!.record;
    const dataDir = process.env['SURDET_AGENT_DATA_DIR']!;
    const listDataFiles = (): string[] => fs.readdirSync(dataDir, { recursive: true }).map((entry) => String(entry)).sort();
    const before = listDataFiles();
    const hasher = {
      sha256: async (text: string) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
    };
    const working = await loadProjectSnapshot(new ChangeRecordProjectStorage(record, 'working'), hasher);
    const base = await loadProjectSnapshot(new ChangeRecordProjectStorage(record, 'base'), hasher);
    expect(working.scenes.some((scene) => scene.id === 'dual_view')).toBe(true);
    expect(base.scenes.some((scene) => scene.id === 'dual_view')).toBe(false);
    expect(listDataFiles()).toEqual(before);
    await session.close();
  });

  it('seals a ready composition when a new timeline uses resolved but previously unreferenced assets', async () => {
    const root = makeProject('unreferenced-assets');
    fs.mkdirSync(path.join(root, 'content', 'assets', 'bg'), { recursive: true });
    fs.mkdirSync(path.join(root, 'content', 'assets', 'portrait'), { recursive: true });
    fs.mkdirSync(path.join(root, 'content', 'timelines'), { recursive: true });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>\n';
    fs.writeFileSync(path.join(root, 'content', 'assets', 'bg', 'post_office.svg'), svg, 'utf8');
    fs.writeFileSync(path.join(root, 'content', 'assets', 'bg', 'lighthouse_dawn.svg'), svg, 'utf8');
    fs.writeFileSync(path.join(root, 'content', 'assets', 'portrait', 'lynn_uniform_night.svg'), svg, 'utf8');

    const session = await openSession('unreferenced-assets', 'stage', undefined, root);
    try {
      const assets = await session.invoke('project.assets', {});
      expect(assets.ok).toBe(true);
      if (!assets.ok) throw new Error(assets.error.message);
      const catalog = assets.result as {
        backgrounds: Array<{ key: string; sourcePath: string; resolved: boolean }>;
        portraits: Array<{ key: string; timelineTarget?: string; role?: string; outfit?: string; expression?: string; sourcePath: string; resolved: boolean }>;
      };
      const postOffice = catalog.backgrounds.find((entry) => entry.key === 'post_office');
      const lighthouse = catalog.backgrounds.find((entry) => entry.key === 'lighthouse_dawn');
      const portrait = catalog.portraits.find((entry) => entry.key === 'lynn:uniform' && entry.expression === 'night');
      expect(postOffice).toEqual(expect.objectContaining({ sourcePath: 'content/assets/bg/post_office.svg', resolved: true }));
      expect(lighthouse).toEqual(expect.objectContaining({ sourcePath: 'content/assets/bg/lighthouse_dawn.svg', resolved: true }));
      expect(portrait).toEqual(expect.objectContaining({ sourcePath: 'content/assets/portrait/lynn_uniform_night.svg', resolved: true }));
      expect(portrait?.timelineTarget).toBe('lynn:uniform');

      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      const timelineId = 'unreferenced_asset_timeline';
      expect((await session.invoke('timeline.create', {
        operationId: 'op-unreferenced-assets-timeline',
        timelineId,
        definition: {
          version: 1,
          id: timelineId,
          durationMs: 100,
          tracks: [
            {
              kind: 'background',
              cues: [
                { atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: postOffice!.key },
                { atMs: 50, durationMs: 0, easing: 'linear', action: 'set', key: lighthouse!.key },
              ],
            },
            {
              kind: 'portrait',
              target: portrait!.timelineTarget,
              cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'show', expression: portrait!.expression, position: 'left' }],
            },
          ],
        },
      })).ok).toBe(true);
      expect((await session.invoke('scene.create', {
        operationId: 'op-unreferenced-assets-scene',
        sceneId: 'unreferenced_asset_scene',
        blocks: [{ kind: 'instruction', name: 'timeline', args: [timelineId] }],
      })).ok).toBe(true);
      await stageEvidence(session);

      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility).toBe('ready');
      const manifest = capsule.composition.manifest as {
        operations: Array<{
          capabilityId: string;
          sourceOperationId: string;
          requiredObjects: Array<{ objectRef: string; source: string; candidateOperationSequence?: number }>;
        }>;
      };
      const timelineOperation = manifest.operations.find((operation) => operation.sourceOperationId === 'op-unreferenced-assets-timeline');
      expect(timelineOperation).toBeDefined();
      const requiredObjects = timelineOperation!.requiredObjects;
      const expectedAssetRefs = [
        `asset:bg:${postOffice!.key}`,
        `asset:bg:${lighthouse!.key}`,
        `asset:portrait:${portrait!.role}:${portrait!.outfit}:${portrait!.expression}`,
      ];
      expect(requiredObjects.map((object) => object.objectRef).sort()).toEqual(expectedAssetRefs.sort());
      for (const objectRef of expectedAssetRefs) {
        expect(requiredObjects).toContainEqual(expect.objectContaining({ objectRef, source: 'base' }));
      }
      const sceneOperation = manifest.operations.find((operation) => operation.sourceOperationId === 'op-unreferenced-assets-scene');
      expect(sceneOperation?.requiredObjects).toContainEqual(expect.objectContaining({
        objectRef: `timeline:${timelineId}`,
        source: 'candidate',
        candidateOperationSequence: 0,
      }));
    } finally {
      await session.close();
    }
  });

  it('rejects a missing timeline asset before persistence and keeps the persisted candidate ready', async () => {
    const root = makeProject('missing-asset');
    fs.mkdirSync(path.join(root, 'content', 'assets', 'portrait'), { recursive: true });
    fs.mkdirSync(path.join(root, 'content', 'timelines'), { recursive: true });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>\n';
    fs.writeFileSync(path.join(root, 'content', 'assets', 'portrait', 'lynn_uniform_night.svg'), svg, 'utf8');

    const session = await openSession('missing-asset', 'stage', undefined, root);
    try {
      const assets = await session.invoke('project.assets', {});
      expect(assets.ok).toBe(true);
      if (!assets.ok) throw new Error(assets.error.message);
      const catalog = assets.result as {
        backgrounds: Array<{ key: string; resolved: boolean }>;
        portraits: Array<{ key: string; timelineTarget?: string; expression?: string; resolved: boolean }>;
      };
      expect(catalog.backgrounds.some((entry) => entry.key === 'missing_backdrop')).toBe(false);
      const portrait = catalog.portraits.find((entry) => entry.key === 'lynn:uniform' && entry.expression === 'night');
      expect(portrait).toEqual(expect.objectContaining({ resolved: true }));

      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      await stageEvidence(session);
      const before = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      const timelineId = 'missing_asset_timeline';
      const created = await session.invoke('timeline.create', {
        operationId: 'op-missing-asset-timeline',
        timelineId,
        definition: {
          version: 1,
          id: timelineId,
          durationMs: 100,
          tracks: [
            { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'missing_backdrop' }] },
            { kind: 'portrait', target: portrait!.timelineTarget, cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'show', expression: portrait!.expression, position: 'left' }] },
          ],
        },
      });
      expect(created, JSON.stringify(created)).toMatchObject({ ok: false, error: {
        code: 'CANDIDATE_DEPENDENCY_NOT_READY', details: { operationApplied: false, issues: [expect.objectContaining({ objectRef: 'asset:bg:missing_backdrop', code: 'ASSET_NOT_RESOLVED' })] },
      } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(before);

      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility).toBe('ready');
      expect(capsule.operations).toEqual([]);
      expect(capsule.validation.status).toBe('fresh');
      expect((await session.describe()).candidateReadiness).toMatchObject({ status: 'ready', operationCount: 0 });
    } finally {
      await session.close();
    }
  });

  it('keeps final sealing authoritative when a previously resolved asset disappears', async () => {
    const root = makeProject('disappearing-asset');
    const assetPath = path.join(root, 'content', 'assets', 'bg', 'night.svg');
    fs.mkdirSync(path.dirname(assetPath), { recursive: true });
    fs.writeFileSync(assetPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
    const session = await openSession('disappearing-asset', 'stage', undefined, root);
    try {
      expect((await session.invoke('change.begin', {})).ok).toBe(true);
      expect((await session.invoke('scene.create', { operationId: 'night-scene', sceneId: 'night', blocks: [{ kind: 'instruction', name: 'bg', args: ['night'] }] })).ok).toBe(true);
      fs.unlinkSync(assetPath);
      expect((await session.describe()).candidateReadiness?.status).toBe('ready');
      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility).toBe('unavailable');
      expect(capsule.composition.reasons).toContainEqual(expect.objectContaining({ code: 'DEPENDENCY_IDENTITY_UNAVAILABLE', operationId: 'night-scene' }));
    } finally {
      await session.close();
    }
  });
});
