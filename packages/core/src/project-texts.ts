import { Lexer } from './dsl/lexer.js';
import { Parser } from './dsl/parser.js';
import type { AstBlock } from './dsl/ast.js';
import { collectInterpolatedVars } from './runtime/interpreter.js';
import { parseInlineText, type InlineTextContext } from './inline-text.js';
import { readProjectUi, type ProjectUiNode } from './project-ui.js';
import { parseTerminology } from './terminology-audit.js';
import { readGalleryDossiers } from './systems/gallery-dossiers.js';

interface TextSourceBase { speaker: string; text: string; version: string }
export interface StoryTextSource extends TextSourceBase {
  kind: 'dialogue' | 'choice'; sceneId: string; label: string | null; ordinal: number; sceneVersion: string;
}
export interface FieldTextSource extends TextSourceBase {
  kind: 'character' | 'ui' | 'term' | 'gallery'; objectRef: string; field?: 'tab' | 'title' | 'description';
}
export type TextSource = StoryTextSource | FieldTextSource;
export interface TextVoiceBinding { asset: string; sourceVersion: string; text: string }
export interface TextCatalogEntry {
  key: string; source: TextSource; translations: Record<string, { value: string; sourceVersion: string }>;
  voices?: Record<string, TextVoiceBinding>;
}
export interface TextCatalog { version: 1; sourceLocale: string; entries: TextCatalogEntry[] }
export type CatalogSource = TextSource & { sourceId: string; path: string; line: number };
export type CatalogSourceRow = (Omit<StoryTextSource, 'version'> | Omit<FieldTextSource, 'version'>) & { sourceId: string; path: string; line: number };
export interface TextSceneSource { id: string; path: string; text: string; sha256: string }

