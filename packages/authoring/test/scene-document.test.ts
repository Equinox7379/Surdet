import { describe, expect, it } from 'vitest';
import {
  insertLinesAfter,
  parseSceneDocument,
  parseSceneLine,
  rewriteInstructionArgumentsRaw,
  serializeSceneDocument,
  splitInstruction,
} from '../src/scene-document.js';

describe('scene document EOL identity', () => {
  it('roundtrips mixed LF/CRLF byte-for-byte', () => {
    const source = '@scene mixed\r\n凛：第一行\n凛：第二行\r\n@end';
    expect(serializeSceneDocument(parseSceneDocument(source), '\n')).toBe(source);
  });

  it('inserts with the anchor EOL without changing unrelated delimiters', () => {
    const source = '@scene mixed\r\n凛：第一行\n@end';
    const next = insertLinesAfter(parseSceneDocument(source), 1, [{ kind: 'text', speaker: '凛', value: '新增', raw: '凛：新增' }]);
    expect(serializeSceneDocument(next, '\n')).toBe('@scene mixed\r\n凛：第一行\n凛：新增\n@end');
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
