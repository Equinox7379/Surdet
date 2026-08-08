# Renderer v2 M0 Delivery Report

日期：2026-08-09
项目：Surdet Renderer v2 Wave 2
当前里程碑：M0 Foundation / Baseline
执行状态：M0 整改完成，等待再次独立复审；未请求进入 M1

## Scope

### Plan tasks completed

- Task 1：将能力矩阵证据校验抽为可测试模块，修正已失效的证据路径，并把能力文档校验纳入根级文档门禁。
- Task 2：将重复的 P1/P2 验证接线收敛为单一 `verify:all` 编排器；`verify:p1p2` 保留为策略门禁加全量验证的兼容入口；CI 改为调用同一套门禁。
- Task 3：建立 Renderer 运行时基线契约、Electron/Playwright 基线采集器、资产/错误/资源/视觉证据记录，并提交 starter 基线 JSON。
- M0 整改 1：正式基线先执行 1 次独立 Electron 暖机，再执行 5 次独立 Electron + 独立临时 userData 采样；四项指标保留完整原始样本、median、p95，并按指标声明顶层统计口径。
- M0 整改 2：`sourceEquivalentTo` 改为可选、显式、完整 40 位 SHA 参数；默认不写字段。
- M0 整改 3：根级工具测试收敛到 `verify:tools`，由 `verify:all` 只调用一次；能力矩阵测试、`verify-all` 唯一性/shell 测试和 CLI 参数测试均不与昂贵命令重复执行。

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
| `ca4a084` | `fix(renderer): correct M0 baseline sampling` | 五样本统计/schema、参数化 source equivalence、根级工具测试接线 |
| `1641653` | `fix(renderer): warm up baseline menu probes` | 每个独立正式进程丢弃一次菜单首投影冷路径后再计量 |
| `3cf71b7` | `test(renderer): refresh M0 baseline artifact` | schema v2 正式 M0 基线与全部原始样本 |

## Contract Evidence

| Requirement | Test / file | Result |
|---|---|---|
| 能力矩阵证据路径必须真实存在 | `scripts/test/capability-matrix.test.mjs`、`scripts/lib/capability-matrix.mjs` | 2/2 通过；非法或不存在路径会被拒绝 |
| 文档能力校验必须进入常规门禁 | `package.json` 的 `verify:docs`、`scripts/render-capability-matrix.mjs` | 通过；矩阵渲染与校验共用同一验证模块 |
| 全量验证步骤不得重复定义 | `scripts/test/verify-all.test.mjs`、`scripts/verify-all.mjs` | 2/2 通过；步骤 ID、命令签名唯一且工具步骤存在 |
| CI 与本地验证使用同一编排路径 | `.github/workflows/ci.yml`、`package.json` | CI 调用 `npm run verify:all`，策略检查单独调用 `verify:p1p2:policy` |
| Renderer 基线数据有稳定 schema | `packages/renderer/src/diagnostics/renderer-baseline.ts` | 提供 schema、指标汇总、样本校验和基线比较函数 |
| 基线采集不静默吞掉加载或页面错误 | `packages/shell/e2e/renderer-baseline.e2e.mjs` | 资产、页面错误、控制台错误和失败请求均记录；非零时失败 |
| 基线包含视觉锚点 | `docs/baselines/renderer-v2-cab200b.json` | title 与 story-entry 各有 viewport、SHA-256 视觉指纹 |
| 本 M0 不扩大到 M1/游戏改造 | 本次 3 个实现提交的精确路径审查 | 未包含 DSL、存档 schema、游戏规则或 M1+ 模块 |
| 启动/资源就绪不得只有一个样本 | `packages/shell/e2e/renderer-baseline.e2e.mjs`、正式 JSON | 1 次独立暖机 + 5 次独立 Electron/userData；两个指标均保存 5 个原始样本，顶层使用 median |
| 菜单/场景使用 p95 | `renderer-baseline.ts`、正式 JSON | `summaryStatistic=p95`；顶层使用 5 个独立样本的 p95 |
| 基线 schema 与统计必须可验证 | `renderer-baseline.test.ts` | 3/3 通过；schemaVersion=2、最少 5 样本、median/p95 与顶层选择均有断言 |
| 等价源参数必须显式且为完整 SHA | `renderer-baseline-options.test.mjs`、`renderer-baseline-options.mjs` | 2/2 通过；默认省略字段，非法长度/字符拒绝 |
| 工具测试进入 verify-all/CI 且不重复 | `package.json`、`scripts/verify-all.mjs`、`.github/workflows/ci.yml` | `verify:all` 单次调用 `verify:tools`；CI 调用 `verify:all`；昂贵命令仍各执行一次 |
| spawn 不触发 shell/DEP0190 | `scripts/test/verify-all.test.mjs`、`scripts/verify-all.mjs` | 2/2 通过；注入验证确认 `shell:false` |

