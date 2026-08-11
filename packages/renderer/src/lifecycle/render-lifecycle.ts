import { RendererError } from '../api/renderer-errors.js';
import type { RendererResourceSnapshot } from '../diagnostics/renderer-baseline.js';

export type ResourceKind = 'ticker' | 'listener' | 'tween' | 'async' | 'blob' | 'pool' | 'display';
export type ResourceOwner = 'runtime' | 'world' | 'dialogue' | 'menu' | 'gallery' | 'system' | 'loading' | 'legacy';

interface ResourceEntry {
  readonly owner: ResourceOwner;
  readonly kind: ResourceKind;
  readonly key: string;
  readonly dispose: () => void;
}

export interface RenderLifecycleDisposalFailure {
  readonly owner: ResourceOwner;
  readonly kind: ResourceKind;
  readonly key: string;
  readonly cause: unknown;
}

const RESOURCE_ERROR_CODE = 'COMMAND_COMMIT_FAILED' as const;

function compositeKey(owner: ResourceOwner, kind: ResourceKind, key: string): string {
  return `${owner}\u0000${kind}\u0000${key}`;
}

/**
 * Owner-scoped renderer resource registry.
 *
 * Entries are removed from the indexes before their disposers are called. This
 * makes release safe when a disposer synchronously asks to release its owner
 * again, and lets every selected disposer run even when one of them fails.
 */
export class RenderLifecycle {
  #entries = new Map<string, ResourceEntry>();
  #ownerIndex = new Map<ResourceOwner, Set<string>>();
  #displayOwners = new Set<ResourceOwner>();
  #disposed = false;

  register(owner: ResourceOwner, kind: ResourceKind, key: string, dispose: () => void): void {
    this.#ensureActive('register');
    if (typeof dispose !== 'function') {
      throw new RendererError('Renderer resource disposer must be a function', {
        code: RESOURCE_ERROR_CODE,
        domain: 'lifecycle',
        command: 'register',
      });
    }

    const id = compositeKey(owner, kind, key);
    const old = this.#entries.get(id);
    if (old) {
      this.#removeEntry(id);
      let failure: RenderLifecycleDisposalFailure | undefined;
      try {
        old.dispose();
      } catch (error) {
        failure = this.#failureRecord(old, error);
      }
      this.#addEntry({ owner, kind, key, dispose });
      if (failure) this.#throwDisposalFailure('replace', [failure]);
      return;
    }

    this.#addEntry({ owner, kind, key, dispose });
  }

  release(owner: ResourceOwner, kind: ResourceKind, key: string): boolean {
    if (this.#disposed) return false;
    const id = compositeKey(owner, kind, key);
    const entry = this.#entries.get(id);
    if (!entry) return false;
    this.#removeEntry(id);
    this.#disposeEntries([entry], 'release');
    return true;
  }

  /**
   * Removes an entry without invoking its disposer. This is reserved for a
   * higher-level owner that is about to release several resources as one
   * batch, then performs the actual disposal itself.
   */
  forget(owner: ResourceOwner, kind: ResourceKind, key: string): boolean {
    if (this.#disposed) return false;
    return this.#removeEntry(compositeKey(owner, kind, key)) !== undefined;
  }

  releaseOwner(owner: ResourceOwner): void {
    if (this.#disposed) return;
    const ids = [...(this.#ownerIndex.get(owner) ?? [])];
    const entries: ResourceEntry[] = [];
    for (const id of ids) {
      const entry = this.#entries.get(id);
      if (!entry) continue;
      this.#removeEntry(id);
      entries.push(entry);
    }
    this.#disposeEntries(entries, 'releaseOwner');
  }

  snapshot(): RendererResourceSnapshot {
    let tickerCallbacks = 0;
    let listeners = 0;
    let activeTweens = 0;
    let activeAsyncTasks = 0;
    let blobUrls = 0;
    const pooledObjects: Record<string, number> = {};
    const displayObjectsByOwner: Record<string, number> = {};

    for (const owner of this.#displayOwners) displayObjectsByOwner[owner] = 0;
    for (const entry of this.#entries.values()) {
      switch (entry.kind) {
        case 'ticker': tickerCallbacks += 1; break;
        case 'listener': listeners += 1; break;
        case 'tween': activeTweens += 1; break;
        case 'async': activeAsyncTasks += 1; break;
        case 'blob': blobUrls += 1; break;
        case 'pool': {
          const poolKey = `${entry.owner}:${entry.key}`;
          pooledObjects[poolKey] = (pooledObjects[poolKey] ?? 0) + 1;
          break;
        }
        case 'display':
          displayObjectsByOwner[entry.owner] = (displayObjectsByOwner[entry.owner] ?? 0) + 1;
          break;
      }
    }

    return {
      disposed: this.#disposed,
      tickerCallbacks,
      listeners,
      activeTweens,
      activeAsyncTasks,
      blobUrls,
      pooledObjects: { ...pooledObjects },
      displayObjectsByOwner: { ...displayObjectsByOwner },
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    for (const ids of this.#ownerIndex.values()) ids.clear();
    this.#disposeEntries(entries, 'dispose');
  }

  #addEntry(entry: ResourceEntry): void {
    const id = compositeKey(entry.owner, entry.kind, entry.key);
    this.#entries.set(id, entry);
    if (entry.kind === 'display') this.#displayOwners.add(entry.owner);
    let ids = this.#ownerIndex.get(entry.owner);
    if (!ids) {
      ids = new Set<string>();
      this.#ownerIndex.set(entry.owner, ids);
    }
    ids.add(id);
  }

  #removeEntry(id: string): ResourceEntry | undefined {
    const entry = this.#entries.get(id);
    if (!entry) return undefined;
    this.#entries.delete(id);
    this.#ownerIndex.get(entry.owner)?.delete(id);
    return entry;
  }

  #disposeEntries(entries: readonly ResourceEntry[], command: string): void {
    const failures: RenderLifecycleDisposalFailure[] = [];
    for (const entry of entries) {
      try {
        entry.dispose();
      } catch (error) {
        failures.push(this.#failureRecord(entry, error));
      }
    }
    if (failures.length > 0) this.#throwDisposalFailure(command, failures);
  }

  #failureRecord(entry: ResourceEntry, cause: unknown): RenderLifecycleDisposalFailure {
    return Object.freeze({
      owner: entry.owner,
      kind: entry.kind,
      key: entry.key,
      cause,
    });
  }

  #throwDisposalFailure(command: string, failures: readonly RenderLifecycleDisposalFailure[]): never {
    throw new RendererError(`Renderer resource ${command} failed`, {
      code: RESOURCE_ERROR_CODE,
      domain: 'lifecycle',
      command,
      cause: new AggregateError(failures, `Renderer resource ${command} failed`),
    });
  }

  #ensureActive(command: string): void {
    if (this.#disposed) {
      throw new RendererError('Renderer lifecycle has already been disposed', {
        code: 'RENDERER_DISPOSED',
        domain: 'lifecycle',
        command,
      });
    }
  }
}
