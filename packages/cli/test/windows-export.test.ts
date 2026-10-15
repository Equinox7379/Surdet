import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as asar from '@electron/asar';
import { NtExecutable } from 'resedit';
import { createDecipheriv } from 'node:crypto';
import { inspectWindowsExport, exportWindowsGame, type WindowsExportOptions } from '../src/windows-export.js';
import { checkReleaseManifest } from '../../shell/src/release-service.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function project(source = '第一句。\n@end') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-export-')); roots.push(root);
  const game = path.join(root, 'project');
  await fs.mkdir(path.join(game, 'content/scenario'), { recursive: true });
  await fs.writeFile(path.join(game, 'package.json'), JSON.stringify({ name: 'surdet-game-export', version: '1.2.3' }));
  await fs.writeFile(path.join(game, 'game.config.json'), JSON.stringify({ title: '测试作品', entryScene: 'intro', variables: {} }));
  await fs.writeFile(path.join(game, 'content/scenario/intro.gal'), source);
  const options: WindowsExportOptions = { projectRoot: game, outputParent: root, folderName: '成品', runtime: { directory: '', executable: 'electron.exe', gameRuntime: '', templates: '' } };
  return { root, game, options };
}
it('returns real saved content errors, including audio not just images', async () => {
  const { game } = await project('@bg nowhere\n@voice absent\n第一句。\n@end');
  const inspection = await inspectWindowsExport(game, '');
  expect(inspection.issues.some(issue => issue.code === 'ASSET_UNRESOLVED')).toBe(true);
  expect(inspection.issues.some(issue => issue.code === 'ASSET_REFERENCE_MISSING')).toBe(true);
});
it.each([true, false])('rejects already packaged asset bytes before export (encrypted=%s)', async encrypted => {
  const { game, root, options } = await project();
  const asset = path.join(game, 'content/assets/bg/packed.png');
  await fs.mkdir(path.dirname(asset), { recursive: true });
  const bytes = Buffer.concat([Buffer.from('SDAT2'), Buffer.alloc(40, 7)]);
  await fs.writeFile(asset, bytes);
  expect((await inspectWindowsExport(game, '')).issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'EXPORT_ENCRYPTED_SOURCE', severity: 'error', file: 'content/assets/bg/packed.png' }),
  ]));
  await expect(exportWindowsGame({ ...options, encrypted })).rejects.toThrow('导出检查未通过');
  expect(await fs.readdir(root)).toEqual(['project']);
  expect(await fs.readFile(asset)).toEqual(bytes);
});
it('rejects an existing output without touching its content', async () => {
  const { root, options } = await project();
  await fs.mkdir(path.join(root, '成品')); await fs.writeFile(path.join(root, '成品/保留.txt'), '我的文件');
  await expect(exportWindowsGame(options)).rejects.toThrow('已存在');
  expect(await fs.readFile(path.join(root, '成品/保留.txt'), 'utf8')).toBe('我的文件');
});
it('rejects malformed script before creating output', async () => {
  const { root, options } = await project('@if (\n坏脚本。');
  await expect(exportWindowsGame(options)).rejects.toThrow('导出检查未通过');
  expect(await fs.readdir(root)).toEqual(['project']);
});
it('refuses a customized project entry, rather than silently dropping behavior', async () => {
  const { root, game, options } = await project();
  await fs.mkdir(path.join(root, 'templates/game/src'), { recursive: true });
  await fs.writeFile(path.join(root, 'templates/game/src/main.ts'), 'canonical');
  await fs.mkdir(path.join(game, 'src')); await fs.writeFile(path.join(game, 'src/main.ts'), 'my custom code');
  options.runtime.templates = path.join(root, 'templates');
  await expect(exportWindowsGame(options)).rejects.toThrow('项目改过src/main.ts');
});
it('requires an explicit plugin trust decision without importing its code', async () => {
  const { game, options } = await project('@counter\n之后。\n@end');
  await fs.mkdir(path.join(game, 'plugins')); await fs.writeFile(path.join(game, 'plugins/counter.js'), 'throw new Error("must never execute here")');
  await fs.writeFile(path.join(game, 'game.config.json'), JSON.stringify({ title: '插件作品', entryScene: 'intro', variables: {}, plugins: [{ id: 'counter', entry: 'plugins/counter.js', apiVersion: 1, instructions: [{ name: 'counter', blocking: false, parameters: [] }] }] }));
  await expect(exportWindowsGame(options)).rejects.toThrow('明确确认');
});
it('does not export an instruction that only the old lint declaration recognizes', async () => {
  const { game, options } = await project('@not_installed\n正文。\n@end');
  await fs.writeFile(path.join(game, 'game.config.json'), JSON.stringify({ title: '缺宿主', entryScene: 'intro', variables: {}, customInstructions: ['not_installed'] }));
  await expect(exportWindowsGame(options)).rejects.toThrow('导出检查未通过');
});
it('cancel before the first async step produces no output', async () => {
  const { root, options } = await project(); const controller = new AbortController(); controller.abort(new Error('主动取消'));
  await expect(exportWindowsGame({ ...options, signal: controller.signal })).rejects.toThrow('主动取消');
  expect(await fs.readdir(root)).toEqual(['project']);
});
it('rejects a file used as the output parent and preserves that file', async () => {
  const { root, options } = await project(); const file = path.join(root, '不是目录'); await fs.writeFile(file, '保留');
  await expect(exportWindowsGame({ ...options, outputParent: file })).rejects.toThrow('不能使用文件');
  expect(await fs.readFile(file, 'utf8')).toBe('保留');
});
it.each(['CON', '../逃逸', '尾部.', 'x/y'])('rejects unsafe Windows output child %s', async name => {
  const { options } = await project(); await expect(exportWindowsGame({ ...options, folderName: name })).rejects.toThrow('Windows保留名称');
});

