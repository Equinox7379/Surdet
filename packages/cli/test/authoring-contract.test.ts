import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliEntry = path.join(repoRoot, 'packages/cli/dist/index.js');

function runCli(args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('agent authoring CLI JSON contract', () => {
  it('finishes delayed stdout and stderr writes before exiting, preserving success and failure codes', () => {
    // Windows terminals can write asynchronously too. Delay the real writes to
    // make premature exit deterministic without depending on an OS pipe size.
    const delayWrites = `for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write;
      stream.write = function (...args) { setTimeout(() => write.apply(this, args), 25); return true; };
    }`;
    const run = (args: string[]) => spawnSync(process.execPath,
      ['--import', `data:text/javascript,${encodeURIComponent(delayWrites)}`, cliEntry, ...args],
      { cwd: repoRoot, encoding: 'utf8', timeout: 10000 });
    const success = run(['capabilities', 'describe', '--json']);
    expect(success.status).toBe(0);
    expect(success.stderr).toBe('');
    expect(success.stdout.length).toBeGreaterThan(65536);
    expect(JSON.parse(success.stdout).result.capabilities).toHaveLength(73);
    const failure = run(['lint', '--not-a-valid-option']);
    expect(failure.status).toBe(1);
    expect(failure.stdout).toBe('');
    expect(failure.stderr).toContain('不支持参数 --not-a-valid-option');
  });

  it('describes exactly the registered capabilities with one JSON stdout document', () => {
    const result = runCli(['capabilities', 'describe', '--json']);

    expect(result.status).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout.trim().startsWith('{')).toBe(true);
    expect(result.stdout.trim().endsWith('}')).toBe(true);
    expect(result.stderr).toBe('');
    const body = JSON.parse(result.stdout);
    expect(body.contractVersion).toBe('2.33.0');
    expect(body.result.capabilities).toHaveLength(73);
    expect(body.result.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'gallery.text.create', mcpTool: 'surdet_gallery_text_create', composable: false }),
      expect.objectContaining({ id: 'gallery.text.patch', mcpTool: 'surdet_gallery_text_patch', composable: false }),
      expect.objectContaining({ id: 'gallery.ending.create', mcpTool: 'surdet_gallery_ending_create', composable: false }),
      expect.objectContaining({ id: 'gallery.ending.patch', mcpTool: 'surdet_gallery_ending_patch', composable: false }),
    ]));
    expect(body.result.capabilities[0]).toEqual(expect.objectContaining({
      id: 'capabilities.describe',
      mcpTool: 'surdet_capabilities_describe',
      minimumPolicy: 'observe',
      inputSchema: expect.any(Object),
      outputSchema: expect.any(Object),
    }));
  });

  it('returns a structured failure envelope without a stack on the default error path', () => {
    const missing = path.join(os.tmpdir(), `surdet-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const result = runCli(['project', 'inspect', '--project', missing, '--json']);
    const body = JSON.parse(result.stdout) as { schemaVersion: string; ok: boolean; error?: { code: string } };

    expect(result.status).not.toBe(0);
    expect(body.schemaVersion).toBe('1.0.0');
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('PROJECT_NOT_FOUND');
    expect(result.stderr).toBe('');
  });

  it('dispatches gallery read/create/patch through the real native CLI without writing the project', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-gallery-cli-'));
    const root = path.join(fixture, 'project');
    fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
    writeJson(path.join(root, 'game.config.json'), { entryScene: 'start', variables: {} });
    fs.writeFileSync(path.join(root, 'content/scenario/start.gal'), '@scene start\n@end\n');
    const env = { SURDET_AGENT_DATA_DIR: path.join(fixture, 'data') };
    expect(JSON.parse(runCli(['project', 'gallery', '--project', root, '--json'], env).stdout)).toMatchObject({ ok: true, result: { cgs: [], view: 'project' } });
    const begun = runCli(['change', 'begin', '--project', root, '--json'], env);
    expect(begun.status).toBe(0);
    const changeId = JSON.parse(begun.stdout).result.changeId as string;
    const input = path.join(fixture, 'input.json');
    writeJson(input, { operationId: 'create-cg', id: 'night', name: '夜色' });
    const created = runCli(['gallery', 'cg', 'create', '--change', changeId, '--input', input, '--json'], env);
    expect(created.status, created.stderr || created.stdout).toBe(0);
    const body = JSON.parse(created.stdout);
    expect(body).toMatchObject({ ok: true, result: { entry: { id: 'night', name: '夜色' } } });
    writeJson(input, { operationId: 'patch-cg', id: 'night', expectedFingerprint: body.result.fingerprint, patch: { name: '归途' } });
    const patched = runCli(['gallery', 'cg', 'patch', '--change', changeId, '--input', input, '--json'], env);
    expect(patched.status, patched.stderr || patched.stdout).toBe(0);
    expect(JSON.parse(patched.stdout)).toMatchObject({ ok: true, result: { entry: { id: 'night', name: '归途' } } });
    const reopened = runCli(['project', 'gallery', '--project', root, '--change', changeId, '--json'], env);
    expect(JSON.parse(reopened.stdout)).toMatchObject({ ok: true, result: { view: 'working', cgs: [{ id: 'night', name: '归途' }] } });
    expect(fs.existsSync(path.join(root, 'content/config/gallery.json'))).toBe(false);
  });

  it('reads and patches one UI node through the public CLI while keeping source separate', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-ui-cli-'));
    const root = path.join(fixture, 'project');
    fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
    writeJson(path.join(root, 'game.config.json'), { entryScene: 'start', variables: { trust: { type: 'number', initial: 3 } } });
    fs.writeFileSync(path.join(root, 'content/scenario/start.gal'), '@scene start\n@end\n');
    const env = { SURDET_AGENT_DATA_DIR: path.join(fixture, 'data') };
    const read = JSON.parse(runCli(['project', 'ui', '--project', root, '--json'], env).stdout);
    expect(read).toMatchObject({ ok: true, result: { view: 'project', value: null } });
    const changeId = JSON.parse(runCli(['change', 'begin', '--project', root, '--json'], env).stdout).result.changeId as string;
    const input = path.join(fixture, 'input.json');
    const frame = { x: 0, y: 0, width: 1280, height: 720 };
    writeJson(input, { operationId: 'ui-set', expectedFingerprint: read.result.fingerprint,
      patch: { type: 'page.set', page: 'hud', root: { id: 'hud-root', type: 'container', frame, children: [
        { id: 'trust', type: 'text', frame: { x: 20, y: 20, width: 180, height: 40 }, text: { kind: 'variable', name: 'trust' } },
      ] } } });
    const applied = runCli(['project', 'ui', 'patch', '--change', changeId, '--input', input, '--json'], env);
    expect(applied.status, applied.stdout).toBe(0);
    const workingInput = path.join(fixture, 'working.json');
    writeJson(workingInput, { view: 'working' });
    const working = JSON.parse(runCli(['project', 'ui', '--project', root, '--change', changeId, '--input', workingInput, '--json'], env).stdout);
    expect(working).toMatchObject({ ok: true, result: { view: 'working', nodes: [
      { id: 'hud-root', parentId: null }, { id: 'trust', parentId: 'hud-root' },
    ] } });
    writeJson(input, { operationId: 'ui-move', expectedFingerprint: working.result.fingerprint,
      patch: { type: 'node.update', page: 'hud', id: 'trust', patch: { frame: { x: 36, y: 24, width: 180, height: 40 } } } });
    expect(runCli(['project', 'ui', 'patch', '--change', changeId, '--input', input, '--json'], env).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).ui).toBeUndefined();
    expect(JSON.parse(runCli(['project', 'ui', '--project', root, '--change', changeId, '--input', workingInput, '--json'], env).stdout).result.value.pages.hud.children[0].frame.x).toBe(36);
  });

  it('rejects unknown input fields before service dispatch', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-contract-root-'));
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-contract-data-'));
    fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
    fs.writeFileSync(path.join(root, 'content/scenario/start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
    const env = { SURDET_AGENT_DATA_DIR: data };
    const begun = runCli(['change', 'begin', '--project', root, '--json'], env);
    expect(begun.status).toBe(0);
    const changeId = JSON.parse(begun.stdout).result.changeId as string;
    const input = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-contract-input-')), 'invalid-scene.json');
    writeJson(input, { operationId: 'op-invalid', sceneId: 'blocked', projectRoot: root });
    const before = fs.readdirSync(root, { recursive: true });
    const result = runCli(['scene', 'create', '--change', changeId, '--input', input, '--json'], env);
    const body = JSON.parse(result.stdout);
    expect(result.status).toBe(1);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(fs.readdirSync(root, { recursive: true })).toEqual(before);
  });

  it('returns repairActions instead of retriable/action', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-contract-inspect-'));
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-contract-inspect-data-'));
    fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
    fs.writeFileSync(path.join(root, 'content/scenario/start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
    const result = runCli(['object', 'inspect', '--project', root, '--ref', 'scene:missing', '--json'], { SURDET_AGENT_DATA_DIR: data });
    const body = JSON.parse(result.stdout);
    expect(result.status).toBe(1);
    expect(body.error.retryDisposition).toBe('after-inspect');
    expect(body.error.repairActions).toEqual(expect.any(Array));
    expect(body.error).not.toHaveProperty('retriable');
    expect(body.error).not.toHaveProperty('action');
  });
});
