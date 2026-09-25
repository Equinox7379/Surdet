/**
 * 编辑器素材交互适配器。
 * 素材事实与引用关系由 @surdet/authoring 的共享投影负责；本文件只保留
 * 浏览器目录句柄适配和“插入到当前剧本”的界面辅助，不再建立第二份素材索引。
 */

export type AssetKind = 'bg' | 'portrait' | 'avatar' | 'bgm' | 'ambience' | 'se' | 'voice' | 'video' | 'font' | 'other' | 'cg' | 'music' | 'text';

/** 目录扫描出的素材文件条目 */
export interface DirAsset {
  /** 素材 key（立绘为 `角色:服装`，其余为文件名去扩展名） */
  key: string;
  kind: AssetKind;
  /** 立绘表情（文件名第三段） */
  expr?: string;
  /** 文件句柄（预览缩略图用；无 FS API 环境为 null） */
  handle: FileSystemFileHandle | null;
  isImage: boolean;
  /** 规范项目相对路径；真实目录扫描必填，内存/旧测试适配可缺省。 */
  sourcePath?: string;
  /** File 元数据，不读取二进制内容。 */
  bytes?: number;
  lastModified?: number;
}

/** 汇总后的素材清单条目 */
export interface AssetEntry {
  key: string;
  kind: AssetKind;
  /** 条目来源（同 key 多来源时优先级 dir > gallery > script） */
  source: 'dir' | 'gallery' | 'script';
  /** 引用该素材的场景 ID 列表（剧本扫描得出；去重保序） */
  usedBy: string[];
  /** gallery 条目的资源引用（cgs/music 的 src 字段） */
  assetSrc?: string;
  /** 立绘出现过的表情集合 */
  exprs?: string[];
}

function galleryRecords(value: unknown, field: string): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return [];
  const entries = (value as Record<string, unknown>)[field];
  return Array.isArray(entries)
    ? entries.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    : [];
}

/**
 * gallery.json 中可插入剧本的鉴赏动作。它不是素材事实索引：物理文件、引用、问题与身份仍
 * 只由 @surdet/authoring 投影提供；这里仅保留既有 @unlock_* 编辑入口。
 */
export function galleryUnlockEntries(gallery: unknown): AssetEntry[] {
  const result: AssetEntry[] = [];
  for (const [field, kind] of [['cgs', 'cg'], ['music', 'music'], ['texts', 'text']] as const) {
    for (const entry of galleryRecords(gallery, field)) {
      const key = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (!key) continue;
      result.push({
        key,
        kind,
        source: 'gallery',
        usedBy: [],
        ...(typeof entry.src === 'string' && entry.src.trim() ? { assetSrc: entry.src.trim() } : {}),
      });
    }
  }
  return result;
}

const DIR_KIND_MAP: Record<string, AssetKind> = {
  bg: 'bg', portrait: 'portrait', avatar: 'avatar', bgm: 'bgm', music: 'bgm', ambience: 'ambience', se: 'se', voice: 'voice', video: 'video',
  font: 'font', fonts: 'font',
};

/** 目录名 → 素材类型（未知目录返回 null，调用方跳过） */
export function kindOfDir(name: string): AssetKind | null {
  return DIR_KIND_MAP[name] ?? null;
}

const IMG_EXT = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

/** 立绘文件名解析：`角色_服装_表情.ext` → key `角色:服装` + 表情（缺省 normal） */
export function parsePortraitFileName(fname: string): { key: string; expr: string } {
  const stem = fname.replace(IMG_EXT, '');
  const seg = stem.split('_');
  return { key: `${seg[0] ?? ''}:${seg[1] ?? 'normal'}`, expr: seg[2] ?? 'normal' };
}

/** 素材条目 → 点击插入的指令行（无法生成插入行的类型返回 null） */
export function insertLineForAsset(e: AssetEntry): string | null {
  switch (e.kind) {
    case 'bg': return `@bg ${e.key}`;
    case 'bgm': return `@bgm ${e.key}`;
    case 'ambience': return `@ambience ${e.key}`;
    case 'se': return `@se ${e.key}`;
    case 'voice': return `@voice ${e.key}`;
    case 'video': return `@video ${e.key}`;
    case 'portrait': return `@show ${e.key} ${e.exprs?.[0] ?? 'normal'}`;
    case 'cg': return `@unlock_cg ${e.key}`;
    case 'music': return `@unlock_music ${e.key}`;
    case 'text': return `@unlock_text ${e.key}`;
    default: return null;
  }
}

/** 素材类型中文标签（UI 展示用） */
export const KIND_LABELS: Record<AssetKind, string> = {
  bg: '背景', portrait: '立绘', avatar: '头像', bgm: '音乐', ambience: '环境音', se: '音效', voice: '语音', video: '视频',
  font: '字体', other: '其他', cg: 'CG', music: '鉴赏音乐', text: '回想',
};
