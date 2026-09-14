import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentPreviewTrace, renderPreviewPanel } from '../src/panels/preview-panel.js';
import { state } from '../src/state.js';
import * as workspace from '../src/editor-workspace.js';

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

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  replaceChildren(...children: FakeElement[]): void { this.children.splice(0); this.append(...children); }

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
  previewTimelineId: state.previewTimelineId,
  reviewWorkspace: state.reviewWorkspace,
  scenes: state.scenes,
  gameConfigText: state.gameConfigText,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  postedPreviewMessages.splice(0);
  previewMessageListener = null;
  state.current = originalState.current;
  state.previewTimelineId = originalState.previewTimelineId;
  state.reviewWorkspace = originalState.reviewWorkspace;
  state.scenes = originalState.scenes;
  state.gameConfigText = originalState.gameConfigText;
});

describe('timeline preview replay', () => {
  it('keeps replay identity, excludes late events and waits for saved-observation invalidation', async () => {
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => {
        if (type === 'message') previewMessageListener = listener;
      }),
    });
    state.current = 'intro.gal';
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
  });
});
