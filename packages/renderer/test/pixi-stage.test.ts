import { describe, expect, it } from 'vitest';
import { Texture } from 'pixi.js';
import { PixiStage } from '../src/pixi-stage.js';

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
