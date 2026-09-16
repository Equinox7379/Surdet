import { splitOutsideQuotes } from '@surdet/core';
import type {
  ProjectAssetFileFact,
  ProjectAssetKind,
  ProjectAssetPathDescriptor,
  ProjectAssetRelocationBinaryBaseline,
  ProjectAssetRelocationBatchPlan,
  ProjectAssetRelocationBlocker,
  ProjectAssetRelocationBlockerCode,
  ProjectAssetRelocationPlan,
  ProjectAssetRelocationReferenceChange,
  ProjectAssetRelocationScannedFile,
  ProjectAssetRelocationTextChange,
  ProjectFile,
  TextHasher,
} from './contracts.js';
import { describeProjectAssetPath } from './asset-intelligence.js';
import { isProjectAssetFileNameSafe } from './asset-import.js';
import { normalizeProjectPath } from './project-storage.js';
import type { ProjectSnapshot } from './project-snapshot.js';
import {
  decodeInstructionArgument,
  instructionModifierTokens,
  parseSceneDocument,
  rewriteInstructionArgumentsRaw,
  serializeSceneDocument,
  splitInstruction,
} from './scene-document.js';

const SUPPORTED_KINDS = new Set<ProjectAssetKind>(['background', 'portrait', 'avatar']);
const KNOWN_ASSET_INSTRUCTIONS = new Set([
  'bg', 'show', 'hide', 'mov', 'bgm', 'ambience', 'se', 'voice', 'video', 'unlock_cg', 'unlock_music',
]);
const CODE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json']);
const OPAQUE_ROOTS = ['src', 'scripts', 'test', 'tests'] as const;

export type ProjectAssetRelocationOpaqueRoot = typeof OPAQUE_ROOTS[number];

export interface ProjectAssetRelocationOpaqueRootScan {
  root: ProjectAssetRelocationOpaqueRoot;
  state: 'missing' | 'scanned';
  filePaths: readonly string[];
}

export interface ProjectAssetRelocationPlanInput {
  operationId: string;
  snapshot: ProjectSnapshot;
  assetFiles: readonly ProjectAssetFileFact[];
  assetDirectories: readonly string[];
  sourcePath: string;
  targetPath: string;
  galleryFile: ProjectFile | null;
  opaqueFiles: readonly ProjectFile[];
  scanCoverage: {
    gallery: 'absent' | 'included';
    opaqueRoots: readonly ProjectAssetRelocationOpaqueRootScan[];
    opaqueInventoryFingerprint: string;
  };
  binaryBaseline: ProjectAssetRelocationBinaryBaseline;
}

export interface PreparedProjectAssetRelocation {
  plan: ProjectAssetRelocationPlan;
  textChanges: ProjectAssetRelocationTextChange[];
  scannedFiles: ProjectAssetRelocationScannedFile[];
  binaryBaseline: ProjectAssetRelocationBinaryBaseline;
}

export interface ProjectAssetRelocationBatchMoveInput {
  sourcePath: string;
  targetPath: string;
  binaryBaseline: ProjectAssetRelocationBinaryBaseline;
}

export interface ProjectAssetRelocationBatchPlanInput {
  operationId: string;
  snapshot: ProjectSnapshot;
  assetFiles: readonly ProjectAssetFileFact[];
  assetDirectories: readonly string[];
  moves?: readonly ProjectAssetRelocationBatchMoveInput[];
  /** Authoring 内部旧测试/适配器名称；公开 HTTP 合同统一使用 moves。 */
  items?: readonly (ProjectAssetRelocationBatchMoveInput & { itemId?: string })[];
  galleryFile: ProjectFile | null;
  opaqueFiles: readonly ProjectFile[];
  scanCoverage: ProjectAssetRelocationPlanInput['scanCoverage'];
}

export interface PreparedProjectAssetRelocationBatch {
  plan: ProjectAssetRelocationBatchPlan;
  textChanges: ProjectAssetRelocationTextChange[];
  scannedFiles: ProjectAssetRelocationScannedFile[];
  binaryBaselines: ProjectAssetRelocationBinaryBaseline[];
}

type JsonPath = Array<string | number>;

interface JsonStringLocation {
  kind: 'key' | 'value';
  path: JsonPath;
  start: number;
  end: number;
  value: string;
}

interface JsonReplacement {
  path: JsonPath;
  before: string;
  after: string;
  reference: Omit<ProjectAssetRelocationReferenceChange, 'before' | 'after'>;
}

interface RelocationRewriteOptions {
  allowBareRoleChange?: boolean;
  rewritePortraitTarget?: boolean;
}

