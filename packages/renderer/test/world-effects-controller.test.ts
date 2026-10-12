import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture, TextureSource } from 'pixi.js';
import { WorldEffectsController } from '../src/world-effects-controller.js';

function makeController(captureWorld?: () => Texture | null, resolveRule?: (key: string) => Texture | null) {
  const world = new Container();
  const screen = new Container();
  const base = { x: 10, y: 20 };
  let position = { x: 10, y: 20 };
  const controller = new WorldEffectsController({
    world,
    screen,
    width: 1280,
    height: 720,
    getBasePosition: () => base,
    setWorldPosition: (x, y) => { position = { x, y }; },
    duration: (ms) => ms,
    requestFrame: vi.fn(),
    captureWorld,
    resolveRule,
  });
  return { controller, world, screen, getPosition: () => position };
}

describe('WorldEffectsController', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reveals through a borrowed rule and releases only its old image on completion', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    const old = new Texture({ source: new TextureSource({ width: 1280, height: 720 }) });
    const mask = new Texture({ source: new TextureSource({ width: 2, height: 2 }) });
    const f = makeController(() => old, key => key === 'mask' ? mask : null);
    const options = { rule: 'mask', soft: .15, reverse: false };
    expect(f.controller.transition('rule', 100, options)).toBe(true);
    expect(f.controller.needsUpdate).toBe(false);
    f.controller.beforeStageMutation();
    expect(f.controller.transition('rule', 100, options)).toBe(true);
    const overlay = f.screen.children[0] as Sprite;
    expect(overlay.texture).toBe(old); expect(overlay.filters).toHaveLength(1);
    f.controller.update(50); expect(overlay.alpha).toBe(1);
    f.controller.markStageBoundary(); expect(f.screen.children).toHaveLength(1);
    f.controller.update(50); expect(f.screen.children).toHaveLength(0);
    expect(old.destroyed).toBe(true); expect(mask.destroyed).toBe(false);
    expect(f.controller.needsUpdate).toBe(false); f.controller.destroy(); mask.destroy(true);
  });
  it('refuses an absent rule and settles an active rule if its asset is released', () => {
    const old = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const mask = new Texture({ source: new TextureSource({ width: 2, height: 2 }) });
    let available = false;
    const f = makeController(() => old, () => available ? mask : null);
    const options = { rule: 'mask', soft: 0, reverse: true };
    f.controller.beforeStageMutation(); expect(f.controller.transition('rule', 100, options)).toBe(false);
    available = true; expect(f.controller.transition('rule', 100, options)).toBe(true);
    available = false; const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.controller.update(10); f.controller.update(10);
    expect(warning).toHaveBeenCalledTimes(1); warning.mockRestore();
    expect(old.destroyed).toBe(true); expect(mask.destroyed).toBe(false);
    expect(f.screen.children).toHaveLength(0); expect(f.controller.needsUpdate).toBe(false);
    f.controller.destroy(); mask.destroy(true);
  });
  it('cancels rule resources on reset without destroying the registered mask', () => {
    const old = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
    const mask = new Texture({ source: new TextureSource({ width: 2, height: 2 }) });
    const f = makeController(() => old, () => mask);
    f.controller.beforeStageMutation(); f.controller.transition('rule', 100, { rule: 'mask', soft: .15, reverse: false });
    f.controller.update(40); f.controller.reset();
    expect(old.destroyed).toBe(true); expect(mask.destroyed).toBe(false);
    expect(f.screen.children).toHaveLength(0); expect(f.controller.needsUpdate).toBe(false);
    f.controller.destroy(); mask.destroy(true);
  });
  it('dissolves one old frame per mutation batch and releases it on completion', () => {
    const texture = new Texture({ source: new TextureSource({ width: 1280, height: 720 }) });
    const capture = vi.fn(() => texture), f = makeController(capture);
    expect(f.controller.transition('dissolve', 100)).toBe(true);
    expect(f.controller.needsUpdate).toBe(false); // no change, no animation
    f.controller.beforeStageMutation(); f.controller.beforeStageMutation();
    expect(capture).toHaveBeenCalledTimes(1);
    f.controller.transition('dissolve', 100);
    const overlay = f.screen.children[0] as Sprite;
    expect(overlay.texture).toBe(texture); expect(overlay.alpha).toBe(1);
    f.controller.markStageBoundary(); // next dialogue must not remove the active old frame
    f.controller.beforeStageMutation(); // changes while active remain below it
    expect(capture).toHaveBeenCalledTimes(1);
    f.controller.update(50); expect(overlay.alpha).toBe(.5);
    f.controller.update(50); expect(f.screen.children).toHaveLength(0);
    expect(texture.destroyed).toBe(true); expect(f.controller.needsUpdate).toBe(false);
    f.controller.destroy();
  });

  it('releases unused captures at a pause and pending or active captures on teardown', () => {
    const textures: Texture[] = [];
    const f = makeController(() => { const t = new Texture({ source: new TextureSource({ width: 8, height: 8 }) }); textures.push(t); return t; });
    f.controller.beforeStageMutation(); f.controller.markStageBoundary();
    expect(textures[0]!.destroyed).toBe(true);
    f.controller.beforeStageMutation(); f.controller.transition('dissolve', 100);
    f.controller.reset(); expect(textures[1]!.destroyed).toBe(true);
    f.controller.markStageBoundary(); f.controller.beforeStageMutation(); f.controller.destroy();
    expect(textures.every(t => t.destroyed)).toBe(true);
    expect(f.screen.children).toHaveLength(0);
    expect(() => f.controller.destroy()).not.toThrow();
  });
  it('directional shake uses quadratic decay and restores the exact base position', () => {
    const { controller, getPosition } = makeController();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    controller.shake(100, 12, 'horizontal');
    controller.update(50);
    expect(getPosition().x).toBeLessThan(10);
    expect(getPosition().y).toBe(20);
    controller.update(50);
    expect(getPosition()).toEqual({ x: 10, y: 20 });
  });

  it('circle transition removes its owned mask after completion and cancellation', () => {
    const first = makeController();
    expect(first.controller.transition('circle', 100)).toBe(true);
    first.controller.update(50);
    expect(first.world.mask).not.toBeNull();
    first.controller.update(50);
    expect(first.world.mask).toBeFalsy();

    const second = makeController();
    second.controller.transition('circle', 100);
    second.controller.update(10);
    second.controller.reset();
    expect(second.world.mask).toBeFalsy();
  });

  it.each(['active', 'completed', 'reset'] as const)('destroys the private circle mask and context after %s on controller teardown', (phase) => {
    const f = makeController();
    f.controller.transition('circle', 100);
    f.controller.update(50);
    const mask = f.world.mask as Graphics;
    const context = mask.context;
    if (phase === 'completed') f.controller.update(50);
    if (phase === 'reset') f.controller.reset();
    expect(mask.destroyed).toBe(false);
    f.controller.destroy();
    expect(f.world.mask).toBeFalsy();
    expect(f.screen.children).toHaveLength(0);
    expect(mask.destroyed).toBe(true);
    expect(context.destroyed).toBe(true);
    expect(() => f.controller.destroy()).not.toThrow();
  });
});
