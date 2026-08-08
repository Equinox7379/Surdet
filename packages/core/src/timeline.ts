/**
 * Data-only ADV presentation timeline model.
 *
 * This module deliberately has no renderer or filesystem dependency. Hosts may
 * load JSON however they like, validate it here, and pass the definitions to
 * the interpreter/renderer boundary.
 */

export const TIMELINE_VERSION = 1 as const;
export const MAX_TIMELINE_MS = 600_000;

export type TimelineTrackKind = 'background' | 'portrait' | 'camera' | 'screen' | 'particle' | 'audio';
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
  version: typeof TIMELINE_VERSION;
  id: string;
  durationMs: number;
  tracks: TimelineTrack[];
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

const TRACKS = new Set<TimelineTrackKind>(['background', 'portrait', 'camera', 'screen', 'particle', 'audio']);
const EASINGS = new Set<TimelineEasing>(['linear', 'inOutSine', 'outCubic', 'inOutCubic']);
const ACTIONS: Record<TimelineTrackKind, ReadonlySet<string>> = {
  background: new Set(['set']),
  portrait: new Set(['show', 'hide', 'move', 'expression']),
  camera: new Set(['zoom', 'pan', 'shake']),
  screen: new Set(['fade', 'tint', 'flash', 'wipe']),
  particle: new Set(['start', 'stop']),
  audio: new Set(['bgm', 'se', 'voice']),
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
): void {
  const action = cue.action;
  if (kind === 'background' && action === 'set') {
    requireString(cue.key, diagnostics, 'T009', 'background set requires a non-empty key', `${path}.key`);
  } else if (kind === 'portrait') {
    requireString(track.target, diagnostics, 'T009', 'portrait track requires a non-empty target', `${path.replace(/\.cues\.\d+$/, '')}.target`);
    if (action === 'show' || action === 'expression') {
      requireString(cue.expression, diagnostics, 'T009', 'portrait show/expression requires expression', `${path}.expression`);
    }
    if (action === 'show' || action === 'move') {
      requireString(cue.position, diagnostics, 'T009', 'portrait show/move requires position', `${path}.position`);
    }
  } else if (kind === 'camera') {
    if (action === 'zoom' && (!isFiniteNumber(cue.scale) || cue.scale <= 0)) {
      add(diagnostics, 'T009', 'camera zoom requires a positive scale', `${path}.scale`);
    }
    if (action === 'pan') {
      if (!isFiniteNumber(cue.x) || cue.x < -2000 || cue.x > 2000) {
        add(diagnostics, 'T009', 'camera pan x must be between -2000 and 2000', `${path}.x`);
      }
      if (!isFiniteNumber(cue.y) || cue.y < -2000 || cue.y > 2000) {
        add(diagnostics, 'T009', 'camera pan y must be between -2000 and 2000', `${path}.y`);
      }
    }
    if (action === 'shake' && (!isFiniteNumber(cue.strength) || cue.strength < 0 || cue.strength > 64)) {
      add(diagnostics, 'T009', 'camera shake strength must be between 0 and 64', `${path}.strength`);
    }
  } else if (kind === 'screen') {
    if (action === 'fade') {
      if (!isFiniteNumber(cue.alpha) || cue.alpha < 0 || cue.alpha > 1) add(diagnostics, 'T009', 'screen fade alpha must be between 0 and 1', `${path}.alpha`);
    }
    if (action === 'tint') {
      if (!isFiniteNumber(cue.color) || cue.color < 0 || cue.color > 0xffffff) add(diagnostics, 'T009', 'screen tint color must be a 0xRRGGBB number', `${path}.color`);
      if (!isFiniteNumber(cue.alpha) || cue.alpha < 0 || cue.alpha > 1) add(diagnostics, 'T009', 'screen tint alpha must be between 0 and 1', `${path}.alpha`);
    }
  } else if (kind === 'particle' && action === 'start') {
    requireString(cue.kind, diagnostics, 'T009', 'particle start requires a preset kind', `${path}.kind`);
  } else if (kind === 'audio') {
    requireString(cue.key, diagnostics, 'T009', 'audio cue requires a non-empty key', `${path}.key`);
  }
}

