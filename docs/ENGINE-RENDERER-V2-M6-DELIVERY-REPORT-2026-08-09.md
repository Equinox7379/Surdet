# Surdet Renderer v2 M6 交付报告

日期：2026-08-09  
项目：E:/surdet  
里程碑：M6 — Task 16: Freeze and extract SystemPanelLayer  
当前状态：WAITING_FOR_REVIEW

## 1. 结论

M6 已严格按照 `E:/surdet/docs/superpowers/plans/2026-08-09-renderer-v2-layers-m3-m7.md` 的 Task 16 完成。

战斗、地图、商店、据点指令和视频这组系统面板的显示对象、局部状态、监听器、视频异步代次和回调已经从 `PixiStage` 的实现主体迁移到独立的 `SystemPanelLayer`。正式 v2 Runtime 通过 `RendererFacade` 注入该 Layer；旧 `PixiStage` API 保留为兼容委托，不再保留第二份系统面板绘制实现。

本轮完成了：

- SystemPanel legacy/v2 合同冻结与测试先行；
- `SystemPanelLayer` 的实现、公开投影端口和安全 overlay 查询；
- RendererFacade 正式 v2 接线与 legacy fallback；
- PixiStage 兼容委托、reset/dispose 生命周期转发；
- 视频 `AsyncGeneration` 取消与迟到事件隔离；
- 两批各 50 次系统面板资源循环；
- Renderer 全量门禁、Renderer boundary、workspace 全量门禁；
- 真实 Electron E2E、starter 系统边界探针和《零点之后》正式验收。

本轮没有开始 M7 WorldLayer，也没有开始 M8 cutover；没有修改 DSL、存档格式、游戏规则、键位、视觉文案、编辑器行为或正式游戏消费者接线；没有 push、force push 或清理工作树。`USER.md` 与 `SESSION-HANDOFF.md` 始终未修改、未暂存、未提交、未删除。

本报告提交后立即停止在 `WAITING_FOR_REVIEW`，等待独立复审及“批准进入 M7”。

## 2. 基线、范围与提交

### 2.1 M6 开工基线

- M5 最终批准 HEAD：

~~~text
c7bfc2e5b00ccbfeb1d8b600b00c688410126181
~~~

- 分支：`main`。
- 开工时工作树中除本轮目标外，仅有两个明确排除的未跟踪文件：

~~~text
?? SESSION-HANDOFF.md
?? USER.md
~~~

- M6 全程未 push、未 force push。
- 本轮未进行任何工作树清理；构建生成物保持由既有忽略规则管理。

### 2.2 M6 源码与测试提交

源码/测试聚焦提交：

~~~text
9a05072a3e7bedd9b83776f2bf211ce306e5066d
refactor(renderer): extract system panel layer
~~~

该提交的父节点为 M5 批准基线 `c7bfc2e5b00ccbfeb1d8b600b00c688410126181`，精确包含以下 11 个路径：

~~~text
E:/surdet/packages/renderer/src/adv-renderer.ts
E:/surdet/packages/renderer/src/api/renderer-commands.ts
E:/surdet/packages/renderer/src/api/renderer-queries.ts
E:/surdet/packages/renderer/src/battle-view.ts
E:/surdet/packages/renderer/src/index.ts
E:/surdet/packages/renderer/src/layers/system-panel/system-panel-layer.ts
E:/surdet/packages/renderer/src/pixi-stage.ts
E:/surdet/packages/renderer/src/runtime/create-renderer-runtime.ts
E:/surdet/packages/renderer/src/runtime/renderer-facade.ts
E:/surdet/packages/renderer/test/layers/system-panel-layer.test.ts
E:/surdet/packages/renderer/test/legacy/legacy-system-panel-contract.test.ts
~~~

本报告随后作为独立文档提交。报告提交 SHA 会在本次执行的最终交付回报中单独记录；源码提交与报告提交均为本地提交，不推送远端。

### 2.3 严格排除项

以下内容明确不属于 M6：

- M7 WorldLayer；
- M8 正式消费者迁移、legacy 收口和最终 cutover；
- DSL、存档格式、游戏规则、键位、视觉文案和编辑器行为；
- Core/Host 系统求解器、宿主存档和回滚语义的重构；
- 与 SystemPanel 迁移无直接关系的重构或玩家功能；
- `USER.md`、`SESSION-HANDOFF.md` 的任何修改、暂存、提交或删除；
- 远端 push、force push 和工作树清理。

