import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

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
const trustedFrame = { url: '' };
const trusted = { senderFrame: trustedFrame, sender: { mainFrame: trustedFrame } };
const manifest = { engine: 'surdet', game: 'fixture', version: '1.1.0', generatedAt: '2026-10-01', notes: '本地版本' };
let localManifest: string;
const fetchSpy = vi.fn(async () => new Response(JSON.stringify(manifest)));

beforeAll(async () => {
  electron.root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-release-ipc-'));
  trustedFrame.url = pathToFileURL(path.join(electron.root, 'index.html')).href;
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
  it('rejects sparse known arrays through save:write without replacing the readable slot', async () => {
    const write = electron.handlers.get('save:write')!;
    const read = electron.handlers.get('save:read')!;
    const good = { meta: { id: 'sparse-case', createdAt: 1, updatedAt: 1, schemaVersion: 3 }, variables: { score: 7 },
      position: null, kind: 'manual', readSet: ['intro:1'], gallery: { cgs: [], music: [] } };
    await write(trusted, 'sparse-case', good);
    for (const bad of [
      { ...good, readSet: new Array(1) },
      { ...good, gallery: { cgs: new Array(1), music: [] } },
      { ...good, clears: { endings: new Array(1) } },
      { ...good, extension: { score: Infinity } },
      { ...good, extension: { calculate: () => 1 } },
    ]) {
      await expect(Promise.resolve().then(() => write(trusted, 'sparse-case', bad))).rejects.toThrow(/存档结构非法/);
      expect(await read(trusted, 'sparse-case')).toEqual(good);
    }
  });
  it('rejects cyclic and excessively nested saves through the real handler before changing the stored slot', async () => {
    const write = electron.handlers.get('save:write')!;
    const read = electron.handlers.get('save:read')!;
    const good = { meta: { id: 'depth-case', createdAt: 1, updatedAt: 1, schemaVersion: 3 }, variables: { score: 7 },
      position: null, kind: 'manual', readSet: [], gallery: { cgs: [], music: [] } };
    await write(trusted, 'depth-case', good);
    const before = await read(trusted, 'depth-case');
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const deep: Record<string, unknown> = {}; let tail = deep;
    for (let i = 0; i < 5000; i++) { const next = {}; tail.next = next; tail = next; }
    for (const bad of [{ ...good, variables: { data: cycle } }, { ...good, extension: deep }]) {
      await expect(Promise.resolve().then(() => write(trusted, 'depth-case', bad))).rejects.toThrow(/存档结构非法.*循环|存档结构非法.*256/);
      expect(await read(trusted, 'depth-case')).toEqual(before);
    }
  });
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
    const outsideFrame = { url: 'https://untrusted.invalid/' };
    await expect(check({ senderFrame: outsideFrame, sender: { mainFrame: outsideFrame } })).rejects.toThrow('非游戏入口主帧');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('rejects other local pages, same-URL subframes and missing frames at every registered IPC boundary', async () => {
    const write = electron.handlers.get('profile:write')!;
    const read = electron.handlers.get('profile:read')!;
    await write(trusted, 'origin-proof', { marker: 'trusted' });
    const otherLocal = { url: pathToFileURL(path.join(electron.root, 'outside.html')).href };
    const sameUrlChild = { url: trustedFrame.url };
    const events = [
      { senderFrame: otherLocal, sender: { mainFrame: otherLocal } },
      { senderFrame: sameUrlChild, sender: { mainFrame: trustedFrame } },
      { senderFrame: undefined, sender: { mainFrame: trustedFrame } },
    ];
    expect(electron.handlers.size).toBeGreaterThan(0);
    for (const event of events) {
      for (const handler of electron.handlers.values()) {
        await expect(Promise.resolve().then(() => handler(event, 'origin-proof', { marker: 'untrusted' }))).rejects.toThrow('非游戏入口主帧');
      }
    }
    await expect(read(trusted, 'origin-proof')).resolves.toEqual({ marker: 'trusted' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('keeps the current entry trusted with a query or fragment', async () => {
    const original = trustedFrame.url;
    trustedFrame.url = `${original}?audit=1#settings`;
    try {
      await expect(electron.handlers.get('release:check')!(trusted)).resolves.toMatchObject({ status: 'update-available' });
    } finally {
      trustedFrame.url = original;
    }
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
