# Surdet Renderer 性能测量体系资格化交付报告

**执行日期**：2026-08-10  
**协议**：`renderer-v4-qualification-2026-08-10`  
**Schema**：v4  
**任务性质**：测量体系资格化；不是 M9、不是生产性能优化、不是正式发行，也不是重新验收旧版正式 A/B。  
**最终状态**：`PERFORMANCE_MEASUREMENT_NOT_QUALIFIED`  
**工作状态**：`WAITING_FOR_REVIEW`

## 1. 结论摘要

本轮按冻结的阶段 0→8 方案完成了 Renderer v4 测量体系的诊断工具、构建等价性、Schema/比较器、Q1–Q5 holdout、全量门禁和临时 worktree 清理。五组正式资格 artifact 均能通过结构性 validator（`valid=true`），但五组资格状态均为 `not-qualified`：主指标的绝对对数比/p95 以及至少一项顺序层门均未满足预声明的重复性门槛。

因此，本轮不能宣称“性能全绿”、不能把 `pairedMedianRatio` 当作通过依据，也不能把旧版 v3 的失败改写为通过。测量体系当前只得到“证据完整、失败可复核、功能门禁通过，但资格门未通过”的结论。

本轮没有：

- 修改 Renderer 生产运行时代码、Runtime 行为、DSL、存档格式、游戏规则、编辑器行为或正式游戏资产；
- 重新执行旧版正式 v3 A/B，或覆盖任何既有 v3 artifact；
- 进行正式跨版本 A/B、electron-builder/加密包发行、M9 或远端 push。

## 2. 固定边界与版本事实

| 项目 | 固定值 |
| --- | --- |
| 本轮起始源码 HEAD | `f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59` |
| 旧角色提交 | `007438b569ec95350fdc9d7882ad49f55bbb7968` |
| 当前角色提交 | `f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59` |
| 报告创建前源码/证据 HEAD | `e5825add34addbcacc364e1920797e6efd79f87c` |
| 资格协议 ID | `renderer-v4-qualification-2026-08-10` |
| pairCount | 每组 20 对，正式 raw 恰好 40 条 |
| warmup | 每个角色 1 次，每组 artifact 共 2 条 |
| 顺序 | 奇数 pair baseline→current，偶数 pair current→baseline |
| 构建/运行环境 | Node v24.15.0、npm 11.12.1、Electron 43.2.0、Playwright 1.62.1、Windows 10.0.26220、x64 |
| package-lock SHA-256 | `60a48410727eb3c536ad005459a6e3460bb9abf77e3bdd7d19c799429e273e8f` |
| 临时根目录 | `C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-2`；另有两次失败尝试使用无后缀和 `-1` 根 |

预声明的 v4 主门：

- `median(abs(log(current / baseline))) <= log(1.10) = 0.09531017980432493`；
- `p95(abs(log(current / baseline))) <= log(1.25) = 0.22314355131420976`；
- 两个执行顺序层的中位数相对差不超过 10%；
- 角色交换和同根 Q5 必须满足相同的重复性约束；
- marker、健康、环境、构建、commit、pair 和 order 约束必须通过。

这些是测量重复性资格门，不是正式发行性能门；`pairedMedianRatio` 始终只作诊断字段。

## 3. 阶段完成与提交链

