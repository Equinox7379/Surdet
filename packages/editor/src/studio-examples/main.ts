import { compileScene } from '@surdet/core';
import { normalizePreviewTraceMessage } from '@surdet/authoring';
import { parseScript, rebuildTextRaw, serializeScript, splitInstr } from '../model.js';
import { EDITOR_MODES } from '../shell/editor-modes.js';
import { applySourceTextareaEdit, instructionPosition, setInstructionArgument, setInstructionPosition } from '../v4/script-source.js';
import { avatar, backgrounds, initialScenes, portraits, type ExampleScene } from './sample.js';
import './style.css';

type Layout = 'studio' | 'writing' | 'direction';
type View = 'script' | 'assets' | 'flow';
const layouts: Record<Layout, { label: string; description: string }> = {
  studio: { label: '标准工作台', description: '章节、剧本、预览与属性同时可见' },
  writing: { label: '连续写作', description: '收起目录，让对白连成一页；演出参数在右侧调整' },
  direction: { label: '演出工作台', description: '放大舞台，下方浏览演出片段，右侧调整当前对象' },
};
const storageKey = 'surdet.editor-layout-examples.v1';
let scenes = initialScenes.map((scene) => ({ ...scene }));
let current = 'store';
let selected = 4;
let layout: Layout = 'studio';
let view: View = 'script';
let sourceMode = false;
let pendingProperty = false;
let pendingSource = false;
let revision = 0;
let persisted = JSON.stringify(scenes);
let traceId = '';
let frameReady = false;
let pendingRun = false;
let runningLine: number | null = null;
let previewRevision = -1;
const undo: string[] = [];

// Example persistence never touches FileSystemHandle, a project binding or an authority endpoint.
try {
  const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
  if (Array.isArray(saved) && saved.length === initialScenes.length
    && saved.every((entry, i) => entry?.id === initialScenes[i]?.id && typeof entry?.text === 'string')) {
    scenes = initialScenes.map((scene, i) => ({ ...scene, text: (saved[i] as ExampleScene).text }));
    persisted = JSON.stringify(scenes);
  }
} catch { /* A corrupt/unavailable example store must not affect any real project. */ }

