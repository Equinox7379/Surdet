/**
 * simulate（无头自动模拟，支柱 2）单测：全分支遍历、结局可达、死路检测、
 * 循环剪枝、步数上限死循环报告、运行时错误收集、--assume 注入。
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadProjectSnapshot, simulateSnapshot } from '@surdet/authoring';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { simulateProject } from '../src/simulate.js';

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-sim-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
  return dir;
}

describe('simulateProject（无头自动模拟）', () => {
  it('choice 全分支遍历：两个选项都走到 + 双结局可达 + 存档往返冒烟发生', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 'ch1', variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/ch1.gal': '@scene ch1\n凛：开场。\n@choice\n  选项A -> @goto a\n  选项B -> @goto b\n@label a\n凛：甲。\n@clear end_a\n@end\n@label b\n凛：乙。\n@clear end_b\n@end\n',
    });
    const r = simulateProject(dir);
    expect(r.runtimeErrors).toEqual([]);
    expect(r.choiceBranches).toEqual({ total: 2, visited: 2 });
    expect(r.endings.map((e) => e.ending).sort()).toEqual(['end_a', 'end_b']);
    expect(r.saveRoundtrips).toBeGreaterThan(0); // choice 分支经 save/load 走存档机制
    expect(r.deadEndScenes).toEqual([]); // 两段都以 @clear 收尾
  });

  it('死路检测：场景自然结束但从未触发 @clear', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 'ch1' }),
      'content/scenario/ch1.gal': '@scene ch1\n凛：到此为止。\n@end\n',
    });
    const r = simulateProject(dir);
    expect(r.runtimeErrors).toEqual([]);
    expect(r.endings).toEqual([]);
    expect(r.deadEndScenes).toContain('ch1');
  });

  it('choice 循环剧情：状态签名剪枝收敛，不爆路径、不误报死循环', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 'ch1' }),
      'content/scenario/ch1.gal': '@scene ch1\n@label top\n凛：循环。\n@choice\n  再来一次 -> @goto top\n  离开 -> @goto exit\n@label exit\n凛：再见。\n@clear done\n@end\n',
    });
    const r = simulateProject(dir);
    expect(r.runtimeErrors).toEqual([]);
    expect(r.cyclesPruned).toBeGreaterThan(0); // 回到同一 (定位,变量) 签名被剪枝
    expect(r.endings.map((e) => e.ending)).toEqual(['done']); // 出口分支仍被探索到
    expect(r.pathsExplored).toBeLessThan(10);
    expect(r.pathsExplored).toBeGreaterThan(0);
  });

  it('CLI pathsExplored 与共享 simulateSnapshot 的探索计数一致', async () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 'ch1' }),
      'content/scenario/ch1.gal': '@scene ch1\n@label top\n@choice\n  再来一次 -> @goto top\n  离开 -> @goto exit\n@label exit\n凛：再见。\n@clear done\n@end\n',
    });
    const cliReport = simulateProject(dir);
    const storage = await NodeProjectStorage.open(dir);
    const snapshot = await loadProjectSnapshot(storage, {
      sha256: async (text) => createHash('sha256').update(text).digest('hex'),
    });
    const sharedReport = simulateSnapshot(snapshot);

    expect(cliReport.pathsExplored).toBe(sharedReport.pathsExplored);
    expect(cliReport.pathsExplored).toBeGreaterThan(0);
    expect(cliReport.cyclesPruned).toBeGreaterThan(0);
    expect(cliReport.endings).toEqual([{ ending: 'done', times: 1 }]);
    expect(cliReport.runtimeErrors).toEqual([]);
  });

  it('无挂起点死循环：单路径步数上限兜底并如实报告', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 'ch1' }),
      'content/scenario/ch1.gal': '@scene ch1\n@label start\n凛：甲。\n@jump ch2.start\n',
      'content/scenario/ch2.gal': '@scene ch2\n@label start\n凛：乙。\n@jump ch1.start\n',
    });
    const r = simulateProject(dir, { maxStepsPerPath: 500 });
    expect(r.runtimeErrors.length).toBe(1);
    expect(r.runtimeErrors[0]!.message).toMatch(/步数超过|死循环/);
  });

  it('运行时错误收集：@exp 未接 GrowthSystem → 如实报告而非静默', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 'ch1' }),
      'content/scenario/ch1.gal': '@scene ch1\n@exp lynn 10\n凛：后。\n@end\n',
    });
    const r = simulateProject(dir);
    expect(r.runtimeErrors.length).toBe(1);
    expect(r.runtimeErrors[0]!.message).toMatch(/GrowthSystem/);
  });

  it('Node 文件系统适配器把 growth.json 交给共享模拟运行时', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({
        entryScene: 'ch1',
        variables: {
          'lynn.atk': { type: 'number', initial: 5 },
          'lynn.hp': { type: 'number', initial: 20 },
        },
      }),
      'content/config/growth.json': JSON.stringify({
        curve: { base: 10, linear: 5 },
        profiles: [{
          characterId: 'lynn',
          initialLevel: 1,
          statGrowth: { 'lynn.atk': 2, 'lynn.hp': 10 },
        }],
      }),
      'content/scenario/ch1.gal': '@scene ch1\n@exp lynn 10\n@clear growth_ok\n@end\n',
    });
    const r = simulateProject(dir);

    expect(r.runtimeErrors).toEqual([]);
    expect(r.endings).toEqual([{ ending: 'growth_ok', times: 1 }]);
  });

  it('--assume 注入宿主变量：仅宿主可置位的条件分支变为可达', () => {
    const files = {
      'game.config.json': JSON.stringify({ entryScene: 'ch1', variables: { battleWon: { type: 'flag', initial: false } } }),
      'content/scenario/ch1.gal': '@scene ch1\n@if battleWon\n@clear win_end\n@else\n凛：战败……\n@endif\n@end\n',
    };
    const without = simulateProject(makeProject(files));
    expect(without.endings).toEqual([]); // 无宿主：battleWon 恒 false，胜利结局不可达（如实）
    const withAssume = simulateProject(makeProject(files), { assume: { battleWon: 'true' } });
    expect(withAssume.endings.map((e) => e.ending)).toEqual(['win_end']);
    expect(withAssume.runtimeErrors).toEqual([]);
  });

  it('缺 entryScene / 入口场景文件缺失 → 明确报错', () => {
    const noEntry = makeProject({ 'content/scenario/ch1.gal': '@scene ch1\n凛：好。\n' });
    expect(() => simulateProject(noEntry)).toThrow(/entryScene/);
    const missing = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 'ghost' }),
      'content/scenario/ch1.gal': '@scene ch1\n凛：好。\n',
    });
    expect(() => simulateProject(missing)).toThrow(/ghost/);
  });
});
