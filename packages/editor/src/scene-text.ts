/**
 * 场景文本纯函数助手（自 flow.ts 拆出，断 panels/sidebar → assets → flow → sidebar 循环依赖，
 * M4 审阅轮 Minor 1 修复）。
 */

/** 场景文本末尾追加行（保持换行风格；文末已有换行则直接追加） */
export function appendLineToScene(text: string, eol: string, raw: string): string {
  if (text.length === 0) return raw;
  return text.endsWith(eol) ? text + raw : text + eol + raw;
}
