import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SETTINGS, GAME_SETTING_DEFINITIONS, normalizeGameSettings } from '@surdet/core';
import { SettingsStore, MemorySettingsStorage, createSettingsRows, stepSetting } from '../src/settings-store.js';

describe('device reading preferences', () => {
  it('defaults preserve the work appearance; stored false overrides the system default', async () => {
    expect(DEFAULT_GAME_SETTINGS).toMatchObject({ textScale: 1, dialogueOpacity: null, reducedMotion: false, readAloud: false });
    const storage = new MemorySettingsStorage(), first = new SettingsStore(storage, { reducedMotion: true });
    expect((await first.load()).reducedMotion).toBe(true);
    await first.update({ reducedMotion: false, textScale: 1.4, dialogueOpacity: 0, readAloud: true });
    const next = new SettingsStore(storage, { reducedMotion: true });
    expect(await next.load()).toEqual(first.settings);
    expect(next.settings.dialogueOpacity).toBe(0);
    await next.update({ dialogueOpacity: null }); expect(next.settings.dialogueOpacity).toBeNull();
  });
  it('normalizes settings once for both load and update, retaining failed-write ownership', async () => {
    const store = new SettingsStore({ load: () => null, save: () => { throw new Error('disk'); } });
    await expect(store.update({ textScale: 3 })).rejects.toThrow('disk'); expect(store.settings.textScale).toBe(1);
    expect(normalizeGameSettings({ textScale: 3, dialogueOpacity: -1, readAloud: 'yes', reducedMotion: true })).toMatchObject({ textScale: 1.4, dialogueOpacity: 0, readAloud: false, reducedMotion: true });
    expect(normalizeGameSettings({ textScale: NaN, dialogueOpacity: Infinity })).toMatchObject({ textScale: 1, dialogueOpacity: null });
  });
  it('steps from the actual work opacity and publishes rows from the shared definitions', () => {
    const current = { ...DEFAULT_GAME_SETTINGS };
    expect(stepSetting(current, 'dialogueOpacity', -1, .6).dialogueOpacity).toBe(.5);
    expect(stepSetting({ ...current, textScale: 1.4 }, 'textScale', 1).textScale).toBe(1.4);
    const rows = createSettingsRows(current);
    for (const key of ['textScale', 'dialogueOpacity', 'reducedMotion', 'readAloud'] as const) expect(rows.find(row => row.id === key)?.label).toBe(GAME_SETTING_DEFINITIONS[key].label);
  });
});
