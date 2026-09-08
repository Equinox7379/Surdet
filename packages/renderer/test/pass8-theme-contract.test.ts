import { describe, expect, it } from 'vitest';
import { createRendererTheme, DEFAULT_RENDERER_THEME } from '../src/theme.js';

function luminance(hex: number): number {
  const channels = [hex >> 16 & 255, hex >> 8 & 255, hex & 255].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
function contrast(first: number, second: number): number {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('Frontend Pass 8 default player theme retains the public theme contract', () => {
  it('keeps exactly the existing public groups', () => {
    expect(Object.keys(DEFAULT_RENDERER_THEME).sort())
      .toEqual(['colors', 'opacity', 'radius', 'spacing', 'typography'].sort());
  });
  it('freezes the default and its nested groups', () => {
    expect(Object.isFrozen(DEFAULT_RENDERER_THEME)).toBe(true);
    for (const group of Object.values(DEFAULT_RENDERER_THEME)) expect(Object.isFrozen(group)).toBe(true);
  });
  it('preserves a project-specific color rather than forcing the default palette', () => {
    const theme = createRendererTheme({ colors: { accent: 0xDA9146 } });
    expect(theme.colors.accent).toBe(0xDA9146);
    expect(theme.colors.panel).toBe(DEFAULT_RENDERER_THEME.colors.panel);
    expect(DEFAULT_RENDERER_THEME.colors.accent).not.toBe(0xDA9146);
  });
  it('keeps project typography, opacity and radius overrides', () => {
    const theme = createRendererTheme({
      typography: { bodySize: 36, uiLetterSpacing: 2 },
      opacity: { panel: 0.8 },
      radius: { md: 9 },
    });
    expect(theme.typography.bodySize).toBe(36);
    expect(theme.typography.uiLetterSpacing).toBe(2);
    expect(theme.typography.captionSize).toBe(DEFAULT_RENDERER_THEME.typography.captionSize);
    expect(theme.opacity.panel).toBe(0.8);
    expect(theme.radius.md).toBe(9);
  });
  it('does not mutate the supplied project overrides', () => {
    const overrides = { colors: { accent: 0x441199 }, typography: { bodySize: 31 } };
    const before = JSON.stringify(overrides);
    createRendererTheme(overrides);
    expect(JSON.stringify(overrides)).toBe(before);
  });
  it('keeps readable default body text on the default opaque surfaces', () => {
    for (const background of ['canvas', 'panel', 'surface', 'surfaceStrong'] as const) {
      expect(contrast(DEFAULT_RENDERER_THEME.colors.text, DEFAULT_RENDERER_THEME.colors[background])).toBeGreaterThanOrEqual(7);
      expect(contrast(DEFAULT_RENDERER_THEME.colors.textMuted, DEFAULT_RENDERER_THEME.colors[background])).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('keeps the primary-action label readable', () => {
    expect(contrast(DEFAULT_RENDERER_THEME.colors.textOnAccent, DEFAULT_RENDERER_THEME.colors.accent))
      .toBeGreaterThanOrEqual(7);
  });
  it('uses a practical hierarchy without oversized universal corner radii', () => {
    const t = DEFAULT_RENDERER_THEME.typography;
    expect(t.titleSize).toBeGreaterThan(t.headingSize);
    expect(t.headingSize).toBeGreaterThanOrEqual(t.bodySize);
    expect(t.bodySize).toBeGreaterThanOrEqual(t.uiSize);
    expect(t.uiSize).toBeGreaterThanOrEqual(t.captionSize);
    expect(t.captionSize).toBeGreaterThan(0);
    expect(DEFAULT_RENDERER_THEME.radius.lg).toBeLessThanOrEqual(8);
  });
  it('retains invalid-number rejection', () => {
    expect(() => createRendererTheme({ typography: { bodySize: Number.NaN } })).toThrow('RENDERER_THEME_INVALID');
    expect(() => createRendererTheme({ opacity: { panel: 2 } })).toThrow('RENDERER_THEME_INVALID');
  });
  it('does not silently accept unknown public fields', () => {
    expect(() => createRendererTheme({ colors: { unknownToken: 0 } } as never))
      .toThrow('RENDERER_THEME_INVALID');
  });
});
