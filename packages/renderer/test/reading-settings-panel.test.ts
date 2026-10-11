import { Container, Text as PText } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_SETTINGS, GAME_SETTING_DEFINITIONS } from '@surdet/core';
import { MenuLayer } from '../src/layers/menu/menu-layer.js';
import { RenderLifecycle } from '../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../src/services/render-asset-registry.js';
import { createSettingsRows } from '../src/settings-store.js';

function texts(root: Container): PText[] {
  const found: PText[] = [];
  const visit = (node: Container): void => {
    if (node instanceof PText && node.visible) found.push(node);
    for (const child of node.children) if (child instanceof Container) visit(child);
  };
  visit(root);
  return found;
}
const text = (root: Container, value: string): PText | undefined => texts(root).find(node => node.text === value);

function makeLayer() {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const layer = new MenuLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle });
  return { root, layer, dispose: () => { layer.dispose(); assets.dispose(); lifecycle.dispose(); } };
}

describe('settings panel follows the Core setting table', () => {
  it('marks on/off rows with their confirmed value', () => {
    const rows = createSettingsRows({ ...DEFAULT_GAME_SETTINGS, readAloud: true });
    expect(rows.find(row => row.id === 'readAloud')).toMatchObject({ checked: true, display: '开启' });
    expect(rows.find(row => row.id === 'reducedMotion')).toMatchObject({ checked: false, display: '关闭' });
    expect(rows.find(row => row.id === 'textScale')?.checked).toBeUndefined();
    expect(rows.find(row => row.id === 'dialogueOpacity')?.display).toBe('跟随作品');
  });

  it('puts each row on its Core page and draws on/off rows as switches that flip on activation', () => {
    const { root, layer, dispose } = makeLayer();
    const onChange = vi.fn();
    layer.showSettings(createSettingsRows({ ...DEFAULT_GAME_SETTINGS, readAloud: true }), onChange, vi.fn());
    const reading = ['textSpeedCps', 'autoBaseDelayMs', 'skipStrategy', 'textScale', 'dialogueOpacity', 'readAloud']
      .map(key => GAME_SETTING_DEFINITIONS[key as keyof typeof GAME_SETTING_DEFINITIONS].label);
    for (const label of reading) expect(text(root, label), label).toBeDefined();
    expect(text(root, GAME_SETTING_DEFINITIONS.reducedMotion.label)).toBeUndefined();
    expect(text(root, GAME_SETTING_DEFINITIONS.masterVolume.label)).toBeUndefined();

    const state = text(root, '开启')!;
    const toggle = state.parent!;
    expect(toggle.accessibleTitle).toBe('朗读未配音台词：已开启，点按切换');
    expect(texts(toggle).map(node => node.text)).toEqual(['开启']);
    toggle.emit('pointerdown', {} as never);
    expect(onChange).toHaveBeenCalledWith('readAloud', 1);

    text(root, '显示与输入')!.emit('pointerdown', {} as never);
    expect(text(root, GAME_SETTING_DEFINITIONS.reducedMotion.label)).toBeDefined();
    expect(text(root, '关闭')!.parent!.accessibleTitle).toBe('减少动态效果：已关闭，点按切换');
    expect(text(root, GAME_SETTING_DEFINITIONS.readAloud.label)).toBeUndefined();
    dispose();
  });

  it('keeps unknown host rows on the last page with steppers', () => {
    const { root, layer, dispose } = makeLayer();
    layer.showSettings([{ id: 'hostOnly', label: '宿主项', display: '甲' }], vi.fn(), vi.fn());
    expect(text(root, '显示与输入')).toBeDefined();
    expect(text(root, '‹')).toBeDefined();
    dispose();
  });
});
