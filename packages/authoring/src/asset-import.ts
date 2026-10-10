import { AuthoringOperationError, stableStringify } from './change-session.js';
import type { ProjectAssetKind, TextHasher } from './contracts.js';

/**
 * The import planner is deliberately pure.  It knows about project-relative
 * asset names and the facts supplied by a storage adapter; it never reads or
 * writes a file and it never derives a destination from the source path.
 */

const DIRECTORY_BY_KIND: Readonly<Record<ProjectAssetKind, string>> = Object.freeze({
  background: 'bg',
  rule: 'rule',
  portrait: 'portrait',
  avatar: 'avatar',
  music: 'bgm',
  ambience: 'ambience',
  'sound-effect': 'se',
  voice: 'voice',
  video: 'video',
  font: 'fonts',
  license: 'licenses',
  other: 'other',
});

const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'ogv', 'webm']);
const FONT_EXTENSIONS = new Set(['otf', 'ttf', 'woff', 'woff2']);

const ISSUE_ORDER: readonly ProjectAssetImportIssueCode[] = [
  'IMPORT_NAME_INVALID',
  'IMPORT_FORMAT_UNSUPPORTED',
  'IMPORT_PORTRAIT_NAME_INVALID',
  'IMPORT_TARGET_DUPLICATE_IN_BATCH',
  'IMPORT_TARGET_EXISTS',
  'IMPORT_ASSET_KEY_CONFLICT',
  'IMPORT_TARGET_UNSAFE',
];

const WINDOWS_RESERVED_STEMS = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'CLOCK$',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
  'COM¹',
  'COM²',
  'COM³',
  'LPT¹',
  'LPT²',
  'LPT³',
]);

const ASSET_ROOT = 'content/assets/';

export interface ProjectAssetImportStagedItem {
  operationId: string;
  itemId: string;
  sourceName: string;
  bytes: number;
  sha256: string;
  stagedItemFingerprint: string;
}

export interface ProjectAssetImportTargetRequest {
  itemId: string;
  kind: ProjectAssetKind;
  fileName: string;
}

export interface ProjectAssetImportTargetFact {
  path: string;
  state: 'absent' | 'exists-file' | 'exists-directory' | 'unsafe';
  /** Existing or requested files that resolve to the same runtime catalog key. */
  conflictingAssetPaths?: string[];
}

export interface BuildProjectAssetImportPlanInput {
  projectIdentity: string;
  manifestFingerprint: string;
  stagedItems: ProjectAssetImportStagedItem[];
  targets: ProjectAssetImportTargetRequest[];
  targetFacts: ProjectAssetImportTargetFact[];
}

export type ProjectAssetImportIssueCode =
  | 'IMPORT_NAME_INVALID'
  | 'IMPORT_FORMAT_UNSUPPORTED'
  | 'IMPORT_PORTRAIT_NAME_INVALID'
  | 'IMPORT_TARGET_DUPLICATE_IN_BATCH'
  | 'IMPORT_TARGET_EXISTS'
  | 'IMPORT_ASSET_KEY_CONFLICT'
  | 'IMPORT_TARGET_UNSAFE';

export interface ProjectAssetImportPlanItem {
  itemId: string;
  sourceName: string;
  bytes: number;
  sha256: string;
  kind: ProjectAssetKind;
  fileName: string;
  targetPath: string;
  issues: ProjectAssetImportIssueCode[];
}

export interface ProjectAssetImportPlan {
  schemaVersion: 1;
  planId: string;
  planFingerprint: string;
  projectIdentity: string;
  manifestFingerprint: string;
  status: 'blocked' | 'ready';
  items: ProjectAssetImportPlanItem[];
  issues: ProjectAssetImportIssueCode[];
  totalBytes: number;
}

function invalidRequest(message: string): AuthoringOperationError {
  return new AuthoringOperationError('INVALID_REQUEST', message);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidRequest(`${label} 必须是非空字符串`);
  }
  return value;
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftCodePoint = leftPoints[index]!.codePointAt(0)!;
    const rightCodePoint = rightPoints[index]!.codePointAt(0)!;
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
  }
  return leftPoints.length - rightPoints.length;
}

/** Conservative cross-platform fold used only for collision comparison. */
function portableFold(value: string): string {
  return value.normalize('NFC').toUpperCase().toLowerCase();
}

