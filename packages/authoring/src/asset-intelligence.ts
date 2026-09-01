import type { GenericInstr } from '@surdet/core';
import type {
  ProjectAssetFileFact,
  ProjectAssetIntelligence,
  ProjectAssetIssue,
  ProjectAssetIssueCode,
  ProjectAssetItem,
  ProjectAssetKind,
  ProjectAssetReference,
  ProjectAssetSummary,
} from './contracts.js';
import { normalizeProjectPath } from './project-storage.js';
import type { ProjectSnapshot } from './project-snapshot.js';

const ASSET_ROOT = 'content/assets/';

const KIND_ORDER: readonly ProjectAssetKind[] = [
  'background',
  'portrait',
  'avatar',
  'music',
  'ambience',
  'sound-effect',
  'voice',
  'video',
  'font',
  'other',
];

const ISSUE_ORDER: readonly ProjectAssetIssueCode[] = [
  'ASSET_REFERENCE_MISSING',
  'ASSET_KEY_DUPLICATE',
  'ASSET_NAME_INVALID',
  'ASSET_FORMAT_UNSUPPORTED',
  'ASSET_UNUSED',
];

const DIRECTORY_KINDS: Readonly<Record<string, ProjectAssetKind>> = {
  bg: 'background',
  portrait: 'portrait',
  avatar: 'avatar',
  bgm: 'music',
  music: 'music',
  ambience: 'ambience',
  se: 'sound-effect',
  voice: 'voice',
  video: 'video',
  font: 'font',
  fonts: 'font',
};

