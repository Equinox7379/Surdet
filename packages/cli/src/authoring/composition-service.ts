import * as path from 'node:path';
import {
  AuthoringOperationError,
  buildIntegrationPlan,
  compareCandidates,
  loadProjectSnapshot,
  sealDryRunResult,
  type ConflictResolutionInput,
  type CandidateCapsuleRef,
  type CompositionComparison,
  type CompositionManifest,
  type IntegrationPlan,
  type IntegrationPlanDraft,
  type ProjectSnapshot,
  type TextHasher,
  type VerifiedCompositionCandidate,
} from '@surdet/authoring';
import { NodeProjectStorage } from './node-project-storage.js';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { ChangeRecordProjectStorage } from './working-project-storage.js';
import { NodeCompositionStore, type CompositionArtifactIdentity } from './node-composition-store.js';
import {
  InMemoryChangeRepository,
  beginChange,
  executeIntegrationReplay,
  replayCompositionOperation,
  timelinePathFor,
} from '@surdet/authoring';

export interface CompositionDryRunReport {
  status: 'passed' | 'failed';
  finalObjectFingerprints: Record<string, string>;
  errors: Array<{ code: string; message: string; operationIndex?: number }>;
}

export interface CompositionCompareResult {
  comparison: CompositionComparison & { candidateManifests?: Record<string, CompositionManifest> };
  candidates: VerifiedCompositionCandidate[];
  currentProjectRevision: string;
}

export interface CompositionPlanResult {
  plan: IntegrationPlan;
  identity: CompositionArtifactIdentity;
  comparison: CompositionCompareResult['comparison'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 组合比较与计划编排：读取真实 sealed capsules → 重新比较（拒绝旧 JSON）→
 * build plan → 内存 dry-run replay → 封存不可变 plan artifact。
 * dry-run 不写 change store、不写 source capsule、不写 project。
 */
export class CompositionService {
  private readonly leases: NodeLocalLeaseManager;

  constructor(
    readonly store: NodeCompositionStore,
    readonly projectIdentity: string,
    readonly projectRoot: string,
    private readonly hasher: TextHasher,
    leases?: NodeLocalLeaseManager,
  ) {
    this.leases = leases ?? new NodeLocalLeaseManager();
  }

  /** 当前 project revision；短 project lease 内读取，保证 snapshot/revision 一致。 */
  async currentSnapshot(): Promise<ProjectSnapshot> {
    return this.leases.withProjectLease(this.projectIdentity, async () => {
      const storage = await NodeProjectStorage.open(this.projectRoot);
      return loadProjectSnapshot(storage, this.hasher);
    });
  }

  async compare(candidateRefs: CandidateCapsuleRef[]): Promise<CompositionCompareResult> {
    const snapshot = await this.currentSnapshot();
    const candidates: VerifiedCompositionCandidate[] = [];
    for (const ref of candidateRefs) {
      candidates.push(await this.store.readCandidate(ref));
    }
    if (candidates.length < 2) {
      throw new AuthoringOperationError('INVALID_REQUEST', 'composition.compare 至少需要两个候选胶囊');
    }
    for (const candidate of candidates) {
      if (candidate.projectIdentity !== this.projectIdentity) {
        throw new AuthoringOperationError('CANDIDATE_PROJECT_MISMATCH',
          `候选 ${candidate.candidateId} 属于其他项目`);
      }
    }
    const comparison = await compareCandidates({
      projectIdentity: this.projectIdentity,
      currentProjectRevision: snapshot.revision,
      candidates,
    }, this.hasher);
    const manifests: Record<string, CompositionManifest> = {};
    for (const candidate of candidates) {
      if (candidate.composition.manifest !== undefined) {
        manifests[candidate.candidateId] = candidate.composition.manifest;
      }
    }
    return {
      comparison: { ...comparison, candidateManifests: manifests } as CompositionCompareResult['comparison'],
      candidates,
      currentProjectRevision: snapshot.revision,
    };
  }

  /**
   * 完整 plan 流程：compare → buildIntegrationPlan → dry-run → seal → writePlan。
   * comparison 每次现场重算，绝不接受调用方传入的旧 comparison JSON。
   */
  async plan(input: {
    candidateRefs: CandidateCapsuleRef[];
    selectedUnitIds?: string[];
    conflictResolutions?: ConflictResolutionInput[];
    now?: string;
  }): Promise<CompositionPlanResult> {
    const { comparison } = await this.compare(input.candidateRefs);
    const selected = input.selectedUnitIds ?? comparison.units.map((unit) => unit.unitId);
    const draft: IntegrationPlanDraft = await buildIntegrationPlan({
      comparison,
      selectedUnitIds: selected,
      conflictResolutions: input.conflictResolutions ?? [],
      now: input.now ?? new Date().toISOString(),
    }, this.hasher);
    const dryRun = await this.dryRun(draft);
    const sealedPlan = await sealDryRunResult(draft, dryRun, this.hasher);
    const identity = await this.store.writePlan(sealedPlan);
    return { plan: sealedPlan, identity, comparison };
  }

  /**
   * 共享 dry-run：临时 InMemoryChangeRepository + 当前 snapshot；
   * 逐条 replayCompositionOperation；回读 produced object fingerprint；丢弃 session。
   */
  async dryRun(draft: IntegrationPlanDraft): Promise<CompositionDryRunReport> {
    const errors: CompositionDryRunReport['errors'] = [];
    const snapshot = await this.currentSnapshot();
    if (snapshot.revision !== draft.expectedProjectRevision) {
      return {
        status: 'failed',
        finalObjectFingerprints: {},
        errors: [{ code: 'COMPOSITION_PLAN_STALE', message: `project revision 已离开计划基线：${draft.expectedProjectRevision}` }],
      };
    }
    const repository = new InMemoryChangeRepository();
    let session: Awaited<ReturnType<typeof beginChange>> | undefined;
    try {
      session = await beginChange(snapshot, repository);
      for (let index = 0; index < draft.replayOperations.length; index += 1) {
        const operation = draft.replayOperations[index]!;
        try {
          await replayCompositionOperation(session, operation, this.hasher);
        } catch (error) {
          const code = error instanceof AuthoringOperationError ? error.code : 'COMPOSITION_REPLAY_FAILED';
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ code, message, operationIndex: index });
          break;
        }
      }
    } finally {
      // 内存 session 直接丢弃：不写 NodeChangeStore change、不写 source capsule、不写 project。
      void session;
    }

    // 回读 produced object fingerprints：与封存 manifest 同源——scene/timeline 取工作区文本 SHA。
    const finalObjectFingerprints: Record<string, string> = {};
    if (session !== undefined && errors.length === 0) {
      for (const entry of draft.provenance) {
        const fingerprint = await objectFingerprintFromWorking(session.record.workingFiles, entry.targetObject, this.hasher);
        if (fingerprint !== undefined) finalObjectFingerprints[entry.targetObject] = fingerprint;
        else if (requiresFingerprint(entry.targetObject)) {
          errors.push({
            code: 'COMPOSITION_REPLAY_FAILED',
            message: `replay 后缺少对象指纹：${entry.targetObject}`,
          });
          break;
        }
      }
    }
    return {
      status: errors.length === 0 ? 'passed' : 'failed',
      finalObjectFingerprints,
      errors,
    };
  }

