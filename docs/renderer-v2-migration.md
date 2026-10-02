# Renderer v2 迁移指南

本文面向游戏宿主、编辑器预览和 CLI 脚手架维护者。Renderer v2 从 M8 起是新消费者的唯一公开接线方式：宿主创建一个 `RendererRuntime`，通过 `commands` 改变渲染状态，通过 `queries` 读取渲染状态，通过 `controller` 连接内核事件与处理玩家输入。

## 1. 兼容政策与迁移目标

Renderer v2 不改变 DSL、存档格式、游戏规则或玩家可见语义。`PixiStage`、`AdvRenderer` 和旧的 `AdvStage` 类型仍保留在当前 major 版本内，供一版兼容窗口和旧消费者使用；它们现在由兼容适配层委托到 Renderer v2 的生产实现，不再是新代码应直接构造的入口。

兼容窗口只覆盖当前 Wave 2 所需的一版迁移期。下一 major 版本移除旧导出前，必须同时满足以下条件：

1. 仓库内生产路径的 legacy usage 扫描保持 0；
2. 正式游戏、starter、编辑器预览和 CLI 模板都只创建 `RendererRuntime`；
3. 独立复审确认兼容测试、存档/演出恢复、资源循环和 Electron E2E 不再需要旧构造方式；
4. 发布说明明确列出移除版本，并为外部消费者提供至少一个完整迁移周期。

没有满足这些条件时，不要删除旧导出，也不要在生产环境增加逐调用 deprecation 日志。当前的兼容性是结构性兼容，不是运行时噪声兼容。

## 2. 安装与初始化

游戏包至少需要 `@surdet/core`、`@surdet/renderer` 和 `@surdet/host`。渲染器只创建一次；场景热更新应替换 `SceneRegistry` 中的编译结果，不得在每次 `.gal` 更新时重新创建舞台、音频或 runtime。

```ts
import { EventBus, Interpreter } from '@surdet/core';
import type { CoreEventMap } from '@surdet/core';
import { AudioManager, createRendererRuntime } from '@surdet/renderer';
import { connectInterpreterPresentation } from '@surdet/host';

export async function startRenderer(
  hostElement: HTMLElement,
  interpreter: Interpreter,
  bus: EventBus<CoreEventMap>,
): Promise<() => void> {
  const audio = new AudioManager();
  const runtime = await createRendererRuntime({
    audio,
    onAdvance: () => interpreter.advance(),
    onSelect: (index) => interpreter.choose(index),
  });

  hostElement.appendChild(runtime.canvas);
  runtime.resize();
  const resizeHandler = (): void => runtime.resize();
  window.addEventListener('resize', resizeHandler);
  const unsubscribe = runtime.controller.connect(bus);

  const presentationConnection = connectInterpreterPresentation({ interpreter, renderer: runtime });

  return () => {
    window.removeEventListener('resize', resizeHandler);
    presentationConnection.disconnect();
    unsubscribe();
    runtime.dispose();
    audio.dispose();
  };
}
```

初始化失败时，`createRendererRuntime` 会执行已构造部分的清理，并以 `RendererError` 报告初始化上下文。宿主应把 `onError` 接到自己的错误上报路径，不要吞掉异常后继续使用半初始化 runtime。

## 3. 旧入口与新入口

### 3.1 旧 PixiStage + AdvRenderer 入口

下面是兼容窗口中仍可工作的旧模式。它只用于尚未迁移的旧游戏或兼容测试。

```ts
import { AdvRenderer, AudioManager, PixiStage } from '@surdet/renderer';
import type { EventBus, CoreEventMap, Interpreter } from '@surdet/core';
import type { AudioHandle } from '@surdet/renderer';

export async function startLegacyRenderer(
  hostElement: HTMLElement,
  interpreter: Interpreter,
  bus: EventBus<CoreEventMap>,
  audio: AudioHandle,
): Promise<{ stage: PixiStage; renderer: AdvRenderer }> {
  const stage = new PixiStage();
  await stage.init();
  hostElement.appendChild(stage.app!.canvas);
  stage.fitWindow();
  const renderer = new AdvRenderer(stage, audio, {
    onAdvance: () => interpreter.advance(),
    onSelect: (index) => interpreter.choose(index),
  });
  renderer.subscribe(bus);
  return { stage, renderer };
}
```

### 3.2 Renderer v2 入口

