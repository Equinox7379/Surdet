import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TimelineAutosaveRestoreConflict } from '../src/project-io.js';
import { renderTimelineAutosaveConflictPanel } from '../src/panels/timeline-autosave-conflicts.js';

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  className = '';
  disabled = false;
  hidden = false;
  open = false;
  type = '';
  value = '';
  private ownText = '';
  onclick: (() => void) | null = null;

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

  get directTextContent(): string {
    return this.ownText;
  }

  get childElementCount(): number {
    return this.children.length;
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
    if (!this.disabled) this.onclick?.();
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const attribute = /^\[data-([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    const match = (element: FakeElement): boolean => {
      if (selector === 'button') return element.tagName === 'BUTTON';
      if (selector === 'details') return element.tagName === 'DETAILS';
      if (selector === 'input') return element.tagName === 'INPUT';
      if (selector === 'section') return element.tagName === 'SECTION';
      if (attribute === null) return false;
      const value = element.getAttribute(`data-${attribute[1]}`);
      return value !== null && (attribute[2] === undefined || value === attribute[2]);
    };
    const visit = (element: FakeElement): void => {
      if (match(element)) found.push(element);
      for (const child of element.children) visit(child);
    };
    visit(this);
    return found;
  }
}

function textOf(element: FakeElement): string {
  const visible = (current: FakeElement): string => {
    if (current.tagName === 'DETAILS' && !current.open) {
      return current.children.slice(0, 1).map(visible).join('');
    }
    return current.directTextContent + current.children.map(visible).join('');
  };
  return visible(element);
}

const documentStub = {
  createElement: (tag: string) => new FakeElement(tag),
};

function identity(
  id: string,
  file: string,
  definitionId: string | null,
  parseError: string | null = null,
  canonical = true,
) {
  return {
    stableId: id,
    file,
    fileId: file.replace(/^.*\//, '').replace(/\.json$/, ''),
    definitionId,
    parseError,
    canonical,
  };
}

function conflict(overrides: Partial<TimelineAutosaveRestoreConflict> = {}): TimelineAutosaveRestoreConflict {
  const current = {
    id: 'opening',
    file: 'nested/opening.json',
    text: '{"id":"opening","tracks":[]}',
    eol: '\n' as const,
  };
  const recovered = {
    id: 'backup-opening',
    file: 'nested/opening.json',
    text: '{"id":"backup-opening","tracks":[{"name":"backup"}]}',
    eol: '\n' as const,
  };
  return {
    key: 'backup-opening\u0000nested/opening.json\u00000',
    reason: 'same-file-different-id',
    recovered,
    recoveredIdentity: identity('backup-opening', recovered.file, 'backup-opening', null, false),
    current,
    currentIdentity: identity('opening', current.file, 'opening'),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('timeline autosave conflict panel', () => {
  it('leaves an empty host when there are no conflicts', () => {
    vi.stubGlobal('document', documentStub);
    const container = new FakeElement('div');

    renderTimelineAutosaveConflictPanel(container as unknown as HTMLElement, [], {
      onReplaceCurrent: vi.fn(),
      onSaveAsNew: vi.fn(),
      onDiscard: vi.fn(),
      onDownload: vi.fn(),
    });

    expect(container.childElementCount).toBe(0);
    expect(container.textContent).toBe('');
  });

  it('renders Chinese identity fields, stable hooks, and collapsed technical evidence', () => {
    vi.stubGlobal('document', documentStub);
    const container = new FakeElement('div');
    const item = conflict();

    renderTimelineAutosaveConflictPanel(container as unknown as HTMLElement, [item], {
      onReplaceCurrent: vi.fn(),
      onSaveAsNew: vi.fn(),
      onDiscard: vi.fn(),
      onDownload: vi.fn(),
    });

    expect(textOf(container)).toContain('演出备份需要处理');
    expect(textOf(container)).toContain('当前项目');
    expect(textOf(container)).toContain('自动备份');
    expect(textOf(container)).toContain('nested/opening.json');
    expect(textOf(container)).toContain('opening');
    expect(textOf(container)).toContain('backup-opening');
    expect(textOf(container)).toContain('同一文件对应了不同名称');
    expect(textOf(container)).not.toContain('same-file-different-id');

    const card = container.querySelector('[data-conflict-key="backup-opening\u0000nested/opening.json\u00000"]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-conflict-reason')).toBe('same-file-different-id');
    const technical = card?.querySelector('details');
    expect(technical?.open).toBe(false);
    expect(textOf(card!)).not.toContain(item.recovered.text);
    technical!.open = true;
    expect(textOf(card!)).toContain(item.recovered.text);
  });

  it('offers repair actions only when safe and confirms replace/discard', () => {
    vi.stubGlobal('document', documentStub);
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const container = new FakeElement('div');
    const onReplaceCurrent = vi.fn();
    const onSaveAsNew = vi.fn();
    const onDiscard = vi.fn();
    const onDownload = vi.fn();
    const item = conflict();

    renderTimelineAutosaveConflictPanel(container as unknown as HTMLElement, [item], {
      onReplaceCurrent,
      onSaveAsNew,
      onDiscard,
      onDownload,
    });

    const replace = container.querySelector('[data-conflict-action="replace-current"]');
    const saveAsNew = container.querySelector('[data-conflict-action="save-as-new"]');
    const discard = container.querySelector('[data-conflict-action="discard"]');
    const download = container.querySelector('[data-conflict-action="download"]');
    const input = container.querySelector('input');
    expect(replace?.disabled).toBe(false);
    expect(saveAsNew?.disabled).toBe(false);
    expect(discard?.disabled).toBe(false);
    expect(download?.disabled).toBe(false);
    for (const button of [replace, saveAsNew, discard, download]) {
      expect(button?.type).toBe('button');
      expect(button?.getAttribute('type')).toBe('button');
    }

    input!.value = 'restored-opening';
    replace!.click();
    saveAsNew!.click();
    discard!.click();
    download!.click();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onReplaceCurrent).toHaveBeenCalledWith(item.key);
    expect(onSaveAsNew).toHaveBeenCalledWith(item.key, 'restored-opening');
    expect(onDiscard).toHaveBeenCalledWith(item.key);
    expect(onDownload).toHaveBeenCalledWith(item.key);

    confirm.mockReturnValue(false);
    replace!.click();
    discard!.click();
    expect(onReplaceCurrent).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('keeps invalid JSON recoverable through download/discard only', () => {
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('confirm', vi.fn(() => true));
    const container = new FakeElement('div');
    const onReplaceCurrent = vi.fn();
    const onSaveAsNew = vi.fn();
    const onDiscard = vi.fn();
    const onDownload = vi.fn();
    const item = conflict({
      key: 'broken\u0000nested/broken.json\u00001',
      reason: 'recovered-json-invalid',
      recovered: {
        id: 'broken',
        file: 'nested/broken.json',
        text: '{broken json',
        eol: '\n',
      },
      recoveredIdentity: identity('broken', 'nested/broken.json', null, 'JSON 解析失败', false),
      current: null,
      currentIdentity: null,
    });

    renderTimelineAutosaveConflictPanel(container as unknown as HTMLElement, [item], {
      onReplaceCurrent,
      onSaveAsNew,
      onDiscard,
      onDownload,
    });

    const replace = container.querySelector('[data-conflict-action="replace-current"]');
    const saveAsNew = container.querySelector('[data-conflict-action="save-as-new"]');
    const discard = container.querySelector('[data-conflict-action="discard"]');
    const download = container.querySelector('[data-conflict-action="download"]');
    expect(replace?.disabled).toBe(true);
    expect(saveAsNew?.disabled).toBe(true);
    expect(discard?.disabled).toBe(false);
    expect(download?.disabled).toBe(false);
    replace!.click();
    saveAsNew!.click();
    discard!.click();
    download!.click();
    expect(onReplaceCurrent).not.toHaveBeenCalled();
    expect(onSaveAsNew).not.toHaveBeenCalled();
    expect(onDiscard).toHaveBeenCalledWith(item.key);
    expect(onDownload).toHaveBeenCalledWith(item.key);
    expect(textOf(container)).toContain('自动备份 JSON 无法解析');
  });

  it('labels a quarantined backup without exposing the machine reason', () => {
    vi.stubGlobal('document', documentStub);
    const container = new FakeElement('div');
    const item = conflict({
      key: 'quarantine\u0000nested/opening.json\u00002',
      reason: 'quarantined-backup' as TimelineAutosaveRestoreConflict['reason'],
    });

    renderTimelineAutosaveConflictPanel(container as unknown as HTMLElement, [item], {
      onReplaceCurrent: vi.fn(),
      onSaveAsNew: vi.fn(),
      onDiscard: vi.fn(),
      onDownload: vi.fn(),
    });

    expect(textOf(container)).toContain('这份备份此前发生过身份冲突，需要重新确认');
    expect(textOf(container)).not.toContain('quarantined-backup');
    expect(container.querySelector('[data-conflict-reason="quarantined-backup"]')).not.toBeNull();
  });
});
