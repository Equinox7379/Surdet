import { resolveProjectUiStyle, type ProjectUiNode, type ProjectUiShadow, type ProjectUiStyle } from '@surdet/core';

/**
 * U1 style form: only the fields a node type actually draws, grouped as 文字 / 背景 / 框体与皮肤.
 * Every change returns the node's complete next style (`node.update.patch.style` replaces it whole);
 * "恢复继承" deletes the key, and an empty style becomes `null` so the node inherits everything again.
 */
export type UiStyleKey = keyof ProjectUiStyle;
type Effective = ReturnType<typeof resolveProjectUiStyle>;
type Shadow = ProjectUiShadow;

const BOX_KEYS: readonly UiStyleKey[] = ['background', 'backgroundOpacity', 'backgroundGradient', 'backgroundImage', 'border', 'borderRadius', 'padding', 'shadows', 'opacity'];
const TEXT_KEYS: Partial<Record<ProjectUiNode['type'], readonly UiStyleKey[]>> = {
  text: ['fontRole', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'align', 'textShadows'],
  button: ['fontRole', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'align', 'textShadows'],
  // A native text field has no line box or alignment the Player controls.
  input: ['fontRole', 'fontSize', 'fontWeight', 'letterSpacing', 'color', 'textShadows'],
};
// Built-in rows of a public content list inherit these; their colours and weights stay the list's own.
const CONTENT_TEXT_KEYS: readonly UiStyleKey[] = ['fontRole', 'fontSize', 'lineHeight', 'letterSpacing', 'align', 'textShadows'];

/** Fields that change what this node draws. Containers never take text fields (no style inheritance). */
export function uiStyleFields(node: Pick<ProjectUiNode, 'type' | 'children'>): Set<UiStyleKey> {
  const text = node.type === 'content' ? (node.children?.length ? [] : CONTENT_TEXT_KEYS) : TEXT_KEYS[node.type] ?? [];
  return new Set<UiStyleKey>([...text, ...BOX_KEYS]);
}

export function setStyleKey<K extends UiStyleKey>(style: ProjectUiStyle | undefined, key: K, value: ProjectUiStyle[K]): ProjectUiStyle {
  return { ...style, [key]: value };
}

/** Removes one key; null means "no style left", sent as `patch.style:null`. */
export function inheritStyleKey(style: ProjectUiStyle | undefined, key: UiStyleKey): ProjectUiStyle | null {
  const next: ProjectUiStyle = { ...style };
  delete next[key];
  return Object.keys(next).length > 0 ? next : null;
}

/** Explicit clears that the contract distinguishes from inheriting. */
export function isExplicitClear(style: ProjectUiStyle | undefined, key: UiStyleKey): boolean {
  const value = style?.[key];
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (key === 'padding' && value && typeof value === 'object') return Object.values(value).every(side => side === 0);
  return false;
}

export interface UiStyleFormOptions {
  node: ProjectUiNode;
  /** Parsed game.config.json, for the effective (inherited) values. */
  config: Record<string, unknown>;
  assets: readonly string[];
  open: ReadonlySet<string>;
  onToggle(group: string, open: boolean): void;
  /** `control` identifies the edited control so focus can return to it after the redraw. */
  apply(style: ProjectUiStyle | null, control: string): void;
}

const ROLE_NAMES = { body: '正文', title: '标题', ui: '界面' } as const;
const ALIGN_NAMES = { left: '左对齐', center: '居中', right: '右对齐' } as const;
const FIT_NAMES = { stretch: '拉伸填满', contain: '完整显示', cover: '铺满裁切' } as const;
const WEIGHT_NAMES: Record<number, string> = { 100: '极细', 200: '特细', 300: '细', 400: '常规', 500: '中等', 600: '半粗', 700: '粗', 800: '特粗', 900: '极粗' };
const SIDES = [['top', '上'], ['right', '右'], ['bottom', '下'], ['left', '左']] as const;
const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;
const percent = (value: number): string => `${Math.round(value * 100)}%`;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function effectiveUiStyle(node: ProjectUiNode, config: Record<string, unknown>): Effective {
  try { return resolveProjectUiStyle(node, config); } catch { return resolveProjectUiStyle(node, {}); }
}

