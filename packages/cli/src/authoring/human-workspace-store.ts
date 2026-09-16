import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AuthoringOperationError,
  HUMAN_WORKSPACE_BLOCKED_REASONS,
  HUMAN_WORKSPACE_BUSY_REASONS,
  HUMAN_WORKSPACE_CONTRACT_VERSION,
  HUMAN_WORKSPACE_DIRTY_SCOPES,
  aggregateHumanWorkspaceObservations,
  type HumanWorkspaceBlockedReason,
  type HumanWorkspaceBusyReason,
  type HumanWorkspaceDirtyScope,
  type HumanWorkspaceObservation,
  type HumanWorkspaceReportedAvailability,
  type HumanWorkspaceSummary,
} from '@surdet/authoring';
import { createJsonRecord, readJsonRecord, replaceJsonRecord } from './node-json-record.js';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { projectIdentityFromRoot } from './project-identity.js';

export interface HumanWorkspaceRecord {
  formatVersion: 1;
  workspaceContractVersion: typeof HUMAN_WORKSPACE_CONTRACT_VERSION;
  workspaceSessionId: string;
  browserSessionId: string;
  projectRootIdentity: string;
  workspaceGeneration: number;
  availability: HumanWorkspaceReportedAvailability;
  loadedProjectRevision?: string;
  loadedCoordinationRevision?: string;
  dirtyScopes: HumanWorkspaceDirtyScope[];
  busyReasons: HumanWorkspaceBusyReason[];
  blockedReasons: HumanWorkspaceBlockedReason[];
  heartbeatAt: string;
}

export interface HumanWorkspaceHeartbeatInput {
  workspaceSessionId: string;
  browserSessionId: string;
  workspaceGeneration: number;
  availability: HumanWorkspaceReportedAvailability;
  loadedProjectRevision?: string;
  loadedCoordinationRevision?: string;
  dirtyScopes?: readonly HumanWorkspaceDirtyScope[];
  busyReasons?: readonly HumanWorkspaceBusyReason[];
  blockedReasons?: readonly HumanWorkspaceBlockedReason[];
}

export interface HumanWorkspaceStoreInspection {
  summary: HumanWorkspaceSummary;
  observations: HumanWorkspaceObservation[];
}

