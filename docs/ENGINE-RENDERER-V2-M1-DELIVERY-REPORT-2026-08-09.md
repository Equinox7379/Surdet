# Surdet Renderer v2 Wave 2：M1 交付报告

日期：2026-08-09

项目：`E:\surdet`

里程碑：M1 — Public API and Compatibility Contract
当前状态：`WAITING_FOR_APPROVAL`

## 1. 结论

M1 Task 4→5 已按授权顺序完成，并在不改动 `PixiStage`、`AdvRenderer`、DSL、存档格式、游戏规则和编辑器行为的前提下，建立了 Renderer v2 的公开契约与一版兼容运行时。

本里程碑没有开始 M2，也没有进行 M3–M7 Layer 抽取或 M8 cutover。未推送远端，等待独立复审和下一轮明确批准。

## 2. 本次提交

| 阶段 | 提交 | 内容 |
| --- | --- | --- |
| Task 4 | `8db66f1bbf1116d3c64b5d6b923cf79f3ab86c6f` | 定义 Renderer v2 错误、输入、Commands、Queries、Runtime 公开契约 |
| Task 5 | `0812e699cfe95e0df6a95813cef7bc9d0baa54b5` | 通过 Facade 和兼容 Controller 组合现有 PixiStage/AdvRenderer/FrameScheduler |

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
- 查询返回副本或只读快照，不创建持久化 Pixi 对象、不修改可见状态；
- `createRendererRuntimeFromInternals()` 仅保留在相对模块中供 fake 测试使用，没有从包公共入口导出 Pixi 工厂或内部注入类型。

Task 5 测试覆盖：

- Runtime 构造与重复 dispose；
- 每个命令域至少一个代表性单次委托；
- presentation restore、resetSession 的状态委托；
- 诊断、表现、视觉和偏好查询纯度。

## 5. 验证证据

### 5.1 Renderer 聚焦门禁

| 命令 | 结果 |
| --- | --- |
| `npm test -w @surdet/renderer -- renderer-contract.test.ts renderer-runtime.test.ts query-purity.test.ts` | 4 tests passed |
| `npm test -w @surdet/renderer` | 28 files / 206 tests passed |
| `npm run typecheck -w @surdet/renderer` | PASS |
| `npm run build -w @surdet/renderer` | PASS |

### 5.2 根级全量门禁

`npm run verify:all` 以退出码 0 完成，包含：

- 工具测试 6/6；
- 能力矩阵检查通过；
- 报告提交前仓库卫生检查通过：451 个 tracked paths；报告纳入后最终检查为 452 个 tracked paths；
- 全 workspace typecheck 通过；
- workspace 测试通过：CLI 86、Core 298、Editor 133、Host 18、Renderer 206、Shell 32、Starter 3，共 776 tests；
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

M1 没有重新采集性能样本，也没有把未采样的数据宣称为性能改善或回归。对照依据是：本次只新增 API、Facade、兼容适配器和测试；`PixiStage`、`AdvRenderer`、正式游戏接线与行为未被修改，正式游戏全量验收仍保持上述 23/23、3 结局、44 资产和 0 运行时错误。M2 才负责正式生命周期/资源快照接管和新的性能采样责任。

## 7. 明确未实施范围

本次没有：

- 建立或迁移 `RenderLifecycle`、资源注册表、资源所有权和取消机制；
- 抽取 World/Dialogue/Menu/Gallery/SystemPanel 等 Layer；
- 将 `AdvRenderer` 状态机迁移为新 Controller 实现；
- 将宿主、编辑器或正式游戏切换到 v2 Runtime；
- 修改 DSL、存档格式、游戏规则、键位语义或编辑器行为；
- 修改 `PixiStage` 或 `AdvRenderer` 原文件；
- 推送远端。

## 8. Git 状态与下一步

报告提交前已确认工作树只保留两个既有用户未跟踪文件：

```text
?? SESSION-HANDOFF.md
?? USER.md
```

这两个文件不属于 M1，也不会提交。报告提交后仍应保持同样状态。

当前状态：`WAITING_FOR_APPROVAL`。请先进行独立复审；未经下一轮明确批准，不进入 M2，不推送远端。
