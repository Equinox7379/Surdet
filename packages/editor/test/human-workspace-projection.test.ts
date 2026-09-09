import { describe, expect, it } from 'vitest';
import { projectHumanWorkspace, type EditorWorkspaceFacts } from '../src/human-workspace-projection.js';

function facts(patch: Partial<EditorWorkspaceFacts> = {}): EditorWorkspaceFacts {
  return {
    relayBound: true,
    sceneDirty: false,
    timelineDirty: false,
    configDirty: false,
    reviewDirty: false,
    saving: false,
    projectTransition: false,
    assetImportWriting: false,
    assetRelocationWriting: false,
    sceneLifecycleWriting: false,
    autosaveRecoveryBlocked: false,
    externalUpdateConflict: false,
    ...patch,
  };
}

describe('Editor human workspace projection', () => {
  it('reports clean without inventing a long-lived project lock', () => {
    expect(projectHumanWorkspace(facts())).toEqual({
      protection: 'connected',
      availability: 'clean',
      dirtyScopes: [],
      busyReasons: [],
      blockedReasons: [],
    });
  });

  it('includes config drafts in the same dirty projection', () => {
    expect(projectHumanWorkspace(facts({ configDirty: true }))).toMatchObject({
      availability: 'dirty',
      dirtyScopes: ['config'],
    });
  });

  it('uses blocked > busy > dirty', () => {
    expect(projectHumanWorkspace(facts({
      sceneDirty: true,
      saving: true,
      externalUpdateConflict: true,
    }))).toMatchObject({
      availability: 'blocked',
      dirtyScopes: ['scene'],
      busyReasons: ['saving'],
      blockedReasons: ['external-update-conflict'],
    });
  });

  it('keeps pure browser mode honest', () => {
    expect(projectHumanWorkspace(facts({ relayBound: false }))).toMatchObject({
      protection: 'unavailable',
      availability: 'clean',
    });
  });
});
