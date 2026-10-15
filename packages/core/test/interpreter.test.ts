import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { Interpreter, RuntimeError, interpolate } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { VariableStore } from '../src/state/variable-store.js';
import { createSeededRandomSource } from '../src/runtime/random-source.js';
import { GrowthSystem } from '../src/systems/growth.js';
import type { VarDeclaration } from '../src/state/types.js';
import type { ChoiceEventPayload, TextEventPayload, InstrEventPayload, CoreEventMap } from '../src/runtime/interpreter.js';

function makeRuntime(decls: VarDeclaration[] = []) {
  const store = new VariableStore(decls);
  const bus = new EventBus<CoreEventMap>();
  const registry = new SceneRegistry();
  const interp = new Interpreter(store, bus, registry);
  return { store, bus, registry, interp };
}

const baseDecls: VarDeclaration[] = [
  { name: 'trust', type: 'number', initial: 0 },
  { name: 'hasSword', type: 'flag', initial: false },
  { name: 'heroName', type: 'string', initial: '雷恩' },
];

function textCollector(bus: EventBus<CoreEventMap>): string[] {
  const out: string[] = [];
  bus.on('text', (p) => {
    out.push(`${p.speaker ?? ''}${p.speaker ? '：' : ''}${p.value}`);
  });
  return out;
}

function valueCollector(bus: EventBus<CoreEventMap>): string[] {
  const out: string[] = [];
  bus.on('text', (p) => {
    out.push(p.value);
  });
  return out;
}

function choiceCollector(bus: EventBus<CoreEventMap>): ChoiceEventPayload[] {
  const out: ChoiceEventPayload[] = [];
  bus.on('choice', (p) => {
    out.push(p);
  });
  return out;
}

