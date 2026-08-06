/**
 * 项目读写（E0 拆分：原 main.ts 纯搬移）。
 * File System Access 打开目录 / 递归读场景 / 保存回目录 / 下载导出兜底 / 内存演示项目。
 * UI 联动（renderAll/runValidate/renderSidebar）经钩子注入，保持模块无环。
 */
import { state, setStatus } from './state.js';
import { histories } from './history.js';
import { kindOfDir, parsePortraitFileName } from './assets.js';
import type { AssetKind } from './assets.js';

let renderAll: () => void = () => {};
let runValidate: () => void = () => {};
let renderSidebar: () => void = () => {};
/** 项目载入完成（崩溃保险恢复检查挂点；A1） */
let onProjectLoaded: () => void = () => {};
/** 保存全部完成（清除崩溃备份挂点；A1） */
let onSaved: () => void = () => {};

export function bindProjectIoHooks(opts: {
  renderAll: () => void;
  runValidate: () => void;
  renderSidebar: () => void;
  onProjectLoaded?: () => void;
  onSaved?: () => void;
}): void {
  renderAll = opts.renderAll;
  runValidate = opts.runValidate;
  renderSidebar = opts.renderSidebar;
  onProjectLoaded = opts.onProjectLoaded ?? (() => {});
  onSaved = opts.onSaved ?? (() => {});
}

export async function openProject(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const dir = await picker({ mode: 'readwrite' });
  state.dirName = dir.name;
  state.dirHandle = dir;
  state.scenes.clear();
  histories.clear(); // 换项目：历史栈失效
  state.handles = { gameConfig: null, achievements: null, calendar: null, events: null, growth: null, gallery: null, terminology: null };
  state.dirAssets = [];
  // content/config/*.json（E1a：流程图宿主入口与 CLI collectConfigSceneRoots 同源；
  // E2/E3：achievements/gallery 供素材清单与配置编辑器；解析失败按无配置）
  state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
  for (const name of ['events', 'growth', 'calendar', 'achievements', 'gallery', 'terminology'] as const) {
    try {
      const contentDir = await dir.getDirectoryHandle('content');
      const configDir = await contentDir.getDirectoryHandle('config');
      const fh = await configDir.getFileHandle(`${name}.json`);
      state.configFiles[name] = JSON.parse(await (await fh.getFile()).text()) as unknown;
      // 配置编辑器写盘句柄（E3 全部配置文件）
      if (name === 'achievements' || name === 'calendar' || name === 'events' || name === 'growth' || name === 'gallery' || name === 'terminology') {
        state.handles[name] = fh;
      }
    } catch {
      state.configFiles[name] = null;
    }
  }
  // game.config.json（entryScene/变量表；句柄供变量编辑器写盘）
  try {
    const cfgHandle = await dir.getFileHandle('game.config.json');
    state.handles.gameConfig = cfgHandle;
    state.gameConfigText = await (await cfgHandle.getFile()).text();
    const cfg = JSON.parse(state.gameConfigText) as { entryScene?: string };
    state.entryScene = typeof cfg.entryScene === 'string' ? cfg.entryScene : '';
  } catch {
    state.gameConfigText = '';
    state.entryScene = '';
  }
  // 素材目录扫描（E2）：content/assets 与 public/，目录约定类型，无目录静默跳过
  try {
    const contentDir = await dir.getDirectoryHandle('content');
    const assetsDir = await contentDir.getDirectoryHandle('assets');
    await walkAssetDir(assetsDir);
  } catch { /* 无素材目录 */ }
  try {
    const publicDir = await dir.getDirectoryHandle('public');
    await walkAssetDir(publicDir);
  } catch { /* 无 public 目录 */ }
  // 递归读取 content/scenario/**/*.gal
  try {
    const contentDir = await dir.getDirectoryHandle('content');
    const scenarioDir = await contentDir.getDirectoryHandle('scenario');
    await readScenarioDir(scenarioDir, '');
  } catch {
    /* 无剧本目录：空项目 */
  }
  const first = state.scenes.keys().next().value as string | undefined;
  state.current = first ?? null;
  renderAll();
  runValidate(); // 打开后立即校验
  onProjectLoaded(); // 崩溃保险：检查同项目未保存快照（A1）
}

/** 素材目录扫描（E2）：顶层目录定类型（bg/portrait/bgm/se/voice/video），子目录继承类型；
 *  未知类型的目录/文件跳过（不强制素材约定） */
