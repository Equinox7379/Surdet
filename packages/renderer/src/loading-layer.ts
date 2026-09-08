import { Container, Graphics, Text as PText } from 'pixi.js';
import type { LoadingProgress } from './loading-progress.js';
import { markPlayerModal } from './player-controls.js';
import { DEFAULT_RENDERER_THEME, type RendererTheme } from './theme.js';
import {
  bindThemeGraphicsProjection,
  bindThemeTextProjection,
  readThemeProjection,
  repaintThemeProjection,
  type LayerThemeProjectionSnapshot,
} from './theme-projection.js';

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
  #progress: LoadingProgress | null = null;
  readonly #barWidth: number;

  constructor(width = 1280, height = 720) {
    this.#width = width;
    this.#height = height;
    this.#barWidth = Math.max(1, Math.min(760, width - 80));
    this.#background = bindThemeGraphicsProjection(new Graphics().rect(0, 0, width, height).fill(this.#theme.colors.canvas), ['canvas']);
    this.#barTrack = bindThemeGraphicsProjection(
      new Graphics().roundRect(0, 0, this.#barWidth, 8, this.#theme.radius.sm).fill({ color: this.#theme.colors.line, alpha: this.#theme.opacity.line }),
      ['line'],
    );
    this.#barFill = bindThemeGraphicsProjection(new Graphics().roundRect(0, 0, 0, 16, 8).fill(this.#theme.colors.accent), ['accent']);
    this.#title = bindThemeTextProjection(new PText({
      text: '正在加载资源',
      // Inherit the stage's configured body/UI font so project font overrides
      // also apply to the loading surface.
      style: { fontSize: this.#theme.typography.headingSize, fill: this.#theme.colors.text, wordWrap: true, breakWords: true, wordWrapWidth: this.#barWidth, align: 'center' },
    }), { fill: 'text', fontSize: 'headingSize' });
    this.#status = bindThemeTextProjection(new PText({
      text: '准备中…',
      style: { fontSize: this.#theme.typography.captionSize, fill: this.#theme.colors.textMuted, wordWrap: true, breakWords: true, wordWrapWidth: this.#barWidth, align: 'center' },
    }), { fill: 'textMuted', fontSize: 'captionSize' });
    this.#title.anchor.set(0.5);
    this.#status.anchor.set(0.5);
    this.#barTrack.position.set((width - this.#barWidth) / 2, height / 2);
    this.#barFill.position.copyFrom(this.#barTrack.position);
    this.#title.position.set(width / 2, height / 2 - 72);
    this.#status.position.set(width / 2, height / 2 + 42);
    this.container.addChild(this.#background, this.#barTrack, this.#barFill, this.#title, this.#status);
    this.#background.eventMode = 'static';
    markPlayerModal(this.container, {});
    this.container.visible = false;
  }

  setTheme(theme: RendererTheme): void {
    if (this.#destroyed) return;
    const previous = this.#theme;
    this.#theme = theme;
    repaintThemeProjection(this.container, previous, theme);
    this.#background.clear().rect(0, 0, this.#width, this.#height).fill(theme.colors.canvas);
    this.#barTrack.clear().roundRect(0, 0, this.#barWidth, 8, theme.radius.sm).fill({ color: theme.colors.line, alpha: theme.opacity.line });
    this.#title.style.fontSize = theme.typography.headingSize;
    this.#title.style.fill = theme.colors.text;
    this.#status.style.fontSize = theme.typography.captionSize;
    this.#status.style.fill = theme.colors.textMuted;
    if (this.#progress) this.#paintProgress(this.#progress);
  }

  themeProjectionSnapshot(): LayerThemeProjectionSnapshot {
    return readThemeProjection(this.container);
  }

  show(progress: LoadingProgress): void {
    if (this.#destroyed) return;
    this.#progress = { ...progress };
    this.#paintProgress(progress);
    this.container.visible = true;
  }

  #paintProgress(progress: LoadingProgress): void {
    const settled = progress.completed + progress.failed;
    const determinate = Number.isFinite(progress.total) && progress.total > 0;
    const ratio = determinate ? Math.max(0, Math.min(1, settled / progress.total)) : 0;
    this.#barTrack.visible = determinate;
    this.#barFill.visible = determinate;
    this.#barFill.clear().roundRect(0, 0, this.#barWidth * ratio, 8, this.#theme.radius.sm).fill(this.#theme.colors.accent);
    this.#barFill.position.copyFrom(this.#barTrack.position);
    const failure = progress.failed > 0 ? ` · 失败 ${progress.failed}` : '';
    const amount = determinate ? ` · ${settled}/${progress.total}` : '';
    this.#status.text = progress.done
      ? progress.failed > 0
        ? `资源读取结束${amount}${failure}`
        : determinate ? `资源加载完成${amount}` : '无需加载资源'
      : `${progress.current ? `正在读取 ${progress.current}` : '正在读取…'}${amount}${failure}`;
    this.#status.style.fill = progress.failed > 0 ? this.#theme.colors.danger : this.#theme.colors.textMuted;
    bindThemeTextProjection(this.#status, { fill: progress.failed > 0 ? 'danger' : 'textMuted', fontSize: 'captionSize' });
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