| 阶段 | 完成内容 | 主要证据/提交 |
| --- | --- | --- |
| 0 | 恢复、旧证据审计、持久化计划提交 | `593a902ee162e567679f80ea050a9d0e851c8095`；计划基线记录 `b6d23273d6b1e7d7c3caac4bc371d000fb7e9b14` |
| 1 | 启动/资源阶段诊断与唯一 source diff 插桩 | `d87bf06a17b0ecd4eb2226fdc4bd83f38f5b4bc4`；阶段记录 `85f64a15876ff2a5b43604e5c5cae5febb4e7977` |
| 2 | 同提交构建等价性工具与测试 | `b2513cae5be8a311edc0c8565a7eff4e2aeba17b`；阶段记录 `4c01a290723e41c8b11aa53cf50aa8874291da1c` |
| 3 | v4 Schema、比较器、验证器、统计规则和固定文件名冻结 | `62847272bbb941c34a4ce68508b98de6bb7fb925`；阶段记录 `f7b477efc716b25d02f466dcd771efb462861407` |
| 4 | Q 矩阵、独立 worktree、串行 runner 和清理 schema | `8fa4fcc58cc3536fe63bf3bd868872b062fe4e0a`；阶段记录 `2b0e537802e646915da8c467c8fac1d3d0c93de2` |
| 4 修补 | 仅修复直接阻断 runner 的路径、bundle 入口和旧 Starter 插桩兼容 | `d60dfce684170704fd4fd2e1e2b7cc849078fc5c`、`c98f7cef0733aeacb1b1fb7b452026fa53f9d5e4`、`b8f53e5c18a98815ed42239220cfa289aec6ee00` |
| 5 | Q1→Q5 holdout 完成，未改变协议/门限/样本数/文件名 | `6d6df999f4d9fe940306869193fe6c479e306087` |
| 6 | 全量门禁、正式游戏验收、证据归并；修正诊断扫描误报并保留失败日志 | `f13182f8e21a2ba9375927535c738ae0cc93946d`、`f3d728e127af8b88890beec2c3db1c826a5d200a`、`24e5b88f3b4b845a8351f4cab7eb01902976b218` |
| 7 | 精确清理本轮 13 个 worktree，保留历史 worktree 和全部证据 | `e8fc66512de8d5db9bff0694b374216708760ecf`；计划台账修正 `e5825add34addbcacc364e1920797e6efd79f87c` |
| 8 | 本报告；报告提交前的源码 HEAD 为 `e5825add34addbcacc364e1920797e6efd79f87c` | 本文档提交后以 `git rev-parse HEAD` 复核报告提交 SHA；本报告不自引用自身 commit SHA |

## 4. Q1–Q5 holdout 结果

### 4.1 完整性、健康和正式状态

五组均严格保存 2 条 warmup、40 条正式 raw；合计 10 条 warmup、200 条正式 raw。所有 raw 的资产状态均满足 `total>0`、`completed===total`、`failed===0`、`done===true`；每组健康计数均为资产失败 0、页面错误 0、控制台错误 0、失败请求 0。

| 组 | 角色/顺序 | warmup | formal raw | `valid` | 健康 | 资格状态 | 失败指标数 |
| --- | --- | ---: | ---: | --- | --- | --- | ---: |
| Q1 `q1-007-a-b` | 007 A=baseline、B=current | 2 | 40 | true | 通过 | `not-qualified` | 11 |
| Q2 `q2-007-b-a` | 007 B=baseline、A=current | 2 | 40 | true | 通过 | `not-qualified` | 10 |
| Q3 `q3-f7-a-b` | f7 A=baseline、B=current | 2 | 40 | true | 通过 | `not-qualified` | 10 |
| Q4 `q4-f7-b-a` | f7 B=baseline、A=current | 2 | 40 | true | 通过 | `not-qualified` | 8 |
| Q5 `q5-f7-same-root` | f7 同一构建根、独立 userData | 2 | 40 | true | 通过 | `not-qualified` | 11 |

固定 artifact：

- `docs/baselines/renderer-v4-q1-007-a-b-2026-08-10.json`
- `docs/baselines/renderer-v4-q2-007-b-a-2026-08-10.json`
- `docs/baselines/renderer-v4-q3-f7-a-b-2026-08-10.json`
- `docs/baselines/renderer-v4-q4-f7-b-a-2026-08-10.json`
- `docs/baselines/renderer-v4-q5-f7-same-root-2026-08-10.json`

每个 artifact 的 `rawLaunches` 均按执行顺序保存，未用统计排序覆盖 raw；每个 artifact 的 `reportSha256` 仍为 `not-generated`，因为本交付报告是独立文件，不把报告哈希伪装成采样时已存在的字段。

### 4.2 核心 v4 指标

下表为四个 v3-compatible 核心指标的 v4 paired 统计。格式为 `medianAbsLogRatio / p95AbsLogRatio`；门限分别为 0.09531017980432493 / 0.22314355131420976。数值直接来自官方 validator 重算结果，异常值保留在对应 raw 数组中。

