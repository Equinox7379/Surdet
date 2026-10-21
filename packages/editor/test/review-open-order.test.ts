import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget } from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HumanReviewProjectionV2 } from '@surdet/authoring';
import { state } from '../src/state.js';
import * as workspaceApi from '../src/review-workspace.js';
import type { ReviewWorkspaceState } from '../src/review-workspace.js';
import { openReviewPanelWorkspace } from '../src/panels/review-panel.js';
import { openListedReviewTask } from '../src/panels/review-tasks.js';
import { openReviewPreview, selectReviewPreviewScene } from '../src/review-preview.js';
import { bindProjectIoHooks, openProjectFromHandle } from '../src/project-io.js';

// Run the shipped top-bar callback, returning its async work only for awaiting.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const start = main.indexOf('    onOpenReview: () => {');
const end = main.indexOf('\n    onUndo:', start);
if (start < 0 || end < 0) throw new Error('Missing top-bar callback');
const script = transpileModule(`const callbacks = {${main.slice(start, end).replace('void (async () => {', 'return (async () => {')}};`,
  { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
const topBar = new Function('openReviewPanelWorkspace', 'openListedReviewTask', 'renderAll', 'setStatus',
  `${script}\nreturn callbacks.onOpenReview;`)(openReviewPanelWorkspace, openListedReviewTask, () => {}, () => {}) as () => Promise<void>;

function workspace(id = 'current'): ReviewWorkspaceState {
  const projection: HumanReviewProjectionV2 = {
    reviewVersion: '2.0.0', reviewId: id, kind: 'comparison', state: 'COMPARISON_PREPARED',
    projectIdentity: 'project', expectedProjectRevision: 'revision', reviewFingerprint: 'fixture',
    task: { title: id, acceptanceCriteria: [], candidateCount: 0, objectCount: 0, conflictCount: 0, statementSource: 'generated-fallback' },
    candidates: [], safeGroups: [], defaultSelectedUnitIds: [], conflicts: [], dependencies: [], objects: [],
    creativeBrief: { status: 'not-provided', source: 'review-preparation-input', acceptanceCriteria: [] },
    evidence: { candidateMatrix: [], blockingCount: 0, selectionRequiredCount: 0, advisoryCount: 0, canCreateDecision: true },
    sourceIdentity: { projectIdentity: 'project', expectedProjectRevision: 'revision', comparisonFingerprint: 'fixture' },
  };
  return {
    rootHandle: {} as FileSystemDirectoryHandle,
    identity: { reviewVersion: '2.0.0', reviewId: id, kind: 'comparison', projectIdentity: 'project', expectedProjectRevision: 'revision',
      comparisonFingerprint: 'fixture', payload: { relativePath: 'comparison/review.json', bytes: 1, sha256: 'unused' } },
    projection, decisionDraft: { decisionId: '', selectedUnitIds: [], conflictResolutions: [] },
    selectedReviewObjectRef: null, projectHandle: null, officialResultTreeSha256: null, currentResultTreeSha256: null,
    fixtureChanged: false, receiptStatus: 'none', decisionReceipt: null, approvalReceipt: null, returnReceipt: null,
    authority: { state: 'available', message: 'connected' },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
const original = { reviewWorkspace: state.reviewWorkspace, mainTab: state.mainTab,
  selectedObjectRef: state.selectedObjectRef, previewChoices: state.previewChoices, dirName: state.dirName };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Object.assign(state, original); });

describe('review replacement uses consent and successful-open order', () => {
  it.each(['top-bar', 'list'] as const)('keeps the unsaved decision when discard is refused through %s', async route => {
    const current = workspace(); state.reviewWorkspace = current;
    workspaceApi.discardReviewDraft(current);
    current.decisionDraft.decisionIntent = { mode: 'custom-mix' };
    current.decisionDraft.selectedUnitIds = ['chosen-unit'];
    expect(workspaceApi.hasReviewDraft(current)).toBe(true);
    const confirm = vi.fn(() => false), picker = vi.fn(async () => ({} as FileSystemDirectoryHandle));
    vi.stubGlobal('window', { confirm, showDirectoryPicker: picker });
    const read = vi.spyOn(workspaceApi, 'openReviewWorkspace').mockResolvedValue(workspace('replacement'));
    if (route === 'top-bar') await topBar(); else expect(await openListedReviewTask(picker, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce(); expect(state.reviewWorkspace).toBe(current);
    expect(state.reviewWorkspace.decisionDraft.selectedUnitIds).toEqual(['chosen-unit']);
    expect(read).not.toHaveBeenCalled();
  });

  it('checks a decision edited while the picker read is pending', async () => {
    const current = workspace(); state.reviewWorkspace = current; workspaceApi.discardReviewDraft(current);
    const gate = deferred<ReviewWorkspaceState>();
    const read = vi.spyOn(workspaceApi, 'openReviewWorkspace').mockReturnValue(gate.promise);
    const confirm = vi.fn(() => false);
    vi.stubGlobal('window', { confirm, showDirectoryPicker: async () => ({}) });
    const opening = topBar(); await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    current.decisionDraft.decisionIntent = { mode: 'custom-mix' }; current.decisionDraft.selectedUnitIds = ['new-selection'];
    gate.resolve(workspace('other')); await opening;
    expect(confirm).toHaveBeenCalledOnce(); expect(state.reviewWorkspace).toBe(current);
  });

  it.each(['other-review', 'same-review'] as const)('ignores an older read after a newer successful %s open', async mode => {
    state.reviewWorkspace = null;
    const older = workspace('older'), newer = workspace(mode === 'same-review' ? 'older' : 'newer');
    const gate = deferred<ReviewWorkspaceState>();
    const read = vi.spyOn(workspaceApi, 'openReviewWorkspace').mockReturnValueOnce(gate.promise).mockResolvedValueOnce(newer);
    vi.stubGlobal('window', { confirm: () => true, showDirectoryPicker: async () => ({}) });
    const first = topBar(); await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await topBar(); expect(state.reviewWorkspace).toBe(newer);
    gate.resolve(older); await first; expect(state.reviewWorkspace).toBe(newer);
  });

  it('ignores an older picker after a newer task-list open has succeeded', async () => {
    state.reviewWorkspace = null;
    const gate = deferred<FileSystemDirectoryHandle>(), newer = workspace('newer');
    const read = vi.spyOn(workspaceApi, 'openReviewWorkspace').mockResolvedValue(newer);
    const picker = vi.fn(() => gate.promise);
    vi.stubGlobal('window', { confirm: () => true, showDirectoryPicker: picker });
    const first = topBar(); await vi.waitFor(() => expect(picker).toHaveBeenCalledOnce());
    expect(await openListedReviewTask(async () => ({} as FileSystemDirectoryHandle), () => true)).toBe(true);
    gate.resolve({} as FileSystemDirectoryHandle); await first;
    expect(state.reviewWorkspace).toBe(newer); expect(read).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'read-error', 'decline'] as const)('allows an earlier legitimate read after a newer %s', async failure => {
    state.reviewWorkspace = null;
    const gate = deferred<ReviewWorkspaceState>(), earlier = workspace('earlier');
    const read = vi.spyOn(workspaceApi, 'openReviewWorkspace').mockReturnValueOnce(gate.promise);
    vi.stubGlobal('window', { confirm: () => true, showDirectoryPicker: async () => ({}) });
    const first = topBar(); await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    if (failure === 'cancel') {
      await expect(openListedReviewTask(async () => { throw new DOMException('cancelled', 'AbortError'); }, () => true)).rejects.toMatchObject({ name: 'AbortError' });
    } else if (failure === 'read-error') {
      read.mockRejectedValueOnce(new Error('controlled read error'));
      await expect(openListedReviewTask(async () => ({} as FileSystemDirectoryHandle), () => true)).rejects.toThrow('controlled');
    } else {
      read.mockResolvedValueOnce(workspace('declined'));
      expect(await openReviewPanelWorkspace(async () => ({} as FileSystemDirectoryHandle), () => false)).toBe(false);
    }
    gate.resolve(earlier); await first; expect(state.reviewWorkspace).toBe(earlier);
  });
});

describe('review project read ownership', () => {
  it.each(['current', 'switched', 'scan-failure'] as const)('keeps the previous project until the final fixture scan settles (%s)', async mode => {
    const previous = { ...state }, gate = deferred<void>();
    const missing = () => new DOMException('missing', 'NotFoundError');
    const scene = { kind: 'file', name: 'start.gal', getFile: async () => new File(['@scene start\n@end\n'], 'start.gal') };
    const config = { kind: 'file', name: 'game.config.json', getFile: async () => new File([
      JSON.stringify({ title: 'Preview project', entryScene: 'start', characters: {} }),
    ], 'game.config.json') };
    const scenario = { kind: 'directory', name: 'scenario', async *values() { yield scene; } };
    const content = { kind: 'directory', name: 'content',
      getDirectoryHandle: async (name: string) => { if (name === 'scenario') return scenario; throw missing(); } };
    const directory = { kind: 'directory', name: 'Preview project',
      getDirectoryHandle: async (name: string) => { if (name === 'content') return content; throw missing(); },
      getFileHandle: async (name: string) => { if (name === 'game.config.json') return config; throw missing(); },
    } as unknown as FileSystemDirectoryHandle;
    const current = workspace('scan-A'); current.identity.kind = current.projection.kind = 'integration-result'; current.projectHandle = directory;
    const closing = vi.fn(), scan = vi.fn(async () => { await gate.promise; if (mode === 'scan-failure') throw new Error('controlled scan failure'); return false; });
    // Run the shipped preview orchestration and real project IO, controlling only the async scan.
    // No identity calculation or hash verification runs in this concurrency test.
    const source = readFileSync(new URL('../src/review-preview.ts', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('export async function openReviewPreview(')).replace('export async function', 'async function');
    const script = transpileModule(body, { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
    const preview = new Function('state', 'openProjectFromHandle', 'refreshReviewFixtureIdentity', 'hashReviewFixtureTree', 'selectReviewPreviewScene',
      `${script}\nreturn openReviewPreview;`)(state, openProjectFromHandle, scan, () => { throw new Error('Unexpected identity verification'); }, selectReviewPreviewScene) as typeof openReviewPreview;
    bindProjectIoHooks({ renderAll: () => {}, renderSidebar: () => {}, runValidate: () => {}, onProjectClosing: closing });
    const oldHandle = {} as FileSystemDirectoryHandle, oldScenes = new Map();
    Object.assign(state, { reviewWorkspace: current, dirName: 'Original project', dirHandle: oldHandle, scenes: oldScenes,
      gameConfigText: '{"title":"Original project"}', pendingSceneDeletes: [], pendingSceneCommit: null, pendingTimelineRestores: new Map(),
      previewTimelineId: null, projectLoading: false });
    vi.stubGlobal('document', { getElementById: () => null });
    const completion = preview(current, {}, async () => { throw new Error('Unexpected identity calculation'); }).then(value => ({ value }), error => ({ error }));
    try {
      await Promise.race([vi.waitFor(() => expect(scan).toHaveBeenCalledOnce()), completion.then(result => { if ('error' in result) throw result.error; })]);
      expect(closing).not.toHaveBeenCalled();
      expect(state.projectLoading).toBe(true);
      expect(state.dirHandle).toBe(oldHandle); expect(state.scenes).toBe(oldScenes);
      expect(state.gameConfigText).toBe('{"title":"Original project"}');
      const replacement = workspace('scan-B');
      if (mode === 'switched') {
        vi.spyOn(workspaceApi, 'openReviewWorkspace').mockResolvedValue(replacement);
        expect(await openListedReviewTask(async () => ({} as FileSystemDirectoryHandle), () => true)).toBe(true);
      }
      gate.resolve(); const result = await completion;
      expect(state.projectLoading).toBe(false);
      if (mode === 'current') {
        expect(result).toMatchObject({ value: { sceneId: 'start' } }); expect(closing).toHaveBeenCalledOnce();
        expect(state.dirHandle).toBe(directory); expect(state.dirName).toBe('Preview project');
      } else {
        expect(result).toMatchObject({ error: expect.any(Error) }); expect(closing).not.toHaveBeenCalled();
        expect(state.dirHandle).toBe(oldHandle); expect(state.scenes).toBe(oldScenes);
        expect(state.gameConfigText).toBe('{"title":"Original project"}');
        expect(state.reviewWorkspace).toBe(mode === 'switched' ? replacement : current);
      }
    } finally { gate.resolve(); await completion; Object.assign(state, previous); }
  });

  it.each([false, true])('commits the preview only if its review is still current (switch: %s)', async switchReview => {
    const previous = { ...state };
    const gate = deferred<void>();
    const getConfig = vi.fn(async () => {
      await gate.promise;
      return new File([JSON.stringify({ title: 'Preview project', entryScene: 'start', characters: {} })], 'game.config.json');
    });
    const scene = { kind: 'file', name: 'start.gal', getFile: async () => new File(['@scene start\n@end\n'], 'start.gal') };
    const config = { kind: 'file', name: 'game.config.json', getFile: getConfig };
    const missing = () => new DOMException('missing', 'NotFoundError');
    const scenario = { kind: 'directory', name: 'scenario', async *values() { yield scene; } };
    const content = { kind: 'directory', name: 'content',
      getDirectoryHandle: async (name: string) => { if (name === 'scenario') return scenario; throw missing(); },
      async *values() { yield scenario; } };
    const directory = { kind: 'directory', name: 'Preview project',
      getDirectoryHandle: async (name: string) => { if (name === 'content') return content; throw missing(); },
      getFileHandle: async (name: string) => { if (name === 'game.config.json') return config; throw missing(); },
      async *values() { yield config; yield content; } } as unknown as FileSystemDirectoryHandle;
    const current = workspace('preview-A'); current.identity.kind = current.projection.kind = 'integration-result';
    current.projectHandle = directory;
    const closing = vi.fn();
    bindProjectIoHooks({ renderAll: () => {}, renderSidebar: () => {}, runValidate: () => {}, onProjectClosing: closing });
    Object.assign(state, { reviewWorkspace: current, dirName: 'Original project', dirHandle: {} as FileSystemDirectoryHandle, scenes: new Map(),
      pendingSceneDeletes: [], pendingSceneCommit: null, pendingTimelineRestores: new Map(),
      previewTimelineId: null, projectLoading: false });
    vi.stubGlobal('document', { getElementById: () => null });
    const completion = openReviewPreview(current).then(value => ({ value }), error => ({ error }));
    try {
      await vi.waitFor(() => expect(getConfig).toHaveBeenCalledOnce());
      const replacement = workspace('review-B');
      if (switchReview) {
        vi.spyOn(workspaceApi, 'openReviewWorkspace').mockResolvedValue(replacement);
        expect(await openListedReviewTask(async () => ({} as FileSystemDirectoryHandle), () => true)).toBe(true);
      }
      gate.resolve();
      const result = await completion;
      if (switchReview) {
        expect(result).toMatchObject({ error: expect.any(Error) });
        expect(closing).not.toHaveBeenCalled();
        expect(state.reviewWorkspace).toBe(replacement);
        expect(state.dirName).toBe('Original project');
        expect(state.scenes.size).toBe(0);
      } else {
        expect(result).toMatchObject({ value: { sceneId: 'start' } });
        expect(closing).toHaveBeenCalledOnce();
        expect(state.reviewWorkspace).toBe(current);
        expect(state.dirName).toBe('Preview project');
      }
    } finally { gate.resolve(); await completion; Object.assign(state, previous); }
  });
});
