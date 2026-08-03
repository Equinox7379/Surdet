/**
 * 回想/鉴赏系统：CG 与音乐解锁状态。
 * @unlock_cg / @unlock_music 指令由 Interpreter 驱动，状态可随存档持久化。
 */

/** 解锁状态快照（随存档保存） */
export interface GallerySnapshot {
  cgs: string[];
  music: string[];
}

export class GalleryState {
  #cgs = new Set<string>();
  #music = new Set<string>();

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
    return { cgs: this.cgs, music: this.music };
  }

  restore(snap: GallerySnapshot): void {
    this.#cgs = new Set(snap.cgs);
    this.#music = new Set(snap.music);
  }
}
