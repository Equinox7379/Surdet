import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ChangeRecord, CommitJournal, ProjectFile, ProjectWriteStorage, RecoveryInspection } from '../src/contracts.js';
import { InMemoryChangeRepository, beginChange } from '../src/change-session.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { executeTransactionRecovery, inspectTransactionRecovery } from '../src/transaction-recovery.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const hasher = { sha256: async (value: string) => sha256(value) };

class RecoveryStorage implements ProjectWriteStorage {
  readonly rootIdentity = 'recovery-fixture-root';
  readonly staged = new Map<string, string>();
  readonly files: Record<string, string>;
  removeStageCalls = 0;
  restoreCalls = 0;
  removePathCalls = 0;

  constructor(files: Record<string, string>) {
    this.files = { ...files };
  }

  async listFiles(): Promise<string[]> { return Object.keys(this.files).sort(); }

  async readText(path: string): Promise<ProjectFile> {
    const text = this.files[path];
    if (text === undefined) throw new Error(`missing file: ${path}`);
    return { path, text, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text) };
  }

  async exists(path: string): Promise<boolean> { return this.files[path] !== undefined; }

  async stageText(path: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }> {
    const stagedIdentity = `/project/.surdet-${changeId}-${this.staged.size}.tmp`;
    this.staged.set(stagedIdentity, text);
    return { stagedIdentity, sha256: sha256(text) };
  }

  async replaceFromStage(path: string, stagedIdentity: string): Promise<void> {
    const text = this.staged.get(stagedIdentity);
    if (text === undefined) throw new Error(`missing stage: ${stagedIdentity}`);
    this.files[path] = text;
  }

  async restoreText(path: string, text: string): Promise<void> {
    this.restoreCalls += 1;
    this.files[path] = text;
  }

  async removePath(path: string): Promise<void> {
    this.removePathCalls += 1;
    delete this.files[path];
  }

  async removeStage(stagedIdentity: string): Promise<void> {
    this.removeStageCalls += 1;
    this.staged.delete(stagedIdentity);
  }
}

const basePath = 'content/scenario/base.gal';
const newPath = 'content/scenario/new.gal';
const baseText = '@scene base\n凛：原始。\n@end\n';
const targetText = '@scene new\n凛：目标。\n@end\n';
const originalSha256 = sha256(baseText);
const targetSha256 = sha256(targetText);

async function fixture(actual: 'base' | 'target' | 'mixed' | 'unexpected'): Promise<{
  change: Awaited<ReturnType<typeof beginChange>>;
  storage: RecoveryStorage;
  journal: CommitJournal;
}> {
  const storage = new RecoveryStorage({
    'game.config.json': '{"entryScene":"base","variables":{}}',
    [basePath]: baseText,
  });
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const repository = new InMemoryChangeRepository();
  const change = await beginChange(snapshot, repository, storage);
  change.record.workingFiles[newPath] = targetText;
  if (actual === 'target') {
    storage.files[basePath] = targetText;
    storage.files[newPath] = targetText;
  }
  if (actual === 'mixed') storage.files[newPath] = targetText;
  if (actual === 'unexpected') storage.files[basePath] = 'unexpected external content\n';
  const journal: CommitJournal = {
    formatVersion: 2,
    journalVersion: 3,
    changeId: change.record.changeId,
    recordVersionAtCommitStart: change.record.recordVersion,
    projectRevisionAtCommitStart: change.record.baseRevision,
    status: 'REPLACING',
    files: [
      {
        path: basePath,
        originalSha256,
        targetSha256,
        stagedIdentity: `/project/.surdet-${change.record.changeId}-0.tmp`,
        replaced: true,
        restored: false,
      },
      {
        path: newPath,
        targetSha256,
        stagedIdentity: `/project/.surdet-${change.record.changeId}-1.tmp`,
        replaced: true,
        restored: false,
      },
    ],
  };
  return { change, storage, journal };
}

const cases = [
  { name: 'STAGING + project base', journalStatus: 'STAGING', actual: 'base', expected: 'REOPEN_OPEN', states: ['original', 'absent-expected'] },
  { name: 'REPLACING + all targets known', journalStatus: 'REPLACING', actual: 'target', expected: 'ROLL_BACK_TO_BASE', states: ['target', 'target'] },
  { name: 'RECOVERY_FAILED + mixed original/target known', journalStatus: 'RECOVERY_FAILED', actual: 'mixed', expected: 'ROLL_BACK_TO_BASE', states: ['original', 'target'] },
  { name: 'COMMITTED journal + all target', journalStatus: 'COMMITTED', actual: 'target', expected: 'FINALIZE_COMMITTED', states: ['target', 'target'] },
  { name: 'RECOVERED journal + all base', journalStatus: 'RECOVERED', actual: 'base', expected: 'REOPEN_OPEN', states: ['original', 'absent-expected'] },
  { name: 'REPLACING + one unexpected sha', journalStatus: 'REPLACING', actual: 'unexpected', expected: 'MANUAL_RECOVERY_REQUIRED', states: ['unexpected', 'absent-expected'] },
] as const;

