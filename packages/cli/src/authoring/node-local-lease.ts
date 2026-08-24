import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuthoringOperationError } from '@surdet/authoring';
import { createJsonRecord, readJsonRecord, replaceJsonRecord } from './node-json-record.js';
import { projectIdentityFromRoot } from './project-identity.js';

export type LeaseScope = 'change' | 'project';

export interface LeaseHandle {
  scope: LeaseScope;
  resourceId: string;
  ownerToken: string;
  directory: string;
  release(): Promise<void>;
}

export interface LeaseInspection {
  state: 'free' | 'owned' | 'stale-candidate' | 'corrupt' | 'foreign-host';
  scope: LeaseScope;
  resourceId: string;
  holder?: {
    pid: number;
    hostname: string;
    acquiredAt: string;
    heartbeatAt: string;
  };
  retryAfterMs?: number;
  manualRecoveryRequired: boolean;
}

export interface NodeLocalLeaseManagerOptions {
  now?: () => number;
  hostname?: () => string;
  pid?: () => number;
  isProcessAlive?: (pid: number) => boolean | Promise<boolean>;
  scheduleHeartbeat?: (callback: () => Promise<void>, intervalMs: number) => () => void;
}

interface LocalLease {
  formatVersion: 1;
  scope: LeaseScope;
  resourceId: string;
  ownerToken: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  heartbeatAt: string;
}

type LeaseReleaseInput = Pick<LeaseHandle, 'scope' | 'resourceId' | 'ownerToken' | 'directory'>;

const HEARTBEAT_INTERVAL_MS = 2_000;
const STALE_AFTER_MS = 15_000;

