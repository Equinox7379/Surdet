import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ?? await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-preview-audio-'));
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root: editorRoot, configFile: false, logLevel: 'error',
  server: { host: '127.0.0.1', port: 18080, strictPort: true },
  plugins: [{ name: 'preview-audio-fixture', configureServer(server) { server.middlewares.use('/audit-parent', (_req, res) => {
    res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end('<!doctype html><meta charset="utf-8"><iframe name="preview" src="/preview.html" style="width:960px;height:600px"></iframe>');
  }); } }],
});
let browser; const results = [], errors = [];
try {
  await server.listen(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:18080/audit-parent');
  const preview = page.frames().find(frame => frame.name() === 'preview'); assert(preview);
  await preview.waitForFunction(() => window.surdetPreviewDebug?.runtime && window.Howler);
  for (const mode of ['pause', 'backlog', 'scene-end', 'save-load', 'reload-save-load']) {
    // A real pointer activates audio in the iframe before the next story starts.
    await preview.locator('canvas').click({ position: { x: 5, y: 5 } });
    await page.evaluate(mode => {
      const bytes = new ArrayBuffer(44 + 8000 * 2 * 5), view = new DataView(bytes);
      const text = (offset, value) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true);
      view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
      for (let i = 0; i < 40000; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * Math.PI * 2 * 220 / 8000) * 1000), true);
      const message = { type: 'surdet-preview-load', payload: {
        sceneId: 'start', projectKey: 'audio-controls-own-fixture', traceId: 'audio-' + mode, seed: 7, fast: true,
        scenes: [{ id: 'start', text: '@scene start\n@bgm bed\n@voice clip\n旁白：[' + mode + ']长录音在真实预览中播放。\n'
          + (mode.endsWith('save-load') ? '@bgm next\n旁白：[' + mode + ']切歌后等待读档。\n' : '') + '@end\n' }], variables: [],
        assets: { backgrounds: [], portraits: [], avatars: [], audio: [{ kind: 'bgm', key: 'bed' }, { kind: 'voice', key: 'clip' }, ...(mode.endsWith('save-load') ? [{ kind: 'bgm', key: 'next' }] : [])]
          .map(asset => ({ ...asset, file: { buffer: bytes.slice(0), mime: 'audio/wav', sourcePath: 'content/assets/' + asset.kind + '/自有声音.wav' } })) },
      } };
      window.auditAudioMessage = message;
      window.frames[0].postMessage(message, location.origin);
    }, mode);
    await preview.waitForFunction(mode => window.surdetPreviewDebug?.interp?.status === 'awaiting-advance' && window.surdetPreviewDebug.rendererStatus === 'awaiting'
      && window.surdetPreviewDebug.runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText.includes('[' + mode + ']')
      && window.Howler._howls.length === 2 && window.Howler._howls.every(howl => howl.state() === 'loaded'), mode);
    await preview.evaluate(() => window.Howler.ctx.resume());
    await preview.waitForFunction(() => window.Howler._howls.every(howl => howl.playing()));
    const inspect = () => preview.evaluate(() => ({ status: window.surdetPreviewDebug.interp.status,
      paused: window.surdetPreviewDebug.runtime.controller.presentationPaused,
      visibleError: document.getElementById('preview-error')?.textContent ?? null,
      audio: window.Howler._howls.map(howl => ({ source: howl._src, loop: howl.loop(), playing: howl.playing(), state: howl.state() })),
      snapshot: window.surdetPreviewDebug.interp.saveSnapshot() }));
    const before = await inspect();
    let reloaded;
    if (mode === 'pause') {
      await preview.evaluate(() => window.surdetPreviewDebug.runtime.controller.setPresentationPaused(true));
    } else if (mode === 'backlog') {
      await page.keyboard.press('l');
      await preview.waitForFunction(() => window.surdetPreviewDebug.runtime.controller.backlogOpen);
    } else if (mode === 'scene-end') {
      await preview.locator('canvas').click({ position: { x: 5, y: 5 } });
      await preview.waitForFunction(() => window.surdetPreviewDebug.interp.status === 'ended');
    } else {
      await page.keyboard.press('F5');
      await preview.waitForFunction(() => localStorage.getItem('surdet:preview:save:audio-controls-own-fixture:quick'));
      if (mode === 'reload-save-load') {
        await page.evaluate(() => window.frames[0].postMessage(window.auditAudioMessage, location.origin));
        await preview.waitForFunction(oldSources => window.surdetPreviewDebug?.interp?.status === 'awaiting-advance'
          && window.surdetPreviewDebug.rendererStatus === 'awaiting' && window.Howler._howls.length === 2
          && window.Howler._howls.every(howl => howl.state() === 'loaded' && howl.playing() && !oldSources.includes(howl._src)), before.audio.map(sound => sound.source));
        reloaded = await inspect();
      }
      await preview.locator('canvas').click({ position: { x: 5, y: 5 } });
      await preview.waitForFunction(() => window.surdetPreviewDebug.rendererStatus === 'awaiting'
        && window.surdetPreviewDebug.runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText.includes('切歌后')
        && window.Howler._howls.length === 3 && window.Howler._howls.filter(howl => howl.loop() && howl.playing()).length === 1);
      await page.keyboard.press('F9');
      await preview.waitForFunction(() => window.surdetPreviewDebug.rendererStatus === 'awaiting'
        && window.surdetPreviewDebug.runtime.queries.diagnostics.projectionSnapshot().dialogue?.dialogText.includes('长录音'));
      await preview.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    const after = await inspect();
    let resumed, replay, closed;
    if (mode === 'pause') {
      await preview.evaluate(() => window.surdetPreviewDebug.runtime.controller.setPresentationPaused(false));
      await preview.waitForFunction(() => window.Howler._howls.find(howl => !howl.loop())?.playing());
      resumed = await inspect();
    }
    if (mode === 'backlog') {
      const bounds = await preview.locator('canvas').boundingBox(); assert(bounds);
      await preview.locator('canvas').click({ position: { x: bounds.width * 220 / 1280, y: bounds.height * 90 / 720 } });
      await preview.waitForFunction(() => window.surdetPreviewDebug.runtime.controller.backlogOpen && window.Howler._howls.find(howl => !howl.loop())?.playing());
      replay = await inspect();
      await page.keyboard.press('l');
      await preview.waitForFunction(() => !window.surdetPreviewDebug.runtime.controller.backlogOpen && !window.Howler._howls.find(howl => !howl.loop())?.playing());
      closed = await inspect();
    }
    results.push({ mode, before, after, resumed, replay, closed, reloaded });
  }
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ output, results: results.map(result => ({ mode: result.mode, before: result.before.audio,
    after: result.after.audio, paused: result.after.paused, audioSnapshot: result.before.snapshot.presentation.payload.audio ?? null,
    resumed: result.resumed?.audio, replay: result.replay?.audio, closed: result.closed?.audio, reloaded: result.reloaded?.audio })), errors }, null, 2));
  for (const result of results) {
    const bgm = result.after.audio.find(sound => sound.loop && sound.playing), voice = result.after.audio.find(sound => !sound.loop);
    assert.equal(result.after.visibleError, null, result.mode + ' runtime error');
    assert.equal(bgm?.playing, true, result.mode + ' BGM');
    assert.equal(bgm?.source, (result.reloaded ?? result.before).audio.find(sound => sound.loop)?.source, result.mode + ' BGM source');
    if (!result.mode.endsWith('save-load')) assert.equal(voice?.playing, false, result.mode + ' voice');
    if (result.mode === 'pause') assert.equal(result.resumed.audio.find(sound => !sound.loop)?.playing, true);
    if (result.mode === 'backlog') {
      assert.equal(result.replay.paused, true);
      assert.equal(result.replay.audio.find(sound => !sound.loop)?.playing, true);
      assert.equal(result.closed.audio.find(sound => !sound.loop)?.playing, false);
    }
    if (result.mode.endsWith('save-load')) assert.equal(result.before.snapshot.presentation.payload.audio?.bgm, 'bed');
  }
  assert.deepEqual(errors, []);
} catch (error) { await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ results, errors, failure: String(error) }, null, 2)); console.log(JSON.stringify({ output, errors, failure: String(error) })); throw error; }
finally { await browser?.close(); await server.close(); }
