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
    expect(sanitizeSlot('../../evil')).toBe('______evil');
    expect(sanitizeSlot('a/b\\c')).toBe('a_b_c');
    expect(sanitizeSlot('quick')).toBe('quick');
  });

  it('损坏的存档文件 read 返回 null 而非抛错', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{ not valid json');
    expect(store.read('bad')).toBeNull();
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

  it('index.json 不被当作存档槽位（list 排除索引与临时文件）', () => {
    const store = new FileSaveStore(makeDir());
    store.write('s1', makeSnap('s1'));
    expect(store.list()).toEqual(['s1']);
  });
});
