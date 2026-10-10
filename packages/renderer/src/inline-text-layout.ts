import type { InlineStyle, InlineTextDocument, InlineUnit } from '@surdet/core';
import { wrapCjkUnits } from './text-wrap.js';

export interface InlineLayoutRun { units: readonly InlineUnit[]; start: number; x: number; y: number; width: number; ruby?: string; style: InlineStyle }
export interface InlineLayout { runs: InlineLayoutRun[]; height: number; width: number }
export type InlineMeasure = (text: string, style: InlineStyle, ruby: boolean) => number;

/** One layout for the complete line; reveal progress does not change wrap points. */
export function layoutInlineText(document: InlineTextDocument, width: number, bodySize: number, measure: InlineMeasure,
  measureHeight: (style: InlineStyle, ruby: boolean) => number = (style, ruby) => bodySize * (style.size ?? 1) * (ruby ? 0.5 : 1),
): InlineLayout {
  const groups = (units: readonly InlineUnit[]): InlineUnit[][] => {
    const out: InlineUnit[][] = [];
    for (const unit of units) {
      const previous = out.at(-1);
      if (!unit.ruby && previous && !previous[0]!.ruby && previous[0]!.style === unit.style) previous.push(unit);
      else out.push([unit]);
    }
    return out;
  };
  const groupWidth = (units: readonly InlineUnit[]): number => Math.max(
    measure(units.map(unit => unit.text).join(''), units[0]!.style, false),
    units[0]!.ruby ? measure(units[0]!.ruby, units[0]!.style, true) : 0,
  );
  const indices = new Map(document.units.map((unit, index) => [unit, index]));
  const lines = wrapCjkUnits(document.units, width, unit => unit.text, units => groups(units).reduce((total, group) => total + groupWidth(group), 0));
  let y = 0, maxWidth = 0;
  const runs: InlineLayoutRun[] = [];
  for (const line of lines) {
    const size = Math.max(bodySize, ...line.map(unit => measureHeight(unit.style, false)));
    const rubyInset = Math.max(0, ...line.filter(unit => unit.ruby).map(unit => measureHeight(unit.style, true) + 2));
    let x = 0;
    for (const group of groups(line)) {
      const unit = group[0]!, runWidth = groupWidth(group);
      runs.push({ units: group, start: indices.get(unit)!, x, y: y + rubyInset + size - measureHeight(unit.style, false), width: runWidth, style: unit.style, ...(unit.ruby ? { ruby: unit.ruby } : {}) });
      x += runWidth;
    }
    maxWidth = Math.max(maxWidth, x); y += Math.max(size * 1.6, size + rubyInset + 2);
  }
  return { runs, width: maxWidth, height: document.units.length ? y : 0 };
}

export function revealInlineRun(run: InlineLayoutRun, shown: number): string {
  return run.units.slice(0, Math.max(0, shown - run.start)).map(unit => unit.text).join('');
}
