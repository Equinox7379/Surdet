import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startDevProject } from '../scripts/dev-project.mjs';

// Run only this lifecycle case. All fixture media and observations go outside the repo.
const output = process.argv[2];
assert(output && path.isAbsolute(output), 'Pass an absolute artifact directory');
const projectRoot = path.join(path.dirname(output), 'project');
await fs.mkdir(output, { recursive: true });
await fs.mkdir(path.join(projectRoot, 'content/scenario'), { recursive: true });
await fs.mkdir(path.join(projectRoot, 'content/assets/bgm'), { recursive: true });
await fs.mkdir(path.join(projectRoot, 'content/assets/video'), { recursive: true });
await fs.writeFile(path.join(projectRoot, 'game.config.json'), JSON.stringify({ title: 'Media lifecycle fixture', entryScene: 'start', characters: {}, variables: {} }));
await fs.writeFile(path.join(projectRoot, 'content/scenario/start.gal'), '媒体预览生命周期。\n@end\n');

const sampleRate = 16000, seconds = 8, samples = sampleRate * seconds;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(1800 * Math.sin(i * Math.PI * 2 * 440 / sampleRate)), 44 + i * 2);
await fs.writeFile(path.join(projectRoot, 'content/assets/bgm/tone.wav'), wav);

let browser, server;
const results = [], pageErrors = [], consoleErrors = [], failedRequests = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const videoPath = path.join(projectRoot, 'content/assets/video/tone.webm');
  if (!(await fs.stat(videoPath).catch(() => null))) {
    const recording = await browser.newPage();
    try {
      const bytes = await recording.evaluate(async () => {
        const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
        document.body.append(canvas);
        const drawing = canvas.getContext('2d');
        const audio = new AudioContext(), oscillator = audio.createOscillator(), gain = audio.createGain();
        gain.gain.value = 0.05;
        const destination = audio.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination); oscillator.start(); await audio.resume();
        const stream = new MediaStream([...canvas.captureStream(10).getVideoTracks(), ...destination.stream.getAudioTracks()]);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
        const chunks = [];
        recorder.ondataavailable = event => chunks.push(event.data);
        const stopped = new Promise(resolve => { recorder.onstop = resolve; });
        let frame = 0;
        const timer = setInterval(() => { drawing.fillStyle = frame++ % 2 ? '#336699' : '#993366'; drawing.fillRect(0, 0, 160, 90); }, 100);
        recorder.start(); await new Promise(resolve => setTimeout(resolve, 8000)); recorder.stop(); await stopped;
        clearInterval(timer); oscillator.stop(); stream.getTracks().forEach(track => track.stop()); await audio.close();
        return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
      });
      await fs.writeFile(videoPath, Buffer.from(bytes));
    } finally { await recording.close(); }
  }

  // Bind only the disposable fixture, using the existing Editor launcher and dependencies.
  server = await startDevProject(['--project', projectRoot, '--data-root', path.join(output, 'authority'), '--port', '4363'], {
    registerSignals: false, disableDependencyDiscovery: true,
    optimizedDependencies: ['es-module-lexer/js', 'fontkit', 'howler', 'image-size', 'pixi.js', 'pixi.js/unsafe-eval'],
    cacheDir: path.join(path.dirname(output), 'vite'),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => { pageErrors.push(String(error)); console.error(String(error)); });
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() }); });
  // Only the native directory picker is replaced. Media decoding/playback stays native.
  await page.exposeFunction('__mediaFixtureRead', async relative => {
    const target = path.resolve(projectRoot, relative);
    assert(target.startsWith(`${path.resolve(projectRoot)}${path.sep}`), 'fixture read outside root');
    try { return (await fs.readFile(target)).toString('base64'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  });
  await page.exposeFunction('__mediaFixtureList', async relative => {
    const target = path.resolve(projectRoot, relative);
    assert(target === path.resolve(projectRoot) || target.startsWith(`${path.resolve(projectRoot)}${path.sep}`), 'fixture listing outside root');
    try { return (await fs.readdir(target, { withFileTypes: true })).map(entry => ({ name: entry.name, directory: entry.isDirectory() })); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  });
  await page.addInitScript(() => {
    const join = (parent, name) => parent ? `${parent}/${name}` : name;
    const missing = () => { throw new DOMException('Fixture entry missing', 'NotFoundError'); };
    const file = relative => ({
      kind: 'file', name: relative.split('/').pop(),
      async getFile() {
        const base64 = await window.__mediaFixtureRead(relative); if (base64 === null) missing();
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const type = relative.endsWith('.wav') ? 'audio/wav' : relative.endsWith('.webm') ? 'video/webm' : 'text/plain';
        return new File([bytes], this.name, { type });
      },
      async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
    });
    const directory = relative => ({
      kind: 'directory', name: relative.split('/').pop() || 'Media lifecycle fixture',
      async getFileHandle(name) { const child = join(relative, name); if (await window.__mediaFixtureRead(child) === null) missing(); return file(child); },
      async getDirectoryHandle(name) { const child = join(relative, name); if (await window.__mediaFixtureList(child) === null) missing(); return directory(child); },
      async *values() { for (const entry of await window.__mediaFixtureList(relative) ?? []) yield entry.directory ? directory(join(relative, entry.name)) : file(join(relative, entry.name)); },
      async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
      async isSameEntry(other) { return other?.kind === 'directory' && other.name === this.name; },
    });
    window.showDirectoryPicker = async () => directory('');
  });
  await page.goto('http://127.0.0.1:4363/');
  await page.locator('[data-action="open-project"]').click();
  await page.waitForFunction(() => {
    const state = window.surdetEditorDebug?.state;
    return state?.projectLoading === false && state.dirName === 'Media lifecycle fixture'
      && state.assetIntelligenceState === 'ready'
      && state.dirAssets.some(asset => asset.sourcePath === 'content/assets/bgm/tone.wav')
      && state.dirAssets.some(asset => asset.sourcePath === 'content/assets/video/tone.webm');
  });

  const enter = async () => {
    await page.locator('[data-editor-mode="assets"]').click();
    await page.locator('#asset-center-view .asset-center-items [role="option"]').first().waitFor();
  };
  const select = async suffix => {
    await page.locator(`#asset-center-view .asset-center-items [role="option"][data-asset-id="file:content/assets/${suffix}"]`).click();
  };
  const observation = async element => element.evaluate(media => ({
    paused: media.paused, time: media.currentTime, connected: media.isConnected,
    ended: media.ended, readyState: media.readyState, networkState: media.networkState,
    src: media.getAttribute('src'), currentSrc: media.currentSrc, muted: media.muted, volume: media.volume,
    error: media.error?.message ?? null,
    frames: media instanceof HTMLVideoElement ? media.getVideoPlaybackQuality().totalVideoFrames : null,
  }));

  for (const kind of ['audio', 'video']) for (const action of ['switch-preview', 'leave-assets']) {
    let element;
    const result = { kind, action };
    try {
      await enter();
      await select(kind === 'audio' ? 'bgm/tone.wav' : 'video/tone.webm');
      const locator = page.locator(`.asset-center-preview ${kind}`);
      await locator.waitFor(); element = await locator.elementHandle();
      await element.evaluate(media => media.play());
      await page.waitForFunction(media => !media.paused && media.currentTime > 0.25, element);
      result.playingFirst = await observation(element);
      await page.waitForTimeout(300);
      result.playingSecond = await observation(element);
      assert(result.playingSecond.time - result.playingFirst.time > 0.15, 'media did not actually advance during playback');
      assert.equal(result.playingSecond.error, null);
      if (kind === 'video') assert(result.playingSecond.frames > 0, 'video did not decode frames');
      if (action === 'switch-preview') {
        await select(kind === 'audio' ? 'video/tone.webm' : 'bgm/tone.wav');
        await page.locator(`.asset-center-preview ${kind === 'audio' ? 'video' : 'audio'}`).waitFor();
      } else {
        await page.locator('[data-editor-mode="editor"]').click();
        await page.locator('#asset-center-view').waitFor({ state: 'detached' });
      }
      await page.waitForTimeout(100);
      result.afterFirst = await observation(element);
      await page.waitForTimeout(750);
      result.afterSecond = await observation(element);
      assert.equal(result.afterFirst.paused, true, 'previous native media element is still playing');
      assert.equal(result.afterSecond.paused, true, 'previous native media element resumed');
      assert(Math.abs(result.afterSecond.time - result.afterFirst.time) < 0.04, 'previous media clock still advances');
      result.passed = true;
    } catch (error) { result.passed = false; result.failure = String(error); }
    finally {
      // Stop a baseline failure only after recording both observations, so cases stay independent.
      if (element) { await element.evaluate(media => { media.pause(); media.removeAttribute('src'); media.load(); }); await element.dispose(); }
      results.push(result); console.log(JSON.stringify(result));
    }
  }
  assert.equal(results.filter(result => !result.passed).length, 0, 'media lifecycle cases failed');
  assert.deepEqual(pageErrors, [], 'Editor page errors');
} finally {
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ browser: browser?.version(), results, pageErrors, consoleErrors, failedRequests }, null, 2));
  await browser?.close();
  await server?.close();
}