| 组 | coldStartMs | assetReadyMs | menuOpenP95Ms | sceneP95Ms |
| --- | --- | --- | --- | --- |
| Q1 | 0.247583 / 0.306546 **FAIL** | 0.024887 / 0.271058 **FAIL** | 0.116365 / 0.638520 **FAIL** | 0.041533 / 0.338275 **FAIL** |
| Q2 | 0.074470 / 0.305125 **FAIL** | 0.048233 / 0.329878 **FAIL** | 0.299094 / 0.638252 **FAIL** | 0.084547 / 0.270038 **FAIL** |
| Q3 | 0.226912 / 0.410537 **FAIL** | 0.048550 / 0.176176 **PASS** | 0.261790 / 2.034063 **FAIL** | 0.123102 / 0.640473 **FAIL** |
| Q4 | 0.064569 / 0.299517 **FAIL** | 0.043085 / 0.288996 **FAIL** | 0.321841 / 0.975696 **FAIL** | 0.055318 / 0.156323 **PASS** |
| Q5 | 0.066660 / 0.310653 **FAIL** | 0.081249 / 0.304610 **FAIL** | 0.216417 / 2.360902 **FAIL** | 0.066644 / 0.224051 **FAIL** |

Q1–Q5 的 `groupGates` 均保持 `healthGate=true`、`buildEquivalenceGate=true`，但 `primaryMetricGate=false`、`passed=false`；至少一个指标的顺序层也导致 `orderBiasGate=false`。没有用 paired median 把这些失败覆盖为通过。

### 4.3 Q artifact SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `renderer-v4-q1-007-a-b-2026-08-10.json` | `6A92E21F11D45F534D0CA50800E3B6F689CC2870A9EA216E045CA9E0C97C9B44` |
| `renderer-v4-q2-007-b-a-2026-08-10.json` | `F64CC356AD7C5AD5A2C916AA4B23A8C4A9DC68E16918AB8EE26E90F26AE524C1` |
| `renderer-v4-q3-f7-a-b-2026-08-10.json` | `20E7C58890AE4FD22FC16419B34F4332B4F3F0A7CF69C1824DB6DAAC34577B2A` |
| `renderer-v4-q4-f7-b-a-2026-08-10.json` | `4AD04969D67378EE5CBAB3DF9F6D7E2F744D3558435785AA619324D897FEDA2D` |
| `renderer-v4-q5-f7-same-root-2026-08-10.json` | `EEEC84A622F89D837A68EF42ACB0F7792193F57FB7AA294031D07F103A9A3A71` |

## 5. 启动/资源阶段诊断

本轮将 host 时间、page marker、资源完成、稳定帧和交互阶段分开保存，没有把资源时序冒充为脚本执行耗时。

### 5.1 插桩边界

- 插桩只对临时 worktree 中的 `examples/starter/src/main.ts` 产生一个统一 source diff；主工作树没有该文件改动。
- 插桩脚本：`packages/shell/e2e/renderer-startup-diagnostic-instrumentation.mjs`。
- instrumentation script SHA-256：`8be4360bce834fb1db595a23aa27e615df8094912ecc64097a20f47c3fccd715`。
- 每个角色的 instrumentation diff SHA-256 与 full diff SHA-256：`d4125e7a7e8d6752086197e06078cba066c003d110e0fd55fae549e92b4f4ea2`。
- `onlyUnifiedInstrumentationDiff=true`，插桩前 clean，插桩后只有 `examples/starter/src/main.ts`。

### 5.2 可观察层级

- 每个 raw 都保存 host launch、首窗口、debug、asset done、进程关闭 marker，以及 page navigation、runtime create、asset load、字体可用性、title 和 stable frame marker。
- 所有 Q 组代表性 raw 的 `assetLoading` 均为 6/6、failed 0、done true；页面/控制台/失败请求数组均为空。
- 代表性 raw 的 `PerformanceResourceTiming.count=0`，因此本轮没有把 `resourceTiming` 空集解释成脚本耗时或资产耗时；它作为可用性事实保留。
- observer lag 并非恒定为零，代表性样本可见 0ms、约 282.95ms、约 321.64ms 等值；该层噪声没有被删除。
- 菜单样例中 command synchronous 部分约 0.7–1.1ms，command→next RAF 约 6–10ms，通常没有错过 16.67ms 帧预算。
- 场景样例中 command synchronous 部分约 5.0–5.7ms，但 command→next RAF 可达 20–40ms，`missedFrame=true`；这解释了为什么 scene p95 比同步命令本身更容易出现尾延迟，但不是对生产热点的因果证明。
- Q3/Q4 的 host `debug→asset done` 汇总呈现明显角色/观测层不对称：例如 Q3 baseline median 约 79.99ms、current median 约 377.04ms；Q4 baseline median 约 39.82ms、current median 约 350.85ms，而 page asset-load 仍约 80–88ms。该事实支持“host/observer 边界需要后续独立诊断”，不能直接推出 Renderer 生产代码退化。

