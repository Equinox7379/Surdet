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
  AudioManager,
  Backlog,
  Typewriter,
  SettingsStore,
  SETTING_STEPS,
  stepSetting,
  SKIP_STRATEGY_ALL,
  buildGalleryViews,
  GamepadPoller,
  RenderPerformanceMonitor,
  createRendererRuntime,
  createRendererTheme,
  AssetLoadQueue,
  actionForKeyboardEvent,
  rendererInputForGamepadAction,
  rendererInputForGameAction,
} from '@surdet/renderer';
import type { GameSettings, GalleryConfig, SaveSlotView, AudioHandle, SpeakerProfile, AssetLoadJob, AssetPriority, LoadingProgress, GameAction, NumericSettingKey } from '@surdet/renderer';
import { LocalStorageProfileStorage } from '@surdet/host';
import {
  canRollback as canRollbackFromSession,
  connectInterpreterPresentation,
  connectSystemRouter,
  createDefaultHost,
  createPlayerShellController,
  createRendererPlayerShellSlots,
  createPlayerUiSession,
  createRollbackRuntime,
  createSystemHooks,
  createElectronSaveStorage,
  enterPlayerTitleSession,
  shouldRestoreInterfaceOnPointer,
} from '@surdet/host';
import { createSystemAdapters } from './system-adapters.js';
import { ResolvedAudio } from '../../shared/resolved-audio.js';
import { createSettingsStorage } from '../../shared/settings-storage.js';
import { createBrowserSaveStorage, gameStoragePrefix } from '../../shared/player/browser-save-storage.js';
import { createConfiguredFontJobs } from '../../shared/font-jobs.js';
import { installSceneHotReload } from '../../shared/scene-hmr.js';
import { sceneFiles } from './scene-hmr-boundary.js';
import type { PlayerOverlay, PlayerShellController } from '@surdet/host';
import gameConfig from '../game.config.json';
import gamePackage from '../package.json';
import calendarConfig from '../content/config/calendar.json';
import combatConfig from '../content/config/combat.json';
import eventsConfig from '../content/config/events.json';
import ngpConfig from '../content/config/ngp.json';
import galleryConfig from '../content/config/gallery.json';
import shopConfig from '../content/config/shop.json';
import growthConfig from '../content/config/growth.json';
import achievementsConfig from '../content/config/achievements.json';

interface DebugInteractionTarget {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type DebugErrorValue = {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly domain?: string;
  readonly command?: string;
  readonly owner?: string;
  readonly kind?: string;
  readonly key?: string;
  readonly cause?: DebugErrorValue;
  readonly errors?: readonly DebugErrorValue[];
};

function freezeDebug<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeDebug(child);
  if (Array.isArray(value)) {
    for (const child of value) freezeDebug(child);
  }
  return Object.freeze(value);
}

function serializeDebugError(value: unknown, depth = 0): DebugErrorValue {
  if (depth > 5) return { name: 'Error', message: '[cause depth limit]' };
  if (value instanceof AggregateError) {
    return freezeDebug({
      name: value.name,
      message: value.message,
      errors: value.errors.map((entry) => serializeDebugError(entry, depth + 1)),
    });
  }
  if (value instanceof Error) {
    const candidate = value as Error & {
      code?: unknown;
      domain?: unknown;
      command?: unknown;
      owner?: unknown;
      kind?: unknown;
      key?: unknown;
      cause?: unknown;
    };
    const output: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };
    for (const field of ['code', 'domain', 'command', 'owner', 'kind', 'key'] as const) {
      if (typeof candidate[field] === 'string') output[field] = candidate[field];
    }
    if (candidate.cause !== undefined && candidate.cause !== value) output.cause = serializeDebugError(candidate.cause, depth + 1);
    return freezeDebug(output) as DebugErrorValue;
  }
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>;
    const output: Record<string, unknown> = {
      name: typeof candidate.name === 'string' ? candidate.name : 'Error',
      message: typeof candidate.message === 'string' ? candidate.message : String(candidate),
    };
    for (const field of ['code', 'domain', 'command', 'owner', 'kind', 'key'] as const) {
      if (typeof candidate[field] === 'string') output[field] = candidate[field];
    }
    if (candidate.cause !== undefined && candidate.cause !== value) output.cause = serializeDebugError(candidate.cause, depth + 1);
    return freezeDebug(output) as DebugErrorValue;
  }
  return { name: typeof value, message: String(value) };
}

