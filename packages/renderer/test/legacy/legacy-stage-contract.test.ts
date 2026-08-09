import { describe, expect, it } from 'vitest';
import { LegacyStageAdapter } from '../../src/legacy/legacy-stage-adapter.js';

const legacyStageMethods = [
  'init', 'fitWindow', 'setQuality', 'getQuality', 'setPresentationPreferences',
  'getPresentationPreferences', 'setPostProcess', 'getPostProcess', 'setFrameRequest',
  'registerBackground', 'getFontFamily', 'registerFontRole', 'registerFont', 'resetFonts',
  'resetFont', 'registerPortrait', 'registerAvatar', 'releaseRegisteredAssetSources',
  'setSpeakerProfiles', 'setActiveSpeaker', 'setPortraitFocus', 'setBackground', 'setPortrait',
  'removePortrait', 'showText', 'setAwaiting', 'needsUpdate', 'updateContinuePulse',
  'showBacklog', 'hideInterface', 'showCommandRail', 'setCommandRailItems', 'hideCommandRail',
  'restoreCommandRail', 'scrollBacklog', 'captureThumbnail', 'hideBacklog', 'applyTimelineFrame',
  'snapshotPresentation', 'validatePresentation', 'restorePresentation', 'clearPresentation',
  'shake', 'transition', 'flash', 'zoom', 'updateEffects', 'wipe', 'movePortrait', 'setTint',
  'clearTint', 'startParticles', 'stopParticles', 'showBanner', 'setNvlMode', 'appendNvlText',
  'clearNvlText', 'hideVideo', 'showVideo', 'showGallery', 'hideGallery', 'showSettings',
  'hideSettings', 'showBattle', 'hideBattle', 'showTitle', 'hideTitle', 'showEnding', 'hideEnding',
  'showSystemMenu', 'hideSystemMenu', 'showSaveLoad', 'hideSaveLoad', 'showMap', 'hideMap',
  'showShop', 'hideShop', 'showBaseCommands', 'hideBase', 'showChoices', 'setChoiceHighlight',
  'hideChoices', 'setFade', 'showLoading', 'hideLoading', 'resetSession', 'destroy',
] as const satisfies readonly (keyof LegacyStageAdapter)[];

describe('legacy stage adapter contract', () => {
  it('keeps every public legacy stage method available as a forwarding adapter', () => {
    const stage = new LegacyStageAdapter();
    try {
      for (const method of legacyStageMethods) {
        expect(typeof (stage as unknown as Record<string, unknown>)[method]).toBe('function');
      }
      expect(stage.app).toBeNull();
      expect(stage.onSelect).toBeNull();
      expect(stage.onBacklogClose).toBeNull();
    } finally {
      stage.destroy();
    }
  });
});
