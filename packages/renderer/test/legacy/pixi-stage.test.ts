import { afterEach, describe, expect, it, vi } from 'vitest';
import { Assets, Sprite, Text as PText, TextStyle, Texture } from 'pixi.js';
import { PixiStage } from '../../src/pixi-stage.js';
import { DialogueLayer } from '../../src/layers/dialogue/dialogue-layer.js';

const defaultFontFamily = TextStyle.defaultTextStyle.fontFamily;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  TextStyle.defaultTextStyle.fontFamily = defaultFontFamily;
});

/**
 * 素材注入 API 测试。
 * PixiStage 的渲染（init/WebGL）与程序化占位纹理（依赖 document.createElement('canvas')）
 * 无法在 node 环境运行。因此断言策略：
 *   - 注册真实 Texture 后调用 setBackground/setPortrait「不抛错」即证明命中注入分支
 *     （若仍走占位分支会因 document 未定义而抛错）。
 *   - URL 加载（Assets.load）与占位回退属浏览器运行时行为，不在此覆盖。
 */
describe('PixiStage 素材注入', () => {
  function makeStage(): PixiStage {
    return new PixiStage();
  }

  it('内置转场由同一帧链推进，未知名称不启动', () => {
    const stage = makeStage();
    expect(stage.transition('slide-left', 100)).toBe(true);
    expect(stage.needsUpdate()).toBe(true);
    stage.updateEffects(100);
    expect(stage.needsUpdate()).toBe(false);
    expect(stage.transition('not-registered', 100)).toBe(false);
    stage.destroy();
  });

  it('registerBackground(Texture) 后 setBackground 命中真实素材（不落占位）', async () => {
    const stage = makeStage();
    await stage.registerBackground('castle', Texture.EMPTY);
    stage.setBackground('castle');
    stage.setBackground('castle'); // 重复调用稳定
  });

  it('重复注册覆盖旧素材', async () => {
    const stage = makeStage();
    await stage.registerBackground('forest', Texture.EMPTY);
    await stage.registerBackground('forest', Texture.EMPTY);
    stage.setBackground('forest');
  });

  it('Blob URL 注册图片时显式选择 Pixi 解析器，避免回退占位纹理', async () => {
    const load = vi.spyOn(Assets, 'load').mockResolvedValue(Texture.EMPTY as never);
    const stage = makeStage();
    await stage.registerBackground('castle', 'blob:castle', 'image/png');
    await stage.registerPortrait('lynn', 'uniform', 'normal', 'blob:portrait', 'image/png');
    await stage.registerAvatar('lynn', 'blob:avatar', 'image/svg+xml');
    expect(load).toHaveBeenNthCalledWith(1, { src: 'blob:castle', parser: 'loadTextures' });
    expect(load).toHaveBeenNthCalledWith(2, { src: 'blob:portrait', parser: 'loadTextures' });
    expect(load).toHaveBeenNthCalledWith(3, { src: 'blob:avatar', parser: 'loadSVG' });
  });

  it('resetSession 默认保留宿主已注册素材，开始新游戏后仍可命中真实纹理', async () => {
    const stage = makeStage();
    await stage.registerBackground('castle', Texture.EMPTY);
    stage.resetSession();
    stage.setBackground('castle');
  });

  it('registerPortrait(Texture) 后 setPortrait 命中真实素材（不落占位）', async () => {
    const stage = makeStage();
    await stage.registerPortrait('lynn', 'armor', 'despair', Texture.EMPTY);
    stage.setPortrait('lynn:armor', { charId: 'lynn', costume: 'armor', expression: 'despair', pos: 'left' });
  });

  it('注册指定表情后 setPortrait 精确命中（按角色:服装:表情维度区分）', async () => {
    const stage = makeStage();
    await stage.registerPortrait('lynn', 'armor', 'normal', Texture.EMPTY);
    stage.setPortrait('lynn:armor', { charId: 'lynn', costume: 'armor', expression: 'normal', pos: 'center' });
  });

  it('destroy 不销毁宿主注入的纹理（生命周期归宿主/Pixi Assets 缓存）', async () => {
    const stage = makeStage();
    await stage.registerBackground('castle', Texture.EMPTY);
    await stage.registerPortrait('lynn', 'armor', 'normal', Texture.EMPTY);
    stage.setBackground('castle');
    stage.setPortrait('lynn:armor', { charId: 'lynn', costume: 'armor', expression: 'normal', pos: 'center' });
    stage.destroy();
    // 注入纹理由宿主共享（此处为 Texture.EMPTY）：destroy 后仍存活，未被销毁
    expect(Texture.EMPTY.destroyed).toBe(false);
  });

  it('释放通过 URL 加载的 Pixi 资源，但不触碰宿主注入纹理', async () => {
    const load = vi.spyOn(Assets, 'load').mockResolvedValue(Texture.EMPTY as never);
    const unload = vi.spyOn(Assets, 'unload').mockResolvedValue();
    const stage = makeStage();
    await stage.registerBackground('castle', 'blob:castle');
    await stage.registerPortrait('lynn', 'armor', 'normal', 'blob:portrait');
    await stage.registerAvatar('lynn', 'blob:avatar');

    await stage.releaseRegisteredAssetSources();

    expect(load).toHaveBeenCalledTimes(3);
    expect(unload.mock.calls.flatMap(([sources]) => sources).sort())
      .toEqual(['blob:avatar', 'blob:castle', 'blob:portrait']);
    expect(Texture.EMPTY.destroyed).toBe(false);
  });

  it('removePortrait 支持纯角色 ID（规范写法 @hide lynn）：移除该角色全部立绘', async () => {
    const stage = makeStage();
    await stage.registerPortrait('lynn', 'armor', 'despair', Texture.EMPTY);
    await stage.registerPortrait('lynn', 'casual', 'normal', Texture.EMPTY);
    await stage.registerPortrait('mio', 'uniform', 'normal', Texture.EMPTY);
    stage.setPortrait('lynn:armor', { charId: 'lynn', costume: 'armor', expression: 'despair', pos: 'left' });
    stage.setPortrait('lynn:casual', { charId: 'lynn', costume: 'casual', expression: 'normal', pos: 'right' });
    stage.setPortrait('mio:uniform', { charId: 'mio', costume: 'uniform', expression: 'normal', pos: 'center' });

    // 规范写法 @hide lynn：前缀匹配移除 lynn 的两套立绘，不碰 mio；重复调用幂等
    stage.removePortrait('lynn');
    stage.removePortrait('lynn');
    // 完整 key 写法仍支持精确移除
    stage.removePortrait('mio:uniform');
  });

  it('删除交叉淡化中的立绘后，下一帧不会继续写入已销毁 Sprite', async () => {
    const destroyed = new WeakSet<Sprite>();
    const originalDestroy = Sprite.prototype.destroy as unknown as (...args: any[]) => void;
    vi.spyOn(Sprite.prototype, 'destroy').mockImplementation(function (this: Sprite, ...args: any[]) {
      let x = this.x;
      let alpha = this.alpha;
      originalDestroy.apply(this, args);
      destroyed.add(this);
      Object.defineProperty(this, 'x', {
        configurable: true,
        get: () => x,
        set: () => { throw new Error('write to destroyed portrait'); },
      });
      Object.defineProperty(this, 'alpha', {
        configurable: true,
        get: () => alpha,
        set: (value: number) => {
          if (destroyed.has(this)) throw new Error('write to destroyed portrait');
          alpha = value;
        },
      });
    });

    const stage = new PixiStage();
    await stage.registerPortrait('lynn', 'uniform', 'normal', Texture.EMPTY);
    await stage.registerPortrait('lynn', 'uniform', 'happy', Texture.WHITE);
    stage.setPortrait('lynn:uniform', { charId: 'lynn', costume: 'uniform', expression: 'normal', pos: 'left' });
    stage.setPortrait('lynn:uniform', { charId: 'lynn', costume: 'uniform', expression: 'happy', pos: 'left' });
    stage.removePortrait('lynn');

    expect(() => stage.updateEffects(300)).not.toThrow();
  });

  it('删除移动中的立绘后，下一帧不会继续驱动已销毁 Sprite', async () => {
    const destroyed = new WeakSet<Sprite>();
    const originalDestroy = Sprite.prototype.destroy as unknown as (...args: any[]) => void;
    vi.spyOn(Sprite.prototype, 'destroy').mockImplementation(function (this: Sprite, ...args: any[]) {
      let x = this.x;
      originalDestroy.apply(this, args);
      destroyed.add(this);
      Object.defineProperty(this, 'x', {
        configurable: true,
        get: () => x,
        set: () => { throw new Error('write to destroyed portrait'); },
      });
    });

    const stage = new PixiStage();
    await stage.registerPortrait('lynn', 'uniform', 'normal', Texture.EMPTY);
    stage.setPortrait('lynn:uniform', { charId: 'lynn', costume: 'uniform', expression: 'normal', pos: 'left' });
    stage.movePortrait('lynn', 'right', 400);
    stage.removePortrait('lynn');

    expect(() => stage.updateEffects(500)).not.toThrow();
  });

  it('Ruby 文本重绘复用对象池，仅在容量增长时创建新对象', () => {
    class FakeCanvasRenderingContext2D {
      font = '';
      measureText(text: string) {
        return {
        width: text.length * 10,
        actualBoundingBoxAscent: 20,
        actualBoundingBoxDescent: 5,
        };
      }
    }
    const context = new FakeCanvasRenderingContext2D();
    vi.stubGlobal('CanvasRenderingContext2D', FakeCanvasRenderingContext2D);
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => context }),
    });
    const destroySpy = vi.spyOn(PText.prototype, 'destroy');
    const stage = new PixiStage();
    const before = destroySpy.mock.calls.length;

    stage.showText('凛', '<ruby=こう>甲</ruby>');
    stage.showText('凛', '<ruby=こう>甲</ruby>', 0);
    expect((stage.dialogueLayer as DialogueLayer).debugSnapshot().dialogText).toBe('');
    stage.showText('凛', '<ruby=こう>甲</ruby>', 1);
    expect((stage.dialogueLayer as DialogueLayer).debugSnapshot().dialogText).toBe('甲');
    const afterFirst = destroySpy.mock.calls.length;
    stage.showText('凛', '<ruby=こう>甲</ruby><ruby=おつ>乙</ruby>');
    const afterLonger = destroySpy.mock.calls.length;

    expect(afterFirst).toBe(before);
    expect(afterLonger).toBe(afterFirst);
    stage.destroy();
    expect(destroySpy.mock.calls.length).toBeGreaterThan(afterLonger);
  });
});

