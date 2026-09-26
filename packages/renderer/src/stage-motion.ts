import { validStageSource, type StageSource } from '@surdet/core';
import type { TimelineEasing } from '@surdet/core';
import { ease } from './timeline-player.js';

export type StageProperty = 'x' | 'y' | 'scale' | 'opacity' | 'z' | 'facing' | 'baseHeight' | 'anchorX' | 'anchorY' | 'color';
export type StageValues = Partial<Record<StageProperty, number | string>>;
interface Motion {
  source?: StageSource;
  token: number; target: string; from: StageValues; to: StageValues;
  elapsed: number; duration: number; easing: TimelineEasing;
}
export interface StageMotionSnapshot {
  version: 1;
  sequence: number;
  owners: [string, StageProperty, number][];
  direct: Motion[];
  timelines: [string, Motion][];
  cancelled?: string[];
  origins?: [string, StageProperty, StageSource][];
}
const properties: readonly StageProperty[] = ['x', 'y', 'scale', 'opacity', 'z', 'facing', 'baseHeight', 'anchorX', 'anchorY', 'color'];
const easings: readonly TimelineEasing[] = ['linear', 'inOutSine', 'outCubic', 'inOutCubic'];
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function validateValue(target: string, property: StageProperty, value: unknown): void {
  const layer = target.startsWith('layer:'), camera = target === 'camera';
  if (target.startsWith('screen:') ? property !== 'opacity' && !(target === 'screen:tint' && property === 'color') : property === 'color') throw new Error(`Unsupported screen property ${target}.${property}`);
  if (camera && !['x', 'y', 'scale'].includes(property) || layer && !['x', 'y', 'scale', 'opacity', 'z'].includes(property)) throw new Error(`Unsupported stage property ${target}.${property}`);
  if (property === 'facing') {
    if (value !== 'left' && value !== 'right') throw new Error('Invalid facing');
    return;
  }
  const limits: Record<Exclude<StageProperty, 'facing'>, [number, number]> = {
    x: [camera ? -2000 : -100_000, camera ? 2000 : 100_000], y: [camera ? -2000 : -100_000, camera ? 2000 : 100_000],
    scale: [camera ? .25 : .01, camera ? 4 : 16], opacity: [0, 1], z: [-32768, 32767], baseHeight: [1, 20_000], anchorX: [0, 1], anchorY: [0, 1], color: [0, 0xffffff],
  };
  const range = limits[property];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]
    || (property === 'z' || property === 'color') && !Number.isInteger(value)) throw new Error(`Stage property outside bounds: ${target}.${property}`);
}

export function lerpColor(a: number, b: number, progress: number): number {
  const channel = (shift: number) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * progress);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** Only interpolation/ownership lives here. The World owner retains the single current pose. */
