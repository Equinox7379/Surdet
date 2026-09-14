import type { Interpreter } from '@surdet/core';
import type {
  PreviewPlaybackCheckpoint,
  PreviewReplayChoice,
  PreviewReplayPoint,
  PreviewReplaySource,
  PreviewReplaySources,
  RuntimeTraceEvent,
} from '@surdet/authoring';
import {
  resolvePreviewReplayOption,
  samePreviewReplaySource,
} from '@surdet/authoring';

const MAX_REPLAY_CHOICES = 256;
/**
 * A replay is allowed to drive only a bounded number of blocking events.  Core
 * has its own synchronous loop guard; this limit covers a replay that keeps
 * advancing from one text/choice suspension to the next.
 */
const MAX_AUTO_STEPS = 4096;

type PreviewChoiceOption = { index: number; label: string };

export interface PreviewReplayControllerOptions {
  sources: PreviewReplaySources;
  seed: number;
  sceneId: string;
  label?: string;
  replay?: PreviewPlaybackCheckpoint;
  onStatus: (message: string) => void;
}

function cloneSource(source: PreviewReplaySource): PreviewReplaySource {
  return { sceneId: source.sceneId, kind: source.kind, anchor: source.anchor, fingerprint: source.fingerprint };
}

function cloneChoice(choice: PreviewReplayChoice): PreviewReplayChoice {
  return { source: cloneSource(choice.source), optionFingerprint: choice.optionFingerprint };
}

function cloneCheckpoint(checkpoint: PreviewPlaybackCheckpoint): PreviewPlaybackCheckpoint {
  return {
    seed: checkpoint.seed,
    sceneId: checkpoint.sceneId,
    ...(checkpoint.label === undefined ? {} : { label: checkpoint.label }),
    choices: checkpoint.choices.map(cloneChoice),
    target: checkpoint.target === null ? null : cloneSource(checkpoint.target),
  };
}

