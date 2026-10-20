import { describe, expect, it } from 'vitest';
import { readProjectUi, projectUiAssetKeys, projectUiChildrenRect, type ProjectUiNode } from '../src/project-ui.js';
import { projectUiNineSlice, resolveProjectUiStyle, type ProjectUiStyle } from '../src/project-ui-style.js';

const node: ProjectUiNode = { id: 'start', type: 'button', frame: { x: 0, y: 0, width: 200, height: 100 } };
const config = (style: unknown) => ({ ui: { version: 1, pages: { title: { ...node, style } } } });
const slice = { top: 10, right: 20, bottom: 30, left: 40, fillCenter: true };
const style: ProjectUiStyle = { color: 0, background: 0, opacity: 0, fontWeight: 700, lineHeight: 1.6, letterSpacing: -1,
  textShadows: [{ x: 1, y: -2, blur: 3, color: 0, opacity: 0.5 }],
  backgroundGradient: { from: 0, to: 0xffffff, angle: 0 }, backgroundImage: { asset: '纸 框', fit: 'stretch', slice },
  border: { width: 2, color: 0, opacity: 0 }, borderRadius: 0, padding: { top: 1, right: 2, bottom: 3, left: 4 }, shadows: [] };

describe('U1 finite UI style contract', () => {
  it('preserves authored values and reports image dependencies without accepting CSS or URLs', () => {
    const value = readProjectUi(config(style));
    expect(value?.pages.title?.style).toEqual(style);
    expect(projectUiAssetKeys(value)).toEqual(['纸 框']);
    for (const invalid of [
      { fontWeight: 650 }, { lineHeight: Infinity }, { letterSpacing: NaN }, { background: -1 }, { padding: { left: 1 } },
      { textShadows: Array(5).fill(style.textShadows![0]) }, { shadows: [{ ...style.textShadows![0], css: 'url(x)' }] },
      { backgroundImage: { asset: 'https://example.com/x', fit: 'cover' } },
      { backgroundImage: { asset: '纸 框', fit: 'cover', slice } },
      { backgroundImage: { asset: '纸 框', fit: 'stretch', slice: { ...slice, top: 0.5 } } },
      { backgroundGradient: { from: 0, to: 0, angle: 0, stops: [] } }, { border: { width: -1, color: 0, opacity: 1 } },
    ]) expect(() => readProjectUi(config(invalid))).toThrow();
  });
  it('resolves explicit host > project > default, then node; clear and zero are not missing', () => {
    const project = { theme: { colors: { text: 123 }, buttonSkin: 'paper' } };
    expect(resolveProjectUiStyle(node, project).color).toBe(123);
    expect(resolveProjectUiStyle(node, project, { colors: { text: 456 } }).color).toBe(456);
    expect(resolveProjectUiStyle({ ...node, style }, project, { colors: { text: 456 } })).toMatchObject({ color: 0, opacity: 0, borderRadius: 0 });
    expect(resolveProjectUiStyle(node, project).backgroundImage).toEqual({ asset: 'paper', fit: 'stretch' });
    expect(resolveProjectUiStyle({ ...node, style: { backgroundImage: null, border: null, textShadows: [], shadows: [] } }, project))
      .toMatchObject({ backgroundImage: null, border: null, textShadows: [], shadows: [] });
    expect(projectUiAssetKeys(readProjectUi(config({ backgroundImage: null })))).toEqual([]);
  });
  it('keeps the layout box unchanged, insets children once and rejects exhausted content space', () => {
    expect(projectUiChildrenRect(node.frame, 'container')).toBe(node.frame);
    expect(projectUiChildrenRect(node.frame, 'container', style)).toEqual({ x: 6, y: 3, width: 190, height: 92 });
    expect(projectUiChildrenRect(node.frame, 'tabs', style)).toEqual({ x: 6, y: 41, width: 190, height: 54 });
    expect(node.frame).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(() => readProjectUi(config({ padding: { top: 50, bottom: 50, left: 0, right: 0 } }))).toThrow('内容空间');
    expect(() => readProjectUi({ ui: { version: 1, pages: { title: { ...node, type: 'tabs', style: { padding: { top: 40, bottom: 40, left: 0, right: 0 } } } } } })).toThrow('页签');
  });
  it('reports the Player progress track defaults and keeps explicit zero values', () => {
    const progress: ProjectUiNode = { id: 'hp', type: 'progress', frame: node.frame, binding: { kind: 'variable', name: 'hp' } };
    const project = { theme: { colors: { surface: 0x123456 }, radius: { sm: 5 } } };
    expect(resolveProjectUiStyle(progress, project)).toMatchObject({ background: 0x123456, borderRadius: 5 });
    expect(resolveProjectUiStyle(progress, project, { colors: { surface: 0xabcdef }, radius: { sm: 7 } }))
      .toMatchObject({ background: 0xabcdef, borderRadius: 7 });
    expect(resolveProjectUiStyle({ ...progress, style: { background: 0, borderRadius: 0 } }, project))
      .toMatchObject({ background: 0, borderRadius: 0 });
  });
  it('keeps content columns and content-image fit alongside U1 decorations', () => {
    for (const imageFit of ['contain', 'cover', 'fill'] as const) {
      const input = { ui: { version: 1, pages: { gallery: { id: 'rows', type: 'content', source: 'gallery-cgs', frame: node.frame,
        style: { columns: 2, borderRadius: 8 }, children: [{ id: 'art', type: 'image', asset: 'art', frame: { x: 0, y: 0, width: 50, height: 50 },
          style: { imageFit, backgroundImage: { asset: 'paper', fit: 'stretch' } } }],
      } } } };
      const document = readProjectUi(input)!;
      expect(document.pages.gallery!.style).toEqual({ columns: 2, borderRadius: 8 });
      expect(document.pages.gallery!.children![0]!.style).toEqual({ imageFit, backgroundImage: { asset: 'paper', fit: 'stretch' } });
      expect(projectUiAssetKeys(document)).toEqual(['art', 'paper']);
    }
  });
  it('slices source pixels exactly and uniformly shrinks borders for small target boxes', () => {
    const patches = projectUiNineSlice({ width: 100, height: 80 }, node.frame, slice);
    expect(patches).toHaveLength(9);
    expect(patches[4]).toEqual({ source: { x: 40, y: 10, width: 40, height: 40 }, target: { x: 40, y: 10, width: 140, height: 60 } });
    const small = projectUiNineSlice({ width: 100, height: 80 }, { x: 5, y: 7, width: 30, height: 20 }, { ...slice, fillCenter: false });
    expect(small).toHaveLength(8);
    expect(small[0]!.target).toEqual({ x: 5, y: 7, width: 20, height: 5 });
    for (const patch of small) { expect(patch.target.width).toBeGreaterThanOrEqual(0); expect(patch.target.height).toBeGreaterThanOrEqual(0); }
    expect(() => projectUiNineSlice({ width: 60, height: 80 }, node.frame, slice)).toThrow('原图尺寸');
  });
});
