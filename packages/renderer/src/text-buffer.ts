import { parseInlineText, textGraphemeCount } from '@surdet/core';

/** Frame-time dialogue cursor. Markup never consumes a character or wall-clock timer. */
export interface TypewriterOptions { charsPerSecond?: number }
export class Typewriter {
  #document = parseInlineText('');
  #shown = 0;
  #done = true;
  #cps: number;
  #carryMs = 0;
  #control = 0;
  #pauseMs = 0;
  #waiting = false;
  #segmentStart = 0;
  #waitingLength = 0;
  onComplete: (() => void) | null = null;

  constructor(options: TypewriterOptions = {}) { this.#cps = options.charsPerSecond ?? 24; }
  setSpeed(value: number): void { if (Number.isFinite(value) && value > 0) this.#cps = value; }
  get speed(): number { return this.#cps; }
  get full(): string { return this.#document.source; }
  get text(): string { return this.#document.units.slice(0, this.#shown).map(unit => unit.text).join(''); }
  get shown(): number { return this.#shown; }
  get isDone(): boolean { return this.#done; }
  get isWaiting(): boolean { return this.#waiting; }
  get isPaused(): boolean { return this.#waiting || this.#pauseMs > 0; }
  get waitingLength(): number { return this.#waitingLength; }
  get visibleLength(): number { return textGraphemeCount(this.#document.plainText); }

  set text(value: string) {
    this.#document = parseInlineText(value); this.#shown = 0;
    this.#done = false; this.#carryMs = 0; this.#control = 0;
    this.#pauseMs = 0; this.#waiting = false; this.#segmentStart = 0; this.#waitingLength = 0;
    this.update(0);
  }

  /** Reproject a language without replaying earlier pauses or completing/advancing the line. */
  replaceText(value: string): void {
    const progress = this.#document.units.length ? this.#shown / this.#document.units.length : 1;
    this.#document = parseInlineText(value);
    this.#done ||= this.#document.units.length === 0;
    this.#shown = this.#done ? this.#document.units.length : Math.floor(this.#document.units.length * progress);
    this.#carryMs = 0; this.#pauseMs = 0; this.#waiting = false;
    this.#control = this.#document.controls.findIndex(control => control.at > this.#shown);
    if (this.#control < 0) this.#control = this.#document.controls.length;
    this.#segmentStart = this.#shown; this.#waitingLength = 0;
  }

  update(deltaMs: number): void {
    if (this.#done || this.#waiting) return;
    let budget = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    for (;;) {
      if (this.#pauseMs > 0) {
        const elapsed = Math.min(budget, this.#pauseMs);
        budget -= elapsed; this.#pauseMs -= elapsed;
        if (this.#pauseMs > 0) return;
      }
      const control = this.#document.controls[this.#control];
      if (control?.at === this.#shown) {
        this.#control++;
        if (control.kind === 'pause') { this.#pauseMs = control.durationMs!; continue; }
        this.#wait(); return;
      }
      if (this.#shown >= this.#document.units.length) { this.#complete(); return; }
      const need = 1000 / (this.#cps * (this.#document.units[this.#shown]!.style.speed ?? 1)) - this.#carryMs;
      if (budget < need) { this.#carryMs += budget; return; }
      budget -= need; this.#carryMs = 0; this.#shown++;
    }
  }

  /** A click during typing reveals to the next click-wait, not beyond it. */
  revealToNextWait(): void {
    if (this.#done) return;
    if (this.#waiting) { this.resumeWait(); return; }
    this.#carryMs = 0; this.#pauseMs = 0;
    while (this.#control < this.#document.controls.length) {
      const control = this.#document.controls[this.#control++]!;
      if (control.kind === 'wait') { this.#shown = control.at; this.#wait(); return; }
    }
    this.skip();
  }
  resumeWait(): void {
    if (!this.#waiting) return;
    this.#waiting = false; this.#carryMs = 0; this.update(0);
  }
  /** Fast-forward deliberately ignores all pauses and click-waits. */
  skip(): void {
    if (this.#done) return;
    this.#shown = this.#document.units.length; this.#control = this.#document.controls.length;
    this.#pauseMs = 0; this.#waiting = false; this.#complete();
  }
  #wait(): void {
    this.#waiting = true;
    this.#waitingLength = textGraphemeCount(this.#document.units.slice(this.#segmentStart, this.#shown).map(unit => unit.text).join(''));
    this.#segmentStart = this.#shown; this.#carryMs = 0;
  }
  #complete(): void { this.#done = true; this.#carryMs = 0; this.onComplete?.(); }
}
