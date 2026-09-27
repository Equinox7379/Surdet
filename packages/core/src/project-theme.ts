import { createPresentationTheme, type PresentationTheme, type PresentationThemeOverrides } from './theme-tokens.js';

/**
 * 作品主题 / UI 资源 / 基础布局的纯配置解析。
 * 不依赖 Renderer；与所有消费者共用纯数据主题合同。
 */

/** 可被 createRendererTheme 接受的 token 分组键。 */
export const THEME_TOKEN_GROUPS = ['colors', 'opacity', 'typography', 'spacing', 'radius'] as const;
export type ThemeTokenGroup = (typeof THEME_TOKEN_GROUPS)[number];

/** 主题 token 覆盖表（与 RendererThemeOverrides 同构的纯数据）。 */
export type ProjectThemeTokens = Partial<Record<ThemeTokenGroup, Record<string, number>>>;

/** 对话框 / 按钮皮肤资源键（引用背景图像注册表）。 */
export interface ProjectUiSkins {
  dialogSkin: string | null;
  buttonSkin: string | null;
}

/** 基础布局旋钮；null 表示未提供，消费端使用引擎默认。 */
export interface ProjectUiLayout {
  dialogHeightRatio: number | null;
  dialogMarginX: number | null;
  dialogMarginBottom: number | null;
}

export interface ProjectThemeSection {
  tokens: ProjectThemeTokens;
  skins: ProjectUiSkins;
  layout: ProjectUiLayout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumberTable(raw: unknown, label: string): Record<string, number> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new Error(`game.config.json.theme.${label} 必须是数值对象`);
  const table: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`game.config.json.theme.${label}.${key} 必须是有限数值`);
    }
    table[key] = value;
  }
  return table;
}

function readOptionalString(raw: unknown, label: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') throw new Error(`game.config.json.theme.${label} 必须是字符串或 null`);
  return raw;
}

function readOptionalNumber(raw: unknown, label: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new Error(`game.config.json.theme.${label} 必须是有限数值或 null`);
  return raw;
}

/**
 * 读取 game.config.json.theme。字段省略表示未提供（保持默认外观）；
 * 显式 null 在资源字段上表示清除，在数值布局字段上表示恢复默认。
 * 未知字段保留不读（由文档序列化层负责不丢失）。
 */
export function resolveProjectTheme(config: unknown): ProjectThemeSection {
  const empty: ProjectThemeSection = {
    tokens: {},
    skins: { dialogSkin: null, buttonSkin: null },
    layout: { dialogHeightRatio: null, dialogMarginX: null, dialogMarginBottom: null },
  };
  if (typeof config !== 'object' || config === null) return empty;
  const raw = (config as { theme?: unknown }).theme;
  if (raw === undefined) return empty;
  if (!isRecord(raw)) throw new Error('game.config.json.theme 必须是对象');

  const tokens: ProjectThemeTokens = {};
  for (const group of THEME_TOKEN_GROUPS) {
    const table = readNumberTable(raw[group], group);
    if (table !== undefined) tokens[group] = table;
  }

  const dialogSkin = readOptionalString(raw['dialogSkin'], 'dialogSkin');
  const buttonSkin = readOptionalString(raw['buttonSkin'], 'buttonSkin');
  const dialogHeightRatio = readOptionalNumber(raw['dialogHeightRatio'], 'dialogHeightRatio');
  const dialogMarginX = readOptionalNumber(raw['dialogMarginX'], 'dialogMarginX');
  const dialogMarginBottom = readOptionalNumber(raw['dialogMarginBottom'], 'dialogMarginBottom');

  const section: ProjectThemeSection = {
    tokens,
    skins: {
      dialogSkin: dialogSkin === undefined ? null : dialogSkin,
      buttonSkin: buttonSkin === undefined ? null : buttonSkin,
    },
    layout: {
      dialogHeightRatio: dialogHeightRatio === undefined ? null : dialogHeightRatio,
      dialogMarginX: dialogMarginX === undefined ? null : dialogMarginX,
      dialogMarginBottom: dialogMarginBottom === undefined ? null : dialogMarginBottom,
    },
  };
  createPresentationTheme(sectionOverrides(section));
  return section;
}

function sectionOverrides(section: ProjectThemeSection): PresentationThemeOverrides {
  return { ...section.tokens, skins: {
    dialogSkin: section.skins.dialogSkin ?? '', buttonSkin: section.skins.buttonSkin ?? '',
  }, layout: section.layout };
}

/** Explicit fields override project fields; untouched fields retain project values. */
export function resolvePlayerTheme(config: unknown, explicit: PresentationThemeOverrides = {}): PresentationTheme {
  const project = sectionOverrides(resolveProjectTheme(config));
  createPresentationTheme(explicit);
  return createPresentationTheme({
    colors: { ...project.colors, ...explicit.colors },
    opacity: { ...project.opacity, ...explicit.opacity },
    typography: { ...project.typography, ...explicit.typography },
    spacing: { ...project.spacing, ...explicit.spacing },
    radius: { ...project.radius, ...explicit.radius },
    skins: { ...project.skins, ...explicit.skins },
    layout: { ...project.layout, ...explicit.layout },
  });
}

/** 提取可直接交给 createRendererTheme 的 token 覆盖表；无 token 时返回 undefined。 */
export function projectThemeTokens(section: ProjectThemeSection): ProjectThemeTokens | undefined {
  return Object.keys(section.tokens).length > 0 ? section.tokens : undefined;
}

/** 主题引用的图片资源键（进入素材目录与构建依赖）。 */
export function projectThemeAssetKeys(section: ProjectThemeSection): string[] {
  const keys: string[] = [];
  if (section.skins.dialogSkin) keys.push(section.skins.dialogSkin);
  if (section.skins.buttonSkin) keys.push(section.skins.buttonSkin);
  return keys;
}

/** 标题字标资源键（player.titleLogo）；未提供时 null。 */
export function resolveProjectTitleLogo(config: unknown): string | null {
  if (typeof config !== 'object' || config === null) return null;
  const player = (config as { player?: unknown }).player;
  if (player === undefined) return null;
  if (!isRecord(player)) throw new Error('game.config.json.player 必须是对象');
  const value = player['titleLogo'];
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new Error('game.config.json.player.titleLogo 必须是字符串');
  return value;
}
