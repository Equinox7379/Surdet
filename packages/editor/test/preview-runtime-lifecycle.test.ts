import { describe, expect, it, vi } from 'vitest';
import { PreviewRuntimeLifecycle } from '../src/preview-runtime-lifecycle.js';

interface FakeRuntime {
  canvas: EventTarget;
  resize(): void;
  resetSession(): void;
  dispose(): void;
  commands: {
    menu: { showSettings(): void; showSaveLoad(): void };
    system: { showMap(): void };
  };
  queries: {
    diagnostics: { resourceSnapshot(): { listeners: number } };
    presentation: { snapshot(): { version: number } };
  };
}

describe('editor preview runtime lifecycle', () => {
  it('creates one runtime, keeps reload/reset callbacks on that runtime, and disposes listeners/runtime once', async () => {
    const canvas = new EventTarget();
    const resize = vi.fn();
    const resetSession = vi.fn();
    const dispose = vi.fn();
    const createRuntime = vi.fn(async (): Promise<FakeRuntime> => ({
      canvas,
      resize,
      resetSession,
      dispose,
      commands: {
        menu: { showSettings: vi.fn(), showSaveLoad: vi.fn() },
        system: { showMap: vi.fn() },
      },
      queries: {
        diagnostics: { resourceSnapshot: () => ({ listeners: 0 }) },
        presentation: { snapshot: () => ({ version: 1 }) },
      },
    }));
    const appended: EventTarget[] = [];
    const resizeTarget = new EventTarget();
    const lifecycle = new PreviewRuntimeLifecycle({
      createRuntime,
      appendCanvas: (value) => appended.push(value),
      addResizeListener: (listener) => {
        resizeTarget.addEventListener('resize', listener);
        return () => resizeTarget.removeEventListener('resize', listener);
      },
    });

    const first = await lifecycle.start();
    const second = await lifecycle.start();
    expect(second).toBe(first);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(appended).toEqual([canvas]);
    expect(resize).toHaveBeenCalledTimes(1);

    lifecycle.listen(canvas, 'settings', () => undefined);
    lifecycle.listen(canvas, 'save-load', () => undefined);
    lifecycle.listen(canvas, 'map', () => undefined);
    first.commands.menu.showSettings();
    first.commands.menu.showSaveLoad();
    first.commands.system.showMap();
    first.resetSession();
    expect(first.queries.diagnostics.resourceSnapshot()).toEqual({ listeners: 0 });
    expect(first.queries.presentation.snapshot()).toEqual({ version: 1 });
    expect(resetSession).toHaveBeenCalledTimes(1);

    resizeTarget.dispatchEvent(new Event('resize'));
    expect(resize).toHaveBeenCalledTimes(2);

    lifecycle.dispose();
    lifecycle.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    resizeTarget.dispatchEvent(new Event('resize'));
    expect(resize).toHaveBeenCalledTimes(2);
  });
});
