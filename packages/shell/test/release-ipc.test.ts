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
  it('persists normalized device settings without arbitrary nested or oversized payloads', () => {
    const write = electron.handlers.get('settings:write')!;
    const file = path.join(electron.root, 'settings.json');
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 5000; i++) deep = { nested: deep };
    write(trusted, { masterVolume: 0.3, textScale: 999, locale: 'zh-CN', unknown: deep });
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved).toMatchObject({ masterVolume: 0.3, textScale: 1.4, locale: 'zh-CN' });
    expect(saved).not.toHaveProperty('unknown');
    const before = fs.readFileSync(file);
    expect(() => write(trusted, [1, 2])).toThrow('设置数据必须是对象');
    expect(() => write(trusted, { locale: `en${'-US'.repeat(30_000)}` })).toThrow('大小上限');
    expect(fs.readFileSync(file)).toEqual(before);
  });
  it('bounds a single log record and does not follow a prepositioned session log link', ctx => {
    const log = electron.handlers.get('log')!;
    const file = path.join(electron.root, 'logs/session.log');
    log(trusted, 'info', '文'.repeat(2_000_000));
    expect(fs.statSync(file).size).toBeLessThanOrEqual(1024 * 1024);
    const target = path.join(electron.root, 'log-victim.txt'); fs.writeFileSync(target, 'keep');
    fs.unlinkSync(file);
    try { fs.symlinkSync(target, file, 'file'); }
    catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) ctx.skip(); throw error; }
    log(trusted, 'info', 'must not reach victim');
    expect(fs.readFileSync(target, 'utf8')).toBe('keep');
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
    fs.unlinkSync(file);
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
