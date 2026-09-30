import { describe, expect, it } from 'vitest';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, resolveGalleryReplayVariables, readGalleryReplayEntries } from '@surdet/core';
import { prepareStoryReplay } from '../../shared/player/story-replay.js';

const declarations = [{ name: 'score', type: 'number' as const, initial: 1, min: 0, max: 20 },
  { name: 'route', type: 'string' as const, initial: 'normal', readonly: true }];

describe('story replay snapshot contract', () => {
  it('runs from author conditions then restores original text and story collections', () => {
    const scenes = new SceneRegistry();
    scenes.register(compileScene('@scene main\n@set score = 7\n@unlock_text memory\n旁白：原进度。\n@end', 'main.gal', 'main'));
    scenes.register(compileScene('@scene memory\n@label start\n旁白：回想。\n@set score = 19\n@unlock_cg replay-only\n@clear replay-end\n@end', 'memory.gal', 'memory'));
    const store = new VariableStore(declarations);
    const interp = new Interpreter(store, new EventBus(), scenes);
    interp.start('main');
    const before = interp.saveSnapshot()!;
    const replay = prepareStoryReplay({ id: 'memory', name: '回想', scene: 'memory', label: 'start', variables: { route: 'replay' } }, declarations, scenes, {});
    expect(replay.variables).toEqual({ score: 1, route: 'replay' });
    interp.loadSnapshot(replay); interp.advance();
    expect(store.get('score')).toBe(19);
    expect(interp.clearTracker.snapshot().endings).toEqual(['replay-end']);
    interp.loadSnapshot(before);
    const after = interp.saveSnapshot()!;
    for (const field of ['variables', 'position', 'callStack', 'readSet', 'gallery', 'clears'] as const) expect(after[field]).toEqual(before[field]);
  });
  it('rejects invalid initial conditions and missing labels', () => {
    const scenes = new SceneRegistry();
    scenes.register(compileScene('@scene main\n旁白：原进度。\n@end', 'main.gal', 'main'));
    for (const overrides of [{ absent: 1 }, { score: 'wrong' }, { score: 30 }, [], null]) expect(() => resolveGalleryReplayVariables(declarations, overrides)).toThrow();
    expect(() => prepareStoryReplay({ id: 'm', name: '回想', scene: 'main', label: 'absent' }, declarations, scenes, {})).toThrow('标签');
    expect(() => readGalleryReplayEntries({ texts: null })).toThrow();
    expect(resolveGalleryReplayVariables(declarations, undefined)).toEqual({ score: 1, route: 'normal' });
  });
  it('restores an idle title checkpoint without executing a scene', () => {
    const scenes = new SceneRegistry();
    scenes.register(compileScene('@scene main\n旁白：回想。\n@end', 'main.gal', 'main'));
    const store = new VariableStore(declarations);
    const interp = new Interpreter(store, new EventBus(), scenes);
    const replay = prepareStoryReplay({ id: 'm', name: '回想', scene: 'main' }, declarations, scenes, {});
    interp.loadSnapshot(replay); interp.loadSnapshot({ ...replay, position: null });
    expect(interp.status).toBe('idle'); expect(interp.saveSnapshot()).toBeNull();
    expect(store.snapshot()).toEqual({ score: 1, route: 'normal' });
  });
});
