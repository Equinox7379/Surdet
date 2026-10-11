import { readProjectPlugins } from '@surdet/core';
import { startPlayer, showPlayerRecovery, type PlayerProject } from './player.js';

/** Prebuilt entry: project files are data, never a new build or a project main.ts. */
export interface PlayerContentManifest {
  id: string;
  config: PlayerProject['config'];
  scenes: Record<string, string>;
  timelines: Record<string, unknown>;
  assets: string[];
  gallery?: PlayerProject['gallery'];
  terminology?: unknown;
  systems?: PlayerProject['systems'];
  trustedPlugins: string[];
}

export function contentPlayerProject(manifest: PlayerContentManifest, base: string): PlayerProject {
  const location = (relative: string) => new URL(relative.split('/').map(encodeURIComponent).join('/'), base).href;
  const declared = readProjectPlugins(manifest.config);
  return {
    id: manifest.id, config: manifest.config,
    sceneFiles: Object.fromEntries(Object.entries(manifest.scenes).map(([file, source]) => [file, async () => source])),
    timelineFiles: manifest.timelines,
    assetFiles: Object.fromEntries(manifest.assets.map(file => [file, location(`content/assets/${file}`)])),
    fontFiles: Object.fromEntries(manifest.assets.filter(file => /\.(woff2?|ttf|otf)$/i.test(file)).map(file => [`content/assets/${file}`, location(`content/assets/${file}`)])),
    gallery: manifest.gallery, terminology: manifest.terminology, systems: manifest.systems,
    resolveSceneUrl: location,
    plugins: {
      trustedIds: manifest.trustedPlugins,
      loadEntry: async entry => {
        if (!declared.some(plugin => plugin.entry === entry)) throw new Error('插件入口未声明');
        return import(/* @vite-ignore */ location(entry.replace(/\.ts$/, '.js')));
      },
    },
  };
}

export async function startContentPlayer(base = new URL('./', location.href).href): Promise<void> {
  try {
    const response = await fetch(new URL('content-manifest.json', base));
    if (!response.ok) throw new Error('无法读取作品内容清单');
    const manifest = await response.json() as PlayerContentManifest;
    document.title = manifest.config.title ?? manifest.id;
    await startPlayer(contentPlayerProject(manifest, base));
  } catch (error) { showPlayerRecovery(error); }
}
