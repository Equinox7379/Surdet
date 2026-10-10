/**
 * 块式编辑区（E0 拆分：原 main.ts 纯搬移）。
 * raw 行为事实来源：类型化控件只是编辑糖；行级编辑经 history 入撤销栈。
 */
import { state, h, setStatus } from '../state.js';
import { setCurrentText } from '../history.js';
import {
  parseScript, serializeScript, parseLine, rebuildTextRaw,
} from '../model.js';
import type { LineModel } from '../model.js';
import { selectAuthoringObject } from '../causal-selection.js';
import { InstructionFieldSource } from '../instruction-field-source.js';
import { installScriptV4, prepareScriptV4Render } from '../v4/script-workbench.js';
import { editSceneLabel } from '../label-editing.js';
import { instructionLabel, PARTICLE_NAMES } from '../script-presentation.js';
import { decodeInstructionArgument } from '@surdet/authoring';
import { sceneTextCharacters } from '../stats.js';

export function currentText(): string {
  return state.current ? state.scenes.get(state.current)?.text ?? '' : '';
}

/** 当前场景的换行风格（序列化时保持源文件风格） */
export function currentEol(): '\r\n' | '\n' {
  const eol = state.current ? state.scenes.get(state.current)?.eol ?? '\n' : '\n';
  return eol === '\r\n' ? '\r\n' : '\n';
}

export function updateLine(index: number, next: LineModel): void {
  const lines = parseScript(currentText());
  if (index < 0 || index >= lines.length) return;
  lines[index] = next;
  // 类型化字段/raw 输入的编辑热路径：保持源文件换行风格；打字合并入撤销栈（自我迭代①a）
  setCurrentText(serializeScript(lines, currentEol()), { coalesce: true });
}

export function deleteLine(index: number): void {
  const lines = parseScript(currentText());
  const line = lines[index];
  if (line?.kind === 'label') { requestLabelEdit(index, line.raw); return; }
  lines.splice(index, 1);
  state.selectedObjectRef = null;
  setCurrentText(serializeScript(lines, currentEol()));
  renderEditor();
}

function requestLabelEdit(index: number, expectedRaw: string, to?: string): void {
  const key = state.current, host = document.getElementById('editor');
  if (!key || !host?.isConnected || host.closest('[inert]')) return;
  void editSceneLabel(key, index, expectedRaw, to).then(() => {
    state.selectedObjectRef = null; renderEditor();
    setStatus(to === undefined ? '未引用的标签已删除（未保存，可撤销）' : `标签已改为 ${to}，引用已同步（保存全部后写入磁盘）`, true, 6000);
  }).catch(error => { setStatus(error instanceof Error ? error.message : String(error), false, 7000); });
}

export function insertLine(index: number): void {
  const lines = parseScript(currentText());
  lines.splice(index + 1, 0, {
    kind: 'text',
    speaker: '',
    value: '新台词',
    sep: '：',
    raw: '新台词',
    eol: index + 1 >= lines.length ? '' : currentEol(),
  });
  state.selectedObjectRef = null;
  setCurrentText(serializeScript(lines, currentEol()));
  renderEditor();
}

export function moveLine(index: number, dir: -1 | 1): void {
  const lines = parseScript(currentText());
  const target = index + dir;
  if (target < 0 || target >= lines.length) return;
  const tmp = lines[index]!;
  lines[index] = lines[target]!;
  lines[target] = tmp;
  state.selectedObjectRef = null;
  setCurrentText(serializeScript(lines, currentEol()));
  renderEditor();
}

