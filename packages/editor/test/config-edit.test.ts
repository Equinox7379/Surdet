/**
 * E3 配置编辑纯逻辑测试：变量表 ⇄ JSON 往返与校验、成就表往返与 when 语法校验、
 * 剧本变量引用收集（删除保护）。
 */
import { describe, expect, it } from 'vitest';
import { compileScene, CalendarRunner } from '@surdet/core';
import type { CompiledScene, MapNodeDef } from '@surdet/core';
import {
  parseVariablesToRows, rowsToVariables, applyVariablesToConfig,
  parseAchievementsToRows, rowsToAchievements, collectReferencedVars,
  parseCalendarRows, rowsToCalendar,
  parseEventsRows, rowsToEvents,
  parseGrowthRows, rowsToGrowth,
  parseGalleryRows, rowsToGallery,
  parseTerminologyRows, rowsToTerminology,
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
    const player = { subtitle: '可继续编辑', titleBackground: '', endScenes: ['end_a', 'end_b'], firstRunHint: '', extension: { keep: true } };
    const text = applyVariablesToConfig(JSON.stringify({ ...cfg, player }), variables);
    const reparsed = JSON.parse(text) as Record<string, unknown>;
    expect(reparsed.title).toBe('Demo');
    expect(reparsed.entryScene).toBe('ch1');
    expect(reparsed.player).toEqual(player);
    expect(Object.keys(reparsed.variables ?? {})).toEqual(['lynn.trust', 'hasSword', 'readonlyVar']);
    expect(text).toContain('\n  "title"'); // 2 空格缩进
  });

  it('applyVariablesToConfig rejects a non-object top-level config', () => {
    expect(() => applyVariablesToConfig('[]', {
      route: { type: 'string', initial: '' },
    })).toThrow(/game\.config\.json.*JSON 对象/);
  });

  it('preserves escaped strings, scientific numbers and literal prototype keys when saving existing variables', () => {
    const variables = Object.fromEntries([
      ['__proto__', { type: 'number', initial: 7 }],
      ['tiny', { type: 'number', initial: 1e-8 }],
      ['story', { type: 'string', initial: '  第一行\n"第二行"\\结尾  ' }],
    ]);
    const converted = rowsToVariables(parseVariablesToRows({ variables }));
    expect(converted.errors).toEqual([]);
    expect(JSON.parse(applyVariablesToConfig('{}', converted.variables)).variables).toEqual(variables);
  });

  it.each([
    ['number', '9'.repeat(400)],
    ['number[]', '["wrong"]'],
    ['string[]', '[7]'],
    ['object', '[1,2]'],
  ])('rejects a %s initial that the runtime cannot accept', (type, initial) => {
    const converted = rowsToVariables([{ name: 'value', type, initial, min: '', max: '', readonly: false, description: '' }]);
    expect(converted.errors.length).toBeGreaterThan(0);
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

  it('未编辑往返保留数字样式文本，并保留科学计数法数字', () => {
    const raw = {
      nodes: [{ id: '007', name: '123', x: 1e-8, y: 2e-8, apCost: 1e-8, eventId: '123' }],
      baseCommands: [{ id: '001', name: '123', apCost: 1e-8, perTurn: 1e-8, when: 'true', effects: {} }],
    };
    const { json, errors } = rowsToCalendar(raw, parseCalendarRows(raw));
    expect(errors).toEqual([]);
    expect(json).toEqual(raw);
    expect(typeof (json.nodes as Record<string, unknown>[])[0]!.id).toBe('string');
    expect(typeof (json.nodes as Record<string, unknown>[])[0]!.x).toBe('number');
  });

  it('非法输入拦截：重复节点 ID / 坏 when / 坏 JSON / 非数字标量', () => {
    const rows = parseCalendarRows(calendarRaw);
    rows.nodes.push({ id: 'map_01', name: '', x: '', y: '', isBase: false, apCost: '', requires: '', visibleWhen: '', eventId: '' });
    rows.baseCommands[0]!.when = 'trust >=';
    rows.baseCommands[1]!.effects = '{bad';
    rows.scalars.maxAp = 'abc';
    rows.nodes[0]!.x = 'Infinity';
    const { errors } = rowsToCalendar(calendarRaw, rows);
    expect(errors.some((e) => e.includes("'map_01' 重复"))).toBe(true);
    expect(errors.some((e) => e.includes('when') && e.includes('表达式'))).toBe(true);
    expect(errors.some((e) => e.includes('JSON'))).toBe(true);
    expect(errors.some((e) => e.includes('maxAp') && e.includes('数字'))).toBe(true);
    expect(errors.some((e) => e.includes('地图节点') && e.includes('x') && e.includes('有限数字'))).toBe(true);
  });

  it('删行/中间插行时未知字段不错位（按主键合并，审阅轮 Major 1 回归）', () => {
    // 删行方向：删第一行，存活条目不得继承已删条目的 custom
    const delRows = parseCalendarRows(calendarRaw);
    delRows.nodes.splice(0, 1);
    const delJson = rowsToCalendar(calendarRaw, delRows);
    expect(delJson.errors).toEqual([]);
    const delNodes = delJson.json.nodes as Record<string, unknown>[];
    expect(delNodes).toHaveLength(1);
    expect(delNodes[0]!.id).toBe('map_02');
    expect(delNodes[0]!.custom).toBeUndefined(); // keep-me 属于 map_01，不得泄漏
    // 中间插入方向：新行不得拿走他行 custom，原行各自保留
    const insRaw = {
      nodes: [
        { id: 'a', name: 'A', custom: 'A私有' },
        { id: 'b', name: 'B', custom: 'B私有' },
      ],
    };
    const insRows = parseCalendarRows(insRaw);
    insRows.nodes.splice(1, 0, { id: 'new', name: '', x: '', y: '', isBase: false, apCost: '', requires: '', visibleWhen: '', eventId: '' });
    const insJson = rowsToCalendar(insRaw, insRows);
    const insNodes = insJson.json.nodes as Record<string, unknown>[];
    expect(insNodes.map((n) => n.id)).toEqual(['a', 'new', 'b']);
    expect(insNodes[0]!.custom).toBe('A私有');
    expect(insNodes[1]!.custom).toBeUndefined();
    expect(insNodes[2]!.custom).toBe('B私有');
  });

  it('据点指令改名仍保留 eventId/未知字段，且插入行不串用原条目', () => {
    const raw = {
      baseCommands: [
        { id: 'rest', name: '休息', apCost: 1, eventId: 'rest_scene', future: 'rest-only' },
        { id: 'patrol', name: '巡逻', apCost: 2, eventId: 'patrol_scene', future: 'patrol-only' },
      ],
    };
    const rows = parseCalendarRows(raw);
    rows.baseCommands[0]!.id = 'rest_evening';
    rows.baseCommands.splice(1, 0, { id: 'new', name: '', apCost: '', when: '', effects: '', perTurn: '' });

    const { json, errors } = rowsToCalendar(raw, rows);
    expect(errors).toEqual([]);
    expect(json.baseCommands).toEqual([
      { id: 'rest_evening', name: '休息', apCost: 1, eventId: 'rest_scene', future: 'rest-only' },
      { id: 'new' },
      { id: 'patrol', name: '巡逻', apCost: 2, eventId: 'patrol_scene', future: 'patrol-only' },
    ]);
  });
});

