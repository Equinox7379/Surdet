/**
 * 配置标签页（E3 第一批）：变量表编辑器（game.config.json variables）+ 成就编辑器（achievements.json）。
 *  - 打开时从盘上重新读取源文件（外部修改即时可见）
 *  - 表格 ⇄ JSON 双向转换与校验全部经 config-edit.ts 纯逻辑（落盘前必过校验）
 *  - 写盘 2 空格缩进、键序稳定；无目录连接时保存入口给出诚实提示
 *  - 变量删除保护：被剧本引用的变量删除前列出引用场景并要求确认
 */
import { state, h, setStatus } from '../state.js';
import { writeFileHandle } from '../project-io.js';
import {
  VAR_TYPES, parseVariablesToRows, rowsToVariables, applyVariablesToConfig,
  parseAchievementsToRows, rowsToAchievements, collectReferencedVars,
} from '../config-edit.js';
import type { VariableRow, AchievementRow } from '../config-edit.js';

/** 校验刷新钩子（main.ts 注入：scheduleValidate） */
let requestValidateHook: () => void = () => {};
export function bindConfigHooks(opts: { requestValidate: () => void }): void {
  requestValidateHook = opts.requestValidate;
}

/* ---- 行模型缓存（切换标签页重入时从盘上源重载） ---- */
let varRows: VariableRow[] | null = null;
let achRows: AchievementRow[] | null = null;

/** 打开配置页时从盘上重读源文件（外部改动即时可见；失败沿用内存态） */
async function refreshConfigSources(): Promise<void> {
  try {
    if (state.handles.gameConfig) {
      state.gameConfigText = await (await state.handles.gameConfig.getFile()).text();
    }
  } catch { /* 读取失败沿用内存态 */ }
  try {
    if (state.handles.achievements) {
      state.configFiles.achievements = JSON.parse(await (await state.handles.achievements.getFile()).text()) as unknown;
    }
  } catch { /* 同上 */ }
}

