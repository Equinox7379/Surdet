import { PROJECT_UI_NODE_TYPES, PROJECT_UI_PAGES, PROJECT_UI_TAB_BAR_HEIGHT, projectUiChildrenRect, projectUiRect, type ProjectUiDocument, type ProjectUiNode, type ProjectUiNodeType, type ProjectUiPageId, type ProjectUiRect } from '@surdet/core';
import { buildAssetCatalog, parseProjectConfigDocument, type UiPatch } from '@surdet/authoring';
import { SETTING_STEPS } from '@surdet/renderer';
import { state } from './state.js';
import { ImageScope } from './v4/ui.js';

let activeImages: ImageScope | null = null;
let dragCleanup: (() => void) | null = null;
export function disposeUiDesigner(): void {
  dragCleanup?.(); dragCleanup = null;
  activeImages?.dispose(); activeImages = null;
}

interface UiDesignerOptions {
  read(): ProjectUiDocument | null;
  edit(patch: UiPatch): ProjectUiDocument | null;
  replace(value: ProjectUiDocument | null): void;
  reload(): ProjectUiDocument | null;
  save(): Promise<unknown>;
  preview(): Promise<void>;
  exportShare(fragment?: { page: ProjectUiPageId; node: ProjectUiNode }): Promise<void>;
  importShare(file: File, target: { page: ProjectUiPageId; parentId?: string }): Promise<void>;
  undo(): void;
  redo(): void;
  onStatus(message: string, ok?: boolean): void;
}

const PAGE_NAMES: Record<ProjectUiPageId, string> = {
  title: '标题', 'system-menu': '系统菜单', 'save-load': '存读档', settings: '设置', gallery: '鉴赏', backlog: '历史',
  dialogue: '对白', choices: '选项', toolbar: '阅读工具栏', hud: '剧情信息栏',
};
const TYPE_NAMES: Record<ProjectUiNodeType, string> = {
  container: '容器', image: '图片', text: '文本', button: '按钮', toggle: '开关', slider: '滑条',
  input: '输入框', scroll: '滚动列表', tabs: '页签', content: '公共内容',
};
const DATA_FIELDS: Record<string, string> = {
  id: '标识', label: '名称', description: '说明', value: '当前值', date: '日期',
  speaker: '说话人', dialogue: '台词', title: '标题', subtitle: '副标题', mode: '存读档模式', 'ending-progress': '结局收集进度', 'profile-progress': '人物资料收集进度', 'term-progress': '词条收集进度',
};
const SETTING_NAMES: Record<string, string> = {
  ...Object.fromEntries(SETTING_STEPS.map(setting => [setting.key, setting.label])),
  autoPerCharMs: '自动播放每字停留', keyPreset: '快捷键方案', locale: '作品语言',
};
const SOURCE_NAMES: Record<NonNullable<ProjectUiNode['source']>, string> = {
  'save-slots': '存档列表', settings: '阅读设置', backlog: '文字记录', choices: '剧情选项',
  'gallery-cgs': '图片鉴赏', 'gallery-music': '音乐鉴赏', 'gallery-texts': '剧情回想', 'gallery-endings': '结局册', 'gallery-profiles': '人物档案', 'gallery-terms': '用语辞典',
  terms: '名词表',
};
const ACTION_NAMES: Record<NonNullable<ProjectUiNode['action']>['kind'], string> = {
  start: '开始游戏', continue: '继续游戏', open: '打开页面', back: '返回', close: '关闭',
  save: '保存进度', load: '读取进度', choice: '选择选项', 'gallery-item': '打开鉴赏条目',
  'setting-step': '调整阅读设置', advance: '继续阅读', rollback: '回退一句',
  auto: '自动播放', skip: '快进', hide: '隐藏界面',
};
const DESIGN_FRAME: ProjectUiRect = { x: 0, y: 0, width: 1280, height: 720 };
let selectedPage: ProjectUiPageId = 'title';
let selectedNodeId: string | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, label?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (label !== undefined) node.textContent = label;
  return node;
}

