import { state, h, setStatus, type SceneEntry } from '../state.js';
import { setCurrentText } from '../history.js';
import { parseScript, splitInstr, type LineModel } from '../model.js';
import { decodeInstructionArgument, parseProjectConfigDocument } from '@surdet/authoring';
import { disposePreviewPanel, renderPreviewPanel, refreshPreviewSourceState } from '../panels/preview-panel.js';
import { allowedToEdit, button, disclosure, field, ImageScope, navigateMode } from './ui.js';
import { renderTimelineSummary } from './timeline-summary.js';
import { toggleAuthoringOutline } from '../shell/authoring-workbench.js';
import { editSceneLabel } from '../label-editing.js';
import {
  applySourceTextareaEdit, deleteStep, duplicateStep, insertStep, instructionPosition,
  moveStep, moveStepBefore, projectEditLayout, quoteAssetArgument, setInstructionArgument,
  setInstructionPosition, simpleChoice, sourceEol, splitDialogue, stepAt, writeSimpleChoice,
  type ScriptView, type SourceEdit,
} from './script-source.js';

interface ViewState { view: ScriptView; line: number; scroll: number; dock: 'layout' | 'runtime' }
const viewStates = new WeakMap<SceneEntry, ViewState>();
let active: ScriptWorkbench | null = null;
const ACTION_NAMES: Record<string, string> = {
  scene: '场景', bg: '背景', show: '人物出场', hide: '人物退场', wait: '等待',
  bgm: '背景音乐', ambience: '环境音', se: '音效', voice: '语音', video: '视频',
  set: '变量', mod: '变量增量', choice: '分支选择', goto: '前往段落', jump: '前往场景',
  call: '调用场景', timeline: '演出', if: '条件', elif: '其他条件', else: '否则',
  endif: '条件结束', end: '结束', fadein: '淡入', fadeout: '淡出', mov: '人物移动',
};

/** Called before the legacy renderer replaces its rows. Return borrowed DOM nodes first. */
export function prepareScriptV4Render(): void { active?.returnFields(); }
export function disposeScriptV4(): void { active?.dispose(); active = null; }

/** Reveal a source location through the currently mounted V4 view. */
export function revealScriptV4Line(index: number): boolean { return active?.revealLine(index) ?? false; }

/** Decorates existing B01-bound rows; it does not own a second document or undo stack. */
export function installScriptV4(editor: HTMLElement, rerender: () => void): void {
  const root = editor.closest<HTMLElement>('.authoring-workbench');
  const scene = state.current === null ? undefined : state.scenes.get(state.current);
  if (!root?.querySelector('#script-v4-inspector') || !scene || state.current === null) return;
  if (!active || active.root !== root || active.scene !== scene) {
    disposeScriptV4();
    active = new ScriptWorkbench(root, editor, scene, state.current, rerender);
  }
  active.decorate();
}

export class ScriptWorkbench {
  readonly view: ViewState;
  private readonly abort = new AbortController();
  private readonly inspector: HTMLElement;
  private readonly picture: HTMLElement;
  private readonly runtime: HTMLElement;
  private readonly sourceStatus: HTMLElement;
  private stageImages = new ImageScope();
  private inspectorImages = new ImageScope();
  private rowImages = new ImageScope();
  private borrowed: { block: HTMLElement; fields: HTMLElement } | null = null;
  private inputScheduled = false;
  private knownSource = '';
  private lastStageIdentity = '';
  private pointerCleanup: (() => void) | null = null;
  private closePicture: (() => void) | null = null;

  constructor(
    readonly root: HTMLElement,
    private readonly editor: HTMLElement,
    readonly scene: SceneEntry,
    private readonly sceneKey: string,
    private readonly rerender: () => void,
  ) {
    this.view = viewStates.get(scene) ?? { view: 'arrange', line: Math.max(0, parseScript(scene.text).findIndex((line) => line.kind === 'text')), scroll: 0, dock: 'layout' };
    viewStates.set(scene, this.view);
    this.inspector = root.querySelector('#script-v4-inspector')!;
    this.picture = root.querySelector('#script-v4-edit-layout')!;
    this.runtime = root.querySelector('#script-v4-runtime')!;
    this.sourceStatus = root.querySelector('#script-v4-source-status')!;
    this.knownSource = scene.text;
    this.installToolbar();
    root.addEventListener('input', () => this.afterInput(), { signal: this.abort.signal });
    root.addEventListener('change', () => this.afterInput(), { signal: this.abort.signal });
    editor.addEventListener('focusin', (event) => {
      const target = event.target as HTMLElement;
      const block = target.closest<HTMLElement>('.block[data-line]');
      if (block && !target.closest('.technical-details') && Number(block.dataset.line) !== this.view.line) {
        this.select(Number(block.dataset.line), false);
      }
    }, { signal: this.abort.signal });
    editor.addEventListener('scroll', () => {
      this.view.scroll = editor.scrollTop;
      for (const menu of editor.querySelectorAll<HTMLDetailsElement>('.v4-row-menu[open]')) menu.open = false;
    }, { signal: this.abort.signal });
    this.installDock();
    this.installDialogueReflow();
    root.addEventListener('pointerdown', (event) => {
      for (const menu of root.querySelectorAll<HTMLDetailsElement>('.v4-row-menu[open]')) {
        if (!menu.contains(event.target as Node)) menu.open = false;
      }
    }, { signal: this.abort.signal });
  }

  private current(): boolean {
    return this.root.isConnected && state.current === this.sceneKey && state.scenes.get(this.sceneKey) === this.scene;
  }
  private editable(): boolean { return this.current() && allowedToEdit(this.root); }
  private lines(): LineModel[] { return parseScript(this.scene.text); }
  private block(index: number): HTMLElement | null { return this.editor.querySelector(`.block[data-line="${index}"]`); }

  returnFields(): void {
    const borrowed = this.borrowed;
    if (!borrowed) return;
    const technical = borrowed.block.querySelector('.technical-details');
    if (borrowed.block.isConnected) borrowed.block.insertBefore(borrowed.fields, technical);
    else borrowed.fields.remove();
    this.borrowed = null;
  }
  dispose(): void {
    this.closePicture?.();
    this.returnFields();
    this.abort.abort();
    this.stageImages.dispose(); this.inspectorImages.dispose(); this.rowImages.dispose();
    this.pointerCleanup?.();
    if (this.runtime.querySelector('iframe.preview-frame')) {
      disposePreviewPanel();
      this.runtime.replaceChildren();
    }
  }

