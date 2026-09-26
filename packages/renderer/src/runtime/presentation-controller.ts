import {
  EventBus,
  type CoreEventMap,
  type Unsubscribe,
  type TextEventPayload,
  type ChoiceEventPayload,
  type InstrEventPayload,
  type TimelineDefinition,
  type PresentationSnapshotContext,
  type PresentationRestoreResult,
  validateTimeline,
  stageCommandFromInstruction,
} from '@surdet/core';
import type { Backlog } from '../backlog.js';
import type { AudioPlaybackSnapshot } from '../rollback-buffer.js';
import { dequote } from '../dequote.js';
import { stripRuby } from '../ruby.js';
import { Typewriter } from '../text-buffer.js';
import { FadeTween } from '../transitions.js';
import type { AudioHandle, FrameRequestHandler, PortraitView } from '../types.js';
import { NULL_AUDIO } from '../types.js';
import { TimelinePlayer, type TimelineFrameEvent, type TimelinePlayerSnapshot } from '../timeline-player.js';
import { RendererCommandError, RendererError } from '../api/renderer-errors.js';
import type { RendererPluginHost } from '../plugin-host.js';
import type { ShakeDirection } from '../world-effects-controller.js';
import { BacklogSearchController } from '../backlog-search-controller.js';
import type { RendererCommands } from '../api/renderer-commands.js';
import type { NvlPresentationEntry, RendererQueries } from '../api/renderer-queries.js';
import type { RendererInputAction } from '../api/renderer-input.js';
import type { ResetSessionOptions } from '../api/renderer-runtime.js';
import type { RenderLifecycle } from '../lifecycle/render-lifecycle.js';

/** 渲染状态机 */
export type RenderStatus = 'idle' | 'typing' | 'awaiting' | 'choice';

/** 快进单帧时间预算（毫秒）：预算内批量推进多行，避免长段已读文本受帧率限制 */
const SKIP_FRAME_BUDGET_MS = 4;
/** 快进单帧推进上限：病态剧本（无挂起点）时防止单帧冻结 UI */
const SKIP_MAX_LINES_PER_FRAME = 2000;

/** 高精度时间（快进预算用；测试环境无 performance 时回退 Date.now） */
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidPresentation(message: string, cause?: unknown): RendererCommandError {
  return new RendererCommandError(message, {
    code: 'PRESENTATION_SNAPSHOT_INVALID',
    domain: 'presentation',
    command: 'restorePresentation',
    cause,
  });
}

function prepareDialogueRestore(payload: unknown): {
  readonly nvlActive: boolean;
  readonly nvlEntries: readonly NvlPresentationEntry[];
} {
  if (payload === undefined) return { nvlActive: false, nvlEntries: [] };
  if (!isRecord(payload)) throw invalidPresentation('Presentation dialogue is invalid');
  if (typeof payload.nvlActive !== 'boolean') {
    throw invalidPresentation('Presentation dialogue nvlActive must be boolean');
  }
  if (!Array.isArray(payload.nvlEntries)) {
    throw invalidPresentation('Presentation dialogue nvlEntries must be an array');
  }
  const entries: NvlPresentationEntry[] = [];
  for (const entry of payload.nvlEntries) {
    if (!isRecord(entry)) throw invalidPresentation('Presentation dialogue entry is invalid');
    const speaker = entry.speaker;
    if (speaker !== null && typeof speaker !== 'string') {
      throw invalidPresentation('Presentation dialogue entry speaker must be string or null');
    }
    if (typeof entry.text !== 'string') {
      throw invalidPresentation('Presentation dialogue entry text must be string');
    }
    entries.push({
      speaker: speaker === '' ? null : speaker,
      text: entry.text,
    });
  }
  if (!payload.nvlActive && entries.length > 0) {
    throw invalidPresentation('Presentation dialogue entries require nvlActive=true');
  }
  return { nvlActive: payload.nvlActive, nvlEntries: entries };
}

function withoutReplayedCurrentNvlLine(
  entries: readonly NvlPresentationEntry[],
  current: { readonly speaker: string | null; readonly value: string } | null,
  nvlActive: boolean,
): readonly NvlPresentationEntry[] {
  if (!nvlActive || !current || entries.length === 0) return entries;
  const expectedSpeaker = current.speaker !== null && current.speaker.length > 0 ? current.speaker : null;
  const last = entries.at(-1)!;
  return last.speaker === expectedSpeaker && last.text === stripRuby(current.value)
    ? entries.slice(0, -1)
    : entries;
}

export interface PreparedTimelineRestore {
  readonly id: number;
  readonly blocking: boolean;
  readonly player: TimelinePlayer;
  readonly events: readonly TimelineFrameEvent[];
}

export interface PreparedPresentationRestore {
  readonly stage: unknown;
  readonly audio?: AudioPlaybackSnapshot;
  readonly timelines: readonly PreparedTimelineRestore[];
  readonly timelineSequence: number;
  readonly dialogue: {
    readonly nvlActive: boolean;
    readonly nvlEntries: readonly NvlPresentationEntry[];
  };
}

/**
 * Shared read-only preparation for both Presentation validate and restore.
 * The stage validator is intentionally a narrow port: it receives only the
 * `stage` field and never the complete Presentation snapshot.
 */