function describe(key: UiStyleKey, effective: Effective): string {
  const shadows = (list: readonly Shadow[]): string => list.length ? `${list.length} 层` : '无';
  switch (key) {
    case 'fontRole': return ROLE_NAMES[effective.fontRole];
    case 'fontSize': return `${effective.fontSize} 像素`;
    case 'fontWeight': return effective.fontWeight === null ? '控件默认' : `${effective.fontWeight} ${WEIGHT_NAMES[effective.fontWeight] ?? ''}`.trim();
    case 'lineHeight': return effective.lineHeight === null ? '控件默认' : `${effective.lineHeight} 倍`;
    case 'letterSpacing': return `${effective.letterSpacing} 像素`;
    case 'color': return hex(effective.color);
    case 'align': return ALIGN_NAMES[effective.align];
    case 'textShadows': return shadows(effective.textShadows);
    case 'background': return effective.background === null ? '无底色' : hex(effective.background);
    case 'backgroundOpacity': return percent(effective.backgroundOpacity);
    case 'backgroundGradient': return effective.backgroundGradient ? `${hex(effective.backgroundGradient.from)} → ${hex(effective.backgroundGradient.to)}` : '无渐变';
    case 'backgroundImage': return effective.backgroundImage ? `主题按钮皮肤 ${effective.backgroundImage.asset}` : '无图片';
    case 'border': return effective.border ? `${effective.border.width} 像素 ${hex(effective.border.color)}` : '无边框';
    case 'borderRadius': return `${effective.borderRadius} 像素`;
    case 'padding': return effective.padding === null ? '控件默认' : SIDES.map(([side]) => effective.padding![side]).join(' / ');
    case 'shadows': return shadows(effective.shadows);
    case 'opacity': return percent(effective.opacity);
  }
}

