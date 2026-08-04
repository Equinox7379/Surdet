import type {
  ChoiceInstr,
  CompiledScene,
  GenericInstr,
  SetInstr,
  SwitchInstr,
} from '../dsl/ast.js';
import type { SourcePos } from '../dsl/token.js';
import { SourceError } from '../dsl/token.js';
import { evalExprBoolean, evalExprString } from './expr-eval.js';
import type { VariableStore } from '../state/variable-store.js';
import { EventBus, type EventMap } from './event-bus.js';
import { SceneRegistry } from './scene-registry.js';
import { ReadTracker } from './read-tracker.js';
import { GalleryState } from '../systems/gallery-state.js';
import type { SavePosition, SaveSnapshot, SystemSnapshots } from '../save/save-manager.js';
import { SAVE_SCHEMA_VERSION, assertValidSnapshot } from '../save/save-manager.js';
import { migrateSnapshot } from '../save/migrate.js';
import { ClearTracker } from '../systems/clear-tracker.js';
import type { GrowthResult, GrowthSystem } from '../systems/growth.js';

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

/** 运行时状态。paused = 宿主暂停（如交互式战斗进行中），resumeHost() 恢复 */
export type RuntimeStatus = 'idle' | 'running' | 'awaiting-advance' | 'awaiting-choice' | 'awaiting-timer' | 'paused' | 'ended';

/** @call 最大嵌套深度（同步死循环检测兜底之前，先给出更明确的错误） */
const MAX_CALL_DEPTH = 64;

/** text 事件载荷 */
export interface TextEventPayload {
  speaker: string | null;
  value: string;
  /** 该文本在本次发出前是否已读过（快进"遇未读即停"用；渲染层仅在 false 时停）。
   *  可选：解释器始终提供；宿主/测试直发事件可省略（渲染层按 undefined 兼容处理） */
  wasRead?: boolean;
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

/** system 指令事件载荷（@battle/@calendar/@affection/@event/@shop/@item 转发宿主驱动） */
export interface SystemEventPayload {
  type: string;
  args: string[];
  modifiers: Map<string, string>;
  pos: SourcePos;
}

/** 解释器事件映射：EventBus 各事件的载荷类型，订阅/发射端自动推导，宿主接线无需断言 */
export interface CoreEventMap extends EventMap {
  text: TextEventPayload;
  choice: ChoiceEventPayload;
  instr: InstrEventPayload;
  system: SystemEventPayload;
  /** @wait 阻塞等待：宿主按 ms 计时后调 finishWait() 恢复（玩家 advance 可跳过） */
  wait: { ms: number };
  /** @video 阻塞播放：宿主播放结束（或玩家点击跳过）后调 finishWait() 恢复 */
  video: { src: string };
  gallery: { type: 'cg' | 'music' | 'text'; id: string; fresh: boolean };
  /** @clear 周目通关：ending = 结局标识（缺省为当前场景 ID）；fresh = 首次达成 */
  clear: { ending: string; fresh: boolean };
  /** @exp 角色成长：levelsGained > 0 时宿主可播放升级演出/触发 levelEvents */
  growth: GrowthResult;
  autosave: SaveSnapshot;
  savepoint: SaveSnapshot;
  sceneEnd: { sceneId: string };
  /** 存档场景哈希与当前场景不一致：存档后剧本被编辑，pc 定位可能漂移（仍继续加载，仅告警） */
  saveMismatch: { sceneId: string; expected: string; actual: string };
  /** 读档完成、新指令流启动前广播：渲染层/宿主据此作废等待计时、关闭覆盖层（审计修复 C1/M1） */
  stateReset: { reason: 'load' };
  /** 旧档在读档前已迁移到当前 schema（宿主可记录日志；自我迭代③） */
  saveMigrated: { from: number; to: number };
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
  #bus: EventBus<CoreEventMap>;
  #registry: SceneRegistry;
  #status: RuntimeStatus = 'idle';
  #scene: CompiledScene | null = null;
  #pc = 0;
  #pendingChoice: ChoiceInstr | null = null;
  /** @call 子场景调用栈（返回点序列，栈顶在末尾；随存档持久化） */
  #callStack: SavePosition[] = [];
  /** 主循环执行中标志：事件回调内重入推进时置 resume 而非递归 */
  #stepping = false;
  #resumeRequested = false;
  /** 宿主暂停标志（交互式战斗等宿主接管期间冻结指令流） */
  #hostPaused = false;
  /** hostJump 已在事件回调内重设 pc：主循环跳过本次的 pc++（避免覆盖跳转目标） */
  #jumpOverride = false;
  /** CG/音乐解锁状态（存档持久化） */
  readonly gallery: GalleryState;
  /** 已读文本记录（快进跳过用） */
  readonly readTracker: ReadTracker;
  /** 通关记录（@clear 结局收集；随存档持久化） */
  readonly clearTracker: ClearTracker;
  /** 角色成长系统（@exp 驱动；可选注入，随存档持久化 levels/experience） */
  #growth: GrowthSystem | null;
  /** 全家桶系统存档钩子（宿主注入） */
  #systemHooks: SystemHooks;