function parseConfigObj(): Record<string, unknown> {
  try {
    return state.gameConfigText.trim() ? JSON.parse(state.gameConfigText) as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function ensureVarRows(): VariableRow[] {
  if (!varRows) varRows = parseVariablesToRows(parseConfigObj());
  return varRows;
}

function ensureAchRows(): AchievementRow[] {
  if (!achRows) achRows = parseAchievementsToRows(state.configFiles.achievements);
  return achRows;
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

function renderVariablesSection(): HTMLElement {
  const sec = h('div', 'cfg-section');
  sec.appendChild(h('h3', undefined, '变量表（game.config.json）'));
  const rows = ensureVarRows();

  const table = h('table', 'cfg-table');
  const thead = h('thead');
  const hr = h('tr');
  for (const col of ['名称', '类型', '初始值', 'min', 'max', '只读', '描述', '']) {
    hr.appendChild(h('th', undefined, col));
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = h('tbody');
  const rerender = (): void => {
    const root = document.getElementById('config-view');
    if (root) renderConfig(root);
  };
  rows.forEach((row, i) => {
    const tr = h('tr');
    const mkInput = (value: string, placeholder: string, cls: string, oninput: (v: string) => void): HTMLInputElement => {
      const inp = h('input', cls);
      inp.value = value;
      inp.placeholder = placeholder;
      inp.oninput = () => oninput(inp.value);
      return inp;
    };
    const tdName = h('td');
    tdName.appendChild(mkInput(row.name, '变量名', 'mono', (v) => { rows[i]!.name = v; }));
    tr.appendChild(tdName);
    const tdType = h('td');
    const sel = h('select');
    for (const t of VAR_TYPES) {
      const opt = h('option', undefined, t);
      opt.value = t;
      if (row.type === t) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = () => { rows[i]!.type = sel.value; };
    tdType.appendChild(sel);
    tr.appendChild(tdType);
    const tdInit = h('td');
    tdInit.appendChild(mkInput(row.initial, 'initial', 'mono', (v) => { rows[i]!.initial = v; }));
    tr.appendChild(tdInit);
    const tdMin = h('td');
    tdMin.appendChild(mkInput(row.min, 'min', 'mono', (v) => { rows[i]!.min = v; }));
    tr.appendChild(tdMin);
    const tdMax = h('td');
    tdMax.appendChild(mkInput(row.max, 'max', 'mono', (v) => { rows[i]!.max = v; }));
    tr.appendChild(tdMax);
    const tdRo = h('td');
    const ro = h('input');
    ro.type = 'checkbox';
    ro.checked = row.readonly;
    ro.onchange = () => { rows[i]!.readonly = ro.checked; };
    tdRo.appendChild(ro);
    tr.appendChild(tdRo);
    const tdDesc = h('td');
    tdDesc.appendChild(mkInput(row.description, '描述', '', (v) => { rows[i]!.description = v; }));
    tr.appendChild(tdDesc);
    const tdDel = h('td');
    const del = h('button', undefined, '✕');
    del.title = '删除该变量（被剧本引用时会要求确认）';
    del.onclick = () => { rows.splice(i, 1); rerender(); };
    tdDel.appendChild(del);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  sec.appendChild(table);

  const ops = h('div', 'cfg-ops');
  const addBtn = h('button', undefined, '＋ 新增变量');
  addBtn.onclick = () => {
    rows.push({ name: '', type: 'number', initial: '0', min: '', max: '', readonly: false, description: '' });
    rerender();
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
  if (errors.length > 0) {
    setStatus(`成就表未保存：${errors[0]}${errors.length > 1 ? `（另有 ${errors.length - 1} 条）` : ''}`, false, 6000);
    return;
  }
  let handle = state.handles.achievements;
  if (!handle && state.dirHandle) {
    try {
      const contentDir = await state.dirHandle.getDirectoryHandle('content', { create: true });
      const configDir = await contentDir.getDirectoryHandle('config', { create: true });
      handle = await configDir.getFileHandle('achievements.json', { create: true });
      state.handles.achievements = handle;
    } catch { /* 创建失败走下方提示 */ }
  }
  if (!handle) {
    setStatus('成就表无法保存：未连接游戏目录（演示项目不落盘）', false, 6000);
    return;
  }
  const text = JSON.stringify(json, null, 2) + '\n';
  try {
    await writeFileHandle(handle, text);
  } catch (err) {
    setStatus(`成就表写入失败：${err instanceof Error ? err.message : String(err)}`, false, 6000);
    return;
  }
  state.configFiles.achievements = json;
  requestValidateHook();
  setStatus(`成就表已保存（${json.length} 条成就）`, true, 4000);
}

function renderAchievementsSection(): HTMLElement {
  const sec = h('div', 'cfg-section');
  sec.appendChild(h('h3', undefined, '成就表（achievements.json）'));
  const rows = ensureAchRows();

  // when 表达式的变量名下拉提示（变量表 + 常见宿主变量由用户自填）
  const dl = h('datalist');
  dl.id = 'cfg-var-names';
  for (const row of ensureVarRows()) {
    if (row.name.trim()) dl.appendChild(h('option', undefined, row.name.trim()));
  }
  sec.appendChild(dl);

  const table = h('table', 'cfg-table');
  const thead = h('thead');
  const hr = h('tr');
  for (const col of ['ID', '名称', '描述', 'when 条件（空 = 仅事件触发）', '隐藏', '']) {
    hr.appendChild(h('th', undefined, col));
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = h('tbody');
  const rerender = (): void => {
    const root = document.getElementById('config-view');
    if (root) renderConfig(root);
  };
  rows.forEach((row, i) => {
    const tr = h('tr');
    const mkInput = (value: string, placeholder: string, cls: string, oninput: (v: string) => void, list?: string): HTMLInputElement => {
      const inp = h('input', cls);
      inp.value = value;
      inp.placeholder = placeholder;
      if (list) inp.setAttribute('list', list);
      inp.oninput = () => oninput(inp.value);
      return inp;
    };
    const tdId = h('td');
    tdId.appendChild(mkInput(row.id, 'achievement_id', 'mono', (v) => { rows[i]!.id = v; }));
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
    hid.checked = row.hidden;
    hid.onchange = () => { rows[i]!.hidden = hid.checked; };
    tdHidden.appendChild(hid);
    tr.appendChild(tdHidden);
    const tdDel = h('td');
    const del = h('button', undefined, '✕');
    del.title = '删除该成就';
    del.onclick = () => { rows.splice(i, 1); rerender(); };
    tdDel.appendChild(del);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  sec.appendChild(table);

  const ops = h('div', 'cfg-ops');
  const addBtn = h('button', undefined, '＋ 新增成就');
  addBtn.onclick = () => {
    rows.push({ id: '', name: '', description: '', when: '', hidden: false });
    rerender();
  };
  const saveBtn = h('button', 'primary', '保存成就表');
  saveBtn.onclick = () => { void saveAchievements(); };
  ops.append(addBtn, saveBtn);
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
    varRows = null;
    achRows = null;
    container.innerHTML = '';
    container.appendChild(renderVariablesSection());
    container.appendChild(renderAchievementsSection());
  });
}