## 3. 测试先行与失败证据

按照 Task 16 的施工纪律，先新增 M6 合同测试，再触碰生产接线。

最初只加入：

~~~text
E:/surdet/packages/renderer/test/layers/system-panel-layer.test.ts
E:/surdet/packages/renderer/test/legacy/legacy-system-panel-contract.test.ts
~~~

在生产实现尚未建立时执行 M6 聚焦测试，测试按预期失败，暴露了三个真实迁移阻断点：

1. `SystemPanelLayer` 模块尚不存在，直接合同无法加载；
2. 真实 `PixiStage` 尚没有 `systemPanelLayer` 兼容端口；
3. `RendererFacade` 的 overlay 查询尚没有 `system()` 查询合同。

确认红测之后才开始生产实现。没有通过跳过测试、放宽断言或把系统面板逻辑塞入测试 fake 来取得绿色结果。

## 4. 合同与实现交付

### 4.1 SystemPanelLayer 所有权

新增：

~~~text
E:/surdet/packages/renderer/src/layers/system-panel/system-panel-layer.ts
~~~

`SystemPanelLayer` 实现 `SystemPanelProjectionPort`，接收调用者准备好的 ViewModel 和回调，只负责系统面板的渲染投影、局部显示状态、事件监听和异步视频生命周期。

它不导入 Core、Interpreter、VariableStore、Calendar、Shop、Host 或其他 Renderer Layer；源码依赖测试和 `npm run verify:renderer-boundaries` 均确认了这一点。

Task 16 规定的字段族集中由 SystemPanelLayer 所有：

~~~text
battle layer / battle handlers / selected skill
map handlers
shop handlers
base command handlers
active video
video AsyncGeneration
system-owned listener/display registrations
~~~

SystemPanelLayer 负责：

- 战斗单位、技能、目标、移动、跳过行动的显示与回调；
- 地图节点、进入节点和结束回合的显示与回调；
- 商店库存、购买和离开商店的显示与回调；
- 据点指令、执行和返回地图的显示与回调；
- 视频 DOM 投影、播放结束、播放错误、指针跳过、隐藏、reset、dispose 和迟到事件处理；
- 重复 show/hide、reset、dispose 的幂等清理；
- owner=`system` 的显示对象和监听器登记/释放；
- 共享 `RenderLifecycle`、`RenderAssetRegistry` 和视频 `AsyncGeneration` 的使用。

Task 16 的文字中提到商店 buy/sell，但当前锁定的 `ShopView`、旧 Stage API 和宿主接线只有购买与关闭，没有 `sell`/`onSell` 公开回调。本轮保持现有 API，不臆造 sell 行为，也没有修改游戏规则或增加玩家功能。

### 4.2 公开投影与查询合同

`E:/surdet/packages/renderer/src/api/renderer-commands.ts` 新增：

~~~ts
export interface SystemPanelProjectionPort extends SystemPanelCommands {
  system(): SystemPanelOverlayState;
}
~~~

`E:/surdet/packages/renderer/src/api/renderer-queries.ts` 新增安全值类型：

~~~ts
export type SystemPanelOverlayState =
  | { type: 'none' }
  | { type: 'battle' }
  | { type: 'map' }
  | { type: 'shop' }
  | { type: 'base' }
  | { type: 'video' };
~~~

`overlay.system()` 只返回上述值对象，不暴露 Container、Sprite、Texture、DOM video 或回调引用。查询不创建显示对象、不注册资源、不请求帧、不改变可见状态；SystemPanelLayer 已销毁时返回 `{ type: 'none' }`。

### 4.3 RendererFacade v2 接线

`E:/surdet/packages/renderer/src/runtime/renderer-facade.ts` 和 `E:/surdet/packages/renderer/src/runtime/create-renderer-runtime.ts` 新增 `systemPanelLayer?: SystemPanelProjectionPort` 接线。

注入实际 SystemPanelLayer 时：

