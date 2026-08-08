import { Localizer, type Locale, type MessageCatalog } from '@surdet/core';

/** 渲染层默认系统文案；游戏可以在宿主启动时继续注册自己的 catalog。 */
export const RENDERER_ZH_CN: MessageCatalog = {
  continue: '继续',
  backlog: '文字记录',
  settings: '设置',
  save: '保存',
  load: '读取',
  skip: '快进',
  auto: '自动',
  hide: '隐藏界面',
  close: '关闭',
};

export const RENDERER_EN: MessageCatalog = {
  continue: 'Continue',
  backlog: 'Backlog',
  settings: 'Settings',
  save: 'Save',
  load: 'Load',
  skip: 'Skip',
  auto: 'Auto',
  hide: 'Hide UI',
  close: 'Close',
};

export function createRendererLocalizer(locale: Locale = 'zh-CN'): Localizer {
  const localizer = new Localizer(locale);
  localizer.register('zh-CN', RENDERER_ZH_CN);
  localizer.register('en', RENDERER_EN);
  return localizer;
}
