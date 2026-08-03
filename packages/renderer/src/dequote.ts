/**
 * 引号契约实现：通用指令值在渲染层统一去引号。
 * 表达式语境（@if/@set）的引号由表达式解析器消费，不需要经过这里。
 */
export function dequote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    // 仅当首尾同引号且内部不含同类引号时才剥除，避免 "a"b" 这类成对引号误剥
    if ((first === '"' || first === "'") && first === last && !s.slice(1, -1).includes(first)) {
      return s.slice(1, -1);
    }
  }
  return s;
}
