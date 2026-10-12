import { inlinePlainText, parseInlineText } from '@surdet/core';

/** Ruby now uses the explicit <ruby=reading>base</ruby> syntax; 《》 is ordinary prose. */
export interface RubySegment { base: string; ruby?: string }

export function parseRuby(text: string): RubySegment[] {
  const segments: RubySegment[] = [];
  for (const unit of parseInlineText(text).units) {
    const previous = segments.at(-1);
    if (unit.ruby === undefined && previous && previous.ruby === undefined) previous.base += unit.text;
    else segments.push({ base: unit.text, ...(unit.ruby === undefined ? {} : { ruby: unit.ruby }) });
  }
  return segments;
}

/** Visible dialogue text: no markup or playback-control tokens, no second ruby grammar. */
export function stripRuby(text: string): string { return inlinePlainText(text); }
