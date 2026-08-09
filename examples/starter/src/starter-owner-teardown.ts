export interface StarterDisposable {
  dispose(): void;
}

export interface StarterStoppable {
  stop(): void;
}

export interface StarterOwnerTeardownOptions {
  readonly runtime: StarterDisposable;
  readonly audioManager: StarterDisposable;
  readonly gamepad: StarterStoppable;
  readonly fontBlobUrls: Set<string>;
  readonly assetBlobUrls: Set<string>;
  readonly revokeObjectUrl: (url: string) => void;
}

export interface StarterOwnerTeardown {
  /** Register an already-installed host listener for synchronous removal. */
  trackListener(remove: () => void): void;
  /** Dispose every owned resource once, preserving the first teardown boundary. */
  dispose(): void;
  readonly disposed: boolean;
}

/**
 * Owns the browser-side resources created by a Starter runtime.
 *
 * The browser unload path must remain synchronous: runtime disposal is deliberately
 * performed before URL revocation and no asynchronous command is awaited here.
 */
export function createStarterOwnerTeardown(
  options: StarterOwnerTeardownOptions,
): StarterOwnerTeardown {
  let disposed = false;
  const listenerRemovers: Array<() => void> = [];

  const run = (action: () => void, failures: unknown[]): void => {
    try {
      action();
    } catch (error) {
      failures.push(error);
    }
  };

  return {
    get disposed(): boolean { return disposed; },
    trackListener(remove): void {
      if (disposed) {
        remove();
        return;
      }
      listenerRemovers.push(remove);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const failures: unknown[] = [];

      // Keep this order synchronous and explicit: input/audio stop first, then the
      // renderer runtime, then host listeners and external Blob URLs.
      run(() => options.gamepad.stop(), failures);
      run(() => options.audioManager.dispose(), failures);
      run(() => options.runtime.dispose(), failures);
      for (const remove of listenerRemovers.splice(0)) run(remove, failures);
      for (const url of options.fontBlobUrls) run(() => options.revokeObjectUrl(url), failures);
      options.fontBlobUrls.clear();
      for (const url of options.assetBlobUrls) run(() => options.revokeObjectUrl(url), failures);
      options.assetBlobUrls.clear();

      if (failures.length > 0) {
        throw new AggregateError(failures, 'Starter owner teardown failed');
      }
    },
  };
}
