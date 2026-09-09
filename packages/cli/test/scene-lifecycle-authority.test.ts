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
