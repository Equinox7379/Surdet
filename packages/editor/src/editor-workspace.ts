import { AssetImportClientError, type EditorWorkspaceClient, type EditorWorkspaceState,
  type EditorWorkspaceWrite, type EditorWorkspaceSnapshot } from './asset-import-client.js';
import { diffProjectDiskBaselines, expectedShaFor, type ProjectDiskBaseline } from './project-disk-baseline.js';
import { projectHumanWorkspace, type EditorWorkspaceFacts } from './human-workspace-projection.js';
import type { PreviewPublishInput, PreviewContentTarget } from '@surdet/authoring';

type WorkspaceFacts = Omit<EditorWorkspaceFacts, 'relayBound' | 'saving' | 'externalUpdateConflict'>;
let readFacts: () => WorkspaceFacts = () => ({ sceneDirty: false, timelineDirty: false, configDirty: false,
  reviewDirty: false, projectTransition: false, assetImportWriting: false, assetRelocationWriting: false,
  sceneLifecycleWriting: false, autosaveRecoveryBlocked: false });
let onChanged: () => void = () => {};
interface Connection {
  client: EditorWorkspaceClient;
  root: FileSystemDirectoryHandle;
  sessionId: string;
  generation: number;
  lastState: string;
  baseline: ProjectDiskBaseline | null;
  latest: EditorWorkspaceSnapshot | null;
  observedSequence: number;
  pendingExternal: boolean;
  lost: boolean;
  saving: boolean;
  writeLeaseId: string | null;
  lastOwnWriteId: string | null;
  tail: Promise<unknown>;
  timer: ReturnType<typeof setInterval> | null;
  polling: number;
}
let connection: Connection | null = null;

export function bindEditorWorkspaceHooks(hooks: { facts: () => WorkspaceFacts; onChanged: () => void }): void {
  readFacts = hooks.facts;
  onChanged = hooks.onChanged;
}

function projection(current = connection) {
  const facts = readFacts();
  return projectHumanWorkspace({ ...facts, relayBound: current !== null, saving: current?.saving ?? false,
    externalUpdateConflict: current?.pendingExternal === true
      && (facts.sceneDirty || facts.timelineDirty || facts.configDirty || facts.reviewDirty) });
}

function stateFor(current: Connection): EditorWorkspaceState {
  const { protection: _protection, ...state } = projection(current);
  const body = { ...state,
    ...(current.baseline === null ? {} : { loadedProjectRevision: current.baseline.projectRevision,
      loadedCoordinationRevision: current.baseline.coordinationRevision }) };
  const serialized = JSON.stringify(body);
  if (serialized !== current.lastState) {
    current.generation += 1;
    current.lastState = serialized;
  }
  return { workspaceSessionId: current.sessionId, workspaceGeneration: current.generation, ...body };
}

function enqueue<T>(current: Connection, operation: () => Promise<T>): Promise<T> {
  const pending = current.tail.catch(() => undefined).then(operation);
  current.tail = pending;
  return pending;
}

/** Asset/scene requests share the same project lease as preview and polling. */
export function enqueueEditorAssetRequest<T>(operation: () => Promise<T>): Promise<T> {
  const current = connection;
  if (current === null) return operation();
  return enqueue(current, () => {
    if (connection !== current) throw new Error('工作区已经切换，未继续素材请求。');
    return operation();
  });
}

const PREVIEW_BUSY_DELAYS_MS = [100, 200, 400, 800] as const;

export function editorWorkspaceStatus() {
  return {
    protection: connection === null ? 'unavailable' as const : connection.lost ? 'lost' as const : 'connected' as const,
    update: connection?.pendingExternal ? projection().dirtyScopes.length > 0 ? 'conflict' as const : 'pending' as const : 'none' as const,
    dirty: projection().dirtyScopes.length > 0,
    saving: connection !== null && (connection.saving || connection.writeLeaseId !== null),
    baseline: connection?.baseline ?? null,
    latest: connection?.latest ?? null,
  };
}

