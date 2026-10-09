import { inspectTextCatalog, exportTextCatalogCsv, exportVoiceCatalogCsv, previewTextCatalogImport, type TextCatalogPatch } from '@surdet/authoring';
import { createEditorProjectStorage, loadEditorProjectSnapshot, commitTextCatalogPatch } from '../authoring-project-storage.js';
import { runProjectWriteOperation } from '../project-io.js';
import { state, h } from '../state.js';
import { isStoryTextSource } from '@surdet/core';
import { openUiPlayerPreview } from '../ui-player-preview.js';

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
  const section = h('section', 'config-ledger-section text-catalog'), table = h('div', 'text-catalog-entries');
  const root = state.dirHandle;
  let inspection: Awaited<ReturnType<typeof inspectTextCatalog>> | undefined;
  let preview: Awaited<ReturnType<typeof previewTextCatalogImport>> | undefined;
  let busy = false;
  const locale = h('input'); locale.value = 'en'; locale.setAttribute('aria-label', '译文语言');
  const sourceLocale = h('input'); sourceLocale.value = options.readBindings()[0]?.sourceLocale ?? 'zh-CN'; sourceLocale.setAttribute('aria-label', '源语言');
  const source = h('select'); source.setAttribute('aria-label', '当前文本来源');
  const key = h('input'); key.placeholder = '例如 intro.greeting'; key.setAttribute('aria-label', '稳定文本键');
  const csv = h('textarea'); csv.value = options.readCsv(); csv.rows = 9; csv.setAttribute('aria-label', '译稿表格'); csv.style.width = '100%';
  const differences = h('div', 'text-catalog-differences');
  const bindingList = h('div', 'text-catalog-bindings');
  // Each workflow step reports next to its own buttons; only the step last used shows a message.
  const statusLines: HTMLElement[] = [];
  let activeStatus: HTMLElement | undefined;
  const statusLine = (): HTMLElement => {
    const line = h('p', 'text-catalog-status'); line.setAttribute('role', 'status'); statusLines.push(line); return line;
  };
  const say = (text: string): void => { for (const line of statusLines) line.textContent = line === activeStatus ? text : ''; };
  const actionButtons: HTMLButtonElement[] = [];
  const assetFiles = () => state.dirAssets.flatMap(asset => asset.sourcePath ? [{ path: asset.sourcePath }] : []);
  const current = (): boolean => section.isConnected && state.dirHandle === root && options.isCurrent();
  const run = (line: HTMLElement, action: () => Promise<void>): void => {
    if (busy || !current()) return;
    busy = true; activeStatus = line; for (const control of actionButtons) control.disabled = true;
    void action().catch(error => { if (current()) say(error instanceof Error ? error.message : String(error)); })
      .finally(() => { busy = false; for (const control of actionButtons) control.disabled = false; });
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
      const context = isStoryTextSource(item) ? `${item.sceneId} / ${item.label ?? '开头'} / ${item.line}`
        : `${{ character: '人物显示名', ui: '界面文字', term: '词条', gallery: '剧情资料' }[item.kind]} / ${item.objectRef}`;
      option.textContent = `${context}：${item.speaker ? item.speaker + '：' : ''}${item.text}`;
      return option;
    }));
    if (inspection.sourceLocale && !options.readBindings().length) sourceLocale.value = inspection.sourceLocale;
    table.replaceChildren();
    const labels = { 'needs-rebind': '来源变化，需重新绑定', 'needs-translation': '原文变化，待重译', untranslated: '未翻译', translated: '已翻译' };
    for (const entry of inspection.entries) {
      const row = h('p');
      const voiceLabels: Record<string, string> = { unassigned: '未关联', 'needs-rebind': '来源待确认', 'needs-recording': '台词已改，配音待确认', ready: '已确认', 'asset-unavailable': '素材不可用' };
      row.textContent = `${entry.key} · ${labels[entry.status]} · ${entry.source.speaker ? entry.source.speaker + '：' : ''}${entry.source.text} → ${entry.translations[inspection.locale]?.value ?? ''}`
        + (entry.source.kind === 'dialogue' ? ` · 配音：${voiceLabels[entry.voiceStatus]}${entry.voices?.[inspection.locale] ? `（${entry.voices[inspection.locale]!.asset}）` : ''}` : '');
      table.append(row);
    }
    if (!inspection.entries.length) table.append(h('p', undefined, '尚未登记文本。选择真实来源并填写固定文本键后保存。'));
  };
  const refresh = async (): Promise<void> => {
    const snapshot = await loadEditorProjectSnapshot();
    const next = await inspectTextCatalog(snapshot, createEditorProjectStorage(), locale.value.trim(), assetFiles());
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
    await refresh(); say('译稿目录已保存。重新打开项目可继续制作。');
  };
  const step = (title: string, description: string): { group: HTMLElement; actions: HTMLElement; line: HTMLElement } => {
    const group = h('div', 'config-subsection text-catalog-step');
    group.append(h('h2', undefined, title), h('p', undefined, description));
    return { group, actions: h('div', 'text-catalog-actions'), line: statusLine() };
  };
  const read = step('当前文本目录', '读取当前来源后，可查看已登记的文本键、翻译状态与对白配音状态。');
  const bind = step('绑定文本键', '选择真实来源并填写固定文本键，先加入绑定清单，核对后一起保存。');
  const exporting = step('导出', '导出文本目录中已保存的译稿或配音清单；下载工作稿只保存当前编辑内容，不校验也不写入项目。');
  const importing = step('导入译稿', '译稿与配音清单均先预览差异，再确认导入。配音仅支持已确认对白和现有语音素材；源语言配音可将译文语言填写为源语言。保存全部不会自动批准；切换工作面保留未确认文字。');
  const importActions = h('div', 'text-catalog-actions');
  const button = (place: { actions: HTMLElement; line: HTMLElement }, label: string, action: () => Promise<void>, className?: string): void => {
    const control = h('button', className, label); control.type = 'button'; control.onclick = () => run(place.line, action);
    actionButtons.push(control); place.actions.append(control);
  };
  button(read, '读取文本目录', async () => { await refresh(); say('已读取当前来源；正文结构变动后需要显式确认原键的新对应。'); });
  button(read, '试玩已确认译稿', () => openUiPlayerPreview(state.gameConfigText));
  button(bind, '加入绑定清单', async () => {
    if (!inspection || !key.value.trim() || !source.value) throw new Error('先读取目录，填写文本键并选择当前来源');
    const selected = inspection.sources.find(item => item.sourceId === source.value);
    if (!selected) throw new Error('所选来源已不可用，请重新读取目录');
    options.editBindings([...options.readBindings().filter(item => item.key !== key.value.trim()), {
      key: key.value.trim(), sourceId: selected.sourceId, sourceText: selected.text,
      revision: inspection.revision, fingerprint: inspection.fingerprint, sourceLocale: sourceLocale.value.trim(),
    }]);
    renderBindings();
    say('绑定清单尚未保存；交换两个已有键的来源时，请将两项都加入后一起保存。');
  });
  button(bind, '绑定清单并保存', async () => {
    const bindings = options.readBindings().map(item => ({ ...item }));
    if (!bindings.length) throw new Error('请先将待确认的对应关系加入绑定清单');
    await refresh(); if (!current()) return;
    if (bindings.some(item => !bindingIsCurrent(item))) throw new Error('来源版本已经变化；清单已保留，请重新核对每项来源并加入清单后保存');
    const language = bindings[0]!.sourceLocale;
    if (bindings.some(item => item.sourceLocale !== language)) throw new Error('清单的源语言不一致，请统一源语言后保存');
    await save({ type: 'bind', sourceLocale: language, bindings: bindings.map(({ key, sourceId }) => ({ key, sourceId })) }, bindings);
  }, 'primary');
  button(bind, '清空绑定清单', async () => { options.editBindings([]); renderBindings(); say('已清空待绑定清单，可撤销；项目中的文本键未删除。'); });
  button(bind, '移除文本键并保存', async () => { await save({ type: 'remove', keys: [key.value.trim()] }); }, 'danger');
  const download = (value: string, name: string): void => {
    const url = URL.createObjectURL(new Blob([value], { type: 'text/csv;charset=utf-8' }));
    const link = h('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const savedCatalog = async () => {
    const language = locale.value.trim();
    const snapshot = await loadEditorProjectSnapshot();
    return inspectTextCatalog(snapshot, createEditorProjectStorage(), language, assetFiles());
  };
  button(exporting, '导出译稿表格', async () => {
    const saved = await savedCatalog(); if (!current()) return;
    download(exportTextCatalogCsv(saved), `surdet-texts-${saved.locale}.csv`);
    say('已导出文本目录中的译稿，不含编辑框中未确认的修改；工作稿、绑定清单和导入预览均未改变。');
  });
  button(exporting, '导出配音清单', async () => {
    const saved = await savedCatalog(); if (!current()) return;
    download(exportVoiceCatalogCsv(saved), `surdet-voices-${saved.locale}.csv`);
    say('已导出对白配音清单；voice 填现有素材键，action 用 keep 保留、bind 确认或 remove 解除。只关联文件，不生成音频。');
  });
  button(exporting, '下载当前工作稿', async () => {
    const value = options.readCsv();
    if (!value) throw new Error('当前工作稿为空，请先载入或选择译稿表格');
    download(value, 'surdet-texts-draft.csv');
    say('已下载当前工作稿，未校验或写入项目；未确认内容仍保留。');
  });
  button(importing, '载入已保存译稿', async () => {
    const previous = options.readCsv(), language = locale.value.trim();
    const saved = await savedCatalog();
    if (!current()) return;
    if (options.readCsv() !== previous || locale.value.trim() !== language) throw new Error('读取期间工作稿或语言已改变，未替换编辑内容');
    const value = exportTextCatalogCsv(saved);
    if (previous === value) return;
    if (previous && !window.confirm('用文本目录中的译稿替换当前工作稿？尚未确认的内容会被替换，可通过撤销找回。')) return;
    options.editCsv(value); csv.value = value; preview = undefined; differences.replaceChildren();
    say('已载入编辑工作稿；只编辑译文列（translation），预览差异并确认后才能保存。');
  });
  const importStep = { actions: importActions, line: importing.line };
  button(importStep, '预览导入差异', async () => {
    const submitted = options.readCsv(), language = locale.value.trim(), snapshot = await loadEditorProjectSnapshot();
    const next = await previewTextCatalogImport(snapshot, createEditorProjectStorage(), language, submitted, assetFiles());
    if (!current() || submitted !== options.readCsv() || language !== locale.value.trim()) return;
    const nextInspection = await inspectTextCatalog(snapshot, createEditorProjectStorage(), language, assetFiles());
    if (!current() || submitted !== options.readCsv() || language !== locale.value.trim()) return;
    inspection = nextInspection;
    preview = next; differences.replaceChildren(); render(); renderBindings();
    for (const issue of next.issues) differences.append(h('p', 'error', `第 ${issue.line} 行 ${issue.key ?? ''}：${issue.message}`));
    for (const row of next.rows.filter(row => row.changed)) differences.append(h('p', undefined, `${row.key}${row.voiceAction ? ' · 配音' : ''}：${row.before || '（无）'} → ${row.after || '（解除）'}`));
    say(next.ready ? '差异预览通过，确认后才能写入项目。' : '导入未通过，项目未修改。');
  });
  button(importStep, '确认导入并保存', async () => {
    if (!preview?.ready) throw new Error('请先取得通过的差异预览');
    await save({ type: 'import', locale: locale.value.trim(), csv: options.readCsv(), previewFingerprint: preview.previewFingerprint });
  }, 'primary');
  locale.oninput = () => { preview = undefined; differences.replaceChildren(); };
  sourceLocale.oninput = () => {
    if (options.readBindings().length) options.editBindings(options.readBindings().map(item => ({ ...item, sourceLocale: sourceLocale.value.trim() })));
  };
  csv.oninput = () => { options.editCsv(csv.value); preview = undefined; differences.replaceChildren(); };
  const upload = h('input'); upload.type = 'file'; upload.accept = '.csv,text/csv'; upload.setAttribute('aria-label', '选择译稿表格');
  upload.onchange = () => run(importing.line, async () => {
    const file = upload.files?.[0]; if (!file) return;
    const previous = options.readCsv();
    const value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
    if (!current()) return;
    if (options.readCsv() !== previous || upload.files?.[0] !== file) throw new Error('读取期间工作稿或选择的文件已改变，未替换编辑内容；请重新选择表格。');
    csv.value = value; options.editCsv(value); preview = undefined; differences.replaceChildren(); say('表格已读取，尚未修改项目；请预览导入差异。');
  });
  const header = h('header', 'config-ledger-header'), copy = h('div', 'config-section-copy');
  copy.append(h('h1', 'config-section-heading', '文本与译稿'), h('p', 'config-section-description', '管理正文、选项、人物显示名、界面文字和词条的译稿。固定文本键不随行号改变；播放语言在游戏设置中切换。'));
  header.append(copy);
  const field = (name: string, input: HTMLElement, wide = false): HTMLElement => {
    const label = h('label', wide ? 'config-field text-catalog-wide' : 'config-field'); label.append(h('span', undefined, name), input); return label;
  };
  const languages = h('div', 'config-field-grid text-catalog-languages');
  languages.append(field('源语言', sourceLocale), field('译文语言', locale));
  read.group.append(read.actions, read.line, table);
  const bindFields = h('div', 'config-field-grid');
  bindFields.append(field('当前文本来源', source, true), field('稳定文本键', key));
  bind.group.append(bindFields, h('p', 'config-section-help', '重新绑定已有键前，请明确核对当前来源；旧译稿会保留并提示是否需要重译。'), bind.actions, bind.line, bindingList);
  exporting.group.append(exporting.actions, exporting.line);
  // The native file field stays the accessible input; a matching button keeps the row in the Editor's own style.
  const pick = h('button', undefined, '选择表格文件…'); pick.type = 'button'; pick.onclick = () => upload.click();
  upload.className = 'text-catalog-file'; actionButtons.push(pick);
  importing.actions.append(pick, upload);
  importing.group.append(importing.actions, field('译稿表格', csv, true), importActions, importing.line, differences);
  section.append(header, languages, read.group, bind.group, exporting.group, importing.group);
  renderBindings();
  return section;
}
