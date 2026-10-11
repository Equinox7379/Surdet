import { describe, expect, it } from 'vitest';
import {
  insertLinesAfter,
  parseSceneDocument,
  parseSceneLine,
  parseSceneStructure,
  rewriteInstructionArgumentsRaw,
  serializeSceneDocument,
  splitInstruction,
} from '../src/scene-document.js';

describe('scene document EOL identity', () => {
  it('roundtrips mixed LF/CRLF byte-for-byte', () => {
    const source = '@scene mixed\r\n凛：第一行\n凛：第二行\r\n@end';
    expect(serializeSceneDocument(parseSceneDocument(source), '\n')).toBe(source);
  });

  it.each(['\u2028', '\u2029'])('preserves a non-CR/LF separator %j as raw source content', (separator) => {
    for (const raw of [`林汀：前半句${separator}后半句`, `林汀：末尾保留${separator}`, separator]) {
      const lines = parseSceneDocument(raw);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.raw).toBe(raw);
      expect(serializeSceneDocument(lines, '\n')).toBe(raw);
    }
    const source = `@scene mixed\r\n林汀：前半句${separator}后半句\n周渡：灯塔还亮着。\r@end`;
    const lines = parseSceneDocument(source);
    expect(lines).toHaveLength(4);
    expect(lines.map(line => line.eol)).toEqual(['\r\n', '\n', '\r', '']);
    expect(serializeSceneDocument(lines, '\n')).toBe(source);
  });

  it('inserts with the anchor EOL without changing unrelated delimiters', () => {
    const source = '@scene mixed\r\n凛：第一行\n@end';
    const next = insertLinesAfter(parseSceneDocument(source), 1, [{ kind: 'text', speaker: '凛', value: '新增', raw: '凛：新增' }]);
    expect(serializeSceneDocument(next, '\n')).toBe('@scene mixed\r\n凛：第一行\n凛：新增\n@end');
  });
  it.each(['\n', '\r\n', '\r'] as const)('preserves a final %j when appending one or multiple lines', eol => {
    const source = `@scene intro${eol}凛：开场。${eol}`;
    const lines = parseSceneDocument(source);
    const blocks = [{ kind: 'instr' as const, name: 'jump', args: ['home'], raw: '@jump home' }];
    expect(serializeSceneDocument(insertLinesAfter(lines, lines.length - 1, blocks))).toBe(source + `@jump home${eol}`);
    expect(serializeSceneDocument(insertLinesAfter(lines, lines.length - 1, [...blocks, { kind: 'comment', raw: '// 后记' }]))).toBe(source + `@jump home${eol}// 后记${eol}`);
    expect(serializeSceneDocument(lines)).toBe(source);
  });
  it.each(['\n', '\r\n', '\r'] as const)('does not create a final newline when appending to an unterminated %j document', eol => {
    const source = `\uFEFF@scene intro${eol}凛：开场。`;
    const next = insertLinesAfter(parseSceneDocument(source), 1, [{ kind: 'instr', name: 'jump', args: ['home'], raw: '@jump home' }]);
    expect(serializeSceneDocument(next)).toBe(source + `${eol}@jump home`);
  });
  it('keeps an existing mixed-EOL final delimiter and existing trailing blank lines', () => {
    const source = '@scene intro\r\n凛：开场。\n\n';
    const lines = parseSceneDocument(source);
    const next = insertLinesAfter(lines, lines.length - 1, [{ kind: 'comment', raw: '// 后记' }]);
    expect(serializeSceneDocument(next)).toBe(source + '// 后记\n');
    expect(serializeSceneDocument(insertLinesAfter([], -1, [{ kind: 'text', speaker: '', value: '新稿', raw: '新稿' }]))).toBe('新稿');
  });
});

describe('instruction argument edits preserve modifiers', () => {
  it('keeps modifier sections out of positional args and inserts a missing argument before them', () => {
    expect(splitInstruction('@show lynn @ left')).toEqual({ name: 'show', args: ['lynn'] });
    expect(rewriteInstructionArgumentsRaw('@show lynn @ left', new Map([
      [0, 'rin:casual'],
      [1, 'smile'],
    ]))).toBe('@show rin:casual smile @ left');
  });

  it('does not split an at-sign inside a quoted argument', () => {
    expect(splitInstruction('@custom "x@y.com" @ mode strict')).toEqual({ name: 'custom', args: ['"x@y.com"'] });
  });
});

