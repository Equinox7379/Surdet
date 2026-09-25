import { describe, expect, it } from 'vitest';
import { resolveProjectFontPaths } from '../src/project-fonts.js';

describe('project font roles', () => {
  it('resolves default, legacy, partial and explicitly cleared role maps', () => {
    expect(resolveProjectFontPaths({})).toEqual({});
    expect(resolveProjectFontPaths({ font: 'fonts/old.ttf' })).toEqual({ body: 'fonts/old.ttf', title: 'fonts/old.ttf', ui: 'fonts/old.ttf' });
    expect(resolveProjectFontPaths({ font: 'fonts/old.ttf', fonts: { body: '字体.TTF', title: '', unknown: true } })).toEqual({ body: '字体.TTF' });
    expect(resolveProjectFontPaths({ font: 'fonts/old.ttf', fonts: {} })).toEqual({});
  });
  it('reports malformed active settings without inventing a fallback configuration', () => {
    expect(() => resolveProjectFontPaths({ fonts: [] })).toThrow('fonts');
    expect(() => resolveProjectFontPaths({ fonts: { ui: 1 } })).toThrow('fonts.ui');
    expect(() => resolveProjectFontPaths({ font: false })).toThrow('.font');
  });
});
