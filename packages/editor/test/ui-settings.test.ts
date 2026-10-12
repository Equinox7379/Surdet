import { describe, expect, it } from 'vitest';
import { GAME_SETTING_DEFINITIONS, readProjectUi } from '@surdet/core';
import { SETTING_LABELS, bindableSettings, isSwitchSetting, steppableSettings } from '../src/ui-settings.js';

const frame = { x: 0, y: 0, width: 300, height: 40 };
const accepts = (page: Record<string, unknown>): boolean => {
  try { return readProjectUi({ ui: { version: 1, pages: { settings: page } } }) !== null; } catch { return false; }
};

describe('UI designer setting lists come from Core', () => {
  it('labels every setting with Core’s name', () => {
    for (const [key, definition] of Object.entries(GAME_SETTING_DEFINITIONS)) expect(SETTING_LABELS[key as keyof typeof SETTING_LABELS]).toBe(definition.label);
  });

  it('offers exactly the settings Core accepts on toggles and sliders', () => {
    expect(bindableSettings('toggle')).toEqual(expect.arrayContaining(['reducedMotion', 'readAloud', 'skipStrategy']));
    expect(bindableSettings('slider')).toEqual(expect.arrayContaining(['textScale', 'dialogueOpacity', 'textSpeedCps']));
    for (const type of ['toggle', 'slider'] as const) {
      for (const name of Object.keys(GAME_SETTING_DEFINITIONS)) {
        const offered = bindableSettings(type).includes(name as never);
        expect(accepts({ id: 'control', type, frame, binding: { kind: 'setting', name } }), `${type} ${name}`).toBe(offered);
      }
    }
  });

  it('offers step buttons for every setting Core lets a button change', () => {
    for (const name of Object.keys(GAME_SETTING_DEFINITIONS)) {
      const offered = steppableSettings().includes(name as never);
      const node = { id: 'step', type: 'button', frame, text: { kind: 'literal', value: '调' }, action: { kind: 'setting-step', name, direction: 1 } };
      expect(accepts(node), name).toBe(offered);
    }
    expect(isSwitchSetting('readAloud')).toBe(true);
    expect(isSwitchSetting('textScale')).toBe(false);
    expect(isSwitchSetting('missing')).toBe(false);
  });
});
