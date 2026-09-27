import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, TimelineRegistry,
  parseProjectStage, type CoreEventMap, type TimelineDefinition, type ProjectStage,
} from '@surdet/core';
import { WorldLayer } from '../../src/layers/world/world-layer.js';
import { DialogueLayer } from '../../src/layers/dialogue/dialogue-layer.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { createPresentationPorts } from '../../src/runtime/presentation-ports.js';
import { createStageGeometryPolicy } from '../../src/stage-geometry.js';
import { NULL_AUDIO } from '../../src/types.js';

const texture = (width: number, height: number) => new Texture({ source: new TextureSource({ width, height }) });
const poseCue = (atMs: number, durationMs: number, values: Record<string, string | number>) => ({ atMs, durationMs, easing: 'linear' as const, action: 'pose', ...values });
const config = () => parseProjectStage({ version: 1, portraits: { 'rin:coat': { height: 500,
  expressions: { normal: { x: 100, y: 100, width: 200, height: 500 }, smile: { x: 80, y: 50, width: 400, height: 1000 } } } },
  compositions: { pier: { background: 'dock', layers: [{ id: 'rail', key: 'rail', band: 'foreground', parallax: 1.5 }] },
    keep: {}, empty: { layers: [], background: null, keepActors: false, resetCamera: true }, broken: { background: 'missing' } },
});

async function harness(stageConfig: ProjectStage | null = config()) {
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const root = new Container();
  const normal = texture(400, 700), smile = texture(800, 1300), other = texture(300, 600), dock = texture(1280, 720), rail = texture(1280, 200);
  await assets.registerPortrait('rin', 'coat', 'normal', normal);
  await assets.registerPortrait('rin', 'coat', 'smile', smile);
  await assets.registerPortrait('mio', 'coat', 'normal', other);
  await assets.registerBackground('dock', dock);
  await assets.registerBackground('rail', rail);
  const width = stageConfig?.design.width ?? 1280, height = stageConfig?.design.height ?? 720;
  const world = new WorldLayer({ width, height, assets, lifecycle, stage: stageConfig, stageGeometry: createStageGeometryPolicy() });
  const dialogue = new DialogueLayer({ uiLayer: root, width, height, assets, lifecycle });
  const text: string[] = [];
  const stage = {
    setBackground: world.setBackground.bind(world), setPortrait: world.setPortrait.bind(world), removePortrait: world.removePortrait.bind(world),
    showText: (speaker: string | null, value: string) => { text.push(value); dialogue.showText(speaker, value); },
    beginText: (speaker: string | null) => dialogue.beginText(speaker), clearText: () => dialogue.clearText(),
    showChoices: () => {}, hideChoices: () => {}, setAwaiting: () => {},
    setNvlMode: (value: boolean) => dialogue.setNvlMode(value), appendNvlText: dialogue.appendNvlText.bind(dialogue), clearNvlText: () => dialogue.clearNvlText(),
    hideBacklog: () => {}, hideInterface: () => {}, showBanner: () => {},
    needsUpdate: () => world.needsUpdate,
  };
  const ports = createPresentationPorts(stage as never, { worldLayer: world, dialogueLayer: dialogue, assetRegistry: assets });
  const bus = new EventBus<CoreEventMap>();
  const sounds: string[] = [];
  let interpreter!: Interpreter;
  const controller = new PresentationController(ports.commands, ports.queries, { ...NULL_AUDIO, playSe: key => { sounds.push(key); } }, {
    commands: ports.commands, queries: ports.queries, validateStagePresentation: ports.validateStagePresentation,
    updateProjection: delta => world.update(delta), onWaitEnd: () => interpreter.finishWait(), onAdvance: () => interpreter.advance(),
  });
  const off = controller.connect(bus);
  const registry = new SceneRegistry(), timelines = new TimelineRegistry();
  interpreter = new Interpreter(new VariableStore([]), bus, registry);
  interpreter.setTimelineCatalog(timelines);
  interpreter.setPresentationHooks({ snapshot: context => controller.snapshotPresentation(context),
    validate: value => controller.validatePresentation(value), restore: value => controller.restorePresentation(value) });
  const sprites = () => {
    const result: Sprite[] = [];
    const visit = (container: Container) => { for (const child of container.children) { if (child instanceof Sprite) result.push(child); visit(child); } };
    visit(world.worldContainer); return result;
  };
  return { world, controller, interpreter, registry, timelines, assets, normal, smile, other, dock, rail, sounds, text, sprites,
    load(source: string, id = 'start') { registry.register(compileScene(source, `${id}.gal`, id)); interpreter.start(id); },
    pose(key = 'rin:coat') { return world.snapshotPresentation().portraits.find(value => value.key === key)!.view.pose!; },
    dispose() { off(); controller.dispose(); dialogue.dispose(); world.dispose(); assets.dispose(); lifecycle.dispose(); },
  };
}

