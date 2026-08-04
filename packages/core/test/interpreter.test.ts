import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { Interpreter, RuntimeError, interpolate } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { VariableStore } from '../src/state/variable-store.js';
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
    expect(interp.status).toBe('running'); // 错误抛出后状态不置 ended
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
