import type { VarValue } from '../state/types.js';
import type { CalendarSnapshot } from '../calendar/calendar.js';
import type { CombatSnapshot } from '../combat/combat.js';
import type { AffectionSnapshot } from '../systems/affection.js';
import type { EventSchedulerSnapshot } from '../systems/event-scheduler.js';
import type { GrowthSnapshot } from '../systems/growth.js';
import type { AchievementSnapshot } from '../systems/achievement.js';

/**
 * 全家桶系统快照（可选，由宿主经 Interpreter 的 SystemHooks 提供）。
 * 各系统快照必须 JSON 安全（无 Map/Set/函数），保证经 SaveManager 深拷贝往返不损坏。
 */
export interface SystemSnapshots {
  calendar?: CalendarSnapshot;
  combat?: CombatSnapshot;
  affection?: AffectionSnapshot;
  /** 事件优先级调度器（已触发的一次性事件 ID；starter 经 SystemHooks 提供） */
  eventScheduler?: EventSchedulerSnapshot;
  /** 成就解锁状态；宿主经 SystemHooks 提供（成长系统由解释器内聚管理，快照在 SaveSnapshot.growth 顶层） */
  achievements?: AchievementSnapshot;
  /** 周目继承标记等（预留） */
  newGamePlus?: unknown;
}

/** 当前存档 schema 版本（读档校验：引擎升级后旧档无迁移路径时据此提示）。
 *  旧档无 schemaVersion 视为 0，按兼容处理；版本过高抛错提示升级。
 *  v2：SaveSnapshot 新增 callStack（@call/@return 调用栈）；旧档无此字段按空栈加载，向后兼容。
 *  v3：SavePosition 新增 sceneHash（场景源码哈希）；旧档无此字段跳过一致性校验，向后兼容。 */
export const SAVE_SCHEMA_VERSION = 3;

/** 存档槽位元信息 */
export interface SaveSlotMeta {
  id: string;
  createdAt: number;
  updatedAt: number;
  label?: string;
  chapter?: string;
  playTimeSec?: number;
  /** 封面缩略图（dataURL 或路径） */
  thumbnail?: string;
  /** 存档 schema 版本（SaveManager.save 写入；读档校验用） */
  schemaVersion?: number;
}

/** 场景定位：场景 ID + 指令索引（解释器恢复用）。
 *  sceneHash：存档时剧本源码哈希（schema v3+）；读档时当前场景哈希不一致由解释器
 *  发 saveMismatch 事件——说明存档后剧本被编辑，pc 可能漂移。旧档无此字段不校验。 */
export interface SavePosition {
  sceneId: string;
  pc: number;
  sceneHash?: string;
}

/** 一次完整存档快照 */
export interface SaveSnapshot {
  meta: SaveSlotMeta;
  /** 变量全量快照 */
  variables: Record<string, VarValue>;
  /** 当前场景定位（挂起点：即将执行的指令） */
  position: SavePosition | null;
  /** @call 子场景调用栈（返回点序列，栈顶在末尾）。可选：schema ≤ v1 的旧档无此字段，按空栈加载 */
  callStack?: SavePosition[];
  /** 存档类型 */
  kind: 'manual' | 'quick' | 'auto';
  /** 已读标记（快进跳过用） */
  readSet: string[];
  /** CG/音乐/文本回想解锁状态（texts 为后续版本新增，旧档无此字段） */
  gallery: { cgs: string[]; music: string[]; texts?: string[] };
  /** 通关记录（@clear 结局收集；后续版本新增，旧档无此字段按未通关） */
  clears?: { endings: string[] };
  /** 角色成长（经验/等级；后续版本新增，旧档无此字段按初始等级） */
  growth?: GrowthSnapshot;
  /** 全家桶系统状态快照（日历/战斗/好感/周目，宿主经 SystemHooks 提供，可选） */
  systems?: SystemSnapshots;
  /** 可选的宿主演出状态；core 只验证 JSON 形状，不依赖具体渲染器。 */
  presentation?: { version: 1; payload: unknown };
}

