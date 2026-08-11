import type { Application, Text as PixiText } from 'pixi.js';
import type { BattleHandlers, BattleView } from '../battle-view.js';
import type { BacklogEntry } from '../backlog.js';
import type { BasePanelView, MapView, SaveLoadView, SystemMenuItemView, TitleView } from '../ui-views.js';
import type { GalleryItemView } from '../gallery.js';
import type { SettingsRowView } from '../settings-store.js';
import type { TimelineFrameEvent } from '../timeline-player.js';
import type {
  AdvStage,
  ChoiceOptionView,
  CommandRailItem,
  FrameRequestHandler,
  PortraitView,
  SpeakerProfile,
} from '../types.js';
import type { RenderQuality } from '../quality.js';
import type { PresentationPreferences } from '../presentation.js';
import type { PostProcessSettings } from '../post-process.js';
import type { LoadingProgress } from '../loading-progress.js';
import type { ShakeDirection, TransitionName } from '../world-effects-controller.js';
import type { DialogueProjectionPort, GalleryProjectionPort, MenuProjectionPort, SystemPanelProjectionPort, WorldProjectionPort } from '../api/renderer-commands.js';
import type { RenderAssetRegistry, RenderAssetSource } from '../services/render-asset-registry.js';
import type { RenderLifecycle } from '../lifecycle/render-lifecycle.js';
import { RendererStageHost } from '../pixi-stage-host.js';

/**
 * @deprecated Internal Wave 2 compatibility adapter. Use RendererRuntime commands/queries.
 *
 * This class deliberately contains forwarding and historical callback wiring only. The
 * Pixi implementation and projection state live in RendererStageHost and the extracted
 * renderer layers.
 */
export class LegacyStageAdapter implements AdvStage {
  protected readonly host: RendererStageHost;

  constructor(host?: RendererStageHost, assetRegistry?: RenderAssetRegistry, lifecycle?: RenderLifecycle) {
    this.host = host ?? new RendererStageHost(assetRegistry, lifecycle);
  }

  get app(): Application | null { return this.host.app; }

  get onSelect(): ((index: number) => void) | null { return this.host.onSelect; }
  set onSelect(handler: ((index: number) => void) | null) { this.host.onSelect = handler; }
  get onBacklogClose(): (() => void) | null { return this.host.onBacklogClose; }
  set onBacklogClose(handler: (() => void) | null) { this.host.onBacklogClose = handler; }

  get dialogueLayer(): DialogueProjectionPort { return this.host.dialogueLayer; }
  get menuLayer(): MenuProjectionPort { return this.host.menuLayer; }
  get galleryLayer(): GalleryProjectionPort { return this.host.galleryLayer; }
  get systemPanelLayer(): SystemPanelProjectionPort { return this.host.systemPanelLayer; }
  get worldLayer(): WorldProjectionPort { return this.host.worldLayer; }

  init(canvas?: HTMLCanvasElement): Promise<void> { return this.host.init(canvas); }
  fitWindow(): void { this.host.fitWindow(); }
  setQuality(quality: RenderQuality): void { this.host.setQuality(quality); }
  getQuality(): RenderQuality { return this.host.getQuality(); }
  setPresentationPreferences(preferences: Partial<PresentationPreferences>): void { this.host.setPresentationPreferences(preferences); }
  getPresentationPreferences(): PresentationPreferences { return this.host.getPresentationPreferences(); }
  setPostProcess(settings: Partial<PostProcessSettings>): void { this.host.setPostProcess(settings); }
  getPostProcess(): PostProcessSettings { return this.host.getPostProcess(); }
  setFrameRequest(handler: FrameRequestHandler | null): void { this.host.setFrameRequest(handler); }

  registerBackground(key: string, source: RenderAssetSource, format?: string): Promise<void> { return this.host.registerBackground(key, source, format); }
  getFontFamily(role: 'title' | 'body' | 'ui'): string { return this.host.getFontFamily(role); }
  registerFontRole(role: 'title' | 'body' | 'ui', url: string, family?: string, timeoutMs?: number): Promise<boolean> {
    return this.host.registerFontRole(role, url, family, timeoutMs);
  }
  registerFont(url: string, family?: string, timeoutMs?: number): Promise<boolean> { return this.host.registerFont(url, family, timeoutMs); }
  resetFonts(): void { this.host.resetFonts(); }
  resetFont(): void { this.host.resetFont(); }
  registerPortrait(charId: string, costume: string, expression: string, source: RenderAssetSource, format?: string): Promise<void> {
    return this.host.registerPortrait(charId, costume, expression, source, format);
  }
  registerAvatar(key: string, source: RenderAssetSource, format?: string): Promise<void> { return this.host.registerAvatar(key, source, format); }
  releaseRegisteredAssetSources(): Promise<void> { return this.host.releaseRegisteredAssetSources(); }

