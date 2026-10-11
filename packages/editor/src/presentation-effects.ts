import { BUILTIN_TRANSITION_NAMES, STORY_FILTER_NAMES, type BuiltinTransitionName, type StoryFilterName } from '@surdet/core';
import { buildAssetCatalog } from '@surdet/authoring';
import type { DirAsset } from './assets.js';

/** Display names for the Core lists; the script keeps the English values. */
export const TRANSITION_LABELS: Readonly<Record<BuiltinTransitionName, string>> = {
  fade: '淡入淡出', 'slide-left': '向左滑动', 'slide-right': '向右滑动', circle: '圆形展开', dissolve: '溶解', rule: '遮罩',
};
export const STORY_FILTER_LABELS: Readonly<Record<StoryFilterName, string>> = {
  blur: '模糊', grayscale: '灰度', sepia: '怀旧', vignette: '暗角', off: '清除',
};
export const DEFAULT_RULE_SOFT = 0.15;

export const isTransitionName = (name: string): name is BuiltinTransitionName => (BUILTIN_TRANSITION_NAMES as readonly string[]).includes(name);
export const isStoryFilterName = (name: string): name is StoryFilterName => (STORY_FILTER_NAMES as readonly string[]).includes(name);

/** Mask keys the Player can load, as project.assets.rules reports them: resolved images only. */
export function resolvedRuleKeys(assets: readonly DirAsset[]): string[] {
  const paths = assets.flatMap((asset) => asset.sourcePath ? [asset.sourcePath] : []);
  return buildAssetCatalog(paths).rules.filter((entry) => entry.resolved).map((entry) => entry.key);
}

export function transitionSummary(args: readonly string[]): string {
  const [name, duration] = args;
  return [name === undefined ? '' : isTransitionName(name) ? TRANSITION_LABELS[name] : name, duration === undefined ? '' : `${duration} 毫秒`].filter(Boolean).join('  ');
}

export function filterSummary(args: readonly string[]): string {
  const [name, duration] = args;
  const label = name === undefined ? '' : isStoryFilterName(name) ? STORY_FILTER_LABELS[name] : name;
  return [label, duration === undefined || Number(duration) === 0 ? '' : `${duration} 毫秒过渡`].filter(Boolean).join('  ');
}
