import { describe, expect, it, vi } from 'vitest';
import { CalendarRunner } from '@surdet/core';
import { CombatSolver } from '@surdet/core';
import { compileScene } from '@surdet/core';
import { EventBus } from '@surdet/core';
import { Interpreter } from '@surdet/core';
import { SceneRegistry } from '@surdet/core';
import { VariableStore } from '@surdet/core';
import { createSystemHooks } from '../src/save-hooks.js';
import { connectSystemRouter } from '../src/system-router.js';
import type { HostStateAdapter } from '../src/types.js';
import type { CoreEventMap } from '@surdet/core';

describe('createSystemHooks', () => {
  it('snapshots and restores adapters by ID', () => {
    const restored: unknown[] = [];
    const adapter: HostStateAdapter = {
      id: 'battle',
      snapshot: () => ({ turn: 2 }),
      validate: vi.fn(),
      restore: (value) => restored.push(value),
    };
    const hooks = createSystemHooks([adapter]);
    expect(hooks.snapshot?.()).toEqual({ battle: { turn: 2 } });
    hooks.restore?.({ battle: { turn: 4 } } as never);
    expect(adapter.validate).toHaveBeenCalledWith({ turn: 4 });
    expect(restored).toEqual([{ turn: 4 }]);
  });

  it('validates every adapter before mutating any adapter', () => {
    const restored: string[] = [];
    const first: HostStateAdapter = {
      id: 'first',
      snapshot: () => 1,
      validate: vi.fn(),
      restore: () => restored.push('first'),
    };
    const second: HostStateAdapter = {
      id: 'second',
      snapshot: () => 2,
      validate: vi.fn(() => { throw new Error('invalid second'); }),
      restore: () => restored.push('second'),
    };
    const hooks = createSystemHooks([first, second]);
    expect(() => hooks.restore?.({ first: 10, second: 20 } as never)).toThrow('invalid second');
    expect(restored).toEqual([]);
  });

  it('rejects duplicate adapter IDs', () => {
    const adapter = { id: 'same', snapshot: () => null, validate: () => undefined, restore: () => undefined };
    expect(() => createSystemHooks([adapter, adapter])).toThrow(/重复/);
  });

  it('rejects an incompatible combat snapshot before changing calendar state', () => {
    const store = new VariableStore([]);
    const calendar: CalendarRunner = new CalendarRunner({
      nodes: [],
      maxAp: 3,
      maxTurns: 8,
      dateTemplate: 'T{turn}',
    }, store);
    const combat: CombatSolver = new CombatSolver({
      teams: ['allies', 'enemies'],
      units: [{ id: 'unit', name: 'Unit', hp: 10, atk: 2, def: 1, range: 1, move: 1, kind: 'human' }],
      skills: [],
      elementChain: {},
      winCondition: 'survive_turns',
      maxTurns: 8,
    });
    combat.start({ allies: ['unit'], enemies: ['unit'] });
    const calendarBefore = calendar.snapshot();
    const combatBefore = combat.snapshot();
    const incoming = {
      calendar: { turn: 2, ap: 1, visited: [] },
      combat: {
        ...combatBefore,
        units: combatBefore.units.map((unit) => ({ ...unit, team: 'ghost' })),
      },
    };
    const hooks = createSystemHooks([
      {
        id: 'calendar',
        snapshot: () => calendar.snapshot(),
        validate: (value: unknown): void => { calendar.validateSnapshot(value); },
        restore: (value: unknown): void => { calendar.validateSnapshot(value); calendar.restore(value); },
      },
      {
        id: 'combat',
        snapshot: () => combat.snapshot(),
        validate: (value: unknown): void => { combat.validateSnapshot(value); },
        restore: (value: unknown): void => { combat.validateSnapshot(value); combat.restore(value); },
      },
    ]);

    expect(() => hooks.restore?.(incoming as never)).toThrow(/非法阵营|team/);
    expect(calendar.snapshot()).toEqual(calendarBefore);
    expect(combat.snapshot()).toEqual(combatBefore);
  });

  it('leaves variables and every runtime state unchanged when system prevalidation fails', () => {
    const store = new VariableStore([{ name: 'trust', type: 'number', initial: 0 }]);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const calendar: CalendarRunner = new CalendarRunner({
      nodes: [],
      maxAp: 3,
      maxTurns: 8,
      dateTemplate: 'T{turn}',
    }, store);
    const combat: CombatSolver = new CombatSolver({
      teams: ['allies', 'enemies'],
      units: [
        { id: 'ally', name: 'Ally', hp: 10, atk: 2, def: 1, range: 1, move: 1, kind: 'human' },
        { id: 'enemy', name: 'Enemy', hp: 10, atk: 2, def: 1, range: 1, move: 1, kind: 'human' },
      ],
      skills: [],
      elementChain: {},
      winCondition: 'all_down',
      maxTurns: 8,
    });
    combat.start({ allies: ['ally'], enemies: ['enemy'] });
    const hooks = createSystemHooks([
      { id: 'calendar', snapshot: () => calendar.snapshot(), validate: (value) => calendar.validateSnapshot(value), restore: (value) => { calendar.validateSnapshot(value); calendar.restore(value); } },
      { id: 'combat', snapshot: () => combat.snapshot(), validate: (value) => combat.validateSnapshot(value), restore: (value) => { combat.validateSnapshot(value); combat.restore(value); } },
    ]);
    const interpreter = new Interpreter(store, bus, registry, undefined, undefined, hooks);
    registry.register(compileScene('凛：甲。\n凛：乙。', 's.gal', 's1'));

    interpreter.start('s1');
    store.set('trust', 5);
    const before = interpreter.saveSnapshot()!;
    const incoming = structuredClone(before);
    incoming.variables.trust = 999;
    incoming.systems = {
      ...incoming.systems,
      calendar: { turn: 2, ap: 1, visited: [] },
      combat: {
        ...incoming.systems!.combat!,
        units: incoming.systems!.combat!.units.map((unit) => ({ ...unit, team: 'ghost' })),
      },
    };

    expect(() => interpreter.loadSnapshot(incoming)).toThrow(/非法阵营|team/);
    expect(store.snapshot()).toEqual(before.variables);
    expect(calendar.snapshot()).toEqual(before.systems!.calendar);
    expect(combat.snapshot()).toEqual(before.systems!.combat);
    expect(interpreter.readTracker.snapshot()).toEqual(before.readSet);
    expect(interpreter.gallery.snapshot()).toEqual(before.gallery);
    expect(interpreter.status).toBe('awaiting-advance');
    expect(interpreter.saveSnapshot()?.position).toEqual(before.position);
  });

  it('routes a generic system payload without owning its rules', async () => {
    let handler: ((payload: { type: string; args: string[] }) => void) | undefined;
    const routeSystem = vi.fn(async () => true);
    const unsubscribe = connectSystemRouter({
      on: (_event: string, callback: (payload: { type: string; args: string[] }) => void) => {
        handler = callback;
        return vi.fn();
      },
    } as never, { routeSystem });

    handler?.({ type: 'custom-system', args: ['payload'] });
    await Promise.resolve();
    expect(routeSystem).toHaveBeenCalledWith('custom-system', { type: 'custom-system', args: ['payload'] });
    unsubscribe();
  });
});
