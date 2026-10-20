import { GAME_SETTING_DEFINITIONS, resolvePlayerTheme, type ProjectFontRole, type ProjectUiDocument, type ProjectUiPageId } from '@surdet/core';
import { DEFAULT_RENDERER_FONT_FAMILIES, ProjectUiMotionController, SETTING_STEPS, createProjectUiDom, type ProjectUiContext, type ProjectUiDom } from '@surdet/renderer';
import { uiPreviewSampleContent, uiPreviewVariableValue } from './ui-share-import-model.js';

/**
 * Read-only page view of an import proposal, inside the `ui-preview.html` frame: the Player's
 * own work-UI layer (`createProjectUiDom`) with sample content. No game, save, setting or
 * project write exists here; every action only reports that the preview does not run it.
 */
export interface UiPagePreviewView { page: ProjectUiPageId; mode?: 'save' | 'load'; empty: boolean; reducedMotion: boolean }
export interface UiPagePreviewLoad {
  type: 'surdet-ui-page-preview-load';
  config: Record<string, unknown>;
  ui: ProjectUiDocument;
  /** Image asset key → temporary URL owned by the opener. */
  images: Record<string, string>;
  titleBackground?: string;
  fonts: Partial<Record<ProjectFontRole, string>>;
  view: UiPagePreviewView;
}
export interface UiPagePreviewShow { type: 'surdet-ui-page-preview-show'; view: UiPagePreviewView; replay?: boolean }

const STORY_PAGES = new Set<ProjectUiPageId>(['dialogue', 'choices', 'toolbar', 'hud']);
const ACTION_NAMES: Record<string, string> = {
  start: '开始游戏', continue: '继续游戏', open: '打开页面', back: '返回', close: '关闭', save: '保存进度', load: '读取进度',
  choice: '选择选项', 'gallery-item': '打开鉴赏条目', 'setting-step': '调整设置', advance: '继续阅读', rollback: '回退',
  auto: '自动播放', skip: '快进', hide: '隐藏界面', 'variable-set': '修改剧情变量',
};

