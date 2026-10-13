import { describe, expect, it } from 'vitest';
import { aggregateHumanWorkspaceObservations } from '@surdet/authoring';
import { assertHumanWorkspaceAllowsAgentCommit } from '../src/authoring/human-workspace-gate.js';

describe('Agent commit human workspace gate', () => {
  it('keeps disconnected workspaces write-blocking without prescribing manual recovery', async () => {
    const summary = aggregateHumanWorkspaceObservations([{
      workspaceSessionId: 'disconnected-editor',
      connection: 'grace', availability: 'clean', retryAfterMs: 10_000,
      dirtyScopes: [], busyReasons: [], blockedReasons: [],
    }]);
    const failure = await assertHumanWorkspaceAllowsAgentCommit({
      inspect: async () => ({ observations: [], summary }),
    } as never, '/project').catch(error => error);
    expect(failure).toMatchObject({ code: 'HUMAN_WORKSPACE_BUSY', details: {
      retryAfterMs: 10_000, projectMutationOccurred: false, changeStatusAdvanced: false,
    } });
    expect(failure.details).not.toHaveProperty('manualRecoveryRequired');
  });

  it('allows absent and clean workspaces', async () => {
    await expect(assertHumanWorkspaceAllowsAgentCommit({
      inspect: async () => ({
        observations: [],
        summary: {
          availability: 'absent',
          activeSessions: 0,
          graceSessions: 0,
          loadedProjectRevisionConflict: false,
          dirtyScopes: [],
          busyReasons: [],
          blockedReasons: [],
        },
      }),
    } as never, '/project')).resolves.toMatchObject({ availability: 'absent' });
  });

  it.each([
    ['dirty', 'HUMAN_WORKSPACE_DIRTY'],
    ['busy', 'HUMAN_WORKSPACE_BUSY'],
    ['blocked', 'HUMAN_WORKSPACE_STATE_CORRUPT'],
  ] as const)('rejects %s before a project mutation can start', async (availability: 'dirty' | 'busy' | 'blocked', code: 'HUMAN_WORKSPACE_DIRTY' | 'HUMAN_WORKSPACE_BUSY' | 'HUMAN_WORKSPACE_STATE_CORRUPT') => {
    await expect(assertHumanWorkspaceAllowsAgentCommit({
      inspect: async () => ({
        observations: [],
        summary: {
          availability,
          activeSessions: 1,
          graceSessions: 0,
          loadedProjectRevisionConflict: false,
          dirtyScopes: availability === 'dirty' ? ['scene'] : [],
          busyReasons: availability === 'busy' ? ['saving'] : [],
          blockedReasons: availability === 'blocked' ? ['autosave-recovery'] : [],
        },
      }),
    } as never, '/project')).rejects.toMatchObject({
      code,
      details: {
        projectMutationOccurred: false,
        changeStatusAdvanced: false,
      },
    });
  });
});