本轮因此没有进行无证据缓存、懒加载、阈值调高或生产代码优化；当前结论是测量体系有完整分层证据，但性能资格未关闭。

## 6. 同提交构建等价性

旧 007 的 Q1/Q2 和 f7 的 Q3/Q4/Q5 都使用全新 clean worktree、相同 `npm ci --ignore-scripts --no-audit --no-fund`、相同 `npm run build`、相同锁文件和工具版本。每个比较包含 shell/starter dist 共 59 个文件，mtime 不参与比较；每个比较的 `equivalent=true`、`differences=[]`、`qualified=true`。

构建入口的可审计事实：

- 007 角色 Starter entry：`examples/starter/dist/assets/index-15Xa0GkV.js`，626,453 bytes，SHA-256 `a4a24f2e75180b06253ab4235be85b7febcd203586b2b723a62bfdc57c351681`。
- f7 角色 Starter entry：`examples/starter/dist/assets/index-DHPtvLtg.js`，656,088 bytes，SHA-256 `e4619ea700cf5ed9d6bbe600df5bb6a39e92290298c524172259a365537b53f3`。
- 两个提交之间 entry 增量为 29,635 bytes（约 4.73%）；这是跨提交源码/构建产物差异，不是同提交构建不等价，也不能单独作为性能因果结论。
- 两个 build batch 的 package-lock SHA、Node/npm/Electron/Playwright、Windows/CPU 均一致。

证据文件：

- `docs/baselines/renderer-v4-build-equivalence-007-2026-08-10.json`
- `docs/baselines/renderer-v4-build-equivalence-f7-2026-08-10.json`

对应 SHA-256：

- 007 batch：`DF49622F65EDCBC416F3270282012BCB9C08A0FECEA46254435B86A361BD77B2`
- f7 batch：`EAFDBD7EA5D28C938FDDBB597CC340E3D7816951F8AD17536D45D8E3B51ED263`

## 7. holdout 前失败与失败保留

在第一份正式 Q holdout 数据产生前，runner 依次遇到并原样记录了三类执行器阻断：

1. 仓库根目录与临时 worktree 根目录等值时，安全路径校验错误拒绝；
2. 旧 Starter bundle 使用相对 `./assets/` 入口时，build collector 解析错误；
3. 冻结的 007 Starter 入口没有新版本 `createRendererRuntime`，统一插桩器初始版本拒绝继续。

这些失败均明确 `qHoldoutDataStarted=false`，未混入 Q1–Q5 正式统计；修复只作用于诊断/执行器，不改变生产 Renderer、Starter 游戏逻辑或冻结协议。原始证据：

- `docs/baselines/renderer-v4-qualification-runner-failure-2026-08-10.json`
- `docs/baselines/renderer-v4-qualification-cleanup-build-collector-failure-2026-08-10.json`
- `docs/baselines/renderer-v4-qualification-runner-failure-instrumentation-2026-08-10.json`
- `docs/baselines/renderer-v4-qualification-cleanup-instrumentation-failure-2026-08-10.json`

这些文件没有被删除、覆盖或改写成成功记录。

## 8. 门禁与正式游戏验收

以下均使用已保存日志，未在报告阶段重复启动实验：

| 门禁 | 结果 |
| --- | --- |
| Renderer v4 聚焦测试 | 4 files / 47 passed |
| Renderer 全量测试 | 46 files / 325 passed |
| Shell 全量测试 | 12 files / 98 passed |
| `verify:renderer-boundaries` | 3/3 tests + scanner passed |
| `verify:renderer-legacy` | 4/4 tests + scanner passed |
| `verify:tools` | 10/10 passed，包含 verify-all 实际路径、能力矩阵、唯一性和 shell:false 检查 |
| `npm run verify:all` | 退出码 0；实际覆盖 types、tests、docs、hygiene、formal、editor/starter/formal build、diff-check |
| Renderer v2 视觉验收 | 17 个语义候选状态；资源 6/6；page/console/request errors 0；保留候选截图/manifest/contact sheet |
| Shell Electron E2E | steps=55、choices=41、saved=true、loaded=true、final=awaiting-choice、scene=ch01_01 |
| 《零点之后》 lint | 11 scenes，0 errors，0 warnings |
| 《零点之后》 simulate | 23/23 分支、3 个结局、运行时错误 0；save/load 冒烟 39 次 |
| 《零点之后》资产 | 44 项 |
| 《零点之后》 typecheck/build | 通过 |
| `git diff --check` | 通过 |

