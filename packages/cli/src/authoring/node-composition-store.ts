import * as path from 'node:path';
import {
  AuthoringOperationError,
  candidateCapsuleIdentity,
  stableStringify,
  type CandidateCapsuleRef,
  type EvidenceFreshness,
  type IntegrationPlan,
  type VerifiedCompositionCandidate,
} from '@surdet/authoring';
import type { JsonValue } from '@surdet/authoring';
import type { ChangeRecord } from '@surdet/authoring';
import { NodeChangeStore } from './node-change-store.js';
import { projectIdentityFromRoot } from './project-identity.js';
import { createJsonRecord, readJsonRecord } from './node-json-record.js';

export interface CompositionArtifactIdentity {
  path: string;
  bytes: number;
  sha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string, details?: Record<string, unknown>): AuthoringOperationError {
  return new AuthoringOperationError('COMPOSITION_PLAN_INVALID', message, details);
}

/** planId/ref 字段的规范字符集：先校验后拼路径，杜绝 ../、绝对路径与别名。 */
function assertCanonicalId(value: string, field: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AuthoringOperationError('INVALID_REQUEST', `${field} 含有非法字符：${value}`);
  }
}

const PLANS_DIRECTORY = 'composition-plans';

/**
 * 只读 candidate + 不可变 plan 的项目级存储。
 * 构造只接受由 NodeChangeStore.forProject() 得到的 projectDirectory 与 expected projectIdentity；
 * 不产生任何中央 index，plan 路径完全由 planId 派生并始终落在当前 project namespace 内。
 */
export class NodeCompositionStore {
  readonly projectDirectory: string;

  constructor(projectDirectory: string, private readonly expectedProjectIdentity: string) {
    const normalized = path.normalize(projectDirectory);
    if (path.basename(normalized) !== expectedProjectIdentity) {
      throw new AuthoringOperationError('PROJECT_IDENTITY_MISMATCH',
        `projectDirectory 与期望 projectIdentity 不符：${expectedProjectIdentity}`);
    }
    this.projectDirectory = normalized;
  }

  private planDirectory(planId: string): string {
    assertCanonicalId(planId, 'planId');
    const directory = path.join(this.projectDirectory, PLANS_DIRECTORY, planId);
    // 派生路径必须仍位于 projectDirectory 内。
    const resolved = path.resolve(directory);
    if (!resolved.toLowerCase().startsWith(this.projectDirectory.toLowerCase() + path.sep)) {
      throw invalid(`plan 路径越出项目命名空间：${planId}`);
    }
    return directory;
  }

  /** 按 current project/changeId/capsuleId/SHA 读取候选；只信任 capsule identity。 */
  async readCandidate(ref: CandidateCapsuleRef): Promise<VerifiedCompositionCandidate> {
    assertCanonicalId(ref.changeId, 'changeId');
    assertCanonicalId(ref.capsuleId, 'capsuleId');
    if (!/^[0-9a-f]{64}$/.test(ref.artifactSha256)) {
      throw new AuthoringOperationError('CAPSULE_IDENTITY_MISMATCH', `artifactSha256 必须是 64 位小写十六进制：${ref.changeId}/${ref.capsuleId}`);
    }
    const opened = await NodeChangeStore.openByChangeId(ref.changeId, path.dirname(this.projectDirectory));
    if (opened === null) {
      throw new AuthoringOperationError('CHANGE_NOT_FOUND', `source change 不存在：${ref.changeId}`, { changeId: ref.changeId });
    }
    // source change 归属必须与期望项目一致；比较只信任 capsule identity，不读 working 状态。
    if (projectIdentityFromRoot(opened.record.projectRootIdentity) !== this.expectedProjectIdentity) {
      throw new AuthoringOperationError('PROJECT_IDENTITY_MISMATCH',
        `source change 属于其他项目：${ref.changeId}`);
    }
    const { payload } = await opened.store.readCapsulePayload(ref.changeId, ref.capsuleId, ref.artifactSha256);
    return projectPayloadToCandidate(payload, ref);
  }