/** 指令类型化编辑模板：指令名 → 位置参数字段（null = 整体参数单输入） */
export const INSTR_FIELDS: Record<string, { labels: string[]; opSelect?: number; restFrom?: number } | null> = {
  bg: { labels: ['背景素材键'] },
  show: { labels: ['角色:服装', '表情/第二参数'] },
  hide: { labels: ['角色'] },
  voice: { labels: ['语音素材键'] },
  bgm: { labels: ['音乐素材键'] },
  se: { labels: ['音效素材键'] },
  fadein: { labels: ['毫秒'] },
  fadeout: { labels: ['毫秒'] },
  wait: { labels: ['毫秒'] },
  set: { labels: ['变量', '运算符', '表达式'], opSelect: 1, restFrom: 2 },
  mod: { labels: ['变量', '增量'] },
  inc: { labels: ['变量'] },
  dec: { labels: ['变量'] },
  toggle: { labels: ['变量'] },
  flag: { labels: ['变量'] },
  unflag: { labels: ['变量'] },
  if: { labels: ['条件表达式'], restFrom: 0 },
  elif: { labels: ['条件表达式'], restFrom: 0 },
  goto: { labels: ['标签'] },
  loop: { labels: ['标签'] },
  jump: { labels: ['场景.标签'] },
  call: { labels: ['场景.标签'] },
  unlock_cg: { labels: ['鉴赏图片标识'] },
  unlock_music: { labels: ['鉴赏音乐标识'] },
  unlock_text: { labels: ['剧情回想标识'] },
  unlock_profile: { labels: ['人物资料标识'] },
  unlock_term: { labels: ['用语词条标识'] },
  add_item: { labels: ['数组变量', '道具标识'] },
  remove_item: { labels: ['数组变量', '道具标识'] },
  has_item: { labels: ['数组变量', '道具标识', '结果变量'] },
  particle: { labels: ['预设'] },
  nvl: { labels: ['阅读模式'] },
  mov: { labels: ['角色', '位置', '毫秒'] },
  tint: { labels: ['十六进制颜色', '透明度', '毫秒'] },
  clear: { labels: ['结局标识（缺省=当前场景）'] },
  exp: { labels: ['角色标识', '经验值'] },
  achievement: { labels: ['操作', '成就标识'] },
  choice: { labels: [] },
};

function kindBadge(l: LineModel): string {
  switch (l.kind) {
    case 'text': return '台词';
    case 'label': return '标签';
    case 'instr': return instructionLabel(l.name);
    case 'choice-option': return '选项';
    case 'comment': return '注释';
    default: return '空行';
  }
}

const FLOW_CMDS = new Set(['goto', 'jump', 'call', 'if', 'elif', 'loop', 'choice', 'switch']);
const STAGE_CMDS = new Set([
  'bg', 'show', 'hide', 'bgm', 'ambience', 'se', 'voice', 'flash', 'shake', 'wipe', 'zoom', 'transition', 'wait',
  'fadein', 'fadeout', 'particle', 'mov', 'tint', 'video', 'nvl', 'tip', 'note', 'title', 'chapter', 'center',
]);

/** Visible type names remain semantic; selection is never encoded as a colored rail. */
function badgeTone(l: LineModel): string {
  if (l.kind === 'instr') {
    if (FLOW_CMDS.has(l.name)) return 'flow';
    if (STAGE_CMDS.has(l.name)) return 'stage';
    return 'vars';
  }
  switch (l.kind) {
    case 'text': return 'text';
    case 'label': return 'label';
    case 'choice-option': return 'choice';
    default: return 'dim';
  }
}

function sourcePathForCurrentScene(): string {
  const scene = state.current ? state.scenes.get(state.current) : undefined;
  if (!scene) return '';
  return scene.file.startsWith('content/scenario/') ? scene.file : `content/scenario/${scene.file}`;
}

function objectRefForLine(line: number): string | null {
  const sourcePath = sourcePathForCurrentScene();
  return state.authoringIndex?.objects.find((object) => object.source?.path === sourcePath && object.source.line === line + 1)?.objectRef ?? null;
}