主要日志：

- `docs/baselines/renderer-v4-stage6-v4-tests-final-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-verifier-corrected-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-renderer-test-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-shell-test-final-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-boundaries-final-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-legacy-corrected-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-verify-tools-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-verify-all-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-e2e-renderer-v2-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-e2e-shell-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-zero-lint-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-zero-simulate-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-zero-assets-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-zero-typecheck-2026-08-10.log`
- `docs/baselines/renderer-v4-stage6-zero-build-2026-08-10.log`

第一次 verifier 输出捕获 wrapper 的 PowerShell 重定向错误也保留在 `renderer-v4-stage6-verifier-wrapper-failure-2026-08-10.log`；之后的 corrected capture 显示五个官方 verifier 进程均 `valid=true`、`not-qualified`。

## 9. 旧 v3 红灯未被覆盖

本轮没有重跑旧 v3 正式 A/B，也没有修改旧 artifact。机器读取的历史事实仍为：

- `docs/baselines/renderer-v3-control-current-2026-08-10.json`：`assetReadyMs gateRatio=1.2785676947778022`，`pairedMedianRatio=1.0409841376129845`，失败；
- `docs/baselines/renderer-v3-candidate-2026-08-09.json`：`sceneP95Ms gateRatio=1.2488932611978962`，旧 v3 1.15 门限失败；
- 旧 artifact 中的 `sceneP95Ms` 红灯没有被 v4 的重复性统计覆盖；v4 `not-qualified` 也没有被解释为旧 v3 通过。

旧文件 SHA-256（用于证明没有被本轮覆盖）：

- v3 candidate：`61EF931C07FA74A4890CE5A80607685954B99EC31C3040B4CA1A2CAFF2C2A90E`
- v3 control-current：`ACE8A8425EF1A5F973465A9CC129FDCF69864F5181BB35FD583C85650A930B7F`

## 10. 实际纳入的文件范围

相对本轮起始 HEAD `f7f4522...`，主工作树的提交范围为 51 个文件、约 70,310 行新增、1 行删除。纳入内容按职责分组如下。

### 10.1 诊断/比较器/runner 源码

- `packages/shell/e2e/renderer-startup-diagnostic-instrumentation.mjs`
- `packages/shell/e2e/renderer-startup-diagnostic-runner.mjs`
- `packages/shell/e2e/renderer-startup-diagnostic.mjs`
- `packages/shell/e2e/renderer-build-equivalence.mjs`
- `packages/shell/e2e/renderer-baseline-v4.mjs`
- `packages/shell/e2e/renderer-baseline-v4-artifact.mjs`
- `packages/shell/e2e/renderer-baseline-v4-verify.mjs`
- `packages/shell/e2e/renderer-v4-worktree.mjs`
- `packages/shell/e2e/renderer-v4-qualification-runner.mjs`

### 10.2 测试与根级工具接线

- `packages/shell/test/renderer-startup-diagnostic.test.mjs`
- `packages/shell/test/renderer-build-equivalence.test.mjs`
- `packages/shell/test/renderer-baseline-v4-comparison.test.mjs`
- `packages/shell/test/renderer-v4-qualification-matrix.test.mjs`
- `scripts/test/renderer-v4-qualification.test.mjs`
- `scripts/test/renderer-legacy-usage.test.mjs`（仅新增诊断入口误报回归）
- `package.json`（仅加入资格化工具测试实际执行路径）

### 10.3 协议、计划、artifact 和日志

- `docs/superpowers/specs/2026-08-10-renderer-performance-measurement-v4-protocol.md`
- `docs/superpowers/plans/2026-08-10-renderer-performance-measurement-qualification.md`
- 五个 Q1–Q5 JSON、两个 build equivalence JSON、三个 cleanup/failure 记录和阶段 6 门禁日志；完整路径见本报告前述章节及 `git diff --name-status f7f4522..HEAD`。

主工作树中没有 `packages/renderer/src/**`、`examples/starter/src/**`、`examples/zero-after-midnight/src/**`、`packages/editor/src/**` 或 `packages/cli/src/**` 的生产/游戏源代码改动。Starter 插桩只存在于已删除的临时 worktree，且每个角色的唯一 source diff 已由 artifact 记录。

