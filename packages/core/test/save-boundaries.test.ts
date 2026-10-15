import { describe, expect, it } from 'vitest';
import { assertValidSnapshot, isJsonSafeValue, SaveManager, MemoryStorage, SAVE_SCHEMA_VERSION, type SaveSnapshot } from '../src/save/save-manager.js';
import { VariableStore } from '../src/state/variable-store.js';

function snapshot(): SaveSnapshot {
  return { meta: { id: '1', createdAt: 0, updatedAt: 0, schemaVersion: SAVE_SCHEMA_VERSION },
    variables: {}, position: null, kind: 'manual', readSet: [], gallery: { cgs: [], music: [] } };
}

describe('bounded save input', () => {
  it.each(['readSet', 'cgs', 'music', 'texts', 'profiles', 'terms', 'endings'] as const)('rejects sparse %s before replacing a valid save', async field => {
    const saves = new SaveManager(new MemoryStorage());
    const good = snapshot();
    await saves.save('1', good);
    const before = await saves.load('1');
    const bad = snapshot();
    if (field === 'readSet') bad.readSet = new Array<string>(1);
    else if (field === 'endings') bad.clears = { endings: new Array<string>(1) };
    else bad.gallery[field] = new Array<string>(1);
    expect(() => assertValidSnapshot(bad)).toThrow(/存档结构非法/);
    await expect(saves.save('1', bad)).rejects.toThrow(/存档结构非法/);
    expect(await saves.load('1')).toEqual(before);
  });
  it('rejects undefined array entries in extension data but retains optional undefined object metadata', () => {
    const good = snapshot(); good.meta.label = undefined;
    expect(() => assertValidSnapshot(good)).not.toThrow();
    expect(() => assertValidSnapshot({ ...good, extension: [undefined] })).toThrow(/存档结构非法/);
  });
  it.each(['number[]', 'string[]', 'object'] as const)('rejects sparse %s through declaration, update and restore', type => {
    const initial = type === 'object' ? {} : [];
    const sparse = type === 'object' ? { nested: new Array(2) } : new Array(2);
    expect(() => new VariableStore([{ name: 'value', type, initial: sparse }])).toThrow();
    const store = new VariableStore([{ name: 'value', type, initial }]);
    expect(() => store.set('value', sparse)).toThrow();
    expect(() => store.restore({ value: sparse })).toThrow();
    expect(store.get('value')).toEqual(initial);
  });
  it.each(['deep', 'cycle'] as const)('rejects %s values without overflowing the JS stack or writing storage', async kind => {
    const value: Record<string, unknown> = {};
    if (kind === 'cycle') value.self = value;
    else { let tail = value; for (let i = 0; i < 5000; i++) { const next = {}; tail.next = next; tail = next; } }
    expect(isJsonSafeValue(value)).toBe(false);
    const storage = new MemoryStorage(), saves = new SaveManager(storage);
    const good = snapshot(); await saves.save('1', good);
    const bad = { ...good, variables: { data: value } } as SaveSnapshot;
    await expect(saves.save('1', bad)).rejects.toThrow(/存档结构非法/);
    expect((await saves.load('1'))?.variables).toEqual({});
  });
  it('also bounds unknown snapshot fields before JSON serialization and keeps optional undefined metadata supported', () => {
    const snap = snapshot(); snap.meta.label = undefined;
    expect(() => assertValidSnapshot(snap)).not.toThrow();
    const extra: Record<string, unknown> = {};
    extra.loop = extra;
    expect(() => assertValidSnapshot({ ...snap, extension: extra })).toThrow(/存档结构非法/);
  });
  it('rejects sparse arrays but accepts ordinary repeated references', () => {
    expect(isJsonSafeValue(new Array(3))).toBe(false);
    const shared = { value: [1, true, 'text'] };
    expect(isJsonSafeValue({ a: shared, b: shared })).toBe(true);
  });
  it('preserves a valid zero createdAt instead of substituting the current time', async () => {
    const saves = new SaveManager(new MemoryStorage());
    await saves.save('1', snapshot());
    expect((await saves.load('1'))?.meta.createdAt).toBe(0);
  });
});
