import type { ProjectUiMotion } from '@surdet/core';
import type { FrameLoopTarget, FrameRequestHandler } from './types.js';

export interface ProjectUiMotionPose { opacity: number; x: number; y: number; scale: number }
interface MotionRun {
  motion: Required<ProjectUiMotion> | null;
  direction: 'enter' | 'exit';
  elapsed: number;
  paint: (pose: ProjectUiMotionPose) => void;
  complete?: () => void;
}

/** UI projection only; driven by the existing Renderer ticker, even while the story is paused. */
export class ProjectUiMotionController implements FrameLoopTarget {
  #runs = new Map<string, MotionRun>();
  #request: FrameRequestHandler | null = null;
  #disposed = false;

  get needsUpdate(): boolean { return this.#runs.size > 0; }
  setFrameRequest(handler: FrameRequestHandler | null): void {
    this.#request = handler;
    if (handler && this.needsUpdate) handler();
  }

  /** A key identifies one page instance slot. Replacing it cancels the old completion callback. */
  play(key: string, motion: Required<ProjectUiMotion> | null, direction: 'enter' | 'exit',
    paint: MotionRun['paint'], complete?: () => void): () => void {
    if (this.#disposed) throw new Error('Project UI motion disposed');
    const run: MotionRun = { motion, direction, elapsed: 0, paint, complete };
    this.#runs.set(key, run);
    this.#paint(key, run, !motion || motion.durationMs === 0 ? 1 : 0);
    if (this.#runs.get(key) === run) this.#request?.();
    return () => { if (this.#runs.get(key) === run) this.#runs.delete(key); };
  }

  cancel(key: string): void { this.#runs.delete(key); }
  cancelAll(): void { this.#runs.clear(); }
  /** Switching reduced motion on finishes the visual projection without waiting for a new clock tick. */
  finishAll(): void {
    for (const [key, run] of [...this.#runs]) if (this.#runs.get(key) === run) this.#paint(key, run, 1);
  }
  update(deltaMs: number): void {
    for (const [key, run] of [...this.#runs]) {
      if (this.#runs.get(key) !== run) continue;
      run.elapsed += Math.max(0, deltaMs);
      this.#paint(key, run, Math.min(1, run.elapsed / (run.motion?.durationMs || 1)));
    }
  }
  dispose(): void { this.#disposed = true; this.cancelAll(); this.#request = null; }

  #paint(key: string, run: MotionRun, progress: number): void {
    const m = run.motion;
    const eased = m?.easing === 'linear' ? progress : m?.easing === 'ease-in-out'
      ? progress * progress * (3 - 2 * progress) : 1 - (1 - progress) ** 3;
    const amount = run.direction === 'enter' ? 1 - eased : eased;
    try {
      run.paint(m ? { opacity: 1 + (m.opacity - 1) * amount, x: m.x * amount, y: m.y * amount,
        scale: 1 + (m.scale - 1) * amount } : { opacity: 1, x: 0, y: 0, scale: 1 });
    } catch (error) {
      if (this.#runs.get(key) === run) this.#runs.delete(key);
      throw error;
    }
    // Painting can synchronously close, replace or destroy the page.
    if (progress === 1 && this.#runs.get(key) === run) {
      this.#runs.delete(key);
      run.complete?.();
    }
  }
}
