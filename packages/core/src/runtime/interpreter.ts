import type {
  ChoiceInstr,
  CompiledScene,
  GenericInstr,
  SetInstr,
} from '../dsl/ast.js';
import type { SourcePos } from '../dsl/token.js';
import { SourceError } from '../dsl/token.js';
import { evalExprBoolean, evalExprString } from './expr-eval.js';
import type { VariableStore } from '../state/variable-store.js';
import { EventBus, type EventPayload } from './event-bus.js';
import { SceneRegistry } from './scene-registry.js';
import { ReadTracker } from './read-tracker.js';
import { GalleryState } from '../systems/gallery-state.js';
import type { SavePosition, SaveSnapshot, SystemSnapshots } from '../save/save-manager.js';

/**
 * 宿主提供的全家桶系统（日历/战斗/好感/周目）存档钩子。
 * 系统实例由宿主持有并驱动，解释器只在存档/读档时经此收集中转状态。
 */
export interface SystemHooks {
  /** 存档时收集系统状态（必须 JSON 安全） */
  snapshot?: () => SystemSnapshots;
  /** 读档时恢复系统状态 */
  restore?: (snap: SystemSnapshots) => void;
}

/** 运行时状态 */
export type RuntimeStatus = 'idle' | 'running' | 'awaiting-advance' | 'awaiting-choice' | 'ended';

/** text 事件载荷 */
export interface TextEventPayload {
  speaker: string | null;
  value: string;
}

/** choice 事件载荷（options 已按 when 条件过滤，带原始索引供 choose） */
export interface ChoiceEventPayload {
  options: { index: number; label: string }[];
}

/** 通用指令事件载荷（bg/show/voice 等展示类，由渲染层消费） */
export interface InstrEventPayload {
  name: string;
  args: string[];
  modifiers: Map<string, string>;
  pos: SourcePos;
}

/** 运行时错误（带场景/指令位置） */
export class RuntimeError extends SourceError {
  override readonly pos: SourcePos | null;
  constructor(message: string, pos?: SourcePos | null) {
    super(pos ? `${pos.file}:${pos.line}:${pos.col}: ${message}` : message);
    this.name = 'RuntimeError';
    this.pos = pos ?? null;
  }
}

/**
 * 剧本解释器：逐条执行 CompiledScene 指令流，驱动状态系统与事件总线。
 *
 * 阻塞模型：
 *  - text：发 text 事件后挂起（awaiting-advance），由外部 advance() 推进
 *  - choice：发 choice 事件后挂起（awaiting-choice），由外部 choose(index) 选择
 *  - end：置 ended
 * 其余指令（set/mod/condJump/jump/label/instr）同步执行。
 *
 * 事件：'text' | 'choice' | 'instr'（渲染层订阅驱动 UI）。
 */
export class Interpreter {
  #store: VariableStore;
  #bus: EventBus;
  #registry: SceneRegistry;
  #status: RuntimeStatus = 'idle';
  #scene: CompiledScene | null = null;
  #pc = 0;
  #pendingChoice: ChoiceInstr | null = null;
  /** 主循环执行中标志：事件回调内重入推进时置 resume 而非递归 */
  #stepping = false;
  #resumeRequested = false;
  /** CG/音乐解锁状态（存档持久化） */
  readonly gallery: GalleryState;
  /** 已读文本记录（快进跳过用） */
  readonly readTracker: ReadTracker;
  /** 全家桶系统存档钩子（宿主注入） */
  #systemHooks: SystemHooks;

  constructor(
    store: VariableStore,
    bus: EventBus,
    registry: SceneRegistry,
    gallery: GalleryState = new GalleryState(),
    readTracker: ReadTracker = new ReadTracker(),
    systemHooks: SystemHooks = {},
  ) {
    this.#store = store;
    this.#bus = bus;
    this.#registry = registry;
    this.gallery = gallery;
    this.readTracker = readTracker;
    this.#systemHooks = systemHooks;
  }

  get status(): RuntimeStatus {
    return this.#status;
  }

  /** 当前定位（场景 ID + 指令索引），存档/调试用 */
  get position(): { sceneId: string; pc: number } | null {
    return this.#scene ? { sceneId: this.#scene.sceneId, pc: this.#pc } : null;
  }

