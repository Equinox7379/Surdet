import { describe, expect, it } from 'vitest';
import type { ChangeRecord } from '../src/contracts.js';
import type { ProjectFile, ProjectStorage, ProjectWriteStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import {
  InMemoryChangeRepository,
  assertBaseStillMatches,
  approvalBindingFingerprintOf,
  beginChange,
  commitChange,
  recordDiffEvidence,
  recordRuntimeTrace,
  recordSimulationEvidence,
  recordValidation,
  updateIntegrationMetadata,
} from '../src/change-session.js';
import type { IntegrationMetadata } from '../src/integration-execution.js';
import { applySceneCreate, ensureVariable } from '../src/operations.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

function isCommittedJournal(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && (value as { status?: unknown }).status === 'COMMITTED';
}

class PersistedCommitEventRepository extends InMemoryChangeRepository {
  readonly journalVersions: number[] = [];

  constructor(private readonly events: string[]) {
    super();
  }

  override async writeJournal(changeId: string, value: unknown): Promise<void> {
    await super.writeJournal(changeId, value);
    if (typeof value === 'object' && value !== null && typeof (value as { journalVersion?: unknown }).journalVersion === 'number') {
      this.journalVersions.push((value as { journalVersion: number }).journalVersion);
    }
    if (isCommittedJournal(value)) this.events.push('journal-persisted:COMMITTED');
  }

  override async write(record: ChangeRecord): Promise<void> {
    await super.write(record);
    if (record.status === 'COMMITTED') this.events.push('record-persisted:COMMITTED');
  }
}

class FaultyWriteStorage implements ProjectWriteStorage {
  readonly rootIdentity = 'fixture-root';
  readonly staged = new Map<string, { path: string; text: string; sha256: string }>();
  replaceCount = 0;
  constructor(
    readonly files: Record<string, string>,
    readonly failReplaceAt = 2,
    readonly failRestore = false,
  ) {}
  async listFiles(): Promise<string[]> { return Object.keys(this.files); }
  async readText(path: string): Promise<ProjectFile> {
    const text = this.files[path];
    if (text === undefined) throw new Error(`missing file: ${path}`);
    return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
  }
  async exists(path: string): Promise<boolean> { return path in this.files; }
  async stageText(path: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }> {
    const stagedIdentity = `${changeId}-${this.staged.size}`;
    const sha256 = await hasher.sha256(text);
    this.staged.set(stagedIdentity, { path, text, sha256 });
    return { stagedIdentity, sha256 };
  }
  async replaceFromStage(path: string, stagedIdentity: string): Promise<void> {
    this.replaceCount++;
    if (this.replaceCount === this.failReplaceAt) throw new Error('injected replace failure');
    const staged = this.staged.get(stagedIdentity);
    if (!staged || staged.path !== path) throw new Error('missing stage');
    this.files[path] = staged.text;
  }
  async restoreText(path: string, originalText: string): Promise<void> {
    if (this.failRestore) throw new Error('injected restore failure');
    this.files[path] = originalText;
  }
  async removePath(path: string): Promise<void> {
    if (this.failRestore) throw new Error('injected remove failure');
    delete this.files[path];
  }
  async removeStage(stagedIdentity: string): Promise<void> { this.staged.delete(stagedIdentity); }
}

describe('committing removed source files', () => {
  async function deletion(storage: FaultyWriteStorage) {
    const repository = new InMemoryChangeRepository();
    const change = await beginChange(await loadProjectSnapshot(storage, hasher), repository, storage);
    delete change.record.workingFiles['content/scenario/unused.gal'];
    change.record.workingFiles['game.config.json'] = '{"entryScene":"start","title":"new"}';
    await recordValidation(change, { evidenceId: 'delete-valid', errors: 0 });
    return { change, repository };
  }
  const files = () => ({
    'game.config.json': '{"entryScene":"start"}',
    'content/scenario/start.gal': '@scene start\n@end\n',
    'content/scenario/unused.gal': '@scene unused\n保留以供恢复。\n@end\n',
  });

  it('commits absence, not an empty replacement, with an explicit deletion journal entry', async () => {
    const storage = new FaultyWriteStorage(files(), Infinity);
    const { change, repository } = await deletion(storage);
    await expect(commitChange(change, storage)).resolves.toMatchObject({ status: 'COMMITTED' });
    expect(await storage.exists('content/scenario/unused.gal')).toBe(false);
    expect(storage.files['game.config.json']).toContain('new');
    expect(await repository.readLatestJournal(change.record.changeId)).toMatchObject({ status: 'COMMITTED', files: expect.arrayContaining([
      { kind: 'delete', path: 'content/scenario/unused.gal', originalSha256: digest(files()['content/scenario/unused.gal']), replaced: true, restored: false },
    ]) });
  });

  it('restores the removed bytes when a later file replacement fails', async () => {
    const original = files();
    const storage = new FaultyWriteStorage({ ...original }, 1);
    const { change } = await deletion(storage);
    await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'COMMIT_FAILED_RECOVERED' });
    expect(storage.replaceCount).toBe(1);
    expect(storage.files).toEqual(original);
  });

  it('classifies a deletion that succeeds before its storage acknowledgement fails', async () => {
    const original = files();
    const storage = new FaultyWriteStorage({ ...original }, Infinity);
    let removed = false;
    storage.removePath = async (path) => { delete storage.files[path]; removed = true; throw new Error('after unlink'); };
    const { change } = await deletion(storage);
    await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'COMMIT_FAILED_RECOVERED' });
    expect(removed).toBe(true);
    expect(storage.files).toEqual(original);
  });

  it('preserves an external recreation instead of restoring over it', async () => {
    const storage = new FaultyWriteStorage(files(), Infinity);
    storage.removePath = async (path) => { storage.files[path] = 'external replacement'; throw new Error('after recreation'); };
    const { change } = await deletion(storage);
    await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'COMMIT_RECOVERY_FAILED' });
    expect(storage.files['content/scenario/unused.gal']).toBe('external replacement');
  });
});

