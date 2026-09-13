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
