import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PixiStage } from '../../src/pixi-stage.js';
import type { SaveLoadView, SystemMenuItemView, TitleView } from '../../src/ui-views.js';
import type { SettingsRowView } from '../../src/settings-store.js';

describe('legacy menu projection contract', () => {
  beforeEach(() => {
    class FakeCanvasRenderingContext2D {
      font = '';

      measureText(text: string) {
        return {
          width: text.length * 10,
          actualBoundingBoxAscent: 20,
          actualBoundingBoxDescent: 5,
        };
      }
    }
    const context = new FakeCanvasRenderingContext2D();
    vi.stubGlobal('CanvasRenderingContext2D', FakeCanvasRenderingContext2D);
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => context }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps title, ending, system, settings, and save/load modes repeatable', () => {
    const stage = new PixiStage();
    const select = vi.fn();
    const close = vi.fn();
    const title: TitleView = {
      title: 'Surdet',
      subtitle: '夜行记录',
      backgroundKey: 'missing-title-bg',
      items: [
        { id: 'continue', label: '继续', enabled: false },
        { id: 'start', label: '开始', enabled: true },
      ],
    };
    const systemItems: SystemMenuItemView[] = [{ id: 'settings', label: '设置' }];
    const settings: SettingsRowView[] = [{ id: 'textSpeed', label: '文字速度', display: '普通' }];
    const saveLoad: SaveLoadView = {
      mode: 'save',
      slots: [
        { id: 'slot-1', empty: false, label: '序章', kind: 'manual' },
        { id: 'slot-2', empty: true, kind: 'quick' },
      ],
    };

    try {
      expect(() => {
        stage.showTitle(title, select);
        stage.showTitle({ ...title, items: title.items.slice().reverse() }, select);
        stage.hideTitle();
        stage.hideTitle();

        stage.showEnding('THE END');
        stage.showEnding('THE END');
        stage.hideEnding();
        stage.hideEnding();

        stage.showSystemMenu(systemItems, select, close);
        stage.showSystemMenu(systemItems.slice(), select, close);
        stage.hideSystemMenu();
        stage.hideSystemMenu();

        stage.showSettings(settings, vi.fn(), close);
        stage.showSettings(settings.slice(), vi.fn(), close);
        stage.hideSettings();
        stage.hideSettings();

        stage.showSaveLoad(saveLoad, select, close);
        stage.showSaveLoad({ ...saveLoad, mode: 'load', slots: saveLoad.slots.slice() }, select, close);
        stage.hideSaveLoad();
        stage.hideSaveLoad();
      }).not.toThrow();
    } finally {
      stage.resetSession({ preserveWorld: true });
      stage.destroy();
      stage.destroy();
    }
  });

  it('preserves legacy cross-overlay coordination and reset cleanup', () => {
    const stage = new PixiStage();
    const hideEnding = vi.spyOn(stage, 'hideEnding');
    const hideCommandRail = vi.spyOn(stage, 'hideCommandRail');
    const hideSaveLoad = vi.spyOn(stage, 'hideSaveLoad');
    const hideGallery = vi.spyOn(stage, 'hideGallery');
    const hideSettings = vi.spyOn(stage, 'hideSettings');

    try {
      stage.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      expect(hideEnding).toHaveBeenCalled();
      expect(hideCommandRail).toHaveBeenCalled();

      hideEnding.mockClear();
      hideCommandRail.mockClear();
      hideSaveLoad.mockClear();
      hideGallery.mockClear();
      hideSettings.mockClear();
      stage.showEnding();
      expect(hideCommandRail).toHaveBeenCalled();
      expect(hideGallery).toHaveBeenCalled();
      expect(hideSettings).toHaveBeenCalled();
      expect(hideSaveLoad).toHaveBeenCalled();
      // showEnding rebuilds its own black card directly; it does not call hideEnding first.
      expect(hideEnding).not.toHaveBeenCalled();

      hideSaveLoad.mockClear();
      hideGallery.mockClear();
      hideCommandRail.mockClear();
      stage.showSettings([], vi.fn(), vi.fn());
      expect(hideSaveLoad).toHaveBeenCalled();
      expect(hideGallery).toHaveBeenCalled();
      expect(hideCommandRail).toHaveBeenCalled();

      stage.resetSession({ preserveWorld: true });
      stage.hideSettings();
      stage.hideSaveLoad();
      stage.hideSystemMenu();
      stage.hideTitle();
      stage.hideEnding();
    } finally {
      stage.destroy();
    }
  });

  it('wraps legacy settings and save/load callbacks with one command-rail restore', () => {
    const stage = new PixiStage();
    const settingsClose = vi.fn();
    const saveSelect = vi.fn();
    const saveClose = vi.fn();
    const settingsProjection = vi.spyOn(stage.menuLayer, 'showSettings');
    const saveLoadProjection = vi.spyOn(stage.menuLayer, 'showSaveLoad');
    const restoreCommandRail = vi.spyOn(stage, 'restoreCommandRail');

    try {
      stage.showSettings([], vi.fn(), settingsClose);
      const wrappedSettingsClose = settingsProjection.mock.calls[0]?.[2];
      expect(wrappedSettingsClose).not.toBe(settingsClose);
      restoreCommandRail.mockClear();
      wrappedSettingsClose?.();
      expect(restoreCommandRail).toHaveBeenCalledOnce();
      expect(settingsClose).toHaveBeenCalledOnce();

      stage.showSaveLoad({ mode: 'load', slots: [{ id: 'slot-1', empty: false, label: '序章' }] }, saveSelect, saveClose);
      const wrappedSaveSelect = saveLoadProjection.mock.calls[0]?.[1];
      const wrappedSaveClose = saveLoadProjection.mock.calls[0]?.[2];
      expect(wrappedSaveSelect).not.toBe(saveSelect);
      expect(wrappedSaveClose).not.toBe(saveClose);
      restoreCommandRail.mockClear();
      wrappedSaveSelect?.('slot-1');
      expect(restoreCommandRail).toHaveBeenCalledOnce();
      expect(saveSelect).toHaveBeenCalledOnce();
      restoreCommandRail.mockClear();
      wrappedSaveClose?.();
      expect(restoreCommandRail).toHaveBeenCalledOnce();
      expect(saveClose).toHaveBeenCalledOnce();
    } finally {
      stage.destroy();
    }
  });
});
