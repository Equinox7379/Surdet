import { compileScene, findChoiceArrow, isValidSceneId, isReservedSceneFileId, parseInlineInstructions, splitOutsideQuotes } from '@surdet/core';
import { AuthoringOperationError, runOperation, type ChangeSession } from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import type { SceneMoveInput, SceneRenameInput, TextHasher } from './contracts.js';
import { compositionTextHasher } from './operation-composition-facts.js';
import { decodeInstructionArgument, instructionArgumentSpans, parseSceneDocument, serializeSceneDocument, splitInstruction } from './scene-document.js';
import { resolveUniqueScenarioPath, sceneIdFromScenarioPath } from './scenario-identity.js';
import { renameTextCatalogReferences } from './text-catalog.js';

/** Source-preserving flow target editing, shared with Editor. Never replace prose,
 * quoted choice conditions, arbitrary config strings or Core-ignored extra jumps.
 * Incomplete surrounding source can be edited in Editor; the operation compiles
 * complete working scenes before any transaction is persisted.
 */
export function visitSceneReferences(source: string, oldId: string, newId?: string, file = 'scene.gal'): { text: string; count: number } {
  let count = 0;
  const matches = (value: string) => value === oldId || value.startsWith(`${oldId}.`);
  const rewrite = (raw: string, line: number): string => {
    const instruction = parseInlineInstructions(raw.trimStart(), file, line, 1)[0];
    if (!instruction || (instruction.name !== 'jump' && instruction.name !== 'call')) return raw;
    const target = instruction.args.join(' ');
    if (!matches(target) && !matches(decodeInstructionArgument(target))) return raw;
    count++;
    if (newId === undefined) return raw;
    const span = instructionArgumentSpans(raw)[0];
    // Core keeps flow argument quotes literally. Do not silently repair an
    // ambiguous/broken target while renaming a different semantic identity.
    if (!matches(target) || instruction.args.length !== 1 || !span || span.raw !== target) {
      throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '无法安全定位场景引用，请先修正目标参数', { path: file, line, target });
    }
    return raw.slice(0, span.start) + newId + target.slice(oldId.length) + raw.slice(span.end);
  };
  const lines = parseSceneDocument(source);
  for (let index = 0; index < lines.length; index++) {
    const row = lines[index]!;
    if (row.kind === 'instr') row.raw = rewrite(row.raw, index + 1);
    if (row.kind !== 'choice-option') continue;
    const arrow = findChoiceArrow(row.raw, { file, line: index + 1, col: 1 });
    if (arrow === null) continue;
    const parts = splitOutsideQuotes(row.raw.slice(arrow.end), '@');
    let jumpSeen = false;
    for (let part = 1; part < parts.length; part++) {
      const raw = `@${parts[part]!}`;
      const name = parseInlineInstructions(raw, file, index + 1, 1)[0]?.name;
      if (name === 'jump' || name === 'goto') {
        if (jumpSeen) continue;
        jumpSeen = true;
      }
      parts[part] = rewrite(raw, index + 1).slice(1);
    }
    row.raw = row.raw.slice(0, arrow.end) + parts.join('@');
  }
  return { text: serializeSceneDocument(lines), count };
}

export function renameSceneDefinition(source: string, oldId: string, newId: string, file: string): string {
  const lines = parseSceneDocument(source);
  for (const row of lines) {
    if (row.kind !== 'instr' || row.name !== 'scene') continue;
    const { args } = splitInstruction(row.raw);
    const span = instructionArgumentSpans(row.raw)[0];
    if (args.length !== 1 || args[0] !== oldId || !span || span.raw !== oldId) {
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '场景声明与文件身份不一致，请先修正', { path: file });
    }
    row.raw = row.raw.slice(0, span.start) + newId + row.raw.slice(span.end);
  }
  return serializeSceneDocument(lines);
}

/** Only the supported host-entry fields are rewritten, not same-looking text. */
export const sceneReferenceConfigPaths = ['game.config.json', ...['gallery', 'events', 'growth', 'calendar'].map(name => `content/config/${name}.json`)];

