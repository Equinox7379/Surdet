import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/index.js';
import {
  parseProjectStage, readProjectStage, stageDefaultPose, stagePoseFromModifiers,
  stageCommandFromInstruction, validateStageFrame, stageConfigurationKey, projectStageAssetKeys,
} from '../src/stage.js';
import { TimelineRegistry, validateTimeline, type TimelineDefinition } from '../src/timeline.js';

const cue = { atMs: 0, durationMs: 100, easing: 'linear' as const, action: 'pose', x: 720 };
const leaf = (): TimelineDefinition => ({ version: 2, id: 'leaf', durationMs: 100,
  tracks: [{ kind: 'portrait', target: 'rin:coat', cues: [{ ...cue }] }] });

describe('Project stage data, not a second runtime', () => {
  it('keeps old projects opt-out and separates named defaults from display scaling', () => {
    expect(readProjectStage({})).toBeNull();
    expect(readProjectStage({ stage: null })).toBeNull();
    const stage = parseProjectStage({ version: 1, design: { width: 1600, height: 900 } });
    expect(stage.positions.left).toEqual({ x: 400, y: 900 });
    expect(stageDefaultPose(stage, 'rin:coat')).toEqual({ x: 800, y: 900, scale: 1, facing: 'right', opacity: 1,
      z: 0, baseHeight: 810, anchorX: .5, anchorY: 1 });
  });

  it('applies presets before explicit overrides and preserves omitted current properties', () => {
    const stage = parseProjectStage({ version: 1, positions: { pier: { x: 120, y: 680 } }, distances: { close: 1.8 } });
    const previous = { ...stageDefaultPose(stage, 'rin:coat'), x: 33, y: 42, opacity: .35, facing: 'left' as const, z: 5 };
    const next = stagePoseFromModifiers(stage, 'rin:coat', new Map([['pos', 'pier'], ['distance', 'close'], ['x', '150'], ['scale', '1.2']]), previous);
    expect(next).toEqual({ ...previous, x: 150, y: 680, scale: 1.2 });
    expect(previous.x).toBe(33);
    expect(() => stagePoseFromModifiers(stage, 'rin:coat', new Map([['pos', 'unknown']]))).toThrow(/位置/);
    expect(() => stagePoseFromModifiers(stage, 'rin:coat', new Map([['alpha', '.2'], ['opacity', '.8']]))).toThrow(/不得/);
  });

  it('distinguishes composition omission, explicit clearing, and actor/camera retention', () => {
    const stage = parseProjectStage({ version: 1, compositions: {
      keep: {}, clear: { background: null, layers: [], keepActors: false, resetCamera: true },
      dock: { background: '港口', layers: [{ id: 'rail', key: 'rail', band: 'foreground', parallax: 1.2 }] },
    } });
    expect(stage.compositions.keep).toEqual({ keepActors: true, resetCamera: false });
    expect(stage.compositions.clear).toEqual({ background: null, layers: [], keepActors: false, resetCamera: true });
    expect(projectStageAssetKeys(stage)).toEqual(['rail', '港口']);
  });

  it('validates calibration against the actual source extent without scanning alpha pixels', () => {
    expect(validateStageFrame({ x: 12, y: 16, width: 300, height: 600 }, 400, 700)).toEqual({ x: 12, y: 16, width: 300, height: 600 });
    expect(() => validateStageFrame({ x: 0, y: 8, width: 400, height: 700 }, 400, 700)).toThrow(/边界/);
    expect(() => parseProjectStage({ version: 1, portraits: { 'rin:coat': { height: 0 } } })).toThrow();
  });

  it('rejects invalid finite values and unsupported configuration rather than silently dropping them', () => {
    for (const stage of [
      { version: 1, design: { width: 0 } }, { version: 1, design: { height: Infinity } },
      { version: 1, distances: { near: 0 } }, { version: 1, extra: {} },
      { version: 1, compositions: { x: { layers: [{ id: 'x', key: 'a' }, { id: 'x', key: 'b' }] } } },
    ]) expect(() => parseProjectStage(stage)).toThrow();
  });

  it('keeps literal object keys and stable identities independent of insertion order', () => {
    const a = parseProjectStage(JSON.parse('{"version":1,"positions":{"__proto__":{"x":7,"y":8},"front":{"x":1,"y":2}}}'));
    const b = parseProjectStage(JSON.parse('{"positions":{"front":{"y":2,"x":1},"__proto__":{"y":8,"x":7}},"version":1}'));
    expect(Object.prototype.hasOwnProperty.call(a.positions, '__proto__')).toBe(true);
    expect(stagePoseFromModifiers(a, 'rin:coat', new Map([['pos', '__proto__']])).x).toBe(7);
    expect(stageConfigurationKey(a)).toBe(stageConfigurationKey(b));
  });

  it('compiles the actual new commands in both scene and choice paths and rejects malformed new grammar', () => {
    const scene = compileScene('@scene start\n@pose rin:coat 200 @x 500 @facing left\n@layer rail "窗 前" @band foreground\n@stage pier\n@choice\n  继续 -> @pose rin:coat scale=1.2\n@end', 'start.gal', 'start');
    expect(scene.instructions.filter(value => value.op === 'instr').map(value => (value as { name: string }).name)).toEqual(['scene', 'pose', 'layer', 'stage', 'pose']);
    for (const source of ['@pose rin', '@pose rin @xx 20', '@layer rail @off @x 2', '@stage off @keepActors true']) {
      expect(() => compileScene(source, 'bad.gal', 'bad')).toThrow(/STAGE_INVALID/);
    }
    expect(stageCommandFromInstruction('pose', ['layer:rail'], new Map([['x', '50']]))).toMatchObject({ type: 'layer-pose', id: 'rail', durationMs: 0 });
  });
});

