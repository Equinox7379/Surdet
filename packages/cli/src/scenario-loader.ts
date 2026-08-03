import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 扫描项目剧本目录，收集全部 .gal 文件。
 * 默认约定：<root>/content/scenario/ 目录树内的全部 .gal 文件
 */
export function findGalFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findGalFiles(full));
    } else if (entry.name.toLowerCase().endsWith('.gal')) {
      results.push(full);
    }
  }
  return results;
}

/** 场景 ID 取自文件名（去扩展名），如 ch01_01.gal → ch01_01 */
export function sceneIdFromFile(file: string): string {
  return path.basename(file, path.extname(file));
}
