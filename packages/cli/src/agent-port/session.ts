import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  AUTHORING_CAPABILITY_REGISTRY,
  AUTHORING_CONTRACT_VERSION,
  AuthoringOperationError,
  assertCurrentCommitEvidence,
  createFailureEnvelope,
  createSuccessEnvelope,
  evidenceFreshness,
  getCapabilityDefinition,
  loadProjectSnapshot,
  nativeCapabilityToMcpTool,
  normalizeAuthoringError,
  humanWorkspaceCommitBlock,
  inspectCandidateCompositionReadiness,
  type CandidateCompositionReadiness,
  type AuthoringCapabilityId,
  type AuthoringEnvelope,
  type AutonomyPolicy,
  type CapabilityAvailability,
  type ChangeRecord,
  type CommitJournalStatus,
  type EvidenceFreshness,
  type RecoveryDisposition,
  type HumanWorkspaceSummary,
  type ProjectMutationNotice,
} from '@surdet/authoring';
import { dispatchAuthoringCapability } from '../authoring/authoring-dispatcher.js';
import { AuthoringService } from '../authoring/authoring-service.js';
import { NodeChangeStore } from '../authoring/node-change-store.js';
import { NodeLocalLeaseManager, type LeaseInspection } from '../authoring/node-local-lease.js';
import { NodeProjectStorage } from '../authoring/node-project-storage.js';
import { projectIdentityFromRoot } from '../authoring/project-identity.js';
import { HumanWorkspaceStore } from '../authoring/human-workspace-store.js';
import { ProjectMutationNoticeStore } from '../authoring/project-mutation-notice-store.js';
import { recordInvocation } from './invocation-ledger.js';
import { generateDeliveryCapsule, type SealedDeliveryCapsule } from './delivery-capsule.js';
import { isCapabilityAllowed } from './policy.js';
import type { AgentPortOptions } from './args.js';
import { authorizeImageSources, type AuthorizedImageSource } from '../authoring/agent-image-import-service.js';
import { openAssetImportAuthorityPaths } from '../asset-import-authority/filesystem.js';
import { AssetImportRecordStore } from '../asset-import-authority/record-store.js';

export interface SessionCapability {
  id: AuthoringCapabilityId;
  mcpTool: string;
  availability: CapabilityAvailability;
  reason?: string;
}

interface SessionLeaseSummary {
  state: LeaseInspection['state'];
  holder?: LeaseInspection['holder'];
  retryAfterMs?: number;
  manualRecoveryRequired: boolean;
}

interface SessionJournalSummary {
  recordState: 'missing' | 'readable' | 'corrupt' | 'unsupported';
  status?: CommitJournalStatus;
  journalVersion?: number;
  errorCode?: string;
  manualRecoveryRequired: boolean;
}

export interface SessionDescription {
  sessionId: string;
  startedAt: string;
  engineVersion: string;
  contractVersion: typeof AUTHORING_CONTRACT_VERSION;
  projectIdentity: string;
  projectName: string;
  projectRevision: string;
  humanWorkspace: HumanWorkspaceSummary;
  projectMutation?: ProjectMutationNotice;
  policy: AutonomyPolicy;
  review?: {
    reviewState: 'unreviewed' | 'awaiting-decision' | 'human-reviewed' | 'awaiting-approval' | 'owner-approved' | 'returned' | 'stale';
    reviewId?: string;
    resultReviewId?: string;
    waitingFor?: 'human-decision' | 'human-approval';
  };
  activeChange?: {
    changeId: string;
    status: ChangeRecord['status'];
    baseRevision: string;
    workingRevision: number;
    recordVersion: number;
    compositionMode?: 'direct' | 'candidate';
    integration?: {
      planId: string;
      status: 'REPLAYING' | 'READY' | 'FAILED';
      nextOperationIndex: number;
      operationCount: number;
    };
  };
  resumed: boolean;
  capabilities: SessionCapability[];
  evidence: {
    validation?: EvidenceFreshness;
    simulation?: EvidenceFreshness;
    runtime?: EvidenceFreshness;
  };
  lease: {
    change: SessionLeaseSummary;
    project: SessionLeaseSummary;
  };
  journal: SessionJournalSummary;
  recoveryDisposition: RecoveryDisposition;
  manualRecoveryRequired: boolean;
  nextActions: string[];
  candidateReadiness?: CandidateCompositionReadiness;
}

