/**
 * 预览运行器（M6 E4）：iframe 内嵌精简 runner —— core 编译 + Interpreter + AdvRenderer + PixiStage。
 * 预览源 = 编辑器内存中的剧本文本（未保存也能预览，postMessage 传入）；
 * 全量场景注册进 SceneRegistry，跨场景 @jump 在预览内可正常跳转（多场景预览）。
 *
 * 轻宿主（B 增量）：编辑器管理的四套配置（calendar/events/growth/achievements）一并下发，
 * 预览内实例化对应系统——日历地图可交互走格、@exp 升级横幅、成就解锁横幅、好感事件消耗；
 * battle/shop/ngp 的配置不在编辑器管理范围，@battle/@shop 仍走占位横幅（诚实提示）。
 *
 * postMessage 协议（父窗口 → 预览）：
 *  { type: 'surdet-preview-load', payload: { sceneId, scenes, variables?, configs?, startLabel?, fast? } } → 编译并播放
 *  { type: 'surdet-preview-fast', fast: boolean }                                  → 切换打字速度
 * 预览就绪后向父窗口回 { type: 'surdet-preview-ready' }。
 *
 * system 类指令无宿主部分（@battle/@calendar 缺配置等）：解释器直接穿透，
 * 预览侧显示"宿主指令占位"横幅并继续（预览不实例化战斗/商店/周目宿主）。
 */
import {
  compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, SaveManager, QUICK_SLOT, AUTO_SLOT,
  TimelineRegistry,
  CalendarRunner, GrowthSystem, AchievementSystem, AffectionSystem, EventScheduler,
} from '@surdet/core';
import type {
  CoreEventMap, VarDeclaration, SaveSnapshot,
  SaveStorage, SystemSnapshots,
  CalendarConfig, GrowthConfig, AchievementDef, AffectionProfile, RelationshipEvent, ScheduledEventDef,
} from '@surdet/core';
import {
  AdvRenderer, AudioManager, Backlog, PixiStage, Typewriter, FrameScheduler, RenderPerformanceMonitor, buildMapView,
  SettingsStore, SETTING_STEPS, stepSetting,
} from '@surdet/renderer';
import type { AudioHandle, FontRole, GameSettings, SaveSlotView, SettingsStorage, SpeakerProfile } from '@surdet/renderer';
import { PreviewGeneration, type PreviewDiagnostic } from './preview-diagnostics.js';

interface SceneSrc { id: string; text: string }

interface PreviewImage {
  buffer: ArrayBuffer;
  mime: string;
}

interface PreviewAssets {
  backgrounds: { key: string; image: PreviewImage }[];
  portraits: { charId: string; costume: string; expression: string; image: PreviewImage }[];
  avatars: { key: string; image: PreviewImage }[];
  audio: { kind: 'bgm' | 'se' | 'voice'; key: string; file: PreviewImage }[];
}

/** 预览配置集（编辑器管理的四套；缺省/非法形状按无配置降级占位横幅） */
interface PreviewConfigs {
  calendar?: unknown;
  events?: unknown;
  growth?: unknown;
  achievements?: unknown;
}

interface LoadPayload {
  sceneId: string;
  /** 预览存档隔离键（通常为编辑器当前项目目录名） */
  projectKey?: string;
  scenes: SceneSrc[];
  speakerProfiles?: SpeakerProfile[];
  /** game.config.json 变量声明（父窗口提取后下发；缺省按空表） */
  variables?: Record<string, unknown>[];
  /** 编辑器内存中的配置 JSON（轻宿主系统用） */
  configs?: PreviewConfigs;
  /** 旧版单字体协议（保留兼容） */
  font?: { buffer: ArrayBuffer; mime: string; version?: string };
  /** 项目内嵌字体按角色下发；缺失角色独立回退。 */
  fonts?: Partial<Record<FontRole, { buffer: ArrayBuffer; mime: string; version?: string }>>;
  /** 编辑器从项目目录读取的真实背景/立绘素材 */
  assets?: PreviewAssets;
  /** 编辑器项目的时间轴定义；旧协议缺省为空。 */
  timelines?: unknown[];
  /** 编辑器时间轴面板的直演模式：临时场景仅播放目标 timeline。 */
  timelinePreviewId?: string;
  startLabel?: string;
  fast?: boolean;
}

/** 快进速度：每秒 1000 字（近似瞬时）；常规 30 字/秒 */
const FAST_CPS = 1000;
const NORMAL_CPS = 30;

let stage: PixiStage | null = null;
let renderer: AdvRenderer | null = null;
let frameScheduler: FrameScheduler | null = null;
let bus: EventBus<CoreEventMap> | null = null;
let interp: Interpreter | null = null;
/** 当前预览会话的变量仓库与场景注册表（供 system 事件回调使用；每次 load 重建） */
let store: VariableStore | null = null;
let registry: SceneRegistry | null = null;

