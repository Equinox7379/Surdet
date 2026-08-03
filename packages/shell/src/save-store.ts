import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SaveSnapshot } from '@surdet/core';

/**
 * 桌面存档存储：按槽位写入 userData/saves/<slot>.json。
 * 纯 fs 实现，与 Electron 解耦，可脱离 electron 单测（sync IPC 只负责转发）。
 * 槽位名经 sanitizeSlot 白名单清洗，防路径穿越。
 */
/** 单个存档大小上限（字节）：防渲染进程写入超大 JSON */
export const MAX_SAVE_BYTES = 10 * 1024 * 1024;

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

  list(): string[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length));
  }

  read(slot: string): SaveSnapshot | null {
    const file = this.fileFor(slot);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as SaveSnapshot;
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
  }

  delete(slot: string): void {
    const file = this.fileFor(slot);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
