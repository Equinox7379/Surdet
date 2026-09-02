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

const sidebarSource = readEditorFile('src/panels/sidebar.ts');
const assetsSource = readEditorFile('src/panels/assets.ts');
const scriptWorkspaceCss = readEditorFile('src/styles/script-workspace.css');

describe('editor scene and asset outline contract', () => {
  it('uses native tab semantics and projects only the real current scene as selected', () => {
    expect(sidebarSource).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]tablist['"]\s*\)/);
    expect(sidebarSource).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]tab['"]\s*\)/);
    expect(sidebarSource).toMatch(/setAttribute\(\s*['"]data-sidebar-mode['"]\s*,\s*d\.id\s*\)/);
    expect(sidebarSource).toMatch(/setAttribute\(\s*['"]aria-selected['"]\s*,\s*String\(d\.id\s*===\s*state\.sidebarTab\)\s*\)/);
    expect(sidebarSource).toMatch(/tabIndex\s*=\s*d\.id\s*===\s*state\.sidebarTab\s*\?\s*0\s*:\s*-1/);
    expect(sidebarSource).toContain('ArrowLeft');
    expect(sidebarSource).toContain('ArrowRight');

    expect(sidebarSource).toMatch(/h\(\s*['"]button['"]\s*,\s*['"]scene-item/);
    expect(sidebarSource).toMatch(/dataset\.sceneId\s*=\s*id/);
    expect(sidebarSource).toMatch(/const\s+selected\s*=\s*id\s*===\s*state\.current/);
    expect(sidebarSource).toMatch(/setAttribute\(\s*['"]aria-selected['"]\s*,\s*String\(selected\)\s*\)/);
    expect(sidebarSource).toMatch(/onSelectSceneHook\(id\)/);
    expect(sidebarSource).not.toMatch(/item\.onclick\s*=\s*\(\)\s*=>\s*\{[^}]*state\.current\s*=/s);
  });

  it('routes newly created scenes through the same centralized navigation hook', () => {
    const newSceneBody = sidebarSource.match(/export function newScene\(\): void \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(newSceneBody).toMatch(/state\.scenes\.set\(id,/);
    expect(newSceneBody).toMatch(/onSelectSceneHook\(id\)/);
    expect(newSceneBody).not.toMatch(/state\.current\s*=\s*id/);
    expect(sidebarSource).not.toContain('bindSidebarRenderAll');
    expect(sidebarSource).not.toContain('renderAllHook');
  });

  it('exposes native path-specific rename and delete actions beside each scene', () => {
    expect(sidebarSource).toMatch(/h\(\s*['"]div['"]\s*,\s*['"]scene-row['"]\s*\)/);
    expect(sidebarSource).toMatch(/dataset\.sceneKey\s*=\s*id/);
    expect(sidebarSource).toMatch(/dataset\.action\s*=\s*['"]rename-scene['"]/);
    expect(sidebarSource).toMatch(/dataset\.action\s*=\s*['"]delete-scene['"]/);
    expect(sidebarSource).toMatch(/onRenameSceneHook\(id\)/);
    expect(sidebarSource).toMatch(/onDeleteSceneHook\(id\)/);
    expect(sidebarSource).toContain('重命名场景');
    expect(sidebarSource).toContain('删除场景');
  });

  it('exposes the complete asset catalog and stable insert/copy actions', () => {
    expect(assetsSource).toMatch(/setAttribute\(\s*['"]data-editor-region['"]\s*,\s*['"]asset-catalog['"]\s*\)/);
    expect(assetsSource).toMatch(/dataset\.assetKey\s*=\s*entry\.key/);
    expect(assetsSource).toMatch(/dataset\.assetKind\s*=\s*entry\.kind/);
    expect(assetsSource).toMatch(/entry\.usedBy\.length\s*===\s*0/);
    expect(assetsSource).toContain('未发现引用');
    expect(assetsSource).toContain('鉴赏条目');
    expect(assetsSource).toMatch(/setAttribute\(\s*['"]data-action['"]\s*,\s*['"]insert-asset['"]\s*\)/);
    expect(assetsSource).toMatch(/setAttribute\(\s*['"]data-action['"]\s*,\s*['"]copy-asset-key['"]\s*\)/);
    expect(assetsSource).toMatch(/galleryUnlockEntries/);
    expect(assetsSource).toMatch(/kind:\s*'cg'|['"]cg['"]/);
    expect(assetsSource).toMatch(/kind:\s*'music'|['"]music['"]/);
    expect(assetsSource).toMatch(/kind:\s*'text'|['"]text['"]/);
  });

  it('keeps asset insertion on the existing history, dirty, and undo path', () => {
    expect(assetsSource).toMatch(/insertLineForAsset\(entry\)/);
    expect(assetsSource).toMatch(/appendLineToScene\(sc\.text\s*,\s*sc\.eol\s*,\s*line\)/);
    expect(assetsSource).toMatch(/setSceneText\(state\.current\s*,/);
    expect(assetsSource).toMatch(/onInsertedHook\(\)/);
    expect(assetsSource).toContain('（可撤销）');
  });

  it('rejects stale asynchronous hover previews before creating or appending preview content', () => {
    expect((assetsSource.match(/previewEl\s*!==\s*box/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(assetsSource).toMatch(/previewEl\s*!==\s*box\s*\|\|\s*!box\.isConnected/);
    expect(assetsSource).toMatch(/if\s*\(previewEl\s*!==\s*box[^)]*\)\s*return;[\s\S]*URL\.createObjectURL/);
  });

  it('uses whole-surface outline selection without colored or inset left rails', () => {
    expect(scriptWorkspaceCss.length, 'Wave 2 script workspace stylesheet must exist').toBeGreaterThan(0);
    const outlineRules = ruleBodiesMatching(
      scriptWorkspaceCss,
      /(?:\.scene-item|\[data-scene-id|\.asset-item|\[data-asset-key)/i,
    );
    expect(outlineRules.length, 'scene and asset selectors must be scoped in the Wave 2 layer').toBeGreaterThan(0);
    const declarations = outlineRules.join('\n');
    expect(declarations).not.toMatch(/border-(?:left|inline-start)(?:-color)?\s*:/i);
    expect(declarations).not.toMatch(/box-shadow\s*:[^;]*(?:inset\s+[^;]*\s0|inset\s+\d+px\s+0)/i);
  });
});