describe('Interpreter', () => {
  it.each(['plain', '"long sword"', "'long sword'", '""', '"   "'])('#63 preserves persisted inventory token identity after load: %s', token => {
    const compiled = compileScene(`存档停点\n@has_item bag ${token} owned\n@add_item bag ${token}\n检查持有\n@remove_item bag ${token}\n@has_item bag ${token} owned\n检查移除`, 'items.gal', 'items');
    const decls: VarDeclaration[] = [{ name: 'bag', type: 'string[]', initial: [token] }, { name: 'owned', type: 'flag', initial: false }];
    const original = makeRuntime(decls); original.registry.register(compiled); original.interp.start('items');
    const saved = JSON.parse(JSON.stringify(original.interp.saveSnapshot()));
    const restored = makeRuntime(decls); restored.registry.register(compiled); restored.interp.loadSnapshot(saved);
    restored.interp.advance();
    expect(restored.store.get('owned')).toBe(true); expect(restored.store.get('bag')).toEqual([token]);
    restored.interp.advance();
    expect(restored.store.get('owned')).toBe(false); expect(restored.store.get('bag')).toEqual([]);
  });
  it.each([
    ['plain', 'plain'], ['"long id"', 'long id'], ["'long id'", 'long id'],
    [String.raw`"a\"b\\c"`, 'a"b\\c'], ['"a"b"c"', '"a"b"c"'],
  ])('#63 shares the ID decoder across gallery, clear, growth and achievement: %s', (token, id) => {
    const { store, bus, registry, interp } = makeRuntime();
    const growth = new GrowthSystem({ curve: { base: 10 }, profiles: [{ characterId: id }] }, store);
    interp.setGrowth(growth);
    const gallery: CoreEventMap['gallery'][] = [], clear: CoreEventMap['clear'][] = [], systems: CoreEventMap['system'][] = [];
    bus.on('gallery', value => gallery.push(value)); bus.on('clear', value => clear.push(value)); bus.on('system', value => systems.push(value));
    registry.register(compileScene([
      ...['cg', 'music', 'text', 'profile', 'term'].map(kind => `@unlock_${kind} ${token}`),
      `@exp ${token} 2`, `@achievement ${token} ${token}`, `@clear ${token}`,
      '第一句',
    ].join('\n'), 'ids.gal', 'ids'));
    interp.start('ids');
    expect(interp.gallery.snapshot()).toMatchObject({ cgs: [id], music: [id], texts: [id], profiles: [id], terms: [id] });
    expect(gallery.map(value => value.id)).toEqual([id, id, id, id, id]);
    expect(clear).toEqual([{ ending: id, fresh: true }]); expect(growth.experienceOf(id)).toBe(2);
    expect(systems.find(value => value.type === 'achievement')?.args).toEqual([id, id]);
  });
  it.each(['cg', 'music', 'text', 'profile', 'term'] as const)('#63 rejects decoded empty %s IDs before collection or broadcast', kind => {
    for (const token of ['""', "''", '"   "', "'\t'"]) {
      const { bus, registry, interp } = makeRuntime();
      const events: CoreEventMap['gallery'][] = []; bus.on('gallery', value => events.push(value));
      interp.gallery.unlockCg('kept');
      const before = interp.gallery.snapshot();
      registry.register(compileScene(`@unlock_${kind} ${token}\n@end`, 'empty.gal', 'empty'));
      expect(() => interp.start('empty')).toThrow(/非空/);
      expect(interp.gallery.snapshot()).toEqual(before);
      expect(events).toEqual([]);
    }
  });
  it('uses literal item tokens consistently across add, membership and remove', () => {
    const { store, registry, interp } = makeRuntime([{ name: 'bag', type: 'string[]', initial: [] }, { name: 'owned', type: 'flag', initial: false }]);
    registry.register(compileScene('@add_item bag sword\n@has_item bag sword owned\n第一句\n@remove_item bag sword\n@add_item bag "long sword"\n@has_item bag "long sword" owned\n第二句\n@remove_item bag "long sword"\n第三句', 'items.gal', 'items'));
    interp.start('items'); expect(store.get('bag')).toEqual(['sword']); expect(store.get('owned')).toBe(true);
    interp.advance(); expect(store.get('bag')).toEqual(['"long sword"']); expect(store.get('owned')).toBe(true);
    interp.advance(); expect(store.get('bag')).toEqual([]);
  });
  it.each(['cg', 'music', 'text'] as const)('decodes quoted %s IDs before collection and gallery events', kind => {
    const { bus, registry, interp } = makeRuntime();
    const events: CoreEventMap['gallery'][] = []; bus.on('gallery', event => events.push(event));
    registry.register(compileScene(`@unlock_${kind} "long id"\n@unlock_${kind} 'long id'\n@end`, 'gallery.gal', 'gallery'));
    interp.start('gallery');
    expect(events).toEqual([{ type: kind, id: 'long id', fresh: true }, { type: kind, id: 'long id', fresh: false }]);
    const snapshot = interp.gallery.snapshot();
    expect(snapshot[kind === 'cg' ? 'cgs' : kind === 'text' ? 'texts' : 'music']).toEqual(['long id']);
  });
  it.each([
    ['未闭合的 "文案', '@bg "night"'],
    ["未闭合的 '文案", "@bg 'night'"],
    ['未闭合的 "文案', '@bg night'],
    ['已经闭合的 "文案"', '@bg "night"'],
    ['选 "同意 -> @jump fake" 这项', '@bg "night"'],
    ["Don't stop", '@bg "night"'],
  ])('keeps label %s and executes quoted action %s through the actual choice', (label, action) => {
    for (const condition of ['', ' [if:" -> " == " -> "]']) {
      const { bus, registry, interp } = makeRuntime();
      const commands: InstrEventPayload[] = [];
      bus.on('instr', event => commands.push(event));
      const choices = choiceCollector(bus), lines = textCollector(bus);
      registry.register(compileScene(`@scene start\n@choice\n  ${label}${condition} -> ${action} @jump accepted @jump ignored\n错误分支。\n@end`, 'start.gal', 'start'));
      registry.register(compileScene('@scene accepted\n正确分支。\n@end', 'accepted.gal', 'accepted'));
      interp.start('start');
      expect(choices[0]!.options.map(option => option.label)).toEqual([label]);
      interp.choose(0);
      expect(lines).toEqual(['正确分支。']);
      expect(commands.map(command => command.name)).toEqual(['scene', 'bg', 'scene']);
      expect(commands[1]!.args).toEqual([action.slice(4)]);
      expect(commands[2]!.args).toEqual(['accepted']);
    }
  });
  it('shows quoted choice arrows as prose and executes only the selected real action', () => {
    const { bus, registry, interp } = makeRuntime();
    const label = '选 "同意 -> @jump fake" 这项';
    registry.register(compileScene(`@choice\n  ${label} [if:" -> " == " -> "] -> @goto done\n错误分支。\n@label done\n正确分支。\n@end`, 'quoted.gal', 'quoted'));
    const choices = choiceCollector(bus), lines = textCollector(bus);
    interp.start('quoted'); expect(choices[0]!.options[0]!.label).toBe(label);
    interp.choose(0); expect(lines).toEqual(['正确分支。']);
  });
  it('runtime errors leave a failed state that cannot be saved and can be restarted', () => {
    const { registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene('@set missing = 1\n@end', 'bad.gal', 'bad'));
    registry.register(compileScene('恢复后的正文。\n@end', 'good.gal', 'good'));
    expect(() => interp.start('bad')).toThrow();
    expect(interp.status).toBe('error');
    expect(interp.saveSnapshot()).toBeNull();
    interp.start('good');
    expect(interp.status).toBe('awaiting-advance');
  });
  it('顺序执行文本流，逐行 advance', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('凛：你好。\n主角：哦。', 's.gal', 's1'));
    const lines = textCollector(bus);

    interp.start('s1');
    expect(interp.status).toBe('awaiting-advance');
    expect(lines).toEqual(['凛：你好。']);

    interp.advance();
    expect(lines).toEqual(['凛：你好。', '主角：哦。']);
    expect(interp.status).toBe('awaiting-advance');

    interp.advance();
    expect(interp.status).toBe('ended');
  });

  it('R2 @wait：发 wait 事件后挂起 awaiting-timer，finishWait 恢复', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('凛：预备。\n@wait 800\n凛：继续。', 's.gal', 'w1'));
    const waits: number[] = [];
    bus.on('wait', (p) => waits.push(p.ms));
    const texts = valueCollector(bus);

    interp.start('w1');
    expect(interp.status).toBe('awaiting-advance');
    interp.advance(); // 走完第一行文本 → @wait 挂起
    expect(waits).toEqual([800]);
    expect(interp.status).toBe('awaiting-timer');
    expect(texts).toEqual(['预备。']); // 后续文本未执行

    interp.finishWait();
    expect(texts).toEqual(['预备。', '继续。']);
    expect(interp.status).toBe('awaiting-advance');
    // 非 wait 状态调 finishWait 抛错
    expect(() => interp.finishWait()).toThrow(/awaiting-timer/);
  });

  it('R2 @wait：advance() 跳过剩余等待（玩家点击惯例）', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('@wait 9999\n凛：被跳过了。', 's.gal', 'w2'));
    const texts = valueCollector(bus);
    interp.start('w2');
    expect(interp.status).toBe('awaiting-timer');
    interp.advance(); // 点击跳过
    expect(texts).toEqual(['被跳过了。']);
  });

  it('R2 @wait：存档定位回退到 wait 指令，读档重新挂起并再次发 wait 事件', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('@wait 500\n凛：等待之后。', 's.gal', 'w3'));
    interp.start('w3');
    expect(interp.status).toBe('awaiting-timer');
    const snap = interp.saveSnapshot()!;
    expect(snap.position!.pc).toBe(0); // 回退到 wait 指令本身

    const waits: number[] = [];
    bus.on('wait', (p) => waits.push(p.ms));
    interp.loadSnapshot(snap);
    expect(interp.status).toBe('awaiting-timer');
    expect(waits).toEqual([500]); // 读档重新计时
  });

  it('R2 pauseHost/resumeHost：system 事件内暂停，指令流冻结至恢复', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('@battle fight_01\n凛：战后文本。', 's.gal', 'pb'));
    const texts = valueCollector(bus);
    bus.on('system', () => interp.pauseHost()); // 模拟宿主进入交互式战斗

    interp.start('pb');
    expect(interp.status).toBe('paused'); // @battle 后冻结
    expect(texts).toEqual([]); // 后续文本未执行
    interp.advance(); // 暂停中点击无效且不报错
    expect(interp.status).toBe('paused');

    interp.resumeHost(); // 战斗结束恢复
    expect(texts).toEqual(['战后文本。']);
    expect(interp.status).toBe('awaiting-advance');
    // 重复恢复幂等
    interp.resumeHost();
    expect(interp.status).toBe('awaiting-advance');
  });

  it('R3 @switch：按变量值跳转标签，无匹配落到下一条', () => {
    const { bus, registry, interp } = makeRuntime([
      { name: 'chapter', type: 'number', initial: 2 },
    ]);
    registry.register(compileScene(
      '@switch chapter 1:one 2:two\n凛：无匹配。\n@end\n@label one\n凛：第一章。\n@end\n@label two\n凛：第二章。\n@end',
      's.gal', 'sw',
    ));
    const texts = valueCollector(bus);
    interp.start('sw');
    expect(texts).toEqual(['第二章。']);
  });

  it('R3 @switch：条目格式非法编译期抛 C008', () => {
    expect(() => compileScene('@switch a\n凛：x', 's.gal', 'sw2')).toThrow(/C008/);
    expect(() => compileScene('@switch a bad', 's.gal', 'sw3')).toThrow(/C008/);
  });

  it('R3 @check：断言为假抛运行时错误，为真静默通过', () => {
    const { registry, interp } = makeRuntime([{ name: 'trust', type: 'number', initial: 5 }]);
    registry.register(compileScene('@check trust >= 0', 's.gal', 'ok'));
    expect(() => interp.start('ok')).not.toThrow();
    registry.register(compileScene('@check trust > 100', 's.gal', 'bad'));
    expect(() => interp.start('bad')).toThrow(/断言失败/);
  });

  it('R3 @random：写入区间内整数', () => {
    const { store, registry, interp } = makeRuntime([{ name: 'dice', type: 'number', initial: 0 }]);
    registry.register(compileScene('@random dice 3 6', 's.gal', 'rnd'));
    interp.start('rnd');
    const v = store.getNumber('dice');
    expect(v).toBeGreaterThanOrEqual(3);
    expect(v).toBeLessThanOrEqual(6);
    expect(Number.isInteger(v)).toBe(true);
  });

  it('seeded Interpreter uses the same @random sequence for the same seed', () => {
    const run = (): number[] => {
      const { store, registry, interp } = makeRuntime([
        { name: 'first', type: 'number', initial: 0 },
        { name: 'second', type: 'number', initial: 0 },
      ]);
      interp.setRandomSource(createSeededRandomSource(0));
      registry.register(compileScene('@random first 0 100\n@random second 0 100', 's.gal', 'seeded'));
      interp.start('seeded');
      return [store.getNumber('first'), store.getNumber('second')];
    };

    expect(run()).toEqual([26, 0]);
    expect(run()).toEqual([26, 0]);
  });

  it('R3 @loop：回跳标签成循环，条件出口终止', () => {
    const { store, registry, interp } = makeRuntime([{ name: 'n', type: 'number', initial: 0 }]);
    registry.register(compileScene(
      '@label body\n@mod n +1\n@if n >= 3\n@end\n@endif\n@loop body',
      's.gal', 'lp',
    ));
    interp.start('lp');
    expect(store.getNumber('n')).toBe(3);
    expect(interp.status).toBe('ended');
  });

  it('R3 道具指令：add_item/remove_item/has_item 操作 string[] 变量', () => {
    const decls: VarDeclaration[] = [
      { name: 'items', type: 'string[]', initial: [] },
      { name: 'hasKey', type: 'flag', initial: false },
    ];
    const { store, registry, interp } = makeRuntime(decls);
    registry.register(compileScene(
      '@add_item items sword\n@add_item items key\n@add_item items sword\n@has_item items key hasKey\n@remove_item items sword',
      's.gal', 'it',
    ));
    interp.start('it');
    expect(store.get<string[]>('items')).toEqual(['key']); // 去重 + 移除
    expect(store.getBoolean('hasKey')).toBe(true);
  });

  it.each<VarDeclaration>([
    { name: 'bag', type: 'string', initial: 'apple' },
    { name: 'bag', type: 'number[]', initial: [1] },
    { name: 'bag', type: 'number[]', initial: [] },
    { name: 'bag', type: 'object', initial: { apple: true } },
  ])('A001 has_item 拒绝非 string[] 来源 $type ($initial)，保留结果变量', (source) => {
    const { store, registry, interp } = makeRuntime([
      source,
      { name: 'has', type: 'boolean', initial: true },
    ]);
    registry.register(compileScene('@has_item bag app has', 'inventory.gal', 'inventory'));
    expect(() => interp.start('inventory')).toThrow(/@has_item 来源变量必须是 string\[\]/);
    expect(store.getBoolean('has')).toBe(true);
  });

  it.each(['boolean', 'flag'] as const)('A001 has_item 精确匹配并支持 %s 结果及只读背包', (type) => {
    const { store, bus, registry, interp } = makeRuntime([
      { name: 'bag', type: 'string[]', initial: ['apple'], readonly: true },
      { name: 'has', type, initial: false },
    ]);
    registry.register(compileScene('@has_item bag apple has\n持有：{has}\n@has_item bag app has\n持有：{has}', 'inventory.gal', 'inventory'));
    const texts = valueCollector(bus);
    interp.start('inventory');
    expect(store.getBoolean('has')).toBe(true);
    interp.advance();
    expect(store.getBoolean('has')).toBe(false);
    expect(texts).toEqual(['true', 'false']);
    expect(store.get<string[]>('bag')).toEqual(['apple']);
  });

  it.each([
    { name: 'has', type: 'boolean', initial: false, readonly: true },
    { name: 'has', type: 'number', initial: 0 },
  ] satisfies VarDeclaration[])('A001 has_item 拒绝 readonly 或错误类型结果 ($type, $readonly)', (result) => {
    const { store, registry, interp } = makeRuntime([
      { name: 'bag', type: 'string[]', initial: ['apple'] }, result,
    ]);
    registry.register(compileScene('@has_item bag apple has', 'inventory.gal', 'inventory'));
    expect(() => interp.start('inventory')).toThrow(/readonly|expected finite number/);
    expect(store.get('has')).toEqual(result.initial);
  });

  it('R3 道具指令：大数组使用只读内部引用，提交时不原地修改引用', () => {
    const initial = Array.from({ length: 2048 }, (_, i) => `item-${i}`);
    const { store, registry, interp } = makeRuntime([
      { name: 'items', type: 'string[]', initial },
    ]);
    registry.register(compileScene(
      '@add_item items extra\n@remove_item items item-1024',
      's.gal', 'large-items',
    ));
    const before = store.getRef('items');
    interp.start('large-items');

    expect(before).toEqual(initial);
    expect(store.get<string[]>('items')).toContain('extra');
    expect(store.get<string[]>('items')).not.toContain('item-1024');
    expect(store.getRef('items')).not.toBe(before);
  });

  it('R3 @video：阻塞挂起 awaiting-timer，finishWait 恢复；advance 可跳过', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('@video op_01\n凛：视频之后。', 's.gal', 'vd'));
    const videos: string[] = [];
    bus.on('video', (p) => videos.push(p.src));
    const texts = valueCollector(bus);
    interp.start('vd');
    expect(videos).toEqual(['op_01']);
    expect(interp.status).toBe('awaiting-timer');
    expect(texts).toEqual([]);
    interp.advance(); // 玩家点击跳过
    expect(texts).toEqual(['视频之后。']);
  });

  it('R3 hostJump：暂停期间宿主跳转目标场景并恢复', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('@calendar map\n凛：不应执行。', 's.gal', 'a'));
    registry.register(compileScene('@label ev\n凛：事件场景。', 's.gal', 'ev1'));
    const texts = valueCollector(bus);
    bus.on('system', () => {
      interp.pauseHost();
      interp.hostJump('ev1', 'ev'); // 模拟地图节点事件跳转
    });
    interp.start('a');
    expect(texts).toEqual(['事件场景。']);
    expect(interp.status).toBe('awaiting-advance');
  });

  it('变量插值 {var} 与 set/mod 生效', () => {
    const { store, bus, registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene('@set trust = 5\n@mod trust +3\n凛：{heroName} 好感度 {trust}', 's.gal', 's1'));
    const texts = valueCollector(bus);

    interp.start('s1');
    interp.advance();
    expect(store.getNumber('trust')).toBe(8);
    expect(texts).toEqual(['雷恩 好感度 8']);
    expect(interp.status).toBe('ended');
  });

  it('+= 与 -= 支持', () => {
    const { store, registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene('@set trust += 10\n@set trust -= 3', 's.gal', 's1'));
    interp.start('s1');
    expect(store.getNumber('trust')).toBe(7);
    expect(interp.status).toBe('ended');
  });

  it('if 分支：条件为假走 else', () => {
    const { bus, registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene('@if trust >= 5\n凛：甲\n@else\n凛：乙\n@endif', 's.gal', 's1'));
    const texts = valueCollector(bus);

    interp.start('s1');
    expect(texts).toEqual(['乙']); // trust=0 < 5
    interp.advance();
    expect(interp.status).toBe('ended');
  });

  it('if 分支：条件为真走 then', () => {
    const { bus, registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene('@set trust = 10\n@if trust >= 5\n凛：甲\n@else\n凛：乙\n@endif', 's.gal', 's1'));
    const texts = valueCollector(bus);

    interp.start('s1');
    expect(texts).toEqual(['甲']);
    interp.advance();
    expect(interp.status).toBe('ended');
  });

  it('choice：选项事件过滤 when 条件，choose 走对应块', () => {
    const { bus, registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene(
      '@set hasSword = true\n' +
      '@choice\n' +
      '  挥剑 -> @goto sword\n' +
      '  转身 [if:hasSword] -> @goto leave\n' +
      '  沉默 -> @goto silent\n' +
      '@label sword\n凛：挥剑。\n@end\n' +
      '@label leave\n凛：离开。\n@end\n' +
      '@label silent\n凛：沉默。\n@end',
      's.gal', 's1',
    ));
    const choices = choiceCollector(bus);

    interp.start('s1');
    expect(interp.status).toBe('awaiting-choice');
    // 三个选项都可用（hasSword=true）
    expect(choices[0]!.options.map((o) => o.label)).toEqual(['挥剑', '转身', '沉默']);
    expect(choices[0]!.options.map((o) => o.index)).toEqual([0, 1, 2]);

    const texts = valueCollector(bus);
    interp.choose(1); // 转身
    expect(texts).toEqual(['离开。']);
    interp.advance();
    expect(interp.status).toBe('ended');
  });

  it('choice 条件不满足时选项被过滤', () => {
    const { bus, registry, interp } = makeRuntime(baseDecls); // hasSword=false
    registry.register(compileScene(
      '@choice\n' +
      '  挥剑 -> @goto sword\n' +
      '  转身 [if:hasSword] -> @goto leave\n' +
      '@label sword\n凛：挥剑。\n@label leave\n凛：离开。',
      's.gal', 's1',
    ));
    const choices = choiceCollector(bus);

    interp.start('s1');
    expect(choices[0]!.options.map((o) => o.label)).toEqual(['挥剑']);
  });

  it('choice 无可用选项时自动落到 choice 之后', () => {
    const { bus, registry, interp } = makeRuntime(baseDecls); // hasSword=false
    registry.register(compileScene(
      '@choice\n' +
      '  转身 [if:hasSword] -> @goto after\n' +
      '  离开 [if:hasSword] -> @goto after\n' +
      '@label after\n凛：没有可用选项，继续剧情。',
      's.gal', 's1',
    ));
    const texts = valueCollector(bus);

    interp.start('s1');
    expect(interp.status).toBe('awaiting-advance');
    interp.advance();
    expect(texts).toEqual(['没有可用选项，继续剧情。']);
    expect(interp.status).toBe('ended');
  });

  it('跨场景 jump 切换场景', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('凛：第一章。\n@jump ch02.start', 'c1.gal', 'ch01'));
    registry.register(compileScene('@label start\n凛：第二章。', 'c2.gal', 'ch02'));
    const texts = valueCollector(bus);

    interp.start('ch01');
    interp.advance(); // 第一章 → jump → 第二章，挂起
    expect(texts).toEqual(['第一章。', '第二章。']);
    expect(interp.status).toBe('awaiting-advance');

    interp.advance();
    expect(interp.status).toBe('ended');
  });

  it('场景内 goto 跳转到标签', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('凛：前。\n@goto later\n凛：中。\n@label later\n凛：后。', 's.gal', 's1'));
    const texts = valueCollector(bus);

    interp.start('s1');
    interp.advance();
    interp.advance();
    expect(texts).toEqual(['前。', '后。']);
    expect(interp.status).toBe('ended');
  });

  it('展示类通用指令发 instr 事件，状态类直改 store', () => {
    const { store, bus, registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene('@bg castle\n@inc trust\n@show lynn:armor @ left', 's.gal', 's1'));
    const instrs: InstrEventPayload[] = [];
    bus.on('instr', (p) => {
      instrs.push(p);
    });

    interp.start('s1');
    expect(store.getNumber('trust')).toBe(1); // inc 直改
    expect(instrs.map((i) => i.name)).toEqual(['bg', 'show']);
    expect(instrs[1]!.args).toEqual(['lynn:armor']);
    expect(instrs[1]!.modifiers.get('left')).toBe('');
  });

  it('advance/choose 在错误状态调用抛 RuntimeError', () => {
    const { registry, interp } = makeRuntime();
    registry.register(compileScene('凛：x。', 's.gal', 's1'));
    interp.start('s1');
    expect(() => interp.choose(0)).toThrow(RuntimeError);
    interp.advance();
    expect(() => interp.advance()).toThrow(RuntimeError);
  });

  it('jump 到未注册场景抛错', () => {
    const { registry, interp } = makeRuntime();
    registry.register(compileScene('@jump ghost', 's.gal', 's1'));
    expect(() => interp.start('s1')).toThrow(/not registered/);
  });

  it('@flag/@unflag/@toggle', () => {
    const { store, registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene('@flag hasSword\n@unflag hasSword\n@toggle hasSword', 's.gal', 's1'));
    interp.start('s1');
    expect(store.getBoolean('hasSword')).toBe(true); // flag→unflag→toggle
  });

  it('事件回调内可立即推进（choose/advance 重入）', () => {
    const { store, bus, registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene(
      '@choice\n' +
      '  A -> @mod trust +1 @goto a\n' +
      '  B -> @mod trust +2 @goto b\n' +
      '@label a\n凛：A。\n@end\n' +
      '@label b\n凛：B。\n@end',
      's.gal', 's1',
    ));
    const result: string[] = [];
    bus.on('choice', () => interp.choose(1));
    bus.on('text', (p) => {
      result.push(p.value);
      if (interp.status === 'awaiting-advance') interp.advance();
    });

    interp.start('s1');
    expect(store.getNumber('trust')).toBe(2); // 选 B → +2
    expect(result).toEqual(['B。']);
    expect(interp.status).toBe('ended');
  });

  it('X1 事件回调内同步推进 5000 行不栈溢出（迭代续跑）', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `凛：第${i}行。`).join('\n');
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene(lines, 's.gal', 's1'));
    let count = 0;
    bus.on('text', () => {
      count++;
      if (interp.status === 'awaiting-advance') interp.advance();
    });

    interp.start('s1');
    expect(count).toBe(5000);
    expect(interp.status).toBe('ended');
  });

  it('X2 运行时错误带 文件:行:列', () => {
    const { registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene('@if ghost > 1\n凛：x。\n@endif', 's.gal', 's1'));
    expect(() => interp.start('s1')).toThrow(/s\.gal:1:1:/);

    // @jump 未注册场景
    const { registry: r2, interp: i2 } = makeRuntime();
    r2.register(compileScene('@jump ghost', 's.gal', 's1'));
    expect(() => i2.start('s1')).toThrow(/s\.gal:1:1:/);
  });

  it('X3 choose 不能选择条件不满足的选项', () => {
    const { registry, interp } = makeRuntime(baseDecls); // hasSword=false
    registry.register(compileScene(
      '@choice\n' +
      '  A -> @goto a\n' +
      '  B [if:hasSword] -> @goto b\n' +
      '@label a\n凛：A。\n@end\n' +
      '@label b\n凛：B。\n@end',
      's.gal', 's1',
    ));
    interp.start('s1');
    expect(() => interp.choose(1)).toThrow(/条件未满足/);
    // 可用选项仍可正常选择
    interp.choose(0);
    expect(interp.status).toBe('awaiting-advance');
  });

  it('M5 大系统指令发 system 事件（battle/calendar/affection）', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('@battle fight_01\n@calendar map_01\n@affection lynn', 's.gal', 's1'));
    const systems: { type: string; args: string[] }[] = [];
    bus.on('system', (p) => systems.push(p));

    interp.start('s1');
    expect(systems.map((s) => s.type)).toEqual(['battle', 'calendar', 'affection']);
    expect(systems[0]!.args).toEqual(['fight_01']);
  });

  it('死循环守卫：无挂起点的纯 goto 循环抛 RuntimeError', () => {
    const { registry, interp } = makeRuntime();
    registry.register(compileScene('@label loop\n@goto loop', 's.gal', 's1'));
    expect(() => interp.start('s1')).toThrow(/疑似死循环/);
    expect(interp.status).toBe('error');
    expect(interp.saveSnapshot()).toBeNull();
  });

  it('interpolate：{{  }} 转义与未声明变量保留原文', () => {
    const { store } = makeRuntime(baseDecls);
    expect(interpolate('{{heroName}} {heroName} {{x}} {ghost}', store)).toBe('{heroName} 雷恩 {x} {ghost}');
  });

  it('interpolate：非法变量名（{2x}/{.var}）不插值，与表达式解析器规则一致', () => {
    const { store } = makeRuntime(baseDecls);
    expect(interpolate('{2x} {.var} {heroName}', store)).toBe('{2x} {.var} 雷恩');
  });

  it('说话人前缀支持 {var} 插值（{heroName}：渲染为 雷恩：）', () => {
    const { bus, registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene('{heroName}：你好。\n旁白', 's.gal', 's1'));
    const speakers: (string | null)[] = [];
    bus.on('text', (p) => speakers.push(p.speaker));
    interp.start('s1');
    expect(speakers[0]).toBe('雷恩');
    interp.advance();
    expect(speakers[1]).toBe(null); // 旁白无说话人
  });

  it('end 指令发 sceneEnd 事件（含 sceneId，供宿主接结局）', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    const ends: { sceneId: string }[] = [];
    bus.on('sceneEnd', (p) => ends.push(p));

    interp.start('s1');
    expect(ends).toEqual([]);
    interp.advance();
    expect(interp.status).toBe('ended');
    expect(ends).toEqual([{ sceneId: 's1' }]);
  });

  it('sceneEnd 回调内可 start() 新场景（结局→返回标题的自然写法不撞重入守卫）', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('凛：终。\n@end', 's1.gal', 's1'));
    registry.register(compileScene('凛：标题。\n@end', 'title.gal', 'title'));
    const texts: string[] = [];
    bus.on('text', (p) => texts.push(p.value));
    let restarts = 0;
    bus.on('sceneEnd', () => {
      if (restarts++ === 0) interp.start('title');
    });

    interp.start('s1');
    interp.advance(); // 终 → end → sceneEnd 回调 start(title) → 标题挂起
    expect(texts).toEqual(['终。', '标题。']);
    expect(interp.status).toBe('awaiting-advance');
    interp.advance(); // 标题 → end（restarts=1 不重启）→ ended
    expect(interp.status).toBe('ended');
    expect(restarts).toBe(2);
  });

  it('generic instruction callback start() preserves target instruction zero', () => {
    const store = new VariableStore([]);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const interp = new Interpreter(store, bus, registry);
    registry.register(compileScene('@clear old_end\n@end', 'source.gal', 'source'));
    registry.register(compileScene('第一条\n第二条\n@end', 'title.gal', 'title'));
    const texts: string[] = [];
    bus.on('text', (payload) => texts.push(payload.value));
    bus.on('clear', () => interp.start('title'));

    interp.start('source');

    expect(texts).toEqual(['第一条']);
    expect(interp.position).toEqual({ sceneId: 'title', pc: 1 });
    expect(interp.status).toBe('awaiting-advance');
  });

  it('start 清理残留 pendingChoice（前一次 awaiting-choice 后重启不悬挂）', () => {
    const { registry, interp } = makeRuntime(baseDecls);
    registry.register(compileScene('@choice\n  A -> @goto a\n@label a\n凛：A。\n@end', 's.gal', 's1'));
    interp.start('s1');
    expect(interp.status).toBe('awaiting-choice');

    // 不清残留的话旧 choice 会悬挂；清理后可正常重启到新场景并走完
    registry.register(compileScene('凛：新场景。\n@end', 's2.gal', 's2'));
    interp.start('s2');
    expect(interp.status).toBe('awaiting-advance');
    interp.advance();
    expect(interp.status).toBe('ended');
  });

  it('@call 子场景返回调用方继续执行，子场景返回不发 sceneEnd', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('凛：主线。\n@call sub.extra\n凛：回来了。', 'main.gal', 'main'));
    registry.register(compileScene('@label extra\n凛：支线。\n@return\n凛：不会执行。', 'sub.gal', 'sub'));
    const texts: string[] = [];
    const ends: { sceneId: string }[] = [];
    bus.on('text', (p) => texts.push(p.value));
    bus.on('sceneEnd', (p) => ends.push(p));

    interp.start('main');
    interp.advance(); // 主线 → @call sub.extra → 支线
    expect(texts).toEqual(['主线。', '支线。']);
    expect(interp.status).toBe('awaiting-advance');

    interp.advance(); // 支线 → @return（end 指令 + 调用栈非空）→ 回到 主线 的下一行
    expect(texts).toEqual(['主线。', '支线。', '回来了。']);
    expect(interp.status).toBe('awaiting-advance');
    // 子场景返回时不发 sceneEnd（仅真正结束时发，共 1 次）
    expect(ends).toEqual([]);

    interp.advance(); // 回来了 → end（栈空）→ ended
    expect(interp.status).toBe('ended');
    expect(ends).toEqual([{ sceneId: 'main' }]);
  });

  it('@call 嵌套深度超限抛 RuntimeError（MAX_CALL_DEPTH = 64）', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('@call a\n凛：不会到这。', 'main.gal', 'main'));
    // 场景 a/b 互相 @call：无挂起点时同步递归压栈，到 64 层应干净抛错而非栈溢出
    registry.register(compileScene('@call b', 'a.gal', 'a'));
    registry.register(compileScene('@call a', 'b.gal', 'b'));
    bus.on('text', () => {
      if (interp.status === 'awaiting-advance') interp.advance();
    });
    expect(() => interp.start('main')).toThrow(/嵌套深度超过/);
  });

  it('@call 目标支持纯 sceneId；子场景自然结束（无 @return）也返回调用方', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('@call sub\n凛：回到主线。', 'main.gal', 'main'));
    registry.register(compileScene('凛：支线尾。', 'sub.gal', 'sub')); // 无 @return，文末自动追加 end
    const texts = valueCollector(bus);

    interp.start('main'); // @call → 子场景首行文本挂起
    expect(texts).toEqual(['支线尾。']);
    expect(interp.status).toBe('awaiting-advance');

    interp.advance(); // 子场景自然结束（自动 end + 栈非空）→ 返回调用方下一行
    expect(texts).toEqual(['支线尾。', '回到主线。']);
    expect(interp.status).toBe('awaiting-advance');

    interp.advance();
    expect(interp.status).toBe('ended');
  });

  it('@call 无目标场景抛 S006 编译错误', () => {
    expect(() => compileScene('@call\n凛：x。', 's.gal', 's1')).toThrow(/S006/);
  });

  it('text 事件载荷带 wasRead：首次播放 false，读档重放 true（快进按已读跳过用）', () => {
    const { bus, registry, interp } = makeRuntime();
    registry.register(compileScene('凛：甲。\n凛：乙。', 's.gal', 's1'));
    const reads: boolean[] = [];
    bus.on('text', (p) => reads.push(p.wasRead === true));

    interp.start('s1'); // 甲：首次播放
    expect(reads).toEqual([false]);
    interp.advance(); // 乙：首次播放
    expect(reads).toEqual([false, false]);

    // 回退到开头重放（模拟读档后快进）：甲/乙均已标记过
    interp.loadSnapshot(interp.saveSnapshot()!);
    // loadSnapshot 重新挂起到当前位置（乙）并发出 text；此前快照点在乙（pc=2，awaiting-advance → 回退 1 = 指令1 即乙）
    expect(reads.at(-1)).toBe(true);
  });
});
