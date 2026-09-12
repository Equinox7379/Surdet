import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { type ChangeRecord, type CommitJournal } from '@surdet/authoring';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { projectIdentityFromRoot } from '../src/authoring/project-identity.js';

type RecoveryMode = 'staging' | 'replacing-mixed' | 'committed';
type Fixture = { parent: string; dataRoot: string; projectRoot: string };

function makeProject(parent: string): string {
  const root = path.join(parent, 'project');
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), '{"entryScene":"s1","variables":{}}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 's1.gal'), '@scene s1\n开场。\n@end\n', 'utf8');
  return root;
}

function makeFixture(prefix: string): Fixture {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dataRoot = path.join(parent, 'agent-data');
  fs.mkdirSync(dataRoot, { recursive: true });
  return { parent, dataRoot, projectRoot: makeProject(parent) };
}

async function withFixture<T>(prefix: string, callback: (fixture: Fixture) => Promise<T>): Promise<T> {
  const fixture = makeFixture(prefix);
  const previousDataRoot = process.env['SURDET_AGENT_DATA_DIR'];
  process.env['SURDET_AGENT_DATA_DIR'] = fixture.dataRoot;
  try {
    return await callback(fixture);
  } finally {
    if (previousDataRoot === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
    else process.env['SURDET_AGENT_DATA_DIR'] = previousDataRoot;
    fs.rmSync(fixture.parent, { recursive: true, force: true });
  }
}

async function beginRecoveryChange(projectRoot: string, includeVariable = false): Promise<string> {
  const service = new AuthoringService();
  const begun = await service.begin(projectRoot);
  const changeId = begun.result.changeId;
  await service.sceneCreate(changeId, {
    operationId: 'recovery-scene-create',
    sceneId: 'recovery_target',
    blocks: [{ kind: 'text', value: '恢复目标。' }],
  });
  if (includeVariable) {
    await service.variableEnsure(changeId, {
      operationId: 'recovery-variable-ensure',
      name: 'trust',
      type: 'number',
      initial: 1,
    });
  }
  return changeId;
}

function changeDirectory(dataRoot: string, rootIdentity: string, changeId: string): string {
  return path.join(dataRoot, projectIdentityFromRoot(rootIdentity), changeId);
}

function filesDigest(root: string): string[] {
  const result: string[] = [];
  const walk = (directory: string, relativeDirectory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) result.push(`${relative}\0${crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}`);
    }
  };
  walk(root, '');
  return result.sort();
}

async function prepareInterruptedChange(
  fixture: Fixture,
  changeId: string,
  mode: RecoveryMode,
): Promise<{ rootIdentity: string; stagedIdentities: string[] }> {
  const storage = await NodeProjectStorage.open(fixture.projectRoot);
  const rootIdentity = storage.rootIdentity;
  const stagedIdentities: string[] = [];
  await NodeChangeStore.withChangeLeaseForProject(changeId, rootIdentity, async (store) => {
    const record = await store.read(changeId);
    if (record === null) throw new Error(`missing record ${changeId}`);
    const changedPaths = Object.keys(record.workingFiles)
      .filter((filePath) => record.baseContents[filePath] !== record.workingFiles[filePath])
      .sort((left, right) => left.localeCompare(right));
    const files: CommitJournal['files'] = [];
    for (const filePath of changedPaths) {
      const staged = await storage.stageText(filePath, record.workingFiles[filePath]!, changeId);
      stagedIdentities.push(staged.stagedIdentity);
      files.push({
        path: filePath,
        ...(record.baseFiles[filePath] === undefined ? {} : { originalSha256: record.baseFiles[filePath]!.sha256 }),
        targetSha256: staged.sha256,
        stagedIdentity: staged.stagedIdentity,
        replaced: false,
        restored: false,
      });
    }
    const write = async (journalVersion: number, status: CommitJournal['status']): Promise<void> => {
      await store.writeJournal(changeId, {
        formatVersion: 2,
        journalVersion,
        changeId,
        recordVersionAtCommitStart: record.recordVersion,
        projectRevisionAtCommitStart: record.baseRevision,
        status,
        files: files.map((entry) => ({ ...entry })),
      } satisfies CommitJournal);
    };

    await write(1, 'STAGING');
    if (mode === 'staging') return;
    await write(2, 'REPLACING');
    if (mode === 'replacing-mixed') {
      const first = files[0];
      if (first === undefined) throw new Error('recovery fixture has no changed files');
      await storage.replaceFromStage(first.path, first.stagedIdentity);
      first.replaced = true;
      await write(3, 'REPLACING');
      return;
    }
    for (const entry of files) {
      await storage.replaceFromStage(entry.path, entry.stagedIdentity);
      entry.replaced = true;
      await write((files.indexOf(entry) + 3), 'REPLACING');
    }
    await write(files.length + 3, 'COMMITTED');
  });
  return { rootIdentity, stagedIdentities };
}

