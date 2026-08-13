import { describe, expect, it, vi } from 'vitest';
import type { AudioManager } from '@surdet/renderer';
import { ResolvedAudio } from '../../shared/resolved-audio.js';

describe('Gallery music playback wiring', () => {
  it('resolves the logical music key and forwards the explicit preview restart', () => {
    const playBgm = vi.fn();
    const inner = { playBgm } as unknown as AudioManager;
    const audio = new ResolvedAudio(inner, new Map([
      ['midnight_rain', 'blob:midnight-rain.wav'],
    ]));

    audio.playBgm('midnight_rain', { restart: true });

    expect(playBgm).toHaveBeenCalledWith('blob:midnight-rain.wav', { restart: true });
  });
});
