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
  /** 移除立绘 */
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
}

/** 无音频实现（占位素材阶段用） */
export const NULL_AUDIO: AudioHandle = {
  playBgm() {},
  playSe() {},
  playVoice() {},
};
