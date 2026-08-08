import { describe, expect, it, vi } from 'vitest';
import { cmdPack } from '../src/pack.js';

describe('cmdPack', () => {
  it('rejects a missing target without invoking npm', async () => {
    const run = vi.fn();
    expect(await cmdPack(undefined, { run })).toBe(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('passes an explicit absolute target to shell packaging', async () => {
    const run = vi.fn(() => 0);
    expect(await cmdPack('E:/surdet/examples/zero-after-midnight', { run })).toBe(0);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        SURDET_GAME_DIR: expect.stringContaining('zero-after-midnight'),
        SURDET_PACK_MODE: 'release',
      }),
    }));
  });
});
