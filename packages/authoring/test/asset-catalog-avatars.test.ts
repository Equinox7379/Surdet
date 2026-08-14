import { describe, expect, it } from 'vitest';
import { avatarAssetRef, buildAssetCatalog } from '../src/asset-catalog.js';

describe('asset catalog avatars', () => {
  it('parses avatar names with the project convention', () => {
    const catalog = buildAssetCatalog([
      'content/assets/avatar/lynn.svg',
      'content/assets/avatar/nova.png',
      'content/assets/bg/night_field.svg',
      'content/assets/portrait/lynn_uniform_night.svg',
    ]);
    expect(catalog.avatars.map((entry) => entry.key)).toEqual(['lynn', 'nova']);
    expect(catalog.avatars[0]).toEqual({
      kind: 'avatar',
      key: 'lynn',
      sourcePath: 'content/assets/avatar/lynn.svg',
      format: 'svg',
      resolved: true,
    });
    expect(catalog.avatars[1]?.format).toBe('png');
    expect(catalog.avatars[1]?.resolved).toBe(true);
  });

  it('marks unsupported avatar formats unresolved without dropping them', () => {
    const catalog = buildAssetCatalog(['content/assets/avatar/legacy.bmp']);
    expect(catalog.avatars).toHaveLength(1);
    expect(catalog.avatars[0]?.resolved).toBe(false);
  });

  it('derives the stable avatar semantic identity', () => {
    expect(avatarAssetRef('lynn')).toBe('asset:avatar:lynn');
  });
});
