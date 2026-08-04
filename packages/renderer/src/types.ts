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
