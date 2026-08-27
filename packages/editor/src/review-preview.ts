import { stableStringify, type HumanReviewProjection } from '@surdet/authoring';
import { state } from './state.js';
import { openProjectFromHandle } from './project-io.js';
import type { ReviewWorkspaceState } from './review-workspace.js';

export interface ReviewPreviewRequest {
  sceneId?: string;
  choices?: Record<string, string>;
  timelineId?: string;
}

export interface ReviewPreviewResult {
  sceneId: string;
  choices: Record<string, string>;
  timelineId: string | null;
  treeSha256: string;
  fixtureChanged: boolean;
}

export type ReviewBytesHasher = (bytes: Uint8Array) => Promise<string>;

interface DirectoryLike {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
}

interface FileLike {
  kind: 'file';
  name: string;
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

interface FixtureFileIdentity {
  path: string;
  bytes: number;
  sha256: string;
}

interface FixtureFileData {
  path: string;
  bytes: Uint8Array;
}

const officialFixtureSnapshots = new WeakMap<ReviewWorkspaceState, Map<string, Uint8Array>>();

async function defaultBytesHasher(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error('当前浏览器不支持 SHA-256');
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const digest = await subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function asDirectory(value: FileSystemDirectoryHandle): DirectoryLike {
  return value as unknown as DirectoryLike;
}

function asFile(value: FileSystemFileHandle): FileLike {
  return value as unknown as FileLike;
}

function relativeFilePath(path: string): void {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\')
    || path.split('/').some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error(`review fixture 相对路径不安全：${path}`);
  }
}

async function readReviewFixtureFiles(root: FileSystemDirectoryHandle): Promise<FixtureFileData[]> {
  const files: FixtureFileData[] = [];
  const visit = async (directory: DirectoryLike, prefix: string): Promise<void> => {
    const entries: Array<FileSystemDirectoryHandle | FileSystemFileHandle> = [];
    for await (const entry of directory.values()) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      relativeFilePath(relativePath);
      if (entry.kind === 'directory') {
        await visit(asDirectory(entry), relativePath);
      } else {
        const file = await asFile(entry).getFile();
        files.push({ path: relativePath, bytes: new Uint8Array(await file.arrayBuffer()) });
      }
    }
  };
  await visit(asDirectory(root), '');
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function treeIdentityOf(
  files: readonly FixtureFileData[],
  hasher: ReviewBytesHasher,
): Promise<string> {
  const identities: FixtureFileIdentity[] = [];
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    identities.push({ path: file.path, bytes: file.bytes.byteLength, sha256: await hasher(file.bytes) });
  }
  return hasher(new TextEncoder().encode(stableStringify(identities)));
}

/** 使用与 CLI fixture identity 相同的 path/bytes/file-SHA 投影，不包含绝对路径或时间戳。 */
export async function hashReviewFixtureTree(
  root: FileSystemDirectoryHandle,
  hasher: ReviewBytesHasher = defaultBytesHasher,
): Promise<string> {
  return treeIdentityOf(await readReviewFixtureFiles(root), hasher);
}

function sceneIdFromObjectRef(objectRef: string): string | null {
  if (!objectRef.startsWith('scene:')) return null;
  const value = objectRef.slice('scene:'.length);
  const slash = value.indexOf('/');
  return slash < 0 ? value : value.slice(0, slash);
}

export function selectReviewPreviewScene(
  sceneIds: readonly string[],
  projection: HumanReviewProjection,
  requestedSceneId: string | undefined,
): string | null {
  if (requestedSceneId !== undefined && sceneIds.includes(requestedSceneId)) return requestedSceneId;
  const changedObjects = projection.finalResult?.changedObjects && projection.finalResult.changedObjects.length > 0
    ? projection.finalResult.changedObjects
    : projection.objects;
  for (const object of changedObjects) {
    if (object.kind !== 'scene') continue;
    const sceneId = sceneIdFromObjectRef(object.objectRef) ?? object.semanticId?.replace(/^scene:/, '');
    if (sceneId !== undefined && sceneIds.includes(sceneId)) return sceneId;
  }
  return sceneIds[0] ?? null;
}

export function buildReviewPreviewRequest(
  projection: HumanReviewProjection,
  request: ReviewPreviewRequest,
): ReviewPreviewRequest {
  void projection;
  return {
    ...(request.sceneId === undefined ? {} : { sceneId: request.sceneId }),
    ...(request.choices === undefined ? {} : { choices: { ...request.choices } }),
    ...(request.timelineId === undefined ? {} : { timelineId: request.timelineId }),
  };
}

export function reconcileReviewTraceEvidence(
  projection: HumanReviewProjection,
  observedTraceIds: readonly string[],
): { matched: string[]; missing: string[]; unexpected: string[] } {
  const expected = projection.finalResult?.evidence.runtimeTraceIds ?? [];
  const observed = [...new Set(observedTraceIds)];
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  return {
    matched: expected.filter((id) => observedSet.has(id)),
    missing: expected.filter((id) => !observedSet.has(id)),
    unexpected: observed.filter((id) => !expectedSet.has(id)),
  };
}

