import type {
  HumanWorkspaceBlockedReason,
  HumanWorkspaceBusyReason,
  HumanWorkspaceDirtyScope,
  HumanWorkspaceReportedAvailability,
} from '@surdet/authoring';

export interface EditorWorkspaceFacts {
  relayBound: boolean;
  sceneDirty: boolean;
  timelineDirty: boolean;
  configDirty: boolean;
  reviewDirty: boolean;
  saving: boolean;
  projectTransition: boolean;
  assetImportWriting: boolean;
  assetRelocationWriting: boolean;
  sceneLifecycleWriting: boolean;
  autosaveRecoveryBlocked: boolean;
  externalUpdateConflict: boolean;
}

export interface EditorWorkspaceProjection {
  protection: 'unavailable' | 'connected';
  availability: HumanWorkspaceReportedAvailability;
  dirtyScopes: HumanWorkspaceDirtyScope[];
  busyReasons: HumanWorkspaceBusyReason[];
  blockedReasons: HumanWorkspaceBlockedReason[];
}

export function projectHumanWorkspace(facts: EditorWorkspaceFacts): EditorWorkspaceProjection {
  const dirtyScopes: HumanWorkspaceDirtyScope[] = [];
  if (facts.sceneDirty) dirtyScopes.push('scene');
  if (facts.timelineDirty) dirtyScopes.push('timeline');
  if (facts.configDirty) dirtyScopes.push('config');
  if (facts.reviewDirty) dirtyScopes.push('review');

  const busyReasons: HumanWorkspaceBusyReason[] = [];
  if (facts.saving) busyReasons.push('saving');
  if (facts.projectTransition) busyReasons.push('project-transition');
  if (facts.assetImportWriting) busyReasons.push('asset-import');
  if (facts.assetRelocationWriting) busyReasons.push('asset-relocation');
  if (facts.sceneLifecycleWriting) busyReasons.push('scene-lifecycle');

  const blockedReasons: HumanWorkspaceBlockedReason[] = [];
  if (facts.autosaveRecoveryBlocked) blockedReasons.push('autosave-recovery');
  if (facts.externalUpdateConflict) blockedReasons.push('external-update-conflict');

  const availability: HumanWorkspaceReportedAvailability = blockedReasons.length > 0
    ? 'blocked'
    : busyReasons.length > 0
      ? 'busy'
      : dirtyScopes.length > 0
        ? 'dirty'
        : 'clean';

  return {
    protection: facts.relayBound ? 'connected' : 'unavailable',
    availability,
    dirtyScopes,
    busyReasons,
    blockedReasons,
  };
}
