import {
  readTextCatalog as readCoreCatalog, validateTextLocale as validateCoreLocale, validateTextKey,
  collectProjectTextRows, projectTextSources, textSourceId as sourceId, textSourceMatches as sourceMatches,
  textTranslationIssue as translationIssue, isStoryTextSource, TextCatalogError,
  textCatalogEntryText,
  type TextSource, type TextCatalog, type CatalogSource,
} from '@surdet/core';
export type { TextSource, TextCatalogEntry, TextCatalog, CatalogSource } from '@surdet/core';
import { AuthoringOperationError, runOperation, stableStringify, type ChangeSession } from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import { loadProjectSnapshot, type ProjectSnapshot } from './project-snapshot.js';
import type { TextHasher } from './project-storage.js';
import { csvRecords } from './script-import.js';
import { buildProjectAssetIntelligence } from './asset-intelligence.js';
import type { ProjectAssetFileFact } from './contracts.js';

export type TextCatalogPatch =
  | { type: 'bind'; sourceLocale: string; bindings: { key: string; sourceId: string }[] }
  | { type: 'remove'; keys: string[] }
  | { type: 'import'; locale: string; csv: string; previewFingerprint: string };
export interface TextCatalogPatchInput { operationId: string; expectedRevision: string; expectedFingerprint: string; patch: TextCatalogPatch }

function invalid(message: string): never { throw new AuthoringOperationError('TEXT_CATALOG_INVALID', message); }
function catalogRead<T>(read: () => T): T {
  try { return read(); } catch (error) { if (error instanceof TextCatalogError) invalid(error.message); throw error; }
}
export function readTextCatalog(config: Record<string, unknown>): TextCatalog | null { return catalogRead(() => readCoreCatalog(config)); }
export function validateTextLocale(value: unknown): string { return catalogRead(() => validateCoreLocale(value)); }
function keyValue(value: unknown): string { return catalogRead(() => validateTextKey(value)); }
function collectTextSourceRows(snapshot: ProjectSnapshot) {
  const terminology = snapshot.files.find(file => file.path === 'content/config/terminology.json');
  return catalogRead(() => collectProjectTextRows(snapshot.config, snapshot.scenes.map(scene => ({
    id: scene.id, path: scene.path, text: scene.file.text, sha256: scene.file.sha256,
  })), terminology ? parseProjectConfigDocument(terminology.text, terminology.path) : undefined,
    parseProjectConfigDocument(snapshot.files.find(file => file.path === 'content/config/gallery.json')?.text ?? '{}', 'content/config/gallery.json')));
}
export async function collectTextSources(snapshot: ProjectSnapshot, hasher: TextHasher): Promise<CatalogSource[]> {
  return projectTextSources(collectTextSourceRows(snapshot), text => hasher.sha256(text));
}
export function staleTextCatalogKeys(snapshot: ProjectSnapshot): string[] {
  const entries = readTextCatalog(snapshot.config)?.entries ?? [];
  if (!entries.length) return [];
  const current = new Map(collectTextSourceRows(snapshot).map(source => [source.sourceId, source]));
  return entries.filter(entry => !sourceMatches(current.get(sourceId(entry.source)), entry.source)).map(entry => entry.key);
}
export async function inspectTextCatalog(snapshot: ProjectSnapshot, hasher: TextHasher, locale = 'en', assetFiles: readonly ProjectAssetFileFact[] = []) {
  validateTextLocale(locale);
  const value = readTextCatalog(snapshot.config);
  const sources = await collectTextSources(snapshot, hasher);
  const currentSources = new Map(sources.map(source => [source.sourceId, source]));
  const voiceAssets = buildProjectAssetIntelligence(snapshot, assetFiles).items.filter(item => item.kind === 'voice' && item.physical && item.issues.every(issue => issue === 'ASSET_UNUSED'))
    .map(item => ({ key: item.key, sourcePath: item.sourcePath }));
  return { revision: snapshot.revision, fingerprint: await hasher.sha256(stableStringify(value)), sourceLocale: value?.sourceLocale ?? null,
    sources, voiceAssets, entries: (value?.entries ?? []).map(entry => {
      const current = currentSources.get(sourceId(entry.source));
      const matches = sourceMatches(current, entry.source) && current?.version === entry.source.version;
      const spokenText = textCatalogEntryText(entry, locale, value!.sourceLocale), voice = entry.voices?.[locale];
      const voiceStatus = !voice ? 'unassigned' : !matches ? 'needs-rebind'
        : voice.sourceVersion !== entry.source.version || voice.text !== spokenText ? 'needs-recording'
        : voiceAssets.filter(asset => asset.key === voice.asset).length === 1 ? 'ready' : 'asset-unavailable';
      return { ...entry, spokenText, voiceStatus, status: !matches ? 'needs-rebind' as const
        : !entry.translations[locale]?.value ? 'untranslated' as const
        : entry.translations[locale]!.sourceVersion !== entry.source.version ? 'needs-translation' as const : 'translated' as const };
    }), locale };
}

