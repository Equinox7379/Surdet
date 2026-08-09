/**
 * The editor preview owns one renderer runtime for the lifetime of its iframe.
 * This small lifecycle wrapper keeps canvas/resize/listener cleanup testable
 * without importing the browser-bound preview entry point in unit tests.
 */
export interface PreviewRuntimeLike {
  readonly canvas: EventTarget;
  resize(): void;
  dispose(): void;
}

export interface PreviewRuntimeLifecycleOptions<TRuntime extends PreviewRuntimeLike> {
  createRuntime(): Promise<TRuntime>;
  appendCanvas(canvas: TRuntime['canvas']): void;
  addResizeListener(listener: EventListener): () => void;
}

export class PreviewRuntimeLifecycle<TRuntime extends PreviewRuntimeLike> {
  readonly #options: PreviewRuntimeLifecycleOptions<TRuntime>;
  #runtime: TRuntime | null = null;
  #starting: Promise<TRuntime> | null = null;
  #removeResizeListener: (() => void) | null = null;
  #cleanups: (() => void)[] = [];
  #disposed = false;

  constructor(options: PreviewRuntimeLifecycleOptions<TRuntime>) {
    this.#options = options;
  }

  async start(): Promise<TRuntime> {
    if (this.#disposed) throw new Error('Preview runtime lifecycle is disposed');
    if (this.#runtime) return this.#runtime;
    if (this.#starting) return this.#starting;
    this.#starting = this.#options.createRuntime().then((runtime) => {
      if (this.#disposed) {
        runtime.dispose();
        throw new Error('Preview runtime lifecycle was disposed during startup');
      }
      this.#runtime = runtime;
      this.#options.appendCanvas(runtime.canvas);
      this.#removeResizeListener = this.#options.addResizeListener(() => runtime.resize());
      runtime.resize();
      return runtime;
    }).finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  get runtime(): TRuntime | null {
    return this.#runtime;
  }

  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): () => void;
  listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): () => void;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): () => void;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): () => void {
    if (this.#disposed) throw new Error('Preview runtime lifecycle is disposed');
    target.addEventListener(type, listener, options);
    let removed = false;
    const remove = (): void => {
      if (removed) return;
      removed = true;
      target.removeEventListener(type, listener, options);
      const index = this.#cleanups.indexOf(remove);
      if (index >= 0) this.#cleanups.splice(index, 1);
    };
    this.#cleanups.push(remove);
    return remove;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#removeResizeListener?.();
    this.#removeResizeListener = null;
    for (const cleanup of [...this.#cleanups].reverse()) cleanup();
    this.#cleanups = [];
    this.#runtime?.dispose();
  }
}
