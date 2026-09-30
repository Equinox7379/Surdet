import { state, type SceneEntry } from '../../src/state.js';
import { bindHistoryHooks, histories, undo, redo } from '../../src/history.js';
import { renderEditor, insertLine, moveLine } from '../../src/panels/editor.js';

function equal(actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) return;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing test element');
  return value;
}

function scene(key: string, text: string): SceneEntry {
  return { id: key.split('/').at(-1)!, file: `${key}.gal`, text, eol: text.includes('\r\n') ? '\r\n' : '\n', dirty: false, handle: null };
}

function mount(text: string): void {
  document.body.replaceChildren();
  const editor = document.createElement('div');
  editor.id = 'editor';
  document.body.appendChild(editor);
  state.scenes.clear();
  histories.clear();
  state.current = 'chapter/start';
  state.scenes.set(state.current, scene(state.current, text));
  state.authoringIndex = null;
  state.selectedObjectRef = null;
  state.projectLoading = false;
  state.projectWriteLock = null;
  bindHistoryHooks({ onEdited: () => {}, onHistoryNav: renderEditor });
  renderEditor();
}

function text(): string { return present(state.scenes.get(present(state.current))).text; }
function block(index = 0): HTMLElement { return present(document.querySelectorAll<HTMLElement>('#editor .block')[index]); }
function fields(index = 0): Array<HTMLInputElement | HTMLSelectElement> {
  return [...block(index).querySelectorAll<HTMLInputElement | HTMLSelectElement>('.fields input, .fields select')];
}
function raw(index = 0): HTMLInputElement { return present(block(index).querySelector<HTMLInputElement>('.raw input')); }
function input(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  control.value = value;
  control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

/** Same production-module cases run in Vitest's small DOM fixture and Chromium. */
export const instructionWritebackCases: ReadonlyArray<{ name: string; run: () => void }> = [
  { name: 'Chinese particle choices preserve script tokens, suffixes and undo', run() {
    mount('@particle "snow" @ custom keep\r\n凛：继续');
    const control = present(fields()[0]);
    equal(control.value, 'snow');
    equal([...control.querySelectorAll('option')].some(option => option.textContent === '飘雪'), true);
    input(control, 'sakura');
    equal(text(), '@particle sakura @ custom keep\r\n凛：继续');
    undo(); equal(text(), '@particle "snow" @ custom keep\r\n凛：继续');
  } },
  { name: 'Chinese reading and achievement modes do not rewrite unrelated parameters', run() {
    mount('@nvl on\n@achievement unlock first');
    input(present(fields()[0]), 'off');
    input(present(fields(1)[1]), 'second');
    equal(text(), '@nvl off\n@achievement unlock second');
  } },
  { name: 'unknown preset values remain visible and unchanged until an explicit selection', run() {
    mount('@particle future-preset');
    equal(present(fields()[0]).value, 'future-preset');
    equal(text(), '@particle future-preset');
    equal([...present(fields()[0]).querySelectorAll('option')].some(option => option.textContent === '自定义：future-preset'), true);
  } },
  { name: 'B01 keeps the modifier when editing the expression field', run() {
    mount('@show lynn:uniform normal @ right');
    input(present(fields()[1]), 'despair');
    equal(text(), '@show lynn:uniform despair @ right');
    equal(raw().value, text());
  } },
  { name: 'B01 keeps earlier edits when a sibling field changes', run() {
    mount('@show lynn:uniform normal');
    const controls = fields();
    input(present(controls[0]), 'lynn:night');
    input(present(controls[1]), 'despair');
    input(present(controls[0]), 'lynn:casual');
    equal(text(), '@show lynn:casual despair');
    equal(fields()[0], controls[0]);
  } },
  { name: 'editing one parameter preserves indentation, extra arguments and every EOL', run() {
    mount('// untouched\r\n\t@mov   lynn\tleft  600 extra @ easing outCubic  \r\n凛:原台词');
    input(present(fields(1)[1]), 'right');
    equal(text(), '// untouched\r\n\t@mov   lynn\tright  600 extra @ easing outCubic  \r\n凛:原台词');
  } },
  { name: 'set exposes and replaces the full expression without quoting it', run() {
    mount('@set score = base + bonus * 2 @ custom "a @ b"');
    equal(present(fields()[2]).value, 'base + bonus * 2');
    input(present(fields()[0]), 'total');
    input(present(fields()[2]), '(base + bonus) * 3');
    input(present(fields()[1]), ':=');
    equal(text(), '@set total := (base + bonus) * 3 @ custom "a @ b"');
  } },
  { name: 'if and elif preserve full conditions rather than just the first token', run() {
    mount('@if trust >= 5 && route == "A @ B"\n@elif trust < 2\n@endif');
    equal(present(fields()[0]).value, 'trust >= 5 && route == "A @ B"');
    input(present(fields()[0]), 'trust >= 8 && route == "C"');
    input(present(fields(1)[0]), 'trust == 0 || override');
    equal(text(), '@if trust >= 8 && route == "C"\n@elif trust == 0 || override\n@endif');
  } },
  { name: 'valid := and an unrecognized operator are not misrepresented as =', run() {
    mount('@set score := 5');
    equal(present(fields()[1]).value, ':=');
    input(raw(), '@set score ?? base + 1');
    equal(present(fields()[1]).value, '??');
    input(present(fields()[2]), 'base + 2');
    equal(text(), '@set score ?? base + 2');
  } },
  { name: 'unknown instruction body preserves quoted whitespace and modifier suffix', run() {
    mount('  @custom  "a  b @ c"  x\t y  @ tag "v @ w"  ');
    equal(present(fields()[0]).value, '"a  b @ c"  x\t y');
    input(present(fields()[0]), '"d  e @ f"  z');
    equal(text(), '  @custom  "d  e @ f"  z  @ tag "v @ w"  ');
  } },
  { name: 'quoted scalar input is kept as source instead of double quoting', run() {
    mount('@bg "old room" @ transition fade');
    input(present(fields()[0]), '"new room @ sunset"');
    equal(text(), '@bg "new room @ sunset" @ transition fade');
  } },
  { name: 'empty positional field does not shift the following argument', run() {
    mount('@show lynn:uniform normal @ right');
    const controls = fields();
    input(present(controls[0]), '');
    equal(text(), '@show "" normal @ right');
    input(present(controls[1]), 'happy');
    input(present(controls[0]), 'lynn:night');
    equal(text(), '@show lynn:night happy @ right');
  } },
  { name: 'missing positions can be filled out of order without stealing modifiers', run() {
    mount('@show @ right');
    input(present(fields()[1]), 'happy');
    equal(text(), '@show "" happy @ right');
    input(present(fields()[0]), 'lynn:night');
    equal(text(), '@show lynn:night happy @ right');
  } },
  { name: 'unfinished quotes retain the same field boundary for later edits', run() {
    mount('@show lynn:uniform normal @ right');
    const controls = fields();
    input(present(controls[0]), '"night');
    input(present(controls[1]), 'happy');
    input(present(controls[0]), '"night dress"');
    equal(text(), '@show "night dress" happy @ right');
  } },
  { name: 'multiple source tokens in a field do not erase an adjacent edit', run() {
    mount('@mov lynn left 600 @ easing linear');
    const controls = fields();
    input(present(controls[0]), 'lynn extra');
    input(present(controls[2]), '900');
    equal(text(), '@mov lynn extra left 900 @ easing linear');
    input(present(controls[0]), 'lynn');
    equal(text(), '@mov lynn left 900 @ easing linear');
  } },
  { name: 'raw changes refresh typed fields and old detached controls cannot write', run() {
    mount('@show lynn:uniform normal @ right');
    const old = present(fields()[0]);
    const source = raw();
    input(source, '@show lynn:night smile @ left');
    equal(raw(), source);
    equal(present(fields()[0]).value, 'lynn:night');
    input(old, 'STALE');
    input(present(fields()[1]), 'happy');
    equal(text(), '@show lynn:night happy @ left');
  } },
  { name: 'raw reclassification permits partial instruction names without throwing', run() {
    mount('@show lynn normal');
    const source = raw();
    input(source, '@');
    equal(text(), '@');
    equal(fields().length, 0);
    input(source, '@bg room');
    equal(present(fields()[0]).value, 'room');
    input(present(fields()[0]), 'hall');
    equal(text(), '@bg hall');
    input(source, '凛:你好');
    const speech = fields();
    input(present(speech[1]), '晚安');
    equal(text(), '凛:晚安');
  } },
  { name: 'detached text controls cannot revert a newly reclassified instruction', run() {
    mount('凛:原话');
    const old = present(fields()[1]);
    input(raw(), '@bg hall');
    input(old, '迟到输入');
    equal(text(), '@bg hall');
  } },
  { name: 'separate scenes retain separate undo and redo histories', run() {
    mount('@show lynn normal @ right');
    input(present(fields()[1]), 'happy');
    state.scenes.set('other/start', scene('other/start', '@bg garden'));
    state.current = 'other/start';
    renderEditor();
    input(present(fields()[0]), 'roof');
    state.current = 'chapter/start';
    renderEditor();
    undo();
    equal(text(), '@show lynn normal @ right');
    equal(present(state.scenes.get('other/start')).text, '@bg roof');
    redo();
    equal(text(), '@show lynn happy @ right');
  } },
  { name: 'stale controls cannot write into another scene even before a repaint', run() {
    mount('@bg room');
    const old = present(fields()[0]);
    state.scenes.set('other/start', scene('other/start', '@bg garden'));
    state.current = 'other/start';
    input(old, 'STALE');
    equal(text(), '@bg garden');
    equal(present(state.scenes.get('chapter/start')).text, '@bg room');
  } },
  { name: 'scene identity changes cannot be hidden behind the same key', run() {
    mount('@bg room');
    const old = present(fields()[0]);
    state.scenes.set('chapter/start', scene('chapter/start', '@bg room'));
    input(old, 'STALE');
    equal(text(), '@bg room');
  } },
  { name: 'out-of-band row changes are not overwritten by old source ranges', run() {
    mount('@bg room');
    const old = present(fields()[0]);
    present(state.scenes.get(present(state.current))).text = '@bg newer @ keep';
    input(old, 'STALE');
    equal(text(), '@bg newer @ keep');
  } },
  { name: 'line insertion and movement invalidate previous mounted field controls', run() {
    mount('@bg room\n@wait 50');
    const old = present(fields()[0]);
    insertLine(0);
    input(old, 'STALE');
    equal(text(), '@bg room\n新台词\n@wait 50');
    const beforeMove = present(fields()[0]);
    moveLine(0, 1);
    input(beforeMove, 'STALE');
    equal(text(), '新台词\n@bg room\n@wait 50');
  } },
  { name: 'another row editing does not falsely stale the active instruction', run() {
    mount('@bg room\n@wait 50');
    const first = present(fields()[0]);
    input(present(fields(1)[0]), '80');
    input(first, 'hall');
    equal(text(), '@bg hall\n@wait 80');
  } },
  { name: 'a preceding choice reclassification invalidates stale text and choice controls', run() {
    mount('@bg room\n  A -> @goto a');
    const oldText = present(fields(1)[1]);
    input(raw(), '@choice');
    input(oldText, 'CHANGED -> @goto b');
    equal(text(), '@choice\n  A -> @goto a');

    mount('@choice\n  A -> @goto a');
    const oldChoice = present(block(1).querySelector<HTMLTextAreaElement>('.fields textarea'));
    input(raw(), '@bg room');
    oldChoice.value = '  CHANGED -> @goto b';
    oldChoice.dispatchEvent(new Event('input', { bubbles: true }));
    equal(text(), '@bg room\n  A -> @goto a');
  } },
  { name: 'IME-like input updates preserve the mounted input and final source', run() {
    mount('@bg room @ keep');
    const control = present(fields()[0]);
    control.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    input(control, 'hua');
    input(control, '花');
    control.dispatchEvent(new Event('compositionend', { bubbles: true }));
    input(control, '花园');
    equal(fields()[0], control);
    equal(text(), '@bg 花园 @ keep');
  } },
  { name: 'no-op field input does not dirty content or create a history entry', run() {
    mount('@bg room @ keep');
    input(present(fields()[0]), 'room');
    equal(present(state.scenes.get(present(state.current))).dirty, false);
    equal(histories.size, 0);
  } },
  { name: 'inert and project write freezes also reject programmatic field events', run() {
    mount('@bg room');
    const control = present(fields()[0]);
    present(document.getElementById('editor')).setAttribute('inert', '');
    input(control, 'ignored');
    equal(text(), '@bg room');
    present(document.getElementById('editor')).removeAttribute('inert');
    state.projectWriteLock = 'asset-relocation';
    input(control, 'ignored');
    equal(text(), '@bg room');
    state.projectWriteLock = null;
    input(control, 'hall');
    equal(text(), '@bg hall');
  } },
  { name: 'LF, CRLF, CR and mixed source endings survive a field edit', run() {
    for (const [eol, lastEol] of [['\n', '\n'], ['\r\n', '\r\n'], ['\r', '\r'], ['\r\n', '\n']]) {
      mount(`// keep${eol}@bg room @ keep${lastEol}凛:原台词`);
      input(present(fields(1)[0]), 'hall');
      equal(text(), `// keep${eol}@bg hall @ keep${lastEol}凛:原台词`);
    }
  } },
  { name: 'coalesced field edits undo to the original and redo to the final source', run() {
    mount('@mov lynn left 600 @ easing linear');
    const realNow = Date.now;
    try {
      Date.now = () => 10000;
      input(present(fields()[0]), 'lynn:night');
      input(present(fields()[1]), 'right');
      input(present(fields()[2]), '900');
      undo();
      equal(text(), '@mov lynn left 600 @ easing linear');
      redo();
      equal(text(), '@mov lynn:night right 900 @ easing linear');
    } finally { Date.now = realNow; }
  } },
  { name: 'an unchanged empty generic body does not introduce whitespace or dirty state', run() {
    mount('@custom @ keep');
    input(present(fields()[0]), '');
    equal(text(), '@custom @ keep');
    equal(present(state.scenes.get(present(state.current))).dirty, false);
  } },
  { name: 'multiline textarea edits rebuild row bindings instead of freezing later input', run() {
    mount('// one');
    const textarea = present(block().querySelector<HTMLTextAreaElement>('.fields textarea'));
    textarea.value = '// one\n// two';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    equal(text(), '// one\n// two');
    equal(document.querySelectorAll('#editor .block').length, 2);
    input(raw(1), '// next');
    equal(text(), '// one\n// next');
  } },
];
