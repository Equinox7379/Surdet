import { state, type SceneEntry } from '../../src/state.js';
import { histories, bindHistoryHooks, undo, redo } from '../../src/history.js';
import { renderEditor, deleteLine } from '../../src/panels/editor.js';
import { disposePreviewPanel, renderPreviewPanel } from '../../src/panels/preview-panel.js';
import { buildAuthoringWorkbench } from '../../src/shell/authoring-workbench.js';
import { disposeScriptV4, revealScriptV4Line } from '../../src/v4/script-workbench.js';
import { enhanceConfigTables } from '../../src/v4/surfaces.js';
import { bindSearchHooks, renderSearchPanel, focusSearchInput, resetSearchSession } from '../../src/panels/search-panel.js';
import { renderConfig, resetConfigSession, inspectConfigDraftState, prepareConfigLabelRename, configUndo } from '../../src/panels/config.js';
import { renderTimelinePanel, bindTimelineHooks, clearTimelineViewStates } from '../../src/panels/timeline-panel.js';
import { clearTimelineHistories, timelineHistoryDepth, takeTimelineUndo } from '../../src/timeline-history.js';
import { renderFlow } from '../../src/panels/flow.js';
import { validateProject } from '../../src/validate.js';
import { openScriptImport } from '../../src/panels/script-import.js';
import { bindLabelEditingHooks, editSceneLabel } from '../../src/label-editing.js';
import { sceneTextSha256 } from '../../src/project-io.js';
import { renderStoryCheckPanel, resetStoryChecks, refreshStoryChecks, disposeStoryCheckPanel } from '../../src/panels/story-check-panel.js';

export const SOURCE = '@scene start\r\n@label opening\r\n@bg hall\r\n@show lynn:uniform normal @ right\r\n凛:你好。\r\n@wait 500\r\n@choice\r\n  继续 -> @goto again\r\n  离开 -> @goto done\r\n@label again\r\n凛：继续。\r\n@label done\r\n@end';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function control<T extends HTMLElement>(selector: string): T { const result = document.querySelector<T>(selector); assert(result, `Missing ${selector}`); return result; }
function clickText(scope: string, label: string): void {
  const target = [...control(scope).querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === label);
  assert(target, `Missing button ${label}`); target.click();
}
function input(selector: string, value: string, event = 'input'): void {
  const element = control<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector); element.value = value;
  element.dispatchEvent(new Event(event, { bubbles: true }));
}
const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };
const nextTask = async (): Promise<void> => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); };

interface DelayedFontRoot {
  root: FileSystemDirectoryHandle;
  requested: () => boolean;
  release: () => void;
}

function makeDelayedFontRoot(name: string, bytes: number[]): DelayedFontRoot {
  const file = new File([String.fromCharCode(...bytes)], 'font.ttf', { type: 'font/ttf', lastModified: 1_700_000_000_000 });
  let requested = false;
  let resolveFile!: (value: File) => void;
  const fileReady = new Promise<File>((resolve) => { resolveFile = resolve; });
  const fileHandle = { getFile: async (): Promise<File> => { requested = true; return fileReady; } } as unknown as FileSystemFileHandle;
  const root = {
    name,
    getFileHandle: async (): Promise<FileSystemFileHandle> => fileHandle,
  } as unknown as FileSystemDirectoryHandle;
  return { root, requested: () => requested, release: () => resolveFile(file) };
}

function makeFontRoot(name: string, bytes: number[]): FileSystemDirectoryHandle {
  const file = new File([String.fromCharCode(...bytes)], 'font.ttf', { type: 'font/ttf', lastModified: 1_700_000_000_000 });
  const fileHandle = { getFile: async (): Promise<File> => file } as unknown as FileSystemFileHandle;
  return {
    name,
    getFileHandle: async (): Promise<FileSystemFileHandle> => fileHandle,
  } as unknown as FileSystemDirectoryHandle;
}

async function startPreviewLoad(host: HTMLElement): Promise<{ frame: HTMLIFrameElement; loads: unknown[] }> {
  const frame = host.querySelector<HTMLIFrameElement>('iframe.preview-frame');
  assert(frame?.contentWindow, 'preview iframe has no window');
  if (frame.contentDocument?.URL !== frame.src || frame.contentDocument?.readyState !== 'complete') {
    await new Promise<void>((resolve, reject) => {
      const loaded = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { frame.removeEventListener('load', loaded); reject(new Error('preview fixture navigation did not finish')); }, 2000);
      frame.addEventListener('load', loaded, { once: true });
    });
  }
  assert(frame.contentDocument?.URL === frame.src, 'preview listener must attach to the final fixture document');
  const loads: unknown[] = [];
  frame.contentWindow.addEventListener('message', (event) => loads.push(event.data));
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'surdet-preview-ready' },
    source: frame.contentWindow,
  }));
  await tick();
  return { frame, loads };
}

async function waitForPublishedPreviewLoad(result: { frame: HTMLIFrameElement; loads: unknown[] }): Promise<void> {
  const published = () => result.loads.some(value => (value as { type?: string } | null)?.type === 'surdet-preview-load');
  const deadline = performance.now() + 2000;
  while (!published() && performance.now() < deadline) await new Promise<void>(resolve => setTimeout(resolve, 10));
  assert(published(), `preview load was not published: ${result.frame.contentDocument?.URL}; messages=${JSON.stringify(result.loads.map(value => (value as { type?: string } | null)?.type))}`);
}

