import { validateTimeline, resolveTimelineDefinition, TIMELINE_TRANSITION_ACTIONS, type TimelineDefinition } from '@surdet/core';
import { parseProjectConfigDocument } from './config-document.js';
import {
  AuthoringOperationError,
  runOperation,
  stableStringify,
  type ChangeSession,
} from './change-session.js';
import type {
  LedgerDiffEntry,
  TimelineCreateInput,
  TimelineCueInput,
  TimelinePatchInput,
  TimelinePatchOperation,
  Wave2Action,
  Wave2TrackKind,
} from './contracts.js';
import { normalizeProjectPath } from './project-storage.js';
import type { TextHasher } from './project-storage.js';
import { buildTimelineOperationCompositionDraft } from './operation-composition-facts.js';
import { resolveUniqueTimelinePath, timelineIdFromPath, timelineIdentityConflict, timelineIdentityMismatchMessage } from './timeline-identity.js';

const WAVE2_TRACK_KINDS: ReadonlySet<string> = new Set(['background', 'portrait', 'camera', 'screen', 'particle', 'audio', 'layer']);
const WAVE2_ACTIONS: Record<string, ReadonlySet<string>> = {
  background: new Set(['set']),
  portrait: new Set(['show', 'hide', 'move', 'expression', 'pose']),
  layer: new Set(['show', 'hide', 'pose']),
  camera: new Set(['zoom', 'pan', 'shake']),
  screen: new Set(['fade', 'tint', 'flash', 'wipe', ...TIMELINE_TRANSITION_ACTIONS]),
  particle: new Set(['start', 'stop']),
  audio: new Set(['bgm', 'se', 'voice']),
};

export function timelinePathFor(timelineId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(timelineId)) {
    throw new AuthoringOperationError('VALIDATION_FAILED', `时间轴 ID 非法：${timelineId}`);
  }
  return normalizeProjectPath(`content/timelines/${timelineId}.json`);
}

export function trackRefFor(timelineId: string, trackIndex: number): string {
  return `timeline:${timelineId}/track:${trackIndex}`;
}

export function cueRefFor(timelineId: string, trackIndex: number, cueIndex: number): string {
  return `timeline:${timelineId}/track:${trackIndex}/cue:${cueIndex}`;
}

/** 指纹规范化：键序稳定、无无关空白；SHA-256 由调用方注入的 hasher 完成。 */
export function canonicalTimelineJson(value: unknown): string {
  return stableStringify(value);
}

export async function timelineFingerprint(value: unknown, hasher: TextHasher): Promise<string> {
  return hasher.sha256(canonicalTimelineJson(value));
}

/** Array-index selections are bound to their complete current container. */
export async function timelineSelectionFingerprint(definition: unknown, objectRef: string, hasher: TextHasher): Promise<string> {
  return timelineFingerprint({ definition, objectRef }, hasher);
}

export function parseTimelineDefinition(text: string): TimelineDefinition {
  const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AuthoringOperationError('PROJECT_INVALID', '时间轴文件不是 JSON 对象');
  }
  return parsed as TimelineDefinition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Check supported authoring tracks/actions before the shared Core shape validation. */
export function checkWave2Definition(definition: unknown): string | null {
  if (!isRecord(definition) || !Array.isArray(definition['tracks'])) {
    return 'timeline tracks 必须是数组';
  }
  const tracks = definition['tracks'] as unknown[];
  for (const rawTrack of tracks) {
    if (!isRecord(rawTrack) || typeof rawTrack['kind'] !== 'string' || !Array.isArray(rawTrack['cues'])) {
      return 'track 形状非法';
    }
    const kind = rawTrack['kind'];
    if (!WAVE2_TRACK_KINDS.has(kind)) {
      return `track kind 不在 Wave 2 白名单内：${kind}`;
    }
    const allowed = WAVE2_ACTIONS[kind]!;
    for (const rawCue of rawTrack['cues'] as unknown[]) {
      if (!isRecord(rawCue) || typeof rawCue['action'] !== 'string' || !allowed.has(rawCue['action'])) {
        return `cue action 不在 Wave 2 白名单内：${isRecord(rawCue) ? String(rawCue['action']) : String(rawCue)}`;
      }
    }
  }
  return null;
}

function cueAllowedOn(kind: string, cue: TimelineCueInput): boolean {
  const allowed = WAVE2_ACTIONS[kind];
  return allowed !== undefined && allowed.has(cue.action);
}

export interface TimelineCreateResult {
  timelineId: string;
  path: string;
  objectRef: string;
  fingerprint: string;
  diffEntry: LedgerDiffEntry;
}

