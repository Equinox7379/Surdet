import { validateTimeline, type TimelineCue, type TimelineDefinition, type TimelineEasing, type TimelineTrack, type TimelineTrackKind, type TimelineValue } from '@surdet/core';

export const TIMELINE_TRACKS: readonly TimelineTrackKind[] = [
  'background', 'portrait', 'camera', 'screen', 'particle', 'audio',
];

export const TIMELINE_ACTIONS: Record<TimelineTrackKind, readonly string[]> = {
  background: ['set'],
  portrait: ['show', 'hide', 'move', 'expression'],
  camera: ['zoom', 'pan', 'shake'],
  screen: ['fade', 'tint', 'flash', 'wipe'],
  particle: ['start', 'stop'],
  audio: ['bgm', 'se', 'voice'],
};

export const TIMELINE_EASINGS: readonly TimelineEasing[] = [
  'linear', 'inOutSine', 'outCubic', 'inOutCubic',
];

export function cloneTimeline(definition: TimelineDefinition): TimelineDefinition {
  return JSON.parse(JSON.stringify(definition)) as TimelineDefinition;
}

export function stringifyTimeline(definition: TimelineDefinition): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

export function parseTimelineText(text: string): { definition: TimelineDefinition | null; issues: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    return { definition: null, issues: [`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`] };
  }
  const issues = validateTimeline(value).map((diagnostic) => `${diagnostic.path ?? '$'}：${diagnostic.message}（${diagnostic.code}）`);
  return {
    definition: issues.length === 0 ? cloneTimeline(value as TimelineDefinition) : null,
    issues,
  };
}

function cue(action: string, values: Record<string, TimelineValue> = {}): TimelineCue {
  return {
    atMs: 0,
    durationMs: 600,
    easing: 'outCubic',
    action,
    ...values,
  } as TimelineCue;
}

export function createTimeline(id: string): TimelineDefinition {
  return {
    version: 1,
    id,
    durationMs: 1200,
    tracks: [{ kind: 'screen', cues: [cue('fade', { alpha: 0 })] }],
  };
}

export function createTrack(kind: TimelineTrackKind): TimelineTrack {
  const defaults: Record<TimelineTrackKind, TimelineTrack> = {
    background: { kind, cues: [cue('set', { key: 'castle_hall' })] },
    portrait: { kind, target: 'lynn:uniform', cues: [cue('show', { expression: 'normal', position: 'center' })] },
    camera: { kind, cues: [cue('zoom', { scale: 1.03 })] },
    screen: { kind, cues: [cue('fade', { alpha: 0 })] },
    particle: { kind, cues: [cue('start', { kind: 'sparkle' })] },
    audio: { kind, cues: [cue('bgm', { key: 'tense_01' })] },
  };
  return JSON.parse(JSON.stringify(defaults[kind])) as TimelineTrack;
}

export function createCue(kind: TimelineTrackKind, action = TIMELINE_ACTIONS[kind][0]!): TimelineCue {
  const defaults: Record<TimelineTrackKind, Record<string, TimelineValue>> = {
    background: { key: 'castle_hall' },
    portrait: { expression: 'normal', position: 'center' },
    camera: action === 'pan' ? { x: 0, y: 0 } : action === 'shake' ? { strength: 12 } : { scale: 1.03 },
    screen: action === 'tint' ? { color: 0x102038, alpha: 0.18 } : action === 'fade' ? { alpha: 0 } : {},
    particle: action === 'start' ? { kind: 'sparkle' } : {},
    audio: { key: 'tense_01' },
  };
  return cue(action, defaults[kind]);
}

/** 与运行时缓动保持同一口径，供时间轴编辑器绘制轻量曲线预览。 */
export function easingValue(easing: TimelineEasing, t: number): number {
  const x = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'inOutSine': return -(Math.cos(Math.PI * x) - 1) / 2;
    case 'outCubic': return 1 - Math.pow(1 - x, 3);
    case 'inOutCubic': return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'linear': return x;
  }
}

export function easingPath(easing: TimelineEasing, samples = 20): string {
  const count = Math.max(2, Math.round(samples));
  return Array.from({ length: count }, (_, index) => {
    const x = index / (count - 1) * 100;
    const y = 24 - easingValue(easing, index / (count - 1)) * 20 - 2;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