class PostReplaceCleanupFaultStorage extends FaultyWriteStorage {
  readonly removeStageCalls: string[] = [];

  constructor(files: Record<string, string>, private readonly events: string[]) {
    super(files, Number.POSITIVE_INFINITY, false);
  }

  override async removeStage(stagedIdentity: string): Promise<void> {
    this.events.push(`cleanup-attempt:${stagedIdentity}`);
    this.removeStageCalls.push(stagedIdentity);
    if (this.removeStageCalls.length === 1) {
      throw new Error('injected post-replacement cleanup failure');
    }
    await super.removeStage(stagedIdentity);
  }
}

class OrderingCommitStorage extends FaultyWriteStorage {
  constructor(
    files: Record<string, string>,
    private readonly events: string[],
  ) {
    super(files, Number.POSITIVE_INFINITY, false);
  }

  async onCommitEvent(event: string): Promise<void> {
    this.events.push(event);
  }

  override async stageText(path: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }> {
    this.events.push('stage:' + path);
    return super.stageText(path, text, changeId);
  }

  override async replaceFromStage(path: string, stagedIdentity: string): Promise<void> {
    this.events.push('replace:' + path);
    return super.replaceFromStage(path, stagedIdentity);
  }
}

class OrderingJournalRepository extends InMemoryChangeRepository {
  constructor(private readonly events: string[]) {
    super();
  }

  override async writeJournal(changeId: string, value: unknown): Promise<void> {
    await super.writeJournal(changeId, value);
    if (typeof value === 'object' && value !== null && typeof (value as { status?: unknown }).status === 'string') {
      this.events.push('journal:' + (value as { status: string }).status);
    }
  }
}

const humanGateBinding = {
  reviewState: 'human-reviewed' as const,
  reviewId: 'result-review',
  decisionId: 'decision-gate',
  decisionFingerprint: 'decision-gate-fingerprint',
};

