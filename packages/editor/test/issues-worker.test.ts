import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/panels/sidebar.js', () => ({ renderSidebar: vi.fn() }));
vi.mock('../src/panels/right.js', () => ({ updateEdges: vi.fn(), updateGraph: vi.fn() }));
vi.mock('../src/panels/flow.js', () => ({ refreshFlowIfVisible: vi.fn() }));

class ValidationWorker {
  static instances: ValidationWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: Array<{ seq: number }> = [];
  terminate = vi.fn();
  constructor() { ValidationWorker.instances.push(this); }
  postMessage(message: { seq: number }): void { this.messages.push(message); }
}

beforeEach(() => {
  vi.resetModules();
  ValidationWorker.instances = [];
  vi.stubGlobal('Worker', ValidationWorker);
  vi.stubGlobal('document', { getElementById: () => null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openValidation() {
  const issues = await import('../src/panels/issues.js');
  const { state } = await import('../src/state.js');
  state.entryScene = 'start';
  state.gameConfigText = '{"entryScene":"start","variables":{}}';
  state.scenes.set('start', { id: 'start', file: 'start.gal', text: '@scene start\n@set ghost = 1\n@end', eol: '\n', dirty: false, handle: null });
  issues.runValidate();
  return { issues, state, worker: ValidationWorker.instances[0]! };
}

describe('validation Worker failure fallback', () => {
  it('validates the current pending input on the main thread after a Worker error, without another edit', async () => {
    const { state, worker } = await openValidation();
    expect(worker.messages).toHaveLength(1);
    worker.onerror?.();
    await vi.waitFor(() => expect(state.lastValidation?.issues.some(issue => issue.code === 'V001')).toBe(true));
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.messages).toHaveLength(1);
  });

  it('uses the same fallback when the Worker reports a failed validation', async () => {
    const { state, worker } = await openValidation();
    worker.onmessage?.({ data: { seq: worker.messages[0]!.seq, ok: false, error: 'worker validation failed' } });
    await vi.waitFor(() => expect(state.lastValidation?.issues.some(issue => issue.code === 'V001')).toBe(true));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('does not publish the fallback result or an old Worker reply after project invalidation', async () => {
    const validation = await import('../src/validate.js');
    const mainThreadValidation = vi.spyOn(validation, 'validateProject');
    const { issues, state, worker } = await openValidation();
    const oldSeq = worker.messages[0]!.seq;
    worker.onerror?.();
    issues.invalidatePendingValidation();
    state.scenes.clear();
    state.gameConfigText = '';
    worker.onmessage?.({ data: { seq: oldSeq, ok: true, issues: [], edges: [], scenes: new Map() } });
    expect(mainThreadValidation).toHaveBeenCalledOnce();
    await mainThreadValidation.mock.results[0]!.value;
    expect(state.lastValidation).toBeNull();
  });
});
