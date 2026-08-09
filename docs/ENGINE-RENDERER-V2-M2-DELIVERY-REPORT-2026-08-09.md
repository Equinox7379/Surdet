# Surdet Renderer v2 M2 整改交付报告

**日期：** 2026-08-09<br>
**项目目录：** `E:\surdet`<br>
**当前里程碑：** M2 复审整改<br>
**复审状态：** `WAITING_FOR_REVIEW` / `M3_BLOCKED`<br>
**远端操作：** 未 push<br>
**源码/测试验证 HEAD：** `d0940211827b3d1b02c9e2bed7dd431dd08234c1`<br>
**源码提交：** `fix(renderer): repair M2 runtime lifecycle boundaries`

本报告对应 M2 独立复审提出的 `CHANGES_REQUESTED / M3_BLOCKED` 整改。严格保留已通过的 Task 6–8 主体，只修复复审指定的 Task 9 依赖方向、异常清理、生命周期计数和真实资源循环阻断项；完成 M2 后停止等待独立复审。

## 1. 范围与结论

本轮只覆盖以下内容：

- 按 `docs/superpowers/plans/2026-08-09-renderer-v2-foundation-m0-m2.md` Task 9 重做生产控制器与兼容包装器的依赖方向。
- 修复 runtime 正常销毁、异常销毁和初始化失败时的全量清理尝试与聚合错误报告。
- 统一显式 `disconnect()`、`connect()` 返回的 unsubscribe、reconnect 和 `dispose()` 的幂等清理入口。
- 保留原有人工 lifecycle cycle 测试，新增真实 runtime/registry/controller 组合的两批各 50 次资源循环测试。
- 重跑 M2 聚焦测试、Renderer 全量测试、Renderer typecheck/build、根级 `verify:all`、正式游戏验收和独立 Renderer 基线。

明确未做以下工作：

- 未开始 M3 `DialogueLayer` 或任何 M3–M7 Layer 抽取。
- 未进行正式消费者 cutover、M8 cutover 或正式游戏宿主接线迁移。
- 未修改 DSL、场景语义、存档格式、回滚格式、游戏规则、正式游戏内容或编辑器行为。
- 未删除、读取、迁移或覆盖用户真实存档。
- 未删除 `USER.md` 或 `SESSION-HANDOFF.md`。
- 未 push、未 force push、未清理用户工作树，也未提交临时基线 JSON、截图、日志或 release 产物。

**结论：** 本轮源码和测试整改已完成，所有指定代码门禁和正式游戏验收通过；提交后的最终两轮 Renderer 基线均在 M0 门槛内。同时，采样期间确实出现过一轮菜单 p95 超限，原始 JSON 和失败样本均保留并在第 6 节披露。当前停止在 `WAITING_FOR_REVIEW`，不进入 M3。

## 2. Task 9 依赖方向整改

### 2.1 PresentationController 成为独立生产状态机

文件：

- `E:\surdet\packages\renderer\src\runtime\presentation-controller.ts`
- `E:\surdet\packages\renderer\test\runtime\presentation-controller.test.ts`

整改结果：

- `PresentationController` 是独立生产类，不再继承 `AdvRenderer`。
- 控制器消费 `RendererCommands` 和 `RendererQueries`，不再直接依赖 Pixi Stage。
- 对话输入/等待、choice 导航和确认、auto/skip、Backlog、界面隐藏、演出快照/恢复/清理以及 Core EventBus 连接状态均由这一份控制器状态机持有。
- 表现操作通过 `commands.dialogue`、`commands.world`、`commands.presentation`、`commands.system` 和查询端口完成；没有第二份隐藏的表现状态机。
- `clearPresentation()` 先清理控制器持有的活动 timelines，再清理表现端口，并请求下一帧；因此旧 timeline 不会在下一帧重新投影。
- `snapshotPresentation()` 与 `restorePresentation()` 使用同一表现事务边界，恢复和清理不会绕过控制器状态。
- 结构测试验证 `PresentationController.prototype` 不以 `AdvRenderer.prototype` 为原型，且控制器不含 Stage 直连状态机。

