import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openAssetImportAuthorityPaths } from '../src/asset-import-authority/filesystem.js';
import {
  ProjectSceneLifecycleAuthority,
  SceneLifecycleInjectedTermination,
  type SceneLifecycleFaultPoint,
} from '../src/asset-import-authority/scene-lifecycle-authority.js';
import type { AssetImportAuthorityPaths } from '../src/asset-import-authority/types.js';

let roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

async function fixture(): Promise<{
  root: string;
  project: string;
  paths: AssetImportAuthorityPaths;
  authority: ProjectSceneLifecycleAuthority;
}>;
async function fixture(faultPoint?: SceneLifecycleFaultPoint): Promise<{
  root: string;
  project: string;
  paths: AssetImportAuthorityPaths;
  authority: ProjectSceneLifecycleAuthority;
}>;
async function fixture(faultPoint?: SceneLifecycleFaultPoint): Promise<{
  root: string;
  project: string;
  paths: AssetImportAuthorityPaths;
  authority: ProjectSceneLifecycleAuthority;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-scene-lifecycle-'));
  roots.push(root);
  const project = path.join(root, 'project');
  const dataRoot = path.join(root, 'data');
  await fs.mkdir(path.join(project, 'content', 'scenario', 'chapter'), { recursive: true });
  await fs.mkdir(dataRoot, { recursive: true });
  const paths = await openAssetImportAuthorityPaths({ projectRoot: project, dataRoot });
  return {
    root,
    project,
    paths,
    authority: new ProjectSceneLifecycleAuthority(paths, {
      assertLeaseHeld: () => undefined,
      ...(faultPoint ? {
        faultInjector: (point) => {
          if (point === faultPoint) throw new SceneLifecycleInjectedTermination(point);
        },
      } : {}),
    }),
  };
}

function uuid(): string {
  return crypto.randomUUID();
}

