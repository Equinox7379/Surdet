# Surdet Player Experience Wave 5A

## 回退黑屏事实与状态交付报告

日期：2026-08-12
范围：只执行 Wave 5A；未开始 Wave 5B、M9、性能工作或发行。

## 1. 结论与证据边界

本轮在 Host 公共回退事务层保留并验证了两项有直接测试证据的行为修正，但它们不等于已经确认玩家黑屏根因：

1. `restoring` 期间的 `perform()` 明确返回 `false`，不修改历史、不调用解释器或 Renderer。这是安全的防御性重入保护；当前证据来自 `reenterOnReset: true` mock 的 future-invariant 测试，不能宣称真实玩家调用链已证实会在 `resetSession` 内重入 `perform()`。状态：`DEFENSIVE_REENTRY_GUARD_ADDED`。
2. 成功恢复后，恢复到的 cycle boundary 继续留在回退缓冲中；在任务书固定的“推进 4 条文本 → 回退 4 次”重复协议下，连续 cycle 可以继续产生 4 次有效回退，修复了已验证的 history/no-op 边界缺陷。状态：`CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED`。

Renderer 的效果恢复回归测试在修复前已经通过，因此本轮没有凭猜测修改 Renderer 生产表现代码；只新增了 WorldLayer 表现不变量测试。正式 Zero Electron 路径按固定 8 session × 20 回退协议重新运行后 160/160 通过，未观测到黑屏、背景/立绘消失或 Renderer/resource release 错误。

玩家报告的“多次回退后画面逐渐变暗或直接黑屏、切场景后恢复”目前仍未取得根因证据。最终压力运行只能说明在预定义协议下未复现，不能据此宣告玩家问题闭合。状态：`PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED`、`PLAYER_BLACK_SCREEN_NOT_REPRODUCED_UNDER_STRESS_PROTOCOL`。

最终状态：

```text
DEFENSIVE_GUARDS_ADDED
CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED
PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED
PLAYER_BLACK_SCREEN_NOT_REPRODUCED_UNDER_STRESS_PROTOCOL
FINAL_COMMIT_EVIDENCE_QUALIFIED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAVE_5B_NOT_STARTED
WAITING_FOR_INDEPENDENT_REVIEW
```

## 2. 用户红灯路径

用户反馈的路径被保留为本轮合法缺陷依据：

```text
正式《零点之后》→开始新游戏→推进到可回退文本→连续点击回退
→画面可能逐次变暗或最终黑屏，菜单仍可操作
→切换场景后画面恢复
```

发生次数不稳定，可能一次回退后变暗，也可能 7–10 次或十几次后才出现。自动化一次或几次未复现不能推翻该反馈，因此本轮使用正式 Zero dist、独立 Electron、独立临时 userData、真实键盘推进和真实 `page.mouse.click()` 点击 `rail:rollback`，并保存每次回退前后的表现和画布证据。

## 3. 基线与实际改动

### 3.1 开工基线

- 基线 HEAD：`2edc65d55cae85bd7fd296501c5e2d896d36be9d`
- 基线提交：`2edc65d docs(engine): record wave 4 evidence remediation`
- 开工时 `HEAD...surdet/main`：`0 0`
- Node：`v24.15.0`
- npm：`11.12.1`
- 基线 `npm run verify:all`：exit code `0`
- 基线 `git diff --check`：exit code `0`
- 基线 `git ls-files '*.log'`：空

