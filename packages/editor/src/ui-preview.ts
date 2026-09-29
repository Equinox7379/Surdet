import { startPlayer, showPlayerRecovery, type PlayerProject } from '@surdet/player';

let started = false;
const owner = new AbortController();
window.addEventListener('surdet-ui-preview-close', () => owner.abort(), { once: true });
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'surdet-ui-player-load' || started) return;
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
window.parent.postMessage({ type: 'surdet-ui-player-ready' }, location.origin === 'null' ? '*' : location.origin);
