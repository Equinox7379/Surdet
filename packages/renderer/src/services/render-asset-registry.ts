import { Assets } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { RendererFontRole } from '../api/renderer-commands.js';
import { RendererError } from '../api/renderer-errors.js';
import { AsyncGeneration } from '../lifecycle/async-generation.js';
import { RenderLifecycle } from '../lifecycle/render-lifecycle.js';
import { parsePortraitVisual, portraitVisualPaths, samplePortraitVisual, type PortraitVisualDefinition } from '@surdet/core';
import { readFontCoverage, fontTextDiagnostics, type FontCoverage, type ReadingDiagnostic } from '../reading-diagnostics.js';

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
  rules: readonly string[];
  fontFamilies: Readonly<Record<RendererFontRole, string>>;
  sources: readonly string[];
}

type AssetOwnership = 'caller' | 'loaded' | 'generated';

interface AssetSlot {
  readonly sourceIdentity?: { path: string; sha256: string };
  readonly texture: Texture;
  readonly ownership: AssetOwnership;
  readonly source?: string;
}

type AssetMap = Map<string, AssetSlot>;

export interface RegisteredPortraitVisual {
  readonly definition: PortraitVisualDefinition;
  readonly images: ReadonlyMap<string, Texture>;
  readonly key: string;
}

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
  #portraitVisuals = new Map<string, { value: RegisteredPortraitVisual; assets: AssetMap }>();
  #visualRequests = new Map<string, object>();
  #visualLoads = new Set<Promise<void>>();
  #avatars: AssetMap = new Map();
  #rules: AssetMap = new Map();
  #videos = new Map<string, { url: string; sourcePath?: string }>();
  #registrations = new WeakMap<AssetMap, Map<string, object>>();
  #sourceRefs = new Map<string, number>();
  #sourceLoads = new Map<string, Promise<void>>();
  #sourceReleases = new Map<string, { promise: Promise<void>; failed: boolean }>();
  #generatedRefs = new Map<Texture, number>();
  #fontFaces = new Map<RendererFontRole, { face: FontFace; family: string; coverage: FontCoverage }>();
  #fontRequests = new Map<RendererFontRole, object>();
  #fontSourceReads = new Map<string, { bytes: Promise<ArrayBuffer>; abort: AbortController; readers: number }>();
  #fontFamilies: Record<RendererFontRole, string> = { ...DEFAULT_RENDERER_FONT_FAMILIES };
  #disposed = false;
  #verifiedBlobUrls = new Set<string>();

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
    sourcePath?: string,
  ): Promise<void> {
    this.#ensureActive('registerPortrait');
    const id = `${charId}:${costume}:${expression}`, ticket = {}, token = this.#generation.token(), staged: AssetMap = new Map();
    this.#visualRequests.set(id, ticket);
    const work = (async () => {
      try {
        await this.#register(staged, id, source, format, sourcePath);
        if (!token.current || this.#visualRequests.get(id) !== ticket) return;
        this.#commit(this.#portraits, id, staged.get(id)!);
        this.#clearPortraitVisual(id);
      } finally {
        this.#clearMap(staged);
        if (this.#visualRequests.get(id) === ticket) this.#visualRequests.delete(id);
      }
    })();
    this.#visualLoads.add(work);
    try { await work; } finally { this.#visualLoads.delete(work); }
  }

  async registerPortraitVisual(charId: string, costume: string, expression: string, input: PortraitVisualDefinition,
    sources: Readonly<Record<string, { source: RenderAssetSource; format?: string }>>): Promise<void> {
    this.#ensureActive('registerPortraitVisual');
    const definition = parsePortraitVisual(input), paths = portraitVisualPaths(definition);
    for (const path of paths) if (!Object.hasOwn(sources, path)) throw new Error(`动态立绘图片未提供：${path}`);
    const id = `${charId}:${costume}:${expression}`, ticket = {}, token = this.#generation.token(), assets: AssetMap = new Map();
    this.#visualRequests.set(id, ticket);
    const work = (async () => {
      try {
        const results = await Promise.allSettled(paths.map(path => this.#register(assets, path, sources[path]!.source, sources[path]!.format,
          typeof sources[path]!.source === 'string' ? path : undefined)));
        const failed = results.find(value => value.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        if (!token.current || this.#visualRequests.get(id) !== ticket) throw new Error('动态立绘注册已取消');
        const first = assets.get(paths[0]!)!.texture;
        for (const [path, item] of assets) if (item.texture.width !== first.width || item.texture.height !== first.height)
          throw new Error(`动态立绘需要一致画布尺寸：${path}`);
        const value: RegisteredPortraitVisual = { definition, images: new Map([...assets].map(([path, item]) => [path, item.texture])),
          key: JSON.stringify({ definition, images: paths.map(path => { const item = assets.get(path)!; return [path, item.sourceIdentity?.sha256 ?? null, item.texture.width, item.texture.height]; }) }) };
        this.#clearPortraitVisual(id);
        const staticSlot = this.#portraits.get(id);
        if (staticSlot) { this.#portraits.delete(id); this.#releaseSlot(staticSlot); }
        this.#portraitVisuals.set(id, { value, assets });
      } catch (error) { this.#clearMap(assets); throw error; }
      finally { if (this.#visualRequests.get(id) === ticket) this.#visualRequests.delete(id); }
    })();
    this.#visualLoads.add(work);
    try { await work; } finally { this.#visualLoads.delete(work); }
  }

  resolvePortraitVisual(charId: string, costume: string, expression: string): RegisteredPortraitVisual | null {
    return this.#portraitVisuals.get(`${charId}:${costume}:${expression}`)?.value ?? null;
  }

  #clearPortraitVisual(id: string): void {
    const old = this.#portraitVisuals.get(id);
    if (old) { this.#portraitVisuals.delete(id); this.#clearMap(old.assets); }
  }

  async registerAvatar(key: string, source: RenderAssetSource, format?: string): Promise<void> {
    await this.#register(this.#avatars, key, source, format);
  }
  async registerRule(key: string, source: RenderAssetSource, format?: string): Promise<void> { await this.#register(this.#rules, key, source, format); }
  resolveRule(key: string): Texture | null { return this.#rules.get(key)?.texture ?? null; }

  resolveBackground(key: string): Texture | null {
    return this.#backgrounds.get(key)?.texture ?? null;
  }

  resolvePortrait(charId: string, costume: string, expression: string): Texture | null {
    const visual = this.resolvePortraitVisual(charId, costume, expression);
    if (visual) return visual.images.get(samplePortraitVisual(visual.definition, 0, false, false).images[0]!)!;
    return this.#portraits.get(`${charId}:${costume}:${expression}`)?.texture ?? null;
  }

  resolvePortraitIdentity(charId: string, costume: string, expression: string): import('@surdet/core').StageImageSource | null {
    const id = `${charId}:${costume}:${expression}`, visual = this.#portraitVisuals.get(id);
    const slot = visual ? visual.assets.get(samplePortraitVisual(visual.value.definition, 0, false, false).images[0]!) : this.#portraits.get(id);
    return slot?.sourceIdentity ? { ...slot.sourceIdentity, width: slot.texture.width, height: slot.texture.height } : null;
  }

  resolveAvatar(key: string): Texture | null {
    return this.#avatars.get(key)?.texture ?? null;
  }

  async registerVideo(key: string, source: string, sourcePath?: string): Promise<void> {
    this.#ensureActive('registerVideo');
    this.#videos.set(key, { url: source, ...(sourcePath === undefined ? {} : { sourcePath }) });
  }

  resolveVideo(key: string): { url: string; sourcePath?: string } | null {
    return this.#videos.get(key) ?? null;
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
    // This covers transfer and browser decoding, including large bundled CJK fonts.
    timeoutMs = 15000,
  ): Promise<boolean> {
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return false;
    this.#ensureActive('registerFontRole');
    const token = this.#generation.token();
    const request = {};
    this.#fontRequests.set(role, request);
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const { loaded, bytes } = await Promise.race([
        (async () => {
          const bytes = await this.#readFontBytes(url, abort.signal);
          const loaded = await new FontFace(family, bytes, { weight: '400' }).load();
          return { loaded, bytes };
        })(),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => {
          abort.abort(); reject(new Error('字体加载超时'));
        }, timeoutMs); }),
      ]);
      if (timeout !== undefined) clearTimeout(timeout);
      if (!token.current || this.#fontRequests.get(role) !== request) return false;

      // Failure/timeout of the diagnostic decoder must not turn a usable font into a load failure.
      const coverage = await Promise.race([
        readFontCoverage(new Uint8Array(bytes)),
        new Promise<FontCoverage>(resolve => { timeout = setTimeout(() => resolve({ characters: null, error: '字形覆盖检查超时' }), Math.min(timeoutMs, 3000)); }),
      ]);
      if (!token.current || this.#fontRequests.get(role) !== request) return false;

      const fontSet = document.fonts as unknown as {
        add: (font: FontFace) => void;
        delete?: (font: FontFace) => boolean;
      };
      this.#lifecycle.release('runtime', 'blob', `font:${role}`);
      fontSet.add(loaded);
      this.#fontFaces.set(role, { face: loaded, family, coverage });
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

  async #readFontBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
    const read = async (signal: AbortSignal): Promise<ArrayBuffer> => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`字体读取失败：${response.status}`);
      return response.arrayBuffer();
    };
    // A blob URL identifies immutable bytes. Mutable file/HTTP URLs still read independently.
    // Keep only in-flight transfers, never a successful/failed result for a later registration.
    if (!url.startsWith('blob:')) return read(signal);
    let source = this.#fontSourceReads.get(url);
    if (!source) {
      const abort = new AbortController();
      source = { bytes: read(abort.signal), abort, readers: 0 };
      this.#fontSourceReads.set(url, source);
      const pending = source;
      const forget = () => { if (this.#fontSourceReads.get(url) === pending) this.#fontSourceReads.delete(url); };
      void source.bytes.then(forget, forget);
    }
    source.readers++;
    let onAbort!: () => void;
    try {
      return await new Promise<ArrayBuffer>((resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        source.bytes.then(resolve, reject);
      });
    } finally {
      signal.removeEventListener('abort', onAbort);
      source.readers--;
      if (source.readers === 0 && this.#fontSourceReads.get(url) === source) {
        this.#fontSourceReads.delete(url);
        source.abort.abort();
      }
    }
  }

  fontFamily(role: RendererFontRole): string {
    return this.#fontFamilies[role];
  }

  fontDiagnostics(role: RendererFontRole, text: string, target: string): ReadingDiagnostic[] {
    return fontTextDiagnostics(this.#fontFaces.get(role)?.coverage, role, this.fontFamily(role), text, target);
  }

  resetFonts(): void {
    if (this.#disposed) return;
    this.#resetFontsInternal();
  }

  #resetFontsInternal(): void {
    this.#fontRequests.clear();
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
    if (clearAssets) for (const id of this.#portraitVisuals.keys()) this.#clearPortraitVisual(id);
    if (clearAssets) this.#videos.clear();
    this.#resetMap(this.#backgrounds, clearAssets);
    this.#resetMap(this.#portraits, clearAssets);
    this.#resetMap(this.#avatars, clearAssets);
    this.#resetMap(this.#rules, clearAssets);
  }

  async releaseRegisteredAssetSources(): Promise<void> {
    this.#ensureActive('releaseRegisteredAssetSources');
    this.#videos.clear();
    this.#visualRequests.clear();
    const visualPending = await Promise.allSettled([...this.#visualLoads]);
    for (const id of this.#portraitVisuals.keys()) this.#clearPortraitVisual(id);
    // Synchronous reset/dispose can start an unload before this awaited barrier.
    // Failed attempts remain owned until the caller explicitly retries release.
    for (const [source, release] of this.#sourceReleases) {
      if (release.failed) this.#unloadSource(source, true);
    }
    const pending = await Promise.allSettled([...this.#sourceLoads.values()]);
    for (const map of [this.#backgrounds, this.#portraits, this.#avatars, this.#rules]) {
      for (const [key, slot] of [...map.entries()]) {
        if (slot.ownership !== 'loaded') continue;
        map.delete(key);
        this.#releaseSlot(slot);
      }
    }
    const results = await Promise.allSettled([...this.#sourceReleases.values()].map(({ promise }) => promise));
    const failure = [...visualPending, ...pending, ...results].find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  diagnosticSnapshot(): RenderAssetDiagnosticSnapshot {
    return {
      backgrounds: [...this.#backgrounds.keys()].sort(),
      portraits: [...this.#portraits.keys(), ...this.#portraitVisuals.keys()].sort(),
      avatars: [...this.#avatars.keys()].sort(),
      rules: [...this.#rules.keys()].sort(),
      fontFamilies: { ...this.#fontFamilies },
      sources: [...new Set([...this.#sourceRefs.keys(), ...this.#sourceLoads.keys(), ...this.#sourceReleases.keys()])].sort(),
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#generation.dispose();
    this.#clearMap(this.#backgrounds);
    this.#clearMap(this.#portraits);
    this.#visualRequests.clear();
    for (const id of this.#portraitVisuals.keys()) this.#clearPortraitVisual(id);
    this.#clearMap(this.#avatars);
    this.#clearMap(this.#rules);
    this.#videos.clear();
    this.#resetFontsInternal();
    this.#lifecycle.release('runtime', 'async', 'asset-generation');
    this.#disposed = true;
    if (this.#ownsLifecycle) this.#lifecycle.dispose();
  }

  async #register(map: AssetMap, key: string, source: RenderAssetSource, format?: string, sourcePath?: string): Promise<void> {
    const token = this.#generation.token();
    let requests = this.#registrations.get(map);
    if (!requests) { requests = new Map(); this.#registrations.set(map, requests); }
    const request = {};
    requests.set(key, request);
    if (typeof source !== 'string') {
      if (sourcePath) throw new Error('Pinned calibration requires verified image bytes, not a caller-supplied Texture');
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
      let actualSource = source;
      let sourceIdentity: AssetSlot['sourceIdentity'];
      if (sourcePath) {
        const response = await fetch(source, { cache: 'no-store' });
        if (!response.ok) throw new Error(`校准来源图片读取失败：${sourcePath}`);
        const body = await response.arrayBuffer();
        if (!body.byteLength || body.byteLength > 128 * 1024 * 1024) throw new Error('校准图片大小超出支持范围');
        const digest = await crypto.subtle.digest('SHA-256', body);
        sourceIdentity = { path: sourcePath, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
        if (!token.current || requests.get(key) !== request) return;
        // Decode precisely the bytes hashed above. A later file edit cannot
        // race the digest or reuse a stale Pixi cache entry under the old URL.
        actualSource = URL.createObjectURL(new Blob([body], { type: response.headers.get('content-type') ?? 'application/octet-stream' }));
        this.#verifiedBlobUrls.add(actualSource);
      }
      try {
        const texture = await this.#load(actualSource, format);
        if (token.current && requests.get(key) === request) this.#commit(map, key, { texture, ownership: 'loaded', source: actualSource, ...(sourceIdentity ? { sourceIdentity } : {}) });
        else if ((this.#sourceRefs.get(actualSource) ?? 0) === 0) await this.#unloadSource(actualSource);
      } catch (error) {
        if (this.#verifiedBlobUrls.delete(actualSource)) URL.revokeObjectURL(actualSource);
        throw error;
      }
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
    const promise = (async () => { await this.#unload([source]); if (this.#verifiedBlobUrls.delete(source)) URL.revokeObjectURL(source); })();
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
