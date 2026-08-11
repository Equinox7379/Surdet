import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDERER_THEME,
  createRendererTheme,
  type RendererThemeOverrides,
} from '../src/theme.js';

describe('RendererTheme', () => {
  it('provides the complete immutable Surdet default token set', () => {
    expect(DEFAULT_RENDERER_THEME).toEqual({
      colors: {
        canvas: 0x080b14,
        scrim: 0x06101e,
        panel: 0x0d1526,
        surface: 0x081321,
        surfaceStrong: 0x0b1928,
        line: 0x9bc7ff,
        accent: 0x5ac8ff,
        accentSoft: 0x79d5e6,
        text: 0xf2f6ff,
        textMuted: 0xaeb9cc,
        textDisabled: 0x596274,
        textOnAccent: 0x070c17,
        danger: 0xff6b7a,
      },
      opacity: { scrim: 0.66, panel: 0.95, surface: 0.92, line: 0.52, disabled: 0.38 },
      typography: {
        titleSize: 58,
        headingSize: 34,
        bodySize: 24,
        uiSize: 20,
        captionSize: 16,
        titleLetterSpacing: 8,
        uiLetterSpacing: 4,
      },
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 },
      radius: { sm: 6, md: 10, lg: 16 },
    });
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME.colors)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME.opacity)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME.typography)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME.spacing)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME.radius)).toBe(true);
  });

  it('deep merges overrides without freezing the caller input', () => {
    const overrides: RendererThemeOverrides = {
      colors: { accent: 0x47c8ff },
      opacity: { panel: 0.8 },
      typography: { uiSize: 22 },
      spacing: { md: 18 },
      radius: { lg: 20 },
    };
    const theme = createRendererTheme(overrides);

    expect(theme.colors.accent).toBe(0x47c8ff);
    expect(theme.colors.text).toBe(DEFAULT_RENDERER_THEME.colors.text);
    expect(theme.opacity.panel).toBe(0.8);
    expect(theme.typography.uiSize).toBe(22);
    expect(theme.spacing.md).toBe(18);
    expect(theme.radius.lg).toBe(20);
    expect(Object.isFrozen(overrides)).toBe(false);
    expect(Object.isFrozen(overrides.colors)).toBe(false);
    expect(Object.isFrozen(theme.colors)).toBe(true);
  });

  it.each([
    ['unknown top-level key', { unknown: 1 }],
    ['unknown color key', { colors: { unknown: 1 } }],
    ['color below zero', { colors: { accent: -1 } }],
    ['color above 24-bit', { colors: { accent: 0x1000000 } }],
    ['color fractional', { colors: { accent: 1.5 } }],
    ['opacity below zero', { opacity: { panel: -0.1 } }],
    ['opacity above one', { opacity: { panel: 1.1 } }],
    ['opacity NaN', { opacity: { panel: Number.NaN } }],
    ['typography Infinity', { typography: { bodySize: Number.POSITIVE_INFINITY } }],
    ['spacing negative', { spacing: { md: -1 } }],
    ['radius non-number', { radius: { sm: 'round' } }],
  ] as const)('rejects %s', (_label, value) => {
    expect(() => createRendererTheme(value as never)).toThrow(/RENDERER_THEME_INVALID/);
  });

  it('does not mutate the default theme while rejecting malformed nested input', () => {
    const before = DEFAULT_RENDERER_THEME.colors.accent;
    const malformed = { colors: { accent: 0x123456 }, opacity: { panel: undefined } };

    expect(() => createRendererTheme(malformed as never)).toThrow(/RENDERER_THEME_INVALID/);
    expect(DEFAULT_RENDERER_THEME.colors.accent).toBe(before);
  });
});
