import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createJsonRecord, readJsonRecord, replaceJsonRecord } from '../authoring/node-json-record.js';
import {
  AssetImportAuthorityError,
  type AssetImportAuthorityPaths,
  type AssetImportChallengeJournal,
  type AssetImportJournal,
  type OperationRegistration,
  type RecoveryBarrierIncident,
  type RecoveryBarrierResolution,
} from './types.js';

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validId(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{7,127}$/.test(value);
}

export class AssetImportRecordStore {
  constructor(readonly paths: AssetImportAuthorityPaths) {}

  private operationIndexFile(operationId: string): string {
    if (!validId(operationId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'operationId 格式无效');
    return path.join(this.paths.projectNamespace, 'operation-index', `${operationId}.json`);
  }

  private operationDirectory(operationId: string): string {
    this.operationIndexFile(operationId);
    return path.join(this.paths.projectNamespace, 'operations', operationId);
  }

  private journalFile(operationId: string): string {
    return path.join(this.operationDirectory(operationId), 'journal.json');
  }

  private challengeIndexFile(challengeId: string): string {
    if (!validId(challengeId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'challengeId 格式无效');
    return path.join(this.paths.projectNamespace, 'challenge-index', `${challengeId}.json`);
  }

  private challengeJournalFile(challengeId: string): string {
    this.challengeIndexFile(challengeId);
    return path.join(this.paths.projectNamespace, 'challenges', challengeId, 'journal.json');
  }

  async registerOperation(record: OperationRegistration): Promise<void> {
    const file = this.operationIndexFile(record.operationId);
    const existing = await readJsonRecord<OperationRegistration>(file);
    if (existing !== null) {
      if (equalJson(existing.value, record)) return;
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'operationId 已用于不同导入');
    }
    try {
      await createJsonRecord(file, record);
      await fs.mkdir(this.operationDirectory(record.operationId), { recursive: true, mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return this.registerOperation(record);
      throw error;
    }
  }

  async createInitialJournal(
    operationId: string,
    input: Pick<AssetImportJournal, 'status' | 'itemCount' | 'updatedAt'>,
  ): Promise<AssetImportJournal> {
    if (await readJsonRecord<OperationRegistration>(this.operationIndexFile(operationId)) === null) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '导入操作未登记');
    }
    const journal: AssetImportJournal = {
      schemaVersion: 1,
      operationId,
      journalVersion: 1,
      previousGenerationSha256: null,
      ...input,
    };
    await createJsonRecord(this.journalFile(operationId), journal);
    return journal;
  }

  async readOperation(operationId: string): Promise<{ journal: AssetImportJournal; sha256: string }> {
    const loaded = await readJsonRecord<AssetImportJournal>(this.journalFile(operationId));
    if (loaded === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '导入操作 journal 不存在');
    return { journal: loaded.value, sha256: loaded.identity.sha256 };
  }

  async writeJournal(previous: AssetImportJournal, next: AssetImportJournal): Promise<AssetImportJournal> {
    const current = await this.readOperation(previous.operationId);
    if (!equalJson(current.journal, previous)) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'journal 已被另一状态更新');
    }
    const journal: AssetImportJournal = {
      ...next,
      schemaVersion: 1,
      operationId: previous.operationId,
      journalVersion: previous.journalVersion + 1,
      previousGenerationSha256: current.sha256,
    };
    await replaceJsonRecord(this.journalFile(previous.operationId), journal);
    return journal;
  }

  async listOperations(): Promise<AssetImportJournal[]> {
    const directory = path.join(this.paths.projectNamespace, 'operation-index');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const operations: AssetImportJournal[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const operationId = entry.name.slice(0, -5);
      const loaded = await this.readOperation(operationId).catch((error: unknown) => {
        if (error instanceof AssetImportAuthorityError && error.code === 'IMPORT_OPERATION_NOT_FOUND') return null;
        throw error;
      });
      if (loaded !== null) operations.push(loaded.journal);
    }
    return operations;
  }

  async registerChallenge(journal: AssetImportChallengeJournal): Promise<void> {
    const registration = { challengeId: journal.challengeId, relativeProbePath: journal.relativeProbePath };
    const indexFile = this.challengeIndexFile(journal.challengeId);
    const existing = await readJsonRecord<typeof registration>(indexFile);
    if (existing !== null && !equalJson(existing.value, registration)) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', 'challengeId 已被占用');
    }
    if (existing === null) await createJsonRecord(indexFile, registration);
    const journalFile = this.challengeJournalFile(journal.challengeId);
    const current = await readJsonRecord<AssetImportChallengeJournal>(journalFile);
    if (current === null) await createJsonRecord(journalFile, journal);
  }

  async readChallenge(challengeId: string): Promise<{ journal: AssetImportChallengeJournal; sha256: string }> {
    const loaded = await readJsonRecord<AssetImportChallengeJournal>(this.challengeJournalFile(challengeId));
    if (loaded === null) throw new AssetImportAuthorityError('IMPORT_OPERATION_NOT_FOUND', '绑定 challenge 不存在');
    return { journal: loaded.value, sha256: loaded.identity.sha256 };
  }

  async writeChallengeJournal(
    previous: AssetImportChallengeJournal,
    status: AssetImportChallengeJournal['status'],
  ): Promise<AssetImportChallengeJournal> {
    const current = await this.readChallenge(previous.challengeId);
    if (!equalJson(current.journal, previous)) {
      throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '绑定 challenge 已被更新');
    }
    const next: AssetImportChallengeJournal = {
      ...previous,
      journalVersion: previous.journalVersion + 1,
      previousGenerationSha256: current.sha256,
      status,
    };
    await replaceJsonRecord(this.challengeJournalFile(previous.challengeId), next);
    return next;
  }

  async listChallenges(): Promise<AssetImportChallengeJournal[]> {
    const directory = path.join(this.paths.projectNamespace, 'challenge-index');
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const result: AssetImportChallengeJournal[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const challengeId = entry.name.slice(0, -5);
      const challenge = await this.readChallenge(challengeId);
      result.push(challenge.journal);
    }
    return result;
  }

  async writeBarrier(incident: RecoveryBarrierIncident): Promise<void> {
    if (!validId(incident.barrierId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'barrierId 格式无效');
    await createJsonRecord(
      path.join(this.paths.projectNamespace, 'recovery-barriers', `${incident.barrierId}.json`),
      incident,
    );
  }

  async resolveBarrier(resolution: RecoveryBarrierResolution): Promise<void> {
    if (!validId(resolution.barrierId)) throw new AssetImportAuthorityError('INVALID_REQUEST', 'barrierId 格式无效');
    await createJsonRecord(
      path.join(this.paths.projectNamespace, 'recovery-resolutions', `${resolution.barrierId}.json`),
      resolution,
    );
  }

  async hasUnresolvedBarrier(): Promise<boolean> {
    const barrierDirectory = path.join(this.paths.projectNamespace, 'recovery-barriers');
    const entries = await fs.readdir(barrierDirectory, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const resolution = path.join(this.paths.projectNamespace, 'recovery-resolutions', entry.name);
      if (await fs.stat(resolution).then(() => false).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
        throw error;
      })) return true;
    }
    return false;
  }
}
