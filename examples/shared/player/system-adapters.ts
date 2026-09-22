import type {
  AffectionSystem,
  CalendarRunner,
  CombatConfig,
  CombatSolver,
  CombatStartSetup,
  EventScheduler,
  Interpreter,
  SceneRegistry,
  ShopSystem,
  ShopItemDef,
  VariableStore,
  SaveSnapshot,
} from '@surdet/core';
import type { SystemEventPayload } from '@surdet/core';
import type {
  BattleHandlers,
  BattleView,
  BasePanelView,
  MapView,
} from '@surdet/renderer';
import { buildBattleView, buildMapView } from '@surdet/renderer';
import type { HostSystemAdapter, HostSystemContext } from '@surdet/host';

export interface ProjectSystemRenderer {
  showMap(view: MapView, onEnter: (nodeId: string) => void, onEndTurn: () => void): void;
  hideMap(): void;
  showBaseCommands(view: BasePanelView, onExec: (commandId: string) => void, onClose: () => void): void;
  hideBaseCommands(): void;
  showBattle(view: BattleView, handlers: BattleHandlers, message?: string): void;
  hideBattle(): void;
  showShop(view: { gold: number; items: ShopItemDef[]; message?: string }, onBuy: (itemId: string) => void, onClose: () => void): void;
  hideShop(): void;
}

export interface ProjectSystemAdapterOptions {
  interpreter: Interpreter;
  renderer: ProjectSystemRenderer;
  store: VariableStore;
  registry: SceneRegistry;
  calendar?: CalendarRunner;
  scheduler?: EventScheduler;
  combat?: CombatSolver;
  combatConfig?: CombatConfig;
  combatSetup?: CombatStartSetup;
  affection?: AffectionSystem;
  shop?: ShopSystem;
  achievements?: {
    unlock(id: string): { fresh: boolean; def: { hidden?: boolean; name: string } };
  };
  onAchievementsChanged?: () => void;
  onBattleResult?: (winner: string | null) => void;
  onTurnResumeSnapshot?: (snapshot: SaveSnapshot) => void;
  onLog?: (message: string) => void;
  timer?: (callback: () => void, delayMs: number) => void;
}

function log(options: ProjectSystemAdapterOptions, message: string): void {
  options.onLog?.(message);
}

function safeJump(options: ProjectSystemAdapterOptions, context: HostSystemContext, sceneId: string): void {
  try {
    options.interpreter.hostJump(sceneId);
    context.resume();
  } catch (error) {
    context.fail(error);
  }
}

function resumeScheduledScene(options: ProjectSystemAdapterOptions, context: HostSystemContext, sceneId: string): boolean {
  const snapshot = options.interpreter.saveSnapshot();
  if (!snapshot) return false;
  options.onTurnResumeSnapshot?.(snapshot);
  options.interpreter.hostJump(sceneId);
  context.resume();
  return true;
}

