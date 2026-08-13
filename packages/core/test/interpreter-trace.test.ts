import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { Interpreter, type CoreEventMap } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { VariableStore } from '../src/state/variable-store.js';

describe('Interpreter runtimeTrace', () => {
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