- `commands.system.showBattle/hideBattle` 直接调用 SystemPanel port；
- `commands.system.showMap/hideMap` 直接调用 SystemPanel port；
- `commands.system.showShop/hideShop` 直接调用 SystemPanel port；
- `commands.system.showBaseCommands/hideBaseCommands` 直接调用 SystemPanel port；
- `commands.system.showVideo/hideVideo` 直接调用 SystemPanel port；
- Facade 读取 SystemPanel 的纯 overlay 查询；
- Map/Shop/Base/Video 关闭回调先同步 overlay 状态，再转发宿主回调；
- Layer 不直接引用其他 Layer，跨层意图仍由 Facade 负责。

未注入 SystemPanelProjectionPort 时，Facade 保留旧 Stage fallback：每个旧 API 只调用一次，并维护安全的 legacy overlay 缓存。兼容测试确认旧 Stage 的 API 仍可用，没有因为 v2 接线导致重复绘制或状态丢失。

### 4.4 PixiStage 兼容委托

`E:/surdet/packages/renderer/src/pixi-stage.ts` 保留原构造方式和旧公开 API，但系统面板方法现在只负责委托：

- `showBattle` / `hideBattle`；
- `showMap` / `hideMap`；
- `showShop` / `hideShop`；
- `showBaseCommands` / `hideBaseCommands`；
- `showVideo` / `hideVideo`；
- `resetSession()` 中转发 SystemPanel reset；
- `destroy()` 中转发 SystemPanel dispose。

旧的战斗、地图、商店、据点和视频绘制主体、处理器字段以及重复清理路径已从 PixiStage 移除，没有在 Facade 或 Stage 中保留第二份 SystemPanel 实现。

`BattleHandlers` 类型移至 `E:/surdet/packages/renderer/src/battle-view.ts`，PixiStage 继续 re-export 该类型以保持既有导入兼容，不改变运行时行为。

### 4.5 视频取消与迟到事件

每次视频显示都会推进 `AsyncGeneration` 并绑定唯一 token。`hideVideo()`、`reset()`、`dispose()` 会取消当前视频、移除 DOM 节点、释放 system owner 监听器，并使已经排队的 ended/error/pointerdown 事件失效。

测试明确覆盖：

- 正常 ended；
- error；
- 指针跳过；
- hide 后迟到 ended；
- 新视频替换旧视频后的迟到事件；
- 回调抛错后的本地清理；
- reset 后迟到 ended；
- dispose 后迟到 ended。

回调异常仍向调用者传播，但不会跳过本地视频和监听器清理。

## 5. 测试、循环与正式验收

### 5.1 M6 聚焦测试

执行：

~~~text
npm test -w @surdet/renderer -- system-panel-layer.test.ts legacy-system-panel-contract.test.ts gallery.test.ts resource-cycles.test.ts
npm test -w @surdet/host -- system-router.test.ts
npm test -w @surdet/core -- interpreter-save.test.ts variable-store.test.ts
~~~

结果：

- Renderer M6 聚焦：4 个文件、18/18 通过；
  - `system-panel-layer.test.ts`：7/7；
  - `legacy-system-panel-contract.test.ts`：2/2；
  - `gallery.test.ts`：5/5；
  - `resource-cycles.test.ts`：4/4；
- Host system-router：1 个文件、6/6 通过；
- Core interpreter-save + variable-store：2 个文件、39/39 通过。

### 5.2 两批各 50 次 SystemPanel 资源循环

`system-panel-layer.test.ts` 使用共享 `RenderLifecycle` 和 `RenderAssetRegistry`，执行两批独立循环，每批 50 次。每次循环覆盖：

~~~text
mount → battle show/hide → map show/hide → shop show/hide
→ base show/hide → video show/hide → reset → dispose
~~~

每次循环确认 root Container 没有残留子节点；两批结束后的快照完全相等，并满足：

~~~text
listeners = 0
activeTweens = 0
displayObjectsByOwner.system = 0
root.children = 0 for every disposed cycle
~~~

第二批没有相对第一批增长，证明 SystemPanelLayer 的显示对象、监听器和异步视频清理没有随循环累积。

### 5.3 Renderer 全量与边界门禁

执行：

~~~text
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
npm test -w @surdet/renderer
npm run verify:renderer-boundaries
npm run verify:all
git diff --check
~~~