function createCalendarAdapter(options: ProjectSystemAdapterOptions): HostSystemAdapter | null {
  if (!options.calendar) return null;
  const calendar = options.calendar;
  const scheduler = options.scheduler;
  return {
    id: 'calendar',
    open: (_payload, context) => {
      function openBasePanel(): void {
        let baseMsg = '选择要执行的指令。';
        const view = (): void => {
          options.renderer.showBaseCommands(
            {
              ap: calendar.ap,
              maxAp: calendar.maxAp,
              date: calendar.date,
              message: baseMsg,
              commands: calendar.baseCommands().map((command) => ({
                id: command.id,
                name: command.name,
                apCost: command.apCost,
                enabled: calendar.canExecBaseCommand(command.id),
                remaining: calendar.baseCommandRemaining(command.id),
              })),
            },
            (commandId) => {
              try {
                const result = calendar.execBaseCommand(commandId);
                const name = calendar.baseCommands().find((command) => command.id === commandId)?.name ?? commandId;
                if (!result.ok) {
                  baseMsg = result.reason ?? '无法执行';
                  view();
                  return;
                }
                for (const [variable, delta] of Object.entries(result.effects ?? {})) {
                  try {
                    options.store.modify(variable, delta);
                  } catch (error) {
                    log(options, `据点指令变量写回失败：${variable}（${String(error)}）`);
                  }
                }
                baseMsg = `执行了「${name}」。`;
                if (result.eventId && options.registry.has(result.eventId)) {
                  options.renderer.hideBaseCommands();
                  safeJump(options, context, result.eventId);
                  return;
                }
                options.onAchievementsChanged?.();
                view();
              } catch (error) {
                context.fail(error);
              }
            },
            () => {
              options.renderer.hideBaseCommands();
              renderMap();
            },
          );
        };
        view();
      }

      function renderMap(): void {
        try {
          const nodes = calendar.visibleNodes().map((node) => ({
            id: node.id,
            name: node.name,
            x: node.x,
            y: node.y,
            apCost: node.apCost,
            isBase: node.isBase,
            visited: calendar.hasVisited(node.id),
            enterable: calendar.canEnter(node.id),
          }));
          options.renderer.showMap(
            buildMapView({ turn: calendar.turn, ap: calendar.ap, maxAp: calendar.maxAp, date: calendar.date, nodes }),
            (nodeId) => {
              try {
                const nodeDef = calendar.nodes().find((node) => node.id === nodeId);
                const result = calendar.enter(nodeId);
                if (!result.ok) {
                  log(options, `calendar enter failed: ${nodeId} ${result.reason ?? ''}`);
                  renderMap();
                  return;
                }
                log(options, `calendar enter: ${nodeId}`);
                if (nodeDef?.isBase && calendar.baseCommands().length > 0) {
                  openBasePanel();
                  return;
                }
                if (result.eventId && options.registry.has(result.eventId)) {
                  safeJump(options, context, result.eventId);
                } else {
                  renderMap();
                }
              } catch (error) {
                context.fail(error);
              }
            },
            () => {
              try {
                calendar.advanceTurn();
                const event = scheduler?.dispatch(options.store) ?? null;
                if (event) {
                  log(options, `回合尾事件触发：${event.id}${event.scene ? `（演出 → ${event.scene}）` : ''}`);
                  options.onAchievementsChanged?.();
                }
                if (event?.scene && options.registry.has(event.scene)) {
                  options.renderer.hideMap();
                  if (resumeScheduledScene(options, context, event.scene)) return;
                }
                context.resume();
              } catch (error) {
                context.fail(error);
              }
            },
          );
        } catch (error) {
          context.fail(error);
        }
      }

      const event = scheduler?.dispatch(options.store) ?? null;
      if (event) {
        log(options, `回合头事件触发：${event.id}${event.scene ? `（演出 → ${event.scene}）` : ''}`);
        options.onAchievementsChanged?.();
      }
      if (event?.scene && options.registry.has(event.scene) && resumeScheduledScene(options, context, event.scene)) return;
      renderMap();
    },
    reset: () => {
      options.renderer.hideMap();
      options.renderer.hideBaseCommands();
    },
  };
}

function createBattleAdapter(options: ProjectSystemAdapterOptions): HostSystemAdapter | null {
  const { combat, combatConfig } = options;
  if (!combat || !combatConfig) return null;
  let generation = 0;
  const schedule = options.timer ?? ((callback: () => void, delayMs: number): void => {
    const timer = (globalThis as unknown as { setTimeout?: (fn: () => void, ms: number) => void }).setTimeout;
    if (timer) timer(callback, delayMs);
    else Promise.resolve().then(callback);
  });
  return {
    id: 'battle',
    open: (_payload, context) => {
      const activeGeneration = ++generation;
      combat.start(options.combatSetup ?? { allies: ['sword'], enemies: ['goblin'] });
      const canPlayerAct = (): boolean => activeGeneration === generation && !combat.finished && combat.actingTeam === combatConfig.teams[0];
      let battleMessage = '战斗开始！点击敌方单位发起攻击。';
      const settle = (): void => {
        if (combat.finished) {
          options.renderer.hideBattle();
          options.onBattleResult?.(combat.winner);
          log(options, `battle finished: ${combat.winner ?? 'draw'}`);
          context.resume();
        } else {
          renderBattle();
        }
      };
      const renderBattle = (): void => {
        try {
          options.renderer.showBattle(
            { ...buildBattleView(combat.snapshot(), combatConfig.skills), inputEnabled: canPlayerAct() },
            {
              onAttack: (targetUid, skillId) => {
                if (!canPlayerAct()) return;
                const acting = combat.units.find((unit) => unit.alive && unit.team === combat.actingTeam);
                if (!acting) return;
                try {
                  const action = combat.act(acting.uid, targetUid, skillId ?? undefined);
                  battleMessage = action.hit
                    ? `${acting.name} 造成 ${action.finalDamage} 点伤害${action.crit ? '（暴击）' : ''}${action.killed ? '，击倒了目标！' : ''}`
                    : `${acting.name} 的攻击落空了`;
                } catch (error) {
                  battleMessage = error instanceof Error ? error.message : String(error);
                }
                settle();
              },
              onMove: (direction) => {
                if (!canPlayerAct()) return;
                const moving = combat.units.find((unit) => unit.alive && unit.team === combat.actingTeam);
                if (!moving) return;
                try {
                  combat.moveUnit(moving.uid, direction);
                  battleMessage = `${moving.name} 调整了阵型（消耗本次行动）。`;
                } catch (error) {
                  battleMessage = error instanceof Error ? error.message : String(error);
                }
                settle();
              },
              onPass: () => {
                if (!canPlayerAct()) return;
                combat.pass();
                battleMessage = '无可攻击目标，跳过本次行动。';
                settle();
              },
            },
            battleMessage,
          );
          const enemyTeam = combatConfig.teams[1] ?? 'enemies';
          if (!combat.finished && combat.actingTeam === enemyTeam) {
            schedule(() => {
              if (activeGeneration !== generation || combat.finished || combat.actingTeam !== enemyTeam) return;
              try {
                const suggestion = combat.suggestAction(enemyTeam);
                if (suggestion.kind === 'attack') {
                  const action = combat.act(suggestion.attackerUid, suggestion.targetUid, suggestion.skillId ?? undefined);
                  battleMessage = action.hit ? `敌方攻击造成 ${action.finalDamage} 点伤害${action.killed ? '，我方单位倒下！' : ''}` : '敌方攻击落空了。';
                } else if (suggestion.kind === 'move') {
                  combat.moveUnit(suggestion.uid, suggestion.dir);
                  battleMessage = '敌方正在接近……';
                } else {
                  combat.pass();
                  battleMessage = '敌方在观望局势。';
                }
              } catch (error) {
                battleMessage = error instanceof Error ? error.message : String(error);
                if (!combat.finished) combat.pass();
              }
              settle();
            }, 650);
          }
        } catch (error) {
          context.fail(error);
        }
      };
      renderBattle();
    },
    reset: () => { generation++; options.renderer.hideBattle(); },
    dispose: () => { generation++; },
  };
}