  private installToolbar(): void {
    const host = this.root.querySelector<HTMLElement>('#script-v4-toolbar')!;
    const views = h('div', 'v4-view-switch');
    views.setAttribute('aria-label', '剧本编辑方式');
    for (const [value, label] of [['arrange', '编排'], ['manuscript', '稿件'], ['source', '源码']] as const) {
      const control = button(label, () => {
        if (!this.current()) return;
        this.view.view = value;
        this.returnFields();
        this.rerender();
      });
      control.dataset.scriptView = value;
      views.append(control);
    }
    const outline = button('目录', () => {
      outline.setAttribute('aria-expanded', String(toggleAuthoringOutline(this.root)));
    }, 'v4-button v4-outline-toggle');
    outline.title = '展开或收起场景与素材目录';
    outline.setAttribute('aria-label', '场景与素材目录');
    outline.setAttribute('aria-controls', 'sidebar');
    outline.setAttribute('aria-expanded', String(this.root.dataset.outlineCollapsed !== 'true'));
    host.replaceChildren(outline, views,
      button('添加剧情', () => this.openInsert(), 'v4-button v4-primary'),
      button('查看素材', () => navigateMode('assets')),
      button('导出 .gal', () => this.download()));
  }

  private installDock(): void {
    const tools = this.root.querySelector<HTMLElement>('#script-v4-stage-tools')!;
    const show = (mode: 'layout' | 'runtime'): void => {
      if (!this.current()) return;
      if (mode === 'runtime' && !this.editable()) return;
      this.view.dock = mode;
      this.picture.hidden = mode !== 'layout';
      this.runtime.hidden = mode !== 'runtime';
      for (const control of tools.querySelectorAll<HTMLElement>('[data-stage-mode]')) {
        control.setAttribute('aria-pressed', String(control.dataset.stageMode === mode));
      }
      const enlarge = tools.querySelector<HTMLButtonElement>('.v4-enlarge-picture');
      if (enlarge) enlarge.disabled = mode !== 'layout';
      if (mode === 'layout') {
        disposePreviewPanel();
        this.runtime.replaceChildren();
        this.drawStage();
      } else {
        // Deliberate launch, never selecting an arbitrary source row and claiming a replay.
        state.previewTimelineId = null;
        state.previewChoices = null;
        renderPreviewPanel(this.runtime, { embedded: true, onSourceStateChange: () => this.updateStatus() });
      }
      this.updateStatus();
    };
    const edit = button('编辑排布', () => show('layout'));
    edit.dataset.stageMode = 'layout';
    const play = button('运行预览', () => show('runtime'));
    play.dataset.stageMode = 'runtime';
    const enlarge = button('放大画面', () => this.enlargePicture(enlarge), 'v4-button v4-enlarge-picture');
    tools.replaceChildren(edit, play, enlarge);
    // Never auto-start audio on returning from another view.
    this.view.dock = 'layout';
    edit.setAttribute('aria-pressed', 'true');
    play.setAttribute('aria-pressed', 'false');
    this.runtime.hidden = true;
    this.picture.hidden = false;
  }

  private enlargePicture(trigger: HTMLButtonElement): void {
    if (!this.current() || this.view.dock !== 'layout' || this.closePicture) return;
    const placeholder = h('span'); placeholder.hidden = true;
    this.picture.before(placeholder);
    const dialog = h('dialog', 'v4-picture-dialog');
    dialog.setAttribute('aria-label', '放大编辑画面');
    const header = h('header');
    const close = (): void => {
      if (this.closePicture !== close) return;
      this.closePicture = null;
      this.picture.inert = false;
      placeholder.replaceWith(this.picture);
      dialog.close(); dialog.remove();
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    };
    this.closePicture = close;
    header.append(h('strong', undefined, '编辑画面'), h('span', 'v4-muted', '静态排布 · 未运行'), button('关闭', close));
    dialog.append(header, this.picture);
    this.picture.inert = true;
    this.root.append(dialog);
    dialog.addEventListener('close', close, { once: true });
    dialog.showModal();
  }

  decorate(): void {
    if (!this.current()) return;
    this.returnFields();
    this.rowImages.dispose(); this.rowImages = new ImageScope();
    const lines = this.lines();
    this.knownSource = this.scene.text;
    this.view.line = Math.min(Math.max(0, this.view.line), lines.length - 1);
    this.root.dataset.scriptView = this.view.view;
    this.inspector.toggleAttribute('inert', this.view.view === 'source');
    for (const control of this.root.querySelectorAll<HTMLElement>('[data-script-view]')) {
      if (control === this.root) continue;
      control.setAttribute('aria-pressed', String(control.dataset.scriptView === this.view.view));
    }
    this.root.querySelector('#v4-speaker-choices')?.remove();
    const speakers = h('datalist'); speakers.id = 'v4-speaker-choices';
    try {
      const config = parseProjectConfigDocument(state.gameConfigText) as { characters?: Record<string, { name?: unknown }> };
      for (const character of Object.values(config.characters ?? {})) {
        if (typeof character?.name === 'string') speakers.append(new Option(character.name, character.name));
      }
    } catch { /* Invalid config remains visible to the shared validator, not replaced with invented roles. */ }
    this.root.append(speakers);
    this.editor.querySelector('.v4-source-editor')?.remove();
    if (this.view.view === 'source') this.createSourceEditor();
    for (const block of this.editor.querySelectorAll<HTMLElement>('.block')) this.decorateBlock(block, lines[Number(block.dataset.line)]);
    this.select(this.view.line, false);
    this.editor.scrollTop = this.view.scroll;
    this.drawStage();
    refreshPreviewSourceState();
  }

