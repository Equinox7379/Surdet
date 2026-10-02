import { describe, expect, it, vi } from 'vitest';
import type { AudioManager } from '@surdet/renderer';
import { ResolvedAudio } from '../../shared/resolved-audio.js';

describe('Gallery music playback wiring', () => {
  it('keeps the original source error and its unsubscribe through the resolver', () => {
    const off = vi.fn(), listener = vi.fn(), onError = vi.fn(() => off);
    const audio = new ResolvedAudio({ onError } as unknown as AudioManager, new Map());
    expect(audio.onError(listener)).toBe(off); expect(onError).toHaveBeenCalledWith(listener);
  });
  it('resolves the logical music key and forwards the explicit preview restart', () => {
    const playBgm = vi.fn();
    const inner = { playBgm } as unknown as AudioManager;
    const audio = new ResolvedAudio(inner, new Map([
      ['bgm:midnight_rain', 'blob:midnight-rain.wav'],
    ]));

    audio.playBgm('midnight_rain', { restart: true });

    expect(playBgm).toHaveBeenCalledWith('blob:midnight-rain.wav', { restart: true });
  });

  it('keeps identical keys on different channels distinct, including snapshot and restore', () => {
    const inner = {
      playBgm: vi.fn(), playAmbience: vi.fn(), playSe: vi.fn(), playVoice: vi.fn(),
      snapshotPlayback: () => ({ bgm: 'blob:music', ambience: 'blob:rain' }), restorePlayback: vi.fn(),
    };
    const audio = new ResolvedAudio(inner as unknown as AudioManager, new Map([
      ['bgm:same', 'blob:music'], ['ambience:same', 'blob:rain'], ['se:same', 'blob:bell'], ['voice:same', 'blob:voice'],
    ]));
    audio.playBgm('same'); audio.playAmbience('same', 125); audio.playSe('same'); audio.playVoice('same');
    expect(inner.playBgm).toHaveBeenCalledWith('blob:music', undefined);
    expect(inner.playAmbience).toHaveBeenCalledWith('blob:rain', 125);
    expect(inner.playSe).toHaveBeenCalledWith('blob:bell');
    expect(inner.playVoice).toHaveBeenCalledWith('blob:voice', undefined);
    audio.playVoice('same', { replay: true });
    expect(inner.playVoice).toHaveBeenLastCalledWith('blob:voice', { replay: true });
    expect(audio.snapshotPlayback()).toEqual({ bgm: 'same', ambience: 'same' });
    audio.restorePlayback({ bgm: 'same', ambience: 'same' });
    expect(inner.restorePlayback).toHaveBeenCalledWith({ bgm: 'blob:music', ambience: 'blob:rain' });
    audio.playBgm(null); audio.playAmbience(null, 0);
    expect(inner.playBgm).toHaveBeenLastCalledWith(null, undefined);
    expect(inner.playAmbience).toHaveBeenLastCalledWith(null, 0);
    audio.playVoice('https://example.invalid/voice.wav');
    expect(inner.playVoice).toHaveBeenLastCalledWith('https://example.invalid/voice.wav', undefined);
  });
});
