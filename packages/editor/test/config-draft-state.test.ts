import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/panels/calendar-map.js', () => ({ renderCalendarMap: vi.fn() }));
vi.mock('../src/v4/surfaces.js', () => ({ enhanceConfigTables: vi.fn() }));
vi.mock('../src/project-io.js', () => ({
  assertProjectWriteUnlocked: vi.fn(),
  runProjectWriteOperation: (operation: () => Promise<unknown>) => operation(),
  readProjectSourceText: async (handle: FileSystemFileHandle) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await (await handle.getFile()).arrayBuffer()),
  writeProjectText: async (_path: string, value: unknown, handle: { createWritable: () => Promise<{ write: (value: unknown) => Promise<void>; close: () => Promise<void> }> }) => {
    const writable = await handle.createWritable();
    await writable.write(value);
    await writable.close();
    return handle;
  },
}));
vi.mock('../src/authoring-project-storage.js', () => ({
  commitCharacterTable: vi.fn(),
  commitStageConfiguration: vi.fn(),
  parseCharacterVisualsDraft: (_id: string, text: string) => JSON.parse(text),
}));

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
  disabled = false;
  isConnected = true;
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

  closest(): FakeElement | null {
    return null;
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
  prepareConfigSceneRename,
  prepareConfigLabelRename,
  configRedo,
  renderConfig,
  resetConfigSession,
  saveDirtyConfigSections,
  readStageConfigDraft, editStageConfigDraft, saveStageConfigDraftUnlocked, previewStageConfigText,
} = await import('../src/panels/config.js');
const { commitStageConfiguration } = await import('../src/authoring-project-storage.js');

