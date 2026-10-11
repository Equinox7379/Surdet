import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import { readProjectPlugins } from '@surdet/core';

export interface PackDeps {
  run(options: { cwd: string; env: NodeJS.ProcessEnv }): number;
}

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const shellDir = path.resolve(cliDir, '../../shell');

function defaultRun(options: { cwd: string; env: NodeJS.ProcessEnv }): number {
  try {
    execSync('npm run pack', {
      cwd: options.cwd,
      stdio: 'inherit',
      env: options.env,
    });
    return 0;
  } catch {
    return 1;
  }
}

export async function cmdPack(gameDirArg: string | undefined, deps?: PackDeps): Promise<number> {
  if (!gameDirArg || gameDirArg.trim() === '') {
    process.stderr.write('用法：surdet pack <gameDir>：必须显式指定游戏目录\n');
    return 1;
  }
  const gameDir = path.resolve(gameDirArg);
  const configPath = path.join(gameDir, 'game.config.json');
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
      for (const plugin of readProjectPlugins(config)) if (!fs.existsSync(path.join(gameDir, plugin.entry)) || !fs.statSync(path.join(gameDir, plugin.entry)).isFile()) throw new Error(`插件 ${plugin.id} 入口不存在：${plugin.entry}`);
    }
  } catch (error) { process.stderr.write(`导出前插件检查失败：${error instanceof Error ? error.message : String(error)}\n`); return 1; }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SURDET_GAME_DIR: gameDir,
    SURDET_PACK_MODE: process.env.SURDET_PACK_MODE?.trim() || 'release',
  };
  return (deps?.run ?? defaultRun)({ cwd: shellDir, env });
}
