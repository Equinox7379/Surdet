import type { SourceRange } from '@surdet/core';
/**
 * Textarea offsets for a diagnostic range: 1-based lines and UTF-16 columns,
 * end exclusive, the same physical rows as the source view. A range that does
 * not start on the located row or falls outside the text is not used.
 */
export function sourceRangeOffsets(
  rows: readonly { raw: string }[],
  rowStart: (row: number) => number,
  index: number,
  range: SourceRange,
): { start: number; end: number } | null {
  const first = rows[range.start.line - 1], last = rows[range.end.line - 1];
  if (range.start.line - 1 !== index || !first || !last || range.start.col < 1 || range.end.col < 1) return null;
  if (range.start.col - 1 > first.raw.length || range.end.col - 1 > last.raw.length) return null;
  const start = rowStart(range.start.line - 1) + range.start.col - 1;
  const end = rowStart(range.end.line - 1) + range.end.col - 1;
  return end > start ? { start, end } : null;
}

/**
 * Offsets inside the manuscript dialogue box for a one-row diagnostic range. The box edits
 * only the dialogue after `speaker：`, so a range in the speaker prefix or outside it is not used.
 */
export function dialogueRangeOffsets(
  line: { raw: string; value: string },
  index: number,
  range: SourceRange,
): { start: number; end: number } | null {
  if (range.start.line - 1 !== index || range.end.line !== range.start.line || !line.raw.endsWith(line.value)) return null;
  const prefix = line.raw.length - line.value.length;
  const start = range.start.col - 1 - prefix, end = range.end.col - 1 - prefix;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= line.value.length ? { start, end } : null;
}
