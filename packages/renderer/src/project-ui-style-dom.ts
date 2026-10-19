import { projectUiNineSlice, type ProjectUiShadow, type ProjectUiStyle, type resolveProjectUiStyle } from '@surdet/core';

/** Values from Core `resolveProjectUiStyle`; this module never invents its own defaults. */
export type ProjectUiEffectiveStyle = ReturnType<typeof resolveProjectUiStyle>;

/** A loaded project image. `size()` reads the real decoded image, never a size claimed by config. */
export interface ProjectUiDecorImage {
  url: string;
  size(): Promise<{ width: number; height: number }>;
}

export interface ProjectUiDecorOptions {
  /** Converts a design-space pixel length into the host's CSS length (px in Player, cqw in Editor). */
  unit(px: number): string;
  /** null skips the image silently (an inherited theme skin that is not loaded); throw/reject reports it. */
  image(asset: string): ProjectUiDecorImage | null | Promise<ProjectUiDecorImage | null>;
  onError(error: unknown): void;
}

const BOX_KEYS = ['backgroundOpacity', 'backgroundGradient', 'backgroundImage', 'border', 'borderRadius', 'padding', 'shadows'] as const;

/**
 * True when the author set any U1 box field (null and [] count: they are explicit clears).
 * Without one of them a node keeps the exact pre-U1 DOM and CSS.
 */
export function usesProjectUiBox(style: ProjectUiStyle | undefined): boolean {
  return !!style && BOX_KEYS.some(key => style[key] !== undefined);
}

export function projectUiColor(color: number, opacity = 1): string {
  const value = Math.max(0, Math.min(0xffffff, Math.round(color)));
  return `rgba(${value >> 16 & 255}, ${value >> 8 & 255}, ${value & 255}, ${Math.max(0, Math.min(1, opacity))})`;
}

export function projectUiShadowCss(shadows: readonly ProjectUiShadow[], unit: (px: number) => string): string {
  return shadows.length === 0 ? 'none'
    : shadows.map(shadow => `${unit(shadow.x)} ${unit(shadow.y)} ${unit(shadow.blur)} ${projectUiColor(shadow.color, shadow.opacity)}`).join(', ');
}

/** Only fields the author actually set; absent fields keep the control's existing typography. */
export function applyProjectUiTypography(element: HTMLElement, style: ProjectUiStyle | undefined, unit: (px: number) => string): void {
  if (!style) return;
  if (style.fontWeight !== undefined) element.style.fontWeight = String(style.fontWeight);
  if (style.lineHeight !== undefined) element.style.lineHeight = String(style.lineHeight);
  if (style.letterSpacing !== undefined) element.style.letterSpacing = unit(style.letterSpacing);
  if (style.textShadows !== undefined) element.style.textShadow = projectUiShadowCss(style.textShadows, unit);
}

/** Line step for keyboard/wheel scrolling: the real computed line height, not a fixed 1.45. */
export function projectUiLineStep(element: HTMLElement): number {
  const computed = getComputedStyle(element);
  const line = parseFloat(computed.lineHeight);
  return Number.isFinite(line) && line > 0 ? line : parseFloat(computed.fontSize) * 1.45 || 20;
}

/**
 * Background (color → gradient → image, all under backgroundOpacity), border and box shadows of one
 * node, painted in the node's outer layout box. It never takes pointer events or focus, so the hit
 * box stays `projectUiRect` and the content box stays `projectUiContentRect`.
 */
export function createProjectUiDecor(effective: ProjectUiEffectiveStyle, size: { width: number; height: number }, options: ProjectUiDecorOptions): HTMLDivElement {
  const { unit } = options;
  const decor = document.createElement('div');
  decor.dataset.uiDecor = 'true';
  decor.setAttribute('aria-hidden', 'true');
  decor.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:none';
  decor.style.borderRadius = unit(effective.borderRadius);
  decor.style.boxShadow = projectUiShadowCss(effective.shadows, unit);
  const background = document.createElement('div');
  background.dataset.uiDecorBackground = 'true';
  background.style.cssText = 'position:absolute;inset:0;overflow:hidden;border-radius:inherit;pointer-events:none';
  background.style.opacity = String(effective.backgroundOpacity);
  if (effective.background !== null) background.style.backgroundColor = projectUiColor(effective.background);
  const gradient = effective.backgroundGradient;
  if (gradient) background.style.backgroundImage = `linear-gradient(${gradient.angle}deg, ${projectUiColor(gradient.from)}, ${projectUiColor(gradient.to)})`;
  decor.appendChild(background);
  const picture = effective.backgroundImage;
  if (picture) {
    const layer = document.createElement('div');
    layer.dataset.uiDecorImage = picture.slice ? 'nine-slice' : picture.fit;
    layer.style.cssText = 'position:absolute;inset:0;box-sizing:border-box;pointer-events:none;background-repeat:no-repeat';
    background.appendChild(layer);
    void Promise.resolve().then(() => options.image(picture.asset)).then(async image => {
      if (!image) return;
      const url = `url(${JSON.stringify(image.url)})`;
      const slice = picture.slice;
      if (!slice) {
        layer.style.backgroundImage = url;
        layer.style.backgroundSize = picture.fit === 'stretch' ? '100% 100%' : picture.fit;
        layer.style.backgroundPosition = 'center';
        return;
      }
      // Core decides every patch from the real image size; the browser then draws the nine patches in
      // one pass (border-image) so neighbouring patches never show sub-pixel seams after canvas scaling.
      const patches = projectUiNineSlice(await image.size(), { x: 0, y: 0, width: size.width, height: size.height }, slice);
      const first = patches[0]!.target, last = patches[patches.length - 1]!.target;
      const widths = [first.height, last.width, last.height, first.width].map(unit).join(' ');
      layer.dataset.uiNineSlice = JSON.stringify(patches.map(patch => patch.target));
      layer.style.borderStyle = 'solid';
      layer.style.borderColor = 'transparent';
      layer.style.borderWidth = widths;
      layer.style.borderImageSource = url;
      layer.style.borderImageSlice = `${slice.top} ${slice.right} ${slice.bottom} ${slice.left}${slice.fillCenter ? ' fill' : ''}`;
      layer.style.borderImageWidth = widths;
      layer.style.borderImageRepeat = 'stretch';
    }).catch(options.onError);
  }
  const border = effective.border;
  if (border && border.width > 0) {
    const line = document.createElement('div');
    line.dataset.uiDecorBorder = 'true';
    line.style.cssText = 'position:absolute;inset:0;box-sizing:border-box;border-radius:inherit;pointer-events:none';
    line.style.border = `${unit(border.width)} solid ${projectUiColor(border.color, border.opacity)}`;
    decor.appendChild(line);
  }
  return decor;
}

/** Cached natural-size reader for loaded image URLs. */
export function createProjectUiImageSizes(): (url: string) => Promise<{ width: number; height: number }> {
  const sizes = new Map<string, Promise<{ width: number; height: number }>>();
  return url => {
    let size = sizes.get(url);
    if (!size) {
      size = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('界面背景图片无法读取尺寸'));
        image.src = url;
      });
      size.catch(() => sizes.delete(url));
      sizes.set(url, size);
    }
    return size;
  };
}
