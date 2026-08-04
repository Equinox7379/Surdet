/**
 * ruby 注音文本解析：剧本台词中以 基础字《注音》 标注振假名/读音，
 * 例：凛：この世界《せかい》を救う。
 * 解析为分段结构供 PixiStage 渲染（主字 + 上方小字）；Backlog/NVL 用 stripRuby 还原纯文本。
 */

/** 一段文本：base 为主字，ruby 存在时渲染在上方 */
export interface RubySegment {
  base: string;
  ruby?: string;
}

/** 解析 基础字《注音》 标记；未配对的《按字面保留 */
export function parseRuby(text: string): RubySegment[] {
  const out: RubySegment[] = [];
  let rest = text;
  for (;;) {
    const open = rest.indexOf('《');
    if (open < 0) {
      if (rest.length > 0) out.push({ base: rest });
      break;
    }
    const close = rest.indexOf('》', open + 1);
    if (close < 0) {
      // 未配对：其余全部按字面
      out.push({ base: rest });
      break;
    }
    const base = rest.slice(0, open);
    const ruby = rest.slice(open + 1, close);
    if (base.length > 0 || ruby.length > 0) {
      out.push(base.length > 0 ? { base, ruby: ruby.length > 0 ? ruby : undefined } : { base: ruby.length > 0 ? ruby : '' });
    }
    rest = rest.slice(close + 1);
  }
  return out.filter((s) => s.base.length > 0 || s.ruby !== undefined);
}

/** 去除注音标记，仅保留主字（Backlog/NVL 等纯文本场景） */
export function stripRuby(text: string): string {
  return parseRuby(text).map((s) => s.base).join('');
}
