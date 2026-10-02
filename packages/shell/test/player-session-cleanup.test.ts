import { describe, expect, it } from 'vitest';
// @ts-expect-error The real E2E runner helper is JavaScript, not a production API.
import { closePlayerSession } from '../e2e/player-session-cleanup.mjs';

function events() {
  return { intentionalClose: false, unexpectedWindowClosed: false, pageErrors: [] as string[],
    consoleErrors: [] as string[], requestFailures: [] as string[], unhandledRejections: [] as string[],
    rendererErrors: [] as string[], releaseFailures: [] as string[] };
}

describe('player runner shutdown verdict', () => {
  it('marks deliberate close before the window close event and accepts normal cleanup', async () => {
    const observed = events();
    expect(await closePlayerSession({ close: async () => {
      if (!observed.intentionalClose) observed.unexpectedWindowClosed = true;
    } }, observed)).toEqual([]);
    expect(observed.intentionalClose).toBe(true);
  });

  it.each(['pageErrors', 'consoleErrors', 'requestFailures', 'unhandledRejections', 'rendererErrors', 'releaseFailures'] as const)(
    'fails on a late %s event emitted during close', async channel => {
      const observed = events();
      const result = await closePlayerSession({ close: async () => { observed[channel].push('late failure'); } }, observed);
      expect(result).toEqual([`${channel}: ["late failure"]`]);
    });

  it('preserves close rejection and earlier runtime errors together', async () => {
    const observed = events();
    observed.pageErrors.push('original failure');
    observed.unexpectedWindowClosed = true;
    const result = await closePlayerSession({ close: async () => { throw new Error('close rejected'); } }, observed);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain('close rejected');
    expect(result[1]).toContain('original failure');
    expect(result[2]).toContain('意外关闭');
  });
});
