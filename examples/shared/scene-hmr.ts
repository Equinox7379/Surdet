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
  type LoadedScene = { sceneId: string; replacement: ReturnType<typeof compileScene> } | { sceneId: string; error: unknown };
  let updateChain = Promise.resolve();
  options.hot.on('vite:beforeUpdate', (payload) => {
    const directPaths = payload.updates
      .map((update) => update.path.split('?')[0] ?? update.path)
      .filter((path) => path.toLowerCase().endsWith('.gal'));
    const boundaryChanged = payload.updates.some((update) => update.path.includes('scene-hmr-boundary'));
    const candidatePaths = directPaths.length > 0 ? directPaths : boundaryChanged ? Object.keys(options.sceneFiles) : [];
    updateChain = updateChain.then(async () => {
      // A self-accepting boundary can include every scene. Read that batch
      // concurrently so unchanged files do not multiply each edit's latency.
      // Registry and interpreter mutations still follow event and scene order.
      const loaded = await Promise.all(candidatePaths.map(async (candidatePath): Promise<LoadedScene | null> => {
        const cleanPath = candidatePath.split('?')[0] ?? candidatePath;
        if (!cleanPath.toLowerCase().endsWith('.gal')) return null;
        const sceneId = cleanPath.split('/').pop()?.replace(/\.gal$/i, '');
        if (!sceneId) return null;
        try {
          const sourceUrl = cleanPath.startsWith('/')
            ? new URL(cleanPath, window.location.origin).href
            : options.resolveSceneUrl(cleanPath);
          const rawUrl = `${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}raw&t=${Date.now()}`;
          const response = await fetch(rawUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return { sceneId, replacement: compileScene(await response.text(), cleanPath, sceneId) };
        } catch (error) {
          return { sceneId, error };
        }
      }));
      for (const candidate of loaded) {
        if (!candidate) continue;
        const { sceneId } = candidate;
        if ('error' in candidate) {
          console.warn(`[${options.label}] 场景热重载失败，保留旧场景 ${sceneId}：`, candidate.error);
          continue;
        }
        try {
          const { replacement } = candidate;
          const current = options.registry.get(sceneId);
          if (replacement.sceneHash === current.sceneHash) continue;
          const active = options.interpreter.saveSnapshot();
          if (active?.callStack?.some(frame => frame.sceneId === sceneId)) {
            console.warn(`[${options.label}] 热重载已跳过：场景 ${sceneId} 仍有未完成的返回点，请重新启动试玩以载入新稿`);
            continue;
          }
          const position = active?.position ?? null;
          const decision = position?.sceneId === sceneId
            ? decideSceneHotReload(sceneId, position.pc, replacement, position.sceneHash)
            : { apply: true, nextPc: 0 };
          if (!decision.apply) {
            console.warn(`[${options.label}] 热重载已跳过：${decision.diagnostic ?? '场景不匹配'}`);
            continue;
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
          console.warn(`[${options.label}] 场景热重载应用失败 ${sceneId}：`, error);
        }
      }
    });
  });
}
