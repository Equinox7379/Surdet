import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliEntry = path.join(repoRoot, 'packages/cli/dist/index.js');

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('agent authoring CLI JSON contract', () => {
  it('describes exactly the registered 14 capabilities with one JSON stdout document', () => {
    const result = runCli(['capabilities', 'describe', '--json']);

    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout.trim().startsWith('{')).toBe(true);
    expect(result.stdout.trim().endsWith('}')).toBe(true);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).result.capabilities).toHaveLength(14);
  });

  it('returns a structured failure envelope without a stack on the default error path', () => {
    const missing = path.join(os.tmpdir(), `surdet-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const result = runCli(['project', 'inspect', '--project', missing, '--json']);
    const body = JSON.parse(result.stdout) as { schemaVersion: number; ok: boolean; error?: { code: string } };

    expect(result.status).not.toBe(0);
    expect(body.schemaVersion).toBe(1);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('PROJECT_NOT_FOUND');
    expect(result.stderr).toBe('');
  });
});
