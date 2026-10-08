import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthoringWorkbench } from '../src/shell/authoring-workbench.js';

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style = { setProperty: (_name: string, _value: string): void => {} };
  className = '';
  id = '';
  type = '';
  open = false;
  onclick: (() => void) | null = null;
  private ownText = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  set textContent(value: string | null) {
    this.ownText = value ?? '';
    this.children.splice(0);
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      this.dataset[key] = value;
    }
  }

  getAttribute(name: string): string | null {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return this.dataset[key] ?? null;
    }
    return this.attributes.get(name) ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches = (element: FakeElement): boolean => {
      if (selector === '[data-workbench-panel]') return element.dataset.workbenchPanel !== undefined;
      if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1));
      return false;
    };
    const found: FakeElement[] = [];
    const visit = (element: FakeElement): void => {
      if (matches(element)) found.push(element);
      for (const child of element.children) visit(child);
    };
    visit(this);
    return found;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  click(): void {
    this.onclick?.();
  }
}

const documentStub = {
  createElement: (tag: string) => new FakeElement(tag),
};

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

const workbenchSource = readEditorFile('src/shell/authoring-workbench.ts');
const mainSource = readEditorFile('src/main.ts');
const issueSource = readEditorFile('src/panels/issues.ts');
const rightSource = readEditorFile('src/panels/right.ts');
const assetSource = readEditorFile('src/panels/assets.ts');
const appShellCss = readEditorFile('src/styles/app-shell.css');
const scriptWorkspaceCss = readEditorFile('src/styles/script-workspace.css');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('integrated authoring workbench contract', () => {
  it('builds stable semantic regions and an in-flow accessible context switch', () => {
    vi.stubGlobal('document', documentStub);
    // This fixture has no layout; actual frame sizing is covered in the browser.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    const workbench = buildAuthoringWorkbench() as unknown as {
      root: FakeElement;
      outline: FakeElement;
      search: FakeElement;
      manuscript: FakeElement;
      context: FakeElement;
    };

    expect(workbench.root.getAttribute('data-editor-region')).toBe('authoring-workbench');
    expect(workbench.root.getAttribute('data-auxiliary-view')).toBe('outline');
    expect(workbench.outline.id).toBe('sidebar');
    expect(workbench.outline.getAttribute('data-editor-region')).toBe('outline');
    expect(workbench.search.id).toBe('search-panel');
    expect(workbench.manuscript.id).toBe('editor');
    expect(workbench.manuscript.getAttribute('data-editor-region')).toBe('manuscript');
    expect(workbench.context.id).toBe('right');
    expect(workbench.context.getAttribute('data-editor-region')).toBe('context');
    expect(workbench.root.dataset.mobilePanel).toBe('editor');

    const navigation = workbench.root.children[0]!;
    expect(navigation.tagName).toBe('NAV');
    const panelControls = navigation.querySelectorAll('[data-workbench-panel]');
    expect(panelControls).toHaveLength(5);
    const editorControl = panelControls.find((item) => item.dataset.workbenchPanel === 'editor')!;
    const contextControl = panelControls.find((item) => item.dataset.workbenchPanel === 'context')!;
    expect(editorControl.getAttribute('aria-pressed')).toBe('true');
    expect(contextControl.getAttribute('aria-pressed')).toBe('false');

    const details = workbench.root.querySelector('.v4-project-context')!;
    expect(details.tagName).toBe('DETAILS');
    expect(details.children[0]!.tagName).toBe('SUMMARY');
    expect(details.children[0]!.dataset.action).toBe('toggle-authoring-context');

    contextControl.click();
    expect(workbench.root.dataset.mobilePanel).toBe('context');
    expect(workbench.root.getAttribute('data-auxiliary-view')).toBe('context');
    expect(editorControl.getAttribute('aria-pressed')).toBe('false');
    expect(contextControl.getAttribute('aria-pressed')).toBe('true');
    expect(details.open).toBe(true);

    editorControl.click();
    expect(workbench.root.dataset.mobilePanel).toBe('editor');
    expect(workbench.root.getAttribute('data-auxiliary-view')).toBe('outline');
    expect(editorControl.getAttribute('aria-pressed')).toBe('true');
    expect(contextControl.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the topology builder pure and mounts it from the single composition root', () => {
    expect(workbenchSource).toMatch(/export function buildAuthoringWorkbench/);
    expect(workbenchSource).not.toMatch(/from\s+['"]\.\.\/(?:state|history|project-io|panels\/preview|panels\/timeline|panels\/issues|authoring-project-storage)/);
    expect(mainSource).toMatch(/const\s+workbench\s*=\s*buildAuthoringWorkbench\(\)/);
    expect(mainSource).toMatch(/renderSearchPanel\(workbench\.search\)/);
    expect(mainSource).not.toMatch(/const\s+sidebar\s*=\s*h\(\s*['"]aside['"]\s*\)/);
  });

  it('routes outline, search, and issue jumps through one scene/object coordinator', () => {
    const start = mainSource.indexOf('function jumpToScene(');
    const end = mainSource.indexOf('\nfunction ', start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const jumpSource = mainSource.slice(start, end);
    expect(jumpSource).toMatch(/state\.current\s*=\s*sceneKey/);
    expect(jumpSource).toMatch(/if\s*\(changedScene\)\s*state\.selectedObjectRef\s*=\s*null/);
    expect(jumpSource).toMatch(/dataset\.objectRef/);
    expect(jumpSource).toMatch(/selectAuthoringObject\(objectRef\)/);
    expect(jumpSource).toContain('surdet-authoring-selection');

    expect(mainSource).toMatch(/bindSidebarHooks\(\{[\s\S]*?onSelectScene:\s*\(sceneKey\)\s*=>\s*jumpToScene\(sceneKey\)/);
    expect(mainSource).toMatch(/bindSearchHooks\(\{[\s\S]*?onJump:\s*\(sceneKey,\s*line\)\s*=>\s*jumpToScene\(sceneKey,\s*line\)/);
    expect(mainSource).toMatch(/bindIssueNavigation\(\{[\s\S]*?onJump:\s*\(sceneKey,\s*line\)\s*=>\s*jumpToScene\(sceneKey,\s*line\)/);
    expect(mainSource).toMatch(/bindRightNavigation\(\{[\s\S]*?onJumpScene:\s*\(sceneKey\)\s*=>\s*jumpToScene\(sceneKey\)/);
    expect(issueSource).toMatch(/onIssueJumpHook\(key\s*,\s*Math\.max\(0,\s*issue\.line\s*-\s*1\)\)/);
    expect(issueSource).not.toMatch(/state\.current\s*=\s*key/);
    expect(rightSource).toMatch(/onSceneJumpHook\(/);
    expect(rightSource).not.toMatch(/state\.current\s*=\s*key/);
  });

  it('keeps script mode free of duplicate preview, trace, and timeline projections', () => {
    const editorBranchStart = mainSource.indexOf("if (state.mainTab === 'editor')");
    const nextBranch = mainSource.indexOf("} else if (state.mainTab === 'flow')", editorBranchStart);
    expect(editorBranchStart).toBeGreaterThanOrEqual(0);
    expect(nextBranch).toBeGreaterThan(editorBranchStart);
    const editorBranch = mainSource.slice(editorBranchStart, nextBranch);
    expect(editorBranch).not.toMatch(/iframe|renderPreviewPanel|renderTimelinePanel|previewTrace/i);
    expect(workbenchSource).not.toMatch(/iframe|renderPreviewPanel|renderTimelinePanel|previewTrace/i);
  });

  it('refreshes live dirty facts and inserted manuscript content without forking state', () => {
    expect(mainSource).toMatch(/onEdited:\s*\(\)\s*=>\s*\{[\s\S]*?renderSidebar\(\)[\s\S]*?refreshManuscriptFacts\(\)[\s\S]*?refreshCurrentSceneContext\(\)/);
    expect(mainSource).toMatch(/onSaveSettled:[\s\S]*?refreshManuscriptFacts\(\)[\s\S]*?refreshCurrentSceneContext\(\)/);
    expect(mainSource).toMatch(/bindAssetsPanelHooks\(\{[\s\S]*?onInserted:\s*\(\)\s*=>\s*renderEditor\(\)/);
    expect(assetSource).toMatch(/onInsertedHook\(\)/);
  });

  it('uses one flexible manuscript column with bounded, non-overlay auxiliaries', () => {
    expect(scriptWorkspaceCss.length, 'Wave 2 script workspace stylesheet must exist').toBeGreaterThan(0);
    const workbenchRules = ruleBodiesMatching(scriptWorkspaceCss, /\.authoring-workbench\s*$/i);
    expect(workbenchRules.length).toBeGreaterThan(0);
    expect(workbenchRules[0]).toMatch(
      /grid-template-columns\s*:\s*minmax\([^;]+\)\s+minmax\(0\s*,\s*1fr\)\s+minmax\([^;]+\)/i,
    );

    const auxiliaryRules = ruleBodiesMatching(
      scriptWorkspaceCss,
      /(?:\.authoring-outline|\.authoring-context|\[data-auxiliary-view)/i,
    );
    expect(auxiliaryRules.length).toBeGreaterThan(0);
    expect(auxiliaryRules.join('\n')).not.toMatch(/position\s*:\s*(?:fixed|absolute)/i);

    expect(scriptWorkspaceCss).toMatch(/@media\s*\(max-width:\s*1280px\)/i);
    expect(scriptWorkspaceCss).toMatch(/@media\s*\(max-width:\s*1024px\)/i);
    const compactStart = scriptWorkspaceCss.indexOf('@media (max-width: 820px)');
    expect(compactStart).toBeGreaterThanOrEqual(0);
    const compactRules = scriptWorkspaceCss.slice(compactStart);
    expect(compactRules).toMatch(/grid-template-rows\s*:\s*minmax\([^;]+\)\s+minmax\(0\s*,\s*1fr\)/i);
    expect(compactRules).toMatch(/\.authoring-context-toggle\s*\{[^}]*display\s*:\s*inline-flex/s);
    expect(compactRules).toMatch(/data-auxiliary-view="context"[^{]*#right\.authoring-context\s*\{[^}]*display\s*:\s*block/s);
  });

  it('keeps the activity rail beside a single scrolling work surface', () => {
    const frameRules = ruleBodiesMatching(appShellCss, /\.editor-application-frame\s*$/i);
    expect(frameRules.length).toBeGreaterThan(0);
    expect(frameRules[0]).toMatch(
      /grid-template-columns\s*:\s*var\(--surdet-shell-rail-width\)\s+minmax\(0\s*,\s*1fr\)/i,
    );
    expect(frameRules[0]).toMatch(/grid-template-rows\s*:\s*auto\s+minmax\(0\s*,\s*1fr\)/i);

    const emptyConflictHostRules = ruleBodiesMatching(
      appShellCss,
      /\.timeline-autosave-conflict-host:empty\s*$/i,
    );
    expect(emptyConflictHostRules.join('\n')).toMatch(/display\s*:\s*none/i);

    const surfaceRules = ruleBodiesMatching(appShellCss, /\.editor-mode-surface\s*$/i);
    expect(surfaceRules.join('\n')).toMatch(/grid-column\s*:\s*2/i);
    expect(surfaceRules.join('\n')).toMatch(/grid-row\s*:\s*2/i);

    const navigationRules = ruleBodiesMatching(appShellCss, /\.editor-mode-navigation\s*$/i);
    expect(navigationRules.length).toBeGreaterThan(0);
    expect(navigationRules[0]).toMatch(/flex-direction\s*:\s*column/i);
    expect(navigationRules[0]).toMatch(/grid-row\s*:\s*1\s*\/\s*-1/i);
    // Ten modes must stay reachable on short windows instead of being clipped.
    expect(navigationRules[0]).toMatch(/overflow-y\s*:\s*auto/i);
  });
});