  setSpeakerProfiles(profiles: SpeakerProfile[]): void { this.host.setSpeakerProfiles(profiles); }
  setActiveSpeaker(characterId: string | null): void {
    this.host.setActiveSpeaker(characterId);
    this.setPortraitFocus(this.host.dialogueLayer.activeSpeakerId);
  }
  setPortraitFocus(characterId: string | null): void { this.host.setPortraitFocus(characterId); }
  setBackground(key: string | null): void { this.host.setBackground(key); }
  setPortrait(key: string, opts: PortraitView): void { this.host.setPortrait(key, opts); }
  removePortrait(key: string): void { this.host.removePortrait(key); }
  showText(speaker: string | null, value: string): void {
    const before = this.host.dialogueLayer.projectionVersion;
    this.host.showText(speaker, value);
    if (this.host.dialogueLayer.projectionVersion !== before) {
      this.setPortraitFocus(this.host.dialogueLayer.activeSpeakerId);
    }
  }
  beginText(speaker: string | null): void {
    const before = this.host.dialogueLayer.projectionVersion;
    this.host.beginText(speaker);
    if (this.host.dialogueLayer.projectionVersion !== before) {
      this.setPortraitFocus(this.host.dialogueLayer.activeSpeakerId);
    }
  }
  clearText(): void { this.host.clearText(); }
  setAwaiting(awaiting: boolean): void { this.host.setAwaiting(awaiting); }
  needsUpdate(): boolean { return this.host.needsUpdate(); }
  updateContinuePulse(deltaMs: number): void { this.host.updateContinuePulse(deltaMs); }
  showBacklog(entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void, query?: string): void {
    this.host.showBacklog(entries, onReplayVoice, query);
  }
  hideInterface(hidden: boolean): void { this.host.hideInterface(hidden); }
  showCommandRail(items: CommandRailItem[], onSelect: (id: string) => void): void { this.host.showCommandRail(items, onSelect); }
  setCommandRailItems(items: CommandRailItem[]): void { this.host.setCommandRailItems(items); }
  hideCommandRail(): void { this.host.hideCommandRail(); }
  restoreCommandRail(): void { this.host.restoreCommandRail(); }
  scrollBacklog(delta: number): void { this.host.scrollBacklog(delta); }
  captureThumbnail(): string | null { return this.host.captureThumbnail(); }
  hideBacklog(): void { this.host.hideBacklog(); }

