import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * surdet build [gameDir]：在游戏目录运行 vite 构建。
 */
export async function cmdBuild(projectDir: string): Promise<number> {
  if (!fs.existsSync(path.join(projectDir, 'package.json'))) {
    console.error(`不是有效的游戏项目目录：${projectDir}（缺少 package.json）`);
    return 1;
  }
  try {
    execSync('npm run build', { cwd: projectDir, stdio: 'inherit' });
    return 0;
  } catch {
    return 1;
  }
}
