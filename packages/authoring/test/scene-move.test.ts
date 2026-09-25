import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginChange, InMemoryChangeRepository } from '../src/change-session.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { applySceneMove } from '../src/scene-relocation.js';
import { buildOperationLedgerDiff } from '../src/diff.js';

const hasher = { sha256: async (text: string) => createHash('sha256').update(text).digest('hex') };
const oldPath = 'content/scenario/start.GaL';
const source = '@scene start\r\n// 章节不改变脚本\r\n@call ending.entry\r\n旁白：正文。\r\n@end\r\n';
async function fixture(extra: Record<string, string> = {}, mode: 'direct' | 'candidate' = 'direct') {
  const files: Record<string, string> = {
    'game.config.json': '{"entryScene":"start","variables":{},"unknown":{"keep":true}}',
    [oldPath]: source,
    'content/scenario/ending.gal': '@scene ending\n@label entry\n@return\n',
    ...extra,
  };
  const storage = { rootIdentity: 'move-fixture', listFiles: async () => Object.keys(files), exists: async (path: string) => path in files,
    readText: async (path: string) => ({ path, text: files[path]!, bytes: Buffer.byteLength(files[path]!), sha256: await hasher.sha256(files[path]!) }) };
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const change = await beginChange(snapshot, new InMemoryChangeRepository(), undefined, undefined, { composition: { mode, operationFactsVersion: '1.0.0', baseAssetRefs: [] } });
  const input = { operationId: 'move-start', sceneId: 'start', directory: '第一章/街角 雨后', expectedPath: oldPath, expectedFingerprint: await hasher.sha256(source) };
  return { files, snapshot, change, input };
}

describe('chapter scene move', () => {
  it('moves exact bytes in one draft revision, preserves config/references and supports idempotency and return to root', async () => {
    const { change, files, input } = await fixture();
    const before = { ...files };
    const result = await applySceneMove(change, input, hasher);
    const targetPath = 'content/scenario/第一章/街角 雨后/start.GaL';
    expect(result).toMatchObject({ sceneId: 'start', previousPath: oldPath, path: targetPath });
    expect(result.affectedPaths).toEqual([oldPath, targetPath]);
    expect(change.record.workingFiles).toEqual({ ...before, [oldPath]: undefined, [targetPath]: source });
    expect(oldPath in change.record.workingFiles).toBe(false);
    expect(change.record.workingRevision).toBe(1);
    expect(buildOperationLedgerDiff(change.record)).toMatchObject([{ kind: 'scene.move', objectBefore: 'scene:start', objectAfter: 'scene:start' }]);
    expect(files).toEqual(before);
    const recorded = structuredClone(change.record);
    expect(await applySceneMove(change, input, hasher)).toEqual(result);
    expect(change.record).toEqual(recorded);
    await expect(applySceneMove(change, { ...input, directory: '第二章' }, hasher)).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
    await expect(applySceneMove(change, { ...input, operationId: 'stale-position', directory: '第二章' }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(change.record).toEqual(recorded);
    await applySceneMove(change, { ...input, operationId: 'move-back', expectedPath: targetPath, directory: '' }, hasher);
    expect(change.record.workingFiles).toEqual(before);
    expect(change.record.workingRevision).toBe(2);
  });

  it('pins the original implicit first scene, preserving unknown config and CRLF/BOM', async () => {
    const { change, snapshot, input } = await fixture({ 'game.config.json': '\uFEFF{\r\n  "custom": {"entryScene":"keep"}\r\n}\r\n' });
    await applySceneMove(change, { ...input, directory: '000' }, hasher);
    const text = change.record.workingFiles['game.config.json']!;
    expect(text).toMatch(/^\uFEFF/);
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(JSON.parse(text.replace(/^\uFEFF/, ''))).toEqual({ custom: { entryScene: 'keep' }, entryScene: snapshot.scenes[0]!.id });
  });

  it.each(['../outside', '/absolute', 'C:/else', 'a\\b', 'a//b', 'a/./b', 'a/../b', 'a/', 'NUL.txt', 'x/COM1', 'chapter.', 'chapter ', 'a:b', 'node_modules', '.git', 'dist', '.surdet-tmp'])('rejects unusable directory %s before mutation', async directory => {
    const { change, input } = await fixture();
    const before = structuredClone(change.record);
    await expect(applySceneMove(change, { ...input, directory }, hasher)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(change.record).toEqual(before);
    expect(await change.repository.read(change.record.changeId)).toEqual(before);
  });

  it.each([
    ['stale content', {}, { expectedFingerprint: 'old' }, 'OBJECT_REF_STALE'],
    ['stale position', {}, { expectedPath: 'content/scenario/else/start.GaL' }, 'OBJECT_REF_STALE'],
    ['no move', {}, { directory: '' }, 'INVALID_REQUEST'],
    ['duplicate scene identity', { 'content/scenario/chapter/start.gal': '@scene start\n@end\n' }, {}, 'OBJECT_AMBIGUOUS'],
    ['target case alias', { 'content/scenario/第一章/街角 雨后/START.gal': '@scene START\n@end\n' }, {}, 'OBJECT_PRECONDITION_FAILED'],
    ['parent case alias', { 'content/scenario/Chapter/other.gal': '@scene other\n@end\n' }, { directory: 'chapter' }, 'OBJECT_PRECONDITION_FAILED'],
    ['parent is a file', {}, { directory: 'ending.gal/sub' }, 'OBJECT_PRECONDITION_FAILED'],
    ['invalid entry config', { 'game.config.json': '{"entryScene":42}' }, {}, 'PROJECT_INVALID'],
  ] as const)('rejects %s without partial changes', async (_case, files, override, code) => {
    const { change, input } = await fixture(files);
    const before = structuredClone(change.record);
    await expect(applySceneMove(change, { ...input, ...override }, hasher)).rejects.toMatchObject({ code });
    expect(change.record).toEqual(before);
  });

  it('rejects candidate and integration before recording any operation', async () => {
    const { change, input } = await fixture({}, 'candidate');
    const before = structuredClone(change.record);
    await expect(applySceneMove(change, input, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record).toEqual(before);
    const direct = await fixture();
    direct.change.record.integration = {} as NonNullable<typeof direct.change.record.integration>;
    const integration = structuredClone(direct.change.record);
    await expect(applySceneMove(direct.change, direct.input, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(direct.change.record).toEqual(integration);
  });
});
