import { existsSync, readFileSync } from 'node:fs';
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
const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEditorFile(relativePath: string): string {
  const absolutePath = path.resolve(editorRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

const indexHtml = readEditorFile('index.html');
const mainSource = readEditorFile('src/main.ts');
const panelSource = readEditorFile('src/panels/preview-panel.ts');
const reviewPanelSource = readEditorFile('src/panels/review-panel.ts');
const previewStyles = readEditorFile('src/styles/preview-workspace.css');

describe('preview stage layout contract', () => {
  it('centers the Gal canvas in both axes without stretching it', () => {
    expect(previewHtml).toMatch(/html,\s*body\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
    expect(previewHtml).toMatch(/#preview-root\s*\{[^}]*display:\s*grid[^}]*place-items:\s*center/s);
    expect(previewHtml).toMatch(/#preview-root\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
    expect(previewHtml).toMatch(/#preview-root canvas\s*\{[^}]*width:\s*auto[^}]*height:\s*auto/s);
    expect(previewHtml).toMatch(/#preview-root canvas\s*\{[^}]*max-width:\s*100%[^}]*max-height:\s*100%/s);
    expect(previewHtml).not.toMatch(/#preview-root canvas\s*\{[^}]*[;\s]width:\s*100%/s);
  });

  it('loads a dedicated Preview workspace layer and exposes a stable panel identity', () => {
    expect(indexHtml).toContain('/src/styles/preview-workspace.css');
    expect(mainSource).toContain("pvEl.dataset['editorPanel'] = 'preview'");
    expect(previewStyles.length).toBeGreaterThan(0);
  });

  it('keeps the stage largest while causal records scroll independently', () => {
    expect(previewStyles).toMatch(/#preview-view\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
    expect(previewStyles).toMatch(/\.preview-workspace\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto/s);
    expect(previewStyles).toMatch(/\.preview-stage\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
    expect(previewStyles).toMatch(/\.preview-frame\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
    expect(previewStyles).toMatch(/\.preview-causal-list\s*\{[^}]*max-height:\s*clamp\([^}]*overflow-y:\s*auto/s);
    expect(previewStyles).not.toMatch(/position:\s*(?:fixed|sticky)/);
  });

  it('provides a keyboard-operable causal dock without card-wall styling', () => {
    expect(panelSource).toContain("dockToggle.setAttribute('aria-controls', traceList.id)");
    expect(panelSource).toContain("dockToggle.setAttribute('aria-expanded', String(dockExpanded))");
    expect(panelSource).toContain('focus({ preventScroll: true })');
    expect(panelSource).toContain('savedScrollTop');
    expect(previewStyles).toMatch(/@media\s*\(max-width:\s*800px\)/);
    expect(previewStyles).toMatch(/@media\s*\(max-width:\s*480px\)/);
    expect(previewStyles).not.toMatch(/(?:border-left-color|border-inline-start-color)\s*:/);
    expect(previewStyles).not.toMatch(/(?:linear|radial)-gradient\s*\(/);
    expect(previewStyles).not.toMatch(/border-radius\s*:\s*999px/);
  });

  it('keeps the Review result preview tall enough and starts its embedded dock collapsed', () => {
    expect(reviewPanelSource).toContain('renderPreviewPanel(host as HTMLElement, { embedded: true })');
    expect(panelSource).toContain("window.matchMedia?.('(max-width: 480px), (max-height: 700px)').matches === true");
    expect(panelSource).toContain("options.embedded !== true && !constrainedViewport");
    expect(panelSource).toContain("workspace.setAttribute('data-preview-layout', options.embedded === true ? 'embedded' : 'standalone')");
    expect(previewStyles).toMatch(/#review-preview-host\s*\{[^}]*min-height:\s*420px/s);
    expect(previewStyles).toMatch(/#review-preview-host \.preview-workspace\[data-preview-layout="embedded"\]\s*\{[^}]*min-height:\s*420px/s);
    expect(previewStyles).toMatch(/\.preview-diagnostics\s*\{[^}]*max-height:\s*96px[^}]*overflow-y:\s*auto/s);
    expect(previewStyles).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*\.preview-causal-list\s*\{[^}]*max-height:\s*96px/s);
    expect(previewStyles).toMatch(/@media\s*\(max-height:\s*700px\)[\s\S]*\.preview-causal-list\s*\{[^}]*max-height:\s*96px/s);
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
