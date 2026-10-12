import { portraitSourcePaths, resolveProjectPortraits } from '@surdet/core';
import { buildProjectAssetIntelligence } from './asset-intelligence.js';
import type { AssetEntry, ProjectAssetCatalog, ProjectAssetFileFact } from './contracts.js';
import type { ProjectSnapshot } from './project-snapshot.js';

/** 受支持格式集合以仓库现有资源加载器事实为基线（浏览器/编辑器图像格式集合），不发明新规则。 */
export const SUPPORTED_ASSET_FORMATS: readonly string[] = [
  'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif',
];

export function isSupportedAssetFormat(format: string): boolean {
  return SUPPORTED_ASSET_FORMATS.includes(format.toLowerCase());
}

export function backgroundAssetRef(key: string): string {
  return `asset:bg:${key}`;
}

export function portraitAssetRef(role: string, outfit: string, expression: string): string {
  return `asset:portrait:${role}:${outfit}:${expression}`;
}

export function avatarAssetRef(name: string): string {
  return `asset:avatar:${name}`;
}

const BG_PREFIX = 'content/assets/bg/';
const AVATAR_PREFIX = 'content/assets/avatar/';

function extensionOf(sourcePath: string): string {
  const base = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

function stemOf(sourcePath: string): string {
  const base = sourcePath.slice(sourcePath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

/**
 * 共享只读 asset catalog：输入只是路径/文件名/扩展名元数据（CLI 与 editor 各自枚举后提供），
 * 共享层统一解析命名规则与受支持格式。不读文件内容、不写资源。
 */
export function buildAssetCatalog(
  inputs: readonly (string | ProjectAssetFileFact)[],
  snapshot?: ProjectSnapshot,
  options: { gallery?: unknown } = {},
): ProjectAssetCatalog {
  const facts = inputs.map((input) => typeof input === 'string' ? { path: input } : input);
  const paths = facts.map((fact) => fact.path);
  const backgrounds: AssetEntry[] = [];
  const portraits: AssetEntry[] = [];
  const avatars: AssetEntry[] = [];
  const rules: AssetEntry[] = [];
  const seen = new Set<string>();
  for (const sourcePath of [...paths].sort((a, b) => a.localeCompare(b))) {
    if (sourcePath.includes('\\')) continue; // retained in intelligence as ASSET_NAME_INVALID
    if (sourcePath.startsWith('content/assets/rule/')) {
      const key = stemOf(sourcePath), format = extensionOf(sourcePath);
      if (key.length === 0 || key.startsWith('.')) continue;
      if (!seen.has(sourcePath)) {
        seen.add(sourcePath);
        rules.push({ kind: 'rule', key, sourcePath, format, resolved: isSupportedAssetFormat(format) });
      }
      continue;
    }
    if (sourcePath.startsWith(BG_PREFIX)) {
      const key = stemOf(sourcePath);
      if (key.length === 0 || key.startsWith('.')) continue;
      const format = extensionOf(sourcePath);
      const entry: AssetEntry = { kind: 'background', key, sourcePath, format, resolved: isSupportedAssetFormat(format) };
      if (!seen.has(entry.sourcePath)) {
        seen.add(entry.sourcePath);
        backgrounds.push(entry);
      }
      continue;
    }
    if (sourcePath.startsWith(AVATAR_PREFIX)) {
      const key = stemOf(sourcePath);
      if (key.length === 0 || key.startsWith('.')) continue;
      const format = extensionOf(sourcePath);
      const entry: AssetEntry = { kind: 'avatar', key, sourcePath, format, resolved: isSupportedAssetFormat(format) };
      if (!seen.has(entry.sourcePath)) {
        seen.add(entry.sourcePath);
        avatars.push(entry);
      }
      continue;
    }
    // fonts、public/ 与其它目录不进入可投影图片资源合同。
  }
  const emptySnapshot: ProjectSnapshot = snapshot ?? {
    rootIdentity: 'asset-catalog:path-only',
    revision: '',
    files: [],
    configFile: null,
    config: {},
    variables: {},
    scenes: [],
    timelines: [],
  };
  const intelligence = buildProjectAssetIntelligence(emptySnapshot, facts, options);
  for (const entry of rules) {
    const item = intelligence.items.find(item => item.sourcePath === entry.sourcePath);
    entry.resolved = entry.resolved && !!item?.physical && item.issues.every(issue => issue === 'ASSET_UNUSED');
  }
  const portraitBindings = resolveProjectPortraits(emptySnapshot.config, paths);
  const slotPaths = new Map<string, Set<string>>();
  const slotOf = (portrait: (typeof portraitBindings)[number]): string => JSON.stringify([portrait.role, portrait.outfit, portrait.expression]);
  for (const portrait of portraitBindings) {
    const slot = slotOf(portrait);
    const matches = slotPaths.get(slot) ?? new Set<string>();
    matches.add(portrait.sourcePath);
    slotPaths.set(slot, matches);
  }
  for (const portrait of portraitBindings) {
    const { role, outfit, expression, sourcePath } = portrait;
    const sources = portraitSourcePaths(portrait);
    portraits.push({ ...portrait, kind: 'portrait', key: `${role}:${outfit}`, timelineTarget: `${role}:${outfit}`,
      ...(portrait.visual ? { sourcePaths: sources } : {}),
      format: extensionOf(sourcePath), resolved: slotPaths.get(slotOf(portrait))?.size === 1 && sources.every(path => {
        const item = intelligence.items.find(item => item.sourcePath === path);
        return !!item?.physical && item.issues.every(issue => issue === 'ASSET_UNUSED' || issue === 'ASSET_KEY_DUPLICATE' || (portrait.configured && issue === 'ASSET_NAME_INVALID'));
      }) });
  }
  for (const entry of [...backgrounds, ...portraits]) {
    const item = intelligence.items.find(item => item.sourcePath === entry.sourcePath);
    // Physical duplicates do not make every exact alias ambiguous. Portrait
    // slots have already passed their own unique-path resolution above.
    if (!entry.resolved || !item || (entry.kind !== 'portrait' && item.issues.some(issue => issue !== 'ASSET_UNUSED'))) continue;
    // Generic instruction arguments are serialized as DSL tokens. Quoting also
    // preserves spaces, apostrophes and modifier-looking names in legal files.
    const token = (value: string) => `"${value}"`;
    entry.usage = entry.kind === 'background'
      ? {
        scene: { kind: 'instruction', name: 'bg', args: [token(entry.key)] },
        timeline: { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: entry.key }] },
      }
      : {
        scene: { kind: 'instruction', name: 'show', args: [token(entry.timelineTarget!), token(entry.expression!)], modifiers: { pos: 'center' } },
        timeline: { kind: 'portrait', target: entry.timelineTarget!, cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'show', expression: entry.expression!, position: 'center' }] },
      };
  }
  return {
    backgrounds,
    portraits,
    avatars,
    rules,
    intelligence,
  };
}

/** 从任意项目文件路径集合中筛出 content/assets 物理素材路径。 */
export function assetPathsFromFiles(paths: readonly string[]): string[] {
  return paths.filter((path) => path.startsWith('content/assets/'));
}
