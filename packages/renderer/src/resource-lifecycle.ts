/** 统一的可释放资源注册表，供纹理、Blob URL、音频等生命周期资源复用。 */
export interface DisposableResource { dispose(): void; }

import { RenderLifecycle } from './lifecycle/render-lifecycle.js';

export class ResourceLifecycle {
  #lifecycle = new RenderLifecycle();
  #keys = new Set<string>();

  register(key: string, resource: DisposableResource): void {
    this.#lifecycle.register('legacy', 'display', key, () => resource.dispose());
    this.#keys.add(key);
  }

  release(key: string): boolean {
    const released = this.#lifecycle.release('legacy', 'display', key);
    if (released) this.#keys.delete(key);
    return released;
  }

  clear(): void {
    try {
      this.#lifecycle.releaseOwner('legacy');
    } finally {
      this.#keys.clear();
    }
  }

  get size(): number { return this.#keys.size; }
}
