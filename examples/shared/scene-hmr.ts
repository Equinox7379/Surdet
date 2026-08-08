import { compileScene, type Interpreter, type SceneRegistry } from '@surdet/core';
import { decideSceneHotReload } from '@surdet/renderer';

interface HotUpdate {
  path: string;
}

interface HotUpdatePayload {
  updates: readonly HotUpdate[];
}

export interface SceneHotModule {
  accept(): void;
  on(event: 'vite:beforeUpdate', callback: (payload: HotUpdatePayload) => void): void;
}

export interface SceneHmrOptions {
  hot: SceneHotModule;
  registry: SceneRegistry;
  interpreter: Interpreter;
  label: string;
  sceneFiles: Record<string, () => Promise<unknown>>;
  resolveSceneUrl: (path: string) => string;
}

export function installSceneHotReload(options: SceneHmrOptions): void {
  let updateChain = Promise.resolve();
  options.hot.on('vite:beforeUpdate', (payload) => {
    const directPaths = payload.updates
      .map((update) => update.path.split('?')[0] ?? update.path)
      .filter((path) => path.toLowerCase().endsWith('.gal'));
    const boundaryChanged = payload.updates.some((update) => update.path.includes('scene-hmr-boundary'));
    const candidatePaths = directPaths.length > 0 ? directPaths : boundaryChanged ? Object.keys(options.sceneFiles) : [];
    for (const candidatePath of candidatePaths) {
      const cleanPath = candidatePath.split('?')[0] ?? candidatePath;
      if (!cleanPath.toLowerCase().endsWith('.gal')) continue;
      updateChain = updateChain.then(async () => {
        const sceneId = cleanPath.split('/').pop()?.replace(/\.gal$/i, '');
        if (!sceneId) return;
        try {
          const sourceUrl = cleanPath.startsWith('/')
            ? new URL(cleanPath, window.location.origin).href
            : options.resolveSceneUrl(cleanPath);
          const rawUrl = `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}raw&t=${Date.now()}`;
          const response = await fetch(rawUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const replacement = compileScene(await response.text(), cleanPath, sceneId);
          const current = options.registry.get(sceneId);
          if (replacement.sceneHash === current.sceneHash) return;
          const active = options.interpreter.saveSnapshot();
          const position = active?.position ?? null;
          const decision = position?.sceneId === sceneId
            ? decideSceneHotReload(sceneId, position.pc, replacement, position.sceneHash)
            : { apply: true, nextPc: 0 };
          if (!decision.apply) {
            console.warn(`[${options.label}] 热重载已跳过：${decision.diagnostic ?? '场景不匹配'}`);
            return;
          }
          options.registry.replace(replacement, sceneId);
          if (active && position?.sceneId === sceneId) {
            options.interpreter.loadSnapshot({
              ...active,
              position: { ...position, pc: decision.nextPc, sceneHash: replacement.sceneHash },
            });
          }
          if (decision.diagnostic) console.info(`[${options.label}] ${decision.diagnostic}`);
        } catch (error) {
          console.warn(`[${options.label}] 场景热重载失败，保留旧场景 ${sceneId}：`, error);
        }
      });
    }
  });
}
