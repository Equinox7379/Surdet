/**
 * Device settings offered by the UI designer, all read from Core's single table, so the
 * lists match what `readProjectUi` accepts and what the Players persist.
 */
import { GAME_SETTING_DEFINITIONS, type GameSettingKey } from '@surdet/core';

const definitions = Object.entries(GAME_SETTING_DEFINITIONS) as [GameSettingKey, typeof GAME_SETTING_DEFINITIONS[GameSettingKey]][];

/** Chinese name of every setting, as Core labels it. */
export const SETTING_LABELS = Object.fromEntries(definitions.map(([key, definition]) => [key, definition.label])) as Record<GameSettingKey, string>;

/** Settings a work's toggle or slider may change: writable ones of the matching type (toggles also take skipStrategy). */
export function bindableSettings(control: 'toggle' | 'slider'): GameSettingKey[] {
  return definitions.filter(([key, definition]) => definition.writable
    && (control === 'slider' ? definition.type === 'number' : definition.type === 'boolean' || key === 'skipStrategy')).map(([key]) => key);
}

/** Settings a "调整阅读设置" button may step or switch: every writable setting, plus the work language. */
export function steppableSettings(): GameSettingKey[] {
  return definitions.filter(([key, definition]) => definition.writable || key === 'locale').map(([key]) => key);
}

/** True for on/off settings, which a step button switches instead of raising or lowering. */
export function isSwitchSetting(name: string): boolean {
  return Object.hasOwn(GAME_SETTING_DEFINITIONS, name) && GAME_SETTING_DEFINITIONS[name as GameSettingKey].type === 'boolean';
}
