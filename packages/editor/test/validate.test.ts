import { describe, expect, it } from 'vitest';
import { validateProject } from '../src/validate.js';

const sc = (id: string, source: string, key?: string) => ({
  key: key ?? id,
  id,
  file: id + '.gal',
  source,
});

describe('validateProject', () => {
  it('跨场景 jump 目标不存在 → error', () => {
    const r = validateProject([sc('a', '凛：x\n@jump ghost')]);
    expect(r.issues.some((i) => i.severity === 'error' && i.text.includes('不存在'))).toBe(true);
  });

  it('合法项目：jump/call 目标存在 → 无 error', () => {
    const r = validateProject([
      sc('a', '凛：x\n@jump b.start'),
      sc('b', '@label start\n凛：y'),
    ], 'a');
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('@switch 目标标签不存在 → error；存在则无', () => {
    const bad = validateProject([sc('a', '@set x = 1\n@switch x 1:ghost')], undefined, {
      raw: { variables: { x: { type: 'number', initial: 0 } } },
      path: 'game.config.json',
    });
    expect(bad.issues.some((i) => i.text.includes('@switch'))).toBe(true);
    const ok = validateProject([sc('a', '@set x = 1\n@switch x 1:t\n@label t\n凛：ok')], undefined, {
      raw: { variables: { x: { type: 'number', initial: 0 } } },
      path: 'game.config.json',
    });
    expect(ok.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('未使用标签 → warning；不可达场景 → warning', () => {
    const r = validateProject([
      sc('a', '@label unused\n凛：x'),
      sc('orphan', '凛：孤岛'),
    ], 'a');
    expect(r.issues.some((i) => i.text.includes('从未被'))).toBe(true);
    expect(r.issues.some((i) => i.text.includes('不可达'))).toBe(true);
  });

  it('M4：子目录同名场景（key 不同、basename 相同）→ LINT_DUP error', () => {
    const r = validateProject([
      sc('ch01', '凛：x', 'ch01'),
      sc('ch01', '凛：y', 'sub/ch01'),
    ]);
    expect(r.issues.some((i) => i.code === 'LINT_DUP' && i.severity === 'error')).toBe(true);
  });

  it('M5：变量声明交叉校验与 CLI 同源（未声明变量 V001/V002）', () => {
    const r = validateProject(
      [sc('a', '@set ghost = 1\n凛：{ghost2}')],
      undefined,
      { raw: { variables: { x: { type: 'number', initial: 0 } } }, path: 'game.config.json' },
    );
    expect(r.issues.some((i) => i.code === 'V001')).toBe(true);
    expect(r.issues.some((i) => i.code === 'V002')).toBe(true);
  });

  it('M5：customInstructions 传入后自定义指令不报 W001', () => {
    const withCustom = validateProject(
      [sc('a', '@my_custom 123')],
      undefined,
      { raw: { customInstructions: ['my_custom'] }, path: 'game.config.json' },
    );
    expect(withCustom.issues.some((i) => i.code === 'W001')).toBe(false);
    const without = validateProject([sc('a', '@my_custom 123')]);
    expect(without.issues.some((i) => i.code === 'W001')).toBe(true);
  });
});
