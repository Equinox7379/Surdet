import type { RuntimeBreakpoint, RuntimeDebugSnapshot, RuntimeStatus, VarValue } from '@surdet/core';
import type { PreviewPathOptions, PreviewPathReport } from '@surdet/authoring';

/**
 * "从这一行试玩": the shared Authoring query finds a real path, and the preview
 * replays it with a temporary Core breakpoint. Nothing here sets a program counter
 * or copies the query's final variables into the preview.
 */
export type PreviewTargetMode = NonNullable<PreviewPathOptions['mode']>;

export const PREVIEW_TARGET_MODES: readonly { mode: PreviewTargetMode; label: string; hint: string }[] = [
  { mode: 'search', label: '从入口找路径', hint: '从项目入口按固定随机种子自动尝试各个选项，找到第一条到达这一行的路径。' },
  { mode: 'path', label: '按选择重播', hint: '从项目入口按你给出的选项序号依次选择；路径缺选择或选项当前不可见时不会猜测。' },
  { mode: 'test', label: '测试起点', hint: '从这一行之前最近的段落标记（没有则场景开头）开始，可设临时初值；只用于本次试玩。' },
];

/** What the preview needs to replay a found path: real entry, seed and option indices, plus a temporary breakpoint. */
export interface PreviewTargetRun {
  mode: PreviewTargetMode;
  breakpoint: RuntimeBreakpoint;
  line: number;
  choices: number[];
  targetVisit: number;
  /** Temporary initial values; test mode only. */
  variables?: Record<string, VarValue>;
  /** The user's own breakpoints, restored once the temporary one is no longer needed. */
  afterBreakpoints: RuntimeBreakpoint[];
}