function pathKey(path: JsonPath): string {
  return JSON.stringify(path);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export async function fingerprintProjectAssetRelocationOpaqueScan(
  roots: readonly ProjectAssetRelocationOpaqueRootScan[],
  files: readonly ProjectFile[],
  hasher: TextHasher,
): Promise<string> {
  return hasher.sha256(canonicalJson({
    roots: roots.map((root) => ({
      root: root.root,
      state: root.state,
      filePaths: [...root.filePaths].sort(),
    })),
    files: files.map((file) => ({ path: file.path, sha256: file.sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  }));
}

function portableFold(value: string): string {
  return value.normalize('NFC').toUpperCase().toLowerCase();
}

function safeNormalizePath(value: string): string | null {
  try {
    return normalizeProjectPath(value.normalize('NFC'));
  } catch {
    return null;
  }
}

function directoryOf(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator < 0 ? '' : path.slice(0, separator);
}

function safeAssetFileName(value: string): boolean {
  return value.normalize('NFC') === value && isProjectAssetFileNameSafe(value);
}

function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function roleAndOutfit(key: string): { role: string; outfit: string } {
  const separator = key.indexOf(':');
  return separator < 0
    ? { role: key, outfit: 'normal' }
    : { role: key.slice(0, separator), outfit: key.slice(separator + 1) };
}

function normalizePortraitTarget(raw: string): string {
  const decoded = decodeInstructionArgument(raw).trim();
  return decoded.includes(':') ? decoded : `${decoded}:normal`;
}

function uniqueFiles(files: readonly ProjectFile[]): ProjectFile[] {
  const byPath = new Map<string, ProjectFile>();
  for (const file of files) {
    const path = safeNormalizePath(file.path);
    if (path === null) continue;
    const existing = byPath.get(path);
    if (existing !== undefined && existing.sha256 !== file.sha256) {
      throw new Error(`PROJECT_TEXT_IDENTITY_CONFLICT: ${path}`);
    }
    byPath.set(path, { ...file, path });
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function addBlocker(
  blockers: ProjectAssetRelocationBlocker[],
  code: ProjectAssetRelocationBlockerCode,
  message: string,
  sourcePath?: string,
  line?: number,
): void {
  const candidate: ProjectAssetRelocationBlocker = {
    code,
    message,
    ...(sourcePath === undefined ? {} : { sourcePath }),
    ...(line === undefined ? {} : { line }),
  };
  if (!blockers.some((item) => canonicalJson(item) === canonicalJson(candidate))) blockers.push(candidate);
}

function skipWhitespace(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length && /\s/.test(source[cursor]!)) cursor += 1;
  return cursor;
}

function readJsonString(source: string, start: number): { end: number; value: string } {
  if (source[start] !== '"') throw new Error('JSON_STRING_EXPECTED');
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (source[cursor] === '"') {
      const end = cursor + 1;
      return { end, value: JSON.parse(source.slice(start, end)) as string };
    }
    cursor += 1;
  }
  throw new Error('JSON_STRING_UNTERMINATED');
}

function jsonStringLocations(source: string): JsonStringLocation[] {
  const locations: JsonStringLocation[] = [];
  const parseValue = (input: number, path: JsonPath): number => {
    let cursor = skipWhitespace(source, input);
    const first = source[cursor];
    if (first === '"') {
      const token = readJsonString(source, cursor);
      locations.push({ kind: 'value', path: [...path], start: cursor, end: token.end, value: token.value });
      return token.end;
    }
    if (first === '{') {
      cursor = skipWhitespace(source, cursor + 1);
      if (source[cursor] === '}') return cursor + 1;
      const keys = new Set<string>();
      while (cursor < source.length) {
        const key = readJsonString(source, cursor);
        if (keys.has(key.value)) throw new Error(`JSON_DUPLICATE_KEY: ${key.value}`);
        keys.add(key.value);
        locations.push({
          kind: 'key',
          path: [...path, key.value],
          start: cursor,
          end: key.end,
          value: key.value,
        });
        cursor = skipWhitespace(source, key.end);
        if (source[cursor] !== ':') throw new Error('JSON_COLON_EXPECTED');
        cursor = parseValue(cursor + 1, [...path, key.value]);
        cursor = skipWhitespace(source, cursor);
        if (source[cursor] === '}') return cursor + 1;
        if (source[cursor] !== ',') throw new Error('JSON_COMMA_EXPECTED');
        cursor = skipWhitespace(source, cursor + 1);
      }
    }
    if (first === '[') {
      cursor = skipWhitespace(source, cursor + 1);
      if (source[cursor] === ']') return cursor + 1;
      let index = 0;
      while (cursor < source.length) {
        cursor = parseValue(cursor, [...path, index++]);
        cursor = skipWhitespace(source, cursor);
        if (source[cursor] === ']') return cursor + 1;
        if (source[cursor] !== ',') throw new Error('JSON_COMMA_EXPECTED');
        cursor = skipWhitespace(source, cursor + 1);
      }
    }
    while (cursor < source.length && !/[\s,}\]]/.test(source[cursor]!)) cursor += 1;
    return cursor;
  };
  const end = skipWhitespace(source, parseValue(0, []));
  if (end !== source.length) throw new Error('JSON_TRAILING_CONTENT');
  return locations;
}

function replaceJsonStrings(source: string, replacements: readonly JsonReplacement[]): string {
  if (replacements.length === 0) return source;
  const locations = new Map(jsonStringLocations(source)
    .filter((location) => location.kind === 'value')
    .map((location) => [pathKey(location.path), location]));
  const edits = replacements.map((replacement) => {
    const location = locations.get(pathKey(replacement.path));
    if (location === undefined || location.value !== replacement.before) {
      throw new Error(`JSON_RELOCATION_PRECONDITION_FAILED: ${pathKey(replacement.path)}`);
    }
    return { ...location, after: replacement.after };
  }).sort((left, right) => right.start - left.start);
  let result = source;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + JSON.stringify(edit.after) + result.slice(edit.end);
  }
  return result;
}

interface CodeStringLiteral {
  start: number;
  end: number;
  value: string;
}

function decodeCodeStringBody(body: string): string {
  let value = '';
  for (let index = 0; index < body.length; index++) {
    const character = body[index]!;
    if (character !== '\\' || index + 1 >= body.length) {
      value += character;
      continue;
    }
    const escaped = body[++index]!;
    const simple: Record<string, string> = {
      n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0',
    };
    if (simple[escaped] !== undefined) {
      value += simple[escaped];
      continue;
    }
    if (escaped === 'x' && /^[0-9a-fA-F]{2}$/u.test(body.slice(index + 1, index + 3))) {
      value += String.fromCodePoint(Number.parseInt(body.slice(index + 1, index + 3), 16));
      index += 2;
      continue;
    }
    if (escaped === 'u') {
      const brace = /^\{([0-9a-fA-F]{1,6})\}/u.exec(body.slice(index + 1));
      if (brace !== null) {
        value += String.fromCodePoint(Number.parseInt(brace[1]!, 16));
        index += brace[0].length;
        continue;
      }
      const hex = body.slice(index + 1, index + 5);
      if (/^[0-9a-fA-F]{4}$/u.test(hex)) {
        value += String.fromCodePoint(Number.parseInt(hex, 16));
        index += 4;
        continue;
      }
    }
    value += escaped;
  }
  return value;
}

function codeStringLiterals(source: string): CodeStringLiteral[] {
  const literals: CodeStringLiteral[] = [];
  for (let index = 0; index < source.length; index++) {
    const quote = source[index];
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;
    const start = index;
    let body = '';
    for (index += 1; index < source.length; index++) {
      const character = source[index]!;
      if (character === '\\' && index + 1 < source.length) {
        body += character + source[++index]!;
        continue;
      }
      if (character === quote) {
        literals.push({ start, end: index + 1, value: decodeCodeStringBody(body) });
        break;
      }
      body += character;
    }
  }
  return literals;
}

function containsOpaqueCodeToken(source: string, tokens: readonly string[]): boolean {
  const literals = codeStringLiterals(source);
  for (let start = 0; start < literals.length; start++) {
    let combined = literals[start]!.value;
    if (tokens.includes(combined)) return true;
    for (let end = start + 1; end < literals.length; end++) {
      const separator = source.slice(literals[end - 1]!.end, literals[end]!.start);
      if (!/^\s*\+\s*$/u.test(separator)) break;
      combined += literals[end]!.value;
      if (tokens.includes(combined)) return true;
    }
  }
  return false;
}

function opaqueTokens(source: ProjectAssetPathDescriptor): string[] {
  const assetRelative = source.path.startsWith('content/assets/')
    ? source.path.slice('content/assets/'.length)
    : source.path;
  return [...new Set([source.key, source.path, assetRelative, source.fileName].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  ))];
}

export async function fingerprintProjectAssetRelocationInventory(
  files: readonly ProjectAssetFileFact[],
  hasher: TextHasher,
): Promise<string> {
  return hasher.sha256(canonicalJson(files.map((file) => ({
    path: normalizeProjectPath(file.path),
    ...(file.bytes === undefined ? {} : { bytes: file.bytes }),
    ...(file.sha256 === undefined ? {} : { sha256: file.sha256 }),
  })).sort((left, right) => left.path.localeCompare(right.path))));
}

function supportedOpaqueCodePath(path: string): boolean {
  const root = path.split('/')[0]?.toLowerCase();
  if (!['src', 'scripts', 'test', 'tests'].includes(root ?? '')) return false;
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return CODE_EXTENSIONS.has(extension);
}

