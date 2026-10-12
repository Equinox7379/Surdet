/** Finite author-controlled world effects; not the player's colour preferences. */
export const STORY_FILTER_NAMES = ['blur', 'grayscale', 'sepia', 'vignette', 'off'] as const;
export type StoryFilterName = typeof STORY_FILTER_NAMES[number];
export function parseStoryFilter(args: readonly string[]): { name: StoryFilterName; durationMs: number } {
  const name = args[0];
  if (!STORY_FILTER_NAMES.includes(name as StoryFilterName)) throw new Error(`滤镜须为 ${STORY_FILTER_NAMES.join('、')}`);
  if (args.length > 2) throw new Error('@filter 只接受名称与可选时长');
  const durationMs = args[1] === undefined ? 0 : Number(args[1]);
  if (args[1]?.trim() === '' || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > 600_000) throw new Error('滤镜时长须为0–600000毫秒');
  return { name: name as StoryFilterName, durationMs };
}