结果：

- Renderer typecheck：通过；
- Renderer build：通过；
- Renderer 全量：42 个测试文件、291/291 通过；
- Renderer boundary：3/3 通过；
- `npm run verify:all`：通过；
- `verify:tools`：6/6 通过；
- 文档能力矩阵检查：通过；
- 跟踪路径仓库卫生检查：479 个路径通过；
- 全 workspace typecheck：通过；
- 全 workspace tests：通过，包含 core 23/298、editor 18/133、host 3/18、cli 7/86、shell 6/32、starter 3/3 以及 Renderer 42/291；
- `git diff --check`：通过。

门禁中出现的 `surdet pack` 非法调用提示、EventBus 测试主动触发的错误日志以及 Vite 大 chunk 提示均属于既有测试/构建输出，不是失败；命令退出码为 0，未通过吞错或提高阈值取得绿色结果。

### 5.4 真实 Electron 与系统边界

真实 shell E2E：

~~~text
npm run e2e -w @surdet/shell
~~~

结果：

- `__surdetDebug` 就绪；
- 真实 Electron 画布可用；
- 标题点击在当前窗口/DPI 条件下回退到同一 `titleSelect('new')` 入口；
- F5 快速存档通过；
- F9 快速读档通过；
- 读档后未回退到 idle；
- 55 steps、41 choices，抵达系统交互层；
- 运行时无失败。

starter 真实系统边界探针在真实 Electron、真实 host route 和真实 Runtime 接线下，于已经形成回滚快照的 `awaiting-advance` 点执行，结果为：

~~~json
{"opened":true,"hadRollback":true,"rollbackBlocked":true}
~~~

这证明系统面板打开后回滚被正确阻断，系统关闭后由宿主 reset 恢复边界；探针没有绕过 Facade、Layer 或宿主真实接线。

### 5.5 正式游戏验收

《零点之后》正式样例的既定验收继续通过：

- lint：11 个场景、0 个错误、0 个警告；
- 选择分支覆盖：23/23；
- 可达结局：3 个（`testimony_end`、`meeting_end`、`silence_end`）；
- 资产检查：44 项；
- 存档往返冒烟：39 次 save/load；
- 运行时错误：0；
- `zero-after-midnight` typecheck：通过；
- `zero-after-midnight` build：通过。

本轮未修改 `E:/surdet/examples/zero-after-midnight/src/main.ts`，没有改变正式游戏的 DSL、资产配置、系统规则或消费者接线；验收结果证明 SystemPanelLayer 迁移没有破坏正式项目行为。

## 6. 性能基线说明

Task 16 的验收重点是系统面板合同、兼容委托、资源循环稳定点和正式行为保持，没有新增独立 Electron Renderer 数值基线或新的阈值要求。本轮没有伪造或改写性能字段，也没有为取得绿色结果提高阈值。

M5 已批准的 Renderer 基线继续作为跨里程碑参照；M6 只新增了显示对象/监听器/视频异步生命周期的两批各 50 次稳定性证据。若独立复审要求新的数值采样，应作为复审意见明确授权后单独执行，不在本次 M6 范围内提前扩展。

## 7. 最终停止点与 Git 纪律

源码提交完成后的 HEAD 为：

~~~text
9a05072a3e7bedd9b83776f2bf211ce306e5066d
~~~

源码提交完成后的远端关系为：

~~~text
git rev-list --left-right --count HEAD...surdet/main
45 0
~~~

源码提交后、报告提交前的工作树只包含待提交的本报告和两个明确排除文件；源码提交的暂存区未包含 `USER.md`、`SESSION-HANDOFF.md`。报告提交完成后，预期最终工作树仍只保留：

~~~text
?? SESSION-HANDOFF.md
?? USER.md
~~~

本轮没有提交日志、截图、缓存、构建产物或任何其他无关文件，没有 push，也没有 force push。

报告提交完成后必须保持：

- `WAITING_FOR_REVIEW`；
- M7 未开始；
- M8 未开始；
- 不 push；
- 不 force push；
- 不提交、删除或修改 `USER.md`、`SESSION-HANDOFF.md`；
- 等待独立复审和“批准进入 M7”。