function reference(
  sourceKind: ProjectAssetRelocationReferenceChange['sourceKind'],
  sourcePath: string,
  sourceLabel: string,
  field: string,
  referenceId: string,
  line?: number,
): Omit<ProjectAssetRelocationReferenceChange, 'before' | 'after'> {
  return {
    referenceId,
    sourceKind,
    sourcePath,
    sourceLabel,
    field,
    ...(line === undefined ? {} : { line }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addJsonOpaqueBlockers(
  sourceText: string,
  knownPaths: ReadonlySet<string>,
  tokens: readonly string[],
  blockers: ProjectAssetRelocationBlocker[],
  sourcePath: string,
): void {
  for (const location of jsonStringLocations(sourceText)) {
    const topLevel = location.path[0];
    const knownConfigValue = sourcePath === 'game.config.json'
      && typeof topLevel === 'string'
      && (['title', 'version', 'entryScene', 'variables', 'customInstructions', 'fonts'].includes(topLevel)
        || (topLevel === 'characters'
          && !(location.kind === 'value' && location.path.at(-1) === 'avatar')));
    if (knownConfigValue) continue;
    if ((location.kind === 'value' && knownPaths.has(pathKey(location.path))) || !tokens.includes(location.value)) continue;
    addBlocker(
      blockers,
      'ASSET_RELOCATION_OPAQUE_REFERENCE',
      '项目文本中存在 Surdet 尚不能自动更新的素材引用。',
      sourcePath,
    );
  }
}

function sceneRewrite(
  file: ProjectFile,
  source: ProjectAssetPathDescriptor,
  target: ProjectAssetPathDescriptor,
  blockers: ProjectAssetRelocationBlocker[],
  options: RelocationRewriteOptions = {},
): { text: string; references: ProjectAssetRelocationReferenceChange[] } {
  const lines = parseSceneDocument(file.text);
  const references: ProjectAssetRelocationReferenceChange[] = [];
  const tokens = opaqueTokens(source);
  const sourcePortrait = roleAndOutfit(source.key);
  const targetPortrait = roleAndOutfit(target.key);
  const rewrite = (raw: string, lineNumber: number, prefix = ''): string => {
    const parsed = splitInstruction(raw);
    const args = parsed.args.map(decodeInstructionArgument);
    const replacements = new Map<number, string>();
    const addChange = (argument: number, field: string, before: string, after: string): void => {
      replacements.set(argument, after);
      references.push({
        ...reference('scene', file.path, `场景 · 第 ${lineNumber} 行`, `${prefix}${field}`, `scene:${file.path}:${lineNumber}:${prefix}${field}`, lineNumber),
        before,
        after,
      });
    };

    if (source.kind === 'background' && parsed.name === 'bg' && args[0] === source.key && target.key !== source.key) {
      addChange(0, 'bg', source.key, target.key);
    } else if (source.kind === 'portrait' && parsed.name === 'show') {
      const key = args[0] === undefined ? '' : normalizePortraitTarget(args[0]);
      const expression = args[1] === undefined ? 'normal' : args[1].trim();
      if (key === source.key && expression === source.variant) {
        if (target.key !== source.key) addChange(0, 'show.target', args[0] ?? source.key, target.key);
        if (target.variant !== source.variant) addChange(1, 'show.expression', expression, target.variant ?? expression);
      }
    } else if (source.kind === 'portrait' && (parsed.name === 'hide' || parsed.name === 'mov')) {
      const rawKey = args[0]?.trim() ?? '';
      if (rawKey.includes(':') && rawKey === source.key && target.key !== source.key) {
        addChange(0, `${parsed.name}.target`, rawKey, target.key);
      } else if (!rawKey.includes(':') && rawKey === sourcePortrait.role && targetPortrait.role !== sourcePortrait.role) {
        if (options.allowBareRoleChange) {
          addChange(0, `${parsed.name}.target`, rawKey, targetPortrait.role);
        } else {
          addBlocker(
            blockers,
            'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE',
            `第 ${lineNumber} 行按角色分组操作立绘，不能确定是否只应改动当前文件。`,
            file.path,
            lineNumber,
          );
        }
      }
    } else if (!KNOWN_ASSET_INSTRUCTIONS.has(parsed.name)
      && [...args, ...instructionModifierTokens(raw)].some((argument) => tokens.includes(argument))) {
      addBlocker(
        blockers,
        'ASSET_RELOCATION_OPAQUE_REFERENCE',
        `第 ${lineNumber} 行的自定义指令可能引用当前素材，Surdet 不会猜测改写。`,
        file.path,
        lineNumber,
      );
    }
    return replacements.size > 0 ? rewriteInstructionArgumentsRaw(raw, replacements) : raw;
  };
  lines.forEach((line, index) => {
    if (line.kind === 'instr') lines[index] = { ...line, raw: rewrite(line.raw, index + 1) };
    if (line.kind !== 'choice-option') return;
    // 与 Core choice parser 使用同一箭头规则，指令分段复用其引号感知 lexer。
    const arrow = /\s->(?:\s|$)/.exec(line.raw);
    if (!arrow) return;
    const end = arrow.index + arrow[0].length;
    const parts = splitOutsideQuotes(line.raw.slice(end), '@');
    const inline = parts.map((part, n) => n === 0 ? part : rewrite(`@${part}`, index + 1, `inline.${n}.`).slice(1)).join('@');
    lines[index] = { ...line, raw: line.raw.slice(0, end) + inline };
  });
  return { text: serializeSceneDocument(lines), references };
}

function timelineRewrite(
  file: ProjectFile,
  source: ProjectAssetPathDescriptor,
  target: ProjectAssetPathDescriptor,
  blockers: ProjectAssetRelocationBlocker[],
  options: RelocationRewriteOptions = {},
): { text: string; references: ProjectAssetRelocationReferenceChange[]; knownPaths: Set<string> } {
  let root: Record<string, unknown>;
  try {
    const parsed = JSON.parse(file.text.replace(/^\uFEFF/, '')) as unknown;
    root = isRecord(parsed) ? parsed : {};
    jsonStringLocations(file.text);
  } catch {
    addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '时间轴无法解析，不能安全更新素材引用。', file.path);
    return { text: file.text, references: [], knownPaths: new Set() };
  }
  const replacements: JsonReplacement[] = [];
  const knownPaths = new Set<string>();
  const tracks = Array.isArray(root.tracks) ? root.tracks : [];
  const sourcePortrait = roleAndOutfit(source.key);
  const targetPortrait = roleAndOutfit(target.key);
  tracks.forEach((trackValue, trackIndex) => {
    const track = isRecord(trackValue) ? trackValue : null;
    if (track === null) return;
    const cues = Array.isArray(track.cues) ? track.cues : [];
    if (track.kind === 'background') {
      cues.forEach((cueValue, cueIndex) => {
        const cue = isRecord(cueValue) ? cueValue : null;
        if (cue?.action !== 'set' || typeof cue.key !== 'string') return;
        const path: JsonPath = ['tracks', trackIndex, 'cues', cueIndex, 'key'];
        knownPaths.add(pathKey(path));
        if (source.kind === 'background' && cue.key === source.key && target.key !== source.key) {
          replacements.push({
            path,
            before: source.key,
            after: target.key,
            reference: reference('timeline', file.path, `时间轴 · 轨道 ${trackIndex + 1} · 片段 ${cueIndex + 1}`, 'background.key', `timeline:${file.path}:${trackIndex}:${cueIndex}:key`),
          });
        }
      });
    }
    if (track.kind !== 'portrait' || typeof track.target !== 'string') return;
    const targetPath: JsonPath = ['tracks', trackIndex, 'target'];
    knownPaths.add(pathKey(targetPath));
    const normalizedTarget = track.target.includes(':') ? track.target : `${track.target}:normal`;
    const directCue = cues.some((cueValue) => {
      const cue = isRecord(cueValue) ? cueValue : null;
      return cue !== null && (cue.action === 'show' || cue.action === 'expression')
        && (typeof cue.expression !== 'string' ? 'normal' : cue.expression) === source.variant;
    });
    const fullMatch = track.target.includes(':') && normalizedTarget === source.key;
    const bareRoleChanged = !track.target.includes(':') && track.target === sourcePortrait.role
      && targetPortrait.role !== sourcePortrait.role;
    const defaultMatch = !track.target.includes(':') && normalizedTarget === source.key && directCue
      && (!bareRoleChanged || options.allowBareRoleChange === true);
    const rewritePortraitTarget = options.rewritePortraitTarget !== false;
    if (source.kind === 'portrait' && fullMatch && target.key !== source.key && rewritePortraitTarget) {
      replacements.push({
        path: targetPath,
        before: track.target,
        after: target.key,
        reference: reference('timeline', file.path, `时间轴 · 轨道 ${trackIndex + 1}`, 'portrait.target', `timeline:${file.path}:${trackIndex}:target`),
      });
    } else if (source.kind === 'portrait' && bareRoleChanged && rewritePortraitTarget) {
      if (options.allowBareRoleChange) {
        replacements.push({
          path: targetPath,
          before: track.target,
          after: targetPortrait.role,
          reference: reference('timeline', file.path, `时间轴 · 轨道 ${trackIndex + 1}`, 'portrait.target', `timeline:${file.path}:${trackIndex}:target`),
        });
      } else {
        addBlocker(
          blockers,
          'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE',
          `时间轴第 ${trackIndex + 1} 条轨道按角色分组操作立绘，不能确定是否只应改动当前文件。`,
          file.path,
        );
      }
    }
    if (source.kind === 'portrait' && (fullMatch || defaultMatch)) {
      cues.forEach((cueValue, cueIndex) => {
        const cue = isRecord(cueValue) ? cueValue : null;
        if (cue === null || !['show', 'expression'].includes(String(cue.action))) return;
        const path: JsonPath = ['tracks', trackIndex, 'cues', cueIndex, 'expression'];
        if (typeof cue.expression === 'string') knownPaths.add(pathKey(path));
        if (typeof cue.expression !== 'string' && source.variant === 'normal' && target.variant !== source.variant) {
          addBlocker(
            blockers,
            'ASSET_RELOCATION_OPAQUE_REFERENCE',
            `时间轴第 ${trackIndex + 1} 条轨道的第 ${cueIndex + 1} 个片段没有可安全改写的表情值。`,
            file.path,
          );
          return;
        }
        if (typeof cue.expression === 'string' && cue.expression === source.variant && target.variant !== source.variant) {
          replacements.push({
            path,
            before: cue.expression,
            after: target.variant ?? cue.expression,
            reference: reference('timeline', file.path, `时间轴 · 轨道 ${trackIndex + 1} · 片段 ${cueIndex + 1}`, 'portrait.expression', `timeline:${file.path}:${trackIndex}:${cueIndex}:expression`),
          });
        }
      });
    }
  });
  const references = replacements.map((item) => ({ ...item.reference, before: item.before, after: item.after }));
  return { text: replaceJsonStrings(file.text, replacements), references, knownPaths };
}

function configRewrite(
  file: ProjectFile,
  source: ProjectAssetPathDescriptor,
  target: ProjectAssetPathDescriptor,
  blockers: ProjectAssetRelocationBlocker[],
): { text: string; references: ProjectAssetRelocationReferenceChange[]; knownPaths: Set<string> } {
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(file.text.replace(/^\uFEFF/, '')) as Record<string, unknown>;
    jsonStringLocations(file.text);
  } catch {
    addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '角色配置无法安全解析，不能更新头像引用。', file.path);
    return { text: file.text, references: [], knownPaths: new Set() };
  }
  const replacements: JsonReplacement[] = [];
  const knownPaths = new Set<string>();
  const characters = isRecord(root.characters) ? root.characters : {};
  for (const [id, value] of Object.entries(characters)) {
    if (!isRecord(value) || typeof value.avatar !== 'string') continue;
    const path: JsonPath = ['characters', id, 'avatar'];
    knownPaths.add(pathKey(path));
    if (source.kind === 'avatar' && value.avatar === source.key && target.key !== source.key) {
      replacements.push({
        path,
        before: source.key,
        after: target.key,
        reference: reference('character', file.path, `角色 ${id}`, 'avatar', `character:${id}:avatar`),
      });
    }
  }
  return {
    text: replaceJsonStrings(file.text, replacements),
    references: replacements.map((item) => ({ ...item.reference, before: item.before, after: item.after })),
    knownPaths,
  };
}

