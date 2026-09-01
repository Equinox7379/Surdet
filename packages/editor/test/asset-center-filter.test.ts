import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectAssetItem } from '@surdet/authoring';
import { assetFacetCount, filterAssetItems, friendlyAssetName } from '../src/panels/asset-center.js';
import { state } from '../src/state.js';

const items: ProjectAssetItem[] = [
  {
    assetId: 'file:content/assets/bg/castle_hall.svg',
    kind: 'background',
    key: 'castle_hall',
    sourcePath: 'content/assets/bg/castle_hall.svg',
    format: 'svg',
    bytes: 12,
    physical: true,
    references: [{
      referenceId: 'scene:one:1:bg',
      sourceKind: 'scene',
      sourceLabel: '场景 one · 第 1 行',
      sourcePath: 'content/scenario/one.gal',
      line: 1,
    }],
    issues: [],
  },
  {
    assetId: 'file:content/assets/bg/unused_field.png',
    kind: 'background',
    key: 'unused_field',
    sourcePath: 'content/assets/bg/unused_field.png',
    format: 'png',
    physical: true,
    references: [],
    issues: ['ASSET_UNUSED'],
  },
  {
    assetId: 'missing:voice:opening_voice',
    kind: 'voice',
    key: 'opening_voice',
    physical: false,
    references: [{
      referenceId: 'scene:one:2:voice',
      sourceKind: 'scene',
      sourceLabel: '场景 one · 第 2 行',
      sourcePath: 'content/scenario/one.gal',
      line: 2,
    }],
    issues: ['ASSET_REFERENCE_MISSING'],
  },
];

afterEach(() => {
  state.assetCenterQuery = '';
  state.assetCenterKind = 'all';
  state.assetCenterStatus = 'all';
});

describe('Asset Center filters', () => {
  it('uses the active query for both visible items and facet counts', () => {
    state.assetCenterQuery = 'field';
    expect(filterAssetItems(items).map((item) => item.key)).toEqual(['unused_field']);
    expect(assetFacetCount(items, { kind: 'all', status: 'all' })).toBe(1);
    expect(assetFacetCount(items, { kind: 'background', status: 'all' })).toBe(1);
    expect(assetFacetCount(items, { kind: 'voice', status: 'all' })).toBe(0);
    expect(assetFacetCount(items, { kind: 'all', status: 'unused' })).toBe(1);
  });

  it('renders a friendly display label without exposing the raw stable key syntax', () => {
    expect(friendlyAssetName(items[0]!)).toBe('Castle Hall');
    expect(friendlyAssetName({ ...items[0]!, key: '雨夜_站台' })).toBe('雨夜 站台');
  });
});