  applyTimelineFrame(event: TimelineFrameEvent): void { this.host.applyTimelineFrame(event); }
  snapshotPresentation(): unknown { return this.host.snapshotPresentation(); }
  validatePresentation(snapshot: unknown): void { this.host.validatePresentation(snapshot); }
  restorePresentation(snapshot: unknown): void { this.host.restorePresentation(snapshot); }
  clearPresentation(): void { this.host.clearPresentation(); }
  shake(durMs = 400, strength = 8, direction: ShakeDirection = 'both'): void { this.host.shake(durMs, strength, direction); }
  transition(name: TransitionName | string, durMs = 600): boolean { return this.host.transition(name, durMs); }
  flash(durMs = 300): void { this.host.flash(durMs); }
  zoom(scale = 1, durMs = 400): void { this.host.zoom(scale, durMs); }
  updateEffects(deltaMs: number): void { this.host.updateEffects(deltaMs); }
  wipe(durMs = 600): void { this.host.wipe(durMs); }
  movePortrait(key: string, pos: string, durMs = 400): void { this.host.movePortrait(key, pos, durMs); }
  setTint(color: number, alpha: number, durMs = 400): void { this.host.setTint(color, alpha, durMs); }
  clearTint(durMs = 400): void { this.host.clearTint(durMs); }
  startParticles(kind: string): void { this.host.startParticles(kind); }
  stopParticles(): void { this.host.stopParticles(); }
  showBanner(text: string, variant: 'chapter' | 'tip'): void { this.host.showBanner(text, variant); }
  setNvlMode(on: boolean): void { this.host.setNvlMode(on); }
  get nvlLines(): readonly PixiText[] { return this.host.nvlLines; }
  appendNvlText(speaker: string | null, text: string): void { this.host.appendNvlText(speaker, text); }
  clearNvlText(): void { this.host.clearNvlText(); }
  hideVideo(): void { this.host.hideVideo(); }
  showVideo(src: string, onEnd: () => void): void { this.host.showVideo(src, onEnd); }

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
    this.host.showGallery({
      ...opts,
      onClose: this.#restoreMenuRail(opts.onClose ?? (() => undefined)),
    });
  }
  hideGallery(): void {
    this.host.hideGallery();
    this.host.restoreCommandRail();
  }
  showSettings(rows: SettingsRowView[], onChange: (id: string, dir: -1 | 1) => void, onClose: () => void): void {
    this.hideSaveLoad();
    this.hideGallery();
    this.hideCommandRail();
    this.host.showSettings(rows, onChange, this.#restoreMenuRail(onClose));
  }
  hideSettings(): void {
    this.host.hideSettings();
    this.host.restoreCommandRail();
  }
  showBattle(view: BattleView, handlers: BattleHandlers, message = ''): void { this.host.showBattle(view, handlers, message); }
  hideBattle(): void { this.host.hideBattle(); }
  showTitle(view: TitleView, onSelect: (id: string) => void): void {
    this.hideEnding();
    this.hideCommandRail();
    this.host.showTitle(view, onSelect);
  }
  hideTitle(restoreCommandRail = true): void {
    this.host.hideTitle(restoreCommandRail);
    if (restoreCommandRail) this.host.restoreCommandRail();
    else this.hideCommandRail();
  }
  showEnding(text = 'THE END'): void {
    this.hideCommandRail();
    this.hideChoices();
    this.hideBacklog();
    this.hideGallery();
    this.hideSettings();
    this.hideSaveLoad();
    this.hideSystemMenu();
    this.hideTitle(false);
    this.host.showEnding(text);
    this.setFade(0);
  }
  hideEnding(): void { this.host.hideEnding(); }
  showSystemMenu(items: SystemMenuItemView[], onSelect: (id: string) => void, onClose: () => void): void {
    this.host.showSystemMenu(items, onSelect, onClose);
  }
  hideSystemMenu(): void { this.host.hideSystemMenu(); }
  showSaveLoad(view: SaveLoadView, onSelect: (slotId: string) => void, onClose: () => void): void {
    this.hideSettings();
    this.hideGallery();
    this.hideCommandRail();
    this.host.showSaveLoad(view, this.#restoreMenuRail(onSelect), this.#restoreMenuRail(onClose));
  }
  hideSaveLoad(): void {
    this.host.hideSaveLoad();
    this.host.restoreCommandRail();
  }
  showMap(view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void): void {
    this.host.showMap(view, onEnter, onEndTurn);
  }
  hideMap(): void { this.host.hideMap(); }
  showShop(
    view: { gold: number; items: { id: string; name: string; price: number }[]; message?: string },
    onBuy: (itemId: string) => void,
    onClose: () => void,
  ): void { this.host.showShop(view, onBuy, onClose); }
  hideShop(): void { this.host.hideShop(); }
  showBaseCommands(view: BasePanelView, onExec: (cmdId: string) => void, onClose: () => void): void {
    this.host.showBaseCommands(view, onExec, onClose);
  }
  hideBase(): void { this.host.hideBase(); }
  showChoices(options: ChoiceOptionView[]): void { this.host.showChoices(options); }
  setChoiceHighlight(pos: number): void { this.host.setChoiceHighlight(pos); }
  hideChoices(): void { this.host.hideChoices(); }
  setFade(alpha: number): void { this.host.setFade(alpha); }
  showLoading(progress: LoadingProgress): void { this.host.showLoading(progress); }
  hideLoading(): void { this.host.hideLoading(); }
  resetSession(options: { preserveWorld?: boolean; clearAssets?: boolean } = {}): void { this.host.resetSession(options); }
  destroy(): void { this.host.destroy(); }

  #restoreMenuRail<T extends readonly unknown[]>(callback: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      this.restoreCommandRail();
      callback(...args);
    };
  }
}
