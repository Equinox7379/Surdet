/**
 * 游戏入口：解释器 + Renderer v2 Runtime + 程序化占位素材。
 * 替换 content/ 下的剧本、game.config.json 与素材即可做成新游戏。
 */
import {
  compileScene,
  Interpreter,
  SceneRegistry,
  EventBus,
  VariableStore,
  SaveManager,
  QUICK_SLOT,
  AUTO_SLOT,
} from '@surdet/core';
import type { VarDeclaration, SaveStorage, SaveSnapshot, CoreEventMap } from '@surdet/core';
import {
  AudioManager,
  AssetLoadQueue,
  RollbackBuffer,
  actionForKeyboardEvent,
  createRendererRuntime,
  decideSceneHotReload,
  rendererInputForGameAction,
} from '@surdet/renderer';
import type { AssetLoadJob, AssetPriority, GameAction } from '@surdet/renderer';
import {
  PlayerInputGate,
  canAdvance,
  connectSystemRouter,
  createDefaultHost,
  createPlayerUiSession,
  shouldRestoreInterfaceOnPointer,
} from '@surdet/host';
import gameConfig from '../game.config.json';
import { sceneFiles } from './scene-hmr-boundary.js';

async function main(): Promise<void> {
  const appEl = document.getElementById('app')!;

  const decls: VarDeclaration[] = Object.entries(gameConfig.variables).map(([name, d]) => ({
    name,
    ...(d as Omit<VarDeclaration, 'name'>),
  }));
  const store = new VariableStore(decls);

  const registry = new SceneRegistry();
  for (const [scenePath, load] of Object.entries(sceneFiles)) {
    const src = (await load()) as string;
    const id = scenePath.split('/').pop()!.replace(/\.gal$/, '');
    registry.register(compileScene(src, scenePath, id));
  }

  const bus = new EventBus<CoreEventMap>();
  const interp = new Interpreter(store, bus, registry);
  const audio = new AudioManager();
  const playerUiSession = createPlayerUiSession({ base: 'game' });
  const inputGate = new PlayerInputGate();
  const runtime = await createRendererRuntime({
    audio,
    onAdvance: () => interp.advance(),
    onSelect: (index) => interp.choose(index),
    onPointerConsumed: () => inputGate.consumeCurrentPointer(),
  });
  appEl.appendChild(runtime.canvas);
  runtime.resize();
  window.addEventListener('resize', () => runtime.resize());

  const controller = runtime.controller;
  const commands = runtime.commands;
  const queries = runtime.queries;
  const assets = commands.assets;
  const loading = commands.loading;
  const presentation = commands.presentation;
  controller.connect(bus);
  interp.setPresentationHooks({
    snapshot: () => queries.presentation.snapshot(),
    restore: (payload) => presentation.restore(payload),
  });

  // 模板也使用同一资源队列；替换 content/assets 后无需重写启动加载生命周期。
  const imageFiles = import.meta.glob('../content/assets/**/*.{png,jpg,jpeg,webp,gif,avif,svg}', {
    query: '?url',
    import: 'default',
    eager: true,
  });
  const priorityFor = (relativePath: string): AssetPriority => {
    if (relativePath === 'bg/title_bg.png' || relativePath.startsWith('fonts/')) return 'critical';
    if (relativePath.startsWith('bg/') || relativePath.startsWith('portrait/') || relativePath.startsWith('avatar/')) return 'scene';
    return 'background';
  };
  const assetJobs: AssetLoadJob[] = Object.entries(imageFiles).map(([assetPath, url]) => {
    const relativePath = assetPath.replace('../content/assets/', '');
    const fileName = relativePath.split('/').pop() ?? '';
    const kind = relativePath.split('/')[0] ?? '';
    const format = fileName.split('.').pop()?.toLowerCase();
    return {
      id: relativePath,
      priority: priorityFor(relativePath),
      load: async () => {
        if (kind === 'bg') {
          await assets.registerBackground(fileName.replace(/\.[^.]+$/, ''), url as string, format);
        } else if (kind === 'portrait') {
          const parts = fileName.replace(/\.[^.]+$/, '').split('_');
          if (parts[0]) await assets.registerPortrait(parts[0], parts[1] ?? 'normal', parts[2] ?? 'normal', url as string, format);
        } else if (kind === 'avatar') {
          await assets.registerAvatar(fileName.replace(/\.[^.]+$/, ''), url as string, format);
        }
      },
    } satisfies AssetLoadJob;
  });
  const finalAssetProgress = await new AssetLoadQueue(4).run(assetJobs, (progress) => loading.showLoading(progress));
  if (finalAssetProgress.failed > 0) console.warn(`[game] ${finalAssetProgress.failed} asset(s) failed`);
  loading.hideLoading();

  const rollback = new RollbackBuffer<SaveSnapshot>();
  let lastRollbackKey: string | null = null;
  let rollbackRestoring = false;
  const checkpointKey = (snapshot: SaveSnapshot): string | null => {
    const position = snapshot.position;
    return position ? `${position.sceneId}:${position.pc}:${position.sceneHash ?? ''}` : null;
  };
  const clearRollback = (): void => {
    rollback.clear();
    lastRollbackKey = null;
  };
  const performRollback = (): boolean => {
    if (rollbackRestoring || interp.status !== 'awaiting-advance' || controller.status === 'choice' || controller.backlogOpen) return false;
    const current = interp.saveSnapshot();
    const currentKey = current ? checkpointKey(current) : null;
    const first = rollback.pop();
    if (!first) return false;
    const frame = currentKey !== null && checkpointKey(first.snapshot) === currentKey ? rollback.pop() : first;
    if (!frame) {
      rollback.push(first);
      return false;
    }
    rollbackRestoring = true;
    try {
      runtime.resetSession();
      interp.loadSnapshot(frame.snapshot);
      presentation.restore(frame.presentation);
      audio.restorePlayback?.(frame.audio);
      lastRollbackKey = checkpointKey(frame.snapshot);
      return true;
    } catch (error) {
      rollback.push(frame);
      console.warn('[game] 回退失败：', error);
      return false;
    } finally {
      rollbackRestoring = false;
    }
  };
  bus.on('text', () => {
    if (rollbackRestoring) return;
    queueMicrotask(() => {
      if (rollbackRestoring) return;
      const snapshot = interp.saveSnapshot();
      if (!snapshot || interp.status !== 'awaiting-advance') return;
      const key = checkpointKey(snapshot);
      if (key === null || key === lastRollbackKey) return;
      rollback.push({
        snapshot,
        presentation: queries.presentation.snapshot(),
        audio: audio.snapshotPlayback?.() ?? { bgm: null, ambience: null },
      });
      lastRollbackKey = key;
    });
  });

  runtime.canvas.addEventListener('pointerdown', (event) => {
    const decision = inputGate.decidePointer(playerUiSession.snapshot(), event);
    if (decision === 'restore-interface') {
      if (shouldRestoreInterfaceOnPointer(playerUiSession.snapshot())) {
        playerUiSession.setInterfaceHidden(false);
        controller.dispatchInput({ type: 'interface.toggle' });
      }
      return;
    }
    if (decision === 'advance' && canAdvance(playerUiSession.snapshot())) controller.advance();
  });

  const saveStorage: SaveStorage = {
    read: (slot) => {
      try {
        const raw = localStorage.getItem(`surdet:save:${slot}`);
        return raw ? (JSON.parse(raw) as SaveSnapshot) : null;
      } catch {
        return null;
      }
    },
    write: (slot, data) => {
      try {
        localStorage.setItem(`surdet:save:${slot}`, JSON.stringify(data));
      } catch (err) {
        console.error('[game] 存档写入失败：', err);
      }
    },
    delete: (slot) => localStorage.removeItem(`surdet:save:${slot}`),
    list: () => Object.keys(localStorage)
      .filter((key) => key.startsWith('surdet:save:'))
      .map((key) => key.slice('surdet:save:'.length)),
  };
  const saves = new SaveManager(saveStorage);

  // 大系统指令由通用宿主路由；新游戏在这里注入自己的 adapters，不复制整套接线。
  const host = createDefaultHost({
    interpreter: interp,
    renderer: controller,
    stage: commands.system,
    onError: (error) => console.error('[game] 宿主 adapter 失败：', error),
    onSystemBoundary: () => { clearRollback(); },
  });
  connectSystemRouter(bus, host, (error) => console.error('[game] system 路由失败：', error));

  bus.on('autosave', (snap) => {
    if (rollbackRestoring) return;
    void saves.save(AUTO_SLOT, snap).then(() => console.info('[game] 自动存档'));
  });
  bus.on('saveMismatch', (p) => {
    clearRollback();
    console.warn(`[game] 存档与剧本版本不一致（场景 ${p.sceneId}），定位可能漂移`);
  });

  const routeGameAction = (action: GameAction): void => {
    if (action === 'quickSave') {
      const snap = interp.saveSnapshot('quick');
      if (snap) void saves.save(QUICK_SLOT, snap);
      return;
    }
    if (action === 'quickLoad') {
      void (async () => {
        if (await saves.has(QUICK_SLOT)) {
          clearRollback();
          interp.loadSnapshot(await saves.load(QUICK_SLOT));
        }
      })();
      return;
    }
    if (action === 'rollback') {
      performRollback();
      return;
    }
    const input = rendererInputForGameAction(action);
    if (input) controller.dispatchInput(input);
  };

  window.addEventListener('keydown', (event) => {
    const action = actionForKeyboardEvent(event, 'standard');
    if (!action) return;
    event.preventDefault();
    routeGameAction(action);
  });

  // Vite 开发环境热更新：只替换当前注册表中的 .gal 场景，生产构建不会包含此分支。
  if (import.meta.hot) {
    let hotReloadChain = Promise.resolve();
    import.meta.hot.on('vite:beforeUpdate', (payload) => {
      for (const update of payload.updates) {
        const cleanPath = update.path.split('?')[0] ?? update.path;
        if (!cleanPath.toLowerCase().endsWith('.gal')) continue;
        hotReloadChain = hotReloadChain.then(async () => {
          const sceneId = cleanPath.split('/').pop()?.replace(/\.gal$/i, '');
          if (!sceneId) return;
          try {
            const rawUrl = `${update.path}${update.path.includes('?') ? '&' : '?'}raw&t=${Date.now()}`;
            const response = await fetch(rawUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const replacement = compileScene(await response.text(), update.path, sceneId);
            const active = interp.saveSnapshot();
            const position = active?.position ?? null;
            const decision = position?.sceneId === sceneId
              ? decideSceneHotReload(sceneId, position.pc, replacement, position.sceneHash)
              : { apply: true, nextPc: 0 };
            if (!decision.apply) {
              console.warn(`[game] 热重载已跳过：${decision.diagnostic ?? '场景不匹配'}`);
              return;
            }
            registry.replace(replacement, sceneId);
            if (active && position?.sceneId === sceneId) {
              interp.loadSnapshot({
                ...active,
                position: { ...position, pc: decision.nextPc, sceneHash: replacement.sceneHash },
              });
            }
            if (decision.diagnostic) console.info(`[game] ${decision.diagnostic}`);
          } catch (error) {
            console.warn(`[game] 场景热重载失败，保留旧场景 ${sceneId}：`, error);
          }
        });
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    try {
      host.dispose();
      runtime.dispose();
      audio.dispose();
    } catch (error) {
      console.warn('[game] runtime dispose failed:', error);
    }
  });

  interp.start('ch01_01');
  console.info(`[game] started: ${registry.all().length} scenes`);
}

main().catch((err) => {
  console.error('[game] 启动失败：', err);
});