function defaultDataRoot(): string {
  const configured = process.env['SURDET_AGENT_DATA_DIR'];
  if (configured !== undefined && configured.trim().length > 0) return path.resolve(configured);
  const localAppData = process.env['LOCALAPPDATA'];
  return path.join(localAppData ?? path.join(os.homedir(), 'AppData', 'Local'), 'Surdet', 'agent-changes');
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function busyCode(scope: LeaseScope): 'CHANGE_BUSY' | 'PROJECT_BUSY' {
  return scope === 'change' ? 'CHANGE_BUSY' : 'PROJECT_BUSY';
}

function holderOf(lease: LocalLease): LeaseInspection['holder'] {
  return {
    pid: lease.pid,
    hostname: lease.hostname,
    acquiredAt: lease.acquiredAt,
    heartbeatAt: lease.heartbeatAt,
  };
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function leaseCorrupt(message: string, details: Record<string, unknown> = {}): AuthoringOperationError {
  return new AuthoringOperationError('LEASE_CORRUPT', message, {
    ...details,
    manualRecoveryRequired: true,
    repairAction: '保留锁目录与 lease.json，人工检查后再移动或恢复；工具不会自动删除',
  });
}

function busyError(
  scope: LeaseScope,
  resourceId: string,
  inspection: LeaseInspection,
  message: string,
  manualRecoveryRequired = inspection.manualRecoveryRequired,
): AuthoringOperationError {
  return new AuthoringOperationError(busyCode(scope), message, {
    scope,
    resourceId,
    ...(inspection.holder === undefined ? {} : { holder: inspection.holder }),
    ...(inspection.retryAfterMs === undefined ? {} : { retryAfterMs: inspection.retryAfterMs }),
    manualRecoveryRequired,
    retryDisposition: manualRecoveryRequired ? 'manual-recovery' : 'after-refresh',
    repairAction: manualRecoveryRequired
      ? '不得自动删除或接管；保留锁证据并由人工恢复'
      : '等待持有者释放或 heartbeat 超时后重新读取 lease 再重试',
  });
}

export class NodeLocalLeaseManager {
  private readonly now: () => number;
  private readonly hostname: () => string;
  private readonly pid: () => number;
  private readonly isProcessAlive: (pid: number) => boolean | Promise<boolean>;
  private readonly scheduleHeartbeat: (callback: () => Promise<void>, intervalMs: number) => () => void;
  private readonly cancellations = new Map<string, () => void>();

  constructor(
    readonly dataRoot: string = defaultDataRoot(),
    options: NodeLocalLeaseManagerOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.hostname = options.hostname ?? (() => os.hostname());
    this.pid = options.pid ?? (() => process.pid);
    this.isProcessAlive = options.isProcessAlive ?? ((pid) => {
      if (!Number.isInteger(pid) || pid <= 0) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return errorCode(error) !== 'ESRCH';
      }
    });
    this.scheduleHeartbeat = options.scheduleHeartbeat ?? ((callback, intervalMs) => {
      const timer = setInterval(() => {
        void callback().catch(() => undefined);
      }, intervalMs);
      timer.unref?.();
      return () => clearInterval(timer);
    });
  }

  private scopeDirectory(scope: LeaseScope): string {
    return path.join(this.dataRoot, '.locks', scope === 'change' ? 'changes' : 'projects');
  }

  private lockDirectory(scope: LeaseScope, resourceId: string): string {
    const resourceName = scope === 'change' ? safeId(resourceId) : projectIdentityFromRoot(resourceId);
    return path.join(this.scopeDirectory(scope), `${resourceName}.lock`);
  }

  private leaseFile(scope: LeaseScope, resourceId: string): string {
    return path.join(this.lockDirectory(scope, resourceId), 'lease.json');
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }

  private inspectionFor(scope: LeaseScope, resourceId: string, lease: LocalLease): LeaseInspection {
    const ageMs = this.now() - Date.parse(lease.heartbeatAt);
    if (lease.hostname !== this.hostname()) {
      return {
        state: 'foreign-host',
        scope,
        resourceId,
        holder: holderOf(lease),
        manualRecoveryRequired: true,
      };
    }
    if (ageMs > STALE_AFTER_MS) {
      return {
        state: 'stale-candidate',
        scope,
        resourceId,
        holder: holderOf(lease),
        manualRecoveryRequired: false,
      };
    }
    return {
      state: 'owned',
      scope,
      resourceId,
      holder: holderOf(lease),
      retryAfterMs: Math.max(0, STALE_AFTER_MS - Math.max(0, ageMs)),
      manualRecoveryRequired: false,
    };
  }

  private validateHandle(handle: LeaseReleaseInput): void {
    if (!samePath(handle.directory, this.lockDirectory(handle.scope, handle.resourceId))) {
      throw new AuthoringOperationError(busyCode(handle.scope), 'lease handle 目录与资源身份不匹配', {
        scope: handle.scope,
        resourceId: handle.resourceId,
        manualRecoveryRequired: true,
      });
    }
  }

  private async loadLease(scope: LeaseScope, resourceId: string): Promise<LocalLease> {
    const file = this.leaseFile(scope, resourceId);
    try {
      const loaded = await readJsonRecord<unknown>(file);
      if (loaded === null) throw leaseCorrupt(`lease.json 缺失：${file}`, { path: file, scope, resourceId });
      const value = loaded.value;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw leaseCorrupt(`lease.json 不是对象：${file}`, { path: file, scope, resourceId });
      }
      const lease = value as Partial<LocalLease>;
      if (lease.formatVersion !== 1 || lease.scope !== scope || lease.resourceId !== resourceId
        || typeof lease.ownerToken !== 'string' || lease.ownerToken.length === 0
        || typeof lease.pid !== 'number' || !Number.isInteger(lease.pid) || lease.pid <= 0
        || typeof lease.hostname !== 'string' || lease.hostname.length === 0
        || typeof lease.acquiredAt !== 'string' || !Number.isFinite(Date.parse(lease.acquiredAt))
        || typeof lease.heartbeatAt !== 'string' || !Number.isFinite(Date.parse(lease.heartbeatAt))) {
        throw leaseCorrupt(`lease.json 字段无效：${file}`, { path: file, scope, resourceId });
      }
      return lease as LocalLease;
    } catch (error) {
      if (error instanceof AuthoringOperationError && error.code === 'LEASE_CORRUPT') throw error;
      const details = error instanceof AuthoringOperationError ? error.details : undefined;
      throw leaseCorrupt(`lease.json 无法读取：${file}`, {
        path: file,
        scope,
        resourceId,
        ...(details ?? {}),
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async inspectionOrCorrupt(scope: LeaseScope, resourceId: string): Promise<LeaseInspection> {
    const directory = this.lockDirectory(scope, resourceId);
    try {
      const stat = await fs.stat(directory);
      if (!stat.isDirectory()) throw leaseCorrupt(`lock path 不是目录：${directory}`, { path: directory, scope, resourceId });
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return { state: 'free', scope, resourceId, manualRecoveryRequired: false };
      }
      if (error instanceof AuthoringOperationError && error.code === 'LEASE_CORRUPT') {
        return { state: 'corrupt', scope, resourceId, manualRecoveryRequired: true };
      }
      throw error;
    }
    try {
      return this.inspectionFor(scope, resourceId, await this.loadLease(scope, resourceId));
    } catch (error) {
      if (error instanceof AuthoringOperationError && error.code === 'LEASE_CORRUPT') {
        return { state: 'corrupt', scope, resourceId, manualRecoveryRequired: true };
      }
      throw error;
    }
  }

  async inspect(scope: LeaseScope, resourceId: string): Promise<LeaseInspection> {
    return this.inspectionOrCorrupt(scope, resourceId);
  }

  async acquire(input: { scope: LeaseScope; resourceId: string }): Promise<LeaseHandle> {
    const { scope, resourceId } = input;
    const directory = this.lockDirectory(scope, resourceId);
    const leaseFile = this.leaseFile(scope, resourceId);
    await fs.mkdir(this.scopeDirectory(scope), { recursive: true });
    const ownerToken = crypto.randomUUID();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fs.mkdir(directory);
        const now = this.timestamp();
        await createJsonRecord(leaseFile, {
          formatVersion: 1,
          scope,
          resourceId,
          ownerToken,
          pid: this.pid(),
          hostname: this.hostname(),
          acquiredAt: now,
          heartbeatAt: now,
        } satisfies LocalLease);
        return this.createHandle({ scope, resourceId, ownerToken, directory });
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
      }

      let lease: LocalLease;
      try {
        lease = await this.loadLease(scope, resourceId);
      } catch (error) {
        if (error instanceof AuthoringOperationError && error.code === 'LEASE_CORRUPT') throw error;
        throw error;
      }
      const inspection = this.inspectionFor(scope, resourceId, lease);
      if (inspection.state === 'foreign-host') {
        throw busyError(scope, resourceId, inspection, `资源 '${resourceId}' 被其他主机持有`);
      }
      const ageMs = this.now() - Date.parse(lease.heartbeatAt);
      if (ageMs <= STALE_AFTER_MS) {
        throw busyError(scope, resourceId, inspection, `资源 '${resourceId}' 正由其他 lease 持有`);
      }
      if (await this.isProcessAlive(lease.pid)) {
        throw busyError(scope, resourceId, inspection, `资源 '${resourceId}' 的旧 PID 仍存活，不自动接管`);
      }

      const quarantine = path.join(
        this.dataRoot,
        '.locks',
        'stale',
        `${this.now()}-${safeId(lease.ownerToken)}-${crypto.randomUUID().slice(0, 8)}`,
      );
      await fs.mkdir(path.dirname(quarantine), { recursive: true });
      try {
        await fs.rename(directory, quarantine);
      } catch (error) {
        throw busyError(
          scope,
          resourceId,
          inspection,
          `资源 '${resourceId}' 的 stale lock 无法 quarantine，停止自动接管`,
          true,
        );
      }
    }

    const inspection = await this.inspect(scope, resourceId);
    throw busyError(scope, resourceId, inspection, `资源 '${resourceId}' 竞争次数达到上限`);
  }

  private createHandle(input: Omit<LeaseHandle, 'release'>): LeaseHandle {
    const handle: LeaseHandle = {
      ...input,
      release: async (): Promise<void> => this.release(handle),
    };
    const cancel = this.scheduleHeartbeat(async () => {
      await this.assertOwned(handle);
      const current = await this.loadLease(handle.scope, handle.resourceId);
      await replaceJsonRecord(this.leaseFile(handle.scope, handle.resourceId), {
        ...current,
        heartbeatAt: this.timestamp(),
      } satisfies LocalLease);
    }, HEARTBEAT_INTERVAL_MS);
    this.cancellations.set(handle.ownerToken, cancel);
    return handle;
  }

  async assertOwned(handle: LeaseHandle): Promise<void> {
    this.validateHandle(handle);
    const current = await this.loadLease(handle.scope, handle.resourceId);
    if (current.ownerToken !== handle.ownerToken) {
      const inspection = this.inspectionFor(handle.scope, handle.resourceId, current);
      throw busyError(handle.scope, handle.resourceId, inspection, `资源 '${handle.resourceId}' 的 lease ownerToken 已变化`);
    }
  }

  async release(handle: LeaseReleaseInput): Promise<void> {
    this.validateHandle(handle);
    const current = await this.loadLease(handle.scope, handle.resourceId);
    if (current.ownerToken !== handle.ownerToken) {
      const inspection = this.inspectionFor(handle.scope, handle.resourceId, current);
      throw busyError(handle.scope, handle.resourceId, inspection, `资源 '${handle.resourceId}' 的 lease ownerToken 不匹配`);
    }
    this.cancellations.get(handle.ownerToken)?.();
    this.cancellations.delete(handle.ownerToken);
    const leaseFile = this.leaseFile(handle.scope, handle.resourceId);
    await fs.unlink(leaseFile).catch((error: unknown) => {
      if (errorCode(error) !== 'ENOENT') throw error;
    });
    await fs.rmdir(handle.directory).catch((error: unknown) => {
      if (errorCode(error) !== 'ENOENT') throw error;
    });
  }

  async withLease<T>(
    input: { scope: LeaseScope; resourceId: string },
    callback: (lease: LeaseHandle) => Promise<T>,
  ): Promise<T> {
    const lease = await this.acquire(input);
    try {
      return await callback(lease);
    } finally {
      await lease.release();
    }
  }

  async withProjectLease<T>(projectIdentity: string, callback: (lease: LeaseHandle) => Promise<T>): Promise<T> {
    return this.withLease({ scope: 'project', resourceId: projectIdentity }, callback);
  }
}