/** 轻宿主系统实例（每次 load 按 configs 重建；null = 未配置，走占位横幅） */
let calendar: CalendarRunner | null = null;
let growth: GrowthSystem | null = null;
let achievements: AchievementSystem | null = null;
let affection: AffectionSystem | null = null;
let scheduler: EventScheduler | null = null;
/** 回合尾事件演出前的挂起点快照（演出场景播完经 sceneEnd 恢复续跑；同 starter 语义） */
let turnResumeSnap: SaveSnapshot | null = null;
/** 当前预览存档隔离键与会话起始时间（load 在模块级串行队列中执行）。 */
let previewProjectKey = 'untitled';
let sessionStart = Date.now();
let systemMenuOpen = false;
let saveLoadOpen = false;
let settingsOpen = false;
/** 已应用字体的识别键与 Blob URL（同字体重复 load 不重复注册；换字体时按角色回收旧 URL） */
const appliedFontKeys: Partial<Record<FontRole, string>> = {};
const appliedFontUrls: Partial<Record<FontRole, string>> = {};
let appliedAssetUrls: string[] = [];
const previewGeneration = new PreviewGeneration();

function postPreviewDiagnostic(diagnostic: PreviewDiagnostic): void {
  window.parent.postMessage({ type: 'surdet-preview-diagnostic', diagnostic }, '*');
}

function releaseAppliedFontUrls(): void {
  for (const role of ['title', 'body', 'ui'] as FontRole[]) {
    const url = appliedFontUrls[role];
    if (url) URL.revokeObjectURL(url);
    delete appliedFontUrls[role];
    delete appliedFontKeys[role];
  }
}

/** 预览音频宿主：与 starter 同用 AudioManager，只把项目 key 解析到 iframe 内的 Blob URL。 */
class PreviewAudio implements AudioHandle {
  #inner = new AudioManager();
  #urls = new Map<string, string>();

  setUrls(entries: readonly { kind: 'bgm' | 'se' | 'voice'; key: string; url: string; format?: string }[]): void {
    this.#urls.clear();
    for (const e of entries) {
      this.#urls.set(`${e.kind}:${e.key}`, e.url);
      if (e.format) this.#inner.setSourceFormat(e.url, e.format);
    }
  }

  dispose(): void {
    this.#inner.dispose();
  }