  constructor(
    store: VariableStore,
    bus: EventBus<CoreEventMap>,
    registry: SceneRegistry,
    gallery: GalleryState = new GalleryState(),
    readTracker: ReadTracker = new ReadTracker(),
    systemHooks: SystemHooks = {},
    clearTracker: ClearTracker = new ClearTracker(),
    growth: GrowthSystem | null = null,
  ) {
    this.#store = store;
    this.#bus = bus;
    this.#registry = registry;
    this.gallery = gallery;
    this.readTracker = readTracker;
    this.#systemHooks = systemHooks;
    this.clearTracker = clearTracker;
    this.#growth = growth;
  }

  /** 注入成长系统（宿主在构造后延迟配置时；重复注入替换旧实例） */
  setGrowth(growth: GrowthSystem | null): void {
    this.#growth = growth;
  }

  /** 成长系统只读访问（宿主展示等级/经验条用） */
  get growth(): GrowthSystem | null {
    return this.#growth;
  }

  get status(): RuntimeStatus {
    return this.#status;
  }

  /** 当前定位（场景 ID + 指令索引），存档/调试用 */
  get position(): { sceneId: string; pc: number } | null {
    return this.#scene ? { sceneId: this.#scene.sceneId, pc: this.#pc } : null;
  }

  /** 启动场景（label 可选，默认场景开头）。
   *  支持在事件回调内调用（如 sceneEnd 回调里"结局→返回标题"）：延迟到当前迭代结束后重启。 */
  start(sceneId: string, label?: string): void {
    const { scene, pc } = label !== undefined
      ? this.#registry.resolve(`${sceneId}.${label}`)
      : this.#registry.resolve(sceneId);
    // 清理残留状态（防御：若之前卡在 awaiting-choice，重新 start 不应悬挂旧 choice）
    this.#pendingChoice = null;
    this.#hostPaused = false;
    this.#jumpOverride = false;
    this.#callStack = [];
    this.#scene = scene;
    this.#pc = pc;
    this.#status = 'running';
    if (this.#stepping) {
      this.#resumeRequested = true;
      return;
    }
    this.#step();
  }

  /** 当前定位（存档用）。
   *  文本/wait 挂起时 pc 已指向下一指令，存档回退到当前指令（读档重放）；选择肢挂起时 pc 即 choice 指令。 */
  savePosition(): SavePosition | null {
    return this.#currentSavePosition().position;
  }

