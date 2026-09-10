import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  AUTHORING_CONTRACT_VERSION,
  DELIVERY_CAPSULE_VERSION,
  AuthoringOperationError,
  avatarAssetRef,
  backgroundAssetRef,
  buildAssetCatalog,
  buildCompositionManifest,
  buildObjectIndex,
  evidenceFreshness,
  inspectTransactionRecovery,
  loadProjectSnapshot,
  portraitAssetRef,
  type AutonomyPolicy,
  type ChangeRecord,
  type EvidenceFreshness,
  type ManifestObjectFact,
  type ManifestObjectFacts,
  type OperationInvocationFact,
  type RecoveryInspection,
} from '@surdet/authoring';
import { NodeChangeStore, type ArtifactIdentity } from '../authoring/node-change-store.js';
import { NodeProjectStorage } from '../authoring/node-project-storage.js';
import { projectIdentityFromRoot } from '../authoring/project-identity.js';
import { ChangeRecordProjectStorage } from '../authoring/working-project-storage.js';
import { loadIntegrationProvenance } from '../authoring/composition-service.js';
import type { AgentPortSession } from './session.js';
import type { InvocationRecord } from './invocation-ledger.js';

export interface DeliveryCapsulePayload {
  capsuleVersion: '2.0.0';
  capsuleId: string;
  generatedAt: string;
  sessionId: string;
  policy: AutonomyPolicy;
  contractVersion: typeof AUTHORING_CONTRACT_VERSION;
  projectIdentity: string;
  baseProjectRevision: string;
  currentProjectRevision: string;
  changeId: string;
  changeStatus: 'OPEN' | 'COMMITTED' | 'ROLLED_BACK' | 'STALE';
  workingRevision?: number;
  intent?: string;
  acceptanceCriteria: string[];
  operations: unknown[];
  invocationSummary: unknown;
  objectDiff: unknown;
  causalImpact: { potentialImpact: unknown[]; observedImpact: unknown[] };
  validation: EvidenceFreshness;
  simulation: EvidenceFreshness;
  runtime: EvidenceFreshness;
  recovery: {
    disposition: RecoveryInspection['disposition'];
    journalStatus?: RecoveryInspection['journalStatus'];
    manualRecoveryRequired: boolean;
    reasons: string[];
  };
  warnings: unknown[];
  manualReviewRequired: unknown[];
  projectMutation: {
    occurred: boolean;
    expectedByPolicy: boolean;
    beforeRevision: string;
    afterRevision: string;
  };
  composition: {
    eligibility: 'ready' | 'unavailable';
    reasons: Array<{ code: string; operationId?: string; message: string }>;
    manifest?: unknown;
  };
  /** Wave 5：仅 integration change 的 capsule 携带；从 sealed plan + record.integration 构造，不从 diff 猜。 */
  integrationProvenance?: {
    planId: string;
    planFingerprint: string;
    executeOperationId: string;
    integrationChangeId: string;
    status: 'REPLAYING' | 'READY' | 'FAILED';
    nextOperationIndex: number;
    operationCount: number;
    sourceCapsules: unknown[];
    includedUnits: string[];
    deduplicatedUnits: unknown[];
    conflictResolutions: unknown[];
    replayReceipts: unknown[];
    failure?: { code: string; message: string; operationIndex: number; integrationOperationId: string };
    planAvailable: boolean;
  };
}

