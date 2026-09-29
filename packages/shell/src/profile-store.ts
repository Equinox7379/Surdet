import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  assertProfileKey,
  parseProfileEnvelope,
  serializeProfileEnvelope,
} from '@surdet/host';
import type { ProfileStorage } from '@surdet/host';
import { writeJsonAtomic } from './json-file.js';

export class FileProfileStore implements ProfileStorage {
  readonly dir: string;
  readonly #warn: (message: string) => void;

  constructor(dir: string, warn: (message: string) => void = (message) => console.warn(message)) {
    this.dir = dir;
    this.#warn = warn;
  }

  #fileFor(key: string): string {
    assertProfileKey(key);
    // Preserve the existing lowercase game keys while making every capital
    // distinct on case-insensitive filesystems. '%' is not a legal profile key.
    let name = key.replace(/[A-Z]/g, letter => `%${letter.charCodeAt(0).toString(16)}`);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
      name = `%${name.charCodeAt(0).toString(16)}${name.slice(1)}`;
    }
    return path.join(this.dir, `${name}.json`);
  }

  async read<T = unknown>(key: string, options?: { strict?: boolean }): Promise<T | null> {
    const file = this.#fileFor(key);
    if (!fs.existsSync(file)) return null;
    try {
      const value = parseProfileEnvelope<T>(fs.readFileSync(file, 'utf8'), options);
      if (value === null) this.#warn(`Profile 数据损坏，已忽略：${file}`);
      return value;
    } catch (error) {
      if (options?.strict) throw error;
      this.#warn(`Profile 数据读取失败，已忽略：${file}（${error instanceof Error ? error.message : String(error)}）`);
      return null;
    }
  }

  async write(key: string, value: unknown): Promise<void> {
    const file = this.#fileFor(key);
    fs.mkdirSync(this.dir, { recursive: true });
    const envelope = JSON.parse(serializeProfileEnvelope(value)) as unknown;
    writeJsonAtomic(file, envelope);
  }

  async delete(key: string): Promise<void> {
    const file = this.#fileFor(key);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}
