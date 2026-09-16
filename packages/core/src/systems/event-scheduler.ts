import type { VariableStore } from '../state/variable-store.js';
import type { ExprEnv } from '../runtime/expr-eval.js';
import { evalExprBoolean } from '../runtime/expr-eval.js';
import type { RelationshipEvent } from './affection.js';

/**
 * 事件优先级调度器（兰斯式事件队列）。
 *
 * 兰斯系列的灵魂机制：大量事件按 flag/条件排队，同一调度点只触发
 * **优先级最高**的一个，其余顺延到下次调度。本调度器做声明式实现：
 *  - 事件定义复用 RelationshipEvent（events.json），priority 字段决定排序；
 *  - once 事件触发后进入 fired 集合（随存档持久化，宿主接线）；
 *  - effects 触发即应用（写入变量表）；场景跳转仍由宿主经 hostJump 完成
 *    （与既有 affection/calendar 宿主接管模式一致，内核保持 headless 纯净）。
 */

/** 带优先级的事件定义（priority 缺省 0；越大越优先） */
export interface ScheduledEventDef extends RelationshipEvent {
  priority?: number;
}

/** 调度器状态快照（随存档保存；fired = 已触发的一次性事件 ID） */
export interface EventSchedulerSnapshot {
  fired: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class EventScheduler {
  #events: ScheduledEventDef[];
  #env: ExprEnv;
  #fired = new Set<string>();

  constructor(events: readonly ScheduledEventDef[], env: ExprEnv) {
    this.#events = [...events];
    this.#env = env;
  }

  /**
   * 当前可触发的事件，按优先级降序（同优先级保持配置顺序 = 声明序优先）。
   * 条件求值严格策略（与 @if 一致）：未定义变量/类型错误抛错，暴露配置缺陷。
   */
  eligible(): ScheduledEventDef[] {
    const ready = this.#events.filter((e) => {
      if (e.once === true && this.#fired.has(e.id)) return false;
      return evalExprBoolean(e.when, this.#env);
    });
    // 稳定排序：priority 降序，同分保持原序
    return ready
      .map((e, i) => ({ e, i }))
      .sort((a, b) => (b.e.priority ?? 0) - (a.e.priority ?? 0) || a.i - b.i)
      .map((x) => x.e);
  }

  /**
   * 触发一个事件：应用 effects、once 事件记入 fired。返回事件定义（宿主用其 scene 跳转）；
   * 不在 eligible 名单中或已 fired 的事件拒绝触发（返回 null），防止宿主误触发。
   */
  fire(id: string): ScheduledEventDef | null {
    const ev = this.#events.find((e) => e.id === id);
    if (!ev) return null;
    if (ev.once === true && this.#fired.has(id)) return null;
    if (!evalExprBoolean(ev.when, this.#env)) return null;
    if (ev.once === true) this.#fired.add(id);
    return ev;
  }

  /**
   * 触发并把 effects 写入变量表（宿主传入活体 VariableStore）。
   * number 效果走 add 语义（增量），flag/string 走 set 语义；类型校验由 store 兜底。
   */
  fireInto(id: string, store: VariableStore): ScheduledEventDef | null {
    const ev = this.#events.find((event) => event.id === id);
    if (!ev || (ev.once === true && this.#fired.has(id)) || !evalExprBoolean(ev.when, this.#env)) return null;
    const updates: Parameters<VariableStore['setMany']>[0][number][] = [];
    if (ev.effects) {
      for (const [name, value] of Object.entries(ev.effects)) {
        if (!store.has(name)) continue; // 未声明变量跳过（严格校验交给 lint/配置审查）
        if (typeof value === 'number') {
          const cur = store.get(name);
          updates.push({ name, value: typeof cur === 'number' ? cur + value : value });
        } else {
          updates.push({ name, value });
        }
      }
    }
    store.setMany(updates);
    if (ev.once === true) this.#fired.add(id);
    return ev;
  }

  /** 一步调度：取最高优先级事件并触发（无合格事件返回 null） */
  dispatch(store: VariableStore): ScheduledEventDef | null {
    const top = this.eligible()[0];
    return top ? this.fireInto(top.id, store) : null;
  }

  isFired(id: string): boolean {
    return this.#fired.has(id);
  }

  snapshot(): EventSchedulerSnapshot {
    return { fired: [...this.#fired] };
  }

  validateSnapshot(snap: unknown): asserts snap is EventSchedulerSnapshot | undefined {
    if (snap === undefined) return;
    if (!isRecord(snap)) throw new Error('事件调度器快照必须是对象');
    if (!Array.isArray(snap.fired) || snap.fired.some((id) => typeof id !== 'string')) {
      throw new Error('事件调度器快照 fired 必须是字符串数组');
    }
  }

  restore(snap: EventSchedulerSnapshot | undefined): void {
    this.validateSnapshot(snap);
    this.#fired = new Set(snap?.fired ?? []);
  }
}
