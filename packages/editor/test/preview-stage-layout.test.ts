import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const previewHtml = readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../preview.html',
), 'utf8');
const editorStyles = readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/styles.css',
), 'utf8');

describe('preview stage layout contract', () => {
  it('centers the Gal canvas in both axes without stretching it', () => {
    expect(previewHtml).toMatch(/html,\s*body\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
    expect(previewHtml).toMatch(/#preview-root\s*\{[^}]*display:\s*grid[^}]*place-items:\s*center/s);
    expect(previewHtml).toMatch(/#preview-root\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
    expect(previewHtml).toMatch(/#preview-root canvas\s*\{[^}]*width:\s*auto[^}]*height:\s*auto/s);
    expect(previewHtml).toMatch(/#preview-root canvas\s*\{[^}]*max-width:\s*100%[^}]*max-height:\s*100%/s);
    expect(previewHtml).not.toMatch(/#preview-root canvas\s*\{[^}]*[;\s]width:\s*100%/s);
  });

  it('keeps the causal trace bounded while events grow', () => {
    expect(editorStyles).toMatch(/#preview-view\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
    expect(editorStyles).toMatch(/\.preview-frame\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0/s);
    expect(editorStyles).toMatch(/\.preview-trace\s*\{[^}]*flex:\s*0\s+0\s+clamp\(96px,\s*14vh,\s*136px\)[^}]*height:\s*clamp\(96px,\s*14vh,\s*136px\)[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
    expect(editorStyles).not.toMatch(/\.preview-trace\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
  });

  it('keeps review task, main, and detail columns independently scrollable', () => {
    expect(editorStyles).toMatch(/#review-view\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
    expect(editorStyles).toMatch(/\.review-workbench\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(210px,\s*260px\)\s+minmax\(460px,\s*1fr\)\s+minmax\(260px,\s*340px\)[^}]*height:\s*100%[^}]*min-height:\s*0/s);
    for (const selector of ['review-task-list', 'review-main', 'review-details']) {
      expect(editorStyles).toMatch(new RegExp(`\\.${selector}\\s*\\{[^}]*min-height:\\s*0[^}]*overflow-y:\\s*auto`, 's'));
    }
    expect(editorStyles).toMatch(/@media\s*\(max-width:\s*1280px\)[\s\S]*review-workbench/);
    expect(editorStyles).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*review-workbench/);
    expect(editorStyles).toMatch(/\.review-preview-shell\s*\{[^}]*min-height:\s*360px/s);
  });
});
