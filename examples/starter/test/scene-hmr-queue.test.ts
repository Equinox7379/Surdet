import {
  compileScene,
  EventBus,
  Interpreter,
  SceneRegistry,
  VariableStore,
  type CoreEventMap,
} from '@surdet/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ScriptTarget, transpileModule } from 'typescript';
import { createRollbackRuntime } from '@surdet/host';
import type { AudioHandle } from '@surdet/renderer';
import { installSceneHotReload, type SceneHotModule } from '../../shared/scene-hmr.js';

const FETCH_DELAY_MS = 1_500;
const OBSERVATION_BUDGET_MS = 9_000;
const SCENE_IDS = ['active', 'scene-2', 'scene-3', 'scene-4', 'scene-5', 'scene-6', 'scene-7'] as const;

function sceneSource(text: string): string {
  return `@label start\n旁白：${text}\n旁白：下一句。\n`;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('scene HMR queue fairness', () => {
  it.each(['unchanged', 'compile-failure', 'read-failure'])('keeps rollback history when no scene is replaced: %s', async mode => {
    vi.stubGlobal('window', { location: { origin: 'http://surdet.test' } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new SceneRegistry(), source = '第一句\n第二句\n@end';
    const original = compileScene(source, '/content/scenario/main.gal', 'main');
    registry.register(original);
    const bus = new EventBus<CoreEventMap>(), interpreter = new Interpreter(new VariableStore(), bus, registry);
    let latest = '';
    bus.on('text', event => { latest = event.value; });
    const rollback = createRollbackRuntime({ interpreter,
      renderer: { status: 'awaiting', backlogOpen: false, canCaptureRollbackCheckpoint: () => true,
        resetSession() {}, snapshotPresentation: () => ({}), restorePresentation() {} },
      audio: {} as AudioHandle, isBlocked: () => false, label: 'hmr-unchanged', onRefresh() {} });
    bus.on('text', () => rollback.captureText());
    interpreter.start('main'); await Promise.resolve();
    interpreter.advance(); await Promise.resolve();
    const fetchScene = vi.fn(async () => ({ ok: mode !== 'read-failure', status: 503,
      text: async () => mode === 'compile-failure' ? '@if (' : source }));
    vi.stubGlobal('fetch', fetchScene);
    let update!: (payload: { updates: { path: string }[] }) => void;
    const clearRollback = vi.fn(() => rollback.clear());
    installSceneHotReload({ hot: { accept() {}, on(_event, callback) { update = callback; } }, registry, interpreter,
      label: 'unchanged-test', sceneFiles: {}, resolveSceneUrl: path => path, clearRollback });
    update({ updates: [{ path: '/content/scenario/main.gal' }] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchScene).toHaveBeenCalledOnce();
    expect(registry.get('main')).toBe(original);
    expect(clearRollback).not.toHaveBeenCalled();
    expect(rollback.perform()).toBe(true);
    expect(latest).toBe('第一句');
  });

  it.each(['../../shared/player/player.ts', '../../zero-after-midnight/src/main.ts'])('invalidates retained caller history through the actual Player HMR wiring: %s', async file => {
    vi.stubGlobal('window', { location: { origin: 'http://surdet.test' } });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const registry = new SceneRegistry();
    registry.register(compileScene('序句\n@call sub\n@jump tail\n@end', 'main.gal', 'main'));
    registry.register(compileScene('子一句\n子二句\n@return', 'sub.gal', 'sub'));
    registry.register(compileScene('尾句\n后续句\n最后句\n@end', 'tail.gal', 'tail'));
    const store = new VariableStore([{ name: 'visits', type: 'number', initial: 0 }]);
    const bus = new EventBus<CoreEventMap>(), interpreter = new Interpreter(store, bus, registry);
    let latest = '';
    bus.on('text', event => { latest = event.value; });
    const rollback = createRollbackRuntime({ interpreter,
      renderer: { status: 'awaiting', backlogOpen: false, canCaptureRollbackCheckpoint: () => true,
        resetSession() {}, snapshotPresentation: () => ({}), restorePresentation() {} },
      audio: {} as AudioHandle, isBlocked: () => false, label: 'hmr-history', onRefresh() {} });
    bus.on('text', () => rollback.captureText());
    interpreter.start('main'); await Promise.resolve();
    for (let i = 0; i < 3; i++) { interpreter.advance(); await Promise.resolve(); }
    expect(latest).toBe('尾句');
    expect(interpreter.saveSnapshot()!.callStack).toEqual([]);
    expect(rollback.canRollback()).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '序句\n@inc visits\n@call sub\n@jump tail\n@end' })));
    let update!: (payload: { updates: { path: string }[] }) => void;
    const hot: SceneHotModule = { accept() {}, on(_event, callback) { update = callback; } };
    const refresh = vi.fn(() => { expect(rollback.canRollback()).toBe(false); });
    // Execute each shipped Player's actual option wiring with the real HMR and rollback modules.
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = source.indexOf('    installSceneHotReload({');
    const end = source.indexOf('\n    });', start);
    if (start < 0 || end < 0) throw new Error('Player HMR wiring not found');
    const body = transpileModule(source.slice(start, end + '\n    });'.length).replaceAll('import.meta', 'meta'),
      { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
    new Function('installSceneHotReload', 'project', 'registry', 'interp', 'sceneFiles', 'clearRollback', 'refreshCommandRail', 'meta', body)(
      installSceneHotReload, { hot, resolveSceneUrl: (path: string) => path }, registry, interpreter, {}, () => rollback.clear(), refresh,
      { hot, url: 'http://surdet.test/src/main.ts' });
    update({ updates: [{ path: '/content/scenario/main.gal' }] });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(rollback.perform()).toBe(false);
    expect(latest).toBe('尾句');
    interpreter.advance(); await Promise.resolve();
    interpreter.advance(); await Promise.resolve();
    expect(rollback.perform()).toBe(true);
    expect(latest).toBe('后续句');
  });

  it.each(['出发\n新增一句\n@call sub\n回来\n@end', '出发\n@call sub\n@jump missing\n@end'])('retains an active caller until restart instead of reusing its old return PC: %s', async replacement => {
    vi.stubGlobal('window', { location: { origin: 'http://surdet.test' } });
    const registry = new SceneRegistry();
    const original = compileScene('出发\n@call sub\n回来\n@end', 'main.gal', 'main');
    registry.register(original);
    registry.register(compileScene('@inc hits\n子场景\n@return', 'sub.gal', 'sub'));
    registry.register(compileScene('旧旁支', 'other.gal', 'other'));
    const bus = new EventBus<CoreEventMap>(), store = new VariableStore([{ name: 'hits', type: 'number', initial: 0 }]);
    const interpreter = new Interpreter(store, bus, registry);
    const seen: string[] = []; bus.on('text', text => seen.push(text.value));
    interpreter.start('main'); interpreter.advance();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => ({ ok: true, text: async () => String(input).includes('other.gal') ? '新旁支' : replacement })));
    let update!: (payload: { updates: { path: string }[] }) => void;
    const clearRollback = vi.fn();
    installSceneHotReload({ hot: { accept() {}, on(_event, callback) { update = callback; } }, registry, interpreter,
      label: 'caller-test', sceneFiles: {}, resolveSceneUrl: path => path, clearRollback });
    update({ updates: [{ path: '/content/scenario/main.gal' }] });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls.flat().join(' ')).toContain('返回点');
    expect(registry.get('main')).toBe(original);
    expect(clearRollback).not.toHaveBeenCalled();
    interpreter.advance();
    expect(seen).toEqual(['出发', '子场景', '回来']);
    expect(store.getNumber('hits')).toBe(1);
    update({ updates: [{ path: '/content/scenario/other.gal' }] });
    await vi.waitFor(() => expect(registry.get('other').instructions).toEqual(expect.arrayContaining([expect.objectContaining({ op: 'text', value: '新旁支' })])));
    expect(clearRollback).toHaveBeenCalledOnce();
  });
  it('applies two valid boundary edits and reports the third invalid edit within 9 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { location: { origin: 'http://surdet.test' } });

    const originalSource = sceneSource('原始版本');
    const validSourceOne = sceneSource('第一次修订');
    const validSourceTwo = sceneSource('第二次修订');
    const invalidSource = `${validSourceTwo}\n@if (`;
    const sourcesById = new Map<string, string>(SCENE_IDS.map((id) => [id, sceneSource(`${id} 基线`)]));
    sourcesById.set('active', originalSource);

    const registry = new SceneRegistry();
    for (const sceneId of SCENE_IDS) {
      registry.register(compileScene(sourcesById.get(sceneId)!, `${sceneId}.gal`, sceneId));
    }
    const bus = new EventBus<CoreEventMap>();
    const interpreter = new Interpreter(new VariableStore([]), bus, registry);
    interpreter.start('active');
    const initialPosition = interpreter.position;
    expect(initialPosition?.sceneId).toBe('active');

    const expectedHashes = {
      original: compileScene(originalSource, 'active.gal', 'active').sceneHash,
      validOne: compileScene(validSourceOne, 'active.gal', 'active').sceneHash,
      validTwo: compileScene(validSourceTwo, 'active.gal', 'active').sceneHash,
    };
    expect(() => compileScene(invalidSource, 'active.gal', 'active')).toThrow();

    let activeFetches = 0;
    const activeSources = [validSourceOne, validSourceTwo, invalidSource, originalSource] as const;
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const sceneId = /\/([^/]+)\.gal(?:\?|$)/.exec(url)?.[1];
      if (!sceneId || !SCENE_IDS.includes(sceneId as (typeof SCENE_IDS)[number])) {
        return Promise.resolve({ ok: false, text: async () => '' } as Response);
      }
      const source = sceneId === 'active'
        ? activeSources[activeFetches++]
        : sourcesById.get(sceneId)!;
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve({ ok: true, text: async () => source } as Response), FETCH_DELAY_MS);
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    let beforeUpdate: ((payload: { updates: readonly { path: string }[] }) => void) | undefined;
    const hot: SceneHotModule = {
      accept: () => undefined,
      on: (_event, callback) => { beforeUpdate = callback; },
    };
    installSceneHotReload({
      hot,
      registry,
      interpreter,
      label: 'queue-test',
      clearRollback() {},
      sceneFiles: Object.fromEntries(SCENE_IDS.map((id) => [`../content/scenario/${id}.gal`, () => Promise.resolve(sourcesById.get(id))])),
      resolveSceneUrl: (scenePath) => new URL(scenePath, 'http://surdet.test/src/main.ts').href,
    });
    expect(beforeUpdate).toBeDefined();

    const publishBoundaryUpdate = (): void => {
      beforeUpdate!({ updates: [{ path: '/src/scene-hmr-boundary.ts' }] });
    };
    publishBoundaryUpdate();
    publishBoundaryUpdate();
    publishBoundaryUpdate();

    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS);
    expect(registry.get('active').sceneHash).toBe(expectedHashes.validOne);
    expect(interpreter.position).toEqual(initialPosition);

    await vi.advanceTimersByTimeAsync(OBSERVATION_BUDGET_MS - FETCH_DELAY_MS);
    const budgetHash = registry.get('active').sceneHash;
    const budgetPosition = interpreter.position;
    const invalidDiagnosticAtBudget = warnings.some((message) => message.includes('热重载失败，保留旧场景 active'));

    // Let the old queue settle before checking recovery, so the test also
    // proves that the rejected source never replaces version two and that a
    // later valid boundary edit restores the original source.
    await vi.advanceTimersByTimeAsync(60_000);
    publishBoundaryUpdate();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(registry.get('active').sceneHash).toBe(expectedHashes.original);
    expect(interpreter.position).toEqual(initialPosition);
    expect(registry.all()).toHaveLength(SCENE_IDS.length);

    // The RED assertion: the serial fallback scans six unchanged scenes between
    // each active scene. A fair update queue has completed both valid edits and
    // the invalid diagnostic before this nine-second observation point.
    expect(budgetHash).toBe(expectedHashes.validTwo);
    expect(budgetPosition).toEqual(initialPosition);
    expect(invalidDiagnosticAtBudget).toBe(true);
  }, 15_000);
});
