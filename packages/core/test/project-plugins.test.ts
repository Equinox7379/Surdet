import { describe, expect, it } from 'vitest';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, readProjectPlugins,
  validatePluginInstructions, type CoreEventMap } from '../src/index.js';

const config = { plugins: [{ id: 'counter', entry: 'plugins/counter.ts', apiVersion: 1, stateVersion: 1,
  instructions: [{ name: 'count', blocking: false, parameters: [{ name: 'amount', type: 'number' }] }] }] };
const plugins = readProjectPlugins(config);
function runtime(source = '@count 2\n之后。') {
  const store = new VariableStore([{ name: 'n', type: 'number', initial: 0 }]);
  const bus = new EventBus<CoreEventMap>(), registry = new SceneRegistry();
  registry.register(compileScene(source, 'intro.gal', 'intro', ['count']));
  const interpreter = new Interpreter(store, bus, registry);
  return { interpreter, store, bus };
}

describe('project plugins', () => {
  it('does not silently continue past a declared but untrusted instruction or create a save', () => {
    const { interpreter, bus } = runtime();
    const texts: string[] = []; bus.on('text', event => texts.push(event.value));
    interpreter.setProjectPlugins(plugins);
    expect(() => interpreter.start('intro')).toThrow(/PLUGIN_REQUIRED.*counter/);
    expect(texts).toEqual([]); expect(interpreter.status).toBe('error');
    expect(interpreter.saveSnapshot()).toBeNull();
  });
  it('prepares plugin restoration before variables change and commits prepared state once', () => {
    const { interpreter, store } = runtime('正文。');
    let count = 3, invalid = false;
    interpreter.setProjectPlugins(plugins, {
      execute: () => {}, snapshot: () => ({ counter: { version: 1, value: count } }),
      prepareRestore: state => { if (invalid) throw new Error('restore failed'); const next = state.counter.value as number; return () => { count = next; }; },
    });
    interpreter.start('intro'); const saved = interpreter.saveSnapshot()!;
    count = 9; store.set('n', 7); invalid = true;
    expect(() => interpreter.loadSnapshot(saved)).toThrow('restore failed');
    expect(count).toBe(9); expect(store.get('n')).toBe(7); expect(interpreter.status).toBe('awaiting-advance');
    invalid = false; interpreter.loadSnapshot(saved); expect(count).toBe(3); expect(store.get('n')).toBe(0);
  });
  it('refuses a plugin save in a runtime without that extension before changing variables', () => {
    const { interpreter, store } = runtime('正文。'); interpreter.start('intro');
    const saved = interpreter.saveSnapshot()!; saved.plugins = { counter: { version: 1, value: 2 } };
    store.set('n', 7); expect(() => interpreter.loadSnapshot(saved)).toThrow(/PLUGIN_REQUIRED/); expect(store.get('n')).toBe(7);
  });
  it('validates declared parameter semantics including quoted values and modifier ownership', () => {
    const issues: Parameters<typeof validatePluginInstructions>[2] = [];
    validatePluginInstructions(compileScene('@count "2"\n@count nope\n@count 1 @extra=true', 's.gal', 's', ['count']), plugins, issues);
    expect(issues.map(issue => issue.line)).toEqual([2, 3]); expect(issues.every(issue => issue.code === 'PLUGIN_ARGUMENT')).toBe(true);
  });
  it.each(['../bad.ts', 'https://example.test/a.js', 'plugins/a.ts?x', 'plugins/../a.js'])('rejects entry %s', entry => {
    expect(() => readProjectPlugins({ plugins: [{ ...config.plugins[0], entry }] })).toThrow(/entry/);
  });
  it('rejects API versions, duplicate instructions, builtin takeover and data claiming trust', () => {
    expect(() => readProjectPlugins({ plugins: [{ ...config.plugins[0], apiVersion: 2 }] })).toThrow(/API/);
    expect(() => readProjectPlugins({ plugins: [config.plugins[0], { ...config.plugins[0], id: 'other', entry: 'plugins/other.ts' }] })).toThrow(/重复/);
    expect(() => readProjectPlugins({ plugins: [{ ...config.plugins[0], trusted: true }] })).toThrow(/未知字段/);
    expect(() => readProjectPlugins({ plugins: [{ ...config.plugins[0], instructions: [{ name: 'bg', blocking: false, parameters: [] }] }] })).toThrow(/内置/);
  });
});
