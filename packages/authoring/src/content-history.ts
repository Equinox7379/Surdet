import { AuthoringOperationError, runOperation, type ChangeSession } from './change-session.js';
import { compareCanonicalText } from './canonical-order.js';
import { isSnapshotPath, normalizeProjectPath, type ProjectStorage, type TextHasher } from './project-storage.js';
import type { ProjectContentSnapshot } from './project-snapshot.js';

/** Saved authoring text only; package identity, assets and engine files are excluded. */
export function isContentHistoryPath(path: string): boolean {
  return isSnapshotPath(path) || path === 'content/config/achievements.json';
}

export interface ContentHistorySummary {
  checkpointId: string;
  label: string;
  createdAt: string;
  contentRevision: string;
  projectRevision: string;
  fingerprint: string;
  fileCount: number;
}

export interface ContentHistoryIndex {
  contentRevision: string;
  checkpoints: ContentHistorySummary[];
}

export interface ContentHistoryFileDiff {
  path: string;
  currentSha256: string | null;
  historicalSha256: string | null;
  /** Full text is returned only when this path was explicitly requested. */
  currentText?: string | null;
  historicalText?: string | null;
}

export interface ContentHistoryComparison {
  checkpoint: ContentHistorySummary;
  contentRevision: string;
  workingRevision?: number;
  files: ContentHistoryFileDiff[];
}

export interface ContentHistoryRestoreInput {
  operationId: string;
  checkpointId: string;
  expectedFingerprint: string;
  expectedContentRevision: string;
  expectedWorkingRevision: number;
  paths: string[];
}

export async function contentTextRevision(files: Record<string, string>, hasher: TextHasher): Promise<string> {
  const entries = await Promise.all(Object.keys(files).filter(isContentHistoryPath).sort(compareCanonicalText)
    .map(async path => `${path}\0${await hasher.sha256(files[path]!)}`));
  return hasher.sha256(entries.join('\n'));
}

/** Keep the existing canonical project revision unchanged, including its path set. */
export async function loadSavedContent(storage: ProjectStorage, hasher: TextHasher): Promise<ProjectContentSnapshot & { contentRevision: string }> {
  const paths = [...new Set((await storage.listFiles()).filter(isContentHistoryPath).map(normalizeProjectPath))].sort(compareCanonicalText);
  const files = await Promise.all(paths.map(path => storage.readText(path)));
  for (const file of files) {
    if (await hasher.sha256(file.text) !== file.sha256) {
      throw new AuthoringOperationError('PROJECT_INVALID', `内容文件不是可无损读取的 UTF-8 文本：${file.path}；请先修正编码`);
    }
  }
  const revision = await hasher.sha256(files.filter(file => isSnapshotPath(file.path)).map(file => `${file.path}\0${file.sha256}`).join('\n'));
  const contentRevision = await hasher.sha256(files.map(file => `${file.path}\0${file.sha256}`).join('\n'));
  return { rootIdentity: storage.rootIdentity, revision, contentRevision, files };
}

export function assertHistoryPaths(paths: string[], historicalFiles: Record<string, string>): void {
  if (paths.length === 0 || new Set(paths).size !== paths.length) throw new AuthoringOperationError('INVALID_REQUEST', '请选择不重复的历史文件');
  for (const path of paths) {
    normalizeProjectPath(path);
    if (!isContentHistoryPath(path) || !Object.hasOwn(historicalFiles, path)) {
      throw new AuthoringOperationError('INVALID_REQUEST', `历史中没有可恢复的内容文件：${path}；恢复不会删除当前新增文件`);
    }
  }
}

export async function restoreContentHistory(change: ChangeSession, input: ContentHistoryRestoreInput,
  readHistory: () => Promise<{ fingerprint: string; files: Record<string, string> }>, hasher: TextHasher) {
  if (change.record.integration !== undefined || change.record.composition?.mode !== 'direct') {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '历史恢复仅支持普通 direct 草稿，请另建普通草稿');
  }
  return runOperation(change, input, async () => {
    const historical = await readHistory();
    if (historical.fingerprint !== input.expectedFingerprint
      || change.record.workingRevision !== input.expectedWorkingRevision
      || await contentTextRevision(change.record.workingFiles, hasher) !== input.expectedContentRevision) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', '历史版本或当前草稿已变化，请重新查看差异');
    }
    assertHistoryPaths(input.paths, historical.files);
    if (input.paths.includes('content/config/achievements.json')) {
      let achievements: unknown;
      try { achievements = JSON.parse(historical.files['content/config/achievements.json']!.replace(/^\uFEFF/, '')); }
      catch { throw new AuthoringOperationError('VALIDATION_FAILED', '历史成就配置不是有效 JSON'); }
      if (!Array.isArray(achievements) || achievements.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new AuthoringOperationError('VALIDATION_FAILED', '历史成就配置必须是成就对象数组');
      }
    }
    const workingFiles = { ...change.record.workingFiles };
    const changedPaths = input.paths.filter(path => workingFiles[path] !== historical.files[path]);
    for (const path of changedPaths) workingFiles[path] = historical.files[path]!;
    return { workingFiles, changed: changedPaths.length > 0,
      result: { checkpointId: input.checkpointId, paths: changedPaths } };
  });
}
