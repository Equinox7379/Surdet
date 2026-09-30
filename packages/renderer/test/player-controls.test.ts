import { Container, EventBoundary, FederatedEvent, FederatedPointerEvent, Rectangle } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { bindPlayerControl, markPlayerModal, PlayerFocusScope, isPlayerControlPointer } from '../src/player-controls.js';

function makeFocusHarness() {
  const root = new Container();
  const modal = new Container();
  const outside = new Container();
  root.addChild(modal, outside);
  markPlayerModal(modal, {});

  const modalControls = ['第一项', '第二项', '末项'].map((label) => {
    const control = new Container();
    bindPlayerControl(control, { label, width: 160, height: 48 });
    modal.addChild(control);
    return control;
  });
  bindPlayerControl(outside, { label: '模态框外', width: 160, height: 48 });

  let keydown: ((event: KeyboardEvent) => void) | undefined;
  const activeDocument = {
    activeElement: null as unknown,
    defaultView: {
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'keydown') keydown = listener as (event: KeyboardEvent) => void;
      },
      removeEventListener: vi.fn(),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const buttons = [
    ...modalControls,
    outside,
  ].map((container) => {
    const button = {
      container,
      tabIndex: 0,
      setAttribute: vi.fn(),
      style: {},
      focus: vi.fn(() => { activeDocument.activeElement = button; }),
    };
    return button;
  });
  const div = {
    querySelectorAll: () => buttons,
    contains: (element: unknown) => buttons.includes(element as typeof buttons[number]),
  };
  const runner = { add: vi.fn(), remove: vi.fn() };
  const renderer = {
    runners: { prerender: runner, postrender: runner },
    accessibility: { div },
  };
  const canvas = {
    ownerDocument: activeDocument,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
  const scope = new PlayerFocusScope(root, renderer as never, canvas, vi.fn());

  return { activeDocument, buttons, canvas, keydown: () => keydown!, modalControls, outside, scope };
}

describe('player control projection', () => {
  it('retains only the consumed native event after microtasks and control destruction', async () => {
    const target = new Container();
    bindPlayerControl(target, { label: '选择', width: 100, height: 40 });
    const event = new FederatedPointerEvent(new EventBoundary(target));
    const native = { button: 0, type: 'pointerdown' } as PointerEvent;
    event.nativeEvent = native;
    target.emit('pointerdowncapture', event);
    target.destroy();
    await Promise.resolve();
    expect(isPlayerControlPointer(native)).toBe(true);
    expect(isPlayerControlPointer({ button: 0, type: 'pointerdown' })).toBe(false);
  });

  it('marks modal backdrop events before a close/reset can detach the modal', async () => {
    const root = new Container(); markPlayerModal(root, {}); markPlayerModal(root, {});
    expect(root.listenerCount('pointerdowncapture')).toBe(1);
    root.removeAllListeners(); // backlog clears owned listeners when rebuilt
    markPlayerModal(root, {});
    expect(root.listenerCount('pointerdowncapture')).toBe(1);
    const event = new FederatedPointerEvent(new EventBoundary(root));
    event.nativeEvent = { button: 0 } as PointerEvent;
    root.emit('pointerdowncapture', event); root.destroy();
    await Promise.resolve();
    expect(isPlayerControlPointer(event.nativeEvent)).toBe(true);
  });
  it('excludes a replaced, non-rendered default modal from keyboard routing and native focus', async () => {
    const harness = makeFocusHarness();
    harness.modalControls[0]!.parent!.renderable = false;
    harness.activeDocument.activeElement = null;
    const event = { key: 'Tab', shiftKey: true, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() } as unknown as KeyboardEvent;
    harness.keydown()(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    harness.scope.postrender();
    await Promise.resolve();
    expect(harness.buttons.slice(0, 3).every(button => button.tabIndex === -1)).toBe(true);
    expect(harness.buttons[0]!.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    harness.modalControls[0]!.parent!.renderable = true;
    harness.scope.prerender(); harness.scope.postrender();
    await Promise.resolve();
    expect(harness.buttons[0]!.tabIndex).toBe(0);
    harness.scope.destroy();
  });

  it('does not reclaim focus from a connected work UI input after rendering', async () => {
    const harness = makeFocusHarness();
    harness.modalControls[0]!.parent!.visible = false;
    harness.scope.prerender();
    harness.activeDocument.activeElement = harness.buttons.at(-1)!;
    harness.scope.postrender(); await Promise.resolve();
    const input = { isConnected: true };
    harness.activeDocument.activeElement = input;
    harness.scope.postrender(); await Promise.resolve();
    expect(harness.activeDocument.activeElement).toBe(input);
    harness.scope.destroy();
  });

  it('allows native Tab to move from the nonmodal command rail into work UI controls', () => {
    const harness = makeFocusHarness();
    harness.modalControls[0]!.parent!.visible = false;
    harness.activeDocument.activeElement = harness.buttons.at(-1)!;
    const event = { key: 'Tab', shiftKey: false, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() } as unknown as KeyboardEvent;
    harness.keydown()(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    harness.scope.destroy();
  });

  it('keeps physical activation singular while bridging native accessible activation to the original handler', () => {
    const target = new Container();
    const activate = vi.fn();
    target.on('pointerdown', activate);
    bindPlayerControl(target, { label: '读取记录', x: -8, y: -8, width: 160, height: 48 });
    const pointer = new FederatedPointerEvent(new EventBoundary(target));
    target.emit('pointerdown', pointer);
    target.emit('click', pointer);
    expect(activate).toHaveBeenCalledTimes(1);
    target.emit('click', new FederatedEvent(new EventBoundary(target)) as FederatedPointerEvent);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(target.hitArea).toEqual(new Rectangle(-8, -8, 160, 48));
    expect(target.accessibleHint).toBe('读取记录');
    target.destroy();
  });

  it('does not dispatch an inaccessible action and exposes the reason in its accessible name', () => {
    const target = new Container(); const activate = vi.fn();
    target.on('pointerdown', activate);
    bindPlayerControl(target, { label: '尚未解锁', width: 160, height: 48, enabled: false });
    target.emit('click', new FederatedEvent(new EventBoundary(target)) as FederatedPointerEvent);
    expect(activate).not.toHaveBeenCalled();
    expect(target.accessibleHint).toContain('不可用');
    expect(target.tabIndex).toBe(-1);
    target.destroy();
  });

  it('reveals an offscreen focused control before applying its focus appearance', () => {
    const target = new Container(); const events: string[] = [];
    target.on('pointerover', () => events.push('focus'));
    bindPlayerControl(target, { label: '末项', width: 160, height: 48, reveal: () => events.push('reveal') });
    target.emit('mouseover', new FederatedEvent(new EventBoundary(target)) as FederatedPointerEvent);
    expect(events).toEqual(['reveal', 'focus']);
    target.destroy();
  });

  it.each([
    ['Shift+Tab', { key: 'Tab', shiftKey: true }],
    ['ArrowUp', { key: 'ArrowUp', shiftKey: false }],
  ])('modal 外焦点首次反向导航从末项开始：%s', (_label, key) => {
    const harness = makeFocusHarness();
    const outsideButton = harness.buttons.at(-1)!;
    harness.activeDocument.activeElement = outsideButton;
    const event = {
      ...key,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    harness.keydown()(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(harness.modalControls[2]!.accessibleTitle).toBe('末项');
    expect(harness.buttons[2]!.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(harness.buttons[0]!.focus).not.toHaveBeenCalled();
    harness.scope.destroy();
  });
});
