import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { exportWindowsGame, type WindowsExportOptions, type WindowsExportResult } from './windows-export.js';

export interface PackDeps {
  export(options: WindowsExportOptions): Promise<WindowsExportResult>;
}

const cliDir = path.dirname(fileURLToPath(import.meta.url));
const shellDir = path.resolve(cliDir, '../../shell');

export async function cmdPack(gameDirArg: string | undefined, deps?: PackDeps, options: Map<string, string> = new Map()): Promise<number> {
  if (!gameDirArg || gameDirArg.trim() === '') {
    process.stderr.write('用法：surdet pack <gameDir>：必须显式指定游戏目录\n');
    return 1;
  }
  const gameDir = path.resolve(gameDirArg);
  try {
    if (process.env.SURDET_ENCRYPT === '0') throw new Error('Windows正式导出必须启用素材加密。');
    const destination = path.resolve(options.get('--output') ?? path.join(path.dirname(gameDir), `${path.basename(gameDir)}-windows`));
    const require = createRequire(import.meta.url);
    const editorRuntime = options.get('--runtime');
    const executablePath = editorRuntime ? path.resolve(editorRuntime) : require('electron') as string;
    const runtimeDirectory = path.dirname(executablePath);
    const result = await (deps?.export ?? exportWindowsGame)({
      projectRoot: gameDir, outputParent: path.dirname(destination), folderName: path.basename(destination),
      title: options.get('--title'), version: options.get('--version'), icon: options.get('--icon'), encrypted: true,
      trustedPlugins: (options.get('--trust-plugins') ?? '').split(',').filter(Boolean),
      runtime: { directory: runtimeDirectory, executable: path.basename(executablePath),
        gameRuntime: editorRuntime ? path.join(runtimeDirectory, 'resources/game-runtime') : path.join(shellDir, 'game-runtime'), templates: path.resolve(cliDir, '../templates') },
    });
    process.stdout.write(`已导出Windows游戏：${result.executable}\n`);
    return 0;
  } catch (error) { process.stderr.write(`导出失败：${error instanceof Error ? error.message : String(error)}\n`); return 1; }
}
