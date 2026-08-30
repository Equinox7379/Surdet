import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderProjectBar, updateProjectBarProjection } from '../src/shell/app-shell.js';

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  className = '';
  disabled = false;
  type = '';
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
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  click(): void {
    if (!this.disabled) this.onclick?.();
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const match = (element: FakeElement): boolean => {
      if (selector === 'button') return element.tagName === 'BUTTON';
      if (selector.startsWith('.')) return element.className.split(/\s+/).includes(selector.slice(1));
      const data = /^\[data-([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
      if (data === null) return false;
      const value = element.getAttribute(`data-${data[1]}`);
      return value !== null && (data[2] === undefined || value === data[2]);
    };
    const visit = (element: FakeElement): void => {
      if (match(element)) found.push(element);
      for (const child of element.children) visit(child);
    };
    visit(this);
    return found;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

const documentStub = {
  createElement: (tag: string) => new FakeElement(tag),
};

const testDir = path.dirname(fileURLToPath(import.meta.url));
const reviewPanelSource = readFileSync(path.resolve(testDir, '../src/panels/review-panel.ts'), 'utf8');
const legacyStyles = readFileSync(path.resolve(testDir, '../src/styles.css'), 'utf8');
const componentStyles = readFileSync(path.resolve(testDir, '../src/styles/components.css'), 'utf8');

function ruleBodies(source: string, selector: RegExp): string[] {
  const matches: string[] = [];
  for (const match of source.matchAll(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, 'gsi'))) {
    matches.push((match[1] ?? '').replace(/\s+/g, ' ').trim());
  }
  return matches;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('editor action scope contract', () => {
  it('marks the project save as the unique global save action and keeps its callback intact', () => {
    vi.stubGlobal('document', documentStub);
    const callbacks = {
      onOpenProject: vi.fn(),
      onOpenReview: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onSaveProject: vi.fn(),
    };
    const bar = renderProjectBar({
      projectName: '当前项目',
      objectLabel: '场景 ch01_01',
      saveState: 'dirty',
      canUndo: true,
      canRedo: true,
    }, callbacks) as unknown as FakeElement;

    const saves = bar.querySelectorAll('[data-action="save-project"]');
    expect(saves).toHaveLength(1);
    expect(saves[0]!.getAttribute('data-action-scope')).toBe('global');
    expect(saves[0]!.textContent).toContain('保存全部');

    const actions = [
      ['open-project', callbacks.onOpenProject],
      ['open-review', callbacks.onOpenReview],
      ['undo', callbacks.onUndo],
      ['redo', callbacks.onRedo],
      ['save-project', callbacks.onSaveProject],
    ] as const;
    for (const [action, callback] of actions) {
      const button = bar.querySelector(`[data-action="${action}"]`);
      expect(button, `missing project action ${action}`).not.toBeNull();
      expect(button!.getAttribute('data-action-scope')).toBe('global');
      button!.click();
      expect(callback).toHaveBeenCalledTimes(1);
    }
  });

  it('refreshes project, object, and save facts without rebuilding command callbacks', () => {
    vi.stubGlobal('document', documentStub);
    const onSaveProject = vi.fn();
    const bar = renderProjectBar({
      projectName: '旧项目',
      objectLabel: '场景 ch01_01',
      saveState: 'dirty',
      canUndo: true,
      canRedo: true,
    }, {
      onOpenProject: vi.fn(),
      onOpenReview: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onSaveProject,
    }) as unknown as FakeElement;
    const saveButton = bar.querySelector('[data-action="save-project"]');

    updateProjectBarProjection({
      projectName: '新项目',
      objectLabel: '时间轴 opening',
      saveState: 'partial-failure',
    }, bar as unknown as ParentNode);

    expect(bar.querySelector('.editor-project-name')!.textContent).toBe('新项目');
    expect(bar.querySelector('.editor-current-object')!.textContent).toBe('时间轴 opening');
    expect(bar.querySelector('.editor-save-state')!.textContent).toBe('保存后仍有未保存修改');
    expect(bar.querySelector('.editor-save-state')!.getAttribute('data-save-state')).toBe('partial-failure');
    expect(bar.querySelector('[data-action="save-project"]')).toBe(saveButton);
    saveButton!.click();
    expect(onSaveProject).toHaveBeenCalledTimes(1);
  });

  it('keeps decision saving workspace-scoped and gives the two scopes distinct style identities', () => {
    const appendStart = reviewPanelSource.indexOf('function appendDecisionButton(');
    const appendEnd = reviewPanelSource.indexOf('\nfunction renderObjectDetails(', appendStart);
    expect(appendStart).toBeGreaterThanOrEqual(0);
    expect(appendEnd).toBeGreaterThan(appendStart);
    const appendDecisionButtonSource = reviewPanelSource.slice(appendStart, appendEnd);
    expect(appendDecisionButtonSource).toMatch(
      /button\.setAttribute\(\s*['"]data-action-scope['"]\s*,\s*['"]workspace['"]\s*\)/,
    );

    const expectedStaticWorkspaceActions = [
      'preview-result',
      'approve-result',
      'return-result',
      'reload-official-result',
      'refresh-result-tree',
    ];
    for (const action of expectedStaticWorkspaceActions) {
      const actionLine = new RegExp(
        `(\\w+)\\.setAttribute\\(\\s*['"]data-action['"]\\s*,\\s*['"]${action}['"]\\s*\\);`,
      ).exec(reviewPanelSource);
      expect(actionLine, `missing review action ${action}`).not.toBeNull();
      const buttonName = actionLine![1]!;
      const followingSource = reviewPanelSource.slice(
        actionLine!.index,
        actionLine!.index + actionLine![0].length + 160,
      );
      expect(followingSource).toMatch(new RegExp(
        `${buttonName}\\.setAttribute\\(\\s*['"]data-action-scope['"]\\s*,\\s*['"]workspace['"]\\s*\\)`,
      ));
    }
    expect(reviewPanelSource.match(/data-editor-region['"]\s*,\s*['"]workspace-actions/g)).toHaveLength(2);

    const globalRules = ruleBodies(componentStyles, /\[data-action-scope=["']global["']\]/);
    const workspaceRules = ruleBodies(componentStyles, /\[data-action-scope=["']workspace["']\]/);
    expect(globalRules.length).toBeGreaterThan(0);
    expect(workspaceRules.length).toBeGreaterThan(0);
    expect(new Set(globalRules)).not.toEqual(new Set(workspaceRules));
  });

  it('keeps workspace actions in document flow instead of pinning them to the viewport', () => {
    const operationRules = [
      ...ruleBodies(legacyStyles, /\.review-operations/),
      ...ruleBodies(componentStyles, /\.review-operations/),
      ...ruleBodies(componentStyles, /\[data-action-scope=["']workspace["']\]/),
    ];
    expect(operationRules.length).toBeGreaterThan(0);
    for (const rule of operationRules) {
      expect(rule).not.toMatch(/position\s*:\s*(?:fixed|sticky)/i);
      expect(rule).not.toMatch(/(?:^|[;\s])bottom\s*:/i);
      expect(rule).not.toMatch(/inset(?:-block-end)?\s*:/i);
    }
  });
});
