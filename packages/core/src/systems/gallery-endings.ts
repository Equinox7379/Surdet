/** Ending-book metadata; completion remains owned by ClearTracker, not GalleryState. */
export interface GalleryEndingEntry extends Record<string, unknown> {
  id: string;
  name: string;
  description?: string;
}

export function readGalleryEndings(gallery: Record<string, unknown>): GalleryEndingEntry[] {
  const entries = gallery.endings === undefined ? [] : gallery.endings;
  if (!Array.isArray(entries)) throw new Error('结局册 endings 必须是数组');
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || ['id', 'name'].some(key => typeof entry[key] !== 'string' || !entry[key].trim())
      || (entry.description !== undefined && typeof entry.description !== 'string')) {
      throw new Error('结局必须包含非空 id/name，description 若提供必须是文字');
    }
    if (ids.has(entry.id)) throw new Error(`结局标识重复：${entry.id}`);
    ids.add(entry.id);
  }
  return entries;
}

/** Display union only. Loading a save never imports completions into the profile. */
export function effectiveEndingUnlocks(story: readonly string[], permanent: readonly string[], scope: 'save' | 'profile' = 'save'): string[] {
  return [...new Set(scope === 'profile' ? [...story, ...permanent] : story)];
}
