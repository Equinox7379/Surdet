import { describe, expect, it } from 'vitest';
import { dequote } from '../src/dequote.js';
import { Typewriter } from '../src/text-buffer.js';
import { ValueTween, FadeTween, EASINGS } from '../src/transitions.js';

describe('dequote', () => {
  it('剥离首尾匹配引号', () => {
    expect(dequote('"castle_hall"')).toBe('castle_hall');
    expect(dequote("'a b'")).toBe('a b');
  });

  it('不匹配/无引号保持原样', () => {
    expect(dequote('castle')).toBe('castle');
    expect(dequote('"unclosed')).toBe('"unclosed');
    expect(dequote('a"b"')).toBe('a"b"');
    expect(dequote('"a"b')).toBe('"a"b');
    expect(dequote('')).toBe('');
  });

  it('转义感知：内部转义引号可剥外引号并还原；中间裸引号不剥', () => {
    expect(dequote('"a\\\"b"')).toBe('a"b');
    expect(dequote("'a\\'b'")).toBe("a'b");
    expect(dequote('"a\\\\b"')).toBe('a\\b');
    expect(dequote('"a\"b')).toBe('"a\"b'); // 引号未闭合（转义后无闭合引号）保持原样
    expect(dequote('"a"b"')).toBe('"a"b"'); // 中间未转义引号：非单一引号值
  });
});

describe('Typewriter', () => {
  it('按 cps 逐字推进', () => {
    const tw = new Typewriter({ charsPerSecond: 10 });
    tw.text = 'hello';
    expect(tw.isDone).toBe(false);
    tw.update(100); // 1 字符
    expect(tw.text).toBe('h');
    tw.update(400); // 4 字符 → 全 5
    expect(tw.text).toBe('hello');
    expect(tw.isDone).toBe(true);
  });

  it('skip 瞬时完成并回调', () => {
    const tw = new Typewriter();
    let done = 0;
    tw.onComplete = () => { done++; };
    tw.text = '很长的一段文字';
    tw.skip();
    expect(tw.isDone).toBe(true);
    expect(tw.text).toBe('很长的一段文字');
    expect(done).toBe(1);
    tw.skip(); // 幂等
    expect(done).toBe(1);
  });

  it('update 完成时触发 onComplete', () => {
    const tw = new Typewriter({ charsPerSecond: 100 });
    let done = 0;
    tw.onComplete = () => { done++; };
    tw.text = 'abc';
    tw.update(1000);
    expect(done).toBe(1);
  });

  it('空文本立即完成', () => {
    const tw = new Typewriter();
    tw.text = '';
    expect(tw.isDone).toBe(true);
  });

  it('空文本触发 onComplete（修复：渲染状态机不卡死）', () => {
    const tw = new Typewriter();
    let done = 0;
    tw.onComplete = () => { done++; };
    tw.text = '';
    expect(tw.isDone).toBe(true);
    expect(done).toBe(1);
  });

  it('setSpeed 运行时调整打字速度（非法值忽略）', () => {
    const tw = new Typewriter({ charsPerSecond: 10 });
    expect(tw.speed).toBe(10);
    tw.setSpeed(40);
    expect(tw.speed).toBe(40);
    tw.text = 'abcd';
    tw.update(100); // 40 cps → 4 字符
    expect(tw.isDone).toBe(true);
    tw.setSpeed(NaN);
    expect(tw.speed).toBe(40);
    tw.setSpeed(0);
    expect(tw.speed).toBe(40);
  });
});

describe('ValueTween', () => {
  it('线性插值按时长推进', () => {
    const t = new ValueTween(0, 1, 1000, EASINGS.linear);
    expect(t.value).toBe(0);
    t.update(250);
    expect(t.value).toBeCloseTo(0.25, 5);
    t.update(750);
    expect(t.value).toBe(1);
    expect(t.done).toBe(true);
  });

  it('零时长立即完成', () => {
    const t = new ValueTween(0, 1, 0);
    expect(t.done).toBe(false);
    expect(t.value).toBe(1);
    t.update(0);
    expect(t.done).toBe(true);
  });

  it('FadeTween 暴露 alpha', () => {
    const f = new FadeTween(0, 1, 1000, EASINGS.linear);
    f.update(500);
    expect(f.alpha).toBeCloseTo(0.5, 5);
  });
});
