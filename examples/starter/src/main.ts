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
  TimelineRegistry,
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
  AssetLoadQueue,
  actionForKeyboardEvent,
  rendererInputForGameAction,
} from '@surdet/renderer';
import type { GameSettings, GalleryConfig, SaveSlotView, AudioHandle, SpeakerProfile, AssetLoadJob, AssetPriority, LoadingProgress, GameAction, NumericSettingKey } from '@surdet/renderer';
import {
  LocalStorageProfileStorage,
  PlayerInputGate,
  canAdvance,
  connectSystemRouter,
  createDefaultHost,
  createPlayerUiSession,
  createSystemHooks,
  createElectronSaveStorage,
  shouldRestoreInterfaceOnPointer,
} from '@surdet/host';
import type { PlayerOverlay } from '@surdet/host';
import { createSystemAdapters } from './system-adapters.js';
import { ResolvedAudio } from '../../shared/resolved-audio.js';
import { createSettingsStorage } from '../../shared/settings-storage.js';
import { createRollbackRuntime } from '../../shared/rollback-runtime.js';
import { createConfiguredFontJobs } from '../../shared/font-jobs.js';
import { installSceneHotReload } from '../../shared/scene-hmr.js';
import { createStarterOwnerTeardown } from './starter-owner-teardown.js';
import { sceneFiles } from './scene-hmr-boundary.js';
import gameConfig from '../game.config.json';
import calendarConfig from '../content/config/calendar.json';
import combatConfig from '../content/config/combat.json';
import eventsConfig from '../content/config/events.json';
import ngpConfig from '../content/config/ngp.json';
import galleryConfig from '../content/config/gallery.json';
import shopConfig from '../content/config/shop.json';
import growthConfig from '../content/config/growth.json';
import achievementsConfig from '../content/config/achievements.json';

// 时间轴与剧本分离：JSON 可被 starter、编辑器预览和打包版共同加载。
const timelineFiles = import.meta.glob('../content/timelines/**/*.json', {
  eager: true,
  import: 'default',
});

