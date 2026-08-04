import type { Typewriter } from './text-buffer.js';
import type { AudioHandle } from './types.js';

/**
 * 游戏设置：文本速度/自动播放节奏/分轨音量。
 * SettingsStore 负责合并默认值与持久化（宿主注入存储后端：localStorage/文件 IPC）；
 * applySettings 把设置投影到 Typewriter/AudioHandle（宿主接线一行调用）。
 */
/** 快进策略（skipStrategy 数值枚举）：0 = 仅跳已读（默认，遇未读即停）；1 = 全部跳过（一路到底） */
export const SKIP_STRATEGY_READ = 0;
export const SKIP_STRATEGY_ALL = 1;

export interface GameSettings {
  /** 打字速度（每秒字符数） */
  textSpeedCps: number;
  /** 自动播放：文本显示完成后的基础停留（毫秒） */
  autoBaseDelayMs: number;
  /** 自动播放：按文本长度追加的停留（毫秒/字符） */
  autoPerCharMs: number;
  /** 主音量 0..1 */
  masterVolume: number;
  /** BGM 分轨音量 0..1 */
  bgmVolume: number;
  /** SE 分轨音量 0..1 */
  seVolume: number;
  /** 语音分轨音量 0..1 */
  voiceVolume: number;
  /** 快进策略：0=仅跳已读 1=全部跳过（决定宿主快进键的默认行为；持久化） */
  skipStrategy: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  textSpeedCps: 24,
  autoBaseDelayMs: 600,
  autoPerCharMs: 40,
  masterVolume: 1,
  bgmVolume: 0.55,
  seVolume: 0.9,
  voiceVolume: 1,
  skipStrategy: SKIP_STRATEGY_READ,
};

/** 设置持久化后端（宿主注入；可同步或异步） */
export interface SettingsStorage {
  load(): Partial<GameSettings> | null | Promise<Partial<GameSettings> | null>;
  save(s: GameSettings): void | Promise<void>;
}

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

const clampNum = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** 设置面板的一行（PixiStage.showSettings 的输入；宿主按 settings 生成） */
export interface SettingsRowView {
  id: string;
  label: string;
  /** 当前值的格式化展示 */
  display: string;
}

/** 设置面板步进定义：各设置项的标签/步长/范围/格式化（◀ ▶ 步进用） */
export const SETTING_STEPS: {
  key: keyof GameSettings;
  label: string;
  step: number;
  min: number;
  max: number;
  format: (v: number) => string;
}[] = [
  { key: 'textSpeedCps', label: '文本速度', step: 6, min: 1, max: 199, format: (v) => String(Math.round(v)) },
  { key: 'autoBaseDelayMs', label: '自动停留', step: 200, min: 0, max: 6000, format: (v) => `${(v / 1000).toFixed(1)} 秒` },
  { key: 'masterVolume', label: '主音量', step: 0.1, min: 0, max: 1, format: pct },
  { key: 'bgmVolume', label: 'BGM 音量', step: 0.1, min: 0, max: 1, format: pct },
  { key: 'seVolume', label: '音效音量', step: 0.1, min: 0, max: 1, format: pct },
  { key: 'voiceVolume', label: '语音音量', step: 0.1, min: 0, max: 1, format: pct },
  {
    key: 'skipStrategy',
    label: '快进策略',
    step: 1,
    min: SKIP_STRATEGY_READ,
    max: SKIP_STRATEGY_ALL,
    format: (v) => (v >= SKIP_STRATEGY_ALL ? '全部跳过' : '仅跳已读'),
  },
];

/** 设置面板步进：按步进定义把某项 +1/-1 步（范围内 clamp，返回新设置对象，不改原对象） */
export function stepSetting(current: GameSettings, key: keyof GameSettings, dir: -1 | 1): GameSettings {
  const def = SETTING_STEPS.find((d) => d.key === key);
  if (!def) return { ...current };
  const raw = current[key] + dir * def.step;
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

  constructor(storage: SettingsStorage = new MemorySettingsStorage()) {
    this.#storage = storage;
  }

  get settings(): GameSettings {
    return { ...this.#settings };
  }

  /** 从存储加载（与默认值合并 + clamp）；无存档/损坏时保持默认 */
  async load(): Promise<GameSettings> {
    const raw = (await this.#storage.load()) ?? {};
    const d = DEFAULT_SETTINGS;
    this.#settings = {
      textSpeedCps: clampNum(raw.textSpeedCps, d.textSpeedCps, 1, 200),
      autoBaseDelayMs: clampNum(raw.autoBaseDelayMs, d.autoBaseDelayMs, 0, 60_000),
      autoPerCharMs: clampNum(raw.autoPerCharMs, d.autoPerCharMs, 0, 2_000),
      masterVolume: clampNum(raw.masterVolume, d.masterVolume, 0, 1),
      bgmVolume: clampNum(raw.bgmVolume, d.bgmVolume, 0, 1),
      seVolume: clampNum(raw.seVolume, d.seVolume, 0, 1),
      voiceVolume: clampNum(raw.voiceVolume, d.voiceVolume, 0, 1),
      // 快进策略枚举 clamp 到 0/1（非法值回退默认"仅跳已读"）
      skipStrategy: Math.round(clampNum(raw.skipStrategy, d.skipStrategy, SKIP_STRATEGY_READ, SKIP_STRATEGY_ALL)),
    };
    return this.settings;
  }

  /** 更新部分设置并持久化 */
  async update(patch: Partial<GameSettings>): Promise<GameSettings> {
    this.#settings = { ...this.#settings, ...patch };
    await this.persist();
    return this.settings;
  }

  /** 仅持久化当前设置 */
  async persist(): Promise<void> {
    await this.#storage.save({ ...this.#settings });
  }

  /** 把当前设置投影到打字机与音频（宿主在 load/设置变更后调用） */
  apply(tw: Typewriter, audio: AudioHandle): void {
    tw.setSpeed(this.#settings.textSpeedCps);
    audio.setMasterVolume(this.#settings.masterVolume);
    audio.setBgmVolume(this.#settings.bgmVolume);
    audio.setSeVolume(this.#settings.seVolume);
    audio.setVoiceVolume(this.#settings.voiceVolume);
  }
}
