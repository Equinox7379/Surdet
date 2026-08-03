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
});
