import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text as PText,
  TextStyle,
  Texture,
  type TextStyleOptions,
} from 'pixi.js';
import type { BacklogEntry } from './backlog.js';
import type { BattleView } from './battle-view.js';
import { parseRuby, stripRuby } from './ruby.js';
import { wrapCjk, wrapCjkMeasure } from './text-wrap.js';
import type { BasePanelView, MapView, SaveLoadView, SystemMenuItemView, TitleView } from './ui-views.js';
import { formatSlotTime } from './ui-views.js';
import type { GalleryItemView } from './gallery.js';
import type { SettingsRowView } from './settings-store.js';
import type { AdvStage, ChoiceOptionView, PortraitView } from './types.js';

/** 战斗覆盖层交互回调（宿主驱动 CombatSolver 结算后重新 showBattle 刷新） */
export interface BattleHandlers {
  /** 点击存活的非行动方单位 → 以当前行动方首个存活单位攻击该目标；
   *  skillId 为玩家先前选中的技能（null = 普攻） */
  onAttack: (targetUid: string, skillId: string | null) => void;
  /** 跳过行动（僵局出口） */
  onPass: () => void;
  /** 移动行动方单位（1D 阵列；移动消耗本次行动） */
  onMove?: (dir: -1 | 1) => void;
}

/** 确定性颜色生成（同一资源 key 稳定同色） */
function hashStr(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function hsl(hash: number, sat: number, light: number): string {
  return `hsl(${hash % 360}, ${sat * 100}%, ${light * 100}%)`;
}

/** 颜色通道线性插值（RGB 分量各自 lerp 后合成） */
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (bl & 0xff);
}

/** @particle 预设参数（程序化粒子：数量/颜色/基准半径/垂直速度 px·帧⁻¹/横向摆动幅度）。
 *  每个粒子用独立 Graphics（v8 链式 API 直接建形，无纹理/Assets 依赖，与占位策略哲学一致）。 */
interface ParticlePreset {
  count: number;
  color: number;
  /** 基准半径（像素，实际尺寸乘 0.6..1.4 随机） */
  size: number;
  /** 垂直速度（像素/帧 @60fps；update 按 delta 归一） */
  vy: number;
  /** 横向摆动幅度（像素/帧） */
  sway: number;
  /** 雨滴等竖条形粒子 */
  elongated?: boolean;
}

const PARTICLE_PRESETS: Record<string, ParticlePreset> = {
  snow: { count: 60, color: 0xffffff, size: 4, vy: 0.7, sway: 0.5 },
  rain: { count: 70, color: 0x9db8d9, size: 3, vy: 6, sway: 0.4, elongated: true },
  sakura: { count: 40, color: 0xffc4d6, size: 5, vy: 0.9, sway: 1.2 },
  sparkle: { count: 36, color: 0xfff2b0, size: 2.6, vy: -0.25, sway: 0.3 },
  fireflies: { count: 24, color: 0xd8f08a, size: 3, vy: -0.15, sway: 0.5 },
};

/** 设计语言「夜色蔚蓝」：运行时画面调色板（深色玻璃底 + 冷白文字 + 蔚蓝强调，
 *  游戏内自成体系，与编辑器浅色主题 #0f8ff3 呼应但不强绑） */
const NIGHT_AZURE = {
  /** 对话框玻璃底渐变（深蓝黑，两段半透明 fill 叠加近似纵向渐变） */
  glassTop: 0x0c1424,
  glassBottom: 0x0a0f1c,
  /** 玻璃细描边（冷蓝，低 alpha） */
  glassEdge: 0x9fd4ff,
  /** 强调蔚蓝（强调线/选中边/名牌细边） */
  accent: 0x5ac8ff,
  /** 正文冷白 */
  text: 0xf2f6ff,
  /** 名牌底板深蓝 */
  plate: 0x123a5c,
  /** 名牌/高亮文字（略暖于正文的亮冷白） */
  plateText: 0xeaf6ff,
  /** 选择肢卡片底 */
  choiceBg: 0x0d1526,
  /** 选择肢卡片默认描边 */
  choiceEdge: 0x3d5a80,
} as const;

/** 程序化占位背景：纵向渐变 */
function makeBackgroundTexture(key: string, w = 1280, h = 720): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const hash = hashStr(key);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, hsl(hash, 0.45, 0.55));
  g.addColorStop(0.6, hsl((hash + 40) % 360, 0.5, 0.32));
  g.addColorStop(1, hsl((hash + 80) % 360, 0.55, 0.14));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 地平线
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  return Texture.from(canvas);
}

