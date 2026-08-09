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
  it('keeps the running page and long-lived resources, clamps valid edits, and rejects invalid edits', async () => {
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
    await page.evaluate(() => window.__surdetDebug.titleSelect('new'));
    await page.waitForFunction(() => window.__surdetDebug.position?.sceneId === 'ch01_01', undefined, { timeout: 15000 });
    const waitForStableResources = async (): Promise<void> => {
      await page.waitForFunction(() => {
        const snapshot = window.__surdetDebug.resourceSnapshot;
        return window.__surdetDebug.assetLoading?.done === true
          && window.__surdetDebug.rendererStatus !== 'typing'
          && snapshot !== undefined
          && snapshot !== null;
      }, undefined, { timeout: 15000 });
      await page.waitForTimeout(250);
    };
    await waitForStableResources();

    const initial = await page.evaluate(() => ({
      sessionId: window.__surdetDebug.sessionId,
      resourceIds: window.__surdetDebug.resourceIds,
      position: window.__surdetDebug.position,
      activeBlobUrls: window.__surdetDebug.activeBlobUrls,
      resourceSnapshot: window.__surdetDebug.resourceSnapshot,
      presentationSnapshot: window.__surdetDebug.presentationSnapshot,
    }));
    const scenePath = path.join(tempRoot, 'content', 'scenario', 'ch01_01.gal');
    const original = await readFile(scenePath, 'utf8');
    const validReplacement = original.replace('等了你三个晚上', '等了你四个晚上');
    expect(validReplacement).not.toBe(original);

    await writeFile(scenePath, validReplacement, 'utf8');
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
      }));
      throw new Error(`${String(error)}\nHMR console=${messages.join(' | ')}\nHMR state=${JSON.stringify(state)}`);
    }
    const afterValid = await page.evaluate(() => ({
      sessionId: window.__surdetDebug.sessionId,
      resourceIds: window.__surdetDebug.resourceIds,
      position: window.__surdetDebug.position,
      activeBlobUrls: window.__surdetDebug.activeBlobUrls,
      resourceSnapshot: window.__surdetDebug.resourceSnapshot,
      presentationSnapshot: window.__surdetDebug.presentationSnapshot,
    }));
    expect(navigationCount).toBe(1);
    expect(afterValid.sessionId).toBe(initial.sessionId);
    expect(afterValid.resourceIds).toEqual(initial.resourceIds);
    expect(afterValid.activeBlobUrls).toBe(initial.activeBlobUrls);
    expect(afterValid.position?.sceneId).toBe('ch01_01');
    expect(afterValid.position?.pc).toBeGreaterThanOrEqual(0);
    expect({
      listeners: afterValid.resourceSnapshot?.listeners,
      tickerCallbacks: afterValid.resourceSnapshot?.tickerCallbacks,
      blobUrls: afterValid.resourceSnapshot?.blobUrls,
      pooledObjects: afterValid.resourceSnapshot?.pooledObjects,
      displayObjectsByOwner: afterValid.resourceSnapshot?.displayObjectsByOwner,
    }).toEqual({
      listeners: initial.resourceSnapshot?.listeners,
      tickerCallbacks: initial.resourceSnapshot?.tickerCallbacks,
      blobUrls: initial.resourceSnapshot?.blobUrls,
      pooledObjects: initial.resourceSnapshot?.pooledObjects,
      displayObjectsByOwner: initial.resourceSnapshot?.displayObjectsByOwner,
    });
    expect(afterValid.presentationSnapshot).toEqual(initial.presentationSnapshot);

    const invalidReplacement = `${validReplacement}\n@if (`;
    await writeFile(scenePath, invalidReplacement, 'utf8');
    await waitForConsole(page, messages, (message) => message.includes('场景热重载失败，保留旧场景 ch01_01'));
    await waitForStableResources();
    const afterInvalid = await page.evaluate(() => ({
      sessionId: window.__surdetDebug.sessionId,
      resourceIds: window.__surdetDebug.resourceIds,
      position: window.__surdetDebug.position,
      activeBlobUrls: window.__surdetDebug.activeBlobUrls,
      resourceSnapshot: window.__surdetDebug.resourceSnapshot,
      presentationSnapshot: window.__surdetDebug.presentationSnapshot,
    }));
    expect(navigationCount).toBe(1);
    expect(afterInvalid.sessionId).toBe(initial.sessionId);
    expect(afterInvalid.resourceIds).toEqual(initial.resourceIds);
    expect(afterInvalid.activeBlobUrls).toBe(initial.activeBlobUrls);
    expect(afterInvalid.position).toEqual(afterValid.position);
    expect({
      listeners: afterInvalid.resourceSnapshot?.listeners,
      tickerCallbacks: afterInvalid.resourceSnapshot?.tickerCallbacks,
      blobUrls: afterInvalid.resourceSnapshot?.blobUrls,
      pooledObjects: afterInvalid.resourceSnapshot?.pooledObjects,
      displayObjectsByOwner: afterInvalid.resourceSnapshot?.displayObjectsByOwner,
    }).toEqual({
      listeners: afterValid.resourceSnapshot?.listeners,
      tickerCallbacks: afterValid.resourceSnapshot?.tickerCallbacks,
      blobUrls: afterValid.resourceSnapshot?.blobUrls,
      pooledObjects: afterValid.resourceSnapshot?.pooledObjects,
      displayObjectsByOwner: afterValid.resourceSnapshot?.displayObjectsByOwner,
    });
    expect(afterInvalid.presentationSnapshot).toEqual(afterValid.presentationSnapshot);

    await writeFile(scenePath, original, 'utf8');
  }, 60000);
});
