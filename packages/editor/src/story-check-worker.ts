import { simulateSnapshot, type SimulationOptions } from '@surdet/authoring';
import { storySnapshot, type StoryCheckInput } from './story-check.js';

self.onmessage = async (event: MessageEvent<{ input: StoryCheckInput; options: SimulationOptions }>) => {
  try {
    const snapshot = await storySnapshot(event.data.input);
    const report = simulateSnapshot(snapshot, event.data.options);
    self.postMessage({ result: { revision: snapshot.revision, report, options: event.data.options } });
  } catch (error) {
    const value = error as { message?: string; code?: string; pos?: { file?: string; line?: number; col?: number } };
    self.postMessage({ error: { message: value.message ?? String(error), code: value.code ?? 'STORY_CHECK_FAILED', ...value.pos } });
  }
};
