import { describe, expect, it } from 'vitest';
import {
  AuthoringOperationError,
  beginChange,
  commitChange,
  rollbackChange,
  type ChangeSession,
  type TextHasher,
} from '../src/index.js';
import {
  applyTimelineCreate,
  applyTimelinePatch,
  canonicalTimelineJson,
  cueRefFor,
  timelineFingerprint,
  trackRefFor,
  type TimelineCreateInput,
  type TimelineCueInput,
  type TimelinePatchInput,
} from '../src/timeline-operations.js';
import type { ProjectSnapshot } from '../src/project-snapshot.js';
import { InMemoryChangeRepository } from '../src/change-session.js';
import type { ProjectWriteStorage } from '../src/project-storage.js';
import type { TimelineDefinition } from '@surdet/core';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

const baseDefinition: TimelineDefinition = {
  version: 1,
  id: 'agent_blackout',
  durationMs: 800,
  tracks: [
    { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] },
    {
      kind: 'screen',
      cues: [
        { atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 1 },
        { atMs: 50, durationMs: 700, easing: 'inOutSine', action: 'fade', alpha: 0 },
      ],
    },
  ],
};

function snapshot(files: ProjectSnapshot['files'] = []): ProjectSnapshot {
  return {
    rootIdentity: 'fixture-root',
    revision: 'rev000000',
    files,
    configFile: null,
    config: {},
    variables: {},
    scenes: [],
    timelines: [],
  };
}

async function open(files: ProjectSnapshot['files'] = []): Promise<{ change: ChangeSession; repo: InMemoryChangeRepository }> {
  const repo = new InMemoryChangeRepository();
  const change = await beginChange(snapshot(files), repo);
  return { change, repo };
}

function createInput(operationId: string, definition: TimelineDefinition): TimelineCreateInput {
  return { operationId, timelineId: definition.id, definition };
}