  /** 启动场景（label 可选，默认场景开头） */
  start(sceneId: string, label?: string): void {
    const { scene, pc } = label !== undefined
      ? this.#registry.resolve(`${sceneId}.${label}`)
      : this.#registry.resolve(sceneId);
    this.#scene = scene;
    this.#pc = pc;
    this.#status = 'running';
    this.#step();
  }

  /** 当前定位（存档用）。
   *  文本挂起时 pc 已指向下一指令，存档应回退到"当前显示行"；选择肢挂起时 pc 即 choice 指令。 */
  savePosition(): SavePosition | null {
    if (!this.#scene) return null;
    const pc = this.#status === 'awaiting-advance' ? this.#pc - 1 : this.#pc;
    return { sceneId: this.#scene.sceneId, pc };
  }

  /** 完整存档快照（变量 + 定位 + 已读 + 解锁 + 全家桶系统状态）。未运行/空闲时返回 null。
   *  kind 用于标记手动/快速/自动存档（默认 manual，宿主可覆盖）。 */
  saveSnapshot(kind: SaveSnapshot['kind'] = 'manual'): SaveSnapshot | null {
    if (!this.#scene || this.#status === 'idle') return null;
    const position = this.savePosition();
    if (!position) return null;
    const systems = this.#systemHooks.snapshot?.();
    return {
      meta: {
        id: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        chapter: position.sceneId,
      },
      variables: this.#store.snapshot(),
      position,
      kind,
      readSet: this.readTracker.snapshot(),
      gallery: this.gallery.snapshot(),
      ...(systems ? { systems } : {}),
    };
  }

  /** 从快照恢复：变量/已读/解锁 + 全家桶系统状态 + 定位到挂起点并重新驱动到挂起状态。
   *  注意：须在 UI 线程（非事件回调）调用，事件回调内调用会撞 #stepping 重入守卫。 */
  loadSnapshot(snap: SaveSnapshot): void {
    this.#store.restore(snap.variables);
    this.readTracker.restore(snap.readSet);
    this.gallery.restore(snap.gallery);
    if (snap.systems) this.#systemHooks.restore?.(snap.systems);
    this.#pendingChoice = null;
    if (!snap.position) {
      this.#scene = null;
      this.#pc = 0;
      this.#status = 'idle';
      return;
    }
    const scene = this.#registry.get(snap.position.sceneId);
    this.#scene = scene;
    const max = Math.max(0, scene.instructions.length - 1);
    this.#pc = Math.min(Math.max(0, snap.position.pc), max);
    this.#status = 'running';
    this.#step(); // 重新挂起到当前指令（text/choice 会重新发出事件）
  }

  /** 文本暂停后推进到下一行。事件回调内调用时走迭代续跑，断开递归。 */
  advance(): void {
    this.#requireStatus('awaiting-advance', 'advance()');
    this.#status = 'running';
    if (this.#stepping) {
      this.#resumeRequested = true;
      return;
    }
    this.#step();
  }

  /** 选择肢：index 为 choice 事件载荷中的原始选项索引。事件回调内调用走迭代续跑。 */
  choose(index: number): void {
    this.#requireStatus('awaiting-choice', 'choose()');
    const choice = this.#pendingChoice!;
    const opt = choice.options[index];
    if (!opt) {
      throw new RuntimeError(`选项索引 ${index} 越界或不可用`);
    }
    // 复查 when 条件：防止绕过渲染层过滤直接选中隐藏选项
    if (opt.when !== null && !evalExprBoolean(opt.when, this.#store)) {
      throw new RuntimeError(`选项 ${index}（${opt.label}）的条件未满足，无法选择`, opt.pos);
    }
    this.#pendingChoice = null;
    this.#pc = opt.blockStart;
    this.#status = 'running';
    if (this.#stepping) {
      this.#resumeRequested = true;
      return;
    }
    this.#step();
  }

  /** 主循环入口：标记执行中，跑迭代循环 */
  #step(): void {
    if (this.#stepping) {
      throw new RuntimeError('解释器重入：不应在事件回调外直接触发 #step');
    }
    this.#stepping = true;
    try {
      this.#runLoop();
    } finally {
      this.#stepping = false;
    }
  }

  /** 迭代主循环：顺序执行直到挂起/结束。事件回调内推进通过 resume 续跑。
   *  单次同步爆发设置步数上限，防止 @goto/@if 无挂起点导致死循环冻结 UI。 */
  #runLoop(): void {
    const MAX_SYNC_STEPS = 100_000;
    let steps = 0;
    for (;;) {
      if (!this.#scene) {
        this.#status = 'ended';
        return;
      }
      const instr = this.#scene.instructions[this.#pc];
      if (!instr) {
        // 指令流意外耗尽（理论上 end 指令保证不会发生）
        this.#status = 'ended';
        return;
      }

      steps++;
      if (steps > MAX_SYNC_STEPS) {
        throw new RuntimeError(
          `检测到疑似死循环：连续同步执行超过 ${MAX_SYNC_STEPS} 步。` +
            '检查 @goto/@if/@choice 是否缺少文本/选择肢等挂起点',
          instr,
        );
      }

      try {
        switch (instr.op) {
          case 'label':
            this.#pc++;
            break;

          case 'text': {
            // 先置挂起状态再发事件：回调内可直接 advance()
            this.#pc++;
            this.#status = 'awaiting-advance';
            // 用指令索引作为已读 key：避免同场景两条相同文本行被合并为一条已读记录
            this.readTracker.mark(`${this.#scene!.sceneId}#${instr.index}`);
            this.#resumeRequested = false;
            this.#bus.emit('text', {
              speaker: instr.speaker,
              value: interpolate(instr.value, this.#store),
            });
            if (this.#resumeRequested) {
              this.#resumeRequested = false;
              this.#status = 'running';
              continue; // 迭代续跑，而非递归
            }
            return;
          }

          case 'set': {
            this.#execSet(instr);
            this.#pc++;
            break;
          }

          case 'modify': {
            this.#store.modify(instr.varName, instr.delta);
            this.#pc++;
            break;
          }

          case 'condJump': {
            const cond = evalExprBoolean(instr.expr, this.#store);
            this.#pc = cond ? this.#pc + 1 : instr.target;
            break;
          }

          case 'jump': {
            if (instr.kind === 'goto') {
              if (instr.gotoIndex === null) {
                throw new RuntimeError(`未解析的 goto 目标 '${instr.target}'`, instr);
              }
              this.#pc = instr.gotoIndex;
            } else {
              const { scene, pc } = this.#registry.resolve(instr.target);
              this.#scene = scene;
              this.#pc = pc;
            }
            break;
          }

          case 'choice': {
            const available = instr.options
              .map((o, i) => ({ o, i }))
              .filter(({ o }) => o.when === null || evalExprBoolean(o.when, this.#store))
              .map(({ o, i }) => ({ index: i, label: o.label }));

            if (available.length === 0) {
              // 无可用选项：落到 choice 之后继续
              this.#pc = instr.afterIndex;
              break;
            }

            // 先置挂起状态再发事件：回调内可直接 choose()
            this.#pendingChoice = instr;
            this.#status = 'awaiting-choice';
            this.#resumeRequested = false;
            this.#bus.emit('choice', { options: available });
            if (this.#resumeRequested) {
              this.#resumeRequested = false;
              this.#status = 'running';
              continue; // 迭代续跑
            }
            return;
          }

          case 'end': {
            this.#status = 'ended';
            return;
          }

          case 'instr': {
            this.#execGeneric(instr);
            this.#pc++;
            break;
          }
        }
      } catch (err) {
        // 统一运行时错误定位：非 RuntimeError 包成带指令位置的 RuntimeError
        if (err instanceof RuntimeError) throw err;
        throw new RuntimeError(
          err instanceof Error ? err.message : String(err),
          { file: instr.file, line: instr.line, col: instr.col },
        );
      }
    }
  }

  /** @set：= 直接赋值；+=/-= 数值增减 */
  #execSet(instr: SetInstr): void {
    if (instr.setOp === '=' || instr.setOp === ':=') {
      this.#store.set(instr.varName, evalExprString(instr.expr, this.#store));
      return;
    }
    const value = evalExprString(instr.expr, this.#store);
    if (typeof value !== 'number') {
      throw new RuntimeError(`@set ${instr.setOp === '+=' ? '+=' : '-='} 要求表达式结果为 number，得到 ${typeof value}`, instr);
    }
    this.#store.modify(instr.varName, instr.setOp === '+=' ? value : -value);
  }

  /** 通用指令分派：状态类直改 store；其余发事件给渲染层 */
  #execGeneric(instr: GenericInstr): void {
    const name = instr.name;
    const arg0 = instr.args[0];

    switch (name) {
      case 'inc': {
        requireArg(instr, arg0, '@inc');
        this.#store.inc(arg0!);
        return;
      }
      case 'dec': {
        requireArg(instr, arg0, '@dec');
        this.#store.dec(arg0!);
        return;
      }
      case 'toggle': {
        requireArg(instr, arg0, '@toggle');
        this.#store.toggle(arg0!);
        return;
      }
      case 'flag': {
        requireArg(instr, arg0, '@flag');
        this.#store.set(arg0!, true);
        return;
      }
      case 'unflag': {
        requireArg(instr, arg0, '@unflag');
        this.#store.set(arg0!, false);
        return;
      }
      case 'unlock_cg': {
        requireArg(instr, arg0, '@unlock_cg');
        const fresh = this.gallery.unlockCg(arg0!);
        this.#bus.emit('gallery', { type: 'cg', id: arg0, fresh });
        return;
      }
      case 'unlock_music': {
        requireArg(instr, arg0, '@unlock_music');
        const fresh = this.gallery.unlockMusic(arg0!);
        this.#bus.emit('gallery', { type: 'music', id: arg0, fresh });
        return;
      }
      case 'autosave': {
        // 存档点：发当前完整快照给宿主，由宿主写入自动存档槽位。
        // position 前移一位指向下一条指令：autosave 本身无状态副作用，读档后不应重跑它
        // （否则会重复触发 autosave 事件，宿主重复写档）。
        const snap = this.saveSnapshot('auto');
        if (snap) {
          if (snap.position) {
            snap.position = { sceneId: snap.position.sceneId, pc: snap.position.pc + 1 };
          }
          this.#bus.emit('autosave', snap as unknown as EventPayload);
        }
        return;
      }
      case 'savepoint': {
        // 手动检查点：发当前完整快照给宿主（可写入手动槽位或覆盖检查点）。position 语义同上。
        const snap = this.saveSnapshot('manual');
        if (snap) {
          if (snap.position) {
            snap.position = { sceneId: snap.position.sceneId, pc: snap.position.pc + 1 };
          }
          this.#bus.emit('savepoint', snap as unknown as EventPayload);
        }
        return;
      }
      case 'battle':
      case 'calendar':
      case 'affection':
      case 'event':
      case 'shop':
      case 'item': {
        // 大系统指令：交给宿主（游戏逻辑层）用对应 System 类驱动
        this.#bus.emit('system', {
          type: name,
          args: instr.args,
          modifiers: instr.modifiers,
          pos: { file: instr.file, line: instr.line, col: instr.col },
        });
        return;
      }
      default:
        this.#bus.emit('instr', {
          name,
          args: instr.args,
          modifiers: instr.modifiers,
          pos: { file: instr.file, line: instr.line, col: instr.col },
        });
    }
  }

  #requireStatus(expected: RuntimeStatus, action: string): void {
    if (this.#status !== expected) {
      throw new RuntimeError(`${action} 当前状态为 ${this.#status}（期望 ${expected}）`);
    }
  }
}

/** 文本插值：{var} → 变量值；未声明变量保留原文。
 *  支持转义：{{ → {、}} → }（用于输出字面花括号）。 */
export function interpolate(text: string, store: VariableStore): string {
  return text.replace(/\{\{|\}\}|\{([A-Za-z0-9_$.\u0080-\uffff]+)\}/g, (match, name: string | undefined) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    return store.has(name!) ? String(store.get(name!)) : `{${name}}`;
  });
}

function requireArg(instr: GenericInstr, arg: string | undefined, usage: string): void {
  if (arg === undefined) {
    throw new RuntimeError(`${usage} 缺少变量参数`, instr);
  }
}

export type { CompiledScene };
