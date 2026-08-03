import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSaveStore, sanitizeSlot } from '../src/save-store.js';

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
});
