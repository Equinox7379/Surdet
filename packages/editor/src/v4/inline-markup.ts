/**
 * Editor-side operations on dialogue markup. Every rule comes from Core's single
 * parser (`parseInlineText`); this module only maps its source ranges onto edits,
 * so a refused case is reported instead of guessing what the author meant.
 */
import { INLINE_TEXT_TAGS, containsInlineTag, escapeInlineText, findChoiceArrow, findChoiceCondition, parseInlineText, type InlineTagSpan, type InlineTextContext, type InlineTextDocument } from '@surdet/core';

export type InlineTagName = typeof INLINE_TEXT_TAGS[number]['name'];
export type InlineEdit =
  | { ok: true; text: string; selectionStart: number; selectionEnd: number }
  | { ok: false; reason: string };

interface PairedSpan { name: string; open: InlineTagSpan; close: InlineTagSpan }

/** Single tags (`<w>`, `<nw>`) mark a point; only paired tags enclose text. */
const UNPAIRED = new Set<string>(INLINE_TEXT_TAGS.filter((tag) => !tag.paired).map((tag) => tag.name));

const hasErrors = (document: InlineTextDocument): boolean => document.issues.some((issue) => issue.severity === 'error');

/** Whether Core accepts the tag in this context at all (a choice refuses pauses, speed, nw and motion); asked of the parser itself. */
export function inlineTagAllowed(name: InlineTagName, context: InlineTextContext = 'dialogue'): boolean {
  return !parseInlineText(`<${name}>`, context).issues.some((issue) => issue.code === 'M005');
}

/** Open/close pairs in source order. Invalid lines have no tags, so they yield no pairs. */
export function pairedSpans(document: InlineTextDocument): PairedSpan[] {
  const stack: InlineTagSpan[] = [], pairs: PairedSpan[] = [];
  for (const tag of document.tags) {
    if (UNPAIRED.has(tag.name)) continue;
    if (!tag.closing) { stack.push(tag); continue; }
    const open = stack.pop();
    if (open?.name === tag.name) pairs.push({ name: tag.name, open, close: tag });
  }
  return pairs.sort((a, b) => a.open.start - b.open.start);
}

/** A caret strictly inside `<…>` or inside a ruby group cannot be split or wrapped. */
function blockedAt(document: InlineTextDocument, pairs: readonly PairedSpan[], at: number): string | null {
  if (document.tags.some((tag) => tag.start < at && at < tag.end)) return '光标在标签内部，请移到标签外再操作';
  if (pairs.some((pair) => pair.name === 'ruby' && pair.open.start < at && at < pair.close.end)) return '光标在注音内部，注音需要整体处理';
  return null;
}

/** Styling spans whose content contains `at`, outermost first. */
function spansAround(pairs: readonly PairedSpan[], at: number): PairedSpan[] {
  return pairs.filter((pair) => pair.name !== 'ruby' && pair.open.end <= at && at <= pair.close.start);
}

function invalidLine(source: string, document: InlineTextDocument): string | null {
  return document.hasMarkup && hasErrors(document) ? `这句的标签有错误（${document.issues.find((issue) => issue.severity === 'error')!.message}），请先修正` : null;
}

/** Wrap the selected source range in one tag; refuses selections that would cross existing tag boundaries. */
export function wrapInlineSelection(source: string, start: number, end: number, name: InlineTagName, value?: string, context: InlineTextContext = 'dialogue'): InlineEdit {
  if (!(Number.isInteger(start) && Number.isInteger(end) && 0 <= start && start < end && end <= source.length)) return { ok: false, reason: '先选中要加标签的文字' };
  if (name === 'w') return { ok: false, reason: '停顿标签不包裹文字，请在光标处插入' };
  if (UNPAIRED.has(name)) return { ok: false, reason: `<${name}> 不包裹文字，请放在句末` };
  const refused = parseInlineText(`<${name}>`, context).issues.find((issue) => issue.code === 'M005');
  if (refused) return { ok: false, reason: refused.message };
  const document = parseInlineText(source, context);
  const invalid = invalidLine(source, document);
  if (invalid) return { ok: false, reason: invalid };
  const pairs = pairedSpans(document);
  const blocked = blockedAt(document, pairs, start) ?? blockedAt(document, pairs, end);
  if (blocked) return { ok: false, reason: blocked };
  for (const pair of pairs) {
    const disjoint = end <= pair.open.start || start >= pair.close.end;
    const inside = start >= pair.open.end && end <= pair.close.start;
    const covers = start <= pair.open.start && end >= pair.close.end;
    if (!(disjoint || inside || covers)) return { ok: false, reason: `选区跨过了 <${pair.name}> 的边界，请调整选区` };
    if (name === 'ruby' && !disjoint) return { ok: false, reason: '注音的主文字里不能再有其他标签；样式请放在注音外层' };
  }
  if (name === 'ruby' && document.tags.some((tag) => tag.start >= start && tag.end <= end)) return { ok: false, reason: '注音的主文字里不能再有其他标签' };
  const open = `<${name}${value === undefined ? '' : `=${value}`}>`, close = `</${name}>`;
  const text = source.slice(0, start) + open + source.slice(start, end) + close + source.slice(end);
  const next = parseInlineText(text, context);
  const error = next.issues.find((issue) => issue.severity === 'error');
  if (error) return { ok: false, reason: error.message };
  return { ok: true, text, selectionStart: start + open.length, selectionEnd: end + open.length };
}

