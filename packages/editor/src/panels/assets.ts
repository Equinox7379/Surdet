/**
 * 素材面板（E2）：侧栏"素材"标签页。
 *  - 清单：消费 @surdet/authoring 共享素材事实，不再维护 Editor 私有语义索引
 *  - 使用统计：每个 key 被哪些场景引用，0 引用标灰
 *  - 插入辅助：点击"插入"在当前场景末尾追加对应指令行（走 history 可撤销）；"复制"拷 key
 *  - 图片预览：目录来源的图片素材 hover 显示缩略图；无文件则占位色块（与运行时占位哲学一致）
 */
import { state, h, setStatus } from '../state.js';
import { galleryUnlockEntries, insertLineForAsset, KIND_LABELS } from '../assets.js';
import type { AssetEntry, AssetKind } from '../assets.js';
import type { ProjectAssetItem, ProjectAssetKind } from '@surdet/authoring';
import { appendLineToScene } from '../scene-text.js';
import { setSceneText } from '../history.js';

/** 分组展示顺序 */
const KIND_ORDER: AssetKind[] = ['bg', 'portrait', 'avatar', 'bgm', 'ambience', 'se', 'voice', 'video', 'cg', 'music', 'text'];
const SHARED_KIND: Partial<Record<ProjectAssetKind, AssetKind>> = {
  background: 'bg',
  portrait: 'portrait',
  avatar: 'avatar',
  music: 'bgm',
  ambience: 'ambience',
  'sound-effect': 'se',
  voice: 'voice',
  video: 'video',
};

type SidebarAssetEntry = AssetEntry & { assetId: string; sourcePath?: string };

/** 预览缩略图浮层（单例；hover 目录图片素材时显示） */
let previewEl: HTMLDivElement | null = null;
let previewUrl: string | null = null;
let onInsertedHook: () => void = () => {};
let onOpenCenterHook: () => void = () => {};

export function bindAssetsPanelHooks(opts: { onInserted: () => void; onOpenCenter?: () => void }): void {
  onInsertedHook = opts.onInserted;
  onOpenCenterHook = opts.onOpenCenter ?? (() => {});
}

