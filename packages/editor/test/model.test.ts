import { describe, expect, it } from 'vitest';
import { parseScript, serializeScript, parseLine, splitInstr, rebuildInstrRaw, rebuildTextRaw } from '../src/model.js';

describe('model 解析/序列化', () => {
  it('roundtrip：解析后序列化零失真', () => {
    const src = '@scene ch01\n@bg castle_hall\n\n// 注释\n凛：你好。\n@label start\n@choice\n  拔剑 -> @goto a\n  沉默 [if:x] -> @goto b\n@label a\n凛：A。';
    expect(serializeScript(parseScript(src))).toBe(src);
  });

  it('行分类：文本/说话人/标签/指令/选项/注释/空行', () => {
    expect(parseLine('凛：你好。', '').kind).toBe('text');
    const t = parseLine('凛：你好。', '');
    if (t.kind === 'text') {
      expect(t.speaker).toBe('凛');
      expect(t.value).toBe('你好。');
    }
    expect(parseLine('旁白文本', '').kind).toBe('text');
    expect(parseLine('@label start', '').kind).toBe('label');
    expect(parseLine('@bg castle', '').kind).toBe('instr');
    expect(parseLine('  拔剑 -> @goto a', 'choice').kind).toBe('choice-option');
    expect(parseLine('// hi', '').kind).toBe('comment');
    expect(parseLine('   ', '').kind).toBe('blank');
  });

  it('纯数字前缀不当作说话人（与引擎一致，避免 12:30 误判）', () => {
    const t = parseLine('12：30 钟声响起', '');
    if (t.kind === 'text') expect(t.speaker).toBe('');
  });

  it('splitInstr 引号感知拆分 + rebuild', () => {
    const { name, args } = splitInstr('@set msg = "a b c"');
    expect(name).toBe('set');
    expect(args).toEqual(['msg', '=', '"a b c"']);
    expect(rebuildInstrRaw(name, args)).toBe('@set msg = "a b c"');
    expect(rebuildInstrRaw('bg', ['castle'])).toBe('@bg castle');
  });

  it('rebuildTextRaw 说话人拼接', () => {
    expect(rebuildTextRaw('凛', '你好')).toBe('凛：你好');
    expect(rebuildTextRaw('', '旁白')).toBe('旁白');
  });

  it('零失真：CRLF 源文件按原换行风格序列化（审计修复）', () => {
    const src = '@scene ch01\r\n凛：你好。\r\n@label a';
    const lines = parseScript(src);
    expect(serializeScript(lines, '\r\n')).toBe(src);
  });

  it('零失真：半角冒号说话人保持原样（审计修复）', () => {
    const src = '凛:你好。';
    const line = parseLine(src, '');
    if (line.kind === 'text') {
      expect(line.sep).toBe(':');
      expect(rebuildTextRaw(line.speaker, line.value, line.sep)).toBe(src);
    } else {
      throw new Error('应解析为 text 行');
    }
    expect(serializeScript(parseScript(src))).toBe(src);
  });
});
