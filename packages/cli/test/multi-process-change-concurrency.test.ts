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
      expect(loser?.result.code).toBe('CHANGE_RECORD_CONFLICT');

      const beforeRetry = await NodeChangeStore.openByChangeId(changeId);
      expect(beforeRetry).not.toBeNull();
      const retried = openChange(beforeRetry!.record, beforeRetry!.store);
      await runOperation(retried, { operationId: loser!.operationId }, (record) => ({
        result: { marker: loser!.marker },
        workingFiles: { ...record.workingFiles, [loser!.relativePath]: loser!.marker },
      }));

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
});
