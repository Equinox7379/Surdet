import * as fs from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';

export const WINDOWS_RENAME_RETRY_DELAYS_MS = Object.freeze([
  10,
  20,
  40,
  80,
  160,
  320,
  640,
] as const);

export interface RenameReplacementRuntime {
  readonly platform: NodeJS.Platform;
  readonly rename: (staged: string, target: string) => Promise<void>;
  readonly delay: (milliseconds: number) => Promise<void>;
  readonly retryDelaysMs: readonly number[];
}

const defaultRuntime: RenameReplacementRuntime = {
  platform: process.platform,
  rename: (staged, target) => fs.rename(staged, target),
  delay: async (milliseconds) => { await wait(milliseconds); },
  retryDelaysMs: WINDOWS_RENAME_RETRY_DELAYS_MS,
};

function isTransientWindowsRenameError(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EACCES' || code === 'EBUSY' || code === 'EPERM';
}

export async function replaceFileByRename(
  staged: string,
  target: string,
  runtime: RenameReplacementRuntime = defaultRuntime,
): Promise<void> {
  let retryIndex = 0;
  for (;;) {
    try {
      await runtime.rename(staged, target);
      return;
    } catch (error) {
      const delayMs = runtime.retryDelaysMs[retryIndex];
      if (runtime.platform !== 'win32' || !isTransientWindowsRenameError(error) || delayMs === undefined) {
        throw error;
      }
      retryIndex += 1;
      await runtime.delay(delayMs);
    }
  }
}