/** 程序化占位立绘：人形（头 + 身体），表情影响五官 */
function makePortraitTexture(charId: string, costume: string, expression: string, w = 400, h = 640): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const hash = hashStr(charId + costume);
  const exprHash = hashStr(expression);

  // 服装
  ctx.fillStyle = hsl(hash, 0.55, 0.5);
  ctx.fillRect(w * 0.18, h * 0.34, w * 0.64, h * 0.66);
  // 衣领
  ctx.fillStyle = hsl((hash + 30) % 360, 0.6, 0.35);
  ctx.beginPath();
  ctx.moveTo(w * 0.4, h * 0.34);
  ctx.lineTo(w * 0.5, h * 0.46);
  ctx.lineTo(w * 0.6, h * 0.34);
  ctx.closePath();
  ctx.fill();
  // 头
  const headR = w * 0.15;
  const headX = w * 0.5;
  const headY = h * 0.22;
  ctx.fillStyle = hsl((hash + 20) % 360, 0.4, 0.78);
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  // 五官（表情差异：眼形 + 嘴形）
  ctx.fillStyle = '#222';
  const eyeY = headY + headR * 0.15;
  if (exprHash % 3 === 0) {
    // 微笑眼（弯）
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(headX - headR * 0.35, eyeY, headR * 0.12, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(headX + headR * 0.35, eyeY, headR * 0.12, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(headX - headR * 0.35, eyeY, headR * 0.07, 0, Math.PI * 2);
    ctx.arc(headX + headR * 0.35, eyeY, headR * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  // 嘴（笑脸/惊讶/普通）
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const mouthY = headY + headR * 0.5;
  if (exprHash % 3 === 1) {
    ctx.arc(headX, mouthY, headR * 0.2, Math.PI * 0.1, Math.PI * 0.9);
  } else if (exprHash % 3 === 2) {
    ctx.arc(headX, mouthY, headR * 0.12, 0, Math.PI * 2);
  } else {
    ctx.moveTo(headX - headR * 0.2, mouthY);
    ctx.lineTo(headX + headR * 0.2, mouthY);
  }
  ctx.stroke();
  return Texture.from(canvas);
}

/**
 * Pixi 舞台：内核状态的可视化投影。
 * 背景/立绘资源缺失时回退程序化占位（同 key 稳定同图），真实项目可注入真实纹理。
 */
/** 对话框断行测量上下文（模块级惰性创建共用；非浏览器环境 null → 降级字数估算） */
let dialogMeasureCtx: CanvasRenderingContext2D | null = null;
function getDialogMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!dialogMeasureCtx) dialogMeasureCtx = document.createElement('canvas').getContext('2d');
  return dialogMeasureCtx;
}

export class PixiStage implements AdvStage {
  app: Application | null = null;
  /** 外部注入：选择肢点击回调 */
  onSelect: ((index: number) => void) | null = null;

  #bgLayer: Container;
  #portraitLayer: Container;
  #uiLayer: Container;
  #fadeOverlay: Graphics;
  #bgSprite: Sprite | null = null;
  #portraitSprites = new Map<string, Sprite>();
  #bgTextureCache = new Map<string, Texture>();
  #portraitTextureCache = new Map<string, Texture>();
  /** 真实背景素材（宿主 registerBackground 注入，优先于程序化占位） */
  #registeredBgs = new Map<string, Texture>();
  /** 真实立绘素材（key = charId:costume:expression，宿主 registerPortrait 注入） */
  #registeredPortraits = new Map<string, Texture>();
  #speakerText: PText;
  #dialogText: PText;
  /** 说话人名牌底板（玻璃对话框上沿偏左的圆角胶囊，随说话人显隐） */
  #speakerPlate: Graphics;
  /** 对话框每行字数容量（预断行用，构造时按字号估算；M5 支柱4） */
  #dialogCharsPerLine = 40;
  #choiceLayer: Container;
  /** 选择肢卡片视图（容器 + 卡片底板 + 强调条 + 文本；高亮统一走 #drawChoiceCard 重绘） */
  #choiceViews: { holder: Container; bg: Graphics; bar: Graphics; label: PText }[] = [];
  /** 选择肢键盘高亮序号（-1 = 无） */
  #choiceHighlight = -1;
  /** 立绘交叉淡化补间（旧 sprite 淡出 + 新 sprite 淡入） */
  #portraitTweens: { old: Sprite; neu: Sprite; remain: number; dur: number }[] = [];
  /** Backlog 滚动状态 */
  #backlogEntriesLayer: Container | null = null;
  #backlogScroll = 0;
  #backlogContentH = 0;
  /** 对话框半透明面板（亮色背景下保证文本可读性） */
  #dialogPanel: Graphics;
  /** ▼ 点击等待指示器（awaiting 时可见，呼吸浮动） */
  #continueIndicator: Graphics;
  #continuePhase = 0;
  /** Backlog 覆盖层 */
  #backlogLayer: Container;
  #backlogBuilt = false;
  /** 世界层：包裹背景 + 立绘，@shake/@zoom 的变换载体（UI 层不受影响） */
  #worldLayer: Container;
  /** @flash 白色闪光叠加（线性衰减） */
  #flashOverlay: Graphics;
  /** 演出效果状态（shake/flash/zoom 均为线性衰减，由 updateEffects 每帧驱动） */
  #shakeRemain = 0;
  #shakeDur = 1;
  #shakeStrength = 0;
  #flashRemain = 0;
  #flashDur = 1;
  #zoomFrom = 1;
  #zoomTo = 1;
  #zoomRemain = 0;
  #zoomDur = 1;
  /** 鉴赏覆盖层（CG/音乐 两个 tab；CG 全屏回看模式） */
  #galleryLayer: Container;
  #galleryTab: 'cg' | 'music' | 'text' = 'cg';
  #galleryMode: 'grid' | 'viewer' = 'grid';
  #galleryViews: { cgs: GalleryItemView[]; music: GalleryItemView[]; texts: GalleryItemView[] } | null = null;
  #galleryOnPlayMusic: ((id: string, src?: string) => void) | null = null;
  /** 文本回想重播回调（宿主 hostJump 到回想场景） */
  #galleryOnReplayText: ((item: GalleryItemView) => void) | null = null;
  #galleryViewerKey: string | null = null;
  /** 设置面板覆盖层（◀ ▶ 步进；状态归宿主，本舞台只投影与转发点击） */
  #settingsLayer: Container;
  #settingsRows: SettingsRowView[] = [];
  #settingsHandlers: { onChange: (id: string, dir: -1 | 1) => void; onClose: () => void } | null = null;
  /** 战斗覆盖层（阵营分列 + 血条 + 点击攻击/跳过） */
  #battleLayer: Container;
  #battleHandlers: BattleHandlers | null = null;
  /** 战斗中已选技能（null = 普攻） */
  #battleSelectedSkill: string | null = null;
  /** ruby 注音合成层（与 #dialogText 互斥显示） */
  #dialogRubyLayer: Container;
  /** NVL 全屏小说文本页 */
  #nvlLayer: Container;
  #nvlLines: PText[] = [];
  /** 每条 NVL 条目折出的行数（与 #nvlLines 平行；累计排布与淘汰用） */
  #nvlLineCounts: number[] = [];
  #nvlActive = false;
  /** NVL 页每行字数容量（预断行用，构造时按字号估算；NVL 断行禁则） */
  #nvlCharsPerLine = 50;
  /** 横幅（@title/@chapter/@tip/@center）淡出状态 */
  #bannerLayer: Container;
  #bannerText: PText;
  #bannerRemain = 0;
  #bannerDur = 1;
  /** @wipe 擦除转场 */
  #wipeBar: Graphics;
  #wipeRemain = 0;
  #wipeDur = 1;
  /** @tint 调色叠加（颜色/透明度线性过渡到目标） */
  #tintOverlay: Graphics;
  #tintFrom = { color: 0x000000, alpha: 0 };
  #tintTo = { color: 0x000000, alpha: 0 };
  #tintRemain = 0;
  #tintDur = 1;
  /** @particle 粒子效果层（程序化粒子，预设 snow/rain/sakura/sparkle/fireflies） */
  #particleLayer: Container;
  #particleKind: string | null = null;
  #particlePreset: ParticlePreset | null = null;
  #particles: { sprite: Graphics; vx: number; vy: number; phase: number }[] = [];
  /** @mov 立绘位置平移补间（旧位置 → 目标位置线性过渡） */
  #movTweens: { sprite: Sprite; fromX: number; toX: number; remain: number; dur: number }[] = [];
  /** 对话界面隐藏中（hideInterface；showText/NVL 不覆盖此状态，恢复后由下一次 showText 重建） */
  #interfaceHidden = false;
  /** 标题画面 / 系统菜单 / 存读档 / 大地图 覆盖层 */
  #titleLayer: Container;
  #titleHandler: ((id: string) => void) | null = null;
  #menuLayer: Container;
  #menuHandlers: { onSelect: (id: string) => void; onClose: () => void } | null = null;
  #saveLoadLayer: Container;
  #saveLoadHandlers: { onSelect: (slotId: string) => void; onClose: () => void } | null = null;
  #mapLayer: Container;
  #mapHandlers: { onEnter: (nodeId: string) => void; onEndTurn: () => void } | null = null;
  /** 商店覆盖层 */
  #shopLayer: Container;
  #shopHandlers: { onBuy: (itemId: string) => void; onClose: () => void } | null = null;
  /** 据点指令面板（兰斯式 base commands） */
  #baseLayer: Container;
  #baseHandlers: { onExec: (cmdId: string) => void; onClose: () => void } | null = null;

  #w = 1280;
  #h = 720;

  constructor() {
    this.#bgLayer = new Container();
    this.#portraitLayer = new Container();
    this.#worldLayer = new Container();
    this.#worldLayer.addChild(this.#bgLayer, this.#portraitLayer);
    this.#uiLayer = new Container();
    this.#fadeOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000);
    this.#fadeOverlay.alpha = 0;
    this.#flashOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0xffffff);
    this.#flashOverlay.alpha = 0;
    this.#choiceLayer = new Container();
    this.#dialogRubyLayer = new Container();
    this.#nvlLayer = new Container();
    this.#nvlLayer.visible = false;
    this.#nvlLayer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x0a0a12, alpha: 0.6 }));
    this.#bannerLayer = new Container();
    this.#bannerLayer.visible = false;
    this.#bannerText = new PText({ text: '', style: { fontSize: 40, fill: 0xffffff, fontWeight: 'bold' } satisfies TextStyleOptions });
    this.#bannerText.anchor.set(0.5);
    this.#bannerLayer.addChild(this.#bannerText);
    this.#wipeBar = new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000);
    this.#wipeBar.visible = false;
    this.#tintOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000);
    this.#tintOverlay.alpha = 0;
    this.#tintOverlay.visible = false;
    this.#particleLayer = new Container();
    this.#titleLayer = new Container();
    this.#titleLayer.visible = false;
    this.#menuLayer = new Container();
    this.#menuLayer.visible = false;
    this.#saveLoadLayer = new Container();
    this.#saveLoadLayer.visible = false;
    this.#mapLayer = new Container();
    this.#mapLayer.visible = false;
    this.#shopLayer = new Container();
    this.#shopLayer.visible = false;
    this.#baseLayer = new Container();
    this.#baseLayer.visible = false;
    // 对话戏玻璃对话框（夜色蔚蓝）：分层绘制见 #drawDialogPanel（渐变玻璃底 + 细描边 + 顶沿强调线）
    this.#dialogPanel = new Graphics();
    this.#drawDialogPanel();
    this.#speakerPlate = new Graphics();
    this.#continueIndicator = new Graphics()
      .moveTo(-9, 0)
      .lineTo(9, 0)
      .lineTo(0, 12)
      .closePath()
      .fill({ color: NIGHT_AZURE.accent, alpha: 0.95 });
    this.#continueIndicator.visible = false;
    this.#backlogLayer = new Container();
    this.#backlogLayer.visible = false;
    this.#galleryLayer = new Container();
    this.#galleryLayer.visible = false;
    this.#settingsLayer = new Container();
    this.#settingsLayer.visible = false;
    this.#battleLayer = new Container();
    this.#battleLayer.visible = false;
    this.#uiLayer.addChild(
      this.#dialogPanel, this.#speakerPlate, this.#dialogRubyLayer, this.#continueIndicator, this.#choiceLayer,
      this.#backlogLayer, this.#galleryLayer, this.#settingsLayer, this.#battleLayer,
      this.#nvlLayer, this.#bannerLayer, this.#wipeBar,
      this.#mapLayer, this.#shopLayer, this.#baseLayer, this.#saveLoadLayer, this.#menuLayer, this.#titleLayer,
    );

    this.#speakerText = new PText({
      text: '',
      style: { fontSize: 26, fill: NIGHT_AZURE.plateText, fontWeight: 'bold' } satisfies TextStyleOptions,
    });
    this.#dialogText = new PText({
      text: '',
      style: {
        fontSize: 26,
        fill: NIGHT_AZURE.text,
        lineHeight: 46,
        // 极淡文字阴影：玻璃底上增强正文层次（v8 TextStyle 原生 dropShadow）
        dropShadow: { alpha: 0.35, blur: 6, distance: 2, color: 0x020409 },
      } satisfies TextStyleOptions,
    });
    // 对话框预断行（M5 支柱4：断行禁则）：字数容量作无测量环境降级口径（像素测量见 #wrapDialogText）
    this.#dialogCharsPerLine = Math.max(10, Math.floor((this.#w - 160) / 26));
    // NVL 页预断行（断行禁则）：fontSize 20，估算口径与对话框一致
    this.#nvlCharsPerLine = Math.max(10, Math.floor((this.#w - 160) / 20));
  }

  /** 对话框断行：优先像素级测量（canvas measureText，中英混排精确），
   *  无测量环境（node/无 canvas）降级字数估算；禁则规则由 wrap 系函数保证 */
  #wrapDialogText(plain: string): string[] {
    const ctx = getDialogMeasureCtx();
    if (!ctx) return wrapCjk(plain, this.#dialogCharsPerLine);
    const style = this.#dialogText.style;
    const fam = style.fontFamily;
    const famStr = Array.isArray(fam) ? fam.join(', ') : String(fam);
    ctx.font = `${style.fontSize}px ${famStr}`;
    return wrapCjkMeasure(plain, this.#w - 160, (s) => ctx.measureText(s).width);
  }

  /** 初始化 Pixi 应用与舞台层级（真实项目在 DOM 就绪后调用）。
   *  resolution 按设备像素比渲染（高分屏不糊），autoDensity 保持逻辑尺寸 1280×720。
   *  严格 CSP（禁 unsafe-eval）环境自动安装 pixi.js/unsafe-eval 垫片后重试——
   *  Electron 加固壳/内嵌 webview 等宿主不再因 CSP 直接崩溃。 */
  async init(canvas?: HTMLCanvasElement): Promise<void> {
    const app = new Application();
    const resolution = typeof window !== 'undefined' && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
    const opts = {
      width: this.#w,
      height: this.#h,
      background: 0x000000,
      antialias: true,
      resolution,
      autoDensity: true,
      canvas,
    };
    try {
      await app.init(opts);
    } catch (err) {
      if (err instanceof Error && /unsafe-eval/i.test(err.message)) {
        // 垫片替换 pixi 内部的 Function 构造实现，对常规环境无副作用；安装后重试一次
        await import('pixi.js/unsafe-eval');
        await app.init(opts);
      } else {
        throw err;
      }
    }
    this.app = app;

    app.stage.addChild(this.#worldLayer, this.#particleLayer, this.#uiLayer);
    // flash 置最末：闪光覆盖全部 UI（黑场 fade 在其下，转场与闪光可叠加；tint 叠加在 fade 之上、flash 之下）
    this.#uiLayer.addChild(this.#speakerText, this.#dialogText, this.#fadeOverlay, this.#tintOverlay, this.#flashOverlay);
    this.#layout();
    return undefined;
  }

  /** 等比缩放画布 CSS 尺寸以适配窗口（保持 16:9，居中由宿主 CSS 负责）。
   *  内部分辨率保持 1280×720 逻辑尺寸，避免 UI 布局随窗口变化。 */
  fitWindow(): void {
    const canvas = this.app?.canvas;
    if (!canvas || typeof window === 'undefined') return;
    const scale = Math.min(window.innerWidth / this.#w, window.innerHeight / this.#h);
    canvas.style.width = `${Math.round(this.#w * scale)}px`;
    canvas.style.height = `${Math.round(this.#h * scale)}px`;
  }

  #layout(): void {
    // 名牌骑在对话框上沿：文本居于名牌底板内（底板绘制见 #drawSpeakerPlate）
    this.#speakerText.position.set(72, this.#h - 229);
    this.#dialogText.position.set(70, this.#h - 195);
    this.#dialogRubyLayer.position.set(70, this.#h - 195);
    // 选择肢列：对话框上方
    for (let i = 0; i < this.#choiceViews.length; i++) {
      this.#choiceViews[i]!.holder.position.set(90, this.#h - 320 + i * 56);
    }
  }

  /** 对话框玻璃面板绘制（分层：两段半透明 fill 近似纵向渐变玻璃底 + 1px 细描边 + 顶沿蔚蓝强调线） */
  #drawDialogPanel(): void {
    const x = 40;
    const y = this.#h - 210;
    const w = this.#w - 80;
    const h = 180;
    const r = 10;
    const g = this.#dialogPanel;
    g.clear();
    // 玻璃底：上段浅底 + 下段深色叠加，近似深蓝黑纵向渐变（v8 真渐变成本高，叠加口径足够）
    g.roundRect(x, y, w, h, r).fill({ color: NIGHT_AZURE.glassTop, alpha: 0.68 });
    // 下半深色层：手工路径（底边圆角与面板同半径，顶边直切）
    const y1 = y + h * 0.45;
    g.moveTo(x, y1)
      .lineTo(x + w, y1)
      .lineTo(x + w, y + h - r)
      .arc(x + w - r, y + h - r, r, 0, Math.PI / 2)
      .lineTo(x + r, y + h)
      .arc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
      .closePath()
      .fill({ color: NIGHT_AZURE.glassBottom, alpha: 0.5 });
    // 玻璃细描边
    g.roundRect(x, y, w, h, r).stroke({ width: 1, color: NIGHT_AZURE.glassEdge, alpha: 0.25 });
    // 顶沿蔚蓝强调线（内缩避免压住圆角与描边）
    g.roundRect(x + 24, y + 1, w - 48, 2, 1).fill({ color: NIGHT_AZURE.accent, alpha: 0.8 });
  }

  /** 说话人名牌底板绘制：有说话人时显示圆角胶囊（深蓝底 + 蔚蓝细边），否则隐藏。
   *  显隐同时受隐藏界面模式（H 键）与 NVL 模式约束。 */
  #drawSpeakerPlate(): void {
    const g = this.#speakerPlate;
    g.clear();
    const show = this.#speakerText.text.length > 0 && !this.#interfaceHidden && !this.#nvlActive;
    g.visible = show;
    if (!show) return;
    const x = 44;
    const y = this.#h - 236;
    const w = this.#speakerText.width + 56;
    const h = this.#speakerText.height + 14;
    g.roundRect(x, y, w, h, 8).fill({ color: NIGHT_AZURE.plate, alpha: 0.92 });
    g.roundRect(x, y, w, h, 8).stroke({ width: 1, color: NIGHT_AZURE.accent, alpha: 0.7 });
  }

  /**
   * 注册真实背景素材（URL 或已加载的 Texture）。之后 @bg key 使用真实素材而非程序化占位。
   * URL 通过 Pixi Assets 异步加载；清除同名占位缓存使下一次 setBackground 生效。
   */
  async registerBackground(key: string, src: string | Texture): Promise<void> {
    const tex = typeof src === 'string' ? await Assets.load(src) : src;
    this.#registeredBgs.set(key, tex);
    this.#bgTextureCache.delete(key);
  }

  /**
   * 自定义字体（M5 支柱4）：加载项目内嵌 woff2（游戏商用字体授权复杂，引擎必须允许自带字体文件），
   * 加载成功后设为全局默认字体；失败/超时静默回退系统字体（不白屏，只告警）。返回是否生效。
   * 宿主在渲染文本前调用（如 game.config.json 配置 font 字段指向 content/assets/fonts/*.woff2）。
   */
  async registerFont(url: string, family = 'SurdetGameFont', timeoutMs = 3000): Promise<boolean> {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false; // 非浏览器/测试环境
    try {
      const face = new FontFace(family, `url(${url})`);
      const loaded = await Promise.race([
        face.load(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('字体加载超时')), timeoutMs)),
      ]);
      (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded);
      // Pixi v8：改全局默认样式 → 之后新建的文本生效；对话框/说话人长驻对象直接改样式
      TextStyle.defaultTextStyle.fontFamily = family;
      this.#dialogText.style.fontFamily = family;
      this.#speakerText.style.fontFamily = family;
      return true;
    } catch (err) {
      console.warn('[PixiStage] 自定义字体加载失败，回退系统字体：', err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /**
   * 注册真实立绘素材（按 角色:服装:表情 精确匹配）。之后 @show charId:costume 对应表情
   * 使用真实素材而非程序化占位。URL 通过 Pixi Assets 异步加载。
   */
  async registerPortrait(charId: string, costume: string, expression: string, src: string | Texture): Promise<void> {
    const tex = typeof src === 'string' ? await Assets.load(src) : src;
    this.#registeredPortraits.set(`${charId}:${costume}:${expression}`, tex);
    this.#portraitTextureCache.delete(`${charId}:${costume}:${expression}`);
  }

  setBackground(key: string | null): void {
    if (this.#bgSprite) {
      this.#bgLayer.removeChild(this.#bgSprite);
      this.#bgSprite.destroy(); // 纹理由缓存共享，不随 sprite 释放
      this.#bgSprite = null;
    }
    if (key === null || key.length === 0) return;
    const texture = this.#registeredBgs.get(key)
      ?? this.#bgTextureCache.get(key)
      ?? makeBackgroundTexture(key, this.#w, this.#h);
    this.#bgTextureCache.set(key, texture);
    const sprite = new Sprite(texture);
    sprite.width = this.#w;
    sprite.height = this.#h;
    this.#bgSprite = sprite;
    this.#bgLayer.addChildAt(sprite, 0);
  }

  setPortrait(key: string, opts: PortraitView): void {
    const cacheKey = `${opts.charId}:${opts.costume}:${opts.expression}`;
    let texture = this.#registeredPortraits.get(cacheKey)
      ?? this.#portraitTextureCache.get(cacheKey);
    if (!texture) {
      texture = makePortraitTexture(opts.charId, opts.costume, opts.expression);
      this.#portraitTextureCache.set(cacheKey, texture);
    }
    const pw = 340;
    const ph = (texture.height / texture.width) * pw;
    const baseY = this.#h * 0.82;
    const px = opts.pos === 'left' ? this.#w * 0.24 : opts.pos === 'right' ? this.#w * 0.76 : this.#w * 0.5;
    const existing = this.#portraitSprites.get(key);
    if (!existing) {
      const sprite = new Sprite(texture);
      sprite.width = pw;
      sprite.height = ph;
      sprite.anchor.set(0.5, 1);
      sprite.position.set(px, baseY);
      this.#portraitSprites.set(key, sprite);
      this.#portraitLayer.addChild(sprite);
      return;
    }
    if (existing.texture === texture) {
      // 同纹理：仅移动（位置/尺寸无需过渡）
      existing.position.set(px, baseY);
      return;
    }
    // 纹理变化：交叉淡化（新 sprite 淡入，旧 sprite 淡出后销毁；补间在 updateEffects 推进）
    const neu = new Sprite(texture);
    neu.width = pw;
    neu.height = ph;
    neu.anchor.set(0.5, 1);
    neu.position.set(px, baseY);
    neu.alpha = 0;
    this.#portraitLayer.addChild(neu);
    this.#portraitSprites.set(key, neu);
    this.#portraitTweens.push({ old: existing, neu, remain: 260, dur: 260 });
  }

  removePortrait(key: string): void {
    // key 契约：完整 `角色:服装`（与 setPortrait 第一参数一致）精确移除；
    // 纯角色 ID（规范写法 @hide lynn）移除该角色全部立绘——否则 @show lynn:armor
    // 之后 @hide lynn 查不到 'lynn:armor'，立绘永不消失（静默演出 bug）。
    const keys = this.#portraitSprites.has(key)
      ? [key]
      : [...this.#portraitSprites.keys()].filter((k) => k === key || k.startsWith(`${key}:`));
    for (const k of keys) {
      const sprite = this.#portraitSprites.get(k)!;
      this.#portraitLayer.removeChild(sprite);
      sprite.destroy(); // 纹理由缓存共享，不随 sprite 释放
      this.#portraitSprites.delete(k);
    }
  }

  showText(speaker: string | null, value: string): void {
    this.#speakerText.text = speaker ?? '';
    this.#drawSpeakerPlate();
    this.#renderDialogText(value);
    // 有文本内容即显示对话框面板；清空时若不在等待推进状态则隐藏
    this.#dialogPanel.visible = (speaker ?? '').length > 0 || value.length > 0 || this.#continueIndicator.visible;
    if (this.#interfaceHidden) {
      // 隐藏界面模式：投影内容照常更新，但可见性保持隐藏（H 键赏画不被新文本打断）
      this.#dialogPanel.visible = false;
      this.#speakerPlate.visible = false;
      this.#speakerText.visible = false;
      this.#dialogText.visible = false;
      this.#dialogRubyLayer.visible = false;
    }
  }

  /** 对话文本渲染：含 基础字《注音》 标记时走 ruby 合成层（主字 + 上方小字）。
   *  打字中途标记未闭合时先按纯文本渲染（stripRuby），完成后自然切换为注音形态。 */
  #renderDialogText(value: string): void {
    const unclosed = value.split('《').length !== value.split('》').length;
    const segs = unclosed ? [] : parseRuby(value);
    const hasRuby = segs.some((s) => s.ruby !== undefined);
    if (!hasRuby) {
      this.#clearRubyLayer();
      this.#dialogText.visible = true;
      const plain = unclosed ? stripRuby(value) : value;
      // 断行禁则（M5 支柱4）：禁则字不挂行首/行尾，……——不拆行；
      // 像素级测量断行（canvas measureText，中英混排精确）；无 DOM 环境降级字数估算
      this.#dialogText.text = this.#wrapDialogText(plain).join('\n');
      return;
    }
    this.#dialogText.visible = false;
    this.#dialogText.text = '';
    this.#clearRubyLayer();
    let x = 0;
    for (const seg of segs) {
      const base = new PText({
        text: seg.base,
        style: {
          fontSize: 26,
          fill: NIGHT_AZURE.text,
          lineHeight: 46,
          dropShadow: { alpha: 0.35, blur: 6, distance: 2, color: 0x020409 },
        } satisfies TextStyleOptions,
      });
      base.position.set(x, 0);
      this.#dialogRubyLayer.addChild(base);
      if (seg.ruby !== undefined) {
        const r = new PText({
          text: seg.ruby,
          style: { fontSize: 13, fill: NIGHT_AZURE.text } satisfies TextStyleOptions,
        });
        r.anchor.set(0.5, 1);
        r.position.set(x + base.width / 2, -2);
        this.#dialogRubyLayer.addChild(r);
      }
      x += base.width;
    }
  }

  #clearRubyLayer(): void {
    this.#dialogRubyLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
  }

  /** 点击等待指示器可见性（▼；同时决定面板是否保持显示） */
  setAwaiting(awaiting: boolean): void {
    if (this.#nvlActive) return; // NVL 页不使用对话面板/指示器
    if (this.#interfaceHidden) return; // 隐藏界面模式（H 键赏画）：指示器保持隐藏
    this.#continueIndicator.visible = awaiting;
    if (awaiting) this.#dialogPanel.visible = true;
    else if (
      this.#speakerText.text.length === 0
      && this.#dialogText.text.length === 0
    ) this.#dialogPanel.visible = false;
  }

  /** ▼ 呼吸浮动动画（由 AdvRenderer 每帧转发 ticker delta） */
  updateContinuePulse(deltaMs: number): void {
    if (!this.#continueIndicator.visible) return;
    this.#continuePhase = (this.#continuePhase + deltaMs / 1000 * 4) % (Math.PI * 2);
    this.#continueIndicator.y = this.#h - 44 + Math.sin(this.#continuePhase) * 4;
  }

  /** 展示 Backlog 覆盖层（半透明黑底 + 最近 N 条，CJK 按字符数软换行；点击任意处关闭）。
   *  onReplayVoice：点击带语音标记的行重播（@voice 紧跟的文本行） */
  showBacklog(entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void): void {
    const layer = this.#backlogLayer;
    if (!this.#backlogBuilt) {
      layer.eventMode = 'static';
      // 滚轮滚动条目（不冒泡为点击关闭）；空白处点击关闭
      layer.on('wheel', (e: WheelEvent) => {
        this.scrollBacklog(e.deltaY > 0 ? 120 : -120);
      });
      layer.on('pointerdown', () => { layer.visible = false; });
      this.#backlogBuilt = true;
    }
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x000000, alpha: 0.82 }));
    layer.addChild(new PText({
      text: '文字记录（滚轮/PageUp/PageDown 滚动 · 点击任意处关闭）',
      style: { fontSize: 22, fill: 0xffe8c8, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 30);
    // 条目层（整体滚动；CJK 断行禁则软换行，M5 支柱4：标点不挂行首/行尾，……不拆）
    const entriesLayer = new Container();
    const perLine = 40;
    let y = 0;
    for (const e of entries.slice(-120)) {
      const text = e.text.length > 0 ? e.text : '（无文本）';
      let first = true;
      for (const line of wrapCjk(text, perLine)) {
        const lineText = (first && e.speaker ? `${e.speaker}：` : '') + line;
        const t = new PText({
          text: first && e.voice ? `▶ ${lineText}` : lineText,
          style: {
            fontSize: 20,
            fill: first && e.speaker ? 0xffe8c8 : 0xdddddd,
            fontWeight: first && e.speaker ? 'bold' : 'normal',
          } satisfies TextStyleOptions,
        });
        t.position.set(60, 84 + y);
        if (first && e.voice && onReplayVoice) {
          // 点击行首播放图标区重播语音（阻止冒泡到层关闭）
          t.eventMode = 'static';
          t.cursor = 'pointer';
          t.on('pointerdown', (ev) => {
            ev.stopPropagation();
            onReplayVoice(e.voice!);
          });
        }
        entriesLayer.addChild(t);
        y += 34;
        first = false;
      }
    }
    this.#backlogContentH = y;
    this.#backlogScroll = 0;
    this.#applyBacklogScroll();
    this.#backlogEntriesLayer = entriesLayer;
    layer.addChild(entriesLayer);
    layer.visible = true;
  }

  /** 隐藏/恢复对话界面（H 键惯例：隐藏对话框/说话人栏/等待指示器；背景立绘/粒子保留供赏画） */
  hideInterface(hidden: boolean): void {
    this.#interfaceHidden = hidden;
    this.#dialogPanel.visible = !hidden;
    this.#speakerText.visible = !hidden;
    this.#dialogText.visible = !hidden;
    this.#dialogRubyLayer.visible = !hidden;
    this.#continueIndicator.visible = !hidden;
    this.#drawSpeakerPlate();
  }

  /** Backlog 滚动：delta 正数向下（看更旧内容方向为向上滚 → 负 delta），clamp 到内容范围 */
  scrollBacklog(delta: number): void {
    if (!this.#backlogEntriesLayer || !this.#backlogLayer.visible) return;
    const viewH = this.#h - 120;
    const maxScroll = Math.max(0, this.#backlogContentH - viewH);
    this.#backlogScroll = Math.max(-maxScroll, Math.min(0, this.#backlogScroll - delta));
    this.#applyBacklogScroll();
  }

  #applyBacklogScroll(): void {
    if (this.#backlogEntriesLayer) this.#backlogEntriesLayer.position.set(0, this.#backlogScroll);
  }

  /** 舞台截图缩略图（存档预览用）：整屏截图缩到宽 ≤320 的 JPEG dataURL；失败返回 null */
  captureThumbnail(): string | null {
    if (!this.app || typeof document === 'undefined') return null;
    try {
      const extract = this.app.renderer.extract as unknown as {
        canvas: (opts: { target: unknown }) => HTMLCanvasElement;
      };
      const src = extract.canvas({ target: this.app.stage });
      const scale = Math.min(1, 320 / src.width);
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(src.width * scale));
      small.height = Math.max(1, Math.round(src.height * scale));
      const ctx = small.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(src, 0, 0, small.width, small.height);
      return small.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }

  /** 隐藏 Backlog 覆盖层 */
  hideBacklog(): void {
    this.#backlogLayer.visible = false;
  }

  /* ============================ 演出效果（@shake/@flash/@zoom） ============================ */

  /** 画面震动：world 层随机偏移，振幅随时间线性衰减（演出冲击感） */
  shake(durMs = 400, strength = 8): void {
    this.#shakeDur = Math.max(1, durMs);
    this.#shakeRemain = this.#shakeDur;
    this.#shakeStrength = Math.max(0, Math.min(strength, 64));
  }

  /** 白闪：全屏白色叠加 alpha 从 1 线性衰减到 0 */
  flash(durMs = 300): void {
    this.#flashDur = Math.max(1, durMs);
    this.#flashRemain = this.#flashDur;
    this.#flashOverlay.alpha = 1;
  }

  /** 缩放：world 层向目标 scale 线性过渡（以画面中心为锚点）。scale=1 复位 */
  zoom(scale = 1, durMs = 400): void {
    this.#zoomFrom = this.#worldLayer.scale.x;
    this.#zoomTo = Math.max(0.25, Math.min(4, scale));
    this.#zoomDur = Math.max(1, durMs);
    this.#zoomRemain = this.#zoomDur;
  }

  /** 演出效果时间轴推进（AdvRenderer 每帧转发 ticker delta） */
  updateEffects(deltaMs: number): void {
    if (this.#shakeRemain > 0) {
      this.#shakeRemain = Math.max(0, this.#shakeRemain - deltaMs);
      const base = this.#zoomBaseOffset();
      if (this.#shakeRemain === 0) {
        this.#worldLayer.position.set(base.x, base.y);
      } else {
        const s = this.#shakeStrength * (this.#shakeRemain / this.#shakeDur);
        this.#worldLayer.position.set(
          base.x + (Math.random() * 2 - 1) * s,
          base.y + (Math.random() * 2 - 1) * s,
        );
      }
    }
    if (this.#flashRemain > 0) {
      this.#flashRemain = Math.max(0, this.#flashRemain - deltaMs);
      this.#flashOverlay.alpha = this.#flashRemain / this.#flashDur;
    }
    if (this.#zoomRemain > 0) {
      this.#zoomRemain = Math.max(0, this.#zoomRemain - deltaMs);
      const t = 1 - this.#zoomRemain / this.#zoomDur;
      const scale = this.#zoomFrom + (this.#zoomTo - this.#zoomFrom) * t;
      this.#worldLayer.scale.set(scale);
      const off = this.#zoomBaseOffset();
      this.#worldLayer.position.set(off.x, off.y);
    }
    this.#updateTransient(deltaMs);
  }

  /** @wipe：黑色竖条自左向右扫过画面（转场仪式感） */
  wipe(durMs = 600): void {
    this.#wipeDur = Math.max(1, durMs);
    this.#wipeRemain = this.#wipeDur;
    this.#wipeBar.visible = true;
  }

  /* ============================ 演出扩展（@mov/@tint/@particle） ============================ */

  /** @mov：立绘位置平移（key 契约同 removePortrait：完整 `角色:服装` 精确；纯角色 ID 移动该角色全部立绘）。
   *  pos = left/center/right（三档预设）或裸数字（逻辑像素 X 坐标）；durMs 线性过渡。 */
  movePortrait(key: string, pos: string, durMs = 400): void {
    const targetX = this.#resolvePortraitX(pos);
    if (targetX === null) return;
    const keys = this.#portraitSprites.has(key)
      ? [key]
      : [...this.#portraitSprites.keys()].filter((k) => k.startsWith(`${key}:`));
    const dur = Math.max(1, durMs);
    for (const k of keys) {
      const sprite = this.#portraitSprites.get(k)!;
      // 重复 @mov 同一立绘：丢弃进行中的旧补间，从当前位置重新起步（不叠加抖动）
      this.#movTweens = this.#movTweens.filter((tw) => tw.sprite !== sprite);
      this.#movTweens.push({ sprite, fromX: sprite.x, toX: targetX, remain: dur, dur });
    }
  }

  /** 位置解析：三档预设 → 与 setPortrait 一致的 X；纯数字 → 逻辑像素坐标；其余 → null（忽略） */
  #resolvePortraitX(pos: string): number | null {
    if (pos === 'left') return this.#w * 0.24;
    if (pos === 'right') return this.#w * 0.76;
    if (pos === 'center') return this.#w * 0.5;
    const n = Number(pos);
    return Number.isFinite(n) ? n : null;
  }

  /** @tint：画面调色叠加（全屏颜色叠加 alpha 线性过渡到目标；颜色通道同步过渡） */
  setTint(color: number, alpha: number, durMs = 400): void {
    const cur = this.#tintCurrent();
    this.#tintFrom = cur;
    this.#tintTo = { color: color & 0xffffff, alpha: Math.max(0, Math.min(1, alpha)) };
    this.#tintDur = Math.max(1, durMs);
    this.#tintRemain = this.#tintDur;
    this.#tintOverlay.visible = true;
  }

  /** @tint off：淡出调色叠加到全透明 */
  clearTint(durMs = 400): void {
    this.setTint(this.#tintCurrent().color, 0, durMs);
  }

  /** 当前 tint 实际状态（过渡中取插值，便于从中间状态重新起步） */
  #tintCurrent(): { color: number; alpha: number } {
    if (this.#tintRemain <= 0) return { ...this.#tintTo };
    const t = 1 - this.#tintRemain / this.#tintDur;
    return {
      color: lerpColor(this.#tintFrom.color, this.#tintTo.color, t),
      alpha: this.#tintFrom.alpha + (this.#tintTo.alpha - this.#tintFrom.alpha) * t,
    };
  }

  /** @particle：启动预设粒子效果（snow/rain/sakura/sparkle/fireflies）。
   *  程序化实现（每粒子独立 Graphics，无纹理/Assets 依赖）；重复调用同名预设幂等，切换预设重建。 */
  startParticles(kind: string): void {
    if (this.#particleKind === kind) return; // 幂等
    this.stopParticles();
    const preset = PARTICLE_PRESETS[kind];
    if (!preset) return; // 未知预设静默忽略（占位策略）
    this.#particleKind = kind;
    for (let i = 0; i < preset.count; i++) {
      const scale = 0.6 + Math.random() * 0.8;
      const r = preset.size * scale;
      const g = preset.elongated
        ? new Graphics().rect(-0.8, -r * 3, 1.6, r * 6).fill({ color: preset.color, alpha: 0.75 })
        : new Graphics().circle(0, 0, r).fill({ color: preset.color, alpha: 1 });
      g.alpha = 0.55 + Math.random() * 0.45;
      g.position.set(Math.random() * this.#w, Math.random() * this.#h);
      this.#particleLayer.addChild(g);
      this.#particles.push({
        sprite: g,
        vx: (Math.random() - 0.5) * preset.sway,
        vy: preset.vy * (0.7 + Math.random() * 0.6),
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.#particlePreset = preset;
  }

  /** @particle off：停止并清空粒子 */
  stopParticles(): void {
    for (const p of this.#particles) {
      this.#particleLayer.removeChild(p.sprite);
      p.sprite.destroy();
    }
    this.#particles = [];
    this.#particleKind = null;
    this.#particlePreset = null;
  }

  /** 横幅：chapter 变体居中大字，tip 变体右上小字；末段淡出 */
  showBanner(text: string, variant: 'chapter' | 'tip'): void {
    if (text.length === 0) return;
    this.#bannerText.text = text;
    this.#bannerText.style = variant === 'chapter'
      ? { fontSize: 40, fill: 0xffffff, fontWeight: 'bold' } satisfies TextStyleOptions
      : { fontSize: 20, fill: 0xffe8c8 } satisfies TextStyleOptions;
    if (variant === 'chapter') {
      this.#bannerText.position.set(this.#w / 2, this.#h * 0.4);
    } else {
      this.#bannerText.anchor.set(1, 0);
      this.#bannerText.position.set(this.#w - 60, 40);
    }
    if (variant === 'chapter') this.#bannerText.anchor.set(0.5);
    this.#bannerDur = variant === 'chapter' ? 2200 : 1800;
    this.#bannerRemain = this.#bannerDur;
    this.#bannerLayer.visible = true;
    this.#bannerLayer.alpha = 1;
  }

  /** NVL 模式：开启时隐藏对话框，全屏半透明文本页；关闭时恢复 */
  setNvlMode(on: boolean): void {
    this.#nvlActive = on;
    if (on) {
      this.clearNvlText();
      this.#nvlLayer.visible = true;
      this.#dialogPanel.visible = false;
      this.#speakerPlate.visible = false;
      this.#speakerText.visible = false;
      this.#dialogText.visible = false;
      this.#dialogRubyLayer.visible = false;
      this.#continueIndicator.visible = false;
    } else {
      this.#nvlLayer.visible = false;
      this.#speakerText.visible = true;
      this.#dialogText.visible = true;
      this.#dialogRubyLayer.visible = true;
      this.#drawSpeakerPlate();
    }
  }

  /** NVL 页条目列表（只读引用；测试断言与宿主持久化巡检用） */
  get nvlLines(): readonly PText[] {
    return this.#nvlLines;
  }

  /** NVL 页追加一条（wrapCjk 预断行；按折行数累计排布；超出屏幕底边淘汰最旧） */
  appendNvlText(speaker: string | null, text: string): void {
    const raw = speaker !== null && speaker.length > 0 ? `${speaker}：${text}` : text;
    // 断行禁则（对齐 M5 支柱4 对话框/Backlog）：禁则字不挂行首/行尾，……——不拆行
    const wrapped = wrapCjk(raw, this.#nvlCharsPerLine);
    const t = new PText({
      text: wrapped.join('\n'),
      style: { fontSize: 20, fill: 0xf0f0f0 } satisfies TextStyleOptions,
    });
    this.#nvlLayer.addChild(t);
    this.#nvlLines.push(t);
    this.#nvlLineCounts.push(Math.max(1, wrapped.length));
    // 超底边淘汰最旧（按折行后的实际行高计算，保底至少留当前条）
    const budget = this.#h - 120; // 上下各留 60 边距
    while (this.#nvlTotalHeight() > budget && this.#nvlLines.length > 1) {
      const old = this.#nvlLines.shift()!;
      this.#nvlLineCounts.shift();
      this.#nvlLayer.removeChild(old);
      old.destroy();
    }
    // 累计排布：条目按实际折行数占高（替代旧定步长 i*35，多行条目不再重叠）
    const lineHeight = 28; // ≥ Pixi fontSize 20 的实际行高，留行间距
    const entryGap = 6;    // 条目之间的额外间隙
    let y = 60;
    this.#nvlLines.forEach((l, i) => {
      l.position.set(80, y);
      y += this.#nvlLineCounts[i]! * lineHeight + entryGap;
    });
  }

  /** NVL 页当前占用总行高（淘汰判断用；行高口径与排布一致） */
  #nvlTotalHeight(): number {
    let h = 0;
    for (const n of this.#nvlLineCounts) h += n * 28 + 6;
    return h;
  }

  /** NVL 页清空（@nvl clear） */
  clearNvlText(): void {
    for (const l of this.#nvlLines) {
      this.#nvlLayer.removeChild(l);
      l.destroy();
    }
    this.#nvlLines = [];
    this.#nvlLineCounts = [];
  }

  /** 强制停止当前 @video（读档作废：渲染层回调已被会话令牌拦截，此处移除画面本体；审计复核） */
  hideVideo(): void {
    if (!this.#activeVideo) return;
    const v = this.#activeVideo;
    this.#activeVideo = null;
    v.pause();
    v.remove();
  }

  /** @video：DOM <video> 覆盖全屏播放；结束/出错/点击跳过均回调 onEnd（素材缺失自动跳过不阻塞） */
  showVideo(src: string, onEnd: () => void): void {
    if (typeof document === 'undefined') {
      onEnd();
      return;
    }
    const v = document.createElement('video');
    v.src = src;
    v.autoplay = true;
    v.playsInline = true;
    Object.assign(v.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      background: '#000',
      zIndex: '1000',
    });
    this.#activeVideo = v;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      if (this.#activeVideo === v) this.#activeVideo = null;
      v.remove();
      onEnd();
    };
    v.addEventListener('ended', finish);
    v.addEventListener('error', finish);
    v.addEventListener('pointerdown', finish);
    document.body.appendChild(v);
    void v.play().catch(finish);
  }

  /** 横幅/wipe/tint/mov/粒子 时间轴推进（并入 updateEffects 调用链） */
  #updateTransient(deltaMs: number): void {
    // @tint 调色过渡（颜色通道与 alpha 同步 lerp；alpha 归零后隐藏叠加层）
    if (this.#tintRemain > 0) {
      this.#tintRemain = Math.max(0, this.#tintRemain - deltaMs);
      const t = 1 - this.#tintRemain / this.#tintDur;
      const color = lerpColor(this.#tintFrom.color, this.#tintTo.color, t);
      const alpha = this.#tintFrom.alpha + (this.#tintTo.alpha - this.#tintFrom.alpha) * t;
      this.#tintOverlay.tint = color;
      this.#tintOverlay.alpha = alpha;
      if (this.#tintRemain === 0 && alpha <= 0.001) this.#tintOverlay.visible = false;
    }
    // @mov 立绘平移补间（水平线性过渡；垂直基线不变）
    if (this.#movTweens.length > 0) {
      for (let i = this.#movTweens.length - 1; i >= 0; i--) {
        const tw = this.#movTweens[i]!;
        tw.remain = Math.max(0, tw.remain - deltaMs);
        const t = 1 - tw.remain / tw.dur;
        tw.sprite.x = tw.fromX + (tw.toX - tw.fromX) * t;
        if (tw.remain === 0) this.#movTweens.splice(i, 1);
      }
    }
    // @particle 粒子漂移（delta 归一到 60fps 帧单位；出界回绕到对边，循环飘动）
    if (this.#particles.length > 0) {
      const frames = deltaMs / 16.667;
      for (const p of this.#particles) {
        p.phase += 0.02 * frames;
        p.sprite.x += (p.vx + Math.sin(p.phase) * this.#particleSwing()) * frames;
        p.sprite.y += p.vy * frames;
        if (p.sprite.y > this.#h + 12) {
          p.sprite.y = -10;
          p.sprite.x = Math.random() * this.#w;
        } else if (p.sprite.y < -14) {
          p.sprite.y = this.#h + 10;
          p.sprite.x = Math.random() * this.#w;
        }
        if (p.sprite.x > this.#w + 12) p.sprite.x = -10;
        else if (p.sprite.x < -12) p.sprite.x = this.#w + 10;
      }
    }
    // 立绘交叉淡化补间
    if (this.#portraitTweens.length > 0) {
      const done: { old: Sprite; neu: Sprite; remain: number; dur: number }[] = [];
      for (const tw of this.#portraitTweens) {
        tw.remain = Math.max(0, tw.remain - deltaMs);
        const t = 1 - tw.remain / tw.dur;
        tw.neu.alpha = t;
        tw.old.alpha = 1 - t;
        if (tw.remain === 0) done.push(tw);
      }
      for (const tw of done) {
        this.#portraitLayer.removeChild(tw.old);
        tw.old.destroy();
        this.#portraitTweens.splice(this.#portraitTweens.indexOf(tw), 1);
      }
    }
    if (this.#bannerRemain > 0) {
      this.#bannerRemain = Math.max(0, this.#bannerRemain - deltaMs);
      this.#bannerLayer.alpha = Math.min(1, this.#bannerRemain / 400);
      if (this.#bannerRemain === 0) this.#bannerLayer.visible = false;
    }
    if (this.#wipeRemain > 0) {
      this.#wipeRemain = Math.max(0, this.#wipeRemain - deltaMs);
      const p = 1 - this.#wipeRemain / this.#wipeDur;
      this.#wipeBar.position.set(-this.#w + p * this.#w * 2, 0);
      if (this.#wipeRemain === 0) {
        this.#wipeBar.visible = false;
        this.#wipeBar.position.set(0, 0);
      }
    }
  }

  /** 粒子横向摆动幅度（像素/帧）：来自当前预设，无预设时 0 */
  #particleSwing(): number {
    return this.#particlePreset?.sway ?? 0;
  }

  /** 当前缩放下的居中偏移（缩放锚点为画面中心；shake 结束回位也用） */
  #zoomBaseOffset(): { x: number; y: number } {
    const scale = this.#worldLayer.scale.x;
    return { x: ((1 - scale) * this.#w) / 2, y: ((1 - scale) * this.#h) / 2 };
  }

  /* ============================ 鉴赏覆盖层（CG/音乐） ============================ */

  /** 展示鉴赏界面：CG/音乐/文本 三个 tab；CG 全屏回看、音乐播放、文本跳回场景重播 */
  showGallery(opts: {
    cgs: GalleryItemView[];
    music: GalleryItemView[];
    texts?: GalleryItemView[];
    onPlayMusic?: (id: string, src?: string) => void;
    onReplayText?: (item: GalleryItemView) => void;
  }): void {
    this.#galleryViews = { cgs: opts.cgs, music: opts.music, texts: opts.texts ?? [] };
    this.#galleryOnPlayMusic = opts.onPlayMusic ?? null;
    this.#galleryOnReplayText = opts.onReplayText ?? null;
    this.#galleryMode = 'grid';
    this.#galleryViewerKey = null;
    this.#rebuildGallery();
    this.#galleryLayer.visible = true;
  }

  /** 隐藏鉴赏界面 */
  hideGallery(): void {
    this.#galleryLayer.visible = false;
  }

  #rebuildGallery(): void {
    const layer = this.#galleryLayer;
    layer.removeAllListeners();
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (!this.#galleryViews) return;
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x0a0a12, alpha: 0.95 }));

    const mkBtn = (label: string, x: number, active: boolean, onTap: () => void): PText => {
      const t = new PText({
        text: label,
        style: { fontSize: 24, fill: active ? 0xffe8c8 : 0x8a8a96, fontWeight: active ? 'bold' : 'normal' } satisfies TextStyleOptions,
      });
      t.position.set(x, 30);
      t.eventMode = 'static';
      t.cursor = 'pointer';
      t.on('pointerdown', onTap);
      return t;
    };
    layer.addChild(mkBtn('CG', 60, this.#galleryTab === 'cg', () => {
      this.#galleryTab = 'cg';
      this.#galleryMode = 'grid';
      this.#rebuildGallery();
    }));
    layer.addChild(mkBtn('音乐', 150, this.#galleryTab === 'music', () => {
      this.#galleryTab = 'music';
      this.#galleryMode = 'grid';
      this.#rebuildGallery();
    }));
    layer.addChild(mkBtn('文本', 240, this.#galleryTab === 'text', () => {
      this.#galleryTab = 'text';
      this.#galleryMode = 'grid';
      this.#rebuildGallery();
    }));
    layer.addChild(mkBtn('✕ 关闭', this.#w - 150, false, () => { this.#galleryLayer.visible = false; }));

    if (this.#galleryMode === 'viewer' && this.#galleryViewerKey !== null) {
      this.#buildGalleryViewer(layer, this.#galleryViewerKey);
      return;
    }

    if (this.#galleryTab === 'cg') {
      const items = this.#galleryViews.cgs;
      if (items.length === 0) {
        layer.addChild(new PText({ text: '暂无 CG 条目（gallery.json 未配置）', style: { fontSize: 20, fill: 0x8a8a96 } satisfies TextStyleOptions })).position.set(60, 100);
        return;
      }
      const cols = 4;
      const cw = 270;
      const ch = 152;
      items.forEach((item, i) => {
        const x = 60 + (i % cols) * (cw + 20);
        const y = 96 + Math.floor(i / cols) * (ch + 48);
        const cell = new Container();
        cell.position.set(x, y);
        if (item.unlocked) {
          const key = item.src ?? item.id;
          const tex = this.#registeredBgs.get(key)
            ?? this.#bgTextureCache.get(key)
            ?? makeBackgroundTexture(key, 320, 180);
          if (!this.#registeredBgs.has(key) && !this.#bgTextureCache.has(key)) {
            this.#bgTextureCache.set(key, tex);
          }
          const sp = new Sprite(tex);
          sp.width = cw;
          sp.height = ch;
          cell.addChild(sp);
          cell.eventMode = 'static';
          cell.cursor = 'pointer';
          cell.on('pointerdown', () => {
            this.#galleryMode = 'viewer';
            this.#galleryViewerKey = key;
            this.#rebuildGallery();
          });
        } else {
          cell.addChild(new Graphics().rect(0, 0, cw, ch).fill({ color: 0x1c1c26, alpha: 1 }));
          cell.addChild(new PText({ text: '?', style: { fontSize: 42, fill: 0x55555f } satisfies TextStyleOptions })).position.set(cw / 2 - 12, ch / 2 - 30);
        }
        cell.addChild(new PText({
          text: item.unlocked ? item.name : '???',
          style: { fontSize: 18, fill: item.unlocked ? 0xdddddd : 0x55555f } satisfies TextStyleOptions,
        })).position.set(0, ch + 10);
        layer.addChild(cell);
      });
      return;
    }

    // 音乐 tab：条目行，已解锁可点击播放
    if (this.#galleryTab === 'music') {
      const items = this.#galleryViews.music;
      if (items.length === 0) {
        layer.addChild(new PText({ text: '暂无音乐条目（gallery.json 未配置）', style: { fontSize: 20, fill: 0x8a8a96 } satisfies TextStyleOptions })).position.set(60, 100);
        return;
      }
      items.forEach((item, i) => {
        const y = 96 + i * 58;
        const row = new Container();
        row.position.set(60, y);
        row.addChild(new Graphics().roundRect(0, 0, 720, 46, 8).fill({ color: item.unlocked ? 0x1e1e2c : 0x14141a, alpha: 0.95 }));
        row.addChild(new PText({
          text: `${item.unlocked ? '♪' : '?'}  ${item.unlocked ? item.name : '???'}`,
          style: { fontSize: 20, fill: item.unlocked ? 0xffffff : 0x55555f } satisfies TextStyleOptions,
        })).position.set(18, 10);
        if (item.unlocked) {
          row.eventMode = 'static';
          row.cursor = 'pointer';
          row.on('pointerdown', () => this.#galleryOnPlayMusic?.(item.id, item.src));
        }
        layer.addChild(row);
      });
      return;
    }

    // 文本 tab：回想条目，已解锁可点击跳回场景重播
    const items = this.#galleryViews.texts;
    if (items.length === 0) {
      layer.addChild(new PText({ text: '暂无文本回想条目（gallery.json 未配置 texts）', style: { fontSize: 20, fill: 0x8a8a96 } satisfies TextStyleOptions })).position.set(60, 100);
      return;
    }
    items.forEach((item, i) => {
      const y = 96 + i * 58;
      const row = new Container();
      row.position.set(60, y);
      row.addChild(new Graphics().roundRect(0, 0, 720, 46, 8).fill({ color: item.unlocked ? 0x1e1e2c : 0x14141a, alpha: 0.95 }));
      row.addChild(new PText({
        text: `${item.unlocked ? '❐' : '?'}  ${item.unlocked ? item.name : '???'}`,
        style: { fontSize: 20, fill: item.unlocked ? 0xffffff : 0x55555f } satisfies TextStyleOptions,
      })).position.set(18, 10);
      if (item.unlocked) {
        row.eventMode = 'static';
        row.cursor = 'pointer';
        row.on('pointerdown', () => this.#galleryOnReplayText?.(item));
      }
      layer.addChild(row);
    });
  }

  /** CG 全屏回看：优先注册的真实素材，未注册回退程序化占位；点击任意处返回列表 */
  #buildGalleryViewer(layer: Container, key: string): void {
    const tex = this.#registeredBgs.get(key)
      ?? this.#bgTextureCache.get(key)
      ?? makeBackgroundTexture(key, this.#w, this.#h);
    if (!this.#registeredBgs.has(key) && !this.#bgTextureCache.has(key)) {
      this.#bgTextureCache.set(key, tex);
    }
    const sp = new Sprite(tex);
    sp.width = this.#w;
    sp.height = this.#h;
    layer.addChild(sp);
    layer.addChild(new PText({
      text: '点击任意处返回列表',
      style: { fontSize: 20, fill: 0xffffff } satisfies TextStyleOptions,
    })).position.set(this.#w - 250, this.#h - 44);
    layer.eventMode = 'static';
    layer.on('pointerdown', () => {
      this.#galleryMode = 'grid';
      this.#galleryViewerKey = null;
      this.#rebuildGallery();
    });
  }

  /* ============================ 设置面板 ============================ */

  /** 展示设置面板：◀ ▶ 步进各行；onChange 交宿主改值后应重新调用本方法刷新展示 */
  showSettings(rows: SettingsRowView[], onChange: (id: string, dir: -1 | 1) => void, onClose: () => void): void {
    this.#settingsRows = rows;
    this.#settingsHandlers = { onChange, onClose };
    this.#rebuildSettings();
    this.#settingsLayer.visible = true;
  }

  /** 隐藏设置面板 */
  hideSettings(): void {
    this.#settingsLayer.visible = false;
  }

  #rebuildSettings(): void {
    const layer = this.#settingsLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const px = this.#w / 2 - 320;
    const panelH = 130 + this.#settingsRows.length * 52 + 40;
    layer.addChild(new Graphics().roundRect(px, 110, 640, panelH, 14).fill({ color: 0x101018, alpha: 0.97 }));
    layer.addChild(new PText({ text: '设 置', style: { fontSize: 28, fill: 0xffe8c8, fontWeight: 'bold' } satisfies TextStyleOptions })).position.set(this.#w / 2 - 42, 132);
    const close = new PText({ text: '✕', style: { fontSize: 26, fill: 0x8a8a96 } satisfies TextStyleOptions });
    close.position.set(px + 596, 132);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointerdown', () => {
      this.#settingsLayer.visible = false;
      this.#settingsHandlers?.onClose();
    });
    layer.addChild(close);

    this.#settingsRows.forEach((row, i) => {
      const y = 196 + i * 52;
      layer.addChild(new PText({ text: row.label, style: { fontSize: 22, fill: 0xdddddd } satisfies TextStyleOptions })).position.set(px + 48, y);
      const left = new PText({ text: '◀', style: { fontSize: 22, fill: 0xffe8c8 } satisfies TextStyleOptions });
      left.position.set(px + 320, y);
      left.eventMode = 'static';
      left.cursor = 'pointer';
      left.on('pointerdown', () => this.#settingsHandlers?.onChange(row.id, -1));
      const value = new PText({ text: row.display, style: { fontSize: 22, fill: 0xffffff } satisfies TextStyleOptions });
      value.anchor.set(0.5, 0);
      value.position.set(px + 420, y);
      const right = new PText({ text: '▶', style: { fontSize: 22, fill: 0xffe8c8 } satisfies TextStyleOptions });
      right.position.set(px + 508, y);
      right.eventMode = 'static';
      right.cursor = 'pointer';
      right.on('pointerdown', () => this.#settingsHandlers?.onChange(row.id, 1));
      layer.addChild(left, value, right);
    });
  }

  /* ============================ 战斗覆盖层 ============================ */

  /** 展示交互式战斗界面：阵营分列 + 血条；点击非行动方存活单位攻击，底部可跳过行动。
   *  宿主每次结算（act/pass）后以新的 BattleView 重新调用本方法刷新。 */
  showBattle(view: BattleView, handlers: BattleHandlers, message = ''): void {
    this.#battleHandlers = handlers;
    const layer = this.#battleLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x05050a, alpha: 0.9 }));

    layer.addChild(new PText({
      text: `回合 ${view.turn} —— 当前行动：${view.actingTeam}`,
      style: { fontSize: 26, fill: 0xffe8c8, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 36);

    const teams = [...new Set(view.units.map((u) => u.team))];
    teams.forEach((team, ti) => {
      const x = 80 + ti * 620;
      layer.addChild(new PText({
        text: `${team}${team === view.actingTeam ? '（行动中）' : ''}`,
        style: { fontSize: 20, fill: team === view.actingTeam ? 0xffe8c8 : 0x8a8a96, fontWeight: 'bold' } satisfies TextStyleOptions,
      })).position.set(x, 92);
      view.units.filter((u) => u.team === team).forEach((u, i) => {
        const y = 136 + i * 88;
        const row = new Container();
        row.position.set(x, y);
        row.addChild(new Graphics().roundRect(0, 0, 520, 72, 10).fill({ color: u.alive ? 0x1a1a26 : 0x101016, alpha: 0.96 }));
        row.addChild(new PText({
          text: u.alive ? u.name : `${u.name}（倒下）`,
          style: { fontSize: 20, fill: u.alive ? 0xffffff : 0x55555f } satisfies TextStyleOptions,
        })).position.set(18, 8);
        // 血条
        row.addChild(new Graphics().rect(18, 46, 340, 12).fill(0x333340));
        if (u.hpRatio > 0) {
          row.addChild(new Graphics().rect(18, 46, 340 * u.hpRatio, 12).fill(u.hpRatio > 0.35 ? 0x57c26a : 0xd8544f));
        }
        row.addChild(new PText({ text: `${u.hp}/${u.maxHp}`, style: { fontSize: 16, fill: 0xbbbbbb } satisfies TextStyleOptions })).position.set(372, 40);
        // 非行动方的存活单位可点击攻击（携带已选技能，攻击后清空选择）
        if (u.alive && u.team !== view.actingTeam) {
          row.eventMode = 'static';
          row.cursor = 'pointer';
          row.on('pointerdown', () => {
            this.#battleHandlers?.onAttack(u.uid, this.#battleSelectedSkill);
            this.#battleSelectedSkill = null;
          });
        }
        layer.addChild(row);
      });
    });

    // 技能选择条：行动方首个存活单位的 [普攻 + 技能]（冷却中灰显不可选）
    const actingUnit = view.units.find((u) => u.alive && u.team === view.actingTeam);
    if (actingUnit) {
      const skillBtns: { id: string | null; label: string; ready: boolean }[] = [
        { id: null, label: '普攻', ready: true },
        ...actingUnit.skills.map((s) => ({
          id: s.id,
          label: s.ready ? s.name : `${s.name}（冷却 ${s.cooldown}）`,
          ready: s.ready,
        })),
      ];
      let sx = 60;
      for (const btn of skillBtns) {
        const selected = btn.id !== null && btn.id === this.#battleSelectedSkill;
        const t = new PText({
          text: btn.label,
          style: {
            fontSize: 18,
            fill: selected ? 0x0a0a12 : btn.ready ? 0xffe8c8 : 0x55555f,
          } satisfies TextStyleOptions,
        });
        const pad = new Graphics().roundRect(sx - 10, this.#h - 150, t.width + 20, 34, 8)
          .fill({ color: selected ? 0xffe8c8 : 0x1a1a26, alpha: 0.95 });
        layer.addChild(pad);
        t.position.set(sx, this.#h - 144);
        layer.addChild(t);
        if (btn.ready) {
          pad.eventMode = 'static';
          pad.cursor = 'pointer';
          pad.on('pointerdown', () => {
            this.#battleSelectedSkill = btn.id;
            this.#battleHandlers && this.showBattle(view, this.#battleHandlers, message); // 重绘高亮
          });
        }
        sx += t.width + 34;
      }
      if (actingUnit.canMove) {
        // 移动按钮（1D 阵型，move 值 = 移动距离；移动消耗本次行动）
        const mkMove = (label: string, dir: -1 | 1, x: number): void => {
          const b = new PText({
            text: label,
            style: { fontSize: 18, fill: 0x9ad0ff } satisfies TextStyleOptions,
          });
          b.position.set(x, this.#h - 144);
          b.eventMode = 'static';
          b.cursor = 'pointer';
          b.on('pointerdown', () => this.#battleHandlers?.onMove?.(dir));
          layer.addChild(b);
        };
        mkMove('◀ 移动', -1, sx + 30);
        mkMove('移动 ▶', 1, sx + 140);
      }
    }

    layer.addChild(new PText({
      text: message.length > 0 ? message : '点击敌方单位发起攻击',
      style: { fontSize: 20, fill: 0xdddddd } satisfies TextStyleOptions,
    })).position.set(60, this.#h - 84);
    const pass = new PText({ text: '▸ 跳过行动', style: { fontSize: 20, fill: 0xffe8c8 } satisfies TextStyleOptions });
    pass.position.set(this.#w - 210, this.#h - 84);
    pass.eventMode = 'static';
    pass.cursor = 'pointer';
    pass.on('pointerdown', () => this.#battleHandlers?.onPass());
    layer.addChild(pass);
    layer.visible = true;
  }

  /** 隐藏战斗界面（战斗结束由宿主调用） */
  hideBattle(): void {
    this.#battleLayer.visible = false;
  }

  /* ============================ 标题画面 / 系统菜单 / 存读档 / 大地图 ============================ */

  /** 展示标题画面：大标题 + 副标题 + 菜单项（enabled=false 灰显不可点） */
  showTitle(view: TitleView, onSelect: (id: string) => void): void {
    this.#titleHandler = onSelect;
    const layer = this.#titleLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x08080f, alpha: 0.98 }));
    const title = new PText({ text: view.title, style: { fontSize: 60, fill: 0xffe8c8, fontWeight: 'bold' } satisfies TextStyleOptions });
    title.anchor.set(0.5);
    title.position.set(this.#w / 2, this.#h * 0.28);
    layer.addChild(title);
    if (view.subtitle) {
      const sub = new PText({ text: view.subtitle, style: { fontSize: 20, fill: 0x8a8a96 } satisfies TextStyleOptions });
      sub.anchor.set(0.5);
      sub.position.set(this.#w / 2, this.#h * 0.28 + 56);
      layer.addChild(sub);
    }
    const startY = this.#h * 0.48;
    view.items.forEach((item, i) => {
      const enabled = item.enabled !== false;
      const t = new PText({
        text: item.label,
        style: { fontSize: 26, fill: enabled ? 0xffffff : 0x4a4a55 } satisfies TextStyleOptions,
      });
      t.anchor.set(0.5);
      t.position.set(this.#w / 2, startY + i * 56);
      if (enabled) {
        t.eventMode = 'static';
        t.cursor = 'pointer';
        t.on('pointerdown', () => this.#titleHandler?.(item.id));
      }
      layer.addChild(t);
    });
    layer.visible = true;
  }

  /** 隐藏标题画面 */
  hideTitle(): void {
    this.#titleLayer.visible = false;
  }

  /** 展示系统菜单：半透明背景点击关闭；条目点击后自动收起并回调 */
  showSystemMenu(items: SystemMenuItemView[], onSelect: (id: string) => void, onClose: () => void): void {
    this.#menuHandlers = { onSelect, onClose };
    const layer = this.#menuLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const bg = new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x000000, alpha: 0.55 });
    bg.eventMode = 'static';
    bg.on('pointerdown', () => {
      layer.visible = false;
      this.#menuHandlers?.onClose();
    });
    layer.addChild(bg);
    const px = this.#w - 350;
    layer.addChild(new Graphics().roundRect(px, 90, 270, 50 + items.length * 54, 12).fill({ color: 0x101018, alpha: 0.97 }));
    items.forEach((item, i) => {
      const t = new PText({ text: item.label, style: { fontSize: 22, fill: 0xffffff } satisfies TextStyleOptions });
      t.position.set(px + 44, 116 + i * 54);
      t.eventMode = 'static';
      t.cursor = 'pointer';
      t.on('pointerdown', () => {
        layer.visible = false;
        this.#menuHandlers?.onSelect(item.id);
      });
      layer.addChild(t);
    });
    layer.visible = true;
  }

  /** 隐藏系统菜单 */
  hideSystemMenu(): void {
    this.#menuLayer.visible = false;
  }

  /** 存档缩略图纹理 LRU：dataURL 每档唯一，不限量会随反复开关存档界面累积（审计修复） */
  #thumbCache = new Map<string, Texture>();
  /** 正在播放的 @video 元素（hideVideo 强制停止用；审计复核） */
  #activeVideo: HTMLVideoElement | null = null;
  #thumbTexture(url: string): Texture {
    const hit = this.#thumbCache.get(url);
    if (hit) {
      // 命中即移到队尾（Map 按插入序迭代）→ 真 LRU，避免淘汰当前界面正在使用的纹理（审计复核）
      this.#thumbCache.delete(url);
      this.#thumbCache.set(url, hit);
      return hit;
    }
    const tex = Texture.from(url);
    this.#thumbCache.set(url, tex);
    if (this.#thumbCache.size > 16) {
      const oldest = this.#thumbCache.keys().next().value;
      if (oldest !== undefined) {
        this.#thumbCache.get(oldest)?.destroy(false);
        this.#thumbCache.delete(oldest);
      }
    }
    return tex;
  }

  /** 展示存档/读档界面：槽位卡片网格；load 模式空槽灰显不可选 */
  showSaveLoad(view: SaveLoadView, onSelect: (slotId: string) => void, onClose: () => void): void {
    this.#saveLoadHandlers = { onSelect, onClose };
    const layer = this.#saveLoadLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x08080f, alpha: 0.96 }));
    layer.addChild(new PText({
      text: view.mode === 'save' ? '存 档' : '读 档',
      style: { fontSize: 32, fill: 0xffe8c8, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 36);
    const close = new PText({ text: '✕ 关闭', style: { fontSize: 22, fill: 0x8a8a96 } satisfies TextStyleOptions });
    close.position.set(this.#w - 150, 42);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointerdown', () => {
      layer.visible = false;
      this.#saveLoadHandlers?.onClose();
    });
    layer.addChild(close);
    const cols = 3;
    view.slots.forEach((slot, i) => {
      const x = 60 + (i % cols) * 396;
      const y = 110 + Math.floor(i / cols) * 118;
      const selectable = view.mode === 'save' || !slot.empty;
      const card = new Container();
      card.position.set(x, y);
      card.addChild(new Graphics().roundRect(0, 0, 380, 104, 10).fill({ color: selectable ? 0x1a1a26 : 0x121218, alpha: 0.96 }));
      // 缩略图（舞台截图 dataURL；纹理异步加载完成后自动显示）
      let textX = 16;
      if (slot.thumbnail) {
        const thumb = new Sprite(this.#thumbTexture(slot.thumbnail));
        thumb.width = 118;
        thumb.height = 66;
        thumb.position.set(14, 19);
        card.addChild(thumb);
        textX = 148;
      }
      card.addChild(new PText({
        text: slot.empty ? '—— 空槽位 ——' : (slot.label ?? slot.id),
        style: { fontSize: 20, fill: selectable ? 0xffffff : 0x55555f } satisfies TextStyleOptions,
      })).position.set(textX, 14);
      if (!slot.empty) {
        const kindLabel = slot.kind === 'auto' ? '自动 ' : slot.kind === 'quick' ? '快速 ' : '';
        const playtime = slot.playTimeSec !== undefined && slot.playTimeSec > 0
          ? ` · ${Math.floor(slot.playTimeSec / 60)}分钟`
          : '';
        card.addChild(new PText({
          text: `${kindLabel}${formatSlotTime(slot.updatedAt)}${playtime}`,
          style: { fontSize: 16, fill: 0x9a9aa5 } satisfies TextStyleOptions,
        })).position.set(textX, 60);
      }
      if (selectable) {
        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.on('pointerdown', () => {
          layer.visible = false;
          this.#saveLoadHandlers?.onSelect(slot.id);
        });
      }
      layer.addChild(card);
    });
    layer.visible = true;
  }

  /** 隐藏存档/读档界面 */
  hideSaveLoad(): void {
    this.#saveLoadLayer.visible = false;
  }

  /** 展示大地图：节点（可进入者高亮可点）+ 日期/回合/行动力 + 结束回合 */
  showMap(view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void): void {
    this.#mapHandlers = { onEnter, onEndTurn };
    const layer = this.#mapLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x0a0f14, alpha: 0.95 }));
    layer.addChild(new PText({
      text: `${view.date} —— 回合 ${view.turn}`,
      style: { fontSize: 24, fill: 0xffe8c8, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 36);
    layer.addChild(new PText({ text: '行动力', style: { fontSize: 16, fill: 0x9a9aa5 } satisfies TextStyleOptions })).position.set(this.#w - 60 - view.maxAp * 30 - 60, 40);
    for (let i = 0; i < view.maxAp; i++) {
      layer.addChild(new Graphics().circle(this.#w - 60 - (view.maxAp - i) * 30 + 10, 50, 10).fill(i < view.ap ? 0x57c26a : 0x333340));
    }
    for (const node of view.nodes) {
      const dot = new Container();
      dot.position.set(node.x, node.y);
      const color = node.enterable ? 0xffe8c8 : node.visited ? 0x5a7a8a : 0x333340;
      dot.addChild(new Graphics().circle(0, 0, 26).fill({ color, alpha: node.enterable ? 0.95 : 0.6 }));
      if (node.visited) {
        dot.addChild(new PText({ text: '✓', style: { fontSize: 20, fill: 0xffffff } satisfies TextStyleOptions })).position.set(-9, -13);
      }
      const nameTag = new PText({
        text: `${node.name}${node.apCost > 0 ? `（行动力 ${node.apCost}）` : ''}`,
        style: { fontSize: 16, fill: node.enterable ? 0xffffff : 0x777788 } satisfies TextStyleOptions,
      });
      nameTag.anchor.set(0.5, 0);
      nameTag.position.set(0, 34);
      dot.addChild(nameTag);
      if (node.enterable) {
        dot.eventMode = 'static';
        dot.cursor = 'pointer';
        dot.on('pointerdown', () => {
          layer.visible = false;
          this.#mapHandlers?.onEnter(node.id);
        });
      }
      layer.addChild(dot);
    }
    const end = new PText({ text: '▸ 结束回合', style: { fontSize: 22, fill: 0xffe8c8 } satisfies TextStyleOptions });
    end.position.set(this.#w - 210, this.#h - 70);
    end.eventMode = 'static';
    end.cursor = 'pointer';
    end.on('pointerdown', () => {
      layer.visible = false;
      this.#mapHandlers?.onEndTurn();
    });
    layer.addChild(end);
    layer.visible = true;
  }

  /** 隐藏大地图 */
  hideMap(): void {
    this.#mapLayer.visible = false;
  }

  /* ============================ 商店 ============================ */

  /** 展示商店覆盖层：金币 + 商品列表（购买按钮，金币不足灰显）。
   *  宿主在 onBuy 里结算（ShopSystem.buy）后更新视图重新 showShop；离店回调 onClose。 */
  showShop(
    view: { gold: number; items: { id: string; name: string; price: number }[]; message?: string },
    onBuy: (itemId: string) => void,
    onClose: () => void,
  ): void {
    this.#shopHandlers = { onBuy, onClose };
    const layer = this.#shopLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x08080f, alpha: 0.96 }));
    layer.addChild(new PText({
      text: '商 店',
      style: { fontSize: 32, fill: 0xffe8c8, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 36);
    layer.addChild(new PText({
      text: `金币：${view.gold}`,
      style: { fontSize: 22, fill: 0xffd77a } satisfies TextStyleOptions,
    })).position.set(this.#w - 240, 44);
    view.items.forEach((item, i) => {
      const affordable = view.gold >= item.price;
      const row = new Container();
      row.position.set(60, 120 + i * 64);
      row.addChild(new Graphics().roundRect(0, 0, 720, 52, 10).fill({ color: 0x1a1a26, alpha: 0.96 }));
      row.addChild(new PText({
        text: item.name,
        style: { fontSize: 22, fill: 0xffffff } satisfies TextStyleOptions,
      })).position.set(20, 13);
      row.addChild(new PText({
        text: `${item.price} 金币`,
        style: { fontSize: 18, fill: 0xffd77a } satisfies TextStyleOptions,
      })).position.set(320, 16);
      const btn = new PText({
        text: affordable ? '购买' : '金币不足',
        style: { fontSize: 20, fill: affordable ? 0xffe8c8 : 0x55555f } satisfies TextStyleOptions,
      });
      btn.position.set(580, 14);
      if (affordable) {
        btn.eventMode = 'static';
        btn.cursor = 'pointer';
        btn.on('pointerdown', () => this.#shopHandlers?.onBuy(item.id));
      }
      row.addChild(btn);
      layer.addChild(row);
    });
    if (view.message && view.message.length > 0) {
      layer.addChild(new PText({
        text: view.message,
        style: { fontSize: 20, fill: 0xdddddd } satisfies TextStyleOptions,
      })).position.set(60, this.#h - 130);
    }
    const close = new PText({ text: '✕ 离开商店', style: { fontSize: 22, fill: 0x8a8a96 } satisfies TextStyleOptions });
    close.position.set(this.#w - 220, this.#h - 74);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointerdown', () => {
      layer.visible = false;
      this.#shopHandlers?.onClose();
    });
    layer.addChild(close);
    layer.visible = true;
  }

  /** 隐藏商店 */
  hideShop(): void {
    this.#shopLayer.visible = false;
  }

  /* ============================ 据点指令（兰斯式 base commands） ============================ */

  /** 展示据点指令面板：指令列表（可执行高亮/不可执行灰显）+ 行动力余量。
   *  宿主在 onExec 里结算（CalendarRunner.execBaseCommand + 写回 effects）后重绘；onClose 回到地图。 */
  showBaseCommands(view: BasePanelView, onExec: (cmdId: string) => void, onClose: () => void): void {
    this.#baseHandlers = { onExec, onClose };
    const layer = this.#baseLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x08080f, alpha: 0.96 }));
    layer.addChild(new PText({
      text: '据 点 指 令',
      style: { fontSize: 32, fill: 0xffe8c8, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 36);
    layer.addChild(new PText({
      text: `${view.date}　行动力：${view.ap}/${view.maxAp}`,
      style: { fontSize: 22, fill: 0xffd77a } satisfies TextStyleOptions,
    })).position.set(this.#w - 340, 44);
    view.commands.forEach((cmd, i) => {
      const row = new Container();
      row.position.set(60, 120 + i * 64);
      row.addChild(new Graphics().roundRect(0, 0, 860, 52, 10)
        .fill({ color: cmd.enabled ? 0x1a1a26 : 0x101018, alpha: 0.96 }));
      row.addChild(new PText({
        text: cmd.name,
        style: { fontSize: 22, fill: cmd.enabled ? 0xffffff : 0x55555f } satisfies TextStyleOptions,
      })).position.set(20, 13);
      row.addChild(new PText({
        text: `AP ${cmd.apCost}${cmd.remaining !== undefined && cmd.remaining !== null ? `（剩 ${cmd.remaining} 次）` : ''}`,
        style: { fontSize: 18, fill: cmd.enabled ? 0xffd77a : 0x55555f } satisfies TextStyleOptions,
      })).position.set(360, 16);
      const btn = new PText({
        text: cmd.enabled ? '执行' : '不可执行',
        style: { fontSize: 20, fill: cmd.enabled ? 0xffe8c8 : 0x55555f } satisfies TextStyleOptions,
      });
      btn.position.set(720, 14);
      if (cmd.enabled) {
        btn.eventMode = 'static';
        btn.cursor = 'pointer';
        btn.on('pointerdown', () => this.#baseHandlers?.onExec(cmd.id));
      }
      row.addChild(btn);
      layer.addChild(row);
    });
    if (view.message && view.message.length > 0) {
      layer.addChild(new PText({
        text: view.message,
        style: { fontSize: 20, fill: 0xdddddd } satisfies TextStyleOptions,
      })).position.set(60, this.#h - 130);
    }
    const close = new PText({ text: '◀ 返回地图', style: { fontSize: 22, fill: 0x8a8a96 } satisfies TextStyleOptions });
    close.position.set(this.#w - 220, this.#h - 74);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointerdown', () => {
      layer.visible = false;
      this.#baseHandlers?.onClose();
    });
    layer.addChild(close);
    layer.visible = true;
  }

  /** 隐藏据点指令面板 */
  hideBase(): void {
    this.#baseLayer.visible = false;
  }

  showChoices(options: ChoiceOptionView[]): void {
    this.#clearChoices();
    options.forEach((opt, i) => {
      // Container 包裹（卡片底板 + 强调条 + 文本）：Pixi v8 起 Text 不再允许挂子节点（弃用告警）
      const holder = new Container();
      const label = new PText({
        text: `${i + 1}. ${opt.label}`,
        style: { fontSize: 26, fill: NIGHT_AZURE.text } satisfies TextStyleOptions,
      });
      label.position.set(30, 10);
      const bg = new Graphics();
      const bar = new Graphics();
      holder.addChild(bg, bar, label);
      const view = { holder, bg, bar, label };
      this.#choiceViews.push(view);
      this.#drawChoiceCard(view, false);
      holder.eventMode = 'static';
      holder.cursor = 'pointer';
      holder.on('pointerdown', () => this.onSelect?.(opt.index));
      // hover 高亮：卡片换选中样式（蔚蓝描边 + 强调条），离开恢复（键盘高亮优先保留）
      holder.on('pointerover', () => this.#drawChoiceCard(view, true));
      holder.on('pointerout', () => {
        this.#drawChoiceCard(view, this.#choiceHighlight === this.#choiceViews.indexOf(view));
      });
      this.#choiceLayer.addChild(holder);
    });
    this.#choiceHighlight = -1;
    this.#layout();
  }

  /** 选择肢卡片绘制（默认/悬停/键盘高亮统一口径：玻璃卡片底 + 细描边，选中蔚蓝描边 + 左侧强调条）。
   *  先定文字样式再测量宽高，避免加粗后宽度变化导致描边裁剪。 */
  #drawChoiceCard(view: { holder: Container; bg: Graphics; bar: Graphics; label: PText }, selected: boolean): void {
    view.label.style = selected
      ? { fontSize: 26, fill: NIGHT_AZURE.plateText, fontWeight: 'bold' } satisfies TextStyleOptions
      : { fontSize: 26, fill: NIGHT_AZURE.text } satisfies TextStyleOptions;
    const w = view.label.width + 60;
    const h = view.label.height + 20;
    view.bg.clear();
    view.bg.roundRect(0, 0, w, h, 10)
      .fill({ color: NIGHT_AZURE.choiceBg, alpha: 0.66 })
      .stroke({
        width: selected ? 1.5 : 1,
        color: selected ? NIGHT_AZURE.accent : NIGHT_AZURE.choiceEdge,
        alpha: selected ? 0.95 : 0.8,
      });
    view.bar.clear();
    if (selected) view.bar.roundRect(2, 6, 3.5, h - 12, 2).fill({ color: NIGHT_AZURE.accent, alpha: 0.95 });
  }

  /** 选择肢键盘导航高亮：提亮第 pos 项（其余恢复默认样式；卡片与文本同步重绘） */
  setChoiceHighlight(pos: number): void {
    this.#choiceHighlight = pos;
    this.#choiceViews.forEach((view, i) => this.#drawChoiceCard(view, i === pos));
  }

  hideChoices(): void {
    this.#clearChoices();
  }

  setFade(alpha: number): void {
    this.#fadeOverlay.alpha = Math.max(0, Math.min(1, alpha));
  }

  #clearChoices(): void {
    for (const view of this.#choiceViews) {
      this.#choiceLayer.removeChild(view.holder);
      view.holder.destroy({ children: true }); // holder 内含底板/强调条 Graphics 与文本，一并销毁
    }
    this.#choiceViews = [];
  }

  /**
   * 释放舞台资源（游戏退出/窗口销毁/热重置时由宿主调用）。
   * 程序化占位纹理由本舞台生成，destroy 安全；
   * registerBackground/registerPortrait 注入的纹理不在此销毁
   * （其生命周期归宿主/Pixi Assets 缓存管理，避免破坏宿主共享引用）——
   * setBackground/setPortrait 会把命中的注入纹理也放进占位缓存，故销毁前按注册表排除。
   */
  destroy(): void {
    this.#clearChoices();
    this.stopParticles(); // 粒子 Graphics 随粒子层销毁，先显式清空避免重复 destroy
    const registered = new Set<Texture>([...this.#registeredBgs.values(), ...this.#registeredPortraits.values()]);
    for (const tex of this.#bgTextureCache.values()) {
      if (!registered.has(tex)) tex.destroy();
    }
    this.#bgTextureCache.clear();
    for (const tex of this.#portraitTextureCache.values()) {
      if (!registered.has(tex)) tex.destroy();
    }
    this.#portraitTextureCache.clear();
    for (const sprite of this.#portraitSprites.values()) sprite.destroy();
    this.#portraitSprites.clear();
    this.#bgSprite?.destroy();
    this.#bgSprite = null;
    this.#registeredBgs.clear();
    this.#registeredPortraits.clear();
    this.app?.destroy(true, { children: true });
    this.app = null;
  }
}
