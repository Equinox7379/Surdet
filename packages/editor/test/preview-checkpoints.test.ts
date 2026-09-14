import { afterEach, expect, it, vi } from 'vitest';
import { previewCheckpointKey, readPreviewCheckpoint, writePreviewCheckpoint } from '../src/preview-checkpoints.js';
const checkpoint = { seed: 19, sceneId: 'start', choices: [], target: { sceneId: 'start', kind: 'text' as const, anchor: null, fingerprint: 'a'.repeat(64) } };
afterEach(() => vi.unstubAllGlobals());
it('continues a working change across revisions while keeping projects, candidates and entry points separate', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  const key = previewCheckpointKey('project-a', { kind: 'working-change', changeId: 'change-a', workingRevision: 1 }, 'start');
  expect(writePreviewCheckpoint(key, checkpoint)).toBe(true);
  expect(readPreviewCheckpoint(previewCheckpointKey('project-a', { kind: 'working-change', changeId: 'change-a', workingRevision: 2 }, 'start'))).toEqual(checkpoint);
  for (const other of [previewCheckpointKey('project-b', { kind: 'working-change', changeId: 'change-a' }, 'start'),
    previewCheckpointKey('project-a', { kind: 'working-change', changeId: 'change-b' }, 'start'),
    previewCheckpointKey('project-a', { kind: 'saved-project' }, 'start'), previewCheckpointKey('project-a', { kind: 'working-change', changeId: 'change-a' }, 'start', 'later')]) {
    expect(readPreviewCheckpoint(other)).toBeNull();
  }
  expect(previewCheckpointKey(undefined, null, 'start')).toBeNull();
});
it('reports failed persistence and rejects corrupt checkpoints without saving or faking state', () => {
  vi.stubGlobal('localStorage', { getItem: () => '{', setItem: () => { throw new Error('quota'); } });
  expect(writePreviewCheckpoint('checkpoint', checkpoint)).toBe(false);
  expect(readPreviewCheckpoint('checkpoint')).toBeNull();
});