  /**
   * composition.execute：创建或精确恢复 OPEN integration change 并推进 replay。
   * - 无 changeId：扫描项目 change heads；发现该计划的 REPLAYING/FAILED change 即恢复；
   *   发现普通 OPEN change → CHANGE_BUSY（拒绝接管）。
   * - revision 已离开计划基线 → COMPOSITION_PLAN_STALE。
   */
  async executePlan(input: {
    planId: string;
    artifactSha256: string;
    executeOperationId: string;
    changeId?: string;
  }): Promise<CompositionExecuteResult> {
    const { plan } = await this.store.readPlan(input.planId, input.artifactSha256);
    if (plan.dryRun.status !== 'passed') {
      throw new AuthoringOperationError('COMPOSITION_PLAN_INVALID', 'dry-run 未通过的计划不可执行', { planId: plan.planId });
    }
    const snapshot = await this.currentSnapshot();
    if (snapshot.revision !== plan.expectedProjectRevision) {
      throw new AuthoringOperationError('COMPOSITION_PLAN_STALE',
        `project revision 已离开计划基线：${plan.expectedProjectRevision}`,
        { expectedProjectRevision: plan.expectedProjectRevision, currentRevision: snapshot.revision });
    }
    const storage = await NodeProjectStorage.open(this.projectRoot);
    const store = await NodeChangeStore.forProject(snapshot.rootIdentity);

    // 扫描阶段不需要 change lease；真正写入的 replay 阶段在 withChangeLease 内进行。
    let existingTarget: { changeId: string; metadata: IntegrationMetadata } | undefined;
    if (input.changeId === undefined) {
      for (const directoryName of await listChangeDirectories(store.projectDirectory)) {
        const head = await store.read(directoryName);
        if (head === null || head.status !== 'OPEN') continue;
        // 多会话并行的普通 OPEN change 合法存在；只有该计划的 integration change 可被精确恢复。
        // 「session 已持普通 active change 时拒绝执行」是 MCP session 层不变量（Wave 5 Task 5）。
        if (head.integration === undefined || head.integration.planId !== plan.planId) continue;
        if (head.integration.executeOperationId !== input.executeOperationId) {
          throw new AuthoringOperationError('COMPOSITION_PLAN_INVALID',
            'executeOperationId 与既有 integration change 不一致', { changeId: head.changeId });
        }
        existingTarget = { changeId: head.changeId, metadata: head.integration };
        break;
      }
    } else {
      const opened = await store.read(input.changeId);
      if (opened === null || opened.status !== 'OPEN') {
        throw new AuthoringOperationError('CHANGE_NOT_FOUND', `integration change 不存在或未开启：${input.changeId}`);
      }
      if (opened.integration?.planId !== plan.planId
        || opened.integration.executeOperationId !== input.executeOperationId) {
        throw new AuthoringOperationError('COMPOSITION_PLAN_INVALID', 'change 不是该计划的 integration change');
      }
      existingTarget = { changeId: opened.changeId, metadata: opened.integration };
    }

    let target: { changeId: string; metadata: IntegrationMetadata } | undefined = existingTarget;
    const initialMetadata: IntegrationMetadata = target?.metadata ?? {
      planId: plan.planId,
      planFingerprint: plan.planFingerprint,
      executeOperationId: input.executeOperationId,
      sourceCapsules: plan.sourceCapsules,
      includedUnitIds: plan.selectedUnitIds,
      deduplicatedUnits: plan.deduplicatedUnits,
      conflictResolutions: plan.conflictResolutions,
      status: 'REPLAYING',
      nextOperationIndex: 0,
      replayedOperations: [],
    };
    // create 免租（AuthoringService.begin 同款）；后续 CAS 更新必须持 change lease。
    if (target === undefined) {
      const seeded = await beginChange(snapshot, store, storage, undefined, { integration: initialMetadata });
      target = { changeId: seeded.record.changeId, metadata: initialMetadata };
    }
    return NodeChangeStore.withChangeLease(target.changeId, async (leased) => {
      const reopened = await leased.read(target.changeId);
      if (reopened === null || reopened.integration === undefined) {
        throw new AuthoringOperationError('CHANGE_NOT_FOUND', `integration change 不存在：${target.changeId}`);
      }
      const session = new ChangeSession(reopened, leased, storage);
      const metadata = await executeIntegrationReplay(session, plan, this.hasher);
      return {
        changeId: session.record.changeId,
        status: metadata.status,
        workingRevision: session.record.workingRevision,
        nextOperationIndex: metadata.nextOperationIndex,
        replayedOperations: metadata.replayedOperations,
      };
    });
  }

}

