import type { BacklogEntry } from '../backlog.js';
import type { BattleView } from '../battle-view.js';
import type { GalleryItemView } from '../gallery.js';
import type { LoadingProgress } from '../loading-progress.js';
import type { PostProcessSettings } from '../post-process.js';
import type { PresentationPreferences } from '../presentation.js';
import type { RenderPerformanceMonitor, RenderPerformanceSnapshot } from '../performance.js';
import type { RenderQuality } from '../quality.js';
import type { RendererResourceSnapshot } from '../diagnostics/renderer-baseline.js';
import type { SettingsRowView } from '../settings-store.js';
import type { TimelineFrameEvent } from '../timeline-player.js';
import type {
  AdvStage,
  ChoiceOptionView,
  CommandRailItem,
  PortraitView,
  SpeakerProfile,
} from '../types.js';
import type { BattleHandlers, FontRole } from '../pixi-stage.js';
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
  LoadingCommands,
  MenuCommands,
  PreferenceCommands,
  PresentationCommands,
  RendererCommands,
  RendererFontRole,
  ShopView,
  SystemPanelCommands,
  WorldCommands,
} from '../api/renderer-commands.js';
import type {
  DialogueQueries,
  MenuOverlayState,
  OverlayQueries,
  PreferenceQueries,
  PresentationQueries,
  RendererDiagnosticQueries,
  RendererQueries,
  WorldQueries,
} from '../api/renderer-queries.js';
import type { PresentationController, ResetSessionOptions } from '../api/renderer-runtime.js';
import type { RenderAssetRegistry } from '../services/render-asset-registry.js';