  private decorateBlock(block: HTMLElement, line: LineModel | undefined): void {
    if (block.dataset.v4Bound === 'true') return;
    block.dataset.v4Bound = 'true';
    const index = Number(block.dataset.line);
    if (!line) return;
    const action = button('', () => this.select(index, true), 'v4-step-summary');
    action.dataset.stepSummary = String(index);
    block.insertBefore(action, block.querySelector('.fields'));
    const ops = block.querySelector<HTMLElement>('.ops');
    if (ops) {
      const menu = h('details', 'v4-row-menu');
      const summary = h('summary', '', '···');
      summary.setAttribute('role', 'button');
      summary.setAttribute('aria-expanded', 'false');
      summary.setAttribute('aria-label', `剧情步骤操作，第 ${index + 1} 行`);
      summary.title = '移动、复制或删除这个步骤';
      const actions = h('div', 'v4-row-menu-actions');
      const definitions: Array<[string, string, () => void]> = [
        ['上移步骤', '上移剧情步骤', () => { this.structural((text) => moveStep(text, index, -1)); }],
        ['下移步骤', '下移剧情步骤', () => { this.structural((text) => moveStep(text, index, 1)); }],
        ['在后面添加', '在步骤后添加剧情', () => { this.select(index, false); this.openInsert(); }],
        ['复制步骤', '复制剧情步骤', () => { this.structural((text) => duplicateStep(text, index)); }],
        ['删除步骤', '删除剧情步骤', () => this.remove(index)],
      ];
      for (const [label, accessible, action] of definitions) {
        const item = button(label, () => { menu.open = false; action(); }, 'v4-row-op');
        item.setAttribute('aria-label', `${accessible}，第 ${index + 1} 行`);
        actions.append(item);
      }
      menu.append(summary, actions);
      menu.addEventListener('toggle', () => {
        summary.setAttribute('aria-expanded', String(menu.open));
        if (!menu.open) return;
        for (const other of this.editor.querySelectorAll<HTMLDetailsElement>('.v4-row-menu[open]')) {
          if (other !== menu) other.open = false;
        }
        const bounds = summary.getBoundingClientRect();
        actions.style.left = `${Math.max(8, Math.min(bounds.right - actions.offsetWidth, window.innerWidth - actions.offsetWidth - 8))}px`;
        actions.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - actions.offsetHeight - 8))}px`;
      });
      menu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && menu.open) { event.preventDefault(); event.stopPropagation(); menu.open = false; summary.focus(); }
      });
      ops.replaceChildren(menu);
    }
    const handle = button('⋮⋮', () => {}, 'v4-drag-handle');
    handle.setAttribute('aria-label', `拖动第 ${index + 1} 行所在步骤；也可使用上移下移`);
    handle.onpointerdown = (event) => this.beginDrag(event, index, handle);
    block.prepend(handle);
    this.decorateDialogue(block);
    this.updateSummary(block, line);
  }

  private decorateDialogue(block: HTMLElement): void {
    if (block.classList.contains('block-blank')) {
      const blank = block.querySelector<HTMLTextAreaElement>('.fields textarea.wide');
      if (!blank || blank.dataset.v4Proxy === 'true') return;
      blank.dataset.v4Proxy = 'true'; blank.classList.add('v4-dialogue-input');
      block.classList.add('v4-empty-dialogue');
      blank.placeholder = '输入旁白…'; blank.setAttribute('aria-label', '台词内容');
      const originalInput = blank.oninput;
      blank.oninput = (event) => { originalInput?.call(blank, event); this.fitTextarea(blank); };
      this.bindDialogueEnter(block, blank);
      this.fitTextarea(blank);
      return;
    }
    if (!block.classList.contains('block-text')) return;
    const original = block.querySelector<HTMLInputElement>('.fields input.wide');
    if (!original || original.dataset.v4Proxy === 'true') return;
    original.dataset.v4Proxy = 'true';
    block.querySelector<HTMLInputElement>('.fields input:not(.wide)')?.setAttribute('list', 'v4-speaker-choices');
    original.hidden = true;
    original.setAttribute('aria-hidden', 'true');
    original.tabIndex = -1;
    const textarea = h('textarea', 'v4-dialogue-input');
    textarea.rows = 1; textarea.value = original.value;
    textarea.setAttribute('aria-label', '台词内容');
    textarea.oninput = () => {
      if (!original.isConnected || !this.editable()) return;
      if (/[\r\n]/.test(textarea.value)) {
        const index = Number(block.dataset.line), current = this.lines()[index];
        if (current?.kind !== 'text') return;
        const raw = `${current.speaker ? current.speaker + current.sep : ''}${textarea.value}`;
        this.view.view = 'source';
        this.structural((text) => {
          const rows = parseScript(text);
          const offset = rows.slice(0, index).reduce((sum, row) => sum + row.raw.length + row.eol.length, 0);
          const eol = current.eol || sourceEol(text);
          return { text: text.slice(0, offset) + raw.replace(/\r\n|\n|\r/g, eol) + text.slice(offset + current.raw.length), selectedLine: index };
        });
        queueMicrotask(() => this.editor.querySelector<HTMLElement>('.v4-source-editor')?.focus());
        return;
      }
      original.value = textarea.value;
      original.dispatchEvent(new Event('input', { bubbles: true }));
      this.fitTextarea(textarea);
    };
    this.bindDialogueEnter(block, textarea);
    original.before(textarea);
    this.fitTextarea(textarea);
  }

  private bindDialogueEnter(block: HTMLElement, textarea: HTMLTextAreaElement): void {
    // A physical newline is another DSL row, not a hidden multiline dialogue token.
    textarea.onkeydown = (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        const index = Number(block.dataset.line);
        const current = this.lines()[index];
        if (current?.kind !== 'text' || current.value !== textarea.value) return;
        this.structural((text) => splitDialogue(text, index, textarea.selectionStart, textarea.selectionEnd), true);
      }
    };
  }
  /** Panel/window resizing rewraps text without changing the scene or its history. */
  private installDialogueReflow(): void {
    let width = -1;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? 0;
      if (nextWidth <= 0 || nextWidth === width) return;
      width = nextWidth;
      for (const menu of this.editor.querySelectorAll<HTMLDetailsElement>('.v4-row-menu[open]')) menu.open = false;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!this.current()) return;
        for (const textarea of this.editor.querySelectorAll<HTMLTextAreaElement>('.v4-dialogue-input')) {
          this.fitTextarea(textarea);
        }
      });
    });
    observer.observe(this.editor);
    this.abort.signal.addEventListener('abort', () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    }, { once: true });
  }

  private fitTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(34, textarea.scrollHeight)}px`;
  }

