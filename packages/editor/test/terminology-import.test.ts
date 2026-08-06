/**
 * 名词表导入（normalizeTerminologyImport）纯逻辑测试。
 * 失败用例先行：非法形状的 JSON 必须被拒绝并给出错误描述，而不是静默产出坏行模型。
 */
import { describe, expect, it } from 'vitest';
import { normalizeTerminologyImport } from '../src/config-edit.js';

describe('normalizeTerminologyImport（名词表导入校验）', () => {
  it('合法形状 → 行模型（variants 序列化为 JSON 文本列）', () => {
    const res = normalizeTerminologyImport({
      terms: [
        { canonical: '石中剑', variants: ['那把剑', '石剑'] },
        { canonical: '凛' }, // variants 缺省按空数组
      ],
    });
    expect(res).toEqual({
      terms: [
        { canonical: '石中剑', variants: '["那把剑","石剑"]' },
        { canonical: '凛', variants: '[]' },
      ],
    });
  });

  it('variants 混入非字符串被过滤（与 parseTerminology 同口径）', () => {
    const res = normalizeTerminologyImport({ terms: [{ canonical: 'a', variants: ['x', 2, null] }] });
    expect(res).toEqual({ terms: [{ canonical: 'a', variants: '["x"]' }] });
  });

  it('顶层非对象/缺 terms/条目非法/缺 canonical 均拒绝并报错', () => {
    expect('error' in normalizeTerminologyImport(null)).toBe(true);
    expect('error' in normalizeTerminologyImport([])).toBe(true);
    expect('error' in normalizeTerminologyImport({ foo: 1 })).toBe(true);
    expect(normalizeTerminologyImport({ terms: 'nope' })).toMatchObject({ error: '缺少 terms 数组' });
    expect(normalizeTerminologyImport({ terms: [42] })).toMatchObject({ error: expect.stringContaining('terms[0]') });
    expect(normalizeTerminologyImport({ terms: [{ variants: [] }] }))
      .toMatchObject({ error: expect.stringContaining('canonical') });
    expect(normalizeTerminologyImport({ terms: [{ canonical: '  ', variants: [] }] }))
      .toMatchObject({ error: expect.stringContaining('canonical') });
  });

  it('空 terms 数组合法（导入 = 清空名词表语义）', () => {
    expect(normalizeTerminologyImport({ terms: [] })).toEqual({ terms: [] });
  });
});
