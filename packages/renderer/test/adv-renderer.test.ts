import { describe, expect, it } from 'vitest';
import { EventBus, compileScene, Interpreter, SceneRegistry, VariableStore } from '@surdet/core';
import type { CoreEventMap } from '@surdet/core';
import { AdvRenderer, Typewriter, dequote, Backlog } from '../src/index.js';
import type { AdvStage, AudioHandle, PortraitView } from '../src/types.js';

/** 记录调用的 fake 舞台 */
class FakeStage implements AdvStage {
  calls: string[] = [];
  backgrounds: (string | null)[] = [];
  portraits: { key: string; view: PortraitView }[] = [];
  removed: string[] = [];
  texts: { speaker: string | null; value: string }[] = [];
  choices: { index: number; label: string }[][] = [];
  hides = 0;
  fades: number[] = [];
  choiceHighlights: number[] = [];
  /** 模拟 PixiStage.onSelect（AdvRenderer 构造时应自动绑定） */
  onSelect: ((index: number) => void) | null = null;
  onBacklogClose: (() => void) | null = null;

  setBackground(key: string | null): void {
    this.calls.push(`bg:${String(key)}`);
    this.backgrounds.push(key);
  }
  setPortrait(key: string, view: PortraitView): void {
    this.calls.push(`show:${key}`);
    this.portraits.push({ key, view });
  }
  removePortrait(key: string): void {
    this.calls.push(`hide:${key}`);
    this.removed.push(key);
  }
  showText(speaker: string | null, value: string): void {
    this.calls.push(`text:${value}`);
    this.texts.push({ speaker, value });
  }
  showChoices(options: { index: number; label: string }[]): void {
    this.calls.push(`choice:${options.map((o) => o.label).join('/')}`);
    this.choices.push(options);
  }
  hideChoices(): void {
    this.calls.push('hideChoices');
    this.hides++;
  }
  setChoiceHighlight(pos: number): void {
    this.choiceHighlights.push(pos);
  }
  setFade(alpha: number): void {
    this.calls.push(`fade:${alpha.toFixed(2)}`);
    this.fades.push(alpha);
  }
  shakes: { dur: number; strength: number }[] = [];
  flashes: number[] = [];
  zooms: { scale: number; dur: number }[] = [];
  effectTicks = 0;
  awaitingStates: boolean[] = [];
  stageNeedsUpdate: boolean | undefined;
  shake(durMs: number, strength: number): void { this.shakes.push({ dur: durMs, strength }); }
  flash(durMs: number): void { this.flashes.push(durMs); }
  zoom(scale: number, durMs: number): void { this.zooms.push({ scale, dur: durMs }); }
  updateEffects(): void { this.effectTicks++; }
  setAwaiting(awaiting: boolean): void { this.awaitingStates.push(awaiting); }
  needsUpdate(): boolean { return this.stageNeedsUpdate ?? true; }
  movs: { key: string; pos: string; dur: number }[] = [];
  tints: { color: number; alpha: number; dur: number }[] = [];
  tintClears: number[] = [];
  particlesStarted: string[] = [];
  particlesStopped = 0;
  movePortrait(key: string, pos: string, durMs: number): void { this.movs.push({ key, pos, dur: durMs }); }
  setTint(color: number, alpha: number, durMs: number): void { this.tints.push({ color, alpha, dur: durMs }); }
  clearTint(durMs: number): void { this.tintClears.push(durMs); }
  startParticles(kind: string): void { this.particlesStarted.push(kind); }
  stopParticles(): void { this.particlesStopped++; }
  hideInterface?: (hidden: boolean) => void;
  timelineEvents: { track: string; progress: number }[] = [];
  presentation: unknown = { stage: 'snapshot' };
  restored: unknown[] = [];
  presentationClears = 0;
  applyTimelineFrame(event: { track: string; progress: number }): void {
    this.timelineEvents.push({ track: event.track, progress: event.progress });
  }
  snapshotPresentation(): unknown { return this.presentation; }
  restorePresentation(snapshot: unknown): void { this.restored.push(snapshot); }
  clearPresentation(): void { this.presentationClears++; }
}

class FakeAudio implements AudioHandle {
  bgm: (string | null)[] = [];
  se: string[] = [];
  voice: string[] = [];
  stoppedAll = 0;
  playBgm(src: string | null): void { this.bgm.push(src); }
  playSe(src: string): void { this.se.push(src); }
  playVoice(src: string): void { this.voice.push(src); }
  stopAll(): void { this.stoppedAll++; }
  setMasterVolume(): void {}
  getMasterVolume(): number { return 1; }
  setBgmVolume(): void {}
  getBgmVolume(): number { return 1; }
  setSeVolume(): void {}
  getSeVolume(): number { return 1; }
  setVoiceVolume(): void {}
  getVoiceVolume(): number { return 1; }
  isVoicePlaying(): boolean { return false; }
}

function makeBus() {
  return new EventBus<CoreEventMap>();
}

