import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ScriptTarget, transpileModule } from 'typescript';
import { actionForKeyboardEvent } from '../src/keybindings.js';

const consumers = [
  { file: '../../../examples/shared/player/player.ts', kind: 'shared' },
  { file: '../../../examples/zero-after-midnight/src/main.ts', kind: 'zero' },
  { file: '../../editor/src/preview.ts', kind: 'preview' },
] as const;

function keyboard(kind: typeof consumers[number]['kind'], source: string, preset = 'standard', settingsOpen = false) {
  const dispatchInput = vi.fn(), routeGameAction = vi.fn();
  const renderer = { status: 'choice', backlogOpen: false, dispatchInput };
  let handler!: (event: KeyboardEvent) => void;
  const start = source.indexOf(kind === 'shared' ? '  const keyboardHandler ='
    : kind === 'zero' ? "  window.addEventListener('keydown', (e) => {" : "  previewLifecycle.listen(window, 'keydown', (e) => {",
  kind === 'zero' ? source.indexOf('  // 键位：') : 0);
  const end = source.indexOf(kind === 'shared' ? "  window.addEventListener('keydown', keyboardHandler);"
    : kind === 'zero' ? '  // 调试钩子：' : "  previewLifecycle.listen(window, 'keyup'", start);
  if (start < 0 || end < 0) throw new Error(`Keyboard handler not found: ${kind}`);
  const env = {
    renderer, controller: renderer, routeGameAction, actionForKeyboardEvent,
    settings: { settings: { keyPreset: preset, skipStrategy: 0 } },
    SKIP_STRATEGY_ALL: 1,
    interp: { status: 'awaiting-advance' }, uiDom: null,
    isTitleScreen: () => false, gameResourcesDisposed: false,
    isOverlay: (name: string) => name === 'backlog' && renderer.backlogOpen,
    systemMenuOpen: false, saveLoadOpen: false, settingsOpen,
    refreshCommandRail: vi.fn(), openSystemMenu: vi.fn(), ctrlTempSkip: false,
    uiSession: { toggleInterface: vi.fn() }, toggleBacklog: vi.fn(),
    uiSnapshot: () => ({ interfaceHidden: false }), console: { info: vi.fn() },
    window: { addEventListener: (_name: string, callback: typeof handler) => { handler = callback; } },
    previewLifecycle: { listen: (_target: unknown, _name: string, callback: typeof handler) => { handler = callback; } },
  };
  const body = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  const result = new Function(...Object.keys(env), body + (kind === 'shared' ? '\nreturn keyboardHandler;' : ''))(...Object.values(env));
  if (kind === 'shared') handler = result;
  const press = (key: string, code: string, repeat = false) => handler({ key, code, repeat, ctrlKey: false, altKey: false, metaKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent);
  return { press, renderer, dispatchInput, routeGameAction, env };
}

describe.each(consumers)('D6/D7 actual keyboard consumer $kind', ({ file, kind }) => {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  it.each(['1', '2', '9'])('routes digit %s by displayed position', key => {
    const input = keyboard(kind, source);
    input.press(key, `Digit${key}`);
    expect(input.dispatchInput).toHaveBeenCalledWith({ type: 'choice.select-visible', position: Number(key) - 1 });
  });
  it.each(['a', 's', 'x', 'l', 'h'])('does not toggle %s again on repeat', key => {
    const input = keyboard(kind, source);
    input.renderer.status = 'awaiting';
    input.press(key, `Key${key.toUpperCase()}`);
    expect(input.dispatchInput.mock.calls.length + input.routeGameAction.mock.calls.length).toBe(1);
    input.dispatchInput.mockClear(); input.routeGameAction.mockClear();
    input.press(key, `Key${key.toUpperCase()}`, true);
    expect(input.dispatchInput).not.toHaveBeenCalled();
    expect(input.routeGameAction).not.toHaveBeenCalled();
    expect(input.env.uiSession.toggleInterface.mock.calls.length).toBeLessThanOrEqual(1);
  });
  it.each(['a', 's', 'x', 'l', 'h'])('also rejects repeated %s from the key fallback', key => {
    const input = keyboard(kind, source);
    input.press(key, '', true);
    expect(input.dispatchInput).not.toHaveBeenCalled();
    expect(input.env.toggleBacklog).not.toHaveBeenCalled();
    expect(input.env.uiSession.toggleInterface).not.toHaveBeenCalled();
  });
  it.each([[' ', 'Space'], ['Enter', 'Enter']])('keeps %s advance repeat', (key, code) => {
    const input = keyboard(kind, source);
    input.renderer.status = 'awaiting';
    input.press(key, code); input.press(key, code, true);
    expect(input.dispatchInput.mock.calls.length + input.routeGameAction.mock.calls.length).toBe(2);
  });
  if (kind !== 'preview') {
    it.each(['j', 'k', 'i', 'y'])('rejects left-handed toggle %s repeat', key => {
      const input = keyboard(kind, source, 'left-handed');
      input.press(key, `Key${key.toUpperCase()}`, true);
      expect(input.routeGameAction).not.toHaveBeenCalled();
    });
  } else {
    it('does not close backlog repeatedly or let digits/advance through an existing modal', () => {
      const input = keyboard(kind, source);
      input.renderer.backlogOpen = true;
      input.press('l', 'KeyL', true);
      expect(input.dispatchInput).not.toHaveBeenCalled();
      const modal = keyboard(kind, source, 'standard', true);
      modal.press('1', 'Digit1'); modal.press('Enter', 'Enter', true);
      expect(modal.dispatchInput).not.toHaveBeenCalled();
    });
  }
});