it.each(['1.2.3', '1.2.3.4'])('exports a %s update manifest the real release reader accepts', async version => {
  const { root, options } = await project();
  // Minimal PE/runtime fixtures exercise packaging and the real consumer, not game launch.
  const runtime = path.join(root, 'runtime');
  const gameRuntime = path.join(root, 'game-runtime');
  await fs.mkdir(runtime);
  await fs.writeFile(path.join(runtime, 'electron.exe'), Buffer.from(NtExecutable.createEmpty(false).generate()));
  await fs.mkdir(path.join(gameRuntime, 'game'), { recursive: true });
  for (const file of ['main.mjs', 'preload.cjs', 'game/index.html']) await fs.writeFile(path.join(gameRuntime, file), '');
  const before = Date.now();
  const result = await exportWindowsGame({ ...options, version, encrypted: false,
    runtime: { ...options.runtime, directory: runtime, gameRuntime } });
  const archive = path.join(result.directory, 'resources/app.asar');
  const bytes = asar.extractFile(archive, path.normalize('game/release/update-manifest.json'));
  const manifestFile = path.join(root, 'exported-update-manifest.json');
  await fs.writeFile(manifestFile, bytes);
  const check = await checkReleaseManifest(manifestFile, version);
  expect(check.status).toBe('up-to-date');
  expect(check.manifest).toMatchObject({ engine: 'surdet', game: result.id, version });
  const generatedAt = Date.parse(check.manifest!.generatedAt);
  expect(generatedAt).toBeGreaterThanOrEqual(before);
  expect(generatedAt).toBeLessThanOrEqual(Date.now());
  expect((await checkReleaseManifest(manifestFile, version === '1.2.3' ? '1.2.2.9' : '1.2.3.3')).status).toBe('update-available');
});

it.each([true, false])('shared Windows exporter owns media, notices and metadata without copying the Web dist (encrypted=%s)', async encrypted => {
  const { root, game, options } = await project();
  const media = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aONkAAAAASUVORK5CYII=', 'base64');
  const notice = Buffer.from('\uFEFFCopyright fixture author\r\n许可原文。\r\n');
  await fs.mkdir(path.join(game, 'content/assets/bg'), { recursive: true });
  await fs.mkdir(path.join(game, 'content/assets/licenses'), { recursive: true });
  await fs.mkdir(path.join(game, 'dist/assets'), { recursive: true });
  await fs.writeFile(path.join(game, 'content/assets/bg/room.png'), media);
  await fs.writeFile(path.join(game, 'content/assets/licenses/LICENSE-font.txt'), notice);
  await fs.writeFile(path.join(game, 'dist/assets/room.png'), media);
  const runtime = path.join(root, 'runtime'), gameRuntime = path.join(root, 'game-runtime');
  await fs.mkdir(runtime); await fs.mkdir(path.join(gameRuntime, 'game'), { recursive: true });
  await fs.writeFile(path.join(runtime, 'electron.exe'), Buffer.from(NtExecutable.createEmpty(false).generate()));
  for (const file of ['main.mjs', 'preload.cjs', 'game/index.html']) await fs.writeFile(path.join(gameRuntime, file), '');
  const result = await exportWindowsGame({ ...options, encrypted, runtime: { ...options.runtime, directory: runtime, gameRuntime } });
  const archive = path.join(result.directory, 'resources/app.asar');
  const read = (file: string) => asar.extractFile(archive, path.normalize(`game/${file}`));
  const packaged = read('content/assets/bg/room.png');
  if (encrypted) {
    expect(packaged.subarray(0, 5).toString()).toBe('SDAT2');
    const key = Buffer.from(read('.skey').toString(), 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, packaged.subarray(5, 17));
    decipher.setAuthTag(packaged.subarray(17, 33));
    expect(Buffer.concat([decipher.update(packaged.subarray(33)), decipher.final()])).toEqual(media);
  } else expect(packaged).toEqual(media);
  expect(await fs.readFile(path.join(result.directory, 'licenses/project/licenses/LICENSE-font.txt'))).toEqual(notice);
  expect(await fs.readFile(path.join(game, 'dist/assets/room.png'))).toEqual(media);
  expect(asar.listPackage(archive).some(file => /game[\\/]assets[\\/]room\.png/.test(file))).toBe(false);
  expect(JSON.parse(read('release/pack-metadata.json').toString())).toMatchObject({ game: result.id, encrypted,
    assetFiles: ['bg/room.png', 'licenses/LICENSE-font.txt'] });
});
