import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  AUTHORING_CAPABILITY_REGISTRY,
  AUTHORING_CONTRACT_VERSION,
  AuthoringOperationError,
  createFailureEnvelope,
  createSuccessEnvelope,
  evidenceFreshness,
  getCapabilityDefinition,
  loadProjectSnapshot,
  nativeCapabilityToMcpTool,
  normalizeAuthoringError,
  type AuthoringCapabilityId,
  type AuthoringEnvelope,
  type AutonomyPolicy,
  type CapabilityAvailability,
  type ChangeRecord,
  type EvidenceFreshness,
} from '@surdet/authoring';
import { dispatchAuthoringCapability } from '../authoring/authoring-dispatcher.js';
import { AuthoringService } from '../authoring/authoring-service.js';
import { NodeChangeStore } from '../authoring/node-change-store.js';
import { NodeProjectStorage } from '../authoring/node-project-storage.js';
import { projectIdentityFromRoot } from '../authoring/project-identity.js';
import { recordInvocation } from './invocation-ledger.js';
import { generateDeliveryCapsule, type SealedDeliveryCapsule } from './delivery-capsule.js';
import { isCapabilityAllowed } from './policy.js';
import type { AgentPortOptions } from './args.js';

export interface SessionCapability {
  id: AuthoringCapabilityId;
  mcpTool: string;
  availability: CapabilityAvailability;
  reason?: string;
}

export interface SessionDescription {
  sessionId: string;
  startedAt: string;
  engineVersion: string;
  contractVersion: typeof AUTHORING_CONTRACT_VERSION;
  projectIdentity: string;
  projectName: string;
  projectRevision: string;
  policy: AutonomyPolicy;
  activeChange?: {
    changeId: string;
    status: ChangeRecord['status'];
    baseRevision: string;
    workingRevision: number;
  };
  resumed: boolean;
  capabilities: SessionCapability[];
  evidence: {
    validation?: EvidenceFreshness;
    simulation?: EvidenceFreshness;
    runtime?: EvidenceFreshness;
  };
  manualRecoveryRequired: boolean;
  nextActions: string[];
}

