import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileScene } from '@surdet/core';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { ValidateResult } from '../src/validate.js';

class Element {
  children: Element[] = [];
  attributes = new Map<string, string>();
  textContent = '';
  onclick?: () => void;
  constructor(readonly tag: string, readonly className?: string, text?: string) { this.textContent = text ?? ''; }
  set innerHTML(_value: string) { this.children = []; this.textContent = ''; }
  append(...nodes: Element[]): void { this.children.push(...nodes); }
  appendChild(node: Element): Element { this.children.push(node); return node; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  find(attribute: string): Element | undefined { return this.attributes.has(attribute) ? this : this.children.map(child => child.find(attribute)).find(Boolean); }
  text(): string { return this.textContent + this.children.map(child => child.text()).join(''); }
}

const fixture = vi.hoisted(() => ({
  state: { scenes: new Map<string, { id: string; file: string; text: string }>(), timelines: [], gameConfigText: '', entryScene: 'ch01',
    configFiles: { terminology: null, gallery: null }, handles: {}, lastValidation: null as ValidateResult | null, mainTab: 'audit' },
  status: vi.fn(),
}));
vi.mock('../src/state.js', () => ({ state: fixture.state, setStatus: fixture.status,
  h: (tag: string, className?: string, text?: string) => new Element(tag, className, text) }));
vi.mock('../src/panels/sidebar.js', () => ({ renderSidebar: vi.fn() }));
vi.mock('../src/panels/right.js', () => ({ updateEdges: vi.fn(), updateGraph: vi.fn() }));
vi.mock('../src/panels/flow.js', () => ({ refreshFlowIfVisible: vi.fn() }));

describe('audit report freshness through the validation scheduler', () => {
  const text = '凛：第一句\n凛：第二句\n冷：第三句\n@end';
  let worker: { onmessage?: (event: { data: unknown }) => void; requests: Array<{ seq: number }> };
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); fixture.status.mockClear();
    fixture.state.lastValidation = null;
    fixture.state.scenes = new Map([['ch01', { id: 'ch01', file: 'ch01.gal', text }]]);
    vi.stubGlobal('document', { getElementById: () => null, querySelector: () => null });
    vi.stubGlobal('Worker', class {
      onmessage?: (event: { data: unknown }) => void;
      requests: Array<{ seq: number }> = [];
      constructor() { worker = this; }
      postMessage(request: { seq: number }): void { this.requests.push(request); }
    });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  const compiled = (source: string) => new Map([['ch01', compileScene(source, 'content/scenario/ch01.gal', 'ch01')]]);
  function reply(seq: number, source: string): void {
    worker.onmessage!({ data: { seq, ok: true, issues: [], edges: [], scenes: compiled(source) } });
  }

  it.each(['scheduleValidate', 'runValidate', 'invalidatePendingValidation'] as const)('refreshes the already visible report immediately on %s through the real main hook', async invalidate => {
    const issues = await import('../src/panels/issues.js');
    const audit = await import('../src/panels/audit-panel.js');
    const visible = new Element('section');
    vi.stubGlobal('document', { getElementById: (id: string) => id === 'audit-view' ? visible : null, querySelector: () => null });
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const parsed = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
    const binding = parsed.statements.find(statement => ts.isExpressionStatement(statement)
      && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(parsed) === 'bindIssueNavigation')!;
    const javascript = ts.transpileModule(binding.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('bindIssueNavigation', 'state', 'renderAuditPanel', 'document', 'jumpToScene', 'navigateTimeline', 'navigateMode', javascript)(
      issues.bindIssueNavigation, fixture.state, audit.renderAuditPanel, document, vi.fn(), vi.fn(), vi.fn());
    issues.runValidate(); reply(worker.requests[0]!.seq, text);
    expect(visible.find('data-audit-jump')).toBeDefined();
    fixture.state.scenes.get('ch01')!.text = '\n' + text;
    issues[invalidate]();
    expect(visible.find('data-audit-state')?.attributes.get('data-audit-state')).toBe('stale');
    expect(visible.find('data-audit-jump')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(visible.text()).toContain('重新校验');
    expect(visible.find('data-audit-jump')).toBeUndefined();
  });

  it('rejects old buttons during debounce and after a new report, and navigates the new report line', async () => {
    const issues = await import('../src/panels/issues.js');
    const audit = await import('../src/panels/audit-panel.js');
    const jump = vi.fn(); audit.bindAuditHooks({ onJump: jump });
    issues.runValidate(); reply(worker.requests[0]!.seq, text);
    const original = new Element('section'); audit.renderAuditPanel(original as unknown as HTMLElement);
    const oldButton = original.find('data-audit-jump')!;
    expect(oldButton).toBeDefined(); oldButton.onclick!(); expect(jump).toHaveBeenLastCalledWith('ch01', 2); jump.mockClear();
    const changed = '\n' + text;
    fixture.state.scenes.get('ch01')!.text = changed;
    issues.scheduleValidate();
    oldButton.onclick!();
    expect(jump).not.toHaveBeenCalled();
    expect(fixture.status).toHaveBeenLastCalledWith('内容已修改，请等待重新校验后再定位', false, 4000);
    const pending = new Element('section'); audit.renderAuditPanel(pending as unknown as HTMLElement);
    expect(pending.find('data-audit-state')?.attributes.get('data-audit-state')).toBe('stale');
    expect(pending.text()).toContain('重新校验'); expect(pending.find('data-audit-jump')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    reply(worker.requests[0]!.seq, text);
    expect(issues.isValidationCurrent()).toBe(false);
    reply(worker.requests[1]!.seq, changed);
    expect(issues.isValidationCurrent()).toBe(true);
    oldButton.onclick!(); expect(jump).not.toHaveBeenCalled();
    const current = new Element('section'); audit.renderAuditPanel(current as unknown as HTMLElement);
    current.find('data-audit-jump')!.onclick!(); expect(jump).toHaveBeenLastCalledWith('ch01', 3);
  });

  it('does not call an old clear report current after an edit', async () => {
    const issues = await import('../src/panels/issues.js');
    const audit = await import('../src/panels/audit-panel.js');
    issues.runValidate(); reply(worker.requests[0]!.seq, '凛：你好。\n@end');
    const current = new Element('section'); audit.renderAuditPanel(current as unknown as HTMLElement);
    expect(current.text()).toContain('当前未发现一致性问题');
    issues.scheduleValidate();
    const pending = new Element('section'); audit.renderAuditPanel(pending as unknown as HTMLElement);
    expect(pending.text()).not.toContain('当前未发现一致性问题');
    expect(pending.find('data-audit-state')?.attributes.get('data-audit-state')).toBe('stale');
  });

  it('rejects a button whose report was replaced without another scheduler sequence', async () => {
    const issues = await import('../src/panels/issues.js');
    const audit = await import('../src/panels/audit-panel.js');
    const jump = vi.fn(); audit.bindAuditHooks({ onJump: jump });
    issues.applyValidation([], [], compiled(text));
    const original = new Element('section'); audit.renderAuditPanel(original as unknown as HTMLElement);
    const oldButton = original.find('data-audit-jump')!;
    issues.applyValidation([], [], compiled('\n' + text));
    expect(issues.isValidationCurrent()).toBe(true);
    oldButton.onclick!(); expect(jump).not.toHaveBeenCalled();
  });
});