const paths: Record<string, string> = {
  scene: 'M4 4h16v16H4z M4 9h16 M9 4v16',
  chevron: 'm9 5 7 7-7 7',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM16 16l5 5',
  folder: 'M3 7h7l2-3h8v16H3z',
  play: 'm8 4 12 8-12 8z',
  image: 'M3 4h18v16H3z M3 16l6-6 5 5 3-3 4 4 M16 8h.01',
  branch: 'M6 3v10a5 5 0 0 0 5 5h7 M6 9h12 M15 6l3 3-3 3 M15 15l3 3-3 3',
  code: 'm8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',
  undo: 'M4 9h10a6 6 0 0 1 0 12 M8 4 3 9l5 5',
  save: 'M4 3h13l4 4v14H3V3z M7 3v6h10V3 M7 21v-8h10v8',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v7l4 2',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  expand: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
  close: 'm5 5 14 14 M5 19 19 5',
  check: 'm4 12 5 5L20 6',
  reload: 'M20 7v6h-6 M20 13a8 8 0 1 0-2 5',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
};
function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] ?? paths.scene}"/></svg>`;
}
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
function el<T extends HTMLElement = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing example element: ${selector}`);
  return found;
}
function scene(): ExampleScene { return scenes.find((entry) => entry.id === current)!; }
function dirty(): boolean { return pendingProperty || pendingSource || JSON.stringify(scenes) !== persisted; }

el('#studio').innerHTML = `
  <div class="example-bar">
    <span class="example-label">编辑器布局示例</span>
    <div class="layout-switch" role="group" aria-label="选择示例布局">
      <button data-layout="studio"><b>A</b> 标准工作台 <span>已选</span></button>
      <button data-layout="writing"><b>B</b> 连续写作</button>
      <button data-layout="direction"><b>C</b> 演出工作台</button>
    </div>
    <button class="plain boundary" id="capabilities">${icon('settings')} 现有能力与接线</button>
  </div>
  <header class="app-bar">
    <div class="brand"><span class="brand-mark">S</span><strong>SURDET</strong><span class="brand-divider"></span><span>零点之后</span><span class="copy-badge">片段副本</span></div>
    <nav aria-label="示例工作区">
      <button data-view="script">剧本</button><button data-view="assets">素材</button><button data-view="flow">流程</button>
    </nav>
    <div class="app-actions"><button id="undo" class="icon-button" title="撤销示例编辑" aria-label="撤销示例编辑">${icon('undo')}</button><button id="save">${icon('save')} 保存示例副本 <kbd>Ctrl S</kbd></button><button id="run" class="primary">${icon('play')} 从头试玩</button></div>
  </header>
  <main class="workspace">
    <aside class="outline">
      <div class="panel-heading"><span>剧本结构</span><button id="toggle-tree" class="icon-button" aria-label="展开或收起章节目录">${icon('folder')}</button></div>
      <label class="tree-search">${icon('search')}<input id="search" placeholder="查找片段" aria-label="查找片段"/></label>
      <div class="tree-group">${icon('chevron')} <span>零点之后 · 示例摘录</span></div>
      <div id="scene-list"></div>
      <div class="outline-bottom"><div class="project-stamp">${icon('folder')} 独立示例副本</div><p>可编辑、试玩和保存在此浏览器。<br/>原作品文件保持不变。</p><button id="reset" class="text-button">还原初始示例</button></div>
    </aside>
    <section class="document-panel">
      <div class="document-tabs"><div class="open-tab">${icon('scene')} <span id="tab-name"></span><i id="dirty-dot"></i></div><span class="document-spacer"></span><button id="source-toggle" class="icon-button" aria-label="切换源码视图" title="切换源码视图">${icon('code')}</button></div>
      <div class="document-toolbar"><span id="breadcrumb"></span><span class="document-spacer"></span><span id="line-count"></span><button id="check" class="icon-button" aria-label="检查示例语法" title="检查示例语法">${icon('check')}</button></div>
      <div id="document-content"></div>
      <div class="document-foot"><span id="selection-status"></span><span>选中内容，在属性中编辑</span></div>
    </section>
    <section class="stage-panel">
      <div class="panel-heading"><span>试玩预览 <span class="runtime-dot"></span></span><div class="stage-actions"><span>16 : 9</span><button id="replay" class="icon-button" aria-label="重新试玩">${icon('reload')}</button><button id="expand" class="icon-button" aria-label="放大试玩窗口">${icon('expand')}</button></div></div>
      <div class="stage-well"><div class="stage-aspect"><iframe id="preview-frame" title="现有 Surdet 运行器试玩" src="./preview.html"></iframe><div id="preview-cover"><span>正在准备示例素材…</span></div></div></div>
      <div class="preview-caption"><span id="preview-state">加载中</span><button id="locate" class="text-button" disabled>定位运行行 ${icon('arrow')}</button></div>
      <div class="stage-note">点击画面继续 · 右键打开试玩菜单</div>
    </section>
    <aside class="inspector"><div class="panel-heading"><span>${icon('settings')} 对象属性</span><span id="object-kind"></span></div><div id="inspector-content"></div><div class="inspector-foot">属性编辑更新示例副本。重新试玩后查看新画面。</div></aside>
  </main>
  <footer class="status-bar"><span><i class="status-dot"></i><span id="save-state">示例副本已载入</span></span><span id="layout-description"></span><span id="syntax-status">等待检查</span></footer>
  <div id="toast" role="status" aria-live="polite"></div>
  <dialog id="details"><div class="dialog-heading"><h2>原有能力继续保留</h2><button id="close-details" class="icon-button" aria-label="关闭能力说明">${icon('close')}</button></div><p class="dialog-intro">三个布局共用一份示例状态。已有业务能力仍由原模块负责，这里没有替换后端，也没有绑定正式项目写服务。</p><div class="wiring-summary"><div><b>已复用</b><span>共享剧本文档模型</span><span>Core 语法编译</span><span>现有 preview.html 运行器</span></div><div><b>示例边界</b><span>浏览器内保存副本</span><span>正式观察未发布</span><span>没有批准或写回操作</span></div></div><div class="capability-list">${EDITOR_MODES.map((mode) => `<span>${esc(mode.label)}</span>`).join('')}</div><p class="dialog-intro">正式项目保存、图像导入、Agent 创作、隔离变更、候选组合、审阅、批准、写回及恢复流程，继续使用现有编辑器。布局选定后再逐项接入。</p><a class="open-editor" href="./" target="_blank" rel="noopener">打开现有编辑器 ${icon('arrow')}</a></dialog>