export interface TimelinePatchResult {
  timelineId: string;
  objectRef: string;
  fingerprint: string;
  diffEntry: LedgerDiffEntry;
}

function parseTrackRef(ref: string, timelineId: string): number | null {
  const prefix = `timeline:${timelineId}/track:`;
  if (!ref.startsWith(prefix)) return null;
  const raw = ref.slice(prefix.length);
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function parseCueRef(ref: string, timelineId: string): { track: number; cue: number } | null {
  const prefix = `timeline:${timelineId}/track:`;
  if (!ref.startsWith(prefix)) return null;
  const rest = ref.slice(prefix.length);
  const match = /^(\d+)\/cue:(\d+)$/.exec(rest);
  if (match === null) return null;
  return { track: Number(match[1]), cue: Number(match[2]) };
}

export async function applyTimelineCreate(
  change: ChangeSession,
  input: TimelineCreateInput,
  hasher: TextHasher,
): Promise<TimelineCreateResult> {
  const path = timelinePathFor(input.timelineId);
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(input.timelineId)) {
    throw new AuthoringOperationError('INVALID_REQUEST', '时间轴 ID 不能使用 Windows 设备名');
  }
  return runOperation<TimelineCreateResult>(change, input, async (record) => {
    if (resolveUniqueTimelinePath(record.workingFiles, input.timelineId) !== undefined
      || Object.keys(record.workingFiles).some(file => file.startsWith('content/timelines/') && file.toLowerCase().endsWith('.json')
        && (file.toLowerCase() === path.toLowerCase() || timelineIdFromPath(file).toLowerCase() === input.timelineId.toLowerCase()))) {
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `时间轴已存在：${input.timelineId}`);
    }
    const definition = input.definition;
    if (!isRecord(definition) || definition['id'] !== input.timelineId) {
      throw new AuthoringOperationError(
        'VALIDATION_FAILED',
        `timelineId 必须与 definition.id 一致：timelineId=${input.timelineId}`,
      );
    }
    const whitelistViolation = checkWave2Definition(definition);
    if (whitelistViolation !== null) {
      throw new AuthoringOperationError('UNSUPPORTED_OPERATION', whitelistViolation);
    }
    const diagnostics = validateTimeline(definition);
    if (diagnostics.length > 0) {
      throw new AuthoringOperationError('VALIDATION_FAILED', '时间轴结构校验失败', {
        diagnostics: diagnostics.map((item) => ({ code: item.code, message: item.message, path: item.path })),
      });
    }
    validateWorkingTimelineReferences(definition as unknown as TimelineDefinition, record.workingFiles);
    const fingerprint = await timelineFingerprint(definition, hasher);
    const text = `${JSON.stringify(definition, null, 2)}\n`;
    return {
      compositionDraft: await buildTimelineOperationCompositionDraft({
        capabilityId: 'timeline.create', timelineId: input.timelineId, afterDefinition: definition, hasher,
        config: parseProjectConfigDocument(record.workingFiles['game.config.json'] ?? '{}'), workingFiles: record.workingFiles,
      }),
      result: {
        timelineId: input.timelineId,
        path,
        objectRef: `timeline:${input.timelineId}`,
        fingerprint,
        diffEntry: {
          kind: 'timeline.create',
          operationId: input.operationId,
          objectAfter: `timeline:${input.timelineId}`,
          fingerprintAfter: fingerprint,
          directChange: { path },
          potentialImpact: [],
          observedImpact: [],
        },
      },
      workingFiles: { ...record.workingFiles, [path]: text },
    };
  });
}

