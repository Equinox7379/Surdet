import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SaveSnapshot } from '@surdet/core';

/**
 * 桌面存档存储：按槽位写入 userData/saves/<slot>.json。
 * 纯 fs 实现，与 Electron 解耦，可脱离 electron 单测（sync IPC 只负责转发）。
 * 槽位名经 sanitizeSlot 白名单清洗，防路径穿越。
 */
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
    return JSON.parse(fs.readFileSync(file, 'utf8')) as SaveSnapshot;
  }

  write(slot: string, data: SaveSnapshot): void {
    fs.writeFileSync(this.fileFor(slot), JSON.stringify(data));
  }

  delete(slot: string): void {
    const file = this.fileFor(slot);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
