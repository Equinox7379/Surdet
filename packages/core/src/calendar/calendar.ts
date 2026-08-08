import type { ExprEnv } from '../runtime/expr-eval.js';
import { evalExprBoolean } from '../runtime/expr-eval.js';

/**
 * 地图日程系统（兰斯式月度回合）。
 * 回合、行动力、大地图节点、据点指令、节点事件，全部由 calendar.json 配置。
 */

/** 大地图节点 */
export interface MapNodeDef {
  id: string;
  name: string;
  /** 位置（渲染层定位） */
  x: number;
  y: number;
  /** 是否据点/可执行指令 */
  isBase?: boolean;
  /** 每次占用行动力 */
  apCost: number;
  /** 进入节点触发的事件 ID */
  eventId?: string;
  /** 出现条件（DSL 布尔表达式，运行时求值） */
  visibleWhen?: string;
  /** 依赖节点（需先访问） */
  requires?: string[];
}

/** 据点指令（在 isBase 节点执行：休息/训练/采购等，兰斯式据点命令） */
export interface BaseCommandDef {
  id: string;
  name: string;
  /** 每次执行消耗的行动力 */
  apCost: number;
  /** 效果：变量增量（写回 ExprEnv 的变量仓库，如 { "lynn.hp": 5 }） */
  effects?: Record<string, number>;
  /** 执行条件（布尔 DSL 表达式；缺省 = 始终可执行） */
  when?: string;
  /** 每回合执行次数上限（缺省 = 不限；回合切换时重置计数） */
  perTurn?: number;
  /** 执行后跳转的事件场景 ID（宿主经 hostJump 消费；缺省 = 无演出直接结算） */
  eventId?: string;
}

/** 据点指令执行结果 */
export interface BaseCommandResult {
  ok: boolean;
  reason?: string;
  /** 触发的演出事件 ID（ok=true 且配置了 eventId） */
  eventId?: string;
  /** 变量增量（ok=true 时宿主写回变量仓库；引擎只扣行动力/计数，不直改宿主变量） */
  effects?: Record<string, number>;
}

/** 日程配置 */
export interface CalendarConfig {
  nodes: MapNodeDef[];
  /** 每个回合行动力上限 */
  maxAp: number;
  /** 回合数上限（-1 = 无限） */
  maxTurns: number;
  /** 每回合回合序事件 */
  onTurnStartEventId?: string;
  onTurnEndEventId?: string;
  /** 游戏内日期命名模板，支持 {turn} {month}，如 "第{month}月 第{turn}周" */
  dateTemplate: string;
  /** 每月周数（month = ceil(turn / weeksPerMonth)） */
  weeksPerMonth?: number;
  /** 据点指令（在 isBase 节点执行；数据驱动） */
  baseCommands?: BaseCommandDef[];
}

/** 日历状态快照（随存档保存） */
export interface CalendarSnapshot {
  turn: number;
  ap: number;
  visited: string[];
  /** 据点指令本回合执行次数（perTurn 限次；旧档无此字段按 0） */
  commandCounts?: Record<string, number>;
}

/** 进入节点的结果 */
export interface EnterNodeResult {
  /** 是否成功进入 */
  ok: boolean;
  /** 失败原因（ok=false） */
  reason?: string;
  /** 触发的事件 ID（ok=true） */
  eventId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 日历运行器：回合/行动力/节点可达性/事件触发。
 * 数据驱动：节点与规则全部来自 CalendarConfig，表达式经 ExprEnv 求值。
 */
export class CalendarRunner {
  #config: CalendarConfig;
  #env: ExprEnv;
  #turn = 1;
  #ap: number;
  #visited = new Set<string>();
  #weeksPerMonth: number;
  /** 据点指令本回合执行次数计数（perTurn 限次用；advanceTurn 重置；随存档持久化） */
  #commandCounts = new Map<string, number>();

