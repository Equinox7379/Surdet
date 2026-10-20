/** Fixed, non-HTML dialogue markup. Offsets are UTF-16 source offsets, end exclusive. */
export type InlineTextContext = 'dialogue' | 'choice' | 'speaker';
export type InlineColor = 'text' | 'textMuted' | 'accent' | 'accentSoft' | 'danger' | `#${string}`;
export interface InlineStyle { bold?: boolean; italic?: boolean; color?: InlineColor; size?: number; speed?: number; emphasis?: boolean; effect?: 'shake' | 'wave' }
export interface InlineUnit { text: string; start: number; end: number; style: InlineStyle; ruby?: string }
export interface InlineControl { kind: 'pause' | 'wait' | 'no-wait'; at: number; durationMs?: number; start: number; end: number }
export interface InlineTagSpan { name: string; closing: boolean; start: number; end: number; value?: string }
export interface InlineTextIssue { code: 'M001' | 'M002' | 'M003' | 'M004' | 'M005' | 'M006'; severity: 'error' | 'warning'; message: string; start: number; end: number }
export interface InlineTextDocument {
  source: string;
  units: InlineUnit[];
  controls: InlineControl[];
  plainText: string;
  issues: InlineTextIssue[];
  tags: InlineTagSpan[];
  /** Known markup was encountered, including invalid markup retained as literal text. */
  hasMarkup: boolean;
}

export const INLINE_TEXT_TAGS = [
  { name: 'b', paired: true, value: null, label: '粗体', example: '<b>重点</b>' },
  { name: 'i', paired: true, value: null, label: '斜体', example: '<i>轻声</i>' },
  { name: 'color', paired: true, value: 'color', label: '文字颜色', example: '<color=accent>重点</color>' },
  { name: 'size', paired: true, value: '0.5–2', label: '相对字号', example: '<size=0.8>轻声</size>' },
  { name: 'speed', paired: true, value: '0.1–10', label: '打字速度倍率', example: '<speed=0.5>慢慢说</speed>' },
  { name: 'w', paired: false, value: '1–10000 ms / omitted', label: '停顿或等待点击', example: '等一下<w=500>……<w>继续' },
  { name: 'ruby', paired: true, value: 'reading', label: '注音', example: '<ruby=せかい>世界</ruby>' },
  { name: 'em', paired: true, value: null, label: '着重号', example: '<em>重点</em>' },
  { name: 'shake', paired: true, value: null, label: '逐字抖动', example: '<shake>震惊</shake>' },
  { name: 'wave', paired: true, value: null, label: '逐字波浪', example: '<wave>轻声</wave>' },
  { name: 'nw', paired: false, value: null, label: '句末自动继续', example: '不用等我。<nw>' },
] as const;

type TagName = typeof INLINE_TEXT_TAGS[number]['name'];
const names = new Set<string>(INLINE_TEXT_TAGS.map(tag => tag.name));
const colors = new Set(['text', 'textMuted', 'accent', 'accentSoft', 'danger']);
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const tagPattern = /^<(\/?)([a-z][a-z0-9]*)(?:=([^<>]*))?>/;

export function escapeInlineText(value: string): string { return value.replace(/\\/g, '\\\\').replace(/</g, '\\<'); }

/** Used by the DSL's one speaker splitter; escaped tags remain ordinary author text. */
export function containsInlineTag(value: string): boolean {
  for (let at = 0; at < value.length; at++) {
    if (value[at] === '\\' && (value[at + 1] === '<' || value[at + 1] === '\\')) { at++; continue; }
    if (value[at] === '<') { const token = tagPattern.exec(value.slice(at)); if (token && names.has(token[2]!)) return true; }
  }
  return false;
}

