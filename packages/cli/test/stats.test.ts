import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { statsCommand } from '../src/stats.js';

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-stats-'));
  fs.mkdirSync(path.join(dir, 'content/scenario'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'game.config.json'), JSON.stringify({ entryScene: 'a' }));
  fs.writeFileSync(path.join(dir, 'content/scenario/a.gal'), '@scene a\n凛：你好\n@jump b\n');
  fs.writeFileSync(path.join(dir, 'content/scenario/b.gal'), '@scene b\n@clear done\n');
  return dir;
}

describe('statsCommand', () => {
  it.each(['', '\r\n  ', 'null', '[]', '42', '"text"'])('rejects a present invalid configuration root (%j)', async text => {
    const dir = makeProject();
    const file = path.join(dir, 'game.config.json');
    fs.writeFileSync(file, text);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await statsCommand(dir, { json: true })).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([value]) => String(value)).join('')).toContain('game.config.json');
      expect(fs.readFileSync(file, 'utf8')).toBe(text);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      fs.rmSync(dir, { recursive: true });
    }
  });
  it('writes parseable JSON with deterministic project metrics', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const code = await statsCommand(makeProject(), { json: true });
    expect(code).toBe(0);
    const output = stdout.mock.calls.map(([value]) => String(value)).join('');
    expect(JSON.parse(output)).toMatchObject({ sceneCount: 2, endingCount: 1, reachableScenes: ['a', 'b'] });
    stdout.mockRestore();
  });

  it('returns 1 and writes diagnostics to stderr for an invalid project', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const code = await statsCommand(path.join(os.tmpdir(), 'missing-surdet-stats-project'), { json: true });
    expect(code).toBe(1);
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });
});
