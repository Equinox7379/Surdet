import { GAME_SETTING_DEFINITIONS, PROJECT_UI_PAGES, type ProjectUiContentSource, type ProjectUiDocument, type ProjectUiNode, type ProjectUiPageId } from '@surdet/core';
import type { UiShareImportPreview } from './authoring-project-storage.js';

/**
 * Display model of the U3 import dialog. Pure functions only: everything shown here
 * is read from the backend preview (`preview.pages`, `preview.share`, `resources`);
 * nothing here decides whether an import may be applied.
 */
export const UI_SHARE_PAGE_NAMES: Record<ProjectUiPageId, string> = {
  title: '标题', 'system-menu': '系统菜单', 'save-load': '存读档', settings: '设置', gallery: '鉴赏', backlog: '文字记录',
  dialogue: '对白', choices: '选项', toolbar: '阅读工具栏', hud: '剧情信息栏',
};

const CONTAINER_TYPES = new Set(['container', 'scroll', 'tabs']);

export interface UiSharePeek { kind: 'theme' | 'fragment' | null; fragmentPage: ProjectUiPageId | null; fragmentRootId: string | null }

/** Routing only (which controls to show). Validation stays in `prepareUiShareImportDraft`. */
export function peekUiShare(text: string): UiSharePeek {
  try {
    const raw = JSON.parse(text) as { kind?: unknown; config?: { ui?: { pages?: Record<string, { id?: unknown }> } } };
    const kind = raw?.kind === 'theme' || raw?.kind === 'fragment' ? raw.kind : null;
    const pages = raw?.config?.ui?.pages && typeof raw.config.ui.pages === 'object' ? Object.keys(raw.config.ui.pages) : [];
    const page = kind === 'fragment' && pages.length === 1 && (PROJECT_UI_PAGES as readonly string[]).includes(pages[0]!) ? pages[0] as ProjectUiPageId : null;
    const id = page ? raw.config!.ui!.pages![page]?.id : null;
    return { kind, fragmentPage: page, fragmentRootId: typeof id === 'string' ? id : null };
  } catch { return { kind: null, fragmentPage: null, fragmentRootId: null }; }
}

