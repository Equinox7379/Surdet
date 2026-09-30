import { createStageGeometryPolicy } from './stage-geometry.js';
import {
  Application,
  Container,
  Text as PText,
  TextStyle,
  type TextStyleOptions,
} from 'pixi.js';
import type { BattleHandlers, BattleView } from './battle-view.js';
import type { BacklogEntry } from './backlog.js';
import type { BasePanelView, MapView, SaveLoadView, SystemMenuItemView, TitleView } from './ui-views.js';
import type { GalleryItemView } from './gallery.js';
import type { SettingsRowView } from './settings-store.js';
import type { TimelineFrameEvent } from './timeline-player.js';
import type {
  ChoiceOptionView,
  CommandRailItem,
  FrameRequestHandler,
  PortraitView,
  SpeakerProfile,
} from './types.js';
import { RenderQualityController, type RenderQuality } from './quality.js';
import type { PresentationPreferences } from './presentation.js';
import type { RendererProjectionSnapshot } from './api/renderer-queries.js';
import type { PostProcessSettings } from './post-process.js';
import { LoadingLayer } from './loading-layer.js';
import type { LoadingProgress } from './loading-progress.js';
import type { ShakeDirection, TransitionName } from './world-effects-controller.js';
import type {
  DialogueProjectionPort,
  GalleryProjectionPort,
  MenuProjectionPort,
  SaveLoadCommandOptions,
  SaveLoadSelectionHandler,
  SystemPanelProjectionPort,
  WorldProjectionPort,
} from './api/renderer-commands.js';
import {
  DEFAULT_RENDERER_FONT_FAMILIES,
  RenderAssetRegistry,
  type RenderAssetSource,
} from './services/render-asset-registry.js';
import { RenderLifecycle } from './lifecycle/render-lifecycle.js';
import { DialogueLayer } from './layers/dialogue/dialogue-layer.js';
import { MenuLayer } from './layers/menu/menu-layer.js';
import { GalleryLayer } from './layers/gallery/gallery-layer.js';
import { SystemPanelLayer } from './layers/system-panel/system-panel-layer.js';
import { WorldLayer, makeWorldBackgroundTexture } from './layers/world/world-layer.js';
import type { RendererTheme } from './theme.js';
import { PlayerFocusScope } from './player-controls.js';

/** Keep the legacy public type path while the source of truth lives in battle-view.ts. */
export type { BattleHandlers } from './battle-view.js';

/** 字体角色：标题用展示字体，正文与 UI 保持无衬线的长时间阅读口径。 */
export type FontRole = 'title' | 'body' | 'ui';

/**
 * Pixi 舞台：内核状态的可视化投影。
 * 背景/立绘资源缺失时回退程序化占位（同 key 稳定同图），真实项目可注入真实纹理。
 */
export class RendererStageHost {
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

  get onPointerConsumed(): (() => void) | null {
    return this.#dialogue.onPointerConsumed;
  }

  set onPointerConsumed(handler: (() => void) | null) {
    this.#dialogue.onPointerConsumed = handler;
  }

  /** @internal Renderer runtime wiring for the extracted dialogue layer. */
  get dialogueLayer(): DialogueProjectionPort {
    return this.#dialogue;
  }

  /** @internal Renderer runtime wiring for the extracted menu layer. */
  get menuLayer(): MenuProjectionPort {
    return this.#menu;
  }

  /** @internal Renderer runtime wiring for the extracted gallery layer. */
  get galleryLayer(): GalleryProjectionPort {
    return this.#gallery;
  }

  /** @internal Renderer runtime wiring for the extracted system-panel layer. */
  get systemPanelLayer(): SystemPanelProjectionPort {
    return this.#system;
  }

  /** @internal Renderer runtime wiring for the extracted world layer. */
  get worldLayer(): WorldProjectionPort {
    return this.#world;
  }

  /** @internal Composition-root semantic read model; never returns a Layer. */
  get projectionSnapshot(): RendererProjectionSnapshot {
    return {
      dialogue: this.#dialogue.debugSnapshot(),
      menu: this.#menu.debugSnapshot(),
      gallery: this.#gallery.debugSnapshot(),
      system: this.#system.debugSnapshot(),
      world: this.#world.debugSnapshot(),
      themeProjection: {
        dialogue: this.#dialogue.themeProjectionSnapshot(),
        menu: this.#menu.themeProjectionSnapshot(),
        gallery: this.#gallery.themeProjectionSnapshot(),
        system: this.#system.themeProjectionSnapshot(),
        loading: this.#loadingLayer.themeProjectionSnapshot(),
      },
    };
  }

