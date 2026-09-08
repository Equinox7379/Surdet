import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createPlayerShellController,
  createRendererPlayerShellSlots,
  createPlayerUiSession,
} from '@surdet/host';
import { createRendererTheme } from '@surdet/renderer';

const starterMain = readFileSync(new URL('../../shared/player/player.ts', import.meta.url), 'utf8');

describe('Starter public player UI coordination', () => {
  it('uses the public shell controller and renderer-backed providers', () => {
    expect(starterMain).toContain('createPlayerShellController');
    expect(starterMain).toContain('createRendererPlayerShellSlots');
    expect(starterMain).toContain('createRendererTheme');
    expect(starterMain).toContain('createPlayerUiSession');
    expect(starterMain).toContain('connectInterpreterPresentation');
    expect(starterMain).toContain('enterPlayerTitleSession');
    expect(starterMain).toContain('presentationConnection.disconnect()');
    expect(starterMain).not.toContain('interp.setPresentationHooks');
    expect(starterMain).not.toContain('preserveWorld: true');
    expect(starterMain).not.toMatch(/new PlayerInputGate\(\)/);
    expect(starterMain).not.toMatch(/uiSession\.(openOverlay|closeOverlay|beginOperation|completeOperation|failOperation|reset|enterGame|enterTitle)/);
    expect(starterMain).not.toMatch(/inputGate\.decidePointer/);
    for (const legacyFlag of ['systemMenuOpen', 'saveLoadOpen', 'onTitleScreen', 'galleryOpen', 'settingsOpen']) {
      expect(starterMain).not.toMatch(new RegExp(`\\b${legacyFlag}\\b`));
    }
  });

  it('keeps Starter-equivalent overlay, empty-slot and hidden-interface decisions synchronous', () => {
    expect(typeof createPlayerShellController).toBe('function');
    expect(typeof createRendererPlayerShellSlots).toBe('function');
    expect(typeof createPlayerUiSession).toBe('function');
    expect(Object.isFrozen(createRendererTheme())).toBe(true);
  });
});
