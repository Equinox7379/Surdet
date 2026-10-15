import { describe, expect, it, vi } from 'vitest';
import { cmdPack } from '../src/pack.js';

describe('cmdPack', () => {
  it('rejects a missing target without invoking npm', async () => {
    const exported = vi.fn();
    expect(await cmdPack(undefined, { export: exported })).toBe(1);
    expect(exported).not.toHaveBeenCalled();
  });

  it('rejects plaintext release before invoking the shared exporter', async () => {
    const previous = process.env.SURDET_ENCRYPT, exported = vi.fn();
    process.env.SURDET_ENCRYPT = '0';
    try {
      expect(await cmdPack('game', { export: exported })).toBe(1);
      expect(exported).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SURDET_ENCRYPT; else process.env.SURDET_ENCRYPT = previous;
    }
  });

  it('passes an explicit project and new output folder to the shared export core', async () => {
    const exported = vi.fn(async () => ({ directory: 'out', executable: 'out/game.exe', id: 'game', title: '游戏', version: '1.0.0' }));
    expect(await cmdPack('game', { export: exported }, new Map([['--output', 'output/game'], ['--trust-plugins', 'counter,panel'], ['--runtime', 'runtime/Surdet Editor.exe']]))).toBe(0);
    expect(exported).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: expect.stringContaining('game'), folderName: 'game', encrypted: true, trustedPlugins: ['counter', 'panel'],
      runtime: expect.objectContaining({ executable: 'Surdet Editor.exe', gameRuntime: expect.stringContaining('game-runtime') }),
    }));
  });
});
