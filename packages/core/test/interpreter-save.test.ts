import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { Interpreter } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { VariableStore } from '../src/state/variable-store.js';
import { SaveManager } from '../src/save/save-manager.js';
import type { SystemSnapshots } from '../src/save/save-manager.js';
import type { VarDeclaration } from '../src/state/types.js';
import type { TextEventPayload } from '../src/runtime/interpreter.js';

const decls: VarDeclaration[] = [
  { name: 'trust', type: 'number', initial: 0 },
];

function makeInterp() {
  const store = new VariableStore(decls);
  const bus = new EventBus();
  const registry = new SceneRegistry();
  const interp = new Interpreter(store, bus, registry);
  return { store, bus, registry, interp };
}

describe('Interpreter 存档', () => {
  it('saveSnapshot 捕获变量/定位/已读/解锁', () => {
    const { store, registry, interp } = makeInterp();
    registry.register(compileScene('@set trust = 7\n凛：甲。\n凛：乙。', 's.gal', 's1'));

    interp.start('s1'); // 挂起在第一行文本
    const snap = interp.saveSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.variables['trust']).toBe(7);
    expect(snap!.position).toEqual({ sceneId: 's1', pc: 1 }); // pc 指向当前显示行（凛：甲。）
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
    bus.on<TextEventPayload>('text', (p) => texts.push(p.value));
    interp.loadSnapshot(snap);
    expect(interp.status).toBe('awaiting-advance');
    expect(texts).toEqual(['甲。']);
    expect(interp.readTracker.has('s1#1')).toBe(true);
  });

  it('@unlock_cg/@unlock_music 更新解锁状态并广播事件', () => {
    const { bus, registry, interp } = makeInterp();
    registry.register(compileScene('@unlock_cg cg_end\n@unlock_cg cg_end\n@unlock_music m_op', 's.gal', 's1'));
    const events: { type: string; id: string; fresh: boolean }[] = [];
    bus.on('gallery', (p: { type: string; id: string; fresh: boolean }) => events.push(p));

    interp.start('s1');
    expect(interp.gallery.cgs).toEqual(['cg_end']);
    expect(interp.gallery.music).toEqual(['m_op']);
    expect(events).toHaveLength(3);
    expect(events[0]!.fresh).toBe(true);
    expect(events[1]!.fresh).toBe(false); // 重复解锁
  });

  it('loadSnapshot 在场景中段恢复能继续推进', () => {
    const { bus, registry, interp } = makeInterp();
    registry.register(compileScene('@set trust = 7\n凛：甲。\n凛：乙。', 's.gal', 's1'));

    interp.start('s1');
    const snap = interp.saveSnapshot()!;

    const texts: string[] = [];
    bus.on<TextEventPayload>('text', (p) => texts.push(p.value));
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
    bus.on('autosave', (p) => kinds.push((p as { kind: string }).kind));
    bus.on('savepoint', (p) => kinds.push((p as { kind: string }).kind));

    interp.start('s1');
    interp.advance(); // 甲 → autosave → savepoint → 乙
    expect(kinds).toEqual(['auto', 'manual']);
    expect(interp.status).toBe('awaiting-advance');
  });

  it('SystemHooks：saveSnapshot 携带系统快照，loadSnapshot 触发宿主 restore', () => {
    const store = new VariableStore(decls);
    const bus = new EventBus();
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

  it('系统快照（含战斗冷却）经 SaveManager JSON 序列化往返不损坏', () => {
    const store = new VariableStore(decls);
    const bus = new EventBus();
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
    sm.save('s1', snap);
    const loaded = sm.load('s1');

    expect(loaded.systems).toEqual({ combat });
    // 战斗冷却经 JSON 深拷贝后仍保留（证明 cooldowns 不再因 Map 序列化丢失）
    expect(loaded.systems!.combat!.units[0]!.cooldowns['power_shot']).toBe(2);
  });
});
