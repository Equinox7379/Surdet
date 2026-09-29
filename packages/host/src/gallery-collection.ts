import type { GalleryUnlockPolicy } from '@surdet/core';

interface Collection { version: 1; cgs: string[]; music: string[] }

function readCollection(value: unknown): Collection {
  if (value === null) return { version: 1, cgs: [], music: [] };
  const record = value as Collection;
  if (!record || record.version !== 1 || ![record.cgs, record.music].every(ids =>
    Array.isArray(ids) && ids.every(id => typeof id === 'string' && id.trim().length > 0))) {
    throw new Error('永久收藏记录损坏，原记录未修改');
  }
  return { ...record, cgs: [...new Set(record.cgs)], music: [...new Set(record.music)] };
}

/** Keys are project-scoped even in hosts sharing one profile directory. */
export async function galleryCollectionKey(projectId: string): Promise<string> {
  const platform = globalThis as unknown as {
    crypto: { subtle: { digest(algorithm: string, bytes: Uint8Array): Promise<ArrayBuffer> } };
    TextEncoder: new () => { encode(text: string): Uint8Array };
  };
  const digest = await platform.crypto.subtle.digest('SHA-256', new platform.TextEncoder().encode(projectId));
  return `gallery-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** One serialized writer per player session; a rejected write never becomes durable state. */
export async function createGalleryCollection(storage: {
  read(key: string, options?: { strict?: boolean }): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}, key: string, policy: GalleryUnlockPolicy) {
  let committed = readCollection(await storage.read(key, { strict: true }));
  let pending = Promise.resolve();
  return {
    snapshot: () => ({ cgs: [...committed.cgs], music: [...committed.music] }),
    unlock(section: 'cgs' | 'music', id: string): Promise<void> {
      if (policy[section] !== 'profile') return Promise.resolve();
      const persist = async () => {
        // Re-read before each write to preserve records added by another live session.
        const latest = readCollection(await storage.read(key, { strict: true }));
        const next: Collection = { ...latest,
          cgs: [...new Set([...latest.cgs, ...committed.cgs])],
          music: [...new Set([...latest.music, ...committed.music])],
        };
        if (!next[section].includes(id)) next[section].push(id);
        if (JSON.stringify(next) !== JSON.stringify(latest)) await storage.write(key, next);
        committed = next;
      };
      // The same origin can have two player windows. Keep their read/union/write
      // indivisible where the browser provides Web Locks (including Electron).
      const locks = (globalThis as unknown as { navigator?: { locks?: { request(name: string, work: () => Promise<void>): Promise<void> } } }).navigator?.locks;
      const write = pending.then(() => locks ? locks.request(`surdet:${key}`, persist) : persist());
      pending = write.catch(() => {}); // keep subsequent explicit unlocks usable; caller sees rejection
      return write;
    },
  };
}
