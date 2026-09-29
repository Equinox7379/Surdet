import type { BrowserKeyValueStorage, ProfileEnvelope, ProfileStorage } from './types.js';

const MAX_SERIALIZED_BYTES = 1024 * 1024;
const PROFILE_KEY = /^[A-Za-z0-9._-]{1,80}$/;

export function assertProfileKey(key: string): void {
  if (typeof key !== 'string' || !PROFILE_KEY.test(key)) {
    throw new Error(`Profile key 非法：${String(key)}（只允许 1-80 个 ASCII 字母、数字、点、下划线和连字符）`);
  }
}

function jsonBytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function serializeValue(value: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, (_key, current: unknown) => {
      if (current === undefined || typeof current === 'function' || typeof current === 'symbol' || typeof current === 'bigint') {
        throw new Error('Profile value 必须是 JSON 安全值');
      }
      if (typeof current === 'number' && !Number.isFinite(current)) {
        throw new Error('Profile value 不得包含 NaN 或 Infinity');
      }
      return current;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Profile value')) throw error;
    throw new Error(`Profile value 不是可序列化的 JSON 值：${error instanceof Error ? error.message : String(error)}`);
  }
  if (serialized === undefined) throw new Error('Profile value 必须是 JSON 安全值');
  if (jsonBytes(serialized) > MAX_SERIALIZED_BYTES) throw new Error('Profile value 序列化后超过 1 MiB 限制');
  return serialized;
}

export function serializeProfileEnvelope(value: unknown): string {
  const serializedValue = serializeValue(value);
  const envelope: ProfileEnvelope<unknown> = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    value: JSON.parse(serializedValue) as unknown,
  };
  const serializedEnvelope = serializeValue(envelope);
  if (jsonBytes(serializedEnvelope) > MAX_SERIALIZED_BYTES) throw new Error('Profile envelope 序列化后超过 1 MiB 限制');
  return serializedEnvelope;
}

export function parseProfileEnvelope<T>(raw: string | null, options?: { strict?: boolean }): T | null {
  if (raw === null) return null;
  const invalid = (): null => { if (options?.strict) throw new Error('Profile 数据损坏，原记录未修改'); return null; };
  try {
    if (jsonBytes(raw) > MAX_SERIALIZED_BYTES) return invalid();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return invalid();
    const envelope = parsed as Partial<ProfileEnvelope<T>>;
    if (envelope.schemaVersion !== 1 || typeof envelope.updatedAt !== 'string' || !Object.prototype.hasOwnProperty.call(envelope, 'value') || (options?.strict && envelope.value === null)) return invalid();
    return JSON.parse(serializeValue(envelope.value)) as T;
  } catch {
    return invalid();
  }
}

export class MemoryProfileStorage implements ProfileStorage {
  readonly #values = new Map<string, string>();

  async read<T = unknown>(key: string, options?: { strict?: boolean }): Promise<T | null> {
    assertProfileKey(key);
    return parseProfileEnvelope<T>(this.#values.get(key) ?? null, options);
  }

  async write(key: string, value: unknown): Promise<void> {
    assertProfileKey(key);
    this.#values.set(key, serializeProfileEnvelope(value));
  }

  async delete(key: string): Promise<void> {
    assertProfileKey(key);
    this.#values.delete(key);
  }
}

export class LocalStorageProfileStorage implements ProfileStorage {
  readonly #storage: BrowserKeyValueStorage;
  readonly #prefix: string;

  constructor(storage: BrowserKeyValueStorage, prefix = 'surdet:profile:') {
    this.#storage = storage;
    this.#prefix = prefix;
  }

  async read<T = unknown>(key: string, options?: { strict?: boolean }): Promise<T | null> {
    assertProfileKey(key);
    return parseProfileEnvelope<T>(this.#storage.getItem(`${this.#prefix}${key}`), options);
  }

  async write(key: string, value: unknown): Promise<void> {
    assertProfileKey(key);
    this.#storage.setItem(`${this.#prefix}${key}`, serializeProfileEnvelope(value));
  }

  async delete(key: string): Promise<void> {
    assertProfileKey(key);
    this.#storage.removeItem(`${this.#prefix}${key}`);
  }
}
