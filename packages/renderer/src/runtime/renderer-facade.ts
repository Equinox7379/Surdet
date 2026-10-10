import type { PresentationRestoreResult, PresentationSnapshotContext } from '@surdet/core';
import type { BacklogEntry } from '../backlog.js';
import type { BattleHandlers, BattleView } from '../battle-view.js';
import type { GalleryItemView } from '../gallery.js';
import type { LoadingProgress } from '../loading-progress.js';
import type { PostProcessSettings } from '../post-process.js';
import type { PresentationPreferences } from '../presentation.js';
import type { RenderPerformanceMonitor, RenderPerformanceSnapshot } from '../performance.js';
import type { RenderQuality } from '../quality.js';
import type { RendererResourceSnapshot } from '../diagnostics/renderer-baseline.js';
import type { RenderLifecycleDiagnosticSnapshot } from '../lifecycle/render-lifecycle.js';
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
import { RendererCommandError, RendererError } from '../api/renderer-errors.js';
import type {
  AssetCommands,
  DialogueCommands,
  DialogueProjectionPort,
  GalleryCommands,
  GalleryProjectionPort,
  LoadingCommands,
  MenuCommands,
  MenuProjectionPort,
  PreferenceCommands,
  PresentationCommands,
  RendererCommands,
  RendererFontRole,
  SaveLoadCommandOptions,
  SaveLoadSelectionHandler,
  SaveLoadSelectionResult,
  ShopView,
  SystemPanelCommands,
  SystemPanelProjectionPort,
  WorldCommands,
  WorldProjectionPort,
} from '../api/renderer-commands.js';

function isPromiseLikeSaveLoadResult(value: SaveLoadSelectionResult): value is Promise<void | boolean> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
}
import type {
  DialogueQueries,
  GalleryOverlayState,
  MenuOverlayState,
  OverlayQueries,
  PreferenceQueries,
  PresentationQueries,
  RendererProjectionSnapshot,
  RendererDiagnosticQueries,
  RendererQueries,
  SystemPanelOverlayState,
  WorldQueries,
} from '../api/renderer-queries.js';
import type { PresentationController, ResetSessionOptions } from '../api/renderer-runtime.js';
import type { RenderAssetRegistry } from '../services/render-asset-registry.js';
import { fontTextDiagnostics } from '../reading-diagnostics.js';
import type { PresentationStage } from './presentation-ports.js';
import { createRendererTheme, type RendererTheme, type RendererThemeOverrides } from '../theme.js';

/** @internal Independent narrow stage port; legacy public types do not cross this boundary. */
export interface RendererStagePort extends PresentationStage {
  fitWindow?: () => void;
  destroy: () => void;
  onSelect?: ((index: number) => void) | null;
  onBacklogClose?: (() => void) | null;
  resetSession?: (options?: ResetSessionOptions) => void;
  updateContinuePulse?: (deltaMs: number) => void;
  updateEffects?: (deltaMs: number) => void;
  showGallery?: (options: {
    cgs: GalleryItemView[];
    music: GalleryItemView[];
    texts?: GalleryItemView[];
    endings?: GalleryItemView[];
    profiles?: GalleryItemView[];
    terms?: GalleryItemView[];
    onPlayMusic?: (id: string, source?: string) => void;
    onReplayText?: (item: GalleryItemView) => void;
    onClose?: () => void;
  }) => void;
  hideGallery?: () => void;
  showSettings?: (rows: SettingsRowView[], onChange: (id: string, direction: -1 | 1) => void, onClose: () => void) => void;
  hideSettings?: () => void;
  showBattle?: (view: BattleView, handlers: BattleHandlers, message?: string) => void;
  hideBattle?: () => void;
  showTitle?: (view: TitleView, onSelect: (id: string) => void) => void;
  hideTitle?: (restoreCommandRail?: boolean) => void;
  showEnding?: (text?: string) => void;
  hideEnding?: () => void;
  showSystemMenu?: (items: SystemMenuItemView[], onSelect: (id: string) => void, onClose: () => void) => void;
  hideSystemMenu?: () => void;
  showSaveLoad?: (
    view: SaveLoadView,
    onSelect: SaveLoadSelectionHandler,
    onClose: () => void,
    options?: SaveLoadCommandOptions,
  ) => void;
  hideSaveLoad?: () => void;
  /** @internal Facade-owned compatibility bridge for restoring the dialogue rail after an overlay closes. */
  restoreCommandRail?: () => void;
  showMap?: (view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void) => void;
  hideMap?: () => void;
  showShop?: (view: { gold: number; items: { id: string; name: string; price: number }[]; message?: string }, onBuy: (itemId: string) => void, onClose: () => void) => void;
  hideShop?: () => void;
  showBaseCommands?: (view: BasePanelView, onExecute: (commandId: string) => void, onClose: () => void) => void;
  hideBase?: () => void;
  captureThumbnail?: () => string | null;
  showLoading?: (progress: LoadingProgress) => void;
  hideLoading?: () => void;
  getPerformanceSnapshot?: () => RenderPerformanceSnapshot | null;
  needsUpdate?: () => boolean;
  snapshotPresentation?: () => unknown;
  restorePresentation?: (snapshot: unknown) => void;
  clearPresentation?: () => void;
  setTheme?: (theme: RendererTheme) => void;
  setReadingPreferences?: RendererCommands['preferences']['setReadingPreferences'];
  setDeclarativeUiSuppression?: (pages: Partial<Record<import('@surdet/core').ProjectUiPageId, boolean>>) => void;
}

/** @internal Controller port with the old snapshot methods kept behind the facade. */
export interface RendererControllerPort extends Omit<PresentationController, 'snapshotPresentation' | 'restorePresentation' | 'clearPresentation' | 'backlogEntries' | 'backlogSearchQuery'> {
  /** @internal True when the controller's presentation transaction also projects the stage. */
  presentationOwnsStage?: boolean;
  snapshotPresentation?: (context?: PresentationSnapshotContext) => unknown;
  restorePresentation?: (snapshot: unknown) => PresentationRestoreResult | void;
  /** @internal Clear only Controller-owned presentation timelines. */
  clearPresentation?: () => void;
  backlogEntries?: () => readonly BacklogEntry[];
  backlogSearchQuery?: () => string;
}

export interface RendererFacadeOptions {
  stage: RendererStagePort;
  controller: RendererControllerPort;
  monitor: RenderPerformanceMonitor;
  resourceSnapshot?: () => RendererResourceSnapshot;
  resourceLedger?: () => RenderLifecycleDiagnosticSnapshot;
  assetRegistry?: RenderAssetRegistry;
  /** M3 public dialogue projection port; concrete Layer details stay behind it. */
  dialogueLayer?: DialogueProjectionPort;
  /** M4 public menu projection port; concrete Layer details stay behind it. */
  menuLayer?: MenuProjectionPort;
  /** M5 public gallery projection port; concrete Layer details stay behind it. */
  galleryLayer?: GalleryProjectionPort;
  /** M6 public system-panel projection port; concrete Layer details stay behind it. */
  systemPanelLayer?: SystemPanelProjectionPort;
  /** M7 public World projection port; concrete Layer details stay behind it. */
  worldLayer?: WorldProjectionPort;
  /** Composition-root read model; returns plain semantic data, never a Layer. */
  projectionSnapshot?: () => RendererProjectionSnapshot;
}

