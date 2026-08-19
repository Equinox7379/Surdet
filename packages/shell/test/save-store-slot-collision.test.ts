import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSaveStore, sanitizeSlot } from '../src/save-store.js';

/**
 * A5 永久回归：槽位文件名碰撞（PROVEN / HIGH）。
 *
 * 历史碰撞对：逻辑槽位 A='存'（U+5B58）与 B='[58'（005B 0035 0038）
 * 在旧 sanitizeSlot（legacy L1）下都编码为 '_x5b58'——同一物理文件。
 * 本文件只依赖 FileSaveStore 公共 API 与 legacy 算法，验证修复后的
 * 逻辑/物理身份分离、所有权校验与 legacy 碰撞安全兼容。
 */

const SLOT_A = '存'; // U+5B58
const SLOT_B = '[58'; // UTF-16: 005B 0035 0038

/** 碰撞前提永久钉死：legacy L1 编码下两者同物理词干（修复后 sanitizeSlot 保留为 legacy 定位算法，此性质不变） */
const LEGACY_COLLISION_STEM = '_x5b58';

function makeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-a5-'));
}

function makeSnap(slot: string, updatedAt = 1, trust = 5): Parameters<FileSaveStore['write']>[1] {
  return {
    meta: { id: slot, createdAt: 1, updatedAt },
    variables: { trust },
    position: { sceneId: 's1', pc: 2 },
    kind: 'manual',
    readSet: ['s1#0'],
    gallery: { cgs: [], music: [] },
  };
}

/** legacy L0（更旧一层编码）：不安全字符 → _，下划线保留。与 save-store 内 legacy 回退算法一致 */
function legacyL0Stem(slot: string): string {
  return slot.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function plant(dir: string, stem: string, snap: unknown, bak = false): string {
  const file = path.join(dir, bak ? `${stem}.json.bak` : `${stem}.json`);
  fs.writeFileSync(file, JSON.stringify(snap), 'utf8');
  return file;
}

describe('A5 历史碰撞对：canonical 语义回归', () => {
  it('碰撞前提：legacy L1 下 A 与 B 同物理词干', () => {
    expect(sanitizeSlot(SLOT_A)).toBe(LEGACY_COLLISION_STEM);
    expect(sanitizeSlot(SLOT_B)).toBe(LEGACY_COLLISION_STEM);
  });

  it('write A + write B 两者都存活，各自读回自己', () => {
    const store = new FileSaveStore(makeDir());
    store.write(SLOT_A, makeSnap(SLOT_A, 1, 5));
    store.write(SLOT_B, makeSnap(SLOT_B, 2, 7));
    const a = store.read(SLOT_A);
    const b = store.read(SLOT_B);
    expect(a?.meta.id).toBe(SLOT_A);
    expect((a?.variables as Record<string, number>)['trust']).toBe(5);
    expect(b?.meta.id).toBe(SLOT_B);
    expect((b?.variables as Record<string, number>)['trust']).toBe(7);
  });

  it('delete A 后 B 存活', () => {
    const store = new FileSaveStore(makeDir());
    store.write(SLOT_A, makeSnap(SLOT_A));
    store.write(SLOT_B, makeSnap(SLOT_B, 2, 7));
    store.delete(SLOT_A);
    expect(store.read(SLOT_A)).toBeNull();
    expect(store.read(SLOT_B)?.meta.id).toBe(SLOT_B);
  });

  it('备份相互独立；restore A 不影响 B', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write(SLOT_A, makeSnap(SLOT_A, 1, 5)); // A v1
    store.write(SLOT_A, makeSnap(SLOT_A, 2, 6)); // A v2（v1 成为 A 的 .bak）
    store.write(SLOT_B, makeSnap(SLOT_B, 3, 7)); // B v1
    store.write(SLOT_B, makeSnap(SLOT_B, 4, 8)); // B v2（v1 成为 B 的 .bak）

    const backupIds = store.listBackupMeta().map((m) => m.id).sort();
    expect(backupIds).toEqual([SLOT_A, SLOT_B].sort());

    store.restoreBackup(SLOT_A);
    expect(store.read(SLOT_A)?.meta.updatedAt).toBe(1); // A 回到 v1
    const b = store.read(SLOT_B);
    expect(b?.meta.id).toBe(SLOT_B);
    expect(b?.meta.updatedAt).toBe(4); // B 仍是 v2，未被 A 的恢复顶掉
  });
});

