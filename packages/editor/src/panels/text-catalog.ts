import { inspectTextCatalog, exportTextCatalogCsv, previewTextCatalogImport, type TextCatalogPatch } from '@surdet/authoring';
import { createEditorProjectStorage, loadEditorProjectSnapshot, commitTextCatalogPatch } from '../authoring-project-storage.js';
import { runProjectWriteOperation } from '../project-io.js';
import { state, h } from '../state.js';

/** CSV preparation uses the Editor's existing draft history; preview never writes source. */
export function renderTextCatalogSection(options: {
  csv: string; editCsv(value: string, exported?: boolean): void; onSaved(text: string, importedCsv?: string): void;
}): HTMLElement {
  const section = h('section', 'config-ledger-section'), status = h('p'), table = h('div');
  const root = state.dirHandle;
  let inspection: Awaited<ReturnType<typeof inspectTextCatalog>> | undefined;
  let preview: Awaited<ReturnType<typeof previewTextCatalogImport>> | undefined;
  let busy = false;
  const locale = h('input'); locale.value = 'en'; locale.setAttribute('aria-label', '译文语言');
  const sourceLocale = h('input'); sourceLocale.value = 'zh-CN'; sourceLocale.setAttribute('aria-label', '源语言');
  const source = h('select'); source.setAttribute('aria-label', '当前剧本文本');
  const key = h('input'); key.placeholder = '例如 intro.greeting'; key.setAttribute('aria-label', '稳定文本键');
  const csv = h('textarea'); csv.value = options.csv; csv.rows = 9; csv.setAttribute('aria-label', '译稿表格'); csv.style.width = '100%';
  const differences = h('div');
  const bindingList = h('div');
  let bindings: { key: string; sourceId: string }[] = [];
  const controls = h('div', 'config-actions');
  const current = (): boolean => section.isConnected && state.dirHandle === root;
  const run = (action: () => Promise<void>): void => {
    if (busy || !current()) return;
    busy = true; controls.querySelectorAll('button').forEach(button => button.disabled = true);
    void action().catch(error => { if (current()) status.textContent = error instanceof Error ? error.message : String(error); })
      .finally(() => { busy = false; controls.querySelectorAll('button').forEach(button => button.disabled = false); });
  };
  const render = (): void => {
    if (!inspection) return;
    source.replaceChildren(...inspection.sources.map(item => {
      const option = h('option'); option.value = item.sourceId;
      option.textContent = `${item.sceneId} / ${item.label ?? '开头'} / ${item.line}：${item.speaker ? item.speaker + '：' : ''}${item.text}`;
      return option;
    }));
    if (inspection.sourceLocale) sourceLocale.value = inspection.sourceLocale;
    table.replaceChildren();
    const labels = { 'needs-rebind': '来源变化，需重新绑定', 'needs-translation': '原文变化，待重译', untranslated: '未翻译', translated: '已翻译' };
    for (const entry of inspection.entries) {
      const row = h('p');
      row.textContent = `${entry.key} · ${labels[entry.status]} · ${entry.source.speaker ? entry.source.speaker + '：' : ''}${entry.source.text} → ${entry.translations[inspection.locale]?.value ?? ''}`;
      table.append(row);
    }
    if (!inspection.entries.length) table.append(h('p', undefined, '尚未登记文本。选择真实来源并填写固定文本键后保存。'));
  };
  const refresh = async (): Promise<void> => {
    const snapshot = await loadEditorProjectSnapshot();
    const next = await inspectTextCatalog(snapshot, createEditorProjectStorage(), locale.value.trim());
    if (!current()) return;
    inspection = next; preview = undefined; bindings = []; bindingList.replaceChildren(); differences.replaceChildren(); render();
  };
  const save = async (patch: TextCatalogPatch): Promise<void> => {
    if (!inspection || !current()) throw new Error('请先读取当前文本目录');
    const expectedRevision = inspection.revision, expectedFingerprint = inspection.fingerprint;
    const result = await runProjectWriteOperation(async () => {
      if (!current()) throw new Error('项目或工作面已切换，请重新读取');
      return commitTextCatalogPatch({ operationId: crypto.randomUUID(), expectedRevision, expectedFingerprint, patch });
    });
    if (!current()) return;
    options.onSaved(result.text, patch.type === 'import' ? patch.csv : undefined); await refresh(); status.textContent = '译稿目录已保存。重新打开项目可继续制作。';
  };
  const button = (label: string, action: () => Promise<void>): void => {
    const control = h('button', undefined, label); control.type = 'button'; control.onclick = () => run(action); controls.append(control);
  };
  button('读取文本目录', async () => { await refresh(); status.textContent = '已读取当前来源；正文结构变动后需要显式确认原键的新对应。'; });
  button('加入绑定清单', async () => {
    if (!inspection || !key.value.trim() || !source.value) throw new Error('先读取目录，填写文本键并选择当前来源');
    bindings = [...bindings.filter(item => item.key !== key.value.trim()), { key: key.value.trim(), sourceId: source.value }];
    bindingList.replaceChildren(...bindings.map(item => h('p', undefined, `${item.key} → ${inspection!.sources.find(source => source.sourceId === item.sourceId)?.text ?? item.sourceId}`)));
    status.textContent = '绑定清单尚未保存；交换两个已有键的来源时，请将两项都加入后一起保存。';
  });
  button('绑定清单并保存', async () => {
    if (!bindings.length) throw new Error('请先将待确认的对应关系加入绑定清单');
    await save({ type: 'bind', sourceLocale: sourceLocale.value.trim(), bindings });
  });
  button('移除文本键并保存', async () => { await save({ type: 'remove', keys: [key.value.trim()] }); });
  button('导出译稿表格', async () => {
    await refresh(); if (!current() || !inspection) return;
    csv.value = exportTextCatalogCsv(inspection);
    options.editCsv(csv.value, true);
    const url = URL.createObjectURL(new Blob([csv.value], { type: 'text/csv;charset=utf-8' }));
    const link = h('a'); link.href = url; link.download = `surdet-texts-${inspection.locale}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = '已导出；也可直接复制下方表格文本。只编辑译文列（translation），保留其余来源信息。';
  });
  button('预览导入差异', async () => {
    const submitted = csv.value, language = locale.value.trim(), snapshot = await loadEditorProjectSnapshot();
    const next = await previewTextCatalogImport(snapshot, createEditorProjectStorage(), language, submitted);
    if (!current() || submitted !== csv.value || language !== locale.value.trim()) return;
    if (inspection?.revision !== snapshot.revision) { bindings = []; bindingList.replaceChildren(); }
    inspection = await inspectTextCatalog(snapshot, createEditorProjectStorage(), language);
    if (!current()) return;
    preview = next; differences.replaceChildren(); render();
    for (const issue of next.issues) differences.append(h('p', 'error', `第 ${issue.line} 行 ${issue.key ?? ''}：${issue.message}`));
    for (const row of next.rows.filter(row => row.changed)) differences.append(h('p', undefined, `${row.key}：${row.before || '（未翻译）'} → ${row.after}`));
    status.textContent = next.ready ? '差异预览通过，确认后才能写入项目。' : '导入未通过，项目未修改。';
  });
  button('确认导入并保存', async () => {
    if (!preview?.ready) throw new Error('请先取得通过的差异预览');
    await save({ type: 'import', locale: locale.value.trim(), csv: csv.value, previewFingerprint: preview.previewFingerprint });
  });
  locale.oninput = () => { preview = undefined; differences.replaceChildren(); };
  csv.oninput = () => { options.editCsv(csv.value); preview = undefined; differences.replaceChildren(); };
  const upload = h('input'); upload.type = 'file'; upload.accept = '.csv,text/csv'; upload.setAttribute('aria-label', '选择译稿表格');
  upload.onchange = () => run(async () => {
    const file = upload.files?.[0]; if (!file) return;
    const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (current()) { csv.value = value; options.editCsv(value); preview = undefined; differences.replaceChildren(); status.textContent = '表格已读取，尚未修改项目；请预览导入差异。'; }
  });
  const header = h('header', 'config-ledger-header'), copy = h('div', 'config-section-copy');
  copy.append(h('h1', 'config-section-heading', '文本与译稿'), h('p', 'config-section-description', '管理正文和选项的译稿。固定文本键不随行号改变；此处不切换游戏播放语言。'));
  header.append(copy);
  const fields = h('div', 'config-field-grid');
  for (const [name, input] of [['源语言', sourceLocale], ['译文语言', locale], ['当前剧本文本', source], ['稳定文本键', key]] as const) {
    const field = h('label', 'config-field'); field.append(h('span', undefined, name), input); fields.append(field);
  }
  const csvField = h('label', 'config-field'); csvField.append(h('span', undefined, '译稿表格'), csv);
  section.append(header, fields, h('p', 'config-section-help', '重新绑定已有键前，请明确核对当前来源；旧译稿会保留并提示是否需要重译。'), controls, status, bindingList, table,
    h('p', 'config-section-help', '编辑表格文本后先预览差异，再确认导入。保存全部不会自动导入译稿；切换工作面会保留未确认文字。'), upload, csvField, differences);
  return section;
}
