import { inspectTextCatalog, exportTextCatalogCsv, previewTextCatalogImport, type TextCatalogPatch } from '@surdet/authoring';
import { createEditorProjectStorage, loadEditorProjectSnapshot, commitTextCatalogPatch } from '../authoring-project-storage.js';
import { runProjectWriteOperation } from '../project-io.js';
import { state, h } from '../state.js';

export interface TextBindingDraft {
  key: string; sourceId: string; sourceText: string;
  revision: string; fingerprint: string; sourceLocale: string;
}

/** CSV preparation uses the Editor's existing draft history; preview never writes source. */
export function renderTextCatalogSection(options: {
  readCsv(): string; editCsv(value: string): void;
  readBindings(): readonly TextBindingDraft[]; editBindings(value: TextBindingDraft[]): void;
  isCurrent(): boolean;
  onSaved(text: string, submitted: { csv?: string; bindings?: readonly TextBindingDraft[] }): void;
}): HTMLElement {
  const section = h('section', 'config-ledger-section'), status = h('p'), table = h('div');
  const root = state.dirHandle;
  let inspection: Awaited<ReturnType<typeof inspectTextCatalog>> | undefined;
  let preview: Awaited<ReturnType<typeof previewTextCatalogImport>> | undefined;
  let busy = false;
  const locale = h('input'); locale.value = 'en'; locale.setAttribute('aria-label', '译文语言');
  const sourceLocale = h('input'); sourceLocale.value = options.readBindings()[0]?.sourceLocale ?? 'zh-CN'; sourceLocale.setAttribute('aria-label', '源语言');
  const source = h('select'); source.setAttribute('aria-label', '当前剧本文本');
  const key = h('input'); key.placeholder = '例如 intro.greeting'; key.setAttribute('aria-label', '稳定文本键');
  const csv = h('textarea'); csv.value = options.readCsv(); csv.rows = 9; csv.setAttribute('aria-label', '译稿表格'); csv.style.width = '100%';
  const differences = h('div');
  const bindingList = h('div');
  const controls = h('div', 'config-actions');
  const current = (): boolean => section.isConnected && state.dirHandle === root && options.isCurrent();
  const run = (action: () => Promise<void>): void => {
    if (busy || !current()) return;
    busy = true; controls.querySelectorAll('button').forEach(button => button.disabled = true);
    void action().catch(error => { if (current()) status.textContent = error instanceof Error ? error.message : String(error); })
      .finally(() => { busy = false; controls.querySelectorAll('button').forEach(button => button.disabled = false); });
  };
  const bindingIsCurrent = (binding: TextBindingDraft): boolean => binding.revision === inspection?.revision && binding.fingerprint === inspection?.fingerprint;
  const renderBindings = (): void => {
    bindingList.replaceChildren(...options.readBindings().map(item => h('p', undefined,
      `${item.key} → ${item.sourceText}${inspection && !bindingIsCurrent(item) ? '（来源已变化，请重新核对并加入）' : ''}`)));
  };
  const render = (): void => {
    if (!inspection) return;
    source.replaceChildren(...inspection.sources.map(item => {
      const option = h('option'); option.value = item.sourceId;
      option.textContent = `${item.sceneId} / ${item.label ?? '开头'} / ${item.line}：${item.speaker ? item.speaker + '：' : ''}${item.text}`;
      return option;
    }));
    if (inspection.sourceLocale && !options.readBindings().length) sourceLocale.value = inspection.sourceLocale;
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
    inspection = next; preview = undefined; differences.replaceChildren(); render(); renderBindings();
  };
  const save = async (patch: TextCatalogPatch, bindings?: readonly TextBindingDraft[]): Promise<void> => {
    if (!inspection || !current()) throw new Error('请先读取当前文本目录');
    const expectedRevision = inspection.revision, expectedFingerprint = inspection.fingerprint;
    const result = await runProjectWriteOperation(async () => {
      if (!current()) throw new Error('项目或工作面已切换，请重新读取');
      return commitTextCatalogPatch({ operationId: crypto.randomUUID(), expectedRevision, expectedFingerprint, patch });
    });
    // Settle the submitted draft even if this panel was rebuilt during the write.
    // The configuration session rejects callbacks belonging to another project.
    options.onSaved(result.text, { ...(patch.type === 'import' ? { csv: patch.csv } : {}), ...(bindings ? { bindings } : {}) });
    if (!current()) return;
    await refresh(); status.textContent = '译稿目录已保存。重新打开项目可继续制作。';
  };
  const button = (label: string, action: () => Promise<void>): void => {
    const control = h('button', undefined, label); control.type = 'button'; control.onclick = () => run(action); controls.append(control);
  };
  button('读取文本目录', async () => { await refresh(); status.textContent = '已读取当前来源；正文结构变动后需要显式确认原键的新对应。'; });
  button('加入绑定清单', async () => {
    if (!inspection || !key.value.trim() || !source.value) throw new Error('先读取目录，填写文本键并选择当前来源');
    const selected = inspection.sources.find(item => item.sourceId === source.value);
    if (!selected) throw new Error('所选来源已不可用，请重新读取目录');
    options.editBindings([...options.readBindings().filter(item => item.key !== key.value.trim()), {
      key: key.value.trim(), sourceId: selected.sourceId, sourceText: selected.text,
      revision: inspection.revision, fingerprint: inspection.fingerprint, sourceLocale: sourceLocale.value.trim(),
    }]);
    renderBindings();
    status.textContent = '绑定清单尚未保存；交换两个已有键的来源时，请将两项都加入后一起保存。';
  });
  button('绑定清单并保存', async () => {
    const bindings = options.readBindings().map(item => ({ ...item }));
    if (!bindings.length) throw new Error('请先将待确认的对应关系加入绑定清单');
    await refresh(); if (!current()) return;
    if (bindings.some(item => !bindingIsCurrent(item))) throw new Error('来源版本已经变化；清单已保留，请重新核对每项来源并加入清单后保存');
    const language = bindings[0]!.sourceLocale;
    if (bindings.some(item => item.sourceLocale !== language)) throw new Error('清单的源语言不一致，请统一源语言后保存');
    await save({ type: 'bind', sourceLocale: language, bindings: bindings.map(({ key, sourceId }) => ({ key, sourceId })) }, bindings);
  });
  button('清空绑定清单', async () => { options.editBindings([]); renderBindings(); status.textContent = '已清空待绑定清单，可撤销；项目中的文本键未删除。'; });
  button('移除文本键并保存', async () => { await save({ type: 'remove', keys: [key.value.trim()] }); });
  const download = (value: string, name: string): void => {
    const url = URL.createObjectURL(new Blob([value], { type: 'text/csv;charset=utf-8' }));
    const link = h('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const savedCatalog = async () => {
    const language = locale.value.trim();
    const snapshot = await loadEditorProjectSnapshot();
    return inspectTextCatalog(snapshot, createEditorProjectStorage(), language);
  };
  button('导出译稿表格', async () => {
    const saved = await savedCatalog(); if (!current()) return;
    download(exportTextCatalogCsv(saved), `surdet-texts-${saved.locale}.csv`);
    status.textContent = '已导出文本目录中的译稿，不含编辑框中未确认的修改；工作稿、绑定清单和导入预览均未改变。';
  });
  button('下载当前工作稿', async () => {
    const value = options.readCsv();
    if (!value) throw new Error('当前工作稿为空，请先载入或选择译稿表格');
    download(value, 'surdet-texts-draft.csv');
    status.textContent = '已下载当前工作稿，未校验或写入项目；未确认内容仍保留。';
  });
  button('载入已保存译稿', async () => {
    const previous = options.readCsv(), language = locale.value.trim();
    const saved = await savedCatalog();
    if (!current()) return;
    if (options.readCsv() !== previous || locale.value.trim() !== language) throw new Error('读取期间工作稿或语言已改变，未替换编辑内容');
    const value = exportTextCatalogCsv(saved);
    if (previous === value) return;
    if (previous && !window.confirm('用文本目录中的译稿替换当前工作稿？尚未确认的内容会被替换，可通过撤销找回。')) return;
    options.editCsv(value); csv.value = value; preview = undefined; differences.replaceChildren();
    status.textContent = '已载入编辑工作稿；只编辑译文列（translation），预览差异并确认后才能保存。';
  });
  button('预览导入差异', async () => {
    const submitted = options.readCsv(), language = locale.value.trim(), snapshot = await loadEditorProjectSnapshot();
    const next = await previewTextCatalogImport(snapshot, createEditorProjectStorage(), language, submitted);
    if (!current() || submitted !== options.readCsv() || language !== locale.value.trim()) return;
    const nextInspection = await inspectTextCatalog(snapshot, createEditorProjectStorage(), language);
    if (!current() || submitted !== options.readCsv() || language !== locale.value.trim()) return;
    inspection = nextInspection;
    preview = next; differences.replaceChildren(); render(); renderBindings();
    for (const issue of next.issues) differences.append(h('p', 'error', `第 ${issue.line} 行 ${issue.key ?? ''}：${issue.message}`));
    for (const row of next.rows.filter(row => row.changed)) differences.append(h('p', undefined, `${row.key}：${row.before || '（未翻译）'} → ${row.after}`));
    status.textContent = next.ready ? '差异预览通过，确认后才能写入项目。' : '导入未通过，项目未修改。';
  });
  button('确认导入并保存', async () => {
    if (!preview?.ready) throw new Error('请先取得通过的差异预览');
    await save({ type: 'import', locale: locale.value.trim(), csv: options.readCsv(), previewFingerprint: preview.previewFingerprint });
  });
  locale.oninput = () => { preview = undefined; differences.replaceChildren(); };
  sourceLocale.oninput = () => {
    if (options.readBindings().length) options.editBindings(options.readBindings().map(item => ({ ...item, sourceLocale: sourceLocale.value.trim() })));
  };
  csv.oninput = () => { options.editCsv(csv.value); preview = undefined; differences.replaceChildren(); };
  const upload = h('input'); upload.type = 'file'; upload.accept = '.csv,text/csv'; upload.setAttribute('aria-label', '选择译稿表格');
  upload.onchange = () => run(async () => {
    const file = upload.files?.[0]; if (!file) return;
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
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
  renderBindings();
  return section;
}
