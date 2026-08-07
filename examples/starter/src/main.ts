/**
 * Starter 入口：解释器 + 渲染层 + 程序化占位素材。
 * 真实项目在此替换占位素材为实际图片/音频，并把 onAdvance/onSelect 接到 UI 输入。
 */
import {
  compileScene,
  Interpreter,
  SceneRegistry,
  EventBus,
  VariableStore,
  SaveManager,
  QUICK_SLOT,
  AUTO_SLOT,
  CalendarRunner,
  CombatSolver,
  AffectionSystem,
  NewGamePlus,
  ShopSystem,
  GrowthSystem,
  AchievementSystem,
  EventScheduler,
} from '@surdet/core';
import type {
  VarDeclaration,
  VarValue,
  SaveStorage,
  SaveSnapshot,
  SaveSlotMeta,
  SystemSnapshots,
  CombatConfig,
  CalendarConfig,
  NewGamePlusConfig,
  AffectionProfile,
  RelationshipEvent,
  CoreEventMap,
  ShopConfig,
  GrowthConfig,
  AchievementDef,
  ScheduledEventDef,
} from '@surdet/core';
import {
  PixiStage,
  AdvRenderer,
  AudioManager,
  Backlog,
  Typewriter,
  SettingsStore,
  SETTING_STEPS,
  stepSetting,
  SKIP_STRATEGY_ALL,
  buildGalleryViews,
  buildBattleView,
  buildMapView,
  GamepadPoller,
} from '@surdet/renderer';
import type { SettingsStorage, GameSettings, GalleryConfig, SaveSlotView, AudioHandle } from '@surdet/renderer';
import gameConfig from '../game.config.json';
import calendarConfig from '../content/config/calendar.json';
import combatConfig from '../content/config/combat.json';
import eventsConfig from '../content/config/events.json';
import ngpConfig from '../content/config/ngp.json';
import galleryConfig from '../content/config/gallery.json';
import shopConfig from '../content/config/shop.json';
import growthConfig from '../content/config/growth.json';
import achievementsConfig from '../content/config/achievements.json';

// vite glob：递归收录全部 .gal 剧本（子目录场景 ID 仍为文件名去扩展名，须全局唯一）
const sceneFiles = import.meta.glob('../content/scenario/**/*.gal', {
  query: '?raw',
  import: 'default',
});

