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

  #r(src: string): string { return this.#urls.get(src) ?? src; }
  playBgm(src: string | null, options?: BgmPlaybackOptions): void {
    this.#inner.playBgm(src === null ? null : this.#r(src), options);
  }
  playSe(src: string): void { this.#inner.playSe(this.#r(src)); }
  playVoice(src: string): void { this.#inner.playVoice(this.#r(src)); }
  playAmbience(src: string | null, fadeMs?: number): void { this.#inner.playAmbience?.(src === null ? null : this.#r(src), fadeMs); }
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
    const logical = (src: string | null): string | null => {
      if (src === null) return null;
      return [...this.#urls.entries()].find(([, url]) => url === src)?.[0] ?? src;
    };
    return { bgm: logical(snapshot.bgm), ambience: logical(snapshot.ambience) };
  }

  restorePlayback(snapshot: AudioPlaybackSnapshot): void {
    this.#inner.restorePlayback?.({
      bgm: snapshot.bgm === null ? null : this.#r(snapshot.bgm),
      ambience: snapshot.ambience === null ? null : this.#r(snapshot.ambience),
    });
  }
}
