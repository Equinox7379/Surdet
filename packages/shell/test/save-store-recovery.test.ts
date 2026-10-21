import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SaveManager } from '@surdet/core';
import { FileSaveStore, canonicalSlotStem, sanitizeSlot } from '../src/save-store.js';

vi.mock('node:fs', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs')>() }));

const dirs: string[] = [];
function fixture(slot = 'slot_a') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-save-recovery-'));
  dirs.push(dir);
  return {
    dir, slot, store: new FileSaveStore(dir),
    main: path.join(dir, `${canonicalSlotStem(slot)}.json`),
    backup: path.join(dir, `${canonicalSlotStem(slot)}.json.bak`),
    index: path.join(dir, 'index.json'),
    l1: path.join(dir, `${sanitizeSlot(slot)}.json`),
    l0: path.join(dir, `${slot.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir).startsWith('surdet-save-recovery-')).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function snap(id: string, revision: number): Parameters<FileSaveStore['write']>[1] {
  return {
    meta: { id, createdAt: 1, updatedAt: revision },
    variables: { revision }, kind: 'manual',
    position: { sceneId: 'intro', pc: revision }, readSet: [],
    gallery: { cgs: [], music: [] },
  };
}

function plant(file: string, value: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(value));
  fs.writeFileSync(file, bytes);
  return bytes;
}

function files(dir: string): Map<string, Buffer> {
  return new Map(fs.readdirSync(dir).sort().map(name => [name, fs.readFileSync(path.join(dir, name))]));
}

describe('FileSaveStore legacy backup preservation', () => {
  it.each(['same', 'l1', 'l0'] as const)('first overwrite retains the previous %s primary for explicit restore', format => {
    const f = fixture(format === 'same' ? 'quick' : 'slot_a');
    const legacy = format === 'l0' ? f.l0 : f.l1;
    const previous = plant(legacy, snap(f.slot, 1));
    plant(`${legacy}.bak`, snap(f.slot, 0));
    expect(f.store.read(f.slot)?.variables.revision).toBe(1);

    f.store.write(f.slot, snap(f.slot, 2));

    expect(f.store.read(f.slot)?.variables.revision).toBe(2);
    expect(fs.readFileSync(f.backup)).toEqual(previous);
    expect(f.store.listBackupMeta()).toEqual([snap(f.slot, 1).meta]);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.existsSync(`${legacy}.bak`)).toBe(false);
    f.store.restoreBackup(f.slot);
    expect(f.store.read(f.slot)?.variables.revision).toBe(1);
    expect(fs.readFileSync(f.backup)).toEqual(previous);
  });

  it('chooses the L1 primary before L0 without promoting an older backup', () => {
    const f = fixture();
    plant(f.l1, snap(f.slot, 3));
    plant(`${f.l1}.bak`, snap(f.slot, 1));
    plant(f.l0, snap(f.slot, 2));
    f.store.write(f.slot, snap(f.slot, 4));
    f.store.restoreBackup(f.slot);
    expect(f.store.read(f.slot)?.variables.revision).toBe(3);
  });

  it('keeps canonical primary priority when legacy copies coexist', () => {
    const f = fixture();
    f.store.write(f.slot, snap(f.slot, 3));
    plant(f.l1, snap(f.slot, 1));
    plant(f.l0, snap(f.slot, 2));
    f.store.write(f.slot, snap(f.slot, 4));
    f.store.restoreBackup(f.slot);
    expect(f.store.read(f.slot)?.variables.revision).toBe(3);
  });

  it.each(['l1', 'l0'] as const)('keeps a backup-only %s copy on the first new write', format => {
    const f = fixture();
    const legacyBackup = `${f[format]}.bak`;
    const original = plant(legacyBackup, snap(f.slot, 1));
    f.store.write(f.slot, snap(f.slot, 2));
    expect(fs.existsSync(f.backup)).toBe(false);
    expect(fs.readFileSync(legacyBackup)).toEqual(original);
    expect(f.store.read(f.slot)?.variables.revision).toBe(2);
    f.store.restoreBackup(f.slot);
    expect(f.store.read(f.slot)?.variables.revision).toBe(1);
  });

  it.each(['foreign', 'invalid', 'unparseable'] as const)('preserves %s candidates while selecting a valid owned L0 primary', kind => {
    const f = fixture();
    const bad = kind === 'foreign' ? JSON.stringify(snap('other', 9))
      : kind === 'invalid' ? JSON.stringify({ ...snap(f.slot, 9), gallery: { cgs: [123], music: [] } })
      : '{ broken';
    fs.writeFileSync(f.l1, bad);
    fs.writeFileSync(`${f.l1}.bak`, bad);
    const valid = plant(f.l0, snap(f.slot, 1));
    f.store.write(f.slot, snap(f.slot, 2));
    expect(fs.readFileSync(f.backup)).toEqual(valid);
    expect(fs.readFileSync(f.l1, 'utf8')).toBe(bad);
    expect(fs.readFileSync(`${f.l1}.bak`, 'utf8')).toBe(bad);
    expect(fs.existsSync(f.l0)).toBe(false);
  });

  it('does not replace an existing canonical backup with an invalid legacy primary', () => {
    const f = fixture();
    const backup = plant(f.backup, snap(f.slot, 0));
    const invalid = plant(f.l1, { ...snap(f.slot, 1), gallery: { cgs: [123], music: [] } });
    f.store.write(f.slot, snap(f.slot, 2));
    expect(fs.readFileSync(f.backup)).toEqual(backup);
    expect(fs.readFileSync(f.l1)).toEqual(invalid);
    f.store.restoreBackup(f.slot);
    expect(f.store.read(f.slot)?.variables.revision).toBe(0);
  });

  it.each(['main', 'backup', 'index-before', 'index-after'] as const)('compensates failed first migration at %s and supports a clean retry', stage => {
    const f = fixture();
    plant(f.l1, snap(f.slot, 1));
    plant(`${f.l1}.bak`, snap(f.slot, 0));
    plant(f.backup, snap(f.slot, 0));
    plant(f.index, { [sanitizeSlot(f.slot)]: snap(f.slot, 1).meta });
    const before = files(f.dir);
    const rename = fs.renameSync;
    const target = stage === 'main' ? f.main : stage === 'backup' ? f.backup : f.index;
    let injected = false;
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (!injected && String(to) === target) {
        injected = true;
        if (stage === 'index-after') rename(from, to);
        throw new Error(`injected ${stage}`);
      }
      return rename(from, to);
    });
    expect(() => f.store.write(f.slot, snap(f.slot, 2))).toThrow(`injected ${stage}`);
    expect(injected).toBe(true);
    expect(files(f.dir)).toEqual(before);
    fault.mockRestore();
    f.store.write(f.slot, snap(f.slot, 2));
    f.store.restoreBackup(f.slot);
    expect(f.store.read(f.slot)?.variables.revision).toBe(1);
  });
});

describe('FileSaveStore ordinary reads require a primary', () => {
  it.each(['l1', 'l0'] as const)('does not consume a %s backup until explicit SaveManager restore', async format => {
    const f = fixture();
    plant(`${f[format]}.bak`, snap(f.slot, 1));
    const before = files(f.dir);
    const manager = new SaveManager(f.store);
    expect(f.store.list()).toEqual([]);
    expect(f.store.read(f.slot)).toBeNull();
    expect(await manager.has(f.slot)).toBe(false);
    await expect(manager.load(f.slot)).rejects.toThrow(/不存在/);
    expect(await manager.listBackupMeta()).toEqual([snap(f.slot, 1).meta]);
    expect(files(f.dir)).toEqual(before);
    await manager.restoreBackup(f.slot);
    expect(await manager.has(f.slot)).toBe(true);
    expect((await manager.load(f.slot)).variables.revision).toBe(1);
  });

  it('does not let an L1 backup shadow a valid L0 primary', () => {
    const f = fixture();
    plant(`${f.l1}.bak`, snap(f.slot, 0));
    plant(f.l0, snap(f.slot, 1));
    const before = files(f.dir);
    expect(f.store.read(f.slot)?.variables.revision).toBe(1);
    expect(files(f.dir)).toEqual(before);
  });

  it.each(['main', 'l1', 'l0'] as const)('a corrupt %s primary still throws rather than consuming its backup', format => {
    const f = fixture();
    fs.writeFileSync(f[format], '{ broken');
    plant(`${f[format]}.bak`, snap(f.slot, 1));
    const before = files(f.dir);
    expect(() => f.store.read(f.slot)).toThrow(/读取或解析失败/);
    expect(files(f.dir)).toEqual(before);
  });
});

describe('FileSaveStore explicit deletion keeps its existing ownership contract', () => {
  it.each(['l1', 'l0'] as const)('deletes parseable owned %s files even if their snapshot fields are invalid', format => {
    const f = fixture();
    const invalid = { ...snap(f.slot, 1), gallery: { cgs: [123], music: [] } };
    plant(f[format], invalid);
    plant(`${f[format]}.bak`, invalid);
    f.store.delete(f.slot);
    expect(files(f.dir)).toEqual(new Map());
  });

  it.each(['foreign', 'unknown', 'unparseable'] as const)('keeps %s legacy files during explicit deletion', kind => {
    const f = fixture();
    const value = kind === 'foreign' ? JSON.stringify(snap('other', 1))
      : kind === 'unknown' ? JSON.stringify({ variables: {} }) : '{ broken';
    fs.writeFileSync(f.l1, value);
    fs.writeFileSync(`${f.l1}.bak`, value);
    const before = files(f.dir);
    f.store.delete(f.slot);
    expect(files(f.dir)).toEqual(before);
  });

  it('explicitly deletes a corrupt canonical main and backup by their unambiguous physical identity', () => {
    const f = fixture();
    fs.writeFileSync(f.main, '{ broken');
    fs.writeFileSync(f.backup, '{ broken');
    f.store.delete(f.slot);
    expect(files(f.dir)).toEqual(new Map());
  });

  it('compensates an unlink failure without losing owned invalid legacy files', () => {
    const f = fixture();
    const invalid = { ...snap(f.slot, 1), gallery: { cgs: [123], music: [] } };
    plant(f.l1, invalid);
    plant(`${f.l1}.bak`, invalid);
    const before = files(f.dir);
    const unlink = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation(file => {
      if (String(file) === `${f.l1}.bak`) throw new Error('injected backup unlink');
      unlink(file);
    });
    expect(() => f.store.delete(f.slot)).toThrow('injected backup unlink');
    expect(files(f.dir)).toEqual(before);
  });
});

describe('FileSaveStore explicit restore failure compensation', () => {
  it.each([
    ['existing', 'main'], ['existing', 'index-before'], ['existing', 'index-after'],
    ['absent', 'main'], ['absent', 'index-before'], ['absent', 'index-after'],
  ] as const)('keeps %s main/index bytes and all backups when restore fails at %s', (state, stage) => {
    const f = fixture();
    plant(`${f.l1}.bak`, snap(f.slot, 1));
    if (state === 'existing') {
      plant(f.main, snap(f.slot, 2));
      plant(f.index, { [f.slot]: snap(f.slot, 2).meta });
    }
    const before = files(f.dir);
    const rename = fs.renameSync;
    const target = stage === 'main' ? f.main : f.index;
    let injected = false;
    const fault = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (!injected && String(to) === target) {
        injected = true;
        if (stage === 'index-after') rename(from, to);
        throw new Error(`injected restore ${stage}`);
      }
      return rename(from, to);
    });
    expect(() => f.store.restoreBackup(f.slot)).toThrow(`injected restore ${stage}`);
    expect(injected).toBe(true);
    expect(files(f.dir)).toEqual(before);
    fault.mockRestore();
    f.store.restoreBackup(f.slot);
    expect(f.store.read(f.slot)?.variables.revision).toBe(1);
    expect(fs.readFileSync(`${f.l1}.bak`)).toEqual(before.get(path.basename(`${f.l1}.bak`)));
  });

  it('rejects a corrupt index before writing a valid backup into the main', () => {
    const f = fixture();
    plant(f.backup, snap(f.slot, 1));
    plant(f.main, snap(f.slot, 2));
    fs.writeFileSync(f.index, '{ broken');
    const before = files(f.dir);
    expect(() => f.store.restoreBackup(f.slot)).toThrow(/索引/);
    expect(files(f.dir)).toEqual(before);
  });
});
