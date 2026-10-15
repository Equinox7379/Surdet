import { describe, expect, it, vi } from 'vitest';
import { AssetLoadQueue } from '../src/loading-progress.js';

describe('AssetLoadQueue', () => {
  it.each([NaN, Infinity, -Infinity])('rejects non-finite worker counts %s', concurrency => {
    expect(() => new AssetLoadQueue(concurrency)).toThrow(RangeError);
  });

  it('keeps finite concurrency clamping and executes every queued job', async () => {
    for (const [value, expected] of [[0, 1], [-2, 1], [2.9, 2], [99, 8]]) {
      const queue = new AssetLoadQueue(value); const load = vi.fn(async () => {});
      expect(queue.concurrency).toBe(expected);
      expect(await queue.run([{ id: 'one', priority: 'critical', load }])).toMatchObject({ completed: 1, failed: 0, done: true });
      expect(load).toHaveBeenCalledOnce();
    }
  });
  it('runs critical before scene before background while preserving order inside a priority', async () => {
    const order: string[] = [];
    const queue = new AssetLoadQueue(1);
    await queue.run([
      { id: 'b', priority: 'background', load: async () => { order.push('b'); } },
      { id: 'c', priority: 'critical', load: async () => { order.push('c'); } },
      { id: 's', priority: 'scene', load: async () => { order.push('s'); } },
    ]);
    expect(order).toEqual(['c', 's', 'b']);
  });

  it('limits concurrent jobs to the configured bound', async () => {
    let active = 0;
    let peak = 0;
    const jobs = Array.from({ length: 6 }, (_, index) => ({
      id: `job-${index}`,
      priority: 'scene' as const,
      load: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
      },
    }));

    await new AssetLoadQueue(2).run(jobs);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('rejects empty and duplicate job IDs before starting work', async () => {
    const load = vi.fn(async () => {});
    await expect(new AssetLoadQueue().run([
      { id: 'same', priority: 'critical', load },
      { id: 'same', priority: 'scene', load },
    ])).rejects.toThrow("duplicate or empty asset job 'same'");
    await expect(new AssetLoadQueue().run([
      { id: '  ', priority: 'critical', load },
    ])).rejects.toThrow("duplicate or empty asset job '  '");
    expect(load).not.toHaveBeenCalled();
  });

  it('settles failures and reports the final counts', async () => {
    const seen = vi.fn();
    const result = await new AssetLoadQueue(2).run([
      { id: 'ok', priority: 'critical', load: async () => {} },
      { id: 'bad', priority: 'scene', load: async () => { throw new Error('bad asset'); } },
    ], seen);
    expect(result).toMatchObject({ total: 2, completed: 1, failed: 1, current: null, done: true });
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ done: true }));
  });

  it('does not expose mutable progress state', async () => {
    let first: { total: number; completed: number; failed: number; current: string | null; done: boolean } | undefined;
    const seen = vi.fn((progress) => {
      first ??= { ...progress };
      progress.completed = 999;
      progress.failed = 999;
      progress.done = false;
    });

    const result = await new AssetLoadQueue(1).run([
      { id: 'asset', priority: 'critical', load: async () => {} },
    ], seen);

    expect(result).toMatchObject({ total: 1, completed: 1, failed: 0, done: true });
    expect(first).toMatchObject({ total: 1, completed: 0, failed: 0, done: false });
  });
});
