import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  resolvePackPolicy,
  assertSafeStagePath,
  buildPackMetadata,
} from '../scripts/pack-policy.mjs';

describe('pack policy', () => {
  const shellDir = path.resolve('E:/surdet/packages/shell');

  it('requires an explicit game directory', () => {
    expect(() => resolvePackPolicy({}, shellDir)).toThrow(/SURDET_GAME_DIR/);
  });

  it('rejects plaintext release packaging', () => {
    expect(() => resolvePackPolicy({
      SURDET_GAME_DIR: 'E:/surdet/examples/zero-after-midnight',
      SURDET_PACK_MODE: 'release',
      SURDET_ENCRYPT: '0',
    }, shellDir)).toThrow(/正式发行.*加密/);
  });

  it('allows explicit plaintext development staging', () => {
    const policy = resolvePackPolicy({
      SURDET_GAME_DIR: 'E:/surdet/examples/starter',
      SURDET_PACK_MODE: 'development',
      SURDET_ENCRYPT: '0',
    }, shellDir);
    expect(policy).toMatchObject({ mode: 'development', encrypted: false });
  });

  it('only accepts the dedicated stage root', () => {
    expect(() => assertSafeStagePath(path.join(shellDir, 'game'), shellDir)).toThrow(/staging/);
    expect(assertSafeStagePath(path.join(shellDir, '.pack-stage'), shellDir))
      .toBe(path.join(shellDir, '.pack-stage'));
  });

  it('builds sorted, identity-bearing metadata', () => {
    expect(buildPackMetadata({
      game: 'zero-after-midnight', version: '0.1.0', title: '零点之后',
      entryScene: 'prologue', sourceDirName: 'zero-after-midnight',
      assetFiles: ['z.png', 'a.png'], mode: 'release', encrypted: true,
    })).toEqual({
      engine: 'surdet', game: 'zero-after-midnight', version: '0.1.0',
      title: '零点之后', entryScene: 'prologue', sourceDirName: 'zero-after-midnight',
      assetFiles: ['a.png', 'z.png'], mode: 'release', encrypted: true,
    });
  });
});
