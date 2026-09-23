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
  const fill = (role: Color, opacity: number): void => {
    graphic.fill({ color: theme.colors[role], alpha: opacity }); tokens.push(role);
  };
  const stroke = (role: Color, opacity: number, width = 1): void => {
    graphic.stroke({ color: theme.colors[role], alpha: opacity, width, alignment: 1 }); tokens.push(role);
  };
  graphic.roundRect(x, y, width, height, Math.min(theme.radius.sm, height / 4));
  fill(color, alpha);
  stroke(active ? 'accent' : 'line', active ? 0.8 : 0.42, active ? 1.5 : 0.8);
  if (ornament) {
    graphic.moveTo(x + 24, y).lineTo(x + Math.min(width - 24, 104), y);
    stroke('line', 0.9, 1.5);
  }
  return bindThemeGraphicsProjection(graphic, tokens);
}

export function drawPlayerDivider(graphic: Graphics, theme: RendererTheme, x: number, y: number, width: number): Graphics {
  graphic.clear().moveTo(x, y).lineTo(x + width, y)
    .stroke({ color: theme.colors.line, alpha: 0.55, width: 0.8 });
  return bindThemeGraphicsProjection(graphic, ['line']);
}
