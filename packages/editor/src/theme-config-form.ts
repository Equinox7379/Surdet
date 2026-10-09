import { DEFAULT_PRESENTATION_THEME } from '@surdet/core';
import { parseThemeEditorDraft } from './authoring-project-storage.js';
import { h } from './state.js';

const GROUPS = [
  ['colors', '界面颜色', { canvas: '画布底色', scrim: '遮罩颜色', panel: '面板底色', surface: '控件底色', surfaceStrong: '强调底色', line: '分隔线', accent: '主题色', accentSoft: '柔和主题色', text: '正文颜色', textMuted: '辅助文字', textDisabled: '禁用文字', textOnAccent: '强调按钮文字', danger: '警告颜色' }],
  ['typography', '字号与字距', { titleSize: '标题字号', headingSize: '小标题字号', bodySize: '正文字号', uiSize: '按钮与菜单字号', captionSize: '说明字号', titleLetterSpacing: '标题字距', uiLetterSpacing: '界面字距' }],
  ['opacity', '不透明度', { scrim: '遮罩不透明度', panel: '面板不透明度', surface: '控件不透明度', line: '分隔线不透明度', disabled: '禁用控件不透明度' }],
  ['spacing', '界面间距', { xs: '极小间距', sm: '小间距', md: '常规间距', lg: '大间距', xl: '极大间距' }],
  ['radius', '圆角', { sm: '小圆角', md: '常规圆角', lg: '大圆角' }],
] as const;

/** A Chinese view over the existing draft. It never owns a second save/undo model. */
export function renderThemeConfigForm(options: {
  read: () => string;
  edit: (text: string) => void;
  onError: (message: string) => void;
}): HTMLElement {
  const root = h('div', 'theme-config-form');
  let initial: Record<string, any>;
  try {
    parseThemeEditorDraft(options.read());
    initial = JSON.parse(options.read());
  } catch {
    root.append(h('p', 'config-section-help', '配置文本尚未填写完整。请展开“高级：原始配置”修正，现有草稿不会丢失。'));
    return root;
  }

  const section = (title: string, open = false): HTMLElement => {
    const details = h('details', 'config-subsection'); details.open = open;
    details.append(h('summary', undefined, title));
    const grid = h('div', 'config-field-grid'); details.append(grid); root.append(details);
    return grid;
  };
  const add = (parent: HTMLElement, label: string, path: string[], kind: 'text' | 'number' | 'color', fallback = '', min = 0, max?: number) => {
    const field = h('label', 'config-field');
    const input = h('input'); input.type = 'text';
    if (kind === 'number') input.inputMode = 'decimal';
    input.setAttribute('aria-label', label);
    const value = path.reduce<any>((value, key) => value?.[key], initial);
    input.value = value == null ? '' : kind === 'color' && typeof value === 'number' ? `#${value.toString(16).padStart(6, '0')}` : String(value);
    input.placeholder = fallback ? `默认：${fallback}` : '留空使用默认';
    const apply = () => {
      if (!root.isConnected || root.closest('[inert]')) return;
      try {
        const text = input.value.trim();
        let next: string | number | null = text || null;
        let problem = '';
        if (text && kind === 'color') {
          if (!/^#[\da-f]{6}$/i.test(text)) problem = `${label}请填写六位色值，例如 #203e88。`;
          else next = parseInt(text.slice(1), 16);
        }
        if (kind === 'number' && text) {
          const number = Number(text);
          if (path.at(-1) === 'dialogHeightRatio' && number === 0) problem = '对话框高度比例须大于 0，且不超过 1。';
          else if (!Number.isFinite(number) || number < min || (max !== undefined && number > max)) problem = `${label}须${max === undefined ? `不小于 ${min}` : `在 ${min} 到 ${max} 之间`}。`;
          else next = number;
        }
        // Read at the moment of editing: another control or raw edit may have changed it.
        parseThemeEditorDraft(options.read());
        const draft = JSON.parse(options.read());
        let target = draft;
        for (const key of path.slice(0, -1)) {
          if (target[key] == null) target[key] = {};
          if (typeof target[key] !== 'object' || Array.isArray(target[key])) throw new Error('这组配置格式有误，请在原始配置中修正；未覆盖现有内容。');
          target = target[key];
        }
        const key = path.at(-1)!;
        if (path[0] === 'theme' && next === null) delete target[key];
        else target[key] = next;
        options.edit(JSON.stringify(draft, null, 2));
        // Unfinished input stays in the shared draft; saving must not silently use an older value.
        options.onError(problem);
      } catch (error) { options.onError(error instanceof Error ? error.message : String(error)); }
    };
    input.oninput = apply;
    let control: HTMLElement = input;
    if (kind === 'color') {
      // The swatch is only another way to type a six-digit value into the same field.
      const swatch = h('input'); swatch.type = 'color'; swatch.className = 'theme-color-swatch';
      swatch.setAttribute('aria-label', `${label}取色`);
      const sync = () => { const text = input.value.trim(); swatch.value = /^#[\da-f]{6}$/i.test(text) ? text.toLowerCase() : fallback; };
      input.oninput = () => { apply(); sync(); };
      swatch.oninput = () => { input.value = swatch.value; apply(); };
      sync();
      control = h('span', 'theme-color-control'); control.append(swatch, input);
    }
    field.append(h('span', undefined, label), control); parent.append(field);
  };

  const images = section('标题与皮肤', true);
  for (const [key, label] of [['titleLogo', '标题字标图片'], ['titleBackground', '标题背景图片']] as const) add(images, label, [key], 'text');
  for (const [key, label] of [['dialogSkin', '对话框皮肤'], ['buttonSkin', '按钮皮肤']] as const) add(images, label, ['theme', key], 'text');
  const fonts = section('字体');
  add(fonts, '通用字体路径', ['font'], 'text');
  for (const [key, label] of [['body', '正文字体路径'], ['title', '标题字体路径'], ['ui', '界面字体路径']] as const) add(fonts, label, ['fonts', key], 'text');
  const layout = section('对话框布局');
  add(layout, '对话框高度比例', ['theme', 'dialogHeightRatio'], 'number', '', 0, 1);
  add(layout, '左右留白', ['theme', 'dialogMarginX'], 'number');
  add(layout, '底部留白', ['theme', 'dialogMarginBottom'], 'number');
  for (const [group, label, fields] of GROUPS) {
    const parent = section(label, group === 'colors');
    const defaults: Readonly<Record<string, number>> = DEFAULT_PRESENTATION_THEME[group];
    for (const [key, title] of Object.entries(fields)) {
      const fallback = group === 'colors' ? `#${defaults[key]!.toString(16).padStart(6, '0')}` : String(defaults[key]);
      add(parent, title, ['theme', group, key], group === 'colors' ? 'color' : 'number', fallback, 0, group === 'opacity' ? 1 : undefined);
    }
  }
  return root;
}
