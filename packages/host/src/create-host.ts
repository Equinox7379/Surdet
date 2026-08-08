import type { AdvRenderer, AdvStage } from '@surdet/renderer';
import type {
  DefaultHostController,
  DefaultHostOptions,
  HostSystemAdapter,
  HostSystemBoundaryPhase,
  HostSystemContext,
} from './types.js';

interface ActiveAdapter {
  adapter: HostSystemAdapter;
  settled: boolean;
  reported: boolean;
}

function adapterMap(adapters: readonly HostSystemAdapter[]): Map<string, HostSystemAdapter> {
  const map = new Map<string, HostSystemAdapter>();
  for (const adapter of adapters) {
    if (!adapter || typeof adapter.id !== 'string' || adapter.id.length === 0) {
      throw new Error('宿主 adapter 必须提供非空 id');
    }
    if (map.has(adapter.id)) throw new Error(`宿主 adapter ID 重复：${adapter.id}`);
    map.set(adapter.id, adapter);
  }
  return map;
}

export function createDefaultHost(options: DefaultHostOptions): DefaultHostController {
  const adapters = [...(options.adapters ?? [])];
  const byId = adapterMap(adapters);
  const onError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // 错误回调不得让宿主生命周期再次抛错或保持冻结。
    }
  };
  const onSystemBoundary = (phase: HostSystemBoundaryPhase): void => {
    try {
      options.onSystemBoundary?.(phase);
    } catch {
      // 边界回调只负责宿主外部状态清理，不得阻断 system 生命周期。
    }
  };
  // 保留公共构造契约：当前 router 不直接操作渲染器，具体覆盖层由 adapter 持有。
  const _renderer: AdvRenderer = options.renderer;
  const _stage: AdvStage = options.stage;
  void _renderer;
  void _stage;

  let active: ActiveAdapter | null = null;
  let disposed = false;

  const resumeInterpreter = (): void => {
    try {
      options.interpreter.resumeHost();
    } catch (error) {
      onError(error);
    }
  };

  const release = (state: ActiveAdapter, phase: 'complete' | 'fail'): boolean => {
    if (active !== state || state.settled) return false;
    state.settled = true;
    active = null;
    onSystemBoundary(phase);
    resumeInterpreter();
    return true;
  };

  const fail = (state: ActiveAdapter, error: unknown): void => {
    const released = release(state, 'fail');
    if (!state.reported && (released || state.settled)) {
      state.reported = true;
      onError(error);
    }
  };

  const routeSystem = async (id: string, payload: unknown): Promise<boolean> => {
    if (disposed) return false;
    const adapter = byId.get(id);
    if (!adapter) return false;
    if (active !== null) {
      const error = new Error(`宿主已有活动中的 system adapter：${active.adapter.id}`);
      onError(error);
      return false;
    }

    const state: ActiveAdapter = { adapter, settled: false, reported: false };
    active = state;
    onSystemBoundary('enter');
    const context: HostSystemContext = {
      pause: () => {
        if (!state.settled) options.interpreter.pauseHost();
      },
      resume: () => { release(state, 'complete'); },
      fail: (error) => { fail(state, error); },
    };
    try {
      // 先登记 active，再暂停解释器，确保 adapter 在 open 期间的同步回调也能安全 resume/fail。
      options.interpreter.pauseHost();
      await adapter.open(payload, context);
      return true;
    } catch (error) {
      fail(state, error);
      return false;
    }
  };

  const reset = (): void => {
    if (disposed) return;
    const state = active;
    if (state) {
      state.settled = true;
      active = null;
      onSystemBoundary('reset');
      resumeInterpreter();
    } else {
      onSystemBoundary('reset');
    }
    for (const adapter of adapters) {
      try {
        adapter.reset?.();
      } catch (error) {
        onError(error);
      }
    }
    try {
      options.onStateReset?.();
    } catch (error) {
      onError(error);
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    const state = active;
    if (state) {
      state.settled = true;
      active = null;
      onSystemBoundary('dispose');
      resumeInterpreter();
    } else {
      onSystemBoundary('dispose');
    }
    for (const adapter of adapters) {
      try {
        adapter.dispose?.();
      } catch (error) {
        onError(error);
      }
    }
  };

  return { routeSystem, reset, dispose };
}
