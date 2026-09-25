import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginChange, InMemoryChangeRepository } from '../src/change-session.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { applySceneRemove } from '../src/operations.js';

const hasher = { sha256: async (text: string) => createHash('sha256').update(text).digest('hex') };
const target = 'content/scenario/chapter/unused.GAL';
const source = '@scene unused\r\n@label entry\r\n@goto entry\r\n@end\r\n';
async function fixture(extra: Record<string, string> = {}, mode: 'direct' | 'candidate' = 'direct') {
  const files: Record<string, string> = {
    'game.config.json': '{"entryScene":"start","variables":{}}',
    'content/scenario/start.gal': '@scene start\n@end\n',
    [target]: source,
    ...extra,
  };
  const storage = { rootIdentity: 'remove-fixture', listFiles: async () => Object.keys(files), exists: async (path: string) => path in files,
    readText: async (path: string) => ({ path, text: files[path]!, bytes: Buffer.byteLength(files[path]!), sha256: await hasher.sha256(files[path]!) }) };
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const change = await beginChange(snapshot, new InMemoryChangeRepository(), undefined, undefined, { composition: { mode, operationFactsVersion: '1.0.0', baseAssetRefs: [] } });
  return { change, files, snapshot };
}
const request = async () => ({ operationId: 'remove-unused', sceneId: 'unused', expectedFingerprint: await hasher.sha256(source) });

