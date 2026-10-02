import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDirectory } from '../desktop/directory.js';
import { startEditorServer } from '../desktop/server.js';
import { desktopDirectory, desktopProjectIdentity } from '../src/desktop.js';

const roots: string[] = [];
async function temporary() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-desktop-')); roots.push(root); return root; }
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe('desktop read-only project grants', () => {
  it('reads binary and Chinese paths, rejects traversal, and keeps physical identity on reopen', async () => {
    const root = await temporary();
    await fs.mkdir(path.join(root, '中文 空格'));
    await fs.writeFile(path.join(root, '中文 空格', 'a.bin'), Buffer.from([0, 128, 255]));
    const first = await openDirectory(root);
    const second = await openDirectory(root);
    expect(second.grant.identity).toBe(first.grant.identity);
    expect(second.grant.token).not.toBe(first.grant.token);
    const file = await first.read('中文 空格/a.bin');
    expect(file.kind).toBe('file');
    if (file.kind === 'file') expect([...file.bytes]).toEqual([0, 128, 255]);
    for (const invalid of ['../escape', '中文 空格/../a', 'C:/outside', 'a:stream', 'a\\b', 'a.']) await expect(first.read(invalid)).rejects.toThrow();
  });
  it('refuses directory junctions and replacement of the selected root', async ctx => {
    const parent = await temporary();
    const root = path.join(parent, 'project'); const outside = path.join(parent, 'outside');
    await fs.mkdir(root); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private.txt'), 'private');
    try { await fs.symlink(outside, path.join(root, 'linked'), 'junction'); }
    catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) { ctx.skip(); return; } throw error; }
    const opened = await openDirectory(root);
    await expect(opened.read('linked/private.txt')).rejects.toThrow('链接');
    await fs.rename(root, path.join(parent, 'original'));
    await fs.mkdir(root);
    await expect(opened.read('')).rejects.toThrow('替换');
  });
  it('adapts existing files without a writable escape and separates project identities', async () => {
    const root = await temporary(); await fs.writeFile(path.join(root, 'story.gal'), '你好');
    await fs.writeFile(path.join(root, 'background.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const opened = await openDirectory(root);
    vi.stubGlobal('window', { surdetDesktop: { read: (_token: string, name: string) => opened.read(name) } });
    const first = desktopDirectory(opened.grant);
    const second = desktopDirectory({ ...opened.grant, token: 'new-session' });
    expect(await first.isSameEntry(second)).toBe(true);
    const file = await second.getFileHandle('story.gal');
    expect(await first.resolve(file)).toEqual(['story.gal']);
    expect(await (await file.getFile()).text()).toBe('你好');
    expect((await (await first.getFileHandle('background.svg')).getFile()).type).toBe('image/svg+xml');
    expect(() => file.createWritable()).toThrow('正常保存');
    await expect(first.getFileHandle('new.gal', { create: true })).rejects.toThrow('正常保存');
    expect(desktopProjectIdentity(first)).toBe(`desktop:${opened.grant.identity}`);
    expect(await first.isSameEntry(desktopDirectory({ ...opened.grant, identity: 'other' }))).toBe(false);
  });
});

it('serves built UI only through the private desktop protocol and shuts down its listener', async () => {
  const root = await temporary();
  vi.stubEnv('SURDET_AGENT_DATA_DIR', path.join(root, 'agent'));
  await fs.writeFile(path.join(root, 'index.html'), '<html><head></head><body>编辑器</body></html>');
  const server = await startEditorServer(root, path.join(root, 'imports'));
  try {
    expect((await fetch(server.origin)).status).toBe(403);
    const page = await server.request(new Request('surdet-editor://app/index.html'));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('__SURDET_REVIEW_AUTHORITY__');
    expect((await server.request(new Request('surdet-editor://else/index.html'))).status).toBe(403);
    expect((await server.request(new Request('surdet-editor://app/index.html', { headers: { origin: 'https://example.com' } }))).status).toBe(403);
  } finally { await server.close(); }
  await expect(fetch(server.origin)).rejects.toThrow();
});
