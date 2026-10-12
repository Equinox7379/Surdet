import { readProjectPlugins, type ProjectPluginDeclaration } from '@surdet/core';
import { parseProjectConfigDocument } from '@surdet/authoring';
import { parse as lexModule } from 'es-module-lexer/js';
import { previewTextHash } from './preview-content.js';

/**
 * Project plugin code for the Editor preview. A declaration in game.config.json is data only; code
 * runs only after a person confirms it here, for the directory they opened and the exact entry text.
 */

export interface PluginEntryFacts {
  entry: string; source: string; sha256: string; bytes: number;
  /** Modules the entry's own syntax loads. */
  dependencies: string[];
  /** Why the module lexer could not read the entry, or null. */
  unlexable: string | null;
}
export type PluginStatus =
  | { kind: 'off' }
  | { kind: 'trusted'; sha256: string }
  | { kind: 'changed' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'unreadable'; reason: string };

/** The declarations of the config being previewed; an invalid list is reported as it is, not guessed. */
export function readPluginDeclarations(configText: string): { declarations: ProjectPluginDeclaration[]; error: string | null } {
  try { return { declarations: readProjectPlugins(parseProjectConfigDocument(configText || '{}')), error: null }; }
  catch (error) { return { declarations: [], error: error instanceof Error ? error.message : String(error) }; }
}

/**
 * What the entry's module syntax loads: static imports, re-exports and import() in any form, as the
 * module lexer Vite uses reads them. import.meta loads nothing. Source the lexer cannot read is not
 * guessed at; the entry is refused.
 */
export function pluginEntryDependencies(source: string): Pick<PluginEntryFacts, 'dependencies' | 'unlexable'> {
  let imports: ReturnType<typeof lexModule>[0];
  try { [imports] = lexModule(source); }
  catch (error) { return { dependencies: [], unlexable: error instanceof Error ? error.message : String(error) }; }
  return { dependencies: [...new Set(imports.filter(item => item.d !== -2).map(item => item.n ?? '（运行时计算的模块路径）'))], unlexable: null };
}

/** Why this entry cannot run in the Editor preview, or null. Nothing is compiled or installed for it. */
export function pluginEntryLimit(facts: Pick<PluginEntryFacts, 'entry' | 'dependencies' | 'unlexable'>): string | null {
  if (/\.ts$/i.test(facts.entry)) return 'TypeScript 入口需要先编译；Editor 试玩只运行浏览器可以直接执行的 .js 模块，不会自动编译。';
  if (facts.unlexable !== null) return `入口无法按 JavaScript 模块读取（${facts.unlexable}），Editor 不能确认它没有引用其他模块，因此不运行。`;
  if (facts.dependencies.length) return `入口引用了 ${facts.dependencies.join('、')}；Editor 试玩只能运行不依赖其他文件或包的单个 .js 模块。`;
  return null;
}

/** Read the entry from the directory the person opened; no other channel reads project code. */
export async function readPluginEntry(root: FileSystemDirectoryHandle, entry: string): Promise<PluginEntryFacts> {
  const parts = entry.split('/');
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const file = await (await directory.getFileHandle(parts.at(-1)!)).getFile();
  const source = await file.text();
  return { entry, source, sha256: await previewTextHash(source), bytes: file.size, ...pluginEntryDependencies(source) };
}

// Trust lives only in this Editor session and only for the directory handle the person opened.
const trusted = new WeakMap<FileSystemDirectoryHandle, Map<string, string>>();
/** Why trust was withdrawn, shown until the person confirms again. */
const withdrawn = new WeakMap<FileSystemDirectoryHandle, Map<string, PluginStatus>>();

export function trustPlugin(root: FileSystemDirectoryHandle, id: string, sha256: string): void {
  const entries = trusted.get(root) ?? new Map<string, string>();
  entries.set(id, sha256);
  trusted.set(root, entries);
  withdrawn.get(root)?.delete(id);
}

export function revokePlugin(root: FileSystemDirectoryHandle, id: string, reason?: PluginStatus): void {
  trusted.get(root)?.delete(id);
  const reasons = withdrawn.get(root) ?? new Map<string, PluginStatus>();
  if (reason) reasons.set(id, reason); else reasons.delete(id);
  withdrawn.set(root, reasons);
}

export function trustedPluginHash(root: FileSystemDirectoryHandle | null, id: string): string | null {
  return root === null ? null : trusted.get(root)?.get(id) ?? null;
}

/** What each plugin will do as of the last confirmation, before its entry is read again for a run. */
export function pluginStatuses(root: FileSystemDirectoryHandle | null, declarations: readonly ProjectPluginDeclaration[]): Map<string, PluginStatus> {
  return new Map(declarations.map(declaration => {
    const sha256 = trustedPluginHash(root, declaration.id);
    return [declaration.id, sha256 !== null ? { kind: 'trusted', sha256 } : (root && withdrawn.get(root)?.get(declaration.id)) || { kind: 'off' }];
  }));
}

/**
 * The trusted entries to send with a preview load. An entry whose text changed since it was confirmed,
 * or that can no longer run here, loses its trust and is not sent.
 */
export async function previewPluginSources(root: FileSystemDirectoryHandle | null, declarations: readonly ProjectPluginDeclaration[]): Promise<{
  sources: { id: string; entry: string; source: string }[]; statuses: Map<string, PluginStatus>;
}> {
  const sources: { id: string; entry: string; source: string }[] = [], statuses = new Map<string, PluginStatus>();
  for (const declaration of declarations) {
    const expected = trustedPluginHash(root, declaration.id);
    if (root === null || expected === null) { statuses.set(declaration.id, (root && withdrawn.get(root)?.get(declaration.id)) || { kind: 'off' }); continue; }
    const withdraw = (status: PluginStatus): void => { revokePlugin(root, declaration.id, status); statuses.set(declaration.id, status); };
    let facts: PluginEntryFacts;
    try { facts = await readPluginEntry(root, declaration.entry); }
    catch (error) {
      withdraw({ kind: 'unreadable', reason: `入口 ${declaration.entry} 无法读取：${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const limit = pluginEntryLimit(facts);
    if (limit) { withdraw({ kind: 'unsupported', reason: limit }); continue; }
    if (facts.sha256 !== expected) { withdraw({ kind: 'changed' }); continue; }
    sources.push({ id: declaration.id, entry: declaration.entry, source: facts.source });
    statuses.set(declaration.id, { kind: 'trusted', sha256: facts.sha256 });
  }
  return { sources, statuses };
}