describe('timeline.create', () => {
  it('creates a timeline file through the isolated transaction', async () => {
    const { change } = await open();
    const result = await applyTimelineCreate(change, createInput('op-create', baseDefinition), hasher);
    expect(result.objectRef).toBe('timeline:agent_blackout');
    expect(result.path).toBe('content/timelines/agent_blackout.json');
    expect(result.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    const text = change.record.workingFiles['content/timelines/agent_blackout.json'];
    expect(text).toBeDefined();
    expect(JSON.parse(text!).id).toBe('agent_blackout');
    expect(change.record.workingRevision).toBe(1);
    expect(result.diffEntry.kind).toBe('timeline.create');
    expect(result.diffEntry.fingerprintAfter).toBe(result.fingerprint);
    expect(result.diffEntry.objectAfter).toBe('timeline:agent_blackout');
  });

  it('enforces the timelineId === definition.id === file stem identity invariant', async () => {
    const { change } = await open();
    const mismatch = await applyTimelineCreate(change, {
      operationId: 'op-mismatch',
      timelineId: 'other',
      definition: baseDefinition,
    }, hasher).catch((error: unknown) => error);
    expect(mismatch).toBeInstanceOf(AuthoringOperationError);
    expect((mismatch as AuthoringOperationError).code).toBe('VALIDATION_FAILED');
    // 拒绝时不得生成任何文件或推进修订。
    expect(change.record.workingFiles).toEqual({});
    expect(change.record.workingRevision).toBe(0);
    // 身份一致时同一事务内可以正常创建。
    const created = await applyTimelineCreate(change, createInput('op-ok', baseDefinition), hasher);
    expect(created.objectRef).toBe('timeline:agent_blackout');
    expect(change.record.workingRevision).toBe(1);
  });

  it('rejects an existing timeline without touching the transaction', async () => {
    const { change } = await open();
    await applyTimelineCreate(change, createInput('op-first', baseDefinition), hasher);
    await expect(applyTimelineCreate(change, {
      operationId: 'op-second',
      timelineId: 'agent_blackout',
      definition: { ...baseDefinition, durationMs: 900 },
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    expect(change.record.workingRevision).toBe(1);
  });

  it('accepts every non-audio Core track/action and rejects unsupported tracks', async () => {
    const { change } = await open();
    const visual: TimelineDefinition = {
      ...baseDefinition,
      durationMs: 1_600,
      tracks: [
        { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] },
        {
          kind: 'portrait',
          target: 'lynn:uniform',
          cues: [
            { atMs: 0, durationMs: 100, easing: 'linear', action: 'show', expression: 'night', position: 'left' },
            { atMs: 100, durationMs: 100, easing: 'linear', action: 'move', position: 'center' },
            { atMs: 200, durationMs: 0, easing: 'linear', action: 'expression', expression: 'alert' },
            { atMs: 300, durationMs: 100, easing: 'linear', action: 'hide' },
          ],
        },
        {
          kind: 'camera',
          cues: [
            { atMs: 0, durationMs: 200, easing: 'outCubic', action: 'zoom', scale: 1.25 },
            { atMs: 200, durationMs: 200, easing: 'linear', action: 'pan', x: 120, y: -60 },
            { atMs: 400, durationMs: 100, easing: 'linear', action: 'shake', strength: 12 },
          ],
        },
        {
          kind: 'screen',
          cues: [
            { atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 1 },
            { atMs: 50, durationMs: 100, easing: 'linear', action: 'tint', color: 0x123456, alpha: 0.5 },
            { atMs: 150, durationMs: 100, easing: 'linear', action: 'flash' },
            { atMs: 250, durationMs: 100, easing: 'linear', action: 'wipe' },
          ],
        },
        {
          kind: 'particle',
          cues: [
            { atMs: 0, durationMs: 500, easing: 'linear', action: 'start', kind: 'snow' },
            { atMs: 500, durationMs: 0, easing: 'linear', action: 'stop' },
          ],
        },
      ],
    };
    const created = await applyTimelineCreate(change, createInput('op-visual', visual), hasher);
    expect(created.fingerprint).toMatch(/^[0-9a-f]{8}$/);

    const unsupported: TimelineDefinition = {
      ...baseDefinition,
      id: 'unsupported_timeline',
      tracks: [{ kind: 'unknown' as never, cues: [] }],
    };
    await expect(applyTimelineCreate(change, createInput('op-unsupported', unsupported), hasher))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(Object.keys(change.record.workingFiles)).toEqual(['content/timelines/agent_blackout.json']);
  });

  it('rejects structurally invalid definitions before staging', async () => {
    const { change } = await open();
    const broken: TimelineDefinition = {
      ...baseDefinition,
      tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 2 }] }],
    };
    await expect(applyTimelineCreate(change, createInput('op-broken', broken), hasher))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(change.record.workingFiles).toEqual({});
  });

  it('does not add an audio track through timeline.create', async () => {
    const { change } = await open();
    await expect(applyTimelineCreate(change, createInput('op-audio-create', definitionWithAudio()), hasher))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record.workingFiles).toEqual({});
    expect(change.record.workingRevision).toBe(0);
  });
});

function definitionWithPortrait(): TimelineDefinition {
  return {
    ...baseDefinition,
    tracks: [
      ...baseDefinition.tracks,
      { kind: 'portrait', target: 'lynn:uniform', cues: [{ atMs: 100, durationMs: 0, easing: 'linear', action: 'show', expression: 'night', position: 'left' }] },
    ],
  };
}

