import { describe, expect, it, vi } from 'vitest';
import { TransitionRegistry, type StageTransition } from '../src/transition-registry.js';

function transition(name: string, doneOnUpdate = true): StageTransition & { cancel: ReturnType<typeof vi.fn> } {
  return {
    name,
    start: vi.fn(),
    update: vi.fn(() => doneOnUpdate),
    cancel: vi.fn(),
  };
}

describe('TransitionRegistry', () => {
  it('validates IDs, rejects duplicates and returns null for unknown names', () => {
    const registry = new TransitionRegistry();
    const fade = transition('fade');
    registry.register(fade);
    expect(registry.get('fade')).toBe(fade);
    expect(registry.get('missing')).toBeNull();
    expect(() => registry.register(transition('fade'))).toThrow(/重复/);
    expect(() => registry.register(transition(''))).toThrow(/名称/);
  });

  it('starts known transitions and returns false for unknown names', () => {
    const registry = new TransitionRegistry();
    const fade = transition('fade');
    registry.register(fade);
    expect(registry.start('missing', 100)).toBe(false);
    expect(registry.start('fade', 100)).toBe(true);
    expect(fade.start).toHaveBeenCalledWith(100);
  });

  it('cancels exactly one active transition and clears on completion', () => {
    const registry = new TransitionRegistry();
    const fade = transition('fade');
    const slide = transition('slide-left');
    registry.register(fade);
    registry.register(slide);
    expect(registry.update(16)).toBe(false);
    registry.start('fade', 100);
    registry.start('slide-left', 100);
    expect(fade.cancel).toHaveBeenCalledTimes(1);
    registry.cancelActive();
    expect(slide.cancel).toHaveBeenCalledTimes(1);
    expect(registry.update(16)).toBe(false);

    registry.start('fade', 100);
    expect(registry.update(100)).toBe(false);
    expect(registry.update(100)).toBe(false);
  });
});
