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
    expect(catalog.backgrounds[0]).toEqual({
      kind: 'background',
      key: 'castle_hall',
      sourcePath: 'content/assets/bg/castle_hall.svg',
      format: 'svg',
      resolved: true,
    });
    expect(catalog.portraits).toHaveLength(3);
    expect(catalog.portraits[1]).toEqual({
      kind: 'portrait',
      key: 'lynn:uniform',
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
});