const EMPTY_RESOURCE_SNAPSHOT = (disposed: boolean): RendererResourceSnapshot => ({
  disposed,
  tickerCallbacks: null,
  listeners: null,
  activeTweens: null,
  activeAsyncTasks: null,
  blobUrls: null,
  pooledObjects: {},
  displayObjectsByOwner: {},
});

const EMPTY_PROJECTION_SNAPSHOT: RendererProjectionSnapshot = {
  dialogue: null,
  menu: null,
  gallery: null,
  system: null,
  world: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneOpaque(value: unknown): unknown {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // A legacy opaque payload may contain a non-cloneable value; use the safe recursive fallback.
    }
  }
  if (Array.isArray(value)) return value.map((item) => cloneOpaque(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneOpaque(item)]));
  }
  return value;
}

function freezePlainClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) freezePlainClone(item);
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) freezePlainClone(item);
    return Object.freeze(value);
  }
  return value;
}

function cloneAndFreezePlainData(value: unknown): unknown {
  return freezePlainClone(cloneOpaque(value));
}

function cloneResourceSnapshot(snapshot: RendererResourceSnapshot, disposed: boolean): RendererResourceSnapshot {
  return {
    ...snapshot,
    disposed: disposed || snapshot.disposed,
    pooledObjects: { ...snapshot.pooledObjects },
    displayObjectsByOwner: { ...snapshot.displayObjectsByOwner },
  };
}

function cloneResourceLedger(snapshot: RenderLifecycleDiagnosticSnapshot): RenderLifecycleDiagnosticSnapshot {
  return cloneAndFreezePlainData(snapshot) as RenderLifecycleDiagnosticSnapshot;
}

/**
 * M1 compatibility facade. Every public command delegates to exactly one existing
 * Stage operation; no Pixi display object or legacy implementation is copied here.
 */
export class RendererFacade {
  readonly commands: RendererCommands;
  readonly queries: RendererQueries;

  #stage: RendererStagePort;
  #controller: RendererControllerPort;
  #monitor: RenderPerformanceMonitor;
  #resourceSnapshot?: () => RendererResourceSnapshot;
  #resourceLedger?: () => RenderLifecycleDiagnosticSnapshot;
  #assetRegistry?: RenderAssetRegistry;
  #dialoguePort?: DialogueProjectionPort;
  #menuPort?: MenuProjectionPort;
  #galleryPort?: GalleryProjectionPort;
  #systemPort?: SystemPanelProjectionPort;
  #worldPort?: WorldProjectionPort;
  #projectionSnapshot?: () => RendererProjectionSnapshot;
  #theme: RendererTheme = createRendererTheme();
  #disposed = false;
  #saveLoadTransactionPending = false;
  #menuOverlay: MenuOverlayState = { type: 'none' };
  #galleryOverlay: GalleryOverlayState = { type: 'none' };
  #systemOverlay: SystemPanelOverlayState = { type: 'none' };

