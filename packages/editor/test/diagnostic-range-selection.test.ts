import { describe, expect, it } from 'vitest';
import { compileScene, DslError, type SourceRange } from '@surdet/core';
import { dialogueRangeOffsets, sourceRangeOffsets } from '../src/v4/source-range.js';
import { parseScript } from '../src/model.js';

/** The source textarea holds LF-joined rows, whatever the file's line endings. */
function select(source: string, index: number, range: { start: { line: number; col: number }; end: { line: number; col: number } }) {
  const rows = parseScript(source);
  const textarea = rows.map(row => row.raw).join('\n');
  const rowStart = (row: number) => rows.slice(0, row).reduce((offset, entry) => offset + entry.raw.length + (entry.eol ? 1 : 0), 0);
  const offsets = sourceRangeOffsets(rows, rowStart, index, range);
  return offsets === null ? null : textarea.slice(offsets.start, offsets.end);
}

describe('diagnostic range selection in the source view', () => {
  it('selects by UTF-16 columns across CRLF, tabs, quotes and surrogate pairs', () => {
    const source = '@scene start\r\n凛：“你好”😀\r\n\t@goto 缺失标签\r\n@show "😀未闭合\r\n@end\r\n';
    expect(select(source, 2, { start: { line: 3, col: 8 }, end: { line: 3, col: 12 } })).toBe('缺失标签');
    expect(select(source, 3, { start: { line: 4, col: 7 }, end: { line: 4, col: 13 } })).toBe('"😀未闭合');
    expect(select(source, 1, { start: { line: 2, col: 3 }, end: { line: 2, col: 9 } })).toBe('“你好”😀');
  });

  it('selects a range that ends on a later row', () => {
    const source = '@scene start\n@choice\n  去港口 -> @goto harbor\n@end\n';
    expect(select(source, 1, { start: { line: 2, col: 1 }, end: { line: 3, col: 10 } })).toBe('@choice\n  去港口 -> ');
  });

  it('falls back to the whole row when a range does not fit the located row or the text', () => {
    const source = '@scene start\n@goto x\n';
    expect(select(source, 1, { start: { line: 3, col: 1 }, end: { line: 3, col: 2 } })).toBeNull();
    expect(select(source, 1, { start: { line: 2, col: 7 }, end: { line: 2, col: 99 } })).toBeNull();
    expect(select(source, 1, { start: { line: 2, col: 7 }, end: { line: 2, col: 7 } })).toBeNull();
  });
});

describe('diagnostic range selection in a manuscript dialogue box', () => {
  /** The compiler's own range for an invalid inline tag, mapped into the dialogue-only box. */
  function compiledRange(source: string): SourceRange {
    try { compileScene(source, 's.gal', 's'); } catch (error) {
      if (error instanceof DslError && error.pos.range) return error.pos.range;
      throw error;
    }
    throw new Error('expected a compile error');
  }

  it('selects the exact tag reported by Core after the speaker prefix', () => {
    const source = '@scene s\n凛：危险<color=red>真的</color>来了';
    const range = compiledRange(source);
    const line = parseScript(source)[1]!;
    if (line.kind !== 'text') throw new Error('expected dialogue');
    const offsets = dialogueRangeOffsets(line, 1, range)!;
    expect(line.value.slice(offsets.start, offsets.end)).toBe('<color=red>');
  });

  it('selects a misplaced <nw> that Core reports as M006', () => {
    const text = '@scene s\n凛：<b>先走<nw></b>吧';
    let code = '';
    try { compileScene(text, 's.gal', 's'); } catch (error) { code = (error as { code?: string }).code ?? ''; }
    expect(code).toBe('M006');
    const line = parseScript(text)[1]!;
    if (line.kind !== 'text') throw new Error('expected dialogue');
    const offsets = dialogueRangeOffsets(line, 1, compiledRange(text))!;
    expect(line.value.slice(offsets.start, offsets.end)).toBe('<nw>');
  });

  it('works for narration and does not use ranges outside the dialogue', () => {
    const narration = '@scene s\n门外<size=9>响了</size>';
    const line = parseScript(narration)[1]!;
    if (line.kind !== 'text') throw new Error('expected narration');
    const offsets = dialogueRangeOffsets(line, 1, compiledRange(narration))!;
    expect(line.value.slice(offsets.start, offsets.end)).toBe('<size=9>');
    const speaker = parseScript('@scene s\n凛：你好')[1]!;
    if (speaker.kind !== 'text') throw new Error('expected dialogue');
    expect(dialogueRangeOffsets(speaker, 1, { start: { line: 2, col: 1 }, end: { line: 2, col: 2 } })).toBeNull();
    expect(dialogueRangeOffsets(speaker, 0, { start: { line: 2, col: 3 }, end: { line: 2, col: 4 } })).toBeNull();
  });
});
