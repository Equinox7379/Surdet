/**
 * M5 支柱4：CJK 断行禁则测试（失败用例先行：裸断行会让标点挂行首/拆省略号，wrapCjk 必须避免）。
 */
import { describe, expect, it } from 'vitest';
import { wrapCjk, wrapCjkMeasure, wrapCjkUnits } from '../src/text-wrap.js';

const NO_START = ['，', '。', '！', '？', '：', '；', '、', '）', '」', '】', '》', '”', '…', '—'];
const NO_END = ['（', '「', '【', '《', '“'];

describe('wrapCjk（断行禁则）', () => {
  it('行首禁则：逗号不会被甩到行首（收进上一行行尾）', () => {
    const text = '甲'.repeat(40) + '，乙丙丁';
    const lines = wrapCjk(text, 40);
    for (const line of lines.slice(1)) {
      expect(NO_START, `行首出现禁则字：'${line[0]}'`).not.toContain(line[0]!);
    }
    expect(lines[0]!.endsWith('，')).toBe(true); // 逗号被收进第一行行尾
    expect(lines.join('')).toBe(text); // 无损
  });

  it('行尾禁则：前引号/前括号不挂在行尾（推到下一行）', () => {
    const text = '甲'.repeat(39) + '（乙丙）丁';
    const lines = wrapCjk(text, 40);
    for (const line of lines.slice(0, -1)) {
      expect(NO_END, `行尾出现禁则字：'${line[line.length - 1]}'`).not.toContain(line[line.length - 1]!);
    }
    expect(lines.join('')).toBe(text);
  });

  it('省略号/破折号不被拆到两行', () => {
    for (const run of ['……', '——']) {
      const text = '甲'.repeat(39) + run + '乙';
      const lines = wrapCjk(text, 40);
      for (const line of lines) {
        // 不允许出现"行尾单个连接符"或"行首单个连接符"的拆半形态
        if (line.length > 1) {
          const endsWithSingle = line.endsWith(run[0]!) && !line.endsWith(run);
          const startsWithSingle = line.startsWith(run[0]!) && !line.startsWith(run);
          expect(endsWithSingle, `'${line}' 行尾拆半了 ${run}`).toBe(false);
          expect(startsWithSingle, `'${line}' 行首拆半了 ${run}`).toBe(false);
        }
      }
      expect(lines.join('')).toBe(text);
    }
  });

  it('连续禁则字一并收入行尾（"……，"不拆）', () => {
    const text = '甲'.repeat(39) + '……，乙';
    const lines = wrapCjk(text, 40);
    expect(lines[0]!.endsWith('……，')).toBe(true);
    expect(lines.join('')).toBe(text);
  });

  it('无损往返：任意文本折行后拼接等于原文', () => {
    const samples = [
      '', '短句', '甲'.repeat(40), '甲'.repeat(83),
      '他说：“你好，世界！”然后离开了……',
      '（括号）开头，句号。问号？叹号！分号；冒号：顿号、结束',
      'English 与中文混排，逗号后面继续。',
    ];
    for (const text of samples) {
      expect(wrapCjk(text, 17).join('')).toBe(text);
    }
  });

  it('空文本返回空数组；短文本单行', () => {
    expect(wrapCjk('', 40)).toEqual([]);
    expect(wrapCjk('短句', 40)).toEqual(['短句']);
  });

  it('行长约束：除禁则悬挂外不超过每行容量', () => {
    const text = '甲乙丙丁戊己庚辛壬癸'.repeat(10);
    const lines = wrapCjk(text, 12);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(14); // 容量 + 悬挂余量
      expect(line.length).toBeGreaterThan(0);
    }
  });
});

