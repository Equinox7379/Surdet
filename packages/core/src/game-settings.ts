/** Device preferences. This table is shared by persistence, Player and authoring UI validation. */
export const GAME_SETTING_DEFINITIONS = {
  textSpeedCps: { type: 'number', default: 24, min: 1, max: 200, label: '文本速度', page: '阅读', writable: true, step: 6, controlMax: 199 },
  autoBaseDelayMs: { type: 'number', default: 600, min: 0, max: 60000, label: '自动停留', page: '阅读', writable: true, step: 200, controlMax: 6000 },
  autoPerCharMs: { type: 'number', default: 40, min: 0, max: 2000, label: '每字停留', page: '阅读', writable: false },
  masterVolume: { type: 'number', default: 1, min: 0, max: 1, label: '主音量', page: '声音', writable: true, step: 0.1 },
  bgmVolume: { type: 'number', default: 0.55, min: 0, max: 1, label: '背景音乐音量', page: '声音', writable: true, step: 0.1 },
  ambienceVolume: { type: 'number', default: 0.7, min: 0, max: 1, label: '环境音量', page: '声音', writable: true, step: 0.1 },
  seVolume: { type: 'number', default: 0.9, min: 0, max: 1, label: '音效音量', page: '声音', writable: true, step: 0.1 },
  voiceVolume: { type: 'number', default: 1, min: 0, max: 1, label: '语音音量', page: '声音', writable: true, step: 0.1 },
  skipStrategy: { type: 'number', default: 0, min: 0, max: 1, integer: true, label: '快进策略', page: '阅读', writable: true, step: 1 },
  keyPreset: { type: 'string', default: 'standard', values: ['standard', 'left-handed'], label: '键位方案', page: '显示与输入', writable: false },
  locale: { type: 'string', default: '', label: '作品语言', page: '阅读', writable: false },
  textScale: { type: 'number', default: 1, min: 0.8, max: 1.4, label: '文字大小', page: '阅读', writable: true, step: 0.1 },
  dialogueOpacity: { type: 'number', default: null, min: 0, max: 1, label: '对话框不透明度', page: '阅读', writable: true, step: 0.1 },
  reducedMotion: { type: 'boolean', default: false, label: '减少动态效果', page: '显示与输入', writable: true },
  readAloud: { type: 'boolean', default: false, label: '朗读未配音台词', page: '阅读', writable: true },
} as const;

export type GameSettingKey = keyof typeof GAME_SETTING_DEFINITIONS;
type DefinitionValue<D> = D extends { values: readonly (infer V)[] } ? V : D extends { type: 'boolean' } ? boolean
  : D extends { type: 'string' } ? string : D extends { default: null } ? number | null : number;
export type GameSettings = { -readonly [K in GameSettingKey]: DefinitionValue<typeof GAME_SETTING_DEFINITIONS[K]> };
export const DEFAULT_GAME_SETTINGS = Object.fromEntries(Object.entries(GAME_SETTING_DEFINITIONS).map(([key, definition]) => [key, definition.default])) as GameSettings;

/** Invalid persisted values use device/project defaults; no source project or save state is changed. */
export function normalizeGameSettings(raw: unknown, defaults: GameSettings = DEFAULT_GAME_SETTINGS): GameSettings {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(GAME_SETTING_DEFINITIONS).map(([name, definition]) => {
    let value = source[name], fallback = defaults[name as GameSettingKey];
    if (definition.type === 'number') {
      value = typeof value === 'number' && Number.isFinite(value) ? Math.max(definition.min, Math.min(definition.max, value)) : fallback;
      if ('integer' in definition) value = Math.round(Number(value));
    } else if (definition.type === 'boolean') value = typeof value === 'boolean' ? value : fallback;
    else if ('values' in definition) value = definition.values.includes(value as 'standard' | 'left-handed') ? value : fallback;
    else value = typeof value === 'string' && /^(?:[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)?$/.test(value) ? value : fallback;
    return [name, value];
  })) as GameSettings;
}
