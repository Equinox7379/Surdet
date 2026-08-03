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
}

/** 日历状态快照（随存档保存） */
export interface CalendarSnapshot {
  turn: number;
  ap: number;
  visited: string[];
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
    if (!this.isVisible(node)) return false;
    if (this.#ap < node.apCost) return false;
    return true;
  }

  /** 进入节点：扣行动力、标记访问、返回触发事件 */
  enter(nodeId: string): EnterNodeResult {
    const node = this.#config.nodes.find((n) => n.id === nodeId);
    if (!node) return { ok: false, reason: `节点 '${nodeId}' 不存在` };
    if (!this.isVisible(node)) return { ok: false, reason: `节点 '${nodeId}' 不可见/未解锁` };
    if (this.#ap < node.apCost) return { ok: false, reason: '行动力不足' };
    this.#ap -= node.apCost;
    this.#visited.add(nodeId);
    return { ok: true, eventId: node.eventId };
  }

  /** 结束本回合：回合 +1、恢复行动力 */
  advanceTurn(): void {
    this.#turn++;
    this.#ap = this.#config.maxAp;
  }

  /** 结束回合序事件 ID（供调用方触发回合头/尾事件） */
  get onTurnStartEventId(): string | undefined {
    return this.#config.onTurnStartEventId;
  }

  get onTurnEndEventId(): string | undefined {
    return this.#config.onTurnEndEventId;
  }

  snapshot(): CalendarSnapshot {
    return { turn: this.#turn, ap: this.#ap, visited: [...this.#visited] };
  }

  restore(snap: CalendarSnapshot): void {
    this.#turn = Math.max(1, snap.turn);
    this.#ap = Math.min(this.#config.maxAp, Math.max(0, snap.ap));
    this.#visited = new Set(snap.visited);
  }
}
