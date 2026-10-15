import { describe, expect, it } from 'vitest';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, resolveGalleryReplayVariables, readGalleryReplayEntries } from '@surdet/core';
import { prepareStoryReplay } from '../../shared/player/story-replay.js';
import { AchievementSystem } from '@surdet/core';
import { readFileSync } from 'node:fs';
import { ScriptTarget, transpileModule } from 'typescript';

const declarations = [{ name: 'score', type: 'number' as const, initial: 1, min: 0, max: 20 },
  { name: 'route', type: 'string' as const, initial: 'normal', readonly: true }];

describe('story replay snapshot contract', () => {
  it.each([false, true])('does not award or announce conditional achievements during replay (restoring=%s)', restoring => {
    const store = new VariableStore([{ name: 'received', type: 'flag', initial: true }]);
    const achievements = new AchievementSystem([{ id: 'letter', name: '收到来信', when: 'received' }], store);
    const banners: string[] = [];
    const source = readFileSync(new URL('../../shared/player/player.ts', import.meta.url), 'utf8');
    const start = source.indexOf('  function checkAchievements(): void {');
    const end = source.indexOf('  // 每条文本推进后判定', start);
    if (start < 0 || end < 0) throw new Error('achievement callback not found');
    const body = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
    const check = new Function('achievements', 'dialogue', 'console', body + '\nreturn replay => { galleryReplay = replay; checkAchievements(); };\nvar galleryReplay;')(
      achievements, { showBanner: (text: string) => banners.push(text) }, { info: () => {}, warn: () => {} });
    check({ restoring });
    expect(achievements.unlocked()).toEqual([]); expect(banners).toEqual([]);
    check(null); check(null);
    expect(achievements.unlocked()).toEqual(['letter']); expect(banners).toEqual(['成就解锁：收到来信']);
  });

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
