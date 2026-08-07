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
import type { TimelineFrameEvent } from './timeline-player.js';
import type { AdvStage, ChoiceOptionView, CommandRailItem, PortraitView, SpeakerProfile } from './types.js';

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
  /** 浅色面板家族（现代 ADV 口径，用户参考图拍板）：米白底/柔影/深色正文/名牌蓝 */
  panelBg: 0xf7f8fc,
  panelShadow: 0x28304a,
  panelText: 0x2c3140,
  nameTag: 0x4285e0,
} as const;

/**
 * Modern ADV 主画面 token。
 * 这组颜色只服务于世界层上的轻 HUD，不复用覆盖层的卡片色，避免主画面
 * 重新滑回 RPG Maker 式的厚重面板语言。
 */
const MODERN_ADV = {
  ink: 0x070c17,
  text: 0xf7f9ff,
  muted: 0xaeb9cc,
  accent: 0x9bc7ff,
  voice: 0xd9b670,
  scrim: 0x06101e,
  rail: 0x050914,
  line: 0x9bc7ff,
} as const;

/** 种子伪随机序列（mulberry32）：占位背景噪点同 key 稳定可复现（不用 Math.random，保住同 key 同图契约） */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 正文/UI 默认字体栈。项目内嵌字体缺失时，仍以 CJK 无衬线保证中文、日文的可读性。 */
const ADV_FONT_STACK = "'Source Han Sans SC', 'Noto Sans CJK SC', '源ノ角ゴシック', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Yu Gothic', sans-serif";
/** 标题默认字体栈。只用于标题、章节等展示文字，避免正文随之变得难读。 */
const ADV_TITLE_FONT_STACK = "'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', 'STSong', 'SimSun', serif";

/** 字体角色：标题用展示字体，正文与 UI 保持无衬线的长时间阅读口径。 */
export type FontRole = 'title' | 'body' | 'ui';

/** 程序化占位背景：冷色多段渐变 + 径向暗角 + 微噪点（夜色蔚蓝气质；
 *  色相由 key 哈希定色（冷色带），噪点由种子 PRNG 绘制 —— 同 key 稳定同图契约不变） */