  /** 当前定位 + 场景源码哈希（saveSnapshot 随档保存，loadSnapshot 校验不匹配发 saveMismatch） */
  #currentSavePosition(): { position: SavePosition | null; hash: string | undefined } {
    if (!this.#scene) return { position: null, hash: undefined };
    const suspended = this.#status === 'awaiting-advance' || this.#status === 'awaiting-timer';
    const pc = suspended ? this.#pc - 1 : this.#pc;
    return { position: { sceneId: this.#scene.sceneId, pc }, hash: this.#scene.sceneHash };
  }

  /** 完整存档快照（变量 + 定位 + 已读 + 解锁 + 全家桶系统状态）。未运行/空闲时返回 null。
   *  kind 用于标记手动/快速/自动存档（默认 manual，宿主可覆盖）。 */
  saveSnapshot(kind: SaveSnapshot['kind'] = 'manual'): SaveSnapshot | null {
    if (!this.#scene || this.#status === 'idle') return null;
    const { position, hash } = this.#currentSavePosition();
    if (!position) return null;
    if (hash !== undefined) position.sceneHash = hash;
    const systems = this.#systemHooks.snapshot?.();
    const now = Date.now();
    return {
      meta: {
        id: '',
        createdAt: now,
        updatedAt: now,
        chapter: position.sceneId,
        // 载荷自带版本：宿主直写档（不经 SaveManager）时 loadSnapshot 的版本校验仍生效
        schemaVersion: SAVE_SCHEMA_VERSION,
        // label/thumbnail/playTimeSec 由宿主按槽位元信息补充（引擎无法获知）
      },
      variables: this.#store.snapshot(),
      position,
      callStack: [...this.#callStack],
      kind,
      readSet: this.readTracker.snapshot(),
      gallery: this.gallery.snapshot(),
      clears: this.clearTracker.snapshot(),
      ...(this.#growth ? { growth: this.#growth.snapshot() } : {}),
      ...(systems ? { systems } : {}),
    };
  }

  /** 从快照恢复：变量/已读/解锁 + 全家桶系统状态 + 定位到挂起点并重新驱动到挂起状态。
   *  注意：须在 UI 线程（非事件回调）调用，事件回调内调用会撞 #stepping 重入守卫。 */
  loadSnapshot(snap: SaveSnapshot): void {
    // 深度结构校验：篡改/损坏存档在读档入口即拒绝（而非解释器执行中途爆炸）
    try {
      assertValidSnapshot(snap);
    } catch (err) {
      throw new RuntimeError(err instanceof Error ? err.message : String(err));
    }
    const version = snap.meta?.schemaVersion;
    if (version !== undefined && version > SAVE_SCHEMA_VERSION) {
      throw new RuntimeError(
        `存档 schema 版本 ${version} 高于引擎支持的 ${SAVE_SCHEMA_VERSION}（引擎升级导致的旧档不兼容，请迁移或回退）`,
      );
    }
    // schema 迁移管线（自我迭代③）：旧档先逐级升到当前版本，后续逻辑统一使用迁移后快照
    if (version === undefined || version < SAVE_SCHEMA_VERSION) {
      const migrated = migrateSnapshot(snap, SAVE_SCHEMA_VERSION);
      if (migrated !== null) {
        this.#bus.emit('saveMigrated', { from: version ?? 1, to: SAVE_SCHEMA_VERSION });
        snap = migrated as unknown as SaveSnapshot;
      }
    }
    this.#store.restore(snap.variables, { allowReadonly: true }); // 可信快照：readonly 系统变量随档恢复
    this.readTracker.restore(snap.readSet);
    this.gallery.restore(snap.gallery);
    this.clearTracker.restore(snap.clears); // 旧档无 clears 字段按未通关
    if (snap.growth && this.#growth) this.#growth.restore(snap.growth); // 旧档无 growth 按初始等级
    if (snap.systems) this.#systemHooks.restore?.(snap.systems);
    this.#pendingChoice = null;
    // v1 旧档无 callStack 字段 → 按空栈加载（@call 引入前的存档不受影响）
    this.#callStack = snap.callStack ? [...snap.callStack] : [];
    // 读档状态重置（审计修复 C1/M1）：置于 position 早退分支之前，保证退化路径同样闭合（审计复核补全）
    this.#hostPaused = false;
    this.#jumpOverride = false;
    this.#bus.emit('stateReset', { reason: 'load' });
    if (!snap.position) {
      this.#scene = null;
      this.#pc = 0;
      this.#status = 'idle';
      return;
    }
    const scene = this.#sceneOrRuntimeError(snap.position.sceneId, `存档指向的场景 '${snap.position.sceneId}' 未注册（剧本可能已重构或该场景被移除）`);
    // 场景哈希校验：存档后剧本被编辑 → pc 定位可能指向错误指令。
    // 仍按原定位加载（下方 clamp 到合法范围），但发 saveMismatch 供宿主提示玩家。
    // 旧档无 sceneHash（schema ≤ v2）或场景无哈希时跳过校验。
    const expectedHash = snap.position.sceneHash;
    const actualHash = scene.sceneHash;
    if (expectedHash !== undefined && actualHash !== undefined && expectedHash !== actualHash) {
      this.#bus.emit('saveMismatch', {
        sceneId: scene.sceneId,
        expected: expectedHash,
        actual: actualHash,
      });
    }
    this.#scene = scene;
    const max = Math.max(0, scene.instructions.length - 1);
    this.#pc = Math.min(Math.max(0, snap.position.pc), max);
    this.#status = 'running';
    this.#step(); // 重新挂起到当前指令（text/choice/wait 会重新发出事件）
  }

  /** 文本暂停后推进到下一行。事件回调内调用时走迭代续跑，断开递归。
   *  wait 挂起时调用等价于跳过剩余等待（galgame 惯例：点击可跳过等待）。 */
  advance(): void {
    // 宿主暂停中（如战斗进行中）：点击无效但不报错——画布点击是全局的，不应打扰宿主 UI
    if (this.#status === 'paused') return;
    if (this.#status === 'awaiting-timer') {
      this.finishWait();
      return;
    }
    this.#requireStatus('awaiting-advance', 'advance()');
    this.#status = 'running';
    if (this.#stepping) {
      this.#resumeRequested = true;
      return;
    }
    this.#step();
  }

  /** @wait 计时结束（宿主定时器回调调用）：恢复指令流执行。事件回调内调用走迭代续跑。 */
  finishWait(): void {
    this.#requireStatus('awaiting-timer', 'finishWait()');
    this.#status = 'running';
    if (this.#stepping) {
      this.#resumeRequested = true;
      return;
    }
    this.#step();
  }

  /** 宿主暂停：冻结指令流（交互式战斗等宿主接管剧情的场景）。
   *  通常在 system 事件回调内调用（解释器正在 stepping）：当前指令结束后主循环即停，
   *  状态置 paused；其间 advance()/choose() 等推进一律无效（见各自的状态守卫）。 */
  pauseHost(): void {
    this.#hostPaused = true;
    if (!this.#stepping && this.#status === 'running') {
      this.#status = 'paused';
    }
  }

  /** 宿主恢复：继续执行被暂停的指令流（战斗结束等时机调用） */
  resumeHost(): void {
    if (!this.#hostPaused) return;
    this.#hostPaused = false;
    if (this.#status !== 'paused') return;
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
      throw new RuntimeError(
        '解释器重入：当前正处在事件回调执行中，不应直接触发 #step/' +
          'loadSnapshot 等操作，请改在 UI 线程（非事件回调）调用',
      );
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
      // 宿主暂停：system 事件回调内调 pauseHost() 后，当前指令执行完即冻结指令流
      if (this.#hostPaused) {
        this.#status = 'paused';
        return;
      }
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
            // 用指令索引作为已读 key：避免同场景两条相同文本行被合并为一条已读记录。
            // wasRead 须在 mark 之前查询：渲染层快进"遇未读即停"据此判断（false = 首次播放）。
            const readKey = `${this.#scene!.sceneId}#${instr.index}`;
            const wasRead = this.readTracker.has(readKey);
            this.readTracker.mark(readKey);
            this.#resumeRequested = false;
            this.#bus.emit('text', {
              speaker: instr.speaker === null ? null : interpolate(instr.speaker, this.#store),
              value: interpolate(instr.value, this.#store),
              wasRead,
            });
            if (this.#jumpOverride) {
              // hostJump 在 text 事件回调内被调用（审计修复 M2）：场景/pc 已重置，不挂起，从新定位续跑
              this.#jumpOverride = false;
              this.#status = 'running';
              continue;
            }
            if (this.#resumeRequested) {
              this.#resumeRequested = false;
              this.#status = 'running';
              continue; // 迭代续跑，而非递归
            }
            return;
          }

          case 'wait': {
            // 阻塞等待：先置挂起状态再发事件（回调内可直接 advance/finishWait）。
            // 与 text 相同：pc 已前移，存档定位回退到 wait 指令，读档重新计时。
            this.#pc++;
            this.#status = 'awaiting-timer';
            this.#resumeRequested = false;
            this.#bus.emit('wait', { ms: instr.ms });
            if (this.#jumpOverride) {
              this.#jumpOverride = false; // hostJump 回调重入（审计修复 M2）
              this.#status = 'running';
              continue;
            }
            if (this.#resumeRequested) {
              this.#resumeRequested = false;
              this.#status = 'running';
              continue; // 迭代续跑
            }
            return;
          }

          case 'video': {
            // 阻塞视频：与 @wait 同挂起语义（awaiting-timer），宿主播放结束调 finishWait。
            this.#pc++;
            this.#status = 'awaiting-timer';
            this.#resumeRequested = false;
            this.#bus.emit('video', { src: instr.src });
            if (this.#jumpOverride) {
              this.#jumpOverride = false; // hostJump 回调重入（审计修复 M2）
              this.#status = 'running';
              continue;
            }
            if (this.#resumeRequested) {
              this.#resumeRequested = false;
              this.#status = 'running';
              continue;
            }
            return;
          }

          case 'switch': {
            this.#execSwitch(instr);
            break;
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

          case 'call': {
            // @call：压入返回点（当前场景的下一条指令）并跳转目标场景
            if (this.#callStack.length >= MAX_CALL_DEPTH) {
              throw new RuntimeError(
                `@call 嵌套深度超过 ${MAX_CALL_DEPTH}（检查子场景是否互相 @call 且缺少挂起点）`,
                instr,
              );
            }
            const { scene, pc } = this.#registry.resolve(instr.target);
            this.#callStack.push({ sceneId: this.#scene!.sceneId, pc: this.#pc + 1 });
            this.#scene = scene;
            this.#pc = pc;
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
            if (this.#jumpOverride) {
              this.#jumpOverride = false; // hostJump 回调重入（审计修复 M2）
              this.#status = 'running';
              continue;
            }
            if (this.#resumeRequested) {
              this.#resumeRequested = false;
              this.#status = 'running';
              continue; // 迭代续跑
            }
            return;
          }

          case 'end': {
            // @return / 场景自然结束：调用栈非空时返回栈顶返回点（子场景调用返回），
            // 不发 sceneEnd——那只在真正的场景/游戏结束（栈空）时发出。
            const ret = this.#callStack.pop();
            if (ret) {
              const caller = this.#sceneOrRuntimeError(ret.sceneId, `@call 返回点场景 '${ret.sceneId}' 未注册（读档后剧本可能已重构）`);
              this.#scene = caller;
              this.#pc = Math.min(Math.max(0, ret.pc), Math.max(0, caller.instructions.length - 1));
              break;
            }
            this.#status = 'ended';
            // 场景/游戏结束事件：宿主可接结局演出、ED、返回标题画面。
            // 回调内可调用 start()（经 #resumeRequested 延迟重启，见 start 的 #stepping 分支）。
            this.#resumeRequested = false;
            this.#bus.emit('sceneEnd', { sceneId: this.#scene.sceneId });
            if (this.#jumpOverride) {
              this.#jumpOverride = false; // hostJump 回调重入（审计修复 M2）
              this.#status = 'running';
              continue;
            }
            if (this.#resumeRequested) {
              this.#resumeRequested = false;
              this.#status = 'running';
              continue; // start() 已设置新场景，继续执行
            }
            return;
          }

          case 'instr': {
            this.#execGeneric(instr);
            // hostJump 在事件回调内已重设 pc 时不再自增（否则跳过目标指令）
            if (this.#jumpOverride) {
              this.#jumpOverride = false;
            } else {
              this.#pc++;
            }
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

  /** @switch：按变量值匹配 值:标签 跳转；数值变量与可转数值条目做数值比较，其余按字符串比较 */
  #execSwitch(instr: SwitchInstr): void {
    const v = this.#store.getRef(instr.varName);
    const matched = instr.cases.find((c) => {
      if (typeof v === 'number' && Number.isFinite(Number(c.value))) return v === Number(c.value);
      return String(v) === c.value;
    });
    if (!matched) {
      this.#pc++; // 无匹配 → 落到下一条
      return;
    }
    const target = this.#scene!.labels.get(matched.label);
    if (target === undefined) {
      throw new RuntimeError(`@switch 跳转目标 '@label ${matched.label}' 不存在（检查拼写）`, instr);
    }
    this.#pc = target;
  }

  /** 宿主跳转：宿主暂停期间（如地图节点事件）直接切换目标场景并恢复指令流。
   *  语义等同 start（清空调用栈），但可在 pauseHost 状态下调用。 */
  hostJump(sceneId: string, label?: string): void {
    const { scene, pc } = label !== undefined
      ? this.#registry.resolve(`${sceneId}.${label}`)
      : this.#registry.resolve(sceneId);
    this.#pendingChoice = null;
    this.#callStack = [];
    this.#hostPaused = false;
    this.#scene = scene;
    this.#pc = pc;
    this.#status = 'running';
    if (this.#stepping) {
      // 事件回调内调用：主循环将在当前指令后继续，跳过其 pc++（目标 pc 已精确设定）
      this.#jumpOverride = true;
      return;
    }
    this.#step();
  }

  /** @set：= 与 := 为同义赋值（规范约定 := 仅作书写风格别名，无语义差异）；+=/-= 数值增减 */
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
      case 'check': {
        // @check expr：剧本断言，条件为假即抛运行时错误（尽早暴露剧本逻辑缺陷）
        const expr = instr.args.join(' ');
        if (expr.length === 0) throw new RuntimeError('@check 缺少条件表达式', instr);
        if (!evalExprBoolean(expr, this.#store)) {
          throw new RuntimeError(`@check 断言失败：'${expr}' 为假`, instr);
        }
        return;
      }
      case 'random': {
        // @random varName min max：写入 [min, max] 闭区间随机整数
        const [varName, minRaw, maxRaw] = instr.args;
        const min = Number(minRaw);
        const max = Number(maxRaw);
        if (varName === undefined || !Number.isInteger(min) || !Number.isInteger(max) || min > max) {
          throw new RuntimeError('@random 用法：@random 变量 min max（整数且 min ≤ max）', instr);
        }
        this.#store.set(varName, min + Math.floor(Math.random() * (max - min + 1)));
        return;
      }
      case 'add_item': {
        // @add_item arrayVar itemId：string[] 变量去重追加
        const [vn, item] = instr.args;
        if (vn === undefined || item === undefined) throw new RuntimeError('@add_item 用法：@add_item 数组变量 道具ID', instr);
        const arr = this.#store.get<string[]>(vn);
        if (!arr.includes(item)) arr.push(item);
        this.#store.set(vn, arr);
        return;
      }
      case 'remove_item': {
        // @remove_item arrayVar itemId：string[] 变量移除（不存在时无副作用）
        const [vn, item] = instr.args;
        if (vn === undefined || item === undefined) throw new RuntimeError('@remove_item 用法：@remove_item 数组变量 道具ID', instr);
        this.#store.set(vn, this.#store.get<string[]>(vn).filter((x) => x !== item));
        return;
      }
      case 'has_item': {
        // @has_item arrayVar itemId resultVar：结果写入 boolean 变量
        const [vn, item, resultVar] = instr.args;
        if (vn === undefined || item === undefined || resultVar === undefined) {
          throw new RuntimeError('@has_item 用法：@has_item 数组变量 道具ID 结果变量', instr);
        }
        this.#store.set(resultVar, this.#store.get<string[]>(vn).includes(item));
        return;
      }
      case 'unlock_cg': {
        requireArg(instr, arg0, '@unlock_cg');
        const fresh = this.gallery.unlockCg(arg0!);
        this.#bus.emit('gallery', { type: 'cg', id: arg0!, fresh });
        return;
      }
      case 'unlock_music': {
        requireArg(instr, arg0, '@unlock_music');
        const fresh = this.gallery.unlockMusic(arg0!);
        this.#bus.emit('gallery', { type: 'music', id: arg0!, fresh });
        return;
      }
      case 'unlock_text': {
        requireArg(instr, arg0, '@unlock_text');
        const fresh = this.gallery.unlockText(arg0!);
        this.#bus.emit('gallery', { type: 'text', id: arg0!, fresh });
        return;
      }
      case 'clear': {
        // @clear [结局ID]：周目通关记录。缺省结局标识 = 当前场景 ID（多结局各放一条 @clear）。
        // 引擎只记录与广播；全局通关记录（跨周目）由宿主在 clear 事件回调中落盘。
        const ending = arg0 ?? this.#scene!.sceneId;
        const fresh = this.clearTracker.markClear(ending);
        this.#bus.emit('clear', { ending, fresh });
        return;
      }
      case 'exp': {
        // @exp characterId amount：角色获得经验。GrowthSystem 内聚判升级并把属性增量写回变量仓库。
        // 未注入成长系统 / 未注册角色 / 增量非法 → 抛运行时错误（尽早暴露配置缺陷）。
        if (!this.#growth) throw new RuntimeError('@exp 需要宿主注入 GrowthSystem（解释器构造参数或 setGrowth）', instr);
        const [characterId, amountRaw] = instr.args;
        if (characterId === undefined || amountRaw === undefined) {
          throw new RuntimeError('@exp 用法：@exp 角色ID 经验值', instr);
        }
        const amount = Number(amountRaw);
        if (!Number.isFinite(amount)) {
          throw new RuntimeError(`@exp 经验值非法：'${amountRaw}'`, instr);
        }
        const result = this.#growth.gainExp(characterId, amount);
        this.#bus.emit('growth', result);
        return;
      }
      case 'autosave': {
        // 存档点：发当前完整快照给宿主，由宿主写入自动存档槽位。
        // position 前移一位指向下一条指令：autosave 本身无状态副作用，读档后不应重跑它
        // （否则会重复触发 autosave 事件，宿主重复写档）。
        // 边缘情况：指令恰为场景末条（非文本）时 pc+1 指向自动追加的 end 指令，
        // 读档会直接触发 sceneEnd——语义上合理（场景确实已走完），不 clamp。
        const snap = this.saveSnapshot('auto');
        if (snap) {
          if (snap.position) {
            // 展开保留 sceneHash：自动存档同样参与读档哈希一致性校验
            snap.position = { ...snap.position, pc: snap.position.pc + 1 };
          }
          this.#bus.emit('autosave', snap);
        }
        return;
      }
      case 'savepoint': {
        // 手动检查点：发当前完整快照给宿主（可写入手动槽位或覆盖检查点）。position 语义同上。
        const snap = this.saveSnapshot('manual');
        if (snap) {
          if (snap.position) {
            snap.position = { ...snap.position, pc: snap.position.pc + 1 };
          }
          this.#bus.emit('savepoint', snap);
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

  /** 场景查找：未注册时转成带上下文的 RuntimeError（读档/返回点场景缺失给出可排查的说明） */
  #sceneOrRuntimeError(sceneId: string, message: string): CompiledScene {
    try {
      return this.#registry.get(sceneId);
    } catch {
      throw new RuntimeError(message);
    }
  }

  #requireStatus(expected: RuntimeStatus, action: string): void {
    if (this.#status !== expected) {
      throw new RuntimeError(`${action} 当前状态为 ${this.#status}（期望 ${expected}）`);
    }
  }
}

/** 文本插值：{var} → 变量值；未声明变量保留原文。
 *  支持转义：{{ → {、}} → }（用于输出字面花括号）。
 *  变量名规则与表达式解析器 parseWord 一致：首字符为字母/下划线（\p{L} 含增补平面字符），
 *  随后可含数字/点/$（{2x}、{.var} 这类非法名不插值，保留原文）。
 *  走 getRef 免拷贝热路径：每行文本逐字展示都会触发插值，返回值仅做 String 转换，只读安全。 */
export function interpolate(text: string, store: VariableStore): string {
  return text.replace(/\{\{|\}\}|\{([\p{L}_][\p{L}0-9_$.]*)\}/gu, (match, name: string | undefined) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    return store.has(name!) ? String(store.getRef(name!)) : `{${name}}`;
  });
}

/** 提取文本内 {var} 插值变量名（与 interpolate 同一规则：{{ 转义跳过；非法名不匹配）。
 *  单点维护，供 lint 对文本/说话人插值做变量声明校验。 */
export function collectInterpolatedVars(text: string): string[] {
  const out: string[] = [];
  const re = /\{\{|\}\}|\{([\p{L}_][\p{L}0-9_$.]*)\}/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

function requireArg(instr: GenericInstr, arg: string | undefined, usage: string): void {
  if (arg === undefined) {
    throw new RuntimeError(`${usage} 缺少变量参数`, instr);
  }
}

export type { CompiledScene };
