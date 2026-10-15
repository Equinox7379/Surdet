import { describe, expect, it } from 'vitest';
import { CalendarRunner, compileScene, EventBus, EventScheduler, Interpreter, SceneRegistry, VariableStore, type CoreEventMap } from '@surdet/core';
import { createDefaultHost, connectSystemRouter } from '@surdet/host';
import { createSystemAdapters } from '../../shared/player/system-adapters.js';

describe('scheduled scene continuation through the real Host', () => {
  it.each([true, false])('retains event effects, caller return and one dispatch per boundary (once=%s)', once => {
    const store = new VariableStore([{ name: 'reward', type: 'number', initial: 0 }]);
    const calendar = new CalendarRunner({ nodes: [], maxAp: 3, maxTurns: 10, dateTemplate: '{turn}' }, store);
    const scheduler = new EventScheduler([
      { id: 'first', characterId: 'sys', when: 'true', once, scene: 'event', effects: { reward: 2 } },
      { id: 'second', characterId: 'sys', when: 'true', once: true, scene: 'event' },
    ], store);
    const registry = new SceneRegistry();
    registry.register(compileScene('@call calendar\n父剧情\n@end', 'main.gal', 'main'));
    registry.register(compileScene('@calendar\n日程结束\n@return', 'calendar.gal', 'calendar'));
    registry.register(compileScene('@set reward += 7\n@unlock_cg prize\n事件演出\n@end', 'event.gal', 'event'));
    const bus = new EventBus<CoreEventMap>();
    const interpreter = new Interpreter(store, bus, registry, undefined, undefined, {
      snapshot: () => ({ calendar: calendar.snapshot(), eventScheduler: scheduler.snapshot() }),
      restore: saved => { if (saved.calendar) calendar.restore(saved.calendar); if (saved.eventScheduler) scheduler.restore(saved.eventScheduler); },
    });
    let maps = 0, endTurn!: () => void;
    let resume: (() => void) | null = null;
    const texts: string[] = [], errors: unknown[] = [];
    const renderer = {
      showMap: (_view: unknown, _enter: unknown, end: () => void) => { maps++; endTurn = end; }, hideMap() {},
      showBaseCommands() {}, hideBaseCommands() {}, showBattle() {}, hideBattle() {}, showShop() {}, hideShop() {},
    };
    const host = createDefaultHost({ interpreter, renderer, adapters: createSystemAdapters({
      interpreter, store, registry, renderer, calendar, scheduler,
      onScheduledSceneEnd: next => { resume = next; },
    }), onStateReset: () => { resume = null; }, onError: error => errors.push(error) });
    const disconnect = connectSystemRouter(bus, host, error => errors.push(error));
    bus.on('stateReset', () => host.reset());
    bus.on('text', p => texts.push(p.value));
    const finishEvent = (): void => {
      interpreter.advance();
      expect(interpreter.status).toBe('ended');
      const continuation = resume;
      expect(continuation).toBeTypeOf('function');
      resume = null;
      continuation!();
    };
    try {
      interpreter.start('main');
      expect(texts).toEqual(['事件演出']);
      expect(store.getNumber('reward')).toBe(9);
      finishEvent();
      expect(maps).toBe(1);
      expect(interpreter.status).toBe('paused');
      expect(store.getNumber('reward')).toBe(9);
      expect(interpreter.gallery.snapshot().cgs).toEqual(['prize']);
      expect(scheduler.isFired('second')).toBe(false);
      endTurn();
      expect(texts).toEqual(['事件演出', '事件演出']);
      finishEvent();
      expect(texts.at(-1)).toBe('日程结束');
      expect(store.getNumber('reward')).toBe(once ? 16 : 18);
      expect(calendar.turn).toBe(2);
      interpreter.advance();
      expect(texts.at(-1)).toBe('父剧情');
      expect(errors).toEqual([]);
    } finally { disconnect(); host.dispose(); }
  });
});
