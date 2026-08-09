# Surdet Renderer v2 M3 交付报告

日期：2026-08-09

项目：`E:/surdet`

里程碑：M3 — DialogueLayer 迁移

当前状态：`WAITING_FOR_REVIEW`

## 1. 结论

M3 已按批准的 Renderer v2 Layer Migration M3–M7 任务书完成，施工范围止于 `Task 13: Extract DialogueLayer implementation`；独立复审提出的 active-speaker 跨层重复调用阻断项也已完成限定整改。对白、Ruby、选择肢、等待指示器、NVL、Backlog、Backlog 搜索视图、Banner、Command Rail、界面隐藏和说话人资料投影已经从 `PixiStage` 的实现主体中抽出，接入共享的 `RenderLifecycle`、`RenderAssetRegistry`、`PresentationPreferences` 和 Renderer Facade 兼容边界。

M3 没有改变正式游戏的 DSL、存档格式、游戏规则、编辑器行为或消费者接线；没有开始 M4，也没有进行任何消费者 cutover、M8 收口或远端推送。`USER.md` 与 `SESSION-HANDOFF.md` 保持为工作树中未跟踪文件，未纳入提交。

独立复审入口：本报告提交后停止，等待批准进入 M4。

## 2. 严格范围记录

### 2.1 本轮实际完成

- Task 11：Renderer Layer import boundary gate 已接入仓库门禁，并由 `verify:all` 唯一执行。
- Task 12：Dialogue legacy/v2 projection contract 已冻结并保留兼容测试。
- Task 13：完成 `DialogueLayer` 实现、Stage 委托、Facade/Runtime 接线、资源登记和两批 50 次循环验证。
- 任务书要求的 Renderer 聚焦测试、Renderer 全量测试、typecheck、build、边界门禁和根级全量门禁均已通过。

### 2.2 明确未开始

以下内容本轮没有施工：

- M4 `MenuLayer`；
- M5 `GalleryLayer`；
- M6 `SystemPanelLayer`；
- M7 `WorldLayer`；
- M8 消费者迁移、Facade 收口、legacy 扫描归零和发行验收；
- 正式游戏、starter、编辑器或 CLI 的 v2 consumer cutover；
- DSL、存档格式、游戏规则和编辑器行为修改；
- 与对白迁移无直接关系的重构、玩家功能和无关缺陷修复；
- 远端 push、force push、工作树清理。

## 3. 实现交付

### 3.1 DialogueLayer

新增文件：

- `packages/renderer/src/layers/dialogue/dialogue-layer.ts`

`DialogueLayer` 现在直接拥有任务书列出的对白状态族：

- speaker/dialog 文本、speaker plate、文本缓存和排版参数；
- Ruby layer、base/text pool 以及 Ruby 排版；
- choice layer、choice view、highlight、fade 状态；
- continue indicator 与 pulse 状态；
- Backlog layer、条目视图、滚动位置和局部关闭监听器；
- NVL layer、条目和折行计数；
- chapter/tip Banner 及其时间状态；
- Command Rail、项目、回调、抑制和唤醒状态；
- speaker profiles、active speaker、avatar 和 interface hidden 状态；
- `onSelect` 与 `onBacklogClose` 兼容回调端口。

Layer 通过 `RenderAssetRegistry.resolveAvatar()` 和 `fontFamily()` 获取头像、字体，不维护本地资源映射。所有顶层显示对象使用生命周期 owner `dialogue` 登记；选择肢、Ruby pool、Backlog 监听器、Banner/Command Rail/choice fade 等局部资源在创建、结束、reset 和 dispose 路径中分别释放。`dispose()` 会先解除 Layer 根节点，再调用 `releaseOwner('dialogue')`，避免资源登记与实际显示树分离。

### 3.2 PixiStage 兼容委托

修改文件：

- `packages/renderer/src/pixi-stage.ts`

`PixiStage` 保留原有构造方式和公开旧 API，但对白方法全部转为对 `DialogueLayer` 的兼容委托。`onSelect`、`onBacklogClose` getter/setter 也由 Layer 承接。原对白私有字段族及其渲染主体已从 PixiStage 删除；背景、立绘、世界效果、菜单、鉴赏、战斗、地图、商店、据点和视频仍保留在原有范围内，没有提前迁移。

