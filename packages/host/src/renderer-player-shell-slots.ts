import type {
  BacklogEntry,
  GalleryItemView,
  RendererCommands,
  RendererQueries,
  SaveLoadCommandOptions,
  SaveLoadSelectionHandler,
  SaveLoadView,
  SettingsRowView,
  SystemMenuItemView,
  TitleView,
} from '@surdet/renderer';
import {
  createPlayerShellSlotRegistry,
  type PlayerShellOpenRequest,
  type PlayerShellSlotContext,
  type PlayerShellSlotProvider,
  type PlayerShellSlotRegistry,
} from './player-shell-slots.js';

export interface RendererPlayerShellRenderer {
  readonly commands: Pick<RendererCommands, 'menu' | 'gallery' | 'dialogue'>;
  readonly queries: Pick<RendererQueries, 'overlay' | 'dialogue'>;
}

export interface RendererPlayerShellViews {
  title(): {
    readonly view: TitleView;
    readonly onSelect: (id: string) => void;
  };
  systemMenu(): {
    readonly items: readonly SystemMenuItemView[];
    readonly onSelect: (id: string) => void;
    readonly onClose: () => void;
  };
  saveLoad(request: Extract<PlayerShellOpenRequest, { slot: 'save-load' }>): {
    readonly view: SaveLoadView;
    readonly onSelect: SaveLoadSelectionHandler;
    readonly onClose: () => void;
    readonly options?: SaveLoadCommandOptions;
  };
  settings(): {
    readonly rows: readonly SettingsRowView[];
    readonly onChange: (id: string, direction: -1 | 1) => void;
    readonly onClose: () => void;
  };
  gallery(): {
    readonly cgs: readonly GalleryItemView[];
    readonly music: readonly GalleryItemView[];
    readonly texts?: readonly GalleryItemView[];
    readonly onPlayMusic?: (id: string, source?: string) => void;
    readonly onReplayText?: (item: GalleryItemView) => void;
    readonly onClose?: () => void;
  };
  backlog(): {
    readonly entries: readonly BacklogEntry[];
    readonly onReplayVoice?: (voice: string) => void;
    readonly query?: string;
  };
}

export interface RendererPlayerShellSlotsOptions {
  readonly renderer: RendererPlayerShellRenderer;
  readonly views: RendererPlayerShellViews;
  readonly overrides?: Parameters<typeof createPlayerShellSlotRegistry>[0]['overrides'];
}

function provider(
  id: string,
  open: (request: PlayerShellOpenRequest, context: PlayerShellSlotContext) => void,
  close: () => void,
): PlayerShellSlotProvider {
  return { id, open, close };
}

/**
 * Builds the six default player-shell providers from Renderer v2 ports.
 *
 * This module intentionally knows only public command/query surfaces and
 * caller-owned view factories. It never imports a Layer or a Pixi object, so
 * games can supply content and callbacks without creating a second state
 * machine.
 */
export function createRendererPlayerShellSlots(
  options: RendererPlayerShellSlotsOptions,
): PlayerShellSlotRegistry {
  const { renderer, views } = options;
  const defaults = {
    title: provider(
      'renderer.menu.title',
      (_request, _context) => {
        const view = views.title();
        renderer.commands.menu.showTitle(view.view, view.onSelect);
      },
      () => renderer.commands.menu.hideTitle(),
    ),
    'system-menu': provider(
      'renderer.menu.system-menu',
      (_request, _context) => {
        const view = views.systemMenu();
        renderer.commands.menu.showSystemMenu(view.items, view.onSelect, view.onClose);
      },
      () => renderer.commands.menu.hideSystemMenu(),
    ),
    'save-load': provider(
      'renderer.menu.save-load',
      (request, _context) => {
        if (request.slot !== 'save-load') return;
        const view = views.saveLoad(request);
        renderer.commands.menu.showSaveLoad(view.view, view.onSelect, view.onClose, view.options);
      },
      () => renderer.commands.menu.hideSaveLoad(),
    ),
    settings: provider(
      'renderer.menu.settings',
      (_request, _context) => {
        const view = views.settings();
        renderer.commands.menu.showSettings(view.rows, view.onChange, view.onClose);
      },
      () => renderer.commands.menu.hideSettings(),
    ),
    gallery: provider(
      'renderer.gallery',
      (_request, _context) => {
        const view = views.gallery();
        renderer.commands.gallery.showGallery(view);
      },
      () => renderer.commands.gallery.hideGallery(),
    ),
    backlog: provider(
      'renderer.dialogue.backlog',
      (_request, _context) => {
        const view = views.backlog();
        renderer.commands.dialogue.showBacklog(view.entries, view.onReplayVoice, view.query);
      },
      () => renderer.commands.dialogue.hideBacklog(),
    ),
  };

  // Keep the query rail in the public input surface even though providers do
  // not need to inspect it to dispatch a projection command.
  void renderer.queries;
  return createPlayerShellSlotRegistry({ defaults, overrides: options.overrides });
}
