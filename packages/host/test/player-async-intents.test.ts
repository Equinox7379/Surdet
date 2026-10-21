import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { createPlayerUiSession } from '../src/player-ui.js';
import { createPlayerShellController } from '../src/player-shell-controller.js';
import { enterPlayerTitleSession } from '../src/player-title-session.js';
import { createPlayerShellSlotRegistry, type PlayerShellSlotProvider } from '../src/player-shell-slots.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const functions = [
  'openSaveLoad', 'showTitleScreen', 'titleSelect', 'openSystemMenu', 'onSystemMenuSelect',
  'openGallery', 'closeGallery', 'closeSettings', 'leaveTitleForOverlay',
  'selectSaveLoad', 'restoreSaveLoad', 'completeLoadedSnapshot', 'quickLoad',
  'selectWorkUiSave',
];
const consumers = [
  ['shared', '../../../examples/shared/player/player.ts'],
  ['zero', '../../../examples/zero-after-midnight/src/main.ts'],
] as const;

// Execute the real consumer functions with controlled storage and rendering ports.
// Host session/controller/slot transitions are imported from source, never shared dist.
function extractConsumer(path: string) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations: string[] = [];
  let keyboard = '';
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && functions.includes(node.name.text)) {
      declarations.push(node.getText(source));
    }
    if (ts.isVariableStatement(node)) {
      const names = node.declarationList.declarations.map(decl => decl.name.getText(source));
      if (names.some(name => ['saveLoadRequestId', 'gameStartRequestId'].includes(name))) {
        declarations.push(node.getText(source));
      }
      if (names.includes('keyboardHandler')) keyboard = node.declarationList.declarations[0]!.initializer!.getText(source);
    }
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'window.addEventListener'
      && node.arguments[0]?.getText(source) === "'keydown'" && node.arguments[1]
      && node.arguments[1].getText(source).includes('openGallery();')) keyboard = node.arguments[1].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!keyboard) throw new Error(`Player keyboard handler missing: ${path}`);
  return ts.transpileModule(`
    let activeSaveLoad = null;
    let galleryReplay = null;
    let gameResourcesDisposed = false;
    let sessionStart = 0;
    let clearCountedThisSession = false;
    const quickSaveInFlight = null;
    ${declarations.join('\n')}
    const keyboardHandler = ${keyboard};
    return { ${functions.filter(name => name !== 'leaveTitleForOverlay' && (name !== 'selectWorkUiSave' || path.includes('/shared/'))).join(', ')}, keyboardHandler,
      active: () => activeSaveLoad,
      dispose: () => { gameResourcesDisposed = true; ownerTeardown.disposed = true; },
    };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}

for (const [name, path] of consumers) {
  const consumer = extractConsumer(path);
  function setup(base: 'title' | 'game' = 'game') {
    const session = createPlayerUiSession({ base });
    const opens = vi.fn();
    const provider = (id: string): PlayerShellSlotProvider => ({ id, open: opens, close: vi.fn() });
    const defaults = {
      title: provider('title'), 'system-menu': provider('system-menu'), 'save-load': provider('save-load'),
      settings: provider('settings'), gallery: provider('gallery'), backlog: provider('backlog'),
    };
    const shell = createPlayerShellController({ session, slots: createPlayerShellSlotRegistry({ defaults }), onError: vi.fn() });
    const list = vi.fn();
    const profile = vi.fn().mockResolvedValue(null);
    const saves = { load: vi.fn(), restoreBackup: vi.fn(), has: vi.fn().mockResolvedValue(true), save: vi.fn() };
    const interp = {
      start: vi.fn(), pauseHost: vi.fn(), loadSnapshot: vi.fn(), saveSnapshot: vi.fn().mockReturnValue({ meta: {} }),
      gallery: { restore: vi.fn() }, clearTracker: { restore: vi.fn() },
    };
    const menu = { hideTitle: vi.fn(), hideSaveLoad: vi.fn(), hideSettings: vi.fn(), hideSystemMenu: vi.fn() };
    const dialogue = { showBanner: vi.fn(), hideCommandRail: vi.fn(), restoreCommandRail: vi.fn() };
    const store = { reset: vi.fn(), snapshot: () => ({}), restore: vi.fn() };
    const uiDom = { ownsInput: () => false, resetMotion: vi.fn(), confirm: vi.fn().mockResolvedValue(true) };
    const dependencies = {
      uiSession: session, playerShell: shell, uiSnapshot: () => session.snapshot(),
      isOverlay: (overlay: string) => session.snapshot().overlay === overlay,
      isTitleScreen: () => session.snapshot().base === 'title',
      isUiBusy: () => session.snapshot().operation !== 'idle',
      ownerTeardown: { disposed: false }, listPlayerSaveSlots: list, saves,
      browserSave: null, SLOT_IDS: ['1', 'quick'], QUICK_SLOT: 'quick',
      enrichSnapshot: (snapshot: unknown) => snapshot,
      menu, dialogue, store, interp, loadClearRecord: profile,
      host: { reset: vi.fn() }, runtime: { resetSession: vi.fn() },
      uiDom, presentation: { clear: vi.fn() },
      hideWorkPage: vi.fn(), clearRollback: vi.fn(), refreshCommandRail: vi.fn(), syncStoryWorkUi: vi.fn(),
      restoreCommandRailForPlayerContext: vi.fn(),
      queries: { overlay: { menu: () => ({ type: 'none' }) }, diagnostics: { projectionSnapshot: () => ({}) } },
      debugProjection: () => ({}), enterPlayerTitleSession,
      project: {}, initialSystems: {}, initialGrowth: {},
      systemHooks: { restore: vi.fn() }, plugins: { resetState: vi.fn() }, growth: { restore: vi.fn() },
      ngp: { computeInheritFrom: vi.fn().mockReturnValue({ inherited: true }), inheritEntries: () => [] },
      gameConfig: { entryScene: 'intro' }, playerConfig: {},
      renderer: { status: 'idle', backlogOpen: false, dispatchInput: vi.fn() }, gallery: { hideGallery: vi.fn() },
      settings: { settings: {} }, actionForKeyboardEvent: () => null,
      console: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const api = new Function(...Object.keys(dependencies), consumer)(...Object.values(dependencies));
    function key(value: string) {
      api.keyboardHandler({ key: value, code: `Key${value.toUpperCase()}`, preventDefault: vi.fn() });
    }
    return { api, session, shell, opens, list, profile, saves, interp, menu, dialogue, store, uiDom, key };
  }

  describe(`${name} Player async intents`, () => {
    it('publishes the ordinary list and preserves its system-menu return frame', async () => {
      const h = setup();
      h.api.openSystemMenu();
      h.list.mockResolvedValue([{ id: '1' }]);
      await h.api.openSaveLoad('load', 'system-menu');
      expect(h.api.active()).toEqual({ mode: 'load', slots: [{ id: '1' }] });
      h.shell.commands.close();
      expect(h.session.snapshot().overlay).toBe('system-menu');
    });

    it.each(['keep', 'close'] as const)('ignores a list after newer settings (%s)', async close => {
      const h = setup(); const pending = deferred<unknown[]>(); h.list.mockReturnValue(pending.promise);
      const task = h.api.openSaveLoad('load');
      h.shell.commands.open({ slot: 'settings', source: 'game' });
      if (close === 'close') h.shell.commands.close();
      pending.resolve([{ id: 'old' }]);
      await expect(task).resolves.toBeUndefined();
      expect(h.api.active()).toBeNull();
      expect(h.session.snapshot().overlay).toBe(close === 'close' ? 'none' : 'settings');
    });

    it('does not restore title or show a stale list error over a newer game', async () => {
      const h = setup('title'); const pending = deferred<unknown[]>(); h.list.mockReturnValue(pending.promise);
      const task = h.api.openSaveLoad('load', 'title');
      await h.api.titleSelect('new');
      pending.reject(new Error('old list failed'));
      await task;
      expect(h.session.snapshot().base).toBe('game');
      expect(h.dialogue.showBanner).not.toHaveBeenCalled();
    });

    it('returns to title and reports a current list error', async () => {
      const h = setup('title'); h.list.mockRejectedValue(new Error('current list failed'));
      await h.api.openSaveLoad('load', 'title');
      expect(h.session.snapshot()).toMatchObject({ base: 'title', overlay: 'none', operation: 'idle' });
      expect(h.dialogue.showBanner).toHaveBeenCalledOnce();
    });

    it('lets the latest list request win in reversed completion order', async () => {
      const h = setup(); const a = deferred<unknown[]>(); const b = deferred<unknown[]>();
      h.list.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
      const old = h.api.openSaveLoad('save'); const latest = h.api.openSaveLoad('load');
      b.resolve([{ id: 'new' }]); await latest;
      a.resolve([{ id: 'old' }]); await old;
      expect(h.api.active()).toEqual({ mode: 'load', slots: [{ id: 'new' }] });
      expect(h.opens).toHaveBeenCalledTimes(1);
    });

    it('invalidates an old request on an identical-state reset', async () => {
      const h = setup(); const pending = deferred<unknown[]>(); h.list.mockReturnValue(pending.promise);
      const task = h.api.openSaveLoad('load'); h.shell.commands.reset('game');
      pending.resolve([]); await task;
      expect(h.api.active()).toBeNull();
      expect(h.session.snapshot().overlay).toBe('none');
    });

    it('keeps a valid list through passive video changes, no-op interface and pointer consumption', async () => {
      const h = setup(); const pending = deferred<unknown[]>(); h.list.mockReturnValue(pending.promise);
      const task = h.api.openSaveLoad('load');
      h.session.setVideoActive(false); h.session.setVideoActive(true); h.session.setVideoActive(false);
      h.session.setInterfaceHidden(false); h.shell.commands.consumePointer();
      pending.resolve([{ id: '1' }]); await task;
      expect(h.session.snapshot().overlay).toBe('save-load');
    });

    it.each(['resolve', 'reject'] as const)('ignores disposed list %s', async completion => {
      const h = setup(); const pending = deferred<unknown[]>(); h.list.mockReturnValue(pending.promise);
      const task = h.api.openSaveLoad('load'); h.api.dispose();
      if (completion === 'resolve') pending.resolve([]); else pending.reject(new Error('disposed list'));
      await task;
      expect(h.api.active()).toBeNull(); expect(h.dialogue.showBanner).not.toHaveBeenCalled();
    });

    it.each([['g', 'o', 'gallery'], ['o', 'g', 'settings']])('gates %s then %s', (first, second, overlay) => {
      const h = setup(); h.key(first!);
      expect(() => h.key(second!)).not.toThrow(); expect(h.session.snapshot().overlay).toBe(overlay);
    });

    it.each(['g', 'o'])('opens and closes %s normally', key => {
      const h = setup(); h.key(key); h.key(key);
      expect(h.session.snapshot().overlay).toBe('none');
    });

    it.each(['save-load', 'loading', 'hidden', 'own-busy'] as const)('gates G/O during %s', state => {
      const h = setup();
      if (state === 'save-load') h.shell.commands.open({ slot: 'save-load', source: 'game', mode: 'load' });
      if (state === 'loading') h.shell.commands.beginOperation('loading');
      if (state === 'hidden') h.session.setInterfaceHidden(true);
      if (state === 'own-busy') { h.key('g'); h.shell.commands.beginOperation('loading'); }
      const before = h.session.snapshot();
      expect(() => { h.key('g'); h.key('o'); }).not.toThrow(); expect(h.session.snapshot()).toBe(before);
    });

    it('starts an ordinary game once', async () => {
      const h = setup('title'); await h.api.titleSelect('new');
      expect(h.interp.start).toHaveBeenCalledExactlyOnceWith('intro');
    });

    it('cancels a pending start through the actual system-menu return-to-title path', async () => {
      const h = setup('title'); const pending = deferred<null>(); h.profile.mockReturnValue(pending.promise);
      const task = h.api.titleSelect('new'); h.api.openSystemMenu(); h.api.onSystemMenuSelect('title');
      pending.resolve(null); await task;
      expect(h.session.snapshot().base).toBe('title'); expect(h.interp.start).not.toHaveBeenCalled();
    });

    it('preserves startup when settings opens while the profile is pending', async () => {
      const h = setup('title'); const pending = deferred<null>(); h.profile.mockReturnValue(pending.promise);
      const task = h.api.titleSelect('new'); h.key('o'); pending.resolve(null); await task;
      expect(h.interp.start).toHaveBeenCalledOnce(); expect(h.session.snapshot().overlay).toBe('settings');
    });

    it('keeps the latest start when two profile reads complete in reverse order', async () => {
      const h = setup('title'); const a = deferred<null>(); const b = deferred<null>();
      h.profile.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
      const old = h.api.titleSelect('new'); h.api.showTitleScreen(); const latest = h.api.titleSelect('new');
      b.resolve(null); await latest; a.resolve(null); await old;
      expect(h.interp.start).toHaveBeenCalledOnce();
    });

    it.each(['load', 'restore', 'quick'] as const)('cancels a pending profile when %s completes', async kind => {
      const h = setup('title'); const profile = deferred<null>(); h.profile.mockReturnValue(profile.promise);
      const startup = h.api.titleSelect('new');
      const snap = { meta: { playTimeSec: 7 }, variables: { loaded: true } }; h.saves.load.mockResolvedValue(snap);
      h.saves.restoreBackup.mockResolvedValue(undefined);
      if (kind === 'quick') await expect(h.api.quickLoad()).resolves.toBe(true);
      else {
        h.list.mockResolvedValue([{ id: '1', empty: false, backupAvailable: true }]);
        await h.api.openSaveLoad('load');
        await expect(kind === 'load' ? h.api.selectSaveLoad('load', '1') : h.api.restoreSaveLoad('1')).resolves.toBe(true);
      }
      profile.resolve(null); await startup;
      expect(h.interp.loadSnapshot).toHaveBeenCalledExactlyOnceWith(snap);
      expect(h.interp.start).not.toHaveBeenCalled(); expect(h.session.snapshot().operation).toBe('idle');
    });

    it.each(['load', 'restore', 'quick'] as const)('blocks late startup while %s is still pending', async kind => {
      const h = setup('title'); const profile = deferred<unknown>(); const loading = deferred<unknown>();
      h.profile.mockReturnValue(profile.promise); h.saves.load.mockReturnValue(loading.promise);
      h.saves.restoreBackup.mockResolvedValue(undefined);
      const startup = h.api.titleSelect('new');
      let task: Promise<boolean>;
      if (kind === 'quick') { task = h.api.quickLoad(); await Promise.resolve(); }
      else {
        h.list.mockResolvedValue([{ id: '1', empty: false, backupAvailable: true }]); await h.api.openSaveLoad('load');
        task = kind === 'load' ? h.api.selectSaveLoad('load', '1') : h.api.restoreSaveLoad('1');
      }
      profile.resolve({ variables: { old: true }, playthroughs: 2 }); await startup;
      expect(h.interp.start).not.toHaveBeenCalled(); expect(h.store.restore).not.toHaveBeenCalled();
      expect(h.session.snapshot().operation).toBe('loading');
      loading.resolve({ meta: {} }); await expect(task).resolves.toBe(true);
    });

    it('does not let a start reset an already active load operation', async () => {
      const h = setup('title'); const loading = deferred<unknown>(); h.saves.load.mockReturnValue(loading.promise);
      h.list.mockResolvedValue([{ id: '1', empty: false }]); await h.api.openSaveLoad('load', 'title');
      const task = h.api.selectSaveLoad('load', '1'); await h.api.titleSelect('new');
      expect(h.session.snapshot().operation).toBe('loading'); expect(h.profile).not.toHaveBeenCalled();
      loading.resolve({ meta: {} }); await expect(task).resolves.toBe(true);
    });

    it('does not let a deferred quick-slot check replace a newer game', async () => {
      const h = setup(); const has = deferred<boolean>(); h.saves.has.mockReturnValue(has.promise);
      h.saves.load.mockResolvedValue({ meta: {} });
      const loading = h.api.quickLoad();
      h.api.openSystemMenu(); h.api.onSystemMenuSelect('title'); await h.api.titleSelect('new');
      has.resolve(true);
      await expect(loading).resolves.toBe(false);
      expect(h.saves.load).not.toHaveBeenCalled(); expect(h.interp.start).toHaveBeenCalledOnce();
    });

    it.each(['load', 'restore', 'quick'] as const)('keeps a failed %s recoverable without reviving the canceled startup', async kind => {
      const h = setup('title'); const profile = deferred<null>(); h.profile.mockReturnValue(profile.promise);
      const startup = h.api.titleSelect('new');
      h.saves.load.mockRejectedValue(new Error('storage failed')); h.saves.restoreBackup.mockResolvedValue(undefined);
      if (kind === 'quick') await expect(h.api.quickLoad()).resolves.toBe(false);
      else {
        h.list.mockResolvedValue([{ id: '1', empty: false, backupAvailable: true }]); await h.api.openSaveLoad('load');
        await expect(kind === 'load' ? h.api.selectSaveLoad('load', '1') : h.api.restoreSaveLoad('1')).resolves.toBe(false);
        expect(h.session.snapshot().overlay).toBe('save-load');
      }
      profile.resolve(null); await startup;
      expect(h.interp.start).not.toHaveBeenCalled(); expect(h.session.snapshot().operation).toBe('idle');
      h.api.showTitleScreen(); await h.api.titleSelect('new'); expect(h.interp.start).toHaveBeenCalledOnce();
    });

    if (name === 'shared') {
      it.each(['list', 'confirm', 'error'] as const)('ignores an authored slot action after navigation during %s', async stage => {
        const h = setup(); h.list.mockResolvedValue([{ id: '1', empty: false }]); await h.api.openSaveLoad('save');
        const listing = deferred<unknown[]>(); const confirm = deferred<boolean>();
        if (stage !== 'confirm') h.list.mockReturnValue(listing.promise);
        h.uiDom.confirm.mockReturnValue(confirm.promise);
        const task = h.api.selectWorkUiSave('save', '1');
        if (stage === 'confirm') await Promise.resolve();
        h.shell.commands.close(); h.shell.commands.open({ slot: 'settings', source: 'game' });
        if (stage === 'error') listing.reject(new Error('stale refresh'));
        else if (stage === 'list') listing.resolve([{ id: 'missing' }]);
        else confirm.resolve(true);
        await expect(task).resolves.toBe(false);
        expect(h.saves.save).not.toHaveBeenCalled(); expect(h.session.snapshot().overlay).toBe('settings');
      });
    }
  });
}
