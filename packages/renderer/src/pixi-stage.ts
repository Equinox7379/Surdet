import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text as PText,
  Texture,
  type TextStyleOptions,
} from 'pixi.js';
import type { AdvStage, ChoiceOptionView, PortraitView } from './types.js';

/** 确定性颜色生成（同一资源 key 稳定同色） */
function hashStr(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function hsl(hash: number, sat: number, light: number): string {
  return `hsl(${hash % 360}, ${sat * 100}%, ${light * 100}%)`;
}

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
  #choiceLayer: Container;
  #choiceViews: PText[] = [];

  #w = 1280;
  #h = 720;

  constructor() {
    this.#bgLayer = new Container();
    this.#portraitLayer = new Container();
    this.#uiLayer = new Container();
    this.#fadeOverlay = new Graphics().rect(0, 0, this.#w, this.#h).fill(0x000000);
    this.#fadeOverlay.alpha = 0;
    this.#choiceLayer = new Container();
    this.#uiLayer.addChild(this.#choiceLayer);

    this.#speakerText = new PText({
      text: '',
      style: { fontSize: 26, fill: 0xffe8c8, fontWeight: 'bold' } satisfies TextStyleOptions,
    });
    this.#dialogText = new PText({
      text: '',
      style: {
        fontSize: 26,
        fill: 0xf5f5f5,
        wordWrap: true,
        wordWrapWidth: this.#w - 160,
        lineHeight: 38,
      } satisfies TextStyleOptions,
    });
  }

  /** 初始化 Pixi 应用与舞台层级（真实项目在 DOM 就绪后调用）。
   *  resolution 按设备像素比渲染（高分屏不糊），autoDensity 保持逻辑尺寸 1280×720。 */
  async init(canvas?: HTMLCanvasElement): Promise<void> {
    const app = new Application();
    const resolution = typeof window !== 'undefined' && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
    await app.init({
      width: this.#w,
      height: this.#h,
      background: 0x000000,
      antialias: true,
      resolution,
      autoDensity: true,
      canvas,
    });
    this.app = app;

    app.stage.addChild(this.#bgLayer, this.#portraitLayer, this.#uiLayer);
    this.#uiLayer.addChild(this.#speakerText, this.#dialogText, this.#fadeOverlay);
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
    this.#speakerText.position.set(70, this.#h - 190);
    this.#dialogText.position.set(70, this.#h - 150);
    // 选择肢列：对话框上方
    for (let i = 0; i < this.#choiceViews.length; i++) {
      this.#choiceViews[i]!.position.set(90, this.#h - 320 + i * 56);
    }
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
    let sprite = this.#portraitSprites.get(key);
    if (!sprite) {
      sprite = new Sprite(texture);
      this.#portraitSprites.set(key, sprite);
      this.#portraitLayer.addChild(sprite);
    } else {
      sprite.texture = texture;
    }
    // 尺寸与位置
    const pw = 340;
    const ph = (texture.height / texture.width) * pw;
    sprite.width = pw;
    sprite.height = ph;
    sprite.anchor.set(0.5, 1);
    const baseY = this.#h * 0.82;
    if (opts.pos === 'left') sprite.position.set(this.#w * 0.24, baseY);
    else if (opts.pos === 'right') sprite.position.set(this.#w * 0.76, baseY);
    else sprite.position.set(this.#w * 0.5, baseY);
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
    this.#dialogText.text = value;
  }

  showChoices(options: ChoiceOptionView[]): void {
    this.#clearChoices();
    for (const opt of options) {
      const t = new PText({
        text: `▸ ${opt.label}`,
        style: {
          fontSize: 26,
          fill: 0xffffff,
          dropShadow: { color: 0x000000, alpha: 0.9, blur: 4, distance: 1 },
        } satisfies TextStyleOptions,
      });
      t.eventMode = 'static';
      t.cursor = 'pointer';
      t.on('pointerdown', () => this.onSelect?.(opt.index));
      this.#choiceLayer.addChild(t);
      this.#choiceViews.push(t);
    }
    this.#layout();
  }

  hideChoices(): void {
    this.#clearChoices();
  }

  setFade(alpha: number): void {
    this.#fadeOverlay.alpha = Math.max(0, Math.min(1, alpha));
  }

  #clearChoices(): void {
    for (const t of this.#choiceViews) {
      this.#choiceLayer.removeChild(t);
      t.destroy();
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
