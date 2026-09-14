import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileScene, createSeededRandomSource, EventBus, Interpreter, SceneRegistry, VariableStore } from '@surdet/core';
import type { CoreEventMap } from '@surdet/core';
import { buildPreviewReplaySources, parsePreviewPlaybackCheckpoint, type PreviewPlaybackCheckpoint } from '@surdet/authoring';
import { PreviewReplayController } from '../src/preview-replay-runtime.js';

const seed = 19;
const hasher = { sha256: async (text: string) => createHash('sha256').update(text, 'utf8').digest('hex') };
type Route = 'loop' | 'call' | 'choice-loop';

function scenesFor(route: Route): { id: string; text: string }[] {
  if (route === 'call') return [
    { id: 'start', text: '@scene start\n@call again\n@call again\n@call again\n@end\n' },
    { id: 'again', text: '@scene again\n@mod visits +1\n凛：第{visits}次。\n@return\n' },
  ];
  const tail = route === 'loop'
    ? '@if visits < 3\n@goto again\n@endif\n@end\n'
    : '@choice\n  再次 -> @goto again\n  结束 -> @goto done\n@label done\n结束。\n@end\n';
  return [{ id: 'start', text: '@scene start\n@label again\n@mod visits +1\n凛：第{visits}次。\n' + tail }];
}

async function runtime(route: Route, replay?: PreviewPlaybackCheckpoint) {
  const scenes = scenesFor(route);
  const store = new VariableStore([{ name: 'visits', type: 'number', initial: 0 }]);
  const bus = new EventBus<CoreEventMap>();
  const registry = new SceneRegistry();
  for (const scene of scenes) registry.register(compileScene(scene.text, `${scene.id}.gal`, scene.id));
  const interpreter = new Interpreter(store, bus, registry);
  interpreter.setRandomSource(createSeededRandomSource(seed));
  const statuses: string[] = [];
  const texts: string[] = [];
  const controller = new PreviewReplayController({
    sources: await buildPreviewReplaySources(scenes, hasher), seed, sceneId: 'start',
    ...(replay === undefined ? {} : { replay }), onStatus: message => statuses.push(message),
  });
  bus.on('text', event => texts.push(event.value));
  bus.on('runtimeTrace', event => controller.observe(event));
  bus.on('choice', event => controller.choice(event.options));
  controller.attach(interpreter, {
    advance: () => { interpreter.advance(); return true; },
    select: index => { interpreter.choose(index); return true; },
  });
  interpreter.start('start');
  return { store, interpreter, controller, statuses, texts };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

describe('preview replay dynamic target visits', () => {
  it.each(['loop', 'call', 'choice-loop'] as const)('returns to the third visit rather than the first (%s)', async route => {
    const recording = await runtime(route);
    try {
      const first = recording.controller.checkpoint();
      for (let i = 0; i < 2; i++) {
        recording.interpreter.advance();
        if (route === 'choice-loop') recording.interpreter.choose(0);
      }
      expect(recording.store.getNumber('visits')).toBe(3);
      const saved = recording.controller.checkpoint();
      expect(saved.target).toEqual(first.target);
      const replay = await runtime(route, saved);
      try {
        await settle();
        expect(replay.store.getNumber('visits')).toBe(3);
        expect(replay.interpreter.status).toBe('awaiting-advance');
        expect(replay.texts).toHaveLength(3);
        expect(saved.targetVisit).toBe(3);
        expect(saved).not.toEqual(first);
        expect(parsePreviewPlaybackCheckpoint(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
        expect(replay.controller.checkpoint()).toEqual(saved);
        expect(replay.statuses.at(-1)).toContain('试玩已回到保存的目标源点');
      } finally { replay.controller.dispose(); }
    } finally { recording.controller.dispose(); }
  });

  it('keeps older checkpoints readable but does not invent their missing visit number', async () => {
    const recording = await runtime('loop');
    recording.interpreter.advance();
    recording.interpreter.advance();
    const { targetVisit: _visit, ...legacy } = recording.controller.checkpoint();
    recording.controller.dispose();
    expect(parsePreviewPlaybackCheckpoint(legacy)).toEqual(legacy);
    const replay = await runtime('loop', legacy);
    try {
      await settle();
      expect(replay.store.getNumber('visits')).toBe(1);
      expect(replay.statuses.some(message => message.includes('缺少有效的目标访问次数'))).toBe(true);
      expect(replay.statuses.some(message => message.includes('试玩已回到保存'))).toBe(false);
    } finally { replay.controller.dispose(); }
  });

  it('rejects invalid visit identities without accepting variables or snapshot injection', () => {
    const target = { sceneId: 'start', kind: 'text', anchor: 'again', fingerprint: 'a'.repeat(64) };
    const checkpoint = { seed, sceneId: 'start', choices: [], target, targetVisit: 3 };
    expect(parsePreviewPlaybackCheckpoint(checkpoint)).toEqual(checkpoint);
    for (const targetVisit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parsePreviewPlaybackCheckpoint({ ...checkpoint, targetVisit })).toThrow('试玩续接路径格式无效');
    }
    expect(() => parsePreviewPlaybackCheckpoint({ ...checkpoint, target: null })).toThrow('试玩续接路径格式无效');
    expect(() => parsePreviewPlaybackCheckpoint({ ...checkpoint, variables: { visits: 3 } })).toThrow('试玩续接路径格式无效');
  });
});