export interface PreviewTargetState {
  type: 'surdet-preview-target-state'; traceId: string; generation: number;
  status: 'reached' | 'stopped'; message: string; visit?: number;
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function normalizePreviewTargetState(value: unknown): PreviewTargetState | null {
  if (!record(value) || value.type !== 'surdet-preview-target-state' || typeof value.traceId !== 'string' || !Number.isSafeInteger(value.generation)
    || (value.status !== 'reached' && value.status !== 'stopped') || typeof value.message !== 'string'
    || (value.visit !== undefined && (!Number.isSafeInteger(value.visit) || Number(value.visit) < 1))) return null;
  return value as unknown as PreviewTargetState;
}

/** "0, 2 1" → [0, 2, 1]: actual Core option indices, never rendered labels. */
export function parseOptionIndices(text: string): number[] {
  const parts = text.split(/[\s,，、]+/).filter(part => part.length > 0);
  const values = parts.map(Number);
  if (!values.every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('选项序号须是从 0 开始的整数，用逗号分隔。');
  return values;
}

export interface TargetVariableField { name: string; type: string; initial: unknown; value: string }

/** Only filled fields become temporary values; Core still checks each name and type. */
export function parseTargetVariables(fields: readonly TargetVariableField[]): Record<string, VarValue> {
  const values: Record<string, VarValue> = {};
  for (const field of fields) {
    const text = field.value.trim();
    if (text === '') continue;
    if (field.type === 'number') {
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error(`${field.name} 须是数字。`);
      values[field.name] = value;
    } else if (field.type === 'boolean' || field.type === 'flag') {
      if (text !== 'true' && text !== 'false') throw new Error(`${field.name} 须是开启或关闭。`);
      values[field.name] = text === 'true';
    } else if (field.type === 'string') {
      values[field.name] = field.value;
    } else {
      try { values[field.name] = JSON.parse(text) as VarValue; }
      catch { throw new Error(`${field.name} 须是 JSON 格式的${field.type === 'object' ? '对象' : '列表'}。`); }
    }
  }
  return values;
}

const KIND_TEXT: Record<PreviewPathReport['target']['kind'], string> = {
  instruction: '这一步',
  'label-entry': '这个段落标记的入口',
  'choice-group': '整组选项',
  'scene-entry': '场景开头',
};

/** Plain-language summary of one query result. It never claims more than one path. */
export function describePreviewPath(report: PreviewPathReport): { title: string; details: string[] } {
  const target = report.target;
  const where = `${target.sceneId} 第 ${target.line} 行`;
  const details: string[] = [];
  if (target.kind === 'choice-group' && target.requestedLine !== target.line) {
    details.push(`第 ${target.requestedLine} 行是选项，起点停在第 ${target.line} 行的整组选项出现之前。`);
  }
  const entry = report.entryLabel === undefined ? `${report.entryScene} 场景开头` : `${report.entryScene} 场景的段落标记 ${report.entryLabel} `;
  if (report.status === 'reached') {
    const visit = report.targetVisit > 1 ? `第 ${report.targetVisit} 次到达` : '到达';
    const choices = report.choices.length === 0 ? '途中没有选择' : `途中依次选择序号 ${report.choices.join('、')}`;
    details.push(`从 ${entry}出发，${choices}，${visit} ${where}的${KIND_TEXT[target.kind]}之前。`);
    if (report.partialStage) details.push('测试起点：这一段之前的背景、立绘和音乐没有重建，画面可能与正常游玩不同。');
    if (Object.keys(report.initialVariables).length > 0) {
      details.push(`临时初值：${Object.entries(report.initialVariables).map(([name, value]) => `${name} = ${JSON.stringify(value)}`).join('，')}（只用于本次试玩）。`);
    }
    details.push(`随机种子 ${report.seed} · 探索 ${report.pathsExplored} 条路径 · ${report.steps} 步。`);
    return { title: `已找到到达 ${where}的路径`, details };
  }
  const titles: Record<Exclude<PreviewPathReport['status'], 'reached'>, string> = {
    unreachable: `按本次条件没有到达 ${where}`,
    'budget-exhausted': '查找预算已用完，还不能判断是否可达',
    'path-mismatch': '给出的选择路径走不通',
    'host-boundary': '途中需要战斗、日程等宿主玩法接管',
    'runtime-error': '运行出错，无法确认能否到达',
    'requires-extension': '途中需要项目插件，查找不运行插件代码，未能确认',
  };
  details.push(report.message);
  const coverage = report.coverage;
  for (const branch of coverage.branches.filter(branch => branch.status === 'condition-not-met').slice(0, 5)) {
    details.push(`隐藏的选项：${branch.location.sceneId} 第 ${branch.location.line} 行，序号 ${branch.optionIndex}「${branch.label}」，条件没有成立。`);
  }
  for (const condition of coverage.conditions.filter(condition => condition.trueCount === 0 && condition.falseCount > 0).slice(0, 5)) {
    details.push(`实测从未成立的条件：${condition.location.sceneId} 第 ${condition.location.line} 行 ${condition.expression}。`);
  }
  for (const host of coverage.hostInstructions.slice(0, 3)) details.push(`宿主接管：${host.sceneId} 第 ${host.line} 行，没有伪造之后的状态。`);
  for (const error of report.runtimeErrors.slice(0, 3)) details.push(`运行错误${error.scene ? `（${error.scene}）` : ''}：${error.message}`);
  if (report.status === 'unreachable' && coverage.conditions.some(condition => condition.falseCount > 0)) {
    details.push('上面的条件只是实际运行中的结果，不一定是到不了的唯一原因。');
  }
  if (report.status === 'budget-exhausted') details.push(`已探索 ${report.pathsExplored} 条路径、${report.steps} 步；可以提高预算再找，或改用“按选择重播”。`);
  return { title: titles[report.status], details };
}

/** The part of Core's Interpreter the driver reads and steers. */
export interface PreviewTargetInterpreter {
  readonly status: RuntimeStatus;
  debugSnapshot(): RuntimeDebugSnapshot;
  configureDebugger(options: { enabled: boolean; pauseOnStart?: boolean; breakpoints?: readonly RuntimeBreakpoint[] }): void;
}

export interface PreviewTargetDriverOptions {
  interpreter: PreviewTargetInterpreter;
  /** The renderer's own player input, so waits, typing and choices stay presentation-consistent. */
  input: { advance(): boolean; select(index: number): boolean };
  run: PreviewTargetRun;
  /** Continue past an earlier visit of the target (loops). */
  continuePast(): void;
  report(state: { status: 'reached'; visit: number } | { status: 'stopped'; message: string }): void;
}

const MAX_TARGET_STEPS = 20_000;

/**
 * Plays the found path to the temporary breakpoint with real player input.
 * It only reacts to the actual interpreter state; when anything differs from the
 * query it stops where the run really is, without guessing the next step.
 */
export class PreviewTargetDriver {
  readonly #options: PreviewTargetDriverOptions;
  #visits = 0;
  #choiceIndex = 0;
  #visible: readonly { index: number }[] | null = null;
  #steps = 0;
  #scheduled = false;
  #done = false;

  constructor(options: PreviewTargetDriverOptions) { this.#options = options; }

  get done(): boolean { return this.#done; }

  choice(options: readonly { index: number }[]): void {
    this.#visible = options.map(option => ({ index: option.index }));
    this.poke();
  }

  poke(): void {
    if (this.#done || this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => { this.#scheduled = false; this.#continue(); });
  }

  dispose(): void { this.#done = true; }

  #continue(): void {
    if (this.#done) return;
    const { interpreter, input, run } = this.#options;
    const debug = interpreter.debugSnapshot();
    if (debug.paused) {
      const at = debug.current;
      if (debug.reason !== 'breakpoint' || at?.sceneId !== run.breakpoint.sceneId || at.index !== run.breakpoint.index) {
        this.#stop('运行在目标之外的位置暂停，已停止自动前进。');
        return;
      }
      this.#visits += 1;
      if (this.#visits < run.targetVisit) {
        if (!this.#budget()) return;
        try { this.#options.continuePast(); }
        catch (error) { this.#stop(`无法越过前一次到达：${error instanceof Error ? error.message : String(error)}`); return; }
        this.poke();
        return;
      }
      if (this.#choiceIndex !== run.choices.length) {
        this.#stop('已到达目标，但查到的路径里还有没用到的选择，和本次运行不一致。');
        return;
      }
      this.#done = true;
      this.#restoreBreakpoints();
      this.#options.report({ status: 'reached', visit: this.#visits });
      return;
    }
    switch (interpreter.status) {
      case 'awaiting-advance':
        if (!this.#budget()) return;
        if (input.advance()) this.poke();
        else this.#stop('当前画面没有接受推进，已停在真实位置。');
        return;
      case 'awaiting-timer':
        // A wait the player could click past; one that cannot be skipped ends on its own.
        if (this.#budget() && input.advance()) this.poke();
        return;
      case 'awaiting-choice': {
        const visible = this.#visible;
        if (visible === null) return;
        const index = run.choices[this.#choiceIndex];
        if (index === undefined) { this.#stop('出现了查到的路径之外的选择，已停在这组选项。'); return; }
        if (!visible.some(option => option.index === index)) { this.#stop(`选项序号 ${index} 当前不可见，已停在这组选项。`); return; }
        if (!this.#budget()) return;
        this.#choiceIndex += 1;
        this.#visible = null;
        if (input.select(index)) this.poke();
        else this.#stop('当前画面没有接受这个选择，已停在这组选项。');
        return;
      }
      case 'paused':
        this.#stop('到达需要宿主接管的位置，没有继续自动前进。');
        return;
      case 'ended':
        this.#stop('运行已经结束，没有到达目标。剧本可能和查找时不同，请重新查找。');
        return;
      case 'error':
        this.#stop('运行出错，没有到达目标。');
        return;
      default:
        return;
    }
  }

  #budget(): boolean {
    if (this.#steps >= MAX_TARGET_STEPS) { this.#stop(`自动前进超过 ${MAX_TARGET_STEPS} 次仍未到达目标，已停止。`); return false; }
    this.#steps += 1;
    return true;
  }

  #restoreBreakpoints(): void {
    // The temporary breakpoint is removed; a pause in place stays paused.
    const interpreter = this.#options.interpreter;
    try { interpreter.configureDebugger({ enabled: true, breakpoints: this.#options.run.afterBreakpoints }); }
    catch { interpreter.configureDebugger({ enabled: true, breakpoints: [] }); }
  }

  #stop(message: string): void {
    if (this.#done) return;
    this.#done = true;
    this.#restoreBreakpoints();
    this.#options.report({ status: 'stopped', message });
  }
}
