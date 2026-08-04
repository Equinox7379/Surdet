/**
 * 运行时事件总线（发布/订阅）。
 * 内核各模块解耦通信，渲染层通过监听事件驱动 UI。
 */
/** 事件负载基类型 */
export type EventPayload = Record<string, unknown>;

/** 事件名 → 负载类型 的映射（类型化总线用；默认宽映射保持向后兼容）。
 *  负载约束为对象类型即可（总线只透传、不检查内容），SaveSnapshot 等具体结构可直接作为负载。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventMap = Record<string, any>;

export type EventHandler<T = EventPayload> = (payload: T) => void;

export type Unsubscribe = () => void;

/** 日志抽象：core 零依赖，不直接依赖 console，由宿主注入（渲染层/CLI）。
 *  默认回退到全局 console（存在时），保证回调错误不被无声吞掉。 */
export interface Logger {
  error(...args: unknown[]): void;
}

const DEFAULT_LOGGER: Logger = {
  error(...args: unknown[]) {
    const c = (globalThis as { console?: { error: (...a: unknown[]) => void } }).console;
    c?.error(...args);
  },
};

interface Subscription {
  handler: EventHandler<unknown>;
  once: boolean;
}

/** 构造选项：回调抛错时的统一处理钩子（宿主可上报 UI/日志，避免错误被静默吞掉） */
export interface EventBusOptions {
  onHandlerError?: (err: unknown, event: string) => void;
}

/**
 * 轻量同步事件总线。支持 once、unsubscribe、按名称订阅。
 * 回调抛错不中断其余订阅者（logger 记录 + onHandlerError 钩子）。
 *
 * 泛型 E 为事件映射（事件名 → 负载类型）：传入 CoreEventMap 等具体映射时，
 * on/emit 的事件名与负载类型自动推导，宿主接线无需手写断言。
 */
export class EventBus<E extends EventMap = EventMap> {
  #subs = new Map<string, Set<Subscription>>();
  #logger: Logger;
  #onHandlerError?: (err: unknown, event: string) => void;

  constructor(logger: Logger = DEFAULT_LOGGER, options: EventBusOptions = {}) {
    this.#logger = logger;
    this.#onHandlerError = options.onHandlerError;
  }

  /** 订阅事件（负载类型由事件映射推导） */
  on<K extends keyof E & string>(event: K, handler: EventHandler<E[K]>): Unsubscribe {
    const sub: Subscription = { handler: handler as EventHandler<unknown>, once: false };
    return this.#add(event, sub);
  }

  /** 订阅一次性事件 */
  once<K extends keyof E & string>(event: K, handler: EventHandler<E[K]>): Unsubscribe {
    const sub: Subscription = { handler: handler as EventHandler<unknown>, once: true };
    return this.#add(event, sub);
  }

  /** 发布事件（同步；handler 抛错不中断其余订阅者，由 logger + onHandlerError 处理） */
  emit<K extends keyof E & string>(event: K, payload: E[K]): void {
    const subs = this.#subs.get(event);
    if (!subs) return;
    for (const sub of [...subs]) {
      try {
        sub.handler(payload);
      } catch (err) {
        this.#logger.error(`[EventBus] handler for '${event}' threw:`, err);
        this.#onHandlerError?.(err, event);
      }
      if (sub.once) subs.delete(sub);
    }
    if (subs.size === 0) this.#subs.delete(event);
  }

  /** 清空全部事件 */
  clear(): void {
    this.#subs.clear();
  }

  #add(event: string, sub: Subscription): Unsubscribe {
    let set = this.#subs.get(event);
    if (!set) {
      set = new Set();
      this.#subs.set(event, set);
    }
    set.add(sub);
    return () => set.delete(sub);
  }
}
