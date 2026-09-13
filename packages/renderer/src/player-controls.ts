import { Container, FederatedPointerEvent, Rectangle, type FederatedEvent, type Renderer } from 'pixi.js';

interface PlayerControl {
  label: string;
  enabled?: boolean;
  adjust?: (direction: -1 | 1) => void;
  reveal?: () => void;
}

interface PlayerModal {
  close?: () => void;
  scroll?: (delta: number) => void;
  /** Let an existing owner handle its own editing keys (for example backlog search). */
  allowKey?: (event: KeyboardEvent) => boolean;
}

const controls = new WeakMap<Container, PlayerControl>();
const modals = new WeakMap<Container, PlayerModal>();

/** Project the same Pixi control to the built-in accessibility layer. No action state is stored here. */
export function bindPlayerControl(
  target: Container,
  options: PlayerControl & { width: number; height: number; x?: number; y?: number },
): void {
  target.hitArea = new Rectangle(options.x ?? 0, options.y ?? 0, options.width, options.height);
  target.accessible = true;
  target.accessibleType = 'button';
  target.accessibleTitle = options.label;
  target.accessibleHint = options.enabled === false ? `${options.label}（不可用）` : options.label;
  // Keep mouse/touch on the original canvas path. DOM buttons serve keyboard and assistive input.
  target.accessiblePointerEvents = 'none';
  target.tabIndex = options.enabled === false ? -1 : 0;
  target.eventMode = 'static';
  controls.set(target, options);
  target.on('click', (event: FederatedEvent) => {
    // Pixi accessibility emits a FederatedEvent; a physical click is a FederatedPointerEvent.
    // Forward only the former, otherwise a pointerdown action would execute twice.
    if (!(event instanceof FederatedPointerEvent) && !('pointerId' in event) && controls.get(target)?.enabled !== false) {
      event.stopPropagation?.();
      target.emit('pointerdown', event as FederatedPointerEvent);
    }
  });
  target.on('mouseover', (event: FederatedEvent) => {
    if (!(event instanceof FederatedPointerEvent) && !('pointerId' in event)) {
      controls.get(target)?.reveal?.();
      target.emit('pointerover', event as FederatedPointerEvent);
    }
  });
  target.on('mouseout', (event: FederatedEvent) => {
    if (!(event instanceof FederatedPointerEvent) && !('pointerId' in event)) target.emit('pointerout', event as FederatedPointerEvent);
  });
}

export function markPlayerModal(root: Container, options: PlayerModal): void {
  modals.set(root, options);
}

type AccessibleButton = HTMLButtonElement & { container?: Container };

/** Owns only focus and event containment for the currently drawn player surface. */
export class PlayerFocusScope {
  readonly #root: Container;
  readonly #renderer: Renderer;
  readonly #canvas: HTMLCanvasElement;
  readonly #requestFrame: () => void;
  readonly #remembered = new WeakMap<Container, string>();
  #modal: Container | null = null;
  #restoreLabel: string | undefined;
  #lastFocus: string | undefined;
  #lastScope: Container;
  #suppressed: Container[] = [];
  #disposed = false;

