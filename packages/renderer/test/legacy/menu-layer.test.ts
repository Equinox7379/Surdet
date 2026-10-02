import { Container, Text as PText, Rectangle, Sprite, Texture, type FederatedPointerEvent } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type {
  DialogueProjectionPort,
  MenuProjectionPort,
  SaveLoadSelectionResult,
} from '../../src/api/renderer-commands.js';
import type { MenuOverlayState } from '../../src/api/renderer-queries.js';
import type { RendererControllerPort, RendererStagePort } from '../../src/runtime/renderer-facade.js';
import { RendererFacade } from '../../src/runtime/renderer-facade.js';
import { PixiStage } from '../../src/pixi-stage.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { MenuLayer } from '../../src/layers/menu/menu-layer.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import type { SaveLoadView, SystemMenuItemView, TitleView } from '../../src/ui-views.js';
import type { SettingsRowView } from '../../src/settings-store.js';
import { createPlayerUiSession } from '../../../host/src/player-ui.js';
import { createRendererTheme } from '../../src/theme.js';

const pointerEvent = {} as FederatedPointerEvent;

interface MenuHarness {
  readonly facade: RendererFacade;
  readonly stage: RendererStagePort;
  readonly showTitle: ReturnType<typeof vi.fn>;
  readonly showSystemMenu: ReturnType<typeof vi.fn>;
  readonly showSettings: ReturnType<typeof vi.fn>;
  readonly showSaveLoad: ReturnType<typeof vi.fn>;
}

