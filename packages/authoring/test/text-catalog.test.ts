import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginChange, InMemoryChangeRepository } from '../src/change-session.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { applyTextCatalogPatch, collectTextSources, exportTextCatalogCsv, inspectTextCatalog, previewTextCatalogImport, readTextCatalog, renameTextCatalogReferences, assertTextCatalogTargetRemovable, TEXT_CSV_COLUMNS, type TextCatalogPatch } from '../src/text-catalog.js';
import { csvRecords } from '../src/script-import.js';
import { buildObjectIndex } from '../src/object-index.js';
import { validateSnapshot } from '../src/validation.js';
import { buildReplayStateBaseObjects } from '../src/composition-object-facts.js';
import { fingerprintWorkingObjectValue } from '../src/working-object-fingerprint.js';

const hasher = { sha256: async (text: string) => createHash('sha256').update(text).digest('hex') };
const scene = '@scene intro\n@label greeting\n旁白：你好，{name}。\n旁白：你好，{name}。\n@choice\n  去看海 [if: true] -> @goto finish\n  回家 -> @goto finish\n@label finish\n旁白：结束。\n@end\n';
async function snapshot(files: Record<string, string>) {
  return loadProjectSnapshot({ rootIdentity: 'texts', listFiles: async () => Object.keys(files), exists: async path => path in files,
    readText: async path => ({ path, text: files[path]!, bytes: Buffer.byteLength(files[path]!), sha256: await hasher.sha256(files[path]!) }) }, hasher);
}
async function fixture() {
  const files = { 'game.config.json': JSON.stringify({ entryScene: 'intro', future: 9, variables: { name: { type: 'string', initial: '凛' } } }), 'content/scenario/intro.gal': scene };
  const base = await snapshot(files), change = await beginChange(base, new InMemoryChangeRepository());
  change.record.composition!.mode = 'direct';
  let next = 0;
  const inspect = async () => inspectTextCatalog(await snapshot(change.record.workingFiles), hasher);
  const apply = async (patch: TextCatalogPatch) => { const view = await inspect(); return applyTextCatalogPatch(change, { operationId: `text-${next++}`, expectedRevision: view.revision, expectedFingerprint: view.fingerprint, patch }, hasher); };
  const bind = async () => { const view = await inspect(); await apply({ type: 'bind', sourceLocale: 'zh-CN', bindings: view.sources.map((source, index) => ({ key: `line.${index}`, sourceId: source.sourceId })) }); };
  const csv = async (mutate: (cells: string[][]) => void = () => {}) => {
    const rows = csvRecords(exportTextCatalogCsv(await inspect()).replace(/^\uFEFF/, '')).records.map(row => row.cells);
    mutate(rows);
    return rows.map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
  };
  return { base, change, inspect, apply, bind, csv };
}

