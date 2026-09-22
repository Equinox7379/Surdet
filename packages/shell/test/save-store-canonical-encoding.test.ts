import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CANONICAL_SLOT_PREFIX,
  FileSaveStore,
  canonicalSlotStem,
  decodeCanonicalSlotStem,
  sanitizeSlot,
} from '../src/save-store.js';

/**
 * A5 永久回归：canonical 槽位存储身份编码的机械 oracle。
 *
 * 结构单射性证明要点（本文件以机械 oracle 永久钉住）：
 * 1. canonical 词干 = '~sv1' 前缀 + 单遍 token 流；字面量字母表 [a-z0-9_-]，
 *    A-Z → '~u' + 小写字母，其余每个 UTF-16 码元 → '~' + 恰好 4 位小写十六进制。
 *    uppercase token 的 'u' 不是十六进制字符，所以边界唯一；decoder 为严格逆映射。
 * 2. 所有 canonical 输出均为小写：NTFS 文件名大小写不敏感时不会制造物理别名。
 * 3. 与 legacy 命名空间不相交：legacy L1（sanitizeSlot）与 L0 的输出字母表
 *    ⊆ [A-Za-z0-9_-]（L1 逐码元产出字面量 [a-zA-Z0-9-] 或 '_u'/'_xHH'；
 *    L0 逐码元产出字面量 [a-zA-Z0-9_-] 或 '_'），永远不可能含 '~'；
 *    canonical 词干必以 '~sv1' 开头。两层 legacy 都是逐码元替换后拼接，
 *    单码元输出不含 '~' ⇒ 任意长度输出不含 '~' ⇒ RANGE 交集为空。
 */

function makeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-a5-enc-'));
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

/**
 * R2 compactness contract for the legacy safe ASCII alphabet:
 * - [A-Za-z0-9-] remains a compact physical identity, including uppercase and mixed case;
 * - each logical code unit may consume at most three canonical body characters;
 * - the bound is intentionally below the five-character generic `~hhhh` escape so a
 *   one-character uppercase ID cannot regress to the old 1→5 expansion.
 */
const SAFE_ASCII_COMPACTNESS_INVARIANT = {
  logicalAlphabet: /^[A-Za-z0-9-]+$/,
  maxCanonicalBodyCharsPerLogicalUnit: 3,
} as const;

const NON_CANONICAL_ALIASES = [
  ['~sv1~0041', 'A'],
  ['~sv1~0042', 'B'],
  ['~sv1~0061', 'a'],
  ['~sv1~007a', 'z'],
  ['~sv1~0030', '0'],
  ['~sv1~002d', '-'],
  ['~sv1~005f', '_'],
  ['~sv1~0041a', 'Aa'],
  ['~sv1~0053ave', 'Save'],
  ['~sv1~0053~0041~0056~0045', 'SAVE'],
  ['~sv1~0051uick~0053ave1', 'QuickSave1'],
] as const;

describe('A5 canonical 编码：历史碰撞对与格式钉死', () => {
  it('历史碰撞对的 canonical 物理身份不同', () => {
    const a = canonicalSlotStem('存');
    const b = canonicalSlotStem('[58');
    expect(a).not.toBe(b);
    // 格式钉死：字面量直出 + 定宽 4 位十六进制转义
    expect(a).toBe('~sv1~5b58');
    expect(b).toBe('~sv1~005b58');
  });

  it('普通安全 ASCII 槽位仅增加版本前缀，无长度爆炸', () => {
    for (const s of ['quick', 'auto', 'slot1', 'my-save', 'a1', 'checkpoint-2']) {
      expect(canonicalSlotStem(s)).toBe(CANONICAL_SLOT_PREFIX + s);
      expect(canonicalSlotStem(s).length).toBe(s.length + CANONICAL_SLOT_PREFIX.length);
    }
  });

  it('R2 SAFE_ASCII_COMPACTNESS_INVARIANT：大写与混合大小写不回退到 1→5 膨胀', () => {
    const samples = [
      'A',
      'Save',
      'SAVE',
      'QuickSave1',
      'PLAYERPROFILE-SAVE-SLOT',
      'QuickSave1-MixedCase-Checkpoint-2026',
    ];

    for (const s of samples) {
      expect(s).toMatch(SAFE_ASCII_COMPACTNESS_INVARIANT.logicalAlphabet);
      const body = canonicalSlotStem(s).slice(CANONICAL_SLOT_PREFIX.length);
      expect(body.length).toBeLessThanOrEqual(
        s.length * SAFE_ASCII_COMPACTNESS_INVARIANT.maxCanonicalBodyCharsPerLogicalUnit,
      );
      const encoded = canonicalSlotStem(s);
      expect(decodeCanonicalSlotStem(encoded)).toBe(s);
      expect(encoded).toBe(encoded.toLowerCase());
      expect(encoded.toLowerCase()).not.toBe(canonicalSlotStem(s.toLowerCase()).toLowerCase());
    }
  });

  it('canonical grammar persistence：代表性安全 ASCII 物理词干保持精确拼写', () => {
    expect(canonicalSlotStem('A')).toBe('~sv1~ua');
    expect(canonicalSlotStem('Save')).toBe('~sv1~usave');
    expect(canonicalSlotStem('SAVE')).toBe('~sv1~us~ua~uv~ue');
    expect(canonicalSlotStem('QuickSave1')).toBe('~sv1~uquick~usave1');
  });

  it('严格 decoder 拒绝所有可由 literal/uppercase-short token 表达的通用转义别名', () => {
    for (const [alias, logical] of NON_CANONICAL_ALIASES) {
      expect(canonicalSlotStem(logical)).not.toBe(alias);
      expect(() => decodeCanonicalSlotStem(alias)).toThrow();
    }
  });

  it('空字符串确定性编码且可解码', () => {
    expect(canonicalSlotStem('')).toBe(CANONICAL_SLOT_PREFIX);
    expect(decodeCanonicalSlotStem(CANONICAL_SLOT_PREFIX)).toBe('');
  });
});

