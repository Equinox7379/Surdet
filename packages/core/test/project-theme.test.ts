import { describe, expect, it } from 'vitest';
import { resolvePlayerTheme, resolveProjectTheme } from '../src/project-theme.js';
import { DEFAULT_PRESENTATION_THEME } from '../src/theme-tokens.js';

describe('project theme resolution', () => {
  it('preserves all default values when omitted and merges explicit fields without losing project fields', () => {
    expect(resolvePlayerTheme({})).toEqual(DEFAULT_PRESENTATION_THEME);
    const theme = resolvePlayerTheme({ theme: { colors: { accent: 0x123456, text: 0xffffff }, dialogSkin: 'paper', dialogMarginBottom: 32 } },
      { colors: { accent: 0x654321 }, skins: { dialogSkin: '' } });
    expect(theme.colors.accent).toBe(0x654321);
    expect(theme.colors.text).toBe(0xffffff);
    expect(theme.skins.dialogSkin).toBe('');
    expect(theme.layout.dialogMarginBottom).toBe(32);
    expect(Object.isFrozen(theme.colors)).toBe(true);
  });

  it.each([{ opacity: { panel: 2 } }, { colors: { unknown: 1 } }, { dialogMarginBottom: -1 }, { dialogHeightRatio: 0 }, { dialogHeightRatio: 1.1 }])('rejects invalid project settings %j', theme => {
    expect(() => resolveProjectTheme({ theme })).toThrow();
  });

  it('preserves explicit empty resources and null layout resets', () => {
    expect(resolvePlayerTheme({ theme: { dialogSkin: '', buttonSkin: null, dialogMarginX: null } }).skins).toEqual({ dialogSkin: '', buttonSkin: '' });
    expect(resolvePlayerTheme({ theme: { dialogMarginX: 90 } }, { layout: { dialogMarginX: null } }).layout.dialogMarginX).toBeNull();
  });
});
