# Surdet Renderer v2 M2 交付报告

**日期：** 2026-08-09
**项目目录：** `E:\surdet`
**当前里程碑：** M2
**状态：** `WAITING_FOR_APPROVAL`
**远端操作：** 未推送
**下一步：** 等待独立复审批准后，才可讨论 M3；本报告完成后本执行批次停止。

## 1. 结论

M2 Task 6–10 已完成，源码、测试、资源循环验证、Renderer 构建、根级全量门禁和正式游戏静态/无头验收均通过。M2 没有进入 M3，也没有改变 DSL、存档格式、游戏规则、编辑器行为或正式游戏的宿主接线。

本轮新增的核心边界如下：

- `RenderLifecycle` 成为所有 M2 资源所有权的统一登记边界，并保留旧 `ResourceLifecycle` 兼容包装。
- `AsyncGeneration` 为重置和销毁提供统一的 generation/token/abort 语义，旧异步结果不能回写新会话。
- `RenderAssetRegistry` 成为背景、立绘、头像、字体、Blob URL 和程序化纹理的单一资源注册/释放边界。
- `PresentationController` 在不复制 `AdvRenderer` 状态机的前提下承接 M2 输入归一化和事件连接；现有 `AdvRenderer`、`PixiStage` 公共行为保持兼容。
- runtime 的 scheduler、presentation controller、asset generation 进入同一生命周期诊断路径；资源循环测试证明两轮独立 50 次循环回到同一稳定点。

性能与视觉证据需要按“正式验收样本”和“环境调度诊断样本”区分阅读。正式验收样本 C、F 都满足 M0 的 10%/15% 门槛；样本 C 的标题和入口视觉 hash 与 M0 完全一致。额外诊断中出现了偶发的窗口调度尾部延迟和截图相位差，原始 JSON 未被删除、未用于降低标准，也未被伪装成零波动。详见第 6 节。

## 2. 严格范围与明确排除项

本轮只执行既定 M2 Task 6–10：

- **Task 6：** `RenderLifecycle`。
- **Task 7：** `AsyncGeneration` / `GenerationToken`。
- **Task 8：** `RenderAssetRegistry` 及 Stage/Facade 资源委托。
- **Task 9：** `PresentationController`、键鼠/手柄输入归一化和兼容连接。
- **Task 10：** lifecycle 诊断、资源循环验证、性能基线、全量门禁和交付报告。

明确没有做以下工作：

- 没有开始 M3 `DialogueLayer`，也没有抽取 M3–M7 的任何 UI Layer。
- 没有实施 M8 cutover；starter、正式游戏、编辑器和 CLI 模板仍保留既有 legacy 消费者，等待后续批准的迁移阶段。
- 没有迁移 M2 之外的生命周期、资源注册或输入控制内容。
- 没有改变 DSL、场景语义、存档格式、游戏规则、正式游戏文案或编辑器行为。
- 没有读取、迁移、覆盖或删除用户真实存档。
- 没有提交 `USER.md`、`SESSION-HANDOFF.md`，没有提交日志、截图、缓存、临时 JSON 或 release 产物。
- 没有 push、force push、清理工作树或重置用户已有修改。

## 3. 提交记录

本轮 M2 聚焦提交按 Task 6→10 的实现顺序如下：

| 提交 | 内容 |
|---|---|
| `29354a01a380879b64b39efc133555080c32476` | `refactor(renderer): add owner-scoped lifecycle`：新增 owner/kind/key 资源登记、替换、owner 释放、聚合错误和兼容包装。 |
| `db3db635d74c60b87fd65c48388cd276cfcd55de` | `refactor(renderer): add async generation cancellation`：新增 generation token、AbortSignal、过期 token 和 disposed 防护。 |
| `680c27863ecd28978f06e6051aa4a924f6fbc227` | `refactor(renderer): centralize shared asset ownership`：引入唯一 `RenderAssetRegistry`，接入 Stage、Facade 和 runtime 资源拥有权。 |
| `667ab3e04a2a46bc5826daaada18e758b4af3ee8` | `refactor(renderer): centralize presentation input control`：新增兼容的 `PresentationController` 和输入映射。 |
| `c612de93e2061192b000617d9cd0bd6bb13c7053` | `refactor(renderer): complete M2 lifecycle diagnostics`：接入 scheduler/controller 生命周期、资源循环测试、调试类型声明和 post-dispose 稳定错误。 |
| 本报告提交 | 本交付报告和 M2 验收证据。 |

