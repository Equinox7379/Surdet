import { describe, expect, it } from 'vitest';
import { EventBus, compileScene, Interpreter, SceneRegistry, VariableStore } from '@surdet/core';
import { AdvRenderer, Typewriter, dequote } from '../src/index.js';
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
  setFade(alpha: number): void {
    this.calls.push(`fade:${alpha.toFixed(2)}`);
    this.fades.push(alpha);
  }
}

class FakeAudio implements AudioHandle {
  bgm: (string | null)[] = [];
  se: string[] = [];
  voice: string[] = [];
  playBgm(src: string | null): void { this.bgm.push(src); }
  playSe(src: string): void { this.se.push(src); }
  playVoice(src: string): void { this.voice.push(src); }
}

function makeBus() {
  return new EventBus();
}

describe('AdvRenderer', () => {
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
});

describe('集成：解释器 → 渲染器', () => {
  it('headless 全链路：文本/选择/分支/跨场景', () => {
    const decls: import('@surdet/core').VarDeclaration[] = [
      { name: 'trust', type: 'number', initial: 0 },
      { name: 'hasSword', type: 'flag', initial: false },
    ];
    const store = new VariableStore(decls);
    const bus = new EventBus();
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
    bus.on<{ options: { index: number; label: string }[] }>('choice', () => renderer.select(1));
    bus.on<{ speaker: string | null; value: string }>('text', () => {
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
    const bus = new EventBus();
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

    bus.on<{ speaker: string | null; value: string }>('text', () => {
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
});
