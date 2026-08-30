import { describe, expect, it } from 'vitest';
import { validateTimeline } from '@surdet/core';
import { createCue, createTimeline, createTrack, easingPath, easingValue, parseTimelineText, stringifyTimeline } from '../src/timeline-model.js';

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
    expect(validateTimeline({
      version: 1,
      id: 'camera_beats',
      durationMs: 600,
      tracks: [{ kind: 'camera', cues: [createCue('camera', 'pan'), createCue('camera', 'shake')] }],
    })).toEqual([]);
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
