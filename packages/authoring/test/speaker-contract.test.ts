import { describe, expect, it } from 'vitest';
import { extractSpeaker } from '@surdet/core';
import { parseSceneLine } from '../src/scene-document.js';

/**
 * N2 跨层 paired contract：Core lexer 与 Authoring scene-document 的
 * speaker 提取语义必须一致（core null ≡ authoring ''，均表示 NO SPEAKER；
 * 有 speaker 时 token 必须完全相同）。任何一边语义漂移，本表立即红。
 */
describe('core vs authoring speaker extraction contract (N2)', () => {
  const CONTRACT_INPUTS = [
    'https://example.com/story',
    'http://example.com/story',
    'ftp://example.com/story',
    'custom+proto://host',
    '旁白：你好',
    '旁白：/远处钟声/',
    '12:30',
    '注意:这里有内容',
  ];

  it.each(CONTRACT_INPUTS)('core and authoring agree on speaker semantics for %s', (line) => {
    const coreSpeaker = extractSpeaker(line.trimStart());
    const parsed = parseSceneLine(line, '');
    expect(parsed.kind).toBe('text');
    const authoringSpeaker = parsed.kind === 'text' ? parsed.speaker.trim() : undefined;
    if (coreSpeaker === null) {
      expect(authoringSpeaker).toBe('');
    } else {
      expect(authoringSpeaker).toBe(coreSpeaker);
    }
  });
});
