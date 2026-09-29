import { Howl, Howler } from 'howler';
import type {
  AudioBgmDiagnosticError,
  AudioBgmDiagnosticSnapshot,
  AudioHandle,
  BgmPlaybackOptions,
  VoicePlaybackOptions,
} from './types.js';
import type { AudioPlaybackSnapshot } from './rollback-buffer.js';
import { RendererError } from './api/renderer-errors.js';

/** BGM 切换交叉淡入淡出时长（毫秒） */
const BGM_FADE_MS = 350;

type AudioChannel = 'bgm' | 'ambience' | 'se' | 'voice';

interface AudioCacheEntry {
  key: string;
  src: string;
  channel: AudioChannel;
  howl: Howl;
  lastUsed: number;
  session: number;
}

const CACHE_LIMITS: Record<AudioChannel, number> = { bgm: 8, ambience: 8, se: 32, voice: 8 };

/**
 * 音频管理器（howler）。
 *  - BGM 循环播放、同 key 不重复启动、切换时交叉淡入淡出（旧曲淡出后停止，新曲淡入）
 *  - 主音量（Howler 全局）× 分轨音量（BGM/SE/语音）两级音量，设置界面可直接接入
 *  - 语音播放状态查询（isVoicePlaying），宿主可做"语音播完再推进"等策略
 *  - 活动素材加载或播放失败经公共错误回调报告
 */
export class AudioManager implements AudioHandle {
  #bgm: Howl | null = null;
  #bgmKey: string | null = null;
  #ambience: Howl | null = null;
  #ambienceKey: string | null = null;
  /** 切歌代际计数：延时停止旧曲的定时器仅在代际未再变化时执行，
   *  防止 A→B→A 快速切换时旧定时器误停重新启播的同名 BGM（导致永久静音）。 */
  #bgmEpoch = 0;
  #ambienceEpoch = 0;
  #voice: Howl | null = null;
  #voiceId: number | undefined;
  #voicePending = false;
  #voicePaused = false;
  #voiceReplay = false;
  #cache = new Map<string, AudioCacheEntry>();
  #clock = 0;
  #bgmVolume = 0.55;
  #ambienceVolume = 0.7;
  #seVolume = 0.9;
  #voiceVolume = 1;
  /** 无扩展名的 Blob URL 不能让 Howler 自动选择 codec，宿主需在播放前注册格式。 */
  #sourceFormats = new Map<string, string>();
  #sourcePaths = new Map<string, string>();
  #errorListeners = new Set<(error: RendererError) => void>();
  #session = 0;
  #bgmErrors: AudioBgmDiagnosticError[] = [];
  #bgmPlayCount = 0;

