import { Container, Graphics, Text as PText } from 'pixi.js';
import type { RendererTheme } from './theme.js';

type ThemeColorKey = keyof RendererTheme['colors'];
type ThemeTypographyKey = keyof RendererTheme['typography'];

export interface ThemeTextProjectionBinding {
  /** `null` marks an explicit gameplay/legacy color that must not be remapped. */
  readonly fill?: ThemeColorKey | null;
  readonly stroke?: ThemeColorKey | null;
  readonly fontSize?: ThemeTypographyKey;
  readonly letterSpacing?: ThemeTypographyKey;
}

export interface LayerThemeProjectionSnapshot {
  readonly visibleTextFills: readonly number[];
  readonly visibleGraphicsColors: readonly number[];
}

const LEGACY_THEME_COLORS: ReadonlyMap<number, ThemeColorKey> = new Map([
  [0x020409, 'canvas'],
  [0x060a14, 'canvas'],
  [0x02060d, 'scrim'],
  [0x05050a, 'scrim'],
  [0x081321, 'surface'],
  [0x0d1526, 'panel'],
  [0x0b1928, 'surfaceStrong'],
  [0x79d5e6, 'accentSoft'],
  [0x5d86a6, 'line'],
  [0x7ba5bd, 'line'],
  [0x83b4c5, 'accentSoft'],
  [0x8a9ab5, 'textMuted'],
  [0x8a93a8, 'textMuted'],
  [0x8aa2b5, 'textMuted'],
  [0x8ba4b9, 'textMuted'],
  [0x7692a8, 'textMuted'],
  [0x54748d, 'line'],
  [0x526b7c, 'textDisabled'],
  [0x5b7182, 'textDisabled'],
  [0xdde9f4, 'text'],
  [0x55555f, 'textDisabled'],
  [0x5a6478, 'textDisabled'],
  [0x596274, 'textDisabled'],
  [0xf1f7ff, 'text'],
  [0xeaf2fb, 'text'],
  [0xf2f6ff, 'text'],
  [0xffffff, 'text'],
  [0xdddddd, 'text'],
  [0x1a1a26, 'surfaceStrong'],
  [0x141c2e, 'surface'],
  [0x1e1e2c, 'surfaceStrong'],
  [0x14141a, 'surface'],
]);

const TEXT_BINDINGS = new WeakMap<PText, ThemeTextProjectionBinding>();
const GRAPHICS_BINDINGS = new WeakMap<Graphics, readonly (ThemeColorKey | null)[]>();

/**
 * Associates the semantic roles of an existing text object with the object,
 * rather than recovering them from its current numeric values.  The binding
 * is renderer-internal and is never returned by a public query.
 */
export function bindThemeTextProjection<T extends PText>(
  text: T,
  binding: ThemeTextProjectionBinding,
): T {
  TEXT_BINDINGS.set(text, Object.freeze({ ...binding }));
  return text;
}

/**
 * Associates the color-bearing Graphics instructions, in instruction order,
 * with semantic roles. `null` explicitly marks a gameplay/legacy color that
 * must not be interpreted as a Player UI theme token.
 */
export function bindThemeGraphicsProjection<T extends Graphics>(
  graphics: T,
  tokens: readonly (ThemeColorKey | null)[],
): T {
  GRAPHICS_BINDINGS.set(graphics, Object.freeze([...tokens]));
  return graphics;
}

function mapLegacyThemeColor(color: number, previous: RendererTheme, next: RendererTheme): number {
  const currentEntries = Object.entries(previous.colors) as Array<[ThemeColorKey, number]>;
  const currentToken = currentEntries.find(([, value]) => value === color)?.[0]
    ?? LEGACY_THEME_COLORS.get(color);
  return currentToken ? next.colors[currentToken] : color;
}

function mapLegacyThemeNumber(value: number, previous: RendererTheme, next: RendererTheme): number {
  const groups: Array<readonly [number, number]> = [
    [previous.typography.titleSize, next.typography.titleSize],
    [previous.typography.headingSize, next.typography.headingSize],
    [previous.typography.bodySize, next.typography.bodySize],
    [previous.typography.uiSize, next.typography.uiSize],
    [previous.typography.captionSize, next.typography.captionSize],
    [previous.typography.titleLetterSpacing, next.typography.titleLetterSpacing],
    [previous.typography.uiLetterSpacing, next.typography.uiLetterSpacing],
  ];
  return groups.find(([from]) => from === value)?.[1] ?? value;
}

