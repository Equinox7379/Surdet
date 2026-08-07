import { describe, expect, it } from 'vitest';
import { TimelineRegistry, TimelineValidationError, validateTimeline } from '../src/timeline.js';

const valid = {
  version: 1,
  id: 'intro',
  durationMs: 900,
  tracks: [
    { kind: 'background', cues: [{ atMs: 0, durationMs: 400, easing: 'outCubic', action: 'set', key: 'hall' }] },
    { kind: 'camera', cues: [{ atMs: 0, durationMs: 900, easing: 'inOutSine', action: 'zoom', scale: 1.035 }] },
  ],
};

describe('timeline validation', () => {
  it('accepts parallel tracks', () => {
    expect(validateTimeline(valid)).toEqual([]);
  });

  it('rejects an overflowing cue and unknown action', () => {
    const diagnostics = validateTimeline({
      version: 1,
      id: 'bad',
      durationMs: 100,
      tracks: [{ kind: 'portrait', target: 'lynn:uniform', cues: [
        { atMs: 80, durationMs: 40, easing: 'linear', action: 'explode', expression: 'normal' },
      ] }],
    });
    expect(diagnostics.map((d) => d.code)).toContain('T006');
    expect(diagnostics.map((d) => d.code)).toContain('T008');
  });

  it('rejects malformed track payloads and unsupported easing', () => {
    const diagnostics = validateTimeline({
      version: 1,
      id: 'bad',
      durationMs: 100,
      tracks: [{ kind: 'camera', cues: [{ atMs: 0, durationMs: 10, easing: 'bounce', action: 'zoom', scale: -1 }] }],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(['T007', 'T009']);
  });
});

describe('TimelineRegistry', () => {
  it('clones definitions on registration and lookup', () => {
    const registry = new TimelineRegistry();
    const registered = registry.register(valid);
    registered.tracks[0]!.cues[0]!.key = 'changed';
    expect(registry.get('intro')!.tracks[0]!.cues[0]!.key).toBe('hall');
    expect(registry.has('intro')).toBe(true);
    expect(registry.all()).toHaveLength(1);
  });

  it('rejects duplicate IDs with structured diagnostics', () => {
    const registry = new TimelineRegistry();
    registry.register(valid);
    expect(() => registry.register(valid)).toThrow(TimelineValidationError);
    try {
      registry.register(valid);
    } catch (err) {
      expect((err as TimelineValidationError).diagnostics[0]!.code).toBe('T010');
    }
  });
});
