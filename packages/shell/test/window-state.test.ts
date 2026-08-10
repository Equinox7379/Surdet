import { describe, expect, it } from 'vitest';
import { resolveWindowState, type WorkArea } from '../src/window-state.js';

const primary: WorkArea = { x: 0, y: 0, width: 1920, height: 1080 };
const secondary: WorkArea = { x: 1920, y: 0, width: 2560, height: 1440 };

describe('resolveWindowState', () => {
  it('保留位于主屏内的有效位置和尺寸', () => {
    const result = resolveWindowState({ x: 120, y: 80, width: 1280, height: 720 }, [primary]);
    expect(result).toMatchObject({ x: 120, y: 80, width: 1280, height: 720 });
  });

  it('保留仍有足够可见交集的部分离屏窗口', () => {
    const result = resolveWindowState({ x: 1840, y: 120, width: 800, height: 600 }, [primary]);
    expect(result).toMatchObject({ x: 1840, y: 120, width: 800, height: 600 });
  });

  it('把完全离屏或只露出微小角落的窗口移回主屏中央', () => {
    const offscreen = resolveWindowState({ x: 3000, y: 1300, width: 800, height: 600 }, [primary]);
    const tinyCorner = resolveWindowState({ x: 1900, y: 1040, width: 800, height: 600 }, [primary]);
    expect(offscreen).toMatchObject({ x: 560, y: 240 });
    expect(tinyCorner).toMatchObject({ x: 560, y: 240 });
  });

  it('在第二块屏幕上仍有足够交集时保留位置', () => {
    const result = resolveWindowState({ x: 2000, y: 100, width: 1280, height: 720 }, [primary, secondary]);
    expect(result).toMatchObject({ x: 2000, y: 100, width: 1280, height: 720 });
  });

  it('拒绝非有限或非正尺寸，并回落到安全默认值', () => {
    const result = resolveWindowState({ x: Number.NaN, y: Number.POSITIVE_INFINITY, width: Number.NaN, height: -1 }, [primary]);
    expect(result.width).toBeGreaterThanOrEqual(640);
    expect(result.height).toBeGreaterThanOrEqual(360);
    expect(result).toMatchObject({ x: 320, y: 180 });
  });

  it('压缩超出屏幕的尺寸，但不把窗口压成不可用的小尺寸', () => {
    const result = resolveWindowState({ x: 0, y: 0, width: 100_000, height: 100_000 }, [primary]);
    expect(result.width).toBeLessThanOrEqual(primary.width);
    expect(result.height).toBeLessThanOrEqual(primary.height);
    expect(result.width).toBeGreaterThanOrEqual(640);
    expect(result.height).toBeGreaterThanOrEqual(360);
  });

  it('没有位置时在主屏安全区域居中，并保留全屏标志', () => {
    const result = resolveWindowState({ width: 1280, height: 720, fullScreen: true }, [primary]);
    expect(result).toMatchObject({ x: 320, y: 180, width: 1280, height: 720, fullScreen: true });
  });

  it('没有可用屏幕信息时仍返回安全尺寸而不伪造位置', () => {
    const result = resolveWindowState({ width: 1280, height: 720 }, []);
    expect(result).toMatchObject({ width: 1280, height: 720 });
    expect(result.x).toBeUndefined();
    expect(result.y).toBeUndefined();
  });
});
