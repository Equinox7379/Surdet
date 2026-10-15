import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectTextCatalog, applyConfigReferenceRename } from '@surdet/authoring';

vi.mock('../src/panels/calendar-map.js', () => ({ renderCalendarMap: vi.fn() }));
vi.mock('../src/v4/surfaces.js', () => ({ enhanceConfigTables: vi.fn() }));
vi.mock('../src/project-io.js', () => ({
  assertProjectWriteUnlocked: vi.fn(),
  workingGameConfigText: (source: { gameConfigText: string }) => source.gameConfigText,
  runProjectWriteOperation: vi.fn((operation: () => Promise<unknown>) => operation()),
  readProjectSourceText: async (handle: FileSystemFileHandle) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await (await handle.getFile()).arrayBuffer()),
  writeProjectText: async (_path: string, value: unknown, handle: { createWritable: () => Promise<{ write: (value: unknown) => Promise<void>; close: () => Promise<void> }> }) => {
    const writable = await handle.createWritable();
    await writable.write(value);
    await writable.close();
    return handle;
  },
}));
vi.mock('../src/authoring-project-storage.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/authoring-project-storage.js')>(),
  commitCharacterTable: vi.fn(),
  commitStageConfiguration: vi.fn(),
  commitThemeConfiguration: vi.fn(),
  commitEndScenes: vi.fn(),
  commitTextCatalogPatch: vi.fn(),
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
  private storedValue = '';
  get value(): string { return this.storedValue; }
  set value(value: string) { this.storedValue = this.tagName === 'TEXTAREA' ? value.replace(/\r\n?/g, '\n') : value; }
  files: File[] = [];
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

  replaceChildren(...children: FakeElement[]): void {
    this.ownText = '';
    for (const child of this.children) child.parentElement = null;
    this.children.splice(0);
    this.append(...children);
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
  readThemeConfigDraft, editThemeConfigDraft, saveThemeConfigDraftUnlocked, previewThemeConfigText,
  readEndingsDraft, editEndingsDraft, saveEndingsDraftUnlocked, endingsSourceError,
  editTextCsvDraft, readTextCsvDraft,
  restoreConfigSourceDraft,
  addTerminologyVariant,
} = await import('../src/panels/config.js');
const { commitStageConfiguration, commitThemeConfiguration, commitEndScenes } = await import('../src/authoring-project-storage.js');
const { commitTextCatalogPatch, loadEditorProjectSnapshot, createEditorProjectStorage } = await import('../src/authoring-project-storage.js');
const { runProjectWriteOperation } = await import('../src/project-io.js');

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('configuration draft state', () => {
  it('retains hidden gallery fields through repeated saves, delete/undo and replacement rows', async () => {
    const root = await renderFixture();
    resetConfigSession();
    state.configFiles.gallery = { cgs: [{ id: 'original', name: '图片', src: 'bg', group: 'keep', extension: { n: 1 } }], music: [], texts: [] };
    let disk = '';
    renderConfig(root as unknown as HTMLElement);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    state.handles.gallery = { createWritable: async () => ({ write: async (value: unknown) => { disk = String(value); }, close: async () => {} }) } as unknown as FileSystemFileHandle;
    const editId = (value: string) => {
      const input = byAttribute(root, 'aria-label', '条目标识，第 1 行');
      input.value = value; input.oninput?.();
    };
    editId('renamed');
    await saveDirtyConfigSections();
    expect(JSON.parse(disk).cgs[0]).toMatchObject({ id: 'renamed', group: 'keep', extension: { n: 1 } });
    editId('again');
    await saveDirtyConfigSections();
    expect(JSON.parse(disk).cgs[0]).toMatchObject({ id: 'again', group: 'keep', extension: { n: 1 } });
    byAttribute(root, 'aria-label', '删除图片鉴赏第 1 行').click();
    await saveDirtyConfigSections();
    expect(JSON.parse(disk).cgs).toEqual([]);
    configUndo();
    await saveDirtyConfigSections();
    expect(JSON.parse(disk).cgs[0]).toMatchObject({ id: 'again', group: 'keep', extension: { n: 1 } });
    byAttribute(root, 'aria-label', '删除图片鉴赏第 1 行').click();
    byText(root, '＋ 新增图片').click();
    editId('again');
    await saveDirtyConfigSections();
    expect(JSON.parse(disk).cgs[0]).not.toHaveProperty('group');
    expect(JSON.parse(disk).cgs[0]).not.toHaveProperty('extension');
  });

  it('edits the Chinese theme form through the existing draft, undo and save path', async () => {
    const root = await renderFixture(JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG),
      theme: { colors: { accent: 7 }, future: { keep: true } }, player: { subtitle: '保留' }, private: { keep: 1 } }));
    expect(inspectConfigDraftState().dirty).toBe(false);
    const color = byAttribute(root, 'aria-label', '主题色');
    color.value = '#654321'; color.oninput?.();
    const fonts = byAttribute(root, 'aria-label', '标题字体路径');
    fonts.value = 'content/assets/fonts/title.ttf'; fonts.oninput?.();
    const projected = JSON.parse(previewThemeConfigText(state.gameConfigText));
    expect(projected).toMatchObject({ theme: { colors: { accent: 0x654321 }, future: { keep: true } },
      fonts: { title: 'content/assets/fonts/title.ttf' }, player: { subtitle: '保留' }, private: { keep: 1 } });
    const edited = readThemeConfigDraft();
    configUndo(); expect(readThemeConfigDraft()).not.toBe(edited);
    configRedo(); expect(readThemeConfigDraft()).toBe(edited);
    vi.mocked(commitThemeConfiguration).mockImplementationOnce(async (theme, _logo, expected) => {
      expect(theme).toMatchObject({ colors: { accent: 0x654321 }, future: { keep: true } });
      state.gameConfigText = JSON.stringify(projected);
      return { text: state.gameConfigText, before: JSON.parse(expected).theme, after: theme };
    });
    await saveThemeConfigDraftUnlocked();
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

  it('edits end scenes as an undoable draft, keeps an empty list distinct from unset and follows scene renames', async () => {
    vi.mocked(commitEndScenes).mockReset();
    await renderFixture(JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG), player: { subtitle: '保留', endScenes: [] } }));
    expect(readEndingsDraft()).toEqual([]);
    expect(inspectConfigDraftState().dirty).toBe(false);
    editEndingsDraft(['start']);
    expect(inspectConfigDraftState().dirtySections).toContain('endings');
    configUndo(); expect(readEndingsDraft()).toEqual([]);
    expect(inspectConfigDraftState().dirty).toBe(false);
    configRedo(); expect(readEndingsDraft()).toEqual(['start']);
    editEndingsDraft(null); expect(readEndingsDraft()).toBeNull();
    expect(inspectConfigDraftState().dirtySections).toContain('endings');
    configUndo(); expect(readEndingsDraft()).toEqual(['start']);
    prepareConfigSceneRename('start', 'opening', 'opening')();
    expect(readEndingsDraft()).toEqual(['opening']);
    configUndo(); expect(readEndingsDraft()).toEqual([]);
    configRedo(); expect(readEndingsDraft()).toEqual(['opening']);
    vi.mocked(commitEndScenes).mockImplementationOnce(async (value, expected) => {
      const config = JSON.parse(expected);
      expect(config.player).toEqual({ subtitle: '保留', endScenes: [] });
      state.gameConfigText = JSON.stringify({ ...config, player: { ...config.player, endScenes: value } });
      return { text: state.gameConfigText, before: [], after: value };
    });
    await saveDirtyConfigSections();
    expect(vi.mocked(commitEndScenes).mock.calls.map(call => call[0])).toEqual([['opening']]);
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

  it('never treats a malformed end scene source as unset and refuses to edit or save it', async () => {
    vi.mocked(commitEndScenes).mockReset();
    await renderFixture(JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG), player: { endScenes: 'start' } }));
    expect(endingsSourceError()).toMatch(/场景标识列表/);
    expect(() => editEndingsDraft(['start'])).toThrow(/场景标识列表/);
    expect(inspectConfigDraftState().dirtySections).not.toContain('endings');
    await expect(saveEndingsDraftUnlocked()).rejects.toThrow(/场景标识列表/);
    expect(commitEndScenes).not.toHaveBeenCalled();
  });

  it('writes a picked swatch colour through the same theme field and draft', async () => {
    const root = await renderFixture();
    const swatch = byAttribute(root, 'aria-label', '主题色取色');
    swatch.value = '#a1b2c3'; swatch.oninput?.();
    expect(byAttribute(root, 'aria-label', '主题色').value).toBe('#a1b2c3');
    expect(JSON.parse(previewThemeConfigText(state.gameConfigText)).theme.colors.accent).toBe(0xa1b2c3);
    const color = byAttribute(root, 'aria-label', '主题色'); color.value = '#0a0b0c'; color.oninput?.();
    expect(swatch.value).toBe('#0a0b0c');
    configUndo(); expect(JSON.parse(readThemeConfigDraft()).theme?.colors?.accent).not.toBe(0x0a0b0c);
  });

  it('retains incomplete form input as a dirty draft and synchronizes raw corrections', async () => {
    const root = await renderFixture();
    const color = byAttribute(root, 'aria-label', '主题色');
    color.value = '#12'; color.oninput?.();
    expect(inspectConfigDraftState().dirty).toBe(true);
    expect(JSON.parse(readThemeConfigDraft()).theme.colors.accent).toBe('#12');
    expect(() => previewThemeConfigText(state.gameConfigText)).toThrow();
    await expect(saveThemeConfigDraftUnlocked()).rejects.toThrow();
    expect(root.textContent).toContain('六位色值');
    const raw = byAttribute(root, 'aria-label', '主题配置文本');
    raw.value = '{"theme":{"colors":{"accent":1193046}}}'; raw.oninput?.();
    expect(byAttribute(root, 'aria-label', '主题色').value).toBe('#123456');
    raw.value = '{'; raw.oninput?.();
    expect(readThemeConfigDraft()).toBe('{');
    expect(root.textContent).toContain('现有草稿不会丢失');
  });

  it('clears only the selected theme field and accepts supported fractional layout values', async () => {
    const root = await renderFixture(JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG), theme: { colors: { accent: 7, text: 8 } }, fonts: { title: 'title.ttf', body: 'body.ttf' } }));
    const color = byAttribute(root, 'aria-label', '主题色'); color.value = ''; color.oninput?.();
    const font = byAttribute(root, 'aria-label', '标题字体路径'); font.value = ''; font.oninput?.();
    const ratio = byAttribute(root, 'aria-label', '对话框高度比例'); ratio.value = '.001'; ratio.oninput?.();
    const projected = JSON.parse(previewThemeConfigText(state.gameConfigText));
    expect(projected.theme.colors).toEqual({ text: 8 });
    expect(projected.fonts).toEqual({ body: 'body.ttf' });
    expect(projected.theme.dialogHeightRatio).toBe(.001);
  });

  it('restores exact historical configuration as an undoable draft and preserves it after failed save', async () => {
    await renderFixture();
    let diskText = state.gameConfigText;
    const before = diskText;
    const historical = '{\n  "entryScene": "start", "variables": {}, "privateExtension": {"keep": true}\n}\n';
    let fail = true;
    state.handles.gameConfig = {
      getFile: async () => new File([diskText], 'game.config.json'),
      createWritable: async () => ({ write: async (value: unknown) => { if (fail) throw new Error('磁盘失败'); diskText = String(value); }, close: async () => {} }),
    } as unknown as FileSystemFileHandle;
    restoreConfigSourceDraft('gameConfig', historical, before);
    expect(diskText).toBe(before);
    expect(inspectConfigDraftState().dirty).toBe(true);
    configUndo();
    expect(inspectConfigDraftState().dirty).toBe(false);
    configRedo();
    await expect(saveDirtyConfigSections()).resolves.toMatchObject({ failures: 1, remainingDirty: true });
    expect(diskText).toBe(before);
    fail = false;
    await expect(saveDirtyConfigSections()).resolves.toMatchObject({ saved: 1, failures: 0, remainingDirty: false });
    expect(diskText).toBe(historical);
    expect(state.gameConfigText).toBe(historical);
    configUndo();
    expect(inspectConfigDraftState().dirty).toBe(true);
    await saveDirtyConfigSections();
    expect(diskText).toBe(before);
    configRedo();
    await saveDirtyConfigSections();
    expect(diskText).toBe(historical);
  });

  it('protects existing drafts and can stage a valid replacement for malformed source', async () => {
    const root = await renderFixture();
    editTextCsvDraft('未确认的译稿');
    expect(() => restoreConfigSourceDraft('gameConfig', '{}', state.gameConfigText)).toThrow('当前配置草稿');
    expect(readTextCsvDraft()).toBe('未确认的译稿');
    resetConfigSession();
    await renderFixture('{broken');
    expect(state.configReadErrors.gameConfig).toBeDefined();
    restoreConfigSourceDraft('gameConfig', INITIAL_GAME_CONFIG, '{broken');
    expect(inspectConfigDraftState().dirty).toBe(true);
    expect(() => prepareConfigSceneRename('start', 'other', 'start')).toThrow('历史配置');
    configUndo();
    expect(state.gameConfigText).toBe('{broken');
    expect(inspectConfigDraftState().dirty).toBe(false);
    void root;
  });

  it('keeps ordinary configuration undo entries intact across a historical full-file save', async () => {
    const root = await renderFixture();
    let diskText = state.gameConfigText;
    state.handles.gameConfig = {
      getFile: async () => new File([diskText], 'game.config.json'),
      createWritable: async () => ({ write: async (value: unknown) => { diskText = String(value); }, close: async () => {} }),
    } as unknown as FileSystemFileHandle;
    const variable = byAttribute(root, 'aria-label', '变量名，第 1 行');
    variable.value = 'trust.changed'; variable.oninput?.();
    await saveDirtyConfigSections();
    const beforeHistory = diskText;
    restoreConfigSourceDraft('gameConfig', '{"entryScene":"start","variables":{}}', beforeHistory);
    await saveDirtyConfigSections();
    configUndo(); await saveDirtyConfigSections();
    expect(diskText).toBe(beforeHistory);
    configUndo();
    expect(inspectConfigDraftState().dirtySections).toContain('variables');
    await saveDirtyConfigSections();
    expect(JSON.parse(diskText).variables.trust).toBeDefined();
    expect(JSON.parse(diskText).variables['trust.changed']).toBeUndefined();
  });

  it('rebases saved historical configuration undo through a later scene rename', async () => {
    await renderFixture();
    let diskText = state.gameConfigText;
    state.handles.gameConfig = {
      getFile: async () => new File([diskText], 'game.config.json'),
      createWritable: async () => ({ write: async (value: unknown) => { diskText = String(value); }, close: async () => {} }),
    } as unknown as FileSystemFileHandle;
    restoreConfigSourceDraft('gameConfig', '{"entryScene":"start","variables":{},"unknown":"历史"}', diskText);
    await saveDirtyConfigSections();
    prepareConfigSceneRename('start', 'renamed', 'renamed')();
    configUndo();
    await saveDirtyConfigSections();
    expect(JSON.parse(diskText).entryScene).toBe('renamed');
    configRedo();
    await saveDirtyConfigSections();
    expect(JSON.parse(diskText)).toMatchObject({ entryScene: 'renamed', unknown: '历史' });
  });
  async function textFixture(): Promise<FakeElement> {
    state.scenes = new Map([['start', { id: 'start', file: 'start.gal', text: '@scene start\n旁白：你好。\n旁白：再见。\n@end\n', eol: '\n', dirty: false, handle: null }]]);
    state.timelines = []; state.dirAssets = [];
    vi.mocked(commitTextCatalogPatch).mockReset();
    vi.mocked(commitTextCatalogPatch).mockImplementation(async () => ({ text: state.gameConfigText }));
    return renderFixture();
  }

  async function action(root: FakeElement, label: string): Promise<void> {
    const button = byText(root, label);
    button.click();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  }

  async function queueBinding(root: FakeElement, key = 'greeting', index = 0): Promise<void> {
    await action(root, '读取文本目录');
    const source = byAttribute(root, 'aria-label', '当前文本来源');
    expect(source.children.length, root.textContent.slice(-1800)).toBeGreaterThan(index);
    source.value = source.children[index]!.value;
    byAttribute(root, 'aria-label', '稳定文本键').value = key;
    await action(root, '加入绑定清单');
  }

  it('exporting the saved catalog does not replace a CSV draft, its dirty state or undo history', async () => {
    const root = await textFixture();
    const csv = byAttribute(root, 'aria-label', '译稿表格');
    csv.value = 'my unpublished translation'; csv.oninput?.();
    const history = configHistoryDepth();
    await action(root, '导出译稿表格');
    expect(root.textContent).toContain('已导出');
    expect(csv.value).toBe('my unpublished translation');
    expect(readTextCsvDraft()).toBe(csv.value);
    expect(inspectConfigDraftState().dirtySections).toEqual(['texts']);
    expect(configHistoryDepth()).toEqual(history);
    expect(commitTextCatalogPatch).not.toHaveBeenCalled();
  });

  it('keeps pending bindings dirty and recoverable through a real configuration rebuild and undo/redo', async () => {
    const root = await textFixture();
    await queueBinding(root);
    expect(root.textContent).toContain('greeting → 你好。');
    expect(inspectConfigDraftState().dirtySections).toEqual(['texts']);
    byText(root, '＋ 新增变量').click();
    expect(root.textContent).toContain('greeting → 你好。');
    configUndo(); // Undo the unrelated row, not the binding.
    expect(root.textContent).toContain('greeting → 你好。');
    configUndo();
    expect(root.textContent).not.toContain('greeting → 你好。');
    configRedo();
    expect(root.textContent).toContain('greeting → 你好。');
    await action(root, '绑定清单并保存');
    expect(commitTextCatalogPatch).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ type: 'bind', bindings: [expect.objectContaining({ key: 'greeting' })] }) }));
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

  it('downloads clean saved data or the exact working CSV without changing pending bindings or import approval', async () => {
    const root = await textFixture();
    const downloads: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloads.push(blob as Blob); return 'blob:test'; });
    await action(root, '导出译稿表格');
    expect(readTextCsvDraft()).toBe('');
    expect(inspectConfigDraftState().dirty).toBe(false);
    await action(root, '载入已保存译稿');
    await queueBinding(root);
    await action(root, '预览导入差异');
    expect(root.textContent).toContain('差异预览通过');
    const csv = readTextCsvDraft(), history = configHistoryDepth();
    await action(root, '导出译稿表格');
    await action(root, '下载当前工作稿');
    expect(new Uint8Array(await downloads.at(-1)!.arrayBuffer())).toEqual(new TextEncoder().encode(csv));
    expect(root.textContent).toContain('greeting → 你好。');
    expect(configHistoryDepth()).toEqual(history);
    await action(root, '确认导入并保存'); // Export did not invalidate the preview.
    expect(commitTextCatalogPatch).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ type: 'import', csv }) }));
    expect(inspectConfigDraftState().dirtySections).toEqual(['texts']); // Binding is still pending.
  });

  it('requires explicit replacement of a CSV draft and leaves it intact when cancelled', async () => {
    const root = await textFixture();
    editTextCsvDraft('unpublished'); renderConfig(root as unknown as HTMLElement);
    const confirm = vi.fn(() => false); vi.stubGlobal('window', { confirm });
    const history = configHistoryDepth();
    await action(root, '载入已保存译稿');
    expect(confirm).toHaveBeenCalledOnce();
    expect(readTextCsvDraft()).toBe('unpublished');
    expect(byAttribute(root, 'aria-label', '译稿表格').value).toBe('unpublished');
    expect(configHistoryDepth()).toEqual(history);
    confirm.mockReturnValue(true);
    await action(root, '载入已保存译稿');
    expect(readTextCsvDraft()).toContain('key,locale,sourceVersion');
    expect(inspectConfigDraftState().dirtySections).toEqual(['texts']);
    configUndo(); expect(readTextCsvDraft()).toBe('unpublished');
  });

  it.each(['built-in', 'CRLF', 'LF'])('uses the exact %s working draft for preview, download and the successful baseline', async (input) => {
    await textFixture();
    const view = await inspectTextCatalog(await loadEditorProjectSnapshot(), createEditorProjectStorage());
    const { sourceId: _id, path: _path, line: _line, ...source } = view.sources[0]!;
    const config = { ...JSON.parse(INITIAL_GAME_CONFIG), textCatalog: { version: 1, sourceLocale: 'zh-CN', entries: [
      { key: 'greeting', source, translations: { en: { value: 'Hello, "friend".\nNext line.', sourceVersion: source.version } } },
    ] } };
    const root = await renderFixture(JSON.stringify(config));
    await action(root, '载入已保存译稿');
    let submitted = readTextCsvDraft();
    if (input !== 'built-in') {
      submitted = submitted.replace('Hello,', 'Welcome,');
      if (input === 'LF') submitted = submitted.replaceAll('\r\n', '\n');
      const upload = byAttribute(root, 'aria-label', '选择译稿表格');
      upload.files = [new File([submitted], 'translation.csv')]; upload.onchange?.();
      await vi.waitFor(() => expect(root.textContent).toContain('表格已读取'));
    }
    expect(readTextCsvDraft()).toBe(submitted);
    expect(submitted.startsWith('\uFEFF')).toBe(true);
    const csv = byAttribute(root, 'aria-label', '译稿表格');
    expect(csv.value).not.toContain('\r'); // Real textarea normalization must not change the draft.
    const downloads: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloads.push(blob as Blob); return 'blob:test'; });
    await action(root, '下载当前工作稿');
    expect(new Uint8Array(await downloads[0]!.arrayBuffer())).toEqual(new TextEncoder().encode(submitted));
    await action(root, '预览导入差异'); expect(root.textContent).toContain('差异预览通过');
    await action(root, '确认导入并保存');
    expect(commitTextCatalogPatch).toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ type: 'import', csv: submitted }) }));
    expect(inspectConfigDraftState().dirty).toBe(false);
    expect(await saveDirtyConfigSections()).toEqual({ saved: 0, failures: 0, remainingDirty: false });
  });

  it('retains multiple bindings on read/export, rejects changed source versions, and requires each stale binding to be reconfirmed', async () => {
    const root = await textFixture();
    await queueBinding(root);
    await queueBinding(root, 'farewell', 1);
    await action(root, '导出译稿表格');
    expect(root.textContent).toContain('greeting → 你好。');
    expect(root.textContent).toContain('farewell → 再见。');
    const outcome = await saveDirtyConfigSections();
    expect(outcome).toEqual({ saved: 0, failures: 1, remainingDirty: true });
    state.scenes.get('start')!.text = '@scene start\n旁白：改稿了。\n旁白：再见。\n@end\n';
    await action(root, '绑定清单并保存');
    expect(commitTextCatalogPatch).not.toHaveBeenCalled();
    expect(root.textContent).toContain('来源版本已经变化');
    expect(root.textContent).toContain('greeting → 你好。');
    await queueBinding(root); // Same key explicitly selected against the new source.
    await action(root, '绑定清单并保存');
    expect(commitTextCatalogPatch).not.toHaveBeenCalled(); // The other row is still stale.
    await queueBinding(root, 'farewell', 1);
    await action(root, '绑定清单并保存');
    expect(commitTextCatalogPatch).toHaveBeenCalledOnce();
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

  it('keeps failed bindings and source language, and clears only submitted bindings after a detached-panel save', async () => {
    const root = await textFixture();
    await queueBinding(root);
    const language = byAttribute(root, 'aria-label', '源语言'); language.value = 'ja'; language.oninput?.();
    renderConfig(root as unknown as HTMLElement);
    expect(byAttribute(root, 'aria-label', '源语言').value).toBe('ja');
    vi.mocked(commitTextCatalogPatch).mockRejectedValueOnce(new Error('写入失败'));
    await action(root, '绑定清单并保存');
    expect(root.textContent).toContain('写入失败');
    expect(root.textContent).toContain('greeting → 你好。');
    expect(inspectConfigDraftState().dirtySections).toEqual(['texts']);
    vi.mocked(commitTextCatalogPatch).mockClear();
    let release!: (result: { text: string }) => void;
    vi.mocked(commitTextCatalogPatch).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const save = byText(root, '绑定清单并保存'); save.click();
    await vi.waitFor(() => expect(commitTextCatalogPatch).toHaveBeenCalledOnce());
    let panel = save.parentElement!;
    while (!panel.className.split(' ').includes('config-ledger-section')) panel = panel.parentElement!;
    descendants(panel).forEach(node => { node.isConnected = false; });
    byText(root, '＋ 新增变量').click();
    editTextCsvDraft('newer CSV');
    release({ text: state.gameConfigText });
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(root.textContent).not.toContain('greeting → 你好。');
    expect(readTextCsvDraft()).toBe('newer CSV');
    expect(inspectConfigDraftState().dirtySections).toEqual(['variables', 'texts']);
    configUndo(); configUndo(); // Saved binding must not reappear via unrelated history.
    expect(root.textContent).not.toContain('greeting → 你好。');
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

  it('keeps edits made during an import dirty and ignores a save callback from a previous project session', async () => {
    const root = await textFixture();
    await action(root, '载入已保存译稿');
    await action(root, '预览导入差异');
    let release!: (result: { text: string }) => void;
    vi.mocked(commitTextCatalogPatch).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const save = byText(root, '确认导入并保存'); save.click();
    await vi.waitFor(() => expect(commitTextCatalogPatch).toHaveBeenCalledOnce());
    const csv = byAttribute(root, 'aria-label', '译稿表格'); csv.value = 'typed during save'; csv.oninput?.();
    release({ text: state.gameConfigText });
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(readTextCsvDraft()).toBe('typed during save');
    expect(inspectConfigDraftState().dirtySections).toEqual(['texts']);

    await queueBinding(root);
    vi.mocked(commitTextCatalogPatch).mockClear();
    vi.mocked(commitTextCatalogPatch).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const bindingSave = byText(root, '绑定清单并保存'); bindingSave.click();
    await vi.waitFor(() => expect(commitTextCatalogPatch).toHaveBeenCalledOnce());
    const priorSource = state.gameConfigText;
    resetConfigSession();
    const next = await renderFixture(JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG), title: 'Another project' }));
    editTextCsvDraft('other project draft');
    release({ text: priorSource });
    await vi.waitFor(() => expect(bindingSave.disabled).toBe(false));
    expect(state.gameConfigText).toContain('Another project');
    expect(readTextCsvDraft()).toBe('other project draft');
    expect(inspectConfigDraftState().dirtySections).toEqual(['texts']);
    expect(next.textContent).not.toContain('greeting → 你好。');
  });

  it('preserves unconfirmed CSV across workbench changes and undo, and never imports it via save-all', async () => {
    const root = await renderFixture();
    editTextCsvDraft('key,locale\nmy unfinished translation');
    expect(inspectConfigDraftState().dirtySections).toEqual(['texts']);
    renderConfig(root as unknown as HTMLElement);
    expect(readTextCsvDraft()).toContain('unfinished');
    configUndo(); expect(readTextCsvDraft()).toBe(''); expect(inspectConfigDraftState().dirty).toBe(false);
    configRedo(); expect(readTextCsvDraft()).toContain('unfinished');
    const source = state.gameConfigText;
    const outcome = await saveDirtyConfigSections();
    expect(outcome.failures).toBe(1); expect(inspectConfigDraftState().dirtySections).toEqual(['texts']);
    expect(state.gameConfigText).toBe(source);
    resetConfigSession(); expect(readTextCsvDraft()).toBe('');
  });
  it('keeps malformed stored visual JSON visible so the author can repair it', async () => {
    const visuals = { uniform: { broken: { version: 1, kind: 'sequence', frames: [], loop: true } } };
    const root = await renderFixture(JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG), characters: { lynn: { name: '凛', visuals } } }));
    const field = byAttribute(root, 'aria-label', 'lynn 分层 / 帧动画配置');
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
    const field = () => byAttribute(root, 'aria-label', 'lynn 分层 / 帧动画配置');

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

  it('keeps a theme draft in preview and undo/redo, then drops it on project switch', async () => {
    const first = JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG),
      theme: { colors: { accent: 0x123456 }, future: { keep: true } },
      player: { titleLogo: 'old-logo', subtitle: 'still here' } });
    await renderFixture(first);
    const original = readThemeConfigDraft();
    const next = JSON.stringify({ theme: { colors: { accent: 0x654321 } }, titleLogo: null });
    editThemeConfigDraft(next);
    expect(inspectConfigDraftState().dirtySections).toEqual(['theme']);
    const preview = JSON.parse(previewThemeConfigText(first)) as Record<string, any>;
    expect(preview.theme).toEqual({ colors: { accent: 0x654321 }, future: { keep: true } });
    expect(preview.player).toEqual({ subtitle: 'still here' });
    configUndo();
    expect(readThemeConfigDraft()).toBe(original);
    expect(inspectConfigDraftState().dirty).toBe(false);
    configRedo();
    expect(readThemeConfigDraft()).toBe(next);
    resetConfigSession();
    state.gameConfigText = JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG), theme: { colors: { accent: 7 } } });
    expect(JSON.parse(readThemeConfigDraft()).theme.colors.accent).toBe(7);
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

  it('rejects malformed theme shapes and stale source without replacing the stored theme', async () => {
    await renderFixture(JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG), theme: { colors: { accent: 7 } } }));
    vi.mocked(commitThemeConfiguration).mockClear();
    editThemeConfigDraft('{"theme":"bad","titleLogo":null}');
    expect(() => previewThemeConfigText(state.gameConfigText)).toThrow(/theme|主题/);
    await expect(saveThemeConfigDraftUnlocked()).rejects.toThrow(/theme|主题/);
    expect(commitThemeConfiguration).not.toHaveBeenCalled();
    editThemeConfigDraft('{"theme":{"colors":{"accent":8}},"titleLogo":null}');
    state.gameConfigText = JSON.stringify({ ...JSON.parse(state.gameConfigText), theme: { colors: { accent: 9 } } });
    await expect(saveThemeConfigDraftUnlocked()).rejects.toThrow('主题来源配置已经变化');
    expect(commitThemeConfiguration).not.toHaveBeenCalled();
    expect(inspectConfigDraftState().dirtySections).toEqual(['theme']);
  });

  it('saves a theme snapshot, preserves newer input, and reopens the saved version', async () => {
    await renderFixture();
    const submitted = '{"theme":{"colors":{"accent":7}},"titleLogo":null}';
    editThemeConfigDraft(submitted);
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(commitThemeConfiguration).mockImplementationOnce(async (theme, titleLogo, expected) => {
      expect(theme).toEqual({ colors: { accent: 7 } });
      expect(titleLogo).toBeNull();
      expect(expected).toBe(INITIAL_GAME_CONFIG);
      await waiting;
      state.gameConfigText = JSON.stringify({ ...JSON.parse(expected), theme });
      return { text: state.gameConfigText, before: null, after: theme };
    });
    const saving = saveDirtyConfigSections();
    editThemeConfigDraft('{"theme":{"colors":{"accent":8}},"titleLogo":null}');
    finish();
    await expect(saving).resolves.toEqual({ saved: 1, failures: 0, remainingDirty: true });
    expect(JSON.parse(state.gameConfigText).theme.colors.accent).toBe(7);
    configUndo();
    expect(readThemeConfigDraft()).toBe(submitted);
    expect(inspectConfigDraftState().dirty).toBe(false);
    resetConfigSession();
    await renderFixture(state.gameConfigText);
    expect(JSON.parse(readThemeConfigDraft()).theme.colors.accent).toBe(7);
  });

  it('takes the project write lock for the theme save button and displays failures', async () => {
    const root = await renderFixture();
    editThemeConfigDraft('{"theme":{"colors":{"accent":7}},"titleLogo":null}');
    vi.mocked(runProjectWriteOperation).mockClear();
    vi.mocked(commitThemeConfiguration).mockRejectedValueOnce(new Error('fixture write failure'));
    byText(root, '保存主题配置').click();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(runProjectWriteOperation).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('fixture write failure');
    expect(inspectConfigDraftState().dirtySections).toEqual(['theme']);
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
  it('rebases catalog references in past/future without confirming CSV or pending bindings', async () => {
    await textFixture();
    state.scenes.get('start')!.text = '@scene start\n@label opening\n旁白：你好。\n旁白：再见。\n@end\n';
    const view = await inspectTextCatalog(await loadEditorProjectSnapshot(), createEditorProjectStorage());
    const { sourceId: _id, path: _path, line: _line, ...source } = view.sources[0]!;
    const catalog = { version: 1, sourceLocale: 'zh-CN', entries: [{ key: 'greeting', source, translations: { en: { value: 'Hello.', sourceVersion: source.version } } }] };
    const root = await renderFixture(JSON.stringify({ ...JSON.parse(INITIAL_GAME_CONFIG), textCatalog: catalog }));
    await queueBinding(root, 'farewell', 1);
    editTextCsvDraft('unconfirmed CSV');
    editThemeConfigDraft('{"theme":{"colors":{"accent":7}},"titleLogo":null}');
    configUndo(); // Keep both past and future snapshots across the identity change.
    const depth = configHistoryDepth();
    const apply = prepareConfigLabelRename('start', 'opening', 'arrival');
    const files = { 'game.config.json': state.gameConfigText };
    applyConfigReferenceRename(files, { from: 'opening', to: 'arrival', labelScene: 'start' }, 'start');
    state.gameConfigText = files['game.config.json'];
    state.scenes.get('start')!.text = state.scenes.get('start')!.text.replace('@label opening', '@label arrival');
    apply();
    expect(configHistoryDepth()).toEqual(depth);
    for (const step of [configRedo, configUndo]) {
      step();
      expect(JSON.parse(state.gameConfigText).textCatalog.entries[0]).toEqual({ ...catalog.entries[0], source: { ...source, label: 'arrival' } });
      expect(readTextCsvDraft()).toBe('unconfirmed CSV');
      expect(root.textContent).toContain('farewell → 再见。');
      expect(inspectConfigDraftState().dirtySections).toContain('texts');
    }
    await action(root, '绑定清单并保存');
    expect(commitTextCatalogPatch).not.toHaveBeenCalled();
    expect(root.textContent).toContain('来源版本已经变化');
    expect(root.textContent).toContain('farewell → 再见。');
    expect(readTextCsvDraft()).toBe('unconfirmed CSV');
  });

  it('rebases hidden calendar event references in clean baselines, drafts and undo/redo', async () => {
    const root = await renderFixture();
    resetConfigSession();
    state.configFiles.calendar = {
      maxAp: 3, maxTurns: 10, nodes: [],
      baseCommands: [
        { id: 'rest', name: '休息', apCost: 1, eventId: 'old', extension: { owner: 'rest', note: 'old' } },
        { id: 'other', name: '其他', apCost: 1, eventId: 'unrelated', extension: { owner: 'other' } },
      ],
    };
    renderConfig(root as unknown as HTMLElement);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const rename = (from: string, to: string) => {
      const apply = prepareConfigSceneRename(from, to, 'start');
      const files = { 'game.config.json': state.gameConfigText, 'content/config/calendar.json': JSON.stringify(state.configFiles.calendar) };
      applyConfigReferenceRename(files, { from, to }, 'start');
      state.configFiles.calendar = JSON.parse(files['content/config/calendar.json']);
      apply();
    };
    rename('old', 'new');
    expect(inspectConfigDraftState().dirty).toBe(false);
    expect(configHistoryDepth()).toEqual({ past: 0, future: 0 });
    renderConfig(root as unknown as HTMLElement);
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    const id = byAttribute(root, 'aria-label', '指令标识，第 1 行');
    id.value = 'rest_renamed'; id.oninput?.();
    editTextCsvDraft('unconfirmed CSV');
    configUndo(); // Both past and future contain the calendar row before the next rename.
    const depth = configHistoryDepth();
    rename('new', 'newer');
    expect(configHistoryDepth()).toEqual(depth);
    expect(inspectConfigDraftState().dirtySections).toEqual(['calendar']);
    let disk = '';
    state.handles.calendar = { createWritable: async () => ({ write: async (value: unknown) => { disk = String(value); }, close: async () => {} }) } as unknown as FileSystemFileHandle;
    const saveAndExpect = async (expectedId: string) => {
      expect(await saveDirtyConfigSections()).toMatchObject({ saved: 1, failures: 0, remainingDirty: false });
      expect(JSON.parse(disk).baseCommands).toEqual([
        { id: expectedId, name: '休息', apCost: 1, eventId: 'newer', extension: { owner: 'rest', note: 'old' } },
        { id: 'other', name: '其他', apCost: 1, eventId: 'unrelated', extension: { owner: 'other' } },
      ]);
    };
    await saveAndExpect('rest_renamed');
    configUndo();
    await saveAndExpect('rest');
    configRedo();
    await saveAndExpect('rest_renamed');
    configRedo();
    expect(readTextCsvDraft()).toBe('unconfirmed CSV');
    expect(inspectConfigDraftState().dirtySections).toEqual(['texts']);
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

  it('preserves an unfinished variants draft and saved terminology when the audit action adds a variant', async () => {
    const root = await renderFixture();
    state.projectLoading = false;
    let diskText = JSON.stringify(state.configFiles.terminology);
    const original = diskText;
    const write = vi.fn(async (value: unknown) => { diskText = String(value); });
    state.handles.terminology = {
      createWritable: async () => ({ write, close: async () => {} }),
    } as unknown as FileSystemFileHandle;
    const variants = byAttribute(root, 'aria-label', '变体列表，第 1 行');
    variants.value = '[';
    variants.oninput?.();
    const before = configHistoryDepth();

    await addTerminologyVariant('规范词', '新变体');

    expect(diskText).toBe(original);
    expect(write).not.toHaveBeenCalled();
    expect(state.configFiles.terminology).toEqual({ terms: [{ canonical: '规范词', variants: ['变体'] }] });
    renderConfig(root as unknown as HTMLElement);
    expect(byAttribute(root, 'aria-label', '变体列表，第 1 行').value).toBe('[');
    expect(inspectConfigDraftState().dirtySections).toEqual(['terminology']);
    expect(configHistoryDepth()).toEqual(before);
  });

  it.each([
    { draft: '["变体"]', expected: ['变体', '新变体'] },
    { draft: '', expected: ['新变体'] },
  ])('adds an audit variant to a supported terminology draft $draft', async ({ draft, expected }) => {
    const root = await renderFixture();
    state.projectLoading = false;
    let diskText = JSON.stringify(state.configFiles.terminology);
    state.handles.terminology = {
      createWritable: async () => ({ write: async (value: unknown) => { diskText = String(value); }, close: async () => {} }),
    } as unknown as FileSystemFileHandle;
    const variants = byAttribute(root, 'aria-label', '变体列表，第 1 行');
    variants.value = draft;
    variants.oninput?.();

    await addTerminologyVariant('规范词', '新变体');

    expect(JSON.parse(diskText).terms).toEqual([{ canonical: '规范词', variants: expected }]);
    expect(inspectConfigDraftState().dirty).toBe(false);
  });

  it.each([
    { mode: 'root', keys: ['arrival'], saved: 1 },
    { mode: 'nested', keys: ['chapters/arrival'], saved: 1 },
    { mode: 'missing', keys: [], saved: 0 },
    { mode: 'ambiguous', keys: ['chapters/arrival', 'other/arrival'], saved: 0 },
  ])('resolves a $mode gallery replay target by its runtime scene identity', async ({ keys, saved }) => {
    const root = await renderFixture();
    const previousScenes = new Map(state.scenes);
    const text = '@label replay\n凛：回想正文。\n@end\n';
    const originalGallery = JSON.stringify({ cgs: [], music: [], texts: [{ id: 'memory', name: '回想', scene: 'arrival', label: 'replay' }] });
    let diskText = originalGallery;
    try {
      state.scenes.clear();
      for (const key of keys) state.scenes.set(key, {
        id: 'arrival', file: `${key}.gal`, text, eol: '\n', dirty: false,
        handle: { getFile: async () => new File([text], 'arrival.gal') } as unknown as FileSystemFileHandle,
      });
      state.configFiles.gallery = JSON.parse(originalGallery);
      resetConfigSession();
      renderConfig(root as unknown as HTMLElement);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      state.handles.gallery = {
        createWritable: async () => ({ write: async (value: unknown) => { diskText = String(value); }, close: async () => {} }),
      } as unknown as FileSystemFileHandle;
      const gallery = descendants(root).find(element => element.dataset.configSection === 'gallery')!;
      const name = byAttribute(gallery, 'aria-label', '名称，第 1 行');
      name.value = '修订回想';
      name.oninput?.();

      await expect(saveDirtyConfigSections()).resolves.toEqual({ saved, failures: saved ? 0 : 1, remainingDirty: !saved });
      if (saved) expect(JSON.parse(diskText).texts[0]).toEqual({ id: 'memory', name: '修订回想', scene: 'arrival', label: 'replay' });
      else expect(diskText).toBe(originalGallery);
    } finally {
      state.scenes.clear();
      for (const [key, value] of previousScenes) state.scenes.set(key, value);
    }
  });

  it.each([false, true])('does not create an empty missing root config when saving characters (new draft: %s)', async (newDraft) => {
    const root = await renderFixture('');
    state.projectLoading = false;
    state.reviewPreviewReadOnly = false;
    let created = false;
    const create = vi.fn(async (_name: string, options?: FileSystemGetFileOptions) => {
      if (!options?.create) throw new DOMException('missing root config', 'NotFoundError');
      created = true;
      return { getFile: async () => new File([''], 'game.config.json'), createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    });
    state.dirHandle = { getFileHandle: create } as unknown as FileSystemDirectoryHandle;
    if (newDraft) {
      byAttribute(root, 'aria-label', '新角色标识').value = 'rin';
      byAttribute(root, 'aria-label', '新角色显示名称').value = '凛';
      byText(root, '添加角色').click();
      await expect(saveDirtyConfigSections()).resolves.toEqual({ saved: 0, failures: 1, remainingDirty: true });
      expect(inspectConfigDraftState().dirtySections).toEqual(['characters']);
    } else {
      byText(root, '保存角色表').click();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    expect(created).toBe(false);
    expect(state.handles.gameConfig).toBeNull();
    expect(state.gameConfigText).toBe('');
  });

  it.each(['typing', 'new-file', 'unchanged'])('settles a selected translation file against the current working draft (%s)', async mode => {
    const root = await renderFixture();
    const imported = 'key,source,translation\r\nhello,原文,旧文件译文\r\n';
    const file = new File([imported], 'delayed.csv');
    const csv = byAttribute(root, 'aria-label', '译稿表格');
    const prior = '先前未保存的工作稿';
    csv.value = prior; csv.oninput?.();
    const read = file.arrayBuffer.bind(file);
    let release!: () => void;
    let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    file.arrayBuffer = async () => { const bytes = await read(); started(); await gate; return bytes; };
    const upload = byAttribute(root, 'aria-label', '选择译稿表格');
    upload.files = [file];
    upload.onchange?.();
    await reading;
    const latest = '尚未完成的更新输入';
    if (mode === 'typing') { csv.value = latest; csv.oninput?.(); }
    if (mode === 'new-file') upload.files = [new File(['新文件'], 'new.csv')];
    const before = configHistoryDepth();
    release();
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    const expected = mode === 'unchanged' ? imported : mode === 'typing' ? latest : prior;
    expect(readTextCsvDraft()).toBe(expected);
    expect(csv.value).toBe(expected.replace(/\r\n/g, '\n'));
    if (mode !== 'unchanged') expect(configHistoryDepth()).toEqual(before);
    expect(inspectConfigDraftState().dirtySections).toEqual(['texts']);
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
