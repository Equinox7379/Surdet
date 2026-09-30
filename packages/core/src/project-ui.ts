/** Declarative work UI. Coordinates are in the 1280 × 720 design canvas. */
export const PROJECT_UI_PAGES = [
  'title', 'system-menu', 'save-load', 'settings', 'gallery', 'backlog',
  'dialogue', 'choices', 'toolbar', 'hud',
] as const;
export type ProjectUiPageId = typeof PROJECT_UI_PAGES[number];

export const PROJECT_UI_NODE_TYPES = [
  'container', 'image', 'text', 'button', 'toggle', 'slider', 'input', 'scroll', 'tabs', 'content',
] as const;
export type ProjectUiNodeType = typeof PROJECT_UI_NODE_TYPES[number];

export type ProjectUiText =
  | { kind: 'literal'; value: string }
  | { kind: 'variable' | 'setting'; name: string }
  | { kind: 'data'; field: 'id' | 'label' | 'description' | 'value' | 'date' | 'speaker' | 'dialogue' | 'title' | 'subtitle' | 'mode' | 'ending-progress' | 'profile-progress' | 'term-progress' };
export type ProjectUiBinding = { kind: 'variable' | 'setting'; name: string };
export type ProjectUiAction =
  | { kind: 'start' | 'continue' | 'close' | 'back' | 'advance' | 'rollback' | 'auto' | 'skip' | 'hide' }
  | { kind: 'open'; page: 'system-menu' | 'save-load' | 'settings' | 'gallery' | 'backlog'; mode?: 'save' | 'load' }
  | { kind: 'save' | 'load' | 'choice' | 'gallery-item'; id?: string }
  | { kind: 'setting-step'; name: string; direction: -1 | 1 };

export type ProjectUiContentSource = 'save-slots' | 'backlog' | 'gallery-cgs' | 'gallery-music' | 'gallery-texts' | 'gallery-endings' | 'gallery-profiles' | 'gallery-terms' | 'choices' | 'settings' | 'terms';

export interface ProjectUiFrame {
  x: number; y: number; width: number; height: number;
  /** 0=start, 0.5=centre, 1=end; anchor is relative to the immediate parent. */
  anchorX?: number; anchorY?: number;
}

export interface ProjectUiNode {
  id: string;
  type: ProjectUiNodeType;
  frame: ProjectUiFrame;
  text?: ProjectUiText;
  binding?: ProjectUiBinding;
  action?: ProjectUiAction;
  asset?: string;
  source?: ProjectUiContentSource;
  tab?: string;
  style?: {
    color?: number; background?: number; opacity?: number;
    fontSize?: number; align?: 'left' | 'center' | 'right'; fontRole?: 'body' | 'title' | 'ui';
  };
  children?: ProjectUiNode[];
}

export interface ProjectUiDocument {
  version: 1;
  /** An absent page uses the accepted default UI for that page. */
  pages: Partial<Record<ProjectUiPageId, ProjectUiNode>>;
}

export interface ProjectUiRect { x: number; y: number; width: number; height: number }
export const PROJECT_UI_TAB_BAR_HEIGHT = 38;
export function projectUiChildrenRect(rect: ProjectUiRect, type: ProjectUiNodeType): ProjectUiRect {
  return type === 'tabs' ? { ...rect, y: rect.y + PROJECT_UI_TAB_BAR_HEIGHT, height: rect.height - PROJECT_UI_TAB_BAR_HEIGHT } : rect;
}

/**
 * Node origin = parent origin + (x,y) - (anchorX*width, anchorY*height).
 * Player and Editor use this function, then apply the normal canvas scale/letterbox once.
 */
export function projectUiRect(parent: ProjectUiRect, frame: ProjectUiFrame): ProjectUiRect {
  return {
    x: parent.x + frame.x - (frame.anchorX ?? 0) * frame.width,
    y: parent.y + frame.y - (frame.anchorY ?? 0) * frame.height,
    width: frame.width,
    height: frame.height,
  };
}

