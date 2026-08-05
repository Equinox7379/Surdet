/**
 * M5 支柱4：CJK 断行禁则测试（失败用例先行：裸断行会让标点挂行首/拆省略号，wrapCjk 必须避免）。
 */
import { describe, expect, it } from 'vitest';
import { wrapCjk } from '../src/text-wrap.js';

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
