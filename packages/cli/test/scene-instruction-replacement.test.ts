import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginChange,
  ChangeSession,
  nativeCapabilityToMcpTool,
  replayCompositionOperation,
  type AuthoringCapabilityId,
  type AuthoringObject,
  type CandidateCapsuleRef,
  type TextHasher,
} from '@surdet/authoring';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { compositionServiceForProject } from '../src/authoring/composition-service.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';

const temporaryRoots: string[] = [];

describe('维护：匿名对象引用绑定当前容器', () => {
  it.each(['stage', 'apply'] as const)('%s 拒绝删除后移位的同文对白与相同时间轴节点，并保留重试', async policy => {
    const fixture = makeProject(`anonymous-${policy}`);
    fs.writeFileSync(path.join(fixture.root, fixture.rootScenePath), '@scene start\n相同正文\n相同正文\n@end\n');
    fs.mkdirSync(path.join(fixture.root, 'content/timelines'), { recursive: true });
    const cue = { atMs: 0, durationMs: 100, easing: 'linear', action: 'fade', alpha: 1 };
    const track = { kind: 'screen', cues: [cue, cue, cue] };
    fs.writeFileSync(path.join(fixture.root, 'content/timelines/t.json'), JSON.stringify({ version: 1, id: 't', durationMs: 100, tracks: [track, track, track] }));
    const baseline = fs.readFileSync(path.join(fixture.root, fixture.rootScenePath));
    const c = await connected(fixture, policy);
    try {
      expect((await call(c.client, 'change.begin')).body.ok).toBe(true);
      const scene = await inspectMcpObject(c.client, 'scene:start');
      const oldText = await inspectMcpObject(c.client, scene.childRefs!.find(ref => ref.includes('/text:'))!);
      expect((await call(c.client, 'scene.patch', { operationId: 'remove-text', sceneId: 'start', patch: { kind: 'removeObject', target: oldText.objectRef, expectedFingerprint: oldText.fingerprint } })).body.ok).toBe(true);
      for (const patch of [
        { kind: 'replaceText', target: oldText.objectRef, expectedFingerprint: oldText.fingerprint, value: '不应写入' },
        { kind: 'removeObject', target: oldText.objectRef, expectedFingerprint: oldText.fingerprint },
        { kind: 'insertAfter', anchor: oldText.objectRef, expectedFingerprint: oldText.fingerprint, blocks: [{ kind: 'text', value: '不应写入' }] },
      ]) {
        const before = (await NodeChangeStore.openByChangeId(c.session.activeChangeId!))!.record;
        expect((await call(c.client, 'scene.patch', { operationId: `stale-${patch.kind}`, sceneId: 'start', patch })).body.ok).toBe(false);
        expect((await NodeChangeStore.openByChangeId(c.session.activeChangeId!))!.record).toEqual(before);
      }
      for (const kind of ['cue', 'track'] as const) {
        const ref = kind === 'cue' ? 'timeline:t/track:0/cue:0' : 'timeline:t/track:0';
        const old = await inspectMcpObject(c.client, ref);
        const patch = kind === 'cue'
          ? { kind: 'removeCue', cueRef: ref, expectedFingerprint: old.fingerprint }
          : { kind: 'removeTrack', trackRef: ref, expectedFingerprint: old.fingerprint };
        const request = { operationId: `remove-${kind}`, timelineId: 't', patch };
        const first = (await call(c.client, 'timeline.patch', request)).body;
        expect(first, JSON.stringify(first)).toMatchObject({ ok: true });
        const before = (await NodeChangeStore.openByChangeId(c.session.activeChangeId!))!.record;
        expect((await call(c.client, 'timeline.patch', { ...request, operationId: `stale-${kind}` })).body.ok).toBe(false);
        expect((await NodeChangeStore.openByChangeId(c.session.activeChangeId!))!.record).toEqual(before);
        expect((await call(c.client, 'timeline.patch', request)).body.result).toEqual(first.result);
        const current = await inspectMcpObject(c.client, ref);
        const fresh = (await call(c.client, 'timeline.patch', { operationId: `fresh-${kind}`, timelineId: 't', patch: { ...patch, expectedFingerprint: current.fingerprint } })).body;
        expect(fresh, JSON.stringify(fresh)).toMatchObject({ ok: true });
      }
      expect(fs.readFileSync(path.join(fixture.root, fixture.rootScenePath))).toEqual(baseline);
    } finally { await closeConnected(c); }
  });
});

const realHasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

interface SceneFixture {
  root: string;
  data: string;
  rootScenePath: string;
  nestedScenePath: string;
}

interface ConnectedSession {
  session: AgentPortSession;
  client: Client;
  server: ReturnType<typeof createAgentPortServer>;
}

interface InstructionTarget {
  objectRef: string;
  fingerprint: string;
  source: NonNullable<AuthoringObject['source']>;
}

