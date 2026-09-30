/**
 * 回想/鉴赏（Gallery）视图模型：把「鉴赏配置 + 解锁状态」映射为展示列表。
 * 配置数据驱动（gallery.json），解锁状态来自 core 的 GalleryState（随存档持久化）。
 * 纯函数、headless 可测；PixiStage.showGallery 负责展示，宿主负责打开时机。
 */

/** CG 鉴赏条目 */
export interface GalleryCgDef {
  id: string;
  /** 展示名（未解锁时界面显示 ???） */
  name: string;
  /** 素材 key（与 @bg 的 key 一致；注册过真实素材即可全屏回看） */
  src?: string;
}

/** 音乐鉴赏条目 */
export interface GalleryMusicDef {
  id: string;
  name: string;
  /** 音频地址（缺省时宿主可用 id 兜底寻址） */
  src?: string;
}

/** 文本回想条目：解锁后可跳回场景重播 */
export interface GalleryTextDef {
  id: string;
  name: string;
  /** 回想场景 ID */
  scene: string;
  /** 场景内起点标签（缺省场景开头） */
  label?: string;
  /** Initial conditions, applied over project defaults by the shared Player. */
  variables?: Record<string, import('@surdet/core').VarValue>;
}

/** 鉴赏配置（content/config/gallery.json） */
export interface GalleryConfig {
  unlockPolicy?: Partial<import('@surdet/core').GalleryUnlockPolicy>;
  cgs: GalleryCgDef[];
  music: GalleryMusicDef[];
  texts?: GalleryTextDef[];
}

/** 单个鉴赏条目的展示形态 */
export interface GalleryItemView {
  id: string;
  name: string;
  /** 是否已解锁（未解锁不展示名称，只显示 ???） */
  unlocked: boolean;
  src?: string;
  /** 文本回想：回想场景与起点标签（点击重播用） */
  scene?: string;
  label?: string;
}

/** 合并配置与解锁状态 → 展示列表（顺序与配置一致） */
export function buildGalleryViews(
  config: GalleryConfig,
  unlocked: { cgs: string[]; music: string[]; texts?: string[] },
): { cgs: GalleryItemView[]; music: GalleryItemView[]; texts: GalleryItemView[] } {
  const cgSet = new Set(unlocked.cgs);
  const musicSet = new Set(unlocked.music);
  const textSet = new Set(unlocked.texts ?? []);
  return {
    cgs: config.cgs.map((c) => ({ id: c.id, name: c.name, unlocked: cgSet.has(c.id), src: c.src })),
    music: config.music.map((m) => ({ id: m.id, name: m.name, unlocked: musicSet.has(m.id), src: m.src })),
    texts: (config.texts ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      unlocked: textSet.has(t.id),
      scene: t.scene,
      label: t.label,
    })),
  };
}
