import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCalendarMap } from '../src/panels/calendar-map.js';
import type { RowMap } from '../src/config-edit.js';

class Element extends EventTarget {
  children: Element[] = [];
  parent?: Element;
  attributes = new Map<string, string>();
  style: Record<string, string> = {};
  classes = new Set<string>();
  classList = { add: (...names: string[]) => names.forEach(name => this.classes.add(name)) };
  captured = new Set<number>();
  textContent = '';
  constructor(readonly tag: string) { super(); }
  set innerHTML(_value: string) { this.children = []; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  appendChild(child: Element): Element { this.children.push(child); child.parent = this; return child; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 520 }; }
  setPointerCapture(id: number): void { this.captured.add(id); }
  hasPointerCapture(id: number): boolean { return this.captured.has(id); }
  releasePointerCapture(id: number): void { this.captured.delete(id); this.pointer('lostpointercapture', id); }
  pointer(type: string, id = 7, x = 150, y = 150): void {
    const event = Object.assign(new Event(type, { cancelable: true }), { pointerId: id, clientX: x, clientY: y });
    this.dispatchEvent(event);
  }
  find(name: string): Element | undefined { return this.classes.has(name) ? this : this.children.map(child => child.find(name)).find(Boolean); }
}

vi.mock('../src/state.js', () => ({
  h: (tag: string) => new Element(tag), setStatus: vi.fn(),
}));

describe('calendar map gesture termination', () => {
  beforeEach(() => { vi.stubGlobal('document', { createElementNS: (_namespace: string, tag: string) => new Element(tag) }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  for (const kind of ['node', 'port'] as const) for (const ending of ['pointercancel', 'lostpointercapture'] as const) {
    it(`${kind} clears ${ending}, ignores late move/up, and allows a fresh gesture`, () => {
      const rows: RowMap[] = [{ id: 'source', name: '起点', x: '150', y: '150', requires: '[]' }, { id: 'target', name: '终点', x: '500', y: '300', requires: '[]' }];
      const moved = vi.fn(), beforeEdit = vi.fn();
      const root = new Element('section');
      renderCalendarMap(root as unknown as HTMLElement, rows, moved, { onBeforeEdit: beforeEdit });
      const node = root.find('config-map-node')!;
      const target = kind === 'node' ? node : root.find('config-map-node-port')!;
      target.pointer('pointerdown'); target.pointer('pointermove', 7, 175, 170);
      const before = structuredClone(rows);
      if (ending === 'pointercancel') {
        target.captured.delete(7);
        target.pointer('pointercancel'); target.pointer('lostpointercapture');
      } else target.releasePointerCapture(7);
      expect(node.style.cursor).toBe('grab');
      expect(root.find('config-map-edge-preview')).toBeUndefined();
      expect(moved).toHaveBeenCalledTimes(kind === 'node' ? 1 : 0);
      target.pointer('pointermove', 7, 500, 300); target.pointer('pointerup', 7, 500, 300);
      expect(rows).toEqual(before);
      expect(moved).toHaveBeenCalledTimes(kind === 'node' ? 1 : 0);
      expect(beforeEdit).not.toHaveBeenCalled();
      target.pointer('pointerdown', 8);
      target.pointer('pointermove', 8, 500, 300); target.pointer('pointerup', 8, 500, 300);
      expect(moved).toHaveBeenCalledTimes(kind === 'node' ? 2 : 1);
      if (kind === 'node') expect(rows[0]).toMatchObject({ x: '500', y: '300' });
      else { expect(rows[1]!.requires).toBe('["source"]'); expect(beforeEdit).toHaveBeenCalledOnce(); }
      expect(root.find('config-map-edge-preview')).toBeUndefined();
    });
  }
});
