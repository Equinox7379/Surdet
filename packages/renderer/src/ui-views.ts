/**
 * 全屏级 UI 视图模型：标题画面 / 系统菜单 / 存读档 / 大地图。
 * 全部为纯函数 + 数据结构（headless 可测），PixiStage 负责展示，宿主负责交互决策。
 */

/* ============================ 标题画面 ============================ */

export interface TitleItemView {
  id: string;
  label: string;
  /** 灰显不可点（如"无存档时的 继续"） */
  enabled?: boolean;
  /** 次要入口放入页脚，不占用主菜单列。 */
  secondary?: boolean;
}

export interface TitleView {
  title: string;
  subtitle?: string;
  /** 标题页底图资源 key；缺失时使用主题底色。 */
  backgroundKey?: string;
  /** 可选透明字标，复用背景图像注册表；没有素材时仍显示 title 文本。 */
  logoKey?: string;
  items: TitleItemView[];
}

/* ============================ 系统菜单 ============================ */

export interface SystemMenuItemView {
  id: string;
  label: string;
}

/* ============================ 存档/读档 ============================ */

export interface SaveSlotView {
  id: string;
  /** 空槽位（load 模式下不可选） */
  empty: boolean;
  /** 描述（章节/位置） */
  label?: string;
  /** 时间戳（毫秒） */
  updatedAt?: number;
  kind?: 'manual' | 'quick' | 'auto';
  /** 存档缩略图（舞台截图 dataURL；PixiStage 渲染为卡片预览图） */
  thumbnail?: string;
  /** 游戏时长（秒；卡片展示 h/m） */
  playTimeSec?: number;
  /** 该槽位存在可由玩家明确触发的上一版本备份。仅 load 页面投影。 */
  backupAvailable?: boolean;
  /** Occupied but unreadable main save; cannot load, still requires overwrite confirmation. */
  readError?: string;
  /** Unreadable backup diagnostic; it must not be offered as restorable. */
  backupError?: string;
}

export interface SaveLoadView {
  mode: 'save' | 'load';
  slots: SaveSlotView[];
}

/** 时间戳 → 简短展示（MM-DD HH:mm） */
export function formatSlotTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ============================ 大地图 ============================ */

export interface MapNodeView {
  id: string;
  name: string;
  /** 逻辑坐标（1280×720 画面） */
  x: number;
  y: number;
  /** 当前可进入（可见 + 行动力足够） */
  enterable: boolean;
  visited: boolean;
  apCost: number;
  isBase?: boolean;
}

export interface MapView {
  turn: number;
  ap: number;
  maxAp: number;
  /** 日期展示（CalendarRunner.date） */
  date: string;
  nodes: MapNodeView[];
}

/** 组装地图视图：坐标 clamp 到画面安全区（防配置越界） */
export function buildMapView(input: Omit<MapView, 'nodes'> & { nodes: MapNodeView[] }): MapView {
  return {
    ...input,
    nodes: input.nodes.map((n) => ({
      ...n,
      x: Math.max(70, Math.min(1210, n.x)),
      y: Math.max(120, Math.min(600, n.y)),
    })),
  };
}

/* ============================ 据点指令 ============================ */

export interface BaseCommandView {
  id: string;
  name: string;
  /** 行动力消耗 */
  apCost: number;
  /** 当前可执行（行动力 + 限次 + when 条件均满足） */
  enabled: boolean;
  /** 本回合剩余次数（限次指令展示用；不限次为 null） */
  remaining?: number | null;
}

export interface BasePanelView {
  ap: number;
  maxAp: number;
  date: string;
  commands: BaseCommandView[];
  /** 结算反馈信息（宿主每次 exec 后刷新） */
  message?: string;
}
