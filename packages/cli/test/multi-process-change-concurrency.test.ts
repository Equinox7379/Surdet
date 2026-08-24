import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openChange, runOperation } from '@surdet/authoring';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workerPath = path.join(repoRoot, 'packages/cli/test/fixtures/transaction-worker.mjs');
const cliDist = path.join(repoRoot, 'packages/cli/dist');
const authoringDist = path.join(repoRoot, 'packages/authoring/dist');
const temporaryRoots: string[] = [];

function makeProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-transaction-red-project-'));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  return root;
}

function makeDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

function collectOutput(child: ChildProcess): { stdout: string; stderr: string } {
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  return { stdout, stderr };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function waitForFile(file: string, children: readonly ChildProcess[], timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fileExists(file)) return;
    const exited = children.find((child) => child.exitCode !== null);
    if (exited !== undefined) throw new Error(`HARNESS_INVALID: child exited before barrier file existed: ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`HARNESS_INVALID: timed out waiting for barrier file: ${file}`);
}

async function waitForExit(child: ChildProcess, timeoutMs = 30000): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HARNESS_INVALID: child did not exit within 30 seconds')), timeoutMs);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe('cross-process change concurrency', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('retains cross-process mutations with one deterministic CAS conflict and refresh retry', { timeout: 90000 }, async () => {
    const projectRoot = makeProject();
    const dataRoot = makeDirectory('surdet-agent-transaction-red-data-');
    const barrierRoot = makeDirectory('surdet-agent-transaction-red-barrier-');
    process.env['SURDET_AGENT_DATA_DIR'] = dataRoot;

    const service = new AuthoringService();
    const begun = await service.begin(projectRoot);
    const changeId = begun.result.changeId;
    const releaseFile = path.join(barrierRoot, 'release');
    const cases = [
      { operationId: 'op-a', relativePath: 'content/scenario/worker-a.gal', marker: 'A' },
      { operationId: 'op-b', relativePath: 'content/scenario/worker-b.gal', marker: 'B' },
    ] as const;
    const children: ChildProcess[] = [];
    const outputs = cases.map((item) => ({ ...item, output: undefined as { stdout: string; stderr: string } | undefined }));

    try {
      for (const [index, item] of cases.entries()) {
        const child = spawn(process.execPath, [workerPath, JSON.stringify({
          cliDist,
          authoringDist,
          changeId,
          ...item,
          readyFile: path.join(barrierRoot, `${item.operationId}.ready`),
          releaseFile,
          resultFile: path.join(barrierRoot, `${item.operationId}.result.json`),
        })], {
          cwd: repoRoot,
          env: { ...process.env, SURDET_AGENT_DATA_DIR: dataRoot },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        outputs[index]!.output = collectOutput(child);
        children.push(child);
      }

      await Promise.all(cases.map((item) => waitForFile(path.join(barrierRoot, `${item.operationId}.ready`), children)));
      await fsp.writeFile(releaseFile, 'release\n', { flag: 'wx' });
      const exitCodes = await Promise.all(children.map((child) => waitForExit(child)));
      if (exitCodes.some((code) => code !== 0)) {
        throw new Error(`HARNESS_INVALID: child exit codes=${JSON.stringify(exitCodes)} outputs=${JSON.stringify(outputs)}`);
      }

      const results = await Promise.all(cases.map(async (item) => {
        const resultFile = path.join(barrierRoot, `${item.operationId}.result.json`);
        return JSON.parse(await fsp.readFile(resultFile, 'utf8')) as { ok: boolean; result?: unknown; code?: string; message?: string };
      }));
      const observed = cases.map((item, index) => ({ ...item, result: results[index]! }));
      expect(observed.filter((item) => item.result.ok)).toHaveLength(1);
      const loser = observed.find((item) => !item.result.ok);
      expect(loser?.result.code, JSON.stringify(observed)).toBe('CHANGE_RECORD_CONFLICT');

      const beforeRetry = await NodeChangeStore.openByChangeId(changeId);
      expect(beforeRetry).not.toBeNull();
      await NodeChangeStore.withChangeLease(changeId, async (leasedStore) => {
        const latest = await leasedStore.read(changeId);
        expect(latest).not.toBeNull();
        const retried = openChange(latest!, leasedStore);
        await runOperation(retried, { operationId: loser!.operationId }, (record) => ({
          result: { marker: loser!.marker },
          workingFiles: { ...record.workingFiles, [loser!.relativePath]: loser!.marker },
        }));
      });

      const final = await NodeChangeStore.openByChangeId(changeId);
      expect(final).not.toBeNull();
      expect(Object.keys(final!.record.operations)).toEqual(expect.arrayContaining(['op-a', 'op-b']));
      expect(final!.record.workingFiles['content/scenario/worker-a.gal']).toBe('A');
      expect(final!.record.workingFiles['content/scenario/worker-b.gal']).toBe('B');
      expect(final!.record.workingRevision).toBe(2);
    } finally {
      if (!(await fileExists(releaseFile))) await fsp.writeFile(releaseFile, 'cleanup\n', { flag: 'wx' }).catch(() => undefined);
      await Promise.all(children.map(async (child) => {
        try {
          await waitForExit(child, 5000);
        } catch {
          child.kill();
        }
      }));
    }
  });

  it('retains two real service mutations and invocation order across processes', { timeout: 90000 }, async () => {
    const projectRoot = makeProject();
    const dataRoot = makeDirectory('surdet-agent-transaction-service-data-');
    const barrierRoot = makeDirectory('surdet-agent-transaction-service-barrier-');
    process.env['SURDET_AGENT_DATA_DIR'] = dataRoot;

    const service = new AuthoringService();
    const begun = await service.begin(projectRoot);
    const changeId = begun.result.changeId;
    const releaseFile = path.join(barrierRoot, 'release');
    const cases = [
      { operationId: 'op-service-a', relativePath: 'content/scenario/service-a.gal', marker: 'service-a' },
      { operationId: 'op-service-b', relativePath: 'content/scenario/service-b.gal', marker: 'service-b' },
    ] as const;
    const children: ChildProcess[] = [];
    const outputs = cases.map((item) => ({ ...item, output: undefined as { stdout: string; stderr: string } | undefined }));

    try {
      for (const [index, item] of cases.entries()) {
        const child = spawn(process.execPath, [workerPath, JSON.stringify({
          cliDist,
          authoringDist,
          mode: 'service-mutation',
          projectRoot,
          changeId,
          ...item,
          readyFile: path.join(barrierRoot, `${item.operationId}.ready`),
          releaseFile,
          resultFile: path.join(barrierRoot, `${item.operationId}.result.json`),
        })], {
          cwd: repoRoot,
          env: { ...process.env, SURDET_AGENT_DATA_DIR: dataRoot },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        outputs[index]!.output = collectOutput(child);
        children.push(child);
      }

      await Promise.all(cases.map((item) => waitForFile(path.join(barrierRoot, `${item.operationId}.ready`), children)));
      await fsp.writeFile(releaseFile, 'release\n', { flag: 'wx' });
      const exitCodes = await Promise.all(children.map((child) => waitForExit(child)));
      if (exitCodes.some((code) => code !== 0)) {
        throw new Error(`HARNESS_INVALID: service child exit codes=${JSON.stringify(exitCodes)} outputs=${JSON.stringify(outputs)}`);
      }

      const results = await Promise.all(cases.map(async (item) => {
        const resultFile = path.join(barrierRoot, `${item.operationId}.result.json`);
        return JSON.parse(await fsp.readFile(resultFile, 'utf8')) as { ok: boolean; result?: unknown; code?: string; message?: string };
      }));
      expect(results, JSON.stringify(results)).toMatchObject([{ ok: true }, { ok: true }]);

      const final = await NodeChangeStore.openByChangeId(changeId);
      expect(final).not.toBeNull();
      expect(final!.record.workingRevision).toBe(2);
      expect(final!.record.recordVersion).toBeGreaterThanOrEqual(2);
      expect(Object.keys(final!.record.operations).sort()).toEqual(['op-service-a', 'op-service-b']);
      expect(final!.record.workingFiles['content/scenario/service-a.gal']).toContain('service-a');
      expect(final!.record.workingFiles['content/scenario/service-b.gal']).toContain('service-b');
      const invocations = (await final!.store.readInvocations(changeId))
        .filter((invocation) => invocation.operationId?.startsWith('op-service-'));
      expect(invocations).toHaveLength(2);
      const ordered = [...invocations].sort((left, right) => left.workingRevisionAfter! - right.workingRevisionAfter!);
      expect(ordered.map((item) => [item.workingRevisionBefore, item.workingRevisionAfter])).toEqual([[0, 1], [1, 2]]);
      expect(ordered.map((item) => item.operationId).sort()).toEqual(['op-service-a', 'op-service-b']);
    } finally {
      if (!(await fileExists(releaseFile))) await fsp.writeFile(releaseFile, 'cleanup\n', { flag: 'wx' }).catch(() => undefined);
      await Promise.all(children.map(async (child) => {
        try {
          await waitForExit(child, 5000);
        } catch {
          child.kill();
        }
      }));
    }
  });

  it('serializes different change commits at the project boundary', { timeout: 90000 }, async () => {
    const projectRoot = makeProject();
    const dataRoot = makeDirectory('surdet-agent-transaction-project-commit-data-');
    const barrierRoot = makeDirectory('surdet-agent-transaction-project-commit-barrier-');
    process.env['SURDET_AGENT_DATA_DIR'] = dataRoot;

    const service = new AuthoringService();
    const begunA = await service.begin(projectRoot);
    const begunB = await service.begin(projectRoot);
    expect(begunA.result.baseRevision).toBe(begunB.result.baseRevision);
    const eventsFile = path.join(barrierRoot, 'replacement-events.jsonl');
    const releaseFile = path.join(barrierRoot, 'release');
    const cases = [
      { operationId: 'op-commit-a', sceneId: 'commit-a' },
      { operationId: 'op-commit-b', sceneId: 'commit-b' },
    ] as const;
    const changeIds = [begunA.result.changeId, begunB.result.changeId] as const;
    const children: ChildProcess[] = [];
    const outputs = cases.map((item) => ({ ...item, output: undefined as { stdout: string; stderr: string } | undefined }));

    try {
      for (const [index, item] of cases.entries()) {
        const child = spawn(process.execPath, [workerPath, JSON.stringify({
          cliDist,
          authoringDist,
          mode: 'service-commit',
          projectRoot,
          changeId: changeIds[index],
          operationId: item.operationId,
          relativePath: `content/scenario/${item.sceneId}.gal`,
          marker: item.sceneId,
          readyFile: path.join(barrierRoot, `${item.operationId}.ready`),
          releaseFile,
          resultFile: path.join(barrierRoot, `${item.operationId}.result.json`),
          replaceEventsFile: eventsFile,
          replaceDelayMs: 75,
        })], {
          cwd: repoRoot,
          env: { ...process.env, SURDET_AGENT_DATA_DIR: dataRoot },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        outputs[index]!.output = collectOutput(child);
        children.push(child);
      }

      await Promise.all(cases.map((item) => waitForFile(path.join(barrierRoot, `${item.operationId}.ready`), children)));
      await fsp.writeFile(releaseFile, 'release\n', { flag: 'wx' });
      const exitCodes = await Promise.all(children.map((child) => waitForExit(child)));
      if (exitCodes.some((code) => code !== 0)) {
        throw new Error(`HARNESS_INVALID: child exit codes=${JSON.stringify(exitCodes)} outputs=${JSON.stringify(outputs)}`);
      }

      const results = await Promise.all(cases.map(async (item) => {
        const resultFile = path.join(barrierRoot, `${item.operationId}.result.json`);
        return JSON.parse(await fsp.readFile(resultFile, 'utf8')) as { ok: boolean; result?: unknown; code?: string; message?: string };
      }));
      expect(results.filter((item) => item.ok), JSON.stringify(results)).toHaveLength(1);
      const loserIndex = results.findIndex((item) => !item.ok);
      expect(loserIndex).toBeGreaterThanOrEqual(0);
      expect(results[loserIndex]!.code, JSON.stringify(results)).toBe('PROJECT_CHANGED_SINCE_BEGIN');

      const records = await Promise.all(changeIds.map(async (changeId) => {
        const opened = await NodeChangeStore.openByChangeId(changeId);
        if (opened === null) throw new Error(`missing change record: ${changeId}`);
        return opened.record;
      }));
      expect(records.map((record) => record.status).sort()).toEqual(['COMMITTED', 'STALE']);

      const events = (await fsp.readFile(eventsFile, 'utf8'))
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { event: 'replace-start' | 'replace-end'; operationId: string });
      let active = 0;
      let maxConcurrentReplacement = 0;
      for (const event of events) {
        active += event.event === 'replace-start' ? 1 : -1;
        maxConcurrentReplacement = Math.max(maxConcurrentReplacement, active);
      }
      expect(maxConcurrentReplacement).toBe(1);

      const winnerIndex = results.findIndex((item) => item.ok);
      expect(winnerIndex).toBeGreaterThanOrEqual(0);
      const winnerScene = cases[winnerIndex]!.sceneId;
      const loserScene = cases[loserIndex]!.sceneId;
      expect(fs.existsSync(path.join(projectRoot, 'content', 'scenario', `${winnerScene}.gal`))).toBe(true);
      expect(fs.existsSync(path.join(projectRoot, 'content', 'scenario', `${loserScene}.gal`))).toBe(false);
    } finally {
      if (!(await fileExists(releaseFile))) await fsp.writeFile(releaseFile, 'cleanup\n', { flag: 'wx' }).catch(() => undefined);
      await Promise.all(children.map(async (child) => {
        try {
          await waitForExit(child, 5000);
        } catch {
          child.kill();
        }
      }));
    }
  });
});
