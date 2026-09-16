import { describe, expect, it } from 'vitest';
import { createChangeDiff } from '../src/diff.js';

describe('createChangeDiff', () => {
  it.each(['\u2028', '\u2029'])('preserves unrelated Unicode text in the complete diff (%j)', (separator) => {
    const before = `林汀：前半句${separator}后半句\r\n周渡：灯塔还亮着。\r\n`;
    const after = before.replace('灯塔', '邮局');
    const result = createChangeDiff({ operationId: 'unicode', before: { path: 's.gal', text: before }, after: { path: 's.gal', text: after }, directChange: {}, potentialImpact: [], observedImpact: [] });
    expect(result.files[0]!.unifiedDiff).toContain(` 林汀：前半句${separator}后半句`);
    expect(result.files[0]!.unifiedDiff).toContain('+周渡：邮局还亮着。');
    expect(result.files[0]!.unexpectedFormatChange).toBe(false);
  });
  it('separates semantic change from an unrelated line-ending rewrite', () => {
    const result = createChangeDiff({
      operationId: 'op-line',
      before: { path: 'content/scenario/prologue.gal', text: '凛：旧台词。\r\n@label next\r\n' },
      after: { path: 'content/scenario/prologue.gal', text: '凛：新台词。\n@label next\n' },
      directChange: { kind: 'text', value: '新台词。' },
      potentialImpact: [{ kind: 'runtime', objectRef: 'text:prologue:1' }],
      observedImpact: [],
    });

    expect(result.summary.modifiedScenes).toBe(1);
    expect(result.semantic[0]).toMatchObject({ operationId: 'op-line' });
    expect(result.files[0]?.unexpectedFormatChange).toBe(true);
    expect(result.files[0]?.unifiedDiff).toContain('-凛：旧台词。');
    expect(result.files[0]?.unifiedDiff).toContain('+凛：新台词。');
  });
});