const ACTIVE_CHANGE_CAPABILITIES = new Set<AuthoringCapabilityId>([
  'scene.create',
  'scene.remove',
  'scene.patch',
  'variable.ensure',
  'variable.patch-initial',
  'character.ensure',
  'character.remove',
  'timeline.create',
  'timeline.patch',
  'gallery.cg.create',
  'gallery.cg.patch',
  'project.entry-scene.set',
  'project.player-config.patch',
  'runtime.run-from',
  'runtime.read-trace',
  'change.diff',
  'change.commit',
  'change.rollback',
  'change.recovery.inspect',
  'change.recovery.execute',
]);

function hashText(text: string): string {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function engineVersion(): string {
  return process.env['SURDET_ENGINE_VERSION'] ?? '0.1.0';
}

function changeRequired(capability: AuthoringCapabilityId): boolean {
  return ACTIVE_CHANGE_CAPABILITIES.has(capability);
}

function policyBlocked(capability: AuthoringCapabilityId, policy: AutonomyPolicy): AuthoringOperationError {
  return new AuthoringOperationError('POLICY_BLOCKED', `policy '${policy}' 不允许 capability：${capability}`);
}

function stateBlocked(capability: AuthoringCapabilityId): AuthoringOperationError {
  return new AuthoringOperationError('SESSION_STATE_INVALID', `capability '${capability}' 当前 change 状态不允许该动作`);
}

async function withChangeLeaseRetry<T>(
  changeId: string,
  callback: (leasedStore: NodeChangeStore) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await NodeChangeStore.withChangeLease(changeId, callback);
    } catch (error) {
      const transientMissingLease = error instanceof AuthoringOperationError
        && error.code === 'LEASE_CORRUPT'
        && error.message.includes('lease.json 缺失');
      if (!(error instanceof AuthoringOperationError)
        || (error.code !== 'CHANGE_BUSY' && !transientMissingLease)
        || attempt === 39) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new AuthoringOperationError('CHANGE_BUSY', `变更事务 '${changeId}' 在有界重试后仍被占用`);
}

function evidenceFor(record: ChangeRecord | undefined): SessionDescription['evidence'] {
  if (record === undefined) return {};
  return {
    validation: evidenceFreshness(record.latestValidation, record.workingRevision),
    simulation: evidenceFreshness(record.latestSimulation, record.workingRevision),
    runtime: evidenceFreshness(record.runtimeTraces?.at(-1), record.workingRevision),
  };
}

function reviewFor(record: ChangeRecord | undefined): NonNullable<SessionDescription['review']> {
  const integration = record?.integration;
  const review = integration?.review;
  const binding = review?.binding;
  if (review === undefined || binding === undefined || binding.reviewState === 'unreviewed') {
    return { reviewState: 'unreviewed' };
  }
  const resultReview = review.resultReview;
  if (resultReview === undefined) {
    return {
      reviewState: 'human-reviewed',
      reviewId: binding.reviewId,
    };
  }
  if (review.approval === undefined) {
    return {
      reviewState: 'awaiting-approval',
      reviewId: binding.reviewId,
      resultReviewId: resultReview.reviewId,
      waitingFor: 'human-approval',
    };
  }
  return {
    reviewState: 'owner-approved',
    reviewId: binding.reviewId,
    resultReviewId: resultReview.reviewId,
  };
}

function capabilityAvailability(
  policy: AutonomyPolicy,
  activeChangeId: string | undefined,
  activeRecord: ChangeRecord | undefined,
  capability: (typeof AUTHORING_CAPABILITY_REGISTRY)[number],
  humanWorkspace: HumanWorkspaceSummary,
): SessionCapability {
  let availability: CapabilityAvailability;
  let reason: string | undefined;
  if (!isCapabilityAllowed(policy, capability)) {
    availability = 'policy-blocked';
    reason = `启动 policy '${policy}' 低于最低要求 '${capability.minimumPolicy}'`;
  } else if (capability.id === 'change.begin' && activeChangeId !== undefined) {
    availability = 'state-blocked';
    reason = '当前 session 已有 active change';
  } else if (activeChangeId !== undefined && ['asset.import.stage', 'asset.import.commit', 'asset.import.recover'].includes(capability.id)) {
    availability = 'state-blocked';
    reason = '先导入素材并刷新项目事实，再创建剧情 change';
  } else if (capability.id === 'composition.execute' && activeRecord !== undefined && activeRecord.integration === undefined) {
    // Wave 5：普通 active change 占用 session 时拒绝执行；无 active 或 integration resume 均 available。
    availability = 'state-blocked';
    reason = '当前 session 已有普通 active change，不能执行集成；先提交或回滚该 change';
  } else if (activeChangeId === undefined && changeRequired(capability.id)) {
    availability = 'state-blocked';
    reason = '需要 active change context';
  } else if (capability.id === 'change.recovery.inspect' && activeRecord !== undefined) {
    availability = 'available';
  } else if (capability.id === 'change.recovery.execute' && activeRecord?.status === 'STALE') {
    availability = 'available';
  } else if (activeRecord !== undefined
    && activeRecord.status !== 'OPEN') {
    availability = 'state-blocked';
    reason = `当前 change 状态 '${activeRecord.status}' 需要先使用 recovery capability`;
  } else if (['change.commit', 'asset.import.commit', 'asset.import.recover'].includes(capability.id) && humanWorkspaceCommitBlock(humanWorkspace) !== null) {
    availability = 'state-blocked';
    reason = `human-workspace-${humanWorkspace.availability}`;
  } else {
    availability = 'available';
  }
  return {
    id: capability.id,
    mcpTool: nativeCapabilityToMcpTool(capability.id),
    availability,
    ...(reason === undefined ? {} : { reason }),
  };
}

function evidenceIdsFromValue(value: unknown, key = '', depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (key === 'evidenceId' || key === 'traceId') return typeof value === 'string' ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => evidenceIdsFromValue(item, '', depth + 1));
  if (typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([childKey, childValue]) => evidenceIdsFromValue(childValue, childKey, depth + 1));
}