function definitionWithAudio(): TimelineDefinition {
  const definition = JSON.parse(JSON.stringify({ ...baseDefinition, id: 'agent_audio' })) as TimelineDefinition;
  definition.tracks.push({
    kind: 'audio' as never,
    cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'bgm', key: 'existing_theme' }],
  });
  const background = definition.tracks[0] as unknown as Record<string, unknown>;
  background['opaqueTrackMetadata'] = { source: 'fixture' };
  const backgroundCue = definition.tracks[0]!.cues[0] as unknown as Record<string, unknown>;
  backgroundCue['opaqueCueMetadata'] = 'preserve';
  const audio = definition.tracks.at(-1) as unknown as Record<string, unknown>;
  audio['opaqueTrackMetadata'] = { source: 'audio-fixture' };
  return definition;
}

async function openedWithAudio(): Promise<{ change: ChangeSession; repo: InMemoryChangeRepository }> {
  const definition = definitionWithAudio();
  const text = `${JSON.stringify(definition)}\n`;
  return open([{
    path: 'content/timelines/agent_audio.json',
    text,
    bytes: text.length,
    sha256: await hasher.sha256(text),
  }]);
}

async function created(): Promise<{ change: ChangeSession; repo: InMemoryChangeRepository }> {
  const { change, repo } = await open();
  await applyTimelineCreate(change, createInput('op-create', definitionWithPortrait()), hasher);
  return { change, repo };
}