文本节点在初始化完成后重新置于原有 UI z-order 位置，确保从旧 Stage 实现迁移到 Layer 后 ADV 文本、Ruby、选择肢和覆盖层的可见顺序保持不变。

### 3.3 Facade、Runtime 与公开契约

修改文件：

- `packages/renderer/src/runtime/renderer-facade.ts`
- `packages/renderer/src/runtime/create-renderer-runtime.ts`
- `packages/renderer/src/adv-renderer.ts`
- `packages/renderer/src/api/renderer-commands.ts`
- `packages/renderer/src/types.ts`
- `packages/renderer/src/index.ts`

Facade 的 `commands.dialogue` 优先委托公开的 `DialogueProjectionPort`，在仅提供旧 Stage 的兼容场景中回退到 Stage 方法。Controller 仍只依赖 `RendererCommands`/`RendererQueries`，没有导入 `DialogueLayer` 或直接调用 Stage。

`DialogueProjectionPort` 是 M3 对外公开的 typed port，除全部 `DialogueCommands` 外只提供两个无副作用只读值：`activeSpeakerId` 与 `projectionVersion`。Facade 使用它在对白投影完成后读取 profile 推导结果，再明确调用 World `setPortraitFocus()`。新增的 `WorldCommands.setPortraitFocus()` 只表达端口契约，不被注入或调用于 DialogueLayer。

Runtime composition root 将同一个 `RenderLifecycle` 注入 Stage 与 DialogueLayer，并将实际 Layer 传递给 Facade；旧 `PixiStage`/`AdvRenderer` 构造和兼容消费者仍可继续工作。

## 4. 独立复审整改

### 4.1 阻断问题与修复前失败证据

独立复审指出：原实现同时存在 `DialogueLayerOptions.onActiveSpeakerChanged` 隐式 World 回调和 `RendererFacade.commands.dialogue.setActiveSpeaker()` 的显式 World 调用。正式 Runtime 注入实际 DialogueLayer、Stage 使用可计数 World spy 后，调用链为：

```text
Facade → DialogueLayer.setActiveSpeaker()
       → DialogueLayer.onActiveSpeakerChanged → World.setPortraitFocus()
       → Facade 显式 World.setPortraitFocus()
```

在修改生产代码前，先加入回归测试并运行：

```powershell
npm test -w @surdet/renderer -- dialogue-layer.test.ts legacy-dialogue-contract.test.ts
```

失败结果为 12 项中 11 项通过、1 项失败；`facade.commands.dialogue.setActiveSpeaker('lynn')` 的 World spy 期望调用 1 次，实际调用 2 次：

```text
expected "setPortraitFocus" to be called 1 times, but got 2 times
```

该失败先于生产整改被复现，确认问题不是最终状态值错误，而是跨层协调副作用发生了两次。

### 4.2 整改内容

- 删除 `DialogueLayerOptions.onActiveSpeakerChanged` 以及 DialogueLayer 内相应的隐式 World 回调路径。
- `DialogueLayer` 只维护对白本地状态、头像、标签和文本投影；代码中不再直接或间接调用 `setPortraitFocus`。
- 新增公开 `DialogueProjectionPort` typed port。Facade 不再依赖具体 `DialogueLayer` 类，而依赖该公开端口。
- `activeSpeakerId` 是只读 getter；`projectionVersion` 只在接受非幂等 `showText` 投影时递增。读取这两个值不会创建 Pixi 对象、注册资源、请求帧或修改可见状态。
- v2 Facade 路径中：
  - `setActiveSpeaker()` 对 Dialogue 端口调用一次，然后对 World 端口调用一次；
  - `showText()` 先投影对白，只有 `projectionVersion` 发生变化时读取 `activeSpeakerId` 并对 World 调用一次；
  - 完全相同的重复文本不会再次进行跨层协调。
- 旧 `PixiStage`/`AdvRenderer` 兼容路径委托同一 Dialogue projection 意图，并在兼容适配层将本次有效投影同步到 World；这不是第二份说话人推导或焦点业务逻辑，DialogueLayer 内不存在 World 回调。
- Controller 没有导入 DialogueLayer，也没有操作 Pixi 对象。

