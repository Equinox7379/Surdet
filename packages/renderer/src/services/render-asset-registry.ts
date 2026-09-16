import { Assets } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { RendererFontRole } from '../api/renderer-commands.js';
import { RendererError } from '../api/renderer-errors.js';
import { AsyncGeneration } from '../lifecycle/async-generation.js';
import { RenderLifecycle } from '../lifecycle/render-lifecycle.js';

export type RenderAssetSource = string | Texture;

export const DEFAULT_RENDERER_FONT_FAMILIES: Readonly<Record<RendererFontRole, string>> = {
  title: "'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', 'STSong', 'SimSun', serif",
  body: "'Source Han Sans SC', 'Noto Sans CJK SC', '源ノ角ゴシック', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Yu Gothic', sans-serif",
  ui: "'Source Han Sans SC', 'Noto Sans CJK SC', '源ノ角ゴシック', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Yu Gothic', sans-serif",
};

export interface RenderAssetRegistryOptions {
  lifecycle?: RenderLifecycle;
  generation?: AsyncGeneration;
  load?: (source: string, format?: string) => Promise<Texture>;
  unload?: (sources: readonly string[]) => Promise<void>;
}

export interface RenderAssetDiagnosticSnapshot {
  backgrounds: readonly string[];
  portraits: readonly string[];
  avatars: readonly string[];
  fontFamilies: Readonly<Record<RendererFontRole, string>>;
  sources: readonly string[];
}

type AssetOwnership = 'caller' | 'loaded' | 'generated';

interface AssetSlot {
  readonly texture: Texture;
  readonly ownership: AssetOwnership;
  readonly source?: string;
}

type AssetMap = Map<string, AssetSlot>;

function assetParser(format: string | undefined, source: string): 'loadSVG' | 'loadTextures' | undefined {
  const value = (format ?? source.split('?')[0]?.split('#')[0]?.split('.').pop() ?? '').toLowerCase();
  if (value === 'svg' || value === 'image/svg+xml') return 'loadSVG';
  if (value.startsWith('image/') || /^(png|jpg|jpeg|webp|gif|avif)$/.test(value)) return 'loadTextures';
  return undefined;
}

async function loadWithPixi(source: string, format?: string): Promise<Texture> {
  const parser = assetParser(format, source);
  return await Assets.load(parser ? { src: source, parser } : source) as Texture;
}

async function unloadWithPixi(sources: readonly string[]): Promise<void> {
  if (sources.length === 0) return;
  await Assets.unload([...sources]);
}

/**
 * The single renderer-owned registry for backgrounds, portraits, avatars,
 * fonts, loaded source URLs, and generated fallback textures.
 *
 * Texture objects supplied by a host are caller-owned. Only generated
 * textures are destroyed directly; URL-backed resources are released through
 * Pixi Assets.unload after their last registry reference disappears.
 */
export class RenderAssetRegistry {
  readonly #lifecycle: RenderLifecycle;
  readonly #generation: AsyncGeneration;
  readonly #ownsLifecycle: boolean;
  readonly #load: (source: string, format?: string) => Promise<Texture>;
  readonly #unload: (sources: readonly string[]) => Promise<void>;
  #backgrounds: AssetMap = new Map();
  #portraits: AssetMap = new Map();
  #avatars: AssetMap = new Map();
  #registrations = new WeakMap<AssetMap, Map<string, object>>();
  #sourceRefs = new Map<string, number>();
  #sourceLoads = new Map<string, Promise<void>>();
  #sourceReleases = new Map<string, { promise: Promise<void>; failed: boolean }>();
  #generatedRefs = new Map<Texture, number>();
  #fontFaces = new Map<RendererFontRole, { face: FontFace; family: string }>();
  #fontFamilies: Record<RendererFontRole, string> = { ...DEFAULT_RENDERER_FONT_FAMILIES };
  #disposed = false;

  constructor(options: RenderAssetRegistryOptions = {}) {
    this.#lifecycle = options.lifecycle ?? new RenderLifecycle();
    this.#generation = options.generation ?? new AsyncGeneration();
    this.#ownsLifecycle = options.lifecycle === undefined;
    this.#load = options.load ?? loadWithPixi;
    this.#unload = options.unload ?? unloadWithPixi;
    this.#lifecycle.register('runtime', 'async', 'asset-generation', () => this.#generation.dispose());
  }

  async registerBackground(key: string, source: RenderAssetSource, format?: string): Promise<void> {
    await this.#register(this.#backgrounds, key, source, format);
  }

  async registerPortrait(
    charId: string,
    costume: string,
    expression: string,
    source: RenderAssetSource,
    format?: string,
  ): Promise<void> {
    await this.#register(this.#portraits, `${charId}:${costume}:${expression}`, source, format);
  }

