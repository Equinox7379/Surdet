import { describe, expect, it } from 'vitest';
import { resolveTimelineDefinition, validateTimeline, type TimelineDefinition } from '@surdet/core';
import { TimelinePlayer } from '@surdet/renderer';
import { createNeutralCue, createResourceCue, createTimeline, createTrack, easingPath, easingValue, firstTimelineBackground, parseTimelineText, stringifyTimeline } from '../src/timeline-model.js';

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
    expect(result.issues.some((issue) => issue.includes('TL006'))).toBe(true);
  });
});

describe('时间轴首先显示的背景', () => {
  const set = (key: string, atMs: number) => ({ atMs, durationMs: 0, easing: 'linear' as const, action: 'set', key });
  const timeline = (id: string, tracks: TimelineDefinition['tracks'], extra: Partial<TimelineDefinition> = {}): TimelineDefinition =>
    ({ version: 1, id, durationMs: 2000, tracks, ...extra });
  const library = (...definitions: TimelineDefinition[]) => (id: string) => definitions.find((definition) => definition.id === id);

  /** What the real player puts on screen first, stepping cue boundary by cue boundary. */
  function playerFirstBackground(definition: TimelineDefinition, lookup: (id: string) => TimelineDefinition | undefined): string | null {
    const player = new TimelinePlayer(resolveTimelineDefinition(definition, lookup));
    let events = player.advance(0);
    for (;;) {
      const sets = events.filter((event) => event.track === 'background' && event.started && event.cue.action === 'set');
      if (sets.length > 0) return String(sets.at(-1)!.cue['key']);
      if (player.done) return null;
      events = player.advance(player.timeToBoundary());
    }
  }

  const cases: [string, TimelineDefinition, TimelineDefinition[]][] = [
    ['同一轨道里晚出现的条目写在前面', timeline('intro', [{ kind: 'background', cues: [set('night', 1500), set('morning', 0)] }]), []],
    ['不同背景轨道，后一条轨道更早', timeline('intro', [
      { kind: 'background', cues: [set('dusk', 800)] },
      { kind: 'background', cues: [set('harbor', 200)] },
    ]), []],
    ['同一时刻跨轨道，后应用的留在画面上', timeline('intro', [
      { kind: 'background', cues: [set('first', 0)] },
      { kind: 'background', cues: [set('second', 0)] },
    ]), []],
    ['同一时刻同一轨道，后一条留在画面上', timeline('intro', [{ kind: 'background', cues: [set('first', 0), set('second', 0)] }]), []],
    ['v2 片段里的背景比父时间轴更早', timeline('intro', [{ kind: 'background', cues: [set('parent', 500)] }],
      { version: 2, clips: [{ timelineId: 'child', atMs: 300 }] }),
    [timeline('child', [{ kind: 'background', cues: [set('child', 0)] }], { durationMs: 200 })]],
  ];

  it.each(cases)('%s', (_name, definition, others) => {
    const lookup = library(definition, ...others);
    expect(validateTimeline(definition)).toEqual([]);
    const expected = playerFirstBackground(definition, lookup);
    expect(expected).not.toBeNull();
    expect(firstTimelineBackground(definition, lookup)).toBe(expected);
  });

  it('评论中的反例取 morning 而不是 night', () => {
    const definition = cases[0]![1];
    expect(firstTimelineBackground(definition, library(definition))).toBe('morning');
  });

  it('没有背景或片段无法解析时不给结果', () => {
    expect(firstTimelineBackground(timeline('quiet', [{ kind: 'camera', cues: [{ atMs: 0, durationMs: 100, easing: 'linear', action: 'shake', strength: 4 }] }]), library())).toBeNull();
    const missing = timeline('intro', [{ kind: 'background', cues: [set('parent', 500)] }], { version: 2, clips: [{ timelineId: 'gone', atMs: 0 }] });
    expect(firstTimelineBackground(missing, library(missing))).toBeNull();
  });
});
