/**
 * 跨场景搜索/替换（M6 E5-1）：全文搜索（正则可选），替换走 history 可撤销，
 * 替换后由调用方重新调度校验。
 */
import { parseSceneDocument, type SceneDocumentLine } from '@surdet/authoring';
import { containsInlineTag, parseInlineText } from '@surdet/core';
import { choiceLabelSpan, findInDialogue, replaceInDialogue, visibleReplacement } from './v4/inline-markup.js';

export interface SceneText {
  /** 场景 Map key（相对路径） */
  key: string;
  /** 场景 ID（basename） */
  id: string;
  text: string;
}

export interface SearchResult {
  sceneKey: string;
  sceneId: string;
  /** 0 基行号（块编辑 data-line 同口径） */
  line: number;
  text: string;
  /** Set when only the dialogue's visible text matched, e.g. across style tags. */
  visible?: { text: string; start: number; end: number };
}

/** Speaker prefix and dialogue of a text row; null when the row is not plain `speaker：value`. */
function dialogueParts(line: SceneDocumentLine): { prefix: string; value: string } | null {
  if (line.kind !== 'text' || !line.raw.endsWith(line.value)) return null;
  return { prefix: line.raw.slice(0, line.raw.length - line.value.length), value: line.value };
}

/** The text a player sees on this row, as Core reads it: dialogue, or an option's shown text. */
function shownText(line: SceneDocumentLine): { text: string; context: 'dialogue' | 'choice' } | null {
  const parts = dialogueParts(line);
  if (parts) return { text: parts.value, context: 'dialogue' };
  const span = line.kind === 'choice-option' ? choiceLabelSpan(line.raw) : null;
  return span ? { text: line.raw.slice(span.start, span.end), context: 'choice' } : null;
}

/** 构造匹配器（非法正则返回 null，由 UI 提示） */
export function buildMatcher(query: string, useRegex: boolean): RegExp | null {
  try {
    return useRegex ? new RegExp(query, 'g') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  } catch {
    return null;
  }
}

/** 跨场景搜索：逐行匹配原始行文本；上限 maxResults 条（防止超大结果拖垮 UI）。
 *  匹配器循环外一次构造（M6 审阅轮 Minor 2）；g 标志的 lastIndex 逐行重置防跨行残留 */
export function searchScenes(scenes: Iterable<SceneText>, query: string, useRegex: boolean, maxResults = 500): SearchResult[] {
  if (query.length === 0) return [];
  const re = buildMatcher(query, useRegex);
  if (!re) return [];
  const results: SearchResult[] = [];
  for (const sc of scenes) {
    const lines = parseSceneDocument(sc.text);
    lines.forEach((line, i) => {
      if (results.length >= maxResults) return;
      const text = line.raw;
      re.lastIndex = 0;
      if (re.test(text)) {
        results.push({ sceneKey: sc.key, sceneId: sc.id, line: i, text });
        return;
      }
      // Dialogue and option text are also searched as the player sees them, so a phrase split by style tags is found.
      const shown = shownText(line);
      const visible = shown && findInDialogue(shown.text, re, shown.context);
      if (visible) results.push({ sceneKey: sc.key, sceneId: sc.id, line: i, text, visible: { text: visible.plain, start: visible.start, end: visible.end } });
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

export interface ReplacementPreview {
  text: string;
  count: number;
  /** Matches left alone because they cross or sit inside inline markup. */
  skipped: number;
  changes: { line: number; before: string; after: string; count: number }[];
}

/** Literal replacement on a whole row that never edits inside a tag token; matches touching one are skipped. */
function replaceOutsideTags(raw: string, re: RegExp, replacement: (offset: number) => string, tags: readonly { start: number; end: number }[] | null): { text: string; count: number; skipped: number } {
  let count = 0, skipped = 0;
  re.lastIndex = 0;
  const text = raw.replace(re, (match: string, ...rest: unknown[]) => {
    const offset = rest.find((value) => typeof value === 'number') as number;
    if (tags === null || tags.some((tag) => tag.start < offset + match.length && tag.end > offset)) { skipped++; return match; }
    count++;
    return replacement(offset);
  });
  return { text, count, skipped };
}

/** Preview and application share one replacement pass; row numbers refer to the original source. */
export function previewSceneReplacement(text: string, query: string, replacement: string, useRegex: boolean): ReplacementPreview | null {
  const re = buildMatcher(query, useRegex);
  if (!re) return null;
  if (!query) return { text, count: 0, skipped: 0, changes: [] };
  let count = 0, skipped = 0;
  const changes: ReplacementPreview['changes'] = [];
  const next = parseSceneDocument(text).map((line, index) => {
    let after = line.raw, rowCount = 0;
    const parts = dialogueParts(line);
    const literal = (): string => replacement;
    if (parts && (parseInlineText(parts.value).hasMarkup || parts.value.includes('\\'))) {
      // Styled dialogue is replaced on its visible text; the speaker name stays plain text.
      const speaker = replaceOutsideTags(parts.prefix, re, literal, []);
      const dialogue = replaceInDialogue(parts.value, re, replacement);
      after = speaker.text + dialogue.value;
      rowCount = speaker.count + dialogue.count;
      skipped += dialogue.skipped;
    } else if (parts) {
      // Unstyled rows keep whole-row matching; text written into the dialogue cannot become markup.
      const written = visibleReplacement(replacement);
      const result = replaceOutsideTags(line.raw, re, (offset) => offset >= parts.prefix.length ? written : replacement, []);
      after = result.text; rowCount = result.count;
    } else if (line.kind === 'choice-option') {
      // Only the option's shown text is visible text; the indent, `[if:…]` and the arrow's
      // instructions keep their own meaning and get the replacement as written.
      const span = choiceLabelSpan(line.raw);
      const label = span ? line.raw.slice(span.start, span.end) : '';
      if (span && (parseInlineText(label, 'choice').hasMarkup || label.includes('\\'))) {
        const head = replaceOutsideTags(line.raw.slice(0, span.start), re, literal, []);
        const shown = replaceInDialogue(label, re, replacement, 'choice');
        const tail = replaceOutsideTags(line.raw.slice(span.end), re, literal, []);
        after = head.text + shown.value + tail.text;
        rowCount = head.count + shown.count + tail.count;
        skipped += shown.skipped;
      } else if (span) {
        const written = visibleReplacement(replacement);
        const result = replaceOutsideTags(line.raw, re, (offset) => offset >= span.start && offset < span.end ? written : replacement, []);
        after = result.text; rowCount = result.count;
      } else {
        // Core reads no option text here; markup-like text is left alone rather than guessed at.
        const result = replaceOutsideTags(line.raw, re, literal, containsInlineTag(line.raw) ? null : []);
        after = result.text; rowCount = result.count; skipped += result.skipped;
      }
    } else {
      const result = replaceOutsideTags(line.raw, re, literal, []);
      after = result.text; rowCount = result.count;
    }
    count += rowCount;
    if (after !== line.raw) changes.push({ line: index, before: line.raw, after, count: rowCount });
    return after + line.eol;
  }).join('');
  return { text: next, count, skipped, changes };
}

/** 与查找相同的逐行匹配，保留原行结束符；count=0 时调用方不应写入。 */
export function replaceInSceneText(text: string, query: string, replacement: string, useRegex: boolean): { text: string; count: number } | null {
  const preview = previewSceneReplacement(text, query, replacement, useRegex);
  return preview && { text: preview.text, count: preview.count };
}
