import { readFileSync } from 'node:fs';
import { ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { CalendarRunner, compileScene, EventBus, EventScheduler, Interpreter, SceneRegistry, VariableStore, type CoreEventMap, type SaveSnapshot } from '@surdet/core';

describe('actual preview calendar handler', () => {
  it.each([true, false])('plays a registered turn-start event before showing the map (once=%s)', once => {
    const store = new VariableStore([{ name: 'trust', type: 'number', initial: 0 }]);
    const calendar = new CalendarRunner({ nodes: [], maxAp: 3, maxTurns: 10, dateTemplate: '{turn}' }, store);
    const scheduler = new EventScheduler([{ id: 'start-event', characterId: 'sys', when: 'trust == 0', scene: 'event', effects: { trust: 2 }, once }], store);
    const registry = new SceneRegistry();
    registry.register(compileScene('@calendar\n回到正文\n@end', 'start.gal', 'start'));
    registry.register(compileScene('回合开始演出\n@end', 'event.gal', 'event'));
    const bus = new EventBus<CoreEventMap>();
    const interp = new Interpreter(store, bus, registry, undefined, undefined, {
      snapshot: () => ({ calendar: calendar.snapshot(), eventScheduler: scheduler.snapshot() }),
      restore: snap => { if (snap.calendar) calendar.restore(snap.calendar); if (snap.eventScheduler) scheduler.restore(snap.eventScheduler); },
    });
    const texts: string[] = []; bus.on('text', event => texts.push(event.value));
    let endTurn: (() => void) | undefined;
    const system = { showMap: vi.fn((_view, _enter, end) => { endTurn = end; }), hideMap: vi.fn() };
    const source = readFileSync(new URL('../src/preview.ts', import.meta.url), 'utf8');
    const start = source.indexOf("  bus.on('system', (p) => {");
    const end = source.indexOf('  // @exp：', start);
    if (start < 0 || end < 0) throw new Error('preview system handler not found');
    const body = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
    const getResume = new Function('bus', 'calendar', 'interp', 'store', 'scheduler', 'registry', 'system', 'buildMapView',
      'let turnResumeSnap = null;\n' + body + '\nreturn () => turnResumeSnap;')(bus, calendar, interp, store, scheduler, registry, system, (value: unknown) => value) as () => SaveSnapshot | null;
    interp.start('start');
    expect(texts).toEqual(['回合开始演出']);
    expect(store.getNumber('trust')).toBe(2);
    expect(system.showMap).not.toHaveBeenCalled();
    expect(getResume()).not.toBeNull();
    interp.advance(); // the scheduled scene ends; restore the production handler's real continuation
    interp.loadSnapshot(getResume()!);
    expect(system.showMap).toHaveBeenCalledOnce();
    expect(store.getNumber('trust')).toBe(2);
    endTurn!();
    expect(texts).toEqual(['回合开始演出', '回到正文']);
  });
});
