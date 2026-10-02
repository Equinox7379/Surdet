import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadProjectSnapshot } from '@surdet/authoring';
import { getCurrentPreviewTrace, renderPreviewPanel } from '../src/panels/preview-panel.js';
import { state } from '../src/state.js';
import * as workspace from '../src/editor-workspace.js';
import { previewTextHash } from '../src/preview-content.js';
import { editThemeConfigDraft, readThemeConfigDraft, resetConfigSession } from '../src/panels/config.js';

// This suite verifies replay/source publication, not the independently tested
// stage inspector DOM. Preserve the real mounting and disposal contract.
vi.mock('../src/stage-workspace.js', () => ({
  createStageWorkspace: () => ({ element: document.createElement('details'), reset() {}, dispose() {} }),
}));

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  readonly style = { setProperty: (_name: string, _value: string): void => {} };
  className = '';
  checked = false;
  isConnected = true;
  src = '';
  title = '';
  type = '';
  value = '';
  onclick: (() => void) | null = null;
  onchange: (() => void) | null = null;
  contentWindow: { postMessage: (message: unknown, ...rest: unknown[]) => void } | null = null;
  private ownText = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  set innerHTML(value: string) {
    if (value === '') {
      this.ownText = '';
      this.children.splice(0);
    }
  }

  set textContent(value: string | null) {
    this.ownText = value ?? '';
    this.children.splice(0);
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  insertBefore(child: FakeElement, before: FakeElement | null): FakeElement {
    const index = before === null ? -1 : this.children.indexOf(before);
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    return child;
  }

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  replaceChildren(...children: FakeElement[]): void { this.children.splice(0); this.append(...children); }
  remove(): void { this.isConnected = false; }

  querySelector(tagName: string): FakeElement | null {
    const selector = /^(\w+)(?:\[aria-label="([^"]+)"\])?$/.exec(tagName);
    const expected = (selector?.[1] ?? tagName).toUpperCase();
    const visit = (element: FakeElement): FakeElement | null => {
      if (element.tagName === expected && (!selector?.[2] || element.attributes['aria-label'] === selector[2])) return element;
      for (const child of element.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this);
  }

  findButton(label: string): FakeElement | null {
    const visit = (element: FakeElement): FakeElement | null => {
      if (element.tagName === 'BUTTON' && element.textContent === label) return element;
      for (const child of element.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this);
  }
}

const postedPreviewMessages: unknown[] = [];
let previewMessageListener: ((event: MessageEvent) => void) | null = null;

const documentStub = {
  createElement: (tag: string) => {
    const element = new FakeElement(tag);
    if (tag.toLowerCase() === 'iframe') {
      element.contentWindow = { postMessage: (message: unknown) => { postedPreviewMessages.push(message); } };
    }
    return element;
  },
  createTextNode: (text: string) => {
    const node = new FakeElement('#text');
    node.textContent = text;
    return node;
  },
  getElementById: () => null,
};

const originalState = {
  current: state.current,
  dirName: state.dirName,
  dirHandle: state.dirHandle,
  autosaveProjectId: state.autosaveProjectId,
  previewTimelineId: state.previewTimelineId,
  reviewWorkspace: state.reviewWorkspace,
  scenes: state.scenes,
  gameConfigText: state.gameConfigText,
  dirAssets: state.dirAssets,
  configReadErrors: state.configReadErrors,
  handles: state.handles,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  postedPreviewMessages.splice(0);
  state.current = originalState.current;
  state.dirName = originalState.dirName;
  state.dirHandle = originalState.dirHandle;
  state.autosaveProjectId = originalState.autosaveProjectId;
  state.previewTimelineId = originalState.previewTimelineId;
  state.reviewWorkspace = originalState.reviewWorkspace;
  state.scenes = originalState.scenes;
  state.gameConfigText = originalState.gameConfigText;
  state.dirAssets = originalState.dirAssets;
  state.configReadErrors = originalState.configReadErrors;
  state.handles = originalState.handles;
  resetConfigSession();
});

describe('timeline preview replay', () => {
  it('plays a memory scene without a config file and refuses an existing empty config', async () => {
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', { addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') previewMessageListener = listener;
    }) });
    resetConfigSession();
    state.current = 'intro.gal'; state.dirHandle = null; state.dirAssets = [];
    state.reviewWorkspace = null; state.previewTimelineId = null; state.configReadErrors = {};
    state.gameConfigText = ''; state.handles = { ...state.handles, gameConfig: null };
    state.scenes = new Map([['intro.gal', { id: 'intro', file: 'intro.gal', text: '@scene intro\n旁白：内存试玩。\n@end', eol: '\n', dirty: false, handle: null }]]);
    const container = new FakeElement('div');
    renderPreviewPanel(container as unknown as HTMLElement);
    const frame = container.querySelector('iframe')!;
    previewMessageListener!({ data: { type: 'surdet-preview-ready' }, source: frame.contentWindow } as unknown as MessageEvent);
    await vi.waitFor(() => expect(postedPreviewMessages, container.textContent).toHaveLength(1));
    expect((postedPreviewMessages[0] as { payload: { gameConfig: unknown } }).payload.gameConfig).toEqual({});
    state.handles = { ...state.handles, gameConfig: {} as FileSystemFileHandle };
    container.findButton('重新播放')!.onclick?.();
    await vi.waitFor(() => expect(container.textContent).toContain('game.config.json 无法读取'));
    expect(postedPreviewMessages).toHaveLength(1);
  });
  it('sends the edited theme to the actual preview load and rejects invalid drafts before posting', async () => {
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') previewMessageListener = listener;
      }),
    });
    resetConfigSession();
    state.current = 'intro.gal';
    state.dirName = 'theme-preview';
    state.dirHandle = null;
    state.dirAssets = [];
    state.reviewWorkspace = null;
    state.previewTimelineId = null;
    state.configReadErrors = {};
    state.gameConfigText = JSON.stringify({ entryScene: 'intro', variables: {}, player: { subtitle: 'keep' } });
    state.scenes = new Map([['intro.gal', {
      id: 'intro', file: 'intro.gal', text: '@scene intro\n@end', eol: '\n', dirty: false, handle: null,
    }]]);
    const container = new FakeElement('div');
    renderPreviewPanel(container as unknown as HTMLElement);
    const frame = container.querySelector('iframe')!;
    previewMessageListener!({ data: { type: 'surdet-preview-ready' }, source: frame.contentWindow } as unknown as MessageEvent);
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(1));

    state.dirAssets = [{ key: 'logo', kind: 'bg', isImage: true, sourcePath: 'content/assets/bg/logo.svg', handle: {
      getFile: async () => new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'], 'logo.svg', { type: 'image/svg+xml' }),
    } as unknown as FileSystemFileHandle }];
    editThemeConfigDraft('{"theme":{"colors":{"accent":1193046}},"titleLogo":"logo"}');
    container.findButton('重新播放')!.onclick?.();
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(2));
    const config = (postedPreviewMessages[1] as { payload: { gameConfig: Record<string, any> } }).payload.gameConfig;
    expect(config.theme.colors.accent).toBe(1193046);
    expect(config.player).toEqual({ subtitle: 'keep', titleLogo: 'logo' });

    editThemeConfigDraft('{"theme":"bad","titleLogo":null}');
    container.findButton('重新播放')!.onclick?.();
    await vi.waitFor(() => expect(container.textContent).toMatch(/theme|主题/));
    expect(postedPreviewMessages).toHaveLength(2);
    editThemeConfigDraft('{"theme":{"dialogSkin":"missing-paper"},"titleLogo":null}');
    container.findButton('重新播放')!.onclick?.();
    await vi.waitFor(() => expect(container.textContent).toContain('missing-paper'));
    expect(postedPreviewMessages).toHaveLength(2);
    resetConfigSession();
  });

  it('aborts a pending preview read when the theme draft changes before publication', async () => {
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') previewMessageListener = listener;
      }),
    });
    let started!: () => void, release!: () => void;
    const readStarted = new Promise<void>(resolve => { started = resolve; });
    const readReleased = new Promise<void>(resolve => { release = resolve; });
    const fileHandle = { getFile: async () => {
      started();
      await readReleased;
      return new File([new Uint8Array([1, 2, 3])], 'font.ttf');
    } };
    resetConfigSession();
    state.current = 'intro.gal';
    state.dirName = 'theme-read-race';
    state.dirHandle = { getFileHandle: async () => fileHandle } as unknown as FileSystemDirectoryHandle;
    state.dirAssets = [];
    state.reviewWorkspace = null;
    state.previewTimelineId = null;
    state.configReadErrors = {};
    state.gameConfigText = JSON.stringify({ entryScene: 'intro', font: 'font.ttf', theme: { colors: { accent: 7 } } });
    state.scenes = new Map([['intro.gal', {
      id: 'intro', file: 'intro.gal', text: '@scene intro\n@end', eol: '\n', dirty: false, handle: null,
    }]]);
    readThemeConfigDraft();
    editThemeConfigDraft('{"theme":{"colors":{"accent":8}},"titleLogo":null}');
    const container = new FakeElement('div');
    renderPreviewPanel(container as unknown as HTMLElement);
    const frame = container.querySelector('iframe')!;
    previewMessageListener!({ data: { type: 'surdet-preview-ready' }, source: frame.contentWindow } as unknown as MessageEvent);
    await readStarted;
    editThemeConfigDraft('{"theme":{"colors":{"accent":9}},"titleLogo":null}');
    release();
    await vi.waitFor(() => expect(container.textContent).toContain('读取素材期间内容或项目发生变化'));
    expect(postedPreviewMessages).toHaveLength(0);
    container.findButton('重新播放')!.onclick?.();
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(1));
    expect((postedPreviewMessages[0] as { payload: { gameConfig: Record<string, any> } }).payload.gameConfig.theme.colors.accent).toBe(9);
  });

  it('keeps replay identity, excludes late events and waits for saved-observation invalidation', async () => {
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') previewMessageListener = listener;
      }),
    });
    state.current = 'intro.gal';
    state.dirName = 'same-project-name';
    state.autosaveProjectId = 'project-unique-a';
    state.scenes = new Map([
      ['intro.gal', {
        id: 'intro',
        file: 'intro.gal',
        text: '@scene intro\n@label start\n凛：你好\n@end',
        eol: '\n',
        dirty: false,
        handle: null,
      }],
    ]);
    state.reviewWorkspace = null;
    state.previewTimelineId = 'opening';
    const container = new FakeElement('div');

    renderPreviewPanel(container as unknown as HTMLElement);
    const frame = container.querySelector('iframe');
    expect(frame?.contentWindow).not.toBeNull();
    expect(previewMessageListener).not.toBeNull();
    previewMessageListener!({ data: { type: 'surdet-preview-ready' }, source: {} } as unknown as MessageEvent);
    await Promise.resolve();
    expect(postedPreviewMessages).toHaveLength(0);

    container.isConnected = false;
    previewMessageListener!({ data: { type: 'surdet-preview-ready' }, source: frame!.contentWindow } as unknown as MessageEvent);
    await Promise.resolve();
    expect(postedPreviewMessages).toHaveLength(0);

    container.isConnected = true;
    previewMessageListener!({ data: { type: 'surdet-preview-ready' }, source: frame!.contentWindow } as unknown as MessageEvent);
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(1));
    expect((postedPreviewMessages[0] as { payload: { projectKey: string } }).payload.projectKey).toBe('project-unique-a');
    const reload = container.findButton('重新播放');
    expect(reload).not.toBeNull();
    reload!.onclick?.();
    expect(state.previewTimelineId).toBe('opening');
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(2));
    expect(postedPreviewMessages.map((message) => (
      message as { payload?: { timelinePreviewId?: string } }
    ).payload?.timelinePreviewId)).toEqual(['opening', 'opening']);

    const entrySelector = container.querySelector('select[aria-label="播放入口"]');
    expect(entrySelector).not.toBeNull();
    entrySelector!.value = 'start';
    entrySelector!.onchange?.();
    expect(state.previewTimelineId).toBeNull();
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(3));
    const traceId = (postedPreviewMessages[2] as { payload: { traceId: string } }).payload.traceId;
    const oldTraceId = (postedPreviewMessages[1] as { payload: { traceId: string } }).payload.traceId;
    previewMessageListener!({
      data: { type: 'surdet-preview-trace-start', traceId: oldTraceId, generation: 99, sceneId: 'intro' },
      source: frame!.contentWindow,
    } as unknown as MessageEvent);
    expect(getCurrentPreviewTrace()).toHaveLength(0);

    previewMessageListener!({
      data: { type: 'surdet-preview-trace-start', traceId, generation: 7, sceneId: 'intro' },
      source: frame!.contentWindow,
    } as unknown as MessageEvent);
    const event = {
      type: 'surdet-preview-trace-event',
      traceId,
      generation: 7,
      sequence: 1,
      coreEmitted: true,
      presentationApplied: true,
      presentationBefore: {},
      presentationAfter: {},
      event: {
        kind: 'instruction',
        source: { sceneId: 'intro', index: 1, op: 'text', file: 'intro.gal', line: 3, col: 1 },
      },
    };
    previewMessageListener!({ data: event, source: frame!.contentWindow } as unknown as MessageEvent);
    previewMessageListener!({ data: event, source: frame!.contentWindow } as unknown as MessageEvent);
    previewMessageListener!({ data: { ...event, sequence: 0 }, source: frame!.contentWindow } as unknown as MessageEvent);
    previewMessageListener!({
      data: { type: 'surdet-preview-trace-complete', traceId, generation: 7, status: 'passed', eventCount: 1 },
      source: frame!.contentWindow,
    } as unknown as MessageEvent);
    previewMessageListener!({ data: { ...event, sequence: 2 }, source: frame!.contentWindow } as unknown as MessageEvent);

    expect(getCurrentPreviewTrace().map((message) => message.type)).toEqual([
      'surdet-preview-trace-start',
      'surdet-preview-trace-event',
      'surdet-preview-trace-complete',
    ]);

    const baseline = { projectRevision: '1'.repeat(64), coordinationRevision: '2'.repeat(64), files: [] };
    let rejectInvalidation = true;
    const publish = vi.fn(async (preview: import('@surdet/authoring').PreviewPublishInput) => {
      if (preview.action === 'invalidate' && rejectInvalidation) throw new Error('连接暂时中断');
      return { previewId: preview.action === 'invalidate' ? null : preview.previewId, previewGeneration: preview.previewGeneration };
    });
    vi.spyOn(workspace, 'editorPreviewPublisher').mockReturnValue({ baseline, publish,
      sources: vi.fn(async () => []), content: vi.fn(async () => { throw new Error('没有请求试玩内容'); }) });
    vi.spyOn(workspace, 'editorWorkspaceStatus').mockReturnValue({ protection: 'connected', update: 'none', dirty: false, saving: false, baseline, latest: null });
    state.gameConfigText = '{"entryScene":"intro","variables":{}}';
    reload!.onclick?.();
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(4));
    const savedTraceId = (postedPreviewMessages[3] as { payload: { traceId: string } }).payload.traceId;
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ action: 'begin', previewId: savedTraceId }));
    reload!.onclick?.();
    await vi.waitFor(() => expect(container.textContent).toContain('重新播放尚未开始'));
    expect(postedPreviewMessages).toHaveLength(4);
    rejectInvalidation = false;
    reload!.onclick?.();
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(5));
    expect((postedPreviewMessages[4] as { payload: { traceId: string } }).payload.traceId).not.toBe(savedTraceId);
    state.configReadErrors = { events: 'content/config/events.json 解析失败' };
    try {
      reload!.onclick?.();
      await vi.waitFor(() => expect(container.textContent).toContain('events.json'));
      expect(postedPreviewMessages).toHaveLength(5);
      expect(container.textContent).toContain('保留的旧画面不代表新版本');
    } finally { state.configReadErrors = {}; }
  });

  it('restores memory labels after switching back from a saved preview source', async () => {
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') previewMessageListener = listener;
      }),
    });
    const target = { kind: 'saved-project' as const };
    const files = {
      'game.config.json': '{"entryScene":"intro","variables":{}}',
      'content/scenario/intro.gal': '@scene intro\n@label saved_label\n凛：Saved\n@end\n',
    };
    const savedSnapshot = await loadProjectSnapshot({
      rootIdentity: 'saved-project',
      listFiles: async () => Object.keys(files),
      exists: async (path) => Object.hasOwn(files, path),
      readText: async (path) => {
        const text = files[path as keyof typeof files];
        if (text === undefined) throw new Error(`missing ${path}`);
        return { path, text, sha256: await previewTextHash(text), bytes: new TextEncoder().encode(text).byteLength };
      },
    }, { sha256: previewTextHash });
    const savedContent = {
      target,
      projectIdentity: 'saved-project',
      contentRevision: savedSnapshot.revision,
      projectRevision: 'project-revision',
      coordinationRevision: 'coordination-revision',
      title: 'Saved project',
      files,
    };
    const publisher = {
      baseline: { projectRevision: 'project-revision', coordinationRevision: 'coordination-revision', files: [] },
      publish: vi.fn(async () => ({ previewId: null, previewGeneration: 0 })),
      sources: vi.fn(async () => [{ target, title: 'Saved project' }]),
      content: vi.fn(async () => savedContent),
    };
    vi.spyOn(workspace, 'editorPreviewPublisher').mockReturnValue(publisher);
    vi.spyOn(workspace, 'editorWorkspaceStatus').mockReturnValue({
      protection: 'unavailable', update: 'none', dirty: false, saving: false, baseline: null, latest: null,
    });
    state.current = 'intro.gal';
    state.dirName = 'same-project-name';
    state.dirHandle = null;
    state.autosaveProjectId = null;
    state.dirAssets = [];
    state.previewTimelineId = null;
    state.reviewWorkspace = null;
    state.gameConfigText = '{"entryScene":"intro","variables":{}}';
    state.scenes = new Map([
      ['intro.gal', {
        id: 'intro',
        file: 'intro.gal',
        text: '@scene intro\n@label memory_label\n凛：Draft\n@end\n',
        eol: '\n',
        dirty: false,
        handle: null,
      }],
    ]);
    const container = new FakeElement('div');
    renderPreviewPanel(container as unknown as HTMLElement);
    const labels = container.querySelector('select[aria-label="播放入口"]')!;
    const source = container.querySelector('select[aria-label="试玩内容"]')!;
    const labelValues = () => labels.children.map((child) => child.value);
    await vi.waitFor(() => expect(source.children).toHaveLength(2));
    previewMessageListener!({ data: { type: 'surdet-preview-ready' }, source: container.querySelector('iframe')!.contentWindow } as unknown as MessageEvent);
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(1));
    const memoryProjectKey = (postedPreviewMessages[0] as { payload: { projectKey: string } }).payload.projectKey;
    expect(memoryProjectKey).not.toBe('same-project-name');

    source.value = '0';
    source.onchange?.();
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(2));
    expect((postedPreviewMessages[1] as { payload: { projectKey: string } }).payload.projectKey)
      .toBe('saved-project:{"kind":"saved-project"}');
    expect(labelValues()).toContain('saved_label');

    source.value = '';
    source.onchange?.();
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(3));
    expect((postedPreviewMessages[2] as { payload: { projectKey: string } }).payload.projectKey).toBe(memoryProjectKey);
    await vi.waitFor(() => expect(labelValues()).toContain('memory_label'));
    container.findButton('重新播放')?.onclick?.();
    await vi.waitFor(() => expect(postedPreviewMessages).toHaveLength(4));
    expect(labelValues()).toContain('memory_label');
  });
});