describe('timeline.patch', () => {
  it('supports a single atomic patch per call with fingerprint gates', async () => {
    const { change } = await created();
    const createResult = change.record.operations['op-create']?.result as { fingerprint: string };
    const addInput: TimelinePatchInput = {
      operationId: 'op-add',
      timelineId: 'agent_blackout',
      patch: {
        kind: 'addTrack',
        expectedFingerprint: createResult.fingerprint,
        trackKind: 'screen',
      },
    };
    const add = await applyTimelinePatch(change, addInput, hasher);
    expect(add.objectRef).toBe('timeline:agent_blackout');
    expect(change.record.workingRevision).toBe(2);
    const parsed = JSON.parse(change.record.workingFiles['content/timelines/agent_blackout.json']!) as TimelineDefinition;
    expect(parsed.tracks).toHaveLength(4);

    // insertCue gates on the track fingerprint of the newly added track.
    const trackFingerprint = await timelineFingerprint(parsed.tracks[3], hasher);
    const insertInput: TimelinePatchInput = {
      operationId: 'op-insert',
      timelineId: 'agent_blackout',
      patch: {
        kind: 'insertCue',
        expectedFingerprint: trackFingerprint,
        trackRef: trackRefFor('agent_blackout', 3),
        cue: { atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 0 },
      },
    };
    await applyTimelinePatch(change, insertInput, hasher);
    expect(change.record.workingRevision).toBe(3);

    const after = JSON.parse(change.record.workingFiles['content/timelines/agent_blackout.json']!) as TimelineDefinition;
    const cueFingerprint = await timelineFingerprint(after.tracks[3]!.cues[0], hasher);
    const removeInput: TimelinePatchInput = {
      operationId: 'op-remove-cue',
      timelineId: 'agent_blackout',
      patch: {
        kind: 'removeCue',
        expectedFingerprint: cueFingerprint,
        cueRef: cueRefFor('agent_blackout', 3, 0),
      },
    };
    await applyTimelinePatch(change, removeInput, hasher);
    expect(change.record.workingRevision).toBe(4);
    expect((JSON.parse(change.record.workingFiles['content/timelines/agent_blackout.json']!) as TimelineDefinition).tracks[3]!.cues).toHaveLength(0);
  });

  it('sets total duration with a full timeline fingerprint and lets Core reject cue overflow', async () => {
    const { change } = await created();
    const source = JSON.parse(change.record.workingFiles['content/timelines/agent_blackout.json']!) as TimelineDefinition;
    const before = await timelineFingerprint(source, hasher);
    const result = await applyTimelinePatch(change, {
      operationId: 'op-duration',
      timelineId: 'agent_blackout',
      patch: { kind: 'setDuration', expectedFingerprint: before, durationMs: 1_200 },
    }, hasher);
    const next = JSON.parse(change.record.workingFiles['content/timelines/agent_blackout.json']!) as TimelineDefinition;
    expect(next.durationMs).toBe(1_200);
    expect(result.diffEntry.kind).toBe('timeline.patch.setDuration');
    expect(result.diffEntry.fingerprintBefore).toBe(before);

    const unchanged = JSON.stringify(change.record.workingFiles);
    const currentFingerprint = await timelineFingerprint(next, hasher);
    await expect(applyTimelinePatch(change, {
      operationId: 'op-duration-too-short',
      timelineId: 'agent_blackout',
      patch: { kind: 'setDuration', expectedFingerprint: currentFingerprint, durationMs: 100 },
    }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(unchanged);
    expect(change.record.workingRevision).toBe(2);
  });

  it('updates and removes a non-audio track target while preserving opaque fields', async () => {
    const definition = JSON.parse(JSON.stringify(definitionWithPortrait())) as TimelineDefinition;
    const targetTrack = definition.tracks[0]! as unknown as Record<string, unknown>;
    targetTrack['opaqueTrackMetadata'] = { keep: true };
    const cue = targetTrack['cues'] as unknown as Array<Record<string, unknown>>;
    cue[0]!['opaqueCueMetadata'] = 'keep';
    const text = `${JSON.stringify(definition)}\n`;
    const { change } = await open([{
      path: 'content/timelines/agent_blackout.json',
      text,
      bytes: text.length,
      sha256: await hasher.sha256(text),
    }]);

    const source = JSON.parse(change.record.workingFiles['content/timelines/agent_blackout.json']!) as TimelineDefinition;
    const trackRef = trackRefFor('agent_blackout', 0);
    const trackFingerprint = await timelineFingerprint(source.tracks[0], hasher);
    const before = JSON.stringify(change.record.workingFiles);
    await expect(applyTimelinePatch(change, {
      operationId: 'op-target-stale',
      timelineId: 'agent_blackout',
      patch: { kind: 'setTrackTarget', expectedFingerprint: 'deadbeef', trackRef, target: 'lynn:stale' },
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
    expect(change.record.workingRevision).toBe(0);

    await applyTimelinePatch(change, {
      operationId: 'op-target-set',
      timelineId: 'agent_blackout',
      patch: { kind: 'setTrackTarget', expectedFingerprint: trackFingerprint, trackRef, target: 'lynn:casual' },
    }, hasher);
    const updated = JSON.parse(change.record.workingFiles['content/timelines/agent_blackout.json']!) as TimelineDefinition;
    const updatedTrack = updated.tracks[0] as unknown as Record<string, unknown>;
    expect(updatedTrack['target']).toBe('lynn:casual');
    expect(updatedTrack['opaqueTrackMetadata']).toEqual({ keep: true });
    expect((updatedTrack['cues'] as Array<Record<string, unknown>>)[0]!['opaqueCueMetadata']).toBe('keep');

    const updatedFingerprint = await timelineFingerprint(updated.tracks[0], hasher);
    await applyTimelinePatch(change, {
      operationId: 'op-target-remove',
      timelineId: 'agent_blackout',
      patch: { kind: 'setTrackTarget', expectedFingerprint: updatedFingerprint, trackRef, target: null },
    }, hasher);
    const removed = JSON.parse(change.record.workingFiles['content/timelines/agent_blackout.json']!) as TimelineDefinition;
    expect(Object.prototype.hasOwnProperty.call(removed.tracks[0], 'target')).toBe(false);
  });

  it('retains existing audio tracks across non-audio patches and rejects every audio mutation path', async () => {
    const { change } = await openedWithAudio();
    const path = 'content/timelines/agent_audio.json';
    const source = JSON.parse(change.record.workingFiles[path]!) as TimelineDefinition;
    const audioIndex = source.tracks.findIndex((track) => track.kind === ('audio' as never));
    expect(audioIndex).toBeGreaterThanOrEqual(0);
    const audioTrack = source.tracks[audioIndex]!;
    const audioTrackRef = trackRefFor('agent_audio', audioIndex);
    const audioCueRef = cueRefFor('agent_audio', audioIndex, 0);
    const audioTrackFingerprint = await timelineFingerprint(audioTrack, hasher);
    const audioCueFingerprint = await timelineFingerprint(audioTrack.cues[0], hasher);
    const updated = await applyTimelinePatch(change, {
      operationId: 'op-audio-duration',
      timelineId: 'agent_audio',
      patch: { kind: 'setDuration', expectedFingerprint: await timelineFingerprint(source, hasher), durationMs: 900 },
    }, hasher);
    expect(updated.fingerprint).not.toBe(await timelineFingerprint(source, hasher));
    const afterDuration = JSON.parse(change.record.workingFiles[path]!) as TimelineDefinition;
    expect(afterDuration.tracks[audioIndex]).toEqual(audioTrack);
    const preservedText = change.record.workingFiles[path]!;

    const attempts: TimelinePatchInput[] = [
      { operationId: 'op-audio-add', timelineId: 'agent_audio', patch: { kind: 'addTrack', expectedFingerprint: updated.fingerprint, trackKind: 'audio' as never } },
      { operationId: 'op-audio-remove-track', timelineId: 'agent_audio', patch: { kind: 'removeTrack', expectedFingerprint: audioTrackFingerprint, trackRef: audioTrackRef } },
      { operationId: 'op-audio-set-target', timelineId: 'agent_audio', patch: { kind: 'setTrackTarget', expectedFingerprint: audioTrackFingerprint, trackRef: audioTrackRef, target: 'forbidden' } },
      { operationId: 'op-audio-insert', timelineId: 'agent_audio', patch: { kind: 'insertCue', expectedFingerprint: audioTrackFingerprint, trackRef: audioTrackRef, cue: { atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'forbidden' } } },
      { operationId: 'op-audio-replace', timelineId: 'agent_audio', patch: { kind: 'replaceCue', expectedFingerprint: audioCueFingerprint, cueRef: audioCueRef, cue: { atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'forbidden' } } },
      { operationId: 'op-audio-remove-cue', timelineId: 'agent_audio', patch: { kind: 'removeCue', expectedFingerprint: audioCueFingerprint, cueRef: audioCueRef } },
    ];
    for (const attempt of attempts) {
      await expect(applyTimelinePatch(change, attempt, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
      expect(change.record.workingFiles[path]).toBe(preservedText);
    }
    const final = JSON.parse(change.record.workingFiles[path]!) as TimelineDefinition;
    expect(final.tracks[audioIndex]).toEqual(audioTrack);
    expect(change.record.workingRevision).toBe(1);
  });

  it('rejects a stale fingerprint without any partial write', async () => {
    const { change } = await created();
    const before = JSON.stringify(change.record.workingFiles);
    await expect(applyTimelinePatch(change, {
      operationId: 'op-stale',
      timelineId: 'agent_blackout',
      patch: { kind: 'addTrack', expectedFingerprint: 'deadbeef', trackKind: 'screen' },
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
    expect(change.record.workingRevision).toBe(1);
  });

  it('rejects missing refs with OBJECT_NOT_FOUND', async () => {
    const { change } = await created();
    const error = await applyTimelinePatch(change, {
      operationId: 'op-missing',
      timelineId: 'agent_blackout',
      patch: {
        kind: 'removeTrack',
        expectedFingerprint: 'whatever',
        trackRef: trackRefFor('agent_blackout', 9),
      },
    }, hasher).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: 'OBJECT_NOT_FOUND',
      details: {
        requestedRef: 'timeline:agent_blackout/track:9',
        availableTrackRefs: [
          'timeline:agent_blackout/track:0',
          'timeline:agent_blackout/track:1',
          'timeline:agent_blackout/track:2',
        ],
      },
    });
  });

  it('rejects whitelist violations inside patch cues', async () => {
    const { change } = await created();
    const current = JSON.parse(change.record.workingFiles['content/timelines/agent_blackout.json']!) as TimelineDefinition;
    const trackFingerprint = await timelineFingerprint(current.tracks[0], hasher);
    const tintCue = { atMs: 0, durationMs: 0, easing: 'linear', action: 'tint', color: 0, alpha: 1 } as unknown as TimelineCueInput;
    await expect(applyTimelinePatch(change, {
      operationId: 'op-bad-cue',
      timelineId: 'agent_blackout',
      patch: {
        kind: 'insertCue',
        expectedFingerprint: trackFingerprint,
        trackRef: trackRefFor('agent_blackout', 0),
        cue: tintCue,
      },
    }, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
  });

  it('keeps the transaction all-or-nothing when the patched definition fails core validation', async () => {
    const { change } = await created();
    const current = JSON.parse(change.record.workingFiles['content/timelines/agent_blackout.json']!) as TimelineDefinition;
    const trackFingerprint = await timelineFingerprint(current.tracks[0], hasher);
    const before = JSON.stringify(change.record.workingFiles);
    await expect(applyTimelinePatch(change, {
      operationId: 'op-invalid',
      timelineId: 'agent_blackout',
      patch: {
        kind: 'insertCue',
        expectedFingerprint: trackFingerprint,
        trackRef: trackRefFor('agent_blackout', 0),
        cue: { atMs: 0, durationMs: 100, easing: 'linear', action: 'set', key: '' },
      },
    }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(JSON.stringify(change.record.workingFiles)).toBe(before);
    expect(change.record.workingRevision).toBe(1);
  });

  it('keeps fingerprints canonical across key order', async () => {
    const left = await timelineFingerprint({ b: 1, a: 2, list: [{ y: 1, x: 2 }] }, hasher);
    const right = await timelineFingerprint({ a: 2, list: [{ x: 2, y: 1 }], b: 1 }, hasher);
    expect(left).toBe(right);
    expect(canonicalTimelineJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('updates workingRevision after each successful patch and exposes the new timeline fingerprint', async () => {
    const { change } = await created();
    const first = change.record.operations['op-create']?.result as { fingerprint: string };
    const second = await applyTimelinePatch(change, {
      operationId: 'op-one',
      timelineId: 'agent_blackout',
      patch: { kind: 'addTrack', expectedFingerprint: first.fingerprint, trackKind: 'background' },
    }, hasher);
    const third = await applyTimelinePatch(change, {
      operationId: 'op-two',
      timelineId: 'agent_blackout',
      patch: { kind: 'removeTrack', expectedFingerprint: await timelineFingerprint({ kind: 'background', cues: [] }, hasher), trackRef: trackRefFor('agent_blackout', 3) },
    }, hasher);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(third.fingerprint).not.toBe(second.fingerprint);
    expect(change.record.workingRevision).toBe(3);
    expect(third.diffEntry.fingerprintBefore).toBe(second.fingerprint);
    expect(third.diffEntry.fingerprintAfter).toBe(third.fingerprint);
  });

  it('rolls back cleanly and commit writes only allowed paths', async () => {
    const { change, repo } = await created();
    await rollbackChange(change);
    expect(change.record.status).toBe('ROLLED_BACK');
    expect(change.record.workingFiles).toEqual({});
    expect(repo.records.get(change.record.changeId)?.workingFiles).toEqual({});
  });
});

describe('timeline.patch refs', () => {
  it('renders stable track and cue refs', () => {
    expect(trackRefFor('agent_blackout', 0)).toBe('timeline:agent_blackout/track:0');
    expect(cueRefFor('agent_blackout', 0, 2)).toBe('timeline:agent_blackout/track:0/cue:2');
  });
});