export async function applyTimelinePatch(
  change: ChangeSession,
  input: TimelinePatchInput,
  hasher: TextHasher,
): Promise<TimelinePatchResult> {
  const defaultPath = timelinePathFor(input.timelineId);
  return runOperation<TimelinePatchResult>(change, input, async (record) => {
    const path = resolveUniqueTimelinePath(record.workingFiles, input.timelineId) ?? defaultPath;
    const source = record.workingFiles[path];
    if (source === undefined) {
      throw new AuthoringOperationError('OBJECT_NOT_FOUND', `时间轴不存在：${input.timelineId}`);
    }
    const definition = parseTimelineDefinition(source);
    const identityConflict = timelineIdentityConflict(path, definition);
    if (identityConflict !== null) throw new AuthoringOperationError('PROJECT_INVALID', timelineIdentityMismatchMessage(identityConflict));
    const patch: TimelinePatchOperation = input.patch;
    const fingerprintBefore = await timelineFingerprint(definition, hasher);
    const next = JSON.parse(JSON.stringify(definition)) as TimelineDefinition;
    const tracks = next.tracks;
    const availableTrackRefs = (): string[] => tracks.map((_track, index) => trackRefFor(input.timelineId, index));
    const availableCueRefs = (): string[] => tracks.flatMap((track, trackIndex) => (
      track.cues.map((_cue, cueIndex) => cueRefFor(input.timelineId, trackIndex, cueIndex))
    ));
    let changedRef: string | null = null;
    // The external service requires container-bound selection fingerprints.
    // Sealed replay also accepts old local fingerprints after its own full
    // object preconditions, preserving already delivered candidates.
    const matchesSelection = async (ref: string, value: unknown): Promise<boolean> => (
      patch.expectedFingerprint === await timelineSelectionFingerprint(definition, ref, hasher)
      || patch.expectedFingerprint === await timelineFingerprint(value, hasher)
    );

    if (patch.kind === 'setClips' || patch.kind === 'setVersion') {
      if (patch.expectedFingerprint !== fingerprintBefore) throw new AuthoringOperationError('OBJECT_REF_STALE', `timeline fingerprint 不匹配：${input.timelineId}`);
      if (patch.kind === 'setVersion') next.version = patch.version;
      else {
        if (next.version !== 2) throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '片段引用需要先显式升级该时间轴到 version 2');
        next.clips = JSON.parse(JSON.stringify(patch.clips));
      }
    } else if (patch.kind === 'addTrack') {
      if (patch.expectedFingerprint !== fingerprintBefore) {
        throw new AuthoringOperationError('OBJECT_REF_STALE', `timeline fingerprint 不匹配：${input.timelineId}`);
      }
      if (!WAVE2_TRACK_KINDS.has(patch.trackKind)) {
        throw new AuthoringOperationError('UNSUPPORTED_OPERATION', `track kind 不在 Wave 2 白名单内：${patch.trackKind}`);
      }
      tracks.push({
        kind: patch.trackKind as Wave2TrackKind,
        ...(patch.target === undefined ? {} : { target: patch.target }),
        cues: [],
      });
      changedRef = trackRefFor(input.timelineId, tracks.length - 1);
    } else if (patch.kind === 'setDuration') {
      if (patch.expectedFingerprint !== fingerprintBefore) {
        throw new AuthoringOperationError('OBJECT_REF_STALE', `timeline fingerprint 不匹配：${input.timelineId}`);
      }
      next.durationMs = patch.durationMs;
    } else if (patch.kind === 'removeTrack') {
      const index = parseTrackRef(patch.trackRef, input.timelineId);
      if (index === null || tracks[index] === undefined) {
        throw new AuthoringOperationError('OBJECT_NOT_FOUND', `track 引用不存在：${patch.trackRef}`, {
          timelineId: input.timelineId,
          timelineRef: `timeline:${input.timelineId}`,
          requestedRef: patch.trackRef,
          availableTrackRefs: availableTrackRefs(),
        });
      }
      if (!await matchesSelection(patch.trackRef, tracks[index])) {
        throw new AuthoringOperationError('OBJECT_REF_STALE', `track fingerprint 不匹配：${patch.trackRef}`);
      }
      changedRef = patch.trackRef;
      tracks.splice(index, 1);
    } else if (patch.kind === 'setTrackTarget') {
      const index = parseTrackRef(patch.trackRef, input.timelineId);
      if (index === null || tracks[index] === undefined) {
        throw new AuthoringOperationError('OBJECT_NOT_FOUND', `track 引用不存在：${patch.trackRef}`, {
          timelineId: input.timelineId,
          timelineRef: `timeline:${input.timelineId}`,
          requestedRef: patch.trackRef,
          availableTrackRefs: availableTrackRefs(),
        });
      }
      if (!await matchesSelection(patch.trackRef, tracks[index])) {
        throw new AuthoringOperationError('OBJECT_REF_STALE', `track fingerprint 不匹配：${patch.trackRef}`);
      }
      if (patch.target === null) delete tracks[index]!.target;
      else tracks[index]!.target = patch.target;
      changedRef = patch.trackRef;
    } else if (patch.kind === 'insertCue') {
      const index = parseTrackRef(patch.trackRef, input.timelineId);
      if (index === null || tracks[index] === undefined) {
        throw new AuthoringOperationError('OBJECT_NOT_FOUND', `track 引用不存在：${patch.trackRef}`, {
          timelineId: input.timelineId,
          timelineRef: `timeline:${input.timelineId}`,
          requestedRef: patch.trackRef,
          availableTrackRefs: availableTrackRefs(),
        });
      }
      if (!await matchesSelection(patch.trackRef, tracks[index])) {
        throw new AuthoringOperationError('OBJECT_REF_STALE', `track fingerprint 不匹配：${patch.trackRef}`);
      }
      if (!cueAllowedOn(tracks[index]!.kind, patch.cue)) {
        throw new AuthoringOperationError('UNSUPPORTED_OPERATION', `cue action 不在该 track 白名单内：${patch.cue.action}`);
      }
      tracks[index]!.cues.push({ ...patch.cue } as typeof tracks[number]['cues'][number]);
      changedRef = cueRefFor(input.timelineId, index, tracks[index]!.cues.length - 1);
    } else {
      const parsed = parseCueRef(patch.kind === 'replaceCue' ? patch.cueRef : patch.cueRef, input.timelineId);
      const track = parsed === null ? undefined : tracks[parsed.track];
      const cue = track === undefined || parsed === null ? undefined : track.cues[parsed.cue];
      if (parsed === null || cue === undefined) {
        throw new AuthoringOperationError('OBJECT_NOT_FOUND', `cue 引用不存在：${patch.cueRef}`, {
          timelineId: input.timelineId,
          timelineRef: `timeline:${input.timelineId}`,
          requestedRef: patch.cueRef,
          availableCueRefs: availableCueRefs(),
        });
      }
      if (!await matchesSelection(patch.cueRef, cue)) {
        throw new AuthoringOperationError('OBJECT_REF_STALE', `cue fingerprint 不匹配：${patch.kind === 'replaceCue' ? patch.cueRef : patch.cueRef}`);
      }
      changedRef = patch.kind === 'replaceCue' ? patch.cueRef : patch.cueRef;
      if (patch.kind === 'replaceCue') {
        if (!cueAllowedOn(track!.kind, patch.cue)) {
          throw new AuthoringOperationError('UNSUPPORTED_OPERATION', `cue action 不在该 track 白名单内：${patch.cue.action}`);
        }
        track!.cues[parsed.cue] = { ...patch.cue } as typeof cue;
      } else {
        track!.cues.splice(parsed.cue, 1);
      }
    }

    const diagnostics = validateTimeline(next);
    if (diagnostics.length > 0) {
      throw new AuthoringOperationError('VALIDATION_FAILED', 'patch 后时间轴结构校验失败', {
        diagnostics: diagnostics.map((item) => ({ code: item.code, message: item.message, path: item.path })),
      });
    }
    const whitelistViolation = checkWave2Definition(next);
    if (whitelistViolation !== null) {
      throw new AuthoringOperationError('UNSUPPORTED_OPERATION', whitelistViolation);
    }
    validateWorkingTimelineReferences(next, record.workingFiles);
    const fingerprintAfter = await timelineFingerprint(next, hasher);
    return {
      compositionDraft: await buildTimelineOperationCompositionDraft({
        capabilityId: 'timeline.patch', timelineId: input.timelineId, path, beforeDefinition: definition, afterDefinition: next, hasher,
        config: parseProjectConfigDocument(record.workingFiles['game.config.json'] ?? '{}'), workingFiles: record.workingFiles,
      }),
      result: {
        timelineId: input.timelineId,
        objectRef: `timeline:${input.timelineId}`,
        fingerprint: fingerprintAfter,
        diffEntry: {
          kind: `timeline.patch.${patch.kind}`,
          operationId: input.operationId,
          objectBefore: `timeline:${input.timelineId}`,
          objectAfter: `timeline:${input.timelineId}`,
          fingerprintBefore,
          fingerprintAfter,
          directChange: {
            patch: patch.kind,
            ...(changedRef === null ? {} : { changedRef }),
            ...(patch.kind === 'setDuration' ? { durationMs: patch.durationMs } : {}),
            ...(patch.kind === 'setTrackTarget' ? { trackRef: patch.trackRef, target: patch.target } : {}),
          },
          potentialImpact: [],
          observedImpact: [],
        },
      },
      workingFiles: { ...record.workingFiles, [path]: `${JSON.stringify(next, null, 2)}\n` },
    };
  });
}

export type {
  TimelineCreateInput,
  TimelineCueInput,
  TimelinePatchInput,
  TimelinePatchOperation,
  Wave2Action,
  Wave2TrackKind,
} from './contracts.js';


function validateWorkingTimelineReferences(definition: TimelineDefinition, files: Readonly<Record<string, string>>): void {
  if (definition.version !== 2) return;
  try {
    resolveTimelineDefinition(definition, id => {
      if (id === definition.id) return definition;
      const path = resolveUniqueTimelinePath(files, id);
      return path === undefined ? undefined : parseTimelineDefinition(files[path]!);
    });
  } catch (error) {
    throw new AuthoringOperationError('VALIDATION_FAILED', `时间轴片段无法解析：${error instanceof Error ? error.message : String(error)}`);
  }
}