function repaintText(text: PText, previous: RendererTheme, next: RendererTheme): void {
  const binding = TEXT_BINDINGS.get(text);
  if (typeof text.style.fill === 'number') {
    text.style.fill = binding?.fill === null
      ? text.style.fill
      : binding?.fill
        ? next.colors[binding.fill]
        : mapLegacyThemeColor(text.style.fill, previous, next);
  }
  if (typeof text.style.fontSize === 'number') {
    text.style.fontSize = binding?.fontSize
      ? next.typography[binding.fontSize]
      : mapLegacyThemeNumber(text.style.fontSize, previous, next);
  }
  if (typeof text.style.letterSpacing === 'number') {
    text.style.letterSpacing = binding?.letterSpacing
      ? next.typography[binding.letterSpacing]
      : mapLegacyThemeNumber(text.style.letterSpacing, previous, next);
  }
  const stroke = text.style.stroke;
  if (typeof stroke === 'number') {
    text.style.stroke = binding?.stroke === null
      ? stroke
      : binding?.stroke
        ? next.colors[binding.stroke]
        : mapLegacyThemeColor(stroke, previous, next);
  } else if (stroke && typeof stroke === 'object' && 'color' in stroke && typeof stroke.color === 'number') {
    text.style.stroke = {
      ...stroke,
      color: binding?.stroke === null
        ? stroke.color
        : binding?.stroke
          ? next.colors[binding.stroke]
          : mapLegacyThemeColor(stroke.color, previous, next),
    };
  }
}

function repaintGraphics(graphics: Graphics, previous: RendererTheme, next: RendererTheme): void {
  const context = graphics.context.clone();
  const bindings = GRAPHICS_BINDINGS.get(graphics);
  let colorIndex = 0;
  let changed = false;
  for (const instruction of context.instructions) {
    if (!('data' in instruction) || typeof instruction.data !== 'object' || instruction.data === null) continue;
    const data = instruction.data as { style?: unknown };
    if (typeof data.style !== 'object' || data.style === null || !('color' in data.style)) continue;
    const style = data.style as { color?: unknown };
    if (typeof style.color !== 'number') continue;
    const token = bindings?.[colorIndex];
    const color = token === null
      ? style.color
      : token
        ? next.colors[token]
        : mapLegacyThemeColor(style.color, previous, next);
    colorIndex += 1;
    if (color === style.color) continue;
    style.color = color;
    changed = true;
  }
  if (changed) graphics.context = context;
}

function hasColoredText(text: PText): boolean {
  if (typeof text.style.fill === 'number') return true;
  const stroke = text.style.stroke;
  return typeof stroke === 'number'
    || (typeof stroke === 'object' && stroke !== null && 'color' in stroke && typeof stroke.color === 'number');
}

/**
 * Fails closed when a color-bearing player-layer object was created without an
 * explicit semantic binding. Fixed gameplay/legacy colors must use a `null`
 * binding so they remain intentionally outside the theme token set.
 */
export function assertThemeProjectionBindings(...roots: readonly Container[]): void {
  const missing: string[] = [];
  const visit = (node: Container): void => {
    if (node instanceof PText && hasColoredText(node) && !TEXT_BINDINGS.has(node)) {
      missing.push(`PText:${node.text.slice(0, 40)}`);
    }
    if (node instanceof Graphics && graphicsColors(node).length > 0 && !GRAPHICS_BINDINGS.has(node)) {
      missing.push('Graphics');
    }
    for (const child of node.children) {
      if (child instanceof Container) visit(child);
    }
  };
  for (const root of roots) visit(root);
  if (missing.length > 0) {
    throw new Error(`Renderer theme projection binding audit failed: ${missing.join(', ')}`);
  }
}

/**
 * Repaints already-mounted Player UI display objects without replacing their
 * containers, listeners, textures, or lifecycle ownership.
 */
export function repaintThemeProjection(
  root: Container,
  previous: RendererTheme,
  next: RendererTheme,
): void {
  assertThemeProjectionBindings(root);
  const visit = (node: Container): void => {
    if (node instanceof PText) repaintText(node, previous, next);
    if (node instanceof Graphics) repaintGraphics(node, previous, next);
    for (const child of node.children) {
      if (child instanceof Container) visit(child);
    }
  };
  visit(root);
}

/** Read-only semantic evidence derived from the currently visible Pixi tree. */
export function readThemeProjection(
  ...roots: readonly Container[]
): LayerThemeProjectionSnapshot {
  const visibleTextFills: number[] = [];
  const visibleGraphicsColors: number[] = [];
  const visit = (node: Container, parentVisible: boolean): void => {
    const visible = parentVisible && node.visible;
    if (!visible) return;
    if (node instanceof PText && typeof node.style.fill === 'number') {
      visibleTextFills.push(node.style.fill);
    }
    if (node instanceof Graphics) visibleGraphicsColors.push(...graphicsColors(node));
    for (const child of node.children) {
      if (child instanceof Container) visit(child, visible);
    }
  };
  for (const root of roots) visit(root, true);
  return Object.freeze({
    visibleTextFills: Object.freeze(visibleTextFills),
    visibleGraphicsColors: Object.freeze(visibleGraphicsColors),
  });
}

function graphicsColors(graphics: Graphics): number[] {
  return graphics.context.instructions.flatMap((instruction) => {
    if (!('data' in instruction) || typeof instruction.data !== 'object' || instruction.data === null) return [];
    const data = instruction.data as { style?: unknown };
    if (typeof data.style !== 'object' || data.style === null || !('color' in data.style)) return [];
    const color = (data.style as { color?: unknown }).color;
    return typeof color === 'number' ? [color] : [];
  });
}
