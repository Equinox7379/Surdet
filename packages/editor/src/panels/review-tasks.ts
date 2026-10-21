import type { PreparedReviewContent } from '@surdet/authoring';
import { AssetImportClientError, type ReviewTaskList, type ReviewTaskSummary } from '../asset-import-client.js';
import { editorReviewTaskClient } from '../editor-workspace.js';
import { readOnlyReviewDirectory } from '../review-content-directory.js';
import { hasPendingReviewReceipt, hasReviewDraft, reviewDecisionDraftKey, type ReviewWorkspaceState } from '../review-workspace.js';
import { openReviewPanelWorkspace } from './review-panel.js';
import { state, h } from '../state.js';

/**
 * Discovery for the bound project's review directory. The list is a hint to
 * look: opening a task still goes through the normal review loader, terminal
 * checks and switching protections, and a receipt file is never shown as an
 * approval.
 */
type DiscoveryStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';
let discovery: { root: FileSystemDirectoryHandle | null; status: DiscoveryStatus; list: ReviewTaskList | null; message: string } =
  { root: null, status: 'idle', list: null, message: '' };
let sequence = 0;
let opening: string | null = null;

const KIND_LABELS = { comparison: '候选方案校对', 'integration-result': '最终结果校对' } as const;
const RECEIPT_LABELS: Record<string, string> = {
  'decision.json': '创作决定', 'final-approval.json': '批准回执', 'return-request.json': '退回回执',
};
const UNAVAILABLE_REASONS: Record<string, string> = {
  REVIEW_IDENTITY_MISMATCH: '身份记录、正文或回执与目录不一致',
  CHANGE_STORE_CORRUPT: '身份记录已损坏',
  REVIEW_FORMAT_UNSUPPORTED: '审阅格式不受支持',
  PATH_OUTSIDE_PROJECT: '目录是链接或路径不安全',
  INVALID_REQUEST: '目录名称不是有效的审阅编号',
};

function currentList(): ReviewTaskList | null {
  return discovery.root !== null && discovery.root === state.dirHandle ? discovery.list : null;
}

export function reviewTaskPendingCount(): number {
  return currentList()?.pendingCount ?? 0;
}

/** Re-read the directory; late answers after a project switch or a newer refresh are dropped. */
export function refreshReviewTasks(onChanged: () => void): void {
  const root = state.dirHandle;
  const client = editorReviewTaskClient(root);
  const id = ++sequence;
  if (client === null) {
    discovery = { root, status: 'idle', list: null, message: '' };
    onChanged();
    return;
  }
  discovery = { root, status: 'loading', list: currentList(), message: '' };
  onChanged();
  void client.tasks().then((list) => {
    if (id !== sequence || state.dirHandle !== root) return;
    discovery = { root, status: 'ready', list, message: '' };
    onChanged();
  }, (error: unknown) => {
    if (id !== sequence || state.dirHandle !== root) return;
    // An older local service answers unknown routes with INVALID_REQUEST; keep the picker entry only.
    discovery = error instanceof AssetImportClientError && error.code === 'INVALID_REQUEST'
      ? { root, status: 'unsupported', list: null, message: '' }
      : { root, status: 'error', list: discovery.list, message: error instanceof Error ? error.message : String(error) };
    onChanged();
  });
}

const SOURCE_CLOSED = '预览结果时来源项目已暂时关闭，无法读取正式目录。请先回到来源项目，再检查或批准。';

interface TaskSource { root: FileSystemDirectoryHandle; key: string; read(path: string, kind: 'file' | 'directory'): Promise<PreparedReviewContent> }
const taskSources = new WeakMap<FileSystemDirectoryHandle, TaskSource>();
let previewSequence = 0;

/**
 * The formal review directory of a listed task. Every read goes to the current
 * files through the binding that listed it, so loading, "检查探索修改", reload and
 * the pre-approval re-check always see what is on disk now. With that binding
 * closed a read fails; nothing answers from an earlier copy.
 */
export function reviewTaskDirectory(root: FileSystemDirectoryHandle, projectIdentity: string, reviewId: string): FileSystemDirectoryHandle {
  const read = async (path: string, kind: 'file' | 'directory'): Promise<PreparedReviewContent> => {
    const client = editorReviewTaskClient(root);
    if (client === null) throw new DOMException(SOURCE_CLOSED, 'InvalidStateError');
    try { return await client.content({ reviewId, kind, path }); }
    catch (error) {
      if (error instanceof AssetImportClientError && error.code === 'OBJECT_NOT_FOUND') throw new DOMException('审阅内容不存在', 'NotFoundError');
      throw error;
    }
  };
  const key = `${projectIdentity}/${reviewId}/task`;
  const directory = readOnlyReviewDirectory({ key, rootName: reviewId, readonlyMessage: '审阅内容为只读；决定与回执通过本机审阅服务保存。', read });
  taskSources.set(directory, { root, key, read });
  return directory;
}

