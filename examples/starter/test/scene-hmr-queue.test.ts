import {
  compileScene,
  EventBus,
  Interpreter,
  SceneRegistry,
  VariableStore,
  type CoreEventMap,
} from '@surdet/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
