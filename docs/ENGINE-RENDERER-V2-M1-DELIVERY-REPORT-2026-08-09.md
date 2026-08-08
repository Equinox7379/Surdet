# Surdet Renderer v2 Wave 2：M1 交付报告

日期：2026-08-09

项目：`E:\surdet`

里程碑：M1 — Public API and Compatibility Contract
当前状态：`WAITING_FOR_APPROVAL`

## 1. 结论

M1 Task 4→5 已按授权顺序完成，并在不改变 `PixiStage` 与 `AdvRenderer` 既有行为、DSL、存档格式、游戏规则和编辑器行为的前提下，建立了 Renderer v2 的公开契约与一版兼容运行时。

本里程碑没有开始 M2，也没有进行 M3–M7 Layer 抽取或 M8 cutover。未推送远端，等待独立复审和下一轮明确批准。

本次针对 M1 独立复审发现的表现事务阻断项完成定向整改：`runtime.commands.presentation.clear()` 现在会在同一个命令边界内清除 Controller 持有的时间轴和 Stage 表现状态；清理后下一帧不会重新投影旧 timeline cue。整改没有调用 `resetSession()`，不触碰对话、选择、自动、快进或 Backlog 状态。

## 2. 本次提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| Task 4 | `8db66f1bbf1116d3c64b5d6b923cf79f3ab86c6f` | 定义 Renderer v2 错误、输入、Commands、Queries、Runtime 公开契约 |
| Task 5 | `0812e699cfe95e0df6a95813cef7bc9d0baa54b5` | 通过 Facade 和兼容 Controller 组合现有 PixiStage/AdvRenderer/FrameScheduler |
| M1 整改 | `7261b25e97d1c30d1971da531efad577a003fad6` | 修复 presentation clear 的 Controller 时间轴清理、Stage 清理和事务回归测试 |

## 3. Task 4 交付内容

新增公开 API 模块：

- `packages/renderer/src/api/renderer-errors.ts`
- `packages/renderer/src/api/renderer-input.ts`
- `packages/renderer/src/api/renderer-commands.ts`
- `packages/renderer/src/api/renderer-queries.ts`
- `packages/renderer/src/api/renderer-runtime.ts`

契约包含：

- 9 个稳定命令域：`assets`、`world`、`dialogue`、`menu`、`gallery`、`system`、`loading`、`preferences`、`presentation`；
- 6 个稳定查询域：`world`、`dialogue`、`overlay`、`preferences`、`presentation`、`diagnostics`；
- `RendererError` / `RendererCommandError`，保留 `code`、`domain`、可选 `command` 与 `cause`；
- 精确的 `RendererInputAction` 判别联合；
- `RendererRuntime`、`RendererRuntimeOptions`、`PresentationController` 与会话重置契约；
- 现有视图模型的类型化命令参数，未在新 API 目录引入 `any`。

契约测试：

- `packages/renderer/test/api/renderer-contract.test.ts`
- 3 tests passed；Renderer typecheck passed。

## 4. Task 5 交付内容

新增：

- `packages/renderer/src/runtime/renderer-facade.ts`
- `packages/renderer/src/runtime/create-renderer-runtime.ts`
- `packages/renderer/test/integration/renderer-runtime.test.ts`
- `packages/renderer/test/api/query-purity.test.ts`

实现边界：

- `RendererFacade` 将各 v2 命令域逐一委托给现有 Stage 方法，不复制显示状态机；
- `LegacyPresentationControllerAdapter` 将现有 `AdvRenderer` 暂时适配为 M1 `PresentationController`，输入动作仍直接转发给现有方法，没有迁移输入控制逻辑；
- `createRendererRuntime()` 创建现有 `PixiStage`、`AdvRenderer`、`RenderPerformanceMonitor` 和 `FrameScheduler`，并返回一个 Runtime；
- `dispose()` 具备单一幂等门闩，顺序固定为 `scheduler → controller → stage`；
- `resetSession()` 委托现有 Controller 语义；
- `presentation.clear()` 通过窄的 Controller 清理入口删除活动时间轴，再清除 Stage 表现状态；不使用 `resetSession()`；
- 查询返回副本或只读快照，不创建持久化 Pixi 对象、不修改可见状态；
- `createRendererRuntimeFromInternals()` 仅保留在相对模块中供 fake 测试使用，没有从包公共入口导出 Pixi 工厂或内部注入类型。

Task 5 测试覆盖：

- Runtime 构造与重复 dispose；
- 每个命令域至少一个代表性单次委托；
- presentation restore、resetSession 的状态委托；
- presentation clear 的 Controller 时间轴清零、Stage 清零、下一帧不复活、重复 clear 幂等和清理后快照无旧时间轴；
- 诊断、表现、视觉和偏好查询纯度。

### 4.1 独立复审整改

复审阻断项的直接根因是旧实现只调用 `stage.clearPresentation()`，没有清除 `AdvRenderer` 的 `#timelineRuns`。本次只增加兼容期所需的窄协作：