### 2.2 AdvRenderer 变为兼容委托包装器

文件：

- `E:\surdet\packages\renderer\src\adv-renderer.ts`

整改结果：

- 保留原有构造函数形状和原有公开方法/getter。
- `AdvRenderer` 只负责把旧 Stage 适配成 `RendererCommands`/`RendererQueries`，创建或持有 `PresentationController`，再逐项委托旧 API。
- 旧的 `status`、`needsUpdate`、对话、choice、auto/skip、Backlog、输入、snapshot/restore/clear、reset、dispose 等调用返回值保持兼容。
- 不再保留一份旧的对话/演出/输入状态机。
- 既有 `AdvRenderer` 兼容测试本轮仍全部通过：56 项。

`rg` 结构复核结果：

- `PresentationController extends AdvRenderer`：无匹配。
- `presentation-controller.ts` 中的 `this.#stage`、Stage 直连状态机：无匹配。
- 7 个实现/测试改动文件中没有 M3 Layer 文件、正式消费者文件或 DSL/存档文件。

## 3. 异常安全清理整改

文件：

- `E:\surdet\packages\renderer\src\runtime\create-renderer-runtime.ts`
- `E:\surdet\packages\renderer\test\integration\renderer-runtime.test.ts`

### 3.1 runtime 异常销毁

runtime 现在先建立一次清理动作列表，并对每个动作独立捕获异常。任意 disposer 抛错后，后续动作仍然会被尝试；不会因为 scheduler 或 controller 的首个异常而跳过 Stage、资源注册表、lifecycle 或 facade 标记。

清理顺序保持：

1. scheduler
2. PresentationController
3. Stage
4. `RenderAssetRegistry`
5. `RenderLifecycle`
6. facade 的 disposed 标记

如果清理过程中出现一个或多个异常，最终抛出 `RendererError`，其 `cause` 为 `AggregateError`，包含所有清理失败；不再把第一个普通 Error 原样向外泄漏。`dispose()` 首次调用即锁定 disposed 状态，后续调用幂等，不会再次执行全量清理。

异常测试验证了：

- scheduler 抛错后仍尝试 controller、stage、asset registry、lifecycle 和 facade。
- 各 disposer 的尝试顺序为 `scheduler → controller → stage → asset-registry → lifecycle → facade`。
- 顶层错误为 `RendererError`，并携带 `AggregateError`。
- 第二次 `dispose()` 不重复清理。

### 3.2 初始化失败清理

runtime 组合初始化和真实 `PixiStage.init()` 失败路径均接入同一类全量清理机制。初始化失败时会尽可能清理已经创建的 scheduler/controller/stage/asset registry/lifecycle/facade；初始化异常和清理异常统一包装为 `RendererError(code=LAYER_INITIALIZATION_FAILED)`，其 `cause` 为 `AggregateError`。

测试覆盖：

- 组合初始化过程中 lifecycle 注册失败。
- 真实 `PixiStage.init()` 失败后 Stage 与 registry 的清理。
- 初始化清理自身抛错时仍继续后续清理。

## 4. Lifecycle 计数与资源循环

### 4.1 连接/断开计数

`PresentationController.connect()`、显式 `disconnect()`、返回的 unsubscribe、reconnect 和 `dispose()` 现在共享一个幂等清理入口：

- 新 connect 先关闭旧连接，避免重连累积 listener。
- 返回的 unsubscribe 与显式 disconnect 执行同一个清理闭包；重复调用无副作用。
- 断开后立即从 `RenderLifecycle` 移除 `runtime/listener/core-events`，listener 计数即时归零。
- dispose 会复用同一入口，不会重复注销或留下旧 listener。

