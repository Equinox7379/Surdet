import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync), readFileSync: vi.fn(actual.readFileSync) };
});

describe('lint JSON command failures from source', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-lint-json-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function lint(target: string, json = true): Promise<{ stdout: string; stderr: string; status: string | number | undefined }> {
    const argv = process.argv;
    const exitCode = process.exitCode;
    let stdout = '';
    let stderr = '';
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { stdout += String(chunk); return true; });
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { stderr += String(chunk); return true; });
    try {
      process.argv = [process.execPath, 'surdet', 'lint', target, ...(json ? ['--json'] : [])];
      process.exitCode = undefined;
      vi.resetModules();
      await import('../src/index.js');
      await vi.waitFor(() => expect(process.exitCode).toBeDefined());
      return { stdout, stderr, status: process.exitCode };
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      out.mockRestore();
      err.mockRestore();
    }
  }

  function writeScene(): string {
    const file = path.join(root, 'content/scenario/start.gal');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '@scene start\n正文\n@end');
    return file;
  }

  function expectFailure(result: Awaited<ReturnType<typeof lint>>, location: string, message: string): void {
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    const envelope = JSON.parse(result.stdout);
    expect(envelope).toMatchObject({ ok: false, sceneCount: 0 });
    expect(envelope.issues).toContainEqual(expect.objectContaining({
      severity: 'error', code: 'PROJECT_READ', file: location, line: 0, col: 0,
      text: expect.stringContaining(message), hint: expect.any(String),
    }));
  }

  it.each(['missing', 'file'])('keeps %s project input failures in a failed JSON envelope', async kind => {
    const target = path.join(root, kind);
    if (kind === 'file') fs.writeFileSync(target, '{}');
    expectFailure(await lint(target), target, kind === 'missing' ? 'ENOENT' : '不是目录');
  });

  it.each(['EACCES', 'EIO'])('keeps directory discovery %s in JSON with its failing path', async code => {
    writeScene();
    const directory = path.join(root, 'content/scenario');
    const { readdirSync: original } = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(fs.readdirSync).mockImplementation(((...args: Parameters<typeof fs.readdirSync>) => {
      if (args[0] === directory) throw Object.assign(new Error(`test discovery ${code}`), { code, path: directory });
      return original(...args);
    }) as typeof fs.readdirSync);
    expectFailure(await lint(root), directory, `test discovery ${code}`);
  });

  it('keeps a scene read failure in JSON without claiming checked scenes', async () => {
    const file = writeScene();
    const { readFileSync: original } = await vi.importActual<typeof import('node:fs')>('node:fs');
    vi.mocked(fs.readFileSync).mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === file) throw Object.assign(new Error('test scene read EIO'), { code: 'EIO', path: file });
      return original(...args);
    }) as typeof fs.readFileSync);
    expectFailure(await lint(root), file, 'test scene read EIO');
  });

  it('keeps rejected internal links as errors in JSON', async () => {
    const outside = path.join(root, 'outside');
    const linked = path.join(root, 'content/scenario');
    fs.mkdirSync(outside);
    fs.mkdirSync(path.dirname(linked));
    fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      expectFailure(await lint(root), root, '链接');
      expect(fs.lstatSync(linked).isSymbolicLink()).toBe(true);
    } finally {
      fs.unlinkSync(linked);
    }
  });

  it('preserves the empty-project failure and valid-project success envelopes', async () => {
    const empty = await lint(root);
    expect(empty.status).toBe(1);
    expect(JSON.parse(empty.stdout)).toMatchObject({ ok: false, sceneCount: 0, issues: expect.arrayContaining([expect.objectContaining({ code: 'PROJECT_EMPTY' })]) });
    writeScene();
    const valid = await lint(root);
    expect(valid.status).toBe(0);
    expect(valid.stderr).toBe('');
    expect(JSON.parse(valid.stdout)).toMatchObject({ ok: true, sceneCount: 1 });
  });

  it('continues to report filesystem failures in the existing text error channel without --json', async () => {
    const result = await lint(path.join(root, 'missing'), false);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('ENOENT');
  });
});