function evidenceIdsFromRecord(record: ChangeRecord | undefined): string[] {
  if (record === undefined) return [];
  return [
    record.latestValidation?.evidenceId,
    record.latestSimulation?.evidenceId,
    record.latestDiff?.evidenceId,
    ...(record.runtimeTraces ?? []).map((trace) => trace.traceId),
  ].filter((value): value is string => value !== undefined);
}

function leaseSummary(inspection: LeaseInspection): SessionLeaseSummary {
  return {
    state: inspection.state,
    ...(inspection.holder === undefined ? {} : { holder: inspection.holder }),
    ...(inspection.retryAfterMs === undefined ? {} : { retryAfterMs: inspection.retryAfterMs }),
    manualRecoveryRequired: inspection.manualRecoveryRequired,
  };
}

export class AgentPortSession {
  private activeChangeIdValue?: string;
  private lastChangeIdValue?: string;
  private invocationTail: Promise<void> = Promise.resolve();
  private readonly leaseManager = new NodeLocalLeaseManager();
  private readonly humanWorkspaceStore = new HumanWorkspaceStore({ dataRoot: this.leaseManager.dataRoot });
  private readonly mutationNoticeStore = new ProjectMutationNoticeStore({ dataRoot: this.leaseManager.dataRoot });

  constructor(
    readonly sessionId: string,
    readonly projectRoot: string,
    readonly projectIdentity: string,
    readonly policy: AutonomyPolicy,
    readonly openedProjectRevision: string,
    private readonly projectName: string,
    private readonly startedAt: string,
    private readonly wasResumed: boolean,
    activeChangeId?: string,
    private readonly service = new AuthoringService(),
    private readonly assetSources: readonly AuthorizedImageSource[] = [],
    private readonly assetImportDataRoot?: string,
  ) {
    this.activeChangeIdValue = activeChangeId;
    this.lastChangeIdValue = activeChangeId;
  }

