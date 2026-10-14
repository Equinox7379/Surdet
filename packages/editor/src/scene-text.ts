/**
 * 场景文本纯函数助手（自 flow.ts 拆出，断 panels/sidebar → assets → flow → sidebar 循环依赖，
 * M4 审阅轮 Minor 1 修复）。
 */

import { parseSceneDocument, parseSceneStructure } from '@surdet/authoring';

/** 插在离开当前段落之前；没有跳转或结束时追加。条件块/选项组不拆开。 */
export function appendLineToScene(text: string, eol: string, raw: string): string {
  if (text.length === 0) return raw;
  const lines = parseSceneDocument(text);
  const exit = lines.findIndex(line => line.kind === 'instr'
    && ['end', 'return', 'jump', 'goto', 'choice', 'switch', 'loop'].includes(line.name));
  if (exit >= 0) {
    const structure = parseSceneStructure(text, 'scene.gal', 'scene');
    const enclosing = structure.conditions.filter(block => block.span.startLine <= exit + 1 && block.span.endLine >= exit + 1);
    const before = Math.min(exit, ...enclosing.map(block => block.span.startLine - 1));
    const offset = lines.slice(0, before).reduce((sum, line) => sum + line.raw.length + line.eol.length, 0);
    return text.slice(0, offset) + raw + (lines[before]?.eol || eol) + text.slice(offset);
  }
  return text.endsWith(eol) ? text + raw : text + eol + raw;
}
