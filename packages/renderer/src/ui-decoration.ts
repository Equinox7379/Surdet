import { Graphics } from 'pixi.js';
import type { RendererTheme } from './theme.js';
import { bindThemeGraphicsProjection } from './theme-projection.js';

type Color = keyof RendererTheme['colors'];

/** Shared, resolution-independent trim for the player's dialogue and menus. */
export function drawPlayerFrame(
  graphic: Graphics, theme: RendererTheme, x: number, y: number, width: number, height: number,
  { color = 'panel', alpha = theme.opacity.panel, active = false, ornament = false }: {
    color?: Color; alpha?: number; active?: boolean; ornament?: boolean;
  } = {},
): Graphics {
  graphic.clear();
  if (width <= 0 || height <= 0) return bindThemeGraphicsProjection(graphic, []);
  const tokens: Color[] = [];
  const cut = Math.min(12, height / 5, theme.radius.md + 5);
  const polygon = (inset: number): number[] => {
    const l = x + inset, t = y + inset, r = x + width - inset, b = y + height - inset;
    const c = Math.max(2, cut - inset / 2);
    return [l + c, t, r - c, t, r, t + c, r, b - c, r - c, b, l + c, b, l, b - c, l, t + c];
  };
  const fill = (role: Color, opacity: number): void => {
    graphic.fill({ color: theme.colors[role], alpha: opacity }); tokens.push(role);
  };
  const stroke = (role: Color, opacity: number, width = 1): void => {
    graphic.stroke({ color: theme.colors[role], alpha: opacity, width, alignment: 1 }); tokens.push(role);
  };
  graphic.poly(polygon(0)); fill(color, alpha);
  // A restrained bevel and two oblique highlights echo the Owner's indigo-and-gold artwork.
  graphic.poly([x + cut, y + 2, x + width - cut, y + 2, x + width - cut - 20, y + 22, x + cut + 20, y + 22]);
  fill('surfaceStrong', active ? 0.48 : 0.24);
  graphic.poly([x + cut + 9, y + 5, x + cut + 19, y + 5, x + 5, y + cut + 19, x + 5, y + cut + 9]);
  fill('accentSoft', 0.13);
  const glint = Math.min(cut + 28, height - 9);
  graphic.poly([x + glint, y + 5, x + glint + 4, y + 5, x + 5, y + glint + 4, x + 5, y + glint]);
  fill('accentSoft', 0.08);
  graphic.poly(polygon(0)); stroke(active ? 'accent' : 'line', active ? 0.98 : 0.72, active ? 1.6 : 1);
  graphic.poly(polygon(4)); stroke('accentSoft', active ? 0.5 : 0.24, 0.7);
  graphic.moveTo(x + cut, y + height - 1).lineTo(x + width - cut, y + height - 1);
  stroke('accent', 0.4, 0.8);
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + width, y, -1, 1], [x, y + height, 1, -1], [x + width, y + height, -1, -1]]) {
    graphic.moveTo(cx! + dx! * 3, cy! + dy! * (cut + 10)).lineTo(cx! + dx! * 3, cy! + dy! * cut)
      .lineTo(cx! + dx! * cut, cy! + dy! * 3).lineTo(cx! + dx! * (cut + 10), cy! + dy! * 3);
    stroke('accentSoft', active ? 0.8 : 0.5, 0.8);
  }
  if (ornament) {
    const cx = x + width / 2, cy = y + height - 4;
    graphic.moveTo(cx - Math.min(width * 0.14, 110), cy).lineTo(cx - 9, cy)
      .moveTo(cx + 9, cy).lineTo(cx + Math.min(width * 0.14, 110), cy);
    stroke('accent', 0.7, 0.8);
    graphic.poly([cx, cy - 4, cx + 7, cy, cx, cy + 4, cx - 7, cy]);
    fill('panel', 0.96);
    graphic.poly([cx, cy - 4, cx + 7, cy, cx, cy + 4, cx - 7, cy]);
    stroke('accent', 0.9, 0.8);
  }
  return bindThemeGraphicsProjection(graphic, tokens);
}

export function drawPlayerDivider(graphic: Graphics, theme: RendererTheme, x: number, y: number, width: number): Graphics {
  const center = x + width / 2;
  graphic.clear().moveTo(x, y).lineTo(center - 24, y).moveTo(center + 24, y).lineTo(x + width, y)
    .stroke({ color: theme.colors.line, alpha: 0.55, width: 0.8 });
  for (const offset of [-14, 0, 14]) {
    const size = offset === 0 ? 4 : 2.5;
    graphic.poly([center + offset, y - size, center + offset + size, y, center + offset, y + size, center + offset - size, y])
      .stroke({ color: theme.colors.accent, alpha: 0.85, width: 0.8 });
  }
  return bindThemeGraphicsProjection(graphic, ['line', 'accent', 'accent', 'accent']);
}
