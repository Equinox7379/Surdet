import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectAssetItem } from '@surdet/authoring';
import {
  assetFacetCount,
  filterAssetItems,
  friendlyAssetName,
  largestAssetItems,
  sortAssetItems,
} from '../src/panels/asset-center.js';
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
    bytes: 4096,
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
  state.assetCenterFolder = 'all';
  state.assetCenterSort = 'path';
  state.gameConfigText = '';
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

  it('uses authored character names for display and search without changing identifiers', () => {
    state.gameConfigText = JSON.stringify({ characters: { lynn: { name: '凛' } } });
    const portrait = { ...items[0]!, kind: 'portrait' as const, key: 'lynn:uniform', variant: 'smile' };
    expect(friendlyAssetName(portrait)).toBe('凛 · uniform · smile');
    state.assetCenterQuery = '凛';
    expect(filterAssetItems([portrait])).toEqual([portrait]);
    state.assetCenterQuery = 'lynn';
    expect(filterAssetItems([portrait])).toEqual([portrait]);
    expect(portrait.key).toBe('lynn:uniform');
  });

  it('sorts large libraries predictably and derives the largest measured files from shared facts', () => {
    expect(sortAssetItems(items, 'size-desc').map((item) => item.key))
      .toEqual(['unused_field', 'castle_hall', 'opening_voice']);
    expect(sortAssetItems(items, 'references-desc').at(-1)?.key).toBe('unused_field');
    expect(largestAssetItems(items).map((item) => item.key)).toEqual(['unused_field', 'castle_hall']);

    state.assetCenterSort = 'attention';
    expect(filterAssetItems(items).map((item) => item.key))
      .toEqual(['opening_voice', 'unused_field', 'castle_hall']);
  });

  it('combines directory boundaries with search, kind, status, and facet counts', () => {
    const portrait: ProjectAssetItem = {
      assetId: 'file:content/assets/portrait/uniform/lynn.png',
      kind: 'portrait',
      key: 'lynn_uniform',
      sourcePath: 'content/assets/portrait/uniform/lynn.png',
      format: 'png',
      bytes: 2048,
      physical: true,
      references: [],
      issues: ['ASSET_UNUSED'],
    };
    const allItems = [...items, portrait];

    state.assetCenterFolder = 'content/assets/bg';
    state.assetCenterStatus = 'unused';
    expect(filterAssetItems(allItems).map((item) => item.key)).toEqual(['unused_field']);
    expect(assetFacetCount(allItems, { kind: 'all', status: 'all' })).toBe(2);
    expect(assetFacetCount(allItems, { kind: 'portrait', status: 'all' })).toBe(0);

    state.assetCenterFolder = 'content/assets/portrait';
    state.assetCenterStatus = 'all';
    state.assetCenterKind = 'portrait';
    state.assetCenterQuery = 'uniform';
    expect(filterAssetItems(allItems).map((item) => item.key)).toEqual(['lynn_uniform']);
  });
});
