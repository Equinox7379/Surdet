import { describe, expect, it } from 'vitest';
import {
  beginChange,
  buildOperationLedgerDiff,
  createChangeDiff,
  rollbackChange,
  type ChangeSession,
  type TextHasher,
} from '../src/index.js';
import { InMemoryChangeRepository } from '../src/change-session.js';
import { applyTimelineCreate, applyTimelinePatch, type TimelineCreateInput } from '../src/timeline-operations.js';
import type { ProjectSnapshot } from '../src/project-snapshot.js';
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

const definition: TimelineDefinition = {
  version: 1,
  id: 'agent_blackout',
  durationMs: 800,
  tracks: [
    { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] },
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

async function session(): Promise<{ change: ChangeSession; repo: InMemoryChangeRepository }> {
  const repo = new InMemoryChangeRepository();
  const change = await beginChange(snapshot(), repo);
  await applyTimelineCreate(change, { operationId: 'op-create', timelineId: 'agent_blackout', definition } satisfies TimelineCreateInput, hasher);
  const first = change.record.operations['op-create']!.result as { fingerprint: string };
  await applyTimelinePatch(change, {
    operationId: 'op-patch',
    timelineId: 'agent_blackout',
    patch: { kind: 'addTrack', expectedFingerprint: first.fingerprint, trackKind: 'screen' },
  }, hasher);
  return { change, repo };
}

describe('operation-ledger diff', () => {
  it('derives object-level semantic diffs from the executed operation ledger', async () => {
    const { change } = await session();
    const ledger = buildOperationLedgerDiff(change.record);
    expect(ledger).toHaveLength(2);
    const create = ledger[0]!;
    expect(create.kind).toBe('timeline.create');
    expect(create.objectAfter).toBe('timeline:agent_blackout');
    expect(create.operationId).toBe('op-create');
    expect(create.fingerprintAfter).toMatch(/^[0-9a-f]{8}$/);
    expect(create.directChange).toBeDefined();
    const patch = ledger[1]!;
    expect(patch.kind).toBe('timeline.patch.addTrack');
    expect(patch.fingerprintBefore).toBeDefined();
    expect(patch.fingerprintAfter).toBeDefined();
    expect(patch.fingerprintBefore).not.toBe(patch.fingerprintAfter);
  });

  it('aligns the timeline file by its stable semantic id without array-position guessing', async () => {
    const { change } = await session();
    const after = change.record.workingFiles['content/timelines/agent_blackout.json']!;
    const fileDiff = createChangeDiff({
      operationId: 'file-diff',
      before: { path: 'content/timelines/agent_blackout.json', text: '' },
      after: { path: 'content/timelines/agent_blackout.json', text: after },
      directChange: { path: 'content/timelines/agent_blackout.json' },
      potentialImpact: [],
      observedImpact: [],
      kind: 'timeline',
      objectAfter: 'timeline:agent_blackout',
    });
    expect(fileDiff.files[0]!.path).toBe('content/timelines/agent_blackout.json');
    expect(fileDiff.semantic[0]!.objectAfter).toBe('timeline:agent_blackout');
  });

  it('keeps executed operation records for audit after rollback while clearing workingFiles', async () => {
    const repo = new InMemoryChangeRepository();
    const change = await beginChange(snapshot(), repo);
    await applyTimelineCreate(change, { operationId: 'op-create', timelineId: 'agent_blackout', definition } satisfies TimelineCreateInput, hasher);
    await rollbackChange(change);
    expect(buildOperationLedgerDiff(change.record).filter((entry) => entry.kind.startsWith('timeline.'))).toHaveLength(1);
    expect(change.record.workingFiles).toEqual({});
  });
});
