import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEditorFile(relativePath: string): string {
  const absolutePath = path.resolve(editorRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

const indexHtml = readEditorFile('index.html');
const mainSource = readEditorFile('src/main.ts');
const reviewSource = readEditorFile('src/panels/review-panel.ts');
const reviewStyles = readEditorFile('src/styles/review-workspace.css');
const legacyStyles = readEditorFile('src/styles.css');

describe('review proofreading workbench layout', () => {
  it('loads one dedicated Review workspace stylesheet and stable panel identity', () => {
    expect(indexHtml).toContain('/src/styles/review-workspace.css');
    expect(mainSource).toContain("reviewEl.dataset['editorPanel'] = 'review'");
    expect(reviewStyles.length).toBeGreaterThan(0);
    expect(legacyStyles).not.toMatch(/\.review-workbench\s*\{/);
  });

  it('exposes human-task sections before technical disclosure', () => {
    expect(reviewSource).toContain("setAttribute('data-review-section', section)");
    for (const section of ['overview', 'decisions', 'decision-actions', 'safe-results', 'dependencies', 'result-preview', 'result-actions', 'result-summary', 'result-evidence', 'technical']) {
      expect(reviewSource).toContain(`'${section}'`);
    }
    expect(reviewSource).toContain('需要你决定');
    expect(reviewSource).toContain('将自动纳入');
    expect(reviewSource).toContain('预览正式结果');
    expect(reviewSource).toContain('查看执行与技术详情');
  });

  it('uses continuous hierarchy without old AI-styled rails, pills, or floating actions', () => {
    expect(reviewStyles).toMatch(/\.review-workbench\s*\{[^}]*display:\s*grid/s);
    expect(reviewStyles).toMatch(/\.review-workspace-header\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
    expect(reviewStyles).toMatch(/\.review-task-list[\s\S]*\.review-main[\s\S]*\.review-details/);
    expect(reviewStyles).not.toMatch(/border-(?:left|inline-start)\s*:\s*3px/);
    expect(reviewStyles).not.toMatch(/border-radius\s*:\s*999px/);
    expect(reviewStyles).not.toMatch(/(?:linear|radial)-gradient\s*\(/);
    expect(reviewStyles).not.toMatch(/position\s*:\s*(?:fixed|sticky)/);
  });

  it('defines two-column, single-column, and phone-sized fallbacks', () => {
    expect(reviewStyles).toMatch(/@media\s*\(max-width:\s*1280px\)/);
    expect(reviewStyles).toMatch(/@media\s*\(max-width:\s*900px\)/);
    expect(reviewStyles).toMatch(/@media\s*\(max-width:\s*480px\)/);
    expect(reviewStyles).toMatch(/\.review-operations\s*\{[^}]*position:\s*static/s);
  });
});
