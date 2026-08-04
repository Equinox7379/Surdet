/**
 * 渲染层与内核之间的投影接口与载荷类型。
 * 内核（Interpreter）通过 EventBus 发事件，AdvRenderer 订阅后驱动 AdvStage。
 */

/** 舞台投影：渲染层需要实现的显示能力（可注入 fake 测试） */
export interface AdvStage {
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
  /**
   * 选择肢点击回调（可选能力）。PixiStage 实现；`AdvRenderer` 构造时自动绑定，
   * 纯投影 fake 可不提供。绑定后选择肢点击 → AdvRenderer.select → 宿主 onSelect。
   */
  onSelect?: ((index: number) => void) | null;
  /** 点击等待指示器可见性（可选能力，PixiStage 实现 ▼ 指示） */
  setAwaiting?(awaiting: boolean): void;
  /** ▼ 呼吸动画时间推进（可选能力） */
  updateContinuePulse?(deltaMs: number): void;
  /** 展示 Backlog 覆盖层（可选能力，PixiStage 实现） */
  showBacklog?(entries: readonly { speaker: string | null; text: string }[]): void;
  /** 隐藏 Backlog 覆盖层（可选能力） */
  hideBacklog?(): void;
  /** 画面震动（@shake；durMs 时长，strength 像素振幅，线性衰减） */
  shake?(durMs: number, strength: number): void;
  /** 白闪（@flash；线性衰减） */
  flash?(durMs: number): void;
  /** 世界层缩放（@zoom；向目标 scale 线性过渡，以画面中心为锚点） */
  zoom?(scale: number, durMs: number): void;
  /** 演出效果时间轴推进（每帧调用，驱动 shake/flash/zoom 衰减） */
  updateEffects?(deltaMs: number): void;
  /** @wipe 擦除转场（可选能力） */
  wipe?(durMs: number): void;
  /** 横幅文本（@title/@chapter/@center 用 chapter 样式，@tip/@note 用 tip 样式） */
  showBanner?(text: string, variant: 'chapter' | 'tip'): void;
  /** NVL 模式开关（全屏小说文本页；开启时 AdvRenderer 不走打字机而整行追加） */
  setNvlMode?(on: boolean): void;
  /** NVL 页追加一行 */
  appendNvlText?(speaker: string | null, text: string): void;
  /** NVL 页清空（@nvl clear） */
  clearNvlText?(): void;
  /** @video 阻塞播放：播完/出错/玩家点击跳过时回调 onEnd（宿主随后 finishWait） */
  showVideo?(src: string, onEnd: () => void): void;
  /** 强制停止当前 @video 播放（读档 stateReset 时调用，防残留播放；审计复核） */
  hideVideo?(): void;
  /** 选择肢键盘导航高亮（pos 为选项序号；可选能力） */
  setChoiceHighlight?(pos: number): void;
  /** Backlog 覆盖层滚动（delta 像素，正数向下；可选能力） */
  scrollBacklog?(delta: number): void;
}

export interface PortraitView {
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

/** 音频句柄（howler 封装实现；测试可注入 fake） */
export interface AudioHandle {
  playBgm(src: string | null): void;
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
  /** SE 分轨音量 0..1 */
  setSeVolume(v: number): void;
  getSeVolume(): number;
  /** 语音分轨音量 0..1 */
  setVoiceVolume(v: number): void;
  getVoiceVolume(): number;
  /** 语音是否播放中（宿主可做"语音播完再自动推进"等策略） */
  isVoicePlaying(): boolean;
}

/** 无音频实现（占位素材阶段用） */
export const NULL_AUDIO: AudioHandle = {
  playBgm() {},
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