function option(value: string, label: string): HTMLOptionElement {
  const item = element('option'); item.value = value; item.textContent = label; return item;
}

function findNode(root: ProjectUiNode, id: string, parentRect = DESIGN_FRAME, parentId: string | null = null):
  { node: ProjectUiNode; parentId: string | null; parentRect: ProjectUiRect; index: number; siblings: ProjectUiNode[] } | null {
  if (root.id === id) return { node: root, parentId, parentRect, index: 0, siblings: [root] };
  const rect = projectUiChildrenRect(projectUiRect(parentRect, root.frame), root.type);
  for (const [index, child] of (root.children ?? []).entries()) {
    if (child.id === id) return { node: child, parentId: root.id, parentRect: rect, index, siblings: root.children! };
    const found = findNode(child, id, rect, root.id);
    if (found) return found;
  }
  return null;
}

function availableAssets(): string[] {
  const catalog = buildAssetCatalog(state.dirAssets.flatMap(asset => asset.sourcePath ? [asset.sourcePath] : []));
  return catalog.backgrounds.filter(asset => asset.resolved && catalog.backgrounds.filter(other => other.key === asset.key).length === 1).map(asset => asset.key).sort();
}

function availableVariables(type?: string): string[] {
  const config = parseProjectConfigDocument(state.gameConfigText || '{}');
  const variables = typeof config.variables === 'object' && config.variables !== null && !Array.isArray(config.variables)
    ? config.variables as Record<string, unknown> : {};
  return Object.entries(variables).flatMap(([name, raw]) => {
    const declaration = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return declaration.readonly === true || (type && declaration.type !== type && !(type === 'flag' && declaration.type === 'boolean')) ? [] : [name];
  });
}

function newNode(type: ProjectUiNodeType, page: ProjectUiPageId): ProjectUiNode {
  const frame = { x: 40, y: 40, width: type === 'container' || type === 'scroll' || type === 'tabs' || type === 'content' ? 340 : 210, height: type === 'content' ? 300 : type === 'container' || type === 'scroll' || type === 'tabs' ? 180 : 48 };
  const node: ProjectUiNode = { id: `ui_${crypto.randomUUID().slice(0, 8)}`, type, frame };
  if (type === 'image') {
    const asset = availableAssets()[0];
    if (!asset) throw new Error('先在素材中心添加一张受支持的背景图片，再添加图片组件。');
    node.asset = asset;
  }
  if (type === 'text' || type === 'button') node.text = { kind: 'literal', value: type === 'button' ? '按钮' : '文本' };
  if (type === 'button') node.action = { kind: page === 'title' ? 'start' : page === 'choices' ? 'choice' : 'back' };
  if (type === 'toggle') node.binding = availableVariables('flag').length > 0 ? { kind: 'variable', name: availableVariables('flag')[0]! } : { kind: 'setting', name: 'skipStrategy' };
  if (type === 'slider') node.binding = { kind: 'setting', name: 'textSpeedCps' };
  if (type === 'input') {
    const name = availableVariables('string')[0];
    if (!name) throw new Error('输入框需要先声明一个可写字符串变量。');
    node.binding = { kind: 'variable', name };
  }
  if (type === 'content') {
    const sources: Partial<Record<ProjectUiPageId, ProjectUiNode['source']>> = {
      'save-load': 'save-slots', settings: 'settings', gallery: 'gallery-cgs', backlog: 'backlog', choices: 'choices',
    };
    if (!sources[page]) throw new Error(`公共内容容器在 ${PAGE_NAMES[page]} 页面没有数据来源。`);
    node.source = sources[page];
  }
  if (['container', 'scroll', 'tabs'].includes(type)) node.children = [];
  return node;
}

function nodeLabel(node: ProjectUiNode): string {
  return `${TYPE_NAMES[node.type]} · ${node.id}`;
}

