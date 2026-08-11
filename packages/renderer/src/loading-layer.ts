import { Container, Graphics, Text as PText } from 'pixi.js';
import type { LoadingProgress } from './loading-progress.js';
import { DEFAULT_RENDERER_THEME, type RendererTheme } from './theme.js';

/**
 * Persistent Pixi loading overlay. The stage owns the layer; callers only
 * provide progress snapshots and never need to know how it is drawn.
 */
export class LoadingLayer {
  readonly container = new Container();

  #background: Graphics;
  #barTrack: Graphics;
  #barFill: Graphics;
  #title: PText;
  #status: PText;
  #destroyed = false;
  readonly #width: number;
  readonly #height: number;
  #theme: RendererTheme = DEFAULT_RENDERER_THEME;

  constructor(width = 1280, height = 720) {
    this.#width = width;
    this.#height = height;
    this.#background = new Graphics().rect(0, 0, width, height).fill(this.#theme.colors.canvas);
    this.#barTrack = new Graphics().roundRect(0, 0, 760, 16, 8).fill({ color: this.#theme.colors.line, alpha: this.#theme.opacity.surface });
    this.#barFill = new Graphics().roundRect(0, 0, 0, 16, 8).fill(this.#theme.colors.accent);
    this.#title = new PText({
      text: '正在加载资源',
      style: { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.text, fontFamily: 'sans-serif' },
    });
    this.#status = new PText({
      text: '准备中…',
      style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.textMuted, fontFamily: 'sans-serif' },
    });
    this.#title.anchor.set(0.5);
    this.#status.anchor.set(0.5);
    this.#barTrack.position.set((width - 760) / 2, height / 2);
    this.#barFill.position.copyFrom(this.#barTrack.position);
    this.#title.position.set(width / 2, height / 2 - 72);
    this.#status.position.set(width / 2, height / 2 + 42);
    this.container.addChild(this.#background, this.#barTrack, this.#barFill, this.#title, this.#status);
    this.container.visible = false;
  }

  setTheme(theme: RendererTheme): void {
    if (this.#destroyed) return;
    this.#theme = theme;
    this.#background.clear().rect(0, 0, this.#width, this.#height).fill(theme.colors.canvas);
    this.#barTrack.clear().roundRect(0, 0, 760, 16, 8).fill({ color: theme.colors.line, alpha: theme.opacity.surface });
    this.#barFill.clear().roundRect(0, 0, 0, 16, 8).fill(theme.colors.accent);
    this.#title.style = {
      ...this.#title.style,
      fontSize: theme.typography.headingSize,
      fill: theme.colors.text,
    };
    this.#status.style = {
      ...this.#status.style,
      fontSize: theme.typography.captionSize,
      fill: theme.colors.textMuted,
    };
  }

  show(progress: LoadingProgress): void {
    if (this.#destroyed) return;
    const settled = progress.completed + progress.failed;
    const ratio = progress.total === 0 ? 1 : Math.max(0, Math.min(1, settled / progress.total));
    this.#barFill.clear().roundRect(0, 0, 760 * ratio, 16, 8).fill(this.#theme.colors.accent);
    this.#barFill.position.copyFrom(this.#barTrack.position);
    this.#status.text = progress.done
      ? `资源加载完成 · ${settled}/${progress.total}`
      : progress.current
        ? `正在加载 ${progress.current} · ${settled}/${progress.total}`
        : `准备加载 · ${settled}/${progress.total}`;
    this.container.visible = true;
  }

  hide(): void {
    if (this.#destroyed) return;
    this.container.visible = false;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
    this.#destroyed = true;
  }
}
