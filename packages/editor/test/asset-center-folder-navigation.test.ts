import { describe, expect, it } from 'vitest';
import type { ProjectAssetItem } from '@surdet/authoring';
import {
  assetFolderBreadcrumbs,
  assetMatchesFolder,
  buildAssetFolderOptions,
} from '../src/panels/asset-center-folders.js';

function item(sourcePath: string, assetId = `file:${sourcePath}`): ProjectAssetItem {
  return {
    assetId,
    kind: 'background',
    key: sourcePath.split(/[\\/]/).at(-1) ?? sourcePath,
    sourcePath,
    format: 'png',
    physical: true,
    references: [],
    issues: [],
  };
}

const missing: ProjectAssetItem = {
  assetId: 'missing:voice:opening',
  kind: 'voice',
  key: 'opening',
  physical: false,
  references: [],
  issues: ['ASSET_REFERENCE_MISSING'],
};

describe('Asset Center folder navigation', () => {
  it('builds stable parent-first folder options with descendant counts', () => {
    const options = buildAssetFolderOptions([
      item('content/assets/bg/castle.png'),
      item('content/assets/bg/night/rain.png'),
      item('content/assets/bg2/other.png'),
      item('content\\assets\\portrait\\lynn.png'),
      missing,
    ]);

    expect(options).toEqual([
      { path: 'content/assets', label: '素材根目录', depth: 0, count: 4 },
      { path: 'content/assets/bg', label: 'bg', depth: 1, count: 2 },
      { path: 'content/assets/bg/night', label: 'night', depth: 2, count: 1 },
      { path: 'content/assets/bg2', label: 'bg2', depth: 1, count: 1 },
      { path: 'content/assets/portrait', label: 'portrait', depth: 1, count: 1 },
    ]);
  });

  it('matches exact path segments and includes descendant folders', () => {
    const bg = item('content/assets/bg/castle.png');
    const nested = item('content/assets/bg/night/rain.png');
    const similar = item('content/assets/bg2/other.png');

    expect(assetMatchesFolder(bg, 'content/assets/bg')).toBe(true);
    expect(assetMatchesFolder(nested, 'content/assets/bg')).toBe(true);
    expect(assetMatchesFolder(similar, 'content/assets/bg')).toBe(false);
    expect(assetMatchesFolder(missing, 'content/assets')).toBe(false);
    expect(assetMatchesFolder(missing, 'all')).toBe(true);
  });

  it('ignores unsafe and non-asset paths rather than inventing folders', () => {
    const options = buildAssetFolderOptions([
      item('content/assets/../escape.png'),
      item('content/assets/./dot.png'),
      item('content/assets//empty.png'),
      item('content/scenario/not-an-asset.png'),
      item('C:/project/content/assets/bg/absolute.png'),
      item('/content/assets/bg/rooted.png'),
    ]);

    expect(options).toEqual([]);
    expect(assetMatchesFolder(item('content/assets/../escape.png'), 'content/assets')).toBe(false);
  });

  it('returns a Chinese root and exact user folder names as breadcrumbs', () => {
    expect(assetFolderBreadcrumbs('content/assets/bg/night')).toEqual([
      { path: 'all', label: '全部位置' },
      { path: 'content/assets', label: '素材根目录' },
      { path: 'content/assets/bg', label: 'bg' },
      { path: 'content/assets/bg/night', label: 'night' },
    ]);
    expect(assetFolderBreadcrumbs('all')).toEqual([{ path: 'all', label: '全部位置' }]);
  });
});