function hidePreview(): void {
  previewEl?.remove();
  previewEl = null;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

function showPreview(entry: SidebarAssetEntry, x: number, y: number): void {
  hidePreview();
  const dir = state.dirAssets.find((d) => d.sourcePath === entry.sourcePath && d.isImage && d.handle);
  const box = h('div', 'asset-preview');
  box.style.left = `${Math.min(x + 14, window.innerWidth - 260)}px`;
  box.style.top = `${Math.min(y + 10, window.innerHeight - 200)}px`;
  if (dir && dir.handle) {
    void dir.handle.getFile().then((file) => {
      if (previewEl !== box || !box.isConnected) return; // 已移开或切到另一项：丢弃迟到结果
      previewUrl = URL.createObjectURL(file);
      const img = document.createElement('img');
      img.src = previewUrl;
      box.appendChild(img);
    }).catch(() => {
      if (previewEl !== box || !box.isConnected) return;
      box.appendChild(h('div', 'empty', '预览加载失败'));
    });
    box.appendChild(h('div', 'dim', `${entry.key}（盘上真实文件预览）`));
  } else {
    // 无盘上文件：占位色块（编辑器不强制素材存在，与运行时占位一致）
    const ph = h('div', 'asset-preview-ph');
    box.append(ph, h('div', 'dim', `${entry.key}（无盘上文件，运行时为程序化占位）`));
  }
  document.body.appendChild(box);
  previewEl = box;
}

/** 插入素材指令行到当前场景末尾（与流程图拖拽建链同一机制，走 history 可撤销） */
function insertAssetLine(entry: AssetEntry): void {
  const line = insertLineForAsset(entry);
  if (!line) {
    setStatus(`素材 '${entry.key}' 无对应插入指令`, false, 4000);
    return;
  }
  if (!state.current) {
    setStatus('请先选择一个场景再插入素材指令', false, 4000);
    return;
  }
  const sc = state.scenes.get(state.current);
  if (!sc) return;
  setSceneText(state.current, appendLineToScene(sc.text, sc.eol, line));
  onInsertedHook();
  setStatus(`已在 '${state.current}' 末尾插入 ${line}（可撤销）`, true, 4000);
}

function sidebarEntry(item: ProjectAssetItem): SidebarAssetEntry | null {
  const kind = SHARED_KIND[item.kind];
  if (!kind) return null;
  return {
    assetId: item.assetId,
    key: item.key,
    kind,
    source: item.physical ? 'dir' : 'script',
    usedBy: item.references.map((reference) => reference.sourceLabel),
    ...(item.sourcePath ? { sourcePath: item.sourcePath } : {}),
    ...(item.kind === 'portrait' && item.variant ? { exprs: [item.variant] } : {}),
  };
}

/** 渲染素材面板到侧栏容器 */
export function renderAssetsPanel(container: HTMLElement): void {
  const sharedItems = state.assetIntelligence?.items ?? [];
  const sharedEntries = sharedItems
    .map(sidebarEntry)
    .filter((entry): entry is SidebarAssetEntry => entry !== null);
  const galleryEntries: SidebarAssetEntry[] = galleryUnlockEntries(state.configFiles.gallery).map((entry) => {
    const sourceKind: ProjectAssetKind | null = entry.kind === 'cg' ? 'background' : entry.kind === 'music' ? 'music' : null;
    const sourceReferences = sourceKind && entry.assetSrc
      ? sharedItems
        .filter((item) => item.kind === sourceKind && item.key === entry.assetSrc)
        .flatMap((item) => item.references.map((reference) => reference.sourceLabel))
      : [];
    return {
      ...entry,
      assetId: `gallery-action:${entry.kind}:${entry.key}`,
      usedBy: [...new Set(sourceReferences)],
    };
  });
  const entries = [...sharedEntries, ...galleryEntries];

  const catalog = h('div', 'asset-catalog');
  catalog.id = 'asset-catalog';
  catalog.setAttribute('role', 'tabpanel');
  catalog.setAttribute('data-editor-region', 'asset-catalog');
  catalog.setAttribute('aria-label', '项目素材目录');
  container.appendChild(catalog);

  const openCenter = h('button', 'asset-open-center', '前往素材中心');
  openCenter.setAttribute('type', 'button');
  openCenter.onclick = onOpenCenterHook;
  catalog.appendChild(openCenter);

  if (entries.length === 0) {
    const text = state.assetIntelligenceState === 'loading'
      ? '正在整理素材…'
      : '未发现项目素材。素材中心会汇总 content/assets 与项目中的真实引用。';
    catalog.appendChild(h('div', 'empty', text));
    return;
  }

  const byKind = new Map<AssetKind, SidebarAssetEntry[]>();
  for (const e of entries) {
    if (!byKind.has(e.kind)) byKind.set(e.kind, []);
    byKind.get(e.kind)!.push(e);
  }

  for (const kind of KIND_ORDER) {
    const list = byKind.get(kind);
    if (!list || list.length === 0) continue;
    const group = h('section', 'asset-group');
    group.dataset.assetKind = kind;
    group.appendChild(h('h3', 'asset-group-heading', `${KIND_LABELS[kind]}（${list.length}）`));
    for (const entry of list) {
      const unused = entry.source !== 'gallery' && entry.usedBy.length === 0;
      const row = h('div', `asset-item${unused ? ' unused' : ''}`);
      row.dataset.assetId = entry.assetId;
      row.dataset.assetKey = entry.key;
      row.dataset.assetKind = entry.kind;
      const keySpan = h('span', 'asset-key', entry.key);
      keySpan.title = entry.sourcePath ?? entry.key;
      row.appendChild(keySpan);
      if (entry.exprs && entry.exprs.length > 0) {
        row.appendChild(h('span', 'dim', `表情：${entry.exprs.join('/')}`));
      }
      const usage = h('span', entry.usedBy.length === 0 ? 'dim' : 'asset-usage');
      usage.textContent = entry.usedBy.length === 0
        ? entry.source === 'gallery' ? '鉴赏条目' : '未发现引用'
        : `${entry.usedBy.length} 处：${entry.usedBy.join('、')}`;
      usage.title = usage.textContent;
      row.appendChild(usage);
      const ops = h('span', 'asset-ops');
      const insBtn = h('button', undefined, '插入');
      insBtn.type = 'button';
      insBtn.setAttribute('data-action', 'insert-asset');
      insBtn.title = `在当前场景末尾插入 ${insertLineForAsset(entry) ?? ''}`;
      insBtn.onclick = () => insertAssetLine(entry);
      const cpBtn = h('button', undefined, '复制');
      cpBtn.type = 'button';
      cpBtn.setAttribute('data-action', 'copy-asset-key');
      cpBtn.title = '复制素材键';
      cpBtn.onclick = () => {
        void navigator.clipboard?.writeText(entry.key);
        setStatus(`已复制 ${entry.key}`, true, 2500);
      };
      ops.append(insBtn, cpBtn);
      row.appendChild(ops);
      // 图片预览（仅目录来源条目绑定 hover；列表重建时旧浮层由 hidePreview 清理）
      const previewable = entry.kind === 'bg' || entry.kind === 'portrait' || entry.kind === 'cg';
      if (previewable) {
        row.addEventListener('mouseenter', (e) => showPreview(entry, e.clientX, e.clientY));
        row.addEventListener('mouseleave', hidePreview);
      }
      group.appendChild(row);
    }
    catalog.appendChild(group);
  }
  const foot = h('div', 'dim', `共 ${entries.length} 项（素材事实与鉴赏指令均来自当前项目）`);
  foot.style.padding = '8px 0';
  catalog.appendChild(foot);
}
