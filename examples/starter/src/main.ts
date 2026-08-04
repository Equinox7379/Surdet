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
} from '@surdet/core';
import type {
  VarDeclaration,
  SaveStorage,
  SaveSnapshot,
  SaveSlotMeta,
  SystemSnapshots,
  CombatConfig,
  NewGamePlusConfig,
  AffectionProfile,
  RelationshipEvent,
  CoreEventMap,
} from '@surdet/core';
import { PixiStage, AdvRenderer, AudioManager } from '@surdet/renderer';
import gameConfig from '../game.config.json';
import calendarConfig from '../content/config/calendar.json';
import combatConfig from '../content/config/combat.json';
import eventsConfig from '../content/config/events.json';
import ngpConfig from '../content/config/ngp.json';

// vite glob：递归收录全部 .gal 剧本（子目录场景 ID 仍为文件名去扩展名，须全局唯一）
const sceneFiles = import.meta.glob('../content/scenario/**/*.gal', {
  query: '?raw',
  import: 'default',
});

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
  }
}

async function main(): Promise<void> {
  const appEl = document.getElementById('app')!;

  // 舞台
  const stage = new PixiStage();
  await stage.init();
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
  const calendar = new CalendarRunner(calendarConfig, store);
  const combat = new CombatSolver(combatConfig as CombatConfig);
  const affection = new AffectionSystem(
    eventsConfig.profiles as AffectionProfile[],
    eventsConfig.events as RelationshipEvent[],
    store,
  );
  const ngp = new NewGamePlus(ngpConfig as NewGamePlusConfig, store);

  /** 自动战斗演示：双方交替行动直到分出胜负（真实项目改为交互式回合 UI）。 */
  function runAutoBattle(): void {
    let guard = 0;
    while (!combat.finished && guard++ < 200) {
      // 僵局出口（宿主契约，见 CombatSolver.pass）：行动方无可攻击目标
      // （互不在射程且无冷却就绪的 long 技能）时 pass 推进回合，
      // 否则 maxTurns 永不触发、战斗无限死锁
      if (combat.actingTeamStalemate) {
        combat.pass();
        continue;
      }
      const acting = combat.units.find((u) => u.alive && u.team === combat.actingTeam);
      const target = combat.units.find((u) => u.alive && u.team !== combat.actingTeam);
      if (!acting || !target) break;
      // 优先用冷却就绪的技能，否则普攻
      const skillId = acting.skills.find((s) => (acting.cooldowns.get(s) ?? 0) <= 0);
      combat.act(acting.uid, target.uid, skillId);
    }
  }

  // 总线 + 解释器 + 渲染器（全家桶状态经 SystemHooks 随存档往返）
  const bus = new EventBus<CoreEventMap>();
  const interp = new Interpreter(store, bus, registry, undefined, undefined, {
    snapshot: (): SystemSnapshots => ({
      calendar: calendar.snapshot(),
      combat: combat.snapshot(),
      affection: affection.snapshot(),
    }),
    restore: (s: SystemSnapshots) => {
      if (s.calendar) calendar.restore(s.calendar);
      if (s.combat) combat.restore(s.combat);
      if (s.affection) affection.restore(s.affection);
    },
  });
  const audio = new AudioManager();
  const renderer = new AdvRenderer(stage, audio, {
    onAdvance: () => interp.advance(),
    onSelect: (i) => interp.choose(i),
  });
  renderer.subscribe(bus);

  // M5 system 事件 → 宿主驱动对应系统（@battle/@calendar/@affection/@event/@shop/@item）
  bus.on('system', (p) => {
    switch (p.type) {
      case 'calendar': {
        const nodeId = p.args[0];
        const res = nodeId ? calendar.enter(nodeId) : { ok: false as const, reason: '缺节点参数' };
        console.info('[starter] calendar enter:', nodeId, res);
        // 成功进入且节点带 eventId：消费事件（演示：记录并提示；真实游戏在此跳转对应事件场景）
        if (res.ok && res.eventId) {
          console.info('[starter] calendar event triggered:', res.eventId);
        }
        // 仅成功进入才推进回合（演示逻辑：失败节点/行动力不足不应消耗回合）
        if (res.ok) calendar.advanceTurn();
        break;
      }
      case 'battle': {
        // 每次 @battle 都是新战斗：重新布阵并自动求解
        combat.start({ allies: ['sword'], enemies: ['goblin'] });
        runAutoBattle();
        store.set('battleWon', combat.winner === 'allies');
        console.info('[starter] battle finished, winner:', combat.winner, 'ngp cleared:', ngp.isCleared());
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
      default:
        console.info('[starter] system event:', p.type);
    }
  });

  // 点击画布推进文本
  stage.app!.canvas.addEventListener('pointerdown', () => renderer.advance());

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
    void saves.save(AUTO_SLOT, snap).then(() => {
      console.info('[starter] 自动存档（ngp cleared:', ngp.isCleared(), '）');
    });
  });

  // 存档场景哈希不匹配：存档后剧本被编辑，pc 定位可能漂移（引擎仍照常加载，此处提醒玩家）
  bus.on('saveMismatch', (p) => {
    console.warn(`[starter] 存档与剧本版本不一致（场景 ${p.sceneId}）：定位可能漂移，建议重新开始该场景`);
  });

  // 键位：F5 快速存档 / F9 快速读档 / A 自动播放 / S 快进
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5') {
      e.preventDefault();
      const snap = interp.saveSnapshot();
      if (snap) {
        void saves.save(QUICK_SLOT, { ...snap, kind: 'quick' }).then(() => console.info('[starter] 快速存档'));
      }
    } else if (e.key === 'F9') {
      e.preventDefault();
      void (async () => {
        if (await saves.has(QUICK_SLOT)) {
          try {
            interp.loadSnapshot(await saves.load(QUICK_SLOT));
            console.info('[starter] 快速读档');
          } catch (err) {
            console.error('[starter] 读档失败（存档损坏或版本不符）：', err);
          }
        }
      })();
    } else if (e.key === 'a' || e.key === 'A') {
      console.info('[starter] 自动播放', renderer.toggleAuto() ? '开' : '关');
    } else if (e.key === 's' || e.key === 'S') {
      console.info('[starter] 快进', renderer.toggleSkip() ? '开' : '关');
    }
  });

  // 启动
  interp.start('ch01_01');
  console.info(`[starter] started: ${registry.all().length} scenes, ${decls.length} variables`);
}

main().catch((err) => {
  console.error('[starter] 启动失败：', err);
});