export function refreshEditorObjectRefs(): void {
  document.querySelectorAll<HTMLElement>('#editor .block').forEach((block) => {
    const line = Number(block.dataset.line);
    const ref = Number.isInteger(line) ? objectRefForLine(line) : null;
    block.dataset.objectRef = ref ?? '';
    const selected = ref !== null && ref === state.selectedObjectRef;
    block.classList.toggle('selected', selected);
    block.setAttribute('aria-selected', String(selected));
    const marker = block.querySelector<HTMLElement>('.current-segment');
    if (marker) marker.hidden = !selected;
    const refValue = block.querySelector<HTMLElement>('.object-ref-value');
    if (refValue) refValue.textContent = ref ?? '当前行尚无对象索引';
  });
}

/** Refreshes changing scene facts without replacing focused authoring inputs. */
export function refreshManuscriptFacts(): void {
  if (!state.current) return;
  const scene = state.scenes.get(state.current);
  const article = document.querySelector<HTMLElement>(`.manuscript-sheet[data-scene-id="${CSS.escape(state.current)}"]`);
  if (!scene || !article) return;
  const characters = article.querySelector<HTMLElement>('[data-manuscript-fact="characters"]');
  const lines = article.querySelector<HTMLElement>('[data-manuscript-fact="lines"]');
  const saveState = article.querySelector<HTMLElement>('[data-manuscript-fact="save-state"]');
  if (characters) characters.textContent = `${sceneTextCharacters(scene.text)} 字`;
  if (lines) lines.textContent = `${parseScript(scene.text).length} 行`;
  if (saveState) {
    saveState.textContent = scene.dirty ? '未保存' : '已保存';
    saveState.className = scene.dirty ? 'manuscript-dirty' : 'manuscript-saved';
  }
}

export function renderEditor(): void {
  prepareScriptV4Render();
  const editorEl = document.getElementById('editor');
  if (!editorEl) return;
  editorEl.innerHTML = '';
  if (!state.current) {
    editorEl.appendChild(h('div', 'empty', '打开项目并选择一个场景开始编辑'));
    return;
  }
  const scene = state.scenes.get(state.current);
  if (!scene) {
    editorEl.appendChild(h('div', 'empty', '当前场景已不存在，请从目录重新选择'));
    return;
  }
  const lines = parseScript(currentText());
  const article = h('article', 'manuscript-sheet');
  article.dataset.editorRegion = 'manuscript';
  article.dataset.sceneId = state.current;
  article.setAttribute('aria-label', `场景 ${scene.id || state.current} 的连续剧本`);

  const heading = h('header', 'manuscript-heading');
  const headingIdentity = h('div', 'manuscript-heading-identity');
  headingIdentity.appendChild(h('div', 'manuscript-kicker', '当前场景'));
  headingIdentity.appendChild(h('h1', undefined, scene.id || state.current));
  const path = h('div', 'manuscript-path', scene.file);
  path.title = scene.file;
  headingIdentity.appendChild(path);
  const facts = h('div', 'manuscript-facts');
  const characterFact = h('span', undefined, `${sceneTextCharacters(scene.text)} 字`);
  characterFact.title = '台词与旁白的可见字数，与统计页同一口径：不含标签、指令和变量名';
  characterFact.dataset.manuscriptFact = 'characters';
  const lineFact = h('span', undefined, `${lines.length} 行`);
  lineFact.dataset.manuscriptFact = 'lines';
  const saveFact = h('span', scene.dirty ? 'manuscript-dirty' : 'manuscript-saved', scene.dirty ? '未保存' : '已保存');
  saveFact.dataset.manuscriptFact = 'save-state';
  facts.append(characterFact, lineFact, saveFact);
  heading.append(headingIdentity, facts);
  article.appendChild(heading);

  const lineList = h('div', 'manuscript-lines');
  lineList.setAttribute('role', 'listbox');
  lineList.setAttribute('aria-label', '场景行');
  lines.forEach((line, index) => {
    lineList.appendChild(renderBlock(line, index, lines.length));
  });
  article.appendChild(lineList);
  const footer = h('footer', 'manuscript-footer');
  const addBtn = h('button', 'manuscript-add-line', '＋ 在末尾追加台词');
  addBtn.type = 'button';
  addBtn.setAttribute('data-action', 'append-dialogue-line');
  addBtn.onclick = () => insertLine(lines.length - 1);
  footer.appendChild(addBtn);
  article.appendChild(footer);
  editorEl.appendChild(article);
  installScriptV4(editorEl, renderEditor);
}