describe('A5 机械单射 oracle：全部 65,536 个 UTF-16 码元', () => {
  it('单码元字符串两两不同且 decode∘encode 精确往返', () => {
    const stems = new Set<string>();
    const folded = new Set<string>();
    for (let c = 0; c <= 0xffff; c += 1) {
      const s = String.fromCharCode(c);
      const stem = canonicalSlotStem(s);
      stems.add(stem);
      folded.add(stem.toLowerCase());
      expect(decodeCanonicalSlotStem(stem)).toBe(s);
      expect(canonicalSlotStem(decodeCanonicalSlotStem(stem))).toBe(stem);
      expect(stem).toBe(stem.toLowerCase());
    }
    expect(stems.size).toBe(0x10000);
    expect(folded.size).toBe(0x10000);
  }, 30_000);

  it('legacy 命名空间不相交 oracle：L1/L0 单码元输出永不含 canonical 标记符', () => {
    for (let c = 0; c <= 0xffff; c += 1) {
      const s = String.fromCharCode(c);
      const l1 = sanitizeSlot(s);
      const l0 = s.replace(/[^a-zA-Z0-9_-]/g, '_');
      expect(l1).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(l0).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(l1.includes('~')).toBe(false);
      expect(l0.includes('~')).toBe(false);
      expect(canonicalSlotStem(s).startsWith(CANONICAL_SLOT_PREFIX)).toBe(true);
    }
  }, 30_000);
});

