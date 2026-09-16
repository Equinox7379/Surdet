import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSaveStore, sanitizeSlot, canonicalSlotStem, MAX_SAVE_BYTES } from '../src/save-store.js';

vi.mock('node:fs', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs')>() }));

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
  it('未知 index 槽位不会读取或删除索引文件', () => {
    const store = new FileSaveStore(makeDir());
    store.write('s1', makeSnap('s1'));
    expect(store.read('index')).toBeNull();
    store.delete('index');
    expect(store.list()).toEqual(['s1']);
    store.write('index', makeSnap('index'));
    expect(store.read('index')?.meta.id).toBe('index');
  });

  it.each(['corrupt', 'publish'] as const)('删除失败保留原槽位、备份和索引：%s', kind => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('s1', makeSnap('s1'));
    store.write('s1', { ...makeSnap('s1'), variables: { trust: 8 } });
    if (kind === 'corrupt') fs.writeFileSync(path.join(dir, 'index.json'), '{broken');
    const before = new Map(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]));
    const internals = store as unknown as { writeIndex(index: unknown): void };
    const original = internals.writeIndex.bind(store);
    const fault = kind === 'publish' ? vi.spyOn(internals, 'writeIndex').mockImplementation(index => {
      original(index);
      throw new Error('injected delete index failure');
    }) : null;
    try {
      expect(() => store.delete('s1')).toThrow();
      expect(new Map(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]))).toEqual(before);
    } finally { fault?.mockRestore(); }
  });
  it.each([false, true])('索引损坏时连续保存不改变原主档和备份（已有槽位=%s）', (existing) => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    const main = path.join(dir, `${canonicalSlotStem('s1')}.json`);
    if (existing) {
      store.write('s1', { ...makeSnap('s1'), variables: { trust: 0 } });
      store.write('s1', { ...makeSnap('s1'), variables: { trust: 1 } });
    }
    fs.writeFileSync(path.join(dir, 'index.json'), '{"broken":');
    const before = new Map(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]));
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => store.write('s1', { ...makeSnap('s1'), variables: { trust: 2 } })).toThrow(/索引/);
      expect(new Map(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]))).toEqual(before);
    }
    expect(fs.existsSync(main)).toBe(existing);
  });

  it.each([false, true])('索引发布失败补偿主档/备份/索引，重试保留正确上一版（已有槽位=%s）', (existing) => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    if (existing) {
      store.write('s1', { ...makeSnap('s1'), variables: { trust: 0 } });
      store.write('s1', { ...makeSnap('s1'), variables: { trust: 1 } });
    }
    const before = new Map(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]));
    const internals = store as unknown as { writeIndex(index: unknown): void };
    const writeIndex = internals.writeIndex.bind(store);
    const fault = vi.spyOn(internals, 'writeIndex').mockImplementation(index => {
      writeIndex(index);
      throw new Error('injected index publication failure');
    });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(() => store.write('s1', { ...makeSnap('s1'), variables: { trust: 2 } })).toThrow(/publication/);
        expect(new Map(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]))).toEqual(before);
      }
    } finally { fault.mockRestore(); }
    store.write('s1', { ...makeSnap('s1'), variables: { trust: 2 } });
    expect(store.read('s1')?.variables).toEqual({ trust: 2 });
    if (existing) {
      store.restoreBackup('s1');
      expect(store.read('s1')?.variables).toEqual({ trust: 1 });
    }
  });

  it('主档发布失败不轮换已有备份', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('s1', { ...makeSnap('s1'), variables: { trust: 0 } });
    store.write('s1', { ...makeSnap('s1'), variables: { trust: 1 } });
    const before = new Map(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]));
    const rename = fs.renameSync;
    const main = path.join(dir, `${canonicalSlotStem('s1')}.json`);
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from) === `${main}.tmp` && String(to) === main) throw new Error('injected main rename failure');
      return rename(from, to);
    });
    try {
      expect(() => store.write('s1', { ...makeSnap('s1'), variables: { trust: 2 } })).toThrow(/rename/);
    } finally { fault.mockRestore(); }
    expect(new Map(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]))).toEqual(before);
  });

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

  it('主档缺失时 list/listMeta 以物理文件为准，备份仍独立可见', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('ghost', makeSnap('ghost'));
    store.write('ghost', { ...makeSnap('ghost'), meta: { id: 'ghost', createdAt: 1, updatedAt: 2 } });

    const mainFile = path.join(dir, `${canonicalSlotStem('ghost')}.json`);
    const backupFile = path.join(dir, `${canonicalSlotStem('ghost')}.json.bak`);
    expect(fs.existsSync(mainFile)).toBe(true);
    expect(fs.existsSync(backupFile)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'index.json'))).toBe(true);

    fs.unlinkSync(mainFile);

    expect(store.read('ghost')).toBeNull();
    expect(store.list()).not.toContain('ghost');
    expect(store.listMeta().map((m) => m.id)).not.toContain('ghost');
    expect(store.listBackupMeta().map((m) => m.id)).toEqual(['ghost']);
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
    // 主档损坏（模拟断电截断）——物理文件名为 A5 后的 canonical 词干
    fs.writeFileSync(path.join(dir, `${canonicalSlotStem('s1')}.json`), '{ corrupted');
    expect(() => store.read('s1')).toThrow();
  });

  it('R3 每次 write 前生成 .bak（list 不把它当槽位）', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('s1', makeSnap('s1'));
    store.write('s1', makeSnap('s1'));
    expect(fs.existsSync(path.join(dir, `${canonicalSlotStem('s1')}.json.bak`))).toBe(true);
    expect(store.list()).toEqual(['s1']);
  });

  it('显式列出并恢复上一版备份：主档、索引元信息更新且 .bak 保留', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('s1', { ...makeSnap('s1'), meta: { id: 's1', createdAt: 1, updatedAt: 1 }, variables: { trust: 1 } });
    store.write('s1', { ...makeSnap('s1'), meta: { id: 's1', createdAt: 1, updatedAt: 2 }, variables: { trust: 2 } });

    expect(store.listBackupMeta()).toEqual([expect.objectContaining({ id: 's1', updatedAt: 1 })]);
    store.restoreBackup('s1');

    expect(store.read('s1')?.variables).toEqual({ trust: 1 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).s1.updatedAt).toBe(1);
    expect(fs.existsSync(path.join(dir, `${canonicalSlotStem('s1')}.json.bak`))).toBe(true);
  });

  it('没有备份时显式恢复失败且主档/index 字节不变', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('s1', makeSnap('s1'));
    const mainFile = path.join(dir, `${canonicalSlotStem('s1')}.json`);
    const mainBefore = fs.readFileSync(mainFile);
    const indexBefore = fs.readFileSync(path.join(dir, 'index.json'));

    expect(() => store.restoreBackup('s1')).toThrow(/备份/);

    expect(fs.readFileSync(mainFile)).toEqual(mainBefore);
    expect(fs.readFileSync(path.join(dir, 'index.json'))).toEqual(indexBefore);
  });

  it('损坏或非法 .bak 在写入前失败并保留原始原因与主档/index 字节', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    store.write('s1', makeSnap('s1'));
    store.write('s1', { ...makeSnap('s1'), variables: { trust: 2 } });
    const mainFile = path.join(dir, `${canonicalSlotStem('s1')}.json`);
    const mainBefore = fs.readFileSync(mainFile);
    const indexBefore = fs.readFileSync(path.join(dir, 'index.json'));
    fs.writeFileSync(path.join(dir, `${canonicalSlotStem('s1')}.json.bak`), '{ invalid backup');

    let failure: unknown;
    try {
      store.restoreBackup('s1');
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      message: expect.stringContaining('存档文件读取或解析失败'),
      cause: expect.any(SyntaxError),
    });
    expect(fs.readFileSync(mainFile)).toEqual(mainBefore);
    expect(fs.readFileSync(path.join(dir, 'index.json'))).toEqual(indexBefore);

    fs.writeFileSync(path.join(dir, `${canonicalSlotStem('s1')}.json.bak`), JSON.stringify({ ...makeSnap('s1'), gallery: { cgs: [1] } }));
    expect(() => store.restoreBackup('s1')).toThrow(/gallery/);
    expect(fs.readFileSync(mainFile)).toEqual(mainBefore);
    expect(fs.readFileSync(path.join(dir, 'index.json'))).toEqual(indexBefore);
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
    expect(fs.existsSync(path.join(dir, `${canonicalSlotStem('slot_1')}.json`))).toBe(true); // 新写入落 canonical 物理身份
    expect(fs.existsSync(path.join(dir, 'slot_1.json'))).toBe(false); // 所有权验证通过后清理 legacy
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
    store.write('slot_a', makeSnap('slot_a')); // 新写入落 canonical 并清理已验证 legacy
    expect(fs.existsSync(path.join(dir, 'slot_a.json'))).toBe(false);  // legacy 已清理
    expect(fs.existsSync(path.join(dir, `${canonicalSlotStem('slot_a')}.json`))).toBe(true);  // canonical 文件在位
    expect(store.read('slot_a')?.meta.id).toBe('slot_a');
    store.delete('slot_a');
    expect(fs.existsSync(path.join(dir, `${canonicalSlotStem('slot_a')}.json`))).toBe(false);
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
