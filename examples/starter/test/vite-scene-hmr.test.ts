import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const starterRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplesRoot = path.dirname(starterRoot);

let activeTempRoot: string | undefined;
let activeServer: ViteDevServer | undefined;
let activeBrowser: Browser | undefined;

interface HmrPresentationSnapshot {
  readonly version: number;
  readonly stage: {
    readonly backgroundKey: string | null;
    readonly particleKind: string | null;
    readonly portraits: readonly {
      readonly key: string;
      readonly view: {
        readonly charId: string;
        readonly costume: string;
        readonly expression: string;
        readonly pos: string;
      };
    }[];
  };
  readonly timelines: readonly {
    readonly id: number;
    readonly blocking: boolean;
    readonly definition: { readonly id: string; readonly durationMs: number };
  }[];
}

afterEach(async () => {
  await activeBrowser?.close();
  await activeServer?.close();
  if (activeTempRoot) await rm(activeTempRoot, { recursive: true, force: true });
  activeBrowser = undefined;
  activeServer = undefined;
  activeTempRoot = undefined;
});

async function copyStarterToTemp(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(examplesRoot, '.surdet-vite-hmr-'));
  const entries = await readdir(starterRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'dist' || entry.name === '.vite') continue;
    await cp(path.join(starterRoot, entry.name), path.join(tempRoot, entry.name), { recursive: true });
  }
  activeTempRoot = tempRoot;
  return tempRoot;
}

async function waitForConsole(page: Page, messages: string[], predicate: (message: string) => boolean): Promise<void> {
  if (messages.some(predicate)) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      page.off('console', onConsole);
      reject(new Error(`等待浏览器诊断超时：${messages.join('\n')}`));
    }, 10000);
    const onConsole = (message: { text(): string }): void => {
      if (!predicate(message.text())) return;
      clearTimeout(timeout);
      page.off('console', onConsole);
      resolve();
    };
    page.on('console', onConsole);
  });
}