`;

const frame = el<HTMLIFrameElement>('#preview-frame');
let toastTimer = 0;
function toast(message: string): void {
  el('#toast').textContent = message;
  el('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el('#toast').classList.remove('visible'), 3800);
}
function setLayout(next: Layout): void {
  layout = next;
  el('#studio').dataset.layout = next;
  el('.outline').classList.remove('expanded');
  document.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.layout === next)));
  el('#layout-description').textContent = layouts[next].description;
  const url = new URL(location.href);
  url.searchParams.set('layout', next);
  history.replaceState(null, '', url);
}
function renderTree(): void {
  const query = el<HTMLInputElement>('#search').value.toLocaleLowerCase();
  el('#scene-list').innerHTML = scenes.map((entry, index) => `<button class="scene-item ${entry.id === current ? 'active' : ''}" data-scene="${entry.id}" title="${esc(entry.title)}" ${entry.title.toLocaleLowerCase().includes(query) ? '' : 'hidden'}><span class="scene-number">${String(index + 1).padStart(2, '0')}</span><span class="scene-info"><b>${esc(entry.title)}</b><small>${esc(entry.subtitle)}</small></span><span class="scene-indicator"></span></button>`).join('');
}
function selectedLine() { return parseScript(scene().text)[selected]; }
const instructionNames: Record<string, string> = { bg: '背景', show: '立绘', hide: '隐藏', wait: '等待', choice: '选择', goto: '跳转', jump: '场景跳转', end: '结束', scene: '场景' };
const positions = [{ key: 'default', name: '引擎默认位置' }, { key: 'left', name: '左侧' }, { key: 'center', name: '居中' }, { key: 'right', name: '右侧' }, { key: 'ambiguous', name: '位置不明确，请检查源码' }];
function renderDocument(): void {
  const active = scene();
  const lines = parseScript(active.text);
  el('#tab-name').textContent = active.title;
  el('#breadcrumb').textContent = `示例摘录 / ${active.title}`;
  el('#line-count').textContent = `${lines.length} 行`;
  el('#dirty-dot').classList.toggle('dirty', dirty());
  el('#undo').toggleAttribute('disabled', undo.length === 0);
  el('#save-state').textContent = dirty() ? '示例副本 · 有未保存修改' : '示例副本 · 无未保存修改';
  el('#selection-status').textContent = `第 ${Math.min(selected + 1, lines.length)} 行`;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'));
  el('#source-toggle').setAttribute('aria-pressed', String(sourceMode));
  if (view === 'assets') { renderAssets(); return; }
  if (view === 'flow') { renderFlow(); return; }
  if (sourceMode) {
    el('#document-content').innerHTML = `<div class="source-wrap"><label for="source-text">${active.id}.gal · 示例源码</label><textarea id="source-text" spellcheck="false">${esc(active.text)}</textarea><button id="apply-source" class="primary">应用到示例副本</button></div>`;
    return;
  }
  el('#document-content').innerHTML = `<div class="script-header"><div class="chapter-eyebrow">剧本摘录 <span>/</span> ${String(scenes.indexOf(active) + 1).padStart(2, '0')}</div><h1>${esc(active.title)}</h1><p>${esc(active.subtitle)} <span>·</span> 点击任一行编辑</p></div><div class="script-lines">${lines.map((line, index) => {
    if (line.kind === 'blank' || line.kind === 'comment' || (line.kind === 'instr' && line.name === 'scene')) return '';
    let body = '';
    let cls: string = line.kind;
    if (line.kind === 'text') {
      const character = line.speaker === '许知遥';
      body = `<div class="dialogue-identity">${character ? `<img src="${avatar}" alt=""/>` : `<span class="speaker-initial">${line.speaker ? '我' : '—'}</span>`}<b>${esc(line.speaker || '旁白')}</b>${character ? '<span class="speaker-role">电话中的声音</span>' : ''}</div><div class="dialogue-copy">${esc(line.value)}</div>`;
      cls += character ? ' character' : line.speaker ? ' protagonist' : ' narration';
    } else if (line.kind === 'instr') {
      const { name, args } = splitInstr(line.raw);
      const background = name === 'bg' ? backgrounds.find((item) => item.key === args[0]) : undefined;
      const portrait = name === 'show' ? portraits.find((item) => item.key === args[1]) : undefined;
      cls += ` instruction-${name}`;
      if (background) body = `<img class="background-strip" src="${background.url}" alt=""/><div class="asset-overlay">${icon('image')}<b>背景</b><span>${esc(background.name)}</span><small>${esc(background.key)}</small></div>`;
      else if (portrait) body = `<img class="portrait-mini" src="${portrait.url}" alt=""/><span class="instruction-tag">立绘</span><b>许知遥</b><span class="expression-pill">${esc(portrait.name)}</span><small>${esc(positions.find((position) => position.key === instructionPosition(line.raw))!.name)}</small>`;
      else body = `<span class="instruction-tag">${icon(name === 'wait' ? 'clock' : name === 'choice' ? 'branch' : 'scene')}${esc(instructionNames[name] ?? name)}</span><b>${esc(name === 'wait' ? `${args[0] ?? ''} ms` : args.join(' '))}</b>${name === 'wait' ? '<span class="timing-line"><i></i></span>' : ''}`;
    } else if (line.kind === 'label') body = `${icon('branch')}<span>分支</span><b>${esc(line.name)}</b>`;
    else body = `${icon('chevron')}<span>${esc(line.raw.trim())}</span>`;
    return `<button class="script-row ${cls} ${index === selected ? 'selected' : ''}" data-line="${index}" aria-label="第 ${index + 1} 行 ${esc(line.raw)}" aria-pressed="${index === selected}"><span class="line-number">${index + 1}</span><span class="running-marker" ${runningLine === index + 1 && previewRevision === revision ? '' : 'hidden'}>▶</span><span class="line-body">${body}</span></button>`;
  }).join('')}</div>`;
}
function renderAssets(): void {
  el('#document-content').innerHTML = `<div class="asset-browser"><div class="chapter-eyebrow">素材浏览</div><h1>这段故事的画面</h1><p>复用仓库已有图片。选中背景或表情指令后，可从属性面板切换。</p><h2>背景 <small>${backgrounds.length}</small></h2><div class="asset-grid">${backgrounds.map((item) => `<figure><img src="${item.url}" alt="${esc(item.name)}"/><figcaption><b>${esc(item.name)}</b><code>${item.key}</code></figcaption></figure>`).join('')}</div><h2>许知遥 · 通勤装 <small>${portraits.length}</small></h2><div class="asset-grid portraits">${portraits.map((item) => `<figure><img src="${item.url}" alt="许知遥 · ${esc(item.name)}"/><figcaption><b>${esc(item.name)}</b><code>${item.key}</code></figcaption></figure>`).join('')}</div></div>`;
}
function renderFlow(): void {
  const lines = parseScript(scene().text);
  const options = lines.flatMap((line, index) => line.kind === 'choice-option' ? [{ raw: line.raw, index }] : []);
  el('#document-content').innerHTML = `<div class="flow-browser"><div class="chapter-eyebrow">当前片段 · 分支概览</div><h1>${esc(scene().title)}</h1><p>从共享文档模型读取现有选项，点击回到对应源码行。</p><div class="flow-root">${icon('scene')} ${esc(scene().title)}</div>${options.length ? `<div class="flow-branches">${options.map((option) => `<button data-line="${option.index}">${icon('branch')}<span>${esc(option.raw.trim())}</span>${icon('arrow')}</button>`).join('')}</div>` : '<p class="empty-note">该片段是线性演出，没有选择项。</p>'}</div>`;
}
function options(values: { key: string; name: string }[], active: string): string {
  return values.map((value) => `<option value="${esc(value.key)}" ${value.key === active ? 'selected' : ''}>${esc(value.name)}</option>`).join('');
}
function renderInspector(): void {
  const line = selectedLine();
  if (!line) { el('#inspector-content').textContent = '选择一行查看属性。'; return; }
  const title = line.kind === 'text' ? '对白' : line.kind === 'instr' ? instructionNames[line.name] ?? line.name : line.kind === 'choice-option' ? '选项' : '分支';
  el('#object-kind').textContent = title;
  let fields = '';
  if (line.kind === 'text') fields = `<div class="inspector-object"><img src="${avatar}" alt=""/><div><strong>${esc(line.speaker || '旁白')}</strong><small>文字内容</small></div><span class="object-badge">TEXT</span></div><label>说话人<input id="speaker" value="${esc(line.speaker)}" placeholder="留空表示旁白" maxlength="24"/></label><label>对白内容<textarea id="dialogue-text" rows="4">${esc(line.value)}</textarea></label><button class="primary apply-property" id="apply-text">应用修改</button>`;
  else if (line.kind === 'instr') {
    const { name, args } = splitInstr(line.raw);
    if (name === 'bg') fields = `<div class="inspector-thumbnail"><img src="${backgrounds.find((item) => item.key === args[0])?.url ?? backgrounds[0]!.url}" alt="选中的背景"/></div><label>背景素材<select id="background">${options(backgrounds, args[0] ?? '')}</select></label><p class="field-hint">素材标识与现有引擎一致。</p><button id="apply-background" class="primary apply-property">应用背景</button>`;
    else if (name === 'show') fields = `<div class="portrait-object"><img src="${portraits.find((item) => item.key === args[1])?.url ?? portraits[0]!.url}" alt="许知遥当前表情"/><div><strong>许知遥</strong><small>zhirao / commute</small></div></div><label>表情<select id="expression">${options(portraits, args[1] ?? '')}</select></label><label>舞台位置<select id="position">${options(positions, instructionPosition(line.raw))}</select></label><button id="apply-portrait" class="primary apply-property">应用立绘</button>`;
    else if (name === 'wait') fields = `<div class="wait-object">${icon('clock')}<strong>让画面停留片刻</strong></div><label>等待时长 <span class="field-unit">毫秒</span><input id="duration" type="number" min="0" max="60000" step="100" value="${esc(args[0] ?? '500')}"/></label><div class="duration-presets">${[200, 500, 1000, 2000].map((value) => `<button data-duration="${value}">${value}</button>`).join('')}</div><button id="apply-wait" class="primary apply-property">应用时长</button>`;
    else fields = '<p class="field-hint">此示例保留原指令。切换源码视图可修改独立副本，并使用原 Core 检查语法。</p>';
  } else fields = '<p class="field-hint">在源码视图中编辑这个分支。正式结构操作继续使用现有 Authoring 能力。</p>';
  el('#inspector-content').innerHTML = `<div class="property-meta"><span>${esc(scene().title)}</span><span>行 ${selected + 1}</span></div>${fields}<details class="source-detail"><summary>查看原指令</summary><code>${esc(line.raw)}</code></details><div class="property-separator"></div><div class="edit-note"><b>修改 → 重新试玩</b><p>旧画面不会冒充新版本。试玩使用原有引擎，选择和推进都在画面内完成。</p></div>`;
}
function refresh(): void { renderTree(); renderDocument(); renderInspector(); }
function markEdited(): void {
  revision++;
  traceId = '';
  runningLine = null;
  el('#preview-cover').innerHTML = `<span>示例内容已修改</span><button class="primary" id="cover-run">${icon('play')} 重新试玩新版本</button>`;
  el('#preview-cover').hidden = false;
  el('#preview-state').textContent = '预览待更新';
  el('#locate').setAttribute('disabled', '');
  el('#syntax-status').textContent = '内容已变更 · 待检查';
}
function replaceText(text: string): void {
  pendingProperty = false;
  pendingSource = false;
  if (text === scene().text) return;
  undo.push(JSON.stringify(scenes));
  if (undo.length > 60) undo.shift();
  scene().text = text;
  markEdited();
  refresh();
}
function replaceLine(raw: string): boolean {
  if (/[\r\n]/.test(raw)) { toast('单行属性不能包含换行；多行内容请在源码视图编辑。'); return false; }
  const lines = parseScript(scene().text);
  const line = lines[selected];
  if (!line) return false;
  // Use the shared document serializer and keep the exact line terminator.
  lines[selected] = { ...line, raw };
  replaceText(serializeScript(lines));
  toast('已修改示例副本，重新试玩可查看新画面。');
  return true;
}
function flushDraft(): boolean {
  try {
  if (pendingSource) { replaceText(applySourceTextareaEdit(scene().text, el<HTMLTextAreaElement>('#source-text').value)); return true; }
  if (!pendingProperty) return true;
  const line = selectedLine();
  if (line?.kind === 'text') return replaceLine(rebuildTextRaw(el<HTMLInputElement>('#speaker').value.trim(), el<HTMLTextAreaElement>('#dialogue-text').value));
  if (line?.kind === 'instr' && line.name === 'bg') return replaceLine(setInstructionArgument(line.raw, 0, el<HTMLSelectElement>('#background').value));
  if (line?.kind === 'instr' && line.name === 'show') {
    let raw = setInstructionArgument(line.raw, 1, el<HTMLSelectElement>('#expression').value);
    const position = el<HTMLSelectElement>('#position').value;
    if (position === 'left' || position === 'center' || position === 'right') raw = setInstructionPosition(raw, position);
    return replaceLine(raw);
  }
  if (line?.kind === 'instr' && line.name === 'wait') {
    const duration = Number(el<HTMLInputElement>('#duration').value);
    if (!Number.isFinite(duration) || duration < 0 || duration > 60000) { toast('等待时长应在 0–60000 毫秒之间。'); return false; }
    return replaceLine(setInstructionArgument(line.raw, 0, String(duration)));
  }
  return true;
  } catch (error) { toast(error instanceof Error ? error.message : String(error)); return false; }
}
function validate(): boolean {
  if (!flushDraft()) return false;
  try {
    for (const entry of scenes) compileScene(entry.text, `${entry.id}.gal`, entry.id);
    el('#syntax-status').textContent = 'Core 语法检查通过';
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    el('#syntax-status').textContent = '语法检查未通过';
    toast(message);
    return false;
  }
}
let imageData: { backgrounds: { key: string; image: { buffer: ArrayBuffer; mime: string } }[]; portraits: { charId: string; costume: string; expression: string; image: { buffer: ArrayBuffer; mime: string } }[]; avatars: { key: string; image: { buffer: ArrayBuffer; mime: string } }[]; audio: never[] } | null = null;
async function loadImage(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片读取失败：${response.status}`);
  return { buffer: await response.arrayBuffer(), mime: response.headers.get('content-type') ?? 'image/png' };
}
async function run(): Promise<void> {
  if (!frameReady || !imageData) { pendingRun = true; return; }
  pendingRun = false;
  if (!validate()) {
    traceId = '';
    el('#preview-cover').textContent = '当前副本编译失败，请修正源码后重新试玩。';
    el('#preview-cover').hidden = false;
    return;
  }
  traceId = `studio-example-${crypto.randomUUID()}`;
  previewRevision = revision;
  runningLine = null;
  el('#preview-cover').textContent = '正在启动现有预览运行器…';
  el('#preview-cover').hidden = false;
  el('#preview-state').textContent = '正在载入当前副本';
  el('#locate').setAttribute('disabled', '');
  frame.contentWindow?.postMessage({ type: 'surdet-preview-load', payload: {
    traceId,
    projectKey: `surdet-layout-example-${current}`,
    sceneId: current,
    scenes: scenes.map(({ id, text }) => ({ id, text })),
    speakerProfiles: [{ id: 'zhirao', name: '许知遥', avatar: 'zhirao' }],
    assets: imageData,
    fast: true,
    seed: 17,
    strictSource: true,
  } }, location.origin);
}
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  if (event.data?.type === 'surdet-preview-ready') {
    frameReady = true;
    if (pendingRun) void run();
    return;
  }
  const message = normalizePreviewTraceMessage(event.data);
  if (!message || message.traceId !== traceId || previewRevision !== revision) return;
  if (message.type === 'surdet-preview-trace-event') {
    runningLine = message.event.source.line;
    el('#preview-cover').hidden = true;
    el('#preview-state').textContent = `当前副本 · 运行至第 ${runningLine} 行`;
    el('#locate').removeAttribute('disabled');
    document.querySelectorAll<HTMLElement>('.running-marker').forEach((marker) => {
      marker.hidden = Number(marker.closest<HTMLElement>('[data-line]')?.dataset.line) + 1 !== runningLine;
    });
  } else if (message.type === 'surdet-preview-trace-complete') {
    el('#preview-state').textContent = message.status === 'passed' ? '示例片段已结束' : '试玩失败';
    if (message.status !== 'passed') {
      el('#preview-cover').textContent = message.firstError ?? '当前副本试玩失败。';
      el('#preview-cover').hidden = false;
    }
  }
});

