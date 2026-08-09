# Surdet Renderer v2 M7.5 最终限定整改报告

日期：2026-08-09
状态：`PERFORMANCE_REVIEW_REQUIRED`
结论：本轮证据链、统计语义和全量回归门禁已完成；正式 Renderer v3 性能门禁仍被 `sceneP95Ms` 阻断，因此不能宣称 M7.5 性能整改完成。

## 1. 范围与停止点

本轮严格从独立复审指定的起始 HEAD 开始：

```text
start HEAD = 7737ff75b9b52c723e8e135f1b613312f25f9afb
```

只处理以下三类 M7.5 阻断项：

1. v3 正式门禁改为按指标声明的 median/p95 统计量计算 `gateRatio`；
2. v3 候选 JSON 增加 raw、warmup、health、环境和历史 v2 证据的反向校验；
3. 对 `sceneP95Ms` 的计时闭区间和尾部行为做固定轮数、对称、只读诊断。

本轮没有修改 DSL、存档格式、编辑器行为、游戏规则、正式游戏脚本或任何无证据的性能实现；没有开始 M8，没有 push，也没有 force push。

受保护文件保持不触碰：

- `USER.md`
- `SESSION-HANDOFF.md`
- `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
- `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`

它们在整个工作树中继续保持既有未跟踪状态，未读取内容、修改、暂存、提交、删除、移动或推送。

## 2. 实施提交与实际文件

本轮源码、测试、候选证据和诊断工具已精确提交为：

```text
22b5de08c7900c2b0c57c5a62dcb828f5206804f
fix(renderer): enforce v3 baseline evidence gates
```

该提交实际纳入：

- `packages/renderer/src/diagnostics/renderer-baseline-v3.ts`
- `packages/renderer/test/diagnostics/renderer-baseline.test.ts`
- `packages/shell/e2e/renderer-baseline-v3-ab.e2e.mjs`
- `packages/shell/e2e/renderer-baseline-v3-artifact.mjs`
- `packages/shell/e2e/renderer-baseline-v3-rebuild.mjs`
- `packages/shell/e2e/renderer-baseline-v3-verify.mjs`
- `packages/shell/e2e/renderer-scene-diagnostic.mjs`
- `packages/shell/e2e/renderer-performance-static.mjs`
- `packages/shell/test/renderer-baseline-v3-artifact.test.mjs`
- `docs/baselines/renderer-v3-candidate-2026-08-09.json`
- `docs/baselines/renderer-v3-scene-diagnostic-2026-08-09.json`
- `docs/baselines/renderer-v3-performance-static-2026-08-09.json`

本报告文件将在上述聚焦提交之后单独提交；最终报告提交的完整 SHA 以本报告提交完成后的最终 Git 回报为准。

## 3. 正式门禁统计语义修复

旧实现把逐对 `current[i] / baseline[i]` 的中位数当作最终 `passed` 判据。这样会把交互指标真实的 p95 尾部退化隐藏在配对中位数之后。

修复后：

- `coldStartMs`：`current.median / baseline.median`，门限 `1.10`；
- `assetReadyMs`：`current.median / baseline.median`，门限 `1.10`；
- `menuOpenP95Ms`：`current.p95 / baseline.p95`，门限 `1.15`；
- `sceneP95Ms`：`current.p95 / baseline.p95`，门限 `1.15`。

候选中同时保留并明确命名：

- `gateRatio`：唯一正式门禁比率；
- `pairedRatios`：逐对诊断比率；
- `pairedMedianRatio`：逐对诊断比率的中位数，不参与 `passed`。

测试先行证据：在生产修复之前运行聚焦测试得到 19 项测试、13 项失败、6 项通过；失败覆盖了正式 gate 字段缺失、p95 尾部误判、边界语义和 raw/health/source/warmup/lockfile 篡改未被拒绝。修复后同一聚焦文件为 19/19 通过。

新增回归覆盖：

- 交互尾部显著退化但 paired median 仍为 1 时，正式 p95 gate 必须失败；
- 启动指标恰好 `1.10` 通过，超过后失败；
- 交互指标恰好 `1.15` 通过，超过后失败；
- 当前正式候选按 raw 重算后只保留 `sceneP95Ms` 正式失败。

## 4. v3 候选证据链与 artifact validator

`validateRendererBaselineV3()` 现在会拒绝：

- source SHA 与 run source 不一致；
- 非法或重复 warmup 角色；
- 缺少、删除、错位或重复 pair 的 `rawLaunches`；
- 未知角色、非法计时、非法资产计数或非空失败资产；
- `rawLaunches` 与 `baseline/current.metrics` 不一致；
- `warmups/rawLaunches` 与顶层 `health` 不一致；
- baseline/current 环境不同，尤其是 `packageLockSha256` 不一致；
- 统计字段与 raw 样本重算结果不一致；
- 完整历史比较字段缺失。

新增的独立 `renderer-baseline-v3-artifact.mjs` 会读取仓库中的确切 v2 文件，重新计算其 SHA-256、校验 v2 schema/sourceSha，并使用官方 v2 comparator 重新生成历史失败列表。它要求历史路径精确为：

```text
docs/baselines/renderer-v2-cab200b.json
```

因此无法通过清空 `historicalComparison.failures`、替换历史文件、替换历史 source SHA 或修改历史 hash 来伪造绿色结果。

artifact 篡改测试共 5 项，全部通过；纯 v3 validator 的恶意篡改回归覆盖 raw 计时、health、source SHA、warmup 角色、raw 删除、重复 pair、raw/metrics 不一致、executionOrder 交换、metrics-only 篡改和 lockfile mismatch。

## 5. 当前最终候选：离线重建结果

没有重新执行 20 对 A/B。使用已有最终候选中的全部 40 个正式 raw launch，使用新比较器和 validator 离线重建：

| 指标 | 正式统计量 | baseline | current | gateRatio | 门限 | 结果 | pairedMedianRatio（诊断） |
|---|---:|---:|---:|---:|---:|---|---:|
| coldStartMs | median | 1605.09845 | 1541.66660 | 0.9604810222 | 1.10 | PASS | 1.0113701500 |
| assetReadyMs | median | 1715.26780 | 1752.01100 | 1.0214212614 | 1.10 | PASS | 1.0121284335 |
| menuOpenP95Ms | p95 | 12.49500 | 12.92500 | 1.0344137655 | 1.15 | PASS | 1.0658327847 |
| sceneP95Ms | p95 | 40.66000 | 50.78000 | 1.2488932612 | 1.15 | **FAIL** | 1.0188919306 |

正式候选身份：

```text
baselineCommit = cab200b5aaed49b053b18ff05907aac4d02fb731
currentCommit  = 93b472bf20e351b53f151323d5080070427fd7f2
pairCount      = 20
warmups        = 2
formal rawLaunches = 40
health: assetsFailed=0, pageErrors=0, consoleErrors=0, failedRequests=0
```

完整 40 条 raw、全部字段、统计重算结果和 counterbalanced executionOrder 保存在：

[`docs/baselines/renderer-v3-candidate-2026-08-09.json`](../docs/baselines/renderer-v3-candidate-2026-08-09.json)

executionOrder 的固定规则是：奇数 pair 为 `baseline → current`，偶数 pair 为 `current → baseline`；文件保存了每一步的实际顺序，validator 会逐项重验，不能只看汇总值。

候选采样环境：

```text
Node       v24.15.0
npm        11.12.1
OS         win32 10.0.26220
platform   win32
arch       x64
CPU        AMD Ryzen 9 7940HX with Radeon Graphics
Electron   43.2.0
Playwright 1.62.1
buildMode  electron-dev-shell-starter
package-lock SHA-256
60a48410727eb3c536ad005459a6e3460bb9abf77e3bdd7d19c799429e273e8f
```

历史 v2 证据：

```text
path       docs/baselines/renderer-v2-cab200b.json
SHA-256    de0aa52bef955165213123eda9632d14456355828a15b2fe9f4cbb548d934edc
sourceSha  16416535b4d55b0311ba54b93d5819f862b29170
historical failures = coldStartMs, assetReadyMs, menuOpenP95Ms, sceneP95Ms
```

`historicalComparison` 的失败项没有被清空，且已经由 artifact validator 使用磁盘 v2 文件重新计算。

## 6. 第一套候选的保留与离线复算

第一套候选没有删除，仍可由提交 `03d96e82d01928549578797286dfe177d5835629` 读取。按新口径离线重算（未重新采样）：

```text
baselineCommit = cab200b5aaed49b053b18ff05907aac4d02fb731
currentCommit  = 6fa31f58a5cdd9bade4f528edba03fc02b1a530c
rawLaunches    = 40