describe('real Vite .gal HMR', () => {
  it('keeps the running page and long-lived resources across two valid edits, an invalid edit, and recovery', async () => {
    const tempRoot = await copyStarterToTemp();
    const server = await createServer({
      root: tempRoot,
      configFile: path.join(tempRoot, 'vite.config.ts'),
      logLevel: 'error',
      server: { port: 0, strictPort: false },
    });
    activeServer = server;
    await server.listen();
    const baseUrl = server.resolvedUrls?.local[0];
    if (!baseUrl) throw new Error('Vite 未提供本地开发地址');

    const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
    activeBrowser = browser;
    const page = await browser.newPage();
    const messages: string[] = [];
    let navigationCount = 0;
    page.on('console', (message) => messages.push(message.text()));
    page.on('framenavigated', () => { navigationCount += 1; });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__surdetDebug !== 'undefined', undefined, { timeout: 30000 });

    const waitForStableResources = async (): Promise<void> => {
      await page.waitForFunction(() => {
        const snapshot = window.__surdetDebug.resourceSnapshot;
        return window.__surdetDebug.assetLoading?.done === true
          && snapshot !== undefined
          && snapshot !== null;
      }, undefined, { timeout: 15000 });
      await page.waitForTimeout(250);
    };

    // main.ts finishes its asynchronous asset phase before titleSelect is safe.
    // This makes the initial listener ledger deterministic rather than racing
    // the final showTitleScreen() projection.
    await waitForStableResources();
    await page.evaluate(() => window.__surdetDebug.titleSelect('new'));
    await page.waitForFunction(() => window.__surdetDebug.position?.sceneId === 'ch01_01', undefined, { timeout: 15000 });
    await waitForStableResources();
    // The authored opening timeline owns the initial background and portrait.
    // Capture the HMR baseline only after that authored projection has settled;
    // otherwise CI speed can make natural timeline progress look like an HMR mutation.
    await page.waitForFunction(() => {
      const snapshot = window.__surdetDebug.presentationSnapshot as HmrPresentationSnapshot | undefined;
      return snapshot?.stage.backgroundKey === 'harbor'
        && snapshot.stage.portraits.some((portrait) => portrait.key === 'lynn:coat')
        && snapshot.timelines.every((timeline) => !timeline.blocking);
    }, undefined, { timeout: 15000 });

    const captureState = async () => page.evaluate(() => ({
      sessionId: window.__surdetDebug.sessionId,
      resourceIds: window.__surdetDebug.resourceIds,
      position: window.__surdetDebug.position,
      activeBlobUrls: window.__surdetDebug.activeBlobUrls,
      resourceSnapshot: window.__surdetDebug.resourceSnapshot,
      resourceLedger: window.__surdetDebug.resourceLedger,
      presentationSnapshot: window.__surdetDebug.presentationSnapshot,
      presentationIdentity: (() => {
        const snapshot = window.__surdetDebug.presentationSnapshot as HmrPresentationSnapshot | undefined;
        if (!snapshot) return null;
        return {
          version: snapshot.version,
          stage: {
            backgroundKey: snapshot.stage.backgroundKey,
            particleKind: snapshot.stage.particleKind,
            portraits: snapshot.stage.portraits.map((portrait) => ({
              key: portrait.key,
              charId: portrait.view.charId,
              costume: portrait.view.costume,
              expression: portrait.view.expression,
              pos: portrait.view.pos,
            })),
          },
          timelines: snapshot.timelines
            .map((timeline) => ({
              id: timeline.id,
              blocking: timeline.blocking,
              definitionId: timeline.definition.id,
              durationMs: timeline.definition.durationMs,
            }))
            .sort((left, right) => left.id - right.id),
        };
      })(),
    }));
    const listenerKeys = (state: Awaited<ReturnType<typeof captureState>>): string[] => (
      state.resourceLedger?.active
        .filter((entry) => entry.kind === 'listener')
        .map((entry) => `${entry.owner}:${entry.key}`)
        .sort() ?? []
    );
    const expectedListenerKeys = [
      'runtime:core-events',
      'runtime:presentation-controller',
    ].sort();
    const expectStableResources = (
      before: Awaited<ReturnType<typeof captureState>>,
      after: Awaited<ReturnType<typeof captureState>>,
    ): void => {
      expect(after.sessionId).toBe(before.sessionId);
      expect(after.resourceIds).toEqual(before.resourceIds);
      expect(after.activeBlobUrls).toBe(before.activeBlobUrls);
      expect({
        tickerCallbacks: after.resourceSnapshot?.tickerCallbacks,
        blobUrls: after.resourceSnapshot?.blobUrls,
        pooledObjects: after.resourceSnapshot?.pooledObjects,
        displayObjectsByOwner: after.resourceSnapshot?.displayObjectsByOwner,
      }).toEqual({
        tickerCallbacks: before.resourceSnapshot?.tickerCallbacks,
        blobUrls: before.resourceSnapshot?.blobUrls,
        pooledObjects: before.resourceSnapshot?.pooledObjects,
        displayObjectsByOwner: before.resourceSnapshot?.displayObjectsByOwner,
      });
      expect(listenerKeys(after)).toEqual(expectedListenerKeys);
      expect(after.resourceSnapshot?.listeners).toBe(expectedListenerKeys.length);
      expect(after.resourceLedger?.active
        .filter((entry) => entry.kind === 'listener')
        .every((entry) => entry.source.length > 0)).toBe(true);
      // Camera/fade/timeline cursors are intentionally time-varying; compare
      // the semantic stage identity that HMR must preserve instead. A running
      // timeline may legitimately complete between two HMR observations.
      expect(after.presentationIdentity?.version).toBe(before.presentationIdentity?.version);
      expect(after.presentationIdentity?.stage).toEqual(before.presentationIdentity?.stage);
    };

    const initial = await captureState();
    expect(listenerKeys(initial)).toEqual(expectedListenerKeys);
    expect(initial.resourceSnapshot?.listeners).toBe(expectedListenerKeys.length);

    const scenePath = path.join(tempRoot, 'content', 'scenario', 'ch01_01.gal');
    const original = await readFile(scenePath, 'utf8');
    const firstDialogue = original.split(/\r?\n/).find((line) => line.startsWith('旁白：'))!;
    expect(firstDialogue).toBeTruthy();
    const validReplacementOne = original.replace(firstDialogue, `${firstDialogue}（第一次文字修订）`);
    const validReplacementTwo = validReplacementOne.replace('（第一次文字修订）', '（第二次文字修订）');
    expect(validReplacementOne).not.toBe(original);
    expect(validReplacementTwo).not.toBe(validReplacementOne);

    await writeFile(scenePath, validReplacementOne, 'utf8');
    try {
      await page.waitForFunction(
        (oldHash) => window.__surdetDebug.position?.sceneHash !== oldHash,
        initial.position?.sceneHash,
        { timeout: 15000 },
      );
      await waitForStableResources();
    } catch (error) {
      const state = await page.evaluate(() => ({
        sessionId: window.__surdetDebug.sessionId,
        position: window.__surdetDebug.position,
        resourceLedger: window.__surdetDebug.resourceLedger,
      }));
      throw new Error(`${String(error)}\nHMR console=${messages.join(' | ')}\nHMR state=${JSON.stringify(state)}`);
    }
    const afterValidOne = await captureState();
    expect(navigationCount).toBe(1);
    expectStableResources(initial, afterValidOne);
    expect(afterValidOne.position?.sceneId).toBe('ch01_01');
    expect(afterValidOne.position?.pc).toBeGreaterThanOrEqual(0);

    await writeFile(scenePath, validReplacementTwo, 'utf8');
    await page.waitForFunction(
      (oldHash) => window.__surdetDebug.position?.sceneHash !== oldHash,
      afterValidOne.position?.sceneHash,
      { timeout: 15000 },
    );
    await waitForStableResources();
    const afterValidTwo = await captureState();
    expect(navigationCount).toBe(1);
    expectStableResources(afterValidOne, afterValidTwo);
    expect(afterValidTwo.position?.sceneId).toBe('ch01_01');
    expect(afterValidTwo.position?.pc).toBeGreaterThanOrEqual(0);

    const invalidReplacement = `${validReplacementTwo}\n@if (`;
    await writeFile(scenePath, invalidReplacement, 'utf8');
    await waitForConsole(page, messages, (message) => message.includes('场景热重载失败，保留旧场景 ch01_01'));
    await waitForStableResources();
    const afterInvalid = await captureState();
    expect(navigationCount).toBe(1);
    expectStableResources(afterValidTwo, afterInvalid);
    expect(afterInvalid.position).toEqual(afterValidTwo.position);

    await writeFile(scenePath, original, 'utf8');
    await page.waitForFunction(
      (oldHash) => window.__surdetDebug.position?.sceneHash !== oldHash,
      afterInvalid.position?.sceneHash,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      (originalHash) => window.__surdetDebug.position?.sceneHash === originalHash,
      initial.position?.sceneHash,
      { timeout: 15000 },
    );
    await waitForStableResources();
    const afterRestore = await captureState();
    expect(navigationCount).toBe(1);
    expectStableResources(afterValidTwo, afterRestore);
    expect(afterRestore.position?.sceneId).toBe('ch01_01');
    expect(afterRestore.position?.sceneHash).toBe(initial.position?.sceneHash);
  }, 60000);
});