测试覆盖顺序：connect → 显式 disconnect → reconnect → returned unsubscribe → reconnect → dispose，并在每次断开后直接检查 lifecycle listener 计数。

### 4.2 人工 lifecycle cycle 测试

原有手工 lifecycle cycle 测试保留，没有用新测试替换或删除。它继续验证 ticker、listener、tween、async、blob、pool、display 七类资源的注册、替换、释放和 disposed 后行为。

### 4.3 真实 runtime/registry/controller 两批 50 次循环

文件：

- `E:\surdet\packages\renderer\test\integration\resource-cycles.test.ts`

新增测试每次创建真实的：

- `RenderLifecycle`
- `RenderAssetRegistry`
- `PresentationController`
- `RendererCommands`/`RendererQueries` 端口
- `createRendererRuntimeFromInternals()` 组合 runtime

每个循环覆盖：

- 背景和立绘资源注册
- late async 资源加载
- controller reset
- `clearAssets`
- late async 结果落后于 generation 后被丢弃
- connect/disconnect
- runtime dispose
- disposed 后 snapshot/resource counters 稳定

测试执行两批互相独立的 50 次循环，并比较两批结束时的稳定点。两批稳定点完全相等：

```json
{
  "disposed": true,
  "tickerCallbacks": 0,
  "listeners": 0,
  "activeTweens": 0,
  "activeAsyncTasks": 0,
  "blobUrls": 0,
  "pooledObjects": {},
  "displayObjectsByOwner": {}
}
```

同时验证所有 late async 结果均被丢弃，没有把旧会话资源写入新会话；第二批没有相对第一批增长。

## 5. 测试、构建与正式游戏验收

所有命令均在源码提交 `d0940211827b3d1b02c9e2bed7dd431dd08234c1` 对应的工作树上执行。没有把报告提交或旧缓存结果当作源码验证结果。

### 5.1 M2 聚焦测试

命令：

```powershell
npm test -w @surdet/renderer -- --run test/adv-renderer.test.ts test/runtime/presentation-controller.test.ts test/integration/renderer-runtime.test.ts test/integration/resource-cycles.test.ts test/integration/presentation-clear.test.ts
```

结果：5 个测试文件、73 项测试全部通过。

| 聚焦区域 | 数量 |
|---|---:|
| AdvRenderer 兼容测试 | 56 |
| PresentationController 结构/输入/lifecycle | 6 |
| runtime 异常与初始化清理 | 6 |
| 真实资源循环与两批 50 次验证 | 4 |
| presentation clear 事务边界 | 1 |
| **合计** | **73** |

### 5.2 Renderer 全量、typecheck、build

命令：

```powershell
npm test -w @surdet/renderer
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
```

结果：

- Renderer：34 个测试文件、236 项测试全部通过。
- Renderer typecheck：退出码 0。
- Renderer build：退出码 0。

### 5.3 根级全量门禁

命令：

```powershell
npm run verify:all
```

结果：退出码 0。门禁输出包含：

- 工具测试 6/6；其中 `verify-all` 唯一步骤/命令签名、能力矩阵相关测试和 `shell:false` 检查均通过。
- CLI 86 项通过。
- Core 298 项通过。
- Editor 133 项通过。
- Host 18 项通过。
- Renderer 236 项通过。
- Shell 32 项通过。
- Starter 3 项通过。
- 文档能力矩阵检查通过。
- 跟踪路径卫生检查通过：463 个路径。
- 所有 workspace typecheck/build、starter HMR、正式样例检查和差异检查通过。

### 5.4 正式游戏验收

命令：

```powershell
npm run verify:formal
```

结果：

- 正式游戏 11 个场景，lint 0 错误、0 警告。
- choice 分支覆盖 `23/23`。
- 可达结局 3 个：`testimony_end`、`meeting_end`、`silence_end`。
- 存档往返冒烟 39 次。
- 资产检查 `44` 项通过。
- 运行时错误 `0`。

