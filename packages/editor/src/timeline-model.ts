import { validateTimeline, type TimelineCue, type TimelineDefinition, type TimelineEasing, type TimelineTrack, type TimelineTrackKind, type TimelineValue } from '@surdet/core';
import type { TimelineAssetChoice } from './timeline-presentation.js';

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

export function stringifyTimeline(definition: TimelineDefinition, eol: '\r\n' | '\n' = '\n'): string {
  const lf = `${JSON.stringify(definition, null, 2)}\n`;
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
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
  return { kind, cues: [] };
}

export interface TimelineCueDraft {
  cue: TimelineCue;
  trackPatch?: { target: string };
}

export function createNeutralCue(
  kind: 'camera' | 'screen' | 'particle',
  action: string,
): TimelineCueDraft | null {
  if (!TIMELINE_ACTIONS[kind].includes(action)) return null;
  const values: Record<string, TimelineValue> = kind === 'camera'
    ? action === 'pan' ? { x: 0, y: 0 } : action === 'shake' ? { strength: 12 } : { scale: 1.03 }
    : kind === 'screen'
      ? action === 'tint' ? { color: 0x102038, alpha: 0.18 } : action === 'fade' ? { alpha: 0 } : {}
      : action === 'start' ? { kind: 'sparkle' } : {};
  return { cue: cue(action, values) };
}

export function createResourceCue(
  kind: 'background' | 'portrait' | 'audio',
  action: string,
  choice: TimelineAssetChoice,
): TimelineCueDraft | null {
  if (choice.kind !== kind || !TIMELINE_ACTIONS[kind].includes(action)) return null;
  if (kind === 'background') {
    return choice.sourceKind === 'bg' && action === 'set'
      ? { cue: cue(action, { key: choice.key }) }
      : null;
  }
  if (kind === 'audio') {
    return choice.sourceKind === action
      ? { cue: cue(action, { key: choice.key }) }
      : null;
  }
  if (choice.sourceKind !== 'portrait') return null;
  if ((action === 'show' || action === 'expression') && !choice.expression) return null;
  const values: Record<string, TimelineValue> = {};
  if (action === 'show' || action === 'expression') values.expression = choice.expression!;
  if (action === 'show' || action === 'move') values.position = 'center';
  return { cue: cue(action, values), trackPatch: { target: choice.key } };
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
