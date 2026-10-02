import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
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

  it('keeps the public theme immutable', () => {
    expect(Object.isFrozen(createRendererTheme())).toBe(true);
  });

  it('opens and closes nested overlays through real Host providers before accepting story input', () => {
    const menu = { showSystemMenu: vi.fn(), hideSystemMenu: vi.fn(), showSettings: vi.fn(), hideSettings: vi.fn() };
    const slots = createRendererPlayerShellSlots({
      // Only these two slots are exercised; the Renderer port records actual Host calls, not pixels.
      renderer: { commands: { menu }, queries: {} } as Parameters<typeof createRendererPlayerShellSlots>[0]['renderer'],
      views: {
        systemMenu: () => ({ items: [{ id: 'settings', label: '设置' }], onSelect: vi.fn(), onClose: vi.fn() }),
        settings: () => ({ rows: [], onChange: vi.fn(), onClose: vi.fn() }),
      } as Parameters<typeof createRendererPlayerShellSlots>[0]['views'],
    });
    const session = createPlayerUiSession({ base: 'game' });
    const shell = createPlayerShellController({ session, slots });
    shell.commands.open({ slot: 'system-menu', source: 'game' });
    expect(menu.showSystemMenu).toHaveBeenCalledOnce();
    expect(menu.showSystemMenu.mock.calls[0]![0]).toEqual([{ id: 'settings', label: '设置' }]);
    expect(shell.decidePointer({ button: 0 })).toBe('ignore');
    shell.commands.open({ slot: 'settings', source: 'system-menu' });
    expect(shell.queries.snapshot().overlay).toBe('settings');
    expect(menu.showSettings).toHaveBeenCalledOnce();
    shell.commands.close();
    expect(menu.hideSettings).toHaveBeenCalledOnce();
    expect(menu.showSystemMenu).toHaveBeenCalledTimes(2);
    expect(shell.queries.snapshot().overlay).toBe('system-menu');
    shell.commands.close();
    expect(menu.hideSystemMenu).toHaveBeenCalledOnce();
    expect(shell.queries.canAdvance()).toBe(true);

    session.setInterfaceHidden(true);
    expect(shell.queries.canAdvance()).toBe(false);
    expect(shell.decidePointer({ button: 0 })).toBe('restore-interface');
    expect(session.snapshot().interfaceHidden).toBe(true); // The caller restores; deciding never advances.
    session.setInterfaceHidden(false);
    expect(shell.decidePointer({ button: 0 })).toBe('advance');
  });
});
