# Surdet Renderer 性能测量体系资格化执行计划

> 状态：阶段 3 已完成；下一入口为阶段 4（构造 Q1–Q5 worktree 与 runner）。
>
> 本计划是 2026-08-10 性能测量体系资格化阶段的唯一施工入口。它不构成 M9，不构成生产性能优化，不构成正式发行批准，也不重新验收任何旧版正式 A/B。

## 全局约束

- 本轮唯一目标是回答“现有 Renderer 性能测量体系能否被资格化，以及旧版失败发生在哪一层”，不是让任何性能指标变绿。
- 只允许按阶段 0→1→2→3→4→5→6→7→8 顺序执行；前一阶段未记录证据、提交哈希和下一阶段入口，不进入后一阶段。
- 阶段 0 先提交本计划；阶段 3 在任何 Q1–Q5 holdout 数据产生前冻结候选协议、Schema、统计规则、门限和固定输出文件名。
- 第一份 Q1–Q5 正式 holdout 数据产生后，不得修改候选协议、统计规则、门限、主指标、样本数、暖机次数、轮次顺序或输出文件名。
- 所有失败样本、异常值、不可用字段和构建差异原样保留；不得挑选通过轮次、删除异常值、降低样本数、提高门限、删除字段或用事后统计口径覆盖失败。
- 不修改生产 Renderer API、Runtime 行为、Starter 游戏逻辑、DSL、存档格式、游戏规则、编辑器行为或正式游戏资产。
- 不运行旧版正式 A/B，不重建或覆盖既有 v3 artifact，不更新冻结的 v3 红灯。
- 本轮不执行 electron-builder、加密包重新发行、正式跨版本 A/B、M9、force push 或任何远端 push。
- 不修改、暂存、提交、删除、移动以下文件：
  - `SESSION-HANDOFF.md`
  - `USER.md`
  - `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
  - `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`
- 上下文自动压缩或会话恢复后，必须先重新读取本计划、`git status --short`、`git log --oneline --decorate -12`，核对已完成阶段和下一阶段入口；完成前不得写代码、创建 worktree 或启动实验。
- 每完成一个阶段，先更新本计划中的状态、证据路径、提交哈希、工作树状态和下一阶段入口，再提交；不得把进度只保存在聊天上下文中。
- 若任务书与仓库事实冲突，记录差异并采用更保守、可审计的处理；不擅自扩大范围。

## 恢复时的当前事实（阶段 0 开始前只读核对）

- 主工作树：`E:\surdet`
- 起始 HEAD：`f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59`
- `surdet/main`：同为 `f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59`
- 起始工作树：只存在四个受保护未跟踪文件，不能触碰。
- 任务书指定的本计划文件在恢复核对时不存在，属于“规范要求与磁盘不一致”；本提交补齐它，之后才允许任何实现工作。
- 旧 v3 冻结基线必须保留：
  - M7.5 baseline：`007438b569ec95350fdc9d7882ad49f55bbb7968`
  - 当前旧 v3 candidate/control 对照曾使用：`db12cb02083c64e750527283ada2aceb10d30597`
  - 旧正式 v3 candidate：`docs/baselines/renderer-v3-candidate-2026-08-09.json`
  - 旧同提交控制：`docs/baselines/renderer-v3-control-baseline-2026-08-10.json`、`docs/baselines/renderer-v3-control-current-2026-08-10.json`
  - 旧 v3 正式红灯必须在最终报告中原样重述：`assetReadyMs` 的 `gateRatio=1.2785676947778022`，`pairedMedianRatio=1.0409841376129845`；并保留 `sceneP95Ms` 的历史失败事实。

## 冻结的候选 v4 协议

以下内容在阶段 3 提交前必须落入代码、Schema、测试和文档；阶段 5 产生第一份 Q 数据后不再改变。

### 版本、提交与工作树

- 候选协议 ID：`renderer-v4-qualification-2026-08-10`
- Schema 版本：`4`
- 旧角色版本：`007438b569ec95350fdc9d7882ad49f55bbb7968`
- 当前角色版本：`f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59`
- 每一个 Q 组都必须使用从这两个精确提交创建的全新、干净、独立 Git worktree；不得复用旧 worktree、当前主工作树或上一组 worktree。
- 固定临时根目录：`<local-path>`。
- 若该根目录已存在，不覆盖它；使用一个明确编号的新根目录，并在计划和报告中记录实际根目录。
- 工作树必须在插桩前干净；插桩后只允许存在一个由统一诊断脚本生成的精确 tracked source diff。
- 所有运行均使用同一份 `package-lock.json`、同一 Node/npm/Electron/Playwright、同一构建命令和同一 Windows 主机；每次 Electron 启动使用独立临时 `userData`。
- Electron 进程不得并行启动；每个样本结束后关闭进程并清理其 userData 临时目录。

### Q 组、顺序与样本

固定执行顺序为 Q1→Q2→Q3→Q4→Q5，组内不跳过、不重排：

| 组 | baseline 角色 | current 角色 | 构建根目录关系 | 启动顺序 |
| --- | --- | --- | --- | --- |
| Q1 | `007438b…` worktree A | `007438b…` worktree B | 同提交、不同物理 worktree | 奇数 baseline→current，偶数 current→baseline |
| Q2 | `007438b…` worktree B | `007438b…` worktree A | 交换 Q1 角色，禁止复用 Q1 目录 | 奇数 baseline→current，偶数 current→baseline |
| Q3 | `f7f4522…` worktree A | `f7f4522…` worktree B | 同提交、不同物理 worktree | 奇数 baseline→current，偶数 current→baseline |
| Q4 | `f7f4522…` worktree B | `f7f4522…` worktree A | 交换 Q3 角色，禁止复用 Q3 目录 | 奇数 baseline→current，偶数 current→baseline |
| Q5 | `f7f4522…` 同一干净构建根 | 同一干净构建根 | 同一物理构建根，独立 Electron/userData | 奇数 baseline→current，偶数 current→baseline |

- 每组每个角色先暖机 1 次；暖机不进入正式统计但必须完整写入 artifact。
- 每组 `pairCount=20`，正式 raw launch 数量恰好为 40；每个 pair 恰好两个角色。
- 奇数 pair 的顺序为 baseline→current，偶数 pair 的顺序为 current→baseline；`executionOrder` 必须逐项记录并由 validator 重算。
- 所有 40 个正式 raw launch、2 个 warmup、每个失败和每个不完整样本都必须保留；runner 在失败时退出非零，但先写入可审计的失败 artifact 或失败清单。
- 不允许通过重复某一 Q 组、重跑到绿色、筛选运行轮次或替换协议来修复失败。

### 诊断时间戳与指标

诊断只在独立 test/diagnostic worktree 中通过统一探针注入，不增加正式 Runtime API。不可观测字段写成 `available=false` 并附非空 `reason`，禁止填零或凭记忆伪造。

Host 侧必须尝试记录：

- `hostLaunchStartedAt`
- `electronLaunchResolvedAt`
- `firstWindowResolvedAt`
- `debugObservedAt`
- `assetDoneObservedAt`
- `processCloseCompletedAt`

Page 侧必须尝试记录：

- navigation start 与 `performance.timeOrigin`
- `starterModuleStartedAt`
- `runtimeCreateStartedAt`
- `runtimeCreateCompletedAt`
- `debugPublishedAt`
- `assetLoadStartedAt`
- `assetLoadCompletedAt`
- `fontsReadyAt`（如字体没有独立阶段则必须明确 `available=false`）
- `titleReadyAt`
- `firstStableFrameAt`

每个 raw launch 必须同时保存原始 marker、marker 的时钟来源、推导的非负 duration 和不可用原因。固定的推导指标为：

- Host：launch→first window、first window→debug、debug→asset done、process close duration。
- Page：navigation→debug、runtime create、asset load、font ready、debug→asset done、asset done→stable frame。
- 旧 v3 兼容观测：`coldStartMs`、`assetReadyMs`、`menuOpenP95Ms`、`sceneP95Ms`，只用于诊断历史口径，不覆盖旧 artifact。
- 菜单/场景的阶段诊断：命令同步耗时、投影/提交耗时、命令完成到下一 `requestAnimationFrame` 的等待、是否错过预先声明的 16.67ms 帧预算。
- `PerformanceResourceTiming` 摘要：数量、类型/协议/传输大小等可用字段的稳定汇总；不得把资源时序伪装成脚本耗时。

### 候选 Schema 的固定形状

阶段 3 必须以 validator 和测试落实下列顶层结构；字段名和语义在首个 Q artifact 后冻结：

```json
{
  "schemaVersion": 4,
  "artifactKind": "renderer-performance-qualification",
  "protocolId": "renderer-v4-qualification-2026-08-10",
  "sampledAt": "ISO-8601",
  "rebuiltAt": "ISO-8601",
  "group": "q1-007-a-b | q2-007-b-a | q3-f7-a-b | q4-f7-b-a | q5-f7-same-root",
  "baselineCommit": "40位SHA",
  "currentCommit": "40位SHA",
  "roles": { "baseline": { "root", "commit", "role" }, "current": { "root", "commit", "role" } },
  "pairCount": 20,
  "warmupCountPerRole": 1,
  "warmups": [],
  "executionOrder": [],
  "environment": { "baseline": {}, "current": {}, "differences": [] },
  "buildManifest": { "baseline": {}, "current": {}, "sameCommitEquivalent": true },
  "rawLaunches": [],
  "v3Compatible": { "baseline": {}, "current": {}, "comparison": {} },
  "v4": { "phaseMetrics": {}, "paired": {}, "orderStrata": {}, "groupGates": {} },
  "health": {},
  "failures": [],
  "qualification": { "valid": true, "status": "candidate-qualified | not-qualified", "reasons": [] },
  "reportSha256": "64位SHA或明确未生成"
}
```

每个 raw launch 的 `assetLoading` 必须满足 `total>0`、`completed===total`、`failed===0`、`done===true` 才能被标记为健康；validator 必须拒绝任一不满足的样本。`errors.page`、`errors.console`、`errors.failedRequests` 必须是数组，不能吞掉异常。

### 冻结统计规则与门限

- 所有 raw 数组按执行顺序保存，统计前复制后排序，绝不原地重排 raw。
- 中位数使用偶数样本中间两项平均值；p95 使用线性插值 `(n-1)*0.95`，与 v3 的 percentile 定义明确分开记录。
- 旧 v3 兼容汇总继续采用：cold/asset median，menu/scene p95；其正式 `gateRatio` 只作为历史诊断，不能成为 v4 资格门。
- v4 主指标是每个 phase/interaction 的逐 pair 对数比绝对值：`abs(log(current / baseline))`；baseline 为 0 时按显式零值规则处理，非法/负数/NaN/Infinity 一律失败，不删除。
- 每个强制 phase/interaction 指标必须同时报告 paired absolute log-ratio 的 median 和 p95；`pairedMedianRatio` 只能作为诊断字段，不能单独决定资格。
- v4 测量体系资格的预声明主门限：
  - `median(abs(log ratio)) <= log(1.10)`；
  - `p95(abs(log ratio)) <= log(1.25)`；
  - baseline-first 与 current-first 两个 order strata 的中位数相对差不超过 10%；
  - Q1/Q2 与 Q3/Q4 的角色互换中位 log-ratio 漂移不超过 `log(1.10)`；
  - Q5 同一构建根的角色对称性必须满足同一主门限；
  - 所有强制 marker、健康、环境、构建 manifest、pair/order/commit 约束必须通过。
- 上述 10%/25% 是“测量重复性资格”门限，不是旧 v3 的 1.10/1.15 性能回归门限；不得把它们描述为正式发行阈值，也不得用它们改写旧 v3 红灯。
- page-local phase 只用于归因和证明 host 噪声是否能与真实 asset/runtime 阶段分离；若必需 page-local marker 不可用，资格失败并写明缺失层，不以 host 汇总替代。
- 同提交 Q1/Q2/Q3/Q4 和同构建 Q5 是资格主证据；跨提交的旧 baseline→当前比较只保留为历史/诊断，不作本轮“性能全绿”结论。

## 阶段计划

### 阶段 0：恢复、审计旧证据、提交本计划

- [x] 重新读取本计划路径并确认任务书要求的计划缺失。
- [x] 核对 HEAD、`surdet/main`、受保护工作树和最近提交历史。
- [x] 只读审计旧 v3 validator、runner、artifact、控制 artifact 和旧正式红灯。
- [x] 写入本计划，执行 `git diff --check`，确认四个受保护文件仍未变化。
- [x] 创建本地提交：`docs(perf): freeze renderer measurement qualification plan`，SHA：`593a902ee162e567679f80ea050a9d0e851c8095`。
- [x] 下一入口：阶段 1；阶段 0 完成前没有创建 worktree、写诊断代码或产生 Q 数据。

阶段 0 证据：计划文件自身、起始 `git status --short`、起始 HEAD 和旧 artifact 路径。

### 阶段 1：先写测试，再实现启动/资源阶段诊断

目标是解释“同提交 v3 control 的 assetReady 汇总失败而配对中位数接近 1”的层级，不改变生产代码。

实际路径：

- `packages/shell/e2e/renderer-startup-diagnostic-instrumentation.mjs`
- `packages/shell/e2e/renderer-startup-diagnostic-runner.mjs`
- `packages/shell/e2e/renderer-startup-diagnostic.mjs`
- `packages/shell/test/renderer-startup-diagnostic.test.mjs`

执行要求：

- 先为 dirty worktree、非唯一 source diff、diff-check 失败、缺 marker、负值/NaN、错误时间来源、未清理临时目录等情况写失败测试。
- 探针只对 `examples/starter/src/main.ts` 或实际等价启动入口做机械、可复现的单文件插桩；记录 original commit、instrumentation script SHA、instrumentation diff SHA、完整 diff SHA、changed paths、lockfile SHA、Node/OS/arch。
- `fullDiffSha256` 必须等于唯一 source diff 的 SHA；禁止 Layer/Pixi/生产 API/可写 Runtime 状态被探针暴露。
- Host/page marker 和资源摘要在诊断结果中原样保存；marker 不可用时写原因。
- 不在主工作树编译诊断，不把探针改动留在主工作树，不产生新的 Q artifact。

阶段 1 已完成：

- [x] 先写失败测试：实现不存在时测试因模块缺失失败。
- [x] 实现统一启动/资源插桩、快照验证、诊断 runner 和 Electron 诊断入口。
- [x] 9 个阶段 1 测试通过；Shell typecheck、三份诊断脚本 `node --check`、`git diff --check` 通过。
- [x] 插桩测试证明只产生 `examples/starter/src/main.ts` 唯一 source diff，并记录 instrumentation/full diff SHA；没有生成 Q 数据、没有创建资格 worktree、没有修改主工作树生产入口。
- [x] 阶段 1 聚焦提交：`test(shell): add startup resource diagnostics`，SHA：`d87bf06a17b0ecd4eb2226fdc4bd83f38f5b4bc4`。
- [x] 下一入口：阶段 2（同提交构建等价性）；阶段 2 完成前不得创建 Q1–Q5 holdout 数据。

### 阶段 2：同提交构建等价性工具与测试

实际路径：

- `packages/shell/e2e/renderer-build-equivalence.mjs`
- `packages/shell/test/renderer-build-equivalence.test.mjs`
- `docs/baselines/renderer-v4-build-equivalence-007-2026-08-10.json`
- `docs/baselines/renderer-v4-build-equivalence-f7-2026-08-10.json`

要求：

- 测试先行覆盖 dirty worktree、错误 commit、lockfile SHA 不同、工具版本不同、缺 dist、manifest 缺文件、大小/SHA 不同、静态入口 SHA 不同、mtime 不参与比较和 clean 等价。
- 对同一提交的两个全新 worktree 执行相同 `npm ci --ignore-scripts --no-audit --no-fund` 与 `npm run build`；比较 `packages/shell/dist` 和 `examples/starter/dist` 的相对路径、文件大小、SHA-256、bundle entry SHA；不比较 mtime。
- 如同提交 manifest 不等，立即标记 current candidate NOT QUALIFIED，保存完整差异，停止后续控制；不复制 dist、不人为修复构建产物。
- 同时记录 package-lock 字节 SHA、Node/npm/Electron/Playwright、Windows/CPU、build command、commit、root、dirty 状态。

阶段 2 已完成：

- [x] 先写构建等价性测试；实现不存在时测试因模块缺失失败。
- [x] 实现 `collectBuildManifest`、`validateBuildManifest`、`compareBuildManifests` 和显式 CLI artifact 入口。
- [x] 12 个阶段 2 测试通过；阶段 1+2 聚焦测试 21/21、`node --check` 和 `git diff --check` 通过。
- [x] manifest 比较涵盖 shell/starter dist 全部相对路径、大小、SHA-256、bundle entry、lockfile、工具版本、OS/CPU；不使用 mtime。
- [x] 真实同提交双 worktree build 尚未执行，保留到阶段 4 的 Q 矩阵构造前；因此没有产生新的资格数据或 build artifact。
- [x] 阶段 2 聚焦提交：`test(shell): add build equivalence evidence`，SHA：`b2513cae5be8a311edc0c8565a7eff4e2aeba17b`。
- [x] 下一入口：阶段 3；在阶段 3 协议提交前不得执行 Q1–Q5。

### 阶段 3：冻结 v4 Schema、比较器、验证器与判断矩阵

在此阶段提交后，才允许第一次 Q1 holdout 启动。

实际路径：

- `packages/shell/e2e/renderer-baseline-v4.mjs`
- `packages/shell/e2e/renderer-baseline-v4-artifact.mjs`
- `packages/shell/e2e/renderer-baseline-v4-verify.mjs`
- `packages/shell/test/renderer-baseline-v4-artifact.test.mjs`
- `packages/shell/test/renderer-baseline-v4-comparison.test.mjs`
- `scripts/test/renderer-v4-qualification.test.mjs`
- `docs/superpowers/specs/2026-08-10-renderer-performance-measurement-v4-protocol.md`

测试先行必须覆盖：

- Schema/version/protocol ID、40 位提交 SHA、64 位 SHA-256、合法 ISO 时间、pair/warmup 数量与顺序、角色交换、Q 组名称；
- raw marker、duration、unavailable reason、asset 完成状态、页面/控制台/请求错误、NaN/Infinity/负数；
- build manifest、environment、lockfile、worktree root、source/instrumentation/full diff SHA；
- raw→summary→paired/order strata→failures 的可重算一致性；篡改 summary、paired、failure、v3 兼容字段必须被拒绝；
- 正式固定 artifact 路径、无参数、未知参数、路径越界、非零退出码和 `shell:false`；
- 不把 `pairedMedianRatio` 当主门，不把 v4 qualification status 改写为旧 v3 formal pass；
- 失败样本全部保留，validator 不会因健康失败吞掉 raw。

创建候选冻结提交：`test(renderer): freeze v4 measurement protocol`。提交后只允许修复直接失败测试或实现阻断缺陷；不得改协议语义。

阶段 3 已完成：

- [x] v4 Schema、协议规格、统计规则、主门限、Q1–Q5 矩阵和固定输出文件名已提交并冻结。
- [x] 先写失败测试；实现不存在时 v4 专项测试因模块缺失失败。
- [x] v4 Shell 专项 20/20；阶段 1+2 专项 21/21；根级 `verify:tools` 10/10；Shell typecheck、`node --check`、`git diff --check` 通过。
- [x] validator 会重算 raw→v3Compatible/v4/health/qualification，并拒绝 Schema、commit-role、pair/order、asset health、marker、NaN/负数、summary/paired/failure 篡改。
- [x] `pairedMedianRatio` 明确为诊断字段；v4 主门使用 paired absolute log-ratio median/p95、order strata、健康和构建等价性。
- [x] 阶段 3 聚焦提交：`test(renderer): freeze v4 measurement protocol`，SHA：`62847272bbb941c34a4ce68508b98de6bb7fb925`。
- [x] 阶段 3 提交前未生成 Q1–Q5 数据；下一入口为阶段 4。

### 阶段 4：构造五组新 worktree、构建和资格执行清单

实际路径：

- `packages/shell/e2e/renderer-v4-qualification-runner.mjs`
- `packages/shell/e2e/renderer-v4-worktree.mjs`
- `packages/shell/test/renderer-v4-qualification-matrix.test.mjs`
- `docs/baselines/renderer-v4-qualification-cleanup-2026-08-10.json`

要求：

- 测试先行验证 Q1→Q5 的 exact group/commit/role/order matrix、Q5 同根、每组新目录、禁止 reuse、禁止主工作树、禁止 protected file、clean/removed manifest。
- 固定每组根目录、worktree 精确绝对路径、commit、role、创建时间、阶段、artifact path、dirty 状态和删除状态；每个 worktree 只由当前 runner 管理。
- 任何构建等价性失败都写入 cleanup manifest 和诊断报告，立即停止后续 Q；不得复制或覆盖 dist。
- 阶段 4 提交包含 runner、matrix、cleanup schema 和 tests，但不包含任何 Q1–Q5 raw 数据。

### 阶段 5：按冻结协议产生 Q1→Q5 holdout 数据

- [ ] 运行前重新读取本计划、HEAD、status、log，确认阶段 3/4 提交已存在且 protocol/schema/threshold/file names 未变。
- [ ] 执行 Q1；完整保存 warmups/raw/health/errors/build/evidence。
- [ ] 只在 Q1 artifact 写完并校验后执行 Q2；依次执行 Q3、Q4、Q5。
- [ ] 每组均使用两次独立 warmup、20 对、40 raw、counterbalanced 顺序、独立 Electron/userData、非并行启动。
- [ ] 每组都执行官方 v4 validator；失败也保存 raw、failure summary、退出码和原因。
- [ ] 产生的固定 artifact：
  - `docs/baselines/renderer-v4-q1-007-a-b-2026-08-10.json`
  - `docs/baselines/renderer-v4-q2-007-b-a-2026-08-10.json`
  - `docs/baselines/renderer-v4-q3-f7-a-b-2026-08-10.json`
  - `docs/baselines/renderer-v4-q4-f7-b-a-2026-08-10.json`
  - `docs/baselines/renderer-v4-q5-f7-same-root-2026-08-10.json`
- [ ] 任何一组失败后不重跑该组，不修改协议，不跳过剩余组；按照任务书允许的顺序完成预定组，最终如实判断 NOT QUALIFIED。
- [ ] 阶段完成后更新本计划并提交；下一入口为阶段 6。

### 阶段 6：全量门禁和证据归并

按固定顺序执行并保存输出：

- v4 diagnostics、artifact、verifier、startup instrumentation、build equivalence、qualification matrix 测试；
- `npm test -w @surdet/renderer`；
- `npm test -w @surdet/shell`；
- `npm run verify:renderer-boundaries`；
- `npm run verify:renderer-legacy`；
- `npm run verify:tools`；
- `npm run verify:all`；
- `npm run e2e:renderer-v2 -w @surdet/shell`；
- `npm run e2e -w @surdet/shell`；
- 《零点之后》 lint、simulate、44 项资产检查、typecheck/build；
- 23/23 分支、3 个结局、运行时错误 0；
- `git diff --check`。

本阶段禁止 electron-builder、pack、正式 A/B、发行和 push。旧 v3 红灯必须由机器重新读取旧 artifact 证明未被覆盖，而不是重跑旧实验。

### 阶段 7：只清理本轮新 worktree

- 先读取 `git worktree list --porcelain`，只从 Git 返回值获得精确绝对路径。
- 规范化验证每条路径位于本轮实际临时根目录内；不得使用通配符，不得使用宽泛递归删除，不得触碰主工作树和历史 worktree。
- 对本轮每条精确路径执行 `git worktree remove --force <path>`，随后执行 `git worktree prune`。
- 再次列出 worktree，确认本轮根目录消失；所有 artifact、探针脚本、build manifest、cleanup manifest 保留在主仓库。
- 更新 `renderer-v4-qualification-cleanup-2026-08-10.json`，包含 path/commit/role/createdAt/stage/artifact/dirty/removed/cleaned。

### 阶段 8：最终报告、链接/哈希校验、聚焦提交并停止

最终报告必须最后创建，固定路径：

`docs/ENGINE-RENDERER-PERFORMANCE-MEASUREMENT-QUALIFICATION-REPORT-2026-08-10.md`

报告必须包括：

- 任务边界、起始 HEAD、阶段提交链、最终 HEAD；
- 与仓库事实的差异及保守处理；
- 旧 v3 `assetReadyMs` / `sceneP95Ms` 红灯的机器可复核证据，明确未被覆盖；
- 启动/资源阶段根因诊断：host/page marker、资源 timing、observer lag、build/OS/host/page 分层；
- 007 与 f7 的同会话 Q1–Q5 完整 raw 路径、warmup、summary、paired/order strata、失败样本和正式 v4 判断；
- build equivalence 结果、instrumentation diff SHA/full diff SHA、清理 manifest；
- Renderer/Shell/Starter/Editor/CLI 相关测试、边界/legacy、verify:tools、verify:all、Renderer v2 E2E、Shell E2E、正式游戏 23/23、3 结局、44 资产、运行时错误 0；
- `git diff --check`、`git status --short`、`git rev-list --left-right --count HEAD...surdet/main`；
- 实际纳入和排除文件，四个保护文件仍只以未跟踪形式存在；
- 最终状态只能是以下两者之一：
  - 全部资格条件通过：`PERFORMANCE_MEASUREMENT_CANDIDATE_QUALIFIED`；
  - 任一条件失败：`PERFORMANCE_MEASUREMENT_NOT_QUALIFIED`。
- 无论状态如何，都不得写“性能全绿”“正式发行通过”或“M9 已开始”；资格通过也只代表候选测量体系合格，不能替代独立复审或发布批准。
- 明确 `push=false`、`forcePush=false`、`release=false`、`m9Started=false`，最终工作状态为 `WAITING_FOR_REVIEW`。

最终提交建议：`docs(renderer): deliver performance measurement qualification evidence`。提交前后均重新读取真实 HEAD、status 和提交链，确认未带入四个保护文件。

## 阶段状态持久化表

每次阶段完成后必须在此表中填入真实值并提交；不得填写未经执行的“通过”。

| 阶段 | 状态 | 证据路径 | 提交 SHA | 下一入口 |
| --- | --- | --- | --- | --- |
| 0 计划/恢复 | 已完成 | 本计划、起始 status/log、旧 v3 artifacts；`git diff --check` 通过；四个保护文件未变化；无新 worktree/Q 数据 | `593a902ee162e567679f80ea050a9d0e851c8095` | 1 启动诊断 |
| 1 启动/资源诊断 | 已完成 | `packages/shell/test/renderer-startup-diagnostic.test.mjs` 9/9；Shell typecheck；`node --check`；`git diff --check`；未生成 Q 数据 | `d87bf06a17b0ecd4eb2226fdc4bd83f38f5b4bc4` | 2 构建等价性 |
| 2 构建等价性 | 已完成 | 12 个阶段 2 测试；阶段 1+2 聚焦 21/21；`node --check`；`git diff --check`；真实双 worktree 构建保留至阶段 4；未生成 Q 数据 | `b2513cae5be8a311edc0c8565a7eff4e2aeba17b` | 3 v4 协议冻结 |
| 3 Schema/比较器/验证器 | 已完成 | v4 Shell 专项 20/20；阶段 1+2 专项 21/21；`verify:tools` 10/10；Shell typecheck；协议/Schema/门限/文件名已冻结；未生成 Q 数据 | `62847272bbb941c34a4ce68508b98de6bb7fb925` | 4 Q 矩阵/runner |
| 4 worktree/runner | 进行中 | 阶段 3 已冻结协议；真实 worktree/build 尚未开始 | 待生成 | 5 Q1–Q5 |
| 5 holdout | 未开始 | 五个固定 Q artifact | 待生成 | 6 全量门禁 |
| 6 门禁/归并 | 未开始 | 测试输出与门禁日志 | 待生成 | 7 清理 |
| 7 清理 | 未开始 | cleanup manifest、worktree list 前后 | 待生成 | 8 报告 |
| 8 报告/停止 | 未开始 | 最终报告、最终 status/log | 待生成 | `WAITING_FOR_REVIEW` |

## 阶段 0 自检与提交门槛

阶段 0 已执行的提交前检查：

```text
git diff --check
git status --short
git diff -- docs/superpowers/plans/2026-08-10-renderer-performance-measurement-qualification.md
```

阶段 0 提交后再次执行：

```text
git rev-parse HEAD
git status --short
git rev-list --left-right --count HEAD...surdet/main
```

结果证明：只有本计划被暂存和提交；四个受保护文件未被触碰；未创建新资格数据；未 push；下一步仅为阶段 1。
