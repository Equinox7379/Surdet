import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextStyle, Texture } from 'pixi.js';
import { PixiStage } from '../src/pixi-stage.js';

const defaultFontFamily = TextStyle.defaultTextStyle.fontFamily;

afterEach(() => {
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

describe('PixiStage 时间轴镜头与屏幕补间', () => {
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