开工时已存在且全程未触碰的未跟踪文件包括 `AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份艺术方向/交接文档、Wave 5A 计划和既有 Wave 5B 计划。Wave 5B 计划只作为既有未跟踪文件保留，未读取修改、未暂存、未提交。

### 3.2 实际实现提交

本轮代码和测试实现提交：

```text
de235fe273df45e3d0021f3d3b32271458235542
fix(host): guard rollback restore boundaries
```

实际实现文件：

- `E:\surdet\packages\host\src\rollback-runtime.ts`
  - `canRollback()` 和 `perform()` 都拒绝 `restoring` 状态；
  - 成功恢复后将恢复的 boundary frame 放回缓冲，保持连续真实文本 cycle 的历史不变量。
- `E:\surdet\packages\host\test\rollback-runtime.test.ts`
  - 同步重入回退回归；
  - 连续两个“4 次推进 → 4 次有效回退”周期回归。
- `E:\surdet\packages\renderer\test\layers\world-layer.test.ts`
  - 覆盖 fade、tint、flash、wipe、zoom、move、shake、particle、transition 在恢复快照后的清理与稳定性；
  - 没有修改 Renderer 生产表现代码。
- `E:\surdet\packages\shell\e2e\player-experience-wave-5a-rollback-black-screen.e2e.mjs`
  - 正式 Zero 构建、8 个独立 Electron、settled/rapid 双模式、真实输入和完整 artifact 探针；
  - 每张截图记录绝对路径、PNG SHA-256、宽高、平均亮度和黑像素比例。
- `E:\surdet\packages\shell\test\player-experience-wave-5a-e2e-contract.test.ts`
  - 锁定正式入口、隔离 userData、固定协议、真实输入、错误通道、完整表现字段和证据质量。
- `E:\surdet\packages\shell\package.json`
  - 注册 `e2e:player-experience:wave5a`。
- `E:\surdet\examples\zero-after-midnight\src\main.ts`
  - 只增加已有 Renderer `queries.diagnostics.resourceLedger()` 到只读 debug 证据面的接线；没有增加黑屏检测、强制重绘、第二套回退算法或游戏逻辑。
- `E:\surdet\examples\zero-after-midnight\src\surdet-window.d.ts`
  - 为上述只读 `resourceLedger` 证据补充类型声明。

计划台账文件：

- `E:\surdet\docs\superpowers\plans\2026-08-12-player-experience-wave-5a-rollback-black-screen.md`

交付报告和计划收口将在实现提交之后另行创建普通文档提交；不会改写实现提交历史。

## 4. 已验证的公共行为与未确认的玩家现象

### 4.1 防御性重入保护（不是玩家黑屏根因证明）

生产回退入口仍由真实 `rail:rollback` 输入调用；但本轮没有证据证明真实玩家调用链会在 `resetSession` 内同步重入 `perform()`。可复现的红灯只来自 `reenterOnReset: true` 的 mock future-invariant 测试：

```text
rail:rollback 的真实 pointer input
  → 《零点之后》现有 onCommandRailSelect('rollback')
  → performRollback()
  → createRollbackRuntime().perform()
  → renderer.resetSession()
  → mock reset 回调主动再次进入 runtime.perform()
