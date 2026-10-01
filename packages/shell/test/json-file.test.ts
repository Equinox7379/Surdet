import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeJsonAtomic, type JsonFileOps } from '../src/json-file.js';

function makeDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-json-file-'));
}

describe('writeJsonAtomic', () => {
  it('先写临时文件再 rename，留下完整 JSON 且不删除无关文件', () => {
    const dir = makeDir();
    const file = path.join(dir, 'settings.json');
    const unrelated = path.join(dir, 'keep.txt');
    fs.writeFileSync(unrelated, 'keep', 'utf8');

    writeJsonAtomic(file, { volume: 0.7, nested: { ok: true } });

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ volume: 0.7, nested: { ok: true } });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('keep');
    writeJsonAtomic(file, { volume: 0.4 });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ volume: 0.4 });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('keep');
  });

  it('rename 失败时只清理自己的临时文件并重新抛出原错误', () => {
    const dir = makeDir();
    const file = path.join(dir, 'window-state.json');
    const unrelated = path.join(dir, 'keep.txt');
    fs.writeFileSync(unrelated, 'keep', 'utf8');
    const failure = new Error('rename failed');
    const unlinkSync = vi.fn((target: fs.PathLike) => fs.unlinkSync(target));
    const ops: JsonFileOps = {
      writeFileSync: fs.writeFileSync,
      renameSync: () => { throw failure; },
      existsSync: fs.existsSync,
      unlinkSync,
    };

    expect(() => writeJsonAtomic(file, { x: 1 }, ops)).toThrow(failure);
    expect(unlinkSync).toHaveBeenCalledWith(`${file}.tmp`);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('keep');
  });
});