新代码不直接 import `PixiStage`、`AdvRenderer` 或 `FrameScheduler`。帧调度、Stage host、Layer 生命周期、资源注册表和兼容适配都由 runtime composition root 管理。

```ts
import { EventBus, Interpreter } from '@surdet/core';
import type { CoreEventMap } from '@surdet/core';
import { AudioManager, createRendererRuntime } from '@surdet/renderer';
import { connectInterpreterPresentation } from '@surdet/host';

export async function startV2Renderer(
  hostElement: HTMLElement,
  interpreter: Interpreter,
  bus: EventBus<CoreEventMap>,
): Promise<() => void> {
  const audio = new AudioManager();
  const runtime = await createRendererRuntime({
    audio,
    onAdvance: () => interpreter.advance(),
    onSelect: (index) => interpreter.choose(index),
  });
  hostElement.appendChild(runtime.canvas);
  runtime.resize();
  const unsubscribe = runtime.controller.connect(bus);
  const presentationConnection = connectInterpreterPresentation({ interpreter, renderer: runtime });
  return () => {
    presentationConnection.disconnect();
    unsubscribe();
    runtime.dispose();
    audio.dispose();
  };
}
```

## 4. 完整方法迁移表

| 旧调用或旧对象 | Renderer v2 对应项 | 说明 |
| --- | --- | --- |
| `new PixiStage()` + `stage.init()` | `await createRendererRuntime(options)` | runtime 是唯一 composition root。 |
| `stage.app!.canvas` | `runtime.canvas` | 只把 canvas 挂到宿主 DOM。 |
| `stage.fitWindow()` | `runtime.resize()` | resize 只改变布局，不创建新 runtime。 |
| `new FrameScheduler(options)` | 不再由消费者创建 | scheduler 属于 runtime 内部。 |
| `stage.registerBackground` | `runtime.commands.assets.registerBackground` | 资源所有权归 AssetRegistry。 |
| `stage.registerPortrait` | `runtime.commands.assets.registerPortrait` | 传入 URL/path，不暴露 Pixi 对象。 |
| `stage.registerAvatar` | `runtime.commands.assets.registerAvatar` | 头像注册同样属于 assets domain。 |
| `stage.registerFontRole` | `runtime.commands.assets.registerFontRole` | 字体完成后再启动剧情首帧。 |
| `stage.resetFonts` | `runtime.commands.assets.resetFonts` | 不直接访问 Stage。 |
| `stage.releaseRegisteredAssetSources` | `runtime.commands.assets.releaseRegisteredAssetSources` | 释放登记的 URL/资源来源。 |
| `stage.setBackground` | `runtime.commands.world.setBackground` | World domain command。 |
| `stage.setPortrait` | `runtime.commands.world.setPortrait` | World domain command。 |
| `stage.removePortrait` | `runtime.commands.world.removePortrait` | World domain command。 |
| `stage.setFade` / `setTint` / `clearTint` | `runtime.commands.world.setFade` / `setTint` / `clearTint` | 视觉效果仍由 World 层投影。 |
| `stage.shake` / `zoom` / `wipe` / `flash` | `runtime.commands.world.*` | 不复制第二套特效逻辑。 |
| `stage.movePortrait` / `setPortraitFocus` | `runtime.commands.world.*` | 说话人焦点跨层协调只由 Facade/Controller 完成。 |
| `stage.showText` | `runtime.commands.dialogue.showText` | Dialogue 本地状态和文本投影。 |
| `stage.showChoices` / `hideChoices` | `runtime.commands.dialogue.*` | 选择肢仍由 Interpreter 的回调推进。 |
| `stage.showBacklog` / `scrollBacklog` | `runtime.commands.dialogue.*` | 查询记录使用 `runtime.queries.dialogue`。 |
| `stage.showCommandRail` | `runtime.commands.dialogue.showCommandRail` | rail 属于 Dialogue 投影。 |
| `stage.showTitle` / `showEnding` | `runtime.commands.menu.*` | Menu overlay command。 |
| `stage.showSystemMenu` / `showSettings` / `showSaveLoad` | `runtime.commands.menu.*` | Menu 关闭回调先收敛本地状态。 |
| `stage.showGallery` / `hideGallery` | `runtime.commands.gallery.*` | Gallery overlay command。 |
| `stage.showBattle` / `showMap` / `showShop` | `runtime.commands.system.*` | SystemPanel domain command。 |
| `stage.showBaseCommands` / `showVideo` | `runtime.commands.system.*` | 不直接触碰 SystemPanelLayer。 |
| `stage.showLoading` / `hideLoading` | `runtime.commands.loading.*` | 启动与场景资源进度投影。 |
| `stage.captureThumbnail()` | `runtime.queries.world.captureThumbnail()` | 只读缩略图查询。 |
| `renderer.status` / `autoPlay` / `skipMode` | `runtime.controller.status` / `autoPlay` / `skipMode` | 控制器是输入与内核事件连接点。 |
| `renderer.advance()` / `choose()` | `runtime.controller.advance()` / `select()` | 宿主回调可继续使用语义方法。 |
| 键盘/手柄直接调用 toggle | `runtime.controller.dispatchInput(action)` | 统一使用 `RendererInputAction`。 |
| `renderer.snapshotPresentation()` | `runtime.queries.presentation.snapshot()` | Query 只读，不清理或请求帧。 |
| `renderer.restorePresentation(snapshot)` | `runtime.commands.presentation.restore(snapshot)` | restore 前统一校验完整快照。 |
| `renderer.clearPresentation()` | `runtime.commands.presentation.clear()` | 同时清理 Controller 时间轴和 Stage 表现状态。 |
| `renderer.resetSession()` | `runtime.resetSession(options)` | 仅用于会话级复位，不用它替代 presentation clear。 |
| `renderer.subscribe(bus)` | `runtime.controller.connect(bus)` | 保存返回的 unsubscribe。 |
| `stage.destroy()` + controller/scheduler dispose | `runtime.dispose()` | 一次幂等清理，错误以 RendererError/AggregateError 报告。 |