原报告中“World 实现不暴露给 DialogueLayer”的表述不够准确：当时虽然没有直接导入 World 类，但 `onActiveSpeakerChanged` 实际已经把一个 World 专用隐式回调注入了 DialogueLayer。整改后的准确表述是：DialogueLayer 不接收任何 World 回调；只有 Facade/兼容适配层读取公开只读对白端口，并显式调用 World 端口。

### 4.3 修复后调用次数

新增回归测试使用实际 `DialogueLayer` 实例、Facade 注入、可计数 Stage/World spy，并验证以下结果：

| 场景 | Dialogue 状态调用 | World `setPortraitFocus` | 结果 |
| --- | ---: | ---: | --- |
| `facade.commands.dialogue.setActiveSpeaker('lynn')` | 1 | 1，参数 `lynn` | 通过 |
| profile `凛 → lynn` 的 `showText` | 1 | 1，参数 `lynn` | 通过 |
| 旁白 `showText(null, ...)` | 1 | 1，参数 `null` | 通过 |
| 未知说话人映射到 `null` | 1 | 1，参数 `null` | 通过 |
| 完全相同的重复文本 | 0 | 0 | 既有幂等规则保持 |
| legacy `PixiStage.setActiveSpeaker` | 1 | 1 | 通过 |
| legacy `PixiStage.showText` 重复规则 | 有效投影 1；重复投影 0 | 有效投影 1；重复投影 0 | 通过 |
| legacy `AdvRenderer` 文本事件 | 1 | 1 | 通过 |

### 4.4 typed port 范围说明

本次已完成 M3 要求的 Facade 依赖收紧：`RendererFacade`、Runtime internals 和 `PixiStage.dialogueLayer` getter 均使用 `DialogueProjectionPort`，不再把具体 `DialogueLayer` 类型作为 Facade 依赖。该端口只公开 M3 所需的 Dialogue commands 与两个纯查询值；它不是 M4–M8 的预先 cutover，也没有扩大消费者范围。

### 4.5 第二次独立复审整改

第二次独立复审确认正式 v2 typed port 主路径正确，但发现 legacy fallback 仍有一次重复的 World focus：`RendererFacade` 在未注入 Dialogue port 时先调用旧 `stage.setActiveSpeaker()`，随后又调用 `#coordinateWorldFocus()`；真实 `PixiStage.setActiveSpeaker()` 本身已经维护对白状态与立绘焦点的组合语义，因此会把 `setPortraitFocus()` 执行两次。

按照复审要求，先新增了真实回归测试，再修改生产代码。测试位于 `packages/renderer/test/legacy/legacy-dialogue-contract.test.ts`，实际构造 `PixiStage`、`PresentationController` 和 `RendererFacade`，不提供 `dialogueLayer/dialoguePort`，并对真实 Stage 的 `setActiveSpeaker()` 与 `setPortraitFocus()` 设置 spy。修复前单独运行该文件时为 3 项测试：2 项通过、1 项失败；`facade.commands.dialogue.setActiveSpeaker('lynn')` 的 World focus 期望 1 次，实际为 2 次：

```text
expected "setPortraitFocus" to be called 1 times, but got 2 times
```

生产修复保持最小范围：无 Dialogue port 的 fallback 现在只调用旧 `stage.setActiveSpeaker()` 一次并立即返回，删除额外的 `#coordinateWorldFocus()`；注入 Dialogue port 的正式 v2 分支完全不变，仍由 Facade 分别调用 Dialogue 与 World 各一次。没有重新引入 DialogueLayer 的 World 回调，也没有修改 DSL、存档、游戏规则或其他 Layer。为保持既有测试夹具与真实 legacy 合同一致，`DialogueStageHarness` 的旧 Stage 模拟也补齐了同一组合语义。

修复后调用次数如下：

