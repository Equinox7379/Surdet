import { h } from '../state.js';
import { changedLines, textLines } from '../line-diff.js';
import { flowEdgeKindLabel } from '../flow-presentation.js';
import type { FlowGraph, FlowNode } from '../graph/build.js';
import { endpointName, type FlowEdit, type FlowEditPlan, type FlowEndpoint } from '../flow-operations.js';

export interface FlowEditDialogOptions {
  node: FlowNode;
  graph: FlowGraph;
  /** Why the flow cannot be edited now, or null. */
  blocked: string | null;
  plan(edit: FlowEdit): Promise<FlowEditPlan>;
  apply(plan: FlowEditPlan): Promise<void>;
  /** Preview this edit right away (dragging one node onto another). */
  initial?: FlowEdit;
}

const EDITABLE = new Set(['goto', 'loop', 'jump', 'call', 'choice']);

export const endpointOf = (node: FlowNode): FlowEndpoint => node.kind === 'label' && node.label !== undefined ? { sceneId: node.sceneId, label: node.label } : { sceneId: node.sceneId };

/** A unified view of the change: changed lines with two lines of context, numbered as in each file. */
export function unifiedDiff(before: string | null, after: string): { mark: ' ' | '-' | '+'; line: number; text: string }[] {
  const left = before === null ? [] : textLines(before), right = textLines(after);
  const marks = changedLines(left, right);
  const rows: { mark: ' ' | '-' | '+'; line: number; text: string }[] = [];
  let i = 0, j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && marks.left[i]) { rows.push({ mark: '-', line: i + 1, text: left[i]! }); i += 1; continue; }
    if (j < right.length && marks.right[j]) { rows.push({ mark: '+', line: j + 1, text: right[j]! }); j += 1; continue; }
    rows.push({ mark: ' ', line: j + 1, text: right[j] ?? left[i]! }); i += 1; j += 1;
  }
  const keep = rows.map((row, index) => row.mark !== ' ' || rows.slice(Math.max(0, index - 2), index + 3).some(near => near.mark !== ' '));
  return rows.filter((_, index) => keep[index]);
}

let open: HTMLDialogElement | null = null;