describe('A5 边界语料：多码元组合、Windows 安全与大小写', () => {
  const CORPUS = [
    '',
    'quick',
    'SLOT',
    'Save',
    'save', // 与上一项仅大小写不同：NTFS 大小写不敏感下必须物理不同
    'deadbeef', // 十六进制外观
    '_x5b58', // 形似 legacy 转义
    '_u',
    '~sv1', // 形似 canonical 前缀本身
    '~sv1~0041', // 形似已编码词干
    '~0041',
    '~ua', // 形似 uppercase token 的逻辑文本，不能被 decoder 误解释
    '~uA',
    'a b',
    'trail ', // 尾随空格（Windows 不允许）
    'dot.', // 尾随点（Windows 不允许）
    '.',
    '..',
    '存',
    '[58',
    'e\u0301', // 组合字符（NFD）
    '\u00e9', // 预组合（NFC）：与上一项是不同 JS 字符串，必须保持不同逻辑身份
    '\ud83d\ude00', // emoji 代理对
    '\ud83d', // 孤立高代理
    '\ude00', // 孤立低代理
    '\u0000', // 嵌入 NUL
    'CON',
    'nul',
    'com1',
    'LPT9.json',
    'a/b\\c:d*e?f"g<h>i|j', // 全部 Windows 非法字符
    '中文存档名 一',
    'slot\u007f\u0080\u00ff', // DEL 与高位拉丁
    'QuickSave1',
    'quicksave1',
    '-leading-dash',
    '_underscore_',
    'x'.repeat(64),
  ];

  it('语料内两两物理身份不同（含大小写折叠后仍不同）', () => {
    const stems = CORPUS.map((s) => canonicalSlotStem(s));
    expect(new Set(stems).size).toBe(CORPUS.length);
    const folded = stems.map((t) => t.toLowerCase());
    expect(new Set(folded).size).toBe(CORPUS.length); // 大小写不敏感文件系统下仍唯一
  });

  it('语料全部 decode∘encode 精确往返', () => {
    for (const s of CORPUS) {
      const stem = canonicalSlotStem(s);
      expect(decodeCanonicalSlotStem(stem)).toBe(s);
      expect(canonicalSlotStem(decodeCanonicalSlotStem(stem))).toBe(stem);
    }
  });

  it('Windows case-fold oracle：大小写逻辑 ID 在物理层仍两两可区分', () => {
    const pairs = [
      ['A', 'a'],
      ['Save', 'save'],
      ['SAVE', 'save'],
      ['QuickSave1', 'quicksave1'],
    ] as const;
    for (const [a, b] of pairs) {
      expect(canonicalSlotStem(a).toLowerCase()).not.toBe(canonicalSlotStem(b).toLowerCase());
    }
  });

  it('语料输出全部 Windows 文件名安全', () => {
    const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
    for (const s of CORPUS) {
      const stem = canonicalSlotStem(s);
      expect(stem).not.toMatch(/[<>:"/\\|?*]/); // 非法字符
      expect(stem).not.toMatch(/[\u0000-\u001f]/); // 控制字符
      expect(stem.endsWith(' ')).toBe(false);
      expect(stem.endsWith('.')).toBe(false);
      expect(RESERVED.test(stem)).toBe(false);
    }
  });
});

describe('A5 canonical 文件所有权防御（状态 3）', () => {
  it('canonical main 的实际目录项大小写/扩展名变体：read/list/listMeta 全部大声失败', () => {
    for (const entryName of ['~sv1~uA.json', '~sv1~ua.JSON', '~SV1~UA.json']) {
      const dir = makeDir();
      const store = new FileSaveStore(dir);
      const file = path.join(dir, entryName);
      const before = Buffer.from(JSON.stringify(makeSnap('A')), 'utf8');
      fs.writeFileSync(file, before);

      expect(() => store.read('A')).toThrow(/canonical|规范|大小写|拼写/);
      expect(() => store.list()).toThrow(/canonical|规范|大小写|拼写/);
      expect(() => store.listMeta()).toThrow(/canonical|规范|大小写|拼写/);
      expect(fs.readFileSync(file)).toEqual(before);
    }
  });

  it('canonical backup 的实际目录项大小写/扩展名变体：restore/listBackupMeta 全部大声失败', () => {
    for (const entryName of ['~sv1~uA.json.bak', '~sv1~ua.json.BAK']) {
      const dir = makeDir();
      const store = new FileSaveStore(dir);
      const file = path.join(dir, entryName);
      const before = Buffer.from(JSON.stringify(makeSnap('A')), 'utf8');
      fs.writeFileSync(file, before);

      expect(() => store.restoreBackup('A')).toThrow(/canonical|规范|大小写|拼写/);
      expect(() => store.listBackupMeta()).toThrow(/canonical|规范|大小写|拼写/);
      expect(fs.readdirSync(dir).sort()).toEqual([entryName]);
      expect(fs.readFileSync(file)).toEqual(before);
    }
  });

  it('delete 面对 canonical main/backup 大小写变体：先失败且保持原文件字节不变', () => {
    for (const entryName of ['~sv1~uA.json', '~sv1~ua.JSON', '~sv1~uA.json.bak', '~sv1~ua.json.BAK']) {
      const dir = makeDir();
      const store = new FileSaveStore(dir);
      const file = path.join(dir, entryName);
      const before = Buffer.from(JSON.stringify(makeSnap('A')), 'utf8');
      fs.writeFileSync(file, before);

      expect(() => store.delete('A')).toThrow(/canonical|规范|大小写|拼写/);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file)).toEqual(before);
    }
  });

  it('write 面对 canonical main 大小写/扩展名变体：先失败且不备份、不覆盖原文件', () => {
    for (const entryName of ['~sv1~uA.json', '~sv1~ua.JSON', '~SV1~UA.json']) {
      const dir = makeDir();
      const store = new FileSaveStore(dir);
      const file = path.join(dir, entryName);
      const before = Buffer.from(JSON.stringify(makeSnap('A')), 'utf8');
      fs.writeFileSync(file, before);

      expect(() => store.write('A', { ...makeSnap('A'), meta: { id: 'A', createdAt: 1, updatedAt: 2 } })).toThrow(
        /canonical|规范|大小写|拼写/,
      );
      expect(fs.readdirSync(dir).sort()).toEqual([entryName]);
      expect(fs.readFileSync(file)).toEqual(before);
    }
  });

  it('canonical 前缀下的非 canonical 文件名：list/listMeta 必须大声失败，不产生幻影槽位', () => {
    for (const [alias, logical] of [
      ['~sv1~0041', 'A'],
      ['~sv1~0061', 'a'],
    ] as const) {
      const dir = makeDir();
      const store = new FileSaveStore(dir);
      fs.writeFileSync(path.join(dir, `${alias}.json`), JSON.stringify(makeSnap(logical)), 'utf8');

      // 这是 R1 宽松 decoder 曾经接受的文件名，但它不是 canonicalSlotStem(meta.id)。
      expect(store.read(logical)).toBeNull();
      expect(() => store.list()).toThrow();
      expect(() => store.listMeta()).toThrow();
    }
  });

  it('canonical 物理路径内容属于他人逻辑 id：read/list/listMeta 全部大声失败', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    // 在 '存' 的 canonical 物理路径上放入 meta.id 为 'other' 的快照
    fs.writeFileSync(
      path.join(dir, `${canonicalSlotStem('存')}.json`),
      JSON.stringify(makeSnap('other')),
      'utf8',
    );
    expect(() => store.read('存')).toThrow(); // 拒绝把他人快照当作 '存' 返回
    expect(store.read('other')).toBeNull(); // canonical('存') 不是 'other' 的候选路径，不得幻影暴露
    // R1 状态 3：canonical 物理/逻辑所有权不一致 → FAIL LOUD。
    // 列表不得把 canonical('存') 静默重释为 'other' 的合法物理表示（那样 list 显示 'other'
    // 而 read('other') 为 null，产生可见但不可读的幻影槽位）。
    expect(() => store.list()).toThrow();
    expect(() => store.listMeta()).toThrow();
  });

  it('canonical 备份属于他人逻辑 id：备份枚举大声失败，恢复绝不冒用', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    fs.writeFileSync(
      path.join(dir, `${canonicalSlotStem('存')}.json.bak`),
      JSON.stringify(makeSnap('other')),
      'utf8',
    );
    expect(() => store.listBackupMeta()).toThrow(); // 枚举即失败，不暴露幻影备份
    expect(() => store.restoreBackup('存')).toThrow(/所有权不匹配/); // 备份属主不符 → 大声失败
    expect(() => store.restoreBackup('other')).toThrow(/备份/); // 'other' 没有自己的备份，不得冒用他人备份
  });

  it('write 拒绝 meta.id 与槽位不一致的数据（写入期即失败，防止种下不一致状态）', () => {
    const store = new FileSaveStore(makeDir());
    expect(() => store.write('存', makeSnap('other'))).toThrow();
    expect(store.read('存')).toBeNull();
  });
});