  get activeChangeId(): string | undefined {
    return this.activeChangeIdValue;
  }

  get lastChangeId(): string | undefined {
    return this.lastChangeIdValue;
  }

  canExposeDeliveryCapsule(): boolean {
    if (this.policy === 'observe') return this.wasResumed && this.activeChangeIdValue !== undefined;
    return this.lastChangeIdValue !== undefined;
  }

  private async activeOpenedChange(): Promise<NonNullable<Awaited<ReturnType<typeof NodeChangeStore.openForProject>>> | undefined> {
    if (this.activeChangeIdValue === undefined) return undefined;
    const opened = await NodeChangeStore.openForProject(this.activeChangeIdValue, this.projectRoot, { allowStale: true, allowTerminal: true });
    if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${this.activeChangeIdValue}`);
    return opened;
  }

  private async activeRecord(): Promise<ChangeRecord | undefined> {
    return (await this.activeOpenedChange())?.record;
  }

  private async commitEvidenceGate(): Promise<void> {
    const record = await this.activeRecord();
    if (record === undefined) throw stateBlocked('change.commit');
    assertCurrentCommitEvidence(record);
  }

  private context(capability: AuthoringCapabilityId): {
    sessionId: string;
    policy: AutonomyPolicy;
    projectRoot: string;
    activeChangeId?: string;
    assetSources: readonly AuthorizedImageSource[];
    assetImportDataRoot?: string;
  } {
    return {
      sessionId: this.sessionId,
      policy: this.policy,
      projectRoot: this.projectRoot,
      assetSources: this.assetSources,
      ...(this.assetImportDataRoot === undefined ? {} : { assetImportDataRoot: this.assetImportDataRoot }),
      ...(this.activeChangeIdValue === undefined ? {} : { activeChangeId: this.activeChangeIdValue }),
    };
  }

  private failure(capability: AuthoringCapabilityId, error: unknown): AuthoringEnvelope<never> {
    return createFailureEnvelope({
      sessionId: this.sessionId,
      capability,
      projectIdentity: this.projectIdentity,
      projectRevision: this.openedProjectRevision,
      ...(this.activeChangeIdValue === undefined ? {} : { changeId: this.activeChangeIdValue }),
    }, error);
  }

  async invoke(capability: AuthoringCapabilityId, input: Record<string, unknown>): Promise<AuthoringEnvelope<unknown>> {
    const previous = this.invocationTail;
    let release!: () => void;
    this.invocationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.invokeSerial(capability, input);
    } finally {
      release();
    }
  }

  private async invokeSerial(capability: AuthoringCapabilityId, input: Record<string, unknown>): Promise<AuthoringEnvelope<unknown>> {
    const beforeChangeId = this.activeChangeIdValue;
    let beforeRecord: ChangeRecord | undefined;
    let envelope: AuthoringEnvelope<unknown> | undefined;
    let operationId = typeof input['operationId'] === 'string' ? input['operationId'] : undefined;
    let invocationRecorded = false;

    const dispatchOnce = async (service: AuthoringService): Promise<AuthoringEnvelope<unknown>> => {
      const definition = getCapabilityDefinition(capability);
      if (!isCapabilityAllowed(this.policy, definition)) throw policyBlocked(capability, this.policy);
      if (capability === 'change.begin' && this.activeChangeIdValue !== undefined) {
        throw new AuthoringOperationError('SESSION_STATE_INVALID', '当前 session 已有 active change');
      }
      if (changeRequired(capability) && this.activeChangeIdValue === undefined) throw stateBlocked(capability);
      const currentRecord = this.activeChangeIdValue === undefined ? undefined : await this.activeRecord();
      if (currentRecord !== undefined
        && currentRecord.status !== 'OPEN'
        && capability !== 'change.recovery.inspect'
        && !(capability === 'change.recovery.execute' && currentRecord.status === 'STALE')) {
        throw stateBlocked(capability);
      }
      if (capability === 'change.commit') await this.commitEvidenceGate();

      if (capability === 'composition.execute' && this.activeChangeIdValue !== undefined) {
        const executing = await this.activeRecord();
        if (executing?.integration === undefined) throw stateBlocked(capability);
      }
      const dispatched = await dispatchAuthoringCapability(this.context(capability), capability, input, service);
      operationId = dispatched.operationId ?? operationId;
      const value = dispatched.value;
      if (capability === 'composition.execute') {
        const result = (value.result ?? {}) as { integrationChangeId?: unknown };
        const integrationChangeId = result.integrationChangeId;
        if (typeof integrationChangeId !== 'string' || integrationChangeId.length === 0) {
          throw new AuthoringOperationError('SESSION_STATE_INVALID', 'composition.execute 未返回有效 integrationChangeId');
        }
        this.activeChangeIdValue = integrationChangeId;
        this.lastChangeIdValue = integrationChangeId;
      } else if (capability === 'change.begin') {
        const changeId = (value.result as { changeId?: unknown }).changeId;
        if (typeof changeId !== 'string' || changeId.length === 0) throw new AuthoringOperationError('SESSION_STATE_INVALID', 'change.begin 未返回有效 changeId');
        this.activeChangeIdValue = changeId;
        this.lastChangeIdValue = changeId;
      } else if (capability === 'change.commit' || capability === 'change.rollback') {
        this.lastChangeIdValue = this.activeChangeIdValue;
        this.activeChangeIdValue = undefined;
      }
      return createSuccessEnvelope({
        sessionId: this.sessionId,
        capability,
        projectIdentity: value.projectIdentity,
        projectRevision: value.projectRevision,
        ...(value.changeId === undefined ? {} : { changeId: value.changeId }),
        ...(value.workingRevision === undefined ? {} : { workingRevision: value.workingRevision }),
        ...(dispatched.operationId === undefined ? {} : { operationId: dispatched.operationId }),
      }, value.result);
    };

    const writeInvocationFact = async (
      store: NodeChangeStore,
      changeId: string,
      currentEnvelope: AuthoringEnvelope<unknown>,
      factBeforeRecord = beforeRecord,
    ): Promise<void> => {
      const afterRecord = await store.read(changeId);
      if (afterRecord === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
      await recordInvocation(store, changeId, {
        sessionId: this.sessionId,
        capability,
        ...(operationId === undefined ? {} : { operationId }),
        ok: currentEnvelope.ok,
        ...(currentEnvelope.ok ? {} : { errorCode: currentEnvelope.error.code }),
        ...(factBeforeRecord?.baseRevision === undefined ? {} : { projectRevisionBefore: factBeforeRecord.baseRevision }),
        ...(currentEnvelope.projectRevision === undefined ? {} : { projectRevisionAfter: currentEnvelope.projectRevision }),
        ...(factBeforeRecord?.workingRevision === undefined ? {} : { workingRevisionBefore: factBeforeRecord.workingRevision }),
        workingRevisionAfter: afterRecord.workingRevision,
        input,
        evidenceIds: [
          ...evidenceIdsFromValue(currentEnvelope.ok ? currentEnvelope.result : currentEnvelope.error.details),
          ...evidenceIdsFromRecord(afterRecord),
        ],
      });
    };

    try {
      const beforeOpened = beforeChangeId === undefined
        ? undefined
        : await NodeChangeStore.openForProject(beforeChangeId, this.projectRoot, { allowStale: true, allowTerminal: true });
      beforeRecord = beforeOpened?.record;
      const recoveryCapability = capability === 'change.recovery.inspect' || capability === 'change.recovery.execute';
      if (beforeChangeId !== undefined && changeRequired(capability) && !recoveryCapability && capability !== 'change.commit') {
        await withChangeLeaseRetry(beforeChangeId, async (leasedStore) => {
          const leaseBeforeRecord = await leasedStore.read(beforeChangeId);
          if (leaseBeforeRecord === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${beforeChangeId}`);
          try {
            envelope = await dispatchOnce(this.service.withLeasedStore(leasedStore));
          } catch (error) {
            envelope = this.failure(capability, error);
          }
          try {
            await writeInvocationFact(leasedStore, beforeChangeId, envelope!, leaseBeforeRecord);
            invocationRecorded = true;
          } catch (error) {
            envelope = this.failure(capability, new AuthoringOperationError(
              'INVOCATION_LEDGER_WRITE_FAILED',
              `调用事实记录写入失败：${error instanceof Error ? error.message : String(error)}`,
              {
                operationMayHaveSucceeded: envelope!.ok,
                invocationResult: envelope,
                ...(operationId === undefined ? {} : { operationId }),
                changeId: beforeChangeId,
              },
            ));
            invocationRecorded = true;
          }
        });
      } else {
        try {
          envelope = await dispatchOnce(this.service);
        } catch (error) {
          envelope = this.failure(capability, error);
        }
      }
    } catch (error) {
      envelope = this.failure(capability, error);
    }

    if (envelope === undefined) {
      envelope = this.failure(capability, new AuthoringOperationError('SESSION_STATE_INVALID', 'capability 未产生结果 envelope'));
    }
    const changeId = envelope.changeId ?? beforeChangeId;
    if (changeId !== undefined && !invocationRecorded) {
      try {
        await withChangeLeaseRetry(changeId, async (invocationStore) => {
          await writeInvocationFact(invocationStore, changeId, envelope!);
        });
      } catch (error) {
        return this.failure(capability, new AuthoringOperationError(
          'INVOCATION_LEDGER_WRITE_FAILED',
          `调用事实记录写入失败：${error instanceof Error ? error.message : String(error)}`,
          {
            operationMayHaveSucceeded: envelope.ok,
            invocationResult: envelope,
            ...(operationId === undefined ? {} : { operationId }),
            changeId,
          },
        ));
      }
    }
    return envelope;
  }

  async generateDeliveryCapsule(label?: string): Promise<SealedDeliveryCapsule> {
    if (!this.canExposeDeliveryCapsule()) {
      throw new AuthoringOperationError('SESSION_STATE_INVALID', '当前 session 没有允许生成 delivery capsule 的 resumed/open change');
    }
    return generateDeliveryCapsule(this, label);
  }

  async describe(): Promise<SessionDescription> {
    const { summary: humanWorkspace } = await this.humanWorkspaceStore.inspect(this.projectRoot);
    const assetRecoveryRequired = await new AssetImportRecordStore(
      await openAssetImportAuthorityPaths({ projectRoot: this.projectRoot, dataRoot: this.assetImportDataRoot }),
    ).hasUnresolvedBarrier();
    // A notice is only a hint. Its loss cannot hide workspace state or prevent re-inspection.
    const projectMutation = await this.mutationNoticeStore.readLatest(this.projectRoot).catch(() => null);
    const opened = await this.activeOpenedChange();
    const record = opened?.record;
    const changeLease = this.activeChangeIdValue === undefined
      ? { state: 'free' as const, manualRecoveryRequired: false }
      : leaseSummary(await this.leaseManager.inspect('change', this.activeChangeIdValue));
    const projectLease = leaseSummary(await this.leaseManager.inspect('project', this.projectRoot));
    let journal: SessionJournalSummary = { recordState: 'missing', manualRecoveryRequired: false };
    let recoveryDisposition: RecoveryDisposition = 'NO_ACTION';
    if (opened !== undefined && record !== undefined) {
      try {
        const latest = await opened.store.readLatestJournal(record.changeId);
        if (latest !== null) {
          journal = {
            recordState: 'readable',
            status: latest.status,
            journalVersion: latest.journalVersion,
            manualRecoveryRequired: latest.status === 'RECOVERY_FAILED',
          };
        }
      } catch (error) {
        const normalized = normalizeAuthoringError(error);
        journal = {
          recordState: normalized.code === 'CHANGE_STORE_FORMAT_UNSUPPORTED' ? 'unsupported' : 'corrupt',
          errorCode: normalized.code,
          manualRecoveryRequired: true,
        };
        recoveryDisposition = 'MANUAL_RECOVERY_REQUIRED';
      }
      try {
        const recovery = await this.service.inspectRecovery(record.changeId);
        recoveryDisposition = recovery.result.disposition;
        if (journal.recordState === 'missing' && recovery.result.journalStatus !== undefined) {
          journal = {
            recordState: 'readable',
            status: recovery.result.journalStatus,
            manualRecoveryRequired: recovery.result.manualRecoveryRequired,
          };
        }
      } catch (error) {
        const normalized = normalizeAuthoringError(error);
        journal = {
          ...journal,
          recordState: normalized.code === 'CHANGE_STORE_FORMAT_UNSUPPORTED' ? 'unsupported' : 'corrupt',
          errorCode: normalized.code,
          manualRecoveryRequired: true,
        };
        recoveryDisposition = 'MANUAL_RECOVERY_REQUIRED';
      }
    }
    const capabilities = AUTHORING_CAPABILITY_REGISTRY.map((definition) => capabilityAvailability(this.policy, this.activeChangeIdValue, record, definition, humanWorkspace));
    if (assetRecoveryRequired) {
      for (const capability of capabilities) {
        if (capability.availability === 'available'
          && ['asset.import.stage', 'asset.import.commit', 'change.commit'].includes(capability.id)) {
          capability.availability = 'state-blocked';
          capability.reason = '素材操作存在未解决的恢复屏障，请先检查原操作并明确恢复';
        }
      }
    }
    const activeIntegration = record?.integration;
    const candidateReadiness = record === undefined ? undefined : inspectCandidateCompositionReadiness(record);
    const review = reviewFor(record);
    const activeChange = record === undefined
      ? undefined
      : {
          changeId: record.changeId,
          status: record.status,
          baseRevision: record.baseRevision,
          workingRevision: record.workingRevision,
          recordVersion: record.recordVersion,
          ...(record.composition === undefined ? {} : { compositionMode: record.composition.mode }),
          ...(activeIntegration === undefined ? {} : {
            integration: {
              planId: activeIntegration.planId,
              status: activeIntegration.status,
              nextOperationIndex: activeIntegration.nextOperationIndex,
              operationCount: activeIntegration.replayedOperations.length,
            },
          }),
        };
    const nextActions = this.activeChangeIdValue === undefined
      ? this.policy === 'observe'
        ? ['project.inspect', 'project.validate', 'project.simulate']
        : activeIntegration !== undefined ? [] : ['change.begin']
      : record?.integration?.status === 'FAILED'
        ? ['change.diff', 'change.rollback']
        : record?.integration?.status === 'REPLAYING'
          ? ['composition.execute', 'change.diff']
          : record?.integration?.status === 'READY'
            ? ['project.validate', 'project.simulate', 'runtime.run-from', 'change.diff',
               ...(review.reviewState === 'human-reviewed' ? ['review.prepare-result'] : []),
               ...(review.reviewState === 'awaiting-approval' ? ['review.inspect-approval'] : []),
               ...(activeIntegration === undefined && this.policy === 'apply' ? ['change.commit'] as string[] : []),
               ...(review.reviewState === 'owner-approved' && this.policy === 'apply' ? ['change.commit'] as string[] : [])]
            : record?.status === 'STALE'
              ? ['change.recovery.inspect', ...(this.policy === 'apply' ? ['change.recovery.execute'] : [])]
              : record?.status === 'COMMITTED' || record?.status === 'ROLLED_BACK'
                ? ['change.recovery.inspect']
                : candidateReadiness?.status === 'blocked' || candidateReadiness?.status === 'legacy-unavailable'
                  ? ['change.diff', 'change.rollback']
                  : ['project.validate', 'project.simulate', 'runtime.run-from', 'change.diff'];
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      engineVersion: engineVersion(),
      contractVersion: AUTHORING_CONTRACT_VERSION,
      projectIdentity: this.projectIdentity,
      projectName: this.projectName,
      projectRevision: this.openedProjectRevision,
      humanWorkspace,
      ...(projectMutation === null ? {} : { projectMutation }),
      policy: this.policy,
      review,
      ...(activeChange === undefined ? {} : { activeChange }),
      ...(candidateReadiness === undefined ? {} : { candidateReadiness }),
      resumed: this.wasResumed,
      capabilities,
      evidence: evidenceFor(record),
      lease: { change: changeLease, project: projectLease },
      journal,
      recoveryDisposition: assetRecoveryRequired ? 'MANUAL_RECOVERY_REQUIRED' : recoveryDisposition,
      manualRecoveryRequired: record?.status === 'STALE'
        || assetRecoveryRequired
        || journal.manualRecoveryRequired
        || changeLease.manualRecoveryRequired
        || projectLease.manualRecoveryRequired
        || humanWorkspace.blockedReasons.some(reason => reason === 'workspace-state-corrupt' || reason === 'write-settlement-failed')
        || recoveryDisposition === 'MANUAL_RECOVERY_REQUIRED',
      nextActions: assetRecoveryRequired ? ['asset.import.inspect', ...(this.policy === 'apply' ? ['asset.import.recover'] : [])]
        : humanWorkspaceCommitBlock(humanWorkspace) === null
        ? nextActions
        : humanWorkspace.availability === 'blocked' && humanWorkspace.retryAfterMs === undefined
          ? []
          : ['session.describe'],
    };
  }

  async close(): Promise<void> {
    // Port resources are process-local. Closing never mutates or rolls back the
    // OPEN transaction; a later process must resume it explicitly.
  }
}

