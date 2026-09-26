/**
 * Data-only ADV presentation timeline model.
 *
 * This module deliberately has no renderer or filesystem dependency. Hosts may
 * load JSON however they like, validate it here, and pass the definitions to
 * the interpreter/renderer boundary.
 */

export const TIMELINE_VERSION = 1 as const;
export const MAX_TIMELINE_MS = 600_000;

export type TimelineTrackKind = 'background' | 'portrait' | 'camera' | 'screen' | 'particle' | 'audio' | 'layer';
export type TimelineEasing = 'linear' | 'inOutSine' | 'outCubic' | 'inOutCubic';
export type TimelineValue = string | number | boolean | null;

export interface TimelineCue {
  atMs: number;
  durationMs: number;
  easing: TimelineEasing;
  action: string;
  [key: string]: TimelineValue;
}

export interface TimelineTrack {
  kind: TimelineTrackKind;
  target?: string;
  cues: TimelineCue[];
}

export interface TimelineDefinition {
  version: 1 | 2;
  id: string;
  durationMs: number;
  tracks: TimelineTrack[];
  /** V2 finite references; registry resolves them before playback, without executing code. */
  clips?: TimelineClip[];
  /** Runtime-generated source map; authored data is not used as provenance. */
  resolvedCueSources?: Extract<import('./stage.js').StageSource, { kind: 'timeline' }>[][];
}

export interface TimelineClip {
  timelineId: string; atMs: number; repeat?: number; gapMs?: number;
  targets?: Record<string, string>;
}

export interface TimelineDiagnostic {
  code: string;
  message: string;
  path?: string;
}

export interface TimelineCatalog {
  get(id: string): TimelineDefinition | undefined;
  has(id: string): boolean;
  all(): readonly TimelineDefinition[];
}

export class TimelineValidationError extends Error {
  readonly diagnostics: readonly TimelineDiagnostic[];

  constructor(diagnostics: readonly TimelineDiagnostic[]) {
    super(diagnostics.map((d) => `${d.path ? `${d.path}: ` : ''}${d.message} [${d.code}]`).join('\n'));
    this.name = 'TimelineValidationError';
    this.diagnostics = diagnostics;
  }
}

