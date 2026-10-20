import { describe, expect, it } from 'vitest';
import type { ProjectUiDocument } from '@surdet/core';
import {
  defaultPreviewView, fragmentPlacements, newUiShareImportPrefix, peekUiShare, restoredDefaultPages,
  summarizeUiShareImpact, uiPreviewSampleContent, uiPreviewVariableValue, uiPreviewViews,
} from '../src/ui-share-import-model.js';

const frame = { x: 0, y: 0, width: 1280, height: 720 };
const draft: ProjectUiDocument = { version: 1, pages: {
  title: { id: 'title_root', type: 'container', frame, children: [
    { id: 'menu', type: 'container', frame, children: [{ id: 'start', type: 'button', frame, text: { kind: 'literal', value: '开始' } }] },
    { id: 'logo', type: 'image', frame },
  ] },
  settings: { id: 'settings_root', type: 'text', frame },
} } as ProjectUiDocument;

describe('U3 import dialog display model', () => {
  it('routes files by kind without validating them', () => {
    expect(peekUiShare(JSON.stringify({ kind: 'theme', config: { ui: { pages: { title: { id: 'a' } } } } })))
      .toEqual({ kind: 'theme', fragmentPage: null, fragmentRootId: null });
    expect(peekUiShare(JSON.stringify({ kind: 'fragment', config: { ui: { pages: { choices: { id: 'card' } } } } })))
      .toEqual({ kind: 'fragment', fragmentPage: 'choices', fragmentRootId: 'card' });
    expect(peekUiShare(JSON.stringify({ kind: 'fragment', config: { ui: { pages: { nope: { id: 'x' } } } } })).fragmentPage).toBeNull();
    expect(peekUiShare('{broken')).toEqual({ kind: null, fragmentPage: null, fragmentRootId: null });
  });

  it('creates one id-safe prefix per session', () => {
    const a = newUiShareImportPrefix(), b = newUiShareImportPrefix();
    expect(a).toMatch(/^import_[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('offers the selected container, the page root and page replacement for fragments', () => {
    const placements = fragmentPlacements('title', { page: 'title', containerId: 'menu' }, draft);
    expect(placements.map(item => [item.key, item.parentId])).toEqual([['container', 'menu'], ['root', 'title_root'], ['replace', undefined]]);
    expect(placements[0]!.label).toContain('menu');
    // A container selected on another page, a non-container selection and a non-container root are not offered.
    expect(fragmentPlacements('title', { page: 'settings', containerId: 'menu' }, draft).map(item => item.key)).toEqual(['root', 'replace']);
    expect(fragmentPlacements('title', { page: 'title', containerId: 'logo' }, draft).map(item => item.key)).toEqual(['root', 'replace']);
    expect(fragmentPlacements('settings', { page: 'settings' }, draft).map(item => item.key)).toEqual(['replace']);
    const empty = fragmentPlacements('choices', { page: 'title' }, draft);
    expect(empty).toHaveLength(1);
    expect(empty[0]!.label).toBe('作为「选项」页的自定义界面');
  });

  it('describes the backend page changes and lists pages returned to the default page', () => {
    const pages = [
      { page: 'title' as const, change: 'replace' as const, before: ['a', 'b'], after: ['c'] },
      { page: 'settings' as const, change: 'remove' as const, before: ['s'], after: [] },
      { page: 'hud' as const, change: 'add' as const, before: [], after: ['h', 'h2'] },
      { page: 'choices' as const, change: 'insert' as const, before: ['x'], after: ['x', 'p_card'] },
      { page: 'gallery' as const, change: 'unchanged' as const, before: [], after: [] },
    ];
    const rows = summarizeUiShareImpact(pages, '「选项」页根组件');
    expect(rows.map(row => [row.page, row.badge])).toEqual([['title', '替换'], ['settings', '恢复默认'], ['hud', '新增'], ['choices', '插入'], ['gallery', '保留']]);
    expect(rows[0]).toMatchObject({ added: ['c'], removed: ['a', 'b'] });
    expect(rows[1]!.detail).toContain('恢复 Player 默认页');
    expect(rows[3]!.detail).toContain('「选项」页根组件');
    expect(rows[4]!.detail).toBe('继续使用默认页。');
    expect(restoredDefaultPages(pages)).toEqual(['settings']);
  });

  it('offers every page, save and load separately, and opens on the changed page', () => {
    const views = uiPreviewViews(draft);
    expect(views.map(view => view.key)).toContain('save-load:save');
    expect(views.map(view => view.key)).toContain('save-load:load');
    expect(views.find(view => view.key === 'title')).toMatchObject({ custom: true, label: '标题' });
    expect(views.find(view => view.key === 'hud')?.label).toBe('剧情信息栏（默认页）');
    const pages = [{ page: 'title' as const, change: 'unchanged' as const, before: [], after: [] }, { page: 'backlog' as const, change: 'add' as const, before: [], after: ['b'] }];
    expect(defaultPreviewView(views, { pages })).toBe('backlog');
    expect(defaultPreviewView(views, { pages }, 'save-load')).toBe('save-load:load');
    expect(defaultPreviewView(views, { pages: [] })).toBe('title');
  });

  it('provides read-only sample content including empty and disabled states', () => {
    const load = uiPreviewSampleContent('save-slots', true, 'load');
    expect(load.every(item => item.empty && item.disabled)).toBe(true);
    expect(uiPreviewSampleContent('save-slots', true, 'save').some(item => item.disabled)).toBe(false);
    expect(uiPreviewSampleContent('backlog', true)).toEqual([]);
    expect(uiPreviewSampleContent('choices', true)).toEqual([]);
    expect(uiPreviewSampleContent('choices', false)).toHaveLength(3);
    expect(uiPreviewSampleContent('gallery-cgs', true).every(item => item.disabled && item.label === '???')).toBe(true);
    expect(uiPreviewSampleContent('gallery-cgs', false).filter(item => !item.disabled)).toHaveLength(2);
    expect(uiPreviewSampleContent('settings', false).length).toBeGreaterThan(0);
  });

  it('reads variable initial values without inventing values', () => {
    const config = { variables: { gold: { type: 'number', initial: 5 }, met: { type: 'flag' }, name: { type: 'string' } } };
    expect(uiPreviewVariableValue(config, 'gold')).toBe(5);
    expect(uiPreviewVariableValue(config, 'met')).toBe(false);
    expect(uiPreviewVariableValue(config, 'name')).toBe('');
    expect(uiPreviewVariableValue({}, 'missing')).toBe('');
  });
});