const PAGE_SET = new Set<string>(PROJECT_UI_PAGES);
const TYPE_SET = new Set<string>(PROJECT_UI_NODE_TYPES);
const CHILD_TYPES = new Set<ProjectUiNodeType>(['container', 'scroll', 'tabs', 'content']);
const CONTENT_SOURCES = new Set<ProjectUiContentSource>(['save-slots', 'backlog', 'gallery-cgs', 'gallery-music', 'gallery-texts', 'gallery-endings', 'gallery-profiles', 'gallery-terms', 'choices', 'settings', 'terms']);
const SETTING_TYPES: Record<string, 'number' | 'string'> = {
  textSpeedCps: 'number', autoBaseDelayMs: 'number', autoPerCharMs: 'number',
  masterVolume: 'number', bgmVolume: 'number', ambienceVolume: 'number', seVolume: 'number', voiceVolume: 'number',
  skipStrategy: 'number', keyPreset: 'string', locale: 'string',
};
const WRITABLE_SETTINGS = new Set(['textSpeedCps', 'autoBaseDelayMs', 'masterVolume', 'bgmVolume', 'ambienceVolume', 'seVolume', 'voiceVolume', 'skipStrategy']);
const ACTION_KINDS = new Set(['start', 'continue', 'close', 'back', 'advance', 'rollback', 'auto', 'skip', 'hide', 'open', 'save', 'load', 'choice', 'gallery-item', 'setting-step']);

function record(value: unknown, location: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${location} 必须是对象`);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], location: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${location}.${key} 不受支持`);
}

function finite(value: unknown, location: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${location} 必须是有限数值`);
  return value;
}

function nonempty(value: unknown, location: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${location} 必须是非空字符串`);
  return value;
}

function variableType(config: Record<string, unknown>, name: string): string {
  const variables = record(config.variables ?? {}, 'variables');
  const declaration = variables[name];
  if (declaration === undefined) throw new Error(`UI 引用了未声明变量 ${name}`);
  return String(record(declaration, `variables.${name}`).type ?? '');
}

function validateText(value: unknown, config: Record<string, unknown>, location: string, page: ProjectUiPageId, contentSource?: ProjectUiContentSource): ProjectUiText {
  const item = record(value, location);
  if (item.kind === 'literal') {
    onlyKeys(item, ['kind', 'value'], location);
    if (typeof item.value !== 'string') throw new Error(`${location}.value 必须是字符串`);
  } else if (item.kind === 'variable' || item.kind === 'setting') {
    onlyKeys(item, ['kind', 'name'], location);
    const name = nonempty(item.name, `${location}.name`);
    if (item.kind === 'variable') variableType(config, name);
    else if (!Object.hasOwn(SETTING_TYPES, name)) throw new Error(`${location} 设置项不存在：${name}`);
  } else if (item.kind === 'data') {
    onlyKeys(item, ['kind', 'field'], location);
    if (!['id', 'label', 'description', 'value', 'date', 'speaker', 'dialogue', 'title', 'subtitle', 'mode', 'ending-progress', 'profile-progress', 'term-progress'].includes(String(item.field))) throw new Error(`${location}.field 不受支持`);
    if (['id', 'label', 'description', 'value', 'date'].includes(String(item.field)) ? contentSource === undefined
      : ['speaker', 'dialogue'].includes(String(item.field)) ? page !== 'dialogue'
      : ['ending-progress', 'profile-progress', 'term-progress'].includes(String(item.field)) ? page !== 'gallery'
      : ['title', 'subtitle'].includes(String(item.field)) ? page !== 'title' : page !== 'save-load') {
      throw new Error(`${location}.field 在 ${page} 页面没有数据来源`);
    }
  } else throw new Error(`${location}.kind 不受支持`);
  return item as unknown as ProjectUiText;
}

function validateBinding(value: unknown, config: Record<string, unknown>, type: ProjectUiNodeType, location: string): ProjectUiBinding {
  const item = record(value, location);
  onlyKeys(item, ['kind', 'name'], location);
  if (item.kind !== 'variable' && item.kind !== 'setting') throw new Error(`${location}.kind 不受支持`);
  const name = nonempty(item.name, `${location}.name`);
  const bindingType = item.kind === 'variable' ? variableType(config, name) : SETTING_TYPES[name];
  if (bindingType === undefined) throw new Error(`${location} 设置项不存在：${name}`);
  if (item.kind === 'setting' && !WRITABLE_SETTINGS.has(name)) throw new Error(`${location} 设置项没有公开调整入口：${name}`);
  if (item.kind === 'variable' && record(record(config.variables ?? {}, 'variables')[name], `variables.${name}`).readonly === true) {
    throw new Error(`${location} 不允许修改只读变量 ${name}`);
  }
  if (type === 'toggle' && bindingType !== 'boolean' && bindingType !== 'flag' && !(item.kind === 'setting' && name === 'skipStrategy')) throw new Error(`${location} 开关需要布尔值或快进策略`);
  if (type === 'slider' && bindingType !== 'number') throw new Error(`${location} 滑条需要数值`);
  if (type === 'input' && (bindingType !== 'string' || item.kind === 'setting')) throw new Error(`${location} 输入框需要可写字符串变量`);
  return item as unknown as ProjectUiBinding;
}

