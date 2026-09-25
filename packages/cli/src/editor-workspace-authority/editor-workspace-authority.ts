import * as crypto from 'node:crypto';
import {
  AuthoringOperationError,
  type PreviewPublishInput,
  type PreviewContentTarget,
  aggregateHumanWorkspaceObservations,
  humanWorkspaceCommitBlock,
  type HumanWorkspaceBlockedReason,
  type HumanWorkspaceBusyReason,
  type HumanWorkspaceDirtyScope,
  type HumanWorkspaceReportedAvailability,
  type ProjectMutationNotice,
} from '@surdet/authoring';
import type { LeaseHandle } from '../authoring/node-local-lease.js';
import { NodeLocalLeaseManager } from '../authoring/node-local-lease.js';
import { NodeProjectStorage } from '../authoring/node-project-storage.js';
import { projectIdentityFromRoot } from '../authoring/project-identity.js';
import {
  HumanWorkspaceStore,
} from '../authoring/human-workspace-store.js';
import {
  loadProjectCoordinationBaseline,
  isCoordinationTextPath,
  type ProjectCoordinationBaseline,
} from '../authoring/project-coordination-baseline.js';
import { ProjectMutationNoticeStore } from '../authoring/project-mutation-notice-store.js';
import { PreviewObservationService } from '../authoring/preview-observation-service.js';
import { PreviewContentService } from '../authoring/preview-content-service.js';

export interface EditorWorkspaceStateInput {
  workspaceSessionId: string;
  browserSessionId: string;
  workspaceGeneration: number;
  availability: HumanWorkspaceReportedAvailability;
  loadedProjectRevision?: string;
  loadedCoordinationRevision?: string;
  dirtyScopes?: HumanWorkspaceDirtyScope[];
  busyReasons?: HumanWorkspaceBusyReason[];
  blockedReasons?: HumanWorkspaceBlockedReason[];
}

export interface BeginEditorWriteInput extends EditorWorkspaceStateInput {
  expectedProjectRevision: string;
  expectedCoordinationRevision: string;
  purpose: 'save-all' | 'config-save' | 'character-save';
}

export interface ActiveEditorWriteInput extends EditorWorkspaceStateInput {
  writeLeaseId: string;
}

export interface PublishEditorFileInput extends ActiveEditorWriteInput {
  path: string;
  text: string | null;
  expectedSha256: string | null;
}

export interface EditorWorkspaceSnapshot {
  projectIdentity: string;
  humanWorkspace: Awaited<ReturnType<HumanWorkspaceStore['inspect']>>['summary'];
  mutationNotice: ProjectMutationNotice | null;
  diskBaseline: ProjectCoordinationBaseline;
}

export type MutationNoticeSettlement =
  | { status: 'none' }
  | { status: 'written'; notice: ProjectMutationNotice }
  | { status: 'unavailable'; message: string };

interface ActiveWrite {
  writeLeaseId: string;
  workspaceSessionId: string;
  browserSessionId: string;
  beginGeneration: number;
  purpose: BeginEditorWriteInput['purpose'];
  lease: LeaseHandle;
  before: ProjectCoordinationBaseline;
  published: Map<string, string>;
  pending: Promise<void>;
  closing: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export interface EditorWorkspaceAuthorityOptions {
  leaseManager?: NodeLocalLeaseManager;
  workspaceStore?: HumanWorkspaceStore;
  noticeStore?: ProjectMutationNoticeStore;
  maxWriteMs?: number;
  now?: () => number;
}

export class EditorWorkspaceAuthorityError extends Error {
  constructor(
    readonly code: 'EDITOR_PROJECT_BASELINE_CHANGED',
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EditorWorkspaceAuthorityError';
  }
}

function fileMap(baseline: ProjectCoordinationBaseline): Map<string, string> {
  return new Map(baseline.files.map((file) => [file.path, file.sha256]));
}

function changedPaths(
  before: ProjectCoordinationBaseline,
  after: ProjectCoordinationBaseline,
): string[] {
  const left = fileMap(before);
  const right = fileMap(after);
  const paths = new Set([...left.keys(), ...right.keys()]);
  return [...paths]
    .filter((path) => left.get(path) !== right.get(path))
    .sort((a, b) => a.localeCompare(b));
}

function workspaceBlockError(
  block: NonNullable<ReturnType<typeof humanWorkspaceCommitBlock>>,
  message: string,
): AuthoringOperationError {
  return new AuthoringOperationError(block.code, message, {
    humanWorkspace: block.summary,
    projectMutationOccurred: false,
  });
}

/**
 * Node side of the bound Editor relay.
 *
 * HTTP parsing/authentication stays outside this class. Callers must validate
 * the existing project-binding token before invoking these methods. The
 * service stays alive without a project lease; beginWrite acquires the shared
 * mutation lease only for explicit saves. Bound Editor text publication stays
 * here so an expired browser request cannot write after the lease is released.
 */
export class EditorWorkspaceAuthority {
  private readonly leaseManager: NodeLocalLeaseManager;
  private readonly workspaceStore: HumanWorkspaceStore;
  private readonly noticeStore: ProjectMutationNoticeStore;
  private readonly maxWriteMs: number;
  private readonly activeWrites = new Map<string, ActiveWrite>();
  private readonly now: () => number;
  private readonly previews: PreviewObservationService;