describe('AdvRenderer', () => {
  it('空闲且舞台无活动效果时短路；文本开始后仍继续推进', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    stage.stageNeedsUpdate = false;
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);

    r.update(16);
    expect(stage.effectTicks).toBe(0);

    bus.emit('text', { speaker: '凛', value: '继续。' });
    r.update(1000);
    expect(stage.effectTicks).toBe(1);
    expect(stage.texts.at(-1)).toEqual({ speaker: '凛', value: '继续。' });
  });

  it('剧情空闲时不会因快进开关仍开启而持续请求帧', () => {
    const stage = new FakeStage();
    stage.stageNeedsUpdate = false;
    const r = new AdvRenderer(stage, new FakeAudio());
    r.toggleSkip();

    expect(r.needsUpdate).toBe(false);
    r.update(16);
    expect(stage.effectTicks).toBe(0);
  });

  it('内核事件会唤醒已绑定的帧调度器', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    stage.stageNeedsUpdate = false;
    const r = new AdvRenderer(stage, new FakeAudio());
    let requests = 0;
    r.setFrameRequest(() => { requests++; });
    r.subscribe(bus);

    bus.emit('text', { speaker: null, value: '唤醒。' });
    expect(requests).toBe(1);
  });

  it('等待状态只在发生变化时同步到舞台', () => {
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.update(16);
    r.update(16);
    expect(stage.awaitingStates).toEqual([false]);

    const bus = makeBus();
    r.subscribe(bus);
    bus.emit('text', { speaker: null, value: '等一下。' });
    r.update(1000);
    r.update(16);
    expect(stage.awaitingStates).toEqual([false, true]);
    expect(r.advance()).toBe(true);
    r.update(16);
    expect(stage.awaitingStates).toEqual([false, true, false]);
  });

  it('timeline 事件逐帧投影，阻塞时间轴完成后仅恢复一次解释器', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let completed = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onWaitEnd: () => { completed++; } });
    r.subscribe(bus);
    bus.emit('timeline', {
      id: 'intro',
      blocking: true,
      definition: {
        version: 1, id: 'intro', durationMs: 100,
        tracks: [{ kind: 'background', cues: [{ atMs: 0, durationMs: 100, easing: 'linear', action: 'set', key: 'hall' }] }],
      },
    });
    r.update(50);
    expect(stage.timelineEvents.some((event) => event.track === 'background')).toBe(true);
    expect(completed).toBe(0);
    r.advance();
    expect(completed).toBe(1);
    r.update(100);
    expect(completed).toBe(1);
  });

  it('阻塞时间轴含 screen tint 时，完成后仍能投影下一句台词', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio(), {
      onWaitEnd: () => bus.emit('text', { speaker: '凛', value: '到达。' }),
    });
    r.subscribe(bus);
    bus.emit('timeline', {
      id: 'tinted_intro',
      blocking: true,
      definition: {
        version: 1, id: 'tinted_intro', durationMs: 100,
        tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 100, easing: 'linear', action: 'tint', color: 0x102038, alpha: 0.18 }] }],
      },
    });

    r.update(120);
    expect(stage.timelineEvents.some((event) => event.track === 'screen')).toBe(true);
    expect(r.status).toBe('typing');
    r.update(1000);
    expect(stage.texts.at(-1)).toEqual({ speaker: '凛', value: '到达。' });
  });

  it('非零起点的音频 cue 在跨过起点的帧可靠触发', () => {
    const bus = makeBus();
    const audio = new FakeAudio();
    const r = new AdvRenderer(new FakeStage(), audio);
    r.subscribe(bus);
    bus.emit('timeline', {
      id: 'late_audio',
      blocking: false,
      definition: {
        version: 1, id: 'late_audio', durationMs: 100,
        tracks: [{ kind: 'audio', cues: [{ atMs: 23, durationMs: 0, easing: 'linear', action: 'se', key: 'door' }] }],
      },
    });
    r.update(16);
    expect(audio.se).toEqual([]);
    r.update(16);
    expect(audio.se).toEqual(['door']);
  });

  it('跳过时间轴时仍结算稍后开始的背景，避免停留在开场黑幕', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);
    bus.emit('timeline', {
      id: 'skip_background',
      blocking: true,
      definition: {
        version: 1, id: 'skip_background', durationMs: 900,
        tracks: [{ kind: 'background', cues: [{ atMs: 23, durationMs: 500, easing: 'linear', action: 'set', key: 'hall' }] }],
      },
    });
    r.advance();
    const background = stage.timelineEvents.find((event) => event.track === 'background');
    expect(background?.progress).toBe(1);
  });

  it('presentation snapshot restores active timeline cursor after stage state', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);
    bus.emit('timeline', {
      id: 'intro',
      blocking: false,
      definition: {
        version: 1, id: 'intro', durationMs: 100,
        tracks: [{ kind: 'camera', cues: [{ atMs: 0, durationMs: 100, easing: 'linear', action: 'zoom', scale: 1.1 }] }],
      },
    });
    r.update(40);
    const snap = r.snapshotPresentation();
    const nextStage = new FakeStage();
    const restored = new AdvRenderer(nextStage, new FakeAudio());
    restored.restorePresentation(snap);
    expect(nextStage.restored).toEqual([{ stage: 'snapshot' }]);
    restored.update(20);
    expect(nextStage.timelineEvents.some((event) => event.track === 'camera')).toBe(true);
  });

  it('state reset clears active presentation before stale timeline can complete', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let completed = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onWaitEnd: () => { completed++; } });
    r.subscribe(bus);
    bus.emit('timeline', {
      id: 'intro',
      blocking: true,
      definition: {
        version: 1, id: 'intro', durationMs: 100,
        tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 100, easing: 'linear', action: 'fade', alpha: 0 }] }],
      },
    });
    bus.emit('stateReset', { reason: 'load' });
    r.update(200);
    expect(completed).toBe(0);
    expect(stage.presentationClears).toBe(1);
  });

  it('text 事件 → 打字机 + 舞台文本投影（逐字推进到画面）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const tw = new Typewriter({ charsPerSecond: 100 });
    const r = new AdvRenderer(stage, new FakeAudio(), { typewriter: tw });
    r.subscribe(bus);

    bus.emit('text', { speaker: '凛', value: '你来了。' });
    expect(r.status).toBe('typing');
    expect(stage.texts.at(-1)).toEqual({ speaker: '凛', value: '' });

    r.update(10); // 1 字符：部分文本已推给舞台
    expect(stage.texts.at(-1)!.value).toBe('你');

    r.update(1000); // 打字完成
    expect(r.status).toBe('awaiting');
    expect(stage.texts.at(-1)).toEqual({ speaker: '凛', value: '你来了。' });
  });

  it('advance：打字中先瞬显，再推进回调', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const tw = new Typewriter({ charsPerSecond: 1 });
    let advanced = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { typewriter: tw, onAdvance: () => { advanced++; } });
    r.subscribe(bus);

    bus.emit('text', { speaker: null, value: '一行字' });
    expect(r.advance()).toBe(true); // 第一击：瞬时完成
    expect(tw.isDone).toBe(true);
    expect(advanced).toBe(0);

    expect(r.advance()).toBe(true); // 第二击：推进
    expect(advanced).toBe(1);
  });

  it('choice 事件 → 选项投影 + select 回调', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let selected = -1;
    const r = new AdvRenderer(stage, new FakeAudio(), { onSelect: (i) => { selected = i; } });
    r.subscribe(bus);

    bus.emit('choice', { options: [{ index: 0, label: 'A' }, { index: 1, label: 'B' }] });
    expect(r.status).toBe('choice');
    expect(stage.choices[0]).toEqual([{ index: 0, label: 'A' }, { index: 1, label: 'B' }]);

    expect(r.select(1)).toBe(true);
    expect(selected).toBe(1);
    expect(stage.hides).toBe(1);
  });

  it('选择肢初始不高亮，方向键首次输入才建立焦点', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);

    bus.emit('choice', { options: [{ index: 3, label: 'A' }, { index: 7, label: 'B' }, { index: 9, label: 'C' }] });
    expect(stage.choiceHighlights).toEqual([]);
    expect(r.choiceConfirm()).toBe(false);

    r.choiceDown();
    expect(stage.choiceHighlights).toEqual([0]);
    r.choiceUp();
    expect(stage.choiceHighlights).toEqual([0, 2]);
  });

  it('推进到下一句时不先清空对白，避免对话层闪烁', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const tw = new Typewriter({ charsPerSecond: 1000 });
    const r = new AdvRenderer(stage, new FakeAudio(), {
      typewriter: tw,
      onAdvance: () => bus.emit('text', { speaker: '凛', value: '下一句。' }),
    });
    r.subscribe(bus);

    bus.emit('text', { speaker: '凛', value: '上一句。' });
    r.update(1000);
    const beforeAdvance = stage.texts.length;
    expect(r.advance()).toBe(true);
    expect(stage.texts.slice(beforeAdvance)).toEqual([{ speaker: '凛', value: '' }]);
  });

  it('构造时把 onSelect 绑定到 stage（PixiStage 点击路径可用，修复真实 UI 卡死）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let selected = -1;
    const r = new AdvRenderer(stage, new FakeAudio(), { onSelect: (i) => { selected = i; } });
    r.subscribe(bus);

    // AdvRenderer 构造后 stage.onSelect 已被绑定（等效于 PixiStage.showChoices 的点击转发）
    expect(stage.onSelect).not.toBeNull();

    bus.emit('choice', { options: [{ index: 0, label: 'A' }, { index: 1, label: 'B' }] });
    expect(r.status).toBe('choice');
    // 模拟 PixiStage 选项 pointerdown → stage.onSelect(index)
    stage.onSelect?.(1);
    expect(selected).toBe(1);
    expect(r.status).toBe('idle');
    // 非 choice 状态下点击无副作用（不触发回调）
    stage.onSelect?.(0);
    expect(selected).toBe(1);
  });

  it('instr 事件：bg/show/hide 驱动舞台，bgm/se/voice 驱动音频，引号契约生效', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const audio = new FakeAudio();
    const r = new AdvRenderer(stage, audio);
    r.subscribe(bus);

    bus.emit('instr', { name: 'bg', args: ['"castle_hall"'], modifiers: new Map(), pos: { file: 'x', line: 1, col: 1 } });
    bus.emit('instr', { name: 'show', args: ['lynn:armor', 'despair'], modifiers: new Map([['pos', '"left"'], ['effect', 'shake']]), pos: { file: 'x', line: 1, col: 1 } });
    bus.emit('instr', { name: 'hide', args: ['lynn:armor'], modifiers: new Map(), pos: { file: 'x', line: 1, col: 1 } });
    bus.emit('instr', { name: 'bgm', args: ['"tense_01"'], modifiers: new Map(), pos: { file: 'x', line: 1, col: 1 } });
    bus.emit('instr', { name: 'voice', args: ['lynn_01'], modifiers: new Map(), pos: { file: 'x', line: 1, col: 1 } });

    expect(stage.backgrounds).toEqual(['castle_hall']); // 去引号
    expect(stage.portraits[0]).toMatchObject({ key: 'lynn:armor', view: { charId: 'lynn', costume: 'armor', expression: 'despair', pos: 'left' } });
    expect(stage.removed).toEqual(['lynn:armor']);
    expect(audio.bgm).toEqual(['tense_01']);
    expect(audio.voice).toEqual(['lynn_01']);
  });

  it('M3-2 裸位置修饰符 @ left 生效（规范示例写法）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);

    bus.emit('instr', { name: 'show', args: ['lynn:armor', 'normal'], modifiers: new Map([['left', ''], ['effect', 'shake']]), pos: { file: 'x', line: 1, col: 1 } });
    expect(stage.portraits[0]!.view.pos).toBe('left');

    bus.emit('instr', { name: 'show', args: ['lynn', 'normal'], modifiers: new Map([['right', '']]), pos: { file: 'x', line: 1, col: 1 } });
    expect(stage.portraits[1]!.view.pos).toBe('right');
  });

  it('M4 自动播放：打字完成后自动推进', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const tw = new Typewriter({ charsPerSecond: 10 });
    const r = new AdvRenderer(stage, new FakeAudio(), { typewriter: tw, onAdvance: () => { advanced++; } });
    r.subscribe(bus);

    expect(r.toggleAuto()).toBe(true);
    bus.emit('text', { speaker: null, value: '自动播放行' });
    r.update(1000); // 打字完成 → awaiting → 自动推进
    expect(advanced).toBe(1);
    expect(r.status).toBe('idle');
    r.destroy();
  });

  it('M4 快进：瞬时文本 + 连续推进', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onAdvance: () => { advanced++; } });
    r.subscribe(bus);

    expect(r.toggleSkip()).toBe(true);
    bus.emit('text', { speaker: null, value: '快进行' });
    r.update(1000); // skip：瞬时完成 + 推进
    expect(advanced).toBe(1);
    // 新文本到来（模拟推进后解释器发出的下一行）仍连续推进
    bus.emit('text', { speaker: null, value: '第二行' });
    r.update(1000);
    expect(advanced).toBe(2);
  });

  it('fadeout/fadein 指令驱动黑场', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);

    bus.emit('instr', { name: 'fadeout', args: ['200'], modifiers: new Map(), pos: { file: 'x', line: 1, col: 1 } });
    r.update(100);
    expect(stage.fades.at(-1)).toBeGreaterThan(0); // 正在淡出
    r.update(200);
    expect(stage.fades.at(-1)).toBe(1); // 完成

    bus.emit('instr', { name: 'fadein', args: ['200'], modifiers: new Map(), pos: { file: 'x', line: 1, col: 1 } });
    r.update(200);
    expect(stage.fades.at(-1)).toBe(0);
  });

  it('空文本行（如只有说话人前缀）不卡死：直接等待推进', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onAdvance: () => { advanced++; } });
    r.subscribe(bus);

    bus.emit('text', { speaker: '凛', value: '' });
    expect(r.status).toBe('awaiting'); // 不卡在 typing
    expect(r.advance()).toBe(true);
    expect(advanced).toBe(1);
  });

  it('自动播放遇空文本行直接推进', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onAdvance: () => { advanced++; } });
    r.subscribe(bus);
    r.toggleAuto();

    bus.emit('text', { speaker: '凛', value: '' });
    r.update(1000);
    expect(advanced).toBe(1);
    expect(r.status).toBe('idle');
  });

  it('快进遇空文本行仍连续推进', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onAdvance: () => { advanced++; } });
    r.subscribe(bus);
    r.toggleSkip();

    bus.emit('text', { speaker: '凛', value: '' });
    r.update(1000);
    expect(advanced).toBe(1);
    expect(r.status).toBe('idle');
  });

  it('@hide 纯角色 ID（规范写法）原样转发给 stage（前缀匹配移除是 PixiStage 职责）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);

    bus.emit('instr', { name: 'show', args: ['lynn:armor', 'despair'], modifiers: new Map([['left', '']]), pos: { file: 'x', line: 1, col: 1 } });
    bus.emit('instr', { name: 'hide', args: ['lynn'], modifiers: new Map(), pos: { file: 'x', line: 2, col: 1 } });
    expect(stage.calls).toContain('show:lynn:armor');
    expect(stage.removed).toEqual(['lynn']); // @show lynn:armor 后 @hide lynn 必须能生效（PixiStage 按前缀匹配）
  });

  it('M5 快进遇未读即停：已读行（wasRead=true）继续跳过，未读行退出快进正常播放', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onAdvance: () => { advanced++; } });
    r.subscribe(bus);
    r.toggleSkip();

    // 已读行：保持快进 → 瞬时完成 + 自动推进
    bus.emit('text', { speaker: null, value: '已读行', wasRead: true });
    r.update(1000);
    expect(advanced).toBe(1);
    expect(r.skipMode).toBe(true);

    // 未读行：立即退出快进，进入正常打字（不自动推进）
    bus.emit('text', { speaker: null, value: '未读行', wasRead: false });
    expect(r.skipMode).toBe(false);
    expect(r.status).toBe('typing');
    r.update(1000); // 打字完成，但停在 awaiting 等待玩家
    expect(advanced).toBe(1);
    expect(r.status).toBe('awaiting');
  });

  it('快进兼容旧载荷（无 wasRead 字段）：保持连续推进', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onAdvance: () => { advanced++; } });
    r.subscribe(bus);
    r.toggleSkip();

    bus.emit('text', { speaker: null, value: '旧载荷行' }); // 无 wasRead → 不停
    r.update(1000);
    expect(advanced).toBe(1);
    expect(r.skipMode).toBe(true);
  });
});

