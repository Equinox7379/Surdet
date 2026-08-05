/**
 * M7 支柱5：Web 试玩包信息 + 版本补丁清单 纯逻辑测试。
 */
import { describe, expect, it } from 'vitest';
import { buildWebTrialInfo, buildUpdateManifest } from '../src/build.js';

describe('buildWebTrialInfo', () => {
  it('携带引擎/游戏名/版本/构建时间', () => {
    const info = buildWebTrialInfo('demo-game', '0.2.0');
    expect(info.engine).toBe('surdet');
    expect(info.game).toBe('demo-game');
    expect(info.version).toBe('0.2.0');
    expect(() => new Date(info.builtAt ?? '').toISOString()).not.toThrow();
  });
});

describe('buildUpdateManifest', () => {
  it('携带版本/生成时间/说明，空 notes 合法', () => {
    const m = buildUpdateManifest('demo-game', '1.0.0', '');
    expect(m.engine).toBe('surdet');
    expect(m.game).toBe('demo-game');
    expect(m.version).toBe('1.0.0');
    expect(m.notes).toBe('');
    expect(() => new Date(m.generatedAt ?? '').toISOString()).not.toThrow();
  });
  it('notes 原样保留', () => {
    const m = buildUpdateManifest('g', '1.0.1', '## v1.0.1\n- 修复存档');
    expect(m.notes).toContain('修复存档');
  });
});
