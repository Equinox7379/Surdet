import { describe, expect, it } from 'vitest';
import { SaveManager, MemoryStorage, QUICK_SLOT, assertValidSnapshot, isJsonSafeValue } from '../src/save/save-manager.js';
import type { SaveSnapshot, SaveStorage } from '../src/save/save-manager.js';
import { GalleryState } from '../src/systems/gallery-state.js';
import { ReadTracker } from '../src/runtime/read-tracker.js';

function makeSnap(overrides: Partial<SaveSnapshot> = {}): SaveSnapshot {
  return {
    meta: { id: '', createdAt: 0, updatedAt: 0, schemaVersion: 3 },
    variables: { x: 1 },
    position: { sceneId: 'ch01', pc: 3 },
    kind: 'manual',
    readSet: [],
    gallery: { cgs: [], music: [] },
    ...overrides,
  };
}

class RecordingStorage implements SaveStorage {
  readonly writes: Array<{ slot: string; data: SaveSnapshot }> = [];
  #data = new Map<string, SaveSnapshot>();

  async read(slot: string): Promise<SaveSnapshot | null> {
    return this.#data.get(slot) ?? null;
  }

  async write(slot: string, data: SaveSnapshot): Promise<void> {
    this.writes.push({ slot, data });
    this.#data.set(slot, data);
  }

  async delete(slot: string): Promise<void> {
    this.#data.delete(slot);
  }

  async list(): Promise<string[]> {
    return [...this.#data.keys()];
  }
}

describe('SaveManager', () => {
  it('JSON 安全校验接受 null，但拒绝 undefined 与非有限 number', () => {
    expect(isJsonSafeValue({ particleKind: null, nested: [null, 1, true] })).toBe(true);
    expect(isJsonSafeValue({ missing: undefined })).toBe(false);
    expect(isJsonSafeValue({ invalid: Infinity })).toBe(false);
  });

  it('save/load/list/has/delete', async () => {
    const sm = new SaveManager();
    await sm.save('slot1', makeSnap());
    await sm.save('slot2', makeSnap());
    expect(await sm.has('slot1')).toBe(true);
    expect((await sm.load('slot1')).position).toEqual({ sceneId: 'ch01', pc: 3 });
    expect(await sm.list()).toHaveLength(2);
    await sm.delete('slot1');
    expect(await sm.has('slot1')).toBe(false);
    await expect(sm.load('slot1')).rejects.toThrow(/不存在/);
  });

  it('保存时写入时间戳与槽位 id', async () => {
    const sm = new SaveManager();
    await sm.save('slotA', makeSnap());
    const meta = (await sm.load('slotA')).meta;
    expect(meta.id).toBe('slotA');
    expect(meta.updatedAt).toBeGreaterThan(0);
  });

  it('写入隔离：外部改动快照不影响已存数据', async () => {
    const sm = new SaveManager();
    const snap = makeSnap();
    await sm.save('s', snap);
    snap.variables['x'] = 999;
    expect((await sm.load('s')).variables['x']).toBe(1);
  });

  it('MemoryStorage 深拷贝', async () => {
    const st = new MemoryStorage();
    const snap = makeSnap();
    await st.write('s', snap);
    snap.variables['x'] = 999;
    expect((await st.read('s'))!.variables['x']).toBe(1);
  });

  it('自动/快速槽位约定', async () => {
    const sm = new SaveManager();
    await sm.save(QUICK_SLOT, makeSnap());
    expect(await sm.has(QUICK_SLOT)).toBe(true);
  });

  it('list 优先走存储元信息索引（不做逐槽全量读取）', async () => {
    let fullReads = 0;
    const storage: SaveStorage = {
      read: () => { fullReads++; return null; },
      write: () => {},
      delete: () => {},
      list: () => [],
      listMeta: () => [
        { id: 'a', createdAt: 1, updatedAt: 1 },
        { id: 'b', createdAt: 2, updatedAt: 5 },
      ],
    };
    const sm = new SaveManager(storage);
    const metas = await sm.list();
    expect(metas.map((m) => m.id)).toEqual(['b', 'a']); // 按 updatedAt 倒序
    expect(fullReads).toBe(0);
  });

  it('list 无元信息索引时回退逐槽读取（兼容旧后端）', async () => {
    const inner = new MemoryStorage();
    const storage: SaveStorage = {
      read: (slot) => inner.read(slot),
      write: (slot, data) => inner.write(slot, data),
      delete: (slot) => inner.delete(slot),
      list: () => inner.list(),
    };
    const sm = new SaveManager(storage);
    await sm.save('s1', makeSnap());
    const metas = await sm.list();
    expect(metas.map((m) => m.id)).toEqual(['s1']);
  });
});

describe('SaveManager 写入前校验', () => {
  it('非 JSON 安全变量在触及存储后端前被拒绝', async () => {
    const storage = new RecordingStorage();
    const manager = new SaveManager(storage);
    const invalid = makeSnap({
      variables: { x: undefined } as unknown as SaveSnapshot['variables'],
    });

    await expect(manager.save('slot', invalid)).rejects.toThrow(/variables.*JSON 安全/);
    expect(storage.writes).toEqual([]);
  });

  it('非法 gallery 结构不会覆盖既有有效槽位', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save('slot', makeSnap({ variables: { x: 1 } }));
    const before = await manager.load('slot');
    const invalid = makeSnap({
      variables: { x: 99 },
      gallery: { cgs: [], music: [123] } as unknown as SaveSnapshot['gallery'],
    });

    await expect(manager.save('slot', invalid)).rejects.toThrow(/gallery\.cgs.*gallery\.music/);
    expect(await manager.load('slot')).toEqual(before);
  });

  it('有效快照先盖章为 current schema 后才写入', async () => {
    const storage = new RecordingStorage();
    const manager = new SaveManager(storage);
    const input = makeSnap({
      meta: { id: 'wrong', createdAt: 0, updatedAt: 0, schemaVersion: 1 },
    });

    await manager.save('real-slot', input);
    expect(storage.writes).toHaveLength(1);
    expect(storage.writes[0]).toMatchObject({
      slot: 'real-slot',
      data: { meta: { id: 'real-slot', schemaVersion: 3 } },
    });
  });
});

