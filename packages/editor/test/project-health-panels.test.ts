import { afterEach, describe, expect, it, vi } from 'vitest';
import { state } from '../src/state.js';
import { bindStatsHooks, renderStatsPanel } from '../src/panels/stats-panel.js';
import { bindAuditHooks, renderAuditPanel } from '../src/panels/audit-panel.js';
import { addTerminologyVariant, resetConfigSession } from '../src/panels/config.js';

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  className = '';
  disabled = false;
  open = false;
  title = '';
  onclick: ((event: { stopPropagation(): void }) => void) | null = null;
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

  get directTextContent(): string {
    return this.ownText;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  click(): void {
    if (!this.disabled) this.onclick?.({ stopPropagation: () => {} });
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const match = (element: FakeElement): boolean => {
      if (selector === 'button') return element.tagName === 'BUTTON';
      if (selector === 'details') return element.tagName === 'DETAILS';
      const data = /^\[data-([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
      if (!data) return false;
      const value = element.getAttribute(`data-${data[1]}`);
      return value !== null && (data[2] === undefined || value === data[2]);
    };
    const visit = (element: FakeElement): void => {
      if (match(element)) found.push(element);
      for (const child of element.children) visit(child);
    };
    visit(this);
    return found;
  }
}

const documentStub = {
  createElement: (tag: string) => new FakeElement(tag),
  getElementById: () => null,
};

function visibleText(element: FakeElement): string {
  if (element.tagName === 'DETAILS' && !element.open) {
    return element.children.slice(0, 1).map(visibleText).join('');
  }
  return element.directTextContent + element.children.map(visibleText).join('');
}

const originalScenes = new Map(state.scenes);
const originalValidation = state.lastValidation;
const originalTerminology = state.configFiles.terminology;
const originalTerminologyHandle = state.handles.terminology;
const originalProjectLoading = state.projectLoading;

afterEach(() => {
  vi.unstubAllGlobals();
  state.scenes.clear();
  for (const [key, scene] of originalScenes) state.scenes.set(key, scene);
  state.lastValidation = originalValidation;
  state.configFiles.terminology = originalTerminology;
  state.handles.terminology = originalTerminologyHandle;
  state.projectLoading = originalProjectLoading;
  resetConfigSession();
  bindStatsHooks({ onJump: () => {} });
  bindAuditHooks({ onJump: () => {}, onAddVariant: () => {} });
});

function scene(id: string, text: string) {
  return { id, file: `content/scenario/${id}.gal`, text, eol: '\n', dirty: false, handle: null };
}

function compiledTextScene(id: string, speakers: readonly string[], file = `${id}.gal`) {
  return {
    id,
    instructions: speakers.map((speaker, index) => ({
      op: 'text' as const,
      speaker,
      value: `第 ${index + 1} 句`,
      file,
      line: index + 1,
      col: 1,
    })),
  };
}

describe('project overview panel', () => {
  it('shows a directional empty state instead of zero-value KPI cards', () => {
    vi.stubGlobal('document', documentStub);
    state.scenes.clear();
    const container = new FakeElement('section');
    renderStatsPanel(container as unknown as HTMLElement);
    expect(visibleText(container)).toContain('项目概览');
    expect(visibleText(container)).toContain('还没有可统计的场景');
    expect(container.querySelectorAll('[data-stat-key]')).toHaveLength(0);
  });

  it('renders a human summary and uses the existing scene navigation hook', () => {
    vi.stubGlobal('document', documentStub);
    state.scenes.clear();
    state.scenes.set('chapter/scene_with_a_very_long_identifier', scene('scene_with_a_very_long_identifier', '凛：你好。\n旁白。'));
    const jumps: string[] = [];
    bindStatsHooks({ onJump: (sceneKey) => jumps.push(sceneKey) });
    const container = new FakeElement('section');
    renderStatsPanel(container as unknown as HTMLElement);
    expect(visibleText(container)).toContain('预估通关时长');
    expect(visibleText(container)).toContain('内容规模');
    const jump = container.querySelector('[data-scene-jump="chapter/scene_with_a_very_long_identifier"]');
    expect(jump?.tagName).toBe('BUTTON');
    jump?.click();
    expect(jumps).toEqual(['chapter/scene_with_a_very_long_identifier']);
  });

  it('keeps the page readable when a scene cannot be compiled for statistics', () => {
    vi.stubGlobal('document', documentStub);
    state.scenes.clear();
    state.scenes.set('broken', scene('broken', '@label start\n@label start'));
    const container = new FakeElement('section');
    expect(() => renderStatsPanel(container as unknown as HTMLElement)).not.toThrow();
    expect(visibleText(container)).toContain('暂时无法生成项目概览');
    expect(visibleText(container)).not.toContain('Duplicate label');
    expect(container.querySelector('[data-stats-technical]')).not.toBeNull();
  });
});

describe('text audit panel', () => {
  it('uses Chinese issue types and separate keyboard-reachable actions', () => {
    vi.stubGlobal('document', documentStub);
    state.scenes.clear();
    state.scenes.set('ch01', scene('ch01', '凛：第一句\n凛：第二句\n冷：第三句'));
    state.lastValidation = {
      issues: [],
      scenes: new Map([['ch01', compiledTextScene('ch01', ['凛', '凛', '冷'], 'content/scenario/ch01.gal') as never]]),
    };
    state.configFiles.terminology = { terms: [] };
    const jumps: Array<[string, number]> = [];
    const variants: Array<[string, string]> = [];
    bindAuditHooks({
      onJump: (sceneKey, line) => jumps.push([sceneKey, line]),
      onAddVariant: (canonical, variant) => variants.push([canonical, variant]),
    });
    const container = new FakeElement('section');
    renderAuditPanel(container as unknown as HTMLElement);
    expect(visibleText(container)).toContain('文字一致性检查');
    expect(visibleText(container)).toContain('疑似角色名笔误');
    expect(visibleText(container)).not.toContain('CONSIST_TYPO');
    const jump = container.querySelector('[data-audit-jump]');
    const add = container.querySelector('[data-audit-add-variant]');
    expect(jump?.tagName).toBe('BUTTON');
    expect(add?.tagName).toBe('BUTTON');
    jump?.click();
    add?.click();
    expect(jumps).toEqual([['ch01', 2]]);
    expect(variants).toEqual([['凛', '冷']]);
    expect(container.querySelector('[data-audit-technical]')?.tagName).toBe('DETAILS');
  });

  it('never presents partial compilation coverage as a clean whole-project result', () => {
    vi.stubGlobal('document', documentStub);
    state.lastValidation = {
      issues: [{ severity: 'error', code: 'E_TEST', text: '坏场景未通过', file: 'broken.gal', line: 1, col: 1 }],
      scenes: new Map([['good', compiledTextScene('good', ['凛']) as never]]),
    };
    state.configFiles.terminology = { terms: [] };
    const container = new FakeElement('section');
    renderAuditPanel(container as unknown as HTMLElement);
    expect(visibleText(container)).toContain('检查不完整');
    expect(visibleText(container)).toContain('不能代表整个项目');
    expect(visibleText(container)).not.toContain('未发现称谓和设定用词问题');
  });

  it('reports incomplete coverage when every scene fails compilation', () => {
    vi.stubGlobal('document', documentStub);
    state.lastValidation = {
      issues: [{ severity: 'error', code: 'E_TEST', text: '坏场景未通过', file: 'broken.gal', line: 1, col: 1 }],
      scenes: new Map(),
    };
    const container = new FakeElement('section');
    renderAuditPanel(container as unknown as HTMLElement);
    expect(visibleText(container)).toContain('检查不完整');
    expect(visibleText(container)).toContain('1 个剧本错误');
    expect(visibleText(container)).not.toContain('正在等待项目校验');
  });

  it('does not retain an old audit action that is clicked during a project switch', async () => {
    vi.stubGlobal('document', documentStub);
    const writes: string[] = [];
    state.handles.terminology = {
      createWritable: async () => ({
        write: async (value: FileSystemWriteChunkType) => { writes.push(String(value)); },
        close: async () => {},
      }),
    } as unknown as FileSystemFileHandle;
    state.configFiles.terminology = { terms: [{ canonical: '新项目', variants: [] }] };
    resetConfigSession();

    state.projectLoading = true;
    await addTerminologyVariant('旧项目', '旧称谓');
    state.projectLoading = false;
    await addTerminologyVariant('新项目', '新称谓');

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('新项目');
    expect(writes[0]).toContain('新称谓');
    expect(writes[0]).not.toContain('旧项目');
    expect(writes[0]).not.toContain('旧称谓');
  });
});
