/**
 * 配置标签页（Frontend Pass 4）：角色、变量、成就、日历与地图、成长、事件、鉴赏、名词表八类配置台账。
 *  - 项目初次加载或无本地草稿时从盘上重新读取源文件
 *  - 表格 ⇄ JSON 双向转换与校验全部经 config-edit.ts 纯逻辑（落盘前必过校验）
 *  - 写盘 2 空格缩进、键序稳定、未知字段经原条目合并保留；无目录连接时诚实提示
 *  - 复杂字段（effects/tiers/statGrowth/levelEvents/requires）以 JSON 文本列编辑
 *  - 配置编辑撤销/重做（快照栈：打字合并 + 50 步上限，与剧本 undo 分栈，main.ts 按标签页路由）
 *  - 名词表导入/导出；审计面板一键加变体入口（addTerminologyVariant）
 */
import { state, h, setStatus } from '../state.js';
import { projectPortraitOverrides, readProjectStage, readProjectUi, type ProjectUiDocument } from '@surdet/core';
import { assertConfigSourcesReadable, configSourceError, configSourcePath, parseConfigSource, type ConfigSourceName } from '../config-source.js';
import { assetPathForHandle, assertProjectWriteUnlocked, readProjectSourceText, runProjectWriteOperation, writeProjectText } from '../project-io.js';
import { editorWorkspaceStatus } from '../editor-workspace.js';
import { AuthoringOperationError, parseProjectConfigDocument, patchUiDocument, renameConfigReferences, renameGalleryLabel, applyConfigReferenceRename, type UiPatch } from '@surdet/authoring';
import { commitCharacterTable, commitStageConfiguration, commitThemeConfiguration, commitUiConfiguration, parseCharacterVisualsDraft, parseThemeEditorDraft, projectThemeEditorDraft, type CharacterTableEditRow } from '../authoring-project-storage.js';
import { disposeUiDesigner, renderUiDesigner } from '../ui-designer.js';
import { renderTextCatalogSection, type TextBindingDraft } from './text-catalog.js';
import { openUiPlayerPreview } from '../ui-player-preview.js';
import { copySharedFragment, exportUiShare, missingUiShareAssets, readUiShare, type ShareAsset } from '../ui-sharing.js';
import {
  VAR_TYPES, parseVariablesToRows, rowsToVariables, applyVariablesToConfig,
  parseAchievementsToRows, rowsToAchievements, collectReferencedVars,
  parseCalendarRows, rowsToCalendar,
  parseEventsRows, rowsToEvents,
  parseGrowthRows, rowsToGrowth,
  parseGalleryRows, rowsToGallery,
  parseTerminologyRows, rowsToTerminology, normalizeTerminologyImport,
} from '../config-edit.js';
import type {
  VariableRow, AchievementRow, RowMap,
  CalendarRows, EventsRows, GrowthRows, GalleryRows, TerminologyTableRows,
} from '../config-edit.js';
import { renderCalendarMap } from './calendar-map.js';
import { enhanceConfigTables } from '../v4/surfaces.js';
import { createSnapshotHistory, snapshotPush, snapshotUndo, snapshotRedo } from '../history.js';

/** 校验刷新钩子（main.ts 注入：scheduleValidate） */
let requestValidateHook: () => void = () => {};
let configDraftStateChangedHook: (() => void) | undefined;
let stageSharedAssetsHook: ((files: File[]) => void) | undefined;
export function bindConfigHooks(opts: { requestValidate: () => void; onDraftStateChanged?: () => void; stageSharedAssets?: (files: File[]) => void }): void {
  requestValidateHook = opts.requestValidate;
  configDraftStateChangedHook = opts.onDraftStateChanged;
  stageSharedAssetsHook = opts.stageSharedAssets;
}

export type ConfigSectionId =
  | 'characters'
  | 'variables'
  | 'achievements'
  | 'calendar'
  | 'growth'
  | 'events'
  | 'gallery'
  | 'terminology'
  | 'stage'
  | 'theme'
  | 'texts'
  | 'ui';

export interface ConfigDraftInspection {
  dirty: boolean;
  dirtySections: ConfigSectionId[];
}

interface ConfigSectionDescriptor {
  id: ConfigSectionId;
  label: string;
  description: string;
  file: string;
  render: () => HTMLElement;
}

const CONFIG_SECTIONS: readonly ConfigSectionDescriptor[] = [
  { id: 'characters', label: '角色', description: '管理显示名称、头像与服装/表情立绘。', file: 'game.config.json', render: renderCharactersSection },
  { id: 'variables', label: '变量', description: '定义剧情状态、初始值、范围和只读约束。', file: 'game.config.json', render: renderVariablesSection },
  { id: 'theme', label: '主题外观', description: '配置颜色、字体大小、对话框/按钮皮肤、字标与基础布局。', file: 'game.config.json', render: renderThemeSection },
  { id: 'ui', label: '界面设计', description: '为作品页面排布组件并设置数据与操作。', file: 'game.config.json', render: renderUiSection },
  { id: 'texts', label: '文本与译稿', description: '登记固定文本键，导出译稿并在核对差异后导入。', file: 'game.config.json', render: renderTextCatalogConfig },
  { id: 'achievements', label: '成就', description: '整理成就文案、触发条件与隐藏状态。', file: 'content/config/achievements.json', render: renderAchievementsSection },
  { id: 'calendar', label: '日历与地图', description: '安排回合规则、地图节点、前置关系与据点指令。', file: 'content/config/calendar.json', render: renderCalendarSection },
  { id: 'growth', label: '角色成长', description: '设置经验曲线、等级范围和成长事件。', file: 'content/config/growth.json', render: renderGrowthSection },
  { id: 'events', label: '事件', description: '管理条件事件、日程事件和角色阶段文案。', file: 'content/config/events.json', render: renderEventsSection },
  { id: 'gallery', label: '鉴赏', description: '维护图片、音乐和剧情回想入口。', file: 'content/config/gallery.json', render: renderGallerySection },
  { id: 'terminology', label: '名词表', description: '统一规范词与常见变体，供审计检查使用。', file: 'content/config/terminology.json', render: renderTerminologySection },
];

let activeConfigSectionId: ConfigSectionId = 'characters';
let showConfigTechnicalNames = false;

function configDescriptor(id: ConfigSectionId): ConfigSectionDescriptor {
  return CONFIG_SECTIONS.find((descriptor) => descriptor.id === id)!;
}

function sectionSource(id: ConfigSectionId): ConfigSourceName {
  return id === 'characters' || id === 'variables' || id === 'stage' || id === 'theme' || id === 'ui' || id === 'texts' ? 'gameConfig' : id;
}

function renderConfigWorkspace(root: HTMLElement): void {
  disposeUiDesigner();
  root.innerHTML = '';
  root.setAttribute('data-editor-panel', 'config');
  root.setAttribute('data-editor-region', 'config-workbench');

  const workspace = h('div', 'config-workspace');
  workspace.dataset.showTechnicalNames = String(showConfigTechnicalNames);
  root.dataset.showTechnical = String(showConfigTechnicalNames);
  const index = h('nav', 'config-index');
  index.setAttribute('aria-label', '配置目录');
  const indexHeading = h('div', 'config-index-header');
  indexHeading.append(h('h2', undefined, '配置目录'));
  indexHeading.append(h('p', undefined, '按游戏系统查找和编辑项目配置。'));
  const technicalToggle = h('button', 'config-technical-toggle', showConfigTechnicalNames ? '隐藏字段标识' : '显示字段标识');
  technicalToggle.type = 'button';
  technicalToggle.setAttribute('aria-pressed', String(showConfigTechnicalNames));
  indexHeading.appendChild(technicalToggle);
  index.appendChild(indexHeading);
  const indexItems = h('div', 'config-index-list');
  index.setAttribute('aria-orientation', 'vertical');
  const ledger = h('main', 'config-ledger');

  const buttons = new Map<ConfigSectionId, HTMLButtonElement>();
  const panels = new Map<ConfigSectionId, HTMLElement>();
  const selectSection = (sectionId: ConfigSectionId): void => {
    activeConfigSectionId = sectionId;
    for (const descriptor of CONFIG_SECTIONS) {
      const button = buttons.get(descriptor.id)!;
      const panel = panels.get(descriptor.id)!;
      if (descriptor.id === activeConfigSectionId) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
      panel.hidden = descriptor.id !== activeConfigSectionId;
    }
  };

  for (const descriptor of CONFIG_SECTIONS) {
    const button = h('button', 'config-index-item');
    button.type = 'button';
    button.dataset.configSectionTarget = descriptor.id;
    button.title = descriptor.description;
    button.append(h('strong', 'config-index-label', descriptor.label));
    button.onclick = () => selectSection(descriptor.id);
    buttons.set(descriptor.id, button);
    indexItems.appendChild(button);

    const error = configSourceError(sectionSource(descriptor.id));
    const panel = error ? sectionShell(descriptor.id).sec : descriptor.render();
    if (error) {
      const message = h('p', 'err', `无法读取 ${descriptor.file}：${error}`);
      message.setAttribute('role', 'alert');
      panel.append(message, h('p', 'dim', '原文件未被修改。请修正文件或恢复读取权限后重新打开项目；此区块暂不能编辑或保存。'));
    }
    panel.hidden = descriptor.id !== activeConfigSectionId;
    panels.set(descriptor.id, panel);
    ledger.appendChild(panel);
  }

  technicalToggle.onclick = () => {
    showConfigTechnicalNames = !showConfigTechnicalNames;
    workspace.dataset.showTechnicalNames = String(showConfigTechnicalNames);
    root.dataset.showTechnical = String(showConfigTechnicalNames);
    technicalToggle.textContent = showConfigTechnicalNames ? '隐藏字段标识' : '显示字段标识';
    technicalToggle.setAttribute('aria-pressed', String(showConfigTechnicalNames));
  };
  selectSection(activeConfigSectionId);
  index.appendChild(indexItems);
  workspace.append(index, ledger);
  root.appendChild(workspace);
  enhanceConfigTables(root);
}

/** 本地重建全部区块（保留内存行模型与未保存输入；仅增删行时用）。
 *  从盘重读+置空行缓存只属于 renderConfig（标签页进入入口，M4 审阅轮 Major 1 修复） */
function rerenderConfig(): void {
  const root = document.getElementById('config-view');
  if (!root) return;
  renderConfigWorkspace(root);
}

/* ---- 行模型缓存（项目重载时清理；同一项目有草稿时跨标签页复用） ---- */
let charRows: CharacterTableEditRow[] | null = null;
let varRows: VariableRow[] | null = null;
let achRows: AchievementRow[] | null = null;
let calRows: CalendarRows | null = null;
let evRows: EventsRows | null = null;
let grRows: GrowthRows | null = null;
let gaRows: GalleryRows | null = null;
let termRows: TerminologyTableRows | null = null;
// The stage form lives beside the preview but shares project draft ownership,
// save-all, switching guards and history with the existing configuration forms.
let stageDraft: string | null = null;
let stageSourceBaseline: string | undefined;
let themeDraft: string | null = null;
let themeSourceBaseline: string | undefined;
let uiDraft: ProjectUiDocument | null | undefined;
let uiSourceBaseline: string | undefined;
let textCsvDraft = '';
let textBindingsDraft: TextBindingDraft[] = [];
let configSessionRevision = 0;
let configSessionLoaded = false;
const configBaselines: Partial<Record<ConfigSectionId, string>> = {};

function scheduleConfigDraftStateChanged(): void {
  const hook = configDraftStateChangedHook;
  if (!hook) return;
  // Edits call this before mutating the row model so the hook observes the
  // completed input/structural edit in the same task.
  queueMicrotask(() => {
    if (configDraftStateChangedHook === hook) hook();
  });
}

