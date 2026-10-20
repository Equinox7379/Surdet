import type { Typewriter } from './text-buffer.js';
import type { AudioHandle } from './types.js';
import { GAME_SETTING_DEFINITIONS, DEFAULT_GAME_SETTINGS, normalizeGameSettings, type GameSettings } from '@surdet/core';
import { DEFAULT_RENDERER_THEME } from './theme.js';
import type { RendererCommands } from './api/renderer-commands.js';
import type { PresentationController } from './api/renderer-runtime.js';
export type { GameSettings } from '@surdet/core';

/**
 * 游戏设置：文本速度/自动播放节奏/分轨音量。
 * SettingsStore 负责合并默认值与持久化（宿主注入存储后端：localStorage/文件 IPC）；
 * applySettings 把设置投影到 Typewriter/AudioHandle（宿主接线一行调用）。
 */
/** 快进策略（skipStrategy 数值枚举）：0 = 仅跳已读（默认，遇未读即停）；1 = 全部跳过（一路到底） */
export const SKIP_STRATEGY_READ = 0;
export const SKIP_STRATEGY_ALL = 1;

export const DEFAULT_SETTINGS: GameSettings = { ...DEFAULT_GAME_SETTINGS };

/** 设置持久化后端（宿主注入；可同步或异步） */
export interface SettingsStorage {
  load(): Partial<GameSettings> | null | Promise<Partial<GameSettings> | null>;
  save(s: GameSettings): void | Promise<void>;
}

export type SettingsPatch = Partial<GameSettings> | ((confirmed: GameSettings) => Partial<GameSettings>);

/** 内存存储（默认/测试用） */
export class MemorySettingsStorage implements SettingsStorage {
  #data: Partial<GameSettings> | null = null;
  load(): Partial<GameSettings> | null {
    return this.#data ? { ...this.#data } : null;
  }
  save(s: GameSettings): void {
    this.#data = { ...s };
  }
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** 设置面板的一行（PixiStage.showSettings 的输入；宿主按 settings 生成） */
export interface SettingsRowView {
  id: string;
  label: string;
  /** 当前值的格式化展示 */
  display: string;
  /** Set on on/off rows only: the confirmed value, so the panel can draw a switch. */
  checked?: boolean;
}

export function createSettingsRows(settings: GameSettings): SettingsRowView[] {
  return [...SETTING_STEPS.map(definition => ({ id: definition.key, label: definition.label, display: definition.format(settings[definition.key]) })),
    ...Object.entries(GAME_SETTING_DEFINITIONS).flatMap(([key, definition]) => definition.type === 'boolean'
      ? [{ id: key, label: definition.label, display: settings[key as 'reducedMotion' | 'readAloud'] ? '开启' : '关闭', checked: settings[key as 'reducedMotion' | 'readAloud'] }] : [])];
}

/** Both shipped Players use the same device-preference projection; save data is not involved. */
export function applyReadingSettings(settings: GameSettings, commands: RendererCommands, controller: PresentationController, locale = ''): void {
  commands.preferences.setReadingPreferences({ textScale: settings.textScale, dialogueOpacity: settings.dialogueOpacity });
  commands.preferences.setPresentationPreferences({ reducedMotion: settings.reducedMotion });
  controller.setReadAloud(settings.readAloud, locale, settings.masterVolume * settings.voiceVolume);
}

export type NumericSettingKey = { [K in keyof GameSettings]: GameSettings[K] extends number | null ? K : never }[keyof GameSettings];

/** 设置面板的标签/步长/滑条范围/格式化；按钮步进使用设置的合法范围。 */
export const SETTING_STEPS: {
  key: NumericSettingKey;
  label: string;
  step: number;
  min: number;
  max: number;
  format: (v: number | null) => string;
}[] = Object.entries(GAME_SETTING_DEFINITIONS).flatMap(([key, definition]) => {
  if (definition.type !== 'number' || !('step' in definition)) return [];
  return [{ key: key as NumericSettingKey, label: definition.label, step: definition.step, min: definition.min,
    max: 'controlMax' in definition ? definition.controlMax : definition.max,
    format: (value: number | null) => value === null ? '跟随作品' : key === 'textSpeedCps' ? String(Math.round(value))
      : key === 'autoBaseDelayMs' ? `${(value / 1000).toFixed(1)} 秒` : key === 'skipStrategy' ? (value >= 1 ? '全部跳过' : '仅跳已读') : pct(value),
  }];
});

/** 设置面板步进：按步进定义把某项 +1/-1 步（范围内 clamp，返回新设置对象，不改原对象） */
export function stepSetting(current: GameSettings, key: NumericSettingKey, dir: -1 | 1, dialogueDefault = DEFAULT_RENDERER_THEME.opacity.panel): GameSettings {
  const def = GAME_SETTING_DEFINITIONS[key];
  if (!('step' in def)) return { ...current };
  const raw = (current[key] ?? dialogueDefault) + dir * def.step;
  const v = Math.max(def.min, Math.min(def.max, Math.round(raw * 100) / 100));
  return { ...current, [key]: v };
}

/**
 * 设置仓库：load 时与默认值合并并做数值 clamp（损坏/篡改的持久化数据不会破坏运行时），
 * 修改后 persist() 落盘；apply 把当前设置投影到打字机与音频。
 */
export class SettingsStore {
  #settings: GameSettings = { ...DEFAULT_SETTINGS };
  #storage: SettingsStorage;
  #writes: Promise<void> = Promise.resolve();
  #defaults: GameSettings;