async function main(): Promise<void> {
  const appEl = document.getElementById('app')!;

  const debugSessionId = `zero-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const debugResourceIds = Object.freeze({
    rendererRuntime: `${debugSessionId}:renderer-runtime`,
    audioManager: `${debugSessionId}:audio-manager`,
    frameScheduler: `${debugSessionId}:frame-scheduler`,
  });

  const fontBlobUrls = new Set<string>();
  /** 桌面壳从主进程读取素材时生成的 Blob URL；浏览器 Vite URL 不进入此集合。 */
  const assetBlobUrls = new Set<string>();
  let lastLoadingProgress: LoadingProgress = { total: 0, completed: 0, failed: 0, current: null, done: false };

  // 字体角色在标题首帧前全部加载，避免系统字体先闪现再替换；缺失时按角色独立回退。
  const speakerProfiles: SpeakerProfile[] = Object.entries(
    ((gameConfig as { characters?: Record<string, { name?: string; avatar?: string }> }).characters ?? {}),
  ).flatMap(([id, profile]) => {
    const name = typeof profile.name === 'string' ? profile.name.trim() : '';
    if (!name) return [];
    return [{ id, name, ...(typeof profile.avatar === 'string' && profile.avatar.trim().length > 0 ? { avatarKey: profile.avatar } : {}) }];
  });
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
  const calendar: CalendarRunner = new CalendarRunner(calendarConfig as CalendarConfig, store);
  const combat: CombatSolver = new CombatSolver(combatConfig as CombatConfig);
  const affection: AffectionSystem = new AffectionSystem(
    eventsConfig.profiles as AffectionProfile[],
    eventsConfig.events as RelationshipEvent[],
    store,
  );
  const ngp = new NewGamePlus(ngpConfig as NewGamePlusConfig, store);
  const shop = new ShopSystem(shopConfig as ShopConfig, store);
  // 角色成长（经验/升级）：配置驱动曲线，升级属性增量写回变量仓库；状态随存档往返（引擎内聚）
  const growth = new GrowthSystem(growthConfig as GrowthConfig, store);
  // 成就系统：when 条件批量判定 + 事件触发解锁；状态经 SystemHooks 随存档往返
  const achievements: AchievementSystem = new AchievementSystem(achievementsConfig as AchievementDef[], store);
  // 事件调度器（兰斯式事件队列）：events.json scheduled[] 声明优先级事件，
  // 日历回合头/尾统一 dispatch；fired 状态经 SystemHooks 随存档往返
  const scheduler: EventScheduler = new EventScheduler(eventsConfig.scheduled as ScheduledEventDef[], store);

  // 战斗采用交互式回合 UI：见下方 system 'battle' 事件处理（点击攻击 / 跳过行动）

  // 总线 + 解释器 + 渲染器（全家桶状态经 SystemHooks 随存档往返；成长系统引擎内聚，构造注入）
  const bus = new EventBus<CoreEventMap>();
  const interp = new Interpreter(store, bus, registry, undefined, undefined, createSystemHooks([
    { id: 'calendar', snapshot: () => calendar.snapshot(), validate: (value) => calendar.validateSnapshot(value), restore: (value) => { calendar.validateSnapshot(value); calendar.restore(value); } },
    { id: 'combat', snapshot: () => combat.snapshot(), validate: (value) => combat.validateSnapshot(value), restore: (value) => { combat.validateSnapshot(value); combat.restore(value); } },
    { id: 'affection', snapshot: () => affection.snapshot(), validate: (value) => affection.validateSnapshot(value), restore: (value) => { affection.validateSnapshot(value); affection.restore(value); } },
    { id: 'achievements', snapshot: () => achievements.snapshot(), validate: (value) => achievements.validateSnapshot(value), restore: (value) => { achievements.validateSnapshot(value); achievements.restore(value); } },
    { id: 'eventScheduler', snapshot: () => scheduler.snapshot(), validate: (value) => scheduler.validateSnapshot(value), restore: (value) => { scheduler.validateSnapshot(value); scheduler.restore(value); } },
  ]), undefined, growth);
  const audioManager = new AudioManager();
  /** 音频素材地址映射（loadAssets 填充：素材键 → Blob/文件 URL） */
  const audioUrls = new Map<string, string>();
  const audio: AudioHandle = new ResolvedAudio(audioManager, audioUrls);
  let galleryMusicCallbackCount = 0;
  let lastGalleryMusicRequest: {
    readonly id: string;
    readonly source: string;
    readonly resolvedSource: string | null;
    readonly sourceResolved: boolean;
  } | null = null;

  const browserPrefix = gameStoragePrefix(gamePackage.name);
  const settings = new SettingsStore(createSettingsStorage('zero', browserPrefix));
  await settings.load();

  // Backlog + Renderer v2 Runtime（设置投影：文本速度/自动停留/音量）
  const backlog = new Backlog();
  const typewriter = new Typewriter({ charsPerSecond: settings.settings.textSpeedCps });
  const uiSession = createPlayerUiSession({ base: 'title' });
  let playerShell: PlayerShellController | null = null;
  let lastRendererError: DebugErrorValue | null = null;
  const performanceMonitor = new RenderPerformanceMonitor();
  const runtime = await createRendererRuntime({
    audio,
    typewriter,
    backlog,
    performanceMonitor,
    onError: (error) => {
      lastRendererError = serializeDebugError(error);
      console.error('[zero] Renderer failed:', error);
    },
    onAdvance: () => interp.advance(),
    onSelect: (i) => interp.choose(i),
    // @wait 计时结束 → 恢复解释器（玩家点击跳过由 renderer.advance 直达 finishWait）
    onWaitEnd: () => { uiSession.setVideoActive(false); interp.finishWait(); },
    onPointerConsumed: () => playerShell?.commands.consumePointer(),
    onBacklogClose: () => {
      playerShell?.commands.consumePointer();
      if (playerShell && playerShell.queries.snapshot().overlay === 'backlog') playerShell.commands.close();
      refreshCommandRail();
    },
  });
  appEl.appendChild(runtime.canvas);
  runtime.resize();
  window.addEventListener('resize', () => runtime.resize());
  const renderer = runtime.controller;
  const commands = runtime.commands;
  const queries = runtime.queries;
  const assets = commands.assets;
  const dialogue = commands.dialogue;
  const menu = commands.menu;
  const gallery = commands.gallery;
  const system = commands.system;
  const loading = commands.loading;
  const presentation = commands.presentation;
  let activeSaveLoad: { mode: 'save' | 'load'; slots: SaveSlotView[] } | null = null;
  const slots = createRendererPlayerShellSlots({
    renderer: { commands, queries },
    views: {
      title: () => titleView(),
      systemMenu: () => systemMenuView(),
      saveLoad: (request) => saveLoadView(request.mode),
      settings: () => settingsView(),
      gallery: () => galleryView(),
      backlog: () => ({
        entries: queries.dialogue.backlogEntries(),
        query: queries.dialogue.backlogSearchQuery(),
      }),
    },
  });
  playerShell = createPlayerShellController({
    slots,
    session: uiSession,
    onError: (error) => {
      lastRendererError = serializeDebugError(error);
      console.error('[zero] player shell operation failed:', error);
    },
  });
  commands.preferences.setTheme(createRendererTheme());
  dialogue.setSpeakerProfiles(speakerProfiles);
  settings.apply(typewriter, audio);
  bus.on('video', () => { uiSession.setVideoActive(true); });
  renderer.connect(bus);
  const presentationConnection = connectInterpreterPresentation({
    interpreter: interp,
    renderer: runtime,
  });

  const uiSnapshot = () => playerShell!.queries.snapshot();
  const isTitleScreen = (): boolean => uiSnapshot().base === 'title';
  const isOverlay = (overlay: PlayerOverlay): boolean => uiSnapshot().overlay === overlay;
  const isVideoActive = (): boolean => uiSnapshot().videoActive;
  const isUiBusy = (): boolean => uiSnapshot().operation !== 'idle' || queries.overlay.system().type !== 'none';
  const restoreCommandRailForPlayerContext = (): void => {
    const snapshot = uiSnapshot();
    if (snapshot.base === 'game' && snapshot.overlay === 'none' && snapshot.operation === 'idle' && !snapshot.interfaceHidden) {
      dialogue.restoreCommandRail();
    }
  };

  function debugProjection(): ReturnType<typeof queries.diagnostics.projectionSnapshot> {
    return queries.diagnostics.projectionSnapshot();
  }

  function debugActiveOverlay(): string | null {
    const projection = debugProjection();
    const gallerySnapshot = projection.gallery;
    if (gallerySnapshot && gallerySnapshot.overlay.type !== 'none') return `gallery:${gallerySnapshot.overlay.tab}`;
    const menuSnapshot = projection.menu;
    if (menuSnapshot && menuSnapshot.overlay.type !== 'none') return menuSnapshot.overlay.type;
    if (projection.dialogue?.backlogVisible) return 'backlog';
    const systemSnapshot = projection.system;
    if (systemSnapshot && systemSnapshot.overlay.type !== 'none') return systemSnapshot.overlay.type;
    return null;
  }

  function debugCommandRailVisible(): boolean {
    return debugProjection().dialogue?.commandRailVisible === true;
  }

  function debugInteractionTargets(): readonly DebugInteractionTarget[] {
    const projection = debugProjection();
    const targets: DebugInteractionTarget[] = [];
    const add = (id: string, x: number, y: number, width: number, height: number): void => {
      targets.push({ id, x, y, width, height });
    };
    const galleryOverlay = projection.gallery?.overlay;
    if (galleryOverlay && galleryOverlay.type !== 'none') {
      add('gallery:cg', 42, 12, 96, 62);
      add('gallery:music', 132, 12, 112, 62);
      add('gallery:text', 220, 12, 60, 62);
      add('gallery:close', 1120, 10, 150, 66);
      if (galleryOverlay.tab === 'music') {
        const views = buildGalleryViews(galleryConfig as GalleryConfig, interp.gallery.snapshot());
        views.music.forEach((item, index) => {
          if (item.unlocked) add(`gallery:music:${item.id}`, 60, 96 + index * 58, 720, 46);
        });
      }
      return freezeDebug(targets);
    }
    const menuSnapshot = projection.menu;
    const menuOverlay = menuSnapshot?.overlay;
    if (menuOverlay?.type === 'title') {
      for (const item of menuSnapshot?.titleTargets ?? []) {
        add(`title:${item.id}`, item.x, item.y, item.width, item.height);
      }
      return freezeDebug(targets);
    }
    if (menuOverlay?.type === 'system-menu') {
      ['resume', 'save', 'load', 'settings', 'backlog', 'gallery', 'title']
        .forEach((id, index) => add(`system:${id}`, 892, 128 + index * 54, 318, 50));
      return freezeDebug(targets);
    }
    if (menuOverlay?.type === 'settings') {
      add('settings:close', 1140, 70, 70, 70);
      return freezeDebug(targets);
    }
    if (menuOverlay?.type === 'save-load') {
      for (let index = 0; index < (menuSnapshot?.saveLoadSlotCount ?? 0); index++) {
        const column = index % 2;
        const row = Math.floor(index / 2);
        add(`save-load:slot-${index + 1}`, 150 + column * 502, 180 + row * 120, 480, 104);
      }
      add('save-load:close', 1160, 62, 70, 70);
      return freezeDebug(targets);
    }
    if (projection.dialogue?.backlogVisible) {
      add('backlog:close', 0, 0, 1280, 720);
      return freezeDebug(targets);
    }
    const choiceBounds = projection.dialogue?.choiceBounds ?? [];
    if (projection.dialogue?.visibleChoiceCount && choiceBounds.length > 0) {
      choiceBounds.forEach((bounds, index) => {
        add(`choice:${index}`, bounds.x, bounds.y, bounds.width, bounds.height);
      });
      return freezeDebug(targets);
    }
    if (debugCommandRailVisible()) {
      ['auto', 'skip', 'backlog', 'qsave', 'qload', 'rollback', 'settings', 'hide', 'menu']
        .forEach((id, index) => add(`rail:${id}`, 812 + index * 48, 658, 44, 46));
    }
    return freezeDebug(targets);
  }

  const rollbackRuntime = createRollbackRuntime({
    interpreter: interp,
    renderer: {
      get status() { return runtime.controller.status; },
      get backlogOpen() { return runtime.controller.backlogOpen; },
      canCaptureRollbackCheckpoint: () => queries.presentation.canCaptureRollbackCheckpoint(),
      resetSession: (options) => runtime.resetSession(options),
      snapshotPresentation: () => queries.presentation.snapshot(),
      restorePresentation: (snapshot) => presentation.restore(snapshot),
    },
    audio,
    isBlocked: () => isTitleScreen() || uiSnapshot().overlay !== 'none' || isUiBusy() || isVideoActive(),
    label: 'zero',
    onRefresh: () => refreshCommandRail(),
  });
  const clearRollback = (): void => rollbackRuntime.clear();
  const clearRollbackForBoundary = (): void => rollbackRuntime.clearForBoundary();
  const canRollback = (): boolean => rollbackRuntime.canRollback();
  const performRollback = (): boolean => rollbackRuntime.perform();

  bus.on('stateReset', () => { uiSession.setVideoActive(false); });
  bus.on('text', () => rollbackRuntime.captureText());

  // E2E/调试探针：只读暴露最小运行状态（不参与任何生产逻辑；自我迭代②，Playwright 自动通关用）
  (window as unknown as Record<string, unknown>).__surdetDebug = {
    get status(): string { return interp.status; },
    get rendererStatus(): string { return renderer.status; },
    get sessionId(): string { return debugSessionId; },
    get resourceIds(): typeof debugResourceIds { return { ...debugResourceIds }; },
    get position(): { sceneId: string; pc: number; sceneHash?: string } | null {
      const position = interp.saveSnapshot()?.position;
      return position ? { sceneId: position.sceneId, pc: position.pc, sceneHash: position.sceneHash } : null;
    },
    get fontFamilies(): { body: string; title: string; ui: string } {
      return {
        body: queries.preferences.fontFamily('body'),
        title: queries.preferences.fontFamily('title'),
        ui: queries.preferences.fontFamily('ui'),
      };
    },
    get metrics() {
      const snapshot = queries.diagnostics.performanceSnapshot();
      const last = snapshot?.samples.at(-1);
      return {
        frames: snapshot?.frames ?? 0,
        totalUpdateMs: (snapshot?.averageUpdateMs ?? 0) * (snapshot?.frames ?? 0),
        maxUpdateMs: snapshot?.maxUpdateMs ?? 0,
        slowFrames: snapshot?.slowFrames ?? 0,
        lastDeltaMs: last?.deltaMs ?? 0,
        activeBlobUrls: assetBlobUrls.size + fontBlobUrls.size,
      };
    },
    get activeBlobUrls(): number { return assetBlobUrls.size + fontBlobUrls.size; },
    get assetLoading(): LoadingProgress { return { ...lastLoadingProgress }; },
    get resourceSnapshot() { return queries.diagnostics.resourceSnapshot(); },
    get resourceLedger() { return queries.diagnostics.resourceLedger?.() ?? null; },
    get audioPlayback() {
      const snapshot = audio.snapshotPlayback?.() ?? { bgm: null, ambience: null };
      const diagnostics = audioManager.snapshotBgmDiagnostics();
      return freezeDebug({
        ...snapshot,
        bgmPlaying: diagnostics.playing,
        bgmPlayCount: diagnostics.playCount,
        bgmSource: diagnostics.source,
        howlerErrors: diagnostics.errors,
      });
    },
    get galleryMusicPlayback() {
      return freezeDebug({
        callbackCount: galleryMusicCallbackCount,
        lastRequest: lastGalleryMusicRequest ? { ...lastGalleryMusicRequest } : null,
      });
    },
    get presentationSnapshot() { return queries.presentation.snapshot(); },
    get canCaptureRollbackCheckpoint(): boolean { return queries.presentation.canCaptureRollbackCheckpoint(); },
    get fadeTweenActive(): boolean { return !queries.presentation.canCaptureRollbackCheckpoint(); },
    get visualThumbnail(): string | null { return queries.world.captureThumbnail(); },
    get uiSession() {
      return freezeDebug({ ...uiSnapshot() });
    },
    get playerShell() {
      const shell = playerShell;
      if (!shell) return null;
      return freezeDebug({
        snapshot: shell.queries.snapshot(),
        slots: shell.queries.slots(),
        canAdvance: shell.queries.canAdvance(),
        canRollback: shell.queries.canRollback(),
      });
    },
    get theme() {
      return queries.preferences.theme();
    },
    get activeOverlay(): string | null { return debugActiveOverlay(); },
    get commandRailVisible(): boolean { return debugCommandRailVisible(); },
    get dialogueProjection() { return debugProjection().dialogue; },
    get themeProjection() { return debugProjection().themeProjection ?? null; },
    get interactionTargets(): readonly DebugInteractionTarget[] { return debugInteractionTargets(); },
    get lastRendererError(): DebugErrorValue | null {
      return lastRendererError ? freezeDebug({ ...lastRendererError }) : null;
    },
    titleSelect: (id: string) => titleSelect(id),
    quickSave: () => quickSave(),
    quickLoad: () => quickLoad(),
  };

  // ===== 存档富化：缩略图（舞台截图）+ 本次会话游戏时长 =====
  let sessionStart = Date.now();
  function enrichSnapshot(snap: SaveSnapshot): SaveSnapshot {
    const thumb = queries.world.captureThumbnail();
    if (thumb) snap.meta.thumbnail = thumb;
    snap.meta.playTimeSec = Math.max(0, Math.round((Date.now() - sessionStart) / 1000));
    return snap;
  }

  /** 回合尾事件演出前的挂起点快照：事件场景播完后经 sceneEnd 恢复，剧情续跑（回合头尾闭环） */
  let turnResumeSnap: SaveSnapshot | null = null;

  const host = createDefaultHost({
    interpreter: interp,
    renderer,
    stage: system,
    adapters: createSystemAdapters({
      interpreter: interp,
      renderer: system,
      store,
      registry,
      calendar,
      scheduler,
      combat,
      combatConfig: combatConfig as CombatConfig,
      affection,
      shop,
      achievements,
      onAchievementsChanged: () => checkAchievements(),
      onBattleResult: (winner) => store.set('battleWon', winner === 'allies'),
      onTurnResumeSnapshot: (snapshot) => { turnResumeSnap = snapshot; },
      onLog: (message) => console.info(`[zero] ${message}`),
    }),
    onError: (error) => console.error('[zero] 宿主 adapter 失败：', error),
    onSystemBoundary: () => { clearRollbackForBoundary(); },
    onStateReset: () => { turnResumeSnap = null; },
  });
  connectSystemRouter(bus, host, (error) => console.error('[zero] system 路由失败：', error));
  const debugApi = (window as unknown as { __surdetDebug?: Record<string, unknown> }).__surdetDebug;
  if (debugApi) {
    debugApi.systemBoundaryProbe = async (): Promise<{ opened: boolean; hadRollback: boolean; rollbackBlocked: boolean }> => {
      rollbackRuntime.captureText();
      const hadRollback = canRollback();
      const opened = await host.routeSystem('calendar', {});
      const rollbackBlocked = !canRollback();
      host.reset();
      return { opened, hadRollback, rollbackBlocked };
    };
  }
  bus.on('stateReset', () => host.reset());

  // @system 统一由 @surdet/host 路由；游戏只在上方注入配置、求解器和结果回调。

  // 点击画布：先让本次同步事件中的 Pixi UI 回调标记消费，再统一决定是否推进。
  runtime.canvas.addEventListener('pointerdown', (e) => {
    const decision = playerShell!.decidePointer(e);
    if (decision === 'ignore') return;
    if (decision === 'restore-interface') {
      if (shouldRestoreInterfaceOnPointer(uiSnapshot())) {
        uiSession.setInterfaceHidden(false);
        renderer.dispatchInput({ type: 'interface.toggle' });
        refreshCommandRail();
      }
      return;
    }
    if (!playerShell!.queries.canAdvance()) return;
    const s = interp.status;
    if (s === 'awaiting-advance' || s === 'awaiting-timer') renderer.dispatchInput({ type: 'advance' });
  });

  // 滚轮：Backlog 打开时滚动文字记录（galgame 惯例：鼠标滚轮回看历史）
  runtime.canvas.addEventListener('wheel', (e) => {
    if (isOverlay('backlog')) {
      e.preventDefault();
      renderer.dispatchInput({ type: 'backlog.scroll', delta: e.deltaY > 0 ? 120 : -120 });
    }
  }, { passive: false });

  // 右键 → 系统菜单（GalGame 惯例）；标题画面不弹（标题自带菜单，空白处右键蹦设置框属误弹，用户反馈修复）
  runtime.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (isTitleScreen()) return;
    openSystemMenu();
  });

  // 存档存储：Electron 壳（打包 exe）落 userData/saves 文件系统（异步 invoke IPC）；浏览器回退 localStorage
  const desktopSave = window.surdetSave;
  const saveStorage: SaveStorage = desktopSave
    ? createElectronSaveStorage(desktopSave)
    : createBrowserSaveStorage(localStorage, browserPrefix);
  const saves = new SaveManager(saveStorage);

  // 剧本 @autosave：写入自动存档槽位（读档用 F9 只覆盖快速档；自动档需另行提供读档入口）
  bus.on('autosave', (snap) => {
    if (rollbackRuntime.isRestoring()) return;
    void saves.save(AUTO_SLOT, enrichSnapshot(snap)).then(() => {
      console.info('[zero] 自动存档（ngp cleared:', ngp.isCleared(), '）');
    }).catch(error => console.error('[zero] 自动存档失败：', error));
  });

  // 存档场景哈希不匹配：存档后剧本被编辑，pc 定位可能漂移（引擎仍照常加载，此处提醒玩家）
  bus.on('saveMismatch', (p) => {
    clearRollback();
    console.warn(`[zero] 存档与剧本版本不一致（场景 ${p.sceneId}）：定位可能漂移，建议重新开始该场景`);
  });

  // 读档/状态重置（审计修复 C1/M1）：关闭全部覆盖层，防止旧战斗/地图/商店 UI 残留在还原后的状态之上
  bus.on('stateReset', () => {
    system.hideVideo(); // 停止残留 @video 播放（审计复核）
    system.hideBattle();
    system.hideMap();
    system.hideShop();
    gallery.hideGallery();
    menu.hideSaveLoad();
    menu.hideSettings();
    menu.hideSystemMenu();
  });

  // 回合尾事件场景播完 → 恢复跳转前快照，剧情从挂起点续跑（回合头尾闭环）。
  // loadSnapshot 不可在事件回调内调用（撞解释器 #stepping 重入守卫），延迟到 UI 线程执行。
  let endingTransitionActive = false;
  const endingSceneIds = new Set(['route_meeting_rooftop', 'route_silence_dawn', 'route_testimony_rooftop']);
  bus.on('sceneEnd', ({ sceneId }) => {
    if (turnResumeSnap) {
      const snap = turnResumeSnap;
      turnResumeSnap = null;
      setTimeout(() => {
        try {
          interp.loadSnapshot(snap);
        } catch (err) {
          console.error('[zero] 回合尾事件恢复失败:', err);
        }
      }, 0);
      return;
    }
    // 三条正式结局统一经过独立黑场，再回封面；不把结束状态留给玩家点击。
    if (!endingSceneIds.has(sceneId) || endingTransitionActive) return;
    endingTransitionActive = true;
    menu.showEnding('THE END');
    window.setTimeout(() => {
      showTitleScreen();
      endingTransitionActive = false;
    }, 2200);
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
        const ext = (fontPath.split('.').pop() ?? '').toLowerCase();
        const mime = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'otf' ? 'font/otf' : 'font/ttf';
        return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
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

  const configuredFontJobs = createConfiguredFontJobs({
    config: gameConfig,
    fontBlobUrls,
    label: 'zero',
    resolveFontUrl,
    assets,
  });

  // ===== 素材管线：content/assets 约定 bg/<key>.png | portrait/<角色>_<服装>_<表情>.png | avatar/<角色>.png | bgm|se|voice/<key>.音频 =====
  async function loadAssets(): Promise<void> {
    const IMG = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
    const AUD = /\.(mp3|ogg|wav|m4a|flac)$/i;
    const MIME: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
    };
    const register = async (rel: string, url: string): Promise<boolean> => {
      const parts = rel.split('/');
      const kind = parts[0] ?? '';
      const fname = parts[parts.length - 1] ?? '';
      if (kind === 'bg' && IMG.test(fname)) {
        await assets.registerBackground(fname.replace(IMG, ''), url, fname.split('.').pop());
        return true;
      } else if (kind === 'portrait' && IMG.test(fname)) {
        const seg = fname.replace(IMG, '').split('_');
        if (seg[0]) {
          await assets.registerPortrait(seg[0], seg[1] ?? 'normal', seg[2] ?? 'normal', url, fname.split('.').pop());
          return true;
        }
      } else if (kind === 'avatar' && IMG.test(fname)) {
        await assets.registerAvatar(fname.replace(IMG, ''), url, fname.split('.').pop());
        return true;
      } else if ((kind === 'bgm' || kind === 'se' || kind === 'voice') && AUD.test(fname)) {
        audioUrls.set(fname.replace(AUD, ''), url);
        audioManager.setSourceFormat(url, fname.split('.').pop() ?? '');
        return true;
      }
      return false;
    };
    const priorityFor = (rel: string): AssetPriority => {
      if (rel === 'bg/title_bg.png' || rel.startsWith('fonts/')) return 'critical';
      if (rel.startsWith('bg/') || rel.startsWith('portrait/') || rel.startsWith('avatar/')) return 'scene';
      return 'background';
    };
    const loadAndRegister = async (rel: string, url: string, revoke?: () => void, retain?: () => void): Promise<void> => {
      try {
        const retained = await register(rel, url);
        if (retained) retain?.();
        else revoke?.();
      } catch (error) {
        revoke?.();
        throw error;
      }
    };
    const jobs: AssetLoadJob[] = [...configuredFontJobs()];
    const desktopAsset = window.surdetAsset;
    if (desktopAsset) {
      // 打包环境：素材经主进程读取（自动解密）→ Blob URL 注册
      const files = (await desktopAsset.list()).filter((rel) => !rel.startsWith('fonts/'));
      for (const rel of files) {
        jobs.push({
          id: rel,
          priority: priorityFor(rel),
          load: async () => {
            const bytes = await desktopAsset.read(rel);
            const ext = (rel.split('/').pop()?.split('.').pop() ?? '').toLowerCase();
            const base = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' }));
            const filename = rel.split('/').pop() ?? 'asset.bin';
            await loadAndRegister(rel, `${base}#${filename}`, () => URL.revokeObjectURL(base), () => assetBlobUrls.add(base));
          },
        });
      }
    } else {
      // 浏览器开发环境：vite 直接提供素材 URL（无素材时 glob 为空，占位策略兜底）
      const imgs = import.meta.glob('../content/assets/**/*.{png,jpg,jpeg,webp,gif,avif,svg}', { query: '?url', import: 'default', eager: true });
      const auds = import.meta.glob('../content/assets/**/*.{mp3,ogg,wav,m4a,flac}', { query: '?url', import: 'default', eager: true });
      for (const [p, url] of [...Object.entries(imgs), ...Object.entries(auds)]) {
        const rel = p.replace('../content/assets/', '');
        jobs.push({ id: rel, priority: priorityFor(rel), load: () => loadAndRegister(rel, url as string) });
      }
    }
    const finalProgress = await new AssetLoadQueue(4).run(jobs, (progress) => {
      lastLoadingProgress = { ...progress };
      loading.showLoading(progress);
    });
    lastLoadingProgress = { ...finalProgress };
    if (finalProgress.failed > 0) console.warn(`[zero] ${finalProgress.failed} asset(s) failed`);
    loading.hideLoading();
    console.info('[zero] 素材加载完成：音频条目', audioUrls.size);
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
  const CLEAR_KEY = window.surdetProfile ? 'surdet:clearRecord' : `${browserPrefix}clearRecord`;
  const profileStorage = new LocalStorageProfileStorage(localStorage, `${browserPrefix}profile:`);
  async function loadLegacyClearRecord(): Promise<GlobalClearRecord | null> {
    try {
      const raw = localStorage.getItem(CLEAR_KEY);
      return raw ? (JSON.parse(raw) as GlobalClearRecord) : null;
    } catch {
      return null;
    }
  }
  async function loadClearRecord(): Promise<GlobalClearRecord | null> {
    try {
      const value = window.surdetProfile
        ? await window.surdetProfile.read('clear-record')
        : await profileStorage.read<GlobalClearRecord>('clear-record');
      if (value !== null) return value as GlobalClearRecord;
    } catch (err) {
      console.warn('[zero] Profile 通关记录读取失败，尝试兼容记录：', err);
    }
    return loadLegacyClearRecord();
  }
  async function saveClearRecord(rec: GlobalClearRecord): Promise<void> {
    try {
      if (window.surdetProfile) await window.surdetProfile.write('clear-record', rec);
      else await profileStorage.write('clear-record', rec);
      return;
    } catch (err) {
      console.error('[zero] Profile 通关记录写入失败，尝试兼容记录：', err);
    }
    try {
      localStorage.setItem(CLEAR_KEY, JSON.stringify(rec));
    } catch (err) {
      console.error('[zero] 兼容通关记录写入失败：', err);
    }
  }
  let clearRecord = await loadClearRecord();

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
    void saveClearRecord(rec);
    console.info(`[zero] 全局通关记录：结局 ${p.ending}（累计 ${rec.playthroughs} 周目 · 收集 ${rec.endings.length} 结局）`);
  });

  // @exp：角色成长结果 → 升级演出（横幅）+ levelEvents 场景跳转（配置驱动）
  bus.on('growth', (p) => {
    if (p.levelsGained > 0) {
      dialogue.showBanner(`${p.characterId} 升级！Lv.${p.levelBefore} → Lv.${p.levelAfter}`, 'chapter');
    console.info(`[zero] growth: ${p.characterId} Lv.${p.levelBefore} → Lv.${p.levelAfter}（+${p.gained} exp）`);
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
          if (res.fresh) dialogue.showBanner(`成就解锁：${res.def.name}`, 'tip');
        } catch (err) {
          console.warn('[zero] level_5 unlock failed:', err instanceof Error ? err.message : err);
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
        dialogue.showBanner(`成就解锁：${r.def.name}`, 'tip');
        console.info(`[zero] achievement unlocked: ${r.id}（${r.def.name}）`);
      }
    } catch (err) {
      console.warn('[zero] achievement check failed:', err instanceof Error ? err.message : err);
    }
  }
  // 每条文本推进后判定：覆盖 @set/@mod 改变量后的剧情节奏（变量在文本行之间变化）
  bus.on('text', () => { if (!rollbackRuntime.isRestoring()) checkAchievements(); });

  // ===== 标题画面：开始/读档/鉴赏/设置/退出 =====
  function titleView() {
    return {
      view: {
        title: (gameConfig as { title?: string }).title ?? 'Surdet Game',
        subtitle: 'AFTER MIDNIGHT  /  A CITY MYSTERY IN FIVE CALLS',
        backgroundKey: 'title_bg',
        items: [
          { id: 'new', label: '开始游戏' },
          { id: 'load', label: '读取存档' },
          { id: 'gallery', label: '鉴赏' },
          { id: 'settings', label: '设置' },
          { id: 'quit', label: '退出游戏', enabled: typeof window.surdetApp !== 'undefined' },
        ],
      },
      onSelect: titleSelect,
    };
  }

  function systemMenuView() {
    return {
      items: [
        { id: 'resume', label: '返回游戏' },
        { id: 'save', label: '存档' },
        { id: 'load', label: '读档' },
        { id: 'settings', label: '设置' },
        { id: 'backlog', label: '文字记录' },
        { id: 'gallery', label: '鉴赏' },
        { id: 'title', label: '回到标题' },
      ],
      onSelect: onSystemMenuSelect,
      onClose: onSystemMenuClose,
    };
  }

  function saveLoadView(mode: 'save' | 'load') {
    if (!activeSaveLoad || activeSaveLoad.mode !== mode) throw new Error(`save-load view is not prepared: ${mode}`);
    return {
      view: { mode, slots: activeSaveLoad.slots },
      onSelect: (slotId: string) => selectSaveLoad(mode, slotId),
      onClose: closeSaveLoad,
      options: {
        completion: 'host-transaction' as const,
        onTransactionComplete: restoreCommandRailForPlayerContext,
        ...(mode === 'load' ? { onRestore: (slotId: string) => restoreSaveLoad(slotId) } : {}),
      },
    };
  }

  function settingsView() {
    const s = settings.settings;
    return {
      rows: SETTING_STEPS.map((d) => ({ id: d.key, label: d.label, display: d.format(s[d.key]) })),
      onChange: onSettingsChange,
      onClose: closeSettings,
    };
  }

  function galleryView() {
    const views = buildGalleryViews(galleryConfig as GalleryConfig, interp.gallery.snapshot());
    return {
      ...views,
      onPlayMusic: (id: string, src?: string) => {
        playerShell!.commands.consumePointer();
        galleryMusicCallbackCount += 1;
        const source = src ?? id;
        const resolvedSource = audioUrls.get(source) ?? null;
        lastGalleryMusicRequest = {
          id,
          source,
          resolvedSource,
          sourceResolved: resolvedSource !== null,
        };
        audio.playBgm(source, { restart: true });
      },
      onReplayText: (item: (typeof views.texts)[number]) => {
        playerShell!.commands.consumePointer();
        if (!item.scene) return;
        playerShell!.commands.close();
        interp.hostJump(item.scene, item.label);
      },
      onClose: closeGallery,
    };
  }

  /** 标题画面显示中；来源/返回由 PlayerShellController 持有。 */
  function showTitleScreen(): void {
    clearRollback();
    // 标题页不是暂停菜单：冻结解释器并清空上一轮投影，避免隐藏剧情继续响应输入。
    interp.pauseHost();
    const ensureTitleProjection = (): void => {
      if (queries.overlay.menu().type !== 'title') {
        playerShell!.commands.open({ slot: 'title', source: 'title' });
      }
    };
    enterPlayerTitleSession({
      shell: playerShell!,
      renderer: runtime,
      openTitle: ensureTitleProjection,
    });
    ensureTitleProjection();
  }

  /** 从标题页进入二级全屏页面：标题与其余覆盖层必须同时让位。 */
  function leaveTitleForOverlay(): void {
    // 标题背景与可交互菜单必须一起退出活动 overlay；二级页关闭后由
    // showTitleScreen() 重新投影标题页，避免隐藏按钮继续抢占命中测试。
    menu.hideTitle(false);
    dialogue.hideCommandRail();
    menu.hideSaveLoad();
    menu.hideSettings();
    gallery.hideGallery();
  }

  /** 标题菜单选择（E2E 探针 titleSelect 与画面点击共用同一入口；自我迭代②） */
  async function titleSelect(id: string): Promise<void> {
    playerShell!.commands.consumePointer();
    switch (id) {
      case 'new': {
        clearRollback();
        runtime.resetSession();
        menu.hideTitle();
        playerShell!.commands.reset('game');
        store.reset();
        clearCountedThisSession = false; // 新周目会话开始，周目计数重新可用
        // 周目继承：存在全局通关记录时，按 ngp.json 继承项把通关值应用到新周目初始表
        const rec = await loadClearRecord();
        if (rec) {
          const inherited = ngp.computeInheritFrom(
            store.snapshot(),
            rec.variables as Record<string, VarValue>,
          );
          for (const [name, value] of Object.entries(inherited)) {
            if (store.has(name) && store.get(name) !== value) store.set(name, value);
          }
          console.info(`[zero] 新周目开局（第 ${rec.playthroughs + 1} 周目，继承 ${ngp.inheritEntries().length} 项）`);
        }
        sessionStart = Date.now(); // 新周目重新计游戏时长
        interp.start((gameConfig as { entryScene?: string }).entryScene ?? 'ch01_01'); // 审计修复：入口场景取自配置，不再硬编码
        break;
      }
      case 'load':
        leaveTitleForOverlay();
        void openSaveLoad('load', 'title');
        break;
      case 'gallery':
        leaveTitleForOverlay();
        openGallery('title');
        break;
      case 'settings':
        leaveTitleForOverlay();
        playerShell!.commands.open({ slot: 'settings', source: 'title' });
        break;
      case 'quit':
        void window.surdetApp?.quit();
        break;
    }
  }

  if (import.meta.hot) {
    installSceneHotReload({
      hot: import.meta.hot,
      registry,
      interpreter: interp,
      label: 'zero',
      sceneFiles,
      resolveSceneUrl: (path) => new URL(path, import.meta.url).href,
    });
  }

  // ===== 存档/读档 UI：多槽位 + 快速/自动档 =====
  const SLOT_IDS = ['1', '2', '3', '4', '5', '6', QUICK_SLOT, AUTO_SLOT];
  async function openSaveLoad(
    mode: 'save' | 'load',
    source: 'title' | 'game' | 'system-menu' = uiSnapshot().base,
  ): Promise<void> {
    if (source === 'title') leaveTitleForOverlay();
    let metas: Awaited<ReturnType<typeof saves.list>>;
    let backupMetas: Awaited<ReturnType<typeof saves.listBackupMeta>> = [];
    try {
      metas = await saves.list();
      if (mode === 'load') backupMetas = await saves.listBackupMeta();
    } catch (err) {
      if (source === 'title') showTitleScreen();
      else refreshCommandRail();
      console.error('[zero] 存档列表读取失败:', err);
      return;
    }
    const byId = new Map(metas.map((m) => [m.id, m]));
    const backupIds = new Set(backupMetas.map((m) => m.id));
    const slots: SaveSlotView[] = SLOT_IDS.map((id) => {
      const m = byId.get(id);
      return {
        id,
        empty: !m,
        label: m?.chapter,
        updatedAt: m?.updatedAt,
        thumbnail: m?.thumbnail,
        playTimeSec: m?.playTimeSec,
        backupAvailable: mode === 'load' && backupIds.has(id),
        kind: id === QUICK_SLOT ? 'quick' : id === AUTO_SLOT ? 'auto' : 'manual',
      };
    });
    activeSaveLoad = { mode, slots };
    playerShell!.commands.open({ slot: 'save-load', source, mode });
  }

  function completeLoadedSnapshot(snap: SaveSnapshot): void {
    interp.loadSnapshot(snap);
    sessionStart = Date.now() - Math.max(0, snap.meta.playTimeSec ?? 0) * 1000;
    menu.hideTitle();
    clearRollback();
    playerShell!.commands.completeOperation({ base: 'game', overlay: 'none' });
    activeSaveLoad = null;
    clearCountedThisSession = false; // 读档 = 进入另一周目会话
    refreshCommandRail();
  }

  async function selectSaveLoad(mode: 'save' | 'load', slotId: string): Promise<boolean> {
    playerShell!.commands.consumePointer();
    if (mode === 'load') {
      const slot = activeSaveLoad?.slots.find((candidate) => candidate.id === slotId);
      if (!slot || slot.empty) {
        console.warn('[zero] 忽略无效读档槽位：', slotId);
        return false;
      }
    }
    if (mode === 'save') {
      const snap = interp.saveSnapshot();
      if (!snap) {
        console.warn('[zero] 存档失败：游戏尚未开始');
        return false;
      }
      const origin = uiSnapshot();
      playerShell!.commands.beginOperation('saving');
      try {
        await saves.save(slotId, enrichSnapshot(snap));
        playerShell!.commands.completeOperation({
          base: origin.base,
          overlay: 'none',
          interfaceHidden: origin.interfaceHidden,
          videoActive: origin.videoActive,
        });
        activeSaveLoad = null;
        console.info('[zero] 已存档', slotId);
        refreshCommandRail();
        return true;
      } catch (err) {
        playerShell!.commands.failOperation(err);
        console.error('[zero] 存档失败:', err);
        return false;
      }
    }

    playerShell!.commands.beginOperation('loading');
    try {
      const snap = await saves.load(slotId);
      completeLoadedSnapshot(snap);
      console.info('[zero] 已读档', slotId);
      return true;
    } catch (err) {
      playerShell!.commands.failOperation(err);
      console.error('[zero] 读档失败:', err);
      return false;
    }
  }

  async function restoreSaveLoad(slotId: string): Promise<boolean> {
    playerShell!.commands.consumePointer();
    const slot = activeSaveLoad?.slots.find((candidate) => candidate.id === slotId);
    if (!slot || slot.empty || !slot.backupAvailable) {
      console.warn('[zero] 忽略无效备份恢复槽位：', slotId);
      return false;
    }
    playerShell!.commands.beginOperation('loading');
    try {
      await saves.restoreBackup(slotId);
      const snap = await saves.load(slotId);
      completeLoadedSnapshot(snap);
      console.info('[zero] 已恢复备份并读档', slotId);
      return true;
    } catch (err) {
      playerShell!.commands.failOperation(err);
      console.error('[zero] 备份恢复失败:', err);
      return false;
    }
  }

  function closeSaveLoad(): void {
    playerShell!.commands.consumePointer();
    if (isUiBusy() || !isOverlay('save-load')) return;
    const base = uiSnapshot().base;
    playerShell!.commands.close();
    activeSaveLoad = null;
    if (base === 'title') showTitleScreen();
    else {
      refreshCommandRail();
      restoreCommandRailForPlayerContext();
    }
  }

  function toggleBacklog(): void {
    if (isUiBusy()) return;
    if (isOverlay('backlog')) {
      renderer.dispatchInput({ type: 'backlog.toggle' });
      playerShell!.commands.close();
    } else if (uiSnapshot().base === 'game' && uiSnapshot().overlay === 'none') {
      playerShell!.commands.open({ slot: 'backlog', source: 'game' });
      renderer.dispatchInput({ type: 'backlog.toggle' });
    }
    refreshCommandRail();
  }

  // ===== 系统菜单：Esc / 右键唤出 =====
  function openSystemMenu(): void {
    if (isTitleScreen() || isUiBusy() || uiSnapshot().overlay !== 'none') return;
    playerShell!.commands.open({ slot: 'system-menu', source: 'game' });
  }

  function onSystemMenuSelect(id: string): void {
    playerShell!.commands.consumePointer();
    switch (id) {
      case 'save':
        playerShell!.commands.close();
        void openSaveLoad('save', 'game');
        break;
      case 'load':
        playerShell!.commands.close();
        void openSaveLoad('load', 'game');
        break;
      case 'settings':
        playerShell!.commands.open({ slot: 'settings', source: 'system-menu' });
        break;
      case 'backlog':
        playerShell!.commands.close();
        toggleBacklog();
        break;
      case 'gallery':
        playerShell!.commands.close();
        openGallery('game');
        break;
      case 'title':
        showTitleScreen();
        break;
      default:
        playerShell!.commands.close();
        break;
    }
    refreshCommandRail();
  }

  function onSystemMenuClose(): void {
    playerShell!.commands.consumePointer();
    if (isOverlay('system-menu')) playerShell!.commands.close();
  }

  let quickSaveInFlight: Promise<boolean> | null = null;

  function quickSave(): Promise<boolean> {
    // 快速读档必须等待当前 IPC 写入完成，避免连续 F5/F9 读到旧槽位。
    if (quickSaveInFlight || isUiBusy()) return quickSaveInFlight ?? Promise.resolve(false);
    const snap = interp.saveSnapshot();
    if (!snap) return Promise.resolve(false);
    const origin = uiSnapshot();
    const railWasVisible = debugProjection().dialogue?.commandRailVisible === true;
    playerShell!.commands.beginOperation('saving');
    if (railWasVisible) dialogue.hideCommandRail();
    let task: Promise<boolean>;
    try {
      task = saves.save(QUICK_SLOT, enrichSnapshot({ ...snap, kind: 'quick' })).then(
        () => {
          playerShell!.commands.completeOperation({
            base: origin.base,
            overlay: origin.overlay,
            interfaceHidden: origin.interfaceHidden,
            videoActive: origin.videoActive,
          });
          if (railWasVisible) dialogue.restoreCommandRail();
          console.info('[zero] 快速存档');
          refreshCommandRail();
          return true;
        },
        (err) => {
          playerShell!.commands.failOperation(err);
          if (railWasVisible) dialogue.restoreCommandRail();
          console.error('[zero] 快速存档失败：', err);
          return false;
        },
      );
    } catch (err) {
      playerShell!.commands.failOperation(err);
      if (railWasVisible) dialogue.restoreCommandRail();
      console.error('[zero] 快速存档失败：', err);
      return Promise.resolve(false);
    }
    quickSaveInFlight = task;
    void task.then(() => {
      if (quickSaveInFlight === task) quickSaveInFlight = null;
    });
    return task;
  }

  async function quickLoad(): Promise<boolean> {
    if (quickSaveInFlight) await quickSaveInFlight;
    if (isUiBusy() || uiSnapshot().base !== 'game' || uiSnapshot().overlay !== 'none') return false;
    try {
      if (!await saves.has(QUICK_SLOT)) return false;
    } catch (err) {
      console.error('[zero] 快速读档槽位读取失败：', err);
      return false;
    }
    const railWasVisible = debugProjection().dialogue?.commandRailVisible === true;
    playerShell!.commands.beginOperation('loading');
    if (railWasVisible) dialogue.hideCommandRail();
    try {
      const snap = await saves.load(QUICK_SLOT);
      clearRollback();
      interp.loadSnapshot(snap);
      sessionStart = Date.now() - Math.max(0, snap.meta.playTimeSec ?? 0) * 1000;
      playerShell!.commands.completeOperation({ base: 'game', overlay: 'none' });
      if (railWasVisible) dialogue.restoreCommandRail();
      clearCountedThisSession = false;
      console.info('[zero] 快速读档');
      refreshCommandRail();
      return true;
    } catch (err) {
      playerShell!.commands.failOperation(err);
      if (railWasVisible) dialogue.restoreCommandRail();
      console.error('[zero] 快速读档失败：', err);
      return false;
    }
  }


  // ===== 鉴赏（回想）：CG 回看 + 音乐播放；解锁状态来自 GalleryState（随存档持久化） =====
  function openGallery(source: 'title' | 'game' = uiSnapshot().base): void {
    if (source === 'title') leaveTitleForOverlay();
    playerShell!.commands.open({ slot: 'gallery', source });
  }

  function closeGallery(): void {
    playerShell!.commands.consumePointer();
    const base = uiSnapshot().base;
    if (isOverlay('gallery')) playerShell!.commands.close();
    if (base === 'title') showTitleScreen();
    else refreshCommandRail();
  }

  // ===== 设置图形面板：◀ ▶ 步进（状态由 SettingsStore 持有，改后重新投影并刷新面板） =====
  function refreshSettingsPanel(): void {
    if (!isOverlay('settings')) return;
    const view = settingsView();
    menu.showSettings(view.rows, view.onChange, view.onClose);
  }

  function onSettingsChange(id: string, dir: -1 | 1): void {
    playerShell!.commands.consumePointer();
    const next = stepSetting(settings.settings, id as NumericSettingKey, dir);
    void settings.update({ [id]: next[id as keyof GameSettings] } as Partial<GameSettings>).then(() => {
      settings.apply(typewriter, audio);
      renderer.setAutoWait(settings.settings.autoBaseDelayMs, settings.settings.autoPerCharMs);
      refreshSettingsPanel();
    });
  }

  function closeSettings(): void {
    playerShell!.commands.consumePointer();
    if (!isOverlay('settings')) return;
    const base = uiSnapshot().base;
    playerShell!.commands.close();
    if (base === 'title') showTitleScreen();
    else refreshCommandRail();
  }

  /** 画面内操作带：动作仍复用既有键盘/系统菜单语义。 */
  function refreshCommandRail(): void {
    dialogue.setCommandRailItems([
      { id: 'auto', icon: 'A', label: '自动', active: renderer.autoPlay, tooltip: '自动播放' },
      { id: 'skip', icon: '»', label: '快进', active: renderer.skipMode, tooltip: '快进已读文本' },
      { id: 'backlog', icon: '▤', label: '记录', active: isOverlay('backlog'), tooltip: '打开文字记录' },
      { id: 'qsave', icon: '↓', label: '快存', tooltip: '快速存档' },
      { id: 'qload', icon: '↑', label: '快读', tooltip: '快速读档' },
      { id: 'rollback', icon: '↶', label: '回退', enabled: canRollbackFromSession(uiSnapshot()) && canRollback(), tooltip: '回到上一条文本' },
      { id: 'settings', icon: '⚙', label: '设置', active: isOverlay('settings'), tooltip: '打开设置' },
      { id: 'hide', icon: '□', label: '界面', active: uiSnapshot().interfaceHidden, tooltip: '隐藏界面' },
      { id: 'menu', icon: '≡', label: '菜单', tooltip: '打开系统菜单' },
    ]);
  }

  function onCommandRailSelect(id: string): void {
    playerShell!.commands.consumePointer();
    switch (id) {
      case 'auto': renderer.dispatchInput({ type: 'auto.toggle' }); break;
      case 'skip': {
        renderer.dispatchInput({
          type: 'skip.toggle',
          scope: settings.settings.skipStrategy >= SKIP_STRATEGY_ALL ? 'all' : 'read',
        });
        break;
      }
      case 'backlog': toggleBacklog(); break;
      case 'qsave': quickSave(); break;
      case 'qload': void quickLoad(); break;
      case 'rollback': performRollback(); break;
      case 'settings':
        if (isOverlay('settings')) {
          closeSettings();
        } else if (uiSnapshot().overlay === 'none') {
          playerShell!.commands.open({ slot: 'settings', source: 'game' });
        }
        break;
      case 'hide': uiSession.toggleInterface(); renderer.dispatchInput({ type: 'interface.toggle' }); break;
      case 'menu': openSystemMenu(); break;
      default: break;
    }
    refreshCommandRail();
  }

  // 手柄（M7 支柱5）：A 推进/确认 · B/Start 菜单 · 十字键/左摇杆 选择肢导航 · RB 开快进 / LB 关快进
  const gamepad = new GamepadPoller((actions) => {
    if (isTitleScreen()) return;
    for (const a of actions) {
      switch (a) {
        case 'advance': {
          const st = interp.status;
          if (st === 'awaiting-advance' || st === 'awaiting-timer' || renderer.status === 'choice') renderer.dispatchInput({ type: 'advance' });
          break;
        }
        case 'cancel':
        case 'menu':
          openSystemMenu();
          break;
        case 'up':
          if (renderer.status === 'choice') renderer.dispatchInput({ type: 'choice.move', delta: -1 });
          break;
        case 'down':
          if (renderer.status === 'choice') renderer.dispatchInput({ type: 'choice.move', delta: 1 });
          break;
        case 'shoulderRight':
          {
            const input = rendererInputForGamepadAction(a, renderer.skipMode);
            if (input) renderer.dispatchInput(input);
          }
          refreshCommandRail();
          break;
        case 'shoulderLeft':
          {
            const input = rendererInputForGamepadAction(a, renderer.skipMode);
            if (input) renderer.dispatchInput(input);
          }
          refreshCommandRail();
          break;
        default:
          break;
      }
    }
  });
  gamepad.start();

  let gameResourcesDisposed = false;
  function disposeGameResources(): void {
    if (gameResourcesDisposed) return;
    gameResourcesDisposed = true;
    // Runtime disposal owns the renderer asset registry. Keep this boundary
    // synchronous and never issue an assets command after an external dispose.
    gamepad.stop();
    audioManager.dispose();
    presentationConnection.disconnect();
    runtime.dispose();
    for (const url of assetBlobUrls) URL.revokeObjectURL(url);
    assetBlobUrls.clear();
    for (const url of fontBlobUrls) URL.revokeObjectURL(url);
    fontBlobUrls.clear();
  }
  window.addEventListener('beforeunload', disposeGameResources);

  // Ctrl 按住临时快进（松开恢复）
  let ctrlTempSkip = false;
  const releaseCtrlTempSkip = (): void => {
    if (!ctrlTempSkip) return;
    ctrlTempSkip = false;
    if (renderer.skipMode) renderer.dispatchInput({ type: 'skip.toggle', scope: 'read' });
    refreshCommandRail();
  };
  bus.on('stateReset', () => { releaseCtrlTempSkip(); });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Control') return;
    if (isTitleScreen()) { ctrlTempSkip = false; return; }
    if (e.repeat) return;
    if (ctrlTempSkip) {
      if (renderer.skipMode) return;
      ctrlTempSkip = false;
    }
    if (renderer.skipMode) return;
    ctrlTempSkip = true;
    renderer.dispatchInput({ type: 'skip.toggle', scope: 'read' });
    refreshCommandRail();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key !== 'Control') return;
    if (isTitleScreen()) { ctrlTempSkip = false; return; }
    releaseCtrlTempSkip();
  });
  window.addEventListener('blur', () => {
    if (isTitleScreen()) { ctrlTempSkip = false; return; }
    releaseCtrlTempSkip();
  });

  function routeGameAction(action: GameAction): void {
    if (action === 'advance') {
      const st = interp.status;
      if (st === 'awaiting-advance' || st === 'awaiting-timer' || renderer.status === 'choice') {
        renderer.dispatchInput({ type: 'advance' });
      }
      refreshCommandRail();
      return;
    }
    if (action === 'hideUi') {
      if (isUiBusy() || uiSnapshot().overlay !== 'none') return;
      uiSession.toggleInterface();
      renderer.dispatchInput({ type: 'interface.toggle' });
      refreshCommandRail();
      return;
    }
    if (action === 'skip') {
      renderer.dispatchInput({
        type: 'skip.toggle',
        scope: settings.settings.skipStrategy >= SKIP_STRATEGY_ALL ? 'all' : 'read',
      });
      refreshCommandRail();
      return;
    }
    const input = rendererInputForGameAction(action);
    if (input) {
      renderer.dispatchInput(input);
      refreshCommandRail();
      return;
    }
    switch (action) {
      case 'menu': openSystemMenu(); break;
      case 'quickSave': void quickSave(); break;
      case 'quickLoad': void quickLoad(); break;
      case 'rollback': performRollback(); break;
    }
    refreshCommandRail();
  }

  // 键位：Space/Enter 推进 · 方向键/数字键 选择 · Ctrl 临时快进 · X 全部跳过
  //       F5/F9 存读档 · A 自动 · S 快进 · L 文字记录 · H 隐藏界面 · G 鉴赏 · O 设置 · Esc 菜单 · [ ] 文本速度
  window.addEventListener('keydown', (e) => {
    if (isTitleScreen()) return;
    if (isOverlay('backlog')) {
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'KeyF') {
        e.preventDefault(); renderer.focusBacklogSearch(); return;
      }
      if (e.code === 'Backspace' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault(); renderer.backspaceBacklogSearch(); return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault(); renderer.appendBacklogSearch(e.key); return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        if (!renderer.handleBacklogEscape()) toggleBacklog();
        refreshCommandRail();
        return;
      }
      if (e.code === 'PageUp' || e.code === 'PageDown') {
        e.preventDefault(); renderer.dispatchInput({ type: 'backlog.scroll', delta: e.code === 'PageUp' ? -240 : 240 }); return;
      }
    }
    if (renderer.status === 'choice' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      e.preventDefault();
      renderer.dispatchInput({ type: 'choice.move', delta: e.code === 'ArrowUp' ? -1 : 1 });
      return;
    }
    const action = actionForKeyboardEvent(e, settings.settings.keyPreset);
    if (action) {
      e.preventDefault(); routeGameAction(action); return;
    }
    if (e.code === 'KeyX' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); renderer.dispatchInput({ type: 'skip.toggle', scope: 'all' }); refreshCommandRail(); return;
    }
    if (e.key === 'Escape') {
      openSystemMenu();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      // Space/Enter：推进文本 / 跳过等待 / 确认高亮选项（galgame 键盘惯例）
      e.preventDefault();
      const st = interp.status;
      if (st === 'awaiting-advance' || st === 'awaiting-timer' || renderer.status === 'choice') {
        renderer.dispatchInput({ type: 'advance' });
      }
      return;
    }
    if (renderer.status === 'choice' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      renderer.dispatchInput({ type: 'choice.move', delta: e.key === 'ArrowUp' ? -1 : 1 });
      return;
    }
    if (e.key === 'ArrowUp' && performRollback()) {
      e.preventDefault();
      return;
    }
    if (renderer.status === 'choice' && /^[1-9]$/.test(e.key)) {
      renderer.dispatchInput({ type: 'choice.select', index: Number(e.key) - 1 });
      return;
    }
    if (isOverlay('backlog') && (e.key === 'PageUp' || e.key === 'PageDown')) {
      e.preventDefault();
      renderer.dispatchInput({ type: 'backlog.scroll', delta: e.key === 'PageUp' ? -240 : 240 });
      return;
    }
    if (e.key === 'F5') {
      e.preventDefault();
      quickSave();
    } else if (e.key === 'F9') {
      e.preventDefault();
      void quickLoad();
    } else if (e.key === 'a' || e.key === 'A') {
      console.info('[zero] 自动播放', renderer.dispatchInput({ type: 'auto.toggle' }) ? '开' : '关');
      refreshCommandRail();
    } else if (e.key === 's' || e.key === 'S') {
      // 快进策略跟随设置：仅跳已读（默认，遇未读即停）或全部跳过（一路到底）
      if (settings.settings.skipStrategy >= SKIP_STRATEGY_ALL) {
        console.info('[zero] 快进（全部跳过·设置）', renderer.dispatchInput({ type: 'skip.toggle', scope: 'all' }) ? '开' : '关');
      } else {
        console.info('[zero] 快进（已读跳过·设置）', renderer.dispatchInput({ type: 'skip.toggle', scope: 'read' }) ? '开' : '关');
      }
      refreshCommandRail();
    } else if (e.key === 'x' || e.key === 'X') {
      console.info('[zero] 快进（全部跳过）', renderer.dispatchInput({ type: 'skip.toggle', scope: 'all' }) ? '开' : '关');
      refreshCommandRail();
    } else if (e.key === 'l' || e.key === 'L') {
      // Backlog（文字记录）：覆盖层展示近期文本历史（点击任意处关闭）
      toggleBacklog();
      console.info('[zero] 文字记录', isOverlay('backlog') ? '开' : '关');
      refreshCommandRail();
    } else if (e.key === 'h' || e.key === 'H') {
      // 隐藏对话界面（galgame 惯例：赏画用；再按恢复）
      uiSession.toggleInterface();
      renderer.dispatchInput({ type: 'interface.toggle' });
      console.info('[zero] 隐藏界面', uiSnapshot().interfaceHidden ? '开' : '关');
      refreshCommandRail();
    } else if (e.key === 'g' || e.key === 'G') {
      // 鉴赏（回想）：CG 全屏回看 / 音乐播放；未解锁条目显示 ???
      if (isOverlay('gallery')) {
        closeGallery();
      } else {
        openGallery();
      }
      console.info('[zero] 鉴赏', isOverlay('gallery') ? '开' : '关');
    } else if (e.key === 'o' || e.key === 'O') {
      // 设置图形面板：◀ ▶ 步进各设置项（即时持久化并投影生效）
      if (isOverlay('settings')) {
        closeSettings();
      } else {
        playerShell!.commands.open({ slot: 'settings', source: 'game' });
      }
      console.info('[zero] 设置面板', isOverlay('settings') ? '开' : '关');
      refreshCommandRail();
    } else if (e.key === '[' || e.key === ']') {
      // 文本速度调整（即时持久化）：[ 减速 / ] 加速
      const next = Math.max(1, Math.min(200, settings.settings.textSpeedCps + (e.key === ']' ? 6 : -6)));
      void settings.update({ textSpeedCps: next }).then(() => {
        renderer.setTextSpeed(next);
        console.info('[zero] 文本速度', next);
      });
    }
  });

  // 调试钩子：浏览器 devtools / 自动化测试直接观察与驱动运行时（生产宿主可自行裁剪）
  (window as unknown as Record<string, unknown>).surdetDebug = {
    interp,
    renderer,
    runtime,
    commands,
    queries,
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
    lastRendererError = serializeDebugError(e.error ?? e.message);
    showFatal(e.message || String(e.error));
    void window.surdetApp?.log('error', e.message || String(e.error));
    void window.surdetApp?.reportError('renderer-error', e.message || String(e.error));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const message = e.reason instanceof Error ? e.reason.message : String(e.reason);
    lastRendererError = serializeDebugError(e.reason ?? message);
    showFatal(message);
    void window.surdetApp?.reportError('renderer-unhandled-rejection', message);
  });

  // 启动：加载素材 → 标题画面（不再直进剧情）
  await loadAssets();
  dialogue.showCommandRail([], onCommandRailSelect);
  refreshCommandRail();
  showTitleScreen();
  console.info(`[zero] started: ${registry.all().length} scenes, ${decls.length} variables`);
}

main().catch((err) => {
  console.error('[zero] 启动失败：', err);
});
