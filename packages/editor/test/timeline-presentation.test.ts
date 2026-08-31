import { describe, expect, it } from 'vitest';
import type { TimelineEasing, TimelineTrackKind } from '@surdet/core';
import type { DirAsset } from '../src/assets.js';
import {
  buildTimelineTicks,
  projectTimelineCueGeometry,
  timelineActionLabel,
  timelineAssetChoices,
  timelineEasingLabel,
  timelineTrackLabel,
} from '../src/timeline-presentation.js';

const asset = (key: string, kind: DirAsset['kind'], expr?: string): DirAsset => ({
  key,
  kind,
  ...(expr === undefined ? {} : { expr }),
  handle: null,
  isImage: kind === 'bg' || kind === 'portrait',
});

describe('Timeline 展示投影', () => {
  it('为六类轨道提供中文显示名，同时保留英文枚举值', () => {
    const cases: readonly [TimelineTrackKind, string][] = [
      ['background', '背景'],
      ['portrait', '角色立绘'],
      ['camera', '镜头'],
      ['screen', '画面效果'],
      ['particle', '粒子特效'],
      ['audio', '声音'],
    ];

    expect(cases.map(([value, label]) => ({ value, label: timelineTrackLabel(value) })))
      .toEqual(cases.map(([value, label]) => ({ value, label })));
  });

  it('覆盖 Core 当前全部动作的中文显示名，同时保留英文动作值', () => {
    const cases: readonly [TimelineTrackKind, string, string][] = [
      ['background', 'set', '设置背景'],
      ['portrait', 'show', '显示角色'],
      ['portrait', 'hide', '隐藏角色'],
      ['portrait', 'move', '移动角色'],
      ['portrait', 'expression', '切换表情'],
      ['camera', 'zoom', '缩放镜头'],
      ['camera', 'pan', '平移镜头'],
      ['camera', 'shake', '镜头震动'],
      ['screen', 'fade', '透明度渐变'],
      ['screen', 'tint', '叠加色调'],
      ['screen', 'flash', '闪白'],
      ['screen', 'wipe', '擦除转场'],
      ['particle', 'start', '启动粒子特效'],
      ['particle', 'stop', '停止粒子特效'],
      ['audio', 'bgm', '背景音乐'],
      ['audio', 'se', '音效'],
      ['audio', 'voice', '语音'],
    ];

    expect(cases.map(([kind, value, label]) => ({
      kind,
      value,
      label: timelineActionLabel(kind, value),
    }))).toEqual(cases.map(([kind, value, label]) => ({ kind, value, label })));
    expect(timelineActionLabel('camera', 'future-action')).toBe('future-action');
  });

  it('为全部 easing 提供中文显示名，同时保留英文枚举值', () => {
    const cases: readonly [TimelineEasing, string][] = [
      ['linear', '匀速'],
      ['inOutSine', '柔和起止'],
      ['outCubic', '快出慢收'],
      ['inOutCubic', '平滑加减速'],
    ];

    expect(cases.map(([value, label]) => ({ value, label: timelineEasingLabel(value) })))
      .toEqual(cases.map(([value, label]) => ({ value, label })));
  });

  it('从项目目录素材投影背景、立绘和三类 Core 音频选择，并排除 ambience', () => {
    const dirAssets: DirAsset[] = [
      asset('castle_hall', 'bg'),
      asset('lynn:uniform', 'portrait', 'normal'),
      asset('tense_01', 'bgm'),
      asset('door_close', 'se'),
      asset('lynn_01', 'voice'),
      asset('rain_loop', 'ambience'),
      asset('lynn', 'avatar'),
      asset('opening', 'video'),
    ];

    expect(timelineAssetChoices(dirAssets)).toEqual([
      { kind: 'background', key: 'castle_hall', sourceKind: 'bg' },
      { kind: 'portrait', key: 'lynn:uniform', expression: 'normal', sourceKind: 'portrait' },
      { kind: 'audio', key: 'tense_01', sourceKind: 'bgm' },
      { kind: 'audio', key: 'door_close', sourceKind: 'se' },
      { kind: 'audio', key: 'lynn_01', sourceKind: 'voice' },
    ]);
    expect(timelineAssetChoices([])).toEqual([]);
  });
});

describe('Timeline 自然刻度', () => {
  it('使用 1/2/5 × 10^n 的自然步长', () => {
    expect(buildTimelineTicks(600, 320).map((tick) => tick.valueMs))
      .toEqual([0, 200, 400, 600]);
  });

  it.each([0, 100, 499, 500, 600, 1200, 600_000])(
    '%dms 的刻度唯一、递增且不会重复终点',
    (durationMs) => {
      const width = 640;
      const minGap = 64;
      const ticks = buildTimelineTicks(durationMs, width, minGap);
      const values = ticks.map((tick) => tick.valueMs);

      expect(values.filter((value) => value === 0)).toHaveLength(1);
      expect(values.filter((value) => value === durationMs).length).toBeLessThanOrEqual(1);
      expect(new Set(values).size).toBe(values.length);
      expect(ticks.filter((tick) => tick.leftPercent === 100).length).toBeLessThanOrEqual(1);
      expect(ticks.every((tick) => tick.label.length > 0)).toBe(true);
      expect(ticks.every((tick) => tick.leftPercent >= 0 && tick.leftPercent <= 100)).toBe(true);

      for (let index = 1; index < ticks.length; index += 1) {
        expect(values[index]!).toBeGreaterThan(values[index - 1]!);
        const pixelGap = ((ticks[index]!.leftPercent - ticks[index - 1]!.leftPercent) / 100) * width;
        expect(pixelGap).toBeGreaterThanOrEqual(minGap - 1e-9);
      }
    },
  );

  it('短时长仍保持标签间距，不为终点制造重叠刻度', () => {
    const ticks = buildTimelineTicks(100, 128, 64);
    expect(ticks.map((tick) => tick.valueMs)).toEqual([0, 50, 100]);
    expect(ticks.map((tick) => tick.leftPercent)).toEqual([0, 50, 100]);
  });
});

describe('Timeline 片段几何', () => {
  it('把位于时间轴终点的瞬时片段锚定在轨道内部', () => {
    expect(projectTimelineCueGeometry(1_000, 0, 1_000)).toEqual({
      leftPercent: 100,
      widthPercent: 0,
      anchorAtEnd: true,
    });
    expect(projectTimelineCueGeometry(500, 0, 1_000)).toEqual({
      leftPercent: 50,
      widthPercent: 0,
      anchorAtEnd: false,
    });
  });

  it('在零时长时间轴上仍保留一个可右锚定的瞬时点', () => {
    expect(projectTimelineCueGeometry(0, 0, 0)).toEqual({
      leftPercent: 0,
      widthPercent: 0,
      anchorAtEnd: true,
    });
  });
});
