# Surdet Renderer v2 M3 交付报告

日期：2026-08-09

项目：`E:/surdet`

里程碑：M3 — DialogueLayer 迁移

当前状态：`WAITING_FOR_REVIEW`

## 1. 结论

M3 已按批准的 Renderer v2 Layer Migration M3–M7 任务书完成，施工范围止于 `Task 13: Extract DialogueLayer implementation`。对白、Ruby、选择肢、等待指示器、NVL、Backlog、Backlog 搜索视图、Banner、Command Rail、界面隐藏和说话人资料投影已经从 `PixiStage` 的实现主体中抽出，接入共享的 `RenderLifecycle`、`RenderAssetRegistry`、`PresentationPreferences` 和 Renderer Facade 兼容边界。

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

Facade 的 `commands.dialogue` 优先委托实际 `DialogueLayer`，在仅提供旧 Stage 的兼容场景中回退到 Stage 方法。Controller 仍只依赖 `RendererCommands`/`RendererQueries`，没有导入 `DialogueLayer` 或直接调用 Stage。

`setActiveSpeaker(characterId)` 保持跨层意图边界：对白 Layer 更新说话人标签/头像状态，World 端口更新立绘聚焦。新增的 `WorldCommands.setPortraitFocus()` 只表达端口契约，不把 World 实现暴露给 DialogueLayer。

Runtime composition root 将同一个 `RenderLifecycle` 注入 Stage 与 DialogueLayer，并将实际 Layer 传递给 Facade；旧 `PixiStage`/`AdvRenderer` 构造和兼容消费者仍可继续工作。

## 4. 合同测试与行为覆盖

### 4.1 DialogueLayer 直接测试

`packages/renderer/test/layers/dialogue-layer.test.ts` 当前包含 8 项测试，覆盖：

- 文本、旁白、重复文本和 Ruby；
- 选择肢、highlight、隐藏和选择回调；
- awaiting 与 continue pulse；
- Backlog 条目、搜索、滚动、语音重播、关闭回调及安全查询；
- NVL、chapter/tip Banner 和 Command Rail；
- hideInterface 不影响 World projection、speaker profile 和 speaker focus；
- resetSession 仍由 Controller/Runtime 明确负责，重复销毁保持幂等；
- Layer 自身资源在两批各 50 次循环中稳定。

### 4.2 Legacy 兼容测试

`packages/renderer/test/legacy/legacy-dialogue-contract.test.ts` 保留 2 项兼容测试，验证：

- 原 `PixiStage` 的完整对白公开面仍可调用、重复执行并在 reset 后保留 World projection；
- `AdvRenderer` 的 callback binding、Backlog 关闭回调和旧生命周期行为继续成立。

### 4.3 确定性视觉状态审计

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

## 5. 资源循环结果

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

## 6. 门禁与验收结果

### 6.1 M3 聚焦门禁

命令：

```powershell
npm test -w @surdet/renderer -- dialogue-layer.test.ts legacy-dialogue-contract.test.ts adv-renderer.test.ts nvl.test.ts ruby-layout.test.ts backlog-search-controller.test.ts resource-cycles.test.ts
```

结果：

- Test Files：7 passed / 7；
- Tests：86 passed / 86；
- 失败、跳过、取消：0。

### 6.2 Renderer 单包门禁

- `npm run typecheck -w @surdet/renderer`：通过；
- `npm run build -w @surdet/renderer`：通过；
- `npm test -w @surdet/renderer`：36 个测试文件、246 项测试通过；
- `npm run verify:renderer-boundaries`：3 个边界测试通过，仓库 Layer boundary check 通过。

### 6.3 根级全量门禁

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
- Renderer：246 项通过，36 个文件；
- Shell：32 项通过；
- Starter：3 项通过；
- formal simulation：11 个场景，选择覆盖 `23/23`，3 个结局，运行时错误 `0`，资产 `44`；
- starter simulation：运行时错误 `0`，预期分支覆盖 `2/3`；
- formal、starter、editor build：通过；
- 最终 `git diff --check`：通过。

现有 Vite 大 chunk、测试故意触发的错误日志和 CLI usage 输出均为既有测试/构建警告，没有形成失败项。

## 7. 提交与工作树

### 7.1 精确提交

M3 源码和测试已作为独立聚焦提交：

```text
d7a18766f4bcb4a0959dc0672df32a753330c6de
refactor(renderer): extract dialogue layer
```

本报告将作为单独文档提交，不与源码提交混合。

### 7.2 文件范围

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

明确排除：

- `USER.md`
- `SESSION-HANDOFF.md`
- 所有 M4–M8 内容和任何远端操作。

### 7.3 当前等待状态

报告提交后应保持：


```text
WAITING_FOR_REVIEW
M4 未开始
未 push 远端
```

独立复审应重点确认：DialogueLayer 的字段归属和显示顺序、Facade 双端口 `setActiveSpeaker`、Controller 的命令/查询边界、两批 50 次资源稳定点，以及正式游戏 `23/23`、3 结局、44 资产、0 运行时错误结果。
