import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';

describe('SceneRegistry scene ID contract', () => {
  it('rejects a dotted scene ID before registration', () => {
    const registry = new SceneRegistry();
    const scene = compileScene('@scene my.scene\n凛：正文。', 'content/scenario/my.scene.gal', 'my.scene');
    expect(() => registry.register(scene)).toThrow(/scene ID|场景 ID|my\.scene/);
    expect(registry.all()).toHaveLength(0);
  });

  it('keeps the sceneId.label addressing grammar for valid IDs', () => {
    const registry = new SceneRegistry();
    const scene = compileScene('@label scene\n凛：正文。', 'content/scenario/my.gal', 'my');
    registry.register(scene);
    expect(registry.resolve('my.scene')).toMatchObject({ scene, pc: 0 });
  });
});
