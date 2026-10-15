/**
 * CJK 断行禁则（M5 支柱4：中文排版基本盘）。
 * 规则：
 *  - 行首禁则：逗号/句号/问号/叹号/后引号/后括号等不出现在行首（收进行尾，允许该行超宽 1~2 字）
 *  - 行尾禁则：前引号/前括号不出现在行尾（推到下一行行首）
 *  - 连续符不拆：……、—— 不被拆到两行
 *  - 软换行无损；显式换行（含空行）单独分段，不占字宽
 * 用于对话框预断行与 Backlog 软换行（替代 Pixi wordWrap / 定长 slice 的裸断行）。
 */

/** 行首禁止出现的字符（断行时收进上一行行尾） */
const NO_LINE_START = new Set([
  '，', '。', '、', '！', '？', '：', '；',
  '）', '】', '》', '」', '』', '〉', '”', '’',
  '…', '—', '～',
  '!', '?', ',', '.', ':', ';', ')', ']', '}',
]);

/** 行尾禁止出现的字符（断行时推到下一行行首） */
const NO_LINE_END = new Set([
  '（', '【', '《', '「', '『', '〈', '“', '‘',
  '(', '[', '{',
]);

/** 连续出现时不可被拆散的连接符 */
const UNBREAKABLE_RUN = new Set(['…', '—']);
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function wordBoundary(units: string[], start: number, end: number): number {
  // Keep ordinary Latin words together; a word wider than a whole line still breaks.
  const latin = /[\p{Script=Latin}\p{Number}]/u;
  if (end >= units.length || !latin.test(units[end - 1]!) || !latin.test(units[end]!)) return end;
  for (let i = end - 1; i > start; i--) if (/\s/u.test(units[i]!)) return i + 1;
  return end;
}

function normalizePerLine(value: number): number {
  if (Number.isNaN(value)) throw new RangeError('perLine 必须是有限数字或 Infinity');
  if (value === Number.POSITIVE_INFINITY) return Number.MAX_SAFE_INTEGER;
  if (value <= 0 || value === Number.NEGATIVE_INFINITY) return 1;
  return Math.max(1, Math.floor(value));
}

function normalizeMaxWidth(value: number): number {
  if (Number.isNaN(value)) throw new RangeError('maxWidth 必须是有限数字或 Infinity');
  if (value === Number.POSITIVE_INFINITY) return Number.MAX_SAFE_INTEGER;
  if (value <= 0 || value === Number.NEGATIVE_INFINITY) return 1;
  return value;
}

/**
 * 按禁则规则把文本折成多行。perLine = 目标每行字数（CJK 按字计；
 * 行首禁则触发的行允许超宽 1~2 字，属排印惯例的"悬挂"形态）。
 */
export function wrapCjk(text: string, perLine: number): string[] {
  if (text.length === 0) return [];
  const width = normalizePerLine(perLine);
  if (/[\r\n]/.test(text)) return text.split(/\r\n?|\n/).flatMap(part => part ? wrapCjk(part, perLine) : ['']);
  const units = Array.from(graphemes.segment(text), item => item.segment);
  const lines: string[] = [];
  let i = 0;
  while (i < units.length) {
    let end = Math.min(i + width, units.length);
    if (end < units.length) {
      // 行尾禁则：连续前引号/前括号全部退让，至少保留一个字素以保证进展。
      if (end > i + 1 && NO_LINE_END.has(units[end - 1]!)) {
        while (end > i + 1 && NO_LINE_END.has(units[end - 1]!)) end -= 1;
      } else {
        // 最多悬挂两字素；过长标点串仍需分行，即使下一行只能以标点开头。
        const hangingLimit = end + 2;
        while (end < units.length && end < hangingLimit && (NO_LINE_START.has(units[end]!)
          || (UNBREAKABLE_RUN.has(units[end]!) && units[end] === units[end - 1]))) {
          end += 1;
        }
      }
    }
    if (end <= i) end = i + 1; // 防御：永不零宽/倒退
    end = wordBoundary(units, i, end);
    lines.push(units.slice(i, end).join(''));
    i = end;
  }
  return lines;
}