export interface HumanWorkspaceStoreOptions {
  now?: () => number;
  activeWindowMs?: number;
  graceWindowMs?: number;
  dataRoot?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_BROWSER_SESSION = /^[A-Za-z0-9._:-]{1,160}$/;

function sameRoot(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function validStringUnion<T extends string>(
  values: readonly unknown[],
  allowed: readonly T[],
): values is T[] {
  return values.every((value) => typeof value === 'string' && allowed.includes(value as T));
}

function stateError(message: string, details: Record<string, unknown> = {}): AuthoringOperationError {
  return new AuthoringOperationError('HUMAN_WORKSPACE_STATE_CORRUPT', message, {
    ...details,
    manualRecoveryRequired: true,
  });
}

function normalizeInput(input: HumanWorkspaceHeartbeatInput): Omit<HumanWorkspaceRecord, 'formatVersion' | 'workspaceContractVersion' | 'projectRootIdentity' | 'heartbeatAt'> {
  const dirtyScopes = [...new Set(input.dirtyScopes ?? [])].sort();
  const busyReasons = [...new Set(input.busyReasons ?? [])].sort();
  const blockedReasons = [...new Set(input.blockedReasons ?? [])].sort();
  if (!UUID.test(input.workspaceSessionId)) throw stateError('workspaceSessionId 格式无效');
  if (!SAFE_BROWSER_SESSION.test(input.browserSessionId)) throw stateError('browserSessionId 格式无效');
  if (!Number.isSafeInteger(input.workspaceGeneration) || input.workspaceGeneration < 0) {
    throw stateError('workspaceGeneration 格式无效');
  }
  if (!['clean', 'dirty', 'busy', 'blocked'].includes(input.availability)) {
    throw stateError('workspace availability 无效');
  }
  if (input.loadedProjectRevision !== undefined && !SHA256.test(input.loadedProjectRevision)) {
    throw stateError('loadedProjectRevision 格式无效');
  }
  if (input.loadedCoordinationRevision !== undefined && !SHA256.test(input.loadedCoordinationRevision)) {
    throw stateError('loadedCoordinationRevision 格式无效');
  }
  if (!validStringUnion(dirtyScopes, HUMAN_WORKSPACE_DIRTY_SCOPES)
    || !validStringUnion(busyReasons, HUMAN_WORKSPACE_BUSY_REASONS)
    || !validStringUnion(blockedReasons, HUMAN_WORKSPACE_BLOCKED_REASONS)) {
    throw stateError('workspace reason 或 dirty scope 无效');
  }
  if (input.availability === 'clean' && (dirtyScopes.length > 0 || busyReasons.length > 0 || blockedReasons.length > 0)) {
    throw stateError('clean workspace 不能携带 dirty/busy/blocked 原因');
  }
  if (input.availability === 'dirty' && dirtyScopes.length === 0) {
    throw stateError('dirty workspace 必须说明 dirty scope');
  }
  if (input.availability === 'busy' && busyReasons.length === 0) {
    throw stateError('busy workspace 必须说明 busy reason');
  }
  if (input.availability === 'blocked' && blockedReasons.length === 0) {
    throw stateError('blocked workspace 必须说明 blocked reason');
  }
  return {
    workspaceSessionId: input.workspaceSessionId,
    browserSessionId: input.browserSessionId,
    workspaceGeneration: input.workspaceGeneration,
    availability: input.availability,
    ...(input.loadedProjectRevision === undefined ? {} : { loadedProjectRevision: input.loadedProjectRevision }),
    ...(input.loadedCoordinationRevision === undefined ? {} : {
      loadedCoordinationRevision: input.loadedCoordinationRevision,
    }),
    dirtyScopes,
    busyReasons,
    blockedReasons,
  };
}

function validateStoredRecord(
  value: unknown,
  expectedRoot: string,
  expectedSessionId: string,
): HumanWorkspaceRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw stateError('human workspace record 不是对象');
  }
  const record = value as Partial<HumanWorkspaceRecord>;
  const normalized = normalizeInput({
    workspaceSessionId: String(record.workspaceSessionId ?? ''),
    browserSessionId: String(record.browserSessionId ?? ''),
    workspaceGeneration: Number(record.workspaceGeneration),
    availability: record.availability as HumanWorkspaceReportedAvailability,
    ...(record.loadedProjectRevision === undefined ? {} : { loadedProjectRevision: record.loadedProjectRevision }),
    ...(record.loadedCoordinationRevision === undefined ? {} : {
      loadedCoordinationRevision: record.loadedCoordinationRevision,
    }),
    dirtyScopes: Array.isArray(record.dirtyScopes) ? record.dirtyScopes as HumanWorkspaceDirtyScope[] : [],
    busyReasons: Array.isArray(record.busyReasons) ? record.busyReasons as HumanWorkspaceBusyReason[] : [],
    blockedReasons: Array.isArray(record.blockedReasons) ? record.blockedReasons as HumanWorkspaceBlockedReason[] : [],
  });
  if (record.formatVersion !== 1
    || record.workspaceContractVersion !== HUMAN_WORKSPACE_CONTRACT_VERSION
    || record.projectRootIdentity === undefined
    || !sameRoot(record.projectRootIdentity, expectedRoot)
    || normalized.workspaceSessionId !== expectedSessionId
    || typeof record.heartbeatAt !== 'string'
    || !Number.isFinite(Date.parse(record.heartbeatAt))) {
    throw stateError('human workspace record 身份或版本无效', {
      expectedSessionId,
      projectRootIdentity: expectedRoot,
    });
  }
  return record as HumanWorkspaceRecord;
}

export class HumanWorkspaceStore {
  readonly dataRoot: string;
  private readonly now: () => number;
  private readonly activeWindowMs: number;
  private readonly graceWindowMs: number;
  private readonly updates = new Map<string, Promise<unknown>>();
  private readonly leases: NodeLocalLeaseManager;

