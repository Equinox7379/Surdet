import { RendererError } from '../api/renderer-errors.js';

export interface GenerationToken {
  readonly id: number;
  readonly signal: AbortSignal;
  readonly current: boolean;
}

/**
 * Small cancellation primitive for renderer owners with asynchronous work.
 * A token observes the generation dynamically, so an already-returned token
 * cannot become current again after reset or disposal.
 */
export class AsyncGeneration {
  #id = 0;
  #controller = new AbortController();
  #disposed = false;

  token(): GenerationToken {
    this.#ensureActive('token');
    return this.#createToken(this.#id, this.#controller.signal);
  }

  advance(): GenerationToken {
    this.#ensureActive('advance');
    this.#controller.abort();
    this.#id += 1;
    this.#controller = new AbortController();
    return this.#createToken(this.#id, this.#controller.signal);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#controller.abort();
  }

  #createToken(id: number, signal: AbortSignal): GenerationToken {
    const generation = this;
    return {
      id,
      signal,
      get current(): boolean {
        return !generation.#disposed
          && generation.#id === id
          && !signal.aborted;
      },
    };
  }

  #ensureActive(command: string): void {
    if (this.#disposed) {
      throw new RendererError('Renderer async generation has been disposed', {
        code: 'RENDERER_DISPOSED',
        domain: 'lifecycle',
        command: `generation.${command}`,
      });
    }
  }
}
