import { describe, expect, it } from 'vitest';
import { Localizer } from '../src/localization.js';

describe('Localizer', () => {
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
