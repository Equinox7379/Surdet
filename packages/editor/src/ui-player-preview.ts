import { state } from './state.js';
import { buildAssetCatalog, parseProjectConfigDocument, validateUiAssets } from '@surdet/authoring';
import { readProjectUi, resolveProjectFontPaths } from '@surdet/core';
import { assetPathForHandle } from './project-io.js';

let closePreview: (() => void) | null = null;
export function disposeUiPlayerPreview(): void { closePreview?.(); closePreview = null; }

/** A real shared Player in its own window context, never the designer's action callbacks. */
export async function openUiPlayerPreview(configText: string): Promise<void> {
  disposeUiPlayerPreview();
  const projectRoot = state.dirHandle;
  const config = parseProjectConfigDocument(configText);
  const sources = [...state.dirAssets];
  validateUiAssets(readProjectUi(config), buildAssetCatalog(sources.flatMap(asset => asset.sourcePath ? [asset.sourcePath] : [])));
  const sceneTexts = Object.fromEntries([...state.scenes.values()].map(scene => [scene.file, scene.text]));
  const timelines = Object.fromEntries(state.timelines.map(timeline => [timeline.file, JSON.parse(timeline.text)]));
  const gallery = state.configFiles.gallery ?? { cgs: [], music: [] };
  const terminology = state.configFiles.terminology;
  const dialog = document.createElement('dialog');
  dialog.className = 'ui-player-preview'; dialog.setAttribute('aria-label', '试玩界面草稿');
  const heading = document.createElement('div'); heading.className = 'ui-player-preview-heading';
  const label = document.createElement('span'); label.textContent = '试玩草稿 · 独立测试进度';
  const close = document.createElement('button'); close.textContent = '关闭试玩'; close.type = 'button';
  heading.append(label, close);
  const frame = document.createElement('iframe'); frame.title = '作品界面试玩';
  frame.src = './ui-preview.html';
  dialog.append(heading, frame);
  const urls: string[] = [];
  let disposed = false;
  let ready = false;
  let payload: unknown;
  const origin = location.origin === 'null' ? '*' : location.origin;
  const publish = (): void => { if (ready && payload && !disposed) frame.contentWindow?.postMessage(payload, origin); };
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
    if (event.data?.type === 'surdet-ui-player-ready') { ready = true; publish(); }
  };
  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('message', onMessage);
    // Synchronously release the ordinary Player owner before the iframe goes away;
    // iframe removal alone need not run a beforeunload listener.
    frame.contentWindow?.dispatchEvent(new Event('surdet-ui-preview-close'));
    frame.src = 'about:blank'; frame.remove();
    for (const url of urls) URL.revokeObjectURL(url);
    dialog.close(); dialog.remove();
    if (closePreview === cleanup) closePreview = null;
  };
  closePreview = cleanup;
  close.onclick = cleanup;
  dialog.oncancel = event => { event.preventDefault(); cleanup(); };
  window.addEventListener('message', onMessage);
  document.body.appendChild(dialog); dialog.showModal();
  try {
    const assetFiles: Record<string, string> = {};
    for (const asset of sources) {
      const sourcePath = asset.sourcePath ?? (asset.handle ? assetPathForHandle(asset.handle) : undefined);
      if (!asset.handle || !sourcePath?.startsWith('content/assets/')) continue;
      const file = await asset.handle.getFile();
      if (disposed || state.dirHandle !== projectRoot) { cleanup(); return; }
      const url = URL.createObjectURL(file); urls.push(url);
      const path = sourcePath.slice('content/assets/'.length);
      assetFiles[path] = `${url}#${path.split('/').at(-1)}`;
    }
    const fontFiles: Record<string, string> = {};
    for (const path of new Set(Object.values(resolveProjectFontPaths(config)))) {
      if (!path || assetFiles[path.replace(/^content\/assets\//, '')]) continue;
      if (!projectRoot) throw new Error('项目目录不可读');
      const segments = path.split('/'); const filename = segments.pop()!;
      let directory = projectRoot;
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
      const file = await (await directory.getFileHandle(filename)).getFile();
      if (disposed || state.dirHandle !== projectRoot) { cleanup(); return; }
      const url = URL.createObjectURL(file); urls.push(url); fontFiles[path] = `${url}#${filename}`;
    }
    payload = { type: 'surdet-ui-player-load', id: `editor-ui-preview-${crypto.randomUUID()}`, config, sceneTexts, timelineFiles: timelines, assetFiles, fontFiles, gallery, terminology };
    publish();
  } catch (error) { cleanup(); throw error; }
}
