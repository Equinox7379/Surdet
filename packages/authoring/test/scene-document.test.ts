import { describe, expect, it } from 'vitest';
import { insertLinesAfter, parseSceneDocument, serializeSceneDocument } from '../src/scene-document.js';

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
