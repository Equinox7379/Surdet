import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cliEntry = path.join(repoRoot, 'packages/cli/dist/index.js');

function runCli(args: string[], env: NodeJS.ProcessEnv): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeJson(dir: string, name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  return file;
}

function fingerprint(raw: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index++) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function body(result: { stdout: string }): any {
  return JSON.parse(result.stdout) as any;
}

describe('agent authoring CLI vertical slice', () => {
  // 主链串行 spawn 多个 CLI 子进程；R5 change-isolation 测试加入后并行负载挤爆默认 5s
  // 预算——按 wave2 先例显式放宽为纯时间预算修正（非生产回归）。
  it('keeps changes outside the project until commit and then commits only the intended files', { timeout: 15000 }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-authoring-cli-'));
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-authoring-data-'));
    fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'agent', variables: {} }), 'utf8');
    fs.writeFileSync(path.join(root, 'content/scenario/prologue.gal'), '@scene prologue\n凛：基础。\n@end\n', 'utf8');
    const originalConfig = fs.readFileSync(path.join(root, 'game.config.json'), 'utf8');
    const originalScene = fs.readFileSync(path.join(root, 'content/scenario/prologue.gal'), 'utf8');
    const env = { SURDET_AGENT_DATA_DIR: data };

    const begun = runCli(['change', 'begin', '--project', root, '--json'], env);
    expect(begun.status).toBe(0);
    const changeId = body(begun).changeId as string;
    expect(changeId).toMatch(/^chg_/);

    const requestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-authoring-input-'));
    const variableInput = writeJson(requestDir, 'variable.json', {
      operationId: 'op-variable', name: 'trust', type: 'number', initial: 0,
    });
    expect(runCli(['variable', 'ensure', '--change', changeId, '--input', variableInput, '--json'], env).status).toBe(0);

    const sceneInput = writeJson(requestDir, 'scene.json', {
      operationId: 'op-scene',
      sceneId: 'agent',
      blocks: [
        { kind: 'text', speaker: '凛', value: '开始。' },
        {
          kind: 'choice',
          options: [
            { label: '正向', effects: [{ name: 'set', args: ['trust', '=', '1'] }], target: { kind: 'jump', value: 'agent.missing' } },
            { label: '负向', effects: [{ name: 'set', args: ['trust', '=', '-1'] }], target: { kind: 'goto', value: 'negative' } },
          ],
        },
        { kind: 'label', name: 'positive' },
        { kind: 'text', speaker: '凛', value: '正向。' },
        { kind: 'label', name: 'negative' },
        { kind: 'text', speaker: '凛', value: '负向。' },
      ],
    });
    expect(runCli(['scene', 'create', '--change', changeId, '--input', sceneInput, '--json'], env).status).toBe(0);

    const invalidValidation = runCli(['project', 'validate', '--change', changeId, '--json'], env);
    expect(invalidValidation.status).toBe(0);
    const invalidBody = body(invalidValidation);
    const issue = invalidBody.result.issues.find((candidate: any) => candidate.code === 'J002');
    expect(issue.objectRef).toContain('choice-option');
    expect(issue.action).toContain('创建或修正标签');
    expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toBe(originalConfig);
    expect(fs.readFileSync(path.join(root, 'content/scenario/prologue.gal'), 'utf8')).toBe(originalScene);
    expect(fs.existsSync(path.join(root, 'content/scenario/agent.gal'))).toBe(false);

    const patchInput = writeJson(requestDir, 'patch.json', {
      operationId: 'op-patch',
      sceneId: 'agent',
      patch: {
        kind: 'replaceChoiceOption',
        target: issue.objectRef,
        expectedFingerprint: fingerprint('  正向 -> @set trust = 1 @jump agent.missing'),
        option: { label: '正向', effects: [{ name: 'set', args: ['trust', '=', '1'] }], target: { kind: 'jump', value: 'agent.positive' } },
      },
    });
    expect(runCli(['scene', 'patch', '--change', changeId, '--input', patchInput, '--json'], env).status).toBe(0);

    const valid = runCli(['project', 'validate', '--change', changeId, '--json'], env);
    expect(valid.status).toBe(0);
    expect(body(valid).result.ok).toBe(true);

    const simulated = runCli(['project', 'simulate', '--change', changeId, '--json'], env);
    expect(simulated.status).toBe(0);
    expect(body(simulated).result.choiceBranches).toEqual({ total: 2, visited: 2 });

    const runtimeAInput = writeJson(requestDir, 'runtime-a.json', { sceneId: 'agent', choices: [0], seed: 701 });
    const runtimeBInput = writeJson(requestDir, 'runtime-b.json', { sceneId: 'agent', choices: [1], seed: 702 });
    const runtimeA = runCli(['runtime', 'run-from', '--change', changeId, '--input', runtimeAInput, '--json'], env);
    const runtimeB = runCli(['runtime', 'run-from', '--change', changeId, '--input', runtimeBInput, '--json'], env);
    expect(runtimeA.status).toBe(0);
    expect(runtimeB.status).toBe(0);
    const runtimeABody = body(runtimeA);
    const runtimeBBody = body(runtimeB);
    expect(runtimeABody.result.finalVariables.trust).toBe(1);
    expect(runtimeBBody.result.finalVariables.trust).toBe(-1);
    expect(runtimeABody.result.traceId).not.toBe(runtimeBBody.result.traceId);

    const traceQuery = writeJson(requestDir, 'trust-trace-query.json', { variable: 'trust' });
    const traceA = runCli(['runtime', 'read-trace', '--change', changeId, '--trace', runtimeABody.result.traceId, '--query', traceQuery, '--json'], env);
    const traceB = runCli(['runtime', 'read-trace', '--change', changeId, '--trace', runtimeBBody.result.traceId, '--query', traceQuery, '--json'], env);
    expect(traceA.status).toBe(0);
    expect(traceB.status).toBe(0);
    expect(body(traceA).result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'state',
        stateDelta: expect.arrayContaining([expect.objectContaining({ variable: 'trust', after: 1 })]),
      }),
    ]));
    expect(body(traceB).result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'state',
        stateDelta: expect.arrayContaining([expect.objectContaining({ variable: 'trust', after: -1 })]),
      }),
    ]));

    const diff = runCli(['change', 'diff', '--change', changeId, '--json'], env);
    expect(diff.status).toBe(0);
    expect(body(diff).result.files.some((file: any) => file.path.endsWith('agent.gal'))).toBe(true);

    const committed = runCli(['change', 'commit', '--change', changeId, '--json'], env);
    expect(committed.status).toBe(0);
    expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toContain('trust');
    expect(fs.readFileSync(path.join(root, 'content/scenario/agent.gal'), 'utf8')).toContain('@jump agent.positive');
    expect(fs.readFileSync(path.join(root, 'content/scenario/prologue.gal'), 'utf8')).toBe(originalScene);
  });
});