```

修复前，mock 外层 `perform()` 已经开始恢复，但 `canRollback()` 没有把 `restoring` 作为禁止条件，mock 回调内的嵌套 `perform()` 可以再次成功。红灯观察到嵌套结果 `[false, true]`（即第二次实际成功）以及第二次 reset/host reset；这证明防御性不变量缺失，不证明真实玩家黑屏调用链已经发生。

现在入口先检查 `restoring`，外层事务拥有恢复权期间嵌套输入返回 `false`，不 pop/push 历史、不调用 `loadSnapshot`、`resetSession`、`restorePresentation` 或音频恢复。事务结束后才释放恢复状态。状态：`DEFENSIVE_REENTRY_GUARD_ADDED`。

### 4.2 已证明的 cycle-boundary/history 缺陷

固定协议要求每个 cycle 都真实推进 4 条文本，再真实回退 4 次。修复前，第一次 cycle 恢复到起点后，恢复帧从历史中消费掉；下一 cycle 的 4 次推进只能形成不足 4 个可消费的历史边界，固定协议的第 4 次回退变成无历史 no-op。该问题不是通过重复点击或无历史次数凑数得到的，而是正式协议本身暴露的公共历史连续性缺口。

修复后成功恢复会把目标 boundary frame 保留在回退缓冲中。下一次回退先消费当前重复 boundary，再沿前一历史帧回退，因此每个真实 cycle 都能完成 4 次有效回退。状态：`CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED`。这项修正只证明 history/no-op 边界行为，不证明玩家黑屏根因。

### 4.3 Renderer 表现证据

表现测试在修复前已通过：恢复快照后执行 2000ms `update()`，背景、立绘、fade/tint、遮罩、时间轴和 `activeTweens` 均保持目标状态。因此本轮没有声称已经证明 `STALE_PRESENTATION_WRITE` 或 `WORLD_EFFECT_RESET_GAP` 是玩家黑屏的根因，也没有修改 Renderer 生产实现。正式 Electron 证据仍覆盖每次回退后的这些字段和画布像素指标。

## 5. 测试先行红灯与绿灯

### 5.1 Task 2 防御性 future-invariant 红灯

命令：

```text
npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts
```

结果：exit code `1`，4 tests 中 `3 passed / 1 failed`。`reenterOnReset: true` mock future-invariant 测试观察到 `[false, true]`，并发生第二次 reset/host reset。该红灯只证明防御性重入不变量缺失，不是正式玩家黑屏根因复现。

Renderer 表现不变量命令：

```text
npm run test -w @surdet/renderer -- --run test/layers/world-layer.test.ts test/legacy/presentation-controller.test.ts
```

结果：exit code `0`，17/17 通过；该结果被如实记录为“当前 Renderer 直接测试没有取得合法红灯”，没有伪造生产表现缺陷。

### 5.2 Host 最小修复绿灯

同一 Host 命令修复后：exit code `0`，4/4 通过；重入结果为 `[false]`，外层 reset/host reset 各只执行一次。

### 5.3 固定协议暴露的第二个红灯

新增 cycle continuity 测试后，同一 Host 文件在 cycle boundary 修复前为 exit code `1`，5 tests 中 `4 passed / 1 failed`；第二个“4 advances → 4 valid rollbacks”周期的第 4 次返回 `false`。

修复后同一命令为 exit code `0`，5/5 通过。Renderer 四个相关文件（WorldLayer、PresentationController、presentation-clear、world-effects-controller）聚焦回归最终为 20/20 通过。

### 5.4 证据质量红灯与绿灯

为满足计划要求的每次回退完整证据，先新增了 `canvasWidth`、`canvasHeight` 和正式 Zero `resourceLedger` 接线断言。补丁前运行：

```text
npm run test -w @surdet/shell -- --run test/player-experience-wave-5a-e2e-contract.test.ts
```

结果为 exit code `1`，6 tests 中 `4 passed / 2 failed`：runner 尚未写入画布宽高，Zero debug 面尚未接出已有 `resourceLedger` 查询。补齐后同一命令为 exit code `0`，6/6 通过；runner `node --check` 也为 exit code `0`。

## 6. 正式 8×20 Electron 验收

### 6.1 固定协议

- 8 个独立 Electron session；
- session 1–4：`settled`，每次回退前等待两帧和语义稳定；
- session 5–8：`rapid`，稳定后尽快再次输入，不使用固定延时凑次数；
- 每 session 独立临时 userData；
- 每个 cycle 先真实推进 4 条文本，再真实点击回退 4 次；重复 5 个 cycle；
- 总计 160 次有效回退；
- 正式入口：`E:\surdet\examples\zero-after-midnight\dist`；实际页面为 `file:///E:/surdet/examples/zero-after-midnight/dist/index.html`；
- 没有调用 `performRollback()`、debug action、`titleSelect()` 或直接修改解释器位置来代替玩家输入。

### 6.2 本次最终证据收口 artifact（权威）

正式命令：

```text
npm run e2e:player-experience:wave5a -w @surdet/shell
```

