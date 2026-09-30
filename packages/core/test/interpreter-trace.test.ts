import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { Interpreter, type CoreEventMap } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { VariableStore } from '../src/state/variable-store.js';

describe('Interpreter runtimeTrace', () => {
  it('observes conditional options using original indices without changing choice or variable semantics', () => {
    const store = new VariableStore([{ name: 'trust', type: 'number', initial: 0 }]);
    const bus = new EventBus<CoreEventMap>(), registry = new SceneRegistry();
    const interpreter = new Interpreter(store, bus, registry);
    registry.register(compileScene('@scene start\n@choice\n  隐藏 [if:trust > 5] -> @end\n  可选 [if:trust == 0] -> @end\n  普通 -> @end\n', 'start.gal', 'start'));
    const events: CoreEventMap['runtimeTrace'][] = [];
    let visible: number[] = [];
    bus.on('runtimeTrace', event => events.push(event));
    bus.on('choice', event => { visible = event.options.map(option => option.index); });
    interpreter.start('start');
    expect(visible).toEqual([1, 2]);
    expect(events.filter(event => event.condition).map(event => event.condition)).toEqual([
      { expression: 'trust > 5', result: false, optionIndex: 0 },
      { expression: 'trust == 0', result: true, optionIndex: 1 },
    ]);
    expect(events.filter(event => event.condition).every(event => event.source.line === 2)).toBe(true);
    expect(store.snapshot()).toEqual({ trust: 0 });
    interpreter.choose(1);
    expect(events.find(event => event.choice)?.choice?.optionIndex).toBe(1);
    expect(interpreter.status).toBe('ended');
  });

  it('emits source-located state, choice and control-flow causality', () => {
    const store = new VariableStore([{ name: 'trust', type: 'number', initial: 0 }]);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const interpreter = new Interpreter(store, bus, registry);
    registry.register(compileScene([
      '@scene prologue',
      '@set trust = 1',
      '@choice',
      '  继续 -> @goto trust',
      '@label trust',
      '凛：继续。',
      '@end',
    ].join('\n'), 'prologue.gal', 'prologue'));

    const events: CoreEventMap['runtimeTrace'][] = [];
    bus.on('runtimeTrace', (event) => events.push(event));
    bus.on('choice', (choice) => interpreter.choose(choice.options[0]!.index));

    interpreter.start('prologue');

    expect(events).toContainEqual(expect.objectContaining({
      kind: 'state',
      source: expect.objectContaining({ sceneId: 'prologue', op: 'set' }),
      stateDelta: [{ variable: 'trust', before: 0, after: 1 }],
    }));
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'control-flow',
      controlFlow: expect.objectContaining({ to: 'label:prologue.trust' }),
    }));
    expect(events.some((event) => event.kind === 'choice')).toBe(true);
  });
});