describe('PixiStage 文字记录生命周期', () => {
  it('文字记录连续打开、滚动、关闭后不引用已销毁的旧容器', () => {
    const stage = new PixiStage();
    const entries = [{ speaker: '凛', text: '第一条记录' }];

    expect(() => {
      stage.showBacklog(entries);
      stage.scrollBacklog(120);
      stage.hideBacklog();
      stage.showBacklog([...entries, { speaker: null, text: '第二条记录' }]);
      stage.scrollBacklog(120);
      stage.showBacklog(entries, undefined, '第一');
    }).not.toThrow();
  });
});

describe('PixiStage 结局黑场', () => {
  it('可独立展示和隐藏，不依赖标题或对话状态', () => {
    const stage = new PixiStage();
    expect(() => {
      stage.showEnding();
      stage.hideEnding();
      stage.hideEnding();
    }).not.toThrow();
  });
});

describe('PixiStage 加载层生命周期', () => {
  it('可重复更新、隐藏和销毁而不抛错', () => {
    const stage = new PixiStage();
    expect(() => {
      stage.showLoading({ total: 10, completed: 4, failed: 1, current: 'bg/title.png', done: false });
      stage.showLoading({ total: 10, completed: 9, failed: 1, current: null, done: true });
      stage.hideLoading();
      stage.hideLoading();
      stage.destroy();
      stage.destroy();
    }).not.toThrow();
  });
});