describe('SaveManager 显式备份恢复契约（Task 1）', () => {
  it('覆盖槽位保留上一版备份元信息与内容', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save('slot', makeSnap({
      meta: { id: '', createdAt: 1, updatedAt: 1, schemaVersion: 3, label: '旧快照' },
      variables: { version: 1 },
    }));
    await manager.save('slot', makeSnap({
      meta: { id: '', createdAt: 1, updatedAt: 2, schemaVersion: 3, label: '新快照' },
      variables: { version: 2 },
    }));

    await expect(manager.listBackupMeta()).resolves.toEqual([
      expect.objectContaining({ id: 'slot', label: '旧快照' }),
    ]);
    await manager.restoreBackup('slot');
    await expect(manager.load('slot')).resolves.toEqual(expect.objectContaining({
      variables: { version: 1 },
      meta: expect.objectContaining({ label: '旧快照', id: 'slot' }),
    }));
  });

  it('显式恢复后普通 load 读取旧版本且备份仍可见', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save('slot', makeSnap({ variables: { version: 'old' } }));
    const old = await manager.load('slot');
    await manager.save('slot', makeSnap({ variables: { version: 'new' } }));

    await manager.restoreBackup('slot');

    expect(await manager.load('slot')).toEqual(old);
    expect(await manager.listBackupMeta()).toEqual([old.meta]);
  });

  it('没有备份时显式恢复失败且不改变主档', async () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    await manager.save('slot', makeSnap({ variables: { version: 'only' } }));
    const before = await manager.load('slot');

    await expect(manager.restoreBackup('slot')).rejects.toThrow(/备份/);

    await expect(manager.load('slot')).resolves.toEqual(before);
    await expect(manager.listBackupMeta()).resolves.toEqual([]);
  });
});

describe('GalleryState', () => {
  it('解锁与去重 + snapshot/restore', () => {
    const g = new GalleryState();
    expect(g.unlockCg('cg1')).toBe(true);
    expect(g.unlockCg('cg1')).toBe(false);
    expect(g.unlockMusic('m_op')).toBe(true);
    expect(g.hasCg('cg1')).toBe(true);
    expect(g.hasMusic('m_op')).toBe(true);

    const snap = g.snapshot();
    const g2 = new GalleryState();
    g2.restore(snap);
    expect(g2.hasCg('cg1')).toBe(true);
    expect(g2.cgs).toEqual(['cg1']);
  });
});

