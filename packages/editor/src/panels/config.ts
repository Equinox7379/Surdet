/**
 * 配置标签页（Frontend Pass 4）：角色、变量、成就、日历与地图、成长、事件、鉴赏、名词表八类配置台账。
 *  - 打开时从盘上重新读取源文件（外部修改即时可见）
 *  - 表格 ⇄ JSON 双向转换与校验全部经 config-edit.ts 纯逻辑（落盘前必过校验）
 *  - 写盘 2 空格缩进、键序稳定、未知字段经原条目合并保留；无目录连接时诚实提示
 *  - 复杂字段（effects/tiers/statGrowth/levelEvents/requires）以 JSON 文本列编辑
 *  - 配置编辑撤销/重做（快照栈：打字合并 + 50 步上限，与剧本 undo 分栈，main.ts 按标签页路由）
 *  - 名词表导入/导出；审计面板一键加变体入口（addTerminologyVariant）
 */
import { state, h, setStatus } from '../state.js';
import { writeFileHandle } from '../project-io.js';
import { AuthoringOperationError } from '@surdet/authoring';
import { commitCharacterTable, type CharacterTableEditRow } from '../authoring-project-storage.js';
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
import { createSnapshotHistory, snapshotPush, snapshotUndo, snapshotRedo } from '../history.js';

/** 校验刷新钩子（main.ts 注入：scheduleValidate） */
let requestValidateHook: () => void = () => {};
export function bindConfigHooks(opts: { requestValidate: () => void }): void {
  requestValidateHook = opts.requestValidate;
}

type ConfigSectionId =
  | 'characters'
  | 'variables'
  | 'achievements'
  | 'calendar'
  | 'growth'
  | 'events'
  | 'gallery'
  | 'terminology';

interface ConfigSectionDescriptor {
  id: ConfigSectionId;
  label: string;
  description: string;
  file: string;
  render: () => HTMLElement;
}

const CONFIG_SECTIONS: readonly ConfigSectionDescriptor[] = [
  { id: 'characters', label: '角色', description: '管理说话人显示名称、头像与稳定角色身份。', file: 'game.config.json', render: renderCharactersSection },
  { id: 'variables', label: '变量', description: '定义剧情状态、初始值、范围和只读约束。', file: 'game.config.json', render: renderVariablesSection },
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

function renderConfigWorkspace(root: HTMLElement): void {
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
  const technicalToggle = h('button', 'config-technical-toggle', showConfigTechnicalNames ? '隐藏技术名称' : '显示技术名称');
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

    const panel = descriptor.render();
    panel.hidden = descriptor.id !== activeConfigSectionId;
    panels.set(descriptor.id, panel);
    ledger.appendChild(panel);
  }

  technicalToggle.onclick = () => {
    showConfigTechnicalNames = !showConfigTechnicalNames;
    workspace.dataset.showTechnicalNames = String(showConfigTechnicalNames);
    root.dataset.showTechnical = String(showConfigTechnicalNames);
    technicalToggle.textContent = showConfigTechnicalNames ? '隐藏技术名称' : '显示技术名称';
    technicalToggle.setAttribute('aria-pressed', String(showConfigTechnicalNames));
  };
  selectSection(activeConfigSectionId);
  index.appendChild(indexItems);
  workspace.append(index, ledger);
  root.appendChild(workspace);
}

/** 本地重建全部区块（保留内存行模型与未保存输入；仅增删行时用）。
 *  从盘重读+置空行缓存只属于 renderConfig（标签页进入入口，M4 审阅轮 Major 1 修复） */
function rerenderConfig(): void {
  const root = document.getElementById('config-view');
  if (!root) return;
  renderConfigWorkspace(root);
}

/* ---- 行模型缓存（切换标签页重入时从盘上源重载） ---- */
let charRows: CharacterTableEditRow[] | null = null;
let varRows: VariableRow[] | null = null;
let achRows: AchievementRow[] | null = null;
let calRows: CalendarRows | null = null;
let evRows: EventsRows | null = null;
let grRows: GrowthRows | null = null;
let gaRows: GalleryRows | null = null;
let termRows: TerminologyTableRows | null = null;

/** 打开配置页时从盘上重读源文件（外部改动即时可见；失败沿用内存态） */
async function refreshConfigSources(): Promise<void> {
  try {
    if (state.handles.gameConfig) {
      state.gameConfigText = await (await state.handles.gameConfig.getFile()).text();
    }
  } catch { /* 读取失败沿用内存态 */ }
  for (const name of ['achievements', 'calendar', 'events', 'growth', 'gallery', 'terminology'] as const) {
    try {
      const fh = state.handles[name];
      if (fh) state.configFiles[name] = JSON.parse(await (await fh.getFile()).text()) as unknown;
    } catch { /* 同上 */ }
  }
}

function parseConfigObj(): Record<string, unknown> {
  try {
    return state.gameConfigText.trim() ? JSON.parse(state.gameConfigText) as Record<string, unknown> : {};
  } catch {
    return {};
  }
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
  gameConfigText: string;
}

