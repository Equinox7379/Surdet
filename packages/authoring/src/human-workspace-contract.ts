/**
 * Stage 6 Wave 7: protocol-neutral human workspace coordination contract.
 *
 * This module intentionally contains no Node, browser, HTTP, MCP, DOM, or model
 * dependencies. It describes the minimum facts that a bound human Editor may
 * publish and that Agent Port may expose through session.describe.
 */

import type { JsonSchema } from './capability-contract.js';

export const HUMAN_WORKSPACE_CONTRACT_VERSION = 1 as const;

export const HUMAN_WORKSPACE_DIRTY_SCOPES = [
  'scene',
  'timeline',
  'config',
  'review',
] as const;
export type HumanWorkspaceDirtyScope = (typeof HUMAN_WORKSPACE_DIRTY_SCOPES)[number];

export const HUMAN_WORKSPACE_BUSY_REASONS = [
  'saving',
  'project-transition',
  'asset-import',
  'asset-relocation',
  'scene-lifecycle',
] as const;
export type HumanWorkspaceBusyReason = (typeof HUMAN_WORKSPACE_BUSY_REASONS)[number];

export const HUMAN_WORKSPACE_BLOCKED_REASONS = [
  'autosave-recovery',
  'external-update-conflict',
  'workspace-state-corrupt',
  'connection-grace',
  'write-settlement-failed',
] as const;
export type HumanWorkspaceBlockedReason = (typeof HUMAN_WORKSPACE_BLOCKED_REASONS)[number];

export type HumanWorkspaceReportedAvailability =
  | 'clean'
  | 'dirty'
  | 'busy'
  | 'blocked';

export type HumanWorkspaceConnectionState = 'active' | 'grace';

export interface HumanWorkspaceObservation {
  workspaceSessionId: string;
  availability: HumanWorkspaceReportedAvailability;
  connection: HumanWorkspaceConnectionState;
  /**
   * Current @surdet/authoring project revision loaded by the Editor.
   * It is never derived from the browser's re-serialization of project files.
   */
  loadedProjectRevision?: string;
  /**
   * Revision of the broader Editor-editable text baseline. This includes
   * content/config/*.json as well as Authoring snapshot files.
   */
  loadedCoordinationRevision?: string;
  dirtyScopes: HumanWorkspaceDirtyScope[];
  busyReasons: HumanWorkspaceBusyReason[];
  blockedReasons: HumanWorkspaceBlockedReason[];
  retryAfterMs?: number;
}

export interface HumanWorkspaceSummary {
  availability: 'absent' | HumanWorkspaceReportedAvailability;
  activeSessions: number;
  graceSessions: number;
  loadedProjectRevision?: string;
  loadedProjectRevisionConflict: boolean;
  loadedCoordinationRevision?: string;
  loadedCoordinationRevisionConflict: boolean;
  dirtyScopes: HumanWorkspaceDirtyScope[];
  busyReasons: HumanWorkspaceBusyReason[];
  blockedReasons: HumanWorkspaceBlockedReason[];
  retryAfterMs?: number;
}

export type HumanWorkspaceCommitBlock =
  | {
      code: 'HUMAN_WORKSPACE_DIRTY';
      summary: HumanWorkspaceSummary;
    }
  | {
      code: 'HUMAN_WORKSPACE_BUSY';
      summary: HumanWorkspaceSummary;
    }
  | {
      code: 'HUMAN_WORKSPACE_STATE_CORRUPT';
      summary: HumanWorkspaceSummary;
    };

export type ProjectMutationInitiator =
  | 'external-agent'
  | 'human-editor'
  | 'asset-authority'
  | 'scene-authority';

export interface ProjectMutationNotice {
  schemaVersion: 1;
  sequence: number;
  projectIdentity: string;
  /** Canonical @surdet/authoring project revision after the mutation. */
  projectRevision: string;
  /** Broader Editor-editable text revision after the mutation. */
  coordinationRevision: string;
  initiator: ProjectMutationInitiator;
  changedPaths: string[];
  occurredAt: string;
  operationId?: string;
  changeId?: string;
}

export const HUMAN_WORKSPACE_SUMMARY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['availability', 'activeSessions', 'graceSessions', 'loadedProjectRevisionConflict',
    'loadedCoordinationRevisionConflict', 'dirtyScopes', 'busyReasons', 'blockedReasons'],
  properties: {
    availability: { enum: ['absent', 'clean', 'dirty', 'busy', 'blocked'] },
    activeSessions: { type: 'integer', minimum: 0 },
    graceSessions: { type: 'integer', minimum: 0 },
    loadedProjectRevision: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    loadedCoordinationRevision: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    loadedProjectRevisionConflict: { type: 'boolean' },
    loadedCoordinationRevisionConflict: { type: 'boolean' },
    dirtyScopes: { type: 'array', items: { enum: HUMAN_WORKSPACE_DIRTY_SCOPES }, uniqueItems: true },
    busyReasons: { type: 'array', items: { enum: HUMAN_WORKSPACE_BUSY_REASONS }, uniqueItems: true },
    blockedReasons: { type: 'array', items: { enum: HUMAN_WORKSPACE_BLOCKED_REASONS }, uniqueItems: true },
    retryAfterMs: { type: 'integer', minimum: 0 },
  },
};

