/**
 * Surdet 可视化剧本编辑器入口。
 * 功能：打开游戏目录（File System Access）→ 场景列表 → 块式可视化编辑（raw 行为事实来源，
 * 类型化控件为编辑糖）→ 实时校验（编译器即校验器 + 跨场景引用）→ 保存回目录。
 * 无 File System Access 的环境提供内存演示项目 + 下载导出兜底。
 */
import { validateProject } from './validate.js';
import type { Issue, ValidateResult } from './validate.js';
import {
  parseScript, serializeScript, parseLine, splitInstr, rebuildInstrRaw, rebuildTextRaw, rebuildLabelRaw,
} from './model.js';
import type { LineModel } from './model.js';

interface SceneEntry {
  /** 场景 ID（basename；引擎运行时语义） */
  id: string;
  file: string;
  text: string;
  /** 源文件换行风格（保存时保持，避免 CRLF→LF 静默改写） */
  eol: string;
  dirty: boolean;
  handle: FileSystemFileHandle | null;
}

const state = {
  dirName: '',
  /** 项目根目录句柄（保存新建场景时写入 content/scenario/） */
  dirHandle: null as FileSystemDirectoryHandle | null,
  scenes: new Map<string, SceneEntry>(),
  gameConfigText: '',
  entryScene: '',
  current: null as string | null,
  lastValidation: null as ValidateResult | null,
  /** 场景引用图谱（Worker 或同步校验产出；自我迭代①b） */
  lastEdges: [] as { from: string; to: string; kind: 'jump' | 'call' }[],
  fsSupported: typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function',
};

/* ============================ 项目读写 ============================ */

async function openProject(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const dir = await picker({ mode: 'readwrite' });
  state.dirName = dir.name;
  state.dirHandle = dir;
  state.scenes.clear();
  histories.clear(); // 换项目：历史栈失效
  // game.config.json（entryScene/变量表）
  try {
    const cfgHandle = await dir.getFileHandle('game.config.json');
    state.gameConfigText = await (await cfgHandle.getFile()).text();
    const cfg = JSON.parse(state.gameConfigText) as { entryScene?: string };
    state.entryScene = typeof cfg.entryScene === 'string' ? cfg.entryScene : '';
  } catch {
    state.gameConfigText = '';
    state.entryScene = '';
  }
  // 递归读取 content/scenario/**/*.gal
  try {
    const contentDir = await dir.getDirectoryHandle('content');
    const scenarioDir = await contentDir.getDirectoryHandle('scenario');
    await readScenarioDir(scenarioDir, '');
  } catch {
    /* 无剧本目录：空项目 */
  }
  const first = state.scenes.keys().next().value as string | undefined;
  state.current = first ?? null;
  renderAll();
  runValidate(); // 打开后立即校验
}

async function readScenarioDir(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
  // values() 异步迭代器未包含在默认 DOM lib 类型中，显式断言
  const entries = (dir as unknown as {
    values: () => AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }).values();
  for await (const ent of entries) {
    if (ent.kind === 'directory') {
      await readScenarioDir(ent, prefix + ent.name + '/');
    } else if (ent.kind === 'file' && ent.name.endsWith('.gal')) {
      const id = ent.name.replace(/\.gal$/, '');
      const text = await (await ent.getFile()).text();
      // key = 相对路径：子目录同名 .gal 各占一条，同名冲突由校验 LINT_DUP 显式报错（M4）
      const key = prefix + id;
      state.scenes.set(key, {
        id,
        file: prefix + ent.name,
        text,
        eol: text.includes('\r\n') ? '\r\n' : '\n',
        dirty: false,
        handle: ent,
      });
    }
  }
}