export class TextCatalogError extends Error {
  readonly code = 'TEXT_CATALOG_INVALID';
}
function invalid(message: string): never { throw new TextCatalogError(message); }
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
export function validateTextKey(value: unknown): string {
  const key = string(value, '文本键');
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_.:/-]{0,159}$/u.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid('文本键格式非法');
  return key;
}
export function isStoryTextSource<T extends { kind: string }>(source: T): source is Extract<T, { kind: 'dialogue' | 'choice' }> {
  return source.kind === 'dialogue' || source.kind === 'choice';
}
export function textSourceId(source: TextSource | CatalogSourceRow): string {
  return isStoryTextSource(source) ? JSON.stringify([source.sceneId, source.label, source.ordinal]) : JSON.stringify([source.kind, source.objectRef, ...(source.field ? [source.field] : [])]);
}
export function textSourceMatches(current: CatalogSourceRow | undefined, source: TextSource): boolean {
  return current !== undefined && current.kind === source.kind && current.text === source.text && current.speaker === source.speaker
    && (!isStoryTextSource(source) || (isStoryTextSource(current) && current.sceneVersion === source.sceneVersion));
}
export function textTranslationIssue(source: string, translated: string, context: InlineTextContext | 'plain' = 'dialogue'): string | undefined {
  if (JSON.stringify(collectInterpolatedVars(source).sort()) !== JSON.stringify(collectInterpolatedVars(translated).sort())) return '变量占位符必须与源文一致（含重复次数及转义）';
  return context === 'plain' ? undefined : parseInlineText(translated, context).issues.find(issue => issue.severity === 'error')?.message;
}
export function readTextCatalog(config: Record<string, unknown>): TextCatalog | null {
  if (config.textCatalog === undefined) return null;
  const doc = object(config.textCatalog, 'textCatalog');
  fields(doc, ['version', 'sourceLocale', 'entries'], 'textCatalog');
  if (doc.version !== 1 || !Array.isArray(doc.entries)) invalid('textCatalog 需要 version:1 和 entries 数组');
  const sourceLocale = validateTextLocale(doc.sourceLocale), keys = new Set<string>(), targets = new Set<string>();
  const entries = doc.entries.map(value => {
    const row = object(value, 'entry'); fields(row, ['key', 'source', 'translations', 'voices'], 'entry');
    const key = validateTextKey(row.key);
    if (keys.has(key)) invalid(`重复文本键：${key}`); keys.add(key);
    const src = object(row.source, `${key}.source`);
    const base = { speaker: string(src.speaker, 'speaker', true), text: string(src.text, 'text', true), version: version(src.version) };
    let source: TextSource;
    if (src.kind === 'dialogue' || src.kind === 'choice') {
      fields(src, ['sceneId', 'label', 'ordinal', 'sceneVersion', 'kind', 'speaker', 'text', 'version'], `${key}.source`);
      if (!Number.isSafeInteger(src.ordinal) || (src.ordinal as number) < 0) invalid(`${key} 来源序号非法`);
      source = { ...base, kind: src.kind, sceneId: string(src.sceneId, 'sceneId'), label: src.label === null ? null : string(src.label, 'label'), ordinal: src.ordinal as number, sceneVersion: version(src.sceneVersion) };
    } else if (src.kind === 'character' || src.kind === 'ui' || src.kind === 'term' || src.kind === 'gallery') {
      fields(src, ['kind', 'objectRef', 'field', 'speaker', 'text', 'version'], `${key}.source`);
      const objectRef = string(src.objectRef, 'objectRef');
      if (!objectRef.startsWith(`${src.kind}:`) || objectRef.length <= src.kind.length + 1 || base.speaker !== '') invalid(`${key} 展示来源非法`);
      if (src.kind === 'gallery' ? !/^gallery:(profiles|terms):.+$/.test(objectRef) || !['title', 'description'].includes(String(src.field))
        : src.field !== undefined && (src.kind !== 'ui' || src.field !== 'tab')) invalid(`${key} 展示字段非法`);
      source = { ...base, kind: src.kind, objectRef, ...(src.field === undefined ? {} : { field: src.field as FieldTextSource['field'] }) };
    } else invalid(`${key} 来源类型非法`);
    const target = textSourceId(source);
    if (targets.has(target)) invalid(`同一来源重复绑定：${target}`); targets.add(target);
    const translations = Object.fromEntries(Object.entries(object(row.translations, `${key}.translations`)).map(([locale, raw]) => {
      validateTextLocale(locale); if (locale === sourceLocale) invalid('译文语言不能等于源语言');
      const translation = object(raw, `${key}.${locale}`); fields(translation, ['value', 'sourceVersion'], `${key}.${locale}`);
      const result = { value: string(translation.value, `${key}.${locale}`, true), sourceVersion: version(translation.sourceVersion) };
      const problem = result.value && result.sourceVersion === source.version ? textTranslationIssue(source.text, result.value, isStoryTextSource(source) ? source.kind : 'plain') : undefined;
      if (problem) invalid(`${key}.${locale}：${problem}`);
      return [locale, result];
    }));
    const voices = row.voices === undefined ? undefined : Object.fromEntries(Object.entries(object(row.voices, `${key}.voices`)).map(([locale, raw]) => {
      validateTextLocale(locale);
      if (source.kind !== 'dialogue') invalid(`${key} 只有对白来源可以关联配音`);
      const binding = object(raw, `${key}.voices.${locale}`); fields(binding, ['asset', 'sourceVersion', 'text'], `${key}.voices.${locale}`);
      const asset = string(binding.asset, '配音素材键');
      if (asset !== asset.trim() || /[\\/:?#]/.test(asset) || asset === '.' || asset === '..') invalid(`${key} 配音需要项目素材键，不能是路径或网址`);
      return [locale, { asset, sourceVersion: version(binding.sourceVersion), text: string(binding.text, '确认台词', true) }];
    }));
    return { key, source, translations, ...(voices ? { voices } : {}) };
  });
  return { version: 1, sourceLocale, entries };
}

/** Raw words confirmed for this language; undefined means no current translation. */
export function textCatalogEntryText(entry: TextCatalogEntry, locale: string, sourceLocale: string): string | undefined {
  if (locale === sourceLocale) return entry.source.text;
  const translation = entry.translations[locale];
  return translation?.value && translation.sourceVersion === entry.source.version ? translation.value : undefined;
}

/** Authoring and playback share exact source coordinates; no fuzzy matching or translated identifiers. */
export function collectProjectTextRows(config: Record<string, unknown>, scenes: readonly TextSceneSource[], terminology?: unknown, gallery: Record<string, unknown> = {}): CatalogSourceRow[] {
  const out: CatalogSourceRow[] = [], identities = new Set<string>();
  const add = (source: CatalogSourceRow): void => {
    if (identities.has(source.sourceId)) invalid(`场景或标签重复，来源无法唯一定位：${source.sourceId}`);
    identities.add(source.sourceId); out.push(source);
  };
  for (const scene of scenes) {
    const rows: { kind: 'dialogue' | 'choice' | 'label'; speaker: string; text: string; line: number }[] = [];
    const visit = (blocks: readonly AstBlock[]): void => {
      for (const block of blocks) {
        if (block.kind === 'text') rows.push({ kind: 'dialogue', speaker: block.speaker ?? '', text: block.value, line: block.pos.line });
        else if (block.kind === 'label') rows.push({ kind: 'label', speaker: '', text: block.name, line: block.pos.line });
        else if (block.kind === 'choice') for (const option of block.options) rows.push({ kind: 'choice', speaker: '', text: option.label, line: option.pos.line });
        else if (block.kind === 'if') for (const branch of block.branches) visit(branch.blocks);
      }
    };
    visit(new Parser().parse(new Lexer().tokenize(scene.text, scene.path), scene.id).blocks);
    let label: string | null = null, ordinal = 0;
    for (const row of rows.sort((a, b) => a.line - b.line)) {
      if (row.kind === 'label') { label = row.text; ordinal = 0; continue; }
      const source = { sceneId: scene.id, label, ordinal: ordinal++, sceneVersion: scene.sha256, kind: row.kind, speaker: row.speaker, text: row.text };
      add({ ...source, sourceId: JSON.stringify([source.sceneId, source.label, source.ordinal]), path: scene.path, line: row.line });
    }
  }
  const field = (kind: FieldTextSource['kind'], id: string, text: string, path: string, displayField?: FieldTextSource['field']): void => {
    const objectRef = `${kind}:${id}`;
    add({ kind, objectRef, text, speaker: '', sourceId: JSON.stringify([kind, objectRef, ...(displayField ? [displayField] : [])]), ...(displayField ? { field: displayField } : {}), path, line: 1 });
  };
  for (const [id, value] of Object.entries(object(config.characters ?? {}, 'characters'))) {
    const character = object(value, `characters.${id}`);
    if (typeof character.name === 'string') field('character', id, character.name, 'game.config.json');
  }
  const visitUi = (node: ProjectUiNode): void => {
    if (node.text?.kind === 'literal') field('ui', node.id, node.text.value, 'game.config.json');
    if (node.type === 'tabs') {
      const names = new Set<string>();
      for (const child of node.children ?? []) if (child.tab && !names.has(child.tab)) {
        names.add(child.tab); field('ui', child.id, child.tab, 'game.config.json', 'tab');
      }
    }
    node.children?.forEach(visitUi);
  };
  Object.values(readProjectUi(config)?.pages ?? {}).forEach(visitUi);
  for (const term of parseTerminology(terminology)) field('term', term.canonical, term.canonical, 'content/config/terminology.json');
  const dossiers = readGalleryDossiers(gallery);
  for (const section of ['profiles', 'terms'] as const) for (const entry of dossiers[section]) {
    if (section === 'profiles' && typeof entry.title === 'string') field('gallery', `${section}:${entry.id}`, entry.title, 'content/config/gallery.json', 'title');
    if (entry.description !== undefined) field('gallery', `${section}:${entry.id}`, entry.description, 'content/config/gallery.json', 'description');
  }
  return out;
}

export async function projectTextSources(rows: readonly CatalogSourceRow[], sha256: (text: string) => Promise<string>): Promise<CatalogSource[]> {
  return Promise.all(rows.map(async row => ({ ...row, version: await sha256(JSON.stringify([row.kind, row.speaker, row.text])) })));
}

/** Immutable source/translation lookup. Locale stays in device settings, never in scene/save data. */
export function createProjectTextResolver(catalog: TextCatalog | null, sources: readonly CatalogSource[]) {
  const byId = new Map(sources.map(source => [source.sourceId, source]));
  const entries = new Map(catalog?.entries.map(entry => [textSourceId(entry.source), entry]));
  const sourceLocale = catalog?.sourceLocale ?? 'zh-CN';
  const locales = [...new Set([sourceLocale, ...(catalog?.entries.flatMap(entry => [...Object.keys(entry.translations), ...Object.keys(entry.voices ?? {})]) ?? [])])];
  const diagnostics = (locale: string): string[] => (catalog?.entries ?? []).flatMap(entry => {
    const source = byId.get(textSourceId(entry.source));
    if (!textSourceMatches(source, entry.source) || source?.version !== entry.source.version) return [`${entry.key}：来源变化，使用原文`];
    const voice = entry.voices?.[locale];
    const voiceIssues = voice && (voice.sourceVersion !== entry.source.version || voice.text !== textCatalogEntryText(entry, locale, sourceLocale))
      ? [`${entry.key}：配音对应台词已变化，暂不播放`] : [];
    if (locale === sourceLocale) return voiceIssues;
    const translation = entry.translations[locale];
    return [...voiceIssues, ...(!translation?.value || translation.sourceVersion !== entry.source.version ? [`${entry.key}：译文缺失或过期，使用原文`] : [])];
  });
  const resolve = (sourceId: string, original: string, locale: string): string => {
    if (locale === sourceLocale) return original;
    const source = byId.get(sourceId), entry = entries.get(sourceId), translation = entry?.translations[locale];
    return source?.text === original && entry && textSourceMatches(source, entry.source) && source.version === entry.source.version
      && translation?.value && translation.sourceVersion === source.version ? translation.value : original;
  };
  const story = new Map(sources.filter(isStoryTextSource).map(source => [JSON.stringify([source.sceneId, source.line, source.kind]), source]));
  return { sourceLocale, locales, diagnostics, resolve,
    field: (kind: FieldTextSource['kind'], objectRef: string, original: string, locale: string, field?: FieldTextSource['field']) => resolve(JSON.stringify([kind, objectRef, ...(field ? [field] : [])]), original, locale),
    story(sceneId: string, line: number, kind: 'dialogue' | 'choice', original: string, locale: string, sceneVersion: string): string {
      const source = story.get(JSON.stringify([sceneId, line, kind]));
      return source?.sceneVersion === sceneVersion ? resolve(source.sourceId, original, locale) : original;
    },
    voice(sceneId: string, line: number, original: string, locale: string, sceneVersion: string): string | null | undefined {
      const source = story.get(JSON.stringify([sceneId, line, 'dialogue']));
      const entry = source && entries.get(source.sourceId);
      if (!entry?.voices || !Object.keys(entry.voices).length) return undefined;
      const voice = entry.voices[locale];
      return source?.sceneVersion === sceneVersion && source.text === original && textSourceMatches(source, entry.source)
        && source.version === entry.source.version && voice?.sourceVersion === entry.source.version
        && voice.text === textCatalogEntryText(entry, locale, sourceLocale) ? voice.asset : null;
    },
  };
}
