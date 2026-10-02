import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { WorldEffectsController } from '../src/world-effects-controller.js';

function makeController() {
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
  });
  return { controller, world, screen, getPosition: () => position };
}

describe('WorldEffectsController', () => {
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
