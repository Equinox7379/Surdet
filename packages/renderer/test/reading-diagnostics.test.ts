import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fontTextDiagnostics, readFontCoverage, isUiTextClipped } from '../src/reading-diagnostics.js';

describe('actual UI text clipping', () => {
  const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right-left, height: bottom-top });
  function element(textRect: ReturnType<typeof rect>, scroll = false) {
    const root = { parentElement: null, getBoundingClientRect: () => rect(0,0,1280,720), overflowX:'hidden', overflowY:'hidden' };
    const parent = scroll ? { parentElement: root, getBoundingClientRect: () => rect(100,100,800,200), overflowX:'auto', overflowY:'auto' } : root;
    return { root, node: { parentElement: parent, ownerDocument: { createRange: () => ({ selectNodeContents: () => {}, getClientRects: () => [textRect] }) } } };
  }
  it('warns on cropped glyphs, not unused node width or scroll-reachable text', () => {
    vi.stubGlobal('getComputedStyle', (node: unknown) => node);
    try {
      const outside = element(rect(1190,100,1598,128));
      expect(isUiTextClipped(outside.node as unknown as HTMLElement, outside.root as unknown as HTMLElement)).toBe(true);
      const visible = element(rect(1190,100,1240,128));
      expect(isUiTextClipped(visible.node as unknown as HTMLElement, visible.root as unknown as HTMLElement)).toBe(false);
      const scrolled = element(rect(100,800,600,840), true);
      expect(isUiTextClipped(scrolled.node as unknown as HTMLElement, scrolled.root as unknown as HTMLElement)).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('configured-font coverage', () => {
  it.each(['NotoSerifSC-Variable.ttf', 'MiSans-Regular.otf'])('reads a real supported font: %s', async name => {
    const coverage = await readFontCoverage(readFileSync(new URL(`../../../examples/starter/content/assets/fonts/${name}`, import.meta.url)));
    expect(coverage.error).toBeUndefined();
    expect(coverage.characters?.has('海'.codePointAt(0)!)).toBe(true);
    if (name === 'MiSans-Regular.otf') expect(fontTextDiagnostics(coverage, 'body', name, '𠮷🐳', 'dialogue')[0])
      .toMatchObject({ code: 'FONT_MISSING_GLYPHS', missingCharacters: '𠮷🐳' });
    expect(fontTextDiagnostics(coverage, 'body', name, '海A\n\u{10ffff}', 'dialogue')).toEqual([
      expect.objectContaining({ code: 'FONT_MISSING_GLYPHS', missingCharacters: '\u{10ffff}', target: 'dialogue' }),
    ]);
  });
  it('does not certify system fonts or unreadable coverage, and ignores invisible formatting controls', async () => {
    expect(fontTextDiagnostics(undefined, 'body', 'fallback', '海', 'dialogue')[0]?.code).toBe('FONT_COVERAGE_UNAVAILABLE');
    const broken = await readFontCoverage(new Uint8Array([1, 2, 3]));
    expect(broken.characters).toBeNull(); expect(broken.error).toBeTruthy();
    expect(fontTextDiagnostics(broken, 'body', 'loaded', '海', 'speaker')[0]?.code).toBe('FONT_COVERAGE_UNAVAILABLE');
    expect(fontTextDiagnostics({ characters: new Set([0x61]) }, 'body', 'test', 'a\n\t\u200d\ufe0f', 'dialogue')).toEqual([]);
  });
});