async function renderFixture(gameConfigText = INITIAL_GAME_CONFIG): Promise<FakeElement> {
  state.configReadErrors = {};
  state.pendingSceneConfigWrites = [];
  state.pendingSceneConfigRenames = [];
  state.dirHandle = null;
  state.gameConfigText = gameConfigText;
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
  it('keeps malformed stored visual JSON visible so the author can repair it', async () => {
    const visuals = { uniform: { broken: { version: 1, kind: 'sequence', frames: [], loop: true } } };
    const root = await renderFixture(JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG), characters: { lynn: { name: '凛', visuals } } }));
    const field = byAttribute(root, 'aria-label', 'lynn 分层 / 帧动画 JSON');
    expect(JSON.parse(field.value)).toEqual(visuals);
    expect(byAttribute(root, 'aria-label', 'lynn 的显示名称').value).toBe('凛');
  });
  it('keeps visual definitions separate from static portrait bindings and in undo/redo drafts', async () => {
    const staticPath = 'content/assets/portrait/lynn_uniform_normal.png';
    const visualPath = 'content/assets/portrait/lynn_uniform_talk.png';
    const visuals = {
      uniform: {
        talk: {
          version: 1,
          kind: 'sequence',
          frames: [{ image: visualPath, durationMs: 100 }],
          loop: true,
        },
      },
    };
    const gameConfigText = JSON.stringify({
      ...JSON.parse(INITIAL_GAME_CONFIG),
      characters: {
        lynn: {
          name: '凛', avatar: 'lynn',
          portraits: { uniform: { normal: staticPath } },
          visuals,
        },
      },
    }, null, 2);
    state.dirAssets = [
      { key: 'portrait:normal', kind: 'portrait', isImage: true, handle: null, sourcePath: staticPath },
      { key: 'portrait:talk', kind: 'portrait', isImage: true, handle: null, sourcePath: visualPath },
    ];
    const root = await renderFixture(gameConfigText);
    const field = () => byAttribute(root, 'aria-label', 'lynn 分层 / 帧动画 JSON');

    expect(byText(root, '1 项显式绑定')).toBeDefined();
    expect(JSON.parse(field().value)).toEqual(visuals);
    expect(byText(root, '填入帧动画示例').disabled).toBe(true);

    field().value = '{';
    field().oninput?.();
    expect(inspectConfigDraftState().dirtySections).toEqual(['characters']);
    renderConfig(root as unknown as HTMLElement);
    expect(field().value).toBe('{');

    configUndo();
    expect(JSON.parse(field().value)).toEqual(visuals);
    expect(inspectConfigDraftState().dirty).toBe(false);
    configRedo();
    expect(field().value).toBe('{');
    expect(inspectConfigDraftState().dirtySections).toEqual(['characters']);
  });

  it('keeps stage edits across workbench remounts and shares dirty, undo and redo without writing source', async () => {
    await renderFixture();
    const original = readStageConfigDraft();
    const next = JSON.stringify({ version: 1, distances: { close: 1.4 } });
    editStageConfigDraft(next);
    expect(inspectConfigDraftState()).toEqual({ dirty: true, dirtySections: ['stage'] });
    expect(state.gameConfigText).toBe(INITIAL_GAME_CONFIG);
    expect(JSON.parse(previewStageConfigText(state.gameConfigText)).stage.distances.close).toBe(1.4);
    renderConfig(configRoot as unknown as HTMLElement);
    expect(readStageConfigDraft()).toBe(next);
    configUndo();
    expect(readStageConfigDraft()).toBe(original);
    expect(inspectConfigDraftState().dirty).toBe(false);
    configRedo();
    expect(readStageConfigDraft()).toBe(next);
    resetConfigSession();
    expect(readStageConfigDraft()).toBe(original);
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

  it('keeps invalid stage JSON and rejects a changed source without calling the writer', async () => {
    await renderFixture();
    vi.mocked(commitStageConfiguration).mockClear();
    editStageConfigDraft('{');
    expect(() => previewStageConfigText(state.gameConfigText)).toThrow();
    await expect(saveStageConfigDraftUnlocked()).rejects.toThrow();
    expect(readStageConfigDraft()).toBe('{');
    editStageConfigDraft('{"version":1}');
    state.gameConfigText = JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG), stage: { version: 1, distances: { changed: 2 } } });
    await expect(saveStageConfigDraftUnlocked()).rejects.toThrow('舞台来源配置已经变化');
    expect(commitStageConfiguration).not.toHaveBeenCalled();
    expect(inspectConfigDraftState().dirty).toBe(true);
  });

  it('save-all submits the stage snapshot and retains newer input made while saving', async () => {
    await renderFixture();
    const submitted = '{"version":1,"distances":{"near":1.4}}';
    editStageConfigDraft(submitted);
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(commitStageConfiguration).mockImplementationOnce(async (value, expected) => {
      expect(value).toEqual(JSON.parse(submitted));
      expect(expected).toBe(INITIAL_GAME_CONFIG);
      await waiting;
      state.gameConfigText = JSON.stringify({ ...JSON.parse(expected), stage: value });
      return { text: state.gameConfigText, before: null, after: value };
    });
    const saving = saveDirtyConfigSections();
    editStageConfigDraft('{"version":1,"distances":{"near":1.6}}');
    finish();
    await expect(saving).resolves.toEqual({ saved: 1, failures: 0, remainingDirty: true });
    expect(JSON.parse(state.gameConfigText).stage.distances.near).toBe(1.4);
    expect(JSON.parse(readStageConfigDraft()).distances.near).toBe(1.6);
    configUndo();
    expect(readStageConfigDraft()).toBe(submitted);
    expect(JSON.parse(state.gameConfigText).stage.distances.near).toBe(1.4);
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

  it('rebases gallery label rows/history without saving unrelated changes; dirty replay references prevent deletion', async () => {
    const root = await renderFixture();
    byText(root, '＋ 新增回想').click();
    const scene = byAttribute(root, 'aria-label', '回放场景，第 1 行'); scene.value = 'a'; scene.oninput?.();
    const label = byAttribute(root, 'aria-label', '回放标签，第 1 行'); label.value = 'entry'; label.oninput?.();
    expect(() => prepareConfigLabelRename('a', 'entry')).toThrow('仍有引用');
    prepareConfigLabelRename('a', 'entry', 'arrival')();
    configUndo(); configRedo();
    expect(byAttribute(root, 'aria-label', '回放标签，第 1 行').value).toBe('arrival');
    expect(inspectConfigDraftState().dirtySections).toEqual(['gallery']);
    expect(state.configFiles.gallery).toEqual({ cgs: [], music: [], texts: [] });
  });
  it('rebases live scene references and undo/redo without losing unrelated unfinished fields', async () => {
    const root = await renderFixture();
    const scene = byAttribute(root, 'aria-label', '场景，第 1 行');
    scene.value = 'old'; scene.oninput?.();
    const effects = byAttribute(root, 'aria-label', '执行效果，第 1 行');
    effects.value = '{'; effects.oninput?.();
    prepareConfigSceneRename('old', 'new', 'start')();
    configUndo();
    const refs = descendants(root).filter(element => element.getAttribute('aria-label') === '场景，第 1 行');
    expect(refs.every(element => element.value !== 'old')).toBe(true);
    configRedo();
    expect(byAttribute(root, 'aria-label', '场景，第 1 行').value).toBe('new');
    expect(byAttribute(root, 'aria-label', '执行效果，第 1 行').value).toBe('{');
    expect(inspectConfigDraftState().dirtySections).toEqual(['events']);
  });

  it('shows a read failure instead of silently editing the last successful event table', async () => {
    const root = await renderFixture();
    state.handles.events = { getFile: async () => { throw new Error('fixture read denied'); } } as unknown as FileSystemFileHandle;
    renderConfig(root as unknown as HTMLElement);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(root.textContent).toContain('fixture read denied');
    expect(descendants(root).some(element => element.textContent === '保存事件配置')).toBe(false);
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

  it.each(['{', 'null', '[]'])('shows malformed root config instead of an empty editable variable table: %s', async (source) => {
    const root = await renderFixture();
    state.handles.gameConfig = { getFile: async () => new File([source], 'game.config.json') } as unknown as FileSystemFileHandle;
    renderConfig(root as unknown as HTMLElement);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(root.textContent).toContain('game.config.json');
    expect(root.textContent).toMatch(/解析失败|必须是 JSON 对象/);
    expect(descendants(root).some(element => element.textContent === '保存变量表')).toBe(false);
  });

  it('retains malformed content config as an error and resumes after a successful fresh read', async () => {
    const root = await renderFixture();
    let source = '{';
    const createWritable = vi.fn();
    state.handles.events = { getFile: async () => new File([source], 'events.json'), createWritable } as unknown as FileSystemFileHandle;
    const previousSave = byText(root, '保存事件配置');
    renderConfig(root as unknown as HTMLElement);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(root.textContent).toContain('events.json 解析失败');
    previousSave.click();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(createWritable).not.toHaveBeenCalled();
    source = '\uFEFF' + JSON.stringify(configFiles().events);
    renderConfig(root as unknown as HTMLElement);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(root.textContent).not.toContain('events.json 解析失败');
    expect(byText(root, '保存事件配置')).toBeDefined();
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

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
      getFile: async () => new File([state.gameConfigText], 'game.config.json'),
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

  it('global save aggregator writes dirty config and keeps it dirty after a write failure', async () => {
    const root = await renderFixture();
    const variable = byAttribute(root, 'aria-label', '变量名，第 1 行');
    variable.value = 'trust.global';
    variable.oninput?.();

    let diskText = state.gameConfigText;
    let failWrite = false;
    const handle = {
      getFile: async () => new File([diskText], 'game.config.json'),
      createWritable: async () => ({
        write: async (value: unknown) => {
          if (failWrite) throw new Error('global fixture write failure');
          diskText = String(value);
        },
        close: async () => {},
      }),
    };
    state.handles.gameConfig = handle as unknown as FileSystemFileHandle;

    await expect(saveDirtyConfigSections()).resolves.toEqual({ saved: 1, failures: 0, remainingDirty: false });
    expect((JSON.parse(diskText) as { variables: Record<string, unknown> }).variables['trust.global']).toBeDefined();
    expect(inspectConfigDraftState()).toEqual({ dirty: false, dirtySections: [] });

    variable.value = 'trust.global.failed';
    variable.oninput?.();
    failWrite = true;
    await expect(saveDirtyConfigSections()).resolves.toEqual({ saved: 0, failures: 1, remainingDirty: true });
    expect((JSON.parse(diskText) as { variables: Record<string, unknown> }).variables['trust.global.failed']).toBeUndefined();
    expect(inspectConfigDraftState()).toEqual({ dirty: true, dirtySections: ['variables'] });
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
      getFile: async () => new File([diskText], 'game.config.json'),
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
