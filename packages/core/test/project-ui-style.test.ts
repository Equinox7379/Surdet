import { describe, expect, it } from 'vitest';
import { readProjectUi, projectUiAssetKeys, projectUiChildrenRect, type ProjectUiNode } from '../src/project-ui.js';
import { projectUiNineSlice, resolveProjectUiInteractionStyle, resolveProjectUiMotion, resolveProjectUiStyle,
  validateProjectUiStates, validateProjectUiTransitions, type ProjectUiMotion, type ProjectUiStates, type ProjectUiStyle } from '../src/project-ui-style.js';

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
      expect(resolveProjectUiStyle(document.pages.gallery!, input)).toMatchObject({ columns: 2 });
      expect(resolveProjectUiStyle(document.pages.gallery!.children![0]!, input)).toMatchObject({ imageFit });
      expect(projectUiAssetKeys(document)).toEqual(['art', 'paper']);
    }
  });
  it('reports the existing single-column and contain defaults when layout fields are omitted', () => {
    expect(resolveProjectUiStyle({ ...node, type: 'content', source: 'gallery-cgs' }, {})).toMatchObject({ columns: 1 });
    expect(resolveProjectUiStyle({ ...node, type: 'image', asset: 'art' }, {})).toMatchObject({ imageFit: 'contain' });
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

describe('U2 interaction and page motion contract', () => {
  const readNode = (value: unknown) => readProjectUi({ ui: { version: 1, pages: { title: value } } });

  it('keeps old documents and effective styles unchanged when interaction fields are absent', () => {
    const input = config(style);
    expect(readProjectUi(input)).toEqual(input.ui);
    expect(input.ui.pages.title).not.toHaveProperty('states');
    expect(input.ui.pages.title).not.toHaveProperty('transition');
    const project = { theme: { colors: { text: 123 }, buttonSkin: 'paper' } };
    for (const current of [node, { ...node, style }]) {
      const normal = resolveProjectUiStyle(current, project, { colors: { text: 456 } });
      expect(resolveProjectUiInteractionStyle(current, project, {}, { colors: { text: 456 } })).toEqual(normal);
      expect(resolveProjectUiInteractionStyle(current, project, { hovered: true, focused: true, pressed: true }, { colors: { text: 456 } })).toEqual(normal);
      expect(resolveProjectUiInteractionStyle(current, project, { disabled: true }, { colors: { text: 456 } }))
        .toEqual({ ...normal, opacity: normal.opacity * 0.45 });
    }
    expect(resolveProjectUiMotion(node, 'enter', false)).toBeNull();
    expect(projectUiAssetKeys(null)).toEqual([]);
  });

  it('overlays base, hover, focus and pressed in that order without changing the node', () => {
    const current: ProjectUiNode = { ...node, style: { color: 1, background: 2, opacity: 0.8, fontSize: 24 }, states: {
      hover: { color: 3, backgroundOpacity: 0.5 }, focus: { color: 4, background: 5 }, pressed: { color: 6, opacity: 0.6 },
    } };
    const original = structuredClone(current);
    expect(resolveProjectUiInteractionStyle(current, {}, {})).toMatchObject({ color: 1, background: 2, opacity: 0.8 });
    expect(resolveProjectUiInteractionStyle(current, {}, { hovered: true })).toMatchObject({ color: 3, background: 2, backgroundOpacity: 0.5 });
    expect(resolveProjectUiInteractionStyle(current, {}, { hovered: true, focused: true })).toMatchObject({ color: 4, background: 5, opacity: 0.8, backgroundOpacity: 0.5 });
    expect(resolveProjectUiInteractionStyle(current, {}, { hovered: true, focused: true, pressed: true }))
      .toMatchObject({ color: 6, background: 5, opacity: 0.6, backgroundOpacity: 0.5, fontSize: 24 });
    expect(current).toEqual(original);
  });

  it('skips hover and pressed while disabled, keeps focus, then applies disabled opacity once', () => {
    const current: ProjectUiNode = { ...node, style: { color: 1, background: 2, opacity: 0.8, backgroundOpacity: 1 }, states: {
      hover: { background: 3, backgroundOpacity: 0.3 }, focus: { color: 4, opacity: 0.6 },
      pressed: { color: 5, backgroundOpacity: 0.2 }, disabled: { color: 6 },
    } };
    const interaction = { hovered: true, focused: true, pressed: true, disabled: true };
    expect(resolveProjectUiInteractionStyle(current, {}, interaction))
      .toMatchObject({ color: 6, background: 2, opacity: 0.6 * 0.45, backgroundOpacity: 1 });
    expect(resolveProjectUiInteractionStyle({ ...current, states: { ...current.states, disabled: { opacity: 0.4 } } }, {}, interaction))
      .toMatchObject({ color: 4, opacity: 0.4 * 0.45 });
    expect(resolveProjectUiInteractionStyle({ ...current, states: { focus: { color: 4 } } }, {}, interaction))
      .toMatchObject({ color: 4, opacity: 0.8 * 0.45 });
    expect(resolveProjectUiInteractionStyle(node, {}, { disabled: true }).opacity).toBe(0.45);
  });

  it('preserves zero and U1 clearing semantics over theme skins and authored decorations', () => {
    const current: ProjectUiNode = { ...node, style: { ...style, opacity: 0.8 }, states: { hover: {
      color: 0, background: 0, opacity: 0, backgroundOpacity: 0, backgroundGradient: null, backgroundImage: null, textShadows: [], shadows: [],
    } } };
    expect(readNode(current)?.pages.title?.states).toEqual(current.states);
    const project = { theme: { buttonSkin: 'paper' } };
    expect(resolveProjectUiInteractionStyle(current, project, { hovered: true })).toMatchObject({
      color: 0, background: 0, opacity: 0, backgroundOpacity: 0, backgroundGradient: null, backgroundImage: null, textShadows: [], shadows: [],
    });
    expect(resolveProjectUiInteractionStyle({ ...node, states: current.states }, project, { hovered: true }).backgroundImage).toBeNull();
    expect(resolveProjectUiInteractionStyle({ ...node, states: { disabled: { opacity: 0 } } }, {}, { disabled: true }).opacity).toBe(0);
  });

  it('accepts states on all four interactive controls and exports reusable validation', () => {
    const states: ProjectUiStates = { hover: { backgroundImage: style.backgroundImage }, focus: { textShadows: style.textShadows },
      pressed: { backgroundGradient: style.backgroundGradient }, disabled: { shadows: style.textShadows } };
    expect(() => validateProjectUiStates(states, 'states')).not.toThrow();
    const variables = { flag: { type: 'flag', initial: false }, count: { type: 'number', initial: 0 }, name: { type: 'string', initial: '' } };
    for (const [type, name] of [['button', undefined], ['toggle', 'flag'], ['slider', 'count'], ['input', 'name']] as const) {
      const current = { ...node, type, states, ...(name ? { binding: { kind: 'variable', name } } : {}) };
      expect(readProjectUi({ variables, ui: { version: 1, pages: { title: current } } })?.pages.title?.states).toEqual(states);
    }
  });

  it('rejects state styles that alter layout, typography, behavior, expressions or arbitrary CSS', () => {
    const forbidden = { fontSize: 20, align: 'center', fontRole: 'title', fontWeight: 700, lineHeight: 1.5, letterSpacing: 1,
      border: null, borderRadius: 4, padding: { top: 0, right: 0, bottom: 0, left: 0 }, columns: 2, imageFit: 'cover',
      frame: node.frame, action: { kind: 'start' }, visibleWhen: 'true', enabledWhen: 'true', transform: 'scale(2)', css: 'outline:none' };
    for (const [key, value] of Object.entries(forbidden)) {
      expect(() => readNode({ ...node, states: { hover: { [key]: value } } })).toThrow(`states.hover.${key}`);
    }
    for (const states of [null, [], { normal: {} }, { hover: null }, { focus: [] }, { pressed: 'red' }, { disabled: null }]) {
      expect(() => readNode({ ...node, states })).toThrow('states');
    }
  });

  it('reuses U1 field bounds and nested validation for every interaction state', () => {
    const invalidStyles = [
      { color: -1 }, { color: 0x1000000 }, { background: 0.5 }, { opacity: null }, { opacity: NaN }, { opacity: 1.1 },
      { backgroundOpacity: -0.1 }, { backgroundOpacity: Infinity }, { textShadows: null }, { shadows: Array(5).fill(style.textShadows![0]) },
      { shadows: [{ ...style.textShadows![0], css: 'none' }] }, { textShadows: [{ ...style.textShadows![0], blur: 257 }] },
      { backgroundGradient: { from: 0, to: 0, angle: 361 } }, { backgroundGradient: { from: 0, to: 0, angle: 0, stops: [] } },
      { backgroundImage: { asset: 'https://example.com/x', fit: 'stretch' } },
      { backgroundImage: { asset: 'paper', fit: 'cover', slice } },
      { backgroundImage: { asset: 'paper', fit: 'stretch', slice: { ...slice, top: 0.5 } } },
    ];
    for (const state of ['hover', 'focus', 'pressed', 'disabled']) for (const invalid of invalidStyles) {
      expect(() => readNode({ ...node, states: { [state]: invalid } })).toThrow(`states.${state}`);
    }
  });

  it('rejects states on noninteractive nodes, including empty state maps', () => {
    for (const current of [
      { type: 'container' }, { type: 'image', asset: 'art' }, { type: 'text' }, { type: 'scroll' }, { type: 'tabs' },
      { type: 'progress', binding: { kind: 'variable', name: 'count' } }, { type: 'content', source: 'gallery-cgs' },
    ]) for (const states of [{}, { focus: { color: 0 } }]) {
      expect(() => readProjectUi({ variables: { count: { type: 'number', initial: 0 } },
        ui: { version: 1, pages: { gallery: { ...node, ...current, states } } } })).toThrow('states');
    }
  });

  it('collects background images from every state, including inactive descendants, without duplicates', () => {
    const current: ProjectUiNode = { id: 'root', type: 'container', frame: node.frame, children: [
      { ...node, style: { backgroundImage: { asset: 'paper', fit: 'stretch' } }, states: {
        hover: { backgroundImage: { asset: 'hover', fit: 'contain' } }, focus: { backgroundImage: { asset: 'focus', fit: 'cover' } },
        pressed: { backgroundImage: { asset: 'paper', fit: 'stretch' } }, disabled: { backgroundImage: { asset: 'disabled', fit: 'stretch', slice } },
      } },
      { id: 'nested', type: 'container', frame: node.frame, children: [
        { ...node, id: 'deep', states: { pressed: { backgroundImage: { asset: 'pressed', fit: 'stretch' } }, hover: { backgroundImage: null } } },
        { id: 'art', type: 'image', asset: 'art', frame: node.frame },
      ] },
    ] };
    expect(projectUiAssetKeys(readNode(current))).toEqual(['paper', 'hover', 'focus', 'disabled', 'pressed', 'art']);
  });

  it('accepts transitions on page roots and preserves their stored representation', () => {
    const enter: ProjectUiMotion = { durationMs: 1000, opacity: 0, x: -128, y: 128, scale: 0.8, easing: 'linear' };
    const exit: ProjectUiMotion = { durationMs: 0, opacity: 1, x: 128, y: -128, scale: 1.2, easing: 'ease-in-out' };
    const transition = { enter, exit };
    expect(() => validateProjectUiTransitions(transition, 'transition')).not.toThrow();
    expect(() => validateProjectUiTransitions({ enter: { durationMs: 0.5, easing: 'ease-out' } }, 'transition')).not.toThrow();
    const current: ProjectUiNode = { ...node, transition };
    expect(readNode(current)?.pages.title).toEqual(current);
    expect(readNode({ id: 'root', type: 'container', frame: node.frame, transition: {} })?.pages.title?.transition).toEqual({});
  });

  it('rejects transitions on children at every depth even when IDs look like roots', () => {
    for (const transition of [{}, { enter: { durationMs: 100 } }, { exit: { durationMs: 100 } }]) {
      const child = { ...node, id: 'title', transition };
      const nested = { id: 'nested', type: 'container', frame: node.frame, children: [child] };
      for (const children of [[child], [nested]]) {
        expect(() => readNode({ id: 'root', type: 'container', frame: node.frame, children })).toThrow(/transition.*根节点/);
      }
    }
  });

  it('rejects malformed motion, unsupported keys, null storage and values outside finite bounds', () => {
    const invalidMotions = [null, [], {}, { durationMs: -1 }, { durationMs: 1001 }, { durationMs: Infinity }, { durationMs: '100' },
      { durationMs: null }, { durationMs: 1, opacity: -0.01 }, { durationMs: 1, opacity: 1.01 }, { durationMs: 1, opacity: null },
      { durationMs: 1, x: -129 }, { durationMs: 1, x: 129 }, { durationMs: 1, y: -129 }, { durationMs: 1, y: 129 },
      { durationMs: 1, x: NaN }, { durationMs: 1, y: Infinity }, { durationMs: 1, scale: 0.79 }, { durationMs: 1, scale: 1.21 },
      { durationMs: 1, easing: 'ease-in' }, { durationMs: 1, easing: null }, { durationMs: 1, action: { kind: 'close' } },
      { durationMs: 1, css: 'translateX(1px)' }];
    for (const direction of ['enter', 'exit']) for (const motion of invalidMotions) {
      expect(() => readNode({ ...node, transition: { [direction]: motion } })).toThrow(`transition.${direction}`);
    }
    for (const transition of [null, [], { normal: { durationMs: 1 } }, { durationMs: 1 }]) {
      expect(() => readNode({ ...node, transition })).toThrow('transition');
    }
  });

  it('resolves each direction to a fresh complete motion without storing defaults', () => {
    const current: ProjectUiNode = { ...node, transition: {
      enter: { durationMs: 200 }, exit: { durationMs: 300, opacity: 0, x: -128, y: 128, scale: 0.8, easing: 'ease-in-out' },
    } };
    const original = structuredClone(current);
    const enter = resolveProjectUiMotion(current, 'enter', false);
    expect(enter).toEqual({ durationMs: 200, opacity: 1, x: 0, y: 0, scale: 1, easing: 'ease-out' });
    expect(resolveProjectUiMotion(current, 'exit', false)).toEqual(current.transition!.exit);
    expect(resolveProjectUiMotion(current, 'exit', false)).not.toBe(current.transition!.exit);
    expect(resolveProjectUiMotion(current, 'enter', false)).not.toBe(enter);
    if (enter) enter.x = 64;
    expect(current).toEqual(original);
    expect(resolveProjectUiMotion({ ...node, transition: { enter: { durationMs: 1, opacity: 0, x: 0, y: 0, scale: 1, easing: 'linear' } } }, 'enter', false))
      .toEqual({ durationMs: 1, opacity: 0, x: 0, y: 0, scale: 1, easing: 'linear' });
  });

  it('treats missing directions, reduced motion and zero duration as static', () => {
    expect(resolveProjectUiMotion({ ...node, transition: {} }, 'enter', false)).toBeNull();
    for (const direction of ['enter', 'exit'] as const) {
      const current: ProjectUiNode = { ...node, transition: { [direction]: { durationMs: 200, opacity: 0, x: 20 } } };
      expect(resolveProjectUiMotion(current, direction, true)).toBeNull();
      expect(resolveProjectUiMotion(current, direction === 'enter' ? 'exit' : 'enter', false)).toBeNull();
      expect(resolveProjectUiMotion({ ...current, transition: { [direction]: { durationMs: 0, opacity: 0, x: 20 } } }, direction, false)).toBeNull();
    }
  });
});
