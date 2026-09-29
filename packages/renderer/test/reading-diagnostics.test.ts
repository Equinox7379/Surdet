import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fontTextDiagnostics, readFontCoverage } from '../src/reading-diagnostics.js';

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