describe('PixiStage 时间轴镜头与屏幕补间', () => {
  it('静态画面不请求帧，等待指示器和演出效果激活时请求帧', () => {
    const stage = new PixiStage();
    let requests = 0;
    stage.setFrameRequest(() => { requests++; });
    expect(stage.needsUpdate()).toBe(false);

    stage.setAwaiting(true);
    expect(stage.needsUpdate()).toBe(true);
    expect(requests).toBe(1);
    stage.setAwaiting(false);
    expect(stage.needsUpdate()).toBe(false);
    expect(requests).toBe(2);

    stage.flash(300);
    expect(stage.needsUpdate()).toBe(true);
    expect(requests).toBe(3);
    stage.updateEffects(300);
    expect(stage.needsUpdate()).toBe(false);
  });

  it('镜头 pan 会从当前偏移补间到目标，并可序列化恢复', () => {
    const stage = new PixiStage();
    const cue = { atMs: 0, durationMs: 100, easing: 'linear' as const, action: 'pan', x: 180, y: -40 };
    stage.applyTimelineFrame({ track: 'camera', cue, started: true, final: false, progress: 0.5, elapsedMs: 50 });
    expect((stage.snapshotPresentation() as { cameraPan: { x: number; y: number } }).cameraPan).toEqual({ x: 90, y: -20 });
    stage.applyTimelineFrame({ track: 'camera', cue, started: false, final: false, progress: 1, elapsedMs: 100 });
    expect((stage.snapshotPresentation() as { cameraPan: { x: number; y: number } }).cameraPan).toEqual({ x: 180, y: -40 });
    const restored = new PixiStage();
    restored.restorePresentation(stage.snapshotPresentation());
    expect((restored.snapshotPresentation() as { cameraPan: { x: number; y: number } }).cameraPan).toEqual({ x: 180, y: -40 });
  });

  it('时间轴 tint 同时补间颜色和透明度，而不是瞬间跳到目标颜色', () => {
    const stage = new PixiStage();
    const cue = { atMs: 0, durationMs: 100, easing: 'linear' as const, action: 'tint', color: 0xff0000, alpha: 0.4 };
    stage.applyTimelineFrame({ track: 'screen', cue, started: true, final: false, progress: 0.5, elapsedMs: 50 });
    expect((stage.snapshotPresentation() as { tint: { color: number; alpha: number } }).tint).toEqual({ color: 0xff0000, alpha: 0.2 });
    stage.applyTimelineFrame({ track: 'screen', cue, started: false, final: false, progress: 1, elapsedMs: 100 });
    expect((stage.snapshotPresentation() as { tint: { color: number; alpha: number } }).tint).toEqual({ color: 0xff0000, alpha: 0.4 });
    const nextCue = { atMs: 100, durationMs: 100, easing: 'linear' as const, action: 'tint', color: 0x0000ff, alpha: 0.8 };
    stage.applyTimelineFrame({ track: 'screen', cue: nextCue, started: true, final: false, progress: 0.5, elapsedMs: 150 });
    const tint = (stage.snapshotPresentation() as { tint: { color: number; alpha: number } }).tint;
    expect(tint.color).toBe(0x800080);
    expect(tint.alpha).toBeCloseTo(0.6, 10);
  });
});

