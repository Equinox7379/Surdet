import {
  Container,
  Graphics,
  Text as PText,
  type TextStyleOptions,
} from 'pixi.js';
import type { BattleHandlers, BattleView } from '../../battle-view.js';
import { AsyncGeneration } from '../../lifecycle/async-generation.js';
import { RenderLifecycle } from '../../lifecycle/render-lifecycle.js';
import type { FrameRequestHandler } from '../../types.js';
import type { BasePanelView, MapView } from '../../ui-views.js';
import type {
  RendererFontRole,
  ShopView,
  SystemPanelProjectionPort,
} from '../../api/renderer-commands.js';
import type { SystemPanelOverlayState } from '../../api/renderer-queries.js';
import { RenderAssetRegistry } from '../../services/render-asset-registry.js';
import { DEFAULT_RENDERER_THEME, type RendererTheme } from '../../theme.js';
import {
  bindThemeTextProjection,
  readThemeProjection,
  repaintThemeProjection,
  type LayerThemeProjectionSnapshot,
} from '../../theme-projection.js';

type PanelName = 'battle' | 'map' | 'shop' | 'base';

interface PanelHandlers {
  readonly onEnter?: (nodeId: string) => void;
  readonly onEndTurn?: () => void;
  readonly onBuy?: (itemId: string) => void;
  readonly onShopClose?: () => void;
  readonly onExecute?: (commandId: string) => void;
  readonly onBaseClose?: () => void;
}

export interface SystemPanelLayerOptions {
  readonly uiLayer: Container;
  readonly width: number;
  readonly height: number;
  readonly assets: RenderAssetRegistry;
  readonly lifecycle?: RenderLifecycle;
  readonly requestFrame?: FrameRequestHandler;
}

/** Read-only evidence emitted for the local renderer acceptance harness. */
export interface SystemPanelLayerDebugSnapshot {
  readonly overlay: SystemPanelOverlayState;
  readonly battleUnitCount: number;
  readonly mapNodeCount: number;
  readonly shopItemCount: number;
  readonly baseCommandCount: number;
}

/**
 * Owns battle, map, shop, base-command and video projections.
 *
 * The layer receives already prepared view models and callbacks. It has no
 * knowledge of the solver, calendar, shop rules, persistence, or host adapters;
 * cross-layer decisions remain in RendererFacade/PresentationController.
 */
export class SystemPanelLayer implements SystemPanelProjectionPort {
  readonly owner = 'system' as const;

  readonly #root: Container;
  readonly #w: number;
  readonly #h: number;
  readonly #assets: RenderAssetRegistry;
  readonly #lifecycle: RenderLifecycle;
  readonly #ownsLifecycle: boolean;
  readonly #requestFrameCallback?: FrameRequestHandler;
  readonly #videoGeneration = new AsyncGeneration();
  #disposed = false;
  #theme: RendererTheme = DEFAULT_RENDERER_THEME;
  #frameRequest: FrameRequestHandler | null = null;
  #listenerSequence = 0;
  #listenerKeys = new Map<PanelName, Set<string>>();

  #battleLayer: Container;
  #battleHandlers: BattleHandlers | null = null;
  #battleSelectedSkill: string | null = null;
  #battleUnitCount = 0;
  #mapLayer: Container;
  #mapHandlers: { onEnter: (nodeId: string) => void; onEndTurn: () => void } | null = null;
  #mapNodeCount = 0;
  #shopLayer: Container;
  #shopHandlers: { onBuy: (itemId: string) => void; onClose: () => void } | null = null;
  #shopItemCount = 0;
  #baseLayer: Container;
  #baseHandlers: { onExec: (cmdId: string) => void; onClose: () => void } | null = null;
  #baseCommandCount = 0;
  #activeVideo: HTMLVideoElement | null = null;

