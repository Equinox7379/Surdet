import { describe, expect, it } from 'vitest';
import { NewGamePlus, VariableStore, type VarDeclaration, type VarValue } from '@surdet/core';
import { readClearRecord } from '../../../../examples/shared/player/clear-record.js';

const valid = () => ({ endings: ['old'], playthroughs: 2, variables: { route: 37 }, clearedAt: 123 });
function runtime(declarations: VarDeclaration[] = [{ name: 'route', type: 'number', initial: 9 }]) {
  const store = new VariableStore(declarations);
  const ngp = new NewGamePlus({ clearCondition: 'true', unlockGallery: true,
    inherit: declarations.map(declaration => ({ variable: declaration.name, mode: 'copy' })) }, store);
  return { store, ngp };
}

describe('Player persistent clear-record payload', () => {
  it.each([
    null, [], 'record',
    { ...valid(), endings: null }, { ...valid(), endings: [1] }, { ...valid(), endings: [''] },
    { ...valid(), playthroughs: -1 }, { ...valid(), playthroughs: 1.5 },
    { ...valid(), playthroughs: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid(), variables: null }, { ...valid(), variables: [] },
    { ...valid(), clearedAt: NaN }, { ...valid(), clearedAt: -1 },
  ])('rejects malformed business values without changing the live variable store: %j', value => {
    const { store, ngp } = runtime(), before = store.snapshot();
    expect(() => readClearRecord(value, store, ngp)).toThrow();
    expect(store.snapshot()).toEqual(before);
  });

  it('preserves supported records and ignores no-longer-declared variables', () => {
    const { store, ngp } = runtime();
    const value = { ...valid(), variables: { route: 37, oldName: ['retained'] }, extra: 'retained' };
    expect(readClearRecord(value, store, ngp)).toEqual(value);
    expect(store.snapshot()).toEqual({ route: 9 });
  });

  it('rejects an invalid later inheritance value before applying an earlier valid value', () => {
    const { store, ngp } = runtime([{ name: 'route', type: 'number', initial: 9 }, { name: 'score', type: 'number', initial: 2 }]);
    expect(() => readClearRecord({ ...valid(), variables: { route: 37, score: 'wrong' } }, store, ngp)).toThrow(/score/);
    expect(store.snapshot()).toEqual({ route: 9, score: 2 });
  });

  it('validates readonly inherited values while preserving ordinary script write protection', () => {
    const { store, ngp } = runtime([{ name: 'route', type: 'number', initial: 9, readonly: true }]);
    expect(() => readClearRecord({ ...valid(), variables: { route: 'wrong type' } }, store, ngp)).toThrow(/route/);
    expect(store.snapshot()).toEqual({ route: 9 });
    const record = readClearRecord(valid(), store, ngp);
    store.restore(ngp.computeInheritFrom(store.snapshot(), record.variables as Record<string, VarValue>), { allowReadonly: true });
    expect(store.snapshot()).toEqual({ route: 37 });
    expect(() => store.set('route', 100)).toThrow(/readonly/);
  });

  const supported: Array<{ type: VarDeclaration['type']; initial: VarValue; cleared: VarValue }> = [
    { type: 'number', initial: 0, cleared: 37 }, { type: 'string', initial: '', cleared: '夜航' },
    { type: 'boolean', initial: false, cleared: true }, { type: 'flag', initial: false, cleared: true },
    { type: 'number[]', initial: [], cleared: [1, 2] }, { type: 'string[]', initial: [], cleared: ['夜', '晨'] },
    { type: 'object', initial: {}, cleared: { nested: [1, { value: '保留' }] } },
  ];
  it.each(supported)('validates supported inherited $type values without applying them during read', ({ type, initial, cleared }) => {
    const { store, ngp } = runtime([{ name: 'route', type, initial }]);
    const record = readClearRecord({ ...valid(), variables: { route: cleared } }, store, ngp);
    expect(record.variables.route).toEqual(cleared); expect(store.snapshot()).toEqual({ route: initial });
  });
});
