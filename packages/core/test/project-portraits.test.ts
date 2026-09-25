import { describe, expect, it } from 'vitest';
import { projectPortraitOverrides, resolveProjectPortraits } from '../src/project-portraits.js';

describe('project portrait mappings', () => {
  const old = 'content/assets/portrait/hero_uniform_normal.png';
  const alternate = 'content/assets/portrait/library_casual_smile.webp';
  it('overrides one slot by exact path, retains automatic expressions and missing explicit slots', () => {
    const config = { characters: { hero: { name: '小夜', portraits: { uniform: { normal: alternate, '微笑': 'content/assets/portrait/missing_a_b.png' } } } } };
    const entries = resolveProjectPortraits(config, [old, alternate, 'content/assets/portrait/hero_uniform_sad.png']);
    expect(entries.filter(p => p.role === 'hero')).toEqual([
      { role: 'hero', outfit: 'uniform', expression: 'sad', sourcePath: 'content/assets/portrait/hero_uniform_sad.png' },
      { role: 'hero', outfit: 'uniform', expression: 'normal', sourcePath: alternate, configured: true, overriddenSourcePaths: [old] },
      { role: 'hero', outfit: 'uniform', expression: '微笑', sourcePath: 'content/assets/portrait/missing_a_b.png', configured: true, overriddenSourcePaths: [] },
    ]);
    expect(projectPortraitOverrides({ characters: { hero: { portraits: {} } } })).toEqual([]);
  });
  it('rejects malformed mappings and escaping/non-image paths, not display-only declarations', () => {
    for (const portraits of [null, [], { normal: [] }, { 'bad:id': { normal: old } }, { normal: { a: '../outside.png' } }, { normal: { a: 'content/assets/portrait/../bg/a.png' } }]) {
      expect(() => projectPortraitOverrides({ characters: { hero: { portraits } } })).toThrow();
    }
    expect(projectPortraitOverrides({ characters: { hero: { name: '小夜', avatar: 'face' } } })).toEqual([]);
  });
});