function literalUnits(source: string, offset: number, style: InlineStyle): InlineUnit[] {
  let text = '';
  const positions: { start: number; end: number }[] = [];
  for (let i = 0; i < source.length; i++) {
    const start = i;
    if (source[i] === '\\' && (source[i + 1] === '<' || source[i + 1] === '\\' || source[i + 1] === ':' || source[i + 1] === '：')) i++;
    text += source[i]; positions.push({ start: offset + start, end: offset + i + 1 });
  }
  return Array.from(segmenter.segment(text), ({ segment, index }) => ({
    text: segment, start: positions[index]!.start, end: positions[index + segment.length - 1]!.end, style,
  }));
}

/** Invalid known markup is displayed literally as a whole line, with no timing side effects. */
export function parseInlineText(source: string, context: InlineTextContext = 'dialogue'): InlineTextDocument {
  let units: InlineUnit[] = [], controls: InlineControl[] = [];
  const issues: InlineTextIssue[] = [];
  let tags: InlineTagSpan[] = [];
  let style: InlineStyle = {}, hasMarkup = false, literalStart = 0;
  const stack: { name: TagName; style: InlineStyle; start: number; end: number }[] = [];
  const issue = (code: InlineTextIssue['code'], message: string, start: number, end: number): void => {
    issues.push({ code, message, start, end, severity: code === 'M001' ? 'warning' : 'error' });
  };
  const flush = (end: number): void => { units.push(...literalUnits(source.slice(literalStart, end), literalStart, style)); };
  for (let at = 0; at < source.length;) {
    if (source[at] === '\\' && (source[at + 1] === '<' || source[at + 1] === '\\')) { at += 2; continue; }
    const token = source[at] === '<' ? tagPattern.exec(source.slice(at)) : null;
    if (!token) {
      const partial = source[at] === '<' ? /^<\/?([a-z][a-z0-9]*)(?=[=\s]|$)/.exec(source.slice(at)) : null;
      if (partial && names.has(partial[1]!)) { hasMarkup = true; issue('M004', '行内标签缺少 > 或取值格式非法', at, source.length); }
      at++; continue;
    }
    const [raw, closing, rawName, value] = token;
    const end = at + raw.length;
    if (!names.has(rawName!)) { issue('M001', `未知行内标签 <${rawName}>，按原文显示；可用标签：${INLINE_TEXT_TAGS.map(tag => tag.name).join('、')}`, at, end); at = end; continue; }
    const name = rawName as TagName;
    hasMarkup = true;
    if (context === 'speaker' || context === 'choice' && ['w', 'speed', 'nw', 'shake', 'wave'].includes(name)) {
      issue('M005', context === 'speaker' ? '说话人不支持行内标签' : '选项文案不支持停顿、变速、自动继续或逐字动画标签', at, end); at = end; continue;
    }
    if (closing) {
      if (value !== undefined || name === 'w' || name === 'nw' || stack.at(-1)?.name !== name) {
        issue('M003', `</${name}> 没有对应的开标签或闭合顺序不正确`, at, end); at = end; continue;
      }
      tags.push({ name, closing: true, start: at, end });
      flush(at); style = stack.pop()!.style; at = literalStart = end; continue;
    }
    const number = value !== undefined && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? Number(value) : NaN;
    const valid = (value === undefined || value.length >= 1 && value.length <= 32 && !/[\s<>：:{}]/u.test(value)) && (
      ['b', 'i', 'em', 'shake', 'wave', 'nw'].includes(name) ? value === undefined
        : name === 'w' ? value === undefined || Number.isInteger(number) && number >= 1 && number <= 10000
          : name === 'size' ? number >= 0.5 && number <= 2
            : name === 'speed' ? number >= 0.1 && number <= 10
              : name === 'color' ? value !== undefined && (colors.has(value) || /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value))
                : value !== undefined);
    if (!valid) { issue('M004', `<${name}> 的取值非法或含变量；请按标签说明填写`, at, end); at = end; continue; }
    tags.push({ name, closing: false, start: at, end, ...(value === undefined ? {} : { value }) });
    flush(at);
    if (name === 'nw') {
      if (source.slice(end).trim() !== '' || stack.length) issue('M006', '<nw> 必须放在句末、所有成对标签之外', at, end);
      controls.push({ kind: 'no-wait', at: units.length, start: at, end });
    } else if (name === 'w') {
      controls.push({ kind: value === undefined ? 'wait' : 'pause', at: units.length, ...(value === undefined ? {} : { durationMs: number }), start: at, end });
    } else if (name === 'ruby') {
      let close = source.indexOf('</ruby>', end);
      while (close >= 0) {
        let slashes = 0;
        for (let index = close - 1; source[index] === '\\'; index--) slashes++;
        if (slashes % 2 === 0) break;
        close = source.indexOf('</ruby>', close + 7);
      }
      if (close < 0) { issue('M002', '<ruby> 缺少 </ruby>', at, end); at = literalStart = end; continue; }
      const inner = source.slice(end, close);
      const base = literalUnits(inner, end, style);
      if (!base.length || /[\r\n]/.test(inner) || containsInlineTag(inner)) issue('M004', '注音需要同一行的主文字，主文字内不嵌入其他标签；样式请放在 ruby 外层', at, close + 7);
      units.push({ text: base.map(unit => unit.text).join(''), ruby: value!, style, start: at, end: close + 7 });
      tags.push({ name, closing: true, start: close, end: close + 7 });
      at = literalStart = close + 7; continue;
    } else {
      stack.push({ name, style, start: at, end });
      style = { ...style, ...(name === 'b' ? { bold: true } : name === 'i' ? { italic: true } : name === 'em' ? { emphasis: true }
        : name === 'shake' || name === 'wave' ? { effect: name }
        : name === 'color' ? { color: value as InlineColor } : name === 'size' ? { size: number } : { speed: number }) };
    }
    at = literalStart = end;
  }
  flush(source.length);
  for (const frame of stack) issue('M002', `<${frame.name}> 缺少 </${frame.name}>`, frame.start, frame.end);
  if (issues.some(entry => entry.severity === 'error')) { units = literalUnits(source, 0, {}); controls = []; tags = []; }
  return { source, units, controls, tags, plainText: units.map(unit => unit.text).join(''), issues, hasMarkup };
}

