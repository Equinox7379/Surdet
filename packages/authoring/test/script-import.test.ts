import { describe, expect, it } from 'vitest';
import { compileScene, inlinePlainText } from '@surdet/core';
import { previewScriptImport } from '../src/script-import.js';
import { createSceneText } from '../src/operations.js';

const characters = [{ id: 'rin', name: '凛' }, { id: 'n', name: '旁白' }];
describe('plain text and CSV dialogue import', () => {
  it.each(['CON', 'nul', 'Prn', 'COM1', 'LPT9'])('rejects reserved scene filename %s in the shared import generator', id => {
    const preview = previewScriptImport({ format: 'text', source: '正常对白。' });
    expect(preview.ready).toBe(true);
    expect(() => createSceneText(id, preview.blocks)).toThrow(/Windows 设备名/);
    expect(() => createSceneText('console', preview.blocks)).not.toThrow();
  });
  it('imports angle tags and backslashes as literal prose, not effects', () => {
    const source = '凛：<w><b>不是标签</b>\\《红楼梦》';
    const preview = previewScriptImport({ format: 'text', source }, characters);
    expect(preview.ready).toBe(true);
    expect(preview.rows[0]!.value).toBe('<w><b>不是标签</b>\\《红楼梦》');
    expect(inlinePlainText(preview.blocks[0]!.value)).toBe(preview.rows[0]!.value);
    expect(preview.blocks[0]!.value).toContain('\\<w>');
  });
  it('accepts BOM, Chinese, quotes, Unicode separators and mixed EOL, then generates real typed source', () => {
    const preview = previewScriptImport({ format: 'text', source: '\uFEFF凛：雨停了。\r\n\r12:30 天晴。\n凛:前半\u2028后半。\nhttps://example.com/path' }, characters);
    expect(preview.ready).toBe(true);
    expect(preview.rows.map(row => [row.line, row.speaker, row.value])).toEqual([
      [1, '凛', '雨停了。'], [3, '', '12:30 天晴。'], [4, '凛', '前半\u2028后半。'], [5, '', 'https://example.com/path'],
    ]);
    const source = createSceneText('imported', preview.blocks);
    expect(source).toContain('凛：前半\u2028后半。');
    expect(() => compileScene(source, 'imported.gal', 'imported')).not.toThrow();
  });
  it('does not execute directives/comments; explicit speaker mapping can preserve them as literal dialogue', () => {
    const input = { format: 'text' as const, source: '@jump secret\n// 保留文字' };
    expect(previewScriptImport(input).ready).toBe(false);
    expect(previewScriptImport(input).blocks).toEqual([]);
    const fixed = previewScriptImport({ ...input, speakerMap: { '': '旁白' } }, characters);
    expect(fixed.ready).toBe(true);
    expect(fixed.blocks).toEqual([{ kind: 'text', speaker: '旁白', value: '@jump secret' }, { kind: 'text', speaker: '旁白', value: '// 保留文字' }]);
  });
  it('parses quoted commas, doubled quotes and multiline cells with original CSV record positions', () => {
    const source = '\uFEFFspeaker,text,备注\r\n凛,"她说""你好"",雨停了。",一\r\n凛,"第一句\n@jump secret",二\r\n';
    const preview = previewScriptImport({ format: 'csv', source }, characters);
    expect(preview.ready).toBe(true);
    expect(preview.rows.map(row => [row.line, row.value])).toEqual([[2, '她说"你好",雨停了。'], [3, '第一句'], [3, '@jump secret']]);
    expect(preview.issues.map(issue => issue.code)).toEqual(['IGNORED_COLUMNS', 'MULTILINE_TEXT']);
    expect(createSceneText('imported', preview.blocks)).toContain('凛：@jump secret\n@end\n');
  });
  it.each(['speaker,text\n凛,"未闭合', 'speaker,text\n凛,"完成"junk', 'speaker,text\n凛,不合法"引号'])('rejects malformed CSV without partial import: %s', source => {
    const preview = previewScriptImport({ format: 'csv', source });
    expect(preview.ready).toBe(false); expect(preview.blocks).toEqual([]);
    expect(preview.issues.some(issue => issue.code === 'INVALID_CSV')).toBe(true);
  });
  it('requires explicit mapping for ambiguous headers, supports reordered columns and headerless input', () => {
    const input = { format: 'csv' as const, source: 'text,text,speaker\n错列,选中这列,凛' };
    expect(previewScriptImport(input).issues[0]?.code).toBe('COLUMN_MAPPING_REQUIRED');
    const mapped = previewScriptImport({ ...input, textColumn: 1, speakerColumn: 2 }, characters);
    expect(mapped.ready).toBe(true); expect(mapped.blocks[0]?.value).toBe('选中这列');
    const headerless = previewScriptImport({ format: 'csv', source: '你好,凛', header: false, textColumn: 0, speakerColumn: 1 }, characters);
    expect(headerless.blocks).toEqual([{ kind: 'text', speaker: '凛', value: '你好' }]);
    expect(previewScriptImport({ format: 'csv', source: 'speaker,text\n凛,你好', speakerColumn: null }).blocks[0]?.speaker).toBe('');
  });
  it('reports bad widths, empty text, invalid speakers and duplicate role names without discarding evidence', () => {
    const preview = previewScriptImport({ format: 'csv', source: 'speaker,text\n凛,你好\n凛,\n凛,内容,多列\n"凛\n换行",内容' }, [...characters, { id: 'other', name: '凛' }]);
    expect(preview.ready).toBe(false); expect(preview.blocks).toEqual([]);
    expect(preview.issues.map(issue => issue.code)).toEqual(['AMBIGUOUS_SPEAKER', 'EMPTY_TEXT', 'COLUMN_COUNT', 'INVALID_SPEAKER']);
    expect(preview.issues.map(issue => issue.line)).toEqual([2, 3, 4, 5]);
  });
  it('keeps unknown speakers as warnings, accepts explicit maps and never guesses project changes', () => {
    const original = JSON.stringify(characters);
    const preview = previewScriptImport({ format: 'text', source: '陌生人：你好\nrin：再见' }, characters);
    expect(preview.ready).toBe(true); expect(preview.issues.map(issue => issue.code)).toEqual(['UNKNOWN_SPEAKER', 'SPEAKER_ID']);
    expect(previewScriptImport({ format: 'text', source: 'rin：再见', speakerMap: { rin: '凛' } }, characters).blocks[0]?.speaker).toBe('凛');
    expect(JSON.stringify(characters)).toBe(original);
    expect(previewScriptImport({ format: 'text', source: '\0bad' }).ready).toBe(false);
    expect(previewScriptImport({ format: 'text', source: '\n\r\n' }).ready).toBe(false);
  });
});