export function preparePresentationRestore(
  payload: unknown,
  validateStagePresentation: ((snapshot: unknown) => void) | undefined,
  currentTimelineSequence = 0,
): PreparedPresentationRestore {
  if (payload === null || payload === undefined) {
    validateStagePresentation?.(null);
    return {
      stage: null,
      timelines: [],
      timelineSequence: currentTimelineSequence + 1,
      dialogue: { nvlActive: false, nvlEntries: [] },
    };
  }
  if (!isRecord(payload) || payload.version !== 1) {
    throw invalidPresentation('Presentation snapshot must be a version 1 object');
  }
  const stage = payload.stage ?? null;
  if (validateStagePresentation) {
    validateStagePresentation(stage);
  } else if (stage !== null) {
    throw invalidPresentation('Presentation stage validator is not configured');
  }
  const dialogue = prepareDialogueRestore(payload.dialogue);
  let audio: AudioPlaybackSnapshot | undefined;
  if (payload.audio !== undefined) {
    if (!isRecord(payload.audio)
      || (payload.audio.bgm !== null && typeof payload.audio.bgm !== 'string')
      || (payload.audio.ambience !== null && typeof payload.audio.ambience !== 'string')) {
      throw invalidPresentation('Presentation audio must contain BGM and ambience keys or null');
    }
    audio = { bgm: payload.audio.bgm, ambience: payload.audio.ambience };
  }
  const timelines: PreparedTimelineRestore[] = [];
  let timelineSequence = currentTimelineSequence + 1;
  const ids = new Set<number>();
  if (payload.timelines !== undefined && !Array.isArray(payload.timelines)) {
    throw invalidPresentation('Presentation timelines must be an array');
  }
  for (const item of (payload.timelines ?? [])) {
    if (!isRecord(item) || !isRecord(item.definition)) {
      throw invalidPresentation('Presentation timeline record is invalid');
    }
    const diagnostics = validateTimeline(item.definition);
    if (diagnostics.length > 0) {
      throw invalidPresentation('Presentation timeline definition is invalid', diagnostics);
    }
    const player = new TimelinePlayer(item.definition as unknown as TimelineDefinition);
    try {
      player.restore(item.snapshot as TimelinePlayerSnapshot);
    } catch (error) {
      throw invalidPresentation('Presentation timeline snapshot is invalid', error);
    }
    const id = typeof item.id === 'number' && Number.isFinite(item.id)
      ? item.id
      : ++timelineSequence;
    if (ids.has(id)) throw invalidPresentation(`Duplicate presentation timeline id '${id}'`);
    ids.add(id);
    timelineSequence = Math.max(timelineSequence, id);
    timelines.push({
      id,
      blocking: item.blocking === true,
      player,
      events: player.eventsAtCursor(),
    });
  }
  return {
    stage,
    timelines,
    timelineSequence,
    dialogue,
    ...(audio === undefined ? {} : { audio }),
  };
}

export interface AdvRendererOptions {
  typewriter?: Typewriter;
  /** 玩家推进到下一行时回调（连接 Interpreter.advance） */
  onAdvance?: () => void;
  /** 玩家选中选项时回调（连接 Interpreter.choose） */
  onSelect?: (index: number) => void;
  /** @wait 计时结束回调（连接 Interpreter.finishWait）；玩家点击跳过由 advance 处理 */
  onWaitEnd?: () => void;
  /** 自动播放：文本显示完成后的基础停留毫秒数（缺省 0 = 完成即推进） */
  autoBaseDelayMs?: number;
  /** 自动播放：按文本长度追加的停留（毫秒/字符，与基础停留相加） */
  autoPerCharMs?: number;
  /** 文字记录缓冲（注入后自动记录每行文本，供历史回看） */
  backlog?: Backlog;
  /** 可选渲染插件宿主；插件故障由宿主隔离，不得中断剧情推进。 */
  pluginHost?: RendererPluginHost;
}

export interface PresentationControllerOptions extends AdvRendererOptions {
  readonly onError?: (error: RendererError) => void;
  readonly commands: RendererCommands;
  readonly queries: RendererQueries;
  readonly lifecycle?: RenderLifecycle;
  readonly resetProjection?: (options?: ResetSessionOptions) => void;
  /** Read-only nested World validation used by the shared presentation prepare path. */
  readonly validateStagePresentation?: (snapshot: unknown) => void;
  readonly updateProjection?: (deltaMs: number) => void;
  readonly canScrollBacklog?: () => boolean;
  readonly bindStageCallbacks?: (handlers: {
    onSelect: (index: number) => void;
    onBacklogClose: () => void;
  }) => (() => void) | void;
  readonly detachPlugin?: () => void;
}

/**
 * 独立表现状态机：订阅内核 EventBus，消费 RendererCommands/RendererQueries。
 * 兼容包装器只在 legacy 边界委托到这里，不复制状态或行为。
 */
export class PresentationController {
  readonly presentationOwnsStage = true;
  #commands: RendererCommands;
  #queries: RendererQueries;
  #resetProjection?: (options?: ResetSessionOptions) => void;
  #validateStagePresentation?: (snapshot: unknown) => void;
  #updateProjection?: (deltaMs: number) => void;
  #canScrollBacklog: () => boolean = () => true;
  #unbindStageCallbacks?: () => void;
  #detachPlugin?: () => void;
  #lifecycle?: RenderLifecycle;
  #connectionCleanup: (() => void) | null = null;
  #disposed = false;
  #audio: AudioHandle;
  #tw: Typewriter;
  #status: RenderStatus = 'idle';
  #current: { speaker: string | null; value: string } | null = null;
  #fade: FadeTween | null = null;
  #onAdvance?: () => void;
  #onSelect?: (index: number) => void;
  #unsubs: (() => void)[] = [];
  #autoPlay = false;
  #skipMode = false;
  #autoBaseDelayMs: number;
  #autoPerCharMs: number;
  /** 进入 awaiting 的时刻（自动播放停留计时起点） */
  #awaitSince = 0;
  /** 文字记录（可选注入） */
  #backlog: Backlog | null;
  /** Backlog 覆盖层展示中 */
  #backlogOpen = false;
  #backlogSearch = new BacklogSearchController();
  /** NVL（全屏小说文本）模式 */
  #nvl = false;
  /** 当前选择肢（键盘导航用；原始 index 列表） */
  #choiceIndices: number[] = [];
  /** 选择肢高亮位置（键盘方向键移动；-1 表示尚未建立键盘焦点） */
  #choiceCursor = -1;
  /** 快进"全部跳过"模式（不区分已读/未读；默认快进仅跳已读） */
  #skipAll = false;
  /** @wait 截止时间戳（null = 未在等待） */
  #waitDeadline: number | null = null;
  #onWaitEnd?: () => void;
  #onError?: (error: RendererError) => void;
  /** wait/video 会话号：stateReset 后递增，残留的结束回调因此作废（审计修复 C1） */
  #waitSession = 0;
  /** 当前是否有一个尚未结束、由本控制器启动的视频。 */
  #videoActive = false;
  /** 最近一次 @voice 的 key：紧跟的文本行把它带进 Backlog（语音回放用） */
  #pendingVoice: string | null = null;
  /** 对话界面隐藏中（H 键惯例：隐藏对话框/说话人/等待指示器，背景立绘保留） */
  #interfaceHidden = false;
  /** 正在播放的时间轴；同一帧可有多个非阻塞时间轴并行。 */
  #timelineRuns = new Map<number, { player: TimelinePlayer; blocking: boolean }>();
  #timelineSeq = 0;
  #settlingTimeline = false;
  #skipTimelineAudio = false;
  #explicitPaused = false;
  #instructionOrigin?: import('@surdet/core').StageSource;
  #pausedSince: number | null = null;
  #blockingTimelineId: number | null = null;
  /** 上一帧已同步给舞台的等待状态；避免空闲帧重复改写 UI 节点。 */
  #lastAwaiting: boolean | null = null;
  /** 绑定外部帧调度器后，状态事件/输入可唤醒已暂停的 ticker。 */
  #frameRequest: FrameRequestHandler | null = null;
  #pluginHost?: RendererPluginHost;
  #unbindAudioErrors?: () => void;