  constructor(options: HumanWorkspaceStoreOptions = {}) {
    this.dataRoot = options.dataRoot ?? new NodeLocalLeaseManager().dataRoot;
    this.leases = new NodeLocalLeaseManager(this.dataRoot);
    this.now = options.now ?? (() => Date.now());
    this.activeWindowMs = options.activeWindowMs ?? 7_000;
    this.graceWindowMs = options.graceWindowMs ?? 22_000;
    if (this.activeWindowMs <= 0 || this.graceWindowMs <= this.activeWindowMs) {
      throw new Error('human workspace active/grace window 配置无效');
    }
  }

  private projectDirectory(projectRootIdentity: string): string {
    return path.join(this.dataRoot, 'human-workspaces', projectIdentityFromRoot(projectRootIdentity));
  }

  private recordPath(projectRootIdentity: string, workspaceSessionId: string): string {
    return path.join(this.projectDirectory(projectRootIdentity), `${workspaceSessionId}.json`);
  }

  async heartbeat(
    projectRootIdentity: string,
    input: HumanWorkspaceHeartbeatInput,
  ): Promise<HumanWorkspaceRecord> {
    const file = this.recordPath(projectRootIdentity, normalizeInput(input).workspaceSessionId);
    return this.updateSession(file, () => this.writeHeartbeat(projectRootIdentity, input));
  }

  private async updateSession<T>(file: string, work: () => Promise<T>): Promise<T> {
    const previous = this.updates.get(file) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(async () => {
      const resourceId = `${path.basename(path.dirname(file))}-${path.basename(file, '.json')}`;
      for (let attempt = 0; ; attempt += 1) {
        let lease;
        try { lease = await this.leases.acquire({ scope: 'workspace', resourceId }); }
        catch (error) {
          if (!(error instanceof AuthoringOperationError) || error.code !== 'PROJECT_BUSY'
            || error.details?.['manualRecoveryRequired'] === true || attempt >= 99) throw error;
          await new Promise(resolve => setTimeout(resolve, 10));
          continue;
        }
        let failed = false;
        let workError: unknown;
        try { return await work(); }
        catch (error) { failed = true; workError = error; throw error; }
        finally {
          try { await lease.release(); }
          catch (releaseError) {
            if (failed) throw new AggregateError([workError, releaseError], '工作区状态更新失败，且释放租约失败', { cause: workError });
            throw releaseError;
          }
        }
      }
    });
    this.updates.set(file, pending);
    try {
      return await pending;
    } finally {
      if (this.updates.get(file) === pending) this.updates.delete(file);
    }
  }

