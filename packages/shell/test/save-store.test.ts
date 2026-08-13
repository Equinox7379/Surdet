import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSaveStore, sanitizeSlot, MAX_SAVE_BYTES } from '../src/save-store.js';

function makeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-save-'));
}

function makeSnap(slot: string): Parameters<FileSaveStore['write']>[1] {
  return {
    meta: { id: slot, createdAt: 1, updatedAt: 1 },
    variables: { trust: 5 },
    position: { sceneId: 's1', pc: 2 },
    kind: 'manual',
    readSet: ['s1#0'],
    gallery: { cgs: [], music: [] },
  };
}

describe('FileSaveStore', () => {
  it('write/read 往返一致（JSON 序列化安全）', () => {
    const store = new FileSaveStore(makeDir());
    store.write('slot1', makeSnap('slot1'));
    const got = store.read('slot1');
    expect(got).not.toBeNull();
    expect(got!.position).toEqual({ sceneId: 's1', pc: 2 });
    expect(got!.variables).toEqual({ trust: 5 });
  });

  it('list 返回已存槽位，不存在的槽位 read 返回 null', () => {
    const store = new FileSaveStore(makeDir());
    expect(store.list()).toEqual([]);
    store.write('auto', makeSnap('auto'));
    store.write('quick', makeSnap('quick'));
    expect(store.list().sort()).toEqual(['auto', 'quick']);
    expect(store.read('ghost')).toBeNull();
  });

  it('delete 移除槽位', () => {
    const store = new FileSaveStore(makeDir());
    store.write('x', makeSnap('x'));
    expect(store.read('x')).not.toBeNull();
    store.delete('x');
    expect(store.read('x')).toBeNull();
  });

  it('sanitizeSlot 清洗非法字符防路径穿越', () => {
    expect(sanitizeSlot('../../evil')).toBe('_x2e_x2e_x2f_x2e_x2e_x2fevil');
    expect(sanitizeSlot('a/b\\c')).toBe('a_x2fb_x5cc');
    expect(sanitizeSlot('quick')).toBe('quick');
    // 单射性（审计修复）：a/b 与 a_b 必须映射到不同槽位，不再静默互相覆盖
    expect(sanitizeSlot('a/b')).not.toBe(sanitizeSlot('a_b'));
    expect(sanitizeSlot('a_b')).toBe('a_ub');
  });

  it('损坏的存档文件 read 必须抛错而不是伪装成空槽位', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ not valid json');
    expect(() => store.read('bad')).toThrow();
  });

  it('write 原子写：临时文件不残留，内容可完整读回', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('slot1', makeSnap('slot1'));
    expect(store.read('slot1')).not.toBeNull();
    // 无 .tmp 残留
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('write 超出大小上限抛错（MAX_SAVE_BYTES）', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    const huge = { ...makeSnap('huge'), variables: { big: 'x'.repeat(MAX_SAVE_BYTES + 1) } };
    expect(() => store.write('huge', huge)).toThrow(/超出大小上限/);
    expect(store.read('huge')).toBeNull();
  });

  it('read 返回隔离副本：调用方篡改返回值不影响后续读取（与 MemoryStorage 读隔离契约一致）', () => {
    const store = new FileSaveStore(makeDir());
    store.write('slot1', makeSnap('slot1'));
    const got1 = store.read('slot1')!;
    (got1.variables as Record<string, number>)['trust'] = 999;
    got1.position!.pc = 99;
    const got2 = store.read('slot1')!;
    expect((got2.variables as Record<string, number>)['trust']).toBe(5);
    expect(got2.position!.pc).toBe(2);
  });

  it('循环引用数据 write 抛清晰错误而非裸 TypeError', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    const circular: Record<string, unknown> = { meta: { id: 'x', createdAt: 1, updatedAt: 1 }, variables: {} };
    circular['self'] = circular;
    expect(() => store.write('x', circular as never)).toThrow(/无法序列化/);
  });

  it('listMeta 经索引返回槽位元信息（delete 同步移除）', () => {
    const store = new FileSaveStore(makeDir());
    store.write('auto', makeSnap('auto'));
    store.write('quick', { ...makeSnap('quick'), meta: { id: 'quick', createdAt: 2, updatedAt: 9 } });
    const metas = store.listMeta();
    expect(metas.map((m) => m.id).sort()).toEqual(['auto', 'quick']);
    expect(metas.find((m) => m.id === 'quick')!.updatedAt).toBe(9);
    store.delete('quick');
    expect(store.listMeta().map((m) => m.id)).toEqual(['auto']);
  });

  it('listMeta 在无索引的旧存档目录回退逐文件读取', () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, 'legacy.json'), JSON.stringify(makeSnap('legacy')));
    const store = new FileSaveStore(dir);
    expect(store.listMeta().map((m) => m.id)).toEqual(['legacy']);
  });

  it('listMeta 索引损坏时保留索引读取失败及原始 cause', () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, 'index.json'), '{ not valid json');
    const store = new FileSaveStore(dir);

    let failure: unknown;
    try {
      store.listMeta();
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      message: expect.stringContaining('存档索引读取或解析失败'),
      cause: expect.any(SyntaxError),
    });
  });

  it('list 的目录 I/O 失败继续向上抛出而不是伪装成空列表', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    fs.rmSync(dir, { recursive: true, force: true });

    let failure: unknown;
    try {
      store.list();
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: 'ENOENT' });
  });

  it('index.json 不被当作存档槽位（list 排除索引与临时文件）', () => {
    const store = new FileSaveStore(makeDir());
    store.write('s1', makeSnap('s1'));
    expect(store.list()).toEqual(['s1']);
  });

  it('主档损坏时不静默回退 .bak，必须把损坏错误交给上层', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('s1', makeSnap('s1')); // v1
    store.write('s1', { ...makeSnap('s1'), variables: { trust: 77 } }); // v2，v1 成为 .bak
    // 主档损坏（模拟断电截断）
    fs.writeFileSync(path.join(dir, 's1.json'), '{ corrupted');
    expect(() => store.read('s1')).toThrow();
  });

  it('R3 每次 write 前生成 .bak（list 不把它当槽位）', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('s1', makeSnap('s1'));
    store.write('s1', makeSnap('s1'));
    expect(fs.existsSync(path.join(dir, 's1.json.bak'))).toBe(true);
    expect(store.list()).toEqual(['s1']);
  });
});