## 6. Renderer 基线与失败样本披露

### 6.1 基线规则

比较基线：

`E:\surdet\docs\baselines\renderer-v2-cab200b.json`

M0 顶层值和门槛：

| 指标 | M0 值 | 汇总方式 | 最大允许比例 |
|---|---:|---|---:|
| `coldStartMs` | 891.8183 ms | 5 个独立样本 median | 1.10 |
| `assetReadyMs` | 948.0453 ms | 5 个独立样本 median | 1.10 |
| `menuOpenP95Ms` | 10.8000 ms | 5 个独立样本 p95 | 1.15 |
| `sceneP95Ms` | 25.6000 ms | 5 个独立样本 p95 | 1.15 |

每一轮基线均执行 1 次独立 Electron 暖机，之后执行 5 次独立 Electron 正式启动；每次使用独立临时 `userData`。当前比较命令没有传 `--source-equivalent-to`，所以没有写入永久等价 SHA；正式提交后的最终基线 JSON 的 `sourceSha` 均为源码 HEAD `d094021...`。

原始 JSON 全部保存在系统临时目录，没有加入仓库：

```text
C:\Users\Equinox\AppData\Local\Temp\surdet-m2-renderer-baselines-20260809\renderer-v2-m2-current-1.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m2-renderer-baselines-20260809\renderer-v2-m2-current-2.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m2-renderer-baselines-20260809\renderer-v2-m2-current-3.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m2-renderer-baselines-20260809\renderer-v2-m2-current-4.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m2-renderer-baselines-20260809\renderer-v2-m2-current-5.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m2-renderer-baselines-20260809\renderer-v2-m2-current-6.json
```

每份 JSON 都保留 schema v2、四项指标的 5 个原始样本、median、p95、汇总方式、资源计数、视觉 hash 和错误计数。

### 6.2 六轮完整结果

比例为当前顶层汇总值 / M0 顶层值；菜单和场景的门槛分别为 1.15，cold 和 asset 的门槛分别为 1.10。

| 轮次 | source 状态 | cold median / 比例 | asset median / 比例 | menu p95 / 比例 | scene p95 / 比例 | 资产 / 错误 |
|---|---|---:|---:|---:|---:|---|
| 1 | 提交前工作树 | 884.2192 / 0.991479 | 980.5169 / 1.034251 | 11.4000 / 1.055556 | 25.9000 / 1.011719 | 6/6；0/0/0 |
| 2 | 提交前工作树 | 889.4968 / 0.997397 | 932.4402 / 0.983540 | **22.5000 / 2.083333** | 25.5000 / 0.996094 | 6/6；0/0/0 |
| 3 | 提交前工作树 | 895.5970 / 1.004237 | 939.4049 / 0.990886 | 10.7000 / 0.990741 | 25.1000 / 0.980469 | 6/6；0/0/0 |
| 4 | 提交前工作树 | 914.7254 / 1.025686 | 963.2650 / 1.016054 | 10.1000 / 0.935185 | 25.5000 / 0.996094 | 6/6；0/0/0 |
| 5 | `d094021...` | 927.4641 / 1.039970 | 979.1841 / 1.032845 | 11.0000 / 1.018519 | 23.9000 / 0.933594 | 6/6；0/0/0 |
| 6 | `d094021...` | 906.9431 / 1.016960 | 955.5919 / 1.007960 | 10.2000 / 0.944444 | 24.4000 / 0.953125 | 6/6；0/0/0 |

### 6.3 超限样本的完整披露

第 2 轮没有被删除、替换或从统计中排除。其完整菜单原始样本为：

```text
7.8, 8.2, 10.8, 11.3, 22.5 ms
```

因此第 2 轮菜单 p95 为 22.5 ms，按既定 15% 门槛明确失败。该轮的其他原始样本也保留在上列 JSON 中：