const configHist = createSnapshotHistory<ConfigSnapshot>();

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function takeConfigSnapshot(): ConfigSnapshot {
  return { ...clone({ charRows, varRows, achRows, calRows, evRows, grRows, gaRows, termRows }), gameConfigText: state.gameConfigText };
}

/** 变更前拍快照。coalesce=true：连续打字合并（同一撤销点）；结构操作（增删行/拖拽/导入）传 false */
function pushConfigHistory(coalesce: boolean): void {
  snapshotPush(configHist, takeConfigSnapshot(), Date.now(), coalesce);
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
  wrap.append(h('code', 'config-technical-key', technicalKey));
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
        const inp = h('input', c.type === 'json' ? 'mono' : '');
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
async function saveConfigFile(
  name: 'achievements' | 'calendar' | 'events' | 'growth' | 'gallery' | 'terminology',
  json: Record<string, unknown>,
  errors: string[],
  label: string,
): Promise<void> {
  if (errors.length > 0) {
    setStatus(`${label}未保存：${errors[0]}${errors.length > 1 ? `（另有 ${errors.length - 1} 条）` : ''}`, false, 6000);
    return;
  }
  let handle = state.handles[name];
  if (!handle && state.dirHandle) {
    try {
      const contentDir = await state.dirHandle.getDirectoryHandle('content', { create: true });
      const configDir = await contentDir.getDirectoryHandle('config', { create: true });
      handle = await configDir.getFileHandle(`${name}.json`, { create: true });
      state.handles[name] = handle;
    } catch { /* 创建失败走下方提示 */ }
  }
  if (!handle) {
    setStatus(`${label}无法保存：未连接游戏目录（演示项目不落盘）`, false, 6000);
    return;
  }
  try {
    await writeFileHandle(handle, JSON.stringify(json, null, 2) + '\n');
  } catch (err) {
    setStatus(`${label}写入失败：${err instanceof Error ? err.message : String(err)}`, false, 6000);
    return;
  }
  state.configFiles[name] = json;
  requestValidateHook();
  setStatus(`${label}已保存`, true, 4000);
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
  technical.append(h('summary', undefined, '技术信息'));
  const technicalBody = h('div', 'config-technical-body');
  technicalBody.append(h('span', undefined, '来源文件'));
  technicalBody.append(h('code', 'config-technical-key', descriptor.file));
  technical.appendChild(technicalBody);
  header.appendChild(technical);
  sec.appendChild(header);
  const ops = h('div', 'config-actions');
  return { sec, ops };
}

/* ============================ 变量表编辑器 ============================ */

async function saveVariables(): Promise<void> {
  const rows = ensureVarRows();
  const { variables, errors } = rowsToVariables(rows);
  if (errors.length > 0) {
    setStatus(`变量表未保存：${errors[0]}${errors.length > 1 ? `（另有 ${errors.length - 1} 条）` : ''}`, false, 6000);
    return;
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
      return;
    }
  }
  let handle = state.handles.gameConfig;
  if (!handle && state.dirHandle) {
    try {
      handle = await state.dirHandle.getFileHandle('game.config.json', { create: true });
      state.handles.gameConfig = handle;
    } catch { /* 创建失败走下方提示 */ }
  }
  if (!handle) {
    setStatus('变量表无法保存：未连接游戏目录（演示项目不落盘）', false, 6000);
    return;
  }
  const text = applyVariablesToConfig(state.gameConfigText, variables);
  try {
    await writeFileHandle(handle, text + '\n');
  } catch (err) {
    setStatus(`变量表写入失败：${err instanceof Error ? err.message : String(err)}`, false, 6000);
    return;
  }
  state.gameConfigText = text;
  requestValidateHook();
  setStatus(`变量表已保存（${Object.keys(variables).length} 个变量）`, true, 4000);
}

/** 角色表（Wave 3 closure）：显示名/头像可编辑；保存经 @surdet/authoring 的共享
 *  character.ensure 事务语义写盘（与 CLI / Agent 同一 semantic truth），编辑器不复制第二套写实现。
 *  ID 是语义身份，本轮保持只读（rename 属于更大的引用迁移能力）。 */