/**
 * 存储后端：core 零依赖，宿主注入（浏览器 localStorage / 桌面文件）。
 * 方法可同步返回或返回 Promise（如 Electron 经 invoke 的异步 IPC）；
 * SaveManager 对外统一提供 async API（调用方一律 await）。
 */
export interface SaveStorage {
  read(slot: string): SaveSnapshot | null | Promise<SaveSnapshot | null>;
  write(slot: string, data: SaveSnapshot): void | Promise<void>;
  delete(slot: string): void | Promise<void>;
  list(): string[] | Promise<string[]>;
  /** 元信息索引（可选优化）：不读完整存档体即取得全部槽位 meta，
   *  避免列表界面为拿元信息全量解析每个存档。未实现时 SaveManager.list 回退逐槽读取。 */
  listMeta?(): SaveSlotMeta[] | Promise<SaveSlotMeta[]>;
}

/** JSON 深拷贝（存档数据均为 JSON 安全值） */
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** JSON 安全递归检查：null/string/有限 number/boolean/数组/普通对象 */
export function isJsonSafeValue(v: unknown): boolean {
  if (v === null) return true;
  if (typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonSafeValue);
  if (typeof v === 'object' && v !== null) return Object.values(v).every(isJsonSafeValue);
  return false;
}

/** 存档深度校验：结构非法（篡改/损坏/手工编辑出错）提前抛错，
 *  避免畸形数据在解释器执行中途才爆炸（玩家体验：读档入口即失败并给出原因）。 */
