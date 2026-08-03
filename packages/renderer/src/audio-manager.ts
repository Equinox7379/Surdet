import { Howl } from 'howler';
import type { AudioHandle } from './types.js';

/**
 * 音频管理器（howler）。BGM 循环播放且同一 key 不重复启动。
 * 资源缺失时静默（占位素材阶段无音频文件）。
 */
export class AudioManager implements AudioHandle {
  #bgm: Howl | null = null;
  #bgmKey: string | null = null;
  #cache = new Map<string, Howl>();

  playBgm(src: string | null): void {
    if (src === this.#bgmKey) return;
    this.#bgm?.stop();
    this.#bgm = null;
    this.#bgmKey = src;
    if (src === null) return;
    const h = this.#get(src, { loop: true, volume: 0.55 });
    // 先停止该 src 的所有现存播放再开始 BGM：同一 src 可能先前作为 SE 播放过，
    // 直接 h.play() 会与旧实例重叠（howler 同 Howl 多次 play 创建多个 sound）。
    h.stop();
    h.play();
    this.#bgm = h;
  }

  playSe(src: string): void {
    this.#get(src, { volume: 0.9 }).play();
  }

  playVoice(src: string): void {
    this.#get(src, { volume: 1 }).play();
  }

  stopAll(): void {
    this.#bgm?.stop();
    this.#bgm = null;
    this.#bgmKey = null;
  }

  #get(src: string, opts: { loop?: boolean; volume?: number }): Howl {
    let h = this.#cache.get(src);
    if (!h) {
      h = new Howl({
        src: [src],
        loop: opts.loop ?? false,
        volume: opts.volume ?? 1,
        onloaderror: () => {
          // 音频缺失：占位素材阶段静默
        },
      });
      this.#cache.set(src, h);
    } else {
      // 复用缓存时刷新播放配置：同一 src 可能先以 SE 播放、后被 BGM 引用（或反之），
      // 首次创建时固定的 loop/volume 不再适用，必须按本次用途更新。
      h.loop(opts.loop ?? false);
      h.volume(opts.volume ?? 1);
    }
    return h;
  }
}
