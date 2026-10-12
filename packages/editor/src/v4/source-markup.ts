/**
 * Inline markup help for the whole-scene source textarea. Only the text Core reads as a line's
 * dialogue (after `speaker：`) or as an option's shown text is parsed, each in its own context;
 * instruction arguments, conditions, jumps, labels and comments are left alone. The textarea stays
 * the editor: behind it a transparent copy marks tags and problems, a status line names the
 * problems on the caret's row, and `<` offers the tags that row's context accepts.
 */
import { parseInlineText, type InlineTextDocument } from '@surdet/core';
import { parseScript } from '../model.js';
import { h } from '../state.js';
import { choiceLabelSpan, completionPrefix, inlineCompletions, type InlineCompletion } from './inline-markup.js';
import { documentMarks, insertText, renderCompletionList, renderMarks } from './inline-field.js';

export interface SourceMarkupSegment { line: number; start: number; end: number; context: 'dialogue' | 'choice'; document: InlineTextDocument }

/** Dialogue and option texts of a source, as textarea offsets, each parsed by Core in its context. */
export function sourceMarkupSegments(source: string): SourceMarkupSegment[] {
  const segments: SourceMarkupSegment[] = [];
  let offset = 0;
  parseScript(source).forEach((row, line) => {
    let range: { start: number; end: number; context: 'dialogue' | 'choice' } | null = null;
    if (row.kind === 'text' && row.value.length > 0 && row.raw.endsWith(row.value)) {
      range = { start: row.raw.length - row.value.length, end: row.raw.length, context: 'dialogue' };
    } else if (row.kind === 'choice-option') {
      const span = choiceLabelSpan(row.raw);
      if (span) range = { ...span, context: 'choice' };
    }
    if (range) {
      segments.push({ line, start: offset + range.start, end: offset + range.end, context: range.context,
        document: parseInlineText(row.raw.slice(range.start, range.end), range.context) });
    }
    offset += row.raw.length + row.eol.length;
  });
  return segments;
}

/** Problems on the caret's row in Core's words, and where the others are. Empty when there are none. */
export function sourceMarkupSummary(segments: readonly SourceMarkupSegment[], row: number): string {
  const withIssues = segments.filter((segment) => segment.document.issues.length > 0);
  const here = withIssues.filter((segment) => segment.line === row).flatMap((segment) => segment.document.issues.map((issue) => issue.message));
  const others = [...new Set(withIssues.filter((segment) => segment.line !== row).map((segment) => segment.line + 1))];
  const parts: string[] = [];
  if (here.length) parts.push(`第 ${row + 1} 行：${here.join('；')}`);
  if (others.length) parts.push(`${here.length ? '另有' : ''}标签问题在第 ${others.slice(0, 8).join('、')}${others.length > 8 ? ' 等' : ''} 行`);
  return parts.join('。');
}

export function attachSourceMarkup(textarea: HTMLTextAreaElement, options: { editable(): boolean; signal: AbortSignal }): HTMLElement {
  const field = h('div', 'v4-source-field');
  const box = h('div', 'v4-source-box');
  const mirror = h('div', 'v4-source-mirror v4-inline-mirror');
  mirror.setAttribute('aria-hidden', 'true');
  const status = h('p', 'v4-source-markup-status');
  status.setAttribute('role', 'status');
  box.append(mirror, textarea);
  field.append(box, status);
  const signal = options.signal;

  let segments: SourceMarkupSegment[] = [];
  let completion: { list: HTMLElement; entries: InlineCompletion[]; active: number; start: number } | null = null;
  let composing = false;

  const sync = (): void => { mirror.scrollTop = textarea.scrollTop; mirror.scrollLeft = textarea.scrollLeft; };
  const caretRow = (): number => textarea.value.slice(0, textarea.selectionStart).split('\n').length - 1;
  const describe = (): void => {
    const text = sourceMarkupSummary(segments, caretRow());
    if (status.textContent !== text) status.textContent = text;
    status.hidden = text === '';
    status.classList.toggle('has-error', segments.some((segment) => segment.document.issues.some((issue) => issue.severity === 'error')));
  };
  const refresh = (caret: number | null = null): HTMLElement | null => {
    segments = sourceMarkupSegments(textarea.value);
    const caretNode = renderMarks(mirror, textarea.value, segments.flatMap((segment) => documentMarks(segment.document, segment.start)), caret);
    sync();
    describe();
    return caretNode;
  };

  const closeCompletion = (): void => {
    completion?.list.remove();
    completion = null;
    textarea.removeAttribute('aria-activedescendant');
  };
  const accept = (entry: InlineCompletion): void => {
    if (!completion || !options.editable()) return;
    const caret = textarea.selectionEnd, start = completion.start;
    closeCompletion();
    insertText(textarea, start, caret, entry.snippet);
    textarea.setSelectionRange(start + entry.select[0], start + entry.select[1]);
    refresh();
  };
  const showCompletion = (): void => {
    if (composing || !options.editable() || textarea.selectionStart !== textarea.selectionEnd) { closeCompletion(); return; }
    const caret = textarea.selectionEnd;
    const segment = segments.find((entry) => entry.start <= caret && caret <= entry.end);
    const found = segment ? completionPrefix(textarea.value, caret) : null;
    const entries = segment && found && found.start >= segment.start ? inlineCompletions(found.prefix, segment.context) : [];
    if (!found || entries.length === 0) { closeCompletion(); return; }
    const caretNode = refresh(caret);
    const list = completion?.list ?? h('div', 'v4-inline-completion');
    const active = Math.min(completion?.active ?? 0, entries.length - 1);
    renderCompletionList(list, entries, active, accept);
    textarea.setAttribute('aria-activedescendant', `v4-inline-option-${active}`);
    if (caretNode) {
      // The caret mark is laid out in the mirror, which scrolls with the textarea.
      list.style.left = `${Math.max(0, Math.min(caretNode.offsetLeft - mirror.scrollLeft, box.clientWidth - 240))}px`;
      list.style.top = `${caretNode.offsetTop - mirror.scrollTop + caretNode.offsetHeight + 4}px`;
    }
    if (!list.isConnected) box.append(list);
    completion = { list, entries, active, start: found.start };
  };

  textarea.addEventListener('keydown', (event) => {
    if (event.isComposing || !completion) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopImmediatePropagation();
      completion.active = (completion.active + (event.key === 'ArrowDown' ? 1 : -1) + completion.entries.length) % completion.entries.length;
      showCompletion();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault(); event.stopImmediatePropagation();
      accept(completion.entries[completion.active]!);
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      closeCompletion();
    }
  }, { capture: true, signal });
  textarea.addEventListener('compositionstart', () => { composing = true; closeCompletion(); }, { signal });
  textarea.addEventListener('compositionend', () => { composing = false; refresh(); }, { signal });
  textarea.addEventListener('input', () => { refresh(); showCompletion(); }, { signal });
  textarea.addEventListener('scroll', () => { sync(); closeCompletion(); }, { signal });
  textarea.addEventListener('blur', closeCompletion, { signal });
  for (const type of ['focus', 'keyup', 'click'] as const) textarea.addEventListener(type, describe, { signal });
  signal.addEventListener('abort', closeCompletion, { once: true });
  refresh();
  return field;
}