/**
 * A display copy of a listed result for the preview loader only. Each preview
 * starts empty and keeps what it read while the source was still bound, so the
 * preview keeps its pictures and sounds after the Editor swaps to it. Checks and
 * approval never use it; they keep reading the formal directory above.
 */
export function reviewTaskPreviewDirectory(workspace: ReviewWorkspaceState): FileSystemDirectoryHandle | null {
  const source = taskSources.get(workspace.rootHandle);
  if (source === undefined || workspace.identity.kind !== 'integration-result') return null;
  const copy = new Map<string, Promise<PreparedReviewContent>>();
  const read = (path: string, kind: 'file' | 'directory'): Promise<PreparedReviewContent> => {
    const entry = `${kind}:${path}`;
    let pending = copy.get(entry);
    if (pending === undefined) {
      pending = source.read(path ? `result/project/${path}` : 'result/project', kind);
      copy.set(entry, pending);
      pending.catch(() => copy.delete(entry));
    }
    return pending;
  };
  return readOnlyReviewDirectory({ key: `${source.key}/preview/${++previewSequence}`, rootName: 'project', readonlyMessage: '结果预览是只读副本。', read });
}

/** True while a listed review cannot reach its formal directory, e.g. during its result preview. */
export function reviewTaskSourceClosed(workspace: ReviewWorkspaceState | null): boolean {
  const source = workspace === null ? undefined : taskSources.get(workspace.rootHandle);
  return source !== undefined && editorReviewTaskClient(source.root) === null;
}

function draftKey(workspace: ReviewWorkspaceState | null): string | null {
  return workspace === null || !hasReviewDraft(workspace) || hasPendingReviewReceipt(workspace)
    ? null : reviewDecisionDraftKey(workspace.decisionDraft);
}

/**
 * Opens a listed task with the shared review loader. An unsaved decision is
 * confirmed before reading, and again right before the switch if it changed
 * while the task was being read; declining keeps the current review as it is.
 */
export async function openListedReviewTask(
  open: (() => Promise<FileSystemDirectoryHandle>) | undefined,
  confirm: (message: string) => boolean,
): Promise<boolean> {
  const before = state.reviewWorkspace, confirmed = draftKey(before);
  if (confirmed !== null && !confirm('当前审阅还有未保存的决定。打开其他任务会丢弃这些修改，确定继续吗？')) return false;
  return openReviewPanelWorkspace(open, (current) => {
    const latest = draftKey(current);
    return latest === null || (current === before && latest === confirmed)
      || confirm('读取期间当前审阅有了新的修改。打开其他任务会丢弃这些修改，确定继续吗？');
  });
}

function sameTask(workspace: ReviewWorkspaceState | null, list: ReviewTaskList, task: ReviewTaskSummary): boolean {
  return workspace !== null && workspace.identity.reviewId === task.reviewId && workspace.identity.projectIdentity === list.projectIdentity;
}

function taskNote(task: ReviewTaskSummary): string {
  if (task.status === 'receipt-present') {
    const names = task.receiptFiles.map(file => `${RECEIPT_LABELS[file] ?? file}（${file}）`).join('、');
    return `存在${names}文件。打开后由审阅服务核对是否有效；这不表示已经批准或写回。`;
  }
  if (task.status === 'unavailable') {
    return `${UNAVAILABLE_REASONS[task.errorCode ?? ''] ?? '无法核对'}（${task.errorCode}）。条目保留，不会自动删除。`;
  }
  return '尚无回执。正文能否通过审阅，打开后核对。';
}

const STATUS_LABELS: Record<ReviewTaskSummary['status'], string> = {
  pending: '待审阅', 'receipt-present': '有回执文件', unavailable: '无法读取',
};

/**
 * Returns null when the project is not bound or the local service predates
 * discovery, so the caller keeps its original empty state and picker entry.
 */