describe('URL-leading text is not a speaker line (N2)', () => {
  it.each([
    'https://example.com/story',
    'http://example.com/story',
    'ftp://example.com/story',
    'custom+proto://host',
  ])('%s parses as plain text with no speaker', (line) => {
    const parsed = parseSceneLine(line, '');
    expect(parsed.kind).toBe('text');
    expect(parsed.kind === 'text' ? parsed.speaker : undefined).toBe('');
    expect(parsed.kind === 'text' ? parsed.value : undefined).toBe(line);
  });

  it('normal speaker control still extracts speaker', () => {
    const parsed = parseSceneLine('旁白：你好', '');
    expect(parsed.kind).toBe('text');
    expect(parsed.kind === 'text' ? parsed.speaker : undefined).toBe('旁白');
    expect(parsed.kind === 'text' ? parsed.value : undefined).toBe('你好');
    expect(parsed.kind === 'text' ? parsed.sep : undefined).toBe('：');
  });

  it('single-slash dialogue after colon is not a URL scheme', () => {
    const parsed = parseSceneLine('旁白：/远处钟声/', '');
    expect(parsed.kind).toBe('text');
    expect(parsed.kind === 'text' ? parsed.speaker : undefined).toBe('旁白');
    expect(parsed.kind === 'text' ? parsed.value : undefined).toBe('/远处钟声/');
  });

  it('numeric time has no speaker', () => {
    const parsed = parseSceneLine('12:30', '');
    expect(parsed.kind).toBe('text');
    expect(parsed.kind === 'text' ? parsed.speaker : undefined).toBe('');
    expect(parsed.kind === 'text' ? parsed.value : undefined).toBe('12:30');
  });

  it('half-width colon speaker keeps shared semantics', () => {
    const parsed = parseSceneLine('注意:这里有内容', '');
    expect(parsed.kind).toBe('text');
    expect(parsed.kind === 'text' ? parsed.speaker : undefined).toBe('注意');
    expect(parsed.kind === 'text' ? parsed.value : undefined).toBe('这里有内容');
    expect(parsed.kind === 'text' ? parsed.sep : undefined).toBe(':');
  });
});

describe('URL line raw roundtrip (N2)', () => {
  it('parse → serialize preserves URL lines byte-for-byte', () => {
    const source = '@scene s\r\nhttps://example.com/story\nhttp://example.com/story\r\n@end';
    expect(serializeSceneDocument(parseSceneDocument(source), '\n')).toBe(source);
  });
});

describe('Core-backed scene structure facts', () => {
  it('exposes paired nested condition and choice ranges without guessing a later endif', () => {
    const source = [
      '@scene s',
      '@if outer',
      '// keep outer comment',
      'A',
      '@if inner',
      'B',
      '@else',
      'C',
      '@endif',
      '@elif fallback',
      'D',
      '@else',
      '// keep else comment',
      'E',
      '@endif',
      '@choice',
      '  One -> @goto one',
      '// between options',
      '',
      '  Two -> @goto two',
      '@label one',
      '@label two',
      '@end',
    ].join('\n');
    const document = parseSceneStructure(source, 's.gal', 's');
    expect(document.conditions.map((condition) => condition.span)).toEqual([
      { startLine: 2, endLine: 15 },
      { startLine: 5, endLine: 9 },
    ]);
    expect(document.conditions[0]!.branches.map((branch) => ({
      kind: branch.kind,
      span: branch.span,
      bodySpan: branch.bodySpan,
    }))).toEqual([
      { kind: 'if', span: { startLine: 2, endLine: 9 }, bodySpan: { startLine: 3, endLine: 9 } },
      { kind: 'elif', span: { startLine: 10, endLine: 11 }, bodySpan: { startLine: 11, endLine: 11 } },
      { kind: 'else', span: { startLine: 12, endLine: 14 }, bodySpan: { startLine: 13, endLine: 14 } },
    ]);
    expect(document.conditions[1]!.branches.map((branch) => [branch.kind, branch.span.startLine, branch.span.endLine])).toEqual([
      ['if', 5, 6], ['else', 7, 8],
    ]);
    expect(document.choices[0]).toMatchObject({
      span: { startLine: 16, endLine: 20 },
      options: [
        { index: 0, label: 'One', span: { startLine: 17, endLine: 17 } },
        { index: 1, label: 'Two', span: { startLine: 20, endLine: 20 } },
      ],
    });
    expect(parseSceneDocument(source).filter((line) => line.kind === 'choice-option').map((line) => line.raw)).toEqual([
      '  One -> @goto one', '  Two -> @goto two',
    ]);
  });
});
