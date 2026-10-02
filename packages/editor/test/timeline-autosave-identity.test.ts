/**
 * Timeline autosave triple-identity adapter: pure contract tests written RED-first.
 * The implementation is intentionally supplied by a later task.
 */
import { describe, expect, it } from 'vitest';
import {
  inspectTimelineAutosaveIdentity,
  normalizeTimelineAutosaveDocument,
  type TimelineAutosaveDocument,
} from '../src/timeline-autosave-identity.js';

type Eol = '\r\n' | '\n';

function stringifyWithEol(value: unknown, eol: Eol): string {
  return `${JSON.stringify(value, null, 2).replace(/\n/g, eol)}${eol}`;
}

function entry(overrides: Partial<TimelineAutosaveDocument> = {}): TimelineAutosaveDocument {
  return {
    id: 'intro',
    file: 'nested/intro.json',
    text: stringifyWithEol({ version: 1, id: 'intro', durationMs: 100, tracks: [] }, '\n'),
    eol: '\n',
    ...overrides,
  };
}

describe('inspectTimelineAutosaveIdentity（时间轴三元身份投影）', () => {
  it.each(['JSON', 'JsOn'])('保留已支持的 .%s 文件及其 Authoring canonical ID', (extension) => {
    // Authoring currently retains a non-lowercase extension in the ID.
    const id = `intro.${extension}`;
    const source = entry({ id, file: `nested/intro.${extension}`, text: JSON.stringify({ id, version: 1, durationMs: 100, tracks: [] }) });
    const before = { ...source };
    expect(inspectTimelineAutosaveIdentity(source)).toMatchObject({ fileId: id, definitionId: id, canonical: true });
    const normalized = normalizeTimelineAutosaveDocument(source, id, source.file);
    expect(normalized).toMatchObject({ ok: true, entry: { id, file: source.file } });
    expect(source).toEqual(before);
  });

  it('从 canonical nested path、外层 id 和内部 id 得出 canonical 身份', () => {
    const source = entry();
    const before = { ...source };

    expect(inspectTimelineAutosaveIdentity(source)).toEqual({
      stableId: 'intro',
      file: 'nested/intro.json',
      fileId: 'intro',
      definitionId: 'intro',
      parseError: null,
      canonical: true,
    });
    expect(source).toEqual(before);
  });

  it('同一文件但外层 stable id 不同则 fail-closed', () => {
    expect(inspectTimelineAutosaveIdentity(entry({ id: 'other' }))).toMatchObject({
      stableId: 'other',
      fileId: 'intro',
      definitionId: 'intro',
      canonical: false,
    });
  });

  it('同一 stable id 但文件名不同则 fail-closed', () => {
    expect(inspectTimelineAutosaveIdentity(entry({ file: 'nested/other.json' }))).toMatchObject({
      stableId: 'intro',
      fileId: 'other',
      definitionId: 'intro',
      canonical: false,
    });
  });

  it('外层 id 与文件名匹配但内部 definition.id 不同则 fail-closed', () => {
    const source = entry({
      text: stringifyWithEol({ version: 1, id: 'other', durationMs: 100, tracks: [] }, '\n'),
    });

    expect(inspectTimelineAutosaveIdentity(source)).toMatchObject({
      stableId: 'intro',
      fileId: 'intro',
      definitionId: 'other',
      canonical: false,
    });
  });

  it('invalid JSON 保留可诊断的 parseError，不把条目误判为 canonical', () => {
    expect(inspectTimelineAutosaveIdentity(entry({ text: '{"id":' }))).toMatchObject({
      fileId: 'intro',
      definitionId: null,
      canonical: false,
      parseError: expect.any(String),
    });
  });

  it.each([
    ['缺少 id', { version: 1 }],
    ['id 不是字符串', { id: 42 }],
    ['id 为空字符串', { id: '' }],
  ])('%s 时 definitionId 为 null', (_label, definition) => {
    expect(inspectTimelineAutosaveIdentity(entry({ text: JSON.stringify(definition) }))).toMatchObject({
      definitionId: null,
      parseError: null,
      canonical: false,
    });
  });

  it('解析前只移除一个可选 BOM', () => {
    const source = entry({ text: `\uFEFF${JSON.stringify({ id: 'intro' })}` });

    expect(inspectTimelineAutosaveIdentity(source)).toMatchObject({
      definitionId: 'intro',
      parseError: null,
      canonical: true,
    });
    expect(source.text.startsWith('\uFEFF')).toBe(true);
  });

  it.each([
    '../intro.json',
    '/intro.json',
    'C:/intro.json',
    'content/timelines/intro.json',
    'nested//intro.json',
    './intro.json',
  ])('拒绝不安全或非规范的备份相对路径 %j', (file) => {
    expect(inspectTimelineAutosaveIdentity(entry({ file }))).toMatchObject({
      fileId: 'intro',
      definitionId: 'intro',
      canonical: false,
    });
  });

  it('即使三处字面相同也拒绝不符合 Authoring 规则的 stable ID', () => {
    expect(inspectTimelineAutosaveIdentity(entry({
      id: 'bad:id',
      file: 'bad:id.json',
      text: stringifyWithEol({ id: 'bad:id', tracks: [] }, '\n'),
    }))).toMatchObject({
      stableId: 'bad:id',
      fileId: 'bad:id',
      definitionId: 'bad:id',
      canonical: false,
    });
  });
});