describe('FileSaveStore 槽位编码兼容（审计复核）', () => {
  it('旧编码存量槽位（含下划线）：新编码文件缺失时按旧文件名回退读，write 后迁移到新文件名', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    const snap = makeSnap('slot_1');
    // 模拟升级前的存量文件：旧算法 slot_1 → slot_1.json（新算法会算出 slot_u1.json）
    fs.writeFileSync(path.join(dir, 'slot_1.json'), JSON.stringify(snap), 'utf8');
    const got = store.read('slot_1');
    expect(got?.meta.id).toBe('slot_1'); // 回退读命中
    store.write('slot_1', snap);
    expect(fs.existsSync(path.join(dir, 'slot_u1.json'))).toBe(true); // 隐式迁移
    expect(store.read('slot_1')?.meta.id).toBe('slot_1');
  });

  it('无下划线的槽位：新旧编码一致，不触发回退路径', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    const snap = makeSnap('quick');
    store.write('quick', snap);
    expect(store.read('quick')?.meta.id).toBe('quick');
  });
});


describe('FileSaveStore legacy 迁移闭合：delete/listMeta（审计终审）', () => {
  it('delete 含下划线槽位：同步删除 legacy 文件，read 返回 null 不复活', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    // 存量 legacy 文件（升级前写入）：slot_a → slot_a.json（新编码为 slot_ua.json）
    fs.writeFileSync(path.join(dir, 'slot_a.json'), JSON.stringify(makeSnap('slot_a')), 'utf8');
    expect(store.read('slot_a')?.meta.id).toBe('slot_a'); // 回退读命中
    store.delete('slot_a');
    expect(fs.existsSync(path.join(dir, 'slot_a.json'))).toBe(false); // legacy 已删
    expect(store.read('slot_a')).toBeNull(); // 不复活
  });

  it('write 隐式迁移后清理 legacy：delete 后无僵尸存档', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    fs.writeFileSync(path.join(dir, 'slot_a.json'), JSON.stringify(makeSnap('slot_a')), 'utf8');
    store.write('slot_a', makeSnap('slot_a')); // 迁移到新文件名并清理 legacy
    expect(fs.existsSync(path.join(dir, 'slot_a.json'))).toBe(false);  // legacy 已清理
    expect(fs.existsSync(path.join(dir, 'slot_ua.json'))).toBe(true);  // 新编码文件在位
    expect(store.read('slot_a')?.meta.id).toBe('slot_a');
    store.delete('slot_a');
    expect(fs.existsSync(path.join(dir, 'slot_ua.json'))).toBe(false);
    expect(store.read('slot_a')).toBeNull(); // 修复前：legacy 残留 → 删除后复活
  });

  it('listMeta 索引存在时包含未迁移 legacy 槽位（不漏项）', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('quick', makeSnap('quick')); // 创建 index.json
    // 未迁移 legacy 槽位（不在索引中）
    fs.writeFileSync(path.join(dir, 'slot_a.json'), JSON.stringify(makeSnap('slot_a')), 'utf8');
    const ids = store.listMeta().map((m) => m.id);
    expect(ids).toContain('quick');
    expect(ids).toContain('slot_a'); // 修复前漏项
  });
});