describe('project scene lifecycle authority', () => {
  it('does not pin a deleted implicit entry during a different scene config rename', async () => {
    const value = await fixture();
    const source = 'content/scenario/a.gal';
    await fs.writeFile(path.join(value.project, source), '@scene a\n@end\n');
    await fs.writeFile(path.join(value.project, 'game.config.json'), '{}');
    const plan = await value.authority.plan({ operationId: uuid(), kind: 'delete', sourcePath: source });
    await expect(value.authority.commit({ requestId: uuid(), plans: [{ operationId: plan.operationId, planFingerprint: plan.planFingerprint }],
      configRenames: [{ from: 'draft', to: 'new' }], writes: [
        { path: 'content/scenario/new.gal', text: '@scene new\n@end\n', expectedSha256: null },
        { path: 'game.config.json', text: '{"entryScene":"a"}', expectedSha256: sha256('{}') },
      ] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(await fs.readFile(path.join(value.project, source), 'utf8')).toBe('@scene a\n@end\n');
    expect(await fs.readFile(path.join(value.project, 'game.config.json'), 'utf8')).toBe('{}');
  });
  it('renames an unsaved scene with its config references but cannot relabel an unrelated existing scene', async () => {
    const value = await fixture();
    const before = '{"entryScene":"draft","note":"draft"}';
    await fs.writeFile(path.join(value.project, 'game.config.json'), before);
    await fs.writeFile(path.join(value.project, 'content/scenario/other.gal'), '@scene other\n@end\n');
    const request = { requestId: uuid(), plans: [], configRenames: [{ from: 'other', to: 'new' }], writes: [
      { path: 'content/scenario/new.gal', text: '@scene new\n@end\n', expectedSha256: null },
      { path: 'game.config.json', text: '{"entryScene":"new","note":"draft"}', expectedSha256: sha256(before) },
    ] };
    await expect(value.authority.commit(request)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    request.configRenames = [{ from: 'draft', to: 'new' }];
    const receipt = await value.authority.commit(request);
    await expect(value.authority.commit(request)).resolves.toEqual(receipt);
    await expect(value.authority.commit({ ...request, configRenames: [{ from: 'different', to: 'new' }] })).rejects.toMatchObject({ code: 'IMPORT_OPERATION_CONFLICT' });
    expect(await fs.readFile(path.join(value.project, 'game.config.json'), 'utf8')).toBe(request.writes[1]!.text);
  });
  it.each([undefined, 'after_first_publish', 'after_committed_record'] as const)('saves scene identity and all config references in one recoverable batch: %s', async faultPoint => {
    const value = await fixture(faultPoint);
    await fs.mkdir(path.join(value.project, 'content/config'));
    const old = '@scene old\n@end\n';
    const config = '{"entryScene":"old","player":{"endScenes":["old"]},"note":"old"}';
    const events = '{"events":[{"id":"arrival","scene":"old","note":"old"}]}';
    await fs.writeFile(path.join(value.project, 'content/scenario/chapter/old.gal'), old);
    await fs.writeFile(path.join(value.project, 'game.config.json'), config);
    await fs.writeFile(path.join(value.project, 'content/config/events.json'), events);
    const plan = await value.authority.plan({ operationId: uuid(), kind: 'rename', sourcePath: 'content/scenario/chapter/old.gal', targetPath: 'content/scenario/chapter/new.gal' });
    const request = { requestId: uuid(), plans: [{ operationId: plan.operationId, planFingerprint: plan.planFingerprint }],
      configRenames: [{ from: 'old', to: 'new' }], writes: [
        { path: 'content/scenario/chapter/new.gal', text: '@scene new\n@end\n', expectedSha256: null },
        { path: 'game.config.json', text: '{"entryScene":"new","player":{"endScenes":["new"]},"note":"old"}', expectedSha256: sha256(config) },
        { path: 'content/config/events.json', text: '{"events":[{"id":"arrival","scene":"new","note":"old"}]}', expectedSha256: sha256(events) },
      ] };
    let authority = value.authority;
    if (faultPoint) {
      await expect(authority.commit(request)).rejects.toBeInstanceOf(SceneLifecycleInjectedTermination);
      authority = new ProjectSceneLifecycleAuthority(value.paths, { assertLeaseHeld: () => undefined });
      await authority.recoverPending();
      if (faultPoint === 'after_first_publish') {
        expect(await fs.readFile(path.join(value.project, 'game.config.json'), 'utf8')).toBe(config);
        expect(await fs.readFile(path.join(value.project, 'content/config/events.json'), 'utf8')).toBe(events);
        expect(await fs.readFile(path.join(value.project, 'content/scenario/chapter/old.gal'), 'utf8')).toBe(old);
      }
    } else {
      await expect(authority.commit({ ...request, writes: request.writes.slice(0, 2) })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      await expect(authority.commit({ ...request, writes: request.writes.map(write => write.path === 'game.config.json' ? { ...write, text: write.text.replace('"note":"old"', '"note":"changed"') } : write) })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    const receipt = await authority.commit(request);
    await expect(authority.commit(request)).resolves.toEqual(receipt);
    for (const write of request.writes) expect(await fs.readFile(path.join(value.project, write.path), 'utf8')).toBe(write.text);
    await expect(fs.stat(path.join(value.project, 'content/scenario/chapter/old.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['z', 'missing_scene'])('rejects a companion pin that changes the real implicit entry to %s', async entryScene => {
    const value = await fixture();
    await fs.writeFile(path.join(value.project, 'content/scenario/chapter/start.gal'), '@scene start\n@end\n');
    await fs.writeFile(path.join(value.project, 'game.config.json'), '{}');
    await expect(value.authority.commit({ requestId: uuid(), plans: [], writes: [
      { path: 'content/scenario/z.gal', text: '@scene z\n@end\n', expectedSha256: null },
      { path: 'game.config.json', text: JSON.stringify({ entryScene }), expectedSha256: sha256('{}') },
    ] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(await fs.readFile(path.join(value.project, 'game.config.json'), 'utf8')).toBe('{}');
    await expect(fs.stat(path.join(value.project, 'content/scenario/z.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('pins an unsaved first project scene but never a nonexistent scene', async () => {
    const value = await fixture();
    const request = { requestId: uuid(), plans: [], writes: [
      { path: 'content/scenario/chapter/new.gal', text: '@scene new\n@end\n', expectedSha256: null },
      { path: 'game.config.json', text: '{"entryScene":"missing"}', expectedSha256: null },
    ] };
    await expect(value.authority.commit(request)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    request.writes[1]!.text = '{"entryScene":"new"}';
    await expect(value.authority.commit(request)).resolves.toMatchObject({ status: 'COMMITTED' });
  });

  it.each([undefined, 'after_first_stage_before_record', 'after_first_publish', 'after_committed_record'] as const)('moves to a new chapter with the implicit entry in one recoverable batch: %s', async faultPoint => {
    const value = await fixture(faultPoint);
    const sourcePath = 'content/scenario/chapter/start.GAL';
    const targetPath = 'content/scenario/第一章/雨夜/start.GAL';
    const source = '@scene start\r\n旁白：正文不改。\r\n@end\r\n';
    const config = '{"variables":{},"unknown":{"keep":true}}';
    await fs.writeFile(path.join(value.project, sourcePath), source);
    await fs.writeFile(path.join(value.project, 'game.config.json'), config);
    const plan = await value.authority.plan({ operationId: uuid(), kind: 'rename', sourcePath, targetPath });
    await expect(fs.stat(path.join(value.project, 'content/scenario/第一章'))).rejects.toMatchObject({ code: 'ENOENT' });
    const request = { requestId: uuid(), plans: [{ operationId: plan.operationId, planFingerprint: plan.planFingerprint }], writes: [
      { path: targetPath, text: source, expectedSha256: null },
      { path: 'content/scenario/第二章/extra.gal', text: '@scene extra\n@end\n', expectedSha256: null },
      { path: 'game.config.json', text: '{"variables":{},"unknown":{"keep":true},"entryScene":"start"}', expectedSha256: sha256(config) },
    ] };
    let authority = value.authority;
    if (faultPoint) {
      await expect(authority.commit(request)).rejects.toBeInstanceOf(SceneLifecycleInjectedTermination);
      authority = new ProjectSceneLifecycleAuthority(value.paths, { assertLeaseHeld: () => undefined });
      await authority.recoverPending();
      if (faultPoint !== 'after_committed_record') {
        expect(await fs.readFile(path.join(value.project, sourcePath), 'utf8')).toBe(source);
        expect(await fs.readFile(path.join(value.project, 'game.config.json'), 'utf8')).toBe(config);
        await expect(fs.stat(path.join(value.project, targetPath))).rejects.toMatchObject({ code: 'ENOENT' });
      }
    }
    const result = await authority.commit(request);
    expect(result.status).toBe('COMMITTED');
    expect(await authority.commit(request)).toEqual(result);
    expect(await fs.readFile(path.join(value.project, targetPath), 'utf8')).toBe(source);
    expect(JSON.parse(await fs.readFile(path.join(value.project, 'game.config.json'), 'utf8'))).toEqual({ variables: {}, unknown: { keep: true }, entryScene: 'start' });
    await expect(fs.stat(path.join(value.project, sourcePath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps config and scene files intact on invalid companion config or occupied chapter target', async () => {
    const value = await fixture();
    const sourcePath = 'content/scenario/chapter/start.gal';
    const targetPath = 'content/scenario/目标/start.gal';
    const source = '@scene start\n@end\n';
    await fs.writeFile(path.join(value.project, sourcePath), source);
    await fs.writeFile(path.join(value.project, 'game.config.json'), '{}');
    const plan = await value.authority.plan({ operationId: uuid(), kind: 'rename', sourcePath, targetPath });
    const request = { requestId: uuid(), plans: [{ operationId: plan.operationId, planFingerprint: plan.planFingerprint }], writes: [
      { path: targetPath, text: source, expectedSha256: null },
      { path: 'game.config.json', text: '{"entryScene":"start","extra":true}', expectedSha256: sha256('{}') },
    ] };
    await expect(value.authority.commit(request)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(await fs.readFile(path.join(value.project, 'game.config.json'), 'utf8')).toBe('{}');
    await fs.mkdir(path.join(value.project, 'content/scenario/目标'));
    await fs.writeFile(path.join(value.project, targetPath), '用户内容');
    await expect(value.authority.commit({ ...request, writes: request.writes.slice(0, 1) })).rejects.toMatchObject({ code: 'IMPORT_TARGET_EXISTS' });
    expect(await fs.readFile(path.join(value.project, sourcePath), 'utf8')).toBe(source);
    expect(await fs.readFile(path.join(value.project, targetPath), 'utf8')).toBe('用户内容');
    await expect(value.authority.plan({ operationId: uuid(), kind: 'rename', sourcePath, targetPath: 'content/scenario/目标/different.gal' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(value.authority.commit({ requestId: uuid(), plans: [], writes: [{ path: 'content/scenario/../outside.gal', text: source, expectedSha256: null }] })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('creates a new scene through the same no-overwrite commit boundary', async () => {
    const value = await fixture();
    const request = {
      requestId: uuid(),
      plans: [],
      writes: [{ path: 'content/scenario/chapter/new.gal', text: '@scene new\n', expectedSha256: null }],
    };

    const result = await value.authority.commit(request);
    expect(result).toMatchObject({ status: 'COMMITTED', deletedPaths: [] });
    await expect(value.authority.commit(request)).resolves.toEqual(result);
    await expect(fs.readFile(path.join(value.project, 'content/scenario/chapter/new.gal'), 'utf8'))
      .resolves.toBe('@scene new\n');
  });

  it('commits one rename with its reference rewrite as one protected batch', async () => {
    const value = await fixture();
    const oldText = '@scene old\n凛：旧场景。\n@end\n';
    const readerBefore = '@scene reader\n@jump old\n';
    const readerAfter = '@scene reader\n@jump new\n';
    await fs.writeFile(path.join(value.project, 'content/scenario/chapter/old.gal'), oldText);
    await fs.writeFile(path.join(value.project, 'content/scenario/reader.gal'), readerBefore);
    const operationId = uuid();
    const plan = await value.authority.plan({
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/chapter/old.gal',
      targetPath: 'content/scenario/chapter/new.gal',
    });

    const request = {
      requestId: uuid(),
      plans: [{ operationId, planFingerprint: plan.planFingerprint }],
      writes: [
        { path: 'content/scenario/chapter/new.gal', text: oldText.replace('@scene old', '@scene new'), expectedSha256: null },
        { path: 'content/scenario/reader.gal', text: readerAfter, expectedSha256: sha256(readerBefore) },
      ],
    };
    const result = await value.authority.commit(request);

    expect(result.status).toBe('COMMITTED');
    expect(await fs.readFile(path.join(value.project, 'content/scenario/chapter/new.gal'), 'utf8')).toContain('@scene new');
    expect(await fs.readFile(path.join(value.project, 'content/scenario/reader.gal'), 'utf8')).toBe(readerAfter);
    await expect(fs.stat(path.join(value.project, 'content/scenario/chapter/old.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(value.authority.commit(request)).resolves.toEqual(result);
    await expect(value.authority.commit({ ...request, requestId: uuid() }))
      .rejects.toMatchObject({ code: 'IMPORT_OPERATION_CONFLICT' });
  });

  it('never overwrites a rename target created after planning', async () => {
    const value = await fixture();
    const old = path.join(value.project, 'content/scenario/chapter/old.gal');
    const target = path.join(value.project, 'content/scenario/chapter/new.gal');
    await fs.writeFile(old, '@scene old\n');
    const operationId = uuid();
    const plan = await value.authority.plan({
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/chapter/old.gal',
      targetPath: 'content/scenario/chapter/new.gal',
    });
    await fs.writeFile(target, '外部程序创建的内容');

    await expect(value.authority.commit({
      requestId: uuid(),
      plans: [{ operationId, planFingerprint: plan.planFingerprint }],
      writes: [{ path: 'content/scenario/chapter/new.gal', text: '@scene new\n', expectedSha256: null }],
    })).rejects.toMatchObject({ code: 'IMPORT_TARGET_EXISTS' });

    expect(await fs.readFile(target, 'utf8')).toBe('外部程序创建的内容');
    expect(await fs.readFile(old, 'utf8')).toBe('@scene old\n');
  });

  it('never deletes a source node replaced after planning even when its text is identical', async () => {
    const value = await fixture();
    const source = path.join(value.project, 'content/scenario/chapter/delete-me.gal');
    await fs.writeFile(source, '@scene delete-me\n');
    const operationId = uuid();
    const plan = await value.authority.plan({
      operationId,
      kind: 'delete',
      sourcePath: 'content/scenario/chapter/delete-me.gal',
    });
    await fs.rename(source, `${source}.original`);
    await fs.writeFile(source, '@scene delete-me\n');

    await expect(value.authority.commit({
      requestId: uuid(),
      plans: [{ operationId, planFingerprint: plan.planFingerprint }],
      writes: [],
    })).rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });

    expect(await fs.readFile(source, 'utf8')).toBe('@scene delete-me\n');
  });

  it('blocks an external edit to an existing scene before changing any file', async () => {
    const value = await fixture();
    const source = path.join(value.project, 'content/scenario/chapter/old.gal');
    const reader = path.join(value.project, 'content/scenario/reader.gal');
    const readerBefore = '@scene reader\n@jump old\n';
    await fs.writeFile(source, '@scene old\n');
    await fs.writeFile(reader, readerBefore);
    const operationId = uuid();
    const plan = await value.authority.plan({
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/chapter/old.gal',
      targetPath: 'content/scenario/chapter/new.gal',
    });
    await fs.writeFile(reader, '@scene reader\n外部编辑。\n');

    await expect(value.authority.commit({
      requestId: uuid(),
      plans: [{ operationId, planFingerprint: plan.planFingerprint }],
      writes: [
        { path: 'content/scenario/chapter/new.gal', text: '@scene new\n', expectedSha256: null },
        { path: 'content/scenario/reader.gal', text: '@scene reader\n@jump new\n', expectedSha256: sha256(readerBefore) },
      ],
    })).rejects.toMatchObject({ code: 'IMPORT_PLAN_STALE' });

    expect(await fs.readFile(reader, 'utf8')).toBe('@scene reader\n外部编辑。\n');
    expect(await fs.readFile(source, 'utf8')).toBe('@scene old\n');
    await expect(fs.stat(path.join(value.project, 'content/scenario/chapter/new.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back an interrupted partial publish and safely retries the same request', async () => {
    const value = await fixture('after_first_publish');
    const oldText = '@scene old\n凛：旧场景。\n@end\n';
    const readerBefore = '@scene reader\n@jump old\n';
    const readerAfter = '@scene reader\n@jump new\n';
    await fs.writeFile(path.join(value.project, 'content/scenario/chapter/old.gal'), oldText);
    await fs.writeFile(path.join(value.project, 'content/scenario/reader.gal'), readerBefore);
    const operationId = uuid();
    const plan = await value.authority.plan({
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/chapter/old.gal',
      targetPath: 'content/scenario/chapter/new.gal',
    });
    const request = {
      requestId: uuid(),
      plans: [{ operationId, planFingerprint: plan.planFingerprint }],
      writes: [
        { path: 'content/scenario/chapter/new.gal', text: oldText.replace('@scene old', '@scene new'), expectedSha256: null },
        { path: 'content/scenario/reader.gal', text: readerAfter, expectedSha256: sha256(readerBefore) },
      ],
    };

    await expect(value.authority.commit(request)).rejects.toBeInstanceOf(SceneLifecycleInjectedTermination);
    const recoveries: Array<{ requestId: string; changedPaths: string[] }> = [];
    const recovered = new ProjectSceneLifecycleAuthority(value.paths, {
      assertLeaseHeld: () => undefined,
      onRecovered: async (requestId, changedPaths) => {
        recoveries.push({ requestId, changedPaths });
        await expect(fs.stat(path.join(value.project, 'content/scenario/chapter/new.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(await fs.readFile(path.join(value.project, 'content/scenario/chapter/old.gal'), 'utf8')).toBe(oldText);
      },
    });
    await expect(recovered.commit(request)).resolves.toMatchObject({ status: 'COMMITTED', requestId: request.requestId });
    await expect(fs.readFile(path.join(value.project, 'content/scenario/chapter/new.gal'), 'utf8'))
      .resolves.toContain('@scene new');
    await expect(fs.readFile(path.join(value.project, 'content/scenario/reader.gal'), 'utf8')).resolves.toBe(readerAfter);
    await expect(fs.stat(path.join(value.project, 'content/scenario/chapter/old.gal')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]?.requestId).toBe(request.requestId);
    expect(recoveries[0]?.changedPaths).toContain('content/scenario/chapter/new.gal');
  });

  it('retries safely after a crash between stage creation and durable stage identity', async () => {
    const value = await fixture('after_first_stage_before_record');
    const request = {
      requestId: uuid(),
      plans: [],
      writes: [{ path: 'content/scenario/chapter/new.gal', text: '@scene new\n', expectedSha256: null }],
    };

    await expect(value.authority.commit(request)).rejects.toBeInstanceOf(SceneLifecycleInjectedTermination);
    const chapter = path.join(value.project, 'content/scenario/chapter');
    expect((await fs.readdir(chapter)).filter((name) => name.endsWith('.tmp'))).toHaveLength(1);

    const recovered = new ProjectSceneLifecycleAuthority(value.paths, { assertLeaseHeld: () => undefined });
    await expect(recovered.commit(request)).resolves.toMatchObject({ status: 'COMMITTED', requestId: request.requestId });
    await expect(fs.readFile(path.join(chapter, 'new.gal'), 'utf8')).resolves.toBe('@scene new\n');
    // The authority cannot prove ownership of the pre-record crash residue, so
    // it leaves that one hidden file untouched instead of risking deletion.
    expect((await fs.readdir(chapter)).filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
  });

  it('detects an external edit after publication and never removes that replacement', async () => {
    const value = await fixture();
    const source = path.join(value.project, 'content/scenario/chapter/old.gal');
    const target = path.join(value.project, 'content/scenario/chapter/new.gal');
    await fs.writeFile(source, '@scene old\n');
    const authority = new ProjectSceneLifecycleAuthority(value.paths, {
      assertLeaseHeld: () => undefined,
      faultInjector: async (point) => {
        if (point === 'after_first_publish') await fs.writeFile(target, '外部程序在发布后改写');
      },
    });
    const operationId = uuid();
    const plan = await authority.plan({
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/chapter/old.gal',
      targetPath: 'content/scenario/chapter/new.gal',
    });

    await expect(authority.commit({
      requestId: uuid(),
      plans: [{ operationId, planFingerprint: plan.planFingerprint }],
      writes: [{ path: 'content/scenario/chapter/new.gal', text: '@scene new\n', expectedSha256: null }],
    })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });

    await expect(fs.readFile(target, 'utf8')).resolves.toBe('外部程序在发布后改写');
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('@scene old\n');
  });

  it('does not remove a same-content target replaced after an interrupted publish', async () => {
    const value = await fixture('after_first_publish');
    const source = path.join(value.project, 'content/scenario/chapter/old.gal');
    const target = path.join(value.project, 'content/scenario/chapter/new.gal');
    await fs.writeFile(source, '@scene old\n');
    const operationId = uuid();
    const plan = await value.authority.plan({
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/chapter/old.gal',
      targetPath: 'content/scenario/chapter/new.gal',
    });
    const request = {
      requestId: uuid(),
      plans: [{ operationId, planFingerprint: plan.planFingerprint }],
      writes: [{ path: 'content/scenario/chapter/new.gal', text: '@scene new\n', expectedSha256: null }],
    };
    await expect(value.authority.commit(request)).rejects.toBeInstanceOf(SceneLifecycleInjectedTermination);
    await fs.rename(target, `${target}.owned`);
    await fs.writeFile(target, '@scene new\n');

    const recovered = new ProjectSceneLifecycleAuthority(value.paths, { assertLeaseHeld: () => undefined });
    await expect(recovered.recoverPending()).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('@scene new\n');
  });

  it('revalidates the scene parent immediately before publication', async () => {
    const value = await fixture();
    const chapter = path.join(value.project, 'content/scenario/chapter');
    const originalChapter = `${chapter}-original`;
    const outside = path.join(value.root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(chapter, 'old.gal'), '@scene old\n');
    const authority = new ProjectSceneLifecycleAuthority(value.paths, {
      assertLeaseHeld: () => undefined,
      faultInjector: async (point) => {
        if (point !== 'before_first_publish') return;
        await fs.rename(chapter, originalChapter);
        await fs.symlink(outside, chapter, process.platform === 'win32' ? 'junction' : 'dir');
      },
    });
    const operationId = uuid();
    const plan = await authority.plan({
      operationId,
      kind: 'rename',
      sourcePath: 'content/scenario/chapter/old.gal',
      targetPath: 'content/scenario/chapter/new.gal',
    });

    await expect(authority.commit({
      requestId: uuid(),
      plans: [{ operationId, planFingerprint: plan.planFingerprint }],
      writes: [{ path: 'content/scenario/chapter/new.gal', text: '@scene new\n', expectedSha256: null }],
    })).rejects.toMatchObject({ code: 'IMPORT_RECOVERY_REQUIRED' });
    await expect(fs.stat(path.join(outside, 'new.gal'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('finalizes an interrupted committed record without replaying project mutations', async () => {
    const value = await fixture('after_committed_record');
    const source = path.join(value.project, 'content/scenario/chapter/delete-me.gal');
    await fs.writeFile(source, '@scene delete-me\n');
    const operationId = uuid();
    const plan = await value.authority.plan({
      operationId,
      kind: 'delete',
      sourcePath: 'content/scenario/chapter/delete-me.gal',
    });
    const request = {
      requestId: uuid(),
      plans: [{ operationId, planFingerprint: plan.planFingerprint }],
      writes: [],
    };

    await expect(value.authority.commit(request)).rejects.toBeInstanceOf(SceneLifecycleInjectedTermination);
    await expect(fs.stat(source)).rejects.toMatchObject({ code: 'ENOENT' });
    const recovered = new ProjectSceneLifecycleAuthority(value.paths, { assertLeaseHeld: () => undefined });
    const first = await recovered.commit(request);
    const second = await recovered.commit(request);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 'COMMITTED', deletedPaths: ['content/scenario/chapter/delete-me.gal'] });
  });

  it('makes committed stage cleanup idempotent across response loss', async () => {
    const value = await fixture('after_committed_record');
    const request = {
      requestId: uuid(),
      plans: [],
      writes: [{ path: 'content/scenario/chapter/new.gal', text: '@scene new\n', expectedSha256: null }],
    };

    await expect(value.authority.commit(request)).rejects.toBeInstanceOf(SceneLifecycleInjectedTermination);
    const recovered = new ProjectSceneLifecycleAuthority(value.paths, { assertLeaseHeld: () => undefined });
    const first = await recovered.commit(request);
    const second = await recovered.commit(request);

    expect(first).toEqual(second);
    await expect(fs.readFile(path.join(value.project, 'content/scenario/chapter/new.gal'), 'utf8'))
      .resolves.toBe('@scene new\n');
  });
});
