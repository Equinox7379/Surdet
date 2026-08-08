import { describe, expect, it } from 'vitest';
import { RollbackBuffer } from '../src/rollback-buffer.js';

describe('RollbackBuffer', () => {
  it('deep-clones frames and preserves LIFO order', () => {
    const source = {
      snapshot: { vars: { trust: 1 } },
      presentation: { bg: 'room' },
      audio: { bgm: 'night', ambience: 'rain' },
    };
    const buffer = new RollbackBuffer<typeof source.snapshot>(2);
    buffer.push(source);
    source.snapshot.vars.trust = 9;

    expect(buffer.pop()?.snapshot.vars.trust).toBe(1);
    expect(buffer.pop()).toBeNull();
  });

  it('keeps the newest 50 frames by default', () => {
    const buffer = new RollbackBuffer<{ index: number }>();
    for (let index = 0; index < 51; index++) {
      buffer.push({ snapshot: { index }, presentation: null, audio: { bgm: null, ambience: null } });
    }
    expect(buffer.size).toBe(50);
    expect(buffer.pop()?.snapshot.index).toBe(50);
    expect(buffer.size).toBe(49);
    while (buffer.pop()) { /* drain */ }
    expect(buffer.size).toBe(0);
  });

  it('rejects non-cloneable frame input with TypeError', () => {
    const buffer = new RollbackBuffer<{ value: number }>();
    expect(() => buffer.push({
      snapshot: { value: 1 },
      presentation: () => 'not cloneable',
      audio: { bgm: null, ambience: null },
    })).toThrow(TypeError);
  });
});
