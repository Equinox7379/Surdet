import { collectInterpolatedVars, Lexer, Parser, type AstBlock } from '@surdet/core';
import { AuthoringOperationError, runOperation, stableStringify, type ChangeSession } from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import { loadProjectSnapshot, type ProjectSnapshot } from './project-snapshot.js';
import type { TextHasher } from './project-storage.js';
import { csvRecords } from './script-import.js';

export interface TextSource {
  sceneId: string; label: string | null; ordinal: number; sceneVersion: string;
  kind: 'dialogue' | 'choice'; speaker: string; text: string; version: string;
}
export interface TextCatalogEntry { key: string; source: TextSource; translations: Record<string, { value: string; sourceVersion: string }> }
export interface TextCatalog { version: 1; sourceLocale: string; entries: TextCatalogEntry[] }
export interface CatalogSource extends TextSource { sourceId: string; path: string; line: number }
export type TextCatalogPatch =
  | { type: 'bind'; sourceLocale: string; bindings: { key: string; sourceId: string }[] }
  | { type: 'remove'; keys: string[] }
  | { type: 'import'; locale: string; csv: string; previewFingerprint: string };
export interface TextCatalogPatchInput { operationId: string; expectedRevision: string; expectedFingerprint: string; patch: TextCatalogPatch }