describe('wrapCjkMeasure（像素级断行）', () => {
  it('honors explicit CRLF/newlines and blank lines without counting them as glyph width', () => {
    expect(wrapCjk('甲乙\r\n\n丙丁\n', 2)).toEqual(['甲乙', '', '丙丁', '']);
    expect(wrapCjkMeasure('甲乙\n\n丙丁\n', 20, s => [...s].length * 10)).toEqual(['甲乙', '', '丙丁', '']);
  });

  it('keeps grapheme clusters and ordinary English words together when they fit a line', () => {
    const text = 'e\u0301👩‍👩‍👧‍👦甲';
    expect(wrapCjk(text, 1)).toEqual(['e\u0301', '👩‍👩‍👧‍👦', '甲']);
    expect(wrapCjkMeasure('Hello world here', 90, s => s.length * 10)).toEqual(['Hello ', 'world ', 'here']);
  });
  /** 等宽测量：每字 10px → 与字数版 wrapCjk(perLine=maxWidth/10) 完全同构 */
  const mono = (s: string): number => s.length * 10;

  it('等宽测量与字数版结果一致（含禁则）', () => {
    const samples = [
      '甲'.repeat(30),
      '他说：“你好，世界！”然后离开了……',
      '（括号）开头，句号。问号？叹号！',
    ];
    for (const text of samples) {
      expect(wrapCjkMeasure(text, 120, mono)).toEqual(wrapCjk(text, 12));
    }
  });

  it('无损往返（变宽测量）', () => {
    const measure = (s: string): number => [...s].reduce((w, c) => w + (c.charCodeAt(0) < 128 ? 2 : 10), 0);
    const text = 'English 与中文混排，ii 窄字很多。之后继续……';
    expect(wrapCjkMeasure(text, 100, measure).join('')).toBe(text);
  });

  it('窄 ASCII 段落按真实宽度容字（字数估算会提前断行）', () => {
    // 30 个窄字共 60px ≤ 100px → 单行；字数版 perLine=10 会折 3 行
    const measure = (s: string): number => s.length * 2;
    expect(wrapCjkMeasure('i'.repeat(30), 100, measure)).toEqual(['i'.repeat(30)]);
  });

  it('行首禁则悬挂在测量版同样生效', () => {
    // 12 个 CJK 字恰满 120px，第 13 字是句号 → 收进行尾悬挂（超宽）
    const text = '甲'.repeat(12) + '。' + '乙'.repeat(5);
    const lines = wrapCjkMeasure(text, 120, mono);
    expect(lines[0]).toBe('甲'.repeat(12) + '。');
    expect(lines[1]).toBe('乙'.repeat(5));
  });

  it('单字超宽强制独占一行（防死循环）', () => {
    const lines = wrapCjkMeasure('甲乙丙', 5, mono); // 每字 10px > 5px
    expect(lines).toEqual(['甲', '乙', '丙']);
  });
});

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (i + 1 >= text.length || next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('wrapCjk Unicode 与边界输入安全', () => {
  it('代理项检查能识别末尾半字符，并接受成对字符和正常文字簇', () => {
    for (const value of ['甲\ud800', '\udc00乙', '\ud800甲']) expect(hasLoneSurrogate(value)).toBe(true);
    for (const value of ['甲😀乙', '𠮷', 'e\u0301', '']) expect(hasLoneSurrogate(value)).toBe(false);
  });
  it('emoji 正好位于换行边界时不拆 surrogate，且无损往返', () => {
    const text = '甲甲甲😀乙丙';
    const lines = wrapCjk(text, 4);
    expect(lines.some(hasLoneSurrogate)).toBe(false);
    expect(lines.join('')).toBe(text);
  });

  it('扩展汉字、连续 emoji 和 emoji+中文标点均不拆分', () => {
    for (const text of ['甲甲𠮷乙', '甲😀😀乙', '甲😀，乙']) {
      const lines = wrapCjk(text, 2);
      expect(lines.some(hasLoneSurrogate), text).toBe(false);
      expect(lines.join('')).toBe(text);
    }
  });

  it('measure 回调只收到完整 code point 字符串', () => {
    const seen: string[] = [];
    const measure = (value: string): number => {
      seen.push(value);
      expect(hasLoneSurrogate(value)).toBe(false);
      return [...value].length * 10;
    };
    const text = '甲😀𠮷乙';
    expect(wrapCjkMeasure(text, 20, measure).join('')).toBe(text);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('0、负数、小数和 Infinity 宽度都有稳定无损行为', () => {
    for (const width of [0, -2, 1.9, Number.POSITIVE_INFINITY]) {
      expect(wrapCjk('甲😀乙', width).join('')).toBe('甲😀乙');
      expect(wrapCjkMeasure('甲😀乙', width, (value) => [...value].length * 10).join('')).toBe('甲😀乙');
    }
    expect(wrapCjk('', Number.NaN)).toEqual([]);
    expect(wrapCjkMeasure('', Number.NaN, () => 0)).toEqual([]);
  });

  it('NaN 宽度明确拒绝，不进入同步死循环', () => {
    expect(() => wrapCjk('甲', Number.NaN)).toThrow(/perLine/);
    expect(() => wrapCjk('\n', Number.NaN)).toThrow(/perLine/);
    expect(() => wrapCjkMeasure('\n', Number.NaN, () => 0)).toThrow(/maxWidth/);
    expect(() => wrapCjkMeasure('甲', Number.NaN, () => 10)).toThrow(/maxWidth/);
  });
});

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const splitGraphemes = (text: string): string[] => Array.from(segmenter.segment(text), item => item.segment);
const wrapPaths = [
  { name: 'count', wrap: wrapCjk },
  { name: 'measure', wrap: (text: string, width: number) => wrapCjkMeasure(text, width * 10, value => splitGraphemes(value).length * 10) },
  { name: 'styled', wrap: (text: string, width: number) => wrapCjkUnits(splitGraphemes(text), width, unit => unit, units => units.length).map(line => line.join('')) },
];

describe.each(wrapPaths.slice(0, 2))('D13 $name 有界悬挂', ({ wrap }) => {
  it('满行之后的 30 个逗号最多悬挂两字素，其余必须继续分行', () => {
    const text = '甲'.repeat(12) + '，'.repeat(30) + '乙';
    const lines = wrap(text, 12);
    expect(lines[0]).toBe('甲'.repeat(12) + '，，');
    expect(lines.join('')).toBe(text);
    for (const line of lines) expect(splitGraphemes(line).length).toBeLessThanOrEqual(14);
  });

  it.each([1, 12])('纯标点在容量 %i 下也有界分行、无空行且无损', width => {
    const text = '，'.repeat(30);
    const lines = wrap(text, width);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(text);
    for (const line of lines) {
      expect(splitGraphemes(line).length).toBeGreaterThan(0);
      expect(splitGraphemes(line).length).toBeLessThanOrEqual(width + 2);
    }
  });

  it('悬挂额度按字素计算，并保留常规的双省略号和破折号', () => {
    for (const punctuation of ['，，', '……', '——']) {
      const text = 'e\u0301👩‍👩‍👧‍👦' + punctuation + '乙';
      expect(wrap(text, 2)).toEqual(['e\u0301👩‍👩‍👧‍👦' + punctuation, '乙']);
    }
  });
});

describe.each(wrapPaths)('D14 $name 连续开括号', ({ wrap }) => {
  it.each(['“「', '（【《', '([{'])('断点前的 %s 全部退到下一行', opening => {
    const text = '甲乙' + opening + '丙丁';
    const lines = wrap(text, 2 + opening.length);
    expect(lines[0]).toBe('甲乙');
    expect(lines.join('')).toBe(text);
    for (const line of lines.slice(0, -1)) expect(['“', '「', '（', '【', '《', '(', '[', '{']).not.toContain(line.at(-1));
  });

  it.each([1, 2, 4])('容量 %i 放不下连续开括号时仍保留至少一个不可分单位', width => {
    const text = '甲' + '（'.repeat(8) + '乙';
    const lines = wrap(text, width);
    expect(lines.join('')).toBe(text);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
      expect(line.length).toBeLessThanOrEqual(width);
      if (line.endsWith('（')) expect(line).toBe('（');
    }
  });
});

describe('styled units 的现有边界', () => {
  it('无法避免行首标点的长串按可用宽度折行，不退化成逐字竖列', () => {
    const units = Array.from('读' + '，'.repeat(25));
    const lines = wrapCjkUnits(units, 8, unit => unit, line => line.length);
    expect(lines.map(line => line.join(''))).toEqual(['读' + '，'.repeat(7), '，'.repeat(8), '，'.repeat(8), '，，']);
  });
  it('大字闭标点仍移入下一行，长标点串不越过 mask', () => {
    const units = Array.from('甲乙丙丁，戊' + '，'.repeat(30), text => ({ text, width: 20 }));
    const measure = (line: readonly (typeof units)[number][]): number => line.reduce((sum, unit) => sum + unit.width, 0);
    const lines = wrapCjkUnits(units, 80, unit => unit.text, measure);
    expect(lines[0]!.map(unit => unit.text).join('')).toBe('甲乙丙');
    expect(lines[1]![0]!.text).toBe('丁');
    expect(lines.flat()).toEqual(units);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
      expect(measure(line)).toBeLessThanOrEqual(80);
    }
  });

  it('退让不拆 ruby/组合字素，超宽 ruby 单独前进，Latin 单词沿原边界换行', () => {
    const ruby = { text: '世界', width: 30, ruby: 'せかい' };
    const units = [{ text: 'e\u0301', width: 10 }, ruby, { text: '“', width: 10 }, { text: '「', width: 10 }, { text: '👩‍👩‍👧‍👦', width: 10 }];
    const measure = (line: readonly { width: number }[]): number => line.reduce((sum, unit) => sum + unit.width, 0);
    const lines = wrapCjkUnits(units, 60, unit => unit.text, measure);
    expect(lines[0]).toEqual([units[0], ruby]);
    expect(lines.flat()).toEqual(units);
    expect(lines[0]![1]).toBe(ruby);
    expect(wrapCjkUnits([ruby, units[4]!], 20, unit => unit.text, measure)).toEqual([[ruby], [units[4]]]);
    const latin = splitGraphemes('Hello world here');
    expect(wrapCjkUnits(latin, 9, unit => unit, line => line.length).map(line => line.join(''))).toEqual(['Hello ', 'world ', 'here']);
  });
});
