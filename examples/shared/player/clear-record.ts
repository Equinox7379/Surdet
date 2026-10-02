import type { NewGamePlus, VariableStore, VarValue } from '@surdet/core';

/** Persistent cross-playthrough facts, separate from ordinary story saves. */
export interface GlobalClearRecord {
  endings: string[];
  /** One count per new-game/load session, even if it reaches several endings. */
  playthroughs: number;
  /** Latest clear-time snapshot; old or unused variables need not match current declarations. */
  variables: Record<string, unknown>;
  clearedAt: number;
}

/** Profile envelopes validate JSON, but the Player must validate its own payload. */
export function readClearRecord(value: unknown, store: VariableStore, ngp: NewGamePlus): GlobalClearRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('通关记录必须是对象');
  }
  const record = value as Partial<GlobalClearRecord>;
  if (!Array.isArray(record.endings) || record.endings.some(ending => typeof ending !== 'string' || !ending.trim())
    || !Number.isSafeInteger(record.playthroughs) || record.playthroughs! < 0
    || typeof record.variables !== 'object' || record.variables === null || Array.isArray(record.variables)
    || typeof record.clearedAt !== 'number' || !Number.isFinite(record.clearedAt) || record.clearedAt < 0) {
    throw new Error('通关记录的结局、周目数、变量或时间字段损坏');
  }
  // Old, no-longer-declared variables are harmless. Validate the values actually
  // inherited before the caller changes any live variable.
  store.validateRestore(ngp.computeInheritFrom(store.snapshot(), record.variables as Record<string, VarValue>), { allowReadonly: true });
  return record as GlobalClearRecord;
}
