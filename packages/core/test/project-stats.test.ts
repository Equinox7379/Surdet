import { describe, expect, it } from 'vitest';
import { compileScene, computeProjectStats } from '../src/index.js';

function scene(id: string, source: string) {
  return compileScene(source, `${id}.gal`, id);
}

describe('computeProjectStats', () => {
  it('retains legal prototype-shaped scene names in per-scene output and JSON', () => {
    const stats = computeProjectStats({ scenes: [scene('__proto__', '旁白：合法。'), scene('constructor', '另一场景。')], entryScene: '__proto__', sourceTextByScene: {} });
    expect(Object.hasOwn(stats.perScene, '__proto__')).toBe(true);
    expect(stats.perScene['__proto__']).toMatchObject({ totalTextLines: 1, totalCharacters: 3 });
    expect(Object.keys(JSON.parse(JSON.stringify(stats)).perScene)).toEqual(['__proto__', 'constructor']);
    expect(stats.reachableScenes).toEqual(['__proto__']);
  });

  it('does not turn a local goto label into an edge to a same-named scene', () => {
    const start = scene('start', '@goto phantom\n@label phantom\n当前。\n@call called\n@end');
    const stats = computeProjectStats({ scenes: [start, scene('phantom', '孤立。'), scene('called', '@return')], entryScene: 'start', sourceTextByScene: {} });
    expect(stats.reachableScenes).toEqual(['called', 'start']);
    expect(stats.unreachableScenes).toEqual(['phantom']);
  });
  it('includes configured system entry scenes and their successors in reachability', () => {
    const scenes = [scene('start', '开始'), scene('event', '@jump end'), scene('end', '结束'), scene('unused', '孤立')];
    const stats = computeProjectStats({ scenes, entryScene: 'start', sourceTextByScene: {}, additionalSceneRoots: ['event'] });
    expect(stats.reachableScenes).toEqual(['end', 'event', 'start']);
    expect(stats.unreachableScenes).toEqual(['unused']);
  });
  it('computes stable text/choice/ending/speaker/reachability/assets metrics', () => {
    const scenes = [
      scene('b', '@bg room\n旁白\n@clear end_b'),
      scene('a', '@show lynn\n凛：你好\n@choice\n  去 B -> @jump b\n@clear end_a'),
      scene('orphan', '无关文本'),
    ];
    const stats = computeProjectStats({ scenes, entryScene: 'a', sourceTextByScene: { a: '', b: '', orphan: '' } });
    expect(stats).toMatchObject({ sceneCount: 3, totalTextLines: 3, totalCharacters: 8, choiceCount: 1, endingCount: 2 });
    expect(stats.speakerLines).toEqual({ '凛': 1 });
    expect(stats.reachableScenes).toEqual(['a', 'b']);
    expect(stats.unreachableScenes).toEqual(['orphan']);
    expect(stats.referencedAssets).toEqual({ lynn: ['a'], room: ['b'] });
  });

  it('sorts outputs independent of input order', () => {
    const a = scene('a', '甲：a');
    const b = scene('b', '乙：b');
    const first = computeProjectStats({ scenes: [b, a], entryScene: 'a', sourceTextByScene: {} });
    const second = computeProjectStats({ scenes: [a, b], entryScene: 'a', sourceTextByScene: {} });
    expect(first).toEqual(second);
  });
});