  #resolve(kind: 'bgm' | 'se' | 'voice', src: string): string {
    return this.#urls.get(`${kind}:${src}`) ?? src;
  }

  playBgm(src: string | null): void { this.#inner.playBgm(src === null ? null : this.#resolve('bgm', src)); }
  playSe(src: string): void { this.#inner.playSe(this.#resolve('se', src)); }
  playVoice(src: string): void { this.#inner.playVoice(this.#resolve('voice', src)); }
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

const previewAudio = new PreviewAudio();

function showError(msg: string): void {
  const root = document.getElementById('preview-root');
  if (!root) return;
  let el = document.getElementById('preview-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'preview-error';
    root.appendChild(el);
  }
  el.textContent = msg;
  postPreviewDiagnostic({ generation: previewGeneration.current, level: 'error', phase: 'runtime', message: msg });
}

function clearError(): void {
  document.getElementById('preview-error')?.remove();
}

/** 解释器推进守卫：运行时错误（变量未定义等）可见化，不静默卡死 */
function guardRun(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    showError(`预览运行时错误：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 形状容错构造（配置来自用户可编辑 JSON：非法形状按无配置处理，不炸预览） */
function tryBuild<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 预览设置独立于 starter，避免编辑器预览调整音量/速度意外覆盖已安装游戏设置。 */
function makePreviewSettingsStorage(): SettingsStorage {
  const key = 'surdet:preview:settings';
  return {
    load: () => {
      try {
        const raw = browserStorage()?.getItem(key);
        return raw ? JSON.parse(raw) as Partial<GameSettings> : null;
      } catch {
        return null;
      }
    },
    save: (settings) => {
      try {
        browserStorage()?.setItem(key, JSON.stringify(settings));
      } catch {
        // 隐私模式/禁用存储时设置仍在本次预览内生效，只是不持久化。
      }
    },
  };
}

/** 预览存档按项目名隔离；项目切换后同一编辑器不会显示另一项目的槽位。 */
function makePreviewSaveStorage(getProjectKey: () => string): SaveStorage {
  const prefix = (): string => `surdet:preview:save:${encodeURIComponent(getProjectKey() || 'untitled')}:`;
  return {
    read: (slot) => {
      try {
        const raw = browserStorage()?.getItem(`${prefix()}${slot}`);
        return raw ? JSON.parse(raw) as SaveSnapshot : null;
      } catch {
        return null;
      }
    },
    write: (slot, data) => {
      try {
        browserStorage()?.setItem(`${prefix()}${slot}`, JSON.stringify(data));
      } catch (err) {
        console.warn('[preview] 存档写入失败：', err);
      }
    },
    delete: (slot) => {
      try {
        browserStorage()?.removeItem(`${prefix()}${slot}`);
      } catch {
        // 存储不可用时删除视为无操作。
      }
    },
    list: () => {
      const storage = browserStorage();
      if (!storage) return [];
      const base = prefix();
      try {
        return Object.keys(storage)
          .filter((key) => key.startsWith(base))
          .map((key) => key.slice(base.length));
      } catch {
        return [];
      }
    },
  };
}

async function boot(): Promise<void> {
  stage = new PixiStage();
  await stage.init();
  const root = document.getElementById('preview-root');
  if (root) root.appendChild(stage.app!.canvas);
  stage.fitWindow();
  window.addEventListener('resize', () => stage?.fitWindow());
  bus = new EventBus<CoreEventMap>();
  const settings = new SettingsStore(makePreviewSettingsStorage());
  await settings.load();
  const typewriter = new Typewriter({ charsPerSecond: settings.settings.textSpeedCps });
  renderer = new AdvRenderer(stage, previewAudio, {
    typewriter,
    backlog: new Backlog(),
    autoBaseDelayMs: settings.settings.autoBaseDelayMs,
    autoPerCharMs: settings.settings.autoPerCharMs,
    onAdvance: () => guardRun(() => interp?.advance()),
    onSelect: (i) => guardRun(() => interp?.choose(i)),
    onWaitEnd: () => guardRun(() => interp?.finishWait()),
  });
  settings.apply(typewriter, previewAudio);
  renderer.subscribe(bus);
  const saves = new SaveManager(makePreviewSaveStorage(() => previewProjectKey));

  function enrichSnapshot(snap: SaveSnapshot): SaveSnapshot {
    const thumbnail = stage?.captureThumbnail();
    if (thumbnail) snap.meta.thumbnail = thumbnail;
    snap.meta.playTimeSec = Math.max(0, Math.round((Date.now() - sessionStart) / 1000));
    return snap;
  }

  bus.on('autosave', (snap) => {
    void saves.save(AUTO_SLOT, enrichSnapshot(snap)).catch((err) => {
      console.warn('[preview] 自动存档失败：', err instanceof Error ? err.message : String(err));
    });
  });
  bus.on('saveMismatch', (p) => {
    stage?.showBanner?.(`存档与当前剧本不一致：${p.sceneId}`, 'tip');
  });

  // 引擎帧调度：静态画面暂停 ticker，剧情事件/输入/舞台动画自动唤醒。
  frameScheduler = new FrameScheduler(stage.app!, renderer, [stage], { monitor: new RenderPerformanceMonitor() });

  const closeSystemMenu = (): void => {
    if (!systemMenuOpen) return;
    systemMenuOpen = false;
    stage?.hideSystemMenu();
  };

  const SLOT_IDS = ['1', '2', '3', '4', '5', '6', QUICK_SLOT, AUTO_SLOT];

  async function openSaveLoad(mode: 'save' | 'load'): Promise<void> {
    if (!stage || !interp) return;
    saveLoadOpen = true;
    const requestedProjectKey = previewProjectKey;
    const metas = await saves.list();
    if (requestedProjectKey !== previewProjectKey) return;
    const byId = new Map(metas.map((meta) => [meta.id, meta]));
    const slots: SaveSlotView[] = SLOT_IDS.map((id) => {
      const meta = byId.get(id);
      return {
        id,
        empty: !meta,
        label: meta?.chapter,
        updatedAt: meta?.updatedAt,
        thumbnail: meta?.thumbnail,
        playTimeSec: meta?.playTimeSec,
        kind: id === QUICK_SLOT ? 'quick' : id === AUTO_SLOT ? 'auto' : 'manual',
      };
    });
    stage.showSaveLoad({ mode, slots }, (slotId) => {
      saveLoadOpen = false;
      if (mode === 'save') {
        const snap = interp?.saveSnapshot(slotId === QUICK_SLOT ? 'quick' : slotId === AUTO_SLOT ? 'auto' : 'manual');
        if (!snap) {
          stage?.showBanner?.('当前没有可存档的剧情状态', 'tip');
          return;
        }
        void saves.save(slotId, enrichSnapshot(snap)).then(() => {
          stage?.showBanner?.(`已保存至槽位 ${slotId}`, 'tip');
        }).catch((err) => {
          showError(`预览存档失败：${err instanceof Error ? err.message : String(err)}`);
        });
        return;
      }
      void (async () => {
        try {
          const snap = await saves.load(slotId);
          interp?.loadSnapshot(snap);
        } catch (err) {
          showError(`预览读档失败：${err instanceof Error ? err.message : String(err)}`);
          void openSaveLoad('load');
        }
      })();
    }, () => {
      saveLoadOpen = false;
    });
  }

  function refreshSettingsPanel(): void {
    if (!stage) return;
    const current = settings.settings;
    stage.showSettings(
      SETTING_STEPS.map((def) => ({
        id: def.key,
        label: def.label,
        display: def.format(current[def.key]),
      })),
      (id, dir) => {
        const next = stepSetting(settings.settings, id as keyof GameSettings, dir);
        void settings.update({ [id]: next[id as keyof GameSettings] } as Partial<GameSettings>).then(() => {
          settings.apply(typewriter, previewAudio);
          renderer?.setAutoWait(settings.settings.autoBaseDelayMs, settings.settings.autoPerCharMs);
          if (settingsOpen) refreshSettingsPanel();
        }).catch((err) => {
          showError(`预览设置保存失败：${err instanceof Error ? err.message : String(err)}`);
        });
      },
      () => {
        settingsOpen = false;
      },
    );
    settingsOpen = true;
  }

  function openSettings(): void {
    refreshSettingsPanel();
    refreshCommandRail();
  }

  bus.on('stateReset', () => {
    // 读档后不允许旧的系统菜单/设置/存读档面板盖住恢复后的剧情画面。
    stage?.hideSaveLoad();
    stage?.hideSettings();
    stage?.hideSystemMenu();
    systemMenuOpen = false;
    saveLoadOpen = false;
    settingsOpen = false;
    turnResumeSnap = null;
    refreshCommandRail();
  });

  const openSystemMenu = (): void => {
    if (!stage || !renderer) return;
    const activeStage = stage;
    const activeRenderer = renderer;
    if (systemMenuOpen) {
      closeSystemMenu();
      return;
    }
    // Esc/右键在文字记录上再次操作时，先退出 Backlog，避免两个覆盖层同时可见。
    if (activeRenderer.backlogOpen) activeRenderer.toggleBacklog();
    systemMenuOpen = true;
    activeStage.showSystemMenu(
      [
        { id: 'resume', label: '返回游戏' },
        { id: 'save', label: '存档' },
        { id: 'load', label: '读档' },
        { id: 'settings', label: '设置' },
        { id: 'backlog', label: `文字记录${activeRenderer.backlogOpen ? '（开）' : ''}` },
        { id: 'auto', label: `自动播放${activeRenderer.autoPlay ? '（关）' : ''}` },
        { id: 'skip', label: `快进${activeRenderer.skipMode && !activeRenderer.skipAll ? '（关）' : ''}` },
        { id: 'skip-all', label: `全部快进${activeRenderer.skipAll ? '（关）' : ''}` },
        { id: 'hide', label: `隐藏界面${activeRenderer.interfaceHidden ? '（恢复）' : ''}` },
      ],
      (id) => {
        systemMenuOpen = false;
        switch (id) {
          case 'save': void openSaveLoad('save'); break;
          case 'load': void openSaveLoad('load'); break;
          case 'settings': openSettings(); break;
          case 'backlog': activeRenderer.toggleBacklog(); break;
          case 'auto': activeRenderer.toggleAuto(); break;
          case 'skip': activeRenderer.toggleSkip(); break;
          case 'skip-all': activeRenderer.toggleSkipAll(); break;
          case 'hide': activeRenderer.toggleHideInterface(); break;
          default: break; // resume：仅关闭菜单
        }
        refreshCommandRail();
      },
      () => {
        systemMenuOpen = false;
      },
    );
  };

  function refreshCommandRail(): void {
    if (!stage || !renderer) return;
    stage.setCommandRailItems?.([
      { id: 'auto', icon: 'A', label: '自动', active: renderer.autoPlay, tooltip: '自动播放' },
      { id: 'skip', icon: '»', label: '快进', active: renderer.skipMode, tooltip: '快进已读文本' },
      { id: 'backlog', icon: '▤', label: '记录', active: renderer.backlogOpen, tooltip: '打开文字记录' },
      { id: 'qsave', icon: 'S', label: '快存', tooltip: '快速存档' },
      { id: 'qload', icon: 'L', label: '快读', tooltip: '快速读档' },
      { id: 'settings', icon: '⚙', label: '设置', active: settingsOpen, tooltip: '打开设置' },
      { id: 'hide', icon: '□', label: '界面', active: renderer.interfaceHidden, tooltip: '隐藏界面' },
      { id: 'menu', icon: '≡', label: '菜单', tooltip: '打开系统菜单' },
    ]);
  }

  function onCommandRailSelect(id: string): void {
    if (!stage || !renderer) return;
    switch (id) {
      case 'auto': renderer.toggleAuto(); break;
      case 'skip':
        if (settings.settings.skipStrategy >= 1) renderer.toggleSkipAll();
        else renderer.toggleSkip();
        break;
      case 'backlog': renderer.toggleBacklog(); break;
      case 'qsave': {
        const snap = interp?.saveSnapshot('quick');
        if (snap) {
          void saves.save(QUICK_SLOT, enrichSnapshot(snap)).then(() => stage?.showBanner?.('快速存档已保存', 'tip'));
        }
        break;
      }
      case 'qload':
        void saves.load(QUICK_SLOT).then((snap) => interp?.loadSnapshot(snap)).catch((err) => {
          stage?.showBanner?.(`快速读档失败：${err instanceof Error ? err.message : String(err)}`, 'tip');
        });
        break;
      case 'settings':
        if (settingsOpen) {
          settingsOpen = false;
          stage.hideSettings();
        } else openSettings();
        break;
      case 'hide': renderer.toggleHideInterface(); break;
      case 'menu': openSystemMenu(); break;
      default: break;
    }
    refreshCommandRail();
  }

  stage.showCommandRail?.([], onCommandRailSelect);
  refreshCommandRail();

  // 画布覆盖层由 Pixi 处理点击；捕获阶段先拦住通用推进，避免菜单/Backlog
  // 关闭的同一个 pointer event 继续穿透到剧情推进逻辑。
  stage.app!.canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || systemMenuOpen || saveLoadOpen || settingsOpen || renderer?.backlogOpen) return;
    const s = interp?.status;
    if (s === 'awaiting-advance' || s === 'awaiting-timer') renderer?.advance();
  }, { capture: true });

  // Backlog 滚轮：由宿主统一路由，PageUp/PageDown 走同一投影接口。
  stage.app!.canvas.addEventListener('wheel', (e) => {
    if (!renderer?.backlogOpen || systemMenuOpen || saveLoadOpen || settingsOpen) return;
    e.preventDefault();
    stage?.scrollBacklog?.(e.deltaY > 0 ? 120 : -120);
  }, { passive: false });

  // 右键是现代 ADV 的系统菜单快捷入口；浏览器默认菜单必须阻止。
  stage.app!.canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (saveLoadOpen || settingsOpen) return;
    openSystemMenu();
  });

  let ctrlTempSkip = false;
  window.addEventListener('keydown', (e) => {
    if (!renderer) return;

    if (e.key === 'Control') {
      if (!ctrlTempSkip && !renderer.skipMode) {
        ctrlTempSkip = true;
        renderer.toggleSkip();
        refreshCommandRail();
      }
      return;
    }

    if (systemMenuOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSystemMenu();
      }
      return;
    }

    if (saveLoadOpen || settingsOpen) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (saveLoadOpen) {
          saveLoadOpen = false;
          stage?.hideSaveLoad();
        }
        if (settingsOpen) {
          settingsOpen = false;
          stage?.hideSettings();
        }
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (renderer.backlogOpen) renderer.toggleBacklog();
      else openSystemMenu();
      refreshCommandRail();
      return;
    }

    if (renderer.backlogOpen) {
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        renderer.toggleBacklog();
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        stage?.scrollBacklog?.(e.key === 'PageUp' ? -240 : 240);
      }
      return;
    }

    if (renderer.status === 'choice') {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.key === 'ArrowUp') renderer.choiceUp();
        else renderer.choiceDown();
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        renderer.selectChoiceAt(Number(e.key) - 1);
        return;
      }
    }

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (renderer.status === 'choice') renderer.choiceConfirm();
      else {
        const s = interp?.status;
        if (s === 'awaiting-advance' || s === 'awaiting-timer') renderer.advance();
      }
      return;
    }

    if (e.key === 'F5') {
      e.preventDefault();
      const snap = interp?.saveSnapshot('quick');
      if (snap) {
        void saves.save(QUICK_SLOT, enrichSnapshot(snap)).then(() => {
          stage?.showBanner?.('快速存档已保存', 'tip');
        }).catch((err) => {
          showError(`快速存档失败：${err instanceof Error ? err.message : String(err)}`);
        });
      } else {
        stage?.showBanner?.('当前没有可存档的剧情状态', 'tip');
      }
      return;
    }

    if (e.key === 'F9') {
      e.preventDefault();
      void saves.load(QUICK_SLOT).then((snap) => {
        interp?.loadSnapshot(snap);
      }).catch((err) => {
        stage?.showBanner?.(`快速读档失败：${err instanceof Error ? err.message : String(err)}`, 'tip');
      });
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'a': renderer.toggleAuto(); break;
      case 's':
        if (settings.settings.skipStrategy >= 1) renderer.toggleSkipAll();
        else renderer.toggleSkip();
        break;
      case 'x': renderer.toggleSkipAll(); break;
      case 'l': renderer.toggleBacklog(); break;
      case 'h': renderer.toggleHideInterface(); break;
      default: break;
    }
    refreshCommandRail();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && ctrlTempSkip) {
      ctrlTempSkip = false;
      renderer?.toggleSkip();
      refreshCommandRail();
    }
  });
  window.addEventListener('blur', () => {
    // 窗口切走时 Ctrl 可能收不到 keyup，避免临时快进永久卡住。
    if (ctrlTempSkip) {
      ctrlTempSkip = false;
      renderer?.toggleSkip();
    }
  });

  // ===== system 事件 → 轻宿主驱动（日历可交互；战斗/商店无配置走占位横幅） =====
  bus.on('system', (p) => {
    switch (p.type) {
      case 'calendar': {
        if (!calendar || !interp || !stage) {
          stage?.showBanner?.('[宿主指令占位] @calendar（预览未配置 calendar.json）', 'tip');
          return;
        }
        interp.pauseHost();
        const renderMap = (): void => {
          if (!calendar || !stage || !interp) return;
          const cal = calendar; // 局部固化：模块级变量在嵌套回调内不收窄
          const nodes = cal.visibleNodes().map((n) => ({
            id: n.id,
            name: n.name,
            x: n.x,
            y: n.y,
            apCost: n.apCost,
            isBase: n.isBase,
            visited: cal.hasVisited(n.id),
            enterable: cal.canEnter(n.id),
          }));
          stage.showMap(
            buildMapView({ turn: cal.turn, ap: cal.ap, maxAp: cal.maxAp, date: cal.date, nodes }),
            (nodeId) => {
              if (!calendar || !interp) return;
              const res = calendar.enter(nodeId);
              if (!res.ok) {
                renderMap();
                return;
              }
              // 节点事件场景（约定：场景 ID = eventId）存在则跳入演出；据点指令面板不在预览范围（轻宿主）
              if (res.eventId && registry?.has(res.eventId)) {
                interp.hostJump(res.eventId);
              } else {
                renderMap();
              }
            },
            () => {
              if (!calendar || !interp || !stage) return;
              // 回合尾：先结算回合，再调度优先级事件；演出场景经 sceneEnd 恢复续跑
              calendar.advanceTurn();
              const endEv = store ? scheduler?.dispatch(store) ?? null : null;
              if (endEv?.scene && registry?.has(endEv.scene)) {
                stage.hideMap();
                const snap = interp.saveSnapshot(); // 挂起点已越过 @calendar，恢复即续跑
                if (snap) {
                  turnResumeSnap = snap;
                  interp.hostJump(endEv.scene);
                  return;
                }
              }
              interp.resumeHost();
            },
          );
        };
        // 回合头事件：effects 结算（演出留给回合尾，同 starter 语义）
        if (scheduler && store) scheduler.dispatch(store);
        renderMap();
        break;
      }
      case 'achievement': {
        const mode = p.args[0];
        const id = p.args[1];
        if (achievements && mode === 'unlock' && id) {
          try {
            const res = achievements.unlock(id);
            if (res.fresh) stage?.showBanner?.(`成就解锁：${res.def.hidden ? '???' : res.def.name}`, 'tip');
          } catch { /* 成就 ID 不存在：预览静默跳过 */ }
        } else {
          stage?.showBanner?.('[宿主指令占位] @achievement（预览未配置 achievements.json）', 'tip');
        }
        break;
      }
      case 'affection': {
        if (!affection) {
          stage?.showBanner?.('[宿主指令占位] @affection（预览未配置 events.json）', 'tip');
          return;
        }
        const charId = p.args[0];
        const tier = charId ? affection.stageOf(charId)?.stage ?? null : null;
        stage?.showBanner?.(`好感演出：${charId ?? ''}（阶段 ${tier ?? '—'}）`, 'tip');
        break;
      }
      case 'event': {
        if (affection && p.args[0]) affection.consumeEvent(p.args[0]);
        break;
      }
      default:
        // @battle/@shop 等：配置不在编辑器管理范围，占位横幅（解释器已穿透不阻塞）
        stage?.showBanner?.(`[宿主指令占位] @${p.type}（预览模式穿透）`, 'tip');
    }
  });

  // @exp：成长结果横幅 + levelEvents 场景跳转（配置驱动；场景存在才跳）
  bus.on('growth', (p) => {
    if (p.levelsGained > 0) {
      stage?.showBanner?.(`${p.characterId} 升级！Lv.${p.levelBefore} → Lv.${p.levelAfter}`, 'chapter');
      if (growth) {
        for (const lv of p.passedLevels) {
          const scene = growth.levelEventFor(p.characterId, lv);
          if (scene && registry?.has(scene) && interp) {
            interp.hostJump(scene);
            break;
          }
        }
      }
    }
  });

  // 回合尾事件场景播完 → 恢复挂起点续跑（loadSnapshot 不可在事件回调内直调，延迟到下一 tick）
  bus.on('sceneEnd', () => {
    if (!turnResumeSnap || !interp) return;
    const snap = turnResumeSnap;
    turnResumeSnap = null;
    setTimeout(() => {
      try {
        interp?.loadSnapshot(snap);
      } catch (err) {
        showError(`预览恢复失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }, 0);
  });

  window.parent.postMessage({ type: 'surdet-preview-ready' }, '*');
}