export function renameConfigReferences(files: Record<string, string>, oldId: string, newId: string, fallbackEntry: string): void {
  const gamePath = 'game.config.json';
  for (const path of sceneReferenceConfigPaths) {
    const source = files[path];
    if (source === undefined && path !== gamePath) continue;
    const config = parseProjectConfigDocument(source ?? '{}', path);
    let changed = false;
    const record = (value: unknown, field: string): Record<string, unknown> => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AuthoringOperationError('PROJECT_INVALID', `${path}: ${field} 必须是对象`);
      return value as Record<string, unknown>;
    };
    const entries = (key: string): Record<string, unknown>[] => {
      const value = config[key];
      if (value === undefined) return [];
      if (!Array.isArray(value)) throw new AuthoringOperationError('PROJECT_INVALID', `${path}: ${key} 必须是数组`);
      return value.map(item => record(item, key));
    };
    const field = (object: Record<string, unknown>, key: string): void => {
      const value = object[key];
      if (value !== undefined && typeof value !== 'string') throw new AuthoringOperationError('PROJECT_INVALID', `${path}: ${key} 必须是场景字符串`);
      if (value === oldId) { object[key] = newId; changed = true; }
    };
    if (path === gamePath) {
      if (renameTextCatalogReferences(config, oldId, newId)) changed = true;
      field(config, 'entryScene');
      if (config['entryScene'] === undefined || config['entryScene'] === '') {
        // Renaming changes filename sorting. Pin the former implicit entry;
        // chapter organization must not silently change where a game starts.
        config['entryScene'] = fallbackEntry === oldId ? newId : fallbackEntry;
        changed = true;
      }
      if (config['player'] !== undefined) {
        const player = record(config['player'], 'player');
        const endings = player['endScenes'];
        if (endings !== undefined) {
          if (!Array.isArray(endings) || endings.some(value => typeof value !== 'string')) throw new AuthoringOperationError('PROJECT_INVALID', `${path}: player.endScenes 必须是场景数组`);
          if (endings.includes(oldId)) { player['endScenes'] = endings.map(value => value === oldId ? newId : value); changed = true; }
        }
      }
    } else if (path.endsWith('/gallery.json')) {
      for (const entry of entries('texts')) field(entry, 'scene');
    } else if (path.endsWith('/events.json')) {
      for (const entry of [...entries('events'), ...entries('scheduled')]) field(entry, 'scene');
    } else if (path.endsWith('/growth.json')) {
      for (const profile of entries('profiles')) {
        if (profile['levelEvents'] === undefined) continue;
        const levels = record(profile['levelEvents'], 'levelEvents');
        for (const level of Object.keys(levels)) field(levels, level);
      }
    } else {
      for (const entry of [...entries('nodes'), ...entries('baseCommands')]) field(entry, 'eventId');
    }
    if (changed) files[path] = serializeProjectConfigDocument(config, source ?? '');
  }
}

export async function applySceneRename(change: ChangeSession, input: SceneRenameInput, hasher: TextHasher = compositionTextHasher) {
  if (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined) {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '跨文件场景改名只支持普通 direct 草稿', { operationApplied: false, operationId: input.operationId });
  }
  return runOperation(change, input, async record => {
    if (!isValidSceneId(input.sceneId) || !isValidSceneId(input.newSceneId) || isReservedSceneFileId(input.newSceneId)) {
      throw new AuthoringOperationError('INVALID_REQUEST', '场景 ID 必须是可用的字母/数字/下划线/连字符名称');
    }
    if (input.sceneId.toLowerCase() === input.newSceneId.toLowerCase()) throw new AuthoringOperationError('INVALID_REQUEST', '新场景 ID 必须不同，不能仅改变大小写');
    const previousPath = resolveUniqueScenarioPath(record.workingFiles, input.sceneId);
    if (previousPath === undefined) throw new AuthoringOperationError('OBJECT_NOT_FOUND', `场景不存在：${input.sceneId}`);
    const source = record.workingFiles[previousPath]!;
    if (await hasher.sha256(source) !== input.expectedFingerprint) throw new AuthoringOperationError('OBJECT_REF_STALE', '场景正文已变化，请重新读取 object.inspect');
    const scenePaths = Object.keys(record.workingFiles).filter(path => path.startsWith('content/scenario/') && path.toLowerCase().endsWith('.gal')).sort();
    if (scenePaths.some(path => sceneIdFromScenarioPath(path).toLowerCase() === input.newSceneId.toLowerCase())) {
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `目标场景已存在：${input.newSceneId}`);
    }
    const path = previousPath.slice(0, previousPath.lastIndexOf('/') + 1) + input.newSceneId + previousPath.slice(-4);
    const workingFiles = { ...record.workingFiles };
    for (const file of scenePaths) workingFiles[file] = visitSceneReferences(workingFiles[file]!, input.sceneId, input.newSceneId, file).text;
    workingFiles[path] = renameSceneDefinition(workingFiles[previousPath]!, input.sceneId, input.newSceneId, previousPath);
    delete workingFiles[previousPath];
    renameConfigReferences(workingFiles, input.sceneId, input.newSceneId, sceneIdFromScenarioPath(scenePaths[0]!));
    const config = parseProjectConfigDocument(workingFiles['game.config.json'] ?? '{}');
    const custom = Array.isArray(config['customInstructions']) ? config['customInstructions'].filter((value): value is string => typeof value === 'string') : [];
    const affectedPaths = [...new Set([...Object.keys(record.workingFiles), ...Object.keys(workingFiles)])]
      .filter(file => record.workingFiles[file] !== workingFiles[file]).sort();
    for (const file of affectedPaths) {
      const text = workingFiles[file];
      if (text === undefined || !file.toLowerCase().endsWith('.gal')) continue;
      try { compileScene(text, file, sceneIdFromScenarioPath(file), custom); }
      catch (error) { throw new AuthoringOperationError('INVALID_REQUEST', error instanceof Error ? error.message : String(error), { path: file }); }
    }
    return { workingFiles, result: {
      previousSceneId: input.sceneId, sceneId: input.newSceneId, previousPath, path, affectedPaths,
      diffEntry: { kind: 'scene.rename', operationId: input.operationId, objectBefore: `scene:${input.sceneId}`, objectAfter: `scene:${input.newSceneId}`,
        directChange: { previousPath, path, affectedPaths }, potentialImpact: [], observedImpact: [] },
    } };
  });
}

