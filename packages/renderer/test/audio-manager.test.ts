import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPlay, mockStop, mockLoop, mockVolume, mockFade, mockOn, mockPlaying, mockHowlerStop, mockHowlerVolume } = vi.hoisted(() => ({
  mockPlay: vi.fn(),
  mockStop: vi.fn(),
  mockLoop: vi.fn(),
  mockVolume: vi.fn(),
  mockFade: vi.fn(),
  mockOn: vi.fn(),
  mockPlaying: vi.fn(() => false),
  mockHowlerStop: vi.fn(),
  mockHowlerVolume: vi.fn(() => 1),
}));

vi.mock('howler', () => ({
  Howl: vi.fn().mockImplementation(() => ({
    play: mockPlay,
    stop: mockStop,
    loop: mockLoop,
    volume: mockVolume,
    fade: mockFade,
    on: mockOn,
    playing: mockPlaying,
  })),
  Howler: {
    stop: mockHowlerStop,
    volume: mockHowlerVolume,
  },
}));

import { AudioManager } from '../src/audio-manager.js';

describe('AudioManager', () => {
  beforeEach(() => {
    mockPlay.mockClear();
    mockStop.mockClear();
    mockLoop.mockClear();
    mockVolume.mockClear();
    mockFade.mockClear();
    mockOn.mockClear();
    mockPlaying.mockClear();
    mockHowlerStop.mockClear();
    mockHowlerVolume.mockClear();
    vi.useRealTimers();
  });

  it('playBgm 引用缓存 src 时先 stop 再 play（不与旧 SE 实例重叠）', () => {
    const am = new AudioManager();
    am.playSe('a.mp3'); // 先以 SE 播放 → 进入缓存
    expect(mockPlay).toHaveBeenCalledTimes(1);

    am.playBgm('a.mp3'); // 同 src 转 BGM：应 stop 该 src 所有播放后 play
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });

  it('playBgm 切到新 src 时停止旧 BGM（交叉淡出：fade + 延时 stop）', () => {
    vi.useFakeTimers();
    const am = new AudioManager();
    am.playBgm('a.mp3');
    expect(mockStop).toHaveBeenCalledTimes(1); // 首次 a：目标 stop（无旧实例）
    am.playBgm('b.mp3');
    // 旧 BGM a：fade 淡出 + setTimeout 延时 stop（未跑定时器前 stop 次数不变）
    expect(mockFade).toHaveBeenCalled();
    expect(mockStop).toHaveBeenCalledTimes(2); // 新 BGM b 的目标 stop（防 SE 重叠）
    expect(mockPlay).toHaveBeenCalledTimes(2);
    vi.runAllTimers(); // 淡出完成后停止旧曲
    expect(mockStop).toHaveBeenCalledTimes(3);
  });

  it('交叉淡出期间 A→B→A 快速切换：延时 stop 不误停重新启播的同名 BGM', () => {
    vi.useFakeTimers();
    const am = new AudioManager();
    am.playBgm('a.mp3');
    am.playBgm('b.mp3');
    am.playBgm('a.mp3'); // 350ms 内切回 a（复用同一 Howl 实例）
    mockStop.mockClear();
    vi.runAllTimers();
    // b 的淡出停止合法执行 1 次；a 的旧定时器因代际守卫跳过（无守卫时会多停一次，
    // 误杀重新启播的当前 BGM a，且 #bgmKey 仍为 a 导致后续 playBgm('a') 提前返回、永久静音）
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('同一 src 重复 playBgm 不重复启动', () => {
    const am = new AudioManager();
    am.playBgm('a.mp3');
    const afterFirst = mockPlay.mock.calls.length;
    am.playBgm('a.mp3'); // 同 key → 提前 return
    expect(mockPlay).toHaveBeenCalledTimes(afterFirst);
  });

  it('stopAll 停止全部音频（BGM/SE/语音）并重置 BGM 记录', () => {
    const am = new AudioManager();
    am.playBgm('a.mp3');
    am.playSe('b.mp3');
    am.playVoice('c.mp3');
    am.stopAll();
    expect(mockHowlerStop).toHaveBeenCalledTimes(1); // howler 全局停止
    // BGM 记录已重置：同 key 再次 playBgm 会重新启动
    am.playBgm('a.mp3');
    expect(mockPlay.mock.calls.length).toBe(4);
  });

  it('R1 stopAll 后淡出窗口内重新 playBgm 不被旧定时器误停', () => {
    vi.useFakeTimers();
    const am = new AudioManager();
    am.playBgm('a.mp3');
    am.playBgm('b.mp3'); // a 进入 350ms 淡出停止定时器
    am.stopAll();
    am.playBgm('a.mp3'); // 窗口内重新启播 a
    mockStop.mockClear();
    vi.runAllTimers();
    // 旧定时器被 stopAll 的代际推进作废：不应有任何额外 stop 误停新 BGM
    expect(mockStop).not.toHaveBeenCalled();
  });

  it('分轨音量：setBgmVolume 立即作用于当前 BGM，getter 返回 clamp 后的值', () => {
    const am = new AudioManager();
    am.playBgm('a.mp3');
    mockVolume.mockClear();
    am.setBgmVolume(0.3);
    expect(am.getBgmVolume()).toBeCloseTo(0.3);
    expect(mockVolume).toHaveBeenCalledWith(0.3); // 当前 BGM 即时生效
    am.setSeVolume(2); // 越界 clamp
    expect(am.getSeVolume()).toBe(1);
    am.setVoiceVolume(-1);
    expect(am.getVoiceVolume()).toBe(0);
  });

  it('主音量经 Howler 全局设置', () => {
    const am = new AudioManager();
    am.setMasterVolume(0.5);
    expect(mockHowlerVolume).toHaveBeenCalledWith(0.5);
  });

  it('isVoicePlaying 查询当前语音实例播放状态', () => {
    const am = new AudioManager();
    expect(am.isVoicePlaying()).toBe(false);
    am.playVoice('v.mp3');
    mockPlaying.mockReturnValueOnce(true);
    expect(am.isVoicePlaying()).toBe(true);
    am.stopAll();
    expect(am.isVoicePlaying()).toBe(false);
  });
});
