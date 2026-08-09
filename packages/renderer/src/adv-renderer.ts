import { type CoreEventMap, type EventBus, type Unsubscribe } from '@surdet/core';
import type { BacklogEntry } from './backlog.js';
import { DEFAULT_POST_PROCESS, type PostProcessSettings } from './post-process.js';
import { DEFAULT_PRESENTATION_PREFERENCES, type PresentationPreferences } from './presentation.js';
import { NULL_AUDIO, type AdvStage, type AudioHandle, type FrameRequestHandler } from './types.js';
import {
  PresentationController,
  type AdvRendererOptions,
  type PresentationControllerOptions,
  type RenderStatus,
} from './runtime/presentation-controller.js';
import type { RendererInputAction } from './api/renderer-input.js';
import type { ResetSessionOptions } from './api/renderer-runtime.js';
import type { RendererCommands, RendererFontRole, WorldProjectionPort } from './api/renderer-commands.js';
import type { RendererQueries } from './api/renderer-queries.js';
import type { RendererResourceSnapshot } from './diagnostics/renderer-baseline.js';
import type { RenderAssetRegistry } from './services/render-asset-registry.js';

export type { AdvRendererOptions, RenderStatus } from './runtime/presentation-controller.js';
export { parseColor } from './runtime/presentation-controller.js';

/**
 * Legacy compatibility wrapper.
 *
 * AdvRenderer intentionally contains no presentation state machine. It adapts
 * the historical `(stage, audio, options)` constructor to the independent
 * PresentationController and delegates every legacy method/getter to it.
 */
export class AdvRenderer {
  readonly presentationOwnsStage = true;
  readonly #controller: PresentationController;

  constructor(stage: AdvStage, audio: AudioHandle = NULL_AUDIO, options: AdvRendererOptions = {}) {
    const ports = createPresentationPorts(stage);
    options.pluginHost?.attach(stage);
    const controllerOptions: PresentationControllerOptions = {
      ...options,
      commands: ports.commands,
      queries: ports.queries,
      resetProjection: (resetOptions) => stage.resetSession?.(resetOptions),
      updateProjection: (deltaMs) => {
        stage.updateContinuePulse?.(deltaMs);
        stage.updateEffects?.(deltaMs);
      },
      canScrollBacklog: () => stage.scrollBacklog !== undefined,
      bindStageCallbacks: (handlers) => {
        stage.onSelect = handlers.onSelect;
        stage.onBacklogClose = handlers.onBacklogClose;
        return () => {
          stage.onSelect = null;
          stage.onBacklogClose = null;
        };
      },
      detachPlugin: () => options.pluginHost?.detach(),
    };
    this.#controller = new PresentationController(ports.commands, ports.queries, audio, controllerOptions);
  }

