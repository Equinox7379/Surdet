import { describe, expect, it } from 'vitest';
import { validateTimeline } from '@surdet/core';
import { createNeutralCue, createResourceCue, createTimeline, createTrack, easingPath, easingValue, parseTimelineText, stringifyTimeline } from '../src/timeline-model.js';

describe('时间轴编辑模型', () => {
  it('新建模板可直接通过 core 校验', () => {
    expect(validateTimeline(createTimeline('intro'))).toEqual([]);
    expect(validateTimeline({
      version: 1,
      id: 'portrait_intro',
      durationMs: 600,
      tracks: [createTrack('portrait')],
    })).toEqual([]);
    expect(validateTimeline({
      version: 1,
      id: 'intro',
      durationMs: 600,
      tracks: [{ kind: 'camera', cues: [createNeutralCue('camera', 'zoom')!.cue] }],
    })).toEqual([]);
  });

  it('格式化 JSON 可解析并保持时间轴数据', () => {
    const source = createTimeline('intro');
    const result = parseTimelineText(stringifyTimeline(source));
    expect(result.issues).toEqual([]);
    expect(result.definition).toEqual(source);
  });

  it('按指定文档换行格式化并保留唯一末尾换行', () => {
    const source = createTimeline('intro');
    const crlf = stringifyTimeline(source, '\r\n');
    const lf = stringifyTimeline(source, '\n');

    expect(crlf).not.toMatch(/(^|[^\r])\n/);
    expect(crlf.endsWith('\r\n')).toBe(true);
    expect(lf).not.toContain('\r\n');
    expect(lf.endsWith('\n')).toBe(true);
    expect(parseTimelineText(crlf).definition).toEqual(source);
    expect(parseTimelineText(lf).definition).toEqual(source);
  });

  it('新轨道保持空白，不注入 Starter 专属资源', () => {
    for (const kind of ['background', 'portrait', 'camera', 'screen', 'particle', 'audio'] as const) {
      expect(createTrack(kind)).toEqual({ kind, cues: [] });
    }
    expect(JSON.stringify((['background', 'portrait', 'audio'] as const).map((kind) => createTrack(kind))))
      .not.toMatch(/castle_hall|lynn:uniform|tense_01/);
  });

  it('中性动作只创建完整非资源 cue，资源动作必须显式提供项目选择', () => {
    expect(validateTimeline({
      version: 1,
      id: 'screen_tint',
      durationMs: 600,
      tracks: [{ kind: 'screen', cues: [createNeutralCue('screen', 'tint')!.cue] }],
    })).toEqual([]);
    expect(validateTimeline({
      version: 1,
      id: 'portrait_hide',
      durationMs: 600,
      tracks: [{ kind: 'portrait', target: 'lynn:uniform', cues: [createResourceCue('portrait', 'hide', { kind: 'portrait', key: 'lynn:uniform', expression: 'normal', sourceKind: 'portrait' })!.cue] }],
    })).toEqual([]);
    expect(validateTimeline({
      version: 1,
      id: 'camera_beats',
      durationMs: 600,
      tracks: [{ kind: 'camera', cues: [createNeutralCue('camera', 'pan')!.cue, createNeutralCue('camera', 'shake')!.cue] }],
    })).toEqual([]);
    expect(createNeutralCue('camera', 'future-action')).toBeNull();
  });

  it('资源 cue 校验轨道/动作并为立绘返回同次提交的 target patch', () => {
    expect(createResourceCue('background', 'set', { kind: 'background', key: 'rain_station', sourceKind: 'bg' }))
      .toMatchObject({ cue: { action: 'set', key: 'rain_station' } });
    expect(createResourceCue('audio', 'se', { kind: 'audio', key: 'door_close', sourceKind: 'se' }))
      .toMatchObject({ cue: { action: 'se', key: 'door_close' } });
    expect(createResourceCue('portrait', 'show', { kind: 'portrait', key: 'lynn:uniform', expression: 'normal', sourceKind: 'portrait' }))
      .toMatchObject({ cue: { action: 'show', expression: 'normal', position: 'center' }, trackPatch: { target: 'lynn:uniform' } });
    expect(createResourceCue('audio', 'voice', { kind: 'background', key: 'castle_hall', sourceKind: 'bg' })).toBeNull();
    expect(createResourceCue('audio', 'bgm', { kind: 'audio', key: 'door_close', sourceKind: 'se' })).toBeNull();
  });

  it('曲线预览使用与运行时一致的端点和可用路径', () => {
    expect(easingValue('linear', 0.5)).toBe(0.5);
    expect(easingValue('outCubic', 0)).toBe(0);
    expect(easingValue('outCubic', 1)).toBe(1);
    expect(easingPath('inOutSine', 5)).toMatch(/^M0\.0,22\.0 L/);
    expect(easingPath('inOutSine', 5)).toContain('L100.0,2.0');
  });

  it('坏 JSON 和非法 cue 隔离为可见问题，不抛出', () => {
    expect(parseTimelineText('{bad').definition).toBeNull();
    const result = parseTimelineText(JSON.stringify({
      version: 1,
      id: 'broken',
      durationMs: 100,
      tracks: [{ kind: 'screen', cues: [{ atMs: 90, durationMs: 20, easing: 'linear', action: 'fade', alpha: 0 }] }],
    }));
    expect(result.definition).toBeNull();
    expect(result.issues.some((issue) => issue.includes('T006'))).toBe(true);
  });
});
