import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { state } from '../src/state.js';
import { applyStageSourceEdit, captureStageEditBaseline } from '../src/stage-editing.js';
import { histories, undo, redo } from '../src/history.js';
import { clearTimelineHistories, takeTimelineUndo, timelineHistoryDepth } from '../src/timeline-history.js';

const originalState = { ...state };
const sceneText = '@scene start\r\n@show rin:coat normal @x=300 @custom="keep @ sign"\r\n正文。\r\n@end\r\n';
beforeEach(() => {
  Object.assign(state, { dirHandle: null, dirName: 'stage-editing', current: 'start.gal', projectLoading: false,
    projectWriteLock: null, pendingSceneCommit: null, reviewWorkspace: null, reviewPreviewReadOnly: false,
    gameConfigText: '{"entryScene":"start","variables":{}}', configReadErrors: {}, dirAssets: [],
    pendingSceneConfigRenames: [], pendingSceneConfigWrites: [],
    configFiles: { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null },
    scenes: new Map([['start.gal', { id: 'start', file: 'start.gal', text: sceneText, eol: '\r\n', dirty: false, handle: null }]]),
    timelines: [], currentTimeline: null, currentTimelineCue: null });
  histories.clear(); clearTimelineHistories();
});
afterEach(() => { Object.assign(state, originalState); histories.clear(); clearTimelineHistories(); });
const sceneSource = () => ({ kind: 'scene' as const, sceneId: 'start', file: 'start.gal', line: 2,
  instructionIndex: compileScene(sceneText, 'start.gal', 'start').instructions.find(value => value.op === 'instr' && value.name === 'show')!.index });

describe('stage source edits join existing editor histories', () => {
  it('changes only the source modifier with one reversible scene edit', async () => {
    const baseline = captureStageEditBaseline();
    await applyStageSourceEdit(baseline, sceneSource(), { x: 520 });
    const changed = sceneText.replace('@x=300', '@x=520');
    expect(state.scenes.get('start.gal')!.text).toBe(changed);
    expect(histories.get('start.gal')!.past).toEqual([sceneText]);
    undo(); expect(state.scenes.get('start.gal')!.text).toBe(sceneText);
    redo(); expect(state.scenes.get('start.gal')!.text).toBe(changed);
  });

  it('rejects source drift, read-only state and project switching without history or content writes', async () => {
    const baseline = captureStageEditBaseline();
    const changed = sceneText.replace('正文。', '后续输入。');
    state.scenes.get('start.gal')!.text = changed;
    await expect(applyStageSourceEdit(baseline, sceneSource(), { x: 800 })).rejects.toThrow('来源场景已经改变');
    expect(state.scenes.get('start.gal')!.text).toBe(changed);
    state.scenes.get('start.gal')!.text = sceneText;
    state.reviewPreviewReadOnly = true;
    await expect(applyStageSourceEdit(baseline, sceneSource(), { x: 800 })).rejects.toThrow('只读来源');
    state.reviewPreviewReadOnly = false; state.dirName = 'another-project';
    await expect(applyStageSourceEdit(baseline, sceneSource(), { x: 800 })).rejects.toThrow('项目');
    expect(histories.size).toBe(0);
    expect(state.scenes.get('start.gal')!.text).toBe(sceneText);
  });

  it('requires explicit old timeline upgrade and makes upgrade plus cue edit one undo step', async () => {
    const text = JSON.stringify({ version: 1, id: 'intro', durationMs: 100, note: 'preserved', tracks: [
      { kind: 'portrait', target: 'rin:coat', cues: [{ atMs: 0, durationMs: 100, easing: 'linear', action: 'show', expression: 'normal', position: 'left' }] },
    ] });
    const entry = { id: 'intro', file: 'nested/intro.json', text, eol: '\n' as const, dirty: false, handle: null };
    state.timelines = [entry];
    const source = { kind: 'timeline' as const, timelineId: 'intro', trackIndex: 0, cueIndex: 0 };
    const baseline = captureStageEditBaseline();
    await expect(applyStageSourceEdit(baseline, source, { scale: 1.3 })).rejects.toThrow('明确确认升级');
    expect(entry.text).toBe(text); expect(timelineHistoryDepth('intro').undo).toBe(0);
    await applyStageSourceEdit(baseline, source, { scale: 1.3 }, { allowVersionUpgrade: true });
    expect(JSON.parse(entry.text)).toMatchObject({ version: 2, note: 'preserved', tracks: [{ cues: [{ scale: 1.3, expression: 'normal', position: 'left' }] }] });
    expect(timelineHistoryDepth('intro').undo).toBe(1);
    expect(takeTimelineUndo('intro', entry.text)?.text).toBe(text);
  });

  it('refuses implicit edits of a reusable clip definition and rejects later timeline drift', async () => {
    const text = JSON.stringify({ version: 2, id: 'step', durationMs: 100, tracks: [
      { kind: 'portrait', target: 'rin:coat', cues: [{ atMs: 0, durationMs: 100, easing: 'linear', action: 'pose', x: 400 }] },
    ] });
    const entry = { id: 'step', file: 'step.json', text, eol: '\n' as const, dirty: false, handle: null };
    state.timelines = [entry];
    const source = { kind: 'timeline' as const, timelineId: 'step', trackIndex: 0, cueIndex: 0,
      instances: [{ timelineId: 'parent', clipIndex: 0, iteration: 0 }] };
    const baseline = captureStageEditBaseline();
    await expect(applyStageSourceEdit(baseline, source, { x: 700 })).rejects.toThrow('所有引用');
    expect(entry.text).toBe(text);
    await applyStageSourceEdit(baseline, source, { x: 700 }, { allowClipDefinition: true });
    const edited = entry.text;
    await expect(applyStageSourceEdit(baseline, source, { x: 900 }, { allowClipDefinition: true })).rejects.toThrow('来源时间轴已经变化');
    expect(entry.text).toBe(edited); expect(timelineHistoryDepth('step').undo).toBe(1);
  });
});