/** Validate an untrusted JSON value. An empty array means the value is usable. */
export function validateTimeline(value: unknown): TimelineDiagnostic[] {
  const diagnostics: TimelineDiagnostic[] = [];
  if (!isObject(value)) {
    return [{ code: 'T001', message: 'timeline must be an object', path: '$' }];
  }

  if (value.version !== TIMELINE_VERSION) add(diagnostics, 'T002', `timeline version must be ${TIMELINE_VERSION}`, '$.version');
  if (!isString(value.id) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.id)) {
    add(diagnostics, 'T003', 'timeline id must contain only letters, numbers, _, ., and -', '$.id');
  }
  if (!isFiniteNumber(value.durationMs) || !Number.isInteger(value.durationMs) || value.durationMs < 0 || value.durationMs > MAX_TIMELINE_MS) {
    add(diagnostics, 'T004', `durationMs must be an integer from 0 to ${MAX_TIMELINE_MS}`, '$.durationMs');
  }
  if (!Array.isArray(value.tracks) || value.tracks.length === 0) {
    add(diagnostics, 'T005', 'timeline must contain at least one track', '$.tracks');
    return diagnostics;
  }

  const duration = isFiniteNumber(value.durationMs) ? value.durationMs : MAX_TIMELINE_MS;
  for (const [trackIndex, rawTrack] of value.tracks.entries()) {
    const trackPath = `$.tracks.${trackIndex}`;
    if (!isObject(rawTrack)) {
      add(diagnostics, 'T005', 'track must be an object', trackPath);
      continue;
    }
    const kind = rawTrack.kind;
    if (!isString(kind) || !TRACKS.has(kind as TimelineTrackKind)) {
      add(diagnostics, 'T007', 'track kind is not supported', `${trackPath}.kind`);
      continue;
    }
    if (!Array.isArray(rawTrack.cues)) {
      add(diagnostics, 'T005', 'track cues must be an array', `${trackPath}.cues`);
      continue;
    }
    for (const [cueIndex, rawCue] of rawTrack.cues.entries()) {
      const cuePath = `${trackPath}.cues.${cueIndex}`;
      if (!isObject(rawCue)) {
        add(diagnostics, 'T005', 'cue must be an object', cuePath);
        continue;
      }
      if (!isFiniteNumber(rawCue.atMs) || !Number.isInteger(rawCue.atMs) || rawCue.atMs < 0) {
        add(diagnostics, 'T006', 'atMs must be a non-negative integer', `${cuePath}.atMs`);
      }
      if (!isFiniteNumber(rawCue.durationMs) || !Number.isInteger(rawCue.durationMs) || rawCue.durationMs < 0) {
        add(diagnostics, 'T006', 'durationMs must be a non-negative integer', `${cuePath}.durationMs`);
      }
      if (isFiniteNumber(rawCue.atMs) && isFiniteNumber(rawCue.durationMs) && rawCue.atMs + rawCue.durationMs > duration) {
        add(diagnostics, 'T006', 'cue ends after the timeline duration', cuePath);
      }
      if (!isString(rawCue.easing) || !EASINGS.has(rawCue.easing as TimelineEasing)) {
        add(diagnostics, 'T007', 'easing is not supported', `${cuePath}.easing`);
      }
      if (!isString(rawCue.action) || !ACTIONS[kind as TimelineTrackKind].has(rawCue.action)) {
        add(diagnostics, 'T008', `action is not supported for ${kind} track`, `${cuePath}.action`);
      }
      validatePayload(kind as TimelineTrackKind, rawCue, rawTrack, diagnostics, cuePath);
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
      throw new TimelineValidationError([{ code: 'T010', message: `duplicate timeline id '${definition.id}'`, path: '$.id' }]);
    }
    this.#definitions.set(definition.id, definition);
    return cloneDefinition(definition);
  }

  get(id: string): TimelineDefinition | undefined {
    const definition = this.#definitions.get(id);
    return definition ? cloneDefinition(definition) : undefined;
  }

  has(id: string): boolean {
    return this.#definitions.has(id);
  }

  all(): readonly TimelineDefinition[] {
    return [...this.#definitions.values()].map(cloneDefinition);
  }
}
