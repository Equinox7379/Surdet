import { describe, expect, it } from 'vitest';
import { TimelinePlayer, ease } from '../src/timeline-player.js';
import { TimelineRegistry } from '../../core/src/timeline.js';

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
  it('emits actual source coordinates after untrusted author data passes through the shared registry', () => {
    const registry = new TimelineRegistry();
    registry.register({ ...definition, resolvedCueSources: [[{ kind: 'timeline', timelineId: 'forged', trackIndex: 99, cueIndex: 88 }]] });
    const events = new TimelinePlayer(registry.get('intro')!).eventsAtCursor();
    expect(events.map(event => event.source)).toEqual([
      { kind: 'timeline', timelineId: 'intro', trackIndex: 0, cueIndex: 0 },
      { kind: 'timeline', timelineId: 'intro', trackIndex: 1, cueIndex: 0 },
    ]);
  });
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

  it('marks a cue as started when a frame crosses a non-zero start time', () => {
    const player = new TimelinePlayer({
      ...definition,
      tracks: [{ ...definition.tracks[0]!, cues: [{ atMs: 23, durationMs: 400, easing: 'linear', action: 'set', key: 'hall' }] }],
    });
    expect(player.advance(16)).toEqual([]);
    const [event] = player.advance(16);
    expect(event?.started).toBe(true);
    expect(event?.progress).toBeGreaterThan(0);
    expect(player.advance(16)[0]?.started).toBe(false);
  });

  it('does not re-mark a cue started after the initial cursor projection', () => {
    const player = new TimelinePlayer(definition);
    expect(player.eventsAtCursor().every((event) => event.started)).toBe(true);
    expect(player.advance(16).every((event) => !event.started)).toBe(true);
  });

  it('restores cursor and finalizes on skip', () => {
    const player = new TimelinePlayer(definition);
    player.advance(200);
    const restored = new TimelinePlayer(definition);
    restored.restore(player.snapshot());
    expect(restored.cursorMs).toBe(200);
    expect(restored.skip().every((e) => e.progress === 1 && e.final)).toBe(true);
    expect(restored.done).toBe(true);
  });

  it('keeps easing endpoints exact', () => {
    for (const name of ['linear', 'inOutSine', 'outCubic', 'inOutCubic'] as const) {
      expect(ease(name, 0)).toBe(0);
      expect(ease(name, 1)).toBe(1);
    }
  });
});
