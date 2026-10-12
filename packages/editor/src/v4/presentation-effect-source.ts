import type { BuiltinTransitionName } from '@surdet/core';
import { decodeInstructionArgument } from '@surdet/authoring';
import { splitInstr } from '../model.js';
import { instructionModifiers, setInstructionArgument, setInstructionModifier } from './script-source.js';

export interface TransitionSource { name: string; durationMs: string; rule: string | undefined; soft: string | undefined; reverse: boolean }

/** What the line says, decoded as Core reads it; values are not validated here. */
export function readTransition(raw: string): TransitionSource {
  const args = splitInstr(raw).args.map(decodeInstructionArgument), modifiers = instructionModifiers(raw);
  const reverse = modifiers.get('reverse');
  return { name: args[0] ?? '', durationMs: args[1] ?? '', rule: modifiers.get('rule'), soft: modifiers.get('soft'),
    reverse: reverse !== undefined && reverse !== 'false' && reverse !== '0' };
}

/** Change the effect. A mask transition needs a mask; another effect drops the mask options it would not consume. */
export function writeTransitionName(raw: string, name: BuiltinTransitionName, defaultRule?: string): string {
  let next = setInstructionArgument(raw, 0, name);
  if (name === 'rule') {
    const current = instructionModifiers(next).get('rule');
    if (!current) {
      if (!defaultRule) throw new Error('项目里还没有可用的转场遮罩，请先在素材中心导入');
      next = setInstructionModifier(next, 'rule', defaultRule);
    }
    return next;
  }
  for (const modifier of ['rule', 'soft', 'reverse']) next = setInstructionModifier(next, modifier, null);
  return next;
}

/** A timed effect writes its milliseconds as the second positional argument; a missing first one gets the Core default. */
export function writeEffectDuration(raw: string, fallbackName: string, durationMs: string, min: number, max: number): string {
  const value = Number(durationMs);
  if (durationMs.trim() === '' || !Number.isInteger(value) || value < min || value > max) throw new Error(`时长须为 ${min}–${max} 的整数毫秒`);
  const named = splitInstr(raw).args.length === 0 ? setInstructionArgument(raw, 0, fallbackName) : raw;
  return setInstructionArgument(named, 1, String(value));
}

export function writeRuleSoft(raw: string, soft: string): string {
  const value = Number(soft);
  if (soft.trim() === '' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('柔和度须为 0–1');
  return setInstructionModifier(raw, 'soft', String(value));
}

export function writeRuleReverse(raw: string, reverse: boolean): string {
  return setInstructionModifier(raw, 'reverse', reverse ? true : null);
}