function renderBlock(line: LineModel, index: number, lineCount: number): HTMLElement {
  const sceneKey = state.current;
  const scene = sceneKey === null ? undefined : state.scenes.get(sceneKey);
  let expectedRaw = line.raw;
  const objectRef = objectRefForLine(index);
  const selected = objectRef !== null && objectRef === state.selectedObjectRef;
  const block = h('section', `block block-${line.kind}${selected ? ' selected' : ''}`);
  block.dataset.line = String(index);
  block.dataset.objectRef = objectRef ?? '';
  block.tabIndex = 0;
  block.setAttribute('role', 'option');
  block.setAttribute('aria-selected', String(selected));
  block.setAttribute('aria-label', `第 ${index + 1} 行，${kindBadge(line)}`);

  const selectBlock = (): void => {
    state.selectedObjectRef = selectAuthoringObject(block.dataset.objectRef ?? null);
    document.dispatchEvent(new CustomEvent('surdet-authoring-selection'));
  };
  block.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, summary')) return;
    selectBlock();
  });
  block.addEventListener('keydown', (event) => {
    if (event.target !== block || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    selectBlock();
  });

  const bar = h('div', 'bar');
  bar.appendChild(h('span', 'continuity-line-number', String(index + 1).padStart(2, '0')));
  const badge = h('span', 'badge ' + badgeTone(line), kindBadge(line));
  bar.appendChild(badge);
  const current = h('span', 'current-segment', '当前段');
  current.hidden = !selected;
  bar.appendChild(current);
  const ops = h('span', 'ops');
  const upBtn = h('button', undefined, '↑');
  upBtn.type = 'button';
  upBtn.title = '上移这一行';
  upBtn.setAttribute('aria-label', `上移第 ${index + 1} 行`);
  upBtn.onclick = (event) => { event.stopPropagation(); moveLine(index, -1); };
  const downBtn = h('button', undefined, '↓');
  downBtn.type = 'button';
  downBtn.title = '下移这一行';
  downBtn.setAttribute('aria-label', `下移第 ${index + 1} 行`);
  downBtn.onclick = (event) => { event.stopPropagation(); moveLine(index, 1); };
  const insBtn = h('button', undefined, '＋');
  insBtn.type = 'button';
  insBtn.title = '在下方插入台词';
  insBtn.setAttribute('aria-label', `在第 ${index + 1} 行后插入台词`);
  insBtn.onclick = (event) => { event.stopPropagation(); insertLine(index); };
  const delBtn = h('button', undefined, '✕');
  delBtn.type = 'button';
  delBtn.title = '删除这一行';
  delBtn.setAttribute('aria-label', `删除第 ${index + 1} 行`);
  delBtn.onclick = (event) => { event.stopPropagation(); if (readBoundLine() !== null) deleteLine(index); };
  ops.append(upBtn, downBtn, insBtn, delBtn);
  bar.appendChild(ops);
  block.appendChild(bar);

  const fields = h('div', 'fields');
  block.appendChild(fields);

  const readBoundLine = (): LineModel | null => {
    if (!block.isConnected || sceneKey === null || scene === undefined
      || state.current !== sceneKey || state.scenes.get(sceneKey) !== scene
      || state.projectLoading || state.projectWriteLock === 'asset-relocation'
      || block.closest('[inert]') !== null) return null;
    const latest = parseScript(scene.text);
    const currentLine = latest[index];
    // A preceding @choice edit can change this row's kind without changing its
    // raw source or index. An old text control must not strip option indentation.
    if (latest.length !== lineCount || currentLine?.raw !== expectedRaw
      || currentLine.kind !== line.kind) {
      setStatus('场景内容已变化，未覆盖新内容；请重新打开当前场景后再编辑', false, 5000);
      return null;
    }
    return currentLine;
  };

  const commit = (next: LineModel): void => {
    const currentLine = readBoundLine();
    if (currentLine === null) return;
    if (next.raw === currentLine.raw) return;
    const previousKind = line.kind;
    expectedRaw = next.raw;
    line = { ...next, eol: currentLine.eol };
    updateLine(index, line);
    // A textarea may insert several physical lines. Rebuild structural rows so
    // the new source layout does not leave every old line-count binding stale.
    if (/[\r\n]/.test(next.raw)) {
      renderEditor();
      return;
    }
    block.classList.remove(`block-${previousKind}`);
    block.classList.add(`block-${line.kind}`);
    block.setAttribute('aria-label', `第 ${index + 1} 行，${kindBadge(line)}`);
    badge.className = 'badge ' + badgeTone(line);
    badge.textContent = kindBadge(line);
    const rawInput = block.querySelector<HTMLInputElement>('.raw input');
    if (rawInput && rawInput.value !== line.raw) rawInput.value = line.raw;
  };

  const renderFields = (): void => {
    fields.replaceChildren();
    const model = line;
    if (model.kind === 'text') {
      const sp = h('input', 'speaker-input');
      sp.placeholder = '说话人（可空）';
      sp.value = model.speaker;
      const val = h('input', 'wide');
      val.placeholder = '台词内容（支持 {变量} 插值与 <b>、<ruby=读音>基础字</ruby> 等行内标签）';
      val.value = model.value;
      const sep = model.sep;
      const updateText = (): void => {
        if (!sp.isConnected || !val.isConnected) return;
        commit({ ...model, speaker: sp.value, value: val.value, raw: rebuildTextRaw(sp.value, val.value, sep) });
      };
      sp.oninput = updateText;
      val.oninput = updateText;
      fields.append(sp, val);
    } else if (model.kind === 'label') {
      const name = h('input', 'wide');
      name.placeholder = '标签名';
      name.value = model.name;
      name.readOnly = true;
      const rename = h('button', undefined, '改名并更新引用'); rename.type = 'button';
      rename.onclick = () => {
        if (readBoundLine() === null) return;
        const next = window.prompt('新标签名（会同步本场景、跨场景调用与回想入口）', model.name);
        if (next === null || next === model.name) return;
        requestLabelEdit(index, expectedRaw, next);
      };
      fields.append(name, rename);
    } else if (model.kind === 'instr') {
      renderInstrFields(fields, model, readBoundLine, commit);
    } else {
      const ta = h('textarea', 'wide');
      ta.rows = 1;
      ta.value = model.raw;
      ta.oninput = () => {
        if (!ta.isConnected) return;
        const prev = index > 0 ? parseScript(currentText())[index - 1]! : null;
        const prevKind = model.kind === 'choice-option' ? 'choice' : prev ? prevKindOf(prev) : '';
        commit(parseLine(ta.value, prevKind, model.eol));
      };
      fields.appendChild(ta);
    }
  };
  renderFields();

  const technical = h('details', 'technical-details');
  const summary = h('summary', undefined, '技术信息');
  technical.appendChild(summary);
  const technicalBody = h('div', 'technical-body');
  const rawWrap = h('label', 'raw');
  rawWrap.appendChild(h('span', undefined, '原始行'));
  const rawInput = h('input', 'mono');
  rawInput.value = line.raw;
  rawInput.title = '原始行（直接编辑将重新分类该行）';
  rawInput.oninput = () => {
    const currentLine = readBoundLine();
    if (currentLine === null) return;
    const prev = index > 0 ? parseScript(currentText())[index - 1]! : null;
    const prevKind = prev ? prevKindOf(prev) : '';
    commit(parseLine(rawInput.value, prevKind, currentLine.eol));
    renderFields();
  };
  rawWrap.appendChild(rawInput);
  technicalBody.appendChild(rawWrap);
  const objectIdentity = h('div', 'object-identity');
  objectIdentity.appendChild(h('span', undefined, '对象引用'));
  objectIdentity.appendChild(h('code', 'object-ref-value', objectRef ?? '当前行尚无对象索引'));
  technicalBody.appendChild(objectIdentity);
  technical.appendChild(technicalBody);
  block.appendChild(technical);

  return block;
}

