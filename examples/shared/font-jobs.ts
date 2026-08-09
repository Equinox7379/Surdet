import type { AssetCommands, AssetLoadJob, FontRole } from '@surdet/renderer';

interface FontConfig {
  font?: unknown;
  fonts?: unknown;
}

export interface ConfiguredFontJobOptions {
  config: unknown;
  fontBlobUrls: Set<string>;
  label: string;
  resolveFontUrl: (fontPath: string) => Promise<string | null>;
  assets: Pick<AssetCommands, 'registerFontRole' | 'registerFont'>;
}

export function createConfiguredFontJobs(options: ConfiguredFontJobOptions): () => AssetLoadJob[] {
  const { config, fontBlobUrls, label, resolveFontUrl, assets } = options;

  async function loadConfiguredFont(role: FontRole, path: string): Promise<void> {
    const url = await resolveFontUrl(path);
    if (!url) {
      console.warn(`[${label}] 未找到 ${role} 字体文件，使用回退字体：`, path);
      return;
    }
    let registered = false;
    try {
      registered = await assets.registerFontRole(role, url);
      if (registered) console.info(`[${label}] ${role} 字体已加载：`, path);
    } finally {
      if (url.startsWith('blob:')) {
        if (registered) fontBlobUrls.add(url);
        else URL.revokeObjectURL(url);
      }
    }
  }

  return function configuredFontJobs(): AssetLoadJob[] {
    const cfg = config as FontConfig & { fonts?: Partial<Record<FontRole, string>> };
    const roles: FontRole[] = ['body', 'title', 'ui'];
    const configured = cfg.fonts && typeof cfg.fonts === 'object' ? cfg.fonts : null;
    const jobs: AssetLoadJob[] = [];
    if (configured) {
      for (const role of roles) {
        const path = configured[role];
        if (typeof path !== 'string' || path.length === 0) continue;
        jobs.push({ id: `fonts/${role}:${path}`, priority: 'critical', load: () => loadConfiguredFont(role, path) });
      }
      return jobs;
    }
    if (typeof cfg.font === 'string' && cfg.font.length > 0) {
      jobs.push({ id: `fonts/legacy:${cfg.font}`, priority: 'critical', load: async () => {
        const url = await resolveFontUrl(cfg.font as string);
        if (!url) {
          console.warn(`[${label}] 未找到字体文件，回退系统字体：`, cfg.font);
          return;
        }
        let registered = false;
        try {
          registered = await assets.registerFont(url);
          if (registered) console.info(`[${label}] 兼容单字体已加载：`, cfg.font);
        } finally {
          if (url.startsWith('blob:')) {
            if (registered) fontBlobUrls.add(url);
            else URL.revokeObjectURL(url);
          }
        }
      } });
    }
    return jobs;
  };
}