  private async writeHeartbeat(
    projectRootIdentity: string,
    input: HumanWorkspaceHeartbeatInput,
  ): Promise<HumanWorkspaceRecord> {
    const normalized = normalizeInput(input);
    const file = this.recordPath(projectRootIdentity, normalized.workspaceSessionId);
    const existing = await readJsonRecord<HumanWorkspaceRecord>(file);
    if (existing !== null) {
      const current = validateStoredRecord(existing.value, projectRootIdentity, normalized.workspaceSessionId);
      if (current.browserSessionId !== normalized.browserSessionId) {
        throw stateError('workspaceSessionId 已属于另一浏览器会话', {
          workspaceSessionId: normalized.workspaceSessionId,
        });
      }
      if (normalized.workspaceGeneration < current.workspaceGeneration) {
        throw stateError('旧 workspace generation 不得覆盖新状态', {
          workspaceSessionId: normalized.workspaceSessionId,
          currentGeneration: current.workspaceGeneration,
          submittedGeneration: normalized.workspaceGeneration,
        });
      }
    }
    const value: HumanWorkspaceRecord = {
      formatVersion: 1,
      workspaceContractVersion: HUMAN_WORKSPACE_CONTRACT_VERSION,
      projectRootIdentity,
      ...normalized,
      heartbeatAt: new Date(this.now()).toISOString(),
    };
    if (existing === null) {
      try {
        await createJsonRecord(file, value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        throw stateError('workspaceSessionId 在首次发布时发生竞争，未覆盖现有记录', {
          workspaceSessionId: normalized.workspaceSessionId,
        });
      }
    } else {
      await replaceJsonRecord(file, value);
    }
    return value;
  }

  async readSession(
    projectRootIdentity: string,
    workspaceSessionId: string,
  ): Promise<HumanWorkspaceRecord | null> {
    if (!UUID.test(workspaceSessionId)) throw stateError('workspaceSessionId 格式无效');
    const loaded = await readJsonRecord<HumanWorkspaceRecord>(
      this.recordPath(projectRootIdentity, workspaceSessionId),
    );
    if (loaded === null) return null;
    return validateStoredRecord(loaded.value, projectRootIdentity, workspaceSessionId);
  }

  async revoke(
    projectRootIdentity: string,
    workspaceSessionId: string,
    browserSessionId: string,
  ): Promise<void> {
    if (!UUID.test(workspaceSessionId)) throw stateError('workspaceSessionId 格式无效');
    return this.updateSession(this.recordPath(projectRootIdentity, workspaceSessionId), async () => {
    const current = await this.readSession(projectRootIdentity, workspaceSessionId);
    if (current === null) return;
    if (current.browserSessionId !== browserSessionId) {
      throw stateError('不能撤销另一浏览器会话的 workspace', { workspaceSessionId });
    }
    await fs.rm(this.recordPath(projectRootIdentity, workspaceSessionId), { force: true });
    });
  }

  async inspect(projectRootIdentity: string): Promise<HumanWorkspaceStoreInspection> {
    const directory = this.projectDirectory(projectRootIdentity);
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const observations: HumanWorkspaceObservation[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue;
      const workspaceSessionId = entry.name.slice(0, -'.json'.length);
      const file = path.join(directory, entry.name);
      const stat = await fs.lstat(file);
      if (!entry.isFile() || !stat.isFile() || stat.isSymbolicLink()) {
        if (this.now() - stat.mtimeMs <= this.graceWindowMs) {
          observations.push({
            workspaceSessionId: `corrupt:${entry.name}`,
            availability: 'blocked',
            connection: 'active',
            dirtyScopes: [],
            busyReasons: [],
            blockedReasons: ['workspace-state-corrupt'],
          });
        }
        continue;
      }
      let record: HumanWorkspaceRecord;
      try {
        const loaded = await readJsonRecord<HumanWorkspaceRecord>(file);
        if (loaded === null) continue;
        record = validateStoredRecord(loaded.value, projectRootIdentity, workspaceSessionId);
      } catch {
        if (this.now() - stat.mtimeMs <= this.graceWindowMs) {
          observations.push({
            workspaceSessionId: `corrupt:${entry.name}`,
            availability: 'blocked',
            connection: 'active',
            dirtyScopes: [],
            busyReasons: [],
            blockedReasons: ['workspace-state-corrupt'],
          });
        }
        continue;
      }
      const ageMs = this.now() - Date.parse(record.heartbeatAt);
      if (!Number.isFinite(ageMs) || ageMs < -this.activeWindowMs) {
        observations.push({
          workspaceSessionId,
          availability: 'blocked',
          connection: 'active',
          dirtyScopes: record.dirtyScopes,
          busyReasons: record.busyReasons,
          blockedReasons: ['workspace-state-corrupt'],
        });
        continue;
      }
      if (ageMs > this.graceWindowMs) continue;
      const connection = ageMs <= this.activeWindowMs ? 'active' : 'grace';
      observations.push({
        workspaceSessionId,
        availability: record.availability,
        connection,
        ...(record.loadedProjectRevision === undefined ? {} : {
          loadedProjectRevision: record.loadedProjectRevision,
        }),
        ...(record.loadedCoordinationRevision === undefined ? {} : {
          loadedCoordinationRevision: record.loadedCoordinationRevision,
        }),
        dirtyScopes: [...record.dirtyScopes],
        busyReasons: [...record.busyReasons],
        blockedReasons: [...record.blockedReasons],
        ...(connection === 'grace' ? {
          retryAfterMs: Math.max(0, this.graceWindowMs - Math.max(0, ageMs)),
        } : {}),
      });
    }
    return {
      observations,
      summary: aggregateHumanWorkspaceObservations(observations),
    };
  }
}
