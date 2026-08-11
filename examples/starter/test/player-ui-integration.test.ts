import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PlayerInputGate,
  canAdvance,
  createPlayerUiSession,
} from '@surdet/host';

const starterMain = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('Starter public player UI coordination', () => {
  it('uses the public host session and gate instead of duplicated writable flags', () => {
    expect(starterMain).toContain('createPlayerUiSession');
    expect(starterMain).toContain('new PlayerInputGate()');
    expect(starterMain).toContain('inputGate.decidePointer');
    for (const legacyFlag of ['systemMenuOpen', 'saveLoadOpen', 'onTitleScreen', 'galleryOpen', 'settingsOpen']) {
      expect(starterMain).not.toMatch(new RegExp(`\\b${legacyFlag}\\b`));
    }
  });

  it('keeps Starter-equivalent overlay, empty-slot and hidden-interface decisions synchronous', () => {
    const session = createPlayerUiSession({ base: 'game' });
    const gate = new PlayerInputGate();
    session.openOverlay('backlog');
    expect(gate.decidePointer(session.snapshot(), { button: 0 })).toBe('ignore');
    session.closeOverlay();
    session.setInterfaceHidden(true);
    expect(gate.decidePointer(session.snapshot(), { button: 0 })).toBe('restore-interface');
    session.setInterfaceHidden(false);
    expect(canAdvance(session.snapshot())).toBe(true);
  });
});
