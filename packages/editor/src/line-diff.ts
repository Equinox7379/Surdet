/** Lines as the history comparison numbers them; a final line break adds no empty row. */
export function textLines(value: string): string[] {
  return value.replace(/(?:\r\n|\n|\r)$/, '').split(/\r\n|\n|\r/);
}

const LCS_CELL_LIMIT = 4_000_000;

/**
 * Marks the lines of each side that are outside a longest common subsequence,
 * so swapped, moved or repeated lines count by position rather than by how
 * often their text occurs. Past the size limit the whole differing middle is
 * marked: more marks, never a missed change.
 */
export function changedLines(left: readonly string[], right: readonly string[]): { left: boolean[]; right: boolean[] } {
  const marks = { left: left.map(() => true), right: right.map(() => true) };
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) {
    marks.left[start] = marks.right[start] = false;
    start += 1;
  }
  let endLeft = left.length, endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft -= 1; endRight -= 1;
    marks.left[endLeft] = marks.right[endRight] = false;
  }
  const rows = endLeft - start, columns = endRight - start;
  if (rows === 0 || columns === 0 || (rows + 1) * (columns + 1) > LCS_CELL_LIMIT) return marks;
  const width = columns + 1;
  const table = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i * width + j] = left[start + i] === right[start + j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  for (let i = 0, j = 0; i < rows && j < columns;) {
    if (left[start + i] === right[start + j]) {
      marks.left[start + i] = marks.right[start + j] = false;
      i += 1; j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i += 1;
    else j += 1;
  }
  return marks;
}
