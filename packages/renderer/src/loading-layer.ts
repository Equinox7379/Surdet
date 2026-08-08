import { Container, Graphics, Text as PText } from 'pixi.js';
import type { LoadingProgress } from './loading-progress.js';

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

  constructor(width = 1280, height = 720) {
    this.#width = width;
    this.#height = height;
    this.#background = new Graphics().rect(0, 0, width, height).fill(0x080b14);
    this.#barTrack = new Graphics().roundRect(0, 0, 760, 16, 8).fill({ color: 0x273248, alpha: 0.9 });
    this.#barFill = new Graphics().roundRect(0, 0, 0, 16, 8).fill(0x5ac8ff);
    this.#title = new PText({
      text: '正在加载资源',
      style: { fontSize: 30, fill: 0xf2f6ff, fontFamily: 'sans-serif' },
    });
    this.#status = new PText({
      text: '准备中…',
      style: { fontSize: 16, fill: 0xb8c7df, fontFamily: 'sans-serif' },
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

  show(progress: LoadingProgress): void {
    if (this.#destroyed) return;
    const settled = progress.completed + progress.failed;
    const ratio = progress.total === 0 ? 1 : Math.max(0, Math.min(1, settled / progress.total));
    this.#barFill.clear().roundRect(0, 0, 760 * ratio, 16, 8).fill(0x5ac8ff);
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