exit code：`0`

artifact：

```text
path=C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-LNsj5z\wave-5a-rollback-1786521263206.json
bytes=67859787
sha256=259087456f6999d1405813c5ab3ec017c13ceb9b7af0347b455ae0d094b3d2e0
status=PASSED
head=95147d40fc71151577e7bf0528f345ab5c96491c
```

这次矩阵在当前已提交实现 HEAD 上全新构建并运行，没有复用旧 dist、旧 artifact 或旧截图。独立读取 `Get-Item` 与 `Get-FileHash -Algorithm SHA256` 的结果分别为 `67859787` bytes 和上述 SHA-256；独立 Node 校验脚本再次确认 artifact `head` 等于 `git rev-parse HEAD`。

8 个 session 均各完成 20/20：

```text
session-01-settled 20/20
session-02-settled 20/20
session-03-settled 20/20
session-04-settled 20/20
session-05-rapid   20/20
session-06-rapid   20/20
session-07-rapid   20/20
session-08-rapid   20/20
```

artifact 中每个 attempt 的 `before`、`expected`、`after` 均包含：位置、解释器/Renderer 状态、uiSession、activeOverlay、背景、立绘、相机、fade、tint、particle、timelines、dialogueProjection、resourceSnapshot、resourceLedger 和 lastRendererError。最终离线复核确认缺失属性为 `0`，每次 `resourceLedger` 均为非空的只读数据快照。

每个 session 保存 80 张截图，共 640 张；截图的绝对路径、字节数、PNG SHA-256、canvas data URL hash、宽高、meanLuma 和 blackPixelRatio 都写入 artifact。所有 640 个路径均存在，重新计算的 PNG SHA/字节数不匹配为 `0`。截图目录位于：

```text
C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-LNsj5z\session-01-settled\screenshots
...
C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-LNsj5z\session-08-rapid\screenshots
```

所有截图画布尺寸为 `1211x681`。恢复后的 160 张 after canvas 指标：

- `maxAfterBlackPixelRatio=0.17835043670902193`；
- `minAfterMeanLuma=0.08445643722662997`；
- 未触发 `blackPixelRatio >= 0.985`；
- 未出现目标背景/立绘消失、fade 反向变为 1 或 timelines 不一致。

事件汇总：

```text
pageErrors=0
consoleErrors=0
requestFailures=0
unhandledRejections=0
rendererErrors=0
releaseFailures=0
unexpectedWindowClosed=0
```

### 6.3 旧最终 artifact（历史证据，非本次权威证据）

旧的完整通过 artifact 仍然保留，但它是在实现提交前、工作树含有未提交实现时生成的，不能作为最终提交绑定证据：

```text
path=C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-EAYFom\wave-5a-rollback-1786518935217.json
bytes=67859728
sha256=7d431465c097406c6ea7433a3cb554433604793a23344be6fa235e70248c6ae1
status=PASSED
head=2edc65d55cae85bd7fd296501c5e2d896d36be9d
reason=实现提交 de235fe273df45e3d0021f3d3b32271458235542 之前生成；保留为历史内容证据，不作为最终 HEAD 的权威证据
```

本次新 artifact（6.2）才是绑定 `head=95147d40fc71151577e7bf0528f345ab5c96491c` 的 Wave 5A 权威证据。

### 6.4 历史失败/更早通过 artifact 保留情况

以下文件均在系统临时目录中保留，未覆盖、未加入 Git：

1. 固定正式协议首次暴露 cycle history 缺口的失败 artifact：

```text
path=C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-cojXwG\wave-5a-rollback-1786517221021.json
bytes=1151795
sha256=d092d6bee6060616ab803696ff2ab804bbe4ad71dfbc2d371a6864f0b201b50f
result=FAILED, 56/160, 无黑屏/无错误，但 cycle 2 第 4 次缺少合法历史
```

