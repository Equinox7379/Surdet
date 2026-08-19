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
 *    其余每个 UTF-16 码元 → '~' + 恰好 4 位小写十六进制（定宽，无歧义边界）。
 *    从左到右解析唯一 → 编码对 JS 字符串单射；decoder 为严格逆映射。
 * 2. 大写字母也走转义：NTFS 文件名大小写不敏感，字面保留大小写会产生物理别名。
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

  it('空字符串确定性编码且可解码', () => {
    expect(canonicalSlotStem('')).toBe(CANONICAL_SLOT_PREFIX);
    expect(decodeCanonicalSlotStem(CANONICAL_SLOT_PREFIX)).toBe('');
  });
});

describe('A5 机械单射 oracle：全部 65,536 个 UTF-16 码元', () => {
  it('单码元字符串两两不同且 decode∘encode 精确往返', () => {
    const stems = new Set<string>();
    for (let c = 0; c <= 0xffff; c += 1) {
      const s = String.fromCharCode(c);
      const stem = canonicalSlotStem(s);
      stems.add(stem);
      expect(decodeCanonicalSlotStem(stem)).toBe(s);
    }
    expect(stems.size).toBe(0x10000);
  });

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
  });
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
      expect(decodeCanonicalSlotStem(canonicalSlotStem(s))).toBe(s);
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
  it('canonical 物理路径内容属于他人逻辑 id：read 失败，list 按真实逻辑身份暴露', () => {
    const dir = makeDir();
    const store = new FileSaveStore(dir);
    // 在 '存' 的 canonical 物理路径上放入 meta.id 为 'other' 的快照
    fs.writeFileSync(
      path.join(dir, `${canonicalSlotStem('存')}.json`),
      JSON.stringify(makeSnap('other')),
      'utf8',
    );
    expect(() => store.read('存')).toThrow(); // 拒绝把他人快照当作 '存' 返回
    const ids = store.list();
    expect(ids).toContain('other'); // 真实逻辑身份仍可被发现
    expect(ids).not.toContain('存'); // 绝不把他人快照挂在 '存' 下
  });

  it('write 拒绝 meta.id 与槽位不一致的数据（写入期即失败，防止种下不一致状态）', () => {
    const store = new FileSaveStore(makeDir());
    expect(() => store.write('存', makeSnap('other'))).toThrow();
    expect(store.read('存')).toBeNull();
  });
});