function validateAction(value: unknown, location: string): ProjectUiAction {
  const item = record(value, location);
  const kind = nonempty(item.kind, `${location}.kind`);
  if (!ACTION_KINDS.has(kind)) throw new Error(`${location}.kind 不受支持：${kind}`);
  if (kind === 'open') {
    onlyKeys(item, ['kind', 'page', 'mode'], location);
    if (!['system-menu', 'save-load', 'settings', 'gallery', 'backlog'].includes(String(item.page))) throw new Error(`${location}.page 不受支持`);
    if (item.page === 'save-load' ? !['save', 'load'].includes(String(item.mode)) : item.mode !== undefined) throw new Error(`${location}.mode 不适用`);
  } else if (kind === 'setting-step') {
    onlyKeys(item, ['kind', 'name', 'direction'], location);
    if (item.name !== 'locale' && !WRITABLE_SETTINGS.has(String(item.name))) throw new Error(`${location}.name 不受支持`);
    if (item.direction !== -1 && item.direction !== 1) throw new Error(`${location}.direction 必须为 -1 或 1`);
  } else if (['save', 'load', 'choice', 'gallery-item'].includes(kind)) {
    onlyKeys(item, ['kind', 'id'], location);
    if (item.id !== undefined) nonempty(item.id, `${location}.id`);
  } else onlyKeys(item, ['kind'], location);
  return item as unknown as ProjectUiAction;
}

