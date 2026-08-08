import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { decideSceneHotReload } from '../src/scene-hot-reload.js';

describe('decideSceneHotReload', () => {
  it('keeps the scene ID and clamps PC to the replacement boundary', () => {
    const replacement = compileScene('新文本', 's.gal', 's1');
    expect(decideSceneHotReload('s1', 999, replacement)).toMatchObject({ apply: true, nextPc: replacement.instructions.length });
    expect(decideSceneHotReload('s1', -2, replacement).nextPc).toBe(0);
  });

  it('rejects a mismatched scene and reports a changed hash', () => {
    const replacement = compileScene('新文本', 's.gal', 's1');
    expect(decideSceneHotReload('other', 0, replacement)).toMatchObject({ apply: false, nextPc: 0 });
    expect(decideSceneHotReload('s1', 0, replacement, 'old-hash').diagnostic).toMatch(/源码已变化/);
  });
});
