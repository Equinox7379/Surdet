import type { SystemHooks, SystemSnapshots } from '@surdet/core';
import type { HostStateAdapter } from './types.js';

// Host 的类型库不依赖 DOM；受支持的浏览器和 Node 宿主均提供 structuredClone。
const cloneSnapshot = <T>(value: T): T => (globalThis as unknown as { structuredClone<V>(input: V): V }).structuredClone(value);

function validateUnique(adapters: readonly HostStateAdapter[]): void {
  const ids = new Set<string>();
  for (const adapter of adapters) {
    if (!adapter || typeof adapter.id !== 'string' || adapter.id.length === 0) {
      throw new Error('HostStateAdapter 必须提供非空 id');
    }
    if (ids.has(adapter.id)) throw new Error(`HostStateAdapter ID 重复：${adapter.id}`);
    ids.add(adapter.id);
  }
}

export function createSystemHooks(adapters: readonly HostStateAdapter[]): SystemHooks {
  const list = [...adapters];
  validateUnique(list);
  const defaults = new Map(list.map(adapter => [adapter.id, cloneSnapshot(adapter.snapshot())]));
  const validate = (snapshot: SystemSnapshots): void => {
    const source = snapshot as Record<string, unknown>;
    let validationError: unknown = null;
    for (const adapter of list) {
      try {
        adapter.validate(Object.prototype.hasOwnProperty.call(source, adapter.id)
          ? source[adapter.id] : cloneSnapshot(defaults.get(adapter.id)));
      } catch (error) {
        validationError ??= error;
      }
    }
    if (validationError !== null) throw validationError;
  };
  return {
    snapshot: (): SystemSnapshots => Object.fromEntries(list.map(adapter => [adapter.id, adapter.snapshot()])) as SystemSnapshots,
    validate,
    restore: (snapshot: SystemSnapshots): void => {
      const source = snapshot as Record<string, unknown>;
      validate(snapshot);
      for (const adapter of list) adapter.restore(Object.prototype.hasOwnProperty.call(source, adapter.id)
        ? source[adapter.id] : cloneSnapshot(defaults.get(adapter.id)));
    },
  };
}
