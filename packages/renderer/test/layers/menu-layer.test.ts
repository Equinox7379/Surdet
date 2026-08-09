import { describe, expect, it, vi } from 'vitest';
import type { MenuOverlayState } from '../../src/api/renderer-queries.js';
import type { RendererControllerPort, RendererStagePort } from '../../src/runtime/renderer-facade.js';
import { RendererFacade } from '../../src/runtime/renderer-facade.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import type { SaveLoadView, SettingsRowView, SystemMenuItemView, TitleView } from '../../src/ui-views.js';

interface MenuHarness {
  readonly facade: RendererFacade;
  readonly stage: RendererStagePort;
  readonly showTitle: ReturnType<typeof vi.fn>;
  readonly showSystemMenu: ReturnType<typeof vi.fn>;
  readonly showSettings: ReturnType<typeof vi.fn>;
  readonly showSaveLoad: ReturnType<typeof vi.fn>;
}

function makeController(): RendererControllerPort {
  return {
    status: 'idle',
    autoPlay: false,
    skipMode: false,
    skipAll: false,
    backlogOpen: false,
    interfaceHidden: false,
    needsUpdate: false,
    update: () => undefined,
    setFrameRequest: () => undefined,
    connect: () => () => undefined,
    disconnect: () => undefined,
    reset: () => undefined,
    advance: () => false,
    select: () => false,
    dispatchInput: () => false,
    setTextSpeed: () => undefined,
    setAutoWait: () => undefined,
    dispose: () => undefined,
    snapshotPresentation: () => null,
  } as unknown as RendererControllerPort;
}

function makeHarness(): MenuHarness {
  const showTitle = vi.fn();
  const showSystemMenu = vi.fn();
  const showSettings = vi.fn();
  const showSaveLoad = vi.fn();
  const stage = {
    destroy: vi.fn(),
    showTitle,
    hideTitle: vi.fn(),
    showEnding: vi.fn(),
    hideEnding: vi.fn(),
    showSystemMenu,
    hideSystemMenu: vi.fn(),
    showSettings,
    hideSettings: vi.fn(),
    showSaveLoad,
    hideSaveLoad: vi.fn(),
  } as unknown as RendererStagePort;
  return {
    stage,
    showTitle,
    showSystemMenu,
    showSettings,
    showSaveLoad,
    facade: new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
    }),
  };
}

describe('Menu v2 characterization contract', () => {
  it('forwards copied menu view models and preserves callbacks', () => {
    const runtime = makeHarness();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const title: TitleView = {
      title: 'Surdet',
      subtitle: '夜行记录',
      backgroundKey: 'title_bg',
      items: [
        { id: 'continue', label: '继续', enabled: false },
        { id: 'start', label: '开始' },
      ],
    };
    runtime.facade.commands.menu.showTitle(title, onSelect);
    const forwardedTitle = runtime.showTitle.mock.calls[0]?.[0] as TitleView;
    expect(forwardedTitle).not.toBe(title);
    expect(forwardedTitle.items).not.toBe(title.items);
    expect(forwardedTitle).toEqual(title);
    expect(runtime.showTitle.mock.calls[0]?.[1]).toBe(onSelect);

    const items: SystemMenuItemView[] = [{ id: 'settings', label: '设置' }];
    runtime.facade.commands.menu.showSystemMenu(items, onSelect, onClose);
    expect(runtime.showSystemMenu.mock.calls[0]?.[0]).not.toBe(items);
    expect(runtime.showSystemMenu.mock.calls[0]?.[0]).toEqual(items);
    expect(runtime.showSystemMenu.mock.calls[0]?.[1]).toBe(onSelect);
    expect(runtime.showSystemMenu.mock.calls[0]?.[2]).toBe(onClose);

    const rows: SettingsRowView[] = [{ id: 'textSpeed', label: '文字速度', display: '普通' }];
    const onChange = vi.fn();
    runtime.facade.commands.menu.showSettings(rows, onChange, onClose);
    expect(runtime.showSettings.mock.calls[0]?.[0]).not.toBe(rows);
    expect(runtime.showSettings.mock.calls[0]?.[0]).toEqual(rows);
    expect(runtime.showSettings.mock.calls[0]?.[1]).toBe(onChange);
    expect(runtime.showSettings.mock.calls[0]?.[2]).toBe(onClose);

    const saveLoad: SaveLoadView = {
      mode: 'load',
      slots: [{ id: 'slot-1', empty: false, label: '序章', kind: 'manual' }],
    };
    runtime.facade.commands.menu.showSaveLoad(saveLoad, onSelect, onClose);
    const forwardedSaveLoad = runtime.showSaveLoad.mock.calls[0]?.[0] as SaveLoadView;
    expect(forwardedSaveLoad).not.toBe(saveLoad);
    expect(forwardedSaveLoad.slots).not.toBe(saveLoad.slots);
    expect(forwardedSaveLoad).toEqual(saveLoad);
    expect(runtime.showSaveLoad.mock.calls[0]?.[1]).toBe(onSelect);
    expect(runtime.showSaveLoad.mock.calls[0]?.[2]).toBe(onClose);
  });

  it('keeps the baseline menu overlay query mutually exclusive and hides only its own state', () => {
    const runtime = makeHarness();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const expected: MenuOverlayState[] = [
      { type: 'title' },
      { type: 'ending' },
      { type: 'system-menu' },
      { type: 'settings' },
      { type: 'save-load', mode: 'save' },
      { type: 'save-load', mode: 'load' },
    ];

    runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, onSelect);
    expect(runtime.facade.queries.overlay.menu()).toEqual(expected[0]);
    runtime.facade.commands.menu.showEnding('THE END');
    expect(runtime.facade.queries.overlay.menu()).toEqual(expected[1]);
    runtime.facade.commands.menu.showSystemMenu([], onSelect, onClose);
    expect(runtime.facade.queries.overlay.menu()).toEqual(expected[2]);
    runtime.facade.commands.menu.showSettings([], vi.fn(), onClose);
    expect(runtime.facade.queries.overlay.menu()).toEqual(expected[3]);
    runtime.facade.commands.menu.showSaveLoad({ mode: 'save', slots: [] }, onSelect, onClose);
    expect(runtime.facade.queries.overlay.menu()).toEqual(expected[4]);
    runtime.facade.commands.menu.showSaveLoad({ mode: 'load', slots: [] }, onSelect, onClose);
    expect(runtime.facade.queries.overlay.menu()).toEqual(expected[5]);

    runtime.facade.commands.menu.hideSettings();
    expect(runtime.facade.queries.overlay.menu()).toEqual(expected[5]);
    runtime.facade.commands.menu.hideSaveLoad();
    expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'none' });

    const query = runtime.facade.queries.overlay.menu();
    expect(query).not.toBe(runtime.facade.queries.overlay.menu());
  });
});
