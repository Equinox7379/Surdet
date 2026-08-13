import { describe, expect, it } from 'vitest';
import { createChangeDiff } from '../src/diff.js';

describe('createChangeDiff', () => {
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