export async function startUiPagePreview(data: UiPagePreviewLoad, signal: AbortSignal, note: (message: string, ok?: boolean) => void): Promise<(message: UiPagePreviewShow) => void> {
  const app = document.getElementById('app') ?? document.body;
  app.replaceChildren();
  app.style.cssText = 'position:relative;width:100vw;height:100vh;overflow:hidden';
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  canvas.style.cssText = 'position:absolute;display:block';
  app.appendChild(canvas);
  const place = (): void => {
    const width = Math.min(innerWidth, innerHeight * 16 / 9), height = width * 9 / 16;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    canvas.style.left = `${(innerWidth - width) / 2}px`; canvas.style.top = `${(innerHeight - height) / 2}px`;
  };
  place(); addEventListener('resize', place);
  const paintStage = (story: boolean): void => {
    const context = canvas.getContext('2d');
    if (!context) return;
    const gradient = context.createLinearGradient(0, 0, 0, 720);
    gradient.addColorStop(0, story ? '#33475b' : '#151c24'); gradient.addColorStop(1, story ? '#141b22' : '#0c1015');
    context.fillStyle = gradient; context.fillRect(0, 0, 1280, 720);
    if (story) { context.fillStyle = 'rgba(255,255,255,.35)'; context.font = '24px sans-serif'; context.fillText('示例剧情画面', 40, 60); }
  };
  const faces: FontFace[] = [];
  const families: Partial<Record<ProjectFontRole, string>> = {};
  for (const [role, url] of Object.entries(data.fonts) as Array<[ProjectFontRole, string]>) {
    try {
      const face = await new FontFace(`SurdetImportPreview${role}`, `url(${JSON.stringify(url)})`).load();
      if (signal.aborted) return () => undefined;
      document.fonts.add(face); faces.push(face); families[role] = face.family;
    } catch (error) { note(`预览无法加载${role === 'title' ? '标题' : role === 'body' ? '正文' : '界面'}字体：${error instanceof Error ? error.message : String(error)}`, false); }
  }
  if (signal.aborted) return () => undefined;
  const theme = resolvePlayerTheme(data.config);
  const motion = new ProjectUiMotionController();
  let frame = 0, last = performance.now();
  const tick = (now: number): void => { motion.update(now - last); last = now; frame = requestAnimationFrame(tick); };
  frame = requestAnimationFrame(tick);
  const dom: ProjectUiDom = createProjectUiDom({
    canvas, document: data.ui, theme,
    fontFamily: role => families[role] ? `"${families[role]}", ${DEFAULT_RENDERER_FONT_FAMILIES[role]}` : DEFAULT_RENDERER_FONT_FAMILIES[role],
    imageUrl: key => data.images[key],
    ...(data.titleBackground ? { titleBackgroundUrl: data.titleBackground } : {}),
    motion, reducedMotion: data.view.reducedMotion,
    onError: error => note(error instanceof Error ? error.message : String(error), false),
  });
  const player = data.config.player && typeof data.config.player === 'object' ? data.config.player as Record<string, unknown> : {};
  const variables = data.config.variables && typeof data.config.variables === 'object' ? data.config.variables as Record<string, { min?: number; max?: number }> : {};
  const readOnly = (what: string): void => note(`预览只读：未执行“${what}”，不会保存进度或改动设置。`);
  const context = (view: UiPagePreviewView): ProjectUiContext => ({
    ...(view.mode ? { mode: view.mode } : {}),
    data(field) {
      if (field === 'title') return typeof data.config.title === 'string' ? data.config.title : '';
      if (field === 'subtitle') return typeof player.subtitle === 'string' ? player.subtitle : '';
      if (field === 'mode') return view.mode ?? '';
      if (field === 'speaker') return view.empty ? '' : '林';
      if (field === 'dialogue') return view.empty ? '' : '这是导入效果预览的示例台词。预览中的按钮不会执行操作。';
      if (field === 'ending-progress') return view.empty ? '已收集 0/3 个结局' : '已收集 2/3 个结局';
      if (field === 'profile-progress') return view.empty ? '已收集 0/3 项人物资料' : '已收集 2/3 项人物资料';
      if (field === 'term-progress') return view.empty ? '已收集 0/3 个词条' : '已收集 2/3 个词条';
      return '';
    },
    read(name, kind) {
      if (kind === 'variable') return uiPreviewVariableValue(data.config, name);
      if (name === 'reducedMotion') return view.reducedMotion;
      if (name === 'dialogueOpacity') return theme.opacity.panel;
      return Object.hasOwn(GAME_SETTING_DEFINITIONS, name) ? GAME_SETTING_DEFINITIONS[name as keyof typeof GAME_SETTING_DEFINITIONS].default : undefined;
    },
    write(binding) {
      readOnly('修改数值');
      // Text fields intentionally retain native edits while focused in the Player. This
      // read-only preview must undo the visible edit as well as refusing the state write.
      const input = document.activeElement;
      if (input instanceof HTMLInputElement) {
        const value = context(view).read(binding.name, binding.kind);
        if (input.type === 'checkbox') input.checked = Boolean(value);
        else input.value = String(value ?? '');
      }
      dom.refresh();
    },
    bounds(binding) {
      if (binding.kind === 'setting') {
        const step = SETTING_STEPS.find(item => item.key === binding.name);
        return step ? { min: step.min, max: step.max, step: step.step } : { min: 0, max: 1, step: 0.1 };
      }
      return { min: variables[binding.name]?.min ?? 0, max: variables[binding.name]?.max ?? 100, step: 1 };
    },
    content: source => uiPreviewSampleContent(source, view.empty, view.mode),
    select(_source, item) { readOnly(item.label); return true; },
    action(action) { readOnly(ACTION_NAMES[action.kind] ?? action.kind); },
  });
  let shown: ProjectUiPageId | null = null;
  const show = (view: UiPagePreviewView): void => {
    if (signal.aborted) return;
    if (shown) { dom.hide(shown); dom.resetMotion(); shown = null; }
    dom.setReducedMotion(view.reducedMotion);
    paintStage(STORY_PAGES.has(view.page));
    if (!data.ui.pages[view.page]) return;
    // The Player focuses a modal page's first control on show. Here the page is switched from the
    // opener's dialog, which keeps the keyboard focus; the frame takes focus only when clicked or tabbed into.
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function noFocus(): void { /* preview switch */ };
    try { dom.show(view.page, context(view)); shown = view.page; } finally { HTMLElement.prototype.focus = focus; }
  };
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame); removeEventListener('resize', place);
    dom.dispose(); motion.dispose();
    for (const face of faces) document.fonts.delete(face);
  }, { once: true });
  show(data.view);
  return message => show(message.view);
}
