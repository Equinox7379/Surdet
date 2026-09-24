import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_ASSET_FORMATS,
  backgroundAssetRef,
  buildAssetCatalog,
  portraitAssetRef,
} from '../src/asset-catalog.js';

describe('shared asset catalog', () => {
  it('parses background and portrait names with the project convention', () => {
    const catalog = buildAssetCatalog([
      'content/assets/bg/castle_hall.svg',
      'content/assets/bg/night_field.svg',
      'content/assets/portrait/lynn_uniform_normal.svg',
      'content/assets/portrait/lynn_uniform_night.svg',
      'content/assets/portrait/lynn_uniform_despair.svg',
    ]);
    expect(catalog.backgrounds.map((entry) => entry.key)).toEqual(['castle_hall', 'night_field']);
    expect(catalog.backgrounds.every((entry) => entry.kind === 'background')).toBe(true);
    expect(catalog.backgrounds.every((entry) => entry.format === 'svg' && entry.resolved === true)).toBe(true);
    expect(catalog.backgrounds[0]).toMatchObject({
      kind: 'background',
      key: 'castle_hall',
      sourcePath: 'content/assets/bg/castle_hall.svg',
      format: 'svg',
      resolved: true,
    });
    expect(catalog.portraits).toHaveLength(3);
    expect(catalog.portraits[1]).toMatchObject({
      kind: 'portrait',
      key: 'lynn:uniform',
      timelineTarget: 'lynn:uniform',
      role: 'lynn',
      outfit: 'uniform',
      expression: 'night',
      sourcePath: 'content/assets/portrait/lynn_uniform_night.svg',
      format: 'svg',
      resolved: true,
    });
  });

  it('is stable regardless of input order', () => {
    const input = [
      'content/assets/portrait/lynn_uniform_night.svg',
      'content/assets/bg/night_field.svg',
    ];
    const forward = buildAssetCatalog(input);
    const reverse = buildAssetCatalog([...input].reverse());
    expect(forward).toEqual(reverse);
  });

  it('ignores directories outside the two contracts and malformed portrait names', () => {
    const catalog = buildAssetCatalog([
      'content/assets/avatar/lynn.svg',
      'content/assets/fonts/MiSans-Regular.otf',
      'content/assets/portrait/lynn_uniform.svg',
      'content/assets/portrait/lynn_uniform_night_special.svg',
      'public/bg/stray.svg',
      'content/assets/bg/.hidden.svg',
    ]);
    expect(catalog.backgrounds).toHaveLength(0);
    expect(catalog.portraits).toHaveLength(0);
  });

  it('marks unsupported formats as unresolved without dropping the entry', () => {
    const catalog = buildAssetCatalog([
      'content/assets/bg/legacy.bmp',
      'content/assets/bg/castle_hall.svg',
    ]);
    const legacy = catalog.backgrounds.find((entry) => entry.key === 'legacy');
    expect(legacy).toBeDefined();
    expect(legacy?.format).toBe('bmp');
    expect(legacy?.resolved).toBe(false);
    expect(catalog.backgrounds.find((entry) => entry.key === 'castle_hall')?.resolved).toBe(true);
    expect(SUPPORTED_ASSET_FORMATS).toContain('svg');
  });

  it('derives stable semantic asset identities', () => {
    expect(backgroundAssetRef('night_field')).toBe('asset:bg:night_field');
    expect(portraitAssetRef('lynn', 'uniform', 'night')).toBe('asset:portrait:lynn:uniform:night');
  });

  it('provides real-key scene and timeline examples for each background and expression', () => {
    const catalog = buildAssetCatalog([
      'content/assets/bg/夜港 @ evening.png',
      'content/assets/portrait/rin_coat_calm.png',
      'content/assets/portrait/rin_coat_smile.png',
      'content/assets/avatar/rin.png',
    ]);
    expect(catalog.backgrounds[0]?.usage).toEqual({
      scene: { kind: 'instruction', name: 'bg', args: ['"夜港 @ evening"'] },
      timeline: { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: '夜港 @ evening' }] },
    });
    for (const portrait of catalog.portraits) {
      expect(portrait.usage).toEqual({
        scene: { kind: 'instruction', name: 'show', args: ['"rin:coat"', `"${portrait.expression}"`], modifiers: { pos: 'center' } },
        timeline: { kind: 'portrait', target: 'rin:coat', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'show', expression: portrait.expression, position: 'center' }] },
      });
    }
    expect(catalog.avatars[0]?.usage).toBeUndefined();
  });

  it('does not suggest ambiguous, invalid or unsupported assets as usable examples', () => {
    const catalog = buildAssetCatalog([
      'content/assets/bg/duplicate.png', 'content/assets/bg/sub/duplicate.webp',
      'content/assets/bg/bad?.png', 'content/assets/bg/old.bmp',
      'content/assets/portrait/rin_coat_calm.png', 'content/assets/portrait/rin_coat_calm.webp',
      'content/assets/portrait/rin_coat_smile.png',
    ]);
    expect(catalog.backgrounds.every(entry => entry.usage === undefined)).toBe(true);
    expect(catalog.portraits.filter(entry => entry.expression === 'calm').every(entry => entry.usage === undefined)).toBe(true);
    expect(catalog.portraits.find(entry => entry.expression === 'smile')?.usage).toBeDefined();
    expect(catalog.intelligence.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['ASSET_KEY_DUPLICATE', 'ASSET_NAME_INVALID', 'ASSET_FORMAT_UNSUPPORTED']));
  });
});