describe('direct scene removal', () => {
  it('removes the exact nested path, preserves source and retries without deleting twice', async () => {
    const { change, files } = await fixture();
    const input = await request();
    expect(await applySceneRemove(change, input, hasher)).toEqual({ sceneId: 'unused', path: target, removed: true });
    expect(change.record.workingFiles[target]).toBeUndefined();
    expect(files[target]).toBe(source);
    const saved = structuredClone(change.record);
    await applySceneRemove(change, input, hasher);
    expect(change.record).toEqual(saved);
    await expect(applySceneRemove(change, { ...input, sceneId: 'start' }, hasher)).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
  });

  it.each([
    ['double-quoted jump', '" -> " == " -> "', '@jump unused.entry'],
    ['single-quoted call', "' -> ' == ' -> '", '@call unused.entry'],
  ])('protects the real target after arrows inside a %s condition', async (_name, condition, action) => {
    const callerPath = 'content/scenario/start.gal';
    const caller = `@scene start\n@choice\n  继续 [if:${condition}] -> ${action}\n@end\n`;
    const { change, files } = await fixture({ [callerPath]: caller });
    const before = structuredClone(change.record);
    await expect(applySceneRemove(change, await request(), hasher)).rejects.toMatchObject({
      code: 'OBJECT_PRECONDITION_FAILED',
      details: { operationApplied: false, references: expect.arrayContaining([
        expect.objectContaining({ path: callerPath, line: 3, target: 'unused' }),
      ]) },
    });
    expect(change.record).toEqual(before);
    expect(await change.repository.read(change.record.changeId)).toEqual(before);
    expect(files[target]).toBe(source);
    expect(files[callerPath]).toBe(caller);
  });

  it('does not treat a quoted condition instruction as an incoming scene reference', async () => {
    const { change, files } = await fixture({
      'content/scenario/start.gal': '@scene start\n@choice\n  继续 [if:" -> @jump unused " == " -> @jump unused "] -> @jump unused_other\n@end\n',
      'content/scenario/unused_other.gal': '@scene unused_other\n@end\n',
    });
    await expect(applySceneRemove(change, await request(), hasher)).resolves.toMatchObject({ removed: true });
    expect(change.record.workingFiles[target]).toBeUndefined();
    expect(change.record.workingFiles['content/scenario/unused_other.gal']).toBe(files['content/scenario/unused_other.gal']);
    expect(files[target]).toBe(source);
  });

  it.each([
    ['entryScene', 'game.config.json', '{"entryScene":"unused"}'],
    ['player.endScenes', 'game.config.json', '{"entryScene":"start","player":{"endScenes":["unused"]}}'],
    ['jump', 'content/scenario/start.gal', '@scene start\n@jump unused.entry\n@end\n'],
    ['call', 'content/scenario/start.gal', '@scene start\n@call "unused.entry"\n@end\n'],
    ['choice call', 'content/scenario/start.gal', '@scene start\n@choice\n  继续 -> @call unused.entry\n@end\n'],
    ['conditional jump', 'content/scenario/start.gal', '@scene start\n@if false\n@jump unused\n@endif\n@end\n'],
    ['gallery', 'content/config/gallery.json', '{"texts":[{"id":"memory","scene":"unused","label":"entry"}]}'],
    ['event', 'content/config/events.json', '{"events":[{"scene":"unused"}]}'],
    ['scheduled event', 'content/config/events.json', '{"scheduled":[{"scene":"unused"}]}'],
    ['growth', 'content/config/growth.json', '{"profiles":[{"levelEvents":{"2":"unused"}}]}'],
    ['calendar node', 'content/config/calendar.json', '{"nodes":[{"eventId":"unused"}]}'],
    ['calendar command', 'content/config/calendar.json', '{"baseCommands":[{"eventId":"unused"}]}'],
  ])('rejects %s references and preserves record/evidence', async (_kind, path, text) => {
    const { change, snapshot } = await fixture({ [path!]: text! });
    expect(snapshot.files.some(file => file.path === path)).toBe(true);
    const before = structuredClone(change.record);
    await expect(applySceneRemove(change, await request(), hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED', details: { operationApplied: false, references: expect.arrayContaining([expect.objectContaining({ path })]) } });
    expect(change.record).toEqual(before);
    expect(await change.repository.read(change.record.changeId)).toEqual(before);
  });

  it('does not mistake prose, comments or a different scene for incoming references', async () => {
    const { change } = await fixture({ 'content/scenario/start.gal': '@scene start\n旁白：@call unused.entry 是正文。\n// @jump unused\n@jump unused_other\n@end\n', 'content/scenario/unused_other.gal': '@scene unused_other\n@end\n' });
    await expect(applySceneRemove(change, await request(), hasher)).resolves.toMatchObject({ removed: true });
  });

  it('rejects missing, ambiguous, stale and candidate requests before mutation', async () => {
    for (const [extra, mode, code] of [
      [{}, 'candidate', 'UNSUPPORTED_OPERATION'],
      [{ [target]: source + 'changed\n' }, 'direct', 'OBJECT_REF_STALE'],
      [{ 'content/scenario/unused.gal': source }, 'direct', 'OBJECT_AMBIGUOUS'],
    ] as const) {
      const { change } = await fixture(extra, mode);
      const before = structuredClone(change.record);
      await expect(applySceneRemove(change, await request(), hasher)).rejects.toMatchObject({ code });
      expect(change.record).toEqual(before);
    }
    const { change } = await fixture();
    await expect(applySceneRemove(change, { ...await request(), sceneId: 'missing' }, hasher)).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
  });

  it('does not delete when a referenced config cannot be parsed', async () => {
    const { change } = await fixture({ 'content/config/events.json': '{broken' });
    const before = structuredClone(change.record);
    await expect(applySceneRemove(change, await request(), hasher)).rejects.toMatchObject({ code: 'PROJECT_INVALID', message: expect.stringContaining('content/config/events.json') });
    expect(change.record).toEqual(before);
  });

  it('protects the implicit first-scene entry and rejects integration changes', async () => {
    const { change } = await fixture({ 'game.config.json': '{}' });
    await expect(applySceneRemove(change, await request(), hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED', details: { references: [expect.objectContaining({ kind: 'entryScene' })] } });
    const { change: integration } = await fixture();
    integration.record.integration = {
      planId: 'plan', planFingerprint: 'sealed', executeOperationId: 'execute', sourceCapsules: [], includedUnitIds: [],
      deduplicatedUnits: [], conflictResolutions: [], status: 'READY', nextOperationIndex: 0, replayedOperations: [],
    };
    const before = structuredClone(integration.record);
    await expect(applySceneRemove(integration, await request(), hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(integration.record).toEqual(before);
  });
});
