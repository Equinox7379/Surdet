import { describe, expect, it } from 'vitest';
import { TimelineRegistry, TimelineValidationError, validateTimeline, resolveTimelineDefinition, type TimelineDefinition } from '../src/timeline.js';

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
    expect(diagnostics.map((d) => d.code)).toContain('TL006');
    expect(diagnostics.map((d) => d.code)).toContain('TL008');
  });

  it('rejects malformed track payloads and unsupported easing', () => {
    const diagnostics = validateTimeline({
      version: 1,
      id: 'bad',
      durationMs: 100,
      tracks: [{ kind: 'camera', cues: [{ atMs: 0, durationMs: 10, easing: 'bounce', action: 'zoom', scale: -1 }] }],
    });
    expect(diagnostics.map((d) => d.code)).toEqual(['TL007', 'TL009']);
  });

  it('accepts cinematic camera pan/shake and rejects unsafe ranges', () => {
    expect(validateTimeline({
      version: 1,
      id: 'camera_beats',
      durationMs: 900,
      tracks: [{ kind: 'camera', cues: [
        { atMs: 0, durationMs: 600, easing: 'inOutSine', action: 'pan', x: 180, y: -36 },
        { atMs: 600, durationMs: 180, easing: 'outCubic', action: 'shake', strength: 14 },
      ] }],
    })).toEqual([]);
    const diagnostics = validateTimeline({
      version: 1,
      id: 'unsafe_camera',
      durationMs: 900,
      tracks: [{ kind: 'camera', cues: [
        { atMs: 0, durationMs: 100, easing: 'linear', action: 'pan', x: 3000, y: 0 },
        { atMs: 100, durationMs: 100, easing: 'linear', action: 'shake', strength: 65 },
      ] }],
    });
    expect(diagnostics.map((d) => d.path)).toEqual(['$.tracks.0.cues.0.x', '$.tracks.0.cues.1.strength']);
  });
});

describe('TimelineRegistry', () => {
  it.each([1, 2] as const)('does not accept authored runtime cue provenance in version %s', version => {
    const input = { ...valid, version, resolvedCueSources: [[{ kind: 'timeline' as const, timelineId: 'forged', trackIndex: 99, cueIndex: 88 }]] };
    const before = JSON.stringify(input);
    const registry = new TimelineRegistry();
    expect(registry.register(input).resolvedCueSources).toBeUndefined();
    const resolved = registry.get('intro')!;
    const direct = resolveTimelineDefinition(input as TimelineDefinition, () => undefined);
    if (version === 1) {
      expect(resolved.resolvedCueSources).toBeUndefined();
      expect(direct.resolvedCueSources).toBeUndefined();
    } else {
      expect(resolved.resolvedCueSources?.[0]?.[0]).toEqual({ kind: 'timeline', timelineId: 'intro', trackIndex: 0, cueIndex: 0 });
      expect(direct.resolvedCueSources).toEqual(resolved.resolvedCueSources);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it('retains generated child coordinates and clip instances after stripping authored provenance', () => {
    const registry = new TimelineRegistry();
    registry.register(valid);
    registry.register({ version: 2, id: 'composed', durationMs: 1800, tracks: [], clips: [{ timelineId: 'intro', atMs: 0, repeat: 2 }],
      resolvedCueSources: [[{ kind: 'timeline', timelineId: 'forged', trackIndex: 99, cueIndex: 88 }]] });
    expect(registry.get('composed')!.resolvedCueSources?.map(track => track[0])).toEqual([
      ...[0, 1].flatMap(iteration => [0, 1].map(trackIndex => ({ kind: 'timeline', timelineId: 'intro', trackIndex, cueIndex: 0,
        instances: [{ timelineId: 'composed', clipIndex: 0, iteration }] }))),
    ]);
  });
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
      expect((err as TimelineValidationError).diagnostics[0]!.code).toBe('TL010');
    }
  });
});