  async registerAvatar(key: string, source: RenderAssetSource, format?: string): Promise<void> {
    await this.#register(this.#avatars, key, source, format);
  }

  resolveBackground(key: string): Texture | null {
    return this.#backgrounds.get(key)?.texture ?? null;
  }

  resolvePortrait(charId: string, costume: string, expression: string): Texture | null {
    return this.#portraits.get(`${charId}:${costume}:${expression}`)?.texture ?? null;
  }

  resolveAvatar(key: string): Texture | null {
    return this.#avatars.get(key)?.texture ?? null;
  }

  getOrCreateBackground(key: string, create: () => Texture): Texture {
    return this.#getOrCreate(this.#backgrounds, key, create);
  }

  getOrCreatePortrait(key: string, create: () => Texture): Texture {
    return this.#getOrCreate(this.#portraits, key, create);
  }

  async registerFontRole(
    role: RendererFontRole,
    url: string,
    family = `SurdetGame${role[0]!.toUpperCase()}${role.slice(1)}Font`,
    timeoutMs = 3000,
  ): Promise<boolean> {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
    const token = this.#generation.token();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const face = new FontFace(family, `url(${url})`, { weight: '400' });
      const loaded = await Promise.race([
        face.load(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('字体加载超时')), timeoutMs); }),
      ]);
      if (!token.current) return false;

      const fontSet = document.fonts as unknown as {
        add: (font: FontFace) => void;
        delete?: (font: FontFace) => boolean;
      };
      this.#lifecycle.release('runtime', 'blob', `font:${role}`);
      fontSet.add(loaded);
      this.#fontFaces.set(role, { face: loaded, family });
      this.#fontFamilies[role] = family;
      this.#lifecycle.register('runtime', 'blob', `font:${role}`, () => {
        fontSet.delete?.(loaded);
        if (this.#fontFaces.get(role)?.face === loaded) this.#fontFaces.delete(role);
      });
      return true;
    } catch {
      return false;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  fontFamily(role: RendererFontRole): string {
    return this.#fontFamilies[role];
  }

  resetFonts(): void {
    if (this.#disposed) return;
    this.#resetFontsInternal();
  }

  #resetFontsInternal(): void {
    for (const role of ['title', 'body', 'ui'] as const) {
      this.#lifecycle.release('runtime', 'blob', `font:${role}`);
    }
    this.#fontFaces.clear();
    this.#fontFamilies = { ...DEFAULT_RENDERER_FONT_FAMILIES };
  }

  reset(options: { clearAssets?: boolean; preserveAssets?: boolean } = {}): void {
    this.#ensureActive('reset');
    this.#generation.advance();
    if (options.preserveAssets) return;
    const clearAssets = options.clearAssets === true;
    this.#resetMap(this.#backgrounds, clearAssets);
    this.#resetMap(this.#portraits, clearAssets);
    this.#resetMap(this.#avatars, clearAssets);
  }

  async releaseRegisteredAssetSources(): Promise<void> {
    this.#ensureActive('releaseRegisteredAssetSources');
    // Synchronous reset/dispose can start an unload before this awaited barrier.
    // Failed attempts remain owned until the caller explicitly retries release.
    for (const [source, release] of this.#sourceReleases) {
      if (release.failed) this.#unloadSource(source, true);
    }
    const pending = await Promise.allSettled([...this.#sourceLoads.values()]);
    for (const map of [this.#backgrounds, this.#portraits, this.#avatars]) {
      for (const [key, slot] of [...map.entries()]) {
        if (slot.ownership !== 'loaded') continue;
        map.delete(key);
        this.#releaseSlot(slot);
      }
    }
    const results = await Promise.allSettled([...this.#sourceReleases.values()].map(({ promise }) => promise));
    const failure = [...pending, ...results].find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  diagnosticSnapshot(): RenderAssetDiagnosticSnapshot {
    return {
      backgrounds: [...this.#backgrounds.keys()].sort(),
      portraits: [...this.#portraits.keys()].sort(),
      avatars: [...this.#avatars.keys()].sort(),
      fontFamilies: { ...this.#fontFamilies },
      sources: [...new Set([...this.#sourceRefs.keys(), ...this.#sourceLoads.keys(), ...this.#sourceReleases.keys()])].sort(),
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#generation.dispose();
    this.#clearMap(this.#backgrounds);
    this.#clearMap(this.#portraits);
    this.#clearMap(this.#avatars);
    this.#resetFontsInternal();
    this.#lifecycle.release('runtime', 'async', 'asset-generation');
    this.#disposed = true;
    if (this.#ownsLifecycle) this.#lifecycle.dispose();
  }

  async #register(map: AssetMap, key: string, source: RenderAssetSource, format?: string): Promise<void> {
    const token = this.#generation.token();
    let requests = this.#registrations.get(map);
    if (!requests) { requests = new Map(); this.#registrations.set(map, requests); }
    const request = {};
    requests.set(key, request);
    if (typeof source !== 'string') {
      this.#commit(map, key, { texture: source, ownership: 'caller' });
      requests.delete(key);
      return;
    }
    const previous = this.#sourceLoads.get(source);
    const pending = (async () => {
      // A previous registration reports its own load error; a new request may
      // try loading again. Failed unloads remain owned and still block reuse.
      if (previous) await previous.catch(() => undefined);
      const release = this.#sourceReleases.get(source);
      if (release) await release.promise;
      if (!token.current) return;
      const texture = await this.#load(source, format);
      if (token.current && requests.get(key) === request) this.#commit(map, key, { texture, ownership: 'loaded', source });
      else if ((this.#sourceRefs.get(source) ?? 0) === 0) await this.#unloadSource(source);
    })();
    this.#sourceLoads.set(source, pending);
    const settled = (): void => {
      if (this.#sourceLoads.get(source) === pending) this.#sourceLoads.delete(source);
      if (requests.get(key) === request) requests.delete(key);
    };
    void pending.then(settled, settled);
    await pending;
  }

  #commit(map: AssetMap, key: string, slot: AssetSlot): void {
    const old = map.get(key);
    if (slot.ownership === 'loaded' && slot.source) this.#acquireSource(slot.source);
    if (slot.ownership === 'generated') this.#retainGenerated(slot.texture);
    map.set(key, slot);
    if (old) this.#releaseSlot(old);
  }

  #getOrCreate(map: AssetMap, key: string, create: () => Texture): Texture {
    const existing = map.get(key);
    if (existing) return existing.texture;
    const texture = create();
    this.#commit(map, key, { texture, ownership: 'generated' });
    return texture;
  }

  #resetMap(map: AssetMap, clearAssets: boolean): void {
    for (const [key, slot] of [...map.entries()]) {
      if (!clearAssets && slot.ownership !== 'generated') continue;
      map.delete(key);
      this.#releaseSlot(slot);
    }
  }

  #clearMap(map: AssetMap): void {
    for (const slot of map.values()) this.#releaseSlot(slot);
    map.clear();
  }

  #retainGenerated(texture: Texture): void {
    this.#generatedRefs.set(texture, (this.#generatedRefs.get(texture) ?? 0) + 1);
  }

  #releaseSlot(slot: AssetSlot): void {
    if (slot.ownership === 'generated') {
      const refs = (this.#generatedRefs.get(slot.texture) ?? 1) - 1;
      if (refs <= 0) {
        this.#generatedRefs.delete(slot.texture);
        slot.texture.destroy(true);
      } else {
        this.#generatedRefs.set(slot.texture, refs);
      }
    }
    if (slot.ownership === 'loaded' && slot.source) this.#releaseSource(slot.source);
  }

  #acquireSource(source: string): void {
    const refs = this.#sourceRefs.get(source) ?? 0;
    if (refs === 0) {
      this.#lifecycle.register('runtime', 'blob', `asset:${source}`, () => {
        this.#unloadSource(source);
      });
    }
    this.#sourceRefs.set(source, refs + 1);
  }

  #releaseSource(source: string): void {
    const refs = (this.#sourceRefs.get(source) ?? 1) - 1;
    if (refs > 0) {
      this.#sourceRefs.set(source, refs);
      return;
    }
    this.#sourceRefs.delete(source);
    this.#lifecycle.release('runtime', 'blob', `asset:${source}`);
  }

  #unloadSource(source: string, retry = false): Promise<void> {
    const previous = this.#sourceReleases.get(source);
    if (previous && (!retry || !previous.failed)) return previous.promise;
    const promise = (async () => { await this.#unload([source]); })();
    const release = { promise, failed: false };
    this.#sourceReleases.set(source, release);
    // Observe rejection for synchronous lifecycle callers, while preserving the
    // rejected promise for releaseRegisteredAssetSources to report and retry.
    void promise.then(() => {
      if (this.#sourceReleases.get(source) === release) this.#sourceReleases.delete(source);
    }, () => { release.failed = true; });
    return promise;
  }

  #ensureActive(command: string): void {
    if (this.#disposed) {
      throw new RendererError(`Renderer asset registry is disposed: ${command}`, {
        code: 'RENDERER_DISPOSED',
        domain: 'assets',
        command,
      });
    }
  }
}
