import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEditorFile(relativePath: string): string {
  const absolutePath = path.resolve(editorRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function normalizeCssValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function customProperties(css: string): Map<string, string> {
  return new Map(
    [...stripCssComments(css).matchAll(/(--surdet-[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)]
      .map((match) => [match[1]!, normalizeCssValue(match[2]!)]),
  );
}

function ruleBodiesMatching(css: string, selectorPattern: RegExp): string[] {
  return [...stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => selectorPattern.test(match[1] ?? ''))
    .map((match) => match[2] ?? '');
}

const tokensCss = readEditorFile('src/styles/tokens.css');
const componentsCss = readEditorFile('src/styles/components.css');
const appShellCss = readEditorFile('src/styles/app-shell.css');
const indexHtml = readEditorFile('index.html');

const tokenValues = customProperties(tokensCss);
const migratedCss = [tokensCss, componentsCss, appShellCss]
  .map(stripCssComments)
  .join('\n');

describe('editor visual token contract', () => {
  it('declares the approved primitive color family exactly', () => {
    // Direction A (dark professional), selected by the Owner on 2026-10-08.
    const expected = {
      '--surdet-color-paper-0': '#111317',
      '--surdet-color-paper-50': '#181b20',
      '--surdet-color-paper-100': '#1f2329',
      '--surdet-color-paper-200': '#262b32',
      '--surdet-color-ink-900': '#e7e9ec',
      '--surdet-color-ink-600': '#a3abb7',
      '--surdet-color-ink-400': '#6f7783',
      '--surdet-color-frame-900': '#0c0e11',
      '--surdet-color-line-300': '#282d35',
      '--surdet-color-line-600': '#3f4651',
      '--surdet-color-accent-600': '#f0a35e',
      '--surdet-color-accent-500': '#f5b577',
      '--surdet-color-accent-ink': '#1b1207',
      '--surdet-color-provenance-600': '#c9a27e',
      '--surdet-color-success-600': '#5cc28f',
      '--surdet-color-warning-600': '#e6b04f',
      '--surdet-color-danger-600': '#ef6b6b',
      '--surdet-color-info-600': '#7aa7ff',
    } as const;

    for (const [name, value] of Object.entries(expected)) {
      expect(tokenValues.get(name), `${name} must match the approved primitive`).toBe(value);
    }
    expect(tokensCss).toMatch(/color-scheme\s*:\s*dark/i);
  });

  it('declares the approved semantic mappings exactly', () => {
    const expected = {
      '--surdet-surface-app': 'var(--surdet-color-paper-0)',
      '--surdet-surface-panel': 'var(--surdet-color-paper-50)',
      '--surdet-surface-subtle': 'var(--surdet-color-paper-100)',
      '--surdet-surface-raised': 'var(--surdet-color-paper-200)',
      '--surdet-surface-selected': '#2c261f',
      '--surdet-text-primary': 'var(--surdet-color-ink-900)',
      '--surdet-text-secondary': 'var(--surdet-color-ink-600)',
      '--surdet-text-muted': 'var(--surdet-color-ink-400)',
      '--surdet-text-on-accent': 'var(--surdet-color-accent-ink)',
      '--surdet-border-default': 'var(--surdet-color-line-300)',
      '--surdet-border-strong': 'var(--surdet-color-line-600)',
      '--surdet-action-primary': 'var(--surdet-color-accent-600)',
      '--surdet-action-primary-hover': 'var(--surdet-color-accent-500)',
      '--surdet-focus-ring': '#f0a35e',
      '--surdet-state-provenance': 'var(--surdet-color-provenance-600)',
      '--surdet-state-success': 'var(--surdet-color-success-600)',
      '--surdet-state-warning': 'var(--surdet-color-warning-600)',
      '--surdet-state-danger': 'var(--surdet-color-danger-600)',
      '--surdet-state-readonly': 'var(--surdet-color-ink-600)',
    } as const;

    for (const [name, value] of Object.entries(expected)) {
      expect(tokenValues.get(name), `${name} must preserve the approved semantic mapping`).toBe(value);
    }
  });

  it('provides the approved typography, spacing, radius, focus, and motion scales', () => {
    expect(tokenValues.get('--surdet-font-ui')).toBe(
      '"microsoft yahei ui", "microsoft yahei", "segoe ui variable", "segoe ui", "pingfang sc", "noto sans cjk sc", sans-serif',
    );
    // Titles and story text use the bundled serif the starter game is read in.
    expect(tokenValues.get('--surdet-font-display')).toBe(
      '"noto serif sc variable", "noto serif sc", "source han serif sc", serif',
    );
    expect(tokenValues.get('--surdet-font-story')).toBe('var(--surdet-font-display)');
    expect(tokenValues.get('--surdet-font-mono')).toBe(
      '"cascadia mono", "sarasa mono sc", consolas, monospace',
    );

    const scaleValues = (prefix: string) => [...tokenValues.entries()]
      .filter(([name]) => name.startsWith(prefix))
      .map(([, value]) => value);

    expect(scaleValues('--surdet-type-')).toEqual(['12px', '13px', '14px', '17px', '21px', '25px']);
    expect(scaleValues('--surdet-space-')).toEqual([
      '4px', '6px', '8px', '12px', '16px', '20px', '24px', '32px', '40px', '48px', '64px',
    ]);
    expect(scaleValues('--surdet-radius-')).toEqual(['0', '4px', '6px']);
    expect(tokenValues.get('--surdet-control-height')).toBe('32px');
    expect(tokenValues.get('--surdet-focus-width')).toBe('2px');

    const motionDurations = scaleValues('--surdet-motion-')
      .filter((value) => /^\d+ms$/.test(value))
      .map((value) => Number.parseInt(value, 10));
    expect(motionDurations.length).toBeGreaterThan(0);
    for (const duration of motionDurations) {
      expect(duration).toBeGreaterThanOrEqual(120);
      expect(duration).toBeLessThanOrEqual(200);
    }
  });

  it('keeps banned AI-style and colored-rail signatures out of migrated styles', () => {
    const banned = [
      /radial-gradient\s*\(/i,
      /backdrop-filter\s*:/i,
      /border-left-color\s*:/i,
      /border-inline-start-color\s*:/i,
      /inset\s+3px\s+0/i,
      /border-radius\s*:\s*999px/i,
    ];

    for (const signature of banned) {
      expect(migratedCss, `migrated CSS must not contain ${signature}`).not.toMatch(signature);
    }

    expect(migratedCss).not.toMatch(
      /var\(\s*--(?:bg|panel[a-z0-9-]*|accent[a-z0-9-]*|gold[a-z0-9-]*|shadow-(?:1|2))\b/gi,
    );
  });

  it('uses whole-surface selection and an independent focus outline', () => {
    const selectedRules = ruleBodiesMatching(
      componentsCss,
      /\[aria-selected\s*=\s*["']true["']\]/i,
    );
    const currentRules = ruleBodiesMatching(
      appShellCss,
      /\[aria-current\s*=\s*["']?page["']?\]/i,
    );
    const focusRules = [
      ...ruleBodiesMatching(componentsCss, /:focus-visible/i),
      ...ruleBodiesMatching(appShellCss, /:focus-visible/i),
    ];

    expect(selectedRules.length).toBeGreaterThan(0);
    expect(selectedRules.join('\n')).toMatch(
      /background(?:-color)?\s*:\s*var\(--surdet-(?:surface-selected|[a-z0-9-]*selection[a-z0-9-]*)\)/i,
    );
    expect(selectedRules.join('\n')).toMatch(
      /border(?:-color)?\s*:\s*var\(--surdet-(?:border-strong|[a-z0-9-]*selection[a-z0-9-]*)\)/i,
    );

    expect(currentRules.length).toBeGreaterThan(0);
    expect(currentRules.join('\n')).toMatch(
      /background(?:-color)?\s*:\s*var\(--surdet-(?:surface-panel|surface-selected|[a-z0-9-]*nav-active-bg)\)/i,
    );
    expect(currentRules.join('\n')).toMatch(/font-weight\s*:\s*600/i);

    expect(focusRules.length).toBeGreaterThan(0);
    expect(focusRules.join('\n')).toMatch(
      /outline\s*:\s*var\(--surdet-focus-width\)\s+solid\s+var\(--surdet-focus-ring\)/i,
    );
    expect(focusRules.join('\n')).toMatch(/outline-offset\s*:/i);
  });

  it('does not globally resize professional mode controls', () => {
    const broadControlRules = ruleBodiesMatching(
      componentsCss,
      /#app[^{}]*(?:input|select|textarea)/i,
    );
    expect(broadControlRules.length).toBeGreaterThan(0);
    expect(broadControlRules.join('\n')).not.toMatch(
      /min-height\s*:|border-color\s*:|font-size\s*:/i,
    );
  });

  it('loads only semantic layers in dependency order', () => {
    const hrefs = [...indexHtml.matchAll(/<link\b[^>]*>/gi)]
      .map((match) => match[0])
      .filter((tag) => /\brel=["']stylesheet["']/i.test(tag))
      .map((tag) => tag.match(/\bhref=["']([^"']+)["']/i)?.[1])
      .filter((href): href is string => href !== undefined)
      .filter((href) => [
        '/src/styles.css',
        '/src/styles/tokens.css',
        '/src/styles/components.css',
        '/src/styles/app-shell.css',
      ].includes(href));

    expect(hrefs).toEqual([
      '/src/styles/tokens.css',
      '/src/styles/components.css',
      '/src/styles/app-shell.css',
    ]);
  });

  it('keeps a single-row title bar and a wrapping status bar in flow', () => {
    const projectBarRules = ruleBodiesMatching(appShellCss, /\.editor-project-bar\s*$/i);
    expect(projectBarRules.length).toBeGreaterThan(0);
    expect(projectBarRules[0]).toMatch(/flex\s*:\s*(?:none|0\s+0\s+auto)/i);
    expect(projectBarRules[0]).toMatch(/grid-template-areas\s*:\s*["']identity\s+context\s+search\s+commands["']/i);
    expect(projectBarRules[0]).toMatch(/height\s*:\s*var\(--surdet-shell-titlebar-height\)/i);

    const statusBarRules = ruleBodiesMatching(appShellCss, /\.editor-status-bar\s*$/i);
    expect(statusBarRules.length).toBeGreaterThan(0);
    expect(statusBarRules[0]).toMatch(/flex\s*:\s*(?:none|0\s+0\s+auto)/i);
    // Long operation messages wrap instead of being truncated or covering the work surface.
    expect(statusBarRules[0]).toMatch(/flex-wrap\s*:\s*wrap/i);
    expect(statusBarRules[0]).toMatch(/min-height\s*:/i);
    const statusRules = ruleBodiesMatching(appShellCss, /\.editor-status-bar\s+#status\s*$/i);
    expect(statusRules.join('\n')).toMatch(/min-width\s*:\s*0/i);
    expect(statusRules.join('\n')).toMatch(/overflow-wrap\s*:\s*anywhere/i);
  });
});