describe('PixiStage 字体角色', () => {
  function mockFontApi(): void {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    class FakeFontFace {
      constructor(readonly family: string, readonly source: string) {}
      async load(): Promise<this> { return this; }
    }
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add: vi.fn() } });
  }

  it('按角色注册字体，正文默认字体不覆盖标题和 UI 角色', async () => {
    mockFontApi();
    const stage = new PixiStage();
    await expect(stage.registerFontRole('body', 'blob:body', 'BodyFace')).resolves.toBe(true);
    await expect(stage.registerFontRole('title', 'blob:title', 'TitleFace')).resolves.toBe(true);
    await expect(stage.registerFontRole('ui', 'blob:ui', 'UiFace')).resolves.toBe(true);
    expect(stage.getFontFamily('body')).toBe('BodyFace');
    expect(stage.getFontFamily('title')).toBe('TitleFace');
    expect(stage.getFontFamily('ui')).toBe('UiFace');
    expect(TextStyle.defaultTextStyle.fontFamily).toBe('BodyFace');
  });

  it('旧版单字体接口仍同步覆盖三个角色，重置后回到角色回退栈', async () => {
    mockFontApi();
    const stage = new PixiStage();
    await expect(stage.registerFont('blob:legacy', 'LegacyFace')).resolves.toBe(true);
    expect(stage.getFontFamily('body')).toBe('LegacyFace');
    expect(stage.getFontFamily('title')).toBe('LegacyFace');
    expect(stage.getFontFamily('ui')).toBe('LegacyFace');
    stage.resetFonts();
    expect(stage.getFontFamily('body')).toContain('Noto Sans CJK SC');
    expect(stage.getFontFamily('title')).toContain('Noto Serif CJK SC');
    expect(stage.getFontFamily('ui')).toContain('Noto Sans CJK SC');
  });

  it('字体 API 不可用时独立回退，不抛出异常', async () => {
    const stage = new PixiStage();
    await expect(stage.registerFontRole('title', 'blob:missing')).resolves.toBe(false);
    expect(stage.getFontFamily('title')).toContain('Noto Serif CJK SC');
  });
});
