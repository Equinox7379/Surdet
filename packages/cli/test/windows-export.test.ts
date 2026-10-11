import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { inspectWindowsExport, exportWindowsGame, type WindowsExportOptions } from '../src/windows-export.js';
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
