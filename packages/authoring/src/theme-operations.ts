import {
  projectThemeAssetKeys,
  resolveProjectTheme,
  resolveProjectTitleLogo,
  resolvePlayerTheme,
  THEME_TOKEN_GROUPS,
  type ProjectThemeSection,
} from '@surdet/core';
import { AuthoringOperationError, runOperation, stableStringify, type ChangeSession } from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import type { LedgerDiffEntry, ProjectAssetCatalog } from './contracts.js';
import type { TextHasher } from './project-storage.js';

const CONFIG_PATH = 'game.config.json';

/** 公开读取结果：原始值（缺失为 null）、有效解析值与修改指纹。 */
export interface ThemeConfigInspection {
  /** game.config.json.theme 原文对象；未提供时 null。 */
  value: Record<string, unknown> | null;
  /** 解析后的有效主题段（token/皮肤/布局均含默认）。 */
  effective: ProjectThemeSection;
  /** player.titleLogo 当前值；未提供时 null。 */
  titleLogo: string | null;
  fingerprint: string;
  /** Project configuration versus engine default; explicit host overrides are runtime inputs. */
  sources: Record<string, 'project' | 'default'>;
}

export interface ThemeConfigPatchInput {
  operationId: string;
  expectedFingerprint: string;
  /**
   * 窄字段修改：
   * - theme 分组（colors/opacity/typography/spacing/radius）整表替换；null 删除该组
   * - dialogSkin/buttonSkin：字符串设置，null 清除
   * - dialogHeightRatio/dialogMarginX/dialogMarginBottom：数值设置，null 恢复默认
   * - titleLogo：字符串设置，null 清除
   * - 整体 patch 为 null 时删除整个 theme 段（不影响 titleLogo）
   */
  patch: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 组合指纹：theme 段 + titleLogo，供候选/重放识别版本事实。 */
async function themeFingerprint(config: Record<string, unknown>, hasher: TextHasher): Promise<string> {
  const section = config['theme'] ?? null;
  const titleLogo = resolveProjectTitleLogo(config);
  return hasher.sha256(stableStringify({ theme: section, titleLogo }));
}

export async function inspectThemeConfig(config: Record<string, unknown>, hasher: TextHasher): Promise<ThemeConfigInspection> {
  let effective: ProjectThemeSection;
  try { effective = resolveProjectTheme(config); }
  catch (error) { throw new AuthoringOperationError('PROJECT_INVALID', error instanceof Error ? error.message : String(error)); }
  let titleLogo: string | null;
  try { titleLogo = resolveProjectTitleLogo(config); }
  catch (error) { throw new AuthoringOperationError('PROJECT_INVALID', error instanceof Error ? error.message : String(error)); }
  const value = config['theme'] === undefined ? null : config['theme'];
  if (value !== null && !isRecord(value)) throw new AuthoringOperationError('PROJECT_INVALID', 'game.config.json.theme 必须是对象');
  const resolved = resolvePlayerTheme(config);
  const sources: Record<string, 'project' | 'default'> = {};
  for (const group of THEME_TOKEN_GROUPS) {
    for (const key of Object.keys(resolved[group])) sources[`${group}.${key}`] = Object.hasOwn(effective.tokens[group] ?? {}, key) ? 'project' : 'default';
    effective.tokens[group] = { ...resolved[group] };
  }
  for (const key of [...Object.keys(effective.skins), ...Object.keys(effective.layout)]) sources[key] = isRecord(value) && Object.hasOwn(value, key) ? 'project' : 'default';
  sources.titleLogo = titleLogo === null ? 'default' : 'project';
  return { value: value as Record<string, unknown> | null, effective, titleLogo, sources, fingerprint: await themeFingerprint(config, hasher) };
}

const THEME_GROUPS = new Set<string>(THEME_TOKEN_GROUPS);
const THEME_SCALARS = new Set(['dialogSkin', 'buttonSkin', 'dialogHeightRatio', 'dialogMarginX', 'dialogMarginBottom']);
const THEME_FIELDS = new Set([...THEME_GROUPS, ...THEME_SCALARS]);

export function validateThemeAssetBindings(section: ProjectThemeSection, titleLogo: string | null, assets: ProjectAssetCatalog): void {
  const keys = [...projectThemeAssetKeys(section), ...(titleLogo ? [titleLogo] : [])];
  for (const key of keys) {
    if (!assets.backgrounds.some(item => item.key === key && item.resolved)) {
      throw new AuthoringOperationError('VALIDATION_FAILED', `主题/字标素材不存在或不支持：${key}`);
    }
  }
  const { dialogHeightRatio, dialogMarginX, dialogMarginBottom } = section.layout;
  if (dialogHeightRatio !== null && (dialogHeightRatio <= 0 || dialogHeightRatio > 1)) {
    throw new AuthoringOperationError('VALIDATION_FAILED', `dialogHeightRatio 必须在 (0, 1]：${dialogHeightRatio}`);
  }
  if (dialogMarginX !== null && dialogMarginX < 0) {
    throw new AuthoringOperationError('VALIDATION_FAILED', `dialogMarginX 不能为负：${dialogMarginX}`);
  }
  if (dialogMarginBottom !== null && dialogMarginBottom < 0) {
    throw new AuthoringOperationError('VALIDATION_FAILED', `dialogMarginBottom 不能为负：${dialogMarginBottom}`);
  }
}

export async function applyThemeConfigPatch(
  change: ChangeSession,
  input: ThemeConfigPatchInput,
  hasher: TextHasher,
  assets: ProjectAssetCatalog,
) {
  if (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined) {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '主题配置修改只支持普通 direct 草稿', { operationApplied: false, operationId: input.operationId });
  }
  return runOperation(change, input, async record => {
    const source = record.workingFiles[CONFIG_PATH] ?? '{}';
    const config = parseProjectConfigDocument(source);
    const before = await inspectThemeConfig(config, hasher);
    if (before.fingerprint !== input.expectedFingerprint) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', '主题配置指纹已变化，请重新读取 project.inspect');
    }

    if (input.patch === null) {
      delete config['theme'];
    } else {
      if (!isRecord(input.patch)) throw new AuthoringOperationError('INVALID_REQUEST', 'theme patch 必须是字段对象或 null');
      const themeRaw = config['theme'];
      const next: Record<string, unknown> = isRecord(themeRaw) ? { ...themeRaw } : {};
      for (const [key, value] of Object.entries(input.patch)) {
        if (key === 'titleLogo') continue; // player 字段单独处理
        if (!THEME_FIELDS.has(key) || value === undefined) {
          throw new AuthoringOperationError('INVALID_REQUEST', `非法主题字段：${key}`);
        }
        if (value === null) {
          delete next[key];
          continue;
        }
        if (THEME_GROUPS.has(key)) {
          if (!isRecord(value)) throw new AuthoringOperationError('INVALID_REQUEST', `theme.${key} 必须是数值对象或 null`);
          for (const [token, tokenValue] of Object.entries(value)) {
            if (typeof tokenValue !== 'number' || !Number.isFinite(tokenValue)) {
              throw new AuthoringOperationError('INVALID_REQUEST', `theme.${key}.${token} 必须是有限数值`);
            }
          }
          next[key] = value;
          continue;
        }
        if (key === 'dialogSkin' || key === 'buttonSkin') {
          if (typeof value !== 'string') throw new AuthoringOperationError('INVALID_REQUEST', `theme.${key} 必须是字符串或 null`);
          next[key] = value;
          continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new AuthoringOperationError('INVALID_REQUEST', `theme.${key} 必须是有限数值或 null`);
        }
        next[key] = value;
      }
      if (Object.keys(next).length === 0) delete config['theme'];
      else config['theme'] = next;
    }

    if (input.patch !== null && isRecord(input.patch) && Object.hasOwn(input.patch, 'titleLogo')) {
      const playerRaw = config['player'];
      const player: Record<string, unknown> = isRecord(playerRaw) ? { ...playerRaw } : {};
      const logoValue = input.patch['titleLogo'];
      if (logoValue === undefined) throw new AuthoringOperationError('INVALID_REQUEST', '重置 titleLogo 请显式传 null');
      if (logoValue === null) delete player['titleLogo'];
      else if (typeof logoValue === 'string') player['titleLogo'] = logoValue;
      else throw new AuthoringOperationError('INVALID_REQUEST', 'titleLogo 必须是字符串或 null');
      if (Object.keys(player).length === 0) delete config['player'];
      else config['player'] = player;
    }

    const after = await inspectThemeConfig(config, hasher);
    validateThemeAssetBindings(after.effective, after.titleLogo, assets);

    const fields = input.patch === null ? ['theme'] : Object.keys(input.patch);
    const diffEntry: LedgerDiffEntry = {
      kind: 'config.theme.patch', operationId: input.operationId,
      fingerprintBefore: before.fingerprint, fingerprintAfter: after.fingerprint,
      directChange: { path: CONFIG_PATH, fields },
      potentialImpact: [], observedImpact: [],
    };
    return {
      result: { themeConfig: after, diffEntry },
      workingFiles: { ...record.workingFiles, [CONFIG_PATH]: serializeProjectConfigDocument(config, source) },
    };
  });
}
