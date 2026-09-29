import type { RendererFontRole } from './api/renderer-commands.js';

export interface ReadingDiagnostic {
  code: 'TEXT_OVERFLOW' | 'TEXT_SCROLL' | 'TEXT_MEASUREMENT_UNAVAILABLE' | 'FONT_MISSING_GLYPHS' | 'FONT_COVERAGE_UNAVAILABLE';
  severity: 'info' | 'warning';
  target: string;
  message: string;
  text: string;
  missingCharacters?: string;
}

/** Coverage of the configured font itself, not the browser's OS fallback fonts. */
export interface FontCoverage {
  characters: ReadonlySet<number> | null;
  error?: string;
}

export async function readFontCoverage(bytes: Uint8Array): Promise<FontCoverage> {
  try {
    // fontkit supports TTF/OTF/WOFF/WOFF2 in browsers; no hand-written font parser.
    const { create } = await import('fontkit');
    // Its browser entry accepts Uint8Array; the community Node typings say Buffer.
    const font = create(bytes as Parameters<typeof create>[0]);
    if (!('characterSet' in font)) throw new Error('不支持未指定子字体的字体集合');
    return { characters: new Set(font.characterSet.filter(code => font.hasGlyphForCodePoint(code))) };
  } catch (error) {
    return { characters: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function fontTextDiagnostics(coverage: FontCoverage | undefined, role: RendererFontRole,
  family: string, text: string, target: string): ReadingDiagnostic[] {
  if (!text.trim()) return [];
  if (!coverage?.characters) return [{ code: 'FONT_COVERAGE_UNAVAILABLE', severity: 'info', target, text,
    message: coverage ? `${family} 已加载，但无法读取字形覆盖：${coverage.error}`
      : `${role} 使用系统回退字体，无法证明其他设备的字形覆盖。` }];
  const missing = [...new Set([...text].filter(char => !/[\p{White_Space}\p{Default_Ignorable_Code_Point}]/u.test(char)
    && !coverage.characters!.has(char.codePointAt(0)!)))].join('');
  const codes = [...missing].map(char => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
  return missing ? [{ code: 'FONT_MISSING_GLYPHS', severity: 'warning', target, text, missingCharacters: missing,
    message: `${family} 缺少字形：${missing}（${codes}）。当前设备可能使用回退字体；请更换或补充作品字体。` }] : [];
}
