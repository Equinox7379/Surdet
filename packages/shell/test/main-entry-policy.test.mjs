import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveGamePaths } from '../src/main-entry-policy.ts';

const developmentRoot = path.resolve('E:/surdet/examples/starter');
const packagedRoot = path.resolve('E:/surdet/resources/game');

function resolver(options = {}) {
  const directories = new Set(options.directories ?? []);
  const files = new Set(options.files ?? []);
  return resolveGamePaths({
    isPackaged: options.isPackaged ?? false,
    developmentRoot,
    packagedRoot,
    env: options.env ?? {},
    isDirectory: (candidate) => directories.has(candidate),
    fileExists: (candidate) => files.has(candidate),
  });
}

describe('shell game entry policy', () => {
  it('keeps the normal development path on the starter game', () => {
    expect(resolver()).toEqual({
      sourceRoot: developmentRoot,
      entry: path.join(developmentRoot, 'dist', 'index.html'),
      overrideUsed: false,
    });
  });

  it('accepts only an explicit absolute E2E dist directory with index.html', () => {
    const dist = path.resolve('E:/surdet/examples/zero-after-midnight/dist');
    expect(resolver({
      env: { SURDET_E2E: '1', SURDET_E2E_GAME_DIR: dist },
      directories: [dist],
      files: [path.join(dist, 'index.html')],
    })).toEqual({
      sourceRoot: path.resolve('E:/surdet/examples/zero-after-midnight'),
      entry: path.join(dist, 'index.html'),
      overrideUsed: true,
    });
  });

  it('rejects a game directory without the explicit E2E marker', () => {
    expect(() => resolver({ env: { SURDET_E2E_GAME_DIR: path.resolve('E:/games/custom/dist') } })).toThrow(/SURDET_E2E=1/);
  });

  it('rejects relative, missing, and index-less overrides', () => {
    expect(() => resolver({ env: { SURDET_E2E: '1', SURDET_E2E_GAME_DIR: 'relative/dist' } })).toThrow(/绝对路径/);
    const missing = path.resolve('E:/surdet/examples/missing/dist');
    expect(() => resolver({ env: { SURDET_E2E: '1', SURDET_E2E_GAME_DIR: missing } })).toThrow(/目录不存在/);
    const noIndex = path.resolve('E:/surdet/examples/no-index/dist');
    expect(() => resolver({
      env: { SURDET_E2E: '1', SURDET_E2E_GAME_DIR: noIndex },
      directories: [noIndex],
    })).toThrow(/index\.html/);
  });

  it('rejects test injection in packaged mode', () => {
    const dist = path.resolve('E:/surdet/examples/zero-after-midnight/dist');
    expect(() => resolver({
      isPackaged: true,
      env: { SURDET_E2E: '1', SURDET_E2E_GAME_DIR: dist },
      directories: [dist],
      files: [path.join(dist, 'index.html')],
    })).toThrow(/打包模式/);
  });
});
