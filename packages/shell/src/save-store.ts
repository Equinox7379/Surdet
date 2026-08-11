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

/** 槽位名白名单清洗，防路径穿越。
 *  单射编码（审计修复：原实现把 a/b 与 a_b 都洗成 a_b 造成静默覆盖）：
 *  单遍替换——转义符自身 _ → _u，其余不安全字符 → _xHH。
 *  输出中每个 _ 都是转义前缀（必跟 u 或 xHH），解码无歧义 → 不同输入必映射不同文件名。 */
export function sanitizeSlot(slot: string): string {
  return slot.replace(/[^a-zA-Z0-9-]/g, (c) =>
    c === '_' ? '_u' : `_x${c.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
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
    const index = this.readIndex();
    const metas = Object.values(index);
    // 审计终审修复：索引存在时合并磁盘上未迁移的 legacy 槽位——legacy 文件名不在索引内，
    // 但 read() 的 legacy 回退能命中；不合并会导致列表漏项。按 meta.id 去重。
    const known = new Set(metas.map((m) => m.id));
    for (const name of this.list()) {
      if (index[name] !== undefined) continue; // 索引已覆盖（新编码 key）
      const snap = this.read(name);
      if (snap && !known.has(snap.meta.id)) {
        known.add(snap.meta.id);
        metas.push(snap.meta);
      }
    }
    return metas;
  }

  read(slot: string): SaveSnapshot | null {
    const file = this.fileFor(slot);
    const direct = this.#readFile(file);
    if (direct !== null) return direct;
    if (!fs.existsSync(file)) {
      // 兼容回退（审计复核修复）：编码变更前含下划线的槽位（_ 保留）在新编码下（_ → _u）
      // 文件名不同，存量存档会读不到。新文件不存在时按旧算法文件名补读一次；
      // 下次 write 落盘新文件名并清理旧文件（#removeLegacyFiles），完成完整迁移。
      const legacy = this.#legacyFileFor(slot);
      if (legacy !== null) {
        const legacyData = this.#readFile(legacy) ?? this.#readFile(`${legacy}.bak`);
        if (legacyData !== null) return legacyData;
      }
      return null;
    }
    // 主档存在但损坏必须交给上层处理；回退 .bak 会把数据损坏伪装成成功读档。
    throw new Error(`存档文件存在但无法读取：${file}`);
  }

  /** 编码变更前的槽位文件名（不安全字符 → _，下划线保留）；与新编码结果相同时返回 null（无需回退） */
  #legacyFileFor(slot: string): string | null {
    const legacyName = slot.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (legacyName === sanitizeSlot(slot)) return null;
    return path.join(this.dir, `${legacyName}.json`);
  }

  /** 清理旧编码存档文件（含 .bak）：write 迁移收尾与 delete 共用，闭合僵尸存档缺口（审计终审） */
  #removeLegacyFiles(slot: string): void {
    const legacy = this.#legacyFileFor(slot);
    if (legacy === null) return;
    for (const f of [legacy, `${legacy}.bak`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }

  /** 读取单个存档文件；仅缺失返回 null，I/O/解析/结构错误全部上抛。 */
  #readFile(file: string): SaveSnapshot | null {
    if (!fs.existsSync(file)) return null;
    try {
      // 读隔离：JSON.parse 每次读盘产出的本就是全新对象图（无共享引用），
      // 直接返回即满足与 MemoryStorage.read 一致的隔离契约，无需二次克隆
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('存档 JSON 顶层必须是对象');
      }
      return parsed as SaveSnapshot;
    } catch (error) {
      throw new Error(`存档文件读取或解析失败：${file}`, { cause: error });
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
    // 覆盖前备份上一版（.bak）：主档意外损坏时 read 回退恢复，玩家不丢上次进度
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    // 原子写：先写临时文件再 rename，崩溃/中断不会留下半截损坏存档
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, file);
    // 索引更新失败也必须向上层报告：写入事务不能把部分成功伪装成成功。
    const index = this.readIndex();
    index[sanitizeSlot(slot)] = { ...data.meta, id: slot };
    this.writeIndex(index);
    // 审计终审修复：隐式迁移收尾——新文件落盘后清理旧编码文件（含 .bak），
    // 否则 delete 后 read 会经 legacy 回退把旧档复活成僵尸存档
    this.#removeLegacyFiles(slot);
  }

  delete(slot: string): void {
    const file = this.fileFor(slot);
    for (const f of [file, `${file}.bak`]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    // 审计终审修复：同步删除旧编码文件（含 .bak），防止删除后经 legacy 回退复活
    this.#removeLegacyFiles(slot);
    const index = this.readIndex();
    if (index[sanitizeSlot(slot)] !== undefined) {
      delete index[sanitizeSlot(slot)];
      this.writeIndex(index);
    }
  }

  /** 读取索引；仅缺失视为空表，损坏或 I/O 错误必须上抛。 */
  private readIndex(): Record<string, SaveSlotMeta> {
    if (!fs.existsSync(this.indexPath())) return {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexPath(), 'utf8')) as Record<string, SaveSlotMeta>;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('存档索引顶层必须是对象');
      }
      return raw;
    } catch (error) {
      throw new Error(`存档索引读取或解析失败：${this.indexPath()}`, { cause: error });
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
