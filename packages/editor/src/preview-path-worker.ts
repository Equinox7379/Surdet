import { findPreviewPath, type PreviewPathOptions } from '@surdet/authoring';
import { storySnapshot, type StoryCheckInput } from './story-check.js';

/** The shared Authoring query, on exactly the files the preview is about to play. */
self.onmessage = async (event: MessageEvent<{ input: StoryCheckInput; options: PreviewPathOptions }>) => {
  try {
    const snapshot = await storySnapshot(event.data.input);
    self.postMessage({ result: { revision: snapshot.revision, report: findPreviewPath(snapshot, event.data.options) } });
  } catch (error) {
    const value = error as { message?: string; code?: string };
    self.postMessage({ error: { message: value.message ?? String(error), code: value.code ?? 'PREVIEW_PATH_FAILED' } });
  }
};
