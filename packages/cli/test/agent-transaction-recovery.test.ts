import { describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type ChangeRecord, type CommitJournal } from '@surdet/authoring';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { projectIdentityFromRoot } from '../src/authoring/project-identity.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { openAgentPortSession } from '../src/agent-port/session.js';
import { HumanWorkspaceStore } from '../src/authoring/human-workspace-store.js';

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
  it('写回恢复不能越过当前人类草稿；拒绝后保留原恢复计划', async () => {
    await withFixture('surdet-recovery-human-draft-', async fixture => {
      const service = new AuthoringService();
      const changeId = await beginRecoveryChange(fixture.projectRoot, true);
      const { rootIdentity } = await prepareInterruptedChange(fixture, changeId, 'replacing-mixed');
      const inspected = await service.inspectRecovery(changeId);
      expect(inspected.result.disposition).toBe('ROLL_BACK_TO_BASE');
      const workspaces = new HumanWorkspaceStore({ dataRoot: fixture.dataRoot });
      const heartbeat = {
        workspaceSessionId: crypto.randomUUID(), browserSessionId: 'recovery-test',
        workspaceGeneration: 1, availability: 'dirty' as const, dirtyScopes: ['scene'] as const,
      };
      await workspaces.heartbeat(rootIdentity, heartbeat);
      const diskBefore = filesDigest(fixture.projectRoot);
      const recordBefore = await readRecordAndJournalBytes(fixture, rootIdentity, changeId);
      const request = { operationId: 'recover-with-draft', recoveryToken: inspected.result.recoveryToken! };
      await expect(service.executeRecovery(changeId, request)).rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_DIRTY' });
      expect(filesDigest(fixture.projectRoot)).toEqual(diskBefore);
      expect(await readRecordAndJournalBytes(fixture, rootIdentity, changeId)).toEqual(recordBefore);
      await workspaces.heartbeat(rootIdentity, { ...heartbeat, workspaceGeneration: 2, availability: 'clean', dirtyScopes: [] });
      expect((await service.executeRecovery(changeId, request)).result.disposition).toBe('ROLL_BACK_TO_BASE');
      await workspaces.heartbeat(rootIdentity, { ...heartbeat, workspaceGeneration: 3 });
      expect((await service.executeRecovery(changeId, request)).result.disposition).toBe('ROLL_BACK_TO_BASE');
    });
  });
  it.each(['stage', 'apply'] as const)('恢复记录保留 %s 交付包时序与原组合约束', async (policy) => {
    await withFixture(`surdet-recovery-capsule-order-${policy}-`, async (fixture) => {
      const sourceBefore = filesDigest(fixture.projectRoot);
      const session = await openAgentPortSession({ projectRoot: fixture.projectRoot, policy });
      let changeId: string;
      try {
        expect((await session.invoke('change.begin', {})).ok).toBe(true);
        changeId = session.activeChangeId!;
        for (const [operationId, timelineId] of [['10', 'first'], ['2', 'second']] as const) {
          const created = await session.invoke('timeline.create', {
            operationId, timelineId, definition: { version: 1, id: timelineId, durationMs: 100, tracks: [{ kind: 'screen', cues: [] }] },
          });
          expect(created.ok, JSON.stringify(created)).toBe(true);
        }
      } finally {
        await session.close();
      }
      const prepared = await prepareInterruptedChange(fixture, changeId, 'staging');
      const recovery = new AuthoringService();
      const inspected = await recovery.inspectRecovery(changeId);
      const input = { operationId: 'recover-order', recoveryToken: inspected.result.recoveryToken! };
      const recovered = await recovery.executeRecovery(changeId, input);
      expect(recovered.result.disposition).toBe('REOPEN_OPEN');
      const afterRecovery = (await NodeChangeStore.openForProject(changeId, prepared.rootIdentity))!.record;
      expect((await new AuthoringService().executeRecovery(changeId, input)).result).toEqual(recovered.result);
      expect((await NodeChangeStore.openForProject(changeId, prepared.rootIdentity))!.record).toEqual(afterRecovery);

      const resumed = await openAgentPortSession({ projectRoot: fixture.projectRoot, policy, resumeChangeId: changeId });
      try {
        const expectedOrder = ['10', '2', 'recover-order'];
        const expectedSemanticOrder = ['10', '2'];
        const later = await resumed.invoke('timeline.create', {
          operationId: '1', timelineId: 'last', definition: { version: 1, id: 'last', durationMs: 100, tracks: [{ kind: 'screen', cues: [] }] },
        });
        if (policy === 'apply') {
          expect(later.ok, JSON.stringify(later)).toBe(true);
          expectedOrder.push('1');
          expectedSemanticOrder.push('1');
        } else {
          expect(later).toMatchObject({ ok: false, error: { code: 'CANDIDATE_OPERATION_FACTS_REQUIRED' } });
        }
        expect((await resumed.invoke('change.diff', {})).ok).toBe(true);
        const capsule = await generateDeliveryCapsule(resumed);
        expect((capsule.operations as Array<{ operationId: string }>).map((operation) => operation.operationId))
          .toEqual(expectedOrder);
        expect((capsule.objectDiff as { semantic: Array<{ kind: string; operationId: string }> }).semantic
          .filter((entry) => entry.kind === 'timeline.create').map((entry) => entry.operationId))
          .toEqual(expectedSemanticOrder);
        expect(capsule.composition.eligibility).toBe('unavailable');
        expect(capsule.composition.manifest).toBeUndefined();
        expect(capsule.composition.reasons).toEqual(expect.arrayContaining([
          expect.objectContaining({ operationId: 'recover-order' }),
        ]));
        const reopened = (await NodeChangeStore.openForProject(changeId, prepared.rootIdentity))!.record;
        expect(expectedOrder.map((id) => reopened.operations[id]!.sequence)).toEqual(expectedOrder.map((_, index) => index));
        expect(reopened.operations['recover-order']!.normalizedInput).toBeUndefined();
        expect(filesDigest(fixture.projectRoot)).toEqual(sourceBefore);
      } finally {
        await resumed.close();
      }
    });
  });

  it('替换失败恢复后，同一事务重试成功且保留第一次日志', async () => {
    await withFixture('surdet-recovery-retry-', async (fixture) => {
      const service = new AuthoringService();
      const changeId = await beginRecoveryChange(fixture.projectRoot, true);
      await service.validate(changeId);
      await service.simulate(changeId);
      await service.runFrom(changeId, {});
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
      await service.simulate(changeId);
      await service.runFrom(changeId, {});
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

  it.each(['staging', 'replacing-mixed', 'committed'] as const)('recovery execute %s operationId 幂等，重复请求不增加 recordVersion', async (mode) => {
    await withFixture('surdet-task7-idempotent-', async (fixture) => {
      const changeId = await beginRecoveryChange(fixture.projectRoot, true);
      const prepared = await prepareInterruptedChange(fixture, changeId, mode);
      const inspected = await new AuthoringService().inspectRecovery(changeId);
      const first = await new AuthoringService().executeRecovery(changeId, {
        operationId: 'recovery-idempotent-execute',
        recoveryToken: inspected.result.recoveryToken!,
      });
      const afterFirst = (await NodeChangeStore.openForProject(changeId, prepared.rootIdentity, { allowStale: true, allowTerminal: true }))!.record.recordVersion;
      const second = await new AuthoringService().executeRecovery(changeId, {
        operationId: 'recovery-idempotent-execute',
        recoveryToken: inspected.result.recoveryToken!,
      });
      const afterSecond = (await NodeChangeStore.openForProject(changeId, prepared.rootIdentity, { allowStale: true, allowTerminal: true }))!.record.recordVersion;
      expect(second.result).toEqual(first.result);
      expect(afterSecond).toBe(afterFirst);
      const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)), 'change', 'recovery', 'execute', '--change', changeId, '--input', '-', '--json'], {
        encoding: 'utf8', env: process.env,
        input: '\uFEFF' + JSON.stringify({ operationId: 'recovery-idempotent-execute', recoveryToken: inspected.result.recoveryToken! }),
      });
      expect(cli.status, cli.stdout + cli.stderr).toBe(0);
      expect(JSON.parse(cli.stdout).result).toEqual(first.result);
    });
  });

  it.each(['__proto__', 'constructor'])('恢复 operationId %s 可持久化并幂等重放', async (operationId) => {
    await withFixture(`surdet-task7-prototype-${operationId}-`, async (fixture) => {
      const changeId = await beginRecoveryChange(fixture.projectRoot);
      const prepared = await prepareInterruptedChange(fixture, changeId, 'staging');
      const service = new AuthoringService();
      const inspected = await service.inspectRecovery(changeId);
      const first = await service.executeRecovery(changeId, {
        operationId,
        recoveryToken: inspected.result.recoveryToken!,
      });
      const opened = (await NodeChangeStore.openForProject(changeId, prepared.rootIdentity, { allowStale: true }))!;
      expect(Object.prototype.hasOwnProperty.call(opened.record.operations, operationId)).toBe(true);
      expect(opened.record.operations[operationId]!.result).toEqual(first.result);
      const afterFirst = opened.record.recordVersion;

      const second = await service.executeRecovery(changeId, {
        operationId,
        recoveryToken: inspected.result.recoveryToken!,
      });
      const reopened = (await NodeChangeStore.openForProject(changeId, prepared.rootIdentity, { allowStale: true }))!;
      expect(second.result).toEqual(first.result);
      expect(reopened.record.recordVersion).toBe(afterFirst);
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
