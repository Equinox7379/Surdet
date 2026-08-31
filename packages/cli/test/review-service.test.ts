import { afterEach, describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  approvalFingerprintOf,
  stableStringify,
  type CandidateCapsuleRef,
  type ChangeRecord,
  type CompositionComparison,
  type CompositionManifest,
  type FinalApprovalReceipt,
  type IntegrationPlan,
  type ReturnRequestReceipt,
  type ReviewApprovalRef,
  type TextHasher,
  type VerifiedCompositionCandidate,
} from '@surdet/authoring';
import { compositionServiceForProject } from '../src/authoring/composition-service.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { NodeReviewStore } from '../src/authoring/node-review-store.js';
import { hashProjectTree, parseReviewProjection, ReviewService } from '../src/authoring/review-service.js';

const temporaryRoots: string[] = [];
const hasher: TextHasher = {
  sha256: async (text) => text,
};

const realHasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function directoryNames(directory: string): Promise<string[]> {
  return fsp.readdir(directory, { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((left, right) => left.localeCompare(right)))
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
}

async function activeLockDirectories(dataRoot: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      if (entry.name.endsWith('.lock')) found.push(child);
      else await visit(child);
    }
  };
  await visit(path.join(dataRoot, '.locks'));
  return found.sort((left, right) => left.localeCompare(right));
}

function comparison(projectIdentity: string, revision: string): CompositionComparison {
  return {
    comparisonVersion: '1.0.0',
    projectIdentity,
    expectedProjectRevision: revision,
    status: 'composable',
    candidates: [],
    units: [],
    dependencyEdges: [],
    conflicts: [],
    identicalGroups: [],
    evidenceMatrix: [],
    comparisonFingerprint: 'comparison-fingerprint',
  };
}

function reviewCandidate(
  letter: 'A' | 'C',
  text: string,
  finalFingerprint: string,
): VerifiedCompositionCandidate & { manifest: CompositionManifest; acceptanceCriteria: string[] } {
  const ref: CandidateCapsuleRef = {
    changeId: `change-${letter}`,
    capsuleId: `capsule-${letter}`,
    artifactSha256: letter.toLowerCase().repeat(64),
  };
  const manifest: CompositionManifest = {
    manifestVersion: '1.0.0',
    projectIdentity: 'project-identity',
    baseProjectRevision: 'revision-1',
    sourceChangeId: ref.changeId,
    sourceWorkingRevision: 1,
    operations: [{
      sequence: 0,
      capabilityId: 'scene.create',
      sourceOperationId: `op-${letter.toLowerCase()}-alpha`,
      normalizedInput: {
        operationId: `op-${letter.toLowerCase()}-alpha`,
        sceneId: 'wave5_alpha',
        blocks: [{ kind: 'text', speaker: 'lynn', value: text }],
      },
      inputSha256: `input-${letter}`,
      primaryObject: 'scene:wave5_alpha',
      requiredObjects: [],
      producedObjects: [{ objectRef: 'scene:wave5_alpha', disposition: 'create', finalFingerprint }],
    }],
    manifestFingerprint: `manifest-${letter}`,
  };
  return {
    candidateId: `candidate-${letter}`,
    ref,
    capsuleVersion: '2.0.0',
    projectIdentity: 'project-identity',
    baseProjectRevision: 'revision-1',
    sourceWorkingRevision: 1,
    composition: { eligibility: 'ready', reasons: [], manifest },
    evidenceSummary: { validation: 'fresh', simulation: 'fresh', runtime: 'fresh', warnings: 0, manualReviewRequired: [] },
    semanticDiff: [],
    manifest,
    acceptanceCriteria: [],
  };
}

