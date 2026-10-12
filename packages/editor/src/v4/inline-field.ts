/**
 * Inline markup around one native dialogue textarea. The textarea stays the only editor
 * (input method, selection and undo are the browser's); this module adds a highlight layer
 * behind it, a styled reading view while it is not focused, `<` completion and a selection
 * toolbar. Every node is built with textContent; source text is never parsed as HTML.
 */
import { parseInlineText, type InlineStyle, type InlineTextContext, type InlineTextDocument, type InlineTextIssue } from '@surdet/core';
import { h, setStatus } from '../state.js';
import { completionPrefix, inlineCompletions, inlineTagAllowed, wrapInlineSelection, type InlineCompletion, type InlineTagName } from './inline-markup.js';

export interface InlineFieldOptions {
  editable(): boolean;
  /** False while the row is not dialogue (e.g. an empty row typed into an instruction); markup help is then off. */
  active?(): boolean;
  /** Core's text context. An option ('choice') is offered and accepts only the tags Core allows there. */
  context?: InlineTextContext;
  /** Core's issues for the current text after each refresh; empty while markup help is off. */
  onIssues?(issues: readonly InlineTextIssue[]): void;
  signal: AbortSignal;
}

const THEME_COLORS: Record<string, string> = {
  text: 'inherit',
  textMuted: 'var(--surdet-text-muted)',
  accent: 'var(--surdet-action-primary)',
  accentSoft: 'var(--surdet-color-accent-500)',
  danger: 'var(--surdet-state-danger)',
};

const WRAPS: readonly { name: InlineTagName; value?: string; label: string; title: string }[] = [
  { name: 'b', label: 'B', title: '粗体（Ctrl+B）' },
  { name: 'i', label: 'I', title: '斜体（Ctrl+I）' },
  { name: 'color', value: 'accent', label: '强调', title: '强调色' },
  { name: 'color', value: 'danger', label: '警示', title: '警示色' },
  { name: 'color', value: 'textMuted', label: '淡', title: '次要色' },
  { name: 'size', value: '0.8', label: '小', title: '字号 0.8 倍' },
  { name: 'size', value: '1.3', label: '大', title: '字号 1.3 倍' },
  { name: 'speed', value: '0.5', label: '慢', title: '打字速度 0.5 倍' },
  { name: 'em', label: '着重', title: '着重号' },
  { name: 'shake', label: '抖动', title: '逐字抖动' },
  { name: 'wave', label: '波浪', title: '逐字波浪' },
];

