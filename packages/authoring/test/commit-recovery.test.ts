import { describe, expect, it } from 'vitest';
import type { ChangeRecord } from '../src/contracts.js';
import type { ProjectFile, ProjectStorage, ProjectWriteStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { InMemoryChangeRepository, assertBaseStillMatches, beginChange, commitChange, recordValidation } from '../src/change-session.js';
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
  constructor(private readonly events: string[]) {
    super();
  }

  override async writeJournal(changeId: string, value: unknown): Promise<void> {
    await super.writeJournal(changeId, value);
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
});