function galleryRewrite(
  file: ProjectFile,
  source: ProjectAssetPathDescriptor,
  target: ProjectAssetPathDescriptor,
  blockers: ProjectAssetRelocationBlocker[],
): { text: string; references: ProjectAssetRelocationReferenceChange[]; knownPaths: Set<string> } {
  let root: Record<string, unknown>;
  try {
    const parsed = JSON.parse(file.text.replace(/^\uFEFF/, '')) as unknown;
    root = isRecord(parsed) ? parsed : {};
    jsonStringLocations(file.text);
  } catch {
    addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '鉴赏配置无法解析，不能安全更新背景引用。', file.path);
    return { text: file.text, references: [], knownPaths: new Set() };
  }
  const replacements: JsonReplacement[] = [];
  const knownPaths = new Set<string>();
  const cgs = Array.isArray(root.cgs) ? root.cgs : [];
  cgs.forEach((value, index) => {
    const entry = isRecord(value) ? value : null;
    if (entry === null) return;
    if (typeof entry.id === 'string') knownPaths.add(pathKey(['cgs', index, 'id']));
    if (typeof entry.src === 'string' && entry.src.trim().length > 0) {
      const path: JsonPath = ['cgs', index, 'src'];
      knownPaths.add(pathKey(path));
      if (source.kind === 'background' && entry.src === source.key && target.key !== source.key) {
        replacements.push({
          path,
          before: source.key,
          after: target.key,
          reference: reference('gallery', file.path, `鉴赏条目 ${typeof entry.name === 'string' ? entry.name : entry.id ?? index + 1}`, 'cgs.src', `gallery:cgs:${index}:src`),
        });
      }
    } else if (source.kind === 'background' && entry.id === source.key && target.key !== source.key) {
      addBlocker(
        blockers,
        'ASSET_RELOCATION_OPAQUE_REFERENCE',
        '鉴赏条目省略了素材来源并使用条目 ID 作为背景键，不能自动重命名。',
        file.path,
      );
    }
  });
  return {
    text: replaceJsonStrings(file.text, replacements),
    references: replacements.map((item) => ({ ...item.reference, before: item.before, after: item.after })),
    knownPaths,
  };
}

function descriptorDuplicate(
  assetFiles: readonly ProjectAssetFileFact[],
  descriptor: ProjectAssetPathDescriptor,
  exceptPath: string,
): boolean {
  return assetFiles.some((fact) => {
    const candidate = describeProjectAssetPath(fact.path);
    return candidate !== null && portableFold(candidate.path) !== portableFold(exceptPath)
      && candidate.kind === descriptor.kind && candidate.key === descriptor.key
      && (candidate.variant ?? '') === (descriptor.variant ?? '');
  });
}