export const PROJECT_MUTATION_NOTICE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'sequence', 'projectIdentity', 'projectRevision', 'coordinationRevision',
    'initiator', 'changedPaths', 'occurredAt'],
  properties: {
    schemaVersion: { const: 1 },
    sequence: { type: 'integer', minimum: 1 },
    projectIdentity: { type: 'string' },
    projectRevision: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    coordinationRevision: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    initiator: { enum: ['external-agent', 'human-editor', 'asset-authority', 'scene-authority'] },
    changedPaths: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    occurredAt: { type: 'string' },
    operationId: { type: 'string' },
    changeId: { type: 'string' },
  },
};

const AVAILABILITY_PRIORITY: Readonly<Record<HumanWorkspaceSummary['availability'], number>> = {
  absent: 0,
  clean: 1,
  dirty: 2,
  busy: 3,
  blocked: 4,
};

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function effectiveAvailability(
  observation: HumanWorkspaceObservation,
): Exclude<HumanWorkspaceSummary['availability'], 'absent'> {
  return observation.connection === 'grace' ? 'blocked' : observation.availability;
}

function retryAfterFor(
  observations: readonly HumanWorkspaceObservation[],
  availability: HumanWorkspaceSummary['availability'],
): number | undefined {
  if (availability === 'absent' || availability === 'clean') return undefined;
  const relevant = observations.filter((observation) => (
    effectiveAvailability(observation) === availability
  ));
  if (relevant.length === 0 || relevant.some((observation) => observation.retryAfterMs === undefined)) {
    return undefined;
  }
  return Math.max(...relevant.map((observation) => observation.retryAfterMs!));
}

function oneRevision(
  observations: readonly HumanWorkspaceObservation[],
  key: 'loadedProjectRevision' | 'loadedCoordinationRevision',
): { value?: string; conflict: boolean } {
  const revisions = sortedUnique(observations
    .map((observation) => observation[key])
    .filter((value): value is string => value !== undefined));
  return {
    ...(revisions.length === 1 ? { value: revisions[0] } : {}),
    conflict: revisions.length > 1,
  };
}

export function aggregateHumanWorkspaceObservations(
  observations: readonly HumanWorkspaceObservation[],
): HumanWorkspaceSummary {
  if (observations.length === 0) {
    return {
      availability: 'absent',
      activeSessions: 0,
      graceSessions: 0,
      loadedProjectRevisionConflict: false,
      loadedCoordinationRevisionConflict: false,
      dirtyScopes: [],
      busyReasons: [],
      blockedReasons: [],
    };
  }

  let availability: HumanWorkspaceSummary['availability'] = 'clean';
  for (const observation of observations) {
    const candidate = effectiveAvailability(observation);
    if (AVAILABILITY_PRIORITY[candidate] > AVAILABILITY_PRIORITY[availability]) {
      availability = candidate;
    }
  }

  const projectRevision = oneRevision(observations, 'loadedProjectRevision');
  const coordinationRevision = oneRevision(observations, 'loadedCoordinationRevision');
  const blockedReasons = sortedUnique([
    ...observations.flatMap((observation) => observation.blockedReasons),
    ...observations
      .filter((observation) => observation.connection === 'grace')
      .map(() => 'connection-grace' as const),
  ]);

  const summary: HumanWorkspaceSummary = {
    availability,
    activeSessions: observations.filter((observation) => observation.connection === 'active').length,
    graceSessions: observations.filter((observation) => observation.connection === 'grace').length,
    loadedProjectRevisionConflict: projectRevision.conflict,
    loadedCoordinationRevisionConflict: coordinationRevision.conflict,
    dirtyScopes: sortedUnique(observations.flatMap((observation) => observation.dirtyScopes)),
    busyReasons: sortedUnique(observations.flatMap((observation) => observation.busyReasons)),
    blockedReasons,
  };
  if (projectRevision.value !== undefined) summary.loadedProjectRevision = projectRevision.value;
  if (coordinationRevision.value !== undefined) {
    summary.loadedCoordinationRevision = coordinationRevision.value;
  }
  const retryAfterMs = retryAfterFor(observations, availability);
  if (retryAfterMs !== undefined) summary.retryAfterMs = retryAfterMs;
  return summary;
}

export function humanWorkspaceCommitBlock(
  summary: HumanWorkspaceSummary,
): HumanWorkspaceCommitBlock | null {
  if (summary.availability === 'absent' || summary.availability === 'clean') return null;
  if (summary.availability === 'dirty') {
    return { code: 'HUMAN_WORKSPACE_DIRTY', summary };
  }
  // A bounded disconnect grace period still blocks every write, but is not a corrupt record.
  const waitingForConnection = summary.availability === 'blocked' && summary.graceSessions > 0
    && summary.retryAfterMs !== undefined && summary.blockedReasons.length === 1
    && summary.blockedReasons[0] === 'connection-grace';
  if (summary.availability === 'busy' || waitingForConnection) {
    return { code: 'HUMAN_WORKSPACE_BUSY', summary };
  }
  return { code: 'HUMAN_WORKSPACE_STATE_CORRUPT', summary };
}