describe('Stage composition through Core, Controller and the real World projection', () => {
  it('does not promote legacy portrait layout just because a screen cue was cancelled', async () => {
    const h = await harness(null);
    try {
      h.timelines.register({ version: 1, id: 'old-screen', durationMs: 1000, tracks: [{ kind: 'screen', cues: [
        { atMs: 0, durationMs: 1000, easing: 'linear', action: 'fade', alpha: 1 },
      ] }] });
      h.timelines.register({ version: 1, id: 'old-portrait', durationMs: 1000, tracks: [{ kind: 'portrait', target: 'rin:coat', cues: [
        { atMs: 0, durationMs: 1000, easing: 'linear', action: 'show', expression: 'normal', position: 'left' },
      ] }] });
      h.load('@timeline old-screen\n第一句。\n@stage off\n@timeline old-portrait\n第二句。\n@end');
      h.controller.update(100); h.interpreter.advance(); h.controller.update(100);
      expect(h.world.snapshotPresentation().portraits[0]!.view.pose).toBeUndefined();
    } finally { h.dispose(); }
  });
  it.each(['fade', 'tint'] as const)('gives a later %s timeline ownership over an unfinished scene action', async action => {
    const a = await harness(null), b = await harness(null);
    try {
      const definition: TimelineDefinition = { version: 2, id: 'later-screen', durationMs: 500, tracks: [{ kind: 'screen', cues: [
        { atMs: 0, durationMs: 200, easing: 'linear', action, alpha: .3, ...(action === 'tint' ? { color: 0x336699 } : {}) },
      ] }] };
      const source = `${action === 'fade' ? '@fadeout 1000' : '@tint ff0000 1 1000'}\n第一句。\n@timeline later-screen\n第二句。\n@end`;
      const read = (h: typeof a) => { const s = h.world.snapshotPresentation(); return action === 'fade' ? { alpha: s.fadeAlpha } : s.tint; };
      for (const h of [a, b]) { h.timelines.register(definition); h.load(source); }
      a.controller.update(400); a.interpreter.advance(); a.controller.update(50);
      b.interpreter.loadSnapshot(JSON.parse(JSON.stringify(a.interpreter.saveSnapshot())));
      expect(read(b)).toEqual(read(a));
      for (const h of [a, b]) h.controller.update(150);
      expect(read(b)).toEqual(read(a)); expect(read(b).alpha).toBeCloseTo(.3);
      for (const h of [a, b]) h.controller.update(1000);
      expect(read(b)).toEqual(read(a)); expect(read(b).alpha).toBeCloseTo(.3);
    } finally { a.dispose(); b.dispose(); }
  });

  it('splits direct-screen time at cue boundaries and preserves unrelated screen properties', async () => {
    const run = async (steps: number[]) => {
      const h = await harness(null);
      try {
        h.timelines.register({ version: 2, id: 'boundary', durationMs: 600, tracks: [{ kind: 'screen', cues: [
          { atMs: 200, durationMs: 400, easing: 'linear', action: 'fade', alpha: .8 },
        ] }] });
        h.load('@fadeout 1000\n@tint ff0000 1 1000\n@timeline boundary\n正文。\n@end');
        for (const step of steps) h.controller.update(step);
        const s = h.world.snapshotPresentation(); return { fade: s.fadeAlpha, tint: s.tint };
      } finally { h.dispose(); }
    };
    expect(await run([600])).toEqual(await run([100, 100, 100, 100, 100, 100]));
    expect(await run([600])).toMatchObject({ fade: .8, tint: { alpha: .6 } });
  });

  it('restores standalone scene fades, pauses, skips and rejects malformed direct states without mutation', async () => {
    const a = await harness(null), b = await harness(null);
    try {
      for (const h of [a, b]) h.load('@fadeout 1000\n正文。\n@end');
      a.controller.update(250); expect(a.world.snapshotPresentation().fadeAlpha).toBeCloseTo(.125);
      const saved = JSON.parse(JSON.stringify(a.interpreter.saveSnapshot()));
      b.interpreter.loadSnapshot(saved); expect(b.controller.canCaptureRollbackCheckpoint()).toBe(false);
      expect(b.world.snapshotPresentation()).toEqual(a.world.snapshotPresentation());
      b.controller.setPresentationPaused(true); b.controller.update(100);
      expect(b.world.snapshotPresentation().fadeAlpha).toBeCloseTo(.125);
      b.controller.setPresentationPaused(false); b.controller.update(250);
      expect(b.world.snapshotPresentation().fadeAlpha).toBeCloseTo(.5);
      const before = b.world.snapshotPresentation();
      const broken = JSON.parse(JSON.stringify(saved)); broken.presentation.payload.stage.motions.direct[0].elapsed = -1;
      expect(() => b.interpreter.loadSnapshot(broken)).toThrow(); expect(b.world.snapshotPresentation()).toEqual(before);
      b.world.applyStage({ type: 'skip-motions' }); expect(b.world.snapshotPresentation().fadeAlpha).toBe(1);
      expect(b.controller.canCaptureRollbackCheckpoint()).toBe(true);
      b.interpreter.start('start'); b.controller.update(250); expect(b.world.snapshotPresentation().fadeAlpha).toBeCloseTo(.125);
    } finally { a.dispose(); b.dispose(); }
  });

  it('lets direct setFade replace a timeline without taking tint ownership', async () => {
    const h = await harness(null);
    try {
      h.timelines.register({ version: 2, id: 'two-screen-properties', durationMs: 1000, tracks: [{ kind: 'screen', cues: [
        { atMs: 0, durationMs: 1000, easing: 'linear', action: 'fade', alpha: 1 },
        { atMs: 0, durationMs: 1000, easing: 'linear', action: 'tint', alpha: 1, color: 0xff0000 },
      ] }] });
      h.load('@timeline two-screen-properties\n正文。\n@end'); h.controller.update(400); h.world.setFade(.2); h.controller.update(100);
      expect(h.world.snapshotPresentation()).toMatchObject({ fadeAlpha: .2, tint: { alpha: .5 } });
      h.interpreter.loadSnapshot(JSON.parse(JSON.stringify(h.interpreter.saveSnapshot())));
      expect(h.world.snapshotPresentation()).toMatchObject({ fadeAlpha: .2, tint: { alpha: .5 } });
    } finally { h.dispose(); }
  });
  it('rejects invalid fade commands before changing the current screen owner', async () => {
    const h = await harness(null);
    try {
      h.load('@fadeout 1000\n正文。\n@end'); h.controller.update(250);
      const before = h.world.snapshotPresentation();
      for (const [from, to, duration] of [[0, 1, -1], [0, 1, NaN], [NaN, 1, 100], [0, NaN, 100]]) {
        expect(() => h.world.fade(from!, to!, duration!)).toThrow();
        expect(h.world.snapshotPresentation()).toEqual(before);
      }
      h.controller.update(250); expect(h.world.snapshotPresentation().fadeAlpha).toBeCloseTo(.5);
    } finally { h.dispose(); }
  });
  it('lets tint off take opacity while a timeline keeps its color through restore', async () => {
    const a = await harness(null), b = await harness(null);
    try {
      const definition: TimelineDefinition = { version: 2, id: 'color', durationMs: 1000, tracks: [{ kind: 'screen', cues: [
        { atMs: 0, durationMs: 1000, easing: 'linear', action: 'tint', alpha: 1, color: 0x0000ff },
      ] }] };
      const source = '@tint ff0000 1 100\n初始红色。\n@timeline color\n第一句。\n@tint off 200\n第二句。\n@end';
      for (const h of [a, b]) {
        h.timelines.register(definition); h.load(source); h.controller.update(100); h.interpreter.advance(); h.controller.update(400);
      }
      const previousColor = a.world.snapshotPresentation().tint.color;
      a.interpreter.advance(); a.controller.update(100); b.controller.update(100);
      const before = a.world.snapshotPresentation();
      expect(before.tint.alpha).toBeCloseTo(.5);
      expect(before.tint.color).not.toBe(previousColor);
      expect(before.tint.color).toBe(b.world.snapshotPresentation().tint.color);
      b.interpreter.loadSnapshot(JSON.parse(JSON.stringify(a.interpreter.saveSnapshot())));
      expect(b.world.snapshotPresentation()).toEqual(before);
      for (const h of [a, b]) h.controller.update(100);
      expect(b.world.snapshotPresentation()).toEqual(a.world.snapshotPresentation());
      expect(b.world.snapshotPresentation().tint.alpha).toBe(0);
    } finally { a.dispose(); b.dispose(); }
  });
  it.each(['fade', 'tint'] as const)('lets a later scene %s own the screen through save/load and completion', async action => {
    const a = await harness(), b = await harness();
    try {
      const definition: TimelineDefinition = { version: 2, id: 'shared-screen', durationMs: 1000, tracks: [{ kind: 'screen', cues: [
        { atMs: 0, durationMs: 1000, easing: 'linear', action, alpha: 1, ...(action === 'tint' ? { color: 0x33aa55 } : {}) },
      ] }] };
      const source = `@timeline shared-screen\n第一句。\n${action === 'fade' ? '@fadein 100' : '@tint off 100'}\n第二句。\n@end`;
      for (const h of [a, b]) { h.timelines.register(definition); h.load(source); }
      a.controller.update(400); a.interpreter.advance(); a.controller.update(50);
      const value = (h: typeof a) => action === 'fade' ? h.world.snapshotPresentation().fadeAlpha : h.world.snapshotPresentation().tint.alpha;
      const mid = value(a); expect(mid).toBeCloseTo(action === 'fade' ? .5 : .2);
      b.interpreter.loadSnapshot(JSON.parse(JSON.stringify(a.interpreter.saveSnapshot())));
      expect(value(b)).toBeCloseTo(mid);
      for (const h of [a, b]) h.controller.update(50);
      expect(value(a)).toBeCloseTo(0); expect(value(b)).toBeCloseTo(0);
      b.interpreter.loadSnapshot(JSON.parse(JSON.stringify(a.interpreter.saveSnapshot())));
      expect(value(b)).toBeCloseTo(0);
      for (const h of [a, b]) h.controller.update(1);
      expect(value(a)).toBeCloseTo(0); expect(value(b)).toBeCloseTo(0);
    } finally { a.dispose(); b.dispose(); }
  });
  it.each([0, 100, 300])('roundtrips legacy-to-pose expression changes at %sms without losing visibility', async elapsed => {
    const a = await harness(null), b = await harness(null);
    try {
      const source = '@show rin:coat normal @left\n第一句。\n@show rin:coat smile @x=400\n第二句。\n@end';
      a.load(source); b.load(source); a.interpreter.advance(); a.controller.update(elapsed);
      const saved = JSON.parse(JSON.stringify(a.interpreter.saveSnapshot()));
      b.interpreter.loadSnapshot(saved);
      expect(b.world.snapshotPresentation()).toEqual(a.world.snapshotPresentation());
      for (const h of [a, b]) h.controller.update(300);
      expect(b.pose()).toMatchObject({ x: 400, opacity: 1 });
      expect(b.sprites().find(sprite => sprite.texture === b.smile)!.alpha).toBe(1);
    } finally { a.dispose(); b.dispose(); }
  });

  it('promotes an ongoing legacy crossfade without treating its current alpha as semantic opacity', async () => {
    const a = await harness(null), b = await harness(null);
    try {
      const source = '@show rin:coat normal @left\n第一句。\n@show rin:coat smile\n@pose rin:coat @x=400\n第二句。\n@end';
      a.load(source); b.load(source); a.interpreter.advance(); a.controller.update(100);
      expect(a.pose().opacity).toBe(1);
      expect(a.world.snapshotPresentation().transitions!.portraits).toHaveLength(1);
      b.interpreter.loadSnapshot(JSON.parse(JSON.stringify(a.interpreter.saveSnapshot())));
      expect(b.world.snapshotPresentation()).toEqual(a.world.snapshotPresentation());
      for (const h of [a, b]) h.controller.update(200);
      expect(b.sprites().find(sprite => sprite.texture === b.smile)!.alpha).toBe(1);
    } finally { a.dispose(); b.dispose(); }
  });

  it.each(['fade', 'tint'] as const)('restores screen %s without repeating progress and continues the original trajectory', async action => {
    const a = await harness(), b = await harness();
    try {
      const definition: TimelineDefinition = { version: 2, id: 'screen', durationMs: 1000, tracks: [{ kind: 'screen', cues: [
        { atMs: 0, durationMs: 1000, easing: 'linear', action, alpha: 1, ...(action === 'tint' ? { color: 0x33aa55 } : {}) },
      ] }] };
      for (const h of [a, b]) { h.timelines.register(definition); h.load('@timeline screen @blocking\n完成。\n@end'); }
      a.controller.update(400);
      const saved = JSON.parse(JSON.stringify(a.interpreter.saveSnapshot()));
      const value = (h: typeof a) => action === 'fade' ? h.world.snapshotPresentation().fadeAlpha : h.world.snapshotPresentation().tint.alpha;
      for (let i = 0; i < 2; i++) { b.interpreter.loadSnapshot(saved); expect(value(b)).toBeCloseTo(.4, 10); }
      for (const h of [a, b]) h.controller.update(250);
      expect(value(b)).toBeCloseTo(value(a), 10);
      expect(b.interpreter.status).toBe('awaiting-timer');
    } finally { a.dispose(); b.dispose(); }
  });
  it('places two independent actors, preserves scale/facing/opacity and leaves the camera untouched', async () => {
    const h = await harness();
    try {
      h.load('@show rin:coat normal @x 300 @y 700 @scale 1.2 @facing left @opacity .7 @z 5\n@show mio:coat normal @x 900 @scale .6 @z -2\n正文。\n@end');
      expect(h.pose()).toMatchObject({ x: 300, y: 700, scale: 1.2, facing: 'left', opacity: .7, z: 5, baseHeight: 500 });
      expect(h.pose('mio:coat')).toMatchObject({ x: 900, scale: .6, z: -2 });
      expect(h.world.snapshotPresentation().cameraScale).toBe(1);
      const rin = h.sprites().find(sprite => sprite.texture === h.normal)!;
      expect(rin.scale.x).toBeLessThan(0);
      expect(Math.abs(rin.scale.y) * 500).toBeCloseTo(600);
      expect(rin.alpha).toBeCloseTo(.7);
      expect(h.world.snapshotPresentation().version).toBe(2);
    } finally { h.dispose(); }
  });

  it('keeps remaining legacy movement when opacity alone opts a moving actor into pose', async () => {
    const a = await harness(null), b = await harness(null);
    try {
      const source = '@show rin:coat normal @left\n正文。\n@end';
      for (const h of [a, b]) {
        h.load(source); h.world.movePortrait('rin:coat', 'right', 1000); h.controller.update(250);
        h.world.applyStage({ type: 'pose', target: 'rin:coat', modifiers: { opacity: '.8' } });
      }
      const saved = JSON.parse(JSON.stringify(a.interpreter.saveSnapshot()));
      b.interpreter.loadSnapshot(saved);
      for (const h of [a, b]) h.controller.update(300);
      expect(b.pose()).toEqual(a.pose());
      for (const h of [a, b]) h.controller.update(450);
      expect(b.pose()).toMatchObject({ x: 960, opacity: .8 });
    } finally { a.dispose(); b.dispose(); }
  });

  it.each([1, 2] as const)('restores overlapping nonlinear screen cues in timeline v%s at start, middle and end', async version => {
    const a = await harness(null), b = await harness(null);
    try {
      const definition: TimelineDefinition = { version, id: 'screen-overlap', durationMs: 1500, tracks: [{ kind: 'screen', cues: [
        { atMs: 0, durationMs: 1000, easing: 'inOutSine', action: 'fade', alpha: 1 },
        { atMs: 200, durationMs: 1000, easing: 'outCubic', action: 'fade', alpha: .2 },
        { atMs: 0, durationMs: 1000, easing: 'linear', action: 'tint', color: 0x33aa55, alpha: .8 },
        { atMs: 200, durationMs: 1000, easing: 'inOutCubic', action: 'tint', color: 0xaa2277, alpha: .3 },
      ] }] };
      for (const h of [a, b]) { h.timelines.register(definition); h.load('@timeline screen-overlap @blocking\n完成。\n@end'); }
      const state = (h: typeof a) => { const s = h.world.snapshotPresentation(); return { alpha: s.fadeAlpha, tint: s.tint }; };
      for (const delta of [0, 400, 250, 550]) {
        a.controller.update(delta);
        const saved = JSON.parse(JSON.stringify(a.interpreter.saveSnapshot()));
        for (let i = 0; i < 2; i++) { b.interpreter.loadSnapshot(saved); expect(state(b)).toEqual(state(a)); }
        a.controller.update(10); b.controller.update(10); expect(state(b)).toEqual(state(a));
      }
      for (const h of [a, b]) expect(h.controller.advance()).toBe(true);
      expect(state(b)).toEqual(state(a));
      expect(state(b)).toEqual({ alpha: .2, tint: { color: 0xaa2277, alpha: .3 } });
    } finally { a.dispose(); b.dispose(); }
  });

  it('rejects missing or mismatched screen origins before altering the current game', async () => {
    const a = await harness(null), b = await harness(null);
    try {
      const definition: TimelineDefinition = { version: 2, id: 'screen', durationMs: 1000, tracks: [{ kind: 'screen', cues: [
        { atMs: 0, durationMs: 1000, easing: 'linear', action: 'fade', alpha: 1 },
      ] }] };
      for (const h of [a, b]) { h.timelines.register(definition); h.load('@timeline screen @blocking\n完成。\n@end'); }
      a.controller.update(400); b.controller.update(100);
      const saved = JSON.parse(JSON.stringify(a.interpreter.saveSnapshot()));
      const current = () => { const { meta: _meta, ...snapshot } = b.interpreter.saveSnapshot()!; return snapshot; };
      const before = current();
      for (const fault of ['missing', 'target', 'legacy']) {
        const bad = JSON.parse(JSON.stringify(saved));
        if (fault === 'missing') bad.presentation.payload.stage.motions.timelines = [];
        else if (fault === 'target') bad.presentation.payload.stage.motions.timelines[0][1].to.opacity = .5;
        else bad.presentation.payload.stage = { version: 1, portraits: [], backgroundKey: null, cameraScale: 1,
          cameraPan: { x: 0, y: 0 }, fadeAlpha: .4, tint: { color: 0, alpha: 0 }, particleKind: null };
        expect(() => b.interpreter.loadSnapshot(bad)).toThrow(/screen effect/);
        expect(current()).toEqual(before);
      }
    } finally { a.dispose(); b.dispose(); }
  });

  it('pauses a restored screen cue and skips from mid-cue to the authoritative value', async () => {
    const a = await harness(null), b = await harness(null);
    try {
      const definition: TimelineDefinition = { version: 2, id: 'screen-skip', durationMs: 1000, tracks: [{ kind: 'screen', cues: [
        { atMs: 0, durationMs: 1000, easing: 'inOutCubic', action: 'tint', alpha: .8, color: 0xaa22bb },
      ] }] };
      for (const h of [a, b]) { h.timelines.register(definition); h.load('@timeline screen-skip @blocking\n完成。\n@end'); }
      a.controller.update(400); b.interpreter.loadSnapshot(JSON.parse(JSON.stringify(a.interpreter.saveSnapshot())));
      const saved = b.world.snapshotPresentation().tint;
      b.controller.setPresentationPaused(true); b.controller.update(500);
      expect(b.world.snapshotPresentation().tint).toEqual(saved);
      b.controller.setPresentationPaused(false);
      expect(b.controller.advance()).toBe(true);
      expect(b.world.snapshotPresentation().tint).toEqual({ color: 0xaa22bb, alpha: .8 });
      expect(b.interpreter.status).toBe('awaiting-advance');
    } finally { a.dispose(); b.dispose(); }
  });

  it('changes differently sized/trimmed expressions without moving or resizing the calibrated visible frame', async () => {
    const h = await harness();
    try {
      h.load('@show rin:coat normal @x 300 @y 690 @scale 1.2\n第一句。\n@show rin:coat smile\n第二句。\n@end');
      const before = { ...h.pose() };
      h.interpreter.advance();
      h.controller.update(300);
      expect(h.pose()).toEqual(before);
      const visible = h.sprites().filter(sprite => sprite.texture === h.smile);
      expect(visible).toHaveLength(1);
      expect(visible[0]!.scale.y * 1000).toBeCloseTo(600);
      expect(visible[0]!.x).toBe(300);
      expect(visible[0]!.y).toBe(690);
      expect(h.sprites().filter(sprite => sprite.texture === h.normal)).toHaveLength(0);
    } finally { h.dispose(); }
  });

  it('keeps the old opt-out show layout and original v1 snapshots', async () => {
    const h = await harness(null);
    try {
      h.load('@show rin:coat normal @left\n正文。\n@end');
      expect(h.world.snapshotPresentation().version).toBe(1);
      expect(h.world.snapshotPresentation().portraits[0]!.view.pose).toBeUndefined();
      const sprite = h.sprites().find(sprite => sprite.texture === h.normal)!;
      expect(sprite.x).toBe(1280 * .25); // exact value in the fixed legacy World baseline
      expect(sprite.y).toBeGreaterThanOrEqual(730);
    } finally { h.dispose(); }
  });

  it('preserves layer bands and explicit retention, with a missing composition rejected before mutation', async () => {
    const h = await harness();
    try {
      h.load('@show rin:coat normal\n@stage pier\n正文。\n@end');
      const before = h.world.snapshotPresentation();
      expect(before.layers).toMatchObject([{ id: 'rail', band: 'foreground', parallax: 1.5 }]);
      expect(() => h.world.applyStage({ type: 'composition', id: 'broken' })).toThrow(/missing/);
      expect(h.world.snapshotPresentation()).toEqual(before);
      h.world.applyStage({ type: 'composition', id: 'keep' });
      expect(h.world.snapshotPresentation().backgroundKey).toBe('dock');
      expect(h.world.snapshotPresentation().portraits).toHaveLength(1);
      h.world.applyStage({ type: 'composition', id: 'empty' });
      expect(h.world.snapshotPresentation()).toMatchObject({ backgroundKey: null, portraits: [], layers: [], cameraScale: 1, cameraPan: { x: 0, y: 0 } });
      expect(h.rail.destroyed).toBe(false);
    } finally { h.dispose(); }
  });

  it('moves camera and independently parallaxed layers without rewriting actor coordinates', async () => {
    const h = await harness();
    try {
      h.timelines.register({ version: 2, id: 'pan', durationMs: 100, tracks: [{ kind: 'camera', cues: [
        { atMs: 0, durationMs: 100, easing: 'linear', action: 'pan', x: 100, y: 0 },
      ] }] });
      h.load('@show rin:coat normal @x 300\n@stage pier\n@timeline pan @blocking\n正文。\n@end');
      h.controller.update(100);
      expect(h.pose().x).toBe(300);
      expect(h.world.snapshotPresentation().cameraPan).toEqual({ x: 100, y: 0 });
      const layer = h.sprites().find(sprite => sprite.texture === h.rail)!;
      expect(layer.x).toBeCloseTo(50);
      expect(h.world.worldContainer.x).toBeCloseTo(100);
    } finally { h.dispose(); }
  });

  it('gives the same later-writer result for one large step and many small steps', async () => {
    const run = async (steps: number[]) => {
      const h = await harness();
      try {
        h.timelines.register({ version: 2, id: 'old', durationMs: 1000, tracks: [{ kind: 'portrait', target: 'rin:coat', cues: [poseCue(0, 1000, { x: 1000, scale: 2 })] }] });
        h.timelines.register({ version: 2, id: 'new', durationMs: 1000, tracks: [{ kind: 'portrait', target: 'rin:coat', cues: [poseCue(250, 500, { x: 200 })] }] });
        h.load('@show rin:coat normal\n@timeline old\n@timeline new @blocking\n完成。\n@end');
        steps.forEach(step => h.controller.update(step));
        return { pose: { ...h.pose() }, status: h.interpreter.status, timelines: (h.controller.snapshotPresentation() as { timelines: unknown[] }).timelines };
      } finally { h.dispose(); }
    };
    const large = await run([1000]), small = await run(Array(100).fill(10));
    expect(large).toEqual(small);
    expect(large.pose).toMatchObject({ x: 200, scale: 2 });
    expect(large.status).toBe('awaiting-advance');
    expect(large.timelines).toEqual([]);
  });

  it('lets a later scene instruction take only its declared properties from an active timeline', async () => {
    const h = await harness();
    try {
      h.timelines.register({ version: 2, id: 'move', durationMs: 1000, tracks: [{ kind: 'portrait', target: 'rin:coat', cues: [poseCue(0, 1000, { x: 1000, scale: 2 })] }] });
      h.load('@show rin:coat normal\n@timeline move\n第一句。\n@pose rin:coat @x 150\n第二句。\n@end');
      h.controller.update(400);
      h.interpreter.advance();
      expect(h.pose().x).toBe(150);
      h.controller.update(600);
      expect(h.pose()).toMatchObject({ x: 150, scale: 2 });
    } finally { h.dispose(); }
  });

  it('roundtrips in-progress targets, captured starts, cursor and blocking state without replaying one-shot audio', async () => {
    const definition: TimelineDefinition = { version: 2, id: 'move', durationMs: 1000, tracks: [
      { kind: 'portrait', target: 'rin:coat', cues: [poseCue(0, 1000, { x: 1000, opacity: .4 })] },
      { kind: 'audio', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'se', key: 'click' }] },
    ] };
    const source = '@show rin:coat normal\n@timeline move @blocking\n完成。\n@end';
    const a = await harness(), b = await harness();
    try {
      for (const h of [a, b]) { h.timelines.register(definition); h.load(source); }
      a.controller.update(350);
      const saved = JSON.parse(JSON.stringify(a.interpreter.saveSnapshot())) as never;
      b.interpreter.loadSnapshot(saved);
      expect(b.pose()).toEqual(a.pose());
      expect(b.interpreter.status).toBe('awaiting-timer');
      expect(b.sounds).toEqual(['click']);
      for (const h of [a, b]) h.controller.update(250);
      expect(b.pose()).toEqual(a.pose());
      for (const h of [a, b]) h.controller.update(400);
      expect(b.pose()).toEqual(a.pose());
      expect(b.pose()).toMatchObject({ x: 1000, opacity: .4 });
      expect(b.sounds).toEqual(['click']);
      expect(b.interpreter.status).toBe('awaiting-advance');
    } finally { a.dispose(); b.dispose(); }
  });

  it('retains the expression crossfade at its saved time and completes it exactly once', async () => {
    const a = await harness(), b = await harness();
    try {
      const script = '@show rin:coat normal\n第一句。\n@show rin:coat smile\n第二句。\n@end';
      a.load(script); b.load(script);
      a.interpreter.advance(); a.controller.update(100);
      const snapshot = JSON.parse(JSON.stringify(a.interpreter.saveSnapshot())) as never;
      b.interpreter.loadSnapshot(snapshot);
      const alphas = (h: typeof a) => h.sprites().filter(sprite => sprite.texture === h.normal || sprite.texture === h.smile).map(sprite => sprite.alpha).sort();
      expect(alphas(b)).toEqual(alphas(a));
      a.controller.update(160); b.controller.update(160);
      expect(alphas(a)).toEqual([1]); expect(alphas(b)).toEqual([1]);
      expect(b.world.snapshotPresentation().transitions?.portraits).toEqual([]);
    } finally { a.dispose(); b.dispose(); }
  });

  it('rejects invalid pose, lost resources and changed stage identity before touching a good loaded game', async () => {
    const h = await harness();
    try {
      h.load('@show rin:coat normal\n保留这句。\n@end');
      const saved = JSON.parse(JSON.stringify(h.interpreter.saveSnapshot()));
      const before = h.world.snapshotPresentation();
      const corruptions = [
        (value: typeof saved) => { value.presentation.payload.stage.portraits[0].view.pose.scale = 0; },
        (value: typeof saved) => { value.presentation.payload.stage.stageConfigKey += 'changed'; },
        (value: typeof saved) => { value.presentation.payload.stage.portraits[0].view.expression = 'absent'; },
      ];
      for (const corrupt of corruptions) {
        const value = JSON.parse(JSON.stringify(saved)); corrupt(value);
        expect(() => h.interpreter.loadSnapshot(value)).toThrow();
        expect(h.world.snapshotPresentation()).toEqual(before);
        expect(h.interpreter.status).toBe('awaiting-advance');
      }
    } finally { h.dispose(); }
  });

  it('does not let an old active cue resurrect ownership after an actor was removed and shown anew', async () => {
    const h = await harness();
    try {
      h.timelines.register({ version: 2, id: 'old', durationMs: 1000, tracks: [{ kind: 'portrait', target: 'rin:coat', cues: [poseCue(0, 1000, { x: 1000 })] }] });
      h.load('@show rin:coat normal\n@timeline old\n等待。\n@end');
      h.controller.update(300);
      h.world.removePortrait('rin:coat');
      h.world.applyStage({ type: 'show', target: 'rin:coat', expression: 'normal', modifiers: { x: '90' } });
      h.controller.update(700);
      expect(h.pose().x).toBe(90);
    } finally { h.dispose(); }
  });

  it.each(['portrait', 'layer', 'clear'] as const)('cancels an active %s cue on removal, including save/load before its end', async kind => {
    const h = await harness(null);
    try {
      h.timelines.register({ version: 2, id: 'removed', durationMs: 1000, tracks: [
        { kind: kind === 'clear' ? 'portrait' : kind, target: kind !== 'layer' ? 'rin:coat' : 'rail', cues: [poseCue(0, 1000, { x: 800 })] },
      ] });
      h.load(kind !== 'layer'
        ? `@show rin:coat normal @x=100\n@timeline removed\n显示中。\n${kind === 'clear' ? '@stage off' : '@hide rin:coat'}\n已离场。\n@end`
        : '@layer rail rail\n@timeline removed\n显示中。\n@layer rail @off\n已离场。\n@end');
      h.controller.update(300);
      h.interpreter.advance();
      expect(h.world.inspectStage().objects).toEqual([]);
      const saved = h.interpreter.saveSnapshot()!;
      expect(() => h.controller.update(100)).not.toThrow();
      expect(() => h.interpreter.loadSnapshot(saved)).not.toThrow();
      expect(() => h.controller.update(700)).not.toThrow();
      expect(h.world.inspectStage().objects).toEqual([]);
      expect((h.controller.snapshotPresentation() as { timelines: unknown[] }).timelines).toEqual([]);
    } finally { h.dispose(); }
  });

  it('pauses presentation time, then skips to the correct final pose without replaying skipped SE', async () => {
    const h = await harness();
    try {
      h.timelines.register({ version: 2, id: 'move', durationMs: 1000, tracks: [
        { kind: 'portrait', target: 'rin:coat', cues: [poseCue(0, 1000, { x: 1000 })] },
        { kind: 'audio', cues: [{ atMs: 500, durationMs: 0, easing: 'linear', action: 'se', key: 'skipped' }] },
      ] });
      h.load('@show rin:coat normal\n@timeline move @blocking\n完成。\n@end');
      h.controller.update(200);
      const before = { ...h.pose() };
      h.controller.setPresentationPaused(true); h.controller.update(800);
      expect(h.pose()).toEqual(before);
      h.controller.setPresentationPaused(false);
      expect(h.controller.advance()).toBe(true);
      expect(h.pose().x).toBe(1000);
      expect(h.sounds).toEqual([]);
      expect(h.interpreter.status).toBe('awaiting-advance');
    } finally { h.dispose(); }
  });

  it('retains future authored cues after a scene clear and forgets cancellation on a new session', async () => {
    const h = await harness(null);
    try {
      h.timelines.register({ version: 2, id: 'returning', durationMs: 1000, tracks: [
        { kind: 'portrait', target: 'rin:coat', cues: [poseCue(0, 1000, { x: 800 }),
          { atMs: 600, durationMs: 0, easing: 'linear', action: 'show', expression: 'normal', x: 90 }] },
      ] });
      h.load('@show rin:coat normal @x=100\n@timeline returning\n第一句。\n@stage off\n清场。\n@end');
      h.controller.update(300); h.interpreter.advance();
      h.controller.update(300); expect(h.pose().x).toBe(90);
      h.controller.update(400); expect(h.pose().x).toBe(90);
      h.interpreter.start('start'); h.controller.update(300);
      expect(h.pose().x).toBeCloseTo(310);
    } finally { h.dispose(); }
  });
});
