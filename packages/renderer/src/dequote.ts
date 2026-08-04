/**
 * 引号契约实现：通用指令值在渲染层统一去引号。
 * 表达式语境（@if/@set）的引号由表达式解析器消费，不需要经过这里。
 * 支持反斜杠转义：\"…\" 包裹且内部含转义引号时同样剥除外引号并还原转义序列。
 */
export function dequote(s: string): string {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first !== '"' && first !== "'") || first !== last) return s;

  // 扫描确认末位引号是"未转义的闭合引号"（而非 \" 转义序列的一部分），
  // 且闭合前无其他未转义同类引号（避免 "a"b" 这类多段引号误剥）。
  let escaped = false;
  for (let i = 1; i < s.length - 1; i++) {
    const c = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === first) return s; // 中间出现未转义引号：非单一引号值，保持原样
  }
  if (escaped) return s; // 反斜杠悬空（\ 后无字符），保守不剥

  // 剥外引号并还原转义：\x → x（\" → "、\\ → \、\n → n 由表达式语境之外按字面还原）
  return s.slice(1, -1).replace(/\\(.)/g, '$1');
}