```text
cold:  881.6660, 884.3962, 889.4968, 908.2906, 909.9125
asset: 926.1440, 927.9936, 932.4402, 954.1639, 955.5081
scene: 23.7000, 24.6000, 24.8000, 25.0000, 25.5000
```

第 3、4 轮构成一组连续通过轮次；提交源码后的第 5、6 轮又构成一组连续通过轮次。因此最终以提交后第 5、6 轮作为 M2 的正式比较证据，但不把第 2 轮的失败从审计记录中抹去，也没有修改 10%/15% 阈值。

### 6.4 最终两轮原始样本与视觉/错误结果

第 5 轮：

```text
cold:  912.7671, 923.0583, 927.4641, 931.8316, 950.6562
asset: 956.8910, 970.5753, 979.1841, 994.9888, 1287.2295
menu:  1.2000, 5.8000, 8.4000, 9.8000, 11.0000
scene: 23.4000, 23.5000, 23.5000, 23.7000, 23.9000
```

第 6 轮：

```text
cold:  901.7431, 906.6131, 906.9431, 910.9972, 911.8054
asset: 948.0958, 949.3520, 955.5919, 959.0229, 1271.8772
menu:  0.7000, 7.4000, 8.7000, 10.0000, 10.2000
scene: 22.7000, 22.9000, 23.8000, 24.0000, 24.4000
```

第 5、6 轮共同结果：

- 每轮暖机 1 次、正式独立启动 5 次。
- 每轮资源 `6/6`，`pageErrors=0`、`consoleErrors=0`、`failedRequests=0`。
- `title` 视觉 SHA-256 与 M0 一致：`aca617dcc09733b2282be67fbe3a15c984e91cfd610358d48d6ad4d1dacc8882`。
- `story-entry` 视觉 SHA-256 与 M0 一致：`b064926a4b0cd5249a2c2dced12508b7661bdf99ab510590b3c429b9c04cf238`。
- 两轮四项比较均没有 `compareRendererBaseline()` failure。

## 7. Git 边界与交付状态

### 7.1 已提交内容

源码/测试聚焦提交：

```text
d0940211827b3d1b02c9e2bed7dd431dd08234c1
fix(renderer): repair M2 runtime lifecycle boundaries
```

该提交只纳入以下 7 个路径：

- `packages/renderer/src/adv-renderer.ts`
- `packages/renderer/src/runtime/create-renderer-runtime.ts`
- `packages/renderer/src/runtime/presentation-controller.ts`
- `packages/renderer/src/runtime/renderer-facade.ts`
- `packages/renderer/test/integration/renderer-runtime.test.ts`
- `packages/renderer/test/integration/resource-cycles.test.ts`
- `packages/renderer/test/runtime/presentation-controller.test.ts`

报告本身随后作为独立文档提交；不把报告文档和实现提交混写，也不会把排除文件带入暂存区。

### 7.2 工作树与远端关系

实现提交完成后立即复核：

```text
git status --short
?? SESSION-HANDOFF.md
?? USER.md

git rev-list --left-right --count HEAD...surdet/main
24  0
```

报告提交只增加本报告这一份文档，不改变实现内容；最终交付复核应仍只看到以下两个未跟踪排除文件：

```text
?? SESSION-HANDOFF.md
?? USER.md
```

本地分支没有 push，未使用 force push。最终报告提交后的准确 HEAD、ahead/behind 和工作树将在本次本地文档提交成功后再次用 Git 命令复核并在交付回报中给出。

## 8. 停止点

当前状态固定为：

```text
WAITING_FOR_REVIEW
M3_BLOCKED
```

在总经理/独立复审明确批准前：

- 不进入 M3。
- 不实现 Layer 抽取。
- 不做正式消费者 cutover。
- 不 push 远端。
- 不修改 DSL、存档、游戏规则或编辑器行为。

本轮 M2 整改到此停止，等待独立复审。