## 5. Commands 与 Queries 规则

`commands` 可以改变可见状态、资源注册、覆盖层、音频或时间轴；`queries` 必须只读。不要把 Query 当作“方便的命令”，也不要在 Query 中创建 Pixi 对象、注册资源、请求帧、播放音频、推进解释器或修改 overlay。

```ts
const resourceSnapshot = runtime.queries.diagnostics.resourceSnapshot();
const presentationSnapshot = runtime.queries.presentation.snapshot();
const menuState = runtime.queries.overlay.menu();
runtime.commands.dialogue.setActiveSpeaker('lynn');
runtime.commands.world.setTint(0x334455, 0.35, 400);
```

正式消费者应只持有 `runtime`、`commands`、`queries` 和 `controller`。如果一个模块需要读取 Pixi Sprite、Container 或 Stage 私有字段，说明接线仍停留在 legacy 边界内。

## 6. 输入动作迁移

使用 `RendererInputAction` 让键盘、手柄、编辑器预览和自动化测试共享同一语义入口：

```ts
runtime.controller.dispatchInput({ type: 'advance' });
runtime.controller.dispatchInput({ type: 'choice.move', delta: 1 });
runtime.controller.dispatchInput({ type: 'choice.select', index: 0 });
runtime.controller.dispatchInput({ type: 'backlog.toggle' });
runtime.controller.dispatchInput({ type: 'backlog.scroll', delta: 240 });
runtime.controller.dispatchInput({ type: 'auto.toggle' });
runtime.controller.dispatchInput({ type: 'skip.toggle', scope: 'read' });
runtime.controller.dispatchInput({ type: 'interface.toggle' });
runtime.controller.dispatchInput({ type: 'escape' });
```

游戏侧已有键位映射时，先调用 `actionForKeyboardEvent`，再用 `rendererInputForGameAction` 转换为 renderer action。系统菜单、快速存档、快速读档和宿主业务回调仍由游戏宿主持有，不要把游戏规则塞进 renderer。

## 7. 资源所有权与 disposal

所有通过 `commands.assets.register*` 登记的 URL、Blob source、字体和异步加载任务都属于当前 runtime。场景重载时调用 `runtime.resetSession({ clearAssets: true })` 或针对性释放登记来源；游戏退出时调用 `runtime.dispose()`。宿主自己创建的 `AudioManager`、Blob URL 和存档桥仍由宿主释放。

以下顺序适合浏览器和 Electron：

1. 停止宿主输入和 system adapter；
2. 断开 `connectInterpreterPresentation` 返回的连接和 `runtime.controller.connect` 返回的 unsubscribe；
3. 调用 `runtime.dispose()`；
4. 释放宿主自己持有的音频与 Blob URL；
5. 清理临时 userData 或测试目录。

