/**
 * 审计面板一键加变体的数据源：computeSpeakerPairs（称谓对提取）纯逻辑测试。
 * 口径与 core auditSpeakers 一致：编辑距离 1 = 疑似笔误；前缀包含（差 ≤3 字）= 称谓变体。
 */
import { describe, expect, it } from 'vitest';
import { computeSpeakerPairs } from '../src/panels/audit-panel.js';

describe('computeSpeakerPairs（称谓对提取）', () => {
  it('疑似笔误：出现更多的一方作规范词', () => {
    const pairs = computeSpeakerPairs(new Map([['凛', 10], ['冷', 1]]));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ canonical: '凛', variant: '冷' });
  });

  it('称谓变体（前缀包含）：高频者作规范词', () => {
    const pairs = computeSpeakerPairs(new Map([['凛大人', 2], ['凛', 8]]));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ canonical: '凛', variant: '凛大人' });
  });

  it('平手时取先出现者为规范词；无关称谓不配对', () => {
    const pairs = computeSpeakerPairs(new Map([['主角', 3], ['路人', 3]]));
    expect(pairs).toEqual([]); // 编辑距离 2，不构成笔误对
    const tie = computeSpeakerPairs(new Map([['凛', 5], ['冷', 5]]));
    expect(tie[0]).toMatchObject({ canonical: '凛', variant: '冷' });
  });

  it('前缀差超过 3 字不视为称谓变体', () => {
    const pairs = computeSpeakerPairs(new Map([['凛', 3], ['凛的妹妹大人', 1]]));
    expect(pairs).toEqual([]);
  });
});
