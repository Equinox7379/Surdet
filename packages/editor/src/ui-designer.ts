import { PROJECT_UI_NODE_TYPES, PROJECT_UI_PAGES, PROJECT_UI_TAB_BAR_HEIGHT, projectUiChildrenRect, projectUiContentRect, projectUiRect, resolveProjectFontPaths, resolvePlayerTheme, resolveProjectUiInteractionStyle, resolveProjectUiMotion, type ProjectFontRole, type ProjectUiDocument, type ProjectUiInteraction, type ProjectUiMotion, type ProjectUiNode, type ProjectUiNodeType, type ProjectUiPageId, type ProjectUiRect, type ProjectUiStyle } from '@surdet/core';
import { buildAssetCatalog, parseProjectConfigDocument, type UiPatch } from '@surdet/authoring';
import { DEFAULT_RENDERER_FONT_FAMILIES, ProjectUiMotionController, applyProjectUiTypography, createProjectUiDecor, createProjectUiImageSizes, projectUiInsetCss, usesProjectUiBox, type ProjectUiDecorImage, type ProjectUiMotionPose } from '@surdet/renderer';
import type { DirAsset } from './assets.js';
import { state } from './state.js';
import { UI_MOTION_DEFAULTS, UI_STATE_LABELS, UI_STATE_NAMES, effectiveUiStyle, isUiStateNode, renderUiStyleForm, withUiMotion, withUiState, type UiMotionDirection, type UiStateName } from './ui-style-form.js';
import { ImageScope } from './v4/ui.js';
import { SETTING_LABELS, bindableSettings, isSwitchSetting, steppableSettings } from './ui-settings.js';

let activeImages: ImageScope | null = null;
let dragCleanup: (() => void) | null = null;
/** Decoration images stay alive while the designer is open (CSS backgrounds need a live URL). */
const styleImages = new Map<DirAsset, Promise<ProjectUiDecorImage>>();
const styleImageUrls = new Set<string>();
let styleImageSizes = createProjectUiImageSizes();
/** Project role fonts loaded for the canvas, keyed by `role:path`, released with the designer. */
const roleFonts = new Map<string, { family: string; face?: FontFace }>();
/** Bumped by every disposal: a file read that finishes later belongs to a closed designer. */
let designerGeneration = 0;
const openStyleGroups = new Set<string>(['text']);
let styleFocus: string | null = null;
/** U2: which interaction state the style form edits and the canvas shows for the selected control. */
let selectedState: UiStateName | 'normal' = 'normal';
let selectedStateOwner: string | null = null;
// The existing configuration history rebuilds the whole workspace synchronously.
// That redraw is not closing the designer or switching projects.
let historyRedraw = false;
export function redrawUiDesignerHistory(redraw: () => void): void {
  historyRedraw = true;
  try { redraw(); } finally { historyRedraw = false; }
}
/** The one canvas preview of a page enter/exit; it only moves the canvas layer, never the work or the player. */
let motionPreview: { controller: ProjectUiMotionController; frame: number; stop(): void } | null = null;
function stopMotionPreview(): void { const preview = motionPreview; motionPreview = null; preview?.stop(); }
export function disposeUiDesigner(): void {
  designerGeneration += 1;
  stopMotionPreview();
  if (!historyRedraw) { selectedState = 'normal'; selectedStateOwner = null; styleFocus = null; }
  dragCleanup?.(); dragCleanup = null;
  activeImages?.dispose(); activeImages = null;
  for (const url of styleImageUrls) URL.revokeObjectURL(url);
  styleImageUrls.clear(); styleImages.clear(); styleImageSizes = createProjectUiImageSizes();
  for (const { face } of roleFonts.values()) if (face) document.fonts.delete(face);
  roleFonts.clear();
}

/** The same project background the Player loads for `style.backgroundImage`, read from the asset folder. */
function styleImage(asset: string): Promise<ProjectUiDecorImage> {
  const source = state.dirAssets.find(item => item.kind === 'bg' && item.key === asset);
  if (!source?.isImage || !source.handle) return Promise.reject(new Error(`素材中心找不到背景图片：${asset}`));
  let image = styleImages.get(source);
  if (!image) {
    const handle = source.handle, sizes = styleImageSizes, generation = designerGeneration;
    const loading: Promise<ProjectUiDecorImage> = handle.getFile().then(file => {
      // A read that outlives the designer creates no URL, so nothing is left unreleased.
      if (generation !== designerGeneration) throw new Error('界面设计器已关闭');
      const url = URL.createObjectURL(file); styleImageUrls.add(url);
      return { url, size: () => sizes(url) };
    });
    loading.catch(() => { if (styleImages.get(source) === loading) styleImages.delete(source); });
    styleImages.set(source, image = loading);
  }
  return image;
}

/**
 * CSS font family for a role on the canvas: the project's role font file (the same file the Player
 * registers for that role), falling back to the Player's own default family list for the role.
 */
