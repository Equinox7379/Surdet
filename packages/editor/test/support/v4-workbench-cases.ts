import { state, type SceneEntry } from '../../src/state.js';
import { histories, bindHistoryHooks, undo, redo } from '../../src/history.js';
import { renderEditor } from '../../src/panels/editor.js';
import { disposePreviewPanel, renderPreviewPanel } from '../../src/panels/preview-panel.js';
import { buildAuthoringWorkbench } from '../../src/shell/authoring-workbench.js';
import { disposeScriptV4, revealScriptV4Line } from '../../src/v4/script-workbench.js';
import { enhanceConfigTables } from '../../src/v4/surfaces.js';

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
  const loads: unknown[] = [];
  frame.contentWindow.addEventListener('message', (event) => loads.push(event.data));
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'surdet-preview-ready' },
    source: frame.contentWindow,
  }));
  await tick();
  return { frame, loads };
}

async function waitForPublishedPreviewLoad(result: { loads: unknown[] }): Promise<void> {
  for (let attempt = 0; attempt < 10 && result.loads.length === 0; attempt++) await nextTask();
  assert(result.loads.some((value) => (value as { type?: string } | null)?.type === 'surdet-preview-load'), 'preview load was not published');
}

function fixture(sourceText = SOURCE): SceneEntry {
  disposeScriptV4(); disposePreviewPanel();
  document.body.innerHTML = '<main id="main"></main><div id="status"></div>';
  state.scenes.clear(); histories.clear();
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
export const v4WorkbenchCases: BrowserCase[] = [
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
    input('#script-v4-inspector [aria-label="关联语音"]', 'voice_line', 'change'); await tick();
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
    assert(delayed.requested(), 'font read did not become asynchronous');
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
    assert(delayed.requested(), 'font read did not become asynchronous');
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
    assert(delayed.requested(), 'font read did not become asynchronous');
    disposePreviewPanel();
    delayed.release(); await tick(); await nextTask();
    assert(state.previewTrace[0] === observed && state.selectedTraceStep === 0, 'detached preview erased the prior observation');
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
