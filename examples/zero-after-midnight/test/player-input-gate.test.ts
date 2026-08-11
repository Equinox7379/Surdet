import { describe, expect, it } from 'vitest';
import {
  PlayerInputGate,
  type PointerDecision,
} from '@surdet/host';
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
