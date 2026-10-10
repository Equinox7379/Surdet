import { describe, expect, it, vi } from 'vitest';
import { Typewriter } from '../src/text-buffer.js';

describe('行内标签的帧时间打字进度', () => {
  it('按字素簇、样式速度与定时停顿推进，标签不占时间', () => {
    const tw = new Typewriter({ charsPerSecond: 10 });
    tw.text = '<b>👩‍🚀</b><w=500><speed=2>甲乙</speed>';
    tw.update(100); expect(tw.text).toBe('👩‍🚀'); expect(tw.isPaused).toBe(true);
    tw.update(499); expect(tw.text).toBe('👩‍🚀');
    tw.update(51); expect(tw.text).toBe('👩‍🚀甲');
    tw.update(50); expect(tw.isDone).toBe(true); expect(tw.text).toBe('👩‍🚀甲乙');
  });
  it('点击只揭示到下一个等待点，下一次点击继续原句', () => {
    const tw = new Typewriter({ charsPerSecond: 10 }); tw.text = '甲<w=900>乙<w>丙';
    tw.revealToNextWait(); expect(tw.text).toBe('甲乙'); expect(tw.isWaiting).toBe(true);
    tw.update(10000); expect(tw.text).toBe('甲乙'); expect(tw.waitingLength).toBe(2);
    tw.revealToNextWait(); expect(tw.isWaiting).toBe(false); expect(tw.isDone).toBe(false);
    tw.update(100); expect(tw.text).toBe('甲乙丙'); expect(tw.isDone).toBe(true);
  });
  it('快进忽略所有等待，完成回调只触发一次', () => {
    const tw = new Typewriter(); const complete = vi.fn(); tw.onComplete = complete;
    tw.text = '<w>甲<w=500>乙<w>'; tw.skip(); tw.skip(); tw.update(1000);
    expect(tw.text).toBe('甲乙'); expect(complete).toHaveBeenCalledTimes(1);
  });
  it('无帧推进时停顿冻结，句末等待不会提前完成', () => {
    const tw = new Typewriter({ charsPerSecond: 10 }); tw.text = '甲<w=500><w>';
    tw.update(100); tw.update(0); expect(tw.isDone).toBe(false);
    tw.update(500); expect(tw.isWaiting).toBe(true); expect(tw.isDone).toBe(false);
    tw.resumeWait(); expect(tw.isDone).toBe(true);
  });
  it('注音成组显示，旧书名号照字面推进', () => {
    const tw = new Typewriter({ charsPerSecond: 10 }); tw.text = '<ruby=せかい>世界</ruby>《书》';
    tw.update(100); expect(tw.text).toBe('世界'); expect(tw.shown).toBe(1); expect(tw.visibleLength).toBe(5);
  });
  it('语言更换按可见单元保留比例，解除旧停顿且不触发完成', () => {
    const tw = new Typewriter({ charsPerSecond: 10 }); const complete = vi.fn(); tw.onComplete = complete;
    tw.text = '甲<w>乙'; tw.update(100); tw.replaceText('<b>一二三四</b>');
    expect(tw.text).toBe('一二'); expect(tw.isWaiting).toBe(false); expect(complete).not.toHaveBeenCalled();
    tw.update(200); expect(complete).toHaveBeenCalledTimes(1);
  });
});