function makeBackgroundTexture(key: string, w = 1280, h = 720): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const hash = hashStr(key);
  // 冷色带（青→紫 190°..310°）：哈希定色相，同 key 稳定
  const hue = 190 + (hash % 120);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `hsl(${hue}, 45%, 30%)`);
  g.addColorStop(0.55, `hsl(${(hue + 25) % 360}, 48%, 17%)`);
  g.addColorStop(1, `hsl(${(hue + 50) % 360}, 52%, 8%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 径向暗角：四周压暗聚焦中心（氛围感）
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(2,4,10,0.5)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  // 微噪点：种子 PRNG 保证同 key 可复现
  const rnd = seededRandom(hash);
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(200,225,255,0.05)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  return Texture.from(canvas);
}

/** 程序化占位立绘：胸像构图 + 赛璐璐风（平涂底色/阴影色/描边），表情影响五官。
 *  源纹理 800×1280（旧 400×640 的 2x），显示尺寸内不再放大插值（精致化批：修糊 + 去 RPG Maker 廉价感）；
 *  显示宽度由 setPortrait 控制，宽高比 5:8 与旧版一致，几何不变。 */
function makePortraitTexture(charId: string, costume: string, expression: string, w = 800, h = 1280): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const hash = hashStr(charId + costume);
  const exprHash = hashStr(expression);

  // 调色：平涂底色 + 阴影色 + 描边色（同色系加深，赛璐璐口径）
  const hairHue = hash % 360;
  const clothHue = (hash + 150) % 360;
  const hair = `hsl(${hairHue}, 52%, 62%)`;
  const hairDark = `hsl(${hairHue}, 50%, 46%)`;
  const outline = `hsl(${hairHue}, 38%, 24%)`;
  const skin = `hsl(28, 58%, 88%)`;
  const skinDark = `hsl(26, 45%, 76%)`;
  const cloth = `hsl(${clothHue}, 42%, 50%)`;
  const clothDark = `hsl(${clothHue}, 42%, 38%)`;
  const iris = `hsl(${(hash + 220) % 360}, 55%, 48%)`;
  const lw = w * 0.008; // 描边线宽随纹理尺寸，任意分辨率下锐利
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const cx = w / 2;
  const headY = h * 0.30;
  const headRx = w * 0.17;
  const headRy = w * 0.20;

  // 后发（头后大轮廓，先画）
  ctx.fillStyle = hairDark;
  ctx.beginPath();
  ctx.ellipse(cx, headY - headRy * 0.06, headRx * 1.22, headRy * 1.22, 0, 0, Math.PI * 2);
  ctx.fill();
  // 两侧发束（垂到肩部）
  ctx.fillStyle = hair;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * headRx * 1.1, headY - headRy * 0.4);
    ctx.quadraticCurveTo(cx + s * headRx * 1.5, headY + headRy * 0.9, cx + s * headRx * 1.05, h * 0.62);
    ctx.quadraticCurveTo(cx + s * headRx * 0.7, headY + headRy * 0.9, cx + s * headRx * 0.82, headY - headRy * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = outline;
    ctx.stroke();
  }

  // 颈（肤色 + 上端阴影）
  ctx.fillStyle = skin;
  ctx.fillRect(cx - w * 0.05, headY + headRy * 0.7, w * 0.1, h * 0.14);
  ctx.fillStyle = skinDark;
  ctx.fillRect(cx - w * 0.05, headY + headRy * 0.7, w * 0.1, h * 0.045);

  // 肩/上身（底部裁切，胸像构图）
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(w * 0.10, h);
  ctx.bezierCurveTo(w * 0.12, h * 0.72, w * 0.28, h * 0.64, cx - w * 0.08, h * 0.60);
  ctx.lineTo(cx + w * 0.08, h * 0.60);
  ctx.bezierCurveTo(w * 0.72, h * 0.64, w * 0.88, h * 0.72, w * 0.90, h);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = outline;
  ctx.stroke();
  // 衣领（V 领 + 内衬阴影）
  ctx.fillStyle = clothDark;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.075, h * 0.605);
  ctx.lineTo(cx, h * 0.72);
  ctx.lineTo(cx + w * 0.075, h * 0.605);
  ctx.closePath();
  ctx.fill();
  // 下巴投在衣服上的阴影
  ctx.fillStyle = 'rgba(10,14,26,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.63, w * 0.09, h * 0.022, 0, 0, Math.PI * 2);
  ctx.fill();

  // 头（脸部）
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(cx, headY, headRx, headRy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = outline;
  ctx.stroke();

  // 刘海（额前锔齿状，表情无关）
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.moveTo(cx - headRx * 1.05, headY - headRy * 0.15);
  ctx.quadraticCurveTo(cx - headRx * 1.1, headY - headRy * 1.15, cx, headY - headRy * 1.12);
  ctx.quadraticCurveTo(cx + headRx * 1.1, headY - headRy * 1.15, cx + headRx * 1.05, headY - headRy * 0.15);
  // 锔齿下缘（四段尖）
  const fringeY = headY - headRy * 0.28;
  for (let i = 0; i < 4; i++) {
    const x0 = cx + headRx * 1.05 - (i + 0.5) * (headRx * 2.1 / 4);
    const x1 = cx + headRx * 1.05 - (i + 1) * (headRx * 2.1 / 4);
    ctx.quadraticCurveTo(x0, fringeY + headRy * 0.22, x1, fringeY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = outline;
  ctx.stroke();

  // ===== 五官（表情差异：眼形/眉形/嘴形） =====
  const eyeY = headY + headRy * 0.12;
  const eyeX = headRx * 0.48;
  const eyeW = w * 0.048;
  const eyeH = w * 0.062;
  const expr = exprHash % 3;
  ctx.lineWidth = lw;
  ctx.strokeStyle = outline;
  for (const s of [-1, 1]) {
    const ex = cx + s * eyeX;
    if (expr === 1) {
      // 笑眼：弯弧
      ctx.beginPath();
      ctx.arc(ex, eyeY + eyeH * 0.3, eyeW * 0.9, Math.PI * 1.15, Math.PI * 1.85);
      ctx.lineWidth = lw * 1.4;
      ctx.stroke();
      ctx.lineWidth = lw;
    } else {
      // 睜眼（普通/惊讶：惊讶更大）
      const k = expr === 2 ? 1.25 : 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeW * k, eyeH * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 虹膜 + 瞳孔 + 高光
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY + eyeH * 0.12 * k, eyeW * 0.62 * k, eyeH * 0.66 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = outline;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY + eyeH * 0.16 * k, eyeW * 0.3 * k, eyeH * 0.34 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex - eyeW * 0.22, eyeY - eyeH * 0.18, eyeW * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
    // 眉毛（笑眼平缓，惊讶上扬）
    const browY = eyeY - eyeH * (expr === 2 ? 1.9 : 1.55);
    ctx.beginPath();
    ctx.moveTo(ex - eyeW, browY + (expr === 2 ? -eyeH * 0.15 : 0));
    ctx.quadraticCurveTo(ex, browY - eyeH * 0.22, ex + eyeW, browY);
    ctx.lineWidth = lw * 1.2;
    ctx.stroke();
    ctx.lineWidth = lw;
  }
  // 嘴
  const mouthY = headY + headRy * 0.58;
  ctx.strokeStyle = outline;
  ctx.lineWidth = lw * 1.3;
  ctx.beginPath();
  if (expr === 1) {
    ctx.arc(cx, mouthY - headRy * 0.06, headRy * 0.16, Math.PI * 0.15, Math.PI * 0.85);
  } else if (expr === 2) {
    ctx.ellipse(cx, mouthY, headRy * 0.07, headRy * 0.11, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(cx - headRy * 0.12, mouthY);
    ctx.quadraticCurveTo(cx, mouthY + headRy * 0.05, cx + headRy * 0.12, mouthY);
  }
  ctx.stroke();
  // 腮红（笑眼时明显）
  ctx.fillStyle = expr === 1 ? 'rgba(244,140,150,0.30)' : 'rgba(244,140,150,0.14)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * headRx * 0.62, headY + headRy * 0.38, headRy * 0.16, headRy * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
  }
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
  /** Backlog 覆盖层被自身点击关闭时通知 AdvRenderer */
  onBacklogClose: (() => void) | null = null;

  #bgLayer: Container;
  #portraitLayer: Container;
  #uiLayer: Container;
  #fadeOverlay: Graphics;
  #bgSprite: Sprite | null = null;
  #backgroundKey: string | null = null;
  #bgTransition: { old: Sprite | null; neu: Sprite; remain: number; dur: number } | null = null;
  #portraitSprites = new Map<string, Sprite>();
  #portraitViews = new Map<string, PortraitView>();
  #bgTextureCache = new Map<string, Texture>();
  #portraitTextureCache = new Map<string, Texture>();
  /** 真实背景素材（宿主 registerBackground 注入，优先于程序化占位） */
  #registeredBgs = new Map<string, Texture>();
  /** 真实立绘素材（key = charId:costume:expression，宿主 registerPortrait 注入） */
  #registeredPortraits = new Map<string, Texture>();
  #speakerText: PText;
  #dialogText: PText;
  /** 避免打字机每帧把相同字符串重新送进 Pixi Text，重复触发断行和纹理重建。 */
  #lastShownSpeaker: string | null | undefined;
  #lastShownDialog = '';
  /** 说话人名牌底板（无框 ADV：贴正文区左上 (64, h-226) 的半透明小薄片，随说话人显隐） */
  #speakerPlate: Graphics;
  /** 对话框每行字数容量（预断行用，构造时按字号估算；M5 支柱4） */
  #dialogCharsPerLine = 40;
  #choiceLayer: Container;
  /** 选择肢卡片视图（容器 + 卡片底板 + 强调条 + 文本；高亮统一走 #drawChoiceCard 重绘） */
  #choiceViews: { holder: Container; bg: Graphics; bar: Graphics; label: PText }[] = [];
  /** 选择肢键盘高亮序号（-1 = 无） */
  #choiceHighlight = -1;
  /** 选择肢入场淡入状态（精致化批次三：卡片纵列渐显 + 逐卡错峰；由 updateEffects 驱动，不新建 ticker） */
  #choiceFadeRemain = 0;
  #choiceFadeDur = 280;
  /** Modern ADV 底部操作带：仅投影动作，宿主掌握业务状态。 */
  #commandRail: Container;
  #commandRailItems: CommandRailItem[] = [];
  #commandRailOnSelect: ((id: string) => void) | null = null;
  #commandRailSuppressed = false;
  #commandRailWakeRemain = 0;
  #commandRailIdleAlpha = 0.38;
  #commandRailPointerWake: (() => void) | null = null;
  /** 角色显示名 → 角色资料的显式映射。 */
  #speakerProfiles = new Map<string, SpeakerProfile>();
  #activeSpeakerId: string | null = null;
  /** 当前说话人的小头像（可选素材）。 */
  #speakerAvatar: Sprite | null = null;
  #registeredAvatars = new Map<string, Texture>();
  /** 立绘交叉淡化补间（旧 sprite 淡出 + 新 sprite 淡入） */
  #portraitTweens: { old: Sprite; neu: Sprite; remain: number; dur: number }[] = [];
  /** Backlog 滚动状态 */
  #backlogEntriesLayer: Container | null = null;
  #backlogScroll = 0;
  #backlogContentH = 0;
  /** 对话框半透明面板（亮色背景下保证文本可读性） */
  #dialogPanel: Graphics;
  /** 等待推进指示器（呼吸小光点；awaiting 时可见） */
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
  #galleryOnClose: (() => void) | null = null;
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
  /** 横幅（@title/@chapter/@tip/@center）淡入淡出状态 */
  #bannerLayer: Container;
  #bannerText: PText;
  /** chapter 横幅电影化上下黑边（letterbox，仅 chapter 变体可见） */
  #bannerBars: Graphics;
  /** tip 横幅右上小胶囊底板（仅 tip 变体绘制） */
  #bannerTipBg: Graphics;
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
  #timelineMoveStarts = new Map<object, Map<string, number>>();
  #timelineValueStarts = new Map<object, number>();
  /** 标题画面 / 系统菜单 / 存读档 / 大地图 覆盖层 */
  #titleLayer: Container;
  #titleHandler: ((id: string) => void) | null = null;
  /** 独立结局黑场：不复用标题或对话层，避免转场时残留可交互控件。 */
  #endingLayer: Container;
  #menuLayer: Container;
  /** 系统菜单的右侧抽屉内容（背景遮罩留在 layer 上，不随抽屉滑动） */
  #menuPanel: Container | null = null;
  #menuMotionRemain = 0;
  #menuMotionDur = 260;
  #menuMotionOffset = 46;
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
  /** 项目字体按角色独立保存；默认不依赖任何系统已安装字体。 */
  #fontFamilies: Record<FontRole, string> = {
    title: ADV_TITLE_FONT_STACK,
    body: ADV_FONT_STACK,
    ui: ADV_FONT_STACK,
  };

  constructor() {
    // 动态文本默认继承正文角色；标题与菜单在各自的构建点显式使用 title/ui 角色。
    TextStyle.defaultTextStyle.fontFamily = this.#fontFamilies.body;
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
    this.#commandRail = new Container();
    this.#commandRail.visible = false;
    this.#dialogRubyLayer = new Container();
    this.#nvlLayer = new Container();
    this.#nvlLayer.visible = false;
    this.#nvlLayer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: NIGHT_AZURE.panelBg, alpha: 0.86 }));
    this.#bannerLayer = new Container();
    this.#bannerLayer.visible = false;
    this.#bannerBars = new Graphics();
    this.#bannerBars.rect(0, 0, this.#w, 90).fill({ color: 0x05070d, alpha: 0.85 });
    this.#bannerBars.rect(0, this.#h - 90, this.#w, 90).fill({ color: 0x05070d, alpha: 0.85 });
    this.#bannerTipBg = new Graphics();
    this.#bannerText = new PText({ text: '', style: { fontSize: 40, fill: 0xffffff, fontWeight: 'normal', fontFamily: this.#fontFamilies.title } satisfies TextStyleOptions });
    this.#bannerText.anchor.set(0.5);
    this.#bannerLayer.addChild(this.#bannerBars, this.#bannerTipBg, this.#bannerText);
    this.#wipeBar = new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000);
    this.#wipeBar.visible = false;
    this.#tintOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000);
    this.#tintOverlay.alpha = 0;
    this.#tintOverlay.visible = false;
    this.#particleLayer = new Container();
    this.#titleLayer = new Container();
    this.#titleLayer.visible = false;
    this.#endingLayer = new Container();
    this.#endingLayer.visible = false;
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
    // 对话戏面板（无框 ADV 口径）：#drawDialogPanel 仅 clear() 不绘制，对象与可见性链路保留
    this.#dialogPanel = new Graphics();
    this.#drawDialogPanel();
    this.#speakerPlate = new Graphics();
    this.#speakerAvatar = new Sprite(Texture.EMPTY);
    this.#speakerAvatar.anchor.set(0.5, 1);
    if (this.#speakerAvatar) this.#speakerAvatar.visible = false;
    // 等待推进指示器：呼吸小光点（外圈柔光 + 内圈亮点，动画见 updateContinuePulse）
    this.#continueIndicator = new Graphics()
      .circle(0, 0, 9).fill({ color: NIGHT_AZURE.accent, alpha: 0.22 })
      .circle(0, 0, 4.5).fill({ color: 0xeaf4ff, alpha: 0.95 });
    this.#continueIndicator.visible = false;
    // 水平定位对齐对话框右下（历史代码只驱动 y，x 从未赋值导致贴左缘，顺手修复）
    this.#continueIndicator.x = this.#w - 68;
    this.#backlogLayer = new Container();
    this.#backlogLayer.visible = false;
    this.#galleryLayer = new Container();
    this.#galleryLayer.visible = false;
    this.#settingsLayer = new Container();
    this.#settingsLayer.visible = false;
    this.#battleLayer = new Container();
    this.#battleLayer.visible = false;
    this.#uiLayer.addChild(
      this.#dialogPanel, this.#speakerAvatar, this.#speakerPlate, this.#dialogRubyLayer, this.#continueIndicator, this.#choiceLayer, this.#commandRail,
      this.#backlogLayer, this.#galleryLayer, this.#settingsLayer, this.#battleLayer,
      this.#nvlLayer, this.#bannerLayer, this.#wipeBar,
      this.#mapLayer, this.#shopLayer, this.#baseLayer, this.#saveLoadLayer, this.#menuLayer, this.#titleLayer, this.#endingLayer,
    );

    this.#speakerText = new PText({
      text: '',
      style: {
        fontSize: 18,
        fill: MODERN_ADV.text,
        fontWeight: 'normal',
        letterSpacing: 1,
        fontFamily: this.#fontFamilies.body,
        stroke: { width: 1.2, color: MODERN_ADV.ink },
      } satisfies TextStyleOptions,
    });
    this.#dialogText = new PText({
      text: '',
      style: {
        fontSize: 25,
        fill: MODERN_ADV.text,
        fontWeight: 'normal',
        fontFamily: this.#fontFamilies.body,
        letterSpacing: 0.3,
        lineHeight: 41,
        // gal 口径真描边（对应 CSS paint-order: stroke fill，非阴影假描边）：
        // 白字 + 深色描边，浅/深背景均清晰；原 dropShadow 移除
        stroke: { width: 1.35, color: MODERN_ADV.ink },
      } satisfies TextStyleOptions,
    });
    // 对话框预断行（M5 支柱4：断行禁则）：字数容量作无测量环境降级口径（像素测量见 #wrapDialogText）
    this.#dialogCharsPerLine = Math.max(10, Math.floor((this.#w - 220) / 25));
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
    return wrapCjkMeasure(plain, this.#w - 220, (s) => ctx.measureText(s).width);
  }

  /** 初始化 Pixi 应用与舞台层级（真实项目在 DOM 就绪后调用）。
   *  resolution 按设备像素比渲染（高分屏不糊），autoDensity 保持逻辑尺寸 1280×720。
   *  严格 CSP（禁 unsafe-eval）环境自动安装 pixi.js/unsafe-eval 垫片后重试——
   *  Electron 加固壳/内嵌 webview 等宿主不再因 CSP 直接崩溃。 */
  async init(canvas?: HTMLCanvasElement): Promise<void> {
    const app = new Application();
    const resolution = typeof window !== 'undefined' && window.devicePixelRatio > 0
      ? Math.min(2, window.devicePixelRatio)
      : 1;
    const opts = {
      width: this.#w,
      height: this.#h,
      background: 0x000000,
      // ADV 画面主要由位图和文字纹理组成；关闭 MSAA 可明显降低低端 GPU 的每帧成本，
      // 不会影响文字本身的抗锯齿（文字仍由 Pixi 先生成纹理）。
      antialias: false,
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

    // 鼠标移动/点击唤出操作带；使用 DOM 事件而不是额外 Pixi ticker，避免覆盖层之间抢事件。
    const wakeRail = () => this.#wakeCommandRail();
    this.#commandRailPointerWake = wakeRail;
    app.canvas.addEventListener('pointermove', wakeRail);
    app.canvas.addEventListener('pointerdown', wakeRail);

    app.stage.addChild(this.#worldLayer, this.#particleLayer, this.#uiLayer);
    // flash 置最末：闪光覆盖全部 UI（黑场 fade 在其下，转场与闪光可叠加；tint 叠加在 fade 之上、flash 之下）
    this.#uiLayer.addChild(this.#speakerText, this.#dialogText, this.#fadeOverlay, this.#tintOverlay, this.#flashOverlay);
    this.#layout();
    return undefined;
  }

  /** 等比缩放画布 CSS 尺寸以适配窗口（保持 16:9，居中由宿主 CSS 负责）。
   *  内部分辨率保持 1280×720 逻辑尺寸；渲染分辨率同步为 实际缩放×设备像素比，
   *  使画布后备像素与屏幕物理像素 1:1 —— 避免固定 DPR 后备被 CSS 非整数缩放插值发糊（精致化批：修糊） */
  fitWindow(): void {
    const app = this.app;
    if (!app || typeof window === 'undefined') return;
    const scale = Math.max(0.2, Math.min(window.innerWidth / this.#w, window.innerHeight / this.#h));
    const canvas = app.canvas;
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    // 窗口放大时不让后备画布按 3x/4x DPR 无限膨胀；2x 已足够保持高分屏清晰。
    const res = Math.min(2, Math.max(0.75, dpr * scale));
    const renderer = app.renderer as unknown as { resolution: number; resize: (w: number, h: number) => void };
    if (Math.abs(renderer.resolution - res) > 0.01) {
      renderer.resolution = res;
      // resize 会按 autoDensity 把 CSS 重置回逻辑尺寸，必须先于 CSS 赋值
      renderer.resize(this.#w, this.#h);
    }
    canvas.style.width = `${Math.round(this.#w * scale)}px`;
    canvas.style.height = `${Math.round(this.#h * scale)}px`;
  }

  #layout(): void {
    // 无框 ADV 对话区：文字沿底部安全区排版，背景渐隐只负责可读性。
    this.#speakerText.position.set(92, this.#h - 226);
    this.#dialogText.position.set(92, this.#h - 174);
    this.#dialogRubyLayer.position.set(92, this.#h - 174);
    if (this.#speakerAvatar) this.#speakerAvatar.position.set(58, this.#h - 54);
    // 选择肢：细线纵列位于画面中下部，不使用厚重按钮卡片。
    const step = 58;
    // 选择肢落在画面中下部，避开现代 ADV 立绘的脸部焦点，同时不压住底部对白安全区。
    const startY = this.#h * 0.60 - (this.#choiceViews.length - 1) * step / 2;
    for (let i = 0; i < this.#choiceViews.length; i++) {
      const v = this.#choiceViews[i]!;
      const w = v.label.width + 60;
      v.holder.position.set((this.#w - w) / 2, startY + i * step - (v.label.height + 20) / 2);
    }
  }

  /** 对话层只绘制三段透明渐隐，不形成卡片轮廓。 */
  #drawDialogPanel(): void {
    const g = this.#dialogPanel;
    g.clear();
    g.rect(0, this.#h - 282, this.#w, 88).fill({ color: MODERN_ADV.scrim, alpha: 0.10 });
    g.rect(0, this.#h - 194, this.#w, 112).fill({ color: MODERN_ADV.scrim, alpha: 0.25 });
    g.rect(0, this.#h - 82, this.#w, 82).fill({ color: MODERN_ADV.scrim, alpha: 0.52 });
  }

  /** 说话人标记：只保留一条细强调线，不再绘制名牌卡片。 */
  #drawSpeakerPlate(): void {
    const g = this.#speakerPlate;
    g.clear();
    const show = this.#speakerText.text.length > 0 && !this.#interfaceHidden && !this.#nvlActive;
    g.visible = show;
    if (!show) return;
    const x = 92;
    const y = this.#h - 198;
    const w = Math.max(56, this.#speakerText.width + 14);
    g.rect(x, y, w, 1.5).fill({ color: MODERN_ADV.accent, alpha: 0.78 });
  }

  /**
   * 注册真实背景素材（URL 或已加载的 Texture）。之后 @bg key 使用真实素材而非程序化占位。
   * URL 通过 Pixi Assets 异步加载；清除同名占位缓存使下一次 setBackground 生效。
   */
  async registerBackground(key: string, src: string | Texture, format?: string): Promise<void> {
    const parser = format === 'svg' ? 'loadSVG' : format ? 'loadTextures' : undefined;
    const tex = typeof src === 'string' ? await Assets.load(parser ? { src, parser } : src) : src;
    this.#registeredBgs.set(key, tex);
    this.#bgTextureCache.delete(key);
    // 资源可能在 @bg 已经投影后才完成加载；替换当前画面，避免首帧占位永久驻留。
    if (this.#backgroundKey === key) this.setBackground(key);
  }

  /** 当前某个字体角色实际使用的字体族，供宿主诊断与测试使用。 */
  getFontFamily(role: FontRole): string {
    return this.#fontFamilies[role];
  }

  #applyTypography(): void {
    TextStyle.defaultTextStyle.fontFamily = this.#fontFamilies.body;
    this.#dialogText.style.fontFamily = this.#fontFamilies.body;
    this.#speakerText.style.fontFamily = this.#fontFamilies.body;
    this.#bannerText.style.fontFamily = this.#fontFamilies.title;
    // 字体角色可能在首屏之后才完成注册；允许下一次 showText 重新测量并生成纹理。
    this.#lastShownSpeaker = undefined;
  }

  /**
   * 按角色加载项目内嵌字体。失败仅保留该角色的回退栈，其他角色继续工作。
   * 变量字体以常规字重注册；舞台不通过浏览器伪粗体制造标题重量。
   */
  async registerFontRole(role: FontRole, url: string, family = `SurdetGame${role[0]!.toUpperCase()}${role.slice(1)}Font`, timeoutMs = 3000): Promise<boolean> {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false; // 非浏览器/测试环境
    try {
      const face = new FontFace(family, `url(${url})`, { weight: '400' });
      const loaded = await Promise.race([
        face.load(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('字体加载超时')), timeoutMs)),
      ]);
      (document.fonts as unknown as { add: (f: FontFace) => void }).add(loaded);
      this.#fontFamilies[role] = family;
      this.#applyTypography();
      return true;
    } catch (err) {
      console.warn(`[PixiStage] ${role} 字体加载失败，回退系统字体：`, err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /**
   * 兼容旧版单字体接口：一个字体同时覆盖标题、正文和 UI。
   * 新项目应改用 registerFontRole，以避免展示字体误用于长文本。
   */
  async registerFont(url: string, family = 'SurdetGameFont', timeoutMs = 3000): Promise<boolean> {
    const ok = await this.registerFontRole('body', url, family, timeoutMs);
    if (!ok) return false;
    this.#fontFamilies.title = family;
    this.#fontFamilies.ui = family;
    this.#applyTypography();
    return true;
  }

  /** 清除项目字体并恢复三类回退栈（预览重载时不能沿用旧项目的字体）。 */
  resetFonts(): void {
    this.#fontFamilies = {
      title: ADV_TITLE_FONT_STACK,
      body: ADV_FONT_STACK,
      ui: ADV_FONT_STACK,
    };
    this.#applyTypography();
  }

  /** 旧版重置接口保留，行为等同于 resetFonts。 */
  resetFont(): void {
    this.resetFonts();
  }

  /**
   * 注册真实立绘素材（按 角色:服装:表情 精确匹配）。之后 @show charId:costume 对应表情
   * 使用真实素材而非程序化占位。URL 通过 Pixi Assets 异步加载。
   */
  async registerPortrait(charId: string, costume: string, expression: string, src: string | Texture, format?: string): Promise<void> {
    const parser = format === 'svg' ? 'loadSVG' : format ? 'loadTextures' : undefined;
    const tex = typeof src === 'string' ? await Assets.load(parser ? { src, parser } : src) : src;
    const cacheKey = `${charId}:${costume}:${expression}`;
    this.#registeredPortraits.set(cacheKey, tex);
    this.#portraitTextureCache.delete(cacheKey);
    // 同样处理运行中替换立绘的情况：注册完成后立即为已显示的角色启动交叉淡化。
    for (const [spriteKey, view] of this.#portraitViews) {
      if (`${view.charId}:${view.costume}:${view.expression}` === cacheKey) this.setPortrait(spriteKey, view);
    }
  }

  /** 注册对白区小头像；缺失时不显示头像，不猜测主立绘。 */
  async registerAvatar(key: string, src: string | Texture, format?: string): Promise<void> {
    const parser = format === 'svg' ? 'loadSVG' : format ? 'loadTextures' : undefined;
    const tex = typeof src === 'string' ? await Assets.load(parser ? { src, parser } : src) : src;
    this.#registeredAvatars.set(key, tex);
    this.#updateSpeakerAvatar();
  }

  /** 配置显示名到角色 ID 的显式映射，供说话人聚焦与头像投影使用。 */
  setSpeakerProfiles(profiles: SpeakerProfile[]): void {
    this.#speakerProfiles.clear();
    for (const profile of profiles) {
      if (profile.name.trim().length > 0 && profile.id.trim().length > 0) {
        this.#speakerProfiles.set(profile.name.trim(), profile);
      }
    }
    this.#updateSpeakerAvatar();
  }

  /** 当前说话角色聚焦；未配置角色资料时传 null，所有立绘保持原始存在感。 */
  setActiveSpeaker(characterId: string | null): void {
    this.#activeSpeakerId = characterId;
    for (const [key, sprite] of this.#portraitSprites) {
      const view = this.#portraitViews.get(key);
      sprite.alpha = !characterId || view?.charId === characterId ? 1 : 0.46;
    }
    this.#updateSpeakerAvatar();
  }

  #updateSpeakerAvatar(): void {
    const sprite = this.#speakerAvatar;
    if (!sprite) return;
    const profile = [...this.#speakerProfiles.values()].find((p) => p.id === this.#activeSpeakerId);
    // 头像必须由角色资料显式声明；不要因为存在同名资源就猜测映射。
    const key = profile?.avatarKey;
    const texture = key ? this.#registeredAvatars.get(key) : undefined;
    if (!texture || !profile || this.#interfaceHidden || this.#nvlActive) {
      sprite.visible = false;
      return;
    }
    sprite.texture = texture;
    const size = 96;
    sprite.width = size;
    sprite.height = size * (texture.height / Math.max(1, texture.width));
    sprite.position.set(54, this.#h - 52);
    sprite.alpha = 0.94;
    sprite.visible = true;
  }

  setBackground(key: string | null): void {
    this.#stopBackgroundTransition();
    this.#backgroundKey = key;
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
    // cover：保持背景比例并从中心裁切，避免真实素材被拉伸成“编辑器占位图”。
    const scale = Math.max(this.#w / Math.max(1, texture.width), this.#h / Math.max(1, texture.height));
    sprite.width = texture.width * scale;
    sprite.height = texture.height * scale;
    sprite.position.set((this.#w - sprite.width) / 2, (this.#h - sprite.height) / 2);
    this.#bgSprite = sprite;
    sprite.alpha = 1;
    this.#bgLayer.addChildAt(sprite, 0);
  }

  #stopBackgroundTransition(): void {
    const transition = this.#bgTransition;
    if (!transition) return;
    if (transition.old && transition.old.parent) transition.old.parent.removeChild(transition.old);
    transition.old?.destroy();
    this.#bgTransition = null;
  }

  #startTimelineBackground(key: string, durMs: number): void {
    if (this.#backgroundKey === key && this.#bgSprite) return;
    this.#stopBackgroundTransition();
    const texture = this.#registeredBgs.get(key)
      ?? this.#bgTextureCache.get(key)
      ?? makeBackgroundTexture(key, this.#w, this.#h);
    this.#bgTextureCache.set(key, texture);
    const neu = new Sprite(texture);
    const scale = Math.max(this.#w / Math.max(1, texture.width), this.#h / Math.max(1, texture.height));
    neu.width = texture.width * scale;
    neu.height = texture.height * scale;
    neu.position.set((this.#w - neu.width) / 2, (this.#h - neu.height) / 2);
    neu.alpha = 0;
    const old = this.#bgSprite;
    this.#backgroundKey = key;
    this.#bgSprite = neu;
    this.#bgLayer.addChild(neu);
    if (!old || durMs <= 0) {
      old?.destroy();
      neu.alpha = 1;
      return;
    }
    this.#bgTransition = { old, neu, remain: Math.max(1, durMs), dur: Math.max(1, durMs) };
  }

  setPortrait(key: string, opts: PortraitView): void {
    this.#portraitViews.set(key, opts);
    const cacheKey = `${opts.charId}:${opts.costume}:${opts.expression}`;
    let texture = this.#registeredPortraits.get(cacheKey)
      ?? this.#portraitTextureCache.get(cacheKey);
    if (!texture) {
      texture = makePortraitTexture(opts.charId, opts.costume, opts.expression);
      this.#portraitTextureCache.set(cacheKey, texture);
    }
    const pw = Math.min(430, this.#w * 0.36);
    const ph = (texture.height / texture.width) * pw;
    const baseY = this.#h + 10;
    const px = opts.pos === 'left' ? this.#w * 0.25 : opts.pos === 'right' ? this.#w * 0.75 : this.#w * 0.5;
    const existing = this.#portraitSprites.get(key);
    if (!existing) {
      const sprite = new Sprite(texture);
      sprite.width = pw;
      sprite.height = ph;
      sprite.anchor.set(0.5, 1);
      sprite.position.set(px, baseY);
      sprite.alpha = !this.#activeSpeakerId || opts.charId === this.#activeSpeakerId ? 1 : 0.46;
      this.#portraitSprites.set(key, sprite);
      this.#portraitLayer.addChild(sprite);
      return;
    }
    if (existing.texture === texture) {
      // 同纹理：仅移动（位置/尺寸无需过渡）
      existing.position.set(px, baseY);
      existing.alpha = !this.#activeSpeakerId || opts.charId === this.#activeSpeakerId ? 1 : 0.46;
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
      this.#portraitViews.delete(k);
    }
  }

  showText(speaker: string | null, value: string): void {
    if (this.#lastShownSpeaker === speaker && this.#lastShownDialog === value) return;
    this.#lastShownSpeaker = speaker;
    this.#lastShownDialog = value;
    const profile = speaker ? this.#speakerProfiles.get(speaker.trim()) : undefined;
    this.setActiveSpeaker(profile?.id ?? null);
    // 现代 ADV 说话人标签：保留「」作为项目既有文本约定，但不再放入卡片。
    this.#speakerText.text = speaker !== null && speaker.length > 0 ? `「${speaker}」` : '';
    this.#drawSpeakerPlate();
    this.#updateSpeakerAvatar();
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
          fontSize: 25,
          fill: MODERN_ADV.text,
          fontWeight: 'normal',
          fontFamily: this.#dialogText.style.fontFamily,
          letterSpacing: 0.3,
          lineHeight: 41,
          stroke: { width: 1.35, color: MODERN_ADV.ink },
        } satisfies TextStyleOptions,
      });
      base.position.set(x, 0);
      this.#dialogRubyLayer.addChild(base);
      if (seg.ruby !== undefined) {
        const r = new PText({
          text: seg.ruby,
        style: {
          fontSize: 12,
          fill: MODERN_ADV.text,
          fontWeight: 'normal',
          fontFamily: this.#dialogText.style.fontFamily,
          stroke: { width: 0.8, color: MODERN_ADV.ink },
        } satisfies TextStyleOptions,
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

  /** 等待推进指示器可见性（呼吸小光点；同时决定面板是否保持显示） */
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

  /** 呼吸小光点动画（由 AdvRenderer 每帧转发 ticker delta；alpha 呼吸 + 轻微浮动） */
  updateContinuePulse(deltaMs: number): void {
    if (!this.#continueIndicator.visible) return;
    this.#continuePhase = (this.#continuePhase + deltaMs / 1000 * 3) % (Math.PI * 2);
    this.#continueIndicator.y = this.#h - 46 + Math.sin(this.#continuePhase) * 3;
    this.#continueIndicator.alpha = 0.7 + Math.sin(this.#continuePhase) * 0.28;
  }

  /** 展示 Backlog 覆盖层（半透明黑底 + 最近 N 条，CJK 按字符数软换行；点击任意处关闭）。
   *  onReplayVoice：点击带语音标记的行重播（@voice 紧跟的文本行） */
  showBacklog(entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void): void {
    const layer = this.#backlogLayer;
    if (!this.#backlogBuilt) {
      layer.eventMode = 'static';
      // 滚轮由宿主统一路由到 scrollBacklog，避免 Pixi 与宿主各处理一次导致滚动过量。
      // 空白处点击关闭仍由覆盖层自身处理。
      layer.on('pointerdown', () => {
        this.hideBacklog();
        this.onBacklogClose?.();
      });
      this.#backlogBuilt = true;
    }
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: NIGHT_AZURE.panelBg, alpha: 0.94 }));
    layer.addChild(new PText({
      text: '文字记录（滚轮/PageUp/PageDown 滚动 · 点击任意处关闭）',
      style: { fontSize: 22, fill: NIGHT_AZURE.panelText, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 30);
    // 条目层（整体滚动；CJK 断行禁则软换行，M5 支柱4：标点不挂行首/行尾，……不拆）
    const entriesLayer = new Container();
    // 先替换引用，再做初始滚动。旧 entriesLayer 已经随上一轮子树销毁，
    // 不能在这里继续调用它的 position.set（第二次打开记录时会稳定触发 null.set）。
    this.#backlogEntriesLayer = entriesLayer;
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
            fill: first && e.speaker ? NIGHT_AZURE.nameTag : 0x454c5c,
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
    this.#commandRail.visible = !hidden && !this.#commandRailSuppressed && this.#commandRailItems.length > 0;
    this.#drawSpeakerPlate();
    this.#updateSpeakerAvatar();
  }

  /** 展示现代 ADV 底部操作带。 */
  showCommandRail(items: CommandRailItem[], onSelect: (id: string) => void): void {
    this.#commandRailSuppressed = false;
    this.#commandRailOnSelect = onSelect;
    this.#commandRailItems = items.map((item) => ({ ...item }));
    this.#rebuildCommandRail();
    this.#commandRail.visible = !this.#interfaceHidden && !this.#commandRailSuppressed && this.#commandRailItems.length > 0;
    this.#wakeCommandRail();
  }

  /** 更新操作带状态并保持当前悬停/淡出机制。 */
  setCommandRailItems(items: CommandRailItem[]): void {
    this.#commandRailItems = items.map((item) => ({ ...item }));
    this.#rebuildCommandRail();
    this.#commandRail.visible = !this.#interfaceHidden && !this.#commandRailSuppressed && this.#commandRailItems.length > 0;
    if (!this.#commandRailSuppressed) this.#wakeCommandRail();
  }

  hideCommandRail(): void {
    this.#commandRailSuppressed = true;
    this.#commandRail.visible = false;
  }

  #wakeCommandRail(): void {
    if (this.#interfaceHidden || this.#commandRailSuppressed || this.#commandRailItems.length === 0) return;
    this.#commandRailWakeRemain = 2800;
    this.#commandRail.visible = true;
    this.#commandRail.alpha = Math.max(this.#commandRail.alpha, 0.72);
  }

  #rebuildCommandRail(): void {
    const layer = this.#commandRail;
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (this.#commandRailItems.length === 0) return;
    const railH = 46;
    const count = this.#commandRailItems.length;
    const slotW = 44;
    const slotGap = 4;
    const railPad = 8;
    const railW = railPad * 2 + count * slotW + (count - 1) * slotGap;
    const startX = Math.max(12, this.#w - railW - 18);
    const top = this.#h - railH - 10;
    layer.addChild(new Graphics()
      .roundRect(startX, top, railW, railH, 5)
      .fill({ color: MODERN_ADV.rail, alpha: 0.82 })
      .stroke({ width: 1, color: MODERN_ADV.line, alpha: 0.3 }));

    this.#commandRailItems.forEach((item, index) => {
      const row = new Container();
      row.position.set(startX + railPad + index * (slotW + slotGap), top + 3);
      const hit = new Graphics().roundRect(0, 0, slotW, railH - 6, 3).fill({ color: 0xffffff, alpha: 0.001 });
      const icon = new PText({
        text: item.icon ?? '·',
        style: {
          fontSize: 20,
          fill: item.active ? MODERN_ADV.accent : MODERN_ADV.muted,
          fontWeight: item.active ? 'bold' : 'normal',
          fontFamily: this.#fontFamilies.ui,
        } satisfies TextStyleOptions,
      });
      icon.anchor.set(0.5);
      icon.position.set(slotW / 2, (railH - 6) / 2);
      const label = new PText({
        text: item.label,
        style: {
          fontSize: 12,
          fill: item.enabled === false ? 0x596274 : item.active ? MODERN_ADV.text : MODERN_ADV.muted,
          letterSpacing: 1,
          fontFamily: this.#fontFamilies.ui,
        } satisfies TextStyleOptions,
      });
      // 默认只显示符号；悬停时才显示短标签，保持正文画面的低干扰。
      label.anchor.set(0.5, 1);
      label.position.set(slotW / 2, -4);
      label.alpha = 0;
      const underline = new Graphics()
        .rect(10, railH - 8, slotW - 20, 1.5)
        .fill({ color: MODERN_ADV.accent, alpha: item.active ? 0.9 : 0 });
      row.addChild(hit, icon, label, underline);
      row.alpha = item.enabled === false ? 0.38 : 1;
      if (item.enabled !== false) {
        row.eventMode = 'static';
        row.cursor = 'pointer';
        row.on('pointerover', () => {
          this.#wakeCommandRail();
          label.alpha = 1;
          underline.clear().rect(10, railH - 8, slotW - 20, 1.5)
            .fill({ color: MODERN_ADV.accent, alpha: 0.9 });
          label.style = { fontSize: 12, fill: MODERN_ADV.text, letterSpacing: 1, fontFamily: this.#fontFamilies.ui } satisfies TextStyleOptions;
        });
        row.on('pointerout', () => {
          label.alpha = 0;
          underline.clear().rect(10, railH - 8, slotW - 20, 1.5)
            .fill({ color: MODERN_ADV.accent, alpha: item.active ? 0.9 : 0 });
          label.style = {
            fontSize: 12,
            fill: item.active ? MODERN_ADV.text : MODERN_ADV.muted,
            letterSpacing: 1,
            fontFamily: this.#fontFamilies.ui,
          } satisfies TextStyleOptions;
        });
        row.on('pointerdown', () => this.#commandRailOnSelect?.(item.id));
      }
      layer.addChild(row);
    });
    layer.alpha = this.#commandRailIdleAlpha;
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
    this.#backlogEntriesLayer = null;
    this.#backlogContentH = 0;
    this.#backlogScroll = 0;
  }

  /* ============================ 演出效果（@shake/@flash/@zoom） ============================ */

  /** 时间轴 cue 的 Pixi 投影；同一接口也承载现有直接演出方法。 */
  applyTimelineFrame(event: TimelineFrameEvent): void {
    const cue = event.cue;
    if (event.track === 'background' && cue.action === 'set' && typeof cue.key === 'string' && event.progress <= 0.001) {
      this.#startTimelineBackground(cue.key, cue.durationMs);
      return;
    }
    if (event.track === 'portrait' && event.target) {
      const target = event.target;
      if (cue.action === 'show' && event.progress <= 0.001) {
        this.setPortrait(target, {
          charId: target.split(':')[0] ?? target,
          costume: target.split(':')[1] ?? 'normal',
          expression: typeof cue.expression === 'string' ? cue.expression : 'normal',
          pos: typeof cue.position === 'string' ? cue.position : 'center',
        });
      } else if (cue.action === 'expression' && event.progress <= 0.001) {
        const current = this.#portraitViews.get(target);
        if (current && typeof cue.expression === 'string') this.setPortrait(target, { ...current, expression: cue.expression });
      } else if (cue.action === 'move') {
        const sprite = this.#portraitSprites.get(target);
        const targetX = typeof cue.position === 'string' ? this.#resolvePortraitX(cue.position) : null;
        if (sprite && targetX !== null) {
          let starts = this.#timelineMoveStarts.get(cue);
          if (!starts) {
            starts = new Map([[target, sprite.x]]);
            this.#timelineMoveStarts.set(cue, starts);
          }
          sprite.x = starts.get(target)! + (targetX - starts.get(target)!) * event.progress;
          if (event.progress >= 1) this.#timelineMoveStarts.delete(cue);
        }
      } else if (cue.action === 'show') {
        const sprite = this.#portraitSprites.get(target);
        if (sprite) {
          const activeAlpha = !this.#activeSpeakerId || this.#portraitViews.get(target)?.charId === this.#activeSpeakerId ? 1 : 0.46;
          sprite.alpha = activeAlpha * event.progress;
          sprite.y = this.#h + 10 + (1 - event.progress) * 28;
        }
      } else if (cue.action === 'hide') {
        const sprite = this.#portraitSprites.get(target);
        if (sprite) sprite.alpha = 1 - event.progress;
        if (event.progress >= 1) this.removePortrait(target);
      }
      return;
    }
    if (event.track === 'camera' && cue.action === 'zoom' && typeof cue.scale === 'number') {
      let from = this.#timelineValueStarts.get(cue);
      if (from === undefined) {
        from = this.#worldLayer.scale.x;
        this.#timelineValueStarts.set(cue, from);
      }
      const scale = from + (Math.max(0.25, Math.min(4, cue.scale)) - from) * event.progress;
      this.#worldLayer.scale.set(scale);
      const off = this.#zoomBaseOffset();
      this.#worldLayer.position.set(off.x, off.y);
      if (event.progress >= 1) this.#timelineValueStarts.delete(cue);
      return;
    }
    if (event.track === 'screen') {
      if (cue.action === 'fade' && typeof cue.alpha === 'number') {
        this.#fadeOverlay.alpha = Math.max(0, Math.min(1, cue.alpha * event.progress));
      } else if (cue.action === 'tint' && typeof cue.color === 'number' && typeof cue.alpha === 'number') {
        this.#tintOverlay.tint = cue.color & 0xffffff;
        this.#tintOverlay.alpha = Math.max(0, Math.min(1, cue.alpha * event.progress));
        this.#tintOverlay.visible = this.#tintOverlay.alpha > 0.001;
      } else if (cue.action === 'flash' && event.progress <= 0.001) {
        this.flash(cue.durationMs);
      } else if (cue.action === 'wipe' && event.progress <= 0.001) {
        this.wipe(cue.durationMs);
      }
      return;
    }
    if (event.track === 'particle' && typeof cue.kind === 'string' && event.progress <= 0.001) {
      if (cue.action === 'start') this.startParticles(cue.kind);
      else this.stopParticles();
    }
  }

  snapshotPresentation(): unknown {
    return {
      version: 1,
      backgroundKey: this.#backgroundKey,
      portraits: [...this.#portraitViews.entries()].map(([key, view]) => ({ key, view })),
      cameraScale: this.#worldLayer.scale.x,
      fadeAlpha: this.#fadeOverlay.alpha,
      tint: { color: this.#tintOverlay.tint ?? 0, alpha: this.#tintOverlay.alpha },
      particleKind: this.#particleKind,
    };
  }

  restorePresentation(snapshot: unknown): void {
    this.clearPresentation();
    if (typeof snapshot !== 'object' || snapshot === null) return;
    const raw = snapshot as Record<string, unknown>;
    if (typeof raw.backgroundKey === 'string') this.setBackground(raw.backgroundKey);
    if (Array.isArray(raw.portraits)) {
      for (const item of raw.portraits) {
        if (typeof item !== 'object' || item === null) continue;
        const record = item as Record<string, unknown>;
        if (typeof record.key !== 'string' || typeof record.view !== 'object' || record.view === null) continue;
        this.setPortrait(record.key, record.view as PortraitView);
      }
    }
    if (typeof raw.cameraScale === 'number' && Number.isFinite(raw.cameraScale)) {
      this.#worldLayer.scale.set(Math.max(0.25, Math.min(4, raw.cameraScale)));
      const off = this.#zoomBaseOffset();
      this.#worldLayer.position.set(off.x, off.y);
    }
    if (typeof raw.fadeAlpha === 'number') this.setFade(raw.fadeAlpha);
    if (typeof raw.tint === 'object' && raw.tint !== null) {
      const tint = raw.tint as Record<string, unknown>;
      if (typeof tint.color === 'number' && typeof tint.alpha === 'number') {
        this.#tintOverlay.tint = tint.color & 0xffffff;
        this.#tintOverlay.alpha = Math.max(0, Math.min(1, tint.alpha));
        this.#tintOverlay.visible = this.#tintOverlay.alpha > 0.001;
      }
    }
    if (typeof raw.particleKind === 'string') this.startParticles(raw.particleKind);
  }

  clearPresentation(): void {
    this.#stopBackgroundTransition();
    for (const key of [...this.#portraitSprites.keys()]) this.removePortrait(key);
    this.setBackground(null);
    this.#timelineMoveStarts.clear();
    this.#timelineValueStarts.clear();
    this.#worldLayer.position.set(0, 0);
    this.#worldLayer.scale.set(1);
    this.setFade(0);
    this.#tintOverlay.alpha = 0;
    this.#tintOverlay.visible = false;
    this.stopParticles();
  }

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
    if (this.#bgTransition) {
      const transition = this.#bgTransition;
      transition.remain = Math.max(0, transition.remain - deltaMs);
      const t = 1 - transition.remain / transition.dur;
      transition.neu.alpha = t;
      if (transition.old) transition.old.alpha = 1 - t;
      if (transition.remain === 0) {
        if (transition.old?.parent) transition.old.parent.removeChild(transition.old);
        transition.old?.destroy();
        transition.neu.alpha = 1;
        this.#bgTransition = null;
      }
    }
    // 选择肢入场淡入（逐卡错峰：第 i 张在第 i*80ms 开始，各自 #choiceFadeDur 内渐显）
    if (this.#choiceFadeRemain > 0 && this.#choiceViews.length > 0) {
      this.#choiceFadeRemain = Math.max(0, this.#choiceFadeRemain - deltaMs);
      const total = this.#choiceFadeDur + (this.#choiceViews.length - 1) * 80;
      const elapsed = total - this.#choiceFadeRemain;
      this.#choiceViews.forEach((v, i) => {
        v.holder.alpha = Math.max(0, Math.min(1, (elapsed - i * 80) / this.#choiceFadeDur));
      });
    }
    if (this.#commandRail.visible) {
      if (this.#commandRailWakeRemain > 0) {
        this.#commandRailWakeRemain = Math.max(0, this.#commandRailWakeRemain - deltaMs);
      }
      const target = this.#commandRailWakeRemain > 0 ? 0.94 : this.#commandRailIdleAlpha;
      this.#commandRail.alpha += (target - this.#commandRail.alpha) * Math.min(1, deltaMs / 120);
    }
    this.#updateMenuMotion(deltaMs);
    this.#updateTransient(deltaMs);
  }

  /** 系统菜单入场：遮罩渐显，右侧抽屉短距离滑入；不使用弹跳，避免像设置面板或网页弹窗。 */
  #updateMenuMotion(deltaMs: number): void {
    if (this.#menuMotionRemain <= 0 || !this.#menuLayer.visible) return;
    this.#menuMotionRemain = Math.max(0, this.#menuMotionRemain - deltaMs);
    const progress = 1 - this.#menuMotionRemain / this.#menuMotionDur;
    const eased = 1 - Math.pow(1 - progress, 3);
    this.#menuLayer.alpha = Math.min(1, progress / 0.72);
    if (this.#menuPanel) this.#menuPanel.x = this.#menuMotionOffset * (1 - eased);
    if (this.#menuMotionRemain === 0) {
      this.#menuLayer.alpha = 1;
      if (this.#menuPanel) this.#menuPanel.x = 0;
    }
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
    if (pos === 'left') return this.#w * 0.25;
    if (pos === 'right') return this.#w * 0.75;
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

  /** 横幅：chapter 变体电影化（上下黑边 letterbox + 大字距渐显），tip 变体右上小胶囊；首尾淡入淡出 */
  showBanner(text: string, variant: 'chapter' | 'tip'): void {
    if (text.length === 0) return;
    this.#bannerText.text = text;
    this.#bannerText.style = variant === 'chapter'
      ? { fontSize: 38, fill: NIGHT_AZURE.text, fontWeight: 'normal', letterSpacing: 6, fontFamily: this.#fontFamilies.title } satisfies TextStyleOptions
      : { fontSize: 20, fill: NIGHT_AZURE.plateText, fontFamily: this.#fontFamilies.ui } satisfies TextStyleOptions;
    this.#bannerBars.visible = variant === 'chapter';
    this.#bannerTipBg.clear();
    if (variant === 'chapter') {
      this.#bannerText.anchor.set(0.5);
      this.#bannerText.position.set(this.#w / 2, this.#h * 0.4);
    } else {
      this.#bannerText.anchor.set(1, 0);
      this.#bannerText.position.set(this.#w - 60, 40);
      // 右上小胶囊底板（玻璃家族口径：深蓝底 + 冷灰蓝细描边）
      const tw = this.#bannerText.width;
      const th = this.#bannerText.height;
      this.#bannerTipBg.roundRect(this.#w - 60 - tw - 20, 32, tw + 40, th + 16, (th + 16) / 2)
        .fill({ color: NIGHT_AZURE.choiceBg, alpha: 0.8 })
        .stroke({ width: 1, color: NIGHT_AZURE.choiceEdge, alpha: 0.9 });
    }
    this.#bannerDur = variant === 'chapter' ? 2200 : 1800;
    this.#bannerRemain = this.#bannerDur;
    this.#bannerLayer.visible = true;
    this.#bannerLayer.alpha = 0; // 渐显由 #updateTransient 驱动（首 300ms 淡入 / 末 400ms 淡出）
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
      style: { fontSize: 20, fill: 0x333a49, fontFamily: this.#fontFamilies.body } satisfies TextStyleOptions,
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
      const elapsed = this.#bannerDur - this.#bannerRemain;
      this.#bannerLayer.alpha = Math.min(1, elapsed / 300, this.#bannerRemain / 400);
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
    onClose?: () => void;
  }): void {
    this.hideSettings();
    this.hideSaveLoad();
    this.hideCommandRail();
    this.#galleryViews = { cgs: opts.cgs, music: opts.music, texts: opts.texts ?? [] };
    this.#galleryOnPlayMusic = opts.onPlayMusic ?? null;
    this.#galleryOnReplayText = opts.onReplayText ?? null;
    this.#galleryOnClose = opts.onClose ?? null;
    this.#galleryMode = 'grid';
    this.#galleryViewerKey = null;
    this.#rebuildGallery();
    this.#uiLayer.setChildIndex(this.#galleryLayer, this.#uiLayer.children.length - 1);
    this.#galleryLayer.visible = true;
  }

  /** 隐藏鉴赏界面 */
  hideGallery(): void {
    this.#galleryLayer.visible = false;
    this.#commandRailSuppressed = false;
  }

  #closeGallery(): void {
    this.hideGallery();
    this.#galleryOnClose?.();
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
        style: { fontSize: 24, fill: active ? NIGHT_AZURE.accent : 0x8a93a8, fontWeight: active ? 'bold' : 'normal' } satisfies TextStyleOptions,
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
    layer.addChild(mkBtn('✕ 关闭', this.#w - 150, false, () => this.#closeGallery()));

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
    // 设置是独立覆盖层，避免操作带在设置内容下方残留并抢占命中区域。
    this.hideSaveLoad();
    this.hideGallery();
    this.hideCommandRail();
    this.#settingsRows = rows;
    this.#settingsHandlers = { onChange, onClose };
    this.#rebuildSettings();
    this.#uiLayer.setChildIndex(this.#settingsLayer, this.#uiLayer.children.length - 1);
    this.#settingsLayer.visible = true;
  }

  /** 隐藏设置面板 */
  hideSettings(): void {
    this.#settingsLayer.visible = false;
    this.#commandRailSuppressed = false;
  }

  #rebuildSettings(): void {
    const layer = this.#settingsLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const bg = new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x02060d, alpha: 0.66 });
    bg.eventMode = 'static';
    bg.on('pointerdown', () => {
      this.hideSettings();
      this.#settingsHandlers?.onClose();
    });
    layer.addChild(bg);

    const px = 240;
    const py = 54;
    const pw = 800;
    const headerH = 106;
    const rowH = 58;
    const panelH = headerH + this.#settingsRows.length * rowH + 34;
    layer.addChild(new Graphics()
      .roundRect(px + 10, py + 12, pw, panelH, 6)
      .fill({ color: 0x000000, alpha: 0.28 }));
    layer.addChild(new Graphics()
      .roundRect(px, py, pw, panelH, 6)
      .fill({ color: 0x081321, alpha: 0.98 })
      .stroke({ width: 1, color: 0x5d86a6, alpha: 0.52 }));
    layer.addChild(new Graphics()
      .rect(px, py, 3, panelH)
      .fill({ color: 0x79d5e6, alpha: 0.94 }));
    layer.addChild(new PText({
      text: 'SETTINGS',
      style: { fontSize: 13, fill: 0x83b4c5, letterSpacing: 4, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(px + 30, py + 20);
    layer.addChild(new PText({
      text: '设置',
      style: { fontSize: 28, fill: 0xf1f7ff, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(px + 28, py + 44);
    layer.addChild(new Graphics()
      .rect(px + 28, py + headerH - 1, pw - 56, 1)
      .fill({ color: 0x7ba5bd, alpha: 0.32 }));
    const close = new PText({ text: '×', style: { fontSize: 30, fill: 0x8aa2b5 } satisfies TextStyleOptions });
    close.position.set(px + pw - 52, py + 26);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointerover', () => { close.style = { fontSize: 30, fill: 0xffffff } satisfies TextStyleOptions; });
    close.on('pointerout', () => { close.style = { fontSize: 30, fill: 0x8aa2b5 } satisfies TextStyleOptions; });
    close.on('pointerdown', () => {
      this.hideSettings();
      this.#settingsHandlers?.onClose();
    });
    layer.addChild(close);

    this.#settingsRows.forEach((row, i) => {
      const y = py + headerH + i * rowH;
      layer.addChild(new Graphics()
        .rect(px + 28, y + rowH - 1, pw - 56, 1)
        .fill({ color: 0x54748d, alpha: i === this.#settingsRows.length - 1 ? 0.18 : 0.26 }));
      layer.addChild(new PText({
        text: row.label,
        style: { fontSize: 21, fill: 0xdde9f4 } satisfies TextStyleOptions,
      })).position.set(px + 32, y + 16);
      const controls = new Container();
      controls.position.set(px + pw - 300, y + 9);
      const value = new PText({
        text: row.display,
        style: { fontSize: 19, fill: 0xf1f7ff, fontWeight: 'bold' } satisfies TextStyleOptions,
      });
      value.anchor.set(0.5, 0);
      value.position.set(150, 7);
      const left = new PText({ text: '‹', style: { fontSize: 32, fill: 0x79d5e6 } satisfies TextStyleOptions });
      left.position.set(52, -3);
      const right = new PText({ text: '›', style: { fontSize: 32, fill: 0x79d5e6 } satisfies TextStyleOptions });
      right.position.set(230, -3);
      for (const control of [left, right]) {
        control.eventMode = 'static';
        control.cursor = 'pointer';
        control.on('pointerover', () => { control.style = { fontSize: 32, fill: 0xffffff } satisfies TextStyleOptions; });
        control.on('pointerout', () => { control.style = { fontSize: 32, fill: 0x79d5e6 } satisfies TextStyleOptions; });
      }
      left.on('pointerdown', () => this.#settingsHandlers?.onChange(row.id, -1));
      right.on('pointerdown', () => this.#settingsHandlers?.onChange(row.id, 1));
      controls.addChild(left, value, right);
      layer.addChild(controls);
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
      style: { fontSize: 26, fill: NIGHT_AZURE.plateText, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 36);

    const teams = [...new Set(view.units.map((u) => u.team))];
    teams.forEach((team, ti) => {
      const x = 80 + ti * 620;
      layer.addChild(new PText({
        text: `${team}${team === view.actingTeam ? '（行动中）' : ''}`,
        style: { fontSize: 20, fill: team === view.actingTeam ? NIGHT_AZURE.accent : 0x8a93a8, fontWeight: 'bold' } satisfies TextStyleOptions,
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
            fill: selected ? 0x0a1020 : btn.ready ? NIGHT_AZURE.plateText : 0x5a6478,
          } satisfies TextStyleOptions,
        });
        const pad = new Graphics().roundRect(sx - 10, this.#h - 150, t.width + 20, 34, 8)
          .fill({ color: selected ? NIGHT_AZURE.accent : 0x141c2e, alpha: 0.95 });
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
    const pass = new PText({ text: '▸ 跳过行动', style: { fontSize: 20, fill: NIGHT_AZURE.accent } satisfies TextStyleOptions });
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

  /** 展示标题画面（精致化批次四，商业 gal 标题页口径）：大字距 logo 感标题 + 细强调线 +
   *  弱化菜单（悬停下方细线滑入）+ 轻径向暗角；enabled=false 灰显不可点 */
  showTitle(view: TitleView, onSelect: (id: string) => void): void {
    this.hideEnding();
    this.hideCommandRail();
    this.#titleHandler = onSelect;
    const layer = this.#titleLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const titleTexture = this.#registeredBgs.get(view.backgroundKey ?? 'title_bg');
    if (titleTexture) {
      // 标题底图同正文背景使用 cover，避免生成素材在不同窗口被拉伸；暗幕只负责衬托标题文字。
      const titleBg = new Sprite(titleTexture);
      const scale = Math.max(this.#w / Math.max(1, titleTexture.width), this.#h / Math.max(1, titleTexture.height));
      titleBg.width = titleTexture.width * scale;
      titleBg.height = titleTexture.height * scale;
      titleBg.position.set((this.#w - titleBg.width) / 2, (this.#h - titleBg.height) / 2);
      layer.addChild(titleBg);
      layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x020409, alpha: 0.48 }));
    } else {
      layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x060a14, alpha: 0.97 }));
    }
    // 轻径向暗角：多层同心椭圆叠 alpha 近似（氛围聚焦，不引 canvas 纹理）
    const vg = new Graphics();
    for (let i = 1; i <= 5; i++) {
      vg.ellipse(this.#w / 2, this.#h / 2, this.#w * (0.42 + i * 0.16), this.#h * (0.4 + i * 0.17))
        .stroke({ width: 60, color: 0x020409, alpha: 0.05 * i });
    }
    layer.addChild(vg);
    const title = new PText({
      text: view.title,
      style: { fontSize: 58, fill: NIGHT_AZURE.text, fontWeight: 'normal', letterSpacing: 8, fontFamily: this.#fontFamilies.title } satisfies TextStyleOptions,
    });
    title.anchor.set(0.5);
    title.position.set(this.#w / 2, this.#h * 0.28);
    layer.addChild(title);
    // 标题下细强调线：更长更细更淡（精致化）
    layer.addChild(new Graphics()
      .roundRect(this.#w / 2 - 210, this.#h * 0.28 + 47, 420, 1, 0.5)
      .fill({ color: NIGHT_AZURE.accent, alpha: 0.55 }));
    if (view.subtitle) {
      const sub = new PText({ text: view.subtitle, style: { fontSize: 18, fill: 0x8a9ab5, letterSpacing: 3, fontFamily: this.#fontFamilies.ui } satisfies TextStyleOptions });
      sub.anchor.set(0.5);
      sub.position.set(this.#w / 2, this.#h * 0.28 + 76);
      layer.addChild(sub);
    }
    const startY = this.#h * 0.52;
    view.items.forEach((item, i) => {
      const enabled = item.enabled !== false;
      const baseX = this.#w / 2;
      const baseY = startY + i * 52;
      const t = new PText({
        text: item.label,
        style: { fontSize: 20, fill: enabled ? NIGHT_AZURE.text : 0x4a5566, letterSpacing: 4, fontFamily: this.#fontFamilies.ui } satisfies TextStyleOptions,
      });
      t.anchor.set(0.5);
      t.position.set(baseX, baseY);
      if (enabled) {
        // 悬停：文字下方细线滑入（含蓄，替代旧竖条+右移）
        const line = new Graphics()
          .roundRect(baseX - 70, baseY + 20, 140, 1, 0.5)
          .fill({ color: NIGHT_AZURE.accent, alpha: 0.9 });
        line.visible = false;
        layer.addChild(line);
        t.eventMode = 'static';
        t.cursor = 'pointer';
        t.on('pointerdown', () => this.#titleHandler?.(item.id));
        t.on('pointerover', () => {
          line.visible = true;
          t.style = { fontSize: 20, fill: NIGHT_AZURE.plateText, letterSpacing: 4, fontFamily: this.#fontFamilies.ui } satisfies TextStyleOptions;
        });
        t.on('pointerout', () => {
          line.visible = false;
          t.style = { fontSize: 20, fill: NIGHT_AZURE.text, letterSpacing: 4, fontFamily: this.#fontFamilies.ui } satisfies TextStyleOptions;
        });
      }
      layer.addChild(t);
    });
    this.#uiLayer.setChildIndex(this.#titleLayer, this.#uiLayer.children.length - 1);
    layer.visible = true;
  }

  /** 隐藏标题画面；进入正文时默认恢复操作带，进入标题二级页时可保持操作带隐藏。 */
  hideTitle(restoreCommandRail = true): void {
    this.#titleLayer.visible = false;
    if (restoreCommandRail) {
      this.#commandRailSuppressed = false;
      this.#commandRail.visible = !this.#interfaceHidden && this.#commandRailItems.length > 0;
    } else {
      this.hideCommandRail();
    }
  }

  /** 全黑结局卡。宿主负责在展示后跳转标题，舞台只投影且不接收输入。 */
  showEnding(text = 'THE END'): void {
    this.hideCommandRail();
    this.hideChoices();
    this.hideBacklog();
    this.hideGallery();
    this.hideSettings();
    this.hideSaveLoad();
    this.hideSystemMenu();
    this.hideTitle(false);
    this.#endingLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.#endingLayer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000));
    const label = new PText({
      text,
      style: {
        fontSize: 30,
        fill: NIGHT_AZURE.text,
        fontWeight: 'normal',
        letterSpacing: 9,
        fontFamily: this.#fontFamilies.title,
      } satisfies TextStyleOptions,
    });
    label.anchor.set(0.5);
    label.position.set(this.#w / 2, this.#h / 2);
    this.#endingLayer.addChild(label);
    this.#fadeOverlay.alpha = 0;
    this.#uiLayer.setChildIndex(this.#endingLayer, this.#uiLayer.children.length - 1);
    this.#endingLayer.visible = true;
  }

  /** 隐藏结局卡；多次调用保持幂等。 */
  hideEnding(): void {
    this.#endingLayer.visible = false;
  }

  /** 展示现代 ADV 系统菜单：右侧抽屉、细线层级、悬停强调；点击遮罩关闭。 */
  showSystemMenu(items: SystemMenuItemView[], onSelect: (id: string) => void, onClose: () => void): void {
    this.#menuHandlers = { onSelect, onClose };
    const layer = this.#menuLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    layer.alpha = 0;
    const bg = new Graphics()
      .rect(0, 0, this.#w, this.#h)
      .fill({ color: 0x02060d, alpha: 0.62 });
    bg.eventMode = 'static';
    bg.on('pointerdown', () => {
      layer.visible = false;
      layer.alpha = 1;
      this.#menuPanel = null;
      this.#menuHandlers?.onClose();
    });
    layer.addChild(bg);

    const panel = new Container();
    const px = this.#w - 398;
    const py = 34;
    const pw = 348;
    const headerH = 94;
    const rowH = 54;
    const panelH = headerH + items.length * rowH + 28;
    panel.position.set(this.#menuMotionOffset, 0);
    this.#menuPanel = panel;

    // 只有一层轻微投影和一条冷光边缘，避免“卡片堆叠”的塑料感。
    panel.addChild(new Graphics()
      .roundRect(px + 10, py + 12, pw, panelH, 6)
      .fill({ color: 0x000000, alpha: 0.28 }));
    panel.addChild(new Graphics()
      .roundRect(px, py, pw, panelH, 6)
      .fill({ color: 0x081321, alpha: 0.97 })
      .stroke({ width: 1, color: 0x5d86a6, alpha: 0.52 }));
    panel.addChild(new Graphics()
      .rect(px, py, 3, panelH)
      .fill({ color: 0x79d5e6, alpha: 0.94 }));
    panel.addChild(new Graphics()
      .rect(px + 28, py + headerH - 1, pw - 54, 1)
      .fill({ color: 0x7ba5bd, alpha: 0.32 }));
    panel.addChild(new PText({
      text: 'SYSTEM',
      style: { fontSize: 13, fill: 0x83b4c5, letterSpacing: 4, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(px + 28, py + 19);
    panel.addChild(new PText({
      text: '系统菜单',
      style: { fontSize: 27, fill: 0xf1f7ff, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(px + 27, py + 42);

    items.forEach((item, i) => {
      const row = new Container();
      const rowY = py + headerH + i * rowH;
      row.position.set(px + 16, rowY);
      const hover = new Graphics()
        .roundRect(0, 4, pw - 32, rowH - 8, 3)
        .fill({ color: 0x173149, alpha: 0 });
      const marker = new Graphics()
        .rect(0, 13, 3, rowH - 26)
        .fill({ color: 0x79d5e6, alpha: 0 });
      const index = new PText({
        text: String(i + 1).padStart(2, '0'),
        style: { fontSize: 13, fill: 0x7692a8, letterSpacing: 1 } satisfies TextStyleOptions,
      });
      index.position.set(22, 19);
      const label = new PText({
        text: item.label,
        style: { fontSize: 21, fill: 0xeaf2fb, fontWeight: 'normal' } satisfies TextStyleOptions,
      });
      label.position.set(62, 14);
      row.addChild(hover, marker, index, label);
      row.eventMode = 'static';
      row.cursor = 'pointer';
      row.on('pointerover', () => {
        hover.alpha = 1;
        marker.alpha = 1;
        label.style = { fontSize: 21, fill: 0xffffff, fontWeight: 'bold' } satisfies TextStyleOptions;
      });
      row.on('pointerout', () => {
        hover.alpha = 0;
        marker.alpha = 0;
        label.style = { fontSize: 21, fill: 0xeaf2fb, fontWeight: 'normal' } satisfies TextStyleOptions;
      });
      row.on('pointerdown', () => {
        layer.visible = false;
        layer.alpha = 1;
        this.#menuPanel = null;
        this.#menuHandlers?.onSelect(item.id);
      });
      panel.addChild(row);
    });
    layer.addChild(panel);
    layer.visible = true;
    this.#menuMotionRemain = this.#menuMotionDur;
  }

  /** 隐藏系统菜单 */
  hideSystemMenu(): void {
    this.#menuLayer.visible = false;
    this.#menuLayer.alpha = 1;
    this.#menuPanel = null;
    this.#menuMotionRemain = 0;
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

  /** 展示存档/读档界面：平面档案列表；load 模式空槽灰显不可选。 */
  showSaveLoad(view: SaveLoadView, onSelect: (slotId: string) => void, onClose: () => void): void {
    this.hideSettings();
    this.hideGallery();
    this.hideCommandRail();
    this.#saveLoadHandlers = { onSelect, onClose };
    const layer = this.#saveLoadLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const bg = new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x02060d, alpha: 0.84 });
    bg.eventMode = 'static';
    bg.on('pointerdown', () => {
      this.hideSaveLoad();
      this.#saveLoadHandlers?.onClose();
    });
    layer.addChild(bg);
    layer.addChild(new Graphics()
      .rect(86, 68, 3, 78)
      .fill({ color: 0x79d5e6, alpha: 0.94 }));
    layer.addChild(new PText({
      text: view.mode === 'save' ? 'SAVE DATA' : 'LOAD DATA',
      style: { fontSize: 13, fill: 0x83b4c5, letterSpacing: 4, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(108, 70);
    layer.addChild(new PText({
      text: view.mode === 'save' ? '存档' : '读档',
      style: { fontSize: 34, fill: 0xf1f7ff, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(106, 91);
    layer.addChild(new PText({
      text: '记录当前剧情进度',
      style: { fontSize: 16, fill: 0x8ba4b9 } satisfies TextStyleOptions,
    })).position.set(255, 110);
    const close = new PText({ text: '×', style: { fontSize: 30, fill: 0x8aa2b5 } satisfies TextStyleOptions });
    close.position.set(this.#w - 106, 76);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.on('pointerover', () => { close.style = { fontSize: 30, fill: 0xffffff } satisfies TextStyleOptions; });
    close.on('pointerout', () => { close.style = { fontSize: 30, fill: 0x8aa2b5 } satisfies TextStyleOptions; });
    close.on('pointerdown', () => {
      this.hideSaveLoad();
      this.#saveLoadHandlers?.onClose();
    });
    layer.addChild(close);

    const cols = 2;
    const cardW = 480;
    const cardH = 104;
    const gapX = 22;
    const gapY = 16;
    const startX = 150;
    const startY = 180;
    view.slots.forEach((slot, i) => {
      const x = startX + (i % cols) * (cardW + gapX);
      const y = startY + Math.floor(i / cols) * (cardH + gapY);
      const selectable = view.mode === 'save' || !slot.empty;
      const card = new Container();
      card.position.set(x, y);
      const surface = new Graphics()
        .roundRect(0, 0, cardW, cardH, 4)
        .fill({ color: selectable ? 0x0b1928 : 0x09121d, alpha: 0.92 })
        .stroke({ width: 1, color: selectable ? 0x4c6b84 : 0x263b4d, alpha: selectable ? 0.68 : 0.38 });
      const hover = new Graphics()
        .roundRect(0, 0, cardW, cardH, 4)
        .fill({ color: 0x173149, alpha: 0 });
      const marker = new Graphics()
        .rect(0, 13, 3, cardH - 26)
        .fill({ color: 0x79d5e6, alpha: 0 });
      card.addChild(surface, hover, marker);
      // 缩略图（舞台截图 dataURL；纹理异步加载完成后自动显示）
      let textX = 28;
      if (slot.thumbnail) {
        const thumb = new Sprite(this.#thumbTexture(slot.thumbnail));
        thumb.width = 128;
        thumb.height = 72;
        thumb.position.set(18, 16);
        card.addChild(thumb);
        textX = 166;
      }
      card.addChild(new PText({
        text: String(i + 1).padStart(2, '0'),
        style: { fontSize: 13, fill: selectable ? 0x79d5e6 : 0x526b7c, letterSpacing: 1 } satisfies TextStyleOptions,
      })).position.set(textX, 14);
      const kindLabel = slot.kind === 'auto' ? '自动' : slot.kind === 'quick' ? '快速' : '手动';
      card.addChild(new PText({
        text: slot.empty ? '空槽位' : (slot.label ?? '未命名场景'),
        style: { fontSize: 21, fill: selectable ? 0xf1f7ff : 0x5b7182, fontWeight: 'bold' } satisfies TextStyleOptions,
      })).position.set(textX, 34);
      if (!slot.empty) {
        const playtime = slot.playTimeSec !== undefined && slot.playTimeSec > 0
          ? ` · ${Math.floor(slot.playTimeSec / 60)}分钟`
          : '';
        card.addChild(new PText({
          text: `${kindLabel}　${formatSlotTime(slot.updatedAt)}${playtime}`,
          style: { fontSize: 15, fill: 0x8ba4b9 } satisfies TextStyleOptions,
        })).position.set(textX, 70);
      } else {
        card.addChild(new PText({
          text: `${kindLabel}　等待记录`,
          style: { fontSize: 15, fill: 0x5b7182 } satisfies TextStyleOptions,
        })).position.set(textX, 70);
      }
      if (selectable) {
        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.on('pointerover', () => {
          hover.alpha = 1;
          marker.alpha = 1;
        });
        card.on('pointerout', () => {
          hover.alpha = 0;
          marker.alpha = 0;
        });
        card.on('pointerdown', () => {
          this.hideSaveLoad();
          this.#saveLoadHandlers?.onSelect(slot.id);
        });
      }
      layer.addChild(card);
    });
    this.#uiLayer.setChildIndex(this.#saveLoadLayer, this.#uiLayer.children.length - 1);
    layer.visible = true;
  }

  /** 隐藏存档/读档界面 */
  hideSaveLoad(): void {
    this.#saveLoadLayer.visible = false;
    this.#commandRailSuppressed = false;
  }

  /** 展示大地图：节点（可进入者高亮可点）+ 日期/回合/行动力 + 结束回合 */
  showMap(view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void): void {
    this.#mapHandlers = { onEnter, onEndTurn };
    const layer = this.#mapLayer;
    layer.removeChildren().forEach((c) => c.destroy({ children: true }));
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: 0x0a0f14, alpha: 0.95 }));
    layer.addChild(new PText({
      text: `${view.date} —— 回合 ${view.turn}`,
      style: { fontSize: 24, fill: NIGHT_AZURE.plateText, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 36);
    layer.addChild(new PText({ text: '行动力', style: { fontSize: 16, fill: 0x9a9aa5 } satisfies TextStyleOptions })).position.set(this.#w - 60 - view.maxAp * 30 - 60, 40);
    for (let i = 0; i < view.maxAp; i++) {
      layer.addChild(new Graphics().circle(this.#w - 60 - (view.maxAp - i) * 30 + 10, 50, 10).fill(i < view.ap ? 0x57c26a : 0x333340));
    }
    for (const node of view.nodes) {
      const dot = new Container();
      dot.position.set(node.x, node.y);
      const color = node.enterable ? NIGHT_AZURE.accent : node.visited ? 0x5a7a8a : 0x333340;
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
    const end = new PText({ text: '▸ 结束回合', style: { fontSize: 22, fill: NIGHT_AZURE.accent } satisfies TextStyleOptions });
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
      style: { fontSize: 32, fill: NIGHT_AZURE.plateText, fontWeight: 'bold' } satisfies TextStyleOptions,
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
        style: { fontSize: 20, fill: affordable ? NIGHT_AZURE.accent : 0x5a6478 } satisfies TextStyleOptions,
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
      style: { fontSize: 32, fill: NIGHT_AZURE.plateText, fontWeight: 'bold' } satisfies TextStyleOptions,
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
        style: { fontSize: 20, fill: cmd.enabled ? NIGHT_AZURE.accent : 0x5a6478 } satisfies TextStyleOptions,
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
    this.#commandRail.visible = false;
    this.#clearChoices();
    options.forEach((opt, i) => {
      // Container 包裹（命中区 + 细线 + 文本）：Pixi v8 起 Text 不再允许挂子节点。
      const holder = new Container();
      const label = new PText({
        text: opt.label,
        style: { fontSize: 24, fill: MODERN_ADV.text, letterSpacing: 1 } satisfies TextStyleOptions,
      });
      label.position.set(26, 6);
      const bg = new Graphics();
      const bar = new Graphics();
      holder.addChild(bg, bar, label);
      const view = { holder, bg, bar, label };
      this.#choiceViews.push(view);
      this.#drawChoiceCard(view, false);
      holder.eventMode = 'static';
      holder.cursor = 'pointer';
      holder.on('pointerdown', () => this.onSelect?.(opt.index));
      // hover 高亮：只提亮文字与底部细线，不制造按钮卡片。
      holder.on('pointerover', () => this.#drawChoiceCard(view, true));
      holder.on('pointerout', () => {
        this.#drawChoiceCard(view, this.#choiceHighlight === this.#choiceViews.indexOf(view));
      });
      this.#choiceLayer.addChild(holder);
    });
    this.#choiceHighlight = -1;
    this.#layout();
    // 入场淡入：整体渐显 + 逐卡错峰（updateEffects 驱动；无卡片时不启动）
    if (this.#choiceViews.length > 0) {
      this.#choiceFadeRemain = this.#choiceFadeDur + (this.#choiceViews.length - 1) * 80;
      for (const v of this.#choiceViews) v.holder.alpha = 0;
    }
  }

  /** 选择肢绘制：透明命中区 + 低透明底色 + 单条强调线。 */
  #drawChoiceCard(view: { holder: Container; bg: Graphics; bar: Graphics; label: PText }, selected: boolean): void {
    view.label.style = selected
      ? { fontSize: 24, fill: MODERN_ADV.text, fontWeight: 'bold', letterSpacing: 1 } satisfies TextStyleOptions
      : { fontSize: 24, fill: MODERN_ADV.muted, letterSpacing: 1 } satisfies TextStyleOptions;
    const w = view.label.width + 60;
    const h = view.label.height + 16;
    view.bg.clear();
    view.bg.rect(0, 0, w, h).fill({ color: MODERN_ADV.ink, alpha: selected ? 0.12 : 0.015 });
    view.bg.rect(0, h - 1, w, 1).fill({ color: MODERN_ADV.line, alpha: selected ? 0.9 : 0.22 });
    view.bar.clear();
    if (selected) view.bar.rect(0, h - 3, w, 2).fill({ color: MODERN_ADV.accent, alpha: 0.95 });
  }

  /** 选择肢键盘导航高亮：提亮第 pos 项（其余恢复默认样式；卡片与文本同步重绘） */
  setChoiceHighlight(pos: number): void {
    this.#choiceHighlight = pos;
    this.#choiceViews.forEach((view, i) => this.#drawChoiceCard(view, i === pos));
  }

  hideChoices(): void {
    this.#clearChoices();
    this.#commandRail.visible = !this.#interfaceHidden && !this.#commandRailSuppressed && this.#commandRailItems.length > 0;
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
   * 清理一轮剧情会话的投影状态。资源注册表也会清空，避免编辑器预览重载后
   * 沿用上一个项目的背景/立绘；宿主注入纹理不主动 destroy，生命周期仍由宿主管理。
   */
  resetSession(options: { preserveWorld?: boolean; clearAssets?: boolean } = {}): void {
    this.#lastShownSpeaker = undefined;
    this.#lastShownDialog = '';
    const preserveWorld = options.preserveWorld === true;
    const clearAssets = options.clearAssets === true;
    this.hideVideo();
    this.hideEnding();
    this.#clearChoices();

    if (!preserveWorld) {
      const sprites = new Set<Sprite>([
        ...this.#portraitSprites.values(),
        ...this.#portraitTweens.flatMap((t) => [t.old, t.neu]),
      ]);
      for (const sprite of sprites) {
        if (sprite.parent) sprite.parent.removeChild(sprite);
        sprite.destroy();
      }
      this.#portraitSprites.clear();
      this.#portraitViews.clear();
      this.#portraitTweens = [];
      this.#movTweens = [];
      if (this.#bgSprite) {
        this.#bgLayer.removeChild(this.#bgSprite);
        this.#bgSprite.destroy();
        this.#bgSprite = null;
      }
      this.#backgroundKey = null;

      const registered = new Set<Texture>([
        ...this.#registeredBgs.values(),
        ...this.#registeredPortraits.values(),
      ]);
      for (const tex of this.#bgTextureCache.values()) {
        if (!registered.has(tex)) tex.destroy();
      }
      for (const tex of this.#portraitTextureCache.values()) {
        if (!registered.has(tex)) tex.destroy();
      }
      if (clearAssets) {
        this.#bgTextureCache.clear();
        this.#portraitTextureCache.clear();
        this.#registeredBgs.clear();
        this.#registeredPortraits.clear();
        this.#registeredAvatars.clear();
      } else {
        for (const [key, tex] of this.#bgTextureCache) {
          if (!registered.has(tex)) this.#bgTextureCache.delete(key);
        }
        for (const [key, tex] of this.#portraitTextureCache) {
          if (!registered.has(tex)) this.#portraitTextureCache.delete(key);
        }
      }
    }

    const clearLayer = (layer: Container): void => {
      layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    };
    clearLayer(this.#backlogLayer);
    clearLayer(this.#galleryLayer);
    clearLayer(this.#settingsLayer);
    clearLayer(this.#battleLayer);
    clearLayer(this.#titleLayer);
    clearLayer(this.#menuLayer);
    clearLayer(this.#saveLoadLayer);
    clearLayer(this.#mapLayer);
    clearLayer(this.#shopLayer);
    clearLayer(this.#baseLayer);
    this.#backlogEntriesLayer = null;
    this.#backlogScroll = 0;
    this.#backlogContentH = 0;
    this.#backlogLayer.visible = false;
    this.#galleryLayer.visible = false;
    this.#settingsLayer.visible = false;
    this.#battleLayer.visible = false;
    this.#titleLayer.visible = false;
    this.#menuLayer.visible = false;
    this.#saveLoadLayer.visible = false;
    this.#mapLayer.visible = false;
    this.#shopLayer.visible = false;
    this.#baseLayer.visible = false;
    this.#menuLayer.alpha = 1;
    this.#menuPanel = null;
    this.#menuMotionRemain = 0;
    this.#titleHandler = null;
    this.#menuHandlers = null;
    this.#saveLoadHandlers = null;
    this.#mapHandlers = null;
    this.#shopHandlers = null;
    this.#baseHandlers = null;
    this.#galleryViews = null;
    this.#galleryOnPlayMusic = null;
    this.#galleryOnReplayText = null;
    this.#galleryOnClose = null;
    this.#settingsHandlers = null;
    this.#battleHandlers = null;

    this.#worldLayer.position.set(0, 0);
    this.#worldLayer.scale.set(1);
    this.#shakeRemain = 0;
    this.#flashRemain = 0;
    this.#flashOverlay.alpha = 0;
    this.#zoomFrom = 1;
    this.#zoomTo = 1;
    this.#zoomRemain = 0;
    this.#stopBackgroundTransition();
    this.#timelineMoveStarts.clear();
    this.#timelineValueStarts.clear();
    this.stopParticles();
    this.#bannerRemain = 0;
    this.#bannerLayer.visible = false;
    this.#bannerLayer.alpha = 1;
    this.#bannerText.text = '';
    this.#bannerBars.visible = false;
    this.#bannerTipBg.clear();
    this.#wipeRemain = 0;
    this.#wipeBar.visible = false;
    this.#tintRemain = 0;
    this.#tintOverlay.alpha = 0;
    this.#tintOverlay.visible = false;
    this.#tintFrom = { color: 0x000000, alpha: 0 };
    this.#tintTo = { color: 0x000000, alpha: 0 };

    this.clearNvlText();
    this.#nvlActive = false;
    this.#nvlLayer.visible = false;
    this.#dialogRubyLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.#speakerText.text = '';
    this.#dialogText.text = '';
    this.#speakerText.visible = true;
    this.#dialogText.visible = true;
    this.#dialogRubyLayer.visible = true;
    this.#speakerPlate.clear();
    this.#speakerPlate.visible = false;
    if (this.#speakerAvatar) this.#speakerAvatar.visible = false;
    this.#activeSpeakerId = null;
    this.#dialogPanel.visible = false;
    this.#continueIndicator.visible = false;
    this.#continuePhase = 0;
    this.#interfaceHidden = false;
    this.#commandRailSuppressed = false;
    this.#commandRail.visible = this.#commandRailItems.length > 0;
    this.#commandRail.alpha = this.#commandRailIdleAlpha;
    this.#commandRailWakeRemain = 0;
    this.#choiceHighlight = -1;
    this.setFade(0);
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
    this.#portraitViews.clear();
    this.#bgSprite?.destroy();
    this.#bgSprite = null;
    this.#backgroundKey = null;
    this.#registeredBgs.clear();
    this.#registeredPortraits.clear();
    this.#registeredAvatars.clear();
    if (this.app?.canvas && this.#commandRailPointerWake) {
      this.app.canvas.removeEventListener('pointermove', this.#commandRailPointerWake);
      this.app.canvas.removeEventListener('pointerdown', this.#commandRailPointerWake);
    }
    this.#commandRailPointerWake = null;
    this.app?.destroy(true, { children: true });
    this.app = null;
  }
}