  #uiLayer: Container;
  readonly #assetRegistry: RenderAssetRegistry;
  readonly #dialogue: DialogueLayer;
  /** M5 extracted gallery projection; all gallery state lives here. */
  readonly #gallery: GalleryLayer;
  /** M4 extracted menu projection; all title/ending/system/settings/save-load state lives here. */
  readonly #menu: MenuLayer;
  /** M6 extracted system-panel projection; all battle/map/shop/base/video state lives here. */
  readonly #system: SystemPanelLayer;

  #w = 1280;
  #h = 720;
  /** 项目字体按角色独立保存；默认不依赖任何系统已安装字体。 */
  #fontFamilies: Record<FontRole, string> = { ...DEFAULT_RENDERER_FONT_FAMILIES };
  /** 舞台直接交互/异步资源更新时唤醒外部帧调度器。 */
  #frameRequest: FrameRequestHandler | null = null;
  #playerFocus: PlayerFocusScope | null = null;
  /** 画质策略由舞台统一应用，默认 balanced 兼顾正式游戏和编辑器预览。 */
  #loadingLayer: LoadingLayer;
  readonly #world: WorldLayer;

  constructor(assetRegistry?: RenderAssetRegistry, lifecycle?: RenderLifecycle, stage?: import('@surdet/core').ProjectStage | null) {
    if (stage) { this.#w = stage.design.width; this.#h = stage.design.height; }
    this.#assetRegistry = assetRegistry ?? new RenderAssetRegistry();
    // 动态文本默认继承正文角色；标题与菜单在各自的构建点显式使用 title/ui 角色。
    TextStyle.defaultTextStyle.fontFamily = this.#fontFamilies.body;
    this.#uiLayer = new Container();
    this.#world = new WorldLayer({
      stage,
      stageGeometry: createStageGeometryPolicy(),
      width: this.#w,
      height: this.#h,
      assets: this.#assetRegistry,
      ...(lifecycle ? { lifecycle } : {}),
      createBackgroundTexture: (key, width, height) => makeWorldBackgroundTexture(key, width, height),
      requestFrame: () => this.#requestFrame(),
      captureThumbnail: () => this.captureThumbnail(),
    });
    this.#dialogue = new DialogueLayer({
      uiLayer: this.#uiLayer,
      width: this.#w,
      height: this.#h,
      assets: this.#assetRegistry,
      ...(lifecycle ? { lifecycle } : {}),
      preferences: this.#world.getPresentationPreferences(),
      requestFrame: () => this.#requestFrame(),
    });
    this.#menu = new MenuLayer({
      uiLayer: this.#uiLayer,
      width: this.#w,
      height: this.#h,
      assets: this.#assetRegistry,
      ...(lifecycle ? { lifecycle } : {}),
      presentation: () => this.#world.getPresentationPreferences(),
      fontFamily: (role) => this.#fontFamilies[role],
      requestFrame: () => this.#requestFrame(),
      onPointerConsumed: () => this.#dialogue.onPointerConsumed?.(),
    });
    this.#loadingLayer = new LoadingLayer(this.#w, this.#h);
    this.#gallery = new GalleryLayer({
      uiLayer: this.#uiLayer,
      width: this.#w,
      height: this.#h,
      assets: this.#assetRegistry,
      ...(lifecycle ? { lifecycle } : {}),
      createBackgroundTexture: (key, width, height) => makeWorldBackgroundTexture(key, width, height),
      requestFrame: () => this.#requestFrame(),
    });
    this.#system = new SystemPanelLayer({
      uiLayer: this.#uiLayer,
      width: this.#w,
      height: this.#h,
      assets: this.#assetRegistry,
      ...(lifecycle ? { lifecycle } : {}),
      requestFrame: () => this.#requestFrame(),
    });
    this.#uiLayer.addChild(
      this.#world.wipeOverlay,
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
      accessibilityOptions: { enabledByDefault: true, deactivateOnMouseMove: false },
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

    app.stage.addChild(this.#world.worldContainer, this.#world.particleContainer, this.#world.screenContainer, this.#uiLayer);
    this.#dialogue.bringTextDisplaysToFront();
    // flash 置最末：闪光覆盖全部 UI；黑场 fade 也保留在 HUD 之上用于整屏转场。
    // tint 位于 screenLayer，在世界与 HUD 之间，不应吞掉对白、选择肢或操作带。
    this.#uiLayer.addChild(this.#world.fadeOverlay, this.#world.flashOverlay);
    this.#playerFocus = new PlayerFocusScope(this.#uiLayer, app.renderer, app.canvas, () => this.#requestFrame());
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
    this.#world.setQuality(quality);
  }

  getQuality(): RenderQuality {
    return this.#world.getQuality();
  }

  setPresentationPreferences(preferences: Partial<PresentationPreferences>): void {
    this.#world.setPresentationPreferences(preferences);
    this.#dialogue.setPresentationPreferences(this.#world.getPresentationPreferences());
  }

  getPresentationPreferences(): PresentationPreferences {
    return this.#world.getPresentationPreferences();
  }

  setPostProcess(settings: Partial<PostProcessSettings>): void {
    this.#world.setPostProcess(settings);
  }

  getPostProcess(): PostProcessSettings {
    return this.#world.getPostProcess();
  }

  /** 绑定/解绑通用帧调度器。 */
  setFrameRequest(handler: FrameRequestHandler | null): void {
    this.#frameRequest = handler;
    if (handler && this.needsUpdate()) handler();
  }

  setTheme(theme: RendererTheme): void {
    this.#dialogue.setTheme(theme);
    this.#menu.setTheme(theme);
    this.#gallery.setTheme(theme);
    this.#system.setTheme(theme);
    this.#loadingLayer.setTheme(theme);
    this.#requestFrame();
  }

  setDeclarativeUiSuppression(pages: Partial<Record<import('@surdet/core').ProjectUiPageId, boolean>>): void {
    this.#dialogue.setDeclarativeUiSuppression(pages);
    this.#menu.setDeclarativeUiSuppression(pages);
    this.#gallery.setDeclarativeUiSuppression(Boolean(pages.gallery));
    this.#requestFrame();
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
    await this.#world.refreshBackgroundAsset(key);
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
  async registerPortrait(charId: string, costume: string, expression: string, src: RenderAssetSource, format?: string, sourcePath?: string): Promise<void> {
    await this.#assetRegistry.registerPortrait(charId, costume, expression, src, format, sourcePath);
    await this.#world.refreshPortraitAsset(charId, costume, expression);
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
  }

  /** World port used by RendererFacade to keep portrait focus separate from dialogue state. */
  setPortraitFocus(characterId: string | null): void {
    this.#world.setPortraitFocus(characterId);
  }

  setPortraitSpeaking(speaking: boolean): void { this.#world.setPortraitSpeaking(speaking); }
  setPortraitSkipping(skipping: boolean): void { this.#world.setPortraitSkipping(skipping); }

  applyStage(command: import('@surdet/core').StageCommand): void { this.#world.applyStage(command); }

  setBackground(key: string | null): void {
    this.#world.setBackground(key);
  }

  setPortrait(key: string, opts: PortraitView): void {
    this.#world.setPortrait(key, opts);
  }

  removePortrait(key: string): void {
    this.#world.removePortrait(key);
  }

  showText(speaker: string | null, value: string): void {
    this.#dialogue.showText(speaker, value);
  }

  beginText(speaker: string | null): void {
    this.#dialogue.beginText(speaker);
  }

  clearText(): void {
    this.#dialogue.clearText();
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

  /** 剧情舞台缩略图（存档预览用，不含菜单）：缩到宽 ≤320 的 JPEG dataURL；失败返回 null */
  captureThumbnail(): string | null {
    if (!this.app || typeof document === 'undefined') return null;
    try {
      const extract = this.app.renderer.extract as unknown as { canvas: (opts: { target: unknown }) => HTMLCanvasElement };
      const source = extract.canvas({ target: this.#world.worldContainer });
      const scale = Math.min(1, 320 / source.width);
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(source.width * scale));
      small.height = Math.max(1, Math.round(source.height * scale));
      const context = small.getContext('2d');
      if (!context) return null;
      context.drawImage(source, 0, 0, small.width, small.height);
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
    this.#world.applyTimelineFrame(event);
  }

  snapshotPresentation(): unknown {
    return this.#world.snapshotPresentation();
  }

  validatePresentation(snapshot: unknown): void {
    this.#world.validatePresentation?.(snapshot);
  }

  restorePresentation(snapshot: unknown): void {
    this.#world.restorePresentation(snapshot);
  }

  clearPresentation(): void {
    this.#world.clearPresentation();
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
    this.#world.shake(durMs, strength, direction);
  }

  /** 注册表驱动的场景转场；未知名称返回 false，交由宿主/校验层报告。 */
  transition(name: TransitionName | string, durMs = 600): boolean {
    return this.#world.transition(name, durMs);
  }

  /** 白闪：全屏白色叠加 alpha 从 1 线性衰减到 0 */
  flash(durMs = 300): void {
    this.#world.flash(durMs);
  }

  /** 缩放：world 层向目标 scale 线性过渡（以画面中心为锚点）。scale=1 复位 */
  zoom(scale = 1, durMs = 400): void {
    this.#world.zoom(scale, durMs);
  }

  /** 演出效果时间轴推进（AdvRenderer 每帧转发 ticker delta） */
  updateEffects(deltaMs: number): void {
    this.#world.update(deltaMs);
    this.#menu.update(deltaMs);
    this.#dialogue.update(deltaMs);
  }

  /** 暂停期间只推进菜单与顶层提示；不推进世界、打字或选项/章节演出。 */
  updateMenu(deltaMs: number): boolean {
    const menuBusy = this.#menu.update(deltaMs);
    const feedbackBusy = this.#dialogue.updateFeedback(deltaMs);
    return menuBusy || feedbackBusy;
  }

  #hasEffectWork(): boolean {
    return this.#world.needsUpdate || this.#dialogue.needsUpdate() || this.#menu.needsUpdate;
  }

  /** @wipe：黑色竖条自左向右扫过画面（转场仪式感） */
  wipe(durMs = 600): void {
    this.#world.wipe(durMs);
  }

  /* ============================ 演出扩展（@mov/@tint/@particle） ============================ */

  /** @mov：立绘位置平移（key 契约同 removePortrait：完整 `角色:服装` 精确；纯角色 ID 移动该角色全部立绘）。
   *  pos = left/center/right（三档预设）或裸数字（逻辑像素 X 坐标）；durMs 线性过渡。 */
  movePortrait(key: string, pos: string, durMs = 400): void {
    this.#world.movePortrait(key, pos, durMs);
  }

  /** @tint：画面调色叠加（全屏颜色叠加 alpha 线性过渡到目标；颜色通道同步过渡） */
  setTint(color: number, alpha: number, durMs = 400): void {
    this.#world.setTint(color, alpha, durMs);
  }

  /** @tint off：淡出调色叠加到全透明 */
  clearTint(durMs = 400): void {
    this.#world.clearTint(durMs);
  }

  /** @particle：启动预设粒子效果（snow/rain/sakura/sparkle/fireflies）。
   *  程序化实现（每粒子独立 Graphics，无纹理/Assets 依赖）；重复调用同名预设幂等，切换预设重建。 */
  startParticles(kind: string): void {
    this.#world.startParticles(kind);
  }

  /** @particle off：停止并清空粒子 */
  stopParticles(): void {
    this.#world.stopParticles();
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

  /** @video projection remains a legacy delegate; cancellation is owned by SystemPanelLayer. */
  hideVideo(): void {
    this.#system.hideVideo();
  }

  /** @video projection remains a legacy delegate; the layer owns DOM listeners and generations. */
  showVideo(src: string, onEnd: (failure?: Error) => void): void {
    this.#system.showVideo(src, onEnd);
  }

  /* ============================ 鉴赏覆盖层（CG/音乐） ============================ */

  /** 展示鉴赏界面；GalleryLayer owns the projection while this wrapper preserves legacy coordination. */
  showGallery(opts: {
    cgs: GalleryItemView[];
    music: GalleryItemView[];
    texts?: GalleryItemView[];
    endings?: GalleryItemView[];
    onPlayMusic?: (id: string, src?: string) => void;
    onReplayText?: (item: GalleryItemView) => void;
    onClose?: () => void;
  }): void {
    this.#requestFrame();
    this.#gallery.showGallery(opts);
  }

  /** 隐藏鉴赏界面；legacy API restores the command rail after the layer is hidden. */
  hideGallery(): void {
    this.#requestFrame();
    this.#gallery.hideGallery();
  }

  /* ============================ 设置面板 ============================ */

  /** 展示设置面板：◀ ▶ 步进各行；onChange 交宿主改值后应重新调用本方法刷新展示 */
  showSettings(rows: SettingsRowView[], onChange: (id: string, dir: -1 | 1) => void, onClose: () => void): void {
    this.#requestFrame();
    this.#menu.showSettings(rows, onChange, onClose);
  }

  /** 隐藏设置面板 */
  hideSettings(): void {
    this.#requestFrame();
    this.#menu.hideSettings();
  }

  /* ============================ 战斗覆盖层 ============================ */

  /** Legacy battle entry point; SystemPanelLayer owns the projection implementation. */
  showBattle(view: BattleView, handlers: BattleHandlers, message = ''): void {
    this.#system.showBattle(view, handlers, message);
  }

  /** Legacy battle hide delegate. */
  hideBattle(): void {
    this.#system.hideBattle();
  }

  /* ============================ 标题画面 / 系统菜单 / 存读档 / 大地图 ============================ */

  /** 展示标题画面；MenuLayer owns the projection, while this wrapper preserves legacy coordination. */
  showTitle(view: TitleView, onSelect: (id: string) => void): void {
    this.#requestFrame();
    this.#menu.showTitle(view, onSelect);
  }

  /** 隐藏标题画面；进入正文时默认恢复操作带，进入标题二级页时可保持操作带隐藏。 */
  hideTitle(restoreCommandRail = true): void {
    this.#requestFrame();
    this.#menu.hideTitle(restoreCommandRail);
  }

  /** 全黑结局卡；旧 API 的跨层隐藏顺序保持在兼容包装器。 */
  showEnding(text = '全篇完'): void {
    this.#requestFrame();
    this.#menu.showEnding(text);
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
  showSaveLoad(
    view: SaveLoadView,
    onSelect: SaveLoadSelectionHandler,
    onClose: () => void,
    options?: SaveLoadCommandOptions,
  ): void {
    this.#requestFrame();
    this.#menu.showSaveLoad(view, onSelect, onClose, options);
  }

  /** 隐藏存档/读档界面。 */
  hideSaveLoad(): void {
    this.#requestFrame();
    this.#menu.hideSaveLoad();
  }

  /** Legacy map entry point; SystemPanelLayer owns the projection implementation. */
  showMap(view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void): void {
    this.#system.showMap(view, onEnter, onEndTurn);
  }

  /** Legacy map hide delegate. */
  hideMap(): void {
    this.#system.hideMap();
  }

  /* ============================ 商店 ============================ */

  /** Legacy shop entry point; SystemPanelLayer owns the projection implementation. */
  showShop(
    view: { gold: number; items: { id: string; name: string; price: number }[]; message?: string },
    onBuy: (itemId: string) => void,
    onClose: () => void,
  ): void {
    this.#system.showShop({ ...view, items: view.items.slice() }, onBuy, onClose);
  }

  /** Legacy shop hide delegate. */
  hideShop(): void {
    this.#system.hideShop();
  }

  /* ============================ 据点指令（兰斯式 base commands） ============================ */

  /** Legacy base-command entry point; SystemPanelLayer owns the projection implementation. */
  showBaseCommands(view: BasePanelView, onExec: (cmdId: string) => void, onClose: () => void): void {
    this.#system.showBaseCommands(view, onExec, onClose);
  }

  /** Legacy base-command hide delegate. */
  hideBase(): void {
    this.#system.hideBaseCommands();
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
    this.#world.setFade(alpha);
  }

  fade(from: number, to: number, durationMs: number): void { this.#world.fade(from, to, durationMs); }
  isFadeActive(): boolean { return this.#world.isFadeActive(); }

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
    this.#system.reset();
    this.#world.reset({ preserveWorld });

    this.#gallery.reset();
    this.#menu.reset();
    this.#assetRegistry.reset({ clearAssets, preserveAssets: preserveWorld });

  }

  /**
   * 释放舞台资源（游戏退出/窗口销毁/热重置时由宿主调用）。
   * 程序化占位纹理由本舞台生成，destroy 安全；
   * registerBackground/registerPortrait 注入的纹理不在此销毁
   * （其生命周期归宿主/Pixi Assets 缓存管理，避免破坏宿主共享引用）——
   * setBackground/setPortrait 会把命中的注入纹理也放进占位缓存，故销毁前按注册表排除。
   */
  destroy(): void {
    this.#playerFocus?.destroy();
    this.#playerFocus = null;
    this.#loadingLayer.destroy();
    this.#menu.dispose();
    this.#dialogue.dispose();
    this.#gallery.dispose();
    this.#system.dispose();
    this.#world.dispose();
    this.#assetRegistry.dispose();
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.#frameRequest = null;
  }

  #requestFrame(): void {
    this.#frameRequest?.();
  }

  #restoreMenuRail<T extends readonly unknown[]>(callback: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      this.restoreCommandRail();
      callback(...args);
    };
  }
}