  private updateSummary(block: HTMLElement, line: LineModel | undefined): void {
    const summary = block.querySelector<HTMLElement>('[data-step-summary]');
    if (!line || !summary) return;
    const signature = `${line.kind}\0${line.raw}`;
    if (summary.dataset.sourceSignature === signature) return;
    summary.dataset.sourceSignature = signature;
    block.dataset.stepKind = line.kind;
    if (line.kind === 'instr') {
      const { name, args } = splitInstr(line.raw);
      const source = name === 'bg' ? state.dirAssets.find((asset) => asset.kind === 'bg' && asset.key === decodeInstructionArgument(args[0] ?? ''))
        : name === 'show' ? state.dirAssets.find((asset) => asset.kind === 'portrait' && asset.key === decodeInstructionArgument(args[0] ?? '') && (asset.expr ?? 'normal') === decodeInstructionArgument(args[1] ?? 'normal')) : undefined;
      const previous = summary.querySelector<HTMLElement>('.v4-step-thumb');
      const imageKey = source?.sourcePath ?? '';
      let thumb = previous;
      if (previous?.dataset.sourcePath !== imageKey) {
        if (previous) this.rowImages.cancel(previous);
        thumb = source ? h('span', 'v4-step-thumb') : null;
        if (thumb) { thumb.dataset.sourcePath = imageKey; queueMicrotask(() => { if (thumb) void this.rowImages.image(thumb, source, '', name === 'bg' ? 'cover' : 'contain'); }); }
      }
      summary.replaceChildren(...(thumb ? [thumb] : []), h('small', 'v4-step-type', ACTION_NAMES[name] ?? `@${name}`), h('strong', undefined, args.map(decodeInstructionArgument).join('  ') || (name === 'choice' ? '选择剧情走向' : '无位置参数')));
    } else if (line.kind === 'choice-option') {
      const option = simpleChoice(line.raw);
      summary.replaceChildren(h('small', 'v4-step-type', '选项'), h('strong', undefined, option?.text || line.raw.trim()), h('small', 'v4-source-hint', option ? `→ ${option.target}` : '完整行内动作'));
    } else if (line.kind === 'label') {
      summary.replaceChildren(h('small', 'v4-step-type', '段落'), h('strong', undefined, line.name));
    } else if (line.kind === 'blank') summary.replaceChildren(h('small', undefined, '空行'));
    else if (line.kind === 'comment') summary.replaceChildren(h('small', undefined, line.raw.trim()));
    else summary.replaceChildren();
  }

  private afterInput(): void {
    if (this.inputScheduled) return;
    this.inputScheduled = true;
    queueMicrotask(() => {
      this.inputScheduled = false;
      if (!this.current()) return;
      const lines = this.lines();
      for (const block of this.editor.querySelectorAll<HTMLElement>('.block')) {
        this.decorateDialogue(block);
        this.updateSummary(block, lines[Number(block.dataset.line)]);
      }
      this.knownSource = this.scene.text;
      // Do not rebuild focused property fields on each keystroke.
      refreshPreviewSourceState();
      this.drawStage(); this.updateStatus();
    });
  }

