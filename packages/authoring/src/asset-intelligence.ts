import { readProjectStage, readTextCatalog } from '@surdet/core';
import { parsePortraitFileName, portraitSourcePaths, projectPortraitOverrides, resolveProjectPortraits, resolveProjectFontPaths, resolveProjectTheme, type GenericInstr } from '@surdet/core';
import type {
  ProjectAssetFileFact,
  ProjectAssetIntelligence,
  ProjectAssetIssue,
  ProjectAssetIssueCode,
  ProjectAssetItem,
  ProjectAssetKind,
  ProjectAssetPathDescriptor,
  ProjectAssetReference,
  ProjectAssetSummary,
} from './contracts.js';
import { isProjectAssetFileNameSafe, isProjectLicenseFileName } from './asset-import.js';
import { normalizeProjectPath } from './project-storage.js';
import type { ProjectSnapshot } from './project-snapshot.js';

const ASSET_ROOT = 'content/assets/';

const KIND_ORDER: readonly ProjectAssetKind[] = [
  'background',
  'rule',
  'portrait',
  'avatar',
  'music',
  'ambience',
  'sound-effect',
  'voice',
  'video',
  'font',
  'license',
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
  rule: 'rule',
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
  licenses: 'license',
};

const IMAGE_FORMATS = new Set(['svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);
const AUDIO_FORMATS = new Set(['mp3', 'ogg', 'wav', 'm4a', 'flac']);
const VIDEO_FORMATS = new Set(['mp4', 'webm', 'ogv']);
const FONT_FORMATS = new Set(['woff2', 'woff', 'ttf', 'otf']);

/** Media instruction channels used by the existing Player and preview. */
export function mediaAssetCommand(kind: ProjectAssetKind): 'bgm' | 'ambience' | 'se' | 'voice' | 'video' | undefined {
  switch (kind) {
    case 'music': return 'bgm';
    case 'ambience': return 'ambience';
    case 'sound-effect': return 'se';
    case 'voice': return 'voice';
    case 'video': return 'video';
    default: return undefined;
  }
}

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
  allVariants?: boolean;
  roleGroup?: boolean;
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

// Existing companion documents are catalogued, not imported or relocated.
// Keep the text-only import and relocation contracts separate from PDF display.
function isCompanionLicensePdf(fileName: string): boolean {
  return /(?:^|[-_ ])(?:LICENSE|LICENCE|COPYING|NOTICE|OFL)(?:[-_ ][^.]+)?\.pdf$/i.test(fileName);
}

export function describeProjectAssetPath(input: string): ProjectAssetPathDescriptor | null {
  // POSIX may enumerate a literal backslash in a file/directory name. Keep
  // that physical spelling for the invalid-name diagnostic, never alias it.
  const invalidPath = input.startsWith(ASSET_ROOT) && input.includes('\\');
  const normalizedPath = invalidPath ? input : normalizeProjectPath(input);
  if (!normalizedPath.startsWith(ASSET_ROOT)) return null;
  const relative = normalizedPath.slice(ASSET_ROOT.length);
  const segments = relative.split('/');
  const fileName = segments.at(-1) ?? '';
  const directory = segments.length > 1 ? segments[0]!.toLowerCase() : '';
  const directoryKind = DIRECTORY_KINDS[directory] ?? 'other';
  const kind = directoryKind === 'font' && (isProjectLicenseFileName(fileName) || isCompanionLicensePdf(fileName)) ? 'license' : directoryKind;
  const format = extensionOf(fileName);
  const stem = stemOf(fileName);
  if (kind !== 'portrait') {
    return {
      path: normalizedPath,
      directory: normalizedPath.slice(0, Math.max(0, normalizedPath.lastIndexOf('/'))),
      fileName,
      kind,
      key: kind === 'font' || kind === 'license' ? normalizedPath : stem,
      format,
      invalidName: invalidPath || !isProjectAssetFileNameSafe(fileName),
    };
  }
  const portrait = parsePortraitFileName(fileName);
  if (invalidPath || !isProjectAssetFileNameSafe(fileName)
    || portrait === null) {
    return {
      path: normalizedPath,
      directory: normalizedPath.slice(0, Math.max(0, normalizedPath.lastIndexOf('/'))),
      fileName,
      kind,
      key: stem,
      format,
      invalidName: true,
    };
  }
  const { role, outfit, expression } = portrait;
  return {
    path: normalizedPath,
    directory: normalizedPath.slice(0, Math.max(0, normalizedPath.lastIndexOf('/'))),
    fileName,
    kind,
    key: `${role}:${outfit}`,
    format,
    variant: expression,
    invalidName: false,
  };
}

function classifyFile(fact: ProjectAssetFileFact): ClassifiedFile | null {
  const descriptor = describeProjectAssetPath(fact.path);
  return descriptor === null
    ? null
    : {
      fact: { ...fact, path: descriptor.path },
      kind: descriptor.kind,
      key: descriptor.key,
      format: descriptor.format,
      ...(descriptor.variant === undefined ? {} : { variant: descriptor.variant }),
      invalidName: descriptor.invalidName,
    };
}

export function isProjectAssetFormatSupported(kind: ProjectAssetKind, format: string): boolean {
  if (kind === 'license') return format === '' || format === 'txt' || format === 'md';
  if (format.length === 0) return false;
  if (kind === 'background' || kind === 'portrait' || kind === 'avatar' || kind === 'rule') return IMAGE_FORMATS.has(format);
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
    allVariants = false,
    roleGroup = false,
  ): void => {
    const normalized = key === undefined ? undefined : dequoteAssetToken(key).trim();
    if (!normalized) return;
    const normalizedVariant = variant === undefined ? undefined : dequoteAssetToken(variant).trim();
    targets.push({
      kind,
      key: normalized,
      ...(normalizedVariant ? { variant: normalizedVariant } : {}),
      ...(allVariants ? { allVariants: true } : {}),
      ...(roleGroup ? { roleGroup: true } : {}),
      reference,
    });
  };

  const gallery = galleryConfig(snapshot, galleryInput);
  try {
    for (const entry of readTextCatalog(snapshot.config)?.entries ?? []) for (const [locale, voice] of Object.entries(entry.voices ?? {})) {
      add('voice', voice.asset, { referenceId: `text-key:${entry.key}:voice:${locale}`, sourceKind: 'config',
        sourceLabel: `对白 ${entry.key} · ${locale} 配音`, sourcePath: 'game.config.json', objectRef: `text-key:${entry.key}` });
    }
  } catch { /* Shared text-catalog validation reports malformed data. */ }
  const gallerySources = new Map<string, { kind: ProjectAssetKind; key: string }[]>();
  for (const [field, kind] of [['cgs', 'background'], ['music', 'music']] as const) {
    for (const [entryIndex, entry] of galleryEntries(gallery, field).entries()) {
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const explicitSource = typeof entry.src === 'string' ? entry.src.trim() : '';
      if (!id) continue;
      const source = explicitSource || id;
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

  let stage: ReturnType<typeof readProjectStage> = null;
  try { stage = readProjectStage(snapshot.config); } catch { /* project validation owns the structural issue */ }
  for (const [id, composition] of Object.entries(stage?.compositions ?? {})) {
    if (composition.background != null) add('background', composition.background, { referenceId: `stage:${id}:background`, sourceKind: 'config', sourceLabel: `舞台构图 ${id} · 背景`, sourcePath: 'game.config.json' });
    for (const layer of composition.layers ?? []) add('background', layer.key, { referenceId: `stage:${id}:layer:${layer.id}`, sourceKind: 'config', sourceLabel: `舞台构图 ${id} · ${layer.band} ${layer.id}`, sourcePath: 'game.config.json' });
  }
  for (const [target, profile] of Object.entries(stage?.portraits ?? {})) {
    for (const expression of new Set([...Object.keys(profile.expressions), ...Object.keys(profile.sources)])) add('portrait', target,
      { referenceId: `stage:portrait:${target}:${expression}`, sourceKind: 'config', sourceLabel: `舞台校准 ${target} · ${expression}`, sourcePath: 'game.config.json' }, expression);
  }
  const player = asRecord(snapshot.config.player);
  for (const portrait of projectPortraitOverrides(snapshot.config)) {
    add('portrait', `${portrait.role}:${portrait.outfit}`, {
      referenceId: `character:${safeIdPart(portrait.role)}:portrait:${safeIdPart(portrait.outfit)}:${safeIdPart(portrait.expression)}`,
      sourceKind: 'character', sourceLabel: `角色 ${portrait.role} · ${portrait.outfit} / ${portrait.expression}`,
      sourcePath: 'game.config.json', objectRef: `character:${portrait.role}`,
    }, portrait.expression);
  }
  for (const [role, fontPath] of Object.entries(resolveProjectFontPaths(snapshot.config))) {
    add('font', fontPath, { referenceId: `config:fonts:${role}`, sourceKind: 'config', sourceLabel: `字体 ${role}`, sourcePath: 'game.config.json' });
  }
  add('background', typeof player?.titleBackground === 'string' ? player.titleBackground : undefined, {
    referenceId: 'config:player:titleBackground',
    sourceKind: 'config',
    sourceLabel: '标题背景',
    sourcePath: 'game.config.json',
  });
  add('background', typeof player?.titleLogo === 'string' ? player.titleLogo : undefined, {
    referenceId: 'config:player:titleLogo',
    sourceKind: 'config',
    sourceLabel: '标题字标',
    sourcePath: 'game.config.json',
  });
  let themeSection: ReturnType<typeof resolveProjectTheme> | null = null;
  try { themeSection = resolveProjectTheme(snapshot.config); } catch { /* project validation owns the structural issue */ }
  if (themeSection) {
    add('background', themeSection.skins.dialogSkin ?? undefined, {
      referenceId: 'config:theme:dialogSkin',
      sourceKind: 'config',
      sourceLabel: '对话框皮肤',
      sourcePath: 'game.config.json',
    });
    add('background', themeSection.skins.buttonSkin ?? undefined, {
      referenceId: 'config:theme:buttonSkin',
      sourceKind: 'config',
      sourceLabel: '按钮皮肤',
      sourcePath: 'game.config.json',
    });
  }
  const uiPages = asRecord(asRecord(snapshot.config.ui)?.pages) ?? {};
  const inspectUiNode = (page: string, node: unknown): void => {
    const item = asRecord(node);
    if (!item) return;
    if (typeof item.asset === 'string') add('background', item.asset, {
      referenceId: `ui:${String(item.id ?? page)}:asset`, sourceKind: 'config',
      sourceLabel: `界面 ${page} · ${String(item.id ?? '图片')}`, sourcePath: 'game.config.json',
      objectRef: typeof item.id === 'string' ? `ui:${item.id}` : 'config:ui',
    });
    if (Array.isArray(item.children)) item.children.forEach(child => inspectUiNode(page, child));
  };
  for (const [page, root] of Object.entries(uiPages)) inspectUiNode(page, root);
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
        case 'transition': if (dequoteAssetToken(first ?? '') === 'rule') add('rule', generic.modifiers.get('rule'), ref('transition.rule')); break;
        case 'layer': if (!generic.modifiers.has('off')) add('background', generic.args[1], ref('layer')); break;
        case 'show': {
          const decoded = first === undefined ? undefined : dequoteAssetToken(first).trim();
          add('portrait', decoded && !decoded.includes(':') ? `${decoded}:normal` : decoded, ref('show'), generic.args[1] ?? 'normal');
          break;
        }
        case 'hide':
        case 'mov': {
          const decoded = first === undefined ? undefined : dequoteAssetToken(first).trim();
          if (decoded) add('portrait', decoded, ref(generic.name), undefined, true, !decoded.includes(':'));
          break;
        }
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
        if (track.kind === 'background' && cue.action === 'set' || track.kind === 'layer' && cue.action === 'show') {
          add('background', typeof cue.key === 'string' ? cue.key : undefined, base);
        } else if (track.kind === 'audio' && (cue.action === 'bgm' || cue.action === 'se' || cue.action === 'voice')) {
          add(cue.action === 'bgm' ? 'music' : cue.action === 'se' ? 'sound-effect' : 'voice', typeof cue.key === 'string' ? cue.key : undefined, base);
        } else if (track.kind === 'portrait') {
          const rawTarget = definition?.version === 2 && typeof cue.source === 'string' ? cue.source : typeof track.target === 'string' ? track.target : undefined;
          if (cue.action === 'show' || cue.action === 'expression') {
            const normalizedTarget = rawTarget && !rawTarget.includes(':') ? `${rawTarget}:normal` : rawTarget;
            add(
              'portrait',
              normalizedTarget,
              base,
              typeof cue.expression === 'string' ? cue.expression : 'normal',
            );
          } else if ((cue.action === 'move' || cue.action === 'hide') && rawTarget) {
            add('portrait', rawTarget, base, undefined, true, !rawTarget.includes(':'));
          }
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
    const descriptor = describeProjectAssetPath(fact.path);
    if (descriptor === null) continue;
    const path = descriptor.path;
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
    if (item.kind === 'portrait') continue;
    const key = targetKey(item.kind, item.key, item.variant);
    const current = byTarget.get(key) ?? [];
    current.push(item);
    byTarget.set(key, current);
  }
  const portraits = resolveProjectPortraits(snapshot.config, uniqueFacts.map(fact => fact.path));
  const visualTargets = new Set<string>();
  const missingVisualParts: ProjectAssetItem[] = [];
  for (const portrait of portraits) {
    if (!portrait.configured && describeProjectAssetPath(portrait.sourcePath)?.invalidName) continue;
    const key = targetKey('portrait', `${portrait.role}:${portrait.outfit}`, portrait.expression);
    if (portrait.visual) visualTargets.add(key);
    const matches = byTarget.get(key) ?? [];
    for (const sourcePath of portraitSourcePaths(portrait)) {
      let item = items.find(item => item.sourcePath === sourcePath);
      if (!item && portrait.visual) {
        item = { assetId: `missing:portrait-source:${sourcePath}`, kind: 'portrait', key: sourcePath, sourcePath,
          physical: false, references: [], issues: ['ASSET_REFERENCE_MISSING'] };
        items.push(item); missingVisualParts.push(item);
      }
      if (item && !matches.includes(item)) matches.push(item);
    }
    byTarget.set(key, matches);
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
    const fileName = entry.fact.path.split('/').at(-1)!;
    const companionPdf = entry.kind === 'license' && isCompanionLicensePdf(fileName);
    if (!companionPdf && (!isProjectAssetFormatSupported(entry.kind, entry.format)
      || entry.kind === 'license' && !isProjectLicenseFileName(fileName))) {
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
    if (matches.length < 2 || visualTargets.has(key)) continue;
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
    const matches = target.kind === 'portrait' && (target.roleGroup || target.allVariants)
      ? [...new Set(portraits.filter(p => target.roleGroup ? p.role === target.key : `${p.role}:${p.outfit}` === target.key)
        .flatMap(p => byTarget.get(targetKey('portrait', `${p.role}:${p.outfit}`, p.expression)) ?? []))]
      : target.roleGroup
      ? items.filter((item) => item.physical && item.kind === 'portrait' && item.key.split(':')[0] === target.key)
      : target.allVariants
      ? items.filter((item) => item.physical && item.kind === target.kind && item.key === target.key)
      : byTarget.get(key) ?? [];
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

  for (const missing of [...missingByTarget.values(), ...missingVisualParts]) {
    issues.push(createIssue(
      'ASSET_REFERENCE_MISSING',
      missing.assetId,
      `项目引用了不存在的 ${missing.kind} 素材：${missing.key}${missing.variant ? ` / ${missing.variant}` : ''}`,
      [missing.assetId],
      missing.references.map((reference) => reference.referenceId),
    ));
  }

  for (const item of items) {
    const sourceFact = item.physical ? files.find(file => file.path === item.sourcePath) : undefined;
    if (sourceFact?.sha256 !== undefined) item.sha256 = sourceFact.sha256;
    item.references.sort(referenceOrder);
    item.issues.sort(issueOrder);
    const command = mediaAssetCommand(item.kind);
    if (item.kind === 'rule' && item.physical && item.issues.length === 0) {
      item.usage = { scene: { kind: 'instruction', name: 'transition', args: ['rule', '800'], modifiers: { rule: `"${item.key}"`, soft: '.15', reverse: 'false' } } };
    }
    if (command && item.physical && item.issues.length === 0 && !(command === 'ambience' && item.key === 'off')) {
      item.usage = {
        scene: { kind: 'instruction', name: command, args: [`"${item.key}"`] },
        ...(command === 'bgm' || command === 'se' || command === 'voice'
          ? { timeline: { kind: 'audio' as const, cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: command, key: item.key }] } } : {}),
      };
    }
    if (item.physical && item.kind !== 'license' && item.references.length === 0) {
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
