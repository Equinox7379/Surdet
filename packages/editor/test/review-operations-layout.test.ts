import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/styles/review-workspace.css',
);
const reviewStyles = existsSync(stylePath) ? readFileSync(stylePath, 'utf8') : '';

describe('review operations layout contract', () => {
  it('keeps the save-decision action in document flow instead of floating over review content', () => {
    const rules = [...reviewStyles.matchAll(/\.review-operations\s*\{([^}]*)\}/gs)]
      .map((match) => match[1] ?? '');

    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toMatch(/position:\s*(?:sticky|fixed)/);
      expect(rule).not.toMatch(/bottom\s*:/);
    }
  });
});