  /**
   * 为音频源登记格式。打包/编辑器预览使用 Blob URL 时必须调用，
   * 否则 Howler 会因 URL 没有扩展名而把资源判定为无 codec 支持。
   * 允许传 MIME（audio/wav）或扩展名（wav）。
   */
  setSourceFormat(src: string, format: string, sourcePath?: string): void {
    const normalized = format.trim().toLowerCase().replace(/^audio\//, '');
    if (normalized) this.#sourceFormats.set(src, normalized === 'mpeg' ? 'mp3' : normalized);
    if (sourcePath) this.#sourcePaths.set(src, sourcePath);
  }

  onError(listener: (error: RendererError) => void): () => void {
    this.#errorListeners.add(listener);
    return () => { this.#errorListeners.delete(listener); };
  }

  playBgm(src: string | null, options?: BgmPlaybackOptions): void {
    const restart = options?.restart === true;
    if (src === this.#bgmKey && !restart) return;
    if (src === this.#bgmKey && restart && this.#bgm) {
      const h = this.#bgm;
      h.stop();
      this.#bgmErrors = [];
      const target = this.#bgmVolume;
      if (typeof (h as { fade?: unknown }).fade === 'function') {
        h.volume(0);
        this.#bgmPlayCount += 1;
        h.play();
        h.fade(0, target, BGM_FADE_MS);
      } else {
        h.volume(target);
        this.#bgmPlayCount += 1;
        h.play();
      }
      return;
    }
    this.#bgmErrors = [];
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
      this.#bgmPlayCount += 1;
      h.play();
      h.fade(0, target, BGM_FADE_MS);
    } else {
      this.#bgmPlayCount += 1;
      h.play();
    }
    this.#evict('bgm');
  }

  playSe(src: string): void {
    const h = this.#get(src, { channel: 'se' });
    h.play();
    this.#evict('se');
  }

  /** 环境音循环播放；切换时只保留一个当前声道，并以代际保护延迟停止旧实例。 */
  playAmbience(src: string | null, fadeMs = BGM_FADE_MS): void {
    if (src === this.#ambienceKey) return;
    const prev = this.#ambience;
    this.#ambience = null;
    this.#ambienceKey = src;
    if (prev) {
      const epoch = ++this.#ambienceEpoch;
      const duration = Math.max(0, Number.isFinite(fadeMs) ? fadeMs : BGM_FADE_MS);
      if (typeof (prev as { fade?: unknown }).fade === 'function' && duration > 0) {
        prev.fade(prev.volume(), 0, duration);
        setTimeout(() => {
          if (epoch === this.#ambienceEpoch) prev.stop();
        }, duration);
      } else {
        prev.stop();
      }
    }
    if (src === null) return;
    const h = this.#get(src, { loop: true, channel: 'ambience' });
    this.#ambience = h;
    h.stop();
    const target = this.#ambienceVolume;
    const duration = Math.max(0, Number.isFinite(fadeMs) ? fadeMs : BGM_FADE_MS);
    if (typeof (h as { fade?: unknown }).fade === 'function' && duration > 0) {
      h.volume(0);
      h.play();
      h.fade(0, target, duration);
    } else {
      h.volume(target);
      h.play();
    }
    this.#evict('ambience');
  }

  playVoice(src: string, options?: VoicePlaybackOptions): void {
    this.stopVoice();
    const h = this.#get(src, { channel: 'voice' });
    this.#voice = h;
    this.#voicePending = true;
    this.#voiceReplay = options?.replay === true;
    if (!this.#voicePaused || this.#voiceReplay) this.#voiceId = h.play();
    this.#evict('voice');
  }

  stopVoice(): void {
    const previous = this.#voice, id = this.#voiceId;
    this.#voice = null; this.#voiceId = undefined; this.#voicePending = false; this.#voiceReplay = false;
    previous?.stop(id);
  }

  setVoicePaused(paused: boolean): void {
    if (paused === this.#voicePaused) return;
    this.#voicePaused = paused;
    if (!this.#voice) return;
    // A history replay is intentionally audible over a paused story; leaving it
    // stops that replay rather than restoring a second, hidden voice instance.
    if (this.#voiceReplay) { if (!paused) this.stopVoice(); return; }
    if (paused) { if (this.#voiceId !== undefined) this.#voice.pause(this.#voiceId); }
    else { this.#voicePending = true; this.#voiceId = this.#voice.play(this.#voiceId); }
  }

  /** 加载或播放中的当前语音；自动阅读不能越过尚未起播的录音。 */
  isVoicePlaying(): boolean {
    return this.#voice !== null && (this.#voicePending || this.#voice.playing(this.#voiceId));
  }

  /** BGM 的真实 Howler 播放状态；不以逻辑 key 快照冒充已发声。 */
  isBgmPlaying(): boolean {
    return this.#bgm !== null && this.#bgm.playing();
  }

  /** 只读 BGM 诊断：实际传给 Howler 的 source、播放状态与原始错误摘要。 */
  snapshotBgmDiagnostics(): AudioBgmDiagnosticSnapshot {
    return {
      source: this.#bgmKey,
      playing: this.isBgmPlaying(),
      playCount: this.#bgmPlayCount,
      errors: this.#bgmErrors.map((error) => ({ ...error })),
    };
  }

  /** 停止全部音频（BGM/环境音/SE/语音）并重置活动声道记录 */
  stopAll(): void {
    this.#session++;
    Howler.stop(); // howler 全局：停止所有 Howl 的全部播放实例
    // 推进代际：使尚在等待的旧 BGM 淡出延时停止定时器全部作废。
    // 否则 stopAll 后立即 playBgm，淡出窗口（350ms）内的旧定时器会误停新启播的 BGM → 静音。
    this.#bgmEpoch++;
    this.#ambienceEpoch++;
    this.#bgm = null;
    this.#bgmKey = null;
    this.#bgmErrors = [];
    this.#ambienceKey = null;
    this.#ambience = null;
    this.#voice = null; this.#voiceId = undefined; this.#voicePending = false; this.#voicePaused = false; this.#voiceReplay = false;
  }

  snapshotPlayback(): AudioPlaybackSnapshot {
    return { bgm: this.#bgmKey, ambience: this.#ambienceKey };
  }

  restorePlayback(snapshot: AudioPlaybackSnapshot): void {
    this.playBgm(snapshot.bgm);
    this.playAmbience(snapshot.ambience, 0);
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
    this.#sourcePaths.clear();
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

  setAmbienceVolume(v: number): void {
    this.#ambienceVolume = AudioManager.#clamp01(v);
    this.#applyChannelVolume('ambience');
  }

  getAmbienceVolume(): number {
    return this.#ambienceVolume;
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
    const v = channel === 'se' ? this.#seVolume : channel === 'voice' ? this.#voiceVolume : this.#ambienceVolume;
    const volume = channel === 'bgm' ? this.#bgmVolume : v;
    for (const entry of this.#cache.values()) {
      if (entry.channel === channel) entry.howl.volume(volume);
    }
  }

  static #clamp01(v: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
  }

  #get(src: string, opts: { loop?: boolean; channel: AudioChannel }): Howl {
    const volume = opts.channel === 'bgm' ? this.#bgmVolume
      : opts.channel === 'ambience' ? this.#ambienceVolume
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
        onloaderror: (_id, error) => {
          this.#reportError(entry, 'loaderror', error);
        },
        onplayerror: (id, error) => {
          this.#reportError(entry, 'playerror', error, id);
        },
      });
      entry = { key, src, channel: opts.channel, howl: h, lastUsed: ++this.#clock, session: this.#session };
      this.#cache.set(key, entry);
      const onLifecycle = (): void => this.#evict(opts.channel);
      h.on('end', onLifecycle);
      h.on('stop', onLifecycle);
      if (opts.channel === 'voice') {
        h.on('play', id => { if (this.#voice === h && this.#voiceId === id) this.#voicePending = false; });
        h.on('end', id => { if (this.#voice === h && this.#voiceId === id) { this.#voice = null; this.#voiceId = undefined; this.#voicePending = false; } });
      }
    } else {
      // 复用缓存时刷新播放配置：同一 src 可能先以 SE 播放、后被 BGM 引用（或反之），
      // 首次创建时固定的 loop/volume 不再适用，必须按本次用途更新。
      entry.howl.loop(opts.loop ?? false);
      entry.howl.volume(volume);
      entry.lastUsed = ++this.#clock;
      entry.session = this.#session;
    }
    return entry.howl;
  }

  #reportError(entry: AudioCacheEntry | undefined, type: AudioBgmDiagnosticError['type'], reason: unknown, soundId?: number): void {
    if (!entry || this.#cache.get(entry.key) !== entry || entry.session !== this.#session) return;
    if ((entry.channel === 'bgm' && entry.src !== this.#bgmKey) || (entry.channel === 'ambience' && entry.src !== this.#ambienceKey)) return;
    if (entry.channel === 'voice') {
      if (entry.howl !== this.#voice) return;
      if (soundId !== undefined && soundId !== this.#voiceId) return;
      this.stopVoice();
    }
    const message = String(reason);
    if (entry.channel === 'bgm') {
      this.#bgmErrors.push({ type, message });
      if (this.#bgmErrors.length > 8) this.#bgmErrors.shift();
    }
    const sourcePath = this.#sourcePaths.get(entry.src) ?? entry.src;
    const error = new RendererError(`音频 ${sourcePath}（${entry.channel}）${type === 'loaderror' ? '加载' : '播放'}失败：${message}`,
      { code: 'MEDIA_PLAYBACK_FAILED', domain: 'audio', command: type,
        cause: { channel: entry.channel, type, source: entry.src, sourcePath, reason } });
    if (this.#errorListeners.size === 0) console.error(error);
    else for (const listener of this.#errorListeners) listener(error);
  }

  #evict(channel?: AudioChannel): void {
    const channels: AudioChannel[] = channel ? [channel] : ['bgm', 'ambience', 'se', 'voice'];
    for (const current of channels) {
      const entries = [...this.#cache.values()].filter((entry) => entry.channel === current);
      const limit = CACHE_LIMITS[current];
      if (entries.length <= limit) continue;
      const candidates = entries
        .filter((entry) => entry.howl !== this.#bgm && entry.howl !== this.#ambience && entry.howl !== this.#voice && !entry.howl.playing())
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
