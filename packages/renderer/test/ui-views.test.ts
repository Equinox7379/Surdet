import { describe, expect, it } from 'vitest';
import { parseRuby, stripRuby } from '../src/ruby.js';
import { buildMapView, formatSlotTime } from '../src/ui-views.js';

describe('parseRuby', () => {
  it('解析 基础字《注音》 分段', () => {
    expect(parseRuby('この世界《せかい》を救う')).toEqual([
      { base: 'この世界', ruby: 'せかい' },
      { base: 'を救う' },
    ]);
  });

  it('无标记文本整体为一段', () => {
    expect(parseRuby('普通台词。')).toEqual([{ base: '普通台词。' }]);
  });

  it('未配对《按字面保留', () => {
    expect(parseRuby('书名《未闭合')).toEqual([{ base: '书名《未闭合' }]);
  });

  it('多段注音 + stripRuby 还原主字', () => {
    const text = '第一《1》段 第二《2》段';
    expect(parseRuby(text)).toHaveLength(3);
    expect(stripRuby(text)).toBe('第一段 第二段');
  });
});

describe('ui-views', () => {
  it('formatSlotTime 输出 MM-DD HH:mm', () => {
    const ts = new Date(2026, 7, 4, 9, 5).getTime();
    expect(formatSlotTime(ts)).toBe('08-04 09:05');
    expect(formatSlotTime(undefined)).toBe('');
  });

  it('buildMapView 坐标 clamp 到安全区', () => {
    const v = buildMapView({
      turn: 1, ap: 3, maxAp: 5, date: '第1月 第1周',
      nodes: [
        { id: 'a', name: 'A', x: -50, y: 900, enterable: true, visited: false, apCost: 1 },
        { id: 'b', name: 'B', x: 640, y: 300, enterable: false, visited: true, apCost: 2 },
      ],
    });
    expect(v.nodes[0]).toMatchObject({ x: 70, y: 600 });
    expect(v.nodes[1]).toMatchObject({ x: 640, y: 300 });
  });
});