async function waitForFontRead(delayed: DelayedFontRoot): Promise<void> {
  const deadline = performance.now() + 2000;
  while (!delayed.requested() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert(delayed.requested(), 'font read did not become asynchronous');
}

function fixture(sourceText = SOURCE): SceneEntry {
  disposeScriptV4(); disposePreviewPanel();
  resetSearchSession(); state.reviewPreviewReadOnly = false;
  document.body.innerHTML = '<main id="main"></main><div id="status"></div>';
  state.scenes.clear(); histories.clear();
  state.pendingSceneCommit = null; state.pendingSceneDeletes = []; state.pendingSceneConfigWrites = []; state.pendingSceneConfigRenames = []; state.configReadErrors = {};
  state.dirHandle = null; state.projectLoading = false; state.projectWriteLock = null;
  state.reviewWorkspace = null; state.selectedObjectRef = null; state.authoringIndex = null;
  state.previewTrace = []; state.selectedTraceStep = null;
  state.gameConfigText = '{"entryScene":"start","variables":{}}';
  state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
  state.timelines = []; state.dirAssets = []; state.mainTab = 'editor';
  const scene: SceneEntry = {
    id: 'start', file: 'start.gal', text: sourceText,
    eol: sourceText.match(/\r\n|\n|\r/)?.[0] ?? '\n', dirty: false, handle: null,
  };
  state.scenes.set('start', scene); state.current = 'start';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#97b2a1"/></svg>';
  for (const expression of ['normal', 'despair']) {
    const file = new File([svg], `lynn_uniform_${expression}.svg`, { type: 'image/svg+xml' });
    state.dirAssets.push({ key: 'lynn:uniform', kind: 'portrait', expr: expression, isImage: true, sourcePath: `content/assets/portrait/${file.name}`, handle: { getFile: async () => file } as unknown as FileSystemFileHandle });
  }
  const background = new File([svg], 'hall.svg', { type: 'image/svg+xml' });
  state.dirAssets.push({ key: 'hall', kind: 'bg', isImage: true, sourcePath: 'content/assets/bg/hall.svg', handle: { getFile: async () => background } as unknown as FileSystemFileHandle });
  const shell = buildAuthoringWorkbench(); control('#main').append(shell.root);
  bindHistoryHooks({ onEdited: () => {}, onHistoryNav: renderEditor });
  renderEditor(); return scene;
}
export function mountV4Fixture(): void { fixture(); }
export function currentFixtureText(): string { return state.current ? state.scenes.get(state.current)?.text ?? '' : ''; }
export interface BrowserCase { name: string; run: () => void | Promise<void> }
function searchFixture(source = '@scene start\r\n凛：查找一\r\n凛：查找二\r\n@end') {
  const scene = fixture(source);
  const other: SceneEntry = { ...scene, id: 'other', file: 'other.gal', text: '@scene other\n凛：查找三\n@end' };
  state.scenes.set('other', other);
  const jumps: Array<{ key: string; line: number }> = [];
  const draw = () => renderSearchPanel(control('#search-panel'));
  bindSearchHooks({ onEdited: () => {}, onJump: (key, line) => {
    jumps.push({ key, line }); state.current = key; renderEditor(); draw(); revealScriptV4Line(line);
  } });
  draw(); focusSearchInput();
  return { scene, other, jumps, draw };
}
function searchKey(key: string, options: KeyboardEventInit = {}): void {
  control('#search-input').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
}
export const v4WorkbenchCases: BrowserCase[] = [
  { name: 'story check failure exports retain their original input version and current state', run: async () => {
    const scene = fixture('@scene start\n@if true\n'); resetConfigSession(); resetStoryChecks();
    const panel = document.createElement('section'); control('#main').append(panel);
    renderStoryCheckPanel(panel, () => {});
    const run = [...panel.querySelectorAll('button')].find(button => button.textContent === '运行剧情检查')!;
    const download = [...panel.querySelectorAll('button')].find(button => button.textContent === '导出检查与试玩诊断')!;
    const check = async () => {
      run.click(); const deadline = performance.now() + 5000;
      while (run.disabled && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      assert(!run.disabled, 'real worker did not finish');
    };
    const exported = async () => {
      let blob: Blob | null = null; const original = URL.createObjectURL;
      URL.createObjectURL = value => { if (value instanceof Blob) blob = value; return original(value); };
      try {
        download.click(); const deadline = performance.now() + 5000;
        while (!blob && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        assert(blob, 'failure diagnostic was not created'); return JSON.parse(await (blob as Blob).text());
      } finally { URL.createObjectURL = original; }
    };
    await check(); const before = await exported();
    assert(before.checkFailure.code === 'S003' && before.checkFailure.current === true
      && /^[a-f0-9]{64}$/.test(before.checkFailure.inputRevision), 'current compile failure lost its input identity');
    scene.text = '@scene start\n已修正的私有正文\n@end\n'; refreshStoryChecks();
    const stale = await exported();
    assert(stale.checkFailure.current === false && stale.checkFailure.inputRevision === before.checkFailure.inputRevision,
      'stale failure borrowed the new draft identity');
    assert(!JSON.stringify(stale).includes('私有正文') && !JSON.stringify(stale).includes('@if'), 'failure export leaked source');
    const location = [...panel.querySelectorAll('button')].find(button => button.textContent === '打开错误位置')!;
    assert(location.disabled, 'stale error navigation was enabled');
    await check(); const after = await exported();
    assert(after.simulation.current === true && !after.checkFailure, 'new completed check retained the old failure');
    scene.text = '@scene start\n@if false\n'; await check(); const different = await exported();
    assert(different.checkFailure.current === true && different.checkFailure.inputRevision !== before.checkFailure.inputRevision,
      'different failed inputs share an identity');
    disposeStoryCheckPanel();
  } },
  { name: 'story check uses the real worker and rejects stale locations and cancelled results', run: async () => {
    const scene = fixture('@scene start\n@choice\n  继续 -> @end\n'); resetConfigSession(); resetStoryChecks();
    const panel = document.createElement('section'); control('#main').append(panel);
    const jumps: Array<[string, number]> = [];
    renderStoryCheckPanel(panel, (file, line) => jumps.push([file, line]));
    const run = [...panel.querySelectorAll('button')].find(button => button.textContent === '运行剧情检查')!;
    const paths = panel.querySelector<HTMLInputElement>('[aria-label="最多检查路径"]')!;
    paths.value = '2001'; run.click(); assert(!run.disabled && panel.textContent?.includes('路径预算须为 1 到 2000'), 'invalid budget started the worker');
    paths.value = '50';
    run.click();
    const deadline = performance.now() + 5000;
    while (run.disabled && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert(!run.disabled && panel.textContent?.includes('本次模拟已结束 · 对应当前内容'), 'worker did not report the real completed check');
    panel.querySelector<HTMLInputElement>('[aria-label="随机种子"]')!.value = '0';
    assert(panel.textContent?.includes('随机种子 1592639710'), 'result replaced its actual seed with the next run input');
    const branch = [...panel.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith('已选择 · start 第 3 行'))!;
    assert(branch && !branch.disabled, 'current branch location unavailable'); branch.click();
    assert(jumps.length === 1 && jumps[0]![0] === 'content/scenario/start.gal' && jumps[0]![1] === 2, 'branch did not use its real source line');
    let exported: Blob | null = null;
    const original = URL.createObjectURL;
    URL.createObjectURL = value => { if (value instanceof Blob) exported = value; return original(value); };
    try { [...panel.querySelectorAll('button')].find(button => button.textContent === '导出检查与试玩诊断')!.click(); }
    finally { URL.createObjectURL = original; }
    assert(exported !== null, 'download did not receive a diagnostic file');
    const text = await (exported as Blob).text(), diagnostic = JSON.parse(text);
    assert(diagnostic.simulation.current === true && diagnostic.simulation.branches.length === 1
      && diagnostic.simulation.branches[0].location.line === 3, 'download lost actual check facts');
    assert(!text.includes('继续') && !text.includes('finalVariables') && !text.includes('initialVariables'), 'download included raw authoring content');
    state.gameConfigText = '{"entryScene":"start","variables":{"test":{"type":"number","initial":0}}}'; refreshStoryChecks();
    const stale = [...panel.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith('已选择 · start 第 3 行'))!;
    assert(stale.disabled && panel.textContent?.includes('内容已修改，请重新检查'), 'config change did not invalidate all old locations');
    branch.onclick?.(new PointerEvent('click')); assert(jumps.length === 1, 'a stale captured callback navigated into new content');
    run.click();
    [...panel.querySelectorAll('button')].find(button => button.textContent === '取消检查')!.click();
    await nextTask(); assert(!run.disabled && panel.textContent?.includes('已取消，本次没有生成新检查结果'), 'cancel did not stop the active worker');
    run.click(); resetStoryChecks(); state.dirHandle = { name: 'other' } as FileSystemDirectoryHandle;
    panel.replaceChildren(); renderStoryCheckPanel(panel, () => { throw new Error('old project navigation'); });
    await nextTask(); assert(panel.textContent?.includes('尚未运行检查或记录真实试玩'), 'old project result survived reset');
    assert(scene.text === '@scene start\n@choice\n  继续 -> @end\n', 'checks modified source'); disposeStoryCheckPanel();
  } },
  { name: 'unsaved inserted labels reject rename before changing drafts, histories, config rows or pending facts', run: async () => {
    for (const variant of ['source', 'BOM', 'branch']) {
      const source = variant === 'BOM' ? '\uFEFF@scene start\r\n正文保持不变。\r\n@end' : '@scene start\n正文保持不变。\n@end';
      const scene = fixture(source); resetConfigSession();
      state.dirHandle = { name: 'saved-project' } as FileSystemDirectoryHandle;
      scene.handle = { getFile: async () => new File([source], 'start.GAL') } as FileSystemFileHandle;
      scene.persistedSha256 = await sceneTextSha256(source);
      if (variant === 'branch') {
        clickText('#script-v4-toolbar', '添加剧情'); input('.v4-insert-dialog > label select', 'choice', 'change');
        clickText('.v4-insert-dialog footer', '插入到当前步骤之后');
      } else {
        scene.text = source.replace('正文', `@label draft${scene.eol}正文`); scene.dirty = true;
        histories.set('start', { past: [source], future: [], lastPushAt: 0 });
      }
      const name = variant === 'branch' ? 'branch_1_a' : 'draft';
      state.configFiles.gallery = { cgs: [], music: [], texts: [{ id: 'm', scene: 'start', label: name, unlock_text: '' }] };
      const configView = document.createElement('div'); configView.id = 'config-view'; document.body.append(configView); renderConfig(configView);
      let rowsPrepared = false;
      bindLabelEditingHooks({ prepareConfig: (...args) => { rowsPrepared = true; return prepareConfigLabelRename(...args); }, onEdited: () => {} });
      const snapshot = () => JSON.stringify({ scenes: [...state.scenes], histories: [...histories], config: state.configFiles,
        rows: inspectConfigDraftState(), renames: state.pendingSceneConfigRenames, writes: state.pendingSceneConfigWrites, commit: state.pendingSceneCommit });
      const before = snapshot();
      const line = scene.text.split(/\r\n|\n/).findIndex(value => value === `@label ${name}`);
      let message = ''; try { await editSceneLabel('start', line, `@label ${name}`, 'arrival'); } catch (error) { message = String(error); }
      assert(message.includes('先保存') && message.includes('标签'), `new ${variant} label was accepted: ${message}`);
      assert(snapshot() === before && !rowsPrepared, `rejected ${variant} label changed working state`);
    }
  } },
  { name: 'persisted labels with dirty prose can be renamed twice through the original baseline', run: async () => {
    const source = '\uFEFF@scene start\r\n@label entry\r\n原稿。\r\n@end';
    const scene = fixture(source); resetConfigSession();
    state.dirHandle = { name: 'saved-project' } as FileSystemDirectoryHandle;
    scene.handle = { getFile: async () => new File([source], 'start.GAL') } as FileSystemFileHandle;
    scene.persistedSha256 = await sceneTextSha256(source);
    scene.text = source.replace('原稿', '未保存的新正文'); scene.dirty = true;
    histories.set('start', { past: [source], future: [], lastPushAt: 0 });
    bindLabelEditingHooks({ prepareConfig: prepareConfigLabelRename, onEdited: () => {} });
    await editSceneLabel('start', 1, '@label entry', 'middle');
    await editSceneLabel('start', 1, '@label middle', 'arrival');
    assert(scene.text === source.replace('entry', 'arrival').replace('原稿', '未保存的新正文'), 'chain lost label or ordinary prose');
    assert(state.pendingSceneConfigRenames.length === 2 && histories.get('start')!.past[0]!.includes('@label arrival'), 'chain/history facts lost');
  } },
  { name: 'label rename rejects changed disk baseline and a name still occupied on disk without partial edits', run: async () => {
    for (const changed of [false, true]) {
      const source = '@scene start\n@label entry\n正文\n@label occupied\n@end';
      const scene = fixture(source); resetConfigSession();
      state.dirHandle = { name: 'saved-project' } as FileSystemDirectoryHandle;
      scene.handle = { getFile: async () => new File([changed ? source + '\n// external' : source], 'start.gal') } as FileSystemFileHandle;
      scene.persistedSha256 = await sceneTextSha256(source);
      scene.text = source.replace('@label occupied\n', ''); scene.dirty = true;
      const before = scene.text;
      let rejected = false; try { await editSceneLabel('start', 1, '@label entry', changed ? 'arrival' : 'occupied'); } catch { rejected = true; }
      assert(rejected && scene.text === before && state.pendingSceneConfigRenames.length === 0 && !state.pendingSceneCommit, 'unreplayable baseline mutated draft');
    }
  } },
  { name: 'label rename follows cross-scene calls and gallery while rebasing existing undo/redo and preserving source bytes', run: async () => {
    const before = '\uFEFF@scene start\r\n  @label opening\r\n凛：opening 只是正文。\r\n@end';
    const scene = fixture(before); resetConfigSession();
    const caller = { ...scene, id: 'other', file: 'chapter/other.GAL', text: '@scene other\n@label opening\n@call start.opening\n旁白：start.opening 不应替换。\n@end\n' };
    state.scenes.set('chapter/other', caller);
    state.configFiles.gallery = { texts: [{ id: 'memory', name: '开场回想', scene: 'start', label: 'opening', note: 'opening' }], custom: 'keep' };
    histories.set('start', { past: [before.replace('只是正文', '先前正文')], future: [before.replace('只是正文', '后来正文')], lastPushAt: 0 });
    histories.set('chapter/other', { past: [caller.text], future: [], lastPushAt: 0 });
    bindLabelEditingHooks({ prepareConfig: prepareConfigLabelRename, onEdited: () => {} });
    const prompt = window.prompt; window.prompt = () => '抵达';
    try { clickText('#main', '改名并更新引用'); await nextTask(); } finally { window.prompt = prompt; }
    assert(scene.text === before.replace('@label opening', '@label 抵达'), `definition/prose/BOM/CRLF changed incorrectly: ${JSON.stringify({ text: scene.text, status: control('#status').textContent, lock: state.projectWriteLock })}`);
    assert(caller.text.includes('@call start.抵达') && caller.text.includes('@label opening') && caller.text.includes('旁白：start.opening 不应替换。'), 'cross-scene targets/prose were not distinguished');
    assert(JSON.stringify(state.configFiles.gallery) === JSON.stringify({ texts: [{ id: 'memory', name: '开场回想', scene: 'start', label: '抵达', note: 'opening' }], custom: 'keep' }), 'gallery identity or unknown fields changed');
    assert(state.pendingSceneConfigRenames[0]?.labelScene === 'start', 'config relationship was not staged');
    undo(); assert(scene.text.includes('@label 抵达') && scene.text.includes('先前正文'), 'undo restored obsolete identity');
    redo(); assert(scene.text.includes('@label 抵达'), 'redo restored obsolete identity');
    assert(histories.get('chapter/other')!.past[0]!.includes('@call start.抵达'), 'caller history retained obsolete target');
  } },
  { name: 'label deletion rejects live DSL and gallery/draft references; unused removal uses ordinary undo', run: async () => {
    const before = '@scene start\n@label entry\n凛：正文。\n@end\n';
    const scene = fixture(before); resetConfigSession(); bindLabelEditingHooks({ prepareConfig: prepareConfigLabelRename, onEdited: () => {} });
    const caller = { ...scene, id: 'other', file: 'other.gal', text: '@scene other\n@call start.entry\n@end\n' }; state.scenes.set('other', caller);
    deleteLine(1); await nextTask();
    assert(scene.text === before && control('#status').textContent?.includes('仍有引用'), 'used label was deleted');
    state.scenes.delete('other'); state.configFiles.gallery = { texts: [{ id: 'm', name: '入口回想', scene: 'start', label: 'entry' }] };
    deleteLine(1); await nextTask(); assert(scene.text === before && histories.size === 0, 'gallery reference was ignored');
    state.configFiles.gallery = { texts: [] }; deleteLine(1); await nextTask();
    assert(!scene.text.includes('@label') && histories.get('start')?.past.length === 1, 'unused label was not an ordinary edit');
    undo(); assert(scene.text === before, 'deleted unused label could not be restored');
    state.scenes.set('other', caller);
    const confirm = window.confirm; window.confirm = () => true;
    try { clickText('.block[data-line="1"] .v4-row-menu', '删除步骤'); await nextTask(); }
    finally { window.confirm = confirm; }
    assert(scene.text === before && control('#status').textContent?.includes('仍有引用'), 'step menu bypassed label reference protection');
  } },
  { name: 'label edit refuses stale anchors, changed scene objects, readonly and malformed callers before any mutation', run: async () => {
    for (const mode of ['stale', 'replaced', 'readonly', 'bad-caller']) {
      const scene = fixture('@scene start\n@label entry\n凛：正文\n@end'); resetConfigSession();
      const before = scene.text;
      if (mode === 'readonly') state.reviewPreviewReadOnly = true;
      if (mode === 'bad-caller') state.scenes.set('bad', { ...scene, id: 'bad', file: 'bad.gal', text: '@scene bad\n@call "unfinished' });
      const edit = editSceneLabel('start', mode === 'stale' ? 2 : 1, '@label entry', 'arrival');
      if (mode === 'replaced') state.scenes.set('start', { ...scene });
      let rejected = false; try { await edit; } catch { rejected = true; }
      assert(rejected && scene.text === before && !scene.dirty && state.pendingSceneConfigRenames.length === 0 && histories.size === 0, `rejected ${mode} applied part of rename`);
    }
  } },
  { name: 'CSV import previews explicit column/role mapping, creates only a new draft and keeps normal undo', run: async () => {
    const original = fixture(); state.configReadErrors = {}; state.pendingSceneCommit = null; state.pendingSceneDeletes = [];
    state.gameConfigText = '{"entryScene":"start","characters":{"rin":{"name":"凛"}}}';
    openScriptImport(control('#sidebar'), key => { state.current = key; renderEditor(); });
    input('[aria-label="新场景标识"]', 'imported');
    input('[aria-label="格式"]', 'csv', 'change');
    input('[aria-label="原始文字"]', '备注,text,text,speaker\r\n不导入,错列,"你好,雨停了。",rin');
    clickText('.script-import-dialog', '预览导入');
    assert(control<HTMLButtonElement>('.script-import-dialog footer button:last-child').disabled && state.scenes.size === 1, 'ambiguous CSV imported without mapping');
    input('[aria-label="台词列"]', '2', 'change'); input('[aria-label="说话人列"]', '3', 'change');
    clickText('.script-import-dialog', '预览导入');
    input('[aria-label="映射“rin”"]', '凛', 'change');
    clickText('.script-import-dialog', '预览导入');
    assert(control('.script-import-dialog').textContent?.includes('凛：你好,雨停了。'), 'mapped preview missing');
    assert(state.scenes.size === 1 && !original.dirty && histories.size === 0, 'preview changed original scene/history');
    clickText('.script-import-dialog', '确认导入新草稿'); await nextTask();
    const created = state.scenes.get('imported');
    assert(created?.text === '@scene imported\n凛：你好,雨停了。\n@end\n' && created.dirty && created.handle === null && created.pendingCreateOperationId, 'import did not become an ordinary unsaved scene');
    input('.block[data-line="1"] .v4-dialogue-input', '导入后继续编辑。'); await tick(); undo();
    assert(created.text.includes('你好,雨停了。') && !original.dirty, 'import draft did not use ordinary undo');
  } },
  { name: 'import refuses duplicate scenes, changed role configuration, readonly and failed sources without partial edits', run: async () => {
    for (const mutate of [
      () => { state.scenes.set('imported', { ...state.scenes.get('start')!, id: 'imported', file: 'imported.gal' }); },
      () => { state.gameConfigText = '{"characters":{"new":{"name":"新名字"}}}'; },
      () => { state.reviewPreviewReadOnly = true; },
      () => { state.projectWriteLock = 'asset-relocation'; },
      () => { state.configReadErrors.gameConfig = 'unreadable'; },
    ]) {
      const original = fixture(); state.configReadErrors = {}; state.pendingSceneCommit = null; state.pendingSceneDeletes = [];
      openScriptImport(control('#sidebar'), () => {});
      input('[aria-label="新场景标识"]', 'imported'); input('[aria-label="原始文字"]', '旁白：保留的文本。');
      clickText('.script-import-dialog', '预览导入'); mutate();
      const before = [...state.scenes].map(([key, scene]) => [key, scene.text]);
      clickText('.script-import-dialog', '确认导入新草稿'); await nextTask();
      assert(JSON.stringify([...state.scenes].map(([key, scene]) => [key, scene.text])) === JSON.stringify(before) && !original.dirty && histories.size === 0, 'rejected import modified drafts');
    }
    state.configReadErrors = {};
  } },
  { name: 'import uses fatal UTF-8 decoding and ignores late file reads after dialog/project replacement', run: async () => {
    fixture(); state.configReadErrors = {};
    openScriptImport(control('#sidebar'), () => {});
    // 与 field() 的可见标签一致（451e065 中文化后为“选择文本或表格文件”）。
    const upload = control<HTMLInputElement>('[aria-label="选择文本或表格文件"]');
    Object.defineProperty(upload, 'files', { configurable: true, value: [new File([new Uint8Array([0xff, 0xfe, 0x00])], 'bad.txt')] });
    upload.dispatchEvent(new Event('change'));
    // File.arrayBuffer completes on the browser file task queue, not necessarily
    // before the next zero-delay timer. Observe the actual failed-read result.
    const readDeadline = performance.now() + 2000;
    while (!control('.script-import-dialog [role="alert"]').textContent?.includes('文件读取失败')
      && performance.now() < readDeadline) await nextTask();
    assert(control('.script-import-dialog [role="alert"]').textContent?.includes('文件读取失败') && state.scenes.size === 1, 'invalid UTF-8 became a partial import');
    let finish!: (value: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>(resolve => { finish = resolve; });
    Object.defineProperty(upload, 'files', { value: [{ name: 'late.txt', arrayBuffer: () => pending }] });
    upload.dispatchEvent(new Event('change'));
    clickText('.script-import-dialog', '取消');
    openScriptImport(control('#sidebar'), () => {});
    input('[aria-label="原始文字"]', '新窗口的文字。');
    finish(new TextEncoder().encode('过时文件').buffer); await nextTask();
    assert(control<HTMLTextAreaElement>('[aria-label="原始文字"]').value === '新窗口的文字。', 'late old read overwrote new input');
  } },
  { name: '流程图按混合大小写 GAL 扩展名显示真实校验错误和警告', run: async () => {
    const scene = fixture('@scene start\n@jump broken\n');
    state.entryScene = 'start';
    state.scenes.set('chapter/broken', { ...scene, id: 'broken', file: 'chapter/broken.GAL', text: '@scene broken\n@jump missing_scene\n' });
    state.scenes.set('warning', { ...scene, id: 'warning', file: 'warning.GaL', text: '@scene warning\n@choice\n  （还要看看。） -> @jump start\n' });
    const result = await validateProject([...state.scenes].map(([key, value]) => ({ key, id: value.id, file: value.file, source: value.text })), 'start');
    assert(result.issues.some(issue => issue.file === 'chapter/broken.GAL' && issue.severity === 'error'), 'missing actual mixed-case error');
    assert(result.issues.some(issue => issue.file === 'warning.GaL' && issue.severity === 'warning'), 'missing actual mixed-case warning');
    state.lastValidation = result;
    const host = document.createElement('div'); document.body.append(host);
    renderFlow(host);
    host.querySelector<HTMLButtonElement>('[data-flow-action="view-overview"]')!.click();
    assert(host.querySelector('[data-flow-scene-frame="broken"].has-error'), 'error scene displayed without error');
    assert(host.querySelector('[data-flow-scene-frame="warning"].has-warning'), 'warning scene displayed without warning');
    assert(host.querySelector('[data-flow-scene-frame="broken"]')?.textContent?.includes('错误'), 'error count missing');
  } },
  { name: '项目切换后拒绝旧名词表异步导入', run: async () => {
    fixture(); resetConfigSession();
    document.body.innerHTML = '<div id="config-view"></div><div id="status"></div>';
    renderConfig(control('#config-view')); await nextTask();
    clickText('#config-view', '名词表');
    const upload = control<HTMLInputElement>('input[type="file"]');
    let finish!: (text: string) => void;
    const pending = new Promise<string>(resolve => { finish = resolve; });
    const file = new File([''], 'terminology.json');
    Object.defineProperty(file, 'text', { value: () => pending });
    Object.defineProperty(upload, 'files', { value: [file] });
    upload.dispatchEvent(new Event('change', { bubbles: true }));
    resetConfigSession();
    state.configFiles.terminology = { terms: [{ canonical: '新项目', variants: [] }] };
    renderConfig(control('#config-view')); await nextTask();
    const before = control('#config-view').textContent;
    finish(JSON.stringify({ terms: [{ canonical: '旧项目', variants: [] }] }));
    await nextTask();
    assert(control('#config-view').textContent === before, 'old import changed the current project UI');
    assert(!inspectConfigDraftState().dirty, 'old import dirtied the current project');
    resetConfigSession();
  } },
  { name: 'scoped replacement preserves Unicode separators and unrelated dialogue through undo and redo', run: () => {
    for (const separator of ['\u2028', '\u2029']) {
      const before = `@scene start\r\n林汀：前半句${separator}后半句\n周渡：灯塔还亮着。\r@end`;
      const { scene, other } = searchFixture(before);
      const otherBefore = other.text;
      input('#search-input', '灯塔'); input('[aria-label="查找范围"]', 'scene', 'change');
      clickText('#search-panel', '替换'); input('.search-replacement input', '邮局');
      clickText('#search-panel', '替换当前场景');
      assert(scene.text === before && histories.size === 0, 'preview already changed the draft');
      clickText('.search-replace-dialog', '确认替换');
      assert(currentFixtureText() === before.replace('灯塔', '邮局'), 'replacement removed an unrelated source prefix');
      assert(scene.dirty && !other.dirty && other.text === otherBefore, 'scoped replacement saved or changed another scene');
      assert(histories.get('start')?.past.length === 1, 'replacement lost its independent undo point');
      undo(); assert(currentFixtureText() === before, 'undo did not restore every source character');
      redo(); assert(currentFixtureText() === before.replace('灯塔', '邮局'), 'redo did not preserve the unrelated source');
    }
  } },
  { name: 'search retains query, scope and keyboard focus while navigating between real scene rows', run: () => {
    const { jumps } = searchFixture(); input('#search-input', '查找');
    searchKey('Enter'); searchKey('Enter'); searchKey('Enter');
    assert(JSON.stringify(jumps) === JSON.stringify([{ key: 'start', line: 1 }, { key: 'start', line: 2 }, { key: 'other', line: 1 }]), JSON.stringify(jumps));
    searchKey('Enter', { shiftKey: true });
    assert(jumps.at(-1)?.key === 'start' && jumps.at(-1)?.line === 2, 'reverse search lost its position');
    assert(control<HTMLInputElement>('#search-input').value === '查找' && document.activeElement === control('#search-input'), 'query or focus lost after navigation');
    assert(control<HTMLDetailsElement>('.authoring-search-drawer').open && control('.search-count').textContent === '2 / 3 行', 'search drawer did not persist its selected result');
    input('[aria-label="查找范围"]', 'scene', 'change');
    assert(document.querySelectorAll('.search-item').length === 2 && histories.size === 0, 'scope search edited history or included another scene');
  } },
  { name: 'search refuses shifted source and replaced scene identities, then resets on project adoption', run: () => {
    const { scene, jumps, draw } = searchFixture(); input('#search-input', '查找');
    const oldResult = control<HTMLButtonElement>('.search-item'); scene.text = '// shifted\r\n' + scene.text; oldResult.click();
    assert(jumps.length === 0 && control('#status').textContent?.includes('正文已变化'), 'stale line was activated');
    const currentResult = control<HTMLButtonElement>('.search-item'); state.scenes.set('start', { ...scene }); currentResult.click();
    assert(jumps.length === 0, 'replacement project object accepted an old result');
    const beforeReset = control<HTMLButtonElement>('.search-item'); resetSearchSession(); beforeReset.click(); draw();
    assert(jumps.length === 0 && control<HTMLInputElement>('#search-input').value === '', 'project switch reused old query or action');
  } },
  { name: 'scoped replacement keeps other scenes and original per-scene undo, with no implicit save', run: () => {
    const { scene, other } = searchFixture(); const before = scene.text, otherBefore = other.text;
    input('#search-input', '查找'); input('[aria-label="查找范围"]', 'scene', 'change');
    clickText('#search-panel', '替换'); input('.search-replacement input', '修改'); clickText('#search-panel', '替换当前场景');
    clickText('.search-replace-dialog', '确认替换');
    assert(scene.text === before.replaceAll('查找', '修改') && other.text === otherBefore && scene.dirty && !other.dirty, 'replacement crossed scene scope or saved');
    undo(); assert(currentFixtureText() === before && histories.get('start')?.past.length === 0, 'replacement was not a single undo point');
    assert(control<HTMLInputElement>('#search-input').value === '查找', 'replacement discarded search');
  } },
  { name: 'project replacement is explicit and identical replacement does not create history', run: () => {
    const { scene, other } = searchFixture(); input('#search-input', '查找'); clickText('#search-panel', '替换');
    input('.search-replacement input', '查找'); clickText('#search-panel', '替换整个项目');
    assert(histories.size === 0 && !scene.dirty && !other.dirty, 'identical replacement created edits');
    input('.search-replacement input', '共同修改'); clickText('#search-panel', '替换整个项目');
    assert(!scene.dirty && !other.dirty && histories.size === 0, 'project preview mutated documents');
    assert(document.querySelectorAll('.search-replace-dialog details').length === 2, 'preview omitted a scene');
    clickText('.search-replace-dialog', '确认替换');
    assert(scene.text.includes('共同修改') && other.text.includes('共同修改'), 'project scope missed a scene');
    assert(histories.get('start')?.past.length === 1 && histories.get('other')?.past.length === 1, 'project replacement lost independent scene history');
  } },
  { name: 'search reports invalid regex and safely displays literal markup and zero-length matches', run: () => {
    searchFixture('@scene start\n凛：<img src=x>\n@end'); input('#search-input', '<img');
    assert(control('.search-excerpt mark').textContent === '<img' && !control('.search-results').querySelector('img'), 'search interpreted document markup');
    control<HTMLInputElement>('.search-regex input').checked = true;
    control('.search-regex input').dispatchEvent(new Event('change', { bubbles: true })); input('#search-input', '[');
    assert(control<HTMLInputElement>('#search-input').getAttribute('aria-invalid') === 'true' && control('.search-count').textContent === '正则表达式无效', 'invalid regex appeared as no match');
    clickText('#search-panel', '替换'); assert(control<HTMLButtonElement>('.search-replacement button').disabled, 'invalid replacement remained enabled');
    input('#search-input', '^'); assert(document.querySelectorAll('.search-item').length === 6, 'zero-length regex lost lines or failed to terminate');
  } },
  { name: 'search keyboard protects project shortcuts, composition and Escape returns to the drawer trigger', run: () => {
    const { jumps } = searchFixture(); input('#search-input', '查找');
    let leaked = 0; const listener = () => { leaked++; }; window.addEventListener('keydown', listener);
    try {
      searchKey('z', { ctrlKey: true }); searchKey('y', { ctrlKey: true }); searchKey('s', { ctrlKey: true });
      assert(leaked === 0 && histories.size === 0, 'query shortcut reached project history or saving');
    } finally { window.removeEventListener('keydown', listener); }
    searchKey('Enter', { isComposing: true }); assert(jumps.length === 0, 'composition confirmation navigated');
    searchKey('Escape'); assert(!control<HTMLDetailsElement>('.authoring-search-drawer').open && document.activeElement === control('.authoring-search-drawer > summary'), 'Escape lost focus');
    focusSearchInput(); assert(control<HTMLInputElement>('#search-input').value === '查找', 'reopening discarded the query');
  } },
  { name: 'search replacement rechecks readonly, recovery inert and detached control boundaries', run: () => {
    const { scene, draw } = searchFixture(); const before = scene.text;
    input('#search-input', '查找'); clickText('#search-panel', '替换'); input('.search-replacement input', '不可写入');
    const action = control<HTMLButtonElement>('.search-replacement button');
    state.reviewPreviewReadOnly = true; action.click(); state.reviewPreviewReadOnly = false;
    control('#search-panel').inert = true; action.click(); control('#search-panel').inert = false;
    draw(); action.click(); assert(scene.text === before && histories.size === 0, 'protected or detached search mutated the project');
  } },
  { name: 'opening search from its title accepts typing and Escape works before the focus transfer', run: async () => {
    searchFixture(); searchKey('Escape');
    const summary = control<HTMLElement>('.authoring-search-drawer > summary'); summary.click(); await nextTask();
    assert(document.activeElement === control('#search-input'), 'opening the title did not focus search');
    searchKey('Escape'); summary.click();
    summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(!control<HTMLDetailsElement>('.authoring-search-drawer').open && document.activeElement === summary, 'Escape on the title did not close search');
  } },
  { name: 'detached search field events cannot change the visible replacement scope or payload', run: () => {
    const { scene, other, draw } = searchFixture(); const otherBefore = other.text;
    input('#search-input', '查找'); input('[aria-label="查找范围"]', 'scene', 'change');
    clickText('#search-panel', '替换'); input('.search-replacement input', '新文字');
    const query = control<HTMLInputElement>('#search-input'), scope = control<HTMLSelectElement>('[aria-label="查找范围"]');
    const replacement = control<HTMLInputElement>('.search-replacement input'), regex = control<HTMLInputElement>('.search-regex input');
    draw(); query.value = '^'; replacement.value = '旧文字'; scope.value = 'project'; regex.checked = true;
    query.dispatchEvent(new Event('input')); replacement.dispatchEvent(new Event('input'));
    scope.dispatchEvent(new Event('change')); regex.dispatchEvent(new Event('change'));
    clickText('#search-panel', '替换当前场景');
    clickText('.search-replace-dialog', '确认替换');
    assert(scene.text.includes('新文字一') && !scene.text.includes('旧文字') && other.text === otherBefore, 'stale controls retargeted the current replacement');
  } },
  { name: 'replacement preview shows every changed line safely and cancellation is a no-op', run: () => {
    const before = '@scene start\r\n' + Array.from({ length: 205 }, (_, i) => `凛：查找${i}`).join('\r\n');
    const { scene } = searchFixture(before);
    input('#search-input', '查找'); input('[aria-label="查找范围"]', 'scene', 'change');
    clickText('#search-panel', '替换'); input('.search-replacement input', '<img src=x>$&');
    clickText('#search-panel', '替换当前场景');
    const dialog = control<HTMLDialogElement>('.search-replace-dialog');
    assert(dialog.open && dialog.querySelectorAll('[data-replacement-line]').length === 205, 'preview was silently limited to search results');
    assert(dialog.textContent?.includes('205') && dialog.textContent.includes('第 206 行'), 'preview range or original line number missing');
    assert(dialog.textContent?.includes('<img src=x>$&204') && !dialog.querySelector('img'), 'preview interpreted markup or replacement tokens');
    clickText('.search-replace-dialog', '取消');
    assert(scene.text === before && histories.size === 0 && !dialog.isConnected, 'cancel edited the project');
  } },
  { name: 'replacement confirmation rejects changed scope, documents, project identities and permissions atomically', run: () => {
    const mutations = [
      () => { state.scenes.get('other')!.text += '\n旁白：后来新增。'; },
      () => { state.scenes.set('other', { ...state.scenes.get('other')! }); },
      () => { state.scenes.delete('other'); },
      () => { state.scenes.set('extra', { ...state.scenes.get('other')!, id: 'extra', file: 'extra.gal' }); },
      () => { input('.search-replacement input', '尚未预览的词'); },
      () => { input('[aria-label="查找范围"]', 'scene', 'change'); },
      () => { state.projectWriteLock = 'asset-relocation'; },
      () => { state.reviewPreviewReadOnly = true; },
      () => { control('#search-panel').inert = true; },
      () => { resetSearchSession(); },
    ];
    for (const mutate of mutations) {
      const { scene } = searchFixture(), before = scene.text;
      input('#search-input', '查找'); clickText('#search-panel', '替换'); input('.search-replacement input', '共同修改');
      clickText('#search-panel', '替换整个项目');
      const confirm = [...control('.search-replace-dialog').querySelectorAll('button')].find(node => node.textContent === '确认替换')!;
      mutate(); confirm.click();
      assert(scene.text === before && histories.size === 0, 'stale or protected preview partially applied');
    }
  } },
  { name: 'zero-length regex results locate only real editor rows before a terminal newline', run: () => {
    const { jumps } = searchFixture('@scene start\r\n凛：正文\n@end\r');
    input('[aria-label="查找范围"]', 'scene', 'change');
    control<HTMLInputElement>('.search-regex input').checked = true;
    control('.search-regex input').dispatchEvent(new Event('change')); input('#search-input', '^');
    assert(document.querySelectorAll('.search-item').length === 3, 'terminal EOL created a phantom row');
    for (let index = 0; index < 3; index++) { searchKey('Enter'); assert(control('.block.v4-current').dataset.line === String(index), 'result has no real source row'); }
    assert(jumps.length === 3, 'not all physical rows were navigable');
  } },
  { name: 'Enter splits dialogue at the caret as one undoable operation and focuses the next sentence', run: async () => {
    const before = '@scene start\r\n凛:前句后句\r\n@end'; const scene = fixture(before);
    const text = control<HTMLTextAreaElement>('.block[data-line="1"] .v4-dialogue-input');
    text.focus(); text.setSelectionRange(2, 2);
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick();
    assert(currentFixtureText() === '@scene start\r\n凛:前句\r\n凛:后句\r\n@end', scene.text);
    const next = control<HTMLTextAreaElement>('.block[data-line="2"] .v4-dialogue-input');
    assert(document.activeElement === next && next.selectionStart === 0, 'next sentence did not receive the caret');
    undo(); assert(currentFixtureText() === before, 'split was not one undoable operation');
    redo(); assert(scene.text.includes('凛:前句\r\n凛:后句'), 'split redo was lost');
  } },
  { name: 'Enter replaces selected text but leaves a composing IME confirmation untouched', run: async () => {
    const before = '@scene start\n凛：前句删去后句\n@end'; const scene = fixture(before);
    const text = control<HTMLTextAreaElement>('.v4-dialogue-input'); text.focus(); text.setSelectionRange(2, 4, 'backward');
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })); await tick();
    assert(currentFixtureText() === before, 'IME confirmation split the sentence');
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick();
    assert(scene.text === '@scene start\n凛：前句\n凛：后句\n@end', scene.text);
  } },
  { name: 'Enter at terminal narration creates an editable blank row without inventing a speaker', run: async () => {
    const before = '@scene start\r\n没有说话人的旁白'; const scene = fixture(before);
    const text = control<HTMLTextAreaElement>('.v4-dialogue-input'); text.focus(); text.setSelectionRange(text.value.length, text.value.length);
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await tick();
    const next = control<HTMLTextAreaElement>('.block[data-line="2"] .v4-dialogue-input');
    assert(document.activeElement === next, 'blank narration was not editable in the manuscript');
    input('.block[data-line="2"] .v4-dialogue-input', '继续旁白'); await tick();
    assert(scene.text === before + '\r\n继续旁白\r\n', scene.text);
  } },
  { name: 'outline visibility preserves source and history across a view rerender', run: () => {
    const scene = fixture(); const toggle = control<HTMLButtonElement>('.v4-outline-toggle');
    if (toggle.getAttribute('aria-expanded') === 'false') toggle.click();
    toggle.click(); assert(control('.authoring-workbench').dataset.outlineCollapsed === 'true', 'outline did not collapse');
    control<HTMLButtonElement>('[data-script-view="manuscript"]').click();
    assert(control<HTMLButtonElement>('.v4-outline-toggle').getAttribute('aria-expanded') === 'false', 'view change reset layout');
    control<HTMLButtonElement>('.v4-outline-toggle').click();
    assert(scene.text === SOURCE && (histories.get('start')?.past.length ?? 0) === 0, 'layout changed document history');
  } },
  { name: 'enlarging restores the original picture and disposes an open viewer without another renderer', run: () => {
    fixture(); const picture = control('#script-v4-edit-layout'), parent = picture.parentElement;
    const trigger = control<HTMLButtonElement>('.v4-enlarge-picture'); trigger.click();
    assert(control('.v4-picture-dialog').contains(picture) && picture.inert, 'viewer duplicated or left picture actions active');
    clickText('.v4-picture-dialog', '关闭');
    assert(picture.parentElement === parent && !picture.inert && document.activeElement === trigger, 'picture or focus was not restored');
    trigger.click(); disposeScriptV4();
    assert(!document.querySelector('.v4-picture-dialog') && picture.parentElement === parent, 'disposed viewer retained its stage');
    assert(document.querySelectorAll('iframe').length === 0, 'picture view started a runtime');
  } },
  { name: 'step menu closes with Escape and restores its trigger without changing source', run: () => {
    const scene = fixture(); const menu = control<HTMLDetailsElement>('.block[data-line="4"] .v4-row-menu');
    const summary = menu.querySelector('summary')!; summary.click();
    assert(menu.open, 'step menu did not open');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert(!menu.open && document.activeElement === summary && scene.text === SOURCE, 'step menu dismissal changed source or lost focus');
  } },
  { name: 'source edit then insert refreshes row bindings without losing the dialog draft', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-script-view="source"]').click();
    input('.v4-source-editor', SOURCE.replace(/\r\n/g, '\n').replace('你好。', '源码修改。')); await tick();
    const beforeInsert = scene.text;
    const textarea = control<HTMLTextAreaElement>('.v4-source-editor');
    const caret = textarea.value.indexOf('凛:源码修改。'); textarea.setSelectionRange(caret, caret);
    clickText('#script-v4-toolbar', '添加剧情'); input('.v4-insert-fields textarea', '新增对白不丢失。');
    clickText('.v4-insert-dialog footer', '插入到当前步骤之后'); await tick();
    assert(!document.querySelector('.v4-insert-dialog'), 'accepted insertion did not close the dialog');
    assert(scene.text === beforeInsert.replace('凛:源码修改。', '凛:源码修改。\r\n新增对白不丢失。'), scene.text);
    assert(control('.authoring-workbench').dataset.scriptView === 'source', 'source insertion switched views');
    assert(document.activeElement === control('.v4-source-editor'), 'source focus was not restored');
    undo(); assert(scene.text === beforeInsert, 'insert undo removed the earlier source edit');
    redo(); assert(scene.text.includes('新增对白不丢失。'), 'insert redo is missing');
  } },
  { name: 'source insertion anchors to the caret rather than the previous selected row', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-script-view="source"]').click();
    const textarea = control<HTMLTextAreaElement>('.v4-source-editor');
    const caret = textarea.value.indexOf('@wait 500'); textarea.setSelectionRange(caret, caret);
    clickText('#script-v4-toolbar', '添加剧情'); input('.v4-insert-fields textarea', '光标后的对白');
    clickText('.v4-insert-dialog footer', '插入到当前步骤之后'); await tick();
    assert(scene.text.includes('@wait 500\r\n光标后的对白\r\n@choice'), scene.text);
  } },
  { name: 'rejected structural insertion retains dialog, draft, source and history', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-script-view="source"]').click();
    clickText('#script-v4-toolbar', '添加剧情'); input('.v4-insert-fields textarea', '不能因拒绝而消失');
    const historyDepth = histories.get('start')?.past.length ?? 0;
    control<HTMLInputElement>('.block[data-line="3"] .raw input').value = '@show unexpected normal';
    clickText('.v4-insert-dialog footer', '插入到当前步骤之后'); await tick();
    assert(control<HTMLTextAreaElement>('.v4-insert-fields textarea').value === '不能因拒绝而消失', 'draft was discarded');
    assert(control<HTMLDialogElement>('.v4-insert-dialog').open, 'failed insert closed the dialog');
    assert(scene.text === SOURCE, 'rejected insertion changed the source');
    assert((histories.get('start')?.past.length ?? 0) === historyDepth, 'rejected insertion added history');
    clickText('.v4-insert-dialog footer', '取消');
  } },
  { name: 'source location selects the visible UTF-16 row without changing mixed EOL or history', run: () => {
    const original = '@scene start\r\n凛:😀前文\n凛：定位目标\r@end'; const scene = fixture(original);
    control<HTMLButtonElement>('[data-script-view="source"]').click();
    assert(revealScriptV4Line(2), 'visible source navigation was not handled');
    const textarea = control<HTMLTextAreaElement>('.v4-source-editor');
    assert(document.activeElement === textarea, 'hidden row received focus');
    assert(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) === '凛：定位目标', 'wrong source range selected');
    assert(control('.authoring-workbench').dataset.mobilePanel === 'editor', 'source workspace not revealed');
    assert(scene.text === original && (histories.get('start')?.past.length ?? 0) === 0, 'navigation changed content or history');
  } },
  { name: 'long source location scrolls physical rows rather than guessing soft wraps', run: () => {
    const text = ['@scene start', ...Array.from({ length: 80 }, (_, i) => `凛：第${i}句${'长'.repeat(80)}`)].join('\r\n');
    fixture(text); control<HTMLButtonElement>('[data-script-view="source"]').click();
    const textarea = control<HTMLTextAreaElement>('.v4-source-editor');
    textarea.style.cssText = 'width:300px;height:180px;min-height:0;font:14px/24px monospace;padding:8px';
    const editor = control<HTMLElement>('#editor');
    editor.style.cssText = 'height:100px;overflow:auto';
    editor.scrollTop = editor.scrollHeight;
    assert(revealScriptV4Line(61), 'long source location not handled');
    assert(textarea.wrap === 'off' && textarea.scrollTop > 300, 'source row was not brought into the viewport');
    assert(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).startsWith('凛：第60句'), 'wrong long-source row');
    const targetTop = textarea.getBoundingClientRect().top + textarea.clientTop + 8 + 61 * 24 - textarea.scrollTop;
    const visible = editor.getBoundingClientRect();
    assert(targetTop >= visible.top && targetTop + 24 <= visible.bottom, 'selected source row is clipped by the outer editor viewport');
  } },
  { name: 'arrange location preserves the visible row target and makes no content edit', run: () => {
    const scene = fixture();
    assert(revealScriptV4Line(5), 'arrange location not handled');
    assert(document.activeElement === control('.block[data-line="5"]'), 'arrange row was not focused');
    assert(control('.block[data-line="5"]').classList.contains('v4-current'), 'inspector selection did not follow');
    assert(scene.text === SOURCE && (histories.get('start')?.past.length ?? 0) === 0, 'arrange navigation mutated source');
  } },
  { name: 'empty source can insert its first dialogue and retain missing terminal newline', run: async () => {
    const scene = fixture(''); control<HTMLButtonElement>('[data-script-view="source"]').click();
    clickText('#script-v4-toolbar', '添加剧情'); input('.v4-insert-fields textarea', '从空文档开始');
    clickText('.v4-insert-dialog footer', '插入到当前步骤之后'); await tick();
    assert(scene.text === '从空文档开始', scene.text);
    assert(!document.querySelector('.v4-insert-dialog'), 'first insertion did not finish');
  } },
  { name: 'source caret in a choice option inserts after the complete choice group', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-script-view="source"]').click();
    input('.v4-source-editor', SOURCE.replace(/\r\n/g, '\n').replace('你好。', '源文已改。')); await tick();
    const textarea = control<HTMLTextAreaElement>('.v4-source-editor');
    const caret = textarea.value.indexOf('  继续 ->'); textarea.setSelectionRange(caret, caret);
    clickText('#script-v4-toolbar', '添加剧情');
    input('.v4-insert-dialog > label select', 'wait', 'change'); input('.v4-insert-fields input', '600');
    clickText('.v4-insert-dialog footer', '插入到当前步骤之后'); await tick();
    assert(scene.text.includes('  离开 -> @goto done\r\n@wait 600\r\n@label again'), scene.text);
    assert(scene.text.includes('源文已改。'), 'the prior source edit was rolled back');
  } },
  { name: 'visual picker changes expression and retains modifier', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-step-summary="3"]').click();
    control<HTMLButtonElement>('[aria-label="选择表情 despair"]').click(); await tick();
    assert(scene.text.includes('@show lynn:uniform despair @ right\r\n'), scene.text);
  } },
  { name: 'position and expression edits compose, rather than overwriting each other', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-step-summary="3"]').click();
    clickText('#script-v4-inspector', '左侧');
    control<HTMLButtonElement>('[aria-label="选择表情 despair"]').click(); await tick();
    assert(scene.text.includes('@show lynn:uniform despair @ left'), scene.text);
  } },
  { name: 'dialogue writes through the mounted B01 input immediately', run: async () => {
    const scene = fixture(); input('.block[data-line="4"] .v4-dialogue-input', '新的台词。'); await tick();
    assert(scene.text.includes('凛:新的台词。\r\n'), scene.text);
  } },
  { name: 'disposing the workbench cancels a queued dialogue reflow without editing history', run: async () => {
    const scene = fixture();
    const editor = control<HTMLElement>('#editor');
    const textarea = control<HTMLTextAreaElement>('.block[data-line="4"] .v4-dialogue-input');
    const frame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));
    editor.style.width = '680px'; await frame(); await frame();
    const beforeHistory = JSON.stringify([...histories]);
    let writes = 0;
    const mutations = new MutationObserver(records => { writes += records.length; });
    let disposed = false;
    // Registered after the production observer: abort after it queues its frame.
    const boundary = new ResizeObserver(entries => {
      if (entries[0]?.contentRect.width !== 380) return;
      disposeScriptV4();
      mutations.observe(textarea, { attributes: true, attributeFilter: ['style'] });
      disposed = true;
    });
    boundary.observe(editor);
    try {
      editor.style.width = '380px'; await frame(); await frame();
      assert(disposed, 'the real resize observer did not reach the disposal boundary');
      editor.style.width = '520px'; await frame(); await frame();
      assert(writes === 0, 'disposed workbench resized a detached-owner dialogue');
      assert(scene.text === SOURCE && !scene.dirty, 'layout teardown changed the document');
      assert(JSON.stringify([...histories]) === beforeHistory, 'layout teardown changed undo history');
    } finally { boundary.disconnect(); mutations.disconnect(); }
  } },
  { name: 'multiline paste does not pass through text-input newline stripping', run: async () => {
    const scene = fixture(); input('.block[data-line="4"] .v4-dialogue-input', '第一行\n第二行'); await tick();
    assert(scene.text.includes('凛:第一行\r\n第二行\r\n'), scene.text);
    assert(control('.authoring-workbench').dataset.scriptView === 'source', 'multiline source fallback missing');
  } },
  { name: 'multiline paste preserves CR-only EOL on a terminal dialogue row', run: async () => {
    const scene = fixture('@scene start\r@bg hall\r凛:你好');
    input('.block[data-line="2"] .v4-dialogue-input', '第一行\n第二行'); await tick();
    assert(scene.text === '@scene start\r@bg hall\r凛:第一行\r第二行', scene.text);
  } },
  { name: 'voice association preserves CR-only EOL before a terminal dialogue row', run: async () => {
    const scene = fixture('@scene start\r凛:你好');
    state.dirAssets.push({ key: 'voice_line', kind: 'voice', isImage: false, handle: {} as FileSystemFileHandle });
    control<HTMLButtonElement>('[data-step-summary="1"]').click();
    control<HTMLElement>('#script-v4-inspector .v4-disclosure summary').click();
    input('#script-v4-inspector [aria-label="语音文件"]', 'voice_line', 'change'); await tick();
    assert(scene.text === '@scene start\r@voice voice_line\r凛:你好', scene.text);
  } },
  { name: 'raw edits refresh typed fields without undoing previous modifiers', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-step-summary="3"]').click();
    input('.block[data-line="3"] .raw input', '@show lynn:uniform normal @ left'); await tick();
    input('#script-v4-inspector .fields [aria-label="表情/第二参数"]', 'despair'); await tick();
    assert(scene.text.includes('@show lynn:uniform despair @ left'), scene.text);
  } },
  { name: 'source view edit retains CRLF and the missing terminal newline', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-script-view="source"]').click();
    input('.v4-source-editor', scene.text.replace(/\r\n/g, '\n').replace('你好。', '源码修改。')); await tick();
    assert(scene.text.includes('凛:源码修改。\r\n'), scene.text); assert(!scene.text.endsWith('\n'), 'terminal newline changed');
    control<HTMLButtonElement>('[data-script-view="arrange"]').click();
    assert(control<HTMLTextAreaElement>('.block[data-line="4"] .v4-dialogue-input').value === '源码修改。', 'view did not share source');
  } },
  { name: 'scene histories remain independent', run: async () => {
    const a = fixture(); input('.block[data-line="4"] .v4-dialogue-input', 'A修改'); await tick();
    const b: SceneEntry = { ...a, id: 'second', file: 'second.gal', text: SOURCE, dirty: false };
    state.scenes.set('second', b); state.current = 'second'; renderEditor();
    input('.block[data-line="4"] .v4-dialogue-input', 'B修改'); await tick();
    state.current = 'start'; renderEditor(); undo();
    assert(a.text === SOURCE, 'A undo wrong'); assert(b.text.includes('B修改'), 'B accidentally undone'); redo();
    assert(a.text.includes('A修改'), 'A redo missing');
  } },
  { name: 'detached visual picker cannot change a new selection', run: () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-step-summary="3"]').click();
    const old = control<HTMLButtonElement>('[aria-label="选择表情 despair"]');
    control<HTMLButtonElement>('[data-step-summary="5"]').click(); old.click();
    assert(scene.text === SOURCE, 'detached picker wrote');
  } },
  { name: 'recovery inert state blocks visual mutations', run: () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-step-summary="3"]').click();
    control('#main').setAttribute('inert', ''); control<HTMLButtonElement>('[aria-label="选择表情 despair"]').click();
    assert(scene.text === SOURCE, 'inert picker wrote');
  } },
  { name: 'new step insertion keeps choice options grouped', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-step-summary="7"]').click(); clickText('#script-v4-toolbar', '添加剧情');
    input('.v4-insert-dialog > label select', 'wait', 'change');
    input('.v4-insert-fields input', '600'); clickText('.v4-insert-dialog footer', '插入到当前步骤之后'); await tick();
    assert(scene.text.includes('  离开 -> @goto done\r\n@wait 600\r\n@label again'), scene.text);
  } },
  { name: 'insert dialog preserves draft across type changes', run: () => {
    fixture(); clickText('#script-v4-toolbar', '添加剧情'); input('.v4-insert-fields textarea', '没有丢失的草稿');
    input('.v4-insert-dialog > label select', 'wait', 'change'); input('.v4-insert-dialog > label select', 'text', 'change');
    assert(control<HTMLTextAreaElement>('.v4-insert-fields textarea').value === '没有丢失的草稿', 'draft lost');
    clickText('.v4-insert-dialog footer', '取消');
  } },
  { name: 'stale insertion dialog refuses to modify the changed document', run: () => {
    const scene = fixture(); clickText('#script-v4-toolbar', '添加剧情'); scene.text += '\r\n// external';
    clickText('.v4-insert-dialog footer', '插入到当前步骤之后');
    assert(scene.text === SOURCE + '\r\n// external', 'stale insertion wrote');
  } },
  { name: 'simple branch field uses the full current source row', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-step-summary="7"]').click();
    input('#script-v4-inspector [aria-label="选项文字"]', '继续看看');
    input('#script-v4-inspector [aria-label="显示条件（可空）"]', 'score > 5'); await tick();
    assert(scene.text.includes('  继续看看 [if:score > 5] -> @goto again\r\n'), scene.text);
  } },
  { name: 'blank intermediate choice can be completed in the same field', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-step-summary="7"]').click();
    input('#script-v4-inspector [aria-label="选项文字"]', '');
    input('#script-v4-inspector [aria-label="选项文字"]', '重新填写'); await tick();
    assert(scene.text.includes('  重新填写 -> @goto again'), scene.text);
  } },
  { name: 'configuration object presentation preserves original input handlers', run: () => {
    fixture(); const host = document.createElement('div'); host.id = 'config-view'; document.body.append(host);
    host.innerHTML = '<section data-config-section="variables"><div class="config-table-scroll"><table class="config-table"><thead><tr><th>变量</th><th>初始值</th></tr></thead><tbody><tr><td><input value="score"></td><td><input value="0"></td></tr><tr><td><input value="other"></td><td><input value="1"></td></tr></tbody></table></div></section>';
    const original = host.querySelectorAll<HTMLInputElement>('tbody input')[1]!; let changed = '';
    original.oninput = () => { changed = original.value; };
    enhanceConfigTables(host); original.value = '15'; original.dispatchEvent(new Event('input', { bubbles: true }));
    assert(changed === '15', 'lost original handler'); assert(host.querySelectorAll('tbody input').length === 4, 'original fields removed');
  } },
  { name: 'character portrait fields retain drafts and undo while stale and readonly controls cannot edit', run: async () => {
    fixture(); resetConfigSession();
    state.gameConfigText = JSON.stringify({ entryScene: 'start', characters: { lynn: { name: '凛' } }, variables: {} });
    state.dirAssets = [{ kind: 'portrait', key: 'art:coat', expr: 'smile', isImage: true, handle: null, sourcePath: 'content/assets/portrait/art_coat_smile.svg' }];
    const host = document.createElement('div'); host.id = 'config-view'; document.body.append(host);
    renderConfig(host); await nextTask();
    const selector = '[aria-label="lynn 添加服装 / 表情"]';
    control<HTMLButtonElement>(selector).click();
    input('[aria-label="lynn 第 1 项服装"]', 'uniform');
    input('[aria-label="lynn 第 1 项表情"]', 'smile');
    input('[aria-label="lynn 第 1 项立绘"]', 'content/assets/portrait/art_coat_smile.svg', 'change');
    assert(inspectConfigDraftState().dirtySections.includes('characters'), 'mapping did not enter normal config draft');
    assert(!state.gameConfigText.includes('portraits'), 'editing wrote through the source configuration');
    const old = control<HTMLInputElement>('[aria-label="lynn 第 1 项表情"]');
    const remove = control<HTMLButtonElement>('[aria-label="lynn 移除第 1 项绑定"]');
    remove.click();
    assert(!document.querySelector('[aria-label="lynn 第 1 项表情"]'), 'remove left the old row active');
    old.value = 'stale'; old.dispatchEvent(new Event('input', { bubbles: true }));
    configUndo();
    assert(control<HTMLInputElement>('[aria-label="lynn 第 1 项表情"]').value === 'smile', 'undo lost mapping or stale control changed it');
    state.reviewPreviewReadOnly = true;
    control<HTMLButtonElement>(selector).click();
    assert(!document.querySelector('[aria-label="lynn 第 2 项服装"]'), 'readonly mapping was added');
    state.reviewPreviewReadOnly = false;
  } },
  { name: 'portrait pickers use unambiguous logical bindings, not backup filenames or scanner keys', run: async () => {
    const scene = fixture();
    const normal = state.dirAssets.find(asset => asset.expr === 'normal')!;
    const backup = { ...normal, sourcePath: 'content/assets/portrait/lynn_uniform_normal_backup.svg' };
    state.dirAssets.push(backup);
    renderEditor(); control<HTMLButtonElement>('[data-step-summary="3"]').click();
    assert(document.querySelectorAll('[aria-label="选择表情 normal"]').length === 1, 'backup became a second normal expression');
    state.dirAssets.push({ ...normal, sourcePath: 'content/assets/portrait/lynn_uniform_normal.webp' });
    renderEditor(); control<HTMLButtonElement>('[data-step-summary="3"]').click();
    assert(!document.querySelector('[aria-label="选择表情 normal"]'), 'ambiguous expression remained selectable');
    state.gameConfigText = JSON.stringify({ characters: { lynn: { portraits: { uniform: { normal: backup.sourcePath, smile: backup.sourcePath } } } } });
    renderEditor(); control<HTMLButtonElement>('[data-step-summary="3"]').click();
    assert(document.querySelectorAll('[aria-label="选择表情 normal"]').length === 1, 'explicit binding did not resolve the duplicate');
    control<HTMLButtonElement>('[aria-label="选择表情 smile"]').click(); await tick();
    assert(scene.text.includes('@show lynn:uniform smile'), 'explicit expression did not update the original instruction');
    clickText('#script-v4-toolbar', '添加剧情'); input('.v4-insert-dialog > label select', 'show', 'change');
    input('.v4-insert-fields [aria-label="素材"]', 'lynn:uniform', 'change');
    const expressions = [...control<HTMLSelectElement>('.v4-insert-fields [aria-label="表情"]').options].map(option => option.value);
    assert(expressions.includes('smile') && expressions.filter(value => value === 'normal').length === 1, 'insertion did not use the same bindings');
    clickText('.v4-insert-dialog footer', '取消');
  } },
  { name: 'stale inspector does not reinterpret a different instruction as a portrait', run: async () => {
    const scene = fixture(); control<HTMLButtonElement>('[data-step-summary="3"]').click();
    const old = control<HTMLButtonElement>('[aria-label="选择表情 despair"]');
    input('.block[data-line="3"] .raw input', '@bg hall'); await tick(); old.click();
    assert(scene.text.includes('@bg hall\r\n凛:'), 'stale portrait picker rewrote another instruction');
    assert(!scene.text.includes('despair'), 'stale expression was inserted');
  } },
  { name: 'external row insertion cannot retarget old structural controls', run: async () => {
    const scene = fixture(); const block = control('.block[data-line="3"]');
    scene.text = '// external\r\n' + scene.text;
    // A harmless input event must not make stale row coordinates trustworthy.
    control('.authoring-workbench').dispatchEvent(new Event('input', { bubbles: true })); await tick();
    const expected = scene.text;
    block.querySelector<HTMLButtonElement>('[aria-label="下移剧情步骤，第 4 行"]')!.click();
    assert(scene.text === expected, 'old row coordinate changed the new document');
  } },
  { name: 'native JSON textarea retains multiline invalid drafts and original handler', run: () => {
    fixture(); const host = document.createElement('div'); document.body.append(host);
    host.innerHTML = '<section data-config-section="events"><div class="config-table-scroll"><table class="config-table"><thead><tr><th>effects</th></tr></thead><tbody><tr><td><textarea class="mono"></textarea></td></tr></tbody></table></div></section>';
    const original = host.querySelector<HTMLTextAreaElement>('textarea')!; let saved = '';
    original.oninput = () => { saved = original.value; };
    enhanceConfigTables(host); original.value = '{\n  "unfinished":'; original.dispatchEvent(new Event('input', { bubbles: true }));
    assert(saved === '{\n  "unfinished":', 'JSON newline or invalid draft was altered');
    assert(host.querySelector('textarea') === original, 'native handler was replaced');
  } },
  { name: 'preview teardown preserves observations for source navigation', run: () => {
    fixture();
    const observed = { kind: 'instruction', source: { sceneId: 'start', index: 0, op: 'text', file: 'start.gal', line: 5, col: 1 } } as (typeof state.previewTrace)[number];
    state.previewTrace = [observed]; state.selectedTraceStep = 0;
    disposePreviewPanel();
    assert(state.previewTrace[0] === observed && state.selectedTraceStep === 0, 'teardown erased causal observations');
    state.previewTrace = []; state.selectedTraceStep = null;
  } },
  { name: 'delayed preview replay source abort keeps the prior observation', run: async () => {
    fixture();
    state.dirName = 'preview-edit-project'; state.dirHandle = makeFontRoot('preview-edit-project', [1, 2, 3]);
    state.gameConfigText = JSON.stringify({ font: 'font.ttf' });
    const host = document.createElement('section'); document.body.append(host); renderPreviewPanel(host);
    const first = await startPreviewLoad(host); await waitForPublishedPreviewLoad(first);
    const observed = { kind: 'instruction', source: { sceneId: 'start', index: 0, op: 'text', file: 'start.gal', line: 5, col: 1 } } as (typeof state.previewTrace)[number];
    state.previewTrace = [observed]; state.selectedTraceStep = 0;
    const delayed = makeDelayedFontRoot('preview-edit-project', [1, 2, 3]); state.dirHandle = delayed.root;
    await startPreviewLoad(host);
    await waitForFontRead(delayed);
    state.scenes.get('start')!.text += '\r\n// changed during preview read';
    delayed.release(); await tick(); await nextTask();
    assert(state.previewTrace[0] === observed && state.selectedTraceStep === 0, 'aborted preview erased the prior observation');
    disposePreviewPanel();
  } },
  { name: 'delayed preview replay project switch keeps the prior observation', run: async () => {
    fixture();
    state.dirName = 'preview-project-a'; state.dirHandle = makeFontRoot('preview-project-a', [4, 5, 6]);
    state.gameConfigText = JSON.stringify({ font: 'font.ttf' });
    const host = document.createElement('section'); document.body.append(host); renderPreviewPanel(host);
    const first = await startPreviewLoad(host); await waitForPublishedPreviewLoad(first);
    const observed = { kind: 'instruction', source: { sceneId: 'start', index: 0, op: 'text', file: 'start.gal', line: 5, col: 1 } } as (typeof state.previewTrace)[number];
    state.previewTrace = [observed]; state.selectedTraceStep = 0;
    const delayed = makeDelayedFontRoot('preview-project-a', [4, 5, 6]); state.dirHandle = delayed.root;
    await startPreviewLoad(host);
    await waitForFontRead(delayed);
    const nextScene: SceneEntry = { id: 'next', file: 'next.gal', text: '@scene next\n@end', eol: '\n', dirty: false, handle: null };
    state.dirName = 'preview-project-b'; state.dirHandle = makeFontRoot('preview-project-b', [7, 8, 9]);
    state.scenes = new Map([['next', nextScene]]); state.current = 'next';
    delayed.release(); await tick(); await nextTask();
    assert(state.previewTrace[0] === observed && state.selectedTraceStep === 0, 'aborted project switch erased the prior observation');
    disposePreviewPanel();
  } },
  { name: 'delayed preview replay detach keeps the prior observation', run: async () => {
    fixture();
    state.dirName = 'preview-detach-project'; state.dirHandle = makeFontRoot('preview-detach-project', [10, 11, 12]);
    state.gameConfigText = JSON.stringify({ font: 'font.ttf' });
    const host = document.createElement('section'); document.body.append(host); renderPreviewPanel(host);
    const first = await startPreviewLoad(host); await waitForPublishedPreviewLoad(first);
    const observed = { kind: 'instruction', source: { sceneId: 'start', index: 0, op: 'text', file: 'start.gal', line: 5, col: 1 } } as (typeof state.previewTrace)[number];
    state.previewTrace = [observed]; state.selectedTraceStep = 0;
    const delayed = makeDelayedFontRoot('preview-detach-project', [10, 11, 12]); state.dirHandle = delayed.root;
    await startPreviewLoad(host);
    await waitForFontRead(delayed);
    disposePreviewPanel();
    delayed.release(); await tick(); await nextTask();
    assert(state.previewTrace[0] === observed && state.selectedTraceStep === 0, 'detached preview erased the prior observation');
  } },
  { name: 'role font map overrides the entire legacy font configuration', run: async () => {
    fixture();
    state.dirHandle = makeFontRoot('role-fonts', [1, 2, 3]);
    state.gameConfigText = JSON.stringify({ font: 'font.ttf', fonts: { body: 'font.ttf', title: '' } });
    const host = document.createElement('section'); document.body.append(host); renderPreviewPanel(host);
    const sent = await startPreviewLoad(host); await waitForPublishedPreviewLoad(sent);
    const load = sent.loads.find((value) => (value as { type?: string })?.type === 'surdet-preview-load') as { payload: { fonts: Record<string, unknown> } };
    assert(JSON.stringify(Object.keys(load.payload.fonts)) === '["body"]', 'absent ui role incorrectly inherited legacy font');
    disposePreviewPanel();
  } },
  { name: 'same-name project roots do not reuse a prior font buffer', run: async () => {
    fixture();
    state.dirName = 'same-name-project'; state.dirHandle = makeFontRoot('same-name-project', [21, 22, 23]);
    state.gameConfigText = JSON.stringify({ font: 'font.ttf' });
    const firstHost = document.createElement('section'); document.body.append(firstHost); renderPreviewPanel(firstHost);
    const first = await startPreviewLoad(firstHost);
    for (let attempt = 0; attempt < 10 && first.loads.length === 0; attempt++) await nextTask();
    const firstLoad = first.loads.find((value) => (value as { type?: string } | null)?.type === 'surdet-preview-load') as { payload?: { fonts?: { body?: { buffer?: ArrayBuffer } } } } | undefined;
    assert(firstLoad?.payload?.fonts?.body?.buffer, 'first preview load did not contain the test font');
    assert(JSON.stringify([...new Uint8Array(firstLoad.payload.fonts.body.buffer)]) === JSON.stringify([21, 22, 23]), 'first preview font bytes drifted');
    disposePreviewPanel();

    fixture();
    state.dirName = 'same-name-project'; state.dirHandle = makeFontRoot('same-name-project', [31, 32, 33]);
    state.gameConfigText = JSON.stringify({ font: 'font.ttf' });
    const secondHost = document.createElement('section'); document.body.append(secondHost); renderPreviewPanel(secondHost);
    const second = await startPreviewLoad(secondHost);
    for (let attempt = 0; attempt < 10 && second.loads.length === 0; attempt++) await nextTask();
    const secondLoad = second.loads.find((value) => (value as { type?: string } | null)?.type === 'surdet-preview-load') as { payload?: { fonts?: { body?: { buffer?: ArrayBuffer } } } } | undefined;
    assert(secondLoad?.payload?.fonts?.body?.buffer, 'second preview load did not contain the test font');
    assert(JSON.stringify([...new Uint8Array(secondLoad.payload.fonts.body.buffer)]) === JSON.stringify([31, 32, 33]), 'same-name project reused prior font bytes');
    disposePreviewPanel();
  } },
  { name: 'same-path font bytes refresh with unchanged size and modification time', run: async () => {
    fixture();
    const makeFile = (bytes: number[]) => new File([new Uint8Array(bytes)], 'font.ttf', { type: 'font/ttf', lastModified: 1_700_000_000_000 });
    let file = makeFile([41, 42, 43]);
    const handle = { getFile: async () => file } as unknown as FileSystemFileHandle;
    const root = { name: 'same-project', getFileHandle: async () => handle } as unknown as FileSystemDirectoryHandle;
    state.dirHandle = root;
    state.gameConfigText = JSON.stringify({ fonts: { body: 'font.ttf' } });
    const host = document.createElement('section'); document.body.append(host); renderPreviewPanel(host);
    const read = async () => {
      const sent = await startPreviewLoad(host); await waitForPublishedPreviewLoad(sent);
      return (sent.loads.find(value => (value as { type?: string })?.type === 'surdet-preview-load') as {
        payload: { fonts: { body: { buffer: ArrayBuffer; version: string } } };
      }).payload.fonts.body;
    };
    const first = await read();
    const replacement = makeFile([51, 52, 53]);
    assert(file.size === replacement.size && file.lastModified === replacement.lastModified, 'fixture metadata differs');
    file = replacement;
    const second = await read();
    assert(state.dirHandle === root, 'fixture replaced the root identity');
    assert(JSON.stringify([...new Uint8Array(second.buffer)]) === '[51,52,53]', 'same metadata returned stale font bytes');
    const digest = await crypto.subtle.digest('SHA-256', second.buffer);
    assert(second.version === [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''), 'font identity does not match sent bytes');
    assert(second.version !== first.version, 'changed font retained old registration version');
    const third = await read();
    assert(third.version === second.version && third.buffer.byteLength === 3, 'repeat transfer reused detached or stale bytes');
    disposePreviewPanel();
  } },
  { name: 'timeline resource insertion selects the committed cue and retains undo selection', run: () => {
    fixture(); clearTimelineHistories(); clearTimelineViewStates();
    let edits = 0;
    bindTimelineHooks({ onPreview: () => {}, onEdited: () => { edits++; } });
    const text = '\uFEFF' + JSON.stringify({ version: 1, id: 't', durationMs: 1000, tracks: [
      { kind: 'portrait', target: 'lynn:uniform', cues: [{ action: 'show', expression: 'normal', position: 'left', atMs: 50, durationMs: 100, easing: 'linear' }] },
    ] }, null, 2).replaceAll('\n', '\r\n');
    const entry = { id: 't', file: 't.json', text, eol: '\r\n' as const, dirty: false, handle: null };
    state.timelines = [entry]; state.currentTimeline = 't'; state.currentTimelineCue = { trackIndex: 0, cueIndex: 0 };
    const panel = control<HTMLElement>('#main'); renderTimelinePanel(panel);
    input('[data-timeline-focus="track-0-add-action"]', 'show', 'change');
    const resource = control<HTMLSelectElement>('[data-timeline-focus="track-0-add-resource"]');
    const option = [...resource.options].find(item => item.value !== '' && !item.disabled);
    assert(option, 'the real project portrait must be selectable'); resource.value = option.value;
    control<HTMLButtonElement>('[data-timeline-focus="track-0-add"]').click();
    const added = JSON.parse(entry.text.slice(1));
    assert(added.tracks[0].cues.length === 2 && entry.dirty && edits === 1, 'insertion did not commit once');
    assert(state.currentTimelineCue?.trackIndex === 0 && state.currentTimelineCue.cueIndex === 1, 'new cue was not selected');
    assert(control('[data-timeline-focus="cue-0-1"]').classList.contains('selected'), 'committed cue is not visibly selected');
    assert(added.tracks[0].cues[0].atMs === 50 && added.tracks[0].cues[0].position === 'left', 'existing cue changed');
    assert(entry.text.startsWith('\uFEFF') && !/(?<!\r)\n/.test(entry.text), 'BOM or CRLF lost');
    const previous = takeTimelineUndo('t', entry.text, state.currentTimelineCue);
    assert(previous?.text === text && previous.selection?.cueIndex === 0, 'undo lost original bytes or selection');
    bindTimelineHooks({ onPreview: () => {}, onEdited: () => {} }); clearTimelineViewStates();
  } },
  { name: 'timeline disclosure clicks survive immediate rerender and switching timelines', run: async () => {
    fixture(); clearTimelineHistories(); clearTimelineViewStates();
    bindTimelineHooks({ onPreview: () => {}, onEdited: () => {} });
    const entry = (id: string) => ({ id, file: `${id}.json`, text: JSON.stringify({ version: 1, id, durationMs: 1000, tracks: [{ kind: 'camera', cues: [] }] }), eol: '\n' as const, dirty: false, handle: null });
    state.timelines = [entry('first'), entry('second')]; state.currentTimeline = 'first'; state.currentTimelineCue = null;
    const panel = control<HTMLElement>('#main'); panel.style.width = '780px';
    renderTimelinePanel(panel); await nextTask();
    for (const selector of ['.timeline-inspector', '.timeline-library']) {
      const details = control<HTMLDetailsElement>(selector);
      assert(details.open, `${selector} should start expanded`);
      details.querySelector('summary')!.click();
      renderTimelinePanel(panel); // Before the old details' deferred native toggle event.
      assert(!control<HTMLDetailsElement>(selector).open, `${selector} lost its click state`);
      await nextTask();
    }
    state.currentTimeline = 'second'; renderTimelinePanel(panel); await nextTask();
    assert(control<HTMLDetailsElement>('.timeline-inspector').open && control<HTMLDetailsElement>('.timeline-library').open, 'another timeline borrowed the collapsed state');
    state.currentTimeline = 'first'; renderTimelinePanel(panel); await nextTask();
    assert(!control<HTMLDetailsElement>('.timeline-inspector').open && !control<HTMLDetailsElement>('.timeline-library').open, 'return lost the first timeline state');
    assert(state.timelines.every(item => !item.dirty) && timelineHistoryDepth().undo === 0, 'view changes edited source');
    panel.style.width = ''; clearTimelineViewStates();
  } },
  { name: 'timeline fields reject invalid payloads and retain unrelated timing', run: () => {
    fixture(); clearTimelineHistories(); clearTimelineViewStates();
    bindTimelineHooks({ onPreview: () => {} });
    const text = JSON.stringify({ version: 1, id: 't', durationMs: 1000, tracks: [
      { kind: 'portrait', target: 'lynn:uniform', cues: [{ action: 'show', expression: 'normal', position: 'center', atMs: 5, durationMs: 125, easing: 'linear' }] },
      { kind: 'particle', cues: [{ action: 'start', kind: 'sparkle', atMs: 25, durationMs: 405, easing: 'linear' }] },
    ] });
    const entry = { id: 't', file: 't.json', text, eol: '\n' as const, dirty: false, handle: null };
    state.timelines = [entry]; state.currentTimeline = 't'; state.currentTimelineCue = { trackIndex: 0, cueIndex: 0 };
    const panel = control<HTMLElement>('#main'); renderTimelinePanel(panel);
    input('[data-timeline-focus="track-0-target"]', '', 'change');
    assert(entry.text === text && !entry.dirty, 'invalid portrait target changed the draft');
    input('[data-timeline-focus="track-0-target"]', 'other', 'change');
    const changed = JSON.parse(entry.text);
    assert(changed.tracks[0].target === 'other', 'valid target not applied');
    assert(changed.tracks[1].cues[0].atMs === 25 && changed.tracks[0].cues[0].durationMs === 125, 'unrelated timing changed');
    state.currentTimelineCue = { trackIndex: 1, cueIndex: 0 }; renderTimelinePanel(panel);
    const preset = control<HTMLSelectElement>('[data-timeline-focus="inspector-kind"]');
    assert(preset.tagName === 'SELECT', 'particle preset is not a selection control');
    assert([...preset.options].some(option => option.value === 'fireflies' && option.textContent === '萤火虫'), 'Chinese option lost its runtime token');
    input('[data-timeline-focus="inspector-kind"]', 'fireflies', 'change');
    const selected = JSON.parse(entry.text);
    assert(selected.tracks[1].cues[0].kind === 'fireflies', 'Chinese option did not write the runtime kind');
    assert(selected.durationMs === 1000 && selected.tracks[1].cues[0].atMs === 25 && selected.tracks[1].cues[0].durationMs === 405
      && selected.tracks[1].cues[0].easing === 'linear' && selected.tracks[0].target === 'other', 'preset edit changed timing or adjacent payload');
    const before = entry.text;
    const depth = timelineHistoryDepth('t').undo;
    input('[data-timeline-focus="inspector-kind"]', '', 'change');
    assert(entry.text === before, 'invalid particle kind changed the draft');
    assert(timelineHistoryDepth('t').undo === depth, 'rejected fields created history');
  } },
  { name: 'only one real preview panel may own an iframe', run: () => {
    fixture(); const first = document.createElement('section'), second = document.createElement('section');
    document.body.append(first, second);
    renderPreviewPanel(first); renderPreviewPanel(second);
    assert(document.querySelectorAll('iframe.preview-frame').length === 1, 'more than one preview iframe');
    disposePreviewPanel(); assert(document.querySelectorAll('iframe.preview-frame').length === 0, 'preview not disposed');
  } },
  { name: 'late detached preview cannot evict the active preview', run: () => {
    fixture(); const current = document.createElement('section'); document.body.append(current); renderPreviewPanel(current);
    const frame = current.querySelector('iframe'); renderPreviewPanel(document.createElement('section'));
    assert(current.querySelector('iframe') === frame, 'detached request evicted runtime'); disposePreviewPanel();
  } },
];