describe('集成：解释器 → 渲染器', () => {
  it('headless 全链路：文本/选择/分支/跨场景', () => {
    const decls: import('@surdet/core').VarDeclaration[] = [
      { name: 'trust', type: 'number', initial: 0 },
      { name: 'hasSword', type: 'flag', initial: false },
    ];
    const store = new VariableStore(decls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const interp = new Interpreter(store, bus, registry);
    const stage = new FakeStage();
    const renderer = new AdvRenderer(stage, new FakeAudio(), {
      onAdvance: () => interp.advance(),
      onSelect: (i) => interp.choose(i),
    });
    renderer.subscribe(bus);

    registry.register(compileScene(
      '@bg castle\n' +
      '@set hasSword = true\n' +
      '凛：你好。\n' +
      '@choice\n' +
      '  拔剑 -> @goto sword\n' +
      '  沉默 [if:hasSword] -> @goto silent\n' +
      '@label sword\n凛：你挥剑了。\n@jump ch02.start\n' +
      '@label silent\n凛：你沉默了。\n@jump ch02.start',
      'c1.gal', 'ch01',
    ));
    registry.register(compileScene('@label start\n凛：第二章。', 'c2.gal', 'ch02'));

    // 事件回调内同步驱动（迭代续跑）：打字完成后模拟点击推进
    bus.on('choice', () => renderer.select(1));
    bus.on('text', () => {
      renderer.update(1000); // 打字完成
      if (renderer.status === 'awaiting') renderer.advance();
    });

    interp.start('ch01');
    expect(stage.backgrounds).toContain('castle');
    expect(stage.texts.some((t) => t.value === '你沉默了。' && t.speaker === '凛')).toBe(true);
    expect(stage.texts.some((t) => t.value === '第二章。' && t.speaker === '凛')).toBe(true);
    expect(interp.status).toBe('ended');
    expect(store.getNumber('trust')).toBe(0);
  });

  it('空文本行全链路：剧情可推进到底（修复渲染卡死）', () => {
    const decls: import('@surdet/core').VarDeclaration[] = [
      { name: 'trust', type: 'number', initial: 0 },
    ];
    const store = new VariableStore(decls);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    const interp = new Interpreter(store, bus, registry);
    const stage = new FakeStage();
    const renderer = new AdvRenderer(stage, new FakeAudio(), {
      onAdvance: () => interp.advance(),
      onSelect: (i) => interp.choose(i),
    });
    renderer.subscribe(bus);

    registry.register(compileScene(
      '凛：\n' + // 只有说话人，无内容
      '凛：甲。\n' +
      '凛：\n' +
      '凛：乙。',
      'e.gal', 'empty',
    ));

    bus.on('text', () => {
      renderer.update(1000);
      if (renderer.status === 'awaiting') renderer.advance();
    });

    interp.start('empty');
    expect(stage.texts.some((t) => t.value === '甲。')).toBe(true);
    expect(stage.texts.some((t) => t.value === '乙。')).toBe(true);
    expect(interp.status).toBe('ended');
  });
});

describe('dequote 契约', () => {
  it('表达式值保留引号，通用指令值去引号', () => {
    // 渲染层只负责通用指令值
    expect(dequote('"a b"')).toBe('a b');
  });

  it('转义引号：剥外引号并还原转义序列', () => {
    expect(dequote('"a\\\"b"')).toBe('a"b');
    expect(dequote("'a\\'b'")).toBe("a'b");
    expect(dequote('"a\\\\b"')).toBe('a\\b');
  });
});

describe('R2 @wait 接线与演出效果', () => {
  it('@wait：到时回调 onWaitEnd（连 Interpreter.finishWait）', async () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let waitEnded = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onWaitEnd: () => { waitEnded++; } });
    r.subscribe(bus);

    bus.emit('wait', { ms: 40 });
    r.update(16); // 未到点
    expect(waitEnded).toBe(0);
    await new Promise((res) => setTimeout(res, 60));
    r.update(16); // 到点
    expect(waitEnded).toBe(1);
    r.update(16); // 不重复触发
    expect(waitEnded).toBe(1);
  });

  it('@wait：玩家点击 advance 跳过剩余等待', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let waitEnded = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onWaitEnd: () => { waitEnded++; } });
    r.subscribe(bus);

    bus.emit('wait', { ms: 99999 });
    expect(r.advance()).toBe(true);
    expect(waitEnded).toBe(1);
  });

  it('@wait：快进中立即跳过等待', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let waitEnded = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onWaitEnd: () => { waitEnded++; } });
    r.subscribe(bus);
    r.toggleSkip();

    bus.emit('wait', { ms: 99999 });
    r.update(16);
    expect(waitEnded).toBe(1);
  });

  it('演出指令 shake/flash/zoom 转发到舞台（参数解析与缺省值）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);
    const pos = { file: 'x', line: 1, col: 1 };

    bus.emit('instr', { name: 'shake', args: ['300', '12'], modifiers: new Map(), pos });
    bus.emit('instr', { name: 'shake', args: [], modifiers: new Map(), pos }); // 缺省 400/8
    bus.emit('instr', { name: 'flash', args: ['200'], modifiers: new Map(), pos });
    bus.emit('instr', { name: 'zoom', args: ['1.5', '600'], modifiers: new Map(), pos });
    bus.emit('instr', { name: 'zoom', args: ['bad'], modifiers: new Map(), pos }); // 非法 → 复位 1

    expect(stage.shakes).toEqual([{ dur: 300, strength: 12 }, { dur: 400, strength: 8 }]);
    expect(stage.flashes).toEqual([200]);
    expect(stage.zooms).toEqual([{ scale: 1.5, dur: 600 }, { scale: 1, dur: 400 }]);
    // 每帧驱动效果时间轴
    r.update(16);
    expect(stage.effectTicks).toBe(1);
  });

  it('@mov：立绘平移转发（三档预设与缺省时长；缺 key/pos 不转发）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);
    const pos = { file: 'x', line: 1, col: 1 };

    bus.emit('instr', { name: 'mov', args: ['lynn:armor', 'left', '600'], modifiers: new Map(), pos });
    bus.emit('instr', { name: 'mov', args: ['lynn', 'right'], modifiers: new Map(), pos }); // 缺省 dur 400
    bus.emit('instr', { name: 'mov', args: ['lynn'], modifiers: new Map(), pos }); // 缺 pos → 忽略
    bus.emit('instr', { name: 'mov', args: [], modifiers: new Map(), pos }); // 缺 key → 忽略

    expect(stage.movs).toEqual([
      { key: 'lynn:armor', pos: 'left', dur: 600 },
      { key: 'lynn', pos: 'right', dur: 400 },
    ]);
  });

  it('@tint：调色转发（颜色/透明度解析、off 清除、非法颜色忽略）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);
    const pos = { file: 'x', line: 1, col: 1 };

    bus.emit('instr', { name: 'tint', args: ['0xff8866', '0.3', '500'], modifiers: new Map(), pos });
    bus.emit('instr', { name: 'tint', args: ['#2244aa'], modifiers: new Map(), pos }); // 缺省 alpha 0.5 / dur 400
    bus.emit('instr', { name: 'tint', args: ['off', '300'], modifiers: new Map(), pos });
    bus.emit('instr', { name: 'tint', args: ['notacolor'], modifiers: new Map(), pos }); // 非法 → 忽略

    expect(stage.tints).toEqual([
      { color: 0xff8866, alpha: 0.3, dur: 500 },
      { color: 0x2244aa, alpha: 0.5, dur: 400 },
    ]);
    expect(stage.tintClears).toEqual([300]);
  });

  it('@particle：粒子启停转发（预设名与 off；空参数忽略）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);
    const pos = { file: 'x', line: 1, col: 1 };

    bus.emit('instr', { name: 'particle', args: ['snow'], modifiers: new Map(), pos });
    bus.emit('instr', { name: 'particle', args: ['sakura'], modifiers: new Map(), pos });
    bus.emit('instr', { name: 'particle', args: ['off'], modifiers: new Map(), pos });
    bus.emit('instr', { name: 'particle', args: [], modifiers: new Map(), pos }); // 空 → 忽略

    expect(stage.particlesStarted).toEqual(['snow', 'sakura']);
    expect(stage.particlesStopped).toBe(1);
  });
});