| 场景 | Stage `setActiveSpeaker` | World `setPortraitFocus` | 结果 |
| --- | ---: | ---: | --- |
| RendererFacade fallback，`'lynn'` | 1 | 1，参数 `lynn` | 通过 |
| RendererFacade fallback，`null` | 1 | 1，参数 `null` | 通过 |
| 注入 DialogueProjectionPort 的正式 v2 路径 | Dialogue 1 | World 1 | 通过 |
| 完全相同的重复 `showText` | 保持幂等 | 0 | 既有规则保持 |
| 直接 legacy `PixiStage` / `AdvRenderer` 路径 | 原行为保持 | 原行为保持 | 通过 |

本次源码/测试整改提交完整 SHA：

```text
101d4b3802bdd05b1656216454f0bea38f8f876e
fix(renderer): avoid duplicate legacy speaker focus
```

本次整改后仍保持 `WAITING_FOR_REVIEW`：M4 未开始、未进行消费者 cutover、未 push 远端；`USER.md` 与 `SESSION-HANDOFF.md` 仍未跟踪且未暂存。

## 5. 合同测试与行为覆盖

### 5.1 DialogueLayer 直接测试

`packages/renderer/test/layers/dialogue-layer.test.ts` 当前包含 10 项测试，覆盖：

- 文本、旁白、重复文本和 Ruby；
- 选择肢、highlight、隐藏和选择回调；
- awaiting 与 continue pulse；
- Backlog 条目、搜索、滚动、语音重播、关闭回调及安全查询；
- NVL、chapter/tip Banner 和 Command Rail；
- hideInterface 不影响 World projection、speaker profile 和 speaker focus；
- resetSession 仍由 Controller/Runtime 明确负责，重复销毁保持幂等；
- Layer 自身资源在两批各 50 次循环中稳定。

### 5.2 Legacy 兼容测试

`packages/renderer/test/legacy/legacy-dialogue-contract.test.ts` 当前包含 3 项兼容测试，验证：

- 原 `PixiStage` 的完整对白公开面仍可调用、重复执行并在 reset 后保留 World projection；
- 无 Dialogue port 的真实 `RendererFacade` fallback 不重复执行 World focus，并正确处理 `'lynn'` 与 `null`；
- `AdvRenderer` 的 callback binding、Backlog 关闭回调和旧生命周期行为继续成立。

### 5.3 确定性视觉状态审计

本轮没有批量更新截图基线，也没有接受未解释的视觉差异。通过现有 Pixi projection/legacy contract 测试，对以下状态进行了确定性检查：

- ADV 文本、旁白和 Ruby；
- 选择肢进入、highlight、淡入、隐藏和回调；
- NVL 文本页；
- Backlog、搜索结果、滚动和语音回放；
- chapter/tip Banner；
- Command Rail、唤醒/隐藏和项目回调；
- interface hidden；
- speaker profile、avatar lookup 和 World portrait focus；
- reset、重复销毁以及旧 Stage 兼容路径。

未发现需要命名并申请批准的视觉差异 artifact。

## 6. 资源循环结果

对白 Layer 测试使用同一个 `RenderLifecycle` 与 `RenderAssetRegistry`，连续执行两批独立的 50 次循环。每次循环都：

1. 创建新的 Pixi `Container` 与 `DialogueLayer`；
2. 投影文本、Ruby、选择肢、Backlog、NVL、Banner、Command Rail 和隐藏界面；
3. 执行 `reset()`；
4. 执行 `dispose()`；
5. 验证根 Container 没有残留子节点。

两批稳定点完全相等，快照为：

```json
{
  "disposed": false,
  "listeners": 0,
  "activeTweens": 0,
  "activeAsyncTasks": 1,
  "pooledObjects": {},
  "displayObjectsByOwner": {
    "dialogue": 0
  }
}
```

这里的 `activeAsyncTasks: 1` 是共享 `RenderAssetRegistry` 注册的 runtime 级 asset-generation 条目，不是 DialogueLayer 泄漏；两批结果相同且 dialogue owner 的 display/listener/tween 均回到零。测试随后显式 dispose 资产注册表和生命周期。

该结果与 M2 真实 runtime 完整销毁终态有意分开记录：M2 的完整 runtime 销毁终态仍为 `disposed=true`、`displayObjectsByOwner={}`；本节只报告 Layer 两批 50 次循环结束时、共享 runtime 尚未销毁的稳定点。

## 7. 门禁与验收结果

### 7.1 M3 聚焦门禁