function comparePortable(left: string, right: string): number {
  return compareCodePoints(portableFold(left), portableFold(right)) || compareCodePoints(left, right);
}

function pushIssue(issues: ProjectAssetImportIssueCode[], issue: ProjectAssetImportIssueCode): void {
  if (!issues.includes(issue)) issues.push(issue);
}

function sortIssues(issues: readonly ProjectAssetImportIssueCode[]): ProjectAssetImportIssueCode[] {
  return [...new Set(issues)].sort((left, right) => ISSUE_ORDER.indexOf(left) - ISSUE_ORDER.indexOf(right));
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true;
  }
  return false;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? '' : fileName.slice(0, dot);
}

function isWindowsReservedStem(stem: string): boolean {
  const uppercase = stem.normalize('NFC').toUpperCase();
  // Windows treats a device name followed by any extension as reserved.  A
  // second dot is conservatively checked too, so `CON.foo.png` is blocked.
  return WINDOWS_RESERVED_STEMS.has(uppercase) || WINDOWS_RESERVED_STEMS.has(uppercase.split('.')[0]!);
}

export function isProjectAssetFileNameSafe(fileName: string): boolean {
  const codePointLength = Array.from(fileName).length;
  if (codePointLength < 1 || codePointLength > 120) return false;
  if (fileName.trim() !== fileName) return false;
  if (fileName === '.' || fileName === '..' || fileName.endsWith('.') || fileName.endsWith(' ')) return false;
  if (hasControlCharacter(fileName)) return false;
  if (/[\\/:*?"<>|]/u.test(fileName)) return false;
  if (isWindowsReservedStem(stemOf(fileName))) return false;
  return stemOf(fileName).length > 0 || !fileName.includes('.') && isProjectLicenseFileName(fileName);
}

function nameIsInvalid(fileName: string): boolean {
  return !isProjectAssetFileNameSafe(fileName);
}

export function isProjectLicenseFileName(fileName: string): boolean {
  return /\.(txt|md)$/i.test(fileName) || /^(LICENSE|LICENCE|COPYING|NOTICE|OFL)(?:[-_][^.]+)?$/i.test(fileName);
}

function supportedExtension(kind: ProjectAssetKind, extension: string, fileName: string): boolean {
  if (kind === 'license') return isProjectLicenseFileName(fileName);
  if (kind === 'background' || kind === 'portrait' || kind === 'avatar' || kind === 'rule') return IMAGE_EXTENSIONS.has(extension);
  if (kind === 'music' || kind === 'ambience' || kind === 'sound-effect' || kind === 'voice') {
    return AUDIO_EXTENSIONS.has(extension);
  }
  if (kind === 'video') return VIDEO_EXTENSIONS.has(extension);
  if (kind === 'font') return FONT_EXTENSIONS.has(extension);
  if (kind === 'other') {
    return IMAGE_EXTENSIONS.has(extension)
      || AUDIO_EXTENSIONS.has(extension)
      || VIDEO_EXTENSIONS.has(extension)
      || FONT_EXTENSIONS.has(extension);
  }
  return false;
}

function portraitNameIsInvalid(fileName: string): boolean {
  const parts = stemOf(fileName).split('_');
  return parts.length !== 3 || parts.some((part) => part.length === 0);
}

function targetPathFor(kind: ProjectAssetKind, fileName: string): string {
  // Do not construct a path from a value containing path syntax.  A blocked
  // plan item can still show its requested filename, but must not expose a
  // path that a later caller could accidentally publish.
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('\u0000')
    || fileName === '.' || fileName === '..') return '';
  return `${ASSET_ROOT}${destinationDirectoryForAssetKind(kind)}/${fileName}`;
}

function kindDirectory(kind: ProjectAssetKind): string {
  if (!Object.prototype.hasOwnProperty.call(DIRECTORY_BY_KIND, kind)) {
    throw invalidRequest(`未知素材类别：${String(kind)}`);
  }
  return DIRECTORY_BY_KIND[kind]!;
}

export function destinationDirectoryForAssetKind(kind: ProjectAssetKind): string {
  return kindDirectory(kind);
}

function normalizeStagedItem(item: ProjectAssetImportStagedItem): ProjectAssetImportStagedItem {
  return {
    operationId: requireText(item.operationId, 'staged item operationId'),
    itemId: requireText(item.itemId, 'staged item itemId'),
    sourceName: requireText(item.sourceName, 'staged item sourceName').normalize('NFC'),
    bytes: item.bytes,
    sha256: requireText(item.sha256, 'staged item sha256'),
    stagedItemFingerprint: requireText(item.stagedItemFingerprint, 'staged item fingerprint'),
  };
}

function normalizeTarget(target: ProjectAssetImportTargetRequest): ProjectAssetImportTargetRequest {
  const kind = target.kind;
  kindDirectory(kind);
  return {
    itemId: requireText(target.itemId, 'target itemId'),
    kind,
    fileName: requireText(target.fileName, 'target fileName').normalize('NFC'),
  };
}

function normalizeFact(fact: ProjectAssetImportTargetFact): ProjectAssetImportTargetFact {
  const path = requireText(fact.path, 'target fact path').normalize('NFC');
  const state = fact.state;
  if (state !== 'absent' && state !== 'exists-file' && state !== 'exists-directory' && state !== 'unsafe') {
    throw invalidRequest(`target fact 状态无效：${String(state)}`);
  }
  return { path, state, ...(fact.conflictingAssetPaths === undefined ? {} : {
    conflictingAssetPaths: [...new Set(fact.conflictingAssetPaths.map(value => requireText(value, 'conflicting asset path').normalize('NFC')))].sort(compareCodePoints),
  }) };
}

function compareStaged(left: ProjectAssetImportStagedItem, right: ProjectAssetImportStagedItem): number {
  return compareCodePoints(left.operationId, right.operationId)
    || compareCodePoints(left.itemId, right.itemId)
    || compareCodePoints(left.stagedItemFingerprint, right.stagedItemFingerprint)
    || compareCodePoints(left.sourceName, right.sourceName);
}

function compareTargets(left: ProjectAssetImportTargetRequest, right: ProjectAssetImportTargetRequest): number {
  return compareCodePoints(left.itemId, right.itemId)
    || compareCodePoints(left.kind, right.kind)
    || compareCodePoints(left.fileName, right.fileName);
}

function compareFacts(left: ProjectAssetImportTargetFact, right: ProjectAssetImportTargetFact): number {
  return comparePortable(left.path, right.path) || compareCodePoints(left.state, right.state);
}

function comparePlanItems(left: ProjectAssetImportPlanItem, right: ProjectAssetImportPlanItem): number {
  return comparePortable(left.targetPath, right.targetPath)
    || compareCodePoints(left.itemId, right.itemId)
    || compareCodePoints(left.kind, right.kind)
    || compareCodePoints(left.fileName, right.fileName);
}

/**
 * Build a deterministic, fail-closed import plan from measured staged facts
 * and an explicit target absence snapshot.
 */
export async function buildProjectAssetImportPlan(
  input: BuildProjectAssetImportPlanInput,
  hasher: TextHasher,
): Promise<ProjectAssetImportPlan> {
  const projectIdentity = requireText(input.projectIdentity, 'projectIdentity').normalize('NFC');
  const manifestFingerprint = requireText(input.manifestFingerprint, 'manifestFingerprint');
  if (!hasher || typeof hasher.sha256 !== 'function') throw invalidRequest('缺少素材计划哈希器');

  const stagedItems = input.stagedItems.map(normalizeStagedItem);
  const targets = input.targets.map(normalizeTarget);
  const targetFacts = input.targetFacts.map(normalizeFact);

  const stagedByItemId = new Map<string, ProjectAssetImportStagedItem>();
  for (const item of stagedItems) {
    if (stagedByItemId.has(item.itemId)) throw invalidRequest(`staged itemId 重复：${item.itemId}`);
    stagedByItemId.set(item.itemId, item);
  }
  const operationIds = new Set(stagedItems.map((item) => item.operationId));
  if (operationIds.size > 1) throw invalidRequest('一次素材导入不能包含多个 operationId');

  const targetPathByIndex = targets.map((target) => targetPathFor(target.kind, target.fileName));
  const targetPathCounts = new Map<string, number>();
  const targetItemIdCounts = new Map<string, number>();
  for (const [index, targetPath] of targetPathByIndex.entries()) {
    if (targetPath.length > 0) {
      const key = portableFold(targetPath);
      targetPathCounts.set(key, (targetPathCounts.get(key) ?? 0) + 1);
    }
    const itemId = targets[index]!.itemId;
    targetItemIdCounts.set(itemId, (targetItemIdCounts.get(itemId) ?? 0) + 1);
  }
  if (targets.length !== stagedItems.length
    || stagedItems.some((item) => (targetItemIdCounts.get(item.itemId) ?? 0) !== 1)) {
    throw invalidRequest('每个 staged item 必须且只能指定一个导入目标');
  }

  const normalizedFactGroups = new Map<string, ProjectAssetImportTargetFact[]>();
  for (const fact of targetFacts) {
    const key = portableFold(fact.path);
    const group = normalizedFactGroups.get(key) ?? [];
    group.push(fact);
    normalizedFactGroups.set(key, group);
  }

  const items: ProjectAssetImportPlanItem[] = targets.map((target, index) => {
    const staged = stagedByItemId.get(target.itemId);
    if (staged === undefined) throw invalidRequest(`target 没有对应 staged item：${target.itemId}`);
    const fileName = target.fileName.normalize('NFC');
    const targetPath = targetPathByIndex[index]!;
    const issues: ProjectAssetImportIssueCode[] = [];
    if (nameIsInvalid(fileName)) pushIssue(issues, 'IMPORT_NAME_INVALID');
    if (!supportedExtension(target.kind, extensionOf(fileName), fileName)) pushIssue(issues, 'IMPORT_FORMAT_UNSUPPORTED');
    if (target.kind === 'portrait' && portraitNameIsInvalid(fileName)) {
      pushIssue(issues, 'IMPORT_PORTRAIT_NAME_INVALID');
    }
    if (targetPath.length > 0 && (targetPathCounts.get(portableFold(targetPath)) ?? 0) > 1) {
      pushIssue(issues, 'IMPORT_TARGET_DUPLICATE_IN_BATCH');
    }
    if ((targetItemIdCounts.get(target.itemId) ?? 0) > 1) {
      pushIssue(issues, 'IMPORT_TARGET_DUPLICATE_IN_BATCH');
    }

    // A missing fact is not treated as absence.  The storage adapter must
    // explicitly prove absence for every requested target before publication.
    if (targetPath.length > 0) {
      const facts = normalizedFactGroups.get(portableFold(targetPath)) ?? [];
      if (facts.length === 0) {
        pushIssue(issues, 'IMPORT_TARGET_UNSAFE');
      } else {
        if (facts.length > 1) pushIssue(issues, 'IMPORT_TARGET_UNSAFE');
        if (facts.some((fact) => fact.state === 'exists-file' || fact.state === 'exists-directory')) {
          pushIssue(issues, 'IMPORT_TARGET_EXISTS');
        }
        if (facts.some(fact => (fact.conflictingAssetPaths?.length ?? 0) > 0)) {
          pushIssue(issues, 'IMPORT_ASSET_KEY_CONFLICT');
        }
        if (facts.some((fact) => fact.state !== 'absent')) {
          // An existing target is already reported separately; `unsafe` is
          // reserved for an unsafe or ambiguous observation.
          if (facts.some((fact) => fact.state === 'unsafe') || facts.length > 1) {
            pushIssue(issues, 'IMPORT_TARGET_UNSAFE');
          }
        }
      }
    }

    return {
      itemId: staged.itemId,
      sourceName: staged.sourceName.normalize('NFC'),
      bytes: staged.bytes,
      sha256: staged.sha256,
      kind: target.kind,
      fileName,
      targetPath,
      issues: sortIssues(issues),
    };
  }).sort(comparePlanItems);

  const issues = sortIssues(items.flatMap((item) => item.issues));
  const totalBytes = items.reduce((total, item) => total + item.bytes, 0);
  const status: ProjectAssetImportPlan['status'] = issues.length === 0 ? 'ready' : 'blocked';
  const sortedStagedItems = [...stagedItems].sort(compareStaged);
  const sortedTargets = [...targets].sort(compareTargets);
  const sortedFacts = [...targetFacts].sort(compareFacts);
  const semantic = {
    schemaVersion: 1 as const,
    projectIdentity,
    manifestFingerprint,
    stagedItems: sortedStagedItems,
    targets: sortedTargets,
    targetFacts: sortedFacts,
    status,
    items,
    issues,
    totalBytes,
  };
  const planFingerprint = await hasher.sha256(stableStringify(semantic));
  return {
    schemaVersion: 1,
    planId: `pln_${planFingerprint.slice(0, 32)}`,
    planFingerprint,
    projectIdentity,
    manifestFingerprint,
    status,
    items,
    issues,
    totalBytes,
  };
}
