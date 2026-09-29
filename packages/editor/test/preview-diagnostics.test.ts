import { describe, expect, it } from 'vitest';
import { PreviewGeneration, normalizePreviewDiagnostic, readingPreviewDiagnostic } from '../src/preview-diagnostics.js';

describe('preview diagnostics', () => {
  it('locates reading issues at the real trace source and distinguishes scroll from overflow', () => {
    const source = { sceneId: 'intro', file: 'content/scenes/intro.sd', line: 7 };
    expect(readingPreviewDiagnostic(3, source, [{ code: 'TEXT_SCROLL', severity: 'info', target: 'dialogue', message: '需滚轮翻阅' }]))
      .toMatchObject({ generation: 3, level: 'info', message: '当前位置 content/scenes/intro.sd:7：[对话正文] 需滚轮翻阅' });
    expect(readingPreviewDiagnostic(3, source, [{ code: 'FONT_MISSING_GLYPHS', severity: 'warning', target: 'speaker', message: '缺字：海' }]))
      .toMatchObject({ level: 'warning', message: '当前位置 content/scenes/intro.sd:7：[名字栏] 缺字：海' });
    expect(readingPreviewDiagnostic(3, source, [])).toBeNull();
  });
  it('rejects malformed messages and keeps only typed fields', () => {
    expect(normalizePreviewDiagnostic({ generation: 1, level: 'error', phase: 'runtime', message: 'boom', extra: true })).toEqual({
      generation: 1, level: 'error', phase: 'runtime', message: 'boom',
    });
    expect(normalizePreviewDiagnostic({ generation: 1, level: 'error' })).toBeNull();
  });

  it('marks stale iframe generations', () => {
    const generation = new PreviewGeneration();
    const first = generation.next();
    const second = generation.next();
    expect(generation.isCurrent(first)).toBe(false);
    expect(generation.isCurrent(second)).toBe(true);
  });
});
