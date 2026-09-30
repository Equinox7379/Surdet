import { describe, expect, it } from 'vitest';
import { readGalleryEndings, effectiveEndingUnlocks } from '../src/systems/gallery-endings.js';
import { ClearTracker } from '../src/systems/clear-tracker.js';

describe('ending-book metadata and completion projection', () => {
  it('preserves author fields and rejects malformed or duplicate entries', () => {
    const endings = [{ id: 'home', name: '归途', description: '', extra: { keep: true } }];
    expect(readGalleryEndings({ endings })).toEqual(endings);
    expect(readGalleryEndings({})).toEqual([]);
    for (const value of [null, {}, [{ id: '', name: '空' }], [{ id: 'a', name: 'A', description: false }], [...endings, ...endings]]) {
      expect(() => readGalleryEndings({ endings: value })).toThrow();
    }
  });
  it('keeps per-save clears separate from explicit permanent collection, including old saves and new games', () => {
    const tracker = new ClearTracker();
    const before = tracker.snapshot();
    tracker.markClear('home'); tracker.markClear('home');
    expect(tracker.snapshot()).toEqual({ endings: ['home'] });
    const permanent = ['night'];
    expect(effectiveEndingUnlocks(tracker.endings(), permanent)).toEqual(['home']);
    expect(effectiveEndingUnlocks(tracker.endings(), permanent, 'profile')).toEqual(['home', 'night']);
    tracker.restore(before);
    expect(effectiveEndingUnlocks(tracker.endings(), permanent, 'profile')).toEqual(['night']);
    tracker.restore(undefined);
    expect(effectiveEndingUnlocks(tracker.endings(), permanent)).toEqual([]);
    expect(permanent).toEqual(['night']);
  });
});