function gateMetadata(binding: typeof humanGateBinding | { reviewState: 'unreviewed' }): IntegrationMetadata {
  return {
    planId: 'plan-gate',
    planFingerprint: 'plan-gate-fingerprint',
    executeOperationId: 'execute-gate',
    sourceCapsules: [],
    includedUnitIds: [],
    deduplicatedUnits: [],
    conflictResolutions: [],
    status: 'READY',
    nextOperationIndex: 0,
    replayedOperations: [],
    review: { binding },
  } as unknown as IntegrationMetadata;
}

function gateResultReview(workingRevision: number) {
  return {
    reviewId: 'result-review',
    resultTreeSha256: 'result-tree-gate',
    diffFingerprint: 'diff-gate',
    evidence: {
      diffEvidenceId: 'diff-gate-evidence',
      validationEvidenceId: 'validation-gate-evidence',
      simulationEvidenceId: 'simulation-gate-evidence',
      runtimeTraceIds: ['runtime-gate-evidence'],
    },
    workingRevision,
  };
}

class GateChangeFixture {
  constructor(
    readonly change: Awaited<ReturnType<typeof beginChange>>,
    readonly repository: OrderingJournalRepository,
    readonly storage: OrderingCommitStorage,
    readonly events: string[],
  ) {}

  async approve(): Promise<void> {
    const resultReview = gateResultReview(this.change.record.workingRevision);
    const bindingFingerprint = approvalBindingFingerprintOf({
      binding: humanGateBinding,
      planId: this.change.record.integration!.planId,
      planFingerprint: this.change.record.integration!.planFingerprint,
      integrationChangeId: this.change.record.changeId,
      resultReview,
    });
    await updateIntegrationMetadata(this.change, (metadata) => ({
      ...metadata,
      review: {
        binding: humanGateBinding,
        resultReview,
        approval: {
          approvalId: 'approval-gate',
          approvalFingerprint: 'approval-gate-fingerprint',
          bindingFingerprint,
        },
      },
    } as unknown as IntegrationMetadata));
  }
}

async function beginGateFixture(
  binding: typeof humanGateBinding | { reviewState: 'unreviewed' },
): Promise<GateChangeFixture> {
  const events: string[] = [];
  const storage = new OrderingCommitStorage({
    'game.config.json': '{"entryScene":"prologue","variables":{}}',
    'content/scenario/prologue.gal': '@scene prologue\n凛：开场。\n@end\n',
  }, events);
  const repository = new OrderingJournalRepository(events);
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const change = await beginChange(snapshot, repository, storage, undefined, {
    integration: gateMetadata(binding),
  });
  await applySceneCreate(change, { operationId: 'gate-scene', sceneId: 'gate_scene' });
  await recordValidation(change, { evidenceId: 'validation-gate-evidence', errors: 0 });
  await recordDiffEvidence(change, { evidenceId: 'diff-gate-evidence' });
  await recordSimulationEvidence(change, { evidenceId: 'simulation-gate-evidence', status: 'passed' });
  await recordRuntimeTrace(change, { traceId: 'runtime-gate-evidence', status: 'passed' });
  return new GateChangeFixture(change, repository, storage, events);
}

async function beginFixture(
  storage: FaultyWriteStorage,
  repository: InMemoryChangeRepository = new InMemoryChangeRepository(),
) {
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const change = await beginChange(snapshot, repository, storage);
  await applySceneCreate(change, { operationId: 'op-scene', sceneId: 'branch_a' });
  await ensureVariable(change, { operationId: 'op-variable', name: 'trust', type: 'number', initial: 0 });
  await recordValidation(change, { evidenceId: 'evidence-valid', errors: 0 });
  return change;
}