function createShopAdapter(options: ProjectSystemAdapterOptions): HostSystemAdapter | null {
  const { shop } = options;
  if (!shop) return null;
  return {
    id: 'shop',
    open: (payload, context) => {
      const args = (payload as SystemEventPayload | undefined)?.args ?? [];
      const goldVariable = args[0] ?? 'gold';
      const itemsVariable = args[1] ?? 'bag';
      let message = '欢迎光临！';
      const renderShop = (): void => {
        try {
          options.renderer.showShop(
            { gold: options.store.getNumber(goldVariable), items: shop.items, message },
            (itemId) => {
              try {
                const result = shop.buy(goldVariable, itemsVariable, itemId);
                const name = shop.items.find((item) => item.id === itemId)?.name ?? itemId;
                message = result.ok ? `购买了「${name}」。` : (result.reason ?? '无法购买');
                renderShop();
              } catch (error) {
                context.fail(error);
              }
            },
            () => { context.resume(); },
          );
        } catch (error) {
          context.fail(error);
        }
      };
      renderShop();
    },
    reset: () => { options.renderer.hideShop(); },
  };
}

function createImmediateAdapter(id: string, open: (payload: unknown) => void): HostSystemAdapter {
  return {
    id,
    open: (payload, context) => {
      try {
        open(payload);
        context.resume();
      } catch (error) {
        context.fail(error);
      }
    },
  };
}

export function createSystemAdapters(options: ProjectSystemAdapterOptions): HostSystemAdapter[] {
  const adapters: HostSystemAdapter[] = [];
  const calendar = createCalendarAdapter(options);
  const battle = createBattleAdapter(options);
  const shop = createShopAdapter(options);
  if (calendar) adapters.push(calendar);
  if (battle) adapters.push(battle);
  if (options.affection) {
    adapters.push(createImmediateAdapter('affection', (payload) => {
      const id = (payload as SystemEventPayload).args[0];
      const tier = id ? options.affection!.stageOf(id)?.stage ?? null : null;
      log(options, `affection stage: ${String(tier)}`);
    }));
    adapters.push(createImmediateAdapter('event', (payload) => {
      const id = (payload as SystemEventPayload).args[0];
      if (id && options.affection!.consumeEvent(id)) log(options, `event consumed: ${id}`);
    }));
  }
  if (options.achievements) {
    adapters.push(createImmediateAdapter('achievement', (payload) => {
      const event = payload as SystemEventPayload;
      const mode = event.args[0];
      const id = event.args[1];
      if (mode === 'unlock' && id) {
        const result = options.achievements!.unlock(id);
        if (result.fresh) log(options, `achievement unlocked: ${result.def.hidden ? '???' : result.def.name}`);
      }
    }));
  }
  if (shop) adapters.push(shop);
  return adapters;
}
