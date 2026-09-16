import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function root() { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-command-input-')); roots.push(value); return value; }
function run(cwd: string, args: string[]) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }); }

describe('fresh native CLI arguments', () => {
  it('authorizes image sources and shares the environment data root across fresh CLI calls', () => {
    const cwd = root(); const project = path.join(cwd, 'project'); const source = path.join(cwd, 'images');
    fs.mkdirSync(path.join(project, 'content/scenario'), { recursive: true }); fs.mkdirSync(source);
    fs.writeFileSync(path.join(project, 'game.config.json'), '{"entryScene":"start","variables":{}}');
    fs.writeFileSync(path.join(project, 'content/scenario/start.gal'), '@scene start\n正文\n@end');
    fs.writeFileSync(path.join(source, 'night.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Y9sAAAAASUVORK5CYII=', 'base64'));
    const env = { ...process.env, SURDET_AGENT_DATA_DIR: path.join(cwd, 'agent'), SURDET_EDITOR_ASSET_IMPORT_DATA_ROOT: path.join(cwd, 'imports'), LOCALAPPDATA: path.join(cwd, 'default') };
    const invoke = (command: string[], input: unknown) => {
      const file = path.join(cwd, 'request.json'); fs.writeFileSync(file, JSON.stringify(input));
      const executed = spawnSync(process.execPath, [cli, ...command, '--project', project, '--asset-source', source, '--input', file], { cwd, env, encoding: 'utf8' });
      const envelope = JSON.parse(executed.stdout);
      expect(envelope, executed.stderr || executed.stdout).toMatchObject({ ok: true });
      return envelope.result;
    };
    const sourceId = invoke(['asset', 'sources'], {}).roots[0].sourceId;
    const fact = invoke(['asset', 'sources'], { sourceId, path: 'night.png' }).file;
    const operationId = randomUUID();
    const staged = invoke(['asset', 'import', 'stage'], { operationId, items: [{ itemId: randomUUID(), sourceId, sourcePath: 'night.png', sha256: fact.sha256, kind: 'background', fileName: 'night.png' }] });
    expect(staged.operation.status).toBe('READY');
    expect(invoke(['asset', 'import', 'inspect'], { operationId }).operation.status).toBe('READY');
    expect(fs.existsSync(path.join(cwd, 'default'))).toBe(false);
    expect(fs.existsSync(path.join(project, 'content/assets/bg/night.png'))).toBe(false);
  }, 30_000);
  it('does not pass JSON lint when no scene was checked', () => {
    const cwd = root(); const file = path.join(cwd, 'file.json'); fs.writeFileSync(file, '{}');
    for (const target of [undefined, cwd, path.join(cwd, 'missing'), file]) {
      const result = run(cwd, ['lint', ...(target === undefined ? [] : [target]), '--json']);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, sceneCount: 0 });
    }
    expect(run(cwd, ['lint', '', '--json']).status).toBe(1);
  });
  it.each(['lint', 'stats', 'audit', 'build', 'manifest', 'pack'])('%s rejects unknown flags before filesystem actions', command => {
    const cwd = root(); const result = run(cwd, [command, '--typo']);
    expect(result.status).toBe(1); expect(result.stderr).toContain('不支持参数 --typo');
    expect(fs.readdirSync(cwd)).toEqual([]);
  });
  it('keeps simulate flag values distinct from same-named positional paths and rejects invalid budgets', () => {
    const cwd = root(); const game = path.join(cwd, '7'); fs.mkdirSync(path.join(game, 'content/scenario'), { recursive: true });
    fs.writeFileSync(path.join(game, 'game.config.json'), '{"entryScene":"start","variables":{}}');
    fs.writeFileSync(path.join(game, 'content/scenario/start.gal'), '@scene start\n正文\n@end');
    expect(run(cwd, ['simulate', '--seed', '7', '7', '--json']).status).toBe(0);
    for (const flag of ['--max-paths', '--max-steps']) for (const value of [undefined, '0', '-1', 'bad']) {
      expect(run(cwd, ['simulate', game, '--json', flag, ...(value === undefined ? [] : [value])]).status).toBe(1);
    }
  }, 20_000);
});
