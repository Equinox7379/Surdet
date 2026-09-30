export interface GalleryProfileEntry extends Record<string, unknown> {
  id: string; character: string; title?: string; description?: string;
}
export interface GalleryTermEntry extends Record<string, unknown> {
  id: string; canonical: string; description?: string;
}

/** Metadata references the project's character/terminology truth; unlocks stay in GalleryState. */
export function readGalleryDossiers(gallery: Record<string, unknown>, context?: { characters: Record<string, unknown>; terms: readonly string[] }): {
  profiles: GalleryProfileEntry[]; terms: GalleryTermEntry[];
} {
  for (const section of ['profiles', 'terms'] as const) {
    const entries = gallery[section] ?? [];
    if (gallery[section] === null || !Array.isArray(entries)) throw new Error(`${section === 'profiles' ? '人物档案' : '用语辞典'}必须是数组`);
    const ids = new Set<string>();
    for (const entry of entries) {
      const target = section === 'profiles' ? 'character' : 'canonical';
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || ['id', target].some(key => typeof entry[key] !== 'string' || !entry[key].trim())
        || (entry.description !== undefined && typeof entry.description !== 'string')
        || (section === 'profiles' && entry.title !== undefined && typeof entry.title !== 'string')) {
        throw new Error(`资料必须包含非空 id/${target}，标题和说明须为文字`);
      }
      if (ids.has(entry.id)) throw new Error(`资料标识重复：${section}.${entry.id}`);
      ids.add(entry.id);
      if (context && (section === 'profiles' ? !Object.hasOwn(context.characters, entry.character) : !context.terms.includes(entry.canonical))) {
        throw new Error(`${section === 'profiles' ? '人物' : '规范词'}不存在：${entry[target]}`);
      }
    }
  }
  return { profiles: (gallery.profiles ?? []) as GalleryProfileEntry[], terms: (gallery.terms ?? []) as GalleryTermEntry[] };
}