2. cycle boundary 修复后的第一轮完整通过 artifact：

```text
path=C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-wHFple\wave-5a-rollback-1786518113941.json
bytes=8132064
sha256=15f7f58fbe038a82b865ac6b135ff4491be44031788e68e7ef31ca35a2e0f17f
result=PASSED, 160/160
```

3. smoke 入口校验失败 artifact：

```text
path=C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-nzxZck\wave-5a-smoke.json
bytes=1699
sha256=450b56d943d153dc13cb60003f44f1ee04eaaad61576a510890012ba88205390
```

4. 修正入口校验后的真实 smoke artifact：

```text
path=C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-ZwHx7u\wave-5a-smoke.json
bytes=208691
sha256=4a9b2577b69e68f352ea8cacadc57f51f875ef8bc6fc950d546a4737cde0f34e
result=smoke 完成 4/4 有效回退；按协议因未达到正式 160 次而标记 FAILED，不作为正式结论
```

## 7. 受影响模块与仓库门禁

本轮实际执行并通过：

| 命令 | 结果 |
| --- | --- |
| `npm run test -w @surdet/host` | 11 files / 86 tests，exit 0 |
| `npm run test -w @surdet/renderer` | 49 files / 397 tests，exit 0 |
| Wave 5A Shell contract | 6/6，exit 0 |
| `npm run typecheck -w @surdet/host` | exit 0 |
| `npm run typecheck -w @surdet/renderer` | exit 0 |
| `npm run typecheck -w @surdet/shell` | exit 0 |
| `npm run typecheck -w zero-after-midnight` | exit 0 |
| `npm run build -w @surdet/host` | exit 0 |
| `npm run build -w @surdet/renderer` | exit 0 |
| `npm run build -w @surdet/shell` | exit 0 |
| `npm run build -w zero-after-midnight` | exit 0 |
| `npm run verify:all` | 本次证据收口未重跑；引用此前独立复核 exit 0 |
| `git diff --check`（实现提交前） | exit 0 |
| `git ls-files '*.log'` | 空 |

此前独立运行的 `verify:all` 确认正式《零点之后》仍为 11 个场景、23/23 choice 分支、3 个可达结局、44 项资产、运行时错误 0；本次仅做证据收口，未把该历史 exit 0 伪称为本轮重新执行。没有执行性能资格化、旧版正式 A/B、pack、electron-builder 或 EXE 发行构建。

## 8. Git 与保护边界

本轮最终证据运行与历史文档收口的事实关系如下：

```text
CODE_EVIDENCE_HEAD=95147d40fc71151577e7bf0528f345ab5c96491c
ARTIFACT_HEAD=95147d40fc71151577e7bf0528f345ab5c96491c
DOCUMENT_CLOSURE_HEAD=c1a6f3e1eb8b9065ed4602dc6bb423c173d48320
```

`CODE_EVIDENCE_HEAD` 与 `ARTIFACT_HEAD` 完全一致，因此本次正式矩阵满足 `FINAL_COMMIT_EVIDENCE_QUALIFIED`。`DOCUMENT_CLOSURE_HEAD` 是只包含最终证据报告/计划收口的文档提交；它没有改变被测代码或 artifact。当前事实与状态收口还会创建一份新的普通 docs 提交；该新提交的真实 `git rev-parse HEAD` 在提交后只读复核和最终回报中记录，不把它错误地写成被测代码或 artifact 的 HEAD。

本轮事实收口开始前实际只读值：

- 当前 HEAD：`c1a6f3e1eb8b9065ed4602dc6bb423c173d48320`
- `HEAD...surdet/main`：`4 0`
- `git rev-list --count surdet/main..HEAD`：`4`
- 暂存区：空
- `git ls-files '*.log'`：空

以下文件未修改、未暂存、未提交、未删除、未移动：