  async writePlan(plan: IntegrationPlan): Promise<CompositionArtifactIdentity> {
    assertCanonicalId(plan.planId, 'plan.planId');
    const directory = this.planDirectory(plan.planId);
    const payloadPath = path.join(directory, 'payload.json');
    const identityPath = path.join(directory, 'identity.json');
    const existingIdentity = await readJsonRecord<CompositionArtifactIdentity>(identityPath);
    const existingPayload = await readJsonRecord<unknown>(payloadPath);
    if (existingPayload !== null) {
      // 同 planId 已封存：同语义幂等回读；不同 payload 拒绝且绝不覆盖（create-only 纪律）。
      if (stableStringify(existingPayload.value as JsonValue) !== stableStringify(plan as unknown as JsonValue)) {
        throw invalid(`同 planId 已存在不同内容的已封存计划，拒绝覆盖：${plan.planId}`, { planId: plan.planId });
      }
      if (existingIdentity === null) await createJsonRecord(identityPath, existingPayload.identity);
      return (await this.readPlan(plan.planId, existingPayload.identity.sha256)).identity;
    }
    if (existingIdentity !== null) throw invalid(`计划 payload 缺失，保留原身份并停止：${plan.planId}`);
    const identity = await createJsonRecord(payloadPath, plan);
    await createJsonRecord(identityPath, identity);
    return identity;
  }

