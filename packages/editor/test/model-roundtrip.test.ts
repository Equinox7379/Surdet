/**
 * 零失真契约回归（E0）：对真实 starter 剧本做 parseScript → serializeScript 往返，
 * 逐字节相等；CRLF/LF 换行风格按源文件检测并保持。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScript, serializeScript } from '../src/model.js';

const scenarioDir = fileURLToPath(new URL('../../../examples/starter/content/scenario', import.meta.url));

describe('零失真往返（真实 starter 剧本）', () => {
  const files = readdirSync(scenarioDir).filter((f) => f.endsWith('.gal'));

  it('starter 剧本目录非空', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f}：parse → serialize 逐字节相等（含换行风格）`, () => {
      const raw = readFileSync(path.join(scenarioDir, f), 'utf8');
      const eol = raw.includes('\r\n') ? '\r\n' : '\n';
      const lines = parseScript(raw);
      expect(serializeScript(lines, eol)).toBe(raw);
    });
  }

  it('CRLF 源文件往返保持 CRLF（不被静默改写为 LF）', () => {
    const crlf = '@scene demo\r\n凛：你好。\r\n@end';
    const lines = parseScript(crlf);
    expect(serializeScript(lines, '\r\n')).toBe(crlf);
  });
});