describe('dsl-spec 演出三件套示例防漂移（文档语法 = 实现行为；审计轮4）', () => {
  /** 编译 dsl-spec 示例行并经解释器真实驱动渲染器（端到端：lexer → compiler → interpreter → renderer → stage） */
  function runScene(src: string): FakeStage {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);
    const registry = new SceneRegistry();
    registry.register(compileScene(src, 'spec.gal', 'spec'));
    const interp = new Interpreter(new VariableStore([]), bus, registry);
    interp.start('spec');
    return stage;
  }

  it('@particle sakura / @particle off（预设启动与清除）', () => {
    const stage = runScene('@particle sakura\n@particle off');
    expect(stage.particlesStarted).toEqual(['sakura']);
    expect(stage.particlesStopped).toBe(1);
  });

  it('@mov lynn left / @mov lynn 400 600（位置 = 三档预设或裸数字 X；缺省 400ms）', () => {
    const stage = runScene('@mov lynn left\n@mov lynn 400 600');
    expect(stage.movs).toEqual([
      { key: 'lynn', pos: 'left', dur: 400 },
      { key: 'lynn', pos: '400', dur: 600 },
    ]);
  });

  it('@tint #ff6600 0.3 / @tint #ff6600 0.3 800 / @tint off（颜色+透明度[过渡]）', () => {
    const stage = runScene('@tint #ff6600 0.3\n@tint #ff6600 0.3 800\n@tint off');
    expect(stage.tints).toEqual([
      { color: 0xff6600, alpha: 0.3, dur: 400 },
      { color: 0xff6600, alpha: 0.3, dur: 800 },
    ]);
    expect(stage.tintClears).toEqual([400]);
  });
});

