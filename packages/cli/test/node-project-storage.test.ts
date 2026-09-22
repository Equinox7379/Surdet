import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  applySceneCreate,
  applyScenePatch,
  beginChange,
  buildObjectIndex,
  commitChange,
  ensureVariable,
  InMemoryChangeRepository,
  loadProjectSnapshot,
  recordValidation,
  rollbackChange,
  type ProjectFile,
  type ProjectWriteStorage,
  type TextHasher,
} from '@surdet/authoring';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';

const hasher: TextHasher = {
  sha256: async (value) => crypto.createHash('sha256').update(value).digest('hex'),
};

function createProjectRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'content'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), '{"entryScene":"agent_support","variables":{}}', 'utf8');
  return root;
}

async function beginSceneChange(storage: ProjectWriteStorage, includeVariable = false) {
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const change = await beginChange(snapshot, new InMemoryChangeRepository(), storage);
  await applySceneCreate(change, {
    operationId: 'op-scene',
    sceneId: 'agent_support',
    blocks: [{ kind: 'text', speaker: '凛', value: '新场景。' }],
  });
  if (includeVariable) {
    await ensureVariable(change, { operationId: 'op-variable', name: 'trust', type: 'number', initial: 0 });
  }
  await recordValidation(change, { evidenceId: 'evidence-valid', errors: 0 });
  return change;
}

function temporaryFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.startsWith('.surdet-')) found.push(absolute);
    }
  };
  walk(root);
  return found.sort();
}

function fileTree(root: string): string[] {
  const result: string[] = [];
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) {
        const digest = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
        result.push(`${relative}\0${digest}`);
      }
    }
  };
  walk(root, '');
  return result.sort();
}

class FailingReplaceStorage implements ProjectWriteStorage {
  readonly rootIdentity: string;
  private replaceCount = 0;

  constructor(
    private readonly inner: NodeProjectStorage,
    private readonly failAt: number,
  ) {
    this.rootIdentity = inner.rootIdentity;
  }

  listFiles(): Promise<string[]> { return this.inner.listFiles(); }
  readText(relativePath: string): Promise<ProjectFile> { return this.inner.readText(relativePath); }
  exists(relativePath: string): Promise<boolean> { return this.inner.exists(relativePath); }
  stageText(relativePath: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }> {
    return this.inner.stageText(relativePath, text, changeId);
  }
  async replaceFromStage(relativePath: string, stagedIdentity: string): Promise<void> {
    this.replaceCount += 1;
    if (this.replaceCount === this.failAt) throw new Error('injected replace failure');
    await this.inner.replaceFromStage(relativePath, stagedIdentity);
  }
  restoreText(relativePath: string, originalText: string): Promise<void> {
    return this.inner.restoreText(relativePath, originalText);
  }
  removeStage(stagedIdentity: string): Promise<void> { return this.inner.removeStage(stagedIdentity); }
  removePath(relativePath: string): Promise<void> { return this.inner.removePath(relativePath); }
}

