import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CompiledScene, LintIssue } from '@surdet/core';

type GallerySection = 'cgs' | 'music' | 'texts';
type UnlockInstruction = 'unlock_cg' | 'unlock_music' | 'unlock_text';

const SECTION_RULES: Readonly<
  Record<
    GallerySection,
    {
      readonly unlock: UnlockInstruction;
      readonly assetFolder: 'bg' | 'bgm' | null;
    }
  >
> = {
  cgs: { unlock: 'unlock_cg', assetFolder: 'bg' },
  music: { unlock: 'unlock_music', assetFolder: 'bgm' },
  texts: { unlock: 'unlock_text', assetFolder: null },
};

const UNLOCK_TO_SECTION: Readonly<Record<UnlockInstruction, GallerySection>> = {
  unlock_cg: 'cgs',
  unlock_music: 'music',
  unlock_text: 'texts',
};

interface GalleryEntry {
  readonly id: string;
  readonly name: string;
  readonly src?: string;
  readonly scene?: string;
  readonly label?: string;
}

export interface GalleryLintContext {
  readonly root: string;
  readonly scenes: ReadonlyMap<string, CompiledScene>;
  readonly failedSceneIds: ReadonlySet<string>;
  readonly issues: LintIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function addIssue(issues: LintIssue[], code: string, text: string, file: string, line = 0, col = 0): void {
  issues.push({ severity: 'error', code, text, file, line, col });
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

function parseEntries(
  value: unknown,
  section: GallerySection,
  galleryPath: string,
  issues: LintIssue[],
): GalleryEntry[] {
  if (!Array.isArray(value)) {
    addIssue(issues, 'G001', `gallery.json 的 ${section} 必须是数组`, galleryPath);
    return [];
  }

  const entries: GalleryEntry[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isRecord(raw)) {
      addIssue(issues, 'G001', `gallery.json 的 ${section}[${index}] 必须是对象`, galleryPath);
      continue;
    }
    if (!nonEmptyString(raw.id) || !nonEmptyString(raw.name)) {
      addIssue(issues, 'G001', `gallery.json 的 ${section}[${index}] 必须有非空 id/name`, galleryPath);
      continue;
    }

    if (section === 'texts') {
      if (!nonEmptyString(raw.scene)) {
        addIssue(issues, 'G001', `gallery.json 的 texts[${index}] 必须有非空 scene`, galleryPath);
        continue;
      }
      const label = raw.label;
      if ('label' in raw && !nonEmptyString(label)) {
        addIssue(issues, 'G001', `gallery.json 的 texts[${index}].label 若提供必须是非空字符串`, galleryPath);
        continue;
      }
      entries.push({
        id: raw.id,
        name: raw.name,
        scene: raw.scene,
        ...(label === undefined ? {} : { label: label as string }),
      });
      continue;
    }

    const src = raw.src;
    if ('src' in raw && !nonEmptyString(src)) {
      addIssue(issues, 'G001', `gallery.json 的 ${section}[${index}].src 若提供必须是非空字符串`, galleryPath);
      continue;
    }
    entries.push({ id: raw.id, name: raw.name, ...(src === undefined ? {} : { src: src as string }) });
  }
  return entries;
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

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(galleryPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    addIssue(
      context.issues,
      'G001',
      `gallery.json 解析失败：${err instanceof Error ? err.message : String(err)}`,
      galleryPath,
    );
    return;
  }
  if (!isRecord(raw)) {
    addIssue(context.issues, 'G001', 'gallery.json 根值必须是对象', galleryPath);
    return;
  }

  const cgs = parseEntries(raw.cgs, 'cgs', galleryPath, context.issues);
  const music = parseEntries(raw.music, 'music', galleryPath, context.issues);
  const texts = raw.texts === undefined ? [] : parseEntries(raw.texts, 'texts', galleryPath, context.issues);
  const entries: Record<GallerySection, GalleryEntry[]> = { cgs, music, texts };

  const ids: Record<GallerySection, Set<string>> = { cgs: new Set(), music: new Set(), texts: new Set() };
  for (const section of Object.keys(SECTION_RULES) as GallerySection[]) {
    for (const entry of entries[section]) {
      if (ids[section].has(entry.id)) {
        addIssue(context.issues, 'G002', `gallery.json 的 ${section} 存在重复 id '${entry.id}'`, galleryPath);
      } else {
        ids[section].add(entry.id);
      }
    }
  }

  const bgAssets = indexAssetStems(path.join(context.root, 'content/assets/bg'));
  const bgmAssets = indexAssetStems(path.join(context.root, 'content/assets/bgm'));
  const avatarAssets = indexAssetStems(path.join(context.root, 'content/assets/avatar'));
  const assets: Record<'bg' | 'bgm', Set<string>> = { bg: bgAssets, bgm: bgmAssets };

  for (const section of ['cgs', 'music'] as const) {
    const assetFolder = SECTION_RULES[section].assetFolder!;
    for (const entry of entries[section]) {
      const key = entry.src ?? entry.id;
      if (!assets[assetFolder].has(key)) {
        addIssue(
          context.issues,
          'G003',
          `Gallery ${section} 条目 '${entry.id}' 的素材键 '${key}' 不存在于 content/assets/${assetFolder}`,
          galleryPath,
        );
      }
    }
  }

  for (const entry of texts) {
    const scene = entry.scene!;
    if (!context.scenes.has(scene) && !context.failedSceneIds.has(scene)) {
      addIssue(context.issues, 'G004', `文本回想 '${entry.id}' 的目标场景 '${scene}' 不存在`, galleryPath);
    }
    if (entry.label !== undefined && !context.scenes.get(scene)?.labels.has(entry.label)) {
      addIssue(context.issues, 'G005', `文本回想 '${entry.id}' 的标签 '${entry.label}' 不存在`, galleryPath);
    }
  }

  const unlocked: Record<GallerySection, Set<string>> = { cgs: new Set(), music: new Set(), texts: new Set() };
  for (const scene of context.scenes.values()) {
    for (const instruction of scene.instructions) {
      if (instruction.op !== 'instr') continue;
      const section = UNLOCK_TO_SECTION[instruction.name as UnlockInstruction];
      if (section === undefined) continue;
      const id = instruction.args[0];
      if (!nonEmptyString(id) || !ids[section].has(id)) {
        addIssue(
          context.issues,
          'G006',
          `@${instruction.name} 的参数 '${id ?? ''}' 没有对应的 gallery.json 条目`,
          instruction.file,
          instruction.line,
          instruction.col,
        );
        continue;
      }
      unlocked[section].add(id);
    }
  }

  for (const section of Object.keys(SECTION_RULES) as GallerySection[]) {
    for (const entry of entries[section]) {
      if (!unlocked[section].has(entry.id)) {
        addIssue(
          context.issues,
          'G007',
          `Gallery ${section} 条目 '${entry.id}' 没有匹配的 @${SECTION_RULES[section].unlock} 解锁点`,
          galleryPath,
        );
      }
    }
  }

  const characters = readCharacters(context.root);
  if (characters !== null) {
    for (const [characterId, character] of Object.entries(characters)) {
      if (!isRecord(character) || !('avatar' in character)) continue;
      const avatar = character.avatar;
      if (!nonEmptyString(avatar) || !avatarAssets.has(avatar)) {
        addIssue(
          context.issues,
          'G008',
          `characters.${characterId}.avatar '${typeof avatar === 'string' ? avatar : String(avatar)}' 不是 content/assets/avatar 中的有效素材键`,
          path.join(context.root, 'game.config.json'),
        );
      }
    }
  }
}
