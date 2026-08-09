/**
 * NVL 页断行禁则回归测试（wrapCjk 接入 appendNvlText；对齐 M5 支柱4 对话框/Backlog 口径）。
 * 失败用例先行：旧实现走 Pixi wordWrap 裸断行——禁则标点挂行首、省略号被拆行；
 * 且定步长 i*35 排布让多行条目互相重叠。本组测试锁定修复后的行为。
 *
 * PixiStage 构造与 appendNvlText（PText 构造）在 node 环境可运行（不触发 WebGL/DOM），
 * 断言走只读 nvlLines 句柄（与 pixi-stage.test.ts 的 headless 策略一致）。
 */
import { describe, expect, it } from 'vitest';
import { PixiStage } from '../../src/pixi-stage.js';

/** 默认舞台 1280x720 → NVL 每行容量 floor((1280-160)/20) = 56 字 */
const CHARS_PER_LINE = 56;
/** 单线条目占高：1*28 + 6 = 34；淘汰预算 720-120 = 600 → 最多 floor(600/34) = 17 条 */
const SINGLE_ENTRY_H = 34;

function makeStage(): PixiStage {
  return new PixiStage();
}

describe('appendNvlText 断行禁则（wrapCjk 接入）', () => {
  it('长台词预断行：无损往返（拼接还原原文）', () => {
    const stage = makeStage();
    const body = '山'.repeat(120);
    stage.appendNvlText(null, body);
    const rendered = stage.nvlLines[0]!.text;
    expect(rendered.replaceAll('\n', '')).toBe(body);
    // 56/56/8 三行
    expect(rendered.split('\n')).toHaveLength(3);
  });

  it('行首禁则：句号不挂第二行行首（裸断行会挂）', () => {
    const stage = makeStage();
    // 第 57 字是"。"：裸按 56 断行会让"。"落行首
    const body = '山'.repeat(CHARS_PER_LINE) + '。' + '海'.repeat(20);
    stage.appendNvlText(null, body);
    const lines = stage.nvlLines[0]!.text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('山'.repeat(CHARS_PER_LINE) + '。'); // 禁则字收进上行（悬挂）
    expect(lines[1]).toBe('海'.repeat(20));
  });

  it('连续符不拆：……不被拆到两行', () => {
    const stage = makeStage();
    // 55 字 + "……"：裸断行会把两个 … 拆开
    const body = '山'.repeat(CHARS_PER_LINE - 1) + '……' + '海'.repeat(20);
    stage.appendNvlText(null, body);
    const lines = stage.nvlLines[0]!.text.split('\n');
    expect(lines[0]).toBe('山'.repeat(CHARS_PER_LINE - 1) + '……');
    expect(lines[0]).toContain('……');
    expect(lines[1]).toBe('海'.repeat(20));
  });

  it('行尾禁则：前引号不留行尾（推到下一行）', () => {
    const stage = makeStage();
    // 第 56 字是"「"：裸断行会让行尾挂开引号
    const body = '山'.repeat(CHARS_PER_LINE - 1) + '「' + '海'.repeat(30);
    stage.appendNvlText(null, body);
    const lines = stage.nvlLines[0]!.text.split('\n');
    expect(lines[0]).toBe('山'.repeat(CHARS_PER_LINE - 1));
    expect(lines[1]!.startsWith('「')).toBe(true);
    expect(lines.join('')).toBe(body);
  });

  it('说话人前缀随正文一起折行（前缀自然落首行）且无损', () => {
    const stage = makeStage();
    const body = '春'.repeat(100);
    stage.appendNvlText('旅人', body);
    const rendered = stage.nvlLines[0]!.text;
    expect(rendered.startsWith('旅人：')).toBe(true);
    expect(rendered.replaceAll('\n', '')).toBe(`旅人：${body}`);
  });

  it('多条通用断言：任何折行（除首行）首字不得为禁则标点', () => {
    const stage = makeStage();
    const forbiddenStart = ['，', '。', '、', '！', '？', '：', '；', '）', '」', '…', '—'];
    const body = ('雾'.repeat(50) + '，' + '雨'.repeat(30) + '。' + '风'.repeat(20) + '……').repeat(3);
    stage.appendNvlText(null, body);
    const lines = stage.nvlLines[0]!.text.split('\n');
    for (const line of lines.slice(1)) {
      expect(forbiddenStart.includes(line[0]!)).toBe(false);
    }
    expect(lines.join('')).toBe(body);
  });
});

describe('appendNvlText 布局（累计行高排布 + 超底边淘汰）', () => {
  it('多行条目占高计入排布：后续条目 y 随前行折行数下移（不再定步长重叠）', () => {
    const stage = makeStage();
    stage.appendNvlText(null, '山'.repeat(120)); // 折 3 行
    stage.appendNvlText(null, '短句');
    expect(stage.nvlLines[0]!.y).toBe(60);
    // 第二条 = 60 + 3*28 + 6 = 150（旧实现固定 60+35=95，视觉重叠）
    expect(stage.nvlLines[1]!.y).toBe(60 + 3 * 28 + 6);
  });

  it('超出屏幕底边淘汰最旧（保头对齐 y=60，总高不超预算）', () => {
    const stage = makeStage();
    for (let i = 0; i < 25; i++) stage.appendNvlText(null, `第${i}行`);
    const budget = 720 - 120;
    expect(stage.nvlLines.length).toBeLessThan(25);
    expect(stage.nvlLines.length).toBe(Math.floor(budget / SINGLE_ENTRY_H)); // 17
    expect(stage.nvlLines[0]!.y).toBe(60); // 淘汰后重排，头条回到顶边
    // 末条底部不越过下边距（h-60）
    const last = stage.nvlLines[stage.nvlLines.length - 1]!;
    expect(last.y + 28).toBeLessThanOrEqual(720 - 60);
  });

  it('长条目挤占空间：短条目存量随之减少（按行高而非条数淘汰）', () => {
    const stage = makeStage();
    for (let i = 0; i < 5; i++) stage.appendNvlText(null, '山'.repeat(120)); // 各折 3 行（90px）
    stage.appendNvlText(null, '尾巴');
    // 5 条×(3*28+6=90) = 450，+尾条 34 → 484 ≤ 600，全部保留
    expect(stage.nvlLines).toHaveLength(6);
    stage.appendNvlText(null, '山'.repeat(120)); // 第 6 条长条：484+90 = 574 ≤ 600，仍全保留
    expect(stage.nvlLines).toHaveLength(7);
    stage.appendNvlText(null, '山'.repeat(120)); // 追加后 574+90 = 664 > 600 → 淘汰最旧（90px）回落到 574
    expect(stage.nvlLines).toHaveLength(7);
    expect(stage.nvlLines[0]!.y).toBe(60);
  });

  it('clearNvlText 清空条目与行高账（@nvl clear / @nvl off 复开）', () => {
    const stage = makeStage();
    stage.appendNvlText(null, '山'.repeat(120));
    stage.appendNvlText(null, '短句');
    stage.clearNvlText();
    expect(stage.nvlLines).toHaveLength(0);
    // 清空后追加，排布从顶边重新开始（行高账未残留）
    stage.appendNvlText(null, '再来');
    expect(stage.nvlLines[0]!.y).toBe(60);
  });
});