const TRACKS = new Set<TimelineTrackKind>(['background', 'portrait', 'camera', 'screen', 'particle', 'audio', 'layer']);
const EASINGS = new Set<TimelineEasing>(['linear', 'inOutSine', 'outCubic', 'inOutCubic']);
const ACTIONS: Record<TimelineTrackKind, ReadonlySet<string>> = {
  background: new Set(['set']),
  portrait: new Set(['show', 'hide', 'move', 'expression']),
  camera: new Set(['zoom', 'pan', 'shake']),
  screen: new Set(['fade', 'tint', 'flash', 'wipe']),
  particle: new Set(['start', 'stop']),
  audio: new Set(['bgm', 'se', 'voice']),
  layer: new Set(['show', 'hide', 'pose']),
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function add(diagnostics: TimelineDiagnostic[], code: string, message: string, path: string): void {
  diagnostics.push({ code, message, path });
}

function requireString(
  value: unknown,
  diagnostics: TimelineDiagnostic[],
  code: string,
  message: string,
  path: string,
): void {
  if (!isString(value) || value.trim().length === 0) add(diagnostics, code, message, path);
}

function validatePayload(
  kind: TimelineTrackKind,
  cue: Record<string, unknown>,
  track: Record<string, unknown>,
  diagnostics: TimelineDiagnostic[],
  path: string,
  version: 1 | 2,
): void {
  const action = cue.action;
  if (kind === 'background' && action === 'set') {
    requireString(cue.key, diagnostics, 'TL009', 'background set requires a non-empty key', `${path}.key`);
  } else if (kind === 'portrait') {
    requireString(track.target, diagnostics, 'TL009', 'portrait track requires a non-empty target', `${path.replace(/\.cues\.\d+$/, '')}.target`);
    if (action === 'show' || action === 'expression') {
      if (version === 2 && cue.source !== undefined) requireString(cue.source, diagnostics, 'TL009', 'portrait source must be a role:outfit asset identity', `${path}.source`);
      requireString(cue.expression, diagnostics, 'TL009', 'portrait show/expression requires expression', `${path}.expression`);
    }
    if ((action === 'show' && version === 1) || action === 'move') {
      requireString(cue.position, diagnostics, 'TL009', 'portrait show/move requires position', `${path}.position`);
    }
    if (version === 2 && (action === 'show' || action === 'pose' || action === 'move')) validatePosePayload(cue, diagnostics, path, kind);
  } else if (kind === 'layer') {
    requireString(track.target, diagnostics, 'TL009', 'layer track requires a target ID', `${path}.target`);
    if (action === 'show') requireString(cue.key, diagnostics, 'TL009', 'layer show requires a background asset key', `${path}.key`);
    if (action === 'show' || action === 'pose') validatePosePayload(cue, diagnostics, path, kind);
    if (cue.band !== undefined && cue.band !== 'environment' && cue.band !== 'foreground') add(diagnostics, 'TL009', 'invalid layer band', `${path}.band`);
    if (cue.parallax !== undefined && (!isFiniteNumber(cue.parallax) || cue.parallax < 0 || cue.parallax > 2)) add(diagnostics, 'TL009', 'parallax must be 0..2', `${path}.parallax`);
  } else if (kind === 'camera') {
    if (action === 'zoom' && (!isFiniteNumber(cue.scale) || cue.scale <= 0)) {
      add(diagnostics, 'TL009', 'camera zoom requires a positive scale', `${path}.scale`);
    }
    if (action === 'pan') {
      if (!isFiniteNumber(cue.x) || cue.x < -2000 || cue.x > 2000) {
        add(diagnostics, 'TL009', 'camera pan x must be between -2000 and 2000', `${path}.x`);
      }
      if (!isFiniteNumber(cue.y) || cue.y < -2000 || cue.y > 2000) {
        add(diagnostics, 'TL009', 'camera pan y must be between -2000 and 2000', `${path}.y`);
      }
    }
    if (action === 'shake' && (!isFiniteNumber(cue.strength) || cue.strength < 0 || cue.strength > 64)) {
      add(diagnostics, 'TL009', 'camera shake strength must be between 0 and 64', `${path}.strength`);
    }
  } else if (kind === 'screen') {
    if (action === 'fade') {
      if (!isFiniteNumber(cue.alpha) || cue.alpha < 0 || cue.alpha > 1) add(diagnostics, 'TL009', 'screen fade alpha must be between 0 and 1', `${path}.alpha`);
    }
    if (action === 'tint') {
      if (!isFiniteNumber(cue.color) || cue.color < 0 || cue.color > 0xffffff) add(diagnostics, 'TL009', 'screen tint color must be a 0xRRGGBB number', `${path}.color`);
      if (!isFiniteNumber(cue.alpha) || cue.alpha < 0 || cue.alpha > 1) add(diagnostics, 'TL009', 'screen tint alpha must be between 0 and 1', `${path}.alpha`);
    }
  } else if (kind === 'particle' && action === 'start') {
    requireString(cue.kind, diagnostics, 'TL009', 'particle start requires a preset kind', `${path}.kind`);
  } else if (kind === 'audio') {
    requireString(cue.key, diagnostics, 'TL009', 'audio cue requires a non-empty key', `${path}.key`);
  }
}

/** Validate an untrusted JSON value. An empty array means the value is usable. */
export function validateTimeline(value: unknown): TimelineDiagnostic[] {
  const diagnostics: TimelineDiagnostic[] = [];
  if (!isObject(value)) {
    return [{ code: 'TL001', message: 'timeline must be an object', path: '$' }];
  }

  if (value.version !== 1 && value.version !== 2) add(diagnostics, 'TL002', 'timeline version must be 1 or 2', '$.version');
  const version = value.version === 2 ? 2 : 1;
  validateClips(value.clips, version, diagnostics);
  if (!isString(value.id) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.id)) {
    add(diagnostics, 'TL003', 'timeline id must contain only letters, numbers, _, ., and -', '$.id');
  }
  if (!isFiniteNumber(value.durationMs) || !Number.isInteger(value.durationMs) || value.durationMs < 0 || value.durationMs > MAX_TIMELINE_MS) {
    add(diagnostics, 'TL004', `durationMs must be an integer from 0 to ${MAX_TIMELINE_MS}`, '$.durationMs');
  }
  if (!Array.isArray(value.tracks) || (value.tracks.length === 0 && !(version === 2 && Array.isArray(value.clips) && value.clips.length > 0))) {
    add(diagnostics, 'TL005', 'timeline must contain at least one track', '$.tracks');
    return diagnostics;
  }

  const duration = isFiniteNumber(value.durationMs) ? value.durationMs : MAX_TIMELINE_MS;
  for (const [trackIndex, rawTrack] of value.tracks.entries()) {
    const trackPath = `$.tracks.${trackIndex}`;
    if (!isObject(rawTrack)) {
      add(diagnostics, 'TL005', 'track must be an object', trackPath);
      continue;
    }
    const kind = rawTrack.kind;
    if (!isString(kind) || !TRACKS.has(kind as TimelineTrackKind) || version === 1 && kind === 'layer') {
      add(diagnostics, 'TL007', 'track kind is not supported', `${trackPath}.kind`);
      continue;
    }
    if (!Array.isArray(rawTrack.cues)) {
      add(diagnostics, 'TL005', 'track cues must be an array', `${trackPath}.cues`);
      continue;
    }
    for (const [cueIndex, rawCue] of rawTrack.cues.entries()) {
      const cuePath = `${trackPath}.cues.${cueIndex}`;
      if (!isObject(rawCue)) {
        add(diagnostics, 'TL005', 'cue must be an object', cuePath);
        continue;
      }
      if (!isFiniteNumber(rawCue.atMs) || !Number.isInteger(rawCue.atMs) || rawCue.atMs < 0) {
        add(diagnostics, 'TL006', 'atMs must be a non-negative integer', `${cuePath}.atMs`);
      }
      if (!isFiniteNumber(rawCue.durationMs) || !Number.isInteger(rawCue.durationMs) || rawCue.durationMs < 0) {
        add(diagnostics, 'TL006', 'durationMs must be a non-negative integer', `${cuePath}.durationMs`);
      }
      if (isFiniteNumber(rawCue.atMs) && isFiniteNumber(rawCue.durationMs) && rawCue.atMs + rawCue.durationMs > duration) {
        add(diagnostics, 'TL006', 'cue ends after the timeline duration', cuePath);
      }
      if (!isString(rawCue.easing) || !EASINGS.has(rawCue.easing as TimelineEasing)) {
        add(diagnostics, 'TL007', 'easing is not supported', `${cuePath}.easing`);
      }
      const pose = version === 2 && kind === 'portrait' && rawCue.action === 'pose';
      if (!isString(rawCue.action) || !pose && !ACTIONS[kind as TimelineTrackKind].has(rawCue.action)) {
        add(diagnostics, 'TL008', `action is not supported for ${kind} track`, `${cuePath}.action`);
      }
      validatePayload(kind as TimelineTrackKind, rawCue, rawTrack, diagnostics, cuePath, version);
    }
  }
  return diagnostics;
}