function validateNode(value: unknown, config: Record<string, unknown>, ids: Set<string>, location: string, page: ProjectUiPageId, contentSource?: ProjectUiContentSource): ProjectUiNode {
  const item = record(value, location);
  onlyKeys(item, ['id', 'type', 'frame', 'text', 'binding', 'action', 'asset', 'source', 'tab', 'style', 'children'], location);
  const id = nonempty(item.id, `${location}.id`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id)) throw new Error(`${location}.id 非法`);
  if (ids.has(id)) throw new Error(`UI 节点 ID 重复：${id}`);
  ids.add(id);
  if (!TYPE_SET.has(String(item.type))) throw new Error(`${location}.type 不受支持`);
  const type = item.type as ProjectUiNodeType;
  const frame = record(item.frame, `${location}.frame`);
  onlyKeys(frame, ['x', 'y', 'width', 'height', 'anchorX', 'anchorY'], `${location}.frame`);
  for (const key of ['x', 'y', 'width', 'height'] as const) finite(frame[key], `${location}.frame.${key}`);
  if ((frame.width as number) <= 0 || (frame.height as number) <= 0) throw new Error(`${location}.frame 尺寸必须为正`);
  if (type === 'tabs' && (frame.height as number) <= PROJECT_UI_TAB_BAR_HEIGHT) throw new Error(`${location}.frame.height 必须留出页签栏及内容空间`);
  for (const key of ['anchorX', 'anchorY'] as const) if (frame[key] !== undefined && (finite(frame[key], `${location}.frame.${key}`) < 0 || (frame[key] as number) > 1)) throw new Error(`${location}.frame.${key} 必须在 0..1`);
  if (item.text !== undefined) validateText(item.text, config, `${location}.text`, page, contentSource);
  if (item.binding !== undefined) {
    if (!['toggle', 'slider', 'input'].includes(type)) throw new Error(`${location}.binding 不适用于 ${type}`);
    validateBinding(item.binding, config, type, `${location}.binding`);
  }
  if (['toggle', 'slider', 'input'].includes(type) && item.binding === undefined) throw new Error(`${location}.${type} 缺少 binding`);
  if (item.action !== undefined) {
    if (type !== 'button') throw new Error(`${location}.action 只适用于按钮`);
    validateAction(item.action, `${location}.action`);
  }
  if (type === 'image' ? typeof item.asset !== 'string' || item.asset.length === 0 : item.asset !== undefined) throw new Error(`${location}.asset 只适用于图片且图片不能为空`);
  if (type === 'content' ? !CONTENT_SOURCES.has(item.source as ProjectUiContentSource) : item.source !== undefined) throw new Error(`${location}.source 只适用于公共内容容器`);
  if (type === 'content') {
    const sourcePages: Record<ProjectUiContentSource, ProjectUiPageId> = {
      'save-slots': 'save-load', backlog: 'backlog', 'gallery-cgs': 'gallery', 'gallery-music': 'gallery',
      'gallery-texts': 'gallery', 'gallery-endings': 'gallery', 'gallery-profiles': 'gallery', 'gallery-terms': 'gallery', choices: 'choices', settings: 'settings', terms: 'gallery',
    };
    if (sourcePages[item.source as ProjectUiContentSource] !== page || contentSource !== undefined) throw new Error(`${location}.source 在 ${page} 页面不可用`);
  }
  if (item.tab !== undefined && (typeof item.tab !== 'string' || item.tab.trim().length === 0)) throw new Error(`${location}.tab 非法`);
  if (item.style !== undefined) {
    const style = record(item.style, `${location}.style`);
    onlyKeys(style, ['color', 'background', 'opacity', 'fontSize', 'align', 'fontRole'], `${location}.style`);
    for (const key of ['color', 'background', 'opacity', 'fontSize'] as const) if (style[key] !== undefined) finite(style[key], `${location}.style.${key}`);
    for (const key of ['color', 'background'] as const) if (style[key] !== undefined && (!Number.isInteger(style[key]) || (style[key] as number) < 0 || (style[key] as number) > 0xffffff)) throw new Error(`${location}.style.${key} 必须是 RGB 颜色`);
    if (style.opacity !== undefined && ((style.opacity as number) < 0 || (style.opacity as number) > 1)) throw new Error(`${location}.style.opacity 必须在 0..1`);
    if (style.fontSize !== undefined && (style.fontSize as number) <= 0) throw new Error(`${location}.style.fontSize 必须为正`);
    if (style.align !== undefined && !['left', 'center', 'right'].includes(String(style.align))) throw new Error(`${location}.style.align 不受支持`);
    if (style.fontRole !== undefined && !['body', 'title', 'ui'].includes(String(style.fontRole))) throw new Error(`${location}.style.fontRole 不受支持`);
  }
  if (item.children !== undefined) {
    if (!CHILD_TYPES.has(type) || !Array.isArray(item.children)) throw new Error(`${location}.children 不适用于 ${type}`);
    item.children.forEach((child, index) => validateNode(child, config, ids, `${location}.children[${index}]`, page, type === 'content' ? item.source as ProjectUiContentSource : contentSource));
  }
  return item as unknown as ProjectUiNode;
}

/** Unknown versions and unsupported fields fail before they can reach a runtime or authoring write. */
export function readProjectUi(config: Record<string, unknown>): ProjectUiDocument | null {
  if (config.ui === undefined) return null;
  const ui = record(config.ui, 'game.config.json.ui');
  onlyKeys(ui, ['version', 'pages'], 'game.config.json.ui');
  if (ui.version !== 1) throw new Error(`game.config.json.ui.version 不受支持：${String(ui.version)}`);
  const pages = record(ui.pages, 'game.config.json.ui.pages');
  const ids = new Set<string>();
  for (const [page, root] of Object.entries(pages)) {
    if (!PAGE_SET.has(page)) throw new Error(`UI 页面不受支持：${page}`);
    validateNode(root, config, ids, `ui.pages.${page}`, page as ProjectUiPageId);
  }
  return ui as unknown as ProjectUiDocument;
}

export function projectUiAssetKeys(ui: ProjectUiDocument | null): string[] {
  const keys = new Set<string>();
  const visit = (node: ProjectUiNode): void => {
    if (node.asset) keys.add(node.asset);
    node.children?.forEach(visit);
  };
  if (ui) Object.values(ui.pages).forEach(root => { if (root) visit(root); });
  return [...keys];
}

export function projectUiVariableNames(ui: ProjectUiDocument | null): string[] {
  const names = new Set<string>();
  const visit = (node: ProjectUiNode): void => {
    if (node.text?.kind === 'variable') names.add(node.text.name);
    if (node.binding?.kind === 'variable') names.add(node.binding.name);
    node.children?.forEach(visit);
  };
  if (ui) Object.values(ui.pages).forEach(root => { if (root) visit(root); });
  return [...names];
}
