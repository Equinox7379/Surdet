import { describe, expect, it, afterEach } from 'vitest';
import { buildObjectIndex } from '@surdet/authoring';
import { createEditorProjectStorage, loadEditorProjectSnapshot } from '../src/authoring-project-storage.js';
import { state } from '../src/state.js';

const original = {
  dirName: state.dirName,
  gameConfigText: state.gameConfigText,
  scenes: state.scenes,
  timelines: state.timelines,
  configFiles: state.configFiles,
  configReadErrors: state.configReadErrors,
};

afterEach(() => {
  state.dirName = original.dirName;
  state.gameConfigText = original.gameConfigText;
  state.scenes = original.scenes;
  state.timelines = original.timelines;
  state.configFiles = original.configFiles;
  state.configReadErrors = original.configReadErrors;
});

describe('editor authoring project storage', () => {
  it('refuses an authoring snapshot with unreadable config instead of omitting its dependencies', async () => {
    state.configReadErrors = { events: 'content/config/events.json 解析失败' };
    await expect(loadEditorProjectSnapshot()).rejects.toThrow(/events.json/);
    await expect(createEditorProjectStorage({ ...state }).listFiles()).rejects.toThrow(/events.json/);
  });
  it('reads dirty in-memory scene text and computes Web Crypto SHA-256', async () => {
    state.dirName = 'memory-project';
    state.gameConfigText = JSON.stringify({ entryScene: 'intro', variables: {} });
    state.scenes = new Map([['intro', {
      id: 'intro', file: 'intro.gal', text: '@scene intro\n凛：dirty。\n@end\n', eol: '\n', dirty: true, handle: null,
    }]]);
    state.timelines = [];
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };

    const storage = createEditorProjectStorage();
    expect(await storage.listFiles()).toContain('content/scenario/intro.gal');
    const file = await storage.readText('content/scenario/intro.gal');
    expect(file.text).toContain('dirty');
    expect(file.bytes).toBe(new TextEncoder().encode(file.text).byteLength);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds the shared snapshot/index from the same dirty memory projection', async () => {
    state.dirName = 'memory-project';
    state.gameConfigText = JSON.stringify({ entryScene: 'intro', variables: {} });
    state.scenes = new Map([['intro', {
      id: 'intro', file: 'intro.gal', text: '@scene intro\n@label start\n凛：dirty。\n@end\n', eol: '\n', dirty: true, handle: null,
    }]]);
    state.timelines = [];
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };

    const snapshot = await loadEditorProjectSnapshot();
    const index = buildObjectIndex(snapshot);
    expect(snapshot.scenes[0]?.file.text).toContain('dirty');
    expect(index.objects.some((object) => object.objectRef === 'label:intro.start')).toBe(true);
  });
});