async function releaseAppliedAssetUrls(): Promise<void> {
  previewAudio.stopAll();
  previewAudio.dispose();
  previewAudio.setUrls([]);
  await stage?.releaseRegisteredAssetSources();
  for (const url of appliedAssetUrls) URL.revokeObjectURL(url);
  appliedAssetUrls = [];
}

/** 注册本轮预览的图片并等待 Assets.load 完成，确保首个 @bg/@show 不会先落占位纹理。 */
async function applyPreviewAssets(assets: PreviewAssets | undefined): Promise<void> {
  await releaseAppliedAssetUrls();
  if (!assets || !stage) return;
  const urls: string[] = [];
  const audioEntries: { kind: 'bgm' | 'se' | 'voice'; key: string; url: string; format: string }[] = [];
  const register = async (buffer: ArrayBuffer, mime: string, fn: (url: string) => Promise<void>): Promise<void> => {
    const url = URL.createObjectURL(new Blob([buffer as unknown as BlobPart], { type: mime }));
    try {
      await fn(url);
      urls.push(url);
    } catch (err) {
      URL.revokeObjectURL(url);
      console.warn('[preview] 图片素材加载失败，回退占位：', err);
    }
  };
  for (const asset of assets.audio) {
    try {
      const url = URL.createObjectURL(new Blob([asset.file.buffer as unknown as BlobPart], { type: asset.file.mime }));
      audioEntries.push({ kind: asset.kind, key: asset.key, url, format: asset.file.mime });
      urls.push(url);
    } catch (err) {
      console.warn('[preview] 音频素材加载失败，回退 key：', err);
    }
  }
  previewAudio.setUrls(audioEntries);
  await Promise.all([
    ...assets.backgrounds.map((asset) => register(
      asset.image.buffer,
      asset.image.mime,
      (url) => stage!.registerBackground(asset.key, url, asset.image.mime),
    )),
    ...assets.portraits.map((asset) => register(
      asset.image.buffer,
      asset.image.mime,
      (url) => stage!.registerPortrait(asset.charId, asset.costume, asset.expression, url, asset.image.mime),
    )),
    ...(assets.avatars ?? []).map((asset) => register(
      asset.image.buffer,
      asset.image.mime,
      (url) => stage!.registerAvatar(asset.key, url, asset.image.mime),
    )),
  ]);
  appliedAssetUrls = urls;
}