const ACTIVE_CHANGE_CAPABILITIES = new Set<AuthoringCapabilityId>([
  'scene.create',
  'scene.patch',
  'variable.ensure',
  'character.ensure',
  'character.remove',
  'timeline.create',
  'timeline.patch',
  'project.entry-scene.set',
  'runtime.run-from',
  'runtime.read-trace',
  'change.diff',
  'change.commit',
  'change.rollback',
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
  return new AuthoringOperationError('SESSION_STATE_INVALID', `capability '${capability}' 需要 active OPEN change`);
}

function evidenceFor(record: ChangeRecord | undefined): SessionDescription['evidence'] {
  if (record === undefined) return {};
  return {
    validation: evidenceFreshness(record.latestValidation, record.workingRevision),
    simulation: evidenceFreshness(record.latestSimulation, record.workingRevision),
    runtime: evidenceFreshness(record.runtimeTraces?.at(-1), record.workingRevision),
  };
}

function capabilityAvailability(
  policy: AutonomyPolicy,
  activeChangeId: string | undefined,
  capability: (typeof AUTHORING_CAPABILITY_REGISTRY)[number],
): SessionCapability {
  let availability: CapabilityAvailability;
  let reason: string | undefined;
  if (!isCapabilityAllowed(policy, capability)) {
    availability = 'policy-blocked';
    reason = `启动 policy '${policy}' 低于最低要求 '${capability.minimumPolicy}'`;
  } else if (capability.id === 'change.begin' && activeChangeId !== undefined) {
    availability = 'state-blocked';
    reason = '当前 session 已有 active change';
  } else if (changeRequired(capability.id) && activeChangeId === undefined) {
    availability = 'state-blocked';
    reason = '需要 active OPEN change';
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

export class AgentPortSession {
  private activeChangeIdValue?: string;
  private lastChangeIdValue?: string;

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

  private async activeRecord(): Promise<ChangeRecord | undefined> {
    if (this.activeChangeIdValue === undefined) return undefined;
    const opened = await NodeChangeStore.openOwnedChange(this.activeChangeIdValue, this.projectRoot);
    if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${this.activeChangeIdValue}`);
    return opened.record;
  }

  private async commitEvidenceGate(): Promise<void> {
    const record = await this.activeRecord();
    if (record === undefined) throw stateBlocked('change.commit');
    if (record.latestValidation === undefined) throw new AuthoringOperationError('VALIDATION_REQUIRED', '提交前缺少校验证据');
    if (record.latestValidation.workingRevision !== record.workingRevision) {
      throw new AuthoringOperationError('VALIDATION_STALE', '提交前校验证据不是当前 workingRevision');
    }
    if (record.latestValidation.errors !== 0) throw new AuthoringOperationError('VALIDATION_FAILED', '提交前校验仍有 error');
    if (record.latestSimulation === undefined) throw new AuthoringOperationError('SIMULATION_REQUIRED', '提交前缺少模拟证据');
    if (record.latestSimulation.workingRevision !== record.workingRevision) {
      throw new AuthoringOperationError('SIMULATION_REQUIRED', '提交前模拟证据不是当前 workingRevision');
    }
    if (record.latestSimulation.status === 'incomplete') {
      throw new AuthoringOperationError('SIMULATION_INCOMPLETE', '提交前模拟未完成');
    }
    if (record.latestSimulation.status !== 'passed') {
      throw new AuthoringOperationError('SIMULATION_REQUIRED', '提交前模拟未通过');
    }
    if (!record.runtimeTraces?.some((trace) => trace.status === 'passed' && trace.workingRevision === record.workingRevision)) {
      throw new AuthoringOperationError('RUNTIME_EVIDENCE_REQUIRED', '提交前缺少当前 workingRevision 的 runtime trace');
    }
  }

  private context(capability: AuthoringCapabilityId): {
    sessionId: string;
    policy: AutonomyPolicy;
    projectRoot: string;
    activeChangeId?: string;
  } {
    return {
      sessionId: this.sessionId,
      policy: this.policy,
      projectRoot: this.projectRoot,
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
    const beforeChangeId = this.activeChangeIdValue;
    const beforeOpened = beforeChangeId === undefined ? undefined : await NodeChangeStore.openByChangeId(beforeChangeId);
    const beforeRecord = beforeOpened?.record;
    let envelope: AuthoringEnvelope<unknown>;
    let operationId: string | undefined;
    try {
      const definition = getCapabilityDefinition(capability);
      if (!isCapabilityAllowed(this.policy, definition)) throw policyBlocked(capability, this.policy);
      if (capability === 'change.begin' && this.activeChangeIdValue !== undefined) {
        throw new AuthoringOperationError('SESSION_STATE_INVALID', '当前 session 已有 active change');
      }
      if (changeRequired(capability) && this.activeChangeIdValue === undefined) throw stateBlocked(capability);
      if (capability === 'change.commit') await this.commitEvidenceGate();

      const dispatched = await dispatchAuthoringCapability(this.context(capability), capability, input, this.service);
      operationId = dispatched.operationId ?? (typeof input['operationId'] === 'string' ? input['operationId'] : undefined);
      const value = dispatched.value;
      if (capability === 'change.begin') {
        const changeId = (value.result as { changeId?: unknown }).changeId;
        if (typeof changeId !== 'string' || changeId.length === 0) throw new AuthoringOperationError('SESSION_STATE_INVALID', 'change.begin 未返回有效 changeId');
        this.activeChangeIdValue = changeId;
        this.lastChangeIdValue = changeId;
      } else if (capability === 'change.commit' || capability === 'change.rollback') {
        this.lastChangeIdValue = this.activeChangeIdValue;
        this.activeChangeIdValue = undefined;
      }
      envelope = createSuccessEnvelope({
        sessionId: this.sessionId,
        capability,
        projectIdentity: value.projectIdentity,
        projectRevision: value.projectRevision,
        ...(value.changeId === undefined ? {} : { changeId: value.changeId }),
        ...(value.workingRevision === undefined ? {} : { workingRevision: value.workingRevision }),
        ...(dispatched.operationId === undefined ? {} : { operationId: dispatched.operationId }),
      }, value.result);
    } catch (error) {
      envelope = this.failure(capability, error);
    }

    const changeId = envelope.changeId ?? beforeChangeId;
    if (changeId !== undefined) {
      try {
        const afterOpened = await NodeChangeStore.openByChangeId(changeId);
        const afterRecord = afterOpened?.record;
        const invocationStore = afterOpened?.store ?? beforeOpened?.store;
        if (invocationStore === undefined) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
        await recordInvocation(invocationStore, changeId, {
          sessionId: this.sessionId,
          capability,
          ...(operationId === undefined ? {} : { operationId }),
          ok: envelope.ok,
          ...(envelope.ok ? {} : { errorCode: envelope.error.code }),
          ...(beforeRecord?.baseRevision === undefined ? {} : { projectRevisionBefore: beforeRecord.baseRevision }),
          ...(envelope.projectRevision === undefined ? {} : { projectRevisionAfter: envelope.projectRevision }),
          ...(beforeRecord?.workingRevision === undefined ? {} : { workingRevisionBefore: beforeRecord.workingRevision }),
          ...(afterRecord?.workingRevision === undefined ? {} : { workingRevisionAfter: afterRecord.workingRevision }),
          input,
          evidenceIds: [
            ...evidenceIdsFromValue(envelope.ok ? envelope.result : undefined),
            ...evidenceIdsFromRecord(afterRecord),
          ],
        });
      } catch (error) {
        return this.failure(capability, new AuthoringOperationError(
          'INVOCATION_LEDGER_WRITE_FAILED',
          `调用事实记录写入失败：${error instanceof Error ? error.message : String(error)}`,
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
    const record = await this.activeRecord();
    const capabilities = AUTHORING_CAPABILITY_REGISTRY.map((definition) => capabilityAvailability(this.policy, this.activeChangeIdValue, definition));
    const activeChange = record === undefined
      ? undefined
      : {
          changeId: record.changeId,
          status: record.status,
          baseRevision: record.baseRevision,
          workingRevision: record.workingRevision,
        };
    const nextActions = this.activeChangeIdValue === undefined
      ? this.policy === 'observe' ? ['project.inspect', 'project.validate', 'project.simulate'] : ['change.begin']
      : ['project.validate', 'project.simulate', 'runtime.run-from', 'change.diff'];
    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      engineVersion: engineVersion(),
      contractVersion: AUTHORING_CONTRACT_VERSION,
      projectIdentity: this.projectIdentity,
      projectName: this.projectName,
      projectRevision: this.openedProjectRevision,
      policy: this.policy,
      ...(activeChange === undefined ? {} : { activeChange }),
      resumed: this.wasResumed,
      capabilities,
      evidence: evidenceFor(record),
      manualRecoveryRequired: record?.status === 'STALE',
      nextActions,
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
    const opened = await NodeChangeStore.openOwnedChange(options.resumeChangeId, storage.rootIdentity);
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
  );
}
