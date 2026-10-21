import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/panels/calendar-map.js', () => ({ renderCalendarMap: vi.fn() }));
vi.mock('../src/v4/surfaces.js', () => ({ enhanceConfigTables: vi.fn() }));

class Element {
  readonly tagName: string;
  readonly children: Element[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  parentElement: Element | null = null;
  className = '';
  id = '';
  type = '';
  value = '';
  files: File[] = [];
  checked = false;
  hidden = false;
  disabled = false;
  isConnected = true;
  rows = 0;
  onclick: (() => void) | null = null;
  oninput: (() => void) | null = null;
  onchange: (() => void) | null = null;
  private ownText = '';
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(text: string | null) { this.ownText = text ?? ''; this.children.splice(0); }
  set innerHTML(text: string) { this.textContent = text; }
  appendChild(child: Element): Element { child.parentElement = this; this.children.push(child); return child; }
  append(...children: Element[]): void { children.forEach(child => this.appendChild(child)); }
  replaceChildren(...children: Element[]): void {
    this.ownText = '';
    this.children.forEach(child => { child.parentElement = null; });
    this.children.splice(0); this.append(...children);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = value;
  }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  closest(): null { return null; }
  click(): void { this.onclick?.(); }
  querySelectorAll(): Element[] { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
}

let root: Element | null = null;
const { state } = await import('../src/state.js');
const { configUndo, configRedo, inspectConfigDraftState, renderConfig, resetConfigSession,
  saveDirtyConfigSections, editStageConfigDraft, saveStageConfigDraftUnlocked } = await import('../src/panels/config.js');
const { runProjectWriteOperation } = await import('../src/project-io.js');

function text(label: string): Element {
  const found = root?.querySelectorAll().find(element => element.textContent === label);
  if (!found) throw new Error(`Missing control: ${label}`);
  return found;
}
function field(label: string): Element {
  const found = root?.querySelectorAll().find(element => element.getAttribute('aria-label') === label);
  if (!found) throw new Error(`Missing field: ${label}`);
  return found;
}
function input(label: string, value: string): void { const element = field(label); element.value = value; element.oninput?.(); }

async function fixture(characters: Record<string, unknown> = {}) {
  let disk = JSON.stringify({ title: 'Save history', entryScene: 'start', characters,
    variables: { trust: { type: 'number', initial: 0 } }, privateField: { retain: true } });
  const writes: string[] = [];
  const handle = {
    getFile: async () => new File([disk], 'game.config.json'),
    createWritable: async () => ({ write: async (value: unknown) => { disk = String(value); writes.push(disk); }, close: async () => {} }),
  } as unknown as FileSystemFileHandle;
  const directory = { name: 'save-history-project', resolve: async () => ['game.config.json'],
    getFileHandle: async () => handle } as unknown as FileSystemDirectoryHandle;
  Object.assign(state, {
    configReadErrors: {}, pendingSceneConfigWrites: [], pendingSceneConfigRenames: [],
    dirHandle: directory, projectLoading: false, reviewWorkspace: null, reviewPreviewReadOnly: false,
    dirAssets: [], timelines: [], gameConfigText: disk,
    scenes: new Map([['start', { id: 'start', file: 'start.gal', text: '@scene start\n@end\n', eol: '\n', dirty: false, handle: null }]]),
    configFiles: { achievements: null, calendar: null, growth: null, events: null, gallery: null, terminology: null },
    handles: { gameConfig: handle, achievements: null, calendar: null, events: null, growth: null, gallery: null, terminology: null },
  });
  root = new Element('section'); root.id = 'config-view';
  renderConfig(root as unknown as HTMLElement);
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  return { read: () => JSON.parse(disk), writes };
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag),
    getElementById: (id: string) => id === 'config-view' ? root : null });
  resetConfigSession();
});
afterEach(() => { root = null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('saved config source and undoable section drafts', () => {
  it.each(['none', 'undo', 'redo'] as const)('keeps a saved new character through %s before a variable-only save', async history => {
    const disk = await fixture();
    field('新角色标识').value = 'new_char'; field('新角色显示名称').value = '新角色';
    text('添加角色').click();
    expect(inspectConfigDraftState().dirtySections).toEqual(['characters']);
    expect(await runProjectWriteOperation(saveDirtyConfigSections)).toEqual({ saved: 1, failures: 0, remainingDirty: false });
    if (history !== 'none') configUndo();
    if (history === 'redo') configRedo();
    expect(field('new_char 的显示名称').value).toBe('新角色');
    expect(inspectConfigDraftState().dirtySections).toEqual([]);
    input('初始值，第 1 行', '7');
    expect(inspectConfigDraftState().dirtySections).toEqual(['variables']);
    expect(await runProjectWriteOperation(saveDirtyConfigSections)).toEqual({ saved: 1, failures: 0, remainingDirty: false });
    expect(disk.read().characters.new_char?.name).toBe('新角色');
    expect(disk.read().variables.trust.initial).toBe(7);
    expect(disk.read().privateField).toEqual({ retain: true });
    expect(disk.writes).toHaveLength(2);
  });

  it('does not publish an undone character-name draft when only variables are saved', async () => {
    const disk = await fixture({ rin: { name: '凛' } });
    input('rin 的显示名称', '新名字');
    expect(await runProjectWriteOperation(saveDirtyConfigSections)).toEqual({ saved: 1, failures: 0, remainingDirty: false });
    configUndo();
    expect(field('rin 的显示名称').value).toBe('凛');
    expect(inspectConfigDraftState().dirtySections).toEqual(['characters']);
    input('初始值，第 1 行', '7');
    text('保存变量表').click();
    await vi.waitFor(() => expect(disk.read().variables.trust.initial).toBe(7));
    expect(disk.read().characters.rin.name).toBe('新名字');
    expect(inspectConfigDraftState().dirtySections).toEqual(['characters']);
  });

  it('saves stage against the completed variable save while its old row value remains an unsaved draft', async () => {
    const disk = await fixture();
    input('初始值，第 1 行', '7');
    expect(await runProjectWriteOperation(saveDirtyConfigSections)).toMatchObject({ saved: 1, failures: 0 });
    configUndo();
    expect(inspectConfigDraftState().dirtySections).toEqual(['variables']);
    editStageConfigDraft(JSON.stringify({ version: 1, design: { width: 1920, height: 1080 } }));
    await expect(runProjectWriteOperation(saveStageConfigDraftUnlocked)).resolves.toBeDefined();
    expect(disk.read().variables.trust.initial).toBe(7);
    expect(disk.read().stage.design).toEqual({ width: 1920, height: 1080 });
    expect(inspectConfigDraftState().dirtySections).toEqual(['variables']);
  });
});