describe('assertValidSnapshot systems 子快照深校验（审计轮4）', () => {
  it('合法 systems 子快照通过（含 eventScheduler/achievements/commandCounts）', () => {
    const snap = makeSnap({
      systems: {
        calendar: { turn: 2, ap: 1, visited: ['map_01'], commandCounts: { train: 1 } },
        achievements: { unlocked: ['a', 'b'] },
        eventScheduler: { fired: ['ev1'] },
      },
    });
    expect(() => assertValidSnapshot(snap)).not.toThrow();
  });

  it('achievements.unlocked 非字符串数组 → 读档入口拒绝', () => {
    const snap = makeSnap({ systems: { achievements: { unlocked: 'a' } } as never });
    expect(() => assertValidSnapshot(snap)).toThrow(/unlocked/);
  });

  it('eventScheduler.fired 非数组 → 读档入口拒绝', () => {
    const snap = makeSnap({ systems: { eventScheduler: { fired: 123 } } as never });
    expect(() => assertValidSnapshot(snap)).toThrow(/fired/);
  });

  it('calendar.commandCounts 值非 number → 读档入口拒绝', () => {
    const snap = makeSnap({ systems: { calendar: { turn: 1, ap: 0, visited: [], commandCounts: { rest: 'x' } } } as never });
    expect(() => assertValidSnapshot(snap)).toThrow(/commandCounts/);
  });

  it('calendar.turn 非 number → 读档入口拒绝', () => {
    const snap = makeSnap({ systems: { calendar: { turn: '2', ap: 0, visited: [] } } as never });
    expect(() => assertValidSnapshot(snap)).toThrow(/turn/);
  });

  it('combat.units 非数组 → 读档入口拒绝', () => {
    const snap = makeSnap({ systems: { combat: { units: 'bad' } } as never });
    expect(() => assertValidSnapshot(snap)).toThrow(/systems\.combat\.units/);
  });

  it('affection.consumed 非字符串数组 → 读档入口拒绝', () => {
    const snap = makeSnap({ systems: { affection: { consumed: 123 } } as never });
    expect(() => assertValidSnapshot(snap)).toThrow(/systems\.affection\.consumed/);
  });

  it('旧 affection 快照缺少 everConsumed 时保持兼容', () => {
    const snap = makeSnap({ systems: { affection: { consumed: ['a'] } } as never });
    expect(() => assertValidSnapshot(snap)).not.toThrow();
  });
});

describe('assertValidSnapshot 当前 schema 严格校验', () => {
  const current = (): SaveSnapshot => makeSnap({
    meta: { id: 'slot', createdAt: 1, updatedAt: 2, schemaVersion: 3 },
    position: { sceneId: 'ch01', pc: 3, sceneHash: 'hash' },
    gallery: { cgs: [], music: [], texts: [] },
  });

  it('严格验证 kind、meta、schemaVersion 和必需 gallery', () => {
    expect(() => assertValidSnapshot({ ...current(), kind: 'broken' })).toThrow(/kind/);
    expect(() => assertValidSnapshot({ ...current(), meta: { ...current().meta, id: 1 } })).toThrow(/meta\.id/);
    expect(() => assertValidSnapshot({ ...current(), meta: { ...current().meta, createdAt: Number.NaN } })).toThrow(/createdAt/);
    expect(() => assertValidSnapshot({ ...current(), meta: { ...current().meta, updatedAt: Number.POSITIVE_INFINITY } })).toThrow(/updatedAt/);
    expect(() => assertValidSnapshot({ ...current(), meta: { ...current().meta, schemaVersion: 1.5 } })).toThrow(/schemaVersion/);
    expect(() => assertValidSnapshot({ ...current(), meta: { ...current().meta, schemaVersion: -1 } })).toThrow(/schemaVersion/);
    expect(() => assertValidSnapshot({ ...current(), gallery: undefined })).toThrow(/gallery/);
  });

  it('严格验证 gallery.texts、position.pc 和 callStack.pc', () => {
    expect(() => assertValidSnapshot({ ...current(), gallery: { cgs: [], music: [], texts: [1] } })).toThrow(/gallery\.texts/);
    for (const pc of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(() => assertValidSnapshot({ ...current(), position: { sceneId: 'ch01', pc } })).toThrow(/position\.pc/);
      expect(() => assertValidSnapshot({ ...current(), callStack: [{ sceneId: 'ch01', pc }] })).toThrow(/callStack.*pc/);
    }
  });

  it('严格验证 growth 数值和 systems.newGamePlus 的 JSON 安全性', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => assertValidSnapshot({ ...current(), growth: { levels: { lynn: value } } })).toThrow(/growth\.levels/);
      expect(() => assertValidSnapshot({ ...current(), growth: { experience: { lynn: value } } })).toThrow(/growth\.experience/);
    }
    expect(() => assertValidSnapshot({ ...current(), systems: { newGamePlus: () => 'unsafe' } })).toThrow(/newGamePlus/);
  });

  it('允许当前 v3 合法快照和可 JSON 序列化的无原型对象', () => {
    const variables = Object.create(null) as Record<string, unknown>;
    variables.trust = 3;
    expect(() => assertValidSnapshot({ ...current(), variables })).not.toThrow();
  });
});

describe('ReadTracker', () => {
  it('mark/has/snapshot/restore', () => {
    const rt = new ReadTracker();
    rt.mark('ch01#你好');
    expect(rt.has('ch01#你好')).toBe(true);
    expect(rt.has('ch01#再见')).toBe(false);

    const rt2 = new ReadTracker();
    rt2.restore(rt.snapshot());
    expect(rt2.has('ch01#你好')).toBe(true);
  });
});