## 4. Task 6–10 实现证据

### 4.1 RenderLifecycle

文件：

- `E:\surdet\packages\renderer\src\lifecycle\render-lifecycle.ts`
- `E:\surdet\packages\renderer\test\lifecycle\render-lifecycle.test.ts`
- `E:\surdet\packages\renderer\src\resource-lifecycle.ts`

实现要点：

- 锁定资源种类：`ticker`、`listener`、`tween`、`async`、`blob`、`pool`、`display`。
- 锁定 owner：`runtime`、`world`、`dialogue`、`menu`、`gallery`、`system`、`loading`、`legacy`。
- `(owner, kind, key)` 形成唯一复合键；重复注册先从索引移除旧项，再调用旧 disposer，最后安装新项。
- owner 释放前先移除索引，因此 disposer 即使重入释放也不会再次处理同一条目。
- 多个 disposer 抛错时仍继续清理，并通过 `RendererError` 的 `COMMAND_COMMIT_FAILED` 与 `AggregateError` 统一报告。
- `ResourceLifecycle` 现在只是 `legacy/display` 语义的兼容包装，旧调用方不需要立即迁移。

### 4.2 AsyncGeneration

文件：

- `E:\surdet\packages\renderer\src\lifecycle\async-generation.ts`
- `E:\surdet\packages\renderer\test\lifecycle\async-generation.test.ts`

实现要点：

- `advance()` 使旧 token 的 `current` 变为 `false`，并 abort 旧 signal。
- `dispose()` 使当前及后续 token 均失效；disposed 对象不能创建新 token 或推进 generation。
- 过期异步结果在 Registry 提交阶段再次检查，不会写入新会话的资源槽位。

### 4.3 RenderAssetRegistry

文件：

- `E:\surdet\packages\renderer\src\services\render-asset-registry.ts`
- `E:\surdet\packages\renderer\test\services\render-asset-registry.test.ts`
- `E:\surdet\packages\renderer\src\pixi-stage.ts`
- `E:\surdet\packages\renderer\src\runtime\renderer-facade.ts`

实现要点：

- 背景、立绘、头像使用统一 Registry；立绘复合键仍保持 `charId:costume:expression` 语义。
- URL/Blob 资源采用引用计数；最后一个引用释放时才通过 Pixi `Assets.unload` 释放。
- 调用方注入的 `Texture` 标记为 caller-owned，Registry 不主动 destroy。
- 程序化背景/立绘缓存由 Registry 持有并在缓存重置时销毁；替换操作采用 prepare → validate → commit，准备失败保留旧槽位。
- 字体按 role 归属 runtime/blob，并在重复注册、重置和销毁时保持单次移除语义。
- Registry 拥有一个 `AsyncGeneration` 和一个 `RenderLifecycle`（runtime 接入时使用共享 lifecycle）。
- disposed 后的直接变更会抛出稳定的 `RendererError(code=RENDERER_DISPOSED, domain=assets)`，不会退化成无上下文的普通错误。

### 4.4 PresentationController 与输入归一化

文件：

- `E:\surdet\packages\renderer\src\runtime\presentation-controller.ts`
- `E:\surdet\packages\renderer\src\adv-renderer.ts`
- `E:\surdet\packages\renderer\src\keybindings.ts`
- `E:\surdet\packages\renderer\src\gamepad.ts`
- `E:\surdet\packages\renderer\test\runtime\presentation-controller.test.ts`

