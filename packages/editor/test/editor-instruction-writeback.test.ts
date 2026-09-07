import { afterEach, describe, it, vi } from 'vitest';
import { bindHistoryHooks } from '../src/history.js';
import { instructionWritebackCases } from './support/instruction-writeback-cases.js';

/** Only DOM plumbing is substituted; renderEditor, model and history are real. */
class ElementFixture {
  readonly tagName: string;
  readonly children: ElementFixture[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  private listeners = new Map<string, Array<(event: Event) => void>>();
  parentElement: ElementFixture | null = null;
  root = false;
  id = '';
  className = '';
  value = '';
  textContent = '';
  selected = false;
  hidden = false;
  disabled = false;
  oninput: ((event: Event) => void) | null = null;
  onchange: ((event: Event) => void) | null = null;
  onclick: ((event: Event) => void) | null = null;

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get isConnected(): boolean { return this.root || this.parentElement?.isConnected === true; }
  set innerHTML(value: string) {
    if (value !== '') throw new Error('This fixture does not parse HTML');
    this.replaceChildren();
  }
  get innerHTML(): string { return ''; }
  get classList() {
    const tokens = () => new Set(this.className.split(/\s+/).filter(Boolean));
    return {
      add: (...names: string[]) => { this.className = [...new Set([...tokens(), ...names])].join(' '); },
      remove: (...names: string[]) => { this.className = [...tokens()].filter((name) => !names.includes(name)).join(' '); },
      toggle: (name: string, force?: boolean) => {
        const enabled = force ?? !tokens().has(name);
        if (enabled) this.classList.add(name); else this.classList.remove(name);
        return enabled;
      },
    };
  }
  appendChild(child: ElementFixture): ElementFixture {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...children: ElementFixture[]): void { children.forEach((child) => this.appendChild(child)); }
  removeChild(child: ElementFixture): void {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
  }
  replaceChildren(...children: ElementFixture[]): void {
    [...this.children].forEach((child) => this.removeChild(child));
    this.append(...children);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'id') this.id = value;
    if (name === 'class') this.className = value;
  }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  getAttribute(name: string): string | null {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
      return this.dataset[key] ?? this.attributes.get(name) ?? null;
    }
    return this.attributes.get(name) ?? null;
  }
  addEventListener(name: string, callback: (event: Event) => void): void {
    const callbacks = this.listeners.get(name) ?? [];
    callbacks.push(callback);
    this.listeners.set(name, callbacks);
  }
  dispatchEvent(event: Event): boolean {
    const handler = event.type === 'input' ? this.oninput : event.type === 'change' ? this.onchange : this.onclick;
    if (event.type === 'input' || event.type === 'change' || event.type === 'click') handler?.(event);
    this.listeners.get(event.type)?.forEach((callback) => callback(event));
    return true;
  }
  private matchesSimple(selector: string): boolean {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attr) return attr[2] === undefined ? this.getAttribute(attr[1]!) !== null : this.getAttribute(attr[1]!) === attr[2];
    return this.tagName === selector.toUpperCase();
  }
  private matchesSelector(selector: string): boolean {
    const parts = selector.trim().split(/\s+/);
    if (!this.matchesSimple(parts.pop()!)) return false;
    let ancestor = this.parentElement;
    while (parts.length > 0) {
      const part = parts.pop()!;
      while (ancestor && !ancestor.matchesSimple(part)) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  }
  querySelectorAll(selector: string): ElementFixture[] {
    const selectors = selector.split(',');
    const result: ElementFixture[] = [];
    const visit = (element: ElementFixture): void => {
      for (const child of element.children) {
        if (selectors.some((part) => child.matchesSelector(part))) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
  querySelector(selector: string): ElementFixture | null { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector: string): ElementFixture | null {
    let current: ElementFixture | null = this;
    while (current) {
      if (selector.split(',').some((part) => current!.matchesSelector(part))) return current;
      current = current.parentElement;
    }
    return null;
  }
}

function installDocument(): void {
  const body = new ElementFixture('body');
  body.root = true;
  vi.stubGlobal('document', {
    body,
    createElement: (tag: string) => new ElementFixture(tag),
    getElementById: (id: string) => body.querySelector(`#${id}`),
    querySelector: (selector: string) => body.querySelector(selector),
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
  });
}

describe('actual Editor instruction writeback and history', () => {
  afterEach(() => {
    bindHistoryHooks({ onEdited: () => {}, onHistoryNav: () => {} });
    vi.unstubAllGlobals();
  });
  for (const testCase of instructionWritebackCases) {
    it(testCase.name, () => {
      installDocument();
      testCase.run();
    });
  }
});