## 11. 本轮 worktree 精确清理

阶段 7 清理前 Git 列表共 23 个注册 worktree：主工作树、9 个历史 M7/M8 worktree，以及本轮资格化 13 个 worktree。历史 worktree 没有删除。

已按 Git 返回的精确绝对路径逐个执行 `git worktree remove --force` 的 13 条路径：

```text
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10\q1-007-a-b-a
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10\q1-007-a-b-b
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-1\q1-007-a-b-a
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-1\q1-007-a-b-b
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-2\q1-007-a-b-a
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-2\q1-007-a-b-b
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-2\q2-007-b-a-a
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-2\q2-007-b-a-b
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-2\q3-f7-a-b-a
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-2\q3-f7-a-b-b
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-2\q4-f7-b-a-a
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-2\q4-f7-b-a-b
C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10-2\q5-f7-same-root
```

随后执行 `git worktree prune`。清理后仍保留主工作树和 9 个历史 M7/M8 worktree；三个本轮资格根目录在 Git 返回列表中的注册数量均为 0。没有使用通配符、`Remove-Item -Recurse` 或其他宽泛删除。

清理证据：

- `docs/baselines/renderer-v4-qualification-cleanup-2026-08-10.json`：最终 Q 矩阵 9 条路径均 `removed=true`、`cleaned=true`；SHA-256 `DBFDC383A73DC96B6D1183B612C60AA2694F22E14A1CBF07367F59ADD0F68894`。
- `docs/baselines/renderer-v4-qualification-cleanup-final-2026-08-10.json`：汇总本轮 13 条实际路径；`worktreeCount=13`、`postCleanupRegisteredWorktreesUnderRoots=0`；SHA-256 `3E30D2203C7D5DFC4C9D3506CBE634B99E0D33E9AAF38C7D0C6B2018EFD28D56`。

## 12. 与计划/仓库事实的差异及保守处理

1. 任务书所要求的固定根目录在执行前已经存在，因此没有覆盖，而是使用了 `-2` 编号根；早期 `无后缀` 和 `-1` 根是两次 holdout 前失败尝试。三根目录均在最后逐条验证并清理，失败 JSON 不删除。
2. Q artifact 的 raw 记录中 launcher 侧 npm 字段有 `unknown`，构建 manifest 侧记录了实际 npm 11.12.1；没有用记忆补写 raw 字段，保留两层事实。
3. 代表性 page `PerformanceResourceTiming` 计数为 0；没有把不可见的资源时序填成 0ms 脚本耗时，也没有把它当作健康失败。资源完成健康由显式 6/6 assetLoading 字段独立判定。
4. 冻结协议列出了 Q1/Q2、Q3/Q4 的角色交换漂移门；当前 artifact 的公开 `v4` 结构按单组保存 `phaseMetrics`、`paired`、`orderStrata` 和 `groupGates`，没有另列跨 Q 组 `roleSwap` 汇总字段。该边界没有被隐藏：本报告不把角色交换实验宣称为额外通过证据，最终资格仍保守判定为 `not-qualified`。若后续要把跨组漂移变成机器门，必须另行审查并保持本轮 holdout 原始数据不变。
5. 三次 holdout 前执行器失败没有计入 Q 统计，也没有通过重跑到绿色来抹掉；其 `qHoldoutDataStarted=false` 证据单独保留。

## 13. 受保护文件、Git 状态与远端状态

以下四个文件未修改、未暂存、未提交、未删除、未移动：

- `SESSION-HANDOFF.md`
- `USER.md`
- `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
- `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`

报告创建前最后一次只读复核：

```text
HEAD = e5825add34addbcacc364e1920797e6efd79f87c
git rev-list --left-right --count HEAD...surdet/main = 19 0
git diff --check = passed
git status --short =
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

报告提交本身是文档提交，不改变上述源码资格结论；交付回报中会再次读取真实最终 `HEAD`、`status` 和 `HEAD...surdet/main`，避免报告自引用自身提交 SHA。

## 14. 最终授权状态

```text
PERFORMANCE_MEASUREMENT_NOT_QUALIFIED
WAITING_FOR_REVIEW

push=false
forcePush=false
release=false
m9Started=false
oldFormalV3ABRerun=false
```

本报告只交付资格化证据和失败边界，不构成独立复审通过、性能优化批准、M9 开始或正式发行批准。下一步必须等待独立复审及新的明确计划。
