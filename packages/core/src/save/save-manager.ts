import type { VarValue } from '../state/types.js';
import type { CalendarSnapshot } from '../calendar/calendar.js';
import type { CombatSnapshot } from '../combat/combat.js';
import type { AffectionSnapshot } from '../systems/affection.js';

/**
 * 全家桶系统快照（可选，由宿主经 Interpreter 的 SystemHooks 提供）。
 * 各系统快照必须 JSON 安全（无 Map/Set/函数），保证经 SaveManager 深拷贝往返不损坏。
 */
export interface SystemSnapshots {
  calendar?: CalendarSnapshot;
  combat?: CombatSnapshot;
  affection?: AffectionSnapshot;
  /** 周目继承标记等（预留） */
  newGamePlus?: unknown;
}

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
}

/** 场景定位：场景 ID + 指令索引（解释器恢复用） */
export interface SavePosition {
  sceneId: string;
  pc: number;
}

/** 一次完整存档快照 */
export interface SaveSnapshot {
  meta: SaveSlotMeta;
  /** 变量全量快照 */
  variables: Record<string, VarValue>;
  /** 当前场景定位（挂起点：即将执行的指令） */
  position: SavePosition | null;
  /** 存档类型 */
  kind: 'manual' | 'quick' | 'auto';
  /** 已读标记（快进跳过用） */
  readSet: string[];
  /** CG/音乐解锁状态 */
  gallery: { cgs: string[]; music: string[] };
  /** 全家桶系统状态快照（日历/战斗/好感/周目，宿主经 SystemHooks 提供，可选） */
  systems?: SystemSnapshots;
}

/** 存储后端：core 零依赖，宿主注入（浏览器 localStorage / 桌面文件） */
export interface SaveStorage {
  read(slot: string): SaveSnapshot | null;
  write(slot: string, data: SaveSnapshot): void;
  delete(slot: string): void;
  list(): string[];
}

/** JSON 深拷贝（存档数据均为 JSON 安全值） */
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 内存存储（默认；可测） */
export class MemoryStorage implements SaveStorage {
  #data = new Map<string, SaveSnapshot>();
  read(slot: string): SaveSnapshot | null {
    return this.#data.get(slot) ?? null;
  }
  write(slot: string, data: SaveSnapshot): void {
    this.#data.set(slot, deepClone(data));
  }
  delete(slot: string): void {
    this.#data.delete(slot);
  }
  list(): string[] {
    return [...this.#data.keys()];
  }
}

/** 存档槽位约定：固定名 */
export const AUTO_SLOT = 'auto';
export const QUICK_SLOT = 'quick';

/**
 * 存档管理器：多槽位读写 + 元信息。保存时更新时间戳并深拷贝快照。
 */
export class SaveManager {
  #storage: SaveStorage;

  constructor(storage: SaveStorage = new MemoryStorage()) {
    this.#storage = storage;
  }

  save(slot: string, snapshot: SaveSnapshot): void {
    const now = Date.now();
    const stamped: SaveSnapshot = {
      ...snapshot,
      meta: { ...snapshot.meta, id: slot, updatedAt: now, createdAt: snapshot.meta.createdAt || now },
    };
    this.#storage.write(slot, deepClone(stamped));
  }

  load(slot: string): SaveSnapshot {
    const snap = this.#storage.read(slot);
    if (!snap) {
      throw new Error(`存档槽位 '${slot}' 不存在`);
    }
    return snap;
  }

  delete(slot: string): void {
    this.#storage.delete(slot);
  }

  /** 槽位元信息列表（按更新时间倒序） */
  list(): SaveSlotMeta[] {
    return this.#storage
      .list()
      .map((id) => {
        const snap = this.#storage.read(id);
        return snap ? snap.meta : null;
      })
      .filter((m): m is SaveSlotMeta => m !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  has(slot: string): boolean {
    return this.#storage.read(slot) !== null;
  }
}
