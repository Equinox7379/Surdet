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

function fixtureProject(): { root: string; data: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave2-cli-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave2-data-'));
  fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content/timelines'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content/assets/bg'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content/assets/portrait'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'ch01_01', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content/scenario/ch01_01.gal'), '@scene ch01_01\n凛：基础。\n@end\n', 'utf8');
  fs.writeFileSync(path.join(root, 'content/assets/bg/night_field.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
  fs.writeFileSync(path.join(root, 'content/assets/bg/castle_hall.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
  fs.writeFileSync(path.join(root, 'content/assets/portrait/lynn_uniform_night.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
  return { root, data };
}

const agentBlackout = {
  version: 1,
  id: 'agent_blackout',
  durationMs: 800,
  tracks: [
    { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] },
    { kind: 'portrait', target: 'lynn:uniform', cues: [{ atMs: 100, durationMs: 0, easing: 'linear', action: 'show', expression: 'night', position: 'left' }] },
    {
      kind: 'screen',
      cues: [
        { atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 1 },
        { atMs: 50, durationMs: 700, easing: 'inOutSine', action: 'fade', alpha: 0 },
      ],
    },
  ],
};

describe('agent authoring presentation wave 2 CLI vertical slice', () => {
  // 主链串行 spawn 20+ 个 CLI 子进程；Wave 6 全量并行负载下需要 30s 纯时间预算修正（非生产回归）。
  it('runs the full timeline authoring chain with explicit scene selection', { timeout: 30000 }, () => {
    const { root, data } = fixtureProject();
    const env = { SURDET_AGENT_DATA_DIR: data };

    // 纵向链只依赖本用例实际调用的能力；完整注册表由 authoring-contract.test.ts 覆盖。
    const capabilities = runCli(['capabilities', 'describe', '--json'], env);
    expect(capabilities.status).toBe(0);
    const capabilityIds = body(capabilities).result.capabilities.map((definition: any) => definition.id);
    expect(capabilityIds).toEqual(expect.arrayContaining([
      'capabilities.describe', 'project.inspect', 'project.assets', 'object.inspect', 'change.begin',
      'scene.create', 'timeline.create', 'timeline.patch', 'project.validate', 'project.simulate',
      'runtime.run-from', 'change.diff', 'change.commit',
    ]));

    // project.assets 与 project.inspect.assets 共享同一 catalog 解析。
    const assets = runCli(['project', 'assets', '--project', root, '--json'], env);
    expect(assets.status).toBe(0);
    const assetsBody = body(assets);
    const nightField = assetsBody.result.backgrounds.find((entry: any) => entry.key === 'night_field');
    expect(nightField).toEqual({
      kind: 'background', key: 'night_field', sourcePath: 'content/assets/bg/night_field.svg', format: 'svg', resolved: true,
    });
    const lynnNight = assetsBody.result.portraits.find((entry: any) => entry.expression === 'night');
    expect(lynnNight?.role).toBe('lynn');
    expect(lynnNight?.resolved).toBe(true);
    const inspect = runCli(['project', 'inspect', '--project', root, '--json'], env);
    expect(inspect.status).toBe(0);
    expect(body(inspect).result.assets).toEqual(assetsBody.result);

    const begun = runCli(['change', 'begin', '--project', root, '--json'], env);
    expect(begun.status).toBe(0);
    const changeId = body(begun).changeId as string;
    const requestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave2-input-'));

    // scene.create agent_probe：只含 @label start 与 @timeline agent_blackout @ blocking。
    const sceneInput = writeJson(requestDir, 'scene.json', {
      operationId: 'op-scene-probe',
      sceneId: 'agent_probe',
      blocks: [
        { kind: 'label', name: 'start' },
        { kind: 'instruction', name: 'timeline', args: ['agent_blackout'], modifiers: { blocking: '' } },
      ],
    });
    expect(runCli(['scene', 'create', '--change', changeId, '--input', sceneInput, '--json'], env).status).toBe(0);

    // timeline.create agent_blackout。
    const timelineInput = writeJson(requestDir, 'timeline.json', {
      operationId: 'op-timeline-create',
      timelineId: 'agent_blackout',
      definition: agentBlackout,
    });
    const created = runCli(['timeline', 'create', '--change', changeId, '--input', timelineInput, '--json'], env);
    expect(created.status).toBe(0);
    const createdBody = body(created);
    expect(createdBody.result.objectRef).toBe('timeline:agent_blackout');
    expect(createdBody.result.path).toBe('content/timelines/agent_blackout.json');
    expect(createdBody.result.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // object.inspect（事务内）：timeline/track/cue 附 SHA-256 指纹。
    const timelineInspect = runCli(['object', 'inspect', '--project', root, '--ref', 'timeline:agent_blackout', '--change', changeId, '--json'], env);
    expect(timelineInspect.status).toBe(0);
    const timelineObject = body(timelineInspect).result;
    expect(timelineObject.fingerprint).toBe(createdBody.result.fingerprint);
    const trackInspect = runCli(['object', 'inspect', '--project', root, '--ref', 'timeline:agent_blackout/track:0', '--change', changeId, '--json'], env);
    expect(trackInspect.status).toBe(0);
    const trackObject = body(trackInspect).result;
    expect(trackObject.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(trackObject.references).toContain('asset:bg:night_field');
    const cueInspect = runCli(['object', 'inspect', '--project', root, '--ref', 'timeline:agent_blackout/track:1/cue:0', '--change', changeId, '--json'], env);
    expect(cueInspect.status).toBe(0);
    expect(body(cueInspect).result.references).toContain('asset:portrait:lynn:uniform:night');
    const assetInspect = runCli(['object', 'inspect', '--project', root, '--ref', 'asset:bg:night_field', '--change', changeId, '--json'], env);
    expect(assetInspect.status).toBe(0);
    expect(body(assetInspect).result.kind).toBe('asset');

    // timeline.patch 单 patch 原子：addTrack → insertCue → removeCue 串行，每次 workingRevision 增加。
    const addInput = writeJson(requestDir, 'patch-add.json', {
      operationId: 'op-patch-add',
      timelineId: 'agent_blackout',
      patch: { kind: 'addTrack', expectedFingerprint: createdBody.result.fingerprint, trackKind: 'screen' },
    });
    const added = runCli(['timeline', 'patch', '--change', changeId, '--input', addInput, '--json'], env);
    expect(added.status).toBe(0);
    const addedBody = body(added);
    expect(addedBody.result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const newTrackRef = 'timeline:agent_blackout/track:3';
    const newTrack = runCli(['object', 'inspect', '--project', root, '--ref', newTrackRef, '--change', changeId, '--json'], env);
    expect(newTrack.status).toBe(0);
    const newTrackFingerprint = body(newTrack).result.fingerprint as string;
    const insertInput = writeJson(requestDir, 'patch-insert.json', {
      operationId: 'op-patch-insert',
      timelineId: 'agent_blackout',
      patch: {
        kind: 'insertCue',
        expectedFingerprint: newTrackFingerprint,
        trackRef: newTrackRef,
        cue: { atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 0 },
      },
    });
    expect(runCli(['timeline', 'patch', '--change', changeId, '--input', insertInput, '--json'], env).status).toBe(0);
    const newCue = runCli(['object', 'inspect', '--project', root, '--ref', 'timeline:agent_blackout/track:3/cue:0', '--change', changeId, '--json'], env);
    expect(newCue.status).toBe(0);
    const removeInput = writeJson(requestDir, 'patch-remove.json', {
      operationId: 'op-patch-remove',
      timelineId: 'agent_blackout',
      patch: {
        kind: 'removeCue',
        expectedFingerprint: body(newCue).result.fingerprint,
        cueRef: 'timeline:agent_blackout/track:3/cue:0',
      },
    });
    expect(runCli(['timeline', 'patch', '--change', changeId, '--input', removeInput, '--json'], env).status).toBe(0);

    // 指纹过期 → OBJECT_REF_STALE，且事务不变。
    const staleInput = writeJson(requestDir, 'patch-stale.json', {
      operationId: 'op-patch-stale',
      timelineId: 'agent_blackout',
      patch: { kind: 'addTrack', expectedFingerprint: '0'.repeat(64), trackKind: 'screen' },
    });
    const stale = runCli(['timeline', 'patch', '--change', changeId, '--input', staleInput, '--json'], env);
    expect(stale.status).toBe(1);
    expect(body(stale).error.code).toBe('OBJECT_REF_STALE');

    // 白名单外 cue action → UNSUPPORTED_OPERATION。
    const unsupported = runCli(['timeline', 'create', '--change', changeId, '--input', writeJson(requestDir, 'tl-camera.json', {
      operationId: 'op-camera',
      timelineId: 'camera_probe',
      definition: {
        version: 1, id: 'camera_probe', durationMs: 100,
        tracks: [{ kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'zoom' }] }],
      },
    }), '--json'], env);
    expect(unsupported.status).toBe(1);
    expect(body(unsupported).error.code).toBe('UNSUPPORTED_OPERATION');

    // 身份不变量：timelineId 与 definition.id 不一致 → VALIDATION_FAILED。
    const mismatch = runCli(['timeline', 'create', '--change', changeId, '--input', writeJson(requestDir, 'tl-mismatch.json', {
      operationId: 'op-mismatch',
      timelineId: 'other',
      definition: agentBlackout,
    }), '--json'], env);
    expect(mismatch.status).toBe(1);
    expect(body(mismatch).error.code).toBe('VALIDATION_FAILED');

    // project.validate：结构与资源引用绿灯。
    const validated = runCli(['project', 'validate', '--change', changeId, '--json'], env);
    expect(validated.status).toBe(0);
    const validatedBody = body(validated);
    expect(validatedBody.result.ok).toBe(true);
    expect(validatedBody.result.issues.filter((issue: any) => issue.severity === 'error')).toHaveLength(0);

    // project.simulate 显式场景：entryScene 记录为 agent_probe。
    const simulateInput = writeJson(requestDir, 'simulate.json', { sceneId: 'agent_probe' });
    const simulated = runCli(['project', 'simulate', '--change', changeId, '--input', simulateInput, '--json'], env);
    expect(simulated.status).toBe(0);
    const simulatedBody = body(simulated);
    expect(simulatedBody.result.entryScene).toBe('agent_probe');
    expect(simulatedBody.result.status).toBe('passed');
    expect(simulatedBody.result.runtimeErrors).toHaveLength(0);

    // runtime.run-from 显式场景与标签。
    const runInput = writeJson(requestDir, 'run-from.json', { sceneId: 'agent_probe', label: 'start', choices: [] });
    const run = runCli(['runtime', 'run-from', '--change', changeId, '--input', runInput, '--json'], env);
    expect(run.status).toBe(0);
    expect(body(run).result.sceneId).toBe('agent_probe');
    expect(body(run).result.status).toBe('passed');

    // change.diff：对象级 semantic diff 来自 operation ledger（timeline.create + 三次 patch）。
    const diffed = runCli(['change', 'diff', '--change', changeId, '--json'], env);
    expect(diffed.status).toBe(0);
    const diffBody = body(diffed);
    expect(diffBody.result.files.map((file: any) => file.path)).toEqual([
      'content/scenario/agent_probe.gal',
      'content/timelines/agent_blackout.json',
    ]);
    // semantic 包含文件级条目（scene/timeline）与 ledger 对象级条目；ledger 条目以 timeline. 前缀标识。
    const ledgerKinds = diffBody.result.semantic.map((entry: any) => entry.kind).filter((kind: string) => kind.startsWith('timeline.'));
    expect(ledgerKinds).toEqual(['timeline.create', 'timeline.patch.addTrack', 'timeline.patch.insertCue', 'timeline.patch.removeCue']);

    // change.commit 后磁盘回读。
    const committed = runCli(['change', 'commit', '--change', changeId, '--json'], env);
    expect(committed.status).toBe(0);
    expect(body(committed).result.status).toBe('COMMITTED');
    const probeText = fs.readFileSync(path.join(root, 'content/scenario/agent_probe.gal'), 'utf8');
    expect(probeText).toContain('@scene agent_probe');
    expect(probeText).toContain('@label start');
    expect(probeText).toContain('@timeline agent_blackout @blocking');
    const timelineText = fs.readFileSync(path.join(root, 'content/timelines/agent_blackout.json'), 'utf8');
    const committedDefinition = JSON.parse(timelineText) as { id: string; tracks: any[] };
    expect(committedDefinition.id).toBe('agent_blackout');
    expect(committedDefinition.tracks).toHaveLength(4);
    expect(committedDefinition.tracks[3]?.cues).toHaveLength(0);
    // 资源保持只读：SVG 文件身份不变。
    expect(fs.readFileSync(path.join(root, 'content/assets/bg/night_field.svg'), 'utf8')).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });

  // Reliability Phase 1（R1-A/R1-B）：headless simulate/run-from 注入真实 TimelineRegistry 后，
  // 场景引用缺失 timeline 必须 fail-loud——不再可能 validate=error 而 simulate/run-from=passed。
  it('fails loud in simulate and run-from when the scene references a missing timeline', () => {
    const { root, data } = fixtureProject();
    const env = { SURDET_AGENT_DATA_DIR: data };
    // 场景引用 agent_ghost；timelines 目录只落盘合法 agent_blackout（registry 有内容但缺 ghost）。
    fs.writeFileSync(path.join(root, 'content/scenario/ghost_probe.gal'), '@scene ghost_probe\n@timeline agent_ghost @ blocking\n凛：到达。\n@end\n', 'utf8');
    fs.writeFileSync(path.join(root, 'content/timelines/agent_blackout.json'), JSON.stringify(agentBlackout), 'utf8');
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'ghost_probe', variables: {} }), 'utf8');

    const begun = runCli(['change', 'begin', '--project', root, '--json'], env);
    expect(begun.status).toBe(0);
    const changeId = body(begun).result.changeId;

    const simulateInput = writeJson(root, 'simulate-ghost.json', { sceneId: 'ghost_probe' });
    const simulated = runCli(['project', 'simulate', '--change', changeId, '--input', simulateInput, '--json'], env);
    // 模拟失败按既有 CLI contract 走结构化错误信封（ok:false + RUNTIME_FAILED），不再 false-green。
    expect(simulated.status).not.toBe(0);
    const simulatedBody = body(simulated);
    expect(simulatedBody.ok).toBe(false);
    expect(simulatedBody.error.code).toBe('RUNTIME_FAILED');
    expect(simulatedBody.error.message).toMatch(/时间轴 'agent_ghost' 未注册/);

    const runInput = writeJson(root, 'run-ghost.json', { sceneId: 'ghost_probe', choices: [] });
    const run = runCli(['runtime', 'run-from', '--change', changeId, '--input', runInput, '--json'], env);
    expect(run.status).not.toBe(0);
    const runBody = body(run);
    expect(runBody.ok).toBe(false);
    expect(runBody.error.code).toBe('RUNTIME_FAILED');
    expect(runBody.error.message).toMatch(/时间轴 'agent_ghost' 未注册/);
  });

  // Reliability Phase 1 F1：simulate 的 runtime construction failure（malformed timeline）必须在
  // AuthoringService 边界统一归类为 RUNTIME_FAILED 并保留 root cause，而不是依赖 message heuristic。
  it.each([
    {
      label: 'invalid JSON timeline',
      file: 'broken.json',
      content: '{"version": 1, "id": "broken", not-json',
      messagePattern: /broken\.json.*时间轴 JSON 解析失败/,
    },
    {
      label: 'invalid TimelineDefinition (missing tracks)',
      file: 'no_tracks.json',
      content: JSON.stringify({ version: 1, id: 'no_tracks', durationMs: 900 }),
      messagePattern: /no_tracks\.json.*track/,
    },
  ])('classifies simulate runtime loader failure as RUNTIME_FAILED ($label)', ({ file, content, messagePattern }) => {
    const { root, data } = fixtureProject();
    const env = { SURDET_AGENT_DATA_DIR: data };
    // 场景不引用坏 timeline 也会失败：loader 在 runtime 构造期解析全部 timeline 文件。
    fs.writeFileSync(path.join(root, `content/timelines/${file}`), content, 'utf8');
    const simulateInput = writeJson(root, 'simulate-input.json', { sceneId: 'ch01_01' });

    const begun = runCli(['change', 'begin', '--project', root, '--json'], env);
    expect(begun.status).toBe(0);
    const changeId = body(begun).result.changeId;

    const simulated = runCli(['project', 'simulate', '--change', changeId, '--input', simulateInput, '--json'], env);
    expect(simulated.status).not.toBe(0);
    const simulatedBody = body(simulated);
    expect(simulatedBody.ok).toBe(false);
    expect(simulatedBody.error.code).toBe('RUNTIME_FAILED');
    expect(simulatedBody.error.category).toBe('runtime');
    expect(simulatedBody.error.message).toMatch(messagePattern);

    // runtime.run-from 同源失败，回归确认仍为 RUNTIME_FAILED。
    const runInput = writeJson(root, 'run-input.json', { sceneId: 'ch01_01', choices: [] });
    const run = runCli(['runtime', 'run-from', '--change', changeId, '--input', runInput, '--json'], env);
    expect(run.status).not.toBe(0);
    const runBody = body(run);
    expect(runBody.ok).toBe(false);
    expect(runBody.error.code).toBe('RUNTIME_FAILED');
    expect(runBody.error.message).toMatch(messagePattern);
  });

  // Reliability Phase 2A（A1）：malformed timeline 上 project.validate 必须返回结构化 validation
  // 信封（含 T0xx + 文件路径），不得 crash 成 INVALID_REQUEST/raw TypeError。
  it('returns structured validation diagnostics for a missing-tracks timeline', () => {
    const { root, data } = fixtureProject();
    const env = { SURDET_AGENT_DATA_DIR: data };
    fs.writeFileSync(path.join(root, 'content/timelines/broken.json'), JSON.stringify({ version: 1, id: 'broken', durationMs: 900 }), 'utf8');

    const begun = runCli(['change', 'begin', '--project', root, '--json'], env);
    expect(begun.status).toBe(0);
    const changeId = body(begun).result.changeId;

    const validated = runCli(['project', 'validate', '--change', changeId, '--json'], env);
    expect(validated.status).toBe(0);
    const validatedBody = body(validated);
    expect(validatedBody.ok).toBe(true);
    expect(validatedBody.result.ok).toBe(false);
    const timelineError = validatedBody.result.issues.find((issue: any) => issue.file === 'content/timelines/broken.json' && issue.severity === 'error');
    expect(timelineError).toBeDefined();
    expect(timelineError.code).toMatch(/^T\d{3}$/);
    expect(timelineError.text).toContain('content/timelines/broken.json');
  });

  // Reliability Phase 2B（A2）：canonical timeline identity = filename stem == definition.id。
  // validate 与 simulate/run-from 必须共享同一 invariant，禁止 alias/fallback 双真相。
  it.each([
    {
      label: 'CASE B filename ref (foo.json id=bar ref=foo)',
      ref: 'foo',
      files: { 'foo.json': { id: 'bar' } },
      mismatchText: "definition.id 'bar' 与文件名派生 ID 'foo' 不一致",
      expectMissingFoo: false,
      expectMissingRef: false,
      duplicate: false,
    },
    {
      label: 'CASE C internal ref (foo.json id=bar ref=bar)',
      ref: 'bar',
      files: { 'foo.json': { id: 'bar' } },
      mismatchText: "definition.id 'bar' 与文件名派生 ID 'foo' 不一致",
      expectMissingFoo: false,
      expectMissingRef: true,
      duplicate: false,
    },
    {
      label: 'CASE D duplicate internal ids (a/b.json id=shared)',
      ref: 'shared',
      files: { 'a.json': { id: 'shared' }, 'b.json': { id: 'shared' } },
      mismatchText: "definition.id 'shared' 与文件名派生 ID 'a' 不一致",
      expectMissingFoo: false,
      expectMissingRef: false,
      duplicate: true,
    },
  ])('enforces canonical timeline identity end to end ($label)', ({ ref, files, mismatchText, expectMissingRef, duplicate }) => {
    const { root, data } = fixtureProject();
    const env = { SURDET_AGENT_DATA_DIR: data };
    fs.writeFileSync(path.join(root, 'content/scenario/ch01_01.gal'), `@scene ch01_01\n@timeline ${ref} @ blocking\n凛：你好。\n@end\n`, 'utf8');
    for (const [file, partial] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, 'content/timelines', file), JSON.stringify({
        version: 1,
        durationMs: 900,
        tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 1 }] }],
        ...partial,
      }), 'utf8');
    }
    const runInput = writeJson(root, 'run-input.json', { sceneId: 'ch01_01', choices: [] });

    const begun = runCli(['change', 'begin', '--project', root, '--json'], env);
    expect(begun.status).toBe(0);
    const changeId = body(begun).result.changeId;

    // validate：capability 成功执行，内部 result.ok=false，MISMATCH 诊断带文件路径与两个 ID。
    const validated = runCli(['project', 'validate', '--change', changeId, '--json'], env);
    expect(validated.status).toBe(0);
    const validatedBody = body(validated);
    expect(validatedBody.ok).toBe(true);
    expect(validatedBody.result.ok).toBe(false);
    const mismatch = validatedBody.result.issues.find((issue: any) => issue.code === 'TIMELINE_ID_MISMATCH');
    expect(mismatch).toBeDefined();
    expect(mismatch.text).toContain(mismatchText);
    // CASE B 核心：文件真实存在（filename 引用）不得新增误导性 TIMELINE_MISSING 'foo'。
    expect(validatedBody.result.issues.some((issue: any) => issue.code === 'TIMELINE_MISSING' && issue.text.includes("'foo'"))).toBe(false);
    if (expectMissingRef) {
      expect(validatedBody.result.issues.some((issue: any) => issue.code === 'TIMELINE_MISSING' && issue.text.includes(`'${ref}'`))).toBe(true);
    }
    if (duplicate) {
      const dup = validatedBody.result.issues.find((issue: any) => issue.code === 'TIMELINE_ID_DUPLICATE');
      expect(dup).toBeDefined();
      expect(dup.text).toContain('content/timelines/a.json');
      expect(dup.text).toContain('content/timelines/b.json');
    }

    // simulate / run-from：runtime loader 同一 invariant → RUNTIME_FAILED（不再有 CASE C 的 runtime PASS）。
    const simulateInput = writeJson(root, 'simulate-input.json', { sceneId: 'ch01_01' });
    const simulated = runCli(['project', 'simulate', '--change', changeId, '--input', simulateInput, '--json'], env);
    expect(simulated.status).not.toBe(0);
    expect(body(simulated).error.code).toBe('RUNTIME_FAILED');
    expect(body(simulated).error.message).toContain(mismatchText);

    const run = runCli(['runtime', 'run-from', '--change', changeId, '--input', runInput, '--json'], env);
    expect(run.status).not.toBe(0);
    expect(body(run).error.code).toBe('RUNTIME_FAILED');
    expect(body(run).error.message).toContain(mismatchText);
  });
});
