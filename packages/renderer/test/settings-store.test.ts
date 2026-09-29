import { describe, expect, it, vi } from 'vitest';
import { Typewriter } from '../src/text-buffer.js';
import type { AudioHandle } from '../src/types.js';
import {
  SettingsStore,
  createSettingsUpdateHandler,
  MemorySettingsStorage,
  DEFAULT_SETTINGS,
  SKIP_STRATEGY_READ,
  SKIP_STRATEGY_ALL,
  SETTING_STEPS,
  stepSetting,
} from '../src/settings-store.js';
import type { SettingsStorage, GameSettings } from '../src/settings-store.js';

it('persists project language in device settings and rejects malformed stored locale values', async () => {
  const storage = new MemorySettingsStorage(), settings = new SettingsStore(storage);
  await settings.update({ locale: 'ja' });
  expect((await new SettingsStore(storage).load()).locale).toBe('ja');
  const malformed = new SettingsStore({ load: () => ({ locale: '../invalid' }), save: () => {} });
  expect((await malformed.load()).locale).toBe('');
});

/** 记录调用的 fake 音频 */
class RecAudio implements AudioHandle {
  master: number[] = [];
  bgm: number[] = [];
  ambience: number[] = [];
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
  setAmbienceVolume(v: number): void { this.ambience.push(v); }
  getAmbienceVolume(): number { return this.ambience.at(-1) ?? 1; }
  setSeVolume(v: number): void { this.se.push(v); }
  getSeVolume(): number { return this.se.at(-1) ?? 1; }
  setVoiceVolume(v: number): void { this.voice.push(v); }
  getVoiceVolume(): number { return this.voice.at(-1) ?? 1; }
  isVoicePlaying(): boolean { return false; }
}

describe('SettingsStore', () => {
  it('serializes writes and computes rapid steps from confirmed values after failure', async () => {
    const pending: { value: GameSettings; resolve(): void; reject(error: Error): void }[] = [];
    let saved: GameSettings | null = null;
    const store = new SettingsStore({ load: () => null, save: value => new Promise<void>((resolve, reject) => {
      pending.push({ value, resolve: () => { saved = value; resolve(); }, reject });
    }) });
    const first = store.update({ locale: 'en' }), failure = expect(first).rejects.toThrow('denied');
    const second = store.update(current => ({ textSpeedCps: current.textSpeedCps + 6 }));
    const third = store.update(current => ({ textSpeedCps: current.textSpeedCps + 6, locale: 'ja' }));
    await Promise.resolve();
    expect(pending).toHaveLength(1); expect(store.settings).toEqual(DEFAULT_SETTINGS);
    pending[0]!.reject(new Error('denied')); await failure;
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.value.locale).toBe(''); pending[1]!.resolve(); await second;
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2]!.value.textSpeedCps).toBe(36); pending[2]!.resolve(); await third;
    expect(store.settings).toEqual(saved); expect(store.settings.locale).toBe('ja');
  });
  it('keeps the last confirmed settings after a rejected write and permits the next success', async () => {
    let fail = true, saved: GameSettings | null = null;
    const store = new SettingsStore({ load: () => null, save: async value => {
      if (fail) throw new Error('quota'); saved = { ...value };
    } });
    await expect(store.update({ locale: 'en', masterVolume: 0.2 })).rejects.toThrow('quota');
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
    fail = false;
    await store.update({ locale: 'ja' });
    expect(store.settings.locale).toBe('ja');
    expect(store.settings.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
    expect(saved).toEqual(store.settings);
  });
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

  it('键位预设只接受标准 ID，非法值回退 standard', async () => {
    const store = new SettingsStore({
      load: () => ({ keyPreset: 'user-defined-keys' } as unknown as Partial<GameSettings>),
      save: () => {},
    });
    expect((await store.load()).keyPreset).toBe('standard');
    const left = new SettingsStore({
      load: () => ({ keyPreset: 'left-handed' } as Partial<GameSettings>),
      save: () => {},
    });
    expect((await left.load()).keyPreset).toBe('left-handed');
  });

  it('快进策略：枚举 clamp 到 0/1，步进在"仅跳已读/全部跳过"间切换', async () => {
    // 默认 = 仅跳已读
    expect(DEFAULT_SETTINGS.skipStrategy).toBe(SKIP_STRATEGY_READ);

    // 越界/非法值 clamp：5 → 上限（全部跳过），-3 → 下限（仅跳已读）
    const storage: SettingsStorage = {
      load: () => ({ skipStrategy: 5 }) as Partial<GameSettings>,
      save: () => {},
    };
    const store = new SettingsStore(storage);
    expect((await store.load()).skipStrategy).toBe(SKIP_STRATEGY_ALL);

    const storage2: SettingsStorage = {
      load: () => ({ skipStrategy: -3 }) as Partial<GameSettings>,
      save: () => {},
    };
    const store2 = new SettingsStore(storage2);
    expect((await store2.load()).skipStrategy).toBe(SKIP_STRATEGY_READ);

    // 步进定义存在且格式化正确（设置面板展示）
    const step = SETTING_STEPS.find((d) => d.key === 'skipStrategy');
    expect(step).toBeTruthy();
    expect(step!.format(0)).toBe('仅跳已读');
    expect(step!.format(1)).toBe('全部跳过');

    // stepSetting 步进往返（范围内 clamp，不越界）
    const s0 = { ...DEFAULT_SETTINGS };
    const s1 = stepSetting(s0, 'skipStrategy', 1);
    expect(s1.skipStrategy).toBe(SKIP_STRATEGY_ALL);
    const s2 = stepSetting(s1, 'skipStrategy', 1);
    expect(s2.skipStrategy).toBe(SKIP_STRATEGY_ALL); // 到顶不再增
    const s3 = stepSetting(s2, 'skipStrategy', -1);
    expect(s3.skipStrategy).toBe(SKIP_STRATEGY_READ);
  });

  it('apply 把设置投影到打字机与音频', async () => {
    const store = new SettingsStore(new MemorySettingsStorage());
    await store.update({ textSpeedCps: 48, masterVolume: 0.8, bgmVolume: 0.2, ambienceVolume: 0.3, seVolume: 0.4, voiceVolume: 0.6 });
    const tw = new Typewriter();
    const audio = new RecAudio();
    store.apply(tw, audio);
    expect(tw.speed).toBe(48);
    expect(audio.master).toEqual([0.8]);
    expect(audio.bgm).toEqual([0.2]);
    expect(audio.ambience).toEqual([0.3]);
    expect(audio.se).toEqual([0.4]);
    expect(audio.voice).toEqual([0.6]);
  });
});