describe('text catalog authoring', () => {
  it('binds character, literal UI/tab and terminology fields through the same guarded CSV and object index', async () => {
    const f = await fixture();
    const config = JSON.parse(f.change.record.workingFiles['game.config.json']!);
    config.characters = { rin: { name: '凛' } };
    const frame = { x: 0, y: 0, width: 200, height: 100 };
    config.ui = { version: 1, pages: { gallery: { id: 'tabs', type: 'tabs', frame, children: [
      { id: 'names', type: 'text', frame, tab: '名词', text: { kind: 'literal', value: '雾港词条' } },
    ] } } };
    f.change.record.workingFiles['game.config.json'] = JSON.stringify(config);
    f.change.record.workingFiles['content/config/terminology.json'] = '{"terms":[{"canonical":"雾港","variants":[]}]}';
    const view = await f.inspect();
    const fields = view.sources.filter(source => ['character', 'ui', 'term'].includes(source.kind));
    expect(fields).toHaveLength(4);
    await f.apply({ type: 'bind', sourceLocale: 'zh-CN', bindings: fields.map((source, i) => ({ key: `field.${i}`, sourceId: source.sourceId })) });
    const csv = await f.csv(rows => { for (const row of rows.slice(1)) row[6] = `EN ${row[5]}`; });
    const preview = await previewTextCatalogImport(await snapshot(f.change.record.workingFiles), hasher, 'en', csv);
    expect(preview.ready).toBe(true);
    await f.apply({ type: 'import', locale: 'en', csv, previewFingerprint: preview.previewFingerprint });
    expect((await f.inspect()).entries.every(entry => entry.status === 'translated')).toBe(true);
    const index = buildObjectIndex(await snapshot(f.change.record.workingFiles));
    expect(index.byRef.get('text-key:field.0')!.references).toContain('character:rin');
    expect(index.byRef.get('term:雾港')!.referencedBy).toContain('text-key:field.3');
    const changed = JSON.parse(f.change.record.workingFiles['game.config.json']!); changed.characters.rin.name = '铃';
    f.change.record.workingFiles['game.config.json'] = JSON.stringify(changed);
    expect((await f.inspect()).entries[0]!.status).toBe('needs-rebind');
    expect((await f.inspect()).entries[0]!.translations.en!.value).toBe('EN 凛');
    expect((await previewTextCatalogImport(await snapshot(f.change.record.workingFiles), hasher, 'en', csv)).ready).toBe(false);
  });
  it('diagnoses hand-edited source metadata and malformed current translations instead of reporting them translated', async () => {
    const f = await fixture(); await f.bind();
    const config = JSON.parse(f.change.record.workingFiles['game.config.json']!);
    const entry = config.textCatalog.entries[0];
    entry.translations.en = { value: 'Hello {name}', sourceVersion: entry.source.version };
    entry.source.speaker = 'not the source speaker';
    f.change.record.workingFiles['game.config.json'] = JSON.stringify(config);
    expect((await f.inspect()).entries[0]!.status).toBe('needs-rebind');
    const current = await snapshot(f.change.record.workingFiles);
    expect(validateSnapshot(current, buildObjectIndex(current)).issues).toContainEqual(expect.objectContaining({ code: 'TEXT_SOURCE_STALE' }));
    entry.translations.en.value = 'lost placeholder';
    expect(() => readTextCatalog(config)).toThrow('占位符');
  });
  it('enrolls duplicate prose and conditional choices as distinct explicit keys without touching scripts', async () => {
    const f = await fixture(); await f.bind();
    const view = await f.inspect();
    expect(view.entries).toHaveLength(5);
    expect(view.sources.slice(0, 2).map(source => source.text)).toEqual(['你好，{name}。', '你好，{name}。']);
    expect(new Set(view.sources.map(source => source.sourceId)).size).toBe(5);
    expect(view.sources[2]).toMatchObject({ kind: 'choice', text: '去看海', label: 'greeting', ordinal: 2 });
    expect(f.change.record.workingFiles['content/scenario/intro.gal']).toBe(scene);
    expect(f.base.config.textCatalog).toBeUndefined();
    expect(JSON.parse(f.change.record.workingFiles['game.config.json']!).future).toBe(9);
    const index = buildObjectIndex(await snapshot(f.change.record.workingFiles));
    expect(index.byRef.get('label:intro.greeting')?.referencedBy).toContain('text-key:line.0');
  });

  it('previews and imports CSV losslessly with quotes, newlines and spreadsheet prefixes, then rejects a stale preview', async () => {
    const f = await fixture(); await f.bind();
    const csv = await f.csv(rows => { rows[1]![6] = 'Hello, "{name}".\nAgain'; rows[2]![6] = "'=SUM(1,2) {name}"; });
    const before = JSON.stringify(f.change.record), snap = await snapshot(f.change.record.workingFiles);
    const preview = await previewTextCatalogImport(snap, hasher, 'en', csv);
    expect(preview.ready).toBe(true); expect(preview.rows.filter(row => row.changed)).toHaveLength(2);
    expect(JSON.stringify(f.change.record)).toBe(before);
    await f.apply({ type: 'import', locale: 'en', csv, previewFingerprint: preview.previewFingerprint });
    expect((await f.inspect()).entries[0]).toMatchObject({ status: 'translated', translations: { en: { value: 'Hello, "{name}".\nAgain' } } });
    const exported = exportTextCatalogCsv(await f.inspect());
    expect(exported).toContain("'=SUM(1,2) {name}");
    expect((await previewTextCatalogImport(await snapshot(f.change.record.workingFiles), hasher, 'en', exported)).rows.some(row => row.changed)).toBe(false);
    const saved = JSON.stringify(f.change.record);
    await expect(f.apply({ type: 'import', locale: 'en', csv, previewFingerprint: preview.previewFingerprint })).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(JSON.stringify(f.change.record)).toBe(saved);
  });

  it.each(['missing', 'duplicate', 'unknown', 'source', 'locale', 'placeholder', 'ruby', 'quote'] as const)('rejects the complete import atomically: %s', async kind => {
    const f = await fixture(); await f.bind();
    let csv = await f.csv(rows => {
      if (kind === 'missing') rows.pop();
      if (kind === 'duplicate') rows.push([...rows[1]!]);
      if (kind === 'unknown') rows[1]![0] = 'unknown';
      if (kind === 'source') rows[1]![5] = 'wrong';
      if (kind === 'locale') rows[1]![1] = 'ja';
      if (kind === 'placeholder') rows[1]![6] = 'Hello';
      if (kind === 'ruby') rows[1]![6] = 'Hello {name} 世《せ';
    });
    if (kind === 'quote') csv += '\n"unterminated';
    const before = JSON.stringify(f.change.record), preview = await previewTextCatalogImport(await snapshot(f.change.record.workingFiles), hasher, 'en', csv);
    expect(preview.ready).toBe(false); expect(preview.issues.length).toBeGreaterThan(0);
    await expect(f.apply({ type: 'import', locale: 'en', csv, previewFingerprint: preview.previewFingerprint })).rejects.toMatchObject({ code: 'TEXT_CATALOG_INVALID' });
    expect(JSON.stringify(f.change.record)).toBe(before);
  });

  it('preserves old translations after insertion/deletion/reorder and only rebinds by an explicit current source selection', async () => {
    const f = await fixture(); await f.bind();
    const csv = await f.csv(rows => { rows[1]![6] = 'Hello {name}'; });
    const preview = await previewTextCatalogImport(await snapshot(f.change.record.workingFiles), hasher, 'en', csv);
    await f.apply({ type: 'import', locale: 'en', csv, previewFingerprint: preview.previewFingerprint });
    const catalog = JSON.parse(f.change.record.workingFiles['game.config.json']!).textCatalog;
    for (const changed of [scene.replace('旁白：你好', '旁白：新句。\n旁白：你好'), scene.replace('旁白：你好，{name}。\n', ''), scene.replace('  去看海 [if: true] -> @goto finish\n  回家', '  回家 -> @goto finish\n  去看海 [if: true]')]) {
      f.change.record.workingFiles['content/scenario/intro.gal'] = changed;
      const view = await f.inspect(); expect(view.entries.every(entry => entry.status === 'needs-rebind')).toBe(true);
      expect(JSON.parse(f.change.record.workingFiles['game.config.json']!).textCatalog).toEqual(catalog);
      expect((await previewTextCatalogImport(await snapshot(f.change.record.workingFiles), hasher, 'en', csv)).ready).toBe(false);
    }
    f.change.record.workingFiles['content/scenario/intro.gal'] = scene.replaceAll('你好', '再见');
    const current = await f.inspect();
    await f.apply({ type: 'bind', sourceLocale: 'zh-CN', bindings: [{ key: 'line.0', sourceId: current.sources[0]!.sourceId }] });
    expect((await f.inspect()).entries[0]).toMatchObject({ status: 'needs-translation', translations: { en: { value: 'Hello {name}' } } });
    const refreshed = await f.csv(rows => { rows[1]![6] = 'Goodbye {name}'; });
    // Other old mappings still require confirmation; do not silently accept partial refresh.
    expect((await previewTextCatalogImport(await snapshot(f.change.record.workingFiles), hasher, 'en', refreshed)).ready).toBe(false);
    const issues = validateSnapshot(await snapshot(f.change.record.workingFiles), buildObjectIndex(await snapshot(f.change.record.workingFiles))).issues;
    expect(issues.some(issue => issue.code === 'TEXT_SOURCE_STALE')).toBe(true);
  });

  it('retains stable identities across file moves, rewrites named references, and refuses referenced deletion', async () => {
    const f = await fixture(); await f.bind();
    f.change.record.workingFiles['content/scenario/chapter/intro.gal'] = scene;
    delete f.change.record.workingFiles['content/scenario/intro.gal'];
    expect((await f.inspect()).entries.every(entry => entry.status === 'untranslated')).toBe(true);
    const config = JSON.parse(f.change.record.workingFiles['game.config.json']!);
    expect(() => assertTextCatalogTargetRemovable(config, 'intro', 'greeting')).toThrow('仍引用');
    expect(renameTextCatalogReferences(config, 'greeting', 'hello', 'intro')).toBe(true);
    expect(renameTextCatalogReferences(config, 'intro', 'chapter1')).toBe(true);
    expect(readTextCatalog(config)!.entries[0]!.source).toMatchObject({ sceneId: 'chapter1', label: 'hello' });
    expect(readTextCatalog(config)!.entries[0]!.key).toBe('line.0');
  });

  it('seals the configuration fingerprint and protects direct-only writes and operation retries', async () => {
    const f = await fixture(), view = await f.inspect();
    const input = { operationId: 'fixed', expectedRevision: view.revision, expectedFingerprint: view.fingerprint,
      patch: { type: 'bind' as const, sourceLocale: 'zh-CN', bindings: [{ key: 'hello', sourceId: view.sources[0]!.sourceId }] } };
    for (const mode of ['candidate', 'integration']) {
      f.change.record.composition!.mode = mode === 'candidate' ? 'candidate' : 'direct';
      if (mode === 'integration') f.change.record.integration = {} as NonNullable<typeof f.change.record.integration>;
      const before = JSON.stringify(f.change.record);
      await expect(applyTextCatalogPatch(f.change, input, hasher)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
      expect(JSON.stringify(f.change.record)).toBe(before);
    }
    delete f.change.record.integration;
    const result = await applyTextCatalogPatch(f.change, input, hasher);
    expect(await applyTextCatalogPatch(f.change, input, hasher)).toEqual(result);
    await expect(applyTextCatalogPatch(f.change, { ...input, patch: { type: 'remove', keys: ['hello'] } }, hasher)).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
    const snap = await snapshot(f.change.record.workingFiles), facts = await buildReplayStateBaseObjects(snap, hasher);
    const fact = facts.find(fact => fact.objectRef === 'config:textCatalog');
    expect(fact?.expectedFingerprint).toBe((await f.inspect()).fingerprint);
    expect(await fingerprintWorkingObjectValue(f.change.record.workingFiles, 'config:textCatalog', hasher)).toBe(fact?.expectedFingerprint);
    expect(TEXT_CSV_COLUMNS).toContain('sourceVersion');
    expect(await collectTextSources(snap, hasher)).toHaveLength(5);
  });
});
