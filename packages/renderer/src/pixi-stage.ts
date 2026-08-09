import {
  Application,
  ColorMatrixFilter,
  Container,
  Graphics,
  Sprite,
  Text as PText,
  TextStyle,
  Texture,
  type TextStyleOptions,
} from 'pixi.js';
import type { BattleView } from './battle-view.js';
import type { BacklogEntry } from './backlog.js';
import type { BasePanelView, MapView, SaveLoadView, SystemMenuItemView, TitleView } from './ui-views.js';
import type { GalleryItemView } from './gallery.js';
import type { SettingsRowView } from './settings-store.js';
import type { TimelineFrameEvent } from './timeline-player.js';
import type {
  AdvStage,
  ChoiceOptionView,
  CommandRailItem,
  FrameRequestHandler,
  PortraitView,
  SpeakerProfile,
} from './types.js';
import { RenderQualityController, type RenderQuality } from './quality.js';
import { DEFAULT_PRESENTATION_PREFERENCES, normalizePresentationPreferences, presentationDuration, type PresentationPreferences } from './presentation.js';
import { DEFAULT_POST_PROCESS, normalizePostProcess, type PostProcessSettings } from './post-process.js';
import { LoadingLayer } from './loading-layer.js';
import type { LoadingProgress } from './loading-progress.js';
import { WorldEffectsController, type ShakeDirection, type TransitionName } from './world-effects-controller.js';
import type { DialogueProjectionPort, MenuProjectionPort } from './api/renderer-commands.js';
import {
  DEFAULT_RENDERER_FONT_FAMILIES,
  RenderAssetRegistry,
  type RenderAssetSource,
} from './services/render-asset-registry.js';
import { RenderLifecycle } from './lifecycle/render-lifecycle.js';
import { DialogueLayer } from './layers/dialogue/dialogue-layer.js';
import { MenuLayer } from './layers/menu/menu-layer.js';

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
export class PixiStage implements AdvStage {
  app: Application | null = null;

  get onSelect(): ((index: number) => void) | null {
    return this.#dialogue.onSelect;
  }

  set onSelect(handler: ((index: number) => void) | null) {
    this.#dialogue.onSelect = handler;
  }

  get onBacklogClose(): (() => void) | null {
    return this.#dialogue.onBacklogClose;
  }

  set onBacklogClose(handler: (() => void) | null) {
    this.#dialogue.onBacklogClose = handler;
  }

  /** @internal Renderer runtime wiring for the extracted dialogue layer. */
  get dialogueLayer(): DialogueProjectionPort {
    return this.#dialogue;
  }

  /** @internal Renderer runtime wiring for the extracted menu layer. */
  get menuLayer(): MenuProjectionPort {
    return this.#menu;
  }

  #bgLayer: Container;
  #portraitLayer: Container;
  #uiLayer: Container;
  #fadeOverlay: Graphics;
  #bgSprite: Sprite | null = null;
  #backgroundKey: string | null = null;
  #bgTransition: { old: Sprite | null; neu: Sprite; remain: number; dur: number } | null = null;
  #portraitSprites = new Map<string, Sprite>();
  #portraitViews = new Map<string, PortraitView>();
  readonly #assetRegistry: RenderAssetRegistry;
  readonly #dialogue: DialogueLayer;
  /** 立绘交叉淡化补间（旧 sprite 淡出 + 新 sprite 淡入） */
  #portraitTweens: { old: Sprite; neu: Sprite; remain: number; dur: number }[] = [];
  /** 世界层：包裹背景 + 立绘，@shake/@zoom 的变换载体（UI 层不受影响） */
  #worldLayer: Container;
  /** 屏幕调色层：位于世界与 HUD 之间，tint 不应遮住对白和操作带。 */
  #screenLayer: Container;
  /** @flash 白色闪光叠加（线性衰减） */
  #flashOverlay: Graphics;
  /** 演出效果控制器（转场/震动由 updateEffects 统一推进） */
  #worldEffects: WorldEffectsController;
  #flashRemain = 0;
  #flashDur = 1;
  #zoomFrom = 1;
  #zoomTo = 1;
  #zoomRemain = 0;
  #zoomDur = 1;
  /** 时间轴镜头平移，单位为舞台像素；与缩放中心偏移叠加。 */
  #cameraPanX = 0;
  #cameraPanY = 0;
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
  /** 战斗覆盖层（阵营分列 + 血条 + 点击攻击/跳过） */
  #battleLayer: Container;
  #battleHandlers: BattleHandlers | null = null;
  /** 战斗中已选技能（null = 普攻） */
  #battleSelectedSkill: string | null = null;
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
  #timelineMoveStarts = new Map<object, Map<string, number>>();
  #timelineValueStarts = new Map<object, number>();
  #timelinePanStarts = new Map<object, { x: number; y: number }>();
  #timelineTintStarts = new Map<object, { color: number; alpha: number }>();
  /** M4 extracted menu projection; all title/ending/system/settings/save-load state lives here. */
  readonly #menu: MenuLayer;
  /** 正在播放的 @video 元素（hideVideo 强制停止用；审计复核） */
  #activeVideo: HTMLVideoElement | null = null;
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
  #fontFamilies: Record<FontRole, string> = { ...DEFAULT_RENDERER_FONT_FAMILIES };
  /** 舞台直接交互/异步资源更新时唤醒外部帧调度器。 */
  #frameRequest: FrameRequestHandler | null = null;
  /** 画质策略由舞台统一应用，默认 balanced 兼顾正式游戏和编辑器预览。 */
  #quality = new RenderQualityController('balanced');
  #presentation: PresentationPreferences = { ...DEFAULT_PRESENTATION_PREFERENCES };
  #postProcess: PostProcessSettings = { ...DEFAULT_POST_PROCESS };
  #colorMatrix: ColorMatrixFilter | null = null;
  #loadingLayer: LoadingLayer;

