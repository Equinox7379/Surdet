import {
  EventBus,
  type CoreEventMap,
  type TextEventPayload,
  type ChoiceEventPayload,
  type InstrEventPayload,
} from '@surdet/core';
import type { Backlog } from './backlog.js';
import { dequote } from './dequote.js';
import { stripRuby } from './ruby.js';
import { Typewriter } from './text-buffer.js';
import { FadeTween } from './transitions.js';
import type { AdvStage, AudioHandle, ChoiceOptionView, PortraitView } from './types.js';
import { NULL_AUDIO } from './types.js';

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
}

/**
 * 事件驱动渲染核心：订阅内核 EventBus，把 text/choice/instr 事件
 * 翻译成 AdvStage 调用 + 打字机状态机。
 * 与 Pixi 解耦：可注入 fake stage 做 headless 测试。
 */
export class AdvRenderer {
  #stage: AdvStage;
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
  /** wait/video 会话号：stateReset 后递增，残留的结束回调因此作废（审计修复 C1） */
  #waitSession = 0;
  /** 最近一次 @voice 的 key：紧跟的文本行把它带进 Backlog（语音回放用） */
  #pendingVoice: string | null = null;
  /** 对话界面隐藏中（H 键惯例：隐藏对话框/说话人/等待指示器，背景立绘保留） */
  #interfaceHidden = false;