function serializeConfigSection(sectionId: ConfigSectionId): string {
  switch (sectionId) {
    case 'characters': return JSON.stringify(ensureCharRows());
    case 'variables': return JSON.stringify(ensureVarRows());
    case 'achievements': return JSON.stringify(ensureAchRows());
    case 'calendar': return JSON.stringify(ensureCalRows());
    case 'growth': return JSON.stringify(ensureGrRows());
    case 'events': return JSON.stringify(ensureEvRows());
    case 'gallery': return JSON.stringify(ensureGaRows());
    case 'terminology': return JSON.stringify(ensureTermRows());
    case 'stage': return JSON.stringify(readStageConfigDraft());
    case 'theme': return JSON.stringify(readThemeConfigDraft());
    case 'ui': return JSON.stringify(readUiConfigDraft());
    case 'texts': return JSON.stringify({ csv: textCsvDraft, bindings: textBindingsDraft });
  }
}

function captureConfigBaseline(sectionId: ConfigSectionId): void {
  if (configSourceError(sectionSource(sectionId))) {
    delete configBaselines[sectionId];
    return;
  }
  configBaselines[sectionId] = serializeConfigSection(sectionId);
}

function captureAllConfigBaselines(): void {
  for (const descriptor of CONFIG_SECTIONS) captureConfigBaseline(descriptor.id);
}

function markConfigSectionSaved(sectionId: ConfigSectionId, submittedRows: unknown, sessionRevision: number): void {
  if (sessionRevision !== configSessionRevision) return;
  configBaselines[sectionId] = JSON.stringify(submittedRows);
  scheduleConfigDraftStateChanged();
}

function notifyConfigDraftStateChanged(): void {
  configDraftStateChangedHook?.();
}

/** 只读配置草稿投影：按行模型与最后成功读取/保存的 section baseline 比较。 */
export function inspectConfigDraftState(): ConfigDraftInspection {
  const dirtySections: ConfigSectionId[] = [];
  for (const descriptor of CONFIG_SECTIONS) {
    const baseline = configBaselines[descriptor.id];
    if (baseline !== undefined && baseline !== serializeConfigSection(descriptor.id)) {
      dirtySections.push(descriptor.id);
    }
  }
  if (configBaselines.stage !== undefined && configBaselines.stage !== serializeConfigSection('stage')) dirtySections.push('stage');
  return { dirty: dirtySections.length > 0, dirtySections };
}

export function editTextCsvDraft(value: string): void {
  assertProjectWriteUnlocked();
  configBaselines.texts ??= serializeConfigSection('texts');
  if (value !== textCsvDraft) { pushConfigHistory(false); textCsvDraft = value; configSessionLoaded = true; }
  scheduleConfigDraftStateChanged();
}
export function readTextCsvDraft(): string { return textCsvDraft; }

function editTextBindingsDraft(value: TextBindingDraft[]): void {
  assertProjectWriteUnlocked();
  configBaselines.texts ??= serializeConfigSection('texts');
  if (JSON.stringify(value) === JSON.stringify(textBindingsDraft)) return;
  pushConfigHistory(false);
  textBindingsDraft = clone(value);
  configSessionLoaded = true;
  scheduleConfigDraftStateChanged();
}

function renderTextCatalogConfig(): HTMLElement {
  const revision = configSessionRevision;
  const panel = renderTextCatalogSection({
    readCsv: readTextCsvDraft, editCsv: editTextCsvDraft,
    readBindings: () => textBindingsDraft, editBindings: editTextBindingsDraft,
    isCurrent: () => revision === configSessionRevision,
    onSaved: (text, submitted) => {
      if (revision !== configSessionRevision) return;
      const savedBindings = new Set(submitted.bindings?.map(item => JSON.stringify(item)) ?? []);
      const keepPending = (items: TextBindingDraft[]) => items.filter(item => !savedBindings.has(JSON.stringify(item)));
      textBindingsDraft = keepPending(textBindingsDraft);
      for (const snapshot of [...configHist.past, ...configHist.future]) {
        snapshot.gameConfigText = text;
        snapshot.textBindingsDraft = keepPending(snapshot.textBindingsDraft);
      }
      const baseline = JSON.parse(configBaselines.texts ?? serializeConfigSection('texts')) as { csv: string };
      markConfigSectionSaved('texts', { csv: submitted.csv ?? baseline.csv, bindings: [] }, revision);
      requestValidateHook();
      if (!panel.isConnected) rerenderConfig();
    },
  });
  return panel;
}

export function readStageConfigDraft(): string {
  if (stageDraft === null) {
    const value = parseConfigObj().stage ?? null;
    stageSourceBaseline = JSON.stringify(value);
    stageDraft = JSON.stringify(value ?? { version: 1, design: { width: 1280, height: 720 }, positions: {}, distances: {}, portraits: {}, compositions: {} }, null, 2);
    configBaselines.stage = JSON.stringify(stageDraft);
  }
  return stageDraft;
}

export function editStageConfigDraft(text: string, coalesce = false): void {
  assertProjectWriteUnlocked();
  if (state.reviewWorkspace || state.reviewPreviewReadOnly || state.projectLoading) throw new Error('当前项目不可编辑舞台配置。');
  if (readStageConfigDraft() === text) return;
  pushConfigHistory(coalesce);
  stageDraft = text;
  configSessionLoaded = true;
}

/** Working preview only. The source-writing transaction still reads the saved
 * configuration, so a draft cannot silently become its own disk baseline. */
export function previewStageConfigText(source: string): string {
  if (stageDraft === null || configBaselines.stage === JSON.stringify(stageDraft)) return source;
  const config = parseProjectConfigDocument(source || '{}');
  const stage: unknown = JSON.parse(stageDraft);
  readProjectStage({ stage });
  if (stage === null) delete config.stage; else config.stage = stage;
  return JSON.stringify(config);
}

export function reloadStageConfigDraft(): string {
  // Explicitly discard only the stage draft, retaining other configuration edits.
  const value = parseConfigObj().stage ?? null;
  const text = JSON.stringify(value ?? { version: 1 }, null, 2);
  editStageConfigDraft(text);
  stageSourceBaseline = JSON.stringify(value);
  configBaselines.stage = JSON.stringify(text);
  notifyConfigDraftStateChanged();
  return text;
}

export async function saveStageConfigDraftUnlocked() {
  assertProjectWriteUnlocked();
  assertConfigSaveReady('gameConfig');
  const submitted = readStageConfigDraft(), revision = configSessionRevision;
  if (JSON.stringify(parseConfigObj().stage ?? null) !== stageSourceBaseline) throw new Error('舞台来源配置已经变化，请保留草稿并重新核对。');
  const value: unknown = JSON.parse(submitted);
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw new Error('舞台配置必须是对象或 null。');
  const result = await commitStageConfiguration(value as Record<string, unknown> | null, state.gameConfigText);
  if (revision === configSessionRevision) {
    stageSourceBaseline = JSON.stringify(result.after);
    markConfigSectionSaved('stage', submitted, revision);
    // Undo changes only the draft, never pretends a completed disk write did not happen.
    for (const snapshot of [...configHist.past, ...configHist.future]) snapshot.gameConfigText = result.text;
    requestValidateHook();
  }
  return result;
}

function themeFormValue(config: Record<string, unknown>) {
  const player = config.player as Record<string, unknown> | undefined;
  return { theme: config.theme ?? null, titleLogo: player?.titleLogo ?? null, titleBackground: player?.titleBackground ?? null,
    font: config.font ?? null, fonts: config.fonts ?? null };
}

export function readThemeConfigDraft(): string {
  if (themeDraft === null) {
    const config = parseConfigObj();
    const value = themeFormValue(config);
    themeSourceBaseline = JSON.stringify(value);
    themeDraft = JSON.stringify(value, null, 2);
    configBaselines.theme = JSON.stringify(themeDraft);
  }
  return themeDraft;
}

export function editThemeConfigDraft(text: string, coalesce = false): void {
  assertProjectWriteUnlocked();
  if (state.reviewWorkspace || state.reviewPreviewReadOnly || state.projectLoading) throw new Error('当前项目不可编辑主题配置。');
  if (readThemeConfigDraft() === text) return;
  pushConfigHistory(coalesce);
  themeDraft = text;
  configSessionLoaded = true;
  scheduleConfigDraftStateChanged();
}

export function previewThemeConfigText(source: string): string {
  if (themeDraft === null || configBaselines.theme === JSON.stringify(themeDraft)) return source;
  const config = parseProjectConfigDocument(source || '{}');
  return JSON.stringify(projectThemeEditorDraft(config, parseThemeEditorDraft(themeDraft)));
}

export function reloadThemeConfigDraft(): string {
  const config = parseConfigObj();
  const value = themeFormValue(config);
  const text = JSON.stringify(value, null, 2);
  editThemeConfigDraft(text);
  themeSourceBaseline = JSON.stringify(value);
  configBaselines.theme = JSON.stringify(text);
  notifyConfigDraftStateChanged();
  return text;
}

export async function saveThemeConfigDraftUnlocked() {
  assertProjectWriteUnlocked();
  assertConfigSaveReady('gameConfig');
  const submitted = readThemeConfigDraft(), revision = configSessionRevision;
  const config = parseConfigObj();
  const current = JSON.stringify(themeFormValue(config));
  if (current !== themeSourceBaseline) throw new Error('主题来源配置已经变化，请保留草稿并重新核对。');
  const draft = parseThemeEditorDraft(submitted);
  projectThemeEditorDraft(config, draft);
  const result = await commitThemeConfiguration(draft.theme, draft.titleLogo, state.gameConfigText, draft.playerConfig);
  if (revision === configSessionRevision) {
    const afterConfig = parseProjectConfigDocument(result.text);
    themeSourceBaseline = JSON.stringify(themeFormValue(afterConfig));
    markConfigSectionSaved('theme', submitted, revision);
    for (const snapshot of [...configHist.past, ...configHist.future]) snapshot.gameConfigText = result.text;
    requestValidateHook();
  }
  return result;
}

export function readUiConfigDraft(): ProjectUiDocument | null {
  if (uiDraft === undefined) {
    const config = parseConfigObj();
    uiDraft = readProjectUi(config);
    uiSourceBaseline = JSON.stringify(uiDraft);
    configBaselines.ui = JSON.stringify(uiDraft);
  }
  return uiDraft;
}

export function editUiConfigDraft(patch: UiPatch): ProjectUiDocument | null {
  assertProjectWriteUnlocked();
  if (state.reviewWorkspace || state.reviewPreviewReadOnly || state.projectLoading) throw new Error('当前项目不可编辑界面。');
  const current = readUiConfigDraft();
  const config = parseConfigObj();
  const next = patchUiDocument(current, { ...config, ui: current }, patch);
  if (JSON.stringify(next) === JSON.stringify(current)) return current;
  pushConfigHistory(false);
  uiDraft = next;
  configSessionLoaded = true;
  scheduleConfigDraftStateChanged();
  return next;
}

export function replaceUiConfigDraft(value: ProjectUiDocument | null): void {
  assertProjectWriteUnlocked();
  if (state.reviewWorkspace || state.reviewPreviewReadOnly || state.projectLoading) throw new Error('当前项目不可编辑界面。');
  const config = parseConfigObj();
  const projected = { ...config };
  if (value === null) delete projected.ui; else projected.ui = value;
  const next = readProjectUi(projected);
  if (JSON.stringify(next) === JSON.stringify(readUiConfigDraft())) return;
  pushConfigHistory(false);
  uiDraft = next;
  configSessionLoaded = true;
  scheduleConfigDraftStateChanged();
}

