import type { TimelineEasing, TimelineTrackKind } from '@surdet/core';
import type { DirAsset } from './assets.js';

export interface TimelineTick {
  valueMs: number;
  label: string;
  leftPercent: number;
}

export interface TimelineAssetChoice {
  kind: 'background' | 'portrait' | 'audio';
  key: string;
  expression?: string;
  sourceKind: 'bg' | 'portrait' | 'bgm' | 'se' | 'voice';
}

const TRACK_LABELS: Record<TimelineTrackKind, string> = {
  background: '背景',
  portrait: '角色立绘',
  camera: '镜头',
  screen: '画面效果',
  particle: '粒子特效',
  audio: '声音',
};

const ACTION_LABELS: Record<TimelineTrackKind, Readonly<Record<string, string>>> = {
  background: { set: '设置背景' },
  portrait: {
    show: '显示角色',
    hide: '隐藏角色',
    move: '移动角色',
    expression: '切换表情',
  },
  camera: {
    zoom: '缩放镜头',
    pan: '平移镜头',
    shake: '镜头震动',
  },
  screen: {
    fade: '透明度渐变',
    tint: '叠加色调',
    flash: '闪白',
    wipe: '擦除转场',
  },
  particle: {
    start: '启动粒子特效',
    stop: '停止粒子特效',
  },
  audio: {
    bgm: '背景音乐',
    se: '音效',
    voice: '语音',
  },
};

const EASING_LABELS: Record<TimelineEasing, string> = {
  linear: '匀速',
  inOutSine: '柔和起止',
  outCubic: '快出慢收',
  inOutCubic: '平滑加减速',
};

export function timelineTrackLabel(kind: TimelineTrackKind): string {
  return TRACK_LABELS[kind];
}

export function timelineActionLabel(kind: TimelineTrackKind, action: string): string {
  return ACTION_LABELS[kind][action] ?? action;
}

export function timelineEasingLabel(easing: TimelineEasing): string {
  return EASING_LABELS[easing];
}

export function timelineAssetChoices(dirAssets: readonly DirAsset[]): TimelineAssetChoice[] {
  const choices: TimelineAssetChoice[] = [];

  for (const asset of dirAssets) {
    if (asset.kind === 'bg') {
      choices.push({ kind: 'background', key: asset.key, sourceKind: 'bg' });
    } else if (asset.kind === 'portrait') {
      choices.push({
        kind: 'portrait',
        key: asset.key,
        ...(asset.expr === undefined ? {} : { expression: asset.expr }),
        sourceKind: 'portrait',
      });
    } else if (asset.kind === 'bgm' || asset.kind === 'se' || asset.kind === 'voice') {
      choices.push({ kind: 'audio', key: asset.key, sourceKind: asset.kind });
    }
  }

  return choices;
}

function naturalStepAtLeast(value: number): number {
  const exponent = Math.floor(Math.log10(value));
  const power = 10 ** exponent;
  const normalized = value / power;
  const epsilon = 1e-12;

  if (normalized <= 1 + epsilon) return power;
  if (normalized <= 2 + epsilon) return 2 * power;
  if (normalized <= 5 + epsilon) return 5 * power;
  return 10 * power;
}

function tickLabel(valueMs: number): string {
  if (Math.abs(valueMs) < 1000) return `${Number(valueMs.toFixed(3))}ms`;
  return `${Number((valueMs / 1000).toFixed(3))}s`;
}

export function buildTimelineTicks(
  durationMs: number,
  availableWidth: number,
  minLabelGap = 64,
): TimelineTick[] {
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const width = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;
  const gap = Number.isFinite(minLabelGap) && minLabelGap > 0 ? minLabelGap : 64;

  const toTick = (valueMs: number): TimelineTick => ({
    valueMs,
    label: tickLabel(valueMs),
    leftPercent: duration === 0 ? 0 : Math.min(100, Math.max(0, (valueMs / duration) * 100)),
  });

  if (duration === 0) return [toTick(0)];

  const intervalCapacity = Math.floor(width / gap);
  if (intervalCapacity < 1) return [toTick(0)];

  const step = naturalStepAtLeast(duration / intervalCapacity);
  const values = [0];
  const pixelGap = (fromMs: number, toMs: number): number => ((toMs - fromMs) / duration) * width;
  const epsilon = 1e-9;

  for (let index = 1; ; index += 1) {
    const value = index * step;
    if (value >= duration) break;

    const previous = values[values.length - 1]!;
    if (
      pixelGap(previous, value) >= gap - epsilon
      && pixelGap(value, duration) >= gap - epsilon
    ) {
      values.push(value);
    }
  }

  const previous = values[values.length - 1]!;
  if (pixelGap(previous, duration) >= gap - epsilon) values.push(duration);

  return values.map(toTick);
}
