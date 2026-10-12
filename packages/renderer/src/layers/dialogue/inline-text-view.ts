import { Container, Text, type TextStyleOptions } from 'pixi.js';
import { textGraphemeCount, type InlineStyle, type InlineTextDocument } from '@surdet/core';
import type { RendererTheme } from '../../theme.js';
import { layoutInlineText, revealInlineRun, type InlineLayout } from '../../inline-text-layout.js';
import { bindThemeTextProjection } from '../../theme-projection.js';

let measureContext: CanvasRenderingContext2D | null | undefined;
function context(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  return measureContext;
}

/** Shared ADV/choice text rendering; no input, progression, or scene state lives here. */
export class InlineTextView extends Container {
  #document?: InlineTextDocument;
  #layout: InlineLayout = { runs: [], height: 0, width: 0 };
  #bases: Text[] = [];
  #rubies: Text[] = [];
  #marks: Text[] = [];
  #motion: { text: Text; x: number; y: number; effect: 'shake' | 'wave'; index: number }[] = [];
  #elapsed = 0;
  #animated = true;
  #theme?: RendererTheme;
  #family = '';
  #limit = 0;
  get contentHeight(): number { return this.#layout.height; }
  get contentWidth(): number { return this.#layout.width; }
  get baseCount(): number { return this.#bases.filter(text => text.visible).length; }
  get rubyCount(): number { return this.#rubies.filter(text => text.visible).length; }
  get displayTexts(): readonly Text[] { return [...this.#bases, ...this.#rubies, ...this.#marks].filter(text => text.visible); }
  get text(): string { return this.#document?.plainText ?? ''; }
  get needsUpdate(): boolean { return this.#animated && this.#motion.length > 0 && this.visible; }
  setAnimationEnabled(enabled: boolean): void { this.#animated = enabled; this.updateAnimation(0); }
  updateAnimation(deltaMs: number): void {
    if (this.#animated) this.#elapsed += Math.max(0, deltaMs);
    for (const glyph of this.#motion) {
      const time = this.#elapsed / 1000;
      glyph.text.x = glyph.x + (this.#animated && glyph.effect === 'shake' ? Math.sin(time * 31 + glyph.index * 13) * 1.5 : 0);
      glyph.text.y = glyph.y + (this.#animated ? Math.sin(time * (glyph.effect === 'wave' ? 6 : 37) + glyph.index * .8) * (glyph.effect === 'wave' ? 3 : 1.5) : 0);
    }
  }

  setContent(document: InlineTextDocument, width: number, theme: RendererTheme, family: string, shown = Infinity, baseColor: 'text' | 'accent' | 'textMuted' = 'text'): void {
    const textStyle = (style: InlineStyle, ruby = false): TextStyleOptions => ({
      fontFamily: family, fontSize: theme.typography.bodySize * (style.size ?? 1) * (ruby ? 0.5 : 1),
      fontWeight: style.bold ? '700' : '500', fontStyle: style.italic ? 'italic' : 'normal',
      fill: style.color?.startsWith('#') ? style.color : theme.colors[style.color as keyof typeof theme.colors] ?? theme.colors[baseColor],
      letterSpacing: ruby ? 0 : 0.3, stroke: { width: 0, color: theme.colors.textOnAccent },
    });
    if (this.#document !== document || this.#theme !== theme || this.#family !== family || this.#limit !== width) {
      if (this.#document !== document) this.#elapsed = 0;
      this.#document = document; this.#theme = theme; this.#family = family; this.#limit = width;
      const ctx = context();
      this.#layout = layoutInlineText(document, width, theme.typography.bodySize, (text, style, ruby) => {
        const options = textStyle(style, ruby), size = Number(options.fontSize);
        if (!ctx) return Array.from(text).length * size;
        ctx.font = `${options.fontStyle} ${options.fontWeight} ${size}px ${family}`;
        return ctx.measureText(text).width + Math.max(0, Array.from(text).length - 1) * Number(options.letterSpacing);
      }, (style, ruby) => {
        const options = textStyle(style, ruby), size = Number(options.fontSize);
        if (!ctx) return size;
        ctx.font = `${options.fontStyle} ${options.fontWeight} ${size}px ${family}`;
        const metrics = ctx.measureText('国Mg');
        return (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) || size;
      });
    }
    for (const text of [...this.#bases, ...this.#rubies, ...this.#marks]) text.visible = false;
    this.#motion = [];
    let rubyIndex = 0, markIndex = 0;
    this.#layout.runs.forEach((run, index) => {
      const revealed = revealInlineRun(run, shown);
      if (!revealed) return;
      const color = run.style.color?.startsWith('#') ? undefined : (run.style.color ?? baseColor) as keyof RendererTheme['colors'];
      const base = this.#take(this.#bases, index, revealed, textStyle(run.style), color);
      base.position.set(run.x, run.y);
      const moving: Text[] = [base];
      let emphasisHeight = 0;
      if (run.style.emphasis) {
        const marks = this.#take(this.#marks, markIndex++, '· '.repeat(textGraphemeCount(revealed)).trim(), textStyle(run.style, true), color);
        marks.anchor.set(.5, 1); marks.position.set(run.x + run.width / 2, run.y - 2); moving.push(marks);
        emphasisHeight = marks.height + 2;
      }
      if (run.ruby) {
        // Ruby groups reveal atomically; center annotation and base within the same reserved width.
        base.x += (run.width - base.width) / 2;
        const ruby = this.#take(this.#rubies, rubyIndex++, run.ruby, textStyle(run.style, true), color);
        ruby.anchor.set(0.5, 1); ruby.position.set(run.x + run.width / 2, run.y - 2 - emphasisHeight); moving.push(ruby);
      }
      if (run.style.effect) for (const text of moving) this.#motion.push({ text, x: text.x, y: text.y, effect: run.style.effect, index: run.start });
    });
    this.updateAnimation(0);
  }
  clearText(): void {
    this.#document = undefined; this.#layout = { runs: [], height: 0, width: 0 };
    this.#motion = []; this.#elapsed = 0;
    for (const text of [...this.#bases, ...this.#rubies, ...this.#marks]) text.visible = false;
  }
  #take(pool: Text[], index: number, value: string, style: TextStyleOptions, color: keyof RendererTheme['colors'] | undefined): Text {
    let text = pool[index];
    if (!text) { text = new Text({ text: value, style }); pool[index] = text; this.addChild(text); }
    else { text.text = value; text.style = style; }
    bindThemeTextProjection(text, { ...(color ? { fill: color } : {}), stroke: 'textOnAccent' });
    text.visible = true; return text;
  }
}