## Commands Run

| Command | Exit code | Tests / summary |
|---|---:|---|
| `npm run verify:docs` | 0 | 生成能力矩阵与当前文档一致 |
| `node --test scripts/test/capability-matrix.test.mjs` | 0 | 2 tests passed |
| `node --test scripts/test/verify-all.test.mjs` | 0 | 2 tests passed |
| `node --test scripts/test/renderer-baseline-options.test.mjs` | 0 | 2 tests passed |
| `npm run verify:tools` | 0 | 6 tests passed；能力矩阵、唯一性/shell、参数校验各只执行一次 |
| `npm run verify:p1p2:policy` | 0 | P1/P2 必需路径策略检查通过 |
| `npm run build` | 0 | core、cli、renderer、host、shell、editor、starter 构建通过；仅有既有大 chunk 警告 |
| `npm test -w @surdet/renderer -- renderer-baseline.test.ts` | 0 | 1 test passed |
| `npm run typecheck -w @surdet/renderer` | 0 | Renderer TypeScript 检查通过 |
| `npm run e2e:renderer-baseline -w @surdet/shell -- --out docs/baselines/renderer-v2-cab200b.json` | 0 | 资产 6/6；页面错误、控制台错误、失败请求均为 0 |
| `npm run e2e:renderer-baseline -w @surdet/shell -- --out docs/baselines/renderer-v2-cab200b.json --source-equivalent-to cab200b5aaed49b053b18ff05907aac4d02fb731` | 0 | 暖机 1 次；独立正式启动 5 次；资产 6/6；页面/控制台/请求错误均为 0 |
| 基线 JSON schema / source identity 校验 | 0 | schemaVersion=2；四项指标各 5 个原始样本；sourceEquivalentTo 仅由正式命令写入 |
| 第二次独立临时基线比较 | 0 | 默认未写 sourceEquivalentTo；cold 1.028657、asset 1.016784、menu 1.037037、scene 0.984375，均未越过 10%/15% |
| `git diff --cached --check`（Task 3 提交前） | 0 | 无 whitespace error；仅有 Windows CRLF 转换提示 |
| `npm run verify:all` | 0 | 工具测试 6/6；卫生 441 路径；CLI 86、core 298、editor 133、host 18、renderer 199、shell 32、starter 3 项测试通过；正式游戏 23/23 choice、3 endings、assets 44、运行时错误 0；编辑器/starter/正式游戏构建通过 |

上述命令中，TDD 过程先以缺失模块/编排器的红灯确认测试约束，再补实现并取得绿灯；没有跳过失败测试。

## Resource and Performance Comparison

M0 只记录参考基线，不进行 Renderer 架构优化前后差异宣称。以下数据来自 `docs/baselines/renderer-v2-cab200b.json`，采集环境为 Electron 43.2.0、Playwright 1.62.1、Node v24.15.0、Windows x64，构建模式为 `electron-dev-shell-starter`。正式命令包含 `--source-equivalent-to cab200b5aaed49b053b18ff05907aac4d02fb731`。

| Metric | Baseline | Current | Delta | Gate |
|---|---:|---:|---:|---|
| Cold start | 891.82 ms（median） | — | — | 5 个独立启动原始样本；M1/M2 后才比较 |
| Asset ready | 948.05 ms（median） | — | — | 5 个独立启动原始样本；M2 生命周期接入后才比较 |
| Menu open p95 | 10.80 ms | — | — | 5 个独立样本 p95；后续视图层接入后才比较 |
| Scene transition p95 | 25.60 ms | — | — | 5 个独立样本 p95；后续 facade/切换接入后才比较 |
| Active Blob URLs | 6 | — | — | 已观测；释放闭环延期 M2–M7 |
| Assets completed / failed | 6 / 0 | — | — | 基线采集通过 |
| Page / console / failed requests | 0 / 0 / 0 | — | — | 基线采集通过 |
| Renderer performance snapshot | unavailable (`null`) | — | — | starter 当前未暴露完整快照，不填假数据 |
| Ticker/listener/tween/async counters | unavailable (`null`) | — | — | 资源生命周期仪表盘延期 M2–M7 |

