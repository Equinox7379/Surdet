/**
 * 渲染层与内核之间的投影接口与载荷类型。
 * 内核（Interpreter）通过 EventBus 发事件，AdvRenderer 订阅后驱动 AdvStage。
 */

import type { TimelineFrameEvent } from './timeline-player.js';
import type { RenderPerformanceSnapshot } from './performance.js';
import type { RenderQuality } from './quality.js';
import type { PresentationPreferences } from './presentation.js';
import type { PostProcessSettings } from './post-process.js';
import type { LoadingProgress } from './loading-progress.js';
import type { AudioPlaybackSnapshot } from './rollback-buffer.js';
import type { ShakeDirection, TransitionName } from './world-effects-controller.js';
import type { RendererError } from './api/renderer-errors.js';

/** 帧调度器在引擎状态变化时收到的唤醒回调。 */
export type FrameRequestHandler = () => void;

/** 可向外部帧调度器声明“需要重新渲染一帧”的对象。 */
export interface FrameRequestSource {
  setFrameRequest(handler: FrameRequestHandler | null): void;
}

/** 可被通用帧调度器驱动的渲染对象。 */
export interface FrameLoopTarget extends FrameRequestSource {
  readonly needsUpdate: boolean;
  update(deltaMs: number): void;
}

/** 舞台投影：渲染层需要实现的显示能力（可注入 fake 测试） */
export interface AdvStage {
  applyStage?(command: import('@surdet/core').StageCommand): void;
  /** 引擎级画质档位，剧情和脚本不感知该设置。 */
  setQuality?(quality: RenderQuality): void;
  getQuality?(): RenderQuality;
  /** 性能诊断快照，不应被剧情逻辑依赖。 */
  getPerformanceSnapshot?(): RenderPerformanceSnapshot | null;
  setPresentationPreferences?(preferences: Partial<PresentationPreferences>): void;
  getPresentationPreferences?(): PresentationPreferences;
  setPostProcess?(settings: Partial<PostProcessSettings>): void;
  getPostProcess?(): PostProcessSettings;
  /** 设置背景（null = 黑场）。key 经渲染层解析为实际纹理。 */
  setBackground(key: string | null): void;
  /** 设置/更新立绘 */
  setPortrait(key: string, opts: PortraitView): void;
  /** 移除立绘。key 支持两种写法（PixiStage 实现）：
   *  完整 `角色:服装`（与 @show 的第一个参数一致）精确移除；
   *  纯 `角色`（文档规范写法 @hide lynn）移除该角色的全部立绘。 */
  removePortrait(key: string): void;
  /** 显示对话框文本（speaker 为 null 表示旁白） */
  showText(speaker: string | null, value: string): void;
  /** 显示选择肢 */
  showChoices(options: ChoiceOptionView[]): void;
  /** 隐藏选择肢 */
  hideChoices(): void;
  /** 设置黑场叠加透明度（0..1） */
  setFade(alpha: number): void;
  fade?(from: number, to: number, durationMs: number): void;
  isFadeActive?(): boolean;
  /**
   * 选择肢点击回调（可选能力）。PixiStage 实现；`AdvRenderer` 构造时自动绑定，
   * 纯投影 fake 可不提供。绑定后选择肢点击 → AdvRenderer.select → 宿主 onSelect。
   */
  onSelect?: ((index: number) => void) | null;
  /** Backlog 被舞台自身点击关闭时的反向通知（保持渲染器状态与画面同步） */
  onBacklogClose?: (() => void) | null;
  /** 清理一次剧情会话的画面状态（可选能力，PixiStage 实现） */
  resetSession?(options?: { preserveWorld?: boolean; clearAssets?: boolean }): void;
  /** 显示启动/场景资源加载进度（可选能力，PixiStage 实现） */
  showLoading?(progress: LoadingProgress): void;
  /** 隐藏启动/场景资源加载层（可选能力，PixiStage 实现） */
  hideLoading?(): void;
  /** 点击等待指示器可见性（可选能力，PixiStage 实现 ▼ 指示） */
  setAwaiting?(awaiting: boolean): void;
  /**
   * 舞台是否仍有需要逐帧推进的视觉状态。
   * 未实现时渲染器按旧行为运行，兼容轻量 fake/宿主舞台。
   */
  needsUpdate?(): boolean;
  /** ▼ 呼吸动画时间推进（可选能力） */
  updateContinuePulse?(deltaMs: number): void;
  /** 展示 Backlog 覆盖层（可选能力，PixiStage 实现）；onReplayVoice 可选：点击带语音的行重播 */
  showBacklog?(entries: readonly { speaker: string | null; text: string; voice?: string }[], onReplayVoice?: (voice: string) => void, query?: string): void;
  /** 隐藏 Backlog 覆盖层（可选能力） */
  hideBacklog?(): void;
  /** 画面震动（@shake；二次衰减，方向可为 both/horizontal/vertical/diagonal） */
  shake?(durMs: number, strength: number, direction?: ShakeDirection): void;
  /** 注册表驱动的转场；未知名称返回 false。 */
  transition?(name: TransitionName | string, durMs: number): boolean;
  /** 白闪（@flash；线性衰减） */
  flash?(durMs: number): void;
  /** 世界层缩放（@zoom；向目标 scale 线性过渡，以画面中心为锚点） */
  zoom?(scale: number, durMs: number): void;
  /** 演出效果时间轴推进（每帧调用，驱动 shake/flash/zoom 衰减） */
  updateEffects?(deltaMs: number): void;
  /** @wipe 擦除转场（可选能力） */
  wipe?(durMs: number): void;
  /** @mov：立绘位置平移（key 契约同 removePortrait：完整 `角色:服装` 精确，纯角色 ID 移动该角色全部立绘）；
   *  pos 为 left/center/right 或裸数字 X 坐标，durMs 线性过渡（可选能力） */
  movePortrait?(key: string, pos: string, durMs: number): void;
  /** @tint：画面调色叠加（颜色 0xRRGGBB + 透明度，durMs 过渡到目标；可选能力） */
  setTint?(color: number, alpha: number, durMs: number): void;
  /** @tint off：清除调色叠加（durMs 淡出；可选能力） */
  clearTint?(durMs: number): void;
  /** @particle：启动预设粒子效果（snow/rain/sakura/sparkle/fireflies；可选能力） */
  startParticles?(kind: string): void;
  /** @particle off：停止粒子效果（可选能力） */
  stopParticles?(): void;
  /** 时间轴逐帧 cue 投影（可选；不实现时仍可由 headless fake 接收时间轴事件）。 */
  applyTimelineFrame?(event: TimelineFrameEvent): void;
  /** 获取/恢复可 JSON 序列化的世界与过渡状态。 */
  snapshotPresentation?(): unknown;
  restorePresentation?(snapshot: unknown): void;
  clearPresentation?(): void;
  /** 横幅文本（@title/@chapter/@center 用 chapter 样式，@tip/@note 用 tip 样式） */
  showBanner?(text: string, variant: 'chapter' | 'tip'): void;
  /** NVL 模式开关（全屏小说文本页；开启时 AdvRenderer 不走打字机而整行追加） */
  setNvlMode?(on: boolean): void;
  /** NVL 页追加一行 */
  appendNvlText?(speaker: string | null, text: string): void;
  /** NVL 页清空（@nvl clear） */
  clearNvlText?(): void;
  /** @video 阻塞播放：播完/出错/玩家点击跳过时回调 onEnd（宿主随后 finishWait） */
  showVideo?(src: string, onEnd: (failure?: Error) => void): void;
  /** 强制停止当前 @video 播放（读档 stateReset 时调用，防残留播放；审计复核） */
  hideVideo?(): void;
  /** 选择肢键盘导航高亮（pos 为选项序号；可选能力） */
  setChoiceHighlight?(pos: number): void;
  /** Backlog 覆盖层滚动（delta 像素，正数向下；可选能力） */
  scrollBacklog?(delta: number): void;
  /** 隐藏/恢复对话界面（H 键惯例：隐藏对话框/说话人栏/等待指示器，保留背景与立绘供赏画；可选能力） */
  hideInterface?(hidden: boolean): void;
  /** 配置显示名到角色资料的显式映射；舞台不会猜测角色关系。 */
  setSpeakerProfiles?(profiles: SpeakerProfile[]): void;
  /** 设置当前说话角色，用于降低其他立绘的存在感。 */
  setActiveSpeaker?(characterId: string | null): void;
  /** World-only portrait focus projection, separate from dialogue speaker state. */
  setPortraitFocus?(characterId: string | null): void;
  setPortraitSpeaking?(speaking: boolean): void;
  setPortraitSkipping?(skipping: boolean): void;
  /** 显示现代 ADV 底部操作带；宿主负责动作语义。 */
  showCommandRail?(items: CommandRailItem[], onSelect: (id: string) => void): void;
  /** 更新操作带的 active/enabled 状态，不重建宿主状态。 */
  setCommandRailItems?(items: CommandRailItem[]): void;
  /** 隐藏操作带。 */
  hideCommandRail?(): void;
  /** 结局黑场（宿主控制展示时长和后续跳转）。 */
  showEnding?(text?: string): void;
  /** 收起结局黑场。 */
  hideEnding?(): void;
}