  constructor(storage: SettingsStorage = new MemorySettingsStorage(), defaults: Partial<GameSettings> = {}) {
    this.#storage = storage;
    this.#defaults = normalizeGameSettings(defaults);
    this.#settings = { ...this.#defaults };
  }

  get settings(): GameSettings {
    return { ...this.#settings };
  }

  /** 从存储加载（与默认值合并 + clamp）；无存档/损坏时保持默认 */
  async load(): Promise<GameSettings> {
    const raw = (await this.#storage.load()) ?? {};
    this.#settings = normalizeGameSettings(raw, this.#defaults);
    return this.settings;
  }

  /** 串行持久化后才确认内存；步进从前一笔成功值计算，失败不会污染下一笔。 */
  update(patch: SettingsPatch): Promise<GameSettings> {
    const input = typeof patch === 'function' ? patch : { ...patch };
    const write = this.#writes.then(async () => {
      const next = normalizeGameSettings({ ...this.#settings, ...(typeof input === 'function' ? input(this.settings) : input) }, this.#defaults);
      await this.#storage.save({ ...next });
      this.#settings = next;
      return this.settings;
    });
    // Caller receives the original rejection; only the internal tail recovers
    // so one failed save cannot prevent later explicitly requested writes.
    this.#writes = write.then(() => {}, () => {});
    return write;
  }

  /** 仅持久化当前设置 */
  async persist(): Promise<void> {
    await this.update({});
  }

  /** 把当前设置投影到打字机与音频（宿主在 load/设置变更后调用） */
  apply(tw: Typewriter, audio: AudioHandle): void {
    tw.setSpeed(this.#settings.textSpeedCps);
    audio.setMasterVolume(this.#settings.masterVolume);
    audio.setBgmVolume(this.#settings.bgmVolume);
    audio.setAmbienceVolume?.(this.#settings.ambienceVolume);
    audio.setSeVolume(this.#settings.seVolume);
    audio.setVoiceVolume(this.#settings.voiceVolume);
  }
}

/** Shared Player/legacy/Editor callbacks may outlive a request or their renderer. */
export function createSettingsUpdateHandler(store: SettingsStore, options: {
  isActive(): boolean;
  apply(settings: GameSettings): void;
  onError(error: unknown): void;
}): (patch: SettingsPatch) => Promise<void> {
  let sequence = 0;
  return async patch => {
    if (!options.isActive()) return;
    const request = ++sequence;
    let failed = false, failure: unknown;
    try { await store.update(patch); }
    catch (error) { failed = true; failure = error; }
    if (request !== sequence || !options.isActive()) return;
    // Also project the last confirmed value after failure: an earlier queued
    // success may have deliberately skipped its superseded callback.
    options.apply(store.settings);
    if (failed && request === sequence && options.isActive()) options.onError(failure);
  };
}
