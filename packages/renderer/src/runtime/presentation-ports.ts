import type { BacklogEntry } from '../backlog.js';
import { DEFAULT_POST_PROCESS, type PostProcessSettings } from '../post-process.js';
import { DEFAULT_PRESENTATION_PREFERENCES, type PresentationPreferences } from '../presentation.js';
import type {
  ChoiceOptionView,
  CommandRailItem,
  SpeakerProfile,
} from '../types.js';
import type { RenderPerformanceSnapshot } from '../performance.js';
import type { RenderQuality } from '../quality.js';
import type {
  DialogueCommands,
  LoadingCommands,
  PreferenceCommands,
  PresentationCommands,
  RendererCommands,
  RendererFontRole,
  WorldCommands,
  WorldProjectionPort,
} from '../api/renderer-commands.js';
import type { RendererProjectionSnapshot, RendererQueries } from '../api/renderer-queries.js';
import type { RendererResourceSnapshot } from '../diagnostics/renderer-baseline.js';
import type { RenderAssetRegistry } from '../services/render-asset-registry.js';
import { preparePresentationRestore } from './presentation-controller.js';

/**
 * Narrow stage capability consumed only by the runtime port factory.
 * It is deliberately composed from v2 command contracts instead of the
 * historical stage interface.
 */
export interface PresentationStage extends
  Partial<WorldCommands>,
  Partial<Omit<DialogueCommands, 'showChoices' | 'setSpeakerProfiles' | 'showCommandRail' | 'setCommandRailItems'>>,
  Partial<PreferenceCommands>,
  Partial<LoadingCommands> {
  showChoices?: (options: ChoiceOptionView[]) => void;
  setSpeakerProfiles?: (profiles: SpeakerProfile[]) => void;
  showCommandRail?: (items: CommandRailItem[], onSelect: (id: string) => void) => void;
  setCommandRailItems?: (items: CommandRailItem[]) => void;
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
  showVideo?: (source: string, onEnd: () => void) => void;
  hideVideo?: () => void;
  getQuality?: () => RenderQuality;
  getPresentationPreferences?: () => PresentationPreferences;
  getPostProcess?: () => PostProcessSettings;
  getPerformanceSnapshot?: () => RenderPerformanceSnapshot | null;
  needsUpdate?: () => boolean;
  snapshotPresentation?: () => unknown;
  restorePresentation?: (snapshot: unknown) => void;
  clearPresentation?: () => void;
}

interface PresentationPortStage extends PresentationStage {
  setBackground: WorldCommands['setBackground'];
  setPortrait: WorldCommands['setPortrait'];
  removePortrait: WorldCommands['removePortrait'];
  showText: DialogueCommands['showText'];
  showChoices: (options: ChoiceOptionView[]) => void;
  hideChoices: DialogueCommands['hideChoices'];
}

export interface PresentationPorts {
  readonly commands: RendererCommands;
  readonly queries: RendererQueries;
  /** Internal narrow port: accepts only a complete snapshot's `stage` field. */
  readonly validateStagePresentation?: (snapshot: unknown) => void;
}

export interface PresentationPortOptions {
  readonly assetRegistry?: RenderAssetRegistry;
  readonly resourceSnapshot?: () => RendererResourceSnapshot;
  /** M7 production WorldLayer port; omitted for legacy stage compatibility. */
  readonly worldLayer?: WorldProjectionPort;
  /** Composition-root read model; returns plain semantic data, never a Layer. */
  readonly projectionSnapshot?: () => RendererProjectionSnapshot;
}

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
 * controller itself never imports or calls a legacy stage type.
 */
export function createPresentationPorts(
  stage: PresentationPortStage,
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
    setFade: (alpha) => { if (options.worldLayer) options.worldLayer.setFade(alpha); else stage.setFade?.(alpha); },
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

  const validateStagePresentation = options.worldLayer?.validatePresentation
    ? (snapshot: unknown) => options.worldLayer!.validatePresentation!.call(options.worldLayer, snapshot)
    : stage.validatePresentation
      ? (snapshot: unknown) => stage.validatePresentation!.call(stage, snapshot)
      : () => undefined;

  const presentationCommands: PresentationCommands = {
    validate: (snapshot) => {
      preparePresentationRestore(snapshot, validateStagePresentation);
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
      projectionSnapshot: () => options.projectionSnapshot?.() ?? {
        dialogue: null,
        menu: null,
        gallery: null,
        system: null,
        world: null,
      },
      needsUpdate: () => stage.needsUpdate?.() !== false,
      isDisposed: () => false,
    },
  };

  return { commands, queries, validateStagePresentation };
}
