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
  compileScene, EventBus, Interpreter, SceneRegistry, VariableStore,
  CalendarRunner, GrowthSystem, AchievementSystem, AffectionSystem, EventScheduler,
} from '@surdet/core';
import type {
  CoreEventMap, VarDeclaration, SaveSnapshot,
  CalendarConfig, GrowthConfig, AchievementDef, AffectionProfile, RelationshipEvent, ScheduledEventDef,
} from '@surdet/core';
import { AdvRenderer, Backlog, PixiStage, Typewriter, buildMapView } from '@surdet/renderer';

interface SceneSrc { id: string; text: string }

/** 预览配置集（编辑器管理的四套；缺省/非法形状按无配置降级占位横幅） */
interface PreviewConfigs {
  calendar?: unknown;
  events?: unknown;
  growth?: unknown;
  achievements?: unknown;
}

interface LoadPayload {
  sceneId: string;
  scenes: SceneSrc[];
  /** game.config.json 变量声明（父窗口提取后下发；缺省按空表） */
  variables?: Record<string, unknown>[];
  /** 编辑器内存中的配置 JSON（轻宿主系统用） */
  configs?: PreviewConfigs;
  /** 项目内嵌字体（宿主从项目目录读取后下发；缺省回退系统字体） */
  font?: { buffer: ArrayBuffer; mime: string };
  startLabel?: string;
  fast?: boolean;
}

/** 快进速度：每秒 1000 字（近似瞬时）；常规 30 字/秒 */
const FAST_CPS = 1000;
const NORMAL_CPS = 30;

let stage: PixiStage | null = null;
let renderer: AdvRenderer | null = null;
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
/** 已应用字体的识别键与 Blob URL（同字体重复 load 不重复注册；换字体时回收旧 URL） */
let appliedFontKey = '';
let appliedFontUrl: string | null = null;

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

async function boot(): Promise<void> {
  stage = new PixiStage();
  await stage.init();
  const root = document.getElementById('preview-root');
  if (root) root.appendChild(stage.app!.canvas);
  bus = new EventBus<CoreEventMap>();
  renderer = new AdvRenderer(stage, undefined, {
    typewriter: new Typewriter({ charsPerSecond: FAST_CPS }),
    backlog: new Backlog(),
    onAdvance: () => guardRun(() => interp?.advance()),
    onSelect: (i) => guardRun(() => interp?.choose(i)),
    onWaitEnd: () => guardRun(() => interp?.finishWait()),
  });
  renderer.subscribe(bus);
  // 帧驱动 + 输入接线（宿主模板标准两行；此前遗漏导致打字机永不推进、点击无响应）
  stage.app!.ticker.add((ticker) => renderer?.update(ticker.deltaMS));
  stage.app!.canvas.addEventListener('pointerdown', () => {
    const s = interp?.status;
    if (s === 'awaiting-advance' || s === 'awaiting-timer') renderer?.advance();
  });
  // 键盘推进（Space/Enter，对齐 starter 键位习惯）
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const s = interp?.status;
      if (s === 'awaiting-advance' || s === 'awaiting-timer') renderer?.advance();
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

async function load(p: LoadPayload): Promise<void> {
  if (!bus || !stage) return;
  clearError();
  try {
    // 字体下发应用（宿主读项目内嵌字体 → ArrayBuffer 下发）：先于剧情启动，首帧即用正确字体
    if (p.font) {
      const key = `${p.font.buffer.byteLength}|${p.font.mime}`;
      if (key !== appliedFontKey) {
        if (appliedFontUrl) URL.revokeObjectURL(appliedFontUrl);
        appliedFontUrl = URL.createObjectURL(new Blob([p.font.buffer as unknown as BlobPart], { type: p.font.mime }));
        await stage.registerFont(appliedFontUrl);
        appliedFontKey = key;
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
    interp = new Interpreter(vs, bus!, reg, undefined, undefined, {}, undefined, growth);
    turnResumeSnap = null;
    if (typeof p.fast === 'boolean') renderer?.setTextSpeed(p.fast ? FAST_CPS : NORMAL_CPS);
    interp.start(p.sceneId, p.startLabel);
  } catch (err) {
    showError(`预览失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string; payload?: LoadPayload; fast?: boolean } | null;
  if (!d || typeof d.type !== 'string') return;
  if (d.type === 'surdet-preview-load' && d.payload) void load(d.payload);
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
