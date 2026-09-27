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
    const expected = {
      '--surdet-color-paper-0': '#f7f8fa',
      '--surdet-color-paper-50': '#ffffff',
      '--surdet-color-paper-100': '#f3f5f8',
      '--surdet-color-ink-900': '#303847',
      '--surdet-color-ink-600': '#697588',
      '--surdet-color-frame-900': '#1d2326',
      '--surdet-color-line-300': '#e5e9f0',
      '--surdet-color-line-600': '#9aa8bc',
      '--surdet-color-accent-600': '#526d9b',
      '--surdet-color-provenance-600': '#6f5a45',
      '--surdet-color-success-600': '#3f6851',
      '--surdet-color-warning-600': '#946426',
      '--surdet-color-danger-600': '#9a4039',
    } as const;

    for (const [name, value] of Object.entries(expected)) {
      expect(tokenValues.get(name), `${name} must match the approved primitive`).toBe(value);
    }
  });

  it('declares the approved semantic mappings exactly', () => {
    const expected = {
      '--surdet-surface-app': 'var(--surdet-color-paper-0)',
      '--surdet-surface-panel': 'var(--surdet-color-paper-50)',
      '--surdet-surface-subtle': 'var(--surdet-color-paper-100)',
      '--surdet-surface-selected': '#edf2fa',
      '--surdet-text-primary': 'var(--surdet-color-ink-900)',
      '--surdet-text-secondary': 'var(--surdet-color-ink-600)',
      '--surdet-border-default': 'var(--surdet-color-line-300)',
      '--surdet-border-strong': 'var(--surdet-color-line-600)',
      '--surdet-action-primary': 'var(--surdet-color-accent-600)',
      '--surdet-focus-ring': '#526d9b',
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
    expect(tokenValues.get('--surdet-font-story')).toBe(
      '"noto serif cjk sc", "source han serif sc", "songti sc", var(--surdet-font-ui)',
    );
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
    expect(scaleValues('--surdet-radius-')).toEqual(['0', '3px', '4px']);
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

  it('keeps the wrapped project bar in flow so narrow commands cannot cover mode navigation', () => {
    const projectBarRules = ruleBodiesMatching(appShellCss, /\.editor-project-bar\s*$/i);
    expect(projectBarRules.length).toBeGreaterThan(0);
    expect(projectBarRules[0]).toMatch(/flex\s*:\s*(?:none|0\s+0\s+auto)/i);

    const narrowStart = appShellCss.search(/@media\s*\(max-width:\s*1250px\)/);
    expect(narrowStart).toBeGreaterThanOrEqual(0);
    const narrowRules = appShellCss.slice(narrowStart);
    expect(projectBarRules[0]).toMatch(/grid-template-areas\s*:\s*["']identity\s+context\s+commands["']\s*["']feedback\s+feedback\s+relay["']/i);
    expect(narrowRules).toMatch(/grid-template-columns\s*:\s*116px\s+minmax\(110px,\s*1fr\)\s+auto/i);
    const statusRules = ruleBodiesMatching(appShellCss, /\.editor-project-bar\s+#status\s*$/i);
    expect(statusRules.join('\n')).toMatch(/min-width\s*:\s*0/i);
    expect(statusRules.join('\n')).toMatch(/overflow-wrap\s*:\s*anywhere/i);
  });
});