async function saveAll(): Promise<void> {
  if (!state.fsSupported) {
    exportCurrent();
    return;
  }
  let saved = 0;
  for (const [key, sc] of state.scenes) {
    if (!sc.dirty) continue;
    const handle = sc.handle;
    if (!handle) {
      // 新建场景：在项目目录 content/scenario/ 下真实创建文件落盘（M3：不再以下载冒充保存）
      if (state.dirHandle) {
        try {
          const contentDir = await state.dirHandle.getDirectoryHandle('content', { create: true });
          const scenarioDir = await contentDir.getDirectoryHandle('scenario', { create: true });
          const fileName = `${sc.id}.gal`;
          const fh = await scenarioDir.getFileHandle(fileName, { create: true });
          const w = await fh.createWritable();
          await w.write(sc.text);
          await w.close();
          sc.handle = fh;
          sc.file = `content/scenario/${fileName}`;
          sc.dirty = false;
          saved++;
        } catch (err) {
          setStatus(`场景 '${sc.id}' 创建失败：${err instanceof Error ? err.message : String(err)}`, false);
        }
        continue;
      }
      // 演示项目（无目录句柄）：下载导出 + 保留脏标记，诚实提示（不冒充已保存）
      exportScene(sc.id, sc.text);
      setStatus(`演示项目无法写盘：已下载 ${sc.id}.gal，请手动放入 content/scenario/（脏标记保留）`, true);
      continue;
    }
    const writable = await handle.createWritable();
    await writable.write(sc.text);
    await writable.close();
    sc.dirty = false;
    saved++;
    void key;
  }
  setStatus(saved > 0 ? `已保存 ${saved} 个场景` : '无待保存改动', true);
  renderSidebar();
}