export interface PortraitView {
  animation?: import('./portrait-visual-player.js').PortraitAnimationState;
  pose?: import('@surdet/core').StagePose;
  frame?: import('@surdet/core').StageRect;
  charId: string;
  costume: string;
  expression: string;
  /** 位置标识（left/center/right 等） */
  pos: string;
}

export interface ChoiceOptionView {
  index: number;
  label: string;
}

/**
 * 现代 ADV 底部操作带的单个动作。
 * 舞台只负责投影与派发，状态（自动/快进/隐藏等）由宿主维护。
 */
export interface CommandRailItem {
  id: string;
  label: string;
  /** 轻量图标字形；没有图标时只显示短标签。 */
  icon?: string;
  enabled?: boolean;
  active?: boolean;
  /** 供窄窗口和无障碍提示使用的完整说明。 */
  tooltip?: string;
}

/** 可选角色资料，不配置时舞台不会从显示名猜测角色 ID。 */
export interface SpeakerProfile {
  id: string;
  name: string;
  /** Original script name retained when the displayed name is translated. */
  sourceName?: string;
  avatarKey?: string;
}

/** 音频句柄（howler 封装实现；测试可注入 fake） */
export interface AudioBgmDiagnosticError {
  readonly type: 'loaderror' | 'playerror';
  readonly message: string;
}

