import { startPlayer, showPlayerRecovery, type PlayerProject } from '@surdet/player';
import { startUiPagePreview, type UiPagePreviewLoad, type UiPagePreviewShow } from './ui-page-preview.js';

let started = false;
const owner = new AbortController();
const origin = location.origin === 'null' ? '*' : location.origin;
let showPage: ((message: UiPagePreviewShow) => void) | null = null;
let queuedPage: UiPagePreviewShow | null = null;
window.addEventListener('surdet-ui-preview-close', () => owner.abort(), { once: true });
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== location.origin) return;
  if (event.data?.type === 'surdet-ui-page-preview-show') {
    if (showPage) showPage(event.data as UiPagePreviewShow); else queuedPage = event.data as UiPagePreviewShow;
    return;
  }
  if (started) return;
  if (event.data?.type === 'surdet-ui-page-preview-load') {
    // U3 import preview: one read-only work page at a time, never the game or its storage.
    started = true;
    const note = (message: string, ok = true): void => window.parent.postMessage({ type: 'surdet-ui-page-preview-note', message, ok }, origin);
    void startUiPagePreview(event.data as UiPagePreviewLoad, owner.signal, note).then(show => {
      showPage = show;
      if (queuedPage) { show(queuedPage); queuedPage = null; }
      window.parent.postMessage({ type: 'surdet-ui-page-preview-ready' }, origin);
    }).catch(error => { if (!owner.signal.aborted) note(`效果预览失败：${error instanceof Error ? error.message : String(error)}`, false); });
    return;
  }
  if (event.data?.type !== 'surdet-ui-player-load') return;
  started = true;
  const data = event.data as {
    id: string; config: PlayerProject['config']; sceneTexts: Record<string, string>;
    terminology?: unknown;
    timelineFiles: Record<string, unknown>; assetFiles: Record<string, string>; fontFiles: Record<string, string>; gallery: PlayerProject['gallery'];
  };
  void startPlayer({ id: data.id, preview: true, config: data.config, assetFiles: data.assetFiles, fontFiles: data.fontFiles,
    sceneFiles: Object.fromEntries(Object.entries(data.sceneTexts).map(([path, text]) => [path, async () => text])),
    timelineFiles: data.timelineFiles, gallery: data.gallery, terminology: data.terminology,
    resolveSceneUrl: path => new URL(path, location.href).href,
  }, owner.signal).catch(error => { if (!owner.signal.aborted) showPlayerRecovery(error); });
});
window.parent.postMessage({ type: 'surdet-ui-player-ready' }, origin);
