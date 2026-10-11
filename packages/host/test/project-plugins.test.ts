import { describe, expect, it, vi } from 'vitest';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, readProjectPlugins, SaveManager, MemoryStorage, type CoreEventMap } from '@surdet/core';
import { ProjectPluginHost, type ProjectPluginDefinition, type ProjectPluginContext } from '../src/project-plugins.js';
import { createDefaultHost } from '../src/create-host.js';
import { RendererPluginHost } from '@surdet/renderer';

const declarations = readProjectPlugins({ plugins: [{ id: 'counter', entry: 'plugins/counter.ts', apiVersion: 1, stateVersion: 1,
  instructions: [{ name: 'count', blocking: false, parameters: [{ name: 'amount', type: 'number' }] }, { name: 'panel', blocking: true, parameters: [] }] }] });
function definition(): ProjectPluginDefinition {
  return { apiVersion: 1, state: { initial: 0, validate: value => { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('bad state'); } },
    instructions: { count: (values, context) => { context.setState((context.getState() as number) + (values.amount as number)); context.setVariable('n', context.getState() as number); }, panel: () => {} } };
}
async function runtime(def = definition(), source = '@count 2\n第一句。\n@panel\n第二句。', trustedIds = ['counter']) {
  const plugins = await ProjectPluginHost.load(declarations, { trustedIds, loadEntry: async () => ({ default: () => def }) });
  const store = new VariableStore([{ name: 'n', type: 'number', initial: 0 }]), bus = new EventBus<CoreEventMap>(), registry = new SceneRegistry();
  registry.register(compileScene(source, 'intro.gal', 'intro', ['count', 'panel']));
  const interpreter = new Interpreter(store, bus, registry);
  const host = createDefaultHost({ interpreter, renderer: {} as never, stage: {}, adapters: plugins.adapters() });
  plugins.bind(interpreter, store, host); bus.on('stateReset', () => host.reset());
  return { plugins, interpreter, store, host, bus };
}
describe('trusted project plugin host', () => {
  it('does not import untrusted code, and refuses missing entries or incompatible modules', async () => {
    const loadEntry = vi.fn(); const plugins = await ProjectPluginHost.load(declarations, { trustedIds: [], loadEntry });
    expect(loadEntry).not.toHaveBeenCalled(); plugins.dispose();
    await expect(ProjectPluginHost.load(declarations, { trustedIds: ['counter'], loadEntry: async () => { throw new Error('missing'); } })).rejects.toThrow('PLUGIN_MISSING');
    await expect(ProjectPluginHost.load(declarations, { trustedIds: ['counter'], loadEntry: async () => ({ default: () => ({ ...definition(), apiVersion: 2 } as never) }) })).rejects.toThrow('PLUGIN_API');
  });
  it('runs a stateful interaction and restores its state through SaveManager JSON roundtrip', async () => {
    const { plugins, interpreter, store } = await runtime(); interpreter.start('intro');
    const storage = new MemoryStorage(), saves = new SaveManager(storage); await saves.save('1', interpreter.saveSnapshot()!);
    store.set('n', 99); plugins.resetState(); interpreter.loadSnapshot(await saves.load('1'));
    expect(store.get('n')).toBe(2); expect(interpreter.saveSnapshot()!.plugins).toEqual({ counter: { version: 1, value: 2 } }); plugins.dispose();
  });
  it('keeps the live runtime and good slot unchanged after codec, version or missing-plugin rejection', async () => {
    const def = definition(); def.state!.restore = () => { throw new Error('restore broken'); };
    const { plugins, interpreter, store } = await runtime(def); interpreter.start('intro');
    const before = interpreter.saveSnapshot()!, saves = new SaveManager(new MemoryStorage()); await saves.save('good', before);
    store.set('n', 8); const position = interpreter.position;
    expect(() => interpreter.loadSnapshot(before)).toThrow('restore broken');
    const incompatible = structuredClone(before); incompatible.plugins!.counter.version = 2;
    expect(() => interpreter.loadSnapshot(incompatible)).toThrow('PLUGIN_VERSION');
    const missing = structuredClone(before); missing.plugins!.other = { version: 1, value: 0 };
    expect(() => interpreter.loadSnapshot(missing)).toThrow('PLUGIN_REQUIRED');
    expect(store.get('n')).toBe(8); expect(interpreter.position).toEqual(position); expect((await saves.load('good')).plugins).toEqual(before.plugins); plugins.dispose();
  });
  it('uses the real system router for a panel, rejects saves while it is open, and resumes once', async () => {
    let complete!: () => void; const def = definition(); def.instructions.panel = () => new Promise<void>(resolve => { complete = resolve; });
    const { plugins, interpreter } = await runtime(def); interpreter.start('intro'); interpreter.advance();
    expect(interpreter.status).toBe('paused'); expect(() => interpreter.saveSnapshot()).toThrow('PLUGIN_BUSY');
    complete(); await Promise.resolve(); await Promise.resolve(); expect(interpreter.status).toBe('awaiting-advance');
    expect(interpreter.position?.pc).toBe(4); plugins.dispose();
  });
  it('stops on panel failure instead of resuming or allowing a save', async () => {
    const def = definition(); def.instructions.panel = async () => { throw new Error('panel broken'); };
    const { plugins, interpreter } = await runtime(def); interpreter.start('intro'); interpreter.advance(); await Promise.resolve(); await Promise.resolve();
    expect(interpreter.status).toBe('error'); expect(interpreter.saveSnapshot()).toBeNull(); interpreter.resumeHost(); expect(interpreter.status).toBe('error'); plugins.dispose();
  });
  it('releases the finished panel before the next instruction can autosave', async () => {
    const { plugins, interpreter, bus } = await runtime(definition(), '@panel\n@autosave\n之后。');
    const saved: unknown[] = []; bus.on('autosave', value => saved.push(value));
    interpreter.start('intro'); await Promise.resolve(); await Promise.resolve();
    expect(interpreter.status).toBe('awaiting-advance'); expect(saved).toHaveLength(1); plugins.dispose();
  });
  it('invalidates late writes and completion after load, reset and disposal', async () => {
    let context!: ProjectPluginContext, complete!: () => void; const dispose = vi.fn(), def = definition(); def.dispose = dispose;
    def.instructions.panel = (_values, input) => { context = input; return new Promise<void>(resolve => { complete = resolve; }); };
    const { plugins, interpreter, store, host } = await runtime(def); interpreter.start('intro'); const saved = interpreter.saveSnapshot()!; interpreter.advance();
    interpreter.loadSnapshot(saved); expect(context.signal.aborted).toBe(true);
    expect(() => context.setVariable('n', 90)).toThrow('PLUGIN_INACTIVE'); complete(); await Promise.resolve(); expect(store.get('n')).toBe(2);
    interpreter.advance(); plugins.dispose(); host.dispose(); complete(); await Promise.resolve();
    expect(context.signal.aborted).toBe(true); expect(() => context.setState(99)).toThrow('PLUGIN_INACTIVE'); plugins.dispose(); expect(dispose).toHaveBeenCalledOnce();
  });
  it('blocks instruction and save when permission is absent', async () => {
    const { plugins, interpreter } = await runtime(definition(), undefined, []);
    expect(() => interpreter.start('intro')).toThrow('PLUGIN_REQUIRED'); expect(interpreter.saveSnapshot()).toBeNull(); plugins.dispose();
  });
  it('stops asynchronous nonblocking code and rejects malformed state rather than hiding it in JSON', async () => {
    const def = definition(); def.instructions.count = async () => {};
    const { plugins, interpreter } = await runtime(def);
    expect(() => interpreter.start('intro')).toThrow(/非阻塞指令必须同步/); expect(interpreter.saveSnapshot()).toBeNull(); plugins.dispose();
    const invalid = definition(); invalid.state!.initial = new Map();
    await expect(ProjectPluginHost.load(declarations, { trustedIds: ['counter'], loadEntry: async () => ({ default: () => invalid }) })).rejects.toThrow(/JSON/);
  });
  it('reports a throwing frame callback and stops the story without losing its disposal hook', async () => {
    const failure = vi.fn(), disposed = vi.fn(), def = definition();
    def.rendererPlugin = { id: 'counter', onFrame() { throw new Error('frame broken'); }, onDispose: disposed };
    const plugins = await ProjectPluginHost.load(declarations, { trustedIds: ['counter'], onFailure: failure, loadEntry: async () => ({ default: () => def }) });
    const interpreter = new Interpreter(new VariableStore([]), new EventBus(), new SceneRegistry()), frames = new RendererPluginHost();
    const host = createDefaultHost({ interpreter, renderer: {} as never, stage: {}, adapters: plugins.adapters() });
    plugins.bind(interpreter, new VariableStore([]), host, undefined, frames); frames.attach({}); frames.update(16); frames.update(16);
    expect(interpreter.status).toBe('error'); expect(plugins.failure).toContain('frame broken'); expect(failure).toHaveBeenCalledOnce();
    expect(interpreter.saveSnapshot()).toBeNull(); plugins.dispose(); frames.dispose(); expect(disposed).toHaveBeenCalledOnce();
  });
});
