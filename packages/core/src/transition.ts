/** One finite builtin list consumed by validation, rendering and authoring UI. */
export const BUILTIN_TRANSITION_NAMES = ['fade', 'slide-left', 'slide-right', 'circle', 'dissolve', 'rule'] as const;
export type BuiltinTransitionName = typeof BUILTIN_TRANSITION_NAMES[number];
export const BUILTIN_TRANSITIONS: ReadonlySet<string> = new Set(BUILTIN_TRANSITION_NAMES);
/** Timeline cues reveal a captured old world; they never own stage properties. */
export const TIMELINE_TRANSITION_ACTIONS = ['dissolve', 'rule'] as const;
export interface RuleTransitionOptions { rule: string; soft: number; reverse: boolean }
/** Values have already been decoded by the Core lexer/host; no file IO here. */
export function parseRuleTransition(modifiers: ReadonlyMap<string, string>): RuleTransitionOptions {
  const rule = modifiers.get('rule')?.trim();
  if (!rule) throw new Error('@transition rule 必须指定 @rule 遮罩素材键');
  const rawSoft = modifiers.get('soft'), soft = rawSoft === undefined ? .15 : Number(rawSoft);
  if (rawSoft?.trim() === '' || !Number.isFinite(soft) || soft < 0 || soft > 1) throw new Error('遮罩柔和度 @soft 须为0–1');
  const reverse = modifiers.get('reverse');
  if (reverse !== undefined && !['', 'true', 'false', '1', '0'].includes(reverse)) throw new Error('@reverse 须为开关或true/false');
  return { rule, soft, reverse: reverse !== undefined && reverse !== 'false' && reverse !== '0' };
}