  private select(index: number, focus: boolean): void {
    if (!this.current() || !this.lines()[index]) return;
    this.view.line = index;
    for (const block of this.editor.querySelectorAll<HTMLElement>('.block')) block.classList.toggle('v4-current', Number(block.dataset.line) === index);
    const block = this.block(index);
    this.renderInspector(); this.drawStage(); this.updateStatus();
    if (focus && block) {
      block.scrollIntoView({ block: 'nearest' });
      block.focus({ preventScroll: true });
      // Let the existing selection handler publish the true Authoring objectRef.
      block.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  }

  /** Main's search/issues/trace navigation must not focus hidden legacy rows in source view. */
  revealLine(index: number): boolean {
    const rows = this.lines();
    const line = rows[index];
    if (!this.current() || !Number.isInteger(index) || !line) return false;
    this.root.dataset.mobilePanel = 'editor';
    this.root.dataset.auxiliaryView = 'outline';
    for (const control of this.root.querySelectorAll<HTMLElement>('[data-workbench-panel]')) {
      control.setAttribute('aria-pressed', String(control.dataset.workbenchPanel === 'editor'));
    }
    this.select(index, false);
    if (this.view.view === 'source') {
      const textarea = this.editor.querySelector<HTMLTextAreaElement>('.v4-source-editor');
      if (!textarea) return false;
      // Native textarea offsets use LF and UTF-16, even for CRLF/CR documents.
      const start = rows.slice(0, index).reduce((offset, row) => offset + row.raw.length + (row.eol ? 1 : 0), 0);
      textarea.scrollIntoView({ block: 'start' });
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(start, start + line.raw.length);
      const style = getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(style.lineHeight) || (Number.parseFloat(style.fontSize) || 13) * 1.9;
      const padding = Number.parseFloat(style.paddingTop) || 0;
      const visibleHeight = Math.min(textarea.clientHeight, this.editor.clientHeight);
      textarea.scrollTop = Math.max(0, padding + index * lineHeight - visibleHeight / 3);
      return true;
    }
    const block = this.block(index);
    if (!block) return false;
    block.scrollIntoView({ block: 'center' });
    block.focus({ preventScroll: true });
    return true;
  }

  private writeRaw(raw: string, original: string, index = this.view.line): boolean {
    if (!this.editable()) return false;
    const block = this.block(index), current = this.lines()[index];
    const input = block?.querySelector<HTMLInputElement>('.raw input');
    if (!block || !input || current?.raw !== original) {
      setStatus('当前步骤已变化，未覆盖新内容，请重新选择步骤', false, 5000);
      return false;
    }
    input.value = raw;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const accepted = this.lines()[index]?.raw === raw;
    if (!accepted) input.value = this.lines()[index]?.raw ?? original;
    return accepted;
  }

  private renderInspector(): void {
    this.returnFields();
    this.inspectorImages.dispose(); this.inspectorImages = new ImageScope();
    const index = this.view.line, line = this.lines()[index], block = this.block(index);
    this.inspector.replaceChildren();
    if (!line || !block) return;
    this.inspector.append(h('div', 'v4-inspector-title', line.kind === 'text' ? '当前对白' : line.kind === 'instr' ? ACTION_NAMES[line.name] ?? `@${line.name}` : line.kind === 'choice-option' ? '分支选项' : '当前步骤'));
    const location = h('p', 'v4-source-hint', `${this.scene.file} · 第 ${index + 1} 行`);
    this.inspector.append(location);
    const readInstruction = (): Extract<LineModel, { kind: 'instr' }> | null => {
      const current = this.lines()[index];
      if (!this.current() || line.kind !== 'instr' || current?.kind !== 'instr'
        || current.name !== line.name || current.raw !== line.raw) {
        setStatus('步骤已在其他入口修改，请重新选择后调整属性', false, 5000);
        return null;
      }
      return current;
    };
    const editParameter = (parameter: number, value: string): void => {
      const current = readInstruction();
      if (!current) return;
      if (this.writeRaw(setInstructionArgument(current.raw, parameter, value), current.raw, index)) {
        this.renderInspector(); this.drawStage();
      }
    };
    if (line.kind === 'text') {
      this.inspector.append(h('p', 'v4-muted', '在正文中编辑说话人和台词。'));
      const source = this.scene.text;
      const lines = this.lines();
      const revealOrigin = (sourceLine: number): void => {
        if (!this.current() || this.scene.text !== source) {
          setStatus('正文已经变化，请重新选择对白后定位来源', false, 5000); return;
        }
        this.select(sourceLine, true);
      };
      const projection = projectEditLayout(lines, index);
      if (!projection.reason) {
        const origins = h('div', 'studio-presentation-origins');
        origins.append(h('h3', undefined, '沿用的画面设置'));
        if (projection.background) {
          const background = projection.background;
          origins.append(button(`背景 · ${background.key}`, () => revealOrigin(background.line), 'studio-origin-link'));
        }
        for (const actor of projection.actors) origins.append(button(`${actor.target} · ${actor.expression}`, () => revealOrigin(actor.line), 'studio-origin-link'));
        if (origins.childElementCount > 1) this.inspector.append(origins);
      }
      // These are source calls in this section, not inferred runtime effects.
      for (let previous = index - 1; previous >= 0; previous--) {
        const row = lines[previous]!;
        if (row.kind === 'label' || row.kind === 'choice-option') break;
        if (row.kind !== 'instr') continue;
        if (['scene', 'choice', 'if', 'elif', 'else', 'endif', 'goto', 'jump', 'call', 'return', 'end'].includes(row.name)) break;
        if (row.name === 'timeline') {
          const id = decodeInstructionArgument(splitInstr(row.raw).args[0] ?? '');
          const sourceLine = previous;
          this.inspector.append(h('h3', 'studio-inspector-subtitle', '本段调用的时间轴'), renderTimelineSummary(id), button('定位时间轴调用指令', () => revealOrigin(sourceLine), 'studio-origin-link'));
          break;
        }
      }
      const voices = state.dirAssets.filter((asset) => asset.kind === 'voice' && asset.handle !== null);
      const select = h('select');
      select.append(new Option('选择语音文件', ''));
      voices.forEach((asset) => select.append(new Option(asset.key, asset.key)));
      select.disabled = voices.length === 0;
      const boundSource = this.scene.text;
      select.onchange = () => {
        if (!select.value || !this.editable()) return;
        if (this.scene.text !== boundSource) { setStatus('对白已变化，请重新选择后关联语音', false, 5000); return; }
        const previous = this.lines()[index - 1];
        if (previous?.kind === 'instr' && previous.name === 'voice') {
          this.writeRaw(setInstructionArgument(previous.raw, 0, select.value), previous.raw, index - 1);
        } else {
          this.structural((text) => {
            const rows = parseScript(text), at = rows[index]!;
            const eol = at.eol || sourceEol(text);
            const start = rows.slice(0, index).reduce((sum, row) => sum + row.raw.length + row.eol.length, 0);
            return { text: text.slice(0, start) + `@voice ${quoteAssetArgument(select.value)}${eol}` + text.slice(start), selectedLine: index + 1 };
          });
        }
      };
      const voiceDetails = h('details', 'v4-disclosure');
      voiceDetails.append(h('summary', undefined, '关联语音'), field('语音文件', select));
      if (!voices.length) voiceDetails.append(h('p', 'v4-muted', '当前项目没有可关联的语音文件。'));
      this.inspector.append(voiceDetails);
    } else if (line.kind === 'instr') {
      const { args } = splitInstr(line.raw);
      if (line.name === 'show') {
        const target = decodeInstructionArgument(args[0] ?? '');
        const portraits = state.dirAssets.filter((asset) => asset.kind === 'portrait' && asset.handle !== null);
        const targets = [...new Set(portraits.map((asset) => asset.key))];
        const select = h('select');
        if (!targets.includes(target)) select.append(new Option(target || '尚未指定', target));
        targets.forEach((key) => select.append(new Option(key, key)));
        select.value = target;
        select.onchange = () => editParameter(0, select.value);
        this.inspector.append(field('人物与服装', select));
        const expression = decodeInstructionArgument(args[1] ?? 'normal');
        const grid = h('div', 'v4-pick-grid');
        for (const asset of portraits.filter((item) => item.key === target)) {
          const control = button('', () => editParameter(1, asset.expr ?? 'normal'), 'v4-image-pick');
          control.setAttribute('aria-label', `选择表情 ${asset.expr ?? 'normal'}`);
          control.setAttribute('aria-pressed', String((asset.expr ?? 'normal') === expression));
          const thumb = h('span', 'v4-pick-image');
          control.append(thumb, h('span', undefined, asset.expr ?? 'normal'));
          grid.append(control);
          queueMicrotask(() => { void this.inspectorImages.image(thumb, asset, '', 'contain'); });
        }
        this.inspector.append(grid);
        const positions = h('div', 'v4-segmented');
        const position = instructionPosition(line.raw);
        for (const [key, label] of [['left', '左侧'], ['center', '中央'], ['right', '右侧']] as const) {
          const control = button(label, () => {
            const current = readInstruction();
            if (current && this.writeRaw(setInstructionPosition(current.raw, key), current.raw, index)) {
              this.renderInspector(); this.drawStage();
            }
          });
          control.setAttribute('aria-pressed', String(position === key));
          control.disabled = position === 'ambiguous';
          positions.append(control);
        }
        this.inspector.append(field('出场位置', positions));
        if (position === 'default' || position === 'ambiguous') this.inspector.append(h('p', 'v4-muted', position === 'default' ? '未显式设置位置；编辑排布使用居中示意。' : '位置修饰有歧义，请在原始行中确认。'));
      } else if (line.name === 'bg') {
        const grid = h('div', 'v4-background-picks');
        for (const asset of state.dirAssets.filter((item) => item.kind === 'bg' && item.handle !== null)) {
          const control = button('', () => editParameter(0, asset.key), 'v4-image-pick');
          control.setAttribute('aria-label', `选择背景 ${asset.key}`);
          control.setAttribute('aria-pressed', String(decodeInstructionArgument(args[0] ?? '') === asset.key));
          const thumb = h('span', 'v4-pick-image');
          control.append(thumb, h('span', undefined, asset.key)); grid.append(control);
          queueMicrotask(() => { void this.inspectorImages.image(thumb, asset, '', 'cover'); });
        }
        this.inspector.append(grid);
        if (!grid.childElementCount) this.inspector.append(h('p', 'v4-muted', '项目中没有可用背景，请先导入素材。'));
      } else if (line.name === 'timeline') {
        const id = decodeInstructionArgument(args[0] ?? '');
        this.inspector.append(renderTimelineSummary(id));
      } else if (line.name === 'wait') {
        const quick = h('div', 'v4-segmented');
        for (const milliseconds of [200, 500, 1000, 2000]) quick.append(button(`${milliseconds} ms`, () => editParameter(0, String(milliseconds))));
        this.inspector.append(quick);
      } else if (line.name === 'choice') {
        const range = stepAt(this.lines(), index);
        this.inspector.append(h('p', 'v4-muted', `共 ${range.end - range.start} 个选项。选择具体选项可编辑文字、条件和目标；步骤排列会携带整组选项。`));
        this.inspector.append(button('添加选项', () => {
          if (!readInstruction()) return;
          const labels = this.lines().filter((item): item is Extract<LineModel, { kind: 'label' }> => item.kind === 'label');
          const target = labels[0]?.name;
          if (!target) { setStatus('先添加一个段落标记，或在源码中编写完整分支', false, 5000); return; }
          this.structural((text) => insertStep(text, index, [`  新选项 -> @goto ${target}`]));
        }));
      }
    } else if (line.kind === 'choice-option') {
      const draft = simpleChoice(line.raw);
      if (draft) {
        let expected = line.raw;
        for (const [key, label] of [['text', '选项文字'], ['condition', '显示条件（可空）'], ['target', '目标段落']] as const) {
          const input = h('input'); input.value = draft[key];
          input.oninput = () => {
            if (!input.isConnected) return;
            const next = { ...draft, [key]: input.value };
            try {
              const raw = writeSimpleChoice(next);
              if (this.writeRaw(raw, expected, index)) { Object.assign(draft, next); expected = raw; }
            } catch (error) { setStatus(error instanceof Error ? error.message : String(error), false, 5000); }
          };
          this.inspector.append(field(label, input));
        }
      } else this.inspector.append(h('p', 'v4-muted', '这条选项包含完整语法；显示条件、选中后效果和目标均保留在原始行中，可直接编辑并撤销。'));
    }
    if (line.kind === 'blank') this.inspector.append(h('p', 'v4-muted', '在正文中输入旁白。'));
    if (line.kind !== 'text' && line.kind !== 'blank') {
      const fields = block.querySelector<HTMLElement>('.fields');
      if (fields) {
        this.borrowed = { block, fields };
        const advanced = disclosure('全部参数与高级语法', fields);
        const rawOnlyChoice = line.kind === 'choice-option' && simpleChoice(line.raw) === null;
        advanced.open = rawOnlyChoice || line.kind === 'instr' && !['bg', 'show', 'wait', 'timeline', 'choice'].includes(line.name);
        if (line.kind === 'comment' || line.kind === 'label') advanced.open = true;
        this.inspector.append(advanced);
      }
    }
    this.inspector.append(button('定位原始行', () => {
      const details = block.querySelector<HTMLDetailsElement>('.technical-details');
      if (details) { details.open = true; block.scrollIntoView({ block: 'center' }); block.querySelector<HTMLInputElement>('.raw input')?.focus(); }
    }));
  }

  private drawStage(): void {
    if (!this.current() || this.view.dock !== 'layout') return;
    const projection = projectEditLayout(this.lines(), this.view.line);
    const identity = JSON.stringify(projection);
    if (identity === this.lastStageIdentity && this.picture.childElementCount) return;
    this.lastStageIdentity = identity;
    this.stageImages.dispose(); this.stageImages = new ImageScope();
    this.picture.replaceChildren();
    this.picture.dataset.editLayout = 'not-run';
    const stage = h('div', 'v4-edit-stage');
    this.picture.append(stage);
    stage.append(h('small', 'v4-stage-label', '编辑排布 · 未运行'));
    if (projection.reason) {
      stage.append(h('p', 'v4-stage-empty', projection.reason));
      return;
    }
    if (projection.background) {
      const ref = projection.background;
      const image = button('', () => this.select(ref.line, true), 'v4-stage-background');
      image.setAttribute('aria-label', `定位背景 ${ref.key}`);
      stage.append(image);
      void this.stageImages.image(image, state.dirAssets.find((asset) => asset.kind === 'bg' && asset.key === ref.key), '', 'cover');
    }
    for (const actor of projection.actors) {
      const control = button('', () => this.select(actor.line, true), `v4-stage-actor position-${actor.position}`);
      control.setAttribute('aria-label', `定位人物 ${actor.target} ${actor.expression}`);
      stage.append(control);
      void this.stageImages.image(control, state.dirAssets.find((asset) => asset.kind === 'portrait' && asset.key === actor.target && (asset.expr ?? 'normal') === actor.expression), actor.target);
    }
    if (projection.dialogue) {
      const text = h('div', 'v4-stage-dialogue');
      text.append(h('strong', undefined, projection.dialogue.speaker), h('p', undefined, projection.dialogue.value));
      stage.append(text);
    }
    if (!projection.background && !projection.actors.length && !projection.dialogue) stage.append(h('p', 'v4-stage-empty', '此片段尚未明确设置画面'));
  }

  private updateStatus(): void {
    const actual = this.runtime.querySelector<HTMLElement>('[data-preview-source-state]')?.dataset.previewSourceState;
    this.sourceStatus.textContent = this.view.dock === 'runtime'
      ? actual === 'stale' ? '剧本已有修改。当前仍是上次运行，请重新播放以应用最新内容。' : '运行位置与编辑选择分别记录；选择步骤不会伪造重放。'
      : `${this.scene.file} · 第 ${this.view.line + 1} 行 · 静态排布`;
  }

  private createSourceEditor(): void {
    const textarea = h('textarea', 'v4-source-editor');
    textarea.setAttribute('aria-label', '完整剧本源码');
    textarea.spellcheck = false;
    textarea.wrap = 'off'; // Source rows stay physical rows when revealing a location.
    textarea.value = this.scene.text;
    let expected = this.scene.text;
    textarea.oninput = () => {
      if (!this.editable() || this.scene.text !== expected) {
        setStatus('源文已在其他入口变化，请重新打开源码视图', false, 5000); return;
      }
      const next = applySourceTextareaEdit(expected, textarea.value);
      if (next !== expected) { setCurrentText(next, { coalesce: true }); expected = next; }
      this.updateStatus();
    };
    this.editor.querySelector('.manuscript-sheet')?.append(textarea);
  }

  private structural(change: (text: string) => SourceEdit, focusDialogue = false): boolean {
    if (!this.editable()) return false;
    const before = this.scene.text;
    if (before !== this.knownSource) throw new Error('源文已在另一入口变化，请重新选择场景后操作');
    const rows = parseScript(before);
    const blocks = [...this.editor.querySelectorAll<HTMLElement>('.block[data-line]')];
    if (rows.length !== blocks.length || blocks.some((block) => {
      const row = rows[Number(block.dataset.line)];
      return !row || block.querySelector<HTMLInputElement>('.raw input')?.value !== row.raw
        || !block.classList.contains(`block-${row.kind}`);
    })) throw new Error('场景结构已变化，请切回编排并重新选择步骤');
    const result = change(before);
    if (this.scene.text !== before) throw new Error('源文已变化，未执行步骤操作');
    if (result.text === before) return false;
    this.returnFields();
    setCurrentText(result.text);
    this.view.line = result.selectedLine;
    this.rerender();
    queueMicrotask(() => {
      if (!this.current()) return;
      if (this.view.view === 'source') { this.revealLine(result.selectedLine); return; }
      const block = this.block(result.selectedLine);
      block?.scrollIntoView({ block: 'nearest' });
      if (focusDialogue) {
        const target = block?.querySelector<HTMLTextAreaElement>('.v4-dialogue-input, .fields textarea')
          ?? this.inspector.querySelector<HTMLTextAreaElement>('.fields textarea');
        target?.focus(); target?.setSelectionRange(0, 0);
      }
    });
    return true;
  }
  private remove(index: number): void {
    if (!this.editable()) return;
    const range = stepAt(this.lines(), index);
    if (!window.confirm(range.end > range.start ? '删除这组分支及全部选项？可以撤销。' : '删除这个剧情步骤？可以撤销。')) return;
    const line = this.lines()[range.start];
    if (line?.kind === 'label') {
      if (this.scene.text !== this.knownSource) throw new Error('源文已变化，请重新选择标签后再删除');
      void editSceneLabel(this.sceneKey, range.start, line.raw).then(() => {
        if (!this.current()) return;
        this.returnFields(); this.rerender();
        setStatus('未引用的标签已删除（未保存，可撤销）', true, 5000);
      }).catch(error => setStatus(error instanceof Error ? error.message : String(error), false, 7000));
      return;
    }
    this.structural((text) => deleteStep(text, index));
  }

  private beginDrag(event: PointerEvent, index: number, control: HTMLElement): void {
    if (event.button !== 0 || !this.editable()) return;
    event.preventDefault();
    const expected = this.scene.text;
    control.setPointerCapture(event.pointerId);
    let target = index;
    const clear = (): void => {
      for (const row of this.editor.querySelectorAll('.v4-drop-before')) row.classList.remove('v4-drop-before');
      control.removeEventListener('pointermove', move); control.removeEventListener('pointerup', up); control.removeEventListener('pointercancel', cancel);
      if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
      this.pointerCleanup = null;
    };
    const move = (next: PointerEvent): void => {
      const row = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>('.block[data-line]');
      if (!row || !this.editor.contains(row)) return;
      target = Number(row.dataset.line);
      for (const item of this.editor.querySelectorAll('.v4-drop-before')) item.classList.remove('v4-drop-before');
      row.classList.add('v4-drop-before');
    };
    const cancel = (): void => clear();
    const up = (): void => {
      clear();
      if (this.scene.text !== expected) { setStatus('拖动期间源文变化，已取消排列', false, 5000); return; }
      this.structural((text) => moveStepBefore(text, index, target));
    };
    control.addEventListener('pointermove', move); control.addEventListener('pointerup', up); control.addEventListener('pointercancel', cancel);
    this.pointerCleanup = clear;
  }

  private openInsert(): void {
    if (!this.editable()) return;
    if (this.view.view === 'source') {
      const textarea = this.editor.querySelector<HTMLTextAreaElement>('.v4-source-editor');
      if (!textarea || textarea.value !== this.scene.text.replace(/\r\n|\r/g, '\n')) {
        setStatus('源文已在其他入口变化，请重新打开源码视图后添加', false, 5000);
        return;
      }
      const start = textarea.selectionStart, end = textarea.selectionEnd, scroll = textarea.scrollTop;
      this.view.line = Math.min(textarea.value.slice(0, start).split('\n').length - 1, this.lines().length - 1);
      // Refresh the hidden B01 rows from the accepted source before freezing an
      // insertion anchor. Never relax structural()'s stale-coordinate checks.
      this.returnFields();
      this.rerender();
      const fresh = this.editor.querySelector<HTMLTextAreaElement>('.v4-source-editor');
      if (fresh) { fresh.setSelectionRange(start, end); fresh.scrollTop = scroll; }
    }
    this.returnFields();
    const before = this.scene.text, at = this.view.line;
    const dialog = h('dialog', 'v4-insert-dialog');
    dialog.setAttribute('aria-label', '添加剧情');
    const type = h('select');
    const kinds = [['text', '对白'], ['bg', '背景'], ['show', '人物'], ['voice', '语音'], ['bgm', '音乐'], ['se', '音效'], ['wait', '等待'], ['choice', '分支'], ['timeline', '时间轴'], ['set', '变量'], ['raw', '原始指令']];
    kinds.forEach(([key, label]) => type.append(new Option(label!, key!)));
    const body = h('div', 'v4-insert-fields'), message = h('p', 'v4-muted');
    const drafts = new Map<string, string[]>();
    let previousType = type.value;
    const remember = (): void => { drafts.set(previousType, [...body.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')].map((control) => control.value)); };
    const input = (label: string, value = ''): HTMLInputElement => { const control = h('input'); control.value = value; body.append(field(label, control)); return control; };
    const selectAssets = (kind: string): void => {
      const select = h('select');
      const entries = state.dirAssets.filter((asset) => asset.kind === kind && asset.handle !== null);
      select.append(new Option('请选择项目素材', ''));
      [...new Set(entries.map((asset) => asset.key))].forEach((key) => select.append(new Option(key, key)));
      body.append(field('素材', select));
      if (!entries.length) message.textContent = '该类素材尚未导入，可以先去素材中心处理。';
      if (kind === 'portrait') {
        const expression = h('select');
        const fill = (): void => { expression.replaceChildren(); entries.filter((asset) => asset.key === select.value).forEach((asset) => expression.append(new Option(asset.expr ?? 'normal', asset.expr ?? 'normal'))); };
        select.onchange = fill;
        body.append(field('表情', expression)); fill();
      }
    };
    const render = (): void => {
      body.replaceChildren(); message.textContent = '';
      const kind = type.value;
      if (kind === 'text') { input('说话人（可空）'); const control = h('textarea'); body.append(field('对白', control)); }
      else if (kind === 'bg' || kind === 'voice' || kind === 'bgm' || kind === 'se' || kind === 'show') selectAssets(kind === 'show' ? 'portrait' : kind);
      else if (kind === 'wait') input('等待毫秒', '500');
      else if (kind === 'timeline') { const control = h('select'); state.timelines.forEach((item) => control.append(new Option(item.id, item.id))); body.append(field('已有时间轴', control)); }
      else if (kind === 'choice') { input('第一个选项', '继续交谈'); input('第二个选项', '暂时离开'); message.textContent = '将连同两个唯一段落标记和分支结束位置一起插入。'; }
      else if (kind === 'set') { input('变量名'); input('表达式', '0'); }
      else { const control = h('textarea'); control.value = '@'; body.append(field('完整原始行', control)); }
      const draft = drafts.get(kind);
      if (draft) [...body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,select,textarea')].forEach((control, i) => {
        if (draft[i] !== undefined) control.value = draft[i]!;
        if (control instanceof HTMLSelectElement) control.dispatchEvent(new Event('change'));
      });
      previousType = kind;
    };
    type.onchange = () => { remember(); render(); };
    const close = (): void => { dialog.close(); dialog.remove(); this.renderInspector(); };
    const add = button('插入到当前步骤之后', () => {
      if (!this.editable() || this.scene.text !== before) { message.textContent = '场景或插入位置已变化，请关闭后重新添加。'; return; }
      const values = [...body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,select,textarea')].map((control) => control.value);
      let rows: string[];
      if (type.value === 'text') {
        const speaker = values[0] ?? '', content = values[1] ?? '';
        if (/[\r\n：:]/.test(speaker)) throw new Error('请使用不含换行或冒号的说话人名称');
        rows = content.split(/\r\n|\n|\r/).map((text) => speaker ? `${speaker}：${text}` : text);
      } else if (type.value === 'raw') rows = (values[0] ?? '').split(/\r\n|\n|\r/);
      else if (type.value === 'choice') {
        const labels = new Set(this.lines().filter((line): line is Extract<LineModel, { kind: 'label' }> => line.kind === 'label').map((line) => line.name));
        let n = 1; while (['a', 'b', 'end'].some((part) => labels.has(`branch_${n}_${part}`))) n++;
        const base = `branch_${n}`;
        const labelsText = values.map((value) => { if (!value.trim() || /[\r\n]|\s->|\[if:/.test(value)) throw new Error('请填写不含控制语法的选项文字'); return value; });
        rows = ['@choice', `  ${labelsText[0]} -> @goto ${base}_a`, `  ${labelsText[1]} -> @goto ${base}_b`, `@label ${base}_a`, '在这里续写第一条分支。', `@goto ${base}_end`, `@label ${base}_b`, '在这里续写第二条分支。', `@label ${base}_end`];
      } else if (type.value === 'set') {
        if (!/^[^\s@]+$/.test(values[0] ?? '') || /[\r\n]/.test(values[1] ?? '')) throw new Error('请填写单行变量名与表达式');
        rows = [`@set ${values[0]} = ${values[1] ?? ''}`];
      } else {
        if (!values[0]) throw new Error('请先选择或填写参数');
        rows = [`@${type.value} ${quoteAssetArgument(values[0])}${type.value === 'show' ? ' ' + quoteAssetArgument(values[1] || 'normal') + ' @ center' : ''}`];
      }
      this.view.line = at;
      try {
        const applied = this.structural((text) => insertStep(text, at, rows), type.value === 'text');
        // Keep the draft and dialog on any rejected/no-op edit. Closing is a
        // consequence of accepted source, never a prerequisite to committing it.
        if (applied) close();
        else message.textContent = '本次没有插入内容，草稿仍保留，请检查输入或当前编辑状态。';
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : '未插入内容，草稿仍保留。';
        setStatus(message.textContent, false, 6000);
      }
    }, 'v4-button v4-primary');
    const footer = h('footer'); footer.append(button('取消', close), add);
    dialog.append(h('h2', undefined, '添加剧情'), field('内容类型', type), body, message, footer);
    // Kept under the application's inert/write-lock region, not body.
    this.root.append(dialog); render();
    dialog.oncancel = (event) => { event.preventDefault(); close(); };
    dialog.showModal();
  }

  private download(): void {
    if (!this.current()) return;
    const url = URL.createObjectURL(new Blob([this.scene.text], { type: 'text/plain;charset=utf-8' }));
    const link = h('a'); link.href = url; link.download = this.scene.file.split('/').at(-1) || 'scene.gal'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