实现要点：

- `PresentationController extends AdvRenderer`，复用现有已验证状态机，没有复制第二份对话/自动/快进/Backlog 状态机。
- `connect()`、`disconnect()` 和 `dispose()` 保持幂等；runtime listener 由 lifecycle 记录。
- `dispatchInput()` 统一处理 advance、choice、backlog、auto、skip、interface、escape。
- 菜单、快速存档、快速读档、回退等仍由宿主负责；Renderer 不越权接管游戏规则。
- 现有 `AdvRenderer` 构造与订阅路径保留，正式游戏行为未切换到 M8 v2 consumer。

### 4.5 Task 10 runtime diagnostics

文件：

- `E:\surdet\packages\renderer\src\runtime\create-renderer-runtime.ts`
- `E:\surdet\packages\renderer\test\integration\resource-cycles.test.ts`
- `E:\surdet\examples\starter\src\surdet-window.d.ts`
- `E:\surdet\examples\zero-after-midnight\src\surdet-window.d.ts`

runtime 现在在共享 lifecycle 下登记：

- `runtime/ticker/frame-scheduler`
- `runtime/listener/presentation-controller`
- `runtime/async/asset-generation`
- 已连接的 `runtime/listener/core-events`

销毁顺序测试固定为 scheduler → controller → stage，并验证重复 `dispose()` 不重复清理；生命周期最终为 disposed 且诊断 query 已标记 disposed。

## 5. 测试、构建和门禁结果

### 5.1 M2 聚焦测试

命令：

```powershell
npm test -w @surdet/renderer -- render-asset-registry.test.ts resource-cycles.test.ts presentation-controller.test.ts renderer-runtime.test.ts
npm run typecheck -w @surdet/renderer
```

结果：4 个测试文件、16 项测试通过；Renderer typecheck 通过。

### 5.2 Renderer 全量

命令：

```powershell
npm test -w @surdet/renderer
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
```

结果：34 个测试文件、229 项测试全部通过；typecheck 和 build 均退出码 0。

### 5.3 根级全量门禁

命令与结果：

| 命令/门禁 | 结果 |
|---|---|
| `npm run verify:all` | 通过；工具 6/6，CLI 86 项，Core 298 项，Editor 133 项，Host 18 项，Renderer 229 项，Shell 32 项，Starter 3 项；能力矩阵、类型、构建、测试、HMR 和正式样例检查均通过。 |
| `npm run docs:capabilities:check` | 通过。 |
| `npm run verify:hygiene` | 通过，跟踪路径 462 项。 |
| `npm run verify:formal` | 通过；正式游戏 11 场景、23/23 choice 分支、3 结局、44 项素材、运行时错误 0。 |
| `npm run verify:p1p2:policy` | 通过。 |
| `node packages/shell/scripts/verify-pack.mjs --artifact` | 通过；Electron artifact 关键文件 8/8、身份和素材校验通过。 |

正式游戏无头验收的可达结局为：`testimony_end`、`meeting_end`、`silence_end`；存档往返冒烟 39 次；运行时错误为 0。

## 6. 资源循环、性能和视觉证据

### 6.1 资源循环

测试文件：

`E:\surdet\packages\renderer\test\integration\resource-cycles.test.ts`

测试执行两个互相独立的 50-cycle batch。每次循环覆盖 ticker、listener、tween、async、blob、pool、display；每个 batch 都释放 dialogue/world/runtime owner。

第二个 batch 的 lifecycle snapshot 与第一个完全相等，稳定点为：

```json
{
  "disposed": false,
  "tickerCallbacks": 0,
  "listeners": 0,
  "activeTweens": 0,
  "activeAsyncTasks": 0,
  "blobUrls": 0,
  "pooledObjects": {},
  "displayObjectsByOwner": { "world": 0 }
}
```

此外还验证了 late async token 在 generation reset 和 runtime dispose 后均失效；runtime 的 scheduler/controller/stage 销毁顺序和重复销毁幂等性均通过。

