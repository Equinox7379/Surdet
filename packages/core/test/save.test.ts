import { describe, expect, it } from 'vitest';
import { SaveManager, MemoryStorage, QUICK_SLOT } from '../src/save/save-manager.js';
import type { SaveSnapshot } from '../src/save/save-manager.js';
import { GalleryState } from '../src/systems/gallery-state.js';
import { ReadTracker } from '../src/runtime/read-tracker.js';

function makeSnap(overrides: Partial<SaveSnapshot> = {}): SaveSnapshot {
  return {
    meta: { id: '', createdAt: 0, updatedAt: 0 },
    variables: { x: 1 },
    position: { sceneId: 'ch01', pc: 3 },
    kind: 'manual',
    readSet: [],
    gallery: { cgs: [], music: [] },
    ...overrides,
  };
}

describe('SaveManager', () => {
  it('save/load/list/has/delete', () => {
    const sm = new SaveManager();
    sm.save('slot1', makeSnap());
    sm.save('slot2', makeSnap());
    expect(sm.has('slot1')).toBe(true);
    expect(sm.load('slot1').position).toEqual({ sceneId: 'ch01', pc: 3 });
    expect(sm.list()).toHaveLength(2);
    sm.delete('slot1');
    expect(sm.has('slot1')).toBe(false);
    expect(() => sm.load('slot1')).toThrow(/不存在/);
  });

  it('保存时写入时间戳与槽位 id', () => {
    const sm = new SaveManager();
    sm.save('slotA', makeSnap());
    const meta = sm.load('slotA').meta;
    expect(meta.id).toBe('slotA');
    expect(meta.updatedAt).toBeGreaterThan(0);
  });

  it('写入隔离：外部改动快照不影响已存数据', () => {
    const sm = new SaveManager();
    const snap = makeSnap();
    sm.save('s', snap);
    snap.variables['x'] = 999;
    expect(sm.load('s').variables['x']).toBe(1);
  });

  it('MemoryStorage 深拷贝', () => {
    const st = new MemoryStorage();
    const snap = makeSnap();
    st.write('s', snap);
    snap.variables['x'] = 999;
    expect(st.read('s')!.variables['x']).toBe(1);
  });

  it('自动/快速槽位约定', () => {
    const sm = new SaveManager();
    sm.save(QUICK_SLOT, makeSnap());
    expect(sm.has(QUICK_SLOT)).toBe(true);
  });
});

describe('GalleryState', () => {
  it('解锁与去重 + snapshot/restore', () => {
    const g = new GalleryState();
    expect(g.unlockCg('cg1')).toBe(true);
    expect(g.unlockCg('cg1')).toBe(false);
    expect(g.unlockMusic('m1')).toBe(true);
    expect(g.hasCg('cg1')).toBe(true);
    expect(g.hasMusic('m1')).toBe(true);

    const snap = g.snapshot();
    const g2 = new GalleryState();
    g2.restore(snap);
    expect(g2.hasCg('cg1')).toBe(true);
    expect(g2.cgs).toEqual(['cg1']);
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
