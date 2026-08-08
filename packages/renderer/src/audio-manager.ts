import { Howl, Howler } from 'howler';
import type { AudioHandle } from './types.js';

/** BGM 切换交叉淡入淡出时长（毫秒） */
const BGM_FADE_MS = 350;

type AudioChannel = 'bgm' | 'se' | 'voice';

interface AudioCacheEntry {
  key: string;
  src: string;
  channel: AudioChannel;
  howl: Howl;
  lastUsed: number;
}

const CACHE_LIMITS: Record<AudioChannel, number> = { bgm: 8, se: 32, voice: 8 };

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
  #cache = new Map<string, AudioCacheEntry>();
  #clock = 0;
  #bgmVolume = 0.55;
  #seVolume = 0.9;
  #voiceVolume = 1;
  /** 无扩展名的 Blob URL 不能让 Howler 自动选择 codec，宿主需在播放前注册格式。 */
  #sourceFormats = new Map<string, string>();

  /**
   * 为音频源登记格式。打包/编辑器预览使用 Blob URL 时必须调用，
   * 否则 Howler 会因 URL 没有扩展名而把资源判定为无 codec 支持。
   * 允许传 MIME（audio/wav）或扩展名（wav）。
   */
  setSourceFormat(src: string, format: string): void {
    const normalized = format.trim().toLowerCase().replace(/^audio\//, '');
    if (normalized) this.#sourceFormats.set(src, normalized === 'mpeg' ? 'mp3' : normalized);
  }

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
    this.#bgm = h;
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
    this.#evict('bgm');
  }

  playSe(src: string): void {
    const h = this.#get(src, { channel: 'se' });
    h.play();
    this.#evict('se');
  }

  playVoice(src: string): void {
    const h = this.#get(src, { channel: 'voice' });
    this.#voice = h;
    h.play();
    this.#evict('voice');
  }

  /** 语音是否播放中（Howl.playing() 查全局实例；结束/停止后自动为 false） */
  isVoicePlaying(): boolean {
    return this.#voice !== null && this.#voice.playing();
  }

  /** 停止全部音频（BGM/SE/语音）并重置 BGM 记录 */
  stopAll(): void {
    Howler.stop(); // howler 全局：停止所有 Howl 的全部播放实例
    // 推进代际：使尚在等待的旧 BGM 淡出延时停止定时器全部作废。
    // 否则 stopAll 后立即 playBgm，淡出窗口（350ms）内的旧定时器会误停新启播的 BGM → 静音。
    this.#bgmEpoch++;
    this.#bgm = null;
    this.#bgmKey = null;
    this.#voice = null;
  }

  /**
   * 释放本管理器持有的 Howl/解码音频资源。
   *
   * stopAll 只停止播放，不会清空 Howler 缓存；编辑器预览连续重载时，
   * 每一轮新的 Blob URL 都会产生新的 Howl，因此必须提供显式资源释放点。
   * 释放后实例仍可复用，下一次 play 会按需重新创建 Howl。
   */
  dispose(): void {
    this.stopAll();
    for (const entry of this.#cache.values()) entry.howl.unload();
    this.#cache.clear();
    this.#sourceFormats.clear();
  }

  setMasterVolume(v: number): void {
    Howler.volume(AudioManager.#clamp01(v));
  }

  getMasterVolume(): number {
    return Howler.volume();
  }

  setBgmVolume(v: number): void {
    this.#bgmVolume = AudioManager.#clamp01(v);
    this.#applyChannelVolume('bgm');
  }

  getBgmVolume(): number {
    return this.#bgmVolume;
  }

  setSeVolume(v: number): void {
    this.#seVolume = AudioManager.#clamp01(v);
    this.#applyChannelVolume('se'); // 播放中实例即时生效（审计修复）
  }

  getSeVolume(): number {
    return this.#seVolume;
  }

  setVoiceVolume(v: number): void {
    this.#voiceVolume = AudioManager.#clamp01(v);
    this.#applyChannelVolume('voice'); // 播放中实例即时生效（审计修复）
  }

  getVoiceVolume(): number {
    return this.#voiceVolume;
  }

  /** 把当前声道音量即时施加到该声道所有 Howl 实例（含播放中；审计修复） */
  #applyChannelVolume(channel: AudioChannel): void {
    const v = channel === 'se' ? this.#seVolume : this.#voiceVolume;
    const volume = channel === 'bgm' ? this.#bgmVolume : v;
    for (const entry of this.#cache.values()) {
      if (entry.channel === channel) entry.howl.volume(volume);
    }
  }

  static #clamp01(v: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
  }

  #get(src: string, opts: { loop?: boolean; channel: 'bgm' | 'se' | 'voice' }): Howl {
    const volume = opts.channel === 'bgm' ? this.#bgmVolume
      : opts.channel === 'se' ? this.#seVolume
        : this.#voiceVolume;
    const key = `${opts.channel}\u0000${src}`;
    let entry = this.#cache.get(key);
    if (!entry) {
      const format = this.#sourceFormats.get(src);
      const h = new Howl({
        src: [src],
        loop: opts.loop ?? false,
        volume,
        ...(format ? { format: [format] } : {}),
        onloaderror: () => {
          // 音频缺失：占位素材阶段静默
        },
      });
      entry = { key, src, channel: opts.channel, howl: h, lastUsed: ++this.#clock };
      this.#cache.set(key, entry);
      const onLifecycle = (): void => this.#evict(opts.channel);
      h.on('end', onLifecycle);
      h.on('stop', onLifecycle);
    } else {
      // 复用缓存时刷新播放配置：同一 src 可能先以 SE 播放、后被 BGM 引用（或反之），
      // 首次创建时固定的 loop/volume 不再适用，必须按本次用途更新。
      entry.howl.loop(opts.loop ?? false);
      entry.howl.volume(volume);
      entry.lastUsed = ++this.#clock;
    }
    return entry.howl;
  }

  #evict(channel?: AudioChannel): void {
    const channels: AudioChannel[] = channel ? [channel] : ['bgm', 'se', 'voice'];
    for (const current of channels) {
      const entries = [...this.#cache.values()].filter((entry) => entry.channel === current);
      const limit = CACHE_LIMITS[current];
      if (entries.length <= limit) continue;
      const candidates = entries
        .filter((entry) => entry.howl !== this.#bgm && entry.howl !== this.#voice && !entry.howl.playing())
        .sort((a, b) => a.lastUsed - b.lastUsed);
      let count = entries.length;
      while (count > limit) {
        const candidate = candidates.shift();
        if (!candidate) break;
        if (!this.#cache.delete(candidate.key)) continue;
        candidate.howl.unload();
        count -= 1;
      }
    }
  }
}