export interface AudioBgmDiagnosticSnapshot {
  readonly source: string | null;
  readonly playing: boolean;
  readonly playCount: number;
  readonly errors: readonly AudioBgmDiagnosticError[];
}

export interface BgmPlaybackOptions {
  readonly restart?: boolean;
}

export interface AudioHandle {
  /** Loading/playback failures from active sources; unsubscribe when the consumer is destroyed. */
  onError?(listener: (error: RendererError) => void): () => void;
  playBgm(src: string | null, options?: BgmPlaybackOptions): void;
  /** 环境音循环声道（最多一个活动实例；可选以兼容轻量 fake） */
  playAmbience?(src: string | null, fadeMs?: number): void;
  playSe(src: string): void;
  playVoice(src: string): void;
  /** 停止全部音频（BGM/SE/语音） */
  stopAll(): void;
  /** 主音量 0..1（乘到各分轨之上） */
  setMasterVolume(v: number): void;
  getMasterVolume(): number;
  /** BGM 分轨音量 0..1 */
  setBgmVolume(v: number): void;
  getBgmVolume(): number;
  setAmbienceVolume?(value: number): void;
  getAmbienceVolume?(): number;
  /** SE 分轨音量 0..1 */
  setSeVolume(v: number): void;
  getSeVolume(): number;
  /** 语音分轨音量 0..1 */
  setVoiceVolume(v: number): void;
  getVoiceVolume(): number;
  /** 语音是否播放中（宿主可做"语音播完再自动推进"等策略） */
  isVoicePlaying(): boolean;
  /** 回退所需的公共音频播放快照；不暴露 Howl 或缓存内部对象。 */
  snapshotPlayback?(): AudioPlaybackSnapshot;
  /** 通过公共声道方法恢复音频播放状态。 */
  restorePlayback?(snapshot: AudioPlaybackSnapshot): void;
  /** 当前 BGM 的只读播放状态，供宿主诊断 Gallery 预览等实际播放路径。 */
  isBgmPlaying?(): boolean;
  /** 当前 BGM 的只读源与 Howler 错误摘要；不暴露 Howl 或缓存对象。 */
  snapshotBgmDiagnostics?(): AudioBgmDiagnosticSnapshot;
}

/** 无音频实现（占位素材阶段用） */
export const NULL_AUDIO: AudioHandle = {
  playBgm(_src, _options) {},
  playSe() {},
  playVoice() {},
  stopAll() {},
  setMasterVolume() {},
  getMasterVolume() { return 1; },
  setBgmVolume() {},
  getBgmVolume() { return 1; },
  setSeVolume() {},
  getSeVolume() { return 1; },
  setVoiceVolume() {},
  getVoiceVolume() { return 1; },
  isVoicePlaying() { return false; },
};
