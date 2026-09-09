import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/panels/calendar-map.js', () => ({ renderCalendarMap: vi.fn() }));
vi.mock('../src/v4/surfaces.js', () => ({ enhanceConfigTables: vi.fn() }));
vi.mock('../src/project-io.js', () => ({
  assertProjectWriteUnlocked: vi.fn(),
  runProjectWriteOperation: (operation: () => Promise<unknown>) => operation(),
  writeProjectText: async (_path: string, value: unknown, handle: { createWritable: () => Promise<{ write: (value: unknown) => Promise<void>; close: () => Promise<void> }> }) => {
    const writable = await handle.createWritable();
    await writable.write(value);
    await writable.close();
    return handle;
  },
}));
vi.mock('../src/authoring-project-storage.js', () => ({ commitCharacterTable: vi.fn() }));

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  parentElement: FakeElement | null = null;
  className = '';
  id = '';
  type = '';
  value = '';
  checked = false;
  hidden = false;
  rows = 0;
  readonly style: Record<string, string> = {};
  onclick: (() => void) | null = null;
  oninput: (() => void) | null = null;
  onchange: (() => void) | null = null;
  private ownText = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  set textContent(value: string | null) {
    this.ownText = value ?? '';
    this.children.splice(0);
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  set innerHTML(value: string) {
    this.ownText = value;
    this.children.splice(0);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  click(): void {
    this.onclick?.();
  }

  querySelectorAll(): FakeElement[] {
    const found: FakeElement[] = [];
    const visit = (element: FakeElement): void => {
      found.push(...element.children);
      for (const child of element.children) visit(child);
    };
    visit(this);
    return found;
  }
}

let configRoot: FakeElement | null = null;
const documentStub = {
  createElement: (tag: string): FakeElement => new FakeElement(tag),
  getElementById: (id: string): FakeElement | null => {
    if (id === 'config-view') return configRoot;
    return null;
  },
};

const INITIAL_GAME_CONFIG = JSON.stringify({
  title: 'Draft fixture',
  entryScene: 'start',
  characters: { lynn: { name: '凛', avatar: 'lynn' } },
  variables: { trust: { type: 'number', initial: 0 } },
});

function configFiles(): Record<string, unknown> {
  return {
    achievements: [{ id: 'first', name: '初战' }],
    calendar: { maxAp: 3, nodes: [{ id: 'start', name: '开始', requires: [] }], baseCommands: [] },
    growth: { curve: { base: 1 }, profiles: [] },
    events: { profiles: [], events: [{ id: 'event-1', effects: {} }], scheduled: [] },
    gallery: { cgs: [], music: [], texts: [] },
    terminology: { terms: [{ canonical: '规范词', variants: ['变体'] }] },
  };
}

function descendants(root: FakeElement): FakeElement[] {
  return [root, ...root.querySelectorAll()];
}

function byText(root: FakeElement, text: string): FakeElement {
  const result = descendants(root).find((element) => element.textContent === text);
  if (!result) throw new Error(`missing element text: ${text}`);
  return result;
}

function byAttribute(root: FakeElement, name: string, value: string): FakeElement {
  const result = descendants(root).find((element) => element.getAttribute(name) === value);
  if (!result) throw new Error(`missing element ${name}=${value}`);
  return result;
}

const { state } = await import('../src/state.js');
const {
  configHistoryDepth,
  configUndo,
  inspectConfigDraftState,
  renderConfig,
  resetConfigSession,
} = await import('../src/panels/config.js');

async function renderFixture(): Promise<FakeElement> {
  state.gameConfigText = INITIAL_GAME_CONFIG;
  state.configFiles = configFiles() as typeof state.configFiles;
  state.handles = {
    gameConfig: null,
    achievements: null,
    calendar: null,
    events: null,
    growth: null,
    gallery: null,
    terminology: null,
  };
  configRoot = new FakeElement('section');
  configRoot.id = 'config-view';
  renderConfig(configRoot as unknown as HTMLElement);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return configRoot;
}

beforeEach(() => {
  vi.stubGlobal('document', documentStub);
  resetConfigSession();
});

afterEach(() => {
  configRoot = null;
  vi.unstubAllGlobals();
});

describe('configuration draft state', () => {
  it('tracks all eight loaded sections and starts clean', async () => {
    await renderFixture();
    expect(inspectConfigDraftState()).toEqual({ dirty: false, dirtySections: [] });
  });

  it('keeps invalid JSON dirty and returns clean after undoing to the baseline', async () => {
    const root = await renderFixture();
    const effects = byAttribute(root, 'aria-label', '执行效果，第 1 行');
    effects.value = '{';
    effects.oninput?.();
    expect(inspectConfigDraftState()).toEqual({ dirty: true, dirtySections: ['events'] });

    configUndo();
    expect(inspectConfigDraftState()).toEqual({ dirty: false, dirtySections: [] });
    expect(configHistoryDepth().future).toBe(1);
  });

  it('cleans only after a successful save and keeps failed saves dirty', async () => {
    const root = await renderFixture();
    const variable = byAttribute(root, 'aria-label', '变量名，第 1 行');
    variable.value = 'trust.changed';
    variable.oninput?.();
    expect(inspectConfigDraftState().dirtySections).toEqual(['variables']);

    let failWrite = false;
    const handle = {
      getFile: async () => ({ text: async () => state.gameConfigText }),
      createWritable: async () => ({
        write: async (value: unknown) => {
          if (failWrite) throw new Error('fixture write failure');
          state.gameConfigText = String(value).trimEnd();
        },
        close: async () => {},
      }),
    };
    state.handles.gameConfig = handle as unknown as FileSystemFileHandle;
    failWrite = true;
    byText(root, '保存变量表').click();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(inspectConfigDraftState().dirtySections).toEqual(['variables']);

    failWrite = false;
    byText(root, '保存变量表').click();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(inspectConfigDraftState()).toEqual({ dirty: false, dirtySections: [] });
    expect(configHistoryDepth().past).toBeGreaterThan(0);
  });

  it('keeps input made during a delayed save dirty while disk contains the submitted snapshot', async () => {
    const root = await renderFixture();
    const variable = byAttribute(root, 'aria-label', '变量名，第 1 行');
    variable.value = 'trust.submitted';
    variable.oninput?.();

    let releaseWrite!: () => void;
    let writeStarted!: () => void;
    const writeReady = new Promise<void>((resolve) => { writeStarted = resolve; });
    const writeReleased = new Promise<void>((resolve) => { releaseWrite = resolve; });
    let diskText = state.gameConfigText;
    const handle = {
      getFile: async () => ({ text: async () => diskText }),
      createWritable: async () => ({
        write: async (value: unknown) => {
          writeStarted();
          await writeReleased;
          diskText = String(value);
        },
        close: async () => {},
      }),
    };
    state.handles.gameConfig = handle as unknown as FileSystemFileHandle;

    byText(root, '保存变量表').click();
    await writeReady;
    variable.value = 'trust.during-save';
    variable.oninput?.();
    expect(inspectConfigDraftState().dirtySections).toEqual(['variables']);
    releaseWrite();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const diskVariables = (JSON.parse(diskText) as { variables: Record<string, unknown> }).variables;
    expect(diskVariables['trust.submitted']).toBeDefined();
    expect(diskVariables['trust.during-save']).toBeUndefined();
    expect(variable.value).toBe('trust.during-save');
    expect(inspectConfigDraftState()).toEqual({ dirty: true, dirtySections: ['variables'] });
  });

  it('reuses the same project draft and history when re-entering the config workbench', async () => {
    const root = await renderFixture();
    const variable = byAttribute(root, 'aria-label', '变量名，第 1 行');
    variable.value = 'trust.reentered';
    variable.oninput?.();
    const before = configHistoryDepth();

    const reentered = new FakeElement('section');
    reentered.id = 'config-view';
    configRoot = reentered;
    renderConfig(reentered as unknown as HTMLElement);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(byAttribute(reentered, 'aria-label', '变量名，第 1 行').value).toBe('trust.reentered');
    expect(inspectConfigDraftState()).toEqual({ dirty: true, dirtySections: ['variables'] });
    expect(configHistoryDepth()).toEqual(before);
  });

  it('clears loaded baselines at the project session boundary', async () => {
    const root = await renderFixture();
    const variable = byAttribute(root, 'aria-label', '变量名，第 1 行');
    variable.value = 'trust.changed';
    variable.oninput?.();
    expect(inspectConfigDraftState().dirty).toBe(true);

    resetConfigSession();
    expect(inspectConfigDraftState()).toEqual({ dirty: false, dirtySections: [] });
  });
});
