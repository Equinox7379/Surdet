import type { BacklogEntry } from '../backlog.js';
import type { BattleView } from '../battle-view.js';
import type { GalleryItemView } from '../gallery.js';
import type { LoadingProgress } from '../loading-progress.js';
import type { PostProcessSettings } from '../post-process.js';
import type { PresentationPreferences } from '../presentation.js';
import type { RenderQuality } from '../quality.js';
import type { SettingsRowView } from '../settings-store.js';
import type { TimelineFrameEvent } from '../timeline-player.js';
import type {
  ChoiceOptionView,
  CommandRailItem,
  PortraitView,
  SpeakerProfile,
} from '../types.js';
import type { ShakeDirection, TransitionName } from '../world-effects-controller.js';
import type {
  BasePanelView,
  MapView,
  SaveLoadView,
  SystemMenuItemView,
  TitleView,
} from '../ui-views.js';
import type { BattleHandlers } from '../pixi-stage.js';

/** M1 intentionally accepts URL/path strings; Pixi objects remain an internal legacy detail. */
export type RendererAssetSource = string;
export type RendererFontRole = 'title' | 'body' | 'ui';

export interface AssetCommands {
  registerBackground(key: string, source: RendererAssetSource, format?: string): Promise<void>;
  registerPortrait(charId: string, costume: string, expression: string, source: RendererAssetSource, format?: string): Promise<void>;
  registerAvatar(key: string, source: RendererAssetSource, format?: string): Promise<void>;
  registerFontRole(role: RendererFontRole, url: string, family?: string, timeoutMs?: number): Promise<boolean>;
  registerFont(url: string, family?: string, timeoutMs?: number): Promise<boolean>;
  resetFonts(): void;
  resetFont(): void;
  releaseRegisteredAssetSources(): Promise<void>;
}

export interface WorldCommands {
  setBackground(key: string | null): void;
  setPortrait(key: string, view: PortraitView): void;
  removePortrait(key: string): void;
  setFade(alpha: number): void;
  shake(durationMs?: number, strength?: number, direction?: ShakeDirection): void;
  transition(name: TransitionName | string, durationMs: number): boolean;
  flash(durationMs?: number): void;
  zoom(scale?: number, durationMs?: number): void;
  wipe(durationMs?: number): void;
  movePortrait(key: string, pos: string, durationMs?: number): void;
  setTint(color: number, alpha: number, durationMs?: number): void;
  clearTint(durationMs?: number): void;
  startParticles(kind: string): void;
  stopParticles(): void;
  applyTimelineFrame(event: TimelineFrameEvent): void;
  setPortraitFocus(characterId: string | null): void;
}

export interface DialogueCommands {
  showText(speaker: string | null, value: string): void;
  showChoices(options: readonly ChoiceOptionView[]): void;
  hideChoices(): void;
  setAwaiting(awaiting: boolean): void;
  showBacklog(entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void, query?: string): void;
  hideBacklog(): void;
  setNvlMode(on: boolean): void;
  appendNvlText(speaker: string | null, text: string): void;
  clearNvlText(): void;
  showBanner(text: string, variant: 'chapter' | 'tip'): void;
  setChoiceHighlight(position: number): void;
  scrollBacklog(delta: number): void;
  hideInterface(hidden: boolean): void;
  setSpeakerProfiles(profiles: readonly SpeakerProfile[]): void;
  setActiveSpeaker(characterId: string | null): void;
  showCommandRail(items: readonly CommandRailItem[], onSelect: (id: string) => void): void;
  setCommandRailItems(items: readonly CommandRailItem[]): void;
  hideCommandRail(): void;
}

export interface MenuCommands {
  showTitle(view: TitleView, onSelect: (id: string) => void): void;
  hideTitle(restoreCommandRail?: boolean): void;
  showEnding(text?: string): void;
  hideEnding(): void;
  showSystemMenu(items: readonly SystemMenuItemView[], onSelect: (id: string) => void, onClose: () => void): void;
  hideSystemMenu(): void;
  showSettings(rows: readonly SettingsRowView[], onChange: (id: string, direction: -1 | 1) => void, onClose: () => void): void;
  hideSettings(): void;
  showSaveLoad(view: SaveLoadView, onSelect: (slotId: string) => void, onClose: () => void): void;
  hideSaveLoad(): void;
}

export interface GalleryCommands {
  showGallery(options: {
    cgs: readonly GalleryItemView[];
    music: readonly GalleryItemView[];
    texts?: readonly GalleryItemView[];
    onPlayMusic?: (id: string, source?: string) => void;
    onReplayText?: (item: GalleryItemView) => void;
    onClose?: () => void;
  }): void;
  hideGallery(): void;
}

export interface ShopView {
  gold: number;
  items: readonly { id: string; name: string; price: number }[];
  message?: string;
}

export interface SystemPanelCommands {
  showBattle(view: BattleView, handlers: BattleHandlers, message?: string): void;
  hideBattle(): void;
  showMap(view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void): void;
  hideMap(): void;
  showShop(view: ShopView, onBuy: (itemId: string) => void, onClose: () => void): void;
  hideShop(): void;
  showBaseCommands(view: BasePanelView, onExecute: (commandId: string) => void, onClose: () => void): void;
  hideBaseCommands(): void;
  showVideo(source: string, onEnd: () => void): void;
  hideVideo(): void;
}

export interface LoadingCommands {
  showLoading(progress: LoadingProgress): void;
  hideLoading(): void;
}

export interface PreferenceCommands {
  setQuality(quality: RenderQuality): void;
  setPresentationPreferences(preferences: Partial<PresentationPreferences>): void;
  setPostProcess(settings: Partial<PostProcessSettings>): void;
}

export interface PresentationCommands {
  validate(snapshot: unknown): void;
  restore(snapshot: unknown): void;
  clear(): void;
}

export interface RendererCommands {
  readonly assets: AssetCommands;
  readonly world: WorldCommands;
  readonly dialogue: DialogueCommands;
  readonly menu: MenuCommands;
  readonly gallery: GalleryCommands;
  readonly system: SystemPanelCommands;
  readonly loading: LoadingCommands;
  readonly preferences: PreferenceCommands;
  readonly presentation: PresentationCommands;
}