- `AdvRenderer.clearPresentation()` 只调用既有时间轴清理路径并请求下一帧，不重置任何对话或输入状态；
- `LegacyPresentationControllerAdapter` 转发该窄入口；
- `RendererFacade` 在 `commands.presentation.clear()` 中先清 Controller 时间轴，再清 Stage 表现；
- `snapshot()`、`restore()` 和 `clear()` 继续共享完整表现事务边界，清理后快照的 `timelines` 为空；
- 没有实施 `RenderLifecycle`、`AsyncGeneration`、`RenderAssetRegistry`、输入迁移或任何 M2 内容。

## 5. 验证证据

### 5.1 Renderer 聚焦门禁

| 命令 | 结果 |
| --- | --- |
| `npm test -w @surdet/renderer -- renderer-contract.test.ts renderer-runtime.test.ts query-purity.test.ts` | 7 tests passed |
| `npm test -w @surdet/renderer -- adv-renderer.test.ts renderer-runtime.test.ts presentation-clear.test.ts` | 60 tests passed |
| `npm test -w @surdet/renderer` | 29 files / 208 tests passed |
| `npm run typecheck -w @surdet/renderer` | PASS |
| `npm run build -w @surdet/renderer` | PASS |

### 5.2 根级全量门禁

`npm run verify:all` 以退出码 0 完成，包含：

- 工具测试 6/6；
- 能力矩阵检查通过；
- 最终仓库卫生检查通过：453 个 tracked paths；
- 全 workspace typecheck 通过；
- workspace 测试通过：CLI 86、Core 298、Editor 133、Host 18、Renderer 208、Shell 32、Starter 3，共 778 tests；
- Starter lint 通过，0 errors / 0 warnings；
- Starter simulate 运行时错误 0；
- Editor、Starter、正式游戏构建全部通过；
- `git diff --check` 通过。

### 5.3 正式游戏验收

本次 `verify:all` 的正式游戏结果：

- 场景：11；
- choice 分支覆盖：23/23；
- 结局：3 个（`testimony_end`、`meeting_end`、`silence_end`）；
- 存档往返冒烟：39 次；
- 资产：44 项，`assets ok`；
- 运行时错误：0。

独立补跑：

```text
node packages/shell/scripts/verify-pack.mjs --artifact
[pack-check] PASS: app.asar 包含 8 项关键文件，身份与素材校验通过
```

## 6. M0 基线对照

沿用基线文件：`docs/baselines/renderer-v2-cab200b.json`。

- schema：2；
- 基线 source SHA：`16416535b4d55b0311ba54b93d5819f862b29170`；
- source-equivalent：`cab200b5aaed49b053b18ff05907aac4d02fb731`；
- 冷启动 5 样本，中位数 `891.8183 ms`；
- 资源就绪 5 样本，中位数 `948.0453 ms`；
- 菜单打开 p95 `10.8 ms`；
- 场景转场 p95 `25.6 ms`；
- 基线资源快照记录 6 个 Blob URL；
- 基线页面/控制台/失败请求错误均为 0。

本次 M1 整改按 M0 同一口径重新采集一次当前基线：先暖机 1 次，再用独立 Electron 启动和独立临时 `userData` 采集 5 次；冷启动/资源就绪使用中位数，菜单/场景使用 p95。原始当前基线写入本机临时路径 `C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v2-m1-current.json`，未作为机器相关产物提交。

| 指标 | M0 基线 | M1 当前 | 当前/M0 | 门槛 | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 冷启动中位数 | 891.8183 ms | 886.1402 ms | 0.9936× | 1.10× | PASS |
| 资源就绪中位数 | 948.0453 ms | 927.6518 ms | 0.9785× | 1.10× | PASS |
| 菜单打开 p95 | 10.8000 ms | 11.6000 ms | 1.0741× | 1.15× | PASS |
| 场景转场 p95 | 25.6000 ms | 27.1000 ms | 1.0586× | 1.15× | PASS |

4 个性能指标均保存 5 个原始样本；当前基线资产为 6/6，页面错误、控制台错误和失败请求均为 0。M1 没有提高门槛、删除性能字段或吞掉错误。

## 7. 明确未实施范围

本次没有：

- 建立或迁移 `RenderLifecycle`、`AsyncGeneration`、`RenderAssetRegistry`、资源所有权和取消机制；
- 抽取 World/Dialogue/Menu/Gallery/SystemPanel 等 Layer；
- 将 `AdvRenderer` 状态机迁移为新 Controller 实现；
- 迁移输入控制；
- 将宿主、编辑器或正式游戏切换到 v2 Runtime；
- 修改 DSL、存档格式、游戏规则、键位语义或编辑器行为；
- 修改 `PixiStage` 原文件或改变 `AdvRenderer` 既有行为；本次仅增加了窄的 `clearPresentation()` 兼容入口；
- 推送远端。

## 8. Git 状态与下一步

报告提交前已确认工作树只保留两个既有用户未跟踪文件：

```text
?? SESSION-HANDOFF.md
?? USER.md
```

这两个文件不属于 M1，也不会提交。报告提交后仍应保持同样状态。

当前状态：`WAITING_FOR_APPROVAL`。请先进行独立复审；未经下一轮明确批准，不进入 M2，不推送远端。