function roleFontFamily(role: ProjectFontRole, config: Record<string, unknown>, onError: (message: string) => void): string {
  const path = ((): string | undefined => {
    try { return resolveProjectFontPaths(config)[role]; } catch { return undefined; /* reported by project validation */ }
  })();
  const fallback = DEFAULT_RENDERER_FONT_FAMILIES[role];
  const projectRoot = state.dirHandle;
  if (!path || !projectRoot || typeof FontFace === 'undefined') return fallback;
  const key = `${role}:${path}`;
  let font = roleFonts.get(key);
  if (!font) {
    const generation = designerGeneration, loaded: { family: string; face?: FontFace } = { family: `SurdetDesigner${role[0]!.toUpperCase()}${role.slice(1)}Font${generation}` };
    roleFonts.set(key, font = loaded);
    void (async () => {
      const segments = path.split('/'), filename = segments.pop()!;
      let directory = projectRoot;
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
      const bytes = await (await (await directory.getFileHandle(filename)).getFile()).arrayBuffer();
      if (generation !== designerGeneration || state.dirHandle !== projectRoot) return;
      const face = await new FontFace(loaded.family, bytes, { weight: '400' }).load();
      if (generation !== designerGeneration || roleFonts.get(key) !== loaded) return;
      loaded.face = face; document.fonts.add(face);
    })().catch(error => {
      if (generation === designerGeneration) onError(`画布无法加载${role === 'title' ? '标题' : role === 'body' ? '正文' : '界面'}字体 ${path}：${error instanceof Error ? error.message : String(error)}`);
    });
  }
  return `"${font.family}", ${fallback}`;
}

const cqw = (px: number): string => `${px / 1280 * 100}cqw`;
/** Core's effective value of a control in one interaction state, as the Player draws it. */
function interactionStyle(node: ProjectUiNode, config: Record<string, unknown>, interaction: ProjectUiInteraction): ReturnType<typeof effectiveUiStyle> {
  try { return resolveProjectUiInteractionStyle(node, config, interaction); } catch { return resolveProjectUiInteractionStyle(node, {}, interaction); }
}

const MOTION_NAMES: Record<UiMotionDirection, string> = { enter: '进场', exit: '退场' };
const EASING_NAMES: Record<NonNullable<ProjectUiMotion['easing']>, string> = { 'ease-out': '先快后慢（默认）', linear: '匀速', 'ease-in-out': '慢—快—慢' };

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
  container: '容器', image: '图片', text: '文本', button: '按钮', toggle: '开关', slider: '滑条', progress: '只读数值条',
  input: '输入框', scroll: '滚动列表', tabs: '页签', content: '公共内容',
};
const DATA_FIELDS: Record<string, string> = {
  id: '标识', label: '名称', description: '说明', value: '当前值', date: '日期',
  speaker: '说话人', dialogue: '台词', title: '标题', subtitle: '副标题', mode: '存读档模式', 'ending-progress': '结局收集进度', 'profile-progress': '人物资料收集进度', 'term-progress': '词条收集进度',
};
const SETTING_NAMES: Record<string, string> = SETTING_LABELS;
const SOURCE_NAMES: Record<NonNullable<ProjectUiNode['source']>, string> = {
  'save-slots': '存档列表', settings: '阅读设置', backlog: '文字记录', choices: '剧情选项',
  'gallery-cgs': '图片鉴赏', 'gallery-music': '音乐鉴赏', 'gallery-texts': '剧情回想', 'gallery-endings': '结局册', 'gallery-profiles': '人物档案', 'gallery-terms': '用语辞典',
  terms: '名词表',
};
const ACTION_NAMES: Record<NonNullable<ProjectUiNode['action']>['kind'], string> = {
  start: '开始游戏', continue: '继续游戏', open: '打开页面', back: '返回', close: '关闭',
  save: '保存进度', load: '读取进度', choice: '选择选项', 'gallery-item': '打开鉴赏条目',
  'setting-step': '调整阅读设置', advance: '继续阅读', rollback: '回退一句',
  auto: '自动播放', skip: '快进', hide: '隐藏界面', 'variable-set': '修改剧情变量',
};
const DESIGN_FRAME: ProjectUiRect = { x: 0, y: 0, width: 1280, height: 720 };
function intersectPreviewRect(a: ProjectUiRect, b: ProjectUiRect): ProjectUiRect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}
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
  const rect = projectUiChildrenRect(projectUiRect(parentRect, root.frame), root.type, root.style);
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

