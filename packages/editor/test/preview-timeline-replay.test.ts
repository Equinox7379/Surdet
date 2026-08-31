import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPreviewPanel } from '../src/panels/preview-panel.js';
import { state } from '../src/state.js';

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  className = '';
  checked = false;
  src = '';
  title = '';
  type = '';
  value = '';
  onclick: (() => void) | null = null;
  onchange: (() => void) | null = null;
  contentWindow: { postMessage: () => void } | null = null;
  private ownText = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  set innerHTML(value: string) {
    if (value === '') {
      this.ownText = '';
      this.children.splice(0);
    }
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

  setAttribute(): void {}

  querySelector(tagName: string): FakeElement | null {
    const expected = tagName.toUpperCase();
    const visit = (element: FakeElement): FakeElement | null => {
      if (element.tagName === expected) return element;
      for (const child of element.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this);
  }

  findButton(label: string): FakeElement | null {
    const visit = (element: FakeElement): FakeElement | null => {
      if (element.tagName === 'BUTTON' && element.textContent === label) return element;
      for (const child of element.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this);
  }
}

const documentStub = {
  createElement: (tag: string) => new FakeElement(tag),
  createTextNode: (text: string) => {
    const node = new FakeElement('#text');
    node.textContent = text;
    return node;
  },
  getElementById: () => null,
};

const originalState = {
  current: state.current,
  previewTimelineId: state.previewTimelineId,
  reviewWorkspace: state.reviewWorkspace,
  scenes: state.scenes,
};

afterEach(() => {
  vi.unstubAllGlobals();
  state.current = originalState.current;
  state.previewTimelineId = originalState.previewTimelineId;
  state.reviewWorkspace = originalState.reviewWorkspace;
  state.scenes = originalState.scenes;
});

describe('timeline preview replay', () => {
  it('keeps direct timeline identity on reload and clears it only after choosing a normal scene entry', () => {
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', { addEventListener: vi.fn() });
    state.current = 'intro.gal';
    state.scenes = new Map([
      ['intro.gal', {
        id: 'intro',
        file: 'intro.gal',
        text: '@scene intro\n@label start\n凛：你好\n@end',
        eol: '\n',
        dirty: false,
        handle: null,
      }],
    ]);
    state.reviewWorkspace = null;
    state.previewTimelineId = 'opening';
    const container = new FakeElement('div');

    renderPreviewPanel(container as unknown as HTMLElement);
    const reload = container.findButton('▶ 播放 / 重载');
    expect(reload).not.toBeNull();
    reload!.onclick?.();
    expect(state.previewTimelineId).toBe('opening');

    const entrySelector = container.querySelector('select');
    expect(entrySelector).not.toBeNull();
    entrySelector!.value = 'start';
    entrySelector!.onchange?.();
    expect(state.previewTimelineId).toBeNull();
  });
});
