import { describe, expect, it } from 'vitest';
import { TimelinePlayer, ease } from '../src/timeline-player.js';

const definition = {
  version: 1 as const,
  id: 'intro',
  durationMs: 900,
  tracks: [
    { kind: 'background' as const, cues: [{ atMs: 0, durationMs: 400, easing: 'outCubic' as const, action: 'set', key: 'hall' }] },
    { kind: 'portrait' as const, target: 'lynn:uniform', cues: [{ atMs: 0, durationMs: 900, easing: 'linear' as const, action: 'show', expression: 'normal', position: 'left' }] },
  ],
};

describe('TimelinePlayer', () => {
  it('emits equal-time cues together and reaches exact final values', () => {
    const player = new TimelinePlayer(definition);
    expect(player.advance(0).map((e) => e.track)).toEqual(['background', 'portrait']);
    const last = player.advance(900);
    expect(last.at(-1)!.progress).toBe(1);
    expect(player.done).toBe(true);
  });

  it('does not emit a future cue before its start time', () => {
    const player = new TimelinePlayer({ ...definition, tracks: [{ ...definition.tracks[0]!, cues: [{ atMs: 300, durationMs: 100, easing: 'linear', action: 'set', key: 'hall' }] }] });
    expect(player.advance(100)).toEqual([]);
    expect(player.advance(250)).toHaveLength(1);
  });

  it('restores cursor and finalizes on skip', () => {
    const player = new TimelinePlayer(definition);
    player.advance(200);
    const restored = new TimelinePlayer(definition);
    restored.restore(player.snapshot());
    expect(restored.cursorMs).toBe(200);
    expect(restored.skip().every((e) => e.progress === 1)).toBe(true);
    expect(restored.done).toBe(true);
  });

  it('keeps easing endpoints exact', () => {
    for (const name of ['linear', 'inOutSine', 'outCubic', 'inOutCubic'] as const) {
      expect(ease(name, 0)).toBe(0);
      expect(ease(name, 1)).toBe(1);
    }
  });
});
