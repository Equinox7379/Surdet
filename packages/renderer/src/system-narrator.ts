/** One local system voice owned by the current Player; no network/audio asset production. */
export class SystemNarrator {
  readonly #synth: SpeechSynthesis | undefined;
  readonly #utterance: (text: string) => SpeechSynthesisUtterance;
  #generation = 0;
  #busy = false;
  #cleanup: (() => void) | undefined;
  #current: SpeechSynthesisUtterance | undefined;
  onError: ((message: string) => void) | null = null;

  constructor(synth = globalThis.speechSynthesis, utterance = (text: string) => new SpeechSynthesisUtterance(text)) {
    this.#synth = synth; this.#utterance = utterance;
  }
  get busy(): boolean { return this.#busy || this.#current !== undefined; }
  stop(): void {
    this.#generation++; this.#cleanup?.(); this.#cleanup = undefined;
    const wasBusy = this.#busy; this.#busy = false; this.#current = undefined;
    if (wasBusy) this.#synth?.cancel();
  }
  speak(text: string, lang = '', volume = 1): void {
    this.stop(); if (!text.trim()) return;
    const synth = this.#synth, generation = this.#generation;
    const fail = (message: string): void => { if (generation === this.#generation) { this.#busy = false; this.#current = undefined; this.onError?.(message); } };
    if (!synth) { fail('此设备不支持系统朗读'); return; }
    this.#busy = true;
    const start = (): boolean => {
      const voices = synth.getVoices().filter(voice => voice.localService);
      if (!voices.length) return false;
      this.#cleanup?.(); this.#cleanup = undefined;
      if (generation !== this.#generation) return true;
      const value = this.#utterance(text);
      value.voice = voices.find(voice => lang && voice.lang.toLowerCase().split('-')[0] === lang.toLowerCase().split('-')[0]) ?? voices[0]!;
      value.lang = lang || value.voice.lang; value.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
      value.onend = () => { if (generation === this.#generation) { this.#busy = false; this.#current = undefined; } };
      value.onerror = event => fail(`系统朗读失败：${event.error}`);
      this.#current = value;
      try { synth.speak(value); } catch (error) { fail(`系统朗读失败：${String(error)}`); }
      return true;
    };
    if (start()) return;
    const listener = () => { start(); };
    const timeout = setTimeout(() => { this.#cleanup?.(); this.#cleanup = undefined; fail('未找到可用的本机系统语音'); }, 2000);
    synth.addEventListener('voiceschanged', listener);
    this.#cleanup = () => { clearTimeout(timeout); synth.removeEventListener('voiceschanged', listener); };
  }
}