function humanReadableCompareResult() {
  const candidateA = reviewCandidate('A', 'Alpha route A.', 'fingerprint-a');
  const candidateC = reviewCandidate('C', 'Alpha route C.', 'fingerprint-c');
  const unit = (candidate: typeof candidateA, finalFingerprint: string) => ({
    unitId: `unit-${candidate.candidateId}`,
    candidateId: candidate.candidateId,
    primaryObject: 'scene:wave5_alpha',
    operationSequences: [0],
    finalFingerprint,
    requiredUnitIds: [],
    requiredBaseObjects: [],
    producedObjects: [{ objectRef: 'scene:wave5_alpha', disposition: 'create' as const, finalFingerprint }],
    potentialImpact: [],
    observedImpact: [],
    evidenceSummary: candidate.evidenceSummary,
  });
  const units = [unit(candidateA, 'fingerprint-a'), unit(candidateC, 'fingerprint-c')];
  const comparison: CompositionComparison = {
    comparisonVersion: '1.0.0',
    projectIdentity: 'project-identity',
    expectedProjectRevision: 'revision-1',
    status: 'review-only',
    candidates: [candidateC.ref, candidateA.ref],
    units: [...units].reverse(),
    dependencyEdges: [],
    conflicts: [{
      conflictId: 'conflict-alpha',
      severity: 'selection-required',
      code: 'OBJECT_RESULTS_DIVERGE',
      candidateIds: [candidateC.candidateId, candidateA.candidateId],
      unitIds: units.map((entry) => entry.unitId),
      objectRefs: ['scene:wave5_alpha'],
      allowedResolutions: ['choose-unit', 'exclude-all'],
      details: {},
      repairActions: ['choose one result'],
    }],
    identicalGroups: [],
    evidenceMatrix: [candidateC, candidateA].map((candidate) => ({
      candidateId: candidate.candidateId,
      summary: candidate.evidenceSummary,
    })),
    comparisonFingerprint: 'comparison-fingerprint-human-readable',
  };
  return { comparison, candidates: [candidateC, candidateA], currentProjectRevision: 'revision-1' };
}