function prevKindOf(l: LineModel): string {
  if (l.kind === 'instr') return l.name === 'choice' ? 'choice' : 'instr';
  if (l.kind === 'choice-option') return 'choice-option';
  return l.kind;
}

function renderInstrFields(
  fields: HTMLElement,
  line: Extract<LineModel, { kind: 'instr' }>,
  readLine: () => LineModel | null,
  commit: (next: LineModel) => void,
): void {
  const tpl = INSTR_FIELDS[line.name];
  if (tpl !== undefined && tpl !== null && tpl.labels.length === 0) {
    fields.appendChild(h('span', 'badge dim', '无参数'));
    return;
  }
  const labels = tpl?.labels ?? ['参数（空格分隔）'];
  // Only these expression fields consume the full remaining source. Other
  // positional fields must leave extra, undisplayed arguments untouched.
  let source: InstructionFieldSource;
  try {
    source = new InstructionFieldSource(line.raw, labels.length, tpl?.restFrom ?? (tpl == null ? 0 : undefined));
  } catch {
    // A partially typed '@' remains editable in the mounted raw input.
    fields.appendChild(h('span', 'dim', '请在原始行中补全指令名'));
    return;
  }
  const writeBack = (control: HTMLElement, index: number, value: string): void => {
    if (!control.isConnected) return;
    const currentLine = readLine();
    if (currentLine?.kind !== 'instr' || currentLine.name !== line.name) return;
    try {
      const raw = source.replace(currentLine.raw, index, value);
      commit({ ...currentLine, raw });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '指令字段未修改', false, 5000);
    }
  };

  labels.forEach((labelText, index) => {
    const value = source.value(line.raw, index);
    const choices: Readonly<Record<string, string>> | undefined = index !== 0 ? undefined
      : line.name === 'particle' ? { ...PARTICLE_NAMES, off: '关闭特效' }
        : line.name === 'nvl' ? { on: '开启', off: '关闭', clear: '清空本页' }
          : line.name === 'achievement' ? { unlock: '解锁' } : undefined;
    if (choices) {
      const select = h('select'); select.setAttribute('aria-label', labelText);
      const decoded = decodeInstructionArgument(value);
      if (!(decoded in choices)) {
        const unknown = h('option', undefined, value ? `自定义：${value}` : '请选择'); unknown.value = value; select.append(unknown);
      }
      for (const [token, label] of Object.entries(choices)) {
        const option = h('option', undefined, label); option.value = token; select.append(option);
      }
      select.value = decoded in choices ? decoded : value;
      select.onchange = () => writeBack(select, index, select.value);
      fields.append(select);
      return;
    }
    if (tpl?.opSelect === index) {
      const select = h('select');
      select.setAttribute('aria-label', labelText);
      const operators = ['=', ':=', '+=', '-='];
      if (!operators.includes(value)) {
        const unknown = h('option', undefined, value || '请选择运算符');
        unknown.value = value;
        unknown.selected = true;
        select.appendChild(unknown);
      }
      for (const op of operators) {
        const option = h('option', undefined, op);
        option.value = op;
        option.selected = value === op;
        select.appendChild(option);
      }
      select.value = value;
      select.onchange = () => writeBack(select, index, select.value);
      fields.appendChild(select);
      return;
    }
    const input = h('input', index === labels.length - 1 ? 'wide' : '');
    input.placeholder = labelText;
    input.setAttribute('aria-label', labelText);
    input.value = value;
    input.oninput = () => writeBack(input, index, input.value);
    fields.appendChild(input);
  });
}
