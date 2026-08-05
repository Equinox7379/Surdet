/**
 * collectConfigSceneRoots（core 共享纯实现，审计轮4 自 CLI 下沉）单测：
 * CLI 的 W007 可达根与编辑器流程图的"宿主入口"共用此函数，行为必须一致。
 */
import { describe, expect, it } from 'vitest';
import { collectConfigSceneRoots } from '../src/scene-lint.js';

describe('collectConfigSceneRoots（配置驱动的 hostJump 目标场景）', () => {
  it('events.json：events[].scene 与 scheduled[].scene 均收集', () => {
    const roots = collectConfigSceneRoots({
      events: {
        events: [{ id: 'e1', scene: 'ev_scene_a' }, { id: 'e2', scene: 'ev_scene_b' }],
        scheduled: [{ id: 's1', scene: 'turn_ev' }],
      },
    });
    expect(roots).toEqual(['ev_scene_a', 'ev_scene_b', 'turn_ev']);
  });

  it('growth.json：profiles[].levelEvents 值收集', () => {
    const roots = collectConfigSceneRoots({
      growth: { profiles: [{ characterId: 'lynn', levelEvents: { 5: 'lv5_ev', 10: 'lv10_ev' } }] },
    });
    expect(roots.sort()).toEqual(['lv10_ev', 'lv5_ev']);
  });

  it('calendar.json：nodes[].eventId 与 baseCommands[].eventId 收集', () => {
    const roots = collectConfigSceneRoots({
      calendar: {
        nodes: [{ id: 'n1' }, { id: 'n2', eventId: 'forest_event' }],
        baseCommands: [{ id: 'c1', eventId: 'rest_event' }, { id: 'c2' }],
      },
    });
    expect(roots).toEqual(['forest_event', 'rest_event']);
  });

  it('三源合并 + 无配置返回空数组（畸形字段容错不抛错）', () => {
    const roots = collectConfigSceneRoots({
      events: { events: [{ scene: 'a' }, { id: 'broken' }, 'not-an-object'] },
      growth: { profiles: [{ levelEvents: 'oops' }, { levelEvents: { 3: 'b' } }] },
      calendar: { nodes: 'oops', baseCommands: [{ eventId: 42 }] },
    });
    expect(roots).toEqual(['a', 'b']);
    expect(collectConfigSceneRoots({})).toEqual([]);
    expect(collectConfigSceneRoots({ events: null, growth: undefined, calendar: [] })).toEqual([]);
  });
});
