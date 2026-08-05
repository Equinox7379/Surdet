/**
 * M6 E5-2 制作统计纯逻辑测试 + E4 预览标签列表。
 */
import { describe, expect, it } from 'vitest';
import { computeProjectStats } from '../src/stats.js';
import { listLabels } from '../src/panels/preview-panel.js';

describe('computeProjectStats', () => {
  const scenes = [
    {
      id: 'ch1',
      text: [
        '@scene ch1',
        '@bg hall',
        '@wait 500',
        '@fadeout 400',
        '凛：你好世界。',       // 5 字台词
        '旁白一句。',           // 5 字旁白（无说话人）
        '@choice',
        '  选项A -> @goto a',
        '  选项B -> @goto b',
        '@label a',
        '@unlock_cg cg_1',
        '@clear end_a',
        '@label b',
        '@unlock_cg cg_1',     // 重复 CG 不重复计数
        '@clear end_b',
      ].join('\n'),
    },
  ];

  it('字数/台词/旁白/选择肢/结局/CG/等待 全部正确', () => {
    const s = computeProjectStats(scenes);
    expect(s.scenes).toBe(1);
    expect(s.totalChars).toBe(10);         // 你好世界。(5) + 旁白一句。(5)
    expect(s.dialogueLines).toBe(1);
    expect(s.narrationLines).toBe(1);
    expect(s.choices).toBe(2);
    expect(s.endings).toBe(2);
    expect(s.cgUnlocks).toBe(1);           // cg_1 去重
    expect(s.waitMs).toBe(500);
    expect(s.perScene[0]).toMatchObject({ id: 'ch1', chars: 10, dialogueLines: 1, choices: 2 });
  });

  it('预估时长按字数/wait/转场累加', () => {
    const s = computeProjectStats(scenes);
    // 10 字 / 30cps ≈ 0.33s + wait 0.5s + fadeout 0.4s ≈ 1.23s ≈ 0 分钟（四舍五入到 0.1）
    expect(s.estMinutes).toBe(0);
    const long = computeProjectStats([{ id: 'x', text: '凛：' + '字'.repeat(3600) }]);
    // 3600 字 / 30 = 120s = 2 分钟
    expect(long.estMinutes).toBe(2);
  });

  it('空项目全零', () => {
    const s = computeProjectStats([]);
    expect(s.scenes).toBe(0);
    expect(s.totalChars).toBe(0);
    expect(s.estMinutes).toBe(0);
    expect(s.perScene).toEqual([]);
  });
});

describe('listLabels（预览"从标签播放"目标）', () => {
  it('按出现顺序收集 @label', () => {
    expect(listLabels('@label start\n凛：好。\n@label end_x\n@label start'.split('\n').join('\n'))).toEqual(['start', 'end_x', 'start']);
    expect(listLabels('凛：无标签。')).toEqual([]);
  });
});
