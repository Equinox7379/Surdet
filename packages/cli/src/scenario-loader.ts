import * as fs from 'node:fs';
import * as path from 'node:path';

/** 选中的项目根可为链接；其内部内容目录的每一段都必须是普通目录。 */
export function resolveContentDirectory(projectRoot: string, directory: string): string | null {
  const root = fs.realpathSync(projectRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error(`项目根目录不是目录：${projectRoot}`);
  const target = path.resolve(root, directory);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`内容路径不在项目根目录内：${directory}`);
  }
  let current = root;
  for (const segment of relative === '' ? [] : relative.split(path.sep)) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`内容读取不接受链接文件或目录：${current}`);
    if (!stat.isDirectory()) throw new Error(`内容路径不是目录：${current}`);
  }
  return current;
}

/**
 * 扫描项目剧本目录，收集全部 .gal 文件。
 * 默认约定：<root>/content/scenario/ 目录树内的全部 .gal 文件
 */
export function findGalFiles(projectRoot: string, scenarioDir = 'content/scenario'): string[] {
  const results: string[] = [];
  const dir = resolveContentDirectory(projectRoot, scenarioDir);
  if (dir === null) return results;
  const scan = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`内容读取不接受链接文件或目录：${full}`);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gal')) {
        results.push(full);
      }
    }
  };
  scan(dir);
  return results;
}

/** 场景 ID 取自文件名（去扩展名），如 ch01_01.gal → ch01_01 */
export function sceneIdFromFile(file: string): string {
  return path.basename(file, path.extname(file));
}