export function previewUiConfigText(source: string): string {
  if (uiDraft === undefined || configBaselines.ui === JSON.stringify(uiDraft)) return source;
  const config = parseProjectConfigDocument(source || '{}');
  if (uiDraft === null) delete config.ui; else config.ui = uiDraft;
  readProjectUi(config);
  return JSON.stringify(config);
}

export function reloadUiConfigDraft(): ProjectUiDocument | null {
  const source = readProjectUi(parseConfigObj());
  replaceUiConfigDraft(source);
  uiSourceBaseline = JSON.stringify(source);
  configBaselines.ui = JSON.stringify(source);
  notifyConfigDraftStateChanged();
  return source;
}

export async function saveUiConfigDraftUnlocked() {
  assertProjectWriteUnlocked();
  assertConfigSaveReady('gameConfig');
  const submitted = readUiConfigDraft(), revision = configSessionRevision;
  if (JSON.stringify(readProjectUi(parseConfigObj())) !== uiSourceBaseline) throw new Error('界面来源配置已经变化，请保留草稿并重新核对。');
  const result = await commitUiConfiguration(submitted, state.gameConfigText);
  if (revision === configSessionRevision) {
    uiSourceBaseline = JSON.stringify(result.after);
    markConfigSectionSaved('ui', submitted, revision);
    for (const snapshot of [...configHist.past, ...configHist.future]) snapshot.gameConfigText = result.text;
    requestValidateHook();
  }
  return result;
}

