import type { ContentHistorySummary, ContentHistoryComparison } from '@surdet/authoring';
import { state, h } from '../state.js';
import { editorHistoryClient } from '../editor-workspace.js';
import { prepareHistoryFileDraft } from '../content-history-draft.js';
import { changedLines, textLines } from '../line-diff.js';

export function renderContentHistoryPanel(container: HTMLElement, options: { assertReady: () => void; onRestored: () => void }): void {
  container.className = 'content-history';
  container.append(h('h1', undefined, '内容历史'), h('p', 'dim', '为已保存的剧本、时间轴和配置记下一个版本，查看差异后恢复到草稿。素材文件不包含在这里。'));
  const client = editorHistoryClient(state.dirHandle);
  if (client === null) {
    const empty = h('section', 'content-history-empty');
    empty.append(h('h2', undefined, '尚未连接内容历史'), h('p', undefined, '请从项目启动器打开并连接项目，使用内容历史。'));
    container.append(empty); return;
  }
  const root = state.dirHandle;
  const status = h('p'); status.setAttribute('role', 'status');
  const label = h('input'); label.placeholder = '版本名称，例如：第一章定稿'; label.setAttribute('aria-label', '版本名称'); label.maxLength = 200;
  const checkpoint = h('button', 'v4-button', '记录已保存版本');
  const refresh = h('button', 'v4-button', '刷新');
  const toolbar = h('div', 'content-history-toolbar'); toolbar.append(label, checkpoint, refresh);
  const list = h('nav', 'content-history-versions'); list.setAttribute('aria-label', '历史版本');
  const detail = h('div', 'content-history-detail');
  const workspace = h('div', 'content-history-workspace'); workspace.append(list, detail);
  container.append(toolbar, status, workspace);
  let revision = '', requestSequence = 0, busy = false;
  let selected: ContentHistorySummary | null = null;
  const current = () => container.isConnected && state.dirHandle === root;
  const ready = () => { if (!current()) throw new Error('项目已经切换'); client.assertCurrent(); options.assertReady(); };
  const report = (error: unknown) => { if (current()) status.textContent = error instanceof Error ? error.message : String(error); };
  const setBusy = (value: boolean) => { busy = value; checkpoint.disabled = value; refresh.disabled = value; };

  const showFile = async (summary: ContentHistorySummary, comparison: ContentHistoryComparison, path: string, target: HTMLElement) => {
    const sequence = ++requestSequence;
    const full = await client.compare({ checkpointId: summary.checkpointId, expectedFingerprint: summary.fingerprint, path });
    if (!current() || sequence !== requestSequence) return;
    if (full.contentRevision !== comparison.contentRevision) throw new Error('当前内容已变化，请重新选择版本查看差异');
    const file = full.files[0]!;
    target.replaceChildren();
    const before = h('section'), after = h('section');
    const currentLines = file.currentText == null ? null : textLines(file.currentText);
    const historicalLines = file.historicalText == null ? null : textLines(file.historicalText);
    const marks = changedLines(currentLines ?? [], historicalLines ?? []);
    before.append(h('h3', undefined, '当前已保存'), numberedLines(currentLines, marks.left, '（当前没有这个文件）'));
    after.append(h('h3', undefined, '历史版本'), numberedLines(historicalLines, marks.right, '（此版本没有这个文件）'));
    const columns = h('div', 'content-history-diff'); columns.append(before, after);
    const restore = h('button', 'v4-button v4-primary', '恢复这个文件为草稿');
    restore.disabled = file.historicalText === null || file.currentSha256 === file.historicalSha256;
    restore.onclick = async () => {
      if (busy) return;
      setBusy(true); restore.disabled = true;
      try {
        ready();
        const fresh = await client.compare({ checkpointId: summary.checkpointId, expectedFingerprint: summary.fingerprint, path });
        if (fresh.contentRevision !== full.contentRevision) throw new Error('文件已在查看差异后变化，请重新查看差异');
        const apply = await prepareHistoryFileDraft(fresh.files[0]!);
        ready();
        if (sequence !== requestSequence) throw new Error('选择已变化，请重新查看差异');
        apply();
        options.onRestored();
      } catch (error) { report(error); restore.disabled = false; }
      finally { setBusy(false); }
    };
    const cancel = h('button', 'v4-button', '取消');
    cancel.onclick = () => { requestSequence++; target.replaceChildren(); };
    const actions = h('div', 'content-history-actions'); actions.append(restore, cancel);
    target.append(h('h3', 'content-history-file-title', path), columns, actions);
  };

  const select = async (summary: ContentHistorySummary) => {
    if (busy) return;
    const sequence = ++requestSequence;
    selected = summary;
    const comparison = await client.compare({ checkpointId: summary.checkpointId, expectedFingerprint: summary.fingerprint });
    if (!current() || sequence !== requestSequence) return;
    status.textContent = '';
    for (const item of list.querySelectorAll<HTMLButtonElement>('button')) item.setAttribute('aria-current', String(item.dataset.checkpointId === summary.checkpointId));
    detail.replaceChildren(h('h2', undefined, summary.label),
      h('p', 'dim content-history-meta', `${new Date(summary.createdAt).toLocaleString('zh-CN')} · ${summary.fileCount} 个文件`));
    const fileList = h('div', 'content-history-files'), fileDetail = h('div');
    for (const file of comparison.files) {
      if (file.currentSha256 === file.historicalSha256) continue;
      const change = file.historicalSha256 === null ? 'added' : file.currentSha256 === null ? 'removed' : 'modified';
      const button = h('button', 'v4-button content-history-file');
      button.setAttribute('aria-pressed', 'false');
      button.append(h('span', 'content-history-file-path', file.path),
        h('span', `content-history-file-status content-history-file-status--${change}`, { added: '当前新增，保留', removed: '可找回', modified: '有修改' }[change]));
      button.onclick = () => {
        if (busy) return;
        for (const item of fileList.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
        void showFile(summary, comparison, file.path, fileDetail).catch(report);
      };
      fileList.append(button);
    }
    if (fileList.childElementCount === 0) fileList.append(h('p', 'dim', '当前已保存内容与这个版本一致。'));
    detail.append(fileList, fileDetail);
  };

  const load = async () => {
    const index = await client.list();
    if (!current()) return;
    revision = index.contentRevision;
    list.replaceChildren();
    for (const summary of index.checkpoints) {
      const button = h('button', 'v4-button');
      button.dataset.checkpointId = summary.checkpointId;
      button.setAttribute('aria-current', 'false');
      button.append(h('strong', undefined, summary.label), h('span', 'dim', `${new Date(summary.createdAt).toLocaleString('zh-CN')} · ${summary.fileCount} 个文件`));
      button.onclick = () => { void select(summary).catch(report); };
      list.append(button);
    }
    if (index.checkpoints.length === 0) list.append(h('p', 'dim', '还没有手动记录的版本。'));
    if (selected) {
      const refreshed = index.checkpoints.find(item => item.checkpointId === selected!.checkpointId);
      if (refreshed) await select(refreshed);
    }
  };
  checkpoint.onclick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      ready();
      if (!label.value.trim()) throw new Error('请先填写版本名称');
      await client.checkpoint({ operationId: crypto.randomUUID(), label: label.value.trim(), expectedContentRevision: revision });
      if (current()) { label.value = ''; status.textContent = '已记录当前保存版本。'; }
      await load();
    } catch (error) { report(error); }
    finally { setBusy(false); }
  };
  refresh.onclick = () => { if (!busy) { requestSequence++; void load().catch(report); } };
  void load().catch(report);
}

/** Numbered lines; lines outside the order-preserving common part are marked. Display only. */
function numberedLines(lines: readonly string[] | null, changed: readonly boolean[], missing: string): HTMLElement {
  const pre = h('pre');
  if (lines === null) { pre.textContent = missing; return pre; }
  lines.forEach((line, index) => {
    const row = h('span', changed[index] ? 'content-history-line is-changed' : 'content-history-line', line);
    row.dataset.line = String(index + 1);
    pre.append(row);
  });
  return pre;
}
