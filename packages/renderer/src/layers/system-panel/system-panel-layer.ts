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
  ShopView,
  SystemPanelProjectionPort,
} from '../../api/renderer-commands.js';
import type { SystemPanelOverlayState } from '../../api/renderer-queries.js';
import { RenderAssetRegistry } from '../../services/render-asset-registry.js';
import { bindPlayerControl, markPlayerModal } from '../../player-controls.js';
import { DEFAULT_RENDERER_THEME, type RendererTheme } from '../../theme.js';
import {
  bindThemeGraphicsProjection,
  bindThemeTextProjection,
  readThemeProjection,
  repaintThemeProjection,
  type LayerThemeProjectionSnapshot,
} from '../../theme-projection.js';

type PanelName = 'battle' | 'map' | 'shop' | 'base';
type TextRole = 'text' | 'textMuted' | 'textDisabled' | 'textOnAccent' | 'accent' | 'accentSoft';
type TypographyRole = 'titleSize' | 'headingSize' | 'bodySize' | 'uiSize' | 'captionSize';

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
  #panelLayouts = new Map<PanelName, () => void>();

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
  #shopScrollOffset = 0;
  #shopScrollContent: Container | null = null;
  #shopScrollHeight = 0;
  #shopViewportTop = 0;
  #shopViewportHeight = 0;
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
      markPlayerModal(layer, {});
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
    for (const layout of this.#panelLayouts.values()) layout();
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
    const inputEnabled = view.inputEnabled !== false && !view.finished;
    const layer = this.#battleLayer;
    this.#addPanelBackground(layer);
    const heading = this.#text(`回合 ${view.turn} —— 当前行动：${view.actingTeam}`, this.#w - 120, 'text', 'headingSize', 'bold');
    layer.addChild(heading).position.set(60, 36);

    const teams = [...new Set(view.units.map((u) => u.team))];
    teams.forEach((team, ti) => {
      const x = 80 + ti * 620;
      layer.addChild(this.#text(
        `${team}${team === view.actingTeam ? '（行动中）' : ''}`,
        520,
        team === view.actingTeam ? 'accent' : 'textMuted',
        'uiSize',
        'bold',
      )).position.set(x, 92);
      view.units.filter((u) => u.team === team).forEach((u, i) => {
        const y = 136 + i * 88;
        const row = new Container();
        row.position.set(x, y);
        row.addChild(bindThemeGraphicsProjection(
          new Graphics().roundRect(0, 0, 520, 72, this.#theme.radius.lg).fill({ color: u.alive ? this.#theme.colors.surfaceStrong : this.#theme.colors.panel, alpha: this.#theme.opacity.surface }),
          [u.alive ? 'surfaceStrong' : 'panel'],
        ));
        row.addChild(this.#text(
          u.alive ? u.name : `${u.name}（倒下）`,
          330,
          u.alive ? 'text' : 'textDisabled',
        )).position.set(18, 8);
        // Combat HP track/fill colors encode gameplay health, not a Player UI theme role.
        row.addChild(bindThemeGraphicsProjection(new Graphics().rect(18, 46, 340, 10).fill(0x333340), [null]));
        if (u.hpRatio > 0) {
          row.addChild(bindThemeGraphicsProjection(
            new Graphics().rect(18, 46, 340 * u.hpRatio, 10).fill(u.hpRatio > 0.35 ? 0x57c26a : 0xd8544f),
            [null],
          ));
        }
        row.addChild(this.#text(`${u.hp}/${u.maxHp}`, 120, 'textMuted', 'captionSize')).position.set(372, 40);
        const targetable = inputEnabled && u.alive && u.team !== view.actingTeam;
        this.#controlBorder(row, 520, 72);
        bindPlayerControl(row, {
          label: targetable ? `攻击 ${u.name}` : `${u.name}（不可攻击）`,
          width: 520,
          height: 72,
          enabled: targetable,
        });
        if (targetable) {
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
      const selectSkillAt = (index: number, direction: -1 | 0 | 1 = 0): void => {
        let cursor = (index + skillBtns.length) % skillBtns.length;
        for (let attempts = 0; attempts < skillBtns.length; attempts += 1) {
          const candidate = skillBtns[cursor]!;
          if (candidate.ready) {
            this.#battleSelectedSkill = candidate.id;
            if (this.#battleHandlers) this.showBattle(view, this.#battleHandlers, message);
            return;
          }
          cursor = (cursor + (direction || 1) + skillBtns.length) % skillBtns.length;
        }
      };
      const selectedSkillIndex = (): number => {
        const index = skillBtns.findIndex((btn) => btn.id === this.#battleSelectedSkill);
        return index >= 0 ? index : 0;
      };
      skillBtns.forEach((btn, index) => {
        const selected = btn.id !== null && btn.id === this.#battleSelectedSkill;
        const t = this.#text(
          btn.label,
          240,
          selected ? 'textOnAccent' : btn.ready ? 'text' : 'textDisabled',
        );
        const padWidth = Math.max(72, this.#textWidth(t) + 20);
        const pad = bindThemeGraphicsProjection(
          new Graphics().roundRect(sx - 10, this.#h - 150, padWidth, 34, this.#theme.radius.md)
            .fill({ color: selected ? this.#theme.colors.accent : this.#theme.colors.surface, alpha: this.#theme.opacity.surface }),
          [selected ? 'accent' : 'surface'],
        );
        layer.addChild(pad);
        t.position.set(sx, this.#h - 144);
        layer.addChild(t);
        this.#controlBorder(pad, padWidth, 34, sx - 10, this.#h - 150);
        const skillEnabled = inputEnabled && btn.ready;
        bindPlayerControl(pad, {
          label: btn.ready ? btn.label : `${btn.label}（不可用）`,
          width: padWidth,
          height: 34,
          x: sx - 10,
          y: this.#h - 150,
          enabled: skillEnabled,
          adjust: skillEnabled ? (direction) => selectSkillAt(selectedSkillIndex() + direction, direction) : undefined,
        });
        if (skillEnabled) {
          pad.cursor = 'pointer';
          this.#listen('battle', pad, 'pointerdown', () => {
            selectSkillAt(index);
          });
        }
        sx += padWidth + 14;
      });
      if (actingUnit.canMove) {
        const mkMove = (label: string, dir: -1 | 1, x: number): void => {
          const b = this.#text(label, 112, 'accentSoft');
          b.position.set(x, this.#h - 144);
          layer.addChild(b);
          bindPlayerControl(b, {
            label: dir === -1 ? '向左移动' : '向右移动',
            width: 112,
            height: 40,
            x: -8,
            y: -8,
            enabled: inputEnabled,
          });
          this.#controlBorder(b, 112, 40, -8, -8);
          if (inputEnabled) {
            b.cursor = 'pointer';
            this.#listen('battle', b, 'pointerdown', () => this.#battleHandlers?.onMove?.(dir));
          }
        };
        mkMove('◀ 移动', -1, sx + 30);
        mkMove('移动 ▶', 1, sx + 140);
      }
    }

    layer.addChild(this.#text(message.length > 0 ? message : '点击敌方单位发起攻击', this.#w - 360, 'text')).position.set(60, this.#h - 84);
    const pass = this.#text('▸ 跳过行动', 160, 'accent');
    pass.position.set(this.#w - 210, this.#h - 84);
    layer.addChild(pass);
    bindPlayerControl(pass, { label: '跳过行动', width: 160, height: 44, x: -12, y: -10, enabled: inputEnabled });
    this.#controlBorder(pass, 160, 44, -12, -10);
    if (inputEnabled) {
      pass.cursor = 'pointer';
      this.#listen('battle', pass, 'pointerdown', () => this.#battleHandlers?.onPass());
    }
    layer.visible = true;
  }

  hideBattle(): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#battleLayer.visible = false;
    this.#clearPanel('battle', this.#battleLayer);
    this.#battleHandlers = null;
    this.#battleSelectedSkill = null;
    this.#battleUnitCount = 0;
  }

  showMap(view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#clearPanel('map', this.#mapLayer);
    this.#mapHandlers = { onEnter, onEndTurn };
    this.#mapNodeCount = view.nodes.length;
    const layer = this.#mapLayer;
    this.#addPanelBackground(layer);
    layer.addChild(this.#text(`${view.date} —— 回合 ${view.turn}`, this.#w - 120, 'text', 'headingSize', 'bold')).position.set(60, 36);
    layer.addChild(this.#text('行动力', 120, 'textMuted', 'captionSize')).position.set(this.#w - 60 - view.maxAp * 30 - 60, 40);
    // AP and visited-node colors encode gameplay availability/state; keep them outside theme tokens.
    for (let i = 0; i < view.maxAp; i++) {
      layer.addChild(bindThemeGraphicsProjection(
        new Graphics().circle(this.#w - 60 - (view.maxAp - i) * 30 + 10, 50, 10).fill(i < view.ap ? 0x57c26a : 0x333340),
        [null],
      ));
    }
    for (const node of view.nodes) {
      const dot = new Container();
      dot.position.set(node.x, node.y);
      const color = node.enterable ? this.#theme.colors.accent : node.visited ? 0x5a7a8a : 0x333340;
      dot.addChild(bindThemeGraphicsProjection(
        new Graphics().circle(0, 0, 26).fill({ color, alpha: node.enterable ? 0.95 : 0.6 }),
        [node.enterable ? 'accent' : null],
      ));
      if (node.visited) {
        dot.addChild(this.#text('✓', 32, 'text', 'uiSize')).position.set(-9, -13);
      }
      const reason = this.#mapNodeReason(view, node);
      const nameTag = this.#text(
        `${node.name}${node.apCost > 0 ? `（行动力 ${node.apCost}）` : ''}${reason ? `（${reason}）` : ''}`,
        180,
        node.enterable ? 'text' : 'textDisabled',
        'captionSize',
      );
      nameTag.anchor.set(0.5, 0);
      nameTag.position.set(0, 34);
      dot.addChild(nameTag);
      // The label is part of the node's player-facing control. Size the
      // semantic hit area and focus decoration around wrapped names instead
      // of leaving the lower lines outside the fixed dot rectangle.
      const nodeControlWidth = Math.max(150, Math.ceil(this.#textWidth(nameTag)) + 24);
      const nodeControlHeight = Math.max(96, Math.ceil(this.#textHeight(nameTag)) + 70);
      const nodeControlX = -nodeControlWidth / 2;
      const nodeControlY = -32;
      this.#controlBorder(dot, nodeControlWidth, nodeControlHeight, nodeControlX, nodeControlY);
      bindPlayerControl(dot, {
        label: node.enterable ? `进入 ${node.name}` : `${node.name}：${reason || '暂不可进入'}`,
        width: nodeControlWidth,
        height: nodeControlHeight,
        x: nodeControlX,
        y: nodeControlY,
        enabled: node.enterable,
      });
      if (node.enterable) {
        dot.cursor = 'pointer';
        this.#listen('map', dot, 'pointerdown', () => {
          const callback = this.#mapHandlers?.onEnter;
          this.hideMap();
          callback?.(node.id);
        });
      }
      layer.addChild(dot);
    }
    const end = this.#text('▸ 结束回合', 180, 'accent');
    end.position.set(this.#w - 210, this.#h - 70);
    layer.addChild(end);
    bindPlayerControl(end, { label: '结束回合', width: 180, height: 44, x: -12, y: -10 });
    this.#controlBorder(end, 180, 44, -12, -10);
    end.cursor = 'pointer';
    this.#listen('map', end, 'pointerdown', () => {
      const callback = this.#mapHandlers?.onEndTurn;
      this.hideMap();
      callback?.();
    });
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
    this.#shopScrollOffset = 0;
    const layer = this.#shopLayer;
    this.#addPanelBackground(layer);
    layer.addChild(this.#text('商 店', this.#w - 120, 'text', 'headingSize', 'bold')).position.set(60, 36);
    layer.addChild(bindThemeTextProjection(new PText({
      text: `金币：${view.gold}`,
      // Gold is an in-world economy indicator, not a generic UI accent.
      style: { fontFamily: this.#assets.fontFamily('ui'), fontSize: this.#theme.typography.uiSize, fill: 0xffd77a } satisfies TextStyleOptions,
    }), { fill: null })).position.set(this.#w - 240, 44);

    const width = Math.min(920, this.#w - 120);
    const scrollContent = new Container();
    this.#shopScrollContent = scrollContent;
    this.#shopViewportTop = 104;
    this.#shopViewportHeight = Math.max(80, this.#h - this.#shopViewportTop - 116);
    const mask = bindThemeGraphicsProjection(
      new Graphics().rect(56, this.#shopViewportTop, width + 8, this.#shopViewportHeight).fill(0xffffff),
      [null],
    );
    mask.eventMode = 'none';
    layer.addChild(scrollContent, mask);
    scrollContent.mask = mask;
    const rows = view.items.map((item) => {
      const affordable = view.gold >= item.price;
      const row = new Container();
      let rowHeight = 58;
      const background = bindThemeGraphicsProjection(new Graphics(), ['surfaceStrong']);
      row.addChild(background);
      const nameWidth = Math.max(180, width - 320);
      const name = this.#text(item.name, nameWidth, 'text');
      name.position.set(20, 14);
      row.addChild(name);
      const price = bindThemeTextProjection(
        new PText({ text: `${item.price} 金币`, style: { fontFamily: this.#assets.fontFamily('ui'), fontSize: this.#theme.typography.captionSize, fill: 0xffd77a } satisfies TextStyleOptions }),
        { fill: null },
      );
      row.addChild(price);
      const btn = this.#text(affordable ? '购买' : '金币不足', 140, affordable ? 'accent' : 'textDisabled');
      row.addChild(btn);
      bindPlayerControl(btn, {
        label: affordable ? `购买 ${item.name}` : `${item.name}：金币不足`,
        width: 140,
        height: 44,
        x: -10,
        y: -8,
        enabled: affordable,
        reveal: () => this.#revealShop(row, rowHeight),
      });
      const buttonBorder = this.#controlBorder(btn, 140, 44, -10, -8);
      if (affordable) {
        btn.cursor = 'pointer';
        this.#listen('shop', btn, 'pointerdown', () => this.#shopHandlers?.onBuy(item.id));
      }
      scrollContent.addChild(row);
      return { row, background, name, price, btn, buttonBorder, setHeight: (height: number): void => { rowHeight = height; } };
    });

    const message = view.message && view.message.length > 0
      ? this.#text(view.message, width, 'text')
      : null;
    if (message) scrollContent.addChild(message);

    const close = this.#text('✕ 离开商店', 180, 'textMuted');
    layer.addChild(close);
    bindPlayerControl(close, { label: '离开商店', width: 180, height: 44, x: -12, y: -10 });
    const closeBorder = this.#controlBorder(close, 180, 44, -12, -10);
    close.cursor = 'pointer';
    this.#listen('shop', close, 'pointerdown', () => this.#closeShop());

    const layout = (): void => {
      let y = 0;
      for (const { row, background, name, price, btn, buttonBorder, setHeight } of rows) {
        const rowHeight = Math.max(58, this.#textHeight(name) + 28);
        setHeight(rowHeight);
        row.position.set(60, y);
        background.clear().roundRect(0, 0, width, rowHeight, this.#theme.radius.md)
          .fill({ color: this.#theme.colors.surfaceStrong, alpha: this.#theme.opacity.surface });
        name.position.set(20, (rowHeight - this.#textHeight(name)) / 2);
        price.position.set(width - 280, (rowHeight - this.#textHeight(price)) / 2);
        btn.position.set(width - 150, (rowHeight - this.#textHeight(btn)) / 2);
        buttonBorder.position.copyFrom(btn.position);
        y += rowHeight + this.#theme.spacing.sm;
      }
      if (message) message.position.set(60, y + 8);
      this.#shopScrollHeight = message ? y + 8 + this.#textHeight(message) : y;
      this.#scrollShop(0);
      close.position.set(this.#w - 220, this.#h - 74);
      closeBorder.position.copyFrom(close.position);
    };
    this.#panelLayouts.set('shop', layout);
    layout();
    markPlayerModal(layer, { close: () => this.#closeShop(), scroll: (delta) => this.#scrollShop(delta) });
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

  #closeShop(): void {
    const callback = this.#shopHandlers?.onClose;
    this.hideShop();
    callback?.();
  }

  showBaseCommands(view: BasePanelView, onExec: (cmdId: string) => void, onClose: () => void): void {
    if (!this.#ensureActive()) return;
    this.#requestFrame();
    this.#clearPanel('base', this.#baseLayer);
    this.#baseHandlers = { onExec, onClose };
    this.#baseCommandCount = view.commands.length;
    const layer = this.#baseLayer;
    this.#addPanelBackground(layer);
    layer.addChild(this.#text('据 点 指 令', this.#w - 120, 'text', 'headingSize', 'bold')).position.set(60, 36);
    // AP is a gameplay resource indicator; its gold-colored label is intentionally not a theme token.
    layer.addChild(bindThemeTextProjection(new PText({
      text: `${view.date}　行动力：${view.ap}/${view.maxAp}`,
      style: { fontFamily: this.#assets.fontFamily('ui'), fontSize: this.#theme.typography.uiSize, fill: 0xffd77a } satisfies TextStyleOptions,
    }), { fill: null })).position.set(this.#w - 340, 44);
    const width = Math.min(1060, this.#w - 120);
    const rows = view.commands.map((cmd) => {
      const row = new Container();
      const background = bindThemeGraphicsProjection(new Graphics(), [cmd.enabled ? 'surfaceStrong' : 'panel']);
      row.addChild(background);
      const nameWidth = Math.max(220, width - 420);
      const name = this.#text(cmd.name, nameWidth, cmd.enabled ? 'text' : 'textDisabled');
      row.addChild(name);
      const reason = this.#baseCommandReason(view, cmd);
      const reasonText = !cmd.enabled ? this.#text(reason, nameWidth, 'textDisabled', 'captionSize') : null;
      if (reasonText) row.addChild(reasonText);
      const info = bindThemeTextProjection(new PText({
        text: `AP ${cmd.apCost}${cmd.remaining !== undefined && cmd.remaining !== null ? `（剩 ${cmd.remaining} 次）` : ''}`,
        style: { fontFamily: this.#assets.fontFamily('ui'), fontSize: this.#theme.typography.captionSize, fill: cmd.enabled ? 0xffd77a : this.#theme.colors.textDisabled } satisfies TextStyleOptions,
      }), { fill: cmd.enabled ? null : 'textDisabled' });
      row.addChild(info);
      const btn = this.#text(cmd.enabled ? '执行' : '不可执行', 140, cmd.enabled ? 'accent' : 'textDisabled');
      row.addChild(btn);
      bindPlayerControl(btn, {
        label: cmd.enabled ? `执行 ${cmd.name}` : `${cmd.name}：${reason}`,
        width: 140,
        height: 44,
        x: -10,
        y: -8,
        enabled: cmd.enabled,
      });
      const buttonBorder = this.#controlBorder(btn, 140, 44, -10, -8);
      if (cmd.enabled) {
        btn.cursor = 'pointer';
        this.#listen('base', btn, 'pointerdown', () => this.#baseHandlers?.onExec(cmd.id));
      }
      layer.addChild(row);
      return { row, background, name, reasonText, info, btn, buttonBorder, enabled: cmd.enabled };
    });
    const message = view.message && view.message.length > 0
      ? this.#text(view.message, width, 'text')
      : null;
    if (message) layer.addChild(message);
    const close = this.#text('◀ 返回地图', 180, 'textMuted');
    layer.addChild(close);
    bindPlayerControl(close, { label: '返回地图', width: 180, height: 44, x: -12, y: -10 });
    const closeBorder = this.#controlBorder(close, 180, 44, -12, -10);
    close.cursor = 'pointer';
    this.#listen('base', close, 'pointerdown', () => this.#closeBaseCommands());

    const layout = (): void => {
      let y = 120;
      for (const { row, background, name, reasonText, info, btn, buttonBorder, enabled } of rows) {
        const nameHeight = this.#textHeight(name);
        const reasonHeight = reasonText ? this.#textHeight(reasonText) : 0;
        const rowHeight = Math.max(58, nameHeight + reasonHeight + (reasonText ? 34 : 28));
        row.position.set(60, y);
        background.clear().roundRect(0, 0, width, rowHeight, this.#theme.radius.md)
          .fill({ color: enabled ? this.#theme.colors.surfaceStrong : this.#theme.colors.panel, alpha: this.#theme.opacity.surface });
        name.position.set(20, reasonText ? 10 : (rowHeight - nameHeight) / 2);
        if (reasonText) reasonText.position.set(20, nameHeight + 14);
        info.position.set(width - 330, (rowHeight - this.#textHeight(info)) / 2);
        btn.position.set(width - 150, (rowHeight - this.#textHeight(btn)) / 2);
        buttonBorder.position.copyFrom(btn.position);
        y += rowHeight + this.#theme.spacing.sm;
      }
      if (message) message.position.set(60, Math.max(y + 8, this.#h - 132 - this.#textHeight(message)));
      close.position.set(this.#w - 220, this.#h - 74);
      closeBorder.position.copyFrom(close.position);
    };
    this.#panelLayouts.set('base', layout);
    layout();
    markPlayerModal(layer, { close: () => this.#closeBaseCommands() });
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

  #closeBaseCommands(): void {
    const callback = this.#baseHandlers?.onClose;
    this.hideBaseCommands();
    callback?.();
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
    this.#battleSelectedSkill = null;
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

  #addPanelBackground(layer: Container): Graphics {
    const background = bindThemeGraphicsProjection(
      new Graphics().rect(0, 0, this.#w, this.#h).fill({
        color: this.#theme.colors.panel,
        alpha: this.#theme.opacity.panel,
      }),
      ['panel'],
    );
    // A modal's scrim must also be an input barrier; otherwise a click in a
    // gap between controls can reach the dialogue canvas underneath.
    background.eventMode = 'static';
    layer.addChild(background);
    return background;
  }

  #text(
    value: string,
    width: number,
    role: TextRole,
    typography: TypographyRole = 'uiSize',
    fontWeight: 'normal' | 'bold' = 'normal',
  ): PText {
    return bindThemeTextProjection(new PText({
      text: value,
      style: {
        fontFamily: this.#assets.fontFamily('ui'),
        fontSize: this.#theme.typography[typography],
        fill: this.#theme.colors[role],
        fontWeight,
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: Math.max(1, width),
      } satisfies TextStyleOptions,
    }), { fill: role, fontSize: typography });
  }

  #textHeight(text: PText): number {
    const measured = typeof document === 'undefined' ? 0 : text.height;
    if (Number.isFinite(measured) && measured > 0) return measured;
    const size = Number(text.style.fontSize) || this.#theme.typography.uiSize;
    const wrapWidth = Number(text.style.wordWrapWidth) || Math.max(1, this.#w - 120);
    return text.text.split(/\r?\n/).reduce(
      (lines, line) => lines + Math.max(1, Math.ceil(line.length * size / wrapWidth)),
      0,
    ) * size * 1.35;
  }

  #textWidth(text: PText): number {
    if (typeof document !== 'undefined') return text.width;
    return Math.min(Number(text.style.wordWrapWidth) || this.#w,
      Math.max(0, ...text.text.split('\n').map((line) => line.length)) * Number(text.style.fontSize));
  }

  #controlBorder(target: Container, width: number, height: number, x = 0, y = 0): Graphics {
    const border = bindThemeGraphicsProjection(
      new Graphics().rect(x, y, width, height).stroke({ color: this.#theme.colors.line, width: 2 }),
      ['line'],
    );
    border.visible = false;
    border.eventMode = 'none';
    const parent = target.parent;
    if (target instanceof PText || target instanceof Graphics) {
      // Pixi v8 Graphics is a ViewContainer implementation but warns when
      // used as a parent. Keep focus decoration beside it in the same layer.
      if (parent) {
        parent.addChild(border);
        border.position.copyFrom(target.position);
      }
    } else {
      target.addChild(border);
    }
    target.on('pointerover', () => {
      border.visible = true;
      this.#requestFrame();
    });
    target.on('pointerout', () => {
      border.visible = false;
      this.#requestFrame();
    });
    return border;
  }

  #mapNodeReason(view: MapView, node: MapView['nodes'][number]): string {
    if (node.enterable) return '';
    if (node.apCost > view.ap) return '行动力不足';
    if (node.visited) return '已访问';
    return '暂不可进入';
  }

  #baseCommandReason(view: BasePanelView, command: BasePanelView['commands'][number]): string {
    if (command.enabled) return '';
    if (command.apCost > view.ap) return '行动力不足';
    if (command.remaining === 0) return '本回合次数已用尽';
    return '当前不可执行';
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
    this.#panelLayouts.delete(panel);
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (panel === 'shop') {
      this.#shopScrollContent = null;
      this.#shopScrollOffset = 0;
      this.#shopScrollHeight = 0;
      this.#shopViewportTop = 0;
      this.#shopViewportHeight = 0;
    }
  }

  #scrollShop(delta: number): void {
    if (!this.#shopScrollContent) return;
    const maxOffset = Math.max(0, this.#shopScrollHeight - this.#shopViewportHeight);
    this.#shopScrollOffset = Math.max(0, Math.min(maxOffset, this.#shopScrollOffset + delta));
    this.#shopScrollContent.y = this.#shopViewportTop - this.#shopScrollOffset;
    this.#requestFrame();
  }

  #revealShop(target: Container, height: number): void {
    const bottom = target.y + height;
    if (target.y < this.#shopScrollOffset) this.#scrollShop(target.y - this.#shopScrollOffset);
    else if (bottom > this.#shopScrollOffset + this.#shopViewportHeight) {
      this.#scrollShop(Math.min(target.y, bottom - this.#shopViewportHeight) - this.#shopScrollOffset);
    }
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
