# Renderer v2 M0 Delivery Report

日期：2026-08-09
项目：Surdet Renderer v2 Wave 2
当前里程碑：M0 Foundation / Baseline
执行状态：等待独立复审；未请求进入 M1

## Scope

### Plan tasks completed

- Task 1：将能力矩阵证据校验抽为可测试模块，修正已失效的证据路径，并把能力文档校验纳入根级文档门禁。
- Task 2：将重复的 P1/P2 验证接线收敛为单一 `verify:all` 编排器；`verify:p1p2` 保留为策略门禁加全量验证的兼容入口；CI 改为调用同一套门禁。
- Task 3：建立 Renderer 运行时基线契约、Electron/Playwright 基线采集器、资产/错误/资源/视觉证据记录，并提交 starter 基线 JSON。

### Explicitly deferred

- M1 RendererFacade API 与兼容适配层。
- M2 资源生命周期、输入路由、会话/场景资源注册与释放。
- M3–M7 的分层渲染、演出编排、菜单/战斗/地图/商店视图及切换。
- M8 cutover、宿主接线迁移、旧 `PixiStage` 移除和正式游戏回归切换。
- `particle`、`mov`、`tint` 等玩家能力、DSL、存档格式及游戏规则均未在本 M0 修改。

### Migration-blocking defects fixed

本里程碑没有开始 Renderer 架构迁移，因此没有声称修复任何迁移阻断缺陷。M0 只建立可复验的门禁和参考基线；生命周期、输入和兼容性风险保留给后续明确里程碑处理。

## Commits

以下为 M0 实现提交；交付报告另行以文档提交，且不包含用户内部文件。

| SHA | Message | Files / scope |
|---|---|---|
| `f13d6e1` | `fix(docs): verify capability evidence paths` | 能力矩阵校验模块、测试、证据路径与文档门禁 |
| `5ca017c` | `chore(ci): compose verification gates once` | `verify:all` 编排器、P1/P2 策略门禁、CI 接线与测试 |
| `c03b848` | `test(renderer): record Wave 2 runtime baseline` | Renderer 基线契约/测试、Electron 基线采集器、starter 基线 JSON |

## Contract Evidence

| Requirement | Test / file | Result |
|---|---|---|
| 能力矩阵证据路径必须真实存在 | `scripts/test/capability-matrix.test.mjs`、`scripts/lib/capability-matrix.mjs` | 2/2 通过；非法或不存在路径会被拒绝 |
| 文档能力校验必须进入常规门禁 | `package.json` 的 `verify:docs`、`scripts/render-capability-matrix.mjs` | 通过；矩阵渲染与校验共用同一验证模块 |
| 全量验证步骤不得重复定义 | `scripts/test/verify-all.test.mjs`、`scripts/verify-all.mjs` | 1/1 通过；步骤 ID 与命令签名唯一 |
| CI 与本地验证使用同一编排路径 | `.github/workflows/ci.yml`、`package.json` | CI 调用 `npm run verify:all`，策略检查单独调用 `verify:p1p2:policy` |
| Renderer 基线数据有稳定 schema | `packages/renderer/src/diagnostics/renderer-baseline.ts` | 提供 schema、指标汇总、样本校验和基线比较函数 |
| 基线采集不静默吞掉加载或页面错误 | `packages/shell/e2e/renderer-baseline.e2e.mjs` | 资产、页面错误、控制台错误和失败请求均记录；非零时失败 |
| 基线包含视觉锚点 | `docs/baselines/renderer-v2-cab200b.json` | title 与 story-entry 各有 viewport、SHA-256 视觉指纹 |
| 本 M0 不扩大到 M1/游戏改造 | 本次 3 个实现提交的精确路径审查 | 未包含 DSL、存档 schema、游戏规则或 M1+ 模块 |

## Commands Run

| Command | Exit code | Tests / summary |
|---|---:|---|
| `node --test scripts/test/capability-matrix.test.mjs` | 0 | 2 tests passed |
| `npm run verify:docs` | 0 | 能力矩阵测试与文档检查通过 |
| `node --test scripts/test/verify-all.test.mjs` | 0 | 1 test passed |
| `npm run verify:p1p2:policy` | 0 | P1/P2 必需路径策略检查通过 |
| `npm run build` | 0 | core、cli、renderer、host、shell、editor、starter 构建通过；仅有既有大 chunk 警告 |
| `npm test -w @surdet/renderer -- renderer-baseline.test.ts` | 0 | 1 test passed |
| `npm run typecheck -w @surdet/renderer` | 0 | Renderer TypeScript 检查通过 |
| `npm run e2e:renderer-baseline -w @surdet/shell -- --out docs/baselines/renderer-v2-cab200b.json` | 0 | 资产 6/6；页面错误、控制台错误、失败请求均为 0 |
| 基线 JSON schema / source identity 校验 | 0 | schemaVersion=1；样本、错误计数、source identity、视觉状态均存在 |
| `git diff --cached --check`（Task 3 提交前） | 0 | 无 whitespace error；仅有 Windows CRLF 转换提示 |
| `npm run verify:all` | 0 | 全部门禁通过；卫生 438 路径；CLI 86、core 298、editor 133、host 18、renderer 197、shell 32、starter 3 项测试通过；正式游戏 23/23 choice、3 endings、assets 44、运行时错误 0；编辑器/starter/正式游戏构建通过 |