export function assertValidSnapshot(snap: unknown): asserts snap is SaveSnapshot {
  const fail = (msg: string): never => {
    throw new Error(`存档结构非法：${msg}`);
  };
  if (typeof snap !== 'object' || snap === null) fail('顶层必须是对象');
  const s = snap as Record<string, unknown>;
  if (typeof s.meta !== 'object' || s.meta === null) fail('缺少 meta 元信息');
  if (typeof s.variables !== 'object' || s.variables === null || Array.isArray(s.variables)) {
    fail('variables 必须是对象');
  }
  if (!isJsonSafeValue(s.variables)) fail('variables 含非 JSON 安全值（undefined/函数/Infinity 等）');
  if (s.position !== null && s.position !== undefined) {
    const p = s.position as Record<string, unknown> | null;
    if (typeof p !== 'object' || p === null || typeof p.sceneId !== 'string' || typeof p.pc !== 'number') {
      fail('position 必须是 { sceneId: string, pc: number } 或 null');
    }
  }
  if (s.callStack !== undefined) {
    if (!Array.isArray(s.callStack)) {
      fail('callStack 必须是数组');
    } else {
      for (const frame of s.callStack) {
        const fr = frame as Record<string, unknown>;
        if (typeof fr !== 'object' || fr === null || typeof fr.sceneId !== 'string' || typeof fr.pc !== 'number') {
          fail('callStack 元素必须是 { sceneId: string, pc: number }');
        }
      }
    }
  }
  if (!Array.isArray(s.readSet) || !s.readSet.every((x) => typeof x === 'string')) {
    fail('readSet 必须是字符串数组');
  }
  if (s.gallery !== undefined) {
    const g = s.gallery as Record<string, unknown>;
    if (typeof g !== 'object' || g === null || !Array.isArray(g.cgs) || !Array.isArray(g.music)) {
      fail('gallery 必须是 { cgs: string[], music: string[] }');
    }
    const cgs = g.cgs as unknown[];
    const music = g.music as unknown[];
    if (!cgs.every((x) => typeof x === 'string') || !music.every((x) => typeof x === 'string')) {
      fail('gallery.cgs / gallery.music 必须是字符串数组');
    }
  }
  if (s.clears !== undefined) {
    const c = s.clears as Record<string, unknown>;
    if (typeof c !== 'object' || c === null || !Array.isArray(c.endings) || !(c.endings as unknown[]).every((x) => typeof x === 'string')) {
      fail('clears 必须是 { endings: string[] }');
    }
  }
  if (s.growth !== undefined) {
    const g = s.growth as Record<string, unknown>;
    if (typeof g !== 'object' || g === null || Array.isArray(g)) {
      fail('growth 必须是对象');
    } else {
      for (const key of ['levels', 'experience'] as const) {
        const table = g[key];
        if (table !== undefined) {
          if (typeof table !== 'object' || table === null || Array.isArray(table)) {
            fail(`growth.${key} 必须是对象`);
          } else if (!Object.values(table as Record<string, unknown>).every((x) => typeof x === 'number')) {
            fail(`growth.${key} 值必须是 number`);
          }
        }
      }
    }
  }
  if (s.presentation !== undefined) {
    const p = s.presentation as Record<string, unknown>;
    if (typeof p !== 'object' || p === null || p.version !== 1 || !('payload' in p)) {
      fail('presentation 必须是 { version: 1, payload }');
    }
    if (!isJsonSafeValue(p.payload)) fail('presentation.payload 必须是 JSON 安全值');
  }
  // systems 形状兜底 + 子快照深度校验（审计轮4：新增系统的子快照纳入读档入口校验，
  // 避免畸形数据在各系统 restore 中途才爆炸）
  if (s.systems !== undefined) {
    if (typeof s.systems !== 'object' || s.systems === null || Array.isArray(s.systems)) {
      fail('systems 必须是对象');
    }
    const sys = s.systems as Record<string, unknown>;
    // 子快照对象形状校验（undefined 放行 = 旧档无该字段）
    const checkObj = (v: unknown, label: string): Record<string, unknown> | undefined => {
      if (v === undefined) return undefined;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${label} 必须是对象`);
      return v as Record<string, unknown>;
    };
    const strArr = (v: unknown, label: string): void => {
      if (v === undefined) return;
      if (!Array.isArray(v) || !(v as unknown[]).every((x) => typeof x === 'string')) fail(`${label} 必须是字符串数组`);
    };
    const requiredStrArr = (v: unknown, label: string): void => {
      if (!Array.isArray(v) || !(v as unknown[]).every((x) => typeof x === 'string')) fail(`${label} 必须是字符串数组`);
    };
    const finite = (v: unknown, label: string): void => {
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${label} 必须是有限 number`);
    };
    const bool = (v: unknown, label: string): void => {
      if (typeof v !== 'boolean') fail(`${label} 必须是 boolean`);
    };
    const stringOrNull = (v: unknown, label: string): void => {
      if (v !== null && typeof v !== 'string') fail(`${label} 必须是 string 或 null`);
    };
    const achievements = checkObj(sys.achievements, 'systems.achievements');
    if (achievements) strArr(achievements.unlocked, 'systems.achievements.unlocked');
    const scheduler = checkObj(sys.eventScheduler, 'systems.eventScheduler');
    if (scheduler) strArr(scheduler.fired, 'systems.eventScheduler.fired');
    const calendar = checkObj(sys.calendar, 'systems.calendar');
    if (calendar) {
      if (calendar.turn !== undefined && typeof calendar.turn !== 'number') fail('systems.calendar.turn 必须是 number');
      if (calendar.ap !== undefined && typeof calendar.ap !== 'number') fail('systems.calendar.ap 必须是 number');
      strArr(calendar.visited, 'systems.calendar.visited');
      if (calendar.commandCounts !== undefined) {
        if (typeof calendar.commandCounts !== 'object' || calendar.commandCounts === null || Array.isArray(calendar.commandCounts)) {
          fail('systems.calendar.commandCounts 必须是对象');
        } else if (!Object.values(calendar.commandCounts as Record<string, unknown>).every((x) => typeof x === 'number')) {
          fail('systems.calendar.commandCounts 值必须是 number');
        }
      }
    }
    const combat = checkObj(sys.combat, 'systems.combat');
    if (combat) {
      if (!Array.isArray(combat.units)) fail('systems.combat.units 必须是数组');
      for (const [index, rawUnit] of (combat.units as unknown[]).entries()) {
        const label = `systems.combat.units[${index}]`;
        if (typeof rawUnit !== 'object' || rawUnit === null || Array.isArray(rawUnit)) fail(`${label} 必须是对象`);
        const unit = rawUnit as Record<string, unknown>;
        for (const key of ['uid', 'defId', 'name', 'team', 'kind']) {
          if (typeof unit[key] !== 'string') fail(`${label}.${key} 必须是 string`);
        }
        for (const key of ['hp', 'maxHp', 'atk', 'def', 'range', 'move', 'position']) {
          finite(unit[key], `${label}.${key}`);
        }
        requiredStrArr(unit.skills, `${label}.skills`);
        bool(unit.alive, `${label}.alive`);
        if (typeof unit.cooldowns !== 'object' || unit.cooldowns === null || Array.isArray(unit.cooldowns)) {
          fail(`${label}.cooldowns 必须是对象`);
        } else if (!Object.values(unit.cooldowns as Record<string, unknown>).every((value) => typeof value === 'number' && Number.isFinite(value))) {
          fail(`${label}.cooldowns 值必须是有限 number`);
        }
      }
      finite(combat.turn, 'systems.combat.turn');
      if ((combat.turn as number) <= 0) fail('systems.combat.turn 必须是正数');
      if (typeof combat.actingTeam !== 'string') fail('systems.combat.actingTeam 必须是 string');
      stringOrNull(combat.winner, 'systems.combat.winner');
      bool(combat.finished, 'systems.combat.finished');
      strArr(combat.moved, 'systems.combat.moved');
    }
    const affection = checkObj(sys.affection, 'systems.affection');
    if (affection) {
      requiredStrArr(affection.consumed, 'systems.affection.consumed');
      strArr(affection.everConsumed, 'systems.affection.everConsumed');
    }
  }
}

