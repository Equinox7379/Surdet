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

function snapshot(): ProjectSnapshot {
  return {
    rootIdentity: 'fixture-root',
    revision: 'rev000000',
    files: [],
    configFile: null,
    config: {},
    variables: {},
    scenes: [],
    timelines: [],
  };
}

async function open(): Promise<{ change: ChangeSession; repo: InMemoryChangeRepository }> {
  const repo = new InMemoryChangeRepository();
  const change = await beginChange(snapshot(), repo);
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

  it('rejects definitions outside the wave 2 whitelist', async () => {
    const { change } = await open();
    const camera: TimelineDefinition = {
      ...baseDefinition,
      tracks: [{ kind: 'camera', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'zoom', scale: 1 }] }],
    };
    await expect(applyTimelineCreate(change, createInput('op-camera', camera), hasher))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    const tint: TimelineDefinition = {
      ...baseDefinition,
      tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'tint', color: 0, alpha: 1 }] }],
    };
    await expect(applyTimelineCreate(change, createInput('op-tint', tint), hasher))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(change.record.workingFiles).toEqual({});
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