export function inlinePlainText(source: string, context: InlineTextContext = 'dialogue'): string { return parseInlineText(source, context).plainText; }
/** Styled history/NVL keeps visible formatting but never replays timing or animation. */
export function inlineStaticText(source: string): string {
  const document = parseInlineText(source);
  if (document.issues.some(issue => issue.severity === 'error')) return escapeInlineText(document.plainText);
  let output = '', at = 0;
  for (const tag of document.tags) if (['w', 'nw', 'speed', 'shake', 'wave'].includes(tag.name)) {
    output += source.slice(at, tag.start); at = tag.end;
  }
  return output + source.slice(at);
}
/** Counts visible graphemes; a ruby group's base letters still contribute their visible count. */
export function inlineTextLength(source: string, context: InlineTextContext = 'dialogue'): number {
  return textGraphemeCount(inlinePlainText(source, context));
}
export function textGraphemeCount(text: string): number { return Array.from(segmenter.segment(text)).length; }

/** Variable substitution shared by plain speaker names and the literal parts of marked text. */
export function substituteTextVariables(source: string, read: (name: string) => unknown, has: (name: string) => boolean): string {
  return source.replace(/\{\{|\}\}|\{([\p{L}_][\p{L}0-9_$.]*)\}/gu, (match, name: string | undefined) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    return has(name!) ? String(read(name!)) : `{${name}}`;
  });
}

/** Parse the template first: even `<{tag}>` cannot become executable markup after substitution. */
export function interpolateInlineText(source: string, read: (name: string) => unknown, has: (name: string) => boolean, context: InlineTextContext = 'dialogue'): string {
  const document = parseInlineText(source, context);
  const literal = (text: string): string => escapeInlineText(substituteTextVariables(literalUnits(text, 0, {}).map(unit => unit.text).join(''), read, has));
  let at = 0, output = '';
  for (const tag of document.tags) { output += literal(source.slice(at, tag.start)) + source.slice(tag.start, tag.end); at = tag.end; }
  return output + literal(source.slice(at));
}