### 6.2 M0 比较基线

M0 正式基线：

`E:\surdet\docs\baselines\renderer-v2-cab200b.json`

M0 顶层值：

| 指标 | M0 值 | 统计方式 | 门槛 |
|---|---:|---|---:|
| coldStartMs | 891.8183 ms | 5 样本中位数 | +10% |
| assetReadyMs | 948.0453 ms | 5 样本中位数 | +10% |
| menuOpenP95Ms | 10.8000 ms | 5 样本 p95 | +15% |
| sceneP95Ms | 25.6000 ms | 5 样本 p95 | +15% |

每次当前基线均包含 1 次独立 Electron 暖机和 5 次独立 Electron 正式启动；每次启动使用独立临时 `userData`，没有使用用户正常 Electron 配置。当前基线命令没有传 `--source-equivalent-to`，因此不会写入永久等价 SHA。

两份作为 M2 正式比较证据的独立临时基线：

| 原始 JSON | cold median | asset median | menu p95 | scene p95 | 相对 M0 | 素材/错误 |
|---|---:|---:|---:|---:|---|---|
| `C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v2-m2-current-c.json` | 979.3989 ms | 1029.1795 ms | 10.9000 ms | 28.7000 ms | +9.82% / +8.56% / +0.93% / +12.11% | 6/6，page/console/request = 0/0/0 |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v2-m2-current-f.json` | 936.0743 ms | 986.5899 ms | 12.3000 ms | 27.6000 ms | +4.96% / +4.07% / +13.89% / +7.81% | 6/6，page/console/request = 0/0/0 |

四项比较均无 `compareRendererBaseline()` failure。两份 JSON 都通过 Renderer baseline schema 校验并保留了 5 个原始样本；其中 C 的完整原始数组为：

```text
C cold:  946.3225, 958.0893, 979.3989, 1000.9360, 1089.1338
C asset: 994.1464, 1011.2540, 1029.1795, 1055.0069, 1150.4597
C menu:  6.4000, 6.5000, 10.4000, 10.5000, 10.9000
C scene: 26.2000, 26.3000, 27.0000, 27.4000, 28.7000

