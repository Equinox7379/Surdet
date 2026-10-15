import { afterEach, expect, it, type TestContext } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeJsonAtomic } from '../src/json-file.js';
import { FileSaveStore, canonicalSlotStem } from '../src/save-store.js';
import { FileProfileStore } from '../src/profile-store.js';
import { writeCrashReport } from '../src/crash-reporter.js';

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-write-boundary-')); roots.push(root);
  const storage = path.join(root, 'storage'), outside = path.join(root, 'outside');
  fs.mkdirSync(storage); fs.mkdirSync(outside);
  const victim = path.join(outside, 'keep.txt'); fs.writeFileSync(victim, 'keep');
  return { root, storage, outside, victim };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function link(ctx: TestContext, target: string, file: string, directory = false) {
  try { fs.symlinkSync(target, file, directory && process.platform === 'win32' ? 'junction' : directory ? 'dir' : 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) ctx.skip(); throw error; }
}
function snap(value: number) {
  return { meta: { id: 'slot', createdAt: 1, updatedAt: value }, kind: 'manual' as const,
    variables: { trust: value }, position: { sceneId: 'intro', pc: 0 }, readSet: [], gallery: { cgs: [], music: [], texts: [] } };
}
it('ignores a planted old JSON temporary without changing its target or consuming the link', ctx => {
  const { storage, victim } = fixture(), file = path.join(storage, 'settings.json');
  link(ctx, victim, `${file}.tmp`);
  writeJsonAtomic(file, { volume: 0.5 });
  expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
  expect(fs.lstatSync(`${file}.tmp`).isSymbolicLink()).toBe(true);
  expect(fs.lstatSync(file).isFile()).toBe(true);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ volume: 0.5 });
});
it('refuses final JSON links, including dangling links, without replacing them', ctx => {
  const { storage, victim, outside } = fixture();
  for (const target of [victim, path.join(outside, 'missing')]) {
    const file = path.join(storage, path.basename(target) + '.json'); link(ctx, target, file);
    expect(() => writeJsonAtomic(file, { changed: true })).toThrow(/普通文件/);
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
  }
  expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
  expect(fs.existsSync(path.join(outside, 'missing'))).toBe(false);
});
it('does not remove an unrelated directory occupying the old temporary name', () => {
  const { storage } = fixture(), file = path.join(storage, 'settings.json');
  fs.mkdirSync(`${file}.tmp`); fs.writeFileSync(path.join(`${file}.tmp`, 'keep'), 'keep');
  writeJsonAtomic(file, { value: 1 });
  expect(fs.readFileSync(path.join(`${file}.tmp`, 'keep'), 'utf8')).toBe('keep');
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ value: 1 });
});
it('overlapping writers have different temporaries and cannot steal each other publication', () => {
  const { storage } = fixture(), file = path.join(storage, 'settings.json'); const sources: string[] = [];
  const inner = { ...fs, renameSync: (from: fs.PathLike, to: fs.PathLike) => { sources.push(String(from)); fs.renameSync(from, to); } };
  writeJsonAtomic(file, { value: 'outer' }, { ...fs, renameSync: (from, to) => {
    sources.push(String(from)); writeJsonAtomic(file, { value: 'inner' }, inner); fs.renameSync(from, to);
  } });
  expect(new Set(sources).size).toBe(2);
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ value: 'outer' });
  expect(fs.readdirSync(storage)).toEqual(['settings.json']);
});
it('cleans a partial own write without changing the last complete JSON', () => {
  const { storage } = fixture(), file = path.join(storage, 'settings.json'); writeJsonAtomic(file, { before: true });
  expect(() => writeJsonAtomic(file, { after: true }, { ...fs, writeFileSync: (target) => {
    fs.writeFileSync(target, '{'); throw new Error('partial write');
  } })).toThrow('partial write');
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ before: true });
  expect(fs.readdirSync(storage)).toEqual(['settings.json']);
});
it('save, backup restore and failed index compensation ignore all planted legacy temporary names', ctx => {
  const { storage, victim } = fixture(), store = new FileSaveStore(storage);
  const file = path.join(storage, `${canonicalSlotStem('slot')}.json`);
  for (const name of [`${file}.tmp`, `${file}.bak.tmp`, `${file}.restore.tmp`, path.join(storage, 'index.json.tmp'), path.join(storage, 'index.json.restore.tmp')]) link(ctx, victim, name);
  store.write('slot', snap(1)); store.write('slot', snap(2)); store.restoreBackup('slot');
  expect(store.read('slot')?.variables.trust).toBe(1);
  const internals = store as unknown as { writeIndex(value: unknown): void }, original = internals.writeIndex.bind(store);
  internals.writeIndex = value => { original(value); throw new Error('index published then failed'); };
  expect(() => store.write('slot', snap(3))).toThrow('index published then failed');
  expect(store.read('slot')?.variables.trust).toBe(1);
  expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
  expect(fs.lstatSync(file).isFile()).toBe(true);
  expect(fs.lstatSync(path.join(storage, 'index.json')).isFile()).toBe(true);
});
it('refuses a linked index before changing the slot', ctx => {
  const { storage, victim } = fixture(), store = new FileSaveStore(storage);
  link(ctx, victim, path.join(storage, 'index.json'));
  expect(() => store.write('slot', snap(1))).toThrow(/普通文件/);
  expect(fs.existsSync(path.join(storage, `${canonicalSlotStem('slot')}.json`))).toBe(false);
  expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
});
it('rejects linked save/profile/crash roots without writing into them', async ctx => {
  const { storage, outside, victim } = fixture();
  for (const name of ['saves', 'profile', 'crash-reports']) link(ctx, outside, path.join(storage, name), true);
  expect(() => new FileSaveStore(path.join(storage, 'saves'))).toThrow(/普通目录/);
  await expect(new FileProfileStore(path.join(storage, 'profile')).write('game', { score: 1 })).rejects.toThrow(/普通目录/);
  expect(writeCrashReport(storage, { error: 'test' })).toBeNull();
  expect(fs.readdirSync(outside)).toEqual(['keep.txt']); expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
});
