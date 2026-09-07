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

function ruleBodiesMatching(css: string, selectorPattern: RegExp): string[] {
  return [...stripCssComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => selectorPattern.test(match[1] ?? ''))
    .map((match) => match[2] ?? '');
}

const editorSource = readEditorFile('src/panels/editor.ts');
const scriptWorkspaceCss = readEditorFile('src/styles/script-workspace.css');

describe('editor continuous manuscript contract', () => {
  it('renders one ordered manuscript article for the real current scene', () => {
    expect(editorSource).toMatch(/h\(\s*['"]article['"]\s*,\s*['"]manuscript-sheet['"]\s*\)/);
    expect(editorSource).toMatch(/dataset\.editorRegion\s*=\s*['"]manuscript['"]/);
    expect(editorSource).toMatch(/dataset\.sceneId\s*=\s*state\.current/);
    expect(editorSource).toMatch(/lines\.forEach\(\(line\s*,\s*index\)\s*=>\s*\{[^}]*renderBlock\(line\s*,\s*index\s*,\s*lines\.length\)/s);
    expect(editorSource).not.toMatch(/(?:narrative|dialogue|interaction)Column/i);
  });

  it('keeps each real line addressable, focusable, and selected through one semantic truth', () => {
    expect(editorSource).toMatch(/dataset\.line\s*=\s*String\(index\)/);
    expect(editorSource).toMatch(/dataset\.objectRef\s*=\s*objectRef\s*\?\?\s*['"]/);
    expect(editorSource).toMatch(/tabIndex\s*=\s*0/);
    expect(editorSource).toMatch(/setAttribute\(\s*['"]aria-selected['"]\s*,\s*String\(selected\)\s*\)/);
    expect(editorSource).toMatch(/addEventListener\(\s*['"]click['"]/);
    expect(editorSource).toMatch(/addEventListener\(\s*['"]keydown['"]/);
    expect(editorSource).toMatch(/event\.key\s*!==\s*['"]Enter['"][^\n]*event\.key\s*!==\s*['"] ['"]/);
    expect(editorSource.match(/selectBlock\(\);/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(editorSource).toMatch(/state\.selectedObjectRef\s*=\s*selectAuthoringObject\(/);
    expect(editorSource).toContain("surdet-authoring-selection");
  });

  it('keeps raw source and object identity subordinate under 技术信息', () => {
    expect(editorSource).toMatch(/h\(\s*['"]details['"]\s*,\s*['"]technical-details['"]\s*\)/);
    expect(editorSource).toMatch(/h\(\s*['"]summary['"]\s*,\s*undefined\s*,\s*['"]技术信息['"]\s*\)/);
    expect(editorSource).toMatch(/object-ref-value/);
    expect(editorSource).toMatch(/当前行尚无对象索引/);
  });

  it('preserves the existing edit and line-operation callbacks', () => {
    for (const behavior of ['updateLine(', 'moveLine(', 'insertLine(', 'deleteLine(']) {
      expect(editorSource, `missing existing behavior ${behavior}`).toContain(behavior);
    }
    expect(editorSource.match(/\.oninput\s*=/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(editorSource).toMatch(/data-action['"]\s*,\s*['"]append-dialogue-line/);
    expect(editorSource.match(/state\.selectedObjectRef\s*=\s*null/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('styles selection as a complete manuscript surface with an explicit current marker', () => {
    expect(scriptWorkspaceCss.length, 'Wave 2 script workspace stylesheet must exist').toBeGreaterThan(0);
    const blockRules = ruleBodiesMatching(scriptWorkspaceCss, /\.block|\[data-line/i);
    expect(blockRules.length, 'manuscript block selectors must be scoped in the Wave 2 layer').toBeGreaterThan(0);
    const declarations = blockRules.join('\n');
    expect(declarations).not.toMatch(/border-(?:left|inline-start)(?:-color)?\s*:/i);
    expect(declarations).not.toMatch(/box-shadow\s*:[^;]*(?:inset\s+[^;]*\s0|inset\s+\d+px\s+0)/i);

    const selectedRules = ruleBodiesMatching(
      scriptWorkspaceCss,
      /(?:\.block\.selected|\.block\[aria-selected\s*=\s*["']true["']\])/i,
    );
    expect(selectedRules.length).toBeGreaterThan(0);
    expect(selectedRules.join('\n')).toMatch(/background(?:-color)?\s*:\s*var\(--surdet-surface-selected\)/i);
    expect(selectedRules.join('\n')).toMatch(/border(?:-color)?\s*:\s*var\(--surdet-border-strong\)/i);
    expect(scriptWorkspaceCss).toMatch(/\.current-segment\b/);

    const operationRules = ruleBodiesMatching(scriptWorkspaceCss, /\.block\s+\.bar\s+\.ops\s*$/i);
    expect(operationRules.length).toBeGreaterThan(0);
    expect(operationRules[0]).toMatch(/position\s*:\s*static/i);
    expect(operationRules[0]).not.toMatch(/(?:top|right)\s*:/i);
  });
});