  get status(): RenderStatus { return this.#controller.status; }
  get needsUpdate(): boolean { return this.#controller.needsUpdate; }
  get interfaceHidden(): boolean { return this.#controller.interfaceHidden; }
  get backlogOpen(): boolean { return this.#controller.backlogOpen; }
  get backlogSearchQuery(): string { return this.#controller.backlogSearchQuery(); }
  get skipAll(): boolean { return this.#controller.skipAll; }
  get autoPlay(): boolean { return this.#controller.autoPlay; }
  get skipMode(): boolean { return this.#controller.skipMode; }

  setFrameRequest(handler: FrameRequestHandler | null): void { this.#controller.setFrameRequest(handler); }
  connect(bus: EventBus<CoreEventMap>): Unsubscribe { return this.#controller.connect(bus); }
  disconnect(): void { this.#controller.disconnect(); }
  subscribe(bus: EventBus<CoreEventMap>): void { this.#controller.subscribe(bus); }
  destroy(): void { this.#controller.destroy(); }
  dispose(): void { this.#controller.dispose(); }
  reset(options?: ResetSessionOptions): void { this.#controller.reset(options); }
  resetSession(options?: ResetSessionOptions): void { this.#controller.resetSession(options); }
  update(deltaMs: number): void { this.#controller.update(deltaMs); }

  setTextSpeed(charsPerSecond: number): void { this.#controller.setTextSpeed(charsPerSecond); }
  setAutoWait(baseDelayMs: number, perCharMs: number): void { this.#controller.setAutoWait(baseDelayMs, perCharMs); }
  toggleBacklog(): boolean { return this.#controller.toggleBacklog(); }
  toggleHideInterface(): boolean { return this.#controller.toggleHideInterface(); }
  focusBacklogSearch(): boolean { return this.#controller.focusBacklogSearch(); }
  appendBacklogSearch(value: string): boolean { return this.#controller.appendBacklogSearch(value); }
  scrollBacklog(delta: number): boolean { return this.#controller.scrollBacklog(delta); }
  backspaceBacklogSearch(): boolean { return this.#controller.backspaceBacklogSearch(); }
  handleBacklogEscape(): boolean { return this.#controller.handleBacklogEscape(); }
  toggleAuto(): boolean { return this.#controller.toggleAuto(); }
  toggleSkip(): boolean { return this.#controller.toggleSkip(); }
  toggleSkipAll(): boolean { return this.#controller.toggleSkipAll(); }
  advance(): boolean { return this.#controller.advance(); }
  select(index: number): boolean { return this.#controller.select(index); }
  choiceUp(): void { this.#controller.choiceUp(); }
  choiceDown(): void { this.#controller.choiceDown(); }
  choiceConfirm(): boolean { return this.#controller.choiceConfirm(); }
  selectChoiceAt(position: number): boolean { return this.#controller.selectChoiceAt(position); }
  dispatchInput(action: RendererInputAction): boolean { return this.#controller.dispatchInput(action); }
  backlogEntries(): readonly BacklogEntry[] { return this.#controller.backlogEntries(); }
  snapshotPresentation(): unknown { return this.#controller.snapshotPresentation(); }
  clearPresentation(): void { this.#controller.clearPresentation(); }
  restorePresentation(snapshot: unknown): void { this.#controller.restorePresentation(snapshot); }
}

/**
 * Internal compatibility port factory. The production controller consumes the
 * returned command/query contracts; only this adapter knows the legacy stage.
 */
export interface PresentationPorts {
  readonly commands: RendererCommands;
  readonly queries: RendererQueries;
}

export interface PresentationPortOptions {
  readonly assetRegistry?: RenderAssetRegistry;
  readonly resourceSnapshot?: () => RendererResourceSnapshot;
  /** M7 production WorldLayer port; omitted for legacy stage compatibility. */
  readonly worldLayer?: WorldProjectionPort;
}

type PresentationStage = AdvStage & {
  registerBackground?: (key: string, source: string, format?: string) => Promise<void>;
  registerPortrait?: (charId: string, costume: string, expression: string, source: string, format?: string) => Promise<void>;
  registerAvatar?: (key: string, source: string, format?: string) => Promise<void>;
  registerFontRole?: (role: RendererFontRole, url: string, family?: string, timeoutMs?: number) => Promise<boolean>;
  registerFont?: (url: string, family?: string, timeoutMs?: number) => Promise<boolean>;
  resetFonts?: () => void;
  resetFont?: () => void;
  releaseRegisteredAssetSources?: () => Promise<void>;
  captureThumbnail?: () => string | null;
  validatePresentation?: (snapshot: unknown) => void;
  getFontFamily?: (role: RendererFontRole) => string;
};

const EMPTY_RESOURCE_SNAPSHOT: RendererResourceSnapshot = {
  disposed: false,
  tickerCallbacks: null,
  listeners: null,
  activeTweens: null,
  activeAsyncTasks: null,
  blobUrls: null,
  pooledObjects: {},
  displayObjectsByOwner: {},
};

/**
 * Builds the narrow command/query projection consumed by PresentationController.
 * It is deliberately stage-backed only at this compatibility boundary; the
 * controller itself never imports or calls AdvStage methods.
 */
export function createPresentationPorts(
  stage: PresentationStage,
  options: PresentationPortOptions = {},
): PresentationPorts {
  const assetCommands: RendererCommands['assets'] = {
    registerBackground: async (key, source, format) => {
      if (options.assetRegistry) {
        await options.assetRegistry.registerBackground(key, source, format);
        return;
      }
      await stage.registerBackground?.(key, source, format);
    },
    registerPortrait: async (charId, costume, expression, source, format) => {
      if (options.assetRegistry) {
        await options.assetRegistry.registerPortrait(charId, costume, expression, source, format);
        return;
      }
      await stage.registerPortrait?.(charId, costume, expression, source, format);
    },
    registerAvatar: async (key, source, format) => {
      if (options.assetRegistry) {
        await options.assetRegistry.registerAvatar(key, source, format);
        return;
      }
      await stage.registerAvatar?.(key, source, format);
    },
    registerFontRole: async (role, url, family, timeoutMs) => stage.registerFontRole?.(role, url, family, timeoutMs) ?? false,
    registerFont: async (url, family, timeoutMs) => stage.registerFont?.(url, family, timeoutMs) ?? false,
    resetFonts: () => {
      if (options.assetRegistry) options.assetRegistry.resetFonts();
      else stage.resetFonts?.();
    },
    resetFont: () => {
      if (options.assetRegistry) options.assetRegistry.resetFonts();
      else stage.resetFont?.();
    },
    releaseRegisteredAssetSources: async () => {
      if (options.assetRegistry) await options.assetRegistry.releaseRegisteredAssetSources();
      else await stage.releaseRegisteredAssetSources?.();
    },
  };

  const worldCommands: RendererCommands['world'] = {
    setBackground: (key) => { if (options.worldLayer) options.worldLayer.setBackground(key); else stage.setBackground(key); },
    setPortrait: (key, view) => { if (options.worldLayer) options.worldLayer.setPortrait(key, view); else stage.setPortrait(key, view); },
    removePortrait: (key) => { if (options.worldLayer) options.worldLayer.removePortrait(key); else stage.removePortrait(key); },
    setFade: (alpha) => { if (options.worldLayer) options.worldLayer.setFade(alpha); else stage.setFade(alpha); },
    shake: (durationMs = 400, strength = 8, direction = 'both') => { if (options.worldLayer) options.worldLayer.shake(durationMs, strength, direction); else stage.shake?.(durationMs, strength, direction); },
    transition: (name, durationMs) => options.worldLayer?.transition(name, durationMs) ?? stage.transition?.(name, durationMs) ?? false,
    flash: (durationMs = 300) => { if (options.worldLayer) options.worldLayer.flash(durationMs); else stage.flash?.(durationMs); },
    zoom: (scale = 1, durationMs = 400) => { if (options.worldLayer) options.worldLayer.zoom(scale, durationMs); else stage.zoom?.(scale, durationMs); },
    wipe: (durationMs = 600) => { if (options.worldLayer) options.worldLayer.wipe(durationMs); else stage.wipe?.(durationMs); },
    movePortrait: (key, pos, durationMs = 400) => { if (options.worldLayer) options.worldLayer.movePortrait(key, pos, durationMs); else stage.movePortrait?.(key, pos, durationMs); },
    setTint: (color, alpha, durationMs = 400) => { if (options.worldLayer) options.worldLayer.setTint(color, alpha, durationMs); else stage.setTint?.(color, alpha, durationMs); },
    clearTint: (durationMs = 400) => { if (options.worldLayer) options.worldLayer.clearTint(durationMs); else stage.clearTint?.(durationMs); },
    startParticles: (kind) => { if (options.worldLayer) options.worldLayer.startParticles(kind); else stage.startParticles?.(kind); },
    stopParticles: () => { if (options.worldLayer) options.worldLayer.stopParticles(); else stage.stopParticles?.(); },
    applyTimelineFrame: (event) => { if (options.worldLayer) options.worldLayer.applyTimelineFrame(event); else stage.applyTimelineFrame?.(event); },
    setPortraitFocus: (characterId) => { if (options.worldLayer) options.worldLayer.setPortraitFocus(characterId); else stage.setPortraitFocus?.(characterId); },
  };

  const dialogueCommands: RendererCommands['dialogue'] = {
    showText: (speaker, value) => stage.showText(speaker, value),
    showChoices: (options) => stage.showChoices([...options]),
    hideChoices: () => stage.hideChoices(),
    setAwaiting: (awaiting) => stage.setAwaiting?.(awaiting),
    showBacklog: (entries, onReplayVoice, query) => stage.showBacklog?.(entries, onReplayVoice, query),
    hideBacklog: () => stage.hideBacklog?.(),
    setNvlMode: (on) => stage.setNvlMode?.(on),
    appendNvlText: (speaker, text) => stage.appendNvlText?.(speaker, text),
    clearNvlText: () => stage.clearNvlText?.(),
    showBanner: (text, variant) => stage.showBanner?.(text, variant),
    setChoiceHighlight: (position) => stage.setChoiceHighlight?.(position),
    scrollBacklog: (delta) => stage.scrollBacklog?.(delta),
    hideInterface: (hidden) => stage.hideInterface?.(hidden),
    setSpeakerProfiles: (profiles) => stage.setSpeakerProfiles?.([...profiles]),
    setActiveSpeaker: (characterId) => stage.setActiveSpeaker?.(characterId),
    showCommandRail: (items, onSelect) => stage.showCommandRail?.([...items], onSelect),
    setCommandRailItems: (items) => stage.setCommandRailItems?.([...items]),
    hideCommandRail: () => stage.hideCommandRail?.(),
  };

  const menuCommands: RendererCommands['menu'] = {
    showTitle: () => undefined,
    hideTitle: () => undefined,
    showEnding: () => undefined,
    hideEnding: () => undefined,
    showSystemMenu: () => undefined,
    hideSystemMenu: () => undefined,
    showSettings: () => undefined,
    hideSettings: () => undefined,
    showSaveLoad: () => undefined,
    hideSaveLoad: () => undefined,
  };

  const galleryCommands: RendererCommands['gallery'] = {
    showGallery: () => undefined,
    hideGallery: () => undefined,
  };

  const systemCommands: RendererCommands['system'] = {
    showBattle: () => undefined,
    hideBattle: () => undefined,
    showMap: () => undefined,
    hideMap: () => undefined,
    showShop: () => undefined,
    hideShop: () => undefined,
    showBaseCommands: () => undefined,
    hideBaseCommands: () => undefined,
    showVideo: (source, onEnd) => {
      if (stage.showVideo) stage.showVideo(source, onEnd);
      else onEnd();
    },
    hideVideo: () => stage.hideVideo?.(),
  };

  const loadingCommands: RendererCommands['loading'] = {
    showLoading: (progress) => stage.showLoading?.(progress),
    hideLoading: () => stage.hideLoading?.(),
  };

  const preferenceCommands: RendererCommands['preferences'] = {
    setQuality: (quality) => { if (options.worldLayer) options.worldLayer.setQuality(quality); else stage.setQuality?.(quality); },
    setPresentationPreferences: (preferences) => { if (options.worldLayer) options.worldLayer.setPresentationPreferences(preferences); else stage.setPresentationPreferences?.(preferences); },
    setPostProcess: (settings) => { if (options.worldLayer) options.worldLayer.setPostProcess(settings); else stage.setPostProcess?.(settings); },
  };

  const presentationCommands: RendererCommands['presentation'] = {
    validate: (snapshot) => {
      if (options.worldLayer?.validatePresentation) {
        const raw = snapshot as Record<string, unknown>;
        options.worldLayer.validatePresentation(raw.stage ?? null);
      } else {
        const raw = snapshot as Record<string, unknown>;
        stage.validatePresentation?.(raw.stage ?? null);
      }
    },
    restore: (snapshot) => { if (options.worldLayer) options.worldLayer.restorePresentation(snapshot); else stage.restorePresentation?.(snapshot); },
    clear: () => { if (options.worldLayer) options.worldLayer.clearPresentation(); else stage.clearPresentation?.(); },
  };

  const commands: RendererCommands = {
    assets: assetCommands,
    world: worldCommands,
    dialogue: dialogueCommands,
    menu: menuCommands,
    gallery: galleryCommands,
    system: systemCommands,
    loading: loadingCommands,
    preferences: preferenceCommands,
    presentation: presentationCommands,
  };

  const queries: RendererQueries = {
    world: {
      captureThumbnail: () => options.worldLayer?.captureThumbnail() ?? stage.captureThumbnail?.() ?? null,
    },
    dialogue: {
      backlogEntries: (): readonly BacklogEntry[] => [],
      backlogSearchQuery: () => '',
    },
    overlay: {
      menu: () => ({ type: 'none' }),
      gallery: () => ({ type: 'none' }),
      system: () => ({ type: 'none' }),
    },
    preferences: {
      quality: () => options.worldLayer?.getQuality() ?? stage.getQuality?.() ?? 'balanced',
      presentationPreferences: (): PresentationPreferences => ({
        ...(options.worldLayer?.getPresentationPreferences() ?? stage.getPresentationPreferences?.() ?? DEFAULT_PRESENTATION_PREFERENCES),
      }),
      postProcess: (): PostProcessSettings => ({
        ...(options.worldLayer?.getPostProcess() ?? stage.getPostProcess?.() ?? DEFAULT_POST_PROCESS),
      }),
      fontFamily: (role) => stage.getFontFamily?.(role) ?? '',
    },
    presentation: {
      snapshot: () => options.worldLayer?.snapshotPresentation() ?? stage.snapshotPresentation?.() ?? null,
    },
    diagnostics: {
      resourceSnapshot: () => options.resourceSnapshot?.() ?? { ...EMPTY_RESOURCE_SNAPSHOT },
      performanceSnapshot: () => stage.getPerformanceSnapshot?.() ?? null,
      needsUpdate: () => stage.needsUpdate?.() !== false,
      isDisposed: () => false,
    },
  };

  return { commands, queries };
}