  constructor(
    commands: RendererCommands,
    queries: RendererQueries,
    audio: AudioHandle = NULL_AUDIO,
    options: PresentationControllerOptions = { commands, queries },
  ) {
    this.#commands = commands;
    this.#queries = queries;
    this.#resetProjection = options.resetProjection;
    this.#validateStagePresentation = options.validateStagePresentation;
    this.#updateProjection = options.updateProjection;
    this.#canScrollBacklog = options.canScrollBacklog ?? (() => true);
    this.#lifecycle = options.lifecycle;
    this.#detachPlugin = options.detachPlugin;
    this.#audio = audio;
    this.#tw = options.typewriter ?? new Typewriter();
    this.#onAdvance = options.onAdvance;
    this.#onSelect = options.onSelect;
    this.#onWaitEnd = options.onWaitEnd;
    this.#onError = options.onError;
    this.#autoBaseDelayMs = Math.max(0, options.autoBaseDelayMs ?? 0);
    this.#autoPerCharMs = Math.max(0, options.autoPerCharMs ?? 0);
    this.#backlog = options.backlog ?? null;
    this.#pluginHost = options.pluginHost;
    this.#unbindStageCallbacks = options.bindStageCallbacks?.({
      onSelect: (index) => { this.select(index); },
      onBacklogClose: () => { this.#backlogOpen = false; },
    }) ?? undefined;
    this.#tw.onComplete = () => {
      if (this.#status === 'typing') {
        this.#status = 'awaiting';
        this.#awaitSince = nowMs();
        this.#syncText();
      }
    };
    this.#unbindAudioErrors = this.#audio.onError?.(error => {
      if (this.#disposed) return;
      this.#commands.dialogue.showBanner(error.message, 'tip');
      this.#requestFrame();
      if (this.#onError) this.#onError(error); else console.error(error);
    });
  }

  get status(): RenderStatus {
    return this.#status;
  }

  /**
   * A rollback checkpoint may only capture a presentation that has no active
   * FadeTween. The query is deliberately side-effect free: it neither updates
   * the tween nor requests a frame.
   */
  canCaptureRollbackCheckpoint(): boolean {
    return this.#fade === null || this.#fade.done;
  }

  /**
   * 当前帧是否需要推进。
   * 时间轴/打字/等待/自动播放等由渲染器自身声明；舞台动画由 Stage port 声明。
   * 旧舞台未实现该能力时返回 true，保持原有宿主行为。
   */
  get needsUpdate(): boolean {
    if (this.#disposed || this.presentationPaused) return false;
    return this.#hasRendererWork() || this.#queries.diagnostics.needsUpdate();
  }

  /** 绑定/解绑通用帧调度器；状态事件和交互动作会通过它唤醒下一帧。 */
  setFrameRequest(handler: FrameRequestHandler | null): void {
    this.#frameRequest = handler;
    if (handler && this.needsUpdate) handler();
  }

  /** v2 controller connection; legacy callers may continue using subscribe(). */
  connect(bus: EventBus<CoreEventMap>): Unsubscribe {
    if (this.#disposed) return () => undefined;
    this.disconnect();
    let active = true;
    const unsubs = [
      bus.on('text', (p) => { this.#onText(p); this.#requestFrame(); }),
      bus.on('choice', (p) => { this.#onChoice(p); this.#requestFrame(); }),
      bus.on('runtimeTrace', event => { if (event.kind === 'instruction') this.#instructionOrigin = { kind: 'scene', file: event.source.file, line: event.source.line, sceneId: event.source.sceneId, instructionIndex: event.source.index }; }),
      bus.on('instr', (p) => { this.#onInstr(p); this.#requestFrame(); }),
      bus.on('wait', (p) => { this.#onWait(p); this.#requestFrame(); }),
      bus.on('video', (p) => { this.#onVideo(p); this.#requestFrame(); }),
      bus.on('timeline', (p) => { this.#onTimeline(p); this.#requestFrame(); }),
      bus.on('stateReset', () => { this.#onStateReset(); this.#requestFrame(); }),
    ];
    const cleanup = (): void => {
      if (!active) return;
      active = false;
      if (this.#unsubs === unsubs) this.#unsubs = [];
      for (const off of unsubs) off();
      if (this.#connectionCleanup === cleanup) {
        this.#connectionCleanup = null;
        this.#lifecycle?.forget('runtime', 'listener', 'core-events');
      }
    };
    this.#unsubs = unsubs;
    this.#connectionCleanup = cleanup;
    try {
      this.#lifecycle?.register('runtime', 'listener', 'core-events', cleanup);
    } catch (error) {
      cleanup();
      throw error;
    }
    return cleanup;
  }

  /** Remove only Core subscriptions; the presentation state remains intact. */
  disconnect(): void {
    this.#connectionCleanup?.();
  }

  /** Legacy alias; v2 callers should use connect(). */
  subscribe(bus: EventBus<CoreEventMap>): void {
    this.connect(bus);
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#unbindAudioErrors?.();
    this.#unbindAudioErrors = undefined;
    this.#waitSession += 1;
    this.#waitDeadline = null;
    if (this.#videoActive) {
      this.#videoActive = false;
      this.#commands.system.hideVideo();
    }
    this.disconnect();
    this.#unbindStageCallbacks?.();
    this.#unbindStageCallbacks = undefined;
    this.#clearTimelines();
    this.#detachPlugin?.();
    this.#detachPlugin = undefined;
    this.#frameRequest = null;
    this.#disposed = true;
  }

  dispose(): void {
    this.destroy();
  }

  /** 开始一轮新的剧情会话：清理渲染状态，但保留宿主注入的设置（如打字速度）。 */
  resetSession(options: { preserveWorld?: boolean; clearAssets?: boolean } = {}): void {
    this.#status = 'idle';
    this.#current = null;
    this.#fade = null;
    this.#waitDeadline = null;
    this.#waitSession += 1;
    this.#videoActive = false;
    this.#pendingVoice = null;
    this.#choiceIndices = [];
    this.#choiceCursor = -1;
    this.#skipMode = false;
    this.#skipAll = false;
    this.#backlogOpen = false;
    this.#backlogSearch.clear();
    this.#backlogSearch.blur();
    this.#nvl = false;
    this.#interfaceHidden = false;
    this.#clearTimelines();
    // 清空 Typewriter 时先把状态置 idle，避免空文本的 onComplete 回调改变会话状态。
    this.#tw.text = '';
    this.#commands.dialogue.hideChoices();
    this.#clearText();
    this.#lastAwaiting = null;
    this.#syncAwaiting(false);
    this.#commands.dialogue.hideBacklog();
    this.#commands.dialogue.setNvlMode(false);
    this.#commands.dialogue.clearNvlText();
    this.#commands.system.hideVideo();
    this.#commands.dialogue.hideInterface(false);
    this.#commands.world.setFade(0);
    if (this.#resetProjection) this.#resetProjection(options);
    else if (options.preserveWorld !== true) this.#commands.presentation.clear();
    this.#requestFrame();
  }

  reset(options?: ResetSessionOptions): void {
    if (this.#disposed) return;
    this.resetSession(options);
  }

  dispatchInput(action: RendererInputAction): boolean {
    if (this.#disposed) return false;
    switch (action.type) {
      case 'advance': return this.advance();
      case 'choice.move':
        if (this.#status !== 'choice') return false;
        if (action.delta < 0) this.choiceUp();
        else this.choiceDown();
        return true;
      case 'choice.select': return this.select(action.index);
      case 'backlog.toggle': return this.toggleBacklog();
      case 'backlog.scroll': return this.scrollBacklog(action.delta);
      case 'auto.toggle': return this.toggleAuto();
      case 'skip.toggle': return action.scope === 'all' ? this.toggleSkipAll() : this.toggleSkip();
      case 'interface.toggle': return this.toggleHideInterface();
      case 'escape': return this.handleBacklogEscape();
    }
  }

  setPresentationPaused(paused: boolean): void { this.#explicitPaused = paused; this.#requestFrame(); }
  get presentationPaused(): boolean {
    const menu = this.#queries.overlay?.menu?.().type ?? 'none';
    return this.#explicitPaused || this.#backlogOpen || ['system-menu', 'save-load', 'settings'].includes(menu);
  }

  /** 帧推进（Pixi ticker 驱动）：打字中每帧把逐字进度推给舞台 */
  update(deltaMs: number): void {
    if (this.#disposed) return;
    if (this.presentationPaused) {
      this.#pausedSince ??= nowMs(); return;
    }
    if (this.#pausedSince !== null) {
      const delay = nowMs() - this.#pausedSince;
      if (this.#waitDeadline !== null) this.#waitDeadline += delay;
      this.#awaitSince += delay; this.#pausedSince = null;
    }
    if (!this.needsUpdate) return;
    this.#updateTimelines(deltaMs);
    // @wait 计时：到时（或快进中立即）结束等待并恢复解释器
    if (this.#waitDeadline !== null) {
      if (this.#skipMode || nowMs() >= this.#waitDeadline) {
        this.#waitDeadline = null;
        this.#onWaitEnd?.();
      }
    }
    this.#tw.update(deltaMs);
    if (this.#status === 'typing') {
      const c = this.#current;
      this.#commands.dialogue.showText(c?.speaker ?? null, this.#tw.text);
    }

    if (this.#skipMode) {
      // 快进：时间预算内批量推进（瞬时打字 + 连续 advance），长段已读文本不再受帧率限制。
      // 遇未读行时 #onText 自动退出快进（skipMode 置 false），循环随之停止。
      const deadline = nowMs() + SKIP_FRAME_BUDGET_MS;
      let guard = 0;
      while (this.#skipMode && guard++ < SKIP_MAX_LINES_PER_FRAME) {
        if (this.#status === 'typing') {
          this.#tw.skip(); // onComplete → status 'awaiting'
        }
        if (this.#status === 'awaiting') {
          this.#status = 'idle';
          this.#onAdvance?.(); // 解释器同步发出下一事件（text/choice/end）
          if (nowMs() > deadline) break;
          continue;
        }
        break; // choice/idle（解释器已结束且无后续事件）：停止
      }
    } else if (this.#autoPlay && this.#status === 'awaiting') {
      // 自动播放：文本显示完成后停留（基础 + 按长度）再推进；语音播放中先等语音
      // （isVoicePlaying 恒 false 的音频实现不受影响）。choice 挂起时不推进。
      const waited = nowMs() - this.#awaitSince;
      const need = this.#autoBaseDelayMs + this.#autoPerCharMs * (this.#current?.value.length ?? 0);
      if (waited >= need && !this.#audio.isVoicePlaying()) {
        this.#status = 'idle';
        this.#onAdvance?.();
      }
    }
    // 点击等待指示器投影（▼ 仅在文本等待推进时可见；fake stage 可未实现）
    this.#syncAwaiting(this.#status === 'awaiting');
    // Projection time was advanced once, at timeline boundaries, above.

    const fade = this.#fade;
    if (fade) {
      const v = fade.update(deltaMs);
      this.#commands.world.setFade(v);
      if (fade.done) this.#fade = null;
    }
    // 演出效果时间轴（shake/flash/zoom 由 Stage port 内部衰减）
    this.#pluginHost?.update(deltaMs);
  }

  #hasRendererWork(): boolean {
    return this.#timelineRuns.size > 0
      || this.#waitDeadline !== null
      || this.#status === 'typing'
      || (this.#skipMode && this.#status === 'awaiting')
      || (this.#autoPlay && this.#status === 'awaiting')
      || this.#fade !== null;
  }

  #syncAwaiting(awaiting: boolean): void {
    if (this.#lastAwaiting === awaiting) return;
    this.#lastAwaiting = awaiting;
    this.#commands.dialogue.setAwaiting(awaiting);
  }

  #requestFrame(): void {
    this.#frameRequest?.();
  }

  /** 运行时设置打字速度（每秒字符数，设置界面接入用） */
  setTextSpeed(charsPerSecond: number): void {
    this.#tw.setSpeed(charsPerSecond);
  }

  /** 运行时调整自动播放停留（设置界面接入用） */
  setAutoWait(baseDelayMs: number, perCharMs: number): void {
    this.#autoBaseDelayMs = Math.max(0, baseDelayMs);
    this.#autoPerCharMs = Math.max(0, perCharMs);
  }

  /** 切换 Backlog 覆盖层（舞台需实现 showBacklog/hideBacklog；未实现返回 false） */
  toggleBacklog(): boolean {
    if (!this.#backlog) return false;
    this.#backlogOpen = !this.#backlogOpen;
    if (this.#backlogOpen) {
      this.#renderBacklog();
    } else {
      this.#commands.dialogue.hideBacklog();
      this.#backlogSearch.clear();
      this.#backlogSearch.blur();
    }
    this.#requestFrame();
    return this.#backlogOpen;
  }

  /** 切换对话界面隐藏（H 键惯例：隐藏对话框/说话人栏/等待指示器，背景与立绘保留供赏画） */
  toggleHideInterface(): boolean {
    this.#interfaceHidden = !this.#interfaceHidden;
    this.#commands.dialogue.hideInterface(this.#interfaceHidden);
    this.#requestFrame();
    return this.#interfaceHidden;
  }

  get interfaceHidden(): boolean {
    return this.#interfaceHidden;
  }

  get backlogOpen(): boolean {
    return this.#backlogOpen;
  }

  /** Ctrl+F：进入 Backlog 查询模式。 */
  focusBacklogSearch(): boolean {
    if (!this.#backlogOpen || !this.#backlog) return false;
    this.#backlogSearch.focus();
    this.#renderBacklog();
    return true;
  }

  appendBacklogSearch(value: string): boolean {
    if (!this.#backlogOpen || !this.#backlog || value.length === 0) return false;
    this.#backlogSearch.append(value);
    this.#renderBacklog();
    return true;
  }

  /** Scroll the visible Backlog without exposing the Stage to the host controller. */
  scrollBacklog(delta: number): boolean {
    if (!this.#backlogOpen || !this.#canScrollBacklog()) return false;
    this.#commands.dialogue.scrollBacklog(delta);
    this.#requestFrame();
    return true;
  }

  backspaceBacklogSearch(): boolean {
    if (!this.#backlogOpen || !this.#backlog) return false;
    this.#backlogSearch.backspace();
    this.#renderBacklog();
    return true;
  }

  /** Escape 优先清空查询，再由宿主第二次 Escape 关闭覆盖层。 */
  handleBacklogEscape(): boolean {
    if (!this.#backlogOpen) return false;
    const consumed = this.#backlogSearch.handleEscape();
    if (consumed) this.#renderBacklog();
    return consumed;
  }

  backlogSearchQuery(): string {
    return this.#backlogSearch.query;
  }

  /** 舞台未实现 Backlog 覆盖层时的宿主回退取数入口 */
  backlogEntries() {
    return this.#backlog?.entries() ?? [];
  }

  #renderBacklog(): void {
    if (!this.#backlog) return;
    const entries = this.#backlogSearch.results(this.#backlog.entries()).map((result) => result.entry);
    this.#commands.dialogue.showBacklog(entries, (voice) => this.#audio.playVoice(voice), this.#backlogSearch.query);
  }

  /** ▼ 呼吸动画累加（Stage port 内部时间轴驱动上下浮动） */
  #syncContinuePulse(deltaMs: number): void {
    this.#updateProjection?.(deltaMs);
  }

  /** 切换自动播放 */
  toggleAuto(): boolean {
    this.#autoPlay = !this.#autoPlay;
    this.#requestFrame();
    return this.#autoPlay;
  }

  /** 切换快进（瞬时文本 + 连续推进；默认仅跳已读行） */
  toggleSkip(): boolean {
    this.#skipMode = !this.#skipMode;
    this.#skipAll = false;
    this.#requestFrame();
    return this.#skipMode;
  }

  /** 切换"全部跳过"快进：不区分已读/未读一路到底（遇选择肢仍会停下） */
  toggleSkipAll(): boolean {
    this.#skipAll = !this.#skipAll;
    this.#skipMode = this.#skipAll;
    this.#requestFrame();
    return this.#skipAll;
  }

  get skipAll(): boolean {
    return this.#skipAll;
  }

  get autoPlay(): boolean {
    return this.#autoPlay;
  }

  get skipMode(): boolean {
    return this.#skipMode;
  }

  /** 玩家点击/按键推进：等待中 → 跳过等待；打字中 → 瞬时完成；选择肢 → 确认高亮项；等待推进 → onAdvance */
  advance(): boolean {
    if (this.#explicitPaused || ['system-menu', 'save-load', 'settings'].includes(this.#queries.overlay?.menu?.().type ?? 'none')) return false;
    this.#requestFrame();
    if (this.#blockingTimelineId !== null) {
      this.#skipTimeline(this.#blockingTimelineId);
      return true;
    }
    if (this.#waitDeadline !== null) {
      this.#waitDeadline = null;
      this.#onWaitEnd?.();
      return true;
    }
    if (this.#status === 'choice') {
      return this.choiceConfirm();
    }
    if (this.#status === 'typing') {
      this.#tw.skip();
      return true;
    }
    if (this.#status === 'awaiting') {
      this.#status = 'idle';
      this.#onAdvance?.();
      return true;
    }
    return false;
  }

  /** 玩家选中选项 */
  select(index: number): boolean {
    if (this.#explicitPaused || ['system-menu', 'save-load', 'settings'].includes(this.#queries.overlay?.menu?.().type ?? 'none')) return false;
    if (this.#status !== 'choice') return false;
    this.#requestFrame();
    this.#status = 'idle';
    this.#commands.dialogue.hideChoices();
    this.#onSelect?.(index);
    return true;
  }

  #onText(p: TextEventPayload): void {
    // 遇未读即停：快进中遇到从未播放过的文本（wasRead === false）时自动退出快进，
    // 按正常打字显示给玩家。旧载荷缺 wasRead（undefined）时保持旧行为（连续推进），向后兼容。
    // 快进遇未读即停；"全部跳过"模式（skipAll）则无视已读状态一路到底
    if (this.#skipMode && !this.#skipAll && p.wasRead === false) this.#skipMode = false;
    // Backlog 语音关联：@voice 紧跟的文本行带上语音 key（回看可重播）
    this.#backlog?.add(p.speaker, stripRuby(p.value), this.#pendingVoice ?? undefined);
    if (this.#backlogOpen) this.#renderBacklog();
    this.#pendingVoice = null;
    this.#current = { speaker: p.speaker, value: p.value };
    if (this.#nvl) {
      // NVL 模式：整行瞬时追加到全屏文本页（不走打字机），等待推进
      this.#commands.dialogue.appendNvlText(p.speaker, stripRuby(p.value));
      this.#status = 'awaiting';
      this.#awaitSince = nowMs();
      return;
    }
    this.#beginText(p.speaker);
    if (p.value.length === 0) {
      // 空文本行（如只有说话人前缀的“凛：”）：无可打字内容，直接进入等待推进，
      // 否则状态机永远卡在 typing（Typewriter 空文本 done=true 但不触发 onComplete），剧情无法推进。
      this.#status = 'awaiting';
      this.#awaitSince = nowMs();
      return;
    }
    this.#status = 'typing';
    this.#tw.text = p.value;
  }

  #onChoice(p: ChoiceEventPayload): void {
    // 遇选择肢自动退出快进/自动播放：玩家必须做出选择，不应被连续推进越过
    this.#skipMode = false;
    this.#skipAll = false;
    this.#status = 'choice';
    this.#choiceIndices = p.options.map((o) => o.index);
    this.#choiceCursor = -1;
    this.#commands.dialogue.showChoices(p.options);
  }

  /** 选择肢键盘导航：上移（循环） */
  choiceUp(): void {
    if (this.#status !== 'choice' || this.#choiceIndices.length === 0) return;
    this.#choiceCursor = this.#choiceCursor < 0
      ? this.#choiceIndices.length - 1
      : (this.#choiceCursor - 1 + this.#choiceIndices.length) % this.#choiceIndices.length;
    this.#commands.dialogue.setChoiceHighlight(this.#choiceCursor);
    this.#requestFrame();
  }

  /** 选择肢键盘导航：下移（循环） */
  choiceDown(): void {
    if (this.#status !== 'choice' || this.#choiceIndices.length === 0) return;
    this.#choiceCursor = this.#choiceCursor < 0
      ? 0
      : (this.#choiceCursor + 1) % this.#choiceIndices.length;
    this.#commands.dialogue.setChoiceHighlight(this.#choiceCursor);
    this.#requestFrame();
  }

  /** 确认当前高亮选项（Enter/Space） */
  choiceConfirm(): boolean {
    if (this.#status !== 'choice' || this.#choiceCursor < 0 || this.#choiceIndices.length === 0) return false;
    return this.select(this.#choiceIndices[this.#choiceCursor]!);
  }

  /** 按显示位置直接选择（键盘数字键 1-9 → pos 0-8） */
  selectChoiceAt(pos: number): boolean {
    if (this.#status !== 'choice' || pos < 0 || pos >= this.#choiceIndices.length) return false;
    return this.select(this.#choiceIndices[pos]!);
  }

  /** @wait：记录截止时间，update 到点后回调 onWaitEnd（宿主连 Interpreter.finishWait）。
   *  快进中不等待：下一帧 update 立即结束（也可由玩家 advance 点击跳过）。 */
  #onWait(p: { ms: number }): void {
    this.#waitDeadline = nowMs() + Math.max(0, p.ms);
  }

  /** 读档状态重置（审计修复 C1）：作废等待计时并递增会话号，
   *  残留的 video 结束/计时到点回调不再调 onWaitEnd → finishWait 状态失配抛错 */
  #onStateReset(): void {
    this.#explicitPaused = false; this.#pausedSince = null;
    this.#backlogOpen = false;
    this.#commands.dialogue.hideBacklog();
    this.#clearRestoreInteractiveTransients();
    this.#waitDeadline = null;
    this.#waitSession += 1;
    this.#videoActive = false;
    this.#clearTimelines();
    this.#commands.presentation.clear();
    this.#nvl = false;
    this.#commands.dialogue.setNvlMode(false);
    this.#commands.dialogue.clearNvlText();
    this.#pendingVoice = null; // 旧场景的语音关联不跨读档延续
    this.#commands.system.hideVideo(); // 停止残留视频本体（回调已由会话令牌作废；审计复核）
  }

  /**
   * Clear only interaction state that belongs to the pre-restore event stream.
   * The restored Core event stream is the sole source allowed to project the
   * next text or choice; this intentionally does not reset user preferences
   * or the broader Player/Renderer session.
   */
  #clearRestoreInteractiveTransients(): void {
    this.#interfaceHidden = false;
    this.#commands.dialogue.hideInterface(false);
    this.#status = 'idle';
    this.#current = null;
    this.#fade = null;
    this.#choiceIndices = [];
    this.#choiceCursor = -1;
    this.#tw.text = '';
    this.#pendingVoice = null;
    this.#commands.dialogue.hideChoices();
    this.#clearText();
    this.#syncAwaiting(false);
  }

  #onTimeline(p: { id: string; blocking: boolean; definition?: TimelineDefinition }): void {
    const definition = p.definition;
    if (!definition) {
      // Lightweight hosts without a catalog may still drive the event themselves.
      if (p.blocking) this.#onWaitEnd?.();
      return;
    }
    const id = ++this.#timelineSeq;
    const player = new TimelinePlayer(definition);
    this.#timelineRuns.set(id, { player, blocking: p.blocking });
    if (p.blocking) this.#blockingTimelineId = id;
    this.#applyTimelineEvents(player.eventsAtCursor().map(event => ({ ...event, runId: id })));
    if (this.#skipMode && !this.#settlingTimeline) this.#skipTimeline(id);
  }

  #updateTimelines(deltaMs: number): void {
    if (this.#skipMode && !this.#settlingTimeline) {
      for (const id of [...this.#timelineRuns.keys()]) this.#skipTimeline(id);
      this.#commands.world.applyStage?.({ type: 'skip-motions' });
    }
    this.#advanceTimelineClocks(Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0));
  }

  #advanceTimelineClocks(deltaMs: number): void {
    let remaining = deltaMs, passes = 0;
    do {
      if (++passes > 30_000) throw new Error('Presentation timeline boundary budget exceeded');
      const runs = [...this.#timelineRuns];
      const step = Math.min(remaining, ...runs.map(([, run]) => run.player.timeToBoundary()));
      this.#syncContinuePulse(step);
      const events = runs.flatMap(([id, run]) => run.player.advance(step).map(event => ({ ...event, runId: id })));
      // Finish prior writers before claiming new writers at the same instant.
      events.sort((a, b) => Number(a.started) - Number(b.started) || a.runId! - b.runId! || (a.cueId ?? 0) - (b.cueId ?? 0));
      this.#applyTimelineEvents(events);
      for (const [id, run] of runs) if (this.#timelineRuns.get(id) === run && run.player.done) this.#completeTimeline(id);
      remaining = Math.max(0, remaining - step);
      if (remaining === 0) break;
    } while (true);
  }

  #applyTimelineEvents(events: readonly import('../timeline-player.js').TimelineFrameEvent[]): void {
    for (const event of events) {
      if (event.track === 'audio' && this.#skipTimelineAudio && event.cue.action !== 'bgm') continue;
      if (event.track === 'audio' && typeof event.cue.key === 'string' && (event.started || (event.final && event.cue.action === 'bgm'))) {
        if (event.cue.action === 'bgm') this.#audio.playBgm(event.cue.key);
        else if (event.cue.action === 'ambience') this.#audio.playAmbience?.(event.cue.key, event.cue.durationMs);
        else if (event.cue.action === 'se') this.#audio.playSe(event.cue.key);
        else if (event.cue.action === 'voice') this.#audio.playVoice(event.cue.key);
      } else {
        this.#commands.world.applyTimelineFrame(event);
      }
    }
  }

  #skipTimeline(id: number): void {
    const run = this.#timelineRuns.get(id);
    if (!run) return;
    if (this.#settlingTimeline) return;
    if (!this.#commands.world.applyStage) {
      this.#applyTimelineEvents(run.player.skip()); this.#completeTimeline(id); return;
    }
    this.#settlingTimeline = true; this.#skipTimelineAudio = true;
    try { this.#advanceTimelineClocks(Math.max(0, run.player.definition.durationMs - run.player.cursorMs)); }
    finally { this.#skipTimelineAudio = false; this.#settlingTimeline = false; }
  }

  #completeTimeline(id: number): void {
    const run = this.#timelineRuns.get(id);
    if (!run) return;
    this.#timelineRuns.delete(id);
    this.#commands.world.applyStage?.({ type: 'finish-timeline', runId: id });
    if (this.#blockingTimelineId === id) {
      this.#blockingTimelineId = null;
      this.#onWaitEnd?.();
    }
  }

  #clearTimelines(): void {
    this.#timelineRuns.clear();
    this.#blockingTimelineId = null;
    this.#timelineSeq += 1;
  }

  /** 供 Interpreter 的 presentation snapshot hook 使用。 */
  snapshotPresentation(context?: PresentationSnapshotContext): unknown {
    const dialogueEntries = this.#queries.dialogue.nvlPresentationEntries();
    const audio = this.#audio.snapshotPlayback?.();
    return {
      version: 1,
      stage: this.#queries.presentation.snapshot(),
      ...(audio === undefined ? {} : { audio }),
      timelines: [...this.#timelineRuns.entries()].map(([id, run]) => ({
        id,
        blocking: run.blocking,
        definition: run.player.definition,
        snapshot: run.player.snapshot(),
      })),
      dialogue: {
        nvlActive: this.#nvl,
        nvlEntries: context?.replayCurrentText === false ? dialogueEntries
          : withoutReplayedCurrentNvlLine(dialogueEntries, this.#current, this.#nvl),
      },
    };
  }

  /** 只读验证完整表现快照；与 restorePresentation 共用同一准备路径。 */
  validatePresentation(payload: unknown): void {
    this.#preparePresentationRestore(payload);
  }

  /**
   * 清除表现控制器持有的时间轴，不触碰对话、选择、自动、快进或 Backlog 状态。
   * Stage 表现由 RendererFacade 在同一个 presentation command 中清除。
   */
  clearPresentation(): void {
    this.#clearTimelines();
    this.#commands.presentation.clear();
    this.#requestFrame();
  }

  /** 重建对话后恢复舞台静态状态，再恢复仍在运行的时间轴游标。 */
  restorePresentation(payload: unknown): PresentationRestoreResult {
    const prepared = this.#preparePresentationRestore(payload);
    this.#clearTimelines();
    this.#timelineSeq = prepared.timelineSequence;
    this.#nvl = prepared.dialogue.nvlActive;
    this.#commands.dialogue.setNvlMode(this.#nvl);
    this.#commands.dialogue.clearNvlText();
    for (const entry of prepared.dialogue.nvlEntries) {
      this.#commands.dialogue.appendNvlText(entry.speaker, entry.text);
    }
    // Rebuilding the saved NVL page projects older speakers. The saved World
    // focus belongs to the current line, which the Interpreter replays next.
    if (prepared.stage === null) this.#commands.presentation.clear();
    else this.#commands.presentation.restore(prepared.stage);
    if (prepared.audio !== undefined) {
      this.#audio.stopAll();
      if (this.#audio.restorePlayback) this.#audio.restorePlayback(prepared.audio);
      else {
        this.#audio.playBgm(prepared.audio.bgm);
        this.#audio.playAmbience?.(prepared.audio.ambience, 0);
      }
    }
    for (const timeline of prepared.timelines) {
      this.#timelineRuns.set(timeline.id, { player: timeline.player, blocking: timeline.blocking });
      if (timeline.blocking) this.#blockingTimelineId = timeline.id;
      this.#applyTimelineEvents(timeline.events.map(event => ({ ...event, runId: timeline.id })));
    }
    this.#requestFrame();
    return { awaitingTimer: this.#blockingTimelineId !== null };
  }

  #preparePresentationRestore(payload: unknown): PreparedPresentationRestore {
    return preparePresentationRestore(payload, this.#validateStagePresentation, this.#timelineSeq);
  }

  /** @video：舞台支持播放则交给舞台（播完/跳过回调 onWaitEnd）；不支持/快进中直接结束 */
  #onVideo(p: { src: string }): void {
    if (this.#disposed) return;
    const source = dequote(p.src);
    // 会话令牌：读档后 stateReset 递增会话号，残留的视频结束回调被忽略（审计修复 C1）
    const session = this.#waitSession;
    if (this.#skipMode) {
      this.#onWaitEnd?.();
      return;
    }
    this.#videoActive = true;
    let completed = false;
    this.#commands.system.showVideo(source, (failure) => {
      if (completed) return;
      completed = true;
      if (session !== this.#waitSession) return;
      this.#videoActive = false;
      try {
        if (failure) {
          const error = failure instanceof RendererError ? failure : new RendererError(`视频 ${source} 无法播放：${failure.message}`,
            { code: 'MEDIA_PLAYBACK_FAILED', domain: 'video', command: 'showVideo', cause: failure });
          this.#commands.dialogue.showBanner(error.message, 'tip');
          if (this.#onError) this.#onError(error); else console.error(error);
        }
      } finally { this.#onWaitEnd?.(); }
    });
  }

  #onInstr(p: InstrEventPayload): void {
    const args = p.args.map(dequote);
    const mods = new Map([...p.modifiers].map(([k, v]) => [k, dequote(v)]));

    if (['pose', 'layer', 'stage'].includes(p.name) || p.name === 'show' && this.#commands.world.applyStage) {
      const command = stageCommandFromInstruction(p.name, args, mods);
      if (command) {
        if (!this.#commands.world.applyStage) throw new Error(`当前宿主未接入舞台指令 ${p.name}`);
        this.#commands.world.applyStage({ ...command, source: this.#instructionOrigin?.kind === 'scene' && this.#instructionOrigin.file === p.pos.file && this.#instructionOrigin.line === p.pos.line ? this.#instructionOrigin : { kind: 'scene', file: p.pos.file, line: p.pos.line } }); return;
      }
    }
    switch (p.name) {
      case 'bg': {
        this.#commands.world.setBackground(args[0] ?? null);
        break;
      }
      case 'show': {
        const key = args[0] ?? '';
        if (!key) break;
        const colon = key.indexOf(':');
        const charId = colon >= 0 ? key.slice(0, colon) : key;
        const costume = colon >= 0 ? key.slice(colon + 1) : 'normal';
        const expression = args[1] ?? 'normal';
        // 位置：优先 @pos=value；其次识别裸 @ left/@ right/@ center（规范示例写法）
        const explicitPos = mods.get('pos');
        const barePos = (['left', 'right', 'center'] as const).find((p) => mods.has(p));
        const pos = (explicitPos ?? barePos) || 'center';
        const view: PortraitView = { charId, costume, expression, pos };
        this.#commands.world.setPortrait(key, view);
        break;
      }
      case 'hide': {
        this.#commands.world.removePortrait(args[0] ?? '');
        break;
      }
      case 'bgm': {
        this.#audio.playBgm(args[0] ?? null);
        break;
      }
      case 'ambience': {
        const key = args[0] ?? null;
        this.#audio.playAmbience?.(key === 'off' ? null : key, parseDur(args[1]));
        break;
      }
      case 'se': {
        if (args[0]) this.#audio.playSe(args[0]);
        break;
      }
      case 'voice': {
        if (args[0]) {
          this.#audio.playVoice(args[0]);
          this.#pendingVoice = args[0]; // 下一行文本进 Backlog 时带上（语音回放）
        }
        break;
      }
      case 'fadeout': {
        this.#startFade(0, 1, parseDur(args[0]));
        break;
      }
      case 'fadein': {
        this.#startFade(1, 0, parseDur(args[0]));
        break;
      }
      case 'shake': {
        const directional = isShakeDirection(args[0]);
        const direction: ShakeDirection = directional ? (args[0] as ShakeDirection) : 'both';
        this.#commands.world.shake(
          parseDur(directional ? args[1] : args[0]),
          parseStrength(directional ? args[2] : args[1]),
          direction,
        );
        break;
      }
      case 'transition': {
        const name = args[0] ?? 'fade';
        const durationMs = parseTransitionDuration(args[1]);
        if (!this.#commands.world.transition(name, durationMs)) {
          console.warn(`[surdet] 未知转场：${name}`);
        }
        break;
      }
      case 'flash': {
        this.#commands.world.flash(parseDur(args[0]));
        break;
      }
      case 'zoom': {
        this.#commands.world.zoom(parseScale(args[0]), parseDur(args[1]));
        break;
      }
      case 'wipe': {
        this.#commands.world.wipe(parseDur(args[0]));
        break;
      }
      case 'mov': {
        // @mov key pos [dur]：立绘位置平移。pos = left/center/right 或裸数字 X 坐标（逻辑像素）
        const key = args[0] ?? '';
        const pos = args[1] ?? '';
        if (key && pos) this.#commands.world.movePortrait(key, pos, parseDur(args[2]));
        break;
      }
      case 'tint': {
        // @tint off [dur]：清除调色叠加；@tint 颜色 透明度 [dur]：过渡到目标调色
        const mode = (args[0] ?? '').toLowerCase();
        if (mode === 'off') {
          this.#commands.world.clearTint(parseDur(args[1]));
          break;
        }
        const color = parseColor(mode);
        if (color !== null) {
          const alpha = parseAlpha(args[1]);
          this.#commands.world.setTint(color, alpha, parseDur(args[2]));
        }
        break;
      }
      case 'particle': {
        // @particle 预设（snow/rain/sakura/sparkle/fireflies）/ @particle off
        const kind = (args[0] ?? '').toLowerCase();
        if (kind === 'off') this.#commands.world.stopParticles();
        else if (kind) this.#commands.world.startParticles(kind);
        break;
      }
      case 'title':
      case 'chapter':
      case 'center': {
        // 大横幅（居中大字）：参数连成文本
        this.#commands.dialogue.showBanner(args.join(' '), 'chapter');
        break;
      }
      case 'tip':
      case 'note': {
        // 小提示横幅（角标小字）
        this.#commands.dialogue.showBanner(args.join(' '), 'tip');
        break;
      }
      case 'nvl': {
        // @nvl / @nvl on：开启 NVL 页；@nvl off：回 ADV；@nvl clear：清页
        const mode = (args[0] ?? 'on').toLowerCase();
        if (mode === 'clear') {
          this.#commands.dialogue.clearNvlText();
          break;
        }
        this.#nvl = mode !== 'off';
        this.#commands.dialogue.setNvlMode(this.#nvl);
        break;
      }
      default:
        // autosave/savepoint/title 等：渲染层无需关注
        break;
    }
  }

  #startFade(from: number, to: number, durMs: number): void {
    this.#fade = new FadeTween(from, to, durMs);
    this.#fade.onDone = () => {
      this.#commands.world.setFade(to);
      this.#fade = null;
    };
  }

  #syncText(): void {
    const c = this.#current;
    if (c) this.#commands.dialogue.showText(c.speaker, c.value);
  }

  #beginText(speaker: string | null): void {
    if (this.#commands.dialogue.beginText) this.#commands.dialogue.beginText(speaker);
    else this.#commands.dialogue.showText(speaker, '');
  }

  #clearText(): void {
    if (this.#commands.dialogue.clearText) this.#commands.dialogue.clearText();
    else this.#commands.dialogue.showText(null, '');
  }
}

function parseDur(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 400;
}

function parseTransitionDuration(raw: string | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.max(1, Math.min(10_000, n)) : 600;
}

function isShakeDirection(raw: string | undefined): raw is ShakeDirection {
  return raw === 'both' || raw === 'horizontal' || raw === 'vertical' || raw === 'diagonal';
}

/** @shake 振幅（像素）：缺省 8 */
function parseStrength(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 64) : 8;
}

/** @zoom 目标缩放：合法区间 [0.25, 4]，缺省 1（复位） */
function parseScale(raw: string | undefined): number {
  const n = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(n) && n >= 0.25 && n <= 4 ? n : 1;
}

/** @tint 颜色解析：支持 #rrggbb / rrggbb / 0xrrggbb；非法返回 null（静默忽略，与占位策略一致） */
export function parseColor(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = /^(?:#|0x)?([0-9a-f]{6})$/i.exec(raw.trim());
  return m ? parseInt(m[1]!, 16) : null;
}

/** @tint 透明度：0..1，缺省 0.5；越界 clamp */
function parseAlpha(raw: string | undefined): number {
  const n = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}
