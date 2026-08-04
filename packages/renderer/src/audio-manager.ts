import { Howl, Howler } from 'howler';
import type { AudioHandle } from './types.js';

/** BGM 切换交叉淡入淡出时长（毫秒） */
const BGM_FADE_MS = 350;

/**
 * 音频管理器（howler）。
 *  - BGM 循环播放、同 key 不重复启动、切换时交叉淡入淡出（旧曲淡出后停止，新曲淡入）
 *  - 主音量（Howler 全局）× 分轨音量（BGM/SE/语音）两级音量，设置界面可直接接入
 *  - 语音播放状态查询（isVoicePlaying），宿主可做"语音播完再推进"等策略
 *  - 资源缺失时静默（占位素材阶段无音频文件）
 */
export class AudioManager implements AudioHandle {
  #bgm: Howl | null = null;
  #bgmKey: string | null = null;
  /** 切歌代际计数：延时停止旧曲的定时器仅在代际未再变化时执行，
   *  防止 A→B→A 快速切换时旧定时器误停重新启播的同名 BGM（导致永久静音）。 */
  #bgmEpoch = 0;
  #voice: Howl | null = null;
  #cache = new Map<string, Howl>();
  #bgmVolume = 0.55;
  #seVolume = 0.9;
  #voiceVolume = 1;

  playBgm(src: string | null): void {
    if (src === this.#bgmKey) return;
    const prev = this.#bgm;
    this.#bgm = null;
    this.#bgmKey = src;
    // 旧 BGM：淡出后停止（howler fade 无同步完成回调，用 setTimeout 兜底停止；
    // 期间新旧两轨短暂重叠即交叉淡入淡出效果）。淡出中切回同 key 属极端场景，不做防护。
    if (prev) {
      if (typeof (prev as { fade?: unknown }).fade === 'function') {
        const epoch = ++this.#bgmEpoch;
        prev.fade(prev.volume(), 0, BGM_FADE_MS);
        setTimeout(() => {
          // 期间又切过歌（代际已变）则跳过：旧实例可能已被复用为当前 BGM
          if (epoch === this.#bgmEpoch) prev.stop();
        }, BGM_FADE_MS);
      } else {
        prev.stop();
      }
    }
    if (src === null) return;
    const h = this.#get(src, { loop: true, channel: 'bgm' });
    // 先停止该 src 的所有现存播放再开始 BGM：同一 src 可能先前作为 SE 播放过，
    // 直接 h.play() 会与旧实例重叠（howler 同 Howl 多次 play 创建多个 sound）。
    h.stop();
    const target = this.#bgmVolume;
    if (typeof (h as { fade?: unknown }).fade === 'function') {
      h.volume(0);
      h.play();
      h.fade(0, target, BGM_FADE_MS);
    } else {
      h.play();
    }
    this.#bgm = h;
  }

  playSe(src: string): void {
    this.#get(src, { channel: 'se' }).play();
  }

  playVoice(src: string): void {
    const h = this.#get(src, { channel: 'voice' });
    h.play();
    this.#voice = h;
  }

  /** 语音是否播放中（Howl.playing() 查全局实例；结束/停止后自动为 false） */
  isVoicePlaying(): boolean {
    return this.#voice !== null && this.#voice.playing();
  }

  /** 停止全部音频（BGM/SE/语音）并重置 BGM 记录 */
  stopAll(): void {
    Howler.stop(); // howler 全局：停止所有 Howl 的全部播放实例
    this.#bgm = null;
    this.#bgmKey = null;
    this.#voice = null;
  }

  setMasterVolume(v: number): void {
    Howler.volume(AudioManager.#clamp01(v));
  }

  getMasterVolume(): number {
    return Howler.volume();
  }

  setBgmVolume(v: number): void {
    this.#bgmVolume = AudioManager.#clamp01(v);
    if (this.#bgm) this.#bgm.volume(this.#bgmVolume);
  }

  getBgmVolume(): number {
    return this.#bgmVolume;
  }

  setSeVolume(v: number): void {
    this.#seVolume = AudioManager.#clamp01(v);
  }

  getSeVolume(): number {
    return this.#seVolume;
  }

  setVoiceVolume(v: number): void {
    this.#voiceVolume = AudioManager.#clamp01(v);
  }

  getVoiceVolume(): number {
    return this.#voiceVolume;
  }

  static #clamp01(v: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
  }

  #get(src: string, opts: { loop?: boolean; channel: 'bgm' | 'se' | 'voice' }): Howl {
    const volume = opts.channel === 'bgm' ? this.#bgmVolume
      : opts.channel === 'se' ? this.#seVolume
        : this.#voiceVolume;
    let h = this.#cache.get(src);
    if (!h) {
      h = new Howl({
        src: [src],
        loop: opts.loop ?? false,
        volume,
        onloaderror: () => {
          // 音频缺失：占位素材阶段静默
        },
      });
      this.#cache.set(src, h);
    } else {
      // 复用缓存时刷新播放配置：同一 src 可能先以 SE 播放、后被 BGM 引用（或反之），
      // 首次创建时固定的 loop/volume 不再适用，必须按本次用途更新。
      h.loop(opts.loop ?? false);
      h.volume(volume);
    }
    return h;
  }
}
