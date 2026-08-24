/**
 * R5：跨项目 change identity 隔离（Reliability Phase 3A）。
 *
 * 复现根因：changeId 由进程级计数器生成（chg_0001），两个项目共享
 * SURDET_AGENT_DATA_DIR 时必然撞号；openByChangeId 全局 first-match 无
 * ownership 验证 → 静默打开错误项目的事务。
 *
 * 本文件全部通过真实 CLI subprocess（spawn dist/index.js）验证，
 * 因为根因包含 process restart / module sequence reset。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliEntry = path.join(repoRoot, 'packages/cli/dist/index.js');

function runCli(args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function body(result: { stdout: string }): any {
  return JSON.parse(result.stdout) as any;
}

/** 与 NodeChangeStore.projectIdentity 同构：data root 下项目目录名。 */
function projectDirName(rootIdentity: string): string {
  return createHash('sha256').update(rootIdentity).digest('hex').slice(0, 32);
}

function makeProject(parent: string, name: string, marker: string): string {
  const root = path.join(parent, name);
  fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 's1' }), 'utf8');
  fs.writeFileSync(path.join(root, 'content/scenario/s1.gal'), `@scene s1\n${marker}：开场。\n@end\n`, 'utf8');
  return root;
}

function readTransaction(dataDir: string, projectRoot: string, changeId: string): any {
  const directory = path.join(dataDir, projectDirName(projectRoot), changeId);
  const head = JSON.parse(fs.readFileSync(path.join(directory, 'record-head.json'), 'utf8')) as { recordVersion: number };
  const file = path.join(directory, 'records', `${String(head.recordVersion).padStart(10, '0')}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as any;
}

describe('R5：跨项目 change identity 隔离（真实 CLI 子进程）', () => {
  it('RED A / G1-G2：共享 data dir 两项目独立进程 begin → IDs 全局唯一且各自 resolve 到正确 owner', { timeout: 30000 }, () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-r5-iso-'));
    const data = path.join(parent, 'agent-data');
    fs.mkdirSync(data, { recursive: true });
    const env = { SURDET_AGENT_DATA_DIR: data };
    const projectA = makeProject(parent, 'project-a', 'PROJECT_A_MARKER');
    const projectB = makeProject(parent, 'project-b', 'PROJECT_B_MARKER');

    const begunA = runCli(['change', 'begin', '--project', projectA, '--json'], env);
    expect(begunA.status).toBe(0);
    const idA = body(begunA).changeId as string;
    const changeDirectory = path.join(data, projectDirName(projectA), idA);
    expect(fs.existsSync(path.join(changeDirectory, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(changeDirectory, 'record-head.json'))).toBe(true);
    expect(fs.existsSync(path.join(changeDirectory, 'transaction.json'))).toBe(false);
    expect(fs.existsSync(path.join(changeDirectory, 'working-files.json'))).toBe(false);
    const begunB = runCli(['change', 'begin', '--project', projectB, '--json'], env);
    expect(begunB.status).toBe(0);
    const idB = body(begunB).changeId as string;

    expect(idA).not.toBe(idB);
    expect(idA).toMatch(/^chg_\d{4}_[0-9a-f]{8}-[0-9a-f]{4}-/); // 可读序号前缀 + 完整 UUID 随机段
    expect(idB).toMatch(/^chg_\d{4}_[0-9a-f]{8}-[0-9a-f]{4}-/);

    const validateA = runCli(['project', 'validate', '--change', idA, '--json'], env);
    expect(validateA.status).toBe(0);
    expect(body(validateA).result.issues[0].text).toContain('PROJECT_A_MARKER');
    const validateB = runCli(['project', 'validate', '--change', idB, '--json'], env);
    expect(validateB.status).toBe(0);
    expect(body(validateB).result.issues[0].text).toContain('PROJECT_B_MARKER');
  });

  it('RED A 续 / G3：mutation 只落入被请求 owner 的事务（paired ownership oracle）', { timeout: 30000 }, () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-r5-mut-'));
    const data = path.join(parent, 'agent-data');
    fs.mkdirSync(data, { recursive: true });
    const env = { SURDET_AGENT_DATA_DIR: data };
    const projectA = makeProject(parent, 'project-a', 'PROJECT_A_MARKER');
    const projectB = makeProject(parent, 'project-b', 'PROJECT_B_MARKER');
    const idA = body(runCli(['change', 'begin', '--project', projectA, '--json'], env)).changeId as string;
    const idB = body(runCli(['change', 'begin', '--project', projectB, '--json'], env)).changeId as string;

    const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-r5-input-'));
    const inputFile = path.join(inputDir, 'var.json');
    fs.writeFileSync(inputFile, JSON.stringify({ name: 'MUTATION_FOR_B', type: 'number', initial: 42, operationId: 'op-b-1' }), 'utf8');
    const mutated = runCli(['variable', 'ensure', '--change', idB, '--input', inputFile, '--json'], env);
    expect(mutated.status).toBe(0);

    expect(readTransaction(data, projectB, idB).workingRevision).toBe(1);
    expect(readTransaction(data, projectA, idA).workingRevision).toBe(0);
    expect(Object.keys(readTransaction(data, projectA, idA).operations)).toHaveLength(0);
  });

  it('RED B / G6-G7：legacy 同号 journal 多项目共存 → CHANGE_ID_AMBIGUOUS fail-loud，mutation 零副作用', { timeout: 30000 }, () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-r5-amb-'));
    const data = path.join(parent, 'agent-data');
    fs.mkdirSync(data, { recursive: true });
    const env = { SURDET_AGENT_DATA_DIR: data };
    const projectA = makeProject(parent, 'project-a', 'PROJECT_A_MARKER');
    const projectB = makeProject(parent, 'project-b', 'PROJECT_B_MARKER');

    // 用真实 begin 产出合法 transaction record，复制为两份 legacy 同号 fixture
    // （目录名任意——openByChangeId 按目录扫描 record.changeId，不校验目录名与项目 hash 的对应）。
    const seed = body(runCli(['change', 'begin', '--project', projectA, '--json'], env));
    const seedDir = path.join(data, projectDirName(projectA), seed.changeId);
    const seedHead = JSON.parse(fs.readFileSync(path.join(seedDir, 'record-head.json'), 'utf8')) as { recordVersion: number };
    const seedRecord = JSON.parse(fs.readFileSync(path.join(seedDir, 'records', `${String(seedHead.recordVersion).padStart(10, '0')}.json`), 'utf8')) as Record<string, unknown>;
    fs.rmSync(seedDir, { recursive: true, force: true });
    for (const slot of ['leg-slot-a', 'leg-slot-b']) {
      const dir = path.join(data, slot, 'chg_legacy');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'transaction.json'), JSON.stringify({ ...seedRecord, changeId: 'chg_legacy' }, null, 2), 'utf8');
    }

    const ambiguous = runCli(['project', 'validate', '--change', 'chg_legacy', '--json'], env);
    expect(ambiguous.status).toBe(1);
    const err = body(ambiguous).error;
    expect(err.code).toBe('CHANGE_ID_AMBIGUOUS');
    expect(err.retryDisposition).toBe('manual-recovery');
    expect(err).not.toHaveProperty('retriable');
    expect(err.message).toContain('chg_legacy');
    expect(err.message).toContain('2');

    // mutation 必须在任何 WorkingProjectStorage 打开前 fail-loud：两侧 transaction 零变化。
    const inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-r5-input-'));
    const inputFile = path.join(inputDir, 'var.json');
    fs.writeFileSync(inputFile, JSON.stringify({ name: 'AMBIG_MUTATION', type: 'number', initial: 1, operationId: 'op-amb-1' }), 'utf8');
    const mutated = runCli(['variable', 'ensure', '--change', 'chg_legacy', '--input', inputFile, '--json'], env);
    expect(mutated.status).toBe(1);
    expect(body(mutated).error.code).toBe('CHANGE_ID_AMBIGUOUS');
    for (const slot of ['leg-slot-a', 'leg-slot-b']) {
      const record = JSON.parse(fs.readFileSync(path.join(data, slot, 'chg_legacy', 'transaction.json'), 'utf8')) as any;
      expect(record.workingRevision).toBe(0);
      expect(Object.keys(record.operations)).toHaveLength(0);
    }
  });

  it('V1：唯一 legacy ID fail-loud 且旧 bytes 保持不变', { timeout: 30000 }, async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-r5-uni-'));
    const data = path.join(parent, 'agent-data');
    fs.mkdirSync(data, { recursive: true });
    const env = { SURDET_AGENT_DATA_DIR: data };
    const projectA = makeProject(parent, 'project-a', 'PROJECT_A_MARKER');

    const seed = body(runCli(['change', 'begin', '--project', projectA, '--json'], env));
    const seedDir = path.join(data, projectDirName(projectA), seed.changeId);
    const seedHead = JSON.parse(fs.readFileSync(path.join(seedDir, 'record-head.json'), 'utf8')) as { recordVersion: number };
    const seedRecord = JSON.parse(fs.readFileSync(path.join(seedDir, 'records', `${String(seedHead.recordVersion).padStart(10, '0')}.json`), 'utf8')) as Record<string, unknown>;
    fs.rmSync(seedDir, { recursive: true, force: true });
    const legacyDir = path.join(data, projectDirName(projectA), 'chg_0001');
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyTransaction = path.join(legacyDir, 'transaction.json');
    fs.writeFileSync(legacyTransaction, JSON.stringify({ ...seedRecord, changeId: 'chg_0001' }, null, 2), 'utf8');
    const beforeBytes = fs.readFileSync(legacyTransaction);

    const previousDataDir = process.env['SURDET_AGENT_DATA_DIR'];
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    await expect(NodeChangeStore.openByChangeId('chg_0001'))
      .rejects.toMatchObject({ code: 'CHANGE_STORE_FORMAT_UNSUPPORTED' });
    if (previousDataDir === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
    else process.env['SURDET_AGENT_DATA_DIR'] = previousDataDir;

    const validate = runCli(['project', 'validate', '--change', 'chg_0001', '--json'], env);
    expect(validate.status).toBe(1);
    expect(body(validate).error.message).toContain('V1 store');
    expect(fs.readFileSync(legacyTransaction)).toEqual(beforeBytes);
  });

  it('G4：同一项目两个独立进程 begin → IDs 不同且都可打开', { timeout: 30000 }, () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-r5-same-'));
    const data = path.join(parent, 'agent-data');
    fs.mkdirSync(data, { recursive: true });
    const env = { SURDET_AGENT_DATA_DIR: data };
    const projectA = makeProject(parent, 'project-a', 'PROJECT_A_MARKER');

    const first = body(runCli(['change', 'begin', '--project', projectA, '--json'], env)).changeId as string;
    const second = body(runCli(['change', 'begin', '--project', projectA, '--json'], env)).changeId as string;
    expect(first).not.toBe(second);

    for (const id of [first, second]) {
      const validate = runCli(['project', 'validate', '--change', id, '--json'], env);
      expect(validate.status).toBe(0);
      expect(body(validate).result.issues[0].text).toContain('PROJECT_A_MARKER');
    }
  });

  it('G8：跨进程 restart 后 ID 仍 resolve 到正确 owner', { timeout: 30000 }, () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-r5-restart-'));
    const data = path.join(parent, 'agent-data');
    fs.mkdirSync(data, { recursive: true });
    const env = { SURDET_AGENT_DATA_DIR: data };
    const projectA = makeProject(parent, 'project-a', 'PROJECT_A_MARKER');
    const projectB = makeProject(parent, 'project-b', 'PROJECT_B_MARKER');
    const idA = body(runCli(['change', 'begin', '--project', projectA, '--json'], env)).changeId as string;
    const idB = body(runCli(['change', 'begin', '--project', projectB, '--json'], env)).changeId as string;

    // 每次 runCli 都是全新进程：这里再显式补一轮 diff 验证持久化解析。
    const diffA = runCli(['change', 'diff', '--change', idA, '--json'], env);
    expect(diffA.status).toBe(0);
    expect(typeof body(diffA).projectRevision).toBe('string');
    const validateB = runCli(['project', 'validate', '--change', idB, '--json'], env);
    expect(validateB.status).toBe(0);
    expect(body(validateB).result.issues[0].text).toContain('PROJECT_B_MARKER');
    const validateA = runCli(['project', 'validate', '--change', idA, '--json'], env);
    expect(validateA.status).toBe(0);
    expect(body(validateA).result.issues[0].text).toContain('PROJECT_A_MARKER');
  });
});