/** Insert an unpaired tag (`<w>` / `<w=ms>`) at a caret outside every tag token and ruby group. */
export function insertInlineMarker(source: string, at: number, marker: string): InlineEdit {
  if (!Number.isInteger(at) || at < 0 || at > source.length) return { ok: false, reason: '光标位置已变化，请重新选择' };
  const document = parseInlineText(source);
  const invalid = invalidLine(source, document);
  if (invalid) return { ok: false, reason: invalid };
  const blocked = blockedAt(document, pairedSpans(document), at);
  if (blocked) return { ok: false, reason: blocked };
  const text = source.slice(0, at) + marker + source.slice(at);
  const error = parseInlineText(text).issues.find((issue) => issue.severity === 'error');
  if (error) return { ok: false, reason: error.message };
  return { ok: true, text, selectionStart: at + marker.length, selectionEnd: at + marker.length };
}

/**
 * Split one dialogue at [start, end): styling spans open at the split point are closed on
 * the first line and reopened on the second, so both lines keep their look. A split inside a
 * tag, inside ruby, or across a removed tag is refused.
 */
export function splitInlineDialogue(source: string, start: number, end: number): { ok: true; left: string; right: string; reopened: number } | { ok: false; reason: string } {
  const document = parseInlineText(source);
  if (!document.hasMarkup) return { ok: true, left: source.slice(0, start), right: source.slice(end), reopened: 0 };
  const invalid = invalidLine(source, document);
  if (invalid) return { ok: false, reason: invalid };
  const pairs = pairedSpans(document);
  const blocked = blockedAt(document, pairs, start) ?? blockedAt(document, pairs, end);
  if (blocked) return { ok: false, reason: blocked };
  if (document.tags.some((tag) => tag.start < end && tag.end > start)) return { ok: false, reason: '选区里有标签，拆分会删掉它；请缩小选区' };
  const open = spansAround(pairs, start);
  const reopen = open.map((pair) => source.slice(pair.open.start, pair.open.end)).join('');
  return {
    ok: true,
    left: source.slice(0, start) + [...open].reverse().map((pair) => `</${pair.name}>`).join(''),
    right: reopen + source.slice(end),
    reopened: reopen.length,
  };
}

/** Source range of a visible-text range, or null when it does not fall on whole visible units. */
export function sourceRangeOfPlain(document: InlineTextDocument, plainStart: number, plainEnd: number): { start: number; end: number; units: number[] } | null {
  let offset = 0, first = -1, last = -1;
  for (const [index, unit] of document.units.entries()) {
    if (offset === plainStart && first < 0) first = index;
    offset += unit.text.length;
    if (offset === plainEnd && first >= 0) { last = index; break; }
    if (offset > plainEnd) break;
  }
  if (first < 0 || last < first) return null;
  return { start: document.units[first]!.start, end: document.units[last]!.end, units: document.units.slice(first, last + 1).map((_, i) => first + i) };
}

export interface DialogueReplacement { value: string; count: number; skipped: number }

/** Replacement text written into dialogue: escaped only when it would otherwise become markup or an escape. */
export function visibleReplacement(replacement: string): string {
  return containsInlineTag(replacement) || replacement.includes('\\') ? escapeInlineText(replacement) : replacement;
}

/**
 * Literal replacement on the visible text of one dialogue. A match is written back only
 * when it covers whole visible units whose source has no tag and no ruby; otherwise it is
 * counted as skipped. Replacement text is written as visible text (see `visibleReplacement`).
 */