export function renderUiDesigner(options: UiDesignerOptions): HTMLElement {
  disposeUiDesigner();
  const root = element('div', 'ui-designer');
  root.dataset.uiDesigner = 'true';
  const toolbar = element('div', 'ui-designer-toolbar');
  const pageSelect = element('select');
  pageSelect.setAttribute('aria-label', '作品界面页面');
  for (const page of PROJECT_UI_PAGES) pageSelect.appendChild(option(page, PAGE_NAMES[page]));
  pageSelect.value = selectedPage;
  pageSelect.onchange = () => { selectedPage = pageSelect.value as ProjectUiPageId; selectedNodeId = null; draw(); };
  const save = element('button', '', '保存界面'); save.type = 'button';
  save.onclick = () => { void options.save().then(() => options.onStatus('界面已保存，重新打开或试玩可查看正式结果。')).catch(error => options.onStatus(`保存失败：${String(error)}`, false)); };
  const preview = element('button', '', '试玩草稿'); preview.type = 'button';
  preview.onclick = () => { void options.preview().catch(error => options.onStatus(`试玩未启动：${String(error)}`, false)); };
  const undo = element('button', '', '撤销'); undo.onclick = () => options.undo();
  const redo = element('button', '', '重做'); redo.onclick = () => options.redo();
  const restore = element('button', '', '本页恢复默认');
  restore.onclick = () => apply({ type: 'page.remove', page: selectedPage });
  toolbar.append(pageSelect, save, preview, undo, redo, restore);
  const exportTheme = element('button', '', '导出作品主题');
  exportTheme.onclick = () => { void options.exportShare().catch(error => options.onStatus(String(error), false)); };
  const exportFragment = element('button', '', '导出所选片段');
  exportFragment.onclick = () => {
    const pageRoot = options.read()?.pages[selectedPage];
    const node = pageRoot && selectedNodeId ? findNode(pageRoot, selectedNodeId)?.node : undefined;
    if (!node) { options.onStatus('请先选择要分享的组件。', false); return; }
    void options.exportShare({ page: selectedPage, node }).catch(error => options.onStatus(String(error), false));
  };
  const importButton = element('button', '', '导入主题或片段');
  const fileInput = element('input'); fileInput.type = 'file'; fileInput.accept = '.json'; fileInput.hidden = true;
  importButton.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files?.[0]; fileInput.value = '';
    if (!file) return;
    const pageRoot = options.read()?.pages[selectedPage];
    const found = pageRoot && selectedNodeId ? findNode(pageRoot, selectedNodeId) : null;
    const parentId = found && ['container', 'scroll', 'tabs', 'content'].includes(found.node.type) ? found.node.id : found?.parentId ?? pageRoot?.id;
    void options.importShare(file, { page: selectedPage, ...(parentId ? { parentId } : {}) }).then(() => { if (root.isConnected) draw(); }).catch(error => options.onStatus(String(error), false));
  };
  toolbar.append(exportTheme, exportFragment, importButton, fileInput);
  root.appendChild(toolbar);
  const body = element('div', 'ui-designer-body'); root.appendChild(body);

  function apply(patch: UiPatch): void {
    try {
      options.edit(patch);
      if (patch.type === 'node.remove' && selectedNodeId === patch.id) selectedNodeId = null;
      if (patch.type === 'node.copy') selectedNodeId = patch.newId;
      if (patch.type === 'node.insert') selectedNodeId = patch.node.id;
      if (patch.type === 'page.remove') selectedNodeId = null;
      draw();
      options.onStatus('界面草稿已更新，尚未写入项目。');
    } catch (error) { options.onStatus(error instanceof Error ? error.message : String(error), false); }
  }

  function drawTree(parent: HTMLElement, node: ProjectUiNode, depth: number): void {
    const button = element('button', 'ui-tree-node', nodeLabel(node));
    button.type = 'button'; button.dataset.uiNode = node.id;
    button.style.paddingLeft = `${12 + depth * 16}px`;
    button.setAttribute('aria-current', String(selectedNodeId === node.id));
    button.onclick = () => { selectedNodeId = node.id; draw(); };
    parent.appendChild(button);
    node.children?.forEach(child => drawTree(parent, child, depth + 1));
  }

  function drawCanvas(canvas: HTMLElement, node: ProjectUiNode, parentRect: ProjectUiRect): void {
    const rect = projectUiRect(parentRect, node.frame);
    const item = element('div', `ui-canvas-node ui-canvas-${node.type}`, node.text?.kind === 'literal' ? node.text.value : node.type === 'container' || node.type === 'tabs' ? '' : TYPE_NAMES[node.type]);
    item.dataset.uiNode = node.id;
    item.dataset.selected = String(selectedNodeId === node.id);
    item.style.left = `${rect.x / 1280 * 100}%`;
    item.style.top = `${rect.y / 720 * 100}%`;
    item.style.width = `${rect.width / 1280 * 100}%`;
    item.style.height = `${rect.height / 720 * 100}%`;
    const style = node.style;
    if (style?.color !== undefined) item.style.color = `#${style.color.toString(16).padStart(6, '0')}`;
    if (style?.background !== undefined) item.style.backgroundColor = `#${style.background.toString(16).padStart(6, '0')}`;
    item.style.fontSize = `${(style?.fontSize ?? 24) / 1280 * 100}cqw`;
    item.style.textAlign = style?.align ?? 'left';
    item.style.opacity = String(style?.opacity ?? 1);
    if (node.type === 'image') {
      item.textContent = '';
      const source = state.dirAssets.find(asset => asset.kind === 'bg' && asset.key === node.asset);
      const picture = element('div', 'ui-canvas-image'); item.appendChild(picture);
      void activeImages?.image(picture, source, node.asset ?? '项目图片');
    }
    item.title = nodeLabel(node);
    item.onpointerdown = event => {
      event.preventDefault(); event.stopPropagation();
      selectedNodeId = node.id;
      const resize = (event.target as HTMLElement).dataset.resize === 'true';
      const startX = event.clientX, startY = event.clientY;
      const initial = { ...node.frame };
      const projectRoot = state.dirHandle, page = selectedPage;
      const width = canvas.getBoundingClientRect().width, height = canvas.getBoundingClientRect().height;
      const move = (next: PointerEvent): void => {
        const dx = Math.round((next.clientX - startX) / width * 1280);
        const dy = Math.round((next.clientY - startY) / height * 720);
        item.style.transform = resize ? '' : `translate(${dx / 1280 * width}px, ${dy / 720 * height}px)`;
        if (resize) {
          item.style.width = `${Math.max(8, initial.width + dx) / 1280 * 100}%`;
          item.style.height = `${Math.max(8, initial.height + dy) / 720 * 100}%`;
        }
      };
      const stop = (next: PointerEvent): void => {
        cleanup();
        if (!root.isConnected || state.dirHandle !== projectRoot || page !== selectedPage) return;
        const dx = Math.round((next.clientX - startX) / width * 1280);
        const dy = Math.round((next.clientY - startY) / height * 720);
        if (dx !== 0 || dy !== 0) apply({ type: 'node.update', page: selectedPage, id: node.id,
          patch: { frame: resize ? { ...initial, width: Math.max(8, initial.width + dx), height: Math.max(8, initial.height + dy) }
            : { ...initial, x: initial.x + dx, y: initial.y + dy } } });
        else draw();
      };
      const cleanup = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', cancel); dragCleanup = null; };
      const cancel = (): void => { cleanup(); if (root.isConnected) draw(); };
      dragCleanup?.(); dragCleanup = cleanup;
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', cancel);
    };
    if (selectedNodeId === node.id) {
      const handle = element('span', 'ui-resize-handle'); handle.dataset.resize = 'true';
      handle.title = '拖动调整尺寸'; item.appendChild(handle);
    }
    canvas.appendChild(item);
    let children = node.children ?? [];
    if (node.type === 'tabs' && children.length) {
      const tabChildren = children;
      const tabs = [...new Set(children.map(child => child.tab).filter(Boolean))];
      if (tabs.length === 0) tabs.push('页面 1');
      const active = children.find(child => selectedNodeId && findNode(child, selectedNodeId))?.tab ?? tabs[0];
      const bar = element('div'); bar.style.cssText = `display:flex;gap:4px;height:${PROJECT_UI_TAB_BAR_HEIGHT / 1280 * 100}cqw;position:relative;z-index:1`;
      for (const tab of tabs) {
        const button = element('button', '', tab); button.type = 'button'; button.style.padding = '0 4px'; button.style.fontSize = 'inherit';
        button.onpointerdown = event => event.stopPropagation();
        button.onclick = () => { selectedNodeId = tabChildren.find(child => (child.tab ?? tabs[0]) === tab)!.id; draw(); };
        bar.appendChild(button);
      }
      item.appendChild(bar);
      children = children.filter(child => (child.tab ?? tabs[0]) === active);
    }
    children.forEach(child => drawCanvas(canvas, child, projectUiChildrenRect(rect, node.type)));
  }

  function drawProperties(parent: HTMLElement, rootNode: ProjectUiNode): void {
    const selected = selectedNodeId ? findNode(rootNode, selectedNodeId) : null;
    if (!selected) { parent.appendChild(element('p', 'ui-empty', '在画布或层级中选择一个组件。')); return; }
    const { node, parentRect, parentId, index, siblings } = selected;
    parent.appendChild(element('h3', '', nodeLabel(node)));
    const frame = element('div', 'ui-property-grid');
    const field = (label: string, value: number, set: (value: number) => void): void => {
      const wrap = element('label'); wrap.textContent = label;
      const input = element('input'); input.type = 'number'; input.value = String(value); input.step = 'any';
      input.onchange = () => set(Number(input.value));
      wrap.appendChild(input); frame.appendChild(wrap);
    };
    for (const [label, key] of [['横坐标', 'x'], ['纵坐标', 'y'], ['宽', 'width'], ['高', 'height'], ['横向锚点', 'anchorX'], ['纵向锚点', 'anchorY']] as const) {
      field(label, node.frame[key] ?? 0, value => apply({ type: 'node.update', page: selectedPage, id: node.id,
        patch: { frame: { ...node.frame, [key]: value } } }));
    }
    parent.appendChild(frame);
    const align = element('div', 'ui-property-actions');
    for (const [label, axis] of [['水平居中', 'x'], ['垂直居中', 'y']] as const) {
      const button = element('button', '', label);
      button.onclick = () => apply({ type: 'node.update', page: selectedPage, id: node.id,
        patch: { frame: { ...node.frame, [axis]: (axis === 'x' ? (parentRect.width - node.frame.width) / 2 + (node.frame.anchorX ?? 0) * node.frame.width
          : (parentRect.height - node.frame.height) / 2 + (node.frame.anchorY ?? 0) * node.frame.height) } } });
      align.appendChild(button);
    }
    parent.appendChild(align);
    field('字号', node.style?.fontSize ?? 24, value => apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { style: { ...node.style, fontSize: value } } }));
    field('不透明度', node.style?.opacity ?? 1, value => apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { style: { ...node.style, opacity: value } } }));
    for (const [title, key, fallback] of [['文字颜色', 'color', 0x303847], ['底色', 'background', 0xffffff]] as const) {
      const label = element('label', 'ui-property-line', title);
      const input = element('input'); input.type = 'color'; input.value = `#${(node.style?.[key] ?? fallback).toString(16).padStart(6, '0')}`;
      input.onchange = () => apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { style: { ...node.style, [key]: parseInt(input.value.slice(1), 16) } } });
      label.appendChild(input); parent.appendChild(label);
    }
    if (node.text) {
      const kind = element('select');
      for (const [value, label] of [['literal', '固定文字'], ['variable', '剧情变量'], ['setting', '阅读设置'], ['data', '当前页面内容']]) kind.appendChild(option(value!, label!));
      kind.value = node.text.kind;
      const textInput = node.text.kind === 'data' || node.text.kind === 'setting' ? element('select') : element('input');
      if (textInput instanceof HTMLSelectElement) {
        const names = node.text.kind === 'data' ? DATA_FIELDS : SETTING_NAMES;
        Object.entries(names).forEach(([value, label]) => textInput.appendChild(option(value, label)));
        const current = node.text.kind === 'data' ? node.text.field : node.text.kind === 'setting' ? node.text.name : '';
        if (!(current in names)) textInput.appendChild(option(current, current));
      }
      textInput.setAttribute('aria-label', '文字或数据字段');
      textInput.value = node.text.kind === 'literal' ? node.text.value : node.text.kind === 'data' ? node.text.field : node.text.name;
      const changeText = (): void => {
        const text = kind.value === 'literal' ? { kind: 'literal' as const, value: textInput.value }
          : kind.value === 'data' ? { kind: 'data' as const, field: textInput.value as 'label' }
          : { kind: kind.value as 'variable' | 'setting', name: textInput.value };
        apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { text } });
      };
      kind.onchange = () => {
        const value = kind.value === 'data' ? (selectedPage === 'dialogue' ? 'dialogue' : selectedPage === 'title' ? 'title' : 'label') : kind.value === 'variable' ? availableVariables()[0] ?? '' : kind.value === 'setting' ? 'textSpeedCps' : '';
        const text = kind.value === 'literal' ? { kind: 'literal' as const, value }
          : kind.value === 'data' ? { kind: 'data' as const, field: value as 'label' }
          : { kind: kind.value as 'variable' | 'setting', name: value };
        apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { text } });
      };
      textInput.onchange = changeText;
      const text = element('label', 'ui-property-line', '文字 / 数据来源'); text.append(kind, textInput); parent.appendChild(text);
    }
    if (node.asset !== undefined) {
      const select = element('select');
      availableAssets().forEach(asset => select.appendChild(option(asset, asset)));
      select.value = node.asset;
      select.onchange = () => apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { asset: select.value } });
      const label = element('label', 'ui-property-line', '项目图片'); label.appendChild(select); parent.appendChild(label);
    }
    if (node.binding) {
      const bindingKind = element('select'); bindingKind.append(option('variable', '剧情变量'));
      if (node.type !== 'input') bindingKind.append(option('setting', '设置'));
      bindingKind.value = node.binding.kind;
      const name = element('select');
      const renderNames = (): void => {
        name.replaceChildren();
        const names = bindingKind.value === 'setting' ? (node.type === 'toggle' ? ['skipStrategy'] : SETTING_STEPS.map(setting => setting.key))
          : availableVariables(node.type === 'input' ? 'string' : node.type === 'slider' ? 'number' : 'flag');
        names.forEach(value => name.appendChild(option(value, bindingKind.value === 'setting' ? SETTING_NAMES[value] ?? value : value)));
        name.value = names.includes(node.binding!.name) ? node.binding!.name : names[0] ?? '';
      };
      renderNames();
      bindingKind.onchange = () => { renderNames(); apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { binding: { kind: bindingKind.value as 'variable' | 'setting', name: name.value } } }); };
      name.onchange = () => apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { binding: { kind: bindingKind.value as 'variable' | 'setting', name: name.value } } });
      const label = element('label', 'ui-property-line', '控件值'); label.append(bindingKind, name); parent.appendChild(label);
    }
    if (node.source) {
      const select = element('select');
      const sources = selectedPage === 'gallery' ? ['gallery-cgs', 'gallery-music', 'gallery-texts', 'gallery-endings', 'gallery-profiles', 'gallery-terms', 'terms'] : [node.source];
      sources.forEach(source => select.appendChild(option(source, SOURCE_NAMES[source as keyof typeof SOURCE_NAMES])));
      select.value = node.source;
      select.onchange = () => apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { source: select.value as ProjectUiNode['source'] } });
      const label = element('label', 'ui-property-line', '公开内容'); label.appendChild(select); parent.appendChild(label);
    }
    if (node.type === 'button') {
      const select = element('select'); Object.entries(ACTION_NAMES).forEach(([kind, name]) => select.appendChild(option(kind, name)));
      select.value = node.action?.kind ?? '';
      const arg = node.action?.kind === 'open' || node.action?.kind === 'setting-step' ? element('select') : element('input');
      if (arg instanceof HTMLSelectElement) {
        const names = node.action?.kind === 'open'
          ? Object.fromEntries(['system-menu', 'save-load', 'settings', 'gallery', 'backlog'].map(page => [page, PAGE_NAMES[page as ProjectUiPageId]]))
          : { ...Object.fromEntries(SETTING_STEPS.map(setting => [setting.key, setting.label])), locale: '作品语言' };
        Object.entries(names).forEach(([value, label]) => arg.appendChild(option(value, label)));
        const current = node.action?.kind === 'open' ? node.action.page : node.action?.kind === 'setting-step' ? node.action.name : '';
        if (!(current in names)) arg.appendChild(option(current, current));
      } else arg.placeholder = '槽位或条目标识（留空使用当前项）';
      arg.setAttribute('aria-label', '操作目标');
      arg.value = node.action?.kind === 'open' ? node.action.page : 'id' in (node.action ?? {}) ? String((node.action as { id?: string }).id ?? '') : node.action?.kind === 'setting-step' ? node.action.name : '';
      const mode = element('select'); mode.setAttribute('aria-label', '存读档模式');
      mode.append(option('save', '存档'), option('load', '读档'));
      mode.value = node.action?.kind === 'open' ? node.action.mode ?? 'load' : 'load';
      mode.hidden = node.action?.kind !== 'open' || node.action.page !== 'save-load';
      const direction = element('select'); direction.setAttribute('aria-label', '设置调整方向');
      direction.append(option('1', '增加'), option('-1', '减少'));
      direction.value = String(node.action?.kind === 'setting-step' ? node.action.direction : 1);
      direction.hidden = node.action?.kind !== 'setting-step';
      const update = (value = arg.value): void => {
        const kind = select.value;
        const action = kind === 'open' ? { kind: 'open' as const, page: (value || 'settings') as 'settings', ...(value === 'save-load' ? { mode: mode.value as 'save' | 'load' } : {}) }
          : kind === 'setting-step' ? { kind: 'setting-step' as const, name: value || 'textSpeedCps', direction: Number(direction.value) as -1 | 1 }
          : ['save', 'load', 'choice', 'gallery-item'].includes(kind) ? { kind: kind as 'save', ...(value ? { id: value } : {}) }
          : { kind: kind as 'start' };
        apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { action } });
      };
      select.onchange = () => update(select.value === 'open' ? 'settings' : select.value === 'setting-step' ? 'textSpeedCps' : '');
      arg.onchange = () => update();
      mode.onchange = () => update(); direction.onchange = () => update();
      const label = element('label', 'ui-property-line', '点击操作'); label.append(select, arg, mode, direction); parent.appendChild(label);
    }
    if (node.tab !== undefined || (parentId && findNode(rootNode, parentId)?.node.type === 'tabs')) {
      const input = element('input'); input.value = node.tab ?? ''; input.onchange = () => apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { tab: input.value } });
      const label = element('label', 'ui-property-line', '页签名称'); label.appendChild(input); parent.appendChild(label);
    }
    if (parentId !== null) {
      const actions = element('div', 'ui-property-actions');
      const up = element('button', '', '上移层级'); up.disabled = index === 0; up.onclick = () => apply({ type: 'node.reorder', page: selectedPage, id: node.id, index: index - 1 });
      const down = element('button', '', '下移层级'); down.disabled = index >= siblings.length - 1; down.onclick = () => apply({ type: 'node.reorder', page: selectedPage, id: node.id, index: index + 1 });
      const copy = element('button', '', '复制'); copy.onclick = () => apply({ type: 'node.copy', page: selectedPage, id: node.id, newId: `ui_${crypto.randomUUID().slice(0, 8)}` });
      const remove = element('button', '', '删除'); remove.onclick = () => apply({ type: 'node.remove', page: selectedPage, id: node.id });
      actions.append(up, down, copy, remove); parent.appendChild(actions);
    }
  }

  function draw(): void {
    activeImages?.dispose(); activeImages = new ImageScope();
    body.replaceChildren();
    const ui = options.read();
    const pageRoot = ui?.pages[selectedPage];
    if (selectedNodeId && pageRoot && !findNode(pageRoot, selectedNodeId)) selectedNodeId = null;
    const tree = element('aside', 'ui-designer-tree'); tree.appendChild(element('h3', '', '层级'));
    if (pageRoot) drawTree(tree, pageRoot, 0);
    else tree.appendChild(element('p', 'ui-empty', '本页使用默认界面。'));
    const addRow = element('div', 'ui-add-row');
    const typeSelect = element('select'); typeSelect.setAttribute('aria-label', '新增组件类型');
    for (const type of PROJECT_UI_NODE_TYPES) typeSelect.appendChild(option(type, TYPE_NAMES[type]));
    const add = element('button', '', '添加组件');
    add.onclick = () => {
      try {
        if (!pageRoot) {
          const rootNode: ProjectUiNode = { id: `ui_page_${selectedPage.replace('-', '_')}`, type: 'container', frame: { x: 0, y: 0, width: 1280, height: 720 }, children: [] };
          apply({ type: 'page.set', page: selectedPage, root: rootNode });
          return;
        }
        const selected = selectedNodeId ? findNode(pageRoot, selectedNodeId) : null;
        const parent = selected && ['container', 'scroll', 'tabs', 'content'].includes(selected.node.type) ? selected.node
          : selected?.parentId ? findNode(pageRoot, selected.parentId)?.node : pageRoot;
        const node = newNode(typeSelect.value as ProjectUiNodeType, selectedPage);
        if (parent?.type === 'tabs') node.tab = `页签 ${(parent.children?.length ?? 0) + 1}`;
        apply({ type: 'node.insert', page: selectedPage, parentId: parent?.id ?? pageRoot.id, index: parent?.children?.length ?? 0, node });
      } catch (error) { options.onStatus(error instanceof Error ? error.message : String(error), false); }
    };
    addRow.append(typeSelect, add); tree.appendChild(addRow);
    const center = element('div', 'ui-designer-center');
    const canvas = element('div', 'ui-designer-canvas');
    canvas.setAttribute('aria-label', `${PAGE_NAMES[selectedPage]}设计画布`);
    if (pageRoot) drawCanvas(canvas, pageRoot, DESIGN_FRAME);
    else canvas.appendChild(element('p', 'ui-empty', '添加页面后可在画布选择与拖动组件。'));
    center.appendChild(canvas);
    const properties = element('aside', 'ui-designer-properties'); properties.appendChild(element('h3', '', '属性'));
    if (pageRoot) drawProperties(properties, pageRoot);
    else properties.appendChild(element('p', 'ui-empty', '此页尚未启用自定义布局。'));
    body.append(tree, center, properties);
  }

  draw();
  return root;
}
