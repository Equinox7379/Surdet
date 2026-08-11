import fs from 'node:fs';
import path from 'node:path';

export interface GamePathResolution {
  readonly sourceRoot: string;
  readonly entry: string;
  readonly overrideUsed: boolean;
}

export interface GamePathResolutionOptions {
  readonly isPackaged: boolean;
  readonly developmentRoot: string;
  readonly packagedRoot: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isDirectory?: (candidate: string) => boolean;
  readonly fileExists?: (candidate: string) => boolean;
}

/**
 * Resolves the source root and HTML entry without consulting Electron state.
 * The only development override is an explicit, test-only absolute dist
 * directory. Packaged mode rejects the override instead of silently honoring
 * an inherited process environment.
 */
export function resolveGamePaths(options: GamePathResolutionOptions): GamePathResolution {
  const env = options.env ?? {};
  const isDirectory = options.isDirectory ?? ((candidate: string) => fs.statSync(candidate).isDirectory());
  const fileExists = options.fileExists ?? fs.existsSync;
  const marker = env.SURDET_E2E;
  const requestedDirectory = env.SURDET_E2E_GAME_DIR;
  const hasInjectionSettings = marker !== undefined || requestedDirectory !== undefined;

  if (options.isPackaged) {
    if (hasInjectionSettings) {
      throw new Error('打包模式拒绝 SURDET_E2E 游戏目录注入');
    }
    const sourceRoot = path.resolve(options.packagedRoot);
    return {
      sourceRoot,
      entry: path.join(sourceRoot, 'index.html'),
      overrideUsed: false,
    };
  }

  if (requestedDirectory !== undefined && marker !== '1') {
    throw new Error('SURDET_E2E_GAME_DIR 只能与 SURDET_E2E=1 一起使用');
  }
  if (marker !== '1') {
    const sourceRoot = path.resolve(options.developmentRoot);
    return {
      sourceRoot,
      entry: path.join(sourceRoot, 'dist', 'index.html'),
      overrideUsed: false,
    };
  }
  if (typeof requestedDirectory !== 'string' || requestedDirectory.trim().length === 0) {
    throw new Error('SURDET_E2E=1 必须同时提供 SURDET_E2E_GAME_DIR');
  }
  if (!path.isAbsolute(requestedDirectory)) {
    throw new Error(`SURDET_E2E_GAME_DIR 必须是绝对路径：${requestedDirectory}`);
  }

  const entryRoot = path.resolve(requestedDirectory);
  if (!isDirectory(entryRoot)) {
    throw new Error(`SURDET_E2E 游戏目录不存在或不是目录：${entryRoot}`);
  }
  const entry = path.join(entryRoot, 'index.html');
  if (!fileExists(entry)) {
    throw new Error(`SURDET_E2E 游戏目录缺少 index.html：${entry}`);
  }

  return {
    // The explicit directory is the built dist root; the shell still reads
    // game.config.json/content/assets from its sibling source root.
    sourceRoot: path.resolve(entryRoot, '..'),
    entry,
    overrideUsed: true,
  };
}