/** @internal Transitional Stage port; it keeps Pixi and legacy methods out of the public API. */
export type RendererStagePort = Partial<AdvStage> & {
  fitWindow?: () => void;
  destroy: () => void;
  registerBackground?: (key: string, source: string, format?: string) => Promise<void>;
  registerPortrait?: (charId: string, costume: string, expression: string, source: string, format?: string) => Promise<void>;
  registerAvatar?: (key: string, source: string, format?: string) => Promise<void>;
  getFontFamily?: (role: FontRole) => string;
  registerFontRole?: (role: FontRole, url: string, family?: string, timeoutMs?: number) => Promise<boolean>;
  registerFont?: (url: string, family?: string, timeoutMs?: number) => Promise<boolean>;
  resetFonts?: () => void;
  resetFont?: () => void;
  releaseRegisteredAssetSources?: () => Promise<void>;
  showGallery?: (options: {
    cgs: GalleryItemView[];
    music: GalleryItemView[];
    texts?: GalleryItemView[];
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
  showSaveLoad?: (view: SaveLoadView, onSelect: (slotId: string) => void, onClose: () => void) => void;
  hideSaveLoad?: () => void;
  showMap?: (view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void) => void;
  hideMap?: () => void;
  showShop?: (view: { gold: number; items: { id: string; name: string; price: number }[]; message?: string }, onBuy: (itemId: string) => void, onClose: () => void) => void;
  hideShop?: () => void;
  showBaseCommands?: (view: BasePanelView, onExecute: (commandId: string) => void, onClose: () => void) => void;
  hideBase?: () => void;
  captureThumbnail?: () => string | null;
};

/** @internal Controller port with the old snapshot methods kept behind the facade. */
export interface RendererControllerPort extends PresentationController {
  /** @internal True when the controller's presentation transaction also projects the stage. */
  presentationOwnsStage?: boolean;
  snapshotPresentation?: () => unknown;
  restorePresentation?: (snapshot: unknown) => void;
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
  assetRegistry?: RenderAssetRegistry;
  /** M3 public dialogue projection port; concrete Layer details stay behind it. */
  dialogueLayer?: DialogueProjectionPort;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = cloneOpaque(item);
    return copy;
  }
  return value;
}

function cloneResourceSnapshot(snapshot: RendererResourceSnapshot, disposed: boolean): RendererResourceSnapshot {
  return {
    ...snapshot,
    disposed: disposed || snapshot.disposed,
    pooledObjects: { ...snapshot.pooledObjects },
    displayObjectsByOwner: { ...snapshot.displayObjectsByOwner },
  };
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
  #assetRegistry?: RenderAssetRegistry;
  #dialoguePort?: DialogueProjectionPort;
  #disposed = false;
  #menuOverlay: MenuOverlayState = { type: 'none' };

  constructor(options: RendererFacadeOptions) {
    this.#stage = options.stage;
    this.#controller = options.controller;
    this.#monitor = options.monitor;
    this.#resourceSnapshot = options.resourceSnapshot;
    this.#assetRegistry = options.assetRegistry;
    this.#dialoguePort = options.dialogueLayer;

    const assets: AssetCommands = {
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
      registerPortrait: async (charId, costume, expression, source, format) => {
        this.#ensureActive('assets', 'registerPortrait');
        if (this.#assetRegistry) {
          await this.#assetRegistry.registerPortrait(charId, costume, expression, source, format);
          return;
        }
        const method = this.#stage.registerPortrait;
        if (!method) this.#missing('assets', 'registerPortrait');
        await method.call(this.#stage, charId, costume, expression, source, format);
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
      setBackground: (key) => this.#callStage('world', 'setBackground', this.#stage.setBackground, key),
      setPortrait: (key, view) => this.#callStage('world', 'setPortrait', this.#stage.setPortrait, key, view),
      removePortrait: (key) => this.#callStage('world', 'removePortrait', this.#stage.removePortrait, key),
      setFade: (alpha) => this.#callStage('world', 'setFade', this.#stage.setFade, alpha),
      shake: (durationMs = 400, strength = 8, direction = 'both') => this.#callStage('world', 'shake', this.#stage.shake, durationMs, strength, direction),
      transition: (name, durationMs) => this.#callStage('world', 'transition', this.#stage.transition, name, durationMs),
      flash: (durationMs = 300) => this.#callStage('world', 'flash', this.#stage.flash, durationMs),
      zoom: (scale = 1, durationMs = 400) => this.#callStage('world', 'zoom', this.#stage.zoom, scale, durationMs),
      wipe: (durationMs = 600) => this.#callStage('world', 'wipe', this.#stage.wipe, durationMs),
      movePortrait: (key, pos, durationMs = 400) => this.#callStage('world', 'movePortrait', this.#stage.movePortrait, key, pos, durationMs),
      setTint: (color, alpha, durationMs = 400) => this.#callStage('world', 'setTint', this.#stage.setTint, color, alpha, durationMs),
      clearTint: (durationMs = 400) => this.#callStage('world', 'clearTint', this.#stage.clearTint, durationMs),
      startParticles: (kind) => this.#callStage('world', 'startParticles', this.#stage.startParticles, kind),
      stopParticles: () => this.#callStage('world', 'stopParticles', this.#stage.stopParticles),
      applyTimelineFrame: (event) => this.#callStage('world', 'applyTimelineFrame', this.#stage.applyTimelineFrame, event),
      setPortraitFocus: (characterId) => this.#callStage('world', 'setPortraitFocus', this.#stage.setPortraitFocus, characterId),
    };

    const dialogue: DialogueCommands = {
      showText: (speaker, value) => {
        if (!this.#dialoguePort) {
          this.#callDialogue('showText', undefined, this.#stage.showText, speaker, value);
          return;
        }
        const before = this.#dialoguePort.projectionVersion;
        this.#callDialogue('showText', this.#dialoguePort.showText, this.#stage.showText, speaker, value);
        if (this.#dialoguePort.projectionVersion !== before) {
          this.#coordinateWorldFocus(this.#dialoguePort.activeSpeakerId);
        }
      },
      showChoices: (options) => this.#callDialogue('showChoices', this.#dialoguePort?.showChoices, this.#stage.showChoices, options.slice()),
      hideChoices: () => this.#callDialogue('hideChoices', this.#dialoguePort?.hideChoices, this.#stage.hideChoices),
      setAwaiting: (awaiting) => this.#callDialogue('setAwaiting', this.#dialoguePort?.setAwaiting, this.#stage.setAwaiting, awaiting),
      showBacklog: (entries, onReplayVoice, query) => this.#callDialogue('showBacklog', this.#dialoguePort?.showBacklog, this.#stage.showBacklog, entries.map((entry) => ({ ...entry })), onReplayVoice, query),
      hideBacklog: () => this.#callDialogue('hideBacklog', this.#dialoguePort?.hideBacklog, this.#stage.hideBacklog),
      setNvlMode: (on) => this.#callDialogue('setNvlMode', this.#dialoguePort?.setNvlMode, this.#stage.setNvlMode, on),
      appendNvlText: (speaker, text) => this.#callDialogue('appendNvlText', this.#dialoguePort?.appendNvlText, this.#stage.appendNvlText, speaker, text),
      clearNvlText: () => this.#callDialogue('clearNvlText', this.#dialoguePort?.clearNvlText, this.#stage.clearNvlText),
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
    };

    const menu: MenuCommands = {
      showTitle: (view, onSelect) => {
        this.#callStage('menu', 'showTitle', this.#stage.showTitle, { ...view, items: view.items.slice() }, onSelect);
        this.#menuOverlay = { type: 'title' };
      },
      hideTitle: (restoreCommandRail) => {
        this.#callStage('menu', 'hideTitle', this.#stage.hideTitle, restoreCommandRail);
        this.#clearMenu('title');
      },
      showEnding: (text) => {
        this.#callStage('menu', 'showEnding', this.#stage.showEnding, text);
        this.#menuOverlay = { type: 'ending' };
      },
      hideEnding: () => {
        this.#callStage('menu', 'hideEnding', this.#stage.hideEnding);
        this.#clearMenu('ending');
      },
      showSystemMenu: (items, onSelect, onClose) => {
        this.#callStage('menu', 'showSystemMenu', this.#stage.showSystemMenu, items.slice(), onSelect, onClose);
        this.#menuOverlay = { type: 'system-menu' };
      },
      hideSystemMenu: () => {
        this.#callStage('menu', 'hideSystemMenu', this.#stage.hideSystemMenu);
        this.#clearMenu('system-menu');
      },
      showSettings: (rows, onChange, onClose) => {
        this.#callStage('menu', 'showSettings', this.#stage.showSettings, rows.slice(), onChange, onClose);
        this.#menuOverlay = { type: 'settings' };
      },
      hideSettings: () => {
        this.#callStage('menu', 'hideSettings', this.#stage.hideSettings);
        this.#clearMenu('settings');
      },
      showSaveLoad: (view, onSelect, onClose) => {
        this.#callStage('menu', 'showSaveLoad', this.#stage.showSaveLoad, { ...view, slots: view.slots.slice() }, onSelect, onClose);
        this.#menuOverlay = { type: 'save-load', mode: view.mode };
      },
      hideSaveLoad: () => {
        this.#callStage('menu', 'hideSaveLoad', this.#stage.hideSaveLoad);
        this.#clearMenu('save-load');
      },
    };

    const gallery: GalleryCommands = {
      showGallery: (options) => this.#callStage('gallery', 'showGallery', this.#stage.showGallery, {
        cgs: options.cgs.slice(),
        music: options.music.slice(),
        texts: options.texts?.slice(),
        onPlayMusic: options.onPlayMusic,
        onReplayText: options.onReplayText,
        onClose: options.onClose,
      }),
      hideGallery: () => this.#callStage('gallery', 'hideGallery', this.#stage.hideGallery),
    };

    const system: SystemPanelCommands = {
      showBattle: (view, handlers, message) => this.#callStage('system', 'showBattle', this.#stage.showBattle, view, handlers, message),
      hideBattle: () => this.#callStage('system', 'hideBattle', this.#stage.hideBattle),
      showMap: (view, onEnter, onEndTurn) => this.#callStage('system', 'showMap', this.#stage.showMap, view, onEnter, onEndTurn),
      hideMap: () => this.#callStage('system', 'hideMap', this.#stage.hideMap),
      showShop: (view, onBuy, onClose) => this.#callStage('system', 'showShop', this.#stage.showShop, { ...view, items: view.items.slice() }, onBuy, onClose),
      hideShop: () => this.#callStage('system', 'hideShop', this.#stage.hideShop),
      showBaseCommands: (view, onExecute, onClose) => this.#callStage('system', 'showBaseCommands', this.#stage.showBaseCommands, view, onExecute, onClose),
      hideBaseCommands: () => this.#callStage('system', 'hideBaseCommands', this.#stage.hideBase),
      showVideo: (source, onEnd) => this.#callStage('system', 'showVideo', this.#stage.showVideo, source, onEnd),
      hideVideo: () => this.#callStage('system', 'hideVideo', this.#stage.hideVideo),
    };

    const loading: LoadingCommands = {
      showLoading: (progress) => this.#callStage('loading', 'showLoading', this.#stage.showLoading, { ...progress }),
      hideLoading: () => this.#callStage('loading', 'hideLoading', this.#stage.hideLoading),
    };

    const preferences: PreferenceCommands = {
      setQuality: (quality) => this.#callStage('preferences', 'setQuality', this.#stage.setQuality, quality),
      setPresentationPreferences: (preferences) => this.#callStage('preferences', 'setPresentationPreferences', this.#stage.setPresentationPreferences, { ...preferences }),
      setPostProcess: (settings) => this.#callStage('preferences', 'setPostProcess', this.#stage.setPostProcess, { ...settings }),
    };

    const presentation: PresentationCommands = {
      validate: (snapshot) => this.#validatePresentation(snapshot),
      restore: (snapshot) => {
        this.#validatePresentation(snapshot);
        const method = this.#controller.restorePresentation ?? this.#stage.restorePresentation;
        if (!method) this.#missing('presentation', 'restore');
        method.call(this.#controller.restorePresentation ? this.#controller : this.#stage, cloneOpaque(snapshot));
        if (!this.#controller.presentationOwnsStage) {
          this.#stage.restorePresentation?.(cloneOpaque(snapshot));
        }
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

    this.commands = { assets, world, dialogue, menu, gallery, system, loading, preferences, presentation };

    const worldQueries: WorldQueries = {
      captureThumbnail: () => {
        this.#ensureQueryActive('world', 'captureThumbnail');
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
    };
    const overlayQueries: OverlayQueries = {
      menu: () => {
        this.#ensureQueryActive('overlay', 'menu');
        return { ...this.#menuOverlay };
      },
    };
    const preferenceQueries: PreferenceQueries = {
      quality: () => this.#queryStage('preferences', 'quality', this.#stage.getQuality),
      presentationPreferences: () => ({ ...this.#queryStage('preferences', 'presentationPreferences', this.#stage.getPresentationPreferences) }),
      postProcess: () => ({ ...this.#queryStage('preferences', 'postProcess', this.#stage.getPostProcess) }),
      fontFamily: (role: RendererFontRole) => this.#queryStage('preferences', 'fontFamily', this.#stage.getFontFamily, role),
    };
    const presentationQueries: PresentationQueries = {
      snapshot: () => {
        this.#ensureQueryActive('presentation', 'snapshot');
        const snapshot = this.#controller.snapshotPresentation?.() ?? this.#stage.snapshotPresentation?.() ?? null;
        return cloneOpaque(snapshot);
      },
    };
    const diagnosticQueries: RendererDiagnosticQueries = {
      resourceSnapshot: () => cloneResourceSnapshot(
        this.#resourceSnapshot?.() ?? EMPTY_RESOURCE_SNAPSHOT(this.#disposed),
        this.#disposed,
      ),
      performanceSnapshot: (): RenderPerformanceSnapshot | null => this.#monitor.snapshot(),
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
  }

  /** @internal Called by the composition root after ordered disposal. */
  markDisposed(): void {
    this.#disposed = true;
    this.#menuOverlay = { type: 'none' };
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

  /** M3 cross-layer coordination: the Facade owns the only v2 World focus call. */
  #coordinateWorldFocus(characterId: string | null): void {
    if (!this.#stage.setPortraitFocus) return;
    this.#callStage('world', 'setPortraitFocus', this.#stage.setPortraitFocus, characterId);
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
  }

  #clearMenu(type: MenuOverlayState['type']): void {
    if (this.#menuOverlay.type === type) this.#menuOverlay = { type: 'none' };
  }
}