  constructor(options: SystemPanelLayerOptions) {
    this.#root = options.uiLayer;
    this.#w = options.width;
    this.#h = options.height;
    this.#assets = options.assets;
    this.#lifecycle = options.lifecycle ?? new RenderLifecycle();
    this.#ownsLifecycle = options.lifecycle === undefined;
    this.#requestFrameCallback = options.requestFrame;

    this.#battleLayer = new Container();
    this.#mapLayer = new Container();
    this.#shopLayer = new Container();
    this.#baseLayer = new Container();
    for (const layer of [this.#battleLayer, this.#mapLayer, this.#shopLayer, this.#baseLayer]) {
      layer.visible = false;
    }
    this.#root.addChild(this.#battleLayer, this.#mapLayer, this.#shopLayer, this.#baseLayer);
    this.#registerDisplay('battle-layer', this.#battleLayer);
    this.#registerDisplay('map-layer', this.#mapLayer);
    this.#registerDisplay('shop-layer', this.#shopLayer);
    this.#registerDisplay('base-layer', this.#baseLayer);
  }

  system(): SystemPanelOverlayState {
    if (this.#disposed) return { type: 'none' };
    if (this.#activeVideo) return { type: 'video' };
    if (this.#baseLayer.visible) return { type: 'base' };
    if (this.#shopLayer.visible) return { type: 'shop' };
    if (this.#mapLayer.visible) return { type: 'map' };
    if (this.#battleLayer.visible) return { type: 'battle' };
    return { type: 'none' };
  }

  /**
   * Test-only read model. It reads the currently projected panel view and has
   * no rendering, resource, listener, or frame-loop side effects.
   */
  debugSnapshot(): SystemPanelLayerDebugSnapshot {
    return {
      overlay: this.system(),
      battleUnitCount: this.#battleUnitCount,
      mapNodeCount: this.#mapNodeCount,
      shopItemCount: this.#shopItemCount,
      baseCommandCount: this.#baseCommandCount,
    };
  }

  themeProjectionSnapshot(): LayerThemeProjectionSnapshot {
    return readThemeProjection(this.#battleLayer, this.#mapLayer, this.#shopLayer, this.#baseLayer);
  }

  setFrameRequest(handler: FrameRequestHandler | null): void {
    this.#frameRequest = handler;
    if (handler && this.needsUpdate) handler();
  }

  setTheme(theme: RendererTheme): void {
    if (this.#disposed) return;
    const previous = this.#theme;
    this.#theme = theme;
    repaintThemeProjection(this.#battleLayer, previous, theme);
    repaintThemeProjection(this.#mapLayer, previous, theme);
    repaintThemeProjection(this.#shopLayer, previous, theme);
    repaintThemeProjection(this.#baseLayer, previous, theme);
  }

  get needsUpdate(): boolean {
    return false;
  }

  update(_deltaMs: number): void {
    // System panels have no frame-owned animation. Video playback is owned by the DOM.
  }

  showBattle(view: BattleView, handlers: BattleHandlers, message = ''): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#clearPanel('battle', this.#battleLayer);
    this.#battleHandlers = handlers;
    this.#battleUnitCount = view.units.length;
    const layer = this.#battleLayer;
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.panel, alpha: 0.9 }));
    const heading = bindThemeTextProjection(new PText({
      text: `回合 ${view.turn} —— 当前行动：${view.actingTeam}`,
      style: { fontSize: 26, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    }), { fill: 'text' });
    layer.addChild(heading).position.set(60, 36);

    const teams = [...new Set(view.units.map((u) => u.team))];
    teams.forEach((team, ti) => {
      const x = 80 + ti * 620;
      layer.addChild(new PText({
        text: `${team}${team === view.actingTeam ? '（行动中）' : ''}`,
        style: { fontSize: 20, fill: team === view.actingTeam ? this.#theme.colors.accent : this.#theme.colors.textMuted, fontWeight: 'bold' } satisfies TextStyleOptions,
      })).position.set(x, 92);
      view.units.filter((u) => u.team === team).forEach((u, i) => {
        const y = 136 + i * 88;
        const row = new Container();
        row.position.set(x, y);
        row.addChild(new Graphics().roundRect(0, 0, 520, 72, 10).fill({ color: u.alive ? this.#theme.colors.surfaceStrong : this.#theme.colors.panel, alpha: 0.96 }));
        row.addChild(new PText({
          text: u.alive ? u.name : `${u.name}（倒下）`,
          style: { fontSize: 20, fill: u.alive ? this.#theme.colors.text : this.#theme.colors.textDisabled } satisfies TextStyleOptions,
        })).position.set(18, 8);
        // Combat HP track/fill colors encode gameplay health, not a Player UI theme role.
        row.addChild(new Graphics().rect(18, 46, 340, 12).fill(0x333340));
        if (u.hpRatio > 0) {
          row.addChild(new Graphics().rect(18, 46, 340 * u.hpRatio, 12).fill(u.hpRatio > 0.35 ? 0x57c26a : 0xd8544f));
        }
        row.addChild(new PText({ text: `${u.hp}/${u.maxHp}`, style: { fontSize: 16, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions })).position.set(372, 40);
        if (u.alive && u.team !== view.actingTeam) {
          row.eventMode = 'static';
          row.cursor = 'pointer';
          this.#listen('battle', row, 'pointerdown', () => {
            this.#battleHandlers?.onAttack(u.uid, this.#battleSelectedSkill);
            this.#battleSelectedSkill = null;
          });
        }
        layer.addChild(row);
      });
    });

    const actingUnit = view.units.find((u) => u.alive && u.team === view.actingTeam);
    if (actingUnit) {
      const skillBtns: { id: string | null; label: string; ready: boolean }[] = [
        { id: null, label: '普攻', ready: true },
        ...actingUnit.skills.map((s) => ({
          id: s.id,
          label: s.ready ? s.name : `${s.name}（冷却 ${s.cooldown}）`,
          ready: s.ready,
        })),
      ];
      let sx = 60;
      for (const btn of skillBtns) {
        const selected = btn.id !== null && btn.id === this.#battleSelectedSkill;
        const t = new PText({
          text: btn.label,
          style: {
            fontSize: 18,
            fill: selected ? this.#theme.colors.textOnAccent : btn.ready ? this.#theme.colors.text : this.#theme.colors.textDisabled,
          } satisfies TextStyleOptions,
        });
        const pad = new Graphics().roundRect(sx - 10, this.#h - 150, t.width + 20, 34, 8)
          .fill({ color: selected ? this.#theme.colors.accent : this.#theme.colors.surface, alpha: 0.95 });
        layer.addChild(pad);
        t.position.set(sx, this.#h - 144);
        layer.addChild(t);
        if (btn.ready) {
          pad.eventMode = 'static';
          pad.cursor = 'pointer';
          this.#listen('battle', pad, 'pointerdown', () => {
            this.#battleSelectedSkill = btn.id;
            if (this.#battleHandlers) this.showBattle(view, this.#battleHandlers, message);
          });
        }
        sx += t.width + 34;
      }
      if (actingUnit.canMove) {
        const mkMove = (label: string, dir: -1 | 1, x: number): void => {
          const b = new PText({
            text: label,
            style: { fontSize: 18, fill: this.#theme.colors.accentSoft } satisfies TextStyleOptions,
          });
          b.position.set(x, this.#h - 144);
          b.eventMode = 'static';
          b.cursor = 'pointer';
          this.#listen('battle', b, 'pointerdown', () => this.#battleHandlers?.onMove?.(dir));
          layer.addChild(b);
        };
        mkMove('◀ 移动', -1, sx + 30);
        mkMove('移动 ▶', 1, sx + 140);
      }
    }

    layer.addChild(new PText({
      text: message.length > 0 ? message : '点击敌方单位发起攻击',
      style: { fontSize: 20, fill: this.#theme.colors.text } satisfies TextStyleOptions,
    })).position.set(60, this.#h - 84);
    const pass = new PText({ text: '▸ 跳过行动', style: { fontSize: 20, fill: this.#theme.colors.accent } satisfies TextStyleOptions });
    pass.position.set(this.#w - 210, this.#h - 84);
    pass.eventMode = 'static';
    pass.cursor = 'pointer';
    this.#listen('battle', pass, 'pointerdown', () => this.#battleHandlers?.onPass());
    layer.addChild(pass);
    layer.visible = true;
  }

  hideBattle(): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#battleLayer.visible = false;
    this.#clearPanel('battle', this.#battleLayer);
    this.#battleHandlers = null;
    this.#battleUnitCount = 0;
  }

  showMap(view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#clearPanel('map', this.#mapLayer);
    this.#mapHandlers = { onEnter, onEndTurn };
    this.#mapNodeCount = view.nodes.length;
    const layer = this.#mapLayer;
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.panel, alpha: 0.95 }));
    layer.addChild(new PText({
      text: `${view.date} —— 回合 ${view.turn}`,
      style: { fontSize: 24, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 36);
    layer.addChild(new PText({ text: '行动力', style: { fontSize: 16, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions })).position.set(this.#w - 60 - view.maxAp * 30 - 60, 40);
    // AP and visited-node colors encode gameplay availability/state; keep them outside theme tokens.
    for (let i = 0; i < view.maxAp; i++) {
      layer.addChild(new Graphics().circle(this.#w - 60 - (view.maxAp - i) * 30 + 10, 50, 10).fill(i < view.ap ? 0x57c26a : 0x333340));
    }
    for (const node of view.nodes) {
      const dot = new Container();
      dot.position.set(node.x, node.y);
      const color = node.enterable ? this.#theme.colors.accent : node.visited ? 0x5a7a8a : 0x333340;
      dot.addChild(new Graphics().circle(0, 0, 26).fill({ color, alpha: node.enterable ? 0.95 : 0.6 }));
      if (node.visited) {
        dot.addChild(new PText({ text: '✓', style: { fontSize: 20, fill: this.#theme.colors.text } satisfies TextStyleOptions })).position.set(-9, -13);
      }
      const nameTag = new PText({
        text: `${node.name}${node.apCost > 0 ? `（行动力 ${node.apCost}）` : ''}`,
        style: { fontSize: 16, fill: node.enterable ? this.#theme.colors.text : this.#theme.colors.textDisabled } satisfies TextStyleOptions,
      });
      nameTag.anchor.set(0.5, 0);
      nameTag.position.set(0, 34);
      dot.addChild(nameTag);
      if (node.enterable) {
        dot.eventMode = 'static';
        dot.cursor = 'pointer';
        this.#listen('map', dot, 'pointerdown', () => {
          const callback = this.#mapHandlers?.onEnter;
          this.hideMap();
          callback?.(node.id);
        });
      }
      layer.addChild(dot);
    }
    const end = new PText({ text: '▸ 结束回合', style: { fontSize: 22, fill: this.#theme.colors.accent } satisfies TextStyleOptions });
    end.position.set(this.#w - 210, this.#h - 70);
    end.eventMode = 'static';
    end.cursor = 'pointer';
    this.#listen('map', end, 'pointerdown', () => {
      const callback = this.#mapHandlers?.onEndTurn;
      this.hideMap();
      callback?.();
    });
    layer.addChild(end);
    layer.visible = true;
  }

  hideMap(): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#mapLayer.visible = false;
    this.#clearPanel('map', this.#mapLayer);
    this.#mapHandlers = null;
    this.#mapNodeCount = 0;
  }

  showShop(view: ShopView, onBuy: (itemId: string) => void, onClose: () => void): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#clearPanel('shop', this.#shopLayer);
    this.#shopHandlers = { onBuy, onClose };
    this.#shopItemCount = view.items.length;
    const layer = this.#shopLayer;
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.panel, alpha: 0.96 }));
    layer.addChild(new PText({
      text: '商 店',
      style: { fontSize: 32, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 36);
    layer.addChild(new PText({
      text: `金币：${view.gold}`,
      // Gold is an in-world economy indicator, not a generic UI accent.
      style: { fontSize: 22, fill: 0xffd77a } satisfies TextStyleOptions,
    })).position.set(this.#w - 240, 44);
    view.items.forEach((item, i) => {
      const affordable = view.gold >= item.price;
      const row = new Container();
      row.position.set(60, 120 + i * 64);
      row.addChild(new Graphics().roundRect(0, 0, 720, 52, 10).fill({ color: this.#theme.colors.surfaceStrong, alpha: 0.96 }));
      row.addChild(new PText({ text: item.name, style: { fontSize: 22, fill: this.#theme.colors.text } satisfies TextStyleOptions })).position.set(20, 13);
      row.addChild(new PText({ text: `${item.price} 金币`, style: { fontSize: 18, fill: 0xffd77a } satisfies TextStyleOptions })).position.set(320, 16);
      const btn = new PText({
        text: affordable ? '购买' : '金币不足',
      style: { fontSize: 20, fill: affordable ? this.#theme.colors.accent : this.#theme.colors.textDisabled } satisfies TextStyleOptions,
      });
      btn.position.set(580, 14);
      if (affordable) {
        btn.eventMode = 'static';
        btn.cursor = 'pointer';
        this.#listen('shop', btn, 'pointerdown', () => this.#shopHandlers?.onBuy(item.id));
      }
      row.addChild(btn);
      layer.addChild(row);
    });
    if (view.message && view.message.length > 0) {
      layer.addChild(new PText({ text: view.message, style: { fontSize: 20, fill: this.#theme.colors.text } satisfies TextStyleOptions })).position.set(60, this.#h - 130);
    }
    const close = new PText({ text: '✕ 离开商店', style: { fontSize: 22, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions });
    close.position.set(this.#w - 220, this.#h - 74);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    this.#listen('shop', close, 'pointerdown', () => {
      const callback = this.#shopHandlers?.onClose;
      this.hideShop();
      callback?.();
    });
    layer.addChild(close);
    layer.visible = true;
  }

  hideShop(): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#shopLayer.visible = false;
    this.#clearPanel('shop', this.#shopLayer);
    this.#shopHandlers = null;
    this.#shopItemCount = 0;
  }

  showBaseCommands(view: BasePanelView, onExec: (cmdId: string) => void, onClose: () => void): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#clearPanel('base', this.#baseLayer);
    this.#baseHandlers = { onExec, onClose };
    this.#baseCommandCount = view.commands.length;
    const layer = this.#baseLayer;
    layer.addChild(new Graphics().rect(0, 0, this.#w, this.#h).fill({ color: this.#theme.colors.panel, alpha: 0.96 }));
    layer.addChild(new PText({
      text: '据 点 指 令',
      style: { fontSize: 32, fill: this.#theme.colors.text, fontWeight: 'bold' } satisfies TextStyleOptions,
    })).position.set(60, 36);
    // AP is a gameplay resource indicator; its gold-colored label is intentionally not a theme token.
    layer.addChild(new PText({
      text: `${view.date}　行动力：${view.ap}/${view.maxAp}`,
      style: { fontSize: 22, fill: 0xffd77a } satisfies TextStyleOptions,
    })).position.set(this.#w - 340, 44);
    view.commands.forEach((cmd, i) => {
      const row = new Container();
      row.position.set(60, 120 + i * 64);
      row.addChild(new Graphics().roundRect(0, 0, 860, 52, 10).fill({ color: cmd.enabled ? this.#theme.colors.surfaceStrong : this.#theme.colors.panel, alpha: 0.96 }));
      row.addChild(new PText({
        text: cmd.name,
        style: { fontSize: 22, fill: cmd.enabled ? this.#theme.colors.text : this.#theme.colors.textDisabled } satisfies TextStyleOptions,
      })).position.set(20, 13);
      row.addChild(new PText({
        text: `AP ${cmd.apCost}${cmd.remaining !== undefined && cmd.remaining !== null ? `（剩 ${cmd.remaining} 次）` : ''}`,
        style: { fontSize: 18, fill: cmd.enabled ? 0xffd77a : this.#theme.colors.textDisabled } satisfies TextStyleOptions,
      })).position.set(360, 16);
      const btn = new PText({
        text: cmd.enabled ? '执行' : '不可执行',
      style: { fontSize: 20, fill: cmd.enabled ? this.#theme.colors.accent : this.#theme.colors.textDisabled } satisfies TextStyleOptions,
      });
      btn.position.set(720, 14);
      if (cmd.enabled) {
        btn.eventMode = 'static';
        btn.cursor = 'pointer';
        this.#listen('base', btn, 'pointerdown', () => this.#baseHandlers?.onExec(cmd.id));
      }
      row.addChild(btn);
      layer.addChild(row);
    });
    if (view.message && view.message.length > 0) {
      layer.addChild(new PText({ text: view.message, style: { fontSize: 20, fill: this.#theme.colors.text } satisfies TextStyleOptions })).position.set(60, this.#h - 130);
    }
    const close = new PText({ text: '◀ 返回地图', style: { fontSize: 22, fill: this.#theme.colors.textMuted } satisfies TextStyleOptions });
    close.position.set(this.#w - 220, this.#h - 74);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    this.#listen('base', close, 'pointerdown', () => {
      const callback = this.#baseHandlers?.onClose;
      this.hideBaseCommands();
      callback?.();
    });
    layer.addChild(close);
    layer.visible = true;
  }

  hideBaseCommands(): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#baseLayer.visible = false;
    this.#clearPanel('base', this.#baseLayer);
    this.#baseHandlers = null;
    this.#baseCommandCount = 0;
  }

  showVideo(source: string, onEnd: () => void): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#cancelVideo();
    if (typeof document === 'undefined') {
      onEnd();
      return;
    }
    const token = this.#videoGeneration.token();
    const video = document.createElement('video');
    video.src = source;
    video.autoplay = true;
    video.playsInline = true;
    Object.assign(video.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      background: '#000',
      zIndex: '1000',
    });
    this.#activeVideo = video;
    let done = false;
    const finish = (): void => {
      if (done || !token.current || this.#activeVideo !== video) return;
      done = true;
      this.#activeVideo = null;
      this.#lifecycle.release('system', 'listener', 'video-listeners');
      video.remove();
      onEnd();
    };
    video.addEventListener('ended', finish);
    video.addEventListener('error', finish);
    video.addEventListener('pointerdown', finish);
    this.#lifecycle.register('system', 'listener', 'video-listeners', () => {
      video.removeEventListener('ended', finish);
      video.removeEventListener('error', finish);
      video.removeEventListener('pointerdown', finish);
    });
    document.body.appendChild(video);
    void video.play().catch(finish);
  }

  hideVideo(): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#cancelVideo();
  }

  reset(): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#cancelVideo();
    this.#hidePanel('battle', this.#battleLayer);
    this.#hidePanel('map', this.#mapLayer);
    this.#hidePanel('shop', this.#shopLayer);
    this.#hidePanel('base', this.#baseLayer);
    this.#battleHandlers = null;
    this.#mapHandlers = null;
    this.#shopHandlers = null;
    this.#baseHandlers = null;
    this.#battleUnitCount = 0;
    this.#mapNodeCount = 0;
    this.#shopItemCount = 0;
    this.#baseCommandCount = 0;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#cancelVideo();
    this.#hidePanel('battle', this.#battleLayer);
    this.#hidePanel('map', this.#mapLayer);
    this.#hidePanel('shop', this.#shopLayer);
    this.#hidePanel('base', this.#baseLayer);
    this.#battleHandlers = null;
    this.#mapHandlers = null;
    this.#shopHandlers = null;
    this.#baseHandlers = null;
    this.#battleUnitCount = 0;
    this.#mapNodeCount = 0;
    this.#shopItemCount = 0;
    this.#baseCommandCount = 0;
    this.#disposed = true;
    this.#videoGeneration.dispose();
    this.#lifecycle.releaseOwner('system');
    if (this.#ownsLifecycle) this.#lifecycle.dispose();
    this.#frameRequest = null;
  }

  #ensureActive(): boolean {
    return !this.#disposed;
  }

  #requestFrame(): void {
    this.#frameRequest?.();
    this.#requestFrameCallback?.();
  }

  #registerDisplay(key: string, layer: Container): void {
    this.#lifecycle.register('system', 'display', key, () => {
      if (layer.parent) layer.parent.removeChild(layer);
      layer.destroy({ children: true });
    });
  }

  #listen(panel: PanelName, target: Container, event: 'pointerdown', handler: () => void): void {
    target.on(event, handler);
    const key = `${panel}-listener-${++this.#listenerSequence}`;
    const keys = this.#listenerKeys.get(panel) ?? new Set<string>();
    keys.add(key);
    this.#listenerKeys.set(panel, keys);
    this.#lifecycle.register('system', 'listener', key, () => {
      target.off(event, handler);
      keys.delete(key);
    });
  }

  #clearPanel(panel: PanelName, layer: Container): void {
    for (const key of [...(this.#listenerKeys.get(panel) ?? [])]) {
      this.#lifecycle.release('system', 'listener', key);
    }
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));
  }

  #hidePanel(panel: PanelName, layer: Container): void {
    layer.visible = false;
    this.#clearPanel(panel, layer);
  }

  #cancelVideo(): void {
    if (this.#disposed) return;
    this.#videoGeneration.advance();
    const video = this.#activeVideo;
    this.#activeVideo = null;
    this.#lifecycle.release('system', 'listener', 'video-listeners');
    if (!video) return;
    video.pause();
    video.remove();
  }
}