export function renderUiStyleForm(options: UiStyleFormOptions): HTMLElement {
  const { node } = options, style = node.style, fields = uiStyleFields(node);
  const effective = effectiveUiStyle(node, options.config);
  const root = make('div', 'ui-style-form');
  root.dataset.uiStyleForm = node.id;
  const commit = (control: string, next: ProjectUiStyle | null): void => options.apply(next, control);
  const set = <K extends UiStyleKey>(key: K, value: ProjectUiStyle[K], control: string = key): void => commit(control, setStyleKey(style, key, value));

  function group(id: string, title: string): HTMLElement {
    const details = make('details', 'ui-style-group');
    details.dataset.uiStyleGroup = id;
    details.open = options.open.has(id);
    details.ontoggle = () => options.onToggle(id, details.open);
    details.appendChild(make('summary', '', title));
    return details;
  }

  /** One field: label, inherited/explicit state, 恢复继承 and the contract's explicit clears. */
  function field(parent: HTMLElement, key: UiStyleKey, label: string, clears: Array<[string, () => ProjectUiStyle[UiStyleKey]]> = []): HTMLElement {
    const wrap = make('div', 'ui-style-field');
    wrap.dataset.uiStyleKey = key;
    const head = make('div', 'ui-style-field-head');
    const inherited = style?.[key] === undefined;
    const state = make('span', 'ui-style-state', inherited ? `继承：${describe(key, effective)}` : isExplicitClear(style, key) ? '已明确清空' : '已设置');
    state.dataset.state = inherited ? 'inherited' : isExplicitClear(style, key) ? 'cleared' : 'set';
    head.append(make('span', 'ui-style-label', label), state);
    const restore = make('button', '', '恢复继承'); restore.type = 'button';
    restore.dataset.uiStyleControl = `${key}:inherit`;
    restore.disabled = inherited;
    restore.setAttribute('aria-label', `${label}恢复继承`);
    restore.onclick = () => commit(`${key}:inherit`, inheritStyleKey(style, key));
    head.appendChild(restore);
    for (const [name, value] of clears) {
      const clear = make('button', '', name); clear.type = 'button';
      clear.dataset.uiStyleControl = `${key}:clear`;
      clear.setAttribute('aria-label', `${label}：${name}`);
      clear.onclick = () => set(key, value(), `${key}:clear`);
      head.appendChild(clear);
    }
    wrap.appendChild(head);
    const controls = make('div', 'ui-style-controls'); wrap.appendChild(controls);
    parent.appendChild(wrap);
    return controls;
  }

  function labelled(parent: HTMLElement, text: string, control: HTMLElement, unit?: string): void {
    const name = unit ? `${text}（${unit}）` : text;
    const label = make('label', 'ui-style-input', name);
    control.setAttribute('aria-label', name);
    label.appendChild(control);
    parent.appendChild(label);
  }

  function number(parent: HTMLElement, control: string, text: string, value: number | undefined, limits: { min: number; max: number; step: number; unit?: string; scale?: number },
    onValue: (value: number | null) => void, placeholder?: number): HTMLInputElement {
    const input = make('input'); input.type = 'number';
    const scale = limits.scale ?? 1;
    input.min = String(limits.min * scale); input.max = String(limits.max * scale); input.step = String(limits.step);
    if (value !== undefined) input.value = String(Math.round(value * scale * 1000) / 1000);
    if (placeholder !== undefined) input.placeholder = String(Math.round(placeholder * scale * 1000) / 1000);
    input.dataset.uiStyleControl = control;
    input.setAttribute('aria-label', text);
    // Out-of-range typing is pulled back to the contract's range instead of surfacing a field path error.
    input.onchange = () => { const raw = input.value.trim(); onValue(raw === '' || !Number.isFinite(Number(raw)) ? null : Math.max(limits.min, Math.min(limits.max, Number(raw) / scale))); };
    labelled(parent, text, input, limits.unit);
    return input;
  }

  function colour(parent: HTMLElement, control: string, text: string, value: number, onValue: (value: number) => void): void {
    const input = make('input'); input.type = 'color'; input.value = hex(value);
    input.dataset.uiStyleControl = control;
    input.setAttribute('aria-label', text);
    input.onchange = () => onValue(parseInt(input.value.slice(1), 16));
    labelled(parent, text, input);
  }

  function choose(parent: HTMLElement, control: string, text: string, entries: Array<[string, string]>, value: string, onValue: (value: string) => void): HTMLSelectElement {
    const select = make('select');
    for (const [key, name] of entries) { const item = make('option', '', name); item.value = key; select.appendChild(item); }
    select.value = value;
    select.dataset.uiStyleControl = control;
    select.setAttribute('aria-label', text);
    select.onchange = () => onValue(select.value);
    labelled(parent, text, select);
    return select;
  }

  function check(parent: HTMLElement, control: string, text: string, value: boolean, onValue: (value: boolean) => void): void {
    const input = make('input'); input.type = 'checkbox'; input.checked = value;
    input.dataset.uiStyleControl = control;
    const label = make('label', 'ui-style-check');
    input.onchange = () => onValue(input.checked);
    label.append(input, document.createTextNode(text));
    parent.appendChild(label);
  }

  /** Number field whose empty value restores inheritance. */
  function scalar(parent: HTMLElement, key: 'fontSize' | 'lineHeight' | 'letterSpacing' | 'borderRadius', label: string,
    limits: { min: number; max: number; step: number; unit: string }, clears: Array<[string, () => number]> = []): void {
    const controls = field(parent, key, label, clears);
    const current = style?.[key], inheritedValue = effective[key];
    number(controls, key, label, current, limits, value => value === null ? commit(key, inheritStyleKey(style, key)) : set(key, value), inheritedValue ?? undefined);
  }

  function shadowList(parent: HTMLElement, key: 'textShadows' | 'shadows', label: string, clearLabel: string, fresh: Shadow): void {
    const controls = field(parent, key, label, [[clearLabel, () => []]]);
    const list = [...(style?.[key] ?? effective[key])];
    const write = (next: Shadow[], control: string): void => set(key, next, control);
    list.forEach((shadow, index) => {
      const row = make('div', 'ui-style-shadow');
      row.dataset.uiStyleShadow = String(index);
      const update = (patch: Partial<Shadow>, control: string): void => write(list.map((item, at) => at === index ? { ...item, ...patch } : item), control);
      const base = `${key}.${index}`;
      for (const [part, name, min, max] of [['x', '横向', -4096, 4096], ['y', '纵向', -4096, 4096], ['blur', '模糊', 0, 256]] as const) {
        number(row, `${base}.${part}`, `${label} ${index + 1} ${name}`, shadow[part], { min, max, step: 1, unit: '像素' }, value => update({ [part]: value ?? 0 }, `${base}.${part}`));
      }
      colour(row, `${base}.color`, `${label} ${index + 1} 颜色`, shadow.color, value => update({ color: value }, `${base}.color`));
      number(row, `${base}.opacity`, `${label} ${index + 1} 不透明度`, shadow.opacity, { min: 0, max: 1, step: 5, unit: '%', scale: 100 }, value => update({ opacity: value ?? 1 }, `${base}.opacity`));
      const remove = make('button', '', '删除'); remove.type = 'button';
      remove.dataset.uiStyleControl = `${base}.remove`;
      remove.setAttribute('aria-label', `删除${label} ${index + 1}`);
      remove.onclick = () => write(list.filter((_, at) => at !== index), `${key}.add`);
      row.appendChild(remove);
      controls.appendChild(row);
    });
    const add = make('button', '', list.length >= 4 ? '最多 4 层' : `添加${label}`); add.type = 'button';
    add.dataset.uiStyleControl = `${key}.add`;
    add.disabled = list.length >= 4;
    add.onclick = () => write([...list, fresh], `${key}.add`);
    controls.appendChild(add);
  }

  // —— 文字 ——
  const textKeys = (['fontRole', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'align', 'textShadows'] as const).filter(key => fields.has(key));
  if (textKeys.length > 0) {
    const text = group('text', '文字');
    if (fields.has('fontRole')) {
      const controls = field(text, 'fontRole', '字体角色');
      choose(controls, 'fontRole', '字体角色', [['', `继承（${ROLE_NAMES[effective.fontRole]}）`], ...Object.entries(ROLE_NAMES)], style?.fontRole ?? '',
        value => value ? set('fontRole', value as 'ui') : commit('fontRole', inheritStyleKey(style, 'fontRole')));
    }
    if (fields.has('fontSize')) scalar(text, 'fontSize', '字号', { min: 1, max: 512, step: 1, unit: '像素' });
    if (fields.has('fontWeight')) {
      const controls = field(text, 'fontWeight', '字重');
      choose(controls, 'fontWeight', '字重', [['', `继承（${describe('fontWeight', effective)}）`], ...Object.entries(WEIGHT_NAMES).map(([weight, name]) => [weight, `${weight} ${name}`] as [string, string])],
        style?.fontWeight === undefined ? '' : String(style.fontWeight), value => value ? set('fontWeight', Number(value)) : commit('fontWeight', inheritStyleKey(style, 'fontWeight')));
    }
    if (fields.has('lineHeight')) scalar(text, 'lineHeight', '行高', { min: 0.5, max: 4, step: 0.05, unit: '倍字号' });
    if (fields.has('letterSpacing')) scalar(text, 'letterSpacing', '字距', { min: -32, max: 128, step: 0.5, unit: '像素' }, [['无附加字距', () => 0]]);
    if (fields.has('color')) {
      const controls = field(text, 'color', '文字颜色');
      colour(controls, 'color', '文字颜色', style?.color ?? effective.color, value => set('color', value));
    }
    if (fields.has('align')) {
      const controls = field(text, 'align', '对齐');
      choose(controls, 'align', '对齐', [['', `继承（${ALIGN_NAMES[effective.align]}）`], ...Object.entries(ALIGN_NAMES)], style?.align ?? '',
        value => value ? set('align', value as 'left') : commit('align', inheritStyleKey(style, 'align')));
    }
    if (fields.has('textShadows')) shadowList(text, 'textShadows', '文字阴影', '无文字阴影', { x: 0, y: 2, blur: 4, color: 0x000000, opacity: 0.5 });
    root.appendChild(text);
  }

  // —— 背景 ——
  const back = group('background', '背景');
  {
    const controls = field(back, 'background', '底色');
    colour(controls, 'background', '底色', style?.background ?? effective.background ?? 0xffffff, value => set('background', value));
    if (effective.background === null && style?.background === undefined) controls.appendChild(make('p', 'ui-style-hint', '当前没有底色；选择颜色后才会绘制。'));
  }
  {
    const controls = field(back, 'backgroundOpacity', '背景不透明度', [['透明背景', () => 0]]);
    number(controls, 'backgroundOpacity', '背景不透明度', style?.backgroundOpacity, { min: 0, max: 1, step: 5, unit: '%', scale: 100 },
      value => value === null ? commit('backgroundOpacity', inheritStyleKey(style, 'backgroundOpacity')) : set('backgroundOpacity', value), effective.backgroundOpacity);
    controls.appendChild(make('p', 'ui-style-hint', '只影响底色、渐变和背景图片；文字和边框保持不变。'));
  }
  {
    const controls = field(back, 'backgroundGradient', '双色渐变', [['无渐变', () => null]]);
    const gradient = style?.backgroundGradient ?? effective.backgroundGradient;
    if (gradient) {
      colour(controls, 'backgroundGradient.from', '起始颜色', gradient.from, value => set('backgroundGradient', { ...gradient, from: value }, 'backgroundGradient.from'));
      colour(controls, 'backgroundGradient.to', '结束颜色', gradient.to, value => set('backgroundGradient', { ...gradient, to: value }, 'backgroundGradient.to'));
      number(controls, 'backgroundGradient.angle', '方向', gradient.angle, { min: 0, max: 360, step: 1, unit: '度（0 向上，顺时针）' },
        value => set('backgroundGradient', { ...gradient, angle: value ?? 0 }, 'backgroundGradient.angle'));
    } else {
      const add = make('button', '', '添加渐变'); add.type = 'button';
      add.dataset.uiStyleControl = 'backgroundGradient.add';
      add.onclick = () => set('backgroundGradient', { from: effective.background ?? 0xffffff, to: 0x000000, angle: 180 }, 'backgroundGradient.from');
      controls.appendChild(add);
    }
  }
  const image = style?.backgroundImage;
  {
    const controls = field(back, 'backgroundImage', '背景图片', [['不用图片', () => null]]);
    const current = image?.asset ?? '';
    const entries: Array<[string, string]> = [['', image === null ? '（不用图片）' : '（未选择）'], ...options.assets.map(asset => [asset, asset] as [string, string])];
    if (current && !options.assets.includes(current)) entries.push([current, `${current}（素材中心找不到）`]);
    choose(controls, 'backgroundImage', '项目图片', entries, current, value => value
      ? set('backgroundImage', { asset: value, fit: image?.fit ?? 'stretch', ...(image?.slice && (image.fit ?? 'stretch') === 'stretch' ? { slice: image.slice } : {}) })
      : commit('backgroundImage', inheritStyleKey(style, 'backgroundImage')));
    if (image) {
      const fit = choose(controls, 'backgroundImage.fit', '适配方式', Object.entries(FIT_NAMES), image.fit, value =>
        set('backgroundImage', { asset: image.asset, fit: value as 'stretch', ...(value === 'stretch' && image.slice ? { slice: image.slice } : {}) }, 'backgroundImage.fit'));
      if (image.slice) for (const item of Array.from(fit.options)) item.disabled = item.value !== 'stretch';
      if (image.slice) controls.appendChild(make('p', 'ui-style-hint', '使用九宫格时只能拉伸填满；在「框体与皮肤」取消九宫格后可改。'));
    }
    if (options.assets.length === 0) controls.appendChild(make('p', 'ui-style-hint', '素材中心还没有可用的背景图片。'));
    if (node.type === 'button') controls.appendChild(make('p', 'ui-style-hint', '「不用图片」同时停用主题按钮皮肤。'));
  }
  root.appendChild(back);

  // —— 框体与皮肤 ——
  const box = group('box', '框体与皮肤');
  {
    const controls = field(box, 'border', '边框', [['无边框', () => null]]);
    const border = style?.border ?? effective.border;
    if (border) {
      const base = style?.border ?? border;
      number(controls, 'border.width', '边框宽度', base.width, { min: 0, max: 256, step: 1, unit: '像素' }, value => set('border', { ...base, width: value ?? 0 }, 'border.width'));
      colour(controls, 'border.color', '边框颜色', base.color, value => set('border', { ...base, color: value }, 'border.color'));
      number(controls, 'border.opacity', '边框不透明度', base.opacity, { min: 0, max: 1, step: 5, unit: '%', scale: 100 }, value => set('border', { ...base, opacity: value ?? 1 }, 'border.opacity'));
    } else {
      const add = make('button', '', '添加边框'); add.type = 'button';
      add.dataset.uiStyleControl = 'border.add';
      add.onclick = () => set('border', { width: 1, color: effective.color, opacity: 1 }, 'border.width');
      controls.appendChild(add);
    }
  }
  scalar(box, 'borderRadius', '圆角', { min: 0, max: 65535, step: 1, unit: '像素' }, [['直角', () => 0]]);
  {
    const controls = field(box, 'padding', '内边距', [['清空内边距', () => ({ top: 0, right: 0, bottom: 0, left: 0 })]]);
    const padding = style?.padding ?? effective.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
    for (const [side, name] of SIDES) {
      number(controls, `padding.${side}`, `${name}内边距`, style?.padding?.[side], { min: 0, max: 65535, step: 1, unit: '像素' },
        value => set('padding', { ...padding, [side]: value ?? 0 }, `padding.${side}`), padding[side]);
    }
    controls.appendChild(make('p', 'ui-style-hint', '边框宽度和内边距一起从组件尺寸内扣除，子组件、滚动和裁切都在剩余的内容框里。'));
  }
  shadowList(box, 'shadows', '框体阴影', '无阴影', { x: 0, y: 6, blur: 18, color: 0x000000, opacity: 0.3 });
  {
    const wrap = make('div', 'ui-style-field');
    wrap.dataset.uiStyleKey = 'backgroundImage.slice';
    const head = make('div', 'ui-style-field-head');
    head.append(make('span', 'ui-style-label', '九宫格皮肤'), make('span', 'ui-style-state', image?.slice ? '已设置' : '未使用'));
    wrap.appendChild(head);
    const controls = make('div', 'ui-style-controls'); wrap.appendChild(controls);
    if (!image) {
      controls.appendChild(make('p', 'ui-style-hint', '先在「背景」中选择一张项目图片，再按九宫格拉伸。'));
    } else {
      const slice = image.slice;
      check(controls, 'slice.enabled', '按九宫格拉伸', !!slice, enabled => set('backgroundImage', enabled
        ? { asset: image.asset, fit: 'stretch', slice: { top: 16, right: 16, bottom: 16, left: 16, fillCenter: true } }
        : { asset: image.asset, fit: image.fit }, 'slice.enabled'));
      if (slice) {
        for (const [side, name] of SIDES) {
          number(controls, `slice.${side}`, `${name}切边`, slice[side], { min: 0, max: 65535, step: 1, unit: '原图像素' },
            value => set('backgroundImage', { ...image, fit: 'stretch', slice: { ...slice, [side]: Math.round(value ?? 0) } }, `slice.${side}`));
        }
        check(controls, 'slice.fillCenter', '绘制中心区域', slice.fillCenter, value => set('backgroundImage', { ...image, fit: 'stretch', slice: { ...slice, fillCenter: value } }, 'slice.fillCenter'));
        controls.appendChild(make('p', 'ui-style-hint', '切边按图片原始像素计算；组件比四角还小时四角会同比缩小。'));
      }
    }
    box.appendChild(wrap);
  }
  {
    const controls = field(box, 'opacity', '整体不透明度');
    number(controls, 'opacity', '整体不透明度', style?.opacity, { min: 0, max: 1, step: 5, unit: '%', scale: 100 },
      value => value === null ? commit('opacity', inheritStyleKey(style, 'opacity')) : set('opacity', value), effective.opacity);
  }
  root.appendChild(box);
  return root;
}
