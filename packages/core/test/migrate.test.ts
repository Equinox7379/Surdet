import { describe, expect, it } from 'vitest';
import { migrateSnapshot } from '../src/save/migrate.js';
import { SAVE_SCHEMA_VERSION } from '../src/save/save-manager.js';
import { compileScene } from '../src/dsl/compiler.js';
import { Interpreter } from '../src/runtime/interpreter.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { VariableStore } from '../src/state/variable-store.js';
import type { CoreEventMap } from '../src/runtime/interpreter.js';

describe('存档 schema 迁移管线', () => {
  const base = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    meta: { id: '1', createdAt: 1, updatedAt: 1, schemaVersion: 1 },
    variables: {},
    position: null,
    kind: 'manual',
    readSet: [],
    gallery: { cgs: [], music: [] },
    ...over,
  });

  it('v1 → 当前版本：callStack 补空栈，schemaVersion 升级', () => {
    const out = migrateSnapshot(base())!;
    expect(out['callStack']).toEqual([]);
    expect((out['meta'] as { schemaVersion: number }).schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it('v2 → 当前版本：已有 callStack 原样保留', () => {
    const snap = base({
      meta: { id: '1', createdAt: 1, updatedAt: 1, schemaVersion: 2 },
      callStack: [{ sceneId: 's', pc: 1 }],
    });
    const out = migrateSnapshot(snap)!;
    expect(out['callStack']).toEqual([{ sceneId: 's', pc: 1 }]);
    expect((out['meta'] as { schemaVersion: number }).schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it('已是当前版本的存档返回 null（无需迁移）', () => {
    expect(migrateSnapshot(base({ meta: { id: '1', createdAt: 1, updatedAt: 1, schemaVersion: SAVE_SCHEMA_VERSION } }))).toBeNull();
  });

  it('无版本号存档按 v1 对待', () => {
    const noVer = base();
    delete (noVer['meta'] as Record<string, unknown>)['schemaVersion'];
    const out = migrateSnapshot(noVer)!;
    expect(out['callStack']).toEqual([]);
  });

  it('断链（目标版本无迁移路径）返回 null，回退兼容加载', () => {
    expect(migrateSnapshot(base({ meta: { id: '1', createdAt: 1, updatedAt: 1, schemaVersion: 2 } }), 99)).toBeNull();
  });

  it('loadSnapshot：旧档发 saveMigrated 事件，当前版本档不发', () => {
    const store = new VariableStore([]);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    registry.register(compileScene('凛：甲。', 's.gal', 's1'));
    const interp = new Interpreter(store, bus, registry);
    interp.start('s1');
    const snap = interp.saveSnapshot()!;
    const events: { from: number; to: number }[] = [];
    bus.on('saveMigrated', (p) => events.push(p));
    const old = { ...snap, callStack: undefined, meta: { ...snap.meta, schemaVersion: 1 } };
    interp.loadSnapshot(old as typeof snap);
    expect(events).toEqual([{ from: 1, to: SAVE_SCHEMA_VERSION }]);
    interp.loadSnapshot(snap); // 当前版本：不触发迁移
    expect(events).toHaveLength(1);
  });
});
