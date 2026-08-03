import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPlay, mockStop, mockLoop, mockVolume } = vi.hoisted(() => ({
  mockPlay: vi.fn(),
  mockStop: vi.fn(),
  mockLoop: vi.fn(),
  mockVolume: vi.fn(),
}));

vi.mock('howler', () => ({
  Howl: vi.fn().mockImplementation(() => ({
    play: mockPlay,
    stop: mockStop,
    loop: mockLoop,
    volume: mockVolume,
  })),
}));

import { AudioManager } from '../src/audio-manager.js';

describe('AudioManager', () => {
  beforeEach(() => {
    mockPlay.mockClear();
    mockStop.mockClear();
    mockLoop.mockClear();
    mockVolume.mockClear();
  });

  it('playBgm 引用缓存 src 时先 stop 再 play（不与旧 SE 实例重叠）', () => {
    const am = new AudioManager();
    am.playSe('a.mp3'); // 先以 SE 播放 → 进入缓存
    expect(mockPlay).toHaveBeenCalledTimes(1);

    am.playBgm('a.mp3'); // 同 src 转 BGM：应 stop 该 src 所有播放后 play
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });

  it('playBgm 切到新 src 时停止旧 BGM', () => {
    const am = new AudioManager();
    am.playBgm('a.mp3');
    expect(mockStop).toHaveBeenCalledTimes(1); // 首次 a：目标 stop（无旧实例）
    am.playBgm('b.mp3');
    // 旧 BGM a stop +1，新 BGM b stop +1（避免 b 若曾缓存为 SE 时重叠）
    expect(mockStop).toHaveBeenCalledTimes(3);
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });

  it('同一 src 重复 playBgm 不重复启动', () => {
    const am = new AudioManager();
    am.playBgm('a.mp3');
    const afterFirst = mockPlay.mock.calls.length;
    am.playBgm('a.mp3'); // 同 key → 提前 return
    expect(mockPlay).toHaveBeenCalledTimes(afterFirst);
  });
});
