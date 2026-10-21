import { describe, expect, it } from 'vitest';
import { Localizer } from '../src/localization.js';

describe('Localizer', () => {
  it.each(['constructor', 'toString', '__proto__'])('CH-H01 treats a missing prototype key %s as missing and uses the fallback', key => {
    const localizer = new Localizer('en-US');
    localizer.register('en-US', {});
    expect(localizer.t(key)).toBe(key);
    localizer.register('zh-CN', { [key]: '后备 {name}' });
    expect(localizer.t(key, { name: 'Surdet' })).toBe('后备 Surdet');
    localizer.register('en-US', { [key]: 'Own {name}' });
    expect(localizer.t(key, { name: 'Surdet' })).toBe('Own Surdet');
  });

  it('CH-H01 leaves missing prototype interpolation parameters intact and accepts own values', () => {
    const localizer = new Localizer('en');
    localizer.register('en', { message: '{constructor} / {toString} / {__proto__} / {count}' });
    expect(localizer.t('message', { count: 0 })).toBe('{constructor} / {toString} / {__proto__} / 0');
    const params = { ['constructor']: 'ctor', ['toString']: 'text', ['__proto__']: 'proto', count: 2 };
    expect(localizer.t('message', params)).toBe('ctor / text / proto / 2');
  });

  it('normalizes every separator in a locale tag', () => {
    const localizer = new Localizer('zh_Hant_TW');
    localizer.register('zh-Hant-TW', { hello: '繁體' });
    localizer.register('zh-CN', { hello: '简体' });
    expect(localizer.t('hello')).toBe('繁體');
  });
  it('uses locale, language fallback, and default fallback in order', () => {
    const localizer = new Localizer('en-US');
    localizer.register('zh-CN', { hello: '你好 {name}', onlyCn: '中文' });
    localizer.register('en', { hello: 'Hello {name}' });
    expect(localizer.t('hello', { name: 'Surdet' })).toBe('Hello Surdet');
    expect(localizer.t('onlyCn')).toBe('中文');
    expect(localizer.t('missing')).toBe('missing');
  });
});