重复调用 `disconnect`、unsubscribe 或 `dispose` 必须安全；不要绕过 runtime 直接销毁 Layer。初始化失败也会尝试清理已经创建的 scheduler、controller、stage、registry 和 lifecycle。

## 8. Presentation 快照迁移

完整 Presentation 快照包括 version、Stage/World 状态和时间轴定义/运行快照。保存时使用 Query，恢复时使用 Command；验证与 restore 使用 Controller 的同一套准备逻辑：

```ts
const snapshot = runtime.queries.presentation.snapshot();
runtime.commands.presentation.validate(snapshot);
runtime.commands.presentation.restore(snapshot);
runtime.commands.presentation.clear();
```

`validate` 是只读的，失败统一抛出 `RendererError`，错误码为 `PRESENTATION_SNAPSHOT_INVALID`。不要只检查 `snapshot.stage`，也不要用 `resetSession` 代替 `clear`；后者会额外重置对话、选择、自动、快进和 Backlog 状态。

解释器的 save hooks 应把该快照放入存档；回退缓冲应保存并恢复同一份完整快照。restore 必须是原子操作，失败时不应留下半恢复的 World 或旧时间轴在下一帧复活。

正常 Runtime 的 `commands.world.fade(from, to, durationMs)` 与 `setTint` / `clearTint` 使用 World 内同一套可保存的属性归属与进度；场景指令和时间轴互相接管时也按这份状态恢复。`setFade(alpha)` 仍是瞬时赋值，`clearTint` 只接管透明度。Controller 通过 `queries.world.isFadeActive()` 保持场景淡化期间的回退检查点限制。只实现 `setFade` 的旧宿主仍可沿用 Controller 的旧淡化路径，但不能据此声称具备正常 Runtime 的中途恢复保证。

## 9. 编辑器预览与 CLI 模板迁移

编辑器预览和 `surdet new` 生成的模板都遵循同一模式：一个 Runtime、一个内部帧调度器、语义 Commands/Queries、统一 normalized input、退出时一次 dispose。预览 reload 只重建 Interpreter、SceneRegistry 和宿主配置，不重新创建 canvas、ticker 或 RendererRuntime。

CLI 模板中的场景热更新仍通过独立的 `scene-hmr-boundary.ts` 处理。它替换注册表中的 `CompiledScene`，不重新初始化 RendererRuntime，也不改变正式包的行为。

## 10. 常见错误与 RendererErrorCode

| 错误码 | 含义 | 首要检查项 |
| --- | --- | --- |
| `RENDERER_NOT_INITIALIZED` | 入口或所需端口未初始化 | 是否在 `createRendererRuntime` 完成前调用命令。 |
| `RENDERER_DISPOSED` | runtime 已清理 | 是否重复使用旧 runtime；应创建新的会话。 |
| `INVALID_COMMAND_PAYLOAD` | command 参数不符合公开契约 | 检查颜色、转场、视图和输入 action 的类型。 |
| `ASSET_NOT_REGISTERED` | 素材键未登记或来源无效 | 等待资产完成，并通过 `commands.assets` 注册。 |
| `LAYER_INITIALIZATION_FAILED` | Layer/runtime 初始化失败 | 查看 `cause` 和初始化清理报告。 |
| `COMMAND_COMMIT_FAILED` | 命令提交或清理时发生聚合失败 | 保留 `AggregateError`，逐个检查 disposer。 |
| `PRESENTATION_SNAPSHOT_INVALID` | 完整表现快照校验失败 | 检查 version、World、timeline definition、timeline snapshot 和 ID 唯一性。 |
| `LEGACY_CONTRACT_VIOLATION` | 兼容端口没有提供所需旧能力 | 迁移到 v2 domain，或明确补齐兼容端口。 |

不要捕获后静默吞掉 `RendererError`。可以在宿主边界添加上下文并重新上报，但必须保留 `code`、`domain`、`command` 和原始 `cause`。

## 11. 审计命令与交付门禁

检查生产路径是否仍导入旧 API：

```powershell
npm run verify:renderer-legacy
```

检查 Layer 跨层依赖与公开边界：

```powershell
npm run verify:renderer-boundaries
```

完整仓库门禁：

```powershell
npm run verify:all
```

发现旧符号时，先看扫描输出中的完整路径。兼容适配器和 `packages/renderer/test/legacy/` 可以保留；游戏、starter、formal、editor 和 CLI 模板的生产接线不应重新引入 `PixiStage`、`AdvRenderer` 或 `AdvStage`。
