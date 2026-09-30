/**
 * 回想/鉴赏系统：CG 与音乐解锁状态。
 * @unlock_cg / @unlock_music 指令由 Interpreter 驱动，状态可随存档持久化。
 */

/** 解锁状态快照（随存档保存；texts 为文本回想，旧档无此字段按空处理） */
export interface GallerySnapshot {
  cgs: string[];
  music: string[];
  texts?: string[];
  profiles?: string[];
  terms?: string[];
}

export type GalleryUnlockScope = 'save' | 'profile';
export interface GalleryUnlockPolicy { cgs: GalleryUnlockScope; music: GalleryUnlockScope; texts?: GalleryUnlockScope; endings?: GalleryUnlockScope; profiles?: GalleryUnlockScope; terms?: GalleryUnlockScope }

/** Only an explicit profile policy makes a collection permanent. */
export function readGalleryUnlockPolicy(gallery: unknown): GalleryUnlockPolicy {
  const raw = (gallery as { unlockPolicy?: unknown } | null)?.unlockPolicy;
  if (raw === undefined) return { cgs: 'save', music: 'save', texts: 'save', endings: 'save', profiles: 'save', terms: 'save' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('鉴赏收藏策略必须是对象');
  const policy = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(policy)) {
    if (!['cgs', 'music', 'texts', 'endings', 'profiles', 'terms'].includes(key) || !['save', 'profile'].includes(value as string)) {
      throw new Error(`无效的鉴赏收藏策略：${key}（各类收藏支持 save/profile）`);
    }
  }
  return { cgs: (policy.cgs ?? 'save') as GalleryUnlockScope, music: (policy.music ?? 'save') as GalleryUnlockScope, texts: (policy.texts ?? 'save') as GalleryUnlockScope, endings: (policy.endings ?? 'save') as GalleryUnlockScope, profiles: (policy.profiles ?? 'save') as GalleryUnlockScope, terms: (policy.terms ?? 'save') as GalleryUnlockScope };
}

/** Presentation union only: never put the permanent profile back into a story snapshot. */
export function effectiveGalleryUnlocks(story: GallerySnapshot, permanent: GallerySnapshot, policy: GalleryUnlockPolicy): GallerySnapshot {
  return {
    cgs: policy.cgs === 'profile' ? [...new Set([...story.cgs, ...permanent.cgs])] : [...story.cgs],
    music: policy.music === 'profile' ? [...new Set([...story.music, ...permanent.music])] : [...story.music],
    texts: policy.texts === 'profile' ? [...new Set([...(story.texts ?? []), ...(permanent.texts ?? [])])] : [...(story.texts ?? [])],
    ...(story.profiles || permanent.profiles ? { profiles: policy.profiles === 'profile' ? [...new Set([...(story.profiles ?? []), ...(permanent.profiles ?? [])])] : [...(story.profiles ?? [])] } : {}),
    ...(story.terms || permanent.terms ? { terms: policy.terms === 'profile' ? [...new Set([...(story.terms ?? []), ...(permanent.terms ?? [])])] : [...(story.terms ?? [])] } : {}),
  };
}

export class GalleryState {
  #cgs = new Set<string>();
  #music = new Set<string>();
  /** 文本回想解锁 ID（@unlock_text 驱动） */
  #texts = new Set<string>();
  #profiles = new Set<string>();
  #terms = new Set<string>();

  unlockProfile(id: string): boolean {
    if (this.#profiles.has(id)) return false;
    this.#profiles.add(id);
    return true;
  }

  unlockTerm(id: string): boolean {
    if (this.#terms.has(id)) return false;
    this.#terms.add(id);
    return true;
  }

  /** 解锁 CG，返回是否首次解锁（用于提示新解锁） */
  unlockCg(id: string): boolean {
    if (this.#cgs.has(id)) return false;
    this.#cgs.add(id);
    return true;
  }

  unlockMusic(id: string): boolean {
    if (this.#music.has(id)) return false;
    this.#music.add(id);
    return true;
  }

  /** 解锁文本回想，返回是否首次解锁 */
  unlockText(id: string): boolean {
    if (this.#texts.has(id)) return false;
    this.#texts.add(id);
    return true;
  }

  hasText(id: string): boolean {
    return this.#texts.has(id);
  }

  get texts(): string[] {
    return [...this.#texts];
  }

  hasCg(id: string): boolean {
    return this.#cgs.has(id);
  }

  hasMusic(id: string): boolean {
    return this.#music.has(id);
  }

  get cgs(): string[] {
    return [...this.#cgs];
  }

  get music(): string[] {
    return [...this.#music];
  }

  snapshot(): GallerySnapshot {
    return { cgs: this.cgs, music: this.music, texts: this.texts,
      ...(this.#profiles.size ? { profiles: [...this.#profiles] } : {}), ...(this.#terms.size ? { terms: [...this.#terms] } : {}) };
  }

  restore(snap: GallerySnapshot): void {
    this.#cgs = new Set(snap.cgs);
    this.#music = new Set(snap.music);
    this.#texts = new Set(snap.texts ?? []); // 旧档无 texts 字段按空
    this.#profiles = new Set(snap.profiles ?? []);
    this.#terms = new Set(snap.terms ?? []);
  }
}
