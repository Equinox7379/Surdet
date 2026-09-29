import type { RendererFontRole } from './api/renderer-commands.js';

export interface ReadingDiagnostic {
  code: 'TEXT_OVERFLOW' | 'TEXT_CLIPPED' | 'TEXT_SCROLL' | 'TEXT_MEASUREMENT_UNAVAILABLE' | 'FONT_MISSING_GLYPHS' | 'FONT_COVERAGE_UNAVAILABLE';
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

/** Measure actual text fragments, not the (possibly mostly empty) node box.
 * Scrollports trim the currently visible fragments before checking outer clips,
 * so text reachable by scrolling is not mistaken for permanently cropped text.
 */
export function isUiTextClipped(element: HTMLElement, root: HTMLElement): boolean {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  let fragments = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
    .map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
    const clipX = ['hidden', 'clip'].includes(style.overflowX), clipY = ['hidden', 'clip'].includes(style.overflowY);
    if (fragments.some(rect => (clipX && (rect.left < clip.left - 1 || rect.right > clip.right + 1))
      || (clipY && (rect.top < clip.top - 1 || rect.bottom > clip.bottom + 1)))) return true;
    const scrollX = ['auto', 'scroll'].includes(style.overflowX), scrollY = ['auto', 'scroll'].includes(style.overflowY);
    if (scrollX || scrollY) fragments = fragments.map(rect => ({
      left: scrollX ? Math.max(rect.left, clip.left) : rect.left, right: scrollX ? Math.min(rect.right, clip.right) : rect.right,
      top: scrollY ? Math.max(rect.top, clip.top) : rect.top, bottom: scrollY ? Math.min(rect.bottom, clip.bottom) : rect.bottom,
    })).filter(rect => rect.right > rect.left && rect.bottom > rect.top);
    if (parent === root) break;
  }
  return false;
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