export function assertTextCatalogTargetRemovable(config: Record<string, unknown>, sceneId: string, label?: string): void {
  const references = readTextCatalog(config)?.entries.filter(entry => isStoryTextSource(entry.source) && entry.source.sceneId === sceneId && (label === undefined || entry.source.label === label)) ?? [];
  if (references.length) throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '文本目录仍引用该对象，请先显式移除或重新绑定文本键', { references: references.map(entry => `text-key:${entry.key}`) });
}
export function renameTextCatalogReferences(config: Record<string, unknown>, from: string, to: string, labelScene?: string): boolean {
  const doc = readTextCatalog(config); if (!doc) return false;
  let changed = false;
  for (const entry of doc.entries) {
    if (!isStoryTextSource(entry.source)) continue;
    if (labelScene === undefined && entry.source.sceneId === from) { entry.source.sceneId = to; changed = true; }
    else if (labelScene !== undefined && entry.source.sceneId === labelScene && entry.source.label === from) { entry.source.label = to; changed = true; }
  }
  // Preserve source/translation versions. A changed scene requires explicit source confirmation.
  if (changed) config.textCatalog = doc;
  return changed;
}

export const TEXT_CSV_COLUMNS = ['key', 'locale', 'sourceVersion', 'speaker', 'context', 'source', 'translation', 'status'] as const;
export const VOICE_CSV_COLUMNS = ['key', 'locale', 'sourceVersion', 'speaker', 'context', 'source', 'text', 'voice', 'action', 'status'] as const;
function csvCell(value: string): string {
  const safe = /^(?:\s*[=+@-]|['\t\r\n])/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
function fromCell(value: string): string { return /^'(?:\s*[=+@-]|['\t\r\n])/.test(value) ? value.slice(1) : value; }
function contextText(source: TextSource): string { return isStoryTextSource(source) ? JSON.stringify([source.sceneId, source.label, source.ordinal, source.kind]) : sourceId(source); }
export function exportTextCatalogCsv(inspection: Awaited<ReturnType<typeof inspectTextCatalog>>): string {
  return '\uFEFF' + [TEXT_CSV_COLUMNS.join(','), ...inspection.entries.map(entry => [entry.key, inspection.locale, entry.source.version,
    entry.source.speaker, contextText(entry.source), entry.source.text, entry.translations[inspection.locale]?.value ?? '', entry.status].map(csvCell).join(','))].join('\r\n') + '\r\n';
}
export function exportVoiceCatalogCsv(inspection: Awaited<ReturnType<typeof inspectTextCatalog>>): string {
  return '\uFEFF' + [VOICE_CSV_COLUMNS.join(','), ...inspection.entries.filter(entry => entry.source.kind === 'dialogue').map(entry => [
    entry.key, inspection.locale, entry.source.version, entry.source.speaker, contextText(entry.source), entry.source.text,
    entry.spokenText ?? '', entry.voices?.[inspection.locale]?.asset ?? '', 'keep', entry.voiceStatus,
  ].map(csvCell).join(','))].join('\r\n') + '\r\n';
}
export async function previewTextCatalogImport(snapshot: ProjectSnapshot, hasher: TextHasher, locale: string, csv: string, assetFiles: readonly ProjectAssetFileFact[] = []) {
  const inspection = await inspectTextCatalog(snapshot, hasher, locale, assetFiles);
  const issues: { line: number; key?: string; message: string }[] = [];
  const rows: { line: number; key: string; source: string; before: string; after: string; changed: boolean; voiceAction?: 'keep' | 'bind' | 'remove'; spokenText?: string }[] = [];
  const parsed = csvRecords(csv.replace(/^\uFEFF/, ''));
  const voiceSheet = stableStringify(parsed.records[0]?.cells) === stableStringify(VOICE_CSV_COLUMNS);
  const columns = voiceSheet ? VOICE_CSV_COLUMNS : TEXT_CSV_COLUMNS;
  issues.push(...parsed.issues.map(issue => ({ line: issue.line, message: issue.message })));
  if (csv.includes('\0')) issues.push({ line: 1, message: 'CSV 包含 NUL 字符' });
  if (stableStringify(parsed.records[0]?.cells) !== stableStringify(columns)) issues.push({ line: 1, message: 'CSV 表头必须与译稿或配音清单导出表头一致' });
  if (!voiceSheet && locale === inspection.sourceLocale) issues.push({ line: 1, message: '译文语言不能等于源语言' });
  const entries = new Map(inspection.entries.filter(entry => !voiceSheet || entry.source.kind === 'dialogue').map(entry => [entry.key, entry])), seen = new Set<string>();
  for (const row of parsed.records.slice(1)) {
    const cells = row.cells.map(fromCell), key = cells[0] ?? '';
    const fail = (message: string): void => { issues.push({ line: row.line, key, message }); };
    if (cells.length !== columns.length) { fail('列数与导出表头不一致'); continue; }
    if (seen.has(key)) { fail('文本键重复'); continue; } seen.add(key);
    const entry = entries.get(key);
    if (!entry) { fail('文本键未登记'); continue; }
    if (entry.status === 'needs-rebind' && (!voiceSheet || cells[8] === 'bind')) fail('来源已变化，请先明确重新绑定该文本键');
    if (cells[1] !== locale) fail('译文语言与本次导入语言不一致');
    if (cells[2] !== entry.source.version || cells[3] !== entry.source.speaker || cells[4] !== contextText(entry.source) || cells[5] !== entry.source.text) fail('源文版本/说话人/上下文不匹配，请重新导出');
    if (voiceSheet) {
      const action = cells[8], before = entry.voices?.[locale]?.asset ?? '', after = cells[7]!;
      if (action !== 'keep' && action !== 'bind' && action !== 'remove') { fail('配音操作必须为 keep、bind 或 remove'); continue; }
      if (cells[6] !== (entry.spokenText ?? '')) fail('待录台词已变化，请重新导出配音清单');
      if (action === 'keep' && after !== before) fail('素材键改变时需明确选择 bind 或 remove');
      if (action === 'remove' && after !== '') fail('解除配音请清空 voice 并选择 remove');
      if (action === 'bind') {
        if (!entry.spokenText) fail('尚无已确认的本语言台词，不能关联配音');
        if (inspection.voiceAssets.filter(asset => asset.key === after).length !== 1) fail('配音素材不存在、存在歧义或格式不支持，请先导入唯一的 voice 素材');
      }
      rows.push({ line: row.line, key, source: entry.source.text, before, after, voiceAction: action,
        spokenText: entry.spokenText, changed: action === 'remove' ? Boolean(before) : action === 'bind' && (after !== before || entry.voiceStatus !== 'ready') });
      continue;
    }
    const after = cells[6]!, before = entry.translations[locale]?.value ?? '';
    // Empty means untranslated, not silent deletion of an existing translation.
    if (!after && before) fail('不能用空单元格删除已有译稿，请保留或填写返修译文');
    const problem = after ? translationIssue(entry.source.text, after) : undefined;
    if (problem) fail(problem);
    rows.push({ line: row.line, key, source: entry.source.text, before, after,
      changed: after !== before || (Boolean(after) && entry.translations[locale]?.sourceVersion !== entry.source.version) });
  }
  for (const key of entries.keys()) if (!seen.has(key)) issues.push({ line: 1, key, message: '缺少已登记文本行；本次导入不会删除缺行译稿' });
  const ready = issues.length === 0;
  return { ready, revision: inspection.revision, fingerprint: inspection.fingerprint, locale, rows, issues,
    previewFingerprint: await hasher.sha256(stableStringify({ revision: inspection.revision, fingerprint: inspection.fingerprint, locale, csv,
      ...(voiceSheet ? { voiceAssets: inspection.voiceAssets } : {}) })) };
}

export async function applyTextCatalogPatch(change: ChangeSession, input: TextCatalogPatchInput, hasher: TextHasher, assetFiles: readonly ProjectAssetFileFact[] = []) {
  if (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined)
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '译稿修改只支持 direct 草稿', { operationApplied: false });
  return runOperation(change, input, async record => {
    const files = record.workingFiles;
    const snapshot = await loadProjectSnapshot({ rootIdentity: record.projectRootIdentity,
      listFiles: async () => Object.keys(files), exists: async path => Object.hasOwn(files, path),
      readText: async path => ({ path, text: files[path]!, bytes: Array.from(files[path]!).reduce((size, char) => size + (char.codePointAt(0)! > 0xffff ? 4 : char.charCodeAt(0) > 0x7ff ? 3 : char.charCodeAt(0) > 0x7f ? 2 : 1), 0), sha256: await hasher.sha256(files[path]!) }) }, hasher);
    if (snapshot.revision !== input.expectedRevision) throw new AuthoringOperationError('OBJECT_REF_STALE', '项目版本变化，请重新读取文本目录');
    const before = await inspectTextCatalog(snapshot, hasher);
    if (before.fingerprint !== input.expectedFingerprint) throw new AuthoringOperationError('OBJECT_REF_STALE', '译稿目录指纹变化，请重新读取');
    const doc = readTextCatalog(snapshot.config) ?? { version: 1 as const, sourceLocale: 'zh-CN', entries: [] };
    const patch = input.patch;
    if (patch.type === 'bind') {
      validateTextLocale(patch.sourceLocale);
      if (doc.entries.length && doc.sourceLocale !== patch.sourceLocale) invalid('已有登记时不能改变源语言');
      doc.sourceLocale = patch.sourceLocale;
      if (!Array.isArray(patch.bindings) || !patch.bindings.length) invalid('至少选择一条来源');
      const seen = new Set<string>();
      for (const binding of patch.bindings) {
        const key = keyValue(binding.key);
        if (seen.has(key)) invalid(`重复文本键：${key}`); seen.add(key);
        const current = before.sources.find(source => source.sourceId === binding.sourceId);
        if (!current) invalid(`当前来源不存在：${binding.sourceId}`);
        const { path: _path, line: _line, sourceId: _id, ...source } = current;
        const existing = doc.entries.find(entry => entry.key === key);
        if (existing) existing.source = source;
        else doc.entries.push({ key, source, translations: {} });
      }
    } else if (patch.type === 'remove') {
      if (!Array.isArray(patch.keys) || !patch.keys.length || new Set(patch.keys).size !== patch.keys.length) invalid('移除键必须非空且不重复');
      for (const key of patch.keys) if (!doc.entries.some(entry => entry.key === key)) invalid(`文本键不存在：${key}`);
      doc.entries = doc.entries.filter(entry => !patch.keys.includes(entry.key));
    } else if (patch.type === 'import') {
      const preview = await previewTextCatalogImport(snapshot, hasher, patch.locale, patch.csv, assetFiles);
      if (preview.previewFingerprint !== patch.previewFingerprint) throw new AuthoringOperationError('OBJECT_REF_STALE', '导入预览已变化，请重新预览');
      if (!preview.ready) invalid(preview.issues.map(issue => `第 ${issue.line} 行 ${issue.key ?? ''}：${issue.message}`).join('\n'));
      for (const row of preview.rows) {
        const entry = doc.entries.find(entry => entry.key === row.key)!;
        if (row.voiceAction === 'bind') {
          entry.voices ??= {};
          entry.voices[patch.locale] = { asset: row.after, sourceVersion: entry.source.version, text: row.spokenText! };
        } else if (row.voiceAction === 'remove') {
          delete entry.voices?.[patch.locale];
          if (entry.voices && !Object.keys(entry.voices).length) delete entry.voices;
        } else if (row.voiceAction !== 'keep' && row.after) entry.translations[patch.locale] = { value: row.after, sourceVersion: entry.source.version };
      }
    } else invalid('未知译稿修改');
    const config = { ...snapshot.config, textCatalog: doc };
    readTextCatalog(config);
    const next = serializeProjectConfigDocument(config, files['game.config.json'] ?? '{}');
    return { workingFiles: { ...files, 'game.config.json': next }, result: { keys: doc.entries.map(entry => entry.key),
      fingerprint: await hasher.sha256(stableStringify(doc)), diffEntry: { kind: 'config.textCatalog.patch', operationId: input.operationId,
        fingerprintBefore: before.fingerprint, fingerprintAfter: await hasher.sha256(stableStringify(doc)),
        directChange: { path: 'game.config.json', type: patch.type }, potentialImpact: [], observedImpact: [] } } };
  });
}
