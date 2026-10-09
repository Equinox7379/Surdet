import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreparedReviewContent } from '@surdet/authoring';
import { AssetImportClientError, type ReviewTaskList, type ReviewTaskSummary } from '../src/asset-import-client.js';
import type { ReviewWorkspaceState } from '../src/review-workspace.js';

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  className = '';
  type = '';
  disabled = false;
  open = false;
  onclick: ((event: { preventDefault(): void }) => void) | null = null;
  private ownText = '';
  constructor(readonly tagName: string) {}
  set textContent(value: string) { this.ownText = value; this.children.splice(0); }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
  append(...children: FakeElement[]): void { this.children.push(...children); }
  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  all(): FakeElement[] { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelectorAll(selector: string): FakeElement[] {
    const name = selector.replace(/^\./, '');
    return this.all().filter(element => element.className.split(' ').includes(name));
  }
  click(): void { this.onclick?.({ preventDefault() {} }); }
}

const client = vi.hoisted(() => ({
  tasks: vi.fn<() => Promise<ReviewTaskList>>(),
  content: vi.fn<(input: { reviewId: string; kind: 'file' | 'directory'; path: string }) => Promise<PreparedReviewContent>>(),
  bound: true,
}));
vi.mock('../src/editor-workspace.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/editor-workspace.js')>(),
  editorReviewTaskClient: () => client.bound ? client : null,
}));

const { state } = await import('../src/state.js');
const { refreshReviewTasks, renderReviewTaskList, reviewTaskPendingCount, reviewTaskPreviewDirectory, reviewTaskSourceClosed } = await import('../src/panels/review-tasks.js');

const list: ReviewTaskList = { projectIdentity: 'a'.repeat(32), pendingCount: 1, tasks: [
  { reviewId: 'broken', kind: null, status: 'unavailable', receiptFiles: [], errorCode: 'CHANGE_STORE_CORRUPT' },
  { reviewId: 'compare', kind: 'comparison', status: 'receipt-present', receiptFiles: ['decision.json'] },
  { reviewId: 'result', kind: 'integration-result', status: 'pending', receiptFiles: [] },
] };
const root = {} as FileSystemDirectoryHandle;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

type OpenTask = (task: ReviewTaskSummary, open: () => Promise<FileSystemDirectoryHandle>) => Promise<void>;

function render(onOpen: OpenTask = async () => {}, workspace: ReviewWorkspaceState | null = null, onReturnToSource = async () => {}) {
  return renderReviewTaskList({ workspace, onOpen, onRefresh: () => {}, onSettled: () => {}, onReturnToSource }) as unknown as FakeElement | null;
}

function row(section: FakeElement, reviewId: string): FakeElement {
  return section.all().find(element => element.dataset['reviewId'] === reviewId)!;
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: (tag: string) => new FakeElement(tag) });
  state.dirHandle = root;
  client.bound = true;
  client.tasks.mockReset().mockResolvedValue(structuredClone(list));
  client.content.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); state.dirHandle = null; });

describe('current-project review task list', () => {
  it('never presents a receipt file as an approval and offers no open for unreadable entries', async () => {
    refreshReviewTasks(() => {}); await settle();
    expect(reviewTaskPendingCount()).toBe(1);
    const section = render()!;
    const receipt = row(section, 'compare');
    expect(receipt.textContent).toContain('有回执文件');
    expect(receipt.textContent).toContain('这不表示已经批准或写回');
    expect(receipt.textContent.replace('这不表示已经批准或写回', '')).not.toMatch(/已批准|已经批准|已写回/);
    expect(receipt.all().find(element => element.tagName === 'button')?.textContent).toBe('打开核对');
    expect(row(section, 'result').all().find(element => element.tagName === 'button')?.textContent).toBe('打开审阅');
    const broken = row(section, 'broken');
    expect(broken.textContent).toContain('CHANGE_STORE_CORRUPT');
    expect(broken.all().some(element => element.tagName === 'button')).toBe(false);
  });

  it('keeps the original empty state on a service without discovery and drops late answers after a switch', async () => {
    client.tasks.mockRejectedValueOnce(new AssetImportClientError('INVALID_REQUEST', '请求无效'));
    refreshReviewTasks(() => {}); await settle();
    expect(render()).toBeNull();
    expect(reviewTaskPendingCount()).toBe(0);
    let answer!: (value: ReviewTaskList) => void;
    client.tasks.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    refreshReviewTasks(() => {});
    state.dirHandle = {} as FileSystemDirectoryHandle;
    answer(structuredClone(list)); await settle();
    expect(reviewTaskPendingCount()).toBe(0);
    client.bound = false;
    refreshReviewTasks(() => {});
    expect(render()).toBeNull();
  });

  it('reads the formal directory live for every check and keeps only the preview copy once the source closes', async () => {
    refreshReviewTasks(() => {}); await settle();
    const files: Record<string, PreparedReviewContent> = {
      'directory:': { kind: 'directory', entries: [{ name: 'identity.json', kind: 'file' }, { name: 'result', kind: 'directory' }] },
      'directory:result': { kind: 'directory', entries: [{ name: 'project', kind: 'directory' }] },
      'directory:result/project': { kind: 'directory', entries: [{ name: 'content', kind: 'directory' }] },
      'directory:result/project/content': { kind: 'directory', entries: [{ name: 'start.gal', kind: 'file' }] },
      'file:result/project/content/start.gal': { kind: 'file', base64: btoa('@') },
    };
    client.content.mockImplementation(async ({ kind, path }) => {
      const value = files[`${kind}:${path}`];
      if (!value) throw new AssetImportClientError('OBJECT_NOT_FOUND', '不存在');
      return structuredClone(value);
    });
    let directory: FileSystemDirectoryHandle | undefined;
    row(render(async (_task, open) => { directory = await open(); })!, 'result').all().find(element => element.tagName === 'button')!.click();
    await vi.waitFor(() => expect(directory).toBeDefined());
    expect(client.content).not.toHaveBeenCalled(); // Nothing is read ahead of the loader.
    const scene = async (project: FileSystemDirectoryHandle) =>
      (await (await (await project.getDirectoryHandle('content')).getFileHandle('start.gal')).getFile()).text();
    const project = await (await directory!.getDirectoryHandle('result')).getDirectoryHandle('project');
    await expect(directory!.getFileHandle('decision.json')).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(await scene(project)).toBe('@');
    files['file:result/project/content/start.gal'] = { kind: 'file', base64: btoa('!') }; // Changed on disk.
    expect(await scene(project)).toBe('!');
    const workspace = { rootHandle: directory, identity: { kind: 'integration-result', reviewId: 'result', projectIdentity: list.projectIdentity } } as unknown as ReviewWorkspaceState;
    const copy = reviewTaskPreviewDirectory(workspace)!;
    expect(await scene(copy)).toBe('!');
    expect(reviewTaskSourceClosed(workspace)).toBe(false);
    client.bound = false; // Previewing the result closes the source binding.
    expect(reviewTaskSourceClosed(workspace)).toBe(true);
    expect(await scene(copy)).toBe('!'); // The preview keeps what it showed...
    await expect(scene(project)).rejects.toMatchObject({ name: 'InvalidStateError' }); // ...checks never fall back to it.
    const back = vi.fn(async () => {});
    const notice = render(async () => {}, workspace, back)!;
    expect(notice.textContent).toContain('回到来源项目');
    notice.all().find(element => element.tagName === 'button')!.click();
    expect(back).toHaveBeenCalledOnce();
  });
});
