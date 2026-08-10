# Renderer 性能测量 v4 候选协议（2026-08-10）

状态：冻结候选协议，供 Renderer 性能测量体系资格化使用。

这份规格只描述测量与证据规则，不改变 Renderer、Starter、游戏规则、DSL、存档或发行流程。v4 的“通过”只表示测量体系候选具备重复性证据，不能表示正式性能全绿、正式发行通过或 M9 开始。

## 固定版本与执行参数

- `protocolId`：`renderer-v4-qualification-2026-08-10`
- `schemaVersion`：`4`
- 旧版本：`007438b569ec95350fdc9d7882ad49f55bbb7968`
- 当前版本：`f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59`
- 每组 warmup：baseline 1 次、current 1 次；warmup 不进入正式统计但原样保留。
- 每组正式配对：20 对；raw launch 恰好 40 个。
- 组内奇数 pair 为 baseline→current，偶数 pair 为 current→baseline。
- Electron 启动串行执行；每次使用新的临时 userData；不复用启动会话。
- 同提交比较必须使用全新干净物理 worktree；Q5 使用同一干净构建根但仍为独立 Electron/userData 启动。
- 构建使用：`npm ci --ignore-scripts --no-audit --no-fund`，随后 `npm run build`。
- 不比较文件 mtime；构建 manifest 必须比较相对路径、字节大小和 SHA-256，另记录 shell/starter bundle entry SHA。
- 固定临时根：`C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-v4-qualification-2026-08-10`。存在时使用编号递增的新根，不覆盖旧目录。

## Q 组矩阵

| 组 | baseline | current | 物理根 | 资格用途 |
| --- | --- | --- | --- | --- |
| Q1 `q1-007-a-b` | 007 worktree A | 007 worktree B | 两个新根 | 旧版本同提交、A→B |
| Q2 `q2-007-b-a` | 007 worktree B | 007 worktree A | 两个新根，角色交换 | 旧版本同提交、B→A |
| Q3 `q3-f7-a-b` | f7 worktree A | f7 worktree B | 两个新根 | 当前版本同提交、A→B |
| Q4 `q4-f7-b-a` | f7 worktree B | f7 worktree A | 两个新根，角色交换 | 当前版本同提交、B→A |
| Q5 `q5-f7-same-root` | f7 同一构建根 | f7 同一构建根 | 同一根、独立启动 | 同构建根对称性 |

Q1→Q5 是固定顺序。任一组失败都必须保留原始失败证据，不得重跑到通过，不得跳过剩余组，不得因失败改变协议。

## 时间戳和 raw launch

Host 必须尝试记录 `hostLaunchStartedAt`、`electronLaunchResolvedAt`、`firstWindowResolvedAt`、`debugObservedAt`、`assetDoneObservedAt`、`processCloseCompletedAt`。Page 必须尝试记录 navigation start、`performance.timeOrigin`、`starterModuleStartedAt`、`runtimeCreateStartedAt`、`runtimeCreateCompletedAt`、`debugPublishedAt`、`assetLoadStartedAt`、`assetLoadCompletedAt`、`fontsReadyAt`、`titleReadyAt`、`firstStableFrameAt`。

每个 marker 是：

```json
{ "available": true, "monotonicMs": 123.4 }
```

或：

```json
{ "available": false, "reason": "明确说明为何不可观测" }
```

禁止以 0、空字符串、记忆中的旧值替代不可用 marker。

每个 raw launch 必须保存：

- `pair`、`role`、`sequenceIndex`；
- host duration：launch→first window、first window→debug、debug→asset done；
- page snapshot 和 derived phase duration：navigation→debug、runtime create、asset load、debug→asset done、asset done→stable frame；
- observer lag；
- v3 兼容四项：`coldStartMs`、`assetReadyMs`、`menuOpenP95Ms`、`sceneP95Ms`；
- `assetLoading`、page/console/failed-request 错误数组；
- `PerformanceResourceTiming` 摘要；
- 所有不可用字段及原因。

素材加载状态必须完整：`total > 0`、`completed === total`、`failed === 0`、`done === true`。不满足时，样本必须原样写入失败证据并使 artifact validator 拒绝作为有效资格样本。

## 统计

- raw 永远按执行顺序保存；统计时复制后排序，不改变 raw。
- median：偶数样本取中间两项平均值。
- p95：位置为 `(n - 1) * 0.95` 的线性插值。
- v3 兼容口径继续为 cold/asset median、menu/scene p95；它只用于诊断历史红灯，不能被 v4 结果覆盖。
- v4 对每个强制 phase/interaction 指标按 pair 计算：
  - `ratio = current / baseline`；
  - `logRatio = log(ratio)`；
  - `absLogRatio = abs(logRatio)`；
  - signed difference：`current - baseline`；
  - 配对中位数比只记录为诊断，不是主门。
- 每项还要按 baseline-first/current-first 两个 order stratum 记录 baseline/current median、p95、样本数和相对中位差。

## 预声明资格门限

这些是“测量重复性资格”门限，不是旧 v3 的正式发行门限：

- `median(abs(logRatio)) <= log(1.10)`；
- `p95(abs(logRatio)) <= log(1.25)`；
- 每个 order stratum 的 baseline/current median 相对差 `<= 10%`；
- Q1/Q2、Q3/Q4 的角色互换中位 log-ratio 漂移 `<= log(1.10)`；
- Q5 必须满足同一主门限；
- build manifest、环境、commit-role、pair/order、asset health、page marker 和错误健康门必须通过。

主资格门是上述逐 pair 分布与顺序/健康约束的组合，不能由 `pairedMedianRatio` 单独替代。旧 v3 的 `1.10/1.15` gateRatio 仍独立保留，不能被 v4 的候选状态改写。

## Artifact 固定字段与文件名

每个 artifact 必须包含 `sampledAt`、`rebuiltAt`、commit/role/root、environment、build manifest、instrumentation diff SHA、warmups、executionOrder、rawLaunches、health、v3Compatible、v4、failures 和 qualification。`sampledAt` 是原始采样时间；离线重建只允许改变 `rebuiltAt`。

固定输出：

- `docs/baselines/renderer-v4-q1-007-a-b-2026-08-10.json`
- `docs/baselines/renderer-v4-q2-007-b-a-2026-08-10.json`
- `docs/baselines/renderer-v4-q3-f7-a-b-2026-08-10.json`
- `docs/baselines/renderer-v4-q4-f7-b-a-2026-08-10.json`
- `docs/baselines/renderer-v4-q5-f7-same-root-2026-08-10.json`
- `docs/baselines/renderer-v4-qualification-cleanup-2026-08-10.json`
- `docs/ENGINE-RENDERER-PERFORMANCE-MEASUREMENT-QUALIFICATION-REPORT-2026-08-10.md`

## 判断语义

- 五组都有效、同提交角色交换稳定、Q5 同根稳定、顺序无偏、phase-local 可用于区分 host/page 层且所有门禁通过：只能报告 `PERFORMANCE_MEASUREMENT_CANDIDATE_QUALIFIED`。
- 任一构建、物理 worktree、role/order、host launch、page bootstrap、runtime create、asset/font、observer、OS 或 unresolved 层失败：报告 `PERFORMANCE_MEASUREMENT_NOT_QUALIFIED`，不得作因果归因，不得进入正式跨版本 A/B、M9 或发行。
- 无论结果，旧版 `assetReadyMs` 和 `sceneP95Ms` 红灯原样保留；本协议没有任何“刷绿”路径。
