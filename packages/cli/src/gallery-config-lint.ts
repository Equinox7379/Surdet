import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CompiledScene, LintIssue } from '@surdet/core';
import { validateGalleryConfig } from '@surdet/authoring';

export interface GalleryLintContext {
  readonly root: string;
  readonly scenes: ReadonlyMap<string, CompiledScene>;
  readonly failedSceneIds: ReadonlySet<string>;
  readonly issues: LintIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function indexAssetStems(folder: string): Set<string> {
  const stems = new Set<string>();
  if (!fs.existsSync(folder)) return stems;

  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else stems.add(path.parse(entry.name).name);
    }
  };
  visit(folder);
  return stems;
}

function readCharacters(root: string): Record<string, unknown> | null {
  const configPath = path.join(root, 'game.config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!isRecord(parsed) || !isRecord(parsed.characters)) return null;
    return parsed.characters;
  } catch {
    // game.config.json 的解析问题由现有 lint 配置校验报告；这里不重复制造根因。
    return null;
  }
}

/** Generic, deterministic Gallery declaration and unlock-graph validation for `surdet lint`. */
export function lintGalleryConfig(context: GalleryLintContext): void {
  const galleryPath = path.join(context.root, 'content/config/gallery.json');
  if (!fs.existsSync(galleryPath)) return;

  let text: string;
  try {
    text = fs.readFileSync(galleryPath, 'utf8');
  } catch (error) {
    context.issues.push({ severity: 'error', code: 'G001',
      text: `gallery.json 解析失败：${error instanceof Error ? error.message : String(error)}`,
      file: galleryPath, line: 0, col: 0 });
    return;
  }
  context.issues.push(...validateGalleryConfig({
    text,
    galleryPath,
    scenes: context.scenes,
    failedSceneIds: context.failedSceneIds,
    bgAssets: indexAssetStems(path.join(context.root, 'content/assets/bg')),
    bgmAssets: indexAssetStems(path.join(context.root, 'content/assets/bgm')),
    avatarAssets: indexAssetStems(path.join(context.root, 'content/assets/avatar')),
    characters: readCharacters(context.root),
    configPath: path.join(context.root, 'game.config.json'),
  }));
}