describe('normalizeTimelineAutosaveDocument（显式身份修复准备）', () => {
  it('接受合法新 ID，默认生成 basename 文件并保留 LF 与所有非 ID 字段', () => {
    const definition = {
      version: 1,
      id: 'intro',
      durationMs: 100,
      tracks: [{ kind: 'screen', cues: [{ atMs: 0, action: 'fade', alpha: 1 }] }],
      metadata: { author: 'surdet', tags: ['opening', 'nested'] },
      nullable: null,
    };
    const source = entry({ text: stringifyWithEol(definition, '\n'), eol: '\n' });
    const before = { ...source };

    const result = normalizeTimelineAutosaveDocument(source, 'new_id-2.v1');
    expect(result).toMatchObject({
      ok: true,
      entry: { id: 'new_id-2.v1', file: 'new_id-2.v1.json', eol: '\n' },
    });
    if (!result.ok) throw new Error(result.error);

    expect(JSON.parse(result.entry.text)).toEqual({ ...definition, id: 'new_id-2.v1' });
    expect(result.entry.text).toBe(`${JSON.stringify({ ...definition, id: 'new_id-2.v1' }, null, 2)}\n`);
    expect(source).toEqual(before);
  });

  it('移除 BOM 后按 source.eol 规范化为 CRLF，并只保留一个结尾 EOL', () => {
    const definition = { version: 1, id: 'intro', durationMs: 100, tracks: [] };
    const source = entry({
      text: `\uFEFF${stringifyWithEol(definition, '\r\n')}`,
      eol: '\r\n',
    });

    const result = normalizeTimelineAutosaveDocument(source, 'recovered');
    expect(result).toMatchObject({ ok: true, entry: { id: 'recovered', file: 'recovered.json', eol: '\r\n' } });
    if (!result.ok) throw new Error(result.error);

    expect(JSON.parse(result.entry.text)).toEqual({ ...definition, id: 'recovered' });
    expect(result.entry.text.endsWith('\r\n')).toBe(true);
    expect(result.entry.text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(result.entry.text.endsWith('\r\n\r\n')).toBe(false);
    expect(source.text.startsWith('\uFEFF')).toBe(true);
  });

  it('可显式指定 canonical nested target file，并保持 source 不变', () => {
    const source = entry();
    const before = { ...source };

    const result = normalizeTimelineAutosaveDocument(source, 'recovered', 'nested/recovered.json');
    expect(result).toMatchObject({
      ok: true,
      entry: { id: 'recovered', file: 'nested/recovered.json', eol: source.eol },
    });
    if (!result.ok) throw new Error(result.error);

    expect(inspectTimelineAutosaveIdentity(result.entry).canonical).toBe(true);
    expect(source).toEqual(before);
  });

  it.each(['', 'bad id', '../escape', 'nested/escape', '中文'])('拒绝非法新 ID %j 且不产生 output', (targetId) => {
    const source = entry();
    const before = { ...source };

    const result = normalizeTimelineAutosaveDocument(source, targetId);
    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    if (result.ok) throw new Error('非法 targetId 不应产生规范化条目');
    expect(source).toEqual(before);
  });

  it.each([
    ['missing id', '{"version":1}', { version: 1, id: 'recovered' }],
    ['non-string id', '{"id":42,"version":1}', { id: 'recovered', version: 1 }],
    ['empty id', '{"id":"","version":1}', { id: 'recovered', version: 1 }],
  ])('可显式修复 %s 的可解析对象', (_label, text, expected) => {
    const source = entry({ text });
    const result = normalizeTimelineAutosaveDocument(source, 'recovered');
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(JSON.parse(result.entry.text)).toEqual(expected);
  });

  it.each([
    ['invalid JSON', '{"id":'],
    ['array root', '[]'],
    ['null root', 'null'],
    ['scalar root', '42'],
  ])('拒绝 %s，且不修改 source', (_label, text) => {
    const source = entry({ text });
    const before = { ...source };

    const result = normalizeTimelineAutosaveDocument(source, 'recovered');
    expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    if (result.ok) throw new Error('不可证明 canonical 身份的正文不应被规范化');
    expect(source).toEqual(before);
  });
});
