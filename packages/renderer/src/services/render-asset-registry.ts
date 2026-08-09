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
  #sourceRefs = new Map<string, number>();
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
    const slot = await this.#prepare(source, format);
    if (!slot) return;
    this.#commit(this.#backgrounds, key, slot);
  }

  async registerPortrait(
    charId: string,
    costume: string,
    expression: string,
    source: RenderAssetSource,
    format?: string,
  ): Promise<void> {
    const slot = await this.#prepare(source, format);
    if (!slot) return;
    this.#commit(this.#portraits, `${charId}:${costume}:${expression}`, slot);
  }

  async registerAvatar(key: string, source: RenderAssetSource, format?: string): Promise<void> {
    const slot = await this.#prepare(source, format);
    if (!slot) return;
    this.#commit(this.#avatars, key, slot);
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
    try {
      const face = new FontFace(family, `url(${url})`, { weight: '400' });
      const loaded = await Promise.race([
        face.load(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('字体加载超时')), timeoutMs)),
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
    const sources = new Set<string>();
    for (const map of [this.#backgrounds, this.#portraits, this.#avatars]) {
      for (const [key, slot] of [...map.entries()]) {
        if (slot.ownership !== 'loaded') continue;
        map.delete(key);
        if (slot.source) sources.add(slot.source);
        this.#releaseSlot(slot, false);
      }
    }
    if (sources.size > 0) await Promise.allSettled([this.#unload([...sources])]);
  }

  diagnosticSnapshot(): RenderAssetDiagnosticSnapshot {
    return {
      backgrounds: [...this.#backgrounds.keys()].sort(),
      portraits: [...this.#portraits.keys()].sort(),
      avatars: [...this.#avatars.keys()].sort(),
      fontFamilies: { ...this.#fontFamilies },
      sources: [...this.#sourceRefs.keys()].sort(),
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

  #prepare(source: RenderAssetSource, format?: string): Promise<AssetSlot | null> {
    const token = this.#generation.token();
    if (typeof source !== 'string') {
      return Promise.resolve(token.current ? { texture: source, ownership: 'caller' } : null);
    }
    return this.#load(source, format).then(async (texture) => {
      if (token.current) return { texture, ownership: 'loaded', source } as AssetSlot;
      if ((this.#sourceRefs.get(source) ?? 0) === 0) await this.#unload([source]);
      return null;
    });
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

  #releaseSlot(slot: AssetSlot, disposeLoaded = true): void {
    if (slot.ownership === 'generated') {
      const refs = (this.#generatedRefs.get(slot.texture) ?? 1) - 1;
      if (refs <= 0) {
        this.#generatedRefs.delete(slot.texture);
        slot.texture.destroy();
      } else {
        this.#generatedRefs.set(slot.texture, refs);
      }
    }
    if (slot.ownership === 'loaded' && slot.source) this.#releaseSource(slot.source, disposeLoaded);
  }

  #acquireSource(source: string): void {
    const refs = this.#sourceRefs.get(source) ?? 0;
    if (refs === 0) {
      this.#lifecycle.register('runtime', 'blob', `asset:${source}`, () => {
        void this.#unload([source]).catch(() => undefined);
      });
    }
    this.#sourceRefs.set(source, refs + 1);
  }

  #releaseSource(source: string, dispose = true): void {
    const refs = (this.#sourceRefs.get(source) ?? 1) - 1;
    if (refs > 0) {
      this.#sourceRefs.set(source, refs);
      return;
    }
    this.#sourceRefs.delete(source);
    if (dispose) this.#lifecycle.release('runtime', 'blob', `asset:${source}`);
    else this.#lifecycle.forget('runtime', 'blob', `asset:${source}`);
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