async function main(): Promise<void> {
  const appEl = document.getElementById('app')!;

  const debugSessionId = `starter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const debugResourceIds = Object.freeze({
    rendererRuntime: `${debugSessionId}:renderer-runtime`,
    audioManager: `${debugSessionId}:audio-manager`,
    frameScheduler: `${debugSessionId}:frame-scheduler`,
  });

  const fontBlobUrls = new Set<string>();
  const assetBlobUrls = new Set<string>();
  let lastLoadingProgress: LoadingProgress = { total: 0, completed: 0, failed: 0, current: null, done: false };

  // 字体角色在标题首帧前全部加载，避免系统字体先闪现再替换；缺失时按角色独立回退。
  const speakerProfiles: SpeakerProfile[] = Object.entries(
    ((gameConfig as { characters?: Record<string, { name?: string; avatar?: string }> }).characters ?? {}),
  ).flatMap(([id, profile]) => {
    const name = typeof profile.name === 'string' ? profile.name.trim() : '';
    if (!name) return [];
    return [{ id, name, avatarKey: profile.avatar ?? id }];
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
  const timelines = new TimelineRegistry();
  for (const definition of Object.values(timelineFiles)) timelines.register(definition);

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

  const settings = new SettingsStore(createSettingsStorage('starter'));
  await settings.load();

  // Backlog + Renderer v2 Runtime（设置投影：文本速度/自动停留/音量）
  const backlog = new Backlog();
  const typewriter = new Typewriter({ charsPerSecond: settings.settings.textSpeedCps });
  const uiSession = createPlayerUiSession({ base: 'title' });
  const inputGate = new PlayerInputGate();
  const performanceMonitor = new RenderPerformanceMonitor();
  const runtime = await createRendererRuntime({
    audio,
    typewriter,
    backlog,
    performanceMonitor,
    onError: (error) => console.error('[starter] Renderer failed:', error),
    onAdvance: () => interp.advance(),
    onSelect: (i) => interp.choose(i),
    // @wait 计时结束 → 恢复解释器（玩家点击跳过由 renderer.advance 直达 finishWait）
    onWaitEnd: () => { uiSession.setVideoActive(false); interp.finishWait(); },
    onPointerConsumed: () => inputGate.consumeCurrentPointer(),
  });
  appEl.appendChild(runtime.canvas);
  runtime.resize();
  const resizeHandler = (): void => runtime.resize();
  window.addEventListener('resize', resizeHandler);
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
  dialogue.setSpeakerProfiles(speakerProfiles);
  settings.apply(typewriter, audio);
  renderer.connect(bus);
  interp.setTimelineCatalog(timelines);
  interp.setPresentationHooks({
    snapshot: () => queries.presentation.snapshot(),
    restore: (payload) => presentation.restore(payload),
  });

  const uiSnapshot = () => uiSession.snapshot();
  const isTitleScreen = (): boolean => uiSnapshot().base === 'title';
  const isOverlay = (overlay: PlayerOverlay): boolean => uiSnapshot().overlay === overlay;
  const isVideoActive = (): boolean => uiSnapshot().videoActive;
  const isUiBusy = (): boolean => uiSnapshot().operation !== 'idle';
  const restoreCommandRailForPlayerContext = (): void => {
    const snapshot = uiSnapshot();
    if (snapshot.base === 'game' && snapshot.overlay === 'none' && snapshot.operation === 'idle' && !snapshot.interfaceHidden) {
      dialogue.restoreCommandRail();
    }
  };

  const rollbackRuntime = createRollbackRuntime({
    interpreter: interp,
    renderer: {
      get status() { return runtime.controller.status; },
      get backlogOpen() { return runtime.controller.backlogOpen; },
      resetSession: (options) => runtime.resetSession(options),
      snapshotPresentation: () => queries.presentation.snapshot(),
      restorePresentation: (snapshot) => presentation.restore(snapshot),
    },
    audio,
    isBlocked: () => isTitleScreen() || uiSnapshot().overlay !== 'none' || isUiBusy() || isVideoActive(),
    label: 'starter',
    onRefresh: () => refreshCommandRail(),
  });
  const clearRollback = (): void => rollbackRuntime.clear();
  const canRollback = (): boolean => rollbackRuntime.canRollback();
  const performRollback = (): boolean => rollbackRuntime.perform();

  bus.on('video', () => { uiSession.setVideoActive(true); });
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
    get activeBlobUrls(): number { return assetBlobUrls.size + fontBlobUrls.size; },
    get assetLoading(): LoadingProgress { return { ...lastLoadingProgress }; },
    get resourceSnapshot() { return queries.diagnostics.resourceSnapshot(); },
    get presentationSnapshot() { return queries.presentation.snapshot(); },
    get dialogueProjection() { return queries.diagnostics.projectionSnapshot().dialogue; },
    get commandRailVisible() { return queries.diagnostics.projectionSnapshot().dialogue?.commandRailVisible === true; },
    get uiSession() { return Object.freeze({ ...uiSnapshot() }); },
    get queries() { return queries; },
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
      onLog: (message) => console.info(`[starter] ${message}`),
    }),
    onError: (error) => console.error('[starter] 宿主 adapter 失败：', error),
    onSystemBoundary: () => { clearRollback(); },
    onStateReset: () => { turnResumeSnap = null; },
  });
  connectSystemRouter(bus, host, (error) => console.error('[starter] system 路由失败：', error));
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

  // 点击画布推进文本（标题/覆盖层期间解释器不在等待态 → 静默忽略，不抛错）
  const canvasPointerDown = (e: PointerEvent): void => {
    const decision = inputGate.decidePointer(uiSnapshot(), e);
    if (decision === 'ignore') return;
    if (decision === 'restore-interface') {
      if (shouldRestoreInterfaceOnPointer(uiSnapshot())) {
        uiSession.setInterfaceHidden(false);
        renderer.dispatchInput({ type: 'interface.toggle' });
        refreshCommandRail();
      }
      return;
    }
    if (!canAdvance(uiSnapshot())) return;
    const s = interp.status;
    if (s === 'awaiting-advance' || s === 'awaiting-timer') renderer.dispatchInput({ type: 'advance' });
  };
  runtime.canvas.addEventListener('pointerdown', canvasPointerDown);

  // 滚轮：Backlog 打开时滚动文字记录（galgame 惯例：鼠标滚轮回看历史）
  const canvasWheel = (e: WheelEvent): void => {
    if (renderer.backlogOpen) {
      e.preventDefault();
      dialogue.scrollBacklog(e.deltaY > 0 ? 120 : -120);
    }
  };
  const canvasWheelOptions: AddEventListenerOptions = { passive: false };
  runtime.canvas.addEventListener('wheel', canvasWheel, canvasWheelOptions);

  // 右键 → 系统菜单（GalGame 惯例）；标题画面不弹（标题自带菜单，空白处右键蹦设置框属误弹，用户反馈修复）
  const canvasContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    if (isTitleScreen()) return;
    openSystemMenu();
  };
  runtime.canvas.addEventListener('contextmenu', canvasContextMenu);

  // 存档存储：Electron 壳（打包 exe）落 userData/saves 文件系统（异步 invoke IPC）；浏览器回退 localStorage
  const desktopSave = window.surdetSave;
  const saveStorage: SaveStorage = desktopSave
    ? createElectronSaveStorage(desktopSave)
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
    if (rollbackRuntime.isRestoring()) return;
    void saves.save(AUTO_SLOT, enrichSnapshot(snap)).then(() => {
      console.info('[starter] 自动存档（ngp cleared:', ngp.isCleared(), '）');
    });
  });

  // 存档场景哈希不匹配：存档后剧本被编辑，pc 定位可能漂移（引擎仍照常加载，此处提醒玩家）
  bus.on('saveMismatch', (p) => {
    clearRollback();
    console.warn(`[starter] 存档与剧本版本不一致（场景 ${p.sceneId}）：定位可能漂移，建议重新开始该场景`);
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
    // 读档期间保留正在进行的 save/load 事务；否则 quickLoad 的 stateReset
    // 会先把 operation 清成 idle，随后完成/失败分支只能抛出二次状态错误。
    // 空闲状态仍保留原有的完整 UI 会话重置语义。
    if (!isUiBusy()) uiSession.reset(uiSnapshot().base);
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

  const configuredFontJobs = createConfiguredFontJobs({
    config: gameConfig,
    fontBlobUrls,
    label: 'starter',
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
    const blobAssetUrl = (rel: string, bytes: Uint8Array): string => {
      const filename = rel.split('/').pop() ?? 'asset.bin';
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      const base = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' }));
      // Pixi resolves its loader from the URL extension; the fragment does not affect the Blob fetch.
      return `${base}#${filename}`;
    };
    const register = async (rel: string, url: string): Promise<boolean> => {
      const parts = rel.split('/');
      const kind = parts[0] ?? '';
      const fname = parts[parts.length - 1] ?? '';
      const format = fname.split('.').pop()?.toLowerCase();
      if (kind === 'bg' && IMG.test(fname)) {
        await assets.registerBackground(fname.replace(IMG, ''), url, format);
        return true;
      } else if (kind === 'portrait' && IMG.test(fname)) {
        const seg = fname.replace(IMG, '').split('_');
        if (seg[0]) {
          await assets.registerPortrait(seg[0], seg[1] ?? 'normal', seg[2] ?? 'normal', url, format);
          return true;
        }
      } else if (kind === 'avatar' && IMG.test(fname)) {
        await assets.registerAvatar(fname.replace(IMG, ''), url, format);
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
            const base = blobAssetUrl(rel, bytes).split('#')[0]!;
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
    if (finalProgress.failed > 0) console.warn(`[starter] ${finalProgress.failed} asset(s) failed`);
    loading.hideLoading();
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
  const profileStorage = new LocalStorageProfileStorage(localStorage);
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
      console.warn('[starter] Profile 通关记录读取失败，尝试兼容记录：', err);
    }
    return loadLegacyClearRecord();
  }
  async function saveClearRecord(rec: GlobalClearRecord): Promise<void> {
    try {
      if (window.surdetProfile) await window.surdetProfile.write('clear-record', rec);
      else await profileStorage.write('clear-record', rec);
      return;
    } catch (err) {
      console.error('[starter] Profile 通关记录写入失败，尝试兼容记录：', err);
    }
    try {
      localStorage.setItem(CLEAR_KEY, JSON.stringify(rec));
    } catch (err) {
      console.error('[starter] 兼容通关记录写入失败：', err);
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
    console.info(`[starter] 全局通关记录：结局 ${p.ending}（累计 ${rec.playthroughs} 周目 · 收集 ${rec.endings.length} 结局）`);
  });

  // @exp：角色成长结果 → 升级演出（横幅）+ levelEvents 场景跳转（配置驱动）
  bus.on('growth', (p) => {
    if (p.levelsGained > 0) {
      dialogue.showBanner(`${p.characterId} 升级！Lv.${p.levelBefore} → Lv.${p.levelAfter}`, 'chapter');
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
          if (res.fresh) dialogue.showBanner(`成就解锁：${res.def.name}`, 'tip');
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
        dialogue.showBanner(`成就解锁：${r.def.name}`, 'tip');
        console.info(`[starter] achievement unlocked: ${r.id}（${r.def.name}）`);
      }
    } catch (err) {
      console.warn('[starter] achievement check failed:', err instanceof Error ? err.message : err);
    }
  }
  // 每条文本推进后判定：覆盖 @set/@mod 改变量后的剧情节奏（变量在文本行之间变化）
  bus.on('text', () => { if (!rollbackRuntime.isRestoring()) checkAchievements(); });

  // ===== 标题画面：开始/读档/鉴赏/设置/退出 =====
  /** 标题画面显示中（右键系统菜单守卫用；showTitleScreen 置真，开局/读档进入游戏置假） */
  function showTitleScreen(): void {
    uiSession.reset('title');
    clearRollback();
    // 标题页不是暂停菜单：冻结解释器并清空上一轮投影，避免隐藏剧情继续响应输入。
    interp.pauseHost();
    presentation.clear();
    // 保留背景/立绘资源，方便从标题页读取存档后继续投影；开始新游戏时再做全量清理。
    runtime.resetSession({ preserveWorld: true });
    menu.showTitle(
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
  async function titleSelect(id: string): Promise<void> {
    switch (id) {
      case 'new': {
        uiSession.enterGame();
        clearRollback();
        runtime.resetSession();
        presentation.clear();
        menu.hideTitle();
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
        if (uiSnapshot().overlay === 'none') uiSession.openOverlay('gallery');
        openGallery();
        break;
      case 'settings':
        if (uiSnapshot().overlay === 'none') uiSession.openOverlay('settings');
        refreshSettingsPanel();
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
      label: 'starter',
      sceneFiles,
      resolveSceneUrl: (path) => new URL(path, import.meta.url).href,
    });
  }

  // ===== 存档/读档 UI：多槽位 + 快速/自动档 =====
  const SLOT_IDS = ['1', '2', '3', '4', '5', '6', QUICK_SLOT, AUTO_SLOT];
  async function openSaveLoad(mode: 'save' | 'load'): Promise<void> {
    if (uiSnapshot().overlay === 'none') uiSession.openOverlay('save-load');
    let metas: Awaited<ReturnType<typeof saves.list>>;
    try {
      metas = await saves.list();
    } catch (err) {
      if (isOverlay('save-load')) uiSession.closeOverlay();
      console.error('[starter] 存档列表读取失败:', err);
      refreshCommandRail();
      return;
    }
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
    menu.showSaveLoad({ mode, slots }, async (slotId) => {
      inputGate.consumeCurrentPointer();
      if (mode === 'save') {
        const snap = interp.saveSnapshot();
        if (!snap) {
          console.warn('[starter] 存档失败：游戏尚未开始');
          return false;
        }
        const origin = uiSnapshot();
        uiSession.beginOperation('saving');
        try {
          await saves.save(slotId, enrichSnapshot(snap));
          uiSession.completeOperation({
            base: origin.base,
            overlay: 'none',
            interfaceHidden: origin.interfaceHidden,
            videoActive: origin.videoActive,
          });
          console.info('[starter] 已存档', slotId);
          refreshCommandRail();
          return true;
        } catch (err) {
          uiSession.failOperation();
          console.error('[starter] 存档失败:', err);
          return false;
        }
      } else {
        uiSession.beginOperation('loading');
        try {
          const snap = await saves.load(slotId);
          uiSession.completeOperation({ base: 'game', overlay: 'none' });
          menu.hideTitle();
          clearRollback();
          interp.loadSnapshot(snap);
          clearCountedThisSession = false; // 读档 = 进入另一周目会话
          console.info('[starter] 已读档', slotId);
          refreshCommandRail();
          return true;
        } catch (err) {
          uiSession.failOperation();
          console.error('[starter] 读档失败:', err);
          return false;
        }
      }
    }, () => {
      if (isOverlay('save-load') && !isUiBusy()) {
        uiSession.closeOverlay();
        restoreCommandRailForPlayerContext();
      }
    }, { completion: 'host-transaction', onTransactionComplete: restoreCommandRailForPlayerContext });
  }

  // ===== 系统菜单：Esc / 右键唤出 =====
  function openSystemMenu(): void {
    if (isTitleScreen() || uiSnapshot().overlay !== 'none' || isUiBusy()) return;
    uiSession.openOverlay('system-menu');
    menu.showSystemMenu(
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
        if (isOverlay('system-menu')) uiSession.closeOverlay();
        switch (id) {
          case 'save': void openSaveLoad('save'); break;
          case 'load': void openSaveLoad('load'); break;
          case 'settings': uiSession.openOverlay('settings'); refreshSettingsPanel(); break;
          case 'backlog': uiSession.openOverlay('backlog'); renderer.dispatchInput({ type: 'backlog.toggle' }); break;
          case 'gallery': openGallery(); break;
          case 'title': showTitleScreen(); break;
          default: break; // resume：仅关闭菜单
        }
        refreshCommandRail();
      },
      () => { if (isOverlay('system-menu')) uiSession.closeOverlay(); },
    );
  }

  let quickSaveInFlight: Promise<boolean> | null = null;

  function quickSave(): Promise<boolean> {
    // 快速读档必须等当前 IPC 写入完成，否则连续 F5/F9 会读到旧槽位。
    if (quickSaveInFlight || isUiBusy()) return quickSaveInFlight ?? Promise.resolve(false);
    const snap = interp.saveSnapshot();
    if (!snap) return Promise.resolve(false);
    const origin = uiSnapshot();
    const railWasVisible = queries.diagnostics.projectionSnapshot().dialogue?.commandRailVisible === true;
    uiSession.beginOperation('saving');
    if (railWasVisible) dialogue.hideCommandRail();
    const task = saves.save(QUICK_SLOT, enrichSnapshot({ ...snap, kind: 'quick' })).then(
      () => {
        uiSession.completeOperation({
          base: origin.base,
          overlay: origin.overlay,
          interfaceHidden: origin.interfaceHidden,
          videoActive: origin.videoActive,
        });
        if (railWasVisible) dialogue.restoreCommandRail();
        console.info('[starter] 快速存档');
        return true;
      },
      (err) => {
        uiSession.failOperation();
        if (railWasVisible) dialogue.restoreCommandRail();
        console.error('[starter] 快速存档失败：', err);
        return false;
      },
    );
    quickSaveInFlight = task;
    void task.then(() => {
      if (quickSaveInFlight === task) quickSaveInFlight = null;
    });
    return task;
  }

  async function quickLoad(): Promise<boolean> {
    if (quickSaveInFlight) await quickSaveInFlight;
    try {
      if (!await saves.has(QUICK_SLOT)) return false;
    } catch (err) {
      console.error('[starter] 快速读档槽位读取失败：', err);
      return false;
    }
    if (isUiBusy()) return false;
    const origin = uiSnapshot();
    const railWasVisible = queries.diagnostics.projectionSnapshot().dialogue?.commandRailVisible === true;
    uiSession.beginOperation('loading');
    if (railWasVisible) dialogue.hideCommandRail();
    try {
      const snap = await saves.load(QUICK_SLOT);
      clearRollback();
      interp.loadSnapshot(snap);
      uiSession.completeOperation({
        base: origin.base,
        overlay: origin.overlay,
        interfaceHidden: origin.interfaceHidden,
        videoActive: origin.videoActive,
      });
      if (railWasVisible) dialogue.restoreCommandRail();
      clearCountedThisSession = false;
      console.info('[starter] 快速读档');
      return true;
    } catch (err) {
      uiSession.failOperation();
      if (railWasVisible) dialogue.restoreCommandRail();
      console.error('[starter] 快速读档失败：', err);
      return false;
    }
  }


  // ===== 鉴赏（回想）：CG 回看 + 音乐播放；解锁状态来自 GalleryState（随存档持久化） =====
  function openGallery(): void {
    if (uiSnapshot().overlay === 'none') uiSession.openOverlay('gallery');
    const views = buildGalleryViews(galleryConfig as GalleryConfig, interp.gallery.snapshot());
    gallery.showGallery({
      ...views,
      onPlayMusic: (id, src) => audio.playBgm(src ?? id),
      onReplayText: (item) => {
        // 文本回想：关闭鉴赏，跳回回想场景重播（hostJump 清空调用栈）
        if (!item.scene) return;
        gallery.hideGallery();
        if (isOverlay('gallery')) uiSession.closeOverlay();
        interp.hostJump(item.scene, item.label);
      },
      onClose: () => { if (isOverlay('gallery')) uiSession.closeOverlay(); },
    });
  }

  // ===== 设置图形面板：◀ ▶ 步进（状态由 SettingsStore 持有，改后重新投影并刷新面板） =====
  function refreshSettingsPanel(): void {
    const s = settings.settings;
    menu.showSettings(
      SETTING_STEPS.map((d) => ({ id: d.key, label: d.label, display: d.format(s[d.key]) })),
      (id, dir) => {
        const next = stepSetting(settings.settings, id as NumericSettingKey, dir);
        void settings.update({ [id]: next[id as keyof GameSettings] } as Partial<GameSettings>).then(() => {
          // 改值立即投影生效（打字速度/音量/自动停留），并刷新面板展示
          settings.apply(typewriter, audio);
          renderer.setAutoWait(settings.settings.autoBaseDelayMs, settings.settings.autoPerCharMs);
          if (isOverlay('settings')) refreshSettingsPanel();
        });
      },
      () => {
        if (isOverlay('settings')) uiSession.closeOverlay();
      },
    );
  }

  /** 画面内操作带：动作仍复用既有键盘/系统菜单语义。 */
  function refreshCommandRail(): void {
    dialogue.setCommandRailItems([
      { id: 'auto', icon: 'A', label: '自动', active: renderer.autoPlay, tooltip: '自动播放' },
      { id: 'skip', icon: '»', label: '快进', active: renderer.skipMode, tooltip: '快进已读文本' },
      { id: 'backlog', icon: '▤', label: '记录', active: renderer.backlogOpen, tooltip: '打开文字记录' },
      { id: 'qsave', icon: 'S', label: '快存', tooltip: '快速存档' },
      { id: 'qload', icon: 'L', label: '快读', tooltip: '快速读档' },
      { id: 'rollback', icon: '↶', label: '回退', enabled: canRollback(), tooltip: '回到上一条文本' },
      { id: 'settings', icon: '⚙', label: '设置', active: isOverlay('settings'), tooltip: '打开设置' },
      { id: 'hide', icon: '□', label: '界面', active: renderer.interfaceHidden, tooltip: '隐藏界面' },
      { id: 'menu', icon: '≡', label: '菜单', tooltip: '打开系统菜单' },
    ]);
  }

  function onCommandRailSelect(id: string): void {
    switch (id) {
      case 'auto': renderer.dispatchInput({ type: 'auto.toggle' }); break;
      case 'skip': {
        renderer.dispatchInput({
          type: 'skip.toggle',
          scope: settings.settings.skipStrategy >= SKIP_STRATEGY_ALL ? 'all' : 'read',
        });
        break;
      }
      case 'backlog': renderer.dispatchInput({ type: 'backlog.toggle' }); break;
      case 'qsave': quickSave(); break;
      case 'qload': void quickLoad(); break;
      case 'rollback': performRollback(); break;
      case 'settings':
        if (isOverlay('settings')) {
          menu.hideSettings();
          uiSession.closeOverlay();
        } else if (uiSnapshot().overlay === 'none') {
          uiSession.openOverlay('settings');
          refreshSettingsPanel();
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
          if (!renderer.skipMode) renderer.dispatchInput({ type: 'skip.toggle', scope: 'read' });
          refreshCommandRail();
          break;
        case 'shoulderLeft':
          if (renderer.skipMode) renderer.dispatchInput({ type: 'skip.toggle', scope: 'read' });
          refreshCommandRail();
          break;
        default:
          break;
      }
    }
  });
  gamepad.start();

  const ownerTeardown = createStarterOwnerTeardown({
    runtime,
    audioManager,
    gamepad,
    fontBlobUrls,
    assetBlobUrls,
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  });
  ownerTeardown.trackListener(() => window.removeEventListener('resize', resizeHandler));
  ownerTeardown.trackListener(() => runtime.canvas.removeEventListener('pointerdown', canvasPointerDown));
  ownerTeardown.trackListener(() => runtime.canvas.removeEventListener('wheel', canvasWheel, canvasWheelOptions));
  ownerTeardown.trackListener(() => runtime.canvas.removeEventListener('contextmenu', canvasContextMenu));
  const beforeUnloadHandler = (): void => { ownerTeardown.dispose(); };
  window.addEventListener('beforeunload', beforeUnloadHandler);
  ownerTeardown.trackListener(() => window.removeEventListener('beforeunload', beforeUnloadHandler));

  // Ctrl 按住临时快进（松开恢复）
  let ctrlTempSkip = false;
  const ctrlKeyDown = (e: KeyboardEvent): void => {
    if (isTitleScreen()) return;
    if (e.key === 'Control' && !renderer.skipMode) {
      ctrlTempSkip = true;
      renderer.dispatchInput({ type: 'skip.toggle', scope: 'read' });
      refreshCommandRail();
    }
  };
  window.addEventListener('keydown', ctrlKeyDown);
  ownerTeardown.trackListener(() => window.removeEventListener('keydown', ctrlKeyDown));
  const ctrlKeyUp = (e: KeyboardEvent): void => {
    if (isTitleScreen()) return;
    if (e.key === 'Control' && ctrlTempSkip) {
      ctrlTempSkip = false;
      renderer.dispatchInput({ type: 'skip.toggle', scope: 'read' });
      refreshCommandRail();
    }
  };
  window.addEventListener('keyup', ctrlKeyUp);
  ownerTeardown.trackListener(() => window.removeEventListener('keyup', ctrlKeyUp));

  function routeGameAction(action: GameAction): void {
    if (action === 'advance') {
      const st = interp.status;
      if (st === 'awaiting-advance' || st === 'awaiting-timer' || renderer.status === 'choice') {
        renderer.dispatchInput({ type: 'advance' });
      }
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
  const keyboardHandler = (e: KeyboardEvent): void => {
    if (isTitleScreen()) return;
    if (renderer.backlogOpen) {
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
        if (!renderer.handleBacklogEscape()) renderer.dispatchInput({ type: 'backlog.toggle' });
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
    if (renderer.backlogOpen && (e.key === 'PageUp' || e.key === 'PageDown')) {
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
      console.info('[starter] 自动播放', renderer.dispatchInput({ type: 'auto.toggle' }) ? '开' : '关');
      refreshCommandRail();
    } else if (e.key === 's' || e.key === 'S') {
      // 快进策略跟随设置：仅跳已读（默认，遇未读即停）或全部跳过（一路到底）
      if (settings.settings.skipStrategy >= SKIP_STRATEGY_ALL) {
        console.info('[starter] 快进（全部跳过·设置）', renderer.dispatchInput({ type: 'skip.toggle', scope: 'all' }) ? '开' : '关');
      } else {
        console.info('[starter] 快进（已读跳过·设置）', renderer.dispatchInput({ type: 'skip.toggle', scope: 'read' }) ? '开' : '关');
      }
      refreshCommandRail();
    } else if (e.key === 'x' || e.key === 'X') {
      console.info('[starter] 快进（全部跳过）', renderer.dispatchInput({ type: 'skip.toggle', scope: 'all' }) ? '开' : '关');
      refreshCommandRail();
    } else if (e.key === 'l' || e.key === 'L') {
      // Backlog（文字记录）：覆盖层展示近期文本历史（点击任意处关闭）
      console.info('[starter] 文字记录', renderer.dispatchInput({ type: 'backlog.toggle' }) ? '开' : '关');
      refreshCommandRail();
    } else if (e.key === 'h' || e.key === 'H') {
      // 隐藏对话界面（galgame 惯例：赏画用；再按恢复）
      console.info('[starter] 隐藏界面', renderer.dispatchInput({ type: 'interface.toggle' }) ? '开' : '关');
      refreshCommandRail();
    } else if (e.key === 'g' || e.key === 'G') {
      // 鉴赏（回想）：CG 全屏回看 / 音乐播放；未解锁条目显示 ???
      if (isOverlay('gallery')) {
        gallery.hideGallery();
        uiSession.closeOverlay();
      } else {
        openGallery();
      }
      console.info('[starter] 鉴赏', isOverlay('gallery') ? '开' : '关');
    } else if (e.key === 'o' || e.key === 'O') {
      // 设置图形面板：◀ ▶ 步进各设置项（即时持久化并投影生效）
      if (isOverlay('settings')) {
        menu.hideSettings();
        uiSession.closeOverlay();
      } else {
        uiSession.openOverlay('settings');
        refreshSettingsPanel();
      }
      console.info('[starter] 设置面板', isOverlay('settings') ? '开' : '关');
      refreshCommandRail();
    } else if (e.key === '[' || e.key === ']') {
      // 文本速度调整（即时持久化）：[ 减速 / ] 加速
      const next = Math.max(1, Math.min(200, settings.settings.textSpeedCps + (e.key === ']' ? 6 : -6)));
      void settings.update({ textSpeedCps: next }).then(() => {
        renderer.setTextSpeed(next);
        console.info('[starter] 文本速度', next);
      });
    }
  };
  window.addEventListener('keydown', keyboardHandler);
  ownerTeardown.trackListener(() => window.removeEventListener('keydown', keyboardHandler));

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
  const errorHandler = (e: ErrorEvent): void => {
    showFatal(e.message || String(e.error));
    void window.surdetApp?.log('error', e.message || String(e.error));
    void window.surdetApp?.reportError('renderer-error', e.message || String(e.error));
  };
  window.addEventListener('error', errorHandler);
  ownerTeardown.trackListener(() => window.removeEventListener('error', errorHandler));
  const unhandledRejectionHandler = (e: PromiseRejectionEvent): void => {
    const message = e.reason instanceof Error ? e.reason.message : String(e.reason);
    showFatal(message);
    void window.surdetApp?.reportError('renderer-unhandled-rejection', message);
  };
  window.addEventListener('unhandledrejection', unhandledRejectionHandler);
  ownerTeardown.trackListener(() => window.removeEventListener('unhandledrejection', unhandledRejectionHandler));

  // 启动：加载素材 → 标题画面（不再直进剧情）
  await loadAssets();
  dialogue.showCommandRail([], onCommandRailSelect);
  refreshCommandRail();
  showTitleScreen();
  console.info(`[starter] started: ${registry.all().length} scenes, ${decls.length} variables`);
}

main().catch((err) => {
  console.error('[starter] 启动失败：', err);
});
