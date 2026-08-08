/**
 * 块式编辑区（E0 拆分：原 main.ts 纯搬移）。
 * raw 行为事实来源：类型化控件只是编辑糖；行级编辑经 history 入撤销栈。
 */
import { state, h } from '../state.js';
import { setCurrentText } from '../history.js';
import {
  parseScript, serializeScript, parseLine, splitInstr, rebuildInstrRaw, rebuildTextRaw, rebuildLabelRaw,
} from '../model.js';
import type { LineModel } from '../model.js';

export function currentText(): string {
  return state.current ? state.scenes.get(state.current)?.text ?? '' : '';
}

/** 当前场景的换行风格（序列化时保持源文件风格） */
export function currentEol(): string {
  return state.current ? state.scenes.get(state.current)?.eol ?? '\n' : '\n';
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
  lines.splice(index, 1);
  setCurrentText(serializeScript(lines, currentEol()));
  renderEditor();
}

export function insertLine(index: number): void {
  const lines = parseScript(currentText());
  lines.splice(index + 1, 0, { kind: 'text', speaker: '', value: '新台词', sep: '：', raw: '新台词' });
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
  setCurrentText(serializeScript(lines, currentEol()));
  renderEditor();
}

/** 指令类型化编辑模板：指令名 → 位置参数字段（null = 整体参数单输入） */
export const INSTR_FIELDS: Record<string, { labels: string[]; opSelect?: number } | null> = {
  bg: { labels: ['背景 key'] },
  show: { labels: ['角色:服装', '表情/第二参数'] },
  hide: { labels: ['角色'] },
  voice: { labels: ['语音 key'] },
  bgm: { labels: ['音乐 key'] },
  se: { labels: ['音效 key'] },
  fadein: { labels: ['毫秒'] },
  fadeout: { labels: ['毫秒'] },
  wait: { labels: ['毫秒'] },
  set: { labels: ['变量', '运算符', '表达式'], opSelect: 1 },
  mod: { labels: ['变量', '增量'] },
  inc: { labels: ['变量'] },
  dec: { labels: ['变量'] },
  toggle: { labels: ['变量'] },
  flag: { labels: ['变量'] },
  unflag: { labels: ['变量'] },
  if: { labels: ['条件表达式'] },
  elif: { labels: ['条件表达式'] },
  goto: { labels: ['标签'] },
  loop: { labels: ['标签'] },
  jump: { labels: ['场景.标签'] },
  call: { labels: ['场景.标签'] },
  unlock_cg: { labels: ['CG id'] },
  unlock_music: { labels: ['音乐 id'] },
  unlock_text: { labels: ['回想 id'] },
  add_item: { labels: ['数组变量', '道具 ID'] },
  remove_item: { labels: ['数组变量', '道具 ID'] },
  has_item: { labels: ['数组变量', '道具 ID', '结果变量'] },
  particle: { labels: ['预设'] },
  mov: { labels: ['角色', '位置', '毫秒'] },
  tint: { labels: ['颜色 hex', '透明度', '毫秒'] },
  clear: { labels: ['结局 ID（缺省=当前场景）'] },
  exp: { labels: ['角色 ID', '经验值'] },
  achievement: { labels: ['模式（unlock）', '成就 ID'] },
  choice: { labels: [] },
};

function kindBadge(l: LineModel): string {
  switch (l.kind) {
    case 'text': return '台词';
    case 'label': return '标签';
    case 'instr': return '@' + l.name;
    case 'choice-option': return '选项';
    case 'comment': return '注释';
    default: return '空行';
  }
}

/* UI 第二阶段：块类型色带 —— 左侧色条 + 徽章分色，行类型一眼可辨 */
const FLOW_CMDS = new Set(['goto', 'jump', 'call', 'if', 'elif', 'loop', 'choice', 'switch']);
const STAGE_CMDS = new Set([
  'bg', 'show', 'hide', 'bgm', 'ambience', 'se', 'voice', 'flash', 'shake', 'wipe', 'zoom', 'transition', 'wait',
  'fadein', 'fadeout', 'particle', 'mov', 'tint', 'video', 'nvl', 'tip', 'note', 'title', 'chapter', 'center',
]);

/** 块色带类（CSS 的 .block.t-* 左色条） */
function blockTone(l: LineModel): string {
  if (l.kind === 'instr') {
    if (FLOW_CMDS.has(l.name)) return 't-flow';
    if (STAGE_CMDS.has(l.name)) return 't-stage';
    return 't-vars';
  }
  switch (l.kind) {
    case 'text': return 't-text';
    case 'label': return 't-label';
    case 'choice-option': return 't-choice';
    default: return 't-dim';
  }
}

/** 徽章分色类（CSS 的 .badge.*；与块色带同语义） */
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

