/**
 * 日历地图可视化：纯函数测试（clamp/宽度/坐标解析/requires 解析）。
 * 三件套增量：重叠检测 findOverlaps、连线边界点 edgePoint、requires 增删（拖拽连线/点线删除的纯逻辑层）。
 */
import { describe, expect, it } from 'vitest';
import {
  clampCoord, mapNodeWidth, readNodePos, readRequires, MAP_W, MAP_H,
  findOverlaps, edgePoint, addRequiresToRow, removeRequiresFromRow, NODE_H,
} from '../src/panels/calendar-map.js';

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

describe('findOverlaps（节点重叠检测）', () => {
  it('水平/垂直半宽高内相交判重叠；刚好贴边（相等）不算重叠', () => {
    const w = 70;
    // 水平重叠：中心距 60 < (70+70)/2
    expect(findOverlaps([
      { id: 'a', x: 100, y: 100, w },
      { id: 'b', x: 160, y: 100, w },
    ])).toEqual([['a', 'b']]);
    // 垂直重叠：中心距 30 < NODE_H(40)
    expect(findOverlaps([
      { id: 'a', x: 100, y: 100, w },
      { id: 'b', x: 100, y: 130, w },
    ])).toEqual([['a', 'b']]);
    // 刚好贴边不算（< 不含等号）
    expect(findOverlaps([
      { id: 'a', x: 100, y: 100, w },
      { id: 'b', x: 170, y: 100, w },
    ])).toEqual([]);
    // 无节点/单节点安全
    expect(findOverlaps([])).toEqual([]);
    expect(findOverlaps([{ id: 'a', x: 0, y: 0, w }])).toEqual([]);
  });
});

describe('edgePoint（连线边界点修剪）', () => {
  it('水平方向从宽边出；垂直方向从高边出；斜向取先到边界', () => {
    // 向右：x + w/2
    expect(edgePoint({ x: 100, y: 100 }, { x: 300, y: 100 }, 70, NODE_H)).toEqual({ x: 135, y: 100 });
    // 向下：y + NODE_H/2
    expect(edgePoint({ x: 100, y: 100 }, { x: 100, y: 300 }, 70, NODE_H)).toEqual({ x: 100, y: 120 });
    // 重合点回中心（防御除零）
    expect(edgePoint({ x: 50, y: 50 }, { x: 50, y: 50 }, 70, NODE_H)).toEqual({ x: 50, y: 50 });
  });
});

describe('addRequiresToRow / removeRequiresFromRow（拖拽连线的行模型层）', () => {
  it.each(['[', '{bad', '"not-array"', '["kept",2]'])('preserves unfinished or invalid dependency drafts when adding a connection: %s', (requires) => {
    const row = { id: 'target', requires };
    expect(addRequiresToRow(row, 'source')).toBe(false);
    expect(row.requires).toBe(requires);
  });

  it('preserves an invalid mixed dependency draft when deleting a connection', () => {
    const row = { id: 'target', requires: '["source",2]' };
    expect(removeRequiresFromRow(row, 'source')).toBe(false);
    expect(row.requires).toBe('["source",2]');
  });

  it('追加写回 JSON 数组；重复/空白不重复加（返回 false）', () => {
    const row = { id: 'b', requires: '' };
    expect(addRequiresToRow(row, 'a')).toBe(true);
    expect(row.requires).toBe('["a"]');
    expect(addRequiresToRow(row, 'a')).toBe(false); // 幂等
    expect(addRequiresToRow(row, '  ')).toBe(false); // 空白拒绝
    expect(addRequiresToRow(row, 'c')).toBe(true);
    expect(row.requires).toBe('["a","c"]');
  });

  it('移除存在项返回 true；不存在/非法原文安全返回 false', () => {
    const row = { id: 'b', requires: '["a","c"]' };
    expect(removeRequiresFromRow(row, 'a')).toBe(true);
    expect(row.requires).toBe('["c"]');
    expect(removeRequiresFromRow(row, 'zz')).toBe(false);
    const bad = { id: 'x', requires: '{bad' };
    expect(removeRequiresFromRow(bad, 'a')).toBe(false);
    expect(bad.requires).toBe('{bad'); // 非法原文不被改写
  });
});
