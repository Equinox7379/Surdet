import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget } from 'typescript';
import { rendererInputForGamepadAction, rendererInputForGameAction } from '@surdet/renderer';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, type CoreEventMap } from '@surdet/core';
import { PLAYER_SHELL_SLOT_IDS, createPlayerShellSlotRegistry, createPlayerShellController } from '@surdet/host';
import {
  PlayerInputGate,
  canAdvance,
  type PointerDecision,
} from '@surdet/host';

describe('A025 Zero gallery entry', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const match = /onReplayText: \(item:[^\n]+\) => \{([\s\S]*?)\n      \},/.exec(source);
  if (!match) throw new Error('Zero gallery callback not found');
  const createCallback = new Function('playerShell', 'interp', 'menu', `return item => {${match[1]!.replaceAll('playerShell!', 'playerShell')}\n};`);
  it.each(['game', 'title'] as const)('enters playable story from %s without re-opening the title under it', base => {
    const scenes = new SceneRegistry();
    scenes.register(compileScene('@unlock_text memory\n原进度\n@end', 'source.gal', 'source'));
    scenes.register(compileScene('回想第一句\n回想第二句\n@end', 'memory.gal', 'memory'));
    const interp = new Interpreter(new VariableStore(), new EventBus<CoreEventMap>(), scenes);
    interp.start('source'); if (base === 'title') interp.pauseHost();
    const defaults = Object.fromEntries(PLAYER_SHELL_SLOT_IDS.map(id => [id, { id, open: vi.fn(), close: vi.fn() }]));
    const shell = createPlayerShellController({ slots: createPlayerShellSlotRegistry({ defaults }), session: createPlayerUiSession({ base }) });
    shell.commands.open({ slot: 'gallery', source: base });
    const menu = { hideTitle: vi.fn() };
    createCallback(shell, interp, menu)({ id: 'memory', scene: 'memory' });
    expect(shell.queries.canAdvance()).toBe(true);
    expect(shell.queries.snapshot()).toMatchObject({ base: 'game', overlay: 'none' });
    expect(menu.hideTitle).toHaveBeenCalledOnce();
    expect(interp.position?.sceneId).toBe('memory');
    const first = interp.position?.pc; interp.advance();
    expect(interp.position?.pc).not.toBe(first);
    shell.commands.open({ slot: 'gallery', source: 'game' }); shell.commands.close();
    expect(shell.queries.canAdvance()).toBe(true);
  });
});

describe.each(['../../shared/player/player.ts', '../src/main.ts'])('A011 actual Player consumer %s', file => {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const from = source.indexOf('  const gamepad = new GamepadPoller(');
  const to = source.indexOf('\n  gamepad.start();', from);
  if (from < 0 || to < 0) throw new Error('Player gamepad callback not found');
  const body = transpileModule(source.slice(from, to), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
  it('keyboard backlog opens the Shell pause before a following advance', () => {
    const start = source.indexOf('  function routeGameAction('), end = source.indexOf('  // 键位：', start);
    if (start < 0 || end < 0) throw new Error('Keyboard action router not found');
    const route = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
    const session = createPlayerUiSession({ base: 'game' });
    const dispatchInput = vi.fn();
    const openBacklog = () => session.openOverlay('backlog');
    const action = new Function('playerShell', 'interp', 'renderer', 'openBacklog', 'toggleBacklog', 'rendererInputForGameAction', 'refreshCommandRail', route + '\nreturn routeGameAction;')(
      { queries: { canAdvance: () => canAdvance(session.snapshot()) } }, { status: 'awaiting-advance' }, { status: 'dialogue', dispatchInput }, openBacklog, openBacklog, rendererInputForGameAction, () => {});
    action('backlog'); expect(session.snapshot().overlay).toBe('backlog');
    action('advance'); expect(dispatchInput).not.toHaveBeenCalled();
    session.closeOverlay(); action('advance'); expect(dispatchInput).toHaveBeenCalledWith({ type: 'advance' });
  });
  it.each(['none', 'backlog', 'settings', 'save-load'] as const)('respects %s and keeps the menu action available', overlay => {
    const session = createPlayerUiSession({ base: 'game' });
    if (overlay !== 'none') session.openOverlay(overlay);
    let input!: (actions: string[]) => void;
    class Gamepad { constructor(callback: typeof input) { input = callback; } }
    const dispatchInput = vi.fn(), openSystemMenu = vi.fn();
    new Function('GamepadPoller', 'isTitleScreen', 'playerShell', 'interp', 'renderer', 'openSystemMenu', 'rendererInputForGamepadAction', 'refreshCommandRail', body)(
      Gamepad, () => false, { queries: { canAdvance: () => canAdvance(session.snapshot()) } }, { status: 'awaiting-choice' },
      { status: 'choice', skipMode: false, dispatchInput }, openSystemMenu, rendererInputForGamepadAction, () => {});
    input(['advance', 'up', 'down', 'shoulderRight']);
    expect(dispatchInput.mock.calls.length).toBe(overlay === 'none' ? 4 : 0);
    input(['menu']); expect(openSystemMenu).toHaveBeenCalledOnce();
  });
});
import {
  createPlayerUiSession,
  type PlayerUiSessionSnapshot,
} from '@surdet/host';

function decide(
  gate: PlayerInputGate,
  snapshot: PlayerUiSessionSnapshot,
  button = 0,
): PointerDecision {
  return gate.decidePointer(snapshot, { button });
}

describe('PlayerInputGate', () => {
  it('advances only for a primary pointer on visible game content', () => {
    const gate = new PlayerInputGate();
    const snapshot = createPlayerUiSession({ base: 'game' }).snapshot();

    expect(decide(gate, snapshot)).toBe('advance');
    expect(decide(gate, snapshot, 2)).toBe('ignore');
    expect(decide(gate, snapshot, 1)).toBe('ignore');
  });

  it('turns a UI callback into one consumed pointer without leaking to the next pointer', () => {
    const gate = new PlayerInputGate();
    const snapshot = createPlayerUiSession({ base: 'game' }).snapshot();

    gate.consumeCurrentPointer();
    expect(decide(gate, snapshot)).toBe('ignore');
    expect(decide(gate, snapshot)).toBe('advance');
  });

  it('ignores every primary pointer while an overlay is open', () => {
    const gate = new PlayerInputGate();
    const session = createPlayerUiSession({ base: 'game' });
    session.openOverlay('backlog');

    expect(decide(gate, session.snapshot())).toBe('ignore');
  });

  it('restores a hidden interface on the first primary pointer without advancing', () => {
    const gate = new PlayerInputGate();
    const session = createPlayerUiSession({ base: 'game' });
    session.setInterfaceHidden(true);

    expect(decide(gate, session.snapshot())).toBe('restore-interface');
    session.setInterfaceHidden(false);
    expect(decide(gate, session.snapshot())).toBe('advance');
  });

  it.each(['success', 'no-op'] as const)('consumes a rollback %s result', () => {
    const gate = new PlayerInputGate();
    const snapshot = createPlayerUiSession({ base: 'game' }).snapshot();

    gate.consumeCurrentPointer();
    expect(decide(gate, snapshot)).toBe('ignore');
    expect(decide(gate, snapshot)).toBe('advance');
  });

  it('does not use a timeout or a previous event to decide the next pointer', () => {
    const gate = new PlayerInputGate();
    const snapshot = createPlayerUiSession({ base: 'game' }).snapshot();

    gate.consumeCurrentPointer();
    expect(decide(gate, snapshot, 2)).toBe('ignore');
    expect(decide(gate, snapshot)).toBe('advance');
  });
});
