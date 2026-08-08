/**
 * 素材清单纯逻辑（E2）：从三个来源汇总已知素材 key——
 *  1. dir   —— content/assets（及 public/）目录树扫描（文件名即 key，目录约定类型）
 *  2. gallery —— gallery.json 的 cgs/music/texts（id + src 资源引用）
 *  3. script —— 剧本中素材类指令的参数（@bg/@show/@bgm/@se/@voice/@video 等）
 * 编辑器不强制素材文件存在（与运行时占位素材哲学一致），但要列出全部已知 key 与使用情况。
 */
import type { CompiledScene, GenericInstr } from '@surdet/core';

export type AssetKind = 'bg' | 'portrait' | 'avatar' | 'bgm' | 'ambience' | 'se' | 'voice' | 'video' | 'cg' | 'music' | 'text';

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

const DIR_KIND_MAP: Record<string, AssetKind> = {
  bg: 'bg', portrait: 'portrait', avatar: 'avatar', bgm: 'bgm', ambience: 'ambience', se: 'se', voice: 'voice', video: 'video',
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

/** gallery.json 条目列表提取（形状容错） */
function galleryList(gallery: unknown, field: string): Record<string, unknown>[] {
  if (!gallery || typeof gallery !== 'object') return [];
  const list = (gallery as Record<string, unknown>)[field];
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object');
}

/**
 * 汇总素材清单：dir 条目打底，gallery/script 来源补充；同 key 合并 usedBy 与表情集合。
 * scenes 传最近一次校验的编译产物（与编辑器其余视图同源）。
 */
export function buildAssetInventory(opts: {
  dirAssets: DirAsset[];
  gallery: unknown;
  scenes: Map<string, CompiledScene>;
}): AssetEntry[] {
  const map = new Map<string, AssetEntry>();
  const put = (key: string, kind: AssetKind, source: AssetEntry['source']): AssetEntry => {
    let e = map.get(key);
    if (!e) {
      e = { key, kind, source, usedBy: [] };
      map.set(key, e);
    } else if (source === 'dir' || (source === 'gallery' && e.source === 'script')) {
      e.source = source; // 来源优先级：dir > gallery > script
    }
    return e;
  };

  // 1. 目录扫描条目
  for (const d of opts.dirAssets) {
    const e = put(d.key, d.kind, 'dir');
    if (d.kind === 'portrait' && d.expr) {
      e.exprs = e.exprs ?? [];
      if (!e.exprs.includes(d.expr)) e.exprs.push(d.expr);
    }
  }

  // 2. gallery.json：cgs/music 带 src 资源引用；texts 无素材引用
  const linkSrc = new Map<string, { src: string; usedBy: string[] }>();
  for (const [field, kind] of [['cgs', 'cg'], ['music', 'music']] as const) {
    for (const g of galleryList(opts.gallery, field)) {
      const id = typeof g.id === 'string' ? g.id : '';
      if (!id) continue;
      const e = put(id, kind, 'gallery');
      if (typeof g.src === 'string') e.assetSrc = g.src;
      linkSrc.set(id, { src: typeof g.src === 'string' ? g.src : '', usedBy: e.usedBy });
    }
  }
  for (const g of galleryList(opts.gallery, 'texts')) {
    const id = typeof g.id === 'string' ? g.id : '';
    if (!id) continue;
    put(id, 'text', 'gallery');
  }

  // 3. 剧本指令扫描：素材类指令参数 + unlock_* 关联 gallery 条目
  const use = (key: string, kind: AssetKind, sceneId: string): void => {
    const e = put(key, kind, 'script');
    if (!e.usedBy.includes(sceneId)) e.usedBy.push(sceneId);
  };
  for (const [sceneId, scene] of opts.scenes) {
    for (const instr of scene.instructions) {
      if (instr.op === 'instr') {
        const g = instr as GenericInstr;
        const a0 = g.args[0];
        switch (g.name) {
          case 'bg': if (a0) use(a0, 'bg', sceneId); break;
          case 'bgm': if (a0) use(a0, 'bgm', sceneId); break;
          case 'ambience': if (a0 && a0 !== 'off') use(a0, 'ambience', sceneId); break;
          case 'se': if (a0) use(a0, 'se', sceneId); break;
          case 'voice': if (a0) use(a0, 'voice', sceneId); break;
          case 'video': if (a0) use(a0, 'video', sceneId); break;
          case 'show': {
            if (a0) {
              use(a0, 'portrait', sceneId);
              const e = map.get(a0);
              const expr = g.args[1];
              if (e && expr) {
                e.exprs = e.exprs ?? [];
                if (!e.exprs.includes(expr)) e.exprs.push(expr);
              }
            }
            break;
          }
          case 'unlock_cg':
          case 'unlock_music':
          case 'unlock_text': {
            const link = a0 ? linkSrc.get(a0) : undefined;
            if (link && link.src) {
              // gallery id → 其 src 资源视为被间接使用
              const srcEntry = map.get(link.src);
              if (srcEntry && !srcEntry.usedBy.includes(sceneId)) srcEntry.usedBy.push(sceneId);
            }
            if (a0) {
              const kind: AssetKind = g.name === 'unlock_cg' ? 'cg' : g.name === 'unlock_music' ? 'music' : 'text';
              use(a0, kind, sceneId);
            }
            break;
          }
          default: break;
        }
      }
    }
    // choice 选项内联指令中也可能有素材指令（编译为选项块内指令流，上面已随 instructions 扫过）
  }

  return [...map.values()];
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
  cg: 'CG', music: '鉴赏音乐', text: '回想',
};
