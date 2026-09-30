import { describe, expect, it } from 'vitest';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, type CoreEventMap } from '../src/index.js';

function setup(main = '@scene main\n@set trust = 2\n旁白：继续。\n@end') {
  const registry = new SceneRegistry();
  const scene = compileScene(main, 'main.gal', 'main'); registry.register(scene);
  const store = new VariableStore([{ name: 'trust', type: 'number', initial: 0 }]);
  const bus = new EventBus<CoreEventMap>();
  const interp = new Interpreter(store, bus, registry);
  return { interp, registry, scene, store, bus };
}

describe('explicit Interpreter debugger', () => {
  it('pauses before executing, steps one real instruction and does not record unexecuted work', () => {
    const { interp, store, bus } = setup();
    const events: CoreEventMap['runtimeTrace'][] = []; bus.on('runtimeTrace', e => events.push(e));
    interp.configureDebugger({ enabled: true, pauseOnStart: true }); interp.start('main');
    expect(store.get('trust')).toBe(0); expect(events).toEqual([]);
    expect(interp.debugSnapshot()).toMatchObject({ paused: true, reason: 'entry', current: { line: 1, op: 'instr' } });
    interp.debugStep();
    expect(store.get('trust')).toBe(0); expect(interp.debugSnapshot().current?.line).toBe(2);
    interp.debugStep();
    expect(store.get('trust')).toBe(2);
    expect(interp.debugSnapshot()).toMatchObject({ paused: true, reason: 'step', current: { line: 3, op: 'text' } });
    expect(events.filter(e => e.kind === 'instruction')).toHaveLength(2);
    interp.debugStep(); expect(interp.status).toBe('awaiting-advance');
    interp.debugStep(); expect(interp.status).toBe('ended');
  });

  it('binds breakpoints to an exact compiled scene and resumes through them once, not forever', () => {
    const { interp, scene, store } = setup();
    const bp = { sceneId: 'main', sceneHash: scene.sceneHash!, index: scene.instructions.findIndex(i => i.op === 'set') };
    expect(() => interp.configureDebugger({ enabled: true, breakpoints: [{ ...bp, sceneHash: 'old' }] })).toThrow('版本');
    interp.configureDebugger({ enabled: true, breakpoints: [bp] }); interp.start('main');
    expect(store.get('trust')).toBe(0); expect(interp.debugSnapshot().reason).toBe('breakpoint');
    interp.debugContinue(); expect(interp.status).toBe('awaiting-advance'); expect(store.get('trust')).toBe(2);
  });

  it('reports real call/return locations and preserves the original choice and timer boundaries', () => {
    const { interp, registry, store } = setup('@scene main\n@call sub\n@choice\n  继续 -> @goto done\n@label done\n@wait 50\n@end');
    registry.register(compileScene('@scene sub\n@set trust = 5\n@return', 'sub.gal', 'sub'));
    interp.configureDebugger({ enabled: true, pauseOnStart: true }); interp.start('main'); interp.debugStep(); interp.debugStep();
    expect(interp.debugSnapshot()).toMatchObject({ current: { sceneId: 'sub', line: 1 }, callStack: [{ sceneId: 'main', line: 3 }] });
    interp.debugStep();
    expect(interp.debugSnapshot()).toMatchObject({ current: { sceneId: 'sub', line: 2 }, callStack: [{ sceneId: 'main', line: 3 }] });
    interp.debugStep(); expect(store.get('trust')).toBe(5); interp.debugStep();
    expect(interp.debugSnapshot()).toMatchObject({ current: { sceneId: 'main', line: 3 }, callStack: [] });
    interp.debugStep(); expect(interp.status).toBe('awaiting-choice');
    expect(() => interp.debugStep()).toThrow('选择');
    interp.choose(0); expect(interp.debugSnapshot().paused).toBe(true);
    interp.debugContinue(); expect(interp.status).toBe('awaiting-timer');
    expect(() => interp.debugStep()).toThrow('等待');
    interp.finishWait(); expect(interp.status).toBe('ended');
  });

  it('holds a reading point without rerunning its text, exposes only copied state and disables cleanly', () => {
    const { interp, bus, store } = setup(); let texts = 0; bus.on('text', () => texts++);
    interp.configureDebugger({ enabled: true }); interp.start('main'); interp.debugPause(); interp.advance();
    expect(interp.debugSnapshot().paused).toBe(true); expect(texts).toBe(1);
    const snapshot = interp.debugSnapshot(); snapshot.variables.trust = 99; expect(store.get('trust')).toBe(2);
    interp.debugContinue(); expect(interp.status).toBe('awaiting-advance'); expect(texts).toBe(1);
    interp.debugPause(); interp.configureDebugger({ enabled: false }); interp.advance(); expect(interp.status).toBe('ended');
  });

  it('disables all gates before continuing, and reports the running version after a registry replacement', () => {
    const { interp, scene, registry, store } = setup();
    interp.configureDebugger({ enabled: true, pauseOnStart: true, breakpoints: scene.instructions.map(i => ({ sceneId: 'main', sceneHash: scene.sceneHash!, index: i.index })) });
    interp.start('main');
    registry.replace(compileScene('@scene main\n@set trust = 99\n旁白：新版本。\n@end', 'main.gal', 'main'));
    expect(interp.debugSnapshot().current?.sceneHash).toBe(scene.sceneHash);
    interp.configureDebugger({ enabled: false });
    expect(interp.status).toBe('awaiting-advance'); expect(store.get('trust')).toBe(2);
    expect(interp.debugSnapshot().paused).toBe(false);
  });

  it('resets debug pause on load and does not mutate a running session when a breakpoint request fails', () => {
    const { interp, scene, store } = setup(); interp.start('main'); const saved = interp.saveSnapshot()!;
    interp.configureDebugger({ enabled: true, pauseOnStart: true }); interp.debugPause();
    expect(() => interp.configureDebugger({ enabled: true, breakpoints: [{ sceneId: 'main', sceneHash: scene.sceneHash!, index: 1000 }] })).toThrow('不存在');
    expect(interp.debugSnapshot().paused).toBe(true); expect(store.get('trust')).toBe(2);
    interp.loadSnapshot(saved); expect(interp.debugSnapshot()).toMatchObject({ paused: true, reason: 'entry', current: { op: 'text' } });
    interp.debugContinue(); expect(interp.status).toBe('awaiting-advance');
  });

  it('keeps execution-callback reentry and host ownership guarded', () => {
    const { interp, bus } = setup(); interp.configureDebugger({ enabled: true });
    bus.on('text', () => { expect(() => interp.debugStep()).toThrow('回调'); });
    interp.start('main'); interp.pauseHost();
    expect(() => interp.debugStep()).toThrow('宿主');
    expect(() => interp.debugContinue()).toThrow('宿主');
  });

  it('re-arms a breakpoint when a real loop returns to the same instruction', () => {
    const { interp, scene, store } = setup('@scene main\n@label again\n@set trust += 1\n@goto again');
    const index = scene.instructions.findIndex(i => i.op === 'set');
    interp.configureDebugger({ enabled: true, breakpoints: [{ sceneId: 'main', sceneHash: scene.sceneHash!, index }] });
    interp.start('main'); interp.debugContinue(); expect(store.get('trust')).toBe(1); expect(interp.debugSnapshot().paused).toBe(true);
    interp.debugContinue(); expect(store.get('trust')).toBe(2); expect(interp.debugSnapshot().current?.index).toBe(index);
  });

  it('shows the actual blocking timeline, not the save-resume point after it', () => {
    const { interp } = setup('@scene main\n@timeline pulse @ blocking\n@end');
    interp.configureDebugger({ enabled: true }); interp.start('main');
    expect(interp.status).toBe('awaiting-timer');
    expect(interp.debugSnapshot()).toMatchObject({ current: { op: 'timeline', line: 2 }, next: { op: 'end', line: 3 } });
  });

  it('retains a failed text instruction after its program counter has advanced', () => {
    const { interp } = setup('@scene main\n旁白：测试。\n@end');
    interp.setTextResolver(() => { throw new Error('文本解析失败'); });
    interp.configureDebugger({ enabled: true }); expect(() => interp.start('main')).toThrow();
    expect(interp.debugSnapshot()).toMatchObject({ status: 'error', paused: false, current: { op: 'text', line: 2 } });
  });
});