  constructor(stage: AdvStage, audio: AudioHandle = NULL_AUDIO, options: AdvRendererOptions = {}) {
    this.#stage = stage;
    this.#audio = audio;
    this.#tw = options.typewriter ?? new Typewriter();
    this.#onAdvance = options.onAdvance;
    this.#onSelect = options.onSelect;
    this.#onWaitEnd = options.onWaitEnd;
    this.#autoBaseDelayMs = Math.max(0, options.autoBaseDelayMs ?? 0);
    this.#autoPerCharMs = Math.max(0, options.autoPerCharMs ?? 0);
    this.#backlog = options.backlog ?? null;
    this.#tw.onComplete = () => {
      if (this.#status === 'typing') {
        this.#status = 'awaiting';
        this.#awaitSince = nowMs();
        this.#syncText();
      }
    };
    // 绑定选择肢点击回调到舞台（AdvStage 可选能力）：PixiStage.showChoices 经 stage.onSelect
    // 转发点击。若不绑定，宿主只给 AdvRenderer 传 onSelect 会导致真实 UI 点击选择肢无反应
    // （解释器停在 awaiting-choice，主流程卡死）。
    stage.onSelect = (index) => this.select(index);
    stage.onBacklogClose = () => {
      // PixiStage 的覆盖层可以自行响应点击；关闭后必须同步渲染器内部开关，
      // 否则下一次 L 键会把状态从 true 翻成 false 而不是重新打开。
      this.#backlogOpen = false;
    };
  }

  get status(): RenderStatus {
    return this.#status;
  }

  /** 订阅内核事件总线（类型化：负载由 CoreEventMap 推导） */
  subscribe(bus: EventBus<CoreEventMap>): void {
    this.#unsubs.push(
      bus.on('text', (p) => this.#onText(p)),
      bus.on('choice', (p) => this.#onChoice(p)),
      bus.on('instr', (p) => this.#onInstr(p)),
      bus.on('wait', (p) => this.#onWait(p)),
      bus.on('video', (p) => this.#onVideo(p)),
      bus.on('stateReset', () => this.#onStateReset()),
    );
  }

  destroy(): void {
    for (const off of this.#unsubs) off();
    this.#unsubs = [];
    this.#stage.onSelect = null;
    this.#stage.onBacklogClose = null;
  }

  /** 开始一轮新的剧情会话：清理渲染状态，但保留宿主注入的设置（如打字速度）。 */
  resetSession(options: { preserveWorld?: boolean; clearAssets?: boolean } = {}): void {
    this.#status = 'idle';
    this.#current = null;
    this.#fade = null;
    this.#waitDeadline = null;
    this.#waitSession += 1;
    this.#pendingVoice = null;
    this.#choiceIndices = [];
    this.#choiceCursor = -1;
    this.#skipMode = false;
    this.#skipAll = false;
    this.#backlogOpen = false;
    this.#nvl = false;
    this.#interfaceHidden = false;
    // 清空 Typewriter 时先把状态置 idle，避免空文本的 onComplete 回调改变会话状态。
    this.#tw.text = '';
    this.#stage.hideChoices();
    this.#stage.showText(null, '');
    this.#stage.setAwaiting?.(false);
    this.#stage.hideBacklog?.();
    this.#stage.setNvlMode?.(false);
    this.#stage.clearNvlText?.();
    this.#stage.hideVideo?.();
    this.#stage.hideInterface?.(false);
    this.#stage.setFade(0);
    this.#stage.resetSession?.(options);
  }

  /** 帧推进（Pixi ticker 驱动）：打字中每帧把逐字进度推给舞台 */
  update(deltaMs: number): void {
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
      this.#stage.showText(c?.speaker ?? null, this.#tw.text);
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
    this.#stage.setAwaiting?.(this.#status === 'awaiting');
    this.#syncContinuePulse(deltaMs);

    const fade = this.#fade;
    if (fade) {
      const v = fade.update(deltaMs);
      this.#stage.setFade(v);
      if (fade.done) this.#fade = null;
    }
    // 演出效果时间轴（shake/flash/zoom 由 PixiStage 内部衰减）
    this.#stage.updateEffects?.(deltaMs);
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
      this.#stage.showBacklog?.(this.#backlog.entries(), (voice) => this.#audio.playVoice(voice));
    } else {
      this.#stage.hideBacklog?.();
    }
    return this.#backlogOpen;
  }

  /** 切换对话界面隐藏（H 键惯例：隐藏对话框/说话人栏/等待指示器，背景与立绘保留供赏画） */
  toggleHideInterface(): boolean {
    this.#interfaceHidden = !this.#interfaceHidden;
    this.#stage.hideInterface?.(this.#interfaceHidden);
    return this.#interfaceHidden;
  }

  get interfaceHidden(): boolean {
    return this.#interfaceHidden;
  }

  get backlogOpen(): boolean {
    return this.#backlogOpen;
  }

  /** 舞台未实现 Backlog 覆盖层时的宿主回退取数入口 */
  backlogEntries() {
    return this.#backlog?.entries() ?? [];
  }

  /** ▼ 呼吸动画累加（PixiStage 内部时间轴驱动上下浮动） */
  #syncContinuePulse(deltaMs: number): void {
    this.#stage.updateContinuePulse?.(deltaMs);
  }

  /** 切换自动播放 */
  toggleAuto(): boolean {
    this.#autoPlay = !this.#autoPlay;
    return this.#autoPlay;
  }

  /** 切换快进（瞬时文本 + 连续推进；默认仅跳已读行） */
  toggleSkip(): boolean {
    this.#skipMode = !this.#skipMode;
    if (!this.#skipMode) this.#skipAll = false;
    return this.#skipMode;
  }

  /** 切换"全部跳过"快进：不区分已读/未读一路到底（遇选择肢仍会停下） */
  toggleSkipAll(): boolean {
    this.#skipAll = !this.#skipAll;
    this.#skipMode = this.#skipAll;
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
    if (this.#status !== 'choice') return false;
    this.#status = 'idle';
    this.#stage.hideChoices();
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
    this.#pendingVoice = null;
    this.#current = { speaker: p.speaker, value: p.value };
    if (this.#nvl) {
      // NVL 模式：整行瞬时追加到全屏文本页（不走打字机），等待推进
      this.#stage.appendNvlText?.(p.speaker, stripRuby(p.value));
      this.#status = 'awaiting';
      this.#awaitSince = nowMs();
      return;
    }
    if (p.value.length === 0) {
      // 空文本行（如只有说话人前缀的“凛：”）：无可打字内容，直接进入等待推进，
      // 否则状态机永远卡在 typing（Typewriter 空文本 done=true 但不触发 onComplete），剧情无法推进。
      this.#status = 'awaiting';
      this.#awaitSince = nowMs();
      this.#syncText();
      return;
    }
    this.#status = 'typing';
    this.#tw.text = p.value;
    this.#stage.showText(p.speaker, '');
  }

  #onChoice(p: ChoiceEventPayload): void {
    // 遇选择肢自动退出快进/自动播放：玩家必须做出选择，不应被连续推进越过
    this.#skipMode = false;
    this.#status = 'choice';
    this.#choiceIndices = p.options.map((o) => o.index);
    this.#choiceCursor = -1;
    this.#stage.showChoices(p.options);
  }

  /** 选择肢键盘导航：上移（循环） */
  choiceUp(): void {
    if (this.#status !== 'choice' || this.#choiceIndices.length === 0) return;
    this.#choiceCursor = this.#choiceCursor < 0
      ? this.#choiceIndices.length - 1
      : (this.#choiceCursor - 1 + this.#choiceIndices.length) % this.#choiceIndices.length;
    this.#stage.setChoiceHighlight?.(this.#choiceCursor);
  }

  /** 选择肢键盘导航：下移（循环） */
  choiceDown(): void {
    if (this.#status !== 'choice' || this.#choiceIndices.length === 0) return;
    this.#choiceCursor = this.#choiceCursor < 0
      ? 0
      : (this.#choiceCursor + 1) % this.#choiceIndices.length;
    this.#stage.setChoiceHighlight?.(this.#choiceCursor);
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
    this.#waitDeadline = null;
    this.#waitSession += 1;
    this.#pendingVoice = null; // 旧场景的语音关联不跨读档延续
    this.#stage.hideVideo?.(); // 停止残留视频本体（回调已由会话令牌作废；审计复核）
  }

  /** @video：舞台支持播放则交给舞台（播完/跳过回调 onWaitEnd）；不支持/快进中直接结束 */
  #onVideo(p: { src: string }): void {
    // 会话令牌：读档后 stateReset 递增会话号，残留的视频结束回调被忽略（审计修复 C1）
    const session = this.#waitSession;
    if (this.#skipMode) {
      this.#onWaitEnd?.();
      return;
    }
    if (this.#stage.showVideo) {
      this.#stage.showVideo(p.src, () => {
        if (session === this.#waitSession) this.#onWaitEnd?.();
      });
    } else {
      this.#onWaitEnd?.();
    }
  }

  #onInstr(p: InstrEventPayload): void {
    const args = p.args.map(dequote);
    const mods = new Map([...p.modifiers].map(([k, v]) => [k, dequote(v)]));

    switch (p.name) {
      case 'bg': {
        this.#stage.setBackground(args[0] ?? null);
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
        this.#stage.setPortrait(key, view);
        break;
      }
      case 'hide': {
        this.#stage.removePortrait(args[0] ?? '');
        break;
      }
      case 'bgm': {
        this.#audio.playBgm(args[0] ?? null);
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
        this.#stage.shake?.(parseDur(args[0]), parseStrength(args[1]));
        break;
      }
      case 'flash': {
        this.#stage.flash?.(parseDur(args[0]));
        break;
      }
      case 'zoom': {
        this.#stage.zoom?.(parseScale(args[0]), parseDur(args[1]));
        break;
      }
      case 'wipe': {
        this.#stage.wipe?.(parseDur(args[0]));
        break;
      }
      case 'mov': {
        // @mov key pos [dur]：立绘位置平移。pos = left/center/right 或裸数字 X 坐标（逻辑像素）
        const key = args[0] ?? '';
        const pos = args[1] ?? '';
        if (key && pos) this.#stage.movePortrait?.(key, pos, parseDur(args[2]));
        break;
      }
      case 'tint': {
        // @tint off [dur]：清除调色叠加；@tint 颜色 透明度 [dur]：过渡到目标调色
        const mode = (args[0] ?? '').toLowerCase();
        if (mode === 'off') {
          this.#stage.clearTint?.(parseDur(args[1]));
          break;
        }
        const color = parseColor(mode);
        if (color !== null) {
          const alpha = parseAlpha(args[1]);
          this.#stage.setTint?.(color, alpha, parseDur(args[2]));
        }
        break;
      }
      case 'particle': {
        // @particle 预设（snow/rain/sakura/sparkle/fireflies）/ @particle off
        const kind = (args[0] ?? '').toLowerCase();
        if (kind === 'off') this.#stage.stopParticles?.();
        else if (kind) this.#stage.startParticles?.(kind);
        break;
      }
      case 'title':
      case 'chapter':
      case 'center': {
        // 大横幅（居中大字）：参数连成文本
        this.#stage.showBanner?.(args.join(' '), 'chapter');
        break;
      }
      case 'tip':
      case 'note': {
        // 小提示横幅（角标小字）
        this.#stage.showBanner?.(args.join(' '), 'tip');
        break;
      }
      case 'nvl': {
        // @nvl / @nvl on：开启 NVL 页；@nvl off：回 ADV；@nvl clear：清页
        const mode = (args[0] ?? 'on').toLowerCase();
        if (mode === 'clear') {
          this.#stage.clearNvlText?.();
          break;
        }
        this.#nvl = mode !== 'off';
        this.#stage.setNvlMode?.(this.#nvl);
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
      this.#stage.setFade(to);
      this.#fade = null;
    };
  }

  #syncText(): void {
    const c = this.#current;
    if (c) this.#stage.showText(c.speaker, c.value);
  }
}

function parseDur(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 400;
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
