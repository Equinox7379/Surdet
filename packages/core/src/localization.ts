/**
 * 引擎系统文案的轻量本地化接口。
 * 剧本内容仍由游戏自己提供；这里负责系统菜单、错误和编辑器/宿主公共文案。
 */
export type Locale = string;
export type MessageCatalog = Readonly<Record<string, string>>;

function localeChain(locale: Locale, fallback: Locale): string[] {
  const normalized = locale.trim().replace(/_/g, '-');
  const base = normalized.split('-')[0] ?? normalized;
  return [...new Set([normalized, base, fallback])].filter((item) => item.length > 0);
}

function interpolate(value: string, params: Readonly<Record<string, string | number>>): string {
  return value.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, key: string) => {
    const result = Object.hasOwn(params, key) ? params[key] : undefined;
    return result === undefined ? match : String(result);
  });
}

export class Localizer {
  #locale: Locale;
  #fallback: Locale;
  #catalogs = new Map<Locale, MessageCatalog>();

  constructor(locale: Locale, fallback: Locale = 'zh-CN') {
    this.#locale = locale;
    this.#fallback = fallback;
  }

  register(locale: Locale, catalog: MessageCatalog): void {
    this.#catalogs.set(locale, catalog);
  }

  setLocale(locale: Locale): void { this.#locale = locale; }
  get locale(): Locale { return this.#locale; }

  t(key: string, params: Readonly<Record<string, string | number>> = {}): string {
    for (const locale of localeChain(this.#locale, this.#fallback)) {
      const catalog = this.#catalogs.get(locale);
      const value = catalog && Object.hasOwn(catalog, key) ? catalog[key] : undefined;
      if (value !== undefined) return interpolate(value, params);
    }
    return key;
  }
}
