import { afterEach, expect, it, vi } from 'vitest';
import { SystemNarrator } from '../src/system-narrator.js';
afterEach(() => vi.useRealTimers());
function harness() {
  let voices: Partial<SpeechSynthesisVoice>[] = [{ name: 'local', lang: 'zh-CN', localService: true }];
  const events = new EventTarget(), spoken: SpeechSynthesisUtterance[] = [];
  const synth = { getVoices: () => voices, speak: vi.fn((value: SpeechSynthesisUtterance) => spoken.push(value)), cancel: vi.fn(),
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  const narrator = new SystemNarrator(synth as unknown as SpeechSynthesis, text => ({ text }) as SpeechSynthesisUtterance);
  return { narrator, synth, spoken, events, voices: (value: typeof voices) => { voices = value; } };
}
it('uses a local voice, cancels its old utterance, ignores its late end and releases on error', () => {
  const h = harness(), error = vi.fn(); h.narrator.onError = error;
  h.narrator.speak('甲', 'zh-CN', .3); expect(h.narrator.busy).toBe(true);
  expect(h.spoken[0]).toMatchObject({ text: '甲', lang: 'zh-CN', volume: .3 });
  h.narrator.speak('乙'); expect(h.synth.cancel).toHaveBeenCalledOnce();
  h.spoken[0]!.onend!({} as SpeechSynthesisEvent); expect(h.narrator.busy).toBe(true);
  h.spoken[1]!.onerror!({ error: 'audio-busy' } as SpeechSynthesisErrorEvent);
  expect(h.narrator.busy).toBe(false); expect(error).toHaveBeenCalledOnce();
});
it('a cancelled pending voice request never speaks later; missing local voices end the wait', () => {
  vi.useFakeTimers(); const h = harness(), error = vi.fn(); h.narrator.onError = error;
  h.voices([]); h.narrator.speak('取消'); h.narrator.stop(); h.voices([{ localService: true, lang: 'zh-CN' }]);
  h.events.dispatchEvent(new Event('voiceschanged')); expect(h.spoken).toEqual([]);
  h.voices([{ localService: false, lang: 'zh-CN' }]); h.narrator.speak('离线'); vi.advanceTimersByTime(2000);
  expect(h.narrator.busy).toBe(false); expect(error).toHaveBeenCalledOnce(); expect(h.spoken).toEqual([]);
});