export function replaceInDialogue(source: string, matcher: RegExp, replacement: string, context: InlineTextContext = 'dialogue'): DialogueReplacement {
  const document = parseInlineText(source, context);
  const ranges: { start: number; end: number }[] = [];
  let skipped = 0;
  const re = new RegExp(matcher.source, matcher.flags.includes('g') ? matcher.flags : `${matcher.flags}g`);
  const invalid = document.hasMarkup && hasErrors(document);
  for (let match = re.exec(document.plainText); match; match = re.exec(document.plainText)) {
    if (match[0].length === 0) { re.lastIndex += 1; continue; }
    const range = invalid ? null : sourceRangeOfPlain(document, match.index, match.index + match[0].length);
    const unsafe = range === null || range.units.some((index) => document.units[index]!.ruby !== undefined)
      || document.tags.some((tag) => tag.start < range.end && tag.end > range.start);
    if (unsafe) skipped++;
    else ranges.push(range);
  }
  let value = source;
  const written = visibleReplacement(replacement);
  for (const range of [...ranges].reverse()) value = value.slice(0, range.start) + written + value.slice(range.end);
  return { value, count: ranges.length, skipped };
}

/** First visible-text match in a dialogue, for search excerpts. */
export function findInDialogue(source: string, matcher: RegExp, context: InlineTextContext = 'dialogue'): { plain: string; start: number; end: number } | null {
  const document = parseInlineText(source, context);
  const re = new RegExp(matcher.source, matcher.flags.replace('g', ''));
  const match = re.exec(document.plainText);
  return match && match[0].length > 0 ? { plain: document.plainText, start: match.index, end: match.index + match[0].length } : null;
}

/**
 * Source range of an option's shown text in a choice row, read the way Core's parser reads it:
 * after the indent, before the `->` Core finds and before a trailing `[if:…]`. Null when Core
 * would not read an option text from the row.
 */
export function choiceLabelSpan(raw: string): { start: number; end: number } | null {
  const indent = raw.length - raw.trimStart().length, trimmed = raw.slice(indent);
  let arrow: ReturnType<typeof findChoiceArrow>;
  try { arrow = findChoiceArrow(trimmed); } catch { return null; }
  const part = arrow ? trimmed.slice(0, arrow.index) : trimmed;
  const start = indent + part.length - part.trimStart().length;
  let label = part.trim();
  try {
    const when = findChoiceCondition(label);
    if (when) label = label.slice(0, when.index).trim();
  } catch { return null; }
  return label.length > 0 ? { start, end: start + label.length } : null;
}

/** Tag table entries offered while typing `<`, only those the context accepts. `w` appears twice: click wait and timed pause. */
export interface InlineCompletion { key: string; name: InlineTagName; label: string; detail: string; snippet: string; select: [number, number] }
export function inlineCompletions(prefix: string, context: InlineTextContext = 'dialogue'): InlineCompletion[] {
  const entries: InlineCompletion[] = [];
  for (const tag of INLINE_TEXT_TAGS) {
    if (!inlineTagAllowed(tag.name, context)) continue;
    if (tag.name === 'w') {
      entries.push({ key: 'w', name: 'w', label: '<w>', detail: '等待点击后继续本句', snippet: '<w>', select: [3, 3] });
      entries.push({ key: 'w=', name: 'w', label: '<w=毫秒>', detail: '停顿，1–10000 毫秒', snippet: '<w=500>', select: [3, 6] });
      continue;
    }
    const placeholder = tag.name === 'color' ? 'accent' : tag.name === 'size' ? '0.8' : tag.name === 'speed' ? '0.5' : tag.name === 'ruby' ? '读音' : '';
    const open = `<${tag.name}${tag.value === null ? '' : `=${placeholder}`}>`;
    const snippet = tag.paired ? `${open}</${tag.name}>` : open;
    const select: [number, number] = tag.value === null ? [open.length, open.length] : [tag.name.length + 2, tag.name.length + 2 + placeholder.length];
    entries.push({ key: tag.name, name: tag.name, label: `<${tag.name}${tag.value === null ? '' : '=…'}>`, detail: tag.label, snippet, select });
  }
  return entries.filter((entry) => entry.name.startsWith(prefix));
}

/** The `<partial` being typed right before the caret, if any. */
export function completionPrefix(source: string, caret: number): { start: number; prefix: string } | null {
  const before = source.slice(0, caret);
  const match = /<([a-z]*)$/.exec(before);
  if (!match) return null;
  const start = caret - match[0].length;
  let slashes = 0;
  for (let index = start - 1; index >= 0 && source[index] === '\\'; index--) slashes++;
  return slashes % 2 === 1 ? null : { start, prefix: match[1]! };
}
