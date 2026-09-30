import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  AuthoringOperationError, contentTextRevision, isContentHistoryPath, isSnapshotPath, loadSavedContent, normalizeProjectPath,
  type ContentHistoryComparison, type ContentHistoryIndex, type ContentHistorySummary,
} from '@surdet/authoring';
import { NodeProjectStorage } from './node-project-storage.js';
import { NodeChangeStore } from './node-change-store.js';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { createJsonRecord, readJsonRecord } from './node-json-record.js';

const hasher = { sha256: async (text: string) => createHash('sha256').update(text, 'utf8').digest('hex') };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
interface Checkpoint {
  formatVersion: 1;
  projectRootIdentity: string;
  checkpointId: string;
  label: string;
  createdAt: string;
  contentRevision: string;
  projectRevision: string;
  files: Record<string, string>;
}
export interface CheckpointInput { operationId: string; label: string; expectedContentRevision: string }
export interface HistoryCompareInput { checkpointId: string; path?: string; expectedFingerprint?: string }

/** Uses the existing project namespace and project lease; records are immutable. */
export class ContentHistoryService {
  constructor(private readonly leaseManager = new NodeLocalLeaseManager()) {}

  private async directory(root: string): Promise<string> {
    return path.join((await NodeChangeStore.forProject(root, this.leaseManager.dataRoot)).projectDirectory, 'content-history');
  }

  async read(root: string, id: string): Promise<{ summary: ContentHistorySummary; files: Record<string, string> }> {
    if (!uuid.test(id)) throw new AuthoringOperationError('INVALID_REQUEST', '历史版本标识无效');
    const file = path.join(await this.directory(root), `${id}.json`);
    const stored = await readJsonRecord<Checkpoint>(file);
    if (stored === null) throw new AuthoringOperationError('OBJECT_NOT_FOUND', `历史版本不存在：${id}`);
    const value = stored.value;
    if (!value || value.formatVersion !== 1 || value.projectRootIdentity !== root || value.checkpointId !== id
      || typeof value.label !== 'string' || typeof value.createdAt !== 'string'
      || typeof value.projectRevision !== 'string' || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)
      || Object.entries(value.files).some(([p, text]) => !isContentHistoryPath(p) || typeof text !== 'string')) {
      throw new AuthoringOperationError('CHANGE_STORE_CORRUPT', `历史记录损坏，原文件已保留：${file}`);
    }
    for (const p of Object.keys(value.files)) normalizeProjectPath(p);
    if (await contentTextRevision(value.files, hasher) !== value.contentRevision
      || await contentTextRevision(Object.fromEntries(Object.entries(value.files).filter(([path]) => isSnapshotPath(path))), hasher) !== value.projectRevision) {
      throw new AuthoringOperationError('CHANGE_STORE_CORRUPT', `历史正文与记录版本不符，原文件已保留：${file}`);
    }
    const { checkpointId, label, createdAt, contentRevision, projectRevision } = value;
    return { summary: { checkpointId, label, createdAt, contentRevision, projectRevision,
      fingerprint: stored.identity.sha256, fileCount: Object.keys(value.files).length }, files: value.files };
  }

  async list(root: string): Promise<ContentHistoryIndex> {
    const storage = await NodeProjectStorage.open(root);
    const directory = await this.directory(storage.rootIdentity);
    const names = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [] as string[];
      throw error;
    });
    const checkpoints: ContentHistorySummary[] = [];
    for (const name of names.filter(name => name.endsWith('.json'))) {
      checkpoints.push((await this.read(storage.rootIdentity, name.slice(0, -5))).summary);
    }
    checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.checkpointId.localeCompare(b.checkpointId));
    const current = await this.leaseManager.withProjectLease(storage.rootIdentity, () => loadSavedContent(storage, hasher));
    return { contentRevision: current.contentRevision, checkpoints };
  }

  async checkpoint(root: string, input: CheckpointInput): Promise<ContentHistorySummary> {
    if (!uuid.test(input.operationId) || !input.label.trim() || input.label.length > 200) {
      throw new AuthoringOperationError('INVALID_REQUEST', '请提供 UUID 操作标识和不超过 200 字的版本名称');
    }
    const storage = await NodeProjectStorage.open(root);
    return this.leaseManager.withProjectLease(storage.rootIdentity, async () => {
      const file = path.join(await this.directory(storage.rootIdentity), `${input.operationId}.json`);
      if (await readJsonRecord(file) !== null) {
        const previous = await this.read(storage.rootIdentity, input.operationId);
        if (previous.summary.label !== input.label || previous.summary.contentRevision !== input.expectedContentRevision) {
          throw new AuthoringOperationError('OPERATION_ID_CONFLICT', '该操作标识已用于另一份历史记录');
        }
        return previous.summary;
      }
      const current = await loadSavedContent(storage, hasher);
      if (current.contentRevision !== input.expectedContentRevision
        || (await loadSavedContent(storage, hasher)).contentRevision !== current.contentRevision) {
        throw new AuthoringOperationError('OBJECT_REF_STALE', '已保存内容发生变化，请刷新后再记录版本');
      }
      const record: Checkpoint = { formatVersion: 1, projectRootIdentity: storage.rootIdentity,
        checkpointId: input.operationId, label: input.label, createdAt: new Date().toISOString(),
        contentRevision: current.contentRevision, projectRevision: current.revision,
        files: Object.fromEntries(current.files.map(file => [file.path, file.text])) };
      await createJsonRecord(file, record);
      return (await this.read(storage.rootIdentity, input.operationId)).summary;
    });
  }

  async compare(root: string, input: HistoryCompareInput,
    working?: { files: Record<string, string>; revision: number }): Promise<ContentHistoryComparison> {
    const storage = await NodeProjectStorage.open(root);
    const historical = await this.read(storage.rootIdentity, input.checkpointId);
    if (input.expectedFingerprint !== undefined && input.expectedFingerprint !== historical.summary.fingerprint) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', '历史文件已变化，请重新选择历史版本');
    }
    const current = working?.files ?? await this.leaseManager.withProjectLease(storage.rootIdentity, async () =>
      Object.fromEntries((await loadSavedContent(storage, hasher)).files.map(file => [file.path, file.text])));
    if (input.path !== undefined && (!isContentHistoryPath(normalizeProjectPath(input.path))
      || !Object.hasOwn(current, input.path) && !Object.hasOwn(historical.files, input.path))) {
      throw new AuthoringOperationError('OBJECT_NOT_FOUND', '指定路径不在当前内容或所选历史中');
    }
    const paths = input.path === undefined
      ? [...new Set([...Object.keys(current), ...Object.keys(historical.files)])].filter(isContentHistoryPath).sort()
      : [input.path];
    return { checkpoint: historical.summary, contentRevision: await contentTextRevision(current, hasher),
      ...(working === undefined ? {} : { workingRevision: working.revision }),
      files: await Promise.all(paths.map(async path => {
        const before = current[path] ?? null, after = historical.files[path] ?? null;
        return { path, currentSha256: before === null ? null : await hasher.sha256(before),
          historicalSha256: after === null ? null : await hasher.sha256(after),
          ...(input.path === undefined ? {} : { currentText: before, historicalText: after }) };
      })) };
  }
}