export async function planProjectAssetRelocation(
  input: ProjectAssetRelocationPlanInput,
  hasher: TextHasher,
): Promise<PreparedProjectAssetRelocation> {
  const blockers: ProjectAssetRelocationBlocker[] = [];
  const normalizedSource = safeNormalizePath(input.sourcePath);
  const normalizedTarget = safeNormalizePath(input.targetPath);
  const source = normalizedSource === null ? null : describeProjectAssetPath(normalizedSource);
  const target = normalizedTarget === null ? null : describeProjectAssetPath(normalizedTarget);
  if (source === null) addBlocker(blockers, 'ASSET_RELOCATION_SOURCE_NOT_FOUND', '源素材路径不安全或不属于项目素材目录。');
  if (target === null) addBlocker(blockers, 'ASSET_RELOCATION_TARGET_UNSAFE', '目标位置必须位于项目素材目录。');
  const normalizedOpaqueFiles = uniqueFiles(input.opaqueFiles);
  const opaqueFilePaths = normalizedOpaqueFiles.map((file) => file.path);
  const coveredOpaquePaths = input.scanCoverage.opaqueRoots.flatMap((root) => [...root.filePaths])
    .map(safeNormalizePath);
  const rootCoverageValid = input.scanCoverage.opaqueRoots.length === OPAQUE_ROOTS.length
    && input.scanCoverage.opaqueRoots.every((root, index) => root.root === OPAQUE_ROOTS[index]
      && (root.state === 'scanned' || root.state === 'missing')
      && (root.state !== 'missing' || root.filePaths.length === 0)
      && root.filePaths.every((path) => {
        const normalized = safeNormalizePath(path);
        return normalized !== null && normalized.startsWith(`${root.root}/`) && supportedOpaqueCodePath(normalized);
      }));
  const coveredPathsValid = coveredOpaquePaths.every((path): path is string => path !== null)
    && new Set(coveredOpaquePaths).size === coveredOpaquePaths.length
    && [...coveredOpaquePaths].sort().join('\n') === [...opaqueFilePaths].sort().join('\n');
  const opaqueFingerprint = await fingerprintProjectAssetRelocationOpaqueScan(
    input.scanCoverage.opaqueRoots,
    normalizedOpaqueFiles,
    hasher,
  );
  let assetInventoryFingerprint: string | null = null;
  try {
    assetInventoryFingerprint = await fingerprintProjectAssetRelocationInventory(input.assetFiles, hasher);
  } catch {
    // Invalid inventory paths are reported as an incomplete adapter scan below.
  }
  if (input.scanCoverage.gallery !== (input.galleryFile === null ? 'absent' : 'included')
    || (input.galleryFile !== null && safeNormalizePath(input.galleryFile.path) !== 'content/config/gallery.json')
    || !rootCoverageValid
    || !coveredPathsValid
    || !/^[0-9a-f]{64}$/.test(input.scanCoverage.opaqueInventoryFingerprint)
    || input.scanCoverage.opaqueInventoryFingerprint !== opaqueFingerprint) {
    addBlocker(blockers, 'ASSET_RELOCATION_SCAN_INCOMPLETE', '项目文本扫描范围不完整，不能安全整理素材。');
  }
  if (normalizedSource === null || normalizedTarget === null
    || input.binaryBaseline.source.path !== normalizedSource
    || input.binaryBaseline.target.path !== normalizedTarget
    || input.binaryBaseline.targetDirectory.path !== directoryOf(normalizedTarget)
    || !/^[0-9a-f]{64}$/.test(input.binaryBaseline.source.sha256)
    || assetInventoryFingerprint === null
    || input.binaryBaseline.assetInventoryFingerprint !== assetInventoryFingerprint
    || !Number.isSafeInteger(input.binaryBaseline.source.size)
    || input.binaryBaseline.source.size < 0) {
    addBlocker(blockers, 'ASSET_RELOCATION_SCAN_INCOMPLETE', '素材二进制基线与本次整理目标不一致。');
  }

  if (source !== null) {
    const matches = input.assetFiles.filter((fact) => portableFold(safeNormalizePath(fact.path) ?? '') === portableFold(source.path));
    if (matches.length === 0) addBlocker(blockers, 'ASSET_RELOCATION_SOURCE_NOT_FOUND', '源素材已经不存在，请刷新素材中心。', source.path);
    if (matches.length > 1) addBlocker(blockers, 'ASSET_RELOCATION_SOURCE_AMBIGUOUS', '源素材身份不唯一，不能自动整理。', source.path);
    if (matches.length === 1 && (matches[0]!.bytes !== input.binaryBaseline.source.size
      || matches[0]!.sha256 !== input.binaryBaseline.source.sha256)) {
      addBlocker(blockers, 'ASSET_RELOCATION_SCAN_INCOMPLETE', '源素材内容与本次二进制基线不一致。', source.path);
    }
    if (!SUPPORTED_KINDS.has(source.kind)) {
      addBlocker(blockers, 'ASSET_RELOCATION_UNSUPPORTED_KIND', '第一版只支持背景、立绘和头像素材。', source.path);
    }
    if (source.kind === 'portrait' && source.invalidName) {
      addBlocker(blockers, 'ASSET_RELOCATION_PORTRAIT_NAME_INVALID', '源立绘名称不符合“角色_服装_表情”结构，不能推断其引用。', source.path);
    }
    if (descriptorDuplicate(input.assetFiles, source, source.path) && target !== null
      && (source.key !== target.key || source.variant !== target.variant)) {
      addBlocker(blockers, 'ASSET_RELOCATION_SOURCE_AMBIGUOUS', '当前素材键已对应多个文件，不能判断引用属于哪一个。', source.path);
    }
    if (source.kind === 'portrait' && target !== null && source.key !== target.key
      && input.assetFiles.some((fact) => {
        const candidate = describeProjectAssetPath(fact.path);
        return candidate?.kind === 'portrait' && candidate.key === source.key
          && portableFold(candidate.path) !== portableFold(source.path);
      })) {
      addBlocker(
        blockers,
        'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE',
        '当前角色服装还有其他表情文件，不能只把其中一个改成新的角色服装。',
        source.path,
      );
    }
  }

  if (source !== null && target !== null) {
    if (input.binaryBaseline.target.state !== 'absent') {
      addBlocker(blockers, 'ASSET_RELOCATION_TARGET_EXISTS', '目标位置已经存在，Surdet 不会覆盖它。', target.path);
    }
    if (!safeAssetFileName(target.fileName)) {
      addBlocker(blockers, 'ASSET_RELOCATION_TARGET_NAME_INVALID', '目标文件名包含当前平台不允许的字符或保留名称。', target.path);
    }
    const directories = new Set(input.assetDirectories.map(safeNormalizePath).filter((value): value is string => value !== null).map(portableFold));
    if (!directories.has(portableFold(directoryOf(target.path)))) {
      addBlocker(blockers, 'ASSET_RELOCATION_TARGET_DIRECTORY_MISSING', '目标目录不存在，请选择当前素材类别下的已有目录。', target.path);
    }
    if (source.kind !== target.kind) {
      addBlocker(blockers, 'ASSET_RELOCATION_TARGET_KIND_MISMATCH', '素材只能在同一类别目录中整理。', target.path);
    }
    if (portableFold(source.format) !== portableFold(target.format)) {
      addBlocker(blockers, 'ASSET_RELOCATION_EXTENSION_CHANGED', '整理素材不能改变文件格式。', target.path);
    }
    if (target.kind === 'portrait' && target.invalidName) {
      addBlocker(blockers, 'ASSET_RELOCATION_PORTRAIT_NAME_INVALID', '立绘名称必须是“角色_服装_表情”。', target.path);
    }
    if (portableFold(source.path) === portableFold(target.path)) {
      addBlocker(blockers, 'ASSET_RELOCATION_NO_CHANGE', '新位置与当前位置相同。', target.path);
    }
    if (input.assetFiles.some((fact) => portableFold(safeNormalizePath(fact.path) ?? '') === portableFold(target.path)
      && portableFold(safeNormalizePath(fact.path) ?? '') !== portableFold(source.path))) {
      addBlocker(blockers, 'ASSET_RELOCATION_TARGET_EXISTS', '目标位置已经有同名文件，Surdet 不会覆盖它。', target.path);
    }
    if (descriptorDuplicate(input.assetFiles, target, source.path)) {
      addBlocker(blockers, 'ASSET_RELOCATION_TARGET_KEY_DUPLICATE', '新名称会与另一素材使用同一个运行时键。', target.path);
    }
    if (source.kind === 'background' && source.key === 'title_bg' && target.key !== source.key) {
      addBlocker(blockers, 'ASSET_RELOCATION_RESERVED_KEY', 'title_bg 是标题页保留背景键，只能移动位置，不能重命名。', source.path);
    }
    if (target.kind === 'background' && target.key === 'title_bg' && source.key !== target.key) {
      addBlocker(blockers, 'ASSET_RELOCATION_RESERVED_KEY', 'title_bg 是标题页保留背景键，普通背景不能改为这个名称。', target.path);
    }
  }

  const files = uniqueFiles([
    ...input.snapshot.files,
    ...(input.galleryFile === null || safeNormalizePath(input.galleryFile.path) !== 'content/config/gallery.json'
      ? []
      : [input.galleryFile]),
    ...normalizedOpaqueFiles,
  ]);
  const scannedFiles = files.map((file) => ({ path: file.path, sha256: file.sha256 }));
  const references: ProjectAssetRelocationReferenceChange[] = [];
  const prepared = new Map<string, string>();
  const knownJsonPaths = new Map<string, Set<string>>();

  if (source !== null && target !== null) {
    for (const scene of input.snapshot.scenes) {
      const rewritten = sceneRewrite(scene.file, source, target, blockers);
      references.push(...rewritten.references);
      if (rewritten.text !== scene.file.text) prepared.set(scene.file.path, rewritten.text);
    }
    for (const timeline of input.snapshot.timelines) {
      const rewritten = timelineRewrite(timeline, source, target, blockers);
      references.push(...rewritten.references);
      knownJsonPaths.set(timeline.path, rewritten.knownPaths);
      if (rewritten.text !== timeline.text) prepared.set(timeline.path, rewritten.text);
    }
    if (input.snapshot.configFile !== null) {
      const rewritten = configRewrite(input.snapshot.configFile, source, target, blockers);
      references.push(...rewritten.references);
      knownJsonPaths.set(input.snapshot.configFile.path, rewritten.knownPaths);
      if (rewritten.text !== input.snapshot.configFile.text) prepared.set(input.snapshot.configFile.path, rewritten.text);
    }
    if (input.galleryFile !== null && safeNormalizePath(input.galleryFile.path) === 'content/config/gallery.json') {
      const rewritten = galleryRewrite(input.galleryFile, source, target, blockers);
      references.push(...rewritten.references);
      knownJsonPaths.set(input.galleryFile.path, rewritten.knownPaths);
      if (rewritten.text !== input.galleryFile.text) prepared.set(input.galleryFile.path, rewritten.text);
    }

    const tokens = opaqueTokens(source);
    for (const file of files) {
      if (file.path.startsWith('content/scenario/')) continue;
      if (file.path === 'game.config.json' || file.path.startsWith('content/timelines/') || file.path === 'content/config/gallery.json') {
        if (blockers.some((blocker) => blocker.code === 'ASSET_RELOCATION_OPAQUE_REFERENCE'
          && blocker.sourcePath === file.path)) continue;
        try {
          addJsonOpaqueBlockers(file.text, knownJsonPaths.get(file.path) ?? new Set(), tokens, blockers, file.path);
        } catch {
          addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '项目 JSON 无法安全扫描素材引用。', file.path);
        }
      } else if (supportedOpaqueCodePath(file.path) && containsOpaqueCodeToken(file.text, tokens)) {
        addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '项目代码或校验脚本固定引用了当前素材，请先人工更新。', file.path);
      }
    }
  }

  blockers.sort((left, right) => left.code.localeCompare(right.code)
    || (left.sourcePath ?? '').localeCompare(right.sourcePath ?? '') || (left.line ?? 0) - (right.line ?? 0));
  references.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)
    || (left.line ?? 0) - (right.line ?? 0) || left.referenceId.localeCompare(right.referenceId));

  const textChanges: ProjectAssetRelocationTextChange[] = [];
  if (blockers.length === 0) {
    for (const [path, afterText] of [...prepared.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const before = files.find((file) => file.path === path)!;
      textChanges.push({
        path,
        beforeSha256: before.sha256,
        afterSha256: await hasher.sha256(afterText),
        beforeText: before.text,
        afterText,
      });
    }
  }

  const planBase = {
    schemaVersion: 1 as const,
    operationId: input.operationId,
    projectRevision: input.snapshot.revision,
    status: blockers.length === 0 ? 'ready' as const : 'blocked' as const,
    source,
    target,
    affectedReferenceCount: blockers.length === 0 ? references.length : 0,
    affectedFileCount: blockers.length === 0 ? textChanges.length : 0,
    referenceChanges: blockers.length === 0 ? references : [],
    blockers,
    scannedFiles,
    preparedFiles: textChanges.map((change) => ({ path: change.path, beforeSha256: change.beforeSha256, afterSha256: change.afterSha256 })),
    binaryBaseline: input.binaryBaseline,
    scanCoverage: {
      gallery: input.scanCoverage.gallery,
      opaqueRoots: input.scanCoverage.opaqueRoots,
      opaqueInventoryFingerprint: input.scanCoverage.opaqueInventoryFingerprint,
    },
  };
  const planFingerprint = await hasher.sha256(canonicalJson(planBase));
  const plan: ProjectAssetRelocationPlan = {
    schemaVersion: 1,
    operationId: input.operationId,
    planId: `relocation-plan-${planFingerprint.slice(0, 32)}`,
    planFingerprint,
    projectRevision: input.snapshot.revision,
    status: planBase.status,
    source,
    target,
    affectedReferenceCount: planBase.affectedReferenceCount,
    affectedFileCount: planBase.affectedFileCount,
    referenceChanges: planBase.referenceChanges,
    blockers,
  };
  return { plan, textChanges, scannedFiles, binaryBaseline: input.binaryBaseline };
}

interface NormalizedBatchMove {
  moveId: string;
  source: ProjectAssetPathDescriptor;
  target: ProjectAssetPathDescriptor;
  binaryBaseline: ProjectAssetRelocationBinaryBaseline;
  placeholder: ProjectAssetPathDescriptor;
  keyGroupComplete: boolean;
  roleGroupComplete: boolean;
}