  constructor(root: Container, renderer: Renderer, canvas: HTMLCanvasElement, requestFrame: () => void) {
    this.#root = root;
    this.#lastScope = root;
    this.#renderer = renderer;
    this.#canvas = canvas;
    this.#requestFrame = requestFrame;
    renderer.runners.prerender.add(this);
    renderer.runners.postrender.add(this);
    canvas.ownerDocument.defaultView?.addEventListener('keydown', this.#onKeyDown, true);
    canvas.ownerDocument.addEventListener('focusin', this.#onFocus);
    canvas.addEventListener('wheel', this.#onWheel, { passive: false });
  }

  prerender(): void {
    for (const node of this.#suppressed) node.accessibleChildren = true;
    this.#suppressed = [];
    let modal: Container | null = null;
    const visit = (node: Container): void => {
      if (!node.visible) return;
      if (modals.has(node)) modal = node;
      for (const child of node.children) visit(child);
    };
    visit(this.#root);
    this.#modal = modal;
    if (modal) {
      let active: Container = modal;
      while (active !== this.#root && active.parent) {
        for (const sibling of active.parent.children) {
          if (sibling !== active && sibling.accessibleChildren) {
            sibling.accessibleChildren = false;
            this.#suppressed.push(sibling);
          }
        }
        active = active.parent;
      }
    }
    const scope = modal ?? this.#root;
    if (scope !== this.#lastScope) {
      if (this.#lastFocus) this.#remembered.set(this.#lastScope, this.#lastFocus);
      this.#restoreLabel = this.#remembered.get(scope);
      this.#lastScope = scope;
      this.#lastFocus = undefined;
    }
  }

  postrender(): void {
    // Accessibility may attach after the canvas enters the DOM; run after every postrender runner.
    queueMicrotask(() => { if (!this.#disposed) this.#syncDom(); });
  }

  #syncDom(): void {
    const div = this.#renderer.accessibility?.div;
    if (!div) return;
    for (const button of Array.from(div.querySelectorAll<AccessibleButton>('button'))) {
      const control = button.container && controls.get(button.container);
      if (!control) continue;
      button.setAttribute('aria-disabled', String(control.enabled === false));
      button.tabIndex = control.enabled === false ? -1 : 0;
      // The library pools DOM nodes. Refresh names rather than retaining another control's label.
      button.setAttribute('aria-label', button.container!.accessibleHint ?? control.label);
      button.style.outlineOffset = '-3px';
    }
    const active = this.#canvas.ownerDocument.activeElement as (HTMLElement & { container?: Container }) | null;
    const control = active?.container && controls.get(active.container);
    if (control && div.contains(active)) {
      this.#lastFocus = control.label;
      this.#restoreLabel = undefined;
      return;
    }
    const buttons = this.#buttons();
    const restored = buttons.find((button) => controls.get(button.container!)?.label === (this.#restoreLabel ?? this.#lastFocus));
    if (restored) {
      restored.focus({ preventScroll: true });
      this.#restoreLabel = undefined;
    } else if (this.#modal && buttons.length && (!active || active === this.#canvas.ownerDocument.body || active === this.#canvas)) {
      buttons[0]!.focus({ preventScroll: true });
    }
  }

  #buttons(): AccessibleButton[] {
    const div = this.#renderer.accessibility?.div;
    return div ? Array.from(div.querySelectorAll<AccessibleButton>('button')).filter((button) =>
      button.container && this.#inScope(button.container) && controls.get(button.container)?.enabled !== false && button.tabIndex >= 0) : [];
  }

  #inScope(target: Container): boolean {
    let current: Container | null = target;
    while (current) {
      if (!current.visible || current.destroyed) return false;
      if (current === (this.#modal ?? this.#root)) return true;
      current = current.parent;
    }
    return false;
  }

  #onFocus = (event: FocusEvent): void => {
    if (event.target instanceof Node && this.#renderer.accessibility?.div?.contains(event.target)) {
      const target = event.target as AccessibleButton;
      this.#lastFocus = target.container ? controls.get(target.container)?.label : undefined;
      this.#requestFrame();
    }
  };

  #onWheel = (event: WheelEvent): void => {
    this.prerender();
    if (!this.#modal) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    modals.get(this.#modal)?.scroll?.(event.deltaY);
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    // The opening action can be followed by another key before the next rendered frame.
    // Derive the scope from current projection visibility, never from the previous frame.
    this.prerender();
    const buttons = this.#buttons();
    const active = this.#canvas.ownerDocument.activeElement as AccessibleButton | null;
    const index = active ? buttons.indexOf(active) : -1;
    if (!this.#modal && index < 0) return;
    if (!this.#modal && !['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return;
    if (this.#modal && modals.get(this.#modal)?.allowKey?.(event)) return;
    // DOM focus navigation must never also reach the host's story shortcuts.
    event.stopImmediatePropagation();
    if (event.key === 'Escape' && this.#modal) {
      event.preventDefault();
      modals.get(this.#modal)?.close?.();
    } else if (event.key === 'Tab' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
      if (buttons.length) {
        const nextIndex = index < 0 && direction < 0
          ? buttons.length - 1
          : (index + direction + buttons.length) % buttons.length;
        buttons[nextIndex]!.focus({ preventScroll: true });
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const adjust = active?.container && controls.get(active.container)?.adjust;
      adjust?.(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      if (this.#modal) modals.get(this.#modal)?.scroll?.(event.key === 'PageUp' ? -240 : 240);
    }
    // Enter and Space retain native button activation; no second action is dispatched here.
  };

  destroy(): void {
    this.#disposed = true;
    this.#canvas.ownerDocument.defaultView?.removeEventListener('keydown', this.#onKeyDown, true);
    this.#canvas.removeEventListener('wheel', this.#onWheel);
    this.#canvas.ownerDocument.removeEventListener('focusin', this.#onFocus);
    this.#renderer.runners.prerender.remove(this);
    this.#renderer.runners.postrender.remove(this);
    for (const node of this.#suppressed) node.accessibleChildren = true;
    this.#suppressed = [];
  }
}