  constructor(assetRegistry?: RenderAssetRegistry, lifecycle?: RenderLifecycle) {
    this.#assetRegistry = assetRegistry ?? new RenderAssetRegistry();
    // 动态文本默认继承正文角色；标题与菜单在各自的构建点显式使用 title/ui 角色。
    TextStyle.defaultTextStyle.fontFamily = this.#fontFamilies.body;
    this.#bgLayer = new Container();
    this.#portraitLayer = new Container();
    this.#worldLayer = new Container();
    this.#worldLayer.addChild(this.#bgLayer, this.#portraitLayer);
    this.#screenLayer = new Container();
    this.#worldEffects = new WorldEffectsController({
      world: this.#worldLayer,
      screen: this.#screenLayer,
      width: this.#w,
      height: this.#h,
      getBasePosition: () => this.#zoomBaseOffset(),
      setWorldPosition: (x, y) => this.#worldLayer.position.set(x, y),
      duration: (durationMs) => presentationDuration(durationMs, this.#presentation),
      requestFrame: () => this.#requestFrame(),
    });
    this.#uiLayer = new Container();
    this.#dialogue = new DialogueLayer({
      uiLayer: this.#uiLayer,
      width: this.#w,
      height: this.#h,
      assets: this.#assetRegistry,
      ...(lifecycle ? { lifecycle } : {}),
      preferences: this.#presentation,
      requestFrame: () => this.#requestFrame(),
    });
    this.#fadeOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000);
    this.#fadeOverlay.alpha = 0;
    this.#flashOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0xffffff);
    this.#flashOverlay.alpha = 0;
    this.#wipeBar = new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000);
    this.#wipeBar.visible = false;
    // 叠加层必须以白色为底，Graphics.tint 才能投影 cue 指定的调色值。
    this.#tintOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0xffffff);
    this.#tintOverlay.alpha = 0;
    this.#tintOverlay.visible = false;
    this.#screenLayer.addChild(this.#tintOverlay);
    this.#particleLayer = new Container();
    this.#menu = new MenuLayer({
      uiLayer: this.#uiLayer,
      width: this.#w,
      height: this.#h,
      assets: this.#assetRegistry,
      ...(lifecycle ? { lifecycle } : {}),
      presentation: () => this.#presentation,
      fontFamily: (role) => this.#fontFamilies[role],
      requestFrame: () => this.#requestFrame(),
    });
    this.#mapLayer = new Container();
    this.#mapLayer.visible = false;
    this.#shopLayer = new Container();
    this.#shopLayer.visible = false;
    this.#baseLayer = new Container();
    this.#baseLayer.visible = false;
    this.#loadingLayer = new LoadingLayer(this.#w, this.#h);
    this.#galleryLayer = new Container();
    this.#galleryLayer.visible = false;
    this.#battleLayer = new Container();
    this.#battleLayer.visible = false;
    this.#uiLayer.addChild(
      this.#galleryLayer, this.#battleLayer,
      this.#wipeBar,
      this.#mapLayer, this.#shopLayer, this.#baseLayer,
      this.#loadingLayer.container,
    );
    this.#dialogue.mountTextDisplays();
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

    // 鼠标移动/点击唤出操作带；监听器由 DialogueLayer 以 owner=dialogue 注册。
    this.#dialogue.attachPointerTarget(app.canvas);

    app.stage.addChild(this.#worldLayer, this.#particleLayer, this.#screenLayer, this.#uiLayer);
    this.#dialogue.bringTextDisplaysToFront();
    // flash 置最末：闪光覆盖全部 UI；黑场 fade 也保留在 HUD 之上用于整屏转场。
    // tint 位于 screenLayer，在世界与 HUD 之间，不应吞掉对白、选择肢或操作带。
    this.#uiLayer.addChild(this.#fadeOverlay, this.#flashOverlay);
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
    this.#requestFrame();
  }

  setQuality(quality: RenderQuality): void {
    if (quality === this.#quality.quality) return;
    const activeParticles = this.#particleKind;
    this.#quality.setQuality(quality);
    // 画质变化即时作用于已有粒子，剧情状态不受影响。
    if (activeParticles) {
      this.stopParticles();
      this.startParticles(activeParticles);
    }
    this.#applyPostProcess();
    this.#requestFrame();
  }

  getQuality(): RenderQuality {
    return this.#quality.quality;
  }

  setPresentationPreferences(preferences: Partial<PresentationPreferences>): void {
    this.#presentation = normalizePresentationPreferences({ ...this.#presentation, ...preferences });
    this.#dialogue.setPresentationPreferences(this.#presentation);
    if (!this.#presentation.particleEnabled) this.stopParticles();
    this.#requestFrame();
  }

  getPresentationPreferences(): PresentationPreferences {
    return { ...this.#presentation };
  }

  setPostProcess(settings: Partial<PostProcessSettings>): void {
    this.#postProcess = normalizePostProcess({ ...this.#postProcess, ...settings });
    this.#applyPostProcess();
    this.#requestFrame();
  }

  getPostProcess(): PostProcessSettings {
    return { ...this.#postProcess };
  }

  #applyPostProcess(): void {
    const enabled = this.#postProcess.enabled && this.#quality.settings.postProcess;
    if (!enabled) {
      this.#worldLayer.filters = null;
      return;
    }
    this.#colorMatrix ??= new ColorMatrixFilter();
    this.#colorMatrix.reset();
    this.#colorMatrix.saturate(this.#postProcess.saturation - 1, false);
    this.#colorMatrix.brightness(this.#postProcess.brightness, false);
    this.#colorMatrix.contrast(this.#postProcess.contrast, false);
    this.#worldLayer.filters = [this.#colorMatrix];
  }

  /** 绑定/解绑通用帧调度器。 */
  setFrameRequest(handler: FrameRequestHandler | null): void {
    this.#frameRequest = handler;
    if (handler && this.needsUpdate()) handler();
  }

  #layout(): void {
    this.#dialogue.layout();
  }

  /**
   * 注册真实背景素材（URL 或已加载的 Texture）。之后 @bg key 使用真实素材而非程序化占位。
   * URL 通过 Pixi Assets 异步加载；清除同名占位缓存使下一次 setBackground 生效。
   */
  async registerBackground(key: string, src: RenderAssetSource, format?: string): Promise<void> {
    await this.#assetRegistry.registerBackground(key, src, format);
    // 资源可能在 @bg 已经投影后才完成加载；替换当前画面，避免首帧占位永久驻留。
    if (this.#backgroundKey === key) this.setBackground(key);
    this.#requestFrame();
  }

  /** 当前某个字体角色实际使用的字体族，供宿主诊断与测试使用。 */
  getFontFamily(role: FontRole): string {
    return this.#fontFamilies[role];
  }

  #applyTypography(): void {
    TextStyle.defaultTextStyle.fontFamily = this.#fontFamilies.body;
    this.#dialogue.applyTypography();
  }

  /**
   * 按角色加载项目内嵌字体。失败仅保留该角色的回退栈，其他角色继续工作。
   * 变量字体以常规字重注册；舞台不通过浏览器伪粗体制造标题重量。
   */
  async registerFontRole(role: FontRole, url: string, family = `SurdetGame${role[0]!.toUpperCase()}${role.slice(1)}Font`, timeoutMs = 3000): Promise<boolean> {
    const ok = await this.#assetRegistry.registerFontRole(role, url, family, timeoutMs);
    if (!ok) return false;
    this.#fontFamilies[role] = this.#assetRegistry.fontFamily(role);
    this.#applyTypography();
    this.#requestFrame();
    return true;
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
    this.#assetRegistry.resetFonts();
    this.#fontFamilies = { ...DEFAULT_RENDERER_FONT_FAMILIES };
    this.#applyTypography();
    this.#requestFrame();
  }

  /** 旧版重置接口保留，行为等同于 resetFonts。 */
  resetFont(): void {
    this.resetFonts();
  }

  /**
   * 注册真实立绘素材（按 角色:服装:表情 精确匹配）。之后 @show charId:costume 对应表情
   * 使用真实素材而非程序化占位。URL 通过 Pixi Assets 异步加载。
   */
  async registerPortrait(charId: string, costume: string, expression: string, src: RenderAssetSource, format?: string): Promise<void> {
    await this.#assetRegistry.registerPortrait(charId, costume, expression, src, format);
    const cacheKey = `${charId}:${costume}:${expression}`;
    // 同样处理运行中替换立绘的情况：注册完成后立即为已显示的角色启动交叉淡化。
    for (const [spriteKey, view] of this.#portraitViews) {
      if (`${view.charId}:${view.costume}:${view.expression}` === cacheKey) this.setPortrait(spriteKey, view);
    }
    this.#requestFrame();
  }

  /** 注册对白区小头像；缺失时不显示头像，不猜测主立绘。 */
  async registerAvatar(key: string, src: RenderAssetSource, format?: string): Promise<void> {
    await this.#assetRegistry.registerAvatar(key, src, format);
    this.#dialogue.refreshSpeakerAvatar();
    this.#requestFrame();
  }

  /** 配置显示名到角色 ID 的显式映射，供说话人聚焦与头像投影使用。 */
  setSpeakerProfiles(profiles: SpeakerProfile[]): void {
    this.#dialogue.setSpeakerProfiles(profiles);
  }

  /** 当前说话角色聚焦；未配置角色资料时传 null，所有立绘保持原始存在感。 */
  setActiveSpeaker(characterId: string | null): void {
    this.#dialogue.setActiveSpeaker(characterId);
    this.setPortraitFocus(this.#dialogue.activeSpeakerId);
  }

  /** World port used by RendererFacade to keep portrait focus separate from dialogue state. */
  setPortraitFocus(characterId: string | null): void {
    for (const [key, sprite] of this.#portraitSprites) {
      const view = this.#portraitViews.get(key);
      sprite.alpha = !characterId || view?.charId === characterId ? 1 : 0.46;
    }
    this.#requestFrame();
  }

  setBackground(key: string | null): void {
    this.#requestFrame();
    this.#stopBackgroundTransition();
    this.#backgroundKey = key;
    if (this.#bgSprite) {
      this.#bgLayer.removeChild(this.#bgSprite);
      this.#bgSprite.destroy(); // 纹理由缓存共享，不随 sprite 释放
      this.#bgSprite = null;
    }
    if (key === null || key.length === 0) return;
    const texture = this.#assetRegistry.resolveBackground(key)
      ?? this.#assetRegistry.getOrCreateBackground(key, () => makeBackgroundTexture(key, this.#w, this.#h));
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
    const texture = this.#assetRegistry.resolveBackground(key)
      ?? this.#assetRegistry.getOrCreateBackground(key, () => makeBackgroundTexture(key, this.#w, this.#h));
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
    this.#requestFrame();
    this.#portraitViews.set(key, opts);
    const cacheKey = `${opts.charId}:${opts.costume}:${opts.expression}`;
    const texture = this.#assetRegistry.resolvePortrait(opts.charId, opts.costume, opts.expression)
      ?? this.#assetRegistry.getOrCreatePortrait(cacheKey, () => makePortraitTexture(opts.charId, opts.costume, opts.expression));
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
      sprite.alpha = !this.#dialogue.activeSpeakerId || opts.charId === this.#dialogue.activeSpeakerId ? 1 : 0.46;
      this.#portraitSprites.set(key, sprite);
      this.#portraitLayer.addChild(sprite);
      return;
    }
    if (existing.texture === texture) {
      // 同纹理：仅移动（位置/尺寸无需过渡）
      existing.position.set(px, baseY);
      existing.alpha = !this.#dialogue.activeSpeakerId || opts.charId === this.#dialogue.activeSpeakerId ? 1 : 0.46;
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

  #detachPortraitSprites(removed: ReadonlySet<Sprite>): void {
    this.#movTweens = this.#movTweens.filter((tw) => !removed.has(tw.sprite));
    const orphaned = new Set<Sprite>();
    this.#portraitTweens = this.#portraitTweens.filter((tw) => {
      if (!removed.has(tw.old) && !removed.has(tw.neu)) return true;
      if (!removed.has(tw.old)) orphaned.add(tw.old);
      if (!removed.has(tw.neu)) orphaned.add(tw.neu);
      return false;
    });
    const live = new Set(this.#portraitSprites.values());
    for (const sprite of orphaned) {
      if (live.has(sprite) || removed.has(sprite)) continue;
      if (sprite.parent) sprite.parent.removeChild(sprite);
      sprite.destroy();
    }
  }

  removePortrait(key: string): void {
    this.#requestFrame();
    // key 契约：完整 `角色:服装`（与 setPortrait 第一参数一致）精确移除；
    // 纯角色 ID（规范写法 @hide lynn）移除该角色全部立绘——否则 @show lynn:armor
    // 之后 @hide lynn 查不到 'lynn:armor'，立绘永不消失（静默演出 bug）。
    const keys = this.#portraitSprites.has(key)
      ? [key]
      : [...this.#portraitSprites.keys()].filter((k) => k === key || k.startsWith(`${key}:`));
    const removed = new Set<Sprite>();
    for (const k of keys) {
      const sprite = this.#portraitSprites.get(k);
      if (sprite) removed.add(sprite);
    }
    this.#detachPortraitSprites(removed);
    for (const k of keys) {
      const sprite = this.#portraitSprites.get(k);
      if (!sprite) continue;
      if (sprite.parent) sprite.parent.removeChild(sprite);
      sprite.destroy(); // 纹理由缓存共享，不随 sprite 释放
      this.#portraitSprites.delete(k);
      this.#portraitViews.delete(k);
    }
  }

  showText(speaker: string | null, value: string): void {
    const before = this.#dialogue.projectionVersion;
    this.#dialogue.showText(speaker, value);
    if (this.#dialogue.projectionVersion !== before) {
      this.setPortraitFocus(this.#dialogue.activeSpeakerId);
    }
  }

  /** 等待推进指示器可见性（呼吸小光点；同时决定面板是否保持显示） */
  setAwaiting(awaiting: boolean): void {
    this.#dialogue.setAwaiting(awaiting);
  }

  /** 是否仍有视觉状态需要逐帧推进；静态对话画面不请求额外更新。 */
  needsUpdate(): boolean {
    return this.#dialogue.needsUpdate() || this.#hasEffectWork();
  }

  /** 呼吸小光点动画（由 AdvRenderer 每帧转发 ticker delta；alpha 呼吸 + 轻微浮动） */
  updateContinuePulse(deltaMs: number): void {
    this.#dialogue.updateContinuePulse(deltaMs);
  }

  /** 展示 Backlog 覆盖层（半透明黑底 + 最近 N 条，CJK 按字符数软换行；点击任意处关闭）。
   *  onReplayVoice：点击带语音标记的行重播（@voice 紧跟的文本行） */
  showBacklog(entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void, query = ''): void {
    this.#dialogue.showBacklog(entries, onReplayVoice, query);
  }

  /** 隐藏/恢复对话界面（H 键惯例：隐藏对话框/说话人栏/等待指示器；背景立绘/粒子保留供赏画） */
  hideInterface(hidden: boolean): void {
    this.#dialogue.hideInterface(hidden);
  }

  /** 展示现代 ADV 底部操作带。 */
  showCommandRail(items: CommandRailItem[], onSelect: (id: string) => void): void {
    this.#dialogue.showCommandRail(items, onSelect);
  }

  /** 更新操作带状态并保持当前悬停/淡出机制。 */
  setCommandRailItems(items: CommandRailItem[]): void {
    this.#dialogue.setCommandRailItems(items);
  }

  hideCommandRail(): void {
    this.#dialogue.hideCommandRail();
  }

  /** @internal Facade-only compatibility bridge for overlay dismissal. */
  restoreCommandRail(): void {
    this.#dialogue.restoreCommandRail();
  }

  /** Backlog 滚动：delta 正数向下（看更旧内容方向为向上滚 → 负 delta），clamp 到内容范围 */
  scrollBacklog(delta: number): void {
    this.#dialogue.scrollBacklog(delta);
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
    this.#dialogue.hideBacklog();
  }

  /* ============================ 演出效果（@shake/@flash/@zoom） ============================ */

  /** 时间轴 cue 的 Pixi 投影；同一接口也承载现有直接演出方法。 */
  applyTimelineFrame(event: TimelineFrameEvent): void {
    const cue = event.cue;
    if (event.track === 'background' && cue.action === 'set' && typeof cue.key === 'string' && (event.started || event.final)) {
      this.#startTimelineBackground(cue.key, cue.durationMs);
      return;
    }
    if (event.track === 'portrait' && event.target) {
      const target = event.target;
      if (cue.action === 'show' && (event.started || event.final)) {
        this.setPortrait(target, {
          charId: target.split(':')[0] ?? target,
          costume: target.split(':')[1] ?? 'normal',
          expression: typeof cue.expression === 'string' ? cue.expression : 'normal',
          pos: typeof cue.position === 'string' ? cue.position : 'center',
        });
      } else if (cue.action === 'expression' && (event.started || event.final)) {
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
          const activeAlpha = !this.#dialogue.activeSpeakerId || this.#portraitViews.get(target)?.charId === this.#dialogue.activeSpeakerId ? 1 : 0.46;
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
    if (event.track === 'camera') {
      if (cue.action === 'zoom' && typeof cue.scale === 'number') {
        let from = this.#timelineValueStarts.get(cue);
        if (from === undefined) {
          from = this.#worldLayer.scale.x;
          this.#timelineValueStarts.set(cue, from);
        }
        const scale = from + (Math.max(0.25, Math.min(4, cue.scale)) - from) * event.progress;
        this.#worldLayer.scale.set(scale);
        this.#setWorldBasePosition();
        if (event.progress >= 1) this.#timelineValueStarts.delete(cue);
      } else if (cue.action === 'pan' && typeof cue.x === 'number' && typeof cue.y === 'number') {
        let from = this.#timelinePanStarts.get(cue);
        if (!from) {
          from = { x: this.#cameraPanX, y: this.#cameraPanY };
          this.#timelinePanStarts.set(cue, from);
        }
        this.#cameraPanX = from.x + (Math.max(-2000, Math.min(2000, cue.x)) - from.x) * event.progress;
        this.#cameraPanY = from.y + (Math.max(-2000, Math.min(2000, cue.y)) - from.y) * event.progress;
        this.#setWorldBasePosition();
        if (event.progress >= 1) this.#timelinePanStarts.delete(cue);
      } else if (cue.action === 'shake' && event.started && typeof cue.strength === 'number') {
        this.shake(cue.durationMs, cue.strength);
      }
      return;
    }
    if (event.track === 'screen') {
      if (cue.action === 'fade' && typeof cue.alpha === 'number') {
        let from = this.#timelineValueStarts.get(cue);
        if (from === undefined) {
          from = this.#fadeOverlay.alpha;
          this.#timelineValueStarts.set(cue, from);
        }
        this.#fadeOverlay.alpha = Math.max(0, Math.min(1, from + (cue.alpha - from) * event.progress));
        if (event.progress >= 1) this.#timelineValueStarts.delete(cue);
      } else if (cue.action === 'tint' && typeof cue.color === 'number' && typeof cue.alpha === 'number') {
        let from = this.#timelineTintStarts.get(cue);
        if (!from) {
          const alpha = this.#tintOverlay.alpha;
          from = {
            // 透明叠加层没有可见的旧颜色；首次 tint 应直接淡入目标色，
            // 否则 Pixi 默认的白色 tint 会在半透明阶段造成不必要的泛白。
            color: alpha <= 0.001 ? cue.color & 0xffffff : Number(this.#tintOverlay.tint ?? 0),
            alpha,
          };
          this.#timelineTintStarts.set(cue, from);
        }
        this.#tintOverlay.tint = lerpColor(from.color, cue.color & 0xffffff, event.progress);
        this.#tintOverlay.alpha = Math.max(0, Math.min(1, from.alpha + (cue.alpha - from.alpha) * event.progress));
        this.#tintOverlay.visible = this.#tintOverlay.alpha > 0.001;
        if (event.progress >= 1) this.#timelineTintStarts.delete(cue);
      } else if (cue.action === 'flash' && event.started) {
        this.flash(cue.durationMs);
      } else if (cue.action === 'wipe' && event.started) {
        this.wipe(cue.durationMs);
      }
      return;
    }
    if (event.track === 'particle' && typeof cue.kind === 'string' && (event.started || event.final)) {
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
      cameraPan: { x: this.#cameraPanX, y: this.#cameraPanY },
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
    }
    if (typeof raw.cameraPan === 'object' && raw.cameraPan !== null) {
      const pan = raw.cameraPan as Record<string, unknown>;
      this.#cameraPanX = typeof pan.x === 'number' && Number.isFinite(pan.x) ? Math.max(-2000, Math.min(2000, pan.x)) : 0;
      this.#cameraPanY = typeof pan.y === 'number' && Number.isFinite(pan.y) ? Math.max(-2000, Math.min(2000, pan.y)) : 0;
    }
    this.#setWorldBasePosition();
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
    this.#requestFrame();
  }

  clearPresentation(): void {
    this.#stopBackgroundTransition();
    for (const key of [...this.#portraitSprites.keys()]) this.removePortrait(key);
    this.setBackground(null);
    this.#timelineMoveStarts.clear();
    this.#timelineValueStarts.clear();
    this.#timelinePanStarts.clear();
    this.#timelineTintStarts.clear();
    this.#cameraPanX = 0;
    this.#cameraPanY = 0;
    this.#worldLayer.position.set(0, 0);
    this.#worldLayer.scale.set(1);
    this.#worldEffects.reset();
    this.#flashRemain = 0;
    this.#flashOverlay.alpha = 0;
    this.#zoomFrom = 1;
    this.#zoomTo = 1;
    this.#zoomRemain = 0;
    this.#wipeRemain = 0;
    this.#wipeBar.visible = false;
    this.setFade(0);
    this.#tintOverlay.alpha = 0;
    this.#tintOverlay.visible = false;
    this.stopParticles();
    this.#requestFrame();
  }

  /**
   * 卸载由 registerBackground/registerPortrait/registerAvatar 通过 URL 加载的 Pixi 资源。
   * 已注入 Texture 不在集合内，因此不会越权销毁宿主共享纹理。
   * 编辑器预览在 resetSession({ clearAssets: true }) 后调用此方法，
   * 正式游戏退出时也应调用，避免 Blob URL 对应的 Texture 留在全局 Assets 缓存中。
   */
  async releaseRegisteredAssetSources(): Promise<void> {
    await this.#assetRegistry.releaseRegisteredAssetSources();
  }

  /** 画面震动：world 层随机偏移，振幅随时间线性衰减（演出冲击感） */
  shake(durMs = 400, strength = 8, direction: ShakeDirection = 'both'): void {
    this.#worldEffects.shake(presentationDuration(durMs, this.#presentation), strength, direction);
  }

  /** 注册表驱动的场景转场；未知名称返回 false，交由宿主/校验层报告。 */
  transition(name: TransitionName | string, durMs = 600): boolean {
    const started = this.#worldEffects.transition(name, presentationDuration(durMs, this.#presentation));
    if (started) this.#requestFrame();
    return started;
  }

  /** 白闪：全屏白色叠加 alpha 从 1 线性衰减到 0 */
  flash(durMs = 300): void {
    this.#flashDur = presentationDuration(durMs, this.#presentation);
    this.#flashRemain = this.#flashDur;
    this.#flashOverlay.alpha = 1;
    this.#requestFrame();
  }

  /** 缩放：world 层向目标 scale 线性过渡（以画面中心为锚点）。scale=1 复位 */
  zoom(scale = 1, durMs = 400): void {
    this.#zoomFrom = this.#worldLayer.scale.x;
    this.#zoomTo = Math.max(0.25, Math.min(4, scale));
    this.#zoomDur = presentationDuration(durMs, this.#presentation);
    this.#zoomRemain = this.#zoomDur;
    this.#requestFrame();
  }

  /** 演出效果时间轴推进（AdvRenderer 每帧转发 ticker delta） */
  updateEffects(deltaMs: number): void {
    if (!this.#hasEffectWork()) return;
    this.#dialogue.update(deltaMs);
    this.#worldEffects.update(deltaMs);
    if (this.#flashRemain > 0) {
      this.#flashRemain = Math.max(0, this.#flashRemain - deltaMs);
      this.#flashOverlay.alpha = this.#flashRemain / this.#flashDur;
    }
    if (this.#zoomRemain > 0) {
      this.#zoomRemain = Math.max(0, this.#zoomRemain - deltaMs);
      const t = 1 - this.#zoomRemain / this.#zoomDur;
      const scale = this.#zoomFrom + (this.#zoomTo - this.#zoomFrom) * t;
      this.#worldLayer.scale.set(scale);
      this.#setWorldBasePosition();
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
    this.#menu.update(deltaMs);
    this.#updateTransient(deltaMs);
  }

  #hasEffectWork(): boolean {
    return this.#dialogue.needsUpdate()
      || this.#worldEffects.needsUpdate
      || this.#flashRemain > 0
      || this.#zoomRemain > 0
      || this.#bgTransition !== null
      || this.#menu.needsUpdate
      || this.#tintRemain > 0
      || this.#movTweens.length > 0
      || this.#particles.length > 0
      || this.#portraitTweens.length > 0
      || this.#wipeRemain > 0;
  }

  /** @wipe：黑色竖条自左向右扫过画面（转场仪式感） */
  wipe(durMs = 600): void {
    this.#wipeDur = presentationDuration(durMs, this.#presentation);
    this.#wipeRemain = this.#wipeDur;
    this.#wipeBar.visible = true;
    this.#requestFrame();
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
    const dur = presentationDuration(durMs, this.#presentation);
    for (const k of keys) {
      const sprite = this.#portraitSprites.get(k)!;
      // 重复 @mov 同一立绘：丢弃进行中的旧补间，从当前位置重新起步（不叠加抖动）
      this.#movTweens = this.#movTweens.filter((tw) => tw.sprite !== sprite);
      this.#movTweens.push({ sprite, fromX: sprite.x, toX: targetX, remain: dur, dur });
    }
    this.#requestFrame();
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
    this.#tintDur = presentationDuration(durMs, this.#presentation);
    this.#tintRemain = this.#tintDur;
    this.#tintOverlay.visible = true;
    this.#requestFrame();
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
    if (!this.#presentation.particleEnabled) return;
    if (this.#particleKind === kind) return; // 幂等
    this.stopParticles();
    const preset = PARTICLE_PRESETS[kind];
    if (!preset) return; // 未知预设静默忽略（占位策略）
    this.#particleKind = kind;
    const settings = this.#quality.settings;
    const particleCount = Math.min(
      settings.maxParticles,
      Math.max(1, Math.round(preset.count * settings.particleScale)),
    );
    for (let i = 0; i < particleCount; i++) {
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
    this.#requestFrame();
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
    this.#requestFrame();
  }

  /** 横幅：chapter 变体电影化（上下黑边 letterbox + 大字距渐显），tip 变体右上小胶囊；首尾淡入淡出 */
  showBanner(text: string, variant: 'chapter' | 'tip'): void {
    this.#dialogue.showBanner(text, variant);
  }

  /** NVL 模式：开启时隐藏对话框，全屏半透明文本页；关闭时恢复 */
  setNvlMode(on: boolean): void {
    this.#dialogue.setNvlMode(on);
  }

  /** NVL 页条目列表（只读引用；测试断言与宿主持久化巡检用） */
  get nvlLines(): readonly PText[] {
    return this.#dialogue.nvlLines;
  }

  /** NVL 页追加一条（wrapCjk 预断行；按折行数累计排布；超出屏幕底边淘汰最旧） */
  appendNvlText(speaker: string | null, text: string): void {
    this.#dialogue.appendNvlText(speaker, text);
  }

  /** NVL 页清空（@nvl clear） */
  clearNvlText(): void {
    this.#dialogue.clearNvlText();
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
    return {
      x: ((1 - scale) * this.#w) / 2 + this.#cameraPanX,
      y: ((1 - scale) * this.#h) / 2 + this.#cameraPanY,
    };
  }

  #setWorldBasePosition(): void {
    const off = this.#zoomBaseOffset();
    this.#worldLayer.position.set(off.x, off.y);
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
    this.#requestFrame();
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
    this.#requestFrame();
    this.#galleryLayer.visible = false;
    this.#dialogue.restoreCommandRail();
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
          const tex = this.#assetRegistry.resolveBackground(key)
            ?? this.#assetRegistry.getOrCreateBackground(key, () => makeBackgroundTexture(key, 320, 180));
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
    const tex = this.#assetRegistry.resolveBackground(key)
      ?? this.#assetRegistry.getOrCreateBackground(key, () => makeBackgroundTexture(key, this.#w, this.#h));
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
    this.#requestFrame();
    this.hideSaveLoad();
    this.hideGallery();
    this.hideCommandRail();
    this.#menu.showSettings(rows, onChange, onClose);
  }

  /** 隐藏设置面板 */
  hideSettings(): void {
    this.#requestFrame();
    this.#menu.hideSettings();
    this.#dialogue.restoreCommandRail();
  }

  /* ============================ 战斗覆盖层 ============================ */

  /** 展示交互式战斗界面：阵营分列 + 血条；点击非行动方存活单位攻击，底部可跳过行动。
   *  宿主每次结算（act/pass）后以新的 BattleView 重新调用本方法刷新。 */
  showBattle(view: BattleView, handlers: BattleHandlers, message = ''): void {
    this.#requestFrame();
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
    this.#requestFrame();
    this.#battleLayer.visible = false;
  }

  /* ============================ 标题画面 / 系统菜单 / 存读档 / 大地图 ============================ */

  /** 展示标题画面；MenuLayer owns the projection, while this wrapper preserves legacy coordination. */
  showTitle(view: TitleView, onSelect: (id: string) => void): void {
    this.#requestFrame();
    this.hideEnding();
    this.hideCommandRail();
    this.#menu.showTitle(view, onSelect);
  }

  /** 隐藏标题画面；进入正文时默认恢复操作带，进入标题二级页时可保持操作带隐藏。 */
  hideTitle(restoreCommandRail = true): void {
    this.#requestFrame();
    this.#menu.hideTitle(restoreCommandRail);
    if (restoreCommandRail) {
      this.#dialogue.restoreCommandRail();
    } else {
      this.hideCommandRail();
    }
  }

  /** 全黑结局卡；旧 API 的跨层隐藏顺序保持在兼容包装器。 */
  showEnding(text = 'THE END'): void {
    this.#requestFrame();
    this.hideCommandRail();
    this.hideChoices();
    this.hideBacklog();
    this.hideGallery();
    this.hideSettings();
    this.hideSaveLoad();
    this.hideSystemMenu();
    this.hideTitle(false);
    this.#menu.showEnding(text);
    this.#fadeOverlay.alpha = 0;
  }

  /** 隐藏结局卡；多次调用保持幂等。 */
  hideEnding(): void {
    this.#requestFrame();
    this.#menu.hideEnding();
  }

  /** 展示现代 ADV 系统菜单；MenuLayer owns the menu projection. */
  showSystemMenu(items: SystemMenuItemView[], onSelect: (id: string) => void, onClose: () => void): void {
    this.#requestFrame();
    this.#menu.showSystemMenu(items, onSelect, onClose);
  }

  /** 隐藏系统菜单。 */
  hideSystemMenu(): void {
    this.#requestFrame();
    this.#menu.hideSystemMenu();
  }


  /** 展示存档/读档界面；MenuLayer owns the projection and thumbnail pool. */
  showSaveLoad(view: SaveLoadView, onSelect: (slotId: string) => void, onClose: () => void): void {
    this.#requestFrame();
    this.hideSettings();
    this.hideGallery();
    this.hideCommandRail();
    this.#menu.showSaveLoad(view, onSelect, onClose);
  }

  /** 隐藏存档/读档界面。 */
  hideSaveLoad(): void {
    this.#requestFrame();
    this.#menu.hideSaveLoad();
    this.#dialogue.restoreCommandRail();
  }

  /** 展示大地图：节点（可进入者高亮可点）+ 日期/回合/行动力 + 结束回合 */
  showMap(view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void): void {
    this.#requestFrame();
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
    this.#requestFrame();
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
    this.#requestFrame();
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
    this.#requestFrame();
    this.#shopLayer.visible = false;
  }

  /* ============================ 据点指令（兰斯式 base commands） ============================ */

  /** 展示据点指令面板：指令列表（可执行高亮/不可执行灰显）+ 行动力余量。
   *  宿主在 onExec 里结算（CalendarRunner.execBaseCommand + 写回 effects）后重绘；onClose 回到地图。 */
  showBaseCommands(view: BasePanelView, onExec: (cmdId: string) => void, onClose: () => void): void {
    this.#requestFrame();
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
    this.#requestFrame();
    this.#baseLayer.visible = false;
  }

  showChoices(options: ChoiceOptionView[]): void {
    this.#dialogue.showChoices(options);
  }

  /** 选择肢键盘导航高亮：提亮第 pos 项（其余恢复默认样式；卡片与文本同步重绘） */
  setChoiceHighlight(pos: number): void {
    this.#dialogue.setChoiceHighlight(pos);
  }

  hideChoices(): void {
    this.#dialogue.hideChoices();
  }

  setFade(alpha: number): void {
    this.#requestFrame();
    this.#fadeOverlay.alpha = Math.max(0, Math.min(1, alpha));
  }

  showLoading(progress: LoadingProgress): void {
    this.#requestFrame();
    this.#loadingLayer.show(progress);
  }

  hideLoading(): void {
    this.#requestFrame();
    this.#loadingLayer.hide();
  }

  /**
   * 清理一轮剧情会话的投影状态。资源注册表也会清空，避免编辑器预览重载后
   * 沿用上一个项目的背景/立绘；宿主注入纹理不主动 destroy，生命周期仍由宿主管理。
   */
  resetSession(options: { preserveWorld?: boolean; clearAssets?: boolean } = {}): void {
    this.#requestFrame();
    this.hideLoading();
    const preserveWorld = options.preserveWorld === true;
    const clearAssets = options.clearAssets === true;
    this.hideVideo();
    this.hideEnding();
    this.#dialogue.reset();
    this.#assetRegistry.reset({ clearAssets, preserveAssets: preserveWorld });

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
    }

    const clearLayer = (layer: Container): void => {
      layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    };
    clearLayer(this.#galleryLayer);
    clearLayer(this.#battleLayer);
    this.#menu.reset();
    clearLayer(this.#mapLayer);
    clearLayer(this.#shopLayer);
    clearLayer(this.#baseLayer);
    this.#galleryLayer.visible = false;
    this.#battleLayer.visible = false;
    this.#mapLayer.visible = false;
    this.#shopLayer.visible = false;
    this.#baseLayer.visible = false;
    this.#mapHandlers = null;
    this.#shopHandlers = null;
    this.#baseHandlers = null;
    this.#galleryViews = null;
    this.#galleryOnPlayMusic = null;
    this.#galleryOnReplayText = null;
    this.#galleryOnClose = null;
    this.#battleHandlers = null;

    this.#worldLayer.position.set(0, 0);
    this.#worldLayer.scale.set(1);
    this.#cameraPanX = 0;
    this.#cameraPanY = 0;
    this.#worldEffects.reset();
    this.#flashRemain = 0;
    this.#flashOverlay.alpha = 0;
    this.#zoomFrom = 1;
    this.#zoomTo = 1;
    this.#zoomRemain = 0;
    this.#stopBackgroundTransition();
    this.#timelineMoveStarts.clear();
    this.#timelineValueStarts.clear();
    this.#timelinePanStarts.clear();
    this.#timelineTintStarts.clear();
    this.stopParticles();
    this.#wipeRemain = 0;
    this.#wipeBar.visible = false;
    this.#tintRemain = 0;
    this.#tintOverlay.alpha = 0;
    this.#tintOverlay.visible = false;
    this.#tintFrom = { color: 0x000000, alpha: 0 };
    this.#tintTo = { color: 0x000000, alpha: 0 };

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
    this.#worldEffects.destroy();
    this.#loadingLayer.destroy();
    this.#menu.dispose();
    this.#dialogue.dispose();
    this.stopParticles(); // 粒子 Graphics 随粒子层销毁，先显式清空避免重复 destroy
    for (const sprite of this.#portraitSprites.values()) sprite.destroy();
    this.#portraitSprites.clear();
    this.#portraitViews.clear();
    this.#bgSprite?.destroy();
    this.#bgSprite = null;
    this.#backgroundKey = null;
    this.#assetRegistry.dispose();
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.#frameRequest = null;
  }

  #requestFrame(): void {
    this.#frameRequest?.();
  }
}