正式基线原始样本如下：

- `coldStartMs`：`[870.3513, 885.2670, 891.8183, 905.9821, 983.1940]`；median `891.8183`；p95 `983.1940`。
- `assetReadyMs`：`[926.0295, 932.9379, 948.0453, 1232.3428, 1359.3785]`；median `948.0453`；p95 `1359.3785`。
- `menuOpenP95Ms`：`[0.8000, 5.7000, 9.2000, 9.3000, 10.8000]`；median `9.2000`；p95 `10.8000`。
- `sceneP95Ms`：`[21.5000, 23.3000, 24.0000, 24.9000, 25.6000]`；median `24.0000`；p95 `25.6000`。

基线还记录了 `disposed=false`、`pooledObjects={}`、`displayObjectsByOwner={}`、Renderer 状态 `idle`，以及入口位置 `ch01_01 / pc=4`。这不是对后续释放行为的验收；释放契约必须在 M2–M7 实现后重新采集。

## Visual Evidence

| State | Result | Difference |
|---|---|---|
| `title` | viewport 1264×681，SHA-256 `aca617dcc09733b2282be67fbe3a15c984e91cfd610358d48d6ad4d1dacc8882` | M0 仅记录指纹，无历史对比 |
| `story-entry` | viewport 1264×681，SHA-256 `b064926a4b0cd5249a2c2dced12508b7661bdf99ab510590b3c429b9c04cf238` | M0 仅记录指纹，无历史对比 |

基线采集器只在内存中计算截图 SHA-256，不把截图、日志或临时用户数据写入仓库。

## Git State

- Task 3 提交前的精确暂存路径仅为：
  - `docs/baselines/renderer-v2-cab200b.json`
  - `packages/renderer/src/diagnostics/renderer-baseline.ts`
  - `packages/renderer/src/index.ts`
  - `packages/renderer/test/diagnostics/renderer-baseline.test.ts`
  - `packages/shell/e2e/renderer-baseline.e2e.mjs`
  - `packages/shell/package.json`
- 整改提交的新增/修改路径仅限 M0 基线、工具门禁与测试；未改 `.github/workflows/ci.yml`，因为 CI 已经直接调用包含 `verify:tools` 的 `npm run verify:all`。
- `USER.md`、`SESSION-HANDOFF.md` 明确未暂存、未提交。
- 报告提交前将再次执行 `git status --short`、`git rev-list --left-right --count HEAD...surdet/main` 和 staged name 检查；最终工作树状态以终检回报为准。
- 本次不执行 push；不执行 force push。
- 本报告不包含截图、日志、缓存、release 产物或临时文件。

## Known Risks

- 当前 baseline 是 starter 的 Electron dev-shell 参考测量，不是正式游戏发行包验收，也不等同于 M1+ 迁移后结果。
- `performance` 及 ticker/listener/tween/async 计数当前由 starter debug 面板以 unavailable/null 暴露；报告保留空值以避免伪造数据。
- bundle 记录了 6 条既有 “No file extension was found” 警告；本 M0 记录但不扩展范围修复。
- 正式基线的 `sourceSha` 为 `16416535b4d55b0311ba54b93d5819f862b29170`，`sourceEquivalentTo` 为正式命令显式声明的 `cab200b5aaed49b053b18ff05907aac4d02fb731`；不带参数的第二次临时基线没有该字段。
- 首轮整改复验曾发现菜单 p95 从 1.60ms 波动至 21.70ms，超过 15% 门槛；采样器加入每个独立正式进程的一次菜单冷路径丢弃后，第二轮比较降为 1.037037 倍并通过。该首轮失败没有被隐藏或改变门槛。
- 资源释放、输入路由、宿主接线、旧渲染器切换和正式游戏回归仍未验收。

## Stop / Approval Request

状态：`WAITING_FOR_APPROVAL`

M0 已限定在能力证据门禁、CI 验证编排和 Renderer 运行时基线整改。现在停止工作，不启动 M1，不执行 Wave 2 其余里程碑，不推送远端。

请在独立复审完成后明确回复：**批准进入 M1**。在收到该批准前，不继续修改 Renderer v2 迁移代码。
