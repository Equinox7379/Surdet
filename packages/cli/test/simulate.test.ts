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
import { cmdSimulate, simulateProject } from '../src/simulate.js';

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
    expect(cliReport.seed).toBe(sharedReport.seed);
    expect(simulateProject(dir, { seed: 0 }).seed).toBe(0);
  });

  it('跨场景无出口循环耗尽步数预算，不伪造运行时异常或结局', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 'ch1' }),
      'content/scenario/ch1.gal': '@scene ch1\n@label start\n凛：甲。\n@jump ch2.start\n',
      'content/scenario/ch2.gal': '@scene ch2\n@label start\n凛：乙。\n@jump ch1.start\n',
    });
    const r = simulateProject(dir, { maxStepsPerPath: 500 });
    expect(r.budgetExhausted).toBe(true);
    expect(r.runtimeErrors).toEqual([]);
    expect(r.endings).toEqual([]);
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

  it('--assume 与 simulateProject 保留合法 __proto__ 变量名', async () => {
    const variables = Object.fromEntries([
      ['__proto__', { type: 'number', initial: 0 }],
    ]);
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 'ch1', variables }),
      'content/scenario/ch1.gal': '@scene ch1\n@if __proto__ > 0\n@clear proto_ok\n@else\n@clear proto_missing\n@endif\n@end\n',
    });
    const assume = Object.create(null) as Record<string, string>;
    assume['__proto__'] = '1';
    expect(simulateProject(dir, { assume }).endings).toEqual([{ ending: 'proto_ok', times: 1 }]);

    let stdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      expect(await cmdSimulate(dir, ['--assume', '__proto__=1', '--json'])).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(JSON.parse(stdout).endings).toEqual([{ ending: 'proto_ok', times: 1 }]);
  });

  it('--assume 缺少等号或变量名时明确失败', async () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 'ch1' }),
      'content/scenario/ch1.gal': '@scene ch1\n凛：好。\n@end\n',
    });
    let stderr = '';
    const originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await cmdSimulate(dir, ['--assume', 'battleWon'])).toBe(1);
      expect(stderr).toContain('--assume');
      expect(stderr).toContain('name=value');
      stderr = '';
      expect(await cmdSimulate(dir, ['--assume', '=true'])).toBe(1);
      expect(stderr).toContain('--assume');
      expect(stderr).toContain('name=value');
      stderr = '';
      expect(await cmdSimulate(dir, ['--assume'])).toBe(1);
      expect(stderr).toContain('--assume');
      expect(stderr).toContain('name=value');
    } finally {
      process.stderr.write = originalWrite;
    }
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

describe('R4-A：legacy simulate timeline wiring（磁盘 timelines 进入 snapshot）', () => {
  const introTimeline = JSON.stringify({
    version: 1,
    id: 'intro',
    durationMs: 3000,
    tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 800, easing: 'linear', action: 'fade', alpha: 0.5 }] }],
  });

  it('R4A-1 合法 timeline：@timeline intro 不再误报未注册（paired oracle 正向）', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 's1' }),
      'content/scenario/s1.gal': '@scene s1\n@timeline intro @ blocking\n凛：黎明。\n@end\n',
      'content/timelines/intro.json': introTimeline,
    });
    const r = simulateProject(dir);
    expect(r.runtimeErrors).toEqual([]);
  });

  it('R4A-2 缺失 timeline：@timeline ghost 仍必须失败（paired oracle 负向，防"关掉检查"式假绿）', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 's1' }),
      'content/scenario/s1.gal': '@scene s1\n@timeline ghost @ blocking\n凛：黎明。\n@end\n',
      'content/timelines/intro.json': introTimeline,
    });
    const r = simulateProject(dir);
    expect(r.runtimeErrors.length).toBe(1);
    expect(r.runtimeErrors[0]!.message).toMatch(/'ghost' 未注册/);
  });

  it('R4A-3 malformed timeline JSON：fail-loud 报文件路径 + JSON 解析根因，不退化为"未注册"', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 's1' }),
      'content/scenario/s1.gal': '@scene s1\n@timeline intro @ blocking\n凛：黎明。\n@end\n',
      'content/timelines/intro.json': '{ oops',
    });
    expect(() => simulateProject(dir)).toThrow(/时间轴 JSON 解析失败/);
    expect(() => simulateProject(dir)).toThrow(/content\/timelines\/intro\.json/);
  });

  it('R4A-4 identity mismatch：foo.json 内 definition.id=bar 必须 A2 fail-loud，不得 alias/改写', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ entryScene: 's1' }),
      'content/scenario/s1.gal': '@scene s1\n@timeline foo @ blocking\n凛：黎明。\n@end\n',
      'content/timelines/foo.json': JSON.stringify({
        version: 1,
        id: 'bar',
        durationMs: 3000,
        tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 800, easing: 'linear', action: 'fade', alpha: 0.5 }] }],
      }),
    });
    expect(() => simulateProject(dir)).toThrow(/definition\.id 'bar' 与文件名派生 ID 'foo' 不一致/);
  });
});