interface RealMenuRuntime {
  readonly root: Container;
  readonly layer: MenuLayer;
  readonly lifecycle: RenderLifecycle;
  readonly assets: RenderAssetRegistry;
  readonly facade: RendererFacade;
  readonly restoreCommandRail: ReturnType<typeof vi.fn>;
  readonly hideCommandRail: ReturnType<typeof vi.fn>;
  readonly isCommandRailVisible: () => boolean;
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

function findText(root: Container, value: string): PText {
  const found = root.children
    .flatMap((child) => child.children)
    .find((child) => child instanceof PText && child.text === value);
  expect(found, `text ${value} should be projected`).toBeDefined();
  return found as PText;
}

function findTextDeep(root: Container, value: string): PText {
  const visit = (node: Container): PText | undefined => {
    if (node instanceof PText && node.text === value) return node;
    for (const child of node.children) {
      if (child instanceof Container) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const found = visit(root);
  expect(found, `text ${value} should be projected`).toBeDefined();
  return found as PText;
}

function findParentWithText(root: Container, value: string): Container {
  const visit = (container: Container): Container | undefined => {
    if (container.children.some((nested) => nested instanceof PText && nested.text === value)) return container;
    for (const child of container.children) {
      if (child instanceof Container) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const parent = visit(root);
  expect(parent, `container containing ${value} should be projected`).toBeDefined();
  return parent as Container;
}

function makeMenuProjection(onPointerConsumed?: () => void) {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const layer = new MenuLayer({
    uiLayer: root,
    width: 1280,
    height: 720,
    assets,
    lifecycle,
    ...(onPointerConsumed ? { onPointerConsumed } : {}),
  });
  return { root, lifecycle, assets, layer };
}

function makeRealMenuRuntime(onPointerConsumed?: () => void): RealMenuRuntime {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const layer = new MenuLayer({
    uiLayer: root,
    width: 1280,
    height: 720,
    assets,
    lifecycle,
    ...(onPointerConsumed ? { onPointerConsumed } : {}),
  });
  let commandRailVisible = true;
  const restoreCommandRail = vi.fn(() => {
    commandRailVisible = true;
  });
  const hideCommandRail = vi.fn(() => {
    commandRailVisible = false;
  });
  const stage = {
    destroy: vi.fn(),
    hideGallery: vi.fn(),
    hideCommandRail,
    restoreCommandRail,
    setFade: vi.fn(),
  } as unknown as RendererStagePort;
  const dialogue = {
    hideCommandRail,
    hideChoices: vi.fn(),
    hideBacklog: vi.fn(),
  } as unknown as DialogueProjectionPort;
  const facade = new RendererFacade({
    stage,
    controller: makeController(),
    monitor: new RenderPerformanceMonitor(),
    dialogueLayer: dialogue,
    menuLayer: layer,
  });
  return {
    root,
    layer,
    lifecycle,
    assets,
    facade,
    restoreCommandRail,
    hideCommandRail,
    isCommandRailVisible: () => commandRailVisible,
  };
}

function disposeRealMenuRuntime(runtime: RealMenuRuntime): void {
  runtime.layer.dispose();
  runtime.assets.dispose();
  runtime.lifecycle.dispose();
}

function exerciseMenuLayer(layer: MenuLayer): void {
  layer.showTitle({ title: 'Surdet', items: [{ id: 'start', label: '开始' }] }, vi.fn());
  layer.hideTitle(false);
  layer.showEnding('THE END');
  layer.hideEnding();
  layer.showSystemMenu([{ id: 'settings', label: '设置' }], vi.fn(), vi.fn());
  layer.update(260);
  layer.hideSystemMenu();
  layer.showSettings([{ id: 'textSpeed', label: '文字速度', display: '普通' }], vi.fn(), vi.fn());
  layer.hideSettings();
  layer.showSaveLoad({ mode: 'save', slots: [{ id: 'slot-1', empty: true }] }, vi.fn(), vi.fn());
  layer.hideSaveLoad();
  layer.reset();
}

function projectionSignature(root: Container): unknown {
  const visit = (node: Container): unknown => ({
    type: node.constructor.name,
    visible: node.visible,
    alpha: Number(node.alpha.toFixed(4)),
    x: Number(node.x.toFixed(4)),
    y: Number(node.y.toFixed(4)),
    text: node instanceof PText ? node.text : undefined,
    children: node.children.map((child) => visit(child)),
  });
  return visit(root);
}

describe('Menu v2 characterization contract', () => {
  it('uses Chinese default copy while preserving authored titles and callback identifiers', () => {
    const runtime = makeRealMenuRuntime();
    const select = vi.fn();
    try {
      runtime.layer.showEnding();
      expect(findTextDeep(runtime.root, '全篇完')).toBeDefined();
      runtime.layer.hideEnding();
      runtime.layer.showTitle({ title: 'My Story', items: [{ id: 'continue-story', label: 'Continue my story' }] }, select);
      expect(findTextDeep(runtime.root, 'My Story')).toBeDefined();
      findTextDeep(runtime.root, 'Continue my story').emit('pointerdown', pointerEvent);
      expect(select).toHaveBeenCalledWith('continue-story');
      runtime.layer.hideTitle();
      runtime.layer.showSaveLoad({ mode: 'save', slots: [] }, () => {}, () => {});
      expect(findTextDeep(runtime.root, '记录进度')).toBeDefined();
      runtime.layer.showSaveLoad({ mode: 'load', slots: [] }, () => {}, () => {});
      expect(findTextDeep(runtime.root, '继续故事')).toBeDefined();
    } finally { disposeRealMenuRuntime(runtime); }
  });

  it('uses a registered title wordmark without losing controls, falls back to text, and does not own its texture', async () => {
    const runtime = makeRealMenuRuntime();
    const logo = new Texture();
    const select = vi.fn();
    try {
      await runtime.assets.registerBackground('wordmark', logo);
      await runtime.assets.registerBackground('title_bg', Texture.WHITE);
      runtime.facade.commands.menu.showTitle({ title: '字标标题', logoKey: 'wordmark', items: [{ id: 'new', label: '开始游戏' }] }, select);
      const sprites = (node: Container): Sprite[] => [...(node instanceof Sprite ? [node] : []), ...node.children.flatMap(sprites)];
      expect(sprites(runtime.root).some((sprite) => sprite.texture === logo)).toBe(true);
      findTextDeep(runtime.root, '开始游戏').emit('pointerdown', pointerEvent);
      expect(select).toHaveBeenCalledWith('new');
      runtime.layer.hideTitle();
      expect(logo.destroyed).toBe(false);
      runtime.facade.commands.menu.showTitle({ title: '无字标时保留标题', logoKey: 'missing', items: [] }, select);
      expect(findTextDeep(runtime.root, '无字标时保留标题').visible).toBe(true);
    } finally { disposeRealMenuRuntime(runtime); logo.destroy(); }
  });

  it('reports the actual title control bounds instead of a second hard-coded layout', () => {
    const runtime = makeRealMenuRuntime();
    try {
      const select = vi.fn();
      const items = [{ id: 'new', label: '开始游戏' }, { id: 'explore', label: '自由探索', secondary: true }];
      runtime.layer.showTitle({ title: 'Surdet', items }, select);
      const targets = items.map((item) => {
        const label = findTextDeep(runtime.root, item.label);
        const hit = label.hitArea as Rectangle;
        label.emit('pointerdown', pointerEvent);
        expect(select).toHaveBeenLastCalledWith(item.id);
        return { id: item.id, x: label.x + hit.x, y: label.y + hit.y, width: hit.width, height: hit.height };
      });
      expect(runtime.layer.debugSnapshot().titleTargets).toEqual(targets);
      expect(targets[1]!.x).toBeGreaterThan(targets[0]!.x + targets[0]!.width);
      expect(targets[1]!.y + targets[1]!.height).toBeLessThanOrEqual(720);
      runtime.layer.hideTitle();
      expect(runtime.layer.debugSnapshot().titleTargets).toEqual([]);
    } finally { disposeRealMenuRuntime(runtime); }
  });
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

describe('Menu backup restore projection contract', () => {
  it('disables corrupt main loading but leaves its confirmed backup restore reachable', () => {
    const runtime = makeRealMenuRuntime();
    const onSelect = vi.fn(() => false);
    const onRestore = vi.fn(() => false);
    try {
      runtime.facade.commands.menu.showSaveLoad({ mode: 'load', slots: [
        { id: '1', empty: false, readError: '存档损坏', backupAvailable: true },
        { id: '2', empty: false, label: '健康主档', backupError: '备份损坏' },
      ] }, onSelect, vi.fn(), { onRestore });
      const damagedCard = findParentWithText(runtime.root, '存档损坏');
      expect(damagedCard.accessibleHint).toContain('存档损坏');
      expect(damagedCard.accessibleHint).not.toContain('空槽位');
      damagedCard.emit('pointerdown', pointerEvent);
      expect(onSelect).not.toHaveBeenCalled();
      findTextDeep(runtime.root, '恢复备份并读取').emit('pointerdown', pointerEvent);
      expect(onRestore).not.toHaveBeenCalled();
      findParentWithText(runtime.root, '取消').emit('pointerdown', pointerEvent);
      expect(onRestore).not.toHaveBeenCalled();
      findTextDeep(runtime.root, '恢复备份并读取').emit('pointerdown', pointerEvent);
      findParentWithText(runtime.root, '恢复并读取').emit('pointerdown', pointerEvent);
      expect(onRestore.mock.calls).toEqual([['1']]);
      expect(findTextDeep(runtime.root, '备份损坏')).toBeDefined();
      findParentWithText(runtime.root, '健康主档').emit('pointerdown', pointerEvent);
      expect(onSelect.mock.calls).toEqual([['2']]);
    } finally { disposeRealMenuRuntime(runtime); }
  });

  it('requires overwrite confirmation for a corrupt occupied slot', () => {
    const runtime = makeRealMenuRuntime();
    const onSelect = vi.fn(() => false);
    try {
      runtime.facade.commands.menu.showSaveLoad({ mode: 'save', slots: [
        { id: '1', empty: false, readError: '存档损坏' },
      ] }, onSelect, vi.fn());
      const card = findParentWithText(runtime.root, '存档损坏');
      card.emit('pointerdown', pointerEvent);
      expect(onSelect).not.toHaveBeenCalled();
      findParentWithText(runtime.root, '取消').emit('pointerdown', pointerEvent);
      expect(onSelect).not.toHaveBeenCalled();
      card.emit('pointerdown', pointerEvent);
      findParentWithText(runtime.root, '覆盖存档').emit('pointerdown', pointerEvent);
      expect(onSelect.mock.calls).toEqual([['1']]);
    } finally { disposeRealMenuRuntime(runtime); }
  });

  it('cancels an overwrite without invoking storage, then confirms exactly one original action', () => {
    const runtime = makeRealMenuRuntime();
    const onSelect = vi.fn(() => false);
    try {
      runtime.facade.commands.menu.showSaveLoad({ mode: 'save', slots: [{ id: '1', empty: false, label: '既有存档' }] }, onSelect, vi.fn());
      const card = findParentWithText(runtime.root, '既有存档');
      card.emit('pointerdown', pointerEvent);
      expect(onSelect).not.toHaveBeenCalled();
      findParentWithText(runtime.root, '取消').emit('pointerdown', pointerEvent);
      expect(onSelect).not.toHaveBeenCalled();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });
      card.emit('pointerdown', pointerEvent);
      // Repeated input before the next frame must not stack confirmation surfaces.
      card.emit('pointerdown', pointerEvent);
      findParentWithText(runtime.root, '覆盖存档').emit('pointerdown', pointerEvent);
      expect(onSelect.mock.calls).toEqual([['1']]);
      expect(() => findTextDeep(runtime.root, '覆盖存档')).toThrow();
    } finally { disposeRealMenuRuntime(runtime); }
  });

  it('shows restore only for load backups and keeps normal card selection separate', () => {
    const runtime = makeRealMenuRuntime();
    const onSelect = vi.fn(() => false);
    const onRestore = vi.fn(() => false);
    const options = { onRestore } as unknown as Parameters<typeof runtime.facade.commands.menu.showSaveLoad>[3];
    try {
      runtime.facade.commands.menu.showSaveLoad({
        mode: 'load',
        slots: [
          { id: 'backup', empty: false, label: '有备份', backupAvailable: true } as never,
          { id: 'normal', empty: false, label: '普通存档' },
        ],
      }, onSelect, vi.fn(), options);

      expect(findTextDeep(runtime.root, '恢复备份并读取')).toBeDefined();
      findParentWithText(runtime.root, '普通存档').emit('pointerdown', pointerEvent);
      expect(onSelect).toHaveBeenCalledWith('normal');
      expect(onRestore).not.toHaveBeenCalled();

      runtime.facade.commands.menu.showSaveLoad({
        mode: 'save',
        slots: [{ id: 'backup', empty: false, label: '有备份', backupAvailable: true } as never],
      }, onSelect, vi.fn(), options);
      expect(() => findTextDeep(runtime.root, '恢复备份并读取')).toThrow();
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('consumes repeated restore clicks while its host transaction is pending', async () => {
    const pointerConsumed = vi.fn();
    const runtime = makeRealMenuRuntime(pointerConsumed);
    let resolveRestore!: (accepted: boolean) => void;
    const transaction = new Promise<boolean>((resolve) => { resolveRestore = resolve; });
    const onRestore = vi.fn(() => transaction);
    const onTransactionComplete = vi.fn();
    const onTransactionError = vi.fn();
    const options = {
      completion: 'host-transaction',
      onRestore,
      onTransactionComplete,
      onTransactionError,
    } as unknown as Parameters<typeof runtime.facade.commands.menu.showSaveLoad>[3];
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      runtime.facade.commands.menu.showSaveLoad({
        mode: 'load',
        slots: [{ id: 'backup', empty: false, label: '有备份', backupAvailable: true } as never],
      }, vi.fn(), vi.fn(), options);
      const restore = findTextDeep(runtime.root, '恢复备份并读取');
      restore.emit('pointerdown', pointerEvent);
      expect(onRestore).not.toHaveBeenCalled();
      findParentWithText(runtime.root, '恢复并读取').emit('pointerdown', pointerEvent);
      restore.emit('pointerdown', pointerEvent);

      expect(onRestore).toHaveBeenCalledOnce();
      expect(pointerConsumed).toHaveBeenCalledOnce();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'load' });
      expect(runtime.isCommandRailVisible()).toBe(false);

      resolveRestore(true);
      await transaction;
      await Promise.resolve();
      await Promise.resolve();
      expect(onTransactionComplete).toHaveBeenCalledOnce();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });
});

describe('MenuLayer projection and lifecycle contract', () => {
  it('repaints explicit theme roles without rebinding controls or retaining old scrim opacity', () => {
    const runtime = makeRealMenuRuntime();
    const onSelect = vi.fn();
    try {
      runtime.layer.setTheme(createRendererTheme({ typography: { headingSize: 22, uiSize: 22 } }));
      runtime.layer.showSystemMenu([{ id: 'resume', label: '继续' }], onSelect, vi.fn());
      const label = findTextDeep(runtime.root, '继续');
      const row = label.parent!;
      const root = row.parent!.parent!;
      runtime.layer.setTheme(createRendererTheme({ typography: { headingSize: 30, uiSize: 18 }, opacity: { scrim: 0.1 }, radius: { md: 9 } }));
      expect(findTextDeep(runtime.root, '继续')).toBe(label);
      expect(label.style.fontSize).toBe(18);
      const fill = (root.children[0] as import('pixi.js').Graphics).context.instructions[0] as unknown as { data: { style: { alpha: number } } };
      expect(fill.data.style.alpha).toBe(0.1);
      expect(row.hitArea).toBeTruthy();
      row.emit('pointerdown', pointerEvent);
      expect(onSelect.mock.calls).toEqual([['resume']]);
    } finally { disposeRealMenuRuntime(runtime); }
  });

  it('uses the injected MenuProjectionPort as the sole v2 menu renderer', () => {
    let overlay: MenuOverlayState = { type: 'none' };
    const menu = {
      showTitle: vi.fn(() => { overlay = { type: 'title' }; }),
      hideTitle: vi.fn(() => { overlay = { type: 'none' }; }),
      showEnding: vi.fn(() => { overlay = { type: 'ending' }; }),
      hideEnding: vi.fn(() => { overlay = { type: 'none' }; }),
      showSystemMenu: vi.fn(() => { overlay = { type: 'system-menu' }; }),
      hideSystemMenu: vi.fn(() => { overlay = { type: 'none' }; }),
      showSettings: vi.fn(() => { overlay = { type: 'settings' }; }),
      hideSettings: vi.fn(() => { overlay = { type: 'none' }; }),
      showSaveLoad: vi.fn((view: SaveLoadView) => { overlay = { type: 'save-load', mode: view.mode }; }),
      hideSaveLoad: vi.fn(() => { overlay = { type: 'none' }; }),
      menu: vi.fn(() => ({ ...overlay })),
    } as unknown as MenuProjectionPort;
    const dialogue = {
      hideCommandRail: vi.fn(),
      hideChoices: vi.fn(),
      hideBacklog: vi.fn(),
    } as unknown as DialogueProjectionPort;
    const stage = {
      destroy: vi.fn(),
      hideGallery: vi.fn(),
      setFade: vi.fn(),
      restoreCommandRail: vi.fn(),
      showTitle: vi.fn(),
      showEnding: vi.fn(),
      showSystemMenu: vi.fn(),
      showSettings: vi.fn(),
      showSaveLoad: vi.fn(),
    } as unknown as RendererStagePort;
    const facade = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
      dialogueLayer: dialogue,
      menuLayer: menu,
    });
    const onSelect = vi.fn();
    const onClose = vi.fn();

    facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, onSelect);
    expect(menu.showTitle).toHaveBeenCalledOnce();
    expect(stage.showTitle).not.toHaveBeenCalled();
    expect(dialogue.hideCommandRail).toHaveBeenCalledOnce();
    expect(facade.queries.overlay.menu()).toEqual({ type: 'title' });

    facade.commands.menu.showEnding('THE END');
    expect(menu.showEnding).toHaveBeenCalledOnce();
    expect(stage.showEnding).not.toHaveBeenCalled();
    expect(dialogue.hideChoices).toHaveBeenCalledOnce();
    expect(dialogue.hideBacklog).toHaveBeenCalledOnce();
    expect(stage.setFade).toHaveBeenCalledWith(0);
    expect(facade.queries.overlay.menu()).toEqual({ type: 'ending' });

    facade.commands.menu.showSettings([], vi.fn(), onClose);
    facade.commands.menu.showSaveLoad({ mode: 'load', slots: [] }, onSelect, onClose);
    expect(menu.showSettings).toHaveBeenCalledOnce();
    expect(menu.showSaveLoad).toHaveBeenCalledOnce();
    expect(stage.showSettings).not.toHaveBeenCalled();
    expect(stage.showSaveLoad).not.toHaveBeenCalled();
    expect(facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'load' });
  });

  it('projects title enabled/disabled selection and keeps ending visibility exclusive', () => {
    const { root, layer, lifecycle, assets } = makeMenuProjection();
    const onSelect = vi.fn();
    try {
      layer.showTitle({
        title: 'Surdet',
        items: [
          { id: 'continue', label: '继续', enabled: false },
          { id: 'start', label: '开始', enabled: true },
        ],
      }, onSelect);
      expect(layer.menu()).toEqual({ type: 'title' });
      findText(root, '继续').emit('pointerdown', pointerEvent);
      expect(onSelect).not.toHaveBeenCalled();
      findText(root, '开始').emit('pointerdown', pointerEvent);
      expect(onSelect).toHaveBeenCalledOnce();
      expect(layer.menu()).toEqual({ type: 'title' });
      layer.hideTitle(false);
      expect(layer.menu()).toEqual({ type: 'none' });

      layer.showEnding('THE END');
      expect(layer.menu()).toEqual({ type: 'ending' });
      layer.showEnding('THE END');
      expect(root.children.at(-1)?.visible).toBe(true);
      layer.hideEnding();
      layer.hideEnding();
      expect(layer.menu()).toEqual({ type: 'none' });
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('keeps title projection and current handler after selection errors or repeated showTitle', () => {
    const { root, layer, lifecycle, assets } = makeMenuProjection();
    const failure = new Error('title callback');
    const first = vi.fn(() => { throw failure; });
    const second = vi.fn();
    try {
      layer.showTitle({ title: 'Surdet', items: [{ id: 'start', label: '开始' }] }, first);
      expect(() => findText(root, '开始').emit('pointerdown', pointerEvent)).toThrow(failure);
      expect(layer.menu()).toEqual({ type: 'title' });
      expect(lifecycle.snapshot().listeners).toBe(1);

      layer.showTitle({ title: 'Surdet', items: [{ id: 'start', label: '开始' }] }, second);
      findText(root, '开始').emit('pointerdown', pointerEvent);
      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
      expect(layer.menu()).toEqual({ type: 'title' });
      layer.hideTitle(false);
      expect(layer.menu()).toEqual({ type: 'none' });
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('keeps an underlying title visible while the frontmost menu changes', () => {
    const runtime = makeRealMenuRuntime();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, onSelect);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      runtime.facade.commands.menu.showSystemMenu([], onSelect, onClose);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'system-menu' });
      runtime.facade.commands.menu.hideSystemMenu();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      runtime.facade.commands.menu.showSettings([], vi.fn(), onClose);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'settings' });
      runtime.facade.commands.menu.hideSettings();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      runtime.facade.commands.menu.showSaveLoad({ mode: 'save', slots: [] }, onSelect, onClose);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });
      runtime.facade.commands.menu.hideSaveLoad();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      runtime.facade.commands.menu.showSaveLoad({ mode: 'load', slots: [] }, onSelect, onClose);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'load' });
      runtime.facade.commands.menu.hideSaveLoad();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      runtime.facade.commands.menu.showEnding('THE END');
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'ending' });
      runtime.facade.commands.menu.showSystemMenu([], onSelect, onClose);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'system-menu' });
      runtime.facade.commands.menu.hideSystemMenu();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'ending' });

      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, onSelect);
      const copy = runtime.facade.queries.overlay.menu() as { type: string };
      copy.type = 'none';
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });
      runtime.layer.reset();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'none' });
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('coordinates real settings dismissal after MenuLayer cleanup and propagates errors safely', () => {
    const runtime = makeRealMenuRuntime();
    const order: string[] = [];
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      const onClose = vi.fn(() => order.push('callback'));
      runtime.restoreCommandRail.mockImplementation(() => order.push(`restore:${runtime.facade.queries.overlay.menu().type}`));
      runtime.facade.commands.menu.showSettings([], vi.fn(), onClose);
      (runtime.root.children.at(-1)?.children[0] as Container).emit('pointerdown', pointerEvent);

      expect(order).toEqual(['restore:title', 'callback']);
      expect(runtime.restoreCommandRail).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      const failure = new Error('settings callback');
      runtime.facade.commands.menu.showSettings([], vi.fn(), () => { throw failure; });
      expect(() => (runtime.root.children.at(-1)?.children[0] as Container).emit('pointerdown', pointerEvent)).toThrow(failure);
      expect(runtime.restoreCommandRail).toHaveBeenCalledTimes(2);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(1);
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('guards the settings close button while preserving the underlying menu', () => {
    const runtime = makeRealMenuRuntime();
    const onClose = vi.fn();
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      runtime.facade.commands.menu.showSettings([], vi.fn(), onClose);

      findText(runtime.root, '×').emit('pointerdown', pointerEvent);

      expect(onClose).toHaveBeenCalledOnce();
      expect(runtime.restoreCommandRail).toHaveBeenCalledOnce();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(1);
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('coordinates real save/load selection and close paths exactly once', () => {
    const runtime = makeRealMenuRuntime();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      runtime.facade.commands.menu.showSaveLoad({
        mode: 'load',
        slots: [{ id: 'empty', empty: true }, { id: 'slot-1', empty: false, label: '序章' }],
      }, onSelect, onClose);

      findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent);
      expect(onSelect).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(runtime.restoreCommandRail).not.toHaveBeenCalled();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'load' });

      findParentWithText(runtime.root, '序章').emit('pointerdown', pointerEvent);
      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect).toHaveBeenCalledWith('slot-1');
      expect(runtime.restoreCommandRail).toHaveBeenCalledOnce();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      runtime.facade.commands.menu.showSaveLoad({ mode: 'save', slots: [{ id: 'slot-2', empty: true }] }, onSelect, onClose);
      findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent);
      expect(onSelect).toHaveBeenCalledTimes(2);
      expect(runtime.restoreCommandRail).toHaveBeenCalledTimes(2);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      runtime.facade.commands.menu.showSaveLoad({ mode: 'load', slots: [] }, onSelect, onClose);
      (runtime.root.children.at(-1)?.children[0] as Container).emit('pointerdown', pointerEvent);
      expect(onClose).toHaveBeenCalledOnce();
      expect(runtime.restoreCommandRail).toHaveBeenCalledTimes(3);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      const failure = new Error('save callback');
      runtime.facade.commands.menu.showSaveLoad({ mode: 'save', slots: [{ id: 'slot-3', empty: true }] }, () => { throw failure; }, onClose);
      expect(() => findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent)).toThrow(failure);
      expect(runtime.restoreCommandRail).toHaveBeenCalledTimes(4);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      const restoreCountBeforeRejected = runtime.restoreCommandRail.mock.calls.length;
      runtime.facade.commands.menu.showSaveLoad(
        { mode: 'load', slots: [{ id: 'stale', empty: false, label: '陈旧记录' }] },
        () => false,
        onClose,
      );
      findParentWithText(runtime.root, '陈旧记录').emit('pointerdown', pointerEvent);
      expect(runtime.restoreCommandRail).toHaveBeenCalledTimes(restoreCountBeforeRejected);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'load' });
      runtime.facade.commands.menu.hideSaveLoad();
      expect(runtime.restoreCommandRail).toHaveBeenCalledTimes(restoreCountBeforeRejected + 1);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('keeps the save/load page open when the host rejects a selection', () => {
    const { root, layer, lifecycle, assets } = makeMenuProjection();
    const onSelect = vi.fn(() => false);
    try {
      layer.showSaveLoad({
        mode: 'load',
        slots: [{ id: 'slot-stale', empty: false, label: '旧记录' }],
      }, onSelect, vi.fn());

      findParentWithText(root, '旧记录').emit('pointerdown', pointerEvent);

      expect(onSelect).toHaveBeenCalledWith('slot-stale');
      expect(layer.menu()).toEqual({ type: 'save-load', mode: 'load' });
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('guards repeated valid save/load slot clicks while a host transaction is pending and permits retries', async () => {
    const pointerConsumed = vi.fn();
    const runtime = makeRealMenuRuntime(pointerConsumed);
    const showSaveLoad = runtime.facade.commands.menu.showSaveLoad as unknown as (
      view: SaveLoadView,
      onSelect: (slotId: string) => SaveLoadSelectionResult,
      onClose: () => void,
      options: unknown,
    ) => void;
    const flushTransaction = async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    };
    const uiSession = createPlayerUiSession({ base: 'game', overlay: 'save-load' });
    const onTransactionComplete = vi.fn(() => {
      if (uiSession.snapshot().operation !== 'idle') uiSession.completeOperation({ overlay: 'none' });
      runtime.restoreCommandRail();
    });
    const onTransactionError = vi.fn();
    const playerUiBeginOperation = vi.fn(() => uiSession.beginOperation('saving'));
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      runtime.hideCommandRail.mockClear();

      let resolveFirst!: (accepted: boolean) => void;
      const firstTransaction = new Promise<boolean>((resolve) => { resolveFirst = resolve; });
      const firstSelect = vi.fn(() => {
        playerUiBeginOperation();
        return firstTransaction;
      });
      showSaveLoad(
        { mode: 'save', slots: [{ id: 'slot-1', empty: true }] },
        firstSelect,
        vi.fn(),
        { completion: 'host-transaction', onTransactionComplete, onTransactionError },
      );

      const firstSlot = findParentWithText(runtime.root, '空槽位');
      firstSlot.emit('pointerdown', pointerEvent);
      firstSlot.emit('pointerdown', pointerEvent);
      firstSlot.emit('pointerdown', pointerEvent);

      expect(firstSelect).toHaveBeenCalledOnce();
      expect(playerUiBeginOperation).toHaveBeenCalledOnce();
      expect(uiSession.snapshot().operation).toBe('saving');
      expect(pointerConsumed).toHaveBeenCalledTimes(2);
      expect(onTransactionError).not.toHaveBeenCalled();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });
      expect(runtime.isCommandRailVisible()).toBe(false);
      expect(runtime.hideCommandRail).toHaveBeenCalledOnce();
      expect(runtime.restoreCommandRail).not.toHaveBeenCalled();

      resolveFirst(true);
      await firstTransaction;
      await flushTransaction();

      expect(onTransactionComplete).toHaveBeenCalledOnce();
      expect(uiSession.snapshot().operation).toBe('idle');
      expect(runtime.restoreCommandRail).toHaveBeenCalledOnce();
      expect(runtime.isCommandRailVisible()).toBe(true);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      let resolveFalse!: (accepted: boolean) => void;
      let resolveFalseRetry!: (accepted: boolean) => void;
      const falseTransaction = new Promise<boolean>((resolve) => { resolveFalse = resolve; });
      const falseRetryTransaction = new Promise<boolean>((resolve) => { resolveFalseRetry = resolve; });
      const falseSelect = vi.fn()
        .mockImplementationOnce(() => falseTransaction)
        .mockImplementationOnce(() => falseRetryTransaction);
      showSaveLoad(
        { mode: 'save', slots: [{ id: 'slot-2', empty: true }] },
        falseSelect,
        vi.fn(),
        { completion: 'host-transaction', onTransactionComplete, onTransactionError },
      );

      findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent);
      resolveFalse(false);
      await falseTransaction;
      await flushTransaction();
      expect(falseSelect).toHaveBeenCalledOnce();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });
      expect(onTransactionComplete).toHaveBeenCalledOnce();
      expect(runtime.isCommandRailVisible()).toBe(false);

      findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent);
      expect(falseSelect).toHaveBeenCalledTimes(2);
      resolveFalseRetry(true);
      await falseRetryTransaction;
      await flushTransaction();
      expect(onTransactionComplete).toHaveBeenCalledTimes(2);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });

      let rejectTransaction!: (error: unknown) => void;
      let resolveRejectedRetry!: (accepted: boolean) => void;
      const rejection = new Error('save denied');
      const rejectedTransaction = new Promise<boolean>((_resolve, reject) => { rejectTransaction = reject; });
      const rejectedRetryTransaction = new Promise<boolean>((resolve) => { resolveRejectedRetry = resolve; });
      const rejectedSelect = vi.fn()
        .mockImplementationOnce(() => rejectedTransaction)
        .mockImplementationOnce(() => rejectedRetryTransaction);
      showSaveLoad(
        { mode: 'save', slots: [{ id: 'slot-3', empty: true }] },
        rejectedSelect,
        vi.fn(),
        { completion: 'host-transaction', onTransactionComplete, onTransactionError },
      );

      findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent);
      rejectTransaction(rejection);
      await expect(rejectedTransaction).rejects.toBe(rejection);
      await flushTransaction();
      expect(rejectedSelect).toHaveBeenCalledOnce();
      expect(onTransactionError).toHaveBeenCalledOnce();
      expect(onTransactionError).toHaveBeenCalledWith(rejection);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });

      findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent);
      expect(rejectedSelect).toHaveBeenCalledTimes(2);
      resolveRejectedRetry(false);
      await rejectedRetryTransaction;
      await flushTransaction();
      expect(rejectedSelect).toHaveBeenCalledTimes(2);
      expect(onTransactionError).toHaveBeenCalledOnce();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('rolls back host-transaction ownership after a synchronous throw or non-Promise result', async () => {
    const runtime = makeRealMenuRuntime();
    const onTransactionError = vi.fn();
    const syncFailure = new Error('synchronous save failure');
    let resolveRetry!: (accepted: boolean) => void;
    const retryTransaction = new Promise<boolean>((resolve) => { resolveRetry = resolve; });
    const onSelect = vi.fn()
      .mockImplementationOnce(() => { throw syncFailure; })
      .mockImplementationOnce(() => retryTransaction);
    const showSaveLoad = runtime.facade.commands.menu.showSaveLoad as unknown as (
      view: SaveLoadView,
      onSelect: (slotId: string) => SaveLoadSelectionResult,
      onClose: () => void,
      options: unknown,
    ) => void;
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      showSaveLoad(
        { mode: 'save', slots: [{ id: 'slot-1', empty: true }] },
        onSelect,
        vi.fn(),
        { completion: 'host-transaction', onTransactionError },
      );

      const slot = findParentWithText(runtime.root, '空槽位');
      slot.emit('pointerdown', pointerEvent);
      expect(onSelect).toHaveBeenCalledOnce();
      expect(onTransactionError).toHaveBeenCalledOnce();
      expect(onTransactionError).toHaveBeenCalledWith(syncFailure);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });
      expect(runtime.restoreCommandRail).not.toHaveBeenCalled();

      slot.emit('pointerdown', pointerEvent);
      expect(onSelect).toHaveBeenCalledTimes(2);
      resolveRetry(false);
      await retryTransaction;
      await Promise.resolve();
      await Promise.resolve();
      expect(onTransactionError).toHaveBeenCalledOnce();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });

      const noPromiseFailure = new Error('host-transaction save/load handlers must return a Promise');
      const noPromiseSelect = vi.fn(() => false);
      showSaveLoad(
        { mode: 'save', slots: [{ id: 'slot-2', empty: true }] },
        noPromiseSelect,
        vi.fn(),
        { completion: 'host-transaction', onTransactionError },
      );
      findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent);
      expect(noPromiseSelect).toHaveBeenCalledOnce();
      expect(onTransactionError).toHaveBeenCalledTimes(2);
      expect(onTransactionError.mock.calls[1]?.[0]).toBeInstanceOf(Error);
      expect((onTransactionError.mock.calls[1]?.[0] as Error).message).toBe(noPromiseFailure.message);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('keeps the save/load page and suppressed rail pending an explicit host transaction', async () => {
    const runtime = makeRealMenuRuntime();
    let resolveTransaction!: (accepted: boolean) => void;
    const transaction = new Promise<boolean>((resolve) => { resolveTransaction = resolve; });
    const showSaveLoad = runtime.facade.commands.menu.showSaveLoad as unknown as (
      view: SaveLoadView,
      onSelect: (slotId: string) => SaveLoadSelectionResult,
      onClose: () => void,
      options: unknown,
    ) => void;
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      showSaveLoad(
        { mode: 'save', slots: [{ id: 'slot-1', empty: true }] },
        () => transaction,
        vi.fn(),
        { completion: 'host-transaction', onTransactionComplete: runtime.restoreCommandRail },
      );

      findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent);

      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });
      expect(runtime.restoreCommandRail).not.toHaveBeenCalled();

      // A pending transaction owns the page; a close click cannot create a
      // hidden page + busy host half-state or restore the rail early.
      findText(runtime.root, '×').emit('pointerdown', pointerEvent);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });
      expect(runtime.restoreCommandRail).not.toHaveBeenCalled();

      resolveTransaction(true);
      await transaction;
      await Promise.resolve();

      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });
      expect(runtime.restoreCommandRail).toHaveBeenCalledOnce();
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('reports a rejected host transaction without hiding or restoring the pending page', async () => {
    const runtime = makeRealMenuRuntime();
    let rejectTransaction!: (error: unknown) => void;
    const failure = new Error('bridge write denied');
    const transaction = new Promise<boolean>((_resolve, reject) => { rejectTransaction = reject; });
    const onTransactionError = vi.fn();
    const showSaveLoad = runtime.facade.commands.menu.showSaveLoad as unknown as (
      view: SaveLoadView,
      onSelect: (slotId: string) => SaveLoadSelectionResult,
      onClose: () => void,
      options: unknown,
    ) => void;
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      showSaveLoad(
        { mode: 'save', slots: [{ id: 'slot-1', empty: true }] },
        () => transaction,
        vi.fn(),
        { completion: 'host-transaction', onTransactionError },
      );

      findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent);
      rejectTransaction(failure);
      await expect(transaction).rejects.toBe(failure);
      await Promise.resolve();

      expect(onTransactionError).toHaveBeenCalledOnce();
      expect(onTransactionError).toHaveBeenCalledWith(failure);
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'save-load', mode: 'save' });
      expect(runtime.restoreCommandRail).not.toHaveBeenCalled();
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('retains the deferred completion callback when the provider closes before settlement', async () => {
    const runtime = makeRealMenuRuntime();
    let resolveTransaction!: (accepted: boolean) => void;
    const transaction = new Promise<boolean>((resolve) => { resolveTransaction = resolve; });
    const onTransactionComplete = vi.fn(() => runtime.restoreCommandRail());
    const showSaveLoad = runtime.facade.commands.menu.showSaveLoad as unknown as (
      view: SaveLoadView,
      onSelect: (slotId: string) => SaveLoadSelectionResult,
      onClose: () => void,
      options: unknown,
    ) => void;
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      showSaveLoad(
        { mode: 'save', slots: [{ id: 'slot-1', empty: true }] },
        () => transaction,
        vi.fn(),
        { completion: 'host-transaction', onTransactionComplete },
      );

      findParentWithText(runtime.root, '空槽位').emit('pointerdown', pointerEvent);
      expect(runtime.restoreCommandRail).not.toHaveBeenCalled();

      // PlayerShellController.completeOperation closes the real Provider before
      // the deferred selection Promise settles. The callback must survive that
      // provider teardown and run exactly once after success.
      runtime.facade.commands.menu.hideSaveLoad();
      resolveTransaction(true);
      await transaction;
      await Promise.resolve();
      await Promise.resolve();

      expect(onTransactionComplete).toHaveBeenCalledOnce();
      expect(runtime.restoreCommandRail).toHaveBeenCalledOnce();
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('guards the save/load close button while preserving the underlying menu', () => {
    const runtime = makeRealMenuRuntime();
    const onClose = vi.fn();
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      runtime.facade.commands.menu.showSaveLoad({ mode: 'load', slots: [] }, vi.fn(), onClose);

      findText(runtime.root, '×').emit('pointerdown', pointerEvent);

      expect(onClose).toHaveBeenCalledOnce();
      expect(runtime.restoreCommandRail).toHaveBeenCalledOnce();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(1);
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('cleans up save/load before propagating an onClose failure', () => {
    const runtime = makeRealMenuRuntime();
    const failure = new Error('save/load close guard');
    try {
      runtime.facade.commands.menu.showTitle({ title: 'Surdet', items: [] }, vi.fn());
      runtime.facade.commands.menu.showSaveLoad({ mode: 'save', slots: [] }, vi.fn(), () => { throw failure; });

      expect(() => findText(runtime.root, '×').emit('pointerdown', pointerEvent)).toThrow(failure);

      expect(runtime.restoreCommandRail).toHaveBeenCalledOnce();
      expect(runtime.facade.queries.overlay.menu()).toEqual({ type: 'title' });
      expect(runtime.lifecycle.snapshot().listeners).toBe(1);
    } finally {
      disposeRealMenuRuntime(runtime);
    }
  });

  it('keeps the legacy fallback speaker focus call singular with a real PixiStage', () => {
    const stage = new PixiStage();
    const facade = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
    });
    const focus = vi.spyOn(stage, 'setPortraitFocus');
    try {
      facade.commands.dialogue.setActiveSpeaker('lynn');
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalledWith('lynn');
      focus.mockClear();
      facade.commands.dialogue.setActiveSpeaker(null);
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalledWith(null);
    } finally {
      stage.destroy();
    }
  });

  it('forwards system, settings, save and load interactions without owning storage', () => {
    const { root, layer, lifecycle, assets } = makeMenuProjection();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const onChange = vi.fn();
    try {
      layer.showSystemMenu([{ id: 'settings', label: '设置' }], onSelect, onClose);
      (root.children.at(-1)?.children[0] as Container).emit('pointerdown', pointerEvent);
      expect(onClose).toHaveBeenCalledOnce();
      layer.showSystemMenu([{ id: 'settings', label: '设置' }], onSelect, onClose);
      findParentWithText(root, '设置').emit('pointerdown', pointerEvent);
      expect(onSelect).toHaveBeenCalledWith('settings');
      expect(layer.menu()).toEqual({ type: 'none' });

      layer.showSettings([{ id: 'textSpeed', label: '文字速度', display: '普通' }], onChange, onClose);
      const controls = findParentWithText(root, '‹');
      (controls.children.find((child) => child instanceof PText && child.text === '‹') as PText).emit('pointerdown', pointerEvent);
      (controls.children.find((child) => child instanceof PText && child.text === '›') as PText).emit('pointerdown', pointerEvent);
      expect(onChange).toHaveBeenNthCalledWith(1, 'textSpeed', -1);
      expect(onChange).toHaveBeenNthCalledWith(2, 'textSpeed', 1);
      layer.hideSettings();
      layer.showSettings([{ id: 'textSpeed', label: '文字速度', display: '普通' }], onChange, onClose);
      (root.children.at(-1)?.children[0] as Container).emit('pointerdown', pointerEvent);
      expect(onClose).toHaveBeenCalledTimes(2);

      layer.showSaveLoad({
        mode: 'load',
        slots: [
          { id: 'empty', empty: true },
          { id: 'slot-1', empty: false, label: '序章' },
        ],
      }, onSelect, onClose);
      expect(layer.menu()).toEqual({ type: 'save-load', mode: 'load' });
      findParentWithText(root, '空槽位').emit('pointerdown', pointerEvent);
      expect(onSelect).not.toHaveBeenCalledWith('empty');
      findParentWithText(root, '序章').emit('pointerdown', pointerEvent);
      expect(onSelect).toHaveBeenCalledWith('slot-1');
      expect(layer.menu()).toEqual({ type: 'none' });

      layer.showSaveLoad({ mode: 'save', slots: [{ id: 'empty', empty: true }] }, onSelect, onClose);
      findParentWithText(root, '空槽位').emit('pointerdown', pointerEvent);
      expect(onSelect).toHaveBeenCalledWith('empty');
      layer.showSaveLoad({ mode: 'save', slots: [{ id: 'empty', empty: true }] }, onSelect, onClose);
      (root.children.at(-1)?.children[0] as Container).emit('pointerdown', pointerEvent);
      expect(onClose).toHaveBeenCalledTimes(3);
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('cleans projection state before propagating callback exceptions', () => {
    const { root, layer, lifecycle, assets } = makeMenuProjection();
    try {
      layer.showSystemMenu([{ id: 'boom', label: '爆炸' }], () => { throw new Error('menu callback'); }, vi.fn());
      expect(() => findParentWithText(root, '爆炸').emit('pointerdown', pointerEvent)).toThrow('menu callback');
      expect(layer.menu()).toEqual({ type: 'none' });
      expect(lifecycle.snapshot().listeners).toBe(0);
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('cleans system-menu state before propagating close callback exceptions', () => {
    const { root, layer, lifecycle, assets } = makeMenuProjection();
    const failure = new Error('system close callback');
    try {
      layer.showSystemMenu([], vi.fn(), () => { throw failure; });
      expect(() => (root.children.at(-1)?.children[0] as Container).emit('pointerdown', pointerEvent)).toThrow(failure);
      expect(layer.menu()).toEqual({ type: 'none' });
      expect(lifecycle.snapshot().listeners).toBe(0);
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('keeps deterministic projection shapes for title, ending, system, settings, save and load', () => {
    const { root, layer, lifecycle, assets } = makeMenuProjection();
    const capture = (show: () => void, hide: () => void): unknown => {
      show();
      const first = projectionSignature(root);
      hide();
      show();
      const second = projectionSignature(root);
      hide();
      expect(second).toEqual(first);
      return first;
    };
    try {
      capture(
        () => layer.showTitle({ title: 'Surdet', items: [{ id: 'start', label: '开始' }] }, vi.fn()),
        () => layer.hideTitle(false),
      );
      capture(() => layer.showEnding('THE END'), () => layer.hideEnding());
      capture(
        () => layer.showSystemMenu([{ id: 'settings', label: '设置' }], vi.fn(), vi.fn()),
        () => layer.hideSystemMenu(),
      );
      capture(
        () => layer.showSettings([{ id: 'textSpeed', label: '文字速度', display: '普通' }], vi.fn(), vi.fn()),
        () => layer.hideSettings(),
      );
      capture(
        () => layer.showSaveLoad({ mode: 'save', slots: [{ id: 'slot-1', empty: true }] }, vi.fn(), vi.fn()),
        () => layer.hideSaveLoad(),
      );
      capture(
        () => layer.showSaveLoad({ mode: 'load', slots: [{ id: 'slot-1', empty: false, label: '序章' }] }, vi.fn(), vi.fn()),
        () => layer.hideSaveLoad(),
      );
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('keeps two independent 50-cycle batches at the same disposed menu stable point', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const runBatch = (): ReturnType<RenderLifecycle['snapshot']> => {
      for (let i = 0; i < 50; i++) {
        const root = new Container();
        const layer = new MenuLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle });
        exerciseMenuLayer(layer);
        layer.dispose();
        expect(root.children).toHaveLength(0);
      }
      return lifecycle.snapshot();
    };
    try {
      const first = runBatch();
      const second = runBatch();
      expect(second).toEqual(first);
      expect(second.listeners).toBe(0);
      expect(second.activeTweens).toBe(0);
      expect(second.displayObjectsByOwner.menu).toBe(0);
    } finally {
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('releases the thumbnail pool when save/load projection is hidden or reset', () => {
    const { layer, lifecycle, assets } = makeMenuProjection();
    const from = vi.spyOn(Texture, 'from').mockImplementation(() => new Texture());
    try {
      layer.showSaveLoad({
        mode: 'save',
        slots: [{ id: 'slot-1', empty: false, label: '序章', thumbnail: 'thumb-1' }],
      }, vi.fn(), vi.fn());
      expect(lifecycle.snapshot().pooledObjects).toEqual({ 'menu:thumbnail:thumb-1': 1 });
      layer.hideSaveLoad();
      expect(lifecycle.snapshot().pooledObjects).toEqual({ 'menu:thumbnail:thumb-1': 1 });

      layer.showSaveLoad({
        mode: 'save',
        slots: [{ id: 'slot-1', empty: false, label: '序章', thumbnail: 'thumb-1' }],
      }, vi.fn(), vi.fn());
      layer.reset();
      expect(lifecycle.snapshot().pooledObjects).toEqual({});
      expect(from).toHaveBeenCalledOnce();
    } finally {
      from.mockRestore();
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('consumes an empty load slot without selecting or closing the page', () => {
    const onPointerConsumed = vi.fn();
    const { root, layer, lifecycle, assets } = makeMenuProjection(onPointerConsumed);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    try {
      layer.showSaveLoad({
        mode: 'load',
        slots: [{ id: 'slot-empty', empty: true }],
      }, onSelect, onClose);

      const card = findParentWithText(root, '空槽位');
      expect(card.eventMode).toBe('static');
      card.emit('pointerdown', pointerEvent);

      expect(onPointerConsumed).toHaveBeenCalledOnce();
      expect(onSelect).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(layer.menu()).toEqual({ type: 'save-load', mode: 'load' });
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });

  it('releases a real data-url thumbnail without a renderer lifecycle error', () => {
    const { layer, lifecycle, assets } = makeMenuProjection();
    const thumbnail = 'data:image/png;base64,task5-real-thumbnail';
    const show = (): void => layer.showSaveLoad({
      mode: 'load',
      slots: [{ id: 'slot-1', empty: false, label: '序章', thumbnail }],
    }, vi.fn(), vi.fn());
    try {
      show();
      layer.hideSaveLoad();
      show();

      expect(() => layer.reset()).not.toThrow();
      expect(lifecycle.snapshot().pooledObjects).toEqual({});
    } finally {
      layer.dispose();
      assets.dispose();
      lifecycle.dispose();
    }
  });
});
