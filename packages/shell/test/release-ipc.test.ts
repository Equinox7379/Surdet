import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  bridges: new Map<string, { check: (...args: unknown[]) => Promise<unknown> }>(),
  invoke: vi.fn(),
  ready: undefined as (() => void) | undefined,
  root: '',
}));
vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', getPath: () => electron.root, getAppPath: () => electron.root, isPackaged: false,
    requestSingleInstanceLock: () => true, on: vi.fn(), whenReady: () => ({ then: (ready: () => void) => { electron.ready = ready; } }) },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(name, handler) },
  contextBridge: { exposeInMainWorld: (name: string, bridge: { check: (...args: unknown[]) => Promise<unknown> }) => electron.bridges.set(name, bridge) },
  ipcRenderer: { invoke: electron.invoke },
  screen: { getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1280, height: 720 } }), getAllDisplays: () => [] },
  BrowserWindow: class { webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn() }; on = vi.fn(); loadFile = vi.fn(); },
  dialog: {}, shell: {},
}));
vi.mock('../src/main-entry-policy.js', () => ({ resolveGamePaths: () => ({ sourceRoot: electron.root, entry: path.join(electron.root, 'index.html') }) }));
const previousExceptions = new Set(process.listeners('uncaughtException'));
const previousRejections = new Set(process.listeners('unhandledRejection'));
const trusted = { senderFrame: { url: 'file:///game/index.html' } };
const manifest = { engine: 'surdet', game: 'fixture', version: '1.1.0', generatedAt: '2026-10-01', notes: '本地版本' };
let localManifest: string;
const fetchSpy = vi.fn(async () => new Response(JSON.stringify(manifest)));

beforeAll(async () => {
  electron.root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-release-ipc-'));
  fs.mkdirSync(path.join(electron.root, 'release'));
  localManifest = path.join(electron.root, 'release', 'update-manifest.json');
  fs.writeFileSync(localManifest, JSON.stringify(manifest));
  vi.stubGlobal('fetch', fetchSpy);
  await import('../src/main.js'); electron.ready!();
  await import('../src/preload.js');
  electron.invoke.mockImplementation((name: string, ...args: unknown[]) => electron.handlers.get(name)!(trusted, ...args));
});
afterAll(() => {
  for (const listener of process.listeners('uncaughtException')) if (!previousExceptions.has(listener)) process.removeListener('uncaughtException', listener);
  for (const listener of process.listeners('unhandledRejection')) if (!previousRejections.has(listener)) process.removeListener('unhandledRejection', listener);
  vi.unstubAllGlobals();
});

describe('release IPC source ownership', () => {
  it('reads only the main-process game manifest and reports missing or malformed local data', async () => {
    const check = electron.handlers.get('release:check')!;
    await expect(check(trusted)).resolves.toMatchObject({ status: 'update-available', manifest });
    fs.writeFileSync(localManifest, JSON.stringify({ ...manifest, version: '1.0.0' }));
    await expect(check(trusted)).resolves.toMatchObject({ status: 'up-to-date' });
    fs.writeFileSync(localManifest, '{broken');
    await expect(check(trusted)).resolves.toMatchObject({ status: 'invalid' });
    fs.unlinkSync(localManifest);
    await expect(check(trusted)).resolves.toMatchObject({ status: 'invalid' });
    fs.writeFileSync(localManifest, JSON.stringify(manifest));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects renderer-selected network and file sources before any network request', async () => {
    const check = electron.handlers.get('release:check')!;
    for (const source of ['http://127.0.0.1/private', 'http://169.254.169.254/', 'https://updates.invalid/redirect', 'D:/other/manifest.json', null]) {
      await expect(check(trusted, source)).rejects.toThrow('不接受');
    }
    await expect(check({ senderFrame: { url: 'https://untrusted.invalid/' } })).rejects.toThrow('非本地帧');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('preload exposes a no-source check and rejects arguments instead of forwarding them', async () => {
    const check = electron.bridges.get('surdetRelease')!.check;
    await expect(check()).resolves.toMatchObject({ status: 'update-available', manifest });
    expect(electron.invoke).toHaveBeenLastCalledWith('release:check');
    electron.invoke.mockClear();
    await expect(check('http://127.0.0.1/private')).rejects.toThrow('不接受');
    expect(electron.invoke).not.toHaveBeenCalled();
  });
});
