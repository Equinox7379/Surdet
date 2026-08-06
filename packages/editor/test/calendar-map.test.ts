/**
 * 日历地图可视化：纯函数测试（clamp/宽度/坐标解析/requires 解析）。
 */
import { describe, expect, it } from 'vitest';
import { clampCoord, mapNodeWidth, readNodePos, readRequires, MAP_W, MAP_H } from '../src/panels/calendar-map.js';

describe('clampCoord', () => {
  it('钳制在范围内并取整；非法值回下界', () => {
    expect(clampCoord(50.6, 0, MAP_W)).toBe(51);
    expect(clampCoord(-20, 0, MAP_W)).toBe(0);
    expect(clampCoord(MAP_W + 99, 0, MAP_W)).toBe(MAP_W);
    expect(clampCoord(NaN, 0, MAP_H)).toBe(0);
  });
});

describe('mapNodeWidth', () => {
  it('按名称长度估算且不小于 70', () => {
    expect(mapNodeWidth('据点')).toBe(Math.max(70, 2 * 14 + 24));
    expect(mapNodeWidth('')).toBe(70);
    expect(mapNodeWidth('一个很长很长的地点名')).toBeGreaterThan(70);
  });
});

describe('readNodePos', () => {
  it('数字字符串解析；非法/缺省按 0', () => {
    expect(readNodePos({ x: '120', y: '480' })).toEqual({ x: 120, y: 480 });
    expect(readNodePos({ x: '', y: 'abc' })).toEqual({ x: 0, y: 0 });
    expect(readNodePos({})).toEqual({ x: 0, y: 0 });
  });
});

describe('readRequires', () => {
  it('JSON 数组解析；非法/非数组/混入非字符串容错', () => {
    expect(readRequires({ requires: '["map_01","map_02"]' })).toEqual(['map_01', 'map_02']);
    expect(readRequires({ requires: '' })).toEqual([]);
    expect(readRequires({ requires: '{bad' })).toEqual([]);
    expect(readRequires({ requires: '"not-array"' })).toEqual([]);
    expect(readRequires({ requires: '["a", 2]' })).toEqual(['a']);
  });
});
