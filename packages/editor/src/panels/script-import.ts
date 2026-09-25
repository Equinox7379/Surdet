import { isValidSceneId } from '@surdet/core';
import { createSceneText, parseProjectConfigDocument, previewScriptImport, type ScriptImportInput, type ScriptImportPreview } from '@surdet/authoring';
import { state, h, setStatus } from '../state.js';
import { isSceneFilePathReserved, runProjectWriteOperation } from '../project-io.js';
import { assertConfigSourcesReadable } from '../config-source.js';
import { allowedToEdit, button, field } from '../v4/ui.js';

/** An import is a new ordinary scene draft, not a parallel document/save mechanism. */
export function openScriptImport(host: HTMLElement, onCreated: (key: string) => void): void {
  if (!allowedToEdit(host) || state.reviewPreviewReadOnly || host.querySelector('.script-import-dialog')) return;
  const root = state.dirHandle, projectId = state.autosaveProjectId;
  const dialog = h('dialog', 'v4-insert-dialog script-import-dialog'); dialog.setAttribute('aria-label', '导入剧本');
  const current = (): boolean => dialog.isConnected && host.contains(dialog) && state.dirHandle === root && state.autosaveProjectId === projectId;
  const writable = (): boolean => current() && allowedToEdit(dialog) && !state.reviewPreviewReadOnly;
  const format = h('select');
  for (const [value, label] of [['text', 'UTF-8 纯文本'], ['csv', 'CSV 表格']]) {
    const option = h('option', undefined, label); option.value = value!; format.append(option);
  }
  const upload = h('input'); upload.type = 'file'; upload.accept = '.txt,.csv,text/plain,text/csv';
  const source = h('textarea'); source.rows = 8; source.spellcheck = false;
  const name = h('input'); name.placeholder = '例如 chapter_02';
  const header = h('input'); header.type = 'checkbox'; header.checked = true;
  const textColumn = h('select'), speakerColumn = h('select');
  const mapping = h('div');
  mapping.append(field('第一行是表头', header), field('台词列', textColumn), field('说话人列', speakerColumn));
  const speakers = h('div'), preview = h('div'), message = h('p'); message.setAttribute('role', 'alert');
  let speakerMap: Record<string, string> = Object.create(null);
  let shown: { value: ScriptImportPreview; request: ScriptImportInput; config: string; id: string } | null = null;
  let fileRead = 0, busy = false;
  const request = (): ScriptImportInput => ({ format: format.value as ScriptImportInput['format'], source: source.value,
    ...(format.value !== 'csv' ? {} : { header: header.checked,
      ...(textColumn.value === '' ? {} : { textColumn: Number(textColumn.value) }),
      ...(speakerColumn.value === '' ? {} : { speakerColumn: speakerColumn.value === 'none' ? null : Number(speakerColumn.value) }) }),
    speakerMap: { ...speakerMap } });
  const invalidate = (): void => {
    shown = null; apply.disabled = true; preview.replaceChildren();
    message.textContent = '内容已变化，请重新预览。';
  };
  const close = (): void => { if (busy) return; fileRead++; dialog.close(); dialog.remove(); };
  const populateColumns = (select: HTMLSelectElement, value: ScriptImportPreview, allowNone: boolean): void => {
    const prior = select.value;
    const auto = h('option', undefined, '自动识别'); auto.value = ''; select.replaceChildren(auto);
    if (allowNone) { const none = h('option', undefined, '无说话人（旁白）'); none.value = 'none'; select.append(none); }
    for (const column of value.columns) {
      const option = h('option', undefined, `${column.index + 1} · ${column.label || '（空标题）'}`); option.value = String(column.index); select.append(option);
    }
    select.value = [...select.options].some(option => option.value === prior) ? prior : '';
  };
  const show = (): void => {
    if (!writable() || busy) return;
    try {
      assertConfigSourcesReadable(['gameConfig']);
      const config = parseProjectConfigDocument(state.gameConfigText || '{}');
      const declarations = config['characters'];
      const characters = typeof declarations === 'object' && declarations !== null && !Array.isArray(declarations)
        ? Object.entries(declarations).map(([id, raw]) => ({ id, name: typeof raw === 'object' && raw !== null && typeof (raw as { name?: unknown }).name === 'string' ? (raw as { name: string }).name : id })) : [];
      const input = request(), value = previewScriptImport(input, characters);
      populateColumns(textColumn, value, false); populateColumns(speakerColumn, value, true);
      shown = { value, request: input, config: state.gameConfigText, id: name.value.trim() };
      speakers.replaceChildren();
      for (const sourceSpeaker of new Set(value.rows.map(row => row.sourceSpeaker))) {
        const selected = Object.hasOwn(speakerMap, sourceSpeaker) ? speakerMap[sourceSpeaker]! : sourceSpeaker;
        const select = h('select');
        for (const displayName of new Set([selected, sourceSpeaker, '', ...characters.map(character => character.name)])) {
          const option = h('option', undefined, displayName || '无说话人（旁白）'); option.value = displayName; select.append(option);
        }
        select.value = selected;
        select.onchange = () => { if (writable()) { speakerMap[sourceSpeaker] = select.value; invalidate(); } };
        speakers.append(field(`映射“${sourceSpeaker || '旁白／无说话人'}”`, select));
      }
      preview.replaceChildren(h('p', undefined, `${value.rows.length} 条台词；仅在确认后建立新草稿，现有场景不变。`));
      for (const issue of value.issues) preview.append(h('p', undefined, `第 ${issue.line} 行 · ${issue.severity === 'error' ? '错误' : '提示'}：${issue.message}`));
      const lines = h('ol');
      for (const row of value.rows) {
        const item = h('li', undefined, `原第 ${row.line} 行 · ${row.speaker ? `${row.speaker}：` : ''}${row.value}`);
        item.style.whiteSpace = 'pre-wrap'; item.style.overflowWrap = 'anywhere'; lines.append(item);
      }
      preview.append(lines); apply.disabled = !value.ready;
      message.textContent = value.ready ? '请核对台词、角色映射及新场景 ID，再确认导入。' : '请修正上述错误后重新预览。';
    } catch (error) { shown = null; apply.disabled = true; message.textContent = error instanceof Error ? error.message : String(error); }
  };
  const apply = button('确认导入新草稿', () => {
    if (!writable() || busy || !shown?.value.ready) return;
    const pending = shown;
    const check = (): void => {
      if (!writable() || state.pendingSceneCommit !== null) throw new Error('项目当前不可修改，请完成保存或恢复后重试。');
      assertConfigSourcesReadable(['gameConfig']);
      if (pending.config !== state.gameConfigText || JSON.stringify(pending.request) !== JSON.stringify(request()) || pending.id !== name.value.trim()) throw new Error('正文、角色配置或导入设置已变化，请重新预览。');
      if (!isValidSceneId(pending.id)) throw new Error('场景 ID 须以字母或数字开头，只含字母、数字、下划线或连字符。');
      if ([...state.scenes.values()].some(scene => scene.id.toLowerCase() === pending.id.toLowerCase()) || isSceneFilePathReserved(`${pending.id}.gal`)) throw new Error('同名场景已存在或正在等待保存／删除，请换一个新 ID。');
    };
    try { check(); } catch (error) { message.textContent = String((error as Error).message); return; }
    busy = true; apply.disabled = true; cancel.disabled = true;
    void runProjectWriteOperation(async () => {
      check();
      const text = createSceneText(pending.id, pending.value.blocks);
      const pendingCreateOperationId = [...state.scenes.values()].find(scene => scene.handle === null && !scene.persistedSha256 && scene.pendingCreateOperationId)?.pendingCreateOperationId ?? crypto.randomUUID();
      state.scenes.set(pending.id, { id: pending.id, file: `${pending.id}.gal`, text, eol: '\n', dirty: true, handle: null, pendingCreateOperationId });
      busy = false; close(); onCreated(pending.id);
      setStatus(`已导入 ${pending.value.rows.length} 条台词到 ${pending.id}（未保存）`, true, 6000);
    }).catch(error => { if (current()) { message.textContent = error instanceof Error ? error.message : String(error); apply.disabled = false; } })
      .finally(() => { busy = false; cancel.disabled = false; });
  });
  apply.disabled = true;
  const cancel = button('取消', close), inspect = button('预览导入', show);
  const footer = h('footer'); footer.append(cancel, inspect, apply);
  dialog.append(h('h2', undefined, '导入剧本'), field('格式', format), field('选择 UTF-8 文件', upload), field('原始文字', source),
    field('新场景 ID', name), mapping, speakers, message, preview, footer);
  mapping.hidden = true;
  format.onchange = () => { if (writable()) { mapping.hidden = format.value !== 'csv'; textColumn.replaceChildren(); speakerColumn.replaceChildren(); invalidate(); } };
  source.oninput = () => { if (writable()) { fileRead++; invalidate(); } };
  name.oninput = () => { if (writable()) invalidate(); };
  for (const control of [header, textColumn, speakerColumn]) control.onchange = () => { if (writable()) invalidate(); };
  upload.onchange = () => {
    if (!writable()) return;
    const file = upload.files?.[0]; if (!file) return;
    const token = ++fileRead; invalidate(); message.textContent = '正在读取文件…';
    void file.arrayBuffer().then(buffer => {
      if (!writable() || token !== fileRead) return;
      source.value = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      format.value = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'text'; mapping.hidden = format.value !== 'csv';
      textColumn.replaceChildren(); speakerColumn.replaceChildren(); speakerMap = Object.create(null);
      message.textContent = '文件已读取，请填写新场景 ID 并预览。';
    }).catch(error => { if (current() && token === fileRead) message.textContent = `文件读取失败：${error instanceof Error ? error.message : String(error)}`; });
  };
  dialog.oncancel = event => { event.preventDefault(); close(); };
  dialog.onkeydown = event => { event.stopPropagation(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') event.preventDefault(); };
  host.append(dialog); dialog.showModal();
}