  constructor(
    readonly projectRootIdentity: string,
    options: EditorWorkspaceAuthorityOptions = {},
  ) {
    this.leaseManager = options.leaseManager ?? new NodeLocalLeaseManager();
    this.workspaceStore = options.workspaceStore ?? new HumanWorkspaceStore({
      dataRoot: this.leaseManager.dataRoot,
    });
    this.noticeStore = options.noticeStore ?? new ProjectMutationNoticeStore({
      dataRoot: this.leaseManager.dataRoot,
    });
    this.maxWriteMs = options.maxWriteMs ?? 120_000;
    this.now = options.now ?? (() => Date.now());
    this.previews = new PreviewObservationService(this.leaseManager.dataRoot, this.workspaceStore);
  }

  private async baseline(): Promise<ProjectCoordinationBaseline> {
    return loadProjectCoordinationBaseline(
      await NodeProjectStorage.open(this.projectRootIdentity),
    );
  }

  private async requireSession(input: EditorWorkspaceStateInput) {
    const current = await this.workspaceStore.readSession(
      this.projectRootIdentity,
      input.workspaceSessionId,
    );
    if (current === null || current.browserSessionId !== input.browserSessionId) {
      throw new AuthoringOperationError(
        'HUMAN_WORKSPACE_STATE_CORRUPT',
        '绑定 Editor 的 workspace session 不存在或身份不匹配',
      );
    }
    if (input.workspaceGeneration < current.workspaceGeneration) {
      throw new AuthoringOperationError(
        'HUMAN_WORKSPACE_STATE_CORRUPT',
        '旧 workspace generation 不能执行新的项目写入',
      );
    }
    return current;
  }

  private async assertOtherWorkspacesAllowHumanWrite(
    workspaceSessionId: string,
  ): Promise<void> {
    const inspected = await this.workspaceStore.inspect(this.projectRootIdentity);
    const others = inspected.observations.filter(
      (observation) => observation.workspaceSessionId !== workspaceSessionId,
    );
    const block = humanWorkspaceCommitBlock(
      aggregateHumanWorkspaceObservations(others),
    );
    if (block === null) return;
    throw workspaceBlockError(
      block,
      '另一个绑定同一项目的 Editor 仍有未保存、忙碌或待恢复状态',
    );
  }

