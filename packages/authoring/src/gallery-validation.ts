import type { CompiledScene, LintIssue } from '@surdet/core';
import { readGalleryUnlockPolicy, readGalleryReplayEntries, type VarDeclaration } from '@surdet/core';

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

export interface GalleryValidationInput {
  readonly text: string;
  readonly galleryPath: string;
  readonly scenes: ReadonlyMap<string, CompiledScene>;
  readonly failedSceneIds: ReadonlySet<string>;
  readonly bgAssets?: ReadonlySet<string>;
  readonly bgmAssets?: ReadonlySet<string>;
  readonly avatarAssets?: ReadonlySet<string>;
  readonly characters: Record<string, unknown> | null;
  readonly configPath: string;
  readonly variables?: Record<string, unknown>;
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

/**
 * 纯内存 Gallery 声明、素材引用和解锁图校验；CLI 与 Authoring 共用。
 * 未提供某类素材集合时跳过该类素材检查，避免局部 snapshot 推断出不存在的资源。
 */
export function validateGalleryConfig(input: GalleryValidationInput): LintIssue[] {
  const issues: LintIssue[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(input.text.replace(/^\uFEFF/, ''));
  } catch (err) {
    addIssue(
      issues,
      'G001',
      `gallery.json 解析失败：${err instanceof Error ? err.message : String(err)}`,
      input.galleryPath,
    );
    return issues;
  }
  if (!isRecord(raw)) {
    addIssue(issues, 'G001', 'gallery.json 根值必须是对象', input.galleryPath);
    return issues;
  }

  try { readGalleryUnlockPolicy(raw); }
  catch (error) { addIssue(issues, 'G001', String(error), input.galleryPath); }
  try {
    readGalleryReplayEntries(raw, input.variables === undefined ? undefined
      : Object.entries(input.variables).map(([name, declaration]) => ({ ...(declaration as Omit<VarDeclaration, 'name'>), name })));
  } catch (error) { addIssue(issues, 'G001', String(error), input.galleryPath); }
  const cgs = parseEntries(raw.cgs, 'cgs', input.galleryPath, issues);
  const music = parseEntries(raw.music, 'music', input.galleryPath, issues);
  const texts = raw.texts === undefined ? [] : parseEntries(raw.texts, 'texts', input.galleryPath, issues);
  const entries: Record<GallerySection, GalleryEntry[]> = { cgs, music, texts };

  const ids: Record<GallerySection, Set<string>> = { cgs: new Set(), music: new Set(), texts: new Set() };
  for (const section of Object.keys(SECTION_RULES) as GallerySection[]) {
    for (const entry of entries[section]) {
      if (ids[section].has(entry.id)) {
        addIssue(issues, 'G002', `gallery.json 的 ${section} 存在重复 id '${entry.id}'`, input.galleryPath);
      } else {
        ids[section].add(entry.id);
      }
    }
  }

  const assetSets: Partial<Record<'bg' | 'bgm', ReadonlySet<string>>> = {
    ...(input.bgAssets === undefined ? {} : { bg: input.bgAssets }),
    ...(input.bgmAssets === undefined ? {} : { bgm: input.bgmAssets }),
  };
  for (const section of ['cgs', 'music'] as const) {
    const assetFolder = SECTION_RULES[section].assetFolder!;
    const assets = assetSets[assetFolder];
    if (assets === undefined) continue;
    for (const entry of entries[section]) {
      const key = entry.src ?? entry.id;
      if (!assets.has(key)) {
        addIssue(
          issues,
          'G003',
          `Gallery ${section} 条目 '${entry.id}' 的素材键 '${key}' 不存在于 content/assets/${assetFolder}`,
          input.galleryPath,
        );
      }
    }
  }

  for (const entry of texts) {
    const scene = entry.scene!;
    if (!input.scenes.has(scene) && !input.failedSceneIds.has(scene)) {
      addIssue(issues, 'G004', `文本回想 '${entry.id}' 的目标场景 '${scene}' 不存在`, input.galleryPath);
    }
    if (entry.label !== undefined && !input.scenes.get(scene)?.labels.has(entry.label)) {
      addIssue(issues, 'G005', `文本回想 '${entry.id}' 的标签 '${entry.label}' 不存在`, input.galleryPath);
    }
  }

  const unlocked: Record<GallerySection, Set<string>> = { cgs: new Set(), music: new Set(), texts: new Set() };
  for (const scene of input.scenes.values()) {
    for (const instruction of scene.instructions) {
      if (instruction.op !== 'instr') continue;
      const section = Object.prototype.hasOwnProperty.call(UNLOCK_TO_SECTION, instruction.name)
        ? UNLOCK_TO_SECTION[instruction.name as UnlockInstruction] : undefined;
      if (section === undefined) continue;
      const id = instruction.args[0];
      if (!nonEmptyString(id) || !ids[section].has(id)) {
        addIssue(
          issues,
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
          issues,
          'G007',
          `Gallery ${section} 条目 '${entry.id}' 没有匹配的 @${SECTION_RULES[section].unlock} 解锁点`,
          input.galleryPath,
        );
      }
    }
  }

  if (input.characters !== null && input.avatarAssets !== undefined) {
    for (const [characterId, character] of Object.entries(input.characters)) {
      if (!isRecord(character) || !('avatar' in character)) continue;
      const avatar = character.avatar;
      if (!nonEmptyString(avatar) || !input.avatarAssets.has(avatar)) {
        addIssue(
          issues,
          'G008',
          `characters.${characterId}.avatar '${typeof avatar === 'string' ? avatar : String(avatar)}' 不是 content/assets/avatar 中的有效素材键`,
          input.configPath,
        );
      }
    }
  }

  return issues;
}