describe('NodeProjectStorage safe parent creation', () => {
  it.each(['new', 'existing'] as const)('preserves an externally edited earlier %s file when a later publication fails', async kind => {
    const root = createProjectRoot('surdet-commit-earlier-external-');
    const relative = 'content/scenario/agent_support.gal';
    const target = path.join(root, relative);
    try {
      if (kind === 'existing') {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, '@scene agent_support\n原来的正文。\n@end\n');
      }
      const storage = await NodeProjectStorage.open(root);
      const snapshot = await loadProjectSnapshot(storage, hasher);
      const change = await beginChange(snapshot, new InMemoryChangeRepository(), storage);
      if (kind === 'existing') {
        const object = buildObjectIndex(snapshot).objects.find(item => item.kind === 'text')!;
        await applyScenePatch(change, { operationId: 'patch', patch: {
          kind: 'replaceText', target: object.objectRef, expectedFingerprint: object.fingerprint!, value: '事务写入的正文。',
        } });
      } else {
        await applySceneCreate(change, { operationId: 'create', sceneId: 'agent_support' });
      }
      await ensureVariable(change, { operationId: 'variable', name: 'trust', type: 'number', initial: 0 });
      await recordValidation(change, { evidenceId: 'validation', errors: 0 });
      const foreignText = '@scene agent_support\n外部编辑器刚保存的正文。\n@end\n';
      const replace = storage.replaceFromStage.bind(storage);
      const fault = vi.spyOn(storage, 'replaceFromStage').mockImplementation(async (file, stage) => {
        if (file === 'game.config.json') {
          fs.writeFileSync(target, foreignText);
          throw new Error('later publication failed after an external edit');
        }
        await replace(file, stage);
      });
      try {
        await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'COMMIT_RECOVERY_FAILED' });
        expect(fs.readFileSync(target, 'utf8')).toBe(foreignText);
        expect(change.record.status).toBe('STALE');
        expect(await change.repository.readLatestJournal(change.record.changeId)).toMatchObject({
          status: 'RECOVERY_FAILED', files: [expect.objectContaining({ path: relative, restored: false }), expect.anything()],
        });
        expect(temporaryFiles(root)).not.toEqual([]);
      } finally { fault.mockRestore(); }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.each(['new', 'existing'] as const)('recovers an already renamed %s target when its real file flush fails', async kind => {
    const root = createProjectRoot('surdet-commit-post-rename-');
    const relative = kind === 'new' ? 'content/scenario/agent_support.gal' : 'game.config.json';
    const target = path.join(root, relative);
    try {
      const storage = await NodeProjectStorage.open(root);
      const before = fileTree(root);
      const change = await beginSceneChange(storage, true);
      const probe = await fs.promises.open(path.join(root, 'game.config.json'), 'r+');
      const prototype = Object.getPrototypeOf(probe);
      await probe.close();
      const originalSync = prototype.sync as fs.promises.FileHandle['sync'];
      let failures = 0;
      // The staged file has a different inode. Inject only when the real rename
      // has published that inode under the final target name, not during staging.
      const sync = vi.spyOn(prototype, 'sync').mockImplementation(function(this: fs.promises.FileHandle) {
        const targetStat = fs.existsSync(target) ? fs.statSync(target, { bigint: true }) : null;
        const opened = fs.fstatSync(this.fd, { bigint: true });
        if (failures === 0 && targetStat?.isFile()
          && opened.dev === targetStat.dev && opened.ino === targetStat.ino) {
          failures += 1;
          return Promise.reject(Object.assign(new Error('injected target fsync failure after rename'), { code: 'EIO' }));
        }
        return originalSync.call(this);
      });
      try {
        await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'COMMIT_FAILED_RECOVERED' });
        expect(failures).toBe(1);
        expect(fileTree(root)).toEqual(before);
        expect(temporaryFiles(root)).toEqual([]);
        expect(change.record.status).toBe('OPEN');
        expect(await change.repository.readLatestJournal(change.record.changeId)).toMatchObject({ status: 'RECOVERED' });
      } finally { sync.mockRestore(); }
      // Recovery must preserve the original change and allow an explicit retry.
      expect((await commitChange(change, storage)).status).toBe('COMMITTED');
      expect(fs.readFileSync(path.join(root, 'content/scenario/agent_support.gal'), 'utf8')).toContain('新场景。');
      expect(JSON.parse(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).variables.trust.initial).toBe(0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('does not overwrite an unrecognized post-rename target or discard its remaining recovery stages', async () => {
    const root = createProjectRoot('surdet-commit-unknown-target-');
    try {
      const storage = await NodeProjectStorage.open(root);
      const change = await beginSceneChange(storage, true);
      const relative = 'content/scenario/agent_support.gal';
      const target = path.join(root, relative);
      const foreignText = '@scene agent_support\n事务外的正文不能被自动覆盖。\n@end\n';
      const replace = storage.replaceFromStage.bind(storage);
      let injected = false;
      const fault = vi.spyOn(storage, 'replaceFromStage').mockImplementation(async (file, stage) => {
        await replace(file, stage);
        if (file === relative && !injected) {
          injected = true;
          fs.writeFileSync(target, foreignText);
          throw new Error('injected unknown post-publication outcome');
        }
      });
      try {
        await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'COMMIT_RECOVERY_FAILED' });
        expect(injected).toBe(true);
        expect(change.record.status).toBe('STALE');
        expect(fs.readFileSync(target, 'utf8')).toBe(foreignText);
        const journal = await change.repository.readLatestJournal(change.record.changeId) as {
          status: string; files: Array<{ path: string; stagedIdentity: string }>;
        };
        expect(journal.status).toBe('RECOVERY_FAILED');
        const pending = journal.files.find(file => file.path === 'game.config.json');
        expect(pending).toBeDefined();
        expect(fs.existsSync(pending!.stagedIdentity)).toBe(true);
      } finally { fault.mockRestore(); }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.each(['exists', 'readText'] as const)('keeps recovery evidence when post-rename inspection fails in %s', async method => {
    const root = createProjectRoot('surdet-commit-unreadable-target-');
    try {
      const storage = await NodeProjectStorage.open(root);
      const change = await beginSceneChange(storage, true);
      const relative = 'content/scenario/agent_support.gal';
      const originalConfig = fs.readFileSync(path.join(root, 'game.config.json'), 'utf8');
      const replace = storage.replaceFromStage.bind(storage);
      let injected = false;
      const fault = vi.spyOn(storage, 'replaceFromStage').mockImplementation(async (file, stage) => {
        await replace(file, stage);
        if (file === relative) {
          injected = true;
          throw new Error('injected post-publication failure');
        }
      });
      const exists = storage.exists.bind(storage);
      const readText = storage.readText.bind(storage);
      const existsFault = vi.spyOn(storage, 'exists').mockImplementation(async file => {
        if (injected && file === relative && method === 'exists') throw new Error('injected inspection failure');
        return exists(file);
      });
      const readFault = vi.spyOn(storage, 'readText').mockImplementation(async file => {
        if (injected && file === relative && method === 'readText') throw new Error('injected inspection failure');
        return readText(file);
      });
      try {
        await expect(commitChange(change, storage)).rejects.toMatchObject({
          code: 'COMMIT_RECOVERY_FAILED', details: { cause: 'Error: injected post-publication failure' },
        });
        expect(injected).toBe(true);
        expect(change.record.status).toBe('STALE');
        expect(fs.readFileSync(path.join(root, relative), 'utf8')).toContain('新场景。');
        expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toBe(originalConfig);
        const journal = await change.repository.readLatestJournal(change.record.changeId) as {
          status: string; files: Array<{ path: string; stagedIdentity: string }>;
        };
        expect(journal.status).toBe('RECOVERY_FAILED');
        const pending = journal.files.find(file => file.path === 'game.config.json');
        expect(pending).toBeDefined();
        expect(fs.existsSync(pending!.stagedIdentity)).toBe(true);
      } finally { fault.mockRestore(); existsFault.mockRestore(); readFault.mockRestore(); }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('does not touch an absent target when replacement fails before publication', async () => {
    const root = createProjectRoot('surdet-commit-before-rename-');
    try {
      const inner = await NodeProjectStorage.open(root);
      const storage = new FailingReplaceStorage(inner, 1);
      const change = await beginSceneChange(storage, true);
      const before = fileTree(root);
      const restore = vi.spyOn(inner, 'restoreText');
      const remove = vi.spyOn(inner, 'removePath');
      try {
        await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'COMMIT_FAILED_RECOVERED' });
        expect(fileTree(root)).toEqual(before);
        expect(temporaryFiles(root)).toEqual([]);
        expect(restore).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        expect(change.record.status).toBe('OPEN');
        expect(await change.repository.readLatestJournal(change.record.changeId)).toMatchObject({ status: 'RECOVERED' });
        expect((await commitChange(change, storage)).status).toBe('COMMITTED');
      } finally { restore.mockRestore(); remove.mockRestore(); }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('does not report recovery success when the restored target also fails its real flush', async () => {
    const root = createProjectRoot('surdet-commit-restore-flush-');
    try {
      const storage = await NodeProjectStorage.open(root);
      const target = path.join(root, 'game.config.json');
      const originalConfig = fs.readFileSync(target, 'utf8');
      const change = await beginSceneChange(storage, true);
      const probe = await fs.promises.open(target, 'r+');
      const prototype = Object.getPrototypeOf(probe);
      await probe.close();
      const originalSync = prototype.sync as fs.promises.FileHandle['sync'];
      let failures = 0;
      const sync = vi.spyOn(prototype, 'sync').mockImplementation(function(this: fs.promises.FileHandle) {
        const targetStat = fs.statSync(target, { bigint: true });
        const opened = fs.fstatSync(this.fd, { bigint: true });
        if (targetStat.isFile() && opened.dev === targetStat.dev && opened.ino === targetStat.ino) {
          failures += 1;
          return Promise.reject(Object.assign(new Error(`injected target flush failure ${failures}`), { code: 'EIO' }));
        }
        return originalSync.call(this);
      });
      try {
        await expect(commitChange(change, storage)).rejects.toMatchObject({
          code: 'COMMIT_RECOVERY_FAILED', details: { cause: 'Error: injected target flush failure 1' },
        });
        expect(failures).toBe(2);
        expect(change.record.status).toBe('STALE');
        expect(fs.readFileSync(target, 'utf8')).toBe(originalConfig);
        expect(fs.existsSync(path.join(root, 'content/scenario/agent_support.gal'))).toBe(false);
        expect(await change.repository.readLatestJournal(change.record.changeId)).toMatchObject({
          status: 'RECOVERY_FAILED', files: expect.arrayContaining([
            expect.objectContaining({ path: 'game.config.json', replaced: true, restored: false }),
          ]),
        });
      } finally { sync.mockRestore(); }
      await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'CHANGE_NOT_OPEN' });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('does not report a staged write when its real file flush fails', async () => {
    const root = createProjectRoot('surdet-stage-flush-');
    const storage = await NodeProjectStorage.open(root);
    const probe = await fs.promises.open(path.join(root, 'game.config.json'), 'r+');
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const sync = vi.spyOn(prototype, 'sync').mockRejectedValueOnce(new Error('injected flush failure'));
    try {
      await expect(storage.stageText('new.txt', 'staged content', 'flush-check')).rejects.toThrow('injected flush failure');
      expect(fs.existsSync(path.join(root, 'new.txt'))).toBe(false);
      expect(temporaryFiles(root)).toEqual([]);
    } finally { sync.mockRestore(); }
    const staged = await storage.stageText('new.txt', 'durable content', 'flush-retry');
    await storage.replaceFromStage('new.txt', staged.stagedIdentity);
    expect((await storage.readText('new.txt')).text).toBe('durable content');
  });
  it('stages and commits a new file when its parent directory is absent', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-node-storage-red-'));
    const scenarioDirectory = path.join(root, 'content', 'scenario');
    const target = path.join(scenarioDirectory, 'agent_support.gal');
    const text = '@scene agent_support\n@end\n';

    try {
      fs.mkdirSync(path.join(root, 'content'), { recursive: true });
      const storage = await NodeProjectStorage.open(root);

      expect(fs.existsSync(scenarioDirectory)).toBe(false);
      expect(fs.existsSync(target)).toBe(false);

      const staged = await storage.stageText('content/scenario/agent_support.gal', text, 'chg_missing-parent');
      await storage.replaceFromStage('content/scenario/agent_support.gal', staged.stagedIdentity);

      expect(fs.readFileSync(target, 'utf8')).toBe(text);
      expect(fs.readdirSync(scenarioDirectory).filter((name) => name.startsWith('.surdet-'))).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates missing parents only while committing the isolated change', async () => {
    const root = createProjectRoot('surdet-node-storage-commit-');
    const scenarioDirectory = path.join(root, 'content', 'scenario');
    const target = path.join(scenarioDirectory, 'agent_support.gal');

    try {
      const storage = await NodeProjectStorage.open(root);
      const change = await beginSceneChange(storage);
      expect(fs.existsSync(scenarioDirectory)).toBe(false);
      expect(fs.existsSync(target)).toBe(false);

      const committed = await commitChange(change, storage);

      expect(committed.status).toBe('COMMITTED');
      expect(fs.existsSync(target)).toBe(true);
      expect(fs.readFileSync(target, 'utf8')).toContain('@scene agent_support');
      expect(temporaryFiles(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not change the real tree before commit and rollback leaves it unchanged', async () => {
    const root = createProjectRoot('surdet-node-storage-isolation-');

    try {
      const storage = await NodeProjectStorage.open(root);
      const before = fileTree(root);
      const change = await beginSceneChange(storage);

      expect(fileTree(root)).toEqual(before);
      expect(fs.existsSync(path.join(root, 'content', 'scenario'))).toBe(false);
      await rollbackChange(change);
      expect(fileTree(root)).toEqual(before);
      expect(temporaryFiles(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal, links, and non-directory parents with stable path errors', async () => {
    const root = createProjectRoot('surdet-node-storage-paths-');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-node-storage-outside-'));
    const outsideSentinel = path.join(outside, 'sentinel.txt');
    const link = path.join(root, 'content', 'linked');
    fs.writeFileSync(outsideSentinel, 'outside', 'utf8');

    try {
      const storage = await NodeProjectStorage.open(root);
      await expect(storage.stageText('../escape.gal', 'escape', 'chg-escape'))
        .rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
      await expect(storage.stageText(path.join(outside, 'absolute.gal'), 'escape', 'chg-absolute'))
        .rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });

      const nonDirectory = path.join(root, 'content', 'not-a-directory');
      fs.writeFileSync(nonDirectory, 'user file', 'utf8');
      await expect(storage.stageText('content/not-a-directory/target.gal', 'escape', 'chg-file-parent'))
        .rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });

      fs.symlinkSync(outside, link, 'junction');
      await expect(storage.stageText('content/linked/target.gal', 'escape', 'chg-junction'))
        .rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
      expect(fs.existsSync(path.join(outside, 'target.gal'))).toBe(false);
      expect(fs.readFileSync(outsideSentinel, 'utf8')).toBe('outside');
    } finally {
      if (fs.existsSync(link)) fs.unlinkSync(link);
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('recovery cleanup refuses outside and symlink staged identities without deleting bytes', async () => {
    const root = createProjectRoot('surdet-node-storage-recovery-paths-');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-node-storage-recovery-paths-outside-'));
    const outsideStage = path.join(outside, '.surdet-outside.tmp');
    const link = path.join(root, '.surdet-link');
    fs.writeFileSync(outsideStage, 'outside-stage', 'utf8');

    try {
      const storage = await NodeProjectStorage.open(root);
      await expect(storage.removeStage(outsideStage)).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
      expect(fs.readFileSync(outsideStage, 'utf8')).toBe('outside-stage');

      fs.symlinkSync(outside, link, 'junction');
      await expect(storage.removeStage(link)).rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
      expect(fs.existsSync(outsideStage)).toBe(true);
    } finally {
      if (fs.existsSync(link)) fs.unlinkSync(link);
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('cleans newly created empty parents after a later replacement failure', async () => {
    const root = createProjectRoot('surdet-node-storage-recovery-');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-node-storage-recovery-outside-'));
    const outsideSentinel = path.join(outside, 'sentinel.txt');
    const originalConfig = fs.readFileSync(path.join(root, 'game.config.json'), 'utf8');
    fs.writeFileSync(outsideSentinel, 'outside', 'utf8');

    try {
      const realStorage = await NodeProjectStorage.open(root);
      const storage = new FailingReplaceStorage(realStorage, 2);
      const change = await beginSceneChange(storage, true);

      await expect(commitChange(change, storage)).rejects.toMatchObject({ code: 'COMMIT_FAILED_RECOVERED' });
      expect(change.record.status).toBe('OPEN');
      expect(fs.existsSync(path.join(root, 'content', 'scenario'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'content', 'scenario', 'agent_support.gal'))).toBe(false);
      expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toBe(originalConfig);
      expect(temporaryFiles(root)).toEqual([]);
      expect(fs.existsSync(path.join(root, 'content'))).toBe(true);
      expect(fs.readFileSync(outsideSentinel, 'utf8')).toBe('outside');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'win32')(
    'keeps complete old and staged bytes when a locked target blocks replacement',
    { timeout: 10_000 },
    async () => {
      const root = createProjectRoot('surdet-node-storage-locked-replace-');
      const target = path.join(root, 'game.config.json');
      const oldText = fs.readFileSync(target, 'utf8');
      const newText = '{"entryScene":"locked_probe","variables":{}}';
      let locked: fs.promises.FileHandle | undefined;

      try {
        const storage = await NodeProjectStorage.open(root);
        const staged = await storage.stageText('game.config.json', newText, 'chg_locked_replace');
        locked = await fs.promises.open(target, 'r+');

        await expect(storage.replaceFromStage('game.config.json', staged.stagedIdentity))
          .rejects.toMatchObject({ code: 'EPERM' });

        expect(fs.readFileSync(target, 'utf8')).toBe(oldText);
        expect(fs.readFileSync(staged.stagedIdentity, 'utf8')).toBe(newText);

        await locked.close();
        locked = undefined;

        await storage.replaceFromStage('game.config.json', staged.stagedIdentity);
        expect(fs.readFileSync(target, 'utf8')).toBe(newText);
        expect(fs.existsSync(staged.stagedIdentity)).toBe(false);
      } finally {
        await locked?.close().catch(() => undefined);
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