命令：

```powershell
npm test -w @surdet/renderer -- dialogue-layer.test.ts legacy-dialogue-contract.test.ts adv-renderer.test.ts nvl.test.ts ruby-layout.test.ts backlog-search-controller.test.ts resource-cycles.test.ts
```

结果：

- Test Files：7 passed / 7；
- Tests：89 passed / 89；
- 失败、跳过、取消：0。

### 7.2 Renderer 单包门禁

- `npm run typecheck -w @surdet/renderer`：通过；
- `npm run build -w @surdet/renderer`：通过；
- `npm test -w @surdet/renderer`：36 个测试文件、249 项测试通过；
- `npm run verify:renderer-boundaries`：3 个边界测试通过，仓库 Layer boundary check 通过。

### 7.3 根级全量门禁

命令：

```powershell
npm run verify:all
```

结果：

- verify tools：6 项通过；
- Renderer boundary、capabilities、hygiene 和文档相关门禁通过；
- 根级 typecheck：所有包通过；
- CLI：86 项通过；
- Core：298 项通过；
- Editor：133 项通过；
- Renderer：249 项通过，36 个文件；
- Shell：32 项通过；
- Starter：3 项通过；
- formal simulation：11 个场景，选择覆盖 `23/23`，3 个结局，运行时错误 `0`，资产 `44`；
- starter simulation：运行时错误 `0`，预期分支覆盖 `2/3`；
- formal、starter、editor build：通过；
- 最终 `git diff --check`：通过。

现有 Vite 大 chunk、测试故意触发的错误日志和 CLI usage 输出均为既有测试/构建警告，没有形成失败项。

## 8. 提交与工作树

### 8.1 精确提交

M3 源码和测试已作为独立聚焦提交：

```text
d7a18766f4bcb4a0959dc0672df32a753330c6de
refactor(renderer): extract dialogue layer
```

独立复审整改已作为单独聚焦提交：

```text
7f752dccf5566e70a1c419e1128ae39eb50d22b2
fix(renderer): centralize active speaker coordination
```

第二次独立复审整改已作为新的单独聚焦提交：

```text
101d4b3802bdd05b1656216454f0bea38f8f876e
fix(renderer): avoid duplicate legacy speaker focus
```

本次整改报告将作为单独文档提交，不与源码提交混合。

### 8.2 文件范围

源码提交纳入 9 个文件：

- `packages/renderer/src/adv-renderer.ts`
- `packages/renderer/src/api/renderer-commands.ts`
- `packages/renderer/src/index.ts`
- `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- `packages/renderer/src/pixi-stage.ts`
- `packages/renderer/src/runtime/create-renderer-runtime.ts`
- `packages/renderer/src/runtime/renderer-facade.ts`
- `packages/renderer/src/types.ts`
- `packages/renderer/test/layers/dialogue-layer.test.ts`

本次独立复审整改提交另外纳入 7 个文件：

- `packages/renderer/src/api/renderer-commands.ts`
- `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- `packages/renderer/src/pixi-stage.ts`
- `packages/renderer/src/runtime/create-renderer-runtime.ts`
- `packages/renderer/src/runtime/renderer-facade.ts`
- `packages/renderer/test/layers/dialogue-layer.test.ts`
- `packages/renderer/test/legacy/legacy-dialogue-contract.test.ts`

第二次独立复审整改提交纳入 3 个文件：

- `packages/renderer/src/runtime/renderer-facade.ts`
- `packages/renderer/test/layers/dialogue-layer.test.ts`
- `packages/renderer/test/legacy/legacy-dialogue-contract.test.ts`

明确排除：

- `USER.md`
- `SESSION-HANDOFF.md`
- 所有 M4–M8 内容和任何远端操作。

### 8.3 当前等待状态

报告提交后应保持：


```text
WAITING_FOR_REVIEW
M4 未开始
未 push 远端
```

独立复审应重点确认：DialogueLayer 不再持有 World 回调、Facade typed port 的单次协调、`showText` profile 推导与纯查询、legacy Stage/AdvRenderer 兼容行为、两批 50 次资源稳定点，以及正式游戏 `23/23`、3 结局、44 资产、0 运行时错误结果。