/**
 * 像素级断行（wrapCjk 的测量版）：禁则规则完全一致，但每行容量用真实测量宽度
 * （宿主传入 measure，如 canvas measureText）而非字数估算——中英混排/窄 ASCII 段落不再误差。
 * 行首禁则触发的行最多悬挂两字素，与字数版同口径；单字超宽强制前进（防死循环）。
 */
export function wrapCjkMeasure(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (text.length === 0) return [];
  const limit = normalizeMaxWidth(maxWidth);
  if (/[\r\n]/.test(text)) return text.split(/\r\n?|\n/).flatMap(part => part ? wrapCjkMeasure(part, maxWidth, measure) : ['']);
  const units = Array.from(graphemes.segment(text), item => item.segment);
  const lines: string[] = [];
  let i = 0;
  while (i < units.length) {
    // 贪心找最长不超宽前缀（段落短，线性扫描成本可忽略）
    let end = i;
    while (end < units.length) {
      const candidate = units.slice(i, end + 1).join('');
      if (measure(candidate) > limit) break;
      end += 1;
    }
    if (end <= i) end = i + 1; // 单字已超宽：强制至少一字，防死循环
    if (end < units.length) {
      if (end > i + 1 && NO_LINE_END.has(units[end - 1]!)) {
        while (end > i + 1 && NO_LINE_END.has(units[end - 1]!)) end -= 1;
      } else {
        // 按字素而非像素计悬挂余量，长标点串不能无限超宽。
        const hangingLimit = end + 2;
        while (end < units.length && end < hangingLimit && (NO_LINE_START.has(units[end]!)
          || (UNBREAKABLE_RUN.has(units[end]!) && units[end] === units[end - 1]))) {
          end += 1;
        }
      }
    }
    if (end <= i) end = i + 1;
    end = wordBoundary(units, i, end);
    lines.push(units.slice(i, end).join(''));
    i = end;
  }
  return lines;
}

/** The same punctuation/word boundaries for styled graphemes and indivisible ruby groups. */
export function wrapCjkUnits<T>(units: readonly T[], maxWidth: number, text: (unit: T) => string, measure: (units: readonly T[]) => number): T[][] {
  const limit = normalizeMaxWidth(maxWidth);
  const lines: T[][] = [];
  let start = 0;
  for (let boundary = 0; boundary <= units.length; boundary++) {
    if (boundary !== units.length && !/^[\r\n]+$/.test(text(units[boundary]!))) continue;
    const paragraph = units.slice(start, boundary), words = paragraph.map(text);
    if (!paragraph.length) lines.push([]);
    for (let i = 0; i < paragraph.length;) {
      let end = i;
      while (end < paragraph.length && measure(paragraph.slice(i, end + 1)) <= limit) end++;
      if (end <= i) end = i + 1;
      const fitted = end;
      if (end < paragraph.length) {
        if (end > i + 1 && NO_LINE_END.has(words[end - 1]!.at(-1)!)) {
          while (end > i + 1 && NO_LINE_END.has(words[end - 1]!.at(-1)!)) end--;
        }
        else while (end < paragraph.length && (NO_LINE_START.has(words[end]![0]!)
          || UNBREAKABLE_RUN.has(words[end]![0]!) && words[end]![0] === words[end - 1]!.at(-1))) end++;
      }
      // Styled text is clipped to its reading viewport. Move the preceding character
      // with closing punctuation instead of hanging a large glyph outside that mask.
      if (end > fitted && measure(paragraph.slice(i, end)) > limit) {
        end = fitted;
        while (end > i + 1 && (NO_LINE_START.has(words[end]![0]!) || NO_LINE_END.has(words[end - 1]!.at(-1)!)
          || UNBREAKABLE_RUN.has(words[end]![0]!) && words[end]![0] === words[end - 1]!.at(-1))) end--;
        // A punctuation run wider than the whole line has no legal kinsoku
        // boundary. Use the fitted width instead of producing one glyph per row.
        if (end === i + 1 && NO_LINE_START.has(words[end]![0]!)) end = fitted;
      }
      end = wordBoundary(words, i, end);
      lines.push(paragraph.slice(i, end)); i = end;
    }
    start = boundary + 1;
  }
  return lines;
}
