/** 可注册的舞台转场；实现不依赖 Pixi，便于在无 DOM 测试中验证生命周期。 */
export interface StageTransition {
  readonly name: string;
  start(durationMs: number): void;
  update(deltaMs: number): boolean;
  cancel(): void;
}

const TRANSITION_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * 舞台转场注册表。
 * 同一时刻只允许一个活动转场；新转场开始前会先精确取消旧转场。
 */
export class TransitionRegistry {
  #transitions = new Map<string, StageTransition>();
  #active: StageTransition | null = null;

  register(transition: StageTransition): void {
    if (!transition || typeof transition.name !== 'string' || !TRANSITION_ID.test(transition.name)) {
      throw new Error('转场名称必须以字母开头，只能包含字母、数字、下划线或连字符');
    }
    if (this.#transitions.has(transition.name)) {
      throw new Error(`转场名称重复：${transition.name}`);
    }
    this.#transitions.set(transition.name, transition);
  }

  get(name: string): StageTransition | null {
    return this.#transitions.get(name) ?? null;
  }

  unregister(name: string): boolean {
    const transition = this.#transitions.get(name);
    if (!transition) return false;
    if (this.#active === transition) this.cancelActive();
    this.#transitions.delete(name); return true;
  }

  start(name: string, durationMs: number): boolean {
    const transition = this.get(name);
    if (!transition) return false;
    this.cancelActive();
    this.#active = transition;
    transition.start(durationMs);
    return true;
  }

  update(deltaMs: number): boolean {
    const active = this.#active;
    if (!active) return false;
    const done = active.update(deltaMs);
    if (done) this.#active = null;
    return !done;
  }

  cancelActive(): void {
    const active = this.#active;
    if (!active) return;
    this.#active = null;
    active.cancel();
  }

  get active(): StageTransition | null {
    return this.#active;
  }
}