describe('Bounded reusable timeline fragments', () => {
  it('keeps v1 semantics and requires v2 for new layer and pose actions', () => {
    expect(validateTimeline(leaf())).toEqual([]);
    expect(validateTimeline({ ...leaf(), version: 1 }).some(d => d.code === 'TL008')).toBe(true);
    expect(validateTimeline({ version: 2, id: 'layer', durationMs: 0, tracks: [{ kind: 'layer', target: 'rail', cues: [
      { atMs: 0, durationMs: 0, easing: 'linear', action: 'show', key: 'dock', opacity: .4, z: 3 },
    ] }] })).toEqual([]);
  });

  it('resolves forward references, repetition, offsets and nested finite clips without mutating source', () => {
    const registry = new TimelineRegistry();
    registry.register({ version: 2, id: 'parent', durationMs: 350, tracks: [], clips: [{ timelineId: 'leaf', atMs: 25, repeat: 3, gapMs: 10 }] });
    registry.register(leaf());
    const resolved = registry.get('parent')!;
    expect(resolved.tracks.flatMap(track => track.cues.map(c => c.atMs))).toEqual([25, 135, 245]);
    expect(resolved.clips).toBeUndefined();
    resolved.tracks[0]!.cues[0]!.x = -1;
    expect(registry.get('parent')!.tracks[0]!.cues[0]!.x).toBe(720);
  });

  it('retargets the stage instance without changing its actual portrait resource identity', () => {
    const registry = new TimelineRegistry();
    registry.register({ ...leaf(), tracks: [{ kind: 'portrait', target: 'rin:coat', cues: [{ ...cue, action: 'show', expression: 'smile', position: 'center' }] }] });
    registry.register({ version: 2, id: 'duet', durationMs: 100, tracks: [], clips: [{ timelineId: 'leaf', atMs: 0, targets: { 'rin:coat': 'reflection' } }] });
    const track = registry.get('duet')!.tracks[0]!;
    expect(track.target).toBe('reflection');
    expect(track.cues[0]!.source).toBe('rin:coat');
  });

  it('rejects missing, cyclic, overflowing and unknown-target references before playback', () => {
    const cases: unknown[][] = [
      [{ version: 2, id: 'a', durationMs: 100, tracks: [], clips: [{ timelineId: 'missing', atMs: 0 }] }],
      [{ version: 2, id: 'a', durationMs: 100, tracks: [], clips: [{ timelineId: 'b', atMs: 0 }] }, { version: 2, id: 'b', durationMs: 100, tracks: [], clips: [{ timelineId: 'a', atMs: 0 }] }],
      [leaf(), { version: 2, id: 'a', durationMs: 100, tracks: [], clips: [{ timelineId: 'leaf', atMs: 50 }] }],
      [leaf(), { version: 2, id: 'a', durationMs: 100, tracks: [], clips: [{ timelineId: 'leaf', atMs: 0, targets: { wrong: 'reflection' } }] }],
    ];
    for (const definitions of cases) {
      const registry = new TimelineRegistry(); definitions.forEach(definition => registry.register(definition));
      expect(() => registry.get('a')).toThrow(/TL012/);
    }
  });

  it('bounds zero-cue expansion independently of expanded cue count', () => {
    const registry = new TimelineRegistry();
    registry.register({ version: 2, id: 'empty', durationMs: 0, tracks: [{ kind: 'camera', cues: [] }] });
    registry.register({ version: 2, id: 'many', durationMs: 0, tracks: [], clips: [{ timelineId: 'empty', atMs: 0, repeat: 100 }] });
    registry.register({ version: 2, id: 'too_many', durationMs: 0, tracks: [], clips: [{ timelineId: 'many', atMs: 0, repeat: 100 }] });
    expect(() => registry.get('too_many')).toThrow(/10000/);
  });
});


it('rejects colliding or cross-kind clip bindings while preserving a same-kind swap', () => {
  const definitions = { version: 2, id: 'mixed', durationMs: 100, tracks: [
    { kind: 'portrait', target: 'a', cues: [{ ...cue }] },
    { kind: 'portrait', target: 'b', cues: [{ ...cue }] },
    { kind: 'layer', target: 'rail', cues: [{ ...cue }] },
  ] };
  for (const targets of [{ a: 'b' }, { a: 'rail' }, { a: 'same', b: 'same' }]) {
    const registry = new TimelineRegistry(); registry.register(definitions);
    registry.register({ version: 2, id: 'parent', durationMs: 100, tracks: [], clips: [{ timelineId: 'mixed', atMs: 0, targets }] });
    expect(() => registry.get('parent')).toThrow(/target/);
    expect(registry.get('mixed')!.tracks.map(track => track.target)).toEqual(['a', 'b', 'rail']);
  }
  const registry = new TimelineRegistry(); registry.register(definitions);
  registry.register({ version: 2, id: 'swap', durationMs: 100, tracks: [], clips: [{ timelineId: 'mixed', atMs: 0, targets: { a: 'b', b: 'a' } }] });
  expect(registry.get('swap')!.tracks.map(track => track.target)).toEqual(['b', 'a', 'rail']);
});
