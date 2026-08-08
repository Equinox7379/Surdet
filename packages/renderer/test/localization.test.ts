import { describe, expect, it } from 'vitest';
import { createRendererLocalizer } from '../src/localization.js';

describe('renderer localization', () => {
  it('ships Chinese defaults and English system labels', () => {
    const localizer = createRendererLocalizer('en-US');
    expect(localizer.t('continue')).toBe('Continue');
    localizer.setLocale('zh-CN');
    expect(localizer.t('continue')).toBe('继续');
  });
});