F cold:  926.4486, 935.3736, 936.0743, 941.4427, 1119.5640
F asset: 975.0453, 983.5511, 986.5899, 1179.5041, 1314.7286
F menu:  5.9000, 7.1000, 11.0000, 11.0000, 12.3000
F scene: 23.6000, 23.7000, 24.6000, 25.8000, 27.6000
```

### 6.3 采样噪声的完整披露

在 C/F 之外，连续诊断运行曾观察到偶发的端到端等待尾部：某些正式样本的冷启动、素材就绪或菜单/场景 p95 会越过门槛。例如：

- A：`952.81 / 1146.29 / 12.00 / 31.90 ms`，资源和场景越界。
- B：`1027.35 / 1103.04 / 9.00 / 29.90 ms`，冷启动、资源和场景越界。
- D：`1049.42 / 1450.24 / 12.00 / 28.80 ms`，多项越界。
- E：`997.50 / 1359.05 / 12.70 / 28.30 ms`，资源和菜单越界。
- G：`925.85 / 1293.95 / 11.30 / 26.50 ms`，资源越界。

这些结果没有被删除；对应原始 JSON 仍位于同一 Temp 目录中，且没有被提交。只读探针进一步证明：实际 renderer 资产队列在五次启动中为约 47.6–52.1 ms；同一 `waitForFunction` 端到端探针有 4 次约 50–61 ms、1 次延迟到 375.9 ms。这说明当前基线脚本的窗口/帧调度存在可见尾部抖动。该事实不应被解释为“性能永远稳定”，也不应用提高阈值来消除。

因此，本报告的性能结论是：

1. C、F 两份独立正式比较 artifacts 在既定统计方式和既定门槛下均通过。
2. M2 源码没有引入可由资源队列内部计时证明的串行加载回归；资源队列本身在只读探针中保持约 50 ms。
3. Windows/Electron 端到端采样仍存在偶发的等待/帧调度尾部，独立复审如要求“每一次尝试均不得越界”，应先批准一个单独的基线采样器去抖/测量校准任务；本轮没有修改阈值、删除样本或吞掉错误。

### 6.4 视觉证据

M0 的标题 hash：

`aca617dcc09733b2282be67fbe3a15c984e91cfd610358d48d6ad4d1dacc8882`

M0 的 `story-entry` hash：

`b064926a4b0cd5249a2c2dced12508b7661bdf99ab510590b3c429b9c04cf238`

当前 C 基线的两个视觉 hash 与 M0 完全一致：

```text
title       aca617dcc09733b2282be67fbe3a15c984e91cfd610358d48d6ad4d1dacc8882  MATCH
story-entry b064926a4b0cd5249a2c2dced12508b7661bdf99ab510590b3c429b9c04cf238  MATCH
```

当前 F 的标题 hash 仍一致；其入口 hash 不同。对同一当前代码做的截图相位探针显示：入口后约 100 ms 为淡入黑幕，约 500 ms 为背景/立绘，约 1.5 s 才出现台词，随后 position 已推进到下一条。也就是说，`story-entry` hash 对 capture 时刻敏感；不同运行中会分别捕捉黑幕、无台词立绘和有台词画面。当前运行状态仍稳定为 `sceneId=ch01_01`、`sceneHash=ab61dd2e`，素材 6/6，页面/控制台/请求错误 0。

本轮没有发现资产内容被替换成默认图、正式游戏场景/文案被修改或稳定状态下的视觉结构改变；但截图采样相位问题应在后续基线工具专项中修正，不能把单次 hash 不同直接当作视觉通过或视觉失败。

## 7. Git 工作树和提交边界

验收末尾执行：

```text
git status --short
```

结果仅为：

```text
?? SESSION-HANDOFF.md
?? USER.md
```

这两个文件明确排除，不属于 M2 纳入范围。没有其他 tracked modification、未跟踪源码、日志、截图、临时基线或 release 产物。

当前 HEAD：

`c612de93e2061192b000617d9cd0bd6bb13c7053`

与远端 `surdet/main` 的关系：

```text
git rev-list --left-right --count HEAD...surdet/main
21  0
```

含义是本地有 21 个尚未推送到远端的提交，远端没有领先提交；本轮依照授权没有推送。

## 8. 已知边界与后续审批事项

已知边界：

- M2 的直接 runtime integration 测试使用共享 `RenderLifecycle`，能得到完整的 ticker/listener/async 诊断；正式游戏仍使用旧 `PixiStage`/`AdvRenderer` 接线，因此其当前基线中的 `resources.tickerCallbacks/listeners/activeTweens/activeAsyncTasks` 仍可能为 legacy fallback 的 `null`。这不是伪造的“0”，而是明确表示正式 consumer 尚未做 M8 v2 runtime cutover。
- 正式游戏的 `main.ts` 没有在本轮迁移到 `createRendererRuntime()`，以避免越过 M2 范围改变宿主行为。迁移必须在后续批准的 consumer/cutover 计划中单独进行。
- 当前基线工具的端到端窗口调度尾部和视觉截图相位敏感性已经被复现；本报告给出原始样本和最小复现证据，未将其隐藏。

独立复审请重点确认：

1. Task 6–10 是否符合设计书规定的 owner、kind、generation、asset ownership 和输入边界。
2. C/F 两份独立基线的 schema、原始样本、统计方式和 M0 比较是否足以作为本轮性能证据。
3. 是否接受把端到端采样器的帧调度去抖/视觉稳定捕获列为后续专项，而不是在 M2 擅自修改阈值或正式游戏行为。
4. 在未收到明确批准前，执行 AI 不进入 M3，不推送远端。

**M2 交付状态：`WAITING_FOR_APPROVAL`。**
