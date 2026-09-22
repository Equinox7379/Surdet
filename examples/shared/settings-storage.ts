import type { GameSettings, SettingsStorage } from '@surdet/renderer';

export function createSettingsStorage(label: string, browserPrefix: string): SettingsStorage {
  const desktopSettings = window.surdetSettings;
  return desktopSettings
    ? {
        load: async () => (await desktopSettings.read().catch(() => null)) as Partial<GameSettings> | null,
        save: (settings) => desktopSettings.write(settings).catch((error) => {
          console.error(`[${label}] 设置写入失败：`, error);
        }),
      }
    : {
        load: () => {
          try {
            const raw = localStorage.getItem(`${browserPrefix}settings`);
            return raw ? (JSON.parse(raw) as Partial<GameSettings>) : null;
          } catch {
            return null;
          }
        },
        save: (settings) => {
          try {
            localStorage.setItem(`${browserPrefix}settings`, JSON.stringify(settings));
          } catch (error) {
            console.error(`[${label}] 设置写入失败：`, error);
          }
        },
      };
}
