import { describe, expect, it } from 'vitest';
import { projectUiChildrenRect, projectUiRect, projectUiVariableNames, readProjectUi } from '../src/project-ui.js';

const text = { id: 'value', type: 'text', frame: { x: 640, y: 360, width: 240, height: 40, anchorX: 0.5, anchorY: 0.5 }, text: { kind: 'variable', name: 'trust' } };
const config = { variables: { trust: { type: 'number', initial: 3 }, readonlyFlag: { type: 'flag', initial: false, readonly: true } } };

describe('declarative project UI', () => {
  it('reads conditional HUD, readonly progress and array displays from declared variables', () => {
    const frame = { x: 0, y: 0, width: 200, height: 40 };
    const variables = { ...config.variables, energy: { type: 'number', initial: 5, min: 0, max: 10, readonly: true }, panelOpen: { type: 'flag', initial: false }, bag: { type: 'string[]', initial: ['车票'] } };
    const children = [
      { id: 'energy', type: 'progress', frame, binding: { kind: 'variable', name: 'energy' } },
      { id: 'items', type: 'text', frame, visibleWhen: 'panelOpen && trust >= 2', text: { kind: 'variable', name: 'bag', format: 'list' } },
      { id: 'count', type: 'text', frame, text: { kind: 'variable', name: 'bag', format: 'count' } },
      { id: 'open', type: 'button', frame, enabledWhen: 'trust > 0', action: { kind: 'variable-set', name: 'panelOpen', value: true } },
    ];
    const ui = { version: 1, pages: { hud: { id: 'hud', type: 'container', frame, children } } };
    expect(readProjectUi({ variables, ui })).toEqual(ui);
    expect(projectUiVariableNames(ui as Parameters<typeof projectUiVariableNames>[0])).toEqual(expect.arrayContaining(['energy', 'panelOpen', 'trust', 'bag']));
    const check = (node: Record<string, unknown>) => readProjectUi({ variables, ui: { version: 1, pages: { hud: { ...ui.pages.hud, children: [node] } } } });
    expect(() => check({ ...children[1], visibleWhen: 'ghost' })).toThrow('未声明');
    expect(() => check({ ...children[1], visibleWhen: '__proto__' })).toThrow('未声明');
    expect(() => check({ ...children[1], visibleWhen: 'trust' })).toThrow('boolean');
    expect(() => check({ ...children[1], visibleWhen: 'panelOpen > 0' })).toThrow('number');
    expect(() => check({ ...children[2], text: { kind: 'variable', name: 'trust', format: 'count' } })).toThrow('数组');
    expect(() => check({ ...children[0], binding: { kind: 'variable', name: 'panelOpen' } })).toThrow('数值');
    expect(() => check({ ...children[3], action: { kind: 'variable-set', name: 'energy', value: 3 } })).toThrow('只读');
    expect(() => check({ ...children[3], action: { kind: 'variable-set', name: 'panelOpen', value: 'true' } })).toThrow('类型');
    expect(() => check({ ...children[3], action: { kind: 'variable-set', name: 'trust', value: Infinity } })).toThrow('类型');
    expect(() => readProjectUi({ variables, ui: { version: 1, pages: { title: children[3] } } })).toThrow('阅读页面');
    expect(() => readProjectUi({ variables: { ...variables, energy: { ...variables.energy, max: 0 } }, ui })).toThrow('递增');
  });

  it('projects ending-book content and progress only on the gallery page', () => {
    const frame = { x: 0, y: 0, width: 640, height: 200 };
    const page = { id: 'endings', type: 'container', frame, children: [
      { id: 'progress', type: 'text', frame, text: { kind: 'data', field: 'ending-progress' } },
      { id: 'entries', type: 'content', frame, source: 'gallery-endings' },
    ] };
    const ui = { version: 1, pages: { gallery: page } };
    expect(readProjectUi({ ui })).toEqual(ui);
    expect(() => readProjectUi({ ui: { version: 1, pages: { title: page } } })).toThrow();
  });
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
