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
import type { VarDeclaration, SaveStorage, SaveSnapshot } from '@surdet/core';
import { PixiStage, AdvRenderer, AudioManager } from '@surdet/renderer';
import gameConfig from '../game.config.json';

const sceneFiles = import.meta.glob('../content/scenario/*.gal', {
  query: '?raw',
  import: 'default',
});

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

  const bus = new EventBus();
  const interp = new Interpreter(store, bus, registry);
  const audio = new AudioManager();
  const renderer = new AdvRenderer(stage, audio, {
    onAdvance: () => interp.advance(),
    onSelect: (i) => interp.choose(i),
  });
  renderer.subscribe(bus);

  stage.app!.canvas.addEventListener('pointerdown', () => renderer.advance());
  stage.app!.ticker.add((ticker) => renderer.update(ticker.deltaMS));

  const saveStorage: SaveStorage = {
    read: (slot) => {
      try {
        const raw = localStorage.getItem(`surdet:save:${slot}`);
        return raw ? (JSON.parse(raw) as SaveSnapshot) : null;
      } catch {
        return null;
      }
    },
    write: (slot, data) => localStorage.setItem(`surdet:save:${slot}`, JSON.stringify(data)),
    delete: (slot) => localStorage.removeItem(`surdet:save:${slot}`),
    list: () =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith('surdet:save:'))
        .map((k) => k.slice('surdet:save:'.length)),
  };
  const saves = new SaveManager(saveStorage);

  // 大系统指令（battle/calendar/affection/event/shop/item）由宿主驱动对应 System 类；
  // 模板先记录日志，接入实际系统后替换为真实驱动。
  bus.on('system', (p) => {
    console.info('[game] system event:', p);
  });

  // 剧本 @autosave：写入自动存档槽位（读档用 F9 只覆盖快速档；自动档需另行提供读档入口）
  bus.on<SaveSnapshot>('autosave', (snap) => {
    saves.save(AUTO_SLOT, snap);
    console.info('[game] 自动存档');
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5') {
      e.preventDefault();
      const snap = interp.saveSnapshot('quick');
      if (snap) {
        saves.save(QUICK_SLOT, snap);
        console.info('[game] 快速存档');
      }
    } else if (e.key === 'F9') {
      e.preventDefault();
      if (saves.has(QUICK_SLOT)) {
        try {
          interp.loadSnapshot(saves.load(QUICK_SLOT));
          console.info('[game] 快速读档');
        } catch (err) {
          console.error('[game] 读档失败：', err);
        }
      }
    } else if (e.key === 'a' || e.key === 'A') {
      console.info('[game] 自动播放', renderer.toggleAuto() ? '开' : '关');
    } else if (e.key === 's' || e.key === 'S') {
      console.info('[game] 快进', renderer.toggleSkip() ? '开' : '关');
    }
  });

  interp.start('ch01_01');
  console.info(`[game] started: ${registry.all().length} scenes`);
}

main().catch((err) => {
  console.error('[game] 启动失败：', err);
});
