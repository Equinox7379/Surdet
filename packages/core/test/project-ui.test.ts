import { describe, expect, it } from 'vitest';
import { projectUiChildrenRect, projectUiRect, readProjectUi } from '../src/project-ui.js';

const text = { id: 'value', type: 'text', frame: { x: 640, y: 360, width: 240, height: 40, anchorX: 0.5, anchorY: 0.5 }, text: { kind: 'variable', name: 'trust' } };
const config = { variables: { trust: { type: 'number', initial: 3 }, readonlyFlag: { type: 'flag', initial: false, readonly: true } } };

describe('declarative project UI', () => {
  it('exposes locale read/cycling and glossary content without arbitrary preference writes', () => {
    const frame = { x: 0, y: 0, width: 640, height: 200 };
    const ui = { version: 1, pages: { settings: { id: 'locale', type: 'button', frame,
      text: { kind: 'setting', name: 'locale' }, action: { kind: 'setting-step', name: 'locale', direction: 1 } },
      gallery: { id: 'terms', type: 'content', frame, source: 'terms' } } };
    expect(readProjectUi({ ui })).toEqual(ui);
    expect(() => readProjectUi({ ui: { version: 1, pages: { settings: { id: 'edit-locale', type: 'input', frame, binding: { kind: 'setting', name: 'locale' } } } } })).toThrow('公开调整入口');
  });
  it('uses one parent-relative anchor formula for authoring and player layouts', () => {
    expect(projectUiRect({ x: 0, y: 0, width: 1280, height: 720 }, text.frame)).toEqual({ x: 520, y: 340, width: 240, height: 40 });
    expect(projectUiRect({ x: 100, y: 50, width: 300, height: 200 }, { x: 0, y: 0, width: 80, height: 20, anchorX: 1, anchorY: 1 }))
      .toEqual({ x: 20, y: 30, width: 80, height: 20 });
    expect(projectUiChildrenRect({ x: 100, y: 50, width: 300, height: 200 }, 'tabs')).toEqual({ x: 100, y: 88, width: 300, height: 162 });
    expect(() => readProjectUi({ ui: { version: 1, pages: { gallery: { id: 'tabs', type: 'tabs', frame: { x: 0, y: 0, width: 100, height: 30 } } } } })).toThrow('页签栏');
  });
  it('accepts absent pages but rejects unknown versions, duplicate IDs and invalid bindings before use', () => {
    expect(readProjectUi(config)).toBeNull();
    const ui = { version: 1, pages: { title: { id: 'root', type: 'container', frame: { x: 0, y: 0, width: 1280, height: 720 }, children: [text] } } };
    expect(readProjectUi({ ...config, ui })).toEqual(ui);
    expect(() => readProjectUi({ ...config, ui: { ...ui, version: 2 } })).toThrow(/version/);
    expect(() => readProjectUi({ ...config, ui: { ...ui, pages: { ...ui.pages, hud: text } } })).toThrow(/重复/);
    expect(() => readProjectUi({ ...config, ui: { version: 1, pages: { hud: { ...text, binding: { kind: 'variable', name: 'readonlyFlag' } } } } })).toThrow(/binding/);
    expect(() => readProjectUi({ ...config, ui: { version: 1, pages: { hud: { ...text, frame: { x: 0, y: 0, width: -1, height: 2 } } } } })).toThrow(/尺寸/);
  });
  it('does not advertise settings edits with no actual Player setter', () => {
    const root = { ...text, type: 'slider', text: undefined, binding: { kind: 'setting', name: 'autoPerCharMs' } };
    expect(() => readProjectUi({ ui: { version: 1, pages: { settings: root } } })).toThrow('公开调整入口');
    expect(() => readProjectUi({ ui: { version: 1, pages: { settings: { ...text, type: 'button', action: { kind: 'setting-step', name: 'autoPerCharMs', direction: 1 }, text: undefined } } } })).toThrow('不受支持');
  });
});