function requiresFingerprint(objectRef: string): boolean {
  return objectRef.startsWith('scene:') || objectRef.startsWith('timeline:');
}

/** 与 composition-manifest 封存语义同源的指纹回读：scene/timeline 为工作区文本 SHA-256。 */
async function objectFingerprintFromWorking(
  workingFiles: Record<string, string>,
  objectRef: string,
  hasher: TextHasher,
): Promise<string | undefined> {
  let filePath: string | undefined;
  if (objectRef.startsWith('scene:')) {
    const sceneId = objectRef.slice('scene:'.length);
    filePath = `content/scenario/${sceneId}.gal`;
  } else if (objectRef.startsWith('timeline:')) {
    filePath = timelinePathFor(objectRef.slice('timeline:'.length));
  } else {
    return undefined;
  }
  const text = workingFiles[filePath];
  return text === undefined ? undefined : hasher.sha256(text);
}

import * as fs from 'node:fs';
import { NodeChangeStore } from './node-change-store.js';
import { ChangeSession } from '@surdet/authoring';
import type { IntegrationMetadata } from '@surdet/authoring';

export interface CompositionExecuteResult {
  changeId: string;
  status: IntegrationMetadata['status'];
  workingRevision: number;
  nextOperationIndex: number;
  replayedOperations: IntegrationMetadata['replayedOperations'];
}

async function listChangeDirectories(projectDirectory: string): Promise<string[]> {
  const entries = await fs.promises.readdir(projectDirectory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory() && /^[A-Za-z0-9_-]+$/.test(entry.name)).map((entry) => entry.name);
}