export async function openAgentPortSession(options: AgentPortOptions): Promise<AgentPortSession> {
  if (options.requestedContractVersion !== undefined && options.requestedContractVersion !== AUTHORING_CONTRACT_VERSION) {
    throw new AuthoringOperationError('CONTRACT_VERSION_UNSUPPORTED', `不支持的 authoring contract version：${options.requestedContractVersion}`);
  }
  const storage = await NodeProjectStorage.open(options.projectRoot);
  const snapshot = await loadProjectSnapshot(storage, { sha256: async (text) => hashText(text) });
  let resumedChangeId: string | undefined;
  if (options.resumeChangeId !== undefined) {
    const discovered = await NodeChangeStore.openByChangeId(options.resumeChangeId);
    if (discovered !== null
      && projectIdentityFromRoot(discovered.record.projectRootIdentity) !== projectIdentityFromRoot(storage.rootIdentity)) {
      throw new AuthoringOperationError('PROJECT_IDENTITY_MISMATCH', `变更事务 '${options.resumeChangeId}' 不属于当前项目`);
    }
    const opened = await NodeChangeStore.openForProject(options.resumeChangeId, storage.rootIdentity, { allowStale: true, allowTerminal: true });
    if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${options.resumeChangeId}`);
    resumedChangeId = opened.record.changeId;
  }
  return new AgentPortSession(
    `agent_${crypto.randomUUID()}`,
    storage.rootIdentity,
    projectIdentityFromRoot(storage.rootIdentity),
    options.policy,
    snapshot.revision,
    path.basename(storage.rootIdentity),
    new Date().toISOString(),
    resumedChangeId !== undefined,
    resumedChangeId,
    undefined,
    await authorizeImageSources(options.assetSources ?? []),
    options.assetImportDataRoot ?? process.env['SURDET_EDITOR_ASSET_IMPORT_DATA_ROOT'],
  );
}
