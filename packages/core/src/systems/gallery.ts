/**
 * 回想/鉴赏系统类型定义。
 * CG 与音乐解锁状态实现在 gallery-state.ts（@unlock_cg / @unlock_music 驱动，可存档）。
 * 文本回想（GalleryTextEntry）与全 CG 校验入口为预留配置类型。
 */

export interface GalleryCgEntry {
  id: string;
  title: string;
  /** CG 图路径 */
  image: string;
  /** 解锁条件（DSL 布尔表达式或场景完成标记） */
  unlockWhen: string;
  /** 所属章节/角色（鉴赏界面分组） */
  group: string;
}

export interface GalleryTextEntry {
  id: string;
  title: string;
  /** 回想剧本场景（从标记处开始） */
  scene: string;
  label: string;
  unlockWhen: string;
}

export interface GalleryMusicEntry {
  id: string;
  title: string;
  audio: string;
  unlockWhen: string;
}

/** 鉴赏配置：全成就/全解锁校验入口 */
export interface GalleryConfig {
  cgs: GalleryCgEntry[];
  texts: GalleryTextEntry[];
  music: GalleryMusicEntry[];
}
