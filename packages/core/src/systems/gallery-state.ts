/**
 * 回想/鉴赏系统：CG 与音乐解锁状态。
 * @unlock_cg / @unlock_music 指令由 Interpreter 驱动，状态可随存档持久化。
 */

/** 解锁状态快照（随存档保存；texts 为文本回想，旧档无此字段按空处理） */
export interface GallerySnapshot {
  cgs: string[];
  music: string[];
  texts?: string[];
}

export class GalleryState {
  #cgs = new Set<string>();
  #music = new Set<string>();
  /** 文本回想解锁 ID（@unlock_text 驱动） */
  #texts = new Set<string>();

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
    return { cgs: this.cgs, music: this.music, texts: this.texts };
  }

  restore(snap: GallerySnapshot): void {
    this.#cgs = new Set(snap.cgs);
    this.#music = new Set(snap.music);
    this.#texts = new Set(snap.texts ?? []); // 旧档无 texts 字段按空
  }
}