const IMG_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
async function walkAssetDir(root: FileSystemDirectoryHandle): Promise<void> {
  const walk = async (dh: FileSystemDirectoryHandle, kind: AssetKind | null): Promise<void> => {
    const entries = (dh as unknown as {
      values: () => AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
    }).values();
    for await (const ent of entries) {
      if (ent.kind === 'directory') {
        await walk(ent, kind ?? kindOfDir(ent.name));
      } else if (ent.kind === 'file' && kind) {
        if (kind === 'portrait') {
          const { key, expr } = parsePortraitFileName(ent.name);
          state.dirAssets.push({ key, kind, expr, handle: ent, isImage: IMG_RE.test(ent.name) });
        } else {
          const key = ent.name.replace(/\.[^.]+$/, '');
          state.dirAssets.push({ key, kind, handle: ent, isImage: IMG_RE.test(ent.name) });
        }
      }
    }
  };
  await walk(root, null);
}

/** 配置文件写盘（E3 共用：创建可写流 → 写入 → 关闭） */
export async function writeFileHandle(fh: FileSystemFileHandle, text: string): Promise<void> {
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

export async function readScenarioDir(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
  // values() 异步迭代器未包含在默认 DOM lib 类型中，显式断言
  const entries = (dir as unknown as {
    values: () => AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }).values();
  for await (const ent of entries) {
    if (ent.kind === 'directory') {
      await readScenarioDir(ent, prefix + ent.name + '/');
    } else if (ent.kind === 'file' && ent.name.endsWith('.gal')) {
      const id = ent.name.replace(/\.gal$/, '');
      const text = await (await ent.getFile()).text();
      // key = 相对路径：子目录同名 .gal 各占一条，同名冲突由校验 LINT_DUP 显式报错（M4）
      const key = prefix + id;
      state.scenes.set(key, {
        id,
        file: prefix + ent.name,
        text,
        eol: text.includes('\r\n') ? '\r\n' : '\n',
        dirty: false,
        handle: ent,
      });
    }
  }
}

export async function saveAll(): Promise<void> {
  if (!state.fsSupported) {
    exportCurrent();
    return;
  }
  let saved = 0;
  for (const [key, sc] of state.scenes) {
    if (!sc.dirty) continue;
    const handle = sc.handle;
    if (!handle) {
      // 新建场景：在项目目录 content/scenario/ 下真实创建文件落盘（M3：不再以下载冒充保存）
      if (state.dirHandle) {
        try {
          const contentDir = await state.dirHandle.getDirectoryHandle('content', { create: true });
          const scenarioDir = await contentDir.getDirectoryHandle('scenario', { create: true });
          const fileName = `${sc.id}.gal`;
          const fh = await scenarioDir.getFileHandle(fileName, { create: true });
          const w = await fh.createWritable();
          await w.write(sc.text);
          await w.close();
          sc.handle = fh;
          sc.file = `content/scenario/${fileName}`;
          sc.dirty = false;
          saved++;
        } catch (err) {
          setStatus(`场景 '${sc.id}' 创建失败：${err instanceof Error ? err.message : String(err)}`, false, 6000);
        }
        continue;
      }
      // 演示项目（无目录句柄）：下载导出 + 保留脏标记，诚实提示（不冒充已保存）
      exportScene(sc.id, sc.text);
      setStatus(`演示项目无法写盘：已下载 ${sc.id}.gal，请手动放入 content/scenario/（脏标记保留）`, true, 6000);
      continue;
    }
    const writable = await handle.createWritable();
    await writable.write(sc.text);
    await writable.close();
    sc.dirty = false;
    saved++;
    void key;
  }
  setStatus(saved > 0 ? `已保存 ${saved} 个场景` : '无待保存改动', true, 4000);
  renderSidebar();
  onSaved(); // 崩溃保险：磁盘已最新，清除备份（演示项目脏标记保留时下一轮定时快照会自动重建）
}

export function exportScene(id: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${id}.gal`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportCurrent(): void {
  if (!state.current) return;
  const sc = state.scenes.get(state.current);
  if (sc) exportScene(state.current, sc.text);
}

/** 无 FS API 环境的内存演示项目 */
export function loadDemoProject(): void {
  state.dirName = '（演示项目·未连接目录）';
  state.dirHandle = null;
  state.scenes.clear();
  histories.clear();
  state.gameConfigText = '';
  state.entryScene = 'demo';
  state.handles = { gameConfig: null, achievements: null, calendar: null, events: null, growth: null, gallery: null, terminology: null };
  state.dirAssets = [];
  state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
  state.scenes.set('demo', {
    id: 'demo',
    file: 'demo.gal',
    text: '@scene demo\n@bg hall\n凛：你好，这里是演示场景。\n@choice\n  打个招呼 -> @goto greet\n  沉默离开 -> @goto bye\n@label greet\n凛：很高兴见到你。\n@end\n@label bye\n凛：……下次见。\n@end',
    eol: '\n',
    dirty: false,
    handle: null,
  });
  state.current = 'demo';
  renderAll();
  runValidate();
  onProjectLoaded(); // 崩溃保险：演示项目同样支持恢复（dirName 区分）
}