function batchBlocker(
  blockers: ProjectAssetRelocationBlocker[],
  code: ProjectAssetRelocationBlockerCode,
  message: string,
  moveIds: readonly string[] = [],
  sourcePath?: string,
): void {
  const sortedMoveIds = [...new Set(moveIds)].sort();
  const candidate: ProjectAssetRelocationBlocker = {
    code,
    message,
    ...(sortedMoveIds.length === 0 ? {} : { moveIds: sortedMoveIds }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
  };
  if (!blockers.some((item) => canonicalJson(item) === canonicalJson(candidate))) blockers.push(candidate);
}

function mergeBatchReferences(
  destination: Map<string, ProjectAssetRelocationReferenceChange>,
  references: readonly ProjectAssetRelocationReferenceChange[],
  moveIds: readonly string[],
): void {
  const normalizedMoveIds = [...new Set(moveIds)].sort();
  for (const item of references) {
    const current = destination.get(item.referenceId);
    if (current === undefined) {
      destination.set(item.referenceId, { ...item, moveIds: normalizedMoveIds });
      continue;
    }
    destination.set(item.referenceId, {
      ...current,
      after: item.after,
      moveIds: [...new Set([...(current.moveIds ?? []), ...normalizedMoveIds])].sort(),
    });
  }
}

function descriptorSemanticEqual(
  left: ProjectAssetPathDescriptor,
  right: ProjectAssetPathDescriptor,
): boolean {
  return left.kind === right.kind && left.key === right.key && (left.variant ?? '') === (right.variant ?? '');
}

function descriptorSemanticKey(value: ProjectAssetPathDescriptor): string {
  return `${value.kind}\0${value.key}\0${value.variant ?? ''}`;
}

function placeholderTokens(value: ProjectAssetPathDescriptor): string[] {
  if (value.kind !== 'portrait') return opaqueTokens(value);
  const { role, outfit } = roleAndOutfit(value.key);
  return [...new Set([...opaqueTokens(value), role, outfit].filter(Boolean))];
}

function batchPlaceholder(
  source: ProjectAssetPathDescriptor,
  index: number,
  operationId: string,
  portraitRoleIndex: number,
  portraitKeyIndex: number,
  reservedSemanticKeys: Set<string>,
  reservedTexts: readonly string[],
): ProjectAssetPathDescriptor {
  const nonce = operationId.replace(/[^a-zA-Z0-9]/gu, '').slice(0, 8).toLowerCase() || 'operation';
  for (let attempt = 0; ; attempt += 1) {
    const suffix = attempt === 0 ? `${index}` : `${index}x${attempt}`;
    const candidate: ProjectAssetPathDescriptor = source.kind !== 'portrait'
      ? (() => {
        const key = `surdetbatch${nonce}${suffix}`;
        return {
          ...source,
          path: `${source.directory}/${key}.${source.format}`,
          fileName: `${key}.${source.format}`,
          key,
          invalidName: false,
        };
      })()
      : (() => {
        const role = `surdetbatch${nonce}r${portraitRoleIndex}x${attempt}`;
        const outfit = `surdetbatch${nonce}o${portraitKeyIndex}x${attempt}`;
        const variant = `v${index}`;
        return {
          ...source,
          path: `${source.directory}/${role}_${outfit}_${variant}.${source.format}`,
          fileName: `${role}_${outfit}_${variant}.${source.format}`,
          key: `${role}:${outfit}`,
          variant,
          invalidName: false,
        };
      })();
    const semanticKey = descriptorSemanticKey(candidate);
    if (reservedSemanticKeys.has(semanticKey)) continue;
    const tokens = placeholderTokens(candidate);
    if (reservedTexts.some((text) => tokens.some((token) => text.includes(token)))) continue;
    reservedSemanticKeys.add(semanticKey);
    return candidate;
  }
}

function batchMoveIdsForKey(moves: readonly NormalizedBatchMove[], move: NormalizedBatchMove): string[] {
  return moves.filter((candidate) => candidate.source.kind === move.source.kind
    && candidate.source.key === move.source.key).map((candidate) => candidate.moveId).sort();
}

function batchMoveIdsForRole(moves: readonly NormalizedBatchMove[], move: NormalizedBatchMove): string[] {
  if (move.source.kind !== 'portrait') return [move.moveId];
  const role = roleAndOutfit(move.source.key).role;
  return moves.filter((candidate) => candidate.source.kind === 'portrait'
    && roleAndOutfit(candidate.source.key).role === role).map((candidate) => candidate.moveId).sort();
}

function batchReferenceMoveIds(
  moves: readonly NormalizedBatchMove[],
  move: NormalizedBatchMove,
  item: ProjectAssetRelocationReferenceChange,
): string[] {
  if (item.field === 'hide.target' || item.field === 'mov.target' || item.field === 'portrait.target') {
    return item.before.includes(':')
      ? batchMoveIdsForKey(moves, move)
      : batchMoveIdsForRole(moves, move);
  }
  return [move.moveId];
}

function addReferencesForMove(
  destination: Map<string, ProjectAssetRelocationReferenceChange>,
  moves: readonly NormalizedBatchMove[],
  move: NormalizedBatchMove,
  references: readonly ProjectAssetRelocationReferenceChange[],
): void {
  for (const item of references) {
    mergeBatchReferences(destination, [item], batchReferenceMoveIds(moves, move, item));
  }
}

function stableTextFile(file: ProjectFile, text: string): ProjectFile {
  return { ...file, text };
}

export async function planProjectAssetRelocationBatch(
  input: ProjectAssetRelocationBatchPlanInput,
  hasher: TextHasher,
): Promise<PreparedProjectAssetRelocationBatch> {
  const blockers: ProjectAssetRelocationBlocker[] = [];
  const requestMoves = input.moves ?? input.items ?? [];
  if (requestMoves.length === 0) {
    batchBlocker(blockers, 'ASSET_RELOCATION_BATCH_EMPTY', '请至少选择一个要整理的素材。');
  }
  if (requestMoves.length > 100) {
    batchBlocker(blockers, 'ASSET_RELOCATION_BATCH_LIMIT', '一次最多整理 100 个素材，请拆成更小的批次。');
  }

  const normalizedCandidates: Array<{
    source: ProjectAssetPathDescriptor;
    target: ProjectAssetPathDescriptor;
    binaryBaseline: ProjectAssetRelocationBinaryBaseline;
  }> = [];
  for (const item of requestMoves) {
    const sourcePath = safeNormalizePath(item.sourcePath);
    const targetPath = safeNormalizePath(item.targetPath);
    const source = sourcePath === null ? null : describeProjectAssetPath(sourcePath);
    const target = targetPath === null ? null : describeProjectAssetPath(targetPath);
    if (source === null) {
      batchBlocker(blockers, 'ASSET_RELOCATION_SOURCE_NOT_FOUND', '源素材路径不安全或不属于项目素材目录。');
      continue;
    }
    if (target === null) {
      batchBlocker(blockers, 'ASSET_RELOCATION_TARGET_UNSAFE', '目标位置必须位于项目素材目录。', [], source.path);
      continue;
    }
    normalizedCandidates.push({ source, target, binaryBaseline: item.binaryBaseline });
  }
  normalizedCandidates.sort((left, right) => portableFold(left.source.path).localeCompare(portableFold(right.source.path))
    || left.source.path.localeCompare(right.source.path) || left.target.path.localeCompare(right.target.path));

  const sourceGroups = new Map<string, typeof normalizedCandidates>();
  const targetGroups = new Map<string, typeof normalizedCandidates>();
  for (const candidate of normalizedCandidates) {
    const sourceKey = portableFold(candidate.source.path);
    const targetKey = portableFold(candidate.target.path);
    sourceGroups.set(sourceKey, [...(sourceGroups.get(sourceKey) ?? []), candidate]);
    targetGroups.set(targetKey, [...(targetGroups.get(targetKey) ?? []), candidate]);
  }
  for (const group of sourceGroups.values()) {
    if (group.length > 1) {
      batchBlocker(blockers, 'ASSET_RELOCATION_DUPLICATE_SOURCE', '同一个源素材不能在一个批次中出现多次。', [], group[0]!.source.path);
    }
  }
  for (const group of targetGroups.values()) {
    if (group.length > 1) {
      batchBlocker(blockers, 'ASSET_RELOCATION_DUPLICATE_TARGET', '多个素材不能整理到同一个目标位置。', [], group[0]!.target.path);
    }
  }
  const kinds = new Set(normalizedCandidates.map((candidate) => candidate.source.kind));
  if (kinds.size > 1 || normalizedCandidates.some((candidate) => candidate.source.kind !== candidate.target.kind)) {
    batchBlocker(blockers, 'ASSET_RELOCATION_BATCH_KIND_MISMATCH', '一个批次只能整理同一类别的素材。');
  }

  let inventoryFingerprint: string | null = null;
  try {
    inventoryFingerprint = await fingerprintProjectAssetRelocationInventory(input.assetFiles, hasher);
  } catch {
    batchBlocker(blockers, 'ASSET_RELOCATION_SCAN_INCOMPLETE', '素材清单包含无效路径，不能安全整理。');
  }
  const selectedSourceFolds = new Set(normalizedCandidates.map((candidate) => portableFold(candidate.source.path)));
  const selectedSourcePaths = new Set(normalizedCandidates.map((candidate) => candidate.source.path));
  const sourceFacts = input.assetFiles.flatMap((fact) => {
    const path = safeNormalizePath(fact.path);
    if (path === null) return [];
    const descriptor = describeProjectAssetPath(path);
    return descriptor === null ? [] : [{ fact, descriptor }];
  });
  const portraitRoleIndexes = new Map<string, number>();
  const portraitKeyIndexes = new Map<string, number>();
  const sortedRoles = [...new Set(normalizedCandidates.filter((candidate) => candidate.source.kind === 'portrait')
    .map((candidate) => roleAndOutfit(candidate.source.key).role))].sort();
  sortedRoles.forEach((role, index) => portraitRoleIndexes.set(role, index));
  const sortedKeys = [...new Set(normalizedCandidates.filter((candidate) => candidate.source.kind === 'portrait')
    .map((candidate) => candidate.source.key))].sort();
  sortedKeys.forEach((key, index) => portraitKeyIndexes.set(key, index));
  const reservedSemanticKeys = new Set([
    ...sourceFacts.map((item) => descriptorSemanticKey(item.descriptor)),
    ...normalizedCandidates.flatMap((candidate) => [
      descriptorSemanticKey(candidate.source),
      descriptorSemanticKey(candidate.target),
    ]),
  ]);
  const reservedTexts = [
    ...input.snapshot.files.map((file) => file.text),
    ...(input.galleryFile === null ? [] : [input.galleryFile.text]),
    ...input.opaqueFiles.map((file) => file.text),
  ];

  const moves: NormalizedBatchMove[] = [];
  for (let index = 0; index < normalizedCandidates.length; index += 1) {
    const candidate = normalizedCandidates[index]!;
    const moveHash = await hasher.sha256(`${candidate.source.path}\0${candidate.target.path}`);
    const moveId = `relocation-move-${moveHash.slice(0, 24)}`;
    const sourceRole = candidate.source.kind === 'portrait' ? roleAndOutfit(candidate.source.key).role : '';
    const keyMembers = sourceFacts.filter((item) => item.descriptor.kind === 'portrait'
      && item.descriptor.key === candidate.source.key);
    const roleMembers = sourceFacts.filter((item) => item.descriptor.kind === 'portrait'
      && roleAndOutfit(item.descriptor.key).role === sourceRole);
    const keyGroupComplete = candidate.source.kind !== 'portrait'
      || keyMembers.every((item) => selectedSourcePaths.has(item.descriptor.path));
    const roleGroupComplete = candidate.source.kind !== 'portrait'
      || roleMembers.every((item) => selectedSourcePaths.has(item.descriptor.path));
    const placeholder = batchPlaceholder(
      candidate.source,
      index,
      input.operationId,
      portraitRoleIndexes.get(sourceRole) ?? index,
      portraitKeyIndexes.get(candidate.source.key) ?? index,
      reservedSemanticKeys,
      reservedTexts,
    );
    moves.push({ ...candidate, moveId, placeholder, keyGroupComplete, roleGroupComplete });
  }

  const moveIdBySource = new Map(moves.map((move) => [portableFold(move.source.path), move.moveId]));
  const semanticSourceGroups = new Map<string, NormalizedBatchMove[]>();
  for (const move of moves) {
    const key = descriptorSemanticKey(move.source);
    semanticSourceGroups.set(key, [...(semanticSourceGroups.get(key) ?? []), move]);
  }
  for (const group of semanticSourceGroups.values()) {
    if (group.length < 2) continue;
    batchBlocker(
      blockers,
      'ASSET_RELOCATION_SOURCE_AMBIGUOUS',
      '多个物理文件共用同一个运行时素材身份，不能自动判断引用属于哪一个。',
      group.map((move) => move.moveId),
      group[0]!.source.path,
    );
  }
  for (const group of sourceGroups.values()) {
    if (group.length > 1) {
      batchBlocker(blockers, 'ASSET_RELOCATION_DUPLICATE_SOURCE', '同一个源素材不能在一个批次中出现多次。',
        group.map((item) => moveIdBySource.get(portableFold(item.source.path)) ?? '').filter(Boolean), group[0]!.source.path);
    }
  }
  for (const group of targetGroups.values()) {
    if (group.length > 1) {
      batchBlocker(blockers, 'ASSET_RELOCATION_DUPLICATE_TARGET', '多个素材不能整理到同一个目标位置。',
        group.map((item) => moveIdBySource.get(portableFold(item.source.path)) ?? '').filter(Boolean), group[0]!.target.path);
    }
  }

  const finalDescriptors = [
    ...sourceFacts.filter((item) => !selectedSourceFolds.has(portableFold(item.descriptor.path))).map((item) => item.descriptor),
    ...moves.map((move) => move.target),
  ];
  for (const move of moves) {
    const duplicates = finalDescriptors.filter((candidate) => candidate.kind === move.target.kind
      && candidate.key === move.target.key && (candidate.variant ?? '') === (move.target.variant ?? ''));
    if (duplicates.length > 1) {
      batchBlocker(blockers, 'ASSET_RELOCATION_TARGET_KEY_DUPLICATE', '整理后的名称会与另一素材使用同一个运行时键。', [move.moveId], move.target.path);
    }
    if (move.source.kind === 'portrait' && move.source.key !== move.target.key && !move.keyGroupComplete) {
      batchBlocker(blockers, 'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE', '必须选择当前角色服装的全部表情文件，才能统一修改角色或服装。', [move.moveId], move.source.path);
    }
  }
  for (const sourceKey of sortedKeys) {
    const group = moves.filter((move) => move.source.kind === 'portrait' && move.source.key === sourceKey);
    if (group.length === 0 || group.every((move) => move.source.key === move.target.key)) continue;
    const targetKeys = new Set(group.map((move) => move.target.key));
    const targetVariants = new Set(group.map((move) => `${move.target.key}\0${move.target.variant ?? ''}`));
    if (targetKeys.size !== 1 || targetVariants.size !== group.length) {
      batchBlocker(blockers, 'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE', '同一立绘组必须一致映射到一个新角色服装，并保留唯一表情。', group.map((move) => move.moveId), group[0]!.source.path);
    }
  }
  for (const sourceRole of sortedRoles) {
    const group = moves.filter((move) => move.source.kind === 'portrait'
      && roleAndOutfit(move.source.key).role === sourceRole);
    if (group.length === 0 || !group.every((move) => move.roleGroupComplete)) continue;
    const targetRoles = new Set(group.map((move) => roleAndOutfit(move.target.key).role));
    if (targetRoles.size > 1) {
      batchBlocker(
        blockers,
        'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE',
        '同一角色的完整立绘组必须一致映射到同一个目标角色。',
        group.map((move) => move.moveId),
        group[0]!.source.path,
      );
    }
  }

  for (const move of moves) {
    const targetIsSelectedSource = selectedSourceFolds.has(portableFold(move.target.path));
    if (!targetIsSelectedSource && move.binaryBaseline.target.state === 'exists') {
      batchBlocker(blockers, 'ASSET_RELOCATION_TARGET_EXISTS', '目标位置已经存在，Surdet 不会覆盖它。', [move.moveId], move.target.path);
    }
    if (inventoryFingerprint === null
      || move.binaryBaseline.assetInventoryFingerprint !== inventoryFingerprint
      || move.binaryBaseline.source.path !== move.source.path
      || move.binaryBaseline.target.path !== move.target.path
      || move.binaryBaseline.targetDirectory.path !== directoryOf(move.target.path)
      || (targetIsSelectedSource ? move.binaryBaseline.target.state !== 'exists' : move.binaryBaseline.target.state !== 'absent')) {
      batchBlocker(blockers, 'ASSET_RELOCATION_SCAN_INCOMPLETE', '素材二进制基线与批量整理目标不一致。', [move.moveId], move.source.path);
      continue;
    }
    const plannerInventory = input.assetFiles.filter((fact) => {
      const path = safeNormalizePath(fact.path);
      return path === null || !selectedSourceFolds.has(portableFold(path)) || portableFold(path) === portableFold(move.source.path);
    });
    const plannerInventoryFingerprint = await fingerprintProjectAssetRelocationInventory(plannerInventory, hasher);
    const single = await planProjectAssetRelocation({
      operationId: input.operationId,
      snapshot: input.snapshot,
      assetFiles: plannerInventory,
      assetDirectories: input.assetDirectories,
      sourcePath: move.source.path,
      targetPath: move.target.path,
      galleryFile: input.galleryFile,
      opaqueFiles: input.opaqueFiles,
      scanCoverage: input.scanCoverage,
      binaryBaseline: {
        ...move.binaryBaseline,
        target: { path: move.target.path, state: 'absent' },
        assetInventoryFingerprint: plannerInventoryFingerprint,
      },
    }, hasher);
    for (const blocker of single.plan.blockers) {
      if (blocker.code === 'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE') continue;
      batchBlocker(blockers, blocker.code, blocker.message, [move.moveId], blocker.sourcePath);
    }
  }

  const normalizedOpaqueFiles = uniqueFiles(input.opaqueFiles);
  const files = uniqueFiles([
    ...input.snapshot.files,
    ...(input.galleryFile === null || safeNormalizePath(input.galleryFile.path) !== 'content/config/gallery.json'
      ? []
      : [input.galleryFile]),
    ...normalizedOpaqueFiles,
  ]);
  const scannedFiles = files.map((file) => ({ path: file.path, sha256: file.sha256 }));
  const referenceMap = new Map<string, ProjectAssetRelocationReferenceChange>();
  const prepared = new Map<string, string>();
  const knownJsonPaths = new Map<string, Set<string>>();

  const semanticMoves = moves.filter((move) => !descriptorSemanticEqual(move.source, move.target));
  const lastKeyMove = new Set<string>();
  for (const move of semanticMoves) {
    if (move.source.kind !== 'portrait') continue;
    const keyMoves = semanticMoves.filter((candidate) => candidate.source.kind === 'portrait'
      && candidate.source.key === move.source.key);
    if (keyMoves.at(-1)?.moveId === move.moveId) lastKeyMove.add(move.moveId);
  }

  const rewriteSceneFile = (file: ProjectFile): void => {
    let text = file.text;
    for (const move of moves) {
      const target = descriptorSemanticEqual(move.source, move.target) ? move.source : move.placeholder;
      const rewritten = sceneRewrite(stableTextFile(file, text), move.source, target, blockers, {
        allowBareRoleChange: move.roleGroupComplete,
      });
      addReferencesForMove(referenceMap, moves, move, rewritten.references);
      text = rewritten.text;
    }
    for (const move of semanticMoves) {
      const rewritten = sceneRewrite(stableTextFile(file, text), move.placeholder, move.target, blockers, {
        allowBareRoleChange: move.roleGroupComplete,
      });
      addReferencesForMove(referenceMap, moves, move, rewritten.references);
      text = rewritten.text;
    }
    if (text !== file.text) prepared.set(file.path, text);
  };

  const rewriteJsonFile = (
    file: ProjectFile,
    rewriter: typeof timelineRewrite | typeof configRewrite | typeof galleryRewrite,
  ): void => {
    let text = file.text;
    const known = new Set<string>();
    for (const move of moves) {
      const target = descriptorSemanticEqual(move.source, move.target) ? move.source : move.placeholder;
      const rewritten = rewriter === timelineRewrite
        ? timelineRewrite(stableTextFile(file, text), move.source, target, blockers, {
          allowBareRoleChange: move.roleGroupComplete,
          rewritePortraitTarget: move.source.kind !== 'portrait' || lastKeyMove.has(move.moveId),
        })
        : rewriter(stableTextFile(file, text), move.source, target, blockers);
      addReferencesForMove(referenceMap, moves, move, rewritten.references);
      for (const path of rewritten.knownPaths) known.add(path);
      text = rewritten.text;
    }
    for (const move of semanticMoves) {
      const rewritten = rewriter === timelineRewrite
        ? timelineRewrite(stableTextFile(file, text), move.placeholder, move.target, blockers, {
          allowBareRoleChange: move.roleGroupComplete,
          rewritePortraitTarget: move.source.kind !== 'portrait' || lastKeyMove.has(move.moveId),
        })
        : rewriter(stableTextFile(file, text), move.placeholder, move.target, blockers);
      addReferencesForMove(referenceMap, moves, move, rewritten.references);
      for (const path of rewritten.knownPaths) known.add(path);
      text = rewritten.text;
    }
    knownJsonPaths.set(file.path, known);
    if (text !== file.text) prepared.set(file.path, text);
  };

  for (const scene of input.snapshot.scenes) rewriteSceneFile(scene.file);
  for (const timeline of input.snapshot.timelines) rewriteJsonFile(timeline, timelineRewrite);
  if (input.snapshot.configFile !== null) rewriteJsonFile(input.snapshot.configFile, configRewrite);
  if (input.galleryFile !== null && safeNormalizePath(input.galleryFile.path) === 'content/config/gallery.json') {
    rewriteJsonFile(input.galleryFile, galleryRewrite);
  }

  const allOpaqueTokens = [...new Set(moves.flatMap((move) => opaqueTokens(move.source)))];
  for (const file of files) {
    if (file.path.startsWith('content/scenario/')) continue;
    if (file.path === 'game.config.json' || file.path.startsWith('content/timelines/') || file.path === 'content/config/gallery.json') {
      try {
        addJsonOpaqueBlockers(file.text, knownJsonPaths.get(file.path) ?? new Set(), allOpaqueTokens, blockers, file.path);
      } catch {
        addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '项目 JSON 无法安全扫描素材引用。', file.path);
      }
    } else if (supportedOpaqueCodePath(file.path) && containsOpaqueCodeToken(file.text, allOpaqueTokens)) {
      addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '项目代码或校验脚本固定引用了批次中的素材，请先人工更新。', file.path);
    }
  }

  blockers.sort((left, right) => left.code.localeCompare(right.code)
    || (left.sourcePath ?? '').localeCompare(right.sourcePath ?? '')
    || (left.moveIds ?? []).join('\0').localeCompare((right.moveIds ?? []).join('\0'))
    || (left.line ?? 0) - (right.line ?? 0));
  const references = [...referenceMap.values()].filter((item) => item.before !== item.after)
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)
      || (left.line ?? 0) - (right.line ?? 0) || left.referenceId.localeCompare(right.referenceId));
  const textChanges: ProjectAssetRelocationTextChange[] = [];
  if (blockers.length === 0) {
    for (const [path, afterText] of [...prepared.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const before = files.find((file) => file.path === path)!;
      textChanges.push({
        path,
        beforeSha256: before.sha256,
        afterSha256: await hasher.sha256(afterText),
        beforeText: before.text,
        afterText,
      });
    }
  }
  const publicMoves = moves.map((move) => ({ moveId: move.moveId, source: move.source, target: move.target }));
  const planBase = {
    schemaVersion: 2 as const,
    operationId: input.operationId,
    projectRevision: input.snapshot.revision,
    status: blockers.length === 0 ? 'ready' as const : 'blocked' as const,
    moves: publicMoves,
    source: publicMoves.length === 1 ? publicMoves[0]!.source : null,
    target: publicMoves.length === 1 ? publicMoves[0]!.target : null,
    affectedAssetCount: blockers.length === 0 ? publicMoves.length : 0,
    affectedReferenceCount: blockers.length === 0 ? references.length : 0,
    affectedFileCount: blockers.length === 0 ? textChanges.length : 0,
    referenceChanges: blockers.length === 0 ? references : [],
    blockers,
    scannedFiles,
    preparedFiles: textChanges.map((change) => ({ path: change.path, beforeSha256: change.beforeSha256, afterSha256: change.afterSha256 })),
    binaryBaselines: moves.map((move) => move.binaryBaseline),
    scanCoverage: input.scanCoverage,
  };
  const planFingerprint = await hasher.sha256(canonicalJson(planBase));
  const plan: ProjectAssetRelocationBatchPlan = {
    schemaVersion: 2,
    operationId: input.operationId,
    planId: `relocation-batch-plan-${planFingerprint.slice(0, 32)}`,
    planFingerprint,
    projectRevision: input.snapshot.revision,
    status: planBase.status,
    moves: publicMoves,
    source: planBase.source,
    target: planBase.target,
    affectedAssetCount: planBase.affectedAssetCount,
    affectedReferenceCount: planBase.affectedReferenceCount,
    affectedFileCount: planBase.affectedFileCount,
    referenceChanges: planBase.referenceChanges,
    blockers,
  };
  return {
    plan,
    textChanges,
    scannedFiles,
    binaryBaselines: moves.map((move) => move.binaryBaseline),
  };
}
