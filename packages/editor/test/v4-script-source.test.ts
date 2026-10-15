import { describe, expect, it } from 'vitest';
import { compileScene, Lexer } from '@surdet/core';
import { parseScript, serializeScript } from '../src/model.js';
import { InstructionFieldSource } from '../src/instruction-field-source.js';
import {
  applySourceTextareaEdit, deleteStep, duplicateStep, insertStep, instructionPosition,
  moveStep, moveStepBefore, projectEditLayout, quoteAssetArgument, splitDialogue,
  setInstructionArgument, setInstructionPosition, simpleChoice, scriptSteps, stepAt, writeSimpleChoice,
} from '../src/v4/script-source.js';

const branch = '@scene test\r\n@choice\r\n  继续 -> @goto again\r\n  离开 -> @goto end\r\n@label again\r\n岚:你好\r\n@label end\r\n@end';
const separatedBranch = '@scene test\r\n@choice\r\n// 第一项说明\r\n\r\n  继续 -> @goto again\r\n\t// 第二项说明\r\n\r\n  离开 -> @goto end\r\n@label again\r\n岚:你好\r\n@label end\r\n@end';
describe('V4 source adapters use shared rows and preserve B01', () => {
  it.each(['选择“稍后 -> @goto hidden”', '选择‘稍后 -> @goto hidden’', '选择"稍后 -> @goto hidden"'])('#63 compact reader keeps a no-action quoted option as source: %s', text => {
    expect(simpleChoice(`  ${text}`)).toBeNull();
    const model = simpleChoice(`  ${text} -> @goto done`)!;
    expect(model.text).toBe(text);
    const changed = writeSimpleChoice({ ...model, target: 'next' });
    expect(changed).toBe(`  ${text} -> @goto next`);
    expect(compileScene(`@choice\n${changed}\n@label next\n@end`, 'choice.gal', 'choice').instructions.find(value => value.op === 'choice')).toMatchObject({ options: [{ label: text }] });
  });
  it.each(['选择“同意 -> 继续”', "选择'同意 -> 继续'", '选择“->@goto fake”'])('#63 follow-up writes compact choices with protected arrows: %s', text => {
    const raw = `\t${text} [if:true] -> @goto again  `;
    const model = simpleChoice(raw)!;
    expect(model.text).toBe(text);
    const changed = writeSimpleChoice({ ...model, target: 'done', condition: 'false' });
    expect(changed).toBe(`\t${text} [if:false] -> @goto done  `);
    const scene = compileScene(`@choice\n${changed}\n@label done\n@end`, 'choice.gal', 'choice');
    expect(scene.instructions.find(value => value.op === 'choice')).toMatchObject({ options: [{ label: text, when: 'false' }] });
    expect(() => writeSimpleChoice({ ...model, text: '不能 -> @goto hidden' })).toThrow();
  });
  it.each(['显示"[if:false]"', "显示'[if:false]'", '显示“[if:false]”', '显示‘[if:false]’'])('#63 simple choice edits keep quoted prose and condition strings with brackets: %s', text => {
    for (const condition of ['', 'route == "a]b"']) {
      const raw = `\t${text}${condition ? ` [if:${condition}]` : ''} -> @goto again  `;
      const value = simpleChoice(raw)!;
      expect(value).toEqual({ text, condition, target: 'again', indent: '\t', trailing: '  ' });
      expect(writeSimpleChoice(value)).toBe(raw);
      expect(writeSimpleChoice({ ...value, target: 'done' })).toBe(raw.replace('@goto again', '@goto done'));
    }
  });
  it('changes an expression parameter without dropping position or an extra argument', () => {
    expect(setInstructionArgument('  @show  lynn:uniform\tnormal  extra @ right  ', 1, 'despair'))
      .toBe('  @show  lynn:uniform\tdespair  extra @ right  ');
  });
  it('retains the previous accepted argument through several discrete picks', () => {
    let raw = setInstructionArgument('@show lynn:uniform normal @ right', 0, 'lynn:night');
    raw = setInstructionArgument(raw, 1, 'despair');
    expect(raw).toBe('@show lynn:night despair @ right');
  });
  it('preserves quoted asset spelling and escapes semantic picker values', () => {
    expect(setInstructionArgument("\t@bg 'old hall' @ fade 400", 0, "new ' hall")).toBe("\t@bg 'new \\' hall' @ fade 400");
    expect(quoteAssetArgument('a@b')).toBe('"a@b"');
  });
  it('rejects a multiline asset key rather than adding hidden instructions', () => {
    expect(() => setInstructionArgument('@bg hall', 0, 'hall\n@end')).toThrow();
  });
  it('keeps expression source as expression, not a string literal', () => {
    const fields = new InstructionFieldSource('@set score = score + 5', 3, 2);
    const raw = fields.replace('@set score = score + 5', 2, '10 + 5');
    const compiled = compileScene(`@scene s\n${raw}\n@end`, 's.gal', 's');
    const instruction = compiled.instructions.find((item) => item.op === 'set');
    expect(instruction).toMatchObject({ op: 'set', expr: '10 + 5' });
  });
  it('changes only the chosen position modifier', () => {
    expect(setInstructionPosition('@show lynn normal  @ right\t@ effect shake  ', 'left'))
      .toBe('@show lynn normal  @ left\t@ effect shake  ');
  });
  it('does not mistake a quoted at-sign for a modifier', () => {
    expect(setInstructionPosition('@show "lynn@night" normal', 'right')).toBe('@show "lynn@night" normal @ right');
  });
  it('recognizes and edits the explicit key=value position modifier', () => {
    const raw = '@show lynn:coat smile @pos=left';
    expect(instructionPosition(raw)).toBe('left');
    const edited = setInstructionPosition(raw, 'right');
    expect(edited).toBe('@show lynn:coat smile @pos=right');
    expect(new Lexer().tokenize(edited, 'position.gal').find((token) => token.type === 'instruction'))
      .toMatchObject({ modifiers: new Map([['pos', 'right']]) });
    expect(projectEditLayout(parseScript(`@scene s\n${edited}\n岚：继续`), 2).actors[0])
      .toMatchObject({ target: 'lynn:coat', position: 'right' });
  });
  it('rejects competing positions and non-bare position values', () => {
    expect(instructionPosition('@show lynn normal @ left @ right')).toBe('ambiguous');
    expect(() => setInstructionPosition('@show lynn normal @ left 3', 'center')).toThrow();
  });
  it('inserts before terminal spaces, without changing the file EOL', () => {
    expect(setInstructionPosition('@show lynn normal  ', 'center')).toBe('@show lynn normal @ center  ');
  });
  it('uses full choice groups for a selected option', () => {
    expect(stepAt(parseScript(branch), 3)).toEqual({ start: 1, end: 3 });
    expect(scriptSteps(parseScript(branch))).toHaveLength(6);
  });
  it('deletes a choice as a group, not just its header', () => {
    expect(deleteStep(branch, 2).text).toBe('@scene test\r\n@label again\r\n岚:你好\r\n@label end\r\n@end');
  });
  it('inserts after all options rather than in the middle of a choice', () => {
    expect(insertStep(branch, 2, ['@wait 500']).text).toContain('  离开 -> @goto end\r\n@wait 500\r\n@label again');
  });
  it('duplicates all options', () => {
    expect(duplicateStep(branch, 3).text.match(/@choice/g)).toHaveLength(2);
    expect(duplicateStep(branch, 3).text.match(/继续/g)).toHaveLength(2);
  });
  it('moves the group without detaching options', () => {
    expect(moveStep(branch, 2, 1).text).toContain('@label again\r\n@choice\r\n  继续');
  });
  it('groups Core-supported choices across their intervening comments and blank rows', () => {
    const program = compileScene(separatedBranch, 'test.gal', 'test');
    expect(program.instructions.find(instruction => instruction.op === 'choice')).toMatchObject({ options: [{ label: '继续' }, { label: '离开' }] });
    const rows = parseScript(separatedBranch);
    for (const index of [1, 2, 3, 4, 5, 6, 7]) expect(stepAt(rows, index)).toEqual({ start: 1, end: 7 });
    expect(scriptSteps(rows)).toHaveLength(scriptSteps(parseScript(branch)).length);
  });
  it('deletes the complete supported choice rather than leaving detached options', () => {
    expect(deleteStep(separatedBranch, 4).text).toBe('@scene test\r\n@label again\r\n岚:你好\r\n@label end\r\n@end');
  });
  it('duplicates the complete supported choice rather than a single detached option', () => {
    const duplicated = compileScene(duplicateStep(separatedBranch, 4).text, 'test.gal', 'test');
    const choices = duplicated.instructions.filter(instruction => instruction.op === 'choice');
    expect(choices).toHaveLength(2);
    for (const choice of choices) expect(choice.options.map(option => option.label)).toEqual(['继续', '离开']);
  });
  it('keeps separators following the final option outside the choice step, including unfinished choices', () => {
    const source = '@choice\n  继续 -> @goto again\n\n// 下一段说明\n@label again\n@end';
    const rows = parseScript(source);
    expect(stepAt(rows, 0)).toEqual({ start: 0, end: 1 });
    expect(stepAt(rows, 2)).toEqual({ start: 2, end: 2 });
    expect(stepAt(rows, 3)).toEqual({ start: 3, end: 3 });
    expect(deleteStep(source, 1).text).toBe('\n// 下一段说明\n@label again\n@end');
    expect(scriptSteps(parseScript('@choice\n\n// 继续输入\n'))).toEqual([{ start: 0, end: 0 }, { start: 1, end: 1 }, { start: 2, end: 2 }]);
  });
  it.each(['button', 'pointer'] as const)('moves all supported choice rows through %s ordering', mode => {
    const edited = mode === 'button' ? moveStep(separatedBranch, 7, 1) : moveStepBefore(separatedBranch, 4, 9);
    const choiceSource = separatedBranch.slice(separatedBranch.indexOf('@choice'), separatedBranch.indexOf('@label again'));
    expect(edited.text).toContain(choiceSource);
    const program = compileScene(edited.text, 'test.gal', 'test');
    expect(program.instructions.find(instruction => instruction.op === 'choice')).toMatchObject({ options: [{ label: '继续' }, { label: '离开' }] });
  });
  it('preserves the file terminal newline after moving its last row', () => {
    expect(moveStep('a\r\nb', 1, -1).text).toBe('b\r\na');
    expect(moveStep('a\r\nb\r\n', 1, -1).text).toBe('b\r\na\r\n');
  });
  it('pointer placement within the same group is a no-op', () => {
    expect(moveStepBefore(branch, 1, 3).text).toBe(branch);
  });
  it('inserts into an empty document', () => { expect(insertStep('', 0, ['岚：开始']).text).toBe('岚：开始'); });
  it('splits at the UTF-16 caret, retaining indentation, speaker spacing and mixed EOL elsewhere', () => {
    expect(splitDialogue('@scene x\n  岚:  你好😀继续\r\n@end', 1, 4, 4)).toEqual({
      text: '@scene x\n  岚:  你好😀\r\n  岚:  继续\r\n@end', selectedLine: 2,
    });
  });
  it.each(['\u2028', '\u2029'])('keeps source offsets when a previous dialogue contains %j', (separator) => {
    const source = `@scene x\r\n林汀：原句${separator}原样保留\n周渡：前句后句\r@end`;
    expect(splitDialogue(source, 2, 2, 2)).toEqual({
      text: source.replace('周渡：前句后句', '周渡：前句\r周渡：后句'), selectedLine: 3,
    });
  });
  it('replaces the selected dialogue range and keeps the file terminal shape', () => {
    expect(splitDialogue('岚：开始删掉结尾', 0, 2, 4).text).toBe('岚：开始\n岚：结尾');
    expect(splitDialogue('岚：你好\r\n', 0, 2, 2).text).toBe('岚：你好\r\n岚：\r\n');
  });
  it('splits narration without inventing a speaker or losing text at either boundary', () => {
    expect(splitDialogue('旁白正文', 0, 0, 0).text).toBe('\n旁白正文');
    const terminal = splitDialogue('旁白正文', 0, 4, 4);
    expect(terminal.text).toBe('旁白正文\n\n');
    expect(parseScript(terminal.text)[terminal.selectedLine]?.kind).toBe('blank');
    expect(splitDialogue('旁白正文', 0, 2, 2).text).toBe('旁白\n正文');
  });
  it('rejects stale positions and non-dialogue rows', () => {
    expect(() => splitDialogue('@bg hall', 0, 0, 0)).toThrow();
    expect(() => splitDialogue('岚：短句', 0, 3, 3)).toThrow();
  });
  it('source view round-trip is exactly unchanged', () => {
    const raw = '@scene x\r\n岚:原文\nhttps://example.org\r@end';
    expect(applySourceTextareaEdit(raw, raw.replace(/\r\n|\r/g, '\n'))).toBe(raw);
  });
  it('maps a middle textarea edit to the original CRLF and terminal shape', () => {
    expect(applySourceTextareaEdit('@scene x\r\n岚:原文', '@scene x\n岚:修改')).toBe('@scene x\r\n岚:修改');
  });
  it('does not normalize unrelated mixed newline rows', () => {
    expect(applySourceTextareaEdit('a\r\nb\nc\r', 'a\nB\nc\n')).toBe('a\r\nB\nc\r');
  });
  it('keeps URL, time and hash-leading text in the shared model', () => {
    for (const raw of ['https://example.org', '12:30', '#正文']) {
      expect(parseScript(raw)[0]).toMatchObject({ kind: 'text', speaker: '' });
    }
  });
  it('only exposes a single-goto choice as a simple form', () => {
    expect(simpleChoice('  继续 [if:score > 5] -> @goto again')).toMatchObject({ text: '继续', condition: 'score > 5', target: 'again' });
    expect(simpleChoice('  继续 -> @mod score +1 @goto again')).toBeNull();
    expect(simpleChoice('  继续 -> @jump other')).toBeNull();
  });
  it('does not simplify an empty if condition marker', () => {
    expect(simpleChoice('  继续 [if:] -> @goto again')).toBeNull();
  });
  it('preserves arbitrary complex choice source by refusing simplified edits', () => {
    const raw = '  路线 [if:score > 5] -> @mod score +2 @goto again';
    expect(simpleChoice(raw)).toBeNull();
    expect(parseScript('@choice\n' + raw)[1]?.raw).toBe(raw);
  });
  it('round-trips nested conditions, choice effects and unknown instructions without dropping source rows', () => {
    const raw = [
      '@scene test',
      '@if route == "north"',
      '  @choice',
      '    继续 [if:hasMap] -> @set route = "north" @mod trust +2 @goto north',
      '    离开 -> @jump exit',
      '    保留 -> @mystery opaque @goto hidden',
      '  @endif',
      '@endif',
      '@mystery top-level payload',
      '@end',
    ].join('\r\n');
    const lines = parseScript(raw);
    expect(lines.filter((line) => line.kind === 'choice-option').map((line) => line.raw)).toEqual([
      '    继续 [if:hasMap] -> @set route = "north" @mod trust +2 @goto north',
      '    离开 -> @jump exit',
      '    保留 -> @mystery opaque @goto hidden',
    ]);
    expect(serializeScript(lines, '\r\n')).toBe(raw);
    expect(applySourceTextareaEdit(raw, raw.replace('opaque @goto hidden', 'opaque changed @goto hidden')))
      .toContain('保留 -> @mystery opaque changed @goto hidden');
  });
  it('retains editable empty intermediate choice labels', () => {
    const next = writeSimpleChoice({ text: '', condition: '', target: 'again', indent: '  ', trailing: '' });
    expect(next).toBe('   -> @goto again');
    expect(simpleChoice(next)?.text).toBe('');
  });
  it('shows a static source arrangement without evaluating variables', () => {
    const projection = projectEditLayout(parseScript('@scene s\n@bg hall\n@show lynn:uniform normal @ right\n岚：{score}'), 3);
    expect(projection.actors[0]).toMatchObject({ target: 'lynn:uniform', position: 'right', line: 2 });
    expect(projection.dialogue?.value).toBe('{score}');
  });
  it.each(['@timeline intro', '@if score > 0', '@jump other', '@mov lynn right 600'])('does not fabricate the result of %s', (barrier) => {
    const projection = projectEditLayout(parseScript(`@scene s\n@bg hall\n${barrier}\n岚：继续`), 3);
    expect(projection.reason).not.toBeNull(); expect(projection.background).toBeNull();
  });
  it('incomplete quoted drafts do not crash the edit layout', () => {
    expect(projectEditLayout(parseScript('@show "unfinished'), 0).reason).not.toBeNull();
  });
  it('does not pretend additional visual modifiers were rendered', () => {
    expect(projectEditLayout(parseScript('@show lynn normal @ effect shake'), 0).reason).not.toBeNull();
  });
});