describe('N1：calendar node 开放条件 canonical visibleWhen（Editor → Runtime 语义一致）', () => {
  const baseCfg = { maxAp: 3, maxTurns: 10, dateTemplate: '第{turn}周' };
  const envOf = (locked: boolean) => ({ getVariable: (name: string) => (name === 'lockedFlag' ? locked : undefined) });

  it('RED1 新建条件：row.visibleWhen 保存为 canonical，不输出 when', () => {
    const raw = { ...baseCfg, nodes: [{ id: 'locked', name: 'L', x: 0, y: 0, apCost: 1 }] };
    const rows = parseCalendarRows(raw);
    rows.nodes[0]!.visibleWhen = 'locked == true';
    const { json, errors } = rowsToCalendar(raw, rows);
    expect(errors).toEqual([]);
    const node = (json.nodes as Record<string, unknown>[])[0]!;
    expect(node.visibleWhen).toBe('locked == true');
    expect('when' in node).toBe(false);
  });

  it('RED2 legacy when-only：parse 迁移显示 + 保存正规化为 visibleWhen（未知字段保留）', () => {
    const raw = { ...baseCfg, nodes: [{ id: 'n1', name: 'L', x: 0, y: 0, apCost: 1, when: 'legacyFlag == true', futureField: { k: 1 } }] };
    const rows = parseCalendarRows(raw);
    expect(rows.nodes[0]!.visibleWhen).toBe('legacyFlag == true');
    const { json, errors } = rowsToCalendar(raw, rows);
    expect(errors).toEqual([]);
    const node = (json.nodes as Record<string, unknown>[])[0]!;
    expect(node.visibleWhen).toBe('legacyFlag == true');
    expect('when' in node).toBe(false);
    expect(node.futureField).toEqual({ k: 1 });
  });

  it('RED3 canonical roundtrip：已有 visibleWhen 在 UI 可见可改，关闭 stale runtime condition', () => {
    const raw = { ...baseCfg, nodes: [{ id: 'n1', name: 'L', x: 0, y: 0, apCost: 1, visibleWhen: 'oldFlag == true' }] };
    const rows = parseCalendarRows(raw);
    expect(rows.nodes[0]!.visibleWhen).toBe('oldFlag == true');
    rows.nodes[0]!.visibleWhen = 'newFlag == true';
    const { json, errors } = rowsToCalendar(raw, rows);
    expect(errors).toEqual([]);
    const node = (json.nodes as Record<string, unknown>[])[0]!;
    expect(node.visibleWhen).toBe('newFlag == true');
    expect('when' in node).toBe(false);
  });

  it('RED4 双字段等值冗余：保存正规化（保留 visibleWhen、删除 when）', () => {
    const raw = { ...baseCfg, nodes: [{ id: 'n1', name: 'L', x: 0, y: 0, apCost: 1, visibleWhen: 'A', when: 'A' }] };
    const rows = parseCalendarRows(raw);
    const { json, errors } = rowsToCalendar(raw, rows);
    expect(errors).toEqual([]);
    const node = (json.nodes as Record<string, unknown>[])[0]!;
    expect(node.visibleWhen).toBe('A');
    expect('when' in node).toBe(false);
  });

  it('RED5 双字段冲突：fail-loud 阻止保存，源对象不被改动', () => {
    const raw = { ...baseCfg, nodes: [{ id: 'n1', name: 'L', x: 0, y: 0, apCost: 1, visibleWhen: 'A', when: 'B' }] };
    const rows = parseCalendarRows(raw);
    const { errors } = rowsToCalendar(raw, rows);
    expect(errors.some((e) => e.includes('冲突'))).toBe(true);
    expect(raw.nodes[0]!.when).toBe('B');
    expect(raw.nodes[0]!.visibleWhen).toBe('A');
  });

  it('跨层 oracle：Editor 保存的节点交 CalendarRunner，可见性语义正确（lockedFlag=false 隐藏 / true 显示）', () => {
    const raw = { ...baseCfg, nodes: [{ id: 'locked', name: 'L', x: 0, y: 0, apCost: 1 }] };
    const rows = parseCalendarRows(raw);
    rows.nodes[0]!.visibleWhen = 'lockedFlag == true';
    const { json, errors } = rowsToCalendar(raw, rows);
    expect(errors).toEqual([]);
    const node = (json.nodes as unknown as MapNodeDef[])[0]!;
    const cfg = { maxAp: 3, maxTurns: 10, dateTemplate: 'x', nodes: [node] };
    expect(new CalendarRunner(cfg, envOf(false)).isVisible(node)).toBe(false);
    expect(new CalendarRunner(cfg, envOf(true)).isVisible(node)).toBe(true);
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

  it('未编辑往返保留数字样式文本，并保留科学计数法 priority', () => {
    const raw = {
      profiles: [{ characterId: '123', variable: '007', tiers: ['123'] }],
      events: [{ id: '001', characterId: '123', when: 'true', scene: '123', once: true, priority: 1e-8, effects: {} }],
      scheduled: [],
    };
    const { json, errors } = rowsToEvents(raw, parseEventsRows(raw));
    expect(errors).toEqual([]);
    expect(json).toEqual(raw);
    expect(typeof (json.events as Record<string, unknown>[])[0]!.id).toBe('string');
    expect(typeof (json.events as Record<string, unknown>[])[0]!.priority).toBe('number');
  });

  it('拦截：重复事件 ID 与坏 when', () => {
    const rows = parseEventsRows(eventsRaw);
    rows.events.push({ id: 'ev_a', characterId: '', when: '', scene: '', once: false, priority: '', effects: '' });
    rows.scheduled[0]!.when = '>>> bad';
    rows.scheduled[0]!.priority = 'Infinity';
    const { errors } = rowsToEvents(eventsRaw, rows);
    expect(errors.some((e) => e.includes("'ev_a' 重复"))).toBe(true);
    expect(errors.some((e) => e.includes('when') && e.includes('表达式'))).toBe(true);
    expect(errors.some((e) => e.includes('日程事件') && e.includes('priority') && e.includes('有限数字'))).toBe(true);
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

  it('有限数字列拒绝 Infinity，并保留科学计数法等级', () => {
    const rows = parseGrowthRows(growthRaw);
    rows.profiles[0]!.initialLevel = '1e-8';
    const ok = rowsToGrowth(growthRaw, rows);
    expect(ok.errors).toEqual([]);
    expect((ok.json.profiles as Record<string, unknown>[])[0]!.initialLevel).toBe(1e-8);

    rows.profiles[0]!.initialLevel = 'Infinity';
    const bad = rowsToGrowth(growthRaw, rows);
    expect(bad.errors.some((e) => e.includes('initialLevel') && e.includes('数字'))).toBe(true);
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

  it('未编辑往返保留数字样式文本字段', () => {
    const raw = {
      cgs: [{ id: '007', name: '123', src: '001' }],
      music: [{ id: '002', name: '003', src: '004' }],
      texts: [{ id: '123', name: '007', scene: '123', label: '001' }],
    };
    const { json, errors } = rowsToGallery(raw, parseGalleryRows(raw));
    expect(errors).toEqual([]);
    expect(json).toEqual(raw);
    expect(typeof (json.cgs as Record<string, unknown>[])[0]!.id).toBe('string');
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

describe('terminology ⇄ JSON', () => {
  const termRaw = {
    terms: [
      { canonical: '星辉剑', variants: ['星辉之剑', '星剑'] },
      { canonical: '凛', variants: ['凛小姐'] },
    ],
  };

  it('往返一致（variants JSON 列还原）', () => {
    const rows = parseTerminologyRows(termRaw);
    expect(rows.terms).toHaveLength(2);
    expect(rows.terms[0]!.variants).toBe('["星辉之剑","星剑"]');
    const { json, errors } = rowsToTerminology(termRaw, rows);
    expect(errors).toEqual([]);
    expect(json.terms).toEqual(termRaw.terms);
  });

  it('未编辑往返保留数字样式 canonical 文本', () => {
    const raw = { terms: [{ canonical: '123', variants: ['007'] }] };
    const { json, errors } = rowsToTerminology(raw, parseTerminologyRows(raw));
    expect(errors).toEqual([]);
    expect(json).toEqual(raw);
    expect(typeof (json.terms as Record<string, unknown>[])[0]!.canonical).toBe('string');
  });

  it('拦截：规范词重复 / 坏 variants JSON', () => {
    const rows = parseTerminologyRows(termRaw);
    rows.terms.push({ canonical: '星辉剑', variants: '[]' });
    rows.terms[1]!.variants = '{bad';
    const { errors } = rowsToTerminology(termRaw, rows);
    expect(errors.some((e) => e.includes("'星辉剑' 重复"))).toBe(true);
    expect(errors.some((e) => e.includes('JSON'))).toBe(true);
  });

  it('空配置容错：null 输入可保存为空 terms 文件', () => {
    const rows = parseTerminologyRows(null);
    expect(rows.terms).toEqual([]);
    const { json, errors } = rowsToTerminology(null, rows);
    expect(errors).toEqual([]);
    expect(json.terms).toEqual([]);
  });
});