```text
E:\surdet\AGENTS.md
E:\surdet\SESSION-HANDOFF.md
E:\surdet\USER.md
E:\surdet\docs\SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
E:\surdet\docs\SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

Wave 5B 计划文件也未触碰。没有 push、force push、rebase、reset、checkout、clean、amend、squash 或历史改写。

## 9. 后续停止点

本轮到此停止，等待总经理独立复审。不得自动进入 Wave 5B，不得开始 M9、性能、资产、音频、剧情、存档格式、发行或 EXE 打包。

## 10. 最终证据收口记录

- 本次新 artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5a-LNsj5z\wave-5a-rollback-1786521263206.json`。
- 新 artifact 磁盘字节数：`67859787`。
- 新 artifact SHA-256：`259087456f6999d1405813c5ab3ec017c13ceb9b7af0347b455ae0d094b3d2e0`。
- 新 artifact `status=PASSED`，`head=95147d40fc71151577e7bf0528f345ab5c96491c`，`actualSessions=8`，`actualAttempts=160`。
- 8 个 session 各为 `20/20`；前四个为 `settled`，后四个为 `rapid`；160 次 `validHistory=true`。
- 640 张截图全部存在且路径唯一；字节数和 SHA-256 完整性不匹配为 `0`。
- 160 个 after canvas 均未达到黑屏线 `blackPixelRatio >= 0.985`；最大 after `blackPixelRatio=0.17835043670902193`；本次未发现黑屏。
- `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 和 `unexpectedWindowClosed` 全部为 `0`。
- `CODE_EVIDENCE_HEAD` 与 `ARTIFACT_HEAD` 均为 `95147d40fc71151577e7bf0528f345ab5c96491c`；`DOCUMENT_CLOSURE_HEAD` 为 `c1a6f3e1eb8b9065ed4602dc6bb423c173d48320`。三者职责不同：前两者绑定被测代码和 artifact，后者只绑定上一轮文档收口。
- 当前事实收口开始前实际 HEAD 为 `c1a6f3e1eb8b9065ed4602dc6bb423c173d48320`，`HEAD...surdet/main=4 0`；本轮新普通 docs 提交后的最终 HEAD、ahead/behind 和报告磁盘摘要以提交后只读命令为准，并在最终回报中列出。
- 本次证据收口只允许修改本报告和 Wave 5A 计划台账；未修改生产源码、Host/Renderer/Shell 实现、Wave 5B 计划或受保护文件。
- Wave 5B 的真实计划路径为 `docs/superpowers/plans/2026-08-12-player-experience-wave-5b-layout-polish.md`；本轮未读取、未修改、未暂存、未提交。
- `verify:all` 将作为本次事实收口的最终门禁执行并如实记录 exit code；未进行性能工作、未进入 M9、未 push、未部署、未发行。

本轮保留的两项代码改动及证据边界：

- `CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED`：`rollback.push(frame)` 保留恢复到的 cycle boundary，修复固定协议下后续 cycle 的 history/no-op 边界缺陷。
- `DEFENSIVE_REENTRY_GUARD_ADDED`：`restoring` 期间拒绝再次 `perform()`，是安全的防御性 future-invariant；没有证据证明真实 `resetSession` 调用链会重入 `perform()`。
- 尚未证明：玩家报告的逐渐变暗/黑屏/切场景恢复的真实根因。
- `PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED`：根因未确认。
- `PLAYER_BLACK_SCREEN_NOT_REPRODUCED_UNDER_STRESS_PROTOCOL`：预定义压力协议下未复现，不能外推为玩家问题已闭合。

最终停止状态：

```text
DEFENSIVE_GUARDS_ADDED
CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED
PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED
PLAYER_BLACK_SCREEN_NOT_REPRODUCED_UNDER_STRESS_PROTOCOL
FINAL_COMMIT_EVIDENCE_QUALIFIED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAVE_5B_NOT_STARTED
WAITING_FOR_INDEPENDENT_REVIEW
```
