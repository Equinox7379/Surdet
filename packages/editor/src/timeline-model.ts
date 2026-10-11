import { resolveTimelineDefinition, TIMELINE_TRANSITION_ACTIONS, validateTimeline, type TimelineCue, type TimelineDefinition, type TimelineEasing, type TimelineTrack, type TimelineTrackKind, type TimelineValue } from '@surdet/core';
import type { TimelineAssetChoice } from './timeline-presentation.js';

export const TIMELINE_TRACKS: readonly TimelineTrackKind[] = [
  'background', 'portrait', 'camera', 'screen', 'particle', 'audio', 'layer',
];

export const TIMELINE_ACTIONS: Record<TimelineTrackKind, readonly string[]> = {
  background: ['set'],
  portrait: ['show', 'hide', 'move', 'expression', 'pose'],
  layer: ['show', 'hide', 'pose'],
  camera: ['zoom', 'pan', 'shake'],
  screen: ['fade', 'tint', 'flash', 'wipe', ...TIMELINE_TRANSITION_ACTIONS],
  particle: ['start', 'stop'],
  audio: ['bgm', 'se', 'voice'],
};

export const TIMELINE_EASINGS: readonly TimelineEasing[] = [
  'linear', 'inOutSine', 'outCubic', 'inOutCubic',
];

export function cloneTimeline(definition: TimelineDefinition): TimelineDefinition {
  return JSON.parse(JSON.stringify(definition)) as TimelineDefinition;
}

/**
 * The background a timeline puts on screen first. Cues are not sorted by time in the file, so this
 * takes the earliest background set after resolving clips; when several land on the same moment the
 * player applies them in track order, then cue order, and the last one applied stays visible.
 */
export function firstTimelineBackground(
  definition: TimelineDefinition,
  lookup: (id: string) => TimelineDefinition | undefined,
): string | null {
  let resolved: TimelineDefinition;
  try { resolved = resolveTimelineDefinition(definition, lookup); } catch { return null; }
  let first: { atMs: number; key: string } | null = null;
  for (const track of resolved.tracks) {
    if (track.kind !== 'background') continue;
    for (const cue of track.cues) {
      const key = cue['key'];
      if (cue.action !== 'set' || typeof key !== 'string') continue;
      // Iteration follows the player's order, so `<=` lets a later cue at the same moment win.
      if (first === null || cue.atMs <= first.atMs) first = { atMs: cue.atMs, key };
    }
  }
  return first?.key ?? null;
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
  return { kind, ...(kind === 'layer' ? { target: 'layer1' } : {}), cues: [] };
}

export interface TimelineCueDraft {
  cue: TimelineCue;
  trackPatch?: { target: string };
}

/** A mask transition names an imported mask; without one there is no valid cue to create. */
export function createNeutralCue(
  kind: 'camera' | 'screen' | 'particle',
  action: string,
  ruleKey?: string,
): TimelineCueDraft | null {
  if (!TIMELINE_ACTIONS[kind].includes(action)) return null;
  if (kind === 'screen' && action === 'rule' && !ruleKey) return null;
  const values: Record<string, TimelineValue> = kind === 'camera'
    ? action === 'pan' ? { x: 0, y: 0 } : action === 'shake' ? { strength: 12 } : { scale: 1.03 }
    : kind === 'screen'
      ? action === 'tint' ? { color: 0x102038, alpha: 0.18 } : action === 'fade' ? { alpha: 0 } : action === 'rule' ? { rule: ruleKey! } : {}
      : action === 'start' ? { kind: 'sparkle' } : {};
  return { cue: cue(action, values) };
}

export function createResourceCue(
  kind: 'background' | 'portrait' | 'audio' | 'layer',
  action: string,
  choice: TimelineAssetChoice,
): TimelineCueDraft | null {
  if (kind === 'layer') {
    if (choice.kind !== 'background' || choice.sourceKind !== 'bg' || action !== 'show') return null;
    return { cue: cue('show', { key: choice.key, band: 'environment', opacity: 1, parallax: 1 }) };
  }
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

/** Actions that target a live object do not invent a texture reference. */
export function createObjectCue(kind: 'portrait' | 'layer', action: string, target: string | undefined): TimelineCueDraft | null {
  if (!target?.trim() || (action !== 'pose' && action !== 'hide')) return null;
  return { cue: cue(action, action === 'pose' ? { x: 640 } : {}) };
}
export function timelineActionsForVersion(kind: TimelineTrackKind, version: 1 | 2): readonly string[] {
  return version === 1 ? TIMELINE_ACTIONS[kind].filter(action => action !== 'pose') : TIMELINE_ACTIONS[kind];
}
