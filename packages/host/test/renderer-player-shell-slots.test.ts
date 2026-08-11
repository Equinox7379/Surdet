import { vi, describe, expect, it } from 'vitest';
import {
  createPlayerShellController,
  createPlayerUiSession,
  createRendererPlayerShellSlots,
} from '../src/index.js';

function rendererHarness() {
  return {
    commands: {
      menu: {
        showTitle: vi.fn(),
        hideTitle: vi.fn(),
        showSystemMenu: vi.fn(),
        hideSystemMenu: vi.fn(),
        showSaveLoad: vi.fn(),
        hideSaveLoad: vi.fn(),
        showSettings: vi.fn(),
        hideSettings: vi.fn(),
      },
      gallery: { showGallery: vi.fn(), hideGallery: vi.fn() },
      dialogue: { showBacklog: vi.fn(), hideBacklog: vi.fn() },
    },
    queries: {
      overlay: {
        menu: vi.fn(() => ({ type: 'none' })),
        gallery: vi.fn(() => ({ type: 'none' })),
        system: vi.fn(() => ({ type: 'none' })),
      },
      dialogue: { backlogEntries: vi.fn(() => []), backlogSearchQuery: vi.fn(() => '') },
    },
  };
}

function createHarness() {
  const renderer = rendererHarness();
  const closed: string[] = [];
  const slots = createRendererPlayerShellSlots({
    renderer: renderer as never,
    views: {
      title: () => ({ view: { title: 'Surdet', items: [] } as never, onSelect: vi.fn() }),
      systemMenu: () => ({ items: [] as never, onSelect: vi.fn(), onClose: () => closed.push('system-menu') }),
      saveLoad: (request) => ({
        view: { mode: request.mode, slots: [] } as never,
        onSelect: vi.fn(() => false),
        onClose: () => closed.push('save-load'),
      }),
      settings: () => ({ rows: [] as never, onChange: vi.fn(), onClose: () => closed.push('settings') }),
      gallery: () => ({ cgs: [], music: [], onClose: () => closed.push('gallery') }),
      backlog: () => ({ entries: [], onClose: () => closed.push('backlog') }),
    },
  });
  return { renderer, closed, slots };
}

describe('Renderer-backed player shell slots', () => {
  it('registers exactly six default providers and keeps the public snapshot safe', () => {
    const { slots } = createHarness();
    const snapshot = slots.snapshot();

    expect(snapshot.bindings.map((binding) => binding.slot)).toEqual([
      'title', 'system-menu', 'save-load', 'settings', 'gallery', 'backlog',
    ]);
    expect(snapshot.bindings.every((binding) => binding.overridden === false)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.bindings)).toBe(true);
  });

  it('coordinates nested menu return and delegates open/close through Renderer v2 commands', () => {
    const { renderer, slots } = createHarness();
    const controller = createPlayerShellController({
      slots,
      session: createPlayerUiSession({ base: 'game' }),
    });

    controller.commands.open({ slot: 'system-menu', source: 'game' });
    controller.commands.open({ slot: 'settings', source: 'system-menu' });
    expect(controller.queries.snapshot()).toMatchObject({ base: 'game', overlay: 'settings' });
    controller.commands.close();
    expect(controller.queries.snapshot()).toMatchObject({ base: 'game', overlay: 'system-menu' });
    controller.commands.close();
    expect(controller.queries.snapshot()).toMatchObject({ base: 'game', overlay: 'none' });
    expect(renderer.commands.menu.showSystemMenu).toHaveBeenCalledTimes(1);
    expect(renderer.commands.menu.showSettings).toHaveBeenCalledTimes(1);
    expect(renderer.commands.menu.hideSettings).toHaveBeenCalledTimes(1);
    expect(renderer.commands.menu.hideSystemMenu).toHaveBeenCalledTimes(1);
  });

  it('uses the same public registry for title gallery and save/load failure recovery', () => {
    const { renderer, slots } = createHarness();
    const errors: unknown[] = [];
    const controller = createPlayerShellController({
      slots,
      session: createPlayerUiSession({ base: 'title' }),
      onError: (error) => errors.push(error),
    });

    controller.commands.open({ slot: 'gallery', source: 'title' });
    controller.commands.close();
    expect(renderer.commands.gallery.showGallery).toHaveBeenCalledTimes(1);
    expect(renderer.commands.gallery.hideGallery).toHaveBeenCalledTimes(1);

    controller.commands.reset('game');
    controller.commands.open({ slot: 'save-load', source: 'game', mode: 'load' });
    const before = controller.queries.snapshot();
    controller.commands.beginOperation('loading');
    controller.commands.failOperation(new Error('load failed'));
    expect(controller.queries.snapshot()).toEqual(before);
    expect(errors).toHaveLength(1);
    expect(renderer.commands.menu.showSaveLoad).toHaveBeenCalledTimes(1);
  });
});
