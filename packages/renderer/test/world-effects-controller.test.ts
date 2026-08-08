import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
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
});
