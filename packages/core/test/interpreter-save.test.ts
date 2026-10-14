import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { Interpreter } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { VariableStore } from '../src/state/variable-store.js';
import { SaveManager } from '../src/save/save-manager.js';
import type { SystemSnapshots } from '../src/save/save-manager.js';
import type { VarDeclaration } from '../src/state/types.js';
import type { CoreEventMap } from '../src/runtime/interpreter.js';
import { createSeededRandomSource } from '../src/runtime/random-source.js';
import { GrowthSystem } from '../src/systems/growth.js';

const decls: VarDeclaration[] = [
  { name: 'trust', type: 'number', initial: 0 },
];

function makeInterp(variableDecls: VarDeclaration[] = decls) {
  const store = new VariableStore(variableDecls);
  const bus = new EventBus<CoreEventMap>();
  const registry = new SceneRegistry();
  const interp = new Interpreter(store, bus, registry);
  return { store, bus, registry, interp };
}

describe('Interpreter 存档', () => {
  it('A002 合法范围初值经过正文存读档与 reset 保持一致', () => {
    const { store, registry, interp } = makeInterp([{ name: 'score', type: 'number', initial: 5, min: 0, max: 10 }]);
    registry.register(compileScene('当前：{score}', 'bounded.gal', 'bounded'));
    interp.start('bounded');
    const snapshot = interp.saveSnapshot()!;
    expect(snapshot.variables.score).toBe(5);
    store.set('score', 9);
    interp.loadSnapshot(snapshot);
    expect(store.getNumber('score')).toBe(5);
    store.set('score', 9);
    store.reset();
    interp.start('bounded');
    expect(store.getNumber('score')).toBe(5);
  });

  it('旧档缺少成长状态时恢复配置初值，不继承当前等级和经验', () => {
    const { store, registry, interp } = makeInterp();
    const growth = new GrowthSystem({ curve: { base: 10 }, profiles: [{ characterId: 'rin', initialLevel: 2 }] }, store);
    interp.setGrowth(growth);
    registry.register(compileScene('正文。', 's.gal', 's1'));
    interp.start('s1');
    const saved = interp.saveSnapshot()!;
    delete saved.growth;
    growth.gainExp('rin', 15);
    expect(growth.levelOf('rin')).toBe(3);
    interp.loadSnapshot(saved);
    expect(growth.levelOf('rin')).toBe(2);
    expect(growth.experienceOf('rin')).toBe(0);
  });

  it('refuses non-JSON-safe system state instead of silently losing Map contents', () => {
    const store = new VariableStore(decls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const interp = new Interpreter(store, bus, registry, undefined, undefined, {
      snapshot: () => ({ custom: new Map([['key', 1]]) }) as unknown as SystemSnapshots,
      restore: () => {},
    });
    registry.register(compileScene('正文。', 's.gal', 's1')); interp.start('s1');
    expect(() => interp.saveSnapshot()).toThrow(/JSON/);
  });

  it('empty quoted clear IDs use the current scene identity', () => {
    const { bus, registry, interp } = makeInterp();
    const endings: string[] = [];
    bus.on('clear', event => endings.push(event.ending));
    registry.register(compileScene('@clear ""\n正文。', 's.gal', 's1')); interp.start('s1');
    expect(endings).toEqual(['s1']);
  });
  it('旧档缺少后来新增的变量时恢复声明初值，不继承当前会话', () => {
    const { store, registry, interp } = makeInterp();
    registry.register(compileScene('正文。', 's.gal', 's1')); interp.start('s1');
    const saved = interp.saveSnapshot()!; delete saved.variables['trust'];
    store.set('trust', 99); interp.loadSnapshot(saved);
    expect(store.getNumber('trust')).toBe(0);
  });

  it('外部修改导出的调用栈不会改动运行中的返回位置', () => {
    const { registry, interp } = makeInterp();
    registry.register(compileScene('@call sub\n返回正文。', 'main.gal', 'main'));
    registry.register(compileScene('子场景。\n@return', 'sub.gal', 'sub'));
    interp.start('main');
    const saved = interp.saveSnapshot()!;
    const pc = saved.callStack![0]!.pc;
    saved.callStack![0]!.pc = 999;
    expect(interp.saveSnapshot()!.callStack![0]!.pc).toBe(pc);
  });
  it('saveSnapshot 捕获变量/定位/已读/解锁', () => {
    const { store, registry, interp } = makeInterp();
    registry.register(compileScene('@set trust = 7\n凛：甲。\n凛：乙。', 's.gal', 's1'));

    interp.start('s1'); // 挂起在第一行文本
    const snap = interp.saveSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.variables['trust']).toBe(7);
    expect(snap!.position).toMatchObject({ sceneId: 's1', pc: 1 }); // pc 指向当前显示行（凛：甲。）
    expect(snap!.position!.sceneHash).toBeTruthy(); // 场景源码哈希随存档保存（读档一致性校验用）
    expect(snap!.readSet).toContain('s1#1'); // 已读 key = 场景ID#指令索引
  });

  it('loadSnapshot 恢复变量/已读/解锁并重新挂起', () => {
    const { bus, registry, interp } = makeInterp();
    registry.register(compileScene('@set trust = 7\n凛：甲。\n凛：乙。', 's.gal', 's1'));

    interp.start('s1');
    const snap = interp.saveSnapshot()!;
    interp.advance(); // 推进到乙，改状态
    expect(interp.status).toBe('awaiting-advance');

    // 恢复：变量回到 7，定位回甲（重新发出 text 事件）
    const texts: string[] = [];
    bus.on('text', (p) => texts.push(p.value));
    interp.loadSnapshot(snap);
    expect(interp.status).toBe('awaiting-advance');
    expect(texts).toEqual(['甲。']);
    expect(interp.readTracker.has('s1#1')).toBe(true);
  });

  it('旧快照缺少 random 时仍可加载', () => {
    const { store, registry, interp } = makeInterp();
    registry.register(compileScene('凛：旧档正文。', 'legacy.gal', 'legacy-save'));

    interp.start('legacy-save');
    const legacy = interp.saveSnapshot()!;
    expect(legacy.random).toBeUndefined();

    store.set('trust', 99);
    interp.loadSnapshot(legacy);

    expect(store.getNumber('trust')).toBe(0);
    expect(interp.status).toBe('awaiting-advance');
    expect(interp.savePosition()).toMatchObject({ sceneId: 'legacy-save', pc: 0 });
  });

  it('保存并恢复 seeded random state 后，下一次 @random 值保持连续', () => {
    const { registry, interp } = makeInterp([...decls, { name: 'roll', type: 'number', initial: 0 }]);
    const source = createSeededRandomSource(7);
    interp.setRandomSource(source);
    registry.register(compileScene('@random roll 0 100\n凛：暂停。', 's.gal', 'seeded-save'));

    interp.start('seeded-save');
    const snap = interp.saveSnapshot()!;
    expect(snap.random).toMatchObject({ algorithm: 'mulberry32-v1' });
    const expectedNext = source.next();
    source.next();

    interp.loadSnapshot(snap);
    expect(source.next()).toBe(expectedNext);
  });

  it('含 random 的快照遇到不可恢复随机源时 fail-loud 且不改变现有运行状态', () => {
    const { store, registry, interp } = makeInterp([
      ...decls,
      { name: 'roll', type: 'number', initial: 0 },
    ]);
    const seeded = createSeededRandomSource(7);
    interp.setRandomSource(seeded);
    registry.register(compileScene('@random roll 0 100\n凛：当前。\n@end', 'seeded.gal', 'seeded-state'));

    interp.start('seeded-state');
    const incoming = interp.saveSnapshot()!;
    expect(incoming.random).toMatchObject({ algorithm: 'mulberry32-v1' });

    interp.advance();
    interp.setRandomSource({ next: () => 0.5 });
    const before = {
      variables: store.snapshot(),
      position: interp.savePosition(),
      status: interp.status,
      readSet: interp.readTracker.snapshot(),
      gallery: interp.gallery.snapshot(),
      clears: interp.clearTracker.snapshot(),
    };

    expect(() => interp.loadSnapshot(incoming)).toThrow(/没有可恢复的随机源/);
    expect(store.snapshot()).toEqual(before.variables);
    expect(interp.savePosition()).toEqual(before.position);
    expect(interp.status).toBe(before.status);
    expect(interp.readTracker.snapshot()).toEqual(before.readSet);
    expect(interp.gallery.snapshot()).toEqual(before.gallery);
    expect(interp.clearTracker.snapshot()).toEqual(before.clears);
  });

  it('缺失目标场景时拒绝读档且保留选择等待、快照状态与继续能力', () => {
    const { store, bus, registry, interp } = makeInterp([
      ...decls,
      { name: 'roll', type: 'number', initial: 0 },
    ]);
    const random = createSeededRandomSource(11);
    interp.setRandomSource(random);
    registry.register(compileScene(
      '@set trust = 5\n' +
      '@choice\n' +
      '  继续 -> @goto after\n' +
      '  结束 -> @end\n' +
      '@label after\n凛：仍可继续。\n@end',
      'current.gal',
      'current',
    ));
    const choiceEvents: unknown[] = [];
    const textEvents: string[] = [];
    const rejectedEvents: string[] = [];
    bus.on('choice', (payload) => choiceEvents.push(payload));
    bus.on('text', (payload) => textEvents.push(payload.value));
    bus.on('stateReset', () => rejectedEvents.push('stateReset'));
    bus.on('saveMigrated', () => rejectedEvents.push('saveMigrated'));

    interp.start('current');
    expect(interp.status).toBe('awaiting-choice');
    const before = {
      variables: store.snapshot(),
      random: random.snapshot(),
      readSet: interp.readTracker.snapshot(),
      gallery: interp.gallery.snapshot(),
      clears: interp.clearTracker.snapshot(),
      position: interp.savePosition(),
      status: interp.status,
    };
    const incoming = interp.saveSnapshot()!;
    incoming.meta = { ...incoming.meta, id: 'missing-scene' };
    incoming.variables = { trust: 99, roll: 77 };
    incoming.readSet = ['missing-scene#4'];
    incoming.random = { ...before.random, state: (before.random.state + 1) >>> 0 };
    incoming.position = { sceneId: 'missing-scene', pc: 0 };

    expect(() => interp.loadSnapshot(incoming)).toThrow(/未注册/);
    expect(store.snapshot()).toEqual(before.variables);
    expect(random.snapshot()).toEqual(before.random);
    expect(interp.readTracker.snapshot()).toEqual(before.readSet);
    expect(interp.gallery.snapshot()).toEqual(before.gallery);
    expect(interp.clearTracker.snapshot()).toEqual(before.clears);
    expect(interp.savePosition()).toEqual(before.position);
    expect(interp.status).toBe(before.status);
    expect(choiceEvents).toHaveLength(1);
    expect(rejectedEvents).toEqual([]);

    interp.choose(0);
    expect(textEvents).toEqual(['仍可继续。']);
    expect(interp.status).toBe('awaiting-advance');
  });

  it('目标场景有效但变量声明类型不匹配时不先恢复随机状态', () => {
    const { store, bus, registry, interp } = makeInterp([
      ...decls,
      { name: 'roll', type: 'number', initial: 0 },
    ]);
    const random = createSeededRandomSource(13);
    interp.setRandomSource(random);
    registry.register(compileScene('凛：当前。', 'current.gal', 'current'));
    interp.start('current');
    const before = {
      variables: store.snapshot(),
      random: random.snapshot(),
      position: interp.savePosition(),
      status: interp.status,
    };
    const rejectedEvents: string[] = [];
    bus.on('stateReset', () => rejectedEvents.push('stateReset'));
    bus.on('saveMigrated', () => rejectedEvents.push('saveMigrated'));
    const incoming = interp.saveSnapshot()!;
    incoming.variables = { trust: 'wrong', roll: 88 } as never;
    incoming.random = { ...before.random, state: (before.random.state + 1) >>> 0 };

    expect(() => interp.loadSnapshot(incoming)).toThrow(/Variable 'trust'.*expected finite number/);
    expect(store.snapshot()).toEqual(before.variables);
    expect(random.snapshot()).toEqual(before.random);
    expect(interp.savePosition()).toEqual(before.position);
    expect(interp.status).toBe(before.status);
    expect(rejectedEvents).toEqual([]);
  });

  it('text 事件回调内 loadSnapshot 在任何状态写入前拒绝重入', () => {
    const { store, bus, registry, interp } = makeInterp([
      ...decls,
      { name: 'roll', type: 'number', initial: 0 },
    ]);
    const random = createSeededRandomSource(17);
    interp.setRandomSource(random);
    registry.register(compileScene('凛：当前。\n凛：之后。', 'reentry-text.gal', 'reentry-text'));

    let attempted = false;
    let caught: unknown;
    let before: {
      variables: ReturnType<typeof store.snapshot>;
      random: ReturnType<typeof random.snapshot>;
      readSet: ReturnType<typeof interp.readTracker.snapshot>;
      position: ReturnType<typeof interp.savePosition>;
      status: typeof interp.status;
    } | null = null;
    let stateResetCount = 0;
    bus.on('stateReset', () => { stateResetCount++; });
    bus.on('text', () => {
      if (attempted) return;
      attempted = true;
      before = {
        variables: store.snapshot(),
        random: random.snapshot(),
        readSet: interp.readTracker.snapshot(),
        position: interp.savePosition(),
        status: interp.status,
      };
      const incoming = interp.saveSnapshot()!;
      incoming.variables = { trust: 99, roll: 8 };
      incoming.readSet = ['replacement#1'];
      incoming.random = { ...before.random, state: (before.random.state + 1) >>> 0 };
      incoming.position = { ...incoming.position!, pc: 1 };
      try {
        interp.loadSnapshot(incoming);
      } catch (error) {
        caught = error;
      }
    });

    interp.start('reentry-text');
    expect(attempted).toBe(true);
    expect(String(caught)).toMatch(/重入/);
    expect(store.snapshot()).toEqual(before!.variables);
    expect(random.snapshot()).toEqual(before!.random);
    expect(interp.readTracker.snapshot()).toEqual(before!.readSet);
    expect(interp.savePosition()).toEqual(before!.position);
    expect(interp.status).toBe(before!.status);
    expect(stateResetCount).toBe(0);
  });

  it('choice 事件回调内 loadSnapshot 拒绝重入并保留选择等待', () => {
    const { store, bus, registry, interp } = makeInterp([
      ...decls,
      { name: 'roll', type: 'number', initial: 0 },
    ]);
    const random = createSeededRandomSource(19);
    interp.setRandomSource(random);
    registry.register(compileScene(
      '凛：开场。\n' +
      '@choice\n' +
      '  继续 -> @goto after\n' +
      '  结束 -> @end\n' +
      '@label after\n凛：继续。',
      'reentry-choice.gal',
      'reentry-choice',
    ));

    let attempted = false;
    let caught: unknown;
    let before: {
      variables: ReturnType<typeof store.snapshot>;
      random: ReturnType<typeof random.snapshot>;
      readSet: ReturnType<typeof interp.readTracker.snapshot>;
      position: ReturnType<typeof interp.savePosition>;
      status: typeof interp.status;
    } | null = null;
    let stateResetCount = 0;
    bus.on('stateReset', () => { stateResetCount++; });
    bus.on('choice', () => {
      if (attempted) return;
      attempted = true;
      before = {
        variables: store.snapshot(),
        random: random.snapshot(),
        readSet: interp.readTracker.snapshot(),
        position: interp.savePosition(),
        status: interp.status,
      };
      const incoming = interp.saveSnapshot()!;
      incoming.variables = { trust: 88, roll: 7 };
      incoming.readSet = ['replacement#2'];
      incoming.random = { ...before.random, state: (before.random.state + 1) >>> 0 };
      incoming.position = { ...incoming.position!, pc: 0 };
      try {
        interp.loadSnapshot(incoming);
      } catch (error) {
        caught = error;
      }
    });

    interp.start('reentry-choice');
    interp.advance();
    expect(attempted).toBe(true);
    expect(String(caught)).toMatch(/重入/);
    expect(store.snapshot()).toEqual(before!.variables);
    expect(random.snapshot()).toEqual(before!.random);
    expect(interp.readTracker.snapshot()).toEqual(before!.readSet);
    expect(interp.savePosition()).toEqual(before!.position);
    expect(interp.status).toBe(before!.status);
    expect(stateResetCount).toBe(0);

    interp.choose(0);
    expect(interp.status).toBe('awaiting-advance');
  });

  it('@unlock_cg/@unlock_music 更新解锁状态并广播事件', () => {
    const { bus, registry, interp } = makeInterp();
    registry.register(compileScene('@unlock_cg cg_end\n@unlock_cg cg_end\n@unlock_music m_op', 's.gal', 's1'));
    const events: { type: string; id: string; fresh: boolean }[] = [];
    bus.on('gallery', (p) => events.push(p));

    interp.start('s1');
    expect(interp.gallery.cgs).toEqual(['cg_end']);
    expect(interp.gallery.music).toEqual(['m_op']);
    expect(events).toHaveLength(3);
    expect(events[0]!.fresh).toBe(true);
    expect(events[1]!.fresh).toBe(false); // 重复解锁
  });

  it('@clear：记录结局 + 广播 clear 事件（缺省结局 = 场景 ID；重复达成 fresh=false）', () => {
    const { bus, registry, interp } = makeInterp();
    registry.register(compileScene('@clear\n@clear bad_end\n@clear bad_end', 's.gal', 'end_a'));
    const events: { ending: string; fresh: boolean }[] = [];
    bus.on('clear', (p) => events.push(p));

    interp.start('end_a');
    expect(interp.clearTracker.endings()).toEqual(['end_a', 'bad_end']);
    expect(interp.clearTracker.isCleared()).toBe(true);
    expect(events).toEqual([
      { ending: 'end_a', fresh: true },
      { ending: 'bad_end', fresh: true },
      { ending: 'bad_end', fresh: false },
    ]);
  });

  it('@clear 结局收集随存档往返（读档恢复）', () => {
    const { registry, interp } = makeInterp();
    registry.register(compileScene('@clear good_end\n凛：终。', 's.gal', 'fin'));

    interp.start('fin');
    interp.advance(); // 挂起在文本
    const snap = interp.saveSnapshot()!;
    expect(snap.clears?.endings).toEqual(['good_end']);

    // 新解释器读档：通关记录恢复
    const { registry: r2, interp: i2 } = makeInterp();
    r2.register(compileScene('@clear good_end\n凛：终。', 's.gal', 'fin'));
    i2.loadSnapshot(snap);
    expect(i2.clearTracker.endings()).toEqual(['good_end']);
  });

  it('@clear/@achievement 带引号参数：解释器侧消费的 ID 统一去引号（引号契约）', () => {
    const { bus, registry, interp } = makeInterp();
    registry.register(compileScene('@clear "ed_quoted"\n@achievement "unlock" "ach_1"', 's.gal', 's1'));
    const clears: { ending: string; fresh: boolean }[] = [];
    const systems: { type: string; args: string[] }[] = [];
    bus.on('clear', (p) => clears.push(p));
    bus.on('system', (p) => systems.push({ type: p.type, args: p.args }));

    interp.start('s1');
    expect(clears).toEqual([{ ending: 'ed_quoted', fresh: true }]); // 不带引号（而非 '"ed_quoted"'）
    expect(interp.clearTracker.endings()).toEqual(['ed_quoted']);
    expect(systems).toEqual([{ type: 'achievement', args: ['unlock', 'ach_1'] }]);
  });

  it('loadSnapshot 在场景中段恢复能继续推进', () => {
    const { bus, registry, interp } = makeInterp();
    registry.register(compileScene('@set trust = 7\n凛：甲。\n凛：乙。', 's.gal', 's1'));

    interp.start('s1');
    const snap = interp.saveSnapshot()!;

    const texts: string[] = [];
    bus.on('text', (p) => texts.push(p.value));
    interp.loadSnapshot(snap);
    expect(texts).toEqual(['甲。']);
    interp.advance();
    expect(texts).toEqual(['甲。', '乙。']);
    expect(interp.status).toBe('awaiting-advance');
    interp.advance();
    expect(interp.status).toBe('ended');
  });

  it('@autosave/@savepoint 分别发 auto/manual 快照事件', () => {
    const { bus, registry, interp } = makeInterp();
    registry.register(compileScene('@set trust = 7\n凛：甲。\n@autosave\n@savepoint\n凛：乙。', 's.gal', 's1'));
    const kinds: string[] = [];
    bus.on('autosave', (p) => kinds.push(p.kind));
    bus.on('savepoint', (p) => kinds.push(p.kind));

    interp.start('s1');
    interp.advance(); // 甲 → autosave → savepoint → 乙
    expect(kinds).toEqual(['auto', 'manual']);
    expect(interp.status).toBe('awaiting-advance');
  });

  it('@autosave 快照 position 指向下一条指令（读档不重跑 autosave）', () => {
    const { bus, registry, interp } = makeInterp();
    registry.register(compileScene('凛：甲。\n@autosave\n凛：乙。', 's.gal', 's1'));
    let snapPos: { sceneId: string; pc: number; sceneHash?: string } | null = null;
    bus.on('autosave', (p) => { snapPos = p.position; });

    interp.start('s1');
    interp.advance(); // 甲 → @autosave（index 1）：position 应指向 index 2（凛：乙。），而非 autosave 自身
    expect(snapPos).toMatchObject({ sceneId: 's1', pc: 2 });
    // 自动存档同样携带场景哈希（position 重建不得丢失，否则 saveMismatch 对自动档失效）
    expect(snapPos!.sceneHash).toBeTruthy();

    // 用该快照恢复：应从 乙 开始，不再重跑 @autosave
    let autosaveCount = 0;
    bus.on('autosave', () => { autosaveCount++; });
    const texts: string[] = [];
    bus.on('text', (p) => texts.push(p.value));
    const snap = interp.saveSnapshot()!;
    snap.position = snapPos;
    interp.loadSnapshot(snap);
    expect(autosaveCount).toBe(0); // 恢复点不在 @autosave 指令上
    expect(texts.at(-1)).toBe('乙。');
    expect(interp.status).toBe('awaiting-advance');
    interp.advance();
    expect(interp.status).toBe('ended');
  });

  it('存档写入 schemaVersion，读档对过高版本抛错', async () => {
    const { registry, interp } = makeInterp();
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    interp.start('s1');
    const snap = interp.saveSnapshot()!;
    // saveSnapshot 直接产物自带 schemaVersion（宿主直写档不经 SaveManager 时校验仍生效）
    expect(snap.meta.schemaVersion).toBe(3);

    const sm = new SaveManager();
    await sm.save('s1', snap);
    const loaded = await sm.load('s1');
    expect(loaded.meta.schemaVersion).toBe(3);

    // 旧档无 schemaVersion（视为 0）→ 兼容，不抛错
    interp.loadSnapshot({ ...snap, meta: { ...snap.meta, schemaVersion: undefined } });
    expect(interp.status).toBe('awaiting-advance');

    // 版本过高 → 抛错提示升级
    const future = { ...snap, meta: { ...snap.meta, schemaVersion: 99 } };
    expect(() => interp.loadSnapshot(future)).toThrow(/schema 版本/);
  });

  it('SystemHooks：saveSnapshot 携带系统快照，loadSnapshot 触发宿主 restore', () => {
    const store = new VariableStore(decls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    let restored: SystemSnapshots | null = null;
    const systems = {
      snapshot: (): SystemSnapshots => ({ calendar: { turn: 3, ap: 2, visited: ['node_a'] } }),
      restore: (s: SystemSnapshots): void => {
        restored = s;
      },
    };
    const interp = new Interpreter(store, bus, registry, undefined, undefined, systems);
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));

    interp.start('s1');
    const snap = interp.saveSnapshot();
    expect(snap!.systems).toEqual({ calendar: { turn: 3, ap: 2, visited: ['node_a'] } });

    interp.loadSnapshot(snap!);
    expect(restored).toEqual({ calendar: { turn: 3, ap: 2, visited: ['node_a'] } });
  });

  it('系统快照（含战斗冷却）经 SaveManager JSON 序列化往返不损坏', async () => {
    const store = new VariableStore(decls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const combat = {
      units: [
        { uid: 'allies_0', defId: 'sword', name: '剑士', team: 'allies', hp: 20, maxHp: 20, atk: 5, def: 2, range: 1, move: 2, kind: 'human', skills: [], alive: true, position: 0, cooldowns: { power_shot: 2 } },
      ],
      turn: 2,
      actingTeam: 'enemies',
      winner: null,
      finished: false,
    };
    const systems = { snapshot: (): SystemSnapshots => ({ combat }) };
    const interp = new Interpreter(store, bus, registry, undefined, undefined, systems);
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));

    interp.start('s1');
    const snap = interp.saveSnapshot()!;
    const sm = new SaveManager();
    await sm.save('s1', snap);
    const loaded = await sm.load('s1');

    expect(loaded.systems).toEqual({ combat });
    // 战斗冷却经 JSON 深拷贝后仍保留（证明 cooldowns 不再因 Map 序列化丢失）
    expect(loaded.systems!.combat!.units[0]!.cooldowns['power_shot']).toBe(2);
  });

  it('畸形系统快照在任何状态恢复前被拒绝', () => {
    const { registry, interp, store } = makeInterp();
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    interp.start('s1');
    store.set('trust', 5);
    interp.gallery.unlockCg('before');
    const before = {
      variables: store.snapshot(),
      readSet: interp.readTracker.snapshot(),
      gallery: interp.gallery.snapshot(),
      status: interp.status,
    };
    const bad = {
      ...interp.saveSnapshot()!,
      variables: { trust: 999 },
      systems: { combat: { units: 'bad' } },
    } as never;

    expect(() => interp.loadSnapshot(bad)).toThrow(/systems\.combat\.units/);
    expect(store.snapshot()).toEqual(before.variables);
    expect(interp.readTracker.snapshot()).toEqual(before.readSet);
    expect(interp.gallery.snapshot()).toEqual(before.gallery);
    expect(interp.status).toBe(before.status);
  });

  it('系统预校验失败时不提交变量，也不调用 restore', () => {
    const store = new VariableStore(decls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const calls: string[] = [];
    const systems = {
      validate: (): void => {
        calls.push('validate');
        throw new Error('invalid system snapshot');
      },
      restore: (): void => { calls.push('restore'); },
    };
    const interp = new Interpreter(store, bus, registry, undefined, undefined, systems);
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));

    interp.start('s1');
    store.set('trust', 5);
    const incoming = interp.saveSnapshot()!;
    incoming.variables.trust = 999;
    incoming.systems = { calendar: { turn: 1, ap: 0, visited: [] } };

    expect(() => interp.loadSnapshot(incoming)).toThrow('invalid system snapshot');
    expect(store.getNumber('trust')).toBe(5);
    expect(calls).toEqual(['validate']);
  });

  it('Presentation 预校验失败时在任何状态写入前拒绝并不发 stateReset', () => {
    const { bus, registry, interp, store } = makeInterp();
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    interp.start('s1');
    store.set('trust', 5);
    interp.gallery.unlockCg('before');
    const before = {
      variables: store.snapshot(),
      readSet: interp.readTracker.snapshot(),
      gallery: interp.gallery.snapshot(),
      status: interp.status,
    };
    const calls: string[] = [];
    interp.setPresentationHooks({
      snapshot: () => ({ stage: 'current' }),
      validate: (payload: unknown) => {
        calls.push(`validate:${JSON.stringify(payload)}`);
        throw new Error('invalid presentation snapshot');
      },
      restore: () => { calls.push('restore'); },
    } as never);
    const events: string[] = [];
    bus.on('stateReset', () => events.push('stateReset'));
    const incoming = interp.saveSnapshot()!;
    incoming.variables.trust = 999;
    incoming.readSet = ['incoming#1'];
    incoming.gallery = { cgs: ['incoming'], music: [] };
    incoming.presentation = { version: 1, payload: { stage: 'incoming' } };

    expect(() => interp.loadSnapshot(incoming)).toThrow('invalid presentation snapshot');
    expect(calls).toEqual(['validate:{"stage":"incoming"}']);
    expect(events).toEqual([]);
    expect(store.snapshot()).toEqual(before.variables);
    expect(interp.readTracker.snapshot()).toEqual(before.readSet);
    expect(interp.gallery.snapshot()).toEqual(before.gallery);
    expect(interp.status).toBe(before.status);
  });

  it('迁移后当前 schema 校验失败时不写入状态、不发 saveMigrated、不开始恢复', () => {
    const { bus, registry, interp, store } = makeInterp();
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    interp.start('s1');
    store.set('trust', 5);
    interp.gallery.unlockCg('before');
    const before = {
      variables: store.snapshot(),
      readSet: interp.readTracker.snapshot(),
      gallery: interp.gallery.snapshot(),
      status: interp.status,
    };
    const events: string[] = [];
    bus.on('saveMigrated', () => events.push('saveMigrated'));
    bus.on('stateReset', () => events.push('stateReset'));
    const invalidMigrated = {
      ...interp.saveSnapshot()!,
      variables: { trust: 999 },
      gallery: undefined,
      callStack: undefined,
      meta: { ...interp.saveSnapshot()!.meta, schemaVersion: 1 },
    } as never;
    expect(() => interp.loadSnapshot(invalidMigrated)).toThrow(/gallery/);
    expect(events).toEqual([]);
    expect(store.snapshot()).toEqual(before.variables);
    expect(interp.readTracker.snapshot()).toEqual(before.readSet);
    expect(interp.gallery.snapshot()).toEqual(before.gallery);
    expect(interp.status).toBe(before.status);
  });

  it('迁移成功但系统预校验失败时不发 saveMigrated 或 stateReset', () => {
    const store = new VariableStore(decls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const calls: string[] = [];
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    const interp = new Interpreter(store, bus, registry, undefined, undefined, {
      validate: () => { calls.push('validate'); throw new Error('invalid migrated systems'); },
    });
    interp.start('s1');
    const snap = interp.saveSnapshot()!;
    const events: string[] = [];
    bus.on('saveMigrated', () => events.push('saveMigrated'));
    bus.on('stateReset', () => events.push('stateReset'));
    const old = {
      ...snap,
      callStack: undefined,
      systems: { calendar: { turn: 1, ap: 0, visited: [] } },
      meta: { ...snap.meta, schemaVersion: 1 },
    } as typeof snap;
    expect(() => interp.loadSnapshot(old)).toThrow('invalid migrated systems');
    expect(calls).toEqual(['validate']);
    expect(events).toEqual([]);
  });

  it('旧档 saveMigrated 在随机恢复成功后发出', () => {
    const { bus, registry, interp } = makeInterp();
    const order: string[] = [];
    const random = {
      next: () => 0.5,
      snapshot: () => ({ algorithm: 'mulberry32-v1' as const, state: 7 }),
      validateSnapshot: () => { order.push('validate'); },
      restore: () => { order.push('restore'); },
    };
    interp.setRandomSource(random);
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    interp.start('s1');
    const snap = interp.saveSnapshot()!;
    snap.meta = { ...snap.meta, schemaVersion: 1 };
    bus.on('saveMigrated', () => order.push('saveMigrated'));

    interp.loadSnapshot(snap);
    expect(order).toEqual(['validate', 'restore', 'saveMigrated']);
  });

  it('自定义随机恢复失败时不提前发 saveMigrated', () => {
    const { bus, registry, interp } = makeInterp();
    const order: string[] = [];
    const random = {
      next: () => 0.5,
      snapshot: () => ({ algorithm: 'mulberry32-v1' as const, state: 11 }),
      validateSnapshot: () => { order.push('validate'); },
      restore: () => {
        order.push('restore');
        throw new Error('random restore rejected');
      },
    };
    interp.setRandomSource(random);
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    interp.start('s1');
    const snap = interp.saveSnapshot()!;
    snap.meta = { ...snap.meta, schemaVersion: 1 };
    bus.on('saveMigrated', () => order.push('saveMigrated'));

    expect(() => interp.loadSnapshot(snap)).toThrow('random restore rejected');
    expect(order).toEqual(['validate', 'restore']);
  });

  it('读档场景哈希不匹配发 saveMismatch（剧本存档后被编辑，仍照常加载）', () => {
    const { bus, registry, interp } = makeInterp();
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    interp.start('s1');
    const snap = interp.saveSnapshot()!;
    expect(snap.position!.sceneHash).toBeTruthy();

    // 篡改快照哈希模拟"存档后剧本被编辑"（正常保存的快照哈希与注册场景一致，不触发事件）
    snap.position = { ...snap.position!, sceneHash: 'deadbeef' };
    const mismatches: { sceneId: string; expected: string; actual: string }[] = [];
    bus.on('saveMismatch', (p) => mismatches.push(p));

    interp.loadSnapshot(snap);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.sceneId).toBe('s1');
    expect(mismatches[0]!.expected).toBe('deadbeef');
    expect(interp.status).toBe('awaiting-advance'); // 不匹配仅告警，照常加载

    // 哈希一致的快照不触发事件
    const snap2 = interp.saveSnapshot()!;
    interp.loadSnapshot(snap2);
    expect(mismatches).toHaveLength(1);
  });
});