describe('A5 索引逻辑键安全：任意 JS 字符串 vs Object 原型', () => {
  // index.json 以任意逻辑槽位 ID 为键；这些键可能与 Object.prototype 属性同名。
  const KEYS = ['__proto__', 'constructor', 'prototype', 'toString', '', '存'];

  function readRawIndex(dir: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as Record<string, unknown>;
  }

  function hasOwn(o: object, k: string): boolean {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  it('首次写入：index.json 把全部逻辑键保存为自有属性（含 __proto__）', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    for (const k of KEYS) store.write(k, makeSnap(k));
    const raw = readRawIndex(dir);
    for (const k of KEYS) {
      expect(hasOwn(raw, k)).toBe(true);
      expect((raw[k] as { id: string }).id).toBe(k);
    }
  });

  it('覆写：同一逻辑键条目被更新，不丢失不重复', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    for (const k of KEYS) store.write(k, makeSnap(k));
    for (const k of KEYS) {
      store.write(k, { ...makeSnap(k), meta: { id: k, createdAt: 1, updatedAt: 9 } });
    }
    const raw = readRawIndex(dir);
    for (const k of KEYS) {
      expect(hasOwn(raw, k)).toBe(true);
      expect((raw[k] as { updatedAt: number }).updatedAt).toBe(9);
    }
  });

  it('read/listMeta 按逻辑键精确命中，互不串扰', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    for (const k of KEYS) store.write(k, makeSnap(k));
    for (const k of KEYS) expect(store.read(k)?.meta.id).toBe(k);
    expect(store.listMeta().map((m) => m.id).sort()).toEqual([...KEYS].sort());
  });

  it('delete：精确移除目标索引条目，其余键不受影响', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    for (const k of KEYS) store.write(k, makeSnap(k));
    store.delete('__proto__');
    store.delete('');
    const raw = readRawIndex(dir);
    expect(hasOwn(raw, '__proto__')).toBe(false);
    expect(hasOwn(raw, '')).toBe(false);
    for (const k of ['constructor', 'prototype', 'toString', '存']) {
      expect(hasOwn(raw, k)).toBe(true);
    }
    expect(store.read('__proto__')).toBeNull();
    expect(store.read('')).toBeNull();
  });

  it('索引操作不污染 Object.prototype', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    for (const k of KEYS) store.write(k, makeSnap(k));
    for (const k of KEYS) store.read(k);
    store.listMeta();
    store.delete('constructor');
    const probe: Record<string, unknown> = {};
    expect(probe['id']).toBeUndefined();
    expect(probe['createdAt']).toBeUndefined();
    expect(probe['updatedAt']).toBeUndefined();
  });
});
