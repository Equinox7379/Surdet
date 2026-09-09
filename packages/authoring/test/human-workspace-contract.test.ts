import { describe, expect, it } from 'vitest';
import {
  aggregateHumanWorkspaceObservations,
  humanWorkspaceCommitBlock,
  type HumanWorkspaceObservation,
} from '../src/human-workspace-contract.js';

function observation(
  patch: Partial<HumanWorkspaceObservation> = {},
): HumanWorkspaceObservation {
  return {
    workspaceSessionId: '11111111-1111-4111-8111-111111111111',
    availability: 'clean',
    connection: 'active',
    loadedProjectRevision: 'a'.repeat(64),
    loadedCoordinationRevision: 'c'.repeat(64),
    dirtyScopes: [],
    busyReasons: [],
    blockedReasons: [],
    ...patch,
  };
}

describe('human workspace contract', () => {
  it('reports absent when no bound Editor is active', () => {
    expect(aggregateHumanWorkspaceObservations([])).toEqual({
      availability: 'absent',
      activeSessions: 0,
      graceSessions: 0,
      loadedProjectRevisionConflict: false,
      loadedCoordinationRevisionConflict: false,
      dirtyScopes: [],
      busyReasons: [],
      blockedReasons: [],
    });
  });

  it('lets multiple clean Editors coexist', () => {
    const result = aggregateHumanWorkspaceObservations([
      observation(),
      observation({ workspaceSessionId: '22222222-2222-4222-8222-222222222222' }),
    ]);
    expect(result.availability).toBe('clean');
    expect(result.activeSessions).toBe(2);
    expect(result.loadedProjectRevision).toBe('a'.repeat(64));
    expect(result.loadedCoordinationRevision).toBe('c'.repeat(64));
    expect(humanWorkspaceCommitBlock(result)).toBeNull();
  });

  it('does not let one clean Editor hide another dirty Editor', () => {
    const result = aggregateHumanWorkspaceObservations([
      observation(),
      observation({
        workspaceSessionId: '22222222-2222-4222-8222-222222222222',
        availability: 'dirty',
        dirtyScopes: ['scene', 'config'],
      }),
    ]);
    expect(result.availability).toBe('dirty');
    expect(result.dirtyScopes).toEqual(['config', 'scene']);
    expect(humanWorkspaceCommitBlock(result)?.code).toBe('HUMAN_WORKSPACE_DIRTY');
  });

  it('treats a grace connection as blocked even when its last report was clean', () => {
    const result = aggregateHumanWorkspaceObservations([
      observation({ connection: 'grace', retryAfterMs: 6_000 }),
    ]);
    expect(result.availability).toBe('blocked');
    expect(result.blockedReasons).toContain('connection-grace');
    expect(result.retryAfterMs).toBe(6_000);
    expect(humanWorkspaceCommitBlock(result)?.code).toBe('HUMAN_WORKSPACE_STATE_CORRUPT');
  });

  it('uses blocked > busy > dirty > clean aggregation', () => {
    const result = aggregateHumanWorkspaceObservations([
      observation({ availability: 'dirty', dirtyScopes: ['timeline'] }),
      observation({
        workspaceSessionId: '22222222-2222-4222-8222-222222222222',
        availability: 'busy',
        busyReasons: ['saving'],
      }),
      observation({
        workspaceSessionId: '33333333-3333-4333-8333-333333333333',
        availability: 'blocked',
        blockedReasons: ['autosave-recovery'],
      }),
    ]);
    expect(result.availability).toBe('blocked');
    expect(result.blockedReasons).toEqual(['autosave-recovery']);
  });

  it('does not pretend divergent loaded revisions are one disk baseline', () => {
    const result = aggregateHumanWorkspaceObservations([
      observation({ loadedProjectRevision: 'a'.repeat(64) }),
      observation({
        workspaceSessionId: '22222222-2222-4222-8222-222222222222',
        loadedProjectRevision: 'b'.repeat(64),
      }),
    ]);
    expect(result.loadedProjectRevision).toBeUndefined();
    expect(result.loadedProjectRevisionConflict).toBe(true);
    expect(result.loadedCoordinationRevisionConflict).toBe(false);
  });
});