/** 打开配置页时从盘上重读源文件；失败保持显式错误，不冒充旧值仍有效。 */
async function refreshConfigSources(revision: number): Promise<boolean> {
  const gameConfigHandle = state.handles.gameConfig;
  const handles = { ...state.handles };
  let gameConfigText = state.gameConfigText;
  const configFiles = { ...state.configFiles };
  const errors = { ...state.configReadErrors };
  try {
    if (gameConfigHandle) {
      gameConfigText = await readProjectSourceText(gameConfigHandle);
    }
    if (gameConfigHandle || gameConfigText !== '') parseConfigSource('gameConfig', gameConfigText);
    delete errors.gameConfig;
  } catch (error) { errors.gameConfig = error instanceof Error ? error.message : String(error); }
  for (const name of ['achievements', 'calendar', 'events', 'growth', 'gallery', 'terminology'] as const) {
    try {
      const handle = handles[name];
      if (handle) {
        configFiles[name] = parseConfigSource(name, await readProjectSourceText(handle));
        delete errors[name];
      }
    } catch (error) {
      configFiles[name] = null;
      errors[name] = `${configSourcePath(name)}：${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (revision !== configSessionRevision) return false;
  state.gameConfigText = gameConfigText;
  state.configFiles = configFiles;
  state.configReadErrors = errors;
  requestValidateHook();
  return true;
}

function parseConfigObj(): Record<string, unknown> {
  assertConfigSourcesReadable(['gameConfig']);
  return state.gameConfigText === '' && state.handles.gameConfig === null ? {} : parseProjectConfigDocument(state.gameConfigText);
}

function ensureCharRows(): CharacterTableEditRow[] {
  if (!charRows) {
    const characters = parseConfigObj()['characters'];
    charRows = typeof characters === 'object' && characters !== null && !Array.isArray(characters)
      ? Object.entries(characters as Record<string, unknown>).map(([id, raw]) => {
        const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        return {
          id,
          name: typeof record['name'] === 'string' ? record['name'] as string : '',
          avatar: typeof record['avatar'] === 'string' ? record['avatar'] as string : '',
          portraits: projectPortraitOverrides({ characters: { [id]: { portraits: record['portraits'] } } })
            .map(({ outfit, expression, sourcePath }) => ({ outfit, expression, sourcePath })),
          ...(record['visuals'] === undefined ? {} : { visualsText: JSON.stringify(record['visuals'], null, 2) }),
        };
      })
      : [];
  }
  return charRows;
}

function ensureVarRows(): VariableRow[] { if (!varRows) varRows = parseVariablesToRows(parseConfigObj()); return varRows; }
function ensureAchRows(): AchievementRow[] { if (!achRows) achRows = parseAchievementsToRows(state.configFiles.achievements); return achRows; }
function ensureCalRows(): CalendarRows { if (!calRows) calRows = parseCalendarRows(state.configFiles.calendar); return calRows; }
function ensureEvRows(): EventsRows { if (!evRows) evRows = parseEventsRows(state.configFiles.events); return evRows; }
function ensureGrRows(): GrowthRows { if (!grRows) grRows = parseGrowthRows(state.configFiles.growth); return grRows; }
function ensureGaRows(): GalleryRows { if (!gaRows) gaRows = parseGalleryRows(state.configFiles.gallery); return gaRows; }
function ensureTermRows(): TerminologyTableRows { if (!termRows) termRows = parseTerminologyRows(state.configFiles.terminology); return termRows; }

/* ============================ 配置编辑撤销/重做（快照栈，与剧本 undo 分栈） ============================ */

/** 配置行模型全量快照（null = 尚未载入的区块，恢复时保持未载入语义；
 *  gameConfigText 一并入快照：撤销变量保存后内存态同步回退，覆盖顶层键口径） */
interface ConfigSnapshot {
  charRows: CharacterTableEditRow[] | null;
  varRows: VariableRow[] | null;
  achRows: AchievementRow[] | null;
  calRows: CalendarRows | null;
  evRows: EventsRows | null;
  grRows: GrowthRows | null;
  gaRows: GalleryRows | null;
  termRows: TerminologyTableRows | null;
  stageDraft: string | null;
  themeDraft: string | null;
  uiDraft: ProjectUiDocument | null | undefined;
  textCsvDraft: string;
  textBindingsDraft: TextBindingDraft[];
  gameConfigText: string;
}

const configHist = createSnapshotHistory<ConfigSnapshot>();

function clearConfigRowsAndHistory(): void {
  charRows = null;
  varRows = null;
  achRows = null;
  calRows = null;
  evRows = null;
  grRows = null;
  gaRows = null;
  termRows = null;
  stageDraft = null;
  stageSourceBaseline = undefined;
  themeDraft = null;
  themeSourceBaseline = undefined;
  uiDraft = undefined;
  uiSourceBaseline = undefined;
  textCsvDraft = '';
  textBindingsDraft = [];
  configSessionLoaded = false;
  for (const sectionId of Object.keys(configBaselines) as ConfigSectionId[]) delete configBaselines[sectionId];
  configHist.past = [];
  configHist.future = [];
}

/** 项目切换边界：取消旧读取并丢弃只属于上一项目的配置行缓存和撤销历史。 */
export function resetConfigSession(): void {
  disposeUiDesigner();
  configSessionRevision += 1;
  clearConfigRowsAndHistory();
  notifyConfigDraftStateChanged();
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function takeConfigSnapshot(): ConfigSnapshot {
  return { ...clone({ charRows, varRows, achRows, calRows, evRows, grRows, gaRows, termRows, stageDraft, themeDraft, uiDraft, textCsvDraft, textBindingsDraft }), gameConfigText: state.gameConfigText };
}

/** Rebase live rows, clean baselines and undo/redo together; never save unrelated edits. */
export function prepareConfigSceneRename(from: string, to: string, fallbackEntry: string): () => void {
  const rewrite = (snapshot: ConfigSnapshot): ConfigSnapshot => {
    const next = clone(snapshot);
    const files: Record<string, string> = { 'game.config.json': next.gameConfigText || '{}' };
    if (next.calRows) files['content/config/calendar.json'] = JSON.stringify(next.calRows);
    if (next.evRows) files['content/config/events.json'] = JSON.stringify(next.evRows);
    if (next.gaRows) files['content/config/gallery.json'] = JSON.stringify(next.gaRows);
    if (next.grRows) files['content/config/growth.json'] = JSON.stringify({ profiles: next.grRows.profiles.map(row => {
      const text = String(row.levelEvents ?? '');
      try { return { ...row, levelEvents: text.trim() ? JSON.parse(text) as unknown : undefined }; }
      catch { throw new Error('成长配置的等级事件草稿或撤销历史不是有效 JSON，请先修正后再改名'); }
    }) });
    renameConfigReferences(files, from, to, fallbackEntry);
    next.gameConfigText = files['game.config.json']!;
    if (next.calRows) next.calRows = JSON.parse(files['content/config/calendar.json']!) as CalendarRows;
    if (next.evRows) next.evRows = JSON.parse(files['content/config/events.json']!) as EventsRows;
    if (next.gaRows) next.gaRows = JSON.parse(files['content/config/gallery.json']!) as GalleryRows;
    if (next.grRows) {
      const profiles = (JSON.parse(files['content/config/growth.json']!) as { profiles: Array<{ levelEvents?: unknown }> }).profiles;
      next.grRows.profiles.forEach((row, index) => {
        const original = String(row.levelEvents ?? '');
        if (original.trim() && JSON.stringify(JSON.parse(original)) !== JSON.stringify(profiles[index]!.levelEvents)) {
          row.levelEvents = JSON.stringify(profiles[index]!.levelEvents);
        }
      });
    }
    return next;
  };
  const current = rewrite(takeConfigSnapshot());
  const past = configHist.past.map(rewrite);
  const future = configHist.future.map(rewrite);
  const baselines = { ...configBaselines };
  for (const [section, field] of [['calendar', 'calRows'], ['events', 'evRows'], ['gallery', 'gaRows'], ['growth', 'grRows']] as const) {
    const baseline = baselines[section];
    if (baseline !== undefined) {
      const snap = { ...takeConfigSnapshot(), [field]: JSON.parse(baseline) as unknown } as ConfigSnapshot;
      baselines[section] = JSON.stringify(rewrite(snap)[field]);
    }
  }
  return () => {
    ({ charRows, varRows, achRows, calRows, evRows, grRows, gaRows, termRows } = current);
    configHist.past = past;
    configHist.future = future;
    Object.assign(configBaselines, baselines);
    notifyConfigDraftStateChanged();
  };
}

function assertConfigSaveReady(name: ConfigSourceName): void {
  assertConfigSourcesReadable([name]);
  if (state.pendingSceneConfigRenames.length > 0) throw new Error('场景改名尚未写盘，请使用“保存全部”一起保存场景和配置引用');
}

/** Rebase saved catalog identities and gallery drafts without confirming pending text work. */
export function prepareConfigLabelRename(sceneId: string, from: string, to?: string): () => void {
  const rewrite = (rows: GalleryRows | null): GalleryRows | null => rows === null ? null
    : JSON.parse(renameGalleryLabel(JSON.stringify(rows), sceneId, from, to)) as GalleryRows;
  const current = rewrite(gaRows);
  if (to === undefined) return () => {};
  const rewriteSnapshot = (snapshot: ConfigSnapshot): ConfigSnapshot => {
    const files = { 'game.config.json': snapshot.gameConfigText || '{}' };
    applyConfigReferenceRename(files, { from, to, labelScene: sceneId }, sceneId);
    return { ...snapshot, gameConfigText: files['game.config.json'], gaRows: rewrite(snapshot.gaRows) };
  };
  const past = configHist.past.map(rewriteSnapshot);
  const future = configHist.future.map(rewriteSnapshot);
  const baseline = configBaselines.gallery === undefined ? undefined : JSON.stringify(rewrite(JSON.parse(configBaselines.gallery) as GalleryRows));
  return () => {
    gaRows = current; configHist.past = past; configHist.future = future;
    if (baseline !== undefined) configBaselines.gallery = baseline;
    notifyConfigDraftStateChanged();
  };
}

/** 变更前拍快照。coalesce=true：连续打字合并（同一撤销点）；结构操作（增删行/拖拽/导入）传 false */
function pushConfigHistory(coalesce: boolean, notify = true): void {
  snapshotPush(configHist, takeConfigSnapshot(), Date.now(), coalesce);
  if (notify) scheduleConfigDraftStateChanged();
}

function restoreConfigSnapshot(snap: ConfigSnapshot): void {
  charRows = clone(snap.charRows);
  varRows = clone(snap.varRows);
  achRows = clone(snap.achRows);
  calRows = clone(snap.calRows);
  evRows = clone(snap.evRows);
  grRows = clone(snap.grRows);
  gaRows = clone(snap.gaRows);
  termRows = clone(snap.termRows);
  stageDraft = snap.stageDraft;
  themeDraft = snap.themeDraft;
  uiDraft = snap.uiDraft;
  textCsvDraft = snap.textCsvDraft;
  textBindingsDraft = clone(snap.textBindingsDraft);
  state.gameConfigText = snap.gameConfigText; // 内存态同步回退（磁盘不回滚，与行模型同语义）
  rerenderConfig();
}

/** 配置页撤销（main.ts 在 mainTab==='config' 时路由至此） */
export function configUndo(): void {
  const snap = snapshotUndo(configHist, takeConfigSnapshot());
  if (!snap) {
    setStatus('配置：没有可撤销的编辑', true, 2500);
    return;
  }
  restoreConfigSnapshot(snap);
  notifyConfigDraftStateChanged();
  setStatus('配置：已撤销（未写盘，保存后生效）', true, 2500);
}

/** 配置页重做 */
export function configRedo(): void {
  const snap = snapshotRedo(configHist, takeConfigSnapshot());
  if (!snap) {
    setStatus('配置：没有可重做的编辑', true, 2500);
    return;
  }
  restoreConfigSnapshot(snap);
  notifyConfigDraftStateChanged();
  setStatus('配置：已重做（未写盘，保存后生效）', true, 2500);
}

/** 测试/调试探针：栈深（只读） */
export function configHistoryDepth(): { past: number; future: number } {
  return { past: configHist.past.length, future: configHist.future.length };
}

/* ============================ 通用表格/标量 UI ============================ */

interface ColDef {
  key: string;
  label: string;
  /** checkbox=勾选列；json=等宽字体+JSON 校验语义；缺省普通文本 */
  type?: 'checkbox' | 'json';
}

interface ObjectTableOptions {
  label: string;
  addLabel: string;
}

interface ScalarField {
  key: string;
  label: string;
}

const VARIABLE_TYPE_LABELS: Readonly<Record<string, string>> = {
  number: '数字',
  string: '文本',
  boolean: '布尔值',
  flag: '开关',
  'string[]': '文本列表',
  'number[]': '数字列表',
  object: '对象',
};

function configLabel(label: string, technicalKey: string): HTMLElement {
  const wrap = h('span', 'config-label');
  wrap.append(h('span', undefined, label));
  wrap.append(h('code', 'config-technical-key config-field-key', `字段：${technicalKey}`));
  return wrap;
}

function configSubsection(title: string): HTMLElement {
  const section = h('section', 'config-subsection');
  section.appendChild(h('h2', undefined, title));
  return section;
}

function wrapConfigTable(table: HTMLTableElement, label: string): HTMLElement {
  const scroll = h('div', 'config-table-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', label);
  scroll.appendChild(table);
  return scroll;
}

/** 可编辑对象表格（增删行经 rerenderConfig 本地重建；所有变更前拍撤销快照） */
function renderObjectTable(cols: ColDef[], rows: RowMap[], emptyRow: RowMap, options: ObjectTableOptions): HTMLElement {
  const wrap = h('div', 'config-table-block');
  const table = h('table', 'config-table') as HTMLTableElement;
  const thead = h('thead');
  const hr = h('tr');
  for (const c of cols) {
    const th = h('th');
    th.appendChild(configLabel(c.label, c.key));
    hr.appendChild(th);
  }
  hr.appendChild(h('th', undefined, '操作'));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = h('tbody');
  rows.forEach((row, i) => {
    const tr = h('tr');
    for (const c of cols) {
      const td = h('td');
      if (c.type === 'checkbox') {
        const chk = h('input');
        chk.type = 'checkbox';
        chk.setAttribute('aria-label', `${c.label}，第 ${i + 1} 行`);
        chk.checked = row[c.key] === true;
        chk.onchange = () => { pushConfigHistory(false); rows[i]![c.key] = chk.checked; };
        td.appendChild(chk);
      } else {
        const inp = c.type === 'json' ? h('textarea', 'mono') : h('input');
        if (c.type === 'json') (inp as HTMLTextAreaElement).rows = 4;
        inp.value = String(row[c.key] ?? '');
        inp.placeholder = c.label;
        inp.setAttribute('aria-label', `${c.label}，第 ${i + 1} 行`);
        inp.oninput = () => { pushConfigHistory(true); rows[i]![c.key] = inp.value; };
        td.appendChild(inp);
      }
      tr.appendChild(td);
    }
    const tdDel = h('td');
    const del = h('button', 'config-row-delete', '删除');
    del.setAttribute('aria-label', `删除${options.label}第 ${i + 1} 行`);
    del.onclick = () => { pushConfigHistory(false); rows.splice(i, 1); rerenderConfig(); };
    tdDel.appendChild(del);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(wrapConfigTable(table, `${options.label}数据表`));
  const addBtn = h('button', 'config-row-add', `＋ ${options.addLabel}`);
  addBtn.onclick = () => { pushConfigHistory(false); rows.push({ ...emptyRow }); rerenderConfig(); };
  wrap.appendChild(addBtn);
  return wrap;
}

/** 标量字段网格（键值对输入；输入合并进撤销栈） */
function renderScalarGrid(fields: ScalarField[], scalars: Record<string, string>): HTMLElement {
  const grid = h('div', 'config-field-grid');
  for (const { key, label } of fields) {
    const cell = h('label', 'config-field');
    const span = configLabel(label, key);
    const inp = h('input', 'mono');
    inp.value = scalars[key] ?? '';
    inp.placeholder = label;
    inp.oninput = () => { pushConfigHistory(true); scalars[key] = inp.value; };
    cell.append(span, inp);
    grid.appendChild(cell);
  }
  return grid;
}

/** content/config/*.json 写盘共用（句柄缺失时尝试创建；演示项目诚实拒绝） */
async function saveConfigFileUnlocked(
  name: 'achievements' | 'calendar' | 'events' | 'growth' | 'gallery' | 'terminology',
  json: Record<string, unknown>,
  errors: string[],
  label: string,
  submittedRows: unknown,
  sessionRevision: number,
): Promise<boolean> {
  assertProjectWriteUnlocked();
  assertConfigSaveReady(name);
  if (errors.length > 0) {
    setStatus(`${label}未保存：${errors[0]}${errors.length > 1 ? `（另有 ${errors.length - 1} 条）` : ''}`, false, 6000);
    return false;
  }
  const handle = state.handles[name];
  if (!handle && !state.dirHandle) {
    setStatus(`${label}无法保存：未连接游戏目录（演示项目不落盘）`, false, 6000);
    return false;
  }
  try {
    state.handles[name] = await writeProjectText(`content/config/${name}.json`, JSON.stringify(json, null, 2) + '\n', handle);
  } catch (err) {
    setStatus(`${label}写入失败：${err instanceof Error ? err.message : String(err)}`, false, 6000);
    return false;
  }
  state.configFiles[name] = json;
  markConfigSectionSaved(name, submittedRows, sessionRevision);
  requestValidateHook();
  setStatus(`${label}已保存`, true, 4000);
  return true;
}

async function saveConfigFile(
  name: 'achievements' | 'calendar' | 'events' | 'growth' | 'gallery' | 'terminology',
  json: Record<string, unknown>,
  errors: string[],
  label: string,
  submittedRows: unknown,
): Promise<void> {
  const sessionRevision = configSessionRevision;
  try {
    await runProjectWriteOperation(() => saveConfigFileUnlocked(name, json, errors, label, submittedRows, sessionRevision));
  } catch (error) {
    setStatus(`${label}未保存：${error instanceof Error ? error.message : String(error)}`, false, 6000);
  }
}

function sectionShell(sectionId: ConfigSectionId): { sec: HTMLElement; ops: HTMLElement } {
  const descriptor = configDescriptor(sectionId);
  const sec = h('section', 'config-ledger-section');
  sec.dataset.configSection = descriptor.id;
  const header = h('header', 'config-ledger-header');
  const heading = h('div', 'config-section-copy');
  heading.append(h('h1', 'config-section-heading', descriptor.label));
  heading.append(h('p', 'config-section-description', descriptor.description));
  header.appendChild(heading);
  const technical = h('details', 'config-technical');
  technical.append(h('summary', undefined, '高级信息'));
  const technicalBody = h('div', 'config-technical-body');
  technicalBody.append(h('span', undefined, '配置文件'));
  technicalBody.append(h('code', 'config-technical-key config-source-file', descriptor.file));
  technical.appendChild(technicalBody);
  header.appendChild(technical);
  sec.appendChild(header);
  const ops = h('div', 'config-actions');
  return { sec, ops };
}

/* ============================ 变量表编辑器 ============================ */

async function saveVariablesUnlocked(): Promise<boolean> {
  assertProjectWriteUnlocked();
  assertConfigSaveReady('gameConfig');
  const sessionRevision = configSessionRevision;
  const rows = ensureVarRows();
  const submittedRows = clone(rows);
  const { variables, errors } = rowsToVariables(rows);
  if (errors.length > 0) {
    setStatus(`变量表未保存：${errors[0]}${errors.length > 1 ? `（另有 ${errors.length - 1} 条）` : ''}`, false, 6000);
    return false;
  }
  // 删除保护：被剧本引用的变量删除前需确认（列出引用场景）
  const original = parseVariablesToRows(parseConfigObj());
  const refs = collectReferencedVars(state.lastValidation?.scenes ?? new Map());
  const removed = original.filter((r) => !(r.name.trim() in variables));
  const referenced = removed.filter((r) => refs.has(r.name.trim()));
  if (referenced.length > 0) {
    const detail = referenced
      .map((r) => `${r.name}（引用于：${[...(refs.get(r.name.trim()) ?? [])].join('、')}）`)
      .join('\n');
    if (!window.confirm(`以下待删除变量仍被剧本引用：\n${detail}\n删除后相关指令会运行时报错。仍要删除吗？`)) {
      return false;
    }
  }
  const handle = state.handles.gameConfig;
  if (!handle && !state.dirHandle) {
    setStatus('变量表无法保存：未连接游戏目录（演示项目不落盘）', false, 6000);
    return false;
  }
  const text = applyVariablesToConfig(state.gameConfigText, variables) + '\n';
  try {
    state.handles.gameConfig = await writeProjectText('game.config.json', text, handle);
  } catch (err) {
    setStatus(`变量表写入失败：${err instanceof Error ? err.message : String(err)}`, false, 6000);
    return false;
  }
  state.gameConfigText = text;
  markConfigSectionSaved('variables', submittedRows, sessionRevision);
  requestValidateHook();
  setStatus(`变量表已保存（${Object.keys(variables).length} 个变量）`, true, 4000);
  return true;
}

async function saveVariables(): Promise<void> {
  try { await runProjectWriteOperation(saveVariablesUnlocked); }
  catch (error) { setStatus(`变量表未保存：${error instanceof Error ? error.message : String(error)}`, false, 6000); }
}

/** 角色表：显示名/头像与服装表情绑定可编辑；保存经 @surdet/authoring 的共享
 *  character.ensure 事务语义写盘（与 CLI / Agent 同一 semantic truth），编辑器不复制第二套写实现。
 *  ID 是语义身份，本轮保持只读（rename 属于更大的引用迁移能力）。 */
function renderCharactersSection(): HTMLElement {
  const { sec, ops } = sectionShell('characters');
  const rows = ensureCharRows();
  const revision = configSessionRevision;
  const createFields = h('div', 'config-character-create');
  const newId = h('input', 'mono'); newId.placeholder = '角色标识'; newId.setAttribute('aria-label', '新角色标识');
  const newName = h('input'); newName.placeholder = '显示名称'; newName.setAttribute('aria-label', '新角色显示名称');
  const addCharacter = h('button', 'config-row-add', '添加角色'); addCharacter.type = 'button';
  const canCreate = () => {
    if (!createFields.isConnected || createFields.closest('[inert]') || configSessionRevision !== revision
      || charRows !== rows || state.projectLoading || state.reviewPreviewReadOnly) return false;
    try { assertProjectWriteUnlocked(); return true; }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error), false); return false; }
  };
  addCharacter.onclick = () => {
    if (!canCreate()) return;
    const id = newId.value.trim(), name = newName.value.trim();
    if (!id || !name) { setStatus('请填写角色标识与显示名称。', false); return; }
    if (rows.some(row => row.id === id)) { setStatus(`角色标识已存在：${id}`, false); return; }
    pushConfigHistory(false);
    rows.push({ id, name, avatar: '', portraits: [], visualsText: '{}', create: true });
    rerenderConfig();
  };
  const idField = h('label', 'config-field'), nameField = h('label', 'config-field');
  idField.append(h('span', undefined, '角色标识'), newId);
  nameField.append(h('span', undefined, '显示名称'), newName);
  createFields.append(idField, nameField, addCharacter);
  sec.append(createFields, h('p', 'hint', '添加后先保存在角色表草稿中；点击保存角色表才写入项目。已有角色标识不在这里改名或删除。'));
  if (rows.length === 0) sec.appendChild(h('div', 'config-empty', '暂无角色。填写标识与显示名称后添加首个角色。'));
  const table = h('table', 'config-table') as HTMLTableElement;
  const thead = h('thead');
  const hr = h('tr');
  for (const [label, key] of [['角色标识', 'id'], ['显示名称', 'name'], ['头像素材', 'avatar'], ['服装 / 表情', 'portraits'], ['分层 / 帧动画', 'visuals']] as const) {
    const th = h('th');
    th.appendChild(configLabel(label, key));
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = h('tbody');
  rows.forEach((row, i) => {
    const tr = h('tr');
    const tdId = h('td', 'mono', row.id);
    tdId.title = '角色标识用于台词、引用关系与头像绑定，暂不支持在编辑器改名';
    if (row.create) {
      const cancel = h('button', '', '取消新增'); cancel.type = 'button';
      cancel.setAttribute('aria-label', `取消新增角色 ${row.id}`);
      cancel.onclick = () => {
        if (!cancel.isConnected || !canCreate() || rows[i] !== row || !row.create) return;
        pushConfigHistory(false); rows.splice(i, 1); rerenderConfig();
      };
      tdId.append(h('span', 'hint', ' 未保存'), cancel);
    }
    tr.appendChild(tdId);
    const tdName = h('td');
    const name = h('input');
    name.value = row.name;
    name.placeholder = '角色在界面中显示的名称';
    name.setAttribute('aria-label', `${row.id} 的显示名称`);
    name.oninput = () => { if (!canCreate() || rows[i] !== row || !name.isConnected) return; pushConfigHistory(true); row.name = name.value; };
    tdName.appendChild(name);
    tr.appendChild(tdName);
    const tdAvatar = h('td');
    const avatar = h('input', 'mono');
    avatar.value = row.avatar;
    avatar.placeholder = '留空可清除头像';
    avatar.setAttribute('aria-label', `${row.id} 的头像素材`);
    avatar.oninput = () => { if (!canCreate() || rows[i] !== row || !avatar.isConnected) return; pushConfigHistory(true); row.avatar = avatar.value; };
    tdAvatar.appendChild(avatar);
    tr.appendChild(tdAvatar);
    const tdPortraits = h('td');
    const details = h('details');
    details.style.whiteSpace = 'normal';
    const summary = h('summary', '', `${row.portraits?.length ?? 0} 项显式绑定`);
    const list = h('div');
    const sessionRevision = configSessionRevision;
    const canEdit = () => {
      if (!details.isConnected || details.closest('[inert]') || charRows !== rows || configSessionRevision !== sessionRevision
        || state.projectLoading || state.reviewPreviewReadOnly) return false;
      try { assertProjectWriteUnlocked(); return true; }
      catch (error) { setStatus(error instanceof Error ? error.message : String(error), false); return false; }
    };
    const paths = [...new Set(state.dirAssets.flatMap(asset => {
      if (asset.kind !== 'portrait' || !asset.isImage) return [];
      const path = asset.sourcePath ?? (asset.handle ? assetPathForHandle(asset.handle) : undefined);
      return path === undefined ? [] : [path];
    }))].sort();
    const renderMappings = () => {
      list.textContent = '';
      summary.textContent = `${row.portraits?.length ?? 0} 项显式绑定`;
      for (const [index, mapping] of (row.portraits ?? []).entries()) {
        const fields = h('div');
        fields.style.cssText = 'display:grid;gap:6px;margin:8px 0;min-width:0';
        const canEditMapping = () => fields.isConnected && row.portraits?.[index] === mapping && canEdit();
        for (const [field, label] of [['outfit', '服装'], ['expression', '表情']] as const) {
          const input = h('input'); input.value = mapping[field]; input.placeholder = label;
          input.setAttribute('aria-label', `${row.id} 第 ${index + 1} 项${label}`);
          input.oninput = () => { if (!canEditMapping()) return; pushConfigHistory(true); mapping[field] = input.value; };
          fields.appendChild(input);
        }
        const select = h('select');
        select.setAttribute('aria-label', `${row.id} 第 ${index + 1} 项立绘`);
        const empty = h('option', '', '选择立绘图片'); empty.value = ''; select.appendChild(empty);
        const choices = [...new Set([...paths, ...(mapping.sourcePath ? [mapping.sourcePath] : [])])];
        for (const path of choices) {
          const option = h('option', '', `${paths.includes(path) ? '' : '不可用：'}${path.replace('content/assets/portrait/', '')}`);
          option.value = path; select.appendChild(option);
        }
        select.value = mapping.sourcePath;
        select.onchange = () => { if (!canEditMapping()) return; pushConfigHistory(true); mapping.sourcePath = select.value; };
        const remove = h('button', 'danger', '移除绑定');
        remove.setAttribute('aria-label', `${row.id} 移除第 ${index + 1} 项绑定`);
        remove.onclick = () => { if (!canEditMapping()) return; pushConfigHistory(false); row.portraits!.splice(index, 1); renderMappings(); };
        fields.append(select, remove); list.appendChild(fields);
      }
    };
    const add = h('button', '', '添加服装 / 表情');
    add.setAttribute('aria-label', `${row.id} 添加服装 / 表情`);
    add.onclick = () => {
      if (!canEdit()) return;
      pushConfigHistory(false); (row.portraits ??= []).push({ outfit: '', expression: '', sourcePath: '' });
      renderMappings();
      list.lastElementChild?.querySelector('input')?.focus();
    };
    details.append(summary, h('p', 'hint', '这里的绑定优先于文件名；未绑定的表情仍自动发现。移除绑定不删除图片。'), list, add);
    renderMappings(); tdPortraits.appendChild(details); tr.appendChild(tdPortraits);

    const tdVisuals = h('td');
    const visualsDetails = h('details');
    visualsDetails.style.whiteSpace = 'normal';
    const visualsSummary = h('summary', '', '分层 / 帧动画');
    const visualsText = h('textarea') as HTMLTextAreaElement;
    visualsText.value = row.visualsText ?? '';
    visualsText.rows = 8;
    visualsText.setAttribute('aria-label', `${row.id} 分层 / 帧动画配置`);
    visualsText.placeholder = '在此按“服装 → 表情”编辑立绘配置；输入 null 可移除已有配置。';
    const visualImagePaths = [...new Set(state.dirAssets.flatMap(asset =>
      asset.kind === 'portrait' && asset.isImage && asset.sourcePath ? [asset.sourcePath] : []
    ))].sort();
    const sequenceExample = h('button', '', '填入帧动画示例') as HTMLButtonElement;
    sequenceExample.type = 'button';
    const layeredExample = h('button', '', '填入分层示例') as HTMLButtonElement;
    layeredExample.type = 'button';
    const exampleHint = h('p', 'hint');
    const draftIsEmpty = (): boolean => {
      const text = visualsText.value.trim();
      if (!text) return true;
      try {
        const parsed: unknown = JSON.parse(text);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).length === 0;
      } catch {
        return false;
      }
    };
    const updateExampleControls = () => {
      const empty = draftIsEmpty();
      sequenceExample.disabled = layeredExample.disabled = visualImagePaths.length === 0 || !empty;
      exampleHint.textContent = visualImagePaths.length === 0
        ? '当前没有可用立绘图片，请先导入图片后再添加示例。'
        : empty
          ? '示例只引用已导入的立绘图片，可继续替换帧图。各分层请使用同尺寸透明画布。'
          : '示例不会覆盖已有编辑；清空为 {} 后才可填入起始示例。';
    };
    const canEditVisuals = () => visualsDetails.isConnected && rows[i] === row && canEdit();
    const fillVisualExample = (kind: 'sequence' | 'layered') => {
      if (!canEditVisuals() || !draftIsEmpty() || visualImagePaths.length === 0) return;
      const sourcePath = visualImagePaths[0]!;
      const definition = kind === 'sequence'
        ? {
          version: 1,
          kind: 'sequence',
          frames: [{ image: sourcePath, durationMs: 160 }, { image: sourcePath, durationMs: 160 }],
          loop: true,
        }
        : {
          version: 1,
          kind: 'layered',
          layers: [{ id: 'base', images: { base: sourcePath }, default: 'base' }],
        };
      pushConfigHistory(false);
      row.visualsText = JSON.stringify({ outfit: { expression: definition } }, null, 2);
      visualsText.value = row.visualsText;
      updateExampleControls();
    };
    visualsText.oninput = () => {
      if (!canEditVisuals() || !visualsText.isConnected) return;
      pushConfigHistory(true);
      row.visualsText = visualsText.value;
      updateExampleControls();
    };
    sequenceExample.onclick = () => fillVisualExample('sequence');
    layeredExample.onclick = () => fillVisualExample('layered');
    const visualsLabel = h('label', 'config-field');
    visualsLabel.append(h('span', undefined, '服装 → 表情配置'), visualsText);
    visualsDetails.append(
      visualsSummary,
      h('p', 'hint', '顶层按“服装 → 表情”组织，每项定义帧动画（sequence）或分层立绘（layered）；图层数组从后向前排列。所有分层素材须使用同尺寸透明画布。保存 null 会移除立绘配置，保存对象会整体替换。'),
      visualsLabel,
      sequenceExample,
      layeredExample,
      exampleHint,
    );
    updateExampleControls();
    tdVisuals.appendChild(visualsDetails);
    tr.appendChild(tdVisuals);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  sec.appendChild(wrapConfigTable(table, '角色数据表'));
  const saveBtn = h('button', 'primary', '保存角色表');
  saveBtn.onclick = () => { void saveCharacters(); };
  ops.appendChild(saveBtn);
  sec.appendChild(ops);
  return sec;
}

/** 保存角色表：edit local draft → 保存按钮 → 共享 authoring 事务 commit（与其它配置区块保存模型一致）。 */
async function saveCharactersUnlocked(): Promise<boolean> {
  assertProjectWriteUnlocked();
  assertConfigSaveReady('gameConfig');
  const sessionRevision = configSessionRevision;
  const rows = ensureCharRows();
  const submittedRows = clone(rows);
  for (const row of submittedRows) {
    if (row.visualsText !== undefined) parseCharacterVisualsDraft(row.id, row.visualsText);
  }
  let handle = state.handles.gameConfig;
  if (!handle && state.dirHandle) {
    try {
      handle = await state.dirHandle.getFileHandle('game.config.json', { create: true });
      state.handles.gameConfig = handle;
    } catch { /* 创建失败走下方提示 */ }
  }
  if (!handle) {
    setStatus('角色表无法保存：未连接游戏目录（演示项目不落盘）', false, 6000);
    return false;
  }
  try {
    const result = await commitCharacterTable(submittedRows);
    if (sessionRevision === configSessionRevision) {
      const created = submittedRows.filter(row => row.create);
      const promote = (list: CharacterTableEditRow[] | null, restoreMissing: boolean) => {
        if (!list) return;
        for (const submitted of created) {
          const current = list.find(row => row.id === submitted.id);
          if (current) delete current.create;
          else if (restoreMissing) { const copy = clone(submitted); delete copy.create; list.push(copy); }
        }
      };
      promote(rows, true);
      for (const snap of [...configHist.past, ...configHist.future]) promote(snap.charRows, true);
      for (const row of submittedRows) delete row.create;
    }
    if (result.changed === 0) {
      markConfigSectionSaved('characters', submittedRows, sessionRevision);
      setStatus('角色表无改动', true, 4000);
      return true;
    }
    markConfigSectionSaved('characters', submittedRows, sessionRevision);
    requestValidateHook();
    const migrationNote = result.speakerMigrations.length > 0 ? `，同步迁移 ${result.speakerMigrations.length} 处台词说话人` : '';
    setStatus(`角色表已保存（${result.changed} 个角色更新${migrationNote}）`, true, 4000);
    return true;
  } catch (err) {
    const code = err instanceof AuthoringOperationError ? `${err.code}：` : '';
    setStatus(`角色表未保存：${code}${err instanceof Error ? err.message : String(err)}`, false, 8000);
    return false;
  }
}

async function saveCharacters(): Promise<void> {
  try { await runProjectWriteOperation(saveCharactersUnlocked); }
  catch (error) { setStatus(`角色表未保存：${error instanceof Error ? error.message : String(error)}`, false, 6000); }
}

function renderVariablesSection(): HTMLElement {
  const { sec, ops } = sectionShell('variables');
  const rows = ensureVarRows();
  const cols: ColDef[] = [
    { key: 'name', label: '名称' }, { key: 'type', label: '类型' }, { key: 'initial', label: '初始值' },
    { key: 'min', label: '最小值' }, { key: 'max', label: '最大值' }, { key: 'readonly', label: '只读', type: 'checkbox' },
    { key: 'description', label: '描述' },
  ];
  const table = h('table', 'config-table') as HTMLTableElement;
  const thead = h('thead');
  const hr = h('tr');
  for (const c of cols) {
    const th = h('th');
    th.appendChild(configLabel(c.label, c.key));
    hr.appendChild(th);
  }
  hr.appendChild(h('th', undefined, '操作'));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = h('tbody');
  rows.forEach((row, i) => {
    const tr = h('tr');
    const mkInput = (value: string, placeholder: string, cls: string, oninput: (v: string) => void): HTMLInputElement => {
      const inp = h('input', cls);
      inp.value = value;
      inp.placeholder = placeholder;
      inp.setAttribute('aria-label', `${placeholder}，第 ${i + 1} 行`);
      inp.oninput = () => { pushConfigHistory(true); oninput(inp.value); };
      return inp;
    };
    const tdName = h('td');
    tdName.appendChild(mkInput(row.name, '变量名', 'mono', (v) => { rows[i]!.name = v; }));
    tr.appendChild(tdName);
    const tdType = h('td');
    const sel = h('select');
    sel.setAttribute('aria-label', `变量类型，第 ${i + 1} 行`);
    for (const t of VAR_TYPES) {
      const opt = h('option', undefined, VARIABLE_TYPE_LABELS[t] ?? t);
      opt.value = t;
      if (row.type === t) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = () => { pushConfigHistory(false); rows[i]!.type = sel.value; };
    tdType.appendChild(sel);
    tr.appendChild(tdType);
    const tdInit = h('td');
    tdInit.appendChild(mkInput(row.initial, '初始值', 'mono', (v) => { rows[i]!.initial = v; }));
    tr.appendChild(tdInit);
    const tdMin = h('td');
    tdMin.appendChild(mkInput(row.min, '最小值', 'mono', (v) => { rows[i]!.min = v; }));
    tr.appendChild(tdMin);
    const tdMax = h('td');
    tdMax.appendChild(mkInput(row.max, '最大值', 'mono', (v) => { rows[i]!.max = v; }));
    tr.appendChild(tdMax);
    const tdRo = h('td');
    const ro = h('input');
    ro.type = 'checkbox';
    ro.setAttribute('aria-label', `只读变量，第 ${i + 1} 行`);
    ro.checked = row.readonly;
    ro.onchange = () => { pushConfigHistory(false); rows[i]!.readonly = ro.checked; };
    tdRo.appendChild(ro);
    tr.appendChild(tdRo);
    const tdDesc = h('td');
    tdDesc.appendChild(mkInput(row.description, '描述', '', (v) => { rows[i]!.description = v; }));
    tr.appendChild(tdDesc);
    const tdDel = h('td');
    const del = h('button', 'config-row-delete', '删除');
    del.title = '删除该变量（被剧本引用时会要求确认）';
    del.setAttribute('aria-label', `删除变量第 ${i + 1} 行`);
    del.onclick = () => { pushConfigHistory(false); rows.splice(i, 1); rerenderConfig(); };
    tdDel.appendChild(del);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  sec.appendChild(wrapConfigTable(table, '变量数据表'));
  const addBtn = h('button', undefined, '＋ 新增变量');
  addBtn.onclick = () => {
    pushConfigHistory(false);
    rows.push({ name: '', type: 'number', initial: '0', min: '', max: '', readonly: false, description: '' });
    rerenderConfig();
  };
  const saveBtn = h('button', 'primary', '保存变量表');
  saveBtn.onclick = () => { void saveVariables(); };
  ops.append(addBtn, saveBtn);
  sec.appendChild(ops);
  return sec;
}

/* ============================ 成就编辑器 ============================ */

async function saveAchievements(): Promise<void> {
  const rows = ensureAchRows();
  const submittedRows = clone(rows);
  const { json, errors } = rowsToAchievements(rows);
  await saveConfigFile('achievements', json as unknown as Record<string, unknown>, errors, '成就表', submittedRows);
}

function renderAchievementsSection(): HTMLElement {
  const { sec, ops } = sectionShell('achievements');
  const rows = ensureAchRows();

  // when 表达式的变量名下拉提示（来自变量表）
  const dl = h('datalist');
  dl.id = 'cfg-var-names';
  if (configSourceError('gameConfig')) sec.appendChild(h('p', 'dim', '项目配置无法读取，解锁条件的变量提示暂不可用。'));
  for (const row of configSourceError('gameConfig') ? [] : ensureVarRows()) {
    if (row.name.trim()) dl.appendChild(h('option', undefined, row.name.trim()));
  }
  sec.appendChild(dl);

  const table = h('table', 'config-table') as HTMLTableElement;
  const thead = h('thead');
  const hr = h('tr');
  for (const [label, key] of [
    ['成就标识', 'id'], ['名称', 'name'], ['解锁说明', 'description'], ['解锁条件', 'when'], ['隐藏', 'hidden'],
  ] as const) {
    const th = h('th');
    th.appendChild(configLabel(label, key));
    hr.appendChild(th);
  }
  hr.appendChild(h('th', undefined, '操作'));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = h('tbody');
  rows.forEach((row, i) => {
    const tr = h('tr');
    const mkInput = (value: string, placeholder: string, cls: string, oninput: (v: string) => void, list?: string): HTMLInputElement => {
      const inp = h('input', cls);
      inp.value = value;
      inp.placeholder = placeholder;
      inp.setAttribute('aria-label', `${placeholder}，第 ${i + 1} 行`);
      if (list) inp.setAttribute('list', list);
      inp.oninput = () => { pushConfigHistory(true); oninput(inp.value); };
      return inp;
    };
    const tdId = h('td');
    tdId.appendChild(mkInput(row.id, '成就标识', 'mono', (v) => { rows[i]!.id = v; }));
    tr.appendChild(tdId);
    const tdName = h('td');
    tdName.appendChild(mkInput(row.name, '展示名', '', (v) => { rows[i]!.name = v; }));
    tr.appendChild(tdName);
    const tdDesc = h('td');
    tdDesc.appendChild(mkInput(row.description, '解锁提示', '', (v) => { rows[i]!.description = v; }));
    tr.appendChild(tdDesc);
    const tdWhen = h('td');
    tdWhen.appendChild(mkInput(row.when, '如 lynn.trust >= 50', 'mono', (v) => { rows[i]!.when = v; }, 'cfg-var-names'));
    tr.appendChild(tdWhen);
    const tdHidden = h('td');
    const hid = h('input');
    hid.type = 'checkbox';
    hid.setAttribute('aria-label', `隐藏成就，第 ${i + 1} 行`);
    hid.checked = row.hidden;
    hid.onchange = () => { pushConfigHistory(false); rows[i]!.hidden = hid.checked; };
    tdHidden.appendChild(hid);
    tr.appendChild(tdHidden);
    const tdDel = h('td');
    const del = h('button', 'config-row-delete', '删除');
    del.title = '删除该成就';
    del.setAttribute('aria-label', `删除成就第 ${i + 1} 行`);
    del.onclick = () => { pushConfigHistory(false); rows.splice(i, 1); rerenderConfig(); };
    tdDel.appendChild(del);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  sec.appendChild(wrapConfigTable(table, '成就数据表'));

  const addBtn = h('button', undefined, '＋ 新增成就');
  addBtn.onclick = () => {
    pushConfigHistory(false);
    rows.push({ id: '', name: '', description: '', when: '', hidden: false });
    rerenderConfig();
  };
  const saveBtn = h('button', 'primary', '保存成就表');
  saveBtn.onclick = () => { void saveAchievements(); };
  ops.append(addBtn, saveBtn);
  sec.appendChild(ops);
  return sec;
}

/* ============================ 日历编辑器 ============================ */

function renderCalendarSection(): HTMLElement {
  const { sec, ops } = sectionShell('calendar');
  const cal = ensureCalRows();
  sec.appendChild(renderScalarGrid([
    { key: 'maxAp', label: '每回合行动点上限' },
    { key: 'maxTurns', label: '总回合数' },
    { key: 'weeksPerMonth', label: '每月周数' },
    { key: 'dateTemplate', label: '日期显示模板' },
    { key: 'onTurnStartEventId', label: '回合开始事件' },
    { key: 'onTurnEndEventId', label: '回合结束事件' },
  ], cal.scalars));

  // 地图可视化摆放（拖拽节点改 x/y，松手后 rerender 同步表格；拖拽前与连线编辑变更前拍撤销快照）
  const mapSection = configSubsection('地图编排');
  mapSection.appendChild(h('p', 'config-section-help', '拖拽节点调整位置；从节点连接点拖向另一节点可建立前置关系，点击连线可删除关系。'));
  const mapWrap = h('div', 'config-map-stage');
  mapSection.appendChild(mapWrap);
  sec.appendChild(mapSection);
  renderCalendarMap(mapWrap, cal.nodes, () => {
    rerenderConfig();
    notifyConfigDraftStateChanged();
  }, {
    onDragStart: () => pushConfigHistory(false, false),
    onBeforeEdit: () => pushConfigHistory(false, false), // 连线增删也可 Ctrl+Z 撤销（审阅轮 Minor 1 修复）
  });

  const detailTables = h('details', 'config-table-details');
  detailTables.open = cal.nodes.length === 0;
  detailTables.appendChild(h('summary', undefined, '节点与指令明细'));
  const nodesSection = configSubsection('地图节点');
  nodesSection.appendChild(renderObjectTable([
    { key: 'id', label: '节点标识' }, { key: 'name', label: '名称' },
    { key: 'x', label: '横坐标' }, { key: 'y', label: '纵坐标' },
    { key: 'isBase', label: '据点', type: 'checkbox' },
    { key: 'apCost', label: '行动点消耗' },
    { key: 'requires', label: '前置节点', type: 'json' },
    { key: 'visibleWhen', label: '开放条件' },
    { key: 'eventId', label: '关联事件' },
  ], cal.nodes, { id: '', name: '', x: '', y: '', isBase: false, apCost: '', requires: '', visibleWhen: '', eventId: '' }, {
    label: '地图节点', addLabel: '新增节点',
  }));
  detailTables.appendChild(nodesSection);

  const commandsSection = configSubsection('据点指令');
  commandsSection.appendChild(renderObjectTable([
    { key: 'id', label: '指令标识' }, { key: 'name', label: '名称' }, { key: 'apCost', label: '行动点消耗' },
    { key: 'when', label: '可用条件' },
    { key: 'effects', label: '执行效果', type: 'json' },
    { key: 'perTurn', label: '每回合次数上限' },
  ], cal.baseCommands, { id: '', name: '', apCost: '', when: '', effects: '', perTurn: '' }, {
    label: '据点指令', addLabel: '新增据点指令',
  }));
  detailTables.appendChild(commandsSection);
  sec.appendChild(detailTables);

  const saveBtn = h('button', 'primary', '保存日历配置');
  saveBtn.onclick = () => {
    const rows = ensureCalRows();
    const submittedRows = clone(rows);
    const { json, errors } = rowsToCalendar(state.configFiles.calendar, rows);
    void saveConfigFile('calendar', json, errors, '日历配置', submittedRows);
  };
  ops.appendChild(saveBtn);
  sec.appendChild(ops);
  return sec;
}

/* ============================ 成长编辑器 ============================ */

function renderGrowthSection(): HTMLElement {
  const { sec, ops } = sectionShell('growth');
  const gr = ensureGrRows();
  sec.appendChild(renderScalarGrid([
    { key: 'curve.base', label: '经验曲线基础值' },
    { key: 'curve.linear', label: '经验曲线线性项' },
  ], gr.scalars));

  const profilesSection = configSubsection('成长档案');
  profilesSection.appendChild(renderObjectTable([
    { key: 'characterId', label: '角色标识' },
    { key: 'initialLevel', label: '初始等级' },
    { key: 'maxLevel', label: '等级上限' },
    { key: 'statGrowth', label: '每级属性成长', type: 'json' },
    { key: 'levelEvents', label: '等级事件', type: 'json' },
  ], gr.profiles, { characterId: '', initialLevel: '1', maxLevel: '', statGrowth: '{}', levelEvents: '{}' }, {
    label: '成长档案', addLabel: '新增成长档案',
  }));
  sec.appendChild(profilesSection);

  const saveBtn = h('button', 'primary', '保存成长配置');
  saveBtn.onclick = () => {
    const rows = ensureGrRows();
    const submittedRows = clone(rows);
    const { json, errors } = rowsToGrowth(state.configFiles.growth, rows);
    void saveConfigFile('growth', json, errors, '成长配置', submittedRows);
  };
  ops.appendChild(saveBtn);
  sec.appendChild(ops);
  return sec;
}

/* ============================ 事件编辑器 ============================ */

function renderEventsSection(): HTMLElement {
  const { sec, ops } = sectionShell('events');
  const ev = ensureEvRows();

  const profilesSection = configSubsection('角色阶段文案');
  profilesSection.appendChild(renderObjectTable([
    { key: 'characterId', label: '角色标识' },
    { key: 'variable', label: '好感变量' },
    { key: 'tiers', label: '阶段规则', type: 'json' },
  ], ev.profiles, { characterId: '', variable: '', tiers: '[]' }, {
    label: '角色阶段', addLabel: '新增角色阶段',
  }));
  sec.appendChild(profilesSection);

  const eventCols: ColDef[] = [
    { key: 'id', label: '事件标识' }, { key: 'characterId', label: '角色' },
    { key: 'when', label: '触发条件' }, { key: 'scene', label: '场景' },
    { key: 'once', label: '仅一次', type: 'checkbox' }, { key: 'priority', label: '优先级' },
    { key: 'effects', label: '执行效果', type: 'json' },
  ];
  const emptyEvent: RowMap = { id: '', characterId: '', when: '', scene: '', once: true, priority: '', effects: '' };

  const eventsSection = configSubsection('条件事件');
  eventsSection.appendChild(renderObjectTable(eventCols, ev.events, emptyEvent, { label: '条件事件', addLabel: '新增条件事件' }));
  sec.appendChild(eventsSection);
  const scheduledSection = configSubsection('日程事件');
  scheduledSection.appendChild(h('p', 'config-section-help', '由回合进度驱动，使用与条件事件相同的字段。'));
  scheduledSection.appendChild(renderObjectTable(eventCols, ev.scheduled, emptyEvent, { label: '日程事件', addLabel: '新增日程事件' }));
  sec.appendChild(scheduledSection);

  const saveBtn = h('button', 'primary', '保存事件配置');
  saveBtn.onclick = () => {
    const rows = ensureEvRows();
    const submittedRows = clone(rows);
    const { json, errors } = rowsToEvents(state.configFiles.events, rows);
    void saveConfigFile('events', json, errors, '事件配置', submittedRows);
  };
  ops.appendChild(saveBtn);
  sec.appendChild(ops);
  return sec;
}

/* ============================ 鉴赏编辑器 ============================ */

function renderGallerySection(): HTMLElement {
  const { sec, ops } = sectionShell('gallery');
  const ga = ensureGaRows();
  const cgCols: ColDef[] = [
    { key: 'id', label: '条目标识' }, { key: 'name', label: '名称' }, { key: 'src', label: '素材来源' },
  ];
  const cgSection = configSubsection('图片鉴赏');
  cgSection.appendChild(renderObjectTable(cgCols, ga.cgs, { id: '', name: '', src: '' }, { label: '图片鉴赏', addLabel: '新增图片' }));
  sec.appendChild(cgSection);
  const musicSection = configSubsection('音乐鉴赏');
  musicSection.appendChild(renderObjectTable(cgCols, ga.music, { id: '', name: '', src: '' }, { label: '音乐鉴赏', addLabel: '新增音乐' }));
  sec.appendChild(musicSection);
  const textsSection = configSubsection('剧情回想');
  textsSection.appendChild(renderObjectTable([
    { key: 'id', label: '回想标识' }, { key: 'name', label: '名称' },
    { key: 'scene', label: '回放场景' }, { key: 'label', label: '回放标签' },
  ], ga.texts, { id: '', name: '', scene: '', label: '' }, { label: '剧情回想', addLabel: '新增回想' }));
  sec.appendChild(textsSection);

  const saveBtn = h('button', 'primary', '保存鉴赏配置');
  saveBtn.onclick = () => {
    const rows = ensureGaRows();
    const submittedRows = clone(rows);
    const { json, errors } = rowsToGallery(state.configFiles.gallery, rows);
    void saveConfigFile('gallery', json, errors, '鉴赏配置', submittedRows);
  };
  ops.appendChild(saveBtn);
  sec.appendChild(ops);
  return sec;
}

/* ============================ 名词表编辑器（术语审计闭环） ============================ */

/** 审计面板一键加变体（main.ts 路由）：把 variant 收进 canonical 的 variants（无条目则新建），
 *  直接校验写盘 terminology.json；与配置页编辑共享行模型缓存与撤销栈 */
export async function addTerminologyVariant(canonical: string, variant: string): Promise<void> {
  if (state.projectLoading) {
    setStatus('项目正在切换，名词表未修改', false, 4000);
    return;
  }
  try {
    const sessionRevision = configSessionRevision;
    await runProjectWriteOperation(async () => {
      const rows = ensureTermRows();
      let row = rows.terms.find((r) => String(r.canonical ?? '').trim() === canonical);
      let list: string[] = [];
      if (row) {
        try {
          const value: unknown = JSON.parse(String(row.variants ?? '[]'));
          if (Array.isArray(value)) list = value.filter((item): item is string => typeof item === 'string');
        } catch { list = []; }
        if (list.includes(variant)) {
          setStatus(`变体 '${variant}' 已在规范词 '${canonical}' 的名词条目中`, true, 4000);
          return;
        }
      }
      pushConfigHistory(false);
      if (!row) {
        row = { canonical, variants: '[]' };
        rows.terms.push(row);
      }
      list.push(variant);
      row.variants = JSON.stringify(list);
      const { json, errors } = rowsToTerminology(state.configFiles.terminology, rows);
      const submittedRows = clone(rows);
      await saveConfigFileUnlocked('terminology', json, errors, '名词表', submittedRows, sessionRevision);
    });
  } catch (error) {
    setStatus(`名词表未修改：${error instanceof Error ? error.message : String(error)}`, false, 4000);
  }
}

/** 名词表导出（内存行模型 → 校验 → 下载 terminology.json；未保存的编辑一并导出） */
function exportTerminology(): void {
  const { json, errors } = rowsToTerminology(state.configFiles.terminology, ensureTermRows());
  if (errors.length > 0) {
    setStatus(`名词表导出失败：${errors[0]}`, false, 6000);
    return;
  }
  const blob = new Blob([JSON.stringify(json, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a');
  a.href = url;
  a.download = 'terminology.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  setStatus('名词表已导出（terminology.json）', true, 4000);
}

/** 名词表导入（替换内存行模型；不自动写盘，需点“保存名词表”） */
function importTerminology(file: File): void {
  const revision = configSessionRevision;
  void file.text().then((txt) => {
    if (revision !== configSessionRevision || state.projectLoading) return;
    assertProjectWriteUnlocked();
    let raw: unknown;
    try {
      raw = JSON.parse(txt);
    } catch {
      setStatus('名词表导入失败：文件不是合法 JSON', false, 6000);
      return;
    }
    const res = normalizeTerminologyImport(raw);
    if ('error' in res) {
      setStatus(`名词表导入失败：${res.error}`, false, 6000);
      return;
    }
    pushConfigHistory(false);
    termRows = { terms: res.terms };
    rerenderConfig();
    setStatus(`已导入 ${res.terms.length} 条名词（未写盘，确认后点“保存名词表”）`, true, 6000);
  }).catch(error => {
    if (revision === configSessionRevision) setStatus(`名词表导入失败：${error instanceof Error ? error.message : String(error)}`, false, 6000);
  });
}

function renderThemeSection(): HTMLElement {
  const { sec, ops } = sectionShell('theme');
  sec.appendChild(h('p', 'config-section-help', '可配置颜色、透明度、字号、皮肤与布局，以及标题字标、标题背景和字体。下方配置文本中的字段名须保留原样；图片填背景素材键，字体填项目内完整路径。主题字段填 null 或删除已支持的主题字段可恢复默认；未涉及的来源字段会保留，省略字体或标题背景字段会保持原值。'));
  const form = h('textarea');
  form.rows = 18;
  form.spellcheck = false;
  form.className = 'theme-config-json';
  form.setAttribute('aria-label', '主题配置文本');
  form.value = readThemeConfigDraft();
  const status = h('p', 'dim');
  form.oninput = () => {
    try { editThemeConfigDraft(form.value, true); status.textContent = ''; }
    catch (error) { status.textContent = `主题草稿未更新：${error instanceof Error ? error.message : String(error)}`; }
  };
  const saveBtn = h('button', 'primary', '保存主题配置');
  saveBtn.onclick = async () => {
    status.textContent = '正在保存…';
    try {
      await runProjectWriteOperation(saveThemeConfigDraftUnlocked);
      status.textContent = '主题配置已保存。重新播放后使用新配置。';
    } catch (error) {
      status.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const reloadBtn = h('button', undefined, '放弃编辑并重读');
  reloadBtn.onclick = () => {
    try { form.value = reloadThemeConfigDraft(); status.textContent = '已从来源配置重读。'; }
    catch (error) { status.textContent = `主题配置重读失败：${error instanceof Error ? error.message : String(error)}`; }
  };
  ops.append(saveBtn, reloadBtn);
  sec.append(form, status, ops);
  return sec;
}

function renderUiSection(): HTMLElement {
  const { sec, ops } = sectionShell('ui');
  const status = h('p', 'dim');
  const designer = renderUiDesigner({
    read: readUiConfigDraft,
    edit: editUiConfigDraft,
    replace: replaceUiConfigDraft,
    reload: reloadUiConfigDraft,
    save: () => runProjectWriteOperation(saveUiConfigDraftUnlocked),
    preview: () => openUiPlayerPreview(previewUiConfigText(previewThemeConfigText(previewStageConfigText(state.gameConfigText)))),
    exportShare: async fragment => {
      const root = state.dirHandle;
      const config = parseProjectConfigDocument(previewUiConfigText(previewThemeConfigText(state.gameConfigText)));
      const share = await exportUiShare(config, shareAssets(), fragment);
      if (state.dirHandle !== root) throw new Error('导出期间项目已切换');
      const url = URL.createObjectURL(new Blob([JSON.stringify(share, null, 2)], { type: 'application/json' }));
      const link = h('a'); link.href = url; link.download = fragment ? 'surdet-ui-fragment.json' : 'surdet-ui-theme.json';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = '已导出界面数据及必要图片/字体，不包含剧情、存档或项目私有字段。片段继承目标作品的主题与字体。';
    },
    importShare: async (file, target) => {
      assertProjectWriteUnlocked();
      if (state.reviewWorkspace || state.reviewPreviewReadOnly || state.projectLoading) throw new Error('当前项目不可导入界面');
      const root = state.dirHandle, revision = configSessionRevision;
      const config = parseProjectConfigDocument(previewUiConfigText(previewThemeConfigText(state.gameConfigText)));
      const share = readUiShare(await file.text(), config);
      const missing = await missingUiShareAssets(share, shareAssets());
      if (root !== state.dirHandle || revision !== configSessionRevision) throw new Error('导入期间项目或草稿已变化，请重试');
      assertProjectWriteUnlocked();
      if (state.reviewWorkspace || state.reviewPreviewReadOnly || state.projectLoading) throw new Error('当前项目不可导入界面');
      if (missing.length) {
        if (!stageSharedAssetsHook) throw new Error('缺少素材，请先通过现有素材导入工作台导入共享包的图片/字体');
        stageSharedAssetsHook(missing);
        setStatus('依赖已加入素材导入待选区；确认导入后，再次导入此共享文件即可生成界面草稿。', true, 10000);
        return;
      }
      if (share.kind === 'fragment') {
        const source = readProjectUi({ ...share.config, variables: config.variables })!;
        const page = Object.keys(source.pages)[0];
        if (page !== target.page) throw new Error('片段页面类型不同，请先切换到对应页面');
        const node = copySharedFragment(Object.values(source.pages)[0]!, `import_${crypto.randomUUID().replaceAll('-', '')}`);
        if (target.parentId) {
          const parent = (function find(current: import('@surdet/core').ProjectUiNode): import('@surdet/core').ProjectUiNode | undefined {
            return current.id === target.parentId ? current : current.children?.map(find).find(Boolean);
          })(readUiConfigDraft()!.pages[target.page]!);
          editUiConfigDraft({ type: 'node.insert', page: target.page, parentId: target.parentId, index: parent?.children?.length ?? 0, node });
        } else editUiConfigDraft({ type: 'page.set', page: target.page, root: node });
      } else {
        const imported = share.config;
        const nextUi = readProjectUi({ ...imported, variables: config.variables });
        const player = imported.player as Record<string, unknown> | undefined;
        const form = JSON.stringify({ theme: imported.theme ?? null, titleLogo: player?.titleLogo ?? null,
          titleBackground: player?.titleBackground ?? null, font: null, fonts: imported.fonts ?? {} }, null, 2);
        projectThemeEditorDraft(config, parseThemeEditorDraft(form));
        if (!window.confirm('将此作品主题和页面放入当前草稿？尚未保存的界面编辑会被替换，可撤销；源文件不会立即改写。')) return;
        readUiConfigDraft(); readThemeConfigDraft(); pushConfigHistory(false);
        uiDraft = nextUi; themeDraft = form; configSessionLoaded = true; scheduleConfigDraftStateChanged();
        rerenderConfig();
      }
      setStatus('已生成界面草稿。可试玩、撤销；保存全部后才写回项目。', true, 8000);
    },
    onStatus: (message, ok = true) => { status.textContent = message; setStatus(message, ok, 5000); },
    undo: configUndo,
    redo: configRedo,
  });
  sec.append(designer, status, ops);
  return sec;
}

function shareAssets(): ShareAsset[] {
  return state.dirAssets.flatMap(asset => {
    const path = asset.sourcePath ?? (asset.handle ? assetPathForHandle(asset.handle) : undefined);
    return path && asset.handle ? [{ path, read: () => asset.handle!.getFile() }] : [];
  });
}

function renderTerminologySection(): HTMLElement {
  const { sec, ops } = sectionShell('terminology');
  const tt = ensureTermRows();
  sec.appendChild(h('p', 'config-section-help', '剧本或选项使用变体词时，审计页会提示改用对应的规范词；保存后即时生效。'));
  sec.appendChild(renderObjectTable([
    { key: 'canonical', label: '规范词' },
    { key: 'variants', label: '变体列表', type: 'json' },
  ], tt.terms, { canonical: '', variants: '[]' }, { label: '名词', addLabel: '新增名词' }));

  const exportBtn = h('button', undefined, '导出名词表');
  exportBtn.title = '把当前名词表（含未保存编辑）下载为 terminology.json';
  exportBtn.onclick = exportTerminology;
  const importBtn = h('button', undefined, '导入名词表');
  importBtn.title = '从 terminology.json 文件导入（替换当前表格，需另点保存才写盘）';
  const fileInput = h('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.style.display = 'none';
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (f) importTerminology(f);
    fileInput.value = '';
  };
  importBtn.onclick = () => fileInput.click();
  const saveBtn = h('button', 'primary', '保存名词表');
  saveBtn.onclick = () => {
    const rows = ensureTermRows();
    const submittedRows = clone(rows);
    const { json, errors } = rowsToTerminology(state.configFiles.terminology, rows);
    void saveConfigFile('terminology', json, errors, '名词表', submittedRows);
  };
  ops.append(exportBtn, importBtn, fileInput, saveBtn);
  sec.appendChild(ops);
  return sec;
}

export interface ConfigSaveOutcome {
  saved: number;
  failures: number;
  remainingDirty: boolean;
}

/**
 * 在 project-io 已取得项目写入边界时保存所有 dirty 配置区块。
 * 各配置区仍复用自己的校验、共享事务和写盘实现；此入口不再次申请写锁。
 */
export async function saveDirtyConfigSections(): Promise<ConfigSaveOutcome> {
  const dirtySections = inspectConfigDraftState().dirtySections;
  let saved = 0;
  let failures = 0;
  for (const section of dirtySections) {
    let ok = false;
    try {
      switch (section) {
        case 'texts':
          throw new Error('译稿或绑定清单尚未确认，请在“文本与译稿”明确保存绑定，或预览差异并确认导入；草稿已保留。');
        case 'stage':
          await saveStageConfigDraftUnlocked();
          ok = true;
          break;
        case 'theme':
          await saveThemeConfigDraftUnlocked();
          ok = true;
          break;
        case 'ui':
          await saveUiConfigDraftUnlocked();
          ok = true;
          break;
        case 'characters':
          ok = await saveCharactersUnlocked();
          break;
        case 'variables':
          ok = await saveVariablesUnlocked();
          break;
        case 'achievements': {
          const rows = ensureAchRows();
          const submittedRows = clone(rows);
          const { json, errors } = rowsToAchievements(rows);
          ok = await saveConfigFileUnlocked('achievements', json as unknown as Record<string, unknown>, errors, '成就表', submittedRows, configSessionRevision);
          break;
        }
        case 'calendar': {
          const rows = ensureCalRows();
          const submittedRows = clone(rows);
          const { json, errors } = rowsToCalendar(state.configFiles.calendar, rows);
          ok = await saveConfigFileUnlocked('calendar', json, errors, '日历配置', submittedRows, configSessionRevision);
          break;
        }
        case 'growth': {
          const rows = ensureGrRows();
          const submittedRows = clone(rows);
          const { json, errors } = rowsToGrowth(state.configFiles.growth, rows);
          ok = await saveConfigFileUnlocked('growth', json, errors, '成长配置', submittedRows, configSessionRevision);
          break;
        }
        case 'events': {
          const rows = ensureEvRows();
          const submittedRows = clone(rows);
          const { json, errors } = rowsToEvents(state.configFiles.events, rows);
          ok = await saveConfigFileUnlocked('events', json, errors, '事件配置', submittedRows, configSessionRevision);
          break;
        }
        case 'gallery': {
          const rows = ensureGaRows();
          const submittedRows = clone(rows);
          const { json, errors } = rowsToGallery(state.configFiles.gallery, rows);
          ok = await saveConfigFileUnlocked('gallery', json, errors, '鉴赏配置', submittedRows, configSessionRevision);
          break;
        }
        case 'terminology': {
          const rows = ensureTermRows();
          const submittedRows = clone(rows);
          const { json, errors } = rowsToTerminology(state.configFiles.terminology, rows);
          ok = await saveConfigFileUnlocked('terminology', json, errors, '名词表', submittedRows, configSessionRevision);
          break;
        }
      }
    } catch (error) {
      setStatus(`配置“${section}”未保存：${error instanceof Error ? error.message : String(error)}`, false, 6000);
    }
    if (ok) saved++;
    else failures++;
  }
  return { saved, failures, remainingDirty: inspectConfigDraftState().dirty };
}

/* ============================ 入口 ============================ */

/** 渲染配置标签页；同一项目已有草稿/历史时复用内存态，避免重进工作面丢失编辑。 */
export function renderConfig(container: HTMLElement): void {
  if (state.pendingSceneConfigRenames.length > 0 || editorWorkspaceStatus().protection !== 'unavailable') {
    renderConfigWorkspace(container);
    if (!configSessionLoaded) {
      captureAllConfigBaselines();
      configSessionLoaded = true;
    }
    return;
  }
  const history = configHistoryDepth();
  if (configSessionLoaded && (inspectConfigDraftState().dirty || history.past > 0 || history.future > 0)) {
    renderConfigWorkspace(container);
    return;
  }
  container.innerHTML = '';
  const loading = h('div', 'dim', '正在读取配置文件…');
  loading.style.padding = '12px';
  container.appendChild(loading);
  const revision = ++configSessionRevision;
  void refreshConfigSources(revision).then((current) => {
    if (!current) return;
    clearConfigRowsAndHistory();
    renderConfigWorkspace(container);
    captureAllConfigBaselines();
    configSessionLoaded = true;
    notifyConfigDraftStateChanged();
  });
}
