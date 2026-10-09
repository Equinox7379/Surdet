import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue, ValidateResult } from '../src/validate.js';

const fixture = vi.hoisted(() => ({
  state: {
    scenes: new Map<string, { id: string; file: string; text: string }>(),
    timelines: [], gameConfigText: '', entryScene: 'start', configFiles: { terminology: null, gallery: null }, handles: {},
    lastValidation: null as ValidateResult | null,
  },
  nodes: [] as Array<{ className?: string; onclick?: () => void }>,
  status: vi.fn(), validate: vi.fn(),
}));
vi.mock('../src/state.js', () => ({
  state: fixture.state, setStatus: fixture.status,
  h: (_tag: string, className?: string) => {
    const node = { className, append: vi.fn(), appendChild: vi.fn(), setAttribute: vi.fn() };
    fixture.nodes.push(node);
    return node;
  },
}));
vi.mock('../src/validate.js', () => ({ validateProject: fixture.validate }));
vi.mock('../src/panels/sidebar.js', () => ({ renderSidebar: vi.fn() }));
vi.mock('../src/panels/right.js', () => ({ updateEdges: vi.fn(), updateGraph: vi.fn() }));
vi.mock('../src/panels/flow.js', () => ({ refreshFlowIfVisible: vi.fn() }));

const issue: Issue = { severity: 'error', code: 'J002', text: '标签不存在', file: 'start.gal', line: 2, col: 1,
  range: { start: { line: 2, col: 7 }, end: { line: 2, col: 20 } } };

describe('diagnostic freshness', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    fixture.nodes.length = 0;
    fixture.status.mockClear();
    fixture.validate.mockReset();
    fixture.state.lastValidation = null;
    fixture.state.scenes = new Map([['start', { id: 'start', file: 'start.gal', text: '@scene start\n@call start.missing' }]]);
    const right = { querySelector: () => null, prepend: vi.fn() };
    // querySelector serves the status bar problem count, which finds nothing here.
    vi.stubGlobal('document', { getElementById: (id: string) => id === 'right' ? right : null, querySelector: () => null });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('rejects worker replies and clicks from old text immediately, including during debounce', async () => {
    let worker!: { onmessage?: (event: { data: unknown }) => void; requests: Array<{ seq: number }> };
    vi.stubGlobal('Worker', class {
      onmessage?: (event: { data: unknown }) => void;
      requests: Array<{ seq: number }> = [];
      constructor() { worker = this; }
      postMessage(request: { seq: number }) { this.requests.push(request); }
    });
    const panel = await import('../src/panels/issues.js');
    const jump = vi.fn(), applied = vi.fn();
    panel.bindIssueNavigation({ onJump: jump, onValidationApplied: applied });
    panel.runValidate();
    const first = worker.requests[0]!.seq;
    const reply = (seq: number, currentIssue: Issue) => worker.onmessage!({ data: { seq, ok: true, issues: [currentIssue], edges: [], scenes: new Map() } });
    reply(first, issue);
    expect(panel.isValidationCurrent()).toBe(true);
    const oldRow = fixture.nodes.find(node => node.className === 'issue error')!;
    fixture.state.scenes.get('start')!.text = '\n' + fixture.state.scenes.get('start')!.text;
    panel.scheduleValidate();
    expect(panel.isValidationCurrent()).toBe(false);
    oldRow.onclick!();
    expect(jump).not.toHaveBeenCalled();
    expect(fixture.status).toHaveBeenLastCalledWith('内容已修改，请等待重新校验后再定位', false, 4000);
    reply(first, issue);
    expect(applied).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    reply(worker.requests[1]!.seq, { ...issue, line: 3, range: { start: { line: 3, col: 7 }, end: { line: 3, col: 20 } } });
    expect(panel.isValidationCurrent()).toBe(true);
    oldRow.onclick!();
    expect(jump).not.toHaveBeenCalled();
    fixture.nodes.filter(node => node.className === 'issue error').at(-1)!.onclick!();
    expect(jump).toHaveBeenLastCalledWith('start', 2, { start: { line: 3, col: 7 }, end: { line: 3, col: 20 } });
    panel.invalidatePendingValidation();
    expect(panel.isValidationCurrent()).toBe(false);
  });

  it('keeps F8 from walking to a location in text that changed after validation', async () => {
    let worker!: { onmessage?: (event: { data: unknown }) => void; requests: Array<{ seq: number }> };
    vi.stubGlobal('Worker', class {
      onmessage?: (event: { data: unknown }) => void;
      requests: Array<{ seq: number }> = [];
      constructor() { worker = this; }
      postMessage(request: { seq: number }) { this.requests.push(request); }
    });
    const panel = await import('../src/panels/issues.js');
    const jump = vi.fn();
    panel.bindIssueNavigation({ onJump: jump });
    panel.runValidate();
    worker.onmessage!({ data: { seq: worker.requests[0]!.seq, ok: true, issues: [issue], edges: [], scenes: new Map() } });
    panel.stepProblem(1);
    expect(jump).toHaveBeenLastCalledWith('start', 1, issue.range);
    jump.mockClear();
    panel.scheduleValidate(); // An edit: the shown range no longer describes the text.
    panel.stepProblem(1);
    panel.stepProblem(-1);
    expect(jump).not.toHaveBeenCalled();
    expect(fixture.status).toHaveBeenLastCalledWith('内容已修改，请等待重新校验后再定位', false, 4000);
  });

  it('also rejects a delayed main-thread result after a new edit', async () => {
    vi.stubGlobal('Worker', undefined);
    let finish!: (result: ValidateResult) => void;
    fixture.validate.mockReturnValue(new Promise<ValidateResult>(resolve => { finish = resolve; }));
    const panel = await import('../src/panels/issues.js');
    const applied = vi.fn();
    panel.bindIssueNavigation({ onJump: vi.fn(), onValidationApplied: applied });
    panel.runValidate();
    panel.scheduleValidate();
    finish({ issues: [issue], scenes: new Map() });
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).not.toHaveBeenCalled();
    expect(fixture.state.lastValidation).toBeNull();
    expect(panel.isValidationCurrent()).toBe(false);
  });
});
