/**
 * CJK 断行禁则（M5 支柱4：中文排版基本盘）。
 * 规则：
 *  - 行首禁则：逗号/句号/问号/叹号/后引号/后括号等不出现在行首（收进行尾，允许该行超宽 1~2 字）
 *  - 行尾禁则：前引号/前括号不出现在行尾（推到下一行行首）
 *  - 连续符不拆：……、—— 不被拆到两行
 *  - 无损往返：所有行拼接后等于原文（不丢字、不改字）
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

/**
 * 按禁则规则把文本折成多行。perLine = 目标每行字数（CJK 按字计；
 * 行首禁则触发的行允许超宽 1~2 字，属排印惯例的"悬挂"形态）。
 */
export function wrapCjk(text: string, perLine: number): string[] {
  if (text.length === 0) return [];
  const width = Math.max(1, Math.floor(perLine));
  const lines: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + width, text.length);
    if (end < text.length) {
      // 行尾禁则：当前行末字不可收尾 → 断点前移一字（该字随下一行）
      if (end > i + 1 && NO_LINE_END.has(text[end - 1]!)) {
        end -= 1;
      } else {
        // 行首禁则：下一行首字不可开头 → 断点后移，把禁则字收进当前行
        // （连续禁则字/连续符一并收入，如 "……，"）
        while (end < text.length && (NO_LINE_START.has(text[end]!)
          || (UNBREAKABLE_RUN.has(text[end]!) && text[end] === text[end - 1]))) {
          end += 1;
        }
      }
    }
    if (end <= i) end = i + 1; // 防御：永不零宽/倒退
    lines.push(text.slice(i, end));
    i = end;
  }
  return lines;
}
