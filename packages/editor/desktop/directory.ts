import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DirectoryGrant, DirectoryContent, FileContent } from './contracts.js';

/** Native grants are read-only; all editor writes keep using the existing authority. */
export async function openDirectory(directory: string) {
  const root = await fs.realpath(directory);
  const original = await fs.stat(root, { bigint: true });
  if (!original.isDirectory()) throw new Error('请选择项目文件夹。');
  const identity = createHash('sha256').update(`${root.toLowerCase()}\0${original.dev}\0${original.ino}\0${original.birthtimeNs}`).digest('hex');
  const grant: DirectoryGrant = { token: randomUUID(), name: path.basename(root), identity };
  const checkRoot = async () => {
    const current = await fs.lstat(root, { bigint: true });
    if (current.isSymbolicLink() || current.dev !== original.dev || current.ino !== original.ino || current.birthtimeNs !== original.birthtimeNs) {
      throw new Error('项目目录已经被替换，请重新打开。');
    }
  };
  const resolve = async (relative: string) => {
    if (typeof relative !== 'string' || relative.length > 4096) throw new Error('无效文件路径。');
    const parts = relative === '' ? [] : relative.split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f<>"|?*]/.test(part) || /[. ]$/.test(part))) throw new Error('文件路径超出所选目录。');
    await checkRoot();
    let target = root;
    for (const part of parts) {
      target = path.join(target, part);
      if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('不能通过链接读取项目外文件。');
    }
    return target;
  };
  const read = async (relative: string): Promise<DirectoryContent | FileContent> => {
    const target = await resolve(relative);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(target, { withFileTypes: true });
      await resolve(relative);
      return { kind: 'directory', entries: entries
        .filter(entry => entry.isFile() || entry.isDirectory())
        .filter(entry => !['.git', 'node_modules', 'dist'].includes(entry.name))
        .map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' })) };
    }
    if (!stat.isFile()) throw new Error('不支持此文件类型。');
    const bytes = await fs.readFile(target);
    const after = await fs.stat(await resolve(relative));
    if (stat.dev !== after.dev || stat.ino !== after.ino || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error('文件读取期间发生变化，请重试。');
    return { kind: 'file', bytes, lastModified: stat.mtimeMs };
  };
  return { root, grant, read };
}
