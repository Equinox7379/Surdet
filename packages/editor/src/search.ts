/**
 * 跨场景搜索/替换（M6 E5-1）：全文搜索（正则可选），替换走 history 可撤销，
 * 替换后由调用方重新调度校验。
 */
import { parseSceneDocument, type SceneDocumentLine } from '@surdet/authoring';
import { parseInlineText } from '@surdet/core';
import { choiceLabelSpan, findInDialogue, replaceInDialogue, sourceRangeOfPlain } from './v4/inline-markup.js';

export interface SceneText {
  /** 场景 Map key（相对路径） */
  key: string;
  /** 场景 ID（basename） */
  id: string;
  text: string;
}

/**
 * `visible`: only dialogue and option text, as the player sees it (across style tags); replacement
 * writes text, never markup. `source`: every row as written, tags, speakers, instructions,
 * conditions and jumps included; replacement is written as typed.
 */
export type SearchMode = 'visible' | 'source';

export interface SearchResult {
  sceneKey: string;
  sceneId: string;
  /** 0 基行号（块编辑 data-line 同口径） */
  line: number;
  text: string;
  /** In visible mode: the dialogue or option text as the player sees it, the match in it, and whether
   *  the match is not written as one run in the source (it crosses style tags). */
  visible?: { text: string; start: number; end: number; acrossTags: boolean };
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

/** 跨场景搜索：逐行匹配（见 SearchMode）；上限 maxResults 条（防止超大结果拖垮 UI）。
 *  匹配器循环外一次构造（M6 审阅轮 Minor 2）；g 标志的 lastIndex 逐行重置防跨行残留 */
export function searchScenes(scenes: Iterable<SceneText>, query: string, useRegex: boolean, mode: SearchMode, maxResults = 500): SearchResult[] {
  if (query.length === 0) return [];
  const re = buildMatcher(query, useRegex);
  if (!re) return [];
  const results: SearchResult[] = [];
  for (const sc of scenes) {
    const lines = parseSceneDocument(sc.text);
    lines.forEach((line, i) => {
      if (results.length >= maxResults) return;
      const text = line.raw;
      if (mode === 'source') {
        re.lastIndex = 0;
        if (re.test(text)) results.push({ sceneKey: sc.key, sceneId: sc.id, line: i, text });
        return;
      }
      // Dialogue and option text as the player sees it, so a phrase split by style tags is found.
      const shown = shownText(line);
      const visible = shown && findInDialogue(shown.text, re, shown.context);
      if (!shown || !visible) return;
      const parsed = parseInlineText(shown.text, shown.context);
      const range = sourceRangeOfPlain(parsed, visible.start, visible.end);
      const acrossTags = range === null || parsed.tags.some((tag) => tag.start < range.end && tag.end > range.start);
      results.push({ sceneKey: sc.key, sceneId: sc.id, line: i, text, visible: { text: visible.plain, start: visible.start, end: visible.end, acrossTags } });
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

export interface ReplacementPreview {
  text: string;
  count: number;
  /** Visible mode: matches left alone because they cross or sit inside inline markup. */
  skipped: number;
  /** Source mode: rows left alone because the replacement would give their dialogue or option text new Core errors. */
  refused: number;
  changes: { line: number; before: string; after: string; count: number }[];
}

/** Literal replacement on a whole row, as typed; `$` in the replacement has no special meaning. */
function replaceRow(raw: string, re: RegExp, replacement: string): { text: string; count: number } {
  let count = 0;
  re.lastIndex = 0;
  const text = raw.replace(re, () => { count++; return replacement; });
  return { text, count };
}

/** Core's errors in a row's shown text (an unknown tag is only shown as text, not an error); none without such text. */
function shownErrors(line: SceneDocumentLine | undefined): number {
  const shown = line ? shownText(line) : null;
  return shown ? parseInlineText(shown.text, shown.context).issues.filter((issue) => issue.severity === 'error').length : 0;
}

/** Preview and application share one replacement pass; row numbers refer to the original source. */
export function previewSceneReplacement(text: string, query: string, replacement: string, useRegex: boolean, mode: SearchMode): ReplacementPreview | null {
  const re = buildMatcher(query, useRegex);
  if (!re) return null;
  if (!query) return { text, count: 0, skipped: 0, refused: 0, changes: [] };
  const lines = parseSceneDocument(text);
  let skipped = 0;
  const rows = lines.map((line) => {
    if (mode === 'source') {
      // As written, on the whole row; whether it keeps the markup valid is checked below.
      const result = replaceRow(line.raw, re, replacement);
      return { after: result.text, count: result.count };
    }
    // Only the text the player sees: a dialogue after its speaker, an option's shown text.
    const parts = dialogueParts(line);
    if (parts) {
      const dialogue = replaceInDialogue(parts.value, re, replacement);
      skipped += dialogue.skipped;
      return { after: parts.prefix + dialogue.value, count: dialogue.count };
    }
    const span = line.kind === 'choice-option' ? choiceLabelSpan(line.raw) : null;
    if (span) {
      const shown = replaceInDialogue(line.raw.slice(span.start, span.end), re, replacement, 'choice');
      skipped += shown.skipped;
      return { after: line.raw.slice(0, span.start) + shown.value + line.raw.slice(span.end), count: shown.count };
    }
    return { after: line.raw, count: 0 };
  });
  let refused = 0;
  if (mode === 'source') {
    // A source edit that gives a dialogue or option text new Core errors (a broken tag) is not made.
    const next = parseSceneDocument(rows.map((row, index) => row.after + lines[index]!.eol).join(''));
    rows.forEach((row, index) => {
      if (row.count === 0 || next.length !== lines.length || shownErrors(next[index]) <= shownErrors(lines[index])) return;
      refused++;
      rows[index] = { after: lines[index]!.raw, count: 0 };
    });
  }
  const changes: ReplacementPreview['changes'] = [];
  rows.forEach((row, index) => {
    if (row.after !== lines[index]!.raw) changes.push({ line: index, before: lines[index]!.raw, after: row.after, count: row.count });
  });
  return {
    text: rows.map((row, index) => row.after + lines[index]!.eol).join(''),
    count: rows.reduce((sum, row) => sum + row.count, 0),
    skipped, refused, changes,
  };
}

/** 与查找相同的逐行匹配，保留原行结束符；count=0 时调用方不应写入。 */
export function replaceInSceneText(text: string, query: string, replacement: string, useRegex: boolean, mode: SearchMode): { text: string; count: number } | null {
  const preview = previewSceneReplacement(text, query, replacement, useRegex, mode);
  return preview && { text: preview.text, count: preview.count };
}
