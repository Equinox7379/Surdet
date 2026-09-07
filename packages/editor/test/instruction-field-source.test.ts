import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { InstructionFieldSource } from '../src/instruction-field-source.js';
import { splitInstr } from '../src/model.js';

describe('lossless instruction field source slices', () => {
  it('preserves all bytes outside the selected scalar, including modifiers', () => {
    const raw = '\t@show   lynn:uniform\tnormal extra  @ right @ duration 600  ';
    const source = new InstructionFieldSource(raw, 2);
    expect(source.replace(raw, 1, 'happy')).toBe('\t@show   lynn:uniform\thappy extra  @ right @ duration 600  ');
  });

  it('uses accepted ranges for three consecutive sibling edits', () => {
    let raw = '@mov lynn left 600 @ easing linear';
    const source = new InstructionFieldSource(raw, 3);
    raw = source.replace(raw, 0, 'another_character');
    raw = source.replace(raw, 2, '1200');
    raw = source.replace(raw, 1, 'right');
    expect(raw).toBe('@mov another_character right 1200 @ easing linear');
  });

  it('locates a repeated token by source position, not first occurrence', () => {
    const raw = '@show show show @ show';
    const source = new InstructionFieldSource(raw, 2);
    expect(source.replace(raw, 1, 'happy')).toBe('@show show happy @ show');
  });

  it('keeps quoted whitespace, escaped quotes and literal @ characters', () => {
    const raw = String.raw`@custom "a  \"b\" @ c"  'x \' y' @ note "keep @ here"`;
    const source = new InstructionFieldSource(raw, 1, 0);
    expect(source.value(raw, 0)).toBe(String.raw`"a  \"b\" @ c"  'x \' y'`);
    const changed = source.replace(raw, 0, String.raw`"new  @ text"  'x \' y'`);
    expect(changed).toBe(String.raw`@custom "new  @ text"  'x \' y' @ note "keep @ here"`);
  });

  it('does not double quote a scalar source lexeme', () => {
    const raw = '@bg "old room" @ keep';
    const source = new InstructionFieldSource(raw, 1);
    const changed = source.replace(raw, 0, '"new room"');
    expect(changed).toBe('@bg "new room" @ keep');
    expect(splitInstr(changed).args).toEqual(['"new room"']);
  });

  it('updates a full set expression while preserving the expression type', () => {
    const raw = '@set score = base + bonus * 2';
    const source = new InstructionFieldSource(raw, 3, 2);
    expect(source.value(raw, 2)).toBe('base + bonus * 2');
    const changed = source.replace(raw, 2, '(base + bonus) * 3');
    const compiled = compileScene(`${changed}\n@end`, 'source.gal', 'source');
    expect(compiled.instructions.find((instruction) => instruction.op === 'set')).toMatchObject({
      op: 'set', varName: 'score', setOp: '=', expr: '(base + bonus) * 3',
    });
  });

  it('preserves a full if expression rather than turning it into a string literal', () => {
    const raw = '@if score >= 5 && route == "A @ B"';
    const source = new InstructionFieldSource(raw, 1, 0);
    const changed = source.replace(raw, 0, 'score < 10 || route == "C"');
    expect(changed).toBe('@if score < 10 || route == "C"');
    expect(() => compileScene(`${changed}\n你好\n@endif\n@end`, 'source.gal', 'source')).not.toThrow();
  });

  it('represents an empty positional value explicitly without shifting a sibling', () => {
    let raw = '@show lynn normal @ right';
    const source = new InstructionFieldSource(raw, 2);
    raw = source.replace(raw, 0, '');
    expect(splitInstr(raw).args).toEqual(['""', 'normal']);
    raw = source.replace(raw, 1, 'happy');
    raw = source.replace(raw, 0, 'lynn:night');
    expect(raw).toBe('@show lynn:night happy @ right');
  });

  it('treats whitespace-only positional input as an explicit empty token', () => {
    const raw = '@show lynn normal';
    const source = new InstructionFieldSource(raw, 2);
    expect(source.replace(raw, 0, '  ')).toBe('@show "" normal');
  });

  it('allows expression-tail clearing and retyping without erasing the suffix', () => {
    let raw = '@set score = base + 1  @ keep';
    const source = new InstructionFieldSource(raw, 3, 2);
    raw = source.replace(raw, 2, '');
    raw = source.replace(raw, 0, 'total');
    raw = source.replace(raw, 2, 'base + 2');
    expect(raw).toBe('@set total = base + 2  @ keep');
  });

  it('fills missing scalar positions before a modifier without reassigning slots', () => {
    let raw = '@mov @ keep';
    const source = new InstructionFieldSource(raw, 3);
    raw = source.replace(raw, 2, '600');
    expect(raw).toBe('@mov "" "" 600 @ keep');
    raw = source.replace(raw, 1, 'right');
    raw = source.replace(raw, 0, 'lynn');
    expect(raw).toBe('@mov lynn right 600 @ keep');
  });

  it('retains boundaries while one field contains an unfinished quote', () => {
    let raw = '@show lynn normal @ right';
    const source = new InstructionFieldSource(raw, 2);
    raw = source.replace(raw, 0, '"night');
    raw = source.replace(raw, 1, 'happy');
    raw = source.replace(raw, 0, '"night dress"');
    expect(raw).toBe('@show "night dress" happy @ right');
  });

  it('requires a fresh binding after an out-of-band raw change', () => {
    const raw = '@show lynn normal';
    const source = new InstructionFieldSource(raw, 2);
    expect(() => source.replace('@show other normal', 1, 'happy')).toThrow('原文已变化');
    expect(source.replace(raw, 1, 'happy')).toBe('@show lynn happy');
  });

  it('rejects multiline field input without modifying its binding', () => {
    const raw = '@bg room';
    const source = new InstructionFieldSource(raw, 1);
    expect(() => source.replace(raw, 0, 'room\n@end')).toThrow('一行');
    expect(source.replace(raw, 0, 'hall')).toBe('@bg hall');
  });

  it('rejects invalid layouts and field indexes rather than guessing', () => {
    expect(() => new InstructionFieldSource('@bg room', 0)).toThrow();
    expect(() => new InstructionFieldSource('@set score = 1', 3, 0)).toThrow();
    expect(() => new InstructionFieldSource('@', 1)).toThrow();
    const source = new InstructionFieldSource('@bg room', 1);
    expect(() => source.replace('@bg room', 2, 'hall')).toThrow();
  });
});