coldStartMs     gateRatio=1.0099927549  PASS
assetReadyMs    gateRatio=1.0257989597  PASS
menuOpenP95Ms   gateRatio=1.3216814160  FAIL
sceneP95Ms      gateRatio=1.1794966010  FAIL
```

两套独立历史数据都显示场景 p95 超过 `1.15`；第二套虽然 menu 通过，但不能覆盖第一套 menu 失败，也不能用 paired median 代替 p95。

## 7. 场景计时闭区间与定向诊断

正式 `sceneP95Ms` 采用口径 A，并已在 runner 注释和诊断 artifact 中固定：

> 从 `titleSelect("new")` 开始，到命令完成并提交下一帧。

`position.sceneId` 的等待发生在正式 elapsed 捕获之后，只做健康确认，不进入 `sceneP95Ms`。本轮没有把旧 v2 指标换成新的闭区间，也没有修改门限。

固定诊断方案预先声明为 5 个 baseline + 5 个 current，共 10 个独立 Electron 启动；两边使用相同的 UI 暖机、相同的只读页面探针、独立临时 userData，并按 baseline/current 交错执行。原始诊断样本完整保存在：

[`docs/baselines/renderer-v3-scene-diagnostic-2026-08-09.json`](../docs/baselines/renderer-v3-scene-diagnostic-2026-08-09.json)

正式场景 elapsed raw：

```text
baseline: 36.0, 25.8, 26.1, 24.7, 22.4 ms
current:  25.4, 24.2, 25.0, 23.9, 22.3 ms
```

诊断汇总：

| 角色 | scene median | scene p95 | titleSelect median | position-ready p95 | command 后 position 等待 p95 | next-frame p95 |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 25.80 ms | 34.02 ms | 5.30 ms | 34.58 ms | 28.42 ms | 34.02 ms |
| current | 24.20 ms | 25.32 ms | 5.30 ms | 25.80 ms | 20.52 ms | 25.32 ms |

这批固定诊断没有复现正式 20 对候选的 scene 尾部回退，也没有发现可局部归因于 M7/M7.5 的性能代码原因。由于正式候选与第一套候选都保留 scene 红灯，且没有证据支持缓存、懒加载、阈值或其他盲目优化，本轮没有修改性能实现，最终状态必须保持 `PERFORMANCE_REVIEW_REQUIRED`。

诊断探针没有伪造 `loadClearRecord`、私有 `resetSession`、私有 `clearPresentation` 或 `interp.start` 的阶段耗时：正式游戏没有公开这些内部端口，外部只读探针只记录可观测的 `titleSelect`、position-ready 和 next-frame 边界，并在 artifact 中明确该限制。

## 8. M0→M7.5 静态 bundle 与入口检查

使用隔离 worktree 的 starter 主 bundle 做静态证据检查，完整结果在：

[`docs/baselines/renderer-v3-performance-static-2026-08-09.json`](../docs/baselines/renderer-v3-performance-static-2026-08-09.json)

| 版本 | SHA | starter 主 bundle 字节数 |
|---|---|---:|
| M0 / cab200b | `cab200b5aaed49b053b18ff05907aac4d02fb731` | 583,620 |
| M6 | `32375052f7b4bf68d2d97308a2bbca893916d5f9` | 618,400 |
| M7 | `12c539904ee2971f7190b8a25e846aa202c934ce` | 626,051 |
| 当前候选运行时源码 | `93b472bf20e351b53f151323d5080070427fd7f2` | 626,453 |

增量：

```text
M0 → 当前候选：+42,833 bytes
M6 → 当前候选： +8,053 bytes
M6 → M7：       +7,651 bytes
M7 → 当前候选：   +402 bytes
```

bundle 静态 token 检查结论：

- v3 诊断实现的 `summarizeRendererMetricV3`、`pairedMedianRatio`、`packageLockSha256`、`historicalComparison` 均未静态进入 starter 主 bundle；
- `__surdetDebug` 在 M0 和当前都存在，是既有 E2E/调试探针，不是本轮新增的 v3 统计代码；
- M7.5 的新增诊断工具是 Shell/仓库侧工具，不会被正式游戏入口加载。

## 9. 完整门禁结果

| 命令/检查 | 结果 |
|---|---|
| `npm test -w @surdet/renderer -- renderer-baseline.test.ts` | PASS，19/19 |
| `npm test -w @surdet/renderer -- presentation-controller.test.ts legacy-world-contract.test.ts` | PASS，2 文件/13 测试 |
| `npm run typecheck -w @surdet/renderer` | PASS |
| `npm run build -w @surdet/renderer` | PASS |
| `npm test -w @surdet/renderer` | PASS，44 文件/321 测试 |
| `npm test -w @surdet/shell -- renderer-baseline-v3-artifact.test.mjs` | PASS，5/5 |
| `npm test -w @surdet/shell` | PASS，7 文件/37 测试 |
| `npm run verify:renderer-boundaries` | PASS，3/3 |
| `npm test -w surdet-starter` | PASS，2 文件/3 测试 |
| `npm run verify:all` | PASS |
| `npm run e2e -w @surdet/shell` | PASS；存档回路、剧情推进和系统交互均通过 |
| `npm run lint -w zero-after-midnight` | PASS，11 场景/0 错误/0 警告 |
| `npm run simulate -w zero-after-midnight` | PASS，23/23 分支、3 结局、运行时错误 0 |
| `node examples/zero-after-midnight/scripts/check-assets.mjs` | PASS，44 项资产 |
| `npm run build -w zero-after-midnight` | PASS |
| `node packages/shell/e2e/renderer-baseline-v3-verify.mjs` | PASS；证据有效，但 formalFailures 保留 `sceneP95Ms` |
| `git diff --check` | PASS |

Starter HMR 测试在并行门禁的第一次单独运行中出现一次时序波动（导航计数 2/1），没有改动该测试或相关系统；随后根级 `verify:all`、单独 `npm test -w surdet-starter` 均重新通过 3/3，故将第一次失败保留为验证记录而不是隐去。

## 10. 冻结文件与 Git 状态

v2 冻结文件未修改：

```text
docs/baselines/renderer-v2-cab200b.json
SHA-256 = de0aa52bef955165213123eda9632d14456355828a15b2fe9f4cbb548d934edc
```

从起始 HEAD 到当前提交的受保护文件和 v2 冻结文件路径差异为空；工作树中这些文件仍仅是既有未跟踪文件：

```text
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

代码聚焦提交后复核：

```text
HEAD = 22b5de08c7900c2b0c57c5a62dcb828f5206804f
HEAD...surdet/main = 62 0
```

报告提交完成后，预期只会新增本报告文件；最终 HEAD、最终 `git status --short` 和最终 `git rev-list --left-right --count HEAD...surdet/main` 由最后交付回报再次现场复核。

## 11. 最终结论与停止

本轮已完成：

- 正式 median/p95 gateRatio 修正；
- raw/warmup/health/source/order/environment/lockfile 证据链校验；
- 历史 v2 artifact 交叉校验；
- 第一套与第二套候选的离线重算；
- 固定 5+5 场景只读诊断；
- M0/M6/M7/M7.5 bundle 和入口静态检查；
- Renderer、Shell、Starter、正式游戏和根级全量门禁。

但 `sceneP95Ms gateRatio=1.2488932612` 仍超过 `1.15`，而且没有足够证据支持安全的局部性能修改。因此：

```text
M7.5 = PERFORMANCE_REVIEW_REQUIRED
M8   = 未开始
push = 未执行
force push = 未执行
```

到此停止，等待总经理独立复审；未经新的明确批准，不进入 M8，不进行新的性能优化或正式消费者 cutover。