export function renderReviewTaskList(options: {
  workspace: ReviewWorkspaceState | null;
  onOpen(task: ReviewTaskSummary, open: () => Promise<FileSystemDirectoryHandle>): Promise<void>;
  onRefresh(): void;
  /** Called once an open attempt has settled, so the list can render without its busy state. */
  onSettled(): void;
  /** Reopens the source project so a listed review can read its formal directory again. */
  onReturnToSource(): Promise<void>;
}): HTMLElement | null {
  if (options.workspace !== null && reviewTaskSourceClosed(options.workspace)) {
    const notice = h('div', 'review-discovery review-discovery--compact review-discovery-notice');
    notice.setAttribute('role', 'status');
    notice.appendChild(h('span', undefined, '正在预览结果副本，来源项目已暂时关闭。检查探索修改或批准前，请先回到来源项目。'));
    const back = h('button', 'primary', '回到来源项目');
    back.type = 'button';
    back.onclick = () => {
      back.disabled = true;
      back.textContent = '正在返回…';
      void options.onReturnToSource();
    };
    notice.appendChild(back);
    return notice;
  }
  const list = currentList();
  if (discovery.root !== state.dirHandle || discovery.status === 'idle' || discovery.status === 'unsupported') return null;
  const compact = options.workspace !== null;
  const section = h(compact ? 'details' : 'section', compact ? 'review-discovery review-discovery--compact' : 'review-discovery');
  section.setAttribute('aria-label', '当前项目的审阅任务');
  const pending = list?.pendingCount ?? 0;
  const summaryText = list === null ? '正在读取当前项目的审阅任务…'
    : pending > 0 ? `${pending} 个待审阅` : list.tasks.length > 0 ? '没有待审阅任务' : '当前项目没有审阅任务';
  const header = h(compact ? 'summary' : 'header', 'review-discovery-header');
  const title = h('div', 'review-discovery-title');
  title.append(h(compact ? 'strong' : 'h2', undefined, '当前项目的审阅任务'), h('span', 'review-discovery-summary', summaryText));
  header.appendChild(title);
  const refresh = h('button', 'review-discovery-refresh', discovery.status === 'loading' ? '正在刷新…' : '刷新');
  refresh.type = 'button';
  refresh.disabled = discovery.status === 'loading';
  refresh.onclick = (event) => { event.preventDefault(); options.onRefresh(); };
  header.appendChild(refresh);
  section.appendChild(header);
  if (discovery.status === 'error') section.appendChild(h('p', 'review-discovery-error', `读取审阅任务失败：${discovery.message}`));
  if (list !== null && list.tasks.length > 0) {
    const items = h('ul', 'review-discovery-items');
    for (const task of list.tasks) {
      const item = h('li', 'review-discovery-item');
      item.dataset['reviewTaskStatus'] = task.status;
      item.dataset['reviewId'] = task.reviewId;
      const main = h('div', 'review-discovery-main');
      const name = h('div', 'review-discovery-name');
      name.append(h('strong', undefined, task.reviewId), h('span', 'review-discovery-kind', task.kind === null ? '类型未知' : KIND_LABELS[task.kind]));
      main.append(name, h('p', 'review-discovery-note', taskNote(task)));
      const status = h('span', `review-discovery-status review-discovery-status--${task.status}`, STATUS_LABELS[task.status]);
      item.append(main, status);
      if (sameTask(options.workspace, list, task)) {
        item.setAttribute('aria-current', 'true');
        item.appendChild(h('span', 'review-discovery-current', '正在查看'));
      } else if (task.status !== 'unavailable') {
        const open = h('button', task.status === 'pending' ? 'review-discovery-open primary' : 'review-discovery-open',
          task.status === 'pending' ? '打开审阅' : '打开核对');
        open.type = 'button';
        open.disabled = opening !== null;
        open.setAttribute('aria-label', `${task.status === 'pending' ? '打开审阅' : '打开核对'} ${task.reviewId}`);
        open.onclick = () => {
          const root = state.dirHandle;
          if (opening !== null || root === null) return;
          opening = task.reviewId;
          for (const button of items.querySelectorAll<HTMLButtonElement>('.review-discovery-open')) button.disabled = true;
          open.textContent = '正在打开…';
          void options.onOpen(task, async () => {
            if (state.dirHandle !== root) throw new Error('项目已经切换，未打开审阅任务。');
            return reviewTaskDirectory(root, list.projectIdentity, task.reviewId);
          })
            .catch(() => undefined)
            .finally(() => { opening = null; options.onSettled(); });
        };
        item.appendChild(open);
      }
      items.appendChild(item);
    }
    section.appendChild(items);
  } else if (list !== null && !compact) {
    section.appendChild(h('p', 'review-discovery-empty', '外部 Agent 交付候选或最终结果后会出现在这里。'));
  }
  if (!compact) section.appendChild(h('p', 'review-discovery-footnote', '列表只用于发现任务；决定、批准与写回仍以打开后的审阅页为准。其他目录可用顶栏“打开审阅任务”选择。'));
  return section;
}
