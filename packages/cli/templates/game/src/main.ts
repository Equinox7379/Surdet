/**
 * 游戏入口：解释器 + 渲染层 + 程序化占位素材。
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
import { PixiStage, AdvRenderer, AudioManager, AssetLoadQueue, FrameScheduler, RollbackBuffer, actionForKeyboardEvent, decideSceneHotReload } from '@surdet/renderer';
import type { AssetLoadJob, AssetPriority } from '@surdet/renderer';
import { connectSystemRouter, createDefaultHost } from '@surdet/host';
import gameConfig from '../game.config.json';
import { sceneFiles } from './scene-hmr-boundary.js';

async function main(): Promise<void> {
  const appEl = document.getElementById('app')!;
  const stage = new PixiStage();
  await stage.init();
  appEl.appendChild(stage.app!.canvas);

  const decls: VarDeclaration[] = Object.entries(gameConfig.variables).map(([name, d]) => ({
    name,
    ...(d as Omit<VarDeclaration, 'name'>),
  }));
  const store = new VariableStore(decls);

  const registry = new SceneRegistry();
  for (const [path, load] of Object.entries(sceneFiles)) {
    const src = (await load()) as string;
    const id = path.split('/').pop()!.replace(/\.gal$/, '');
    registry.register(compileScene(src, path, id));
  }

  const bus = new EventBus<CoreEventMap>();
  const interp = new Interpreter(store, bus, registry);
  const audio = new AudioManager();

  // 模板也使用同一资源队列；替换 content/assets 后无需重写启动加载生命周期。
  const imageFiles = import.meta.glob('../content/assets/**/*.{png,jpg,jpeg,webp,gif,avif,svg}', {
    query: '?url',
    import: 'default',
    eager: true,
  });
  const priorityFor = (rel: string): AssetPriority => {
    if (rel === 'bg/title_bg.png' || rel.startsWith('fonts/')) return 'critical';
    if (rel.startsWith('bg/') || rel.startsWith('portrait/') || rel.startsWith('avatar/')) return 'scene';
    return 'background';
  };
  const assetJobs: AssetLoadJob[] = Object.entries(imageFiles).map(([path, url]) => {
    const rel = path.replace('../content/assets/', '');
    const fname = rel.split('/').pop() ?? '';
    const kind = rel.split('/')[0] ?? '';
    const format = fname.split('.').pop()?.toLowerCase();
    return {
      id: rel,
      priority: priorityFor(rel),
      load: async () => {
        if (kind === 'bg') {
          await stage.registerBackground(fname.replace(/\.[^.]+$/, ''), url as string, format);
        } else if (kind === 'portrait') {
          const seg = fname.replace(/\.[^.]+$/, '').split('_');
          if (seg[0]) await stage.registerPortrait(seg[0], seg[1] ?? 'normal', seg[2] ?? 'normal', url as string, format);
        } else if (kind === 'avatar') {
          await stage.registerAvatar(fname.replace(/\.[^.]+$/, ''), url as string, format);
        }
      },
    } satisfies AssetLoadJob;
  });
  const finalAssetProgress = await new AssetLoadQueue(4).run(assetJobs, (progress) => stage.showLoading?.(progress));
  if (finalAssetProgress.failed > 0) console.warn(`[game] ${finalAssetProgress.failed} asset(s) failed`);
  stage.hideLoading?.();

  const renderer = new AdvRenderer(stage, audio, {
    onAdvance: () => interp.advance(),
    onSelect: (i) => interp.choose(i),
  });
  renderer.subscribe(bus);
  interp.setPresentationHooks({
    snapshot: () => renderer.snapshotPresentation(),
    restore: (payload) => renderer.restorePresentation(payload),
  });

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
    if (rollbackRestoring || interp.status !== 'awaiting-advance' || renderer.status === 'choice' || renderer.backlogOpen) return false;
    const current = interp.saveSnapshot();
    const currentKey = current ? checkpointKey(current) : null;
    const first = rollback.pop();
    if (!first) return false;
    const frame = currentKey !== null && checkpointKey(first.snapshot) === currentKey
      ? rollback.pop()
      : first;
    if (!frame) {
      rollback.push(first);
      return false;
    }
    rollbackRestoring = true;
    try {
      renderer.resetSession();
      interp.loadSnapshot(frame.snapshot);
      stage.restorePresentation?.(frame.presentation);
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
        presentation: renderer.snapshotPresentation(),
        audio: audio.snapshotPlayback?.() ?? { bgm: null, ambience: null },
      });
      lastRollbackKey = key;
    });
  });

  stage.app!.canvas.addEventListener('pointerdown', () => renderer.advance());
  new FrameScheduler(stage.app!, renderer, [stage]);

  // 窗口自适应：等比缩放画布适配窗口尺寸（内部分辨率不变）
  stage.fitWindow();
  window.addEventListener('resize', () => stage.fitWindow());

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
    list: () =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith('surdet:save:'))
        .map((k) => k.slice('surdet:save:'.length)),
  };
  const saves = new SaveManager(saveStorage);

  // 大系统指令由通用宿主路由；新游戏在这里注入自己的 adapters，不复制整套接线。
  const host = createDefaultHost({
    interpreter: interp,
    renderer,
    stage,
    onError: (error) => console.error('[game] 宿主 adapter 失败：', error),
    onSystemBoundary: () => { clearRollback(); },
  });
  connectSystemRouter(bus, host, (error) => console.error('[game] system 路由失败：', error));

  // 剧本 @autosave：写入自动存档槽位（读档用 F9 只覆盖快速档；自动档需另行提供读档入口）
  bus.on('autosave', (snap) => {
    if (rollbackRestoring) return;
    void saves.save(AUTO_SLOT, snap).then(() => console.info('[game] 自动存档'));
  });

  // 存档场景哈希不匹配：存档后剧本被编辑，定位可能漂移（引擎仍照常加载，此处提醒）
  bus.on('saveMismatch', (p) => {
    clearRollback();
    console.warn(`[game] 存档与剧本版本不一致（场景 ${p.sceneId}），定位可能漂移`);
  });

  window.addEventListener('keydown', (e) => {
    const action = actionForKeyboardEvent(e, 'standard');
    if (action === 'quickSave') {
      e.preventDefault();
      const snap = interp.saveSnapshot('quick');
      if (snap) {
        void saves.save(QUICK_SLOT, snap).then(() => console.info('[game] 快速存档'));
      }
    } else if (action === 'quickLoad') {
      e.preventDefault();
      void (async () => {
        if (await saves.has(QUICK_SLOT)) {
          try {
            clearRollback();
            interp.loadSnapshot(await saves.load(QUICK_SLOT));
            console.info('[game] 快速读档');
          } catch (err) {
            console.error('[game] 读档失败：', err);
          }
        }
      })();
    } else if (action === 'rollback') {
      if (performRollback()) e.preventDefault();
    } else if (action === 'auto') {
      console.info('[game] 自动播放', renderer.toggleAuto() ? '开' : '关');
    } else if (action === 'skip') {
      console.info('[game] 快进', renderer.toggleSkip() ? '开' : '关');
    }
  });

  // Vite 开发环境热更新：只替换当前注册表中的 .gal 场景，生产构建不会包含此分支。
  // 编译失败或场景 ID 不匹配时保留旧场景；活动场景的 PC 超界则安全限制后重放。
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

  interp.start('ch01_01');
  console.info(`[game] started: ${registry.all().length} scenes`);
}

main().catch((err) => {
  console.error('[game] 启动失败：', err);
});
