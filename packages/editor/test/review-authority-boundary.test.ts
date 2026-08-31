import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [child] : [];
  });
}

describe('Editor review authority boundary', () => {
  it('keeps Node authority/storage/lease imports out of browser sources', () => {
    const browserSources = sourceFiles(path.join(editorRoot, 'src'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
    expect(browserSources).not.toMatch(/from\s+['"]node:/);
    expect(browserSources).not.toMatch(/node-review-store|node-local-lease|@surdet\/cli/);
  });

  it('mounts the Node authority only through Vite tooling', () => {
    const config = fs.readFileSync(path.join(editorRoot, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/reviewAuthorityVitePlugin/);
    expect(config).toMatch(/plugins\s*:/);
  });
});
