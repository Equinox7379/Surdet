import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginChange, InMemoryChangeRepository } from '../src/change-session.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { applySceneRename, visitSceneReferences } from '../src/scene-relocation.js';
import { buildOperationLedgerDiff } from '../src/diff.js';

const hasher = { sha256: async (text: string) => createHash('sha256').update(text).digest('hex') };
const oldPath = 'content/scenario/章节/old.GAL';
const source = '@scene\told\r\n// old 不改\r\n@label entry\r\n旁白：old 与 @jump old 是正文。\r\n@return\r\n';
async function fixture(extra: Record<string, string> = {}, mode: 'direct' | 'candidate' = 'direct') {
  const files: Record<string, string> = {
    'game.config.json': '{"entryScene":"start","variables":{}}',
    'content/scenario/start.gal': '@scene start\n@call old.entry\n@end\n',
    [oldPath]: source,
    ...extra,
  };
  const storage = { rootIdentity: 'rename-fixture', listFiles: async () => Object.keys(files), exists: async (path: string) => path in files,
    readText: async (path: string) => ({ path, text: files[path]!, bytes: Buffer.byteLength(files[path]!), sha256: await hasher.sha256(files[path]!) }) };
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const change = await beginChange(snapshot, new InMemoryChangeRepository(), undefined, undefined, { composition: { mode, operationFactsVersion: '1.0.0', baseAssetRefs: [] } });
  const input = { operationId: 'rename-old', sceneId: 'old', newSceneId: 'arrival', expectedFingerprint: await hasher.sha256(files[oldPath]!) };
  return { files, change, input };
}

