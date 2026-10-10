import { decodeStageToken, findChoiceArrow, Lexer, projectPortraitOverrides, splitOutsideQuotes, stageCommandFromInstruction } from '@surdet/core';
import { readTextCatalog } from './text-catalog.js';
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
import { describeProjectAssetPath, isProjectAssetFormatSupported, mediaAssetCommand } from './asset-intelligence.js';
import { isProjectAssetFileNameSafe, isProjectLicenseFileName } from './asset-import.js';
import { normalizeProjectPath } from './project-storage.js';
import type { ProjectSnapshot } from './project-snapshot.js';
import {
  decodeInstructionArgument,
  instructionModifierTokens,
  parseSceneDocument,
  rewriteInstructionArgumentsRaw,
  rewriteInstructionModifierRaw,
  serializeSceneDocument,
  splitInstruction,
} from './scene-document.js';

export const PROJECT_ASSET_RELOCATION_KINDS: readonly ProjectAssetKind[] = [
  'background', 'portrait', 'avatar', 'rule', 'music', 'ambience', 'sound-effect', 'voice', 'video', 'font', 'license',
];
const SUPPORTED_KINDS = new Set(PROJECT_ASSET_RELOCATION_KINDS);
const KNOWN_ASSET_INSTRUCTIONS = new Set([
  'bg', 'show', 'hide', 'mov', 'pose', 'layer', 'stage', 'bgm', 'ambience', 'se', 'voice', 'video', 'unlock_cg', 'unlock_music',
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
  locationKind?: 'key' | 'value';
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
    .map((location) => [`${location.kind}:${pathKey(location.path)}`, location]));
  const edits = replacements.map((replacement) => {
    const location = locations.get(`${replacement.locationKind ?? 'value'}:${pathKey(replacement.path)}`);
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
      && (['title', 'version', 'entryScene', 'variables', 'customInstructions'].includes(topLevel)
        || (topLevel === 'fonts' && location.kind === 'key')
        || (topLevel === 'player' && ['subtitle', 'endScenes', 'firstRunHint'].includes(String(location.path[1])))
        || (topLevel === 'characters'
          && (location.kind === 'key' || location.path.at(-1) === 'name')));
    if (knownConfigValue) continue;
    if (knownPaths.has(`${location.kind}:` + pathKey(location.path)) || (location.kind === 'value' && knownPaths.has(pathKey(location.path))) || !tokens.includes(location.value)) continue;
    addBlocker(
      blockers,
      'ASSET_RELOCATION_OPAQUE_REFERENCE',
      '项目文本中存在 Surdet 尚不能自动更新的素材引用。',
      sourcePath,
    );
  }
}

function conflictsWithRenamedPortraitInstance(id: unknown, source: ProjectAssetPathDescriptor, target: ProjectAssetPathDescriptor): boolean {
  if (source.kind !== 'portrait' || source.key === target.key || typeof id !== 'string') return false;
  const fromRole = roleAndOutfit(source.key).role, toRole = roleAndOutfit(target.key).role;
  return id === source.key || id === target.key || fromRole !== toRole
    && [fromRole, toRole].some(role => id === role || id.startsWith(`${role}:`));
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

    const mediaCommand = mediaAssetCommand(source.kind);
    if (source.kind === 'rule' && parsed.name === 'transition' && args[0] === 'rule') {
      const token = new Lexer().tokenize(raw, file.path).find(token => token.type === 'instruction');
      if (token?.type === 'instruction' && decodeStageToken(token.modifiers.get('rule') ?? '') === source.key && target.key !== source.key) {
        references.push({ ...reference('scene', file.path, `场景 · 第 ${lineNumber} 行`, 'transition.rule', `scene:${file.path}:${lineNumber}:transition.rule`, lineNumber), before: source.key, after: target.key });
        return rewriteInstructionModifierRaw(raw, 'rule', target.key);
      }
      return raw;
    }
    if (mediaCommand !== undefined && parsed.name === mediaCommand && args[0] === source.key
      && target.key !== source.key && !(mediaCommand === 'ambience' && args[0] === 'off')) {
      addChange(0, mediaCommand, source.key, target.key);
    } else if (source.kind === 'background' && parsed.name === 'layer' && args[1] === source.key && target.key !== source.key) {
      addChange(1, 'layer.key', source.key, target.key);
    } else if (source.kind === 'background' && parsed.name === 'bg' && args[0] === source.key && target.key !== source.key) {
      addChange(0, 'bg', source.key, target.key);
    } else if (source.kind === 'portrait' && parsed.name === 'show') {
      const key = args[0] === undefined ? '' : normalizePortraitTarget(args[0]);
      const expression = args[1] === undefined ? 'normal' : args[1].trim();
      if (key === source.key && expression === source.variant) {
        if (target.key !== source.key) addChange(0, 'show.target', args[0] ?? source.key, target.key);
        if (target.variant !== source.variant) addChange(1, 'show.expression', expression, target.variant ?? expression);
      }
    } else if (source.kind === 'portrait' && (parsed.name === 'hide' || parsed.name === 'mov' || parsed.name === 'pose')) {
      const rawKey = args[0]?.trim() ?? '';
      const portraitPrefix = parsed.name === 'pose' && rawKey.startsWith('portrait:') ? 'portrait:' : '';
      const key = portraitPrefix ? rawKey.slice(portraitPrefix.length) : rawKey;
      if (parsed.name === 'pose' && !portraitPrefix && key.startsWith('layer:')) return raw;
      if (key.includes(':') && key === source.key && target.key !== source.key) {
        addChange(0, `${parsed.name}.target`, rawKey, portraitPrefix + target.key);
      } else if (!key.includes(':') && key === sourcePortrait.role && targetPortrait.role !== sourcePortrait.role) {
        if (options.allowBareRoleChange) {
          addChange(0, `${parsed.name}.target`, rawKey, portraitPrefix + targetPortrait.role);
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
    const arrow = findChoiceArrow(line.raw, { file: file.path, line: index + 1, col: 1 });
    if (!arrow) return;
    const end = arrow.end;
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
  for (const value of tracks) if (isRecord(value) && value.kind === 'portrait'
    && conflictsWithRenamedPortraitInstance(value.target, source, target)
    && Array.isArray(value.cues) && value.cues.some(cue => isRecord(cue) && typeof cue.source === 'string')) {
    addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '素材改名与显式时间轴实例身份重叠，不能猜测改写目标。', file.path);
  }
  for (const clip of Array.isArray(root.clips) ? root.clips : []) if (isRecord(clip) && isRecord(clip.targets)
    && [...Object.keys(clip.targets), ...Object.values(clip.targets)].some(id => conflictsWithRenamedPortraitInstance(id, source, target))) {
    addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '素材改名涉及片段目标重绑定，请先明确实例与素材身份。', file.path);
  }
  const sourcePortrait = roleAndOutfit(source.key);
  const targetPortrait = roleAndOutfit(target.key);
  tracks.forEach((trackValue, trackIndex) => {
    const track = isRecord(trackValue) ? trackValue : null;
    if (track === null) return;
    const cues = Array.isArray(track.cues) ? track.cues : [];
    if (track.kind === 'background' || track.kind === 'layer') {
      cues.forEach((cueValue, cueIndex) => {
        const cue = isRecord(cueValue) ? cueValue : null;
        if (cue === null || (track.kind === 'background' ? cue.action !== 'set' : cue.action !== 'show') || typeof cue.key !== 'string') return;
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
    if (track.kind === 'audio') {
      for (const [cueIndex, cueValue] of cues.entries()) {
        const cue = isRecord(cueValue) ? cueValue : null;
        if (!cue || !['bgm', 'se', 'voice'].includes(String(cue.action)) || typeof cue.key !== 'string') continue;
        const path: JsonPath = ['tracks', trackIndex, 'cues', cueIndex, 'key'];
        knownPaths.add(pathKey(path));
        if (cue.action === mediaAssetCommand(source.kind) && cue.key === source.key && source.key !== target.key) {
          replacements.push({ path, before: cue.key, after: target.key,
            reference: reference('timeline', file.path, `时间轴 · 轨道 ${trackIndex + 1} · 片段 ${cueIndex + 1}`,
              `audio.${String(cue.action)}.key`, `timeline:${file.path}:${trackIndex}:${cueIndex}:key`) });
        }
      }
    }
    if (track.kind === 'layer') knownPaths.add(pathKey(['tracks', trackIndex, 'target']));
    if (track.kind !== 'portrait' || typeof track.target !== 'string') return;
    const explicit = root.version === 2 ? cues.filter(value => isRecord(value) && ['show', 'expression'].includes(String(value.action)) && typeof value.source === 'string') : [];
    for (const value of explicit) {
      const cue = value as Record<string, unknown>, index = cues.indexOf(value);
      const origin: JsonPath = ['tracks', trackIndex, 'cues', index, 'source'];
      const expression: JsonPath = ['tracks', trackIndex, 'cues', index, 'expression'];
      knownPaths.add(pathKey(origin)); knownPaths.add(pathKey(expression));
      if (source.kind !== 'portrait' || cue.source !== source.key) continue;
      if (source.key !== target.key && options.rewritePortraitTarget !== false) replacements.push({ path: origin, before: source.key, after: target.key,
        reference: reference('timeline', file.path, `时间轴轨道 ${trackIndex + 1}`, 'portrait.source', `timeline:${file.path}:${trackIndex}:${index}:source`) });
      if (cue.expression === source.variant && source.variant !== target.variant) replacements.push({ path: expression, before: String(cue.expression), after: target.variant!,
        reference: reference('timeline', file.path, `时间轴轨道 ${trackIndex + 1}`, 'portrait.expression', `timeline:${file.path}:${trackIndex}:${index}:expression`) });
    }
    // An explicitly sourced track names a display instance, not an asset slot.
    if (explicit.length > 0 && cues.every(value => !isRecord(value) || !['show', 'expression'].includes(String(value.action)) || typeof value.source === 'string')) {
      knownPaths.add(pathKey(['tracks', trackIndex, 'target'])); return;
    }
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
        if (cue === null || !['show', 'expression'].includes(String(cue.action)) || root.version === 2 && typeof cue.source === 'string') return;
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
  try {
    const catalog = readTextCatalog(root);
    for (const [index, entry] of (catalog?.entries ?? []).entries()) for (const [locale, voice] of Object.entries(entry.voices ?? {})) {
      if (source.kind === 'voice' && voice.asset === source.key && target.key !== source.key) replacements.push({
        path: ['textCatalog', 'entries', index, 'voices', locale, 'asset'], before: source.key, after: target.key,
        reference: reference('config', file.path, `对白 ${entry.key} · ${locale} 配音`, 'textCatalog.voices', `text-key:${entry.key}:voice:${locale}`),
      });
    }
    // All other validated catalog strings are prose, source identities or versions.
    for (const location of jsonStringLocations(file.text)) if (location.path[0] === 'textCatalog') knownPaths.add(`${location.kind}:${pathKey(location.path)}`);
  } catch (error) {
    addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', `文本目录无法安全解析：${error instanceof Error ? error.message : String(error)}`, file.path);
  }
  collectStageRelocation(root, file, source, target, replacements, knownPaths, blockers);
  // Preserve dormant paths too: deleting the modern table later must not
  // reactivate a legacy reference to the old location.
  const fontPaths: JsonPath[] = [['font'], ['fonts', 'body'], ['fonts', 'title'], ['fonts', 'ui']];
  for (const path of fontPaths) {
    const value = path.length === 1 ? root.font : isRecord(root.fonts) ? root.fonts[path[1] as string] : undefined;
    if (typeof value !== 'string') continue;
    knownPaths.add(pathKey(path));
    if (source.kind === 'font' && value === source.path && source.path !== target.path) {
      replacements.push({ path, before: value, after: target.path,
        reference: reference('config', file.path, `项目字体 ${path.join('.')}`, path.join('.'), `config:${path.join(':')}`) });
    }
  }
  for (const portrait of projectPortraitOverrides(root)) {
    if (portrait.visual) {
      const prefix: JsonPath = ['characters', portrait.role, 'visuals', portrait.outfit, portrait.expression];
      const entries: { path: JsonPath; value: string }[] = portrait.visual.kind === 'sequence'
        ? portrait.visual.frames.map((frame, index) => ({ path: [...prefix, 'frames', index, 'image'], value: frame.image }))
        : portrait.visual.layers.flatMap((layer, index) => Object.entries(layer.images).map(([variant, value]) => ({ path: [...prefix, 'layers', index, 'images', variant], value })));
      for (const entry of entries) {
        knownPaths.add(pathKey(entry.path));
        if (source.kind === 'portrait' && entry.value === source.path && target.path !== source.path) replacements.push({
          path: entry.path, before: source.path, after: target.path,
          reference: reference('character', file.path, `角色 ${portrait.role}`, 'visuals', `character:${portrait.role}:${portrait.outfit}:${portrait.expression}`),
        });
      }
      continue;
    }
    const path: JsonPath = ['characters', portrait.role, 'portraits', portrait.outfit, portrait.expression];
    knownPaths.add(pathKey(path));
    if (source.kind === 'portrait' && portrait.sourcePath === source.path && target.path !== source.path) {
      replacements.push({ path, before: source.path, after: target.path,
        reference: reference('character', file.path, `角色 ${portrait.role}`, 'portraits', `character:${portrait.role}:${portrait.outfit}:${portrait.expression}`) });
    }
  }
  const player = isRecord(root.player) ? root.player : {};
  if (typeof player.titleBackground === 'string') {
    const path: JsonPath = ['player', 'titleBackground'];
    knownPaths.add(pathKey(path));
    if (source.kind === 'background' && player.titleBackground === source.key && target.key !== source.key) {
      replacements.push({ path, before: source.key, after: target.key,
        reference: reference('config', file.path, '标题背景', 'titleBackground', 'config:player:titleBackground') });
    }
  }
  if (typeof player.titleLogo === 'string') {
    const path: JsonPath = ['player', 'titleLogo'];
    knownPaths.add(pathKey(path));
    if (source.kind === 'background' && player.titleLogo === source.key && target.key !== source.key) {
      replacements.push({ path, before: source.key, after: target.key,
        reference: reference('config', file.path, '标题字标', 'titleLogo', 'config:player:titleLogo') });
    }
  }
  const theme = isRecord(root.theme) ? root.theme : {};
  for (const field of ['dialogSkin', 'buttonSkin'] as const) {
    if (typeof theme[field] === 'string') {
      const path: JsonPath = ['theme', field];
      knownPaths.add(pathKey(path));
      if (source.kind === 'background' && theme[field] === source.key && target.key !== source.key) {
        replacements.push({ path, before: source.key, after: target.key,
          reference: reference('config', file.path, field === 'dialogSkin' ? '对话框皮肤' : '按钮皮肤', field, `config:theme:${field}`) });
      }
    }
  }
  const ui = isRecord(root.ui) ? root.ui : {};
  const uiPages = isRecord(ui.pages) ? ui.pages : {};
  const visitUiNode = (node: unknown, nodePath: JsonPath, page: string): void => {
    if (!isRecord(node)) return;
    // These are declarative identities/labels, not media references. Unknown
    // fields remain visible to the opaque-reference scan below.
    for (const key of ['id', 'type', 'tab', 'source']) if (typeof node[key] === 'string') knownPaths.add(pathKey([...nodePath, key]));
    for (const [field, keys] of [
      ['text', ['kind', 'value', 'name', 'field']], ['binding', ['kind', 'name']],
      ['action', ['kind', 'page', 'mode', 'id', 'name']], ['style', ['fontRole', 'align']],
    ] as const) {
      const value = node[field];
      if (isRecord(value)) for (const key of keys) if (typeof value[key] === 'string') knownPaths.add(pathKey([...nodePath, field, key]));
    }
    const assetPath: JsonPath = [...nodePath, 'asset'];
    if (typeof node.asset === 'string') {
      knownPaths.add(pathKey(assetPath));
      if (source.kind === 'background' && node.asset === source.key && target.key !== source.key) {
        replacements.push({ path: assetPath, before: source.key, after: target.key,
          reference: reference('config', file.path, `界面 ${page} 图片 ${String(node.id)}`, 'ui', `ui:${String(node.id)}:asset`) });
      }
    }
    if (Array.isArray(node.children)) node.children.forEach((child, index) => visitUiNode(child, [...nodePath, 'children', index], page));
  };
  for (const [page, node] of Object.entries(uiPages)) visitUiNode(node, ['ui', 'pages', page], page);
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
  const insertions: Array<{ idPath: JsonPath; value: string; change: ProjectAssetRelocationReferenceChange }> = [];
  for (const [field, kind] of [['cgs', 'background'], ['music', 'music']] as const) {
    const entries = Array.isArray(root[field]) ? root[field] as unknown[] : [];
    entries.forEach((value, index) => {
      const entry = isRecord(value) ? value : null;
      if (entry === null) return;
      for (const metadata of ['id', 'name', 'description']) {
        if (typeof entry[metadata] === 'string') knownPaths.add(pathKey([field, index, metadata]));
      }
      const path: JsonPath = [field, index, 'src'];
      if (typeof entry.src === 'string') knownPaths.add(pathKey(path));
      const effectiveSource = typeof entry.src === 'string' && entry.src.trim() ? entry.src.trim() : entry.id;
      if (source.kind !== kind || effectiveSource !== source.key || source.key === target.key) return;
      const item = reference('gallery', file.path,
        `鉴赏条目 ${typeof entry.name === 'string' ? entry.name : entry.id ?? index + 1}`,
        `${field}.src`, `gallery:${field}:${index}:src`);
      if (typeof entry.src === 'string') {
        replacements.push({ path, before: entry.src, after: target.key, reference: item });
      } else if (entry.src === undefined && typeof entry.id === 'string') {
        // Keep collection identity and unlock instructions. Materialize only
        // the formerly implicit media source in this same text transaction.
        knownPaths.add(pathKey(path));
        insertions.push({ idPath: [field, index, 'id'], value: target.key,
          change: { ...item, before: source.key, after: target.key } });
      } else {
        addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '鉴赏素材来源类型无效，不能安全更新。', file.path);
      }
    });
  }
  let text = replaceJsonStrings(file.text, replacements);
  const locations = jsonStringLocations(text);
  const edits = insertions.map((item) => {
    const location = locations.find(value => value.kind === 'value' && pathKey(value.path) === pathKey(item.idPath));
    if (!location) throw new Error('GALLERY_IMPLICIT_SOURCE_LOCATION_MISSING');
    return { offset: location.end, value: `, "src": ${JSON.stringify(item.value)}` };
  }).sort((left, right) => right.offset - left.offset);
  for (const edit of edits) text = text.slice(0, edit.offset) + edit.value + text.slice(edit.offset);
  return {
    text,
    references: [...replacements.map((item) => ({ ...item.reference, before: item.before, after: item.after })), ...insertions.map(item => item.change)],
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
    if (!SUPPORTED_KINDS.has(source.kind) || !isProjectAssetFormatSupported(source.kind, source.format)) {
      addBlocker(blockers, 'ASSET_RELOCATION_UNSUPPORTED_KIND', '该素材类别或格式尚未接入安全整理。', source.path);
    }
    if (source.kind === 'portrait' && source.invalidName) {
      addBlocker(blockers, 'ASSET_RELOCATION_PORTRAIT_NAME_INVALID', '源立绘名称不符合“角色_服装_表情”结构，不能推断其引用。', source.path);
    }
    if (source.kind === 'portrait' && target !== null && (source.key !== target.key || source.variant !== target.variant)) {
      for (const scene of input.snapshot.scenes) for (const instruction of scene.compiled.instructions) {
        if (instruction.op !== 'instr' || instruction.name !== 'show') continue;
        const command = stageCommandFromInstruction(instruction.name, instruction.args.map(decodeStageToken),
          new Map([...instruction.modifiers].map(([name, value]) => [name, decodeStageToken(value)])));
        if (command?.type === 'show' && conflictsWithRenamedPortraitInstance(command.instance, source, target)) {
          addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '素材改名与显式舞台实例 ID 重叠，不能猜测改写目标。', scene.path, instruction.line);
        }
      }
      const mappings = projectPortraitOverrides(input.snapshot.config);
      const sourceRole = source.key.split(':')[0];
      const targetRole = target.key.split(':')[0];
      if (mappings.some(p => source.key !== target.key
        ? p.role === sourceRole || p.role === targetRole
        : `${p.role}:${p.outfit}` === source.key && (p.expression === source.variant || p.expression === target.variant))) {
        addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '此改名涉及显式角色立绘槽；请先调整角色资料，避免重写仍由配置绑定的服装或表情。目录移动和未映射的素材键不受影响。', source.path);
      }
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
    if (target.kind === 'ambience' && target.key === 'off') {
      addBlocker(blockers, 'ASSET_RELOCATION_RESERVED_KEY', 'off 是环境音停止指令，不能作为整理后的播放键。', target.path);
    }
    if (target.kind === 'license' && !isProjectLicenseFileName(target.fileName)) {
      addBlocker(blockers, 'ASSET_RELOCATION_TARGET_NAME_INVALID', '许可证须保留受支持的文本文件名，不能通过改名变成媒体。', target.path);
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
        const fileName = source.format ? `${key}.${source.format}` : key;
        const path = `${source.directory}/${fileName}`;
        return {
          ...source,
          path,
          fileName,
          key: source.kind === 'font' || source.kind === 'license' ? path : key,
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
  if (/(?:^|\.)(?:hide|mov|pose|portrait)\.target$/.test(item.field)) {
    const before = item.field.endsWith('pose.target') && item.before.startsWith('portrait:') ? item.before.slice(9) : item.before;
    return before.includes(':')
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
      const target = rewriter === configRewrite || !descriptorSemanticEqual(move.source, move.target) ? move.placeholder : move.source;
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
    for (const move of rewriter === configRewrite ? moves : semanticMoves) {
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


/** Stage fields are part of the same exact JSON text edit, not a second save. */
function collectStageRelocation(root: Record<string, unknown>, file: ProjectFile, source: ProjectAssetPathDescriptor,
  target: ProjectAssetPathDescriptor, edits: JsonReplacement[], known: Set<string>, blockers: ProjectAssetRelocationBlocker[]): void {
  const stage = isRecord(root.stage) ? root.stage : {};
  const knownKey = (path: JsonPath) => known.add('key:' + pathKey(path));
  const change = (path: JsonPath, value: unknown, before: string, after: string, label: string, kind: 'key' | 'value' = 'value') => {
    if (kind === 'key') knownKey(path); else known.add(pathKey(path));
    if (value !== before || before === after) return;
    edits.push({ path, before, after, locationKind: kind,
      reference: reference('config', file.path, label, 'stage', `stage:${pathKey(path)}:${kind}`) });
  };
  const compositions = isRecord(stage.compositions) ? stage.compositions : {};
  for (const [id, value] of Object.entries(compositions)) {
    knownKey(['stage', 'compositions', id]); if (!isRecord(value)) continue;
    const prefix: JsonPath = ['stage', 'compositions', id];
    if (typeof value.background === 'string') known.add(pathKey([...prefix, 'background']));
    if (source.kind === 'background') change([...prefix, 'background'], value.background, source.key, target.key, `构图 ${id} 背景`);
    if (Array.isArray(value.layers)) value.layers.forEach((layer, index) => {
      if (!isRecord(layer)) return;
      const layerPath: JsonPath = [...prefix, 'layers', index];
      for (const field of ['id', 'band', 'key']) known.add(pathKey([...layerPath, field]));
      if (source.kind === 'background') change([...layerPath, 'key'], layer.key, source.key, target.key, `构图 ${id} 图层 ${String(layer.id)}`);
    });
  }
  for (const field of ['positions', 'distances']) if (isRecord(stage[field])) for (const id of Object.keys(stage[field])) knownKey(['stage', field, id]);
  const profiles = isRecord(stage.portraits) ? stage.portraits : {};
  for (const [id, raw] of Object.entries(profiles)) {
    if (!isRecord(raw)) continue;
    const prefix: JsonPath = ['stage', 'portraits', id]; knownKey(prefix);
    if (source.kind === 'portrait' && id === source.key && source.key !== target.key) {
      if (Object.hasOwn(profiles, target.key)) addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '目标校准已存在，不会覆盖。', file.path);
      else change(prefix, id, source.key, target.key, `舞台校准 ${id}`, 'key');
    }
    for (const field of ['expressions', 'sources']) {
      const variants = isRecord(raw[field]) ? raw[field] : {};
      for (const [expression, value] of Object.entries(variants)) {
        const path: JsonPath = [...prefix, field, expression]; knownKey(path);
        if (source.kind === 'portrait' && (id === source.key || id === target.key) && expression === source.variant && source.variant !== target.variant) {
          if (Object.hasOwn(variants, target.variant!)) addBlocker(blockers, 'ASSET_RELOCATION_OPAQUE_REFERENCE', '目标表情校准已存在，不会覆盖。', file.path);
          else change(path, expression, expression, target.variant!, `表情校准 ${id}:${expression}`, 'key');
        }
        if (field === 'sources' && isRecord(value)) {
          known.add(pathKey([...path, 'path'])); known.add(pathKey([...path, 'sha256']));
          if (source.kind === 'portrait') change([...path, 'path'], value.path, source.path, target.path, `校准图片 ${id}:${expression}`);
        }
      }
    }
  }
}
