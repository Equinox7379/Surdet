import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { buildObjectIndex } from '../src/object-index.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

const timelineText = JSON.stringify({
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
});

const agentProbeText = ['@scene agent_probe', '@label start', '@timeline agent_blackout @ blocking', '@end'].join('\n');

function fixtureStorage(): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': '{"entryScene":"ch01_01","variables":{}}',
    'content/scenario/agent_probe.gal': agentProbeText,
    'content/timelines/agent_blackout.json': timelineText,
  };
  return {
    rootIdentity: 'fixture-root',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error('missing fixture file: ' + path);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

describe('timeline object index', () => {
  it('indexes timeline, tracks and cues with revision-scoped refs', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const index = buildObjectIndex(snapshot);
    const timeline = index.byRef.get('timeline:agent_blackout');
    expect(timeline).toBeDefined();
    expect(timeline!.kind).toBe('timeline');
    expect(timeline!.source?.path).toBe('content/timelines/agent_blackout.json');
    expect(timeline!.childRefs).toEqual([
      'timeline:agent_blackout/track:0',
      'timeline:agent_blackout/track:1',
      'timeline:agent_blackout/track:2',
    ]);
    const tracks = index.objects.filter((object) => object.kind === 'track');
    expect(tracks.map((object) => object.objectRef)).toEqual([
      'timeline:agent_blackout/track:0',
      'timeline:agent_blackout/track:1',
      'timeline:agent_blackout/track:2',
    ]);
    expect(tracks.every((object) => object.parentRef === 'timeline:agent_blackout')).toBe(true);
    const cues = index.objects.filter((object) => object.kind === 'cue');
    expect(cues).toHaveLength(4);
    expect(cues[0]!.objectRef).toBe('timeline:agent_blackout/track:0/cue:0');
    expect(cues[0]!.parentRef).toBe('timeline:agent_blackout/track:0');
    expect(index.byRef.get('timeline:agent_blackout/track:2')!.childRefs).toEqual([
      'timeline:agent_blackout/track:2/cue:0',
      'timeline:agent_blackout/track:2/cue:1',
    ]);
  });

  it('links scene instruction -> timeline -> cue -> asset in four directions', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const index = buildObjectIndex(snapshot);
    const instruction = index.objects.find((object) => (
      object.kind === 'instruction' && object.source?.raw.includes('@timeline agent_blackout')
    ));
    expect(instruction).toBeDefined();
    expect(instruction!.references).toEqual(['timeline:agent_blackout']);

    const timeline = index.byRef.get('timeline:agent_blackout')!;
    expect(timeline.referencedBy).toContain(instruction!.objectRef);
    expect(timeline.references).toContain('asset:bg:night_field');
    expect(timeline.references).toContain('asset:portrait:lynn:uniform:night');

    const bgCue = index.byRef.get('timeline:agent_blackout/track:0/cue:0')!;
    expect(bgCue.references).toEqual(['asset:bg:night_field']);

    const portraitCue = index.byRef.get('timeline:agent_blackout/track:1/cue:0')!;
    expect(portraitCue.references).toEqual(['asset:portrait:lynn:uniform:night']);

    const bgAsset = index.byRef.get('asset:bg:night_field')!;
    expect(bgAsset.kind).toBe('asset');
    expect(bgAsset.referencedBy).toContain(bgCue.objectRef);

    // 资产被 cue/track/timeline 三层引用（四向因果的完整反向链路）。
    const portraitAsset = index.byRef.get('asset:portrait:lynn:uniform:night')!;
    expect(portraitAsset.referencedBy).toEqual(expect.arrayContaining([
      portraitCue.objectRef,
      portraitCue.parentRef!,
      'timeline:agent_blackout',
    ]));
    expect(index.byRef.get(portraitCue.parentRef!)!.referencedBy).toBeDefined();
  });

  it('keeps screen fade cues in the track scope without asset edges', async () => {
    const snapshot = await loadProjectSnapshot(fixtureStorage(), hasher);
    const index = buildObjectIndex(snapshot);
    const fadeCues = index.objects.filter((object) => object.kind === 'cue' && object.objectRef.includes('/track:2/'));
    expect(fadeCues).toHaveLength(2);
    expect(fadeCues.every((object) => object.references.length === 0)).toBe(true);
  });

  it('tolerates a malformed timeline JSON without losing the timeline object', async () => {
    const contents: Record<string, string> = {
      'game.config.json': '{"entryScene":"prologue","variables":{}}',
      'content/scenario/prologue.gal': ['@scene prologue', '凛：台词。', '@end'].join('\n'),
      'content/timelines/broken.json': '{not json',
    };
    const storage: ProjectStorage = {
      rootIdentity: 'broken-timeline',
      listFiles: async () => Object.keys(contents),
      readText: async (path): Promise<ProjectFile> => {
        const text = contents[path];
        if (text === undefined) throw new Error('missing fixture file: ' + path);
        return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
      },
      exists: async (path) => path in contents,
    };
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const index = buildObjectIndex(snapshot);
    const timeline = index.byRef.get('timeline:broken');
    expect(timeline).toBeDefined();
    expect(timeline!.childRefs).toEqual([]);
    expect(index.objects.filter((object) => object.kind === 'cue')).toHaveLength(0);
  });
});
