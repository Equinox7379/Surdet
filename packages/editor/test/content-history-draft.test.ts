import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentHistoryFileDiff } from '@surdet/authoring';
import { state } from '../src/state.js';
import { histories, undo } from '../src/history.js';
import { clearTimelineHistories, takeTimelineUndo } from '../src/timeline-history.js';

const baseline = vi.hoisted(() => ({ files: [] as Array<{ path: string; sha256: string }> }));
vi.mock('../src/editor-workspace.js', () => ({ editorWorkspaceStatus: () => ({ baseline }) }));
vi.mock('../src/project-io.js', () => ({ sceneTextSha256: async (text: string) => createHash('sha256').update(text).digest('hex') }));
vi.mock('../src/panels/config.js', () => ({ restoreConfigSourceDraft: vi.fn() }));
import { prepareHistoryFileDraft } from '../src/content-history-draft.js';

function diff(path: string, before: string | null, after: string): ContentHistoryFileDiff {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  baseline.files = before === null ? [] : [{ path, sha256: hash(before) }];
  return { path, currentText: before, historicalText: after, currentSha256: before === null ? null : hash(before), historicalSha256: hash(after) };
}
beforeEach(() => { state.scenes.clear(); state.timelines = []; histories.clear(); clearTimelineHistories(); baseline.files = []; });

describe('Editor selected historical file draft', () => {
  it('restores an existing nested scene exactly, preserves other scenes and records ordinary undo', async () => {
    const current = '@scene start\r\n旁白：现在\r\n@end\r\n', old = '@scene start\r\n旁白：以前\r\n@end\r\n';
    state.scenes.set('chapter/start', { id: 'start', file: 'chapter/start.gal', text: current, eol: '\r\n', dirty: false, handle: null });
    state.scenes.set('extra', { id: 'extra', file: 'extra.gal', text: '保留', eol: '\n', dirty: false, handle: null });
    const apply = await prepareHistoryFileDraft(diff('content/scenario/chapter/start.gal', current, old));
    expect(state.scenes.get('chapter/start')!.text).toBe(current);
    apply();
    expect(state.scenes.get('chapter/start')).toMatchObject({ text: old, dirty: true });
    expect(state.scenes.get('extra')!.text).toBe('保留');
    undo();
    expect(state.scenes.get('chapter/start')!.text).toBe(current);
  });
  it('rejects mismatched bytes or newly edited text without changing the draft', async () => {
    state.scenes.set('start', { id: 'start', file: 'start.gal', text: '未保存的新输入', eol: '\n', dirty: true, handle: null });
    const file = diff('content/scenario/start.gal', '已保存', '历史');
    await expect(prepareHistoryFileDraft(file)).rejects.toThrow('剧本已经修改');
    await expect(prepareHistoryFileDraft({ ...file, historicalText: '被换掉的文本' })).rejects.toThrow('正文不完整');
    expect(state.scenes.get('start')!.text).toBe('未保存的新输入');
  });
  it('finds a missing scene as a normal new draft without creating a disk handle', async () => {
    (await prepareHistoryFileDraft(diff('content/scenario/chapter/lost.gal', null, '@scene lost\n旁白：找回\n@end\n')))();
    expect(state.scenes.get('chapter/lost')).toMatchObject({ id: 'lost', file: 'chapter/lost.gal', dirty: true, handle: null });
    expect(state.scenes.get('chapter/lost')!.pendingCreateOperationId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('restores malformed current timeline text using the normal timeline undo stack', async () => {
    const old = '{"version":1,"id":"intro","durationMs":1000,"tracks":[{"kind":"screen","cues":[{"atMs":0,"durationMs":1000,"easing":"linear","action":"fade","alpha":0}]}]}';
    state.timelines.push({ id: 'intro', file: 'intro.json', text: '{broken', eol: '\n', dirty: false, handle: null });
    (await prepareHistoryFileDraft(diff('content/timelines/intro.json', '{broken', old)))();
    expect(state.timelines[0]).toMatchObject({ text: old, dirty: true });
    expect(takeTimelineUndo('intro', old)?.text).toBe('{broken');
  });
});
