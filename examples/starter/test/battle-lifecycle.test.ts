import { readFileSync } from 'node:fs';
import { CombatSolver, type CombatConfig } from '@surdet/core';
import type { BattleHandlers } from '@surdet/renderer';
import { describe, expect, it, vi } from 'vitest';
import { createSystemAdapters, type ProjectSystemAdapterOptions } from '../../shared/player/system-adapters.js';

function fixture() {
  const config = JSON.parse(readFileSync(new URL('../content/config/combat.json', import.meta.url), 'utf8')) as CombatConfig;
  const combat = new CombatSolver(config, () => 0.5);
  const pending: Array<() => void> = [];
  let handlers: BattleHandlers;
  let rendererDisposed = false;
  const renderer = {
    showBattle: vi.fn((_view, nextHandlers: BattleHandlers) => {
      if (rendererDisposed) throw new Error('Renderer runtime has already been disposed');
      handlers = nextHandlers;
    }),
    hideBattle: vi.fn(),
  };
  // Only the battle adapter is enabled; unrelated optional systems are absent.
  const adapter = createSystemAdapters({
    combat, combatConfig: config, renderer,
    timer: (callback: () => void) => pending.push(callback),
  } as unknown as ProjectSystemAdapterOptions).find((candidate) => candidate.id === 'battle')!;
  const context = { pause: vi.fn(), resume: vi.fn(), fail: vi.fn() };
  const openAndPass = () => {
    adapter.open(undefined, context);
    handlers.onPass();
    expect(pending.length).toBeGreaterThan(0);
  };
  return { adapter, context, renderer, pending, combat, openAndPass, currentHandlers: () => handlers, disposeRenderer: () => { rendererDisposed = true; } };
}

describe('Shared battle delayed actions with the supported Starter combat config', () => {
  it('rejects player actions while the enemy turn is pending', () => {
    const f = fixture();
    f.openAndPass();
    const before = f.combat.snapshot();
    const handlers = f.currentHandlers();
    handlers.onMove?.(1);
    handlers.onPass();
    expect(f.combat.snapshot()).toEqual(before);
    expect(f.pending).toHaveLength(1);
  });

  it('still executes the active enemy turn', () => {
    const f = fixture();
    f.openAndPass();
    const before = f.renderer.showBattle.mock.calls.length;
    f.pending.shift()!();
    expect(f.renderer.showBattle.mock.calls.length).toBeGreaterThan(before);
    expect(f.context.fail).not.toHaveBeenCalled();
  });

  it.each(['reset', 'dispose'] as const)('%s invalidates callbacks before Renderer teardown', (operation) => {
    const f = fixture();
    f.openAndPass();
    const before = f.renderer.showBattle.mock.calls.length;
    f.adapter[operation]?.();
    f.disposeRenderer();
    f.pending.shift()!();
    expect(f.renderer.showBattle).toHaveBeenCalledTimes(before);
    expect(f.context.fail).not.toHaveBeenCalled();
  });

  it('does not let an old callback act on a newly opened battle', () => {
    const f = fixture();
    f.openAndPass();
    const oldTurn = f.pending.shift()!;
    f.adapter.reset?.();
    f.openAndPass();
    const before = f.combat.snapshot();
    const renders = f.renderer.showBattle.mock.calls.length;
    oldTurn();
    expect(f.combat.snapshot()).toEqual(before);
    expect(f.renderer.showBattle).toHaveBeenCalledTimes(renders);
    f.pending.shift()!();
    expect(f.renderer.showBattle.mock.calls.length).toBeGreaterThan(renders);
    expect(f.context.fail).not.toHaveBeenCalled();
  });
});