describe('scene rename in an isolated direct draft', () => {
  it('rewrites precise targets and known config fields atomically, retaining unknown data and source bytes', async () => {
    const caller = '@scene start\r\n@if true\r\n@call old.entry\r\n@endif\r\n@choice\r\n  前往 " -> @jump old " [if:" -> @jump old " == " -> @jump old "] -> @call old.entry @jump older @jump old\r\n  返回 -> @jump old.entry\r\n@end\r\n';
    const { change, files, input } = await fixture({
      'content/scenario/start.gal': caller,
      'content/scenario/older.gal': '@scene older\n@label old\n@goto old\n@end\n',
      'game.config.json': '{"entryScene":"old","variables":{},"title":"old","unknown":{"scene":"old"},"player":{"endScenes":["old","older"],"firstRunHint":"old"}}',
      'content/config/gallery.json': '{"cgs":[{"id":"old","src":"old"}],"texts":[{"id":"old","scene":"old","label":"entry","unknown":1}]}',
      'content/config/events.json': '{"events":[{"id":"e","scene":"old"}],"scheduled":[{"scene":"old"}],"other":"old"}',
      'content/config/growth.json': '{"profiles":[{"levelEvents":{"2":"old","3":"older"}}]}',
      'content/config/calendar.json': '{"nodes":[{"eventId":"old"}],"baseCommands":[{"eventId":"old"}]}',
    });
    const beforeSource = { ...files };
    const result = await applySceneRename(change, input, hasher);
    expect(result).toMatchObject({ previousSceneId: 'old', sceneId: 'arrival', previousPath: oldPath, path: 'content/scenario/章节/arrival.GAL' });
    const working = change.record.workingFiles;
    expect(working[oldPath]).toBeUndefined();
    expect(working[result.path]).toBe(source.replace('@scene\told', '@scene\tarrival'));
    expect(working['content/scenario/start.gal']).toBe(caller.replaceAll('@call old.entry', '@call arrival.entry').replace('返回 -> @jump old.entry', '返回 -> @jump arrival.entry'));
    expect(working['content/scenario/older.gal']).toBe(files['content/scenario/older.gal']);
    expect(JSON.parse(working['game.config.json']!)).toMatchObject({ entryScene: 'arrival', title: 'old', unknown: { scene: 'old' }, player: { endScenes: ['arrival', 'older'], firstRunHint: 'old' } });
    expect(JSON.parse(working['content/config/gallery.json']!)).toEqual({ cgs: [{ id: 'old', src: 'old' }], texts: [{ id: 'old', scene: 'arrival', label: 'entry', unknown: 1 }] });
    expect(JSON.parse(working['content/config/events.json']!)).toEqual({ events: [{ id: 'e', scene: 'arrival' }], scheduled: [{ scene: 'arrival' }], other: 'old' });
    expect(JSON.parse(working['content/config/growth.json']!).profiles[0].levelEvents).toEqual({ 2: 'arrival', 3: 'older' });
    expect(JSON.parse(working['content/config/calendar.json']!)).toEqual({ nodes: [{ eventId: 'arrival' }], baseCommands: [{ eventId: 'arrival' }] });
    expect(result.affectedPaths).toHaveLength(8);
    expect(buildOperationLedgerDiff(change.record)).toMatchObject([{ kind: 'scene.rename', objectBefore: 'scene:old', objectAfter: 'scene:arrival' }]);
    expect(files).toEqual(beforeSource);
    const recorded = structuredClone(change.record);
    expect(await applySceneRename(change, input, hasher)).toEqual(result);
    expect(change.record).toEqual(recorded);
    await expect(applySceneRename(change, { ...input, newSceneId: 'different' }, hasher)).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
  });

  it('pins an implicit entry before the filename sort changes', async () => {
    const { change, input } = await fixture({ 'game.config.json': '{"variables":{}}' });
    await applySceneRename(change, input, hasher);
    expect(JSON.parse(change.record.workingFiles['game.config.json']!).entryScene).toBe('start');
  });

  it('keeps declared custom instructions and BOM/config line endings', async () => {
    const { change, input } = await fixture({
      'game.config.json': '\uFEFF{\r\n  "entryScene":"old", "customInstructions":["extra"]\r\n}\r\n',
      [oldPath]: source.replace('@return', '@extra value\r\n@return'),
    });
    await applySceneRename(change, input, hasher);
    expect(change.record.workingFiles['game.config.json']).toMatch(/^\uFEFF/);
    expect(change.record.workingFiles['game.config.json']!.replace(/\r\n/g, '')).not.toContain('\n');
    expect(change.record.workingFiles['content/scenario/章节/arrival.GAL']).toContain('@extra value\r\n');
  });

  it.each([
    ['stale', {}, { expectedFingerprint: 'stale' }, 'OBJECT_REF_STALE'],
    ['existing case alias', { 'content/scenario/other/ARRIVAL.gal': '@scene ARRIVAL\n@end\n' }, {}, 'OBJECT_PRECONDITION_FAILED'],
    ['duplicate old identity', { 'content/scenario/old.gal': '@scene old\n@end\n' }, {}, 'OBJECT_AMBIGUOUS'],
    ['case only', {}, { newSceneId: 'OLD' }, 'INVALID_REQUEST'],
    ['path traversal', {}, { newSceneId: '../elsewhere' }, 'INVALID_REQUEST'],
    ['reserved filename', {}, { newSceneId: 'con' }, 'INVALID_REQUEST'],
    ['quoted ambiguous target', { 'content/scenario/start.gal': '@scene start\n@call "old.entry"\n@end\n' }, {}, 'UNSUPPORTED_OPERATION'],
    ['invalid gallery shape', { 'content/config/gallery.json': '{"texts":{}}' }, {}, 'PROJECT_INVALID'],
    ['invalid ending shape', { 'game.config.json': '{"entryScene":"start","player":{"endScenes":null}}' }, {}, 'PROJECT_INVALID'],
    ['mismatched declaration', { [oldPath]: '@scene other\n@end\n' }, {}, 'OBJECT_PRECONDITION_FAILED'],
  ] as const)('rejects %s with no partial business changes', async (_case, files, override, code) => {
    const { change, input } = await fixture(files);
    const before = structuredClone(change.record);
    await expect(applySceneRename(change, { ...input, ...override }, hasher)).rejects.toMatchObject({ code });
    expect(change.record).toEqual(before);
    expect(await change.repository.read(change.record.changeId)).toEqual(before);
  });

  it('rejects candidate and integration before writes without altering existing modes', async () => {
    const { change, input } = await fixture({}, 'candidate');
    const before = structuredClone(change.record);
    await expect(applySceneRename(change, input, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record).toEqual(before);
    const direct = await fixture();
    direct.change.record.integration = {} as NonNullable<typeof direct.change.record.integration>;
    await expect(applySceneRename(direct.change, direct.input, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
  });
});

describe('Editor/authoring shared scene target visitor', () => {
  it('keeps unfinished surrounding text, Unicode, quoted arrows and unknown instructions intact', () => {
    const source = '// old\r\n@if true\r\n@custom "@jump old"\r\n@call old.entry\r\n@choice\r\n  中文 [if:" -> " == " -> "] -> @set x = "@jump old" @jump old @jump old.ignored\r\n';
    const result = visitSceneReferences(source, 'old', 'new');
    expect(result.count).toBe(2);
    expect(result.text).toBe(source.replace('@call old.entry', '@call new.entry').replace('@jump old @jump', '@jump new @jump'));
  });
});