async function load(p: LoadPayload): Promise<void> {
  if (!bus || !stage) return;
  const generation = previewGeneration.next();
  postPreviewDiagnostic({ generation, level: 'info', phase: 'reload', message: '预览正在重新加载…', sceneId: p.sceneId, ...(p.startLabel ? { label: p.startLabel } : {}) });
  clearError();
  try {
    previewProjectKey = p.projectKey?.trim() || 'untitled';
    sessionStart = Date.now();
    systemMenuOpen = false;
    saveLoadOpen = false;
    settingsOpen = false;
    stage.hideSystemMenu();
    stage.hideSaveLoad();
    stage.hideSettings();
    renderer?.resetSession({ clearAssets: true });
    stage.setSpeakerProfiles(p.speakerProfiles ?? []);
    // 新请求即使在编译/配置阶段失败，也不能让上一轮 BGM/语音继续播放。
    await releaseAppliedAssetUrls();
    // 字体下发应用：先于剧情启动。旧版 font 映射到三个角色，避免旧项目预览变样。
    const incomingFonts = p.fonts ?? (p.font ? { title: p.font, body: p.font, ui: p.font } : {});
    const roles: FontRole[] = ['body', 'title', 'ui'];
    const nextKeys = Object.fromEntries(roles.flatMap((role) => {
      const font = incomingFonts[role];
      return font ? [[role, `${font.buffer.byteLength}|${font.mime}|${font.version ?? ''}`]] : [];
    })) as Partial<Record<FontRole, string>>;
    const unchanged = roles.every((role) => nextKeys[role] === appliedFontKeys[role]);
    if (!unchanged) {
      releaseAppliedFontUrls();
      stage.resetFonts();
      for (const role of roles) {
        const font = incomingFonts[role];
        if (!font) continue;
        const url = URL.createObjectURL(new Blob([font.buffer as unknown as BlobPart], { type: font.mime }));
        const ok = await stage.registerFontRole(role, url);
        if (ok) {
          appliedFontUrls[role] = url;
          appliedFontKeys[role] = nextKeys[role];
        } else {
          URL.revokeObjectURL(url);
        }
      }
    }
    const reg = new SceneRegistry();
    // 全量场景编译入注册表（逐场景捕获错误，报出具体哪个场景编译失败）
    for (const s of p.scenes ?? []) {
      try {
        reg.register(compileScene(s.text, `${s.id}.gal`, s.id));
      } catch (err) {
        throw new Error(`场景 ${s.id} 编译失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!reg.has(p.sceneId)) {
      throw new Error(`入口场景 '${p.sceneId}' 不在预览场景集中`);
    }
    const timelines = new TimelineRegistry();
    for (const definition of p.timelines ?? []) {
      try {
        timelines.register(definition);
      } catch (err) {
        console.warn('[preview] 时间轴定义无效，已跳过：', err instanceof Error ? err.message : String(err));
      }
    }
    const timelinePreviewSceneId = '__surdet_timeline_preview__';
    const directTimelineId = p.timelinePreviewId?.trim();
    if (directTimelineId) {
      if (!timelines.has(directTimelineId)) throw new Error(`时间轴 '${directTimelineId}' 未加载或校验失败`);
      reg.register(compileScene(`@scene ${timelinePreviewSceneId}\n@timeline ${directTimelineId} @ blocking\n@end`, 'timeline-preview.gal', timelinePreviewSceneId));
    }
    // 变量表来自 game.config.json（父窗口下发）：真实剧本的 @set/@mod/@if 需要它
    const vs = new VariableStore((p.variables ?? []) as unknown as VarDeclaration[]);
    // 轻宿主系统按配置重建（构造注入 store；形状容错：非法配置按 null 走占位横幅）
    const cfg = p.configs ?? {};
    calendar = cfg.calendar ? tryBuild(() => new CalendarRunner(cfg.calendar as CalendarConfig, vs)) : null;
    growth = cfg.growth ? tryBuild(() => new GrowthSystem(cfg.growth as GrowthConfig, vs)) : null;
    achievements = cfg.achievements ? tryBuild(() => new AchievementSystem(cfg.achievements as AchievementDef[], vs)) : null;
    scheduler = cfg.events
      ? tryBuild(() => new EventScheduler(((cfg.events as Record<string, unknown>).scheduled ?? []) as ScheduledEventDef[], vs))
      : null;
    affection = cfg.events
      ? tryBuild(() => new AffectionSystem(
          ((cfg.events as Record<string, unknown>).profiles ?? []) as AffectionProfile[],
          ((cfg.events as Record<string, unknown>).events ?? []) as RelationshipEvent[],
          vs,
        ))
      : null;
    store = vs;
    registry = reg;
    await applyPreviewAssets(p.assets);
    postPreviewDiagnostic({ generation, level: 'info', phase: 'assets', message: '素材加载完成', sceneId: p.sceneId });
    interp = new Interpreter(vs, bus!, reg, undefined, undefined, {
      snapshot: (): SystemSnapshots => ({
        ...(calendar ? { calendar: calendar.snapshot() } : {}),
        ...(affection ? { affection: affection.snapshot() } : {}),
        ...(achievements ? { achievements: achievements.snapshot() } : {}),
        ...(scheduler ? { eventScheduler: scheduler.snapshot() } : {}),
      }),
      restore: (snap: SystemSnapshots): void => {
        if (snap.calendar && calendar) calendar.restore(snap.calendar);
        if (snap.affection && affection) affection.restore(snap.affection);
        if (snap.achievements && achievements) achievements.restore(snap.achievements);
        if (snap.eventScheduler && scheduler) scheduler.restore(snap.eventScheduler);
      },
    }, undefined, growth, timelines);
    interp.setPresentationHooks({
      snapshot: () => renderer?.snapshotPresentation() ?? null,
      restore: (payload) => renderer?.restorePresentation(payload),
    });
    turnResumeSnap = null;
    if (typeof p.fast === 'boolean') renderer?.setTextSpeed(p.fast ? FAST_CPS : NORMAL_CPS);
    interp.start(directTimelineId ? timelinePreviewSceneId : p.sceneId, directTimelineId ? undefined : p.startLabel);
    postPreviewDiagnostic({ generation, level: 'info', phase: 'compile', message: '预览已启动', sceneId: p.sceneId, ...(p.startLabel ? { label: p.startLabel } : {}) });
  } catch (err) {
    postPreviewDiagnostic({ generation, level: 'error', phase: 'compile', message: `预览失败：${err instanceof Error ? err.message : String(err)}`, sceneId: p.sceneId });
    showError(`预览失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

let loadQueue = Promise.resolve();

window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string; payload?: LoadPayload; fast?: boolean } | null;
  if (!d || typeof d.type !== 'string') return;
  if (d.type === 'surdet-preview-load' && d.payload) {
    // 点击“重载”期间串行化读盘、资源注册和解释器启动，避免旧请求晚到时污染新会话。
    loadQueue = loadQueue.then(() => load(d.payload!));
    void loadQueue;
  }
  if (d.type === 'surdet-preview-fast') renderer?.setTextSpeed(d.fast ? FAST_CPS : NORMAL_CPS);
});

// 调试探针（对齐 starter surdetDebug / 编辑器 surdetEditorDebug 惯例）：验收/自动化直接观察预览运行态
(window as unknown as Record<string, unknown>).surdetPreviewDebug = {
  get interp(): Interpreter | null { return interp; },
  get renderer(): AdvRenderer | null { return renderer; },
  get stage(): PixiStage | null { return stage; },
  get calendar(): CalendarRunner | null { return calendar; },
};

void boot();
