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

function body(result: { stdout: string }): any {
  return JSON.parse(result.stdout) as any;
}

function fingerprint(raw: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < raw.length; index++) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function fixtureProject(): { root: string; data: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave3-cli-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave3-data-'));
  fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content/assets/avatar'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({
    title: 'Starter', version: '0.1.0', entryScene: 'ch01_01',
    characters: { lynn: { name: '凛', avatar: 'lynn' } },
    variables: {},
  }), 'utf8');
  fs.writeFileSync(path.join(root, 'content/scenario/ch01_01.gal'), '@scene ch01_01\n凛：基础。\n@end\n', 'utf8');
  fs.writeFileSync(path.join(root, 'content/assets/avatar/lynn.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
  fs.writeFileSync(path.join(root, 'content/assets/avatar/nova.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
  return { root, data };
}

describe('agent authoring project config wave 3 CLI vertical slice', () => {
  // 主链串行 spawn 多个 CLI 子进程；R5 change-isolation 测试加入后并行负载挤爆默认 5s
  // 预算——按 wave2 先例显式放宽为纯时间预算修正（非生产回归）。
  it('runs the full project-config chain with character and entryScene writes', { timeout: 15000 }, () => {
    const { root, data } = fixtureProject();
    const env = { SURDET_AGENT_DATA_DIR: data };

    // 能力面 30 项（含 Wave 6 human review readers）。
    const capabilities = runCli(['capabilities', 'describe', '--json'], env);
    expect(capabilities.status).toBe(0);
    expect(body(capabilities).result.capabilities.map((definition: any) => definition.id)).toEqual([
      'capabilities.describe', 'project.inspect', 'project.assets', 'object.inspect', 'change.begin',
      'scene.create', 'scene.patch', 'variable.ensure', 'character.ensure', 'character.remove',
      'timeline.create', 'timeline.patch', 'project.entry-scene.set',
      'project.validate', 'project.simulate', 'runtime.run-from', 'runtime.read-trace',
      'change.diff', 'change.commit', 'change.rollback',
      'change.recovery.inspect', 'change.recovery.execute',
      'composition.compare', 'composition.plan', 'composition.inspect', 'composition.execute',
      'review.prepare-comparison', 'review.inspect-decision', 'review.prepare-result', 'review.inspect-approval',
    ]);

    // project.assets avatars 与 project.inspect characters/entryScene/title。
    const assets = runCli(['project', 'assets', '--project', root, '--json'], env);
    expect(assets.status).toBe(0);
    expect(body(assets).result.avatars.map((entry: any) => entry.key)).toEqual(['lynn', 'nova']);
    expect(body(assets).result.avatars.every((entry: any) => entry.resolved && entry.format === 'svg')).toBe(true);
    const inspect = runCli(['project', 'inspect', '--project', root, '--json'], env);
    expect(inspect.status).toBe(0);
    const inspected = body(inspect).result;
    expect(inspected.title).toBe('Starter');
    expect(inspected.entryScene).toBe('ch01_01');
    expect(inspected.characters).toEqual([{ id: 'lynn', name: '凛', avatar: 'lynn', declaration: { name: '凛', avatar: 'lynn' } }]);
    expect(inspected.assets.avatars).toEqual(body(assets).result.avatars);

    const begun = runCli(['change', 'begin', '--project', root, '--json'], env);
    expect(begun.status).toBe(0);
    const changeId = body(begun).changeId as string;
    const revision = body(begun).projectRevision as string;
    const requestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave3-input-'));

    // 新建目标场景 agent_probe（@scene 行作为后续 insertAfter 锚点）。
    const sceneInput = writeJson(requestDir, 'scene.json', {
      operationId: 'op-scene-probe',
      sceneId: 'agent_probe',
      blocks: [{ kind: 'label', name: 'start' }, { kind: 'text', speaker: '凛', value: '开场。' }],
    });
    expect(runCli(['scene', 'create', '--change', changeId, '--input', sceneInput, '--json'], env).status).toBe(0);

    // object.inspect character:lynn 取当前角色表指纹 → character.ensure nova。
    const inspectChar = runCli(['object', 'inspect', '--project', root, '--ref', 'character:lynn', '--change', changeId, '--json'], env);
    expect(inspectChar.status).toBe(0);
    const charFingerprint = body(inspectChar).result.fingerprint as string;
    expect(charFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const ensureInput = writeJson(requestDir, 'character.json', {
      operationId: 'op-character-nova',
      id: 'nova',
      name: '诺瓦',
      avatar: 'nova',
      expectedFingerprint: charFingerprint,
    });
    const ensured = runCli(['character', 'ensure', '--change', changeId, '--input', ensureInput, '--json'], env);
    expect(ensured.status).toBe(0);
    expect(body(ensured).result.objectRef).toBe('character:nova');
    expect(body(ensured).result.created).toBe(true);

    // scene.patch 在 agent_probe 的 @label start 行后追加 nova 台词（保证 start 启动路径可达）。
    const anchorRef = `scene:agent_probe/instruction:2@${revision.slice(0, 8)}-${fingerprint('@label start')}`;
    const patchInput = writeJson(requestDir, 'patch.json', {
      operationId: 'op-scene-patch-nova',
      sceneId: 'agent_probe',
      patch: {
        kind: 'insertAfter',
        anchor: anchorRef,
        expectedFingerprint: fingerprint('@label start'),
        blocks: [{ kind: 'text', speaker: 'nova', value: '诺瓦登场台词。' }],
      },
    });
    expect(runCli(['scene', 'patch', '--change', changeId, '--input', patchInput, '--json'], env).status).toBe(0);

    // project.entry-scene.set 指向 agent_probe（指纹来自 object.inspect config:entryScene）。
    const inspectEntry = runCli(['object', 'inspect', '--project', root, '--ref', 'config:entryScene', '--change', changeId, '--json'], env);
    expect(inspectEntry.status).toBe(0);
    const entryFingerprint = body(inspectEntry).result.fingerprint as string;
    const entryInput = writeJson(requestDir, 'entry.json', {
      operationId: 'op-entry-set',
      sceneId: 'agent_probe',
      expectedFingerprint: entryFingerprint,
    });
    const entrySet = runCli(['project', 'entry-scene', 'set', '--change', changeId, '--input', entryInput, '--json'], env);
    expect(entrySet.status).toBe(0);
    expect(body(entrySet).result.entryScene).toBe('agent_probe');

    // validate 绿灯（characters 结构 + entryScene 存在 + speaker 全解析）。
    const validated = runCli(['project', 'validate', '--change', changeId, '--json'], env);
    expect(validated.status).toBe(0);
    const validatedBody = body(validated);
    expect(validatedBody.result.ok).toBe(true);
    expect(validatedBody.result.issues.filter((issue: any) => issue.severity === 'error')).toHaveLength(0);
    expect(validatedBody.result.issues.filter((issue: any) => issue.code === 'SPEAKER_UNRESOLVED')).toHaveLength(0);

    // simulate：entryScene 已由 Agent 设置，模拟从 agent_probe 启动并出现 nova 台词。
    const simulated = runCli(['project', 'simulate', '--change', changeId, '--json'], env);
    expect(simulated.status).toBe(0);
    const simulatedBody = body(simulated);
    expect(simulatedBody.result.entryScene).toBe('agent_probe');
    expect(simulatedBody.result.status).toBe('passed');
    expect(simulatedBody.result.runtimeErrors).toHaveLength(0);

    // run-from 显式目标场景：trace 中出现 speaker=nova 的台词事件。
    const runInput = writeJson(requestDir, 'run.json', { sceneId: 'agent_probe', label: 'start', choices: [] });
    const run = runCli(['runtime', 'run-from', '--change', changeId, '--input', runInput, '--json'], env);
    expect(run.status).toBe(0);
    const runBody = body(run);
    expect(runBody.result.sceneId).toBe('agent_probe');
    expect(runBody.result.status).toBe('passed');
    const traceQuery = writeJson(requestDir, 'trace-query.json', {});
    const trace = runCli(['runtime', 'read-trace', '--change', changeId, '--trace', runBody.result.traceId, '--query', traceQuery, '--json'], env);
    expect(trace.status).toBe(0);
    const events = body(trace).result.events as any[];
    expect(events.some((event) => event.source?.op === 'text' && event.source?.sceneId === 'agent_probe')).toBe(true);

    // diff：character/entry-scene ledger 条目。
    const diffed = runCli(['change', 'diff', '--change', changeId, '--json'], env);
    expect(diffed.status).toBe(0);
    const ledgerKinds = body(diffed).result.semantic.map((entry: any) => entry.kind).filter((kind: string) => kind.startsWith('config.'));
    expect(ledgerKinds).toEqual(['config.character.ensure', 'config.entry-scene.set']);

    // commit 后磁盘回读。
    const committed = runCli(['change', 'commit', '--change', changeId, '--json'], env);
    expect(committed.status).toBe(0);
    expect(body(committed).result.status).toBe('COMMITTED');
    const configText = fs.readFileSync(path.join(root, 'game.config.json'), 'utf8');
    const committedConfig = JSON.parse(configText) as { entryScene: string; characters: Record<string, { name: string }> };
    expect(committedConfig.entryScene).toBe('agent_probe');
    expect(committedConfig.characters['nova']).toEqual({ name: '诺瓦', avatar: 'nova' });
    const sceneText = fs.readFileSync(path.join(root, 'content/scenario/agent_probe.gal'), 'utf8');
    expect(sceneText).toContain('nova：诺瓦登场台词。');
    // start 启动路径可达性：@label start 之后紧跟 nova 台词（插入位置不变量）。
    const startIndex = sceneText.indexOf('@label start');
    const novaIndex = sceneText.indexOf('nova：诺瓦登场台词。');
    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(novaIndex).toBeGreaterThan(startIndex);
    // 资源只读：avatar 文件身份不变。
    expect(fs.readFileSync(path.join(root, 'content/assets/avatar/lynn.svg'), 'utf8')).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });
});
