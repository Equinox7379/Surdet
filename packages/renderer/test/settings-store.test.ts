import { describe, expect, it } from 'vitest';
import { Typewriter } from '../src/text-buffer.js';
import type { AudioHandle } from '../src/types.js';
import { SettingsStore, MemorySettingsStorage, DEFAULT_SETTINGS } from '../src/settings-store.js';
import type { SettingsStorage, GameSettings } from '../src/settings-store.js';

/** 记录调用的 fake 音频 */
class RecAudio implements AudioHandle {
  master: number[] = [];
  bgm: number[] = [];
  se: number[] = [];
  voice: number[] = [];
  playBgm(): void {}
  playSe(): void {}
  playVoice(): void {}
  stopAll(): void {}
  setMasterVolume(v: number): void { this.master.push(v); }
  getMasterVolume(): number { return this.master.at(-1) ?? 1; }
  setBgmVolume(v: number): void { this.bgm.push(v); }
  getBgmVolume(): number { return this.bgm.at(-1) ?? 1; }
  setSeVolume(v: number): void { this.se.push(v); }
  getSeVolume(): number { return this.se.at(-1) ?? 1; }
  setVoiceVolume(v: number): void { this.voice.push(v); }
  getVoiceVolume(): number { return this.voice.at(-1) ?? 1; }
  isVoicePlaying(): boolean { return false; }
}

describe('SettingsStore', () => {
  it('缺省为默认设置；update 合并并持久化', async () => {
    const storage = new MemorySettingsStorage();
    const store = new SettingsStore(storage);
    expect(store.settings).toEqual(DEFAULT_SETTINGS);

    await store.update({ textSpeedCps: 60, bgmVolume: 0.3 });
    expect(store.settings.textSpeedCps).toBe(60);
    expect(store.settings.bgmVolume).toBeCloseTo(0.3);
    expect(store.settings.seVolume).toBe(DEFAULT_SETTINGS.seVolume); // 未改动项保持

    // 新实例从同一存储加载 → 恢复持久化值
    const store2 = new SettingsStore(storage);
    await store2.load();
    expect(store2.settings.textSpeedCps).toBe(60);
    expect(store2.settings.bgmVolume).toBeCloseTo(0.3);
  });

  it('load 对损坏/越界数据做 clamp（不破坏运行时）', async () => {
    const storage: SettingsStorage = {
      load: () => ({ masterVolume: 5, textSpeedCps: -10, bgmVolume: Number.NaN }) as Partial<GameSettings>,
      save: () => {},
    };
    const store = new SettingsStore(storage);
    const s = await store.load();
    expect(s.masterVolume).toBe(1);   // 越界 → clamp 到上限
    expect(s.textSpeedCps).toBe(1);   // 越界 → clamp 到下限
    expect(s.bgmVolume).toBe(DEFAULT_SETTINGS.bgmVolume); // NaN（非数值）→ 默认
  });

  it('load 空存储保持默认', async () => {
    const storage: SettingsStorage = { load: () => null, save: () => {} };
    const store = new SettingsStore(storage);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it('apply 把设置投影到打字机与音频', async () => {
    const store = new SettingsStore(new MemorySettingsStorage());
    await store.update({ textSpeedCps: 48, masterVolume: 0.8, bgmVolume: 0.2, seVolume: 0.4, voiceVolume: 0.6 });
    const tw = new Typewriter();
    const audio = new RecAudio();
    store.apply(tw, audio);
    expect(tw.speed).toBe(48);
    expect(audio.master).toEqual([0.8]);
    expect(audio.bgm).toEqual([0.2]);
    expect(audio.se).toEqual([0.4]);
    expect(audio.voice).toEqual([0.6]);
  });
});
