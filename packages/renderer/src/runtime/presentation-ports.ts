import type { BacklogEntry } from '../backlog.js';
import { RendererError } from '../api/renderer-errors.js';
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
import { createRendererTheme, type RendererTheme } from '../theme.js';

/**
 * Narrow stage capability consumed only by the runtime port factory.
 * It is deliberately composed from v2 command contracts instead of the
 * historical stage interface.
 */
export interface PresentationStage extends
  Partial<WorldCommands>,
  Partial<Omit<DialogueCommands, 'showChoices' | 'setSpeakerProfiles' | 'showCommandRail' | 'setCommandRailItems'>>,
  Partial<Omit<PreferenceCommands, 'setTheme'>>,
  Partial<LoadingCommands> {
  showChoices?: (options: ChoiceOptionView[]) => void;
  setSpeakerProfiles?: (profiles: SpeakerProfile[]) => void;
  showCommandRail?: (items: CommandRailItem[], onSelect: (id: string) => void) => void;
  setCommandRailItems?: (items: CommandRailItem[]) => void;
  registerBackground?: (key: string, source: string, format?: string) => Promise<void>;
  registerPortrait?: (charId: string, costume: string, expression: string, source: string, format?: string, sourcePath?: string) => Promise<void>;
  registerAvatar?: (key: string, source: string, format?: string) => Promise<void>;
  registerRule?: (key: string, source: string, format?: string) => Promise<void>;
  registerFontRole?: (role: RendererFontRole, url: string, family?: string, timeoutMs?: number) => Promise<boolean>;
  registerFont?: (url: string, family?: string, timeoutMs?: number) => Promise<boolean>;
  resetFonts?: () => void;
  resetFont?: () => void;
  releaseRegisteredAssetSources?: () => Promise<void>;
  captureThumbnail?: () => string | null;
  isFadeActive?: () => boolean;
  validatePresentation?: (snapshot: unknown) => void;
  getFontFamily?: (role: RendererFontRole) => string;
  showVideo?: (source: string, onEnd: (failure?: Error) => void) => void;
  hideVideo?: () => void;
  getQuality?: () => RenderQuality;
  getPresentationPreferences?: () => PresentationPreferences;
  getPostProcess?: () => PostProcessSettings;
  getPerformanceSnapshot?: () => RenderPerformanceSnapshot | null;
  needsUpdate?: () => boolean;
  snapshotPresentation?: () => unknown;
  restorePresentation?: (snapshot: unknown) => void;
  clearPresentation?: () => void;
  setTheme?: (theme: RendererTheme) => void;
  setDeclarativeUiSuppression?: (pages: Partial<Record<import('@surdet/core').ProjectUiPageId, boolean>>) => void;
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
  readonly menuLayer?: Pick<import('../api/renderer-commands.js').MenuProjectionPort, 'menu'>;
  readonly assetRegistry?: RenderAssetRegistry;
  readonly resourceSnapshot?: () => RendererResourceSnapshot;
  /** M7 production WorldLayer port; omitted for legacy stage compatibility. */
  readonly worldLayer?: WorldProjectionPort;
  /** Composition-root read model; returns plain semantic data, never a Layer. */
  readonly projectionSnapshot?: () => RendererProjectionSnapshot;
  /** Read-only dialogue projection used for NVL snapshots and World focus coordination. */
  readonly dialogueLayer?: Pick<import('../api/renderer-commands.js').DialogueProjectionPort, 'nvlPresentationEntries' | 'activeSpeakerId' | 'projectionVersion'>;
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
    registerRule: async (key, source, format) => {
      if (options.assetRegistry) await options.assetRegistry.registerRule(key, source, format);
      else if (stage.registerRule) await stage.registerRule(key, source, format);
      else throw new Error('当前宿主未接入转场遮罩素材');
    },
    registerBackground: async (key, source, format) => {
      if (options.assetRegistry) {
        await options.assetRegistry.registerBackground(key, source, format);
        return;
      }
      await stage.registerBackground?.(key, source, format);
    },
    registerPortrait: async (charId, costume, expression, source, format, sourcePath) => {
      if (options.assetRegistry) {
        await options.assetRegistry.registerPortrait(charId, costume, expression, source, format, sourcePath);
        return;
      }
      await stage.registerPortrait?.(charId, costume, expression, source, format, sourcePath);
    },
    registerPortraitVisual: async (charId, costume, expression, definition, sources) => {
      if (!options.assetRegistry) throw new Error('Dynamic portrait asset registry is not configured');
      await options.assetRegistry.registerPortraitVisual(charId, costume, expression, definition, sources);
    },
    registerVideo: async (key, source, sourcePath) => {
      if (!options.assetRegistry) throw new Error('Video asset registry is not configured');
      await options.assetRegistry.registerVideo(key, source, sourcePath);
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
    setStoryFilter: options.worldLayer?.setStoryFilter
      ? (name, durationMs) => options.worldLayer!.setStoryFilter!(name, durationMs) : stage.setStoryFilter?.bind(stage),
    markStageBoundary: options.worldLayer?.markStageBoundary
      ? () => options.worldLayer!.markStageBoundary!() : stage.markStageBoundary?.bind(stage),
    setBackground: (key) => { if (options.worldLayer) options.worldLayer.setBackground(key); else stage.setBackground(key); },
    setPortrait: (key, view) => { if (options.worldLayer) options.worldLayer.setPortrait(key, view); else stage.setPortrait(key, view); },
    removePortrait: (key) => { if (options.worldLayer) options.worldLayer.removePortrait(key); else stage.removePortrait(key); },
    setFade: (alpha) => { if (options.worldLayer) options.worldLayer.setFade(alpha); else stage.setFade?.(alpha); },
    fade: options.worldLayer?.fade ? (from, to, durationMs) => options.worldLayer!.fade!(from, to, durationMs)
      : stage.fade ? (from, to, durationMs) => stage.fade!(from, to, durationMs) : undefined,
    shake: (durationMs = 400, strength = 8, direction = 'both') => { if (options.worldLayer) options.worldLayer.shake(durationMs, strength, direction); else stage.shake?.(durationMs, strength, direction); },
    transition: (name, durationMs, rule) => options.worldLayer?.transition(name, durationMs, rule) ?? stage.transition?.(name, durationMs, rule) ?? false,
    flash: (durationMs = 300) => { if (options.worldLayer) options.worldLayer.flash(durationMs); else stage.flash?.(durationMs); },
    zoom: (scale = 1, durationMs = 400) => { if (options.worldLayer) options.worldLayer.zoom(scale, durationMs); else stage.zoom?.(scale, durationMs); },
    wipe: (durationMs = 600) => { if (options.worldLayer) options.worldLayer.wipe(durationMs); else stage.wipe?.(durationMs); },
    movePortrait: (key, pos, durationMs = 400) => { if (options.worldLayer) options.worldLayer.movePortrait(key, pos, durationMs); else stage.movePortrait?.(key, pos, durationMs); },
    setTint: (color, alpha, durationMs = 400) => { if (options.worldLayer) options.worldLayer.setTint(color, alpha, durationMs); else stage.setTint?.(color, alpha, durationMs); },
    clearTint: (durationMs = 400) => { if (options.worldLayer) options.worldLayer.clearTint(durationMs); else stage.clearTint?.(durationMs); },
    startParticles: (kind) => { if (options.worldLayer) options.worldLayer.startParticles(kind); else stage.startParticles?.(kind); },
    stopParticles: () => { if (options.worldLayer) options.worldLayer.stopParticles(); else stage.stopParticles?.(); },
    applyStage: options.worldLayer?.applyStage || stage.applyStage ? (command) => { if (options.worldLayer?.applyStage) options.worldLayer.applyStage(command); else stage.applyStage!(command); } : undefined,
    applyTimelineFrame: (event) => { if (options.worldLayer) options.worldLayer.applyTimelineFrame(event); else stage.applyTimelineFrame?.(event); },
    setPortraitFocus: (characterId) => { if (options.worldLayer) options.worldLayer.setPortraitFocus(characterId); else stage.setPortraitFocus?.(characterId); },
    setPortraitSpeaking: (speaking) => { if (options.worldLayer) options.worldLayer.setPortraitSpeaking?.(speaking); else stage.setPortraitSpeaking?.(speaking); },
    setPortraitSkipping: (skipping) => { if (options.worldLayer) options.worldLayer.setPortraitSkipping?.(skipping); else stage.setPortraitSkipping?.(skipping); },
  };

  const projectDialogue = (project: () => void): void => {
    const dialogue = options.dialogueLayer;
    const before = dialogue?.projectionVersion;
    project();
    if (dialogue && dialogue.projectionVersion !== before) {
      worldCommands.setPortraitFocus(dialogue.activeSpeakerId);
    }
  };
  const dialogueCommands: RendererCommands['dialogue'] = {
    showText: (speaker, value, visibleUnits) => projectDialogue(() => stage.showText(speaker, value, visibleUnits)),
    beginText: (speaker, value = '', visibleUnits) => projectDialogue(() => {
      if (stage.beginText) stage.beginText(speaker, value, visibleUnits);
      else stage.showText(speaker, value, visibleUnits);
    }),
    clearText: () => projectDialogue(() => {
      if (stage.clearText) stage.clearText();
      else stage.showText(null, '');
    }),
    showChoices: (options) => stage.showChoices([...options]),
    hideChoices: () => stage.hideChoices(),
    setAwaiting: (awaiting) => stage.setAwaiting?.(awaiting),
    showBacklog: (entries, onReplayVoice, query) => stage.showBacklog?.(entries, onReplayVoice, query),
    hideBacklog: () => stage.hideBacklog?.(),
    setNvlMode: (on) => stage.setNvlMode?.(on),
    appendNvlText: (speaker, text, markup) => projectDialogue(() => stage.appendNvlText?.(speaker, text, markup)),
    setTextSkipping: (skipping) => stage.setTextSkipping?.(skipping),
    clearNvlText: () => projectDialogue(() => stage.clearNvlText?.()),
    showBanner: (text, variant) => stage.showBanner?.(text, variant),
    setChoiceHighlight: (position) => stage.setChoiceHighlight?.(position),
    scrollBacklog: (delta) => stage.scrollBacklog?.(delta),
    hideInterface: (hidden) => stage.hideInterface?.(hidden),
    setSpeakerProfiles: (profiles) => stage.setSpeakerProfiles?.([...profiles]),
    setActiveSpeaker: (characterId) => {
      stage.setActiveSpeaker?.(characterId);
      if (options.dialogueLayer) worldCommands.setPortraitFocus(options.dialogueLayer.activeSpeakerId);
    },
    showCommandRail: (items, onSelect) => stage.showCommandRail?.([...items], onSelect),
    setCommandRailItems: (items) => stage.setCommandRailItems?.([...items]),
    hideCommandRail: () => stage.hideCommandRail?.(),
    restoreCommandRail: () => stage.restoreCommandRail?.(),
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
      else onEnd(new RendererError(`视频 ${source} 无法播放：当前舞台没有视频播放能力`,
        { code: 'MEDIA_PLAYBACK_FAILED', domain: 'video', command: 'showVideo' }));
    },
    hideVideo: () => stage.hideVideo?.(),
  };

  const loadingCommands: RendererCommands['loading'] = {
    showLoading: (progress) => stage.showLoading?.(progress),
    hideLoading: () => stage.hideLoading?.(),
  };

  let theme: RendererTheme = createRendererTheme();
  const preferenceCommands: RendererCommands['preferences'] = {
    setQuality: (quality) => { if (options.worldLayer) options.worldLayer.setQuality(quality); else stage.setQuality?.(quality); },
    setPresentationPreferences: (preferences) => {
      // The composition root also projects dialogue preferences, not only World.
      if (stage.setPresentationPreferences) stage.setPresentationPreferences(preferences);
      else options.worldLayer?.setPresentationPreferences(preferences);
    },
    setReadingPreferences: (preferences) => {
      stage.setReadingPreferences?.(preferences);
    },
    setPostProcess: (settings) => { if (options.worldLayer) options.worldLayer.setPostProcess(settings); else stage.setPostProcess?.(settings); },
    setTheme: (overrides) => {
      theme = createRendererTheme(overrides);
      stage.setTheme?.(theme);
    },
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
    projectUi: { setDefaultSuppression: (pages) => stage.setDeclarativeUiSuppression?.(pages) },
  };

  const queries: RendererQueries = {
    world: {
      isFadeActive: () => options.worldLayer?.isFadeActive?.() ?? stage.isFadeActive?.() ?? false,
      inspectStage: () => options.worldLayer?.inspectStage?.() ?? null,
      captureThumbnail: () => options.worldLayer?.captureThumbnail() ?? stage.captureThumbnail?.() ?? null,
    },
    dialogue: {
      backlogEntries: (): readonly BacklogEntry[] => [],
      backlogSearchQuery: () => '',
      nvlPresentationEntries: () => (options.dialogueLayer?.nvlPresentationEntries ?? []).map((entry) => ({ ...entry })),
    },
    overlay: {
      menu: () => options.menuLayer?.menu() ?? { type: 'none' },
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
      theme: () => theme,
    },
    presentation: {
      snapshot: () => options.worldLayer?.snapshotPresentation() ?? stage.snapshotPresentation?.() ?? null,
      canCaptureRollbackCheckpoint: () => true,
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