  constructor(options: RendererFacadeOptions) {
    this.#stage = options.stage;
    this.#controller = options.controller;
    this.#monitor = options.monitor;
    this.#resourceSnapshot = options.resourceSnapshot;
    this.#resourceLedger = options.resourceLedger;
    this.#assetRegistry = options.assetRegistry;
    this.#dialoguePort = options.dialogueLayer;
    this.#menuPort = options.menuLayer;
    this.#galleryPort = options.galleryLayer;
    this.#systemPort = options.systemPanelLayer;
    this.#worldPort = options.worldLayer;
    this.#projectionSnapshot = options.projectionSnapshot;

    const assets: AssetCommands = {
      registerRule: async (key, source, format) => {
        this.#ensureActive('assets', 'registerRule');
        if (this.#assetRegistry) await this.#assetRegistry.registerRule(key, source, format);
        else if (this.#stage.registerRule) await this.#stage.registerRule(key, source, format);
        else this.#missing('assets', 'registerRule');
      },
      registerVideo: async (key, source, sourcePath) => {
        this.#ensureActive('assets', 'registerVideo');
        if (!this.#assetRegistry) this.#missing('assets', 'registerVideo');
        await this.#assetRegistry.registerVideo(key, source, sourcePath);
      },
      registerBackground: async (key, source, format) => {
        this.#ensureActive('assets', 'registerBackground');
        if (this.#assetRegistry) {
          await this.#assetRegistry.registerBackground(key, source, format);
          return;
        }
        const method = this.#stage.registerBackground;
        if (!method) this.#missing('assets', 'registerBackground');
        await method.call(this.#stage, key, source, format);
      },
      registerPortrait: async (charId, costume, expression, source, format, sourcePath) => {
        this.#ensureActive('assets', 'registerPortrait');
        if (this.#assetRegistry) {
          await this.#assetRegistry.registerPortrait(charId, costume, expression, source, format, sourcePath);
          return;
        }
        const method = this.#stage.registerPortrait;
        if (!method) this.#missing('assets', 'registerPortrait');
        await method.call(this.#stage, charId, costume, expression, source, format, sourcePath);
      },
      registerPortraitVisual: async (charId, costume, expression, definition, sources) => {
        this.#ensureActive('assets', 'registerPortraitVisual');
        if (!this.#assetRegistry) this.#missing('assets', 'registerPortraitVisual');
        await this.#assetRegistry.registerPortraitVisual(charId, costume, expression, definition, sources);
      },
      registerAvatar: async (key, source, format) => {
        this.#ensureActive('assets', 'registerAvatar');
        if (this.#assetRegistry) {
          await this.#assetRegistry.registerAvatar(key, source, format);
          return;
        }
        const method = this.#stage.registerAvatar;
        if (!method) this.#missing('assets', 'registerAvatar');
        await method.call(this.#stage, key, source, format);
      },
      registerFontRole: async (role, url, family, timeoutMs) => {
        this.#ensureActive('assets', 'registerFontRole');
        const method = this.#stage.registerFontRole;
        if (!method) this.#missing('assets', 'registerFontRole');
        return method.call(this.#stage, role, url, family, timeoutMs);
      },
      registerFont: async (url, family, timeoutMs) => {
        this.#ensureActive('assets', 'registerFont');
        const method = this.#stage.registerFont;
        if (!method) this.#missing('assets', 'registerFont');
        return method.call(this.#stage, url, family, timeoutMs);
      },
      resetFonts: () => {
        this.#ensureActive('assets', 'resetFonts');
        const method = this.#stage.resetFonts;
        if (!method) this.#missing('assets', 'resetFonts');
        method.call(this.#stage);
      },
      resetFont: () => {
        this.#ensureActive('assets', 'resetFont');
        const method = this.#stage.resetFont;
        if (!method) this.#missing('assets', 'resetFont');
        method.call(this.#stage);
      },
      releaseRegisteredAssetSources: async () => {
        this.#ensureActive('assets', 'releaseRegisteredAssetSources');
        if (this.#assetRegistry) {
          await this.#assetRegistry.releaseRegisteredAssetSources();
          return;
        }
        const method = this.#stage.releaseRegisteredAssetSources;
        if (!method) this.#missing('assets', 'releaseRegisteredAssetSources');
        await method.call(this.#stage);
      },
    };

    const world: WorldCommands = {
      setStoryFilter: this.#worldPort?.setStoryFilter || this.#stage.setStoryFilter
        ? (name, durationMs) => this.#callWorld('setStoryFilter', this.#worldPort?.setStoryFilter, this.#stage.setStoryFilter, name, durationMs) : undefined,
      markStageBoundary: this.#worldPort?.markStageBoundary || this.#stage.markStageBoundary
        ? () => this.#callWorld('markStageBoundary', this.#worldPort?.markStageBoundary, this.#stage.markStageBoundary) : undefined,
      applyStage: (command) => this.#callWorld('applyStage', this.#worldPort?.applyStage, this.#stage.applyStage, command),
      setBackground: (key) => this.#callWorld('setBackground', this.#worldPort?.setBackground, this.#stage.setBackground, key),
      setPortrait: (key, view) => this.#callWorld('setPortrait', this.#worldPort?.setPortrait, this.#stage.setPortrait, key, view),
      removePortrait: (key) => this.#callWorld('removePortrait', this.#worldPort?.removePortrait, this.#stage.removePortrait, key),
      setFade: (alpha) => this.#callWorld('setFade', this.#worldPort?.setFade, this.#stage.setFade, alpha),
      fade: this.#worldPort?.fade || this.#stage.fade ? (from, to, durationMs) => this.#callWorld('fade', this.#worldPort?.fade, this.#stage.fade, from, to, durationMs) : undefined,
      shake: (durationMs = 400, strength = 8, direction = 'both') => this.#callWorld('shake', this.#worldPort?.shake, this.#stage.shake, durationMs, strength, direction),
      transition: (name, durationMs, rule) => this.#callWorld('transition', this.#worldPort?.transition, this.#stage.transition, name, durationMs, rule),
      flash: (durationMs = 300) => this.#callWorld('flash', this.#worldPort?.flash, this.#stage.flash, durationMs),
      zoom: (scale = 1, durationMs = 400) => this.#callWorld('zoom', this.#worldPort?.zoom, this.#stage.zoom, scale, durationMs),
      wipe: (durationMs = 600) => this.#callWorld('wipe', this.#worldPort?.wipe, this.#stage.wipe, durationMs),
      movePortrait: (key, pos, durationMs = 400) => this.#callWorld('movePortrait', this.#worldPort?.movePortrait, this.#stage.movePortrait, key, pos, durationMs),
      setTint: (color, alpha, durationMs = 400) => this.#callWorld('setTint', this.#worldPort?.setTint, this.#stage.setTint, color, alpha, durationMs),
      clearTint: (durationMs = 400) => this.#callWorld('clearTint', this.#worldPort?.clearTint, this.#stage.clearTint, durationMs),
      startParticles: (kind) => this.#callWorld('startParticles', this.#worldPort?.startParticles, this.#stage.startParticles, kind),
      stopParticles: () => this.#callWorld('stopParticles', this.#worldPort?.stopParticles, this.#stage.stopParticles),
      applyTimelineFrame: (event) => this.#callWorld('applyTimelineFrame', this.#worldPort?.applyTimelineFrame, this.#stage.applyTimelineFrame, event),
      setPortraitFocus: (characterId) => this.#callWorld('setPortraitFocus', this.#worldPort?.setPortraitFocus, this.#stage.setPortraitFocus, characterId),
      setPortraitSpeaking: (speaking) => { this.#ensureActive('world', 'setPortraitSpeaking'); if (this.#worldPort) this.#worldPort.setPortraitSpeaking?.(speaking); else this.#stage.setPortraitSpeaking?.(speaking); },
      setPortraitSkipping: (skipping) => { this.#ensureActive('world', 'setPortraitSkipping'); if (this.#worldPort) this.#worldPort.setPortraitSkipping?.(skipping); else this.#stage.setPortraitSkipping?.(skipping); },
    };

    const dialogue: DialogueCommands = {
      showText: (speaker, value, visibleUnits) => {
        if (!this.#dialoguePort) {
          this.#callDialogue('showText', undefined, this.#stage.showText, speaker, value, visibleUnits);
          return;
        }
        const before = this.#dialoguePort.projectionVersion;
        this.#callDialogue('showText', this.#dialoguePort.showText, this.#stage.showText, speaker, value, visibleUnits);
        if (this.#dialoguePort.projectionVersion !== before) {
          this.#coordinateWorldFocus(this.#dialoguePort.activeSpeakerId);
        }
      },
      beginText: (speaker, value = '', visibleUnits) => {
        if (!this.#dialoguePort) {
          if (this.#stage.beginText) this.#callDialogue('beginText', undefined, this.#stage.beginText, speaker, value, visibleUnits);
          else this.#callDialogue('beginText', undefined, this.#stage.showText, speaker, value, visibleUnits);
          return;
        }
        const before = this.#dialoguePort.projectionVersion;
        if (this.#dialoguePort.beginText) {
          this.#callDialogue('beginText', this.#dialoguePort.beginText, this.#stage.beginText, speaker, value, visibleUnits);
        } else {
          this.#callDialogue('beginText', this.#dialoguePort.showText, this.#stage.showText, speaker, value, visibleUnits);
        }
        if (this.#dialoguePort.projectionVersion !== before) {
          this.#coordinateWorldFocus(this.#dialoguePort.activeSpeakerId);
        }
      },
      clearText: () => {
        if (!this.#dialoguePort) {
          if (this.#stage.clearText) this.#callDialogue('clearText', undefined, this.#stage.clearText);
          else this.#callDialogue('clearText', undefined, this.#stage.showText, null, '');
          return;
        }
        const before = this.#dialoguePort.projectionVersion;
        if (this.#dialoguePort.clearText) {
          this.#callDialogue('clearText', this.#dialoguePort.clearText, this.#stage.clearText);
        } else {
          this.#callDialogue('clearText', this.#dialoguePort.showText, this.#stage.showText, null, '');
        }
        if (this.#dialoguePort.projectionVersion !== before) this.#coordinateWorldFocus(this.#dialoguePort.activeSpeakerId);
      },
      showChoices: (options) => this.#callDialogue('showChoices', this.#dialoguePort?.showChoices, this.#stage.showChoices, options.slice()),
      hideChoices: () => this.#callDialogue('hideChoices', this.#dialoguePort?.hideChoices, this.#stage.hideChoices),
      setAwaiting: (awaiting) => this.#callDialogue('setAwaiting', this.#dialoguePort?.setAwaiting, this.#stage.setAwaiting, awaiting),
      showBacklog: (entries, onReplayVoice, query) => this.#callDialogue('showBacklog', this.#dialoguePort?.showBacklog, this.#stage.showBacklog, entries.map((entry) => ({ ...entry })), onReplayVoice, query),
      hideBacklog: () => this.#callDialogue('hideBacklog', this.#dialoguePort?.hideBacklog, this.#stage.hideBacklog),
      setNvlMode: (on) => this.#callDialogue('setNvlMode', this.#dialoguePort?.setNvlMode, this.#stage.setNvlMode, on),
      setTextSkipping: (skipping) => this.#callDialogue('setTextSkipping', this.#dialoguePort?.setTextSkipping, this.#stage.setTextSkipping, skipping),
      appendNvlText: (speaker, text, markup) => {
        const before = this.#dialoguePort?.projectionVersion;
        this.#callDialogue('appendNvlText', this.#dialoguePort?.appendNvlText, this.#stage.appendNvlText, speaker, text, markup);
        if (this.#dialoguePort && this.#dialoguePort.projectionVersion !== before) this.#coordinateWorldFocus(this.#dialoguePort.activeSpeakerId);
      },
      clearNvlText: () => {
        const before = this.#dialoguePort?.projectionVersion;
        this.#callDialogue('clearNvlText', this.#dialoguePort?.clearNvlText, this.#stage.clearNvlText);
        if (this.#dialoguePort && this.#dialoguePort.projectionVersion !== before) this.#coordinateWorldFocus(this.#dialoguePort.activeSpeakerId);
      },
      showBanner: (text, variant) => this.#callDialogue('showBanner', this.#dialoguePort?.showBanner, this.#stage.showBanner, text, variant),
      setChoiceHighlight: (position) => this.#callDialogue('setChoiceHighlight', this.#dialoguePort?.setChoiceHighlight, this.#stage.setChoiceHighlight, position),
      scrollBacklog: (delta) => this.#callDialogue('scrollBacklog', this.#dialoguePort?.scrollBacklog, this.#stage.scrollBacklog, delta),
      hideInterface: (hidden) => this.#callDialogue('hideInterface', this.#dialoguePort?.hideInterface, this.#stage.hideInterface, hidden),
      setSpeakerProfiles: (profiles) => this.#callDialogue('setSpeakerProfiles', this.#dialoguePort?.setSpeakerProfiles, this.#stage.setSpeakerProfiles, profiles.slice()),
      setActiveSpeaker: (characterId) => {
        if (!this.#dialoguePort) {
          this.#callDialogue('setActiveSpeaker', undefined, this.#stage.setActiveSpeaker, characterId);
          return;
        }
        this.#callDialogue('setActiveSpeaker', this.#dialoguePort.setActiveSpeaker, this.#stage.setActiveSpeaker, characterId);
        this.#coordinateWorldFocus(this.#dialoguePort.activeSpeakerId);
      },
      showCommandRail: (items, onSelect) => this.#callDialogue('showCommandRail', this.#dialoguePort?.showCommandRail, this.#stage.showCommandRail, items.slice(), onSelect),
      setCommandRailItems: (items) => this.#callDialogue('setCommandRailItems', this.#dialoguePort?.setCommandRailItems, this.#stage.setCommandRailItems, items.slice()),
      hideCommandRail: () => this.#callDialogue('hideCommandRail', this.#dialoguePort?.hideCommandRail, this.#stage.hideCommandRail),
      restoreCommandRail: () => this.#callDialogue('restoreCommandRail', this.#dialoguePort?.restoreCommandRail, this.#stage.restoreCommandRail),
    };

    const menu: MenuCommands = {
      showTitle: (view, onSelect) => {
        if (this.#menuPort) {
          this.#callMenu('hideEnding', this.#menuPort.hideEnding);
          this.#callDialogue('hideCommandRail', this.#dialoguePort?.hideCommandRail, this.#stage.hideCommandRail);
          this.#callMenu('showTitle', this.#menuPort.showTitle, { ...view, items: view.items.slice() }, onSelect);
          this.#syncMenuOverlay();
          return;
        }
        this.#callStage('menu', 'showTitle', this.#stage.showTitle, { ...view, items: view.items.slice() }, onSelect);
        this.#menuOverlay = { type: 'title' };
      },
      hideTitle: (restoreCommandRail) => {
        if (this.#menuPort) {
          this.#callMenu('hideTitle', this.#menuPort.hideTitle, restoreCommandRail);
          if (restoreCommandRail !== false) this.#stage.restoreCommandRail?.();
          this.#syncMenuOverlay();
          return;
        }
        this.#callStage('menu', 'hideTitle', this.#stage.hideTitle, restoreCommandRail);
        this.#clearMenu('title');
      },
      showEnding: (text) => {
        if (this.#menuPort) {
          this.#callDialogue('hideCommandRail', this.#dialoguePort?.hideCommandRail, this.#stage.hideCommandRail);
          this.#callDialogue('hideChoices', this.#dialoguePort?.hideChoices, this.#stage.hideChoices);
          this.#callDialogue('hideBacklog', this.#dialoguePort?.hideBacklog, this.#stage.hideBacklog);
          this.#hideGalleryProjection();
          this.#callMenu('hideSettings', this.#menuPort.hideSettings);
          this.#callMenu('hideSaveLoad', this.#menuPort.hideSaveLoad);
          this.#callMenu('hideSystemMenu', this.#menuPort.hideSystemMenu);
          this.#callMenu('hideTitle', this.#menuPort.hideTitle, false);
          this.#callMenu('showEnding', this.#menuPort.showEnding, text);
          this.#callWorld('setFade', this.#worldPort?.setFade, this.#stage.setFade, 0);
          this.#syncMenuOverlay();
          return;
        }
        this.#callStage('menu', 'showEnding', this.#stage.showEnding, text);
        this.#menuOverlay = { type: 'ending' };
      },
      hideEnding: () => {
        if (this.#menuPort) {
          this.#callMenu('hideEnding', this.#menuPort.hideEnding);
          this.#syncMenuOverlay();
          return;
        }
        this.#callStage('menu', 'hideEnding', this.#stage.hideEnding);
        this.#clearMenu('ending');
      },
      showSystemMenu: (items, onSelect, onClose) => {
        if (this.#menuPort) {
          this.#callMenu('showSystemMenu', this.#menuPort.showSystemMenu, items.slice(), onSelect, onClose);
          this.#syncMenuOverlay();
          return;
        }
        this.#callStage('menu', 'showSystemMenu', this.#stage.showSystemMenu, items.slice(), onSelect, onClose);
        this.#menuOverlay = { type: 'system-menu' };
      },
      hideSystemMenu: () => {
        if (this.#menuPort) {
          this.#callMenu('hideSystemMenu', this.#menuPort.hideSystemMenu);
          this.#syncMenuOverlay();
          return;
        }
        this.#callStage('menu', 'hideSystemMenu', this.#stage.hideSystemMenu);
        this.#clearMenu('system-menu');
      },
      showSettings: (rows, onChange, onClose) => {
        if (this.#menuPort) {
          this.#callMenu('hideSaveLoad', this.#menuPort.hideSaveLoad);
          this.#hideGalleryProjection();
          this.#callDialogue('hideCommandRail', this.#dialoguePort?.hideCommandRail, this.#stage.hideCommandRail);
          this.#callMenu(
            'showSettings',
            this.#menuPort.showSettings,
            rows.slice(),
            onChange,
            this.#wrapMenuRailRestore(onClose),
          );
          this.#syncMenuOverlay();
          return;
        }
        this.#callStage('menu', 'showSettings', this.#stage.showSettings, rows.slice(), onChange, onClose);
        this.#menuOverlay = { type: 'settings' };
      },
      hideSettings: () => {
        if (this.#menuPort) {
          this.#callMenu('hideSettings', this.#menuPort.hideSettings);
          this.#stage.restoreCommandRail?.();
          this.#syncMenuOverlay();
          return;
        }
        this.#callStage('menu', 'hideSettings', this.#stage.hideSettings);
        this.#clearMenu('settings');
      },
      showSaveLoad: (view, onSelect, onClose, options) => {
        if (this.#menuPort) {
          this.#saveLoadTransactionPending = false;
          const menuOptions = options?.onRestore
            ? { ...options, onRestore: this.#wrapSaveLoadSelect(options.onRestore, options) }
            : options;
          const close = options?.completion === 'host-transaction'
            ? onClose
            : this.#wrapMenuRailRestore(onClose);
          this.#callMenu('hideSettings', this.#menuPort.hideSettings);
          this.#hideGalleryProjection();
          this.#callDialogue('hideCommandRail', this.#dialoguePort?.hideCommandRail, this.#stage.hideCommandRail);
          this.#callMenu(
            'showSaveLoad',
            this.#menuPort.showSaveLoad,
            { ...view, slots: view.slots.slice() },
            this.#wrapSaveLoadSelect(onSelect, menuOptions),
            close,
            menuOptions,
          );
          this.#syncMenuOverlay();
          return;
        }
        const menuOptions = options?.onRestore
          ? { ...options, onRestore: this.#wrapSaveLoadSelect(options.onRestore, options) }
          : options;
        const selection = options?.completion === 'host-transaction'
          ? this.#wrapSaveLoadSelect(onSelect, options)
          : onSelect;
        this.#callStage(
          'menu',
          'showSaveLoad',
          this.#stage.showSaveLoad,
          { ...view, slots: view.slots.slice() },
          selection,
          onClose,
          menuOptions,
        );
        this.#menuOverlay = { type: 'save-load', mode: view.mode };
      },
      hideSaveLoad: () => {
        if (this.#menuPort) {
          const transactionPending = this.#saveLoadTransactionPending;
          this.#callMenu('hideSaveLoad', this.#menuPort.hideSaveLoad);
          if (!transactionPending) this.#stage.restoreCommandRail?.();
          this.#syncMenuOverlay();
          return;
        }
        this.#callStage('menu', 'hideSaveLoad', this.#stage.hideSaveLoad);
        this.#clearMenu('save-load');
      },
    };

    const gallery: GalleryCommands = {
      showGallery: (options) => {
        const view = {
          cgs: options.cgs.map((item) => ({ ...item })),
          music: options.music.map((item) => ({ ...item })),
          texts: options.texts?.map((item) => ({ ...item })),
          endings: options.endings?.map((item) => ({ ...item })),
          profiles: options.profiles?.map((item) => ({ ...item })),
          terms: options.terms?.map((item) => ({ ...item })),
          onPlayMusic: options.onPlayMusic,
          onReplayText: options.onReplayText,
          onClose: options.onClose,
        };
        if (this.#galleryPort) {
          if (this.#menuPort) {
            this.#callMenu('hideSettings', this.#menuPort.hideSettings);
            this.#callMenu('hideSaveLoad', this.#menuPort.hideSaveLoad);
          } else {
            this.#stage.hideSettings?.();
            this.#stage.hideSaveLoad?.();
          }
          this.#callDialogue('hideCommandRail', this.#dialoguePort?.hideCommandRail, this.#stage.hideCommandRail);
          this.#callGallery('showGallery', this.#galleryPort.showGallery, {
            ...view,
            onClose: this.#wrapGalleryClose(options.onClose),
          });
          this.#syncGalleryOverlay();
          return;
        }
        this.#callStage('gallery', 'showGallery', this.#stage.showGallery, {
          ...view,
          onClose: this.#wrapLegacyGalleryClose(options.onClose),
        });
        this.#galleryOverlay = { type: 'gallery', tab: 'cg', mode: 'grid', viewerKey: null };
      },
      hideGallery: () => {
        if (this.#galleryPort) {
          this.#callGallery('hideGallery', this.#galleryPort.hideGallery);
          this.#stage.restoreCommandRail?.();
          this.#syncGalleryOverlay();
          return;
        }
        this.#callStage('gallery', 'hideGallery', this.#stage.hideGallery);
        this.#galleryOverlay = { type: 'none' };
      },
    };

    const system: SystemPanelCommands = {
      showBattle: (view, handlers, message) => {
        if (this.#systemPort) {
          this.#callSystem('showBattle', this.#systemPort.showBattle, view, handlers, message);
          this.#syncSystemOverlay();
          return;
        }
        this.#callStage('system', 'showBattle', this.#stage.showBattle, view, handlers, message);
        this.#systemOverlay = { type: 'battle' };
      },
      hideBattle: () => {
        if (this.#systemPort) {
          this.#callSystem('hideBattle', this.#systemPort.hideBattle);
          this.#syncSystemOverlay();
          return;
        }
        this.#callStage('system', 'hideBattle', this.#stage.hideBattle);
        this.#systemOverlay = { type: 'none' };
      },
      showMap: (view, onEnter, onEndTurn) => {
        if (this.#systemPort) {
          this.#callSystem('showMap', this.#systemPort.showMap, view, this.#wrapSystemCallback(onEnter), this.#wrapSystemCallback(onEndTurn));
          this.#syncSystemOverlay();
          return;
        }
        this.#callStage('system', 'showMap', this.#stage.showMap, view, this.#wrapLegacySystemCallback(onEnter), this.#wrapLegacySystemCallback(onEndTurn));
        this.#systemOverlay = { type: 'map' };
      },
      hideMap: () => {
        if (this.#systemPort) {
          this.#callSystem('hideMap', this.#systemPort.hideMap);
          this.#syncSystemOverlay();
          return;
        }
        this.#callStage('system', 'hideMap', this.#stage.hideMap);
        this.#systemOverlay = { type: 'none' };
      },
      showShop: (view, onBuy, onClose) => {
        const copy = { ...view, items: view.items.map((item) => ({ ...item })) };
        if (this.#systemPort) {
          this.#callSystem('showShop', this.#systemPort.showShop, copy, onBuy, this.#wrapSystemCallback(onClose));
          this.#syncSystemOverlay();
          return;
        }
        this.#callStage('system', 'showShop', this.#stage.showShop, copy, onBuy, this.#wrapLegacySystemCallback(onClose));
        this.#systemOverlay = { type: 'shop' };
      },
      hideShop: () => {
        if (this.#systemPort) {
          this.#callSystem('hideShop', this.#systemPort.hideShop);
          this.#syncSystemOverlay();
          return;
        }
        this.#callStage('system', 'hideShop', this.#stage.hideShop);
        this.#systemOverlay = { type: 'none' };
      },
      showBaseCommands: (view, onExecute, onClose) => {
        if (this.#systemPort) {
          this.#callSystem('showBaseCommands', this.#systemPort.showBaseCommands, view, onExecute, this.#wrapSystemCallback(onClose));
          this.#syncSystemOverlay();
          return;
        }
        this.#callStage('system', 'showBaseCommands', this.#stage.showBaseCommands, view, onExecute, this.#wrapLegacySystemCallback(onClose));
        this.#systemOverlay = { type: 'base' };
      },
      hideBaseCommands: () => {
        if (this.#systemPort) {
          this.#callSystem('hideBaseCommands', this.#systemPort.hideBaseCommands);
          this.#syncSystemOverlay();
          return;
        }
        this.#callStage('system', 'hideBaseCommands', this.#stage.hideBase);
        this.#systemOverlay = { type: 'none' };
      },
      showVideo: (source, onEnd) => {
        if (this.#systemPort) {
          this.#callSystem('showVideo', this.#systemPort.showVideo, source, this.#wrapSystemCallback(onEnd));
          this.#syncSystemOverlay();
          return;
        }
        this.#systemOverlay = { type: 'video' };
        this.#callStage('system', 'showVideo', this.#stage.showVideo, source, this.#wrapLegacySystemCallback(onEnd));
      },
      hideVideo: () => {
        if (this.#systemPort) {
          this.#callSystem('hideVideo', this.#systemPort.hideVideo);
          this.#syncSystemOverlay();
          return;
        }
        this.#callStage('system', 'hideVideo', this.#stage.hideVideo);
        this.#systemOverlay = { type: 'none' };
      },
    };

    const loading: LoadingCommands = {
      showLoading: (progress) => this.#callStage('loading', 'showLoading', this.#stage.showLoading, { ...progress }),
      hideLoading: () => this.#callStage('loading', 'hideLoading', this.#stage.hideLoading),
    };

    const preferences: PreferenceCommands = {
      setQuality: (quality) => this.#callWorld('setQuality', this.#worldPort?.setQuality, this.#stage.setQuality, quality),
      setPresentationPreferences: (preferences) => {
        this.#callWorld('setPresentationPreferences', this.#worldPort?.setPresentationPreferences, this.#stage.setPresentationPreferences, { ...preferences });
        this.#dialoguePort?.setPresentationPreferences(preferences);
      },
      setReadingPreferences: (preferences) => {
        this.#ensureActive('preferences', 'setReadingPreferences');
        if (this.#dialoguePort) this.#dialoguePort.setReadingPreferences(preferences);
        else this.#callStage('preferences', 'setReadingPreferences', this.#stage.setReadingPreferences, preferences);
      },
      setPostProcess: (settings) => this.#callWorld('setPostProcess', this.#worldPort?.setPostProcess, this.#stage.setPostProcess, { ...settings }),
      setTheme: (overrides: RendererThemeOverrides) => {
        this.#ensureActive('preferences', 'setTheme');
        const nextTheme = createRendererTheme(overrides);
        if (JSON.stringify(nextTheme) === JSON.stringify(this.#theme)) return;
        this.#theme = nextTheme;
        if (this.#stage.setTheme) {
          this.#stage.setTheme(nextTheme);
          return;
        }
        this.#dialoguePort?.setTheme(nextTheme);
        this.#menuPort?.setTheme(nextTheme);
        this.#galleryPort?.setTheme(nextTheme);
        this.#systemPort?.setTheme(nextTheme);
      },
    };

    const presentation: PresentationCommands = {
      validate: (snapshot) => this.#validatePresentation(snapshot),
      restore: (snapshot) => {
        this.#validatePresentation(snapshot);
        const method = this.#controller.restorePresentation ?? this.#stage.restorePresentation;
        if (!method) this.#missing('presentation', 'restore');
        const result = method.call(this.#controller.restorePresentation ? this.#controller : this.#stage, cloneOpaque(snapshot));
        if (!this.#controller.presentationOwnsStage) {
          this.#stage.restorePresentation?.(cloneOpaque(snapshot));
        }
        return result;
      },
      clear: () => {
        this.#ensureActive('presentation', 'clear');
        const controllerMethod = this.#controller.clearPresentation;
        if (!controllerMethod) this.#missing('presentation', 'clear');
        controllerMethod.call(this.#controller);
        if (!this.#controller.presentationOwnsStage) {
          this.#callStage('presentation', 'clear', this.#stage.clearPresentation);
        }
      },
    };

    this.commands = { assets, world, dialogue, menu, gallery, system, loading, preferences, presentation,
      projectUi: { setDefaultSuppression: (pages) => this.#callStage('projectUi', 'setDefaultSuppression', this.#stage.setDeclarativeUiSuppression, pages) } };

    const worldQueries: WorldQueries = {
      isFadeActive: () => this.#worldPort?.isFadeActive?.() ?? this.#stage.isFadeActive?.() ?? false,
      inspectStage: () => this.#worldPort?.inspectStage?.() ?? null,
      captureThumbnail: () => {
        this.#ensureQueryActive('world', 'captureThumbnail');
        if (this.#worldPort) return this.#worldPort.captureThumbnail();
        const method = this.#stage.captureThumbnail;
        if (!method) this.#queryMissing('world', 'captureThumbnail');
        return method.call(this.#stage);
      },
    };
    const dialogueQueries: DialogueQueries = {
      backlogEntries: () => {
        this.#ensureQueryActive('dialogue', 'backlogEntries');
        return (this.#controller.backlogEntries?.() ?? []).map((entry) => ({ ...entry }));
      },
      backlogSearchQuery: () => {
        this.#ensureQueryActive('dialogue', 'backlogSearchQuery');
        return this.#controller.backlogSearchQuery?.() ?? '';
      },
      nvlPresentationEntries: () => {
        this.#ensureQueryActive('dialogue', 'nvlPresentationEntries');
        return (this.#dialoguePort?.nvlPresentationEntries ?? []).map((entry) => ({ ...entry }));
      },
    };
    const overlayQueries: OverlayQueries = {
      menu: () => {
        this.#ensureQueryActive('overlay', 'menu');
        return this.#menuPort ? { ...this.#menuPort.menu() } : { ...this.#menuOverlay };
      },
      gallery: () => {
        this.#ensureQueryActive('overlay', 'gallery');
        return this.#galleryPort ? { ...this.#galleryPort.gallery() } : { ...this.#galleryOverlay };
      },
      system: () => {
        this.#ensureQueryActive('overlay', 'system');
        return this.#systemPort ? { ...this.#systemPort.system() } : { ...this.#systemOverlay };
      },
    };
    const preferenceQueries: PreferenceQueries = {
      quality: () => this.#worldPort?.getQuality() ?? this.#queryStage('preferences', 'quality', this.#stage.getQuality),
      presentationPreferences: () => ({ ...(this.#worldPort?.getPresentationPreferences() ?? this.#queryStage('preferences', 'presentationPreferences', this.#stage.getPresentationPreferences)) }),
      postProcess: () => ({ ...(this.#worldPort?.getPostProcess() ?? this.#queryStage('preferences', 'postProcess', this.#stage.getPostProcess)) }),
      fontFamily: (role: RendererFontRole) => this.#queryStage('preferences', 'fontFamily', this.#stage.getFontFamily, role),
      theme: () => this.#theme,
    };
    const presentationQueries: PresentationQueries = {
      snapshot: (context) => {
        this.#ensureQueryActive('presentation', 'snapshot');
        const snapshot = this.#controller.snapshotPresentation?.(context) ?? this.#stage.snapshotPresentation?.() ?? null;
        return cloneOpaque(snapshot);
      },
      canCaptureRollbackCheckpoint: () => {
        this.#ensureQueryActive('presentation', 'canCaptureRollbackCheckpoint');
        return this.#controller.canCaptureRollbackCheckpoint?.() ?? true;
      },
    };
    const diagnosticQueries: RendererDiagnosticQueries = {
      fontText: (role, text, target) => this.#assetRegistry?.fontDiagnostics(role, text, target)
        ?? fontTextDiagnostics(undefined, role, '', text, target),
      resourceSnapshot: () => cloneResourceSnapshot(
        this.#resourceSnapshot?.() ?? EMPTY_RESOURCE_SNAPSHOT(this.#disposed),
        this.#disposed,
      ),
      resourceLedger: () => cloneResourceLedger(this.#resourceLedger?.() ?? { active: [], events: [] }),
      performanceSnapshot: (): RenderPerformanceSnapshot | null => this.#monitor.snapshot(),
      projectionSnapshot: () => cloneAndFreezePlainData(this.#projectionSnapshot?.() ?? EMPTY_PROJECTION_SNAPSHOT) as RendererProjectionSnapshot,
      needsUpdate: () => this.#controller.needsUpdate || this.#stage.needsUpdate?.() === true,
      isDisposed: () => this.#disposed,
    };

    this.queries = {
      world: worldQueries,
      dialogue: dialogueQueries,
      overlay: overlayQueries,
      preferences: preferenceQueries,
      presentation: presentationQueries,
      diagnostics: diagnosticQueries,
    };
  }

  resize(): void {
    this.#ensureActive('runtime', 'resize');
    this.#stage.fitWindow?.();
  }

  resetSession(options?: ResetSessionOptions): void {
    this.#ensureActive('runtime', 'resetSession');
    this.#controller.reset(options);
    this.#menuOverlay = { type: 'none' };
    this.#galleryOverlay = { type: 'none' };
    this.#systemOverlay = { type: 'none' };
  }

  /** @internal Called by the composition root after ordered disposal. */
  markDisposed(): void {
    this.#disposed = true;
    this.#menuOverlay = { type: 'none' };
    this.#galleryOverlay = { type: 'none' };
    this.#systemOverlay = { type: 'none' };
  }

  #ensureActive(domain: string, command: string): void {
    if (this.#disposed) {
      throw new RendererError('Renderer runtime has already been disposed', {
        code: 'RENDERER_DISPOSED',
        domain,
        command,
      });
    }
  }

  #ensureQueryActive(domain: string, command: string): void {
    this.#ensureActive(domain, command);
  }

  #missing(domain: string, command: string): never {
    throw new RendererCommandError(`Legacy renderer does not implement ${domain}.${command}`, {
      code: 'LEGACY_CONTRACT_VIOLATION',
      domain,
      command,
    });
  }

  #queryMissing(domain: string, command: string): never {
    throw new RendererError(`Legacy renderer does not implement ${domain}.${command}`, {
      code: 'LEGACY_CONTRACT_VIOLATION',
      domain,
      command,
    });
  }

  #callWorld<T, Args extends readonly unknown[]>(
    command: string,
    layerMethod: ((...args: Args) => T) | undefined,
    stageMethod: ((...args: Args) => T) | undefined,
    ...args: Args
  ): T {
    this.#ensureActive('world', command);
    const method = layerMethod ?? stageMethod;
    if (!method) this.#missing('world', command);
    return Reflect.apply(method, layerMethod ? this.#worldPort : this.#stage, args as unknown as unknown[]);
  }

  #callStage<T, Args extends readonly unknown[]>(domain: string, command: string, method: ((...args: Args) => T) | undefined, ...args: Args): T {
    this.#ensureActive(domain, command);
    if (!method) this.#missing(domain, command);
    return Reflect.apply(method, this.#stage, args as unknown as unknown[]);
  }

  #callDialogue<T, Args extends readonly unknown[]>(
    command: string,
    layerMethod: ((...args: Args) => T) | undefined,
    stageMethod: ((...args: Args) => T) | undefined,
    ...args: Args
  ): T {
    this.#ensureActive('dialogue', command);
    const method = layerMethod ?? stageMethod;
    if (!method) this.#missing('dialogue', command);
    const receiver = layerMethod ? this.#dialoguePort : this.#stage;
    return Reflect.apply(method, receiver, args as unknown as unknown[]);
  }

  #callMenu<T, Args extends readonly unknown[]>(
    command: string,
    layerMethod: ((...args: Args) => T) | undefined,
    ...args: Args
  ): T {
    this.#ensureActive('menu', command);
    if (!layerMethod) this.#missing('menu', command);
    return Reflect.apply(layerMethod, this.#menuPort, args as unknown as unknown[]);
  }

  #callGallery<T, Args extends readonly unknown[]>(
    command: string,
    layerMethod: ((...args: Args) => T) | undefined,
    ...args: Args
  ): T {
    this.#ensureActive('gallery', command);
    if (!layerMethod) this.#missing('gallery', command);
    return Reflect.apply(layerMethod, this.#galleryPort, args as unknown as unknown[]);
  }

  #callSystem<T, Args extends readonly unknown[]>(
    command: string,
    layerMethod: ((...args: Args) => T) | undefined,
    ...args: Args
  ): T {
    this.#ensureActive('system', command);
    if (!layerMethod) this.#missing('system', command);
    return Reflect.apply(layerMethod, this.#systemPort, args as unknown as unknown[]);
  }

  #syncMenuOverlay(): void {
    this.#menuOverlay = this.#menuPort ? { ...this.#menuPort.menu() } : { type: 'none' };
  }

  #syncGalleryOverlay(): void {
    this.#galleryOverlay = this.#galleryPort ? { ...this.#galleryPort.gallery() } : { type: 'none' };
  }

  #syncSystemOverlay(): void {
    this.#systemOverlay = this.#systemPort ? { ...this.#systemPort.system() } : { type: 'none' };
  }

  /** Interactive v2 SystemPanel close: the Layer hides locally, then the Facade updates its query cache. */
  #wrapSystemCallback<T extends readonly unknown[]>(callback: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      this.#syncSystemOverlay();
      callback(...args);
    };
  }

  /** Legacy fallback close: the compatibility stage owns the panel hide; Facade only invalidates its cache. */
  #wrapLegacySystemCallback<T extends readonly unknown[]>(callback: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      this.#systemOverlay = { type: 'none' };
      callback(...args);
    };
  }

  /** Interactive v2 Gallery close: the Layer hides locally, then Facade restores cross-layer state. */
  #wrapGalleryClose(callback?: () => void): () => void {
    return () => {
      this.#stage.restoreCommandRail?.();
      this.#syncGalleryOverlay();
      callback?.();
    };
  }

  /** Legacy fallback close: the compatibility stage restores the rail; Facade only invalidates its cache. */
  #wrapLegacyGalleryClose(callback?: () => void): () => void {
    return () => {
      this.#galleryOverlay = { type: 'none' };
      callback?.();
    };
  }

  /** Hide Gallery without restoring the command rail; the caller may be opening another overlay. */
  #hideGalleryProjection(): void {
    if (this.#galleryPort) {
      this.#callGallery('hideGallery', this.#galleryPort.hideGallery);
      this.#syncGalleryOverlay();
      return;
    }
    if (this.#stage.hideGallery) this.#callStage('gallery', 'hideGallery', this.#stage.hideGallery);
    this.#galleryOverlay = { type: 'none' };
  }

  #wrapMenuRailRestore<T extends readonly unknown[]>(callback: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      this.#stage.restoreCommandRail?.();
      callback(...args);
    };
  }

  /**
   * Save/load selection may be rejected by the host (for example a stale or
   * forged empty-slot id). Preserve the overlay and hidden command rail for
   * that explicit `false` result; legacy void callbacks keep the old success
   * behavior. Callback failures still restore the rail before rethrowing.
   */
  #wrapSaveLoadSelect<T extends readonly unknown[]>(
    callback: (...args: T) => SaveLoadSelectionResult,
    options: SaveLoadCommandOptions = {},
  ): (...args: T) => SaveLoadSelectionResult {
    if (options.completion === 'host-transaction') {
      return (...args: T): SaveLoadSelectionResult => {
        const result = callback(...args);
        if (!isPromiseLikeSaveLoadResult(result)) {
          throw new Error('host-transaction save/load handlers must return a Promise');
        }
        this.#saveLoadTransactionPending = true;
        return Promise.resolve(result).then(
          (accepted) => {
            this.#saveLoadTransactionPending = false;
            return accepted;
          },
          (error) => {
            this.#saveLoadTransactionPending = false;
            throw error;
          },
        );
      };
    }
    return (...args: T) => {
      try {
        const accepted = callback(...args);
        if (accepted !== false) this.#stage.restoreCommandRail?.();
        return accepted;
      } catch (error) {
        this.#stage.restoreCommandRail?.();
        throw error;
      }
    };
  }

  /** M3 cross-layer coordination: the Facade owns the only v2 World focus call. */
  #coordinateWorldFocus(characterId: string | null): void {
    this.#callWorld('setPortraitFocus', this.#worldPort?.setPortraitFocus, this.#stage.setPortraitFocus, characterId);
  }

  #queryStage<T>(domain: string, command: string, method: (() => T) | undefined): T;
  #queryStage<T, A>(domain: string, command: string, method: ((arg: A) => T) | undefined, arg: A): T;
  #queryStage<T, A>(domain: string, command: string, method: ((arg?: A) => T) | undefined, arg?: A): T {
    this.#ensureQueryActive(domain, command);
    if (!method) this.#queryMissing(domain, command);
    return method.call(this.#stage, arg);
  }

  #validatePresentation(snapshot: unknown): void {
    this.#ensureActive('presentation', 'validate');
    if (this.#controller.validatePresentation) {
      this.#controller.validatePresentation.call(this.#controller, cloneOpaque(snapshot));
      return;
    }
    if (snapshot === null || snapshot === undefined) {
      if (this.#worldPort?.validatePresentation) {
        this.#worldPort.validatePresentation.call(this.#worldPort, null);
      } else if (this.#stage.validatePresentation) {
        this.#stage.validatePresentation.call(this.#stage, null);
      }
      return;
    }
    if (!isRecord(snapshot)) {
      throw new RendererCommandError('Presentation snapshot must be an object', {
        code: 'PRESENTATION_SNAPSHOT_INVALID',
        domain: 'presentation',
        command: 'validate',
      });
    }
    if ('version' in snapshot && typeof snapshot.version !== 'number') {
      throw new RendererCommandError('Presentation snapshot version must be numeric', {
        code: 'PRESENTATION_SNAPSHOT_INVALID',
        domain: 'presentation',
        command: 'validate',
      });
    }
    if (this.#worldPort?.validatePresentation) {
      this.#worldPort.validatePresentation.call(this.#worldPort, snapshot.stage ?? null);
    } else if (this.#stage.validatePresentation) {
      this.#stage.validatePresentation.call(this.#stage, snapshot.stage ?? null);
    }
  }

  #clearMenu(type: MenuOverlayState['type']): void {
    if (this.#menuOverlay.type === type) this.#menuOverlay = { type: 'none' };
  }
}