async function setup(): Promise<{ root: string; projectRoot: string; projectDirectory: string; service: ReviewService }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'surdet-review-service-'));
  temporaryRoots.push(root);
  const projectRoot = path.join(root, 'project');
  const dataRoot = path.join(root, 'data');
  await fsp.mkdir(projectRoot);
  await fsp.mkdir(path.join(projectRoot, 'content', 'scenario'), { recursive: true });
  await fsp.writeFile(path.join(projectRoot, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  const projectIdentity = 'project-identity';
  const projectDirectory = path.join(dataRoot, projectIdentity);
  await fsp.mkdir(projectDirectory, { recursive: true });
  const reviews = new NodeReviewStore(projectDirectory, projectIdentity);
  const composition = {
    projectRoot,
    projectIdentity,
    compare: async () => ({ comparison: comparison(projectIdentity, 'revision-1'), candidates: [], currentProjectRevision: 'revision-1' }),
  } as never;
  return { root, projectRoot, projectDirectory, service: new ReviewService(reviews, composition, hasher) };
}

async function setupResultFixture(options: {
  leaseManagerFactory?: (dataRoot: string) => NodeLocalLeaseManager;
} = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'surdet-review-result-'));
  temporaryRoots.push(root);
  const projectRoot = path.join(root, 'project');
  const dataRoot = path.join(root, 'data');
  await fsp.mkdir(path.join(projectRoot, 'content', 'scenario'), { recursive: true });
  await fsp.writeFile(path.join(projectRoot, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  await fsp.writeFile(path.join(projectRoot, 'content', 'scenario', 'remove.gal'), '@scene remove\n@end\n', 'utf8');
  process.env['SURDET_AGENT_DATA_DIR'] = dataRoot;

  const composition = await compositionServiceForProject(projectRoot);
  const storage = await NodeProjectStorage.open(projectRoot);
  const snapshot = await composition.currentSnapshot();
  const baseContents = Object.fromEntries(snapshot.files.map((file) => [file.path, file.text]));
  const baseFiles = Object.fromEntries(snapshot.files.map((file) => [file.path, { sha256: file.sha256 }]));
  const workingFiles = { ...baseContents };
  delete workingFiles['content/scenario/remove.gal'];
  workingFiles['content/scenario/wave6_alpha.gal'] = '@scene wave6_alpha\n凛：结果。\n@end\n';
  const binding = {
    reviewState: 'human-reviewed' as const,
    reviewId: 'decision-review',
    decisionId: 'decision-result',
    decisionFingerprint: 'decision-fingerprint',
  };
  const sourceA = { changeId: 'change-a', capsuleId: 'capsule-a', artifactSha256: 'a'.repeat(64) };
  const sourceD = { changeId: 'change-d', capsuleId: 'capsule-d', artifactSha256: 'd'.repeat(64) };
  const plan: IntegrationPlan = {
    planVersion: '1.0.0',
    planId: 'plan_result',
    projectIdentity: composition.projectIdentity,
    expectedProjectRevision: snapshot.revision,
    comparisonFingerprint: 'comparison-fingerprint',
    review: binding,
    sourceCapsules: [sourceD, sourceA],
    selectedUnitIds: ['unit-a-alpha', 'unit-b-beta'],
    implicitInclusions: ['unit-b-timeline'],
    excludedUnitIds: ['unit-c-alpha'],
    conflictResolutions: [],
    deduplicatedUnits: [{ groupId: 'group-alpha', retainedUnitId: 'unit-a-alpha', provenanceUnitIds: ['unit-a-alpha', 'unit-d-alpha'] }],
    replayOperations: [],
    provenance: [
      { targetObject: 'scene:wave6_alpha', sourceCapsule: sourceA, sourceUnitId: 'unit-a-alpha', sourceOperationIds: ['source-a'] },
      { targetObject: 'scene:wave6_alpha', sourceCapsule: sourceD, sourceUnitId: 'unit-d-alpha', sourceOperationIds: ['source-d'] },
    ],
    dryRun: { status: 'passed', finalObjectFingerprints: { 'scene:wave6_alpha': 'final-alpha', 'timeline:wave6_beta_opening': 'final-beta-timeline' }, errors: [] },
    planFingerprint: 'plan-fingerprint',
  };
  const planIdentity = await composition.store.writePlan(plan);
  const changeId = 'change_result';
  const record: ChangeRecord = {
    changeId,
    formatVersion: 2,
    recordVersion: 0,
    projectRootIdentity: storage.rootIdentity,
    baseRevision: snapshot.revision,
    workingRevision: 1,
    status: 'OPEN',
    baseFiles,
    baseContents,
    workingFiles,
    operations: {},
    integration: {
      planId: plan.planId,
      planFingerprint: plan.planFingerprint,
      executeOperationId: 'execute-result',
      sourceCapsules: [sourceA, sourceD],
      includedUnitIds: ['unit-a-alpha', 'unit-b-beta', 'unit-b-timeline'],
      deduplicatedUnits: [{ groupId: 'group-alpha', retainedUnitId: 'unit-a-alpha', provenanceUnitIds: ['unit-a-alpha', 'unit-d-alpha'] }],
      conflictResolutions: [],
      status: 'READY',
      nextOperationIndex: 0,
      replayedOperations: [],
      review: { binding },
    },
    latestDiff: { workingRevision: 1, evidenceId: 'diff-evidence' },
    latestValidation: { workingRevision: 1, evidenceId: 'validation-evidence', errors: 0 },
    latestSimulation: { workingRevision: 1, evidenceId: 'simulation-evidence', status: 'passed' },
    runtimeTraces: [{ traceId: 'runtime-trace', workingRevision: 1, status: 'passed' }],
  };
  const changeStore = await NodeChangeStore.forProject(storage.rootIdentity);
  await changeStore.create(record);
  await NodeChangeStore.withChangeLeaseForProject(changeId, storage.rootIdentity, async (leased) => {
    await leased.writeDiff(changeId, {
      summary: { createdScenes: 1, modifiedScenes: 0, changedVariables: 0, warnings: [] },
      semantic: [],
      files: [{ path: 'content/scenario/wave6_alpha.gal', unifiedDiff: '+Alpha route A.', unexpectedFormatChange: false }],
    });
    await leased.writeTrace(changeId, 'runtime-trace', {
      schemaVersion: 1,
      traceId: 'runtime-trace',
      changeId,
      projectRevision: snapshot.revision,
      createdAt: '2026-08-27T00:00:00.000Z',
      seed: 906,
      events: [{
        kind: 'text',
        source: { sceneId: 'wave6_alpha', index: 0, op: 'text', file: 'content/scenario/wave6_alpha.gal', line: 2, col: 1 },
      }],
    });
  });

  const reviews = new NodeReviewStore(composition.store.projectDirectory, composition.projectIdentity);
  const leases = options.leaseManagerFactory?.(dataRoot) ?? new NodeLocalLeaseManager(dataRoot);
  const service = new ReviewService(reviews, composition, realHasher, leases);
  const originalBefore = await hashProjectTree(projectRoot);
  return {
    root,
    projectRoot,
    dataRoot,
    composition,
    storage,
    snapshot,
    workingFiles,
    plan,
    planIdentity,
    changeId,
    changeStore,
    reviews,
    leases,
    service,
    originalBefore,
  };
}

async function prepareResultReview() {
  const fixture = await setupResultFixture();
  const prepared = await fixture.service.prepareResult({
    planId: fixture.plan.planId,
    artifactSha256: fixture.planIdentity.sha256,
    changeId: fixture.changeId,
  });
  return { ...fixture, prepared };
}

async function approvalForPreparedResult(
  prepared: Awaited<ReturnType<typeof prepareResultReview>>['prepared'],
  approvalId: string,
): Promise<FinalApprovalReceipt> {
  const finalResult = prepared.projection.finalResult!;
  const unsigned: Omit<FinalApprovalReceipt, 'approvalFingerprint'> = {
    receiptVersion: '1.0.0',
    approvalId,
    resultReviewId: prepared.reviewId,
    decisionFingerprint: prepared.projection.sourceIdentity.decisionFingerprint!,
    planId: finalResult.planId,
    planFingerprint: finalResult.planFingerprint,
    integrationChangeId: finalResult.integrationChangeId,
    workingRevision: finalResult.workingRevision,
    projectIdentity: prepared.projection.projectIdentity,
    expectedProjectRevision: prepared.projection.expectedProjectRevision,
    diffFingerprint: finalResult.diffFingerprint,
    evidence: finalResult.evidence,
    resultTreeSha256: finalResult.resultTreeSha256,
    reviewerChannel: 'surdet-editor-local',
    approvedAt: '2026-08-30T00:00:00.000Z',
  };
  return {
    ...unsigned,
    approvalFingerprint: await approvalFingerprintOf(unsigned, realHasher),
  };
}

async function returnForPreparedResult(
  prepared: Awaited<ReturnType<typeof prepareResultReview>>['prepared'],
  reasonCategory: ReturnRequestReceipt['reasonCategory'],
): Promise<ReturnRequestReceipt> {
  const finalResult = prepared.projection.finalResult!;
  const unsigned: Omit<ReturnRequestReceipt, 'returnFingerprint'> = {
    receiptVersion: '1.0.0',
    returnId: 'return-result',
    resultReviewId: prepared.reviewId,
    planId: finalResult.planId,
    planFingerprint: finalResult.planFingerprint,
    integrationChangeId: finalResult.integrationChangeId,
    workingRevision: finalResult.workingRevision,
    reasonCategory,
    reviewerChannel: 'surdet-editor-local',
    returnedAt: '2026-08-30T00:00:00.000Z',
  };
  return {
    ...unsigned,
    returnFingerprint: await realHasher.sha256(stableStringify(unsigned)),
  };
}

afterEach(() => {
  delete process.env['SURDET_AGENT_DATA_DIR'];
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('ReviewService', () => {
  it('exports the canonical review projection parser for the local authority', () => {
    const value = {
      reviewVersion: '1.0.0',
      reviewId: 'review-parser',
      kind: 'comparison',
      projectIdentity: 'project-identity',
      expectedProjectRevision: 'revision-1',
      sourceIdentity: {},
    };
    expect(parseReviewProjection(value, 'review-parser')).toBe(value);
    expect(() => parseReviewProjection({ ...value, reviewId: 'other' }, 'review-parser'))
      .toThrowError(/身份无效/);
  });
  it('creates a comparison workspace from a fresh comparison and keeps decision writes human-gated', async () => {
    const fixture = await setup();
    const prepared = await fixture.service.prepareComparison({ candidateRefs: [] });
    expect(prepared.projection.kind).toBe('comparison');
    expect(prepared.projection.projectIdentity).toBe('project-identity');
    expect(await fsp.readFile(path.join(fixture.projectDirectory, 'reviews', prepared.reviewId, 'comparison', 'review.json'), 'utf8'))
      .toContain('comparison-fingerprint');
    await expect(fixture.service.inspectDecision({ reviewId: prepared.reviewId }))
      .rejects.toMatchObject({ code: 'REVIEW_DECISION_REQUIRED' });
  });

  it('persists shared typed A/C content summaries without dumping normalized inputs', async () => {
    const fixture = await setup();
    const reviews = new NodeReviewStore(fixture.projectDirectory, 'project-identity');
    const composition = {
      projectRoot: fixture.projectRoot,
      projectIdentity: 'project-identity',
      compare: async () => humanReadableCompareResult(),
    } as never;
    const service = new ReviewService(reviews, composition, realHasher);

    const prepared = await service.prepareComparison({
      candidateRefs: humanReadableCompareResult().candidates.map((candidate) => candidate.ref),
    });
    const raw = await fsp.readFile(path.join(
      fixture.projectDirectory,
      'reviews',
      prepared.reviewId,
      'comparison',
      'review.json',
    ), 'utf8');
    const options = prepared.projection.conflicts[0]!.options as unknown as Array<{
      candidateId: string;
      presentation?: { highlights: string[]; completeness: string };
    }>;
    expect(options.find((option) => option.candidateId === 'candidate-A')?.presentation?.highlights.join('\n') ?? '')
      .toContain('Alpha route A.');
    expect(options.find((option) => option.candidateId === 'candidate-C')?.presentation?.highlights.join('\n') ?? '')
      .toContain('Alpha route C.');
    expect(prepared.projection.sourceIdentity.comparisonFingerprint).toBe('comparison-fingerprint-human-readable');
    expect(raw).toContain('Alpha route A.');
    expect(raw).toContain('Alpha route C.');
    expect(raw).not.toContain('normalizedInput');
    expect(raw).not.toContain('op-a-alpha');
    expect(raw).not.toContain(fixture.projectRoot);
    expect(prepared.identity.payload.sha256).toBe(crypto.createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('hex'));
  });

  it('contends with the canonical Authoring project lease before result-review side effects', async () => {
    const fixture = await setupResultFixture();
    const reviewsDirectory = path.join(fixture.composition.store.projectDirectory, 'reviews');
    const reviewsBefore = await directoryNames(reviewsDirectory);
    const recordBefore = await fixture.changeStore.read(fixture.changeId);

    await fixture.leases.withProjectLease(fixture.storage.rootIdentity, async (authoringLease) => {
      expect(path.basename(authoringLease.directory)).toBe(`${fixture.composition.projectIdentity}.lock`);
      await expect(fixture.service.prepareResult({
        planId: fixture.plan.planId,
        artifactSha256: fixture.planIdentity.sha256,
        changeId: fixture.changeId,
      })).rejects.toMatchObject({ code: 'PROJECT_BUSY' });

      expect(await directoryNames(reviewsDirectory)).toEqual(reviewsBefore);
      const recordAfter = await fixture.changeStore.read(fixture.changeId);
      expect(recordAfter?.recordVersion).toBe(recordBefore?.recordVersion);
      expect(recordAfter?.integration?.review?.resultReview).toBeUndefined();
      expect(await hashProjectTree(fixture.projectRoot)).toBe(fixture.originalBefore);
      expect(await activeLockDirectories(fixture.dataRoot)).toEqual([authoringLease.directory]);
    });
    expect(await activeLockDirectories(fixture.dataRoot)).toEqual([]);
  });

  it('orders result locks change then project and returns exactly one result after heartbeat drain', async () => {
    const scheduledCallbacks: Array<() => Promise<void>> = [];
    let leases!: NodeLocalLeaseManager;
    const fixture = await setupResultFixture({
      leaseManagerFactory: (dataRoot) => {
        leases = new NodeLocalLeaseManager(dataRoot, {
          scheduleHeartbeat: (callback) => {
            scheduledCallbacks.push(callback);
            return () => undefined;
          },
        });
        return leases;
      },
    });
    const events: string[] = [];
    const scheduledByScope = new Map<string, () => Promise<void>>();
    const projectReleaseStarted = deferred();
    const originalAcquire = leases.acquire.bind(leases);
    leases.acquire = async (input) => {
      const handle = await originalAcquire(input);
      const callback = scheduledCallbacks.shift();
      if (callback === undefined) throw new Error(`heartbeat callback missing for ${input.scope}`);
      scheduledByScope.set(input.scope, callback);
      events.push(`${input.scope}.acquire`);
      const originalRelease = handle.release.bind(handle);
      handle.release = async (): Promise<void> => {
        if (input.scope === 'project') projectReleaseStarted.resolve();
        await originalRelease();
        events.push(`${input.scope}.release`);
      };
      return handle;
    };

    const heartbeatEntered = deferred();
    const heartbeatMayFinish = deferred();
    const originalAssertOwned = leases.assertOwned.bind(leases);
    leases.assertOwned = async (handle): Promise<void> => {
      await originalAssertOwned(handle);
      if (handle.scope !== 'project') return;
      heartbeatEntered.resolve();
      await heartbeatMayFinish.promise;
    };

    const createReviewEntered = deferred();
    const createReviewMayFinish = deferred();
    let createReviewCalls = 0;
    const originalCreateReview = fixture.reviews.createReview.bind(fixture.reviews);
    fixture.reviews.createReview = async (reviewId, payload) => {
      createReviewCalls += 1;
      createReviewEntered.resolve();
      await createReviewMayFinish.promise;
      return originalCreateReview(reviewId, payload);
    };

    let prepareSettled = false;
    const preparePromise = fixture.service.prepareResult({
      planId: fixture.plan.planId,
      artifactSha256: fixture.planIdentity.sha256,
      changeId: fixture.changeId,
    }).then((prepared) => {
      prepareSettled = true;
      return prepared;
    });
    let heartbeatPromise: Promise<void> | undefined;
    try {
      await createReviewEntered.promise;
      expect(events, 'Review withResultChange acquired locks in the wrong order').toEqual([
        'change.acquire',
        'project.acquire',
      ]);

      const projectHeartbeat = scheduledByScope.get('project');
      if (projectHeartbeat === undefined) throw new Error('project heartbeat callback was not captured');
      heartbeatPromise = projectHeartbeat();
      await heartbeatEntered.promise;
      createReviewMayFinish.resolve();
      await projectReleaseStarted.promise;

      expect(prepareSettled, 'prepareResult returned before the in-flight project heartbeat drained').toBe(false);
      expect(createReviewCalls).toBe(1);
      const reviewIdsDuringDrain = await directoryNames(path.join(fixture.composition.store.projectDirectory, 'reviews'));
      expect(reviewIdsDuringDrain).toHaveLength(1);
      const recordDuringDrain = await fixture.changeStore.read(fixture.changeId);
      const bindingDuringDrain = recordDuringDrain?.integration?.review?.resultReview;
      expect(bindingDuringDrain?.reviewId).toBe(reviewIdsDuringDrain[0]);
      const reviewDuringDrain = await fixture.reviews.readReview(bindingDuringDrain!.reviewId);
      const resultProjectDuringDrain = await fixture.reviews.resultProjectDirectory(bindingDuringDrain!.reviewId);
      expect(await hashProjectTree(resultProjectDuringDrain)).toBe(bindingDuringDrain?.resultTreeSha256);
      expect(await hashProjectTree(fixture.projectRoot)).toBe(fixture.originalBefore);
      expect((await activeLockDirectories(fixture.dataRoot)).map((directory) => path.basename(directory)).sort())
        .toEqual([`${fixture.changeId}.lock`, `${fixture.composition.projectIdentity}.lock`].sort());

      heartbeatMayFinish.resolve();
      await heartbeatPromise;
      const prepared = await preparePromise;
      expect(prepared.reviewId).toBe(bindingDuringDrain?.reviewId);
      expect(prepared.projection.finalResult?.resultTreeSha256).toBe(bindingDuringDrain?.resultTreeSha256);
      expect(createReviewCalls).toBe(1);
      expect(await directoryNames(path.join(fixture.composition.store.projectDirectory, 'reviews'))).toEqual([prepared.reviewId]);
      const recordAfter = await fixture.changeStore.read(fixture.changeId);
      expect(recordAfter?.integration?.review?.resultReview).toEqual(bindingDuringDrain);
      expect((await fixture.reviews.readReview(prepared.reviewId)).identity).toEqual(reviewDuringDrain.identity);
      expect(events).toEqual([
        'change.acquire',
        'project.acquire',
        'project.release',
        'change.release',
      ]);
      expect(await leases.inspect('project', fixture.storage.rootIdentity)).toMatchObject({ state: 'free' });
      expect(await leases.inspect('change', fixture.changeId)).toMatchObject({ state: 'free' });
      expect(await activeLockDirectories(fixture.dataRoot)).toEqual([]);

      await projectHeartbeat();
      expect(await activeLockDirectories(fixture.dataRoot)).toEqual([]);
      expect(await hashProjectTree(fixture.projectRoot)).toBe(fixture.originalBefore);
    } finally {
      createReviewMayFinish.resolve();
      heartbeatMayFinish.resolve();
      if (heartbeatPromise !== undefined) await Promise.allSettled([heartbeatPromise]);
      await Promise.allSettled([preparePromise]);
    }
  });

  it('rejects an approvalRef fingerprint that differs from the verified disk approval', async () => {
    const fixture = await prepareResultReview();
    const approval = await approvalForPreparedResult(fixture.prepared, 'approval-ref-check');
    await fixture.reviews.createFinalApproval(fixture.prepared.reviewId, approval);
    const wrongRef: ReviewApprovalRef = {
      resultReviewId: fixture.prepared.reviewId,
      approvalId: approval.approvalId,
      approvalFingerprint: '0'.repeat(64),
    };

    await expect(fixture.service.inspectApproval(wrongRef))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });

  it('rejects a return receipt whose fingerprint was tampered on disk', async () => {
    const fixture = await prepareResultReview();
    const receipt = await returnForPreparedResult(fixture.prepared, 'content');
    receipt.returnFingerprint = '0'.repeat(64);
    await fixture.reviews.createReturnRequest(fixture.prepared.reviewId, receipt);

    await expect(fixture.service.inspectApproval({ resultReviewId: fixture.prepared.reviewId }))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });

  it('rejects an unknown return reasonCategory even when its fingerprint matches those bytes', async () => {
    const fixture = await prepareResultReview();
    const valid = await returnForPreparedResult(fixture.prepared, 'other');
    const { returnFingerprint: _validFingerprint, ...validUnsigned } = valid;
    const invalidUnsigned = {
      ...validUnsigned,
      reasonCategory: 'unknown-category',
    } as unknown as Omit<ReturnRequestReceipt, 'returnFingerprint'>;
    const invalid = {
      ...invalidUnsigned,
      returnFingerprint: await realHasher.sha256(stableStringify(invalidUnsigned)),
    } as ReturnRequestReceipt;
    await fixture.reviews.createReturnRequest(fixture.prepared.reviewId, invalid);

    await expect(fixture.service.inspectApproval({ resultReviewId: fixture.prepared.reviewId }))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });

  it('materializes the READY working tree without mutating the original project and rechecks approval freshness', async () => {
    const {
      projectRoot,
      workingFiles,
      plan,
      planIdentity,
      changeId,
      reviews,
      service,
      originalBefore,
    } = await setupResultFixture();
    const prepared = await service.prepareResult({
      planId: plan.planId,
      artifactSha256: planIdentity.sha256,
      changeId,
    });
    expect(prepared.projectDirectory).toBeDefined();
    expect(prepared.projection.finalResult?.resultTreeSha256).toBe(await hashProjectTree(prepared.projectDirectory!));
    expect((prepared.projection.finalResult as any).plan).toMatchObject({
      selectedUnitIds: ['unit-a-alpha', 'unit-b-beta'],
      includedUnitIds: ['unit-a-alpha', 'unit-b-beta', 'unit-b-timeline'],
      implicitInclusions: ['unit-b-timeline'],
      excludedUnitIds: ['unit-c-alpha'],
      finalObjectFingerprints: { 'scene:wave6_alpha': 'final-alpha', 'timeline:wave6_beta_opening': 'final-beta-timeline' },
    });
    expect((prepared.projection.finalResult as any).plan.provenance).toHaveLength(2);
    expect((prepared.projection.finalResult as any).diff.files[0].path).toBe('content/scenario/wave6_alpha.gal');
    expect((prepared.projection.finalResult as any).freshness).toEqual({ diff: 'fresh', validation: 'fresh', simulation: 'fresh', runtime: 'fresh' });
    expect((prepared.projection.finalResult as any).runtimeTraceObservations).toEqual([{
      traceId: 'runtime-trace',
      observationKeys: ['text|wave6_alpha|0|text|content/scenario/wave6_alpha.gal|2|1'],
    }]);
    expect(await fsp.readFile(path.join(prepared.projectDirectory!, 'content', 'scenario', 'wave6_alpha.gal'), 'utf8'))
      .toBe(workingFiles['content/scenario/wave6_alpha.gal']);
    await expect(fsp.access(path.join(prepared.projectDirectory!, 'content', 'scenario', 'remove.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await hashProjectTree(projectRoot)).toBe(originalBefore);
    await expect(fsp.access(path.join(projectRoot, 'content', 'scenario', 'remove.gal'))).resolves.toBeUndefined();
    await expect(service.inspectApproval({ resultReviewId: prepared.reviewId }))
      .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_REQUIRED' });

    const finalResult = prepared.projection.finalResult!;
    const unsigned: Omit<FinalApprovalReceipt, 'approvalFingerprint'> = {
      receiptVersion: '1.0.0',
      approvalId: 'approval-result',
      resultReviewId: prepared.reviewId,
      decisionFingerprint: prepared.projection.sourceIdentity.decisionFingerprint!,
      planId: finalResult.planId,
      planFingerprint: finalResult.planFingerprint,
      integrationChangeId: finalResult.integrationChangeId,
      workingRevision: finalResult.workingRevision,
      projectIdentity: prepared.projection.projectIdentity,
      expectedProjectRevision: prepared.projection.expectedProjectRevision,
      diffFingerprint: finalResult.diffFingerprint,
      evidence: finalResult.evidence,
      resultTreeSha256: finalResult.resultTreeSha256,
      reviewerChannel: 'surdet-editor-local',
      approvedAt: '2026-08-27T00:00:00.000Z',
    };
    const approval: FinalApprovalReceipt = {
      ...unsigned,
      approvalFingerprint: await approvalFingerprintOf(unsigned, realHasher),
    };
    await reviews.createFinalApproval(prepared.reviewId, approval);
    const verified = await service.inspectApproval({ resultReviewId: prepared.reviewId, approvalId: approval.approvalId });
    if (!('approvalId' in verified.receipt) || verified.receipt.approvalId !== 'approval-result') {
      throw new Error('inspectApproval did not return the verified approval');
    }
    expect(verified.receipt.approvalId).toBe('approval-result');

    await fsp.writeFile(path.join(prepared.projectDirectory!, 'content', 'scenario', 'wave6_alpha.gal'), 'tampered\n', 'utf8');
    await expect(service.inspectApproval({ resultReviewId: prepared.reviewId }))
      .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_STALE' });
  });
});
