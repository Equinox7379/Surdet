/** 统一的可释放资源注册表，供纹理、Blob URL、音频等生命周期资源复用。 */
export interface DisposableResource { dispose(): void; }

export class ResourceLifecycle {
  #resources = new Map<string, DisposableResource>();

  register(key: string, resource: DisposableResource): void {
    const old = this.#resources.get(key);
    if (old && old !== resource) old.dispose();
    this.#resources.set(key, resource);
  }

  release(key: string): boolean {
    const resource = this.#resources.get(key);
    if (!resource) return false;
    this.#resources.delete(key);
    resource.dispose();
    return true;
  }

  clear(): void {
    for (const resource of this.#resources.values()) resource.dispose();
    this.#resources.clear();
  }

  get size(): number { return this.#resources.size; }
}