function save(): void {
  if (!flushDraft()) return;
  try {
    const serialized = JSON.stringify(scenes);
    localStorage.setItem(storageKey, serialized);
    persisted = serialized;
    renderDocument();
    toast('示例副本已保存在此浏览器；没有写入作品文件。');
  } catch { toast('此浏览器无法保存示例副本。编辑内容仍保留在当前页面。'); }
}
function selectLine(index: number): void {
  if (!flushDraft()) return;
  selected = index;
  view = 'script';
  sourceMode = false;
  renderDocument();
  renderInspector();
  document.querySelector<HTMLElement>(`[data-line="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
}
document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>('button, [data-line]');
  if (!button) return;
  if (button.dataset.layout && Object.hasOwn(layouts, button.dataset.layout)) { setLayout(button.dataset.layout as Layout); return; }
  if (button.dataset.scene) {
    if (!flushDraft()) return;
    current = button.dataset.scene;
    selected = 4;
    view = 'script';
    sourceMode = false;
    markEdited(); // Invalidates the old scene's running position without modifying content.
    refresh();
    void run();
    return;
  }
  if (button.dataset.view) { if (!flushDraft()) return; view = button.dataset.view as View; renderDocument(); return; }
  if (button.dataset.line !== undefined) { selectLine(Number(button.dataset.line)); return; }
  if (button.dataset.duration) { el<HTMLInputElement>('#duration').value = button.dataset.duration; pendingProperty = true; return; }
  switch (button.id) {
    case 'capabilities': el<HTMLDialogElement>('#details').showModal(); break;
    case 'close-details': el<HTMLDialogElement>('#details').close(); break;
    case 'save': save(); break;
    case 'run': case 'replay': case 'cover-run': void run(); break;
    case 'expand': el('#studio').classList.toggle('stage-expanded'); break;
    case 'toggle-tree': el('.outline').classList.toggle('expanded'); break;
    case 'check': if (validate()) toast('共享 Core 已完成三个示例片段的语法编译。'); break;
    case 'source-toggle': if (flushDraft()) { sourceMode = !sourceMode; view = 'script'; renderDocument(); } break;
    case 'apply-source': pendingSource = true; flushDraft(); break;
    case 'apply-text': case 'apply-background': case 'apply-portrait': case 'apply-wait': pendingProperty = true; flushDraft(); break;
    case 'undo': {
      if (!flushDraft()) break;
      const previous = undo.pop();
      if (previous) { scenes = JSON.parse(previous) as ExampleScene[]; markEdited(); refresh(); toast('已撤销一次示例编辑。'); }
      break;
    }
    case 'reset':
      if (!flushDraft()) break;
      undo.push(JSON.stringify(scenes));
      scenes = initialScenes.map((entry) => ({ ...entry }));
      selected = 4;
      markEdited(); refresh(); void run(); toast('初始示例已还原，可用撤销恢复之前的编辑。'); break;
    case 'locate': if (runningLine !== null && previewRevision === revision) selectLine(runningLine - 1); break;
  }
});
el('#search').addEventListener('input', renderTree);
document.addEventListener('input', (event) => {
  const target = event.target as HTMLElement;
  if (target.id === 'source-text') pendingSource = true;
  else if (target.closest('#inspector-content')) pendingProperty = true;
  else return;
  el('#dirty-dot').classList.add('dirty');
  el('#save-state').textContent = '示例副本 · 有未保存修改';
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
  if (event.key === 'Escape') el('#studio').classList.remove('stage-expanded');
});
window.addEventListener('beforeunload', (event) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
const requested = new URL(location.href).searchParams.get('layout');
setLayout(requested && Object.hasOwn(layouts, requested) ? requested as Layout : 'studio');
refresh();
validate();
pendingRun = true;
void (async () => {
  try {
    const [backgroundImages, portraitImages, avatarImage] = await Promise.all([
      Promise.all(backgrounds.map(async (item) => ({ key: item.key, image: await loadImage(item.url) }))),
      Promise.all(portraits.map(async (item) => ({ charId: 'zhirao', costume: 'commute', expression: item.key, image: await loadImage(item.url) }))),
      loadImage(avatar),
    ]);
    imageData = { backgrounds: backgroundImages, portraits: portraitImages, avatars: [{ key: 'zhirao', image: avatarImage }], audio: [] };
    if (frameReady) await run();
  } catch (error) {
    el('#preview-cover').textContent = error instanceof Error ? error.message : String(error);
    el('#preview-state').textContent = '素材读取失败';
  }
})();
