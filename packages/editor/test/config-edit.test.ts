/**
 * E3 配置编辑纯逻辑测试：变量表 ⇄ JSON 往返与校验、成就表往返与 when 语法校验、
 * 剧本变量引用收集（删除保护）。
 */
import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import type { CompiledScene } from '@surdet/core';
import {
  parseVariablesToRows, rowsToVariables, applyVariablesToConfig,
  parseAchievementsToRows, rowsToAchievements, collectReferencedVars,
  parseCalendarRows, rowsToCalendar,
  parseEventsRows, rowsToEvents,
  parseGrowthRows, rowsToGrowth,
  parseGalleryRows, rowsToGallery,
} from '../src/config-edit.js';

describe('变量表 ⇄ JSON', () => {
  const cfg = {
    title: 'Demo',
    entryScene: 'ch1',
    variables: {
      'lynn.trust': { type: 'number', initial: 0, min: 0, max: 100, description: '好感' },
      hasSword: { type: 'flag', initial: false },
      readonlyVar: { type: 'string', initial: 'x', readonly: true },
    },
  };

  it('parse → rows → variables 往返一致（含 min/max/readonly/description）', () => {
    const rows = parseVariablesToRows(cfg);
    expect(rows).toHaveLength(3);
    const { variables, errors } = rowsToVariables(rows);
    expect(errors).toEqual([]);
    expect(variables['lynn.trust']).toEqual({ type: 'number', initial: 0, min: 0, max: 100, description: '好感' });
    expect(variables['hasSword']).toEqual({ type: 'flag', initial: false });
    expect(variables['readonlyVar']).toEqual({ type: 'string', initial: 'x', readonly: true });
  });

  it('applyVariablesToConfig 保留其余顶层键、2 空格缩进、键序稳定', () => {
    const rows = parseVariablesToRows(cfg);
    const { variables } = rowsToVariables(rows);
    const text = applyVariablesToConfig(JSON.stringify(cfg), variables);
    const reparsed = JSON.parse(text) as Record<string, unknown>;
    expect(reparsed.title).toBe('Demo');
    expect(reparsed.entryScene).toBe('ch1');
    expect(Object.keys(reparsed.variables ?? {})).toEqual(['lynn.trust', 'hasSword', 'readonlyVar']);
    expect(text).toContain('\n  "title"'); // 2 空格缩进
  });

  it('非法输入被校验拦截：重复名/坏 initial/min>max/坏类型', () => {
    const { errors } = rowsToVariables([
      { name: 'a', type: 'number', initial: '1', min: '', max: '', readonly: false, description: '' },
      { name: 'a', type: 'number', initial: '2', min: '', max: '', readonly: false, description: '' },
      { name: 'b', type: 'number', initial: 'xyz', min: '', max: '', readonly: false, description: '' },
      { name: 'c', type: 'number', initial: '1', min: '10', max: '5', readonly: false, description: '' },
      { name: 'd', type: 'banana', initial: '1', min: '', max: '', readonly: false, description: '' },
      { name: '', type: 'number', initial: '0', min: '', max: '', readonly: false, description: '' },
    ]);
    expect(errors.some((e) => e.includes("'a' 重复"))).toBe(true);
    expect(errors.some((e) => e.includes("'b'") && e.includes('数字'))).toBe(true);
    expect(errors.some((e) => e.includes("'c'") && e.includes('min'))).toBe(true);
    expect(errors.some((e) => e.includes("'d'") && e.includes('类型'))).toBe(true);
    expect(errors.some((e) => e.includes('未填名称'))).toBe(true);
  });

  it('flag/boolean initial 只认真假字面量；string[] initial 走 JSON', () => {
    const ok = rowsToVariables([
      { name: 'f', type: 'flag', initial: 'true', min: '', max: '', readonly: false, description: '' },
      { name: 'arr', type: 'string[]', initial: '["a","b"]', min: '', max: '', readonly: false, description: '' },
    ]);
    expect(ok.errors).toEqual([]);
    expect(ok.variables['f']).toEqual({ type: 'flag', initial: true });
    expect(ok.variables['arr']).toEqual({ type: 'string[]', initial: ['a', 'b'] });
    const bad = rowsToVariables([
      { name: 'f2', type: 'flag', initial: 'yes', min: '', max: '', readonly: false, description: '' },
    ]);
    expect(bad.errors.length).toBe(1);
  });
});

