import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Container, Graphics, Rectangle, Text as PText, type FederatedPointerEvent } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleView } from '../../src/battle-view.js';
import type { DialogueProjectionPort, SystemPanelProjectionPort } from '../../src/api/renderer-commands.js';
import { RendererFacade, type RendererControllerPort, type RendererStagePort } from '../../src/runtime/renderer-facade.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { SystemPanelLayer } from '../../src/layers/system-panel/system-panel-layer.js';
import type { BasePanelView, MapView } from '../../src/ui-views.js';

const pointerEvent = {} as FederatedPointerEvent;

beforeEach(() => {
  class FakeCanvasRenderingContext2D {
    font = '';
    letterSpacing = '';
    textLetterSpacing = '';

    measureText(text: string) {
      return { width: text.length * 10, actualBoundingBoxAscent: 20, actualBoundingBoxDescent: 5 };
    }
  }
  vi.stubGlobal('CanvasRenderingContext2D', FakeCanvasRenderingContext2D);
  vi.stubGlobal('document', makeVideoDocument([]));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface SystemRuntime {
  readonly root: Container;
  readonly layer: SystemPanelLayer;
  readonly lifecycle: RenderLifecycle;
  readonly assets: RenderAssetRegistry;
}

function makeRuntime(): SystemRuntime {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const layer = new SystemPanelLayer({
    uiLayer: root,
    width: 1280,
    height: 720,
    assets,
    lifecycle,
  });
  return { root, layer, lifecycle, assets };
}

function disposeRuntime(runtime: SystemRuntime): void {
  runtime.layer.dispose();
  runtime.assets.dispose();
  runtime.lifecycle.dispose();
}

function findText(root: Container, value: string): PText {
  const visit = (container: Container): PText | undefined => {
    if (container instanceof PText && container.text === value) return container;
    for (const child of container.children) {
      if (child instanceof PText && child.text === value) return child;
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
    if (container.children.some((child) => child instanceof PText && child.text === value)) return container;
    for (const child of container.children) {
      if (child instanceof Container) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const found = visit(root);
  expect(found, `container containing ${value} should be projected`).toBeDefined();
  return found as Container;
}

function emitPreviousSibling(label: PText): void {
  const parent = label.parent;
  expect(parent).toBeInstanceOf(Container);
  const index = parent!.children.indexOf(label);
  const previous = parent!.children[index - 1];
  expect(previous).toBeInstanceOf(Graphics);
  previous!.emit('pointerdown', pointerEvent);
}

function battleView(): BattleView {
  return {
    turn: 2,
    actingTeam: 'heroes',
    finished: false,
    winner: null,
    units: [
      {
        uid: 'hero',
        name: '林恩',
        team: 'heroes',
        hp: 20,
        maxHp: 20,
        hpRatio: 1,
        alive: true,
        skills: [{ id: 'fire', name: '火球', ready: true, cooldown: 0 }],
        canMove: true,
      },
      {
        uid: 'slime',
        name: '史莱姆',
        team: 'enemies',
        hp: 10,
        maxHp: 10,
        hpRatio: 1,
        alive: true,
        skills: [],
        canMove: false,
      },
    ],
  };
}

function mapView(): MapView {
  return {
    turn: 3,
    ap: 2,
    maxAp: 3,
    date: '2026-08-09',
    nodes: [
      { id: 'base', name: '据点', x: 320, y: 240, enterable: true, visited: false, apCost: 1, isBase: true },
      { id: 'locked', name: '旧站', x: 700, y: 420, enterable: false, visited: false, apCost: 2 },
    ],
  };
}

function baseView(): BasePanelView {
  return {
    ap: 2,
    maxAp: 4,
    date: '2026-08-09',
    commands: [
      { id: 'rest', name: '休息', apCost: 1, enabled: true, remaining: null },
      { id: 'locked', name: '训练', apCost: 3, enabled: false, remaining: 0 },
    ],
  };
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
  } as unknown as RendererControllerPort;
}

describe('SystemPanelLayer direct contract', () => {
  it('projects battle units, skills, targets, movement, pass, hide, and reset callbacks', () => {
    const runtime = makeRuntime();
    const onAttack = vi.fn();
    const onMove = vi.fn();
    const onPass = vi.fn();
    try {
      runtime.layer.showBattle(battleView(), { onAttack, onMove, onPass }, '准备行动');
      expect(runtime.layer.system()).toEqual({ type: 'battle' });

      emitPreviousSibling(findText(runtime.root, '火球'));
      findParentWithText(runtime.root, '史莱姆').emit('pointerdown', pointerEvent);
      expect(onAttack).toHaveBeenCalledOnce();
      expect(onAttack).toHaveBeenCalledWith('slime', 'fire');

      findText(runtime.root, '◀ 移动').emit('pointerdown', pointerEvent);
      findText(runtime.root, '▸ 跳过行动').emit('pointerdown', pointerEvent);
      expect(onMove).toHaveBeenCalledWith(-1);
      expect(onPass).toHaveBeenCalledOnce();

      runtime.layer.hideBattle();
      expect(runtime.layer.system()).toEqual({ type: 'none' });
      runtime.layer.showBattle(battleView(), { onAttack, onMove, onPass });
      runtime.layer.reset();
      expect(runtime.layer.system()).toEqual({ type: 'none' });
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('projects map travel and end-turn callbacks, hides before dispatch, and is repeatable', () => {
    const runtime = makeRuntime();
    const onEnter = vi.fn();
    const onEndTurn = vi.fn();
    try {
      runtime.layer.showMap(mapView(), onEnter, onEndTurn);
      expect(runtime.layer.system()).toEqual({ type: 'map' });
      findParentWithText(runtime.root, '据点（行动力 1）').emit('pointerdown', pointerEvent);
      expect(runtime.layer.system()).toEqual({ type: 'none' });
      expect(onEnter).toHaveBeenCalledOnce();
      expect(onEnter).toHaveBeenCalledWith('base');

      runtime.layer.showMap(mapView(), onEnter, onEndTurn);
      findText(runtime.root, '▸ 结束回合').emit('pointerdown', pointerEvent);
      expect(runtime.layer.system()).toEqual({ type: 'none' });
      expect(onEndTurn).toHaveBeenCalledOnce();
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('projects shop buy/close and base command/close callbacks without owning domain rules', () => {
    const runtime = makeRuntime();
    const onBuy = vi.fn();
    const onShopClose = vi.fn();
    const onExecute = vi.fn();
    const onBaseClose = vi.fn();
    try {
      runtime.layer.showShop({
        gold: 100,
        items: [
          { id: 'potion', name: '药水', price: 40 },
          { id: 'expensive', name: '秘药', price: 200 },
        ],
        message: '欢迎光临！',
      }, onBuy, onShopClose);
      expect(runtime.layer.system()).toEqual({ type: 'shop' });
      findText(runtime.root, '购买').emit('pointerdown', pointerEvent);
      expect(onBuy).toHaveBeenCalledOnce();
      expect(onBuy).toHaveBeenCalledWith('potion');
      findText(runtime.root, '✕ 离开商店').emit('pointerdown', pointerEvent);
      expect(onShopClose).toHaveBeenCalledOnce();
      expect(runtime.layer.system()).toEqual({ type: 'none' });

      runtime.layer.showBaseCommands(baseView(), onExecute, onBaseClose);
      expect(runtime.layer.system()).toEqual({ type: 'base' });
      findText(runtime.root, '执行').emit('pointerdown', pointerEvent);
      expect(onExecute).toHaveBeenCalledOnce();
      expect(onExecute).toHaveBeenCalledWith('rest');
      findText(runtime.root, '◀ 返回地图').emit('pointerdown', pointerEvent);
      expect(onBaseClose).toHaveBeenCalledOnce();
      expect(runtime.layer.system()).toEqual({ type: 'none' });
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('gives active controls complete hit areas, accessible names, and readable disabled reasons', () => {
    const runtime = makeRuntime();
    const onEnter = vi.fn();
    const onBuy = vi.fn();
    const onExecute = vi.fn();
    try {
      runtime.layer.showMap({
        ...mapView(),
        ap: 1,
        nodes: [
          { id: 'open', name: '据点', x: 320, y: 240, enterable: true, visited: false, apCost: 1, isBase: true },
          { id: 'locked', name: '旧站', x: 700, y: 420, enterable: false, visited: false, apCost: 2 },
        ],
      }, onEnter, vi.fn());
      const openNode = findParentWithText(runtime.root, '据点（行动力 1）');
      expect(openNode.accessibleTitle).toBe('进入 据点');
      expect(openNode.hitArea).toEqual(expect.objectContaining({ width: 150, height: 96 }));
      const lockedNode = findParentWithText(runtime.root, '旧站（行动力 2）（行动力不足）');
      expect(lockedNode.accessibleTitle).toContain('行动力不足');
      expect(lockedNode.tabIndex).toBe(-1);
      lockedNode.emit('pointerdown', pointerEvent);
      expect(onEnter).not.toHaveBeenCalled();
      expect((runtime.root.children[1] as Container).children[0]).toMatchObject({ eventMode: 'static' });
      runtime.layer.hideMap();

      runtime.layer.showShop({
        gold: 1,
        items: [{ id: 'locked', name: '一把需要长文字说明的稀有武器', price: 40 }],
      }, onBuy, vi.fn());
      const unavailable = findText(runtime.root, '金币不足');
      expect(unavailable.accessibleTitle).toContain('金币不足');
      expect(unavailable.tabIndex).toBe(-1);
      expect(unavailable.style.wordWrap).toBe(true);
      unavailable.emit('pointerdown', pointerEvent);
      expect(onBuy).not.toHaveBeenCalled();
      runtime.layer.hideShop();

      runtime.layer.showBaseCommands({
        ...baseView(),
        commands: [{ id: 'locked', name: '一个需要完整显示名称的训练项目', apCost: 5, enabled: false, remaining: 0 }],
      }, onExecute, vi.fn());
      const disabled = findText(runtime.root, '不可执行');
      expect(disabled.accessibleTitle).toContain('行动力不足');
      expect(disabled.tabIndex).toBe(-1);
      expect(findText(runtime.root, '一个需要完整显示名称的训练项目').style.wordWrap).toBe(true);
      disabled.emit('pointerdown', pointerEvent);
      expect(onExecute).not.toHaveBeenCalled();
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('covers wrapped map labels and scrolls a long shop list inside its masked viewport', () => {
    const runtime = makeRuntime();
    const onEnter = vi.fn();
    const onBuy = vi.fn();
    const onShopClose = vi.fn();
    try {
      const longName = '一个需要完整显示多行中文名称的地图节点';
      runtime.layer.showMap({
        ...mapView(),
        nodes: [{ id: 'long', name: longName, x: 320, y: 240, enterable: true, visited: false, apCost: 1, isBase: false }],
      }, onEnter, vi.fn());
      const longNode = findParentWithText(runtime.root, `${longName}（行动力 1）`);
      expect(longNode.hitArea).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
      expect((longNode.hitArea as Rectangle).width).toBeGreaterThan(150);
      expect((longNode.hitArea as Rectangle).height).toBeGreaterThan(96);
      const border = longNode.children.find((child) => child instanceof Graphics && child !== longNode.children[0]);
      expect(border).toBeInstanceOf(Graphics);
      expect((border as Graphics).getLocalBounds().height).toBeGreaterThan(96);
      longNode.emit('pointerdown', pointerEvent);
      expect(onEnter).toHaveBeenCalledWith('long');

      runtime.layer.showShop({
        gold: 1000,
        items: Array.from({ length: 24 }, (_, index) => ({ id: `item-${index}`, name: `一个需要完整显示的商品 ${index}`, price: 10 })),
      }, onBuy, onShopClose);
      const lastRow = findParentWithText(runtime.root, '一个需要完整显示的商品 23');
      const list = lastRow.parent;
      expect(list).toBeInstanceOf(Container);
      expect(list?.mask).toBeInstanceOf(Graphics);
      expect((list?.mask as Graphics).eventMode).toBe('none');
      const before = (list as Container).y;
      const purchase = lastRow.children.find((child) => child instanceof PText && child.text === '购买');
      expect(purchase).toBeInstanceOf(PText);
      purchase!.emit('mouseover', {} as FederatedPointerEvent);
      expect((list as Container).y).toBeLessThan(before);
      purchase!.emit('pointerdown', pointerEvent);
      expect(onBuy).toHaveBeenCalledWith('item-23');
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('handles video end, error, skip, hide, late events, and callback exceptions transactionally', () => {
    const videos: FakeVideo[] = [];
    vi.stubGlobal('document', makeVideoDocument(videos));
    const runtime = makeRuntime();
    const onEnd = vi.fn();
    const failure = new Error('video callback failure');
    try {
      runtime.layer.showVideo('intro.mp4', onEnd);
      expect(runtime.layer.system()).toEqual({ type: 'video' });
      videos[0]!.emit('ended');
      expect(onEnd).toHaveBeenCalledOnce();
      expect(runtime.layer.system()).toEqual({ type: 'none' });

      runtime.layer.showVideo('error.mp4', onEnd);
      videos[1]!.emit('error');
      expect(onEnd).toHaveBeenCalledTimes(2);

      runtime.layer.showVideo('skip.mp4', onEnd);
      videos[2]!.emit('pointerdown');
      expect(onEnd).toHaveBeenCalledTimes(3);

      runtime.layer.showVideo('hidden.mp4', onEnd);
      runtime.layer.hideVideo();
      videos[3]!.emit('ended');
      expect(onEnd).toHaveBeenCalledTimes(3);

      runtime.layer.showVideo('late-a.mp4', onEnd);
      runtime.layer.hideVideo();
      runtime.layer.showVideo('late-b.mp4', onEnd);
      videos[4]!.emit('ended');
      expect(onEnd).toHaveBeenCalledTimes(3);
      videos[5]!.emit('ended');
      expect(onEnd).toHaveBeenCalledTimes(4);

      runtime.layer.showVideo('throws.mp4', () => { throw failure; });
      expect(() => videos[6]!.emit('ended')).toThrow(failure);
      expect(runtime.layer.system()).toEqual({ type: 'none' });

      runtime.layer.showVideo('reset.mp4', onEnd);
      runtime.layer.reset();
      videos[7]!.emit('ended');
      expect(onEnd).toHaveBeenCalledTimes(4);
      expect(runtime.layer.system()).toEqual({ type: 'none' });

      runtime.layer.showVideo('dispose.mp4', onEnd);
      runtime.layer.dispose();
      videos[8]!.emit('ended');
      expect(onEnd).toHaveBeenCalledTimes(4);
    } finally {
      disposeRuntime(runtime);
      vi.unstubAllGlobals();
    }
  });

  it('keeps domain and host dependencies outside SystemPanelLayer', () => {
    const sourcePath = fileURLToPath(new URL('../../src/layers/system-panel/system-panel-layer.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');
    expect(source).not.toMatch(/from ['"][^'"]*(?:@surdet\/core|interpreter|variable-store|calendar|shop|host)[^'"]*['"]/i);
    expect(source).not.toMatch(/from ['"][^'"]*\/layers\/(?!system-panel)[^'"]*['"]/i);
  });

  it('keeps v2 SystemPanel callbacks and overlay queries in the Facade', () => {
    const runtime = makeRuntime();
    const stage = {
      destroy: vi.fn(),
      showMap: vi.fn(),
      hideMap: vi.fn(),
    } as unknown as RendererStagePort;
    const facade = new RendererFacade({
      stage,
      controller: makeController(),
      monitor: new RenderPerformanceMonitor(),
      systemPanelLayer: runtime.layer as unknown as SystemPanelProjectionPort,
      dialogueLayer: { hideCommandRail: vi.fn() } as unknown as DialogueProjectionPort,
    });
    const onEnter = vi.fn();
    const onEndTurn = vi.fn();
    try {
      facade.commands.system.showMap(mapView(), onEnter, onEndTurn);
      expect(stage.showMap).not.toHaveBeenCalled();
      expect(facade.queries.overlay.system()).toEqual({ type: 'map' });
      findParentWithText(runtime.root, '据点（行动力 1）').emit('pointerdown', pointerEvent);
      expect(onEnter).toHaveBeenCalledOnce();
      expect(facade.queries.overlay.system()).toEqual({ type: 'none' });

      facade.commands.system.showBattle(battleView(), { onAttack: vi.fn(), onPass: vi.fn() });
      expect(facade.queries.overlay.system()).toEqual({ type: 'battle' });
      facade.commands.system.hideBattle();
      expect(facade.queries.overlay.system()).toEqual({ type: 'none' });
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('keeps two independent 50-cycle batches at the same disposed system stable point', () => {
    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    const runBatch = (): ReturnType<RenderLifecycle['snapshot']> => {
      for (let i = 0; i < 50; i++) {
        const root = new Container();
        const layer = new SystemPanelLayer({ uiLayer: root, width: 1280, height: 720, assets, lifecycle });
        layer.showBattle(battleView(), { onAttack: vi.fn(), onPass: vi.fn() });
        layer.hideBattle();
        layer.showMap(mapView(), vi.fn(), vi.fn());
        layer.hideMap();
        layer.showShop({ gold: 100, items: [{ id: 'potion', name: '药水', price: 40 }] }, vi.fn(), vi.fn());
        layer.hideShop();
        layer.showBaseCommands(baseView(), vi.fn(), vi.fn());
        layer.hideBaseCommands();
        layer.showVideo('missing.mp4', vi.fn());
        layer.hideVideo();
        layer.reset();
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
      expect(second.displayObjectsByOwner.system).toBe(0);
    } finally {
      assets.dispose();
      lifecycle.dispose();
    }
  });
});

interface FakeVideo {
  readonly src: string;
  readonly style: Record<string, string>;
  readonly listeners: Map<string, Set<() => void>>;
  paused: boolean;
  removed: boolean;
  autoplay: boolean;
  playsInline: boolean;
  play(): Promise<void>;
  pause(): void;
  remove(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  emit(type: string): void;
}

function makeVideoDocument(videos: FakeVideo[]) {
  const context = {
    font: '',
    measureText: (text: string) => ({ width: text.length * 10, actualBoundingBoxAscent: 20, actualBoundingBoxDescent: 5 }),
  };
  return {
    createElement: (tag: string): FakeVideo => {
      if (tag === 'canvas') return { getContext: () => context } as unknown as FakeVideo;
      if (tag !== 'video') throw new Error(`unexpected element ${tag}`);
      const listeners = new Map<string, Set<() => void>>();
      const video: FakeVideo = {
        src: '',
        style: {},
        listeners,
        paused: false,
        removed: false,
        autoplay: false,
        playsInline: false,
        play: () => Promise.resolve(),
        pause: () => { video.paused = true; },
        remove: () => { video.removed = true; },
        addEventListener: (type, listener) => {
          const bucket = listeners.get(type) ?? new Set<() => void>();
          bucket.add(listener);
          listeners.set(type, bucket);
        },
        removeEventListener: (type, listener) => { listeners.get(type)?.delete(listener); },
        emit: (type) => { for (const listener of [...(listeners.get(type) ?? [])]) listener(); },
      };
      videos.push(video);
      return video;
    },
    body: { appendChild: (_video: FakeVideo) => undefined },
  } as unknown as Document;
}
