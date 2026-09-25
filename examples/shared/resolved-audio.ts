import type {
  AudioBgmDiagnosticSnapshot,
  AudioHandle,
  AudioPlaybackSnapshot,
  BgmPlaybackOptions,
} from '@surdet/renderer';
import { AudioManager } from '@surdet/renderer';

export class ResolvedAudio implements AudioHandle {
  #inner: AudioManager;
  #urls: Map<string, string>;

  constructor(inner: AudioManager, urls: Map<string, string>) {
    this.#inner = inner;
    this.#urls = urls;
  }

  #r(channel: 'bgm' | 'ambience' | 'se' | 'voice', src: string): string { return this.#urls.get(`${channel}:${src}`) ?? src; }
  onError(listener: Parameters<AudioManager['onError']>[0]): () => void { return this.#inner.onError(listener); }
  playBgm(src: string | null, options?: BgmPlaybackOptions): void {
    this.#inner.playBgm(src === null ? null : this.#r('bgm', src), options);
  }
  playSe(src: string): void { this.#inner.playSe(this.#r('se', src)); }
  playVoice(src: string): void { this.#inner.playVoice(this.#r('voice', src)); }
  playAmbience(src: string | null, fadeMs?: number): void { this.#inner.playAmbience?.(src === null ? null : this.#r('ambience', src), fadeMs); }
  stopAll(): void { this.#inner.stopAll(); }
  setMasterVolume(v: number): void { this.#inner.setMasterVolume(v); }
  getMasterVolume(): number { return this.#inner.getMasterVolume(); }
  setBgmVolume(v: number): void { this.#inner.setBgmVolume(v); }
  getBgmVolume(): number { return this.#inner.getBgmVolume(); }
  setAmbienceVolume(v: number): void { this.#inner.setAmbienceVolume?.(v); }
  getAmbienceVolume(): number { return this.#inner.getAmbienceVolume?.() ?? 0.7; }
  setSeVolume(v: number): void { this.#inner.setSeVolume(v); }
  getSeVolume(): number { return this.#inner.getSeVolume(); }
  setVoiceVolume(v: number): void { this.#inner.setVoiceVolume(v); }
  getVoiceVolume(): number { return this.#inner.getVoiceVolume(); }
  isVoicePlaying(): boolean { return this.#inner.isVoicePlaying(); }

  isBgmPlaying(): boolean { return this.#inner.isBgmPlaying(); }

  snapshotBgmDiagnostics(): AudioBgmDiagnosticSnapshot {
    return this.#inner.snapshotBgmDiagnostics();
  }

  snapshotPlayback(): AudioPlaybackSnapshot {
    const snapshot = this.#inner.snapshotPlayback?.() ?? { bgm: null, ambience: null };
    const logical = (channel: 'bgm' | 'ambience', src: string | null): string | null => {
      if (src === null) return null;
      return [...this.#urls.entries()].find(([key, url]) => key.startsWith(`${channel}:`) && url === src)?.[0].slice(channel.length + 1) ?? src;
    };
    return { bgm: logical('bgm', snapshot.bgm), ambience: logical('ambience', snapshot.ambience) };
  }

  restorePlayback(snapshot: AudioPlaybackSnapshot): void {
    this.#inner.restorePlayback?.({
      bgm: snapshot.bgm === null ? null : this.#r('bgm', snapshot.bgm),
      ambience: snapshot.ambience === null ? null : this.#r('ambience', snapshot.ambience),
    });
  }
}