function sameOptionalLabel(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

/**
 * Drives the existing Core interpreter back to a source checkpoint.
 *
 * This class deliberately observes Core's trace and public blocking methods;
 * it does not own variables, save state, program counters, or renderer waits.
 * A controller without `replay` is a recording observer and never advances
 * the interpreter by itself.
 */
export class PreviewReplayController {
  readonly #sources: PreviewReplaySources;
  readonly #seed: number;
  readonly #sceneId: string;
  readonly #label: string | undefined;
  readonly #onStatus: (message: string) => void;
  readonly #replay: PreviewPlaybackCheckpoint | undefined;
  readonly #initialReplayEligible: boolean;

  #interpreter: Interpreter | null = null;
  #generation = 0;
  #disposed = false;
  #scheduled = false;
  #currentPoint: PreviewReplayPoint | null = null;
  #availableOptions: readonly PreviewChoiceOption[] | null = null;
  #recordedChoices: PreviewReplayChoice[] = [];
  #replayChoiceIndex = 0;
  #autoSteps = 0;
  #autoEnabled: boolean;
  #recordingValid = true;
  #lastStatus: string | null = null;

  constructor(options: PreviewReplayControllerOptions) {
    this.#sources = options.sources;
    this.#seed = options.seed;
    this.#sceneId = options.sceneId;
    this.#label = options.label;
    this.#onStatus = options.onStatus;
    this.#replay = options.replay === undefined ? undefined : cloneCheckpoint(options.replay);

    let eligible = this.#replay !== undefined;
    if (this.#replay !== undefined) {
      if (this.#replay.seed !== this.#seed) {
        eligible = false;
        this.#notify('试玩续接已停止：保存的随机 seed 与当前入口不一致。');
      } else if (this.#replay.sceneId !== this.#sceneId || !sameOptionalLabel(this.#replay.label, this.#label)) {
        eligible = false;
        this.#notify('试玩续接已停止：保存的场景或入口标签与当前入口不一致。');
      } else if (this.#replay.choices.length > MAX_REPLAY_CHOICES) {
        eligible = false;
        this.#notify(`试玩续接已停止：保存路径超过 ${MAX_REPLAY_CHOICES} 次选择。`);
      } else if (this.#replay.target === null) {
        eligible = false;
        this.#notify('试玩续接已停止：保存路径没有可操作的目标源点，已保持正常入口。');
      } else {
        const targetPoint = this.#findSource(this.#replay.target);
        if (targetPoint === undefined) {
          eligible = false;
          this.#notify('试玩续接已停止：保存的目标源点在当前剧本中不存在，已保持正常入口。');
        } else if (!targetPoint.unique) {
          eligible = false;
          this.#notify('试玩续接已停止：保存的目标源点在当前剧本中不唯一，已保持正常入口。');
        }
      }
    }
    this.#initialReplayEligible = eligible;
    this.#autoEnabled = eligible;
  }

  /** Attach before Interpreter.start(). Attaching a new interpreter starts a new observed run. */
  attach(interpreter: Interpreter): void {
    if (this.#disposed) {
      this.#notify('试玩续接已停止：控制器已经释放。');
      return;
    }
    this.#generation += 1;
    this.#interpreter = interpreter;
    this.#scheduled = false;
    this.#currentPoint = null;
    this.#availableOptions = null;
    this.#recordedChoices = [];
    this.#replayChoiceIndex = 0;
    this.#autoSteps = 0;
    this.#autoEnabled = this.#initialReplayEligible;
    this.#recordingValid = true;
    this.#lastStatus = null;
  }

  /** Observe Core's real runtimeTrace event. */
  observe(event: RuntimeTraceEvent): void {
    if (this.#disposed) return;

    if (event.kind === 'instruction') {
      if (event.source.op === 'text' || event.source.op === 'choice') {
        this.#currentPoint = this.#pointAt(event.source.sceneId, event.source.line);
        this.#availableOptions = null;
      } else {
        this.#currentPoint = null;
        this.#availableOptions = null;
      }
    } else if (event.kind === 'scene-end') {
      this.#currentPoint = null;
      this.#availableOptions = null;
    } else if (event.kind === 'choice' && event.choice !== undefined) {
      this.#recordChoice(event);
    }

    this.#scheduleContinue();
  }

  /** Observe the actual visible option list emitted by Core. */
  choice(options: readonly PreviewChoiceOption[]): void {
    if (this.#disposed) return;
    this.#availableOptions = options.map((option) => ({ index: option.index, label: option.label }));
    this.#scheduleContinue();
  }

  /** Return only source identities and choices confirmed by actual Core events. */
  checkpoint(): PreviewPlaybackCheckpoint {
    return {
      seed: this.#seed,
      sceneId: this.#sceneId,
      ...(this.#label === undefined ? {} : { label: this.#label }),
      choices: this.#recordedChoices.map(cloneChoice),
      target: !this.#recordingValid || this.#currentPoint === null ? null : cloneSource(this.#currentPoint.source),
    };
  }

  /** Cancel queued continuation work without owning/discarding the interpreter. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#interpreter = null;
    this.#scheduled = false;
    this.#availableOptions = null;
    this.#autoEnabled = false;
  }

  #notify(message: string): void {
    if (this.#lastStatus === message) return;
    this.#lastStatus = message;
    this.#onStatus(message);
  }

  #disableAuto(reason: string): void {
    this.#autoEnabled = false;
    this.#notify(`试玩续接已停止：${reason}`);
  }

  #invalidateRecording(reason: string): void {
    this.#recordingValid = false;
    this.#disableAuto(reason);
  }

  #pointAt(sceneId: string, line: number): PreviewReplayPoint | null {
    return this.#sources.get(sceneId)?.get(line) ?? null;
  }

  #findSource(source: PreviewReplaySource): PreviewReplayPoint | undefined {
    const points = this.#sources.get(source.sceneId);
    if (points === undefined) return undefined;
    for (const point of points.values()) {
      if (samePreviewReplaySource(point.source, source)) return point;
    }
    return undefined;
  }

  #recordChoice(event: RuntimeTraceEvent): void {
    const selected = event.choice;
    if (selected === undefined) return;
    const point = this.#currentPoint ?? this.#pointAt(event.source.sceneId, event.source.line);
    if (point === null || point.source.kind !== 'choice' || !point.unique) {
      this.#invalidateRecording('当前选择源点不存在或不唯一，无法确认选择身份。');
      return;
    }

    const available = this.#availableOptions;
    if (available !== null && !available.some((option) => option.index === selected.optionIndex && option.label === selected.label)) {
      this.#invalidateRecording('Core 选择事件不在当前可见选项中，已停在真实选择肢。');
      return;
    }
    const sourceOption = point.options?.filter((option) => option.index === selected.optionIndex && option.label === selected.label) ?? [];
    if (sourceOption.length !== 1) {
      this.#invalidateRecording('无法用完整选项身份确认已选择项，已停在真实选择肢。');
      return;
    }

    if (this.#recordedChoices.length >= MAX_REPLAY_CHOICES) {
      this.#invalidateRecording(`实际选择次数超过 ${MAX_REPLAY_CHOICES}，已停止记录续接路径；没有截短后继续。`);
      return;
    }
    const actual: PreviewReplayChoice = {
      source: cloneSource(point.source),
      optionFingerprint: sourceOption[0]!.fingerprint,
    };
    this.#recordedChoices.push(actual);

    if (!this.#autoEnabled || this.#replay === undefined) return;
    const expected = this.#replay.choices[this.#replayChoiceIndex];
    if (expected === undefined || !samePreviewReplaySource(expected.source, actual.source)) {
      this.#disableAuto('实际选择肢与保存的选择组身份不一致，已停在真实选择肢。');
      return;
    }
    if (expected.optionFingerprint !== actual.optionFingerprint) {
      this.#disableAuto('实际选项内容指纹与保存路径不一致，已停在真实选择肢。');
      return;
    }
    this.#replayChoiceIndex += 1;
  }

  #scheduleContinue(): void {
    if (this.#disposed || this.#interpreter === null || this.#scheduled) return;
    const interpreter = this.#interpreter;
    const generation = this.#generation;
    this.#scheduled = true;
    queueMicrotask(() => {
      if (this.#disposed || this.#generation !== generation || this.#interpreter !== interpreter) return;
      this.#scheduled = false;
      this.#tryContinue(interpreter, generation);
    });
  }

  #tryContinue(interpreter: Interpreter, generation: number): void {
    if (this.#disposed || this.#generation !== generation || this.#interpreter !== interpreter || !this.#autoEnabled || this.#replay === undefined) return;

    const point = this.#currentPoint;
    if (point === null) {
      if (interpreter.status === 'awaiting-advance' || interpreter.status === 'awaiting-choice') {
        this.#disableAuto('当前可操作源点在重播源中不存在，已停在真实入口。');
      } else if (interpreter.status === 'ended') {
        this.#disableAuto('运行已从正常入口结束，未到达保存的目标源点。');
      }
      return;
    }
    if (!point.unique) {
      this.#disableAuto('当前源点身份不唯一，无法安全自动续接。');
      return;
    }
    if (this.#replay.target !== null && samePreviewReplaySource(point.source, this.#replay.target)) {
      if (this.#replayChoiceIndex === this.#replay.choices.length) {
        this.#autoEnabled = false;
        this.#notify('试玩已回到保存的目标源点，自动续接已停止。');
      } else {
        this.#disableAuto('已到达保存目标，但仍有未消费的路径选择，已停在当前源点。');
      }
      return;
    }

    if (interpreter.status === 'awaiting-advance') {
      if (!this.#consumeAutoBudget()) return;
      try {
        interpreter.advance();
      } catch (error) {
        this.#disableAuto(`解释器无法继续文本：${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    if (interpreter.status === 'awaiting-choice') {
      const expected = this.#replay.choices[this.#replayChoiceIndex];
      if (expected === undefined) {
        this.#disableAuto('当前路径出现保存记录之外的选择肢，已停在真实选择肢。');
        return;
      }
      if (!samePreviewReplaySource(point.source, expected.source)) {
        this.#disableAuto('当前选择组身份与保存路径不一致，已停在真实选择肢。');
        return;
      }
      if (this.#availableOptions === null) return;
      const index = resolvePreviewReplayOption(point, expected, this.#availableOptions);
      if (index === null) {
        this.#disableAuto('当前选择的条件、顺序或可见性与保存路径不一致，已停在真实选择肢。');
        return;
      }
      if (!this.#consumeAutoBudget()) return;
      try {
        interpreter.choose(index);
      } catch (error) {
        this.#disableAuto(`解释器拒绝保存选项：${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    if (interpreter.status === 'ended') {
      this.#disableAuto('运行已从正常入口结束，未到达保存的目标源点。');
    }
  }

  #consumeAutoBudget(): boolean {
    if (this.#autoSteps >= MAX_AUTO_STEPS) {
      this.#disableAuto(`自动续接超过 ${MAX_AUTO_STEPS} 个推进事件，可能存在循环。`);
      return false;
    }
    this.#autoSteps += 1;
    return true;
  }
}