export function markReviewFixtureChanged(workspace: ReviewWorkspaceState, currentTreeSha256: string): void {
  workspace.currentResultTreeSha256 = currentTreeSha256;
  workspace.fixtureChanged = workspace.officialResultTreeSha256 === null
    || workspace.officialResultTreeSha256 !== currentTreeSha256;
}

export function reloadOfficialResult(workspace: ReviewWorkspaceState): void {
  workspace.currentResultTreeSha256 = workspace.officialResultTreeSha256;
  workspace.fixtureChanged = false;
}

async function writeReviewFixtureFile(
  root: FileSystemDirectoryHandle,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const parts = relativePath.split('/');
  const fileName = parts.pop();
  if (!fileName) throw new Error(`review fixture 文件名为空：${relativePath}`);
  let directory = root;
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  await writable.write(input);
  await writable.close();
}

async function removeReviewFixtureExtras(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  officialPaths: ReadonlySet<string>,
): Promise<void> {
  const entries: Array<FileSystemDirectoryHandle | FileSystemFileHandle> = [];
  for await (const entry of (directory as unknown as DirectoryLike).values()) entries.push(entry);
  for (const entry of entries) {
    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.kind === 'directory') {
      await removeReviewFixtureExtras(entry, relativePath, officialPaths);
      continue;
    }
    if (!officialPaths.has(relativePath)) await directory.removeEntry(entry.name);
  }
}

/** 将 result/project 恢复到首次打开时的正式快照；只触碰 fixture，不写回 integration change。 */
export async function restoreOfficialResult(
  workspace: ReviewWorkspaceState,
  hasher: ReviewBytesHasher = defaultBytesHasher,
): Promise<void> {
  if (workspace.projectHandle === null) {
    reloadOfficialResult(workspace);
    return;
  }
  const snapshot = officialFixtureSnapshots.get(workspace);
  if (snapshot === undefined) throw new Error('尚未建立正式 result fixture 快照，请先预览正式结果');
  await removeReviewFixtureExtras(workspace.projectHandle, '', new Set(snapshot.keys()));
  for (const [relativePath, bytes] of snapshot) await writeReviewFixtureFile(workspace.projectHandle, relativePath, bytes);
  const restored = await hashReviewFixtureTree(workspace.projectHandle, hasher);
  if (workspace.officialResultTreeSha256 !== null && restored !== workspace.officialResultTreeSha256) {
    throw new Error('正式 result fixture 恢复后 tree identity 不一致');
  }
  reloadOfficialResult(workspace);
}

export async function refreshReviewFixtureIdentity(
  workspace: ReviewWorkspaceState,
  hasher: ReviewBytesHasher = defaultBytesHasher,
): Promise<boolean> {
  if (workspace.projectHandle === null || workspace.officialResultTreeSha256 === null) return false;
  const files = await readReviewFixtureFiles(workspace.projectHandle);
  const current = await treeIdentityOf(files, hasher);
  if (current === workspace.officialResultTreeSha256 && !officialFixtureSnapshots.has(workspace)) {
    officialFixtureSnapshots.set(workspace, new Map(files.map((file) => [file.path, file.bytes.slice()])));
  }
  markReviewFixtureChanged(workspace, current);
  return workspace.fixtureChanged;
}

export async function openReviewPreview(
  workspace: ReviewWorkspaceState,
  request: ReviewPreviewRequest = {},
  hasher: ReviewBytesHasher = defaultBytesHasher,
): Promise<ReviewPreviewResult> {
  if (workspace.identity.kind !== 'integration-result' || workspace.projectHandle === null) {
    throw new Error('当前审阅没有可预览的 result/project fixture');
  }
  await openProjectFromHandle(workspace.projectHandle, { source: 'review-fixture' });
  const sceneIds = [...state.scenes.values()].map((scene) => scene.id);
  const sceneId = selectReviewPreviewScene(sceneIds, workspace.projection, request.sceneId);
  if (sceneId === null) throw new Error('result fixture 没有可运行场景');
  const sceneKey = [...state.scenes.entries()].find(([, scene]) => scene.id === sceneId)?.[0];
  if (sceneKey === undefined) throw new Error(`result fixture 缺少场景：${sceneId}`);
  state.current = sceneKey;
  state.previewTimelineId = request.timelineId ?? null;
  state.previewChoices = request.choices === undefined ? null : { ...request.choices };
  state.previewTrace = [];
  state.selectedTraceStep = null;
  await refreshReviewFixtureIdentity(workspace, hasher);
  return {
    sceneId,
    choices: { ...(request.choices ?? {}) },
    timelineId: state.previewTimelineId,
    treeSha256: workspace.currentResultTreeSha256 ?? '',
    fixtureChanged: workspace.fixtureChanged,
  };
}
