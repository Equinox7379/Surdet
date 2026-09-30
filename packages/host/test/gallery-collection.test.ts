import { describe, it, expect, vi } from 'vitest';
import { effectiveGalleryUnlocks, readGalleryUnlockPolicy, GalleryState } from '@surdet/core';
import { createGalleryCollection, galleryCollectionKey } from '../src/gallery-collection.js';
import { MemoryProfileStorage, LocalStorageProfileStorage } from '../src/profile-store.js';

describe('opt-in permanent gallery', () => {
  it('keeps profile/term policies independent and protects rejected or corrupt collection writes', async () => {
    const storage = new MemoryProfileStorage(), policy = readGalleryUnlockPolicy({ unlockPolicy: { profiles: 'profile', terms: 'save' } });
    const key = await galleryCollectionKey('dossier-game');
    const collection = await createGalleryCollection(storage, key, policy);
    const write = vi.spyOn(storage, 'write'); write.mockRejectedValueOnce(new Error('quota'));
    await expect(collection.unlock('profiles', 'failed')).rejects.toThrow('quota'); expect(collection.snapshot().profiles).toBeUndefined();
    await collection.unlock('profiles', 'intro'); await collection.unlock('terms', 'port');
    expect((await createGalleryCollection(storage, key, policy)).snapshot()).toMatchObject({ profiles: ['intro'] });
    expect(collection.snapshot().terms).toBeUndefined();
    expect((await createGalleryCollection(storage, await galleryCollectionKey('other-dossier-game'), policy)).snapshot().profiles).toBeUndefined();
    const preview = await createGalleryCollection(new MemoryProfileStorage(), key, policy); await preview.unlock('profiles', 'preview-only');
    expect(collection.snapshot().profiles).toEqual(['intro']);
    await storage.write('bad', { version: 1, cgs: [], music: [], terms: null });
    await expect(createGalleryCollection(storage, 'bad', policy)).rejects.toThrow('损坏');
  });
  it('isolates ending policy, old profiles, project keys, previews and failed writes', async () => {
    const storage = new MemoryProfileStorage();
    const key = await galleryCollectionKey('ending-game');
    await storage.write(key, { version: 1, cgs: ['cg'], music: ['song'], texts: ['replay'], custom: true });
    const policy = readGalleryUnlockPolicy({ unlockPolicy: { endings: 'profile' } });
    const collection = await createGalleryCollection(storage, key, policy);
    expect(collection.snapshot().endings).toEqual([]);
    const write = vi.spyOn(storage, 'write');
    write.mockRejectedValueOnce(new Error('disk full'));
    await expect(collection.unlock('endings', 'failed')).rejects.toThrow('disk full');
    expect(collection.snapshot().endings).toEqual([]);
    await collection.unlock('endings', 'home');
    await collection.unlock('cgs', 'not-enabled');
    expect(await storage.read(key)).toEqual({ version: 1, cgs: ['cg'], music: ['song'], texts: ['replay'], endings: ['home'], custom: true, profiles: [], terms: [] });
    const reopened = await createGalleryCollection(storage, key, policy);
    expect(reopened.snapshot().endings).toEqual(['home']);
    const other = await createGalleryCollection(storage, await galleryCollectionKey('other-game'), policy);
    expect(other.snapshot().endings).toEqual([]);
    const preview = await createGalleryCollection(new MemoryProfileStorage(), key, policy);
    await preview.unlock('endings', 'preview-only');
    expect(reopened.snapshot().endings).toEqual(['home']);
    const local = await createGalleryCollection(storage, key, readGalleryUnlockPolicy({}));
    await local.unlock('endings', 'save-only');
    expect(local.snapshot().endings).toEqual(['home']);
    await storage.write('bad-endings', { version: 1, cgs: [], music: [], endings: null });
    await expect(createGalleryCollection(storage, 'bad-endings', policy)).rejects.toThrow('损坏');
  });
  it('opts texts in independently, reads old profiles and preserves other collection types', async () => {
    const storage = new MemoryProfileStorage();
    await storage.write('gallery', { version: 1, cgs: ['old'], music: [], extra: 'keep' });
    const policy = readGalleryUnlockPolicy({ unlockPolicy: { texts: 'profile' } });
    const collection = await createGalleryCollection(storage, 'gallery', policy);
    await collection.unlock('texts', 'memory'); await collection.unlock('cgs', 'temporary');
    const reopened = await createGalleryCollection(storage, 'gallery', policy);
    expect(effectiveGalleryUnlocks({ cgs: [], music: [] }, reopened.snapshot(), policy)).toEqual({ cgs: [], music: [], texts: ['memory'] });
    expect(await storage.read('gallery')).toEqual({ version: 1, cgs: ['old'], music: [], texts: ['memory'], endings: [], extra: 'keep', profiles: [], terms: [] });
    await storage.write('bad', { version: 1, cgs: [], music: [], texts: null });
    await expect(createGalleryCollection(storage, 'bad', policy)).rejects.toThrow('损坏');
  });
  it('keeps story snapshots and legacy behavior separate from permanent collections', async () => {
    const policy = readGalleryUnlockPolicy({ unlockPolicy: { cgs: 'profile' } });
    const storage = new MemoryProfileStorage();
    const key = await galleryCollectionKey('game-a');
    const collection = await createGalleryCollection(storage, key, policy);
    const story = new GalleryState();
    const old = story.snapshot();
    story.unlockCg('cg'); story.unlockMusic('song'); story.unlockText('replay');
    await collection.unlock('cgs', 'cg'); await collection.unlock('music', 'song');
    expect(story.snapshot()).toEqual({ cgs: ['cg'], music: ['song'], texts: ['replay'] });
    story.restore(old);
    expect(effectiveGalleryUnlocks(story.snapshot(), collection.snapshot(), policy)).toEqual({ cgs: ['cg'], music: [], texts: [] });
    expect(story.snapshot()).toEqual(old);
    const restarted = await createGalleryCollection(storage, key, policy);
    expect(effectiveGalleryUnlocks(new GalleryState().snapshot(), restarted.snapshot(), policy).cgs).toEqual(['cg']);
    expect(effectiveGalleryUnlocks(old, restarted.snapshot(), readGalleryUnlockPolicy({}))).toEqual(old);
    const other = await createGalleryCollection(storage, await galleryCollectionKey('game-b'), policy);
    expect(other.snapshot()).toEqual({ cgs: [], music: [], texts: [], endings: [] });
    const preview = await createGalleryCollection(new MemoryProfileStorage(), key, policy);
    await preview.unlock('cgs', 'preview-only');
    expect((await createGalleryCollection(storage, key, policy)).snapshot().cgs).toEqual(['cg']);
  });

  it('serializes async writes, preserves removed IDs, and only commits successful writes', async () => {
    const storage = new MemoryProfileStorage();
    await storage.write('gallery', { version: 1, cgs: ['removed'], music: [] });
    const write = vi.spyOn(storage, 'write');
    const collection = await createGalleryCollection(storage, 'gallery', { cgs: 'profile', music: 'profile' });
    write.mockRejectedValueOnce(new Error('quota'));
    await expect(collection.unlock('cgs', 'failed')).rejects.toThrow('quota');
    expect(collection.snapshot()).toEqual({ cgs: ['removed'], music: [], texts: [], endings: [] });
    await Promise.all([collection.unlock('cgs', 'a'), collection.unlock('music', 'b'), collection.unlock('cgs', 'c')]);
    expect(collection.snapshot()).toEqual({ cgs: ['removed', 'a', 'c'], music: ['b'], texts: [], endings: [] });
    expect((await createGalleryCollection(storage, 'gallery', { cgs: 'profile', music: 'profile' })).snapshot()).toEqual(collection.snapshot());
  });

  it('preserves malformed envelopes and values instead of treating them as missing', async () => {
    const setItem = vi.fn();
    const storage = new LocalStorageProfileStorage({ getItem: () => '{broken', setItem, removeItem: vi.fn() });
    expect(await storage.read('gallery')).toBeNull(); // old tolerant callers keep their contract
    await expect(createGalleryCollection(storage, 'gallery', { cgs: 'profile', music: 'save' })).rejects.toThrow('损坏');
    expect(setItem).not.toHaveBeenCalled();
    const memory = new MemoryProfileStorage();
    await memory.write('gallery', { version: 1, cgs: 'bad', music: [] });
    await expect(createGalleryCollection(memory, 'gallery', { cgs: 'profile', music: 'save' })).rejects.toThrow('损坏');
    expect(await memory.read('gallery')).toEqual({ version: 1, cgs: 'bad', music: [] });
  });

  it('rejects invalid or expanded policies and independently enables music', () => {
    expect(readGalleryUnlockPolicy({ unlockPolicy: { music: 'profile' } })).toEqual({ cgs: 'save', music: 'profile', texts: 'save', endings: 'save', profiles: 'save', terms: 'save' });
    for (const unlockPolicy of [null, [], { cgs: true }, { texts: 'always' }, { music: 'always' }]) {
      expect(() => readGalleryUnlockPolicy({ unlockPolicy })).toThrow();
    }
  });

  it('uses the shared browser lock for overlapping player sessions', async () => {
    let tail = Promise.resolve();
    const request = vi.fn((_key: string, work: () => Promise<void>) => { const task = tail.then(work); tail = task.catch(() => {}); return task; });
    vi.stubGlobal('navigator', { locks: { request } });
    try {
      const storage = new MemoryProfileStorage();
      const policy = { cgs: 'profile', music: 'profile' } as const;
      const first = await createGalleryCollection(storage, 'gallery', policy);
      const second = await createGalleryCollection(storage, 'gallery', policy);
      await Promise.all([first.unlock('cgs', 'first'), second.unlock('music', 'second')]);
      expect((await createGalleryCollection(storage, 'gallery', policy)).snapshot()).toEqual({ cgs: ['first'], music: ['second'], texts: [], endings: [] });
      expect(request).toHaveBeenCalledTimes(2);
      const write = vi.spyOn(storage, 'write');
      await first.unlock('cgs', 'first');
      expect(write).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
