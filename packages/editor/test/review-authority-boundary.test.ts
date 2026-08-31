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
    const workspaceSource = fs.readFileSync(path.join(editorRoot, 'src', 'review-workspace.ts'), 'utf8');
    expect(workspaceSource).not.toMatch(/writeCreateOnly[\s\S]{0,500}(?:decision\.json|final-approval\.json|return-request\.json)/);
    expect(workspaceSource).not.toMatch(/createWritable\s*\(/);
    expect(workspaceSource).not.toMatch(/getFileHandle\s*\(\s*['"](?:decision\.json|final-approval\.json|return-request\.json)['"]\s*,\s*\{\s*create:\s*true/);
    expect(workspaceSource).toMatch(/terminalClientFor\(workspace, terminalClient\)\.write\(command\)/);
  });

  it('mounts the Node authority only through Vite tooling', () => {
    const config = fs.readFileSync(path.join(editorRoot, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/reviewAuthorityVitePlugin/);
    expect(config).toMatch(/plugins\s*:/);
  });
});