/** 音频键 → 真实素材地址解析：注册过用映射 URL，否则原样透传（占位/缺失静默策略不变） */
class ResolvedAudio implements AudioHandle {
  #inner: AudioManager;
  #urls: Map<string, string>;
  constructor(inner: AudioManager, urls: Map<string, string>) {
    this.#inner = inner;
    this.#urls = urls;
  }
  #r(src: string): string { return this.#urls.get(src) ?? src; }
  playBgm(src: string | null): void { this.#inner.playBgm(src === null ? null : this.#r(src)); }
  playSe(src: string): void { this.#inner.playSe(this.#r(src)); }
  playVoice(src: string): void { this.#inner.playVoice(this.#r(src)); }
  stopAll(): void { this.#inner.stopAll(); }
  setMasterVolume(v: number): void { this.#inner.setMasterVolume(v); }
  getMasterVolume(): number { return this.#inner.getMasterVolume(); }
  setBgmVolume(v: number): void { this.#inner.setBgmVolume(v); }
  getBgmVolume(): number { return this.#inner.getBgmVolume(); }
  setSeVolume(v: number): void { this.#inner.setSeVolume(v); }
  getSeVolume(): number { return this.#inner.getSeVolume(); }
  setVoiceVolume(v: number): void { this.#inner.setVoiceVolume(v); }
  getVoiceVolume(): number { return this.#inner.getVoiceVolume(); }
  isVoicePlaying(): boolean { return this.#inner.isVoicePlaying(); }
}

declare global {
  interface Window {
    /** Electron shell 经 preload 暴露的文件存档桥（异步 invoke IPC；浏览器环境不存在，回退 localStorage） */
    surdetSave?: {
      list(): Promise<string[]>;
      read(slot: string): Promise<SaveSnapshot | null>;
      write(slot: string, data: SaveSnapshot): Promise<void>;
      delete(slot: string): Promise<void>;
      listMeta(): Promise<SaveSlotMeta[]>;
    };
    /** 设置持久化桥（userData/settings.json；浏览器环境不存在，回退 localStorage） */
    surdetSettings?: {
      read(): Promise<unknown>;
      write(data: unknown): Promise<void>;
    };
    /** 应用控制桥：退出/全屏/日志（Electron preload 暴露） */
    surdetApp?: {
      quit(): Promise<void>;
      toggleFullscreen(): Promise<void>;
      log(level: string, msg: string): Promise<void>;
    };
    /** 素材桥：打包 exe 内素材经主进程解密读取（浏览器环境不存在，回退直接 URL） */
    surdetAsset?: {
      list(): Promise<string[]>;
      read(relPath: string): Promise<Uint8Array>;
    };
  }
}

async function main(): Promise<void> {
  const appEl = document.getElementById('app')!;

  // 舞台
  const stage = new PixiStage();
  await stage.init();

  // 自定义字体（可选，M5 支柱4 / 精致化批）：game.config.json 的 font 指向项目内嵌字体（woff2/woff/ttf/otf）；
  // await 加载完成后再进后续画面（标题首帧即用正确字体渲染，避免系统字闪变）；
  // 加载失败/超时/文件缺失自动回退系统字体（不白屏）。不配置则用系统默认字体。
  const fontPath = (gameConfig as { font?: string }).font;
  if (typeof fontPath === 'string' && fontPath.length > 0) {
    const fontUrl = await resolveFontUrl(fontPath);
    if (fontUrl) {
      const ok = await stage.registerFont(fontUrl);
      if (ok) console.info('[starter] 自定义字体已加载：', fontPath);
    } else {
      console.warn('[starter] 未找到字体文件，回退系统字体：', fontPath);
    }
  }
  appEl.appendChild(stage.app!.canvas);

  // 窗口自适应：等比缩放画布适配窗口尺寸（内部分辨率保持 1280×720 逻辑尺寸）
  stage.fitWindow();
  window.addEventListener('resize', () => stage.fitWindow());

  // 变量表（game.config.json）
  const decls: VarDeclaration[] = Object.entries(gameConfig.variables).map(([name, d]) => ({
    name,
    ...(d as Omit<VarDeclaration, 'name'>),
  }));
  const store = new VariableStore(decls);

  // 场景注册
  const registry = new SceneRegistry();
  for (const [path, load] of Object.entries(sceneFiles)) {
    const src = (await load()) as string;
    const id = path.split('/').pop()!.replace(/\.gal$/, '');
    registry.register(compileScene(src, path, id));
  }

  // ===== M5 全家桶系统实例（数据驱动，宿主持有并驱动） =====
  // JSON 配置经 resolveJsonModule 推断为宽 string 类型，这里显式断言到引擎类型。
  const calendar = new CalendarRunner(calendarConfig as CalendarConfig, store);
  const combat = new CombatSolver(combatConfig as CombatConfig);
  const affection = new AffectionSystem(
    eventsConfig.profiles as AffectionProfile[],
    eventsConfig.events as RelationshipEvent[],
    store,
  );
  const ngp = new NewGamePlus(ngpConfig as NewGamePlusConfig, store);
  const shop = new ShopSystem(shopConfig as ShopConfig, store);
  // 角色成长（经验/升级）：配置驱动曲线，升级属性增量写回变量仓库；状态随存档往返（引擎内聚）
  const growth = new GrowthSystem(growthConfig as GrowthConfig, store);
  // 成就系统：when 条件批量判定 + 事件触发解锁；状态经 SystemHooks 随存档往返
  const achievements = new AchievementSystem(achievementsConfig as AchievementDef[], store);
  // 事件调度器（兰斯式事件队列）：events.json scheduled[] 声明优先级事件，
  // 日历回合头/尾统一 dispatch；fired 状态经 SystemHooks 随存档往返
  const scheduler = new EventScheduler(eventsConfig.scheduled as ScheduledEventDef[], store);

  // 战斗采用交互式回合 UI：见下方 system 'battle' 事件处理（点击攻击 / 跳过行动）

  // 总线 + 解释器 + 渲染器（全家桶状态经 SystemHooks 随存档往返；成长系统引擎内聚，构造注入）
  const bus = new EventBus<CoreEventMap>();
  const interp = new Interpreter(store, bus, registry, undefined, undefined, {
    snapshot: (): SystemSnapshots => ({
      calendar: calendar.snapshot(),
      combat: combat.snapshot(),
      affection: affection.snapshot(),
      achievements: achievements.snapshot(),
      eventScheduler: scheduler.snapshot(),
    }),
    restore: (s: SystemSnapshots) => {
      if (s.calendar) calendar.restore(s.calendar);
      if (s.combat) combat.restore(s.combat);
      if (s.affection) affection.restore(s.affection);
      if (s.achievements) achievements.restore(s.achievements);
      if (s.eventScheduler) scheduler.restore(s.eventScheduler);
    },
  }, undefined, growth);
  const audioManager = new AudioManager();
  /** 音频素材地址映射（loadAssets 填充：素材键 → Blob/文件 URL） */
  const audioUrls = new Map<string, string>();
  const audio: AudioHandle = new ResolvedAudio(audioManager, audioUrls);

  // ===== 设置系统：文本速度/自动播放停留/音量（Electron 设置文件 / 浏览器 localStorage） =====
  const desktopSettings = window.surdetSettings;
  const settingsStorage: SettingsStorage = desktopSettings
    ? {
        load: async () => (await desktopSettings.read().catch(() => null)) as Partial<GameSettings> | null,
        save: (s) =>
          desktopSettings.write(s).catch((err) => {
            console.error('[starter] 设置写入失败：', err);
          }),
      }
    : {
        load: () => {
          try {
            const raw = localStorage.getItem('surdet:settings');
            return raw ? (JSON.parse(raw) as Partial<GameSettings>) : null;
          } catch {
            return null;
          }
        },
        save: (s) => {
          try {
            localStorage.setItem('surdet:settings', JSON.stringify(s));
          } catch (err) {
            console.error('[starter] 设置写入失败：', err);
          }
        },
      };
  const settings = new SettingsStore(settingsStorage);
  await settings.load();

  // Backlog（文字记录）+ 渲染器（设置投影：文本速度/自动停留/音量）
  const backlog = new Backlog();
  const typewriter = new Typewriter({ charsPerSecond: settings.settings.textSpeedCps });
  const renderer = new AdvRenderer(stage, audio, {
    typewriter,
    backlog,
    autoBaseDelayMs: settings.settings.autoBaseDelayMs,
    autoPerCharMs: settings.settings.autoPerCharMs,
    onAdvance: () => interp.advance(),
    onSelect: (i) => interp.choose(i),
    // @wait 计时结束 → 恢复解释器（玩家点击跳过由 renderer.advance 直达 finishWait）
    onWaitEnd: () => interp.finishWait(),
  });
  settings.apply(typewriter, audio);
  renderer.subscribe(bus);

  // E2E/调试探针：只读暴露最小运行状态（不参与任何生产逻辑；自我迭代②，Playwright 自动通关用）
  (window as unknown as Record<string, unknown>).__surdetDebug = {
    get status(): string { return interp.status; },
    get rendererStatus(): string { return renderer.status; },
    get position(): { sceneId: string; pc: number } | null { return interp.saveSnapshot()?.position ?? null; },
    titleSelect: (id: string) => titleSelect(id),
  };

  // ===== 存档富化：缩略图（舞台截图）+ 本次会话游戏时长 =====
  let sessionStart = Date.now();
  function enrichSnapshot(snap: SaveSnapshot): SaveSnapshot {
    const thumb = stage.captureThumbnail();
    if (thumb) snap.meta.thumbnail = thumb;
    snap.meta.playTimeSec = Math.max(0, Math.round((Date.now() - sessionStart) / 1000));
    return snap;
  }

  /** 回合尾事件演出前的挂起点快照：事件场景播完后经 sceneEnd 恢复，剧情续跑（回合头尾闭环） */
  let turnResumeSnap: SaveSnapshot | null = null;

  // M5 system 事件 → 宿主驱动对应系统（@battle/@calendar/@affection/@event/@shop/@item）
  bus.on('system', (p) => {
    switch (p.type) {
      case 'calendar': {
        // 大地图交互：暂停剧情，玩家点选节点/结束回合；节点事件场景（场景 ID = eventId）经 hostJump 跳入
        interp.pauseHost();
        const renderMap = (): void => {
          const nodes = calendar.visibleNodes().map((n) => ({
            id: n.id,
            name: n.name,
            x: n.x,
            y: n.y,
            apCost: n.apCost,
            isBase: n.isBase,
            visited: calendar.hasVisited(n.id),
            enterable: calendar.canEnter(n.id),
          }));
          stage.showMap(
            buildMapView({ turn: calendar.turn, ap: calendar.ap, maxAp: calendar.maxAp, date: calendar.date, nodes }),
            (nodeId) => {
              const nodeDef = calendar.nodes().find((n) => n.id === nodeId);
              const res = calendar.enter(nodeId);
              if (!res.ok) {
                console.info('[starter] calendar enter failed:', nodeId, res.reason);
                renderMap();
                return;
              }
              console.info('[starter] calendar enter:', nodeId);
              // 据点节点 → 打开据点指令面板（兰斯式 base commands；无指令配置时按普通节点处理）
              if (nodeDef?.isBase && calendar.baseCommands().length > 0) {
                openBasePanel();
                return;
              }
              if (res.eventId && registry.has(res.eventId)) {
                interp.hostJump(res.eventId); // 节点事件场景（约定：场景 ID = eventId）
              } else {
                renderMap();
              }
            },
            () => {
              // 回合尾：先结算回合（advanceTurn 重置 AP/限次），再统一调度优先级事件；
              // 事件带演出场景 → hostJump 进演出，场景结束经 sceneEnd 恢复挂起点续跑剧情
              calendar.advanceTurn();
              const endEv = scheduler.dispatch(store);
              if (endEv) {
                console.info(`[starter] 回合尾事件触发: ${endEv.id}${endEv.scene ? `（演出 → ${endEv.scene}）` : ''}`);
                checkAchievements(); // effects 改变量后补查成就
              }
              if (endEv?.scene && registry.has(endEv.scene)) {
                stage.hideMap(); // 演出场景覆盖地图（sceneEnd 恢复剧情后地图不再需要）
                const snap = interp.saveSnapshot(); // 挂起点已越过 @calendar，恢复即续跑
                if (snap) {
                  turnResumeSnap = snap;
                  interp.hostJump(endEv.scene);
                  return;
                }
              }
              interp.resumeHost(); // 无演出（或快照不可用）→ 直接恢复剧情
            },
          );
        };
        // 据点指令面板：执行指令 → 扣 AP/记次（引擎）+ 写回 effects（宿主变量）→ 刷新面板
        let baseMsg = '选择要执行的指令。';
        const openBasePanel = (): void => {
          stage.showBaseCommands(
            {
              ap: calendar.ap,
              maxAp: calendar.maxAp,
              date: calendar.date,
              message: baseMsg,
              commands: calendar.baseCommands().map((c) => ({
                id: c.id,
                name: c.name,
                apCost: c.apCost,
                enabled: calendar.canExecBaseCommand(c.id),
                remaining: calendar.baseCommandRemaining(c.id),
              })),
            },
            (cmdId) => {
              const res = calendar.execBaseCommand(cmdId);
              const name = calendar.baseCommands().find((c) => c.id === cmdId)?.name ?? cmdId;
              if (!res.ok) {
                baseMsg = res.reason ?? '无法执行';
                openBasePanel();
                return;
              }
              // effects 写回宿主变量仓库（引擎不直改业务变量，分工一致）
              for (const [varName, delta] of Object.entries(res.effects ?? {})) {
                try {
                  store.modify(varName, delta);
                } catch (err) {
                  console.warn('[starter] base command effect 写回失败:', varName, err);
                }
              }
              baseMsg = `执行了「${name}」。`;
              if (res.eventId && registry.has(res.eventId)) {
                stage.hideBase();
                interp.hostJump(res.eventId); // 指令演出事件
                return;
              }
              checkAchievements(); // 效果变更后补查成就
              openBasePanel();
            },
            () => {
              stage.hideBase();
              renderMap(); // 返回地图
            },
          );
        };
        // 回合头事件：打开地图前统一调度（优先级最高者触发；头事件只做 effects 结算——
        // 场景演出无法在播完后回到地图（解释器无地图恢复点），演出留给回合尾事件）
        const headEv = scheduler.dispatch(store);
        if (headEv) {
          console.info(`[starter] 回合头事件触发: ${headEv.id}（effects 已结算）`);
          checkAchievements(); // effects 改变量后补查成就
        }
        renderMap();
        break;
      }
      case 'battle': {
        // 每次 @battle 都是新战斗：布阵后进入交互式回合 UI（点击敌方攻击 / 跳过行动）。
        // pauseHost 冻结剧情：战斗结束 resumeHost 前，剧本不越过 @battle 推进
        combat.start({ allies: ['sword'], enemies: ['goblin'] });
        interp.pauseHost();
        let battleMsg = '战斗开始！点击敌方单位发起攻击。';
        const renderBattle = (): void => {
          stage.showBattle(
            buildBattleView(combat.snapshot(), (combatConfig as CombatConfig).skills),
            {
              onAttack: (targetUid, skillId) => {
                // 敌方回合（AI 自动行动）忽略玩家点击，防 AI 行动窗口内误触发（审计修复）
                if (combat.actingTeam !== (combatConfig as { teams?: string[] }).teams?.[0]) return;
                // skillId 来自战斗覆盖层的技能选择条（null = 普攻）
                const acting = combat.units.find((u) => u.alive && u.team === combat.actingTeam);
                if (!acting) return;
                try {
                  const a = combat.act(acting.uid, targetUid, skillId ?? undefined);
                  battleMsg = a.hit
                    ? `${acting.name} 造成 ${a.finalDamage} 点伤害${a.crit ? '（暴击）' : ''}${a.killed ? '，击倒了目标！' : ''}`
                    : `${acting.name} 的攻击落空了`;
                } catch (err) {
                  battleMsg = err instanceof Error ? err.message : String(err);
                }
                settleBattle();
              },
              onMove: (dir) => {
                // 移动行动方单位（1D 阵型；移动消耗本次行动）
                const moving = combat.units.find((u) => u.alive && u.team === combat.actingTeam);
                if (!moving) return;
                try {
                  combat.moveUnit(moving.uid, dir);
                  battleMsg = `${moving.name} 调整了阵型（消耗本次行动）。`;
                } catch (err) {
                  battleMsg = err instanceof Error ? err.message : String(err);
                }
                settleBattle();
              },
              onPass: () => {
                // 僵局出口（宿主契约，见 CombatSolver.pass）：保证 maxTurns 在互打不到时仍生效
                combat.pass();
                battleMsg = '无可攻击目标，跳过本次行动。';
                settleBattle();
              },
            },
            battleMsg,
          );
          // 敌方 AI：短暂延迟后自动执行建议（攻击 > 接近 > 跳过），玩家无需操作敌方
          const enemyTeam = (combatConfig as CombatConfig).teams[1] ?? 'enemies';
          if (!combat.finished && combat.actingTeam === enemyTeam) {
            setTimeout(() => {
              if (combat.finished || combat.actingTeam !== enemyTeam) return;
              const sug = combat.suggestAction(enemyTeam);
              try {
                if (sug.kind === 'attack') {
                  const a = combat.act(sug.attackerUid, sug.targetUid, sug.skillId ?? undefined);
                  battleMsg = a.hit
                    ? `敌方攻击造成 ${a.finalDamage} 点伤害${a.crit ? '（暴击）' : ''}${a.killed ? '，我方单位倒下！' : ''}`
                    : '敌方攻击落空了。';
                } else if (sug.kind === 'move') {
                  combat.moveUnit(sug.uid, sug.dir);
                  battleMsg = '敌方正在接近……';
                } else {
                  combat.pass();
                  battleMsg = '敌方在观望局势。';
                }
              } catch (err) {
                battleMsg = err instanceof Error ? err.message : String(err);
                if (!combat.finished) combat.pass(); // 异常兜底防卡死
              }
              settleBattle();
            }, 650);
          }
        };
        const settleBattle = (): void => {
          if (combat.finished) {
            stage.hideBattle();
            store.set('battleWon', combat.winner === 'allies');
            console.info('[starter] battle finished, winner:', combat.winner, 'ngp cleared:', ngp.isCleared());
            interp.resumeHost(); // 战斗结束 → 恢复剧情推进
          } else {
            renderBattle();
          }
        };
        renderBattle();
        break;
      }
      case 'affection': {
        const charId = p.args[0];
        const tier = charId ? affection.stageOf(charId)?.stage ?? null : null;
        console.info('[starter] affection stage:', tier);
        break;
      }
      case 'event': {
        const evId = p.args[0];
        if (evId && affection.consumeEvent(evId)) {
          console.info('[starter] event consumed:', evId);
        }
        break;
      }
      case 'achievement': {
        // @achievement unlock id：剧情节点显式解锁成就（when 之外的触发途径）
        const mode = p.args[0];
        const id = p.args[1];
        if (mode === 'unlock' && id) {
          try {
            const res = achievements.unlock(id);
            if (res.fresh) stage.showBanner(`成就解锁：${res.def.hidden ? '???' : res.def.name}`, 'tip');
          } catch (err) {
            console.warn('[starter] achievement unlock failed:', err instanceof Error ? err.message : err);
          }
        }
        break;
      }
      case 'shop': {
        // 商店：暂停剧情 → 打开商店覆盖层；@shop 参数 = 金币变量 道具变量（缺省 gold/bag）
        const goldVar = p.args[0] ?? 'gold';
        const itemsVar = p.args[1] ?? 'bag';
        interp.pauseHost();
        let shopMsg = '欢迎光临！';
        const renderShop = (): void => {
          stage.showShop(
            { gold: store.getNumber(goldVar), items: shop.items, message: shopMsg },
            (itemId) => {
              const res = shop.buy(goldVar, itemsVar, itemId);
              const name = shop.items.find((i) => i.id === itemId)?.name ?? itemId;
              shopMsg = res.ok ? `购买了「${name}」。` : (res.reason ?? '无法购买');
              renderShop(); // 结算后刷新金币/按钮状态
            },
            () => {
              interp.resumeHost(); // 离开商店 → 恢复剧情
            },
          );
        };
        renderShop();
        break;
      }
      default:
        console.info('[starter] system event:', p.type);
    }
  });

  // 点击画布推进文本（标题/覆盖层期间解释器不在等待态 → 静默忽略，不抛错）
  stage.app!.canvas.addEventListener('pointerdown', () => {
    const s = interp.status;
    if (s === 'awaiting-advance' || s === 'awaiting-timer') renderer.advance();
  });

  // 滚轮：Backlog 打开时滚动文字记录（galgame 惯例：鼠标滚轮回看历史）
  stage.app!.canvas.addEventListener('wheel', (e) => {
    if (renderer.backlogOpen) {
      e.preventDefault();
      stage.scrollBacklog(e.deltaY > 0 ? 120 : -120);
    }
  }, { passive: false });

  // 右键 → 系统菜单（GalGame 惯例）；标题画面不弹（标题自带菜单，空白处右键蹦设置框属误弹，用户反馈修复）
  stage.app!.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (onTitleScreen) return;
    openSystemMenu();
  });

  // Pixi ticker 驱动帧推进
  stage.app!.ticker.add((ticker) => renderer.update(ticker.deltaMS));

  // 存档存储：Electron 壳（打包 exe）落 userData/saves 文件系统（异步 invoke IPC）；浏览器回退 localStorage
  const desktopSave = window.surdetSave;
  const saveStorage: SaveStorage = desktopSave
    ? {
        read: (slot) => desktopSave.read(slot).catch(() => null),
        write: (slot, data) =>
          desktopSave.write(slot, data).catch((err) => {
            console.error('[starter] 存档写入失败：', err);
          }),
        delete: (slot) => desktopSave.delete(slot).catch(() => {}),
        list: () => desktopSave.list().catch(() => []),
        // 元信息索引：列表界面不读存档体（主进程读 index.json）
        listMeta: () => desktopSave.listMeta().catch(() => []),
      }
    : {
        read: (slot) => {
          try {
            const raw = localStorage.getItem(`surdet:save:${slot}`);
            return raw ? (JSON.parse(raw) as SaveSnapshot) : null;
          } catch {
            return null;
          }
        },
        write: (slot, data) => {
          try {
            localStorage.setItem(`surdet:save:${slot}`, JSON.stringify(data));
          } catch (err) {
            console.error('[starter] 存档写入失败：', err);
          }
        },
        delete: (slot) => localStorage.removeItem(`surdet:save:${slot}`),
        list: () =>
          Object.keys(localStorage)
            .filter((k) => k.startsWith('surdet:save:'))
            .map((k) => k.slice('surdet:save:'.length)),
      };
  const saves = new SaveManager(saveStorage);

  // 剧本 @autosave：写入自动存档槽位（读档用 F9 只覆盖快速档；自动档需另行提供读档入口）
  bus.on('autosave', (snap) => {
    void saves.save(AUTO_SLOT, enrichSnapshot(snap)).then(() => {
      console.info('[starter] 自动存档（ngp cleared:', ngp.isCleared(), '）');
    });
  });

  // 存档场景哈希不匹配：存档后剧本被编辑，pc 定位可能漂移（引擎仍照常加载，此处提醒玩家）
  bus.on('saveMismatch', (p) => {
    console.warn(`[starter] 存档与剧本版本不一致（场景 ${p.sceneId}）：定位可能漂移，建议重新开始该场景`);
  });

  // 读档/状态重置（审计修复 C1/M1）：关闭全部覆盖层，防止旧战斗/地图/商店 UI 残留在还原后的状态之上
  bus.on('stateReset', () => {
    stage.hideVideo(); // 停止残留 @video 播放（审计复核）
    stage.hideBattle();
    stage.hideMap();
    stage.hideShop();
    stage.hideGallery();
    stage.hideSaveLoad();
    stage.hideSettings();
    stage.hideSystemMenu();
    galleryOpen = false;
    settingsOpen = false;
  });

  // 回合尾事件场景播完 → 恢复跳转前快照，剧情从挂起点续跑（回合头尾闭环）。
  // loadSnapshot 不可在事件回调内调用（撞解释器 #stepping 重入守卫），延迟到 UI 线程执行。
  bus.on('sceneEnd', () => {
    if (!turnResumeSnap) return;
    const snap = turnResumeSnap;
    turnResumeSnap = null;
    setTimeout(() => {
      try {
        interp.loadSnapshot(snap);
      } catch (err) {
        console.error('[starter] 回合尾事件恢复失败:', err);
      }
    }, 0);
  });

  // ===== 字体资源解析（与 loadAssets 同口径双路）：打包环境经主进程读取 → Blob URL；dev 环境 vite glob URL =====
  async function resolveFontUrl(fontPath: string): Promise<string | null> {
    // fontPath 形如 content/assets/fonts/x.ttf → 素材根相对 fonts/x.ttf（与 loadAssets 的 rel 口径一致）
    const rel = fontPath.replace(/^content\/assets\//, '');
    const desktopAsset = window.surdetAsset;
    if (desktopAsset) {
      try {
        const files = await desktopAsset.list();
        if (!files.includes(rel)) return null;
        const bytes = await desktopAsset.read(rel);
        return URL.createObjectURL(new Blob([bytes as unknown as BlobPart]));
      } catch {
        return null;
      }
    }
    const fonts = import.meta.glob('../content/assets/fonts/*.{woff2,woff,ttf,otf}', { query: '?url', import: 'default', eager: true });
    const wanted = fontPath.split('/').pop() ?? '';
    for (const [p, url] of Object.entries(fonts)) {
      if (p.endsWith(`/${wanted}`)) return url as string;
    }
    return null;
  }

  // ===== 素材管线：content/assets 约定 bg/<key>.png | portrait/<角色>_<服装>_<表情>.png | bgm|se|voice/<key>.音频 =====
  async function loadAssets(): Promise<void> {
    const IMG = /\.(png|jpe?g|webp|gif|avif)$/i;
    const AUD = /\.(mp3|ogg|wav|m4a|flac)$/i;
    const register = (rel: string, url: string): void => {
      const parts = rel.split('/');
      const kind = parts[0] ?? '';
      const fname = parts[parts.length - 1] ?? '';
      if (kind === 'bg' && IMG.test(fname)) {
        void stage.registerBackground(fname.replace(IMG, ''), url);
      } else if (kind === 'portrait' && IMG.test(fname)) {
        const seg = fname.replace(IMG, '').split('_');
        if (seg[0]) void stage.registerPortrait(seg[0], seg[1] ?? 'normal', seg[2] ?? 'normal', url);
      } else if ((kind === 'bgm' || kind === 'se' || kind === 'voice') && AUD.test(fname)) {
        audioUrls.set(fname.replace(AUD, ''), url);
      }
    };
    const desktopAsset = window.surdetAsset;
    if (desktopAsset) {
      // 打包环境：素材经主进程读取（自动解密）→ Blob URL 注册
      const files = await desktopAsset.list();
      for (const rel of files) {
        try {
          const bytes = await desktopAsset.read(rel);
          register(rel, URL.createObjectURL(new Blob([bytes as unknown as BlobPart])));
        } catch (err) {
          console.warn('[starter] 素材加载失败:', rel, err);
        }
      }
    } else {
      // 浏览器开发环境：vite 直接提供素材 URL（无素材时 glob 为空，占位策略兜底）
      const imgs = import.meta.glob('../content/assets/**/*.{png,jpg,jpeg,webp,gif,avif}', { query: '?url', import: 'default', eager: true });
      for (const [p, url] of Object.entries(imgs)) register(p.replace('../content/assets/', ''), url as string);
      const auds = import.meta.glob('../content/assets/**/*.{mp3,ogg,wav,m4a,flac}', { query: '?url', import: 'default', eager: true });
      for (const [p, url] of Object.entries(auds)) register(p.replace('../content/assets/', ''), url as string);
    }
    console.info('[starter] 素材加载完成：音频条目', audioUrls.size);
  }

  // ===== 致命错误覆盖层（不白屏；桌面环境同时落日志） =====
  function showFatal(msg: string): void {
    if (document.getElementById('surdet-fatal')) return;
    const div = document.createElement('div');
    div.id = 'surdet-fatal';
    Object.assign(div.style, {
      position: 'fixed', inset: '0', zIndex: '2000', background: 'rgba(8,8,15,0.94)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'sans-serif', textAlign: 'center', padding: '40px',
    });
    const h = document.createElement('h2');
    h.textContent = '发生错误';
    h.style.color = '#ff9a9a';
    const p = document.createElement('p');
    p.textContent = msg;
    p.style.cssText = 'color:#ddd;max-width:680px;word-break:break-all;';
    const hint = document.createElement('p');
    hint.textContent = '点击本画面关闭并继续尝试；也可刷新页面（F5）。若持续出现请删除存档/设置后重试。';
    hint.style.color = '#8a8a96';
    div.style.cursor = 'pointer'; // 审计修复：非致命错误也可点掉覆盖层继续，不再永久锁屏
    div.addEventListener('click', () => div.remove());
    div.append(h, p, hint);
    document.body.appendChild(div);
  }

  // ===== 周目继承（兰斯式全局通关记录：@clear 事件 → 跨周目持久化；新周目开局应用继承） =====
  /** 全局通关记录（跨存档/跨周目；Electron 与浏览器的 localStorage 均持久化到各自 userData） */
  interface GlobalClearRecord {
    endings: string[];
    /** 累计通关周目数（每次游戏会话计 1；同周目多结局不重复计数） */
    playthroughs: number;
    /** 最近一次 @clear 时刻的变量全量快照（继承计算源） */
    variables: Record<string, unknown>;
    clearedAt: number;
  }
  const CLEAR_KEY = 'surdet:clearRecord';
  function loadClearRecord(): GlobalClearRecord | null {
    try {
      const raw = localStorage.getItem(CLEAR_KEY);
      return raw ? (JSON.parse(raw) as GlobalClearRecord) : null;
    } catch {
      return null;
    }
  }
  function saveClearRecord(rec: GlobalClearRecord): void {
    try {
      localStorage.setItem(CLEAR_KEY, JSON.stringify(rec));
    } catch (err) {
      console.error('[starter] 通关记录写入失败：', err);
    }
  }
  let clearRecord = loadClearRecord();

  // 周目计数会话标志：同一会话（新游戏/读档之间）多次 @clear 只计 1 个周目，
  // 避免同一周目达成多结局（ClearTracker 允许）时 playthroughs 虚增
  let clearCountedThisSession = false;

  // @clear：写入全局通关记录（结局收集 + 变量快照 + 周目计数）
  bus.on('clear', (p) => {
    const rec = clearRecord ?? { endings: [], playthroughs: 0, variables: {}, clearedAt: 0 };
    const freshEnding = !rec.endings.includes(p.ending);
    if (freshEnding) rec.endings.push(p.ending);
    if (!clearCountedThisSession) {
      clearCountedThisSession = true;
      rec.playthroughs += 1;
    }
    // 继承源始终取最近一次 @clear 的变量值（同周目后续结局覆盖前值，语义 = 最新通关状态）
    rec.variables = store.snapshot() as Record<string, unknown>;
    rec.clearedAt = Date.now();
    clearRecord = rec;
    saveClearRecord(rec);
    console.info(`[starter] 全局通关记录：结局 ${p.ending}（累计 ${rec.playthroughs} 周目 · 收集 ${rec.endings.length} 结局）`);
  });

  // @exp：角色成长结果 → 升级演出（横幅）+ levelEvents 场景跳转（配置驱动）
  bus.on('growth', (p) => {
    if (p.levelsGained > 0) {
      stage.showBanner(`${p.characterId} 升级！Lv.${p.levelBefore} → Lv.${p.levelAfter}`, 'chapter');
      console.info(`[starter] growth: ${p.characterId} Lv.${p.levelBefore} → Lv.${p.levelAfter}（+${p.gained} exp）`);
      // 途经等级触发 levelEvents（升多级时逐级检查；场景存在才跳转，避免配置缺场景卡死剧情）
      for (const lv of p.passedLevels) {
        const scene = growth.levelEventFor(p.characterId, lv);
        if (scene && registry.has(scene)) {
          interp.hostJump(scene);
          break;
        }
      }
      // 事件触发类成就：等级里程碑（level_5 无 when 条件，check() 不会命中，须显式 unlock）
      if (growth.levelOf(p.characterId) >= 5 && achievements.defOf('level_5')) {
        try {
          const res = achievements.unlock('level_5');
          if (res.fresh) stage.showBanner(`成就解锁：${res.def.name}`, 'tip');
        } catch (err) {
          console.warn('[starter] level_5 unlock failed:', err instanceof Error ? err.message : err);
        }
      }
      checkAchievements(); // 升级后补查 when 条件成就
    }
  });

  // ===== 成就批量判定：状态变更后（text 事件 / 读档）统一扫描 when 条件 =====
  /** 扫描全部 when 条件成就，新解锁播放横幅提示（求值异常不阻断剧情，仅告警） */
  function checkAchievements(): void {
    try {
      const fresh = achievements.check();
      for (const r of fresh) {
        stage.showBanner(`成就解锁：${r.def.name}`, 'tip');
        console.info(`[starter] achievement unlocked: ${r.id}（${r.def.name}）`);
      }
    } catch (err) {
      console.warn('[starter] achievement check failed:', err instanceof Error ? err.message : err);
    }
  }
  // 每条文本推进后判定：覆盖 @set/@mod 改变量后的剧情节奏（变量在文本行之间变化）
  bus.on('text', () => checkAchievements());

  // ===== 标题画面：开始/读档/鉴赏/设置/退出 =====
  /** 标题画面显示中（右键系统菜单守卫用；showTitleScreen 置真，开局/读档进入游戏置假） */
  let onTitleScreen = false;
  function showTitleScreen(): void {
    onTitleScreen = true;
    stage.showTitle(
      {
        title: (gameConfig as { title?: string }).title ?? 'Surdet Game',
        subtitle: 'Surdet 引擎 · 示例游戏',
        items: [
          { id: 'new', label: '开始游戏' },
          { id: 'load', label: '读取存档' },
          { id: 'gallery', label: '鉴赏' },
          { id: 'settings', label: '设置' },
          { id: 'quit', label: '退出游戏', enabled: typeof window.surdetApp !== 'undefined' },
        ],
      },
      titleSelect,
    );
  }

  /** 标题菜单选择（E2E 探针 titleSelect 与画面点击共用同一入口；自我迭代②） */
  function titleSelect(id: string): void {
    switch (id) {
      case 'new': {
        onTitleScreen = false;
        stage.hideTitle();
        store.reset();
        clearCountedThisSession = false; // 新周目会话开始，周目计数重新可用
        // 周目继承：存在全局通关记录时，按 ngp.json 继承项把通关值应用到新周目初始表
        const rec = loadClearRecord();
        if (rec) {
          const inherited = ngp.computeInheritFrom(
            store.snapshot(),
            rec.variables as Record<string, VarValue>,
          );
          for (const [name, value] of Object.entries(inherited)) {
            if (store.has(name) && store.get(name) !== value) store.set(name, value);
          }
          console.info(`[starter] 新周目开局（第 ${rec.playthroughs + 1} 周目，继承 ${ngp.inheritEntries().length} 项）`);
        }
        sessionStart = Date.now(); // 新周目重新计游戏时长
        interp.start((gameConfig as { entryScene?: string }).entryScene ?? 'ch01_01'); // 审计修复：入口场景取自配置，不再硬编码
        break;
      }
      case 'load':
        void openSaveLoad('load');
        break;
      case 'gallery':
        openGallery();
        break;
      case 'settings':
        settingsOpen = true;
        refreshSettingsPanel();
        break;
      case 'quit':
        void window.surdetApp?.quit();
        break;
    }
  }

  // ===== 存档/读档 UI：多槽位 + 快速/自动档 =====
  const SLOT_IDS = ['1', '2', '3', '4', '5', '6', QUICK_SLOT, AUTO_SLOT];
  async function openSaveLoad(mode: 'save' | 'load'): Promise<void> {
    const metas = await saves.list();
    const byId = new Map(metas.map((m) => [m.id, m]));
    const slots: SaveSlotView[] = SLOT_IDS.map((id) => {
      const m = byId.get(id);
      return {
        id,
        empty: !m,
        label: m?.chapter,
        updatedAt: m?.updatedAt,
        thumbnail: m?.thumbnail,
        playTimeSec: m?.playTimeSec,
        kind: id === QUICK_SLOT ? 'quick' : id === AUTO_SLOT ? 'auto' : 'manual',
      };
    });
    stage.showSaveLoad({ mode, slots }, (slotId) => {
      if (mode === 'save') {
        const snap = interp.saveSnapshot();
        if (!snap) {
          console.warn('[starter] 存档失败：游戏尚未开始');
          return;
        }
        void saves.save(slotId, enrichSnapshot(snap)).then(() => console.info('[starter] 已存档', slotId));
      } else {
        void (async () => {
          try {
            onTitleScreen = false;
            stage.hideTitle();
            interp.loadSnapshot(await saves.load(slotId));
            clearCountedThisSession = false; // 读档 = 进入另一周目会话
            console.info('[starter] 已读档', slotId);
          } catch (err) {
            console.error('[starter] 读档失败:', err);
          }
        })();
      }
    }, () => {});
  }

  // ===== 系统菜单：Esc / 右键唤出 =====
  function openSystemMenu(): void {
    stage.showSystemMenu(
      [
        { id: 'resume', label: '返回游戏' },
        { id: 'save', label: '存档' },
        { id: 'load', label: '读档' },
        { id: 'settings', label: '设置' },
        { id: 'backlog', label: '文字记录' },
        { id: 'gallery', label: '鉴赏' },
        { id: 'title', label: '回到标题' },
      ],
      (id) => {
        switch (id) {
          case 'save': void openSaveLoad('save'); break;
          case 'load': void openSaveLoad('load'); break;
          case 'settings': settingsOpen = true; refreshSettingsPanel(); break;
          case 'backlog': renderer.toggleBacklog(); break;
          case 'gallery': openGallery(); break;
          case 'title': showTitleScreen(); break;
          default: break; // resume：仅关闭菜单
        }
      },
      () => {},
    );
  }


  // ===== 鉴赏（回想）：CG 回看 + 音乐播放；解锁状态来自 GalleryState（随存档持久化） =====
  let galleryOpen = false;
  function openGallery(): void {
    const views = buildGalleryViews(galleryConfig as GalleryConfig, interp.gallery.snapshot());
    stage.showGallery({
      ...views,
      onPlayMusic: (id, src) => audio.playBgm(src ?? id),
      onReplayText: (item) => {
        // 文本回想：关闭鉴赏，跳回回想场景重播（hostJump 清空调用栈）
        if (!item.scene) return;
        stage.hideGallery();
        galleryOpen = false;
        interp.hostJump(item.scene, item.label);
      },
    });
    galleryOpen = true;
  }

  // ===== 设置图形面板：◀ ▶ 步进（状态由 SettingsStore 持有，改后重新投影并刷新面板） =====
  let settingsOpen = false;
  function refreshSettingsPanel(): void {
    const s = settings.settings;
    stage.showSettings(
      SETTING_STEPS.map((d) => ({ id: d.key, label: d.label, display: d.format(s[d.key]) })),
      (id, dir) => {
        const next = stepSetting(settings.settings, id as keyof GameSettings, dir);
        void settings.update({ [id]: next[id as keyof GameSettings] } as Partial<GameSettings>).then(() => {
          // 改值立即投影生效（打字速度/音量/自动停留），并刷新面板展示
          settings.apply(typewriter, audio);
          renderer.setAutoWait(settings.settings.autoBaseDelayMs, settings.settings.autoPerCharMs);
          if (settingsOpen) refreshSettingsPanel();
        });
      },
      () => {
        settingsOpen = false;
      },
    );
  }

  // 手柄（M7 支柱5）：A 推进/确认 · B/Start 菜单 · 十字键/左摇杆 选择肢导航 · RB 开快进 / LB 关快进
  const gamepad = new GamepadPoller((actions) => {
    for (const a of actions) {
      switch (a) {
        case 'advance': {
          const st = interp.status;
          if (st === 'awaiting-advance' || st === 'awaiting-timer' || renderer.status === 'choice') renderer.advance();
          break;
        }
        case 'cancel':
        case 'menu':
          openSystemMenu();
          break;
        case 'up':
          if (renderer.status === 'choice') renderer.choiceUp();
          break;
        case 'down':
          if (renderer.status === 'choice') renderer.choiceDown();
          break;
        case 'shoulderRight':
          if (!renderer.skipMode) renderer.toggleSkip();
          break;
        case 'shoulderLeft':
          if (renderer.skipMode) renderer.toggleSkip();
          break;
        default:
          break;
      }
    }
  });
  gamepad.start();

  // Ctrl 按住临时快进（松开恢复）
  let ctrlTempSkip = false;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Control' && !renderer.skipMode) {
      ctrlTempSkip = true;
      renderer.toggleSkip();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && ctrlTempSkip) {
      ctrlTempSkip = false;
      renderer.toggleSkip();
    }
  });

  // 键位：Space/Enter 推进 · 方向键/数字键 选择 · Ctrl 临时快进 · X 全部跳过
  //       F5/F9 存读档 · A 自动 · S 快进 · L 文字记录 · H 隐藏界面 · G 鉴赏 · O 设置 · Esc 菜单 · [ ] 文本速度
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      openSystemMenu();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      // Space/Enter：推进文本 / 跳过等待 / 确认高亮选项（galgame 键盘惯例）
      e.preventDefault();
      const st = interp.status;
      if (st === 'awaiting-advance' || st === 'awaiting-timer' || renderer.status === 'choice') {
        renderer.advance();
      }
      return;
    }
    if (renderer.status === 'choice' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      if (e.key === 'ArrowUp') renderer.choiceUp();
      else renderer.choiceDown();
      return;
    }
    if (renderer.status === 'choice' && /^[1-9]$/.test(e.key)) {
      renderer.selectChoiceAt(Number(e.key) - 1);
      return;
    }
    if (renderer.backlogOpen && (e.key === 'PageUp' || e.key === 'PageDown')) {
      e.preventDefault();
      stage.scrollBacklog(e.key === 'PageUp' ? -240 : 240);
      return;
    }
    if (e.key === 'F5') {
      e.preventDefault();
      const snap = interp.saveSnapshot();
      if (snap) {
        void saves.save(QUICK_SLOT, enrichSnapshot({ ...snap, kind: 'quick' })).then(() => console.info('[starter] 快速存档'));
      }
    } else if (e.key === 'F9') {
      e.preventDefault();
      void (async () => {
        if (await saves.has(QUICK_SLOT)) {
          try {
            interp.loadSnapshot(await saves.load(QUICK_SLOT));
            clearCountedThisSession = false; // 快速读档 = 进入另一周目会话
            console.info('[starter] 快速读档');
          } catch (err) {
            console.error('[starter] 读档失败（存档损坏或版本不符）：', err);
          }
        }
      })();
    } else if (e.key === 'a' || e.key === 'A') {
      console.info('[starter] 自动播放', renderer.toggleAuto() ? '开' : '关');
    } else if (e.key === 's' || e.key === 'S') {
      // 快进策略跟随设置：仅跳已读（默认，遇未读即停）或全部跳过（一路到底）
      if (settings.settings.skipStrategy >= SKIP_STRATEGY_ALL) {
        console.info('[starter] 快进（全部跳过·设置）', renderer.toggleSkipAll() ? '开' : '关');
      } else {
        console.info('[starter] 快进（已读跳过·设置）', renderer.toggleSkip() ? '开' : '关');
      }
    } else if (e.key === 'x' || e.key === 'X') {
      console.info('[starter] 快进（全部跳过）', renderer.toggleSkipAll() ? '开' : '关');
    } else if (e.key === 'l' || e.key === 'L') {
      // Backlog（文字记录）：覆盖层展示近期文本历史（点击任意处关闭）
      console.info('[starter] 文字记录', renderer.toggleBacklog() ? '开' : '关');
    } else if (e.key === 'h' || e.key === 'H') {
      // 隐藏对话界面（galgame 惯例：赏画用；再按恢复）
      console.info('[starter] 隐藏界面', renderer.toggleHideInterface() ? '开' : '关');
    } else if (e.key === 'g' || e.key === 'G') {
      // 鉴赏（回想）：CG 全屏回看 / 音乐播放；未解锁条目显示 ???
      if (galleryOpen) {
        stage.hideGallery();
        galleryOpen = false;
      } else {
        openGallery();
      }
      console.info('[starter] 鉴赏', galleryOpen ? '开' : '关');
    } else if (e.key === 'o' || e.key === 'O') {
      // 设置图形面板：◀ ▶ 步进各设置项（即时持久化并投影生效）
      if (settingsOpen) {
        stage.hideSettings();
        settingsOpen = false;
      } else {
        settingsOpen = true;
        refreshSettingsPanel();
      }
      console.info('[starter] 设置面板', settingsOpen ? '开' : '关');
    } else if (e.key === '[' || e.key === ']') {
      // 文本速度调整（即时持久化）：[ 减速 / ] 加速
      const next = Math.max(1, Math.min(200, settings.settings.textSpeedCps + (e.key === ']' ? 6 : -6)));
      void settings.update({ textSpeedCps: next }).then(() => {
        renderer.setTextSpeed(next);
        console.info('[starter] 文本速度', next);
      });
    }
  });

  // 调试钩子：浏览器 devtools / 自动化测试直接观察与驱动运行时（生产宿主可自行裁剪）
  (window as unknown as Record<string, unknown>).surdetDebug = {
    interp,
    renderer,
    stage,
    store,
    settings,
    combat,
    // UI 入口（调试/自动化测试直接驱动覆盖层）
    openSystemMenu,
    openSaveLoad,
    showTitleScreen,
    openGallery,
  };

  // 错误上报（渲染层崩溃可见化；桌面环境同步落日志文件）
  window.addEventListener('error', (e) => {
    showFatal(e.message || String(e.error));
    void window.surdetApp?.log('error', e.message || String(e.error));
  });
  window.addEventListener('unhandledrejection', (e) => {
    showFatal(e.reason instanceof Error ? e.reason.message : String(e.reason));
  });

  // 启动：加载素材 → 标题画面（不再直进剧情）
  await loadAssets();
  showTitleScreen();
  console.info(`[starter] started: ${registry.all().length} scenes, ${decls.length} variables`);
}

main().catch((err) => {
  console.error('[starter] 启动失败：', err);
});
