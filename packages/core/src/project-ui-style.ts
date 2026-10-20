import type { ProjectUiNode, ProjectUiRect } from './project-ui.js';
import { resolvePlayerTheme } from './project-theme.js';
import type { PresentationThemeOverrides } from './theme-tokens.js';

export interface ProjectUiInsets { top: number; right: number; bottom: number; left: number }
export interface ProjectUiShadow { x: number; y: number; blur: number; color: number; opacity: number }
export interface ProjectUiBackgroundImage {
  asset: string;
  fit: 'stretch' | 'contain' | 'cover';
  /** Cuts are integer pixels of the intrinsic, orientation-correct source image. */
  slice?: ProjectUiInsets & { fillCenter: boolean };
}
export interface ProjectUiStyle {
  color?: number; background?: number; opacity?: number; backgroundOpacity?: number;
  fontSize?: number; align?: 'left' | 'center' | 'right'; fontRole?: 'body' | 'title' | 'ui';
  fontWeight?: number; lineHeight?: number; letterSpacing?: number;
  textShadows?: ProjectUiShadow[];
  backgroundGradient?: { from: number; to: number; angle: number } | null;
  backgroundImage?: ProjectUiBackgroundImage | null;
  border?: { width: number; color: number; opacity: number } | null;
  borderRadius?: number;
  padding?: ProjectUiInsets;
  shadows?: ProjectUiShadow[];
  /** Content nodes only; absent keeps the single-column layout. */
  columns?: 1 | 2;
  /** Image content only; distinct from decorative backgroundImage.fit. */
  imageFit?: 'contain' | 'cover' | 'fill';
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at} 必须是对象`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], at: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${at}.${key} 不受支持`);
}
function number(value: unknown, min: number, max: number, at: string, integer = false): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${at} 必须是 ${min}..${max} 的${integer ? '整数' : '有限数值'}`);
  }
}
function insets(value: Record<string, unknown>, at: string, integer = false): void {
  for (const key of ['top', 'right', 'bottom', 'left']) number(value[key], 0, 65535, `${at}.${key}`, integer);
}
function shadows(value: unknown, at: string): void {
  if (!Array.isArray(value) || value.length > 4) throw new Error(`${at} 必须是最多四项的阴影数组；空数组表示清空`);
  value.forEach((entry, index) => {
    const item = object(entry, `${at}[${index}]`);
    keys(item, ['x', 'y', 'blur', 'color', 'opacity'], at);
    for (const key of ['x', 'y']) number(item[key], -4096, 4096, `${at}.${key}`);
    number(item.blur, 0, 256, `${at}.blur`);
    number(item.color, 0, 0xffffff, `${at}.color`, true);
    number(item.opacity, 0, 1, `${at}.opacity`);
  });
}

/** Data only: no CSS strings, URLs, callbacks or unbounded effect lists. */
export function validateProjectUiStyle(value: unknown, at: string): void {
  const item = object(value, at);
  keys(item, ['color', 'background', 'opacity', 'backgroundOpacity', 'fontSize', 'align', 'fontRole', 'fontWeight', 'lineHeight',
    'letterSpacing', 'textShadows', 'backgroundGradient', 'backgroundImage', 'border', 'borderRadius', 'padding', 'shadows', 'columns', 'imageFit'], at);
  if (item.columns !== undefined && item.columns !== 1 && item.columns !== 2) throw new Error(`${at}.columns 必须为 1 或 2`);
  if (item.imageFit !== undefined && !['contain', 'cover', 'fill'].includes(item.imageFit as string)) throw new Error(`${at}.imageFit 不受支持`);
  for (const key of ['color', 'background']) if (item[key] !== undefined) number(item[key], 0, 0xffffff, `${at}.${key}`, true);
  if (item.opacity !== undefined) number(item.opacity, 0, 1, `${at}.opacity`);
  if (item.backgroundOpacity !== undefined) number(item.backgroundOpacity, 0, 1, `${at}.backgroundOpacity`);
  if (item.fontSize !== undefined) number(item.fontSize, Number.MIN_VALUE, Number.MAX_VALUE, `${at}.fontSize`);
  if (item.align !== undefined && !['left', 'center', 'right'].includes(String(item.align))) throw new Error(`${at}.align 不受支持`);
  if (item.fontRole !== undefined && !['body', 'title', 'ui'].includes(String(item.fontRole))) throw new Error(`${at}.fontRole 不受支持`);
  if (item.fontWeight !== undefined && ![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(item.fontWeight as number)) throw new Error(`${at}.fontWeight 必须为 100..900 的整百字重`);
  if (item.lineHeight !== undefined) number(item.lineHeight, 0.5, 4, `${at}.lineHeight`);
  if (item.letterSpacing !== undefined) number(item.letterSpacing, -32, 128, `${at}.letterSpacing`);
  if (item.borderRadius !== undefined) number(item.borderRadius, 0, 65535, `${at}.borderRadius`);
  if (item.padding !== undefined) {
    const padding = object(item.padding, `${at}.padding`);
    keys(padding, ['top', 'right', 'bottom', 'left'], `${at}.padding`); insets(padding, `${at}.padding`);
  }
  for (const key of ['textShadows', 'shadows']) if (item[key] !== undefined) shadows(item[key], `${at}.${key}`);
  if (item.border !== undefined && item.border !== null) {
    const border = object(item.border, `${at}.border`);
    keys(border, ['width', 'color', 'opacity'], `${at}.border`);
    number(border.width, 0, 256, `${at}.border.width`); number(border.color, 0, 0xffffff, `${at}.border.color`, true); number(border.opacity, 0, 1, `${at}.border.opacity`);
  }
  if (item.backgroundGradient !== undefined && item.backgroundGradient !== null) {
    const gradient = object(item.backgroundGradient, `${at}.backgroundGradient`);
    keys(gradient, ['from', 'to', 'angle'], `${at}.backgroundGradient`);
    number(gradient.from, 0, 0xffffff, `${at}.backgroundGradient.from`, true);
    number(gradient.to, 0, 0xffffff, `${at}.backgroundGradient.to`, true);
    number(gradient.angle, 0, 360, `${at}.backgroundGradient.angle`);
  }
  if (item.backgroundImage !== undefined && item.backgroundImage !== null) {
    const image = object(item.backgroundImage, `${at}.backgroundImage`);
    keys(image, ['asset', 'fit', 'slice'], `${at}.backgroundImage`);
    if (typeof image.asset !== 'string' || !image.asset.trim() || /[\\/:\u0000-\u001f\u007f]/.test(image.asset)) throw new Error(`${at}.backgroundImage.asset 必须是项目背景素材键`);
    if (!['stretch', 'contain', 'cover'].includes(String(image.fit))) throw new Error(`${at}.backgroundImage.fit 不受支持`);
    if (image.slice !== undefined) {
      if (image.fit !== 'stretch') throw new Error(`${at}.backgroundImage.slice 只适用于 stretch`);
      const slice = object(image.slice, `${at}.backgroundImage.slice`);
      keys(slice, ['top', 'right', 'bottom', 'left', 'fillCenter'], `${at}.backgroundImage.slice`);
      insets(slice, `${at}.backgroundImage.slice`, true);
      if (typeof slice.fillCenter !== 'boolean') throw new Error(`${at}.backgroundImage.slice.fillCenter 必须是布尔值`);
    }
  }
}

/** A null font weight/line height/padding means the existing native-control default, not zero. */
export function resolveProjectUiStyle(node: ProjectUiNode, config: Record<string, unknown>, explicit: PresentationThemeOverrides = {}) {
  const theme = resolvePlayerTheme(config, explicit), style = node.style ?? {}, button = node.type === 'button', progress = node.type === 'progress';
  return {
    color: style.color ?? theme.colors.text, background: style.background ?? (button || progress ? theme.colors.surface : null), opacity: style.opacity ?? 1,
    backgroundOpacity: style.backgroundOpacity ?? 1,
    fontSize: style.fontSize ?? theme.typography.uiSize, fontRole: style.fontRole ?? 'ui', align: style.align ?? 'left',
    fontWeight: style.fontWeight ?? (button ? 600 : null), lineHeight: style.lineHeight ?? (node.type === 'text' ? 1.45 : null),
    letterSpacing: style.letterSpacing ?? 0, textShadows: style.textShadows ?? [],
    backgroundGradient: style.backgroundGradient ?? null,
    backgroundImage: style.backgroundImage === undefined ? (button && theme.skins.buttonSkin ? { asset: theme.skins.buttonSkin, fit: 'stretch' as const } : null) : style.backgroundImage,
    border: style.border === undefined ? (button ? { width: 1, color: theme.colors.line, opacity: 1 } : null) : style.border,
    borderRadius: style.borderRadius ?? (button ? theme.radius.md : progress ? theme.radius.sm : 0), padding: style.padding ?? null, shadows: style.shadows ?? [],
  };
}

/** Explicit author insets inside the layout/hit box. Decoration never enlarges the hit box. */
export function projectUiContentRect(rect: ProjectUiRect, style?: ProjectUiStyle): ProjectUiRect {
  if (!style?.border && !style?.padding) return rect;
  const border = style?.border?.width ?? 0, padding = style?.padding;
  const left = border + (padding?.left ?? 0), right = border + (padding?.right ?? 0);
  const top = border + (padding?.top ?? 0), bottom = border + (padding?.bottom ?? 0);
  if (left + right >= rect.width || top + bottom >= rect.height) throw new Error('UI 边框和内边距必须留出正的内容空间');
  return { x: rect.x + left, y: rect.y + top, width: rect.width - left - right, height: rect.height - top - bottom };
}

/** Caller supplies dimensions read from the actual asset, never dimensions claimed by config. */
export function projectUiNineSlice(source: { width: number; height: number }, target: ProjectUiRect, slice: NonNullable<ProjectUiBackgroundImage['slice']>) {
  number(source.width, 1, Number.MAX_SAFE_INTEGER, '九宫格原图宽度', true);
  number(source.height, 1, Number.MAX_SAFE_INTEGER, '九宫格原图高度', true);
  insets(slice as unknown as Record<string, unknown>, '九宫格切片', true);
  if (slice.left + slice.right >= source.width || slice.top + slice.bottom >= source.height) throw new Error('九宫格切片超出原图尺寸或没有中心区域');
  number(target.width, Number.MIN_VALUE, Number.MAX_VALUE, '九宫格目标宽度');
  number(target.height, Number.MIN_VALUE, Number.MAX_VALUE, '九宫格目标高度');
  const scale = Math.min(1, target.width / (slice.left + slice.right || 1), target.height / (slice.top + slice.bottom || 1));
  const sx = [0, slice.left, source.width - slice.right, source.width], sy = [0, slice.top, source.height - slice.bottom, source.height];
  const dx = [target.x, target.x + slice.left * scale, target.x + target.width - slice.right * scale, target.x + target.width];
  const dy = [target.y, target.y + slice.top * scale, target.y + target.height - slice.bottom * scale, target.y + target.height];
  const patches: Array<{ source: ProjectUiRect; target: ProjectUiRect }> = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    if (row === 1 && col === 1 && !slice.fillCenter) continue;
    patches.push({ source: { x: sx[col]!, y: sy[row]!, width: sx[col + 1]! - sx[col]!, height: sy[row + 1]! - sy[row]! },
      target: { x: dx[col]!, y: dy[row]!, width: Math.max(0, dx[col + 1]! - dx[col]!), height: Math.max(0, dy[row + 1]! - dy[row]!) } });
  }
  return patches;
}