function exportScene(id: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${id}.gal`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCurrent(): void {
  if (!state.current) return;
  const sc = state.scenes.get(state.current);
  if (sc) exportScene(state.current, sc.text);
}

/** 无 FS API 环境的内存演示项目 */
function loadDemoProject(): void {
  state.dirName = '（演示项目·未连接目录）';
  state.dirHandle = null;
  state.scenes.clear();
  histories.clear();
  state.gameConfigText = '';
  state.entryScene = 'demo';
  state.scenes.set('demo', {
    id: 'demo',
    file: 'demo.gal',
    text: '@scene demo\n@bg hall\n凛：你好，这里是演示场景。\n@choice\n  打个招呼 -> @goto greet\n  沉默离开 -> @goto bye\n@label greet\n凛：很高兴见到你。\n@end\n@label bye\n凛：……下次见。\n@end',
    eol: '\n',
    dirty: false,
    handle: null,
  });
  state.current = 'demo';
  renderAll();
  runValidate();
}

/* ============================ 编辑操作 ============================ */

function currentText(): string {
  return state.current ? state.scenes.get(state.current)?.text ?? '' : '';
}

/* ============================ 撤销/重做（自我迭代①a） ============================ */

interface SceneHistory { past: string[]; future: string[]; lastPushAt: number }
const histories = new Map<string, SceneHistory>();
const HISTORY_LIMIT = 200;
/** 打字合并窗口：窗口内的连续输入只记一个撤销点 */
const COALESCE_MS = 600;

function getHistory(): SceneHistory | null {
  if (!state.current) return null;
  let hist = histories.get(state.current);
  if (!hist) {
    hist = { past: [], future: [], lastPushAt: 0 };
    histories.set(state.current, hist);
  }
  return hist;
}

function undo(): void {
  if (!state.current) return;
  const sc = state.scenes.get(state.current);
  const hist = getHistory();
  if (!sc || !hist || hist.past.length === 0) return;
  const prev = hist.past.pop()!;
  hist.future.push(sc.text);
  hist.lastPushAt = 0; // 撤销后的新编辑不与之合并
  sc.text = prev;
  sc.dirty = true;
  scheduleValidate();
  renderEditor();
  renderSidebar();
}

function redo(): void {
  if (!state.current) return;
  const sc = state.scenes.get(state.current);
  const hist = getHistory();
  if (!sc || !hist || hist.future.length === 0) return;
  const next = hist.future.pop()!;
  hist.past.push(sc.text);
  hist.lastPushAt = 0;
  sc.text = next;
  sc.dirty = true;
  scheduleValidate();
  renderEditor();
  renderSidebar();
}

function setCurrentText(text: string, opts?: { coalesce?: boolean }): void {
  if (!state.current) return;
  const sc = state.scenes.get(state.current);
  if (!sc) return;
  const hist = getHistory();
  if (hist) {
    const now = Date.now();
    if (opts?.coalesce === true && hist.past.length > 0 && now - hist.lastPushAt < COALESCE_MS) {
      hist.lastPushAt = now; // 打字合并：不入新撤销点
    } else {
      hist.past.push(sc.text);
      if (hist.past.length > HISTORY_LIMIT) hist.past.shift();
      hist.future = [];
      hist.lastPushAt = now;
    }
  }
  sc.text = text;
  sc.dirty = true;
  scheduleValidate();
}

/** 当前场景的换行风格（序列化时保持源文件风格） */
function currentEol(): string {
  return state.current ? state.scenes.get(state.current)?.eol ?? '\n' : '\n';
}

function updateLine(index: number, next: LineModel): void {
  const lines = parseScript(currentText());
  if (index < 0 || index >= lines.length) return;
  lines[index] = next;
  // 类型化字段/raw 输入的编辑热路径：保持源文件换行风格；打字合并入撤销栈（自我迭代①a）
  setCurrentText(serializeScript(lines, currentEol()), { coalesce: true });
}

function deleteLine(index: number): void {
  const lines = parseScript(currentText());
  lines.splice(index, 1);
  setCurrentText(serializeScript(lines, currentEol()));
  renderEditor();
}

function insertLine(index: number): void {
  const lines = parseScript(currentText());
  lines.splice(index + 1, 0, { kind: 'text', speaker: '', value: '新台词', sep: '：', raw: '新台词' });
  setCurrentText(serializeScript(lines, currentEol()));
  renderEditor();
}

function moveLine(index: number, dir: -1 | 1): void {
  const lines = parseScript(currentText());
  const target = index + dir;
  if (target < 0 || target >= lines.length) return;
  const tmp = lines[index]!;
  lines[index] = lines[target]!;
  lines[target] = tmp;
  setCurrentText(serializeScript(lines, currentEol()));
  renderEditor();
}

function newScene(): void {
  const name = window.prompt('新场景 ID（文件名，不含 .gal）');
  if (!name || name.trim().length === 0) return;
  const id = name.trim();
  if (state.scenes.has(id)) {
    setStatus(`场景 '${id}' 已存在`, false);
    return;
  }
  state.scenes.set(id, {
    id,
    file: `${id}.gal`,
    text: `@scene ${id}\n凛：`,
    eol: '\n',
    dirty: true,
    handle: null,
  });
  state.current = id;
  renderAll();
}

/* ============================ 校验 ============================ */

let validateTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleValidate(): void {
  if (validateTimer) clearTimeout(validateTimer);
  validateTimer = setTimeout(runValidate, 300);
}

/** 组装校验输入（Worker 与同步回退共用） */
function buildValidateInput(): { sources: { key: string; id: string; file: string; source: string }[]; entryScene: string | undefined; config: { raw: Record<string, unknown> | null; path: string } } {
  const sources = [...state.scenes.entries()].map(([key, sc]) => ({ key, id: sc.id, file: sc.file, source: sc.text }));
  let configRaw: Record<string, unknown> | null = null;
  if (state.gameConfigText) {
    try {
      configRaw = JSON.parse(state.gameConfigText) as Record<string, unknown>;
    } catch {
      configRaw = null;
    }
  }
  return { sources, entryScene: state.entryScene || undefined, config: { raw: configRaw, path: 'game.config.json' } };
}

/** 应用校验结果并刷新 UI（Worker 回包与同步路径共用） */
function applyValidation(issues: Issue[], edges: { from: string; to: string; kind: 'jump' | 'call' }[]): void {
  state.lastValidation = { issues, scenes: new Map() };
  state.lastEdges = edges;
  renderIssues();
  renderSidebar(); // 刷新脏标记
  updateEdges();   // 刷新场景引用图谱
  updateGraph();   // 刷新场景拓扑图（自我迭代⑤）
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  setStatus(errors === 0 ? `校验通过（${warnings} 条警告）` : `${errors} 个错误 / ${warnings} 条警告`, errors === 0);
}

function runValidateSync(): void {
  const input = buildValidateInput();
  const result = validateProject(input.sources, input.entryScene, input.config);
  const edges: { from: string; to: string; kind: 'jump' | 'call' }[] = [];
  for (const [sceneId, scene] of result.scenes) {
    for (const instr of scene.instructions) {
      if ((instr.op === 'jump' && instr.kind === 'jump') || instr.op === 'call') {
        edges.push({ from: sceneId, to: (instr as { target: string }).target, kind: instr.op === 'call' ? 'call' : 'jump' });
      }
    }
  }
  applyValidation(result.issues, edges);
}

function runValidate(): void {
  // 优先 Worker（不阻塞主线程；自我迭代①b）；不可用/异常时同步回退
  if (validateWorker) {
    validateSeq += 1;
    const input = buildValidateInput();
    validateWorker.postMessage({ seq: validateSeq, ...input });
    return;
  }
  runValidateSync();
}

/* ============================ 渲染 ============================ */

const appEl = document.getElementById('app')!;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderAll(): void {
  appEl.innerHTML = '';
  const header = h('header');
  header.appendChild(h('h1', undefined, 'Surdet 剧本编辑器'));
  header.appendChild(h('span', 'proj', state.dirName ? `项目：${state.dirName}` : '未打开项目'));
  header.appendChild(h('span', 'spacer'));
  if (state.fsSupported) {
    const openBtn = h('button', undefined, '打开游戏目录');
    openBtn.onclick = () => { void openProject(); };
    header.appendChild(openBtn);
  } else {
    const demoBtn = h('button', undefined, '加载演示项目');
    demoBtn.onclick = loadDemoProject;
    header.appendChild(demoBtn);
  }
  if (!state.fsSupported && state.scenes.size > 0) {
    const expBtn = h('button', undefined, '导出当前场景 .gal');
    expBtn.onclick = exportCurrent;
    header.appendChild(expBtn);
  }
  const undoBtn = h('button', undefined, '↩ 撤销 (Ctrl+Z)');
  undoBtn.onclick = undo;
  const redoBtn = h('button', undefined, '↪ 重做 (Ctrl+Y)');
  redoBtn.onclick = redo;
  header.appendChild(undoBtn);
  header.appendChild(redoBtn);
  const saveBtn = h('button', 'primary', '保存全部 (Ctrl+S)');
  saveBtn.onclick = () => { void saveAll(); };
  header.appendChild(saveBtn);
  header.appendChild(h('span', undefined, ''));
  const status = h('span', undefined, '');
  status.id = 'status';
  header.appendChild(status);
  appEl.appendChild(header);

  if (!state.fsSupported && state.scenes.size === 0) {
    const banner = h('div', 'banner');
    banner.textContent = '未检测到 File System Access 支持：请使用 Chrome/Edge 打开并点击「打开游戏目录」选择游戏项目根目录（如 examples/starter）；当前环境可先加载演示项目体验编辑与校验。';
    appEl.appendChild(banner);
  }

  const main = h('main');
  const sidebar = h('aside');
  sidebar.id = 'sidebar';
  const editor = h('section');
  editor.id = 'editor';
  const right = h('aside');
  right.id = 'right';
  main.append(sidebar, editor, right);
  appEl.appendChild(main);

  renderSidebar();
  renderEditor();
  renderIssues();
  renderRightExtras();
}

function renderSidebar(): void {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.innerHTML = '';
  sidebar.appendChild(h('h3', undefined, `场景（${state.scenes.size}）`));
  const newBtn = h('button', undefined, '＋ 新建场景');
  newBtn.onclick = newScene;
  sidebar.appendChild(newBtn);
  const list = h('div');
  for (const [id, sc] of state.scenes) {
    const item = h('div', 'scene-item' + (id === state.current ? ' active' : ''));
    item.appendChild(h('span', undefined, id));
    if (sc.dirty) item.appendChild(h('span', 'dirty', '●'));
    item.onclick = () => { state.current = id; renderSidebar(); renderEditor(); };
    list.appendChild(item);
  }
  sidebar.appendChild(list);
}

/** 指令类型化编辑模板：指令名 → 位置参数字段（null = 整体参数单输入） */
const INSTR_FIELDS: Record<string, { labels: string[]; opSelect?: number } | null> = {
  bg: { labels: ['背景 key'] },
  show: { labels: ['角色:服装', '表情/第二参数'] },
  hide: { labels: ['角色'] },
  voice: { labels: ['语音 key'] },
  bgm: { labels: ['音乐 key'] },
  se: { labels: ['音效 key'] },
  fadein: { labels: ['毫秒'] },
  fadeout: { labels: ['毫秒'] },
  wait: { labels: ['毫秒'] },
  set: { labels: ['变量', '运算符', '表达式'], opSelect: 1 },
  mod: { labels: ['变量', '增量'] },
  inc: { labels: ['变量'] },
  dec: { labels: ['变量'] },
  toggle: { labels: ['变量'] },
  flag: { labels: ['变量'] },
  unflag: { labels: ['变量'] },
  if: { labels: ['条件表达式'] },
  elif: { labels: ['条件表达式'] },
  goto: { labels: ['标签'] },
  loop: { labels: ['标签'] },
  jump: { labels: ['场景.标签'] },
  call: { labels: ['场景.标签'] },
  unlock_cg: { labels: ['CG id'] },
  unlock_music: { labels: ['音乐 id'] },
  unlock_text: { labels: ['回想 id'] },
  add_item: { labels: ['数组变量', '道具 ID'] },
  remove_item: { labels: ['数组变量', '道具 ID'] },
  has_item: { labels: ['数组变量', '道具 ID', '结果变量'] },
  particle: { labels: ['预设'] },
  mov: { labels: ['角色', '位置', '毫秒'] },
  tint: { labels: ['颜色 hex', '透明度', '毫秒'] },
  clear: { labels: ['结局 ID（缺省=当前场景）'] },
  exp: { labels: ['角色 ID', '经验值'] },
  achievement: { labels: ['模式（unlock）', '成就 ID'] },
  choice: { labels: [] },
};

function kindBadge(l: LineModel): string {
  switch (l.kind) {
    case 'text': return '台词';
    case 'label': return '标签';
    case 'instr': return '@' + l.name;
    case 'choice-option': return '选项';
    case 'comment': return '注释';
    default: return '空行';
  }
}

function renderEditor(): void {
  const editorEl = document.getElementById('editor');
  if (!editorEl) return;
  editorEl.innerHTML = '';
  if (!state.current) {
    editorEl.appendChild(h('div', 'empty', '打开项目并选择一个场景开始编辑'));
    return;
  }
  const lines = parseScript(currentText());
  lines.forEach((line, index) => {
    editorEl.appendChild(renderBlock(line, index));
  });
  const addBtn = h('button', undefined, '＋ 在末尾追加台词');
  addBtn.onclick = () => insertLine(lines.length - 1);
  editorEl.appendChild(addBtn);
}

function renderBlock(line: LineModel, index: number): HTMLElement {
  const block = h('div', 'block');
  block.dataset.line = String(index);

  const bar = h('div', 'bar');
  const badgeCls = line.kind === 'text' ? 'text' : line.kind === 'label' ? 'label'
    : line.kind === 'instr' && ['goto', 'jump', 'call', 'if', 'choice'].includes(line.name) ? 'flow'
    : line.kind === 'blank' || line.kind === 'comment' ? 'dim' : '';
  bar.appendChild(h('span', 'badge ' + badgeCls, kindBadge(line)));
  const ops = h('span', 'ops');
  const upBtn = h('button', undefined, '↑');
  upBtn.onclick = () => moveLine(index, -1);
  const downBtn = h('button', undefined, '↓');
  downBtn.onclick = () => moveLine(index, 1);
  const insBtn = h('button', undefined, '＋');
  insBtn.onclick = () => insertLine(index);
  const delBtn = h('button', undefined, '✕');
  delBtn.onclick = () => deleteLine(index);
  ops.append(upBtn, downBtn, insBtn, delBtn);
  bar.appendChild(ops);
  block.appendChild(bar);

  const fields = h('div', 'fields');
  block.appendChild(fields);

  const commit = (next: LineModel): void => {
    updateLine(index, next);
    const rawInput = block.querySelector<HTMLInputElement>('.raw input');
    if (rawInput) rawInput.value = next.raw;
  };

  if (line.kind === 'text') {
    const sp = h('input');
    sp.placeholder = '说话人（可空）';
    sp.value = line.speaker;
    sp.style.width = '110px';
    const val = h('input', 'wide');
    val.placeholder = '台词内容（支持 {变量} 插值与 基础字《注音》）';
    val.value = line.value;
    const sep = line.sep;
    sp.oninput = () => commit({ ...line, speaker: sp.value, raw: rebuildTextRaw(sp.value, val.value, sep) });
    val.oninput = () => commit({ ...line, value: val.value, raw: rebuildTextRaw(sp.value, val.value, sep) });
    fields.append(sp, val);
  } else if (line.kind === 'label') {
    const name = h('input', 'wide');
    name.placeholder = '标签名';
    name.value = line.name;
    name.oninput = () => commit({ ...line, name: name.value, raw: rebuildLabelRaw(name.value) });
    fields.appendChild(name);
  } else if (line.kind === 'instr') {
    renderInstrFields(fields, line, commit);
  } else {
    const ta = h('textarea', 'wide');
    ta.rows = line.kind === 'choice-option' ? 1 : 1;
    ta.value = line.raw;
    ta.oninput = () => {
      const prev = index > 0 ? parseScript(currentText())[index - 1]! : null;
      const prevKind = line.kind === 'choice-option' ? 'choice' : prev ? prevKindOf(prev) : '';
      commit(parseLine(ta.value, prevKind));
    };
    fields.appendChild(ta);
  }

  // raw 行（事实来源，可直接编辑任意内容）
  const rawWrap = h('div', 'raw');
  const rawInput = h('input', 'mono');
  rawInput.value = line.raw;
  rawInput.title = '原始行（直接编辑将重新分类该行）';
  rawInput.oninput = () => {
    const prev = index > 0 ? parseScript(currentText())[index - 1]! : null;
    const prevKind = prev ? prevKindOf(prev) : '';
    updateLine(index, parseLine(rawInput.value, prevKind));
  };
  rawWrap.appendChild(rawInput);
  block.appendChild(rawWrap);

  return block;
}

function prevKindOf(l: LineModel): string {
  if (l.kind === 'instr') return l.name === 'choice' ? 'choice' : 'instr';
  if (l.kind === 'choice-option') return 'choice-option';
  return l.kind;
}

function renderInstrFields(
  fields: HTMLElement,
  line: Extract<LineModel, { kind: 'instr' }>,
  commit: (next: LineModel) => void,
): void {
  const { name, args } = splitInstr(line.raw);
  const tpl = INSTR_FIELDS[name];

  const writeBack = (newArgs: string[]): void => {
    commit({ ...line, raw: rebuildInstrRaw(name, newArgs) });
  };

  if (tpl === undefined) {
    // 未知指令：整体参数单输入
    const input = h('input', 'wide');
    input.placeholder = '参数（空格分隔）';
    input.value = args.join(' ');
    input.oninput = () => writeBack(input.value.split(/\s+/).filter((s) => s.length > 0));
    fields.appendChild(input);
    return;
  }
  if (tpl === null || tpl.labels.length === 0) {
    fields.appendChild(h('span', 'badge dim', '无参数'));
    return;
  }

  tpl.labels.forEach((labelText, i) => {
    if (tpl.opSelect === i) {
      const sel = h('select');
      for (const op of ['=', '+=', '-=']) {
        const opt = h('option', undefined, op);
        opt.value = op;
        if ((args[i] ?? '') === op) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => {
        const next = [...args];
        next[i] = sel.value;
        writeBack(next);
      };
      fields.appendChild(sel);
      return;
    }
    const input = h('input', i === tpl.labels.length - 1 ? 'wide' : '');
    input.placeholder = labelText;
    input.value = args[i] ?? '';
    input.oninput = () => {
      const next = [...args];
      next[i] = input.value;
      writeBack(next);
    };
    fields.appendChild(input);
  });
}

function renderIssues(): void {
  const right = document.getElementById('right');
  if (!right) return;
  const old = document.getElementById('issues-box');
  if (old) old.remove();
  const box = h('div');
  box.id = 'issues-box';
  box.appendChild(h('h3', undefined, '校验结果'));
  const issues = state.lastValidation?.issues ?? [];
  if (issues.length === 0) {
    box.appendChild(h('div', 'empty', state.lastValidation ? '全部通过 ✓' : '等待校验…'));
  }
  for (const issue of issues.slice(0, 100)) {
    box.appendChild(renderIssue(issue));
  }
  // 插到右侧面板顶部（h3 之后）
  const firstH3 = right.querySelector('h3');
  if (firstH3 && firstH3.parentElement === right) right.insertBefore(box, firstH3.nextSibling);
  else right.prepend(box);
}

function renderIssue(issue: Issue): HTMLElement {
  const el = h('div', 'issue ' + issue.severity);
  const loc = h('div', 'loc', `${issue.file}:${issue.line}:${issue.col}`);
  const msg = h('div', undefined, issue.text);
  el.append(loc, msg);
  el.onclick = () => {
    // 跳转到对应场景与行：场景 Map 的 key 是相对路径（M4），由文件名推导 key；
    // 推导不中再按 basename 回退（部分告警以 sceneId 上报）——修复子目录场景点击失效
    let key = issue.file.replace(/\.gal$/, '');
    if (!state.scenes.has(key)) {
      const base = key.split('/').pop() ?? key;
      key = [...state.scenes.keys()].find((k) => k === base || k.endsWith('/' + base)) ?? base;
    }
    if (state.scenes.has(key)) {
      state.current = key;
      renderSidebar();
      renderEditor();
      const target = document.querySelector(`.block[data-line="${Math.max(0, issue.line - 1)}"]`);
      target?.scrollIntoView({ block: 'center' });
      target?.classList.add('selected');
    }
  };
  return el;
}

function renderRightExtras(): void {
  const right = document.getElementById('right');
  if (!right) return;
  right.appendChild(h('h3', undefined, '变量（game.config.json）'));
  const chips = h('div');
  try {
    if (state.gameConfigText) {
      const cfg = JSON.parse(state.gameConfigText) as { variables?: Record<string, { type?: string }> };
      const vars = Object.entries(cfg.variables ?? {});
      if (vars.length === 0) chips.appendChild(h('span', 'empty', '无变量声明'));
      for (const [name, decl] of vars) {
        const chip = h('span', 'chip', `${name}：${decl?.type ?? '?'}`);
        chip.title = '点击复制变量名';
        chip.onclick = () => { void navigator.clipboard?.writeText(name); setStatus(`已复制 ${name}`, true); };
        chips.appendChild(chip);
      }
    } else {
      chips.appendChild(h('span', 'empty', '未加载 game.config.json'));
    }
  } catch {
    chips.appendChild(h('span', 'empty', 'game.config.json 解析失败'));
  }
  right.appendChild(chips);

  right.appendChild(h('h3', undefined, '场景拓扑'));
  const graphBox = h('div');
  graphBox.id = 'graph-box';
  right.appendChild(graphBox);

  right.appendChild(h('h3', undefined, '场景引用'));
  const edgesBox = h('div');
  edgesBox.id = 'edges-box';
  right.appendChild(edgesBox);
  updateEdges();
  updateGraph();
}

/** 场景拓扑图（自我迭代⑤）：BFS 分层布局的 SVG 小图，节点点击切换场景。
 *  数据源为 lastEdges（Worker/同步校验共用），不依赖编译产物对象。 */
function updateGraph(): void {
  const box = document.getElementById('graph-box');
  if (!box) return;
  box.innerHTML = '';
  const ids = [...new Set([...state.scenes.values()].map((s) => s.id))];
  if (ids.length === 0) return;

  // 邻接表（边目标取场景部分：scene.label → scene）
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of state.lastEdges) {
    const to = e.to.split('.')[0]!;
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(to)) adj.set(to, []);
    adj.get(e.from)!.push(to);
  }

  // BFS 分层（entryScene 为根；不可达场景排到末列）
  const depth = new Map<string, number>();
  const entry = state.entryScene && adj.has(state.entryScene) ? state.entryScene : ids[0]!;
  depth.set(entry, 0);
  const queue = [entry];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nx of adj.get(cur) ?? []) {
      if (!depth.has(nx)) {
        depth.set(nx, depth.get(cur)! + 1);
        queue.push(nx);
      }
    }
  }
  let maxDepth = 0;
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d);
  const unreachable = [...adj.keys()].filter((id) => !depth.has(id));
  if (unreachable.length > 0) {
    maxDepth += 1;
    for (const id of unreachable) depth.set(id, maxDepth); // 不可达：末列集中展示
  }

  const byDepth = new Map<number, string[]>();
  for (const [id, d] of depth) {
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }

  const NS = 'http://www.w3.org/2000/svg';
  const COLW = 96;
  const ROWH = 32;
  const PAD = 10;
  const NODE_W = 84;
  const NODE_H = 22;
  const cols = (maxDepth === 0 ? 0 : maxDepth) + 2;
  const maxRows = Math.max(1, ...[...byDepth.values()].map((v) => v.length));
  const width = PAD * 2 + cols * COLW;
  const height = PAD * 2 + maxRows * ROWH;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));

  const posOf = new Map<string, { x: number; y: number }>();
  for (const [d, nodes] of byDepth) {
    nodes.forEach((id, i) => {
      posOf.set(id, { x: PAD + d * COLW + NODE_W / 2, y: PAD + i * ROWH + NODE_H / 2 });
    });
  }

  // 先画边再画节点（节点盖住线头）
  for (const e of state.lastEdges) {
    const from = posOf.get(e.from);
    const to = posOf.get(e.to.split('.')[0]!);
    if (!from || !to) continue;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(from.x + NODE_W / 2 - 6));
    line.setAttribute('y1', String(from.y));
    line.setAttribute('x2', String(to.x - NODE_W / 2 + 2));
    line.setAttribute('y2', String(to.y));
    line.setAttribute('stroke', e.kind === 'call' ? '#7a6aa8' : '#3a4258');
    line.setAttribute('stroke-width', '1.5');
    svg.appendChild(line);
  }

  const currentId = state.current ? state.scenes.get(state.current)?.id : undefined;
  for (const [id, p] of posOf) {
    const g = document.createElementNS(NS, 'g');
    g.style.cursor = 'pointer';
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(p.x - NODE_W / 2));
    rect.setAttribute('y', String(p.y - NODE_H / 2));
    rect.setAttribute('width', String(NODE_W));
    rect.setAttribute('height', String(NODE_H));
    rect.setAttribute('rx', '6');
    rect.setAttribute('fill', id === entry ? '#3a2f1e' : '#1a2032');
    rect.setAttribute('stroke', id === currentId ? '#ffe8c8' : '#2a3248');
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', String(p.x));
    label.setAttribute('y', String(p.y + 4));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '11');
    label.setAttribute('fill', id === currentId ? '#ffe8c8' : '#dfe4f0');
    label.textContent = id.length > 11 ? id.slice(0, 10) + '…' : id;
    g.append(rect, label);
    const title = document.createElementNS(NS, 'title');
    title.textContent = id === entry ? `${id}（入口）` : id;
    g.appendChild(title);
    g.addEventListener('click', () => {
      const key = [...state.scenes.keys()].find((k) => state.scenes.get(k)!.id === id);
      if (key) {
        state.current = key;
        renderSidebar();
        renderEditor();
        updateGraph();
      }
    });
    svg.appendChild(g);
  }
  box.appendChild(svg);
}

function updateEdges(): void {
  const box = document.getElementById('edges-box');
  if (!box) return;
  box.innerHTML = '';
  if (state.lastEdges.length === 0) {
    box.appendChild(h('div', 'empty', '暂无数据'));
    return;
  }
  for (const e of state.lastEdges) {
    box.appendChild(h('div', 'edge', `${e.from} → ${e.to}（${e.kind}）`));
  }
}

function setStatus(text: string, ok: boolean): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.className = ok ? 'ok' : 'err';
}

/* ============================ 快捷键 ============================ */

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    void saveAll();
    return;
  }
  // 撤销/重做（自我迭代①a）：Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    redo();
  }
});

/* ============================ 校验 Worker（自我迭代①b） ============================ */

let validateWorker: Worker | null = null;
let validateSeq = 0;
try {
  validateWorker = new Worker(new URL('./validate-worker.ts', import.meta.url), { type: 'module' });
  validateWorker.onmessage = (e: MessageEvent) => {
    const data = e.data as { seq: number; ok: boolean; issues?: Issue[]; edges?: { from: string; to: string; kind: 'jump' | 'call' }[]; error?: string };
    if (data.seq !== validateSeq) return; // 过期结果丢弃：校验永远以最新编辑快照为准
    if (data.ok && data.issues) {
      applyValidation(data.issues, data.edges ?? []);
    } else {
      // Worker 内部异常：终止并永久回退同步校验（功能不缺失）
      validateWorker?.terminate();
      validateWorker = null;
      runValidateSync();
    }
  };
  validateWorker.onerror = () => {
    validateWorker?.terminate();
    validateWorker = null; // 构造/加载失败：同步回退
  };
} catch {
  validateWorker = null;
}

// 关页保护：存在未保存改动时提示（防误关丢失编辑）
window.addEventListener('beforeunload', (e) => {
  for (const sc of state.scenes.values()) {
    if (sc.dirty) {
      e.preventDefault();
      e.returnValue = '';
      return;
    }
  }
});

renderAll();
