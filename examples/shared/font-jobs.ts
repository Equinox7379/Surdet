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

  async function loadConfiguredFont(role: FontRole, path: string): Promise<void> {
    let url: string | null = null;
    let registered = false;
    try {
      url = await resolveFontUrl(path);
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
      if (url?.startsWith('blob:')) {
        if (registered && options.isActive()) fontBlobUrls.add(url);
        else URL.revokeObjectURL(url);
      }
    }
  }

  return function configuredFontJobs(): AssetLoadJob[] {
    return Object.entries(resolveProjectFontPaths(config)).map(([role, path]) => ({
      id: `fonts/${role}:${path}`, priority: 'critical', load: () => loadConfiguredFont(role as FontRole, path),
    }));
  };
}
