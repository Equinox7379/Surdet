import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(shellRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const runnerPath = path.join(shellRoot, 'e2e', 'player-shell-wave-3.e2e.mjs');

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function closeSessionUnderTest(): (session: unknown) => Promise<{ closed: boolean; exitCode: number }> {
  const source = fs.readFileSync(runnerPath, 'utf8');
  return runInNewContext(`(${functionBody(source, 'closeSession')})`, {
    withWatchdog: (_label: string, operation: () => unknown) => Promise.resolve().then(operation),
  });
}

describe('Frontend Pass 9 Electron consumer contract', () => {
  it('propagates Electron close failures instead of declaring a successful restart', async () => {
    const session = {
      caseId: 'G-first', events: {}, markClosing: vi.fn(), assertNoRuntimeError: vi.fn(),
      app: { process: () => ({ pid: 123 }), close: vi.fn().mockRejectedValue(new Error('close rejected')) },
    };
    await expect(closeSessionUnderTest()(session)).rejects.toThrow('close rejected');
    expect(session.assertNoRuntimeError).not.toHaveBeenCalled();
  });

  it('waits for actual process exit and checks errors emitted during shutdown', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null as number | null, signalCode: null });
    const session = {
      caseId: 'G-first', events: {}, markClosing: vi.fn(),
      assertNoRuntimeError: vi.fn().mockRejectedValue(new Error('release failed during close')),
      app: { process: () => child, close: vi.fn().mockResolvedValue(undefined) },
    };
    const closing = closeSessionUnderTest()(session);
    await vi.waitFor(() => expect(child.listenerCount('exit')).toBe(1));
    expect(session.assertNoRuntimeError).not.toHaveBeenCalled();
    child.exitCode = 0;
    child.emit('exit', 0, null);
    await expect(closing).rejects.toThrow('release failed during close');
  });

  it('registers the bounded Pass 9 command without replacing the historical A–F runner', () => {
    expect(packageJson.scripts?.['e2e:frontend-pass9'])
      .toBe('node e2e/player-shell-wave-3.e2e.mjs --pass9');
    expect(fs.existsSync(runnerPath)).toBe(true);
  });

  it('restores the default theme captured from the actual running project instead of another hardcoded palette', () => {
    const source = fs.readFileSync(runnerPath, 'utf8');
    const body = functionBody(source, 'caseF');
    expect(body).toContain('const defaultTheme = before.theme');
    expect(body).toContain('defaultTheme.colors.accent');
    expect(body).toContain('defaultTheme.colors.text');
    expect(body).not.toContain('0x5ac8ff');
    expect(body).not.toContain('0xf2f6ff');
  });

  it('adds one same-userData close/relaunch case and uses the real accessible load controls', () => {
    const source = fs.readFileSync(runnerPath, 'utf8');
    const body = functionBody(source, 'runRestartCase');
    expect(source).toContain("process.argv.includes('--pass9')");
    expect(body).toContain("launchSession('G-first', userData)");
    expect(body).toContain("launchSession('G-second', userData)");
    expect(body).toContain("getByRole('button', { name: '读取存档', exact: true })");
    expect(body).toContain("getByRole('button', { name: /^读取槽位 1：/ })");
    expect(body).toContain('positionKey(saved.position)');
    expect(body).toContain('positionKey(loaded.position)');
    expect(body).toContain('windows().length');
  });
});