describe('settings completion ownership', () => {
  it.each(['resolve', 'reject'] as const)('does not project or report late %s into a disposed owner or its replacement', async outcome => {
    let finish!: () => void, fail!: (error: Error) => void, active = true;
    const old = new SettingsStore({ load: () => null, save: () => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; }) });
    const apply = vi.fn(), onError = vi.fn();
    const update = createSettingsUpdateHandler(old, { isActive: () => active, apply, onError });
    const task = update({ locale: 'en' }); await Promise.resolve(); active = false;
    const next = new SettingsStore(), nextApply = vi.fn();
    await createSettingsUpdateHandler(next, { isActive: () => true, apply: nextApply, onError: vi.fn() })({ locale: 'ja' });
    if (outcome === 'resolve') finish(); else fail(new Error('late failure'));
    await expect(task).resolves.toBeUndefined();
    expect(apply).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
    expect(next.settings.locale).toBe('ja'); expect(nextApply).toHaveBeenCalledTimes(1);
    await update({ locale: 'fr' }); expect(old.settings.locale).not.toBe('fr');
  });
  it.each(['resolve', 'reject'] as const)('ignores superseded %s callbacks and projects confirmed settings when the last request fails', async outcome => {
    const pending: { resolve(): void; reject(error: Error): void }[] = [];
    const store = new SettingsStore({ load: () => null, save: () => new Promise<void>((resolve, reject) => pending.push({ resolve, reject })) });
    const apply = vi.fn(), onError = vi.fn(), update = createSettingsUpdateHandler(store, { isActive: () => true, apply, onError });
    const first = update({ locale: 'en' }), last = update({ masterVolume: 0.3 });
    await Promise.resolve();
    if (outcome === 'resolve') pending[0]!.resolve(); else pending[0]!.reject(new Error('old failure'));
    await first; expect(apply).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.reject(new Error('latest failure')); await last;
    expect(apply).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, locale: outcome === 'resolve' ? 'en' : '' });
    expect(onError).toHaveBeenCalledTimes(1); expect(onError.mock.calls[0]![0].message).toBe('latest failure');
  });
});
