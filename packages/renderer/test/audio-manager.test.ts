import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockHowl, mockPlay, mockStop, mockLoop, mockVolume, mockFade, mockOn, mockPlaying, mockUnload, mockHowlerStop, mockHowlerVolume, mockInstances } = vi.hoisted(() => ({
  mockHowl: vi.fn(),
  mockPlay: vi.fn(),
  mockStop: vi.fn(),
  mockLoop: vi.fn(),
  mockVolume: vi.fn(),
  mockFade: vi.fn(),
  mockOn: vi.fn(),
  mockPlaying: vi.fn(() => false),
  mockUnload: vi.fn(),
  mockHowlerStop: vi.fn(),
  mockHowlerVolume: vi.fn(() => 1),
  mockInstances: [] as Array<{
    src: string;
    emit: (event: string) => void;
    setPlaying: (value: boolean) => void;
    playing: ReturnType<typeof vi.fn>;
    unload: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('howler', () => ({
  Howl: mockHowl.mockImplementation((options: { src: string[] }) => {
    const handlers = new Map<string, Array<() => void>>();
    let isPlaying = false;
    const playing = vi.fn(() => isPlaying);
    const unload = vi.fn(() => mockUnload());
    const instance = {
      src: options.src[0] ?? '',
      play: mockPlay,
      stop: mockStop,
      unload,
      loop: mockLoop,
      volume: mockVolume,
      fade: mockFade,
      on: (event: string, handler: () => void) => {
        mockOn(event, handler);
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
      once: (event: string, handler: () => void) => {
        mockOn(event, handler);
        handlers.set(event, [handler]);
      },
      playing,
      emit: (event: string) => {
        for (const handler of handlers.get(event) ?? []) handler();
      },
      setPlaying: (value: boolean) => { isPlaying = value; },
    };
    mockInstances.push(instance);
    return instance;
  }),
  Howler: {
    stop: mockHowlerStop,
    volume: mockHowlerVolume,
  },
}));

import { AudioManager } from '../src/audio-manager.js';

describe('AudioManager', () => {
  beforeEach(() => {
    mockPlay.mockClear();
    mockHowl.mockClear();
    mockStop.mockClear();
    mockLoop.mockClear();
    mockVolume.mockClear();
    mockFade.mockClear();
    mockOn.mockClear();
    mockPlaying.mockClear();
    mockUnload.mockClear();
    mockHowlerStop.mockClear();
    mockHowlerVolume.mockClear();
    mockInstances.length = 0;
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

  it('快照与恢复只经过公共播放接口，不暴露 Howl', () => {
    const am = new AudioManager();
    am.playBgm('night.mp3');
    const snapshot = am.snapshotPlayback();
    expect(snapshot).toEqual({ bgm: 'night.mp3', ambience: null });

    am.stopAll();
    am.restorePlayback(snapshot);
    expect(mockPlay).toHaveBeenCalledTimes(2);
    expect(am.snapshotPlayback()).toEqual(snapshot);
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

  it('Blob URL 注册音频格式后把 format 传给 Howler，避免无扩展名导致 codec 失败', () => {
    const am = new AudioManager();
    am.setSourceFormat('blob:voice', 'audio/wav');
    am.playVoice('blob:voice');
    expect(mockHowl).toHaveBeenCalledWith(expect.objectContaining({ format: ['wav'] }));
  });

  it('isVoicePlaying 查询当前语音实例播放状态', () => {
    const am = new AudioManager();
    expect(am.isVoicePlaying()).toBe(false);
    am.playVoice('v.mp3');
    mockInstances[0]!.playing.mockReturnValueOnce(true);
    expect(am.isVoicePlaying()).toBe(true);
    am.stopAll();
    expect(am.isVoicePlaying()).toBe(false);
  });

  it('dispose 停止播放并释放缓存的 Howl 实例，之后仍可按需复用', () => {
    const am = new AudioManager();
    am.playBgm('a.mp3');
    am.playSe('b.mp3');
    am.playVoice('c.mp3');

    am.dispose();

    expect(mockHowlerStop).toHaveBeenCalledTimes(1);
    expect(mockUnload).toHaveBeenCalledTimes(3);
    am.playSe('a.mp3');
    expect(mockPlay).toHaveBeenCalledTimes(4);
  });

  it('同一源跨 SE/BGM 使用时按声道隔离缓存', () => {
    const am = new AudioManager();
    am.playSe('shared.ogg');
    am.playBgm('shared.ogg');

    expect(mockHowl).toHaveBeenCalledTimes(2);
    expect(mockInstances[0]!.src).toBe('shared.ogg');
    expect(mockInstances[1]!.src).toBe('shared.ogg');
  });

  it('BGM 与环境音使用独立声道，快照包含环境音', () => {
    const am = new AudioManager();
    am.playBgm('music.ogg');
    am.playAmbience('rain.ogg', 400);
    expect(mockHowl).toHaveBeenCalledTimes(2);
    am.playBgm('next.ogg');
    expect(am.snapshotPlayback()).toEqual({ bgm: 'next.ogg', ambience: 'rain.ogg' });
  });

  it('同一源在 BGM 与环境音中保留两个缓存条目', () => {
    const am = new AudioManager();
    am.playBgm('shared.ogg');
    am.playAmbience('shared.ogg');
    expect(mockHowl).toHaveBeenCalledTimes(2);
  });

  it('环境音缓存上限为 8，活动环境音不会被淘汰', () => {
    const am = new AudioManager();
    am.playAmbience('active.ogg');
    const active = mockInstances[0]!;
    active.setPlaying(true);
    for (let i = 0; i < 9; i++) am.playAmbience(`ambience-${i}.ogg`, 0);
    expect(mockHowl).toHaveBeenCalledTimes(10);
    expect(active.unload).not.toHaveBeenCalled();
  });

  it('stopAll、dispose 与回退恢复会处理环境音', () => {
    const am = new AudioManager();
    am.playAmbience('rain.ogg');
    const snapshot = am.snapshotPlayback();
    expect(snapshot).toEqual({ bgm: null, ambience: 'rain.ogg' });
    am.stopAll();
    expect(am.snapshotPlayback()).toEqual({ bgm: null, ambience: null });
    am.restorePlayback(snapshot);
    expect(am.snapshotPlayback()).toEqual(snapshot);
    am.dispose();
    expect(mockUnload).toHaveBeenCalled();
  });

  it('SE 缓存淘汰停止实例并保持上限 32', () => {
    const am = new AudioManager();
    for (let i = 0; i < 40; i++) am.playSe(`se-${i}.ogg`);

    expect(mockHowl).toHaveBeenCalledTimes(40);
    expect(mockUnload).toHaveBeenCalledTimes(8);
  });

  it('语音缓存淘汰停止实例并保持上限 8', () => {
    const am = new AudioManager();
    for (let i = 0; i < 10; i++) am.playVoice(`voice-${i}.ogg`);

    expect(mockHowl).toHaveBeenCalledTimes(10);
    expect(mockUnload).toHaveBeenCalledTimes(2);
  });

  it('活动实例不被淘汰，end/stop 重复事件收敛且不影响其他声道', () => {
    const am = new AudioManager();
    am.playSe('shared.ogg');
    const sharedSe = mockInstances[0]!;
    sharedSe.setPlaying(true);
    am.playBgm('shared.ogg');
    const sharedBgm = mockInstances[1]!;

    for (let i = 0; i < 32; i++) am.playSe(`se-${i}.ogg`);
    const unloadBeforeEvents = mockUnload.mock.calls.length;
    sharedSe.emit('end');
    sharedSe.emit('stop');
    sharedBgm.emit('end');
    sharedBgm.emit('stop');

    expect(sharedSe.unload).not.toHaveBeenCalled();
    expect(sharedBgm.unload).not.toHaveBeenCalled();
    expect(mockUnload.mock.calls.length).toBe(unloadBeforeEvents);
  });
});