  /** Always checks the persisted sidecar; external references additionally bind their expected SHA. */
  async readPlan(planId: string, expectedSha256?: string): Promise<{ plan: IntegrationPlan; identity: CompositionArtifactIdentity }> {
    assertCanonicalId(planId, 'planId');
    if (expectedSha256 !== undefined && !/^[0-9a-f]{64}$/.test(expectedSha256)) {
      throw invalid(`artifactSha256 必须是 64 位小写十六进制：${planId}`);
    }
    const directory = this.planDirectory(planId);
    const loaded = await readJsonRecord<unknown>(path.join(directory, 'payload.json'));
    if (loaded === null) {
      throw new AuthoringOperationError('OBJECT_NOT_FOUND', `integration plan 不存在：${planId}`, { planId });
    }
    const sidecar = await readJsonRecord<CompositionArtifactIdentity>(path.join(directory, 'identity.json'));
    if (sidecar === null) {
      throw new AuthoringOperationError('CAPSULE_IDENTITY_MISMATCH', `integration plan 缺少 identity sidecar：${planId}`);
    }
    const sameWindowsPath = (left: string, right: string): boolean => (
      process.platform === 'win32'
        ? path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
        : path.normalize(left) === path.normalize(right)
    );
    if (!sameWindowsPath(sidecar.value.path, path.join(directory, 'payload.json'))
      || sidecar.value.bytes !== loaded.identity.bytes
      || sidecar.value.sha256 !== loaded.identity.sha256
      || (expectedSha256 !== undefined && sidecar.value.sha256 !== expectedSha256)) {
      throw new AuthoringOperationError('CAPSULE_IDENTITY_MISMATCH', `integration plan 身份不成立：${planId}`, {
        planId,
        expectedSha256,
        actualSha256: loaded.identity.sha256,
      });
    }
    if (!isPlanPayload(loaded.value)) throw invalid(`integration plan payload 非法：${planId}`);
    return { plan: loaded.value, identity: sidecar.value };
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** EvidenceFreshness.status → CandidateEvidenceSummary 三元投影。 */
function evidenceStatusOf(freshness: unknown): 'fresh' | 'missing' | 'stale' | 'failed' {
  const status = isRecord(freshness) ? freshness['status'] : undefined;
  return status === 'fresh' || status === 'stale' ? status : status === 'failed' ? 'failed' : 'missing';
}

/** capsule payload → VerifiedCompositionCandidate 最小投影（比较只信任 identity 与封存字段）。 */
function projectPayloadToCandidate(payload: unknown, ref: CandidateCapsuleRef): VerifiedCompositionCandidate {
  if (!isRecord(payload) || payload['capsuleVersion'] !== '2.0.0') {
    throw new AuthoringOperationError('CANDIDATE_NOT_COMPOSABLE', `候选胶囊不是 v2 composable 形态：${ref.changeId}/${ref.capsuleId}`);
  }
  const composition = payload['composition'];
  if (!isRecord(composition)) {
    throw new AuthoringOperationError('CANDIDATE_NOT_COMPOSABLE', `候选胶囊缺少 composition 投影：${ref.changeId}/${ref.capsuleId}`);
  }
  const projectIdentity = asString(payload['projectIdentity']);
  if (projectIdentity === '') throw new AuthoringOperationError('PROJECT_IDENTITY_MISMATCH', `候选胶囊缺 projectIdentity：${ref.changeId}`);
  const warnings = Array.isArray(payload['warnings']) ? payload['warnings'] : [];
  const manualReviewRequired = Array.isArray(payload['manualReviewRequired']) ? payload['manualReviewRequired'] : [];
  const objectDiff = isRecord(payload['objectDiff']) ? payload['objectDiff'] : {};
  const freshness = isRecord(objectDiff['freshness']) ? objectDiff['freshness'] : {};
  const status = freshness['status'];
  const objectDiffFreshness: EvidenceFreshness = {
    status: status === 'fresh' || status === 'stale' || status === 'failed' || status === 'incomplete' ? status : 'missing',
    ...(typeof freshness['workingRevision'] === 'number' ? { workingRevision: freshness['workingRevision'] } : {}),
    ...(typeof freshness['currentWorkingRevision'] === 'number' ? { currentWorkingRevision: freshness['currentWorkingRevision'] } : {}),
  };
  const sourceWorkingRevision = payload['workingRevision'];
  if (typeof sourceWorkingRevision !== 'number' || !Number.isInteger(sourceWorkingRevision) || sourceWorkingRevision < 0) {
    throw new AuthoringOperationError('CAPSULE_IDENTITY_MISMATCH', `候选胶囊缺少有效的封存工作版本：${ref.changeId}/${ref.capsuleId}`);
  }
  const currentDiff = objectDiffFreshness.status === 'fresh'
    && objectDiffFreshness.workingRevision === sourceWorkingRevision
    && objectDiffFreshness.currentWorkingRevision === sourceWorkingRevision;
  const semantic = currentDiff && Array.isArray(objectDiff['semantic']) ? objectDiff['semantic'] : [];
  const invocations = isRecord(payload['invocationSummary']) ? payload['invocationSummary']['records'] : [];
  const sealedRuntimeTraceIds = new Set<string>();
  if (Array.isArray(invocations)) {
    for (const invocation of invocations) {
      if (!isRecord(invocation) || invocation['ok'] !== true || !Array.isArray(invocation['evidenceIds'])) continue;
      for (const evidenceId of invocation['evidenceIds']) {
        if (typeof evidenceId === 'string' && /^trace_[A-Za-z0-9_-]+$/.test(evidenceId)) sealedRuntimeTraceIds.add(evidenceId);
      }
    }
  }
  return {
    candidateId: candidateCapsuleIdentity(ref),
    ref,
    capsuleVersion: '2.0.0',
    projectIdentity,
    baseProjectRevision: asString(payload['baseProjectRevision']),
    sourceWorkingRevision,
    objectDiffFreshness,
    ...(typeof payload['intent'] === 'string' ? { intent: payload['intent'] } : {}),
    acceptanceCriteria: Array.isArray(payload['acceptanceCriteria'])
      ? payload['acceptanceCriteria'].filter((item): item is string => typeof item === 'string') : [],
    sealedRuntimeTraceIds: [...sealedRuntimeTraceIds].sort(),
    sealedFileDiffs: (currentDiff && Array.isArray(objectDiff['files']) ? objectDiff['files'] : [])
      .filter((file) => isRecord(file) && typeof file['path'] === 'string' && typeof file['unifiedDiff'] === 'string')
      .map((file) => ({ path: file['path'] as string, unifiedDiff: file['unifiedDiff'] as string,
        unexpectedFormatChange: file['unexpectedFormatChange'] === true })),
    composition: {
      eligibility: composition['eligibility'] === 'ready' ? 'ready' : 'unavailable',
      reasons: (Array.isArray(composition['reasons']) ? composition['reasons'] : []) as VerifiedCompositionCandidate['composition']['reasons'],
      manifest: composition['manifest'] as VerifiedCompositionCandidate['composition']['manifest'],
    },
    evidenceSummary: {
      validation: evidenceStatusOf(payload['validation']),
      simulation: evidenceStatusOf(payload['simulation']),
      runtime: evidenceStatusOf(payload['runtime']),
      warnings: warnings.length,
      manualReviewRequired: manualReviewRequired.map((item) => asString(item)).filter((item) => item !== ''),
    },
    semanticDiff: semantic.filter(isRecord).map((entry) => ({
      kind: asString(entry['kind'], 'unknown'),
      operationId: asString(entry['operationId']),
      ...(typeof entry['objectBefore'] === 'string' ? { objectBefore: entry['objectBefore'] } : {}),
      ...(typeof entry['objectAfter'] === 'string' ? { objectAfter: entry['objectAfter'] } : {}),
      ...(typeof entry['fingerprintBefore'] === 'string' ? { fingerprintBefore: entry['fingerprintBefore'] } : {}),
      ...(typeof entry['fingerprintAfter'] === 'string' ? { fingerprintAfter: entry['fingerprintAfter'] } : {}),
      potentialImpact: Array.isArray(entry['potentialImpact']) ? entry['potentialImpact'] : [],
      observedImpact: Array.isArray(entry['observedImpact']) ? entry['observedImpact'] : [],
    })),
  };
}

function isPlanPayload(value: unknown): value is IntegrationPlan {
  return isRecord(value)
    && value['planVersion'] === '1.0.0'
    && typeof value['planId'] === 'string'
    && typeof value['planFingerprint'] === 'string'
    && isRecord(value['dryRun']);
}
