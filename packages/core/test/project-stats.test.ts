import { describe, expect, it } from 'vitest';
import { compileScene, computeProjectStats } from '../src/index.js';

function scene(id: string, source: string) {
  return compileScene(source, `${id}.gal`, id);
}

describe('computeProjectStats', () => {
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