export function openFlowEditDialog(options: FlowEditDialogOptions): void {
  open?.close();
  const { node, graph } = options;
  const here = endpointOf(node);
  const dialog = h('dialog', 'v4-insert-dialog flow-edit-dialog');
  dialog.setAttribute('aria-label', `编辑连接：${endpointName(here)}`);
  const title = h('h2', undefined, `编辑连接 · ${endpointName(here)}`);
  const status = h('p', 'flow-edit-status'); status.setAttribute('role', 'status');
  const blocked = options.blocked;
  if (blocked) status.textContent = blocked;

  const targets = graph.nodes.filter(item => item.kind === 'scene' || item.kind === 'label')
    .sort((left, right) => left.sceneId.localeCompare(right.sceneId) || (left.line ?? 0) - (right.line ?? 0));
  const targetSelect = (label: string, exclude?: string): HTMLSelectElement => {
    const select = h('select');
    select.setAttribute('aria-label', label);
    for (const item of targets) {
      if (item.id === exclude) continue;
      const option = h('option', undefined, endpointName(endpointOf(item))); option.value = item.id; select.append(option);
    }
    return select;
  };
  const endpointFor = (select: HTMLSelectElement): FlowEndpoint => endpointOf(targets.find(item => item.id === select.value)!);
  const nodeName = (id: string): string => { const target = graph.nodes.find(item => item.id === id); return target ? endpointName(endpointOf(target)) : id; };

  const preview = h('section', 'flow-edit-preview'); preview.hidden = true;
  const actions: HTMLButtonElement[] = [];
  const action = (label: string, run: () => FlowEdit): HTMLButtonElement => {
    const button = h('button', 'v4-button', label); button.type = 'button'; button.disabled = blocked !== null;
    button.onclick = () => { void show(run); };
    actions.push(button);
    return button;
  };
  const show = async (run: () => FlowEdit): Promise<void> => {
    let edit: FlowEdit;
    try { edit = run(); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); return; }
    status.textContent = '正在生成修改…';
    preview.hidden = true;
    let plan: FlowEditPlan;
    try { plan = await options.plan(edit); }
    catch (error) { status.textContent = `不能这样修改：${error instanceof Error ? error.message : String(error)}`; return; }
    if (!dialog.isConnected) return;
    status.textContent = '';
    preview.replaceChildren(h('h3', undefined, '将要修改的源码'), h('p', 'flow-edit-summary', plan.summary));
    if (plan.note) preview.append(h('p', 'flow-edit-note', plan.note));
    for (const file of plan.files) {
      const block = h('div', 'flow-edit-diff');
      block.append(h('p', 'flow-edit-file', `${file.path}${file.before === null ? '（新文件）' : ''}`));
      const list = h('ol', 'flow-edit-lines');
      for (const row of unifiedDiff(file.before, file.after)) {
        const item = h('li', `flow-edit-line flow-edit-line--${row.mark === '+' ? 'added' : row.mark === '-' ? 'removed' : 'same'}`);
        item.append(h('span', 'flow-edit-line-number', String(row.line)), h('span', 'flow-edit-line-mark', row.mark === ' ' ? '' : row.mark === '+' ? '+' : '−'), h('code', undefined, row.text));
        list.append(item);
      }
      block.append(list);
      preview.append(block);
    }
    const apply = h('button', 'v4-button v4-primary', '应用修改'); apply.type = 'button';
    const cancel = h('button', 'v4-button', '不改了'); cancel.type = 'button';
    apply.onclick = async () => {
      apply.disabled = true;
      try { await options.apply(plan); dialog.close(); }
      catch (error) { status.textContent = error instanceof Error ? error.message : String(error); apply.disabled = false; }
    };
    cancel.onclick = () => { preview.hidden = true; };
    const footer = h('footer'); footer.append(cancel, apply);
    preview.append(footer);
    preview.hidden = false;
    apply.focus();
  };

  // An option's inline @goto/@jump also compiles to a jump edge on the option's line; the option is the unit to edit.
  const optionLines = new Set(graph.edges.filter(edge => edge.from === node.id && edge.kind === 'choice' && edge.line !== undefined).map(edge => edge.line));
  const outgoing = graph.edges.filter(edge => edge.from === node.id && edge.kind !== 'flow'
    && !(edge.kind !== 'choice' && edge.line !== undefined && optionLines.has(edge.line)));
  const existing = h('section', 'flow-edit-section');
  existing.append(h('h3', undefined, '离开这里的连接'));
  if (outgoing.length === 0) existing.append(h('p', 'flow-edit-hint', '还没有连接。'));
  const list = h('ul', 'flow-edit-edges');
  for (const edge of outgoing) {
    const row = h('li', 'flow-edit-edge');
    const kind = flowEdgeKindLabel(edge.kind) + (edge.label ? `「${edge.label}」` : '');
    row.append(h('span', 'flow-edit-edge-text', `${kind} → ${nodeName(edge.to)}${edge.line ? ` · 第 ${edge.line} 行` : ''}`));
    if (edge.line !== undefined && EDITABLE.has(edge.kind)) {
      const source = { sceneId: node.sceneId, line: edge.line, kind: edge.kind as 'goto' | 'loop' | 'jump' | 'call' | 'choice' };
      const select = targetSelect(`第 ${edge.line} 行的新去处`);
      select.value = edge.to;
      row.append(select,
        action('改目标', () => ({ kind: 'retarget', edge: source, to: endpointFor(select) })),
        action('删除', () => ({ kind: 'remove', edge: source })));
    } else row.append(h('span', 'flow-edit-hint', '在剧本里修改'));
    list.append(row);
  }
  existing.append(list);

  const add = h('section', 'flow-edit-section');
  add.append(h('h3', undefined, '新增'));
  const connectRow = h('div', 'flow-edit-row');
  const connectTo = targetSelect('连到', node.id);
  connectRow.append(h('span', undefined, '连到'), connectTo, action('预览', () => ({ kind: 'connect', from: here, to: endpointFor(connectTo) })));

  const branch = h('fieldset', 'flow-edit-branch');
  branch.append(h('legend', undefined, '添加分支'));
  const optionRows = h('div', 'flow-edit-options');
  const addOption = (): void => {
    const row = h('div', 'flow-edit-row');
    const text = h('input'); text.placeholder = '选项文字'; text.setAttribute('aria-label', `选项 ${optionRows.childElementCount + 1} 文字`);
    row.append(text, targetSelect(`选项 ${optionRows.childElementCount + 1} 去处`));
    optionRows.append(row);
  };
  addOption(); addOption();
  const more = h('button', 'v4-button', '再加一个选项'); more.type = 'button'; more.onclick = addOption; more.disabled = blocked !== null;
  branch.append(optionRows, more, action('预览分支', () => ({ kind: 'branch', from: here,
    options: [...optionRows.children].map(row => ({ label: (row.querySelector('input') as HTMLInputElement).value, to: endpointFor(row.querySelector('select') as HTMLSelectElement) })) })));

  const createRow = h('div', 'flow-edit-row');
  const sceneId = h('input'); sceneId.placeholder = '新场景标识'; sceneId.setAttribute('aria-label', '新场景标识');
  createRow.append(h('span', undefined, '新建场景'), sceneId, action('预览', () => {
    const id = sceneId.value.trim();
    if (!/^[^\s.<>:"/\\|?*\u0000-\u001f]+$/u.test(id)) throw new Error('场景标识不能为空，也不能包含空格、点号或文件名保留字符。');
    if (graph.nodes.some(item => item.sceneId === id)) throw new Error(`场景 '${id}' 已存在。`);
    return { kind: 'create', from: here, sceneId: id };
  }));
  add.append(connectRow, branch, createRow);

  const header = h('header', 'flow-edit-header');
  const close = h('button', 'v4-button', '关闭'); close.type = 'button'; close.onclick = () => dialog.close();
  header.append(title, close);
  dialog.append(header, status, existing, add, preview);
  dialog.addEventListener('close', () => { if (open === dialog) open = null; dialog.remove(); });
  document.body.append(dialog);
  open = dialog;
  dialog.showModal();
  if (options.initial && !blocked) void show(() => options.initial!);
}