describe('R1 行为改进与新特性', () => {
  it('快进遇选择肢自动退出（玩家必须做出选择）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), { onAdvance: () => { advanced++; } });
    r.subscribe(bus);
    r.toggleSkip();

    bus.emit('text', { speaker: null, value: '已读行', wasRead: true });
    r.update(1000);
    expect(advanced).toBe(1);
    expect(r.skipMode).toBe(true);

    // 解释器发出选择肢：快进必须退出，不得越过选择
    bus.emit('choice', { options: [{ index: 0, label: 'A' }] });
    expect(r.skipMode).toBe(false);
    expect(r.status).toBe('choice');
    r.update(1000); // 不应有任何自动推进
    expect(advanced).toBe(1);
  });

  it('自动播放停留：未到停留时长不推进，到时后推进', async () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const tw = new Typewriter({ charsPerSecond: 100 });
    const r = new AdvRenderer(stage, new FakeAudio(), {
      typewriter: tw,
      autoBaseDelayMs: 40,
      onAdvance: () => { advanced++; },
    });
    r.subscribe(bus);
    r.toggleAuto();

    bus.emit('text', { speaker: null, value: '自动行' });
    r.update(1000); // 打字完成 → awaiting（停留未到）
    expect(r.status).toBe('awaiting');
    expect(advanced).toBe(0);
    r.update(16); // 仍未到
    expect(advanced).toBe(0);

    await new Promise((res) => setTimeout(res, 60));
    r.update(16); // 停留期满 → 推进
    expect(advanced).toBe(1);
  });

  it('自动播放等语音播完再推进', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const audio = new FakeAudio();
    let playing = true;
    audio.isVoicePlaying = () => playing;
    const tw = new Typewriter({ charsPerSecond: 100 });
    const r = new AdvRenderer(stage, audio, { typewriter: tw, onAdvance: () => { advanced++; } });
    r.subscribe(bus);
    r.toggleAuto();

    bus.emit('text', { speaker: null, value: '语音行' });
    r.update(1000);
    expect(advanced).toBe(0); // 语音播放中 → 等待
    r.update(1000);
    expect(advanced).toBe(0);

    playing = false; // 语音播完
    r.update(16);
    expect(advanced).toBe(1);
  });

  it('Backlog：text 事件自动记录，容量淘汰最旧', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const backlog = new Backlog(3);
    const r = new AdvRenderer(stage, new FakeAudio(), { backlog });
    r.subscribe(bus);

    bus.emit('text', { speaker: '凛', value: '第一行' });
    bus.emit('text', { speaker: null, value: '第二行' });
    bus.emit('text', { speaker: '旁白', value: '第三行' });
    bus.emit('text', { speaker: '凛', value: '第四行' }); // 超容量 → 淘汰最旧

    expect(backlog.size).toBe(3);
    expect(r.backlogEntries().map((e) => e.text)).toEqual(['第二行', '第三行', '第四行']);
    expect(backlog.entries()[0]).toEqual({ speaker: null, text: '第二行' });
    // toggleBacklog：fake stage 未实现覆盖层仍正常切换状态
    expect(r.toggleBacklog()).toBe(true);
    expect(r.backlogOpen).toBe(true);
    expect(r.toggleBacklog()).toBe(false);
    // 未注入 backlog 时 toggle 返回 false
    const r2 = new AdvRenderer(stage, new FakeAudio());
    expect(r2.toggleBacklog()).toBe(false);
  });

  it('Backlog 被舞台点击关闭后同步内部状态', () => {
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio(), { backlog: new Backlog() });
    expect(r.toggleBacklog()).toBe(true);
    stage.onBacklogClose?.();
    expect(r.backlogOpen).toBe(false);
    expect(r.toggleBacklog()).toBe(true);
  });

  it('Backlog 语音关联：@voice 紧跟的文本行带上语音 key（回放用）；读档后关联重置', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const backlog = new Backlog();
    const r = new AdvRenderer(stage, new FakeAudio(), { backlog });
    r.subscribe(bus);

    bus.emit('instr', { name: 'voice', args: ['lynn_001'], modifiers: new Map(), pos: { file: 'x', line: 1, col: 1 } });
    bus.emit('text', { speaker: '凛', value: '带语音的行' });
    bus.emit('text', { speaker: null, value: '无语音的行' }); // 关联只跟随一行

    const entries = backlog.entries();
    expect(entries[0]?.voice).toBe('lynn_001');
    expect(entries[1]?.voice).toBeUndefined();

    // 读档状态重置：旧语音关联不跨读档延续
    bus.emit('stateReset', { reason: 'load' });
    bus.emit('text', { speaker: null, value: '读档后的行' });
    expect(backlog.entries().at(-1)?.voice).toBeUndefined();
  });

  it('隐藏界面：toggleHideInterface 转发到舞台（H 键赏画惯例）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const hiddenStates: boolean[] = [];
    stage.hideInterface = (h: boolean): void => { hiddenStates.push(h); };
    const r = new AdvRenderer(stage, new FakeAudio());
    r.subscribe(bus);

    expect(r.interfaceHidden).toBe(false);
    expect(r.toggleHideInterface()).toBe(true);
    expect(r.interfaceHidden).toBe(true);
    expect(r.toggleHideInterface()).toBe(false);
    expect(hiddenStates).toEqual([true, false]);
  });

  it('resetSession：清理等待/选择肢/Backlog/NVL 等渲染状态并恢复 idle', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio(), { backlog: new Backlog() });
    r.subscribe(bus);
    bus.emit('text', { speaker: '凛', value: '旧会话文本' });
    bus.emit('choice', { options: [{ index: 0, label: '旧选项' }] });
    r.toggleBacklog();
    r.toggleHideInterface();

    r.resetSession();

    expect(r.status).toBe('idle');
    expect(r.backlogOpen).toBe(false);
    expect(r.interfaceHidden).toBe(false);
    expect(stage.hides).toBeGreaterThan(0);
    expect(stage.texts.at(-1)).toEqual({ speaker: null, value: '' });
  });
});

