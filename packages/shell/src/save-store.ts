import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SaveSnapshot, SaveSlotMeta } from '@surdet/core';

/**
 * 桌面存档存储：按槽位写入 userData/saves/<slot>.json。
 * 纯 fs 实现，与 Electron 解耦，可脱离 electron 单测（IPC 只负责转发）。
 * 槽位名经 sanitizeSlot 白名单清洗，防路径穿越。
 * 另维护 index.json 元信息索引：列表界面取槽位 meta 无需全量读取/解析每个存档体。
 */
/** 单个存档大小上限（字节）：防渲染进程写入超大 JSON */
export const MAX_SAVE_BYTES = 10 * 1024 * 1024;

/** 元信息索引文件名（saves 目录内，不作为存档槽位） */
const INDEX_FILE = 'index.json';

/** 槽位名白名单清洗，防路径穿越 */
export function sanitizeSlot(slot: string): string {
  return slot.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export class FileSaveStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  private fileFor(slot: string): string {
    return path.join(this.dir, `${sanitizeSlot(slot)}.json`);
  }

  private indexPath(): string {
    return path.join(this.dir, INDEX_FILE);
  }

  list(): string[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith('.json') && f !== INDEX_FILE && !f.endsWith('.tmp'))
      .map((f) => f.slice(0, -'.json'.length));
  }

  /** 全部槽位元信息（索引文件缺失时回退逐文件读取 meta——旧存档目录首次访问的自愈路径） */
  listMeta(): SaveSlotMeta[] {
    if (!fs.existsSync(this.indexPath())) {
      const metas: SaveSlotMeta[] = [];
      for (const slot of this.list()) {
        const snap = this.read(slot);
        if (snap) metas.push(snap.meta);
      }
      return metas;
    }
    return Object.values(this.readIndex());
  }

  read(slot: string): SaveSnapshot | null {
    const file = this.fileFor(slot);
    if (!fs.existsSync(file)) return null;
    try {
      // 读隔离深拷贝（与 MemoryStorage.read 契约一致）：文件场景每次本就重读磁盘，
      // 深拷贝成本可忽略；防御调用方改返回值污染后续读取。
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as SaveSnapshot;
      return JSON.parse(JSON.stringify(raw)) as SaveSnapshot;
    } catch {
      // 损坏/截断的存档视为无档（渲染层经 IPC 收到 null 而非主进程抛错）
      return null;
    }
  }

  write(slot: string, data: SaveSnapshot): void {
    let json: string;
    try {
      json = JSON.stringify(data);
    } catch (err) {
      // 循环引用/非 JSON 值：转为清晰错误（否则裸 TypeError 经 IPC 上抛，渲染端难以排查）
      throw new Error(
        `存档槽位 '${slot}' 数据无法序列化（可能含循环引用或非 JSON 值）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (Buffer.byteLength(json, 'utf8') > MAX_SAVE_BYTES) {
      throw new Error(`存档槽位 '${slot}' 超出大小上限（${MAX_SAVE_BYTES} 字节）`);
    }
    const file = this.fileFor(slot);
    const tmp = `${file}.tmp`;
    // 原子写：先写临时文件再 rename，崩溃/中断不会留下半截损坏存档
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, file);
    // 存档落盘成功后才更新索引：索引是优化而非正确性依赖，写失败不影响存档本身
    try {
      const index = this.readIndex();
      index[sanitizeSlot(slot)] = { ...data.meta, id: slot };
      this.writeIndex(index);
    } catch {
      // 索引更新失败：下次 listMeta 无索引时回退逐文件读取，自愈
    }
  }

  delete(slot: string): void {
    const file = this.fileFor(slot);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const index = this.readIndex();
    if (index[sanitizeSlot(slot)] !== undefined) {
      delete index[sanitizeSlot(slot)];
      try {
        this.writeIndex(index);
      } catch {
        // 同上：索引失败不影响删除结果
      }
    }
  }

  /** 读取索引；缺失/损坏视为空表 */
  private readIndex(): Record<string, SaveSlotMeta> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexPath(), 'utf8')) as Record<string, SaveSlotMeta>;
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  /** 原子写索引 */
  private writeIndex(index: Record<string, SaveSlotMeta>): void {
    const file = this.indexPath();
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(index));
    fs.renameSync(tmp, file);
  }
}
