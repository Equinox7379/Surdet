/**
 * E3 配置编辑纯逻辑测试：变量表 ⇄ JSON 往返与校验、成就表往返与 when 语法校验、
 * 剧本变量引用收集（删除保护）。
 */
import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import type { CompiledScene } from '@surdet/core';
import {
  parseVariablesToRows, rowsToVariables, applyVariablesToConfig,
  parseAchievementsToRows, rowsToAchievements, collectReferencedVars,
} from '../src/config-edit.js';

describe('变量表 ⇄ JSON', () => {
  const cfg = {
    title: 'Demo',
    entryScene: 'ch1',
    variables: {
      'lynn.trust': { type: 'number', initial: 0, min: 0, max: 100, description: '好感' },
      hasSword: { type: 'flag', initial: false },
      readonlyVar: { type: 'string', initial: 'x', readonly: true },
    },
  };

  it('parse → rows → variables 往返一致（含 min/max/readonly/description）', () => {
    const rows = parseVariablesToRows(cfg);
    expect(rows).toHaveLength(3);
    const { variables, errors } = rowsToVariables(rows);
    expect(errors).toEqual([]);
    expect(variables['lynn.trust']).toEqual({ type: 'number', initial: 0, min: 0, max: 100, description: '好感' });
    expect(variables['hasSword']).toEqual({ type: 'flag', initial: false });
    expect(variables['readonlyVar']).toEqual({ type: 'string', initial: 'x', readonly: true });
  });

  it('applyVariablesToConfig 保留其余顶层键、2 空格缩进、键序稳定', () => {
    const rows = parseVariablesToRows(cfg);
    const { variables } = rowsToVariables(rows);
    const text = applyVariablesToConfig(JSON.stringify(cfg), variables);
    const reparsed = JSON.parse(text) as Record<string, unknown>;
    expect(reparsed.title).toBe('Demo');
    expect(reparsed.entryScene).toBe('ch1');
    expect(Object.keys(reparsed.variables ?? {})).toEqual(['lynn.trust', 'hasSword', 'readonlyVar']);
    expect(text).toContain('\n  "title"'); // 2 空格缩进
  });

  it('非法输入被校验拦截：重复名/坏 initial/min>max/坏类型', () => {
    const { errors } = rowsToVariables([
      { name: 'a', type: 'number', initial: '1', min: '', max: '', readonly: false, description: '' },
      { name: 'a', type: 'number', initial: '2', min: '', max: '', readonly: false, description: '' },
      { name: 'b', type: 'number', initial: 'xyz', min: '', max: '', readonly: false, description: '' },
      { name: 'c', type: 'number', initial: '1', min: '10', max: '5', readonly: false, description: '' },
      { name: 'd', type: 'banana', initial: '1', min: '', max: '', readonly: false, description: '' },
      { name: '', type: 'number', initial: '0', min: '', max: '', readonly: false, description: '' },
    ]);
    expect(errors.some((e) => e.includes("'a' 重复"))).toBe(true);
    expect(errors.some((e) => e.includes("'b'") && e.includes('数字'))).toBe(true);
    expect(errors.some((e) => e.includes("'c'") && e.includes('min'))).toBe(true);
    expect(errors.some((e) => e.includes("'d'") && e.includes('类型'))).toBe(true);
    expect(errors.some((e) => e.includes('未填名称'))).toBe(true);
  });

  it('flag/boolean initial 只认真假字面量；string[] initial 走 JSON', () => {
    const ok = rowsToVariables([
      { name: 'f', type: 'flag', initial: 'true', min: '', max: '', readonly: false, description: '' },
      { name: 'arr', type: 'string[]', initial: '["a","b"]', min: '', max: '', readonly: false, description: '' },
    ]);
    expect(ok.errors).toEqual([]);
    expect(ok.variables['f']).toEqual({ type: 'flag', initial: true });
    expect(ok.variables['arr']).toEqual({ type: 'string[]', initial: ['a', 'b'] });
    const bad = rowsToVariables([
      { name: 'f2', type: 'flag', initial: 'yes', min: '', max: '', readonly: false, description: '' },
    ]);
    expect(bad.errors.length).toBe(1);
  });
});

describe('成就表 ⇄ JSON', () => {
  const raw = [
    { id: 'first_battle', name: '初战', description: '赢一场', when: 'battleWon' },
    { id: 'secret', name: '???', hidden: true },
  ];

  it('parse → rows → json 往返一致（空字段不写回，键序 id/name/description/when/hidden）', () => {
    const rows = parseAchievementsToRows(raw);
    expect(rows).toHaveLength(2);
    const { json, errors } = rowsToAchievements(rows);
    expect(errors).toEqual([]);
    expect(json[0]).toEqual({ id: 'first_battle', name: '初战', description: '赢一场', when: 'battleWon' });
    expect(json[1]).toEqual({ id: 'secret', name: '???', hidden: true });
  });

  it('when 表达式语法错误被拦截（与运行时 parseExpr 同源）', () => {
    const { json, errors } = rowsToAchievements([
      { id: 'bad', name: '坏', description: '', when: 'trust >= ', hidden: false },
    ]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('bad');
    expect(json).toEqual([]);
  });

  it('重复 ID 与空 ID 被拦截', () => {
    const { errors } = rowsToAchievements([
      { id: 'x', name: 'a', description: '', when: '', hidden: false },
      { id: 'x', name: 'b', description: '', when: '', hidden: false },
      { id: '', name: 'c', description: '', when: '', hidden: false },
    ]);
    expect(errors.some((e) => e.includes("'x' 重复"))).toBe(true);
    expect(errors.some((e) => e.includes('未填 ID'))).toBe(true);
  });

  it('非数组输入容错为空表', () => {
    expect(parseAchievementsToRows(null)).toEqual([]);
    expect(parseAchievementsToRows({ nope: 1 })).toEqual([]);
  });
});

describe('collectReferencedVars（删除保护）', () => {
  function scenesOf(entries: [string, string][]): Map<string, CompiledScene> {
    const m = new Map<string, CompiledScene>();
    for (const [id, src] of entries) m.set(id, compileScene(src, `${id}.gal`, id));
    return m;
  }

  it('覆盖 @set/@mod/@if/@switch/@inc/插值/choice when', () => {
    const scenes = scenesOf([
      ['ch1', '@set trust = 5\n@mod hp +1\n@if trust > 3\n凛：好。\n@endif\n@inc gold\n@switch chapter 1:c1\n@label c1\n凛：你的信任是{trust}。\n@choice\n  走 [if:hasSword] -> @goto c1\n'],
    ]);
    const refs = collectReferencedVars(scenes);
    for (const v of ['trust', 'hp', 'gold', 'chapter', 'hasSword']) {
      expect(refs.has(v), `应收集到 ${v}`).toBe(true);
      expect(refs.get(v)?.has('ch1')).toBe(true);
    }
  });

  it('未被引用的变量不出现在结果中', () => {
    const scenes = scenesOf([['ch1', '凛：好。\n']]);
    const refs = collectReferencedVars(scenes);
    expect(refs.size).toBe(0);
  });
});
