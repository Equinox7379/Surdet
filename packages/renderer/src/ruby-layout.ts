import type { RubySegment } from './ruby.js';
import { wrapCjkMeasure } from './text-wrap.js';

export interface RubyMeasure {
  base(text: string): number;
  ruby(text: string): number;
}

export interface RubyGlyphLayout {
  base: string;
  ruby?: string;
  x: number;
  y: number;
  width: number;
  line: number;
}

/**
 * Lay out parsed ruby text without depending on DOM or Pixi.
 * Ruby segments are indivisible; plain segments use the renderer's CJK rules.
 */
export function layoutRuby(
  segments: readonly RubySegment[],
  maxWidth: number,
  measure: RubyMeasure,
  lineHeight = 40,
): RubyGlyphLayout[] {
  const limit = Math.max(1, maxWidth);
  const out: RubyGlyphLayout[] = [];
  let line = 0;
  let x = 0;

  const nextLine = (): void => {
    line += 1;
    x = 0;
  };

  const append = (base: string, ruby: string | undefined, width: number): void => {
    out.push({ base, ...(ruby === undefined ? {} : { ruby }), x, y: line * lineHeight, width, line });
    x += width;
  };

  for (const segment of segments) {
    if (segment.ruby !== undefined) {
      const width = Math.max(measure.base(segment.base), measure.ruby(segment.ruby));
      if (x > 0 && width > limit - x) nextLine();
      append(segment.base, segment.ruby, width);
      continue;
    }

    let rest = segment.base;
    while (rest.length > 0) {
      const available = x > 0 ? limit - x : limit;
      const chunk = wrapCjkMeasure(rest, available, measure.base)[0] ?? rest[0]!;
      const width = measure.base(chunk);
      // A punctuation hang may exceed the remaining space. Keep it with the
      // preceding text when starting a line, but never overflow a used line.
      if (x > 0 && width > available) {
        nextLine();
        continue;
      }
      append(chunk, undefined, width);
      rest = rest.slice(chunk.length);
      if (rest.length > 0) nextLine();
    }
  }

  return out;
}