export class StageMotionController {
  #sequence = 0;
  #owners = new Map<string, Map<StageProperty, number>>();
  #origins = new Map<string, Map<StageProperty, StageSource>>();
  #direct: Motion[] = [];
  #timelines = new Map<string, Motion>();
  #cancelled = new Set<string>();
  constructor(private readonly read: (target: string, property: StageProperty) => number | string,
    private readonly write: (target: string, patch: StageValues) => void) {}
  get active(): boolean { return this.#direct.length > 0; }
  get hasState(): boolean { return this.#owners.size > 0 || this.#timelines.size > 0 || this.#cancelled.size > 0; }
  get hasSpatialState(): boolean { return [...this.#owners.keys()].some(target => !target.startsWith('screen:')) || this.#cancelled.size > 0; }

  #prepare(target: string, to: StageValues, duration = 0, easing: TimelineEasing = 'linear', source?: StageSource): Motion {
    if (source && !validStageSource(source)) throw new Error('Invalid stage source');
    const keys = Object.keys(to) as StageProperty[];
    if (!target || !keys.length || keys.some(key => !properties.includes(key))) throw new Error('Invalid stage motion target/properties');
    if (!Number.isFinite(duration) || duration < 0 || duration > 600_000 || !easings.includes(easing)) throw new Error('Invalid stage motion timing');
    const from: StageValues = {};
    for (const key of keys) {
      const value = to[key];
      if (key === 'facing' ? value !== 'left' && value !== 'right' : typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid stage motion ${key}`);
      validateValue(target, key, value);
      from[key] = this.read(target, key);
      validateValue(target, key, from[key]);
    }
    return { token: this.#sequence + 1, target, from, to: { ...to }, duration, elapsed: 0, easing, ...(source ? { source: copy(source) } : {}) };
  }
  #claim(motion: Motion): void {
    this.#sequence = motion.token;
    const owners = this.#owners.get(motion.target) ?? new Map<StageProperty, number>();
    for (const property of Object.keys(motion.to) as StageProperty[]) owners.set(property, motion.token);
    this.#owners.set(motion.target, owners);
    const sources = this.#origins.get(motion.target) ?? new Map<StageProperty, StageSource>();
    for (const property of Object.keys(motion.to) as StageProperty[]) {
      if (motion.source) sources.set(property, motion.source); else sources.delete(property);
    }
    this.#origins.set(motion.target, sources);
  }
  #apply(motion: Motion, progress: number): void {
    const owners = this.#owners.get(motion.target);
    const patch: StageValues = {};
    for (const property of Object.keys(motion.to) as StageProperty[]) {
      if (owners?.get(property) !== motion.token) continue;
      const to = motion.to[property]!, from = motion.from[property]!;
      patch[property] = property === 'color' ? lerpColor(Number(from), Number(to), progress)
        : property === 'facing' || property === 'z' ? to : Number(from) + (Number(to) - Number(from)) * progress;
    }
    if (Object.keys(patch).length) this.write(motion.target, patch);
  }
  start(target: string, to: StageValues, duration = 0, easing: TimelineEasing = 'linear', source?: StageSource): void {
    const motion = this.#prepare(target, to, duration, easing, source);
    this.#claim(motion);
    this.#apply(motion, duration === 0 ? 1 : 0);
    if (duration > 0) this.#direct.push(motion);
  }
  timelineTarget(identity: string): StageValues | undefined {
    const motion = this.#timelines.get(identity); return motion ? { ...motion.to } : undefined;
  }
  isCueCancelled(identity: string): boolean {
    return this.#cancelled.has(identity) || [...this.#cancelled].some(key => key.startsWith(`${identity}/`));
  }
  ownsTimeline(identity: string, property: StageProperty): boolean {
    const motion = this.#timelines.get(identity);
    return !!motion && this.#owners.get(motion.target)?.get(property) === motion.token;
  }
  timeline(identity: string, target: string, to: StageValues, progress: number, source?: StageSource): void {
    if (this.#cancelled.has(identity)) return;
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('Invalid stage timeline progress');
    let motion = this.#timelines.get(identity);
    if (!motion) {
      motion = this.#prepare(target, to, 0, 'linear', source);
      this.#claim(motion);
      this.#timelines.set(identity, motion);
    } else if (motion.target !== target || JSON.stringify(motion.to) !== JSON.stringify(to)) {
      throw new Error('Stage timeline identity changed during playback');
    }
    this.#apply(motion, progress);
  }
  update(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) return;
    for (const motion of this.#direct) {
      motion.elapsed = Math.min(motion.duration, motion.elapsed + deltaMs);
      this.#apply(motion, ease(motion.easing, motion.elapsed / motion.duration));
    }
    this.#direct = this.#direct.filter(motion => motion.elapsed < motion.duration
      && (Object.keys(motion.to) as StageProperty[]).some(property => this.#owners.get(motion.target)?.get(property) === motion.token));
  }
  skip(): void {
    for (const motion of this.#direct) this.#apply(motion, 1);
    this.#direct = [];
  }
  releaseTimeline(runId: number): void {
    for (const key of this.#timelines.keys()) if (key.startsWith(`${runId}/`)) this.#timelines.delete(key);
    for (const key of this.#cancelled) if (key.startsWith(`${runId}/`)) this.#cancelled.delete(key);
  }
  cancel(target: string): void {
    this.#owners.delete(target); this.#origins.delete(target);
    this.#direct = this.#direct.filter(motion => motion.target !== target);
    for (const [key, motion] of this.#timelines) if (motion.target === target) { this.#timelines.delete(key); this.#cancelled.add(key); }
  }
  clear(cancelActiveTimelines = false): void {
    // A scene clear cancels active cues; reset/dispose forgets the old session.
    if (cancelActiveTimelines) for (const identity of this.#timelines.keys()) this.#cancelled.add(identity);
    else this.#cancelled.clear();
    this.#sequence++; this.#owners.clear(); this.#origins.clear(); this.#direct = []; this.#timelines.clear();
  }
  sources(target: string): Record<string, StageSource> { return copy(Object.fromEntries(this.#origins.get(target) ?? [])); }
  snapshot(): StageMotionSnapshot {
    return copy({ version: 1, sequence: this.#sequence,
      owners: [...this.#owners].flatMap(([target, owners]) => [...owners].map(([property, token]): [string, StageProperty, number] => [target, property, token])),
      origins: [...this.#origins].flatMap(([target, values]) => [...values].map(([property, source]): [string, StageProperty, StageSource] => [target, property, source])),
      direct: this.#direct, timelines: [...this.#timelines], cancelled: [...this.#cancelled] });
  }
  restore(prepared: StageMotionSnapshot): void {
    const snapshot = copy(prepared);
    this.#sequence = snapshot.sequence;
    this.#origins.clear();
    for (const [target, property, source] of snapshot.origins ?? []) {
      const values = this.#origins.get(target) ?? new Map<StageProperty, StageSource>(); values.set(property, source); this.#origins.set(target, values);
    }
    this.#owners.clear();
    for (const [target, property, token] of snapshot.owners) {
      const owners = this.#owners.get(target) ?? new Map<StageProperty, number>();
      owners.set(property, token); this.#owners.set(target, owners);
    }
    this.#direct = snapshot.direct;
    this.#timelines = new Map(snapshot.timelines);
    this.#cancelled = new Set(snapshot.cancelled ?? []);
  }
}

/** Validate before the World layer clears any live sprites or ongoing actions. */
export function prepareStageMotions(value: unknown, targets: ReadonlySet<string>): StageMotionSnapshot {
  const raw = value as Partial<StageMotionSnapshot> | null;
  if (!raw || raw.version !== 1 || !Number.isSafeInteger(raw.sequence) || raw.sequence! < 0
    || !Array.isArray(raw.owners) || !Array.isArray(raw.direct) || !Array.isArray(raw.timelines)) throw new Error('Invalid stage motion snapshot');
  if (raw.owners.length > 100_000 || raw.direct.length > 10_000 || raw.timelines.length > 10_000) throw new Error('Stage motion snapshot exceeds bounds');
  const seen = new Set<string>();
  for (const entry of raw.owners) {
    if (!Array.isArray(entry) || entry.length !== 3 || !targets.has(entry[0]) || !properties.includes(entry[1])
      || !Number.isSafeInteger(entry[2]) || entry[2] <= 0 || entry[2] > raw.sequence!) throw new Error('Invalid stage owner');
    const key = JSON.stringify(entry.slice(0, 2)); if (seen.has(key)) throw new Error('Duplicate stage owner'); seen.add(key);
  }
  const check = (motion: Motion): void => {
    if (motion?.source !== undefined && !validStageSource(motion.source)) throw new Error('Invalid saved stage source');
    if (!motion || !targets.has(motion.target) || !Number.isSafeInteger(motion.token) || motion.token <= 0 || motion.token > raw.sequence!
      || !Number.isFinite(motion.elapsed) || !Number.isFinite(motion.duration) || motion.elapsed < 0 || motion.duration < 0
      || motion.elapsed > motion.duration || motion.duration > 600_000 || !easings.includes(motion.easing)) throw new Error('Invalid saved motion');
    for (const values of [motion.from, motion.to]) {
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid saved motion values');
      for (const [key, value] of Object.entries(values)) {
        if (!properties.includes(key as StageProperty) || (key === 'facing' ? value !== 'left' && value !== 'right' : typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid saved motion property');
        validateValue(motion.target, key as StageProperty, value);
      }
    }
    if (!Object.keys(motion.to).length || Object.keys(motion.to).sort().join() !== Object.keys(motion.from).sort().join()) throw new Error('Saved motion fields differ');
  };
  const tokens = new Set<number>();
  const uniqueMotion = (motion: Motion): void => { check(motion); if (tokens.has(motion.token)) throw new Error('Duplicate saved motion token'); tokens.add(motion.token); };
  raw.direct.forEach(motion => { uniqueMotion(motion); if (motion.duration === 0) throw new Error('A queued direct motion requires a positive duration'); });
  const timelineIds = new Set<string>();
  for (const entry of raw.timelines) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !/^\d+\//.test(entry[0]) || timelineIds.has(entry[0])) throw new Error('Invalid saved timeline motion');
    timelineIds.add(entry[0]); uniqueMotion(entry[1]);
  }
  if (raw.cancelled !== undefined && (!Array.isArray(raw.cancelled) || raw.cancelled.length > 10_000 || raw.cancelled.some(id => typeof id !== 'string' || !/^\d+\//.test(id) || timelineIds.has(id)) || new Set(raw.cancelled).size !== raw.cancelled.length)) throw new Error('Invalid cancelled timeline identities');
  if (raw.origins !== undefined && (!Array.isArray(raw.origins) || raw.origins.length > 100000 || raw.origins.some(entry =>
    !Array.isArray(entry) || entry.length !== 3 || !targets.has(entry[0]) || !properties.includes(entry[1]) || !validStageSource(entry[2])))) throw new Error('Invalid stage source map');
  return copy(raw as StageMotionSnapshot);
}