/** Replace [start, end) through the browser's editing path so Ctrl+Z restores it. */
export function insertText(textarea: HTMLTextAreaElement, start: number, end: number, text: string): void {
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(start, end);
  const accepted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  if (!accepted || textarea.value.slice(start, start + text.length) !== text) {
    textarea.setRangeText(text, start, end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function styleSpan(text: string, style: InlineStyle): HTMLElement {
  const span = h('span', undefined, text);
  if (style.bold) span.style.fontWeight = '700';
  if (style.italic) span.style.fontStyle = 'italic';
  if (style.color) span.style.color = THEME_COLORS[style.color] ?? style.color;
  if (style.size) span.style.fontSize = `${style.size}em`;
  if (style.speed) { span.classList.add('v4-inline-speed'); span.title = `打字速度 ×${style.speed}`; }
  if (style.emphasis) span.classList.add('v4-inline-emphasis');
  // Motion belongs to the real preview; the reading view only marks where it applies.
  if (style.effect) { span.classList.add(`v4-inline-${style.effect}`); span.title = style.effect === 'shake' ? '逐字抖动' : '逐字波浪'; }
  return span;
}

/** The dialogue as it will read: styles, ruby and pause marks, each unit tagged with its source range. */
function renderReading(view: HTMLElement, parsed: InlineTextDocument): void {
  view.replaceChildren();
  const marks = new Map<number, HTMLElement[]>();
  for (const control of parsed.controls) {
    const mark = h('span', 'v4-inline-pause', control.kind === 'wait' ? '▸' : control.kind === 'no-wait' ? '↦' : `停${(control.durationMs ?? 0) / 1000}秒`);
    mark.title = control.kind === 'wait' ? '等待点击后继续本句' : control.kind === 'no-wait' ? '句末自动继续，不等点击' : `停顿 ${control.durationMs} 毫秒`;
    marks.set(control.at, [...marks.get(control.at) ?? [], mark]);
  }
  parsed.units.forEach((unit, index) => {
    for (const mark of marks.get(index) ?? []) view.append(mark);
    let node: HTMLElement;
    if (unit.ruby !== undefined) {
      node = styleSpan('', unit.style);
      const ruby = document.createElement('ruby');
      ruby.append(unit.text);
      const reading = document.createElement('rt');
      reading.textContent = unit.ruby;
      ruby.append(reading);
      node.append(ruby);
    } else node = styleSpan(unit.text, unit.style);
    node.dataset.start = String(unit.start);
    node.dataset.end = String(unit.end);
    view.append(node);
  });
  for (const mark of marks.get(parsed.units.length) ?? []) view.append(mark);
}

export interface SourceMark { start: number; end: number; kind: 'is-tag' | 'is-error' | 'is-warning' }

/** Tag tokens and problems of one parsed text, moved by `offset` when the text sits inside a larger source. */
export function documentMarks(parsed: InlineTextDocument, offset = 0): SourceMark[] {
  return [
    ...parsed.tags.map((tag): SourceMark => ({ start: offset + tag.start, end: offset + tag.end, kind: 'is-tag' })),
    ...parsed.issues.map((issue): SourceMark => ({ start: offset + issue.start, end: offset + Math.max(issue.end, issue.start + 1), kind: issue.severity === 'error' ? 'is-error' : 'is-warning' })),
  ];
}

/** The source again, transparent, with tag tokens and problems marked; it sits exactly under the textarea text. */
export function renderMarks(mirror: HTMLElement, source: string, marks: readonly SourceMark[], caret: number | null): HTMLElement | null {
  mirror.replaceChildren();
  const cuts = new Set([0, source.length]);
  for (const mark of marks) { cuts.add(Math.min(mark.start, source.length)); cuts.add(Math.min(mark.end, source.length)); }
  if (caret !== null) cuts.add(caret);
  const points = [...cuts].sort((a, b) => a - b);
  let caretNode: HTMLElement | null = null;
  for (let index = 0; index < points.length; index++) {
    const start = points[index]!, end = points[index + 1];
    if (caret === start) { caretNode = h('span', 'v4-inline-caret'); mirror.append(caretNode); }
    if (end === undefined || end === start) continue;
    const kinds = marks.filter((mark) => mark.start <= start && mark.end >= end).map((mark) => mark.kind);
    mirror.append(kinds.length ? h('span', kinds.join(' '), source.slice(start, end)) : source.slice(start, end));
  }
  // A trailing character keeps the last line box the same height as the textarea's.
  mirror.append('​');
  return caretNode;
}

/** The `<` completion list: each entry is a fixed tag name and its Core label, never author text as markup. */
export function renderCompletionList(list: HTMLElement, entries: readonly InlineCompletion[], active: number, accept: (entry: InlineCompletion) => void): void {
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', '行内标签');
  list.replaceChildren();
  entries.forEach((entry, index) => {
    const option = h('div', 'v4-inline-completion-option');
    option.id = `v4-inline-option-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(index === active));
    option.append(h('code', undefined, entry.label), h('span', undefined, entry.detail));
    option.onpointerdown = (event) => { event.preventDefault(); accept(entry); };
    list.append(option);
  });
}

export function attachInlineField(textarea: HTMLTextAreaElement, options: InlineFieldOptions): HTMLElement {
  const context = options.context ?? 'dialogue';
  const field = h('div', 'v4-inline-field');
  field.classList.toggle('is-choice', context === 'choice');
  const mirror = h('div', 'v4-inline-mirror');
  const view = h('div', 'v4-inline-view');
  mirror.setAttribute('aria-hidden', 'true');
  view.setAttribute('aria-hidden', 'true');
  field.append(mirror, view, textarea);
  const signal = options.signal;

  let completion: { list: HTMLElement; entries: InlineCompletion[]; active: number; start: number } | null = null;
  let toolbar: HTMLElement | null = null;
  let pendingCaret: number | null = null;
  let composing = false;

  const parse = (): InlineTextDocument => parseInlineText(textarea.value, context);
  const focused = (): boolean => document.activeElement === textarea;
  const markupActive = (): boolean => options.active?.() ?? true;

  const refresh = (): void => {
    if (!markupActive()) {
      field.classList.remove('is-projected', 'has-markup');
      view.replaceChildren();
      mirror.replaceChildren(textarea.value, '\u200b');
      options.onIssues?.([]);
      return;
    }
    const parsed = parse();
    const projected = !focused() && parsed.hasMarkup && !parsed.issues.some((issue) => issue.severity === 'error');
    field.classList.toggle('is-projected', projected);
    field.classList.toggle('has-markup', parsed.hasMarkup);
    if (projected) renderReading(view, parsed);
    else view.replaceChildren();
    renderMarks(mirror, textarea.value, documentMarks(parsed), null);
    options.onIssues?.(parsed.issues);
  };

  const closeCompletion = (): void => {
    completion?.list.remove();
    completion = null;
    textarea.removeAttribute('aria-activedescendant');
  };

  const acceptCompletion = (entry: InlineCompletion): void => {
    if (!completion || !options.editable()) return;
    const caret = textarea.selectionEnd, start = completion.start;
    closeCompletion();
    insertText(textarea, start, caret, entry.snippet);
    textarea.setSelectionRange(start + entry.select[0], start + entry.select[1]);
    refresh();
  };

  const showCompletion = (): void => {
    if (composing || !markupActive() || !options.editable() || textarea.selectionStart !== textarea.selectionEnd) { closeCompletion(); return; }
    const found = completionPrefix(textarea.value, textarea.selectionEnd);
    const entries = found ? inlineCompletions(found.prefix, context) : [];
    if (!found || entries.length === 0) { closeCompletion(); return; }
    const caretNode = renderMarks(mirror, textarea.value, documentMarks(parse()), textarea.selectionEnd);
    const list = completion?.list ?? h('div', 'v4-inline-completion');
    const active = Math.min(completion?.active ?? 0, entries.length - 1);
    renderCompletionList(list, entries, active, acceptCompletion);
    textarea.setAttribute('aria-activedescendant', `v4-inline-option-${active}`);
    if (caretNode) {
      list.style.left = `${Math.max(0, Math.min(caretNode.offsetLeft, field.clientWidth - 240))}px`;
      list.style.top = `${caretNode.offsetTop + caretNode.offsetHeight + 4}px`;
    }
    if (!list.isConnected) field.append(list);
    completion = { list, entries, active, start: found.start };
  };

  const moveCompletion = (step: number): void => {
    if (!completion) return;
    completion.active = (completion.active + step + completion.entries.length) % completion.entries.length;
    showCompletion();
  };

  const wrap = (name: InlineTagName, value?: string, range = { start: textarea.selectionStart, end: textarea.selectionEnd, source: textarea.value }): void => {
    if (!options.editable()) return;
    if (textarea.value !== range.source) { setStatus('台词已变化，请重新选择文字', false, 4000); return; }
    const result = wrapInlineSelection(range.source, range.start, range.end, name, value, context);
    if (!result.ok) { setStatus(result.reason, false, 5000); return; }
    const inserted = result.text.slice(range.start, result.text.length - (range.source.length - range.end));
    insertText(textarea, range.start, range.end, inserted);
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    refresh();
    updateToolbar();
  };

  const closeToolbar = (): void => { toolbar?.remove(); toolbar = null; };
  const updateToolbar = (): void => {
    const show = focused() && markupActive() && options.editable() && !composing && textarea.selectionStart !== textarea.selectionEnd;
    if (!show) { if (!toolbar?.contains(document.activeElement)) closeToolbar(); return; }
    if (toolbar) return;
    toolbar = h('div', 'v4-inline-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '给选中文字加标签');
    for (const entry of WRAPS.filter((wrap) => inlineTagAllowed(wrap.name, context))) {
      const button = h('button', 'v4-inline-tool', entry.label);
      button.type = 'button'; button.title = entry.title; button.setAttribute('aria-label', entry.title);
      if (entry.name === 'b') button.style.fontWeight = '700';
      if (entry.name === 'i') button.style.fontStyle = 'italic';
      if (entry.name === 'color') button.style.color = THEME_COLORS[entry.value!]!;
      button.onpointerdown = (event) => event.preventDefault();
      button.onclick = () => wrap(entry.name, entry.value);
      toolbar.append(button);
    }
    const rubyButton = h('button', 'v4-inline-tool', '注音');
    rubyButton.type = 'button'; rubyButton.title = '给选中文字加注音'; rubyButton.setAttribute('aria-label', '给选中文字加注音');
    rubyButton.onpointerdown = (event) => event.preventDefault();
    rubyButton.onclick = () => {
      const range = { start: textarea.selectionStart, end: textarea.selectionEnd, source: textarea.value };
      const reading = h('input', 'v4-inline-reading');
      reading.placeholder = '读音，回车确认'; reading.setAttribute('aria-label', '注音读音');
      reading.onkeydown = (event) => {
        if (event.isComposing) return;
        if (event.key === 'Escape') { event.preventDefault(); textarea.focus(); textarea.setSelectionRange(range.start, range.end); closeToolbar(); }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!reading.value.trim()) return;
          wrap('ruby', reading.value.trim(), range);
          closeToolbar();
        }
      };
      reading.onblur = () => queueMicrotask(() => { if (!field.contains(document.activeElement)) closeToolbar(); });
      rubyButton.replaceWith(reading);
      reading.focus();
    };
    if (inlineTagAllowed('ruby', context)) toolbar.append(rubyButton);
    field.append(toolbar);
  };

  textarea.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (completion) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopImmediatePropagation(); moveCompletion(event.key === 'ArrowDown' ? 1 : -1); return; }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); event.stopImmediatePropagation(); acceptCompletion(completion.entries[completion.active]!); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeCompletion(); return; }
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key === 'b' || event.key === 'i')
      && textarea.selectionStart !== textarea.selectionEnd && markupActive()) {
      event.preventDefault(); event.stopImmediatePropagation();
      wrap(event.key as 'b' | 'i');
    }
  }, { capture: true, signal });
  textarea.addEventListener('compositionstart', () => { composing = true; closeCompletion(); closeToolbar(); }, { signal });
  textarea.addEventListener('compositionend', () => { composing = false; refresh(); }, { signal });
  textarea.addEventListener('input', () => { refresh(); showCompletion(); }, { signal });
  textarea.addEventListener('focus', () => { refresh(); }, { signal });
  textarea.addEventListener('blur', () => {
    closeCompletion();
    queueMicrotask(() => { if (!field.contains(document.activeElement)) closeToolbar(); refresh(); });
  }, { signal });
  for (const type of ['select', 'keyup', 'mouseup'] as const) textarea.addEventListener(type, updateToolbar, { signal });
  textarea.addEventListener('click', () => {
    if (pendingCaret !== null && textarea.selectionStart === textarea.selectionEnd) textarea.setSelectionRange(pendingCaret, pendingCaret);
    pendingCaret = null;
    updateToolbar();
  }, { signal });
  // In the reading view, put the caret at the unit that was clicked rather than where the hidden source happens to be.
  field.addEventListener('pointerdown', (event) => {
    if (!field.classList.contains('is-projected')) return;
    const unit = document.elementsFromPoint(event.clientX, event.clientY)
      .find((node): node is HTMLElement => node instanceof HTMLElement && view.contains(node) && node.dataset.start !== undefined);
    const box = unit?.getBoundingClientRect();
    const caret = unit && box ? Number(event.clientX < box.left + box.width / 2 ? unit.dataset.start : unit.dataset.end) : textarea.value.length;
    if (event.target === textarea) { pendingCaret = caret; return; }
    // The reading view can be taller than the source (ruby); a click below the textarea still edits it.
    event.preventDefault();
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(caret, caret);
  }, { signal });
  signal.addEventListener('abort', () => { closeCompletion(); closeToolbar(); }, { once: true });
  refresh();
  return field;
}