describe('快进批量推进', () => {
  it('单帧内连续推进多行已读文本（不受帧率限制）', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    const TOTAL = 50;
    let idx = 0;
    let advanced = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), {
      onAdvance: () => {
        advanced++;
        idx++;
        if (idx < TOTAL) bus.emit('text', { speaker: null, value: `行${idx}`, wasRead: true });
      },
    });
    r.subscribe(bus);
    r.toggleSkip();

    bus.emit('text', { speaker: null, value: '行0', wasRead: true });
    r.update(16); // 单帧应批量推进全部 50 行
    expect(advanced).toBe(TOTAL);
  });

  it('快进批量推进遇未读行立即停止并正常播放', () => {
    const bus = makeBus();
    const stage = new FakeStage();
    let advanced = 0;
    const r = new AdvRenderer(stage, new FakeAudio(), {
      onAdvance: () => {
        advanced++;
        // 第二行未读：应停在该行
        bus.emit('text', { speaker: null, value: '未读行', wasRead: false });
      },
    });
    r.subscribe(bus);
    r.toggleSkip();

    bus.emit('text', { speaker: null, value: '已读行', wasRead: true });
    r.update(16);
    expect(advanced).toBe(1); // 只推进了已读行，未读行停住
    expect(r.skipMode).toBe(false);
    expect(r.status).toBe('typing');
  });
});


