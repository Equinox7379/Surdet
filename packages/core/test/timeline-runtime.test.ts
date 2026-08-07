import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { Interpreter, type CoreEventMap } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { VariableStore } from '../src/state/variable-store.js';
import { TimelineRegistry } from '../src/timeline.js';

const definition = {
  version: 1 as const,
  id: 'intro',
  durationMs: 900,
  tracks: [{
    kind: 'background' as const,
    cues: [{ atMs: 0, durationMs: 400, easing: 'outCubic' as const, action: 'set', key: 'hall' }],
  }],
};

function makeRuntime(source: string, options: { presentation?: boolean } = {}) {
  const bus = new EventBus<CoreEventMap>();
  const scenes = new SceneRegistry();
  scenes.register(compileScene(source, 'timeline.gal', 'demo'));
  const timelines = new TimelineRegistry();
  timelines.register(definition);
  const snapshots: unknown[] = [];
  const interp = new Interpreter(
    new VariableStore([]),
    bus,
    scenes,
    undefined,
    undefined,
    {},
    undefined,
    null,
    timelines,
    options.presentation ? {
      snapshot: () => ({ active: 'intro', cursorMs: 120, particleKind: null }),
      restore: (payload) => snapshots.push(payload),
    } : null,
  );
  return { bus, interp, snapshots };
}

describe('timeline runtime lifecycle', () => {
  it('compiles the blocking modifier as a typed instruction', () => {
    const scene = compileScene('@timeline intro @ blocking\n凛：到达。', 'timeline.gal', 'demo');
    expect(scene.instructions[0]).toMatchObject({ op: 'timeline', id: 'intro', blocking: true });
    expect(scene.diagnostics).toEqual([]);
  });

  it('runs non-blocking timelines alongside the next text', () => {
    const { bus, interp } = makeRuntime('@timeline intro\n凛：到达。');
    const events: string[] = [];
    bus.on('timeline', (p) => events.push(`timeline:${p.id}`));
    bus.on('text', () => events.push('text'));
    interp.start('demo');
    expect(events).toEqual(['timeline:intro', 'text']);
    expect(interp.status).toBe('awaiting-advance');
  });

  it('blocks until the host finishes the timeline', () => {
    const { bus, interp } = makeRuntime('@timeline intro @ blocking\n凛：到达。');
    const events: number[] = [];
    bus.on('timeline', (p) => events.push(p.durationMs ?? -1));
    interp.start('demo');
    expect(events).toEqual([900]);
    expect(interp.status).toBe('awaiting-timer');
    interp.finishWait();
    expect(interp.status).toBe('awaiting-advance');
  });

  it('saves the next instruction when presentation state can restore the blocked timeline', () => {
    const { interp, snapshots } = makeRuntime('@timeline intro @ blocking\n凛：到达。', { presentation: true });
    interp.start('demo');
    const snap = interp.saveSnapshot()!;
    expect(snap.position?.pc).toBe(1);
    expect(snap.presentation).toEqual({ version: 1, payload: { active: 'intro', cursorMs: 120, particleKind: null } });
    interp.loadSnapshot(snap);
    expect(snapshots).toEqual([{ active: 'intro', cursorMs: 120, particleKind: null }]);
    expect(interp.status).toBe('awaiting-advance');
  });

  it('fails at runtime when a supplied catalog does not contain the timeline', () => {
    const bus = new EventBus<CoreEventMap>();
    const scenes = new SceneRegistry();
    scenes.register(compileScene('@timeline missing', 'timeline.gal', 'demo'));
    const interp = new Interpreter(new VariableStore([]), bus, scenes, undefined, undefined, {}, undefined, null, new TimelineRegistry());
    expect(() => interp.start('demo')).toThrow(/时间轴 'missing' 未注册/);
  });
});