上述命令中，TDD 过程先以缺失模块/编排器的红灯确认测试约束，再补实现并取得绿灯；没有跳过失败测试。

## Resource and Performance Comparison

M0 只记录参考基线，不进行优化前后差异宣称。以下数据来自 `docs/baselines/renderer-v2-cab200b.json`，采集环境为 Electron 43.2.0、Playwright 1.62.1、Node v24.15.0、Windows x64，构建模式为 `electron-dev-shell-starter`。

| Metric | Baseline | Current | Delta | Gate |
|---|---:|---:|---:|---|
| Cold start | 948.44 ms | — | — | 已记录；M1/M2 后才比较 |
| Asset ready | 991.95 ms | — | — | 已记录；M2 生命周期接入后才比较 |
| Menu open p95 | 11.10 ms | — | — | 已记录；后续视图层接入后才比较 |
| Scene transition p95 | 11.50 ms | — | — | 已记录；后续 facade/切换接入后才比较 |
| Active Blob URLs | 6 | — | — | 已观测；释放闭环延期 M2–M7 |
| Assets completed / failed | 6 / 0 | — | — | 基线采集通过 |
| Page / console / failed requests | 0 / 0 / 0 | — | — | 基线采集通过 |
| Renderer performance snapshot | unavailable (`null`) | — | — | starter 当前未暴露完整快照，不填假数据 |
| Ticker/listener/tween/async counters | unavailable (`null`) | — | — | 资源生命周期仪表盘延期 M2–M7 |

基线还记录了 `disposed=false`、`pooledObjects={}`、`displayObjectsByOwner={}`、Renderer 状态 `idle`，以及入口位置 `ch01_01 / pc=4`。这不是对后续释放行为的验收；释放契约必须在 M2–M7 实现后重新采集。

## Visual Evidence

| State | Result | Difference |
|---|---|---|
| `title` | viewport 1264×681，SHA-256 `aca617dcc09733b2282be67fbe3a15c984e91cfd610358d48d6ad4d1dacc8882` | M0 仅记录指纹，无历史对比 |
| `story-entry` | viewport 1264×681，SHA-256 `207426aaa12d01d8f0354ce6e507b7fe2434f11152f1d7631e4c48069eec38e2` | M0 仅记录指纹，无历史对比 |

基线采集器只在内存中计算截图 SHA-256，不把截图、日志或临时用户数据写入仓库。

## Git State

- Task 3 提交前的精确暂存路径仅为：
  - `docs/baselines/renderer-v2-cab200b.json`
  - `packages/renderer/src/diagnostics/renderer-baseline.ts`
  - `packages/renderer/src/index.ts`
  - `packages/renderer/test/diagnostics/renderer-baseline.test.ts`
  - `packages/shell/e2e/renderer-baseline.e2e.mjs`
  - `packages/shell/package.json`
- `USER.md`、`SESSION-HANDOFF.md` 明确未暂存、未提交。
- 报告提交前将再次执行 `git status --short`、`git rev-list --left-right --count HEAD...surdet/main` 和 staged name 检查；最终工作树状态以终检回报为准。
- 本次不执行 push；不执行 force push。
- 本报告不包含截图、日志、缓存、release 产物或临时文件。

## Known Risks

- 当前 baseline 是 starter 的 Electron dev-shell 参考测量，不是正式游戏发行包验收，也不等同于 M1+ 迁移后结果。
- `performance` 及 ticker/listener/tween/async 计数当前由 starter debug 面板以 unavailable/null 暴露；报告保留空值以避免伪造数据。
- bundle 记录了 6 条既有 “No file extension was found” 警告；本 M0 记录但不扩展范围修复。
- 基线的 `sourceSha` 为采集时工作树基准 `5ca017c2cdff15379e9fde73fef313581b0ed91a`，`sourceEquivalentTo` 为正式对照 `cab200b5aaed49b053b18ff05907aac4d02fb731`；后续比较必须重新声明采集源和环境。
- 资源释放、输入路由、宿主接线、旧渲染器切换和正式游戏回归仍未验收。

## Stop / Approval Request

状态：`WAITING_FOR_APPROVAL`

M0 已限定在能力证据门禁、CI 验证编排和 Renderer 运行时基线。现在停止工作，不启动 M1，不执行 Wave 2 其余里程碑，不推送远端。

请在独立复审完成后明确回复：**批准进入 M1**。在收到该批准前，不继续修改 Renderer v2 迁移代码。
