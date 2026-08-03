import {
  EventBus,
  type TextEventPayload,
  type ChoiceEventPayload,
  type InstrEventPayload,
} from '@surdet/core';
import { dequote } from './dequote.js';
import { Typewriter } from './text-buffer.js';
import { FadeTween } from './transitions.js';
import type { AdvStage, AudioHandle, ChoiceOptionView, PortraitView } from './types.js';
import { NULL_AUDIO } from './types.js';

/** 渲染状态机 */
export type RenderStatus = 'idle' | 'typing' | 'awaiting' | 'choice';

export interface AdvRendererOptions {
  typewriter?: Typewriter;
  /** 玩家推进到下一行时回调（连接 Interpreter.advance） */
  onAdvance?: () => void;
  /** 玩家选中选项时回调（连接 Interpreter.choose） */
  onSelect?: (index: number) => void;
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

  constructor(stage: AdvStage, audio: AudioHandle = NULL_AUDIO, options: AdvRendererOptions = {}) {
    this.#stage = stage;
    this.#audio = audio;
    this.#tw = options.typewriter ?? new Typewriter();
    this.#onAdvance = options.onAdvance;
    this.#onSelect = options.onSelect;
    this.#tw.onComplete = () => {
      if (this.#status === 'typing') {
        this.#status = 'awaiting';
        this.#syncText();
      }
    };
    // 绑定选择肢点击回调到舞台（AdvStage 可选能力）：PixiStage.showChoices 经 stage.onSelect
    // 转发点击。若不绑定，宿主只给 AdvRenderer 传 onSelect 会导致真实 UI 点击选择肢无反应
    // （解释器停在 awaiting-choice，主流程卡死）。
    stage.onSelect = (index) => this.select(index);
  }

  get status(): RenderStatus {
    return this.#status;
  }

  /** 订阅内核事件总线 */
  subscribe(bus: EventBus): void {
    this.#unsubs.push(
      bus.on<TextEventPayload>('text', (p) => this.#onText(p)),
      bus.on<ChoiceEventPayload>('choice', (p) => this.#onChoice(p)),
      bus.on<InstrEventPayload>('instr', (p) => this.#onInstr(p)),
    );
  }

  destroy(): void {
    for (const off of this.#unsubs) off();
    this.#unsubs = [];
  }

  /** 帧推进（Pixi ticker 驱动）：打字中每帧把逐字进度推给舞台 */
  update(deltaMs: number): void {
    // 快进模式：瞬时完成打字
    if (this.#skipMode && this.#status === 'typing') this.#tw.skip();

    this.#tw.update(deltaMs);
    if (this.#status === 'typing') {
      const c = this.#current;
      this.#stage.showText(c?.speaker ?? null, this.#tw.text);
    }

    // 自动播放 / 快进：文本显示完成后立即推进（choice 挂起时不推进）
    if ((this.#autoPlay || this.#skipMode) && this.#status === 'awaiting') {
      this.#status = 'idle';
      this.#stage.showText(null, '');
      this.#onAdvance?.();
      return;
    }

    const fade = this.#fade;
    if (fade) {
      const v = fade.update(deltaMs);
      this.#stage.setFade(v);
      if (fade.done) this.#fade = null;
    }
  }

  /** 切换自动播放 */
  toggleAuto(): boolean {
    this.#autoPlay = !this.#autoPlay;
    return this.#autoPlay;
  }

  /** 切换快进（瞬时文本 + 连续推进） */
  toggleSkip(): boolean {
    this.#skipMode = !this.#skipMode;
    return this.#skipMode;
  }

  get autoPlay(): boolean {
    return this.#autoPlay;
  }

  get skipMode(): boolean {
    return this.#skipMode;
  }

  /** 玩家点击：打字中 → 瞬时完成；等待推进 → 回调 onAdvance */
  advance(): boolean {
    if (this.#status === 'typing') {
      this.#tw.skip();
      return true;
    }
    if (this.#status === 'awaiting') {
      this.#status = 'idle';
      this.#stage.showText(null, '');
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
    this.#current = { speaker: p.speaker, value: p.value };
    if (p.value.length === 0) {
      // 空文本行（如只有说话人前缀的“凛：”）：无可打字内容，直接进入等待推进，
      // 否则状态机永远卡在 typing（Typewriter 空文本 done=true 但不触发 onComplete），剧情无法推进。
      this.#status = 'awaiting';
      this.#syncText();
      return;
    }
    this.#status = 'typing';
    this.#tw.text = p.value;
    this.#stage.showText(p.speaker, '');
  }

  #onChoice(p: ChoiceEventPayload): void {
    this.#status = 'choice';
    this.#stage.showChoices(p.options);
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
        if (args[0]) this.#audio.playVoice(args[0]);
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
