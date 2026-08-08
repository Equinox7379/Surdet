import { describe, expect, it } from 'vitest';
import { validateTimeline } from '@surdet/core';
import { createCue, createTimeline, createTrack, parseTimelineText, stringifyTimeline } from '../src/timeline-model.js';

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
      tracks: [{ kind: 'camera', cues: [createCue('camera')] }],
    })).toEqual([]);
  });

  it('格式化 JSON 可解析并保持时间轴数据', () => {
    const source = createTimeline('intro');
    const result = parseTimelineText(stringifyTimeline(source));
    expect(result.issues).toEqual([]);
    expect(result.definition).toEqual(source);
  });

  it('按动作创建 cue 时补齐该动作的必需参数', () => {
    expect(validateTimeline({
      version: 1,
      id: 'screen_tint',
      durationMs: 600,
      tracks: [{ kind: 'screen', cues: [createCue('screen', 'tint')] }],
    })).toEqual([]);
    expect(validateTimeline({
      version: 1,
      id: 'portrait_hide',
      durationMs: 600,
      tracks: [{ kind: 'portrait', target: 'lynn:uniform', cues: [createCue('portrait', 'hide')] }],
    })).toEqual([]);
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