describe('A5 legacy 所有权校验', () => {
  it('legacy 文件属于 A：read(A) 命中；读碰撞的 B 必须失败且绝不把 A 当 B 返回', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    plant(dir, LEGACY_COLLISION_STEM, makeSnap(SLOT_A, 1, 5));
    expect(store.read(SLOT_A)?.meta.id).toBe(SLOT_A);
    expect(() => store.read(SLOT_B)).toThrow();
  });

  it('legacy 文件属于 A：write(B) 不得摧毁 A 的 legacy 数据', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    const legacyFile = plant(dir, LEGACY_COLLISION_STEM, makeSnap(SLOT_A, 1, 5));
    store.write(SLOT_B, makeSnap(SLOT_B, 2, 7));
    // legacy 文件原样属于 A
    expect(JSON.parse(fs.readFileSync(legacyFile, 'utf8')).meta.id).toBe(SLOT_A);
    expect(store.read(SLOT_A)?.meta.id).toBe(SLOT_A);
    expect(store.read(SLOT_B)?.meta.id).toBe(SLOT_B);
  });

  it('legacy 文件属于 A：delete(B) 不得摧毁 A 的 legacy 数据', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    const legacyFile = plant(dir, LEGACY_COLLISION_STEM, makeSnap(SLOT_A, 1, 5));
    store.delete(SLOT_B);
    expect(fs.existsSync(legacyFile)).toBe(true);
    expect(store.read(SLOT_A)?.meta.id).toBe(SLOT_A);
    // B 的 legacy 候选路径上仍物理存在 A 的存档 → 必须大声失败（指令 §8），
    // 既不把 A 当 B 返回，也不在碰撞文件在位时假装 B 为空。
    expect(() => store.read(SLOT_B)).toThrow();
  });

  it('更旧编码（L0）的 legacy 文件同样按所有权校验：他人文件不得作为本槽位返回', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    // L0('[58') = '_58'；把属于 A 的快照种在 B 的 L0 候选路径上
    expect(legacyL0Stem(SLOT_B)).toBe('_58');
    plant(dir, '_58', makeSnap(SLOT_A, 1, 5));
    expect(() => store.read(SLOT_B)).toThrow();
  });

  it('read 命中 legacy 时不迁移不重写（懒兼容）', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    plant(dir, LEGACY_COLLISION_STEM, makeSnap(SLOT_A, 1, 5));
    const before = fs.readdirSync(dir).sort();
    expect(store.read(SLOT_A)?.meta.id).toBe(SLOT_A);
    expect(fs.readdirSync(dir).sort()).toEqual(before); // 无新文件、无重写
  });
});

describe('A5 关键恢复状态：legacy 主档属于 B，legacy 备份属于 A', () => {
  it('restoreBackup(A) 恢复 A 且 B 完整无损', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    const legacyMain = plant(dir, LEGACY_COLLISION_STEM, makeSnap(SLOT_B, 2, 7)); // 主档属于 B
    plant(dir, LEGACY_COLLISION_STEM, makeSnap(SLOT_A, 1, 5), true); // 备份属于 A

    store.restoreBackup(SLOT_A);

    const a = store.read(SLOT_A);
    expect(a?.meta.id).toBe(SLOT_A);
    expect((a?.variables as Record<string, number>)['trust']).toBe(5); // A 从备份恢复
    const b = store.read(SLOT_B);
    expect(b?.meta.id).toBe(SLOT_B);
    expect((b?.variables as Record<string, number>)['trust']).toBe(7); // B 未被顶掉
    // legacy 主档（B）字节未被改写
    expect(JSON.parse(fs.readFileSync(legacyMain, 'utf8')).meta.id).toBe(SLOT_B);
  });

  it('同状态下 restoreBackup(B) 失败：该 legacy 备份属于 A，B 没有自己的备份', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    plant(dir, LEGACY_COLLISION_STEM, makeSnap(SLOT_B, 2, 7));
    plant(dir, LEGACY_COLLISION_STEM, makeSnap(SLOT_A, 1, 5), true);
    expect(() => store.restoreBackup(SLOT_B)).toThrow(/备份/);
  });
});

describe('A5 共存与公共身份', () => {
  it('共存状态 1：canonical A + legacy A —— list/listMeta 只暴露一个逻辑 A，canonical 优先', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write(SLOT_A, makeSnap(SLOT_A, 9, 5)); // canonical（新写入）
    plant(dir, LEGACY_COLLISION_STEM, makeSnap(SLOT_A, 1, 4)); // 未迁移 legacy（旧内容）

    expect(store.list()).toEqual([SLOT_A]);
    const metas = store.listMeta();
    expect(metas.map((m) => m.id)).toEqual([SLOT_A]);
    expect(metas[0].updatedAt).toBe(9); // canonical 表示优先
  });

  it('共存状态 2：canonical B + 碰撞 legacy A —— list/listMeta 同时暴露 A 与 B', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write(SLOT_B, makeSnap(SLOT_B, 2, 7)); // canonical B
    plant(dir, LEGACY_COLLISION_STEM, makeSnap(SLOT_A, 1, 5)); // legacy 物理碰撞路径，内容属于 A

    expect(store.list().sort()).toEqual([SLOT_A, SLOT_B].sort());
    expect(store.listMeta().map((m) => m.id).sort()).toEqual([SLOT_A, SLOT_B].sort());
  });

  it('list/listMeta 只暴露逻辑槽位身份，绝不暴露物理词干', () => {
    const store = new FileSaveStore(makeDir());
    store.write(SLOT_A, makeSnap(SLOT_A));
    store.write(SLOT_B, makeSnap(SLOT_B, 2, 7));
    const ids = store.list();
    expect(ids.sort()).toEqual([SLOT_A, SLOT_B].sort());
    for (const id of ids) {
      expect(id).not.toMatch(/^~sv1/); // canonical 物理词干
      expect(id).not.toMatch(/^_x/); // legacy 物理词干
    }
    expect(store.listMeta().map((m) => m.id).sort()).toEqual([SLOT_A, SLOT_B].sort());
  });
});
