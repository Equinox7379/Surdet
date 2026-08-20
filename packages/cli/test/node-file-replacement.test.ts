import { describe, expect, it } from 'vitest';
import {
  WINDOWS_RENAME_RETRY_DELAYS_MS,
  replaceFileByRename,
  type RenameReplacementRuntime,
} from '../src/authoring/node-file-replacement.js';

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(`injected ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function runtime(
  rename: RenameReplacementRuntime['rename'],
  options: {
    platform?: NodeJS.Platform;
    retryDelaysMs?: readonly number[];
  } = {},
): { value: RenameReplacementRuntime; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    value: {
      platform: options.platform ?? 'win32',
      rename,
      retryDelaysMs: options.retryDelaysMs ?? WINDOWS_RENAME_RETRY_DELAYS_MS,
      delay: async (milliseconds) => { delays.push(milliseconds); },
    },
  };
}

describe('rename-only file replacement', () => {
  it('uses one rename and no delay on the normal path', async () => {
    const calls: string[] = [];
    const injected = runtime(async (staged, target) => { calls.push(`${staged}->${target}`); });

    await replaceFileByRename('staged.tmp', 'target.gal', injected.value);

    expect(calls).toEqual(['staged.tmp->target.gal']);
    expect(injected.delays).toEqual([]);
  });

  it('retries transient Windows rename errors with the fixed bounded schedule', async () => {
    let attempts = 0;
    const injected = runtime(async () => {
      attempts += 1;
      if (attempts <= 2) throw errno('EPERM');
    });

    await replaceFileByRename('staged.tmp', 'target.gal', injected.value);

    expect(attempts).toBe(3);
    expect(injected.delays).toEqual([10, 20]);
  });

  it('throws after the Windows retry budget without adding another mutation path', async () => {
    const failure = errno('EPERM');
    let attempts = 0;
    const injected = runtime(async () => { attempts += 1; throw failure; }, { retryDelaysMs: [1, 2] });

    await expect(replaceFileByRename('staged.tmp', 'target.gal', injected.value)).rejects.toBe(failure);

    expect(attempts).toBe(3);
    expect(injected.delays).toEqual([1, 2]);
  });

  it.each(['EIO', 'ENOENT', 'EEXIST'])(
    'does not retry non-transient %s errors',
    async (code) => {
      let attempts = 0;
      const failure = errno(code);
      const injected = runtime(async () => { attempts += 1; throw failure; });

      await expect(replaceFileByRename('staged.tmp', 'target.gal', injected.value)).rejects.toBe(failure);
      expect(attempts).toBe(1);
      expect(injected.delays).toEqual([]);
    },
  );

  it('does not retry EPERM outside Windows', async () => {
    let attempts = 0;
    const failure = errno('EPERM');
    const injected = runtime(async () => { attempts += 1; throw failure; }, { platform: 'linux' });

    await expect(replaceFileByRename('staged.tmp', 'target.gal', injected.value)).rejects.toBe(failure);
    expect(attempts).toBe(1);
    expect(injected.delays).toEqual([]);
  });
});