describe('shared transaction recovery matrix', () => {
  it.each(cases)('$name', async ({ journalStatus, actual, expected, states }) => {
    const { change, storage, journal } = await fixture(actual);
    const inspection = await inspectTransactionRecovery({
      record: change.record,
      journal: { ...journal, status: journalStatus },
      storage,
      leaseState: 'free',
      sha256: hasher.sha256,
    });
    expect(inspection.disposition).toBe(expected);
    expect(inspection.manualRecoveryRequired).toBe(expected === 'MANUAL_RECOVERY_REQUIRED');
    expect(inspection.fileStates.map((state) => state.state)).toEqual(states);
    expect(inspection.recoveryToken).toEqual(expect.any(String));
  });

  it('does not write when inspection finds an unexpected file', async () => {
    const { change, storage, journal } = await fixture('unexpected');
    const inspection: RecoveryInspection = await inspectTransactionRecovery({
      record: change.record,
      journal,
      storage,
      leaseState: 'free',
      sha256: hasher.sha256,
    });
    const beforeFiles = { ...storage.files };
    await expect(executeTransactionRecovery({
      change,
      journal,
      storage,
      inspection,
      recoveryToken: inspection.recoveryToken!,
      operationId: 'recover-unexpected',
    })).rejects.toMatchObject({ code: 'RECOVERY_AMBIGUOUS' });
    expect(storage.files).toEqual(beforeFiles);
    expect(storage.restoreCalls).toBe(0);
    expect(storage.removePathCalls).toBe(0);
    expect(storage.removeStageCalls).toBe(0);
  });

  it('executes the safe recovery actions and keeps operationId idempotent', async () => {
    const staging = await fixture('base');
    const stagingJournal = { ...staging.journal, status: 'STAGING' as const };
    const stagingInspection = await inspectTransactionRecovery({
      record: staging.change.record,
      journal: stagingJournal,
      storage: staging.storage,
      leaseState: 'free',
      sha256: hasher.sha256,
    });
    const reopened = await executeTransactionRecovery({
      change: staging.change,
      journal: stagingJournal,
      storage: staging.storage,
      inspection: stagingInspection,
      recoveryToken: stagingInspection.recoveryToken!,
      operationId: 'recover-staging',
    });
    expect(reopened).toEqual({ changeId: staging.change.record.changeId, status: 'OPEN', disposition: 'REOPEN_OPEN' });
    expect(staging.storage.removeStageCalls).toBe(2);
    expect(staging.change.record.status).toBe('OPEN');
    expect(await executeTransactionRecovery({
      change: staging.change,
      journal: stagingJournal,
      storage: staging.storage,
      inspection: stagingInspection,
      recoveryToken: stagingInspection.recoveryToken!,
      operationId: 'recover-staging',
    })).toEqual(reopened);
    expect(staging.storage.removeStageCalls).toBe(2);
    await expect(executeTransactionRecovery({
      change: staging.change,
      journal: stagingJournal,
      storage: staging.storage,
      inspection: stagingInspection,
      recoveryToken: 'different-token',
      operationId: 'recover-staging',
    })).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });

    const rollback = await fixture('target');
    const rollbackInspection = await inspectTransactionRecovery({
      record: rollback.change.record,
      journal: rollback.journal,
      storage: rollback.storage,
      leaseState: 'free',
      sha256: hasher.sha256,
    });
    const rolledBack = await executeTransactionRecovery({
      change: rollback.change,
      journal: rollback.journal,
      storage: rollback.storage,
      inspection: rollbackInspection,
      recoveryToken: rollbackInspection.recoveryToken!,
      operationId: 'recover-replacing',
    });
    expect(rolledBack.disposition).toBe('ROLL_BACK_TO_BASE');
    expect(rollback.storage.files[basePath]).toBe(baseText);
    expect(rollback.storage.files[newPath]).toBeUndefined();
    expect(rollback.storage.restoreCalls).toBe(1);
    expect(rollback.storage.removePathCalls).toBe(1);
    expect(rollback.change.record.status).toBe('OPEN');

    const committed = await fixture('target');
    const committedJournal = { ...committed.journal, status: 'COMMITTED' as const };
    const committedInspection = await inspectTransactionRecovery({
      record: committed.change.record,
      journal: committedJournal,
      storage: committed.storage,
      leaseState: 'free',
      sha256: hasher.sha256,
    });
    const finalized = await executeTransactionRecovery({
      change: committed.change,
      journal: committedJournal,
      storage: committed.storage,
      inspection: committedInspection,
      recoveryToken: committedInspection.recoveryToken!,
      operationId: 'recover-committed',
    });
    expect(finalized).toMatchObject({ status: 'COMMITTED', disposition: 'FINALIZE_COMMITTED' });
    expect(committed.change.record.status).toBe('COMMITTED');
    expect(committed.storage.removeStageCalls).toBe(2);
  });

  it('rejects a recovery plan after project facts change', async () => {
    const { change, storage, journal } = await fixture('target');
    const inspection = await inspectTransactionRecovery({
      record: change.record,
      journal,
      storage,
      leaseState: 'free',
      sha256: hasher.sha256,
    });
    storage.files[basePath] = 'changed after inspect\n';
    await expect(executeTransactionRecovery({
      change,
      journal,
      storage,
      inspection,
      recoveryToken: inspection.recoveryToken!,
      operationId: 'recover-stale-plan',
    })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_STALE' });
    expect(storage.restoreCalls).toBe(0);
    expect(storage.removePathCalls).toBe(0);
  });
});