function renderCharactersSection(): HTMLElement {
  const { sec, ops } = sectionShell('characters');
  const rows = ensureCharRows();
  if (rows.length === 0) {
    sec.appendChild(h('div', 'config-empty', '暂无角色。创建角色后，可在这里维护显示名称与头像。'));
    return sec;
  }
  const table = h('table', 'config-table') as HTMLTableElement;
  const thead = h('thead');
  const hr = h('tr');
  for (const [label, key] of [['角色标识', 'id'], ['显示名称', 'name'], ['头像素材', 'avatar']] as const) {
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
    tdId.title = '角色 ID 是语义身份（speaker/因果/avatar 引用键），暂不支持在编辑器改名';
    tr.appendChild(tdId);
    const tdName = h('td');
    const name = h('input');
    name.value = row.name;
    name.placeholder = '角色在界面中显示的名称';
    name.setAttribute('aria-label', `${row.id} 的显示名称`);
    name.oninput = () => { pushConfigHistory(true); rows[i]!.name = name.value; };
    tdName.appendChild(name);
    tr.appendChild(tdName);
    const tdAvatar = h('td');
    const avatar = h('input', 'mono');
    avatar.value = row.avatar;
    avatar.placeholder = '留空可清除头像';
    avatar.setAttribute('aria-label', `${row.id} 的头像素材`);
    avatar.oninput = () => { pushConfigHistory(true); rows[i]!.avatar = avatar.value; };
    tdAvatar.appendChild(avatar);
    tr.appendChild(tdAvatar);
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
async function saveCharacters(): Promise<void> {
  const rows = ensureCharRows();
  let handle = state.handles.gameConfig;
  if (!handle && state.dirHandle) {
    try {
      handle = await state.dirHandle.getFileHandle('game.config.json', { create: true });
      state.handles.gameConfig = handle;
    } catch { /* 创建失败走下方提示 */ }
  }
  if (!handle) {
    setStatus('角色表无法保存：未连接游戏目录（演示项目不落盘）', false, 6000);
    return;
  }
  try {
    const result = await commitCharacterTable(rows);
    if (result.changed === 0) {
      setStatus('角色表无改动', true, 4000);
      return;
    }
    charRows = null; // 提交成功：行缓存从新基线重建
    rerenderConfig();
    requestValidateHook();
    const migrationNote = result.speakerMigrations.length > 0 ? `，同步迁移 ${result.speakerMigrations.length} 处台词 speaker` : '';
    setStatus(`角色表已保存（${result.changed} 个角色更新${migrationNote}）`, true, 4000);
  } catch (err) {
    const code = err instanceof AuthoringOperationError ? `${err.code}：` : '';
    setStatus(`角色表未保存：${code}${err instanceof Error ? err.message : String(err)}`, false, 8000);
  }
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
  const { json, errors } = rowsToAchievements(rows);
  await saveConfigFile('achievements', json as unknown as Record<string, unknown>, errors, '成就表');
}

function renderAchievementsSection(): HTMLElement {
  const { sec, ops } = sectionShell('achievements');
  const rows = ensureAchRows();

  // when 表达式的变量名下拉提示（来自变量表）
  const dl = h('datalist');
  dl.id = 'cfg-var-names';
  for (const row of ensureVarRows()) {
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
  renderCalendarMap(mapWrap, cal.nodes, rerenderConfig, {
    onDragStart: () => pushConfigHistory(false),
    onBeforeEdit: () => pushConfigHistory(false), // 连线增删也可 Ctrl+Z 撤销（审阅轮 Minor 1 修复）
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
    const { json, errors } = rowsToCalendar(state.configFiles.calendar, ensureCalRows());
    void saveConfigFile('calendar', json, errors, '日历配置');
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
    const { json, errors } = rowsToGrowth(state.configFiles.growth, ensureGrRows());
    void saveConfigFile('growth', json, errors, '成长配置');
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
    const { json, errors } = rowsToEvents(state.configFiles.events, ensureEvRows());
    void saveConfigFile('events', json, errors, '事件配置');
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
    const { json, errors } = rowsToGallery(state.configFiles.gallery, ensureGaRows());
    void saveConfigFile('gallery', json, errors, '鉴赏配置');
  };
  ops.appendChild(saveBtn);
  sec.appendChild(ops);
  return sec;
}

/* ============================ 名词表编辑器（术语审计闭环） ============================ */

/** 审计面板一键加变体（main.ts 路由）：把 variant 收进 canonical 的 variants（无条目则新建），
 *  直接校验写盘 terminology.json；与配置页编辑共享行模型缓存与撤销栈 */
export async function addTerminologyVariant(canonical: string, variant: string): Promise<void> {
  const rows = ensureTermRows();
  let row = rows.terms.find((r) => String(r.canonical ?? '').trim() === canonical);
  let list: string[] = [];
  if (row) {
    try {
      const v: unknown = JSON.parse(String(row.variants ?? '[]'));
      if (Array.isArray(v)) list = v.filter((s): s is string => typeof s === 'string');
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
  await saveConfigFile('terminology', json, errors, '名词表');
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
  void file.text().then((txt) => {
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
    const { json, errors } = rowsToTerminology(state.configFiles.terminology, ensureTermRows());
    void saveConfigFile('terminology', json, errors, '名词表');
  };
  ops.append(exportBtn, importBtn, fileInput, saveBtn);
  sec.appendChild(ops);
  return sec;
}

/* ============================ 入口 ============================ */

/** 渲染配置标签页（每次进入从盘上重读源文件） */
export function renderConfig(container: HTMLElement): void {
  container.innerHTML = '';
  const loading = h('div', 'dim', '正在读取配置文件…');
  loading.style.padding = '12px';
  container.appendChild(loading);
  void refreshConfigSources().then(() => {
    charRows = null;
    varRows = null;
    achRows = null;
    calRows = null;
    evRows = null;
    grRows = null;
    gaRows = null;
    termRows = null;
    // 从盘重读 = 基线更新：旧撤销栈失效（防撤销回上一轮的内存态）
    configHist.past = [];
    configHist.future = [];
    renderConfigWorkspace(container);
  });
}
