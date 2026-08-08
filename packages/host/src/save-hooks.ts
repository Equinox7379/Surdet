import type { SystemHooks, SystemSnapshots } from '@surdet/core';
import type { HostStateAdapter } from './types.js';

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
  const participatingAdapters = (snapshot: SystemSnapshots): HostStateAdapter[] => {
    const source = snapshot as Record<string, unknown>;
    return list.filter((adapter) => Object.prototype.hasOwnProperty.call(source, adapter.id));
  };
  const validate = (snapshot: SystemSnapshots): void => {
    const source = snapshot as Record<string, unknown>;
    let validationError: unknown = null;
    for (const adapter of participatingAdapters(snapshot)) {
      try {
        adapter.validate(source[adapter.id]);
      } catch (error) {
        validationError ??= error;
      }
    }
    if (validationError !== null) throw validationError;
  };
  return {
    snapshot: (): SystemSnapshots => {
      const result: Record<string, unknown> = {};
      for (const adapter of list) result[adapter.id] = adapter.snapshot();
      return result as SystemSnapshots;
    },
    validate,
    restore: (snapshot: SystemSnapshots): void => {
      const source = snapshot as Record<string, unknown>;
      validate(snapshot);
      for (const adapter of participatingAdapters(snapshot)) adapter.restore(source[adapter.id]);
    },
  };
}
