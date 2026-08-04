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
  /** CG/音乐解锁状态 */
  gallery: { cgs: string[]; music: string[] };
  /** 全家桶系统状态快照（日历/战斗/好感/周目，宿主经 SystemHooks 提供，可选） */
  systems?: SystemSnapshots;
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
