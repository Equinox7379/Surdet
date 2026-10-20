import { describe, expect, it } from 'vitest';
import { validateProjectUiStates, validateProjectUiStyle, validateProjectUiTransitions, type ProjectUiStyle } from '@surdet/core';
import { UI_MOTION_DEFAULTS, effectiveUiStyle, inheritStyleKey, isExplicitClear, isUiStateNode, setStyleKey, uiStateFields, uiStyleFields, withUiMotion, withUiState } from '../src/ui-style-form.js';

const BOX = ['background', 'backgroundOpacity', 'backgroundGradient', 'backgroundImage', 'border', 'borderRadius', 'padding', 'shadows', 'opacity'];
const TEXT = ['fontRole', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'align', 'textShadows'];

describe('U1 style form offers only what a node draws', () => {
  it('gives text and buttons every field, containers and pictures only the box', () => {
    for (const type of ['text', 'button'] as const) expect([...uiStyleFields({ type })].sort()).toEqual([...TEXT, ...BOX].sort());
    for (const type of ['container', 'image', 'progress', 'toggle', 'slider'] as const) expect([...uiStyleFields({ type })].sort()).toEqual([...BOX].sort());
  });

  it('leaves out line box and alignment on text fields, and colour/weight on built-in content rows', () => {
    const input = uiStyleFields({ type: 'input' });
    expect(input.has('lineHeight')).toBe(false);
    expect(input.has('align')).toBe(false);
    expect(input.has('color')).toBe(true);
    const content = uiStyleFields({ type: 'content' });
    expect(content.has('fontSize')).toBe(true);
    expect(content.has('color')).toBe(false);
    expect(content.has('fontWeight')).toBe(false);
    // A row template draws its own text, so the list itself is only a box.
    expect([...uiStyleFields({ type: 'content', children: [{ id: 'row', type: 'text', frame: { x: 0, y: 0, width: 10, height: 10 } }] as never })].sort()).toEqual([...BOX].sort());
  });
});

describe('U1 style form writes the whole style', () => {
  const style: ProjectUiStyle = { fontSize: 24, borderRadius: 8, shadows: [] };

  it('keeps every other key when one field changes', () => {
    const next = setStyleKey(style, 'borderRadius', 22);
    expect(next).toEqual({ fontSize: 24, borderRadius: 22, shadows: [] });
    expect(style.borderRadius).toBe(8);
    expect(() => validateProjectUiStyle(next, 'style')).not.toThrow();
  });

  it('restores inheritance by removing the key, and sends null once nothing is left', () => {
    expect(inheritStyleKey(style, 'borderRadius')).toEqual({ fontSize: 24, shadows: [] });
    expect(inheritStyleKey({ fontSize: 24 }, 'fontSize')).toBeNull();
    expect(inheritStyleKey(undefined, 'fontSize')).toBeNull();
  });
  it('preserves the existing layout fields when changing or clearing a U1 field', () => {
    for (const layout of [{ columns: 2 as const }, { imageFit: 'cover' as const }]) {
      const changed = setStyleKey(layout, 'borderRadius', 8);
      expect(changed).toEqual({ ...layout, borderRadius: 8 });
      expect(inheritStyleKey(changed, 'borderRadius')).toEqual(layout);
      expect(() => validateProjectUiStyle(changed, 'style')).not.toThrow();
    }
  });

  it('tells explicit clears apart from inherited values', () => {
    expect(isExplicitClear(style, 'shadows')).toBe(true);
    expect(isExplicitClear({ border: null }, 'border')).toBe(true);
    expect(isExplicitClear({ padding: { top: 0, right: 0, bottom: 0, left: 0 } }, 'padding')).toBe(true);
    expect(isExplicitClear(style, 'fontSize')).toBe(false);
    expect(isExplicitClear(undefined, 'border')).toBe(false);
  });

  it('produces nine-slice skins Core accepts', () => {
    const skin = setStyleKey({}, 'backgroundImage', { asset: 'u1-frame', fit: 'stretch', slice: { top: 24, right: 24, bottom: 24, left: 24, fillCenter: true } });
    expect(() => validateProjectUiStyle(skin, 'style')).not.toThrow();
    expect(() => validateProjectUiStyle(setStyleKey(skin, 'backgroundImage', null), 'style')).not.toThrow();
  });
});

