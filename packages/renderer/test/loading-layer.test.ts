import { Graphics, Text as PText } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { LoadingLayer } from '../src/loading-layer.js';
import { createRendererTheme } from '../src/theme.js';

describe('LoadingLayer truthful progress', () => {
  it('keeps an unknown total indeterminate and distinguishes an empty completed queue', () => {
    const layer = new LoadingLayer(800, 600);
    try {
      layer.show({ total: 0, completed: 0, failed: 0, current: null, done: false });
      expect(layer.container.children[0]).toMatchObject({ eventMode: 'static' });
      const texts = layer.container.children.filter((child): child is PText => child instanceof PText);
      expect(texts.map((text) => text.text).join(' ')).toContain('正在读取');
      expect(texts.map((text) => text.text).join(' ')).not.toMatch(/0\/0|%|加载完成/);
      const [, track, fill] = layer.container.children as Graphics[];
      expect(track!.visible).toBe(false);
      expect(fill!.visible).toBe(false);
      layer.show({ total: 0, completed: 0, failed: 0, current: null, done: true });
      expect(texts.map((text) => text.text).join(' ')).toContain('无需加载资源');
    } finally { layer.destroy(); }
  });

  it('reports failed resources and preserves current progress across theme changes', () => {
    const layer = new LoadingLayer(640, 480);
    try {
      layer.show({ total: 4, completed: 1, failed: 1, current: '场景/背景.png', done: false });
      const [, track, fill] = layer.container.children as Graphics[];
      const before = fill!.width;
      expect(before).toBeGreaterThan(0);
      expect(track!.x).toBeGreaterThanOrEqual(24);
      expect(track!.x + track!.width).toBeLessThanOrEqual(616);
      layer.setTheme(createRendererTheme({ colors: { accent: 0x123456 } }));
      expect(fill!.width).toBe(before);
      layer.show({ total: 4, completed: 3, failed: 1, current: null, done: true });
      const text = layer.container.children.filter((child): child is PText => child instanceof PText).map((child) => child.text).join(' ');
      expect(text).toContain('失败 1');
      expect(text).not.toContain('资源加载完成');
    } finally { layer.destroy(); }
  });
});