function invalid(message: string): never { throw new AuthoringOperationError('TEXT_CATALOG_INVALID', message); }
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} 必须是对象`);
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, names: string[], name: string): void {
  for (const key of Object.keys(value)) if (!names.includes(key)) invalid(`${name}.${key} 不受支持`);
}
function string(value: unknown, name: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.includes('\0')) invalid(`${name} 必须是${empty ? '' : '非空'}文字`);
  return value;
}
export function validateTextLocale(value: unknown): string {
  const locale = string(value, '语言');
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) invalid('语言请使用 zh-CN、ja、en 等标识');
  return locale;
}
function version(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid('来源版本必须是公开读取提供的 SHA-256');
  return value;
}
function keyValue(value: unknown): string {
  const key = string(value, '文本键');
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_.:/-]{0,159}$/u.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid('文本键格式非法');
  return key;
}
export function readTextCatalog(config: Record<string, unknown>): TextCatalog | null {
  if (config.textCatalog === undefined) return null;
  const doc = object(config.textCatalog, 'textCatalog');
  fields(doc, ['version', 'sourceLocale', 'entries'], 'textCatalog');
  if (doc.version !== 1 || !Array.isArray(doc.entries)) invalid('textCatalog 需要 version:1 和 entries 数组');
  const sourceLocale = validateTextLocale(doc.sourceLocale), keys = new Set<string>(), targets = new Set<string>();
  const entries = doc.entries.map(value => {
    const row = object(value, 'entry'); fields(row, ['key', 'source', 'translations'], 'entry');
    const key = keyValue(row.key);
    if (keys.has(key)) invalid(`重复文本键：${key}`); keys.add(key);
    const src = object(row.source, `${key}.source`);
    fields(src, ['sceneId', 'label', 'ordinal', 'sceneVersion', 'kind', 'speaker', 'text', 'version'], `${key}.source`);
    if (src.kind !== 'dialogue' && src.kind !== 'choice') invalid(`${key} 来源类型非法`);
    if (!Number.isSafeInteger(src.ordinal) || (src.ordinal as number) < 0) invalid(`${key} 来源序号非法`);
    const source: TextSource = { sceneId: string(src.sceneId, 'sceneId'), label: src.label === null ? null : string(src.label, 'label'),
      ordinal: src.ordinal as number, sceneVersion: version(src.sceneVersion), kind: src.kind,
      speaker: string(src.speaker, 'speaker', true), text: string(src.text, 'text', true), version: version(src.version) };
    const target = sourceId(source);
    if (targets.has(target)) invalid(`同一来源重复绑定：${target}`); targets.add(target);
    const translations = Object.fromEntries(Object.entries(object(row.translations, `${key}.translations`)).map(([locale, raw]) => {
      validateTextLocale(locale); if (locale === sourceLocale) invalid('译文语言不能等于源语言');
      const translation = object(raw, `${key}.${locale}`); fields(translation, ['value', 'sourceVersion'], `${key}.${locale}`);
      const result = { value: string(translation.value, `${key}.${locale}`, true), sourceVersion: version(translation.sourceVersion) };
      const problem = result.value && result.sourceVersion === source.version ? translationIssue(source.text, result.value) : undefined;
      if (problem) invalid(`${key}.${locale}：${problem}`);
      return [locale, result];
    }));
    return { key, source, translations };
  });
  return { version: 1, sourceLocale, entries };
}

function sourceId(source: Pick<TextSource, 'sceneId' | 'label' | 'ordinal'>): string {
  return JSON.stringify([source.sceneId, source.label, source.ordinal]);
}

/** Coordinates are usable only with the scene version that produced them. Never fuzzy-match prose. */
function collectTextSourceRows(snapshot: ProjectSnapshot): Omit<CatalogSource, 'version'>[] {
  const out: Omit<CatalogSource, 'version'>[] = [];
  const identities = new Set<string>();
  for (const scene of snapshot.scenes) {
    const rows: { kind: 'dialogue' | 'choice' | 'label'; speaker: string; text: string; line: number }[] = [];
    const visit = (blocks: readonly AstBlock[]): void => {
      for (const block of blocks) {
        if (block.kind === 'text') rows.push({ kind: 'dialogue', speaker: block.speaker ?? '', text: block.value, line: block.pos.line });
        else if (block.kind === 'label') rows.push({ kind: 'label', speaker: '', text: block.name, line: block.pos.line });
        else if (block.kind === 'choice') for (const option of block.options) rows.push({ kind: 'choice', speaker: '', text: option.label, line: option.pos.line });
        else if (block.kind === 'if') for (const branch of block.branches) visit(branch.blocks);
      }
    };
    visit(new Parser().parse(new Lexer().tokenize(scene.file.text, scene.path), scene.id).blocks);
    let label: string | null = null, ordinal = 0;
    for (const row of rows.sort((a, b) => a.line - b.line)) {
      if (row.kind === 'label') { label = row.text; ordinal = 0; continue; }
      const source = { sceneId: scene.id, label, ordinal: ordinal++, sceneVersion: scene.file.sha256,
        kind: row.kind, speaker: row.speaker, text: row.text };
      const id = sourceId(source);
      if (identities.has(id)) invalid(`场景或标签重复，来源无法唯一定位：${id}`);
      identities.add(id);
      out.push({ ...source, sourceId: id, path: scene.path, line: row.line });
    }
  }
  return out;
}
export async function collectTextSources(snapshot: ProjectSnapshot, hasher: TextHasher): Promise<CatalogSource[]> {
  return Promise.all(collectTextSourceRows(snapshot).map(async row => ({ ...row, version: await hasher.sha256(stableStringify([row.kind, row.speaker, row.text])) })));
}
function sourceMatches(current: Omit<CatalogSource, 'version'> | undefined, source: TextSource): boolean {
  return current !== undefined && (['sceneVersion', 'kind', 'speaker', 'text'] as const).every(field => current[field] === source[field]);
}
export function staleTextCatalogKeys(snapshot: ProjectSnapshot): string[] {
  const entries = readTextCatalog(snapshot.config)?.entries ?? [];
  if (!entries.length) return [];
  const current = new Map(collectTextSourceRows(snapshot).map(source => [source.sourceId, source]));
  return entries.filter(entry => !sourceMatches(current.get(sourceId(entry.source)), entry.source)).map(entry => entry.key);
}
export async function inspectTextCatalog(snapshot: ProjectSnapshot, hasher: TextHasher, locale = 'en') {
  validateTextLocale(locale);
  const value = readTextCatalog(snapshot.config);
  const sources = await collectTextSources(snapshot, hasher);
  const currentSources = new Map(sources.map(source => [source.sourceId, source]));
  return { revision: snapshot.revision, fingerprint: await hasher.sha256(stableStringify(value)), sourceLocale: value?.sourceLocale ?? null,
    sources, entries: (value?.entries ?? []).map(entry => {
      const current = currentSources.get(sourceId(entry.source));
      const matches = sourceMatches(current, entry.source) && current?.version === entry.source.version;
      return { ...entry, status: !matches ? 'needs-rebind' as const
        : !entry.translations[locale]?.value ? 'untranslated' as const
        : entry.translations[locale]!.sourceVersion !== entry.source.version ? 'needs-translation' as const : 'translated' as const };
    }), locale };
}

export function assertTextCatalogTargetRemovable(config: Record<string, unknown>, sceneId: string, label?: string): void {
  const references = readTextCatalog(config)?.entries.filter(entry => entry.source.sceneId === sceneId && (label === undefined || entry.source.label === label)) ?? [];
  if (references.length) throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', '文本目录仍引用该对象，请先显式移除或重新绑定文本键', { references: references.map(entry => `text-key:${entry.key}`) });
}
export function renameTextCatalogReferences(config: Record<string, unknown>, from: string, to: string, labelScene?: string): boolean {
  const doc = readTextCatalog(config); if (!doc) return false;
  let changed = false;
  for (const entry of doc.entries) {
    if (labelScene === undefined && entry.source.sceneId === from) { entry.source.sceneId = to; changed = true; }
    else if (labelScene !== undefined && entry.source.sceneId === labelScene && entry.source.label === from) { entry.source.label = to; changed = true; }
  }
  // Preserve source/translation versions. A changed scene requires explicit source confirmation.
  if (changed) config.textCatalog = doc;
  return changed;
}

export const TEXT_CSV_COLUMNS = ['key', 'locale', 'sourceVersion', 'speaker', 'context', 'source', 'translation', 'status'] as const;
function csvCell(value: string): string {
  const safe = /^(?:\s*[=+@-]|['\t\r\n])/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
function fromCell(value: string): string { return /^'(?:\s*[=+@-]|['\t\r\n])/.test(value) ? value.slice(1) : value; }
function contextText(source: TextSource): string { return JSON.stringify([source.sceneId, source.label, source.ordinal, source.kind]); }
export function exportTextCatalogCsv(inspection: Awaited<ReturnType<typeof inspectTextCatalog>>): string {
  return '\uFEFF' + [TEXT_CSV_COLUMNS.join(','), ...inspection.entries.map(entry => [entry.key, inspection.locale, entry.source.version,
    entry.source.speaker, contextText(entry.source), entry.source.text, entry.translations[inspection.locale]?.value ?? '', entry.status].map(csvCell).join(','))].join('\r\n') + '\r\n';
}
function translationIssue(source: string, translated: string): string | undefined {
  if (stableStringify(collectInterpolatedVars(source).sort()) !== stableStringify(collectInterpolatedVars(translated).sort())) return '变量占位符必须与源文一致（含重复次数及转义）';
  let open = -1, previousClose = -1;
  for (let i = 0; i < translated.length; i++) {
    if (translated[i] === '《') {
      if (open >= 0 || i === previousClose + 1) return 'Ruby 注音缺少主文字或发生嵌套';
      open = i;
    } else if (translated[i] === '》') {
      if (open < 0 || i === open + 1) return 'Ruby 注音未配对或为空';
      open = -1; previousClose = i;
    }
  }
  if (open >= 0) return 'Ruby 注音缺少闭合符号';
  return undefined;
}
export async function previewTextCatalogImport(snapshot: ProjectSnapshot, hasher: TextHasher, locale: string, csv: string) {
  const inspection = await inspectTextCatalog(snapshot, hasher, locale);
  const issues: { line: number; key?: string; message: string }[] = [];
  const rows: { line: number; key: string; source: string; before: string; after: string; changed: boolean }[] = [];
  const parsed = csvRecords(csv.replace(/^\uFEFF/, ''));
  issues.push(...parsed.issues.map(issue => ({ line: issue.line, message: issue.message })));
  if (csv.includes('\0')) issues.push({ line: 1, message: 'CSV 包含 NUL 字符' });
  if (stableStringify(parsed.records[0]?.cells) !== stableStringify(TEXT_CSV_COLUMNS)) issues.push({ line: 1, message: `CSV 表头必须为 ${TEXT_CSV_COLUMNS.join(',')}` });
  if (locale === inspection.sourceLocale) issues.push({ line: 1, message: '译文语言不能等于源语言' });
  const entries = new Map(inspection.entries.map(entry => [entry.key, entry])), seen = new Set<string>();
  for (const row of parsed.records.slice(1)) {
    const cells = row.cells.map(fromCell), key = cells[0] ?? '';
    const fail = (message: string): void => { issues.push({ line: row.line, key, message }); };
    if (cells.length !== TEXT_CSV_COLUMNS.length) { fail('列数与导出表头不一致'); continue; }
    if (seen.has(key)) { fail('文本键重复'); continue; } seen.add(key);
    const entry = entries.get(key);
    if (!entry) { fail('文本键未登记'); continue; }
    if (entry.status === 'needs-rebind') fail('源场景已变化，请先明确重新绑定该文本键');
    if (cells[1] !== locale) fail('译文语言与本次导入语言不一致');
    if (cells[2] !== entry.source.version || cells[3] !== entry.source.speaker || cells[4] !== contextText(entry.source) || cells[5] !== entry.source.text) fail('源文版本/说话人/上下文不匹配，请重新导出');
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
    previewFingerprint: await hasher.sha256(stableStringify({ revision: inspection.revision, fingerprint: inspection.fingerprint, locale, csv })) };
}

export async function applyTextCatalogPatch(change: ChangeSession, input: TextCatalogPatchInput, hasher: TextHasher) {
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
      const preview = await previewTextCatalogImport(snapshot, hasher, patch.locale, patch.csv);
      if (preview.previewFingerprint !== patch.previewFingerprint) throw new AuthoringOperationError('OBJECT_REF_STALE', '导入预览已变化，请重新预览');
      if (!preview.ready) invalid(preview.issues.map(issue => `第 ${issue.line} 行 ${issue.key ?? ''}：${issue.message}`).join('\n'));
      for (const row of preview.rows) if (row.after) {
        const entry = doc.entries.find(entry => entry.key === row.key)!;
        entry.translations[patch.locale] = { value: row.after, sourceVersion: entry.source.version };
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