  constructor(config: CalendarConfig, env: ExprEnv) {
    this.#config = config;
    this.#env = env;
    this.#ap = config.maxAp;
    this.#weeksPerMonth = config.weeksPerMonth ?? 4;
  }

  get turn(): number {
    return this.#turn;
  }

  get ap(): number {
    return this.#ap;
  }

  get maxAp(): number {
    return this.#config.maxAp;
  }

  get maxTurns(): number {
    return this.#config.maxTurns;
  }

  get isOver(): boolean {
    return this.#config.maxTurns >= 0 && this.#turn > this.#config.maxTurns;
  }

  get month(): number {
    return Math.ceil(this.#turn / this.#weeksPerMonth);
  }

  /** 渲染日期（dateTemplate 渲染 {turn}/{month}） */
  get date(): string {
    return this.#config.dateTemplate
      .replaceAll('{turn}', String(this.#turn))
      .replaceAll('{month}', String(this.month));
  }

  /** 回合开始事件 ID（场景跳转约定：场景 ID = eventId；宿主在地图打开前经 hostJump 触发） */
  get turnStartEventId(): string | undefined {
    return this.#config.onTurnStartEventId;
  }

  /** 回合结束事件 ID（宿主在玩家结束回合、advanceTurn 之前经 hostJump 触发） */
  get turnEndEventId(): string | undefined {
    return this.#config.onTurnEndEventId;
  }

  /** 全部节点 */
  nodes(): MapNodeDef[] {
    return this.#config.nodes;
  }

  /** 当前可见且可达的节点 */
  visibleNodes(): MapNodeDef[] {
    return this.#config.nodes.filter((n) => this.isVisible(n));
  }

  isVisible(node: MapNodeDef): boolean {
    if (node.requires && node.requires.some((req) => !this.#visited.has(req))) return false;
    if (node.visibleWhen) {
      // 严格求值：visibleWhen 失败即抛错（与解释器 @if 一致），暴露配置缺陷
      return evalExprBoolean(node.visibleWhen, this.#env);
    }
    return true;
  }

  hasVisited(nodeId: string): boolean {
    return this.#visited.has(nodeId);
  }

  canEnter(nodeId: string): boolean {
    const node = this.#config.nodes.find((n) => n.id === nodeId);
    if (!node) return false;
    if (this.isOver) return false;
    if (!this.isVisible(node)) return false;
    if (this.#ap < node.apCost) return false;
    return true;
  }

  /** 进入节点：扣行动力、标记访问、返回触发事件（回合超限后拒绝进入） */
  enter(nodeId: string): EnterNodeResult {
    const node = this.#config.nodes.find((n) => n.id === nodeId);
    if (!node) return { ok: false, reason: `节点 '${nodeId}' 不存在` };
    if (this.isOver) return { ok: false, reason: '回合已超限，无法进入节点' };
    if (!this.isVisible(node)) return { ok: false, reason: `节点 '${nodeId}' 不可见/未解锁` };
    if (this.#ap < node.apCost) return { ok: false, reason: '行动力不足' };
    this.#ap -= node.apCost;
    this.#visited.add(nodeId);
    return { ok: true, eventId: node.eventId };
  }

  /** 结束本回合：回合 +1、恢复行动力、重置据点指令本回合计数 */
  advanceTurn(): void {
    this.#turn++;
    this.#ap = this.#config.maxAp;
    this.#commandCounts.clear();
  }

  /** 据点指令定义查询（宿主渲染指令面板用） */
  baseCommands(): BaseCommandDef[] {
    return this.#config.baseCommands ?? [];
  }

  /** 指定据点指令本回合剩余可执行次数（不限次返回 null；未注册返回 null） */
  baseCommandRemaining(id: string): number | null {
    const cmd = this.baseCommands().find((c) => c.id === id);
    if (!cmd || cmd.perTurn === undefined) return null;
    return Math.max(0, cmd.perTurn - (this.#commandCounts.get(id) ?? 0));
  }

  /** 指定据点指令当前是否可执行（行动力/限次/when 条件；未注册返回 false） */
  canExecBaseCommand(id: string): boolean {
    const cmd = this.baseCommands().find((c) => c.id === id);
    if (!cmd || this.isOver) return false;
    if (this.#ap < cmd.apCost) return false;
    if (cmd.perTurn !== undefined && (this.#commandCounts.get(id) ?? 0) >= cmd.perTurn) return false;
    if (cmd.when !== undefined && !evalExprBoolean(cmd.when, this.#env)) return false;
    return true;
  }

  /** 执行据点指令：扣行动力、记次，返回 effects/eventId（宿主写回变量并经 hostJump 演出）。
   *  引擎不直改宿主变量仓库——与 enter() 的分工一致（内核管日程状态，宿主管业务变量）。 */
  execBaseCommand(id: string): BaseCommandResult {
    const cmd = this.baseCommands().find((c) => c.id === id);
    if (!cmd) return { ok: false, reason: `据点指令 '${id}' 未配置` };
    if (this.isOver) return { ok: false, reason: '回合已超限，无法执行指令' };
    if (this.#ap < cmd.apCost) return { ok: false, reason: '行动力不足' };
    if (cmd.perTurn !== undefined && (this.#commandCounts.get(id) ?? 0) >= cmd.perTurn) {
      return { ok: false, reason: '本回合已无法再次执行该指令' };
    }
    // when 条件求值严格策略（与 @if 一致）：配置缺陷尽早暴露
    if (cmd.when !== undefined && !evalExprBoolean(cmd.when, this.#env)) {
      return { ok: false, reason: '执行条件未满足' };
    }
    this.#ap -= cmd.apCost;
    this.#commandCounts.set(id, (this.#commandCounts.get(id) ?? 0) + 1);
    return {
      ok: true,
      ...(cmd.eventId !== undefined ? { eventId: cmd.eventId } : {}),
      ...(cmd.effects && Object.keys(cmd.effects).length > 0 ? { effects: { ...cmd.effects } } : {}),
    };
  }


  snapshot(): CalendarSnapshot {
    return {
      turn: this.#turn,
      ap: this.#ap,
      visited: [...this.#visited],
      commandCounts: Object.fromEntries(this.#commandCounts),
    };
  }

  validateSnapshot(snap: unknown): asserts snap is CalendarSnapshot {
    if (!isRecord(snap)) throw new Error('日历快照必须是对象');
    if (typeof snap.turn !== 'number' || !Number.isInteger(snap.turn) || snap.turn < 1) {
      throw new Error('日历快照 turn 必须是 >= 1 的整数');
    }
    if (typeof snap.ap !== 'number' || !Number.isFinite(snap.ap) || snap.ap < 0 || snap.ap > this.#config.maxAp) {
      throw new Error(`日历快照 ap 必须在 0~${this.#config.maxAp} 范围内`);
    }
    if (!Array.isArray(snap.visited) || snap.visited.some((id) => typeof id !== 'string')) {
      throw new Error('日历快照 visited 必须是字符串数组');
    }
    if (snap.commandCounts !== undefined) {
      if (!isRecord(snap.commandCounts)) throw new Error('日历快照 commandCounts 必须是对象');
      for (const [id, count] of Object.entries(snap.commandCounts)) {
        if (!id || typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
          throw new Error(`日历快照 commandCounts.${id} 非法`);
        }
      }
    }
  }

  restore(snap: CalendarSnapshot): void {
    this.validateSnapshot(snap);
    this.#turn = Math.max(1, snap.turn);
    this.#ap = Math.min(this.#config.maxAp, Math.max(0, snap.ap));
    this.#visited = new Set(snap.visited);
    // 旧档无 commandCounts 按空（当回合计数从零开始，限次指令重新可用）
    this.#commandCounts = new Map(Object.entries(snap.commandCounts ?? {}));
  }
}