/** 内存存储（默认；可测） */
export class MemoryStorage implements SaveStorage {
  #data = new Map<string, SaveSnapshot>();
  async read(slot: string): Promise<SaveSnapshot | null> {
    // 读隔离与 write 对称：返回深拷贝，外部篡改读档结果不污染存储（防御性拷贝原则）
    const data = this.#data.get(slot);
    return data === undefined ? null : deepClone(data);
  }
  async write(slot: string, data: SaveSnapshot): Promise<void> {
    this.#data.set(slot, deepClone(data));
  }
  async delete(slot: string): Promise<void> {
    this.#data.delete(slot);
  }
  async list(): Promise<string[]> {
    return [...this.#data.keys()];
  }
  async listMeta(): Promise<SaveSlotMeta[]> {
    return [...this.#data.values()].map((s) => deepClone(s.meta));
  }
}

/** 存档槽位约定：固定名 */
export const AUTO_SLOT = 'auto';
export const QUICK_SLOT = 'quick';

/**
 * 存档管理器：多槽位读写 + 元信息。保存时更新时间戳并深拷贝快照。
 * 全部方法异步（存储后端可能是 IPC/文件/网络）。
 */
export class SaveManager {
  #storage: SaveStorage;

  constructor(storage: SaveStorage = new MemoryStorage()) {
    this.#storage = storage;
  }

  async save(slot: string, snapshot: SaveSnapshot): Promise<void> {
    const now = Date.now();
    const stamped: SaveSnapshot = {
      ...snapshot,
      meta: {
        ...snapshot.meta,
        id: slot,
        updatedAt: now,
        createdAt: snapshot.meta.createdAt || now,
        schemaVersion: SAVE_SCHEMA_VERSION,
      },
    };
    await this.#storage.write(slot, deepClone(stamped));
  }

  async load(slot: string): Promise<SaveSnapshot> {
    const snap = await this.#storage.read(slot);
    if (!snap) {
      throw new Error(`存档槽位 '${slot}' 不存在`);
    }
    return snap;
  }

  async delete(slot: string): Promise<void> {
    await this.#storage.delete(slot);
  }

  /** 槽位元信息列表（按更新时间倒序）。优先走存储的元信息索引（listMeta），
   *  避免文件后端为列表界面全量读取/解析每个存档体。 */
  async list(): Promise<SaveSlotMeta[]> {
    if (this.#storage.listMeta) {
      const metas = await this.#storage.listMeta();
      return metas.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    const ids = await this.#storage.list();
    const metas: SaveSlotMeta[] = [];
    for (const id of ids) {
      const snap = await this.#storage.read(id);
      if (snap) metas.push(snap.meta);
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async has(slot: string): Promise<boolean> {
    return (await this.#storage.read(slot)) !== null;
  }
}