export function renderEditor(): void {
  const editorEl = document.getElementById('editor');
  if (!editorEl) return;
  editorEl.innerHTML = '';
  if (!state.current) {
    editorEl.appendChild(h('div', 'empty', '打开项目并选择一个场景开始编辑'));
    return;
  }
  const lines = parseScript(currentText());
  lines.forEach((line, index) => {
    editorEl.appendChild(renderBlock(line, index));
  });
  const addBtn = h('button', undefined, '＋ 在末尾追加台词');
  addBtn.onclick = () => insertLine(lines.length - 1);
  editorEl.appendChild(addBtn);
}

function renderBlock(line: LineModel, index: number): HTMLElement {
  const block = h('div', 'block ' + blockTone(line));
  block.dataset.line = String(index);

  const bar = h('div', 'bar');
  bar.appendChild(h('span', 'badge ' + badgeTone(line), kindBadge(line)));
  const ops = h('span', 'ops');
  const upBtn = h('button', undefined, '↑');
  upBtn.onclick = () => moveLine(index, -1);
  const downBtn = h('button', undefined, '↓');
  downBtn.onclick = () => moveLine(index, 1);
  const insBtn = h('button', undefined, '＋');
  insBtn.onclick = () => insertLine(index);
  const delBtn = h('button', undefined, '✕');
  delBtn.onclick = () => deleteLine(index);
  ops.append(upBtn, downBtn, insBtn, delBtn);
  bar.appendChild(ops);
  block.appendChild(bar);

  const fields = h('div', 'fields');
  block.appendChild(fields);

  const commit = (next: LineModel): void => {
    updateLine(index, next);
    const rawInput = block.querySelector<HTMLInputElement>('.raw input');
    if (rawInput) rawInput.value = next.raw;
  };

  if (line.kind === 'text') {
    const sp = h('input');
    sp.placeholder = '说话人（可空）';
    sp.value = line.speaker;
    sp.style.width = '110px';
    const val = h('input', 'wide');
    val.placeholder = '台词内容（支持 {变量} 插值与 基础字《注音》）';
    val.value = line.value;
    const sep = line.sep;
    sp.oninput = () => commit({ ...line, speaker: sp.value, raw: rebuildTextRaw(sp.value, val.value, sep) });
    val.oninput = () => commit({ ...line, value: val.value, raw: rebuildTextRaw(sp.value, val.value, sep) });
    fields.append(sp, val);
  } else if (line.kind === 'label') {
    const name = h('input', 'wide');
    name.placeholder = '标签名';
    name.value = line.name;
    name.oninput = () => commit({ ...line, name: name.value, raw: rebuildLabelRaw(name.value) });
    fields.appendChild(name);
  } else if (line.kind === 'instr') {
    renderInstrFields(fields, line, commit);
  } else {
    const ta = h('textarea', 'wide');
    ta.rows = line.kind === 'choice-option' ? 1 : 1;
    ta.value = line.raw;
    ta.oninput = () => {
      const prev = index > 0 ? parseScript(currentText())[index - 1]! : null;
      const prevKind = line.kind === 'choice-option' ? 'choice' : prev ? prevKindOf(prev) : '';
      commit(parseLine(ta.value, prevKind));
    };
    fields.appendChild(ta);
  }

  // raw 行（事实来源，可直接编辑任意内容）
  const rawWrap = h('div', 'raw');
  const rawInput = h('input', 'mono');
  rawInput.value = line.raw;
  rawInput.title = '原始行（直接编辑将重新分类该行）';
  rawInput.oninput = () => {
    const prev = index > 0 ? parseScript(currentText())[index - 1]! : null;
    const prevKind = prev ? prevKindOf(prev) : '';
    updateLine(index, parseLine(rawInput.value, prevKind));
  };
  rawWrap.appendChild(rawInput);
  block.appendChild(rawWrap);

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
  commit: (next: LineModel) => void,
): void {
  const { name, args } = splitInstr(line.raw);
  const tpl = INSTR_FIELDS[name];

  const writeBack = (newArgs: string[]): void => {
    commit({ ...line, raw: rebuildInstrRaw(name, newArgs) });
  };

  if (tpl === undefined) {
    // 未知指令：整体参数单输入
    const input = h('input', 'wide');
    input.placeholder = '参数（空格分隔）';
    input.value = args.join(' ');
    input.oninput = () => writeBack(input.value.split(/\s+/).filter((s) => s.length > 0));
    fields.appendChild(input);
    return;
  }
  if (tpl === null || tpl.labels.length === 0) {
    fields.appendChild(h('span', 'badge dim', '无参数'));
    return;
  }

  tpl.labels.forEach((labelText, i) => {
    if (tpl.opSelect === i) {
      const sel = h('select');
      for (const op of ['=', '+=', '-=']) {
        const opt = h('option', undefined, op);
        opt.value = op;
        if ((args[i] ?? '') === op) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => {
        const next = [...args];
        next[i] = sel.value;
        writeBack(next);
      };
      fields.appendChild(sel);
      return;
    }
    const input = h('input', i === tpl.labels.length - 1 ? 'wide' : '');
    input.placeholder = labelText;
    input.value = args[i] ?? '';
    input.oninput = () => {
      const next = [...args];
      next[i] = input.value;
      writeBack(next);
    };
    fields.appendChild(input);
  });
}