const IMAGE_FORMATS = new Set(['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);
const AUDIO_FORMATS = new Set(['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'opus']);
const VIDEO_FORMATS = new Set(['mp4', 'webm', 'ogv']);
const FONT_FORMATS = new Set(['woff2', 'woff', 'ttf', 'otf']);

interface ClassifiedFile {
  fact: ProjectAssetFileFact;
  kind: ProjectAssetKind;
  key: string;
  format: string;
  variant?: string;
  invalidName: boolean;
}

interface ReferenceTarget {
  kind: ProjectAssetKind;
  key: string;
  variant?: string;
  reference: ProjectAssetReference;
}

function extensionOf(path: string): string {
  const name = path.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

function stemOf(path: string): string {
  const name = path.split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

function classifyFile(fact: ProjectAssetFileFact): ClassifiedFile | null {
  const path = normalizeProjectPath(fact.path);
  if (!path.startsWith(ASSET_ROOT)) return null;
  const relative = path.slice(ASSET_ROOT.length);
  const segments = relative.split('/');
  const fileName = segments.at(-1) ?? '';
  const directory = segments.length > 1 ? segments[0]!.toLowerCase() : '';
  const kind = DIRECTORY_KINDS[directory] ?? 'other';
  const format = extensionOf(fileName);
  const stem = stemOf(fileName);
  if (kind !== 'portrait') {
    return { fact: { ...fact, path }, kind, key: stem, format, invalidName: stem.length === 0 };
  }
  const portrait = stem.split('_');
  if (portrait.length !== 3 || portrait.some((segment) => segment.length === 0)) {
    return { fact: { ...fact, path }, kind, key: stem, format, invalidName: true };
  }
  const [role, outfit, expression] = portrait as [string, string, string];
  return {
    fact: { ...fact, path },
    kind,
    key: `${role}:${outfit}`,
    format,
    variant: expression,
    invalidName: false,
  };
}

function isSupportedFormat(kind: ProjectAssetKind, format: string): boolean {
  if (format.length === 0) return false;
  if (kind === 'background' || kind === 'portrait' || kind === 'avatar') return IMAGE_FORMATS.has(format);
  if (kind === 'music' || kind === 'ambience' || kind === 'sound-effect' || kind === 'voice') return AUDIO_FORMATS.has(format);
  if (kind === 'video') return VIDEO_FORMATS.has(format);
  if (kind === 'font') return FONT_FORMATS.has(format);
  return IMAGE_FORMATS.has(format) || AUDIO_FORMATS.has(format) || VIDEO_FORMATS.has(format) || FONT_FORMATS.has(format);
}

function targetKey(kind: ProjectAssetKind, key: string, variant?: string): string {
  return `${kind}\0${key}\0${variant ?? ''}`;
}

/** 与 Core/Renderer 的指令参数消费语义一致；只去除完整包裹的一对引号。 */
function dequoteAssetToken(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first !== '"' && first !== "'") || first !== last) return value;
  return value.slice(1, -1).replace(/\\(.)/g, '$1');
}

function safeIdPart(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '~');
}

function referenceOrder(left: ProjectAssetReference, right: ProjectAssetReference): number {
  return left.sourcePath.localeCompare(right.sourcePath)
    || (left.line ?? 0) - (right.line ?? 0)
    || left.sourceKind.localeCompare(right.sourceKind)
    || left.referenceId.localeCompare(right.referenceId);
}

function issueOrder(left: ProjectAssetIssueCode, right: ProjectAssetIssueCode): number {
  return ISSUE_ORDER.indexOf(left) - ISSUE_ORDER.indexOf(right);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function galleryConfig(snapshot: ProjectSnapshot, supplied?: unknown): Record<string, unknown> {
  const suppliedRecord = asRecord(supplied);
  if (suppliedRecord) return suppliedRecord;
  const file = snapshot.files.find((candidate) => candidate.path === 'content/config/gallery.json');
  if (!file || file.text.trim().length === 0) return {};
  try {
    return asRecord(JSON.parse(file.text.replace(/^\uFEFF/, ''))) ?? {};
  } catch {
    return {};
  }
}

function galleryEntries(value: unknown, field: string): Record<string, unknown>[] {
  const root = asRecord(value);
  const entries = root?.[field];
  return Array.isArray(entries) ? entries.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null) : [];
}

function referenceTargets(snapshot: ProjectSnapshot, galleryInput?: unknown): ReferenceTarget[] {
  const targets: ReferenceTarget[] = [];
  const add = (
    kind: ProjectAssetKind,
    key: string | undefined,
    reference: ProjectAssetReference,
    variant?: string,
  ): void => {
    const normalized = key === undefined ? undefined : dequoteAssetToken(key).trim();
    if (!normalized) return;
    const normalizedVariant = variant === undefined ? undefined : dequoteAssetToken(variant).trim();
    targets.push({ kind, key: normalized, ...(normalizedVariant ? { variant: normalizedVariant } : {}), reference });
  };

  const gallery = galleryConfig(snapshot, galleryInput);
  const gallerySources = new Map<string, { kind: ProjectAssetKind; key: string }[]>();
  for (const [field, kind] of [['cgs', 'background'], ['music', 'music']] as const) {
    for (const [entryIndex, entry] of galleryEntries(gallery, field).entries()) {
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const source = typeof entry.src === 'string' ? entry.src.trim() : '';
      if (!id || !source) continue;
      const sourceKey = `${field}:${id}`;
      const current = gallerySources.get(sourceKey) ?? [];
      if (!current.some((candidate) => candidate.kind === kind && candidate.key === source)) current.push({ kind, key: source });
      gallerySources.set(sourceKey, current);
      add(kind, source, {
        referenceId: `gallery:${field}:${safeIdPart(id)}:${entryIndex}`,
        sourceKind: 'gallery',
        sourceLabel: `鉴赏条目 ${typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : id}`,
        sourcePath: 'content/config/gallery.json',
        objectRef: `gallery:${field}:${id}`,
      });
    }
  }

  const characters = asRecord(snapshot.config.characters) ?? {};
  for (const [id, declaration] of Object.entries(characters)) {
    const record = asRecord(declaration);
    const avatar = typeof record?.avatar === 'string' ? record.avatar : undefined;
    add('avatar', avatar, {
      referenceId: `character:${safeIdPart(id)}:avatar`,
      sourceKind: 'character',
      sourceLabel: `角色 ${typeof record?.name === 'string' && record.name.trim() ? record.name.trim() : id}`,
      sourcePath: 'game.config.json',
      objectRef: `character:${id}`,
    });
  }

  for (const scene of snapshot.scenes) {
    for (const instruction of scene.compiled.instructions) {
      const base = {
        sourceKind: 'scene' as const,
        sourceLabel: `场景 ${scene.id} · 第 ${instruction.line} 行`,
        sourcePath: scene.path,
        line: instruction.line,
        objectRef: `scene:${scene.id}`,
      };
      if (instruction.op === 'video') {
        add('video', instruction.src, { ...base, referenceId: `scene:${safeIdPart(scene.id)}:${instruction.line}:video` });
        continue;
      }
      if (instruction.op !== 'instr') continue;
      const generic = instruction as GenericInstr;
      const first = generic.args[0];
      const ref = (name: string): ProjectAssetReference => ({
        ...base,
        referenceId: `scene:${safeIdPart(scene.id)}:${generic.line}:${name}:${generic.index}`,
      });
      switch (generic.name) {
        case 'bg': add('background', first, ref('bg')); break;
        case 'show': add('portrait', first, ref('show'), generic.args[1] ?? 'normal'); break;
        case 'bgm': add('music', first, ref('bgm')); break;
        case 'ambience':
          if (first !== undefined && dequoteAssetToken(first).trim() !== 'off') add('ambience', first, ref('ambience'));
          break;
        case 'se': add('sound-effect', first, ref('se')); break;
        case 'voice': add('voice', first, ref('voice')); break;
        case 'video': add('video', first, ref('video')); break;
        case 'unlock_cg': {
          const id = first ? dequoteAssetToken(first) : undefined;
          for (const source of id ? gallerySources.get(`cgs:${id}`) ?? [] : []) add(source.kind, source.key, ref('unlock_cg'));
          break;
        }
        case 'unlock_music': {
          const id = first ? dequoteAssetToken(first) : undefined;
          for (const source of id ? gallerySources.get(`music:${id}`) ?? [] : []) add(source.kind, source.key, ref('unlock_music'));
          break;
        }
        default: break;
      }
    }
  }

  for (const timeline of snapshot.timelines) {
    let definition: Record<string, unknown> | null = null;
    try {
      definition = asRecord(JSON.parse(timeline.text.replace(/^\uFEFF/, '')));
    } catch {
      definition = null;
    }
    const tracks = Array.isArray(definition?.tracks) ? definition.tracks : [];
    const timelineId = typeof definition?.id === 'string' && definition.id.trim()
      ? definition.id.trim()
      : stemOf(timeline.path);
    tracks.forEach((trackValue, trackIndex) => {
      const track = asRecord(trackValue);
      if (!track || !Array.isArray(track.cues)) return;
      track.cues.forEach((cueValue, cueIndex) => {
        const cue = asRecord(cueValue);
        if (!cue) return;
        const base: ProjectAssetReference = {
          referenceId: `timeline:${safeIdPart(timelineId)}:${trackIndex}:${cueIndex}`,
          sourceKind: 'timeline',
          sourceLabel: `时间轴 ${timelineId} · 轨道 ${trackIndex + 1} · 片段 ${cueIndex + 1}`,
          sourcePath: timeline.path,
          objectRef: `timeline:${timelineId}/track:${trackIndex}/cue:${cueIndex}`,
        };
        if (track.kind === 'background' && cue.action === 'set') {
          add('background', typeof cue.key === 'string' ? cue.key : undefined, base);
        } else if (track.kind === 'portrait' && (cue.action === 'show' || cue.action === 'expression')) {
          add(
            'portrait',
            typeof track.target === 'string' ? track.target : undefined,
            base,
            typeof cue.expression === 'string' ? cue.expression : undefined,
          );
        }
      });
    });
  }

  return targets.sort((left, right) => (
    targetKey(left.kind, left.key, left.variant).localeCompare(targetKey(right.kind, right.key, right.variant))
    || referenceOrder(left.reference, right.reference)
  ));
}

function createIssue(
  code: ProjectAssetIssueCode,
  suffix: string,
  message: string,
  assetIds: string[],
  referenceIds: string[],
): ProjectAssetIssue {
  return {
    issueId: `issue:${code.toLowerCase()}:${safeIdPart(suffix)}`,
    code,
    severity: code === 'ASSET_REFERENCE_MISSING' ? 'error' : 'warning',
    message,
    assetIds: [...assetIds].sort((left, right) => left.localeCompare(right)),
    referenceIds: [...referenceIds].sort((left, right) => left.localeCompare(right)),
  };
}

/**
 * 构建只读素材事实。函数只消费 ProjectSnapshot 与调用方提供的路径/大小，不读取二进制、
 * 不访问本机绝对路径，也不修改项目内容。
 */
export function buildProjectAssetIntelligence(
  snapshot: ProjectSnapshot,
  files: readonly ProjectAssetFileFact[],
  options: { gallery?: unknown } = {},
): ProjectAssetIntelligence {
  const groupedFacts = new Map<string, { path: string; measuredBytes: Set<number> }>();
  for (const fact of files) {
    const path = normalizeProjectPath(fact.path);
    const group = groupedFacts.get(path) ?? { path, measuredBytes: new Set<number>() };
    if (fact.bytes !== undefined) group.measuredBytes.add(fact.bytes);
    groupedFacts.set(path, group);
  }
  const uniqueFacts: ProjectAssetFileFact[] = [...groupedFacts.values()].map((group) => ({
    path: group.path,
    ...(group.measuredBytes.size === 1 ? { bytes: [...group.measuredBytes][0]! } : {}),
  }));
  const classified = uniqueFacts
    .map(classifyFile)
    .filter((entry): entry is ClassifiedFile => entry !== null)
    .sort((left, right) => left.fact.path.localeCompare(right.fact.path));
  const items: ProjectAssetItem[] = classified.map((entry) => ({
    assetId: `file:${entry.fact.path}`,
    kind: entry.kind,
    key: entry.key,
    sourcePath: entry.fact.path,
    format: entry.format,
    ...(entry.fact.bytes === undefined ? {} : { bytes: entry.fact.bytes }),
    ...(entry.variant === undefined ? {} : { variant: entry.variant }),
    physical: true,
    references: [],
    issues: [],
  }));
  const byTarget = new Map<string, ProjectAssetItem[]>();
  for (const item of items) {
    const key = targetKey(item.kind, item.key, item.variant);
    const current = byTarget.get(key) ?? [];
    current.push(item);
    byTarget.set(key, current);
  }

  const issues: ProjectAssetIssue[] = [];
  for (const entry of classified) {
    const item = items.find((candidate) => candidate.sourcePath === entry.fact.path)!;
    if (entry.invalidName) {
      item.issues.push('ASSET_NAME_INVALID');
      issues.push(createIssue(
        'ASSET_NAME_INVALID',
        item.assetId,
        `素材名称不符合 ${item.kind} 的规范命名：${entry.fact.path}`,
        [item.assetId],
        [],
      ));
    }
    if (!isSupportedFormat(entry.kind, entry.format)) {
      item.issues.push('ASSET_FORMAT_UNSUPPORTED');
      issues.push(createIssue(
        'ASSET_FORMAT_UNSUPPORTED',
        item.assetId,
        `素材格式尚未列入 ${item.kind} 的支持合同：${entry.format || '无扩展名'}`,
        [item.assetId],
        [],
      ));
    }
  }

  for (const [key, matches] of byTarget) {
    if (matches.length < 2) continue;
    for (const item of matches) item.issues.push('ASSET_KEY_DUPLICATE');
    issues.push(createIssue(
      'ASSET_KEY_DUPLICATE',
      key,
      `同一素材引用匹配到 ${matches.length} 个物理文件，未自动选择其中任何一个。`,
      matches.map((item) => item.assetId),
      [],
    ));
  }

  const references = referenceTargets(snapshot, options.gallery);
  const missingByTarget = new Map<string, ProjectAssetItem>();
  for (const target of references) {
    const key = targetKey(target.kind, target.key, target.variant);
    const matches = byTarget.get(key) ?? [];
    if (matches.length > 0) {
      for (const item of matches) {
        if (!item.references.some((reference) => reference.referenceId === target.reference.referenceId)) {
          item.references.push(target.reference);
        }
      }
      continue;
    }
    let missing = missingByTarget.get(key);
    if (!missing) {
      const idSuffix = `${target.kind}:${target.key}${target.variant ? `:${target.variant}` : ''}`;
      missing = {
        assetId: `missing:${idSuffix}`,
        kind: target.kind,
        key: target.key,
        ...(target.variant === undefined ? {} : { variant: target.variant }),
        physical: false,
        references: [],
        issues: ['ASSET_REFERENCE_MISSING'],
      };
      missingByTarget.set(key, missing);
      items.push(missing);
    }
    if (!missing.references.some((reference) => reference.referenceId === target.reference.referenceId)) {
      missing.references.push(target.reference);
    }
  }

  for (const missing of missingByTarget.values()) {
    issues.push(createIssue(
      'ASSET_REFERENCE_MISSING',
      missing.assetId,
      `项目引用了不存在的 ${missing.kind} 素材：${missing.key}${missing.variant ? ` / ${missing.variant}` : ''}`,
      [missing.assetId],
      missing.references.map((reference) => reference.referenceId),
    ));
  }

  for (const item of items) {
    item.references.sort(referenceOrder);
    item.issues.sort(issueOrder);
    if (item.physical && item.references.length === 0) {
      item.issues.push('ASSET_UNUSED');
      issues.push(createIssue(
        'ASSET_UNUSED',
        item.assetId,
        `未在当前项目结构中发现该素材的引用：${item.sourcePath ?? item.key}`,
        [item.assetId],
        [],
      ));
    }
  }

  items.sort((left, right) => left.assetId.localeCompare(right.assetId));
  issues.sort((left, right) => left.issueId.localeCompare(right.issueId));

  const physical = items.filter((item) => item.physical);
  const measuredFileCount = physical.filter((item) => item.bytes !== undefined).length;
  const measuredBytes = physical.reduce((total, item) => total + (item.bytes ?? 0), 0);
  const byKind = Object.fromEntries(KIND_ORDER.map((kind) => {
    const kindItems = physical.filter((item) => item.kind === kind);
    const measured = kindItems.filter((item) => item.bytes !== undefined);
    return [kind, {
      files: kindItems.length,
      measuredFiles: measured.length,
      ...(measured.length > 0 ? { bytes: measured.reduce((total, item) => total + item.bytes!, 0) } : {}),
    }];
  })) as ProjectAssetSummary['byKind'];
  const summary: ProjectAssetSummary = {
    fileCount: physical.length,
    measuredFileCount,
    measuredBytes,
    ...(measuredFileCount > 0 ? { totalBytes: measuredBytes } : {}),
    referencedCount: physical.filter((item) => item.references.length > 0).length,
    unusedCount: physical.filter((item) => item.issues.includes('ASSET_UNUSED')).length,
    missingCount: items.filter((item) => !item.physical).length,
    duplicateCount: issues.filter((issue) => issue.code === 'ASSET_KEY_DUPLICATE').length,
    unsupportedCount: physical.filter((item) => item.issues.includes('ASSET_FORMAT_UNSUPPORTED')).length,
    invalidNameCount: physical.filter((item) => item.issues.includes('ASSET_NAME_INVALID')).length,
    byKind,
  };

  return { items, summary, issues };
}
