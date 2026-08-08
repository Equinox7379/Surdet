import type { TimelineCue, TimelineDefinition, TimelineEasing, TimelineTrackKind } from '@surdet/core';

export interface TimelineFrameEvent {
  track: TimelineTrackKind;
  target?: string;
  cue: TimelineCue;
  /** 本帧跨过 cue 起点；用于背景、音频等一次性动作。 */
  started: boolean;
  /** 播放器被跳过至末尾时为 true；用于结算最终可见状态。 */
  final: boolean;
  progress: number;
  elapsedMs: number;
}

export interface TimelinePlayerSnapshot {
  version: 1;
  id: string;
  cursorMs: number;
}

interface FlatCue {
  track: TimelineTrackKind;
  target?: string;
  cue: TimelineCue;
  order: number;
}

/** Deterministic frame-time evaluator. It has no Pixi or browser dependency. */
export class TimelinePlayer {
  readonly definition: TimelineDefinition;
  #cues: FlatCue[];
  #startedCues = new Set<FlatCue>();
  #cursorMs = 0;

  constructor(definition: TimelineDefinition) {
    this.definition = definition;
    this.#cues = definition.tracks.flatMap((track, trackIndex) => track.cues.map((cue, cueIndex) => ({
      track: track.kind,
      ...(track.target ? { target: track.target } : {}),
      cue,
      order: trackIndex * 100_000 + cueIndex,
    })));
  }

  get cursorMs(): number {
    return this.#cursorMs;
  }

  get done(): boolean {
    return this.#cursorMs >= this.definition.durationMs;
  }

  advance(deltaMs: number): TimelineFrameEvent[] {
    const previous = this.#cursorMs;
    this.#cursorMs = Math.min(this.definition.durationMs, previous + Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0));
    return this.#eventsBetween(previous, this.#cursorMs);
  }

  skip(): TimelineFrameEvent[] {
    const previous = this.#cursorMs;
    this.#cursorMs = this.definition.durationMs;
    return this.#eventsBetween(previous, this.#cursorMs, true);
  }

  eventsAtCursor(): TimelineFrameEvent[] {
    return this.#cues
      .filter(({ cue }) => this.#isActive(cue, this.#cursorMs) || (cue.durationMs === 0 && cue.atMs === this.#cursorMs))
      .map((entry) => {
        const started = entry.cue.atMs === this.#cursorMs && !this.#startedCues.has(entry);
        if (started) this.#startedCues.add(entry);
        return this.#event(entry, this.#progress(entry.cue, this.#cursorMs), started, false);
      });
  }

  snapshot(): TimelinePlayerSnapshot {
    return { version: 1, id: this.definition.id, cursorMs: this.#cursorMs };
  }

  restore(snapshot: unknown): void {
    if (typeof snapshot !== 'object' || snapshot === null) throw new Error('timeline player snapshot must be an object');
    const raw = snapshot as Record<string, unknown>;
    if (raw.version !== 1 || raw.id !== this.definition.id || typeof raw.cursorMs !== 'number' || !Number.isFinite(raw.cursorMs)) {
      throw new Error(`timeline player snapshot does not match '${this.definition.id}'`);
    }
    this.#cursorMs = Math.max(0, Math.min(this.definition.durationMs, raw.cursorMs));
  }

  #eventsBetween(previous: number, current: number, forceFinal = false): TimelineFrameEvent[] {
    return this.#cues
      .filter(({ cue }) => {
        const end = cue.atMs + cue.durationMs;
        const starts = previous <= cue.atMs && current >= cue.atMs;
        const active = this.#isActive(cue, current);
        const completes = previous < end && current >= end;
        return forceFinal || starts || active || completes;
      })
      .sort((a, b) => a.order - b.order)
      .map((entry) => {
        const started = !forceFinal && !this.#startedCues.has(entry) && previous <= entry.cue.atMs && current >= entry.cue.atMs;
        if (started) this.#startedCues.add(entry);
        return this.#event(entry, forceFinal ? 1 : this.#progress(entry.cue, current), started, forceFinal);
      });
  }

  #isActive(cue: TimelineCue, atMs: number): boolean {
    const end = cue.atMs + cue.durationMs;
    return atMs >= cue.atMs && atMs <= end;
  }

  #progress(cue: TimelineCue, atMs: number): number {
    if (cue.durationMs === 0) return atMs >= cue.atMs ? 1 : 0;
    const raw = Math.max(0, Math.min(1, (atMs - cue.atMs) / cue.durationMs));
    return ease(cue.easing, raw);
  }

  #event(entry: FlatCue, progress: number, started: boolean, final: boolean): TimelineFrameEvent {
    return {
      track: entry.track,
      ...(entry.target ? { target: entry.target } : {}),
      cue: entry.cue,
      started,
      final,
      progress,
      elapsedMs: this.#cursorMs,
    };
  }
}

export function ease(easing: TimelineEasing, t: number): number {
  const x = Math.max(0, Math.min(1, t));
  const value = (() => {
    switch (easing) {
      case 'inOutSine': return -(Math.cos(Math.PI * x) - 1) / 2;
      case 'outCubic': return 1 - Math.pow(1 - x, 3);
      case 'inOutCubic': return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      case 'linear': return x;
    }
  })();
  return value === 0 ? 0 : value;
}