export function sceneDirectorySegments(directory: string): string[] {
  const segments = directory === '' ? [] : directory.split('/');
  if (directory.length > 1024 || segments.some(segment => !segment || segment === '.' || segment === '..'
    || /[\\<>:"|?*\u0000-\u001f]/.test(segment) || /[. ]$/.test(segment)
    || isReservedSceneFileId(segment.split('.')[0]!)
    || /^(?:node_modules|dist|\.git)$/i.test(segment) || /^\.surdet-/i.test(segment))) {
    throw new AuthoringOperationError('INVALID_REQUEST', '章节目录必须是 content/scenario 内可用的相对目录；返回根目录请传空字符串');
  }
  return segments;
}

/** Shared chapter path contract for public authoring and the human Editor. */
export function sceneMoveTargetPath(previousPath: string, directory: string, existingPaths: readonly string[]): string {
  const segments = sceneDirectorySegments(directory);
  const path = ['content', 'scenario', ...segments, previousPath.slice(previousPath.lastIndexOf('/') + 1)].join('/');
  const fold = (value: string) => value.normalize('NFC').toUpperCase().toLowerCase();
  if (fold(path) === fold(previousPath)) throw new AuthoringOperationError('INVALID_REQUEST', '目标目录必须不同，不能仅改变大小写或 Unicode 表示');
  const targetParts = path.split('/');
  for (const existing of existingPaths) {
    const existingParts = existing.split('/');
    for (let index = 0; index < Math.min(existingParts.length, targetParts.length); index++) {
      if (fold(existingParts[index]!) !== fold(targetParts[index]!)) break;
      if (existingParts[index] !== targetParts[index] || index === existingParts.length - 1 || index === targetParts.length - 1) {
        throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '目标位置已占用或目录名称存在别名冲突', { path, existing });
      }
    }
  }
  return path;
}

/** Chapter folders are organization only: neither script bytes nor scene IDs change. */
export async function applySceneMove(change: ChangeSession, input: SceneMoveInput, hasher: TextHasher = compositionTextHasher) {
  if (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined) {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '章节移动只支持普通 direct 草稿', { operationApplied: false, operationId: input.operationId });
  }
  return runOperation(change, input, async record => {
    if (!isValidSceneId(input.sceneId)) throw new AuthoringOperationError('INVALID_REQUEST', '无效的场景 ID');
    const previousPath = resolveUniqueScenarioPath(record.workingFiles, input.sceneId);
    if (previousPath === undefined) throw new AuthoringOperationError('OBJECT_NOT_FOUND', `场景不存在：${input.sceneId}`);
    const source = record.workingFiles[previousPath]!;
    if (previousPath !== input.expectedPath || await hasher.sha256(source) !== input.expectedFingerprint) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', '场景位置或正文已变化，请重新读取 object.inspect');
    }
    const path = sceneMoveTargetPath(previousPath, input.directory, Object.keys(record.workingFiles));
    const workingFiles = { ...record.workingFiles, [path]: source };
    delete workingFiles[previousPath];
    const configSource = workingFiles['game.config.json'];
    const config = parseProjectConfigDocument(configSource ?? '{}');
    if (config['entryScene'] !== undefined && typeof config['entryScene'] !== 'string') {
      throw new AuthoringOperationError('PROJECT_INVALID', 'game.config.json: entryScene 必须是场景字符串');
    }
    if (config['entryScene'] === undefined || config['entryScene'] === '') {
      const previousFirst = Object.keys(record.workingFiles).filter(file => file.startsWith('content/scenario/') && file.toLowerCase().endsWith('.gal')).sort()[0]!;
      config['entryScene'] = sceneIdFromScenarioPath(previousFirst);
      workingFiles['game.config.json'] = serializeProjectConfigDocument(config, configSource ?? '');
    }
    const affectedPaths = [...new Set([...Object.keys(record.workingFiles), ...Object.keys(workingFiles)])]
      .filter(file => record.workingFiles[file] !== workingFiles[file]).sort();
    return { workingFiles, result: {
      sceneId: input.sceneId, previousPath, path, affectedPaths,
      diffEntry: { kind: 'scene.move', operationId: input.operationId, objectBefore: `scene:${input.sceneId}`, objectAfter: `scene:${input.sceneId}`,
        directChange: { previousPath, path, affectedPaths }, potentialImpact: [], observedImpact: [] },
    } };
  });
}