export interface SealedDeliveryCapsule extends DeliveryCapsulePayload {
  artifactIdentity: ArtifactIdentity;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameRootIdentity(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function latestEvidence(values: unknown[], capability: string): Record<string, unknown> | undefined {
  const matches = values.filter((value): value is Record<string, unknown> => isRecord(value) && value['capability'] === capability);
  return matches.at(-1);
}

function evidenceStatus(value: Record<string, unknown> | undefined): 'passed' | 'failed' | 'incomplete' | undefined {
  const status = value?.['status'];
  return status === 'passed' || status === 'failed' || status === 'incomplete' ? status : undefined;
}

function validationFreshness(record: ChangeRecord, values: unknown[]): EvidenceFreshness {
  const evidence = latestEvidence(values, 'project.validate');
  if (evidence !== undefined) {
    const result = isRecord(evidence['result']) ? evidence['result'] : undefined;
    const issues = Array.isArray(result?.['issues']) ? result['issues'] : [];
    return evidenceFreshness({
      evidenceId: typeof evidence['evidenceId'] === 'string' ? evidence['evidenceId'] : undefined,
      workingRevision: typeof evidence['workingRevision'] === 'number' ? evidence['workingRevision'] : undefined,
      status: evidenceStatus(evidence),
      errors: issues.filter((issue) => isRecord(issue) && issue['severity'] === 'error').length,
    }, record.workingRevision);
  }
  return evidenceFreshness(record.latestValidation, record.workingRevision);
}

function freshValidationWarnings(record: ChangeRecord, values: unknown[]): unknown[] {
  const evidence = latestEvidence(values, 'project.validate');
  if (evidence === undefined || evidence['workingRevision'] !== record.workingRevision) return [];
  const result = isRecord(evidence['result']) ? evidence['result'] : undefined;
  const issues = Array.isArray(result?.['issues']) ? result['issues'] : [];
  return issues.filter((issue) => isRecord(issue) && issue['severity'] === 'warning');
}

function simulationFreshness(record: ChangeRecord, values: unknown[]): EvidenceFreshness {
  const evidence = latestEvidence(values, 'project.simulate');
  if (evidence !== undefined) {
    return evidenceFreshness({
      evidenceId: typeof evidence['evidenceId'] === 'string' ? evidence['evidenceId'] : undefined,
      workingRevision: typeof evidence['workingRevision'] === 'number' ? evidence['workingRevision'] : undefined,
      status: evidenceStatus(evidence),
    }, record.workingRevision);
  }
  return evidenceFreshness(record.latestSimulation, record.workingRevision);
}

function runtimeFreshness(record: ChangeRecord): EvidenceFreshness {
  return evidenceFreshness(record.runtimeTraces?.at(-1), record.workingRevision);
}

function diffFreshness(record: ChangeRecord): EvidenceFreshness {
  return evidenceFreshness(record.latestDiff, record.workingRevision);
}

function changedPaths(record: ChangeRecord): string[] {
  const paths = new Set([...Object.keys(record.baseContents), ...Object.keys(record.workingFiles)]);
  return [...paths].filter((filePath) => record.baseContents[filePath] !== record.workingFiles[filePath]).sort();
}

function safeInvocationSummary(records: InvocationRecord[], journal: unknown): unknown {
  const values = records.map((record) => ({
    invocationId: record.invocationId,
    occurredAt: record.occurredAt,
    capability: record.capability,
    ...(record.operationId === undefined ? {} : { operationId: record.operationId }),
    ok: record.ok,
    ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
    ...(record.projectRevisionBefore === undefined ? {} : { projectRevisionBefore: record.projectRevisionBefore }),
    ...(record.projectRevisionAfter === undefined ? {} : { projectRevisionAfter: record.projectRevisionAfter }),
    ...(record.workingRevisionBefore === undefined ? {} : { workingRevisionBefore: record.workingRevisionBefore }),
    ...(record.workingRevisionAfter === undefined ? {} : { workingRevisionAfter: record.workingRevisionAfter }),
    inputSha256: record.inputSha256,
    evidenceIds: record.evidenceIds,
  }));
  const journalRecord = isRecord(journal) ? journal : undefined;
  const journalFiles = Array.isArray(journalRecord?.['files'])
    ? journalRecord['files'].filter(isRecord).map((file) => ({
        path: file['path'],
        stagedIdentity: file['stagedIdentity'],
        replaced: file['replaced'],
        restored: file['restored'],
      }))
    : [];
  return {
    count: values.length,
    succeeded: values.filter((record) => record.ok).length,
    failed: values.filter((record) => !record.ok).length,
    records: values,
    ...(journalRecord === undefined ? {} : {
      journalStatus: journalRecord['status'],
      journalFiles,
    }),
  };
}

function semanticImpacts(diff: unknown): { potentialImpact: unknown[]; observedImpact: unknown[] } {
  if (!isRecord(diff) || !Array.isArray(diff['semantic'])) return { potentialImpact: [], observedImpact: [] };
  const potentialImpact: unknown[] = [];
  const observedImpact: unknown[] = [];
  for (const item of diff['semantic']) {
    if (!isRecord(item)) continue;
    if (Array.isArray(item['potentialImpact'])) potentialImpact.push(...item['potentialImpact']);
    if (Array.isArray(item['observedImpact'])) observedImpact.push(...item['observedImpact']);
  }
  return { potentialImpact, observedImpact };
}

function objectDiffWithFreshness(diff: unknown, freshness: EvidenceFreshness): unknown {
  return isRecord(diff) ? { ...diff, freshness } : { freshness };
}

function semanticEntries(diff: unknown): unknown[] {
  return isRecord(diff) && Array.isArray(diff['semantic']) ? diff['semantic'] : [];
}

type SemanticDiffEntry = import('@surdet/authoring').ChangeDiff['semantic'][number];

function isSemanticEntry(value: unknown): value is SemanticDiffEntry {
  return isRecord(value) && typeof value['kind'] === 'string' && typeof value['operationId'] === 'string';
}

/** 资源是 stage 不修改的共享输入，不要求先被基线时间轴引用。 */
function projectObjectFacts(baseSnapshot: Awaited<ReturnType<typeof loadProjectSnapshot>>, workingSnapshot: Awaited<ReturnType<typeof loadProjectSnapshot>>, assetPaths: readonly string[]): ManifestObjectFacts {
  const toFact = (object: { objectRef: string; references: string[]; fingerprint?: string }): ManifestObjectFact => ({
    objectRef: object.objectRef,
    references: [...object.references],
    ...(object.fingerprint === undefined ? {} : { fingerprint: object.fingerprint }),
  });
  const catalog = buildAssetCatalog(assetPaths);
  const availableAssetRefs = [
    ...catalog.backgrounds.filter((asset) => asset.resolved).map((asset) => backgroundAssetRef(asset.key)),
    ...catalog.portraits.filter((asset) => asset.resolved).map((asset) => portraitAssetRef(asset.role!, asset.outfit!, asset.expression!)),
    ...catalog.avatars.filter((asset) => asset.resolved).map((asset) => avatarAssetRef(asset.key)),
  ];
  const factsWithAssets = (snapshot: Awaited<ReturnType<typeof loadProjectSnapshot>>): ManifestObjectFact[] => {
    const facts = buildObjectIndex(snapshot).objects.map(toFact);
    for (const objectRef of availableAssetRefs) {
      if (!facts.some((object) => object.objectRef === objectRef)) facts.push({ objectRef, references: [] });
    }
    return facts;
  };
  const baseObjects = factsWithAssets(baseSnapshot);
  const workingObjects = factsWithAssets(workingSnapshot);
  const assetRefs = (objects: readonly ManifestObjectFact[]): string[] =>
    objects.filter((object) => object.objectRef.startsWith('asset:')).map((object) => object.objectRef);
  return {
    baseObjects,
    workingObjects,
    baseAssetRefs: assetRefs(baseObjects),
    workingAssetRefs: assetRefs(workingObjects),
  };
}

/** invocation ledger → 最小成功 invocation fact 投影（只保留带 operationId 的成功记录）。 */
function successInvocationFacts(records: readonly InvocationRecord[]): OperationInvocationFact[] {
  return records
    .filter((record) => record.ok && record.operationId !== undefined)
    .map((record) => ({
      capabilityId: record.capability,
      operationId: record.operationId!,
      inputSha256: record.inputSha256,
      ok: true,
    }));
}

export async function generateDeliveryCapsule(
  session: AgentPortSession,
  label?: string,
): Promise<SealedDeliveryCapsule> {
  if (label !== undefined && (typeof label !== 'string' || label.length > 120)) {
    throw new AuthoringOperationError('INVALID_REQUEST', 'delivery capsule label 最长为 120 字符');
  }
  const changeId = session.lastChangeId;
  if (changeId === undefined) throw new AuthoringOperationError('CHANGE_NOT_FOUND', 'delivery capsule 需要 active 或 resumed change');
  const storage = await NodeProjectStorage.open(session.projectRoot);
  if (projectIdentityFromRoot(storage.rootIdentity) !== session.projectIdentity) {
    throw new AuthoringOperationError('PROJECT_IDENTITY_MISMATCH', '当前项目根目录身份与 session 绑定不一致');
  }

  return NodeChangeStore.withChangeLeaseForProject(
    changeId,
    storage.rootIdentity,
    async (leasedStore) => {
      const record = await leasedStore.read(changeId);
      if (record === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
      if (!sameRootIdentity(record.projectRootIdentity, storage.rootIdentity)) {
        throw new AuthoringOperationError('PROJECT_IDENTITY_MISMATCH', `变更事务 '${changeId}' 不属于当前项目`);
      }

      const snapshot = await loadProjectSnapshot(storage, { sha256: async (text) => hashText(text) });
      const evidence = await leasedStore.readAllEvidence(changeId);
      const diff = await leasedStore.readDiff(changeId);
      const journal = await leasedStore.readLatestJournal(changeId);
      const invocations = await leasedStore.readInvocations(changeId);
      const recovery = await inspectTransactionRecovery({
        record,
        journal,
        storage,
        leaseState: 'free',
        sha256: async (text) => hashText(text),
      });
      const validation = validationFreshness(record, evidence);
      const simulation = simulationFreshness(record, evidence);
      const runtime = runtimeFreshness(record);
      const diffFreshnessValue = diffFreshness(record);
      const paths = changedPaths(record);
      const emptyChange = paths.length === 0;
      const isCommittedMutation = record.status === 'COMMITTED' && !emptyChange;
      const warnings: unknown[] = [];
      const validationWarnings = freshValidationWarnings(record, evidence);
      warnings.push(...validationWarnings);
      if (emptyChange) warnings.push('EMPTY_CHANGE');
      if (record.status === 'STALE') warnings.push('STALE_CHANGE');
      if (journal?.status === 'RECOVERY_FAILED') warnings.push('RECOVERY_FAILED');
      if (recovery.manualRecoveryRequired || recovery.disposition === 'MANUAL_RECOVERY_REQUIRED') {
        warnings.push('RECOVERY_MANUAL_REQUIRED');
      }
      const manualReviewRequired: unknown[] = [];
      if (validationWarnings.length > 0) manualReviewRequired.push('VALIDATION_WARNINGS');
      if (record.status === 'STALE') manualReviewRequired.push('STALE_CHANGE');
      if (journal?.status === 'RECOVERY_FAILED') manualReviewRequired.push('RECOVERY_FAILED');
      if (recovery.manualRecoveryRequired || recovery.disposition === 'MANUAL_RECOVERY_REQUIRED') {
        manualReviewRequired.push('RECOVERY_MANUAL_REQUIRED');
      }

      const capsuleId = crypto.randomUUID();
      const beforeRevision = record.status === 'COMMITTED' ? record.baseRevision : snapshot.revision;
      // v2：working/base 双快照 → 对象事实 → 确定性 manifest；unavailable 仍封存审计 capsule。
      const hasher = { sha256: async (text: string) => hashText(text) };
      const workingSnapshot = await loadProjectSnapshot(new ChangeRecordProjectStorage(record, 'working'), hasher);
      const baseSnapshot = await loadProjectSnapshot(new ChangeRecordProjectStorage(record, 'base'), hasher);
      const composition = await buildCompositionManifest({
        record,
        projectIdentity: session.projectIdentity,
        invocationFacts: successInvocationFacts(invocations),
        semanticDiff: semanticEntries(diff).filter(isSemanticEntry),
        objectFacts: projectObjectFacts(baseSnapshot, workingSnapshot, await storage.listFiles()),
      }, hasher);
      // Wave 5：integration change 的 provenance 与失败审计（在 composition manifest 之后构造）。
      let integrationProvenance: DeliveryCapsulePayload['integrationProvenance'];
      if (record.integration !== undefined) {
        const integrationMeta = record.integration;
        const planSource = await loadIntegrationProvenance(session.projectRoot, {
          planId: integrationMeta.planId,
          planFingerprint: integrationMeta.planFingerprint,
          status: integrationMeta.status,
          executeOperationId: integrationMeta.executeOperationId,
        });
        integrationProvenance = {
          planId: integrationMeta.planId,
          planFingerprint: integrationMeta.planFingerprint,
          executeOperationId: integrationMeta.executeOperationId,
          integrationChangeId: changeId,
          status: integrationMeta.status,
          nextOperationIndex: integrationMeta.nextOperationIndex,
          operationCount: integrationMeta.replayedOperations.length,
          sourceCapsules: integrationMeta.sourceCapsules,
          includedUnits: [...integrationMeta.includedUnitIds],
          deduplicatedUnits: integrationMeta.deduplicatedUnits,
          conflictResolutions: integrationMeta.conflictResolutions,
          replayReceipts: integrationMeta.replayedOperations,
          ...(integrationMeta.failure === undefined ? {} : { failure: integrationMeta.failure }),
          planAvailable: planSource.available,
        };
        if (!planSource.available) {
          composition.eligibility = 'unavailable';
          (composition.reasons as Array<{ code: string; message: string; operationId?: string }>).push({ code: 'COMPOSITION_PLAN_INVALID', message: 'sealed plan artifact 缺失、损坏或指纹不符' });
          manualReviewRequired.push('INTEGRATION_PLAN_UNAVAILABLE');
        }
        if (integrationMeta.status === 'FAILED') {
          warnings.push('INTEGRATION_REPLAY_FAILED');
          manualReviewRequired.push('INTEGRATION_REPLAY_FAILED');
        }
      }

      const payload: DeliveryCapsulePayload = {
        capsuleVersion: DELIVERY_CAPSULE_VERSION,
        capsuleId,
        generatedAt: new Date().toISOString(),
        sessionId: session.sessionId,
        policy: session.policy,
        contractVersion: AUTHORING_CONTRACT_VERSION,
        projectIdentity: session.projectIdentity,
        baseProjectRevision: record.baseRevision,
        currentProjectRevision: snapshot.revision,
        changeId,
        changeStatus: record.status,
        workingRevision: record.workingRevision,
        ...(record.intent?.intent === undefined ? {} : { intent: record.intent.intent }),
        acceptanceCriteria: record.intent?.acceptanceCriteria ?? [],
        operations: Object.entries(record.operations).map(([operationId, operation]) => ({
          operationId,
          requestHash: operation.requestHash,
          result: operation.result,
        })),
        invocationSummary: safeInvocationSummary(invocations, journal),
        objectDiff: objectDiffWithFreshness(diff, diffFreshnessValue),
        causalImpact: semanticImpacts(diff),
        validation,
        simulation,
        runtime,
        recovery: {
          disposition: recovery.disposition,
          ...(recovery.journalStatus === undefined ? {} : { journalStatus: recovery.journalStatus }),
          manualRecoveryRequired: recovery.manualRecoveryRequired,
          reasons: recovery.reasons,
        },
        warnings,
        manualReviewRequired,
        projectMutation: {
          occurred: isCommittedMutation,
          expectedByPolicy: session.policy === 'apply' && isCommittedMutation,
          beforeRevision,
          afterRevision: snapshot.revision,
        },
        // integrationProvenance 的接口位置在 Task 6 从 sealed plan + record.integration 补全。
        ...(integrationProvenance === undefined ? {} : { integrationProvenance }),
        composition: {
          eligibility: composition.eligibility,
          reasons: composition.reasons.map((reason) => ({
            code: reason.code,
            ...(reason.operationId === undefined ? {} : { operationId: reason.operationId }),
            message: reason.message,
          })),
          ...(composition.eligibility === 'ready' ? { manifest: composition.manifest } : {}),
        },
      };
      const artifactIdentity = await leasedStore.writeCapsulePayload(changeId, capsuleId, payload);
      return { ...payload, artifactIdentity };
    },
    { allowTerminal: true, allowStale: true },
  );
}
