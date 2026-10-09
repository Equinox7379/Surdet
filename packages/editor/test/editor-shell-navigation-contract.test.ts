import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDITOR_MODE_GROUPS, EDITOR_MODES } from '../src/shell/editor-modes.js';
import { renderModeNavigation, renderProjectBar, renderStatusBar } from '../src/shell/app-shell.js';

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
      if (/^[a-z]+$/i.test(selector)) return element.tagName === selector.toUpperCase();
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('editor shell navigation contract', () => {
  it('defines the exact ten Chinese modes in stable order with unique panel ids', () => {
    expect(EDITOR_MODES.map(({ id }) => id)).toEqual([
      'editor', 'assets', 'flow', 'timeline', 'config',
      'preview', 'review', 'stats', 'history', 'audit',
    ]);
    expect(EDITOR_MODES.map(({ label }) => label)).toEqual([
      '剧本', '素材', '流程', '时间轴', '配置',
      '预览', '审阅', '统计', '历史', '审计',
    ]);
    expect(EDITOR_MODES.map(({ panelId }) => panelId)).toEqual([
      'editor-workspace', 'asset-center-view', 'flow-view', 'timeline-view', 'config-view',
      'preview-view', 'review-view', 'stats-view', 'history-view', 'audit-view',
    ]);
    expect(new Set(EDITOR_MODES.map(({ panelId }) => panelId)).size).toBe(EDITOR_MODES.length);
    expect(EDITOR_MODE_GROUPS).toEqual([
      { id: 'create', label: '创作' },
      { id: 'check', label: '检查' },
      { id: 'project', label: '项目' },
    ]);
    expect(EDITOR_MODES.map(({ group }) => group)).toEqual([
      'create', 'create', 'create', 'create', 'create',
      'check', 'check', 'project', 'project', 'project',
    ]);
  });

  it('renders semantic controls and dispatches every mode through the single callback', () => {
    vi.stubGlobal('document', documentStub);
    const selected: string[] = [];
    const navigation = renderModeNavigation('review', (mode) => selected.push(mode)) as unknown as FakeElement;
    const buttons = navigation.querySelectorAll('button');
    const groups = navigation.querySelectorAll('[data-mode-group]');

    expect(buttons).toHaveLength(EDITOR_MODES.length);
    expect(groups.map((group) => group.getAttribute('data-mode-group'))).toEqual([
      'create', 'check', 'project',
    ]);
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      '创作', '检查', '项目',
    ]);
    for (const [index, mode] of EDITOR_MODES.entries()) {
      const button = buttons[index]!;
      expect(button.textContent).toBe(mode.label);
      expect(button.getAttribute('data-editor-mode')).toBe(mode.id);
      expect(button.getAttribute('aria-controls')).toBe(mode.panelId);
      if (mode.id === 'review') expect(button.getAttribute('aria-current')).toBe('page');
      else expect(button.getAttribute('aria-current')).not.toBe('page');
      button.click();
    }

    expect(selected).toEqual(EDITOR_MODES.map(({ id }) => id));
  });

  it('separates product, context, search and commands in one title bar without changing action callbacks', () => {
    vi.stubGlobal('document', documentStub);
    const callbacks = {
      onOpenProject: vi.fn(),
      onOpenReview: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onSaveProject: vi.fn(),
    };
    const bar = renderProjectBar({
      projectName: '长安惊梦',
      objectLabel: '场景 雨夜抵达',
      saveState: 'saved',
      canUndo: true,
      canRedo: false,
    }, callbacks) as unknown as FakeElement;

    expect(bar.querySelectorAll('[data-editor-region]').map((node) => node.getAttribute('data-editor-region')))
      .toEqual([
        'project-bar',
        'product-identity',
        'project-context',
        'project-search',
        'global-commands',
      ]);
    expect(bar.querySelectorAll('[data-command-group]').map((node) => node.getAttribute('data-command-group')))
      .toEqual(['project', 'edit', 'save']);
    expect(bar.querySelectorAll('kbd').map((node) => node.textContent)).toEqual(['Ctrl+Z', 'Ctrl+Y', 'Ctrl+S']);
    expect(bar.textContent).toContain('Surdet');
    expect(bar.textContent).toContain('当前工作');
    expect(bar.textContent).toContain('长安惊梦');
  });

  it('keeps save state and operation feedback in a separate status bar landmark', () => {
    vi.stubGlobal('document', documentStub);
    const status = renderStatusBar({
      projectName: '长安惊梦',
      objectLabel: '场景 雨夜抵达',
      saveState: 'dirty',
      canUndo: true,
      canRedo: false,
    }, {}) as unknown as FakeElement;

    expect(status.tagName).toBe('FOOTER');
    expect(status.querySelectorAll('[data-editor-region]').map((node) => node.getAttribute('data-editor-region')))
      .toEqual(['status-bar', 'operation-feedback']);
    expect(status.textContent).toContain('有未保存修改');
  });
});
