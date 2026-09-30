import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EDITOR_MODES } from '../src/shell/editor-modes.js';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legacyStylesPath = path.join(editorRoot, 'src', 'styles.css');
const stylesRoot = path.join(editorRoot, 'src', 'styles');
const indexHtml = readFileSync(path.join(editorRoot, 'index.html'), 'utf8');

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function stylesheetHrefs(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\brel=["']stylesheet["']/i.test(tag))
    .map((tag) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1])
    .filter((href): href is string => href !== undefined);
}

function productionCssFiles(): string[] {
  const styleFiles = readdirSync(stylesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) => path.join(stylesRoot, entry.name));
  if (existsSync(legacyStylesPath)) styleFiles.push(legacyStylesPath);
  return styleFiles.sort();
}

const hrefs = stylesheetHrefs(indexHtml);
const cssEntries = productionCssFiles().map((file) => ({
  file: path.relative(editorRoot, file).replaceAll('\\', '/'),
  css: stripCssComments(readFileSync(file, 'utf8')),
}));

const requiredStyles = [
  '/src/styles/tokens.css',
  '/src/styles/components.css',
  '/src/styles/app-shell.css',
  '/src/styles/script-workspace.css',
  '/src/styles/flow-workspace.css',
  '/src/styles/timeline-workspace.css',
  '/src/styles/config-workspace.css',
  '/src/styles/preview-workspace.css',
  '/src/styles/review-workspace.css',
  '/src/styles/project-health-workspace.css',
  '/src/styles/asset-center.css',
  '/src/styles/asset-import.css',
] as const;

const modeStyleOwner: Readonly<Record<(typeof EDITOR_MODES)[number]['id'], string>> = {
  editor: '/src/styles/script-workspace.css',
  assets: '/src/styles/asset-center.css',
  flow: '/src/styles/flow-workspace.css',
  timeline: '/src/styles/timeline-workspace.css',
  config: '/src/styles/config-workspace.css',
  preview: '/src/styles/preview-workspace.css',
  review: '/src/styles/review-workspace.css',
  stats: '/src/styles/project-health-workspace.css',
  history: '/src/styles/content-history.css',
  audit: '/src/styles/project-health-workspace.css',
};

describe('Frontend Pass 10 final visual system contract', () => {
  it('removes the temporary legacy stylesheet from disk and the production entry', () => {
    expect(existsSync(legacyStylesPath), 'src/styles.css must be deleted after its live rules are migrated')
      .toBe(false);
    expect(hrefs).not.toContain('/src/styles.css');
  });

  it('loads each semantic style layer once and preserves dependency order', () => {
    expect(new Set(hrefs).size, 'stylesheet links must not be duplicated').toBe(hrefs.length);
    for (const href of requiredStyles) expect(hrefs, `${href} must remain loaded`).toContain(href);

    const tokens = hrefs.indexOf('/src/styles/tokens.css');
    const components = hrefs.indexOf('/src/styles/components.css');
    const shell = hrefs.indexOf('/src/styles/app-shell.css');
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(components).toBeGreaterThan(tokens);
    expect(shell).toBeGreaterThan(components);
  });

  it('keeps the supported modes and gives every mode an explicit style owner', () => {
    expect(EDITOR_MODES.map(({ id }) => id)).toEqual([
      'editor', 'assets', 'flow', 'timeline', 'config',
      'preview', 'review', 'stats', 'history', 'audit',
    ]);
    for (const mode of EDITOR_MODES) {
      expect(hrefs, `${mode.id} must load ${modeStyleOwner[mode.id]}`)
        .toContain(modeStyleOwner[mode.id]);
    }
  });

  it('keeps old theme tokens and visual signatures out of every production CSS file', () => {
    const legacyToken = /--(?:bg|panel(?:2|3)?|line(?:-soft)?|text|dim|accent(?:-strong|-soft|-glow)?|gold(?:-strong|-ink|-soft)?|err(?:-soft)?|warn(?:-soft)?|ok(?:-soft)?|r-(?:sm|md|lg)|shadow-(?:1|2)|ease)\b/i;
    const forbiddenSignatures = [
      /radial-gradient\s*\(/i,
      /backdrop-filter\s*:/i,
      /border-left-color\s*:/i,
      /border-inline-start-color\s*:/i,
      /inset\s+3px\s+0(?:\s+0)?/i,
      /border-left\s*:\s*3px\s+solid/i,
      /border-radius\s*:\s*999px/i,
    ];

    for (const { file, css } of cssEntries) {
      expect(css, `${file} must not declare or consume a legacy custom property`).not.toMatch(legacyToken);
      for (const signature of forbiddenSignatures) {
        expect(css, `${file} must not contain ${signature}`).not.toMatch(signature);
      }
    }
  });

  it('retains a visible focus contract and reduced-motion fallback', () => {
    const componentsCss = stripCssComments(
      readFileSync(path.join(stylesRoot, 'components.css'), 'utf8'),
    );
    expect(componentsCss).toMatch(/#app\s+:focus-visible\s*\{/i);
    expect(componentsCss).toMatch(
      /outline\s*:\s*var\(--surdet-focus-width\)\s+solid\s+var\(--surdet-focus-ring\)/i,
    );
    expect(componentsCss).toMatch(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/i);
  });
});