/** Capture the existing binding: a late preview must never publish into another workspace. */
export function editorPreviewPublisher(root: FileSystemDirectoryHandle | null) {
  const current = connection;
  if (current === null || current.root !== root || current.lost || current.baseline === null) return null;
  let invalidatedGeneration = -1;
  return {
    baseline: current.baseline,
    sources: () => enqueue(current, async () => {
      if (connection !== current) throw new AssetImportClientError('PREVIEW_OBSERVATION_STALE', '项目已切换。', 'after-refresh');
      return current.client.previewSources(stateFor(current));
    }),
    content: (target: PreviewContentTarget) => enqueue(current, async () => {
      if (connection !== current) throw new AssetImportClientError('PREVIEW_OBSERVATION_STALE', '项目已切换。', 'after-refresh');
      return current.client.previewContent({ ...stateFor(current), target });
    }),
    publish: (preview: PreviewPublishInput) => {
      if (preview.action === 'invalidate') invalidatedGeneration = Math.max(invalidatedGeneration, preview.previewGeneration);
      return enqueue(current, async () => {
        const state = stateFor(current);
        for (let attempt = 0; ; attempt += 1) {
          if (connection !== current
            || (preview.action !== 'invalidate' && preview.previewGeneration <= invalidatedGeneration)
            || (attempt > 0 && (current.lost || stateFor(current).workspaceGeneration !== state.workspaceGeneration))) {
            throw new AssetImportClientError('PREVIEW_OBSERVATION_STALE', '项目、工作区或预览已变化，未发布迟到的观察。', 'after-refresh');
          }
          try { return await current.client.preview({ ...state, preview }); }
          catch (error) {
            const delay = PREVIEW_BUSY_DELAYS_MS[attempt];
            if (preview.action === 'invalidate' || !(error instanceof AssetImportClientError)
              || error.code !== 'PROJECT_BUSY' || error.retryDisposition !== 'after-refresh' || delay === undefined) throw error;
            // A reader may briefly own the project lease. Keep this exact message at the
            // head of the queue; unknown responses and stale observations are not retried.
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      });
    },
  };
}

export function publishEditorWorkspaceState(force = false): void {
  const current = connection;
  if (current === null) return;
  const previousState = current.lastState;
  const state = stateFor(current);
  if (!force && previousState === current.lastState) return;
  void enqueue(current, async () => {
    if (connection !== current) return;
    if (state.workspaceGeneration < stateFor(current).workspaceGeneration) return;
    if (current.writeLeaseId !== null) await current.client.renew({ ...state, writeLeaseId: current.writeLeaseId });
    else await current.client.heartbeat(state);
    if (current.lost) { current.lost = false; onChanged(); }
  }).catch(() => {
    if (connection === current && !current.lost) { current.lost = true; onChanged(); }
  });
}

export async function connectEditorWorkspace(client: EditorWorkspaceClient, root: FileSystemDirectoryHandle,
  loadedBaseline?: ProjectDiskBaseline | null): Promise<void> {
  await disconnectEditorWorkspace();
  const current: Connection = { client, root, sessionId: crypto.randomUUID(), generation: 0, lastState: '',
    baseline: null, latest: null, observedSequence: 0, pendingExternal: false, lost: false,
    saving: false, writeLeaseId: null, lastOwnWriteId: null, tail: Promise.resolve(), timer: null, polling: 0 };
  connection = current;
  try {
    await client.heartbeat(stateFor(current));
    if (loadedBaseline === undefined) await readEditorWorkspaceBaseline();
    else {
      current.baseline = loadedBaseline;
      current.latest = await client.snapshot(current.sessionId);
      current.pendingExternal = loadedBaseline === null
        || loadedBaseline.coordinationRevision !== current.latest.diskBaseline.coordinationRevision;
      current.observedSequence = current.latest.mutationNotice?.sequence ?? 0;
    }
    current.timer = setInterval(() => {
      publishEditorWorkspaceState(true);
      void pollEditorWorkspace().catch(() => {});
    }, 2_000);
    onChanged();
  } catch (error) {
    current.lost = true;
    onChanged();
    throw error;
  }
}

/** Capture before reading buffers; failed reads must not advance their write baseline. */
export async function readEditorWorkspaceBaseline(readProject?: () => Promise<void>): Promise<ProjectDiskBaseline | null> {
  const current = connection;
  if (current === null) { await readProject?.(); return null; }
  const snapshot = await enqueue(current, async () => {
    await current.client.heartbeat(stateFor(current));
    return current.client.snapshot(current.sessionId);
  });
  await readProject?.();
  if (connection !== current) return snapshot.diskBaseline;
  current.baseline = snapshot.diskBaseline;
  current.latest = snapshot;
  current.observedSequence = snapshot.mutationNotice?.sequence ?? 0;
  current.pendingExternal = false;
  current.lost = false;
  return snapshot.diskBaseline;
}

export async function pollEditorWorkspace(force = false): Promise<EditorWorkspaceSnapshot | null> {
  const current = connection;
  if (current === null || (current.polling > 0 && !force) || current.saving || readFacts().projectTransition) return current?.latest ?? null;
  current.polling += 1;
  try {
    const snapshot = await enqueue(current, () => current.client.snapshot(current.sessionId));
    if (connection !== current || current.saving || readFacts().projectTransition) return snapshot;
    current.latest = snapshot;
    current.lost = false;
    const notice = snapshot.mutationNotice;
    if (current.baseline !== null && (snapshot.diskBaseline.coordinationRevision !== current.baseline.coordinationRevision
      || (notice !== null && notice.sequence > current.observedSequence && notice.operationId !== current.lastOwnWriteId))) {
      current.pendingExternal = true;
    }
    onChanged();
    return snapshot;
  } catch (error) {
    if (connection === current) { current.lost = true; onChanged(); }
    throw error;
  } finally {
    current.polling -= 1;
  }
}

export async function beginEditorWorkspaceWrite(): Promise<void> {
  const current = connection;
  if (current === null) return;
  if (current.baseline === null) throw new Error('工作区尚未读取项目基线，请重新连接项目后保存。');
  current.saving = true;
  onChanged();
  try {
    const begun = await enqueue(current, () => current.client.begin({ ...stateFor(current), purpose: 'save-all',
      expectedProjectRevision: current.baseline!.projectRevision, expectedCoordinationRevision: current.baseline!.coordinationRevision }));
    current.writeLeaseId = begun.writeLeaseId;
  } catch (error) {
    current.saving = false;
    if (error instanceof AssetImportClientError && error.code === 'EDITOR_PROJECT_BASELINE_CHANGED') current.pendingExternal = true;
    onChanged();
    throw error;
  }
}

export function currentEditorWorkspaceWrite(): EditorWorkspaceWrite | undefined {
  const current = connection;
  return current?.writeLeaseId ? { ...stateFor(current), writeLeaseId: current.writeLeaseId } : undefined;
}

export async function publishEditorWorkspaceFile(path: string, text: string | null): Promise<boolean> {
  const current = connection;
  if (current === null) return false;
  const write = currentEditorWorkspaceWrite();
  if (write === undefined || current.baseline === null) throw new Error('保存尚未持有项目写入权限。');
  try {
    const result = await current.client.publish({ ...write, path, text, expectedSha256: expectedShaFor(current.baseline, path) });
    const files = current.baseline.files.filter(file => file.path !== path);
    if (result.sha256 !== null) files.push({ path, sha256: result.sha256 });
    current.baseline = { ...current.baseline, files };
    return true;
  } catch (error) {
    if (error instanceof AssetImportClientError && error.code === 'EDITOR_PROJECT_BASELINE_CHANGED') {
      current.pendingExternal = true;
      onChanged();
    }
    throw error;
  }
}

export async function finishEditorWorkspaceWrite(): Promise<string | undefined> {
  const current = connection;
  if (current === null || current.writeLeaseId === null) return;
  const writeLeaseId = current.writeLeaseId;
  try {
    const result = await enqueue(current, async () => {
      current.saving = false;
      return current.client.finish({ ...stateFor(current), writeLeaseId });
    });
    current.baseline = result.diskBaseline;
    current.lastOwnWriteId = writeLeaseId;
    current.lost = false;
    if (result.mutationNotice.status === 'unavailable') return result.mutationNotice.message ?? '文件已保存，但变化通知暂时不可用。';
  } catch (error) {
    current.lost = true;
    throw error;
  } finally {
    current.saving = false;
    current.writeLeaseId = null;
    onChanged();
  }
}

export async function disconnectEditorWorkspace(): Promise<void> {
  const current = connection;
  if (current === null) return;
  connection = null;
  if (current.timer !== null) clearInterval(current.timer);
  await current.tail.catch(() => undefined);
  await current.client.revoke(current.sessionId).catch(() => undefined);
}

export function editorWorkspaceTextChanges() {
  const current = connection;
  if (current?.baseline === null || current?.baseline === undefined || current.latest === null) return null;
  return diffProjectDiskBaselines(current.baseline, current.latest.diskBaseline);
}

/** Publish current local facts before the explicitly requested external write. */
export async function flushEditorWorkspaceState(): Promise<void> {
  const current = connection;
  if (current === null) return;
  try {
    await enqueue(current, async () => {
      if (connection !== current) throw new Error('工作区已经切换，未继续写回。');
      const body = stateFor(current); // Actual dirty/busy facts, never force-clean.
      if (current.writeLeaseId !== null) {
        await current.client.renew({ ...body, writeLeaseId: current.writeLeaseId });
      } else {
        await current.client.heartbeat(body);
      }
      if (connection !== current) throw new Error('工作区已经切换，未继续写回。');
      current.lost = false;
    });
  } catch (error) {
    if (connection === current) { current.lost = true; onChanged(); }
    throw error;
  }
}
