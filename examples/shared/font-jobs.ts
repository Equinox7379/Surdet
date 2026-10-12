import type { AssetCommands, AssetLoadJob, FontRole } from '@surdet/renderer';
import { resolveProjectFontPaths } from '@surdet/core';

/** Asset maps use asset-root paths; older Player callers pass Vite glob paths. Never match a basename. */
export function resolveBundledFontUrl(path: string, assetFiles: Record<string, string>, fontFiles: Record<string, string> = {}): string | null {
  const relative = path.replace(/^content\/assets\//, '');
  if (Object.hasOwn(assetFiles, relative)) return assetFiles[relative]!;
  for (const [key, url] of Object.entries(fontFiles)) {
    if (key.replace(/^(?:\.\.?\/)+/, '') === `content/assets/${relative}`) return url;
  }
  return null;
}

export interface ConfiguredFontJobOptions {
  config: unknown;
  fontBlobUrls: Set<string>;
  label: string;
  resolveFontUrl: (fontPath: string) => Promise<string | null>;
  assets: Pick<AssetCommands, 'registerFontRole' | 'registerFont'>;
  onError?: (message: string) => void;
  isActive: () => boolean;
}

export function createConfiguredFontJobs(options: ConfiguredFontJobOptions): () => AssetLoadJob[] {
  const { config, fontBlobUrls, label, resolveFontUrl, assets } = options;

  async function loadConfiguredFont(role: FontRole, path: string, source: { url?: Promise<string | null>; remaining: number }): Promise<void> {
    let url: string | null = null;
    let registered = false;
    try {
      url = await (source.url ??= resolveFontUrl(path));
      if (!options.isActive()) return;
      if (!url) throw new Error('未找到字体文件');
      registered = await assets.registerFontRole(role, url);
      if (!options.isActive()) return;
      if (!registered) throw new Error('字体无法解码或加载超时');
      if (registered) console.info(`[${label}] ${role} 字体已加载：`, path);
    } catch (error) {
      if (!options.isActive()) return;
      const message = `${role} 字体加载失败：${path}（${error instanceof Error ? error.message : String(error)}）；使用默认字体。`;
      console.error(`[${label}] ${message}`);
      options.onError?.(message);
      throw new Error(message, { cause: error });
    } finally {
      if (registered && options.isActive() && url?.startsWith('blob:')) fontBlobUrls.add(url);
      // A failed role must not revoke the URL while another role is still decoding it.
      source.remaining--;
      if (source.remaining === 0 && url?.startsWith('blob:') && !fontBlobUrls.has(url)) URL.revokeObjectURL(url);
    }
  }

  return function configuredFontJobs(): AssetLoadJob[] {
    const entries = Object.entries(resolveProjectFontPaths(config));
    // Share only within this load batch; a later batch re-reads changed files and retries failures.
    const sources = new Map<string, { url?: Promise<string | null>; remaining: number }>();
    for (const [, path] of entries) {
      const source = sources.get(path);
      if (source) source.remaining++;
      else sources.set(path, { remaining: 1 });
    }
    return entries.map(([role, path]) => ({
      id: `fonts/${role}:${path}`, priority: 'critical', load: () => loadConfiguredFont(role as FontRole, path, sources.get(path)!),
    }));
  };
}