interface StructureTarget {
  objectRef: string;
  fingerprint: string;
  structure: Record<string, any>;
}

interface SealedCandidate {
  ref: CandidateCapsuleRef;
}

type McpCapability = AuthoringCapabilityId | 'session.describe' | 'surdet_delivery_capsule';

function makeProject(name: string): SceneFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-wave15-scene-${name}-`));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), `surdet-wave15-scene-data-${name}-`));
  temporaryRoots.push(root, data);
  process.env['SURDET_AGENT_DATA_DIR'] = data;

  const scenarioDirectory = path.join(root, 'content', 'scenario', 'subdir');
  const backgroundDirectory = path.join(root, 'content', 'assets', 'bg');
  fs.mkdirSync(scenarioDirectory, { recursive: true });
  fs.mkdirSync(backgroundDirectory, { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');

  const rootScenePath = 'content/scenario/start.gal';
  const nestedScenePath = 'content/scenario/subdir/x.gal';
  fs.writeFileSync(path.join(root, rootScenePath), '@scene start\n@bg old_start\n@end\n', 'utf8');
  fs.writeFileSync(path.join(root, nestedScenePath), '@scene x\n@bg old_nested\n@end\n', 'utf8');

  for (const key of ['old_start', 'new_start', 'old_nested', 'new_nested', 'new_left', 'new_right']) {
    fs.writeFileSync(path.join(backgroundDirectory, `${key}.svg`), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>', 'utf8');
  }
  return { root, data, rootScenePath, nestedScenePath };
}

function mcpTool(id: McpCapability): string {
  if (id === 'session.describe') return 'surdet_session_describe';
  if (id === 'surdet_delivery_capsule') return id;
  return nativeCapabilityToMcpTool(id);
}

function textContent(result: { content?: readonly unknown[] }): string {
  const item = result.content?.find((candidate): candidate is { type: 'text'; text: string } => (
    typeof candidate === 'object'
    && candidate !== null
    && (candidate as { type?: unknown }).type === 'text'
    && typeof (candidate as { text?: unknown }).text === 'string'
  ));
  if (item === undefined) throw new Error('MCP result did not contain a text content block');
  return item.text;
}

function envelope(result: { content?: readonly unknown[] }): Record<string, any> {
  const text = textContent(result);
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(`MCP envelope parse failed: ${text}`);
  }
}

async function connected(fixture: SceneFixture, policy: 'observe' | 'stage' | 'apply'): Promise<ConnectedSession> {
  process.env['SURDET_AGENT_DATA_DIR'] = fixture.data;
  const session = await openAgentPortSession({ projectRoot: fixture.root, policy });
  const server = createAgentPortServer(session);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'scene-instruction-replacement-test', version: '0.1.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { session, client, server };
}

async function closeConnected(connectedSession: ConnectedSession): Promise<void> {
  await connectedSession.client.close();
  await connectedSession.server.close();
  await connectedSession.session.close();
}

async function call(
  client: Client,
  capability: McpCapability,
  input: Record<string, unknown> = {},
): Promise<{ raw: any; body: Record<string, any> }> {
  const raw = await client.callTool({ name: mcpTool(capability), arguments: input });
  const body = envelope(raw);
  expect(textContent(raw)).toBe(JSON.stringify(raw.structuredContent));
  return { raw, body };
}

async function findInstructionTarget(session: AgentPortSession, sceneId: string, rawNeedle: string): Promise<InstructionTarget> {
  const scene = await session.invoke('object.inspect', { objectRef: `scene:${sceneId}` });
  if (!scene.ok) throw new Error(scene.error.message);
  const sceneObject = scene.result as AuthoringObject;
  for (const childRef of sceneObject.childRefs ?? []) {
    const inspected = await session.invoke('object.inspect', { objectRef: childRef });
    if (!inspected.ok) throw new Error(inspected.error.message);
    const object = inspected.result as AuthoringObject;
    if (object.kind === 'instruction' && object.source?.raw.includes(rawNeedle) && typeof object.fingerprint === 'string') {
      return { objectRef: object.objectRef, fingerprint: object.fingerprint, source: object.source };
    }
  }
  throw new Error(`instruction ${rawNeedle} not found in scene:${sceneId}`);
}

async function findMcpInstructionTarget(client: Client, sceneId: string, rawNeedle: string): Promise<InstructionTarget> {
  const scene = await call(client, 'object.inspect', { objectRef: `scene:${sceneId}` });
  if (scene.body.ok !== true) throw new Error(JSON.stringify(scene.body));
  const sceneObject = scene.body.result as AuthoringObject;
  for (const childRef of sceneObject.childRefs ?? []) {
    const inspected = await call(client, 'object.inspect', { objectRef: childRef });
    if (inspected.body.ok !== true) throw new Error(JSON.stringify(inspected.body));
    const object = inspected.body.result as AuthoringObject;
    if (object.kind === 'instruction' && object.source?.raw.includes(rawNeedle) && typeof object.fingerprint === 'string') {
      return { objectRef: object.objectRef, fingerprint: object.fingerprint, source: object.source };
    }
  }
  throw new Error(`instruction ${rawNeedle} not found in scene:${sceneId}`);
}

async function findMcpStructureTarget(client: Client, sceneId: string, kind: 'choice' | 'condition'): Promise<StructureTarget> {
  const scene = await call(client, 'object.inspect', { objectRef: `scene:${sceneId}` });
  if (scene.body.ok !== true) throw new Error(JSON.stringify(scene.body));
  const sceneObject = scene.body.result as AuthoringObject;
  for (const childRef of sceneObject.childRefs ?? []) {
    const inspected = await call(client, 'object.inspect', { objectRef: childRef });
    if (inspected.body.ok !== true) throw new Error(JSON.stringify(inspected.body));
    const object = inspected.body.result as AuthoringObject;
    const structure = (object.details as { structure?: Record<string, any> } | undefined)?.structure;
    if (object.kind === kind && structure !== undefined && typeof structure.fingerprint === 'string') {
      return { objectRef: object.objectRef, fingerprint: structure.fingerprint, structure };
    }
  }
  throw new Error(`${kind} structure not found in scene:${sceneId}`);
}

async function inspectMcpObject(client: Client, objectRef: string): Promise<AuthoringObject> {
  const inspected = await call(client, 'object.inspect', { objectRef });
  if (inspected.body.ok !== true) throw new Error(JSON.stringify(inspected.body));
  return inspected.body.result as AuthoringObject;
}

async function sealCandidate(
  fixture: SceneFixture,
  label: string,
  sceneId: string,
  sourceNeedle: string,
  replacement: string,
): Promise<SealedCandidate> {
  const session = await openAgentPortSession({ projectRoot: fixture.root, policy: 'stage' });
  try {
    expect((await session.invoke('change.begin', { intent: `Wave15 ${label}` })).ok).toBe(true);
    const target = await findInstructionTarget(session, sceneId, sourceNeedle);
    const patched = await session.invoke('scene.patch', {
      operationId: `replace-${label}`,
      patch: {
        kind: 'replaceInstruction',
        target: target.objectRef,
        expectedFingerprint: target.fingerprint,
        instruction: { kind: 'instruction', name: 'bg', args: [replacement] },
      },
    });
    expect(patched, JSON.stringify(patched)).toMatchObject({ ok: true, result: { kind: 'replaceInstruction' } });
    expect((await session.invoke('project.validate', {})).ok).toBe(true);
    expect((await session.invoke('project.simulate', { sceneId: 'start', seed: 0 })).ok).toBe(true);
    expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [], seed: 0 })).ok).toBe(true);
    expect((await session.invoke('change.diff', {})).ok).toBe(true);
    const capsule = await generateDeliveryCapsule(session, label);
    expect(capsule.composition.eligibility, JSON.stringify(capsule.composition)).toBe('ready');
    return { ref: { changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 } };
  } finally {
    await session.close();
  }
}

function treeSnapshot(root: string): Map<string, string> {
  const entries = new Map<string, string>();
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else entries.set(full, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  };
  visit(root);
  return entries;
}

function bgLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trimStart().startsWith('@bg '));
}

describe('Wave15 replaceInstruction through the CLI service and disk', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('stages a nested replacement through formal MCP, preserves the source disk, and seals its input and asset dependency', { timeout: 30_000 }, async () => {
    const fixture = makeProject('mcp-nested');
    const sourcePath = path.join(fixture.root, fixture.nestedScenePath);
    const sourceBefore = fs.readFileSync(sourcePath, 'utf8');
    const connectedSession = await connected(fixture, 'stage');
    try {
      expect((await call(connectedSession.client, 'change.begin')).body.ok).toBe(true);
      const target = await findMcpInstructionTarget(connectedSession.client, 'x', '@bg old_nested');
      expect(target.source.path).toBe(fixture.nestedScenePath);
      expect(target.objectRef).toMatch(/^scene:x\/instruction:\d+@[0-9a-f]{8}-[0-9a-f]{8}$/);
      const beforeFailedPatches = (await NodeChangeStore.openByChangeId(connectedSession.session.activeChangeId!, fixture.data))!.record;

      const invalid = await call(connectedSession.client, 'scene.patch', {
        operationId: 'replace-nested-invalid',
        patch: {
          kind: 'replaceInstruction',
          target: target.objectRef,
          expectedFingerprint: target.fingerprint === 'deadbeef' ? 'cafebabe' : 'deadbeef',
          instruction: { kind: 'instruction', name: 'bg', args: ['new_nested'] },
        },
      });
      expect(invalid.raw.isError).toBe(true);
      expect(invalid.body.ok).toBe(false);
      expect(invalid.body.error).toEqual(expect.objectContaining({ code: 'OBJECT_PRECONDITION_FAILED' }));
      expect((invalid.raw.structuredContent as Record<string, any>).error.code).toBe('OBJECT_PRECONDITION_FAILED');
      const afterInvalid = (await NodeChangeStore.openByChangeId(connectedSession.session.activeChangeId!, fixture.data))!.record;
      expect(afterInvalid.workingRevision).toBe(beforeFailedPatches.workingRevision);
      expect(Object.keys(afterInvalid.operations)).toEqual(Object.keys(beforeFailedPatches.operations));

      const missingAsset = await call(connectedSession.client, 'scene.patch', {
        operationId: 'replace-nested-missing-asset',
        patch: {
          kind: 'replaceInstruction',
          target: target.objectRef,
          expectedFingerprint: target.fingerprint,
          instruction: { kind: 'instruction', name: 'bg', args: ['missing_nested'] },
        },
      });
      expect(missingAsset.raw.isError).toBe(true);
      expect(missingAsset.body).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY' } });
      const afterMissingAsset = (await NodeChangeStore.openByChangeId(connectedSession.session.activeChangeId!, fixture.data))!.record;
      expect(afterMissingAsset.workingRevision).toBe(beforeFailedPatches.workingRevision);
      expect(Object.keys(afterMissingAsset.operations)).toEqual(Object.keys(beforeFailedPatches.operations));

      const patchInput = {
        operationId: 'replace-nested',
        patch: {
          kind: 'replaceInstruction',
          target: target.objectRef,
          expectedFingerprint: target.fingerprint,
          instruction: {
            kind: 'instruction',
            name: 'bg',
            args: ['new_nested'],
          },
        },
      };
      const patched = await call(connectedSession.client, 'scene.patch', patchInput);
      expect(patched.raw.isError).not.toBe(true);
      expect(patched.body.ok).toBe(true);
      expect(patched.body.result).toEqual({ path: fixture.nestedScenePath, line: 2, kind: 'replaceInstruction' });
      expect(fs.readFileSync(sourcePath, 'utf8')).toBe(sourceBefore);

      const validated = await call(connectedSession.client, 'project.validate');
      expect(validated.body.ok).toBe(true);
      expect(validated.body.result.ok).toBe(true);
      expect(validated.body.result.issues.filter((issue: Record<string, unknown>) => issue['severity'] === 'error')).toEqual([]);
      expect((await call(connectedSession.client, 'project.simulate', { sceneId: 'start', seed: 0 })).body.result.status).toBe('passed');
      expect((await call(connectedSession.client, 'runtime.run-from', { sceneId: 'start', choices: [], seed: 0 })).body.result.status).toBe('passed');
      expect((await call(connectedSession.client, 'change.diff')).body.ok).toBe(true);

      const capsule = await call(connectedSession.client, 'surdet_delivery_capsule', { label: 'Wave15 nested replacement' });
      expect(capsule.raw.isError).not.toBe(true);
      expect(capsule.body.ok).toBe(true);
      expect(capsule.body.result.composition.eligibility).toBe('ready');
      const manifest = capsule.body.result.composition.manifest as {
        operations: Array<Record<string, any>>;
      };
      const operation = manifest.operations.find((item) => item['sourceOperationId'] === patchInput.operationId);
      expect(operation).toBeDefined();
      expect(operation?.['normalizedInput']).toEqual(patchInput);
      expect(operation?.['requiredObjects']).toContainEqual(expect.objectContaining({ objectRef: 'asset:bg:new_nested', source: 'base' }));
      expect(operation?.['producedObjects']).toContainEqual(expect.objectContaining({ objectRef: 'scene:x', disposition: 'update' }));

      const artifactPath = capsule.body.result.artifactIdentity.path as string;
      const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as {
        composition: { manifest: { operations: Array<Record<string, any>> } };
      };
      const artifactOperation = artifact.composition.manifest.operations.find((item) => item['sourceOperationId'] === patchInput.operationId);
      expect(artifactOperation?.['normalizedInput']).toEqual(patchInput);
      expect(artifactOperation?.['requiredObjects']).toContainEqual(expect.objectContaining({ objectRef: 'asset:bg:new_nested', source: 'base' }));

      const opened = await NodeChangeStore.openByChangeId(connectedSession.session.activeChangeId!, fixture.data);
      expect(opened).not.toBeNull();
      expect(opened!.record.workingRevision).toBe(beforeFailedPatches.workingRevision + 1);
      expect(Object.keys(opened!.record.operations)).toEqual([patchInput.operationId]);
      const working = opened!.record.workingFiles[fixture.nestedScenePath]!;
      expect(bgLines(working)).toEqual(['@bg new_nested']);
      expect(working).not.toContain('@bg old_nested');
      expect(bgLines(working)).toHaveLength(1);
    } finally {
      await closeConnected(connectedSession);
    }
    expect(fs.readFileSync(sourcePath, 'utf8')).toBe(sourceBefore);
  });

  it('merges independent root and nested scene candidates, resumes the same integration, and leaves project files untouched', { timeout: 30_000 }, async () => {
    const fixture = makeProject('merge-resume');
    const baseline = treeSnapshot(fixture.root);
    const first = await sealCandidate(fixture, 'start', 'start', '@bg old_start', 'new_start');
    const second = await sealCandidate(fixture, 'nested', 'x', '@bg old_nested', 'new_nested');
    const refs = [first.ref, second.ref];
    const service = await compositionServiceForProject(fixture.root, fixture.data);
    const compared = await service.compare(refs);
    expect(compared.comparison.status).toBe('composable');
    expect(compared.comparison.conflicts.filter((conflict) => conflict.severity === 'selection-required')).toEqual([]);
    const sceneUnits = compared.comparison.units.filter((unit) => unit.primaryObject === 'scene:start' || unit.primaryObject === 'scene:x');
    expect(sceneUnits.map((unit) => unit.primaryObject).sort()).toEqual(['scene:start', 'scene:x']);

    const planned = await service.plan({
      candidateRefs: refs,
      comparisonFingerprint: compared.comparison.comparisonFingerprint,
      selectedUnitIds: sceneUnits.map((unit) => unit.unitId),
      conflictResolutions: [],
    });
    expect(planned.plan.dryRun.status, JSON.stringify(planned.plan.dryRun)).toBe('passed');
    expect(planned.plan.replayOperations).toHaveLength(2);

    const storage = await NodeProjectStorage.open(fixture.root);
    const nodeStore = await NodeChangeStore.forProject(storage.rootIdentity, fixture.data);
    const executeOperationId = 'wave15-interrupted-resume';
    const seeded = await beginChange(await service.currentSnapshot(), nodeStore, storage, undefined, {
      integration: {
        planId: planned.plan.planId,
        planFingerprint: planned.plan.planFingerprint,
        executeOperationId,
        sourceCapsules: planned.plan.sourceCapsules,
        includedUnitIds: planned.plan.selectedUnitIds,
        deduplicatedUnits: planned.plan.deduplicatedUnits,
        conflictResolutions: [],
        status: 'REPLAYING',
        nextOperationIndex: 0,
        replayedOperations: [],
      },
    });
    const firstReplay = planned.plan.replayOperations[0]!;
    // Simulate the boundary after the first replay mutation is durable but its
    // integration progress receipt has not been persisted yet; no process kill is claimed here.
    await NodeChangeStore.withChangeLease(seeded.record.changeId, async (leased) => {
      const record = await leased.read(seeded.record.changeId);
      if (record === null) throw new Error(`seeded integration missing: ${seeded.record.changeId}`);
      const replaySession = new ChangeSession(record, leased, storage);
      await replayCompositionOperation(replaySession, firstReplay, realHasher);
    }, new NodeLocalLeaseManager(fixture.data));

    const resumed = await service.executePlan({
      planId: planned.plan.planId,
      artifactSha256: planned.identity.sha256,
      executeOperationId,
    });
    expect(resumed).toMatchObject({
      status: 'READY',
      changeId: seeded.record.changeId,
      nextOperationIndex: planned.plan.replayOperations.length,
    });
    const resumedRecord = (await NodeChangeStore.openByChangeId(seeded.record.changeId, fixture.data))!.record;
    expect(resumedRecord.integration).toMatchObject({
      status: 'READY',
      executeOperationId,
      nextOperationIndex: planned.plan.replayOperations.length,
    });
    expect(resumedRecord.integration!.replayedOperations).toHaveLength(2);
    expect(bgLines(resumedRecord.workingFiles[fixture.rootScenePath]!)).toEqual(['@bg new_start']);
    expect(bgLines(resumedRecord.workingFiles[fixture.nestedScenePath]!)).toEqual(['@bg new_nested']);

    const repeated = await service.executePlan({
      planId: planned.plan.planId,
      artifactSha256: planned.identity.sha256,
      executeOperationId,
    });
    expect(repeated).toMatchObject({ status: 'READY', changeId: seeded.record.changeId, workingRevision: resumed.workingRevision });
    expect(treeSnapshot(fixture.root)).toEqual(baseline);
  });

  it.each(['stage', 'apply'] as const)('edits complete choice and nested condition structures through public MCP in a %s change', { timeout: 30_000 }, async (policy) => {
    const fixture = makeProject(`structure-${policy}`);
    const source = [
      '@scene start',
      '@choice',
      '  First [if:trust > 0] -> @set trust = 1 @goto first',
      '// keep choice separator',
      '',
      '  Second -> @jump second',
      '  Third -> @goto third',
      '@if outer',
      '// keep outer comment',
      '@if inner',
      'Nested yes',
      '@else',
      'Nested no',
      '@endif',
      '@elif fallback',
      'Fallback',
      '@else',
      '// keep outer else',
      'Default',
      '@endif',
      '@label first',
      '@label second',
      '@label third',
      '@end',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(fixture.root, fixture.rootScenePath), source, 'utf8');
    fs.writeFileSync(path.join(fixture.root, 'content', 'scenario', 'second.gal'), '@scene second\n@end\n', 'utf8');
    fs.writeFileSync(path.join(fixture.root, 'game.config.json'), JSON.stringify({
      entryScene: 'start',
      variables: {
        trust: { type: 'number', initial: 0 },
        outer: { type: 'boolean', initial: true },
        inner: { type: 'boolean', initial: true },
        fallback: { type: 'boolean', initial: false },
      },
    }), 'utf8');
    const connection = await connected(fixture, policy);
    try {
      expect((await call(connection.client, 'change.begin')).body.ok).toBe(true);
      const initialChoice = await findMcpStructureTarget(connection.client, 'start', 'choice');
      expect(initialChoice.structure.options).toHaveLength(3);
      expect(initialChoice.structure.options.map((option: Record<string, any>) => [option.label, option.when]))
        .toEqual([['First', 'trust > 0'], ['Second', null], ['Third', null]]);
      const initialCondition = await findMcpStructureTarget(connection.client, 'start', 'condition');
      expect(initialCondition.structure.branches.map((branch: Record<string, any>) => branch.kind))
        .toEqual(['if', 'elif', 'else']);
      const initialIfBranch = await inspectMcpObject(connection.client, initialCondition.structure.branches[0].objectRef);
      const nestedConditionRef = (initialIfBranch.childRefs ?? []).find((ref) => ref.includes('/condition:'));
      expect(nestedConditionRef).toBeDefined();
      await inspectMcpObject(connection.client, nestedConditionRef!);

      const choicePatch = {
        operationId: 'replace-choice-group-public',
        patch: {
          kind: 'replaceChoiceGroup',
          target: initialChoice.objectRef,
          expectedFingerprint: initialChoice.fingerprint,
          choice: {
            kind: 'choice',
            options: [
              { label: '左侧', when: 'trust > 0', effects: [{ name: 'set', args: ['trust', '=', '1'] }], target: { kind: 'goto', value: 'first' } },
              { label: '中间', effects: [{ name: 'mod', args: ['trust', '+1'] }], target: { kind: 'jump', value: 'second' } },
              { label: '右侧', target: { kind: 'goto', value: 'third' } },
            ],
          },
        },
      };
      const choiceResult = await call(connection.client, 'scene.patch', choicePatch);
      expect(choiceResult.body).toMatchObject({ ok: true, result: { kind: 'replaceChoiceGroup', line: 2 } });
      const afterChoice = (await NodeChangeStore.openByChangeId(connection.session.activeChangeId!, fixture.data))!.record;
      expect(afterChoice.workingFiles[fixture.rootScenePath]).toContain('// keep choice separator');
      expect(afterChoice.workingFiles[fixture.rootScenePath]).toContain('左侧 [if:trust > 0] -> @set trust = 1 @goto first');
      expect(afterChoice.workingFiles[fixture.rootScenePath]).toContain('中间 -> @mod trust +1 @jump second');

      // The old full structure ref is rejected before runOperation and leaves
      // the durable record untouched.
      const staleCondition = await call(connection.client, 'scene.patch', {
        operationId: 'stale-condition-target-public',
        patch: {
          kind: 'replaceConditionBlock',
          target: initialCondition.objectRef,
          expectedFingerprint: initialCondition.fingerprint,
          condition: { kind: 'condition', branches: [{ kind: 'if', expr: 'outer', blocks: [] }] },
        },
      });
      expect(staleCondition.body).toMatchObject({ ok: false, error: { code: 'OBJECT_PRECONDITION_FAILED' } });
      expect((await NodeChangeStore.openByChangeId(connection.session.activeChangeId!, fixture.data))!.record).toEqual(afterChoice);

      const currentCondition = await findMcpStructureTarget(connection.client, 'start', 'condition');
      const currentIf = await inspectMcpObject(connection.client, currentCondition.structure.branches[0].objectRef);
      const currentNestedRef = (currentIf.childRefs ?? []).find((ref) => ref.includes('/condition:'));
      expect(currentNestedRef).toBeDefined();
      const currentNested = await inspectMcpObject(connection.client, currentNestedRef!);
      const currentNestedBranchRef = (currentNested.details as { structure: { branches: Array<{ objectRef: string }> } }).structure.branches[0]!.objectRef;

      // A branch from a nested condition is a real object, but is not a
      // direct child of the outer target and must be rejected publicly.
      const foreignBranch = await call(connection.client, 'scene.patch', {
        operationId: 'foreign-condition-branch-public',
        patch: {
          kind: 'replaceConditionBlock',
          target: currentCondition.objectRef,
          expectedFingerprint: currentCondition.fingerprint,
          condition: { kind: 'condition', branches: [{ kind: 'if', expr: 'outer', sourceBranch: currentNestedBranchRef }] },
        },
      });
      expect(foreignBranch.body).toMatchObject({ ok: false, error: { code: 'OBJECT_PRECONDITION_FAILED' } });
      const beforeCondition = (await NodeChangeStore.openByChangeId(connection.session.activeChangeId!, fixture.data))!.record;
      expect(beforeCondition).toEqual(afterChoice);

      const conditionPatch = {
        operationId: 'replace-condition-block-public',
        patch: {
          kind: 'replaceConditionBlock',
          target: currentCondition.objectRef,
          expectedFingerprint: currentCondition.fingerprint,
          condition: {
            kind: 'condition',
            branches: [
              { kind: 'if', expr: 'outer', sourceBranch: currentCondition.structure.branches[0].objectRef },
              { kind: 'elif', expr: 'fallback', sourceBranch: currentCondition.structure.branches[1].objectRef, blocks: [{ kind: 'condition', branches: [
                { kind: 'if', expr: 'inner', blocks: [{ kind: 'text', value: '新增嵌套分支' }] },
                { kind: 'else', blocks: [{ kind: 'text', value: '新增嵌套兜底' }] },
              ] }] },
              { kind: 'else', sourceBranch: currentCondition.structure.branches[2].objectRef },
            ],
          },
        },
      };
      const conditionResult = await call(connection.client, 'scene.patch', conditionPatch);
      expect(conditionResult.body).toMatchObject({ ok: true, result: { kind: 'replaceConditionBlock', line: 8 } });
      const afterCondition = (await NodeChangeStore.openByChangeId(connection.session.activeChangeId!, fixture.data))!.record;
      const working = afterCondition.workingFiles[fixture.rootScenePath]!;
      expect(working).toContain('// keep outer comment');
      expect(working).toContain('// keep outer else');
      expect(working).toContain('@elif fallback\n@if inner\n  新增嵌套分支\n@else\n  新增嵌套兜底\n@endif');
      expect(working).not.toContain('\nFallback\n');

      const retried = await call(connection.client, 'scene.patch', conditionPatch);
      expect(retried.body).toEqual(conditionResult.body);
      expect((await NodeChangeStore.openByChangeId(connection.session.activeChangeId!, fixture.data))!.record).toEqual(afterCondition);
      const conflict = await call(connection.client, 'scene.patch', {
        ...conditionPatch,
        patch: {
          ...conditionPatch.patch,
          condition: {
            ...conditionPatch.patch.condition,
            branches: [{ ...conditionPatch.patch.condition.branches[0], expr: 'outerChanged' }],
          },
        },
      });
      expect(conflict.body).toMatchObject({ ok: false, error: { code: 'OPERATION_ID_CONFLICT' } });
      expect((await NodeChangeStore.openByChangeId(connection.session.activeChangeId!, fixture.data))!.record).toEqual(afterCondition);
      expect(fs.readFileSync(path.join(fixture.root, fixture.rootScenePath), 'utf8')).toBe(source);
    } finally {
      await closeConnected(connection);
    }
  });

  it.each(['stage', 'apply'] as const)('rejects an old instruction reference after lines move in a %s change, preserving retries', { timeout: 30_000 }, async (policy) => {
    const fixture = makeProject(`stale-reference-${policy}`);
    const sourcePath = path.join(fixture.root, fixture.rootScenePath);
    const source = '@scene start\n@bg old_start\n@wait 10\n@bg old_start\n@end\n';
    fs.writeFileSync(sourcePath, source, 'utf8');
    const connection = await connected(fixture, policy);
    try {
      expect((await call(connection.client, 'change.begin')).body.ok).toBe(true);
      const instructionAtLine = async (line: number): Promise<InstructionTarget> => {
        const scene = await call(connection.client, 'object.inspect', { objectRef: 'scene:start' });
        expect(scene.body.ok).toBe(true);
        for (const childRef of (scene.body.result as AuthoringObject).childRefs ?? []) {
          const inspected = await call(connection.client, 'object.inspect', { objectRef: childRef });
          expect(inspected.body.ok).toBe(true);
          const object = inspected.body.result as AuthoringObject;
          if (object.kind === 'instruction' && object.source?.line === line && typeof object.fingerprint === 'string') {
            return { objectRef: object.objectRef, fingerprint: object.fingerprint, source: object.source };
          }
        }
        throw new Error(`instruction at line ${line} not found`);
      };
      // Capture the second identical background through the public index.
      const originalTarget = await instructionAtLine(4);
      const anchor = await instructionAtLine(1);
      expect((await call(connection.client, 'scene.patch', {
        operationId: 'insert-leading-waits',
        patch: { kind: 'insertAfter', anchor: anchor.objectRef, expectedFingerprint: anchor.fingerprint,
          blocks: [
            { kind: 'instruction', name: 'wait', args: ['1'] },
            { kind: 'instruction', name: 'wait', args: ['2'] },
          ],
        },
      })).body.ok).toBe(true);
      const changeId = connection.session.activeChangeId!;
      const before = (await NodeChangeStore.openByChangeId(changeId, fixture.data))!.record;
      const shiftedLines = before.workingFiles[fixture.rootScenePath]!.split('\n');
      expect(shiftedLines[3]).toBe('@bg old_start');
      expect(shiftedLines[5]).toBe('@bg old_start');
      const request = { operationId: 'replace-second-background', patch: {
        kind: 'replaceInstruction', target: originalTarget.objectRef, expectedFingerprint: originalTarget.fingerprint,
        instruction: { kind: 'instruction', name: 'bg', args: ['new_start'] },
      } };
      const rejected = await call(connection.client, 'scene.patch', request);
      expect(rejected.raw.isError).toBe(true);
      expect(rejected.body).toMatchObject({ ok: false, error: { code: 'OBJECT_PRECONDITION_FAILED' } });
      expect((await NodeChangeStore.openByChangeId(changeId, fixture.data))!.record).toEqual(before);
      expect(fs.readFileSync(sourcePath, 'utf8')).toBe(source);

      // Refresh the moved original. A rejected operation may be retried with
      // corrected input, while an already successful operation remains idempotent.
      const fresh = await instructionAtLine(6);
      expect(fresh.objectRef).not.toBe(originalTarget.objectRef);
      const corrected = { ...request, patch: { ...request.patch, target: fresh.objectRef, expectedFingerprint: fresh.fingerprint } };
      const accepted = await call(connection.client, 'scene.patch', corrected);
      expect(accepted.body).toMatchObject({ ok: true, result: { path: fixture.rootScenePath, line: 6, kind: 'replaceInstruction' } });
      const after = (await NodeChangeStore.openByChangeId(changeId, fixture.data))!.record;
      expect(after.workingFiles[fixture.rootScenePath]).toBe(
        '@scene start\n@wait 1\n@wait 2\n@bg old_start\n@wait 10\n@bg new_start\n@end\n',
      );
      const retried = await call(connection.client, 'scene.patch', corrected);
      expect(retried.body.ok).toBe(true);
      expect(retried.body.result).toEqual(accepted.body.result);
      expect((await NodeChangeStore.openByChangeId(changeId, fixture.data))!.record).toEqual(after);
      const conflict = await call(connection.client, 'scene.patch', { ...corrected, patch: {
        ...corrected.patch, instruction: { kind: 'instruction', name: 'bg', args: ['new_left'] },
      } });
      expect(conflict.body).toMatchObject({ ok: false, error: { code: 'OPERATION_ID_CONFLICT' } });
      expect((await NodeChangeStore.openByChangeId(changeId, fixture.data))!.record).toEqual(after);
      expect(fs.readFileSync(sourcePath, 'utf8')).toBe(source);
    } finally {
      await closeConnected(connection);
    }
  });

  it('requires an explicit resolution for two candidates competing on the same scene instruction', { timeout: 30_000 }, async () => {
    const fixture = makeProject('conflict');
    const first = await sealCandidate(fixture, 'left', 'start', '@bg old_start', 'new_left');
    const second = await sealCandidate(fixture, 'right', 'start', '@bg old_start', 'new_right');
    const refs = [first.ref, second.ref];
    const service = await compositionServiceForProject(fixture.root, fixture.data);
    const compared = await service.compare(refs);
    const conflicts = compared.comparison.conflicts.filter((conflict) => conflict.severity === 'selection-required');
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.every((conflict) => conflict.objectRefs.includes('scene:start'))).toBe(true);
    await expect(service.plan({
      candidateRefs: refs,
      comparisonFingerprint: compared.comparison.comparisonFingerprint,
      selectedUnitIds: compared.comparison.units.map((unit) => unit.unitId),
      conflictResolutions: [],
    })).rejects.toMatchObject({ code: 'COMPOSITION_CONFLICT_UNRESOLVED' });

    const chosen = compared.comparison.units.find((unit) => (
      unit.candidateId === `cand-${first.ref.changeId}` && unit.primaryObject === 'scene:start'
    ));
    expect(chosen).toBeDefined();
    const resolved = await service.plan({
      candidateRefs: refs,
      comparisonFingerprint: compared.comparison.comparisonFingerprint,
      selectedUnitIds: chosen === undefined ? [] : [chosen.unitId],
      conflictResolutions: conflicts.map((conflict) => ({
        conflictId: conflict.conflictId,
        resolution: 'choose-unit' as const,
        actor: 'human' as const,
        chosenUnitId: chosen?.unitId,
      })),
    });
    expect(resolved.plan.dryRun.status, JSON.stringify(resolved.plan.dryRun)).toBe('passed');
  });
});
