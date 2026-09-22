import type { Backlog } from '../backlog.js';
import type { CoreEventMap, EventBus, Unsubscribe, PresentationRestoreResult, PresentationSnapshotContext } from '@surdet/core';
import type { AudioHandle, FrameLoopTarget } from '../types.js';
import type { RendererPluginHost } from '../plugin-host.js';
import type { RenderPerformanceMonitor } from '../performance.js';
import type { PresentationPreferences } from '../presentation.js';
import type { RenderQuality } from '../quality.js';
import type { Typewriter } from '../text-buffer.js';
import type { RendererInputAction } from './renderer-input.js';
import type { RendererError } from './renderer-errors.js';
import type { RendererCommands } from './renderer-commands.js';
import type { RendererQueries } from './renderer-queries.js';

export interface ResetSessionOptions {
  preserveWorld?: boolean;
  clearAssets?: boolean;
}

export interface PresentationController extends FrameLoopTarget {
  readonly status: 'idle' | 'typing' | 'awaiting' | 'choice';
  readonly autoPlay: boolean;
  readonly skipMode: boolean;
  readonly skipAll: boolean;
  readonly backlogOpen: boolean;
  readonly interfaceHidden: boolean;

  connect(bus: EventBus<CoreEventMap>): Unsubscribe;
  disconnect(): void;
  reset(options?: ResetSessionOptions): void;
  resetSession(options?: ResetSessionOptions): void;
  /** True only when the presentation is safe to capture as a rollback checkpoint. */
  canCaptureRollbackCheckpoint(): boolean;
  validatePresentation(snapshot: unknown): void;
  snapshotPresentation(context?: PresentationSnapshotContext): unknown;
  restorePresentation(snapshot: unknown): PresentationRestoreResult | void;
  clearPresentation(): void;
  advance(): boolean;
  select(index: number): boolean;
  dispatchInput(action: RendererInputAction): boolean;
  toggleBacklog(): boolean;
  toggleHideInterface(): boolean;
  focusBacklogSearch(): boolean;
  appendBacklogSearch(value: string): boolean;
  scrollBacklog(delta: number): boolean;
  backspaceBacklogSearch(): boolean;
  handleBacklogEscape(): boolean;
  toggleAuto(): boolean;
  toggleSkip(): boolean;
  toggleSkipAll(): boolean;
  choiceUp(): void;
  choiceDown(): void;
  choiceConfirm(): boolean;
  selectChoiceAt(position: number): boolean;
  backlogEntries(): ReturnType<Backlog['entries']>;
  backlogSearchQuery(): string;
  setTextSpeed(charsPerSecond: number): void;
  setAutoWait(baseDelayMs: number, perCharMs: number): void;
  dispose(): void;
}

export interface RendererRuntime {
  readonly canvas: HTMLCanvasElement;
  readonly commands: RendererCommands;
  readonly queries: RendererQueries;
  readonly controller: PresentationController;

  resize(): void;
  resetSession(options?: ResetSessionOptions): void;
  dispose(): void;
}

export interface RendererRuntimeOptions {
  canvas?: HTMLCanvasElement;
  audio?: AudioHandle;
  preferences?: Partial<PresentationPreferences>;
  quality?: RenderQuality;
  onError?: (error: RendererError) => void;
  onAdvance?: () => void;
  onSelect?: (index: number) => void;
  onWaitEnd?: () => void;
  typewriter?: Typewriter;
  backlog?: Backlog;
  pluginHost?: RendererPluginHost;
  onBacklogClose?: () => void;
  /** Called synchronously by Dialogue UI handlers before their host callback. */
  onPointerConsumed?: () => void;
  performanceMonitor?: RenderPerformanceMonitor;
}