describe('U1 style form shows the values the Player draws', () => {
  const progress = (style?: ProjectUiStyle) => ({ id: 'hp', type: 'progress', frame: { x: 0, y: 0, width: 200, height: 20 }, binding: { kind: 'variable', name: 'hp' }, ...(style ? { style } : {}) }) as never;
  const config = { theme: { colors: { surface: 0x123456 }, radius: { sm: 5 } } };

  it('inherits the legacy progress track (theme surface, small radius) when the box sets neither', () => {
    const effective = effectiveUiStyle(progress({ border: { width: 1, color: 0x445566, opacity: 1 } }), config);
    expect(effective.background).toBe(0x123456);
    expect(effective.borderRadius).toBe(5);
    expect(effective.border).toEqual({ width: 1, color: 0x445566, opacity: 1 });
  });

  it('keeps the author track, including an explicit radius of 0', () => {
    const effective = effectiveUiStyle(progress({ background: 0xffffff, borderRadius: 0 }), config);
    expect(effective.background).toBe(0xffffff);
    expect(effective.borderRadius).toBe(0);
  });
});

describe('U2 state form edits only what a state may change', () => {
  it('offers the state keys a control draws, never frame, border, radius, padding or typography', () => {
    expect([...uiStateFields({ type: 'button' })].sort()).toEqual(['background', 'backgroundGradient', 'backgroundImage', 'backgroundOpacity', 'color', 'opacity', 'shadows', 'textShadows']);
    expect([...uiStateFields({ type: 'input' })].sort()).toEqual(['background', 'backgroundGradient', 'backgroundImage', 'backgroundOpacity', 'color', 'opacity', 'shadows', 'textShadows']);
    for (const type of ['toggle', 'slider'] as const) expect([...uiStateFields({ type })].sort()).toEqual(['background', 'backgroundGradient', 'backgroundImage', 'backgroundOpacity', 'opacity', 'shadows']);
    expect(['button', 'toggle', 'slider', 'input'].every(type => isUiStateNode({ type: type as 'button' }))).toBe(true);
    expect(['container', 'text', 'image', 'progress', 'scroll', 'tabs', 'content'].some(type => isUiStateNode({ type: type as 'text' }))).toBe(false);
  });

  it('writes the whole states object, keeps the other states, drops an emptied one and sends null when none is left', () => {
    const states = { hover: { background: 0x0000ff }, disabled: { opacity: 0.8 } };
    const next = withUiState(states, 'pressed', setStyleKey(undefined, 'background', 0xff0000));
    expect(next).toEqual({ hover: { background: 0x0000ff }, pressed: { background: 0xff0000 }, disabled: { opacity: 0.8 } });
    expect(Object.keys(next!)).toEqual(['hover', 'pressed', 'disabled']);
    expect(states).toEqual({ hover: { background: 0x0000ff }, disabled: { opacity: 0.8 } });
    expect(() => validateProjectUiStates(next, 'states')).not.toThrow();
    expect(withUiState(next!, 'pressed', inheritStyleKey(next!.pressed, 'background'))).toEqual(states);
    expect(withUiState({ hover: { background: 1 } }, 'hover', null)).toBeNull();
    expect(withUiState(undefined, 'focus', {})).toBeNull();
    // Explicit clears inside a state stay what they are (null image, no shadows) and Core accepts them.
    const cleared = withUiState(undefined, 'hover', { backgroundImage: null, shadows: [], backgroundGradient: null });
    expect(cleared).toEqual({ hover: { backgroundImage: null, shadows: [], backgroundGradient: null } });
    expect(() => validateProjectUiStates(cleared, 'states')).not.toThrow();
  });
});

describe('U2 page motion writes the whole transition', () => {
  it('starts each direction from defaults Core accepts and keeps the other direction', () => {
    expect(() => validateProjectUiTransitions({ ...UI_MOTION_DEFAULTS }, 'transition')).not.toThrow();
    const enter = withUiMotion(undefined, 'enter', { ...UI_MOTION_DEFAULTS.enter });
    expect(enter).toEqual({ enter: UI_MOTION_DEFAULTS.enter });
    const both = withUiMotion(enter!, 'exit', { durationMs: 300, scale: 0.9, easing: 'linear' });
    expect(both).toEqual({ enter: UI_MOTION_DEFAULTS.enter, exit: { durationMs: 300, scale: 0.9, easing: 'linear' } });
    expect(() => validateProjectUiTransitions(both, 'transition')).not.toThrow();
    expect(withUiMotion(both!, 'enter', null)).toEqual({ exit: { durationMs: 300, scale: 0.9, easing: 'linear' } });
    expect(withUiMotion({ exit: { durationMs: 1 } }, 'exit', null)).toBeNull();
  });
});