function availableVariables(type?: string, includeReadonly = false): string[] {
  const config = parseProjectConfigDocument(state.gameConfigText || '{}');
  const variables = typeof config.variables === 'object' && config.variables !== null && !Array.isArray(config.variables)
    ? config.variables as Record<string, unknown> : {};
  return Object.entries(variables).flatMap(([name, raw]) => {
    const declaration = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return (!includeReadonly && declaration.readonly === true) || (type === 'scalar' ? !['number', 'string', 'flag', 'boolean'].includes(String(declaration.type))
      : type && declaration.type !== type && !(type === 'flag' && declaration.type === 'boolean')) ? [] : [name];
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
  if (type === 'progress') {
    const name = availableVariables('number', true)[0];
    if (!name) throw new Error('只读数值条需要先声明一个数值变量。');
    node.binding = { kind: 'variable', name }; node.text = { kind: 'literal', value: '状态' }; node.frame.height = 24;
  }
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
  const label = node.text?.kind === 'literal' ? node.text.value
    : node.text?.kind === 'data' ? DATA_FIELDS[node.text.field]
      : node.text?.kind === 'setting' ? SETTING_NAMES[node.text.name] : undefined;
  return `${TYPE_NAMES[node.type]} · ${label || node.id}`;
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
    button.title = `组件标识：${node.id}`;
    button.type = 'button'; button.dataset.uiNode = node.id;
    button.style.paddingLeft = `${12 + depth * 16}px`;
    button.setAttribute('aria-current', String(selectedNodeId === node.id));
    button.onclick = () => { selectedNodeId = node.id; draw(); };
    parent.appendChild(button);
    node.children?.forEach(child => drawTree(parent, child, depth + 1));
  }

  /** `onSurface`: an ancestor paints a project surface (fill or image) under this node, as the Player does. */
  function drawCanvas(canvas: HTMLElement, node: ProjectUiNode, parentRect: ProjectUiRect, config: Record<string, unknown>, onSurface = false, clipRect = DESIGN_FRAME): void {
    const rect = projectUiRect(parentRect, node.frame);
    const item = element('div', `ui-canvas-node ui-canvas-${node.type}`, node.text?.kind === 'literal' ? node.text.value : node.type === 'container' || node.type === 'tabs' ? '' : TYPE_NAMES[node.type]);
    item.dataset.uiNode = node.id;
    item.dataset.selected = String(selectedNodeId === node.id);
    item.style.left = `${rect.x / 1280 * 100}%`;
    item.style.top = `${rect.y / 720 * 100}%`;
    item.style.width = `${rect.width / 1280 * 100}%`;
    item.style.height = `${rect.height / 720 * 100}%`;
    const style = node.style;
    // U2: a control with interaction states draws through the decoration layer, as in the Player; the selected control
    // shows the state chosen in the inspector (that state alone over the normal style, Core's merge and 0.45 included).
    // A control previewing a state draws as the Player draws a control with states, even before its first state is set.
    const shownState = isUiStateNode(node) && selectedNodeId === node.id && selectedState !== 'normal' ? selectedState : null;
    const stateful = isUiStateNode(node) && (node.states !== undefined || shownState !== null);
    const interaction: ProjectUiInteraction | null = stateful
      ? { hovered: shownState === 'hover', focused: shownState === 'focus', pressed: shownState === 'pressed', disabled: shownState === 'disabled' } : null;
    const look: ProjectUiStyle | undefined = shownState ? { ...style, ...node.states?.[shownState] } : style;
    if (shownState) item.dataset.uiPreviewState = shownState;
    if (style?.color !== undefined) item.style.color = `#${style.color.toString(16).padStart(6, '0')}`;
    if (style?.background !== undefined) item.style.backgroundColor = `#${style.background.toString(16).padStart(6, '0')}`;
    // Inherited size comes from the work's theme (Core), the same value the Player draws.
    const inherited = effectiveUiStyle(node, config);
    // The role font the Player uses for this node, so wrapping and clipping match on the canvas.
    item.style.fontFamily = roleFontFamily(inherited.fontRole, config, message => options.onStatus(message, false));
    item.style.fontSize = cqw(style?.fontSize ?? inherited.fontSize);
    item.style.textAlign = style?.align ?? 'left';
    item.style.opacity = String(style?.opacity ?? 1);
    // U1 box fields: the same Core values and decoration layer as the Player, scaled to the canvas.
    const boxed = stateful || usesProjectUiBox(style);
    let decor: HTMLDivElement | null = null, focusRing: HTMLSpanElement | null = null;
    const placeFocusRing = (outer: ProjectUiRect): void => {
      if (!focusRing) return;
      const visible = intersectPreviewRect(outer, clipRect);
      focusRing.hidden = visible.width <= 0 || visible.height <= 0;
      focusRing.style.left = `${visible.x / 1280 * 100}%`; focusRing.style.top = `${visible.y / 720 * 100}%`;
      focusRing.style.width = `${visible.width / 1280 * 100}%`; focusRing.style.height = `${visible.height / 720 * 100}%`;
    };
    let surface = onSurface || (style?.background !== undefined && !boxed);
    if (boxed) {
      try {
        const effective = interaction ? interactionStyle(node, config, interaction) : inherited, content = projectUiContentRect(rect, style);
        // Images the author chose (normal style or any state) are reported when missing; only the theme skin stays silent.
        const explicit = new Set([style, ...Object.values(node.states ?? {})].flatMap(item => item?.backgroundImage ? [item.backgroundImage.asset] : []));
        if (stateful) {
          item.style.color = `#${effective.color.toString(16).padStart(6, '0')}`;
          item.style.opacity = String(effective.opacity);
        }
        decor = createProjectUiDecor(effective, rect, {
          unit: cqw,
          // An inherited theme button skin that is missing stays silent, as in the Player.
          image: asset => explicit.has(asset) ? styleImage(asset) : styleImage(asset).catch(() => null),
          onError: error => { if (decor?.isConnected) options.onStatus(`${nodeLabel(node)} 的背景无法绘制：${error instanceof Error ? error.message : String(error)}`, false); },
        });
        decor.className = 'ui-canvas-decor';
        for (const [key, value] of [['left', rect.x / 1280], ['top', rect.y / 720], ['width', rect.width / 1280], ['height', rect.height / 720]] as const) decor.style[key] = `${value * 100}%`;
        decor.style.opacity = item.style.opacity;
        // An input keeps its native field box in the Player unless the author replaces its fill; show that field
        // inside the content box, as the Player does, instead of hiding it.
        if (node.type === 'input' && look?.background === undefined && !look?.backgroundGradient && !look?.backgroundImage) item.style.backgroundClip = 'content-box';
        else item.style.background = 'transparent';
        item.style.borderRadius = cqw(effective.borderRadius);
        item.style.padding = projectUiInsetCss(rect, content, cqw);
        if ((effective.background !== null || effective.backgroundGradient || effective.backgroundImage) && effective.backgroundOpacity > 0) surface = true;
      } catch (error) { options.onStatus(`${nodeLabel(node)} 的样式无法绘制：${error instanceof Error ? error.message : String(error)}`, false); }
    } else if (node.type === 'button' && inherited.backgroundImage) {
      // A button without box fields still inherits the theme button skin, stretched like the Player's legacy path;
      // a missing inherited skin stays silent there too.
      const skin = inherited.backgroundImage.asset;
      void styleImage(skin).then(image => { item.style.backgroundImage = `url(${JSON.stringify(image.url)})`; item.style.backgroundSize = '100% 100%'; }).catch(() => undefined);
      surface = true;
    }
    // Over a surface the work paints itself, text takes the Player's colour (Core's effective value: own colour or
    // the theme text colour); over the bare canvas it keeps the Editor's readable default.
    if (style?.color === undefined && surface && !stateful) item.style.color = `#${inherited.color.toString(16).padStart(6, '0')}`;
    if (node.type === 'text' || node.type === 'button' || node.type === 'input' || (node.type === 'content' && !node.children?.length)) {
      // Core's effective line height (text 1.45, otherwise the native `normal`), not the Editor panel's, so wrapping
      // and the label's vertical position match the Player.
      item.style.lineHeight = inherited.lineHeight === null ? 'normal' : String(inherited.lineHeight);
      applyProjectUiTypography(item, look, cqw);
      // Buttons inherit the theme's button weight in the Player; show the same weight here.
      if (node.type === 'button' && style?.fontWeight === undefined && inherited.fontWeight !== null) item.style.fontWeight = String(inherited.fontWeight);
    }
    if (node.type === 'image') {
      item.textContent = '';
      const source = state.dirAssets.find(asset => asset.kind === 'bg' && asset.key === node.asset);
      const picture = element('div', 'ui-canvas-image'); item.appendChild(picture);
      void activeImages?.image(picture, source, node.asset ?? '项目图片', style?.imageFit ?? 'contain');
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
        if (decor) { decor.style.transform = item.style.transform; decor.style.width = item.style.width; decor.style.height = item.style.height; }
        placeFocusRing(resize ? { ...rect, width: Math.max(8, initial.width + dx), height: Math.max(8, initial.height + dy) }
          : { ...rect, x: rect.x + dx, y: rect.y + dy });
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
    if (shownState === 'focus') {
      // The Player's own keyboard focus marker (accent ring over a panel-coloured ring), drawn outside the node's style.
      const theme = (() => { try { return resolvePlayerTheme(config); } catch { return resolvePlayerTheme({}); } })();
      const ring = focusRing = element('span');
      ring.dataset.uiFocusPreview = 'true';
      ring.setAttribute('aria-hidden', 'true');
      ring.style.cssText = `position:absolute;pointer-events:none;z-index:2;border-radius:${item.style.borderRadius};outline:${cqw(2)} solid #${theme.colors.accent.toString(16).padStart(6, '0')};outline-offset:${cqw(2)};box-shadow:0 0 0 ${cqw(2)} #${theme.colors.panel.toString(16).padStart(6, '0')}`;
      placeFocusRing(rect);
    }
    if (stateful && decor) {
      // Match the Player's compositing: author opacity applies once to the whole
      // control, while its focus preview stays outside that transparent group.
      const group = element('div'); group.dataset.uiCanvasGroup = node.id;
      group.style.cssText = `position:absolute;inset:0;pointer-events:none;opacity:${item.style.opacity}`;
      item.style.opacity = '1'; decor.style.opacity = '1'; item.style.pointerEvents = 'auto';
      group.append(decor, item); canvas.appendChild(group);
    } else {
      if (decor) canvas.appendChild(decor);
      canvas.appendChild(item);
    }
    if (focusRing) canvas.appendChild(focusRing);
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
    const childClip = node.type === 'scroll' || node.type === 'content' || (boxed && (node.type === 'container' || node.type === 'tabs'))
      ? intersectPreviewRect(clipRect, projectUiContentRect(rect, style)) : clipRect;
    children.forEach(child => drawCanvas(canvas, child, projectUiChildrenRect(rect, node.type, node.style), config, surface, childClip));
  }

  /** U2: 正常 / 悬停 / 焦点 / 按下 / 禁用 for the selected control; switching only changes what the form edits and the canvas shows. */
  function drawStates(parent: HTMLElement, node: ProjectUiNode, editing: UiStateName | null): void {
    const wrap = element('div', 'ui-property-actions');
    wrap.dataset.uiStyleKey = 'state';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', '交互状态');
    wrap.appendChild(element('span', '', '交互状态'));
    for (const name of ['normal', ...UI_STATE_NAMES] as const) {
      const set = name !== 'normal' && node.states?.[name] !== undefined;
      const button = element('button', '', `${name === 'normal' ? '正常' : UI_STATE_LABELS[name]}${set ? ' •' : ''}`);
      button.type = 'button';
      button.dataset.uiStyleControl = `state:${name}`;
      button.setAttribute('aria-pressed', String((editing ?? 'normal') === name));
      if (set) button.title = '此状态已有样式';
      button.onclick = () => { selectedState = name; styleFocus = `state:${name}`; draw(); };
      wrap.appendChild(button);
    }
    parent.appendChild(wrap);
    const hint = element('p', 'ui-style-hint', editing
      ? '画布显示这个状态单独叠加在正常样式上的效果。玩家同时满足多个状态时按 悬停 → 焦点 → 按下 → 禁用 依次叠加；禁用时悬停和按下不生效。键盘焦点另有播放器焦点框，不受这里的样式影响。'
      : '选择一个状态后，只为它填写与正常状态不同的颜色、背景、阴影或不透明度。');
    parent.appendChild(hint);
    if (editing && node.states?.[editing]) {
      const clear = element('button', '', `清空${UI_STATE_LABELS[editing]}样式`); clear.type = 'button';
      clear.dataset.uiStyleControl = `state:${editing}:clear`;
      clear.onclick = () => { styleFocus = `state:${editing}`; apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { states: withUiState(node.states, editing, null) } }); };
      parent.appendChild(clear);
    }
  }

  /** U2: the page root's enter/exit fields, plus a one-off canvas preview that moves only the canvas. */
  function drawMotion(parent: HTMLElement, node: ProjectUiNode): void {
    const section = element('details', 'ui-style-group');
    section.dataset.uiStyleGroup = 'motion';
    section.dataset.uiStyleKey = 'transition';
    section.open = openStyleGroups.has('motion');
    section.ontoggle = () => { if (section.open) openStyleGroups.add('motion'); else openStyleGroups.delete('motion'); };
    section.appendChild(element('summary', '', '页面进出场'));
    const commit = (direction: UiMotionDirection, motion: ProjectUiMotion | null, control: string): void => {
      styleFocus = control;
      apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { transition: withUiMotion(node.transition, direction, motion) } });
    };
    for (const direction of ['enter', 'exit'] as const) {
      const motion = node.transition?.[direction];
      const block = element('div', 'ui-style-field');
      block.dataset.uiStyleKey = `transition.${direction}`;
      const head = element('label', 'ui-style-check');
      const enabled = element('input'); enabled.type = 'checkbox'; enabled.checked = motion !== undefined;
      enabled.dataset.uiStyleControl = `transition.${direction}.enabled`;
      enabled.onchange = () => commit(direction, enabled.checked ? { ...UI_MOTION_DEFAULTS[direction] } : null, `transition.${direction}.enabled`);
      head.append(enabled, document.createTextNode(`${MOTION_NAMES[direction]}动画`));
      block.appendChild(head);
      if (motion) {
        const update = (patch: Partial<ProjectUiMotion>, control: string): void => {
          const next: Record<string, unknown> = { ...motion, ...patch };
          for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key];
          commit(direction, next as unknown as ProjectUiMotion, control);
        };
        const number = (key: 'durationMs' | 'opacity' | 'x' | 'y' | 'scale', label: string, limits: { min: number; max: number; step: number; unit: string; scale?: number }, fallback: number): void => {
          const scale = limits.scale ?? 1, control = `transition.${direction}.${key}`;
          const input = element('input'); input.type = 'number';
          input.min = String(limits.min * scale); input.max = String(limits.max * scale); input.step = String(limits.step);
          const value = motion[key];
          if (value !== undefined) input.value = String(Math.round(value * scale * 1000) / 1000);
          input.placeholder = String(Math.round(fallback * scale * 1000) / 1000);
          input.dataset.uiStyleControl = control;
          const name = `${MOTION_NAMES[direction]}${label}（${limits.unit}）`;
          input.setAttribute('aria-label', name);
          // Typing outside the contract range is pulled back into it; an empty optional field returns to its default.
          input.onchange = () => {
            const raw = input.value.trim();
            const parsed = raw === '' || !Number.isFinite(Number(raw)) ? null : Math.max(limits.min, Math.min(limits.max, Number(raw) / scale));
            update({ [key]: parsed === null ? (key === 'durationMs' ? fallback : undefined) : key === 'durationMs' ? Math.round(parsed) : parsed }, control);
          };
          const wrap = element('label', 'ui-style-input', name); wrap.appendChild(input); block.appendChild(wrap);
        };
        number('durationMs', '时长', { min: 0, max: 1000, step: 10, unit: '毫秒' }, UI_MOTION_DEFAULTS[direction].durationMs);
        number('opacity', direction === 'enter' ? '起始不透明度' : '结束不透明度', { min: 0, max: 1, step: 5, unit: '%', scale: 100 }, 1);
        number('x', direction === 'enter' ? '起始横向偏移' : '结束横向偏移', { min: -128, max: 128, step: 1, unit: '像素' }, 0);
        number('y', direction === 'enter' ? '起始纵向偏移' : '结束纵向偏移', { min: -128, max: 128, step: 1, unit: '像素' }, 0);
        number('scale', direction === 'enter' ? '起始缩放' : '结束缩放', { min: 0.8, max: 1.2, step: 1, unit: '%', scale: 100 }, 1);
        const easing = element('select');
        for (const [value, label] of Object.entries(EASING_NAMES)) easing.appendChild(option(value, label));
        easing.value = motion.easing ?? 'ease-out';
        easing.dataset.uiStyleControl = `transition.${direction}.easing`;
        easing.setAttribute('aria-label', `${MOTION_NAMES[direction]}节奏`);
        easing.onchange = () => update({ easing: easing.value === 'ease-out' && motion.easing === undefined ? undefined : easing.value as 'linear' }, `transition.${direction}.easing`);
        const wrap = element('label', 'ui-style-input', `${MOTION_NAMES[direction]}节奏`); wrap.appendChild(easing); block.appendChild(wrap);
        if (motion.durationMs === 0) block.appendChild(element('p', 'ui-style-hint', '时长为 0 时直接显示，不播放动画。'));
        const play = element('button', '', `预览${MOTION_NAMES[direction]}`); play.type = 'button';
        play.dataset.uiStyleControl = `transition.${direction}.preview`;
        play.onclick = () => previewMotion(node, direction);
        block.appendChild(play);
      }
      section.appendChild(block);
    }
    const stop = element('button', '', '停止预览'); stop.type = 'button';
    stop.dataset.uiStyleControl = 'transition.stop';
    stop.dataset.uiMotionStop = 'true';
    stop.disabled = motionPreview === null;
    stop.onclick = () => { stopMotionPreview(); };
    section.appendChild(stop);
    section.appendChild(element('p', 'ui-style-hint', '进出场只是画面表现：页面打开时立刻可以操作，关闭时立刻交还操作；玩家开启「减少动态」后直接显示。预览只移动设计画布一次，不保存、不触发任何按钮；在「试玩草稿」中可看到真实播放器效果。'));
    parent.appendChild(section);
  }

  /**
   * Plays one direction once on the canvas with the Player's own motion driver and easing, then returns the canvas to
   * its normal pose. Any redraw, page switch, closing the designer or 停止预览 ends it.
   */
  function previewMotion(node: ProjectUiNode, direction: UiMotionDirection): void {
    stopMotionPreview();
    const resolved = resolveProjectUiMotion(node, direction, false);
    const layer = body.querySelector<HTMLElement>('[data-ui-canvas-page]');
    if (!resolved || !layer) { options.onStatus(`${MOTION_NAMES[direction]}时长为 0，页面会直接显示。`); return; }
    const controller = new ProjectUiMotionController();
    const paint = (pose: ProjectUiMotionPose): void => {
      layer.style.opacity = pose.opacity === 1 ? '' : String(pose.opacity);
      layer.style.transform = pose.x === 0 && pose.y === 0 && pose.scale === 1 ? '' : `translate(${cqw(pose.x)}, ${cqw(pose.y)}) scale(${pose.scale})`;
    };
    const preview = { controller, frame: 0, stop: () => { window.cancelAnimationFrame(preview.frame); controller.dispose(); paint({ opacity: 1, x: 0, y: 0, scale: 1 }); layer.dataset.uiMotionPreview = ''; delete layer.dataset.uiMotionPreview; syncStop(); } };
    const syncStop = (): void => { const stop = body.querySelector<HTMLButtonElement>('[data-ui-motion-stop]'); if (stop) stop.disabled = motionPreview === null; };
    motionPreview = preview;
    layer.dataset.uiMotionPreview = direction;
    controller.play('designer-preview', resolved, direction, paint, () => { if (motionPreview === preview) stopMotionPreview(); });
    syncStop();
    let last = performance.now();
    const tick = (now: number): void => {
      if (motionPreview !== preview) return;
      if (!layer.isConnected) { stopMotionPreview(); return; }
      controller.update(now - last); last = now;
      if (motionPreview === preview) preview.frame = window.requestAnimationFrame(tick);
    };
    preview.frame = window.requestAnimationFrame(tick);
  }

  function drawProperties(parent: HTMLElement, rootNode: ProjectUiNode, config: Record<string, unknown>): void {
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
    for (const [key, title] of [['visibleWhen', '显示条件'], ['enabledWhen', '可操作条件']] as const) {
      if (key === 'enabledWhen' && !['button', 'toggle', 'slider', 'input'].includes(node.type)) continue;
      const label = element('label', 'ui-property-line', title), input = element('input');
      input.value = node[key] ?? ''; input.placeholder = '留空为始终；例如 好感 >= 10'; input.setAttribute('aria-label', title);
      input.onchange = () => apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { [key]: input.value.trim() || null } });
      label.appendChild(input); parent.appendChild(label);
    }
    const align = element('div', 'ui-property-actions');
    for (const [label, axis] of [['水平居中', 'x'], ['垂直居中', 'y']] as const) {
      const button = element('button', '', label);
      button.onclick = () => apply({ type: 'node.update', page: selectedPage, id: node.id,
        patch: { frame: { ...node.frame, [axis]: (axis === 'x' ? (parentRect.width - node.frame.width) / 2 + (node.frame.anchorX ?? 0) * node.frame.width
          : (parentRect.height - node.frame.height) / 2 + (node.frame.anchorY ?? 0) * node.frame.height) } } });
      align.appendChild(button);
    }
    parent.appendChild(align);
    if (parentId === null) drawMotion(parent, node);
    const interactive = isUiStateNode(node);
    const editing: UiStateName | null = interactive && selectedState !== 'normal' ? selectedState : null;
    if (interactive) drawStates(parent, node, editing);
    parent.appendChild(renderUiStyleForm({
      node, config, assets: availableAssets(), open: openStyleGroups, ...(editing ? { state: editing } : {}),
      onToggle: (group, open) => { if (open) openStyleGroups.add(group); else openStyleGroups.delete(group); },
      apply: (style, control) => {
        styleFocus = control;
        apply({ type: 'node.update', page: selectedPage, id: node.id, patch: editing ? { states: withUiState(node.states, editing, style) } : { style } });
      },
    }));
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
        const value = kind.value === 'data' ? (selectedPage === 'dialogue' ? 'dialogue' : selectedPage === 'title' ? 'title' : 'label') : kind.value === 'variable' ? availableVariables(undefined, true)[0] ?? '' : kind.value === 'setting' ? 'textSpeedCps' : '';
        const text = kind.value === 'literal' ? { kind: 'literal' as const, value }
          : kind.value === 'data' ? { kind: 'data' as const, field: value as 'label' }
          : { kind: kind.value as 'variable' | 'setting', name: value };
        apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { text } });
      };
      textInput.onchange = changeText;
      const text = element('label', 'ui-property-line', '文字 / 数据来源'); text.append(kind, textInput); parent.appendChild(text);
      if (node.text.kind === 'variable') {
        const format = element('select'); format.setAttribute('aria-label', '数组显示方式');
        format.append(option('', '原值'), option('list', '列表'), option('count', '数量')); format.value = node.text.format ?? '';
        const binding = node.text;
        format.onchange = () => apply({ type: 'node.update', page: selectedPage, id: node.id,
          patch: { text: { kind: 'variable', name: binding.name, ...(format.value ? { format: format.value as 'list' | 'count' } : {}) } } });
        const label = element('label', 'ui-property-line', '数组显示方式'); label.appendChild(format); parent.appendChild(label);
      }
    }
    if (node.asset !== undefined) {
      const select = element('select');
      availableAssets().forEach(asset => select.appendChild(option(asset, asset)));
      select.value = node.asset;
      select.onchange = () => apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { asset: select.value } });
      const label = element('label', 'ui-property-line', '项目图片'); label.appendChild(select); parent.appendChild(label);
    }
    if (node.binding) {
      const bindingKind = element('select'); bindingKind.setAttribute('aria-label', '控件值来源'); bindingKind.append(option('variable', '剧情变量'));
      if (node.type !== 'input' && node.type !== 'progress') bindingKind.append(option('setting', '设置'));
      bindingKind.value = node.binding.kind;
      const name = element('select'); name.setAttribute('aria-label', '控件绑定项');
      const renderNames = (): void => {
        name.replaceChildren();
        const names: string[] = bindingKind.value === 'setting' ? bindableSettings(node.type === 'toggle' ? 'toggle' : 'slider')
          : availableVariables(node.type === 'input' ? 'string' : node.type === 'slider' || node.type === 'progress' ? 'number' : 'flag', node.type === 'progress');
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
      const arg = node.action?.kind === 'open' || node.action?.kind === 'setting-step' || node.action?.kind === 'variable-set' ? element('select') : element('input');
      if (arg instanceof HTMLSelectElement) {
        const names = node.action?.kind === 'variable-set' ? Object.fromEntries(availableVariables('scalar').map(name => [name, name])) : node.action?.kind === 'open'
          ? Object.fromEntries(['system-menu', 'save-load', 'settings', 'gallery', 'backlog'].map(page => [page, PAGE_NAMES[page as ProjectUiPageId]]))
          : Object.fromEntries(steppableSettings().map(name => [name, SETTING_NAMES[name]!]));
        Object.entries(names).forEach(([value, label]) => arg.appendChild(option(value, label)));
        const current = node.action?.kind === 'open' ? node.action.page : node.action?.kind === 'setting-step' || node.action?.kind === 'variable-set' ? node.action.name : '';
        if (!(current in names)) arg.appendChild(option(current, current));
      } else arg.placeholder = '槽位或条目标识（留空使用当前项）';
      arg.setAttribute('aria-label', '操作目标');
      arg.value = node.action?.kind === 'open' ? node.action.page : 'id' in (node.action ?? {}) ? String((node.action as { id?: string }).id ?? '') : node.action?.kind === 'setting-step' || node.action?.kind === 'variable-set' ? node.action.name : '';
      let assignment: HTMLInputElement | HTMLSelectElement | null = null;
      if (node.action?.kind === 'variable-set') {
        const value = node.action.value;
        assignment = typeof value === 'boolean' ? element('select') : element('input');
        assignment.setAttribute('aria-label', '赋值内容');
        if (assignment instanceof HTMLSelectElement) assignment.append(option('true', '开启'), option('false', '关闭'));
        else assignment.type = typeof value === 'number' ? 'number' : 'text';
        assignment.value = String(value);
      }
      const mode = element('select'); mode.setAttribute('aria-label', '存读档模式');
      mode.append(option('save', '存档'), option('load', '读档'));
      mode.value = node.action?.kind === 'open' ? node.action.mode ?? 'load' : 'load';
      mode.hidden = node.action?.kind !== 'open' || node.action.page !== 'save-load';
      const direction = element('select'); direction.setAttribute('aria-label', '设置调整方向');
      direction.append(option('1', '增加'), option('-1', '减少'));
      direction.value = String(node.action?.kind === 'setting-step' ? node.action.direction : 1);
      direction.hidden = node.action?.kind !== 'setting-step' || isSwitchSetting(node.action.name);
      const update = (value = arg.value, editAssignment = false): void => {
        const kind = select.value;
        const variables = parseProjectConfigDocument(state.gameConfigText || '{}').variables as Record<string, { type: string; initial: string | number | boolean }> | undefined;
        const assigned = variables?.[value];
        if (kind === 'variable-set' && !assigned) { options.onStatus('先声明一个可写数值、文字或开关变量，再选择赋值按钮。', false); draw(); return; }
        const action = kind === 'variable-set' ? { kind: 'variable-set' as const, name: value,
          value: editAssignment && assignment ? (['flag', 'boolean'].includes(assigned!.type) ? assignment.value === 'true' : assigned!.type === 'number' ? Number(assignment.value) : assignment.value)
            : node.action?.kind === 'variable-set' && node.action.name === value ? node.action.value : assigned!.initial }
          : kind === 'open' ? { kind: 'open' as const, page: (value || 'settings') as 'settings', ...(value === 'save-load' ? { mode: mode.value as 'save' | 'load' } : {}) }
          : kind === 'setting-step' ? { kind: 'setting-step' as const, name: value || 'textSpeedCps', direction: Number(direction.value) as -1 | 1 }
          : ['save', 'load', 'choice', 'gallery-item'].includes(kind) ? { kind: kind as 'save', ...(value ? { id: value } : {}) }
          : { kind: kind as 'start' };
        apply({ type: 'node.update', page: selectedPage, id: node.id, patch: { action } });
      };
      select.onchange = () => update(select.value === 'variable-set' ? availableVariables('scalar')[0] ?? '' : select.value === 'open' ? 'settings' : select.value === 'setting-step' ? 'textSpeedCps' : '');
      arg.onchange = () => update();
      mode.onchange = () => update(); direction.onchange = () => update();
      const label = element('label', 'ui-property-line', '点击操作'); label.append(select, arg, mode, direction); parent.appendChild(label);
      if (assignment) { assignment.onchange = () => update(arg.value, true); const label = element('label', 'ui-property-line', '赋值内容'); label.appendChild(assignment); parent.appendChild(label); }
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
    stopMotionPreview();
    activeImages?.dispose(); activeImages = new ImageScope();
    body.replaceChildren();
    let config: Record<string, unknown> = {};
    try { config = parseProjectConfigDocument(state.gameConfigText || '{}'); } catch { /* invalid config is reported by project validation */ }
    const ui = options.read();
    const pageRoot = ui?.pages[selectedPage];
    if (selectedNodeId && pageRoot && !findNode(pageRoot, selectedNodeId)) selectedNodeId = null;
    // The state being edited belongs to one control: choosing another control (or none) returns to 正常.
    const stateOwner = selectedNodeId === null ? null : `${selectedPage}/${selectedNodeId}`;
    if (stateOwner !== selectedStateOwner) { selectedState = 'normal'; selectedStateOwner = stateOwner; }
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
    // The page's nodes sit in one layer covering the canvas, so a motion preview moves the page as the Player does.
    const pageLayer = element('div'); pageLayer.dataset.uiCanvasPage = selectedPage;
    pageLayer.style.cssText = 'position:absolute;inset:0';
    if (pageRoot) { canvas.appendChild(pageLayer); drawCanvas(pageLayer, pageRoot, DESIGN_FRAME, config); }
    else canvas.appendChild(element('p', 'ui-empty', '添加页面后可在画布选择与拖动组件。'));
    center.appendChild(canvas);
    const properties = element('aside', 'ui-designer-properties'); properties.appendChild(element('h3', '', '属性'));
    if (pageRoot) drawProperties(properties, pageRoot, config);
    else properties.appendChild(element('p', 'ui-empty', '此页尚未启用自定义布局。'));
    body.append(tree, center, properties);
    if (styleFocus) {
      // Each edit redraws the panel; keep keyboard focus on the style control that was just used.
      const control = styleFocus, key = control.split(/[:.]/)[0]!;
      styleFocus = null;
      (properties.querySelector<HTMLElement>(`[data-ui-style-control="${CSS.escape(control)}"]:not(:disabled)`)
        ?? properties.querySelector<HTMLElement>(`[data-ui-style-key="${CSS.escape(key)}"] [data-ui-style-control]:not(:disabled)`))?.focus();
    }
  }

  draw();
  return root;
}