/** One prefix per dialog session: preview and apply show and write the same component ids. */
export function newUiShareImportPrefix(): string {
  return `import_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export interface UiShareImportRequest {
  /** Designer page and container selected when the file was chosen. */
  page: ProjectUiPageId;
  containerId?: string;
}

export interface UiShareImportPlacement {
  key: 'container' | 'root' | 'replace';
  /** Present: insert at the end of that parent (`node.insert`). Omitted: replace the page root (`page.set`). */
  parentId?: string;
  label: string;
  detail: string;
}

function findNode(root: ProjectUiNode | undefined, id: string): ProjectUiNode | undefined {
  if (!root) return undefined;
  if (root.id === id) return root;
  for (const child of root.children ?? []) { const found = findNode(child, id); if (found) return found; }
  return undefined;
}

export function uiNodeName(node: ProjectUiNode): string {
  const text = node.text?.kind === 'literal' ? node.text.value : undefined;
  return text ? `${text}（${node.id}）` : node.id;
}

/** Where a fragment can go on its own page of the current draft. */
export function fragmentPlacements(page: ProjectUiPageId, request: UiShareImportRequest, draft: ProjectUiDocument | null): UiShareImportPlacement[] {
  const root = draft?.pages[page], name = UI_SHARE_PAGE_NAMES[page];
  const placements: UiShareImportPlacement[] = [];
  const container = page === request.page && request.containerId ? findNode(root, request.containerId) : undefined;
  if (container && container !== root && CONTAINER_TYPES.has(container.type)) {
    placements.push({ key: 'container', parentId: container.id, label: `插入所选容器「${uiNodeName(container)}」末尾`,
      detail: '保留本页其他组件，片段作为该容器的最后一个子组件。' });
  }
  if (root && CONTAINER_TYPES.has(root.type)) {
    placements.push({ key: 'root', parentId: root.id, label: `插入「${name}」页根组件末尾`,
      detail: '保留本页其他组件，片段放在页面最上层。' });
  }
  placements.push({ key: 'replace', label: root ? `替换整个「${name}」页` : `作为「${name}」页的自定义界面`,
    detail: root ? '本页原有组件从草稿移除，由片段成为页面根组件。' : '本页目前使用默认界面；片段成为该页的根组件。' });
  return placements;
}

export interface UiShareImpactRow {
  page: ProjectUiPageId;
  name: string;
  change: UiShareImportPreview['pages'][number]['change'];
  badge: string;
  detail: string;
  added: string[];
  removed: string[];
}

const BADGES: Record<UiShareImpactRow['change'], string> = { add: '新增', replace: '替换', insert: '插入', remove: '恢复默认', unchanged: '保留' };

export function summarizeUiShareImpact(pages: UiShareImportPreview['pages'], parentLabel?: string): UiShareImpactRow[] {
  return pages.map(({ page, change, before, after }) => {
    const added = after.filter(id => !before.includes(id)), removed = before.filter(id => !after.includes(id));
    const detail = change === 'add' ? `新增自定义页，${after.length} 个组件。`
      : change === 'replace' ? `替换整页，导入后共 ${after.length} 个组件；相同标识的组件也使用导入页中的布局、样式、文字和动作。`
        : change === 'insert' ? `加入 ${added.length} 个组件${parentLabel ? `到${parentLabel}` : ''}，其他组件保留。`
          : change === 'remove' ? `移除自定义页，恢复 Player 默认页（${before.length} 个组件移出草稿）。游戏功能不受影响。`
            : before.length ? `保留现有自定义页（${before.length} 个组件）。` : '继续使用默认页。';
    return { page, name: UI_SHARE_PAGE_NAMES[page], change, badge: BADGES[change], detail, added, removed };
  });
}

/** Full themes replace every page: custom pages the theme does not carry return to the default page. */
export function restoredDefaultPages(pages: UiShareImportPreview['pages']): ProjectUiPageId[] {
  return pages.filter(page => page.change === 'remove').map(page => page.page);
}

export interface UiPreviewView { key: string; page: ProjectUiPageId; mode?: 'save' | 'load'; label: string; custom: boolean }

/** Page switcher of the effect preview; the save/load page is offered once per mode. */
export function uiPreviewViews(value: ProjectUiDocument | null): UiPreviewView[] {
  return PROJECT_UI_PAGES.flatMap((page): UiPreviewView[] => {
    const custom = Boolean(value?.pages[page]), suffix = custom ? '' : '（默认页）';
    return page === 'save-load'
      ? [{ key: 'save-load:save', page, mode: 'save' as const, label: `存读档 · 存档${suffix}`, custom },
        { key: 'save-load:load', page, mode: 'load' as const, label: `存读档 · 读档${suffix}`, custom }]
      : [{ key: page, page, label: `${UI_SHARE_PAGE_NAMES[page]}${suffix}`, custom }];
  });
}

export function defaultPreviewView(views: UiPreviewView[], preview: Pick<UiShareImportPreview, 'pages'>, fragmentPage?: ProjectUiPageId | null): string {
  const changed = preview.pages.find(page => page.change !== 'unchanged' && page.change !== 'remove' && (!fragmentPage || page.page === fragmentPage));
  const page = fragmentPage ?? changed?.page ?? views.find(view => view.custom)?.page ?? 'title';
  return views.find(view => view.page === page && view.mode !== 'save')?.key ?? views[0]!.key;
}

export interface UiPreviewSampleItem {
  id: string; label: string; description?: string; value?: string | number | boolean; date?: string;
  disabled?: boolean; empty?: boolean; backlog?: { speaker: string | null; text: string };
}

const SAMPLE_DATE = '2026-10-20 21:30';

/**
 * Read-only sample content of the effect preview. `empty` shows the empty and disabled
 * states (empty slots, locked gallery entries, no backlog/choices).
 */
export function uiPreviewSampleContent(source: ProjectUiContentSource, empty: boolean, mode?: 'save' | 'load'): UiPreviewSampleItem[] {
  switch (source) {
    case 'save-slots': {
      const slots = empty ? [false, false, false, false] : [true, true, false, true];
      return slots.map((used, index) => {
        const id = index === 0 ? 'auto' : String(index);
        const name = index === 0 ? '自动存档' : `槽位 ${index}`;
        return used ? { id, label: name, description: `第 ${index + 2} 章 · ${SAMPLE_DATE}`, date: SAMPLE_DATE }
          : { id, label: index === 0 ? '自动存档（空）' : `空槽位 ${index}`, description: '', date: '', empty: true, disabled: mode === 'load' };
      });
    }
    case 'backlog':
      return empty ? [] : [
        { speaker: '旁白', text: '雨停之后，走廊里只剩下钟声。' },
        { speaker: '林', text: '我们先去旧图书馆看看吧。' },
        { speaker: null, text: '（远处传来翻书的声音。）' },
      ].map((entry, index) => ({ id: String(index), label: entry.speaker ? `${entry.speaker}：${entry.text}` : entry.text, backlog: entry, disabled: true }));
    case 'choices':
      return empty ? [] : [{ id: '0', label: '前往旧图书馆' }, { id: '1', label: '留在教室等待' }, { id: '2', label: '先回家休息' }];
    case 'settings':
      return Object.entries(GAME_SETTING_DEFINITIONS).filter(([, definition]) => definition.writable).map(([id, definition]) => {
        const value = definition.default;
        const display = typeof value === 'boolean' ? (value ? '开' : '关') : value === null ? '跟随作品' : String(value);
        return { id, label: definition.label, description: display, value: display };
      });
    default: {
      const names: Record<string, string[]> = {
        'gallery-cgs': ['黄昏的走廊', '旧图书馆', '雨后的车站'], 'gallery-music': ['主题曲', '雨声', '夜行'],
        'gallery-texts': ['第一章 回想', '第二章 回想', '第三章 回想'], 'gallery-endings': ['晴天结局', '雨天结局', '空白结局'],
        'gallery-profiles': ['林', '澄', '管理员'], 'gallery-terms': ['钟楼', '借书证', '雨季'], terms: ['钟楼', '借书证', '雨季'],
      };
      const readOnly = ['gallery-endings', 'gallery-profiles', 'gallery-terms', 'terms'].includes(source);
      return (names[source] ?? []).map((name, index) => {
        const unlocked = !empty && index < 2;
        return { id: `${source}-${index}`, label: unlocked ? name : '???',
          ...(readOnly ? { description: unlocked ? `${name}的说明文字。` : '未解锁' } : {}),
          disabled: readOnly || !unlocked };
      });
    }
  }
}

/** Initial value of a declared work variable, the Player's value before any reading. */
export function uiPreviewVariableValue(config: Record<string, unknown>, name: string): unknown {
  const variables = config.variables && typeof config.variables === 'object' ? config.variables as Record<string, unknown> : {};
  const declaration = variables[name] && typeof variables[name] === 'object' ? variables[name] as { type?: unknown; initial?: unknown } : {};
  if (declaration.initial !== undefined) return declaration.initial;
  return declaration.type === 'number' ? 0 : declaration.type === 'flag' || declaration.type === 'boolean' ? false : declaration.type === 'string[]' ? [] : '';
}