  private armExpiry(active: Omit<ActiveWrite, 'timer'>): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      void this.expireWrite(active.workspaceSessionId, active.writeLeaseId);
    }, this.maxWriteMs);
    timer.unref?.();
    return timer;
  }

  async heartbeat(input: EditorWorkspaceStateInput) {
    return this.workspaceStore.heartbeat(this.projectRootIdentity, input);
  }

  async snapshot(): Promise<EditorWorkspaceSnapshot> {
    const [humanWorkspace, mutationNotice, diskBaseline] = await Promise.all([
      this.workspaceStore.inspect(this.projectRootIdentity),
      this.noticeStore.readLatest(this.projectRootIdentity).catch(() => null),
      this.baseline(),
    ]);
    return {
      projectIdentity: projectIdentityFromRoot(this.projectRootIdentity),
      humanWorkspace: humanWorkspace.summary,
      mutationNotice,
      diskBaseline,
    };
  }

  async publishPreview(input: EditorWorkspaceStateInput, preview: PreviewPublishInput) {
    await this.requireSession(input);
    await this.workspaceStore.heartbeat(this.projectRootIdentity, input);
    const lease = preview.action === 'invalidate' ? null
      : await this.leaseManager.acquire({ scope: 'project', resourceId: this.projectRootIdentity });
    try { return await this.previews.publish(this.projectRootIdentity, input.workspaceSessionId, input.browserSessionId, preview); }
    finally { await lease?.release(); }
  }

  async previewSources(input: EditorWorkspaceStateInput) {
    await this.requireSession(input);
    await this.workspaceStore.heartbeat(this.projectRootIdentity, input);
    return { sources: await new PreviewContentService(this.leaseManager.dataRoot).list(this.projectRootIdentity) };
  }

  async previewContent(input: EditorWorkspaceStateInput, target: PreviewContentTarget) {
    await this.requireSession(input);
    await this.workspaceStore.heartbeat(this.projectRootIdentity, input);
    const resolved = await new PreviewContentService(this.leaseManager.dataRoot).resolve(this.projectRootIdentity, target);
    if (resolved.content.projectRevision !== input.loadedProjectRevision || resolved.content.coordinationRevision !== input.loadedCoordinationRevision) {
      throw new AuthoringOperationError('PREVIEW_OBSERVATION_STALE', '当前绑定工作区尚未加载所选内容的来源基线');
    }
    return resolved.content;
  }

  async beginWrite(input: BeginEditorWriteInput): Promise<{
    writeLeaseId: string;
    expiresAt: string;
    diskBaseline: ProjectCoordinationBaseline;
  }> {
    await this.requireSession(input);
    if (this.activeWrites.has(input.workspaceSessionId)) {
      throw new AuthoringOperationError(
        'HUMAN_WORKSPACE_BUSY',
        '当前 Editor 已有保存正在进行',
      );
    }

    const lease = await this.leaseManager.acquire({
      scope: 'project',
      resourceId: this.projectRootIdentity,
    });
    try {
      await this.assertOtherWorkspacesAllowHumanWrite(input.workspaceSessionId);
      const diskBaseline = await this.baseline();
      if (diskBaseline.projectRevision !== input.expectedProjectRevision
        || diskBaseline.coordinationRevision !== input.expectedCoordinationRevision) {
        throw new EditorWorkspaceAuthorityError(
          'EDITOR_PROJECT_BASELINE_CHANGED',
              '项目磁盘已发生变化，未开始保存',
          {
            expectedProjectRevision: input.expectedProjectRevision,
            actualProjectRevision: diskBaseline.projectRevision,
            expectedCoordinationRevision: input.expectedCoordinationRevision,
            actualCoordinationRevision: diskBaseline.coordinationRevision,
            projectMutationOccurred: false,
          },
        );
      }

      const writeLeaseId = crypto.randomUUID();
      await this.workspaceStore.heartbeat(this.projectRootIdentity, {
        ...input,
        availability: 'busy',
        loadedProjectRevision: diskBaseline.projectRevision,
        loadedCoordinationRevision: diskBaseline.coordinationRevision,
        busyReasons: ['saving'],
        blockedReasons: [],
      });
      const activeWithoutTimer = {
        writeLeaseId,
        workspaceSessionId: input.workspaceSessionId,
        browserSessionId: input.browserSessionId,
        beginGeneration: input.workspaceGeneration,
        purpose: input.purpose,
        lease,
        before: diskBaseline,
        published: fileMap(diskBaseline),
        pending: Promise.resolve(),
        closing: false,
      };
      const active: ActiveWrite = {
        ...activeWithoutTimer,
        timer: this.armExpiry(activeWithoutTimer),
      };
      this.activeWrites.set(input.workspaceSessionId, active);
      return {
        writeLeaseId,
        expiresAt: new Date(this.now() + this.maxWriteMs).toISOString(),
        diskBaseline,
      };
    } catch (error) {
      await lease.release().catch(() => undefined);
      throw error;
    }
  }

  async renewWrite(input: ActiveEditorWriteInput): Promise<{ expiresAt: string }> {
    const active = this.requireActiveWrite(input);
    if (input.workspaceGeneration < active.beginGeneration) {
      throw new AuthoringOperationError(
        'HUMAN_WORKSPACE_STATE_CORRUPT',
        '旧 workspace generation 不能续期保存 lease',
      );
    }
    await this.leaseManager.assertOwned(active.lease);
    clearTimeout(active.timer);
    active.timer = this.armExpiry(active);
    await this.workspaceStore.heartbeat(this.projectRootIdentity, {
      ...input,
      availability: 'busy',
      loadedProjectRevision: active.before.projectRevision,
      loadedCoordinationRevision: active.before.coordinationRevision,
      busyReasons: ['saving'],
      blockedReasons: [],
    });
    return { expiresAt: new Date(this.now() + this.maxWriteMs).toISOString() };
  }

  async withWriteLease<T>(input: ActiveEditorWriteInput, work: (lease: LeaseHandle) => Promise<T>): Promise<T> {
    const active = this.requireActiveWrite(input);
    const pending = active.pending.then(async () => {
      this.requireActiveWrite(input);
      await this.leaseManager.assertOwned(active.lease);
      return work(active.lease);
    });
    active.pending = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async publishFile(input: PublishEditorFileInput): Promise<{ sha256: string | null }> {
    const active = this.requireActiveWrite(input);
    return this.withWriteLease(input, async () => {
      if (!isCoordinationTextPath(input.path)) {
        throw new AuthoringOperationError('PATH_OUTSIDE_PROJECT', '保存路径不属于 Editor 文本范围');
      }
      await this.leaseManager.assertOwned(active.lease);
      const storage = await NodeProjectStorage.open(this.projectRootIdentity);
      const current = await storage.exists(input.path) ? await storage.readText(input.path) : null;
      if ((current?.sha256 ?? null) !== input.expectedSha256
        || (active.published.get(input.path) ?? null) !== input.expectedSha256) {
        throw new EditorWorkspaceAuthorityError('EDITOR_PROJECT_BASELINE_CHANGED',
          '文件磁盘基线已变化，保留编辑内容并停止保存', { path: input.path, projectMutationOccurred: false });
      }
      if (input.text === null) {
        this.requireActiveWrite(input);
        if (current !== null) await storage.removePath(input.path);
        active.published.delete(input.path);
        return { sha256: null };
      }
      const staged = await storage.stageText(input.path, input.text, active.writeLeaseId);
      try {
        this.requireActiveWrite(input);
        await this.leaseManager.assertOwned(active.lease);
        await storage.replaceFromStage(input.path, staged.stagedIdentity);
        active.published.set(input.path, staged.sha256);
        return { sha256: staged.sha256 };
      } finally {
        await storage.removeStage(staged.stagedIdentity);
      }
    });
  }

  /** Called only by the in-process scene authority while holding this write lease.
   * Subsequent ordinary config writes must compare against this batch's receipt. */
  recordSceneCommit(input: ActiveEditorWriteInput, receipt: { writes: Array<{ path: string; sha256: string }>; deletedPaths: string[] }): void {
    const active = this.requireActiveWrite(input);
    for (const file of receipt.writes) active.published.set(file.path, file.sha256);
    for (const file of receipt.deletedPaths) active.published.delete(file);
  }

  async finishWrite(input: ActiveEditorWriteInput): Promise<{
    diskBaseline: ProjectCoordinationBaseline;
    changedPaths: string[];
    mutationNotice: MutationNoticeSettlement;
  }> {
    const active = this.requireActiveWrite(input);
    active.closing = true;
    clearTimeout(active.timer);
    try {
      await active.pending;
      await this.leaseManager.assertOwned(active.lease);
      const diskBaseline = await this.baseline();
      const paths = changedPaths(active.before, diskBaseline);
      let mutationNotice: MutationNoticeSettlement = { status: 'none' };
      if (paths.length > 0) {
        try {
          const notice = await this.noticeStore.record(
            this.projectRootIdentity,
            {
              projectRevision: diskBaseline.projectRevision,
              coordinationRevision: diskBaseline.coordinationRevision,
              initiator: 'human-editor',
              changedPaths: paths,
              operationId: active.writeLeaseId,
            },
            () => this.leaseManager.assertOwned(active.lease),
          );
          mutationNotice = { status: 'written', notice };
        } catch (error) {
          // Project files may already be safely written. Never return a
          // retryable "write failed" result that could duplicate the mutation.
          mutationNotice = {
            status: 'unavailable',
            message: '文件已保存，但变化通知暂时不可用，请刷新项目状态。',
          };
        }
      }
      await this.workspaceStore.heartbeat(this.projectRootIdentity, {
        ...input,
        loadedProjectRevision: diskBaseline.projectRevision,
        loadedCoordinationRevision: diskBaseline.coordinationRevision,
      });
      return { diskBaseline, changedPaths: paths, mutationNotice };
    } catch (error) {
      await this.workspaceStore.heartbeat(this.projectRootIdentity, {
        ...input,
        availability: 'blocked',
        blockedReasons: ['write-settlement-failed'],
        busyReasons: [],
      }).catch(() => undefined);
      throw error;
    } finally {
      this.activeWrites.delete(input.workspaceSessionId);
      await active.lease.release();
    }
  }

  async abortWrite(input: ActiveEditorWriteInput): Promise<void> {
    const active = this.requireActiveWrite(input, false);
    if (active === null) return;
    await this.finishWrite(input);
  }

  async revoke(workspaceSessionId: string, browserSessionId: string): Promise<void> {
    const active = this.activeWrites.get(workspaceSessionId);
    if (active !== undefined && active.browserSessionId === browserSessionId) {
      await this.expireWrite(workspaceSessionId, active.writeLeaseId);
    }
    await this.workspaceStore.revoke(
      this.projectRootIdentity,
      workspaceSessionId,
      browserSessionId,
    );
  }

  async close(): Promise<void> {
    const writes = [...this.activeWrites.values()];
    for (const active of writes) {
      await this.expireWrite(active.workspaceSessionId, active.writeLeaseId);
    }
  }

  private requireActiveWrite(input: ActiveEditorWriteInput): ActiveWrite;
  private requireActiveWrite(
    input: ActiveEditorWriteInput,
    required: false,
  ): ActiveWrite | null;
  private requireActiveWrite(
    input: ActiveEditorWriteInput,
    required = true,
  ): ActiveWrite | null {
    const active = this.activeWrites.get(input.workspaceSessionId);
    if (active === undefined || active.closing) {
      if (!required) return null;
      throw new AuthoringOperationError(
        'HUMAN_WORKSPACE_STATE_CORRUPT',
        '保存 lease 不存在或已经失效',
      );
    }
    if (active.writeLeaseId !== input.writeLeaseId
      || active.browserSessionId !== input.browserSessionId) {
      throw new AuthoringOperationError(
        'HUMAN_WORKSPACE_STATE_CORRUPT',
        '保存 lease 身份不匹配',
      );
    }
    return active;
  }

  private async expireWrite(
    workspaceSessionId: string,
    writeLeaseId: string,
  ): Promise<void> {
    const active = this.activeWrites.get(workspaceSessionId);
    if (active === undefined || active.writeLeaseId !== writeLeaseId || active.closing) return;
    active.closing = true;
    clearTimeout(active.timer);
    await active.pending;
    const current = await this.workspaceStore.readSession(
      this.projectRootIdentity,
      workspaceSessionId,
    ).catch(() => null);
    if (current !== null) {
      await this.workspaceStore.heartbeat(this.projectRootIdentity, {
        workspaceSessionId,
        browserSessionId: active.browserSessionId,
        workspaceGeneration: Math.max(
          current.workspaceGeneration,
          active.beginGeneration,
        ),
        availability: 'blocked',
        loadedProjectRevision: current.loadedProjectRevision,
        loadedCoordinationRevision: current.loadedCoordinationRevision,
        dirtyScopes: current.dirtyScopes,
        blockedReasons: ['write-settlement-failed'],
      }).catch(() => undefined);
    }
    this.activeWrites.delete(workspaceSessionId);
    await active.lease.release().catch(() => undefined);
  }
}
