import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDITOR_MODES } from '../src/shell/editor-modes.js';
import { renderModeNavigation } from '../src/shell/app-shell.js';

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
}

const documentStub = {
  createElement: (tag: string) => new FakeElement(tag),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('editor shell navigation contract', () => {
  it('defines the exact eight Chinese modes in stable order with unique panel ids', () => {
    expect(EDITOR_MODES.map(({ id }) => id)).toEqual([
      'editor', 'flow', 'timeline', 'config',
      'preview', 'review', 'stats', 'audit',
    ]);
    expect(EDITOR_MODES.map(({ label }) => label)).toEqual([
      '剧本', '流程', '时间轴', '配置',
      '预览', '审阅', '统计', '审计',
    ]);
    expect(EDITOR_MODES.map(({ panelId }) => panelId)).toEqual([
      'editor-workspace', 'flow-view', 'timeline-view', 'config-view',
      'preview-view', 'review-view', 'stats-view', 'audit-view',
    ]);
    expect(new Set(EDITOR_MODES.map(({ panelId }) => panelId)).size).toBe(EDITOR_MODES.length);
  });

  it('renders semantic controls and dispatches every mode through the single callback', () => {
    vi.stubGlobal('document', documentStub);
    const selected: string[] = [];
    const navigation = renderModeNavigation('review', (mode) => selected.push(mode)) as unknown as FakeElement;
    const buttons = navigation.querySelectorAll('button');

    expect(buttons).toHaveLength(EDITOR_MODES.length);
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
});