describe('成就表 ⇄ JSON', () => {
  const raw = [
    { id: 'first_battle', name: '初战', description: '赢一场', when: 'battleWon' },
    { id: 'secret', name: '???', hidden: true },
  ];

  it('parse → rows → json 往返一致（空字段不写回，键序 id/name/description/when/hidden）', () => {
    const rows = parseAchievementsToRows(raw);
    expect(rows).toHaveLength(2);
    const { json, errors } = rowsToAchievements(rows);
    expect(errors).toEqual([]);
    expect(json[0]).toEqual({ id: 'first_battle', name: '初战', description: '赢一场', when: 'battleWon' });
    expect(json[1]).toEqual({ id: 'secret', name: '???', hidden: true });
  });

  it('when 表达式语法错误被拦截（与运行时 parseExpr 同源）', () => {
    const { json, errors } = rowsToAchievements([
      { id: 'bad', name: '坏', description: '', when: 'trust >= ', hidden: false },
    ]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('bad');
    expect(json).toEqual([]);
  });

  it('重复 ID 与空 ID 被拦截', () => {
    const { errors } = rowsToAchievements([
      { id: 'x', name: 'a', description: '', when: '', hidden: false },
      { id: 'x', name: 'b', description: '', when: '', hidden: false },
      { id: '', name: 'c', description: '', when: '', hidden: false },
    ]);
    expect(errors.some((e) => e.includes("'x' 重复"))).toBe(true);
    expect(errors.some((e) => e.includes('未填 ID'))).toBe(true);
  });

  it('非数组输入容错为空表', () => {
    expect(parseAchievementsToRows(null)).toEqual([]);
    expect(parseAchievementsToRows({ nope: 1 })).toEqual([]);
  });
});

describe('collectReferencedVars（删除保护）', () => {
  function scenesOf(entries: [string, string][]): Map<string, CompiledScene> {
    const m = new Map<string, CompiledScene>();
    for (const [id, src] of entries) m.set(id, compileScene(src, `${id}.gal`, id));
    return m;
  }

  it('覆盖 @set/@mod/@if/@switch/@inc/插值/choice when', () => {
    const scenes = scenesOf([
      ['ch1', '@set trust = 5\n@mod hp +1\n@if trust > 3\n凛：好。\n@endif\n@inc gold\n@switch chapter 1:c1\n@label c1\n凛：你的信任是{trust}。\n@choice\n  走 [if:hasSword] -> @goto c1\n'],
    ]);
    const refs = collectReferencedVars(scenes);
    for (const v of ['trust', 'hp', 'gold', 'chapter', 'hasSword']) {
      expect(refs.has(v), `应收集到 ${v}`).toBe(true);
      expect(refs.get(v)?.has('ch1')).toBe(true);
    }
  });

  it('未被引用的变量不出现在结果中', () => {
    const scenes = scenesOf([['ch1', '凛：好。\n']]);
    const refs = collectReferencedVars(scenes);
    expect(refs.size).toBe(0);
  });
});

/* ============================ E3 剩余：日历/事件/成长/鉴赏 ============================ */

const calendarRaw = {
  nodes: [
    { id: 'map_01', name: '据点', x: 120, y: 480, isBase: true, apCost: 0, custom: 'keep-me' },
    { id: 'map_02', name: '迷雾森林', x: 360, y: 240, apCost: 2, requires: ['map_01'], eventId: 'forest_event' },
  ],
  maxAp: 3,
  maxTurns: 30,
  dateTemplate: '第{month}月 第{turn}周',
  onTurnStartEventId: 'ev_turn_start',
  baseCommands: [
    { id: 'rest', name: '休息', apCost: 1, effects: { 'lynn.hp': 5 } },
    { id: 'patrol', name: '巡逻', apCost: 1, perTurn: 2, when: 'hasSword' },
  ],
};

describe('calendar ⇄ JSON', () => {
  it('往返一致：标量/节点/据点指令（数字还原、JSON 列还原、未知字段保留）', () => {
    const rows = parseCalendarRows(calendarRaw);
    expect(rows.scalars.maxAp).toBe('3');
    expect(rows.nodes).toHaveLength(2);
    expect(rows.nodes[0]!.requires).toBe('');
    expect(rows.nodes[1]!.requires).toBe('["map_01"]');
    const { json, errors } = rowsToCalendar(calendarRaw, rows);
    expect(errors).toEqual([]);
    const nodes = json.nodes as Record<string, unknown>[];
    expect(nodes[0]).toMatchObject({ id: 'map_01', x: 120, isBase: true, apCost: 0, custom: 'keep-me' });
    expect(nodes[1]!.requires).toEqual(['map_01']);
    expect((json.baseCommands as Record<string, unknown>[])[0]!.effects).toEqual({ 'lynn.hp': 5 });
    expect(json.maxTurns).toBe(30);
    expect(json.onTurnStartEventId).toBe('ev_turn_start');
  });

  it('非法输入拦截：重复节点 ID / 坏 when / 坏 JSON / 非数字标量', () => {
    const rows = parseCalendarRows(calendarRaw);
    rows.nodes.push({ id: 'map_01', name: '', x: '', y: '', isBase: false, apCost: '', requires: '', when: '', eventId: '' });
    rows.baseCommands[0]!.when = 'trust >=';
    rows.baseCommands[1]!.effects = '{bad';
    rows.scalars.maxAp = 'abc';
    const { errors } = rowsToCalendar(calendarRaw, rows);
    expect(errors.some((e) => e.includes("'map_01' 重复"))).toBe(true);
    expect(errors.some((e) => e.includes('when') && e.includes('表达式'))).toBe(true);
    expect(errors.some((e) => e.includes('JSON'))).toBe(true);
    expect(errors.some((e) => e.includes('maxAp') && e.includes('数字'))).toBe(true);
  });
});

const eventsRaw = {
  profiles: [{ characterId: 'lynn', variable: 'lynn.trust', tiers: [{ min: 0, stage: '陌生' }] }],
  events: [{ id: 'ev_a', characterId: 'lynn', when: 'lynn.trust >= 30', scene: 'ch01_01', once: true }],
  scheduled: [{ id: 'ev_turn_start', when: 'true', scene: 'ch03_turn_event', once: true, priority: 10, effects: { 'lynn.trust': 2 } }],
};

describe('events ⇄ JSON', () => {
  it('往返一致（profiles/events/scheduled 三表）', () => {
    const rows = parseEventsRows(eventsRaw);
    expect(rows.profiles[0]!.tiers).toBe('[{"min":0,"stage":"陌生"}]');
    const { json, errors } = rowsToEvents(eventsRaw, rows);
    expect(errors).toEqual([]);
    expect((json.events as Record<string, unknown>[])[0]!.once).toBe(true);
    expect((json.scheduled as Record<string, unknown>[])[0]!.effects).toEqual({ 'lynn.trust': 2 });
    expect((json.profiles as Record<string, unknown>[])[0]!.tiers).toEqual([{ min: 0, stage: '陌生' }]);
  });

  it('拦截：重复事件 ID 与坏 when', () => {
    const rows = parseEventsRows(eventsRaw);
    rows.events.push({ id: 'ev_a', characterId: '', when: '', scene: '', once: false, priority: '', effects: '' });
    rows.scheduled[0]!.when = '>>> bad';
    const { errors } = rowsToEvents(eventsRaw, rows);
    expect(errors.some((e) => e.includes("'ev_a' 重复"))).toBe(true);
    expect(errors.some((e) => e.includes('when') && e.includes('表达式'))).toBe(true);
  });
});

const growthRaw = {
  curve: { base: 10, linear: 5 },
  profiles: [{ characterId: 'lynn', initialLevel: 1, maxLevel: 20, statGrowth: { 'lynn.atk': 2 }, levelEvents: { 10: 'ch01_02' } }],
};

describe('growth ⇄ JSON', () => {
  it('往返一致：曲线标量 + profile（JSON 列还原）', () => {
    const rows = parseGrowthRows(growthRaw);
    expect(rows.scalars['curve.base']).toBe('10');
    const { json, errors } = rowsToGrowth(growthRaw, rows);
    expect(errors).toEqual([]);
    expect(json.curve).toEqual({ base: 10, linear: 5 });
    const p = (json.profiles as Record<string, unknown>[])[0]!;
    expect(p.statGrowth).toEqual({ 'lynn.atk': 2 });
    expect(p.levelEvents).toEqual({ 10: 'ch01_02' });
  });

  it('拦截：initialLevel > maxLevel / 曲线非数字 / levelEvents 值非字符串', () => {
    const rows = parseGrowthRows(growthRaw);
    rows.profiles[0]!.initialLevel = '30';
    rows.scalars['curve.base'] = 'xyz';
    const bad = rowsToGrowth(growthRaw, rows);
    expect(bad.errors.some((e) => e.includes('initialLevel'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('base') && e.includes('数字'))).toBe(true);
    const rows2 = parseGrowthRows(growthRaw);
    rows2.profiles[0]!.levelEvents = '{"10": 123}';
    expect(rowsToGrowth(growthRaw, rows2).errors.some((e) => e.includes('levelEvents'))).toBe(true);
  });
});

const galleryRaw = {
  cgs: [{ id: 'cg_hall', name: '大厅重逢', src: 'castle_hall' }],
  music: [{ id: 'tense_01', name: '紧张时刻', src: 'tense_01' }],
  texts: [{ id: 't_first', name: '大厅初遇', scene: 'ch01_01', label: 'start' }],
};

describe('gallery ⇄ JSON', () => {
  it('往返一致（cgs/music/texts 三表）', () => {
    const rows = parseGalleryRows(galleryRaw);
    expect(rows.cgs).toHaveLength(1);
    expect(rows.texts[0]!.scene).toBe('ch01_01');
    const { json, errors } = rowsToGallery(galleryRaw, rows);
    expect(errors).toEqual([]);
    expect((json.cgs as Record<string, unknown>[])[0]!.src).toBe('castle_hall');
  });

  it('拦截重复 CG ID', () => {
    const rows = parseGalleryRows(galleryRaw);
    rows.cgs.push({ id: 'cg_hall', name: '', src: '' });
    expect(rowsToGallery(galleryRaw, rows).errors.some((e) => e.includes("'cg_hall' 重复"))).toBe(true);
  });

  it('空配置容错（null 输入 → 空行表，保存不报错）', () => {
    const rows = parseGalleryRows(null);
    expect(rows.cgs).toEqual([]);
    const { json, errors } = rowsToGallery(null, rows);
    expect(errors).toEqual([]);
    expect(json.cgs).toEqual([]);
  });
});
