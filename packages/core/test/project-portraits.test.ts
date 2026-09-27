import { describe, expect, it } from 'vitest';
import { assertUniquePortraitBindings, portraitSourcePaths, projectPortraitOverrides, resolveProjectPortraits } from '../src/project-portraits.js';

describe('project portrait mappings', () => {
  const old = 'content/assets/portrait/hero_uniform_normal.png';
  const alternate = 'content/assets/portrait/library_casual_smile.webp';
  it('keeps dynamic slots explicit and exposes all parts, including unused variants, without shadowing static declarations', () => {
    const visual = { version: 1, kind: 'layered', layers: [{ id: 'body', images: { base: old, alternate }, default: 'base' }] };
    const config = { characters: { hero: { visuals: { uniform: { normal: visual } } } } };
    const bindings = resolveProjectPortraits(config, [old]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({ role: 'hero', configured: true, sourcePath: old, visual });
    expect(new Set(portraitSourcePaths(bindings[0]!))).toEqual(new Set([old, alternate]));
    const reordered = { characters: { hero: { visuals: { uniform: { normal: { ...visual, layers: [{ ...visual.layers[0], images: { alternate, base: old } }] } } } } } };
    expect(JSON.stringify(projectPortraitOverrides(reordered))).toBe(JSON.stringify(projectPortraitOverrides(config)));
    expect(() => projectPortraitOverrides({ characters: { hero: { ...config.characters.hero, portraits: { uniform: { normal: old } } } } })).toThrow('冲突');
  });
  it('rejects duplicate automatic slots before runtime registration but accepts an explicit choice', () => {
    const duplicate = 'content/assets/portrait/hero_uniform_normal.webp';
    for (const paths of [[old, duplicate], [duplicate, old]]) {
      expect(() => assertUniquePortraitBindings(resolveProjectPortraits({}, paths))).toThrow(/立绘绑定冲突/);
      expect(() => assertUniquePortraitBindings(resolveProjectPortraits({ characters: { hero: { portraits: { uniform: { normal: duplicate } } } } }, paths))).not.toThrow();
    }
  });
  it('does not register invalid automatic filenames over a valid portrait in either enumeration order', () => {
    const invalid = ['hero_uniform_normal_v2.png', 'hero.png', 'hero_uniform.png', 'hero__normal.png', 'hero_uniform_bad?.png'];
    const paths = [old, ...invalid.map(name => `content/assets/portrait/${name}`)];
    for (const order of [paths, [...paths].reverse()]) {
      expect(resolveProjectPortraits({}, order)).toEqual([{ role: 'hero', outfit: 'uniform', expression: 'normal', sourcePath: old }]);
    }
    const explicit = `content/assets/portrait/${invalid[0]}`;
    expect(resolveProjectPortraits({ characters: { hero: { portraits: { uniform: { normal: explicit } } } } }, paths))
      .toEqual([{ role: 'hero', outfit: 'uniform', expression: 'normal', sourcePath: explicit, configured: true, overriddenSourcePaths: [old] }]);
  });
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
