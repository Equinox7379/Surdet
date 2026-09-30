import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { validateGalleryConfig, type GalleryValidationInput } from '../src/gallery-validation.js';

const galleryPath = 'content/config/gallery.json';
const configPath = 'game.config.json';

function input(text: string, overrides: Partial<Omit<GalleryValidationInput, 'text'>> = {}): GalleryValidationInput {
  return {
    text,
    galleryPath,
    scenes: new Map(),
    failedSceneIds: new Set(),
    characters: null,
    configPath,
    ...overrides,
  };
}

function compiledScene(): ReturnType<typeof compileScene> {
  const source = [
    '@scene a',
    '@label replay',
    '@unlock_cg room',
    '@unlock_music rain',
    '@unlock_text replay_a',
    '@end',
  ].join('\n');
  return compileScene(source, 'content/scenario/a.gal', 'a', [
    'unlock_cg',
    'unlock_music',
    'unlock_text',
  ]);
}

describe('validateGalleryConfig', () => {
  it('ignores custom instructions whose names match inherited object keys', () => {
    const scene = compileScene('@scene a\n@constructor\n@toString\n@end', 'a.gal', 'a', ['constructor', 'toString']);
    expect(validateGalleryConfig(input('{"cgs":[],"music":[]}', { scenes: new Map([['a', scene]]) }))).toEqual([]);
  });
  it('accepts valid in-memory gallery links and asset collections', () => {
    const issues = validateGalleryConfig(input(JSON.stringify({
      cgs: [{ id: 'room', name: '房间' }],
      music: [{ id: 'rain', name: '雨声' }],
      texts: [{ id: 'replay_a', name: '回想', scene: 'a', label: 'replay' }],
    }), {
      scenes: new Map([['a', compiledScene()]]),
      bgAssets: new Set(['room']),
      bgmAssets: new Set(['rain']),
      avatarAssets: new Set(['aya']),
      characters: { aya: { name: '亚雅', avatar: 'aya' } },
    }));

    expect(issues).toEqual([]);
  });

  it('skips each asset check when its collection is absent', () => {
    const scene = compiledScene();
    const issues = validateGalleryConfig(input(JSON.stringify({
      cgs: [{ id: 'room', name: '房间' }],
      music: [{ id: 'rain', name: '雨声' }],
      texts: [{ id: 'replay_a', name: '回想', scene: 'a', label: 'replay' }],
    }), {
      scenes: new Map([['a', scene]]),
      characters: { aya: { name: '亚雅', avatar: 'missing_avatar' } },
    }));

    expect(issues).toEqual([]);
  });

  it('keeps structure, scene, unlock, duplicate, and avatar diagnostics in the shared result', () => {
    const issues = validateGalleryConfig(input(JSON.stringify({
      cgs: [
        { id: 'room', name: '房间' },
        { id: 'room', name: '房间副本' },
      ],
      music: [{ id: 'rain', name: '雨声' }],
      texts: [
        { id: 'missing_scene', name: '缺场景', scene: 'missing' },
        { id: 'missing_label', name: '缺标签', scene: 'a', label: 'missing' },
      ],
    }), {
      scenes: new Map([['a', compiledScene()]]),
      bgAssets: new Set(['room']),
      bgmAssets: new Set(['rain']),
      avatarAssets: new Set(),
      characters: { aya: { name: '亚雅', avatar: 'missing_avatar' } },
    }));

    expect(issues.filter((issue) => issue.code === 'G002')).toHaveLength(1);
    expect(issues.filter((issue) => issue.code === 'G004')).toHaveLength(1);
    expect(issues.filter((issue) => issue.code === 'G005')).toHaveLength(1);
    expect(issues.filter((issue) => issue.code === 'G007')).toHaveLength(2);
    expect(issues.filter((issue) => issue.code === 'G008')).toHaveLength(1);
    expect(issues.every((issue) => issue.severity === 'error')).toBe(true);
  });

  it('checks quoted dossier unlocks, missing entries and missing unlock points', () => {
    const gallery = JSON.stringify({ cgs: [], music: [], profiles: [{ id: 'rin.first', character: 'rin' }], terms: [{ id: 'port', canonical: '雾港' }] });
    const context = { characters: { rin: { name: '凛' } }, terminology: { terms: [{ canonical: '雾港', variants: [] }] } };
    const scene = compileScene('@unlock_profile "rin.first"\n@unlock_term "port"\n@end', 'a.gal', 'a');
    expect(validateGalleryConfig(input(gallery, { ...context, scenes: new Map([['a', scene]]) }))).toEqual([]);
    const missing = compileScene('@unlock_profile absent\n@unlock_term absent\n@end', 'a.gal', 'a');
    const issues = validateGalleryConfig(input(gallery, { ...context, scenes: new Map([['a', missing]]) }));
    expect(issues.filter(issue => issue.code === 'G006')).toHaveLength(2);
    expect(issues.filter(issue => issue.code === 'G007')).toHaveLength(2);
    expect(validateGalleryConfig(input(gallery, { ...context, characters: {} }))).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'G001', text: expect.stringContaining('人物不存在') })]));
    expect(validateGalleryConfig(input(gallery, { ...context, terminology: { terms: [] } }))).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'G001', text: expect.stringContaining('规范词不存在') })]));
  });

  it('reports malformed JSON against the supplied gallery path', () => {
    const issues = validateGalleryConfig(input('\uFEFF{"cgs":'));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'G001', file: galleryPath, severity: 'error' });
  });
});