async function readRecordAndJournalBytes(fixture: Fixture, rootIdentity: string, changeId: string): Promise<string[]> {
  return filesDigest(changeDirectory(fixture.dataRoot, rootIdentity, changeId));
}

describe('Task 7：Node recovery service 与 fresh-process reopen', () => {
  it('替换失败恢复后，同一事务重试成功且保留第一次日志', async () => {
    await withFixture('surdet-recovery-retry-', async (fixture) => {
      const service = new AuthoringService();
      const changeId = await beginRecoveryChange(fixture.projectRoot, true);
      await service.validate(changeId);
      const original = filesDigest(fixture.projectRoot);
      const replace = NodeProjectStorage.prototype.replaceFromStage;
      let replacements = 0;
      const fault = vi.spyOn(NodeProjectStorage.prototype, 'replaceFromStage').mockImplementation(async function (this: NodeProjectStorage, file, stage) {
        if (++replacements === 2) throw new Error('one-time replacement failure');
        return replace.call(this, file, stage);
      });
      try {
        await expect(service.commit(changeId)).rejects.toMatchObject({ code: 'COMMIT_FAILED_RECOVERED' });
      } finally {
        fault.mockRestore();
      }
      expect(filesDigest(fixture.projectRoot)).toEqual(original);
      const opened = (await NodeChangeStore.openByChangeId(changeId))!;
      const before = (await opened.store.readLatestJournal(changeId))!;
      expect(before.status).toBe('RECOVERED');
      const directory = path.join(changeDirectory(fixture.dataRoot, opened.record.projectRootIdentity, changeId), 'journals');
      const oldLogs = new Map(fs.readdirSync(directory).map((name) => [name, fs.readFileSync(path.join(directory, name))]));
      const inspected = await service.inspectRecovery(changeId);
      expect(inspected.result.disposition).toBe('REOPEN_OPEN');
      await service.executeRecovery(changeId, { operationId: 'reopen-for-retry', recoveryToken: inspected.result.recoveryToken! });
      await expect(service.commit(changeId)).resolves.toMatchObject({ result: { status: 'COMMITTED' } });
      const after = (await NodeChangeStore.openByChangeId(changeId))!;
      const journal = (await after.store.readLatestJournal(changeId))!;
      expect(after.record.status).toBe('COMMITTED');
      expect(journal.status).toBe('COMMITTED');
      expect(journal.journalVersion).toBeGreaterThan(before.journalVersion);
      for (const [name, bytes] of oldLogs) expect(fs.readFileSync(path.join(directory, name))).toEqual(bytes);
      for (const entry of journal.files) {
        expect(fs.readFileSync(path.join(fixture.projectRoot, entry.path), 'utf8')).toBe(after.record.workingFiles[entry.path]);
      }
      expect(fs.readFileSync(path.join(fixture.projectRoot, 'content/scenario/s1.gal'), 'utf8')).toBe('@scene s1\n开场。\n@end\n');
    });
  });

  it('按 changeId 查找损坏目标保留错误，真正不存在仍返回 null', async () => {
    await withFixture('surdet-corrupt-lookup-', async (fixture) => {
      const changeId = await beginRecoveryChange(fixture.projectRoot);
      const storage = await NodeProjectStorage.open(fixture.projectRoot);
      const manifest = path.join(changeDirectory(fixture.dataRoot, storage.rootIdentity, changeId), 'manifest.json');
      fs.writeFileSync(manifest, '{"formatVersion":');
      await expect(NodeChangeStore.openForProject(changeId, storage.rootIdentity)).rejects.toMatchObject({ code: 'CHANGE_STORE_CORRUPT' });
      await expect(NodeChangeStore.openByChangeId(changeId)).rejects.toMatchObject({ code: 'CHANGE_STORE_CORRUPT' });
      await expect(new AuthoringService().inspectRecovery(changeId)).rejects.toMatchObject({ code: 'CHANGE_STORE_CORRUPT' });
      await expect(NodeChangeStore.openByChangeId('absent-change')).resolves.toBeNull();
    });
  });

  it('未恢复的 STAGING 阻止重提，恢复后才允许同一事务写入', async () => {
    await withFixture('surdet-retry-pending-recovery-', async (fixture) => {
      const service = new AuthoringService();
      const changeId = await beginRecoveryChange(fixture.projectRoot);
      await service.validate(changeId);
      const { rootIdentity } = await prepareInterruptedChange(fixture, changeId, 'staging');
      const beforeProject = filesDigest(fixture.projectRoot);
      const beforeRecords = await readRecordAndJournalBytes(fixture, rootIdentity, changeId);
      await expect(service.commit(changeId)).rejects.toMatchObject({ code: 'RECOVERY_AMBIGUOUS' });
      expect(filesDigest(fixture.projectRoot)).toEqual(beforeProject);
      expect(await readRecordAndJournalBytes(fixture, rootIdentity, changeId)).toEqual(beforeRecords);
      const inspected = await service.inspectRecovery(changeId);
      await service.executeRecovery(changeId, { operationId: 'recover-staging', recoveryToken: inspected.result.recoveryToken! });
      await expect(service.commit(changeId)).resolves.toMatchObject({ result: { status: 'COMMITTED' } });
    });
  });

  it('record 已创建但 head 未发布：同内容恢复写入接管孤儿 record，不误报冲突', async () => {
    await withFixture('surdet-task7-orphan-record-', async (fixture) => {
      const changeId = await beginRecoveryChange(fixture.projectRoot);
      const storage = await NodeProjectStorage.open(fixture.projectRoot);
      const opened = await NodeChangeStore.openForProject(changeId, storage.rootIdentity, { allowStale: true });
      if (opened === null) throw new Error(`missing record ${changeId}`);
      const current = opened.record;
      const next = JSON.parse(JSON.stringify(current)) as ChangeRecord;
      next.recordVersion = current.recordVersion + 1;
      // runOperation 在持久化前会显式清空证据字段；JSON writer 会省略 undefined，
      // 因此恢复比较必须按落盘 JSON 语义，而不是按对象 own-property 形态。
      next.latestValidation = undefined;

      const directory = changeDirectory(fixture.dataRoot, storage.rootIdentity, changeId);
      const orphan = path.join(directory, 'records', `${String(next.recordVersion).padStart(10, '0')}.json`);
      fs.writeFileSync(orphan, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      const orphanBytes = fs.readFileSync(orphan);

      await expect(NodeChangeStore.withChangeLeaseForProject(changeId, storage.rootIdentity, async (store) => {
        await store.write(next, {
          expectedRecordVersion: current.recordVersion,
          expectedStatus: current.status,
        });
      })).resolves.toBeUndefined();

      const recovered = await NodeChangeStore.openForProject(changeId, storage.rootIdentity, { allowStale: true });
      expect(recovered?.record).toEqual(next);
      expect(fs.readFileSync(orphan)).toEqual(orphanBytes);
    });
  });

  it('同版本孤儿 record 内容不同：保持原 bytes 并 fail-loud', async () => {
    await withFixture('surdet-task7-orphan-conflict-', async (fixture) => {
      const changeId = await beginRecoveryChange(fixture.projectRoot);
      const storage = await NodeProjectStorage.open(fixture.projectRoot);
      const opened = await NodeChangeStore.openForProject(changeId, storage.rootIdentity, { allowStale: true });
      if (opened === null) throw new Error(`missing record ${changeId}`);
      const current = opened.record;
      const next = JSON.parse(JSON.stringify(current)) as ChangeRecord;
      next.recordVersion = current.recordVersion + 1;
      const conflicting = JSON.parse(JSON.stringify(next)) as ChangeRecord;
      conflicting.workingRevision += 1;

      const directory = changeDirectory(fixture.dataRoot, storage.rootIdentity, changeId);
      const orphan = path.join(directory, 'records', `${String(next.recordVersion).padStart(10, '0')}.json`);
      fs.writeFileSync(orphan, `${JSON.stringify(conflicting, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      const orphanBytes = fs.readFileSync(orphan);

      await expect(NodeChangeStore.withChangeLeaseForProject(changeId, storage.rootIdentity, async (store) => {
        await store.write(next, {
          expectedRecordVersion: current.recordVersion,
          expectedStatus: current.status,
        });
      })).rejects.toMatchObject({ code: 'CHANGE_RECORD_CONFLICT' });

      const unchanged = await NodeChangeStore.openForProject(changeId, storage.rootIdentity, { allowStale: true });
      expect(unchanged?.record).toEqual(current);
      expect(fs.readFileSync(orphan)).toEqual(orphanBytes);
    });
  });

  it('STAGING + base：新 Service inspect 后可恢复为 OPEN', async () => {
    await withFixture('surdet-task7-staging-', async (fixture) => {
      const changeId = await beginRecoveryChange(fixture.projectRoot);
      const prepared = await prepareInterruptedChange(fixture, changeId, 'staging');

      const inspected = await new AuthoringService().inspectRecovery(changeId);
      expect(inspected.result).toMatchObject({
        changeId,
        recordState: 'readable',
        journalStatus: 'STAGING',
        lockState: 'free',
        projectState: 'base',
        disposition: 'REOPEN_OPEN',
        manualRecoveryRequired: false,
      });
      expect(inspected.result.recoveryToken).toMatch(/^[0-9a-f]{64}$/);

      const executed = await new AuthoringService().executeRecovery(changeId, {
        operationId: 'recovery-staging-execute',
        recoveryToken: inspected.result.recoveryToken!,
      });
      expect(executed.result).toEqual({ changeId, status: 'OPEN', disposition: 'REOPEN_OPEN' });
      expect((await NodeChangeStore.openForProject(changeId, prepared.rootIdentity, { allowStale: true }))!.record.status).toBe('OPEN');
      await expect((await NodeChangeStore.openForProject(changeId, prepared.rootIdentity, { allowStale: true }))!.store.readLatestJournal(changeId)).resolves.toMatchObject({ status: 'RECOVERED' });
      for (const stagedIdentity of prepared.stagedIdentities) expect(fs.existsSync(stagedIdentity)).toBe(false);
    });
  });

  it('REPLACING mixed-known：只恢复已替换目标到 base，并保持记录可重开', async () => {
    await withFixture('surdet-task7-replacing-', async (fixture) => {
      const baseConfig = fs.readFileSync(path.join(fixture.projectRoot, 'game.config.json'), 'utf8');
      const changeId = await beginRecoveryChange(fixture.projectRoot, true);
      const prepared = await prepareInterruptedChange(fixture, changeId, 'replacing-mixed');
      const inspected = await new AuthoringService().inspectRecovery(changeId);
      expect(inspected.result.projectState).toBe('mixed-known');
      expect(inspected.result.disposition).toBe('ROLL_BACK_TO_BASE');

      const executed = await new AuthoringService().executeRecovery(changeId, {
        operationId: 'recovery-replacing-execute',
        recoveryToken: inspected.result.recoveryToken!,
      });
      expect(executed.result).toEqual({ changeId, status: 'OPEN', disposition: 'ROLL_BACK_TO_BASE' });
      expect(fs.readFileSync(path.join(fixture.projectRoot, 'game.config.json'), 'utf8')).toBe(baseConfig);
      expect(fs.existsSync(path.join(fixture.projectRoot, 'content', 'scenario', 'recovery_target.gal'))).toBe(false);
      expect((await NodeChangeStore.openForProject(changeId, prepared.rootIdentity, { allowStale: true }))!.record.status).toBe('OPEN');
      for (const stagedIdentity of prepared.stagedIdentities) expect(fs.existsSync(stagedIdentity)).toBe(false);
    });
  });

  it('COMMITTED journal + OPEN record：只补记 COMMITTED，不重复 replacement', async () => {
    await withFixture('surdet-task7-committed-', async (fixture) => {
      const changeId = await beginRecoveryChange(fixture.projectRoot, true);
      const prepared = await prepareInterruptedChange(fixture, changeId, 'committed');
      const targetBefore = filesDigest(fixture.projectRoot);
      const inspected = await new AuthoringService().inspectRecovery(changeId);
      expect(inspected.result).toMatchObject({ journalStatus: 'COMMITTED', projectState: 'target', disposition: 'FINALIZE_COMMITTED' });

      const executed = await new AuthoringService().executeRecovery(changeId, {
        operationId: 'recovery-committed-execute',
        recoveryToken: inspected.result.recoveryToken!,
      });
      expect(executed.result).toEqual({ changeId, status: 'COMMITTED', disposition: 'FINALIZE_COMMITTED' });
      expect(filesDigest(fixture.projectRoot)).toEqual(targetBefore);
      expect((await NodeChangeStore.openForProject(changeId, prepared.rootIdentity, { allowTerminal: true }))!.record.status).toBe('COMMITTED');
    });
  });

  it('unexpected project bytes：inspect/execute 都是人工恢复，record/journal/project 不写入', async () => {
    await withFixture('surdet-task7-unexpected-', async (fixture) => {
      const changeId = await beginRecoveryChange(fixture.projectRoot, true);
      const prepared = await prepareInterruptedChange(fixture, changeId, 'replacing-mixed');
      const config = path.join(fixture.projectRoot, 'game.config.json');
      fs.writeFileSync(config, '{"entryScene":"unexpected","variables":{}}\n', 'utf8');
      const beforeRecord = await readRecordAndJournalBytes(fixture, prepared.rootIdentity, changeId);
      const beforeProject = filesDigest(fixture.projectRoot);
      const inspected = await new AuthoringService().inspectRecovery(changeId);
      expect(inspected.result).toMatchObject({ projectState: 'ambiguous', disposition: 'MANUAL_RECOVERY_REQUIRED', manualRecoveryRequired: true });

      await expect(new AuthoringService().executeRecovery(changeId, {
        operationId: 'recovery-unexpected-execute',
        recoveryToken: inspected.result.recoveryToken!,
      })).rejects.toMatchObject({ code: 'RECOVERY_AMBIGUOUS' });
      expect(await readRecordAndJournalBytes(fixture, prepared.rootIdentity, changeId)).toEqual(beforeRecord);
      expect(filesDigest(fixture.projectRoot)).toEqual(beforeProject);
    });
  });

  it('stale recoveryToken：项目事实变化后零写入', async () => {
    await withFixture('surdet-task7-stale-', async (fixture) => {
      const changeId = await beginRecoveryChange(fixture.projectRoot);
      const prepared = await prepareInterruptedChange(fixture, changeId, 'staging');
      const inspected = await new AuthoringService().inspectRecovery(changeId);
      const beforeRecord = await readRecordAndJournalBytes(fixture, prepared.rootIdentity, changeId);
      fs.writeFileSync(path.join(fixture.projectRoot, 'game.config.json'), '{"entryScene":"changed-outside"}\n', 'utf8');
      const afterExternalProject = filesDigest(fixture.projectRoot);

      await expect(new AuthoringService().executeRecovery(changeId, {
        operationId: 'recovery-stale-execute',
        recoveryToken: inspected.result.recoveryToken!,
      })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_STALE' });
      expect(await readRecordAndJournalBytes(fixture, prepared.rootIdentity, changeId)).toEqual(beforeRecord);
      expect(filesDigest(fixture.projectRoot)).toEqual(afterExternalProject);
    });
  });

  it('recovery execute operationId 幂等，重复请求不增加 recordVersion', async () => {
    await withFixture('surdet-task7-idempotent-', async (fixture) => {
      const changeId = await beginRecoveryChange(fixture.projectRoot);
      const prepared = await prepareInterruptedChange(fixture, changeId, 'staging');
      const inspected = await new AuthoringService().inspectRecovery(changeId);
      const first = await new AuthoringService().executeRecovery(changeId, {
        operationId: 'recovery-idempotent-execute',
        recoveryToken: inspected.result.recoveryToken!,
      });
      const afterFirst = (await NodeChangeStore.openForProject(changeId, prepared.rootIdentity, { allowStale: true }))!.record.recordVersion;
      const second = await new AuthoringService().executeRecovery(changeId, {
        operationId: 'recovery-idempotent-execute',
        recoveryToken: inspected.result.recoveryToken!,
      });
      const afterSecond = (await NodeChangeStore.openForProject(changeId, prepared.rootIdentity, { allowStale: true }))!.record.recordVersion;
      expect(second.result).toEqual(first.result);
      expect(afterSecond).toBe(afterFirst);
    });
  });

  it('V1/corrupt manifest、head、record、journal：稳定错误且原始文件保留', async () => {
    await withFixture('surdet-task7-corrupt-', async (fixture) => {
      const manifestChange = await beginRecoveryChange(fixture.projectRoot);
      const storage = await NodeProjectStorage.open(fixture.projectRoot);
      const manifest = path.join(changeDirectory(fixture.dataRoot, storage.rootIdentity, manifestChange), 'manifest.json');
      fs.writeFileSync(manifest, '{"formatVersion":1}\n', 'utf8');
      const corruptManifest = fs.readFileSync(manifest);
      await expect(NodeChangeStore.openForProject(manifestChange, storage.rootIdentity, { allowTerminal: true, allowStale: true }))
        .rejects.toMatchObject({ code: 'CHANGE_STORE_FORMAT_UNSUPPORTED' });
      expect(fs.readFileSync(manifest)).toEqual(corruptManifest);

      const headChange = await beginRecoveryChange(fixture.projectRoot);
      const head = path.join(changeDirectory(fixture.dataRoot, storage.rootIdentity, headChange), 'record-head.json');
      fs.writeFileSync(head, '{bad json\n', 'utf8');
      const corruptHead = fs.readFileSync(head);
      await expect(NodeChangeStore.openForProject(headChange, storage.rootIdentity, { allowTerminal: true, allowStale: true }))
        .rejects.toMatchObject({ code: 'CHANGE_STORE_CORRUPT' });
      expect(fs.readFileSync(head)).toEqual(corruptHead);

      const recordChange = await beginRecoveryChange(fixture.projectRoot);
      const recordDirectory = changeDirectory(fixture.dataRoot, storage.rootIdentity, recordChange);
      const recordHead = JSON.parse(fs.readFileSync(path.join(recordDirectory, 'record-head.json'), 'utf8')) as { recordVersion: number };
      const recordFile = path.join(recordDirectory, 'records', `${String(recordHead.recordVersion).padStart(10, '0')}.json`);
      fs.writeFileSync(recordFile, '{bad json\n', 'utf8');
      const corruptRecord = fs.readFileSync(recordFile);
      await expect(NodeChangeStore.openForProject(recordChange, storage.rootIdentity, { allowTerminal: true, allowStale: true }))
        .rejects.toMatchObject({ code: 'CHANGE_STORE_CORRUPT' });
      expect(fs.readFileSync(recordFile)).toEqual(corruptRecord);

      const v1JournalChange = await beginRecoveryChange(fixture.projectRoot);
      await prepareInterruptedChange(fixture, v1JournalChange, 'staging');
      const v1Journal = path.join(changeDirectory(fixture.dataRoot, storage.rootIdentity, v1JournalChange), 'journals', '0000000001.json');
      fs.writeFileSync(v1Journal, '{"formatVersion":1}\n', 'utf8');
      const v1JournalBytes = fs.readFileSync(v1Journal);
      await expect(new AuthoringService().inspectRecovery(v1JournalChange)).rejects.toMatchObject({ code: 'CHANGE_STORE_FORMAT_UNSUPPORTED' });
      expect(fs.readFileSync(v1Journal)).toEqual(v1JournalBytes);

      const journalChange = await beginRecoveryChange(fixture.projectRoot);
      await prepareInterruptedChange(fixture, journalChange, 'staging');
      const journal = path.join(changeDirectory(fixture.dataRoot, storage.rootIdentity, journalChange), 'journals', '0000000001.json');
      fs.writeFileSync(journal, '{bad json\n', 'utf8');
      const corruptJournal = fs.readFileSync(journal);
      await expect(new AuthoringService().inspectRecovery(journalChange)).rejects.toMatchObject({ code: 'JOURNAL_CORRUPT' });
      expect(fs.readFileSync(journal)).toEqual(corruptJournal);
    });
  });
});