describe('AdvRenderer C1：stateReset 作废等待计时与视频回调（审计复核）', () => {
  function make(onWaitEnd: () => void) {
    const stage = new FakeStage();
    const r = new AdvRenderer(stage, new FakeAudio(), { onWaitEnd });
    const bus = makeBus();
    r.subscribe(bus);
    return { stage, r, bus };
  }

  it('正向：@wait 到时触发一次 onWaitEnd', () => {
    let ends = 0;
    const { r, bus } = make(() => { ends++; });
    bus.emit('wait', { ms: 0 }); // 0ms：deadline = nowMs()，update 立即到点（update 走真实时钟）
    r.update(100);
    expect(ends).toBe(1);
    r.update(100); // 幂等：不重复触发
    expect(ends).toBe(1);
  });

  it('stateReset 作废等待计时：之后 update 不再触发 onWaitEnd', () => {
    let ends = 0;
    const { r, bus } = make(() => { ends++; });
    bus.emit('wait', { ms: 60000 });
    bus.emit('stateReset', { reason: 'load' });
    r.update(999999);
    expect(ends).toBe(0); // 修复前：deadline 残留 → 触发 finishWait 状态失配崩溃
  });

  it('stateReset 作废视频结束回调（会话令牌）', () => {
    let ends = 0;
    const { stage, r, bus } = make(() => { ends++; });
    let onEnd: (() => void) | null = null;
    (stage as FakeStage & { showVideo?: (src: string, cb: () => void) => void }).showVideo = (_src, cb) => { onEnd = cb; };
    bus.emit('video', { src: 'v.mp4' });
    expect(onEnd).not.toBeNull();
    bus.emit('stateReset', { reason: 'load' });
    onEnd!(); // 残留的视频结束回调
    expect(ends).toBe(0); // 已被会话令牌作废
    // 正向对照：无 stateReset 时回调照常生效
    let onEnd2: (() => void) | null = null;
    (stage as FakeStage & { showVideo?: (src: string, cb: () => void) => void }).showVideo = (_src, cb) => { onEnd2 = cb; };
    bus.emit('video', { src: 'v2.mp4' });
    onEnd2!();
    expect(ends).toBe(1);
  });
});