function cloneDefinition(value: TimelineDefinition): TimelineDefinition {
  return JSON.parse(JSON.stringify(value)) as TimelineDefinition;
}

/** In-memory catalog used by CLI, starter, editor preview, and packaged hosts. */
export class TimelineRegistry implements TimelineCatalog {
  #definitions = new Map<string, TimelineDefinition>();

  register(value: unknown): TimelineDefinition {
    const diagnostics = validateTimeline(value);
    if (diagnostics.length > 0) throw new TimelineValidationError(diagnostics);
    const definition = cloneDefinition(value as TimelineDefinition);
    if (this.#definitions.has(definition.id)) {
      throw new TimelineValidationError([{ code: 'TL010', message: `duplicate timeline id '${definition.id}'`, path: '$.id' }]);
    }
    this.#definitions.set(definition.id, definition);
    return cloneDefinition(definition);
  }

  get(id: string): TimelineDefinition | undefined {
    const definition = this.#definitions.get(id);
    return definition ? resolveTimelineDefinition(definition, id => this.#definitions.get(id)) : undefined;
  }

  has(id: string): boolean {
    return this.#definitions.has(id);
  }

  all(): readonly TimelineDefinition[] {
    return [...this.#definitions.keys()].map(id => this.get(id)!);
  }
}


const POSE_LIMITS: Record<string, readonly [number, number]> = {
  x: [-100_000, 100_000], y: [-100_000, 100_000], scale: [.01, 16], opacity: [0, 1],
  z: [-32768, 32767], baseHeight: [1, 20_000], anchorX: [0, 1], anchorY: [0, 1],
};
function validatePosePayload(cue: Record<string, unknown>, diagnostics: TimelineDiagnostic[], path: string, kind: string): void {
  let fields = 0;
  for (const [name, limits] of Object.entries(POSE_LIMITS)) {
    if (cue[name] === undefined) continue;
    fields++;
    if (!isFiniteNumber(cue[name]) || cue[name] < limits[0] || cue[name] > limits[1] || name === 'z' && !Number.isInteger(cue[name]))
      add(diagnostics, 'TL009', `invalid ${name}`, `${path}.${name}`);
    if (kind === 'layer' && ['baseHeight', 'anchorX', 'anchorY'].includes(name)) add(diagnostics, 'TL009', `layer does not support ${name}`, `${path}.${name}`);
  }
  if (cue.facing !== undefined) {
    fields++;
    if (kind === 'layer' || cue.facing !== 'left' && cue.facing !== 'right') add(diagnostics, 'TL009', 'facing must be left/right on a portrait', `${path}.facing`);
  }
  for (const name of ['position', 'distance']) if (cue[name] !== undefined) {
    fields++;
    requireString(cue[name], diagnostics, 'TL009', `${name} must be non-empty`, `${path}.${name}`);
    if (kind === 'layer') add(diagnostics, 'TL009', `layer uses coordinates, not ${name}`, `${path}.${name}`);
  }
  if (cue.action === 'pose' && fields === 0) add(diagnostics, 'TL009', 'pose requires explicit properties', path);
}
function validateClips(value: unknown, version: 1 | 2, diagnostics: TimelineDiagnostic[]): void {
  if (value === undefined) return;
  if (version !== 2 || !Array.isArray(value) || value.length > 256) {
    add(diagnostics, 'TL011', 'clips require version 2 and at most 256 entries', '$.clips'); return;
  }
  for (const [index, entry] of value.entries()) {
    const path = `$.clips.${index}`;
    if (!isObject(entry)) { add(diagnostics, 'TL011', 'clip must be an object', path); continue; }
    for (const key of Object.keys(entry)) if (!['timelineId', 'atMs', 'repeat', 'gapMs', 'targets'].includes(key)) add(diagnostics, 'TL011', 'unknown clip field', `${path}.${key}`);
    if (typeof entry.timelineId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(entry.timelineId)) add(diagnostics, 'TL011', 'invalid referenced timeline ID', `${path}.timelineId`);
    for (const [name, min, max, fallback] of [['atMs', 0, MAX_TIMELINE_MS, NaN], ['repeat', 1, 100, 1], ['gapMs', 0, MAX_TIMELINE_MS, 0]] as const) {
      const v = entry[name] ?? fallback;
      if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max) add(diagnostics, 'TL011', `invalid ${name}`, `${path}.${name}`);
    }
    if (entry.targets !== undefined) {
      if (!isObject(entry.targets) || Object.keys(entry.targets).length > 128) add(diagnostics, 'TL011', 'invalid target bindings', `${path}.targets`);
      else for (const [from, to] of Object.entries(entry.targets)) {
        if (!from.trim() || typeof to !== 'string' || !to.trim() || to !== to.trim() || /[\u0000-\u001f]/.test(from + to)) add(diagnostics, 'TL011', 'invalid target binding', `${path}.targets`);
      }
    }
  }
}

/** Resolve a bounded acyclic reference graph. Every host uses this registry path. */
export function resolveTimelineDefinition(definition: TimelineDefinition, lookup: (id: string) => TimelineDefinition | undefined): TimelineDefinition {
  if (definition.version === 1 && definition.clips === undefined) return cloneDefinition(definition);
  let cueCount = 0, expansionCount = 0;
  const origins = new WeakMap<TimelineTrack, Extract<import('./stage.js').StageSource, { kind: 'timeline' }>[]>();
  const expand = (value: TimelineDefinition, stack: readonly string[]): TimelineTrack[] => {
    if (++expansionCount > 10_000) throw new TimelineValidationError([{ code: 'TL012', message: 'clip expansion exceeds 10000 nodes' }]);
    const diagnostics = validateTimeline(value);
    if (diagnostics.length) throw new TimelineValidationError(diagnostics);
    if (stack.includes(value.id) || stack.length >= 16) throw new TimelineValidationError([{ code: 'TL012', message: `cyclic or excessively deep clip: ${[...stack, value.id].join(' -> ')}` }]);
    const tracks = cloneDefinition(value).tracks;
    tracks.forEach((track, trackIndex) => origins.set(track, track.cues.map((_, cueIndex) => ({ kind: 'timeline', timelineId: value.id, trackIndex, cueIndex }))));
    cueCount += tracks.reduce((sum, track) => sum + track.cues.length, 0);
    if (cueCount > 10_000) throw new TimelineValidationError([{ code: 'TL012', message: 'expanded timeline exceeds 10000 cues' }]);
    for (const [clipIndex, clip] of (value.clips ?? []).entries()) {
      const referenced = lookup(clip.timelineId);
      if (!referenced) throw new TimelineValidationError([{ code: 'TL012', message: `missing clip ${clip.timelineId}` }]);
      const repeats = clip.repeat ?? 1, gap = clip.gapMs ?? 0;
      const end = clip.atMs + repeats * referenced.durationMs + (repeats - 1) * gap;
      if (end > value.durationMs) throw new TimelineValidationError([{ code: 'TL012', message: `clip ${clip.timelineId} exceeds parent duration` }]);
      for (let repetition = 0; repetition < repeats; repetition++) {
        const nested = expand(referenced, [...stack, value.id]);
        const targets = new Set(nested.filter(track => track.kind === 'portrait' || track.kind === 'layer').map(track => track.target));
        for (const from of Object.keys(clip.targets ?? {})) if (!targets.has(from)) throw new TimelineValidationError([{ code: 'TL012', message: `unknown clip target ${from}` }]);
        const kinds = new Map<string, Set<string>>();
        for (const track of nested) if ((track.kind === 'portrait' || track.kind === 'layer') && track.target) {
          const set = kinds.get(track.target) ?? new Set<string>(); set.add(track.kind); kinds.set(track.target, set);
        }
        const destinations = new Map<string, string>();
        for (const [from, set] of kinds) {
          const to = clip.targets && Object.prototype.hasOwnProperty.call(clip.targets, from) ? clip.targets[from]! : from;
          if (to !== from && (set.size !== 1 || kinds.has(to) && [...kinds.get(to)!].some(kind => !set.has(kind))))
            throw new TimelineValidationError([{ code: 'TL012', message: `clip target kind mismatch: ${from} -> ${to}` }]);
          for (const kind of set) {
            const key = `${kind}:${to}`, previous = destinations.get(key);
            if (previous !== undefined && previous !== from) throw new TimelineValidationError([{ code: 'TL012', message: `colliding clip target: ${previous}, ${from} -> ${to}` }]);
            destinations.set(key, from);
          }
        }
        const offset = clip.atMs + repetition * (referenced.durationMs + gap);
        for (const track of nested) {
          const rebound = track.target !== undefined && clip.targets && Object.prototype.hasOwnProperty.call(clip.targets, track.target)
            ? clip.targets[track.target]! : track.target;
          const mapped: TimelineTrack = { ...track, ...(rebound === undefined ? {} : { target: rebound }),
            cues: track.cues.map(cue => ({ ...cue, atMs: cue.atMs + offset,
              ...(track.kind === 'portrait' && rebound !== track.target && ['show', 'expression'].includes(cue.action)
                ? { source: cue.source ?? track.target! } : {}) })) };
          origins.set(mapped, origins.get(track)!.map(origin => ({ ...origin,
            instances: [{ timelineId: value.id, clipIndex, iteration: repetition }, ...origin.instances ?? []] })));
          tracks.push(mapped);
        }
      }
    }
    return tracks;
  };
  const tracks = expand(definition, []);
  return { version: 2, id: definition.id, durationMs: definition.durationMs, tracks, resolvedCueSources: tracks.map(track => origins.get(track)!) };
}