describe('atomic commit recovery', () => {
  it('restores the first file when the second replacement fails', async () => {
    const original = {
      'game.config.json': '{"entryScene":"prologue","variables":{}}',
      'content/scenario/prologue.gal': '@scene prologue\n凛：开场。\n@end\n',
    };
    const storage = new FaultyWriteStorage({ ...original });
    const change = await beginFixture(storage);
    await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'COMMIT_FAILED_RECOVERED' });
    expect(storage.files).toEqual(original);
    expect(change.record.status).toBe('OPEN');
  });

  it('keeps the journal and stops when recovery itself fails', async () => {
    const storage = new FaultyWriteStorage({
      'game.config.json': '{"entryScene":"prologue","variables":{}}',
      'content/scenario/prologue.gal': '@scene prologue\n凛：开场。\n@end\n',
    }, 2, true);
    const repository = new InMemoryChangeRepository();
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const change = await beginChange(snapshot, repository, storage);
    await applySceneCreate(change, { operationId: 'op-scene', sceneId: 'branch_a' });
    await ensureVariable(change, { operationId: 'op-variable', name: 'trust', type: 'number', initial: 0 });
    await recordValidation(change, { evidenceId: 'evidence-valid', errors: 0 });
    await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'COMMIT_RECOVERY_FAILED' });
    expect(change.record.status).toBe('STALE');
    expect(repository.journals.get(change.record.changeId)).toBeDefined();
  });

  it('commits after verified replacements even when staged cleanup fails', async () => {
    const events: string[] = [];
    const repository = new PersistedCommitEventRepository(events);
    const storage = new PostReplaceCleanupFaultStorage({
      'game.config.json': '{"entryScene":"prologue","variables":{}}',
      'content/scenario/prologue.gal': '@scene prologue\n凛：开场。\n@end\n',
    }, events);
    const change = await beginFixture(storage, repository);

    events.length = 0;
    expect(events).toEqual([]);
    const committed = await commitChange(change, storage);

    expect(repository.journalVersions).toEqual([1, 2, 3, 4, 5]);

    expect(committed).toEqual({
      changeId: change.record.changeId,
      status: 'COMMITTED',
      files: ['content/scenario/branch_a.gal', 'game.config.json'],
    });
    expect(storage.files['content/scenario/branch_a.gal']).toContain('@scene branch_a');
    expect(storage.files['game.config.json']).toContain('"trust"');
    expect(storage.removeStageCalls).toHaveLength(2);
    expect(storage.staged.size).toBe(1);
    expect(change.record.status).toBe('COMMITTED');
    expect((await repository.read(change.record.changeId))?.status).toBe('COMMITTED');

    const failedStagedIdentity = storage.removeStageCalls[0];
    if (failedStagedIdentity === undefined) throw new Error('missing failed staged identity');
    const journal = repository.journals.get(change.record.changeId) as {
      status: string;
      files: Array<{ stagedIdentity: string; replaced: boolean }>;
    } | undefined;
    if (journal === undefined) throw new Error('missing committed journal');

    expect(journal.status).toBe('COMMITTED');
    expect(journal.files.map((entry) => entry.stagedIdentity)).toEqual(storage.removeStageCalls);
    expect(journal.files.map((entry) => entry.stagedIdentity)).toContain(failedStagedIdentity);
    const failedEntry = journal.files.find((entry) => entry.stagedIdentity === failedStagedIdentity);
    if (failedEntry === undefined) throw new Error('failed staged identity missing from journal');
    expect(failedEntry.replaced).toBe(true);
    expect(storage.staged.has(failedStagedIdentity)).toBe(true);
    expect([...storage.staged.keys()]).toEqual([failedStagedIdentity]);

    const cleanupEvents = storage.removeStageCalls.map((stagedIdentity) => `cleanup-attempt:${stagedIdentity}`);
    expect(events).toEqual([
      'journal-persisted:COMMITTED',
      'record-persisted:COMMITTED',
      ...cleanupEvents,
    ]);
    const journalPersistedIndex = events.indexOf('journal-persisted:COMMITTED');
    const recordPersistedIndex = events.indexOf('record-persisted:COMMITTED');
    const firstCleanupIndex = events.findIndex((event) => event.startsWith('cleanup-attempt:'));
    expect(journalPersistedIndex).toBeGreaterThanOrEqual(0);
    expect(recordPersistedIndex).toBeGreaterThan(journalPersistedIndex);
    expect(firstCleanupIndex).toBeGreaterThan(recordPersistedIndex);
    expect(cleanupEvents).toHaveLength(2);
  });

  it('marks a change stale before replacement when the project revision changed', async () => {
    const storage = new FaultyWriteStorage({
      'game.config.json': '{"entryScene":"prologue","variables":{}}',
      'content/scenario/prologue.gal': '@scene prologue\n凛：开场。\n@end\n',
    });
    const change = await beginFixture(storage);
    storage.files['content/scenario/prologue.gal'] += '# external change\n';
    const freshProject = await loadProjectSnapshot(storage, hasher);

    await expect(assertBaseStillMatches(change, freshProject)).rejects.toMatchObject({ code: 'PROJECT_CHANGED_SINCE_BEGIN' });
    expect(change.record.status).toBe('STALE');
    expect(storage.replaceCount).toBe(0);
  });

  it('rejects an unapproved integration before storage or journal activity', async () => {
    const fixture = await beginGateFixture({ reviewState: 'unreviewed' });
    await expect(commitChange(fixture.change, fixture.storage))
      .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_REQUIRED' });
    expect(fixture.events).toEqual([]);
    expect(await fixture.repository.readLatestJournal(fixture.change.record.changeId)).toBeNull();
  });

  it('rejects stale approval before storage or journal activity', async () => {
    const fixture = await beginGateFixture(humanGateBinding);
    const resultReview = gateResultReview(fixture.change.record.workingRevision - 1);
    const bindingFingerprint = approvalBindingFingerprintOf({
      binding: humanGateBinding,
      planId: fixture.change.record.integration!.planId,
      planFingerprint: fixture.change.record.integration!.planFingerprint,
      integrationChangeId: fixture.change.record.changeId,
      resultReview,
    });
    await updateIntegrationMetadata(fixture.change, (metadata) => ({
      ...metadata,
      review: {
        binding: humanGateBinding,
        resultReview,
        approval: {
          approvalId: 'approval-stale',
          approvalFingerprint: 'approval-stale-fingerprint',
          bindingFingerprint,
        },
      },
    } as unknown as IntegrationMetadata));

    await expect(commitChange(fixture.change, fixture.storage))
      .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_STALE' });
    expect(fixture.events).toEqual([]);
    expect(await fixture.repository.readLatestJournal(fixture.change.record.changeId)).toBeNull();
  });

  it('checks approval before staging an approved integration and leaves ordinary commits unaffected', async () => {
    const fixture = await beginGateFixture(humanGateBinding);
    await fixture.approve();
    const committed = await commitChange(fixture.change, fixture.storage);
    expect(committed.status).toBe('COMMITTED');
    const events = fixture.events;
    const approvalIndex = events.indexOf('approval-checked');
    const firstStageIndex = events.findIndex((event) => event.startsWith('stage:'));
    const stagingJournalIndex = events.indexOf('journal:STAGING');
    const firstReplaceIndex = events.findIndex((event) => event.startsWith('replace:'));
    expect(approvalIndex).toBe(0);
    expect(firstStageIndex).toBeGreaterThan(approvalIndex);
    expect(stagingJournalIndex).toBeGreaterThan(firstStageIndex);
    expect(firstReplaceIndex).toBeGreaterThan(stagingJournalIndex);

    const ordinaryStorage = new FaultyWriteStorage({
      'game.config.json': '{"entryScene":"prologue","variables":{}}',
      'content/scenario/prologue.gal': '@scene prologue\n凛：开场。\n@end\n',
    }, Number.POSITIVE_INFINITY);
    const ordinary = await beginFixture(ordinaryStorage);
    await expect(commitChange(ordinary, ordinaryStorage)).resolves.toMatchObject({ status: 'COMMITTED' });
  });
});
