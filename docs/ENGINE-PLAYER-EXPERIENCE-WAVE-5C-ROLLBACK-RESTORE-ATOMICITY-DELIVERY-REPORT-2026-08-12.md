# Surdet Player Experience Wave 5C

## Rollback Restore Atomicity — 诊断交付报告

日期：2026-08-12
状态：`WAVE_5C_PHASE_2_FINAL_EVIDENCE_ATTEMPT_COMPLETE / FORMAL_EVIDENCE_BLOCKED`
停止点：`WAITING_FOR_INDEPENDENT_REVIEW`

> 本报告保留 Phase 1、首次 Phase 2 以及前一次 runner 收口的历史证据，并在文末追加本次“禁止自动选择 choice”修正后的最新权威收口。公共层实现和回归门禁保持不变；本次唯一实际 Electron 运行虽已绕过自动数字键，但 Case B 的目标可见 choice 前置条件仍未全部满足，因此不能把本轮交付写成完整的玩家问题修复通过。

## 1. 结论先行

本轮没有取得能够把玩家症状映射到 Host/Renderer 生产恢复代码的因果证据，因此没有修改回退恢复生产逻辑，也没有声称玩家黑屏已经修复。

本轮确认的状态是：

- `CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED`：保留 Wave 5A 已验证的 `rollback.push(frame)` 周期边界/历史修复。它解决回退到边界后继续推进、再次回退可能出现 no-op 或需要额外推进的历史问题。
- `DEFENSIVE_REENTRY_GUARD_ADDED`：保留 `restoring` 防御性重入保护。现有 `reenterOnReset: true` 只证明 mock 场景下的 future invariant，不证明真实玩家调用链会在 `resetSession` 内重入 `perform()`。
- `PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED`：玩家报告的渐进变暗/瞬发黑屏、切场景恢复仍未定位。
- `PLAYER_BLACK_SCREEN_NOT_REPRODUCED_UNDER_STRESS_PROTOCOL`：本轮正式诊断协议没有得到有效的玩家黑屏证据；这不等于玩家问题不存在或已经修复。
- `GHOST_CHOICE_ROOT_CAUSE_UNCONFIRMED`：正式 Case B 未到达目标三选一点，未取得幽灵选择的可观察证据，也不能宣称幽灵选择已修复或已被排除。
- `WAVE_5B_NOT_STARTED`
- `NOT_PUSHED`
- `WAITING_FOR_INDEPENDENT_REVIEW`

## 2. Phase 1 历史代码与提交边界

本节保留 Phase 1 的历史记录；本次最新代码、artifact 与文档闭环见第 8 节。

### CODE_EVIDENCE_HEAD

本轮诊断设施提交后的代码 HEAD：

`6331a387bd9b99957e737c1b70fd731d72c2ada3`

提交：`test(shell): add wave 5c rollback diagnostic`

本提交没有修改 Host/Renderer 回退恢复生产实现。改动仅为：

- `packages/shell/package.json`：增加 Wave 5C 正式诊断命令；
- `packages/shell/e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs`：正式 Zero 入口、真实 Electron、真实键盘/鼠标路径和受限证据采集 runner；
- `packages/shell/test/player-experience-wave-5c-e2e-contract.test.ts`：协议与禁止捷径 contract test；
- `examples/zero-after-midnight/src/main.ts`：只读 `__surdetDebug.visualThumbnail` 诊断字段，转发已有 `queries.world.captureThumbnail()`；
- `examples/zero-after-midnight/src/surdet-window.d.ts`：对应只读类型声明。

`visualThumbnail` 只是诊断取样，既不改变回退输入，也不参与生产恢复、场景切换或亮度逻辑。

## 3. Task 0–2 执行记录

### Task 0：冻结起点

起始基线：

- 分支：`main`
- HEAD：`a1cf342d31396c67491617a50fd87980a3955d24`
- `HEAD...surdet/main`：`0 0`
- `git diff --check`：exit 0
- `git ls-files '*.log'`：空
- `npm run verify:all`：exit 0
- 正式游戏门禁摘要：11 场景、23/23 choice 分支、3 个结局、44 项资产、运行时错误 0。

Task 0 普通提交链：

1. `31c657551ab6849bebc349c6f3459594643f61d9` — `docs(engine): plan wave 5c rollback restore repair`
2. `3d15999c3337f8eeddb620a7aaf9b9d105906d75` — `docs(engine): close wave 5c task0 ledger`

### Task 1：正式玩家路径诊断

正式 runner 只允许两个独立 Electron session，入口为：

`E:\surdet\examples\zero-after-midnight\dist`

采用独立临时 userData、真实标题/开始游戏/文本推进/键盘回退/鼠标点击；没有调用 `performRollback()`、`titleSelect()`、debug action 或直接修改解释器位置。正式有效诊断只运行一次；此前一次在启动 Electron 前因错误的 harness 配置文件预检查退出，不计入正式 session，但其 artifact 保留。

#### 3.1 先红后绿的 contract 证据

- runner/package script 尚不存在时运行 contract：`7/7` 失败，作为 Task 1 初始红灯保留；
- 增加正式 runner 和 package script 后：`7/7` 通过；
- 为防止无效 WebGL `canvas.toDataURL()` 读回污染亮度判断，先增加 `visualThumbnail` contract 断言；在字段尚未接线时：`1/7` 失败；
- 增加只读 `WorldQueries.captureThumbnail()` 诊断接线后，同一 contract：`7/7` 通过；
- `node --check packages/shell/e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs`：exit 0。

正式矩阵没有因为 probe 修订而重跑；以下 artifact 仍然完整保留，并明确标为旧 runner 版本的历史诊断证据。

#### 3.2 唯一有效正式诊断 artifact

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-rbQmX9\wave-5c-rollback-restore-atomicity.json`
- 字节数：`4,074,802`
- SHA-256：`02FD96027B0C0A762F792DC53238886C75C50D97F1EF293F43F7E667F01B514E`
- artifact `head`：`3d15999c3337f8eeddb620a7aaf9b9d105906d75`
- `sourceRoot`：`E:\surdet\examples\zero-after-midnight`
- `distRoot`：`E:\surdet\examples\zero-after-midnight\dist`
- `status`：`FAILED`
- `execution.actualSessions`：`2`
- `execution.actualAttempts`：`12`（Case A=12，Case B=0）
- `execution.regularScreenshots`：`3`
- 事件总计：`pageErrors=0`、`consoleErrors=0`、`requestFailures=0`、`unhandledRejections=0`、`rendererErrors=0`、`releaseFailures=0`、`unexpectedWindowClosed=0`。

由于 artifact 在 `6331a38` 诊断 probe 提交前生成，artifact HEAD 不等于 `CODE_EVIDENCE_HEAD`；本 artifact 不能作为当前提交的最终代码绑定证据，只能作为 Wave 5C 的历史诊断证据。没有重新运行正式矩阵来挑选绿色结果。

#### 3.3 Case A：真实 rapid rollback

Case A：`prologue-rapid-rollback`，模式 `rapid`。

- 真实回退：`12/12`；
- 每次 `validHistory=true`；
- 回退位置按合法历史从 prologue `pc=19` 逐步回到 `pc=7`；
- 目标背景均为 `apartment_night`；目标快照中没有立绘、fade、tint、transition、particle 或 timeline 残留；
- 所有错误通道均为 0；
- 保留 3 张截图：开始、首个异常、结束，没有按每次回退无限截图。

截图证据：

| 代表图 | 路径 | 字节数 | SHA-256 | 说明 |
| --- | --- | ---: | --- | --- |
| start | `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-rbQmX9\prologue-rapid-rollback\screenshots\start.png` | 877820 | `bf044b3321a19d26215c6b6ca26871dee588196a426b619772af11bbc17ba1a4` | 完整夜景与对话画面 |
| firstAnomaly | `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-rbQmX9\prologue-rapid-rollback\screenshots\firstAnomaly.png` | 868548 | `fa84c81b78997d8cb9b76ba205999638c01b7263e2814b95b13f69aed130577e` | 实际截图仍有背景、对话与 command rail |
| end | `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-rbQmX9\prologue-rapid-rollback\screenshots\end.png` | 878233 | `316ca3bb12c01b2385785dd9e85f51563455604639fda43ef875f0041669b39e` | 完整夜景与对话画面 |

旧 runner 对可见 WebGL canvas 执行 `canvas.toDataURL('image/png')`。由于该 WebGL framebuffer 不保证 `preserveDrawingBuffer`，该读回得到空黑数据，因而 12 次都记录了 `blackPixelRatio=1`、`meanLuma=0`。这与三张实际 Playwright 截图的 RGBA 扫描（约 `blackPixelRatio=0.178`、`meanLuma≈0.083–0.086`）矛盾，因此是无效的探针假阳性，不是玩家黑屏红灯，也不是生产恢复根因。

为修正未来诊断，当前 runner 改为优先读取只读 `visualThumbnail` data URL，再在页面内用 2D probe 计算短帧亮度；保留 fallback 但不再把 WebGL `toDataURL` 结果冒充可靠可见帧。这个修订没有重新生成正式 artifact，避免违反“正式诊断只运行一次”。

#### 3.4 Case B：真实 choice rollback

Case B：`common-0017-choice-rollback`，模式 `settled`。

runner 在等待真实目标三选一点（“记录她说的时间”“追问失踪的原因”“先挂断电话”）时超时，`attempts=0`，没有实际选择点击、跨 choice 回退或 choice 投影断言。因此：

- 没有取得 ghost-choice 红灯；
- 不能宣称 ghost-choice 已修复；
- 也不能宣称 ghost-choice 已被排除；
- 超时 failure message 与 stack 保留在 artifact，未覆盖或删除。

#### 3.5 初始 harness setup artifact

第一次 runner 运行在启动 Electron 前因为错误地要求不存在的 `dist/game.config.json` 而失败。它不是玩家路径证据，但保留用于审计：

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-kqn2j2\wave-5c-rollback-restore-atomicity.json`
- 字节数：`1,803`
- SHA-256：`3F7C53EB0E4F95F0F051AA9940ACBA0EE3BE2AE01566F8E9AF71B17B6303AF89`

### Task 2：恢复与选择回归测试

没有生产改动需要先制造新的红灯；既有测试已经直接覆盖当前公共不变量，因此按计划记录“聚焦测试全通过，红灯只来自玩家反馈/诊断证据缺口”：

- `npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts`：`5/5` 通过；其中 `reenterOnReset` 是 `DEFENSIVE_FUTURE_INVARIANT`，不是玩家根因证据；
- `npm run test -w @surdet/renderer -- --run test/integration/presentation-clear.test.ts test/world-effects-controller.test.ts`：`3/3` 通过；
- `npm run typecheck -w @surdet/shell`：exit 0；
- `npm run typecheck -w zero-after-midnight`：exit 0；
- `npm run build -w @surdet/shell`：exit 0；
- `npm run build -w zero-after-midnight`：exit 0。

因此没有进入 Task 3 的公共恢复修复，也没有进入 Task 4 的 Ghost Choice 投影修复。Task 2 的测试通过证明当前覆盖的不变量没有回归，不足以解释玩家黑屏或幽灵选择。

## 4. 条件停止与未执行阶段

Task 3 的入口要求是 Task 1 true repro 或可以直接映射玩家截图的 causal mismatch。本轮两者均不存在：

1. Case A 的黑屏判断来自无效 WebGL 读回，实际截图显示画面仍在；
2. Case B 没有到达目标选择点；
3. Task 2 Host/Renderer 聚焦不变量测试全部通过；
4. `reenterOnReset` 只是防御性 mock 测试，不能升级为真实调用链证据。

所以没有增添 `setTimeout`、debounce、永久 ticker、强制提亮、Zero 特例、第二套回退算法或其他猜测性兼容层。

按 Wave 5C 计划的保守分支，以下阶段未启动：

- Task 3：未启动生产恢复修复；
- Task 4：未启动 Ghost Choice 生产修复；
- Task 5：不再重复正式 Electron 矩阵；唯一有效诊断已保留；
- Task 6：不运行全量门禁，因为没有进入生产修复分支；Task 0 的 `verify:all` 基线 exit 0 已保留，不能冒充本轮全量复跑；
- Wave 5B：未开始。

## 5. Git、保护边界与最终状态

本报告对应的代码证据提交为 `6331a387bd9b99957e737c1b70fd731d72c2ada3`；本报告和计划台账随后作为普通文档收口提交。最终提交后的真实 HEAD、ahead/behind、工作树和文档字节数/SHA-256以提交后命令输出为准，并在最终交付回报中列出。

不得触碰且本轮未修改、未暂存、未提交、未删除、未移动：

- `AGENTS.md`
- `SESSION-HANDOFF.md`
- `USER.md`
- `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
- `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`
- `docs/superpowers/plans/2026-08-12-player-experience-wave-5b-layout-polish.md`

明确声明：未 push、未部署、未发行、未重新打包 EXE、未进入 M9、未处理性能工作、未重跑 Wave 5A 640 张截图或旧版正式 A/B。

## 6. Phase 1 历史停止状态

```text
CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED
DEFENSIVE_REENTRY_GUARD_ADDED
PLAYER_REPRO_RETAINED
PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED
PLAYER_BLACK_SCREEN_NOT_REPRODUCED_UNDER_STRESS_PROTOCOL
GHOST_CHOICE_ROOT_CAUSE_UNCONFIRMED
WAVE_5C_DIAGNOSIS_COMPLETE
WAVE_5B_NOT_STARTED
NOT_PUSHED
WAITING_FOR_INDEPENDENT_REVIEW
```

## 7. Phase 2 首轮实现与证据（历史台账；最新收口见第 8 节）

### 7.1 范围、起点与实现提交

Phase 2 严格限制在已批准的 Renderer/Host 回退稳定边界、恢复交互瞬态清理、正式 Wave 5C 小型 Electron runner 及其必要接线；没有启动 Wave 5B、M9、性能工作、发行、部署或 EXE 打包。

Phase 2 起点与远端事实：

- 起点代码 HEAD：`a752c8228327810bc77a574a034cf4d02334c509`
- 远端基线：`a1cf342d31396c67491617a50fd87980a3955d24`
- 起点 `HEAD...surdet/main`：`5 0`
- 首轮代码证据 HEAD：`74feb12e0602ceed89da6fa02827c089bda071df`
- 首轮代码证据 HEAD 相对 `surdet/main`：`8 0`（首轮文档收口提交前）

生产实现提交链：

1. `5c52d53e9674f4b01c406bb9083e97a971d84934` — `fix(renderer): enforce stable rollback boundaries`
2. `8e5df703f4c4d6dd48e9dc1b822db7ba2e6661b2` — `fix(renderer): require stable rollback checkpoint port`
3. `74feb12e0602ceed89da6fa02827c089bda071df` — `fix(renderer): align controller port contract`

### 7.2 先红后绿与公共层改动

在生产改动前保留了针对性红灯：

- Host `rollback-runtime` 聚焦测试：6 项中 1 项失败；Renderer 报告 checkpoint 不安全时，旧路径仍会进入 presentation snapshot/history。
- Renderer presentation-controller 聚焦测试：12 项中 2 项失败；缺少 Fade 稳定查询，且普通 `stateReset` 后 choice 瞬态仍残留。

同一路径修复后：

- Renderer Phase 2 聚焦：3 文件、24/24 通过；
- Host rollback 聚焦：1 文件、6/6 通过；
- Wave 5C Shell contract：7/7 通过。

实现语义：

- `PresentationController.canCaptureRollbackCheckpoint()` 是纯查询：活动 `FadeTween` 返回 `false`，无活动或已完成返回 `true`；查询不推进 tween、不改 alpha、不请求帧。
- `RollbackRendererPort.canCaptureRollbackCheckpoint()` 为 Host 的必需端口；`RollbackRuntime.captureText()` 在调用 `snapshotPresentation()` 前检查该边界。不安全时不生成 history frame、不延迟补抓、不改变剧情。
- `stateReset` 通过最小私有清理 helper 清除活动 fade、choice indices/cursor、choice cards、旧 typing/pending voice 和 wait/video session 令牌，并清理 controller timelines；没有调用完整 `resetSession()`，没有重置设置或 Backlog。
- Renderer public runtime/query、Starter、Zero 和 CLI 模板同步了正式接口；Shell runner 使用正式 Zero dist、真实标题/推进/rail 鼠标输入，并记录 `fadeTweenActive`、`canCaptureRollbackCheckpoint`、choice bounds 与错误通道。

### 7.3 正式 Electron 证据：保留失败，不重跑挑绿

本轮正式命令只运行一次：

```text
npm run e2e:player-experience-wave5c -w @surdet/shell
```

退出码：`1`。它使用正式入口 `E:\surdet\examples\zero-after-midnight\dist`、2 个独立 Electron session 和独立临时 userData；协议上限为 2 session、14 次有效回退、8 张常规截图。artifact 已保留，没有因失败再次运行。

权威失败 artifact：

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-rIKJIY\wave-5c-rollback-restore-atomicity.json`
- 字节数：`3,748,653`
- SHA-256：`BB456B68E39B84724D3E2ED5727D03A83201AD61A510C15B16A85D8108C6B49E`
- artifact `status`：`FAILED`
- artifact `head`：`5c52d53e9674f4b01c406bb9083e97a971d84934`
- `execution.actualSessions`：`2`
- `execution.actualAttempts`：`12`（Case A=12，Case B=0）
- `execution.regularScreenshots`：`2`
- 聚合错误：`pageErrors=0`、`consoleErrors=0`、`requestFailures=0`、`unhandledRejections=0`、`rendererErrors=0`、`releaseFailures=0`、`unexpectedWindowClosed=0`

Artifact 是在 `5c52d53` 实现提交后、`8e5df70` 与 `74feb12` 公共类型契约提交前生成的。因而：

- `CODE_EVIDENCE_HEAD`：`74feb12e0602ceed89da6fa02827c089bda071df`
- `ARTIFACT_HEAD`：`5c52d53e9674f4b01c406bb9083e97a971d84934`
- 二者不一致；该 artifact 是内容完整的 Phase 2 历史失败证据，但不是当前最终代码提交绑定证据。
- 本轮没有伪造 `FINAL_COMMIT_EVIDENCE_QUALIFIED`，也没有覆盖旧 artifact 或重新跑到绿色。

#### Case A：Fade + rapid rollback

- Case A `ok=true`，真实 `rail:rollback` 12/12，全部 `validHistory=true`；每次 `visualMismatch` 字段均为 false，错误数组为空。
- 在正式玩家路径观察到 `fadeTweenActive=true`、`canCaptureRollbackCheckpoint=false`、`fadeAlpha≈0.99`；稳定后变为 `fadeTweenActive=false`、`canCaptureRollbackCheckpoint=true`、`fadeAlpha=0`。这是 `FADE_ACTIVE_PLAYER_PATH_OBSERVED` 的证据。
- 代表截图均存在且已独立核对字节数/SHA：

| 标签 | 路径 | 字节数 | SHA-256 | blackPixelRatio |
| --- | --- | ---: | --- | ---: |
| start | `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-rIKJIY\prologue-rapid-rollback\screenshots\start.png` | 877860 | `b62b8c13c89ed0adb9ff1bb71f24ff1e707bda4d038e1dd9d0cda5547f41ffa4` | 0.1780448677 |
| end | `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-rIKJIY\prologue-rapid-rollback\screenshots\end.png` | 878233 | `316ca3bb12c01b2385785dd9e85f51563455604639fda43ef875f0041669b39e` | 0.1782109905 |

这两张实际 PNG 没有显示黑屏；它们只能说明本协议的 Case A 未观察到黑屏，不能推翻玩家的一手反馈。

#### Case B：真实 choice 到 rollback

Case B 在真实推进到 `common_0017` 的过程中，`advanceOne → waitGameStable` 等待超时；artifact 的 `lastSnapshot` 已显示 scene=`common_0017`，但 runner 没有完成真实 choice bounds 命中，因此：

- 实际选择点击：0；
- rail 回退：0；
- Case B 截图：0；
- failure：`page.waitForFunction: Timeout 30000ms exceeded`；调用栈位于 runner `waitFor`/`waitGameStable`/`advanceOne`/`runChoiceCase`。

所以本次没有得到 Ghost Choice 的真实 rail 路径结论。准确状态是：

`GHOST_CHOICE_VIA_RAIL_ROLLBACK_NOT_REPRODUCED_IN_THIS_PROTOCOL`（仅表示本次未观察到；由于 Case B 在实际点击前失败，该标签不构成完整通过，也不否定玩家反馈）。

### 7.4 回归门禁

本次 Phase 2 重新执行并通过：

- Renderer 聚焦：3 文件、24/24；Host rollback 聚焦：6/6；Shell Wave 5C contract：7/7；
- Renderer 全量：49 文件、400/400；Host：11 文件、87/87；Shell：19 文件、144/144；Starter：4 文件、7/7；CLI：7 文件、87/87；Zero：2 文件、21/21；
- Renderer、Host、Shell、Starter、CLI、Zero typecheck：全部 exit 0；
- Renderer、Host、Shell、Starter、CLI、Zero build：全部 exit 0；
- Zero lint：11 场景、0 errors、0 warnings；
- Zero simulate：23/23 choice、3 endings、0 runtime errors；
- `check-assets.mjs`：44 assets；
- `npm run verify:renderer-boundaries`：3/3；
- `npm run verify:renderer-legacy`：4/4；
- `npm run verify:all`：exit 0；
- `git diff --check`：exit 0；
- `git ls-files '*.log'`：empty。

### 7.5 首轮结论与停止点（历史记录）

已由单元/集成证据支持：

```text
FADE_CHECKPOINT_STABLE_BOUNDARY_ENFORCED
LOAD_RESTORE_INTERACTIVE_TRANSIENTS_CLEARED
FADE_ACTIVE_PLAYER_PATH_OBSERVED
```

仍必须保留：

```text
CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED
DEFENSIVE_REENTRY_GUARD_ADDED
PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED
PLAYER_BLACK_SCREEN_NOT_REPRODUCED_UNDER_STRESS_PROTOCOL
PLAYER_BLACK_SCREEN_AWAITING_MANUAL_VALIDATION
GHOST_CHOICE_ROOT_CAUSE_UNCONFIRMED
GHOST_CHOICE_VIA_RAIL_ROLLBACK_NOT_REPRODUCED_IN_THIS_PROTOCOL
```

首轮实现已经落地，但首轮正式 Case B 证据链未闭合，所以首轮交付状态为 `WAVE_5C_PHASE_2_IMPLEMENTATION_PRESENT / FORMAL_EVIDENCE_BLOCKED`，不是“玩家黑屏已修复”。未 push、未部署、未发行、未重新打包、未开始 Wave 5B/M9、未处理性能工作。

文档收口前 Git 状态：

- 首轮 `CODE_EVIDENCE_HEAD=74feb12e0602ceed89da6fa02827c089bda071df`；
- `HEAD...surdet/main=8 0`；
- 工作树仅有六个受保护未跟踪文件；
- 本次文档提交后的最终 HEAD、关系和工作树以提交后只读核验为准，并在最终交付回报中给出。

## 8. Case B runner 语义修正与最终证据收口

本节是本轮最新事实，覆盖并 supersede 第 7 节中“当前代码证据”和“唯一正式 Electron”字段；第 7 节的旧 artifact 仍作为历史证据保留，不删除、不覆盖、不改写。

### 8.1 任务边界与代码提交

本轮只处理 Wave 5C Phase 2 的两个已定位问题：

1. Shell runner 将 Core Interpreter 的 `awaiting-choice` 与 Renderer Presentation 的 `choice` 混写；
2. Host `captureText()` 在 `interpreter.saveSnapshot()` 之后才检查 `renderer.canCaptureRollbackCheckpoint()`。

没有修改 Core 或 Renderer 的真实状态名，没有开始 Wave 5B，没有进行性能、发行、部署或 EXE 打包，也没有触碰六个受保护未跟踪文件。

先红后绿证据：

- Shell Wave 5C contract 在生产修改前为 8 项、1 失败（exit 1）：旧 runner 没有以 Core `debug.status === 'awaiting-choice'` 进入选择合同；
- Host `rollback-runtime` 在生产修改前为 6 项、1 失败（exit 1）：不安全 checkpoint 仍调用了 `interpreter.saveSnapshot()`；
- 修复后 Shell contract 为 8/8（exit 0），Host rollback 聚焦为 6/6（exit 0）；
- `node --check packages/shell/e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs`、Host/Shell typecheck 和 build 均 exit 0。

runner 现在明确使用：

- Core 稳定状态：`awaiting-advance` 或 `awaiting-choice`；
- 选择等待的联合条件：Core `awaiting-choice`、Renderer `choice`、3 个可见 choice、3 个 choice bounds 和三项正式文案；
- `choiceMismatch()` 分别按 `interpreterStatus === 'awaiting-choice'` 与 `rendererStatus === 'choice'` 判断；
- 选择点击前、点击后和回退后的下一次选择均保持上述双层语义，不把两个层的状态名替换成同一个字符串。

Host 现在在同一 microtask 中先检查 `canCaptureRollbackCheckpoint()`，再调用 `interpreter.saveSnapshot()`。不安全时不会调用 Core snapshot、Renderer presentation snapshot、history 写入或延迟补抓；下一条稳定 text 才允许形成新的 history frame。

代码修正已先提交为一个普通本地提交：

`CODE_EVIDENCE_HEAD = 123f0971b0eb278d017cb1ed95df3e6a33b37b04`

提交信息：`fix(player): align wave 5c rollback checkpoint semantics`

本提交实际修改文件仅为：

- `packages/host/src/rollback-runtime.ts`
- `packages/host/test/rollback-runtime.test.ts`
- `packages/shell/e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs`
- `packages/shell/test/player-experience-wave-5c-e2e-contract.test.ts`

### 8.2 正式 Electron 命令与 artifact

任务书给出的连字符命令 `npm run e2e:player-experience-wave5c -w @surdet/shell` 已按原样尝试一次，但仓库 package script 不存在该名称，npm 在启动 Electron 前以 exit 1 报 `Missing script`。允许范围内不能修改 `packages/shell/package.json`；该仓库实际存在并由 contract 测试约束的正式脚本名称是带冒号的：

```text
npm run e2e:player-experience:wave5c -w @surdet/shell
```

随后只执行了一次真正的 Electron 矩阵运行，使用当前已提交代码构建的正式入口 `E:\surdet\examples\zero-after-midnight\dist`、2 个独立 Electron session 和独立临时 userData；没有复用旧 artifact 或旧截图，也没有重跑到绿色。该次真实 Electron 命令 exit 1，因为 Case B 未完成，不是因为隐藏错误或门禁被放宽。

最新正式 artifact（本次权威内容证据）：

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-VnMuGB\wave-5c-rollback-restore-atomicity.json`
- 字节数：`3,754,110`
- SHA-256：`B3E623FCA2BBC68FFA910C39200BB9155659143685B1A1A0F012C136E7834793`
- `status`：`FAILED`
- `ARTIFACT_HEAD`：`123f0971b0eb278d017cb1ed95df3e6a33b37b04`
- `execution.actualSessions`：`2`
- `execution.actualAttempts`：`12`（Case A=12，Case B=0）
- 常规截图记录：`2`
- 聚合错误：`pageErrors=0`、`consoleErrors=0`、`requestFailures=0`、`unhandledRejections=0`、`rendererErrors=0`、`releaseFailures=0`、`unexpectedWindowClosed=0`。

新 artifact 的 `ARTIFACT_HEAD` 与被测代码的 `CODE_EVIDENCE_HEAD` 完全一致，因此代码与 artifact 的提交绑定条件满足；但因为 Case B 没有完成真实选择点击，整体仍不能标记 `WAVE_5C_FORMAL_EVIDENCE_QUALIFIED`。

### 8.3 Case A 与 Case B 的真实结果

Case A `prologue-rapid-rollback`：

- `ok=true`；12/12 次真实 `rail:rollback`；12/12 `validHistory=true`；0 个 visual mismatch；错误数组为空；
- 观察到活动 Fade 时 `fadeTweenActive=true`、`canCaptureRollbackCheckpoint=false`、`fadeAlpha=0.9947297777770128`；稳定后 `fadeTweenActive=false`、`canCaptureRollbackCheckpoint=true`、`fadeAlpha=0`；
- 新 artifact 的代表截图已存在并与记录匹配：`start.png` 877847 bytes，SHA-256 `b3bfe0e407bb22cfb1eaa7e5fa312db4683dafb51dec1fb9babb69b68b9bc4a9`；`end.png` 878233 bytes，SHA-256 `316ca3bb12c01b2385785dd9e85f51563455604639fda43ef875f0041669b39e`；
- 这只能证明本次 Case A 协议下没有观察到黑屏，不能证明玩家报告的黑屏根因已经定位或修复。

Case B `common-0017-choice-rollback`：

- 本次未能通过真实推进到目标 `common_0017` 三选一点；
- 最后快照为 `common_convenience`、`pc=39`、Core `awaiting-advance`、Renderer `awaiting`、`visibleChoiceCount=0`、`choiceBounds=[]`；
- 真实 choice 点击为 0，真实 rail 回退为 0，Case B attempts/observations/screenshots 均为 0；
- 失败信息为 `未通过真实推进到达 common_0017 三选一`；
- 因此本次没有取得“回退后幽灵 choice”的产品证据，也不能把它写成已排除或已修复；失败 artifact 原样保留，未继续猜测性改 runner 或重跑。

### 8.4 历史 artifact、三个 HEAD 与资格结论

旧 Phase 2 artifact：

- `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-rIKJIY\wave-5c-rollback-restore-atomicity.json`
- `head=5c52d53e9674f4b01c406bb9083e97a971d84934`
- 该文件早于后续公共契约提交生成，标记为 `HISTORICAL_PHASE_2_EVIDENCE_NOT_COMMIT_BOUND`，仅作历史失败证据保留。

本次三个 HEAD 必须分开理解：

- `CODE_EVIDENCE_HEAD`：`123f0971b0eb278d017cb1ed95df3e6a33b37b04`，实际被测的 runner/Host 修正代码提交；
- `ARTIFACT_HEAD`：`123f0971b0eb278d017cb1ed95df3e6a33b37b04`，最新 artifact 内真实记录的 HEAD；
- `DOCUMENT_CLOSURE_HEAD`：本报告与计划的本次普通文档提交；提交前无法预写其自引用 SHA，最终真实值以提交后 `git rev-parse HEAD` 和最终交付回报为准。

虽然 `CODE_EVIDENCE_HEAD == ARTIFACT_HEAD`，但 Case B 未完整执行，所以本轮不写 `WAVE_5C_FORMAL_EVIDENCE_QUALIFIED`。必须保留以下边界：

```text
ROLLBACK_TRANSIENT_FADE_CHECKPOINTS_BLOCKED
LOAD_RESTORE_INTERACTIVE_TRANSIENTS_CLEARED
PLAYER_BLACK_SCREEN_AWAITING_MANUAL_VALIDATION
PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED
GHOST_CHOICE_VIA_RAIL_ROLLBACK_NOT_ESTABLISHED
CASE_B_FORMAL_EVIDENCE_BLOCKED
```

普通 save/quick-save 在 Fade 活动期间的表现快照语义不属于本轮已验证范围；不能写成所有存档/读档期间的 Fade 问题已修复。`rollback.push(frame)` 的周期边界历史修复与 `restoring` 防御性重入保护分别保持 `CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED`、`DEFENSIVE_REENTRY_GUARD_ADDED`；后者的 mock reentry 测试仅是 future-invariant 防护证据，不是真实玩家调用链根因复现。

### 8.5 最终门禁与停止状态（文档提交前）

- Host rollback 聚焦：6/6；Shell Wave 5C contract：8/8；
- Renderer 全量：49 文件、400/400；Host：11 文件、87/87；Shell：19 文件、144/144；Starter：4 文件、7/7；CLI：7 文件、87/87；Zero：2 文件、21/21；
- Host/Shell typecheck、build：exit 0；
- 根级 `npm run verify:all`：本次代码提交上 exit 0；
- `git diff --check`：exit 0；`git ls-files '*.log'`：empty；
- 文档提交前 `git rev-parse HEAD`：`123f0971b0eb278d017cb1ed95df3e6a33b37b04`；`HEAD...surdet/main`：`11 0`；
- 工作树仅有六个受保护未跟踪文件：`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份艺术交接文件和 Wave 5B 计划；它们未被修改、暂存、提交、删除或移动。

最终状态：

```text
WAVE_5C_PHASE_2_EVIDENCE_CLOSED
NOT_PUSHED
WAVE_5B_NOT_STARTED
WAITING_FOR_INDEPENDENT_REVIEW
```

未 push、未部署、未发行、未重新打包、未开始 M9、未处理性能工作；完成本次普通文档提交后停止。

## 9. Case B 自动选择 runner 缺陷修正与一次有效正式验证

本节是本次执行的最新权威事实。它只修改 Shell E2E runner 与 Shell contract；Host、Renderer、Core、Starter、CLI、Zero 生产代码及此前 Wave 5C 生产提交均未修改、未回滚。

### 9.1 先红后绿与最小 runner 修正

独立复审指出，旧的通用 `advanceOne()` 在看到 choice 时会构造并发送数字键 `1`，这会绕过真实 choice 鼠标输入并把剧情推进到下一场景。

本轮先增加 contract 红灯：

- Shell Wave 5C contract：9 项中 1 项失败，exit 1；
- 失败点是 runner 尚无 `advanceTextOne()`，且仍存在“发现 choice 后发送 `1`”的自动选择实现。

最小修正后，同一 contract 转绿：

- Shell Wave 5C contract：9/9，exit 0；
- `advanceTextOne()` 只允许在 Core `awaiting-advance`、Renderer 不为 `choice`、`choiceVisibleCount === 0` 时发送 `page.keyboard.press('Space')`；
- 不发送 `1`、`Enter` 或其他 choice 快捷键；
- 推进后若观察到 choice，返回状态给上层；若下一轮不是目标 `common_0017` 三选一，前置条件失败并停止，写入最后快照，不自动跨过；
- Case B 的真实 choice 仍只通过 `clickTarget('choice:0')` → `page.mouse.click(...)`；
- 普通文本推进和两个 choice 分支路径均改用 `advanceTextOne()`。

本次 runner/contract 代码提交：

`CODE_EVIDENCE_HEAD = fec4b83acb3c0dfe654d27ed005dcde2f93dfaaf`

提交信息：`fix(shell): prevent automatic choice selection in wave 5c runner`

### 9.2 唯一一次正式 Electron 运行

本轮只使用仓库实际存在的命令，没有修改 `packages/shell/package.json`，也没有使用不存在的连字符命令：

```text
npm run e2e:player-experience:wave5c -w @surdet/shell
```

该命令重新构建并使用正式入口：

`E:\surdet\examples\zero-after-midnight\dist`

使用 2 个独立 Electron session 和独立临时 userData。命令 exit 1；这是本轮唯一真实 Electron 运行。新 artifact 失败后立即停止，没有再次修改 runner，也没有再次运行寻找绿色结果。此前 rIKJIY、VnMuGB 等失败 artifact 均继续保留。

最新 artifact：

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-wNkaxI\wave-5c-rollback-restore-atomicity.json`
- 字节数：`3,818,391`
- SHA-256：`CBCB5D2F79E04AF84F5651417AC535B796C9BD06839D941CCB4A67BE925D8EAA`
- `status=FAILED`
- `ARTIFACT_HEAD=fec4b83acb3c0dfe654d27ed005dcde2f93dfaaf`
- `execution.actualSessions=2`
- `execution.actualAttempts=12`（Case A=12，Case B=0）
- `execution.regularScreenshots=2`
- `pageErrors=0`、`consoleErrors=0`、`requestFailures=0`、`unhandledRejections=0`、`rendererErrors=0`、`releaseFailures=0`、`unexpectedWindowClosed=0`

### 9.3 Case A

Case A `prologue-rapid-rollback` 完整通过：

- `ok=true`；12/12 `validHistory=true`；2 条 Fade 稳定性观察；2 张截图；
- 沿用真实 `rail:rollback` 与 Fade/visualThumbnail 证据；本次没有新增回退次数或截图数量；
- `start.png`：877816 bytes，SHA-256 `2D9275C4356957C11F89FF1AC89112C4A33A7FE1645D0471FBF0A38023D1B70C`；
- `end.png`：878228 bytes，SHA-256 `752E0B3915648A1A6DDA3C3B95799531433FB12B44F2D573C86155907B4370D1`；
- 两张截图均存在，artifact 中的 `screenshotSha256` 与磁盘哈希一致；
- 错误通道全部为空。

### 9.4 Case B：自动选择已消失，但目标可见 choice 合同未完成

本次 Case B 使用 `advanceTextOne()` 后确实到达了目标场景和 Core/Renderer 选择状态，但公开语义快照没有满足完整目标合同：

- 场景：`common_0017`；
- `pc=32`；
- Core：`awaiting-choice`；
- Renderer：`choice`；
- 三条 choice label 完整匹配：
  - `记录她说的时间`
  - `追问失踪的原因`
  - `先挂断电话`
- `choiceBounds.length=3`；
- 但 `visibleChoiceCount=1`，任务书要求为 `3`；
- 因此 `advanceTextOne()` 在下一轮检查时按设计停止，未发送数字键，未自动选择，未进入 `waitChoice()` 后的真实 `page.mouse.click()`；
- Case B 真实 choice 点击：0；真实 rail 回退：0；attempts/observations/screenshots：均为 0；
- 最后快照已完整写入 artifact，包含场景、Core/Renderer 状态、labels、bounds、背景、立绘、表现、资源快照和错误通道。

这不是产品绿灯，也不是幽灵 choice 已被否定。它证明本轮已移除 runner 的自动 `1` 选择路径，但正式 Case B 仍因 `visibleChoiceCount=1` 与目标合同的 `3` 不一致而阻断。由于本轮规定失败后停止，不对该新观察做猜测性生产修复或 runner 修正。

### 9.5 三个 HEAD 与资格结论

- `CODE_EVIDENCE_HEAD`：`fec4b83acb3c0dfe654d27ed005dcde2f93dfaaf`；实际被测 runner/contract 修正提交；
- `ARTIFACT_HEAD`：`fec4b83acb3c0dfe654d27ed005dcde2f93dfaaf`；新 artifact 内真实记录的 HEAD；
- `DOCUMENT_CLOSURE_HEAD`：本报告与计划本次普通文档提交；精确 SHA 以提交后 `git rev-parse HEAD` 和最终交付回报为准。

虽然 `CODE_EVIDENCE_HEAD == ARTIFACT_HEAD`，但 Case B 没有完成目标 choice 的真实鼠标点击、回退和第二次 choice 点击，因此不得写：

```text
WAVE_5C_FORMAL_EVIDENCE_QUALIFIED
```

也不得写“玩家幽灵选择已完全修复”或“玩家黑屏根因已确认”。必须继续保留：

```text
ROLLBACK_TRANSIENT_FADE_CHECKPOINTS_BLOCKED
LOAD_RESTORE_INTERACTIVE_TRANSIENTS_CLEARED
PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED
PLAYER_BLACK_SCREEN_AWAITING_MANUAL_VALIDATION
CASE_B_FORMAL_EVIDENCE_BLOCKED
```

普通 save/quick-save 在 Fade 活动期间的表现快照语义仍不属于本轮已验证范围。

### 9.6 本轮门禁、Git 与停止状态

- Shell Wave 5C contract：9/9；
- `node --check packages/shell/e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs`：exit 0；
- Shell typecheck：exit 0；
- Shell build：exit 0；
- 正式 Wave 5C Electron E2E：exit 1，失败 artifact 已保留，未重跑；
- 本轮按范围未重新运行根级 `npm run verify:all`；此前生产修复及全量门禁仍由前一轮代码 HEAD 复核通过；
- 代码提交后 HEAD：`fec4b83acb3c0dfe654d27ed005dcde2f93dfaaf`；提交前相对 `surdet/main`：`13 0`；
- 文档提交前工作树仅有六个受保护未跟踪文件；它们未被修改、暂存、提交、删除或移动；
- 未 push、未部署、未发行、未打包、未开始 Wave 5B、未开始 M9、未处理性能或其他产品功能。

最终状态：

```text
WAVE_5C_PHASE_2_FINAL_EVIDENCE_ATTEMPT_COMPLETE
NOT_PUSHED
WAVE_5B_NOT_STARTED
WAITING_FOR_INDEPENDENT_REVIEW
```

## 11. Case B runner 最小语义修正与一次最终验证

本节是当前 Wave 5C Phase 2 的最新权威事实，覆盖前文关于当前 runner、当前 artifact、当前代码 HEAD 和资格状态的字段。前文所有失败 artifact、截图和提交记录均继续保留，不删除、不覆盖、不重跑挑绿。

### 11.1 合法红灯与最小修正

旧 Runner 在 Case B 中使用：

```text
const rollbackTargets = [branchStep.before, selected]
```

并将第二次回退要求为 `selected` 的位置。该模型错误地把一个较晚状态当作第二次回退的预设目标；它不是引擎行为红灯，而是 Runner 对历史方向的错误假设。

本轮先增加静态合同测试，旧 Runner 上得到合法红灯：

- Shell Wave 5C contract：11 项中 1 项失败、10 项通过、exit 1；
- 失败点明确是当前 source 仍包含固定 `rollbackTargets` 序列；
- 没有修改生产代码来制造红灯。

最小修正后，同一合同转绿：

- Shell Wave 5C contract：11/11、exit 0；
- `node --check packages/shell/e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs`：exit 0；
- Shell typecheck：exit 0；
- Shell build：exit 0。

修正后的 Case B 每次回退均采用观察型验证：

1. 记录回退前完整 snapshot 和 canvas metrics；
2. 通过公开 `rail:rollback` target 执行真实 `page.mouse.click()`；
3. 只等待当前位置相对回退前发生变化，不等待预设 pc；
4. 调用既有 `waitGameStable()`，等待恢复稳定；
5. 读取回退后 snapshot 和 canvas metrics；
6. 验证 `sameScene`、前后 pc 均为数字、`positionChanged`、`movedBackward`、`stableAfterRestore`、`noStaleChoice` 和视觉不变量；
7. 将结果写入 `rollbackInvariant`、`before`、`after`、`frameSamples`，不再用 misleading 的固定 `expected` 快照表示预知历史位置。

本轮代码提交：

```text
CODE_EVIDENCE_HEAD=5eb55227fe5b6ff1fdb0578980d32204fb6c3357
fix(shell): validate observed choice rollbacks
```

实际代码改动仅为：

- `packages/shell/e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs`
- `packages/shell/test/player-experience-wave-5c-e2e-contract.test.ts`

没有修改 Host、Renderer、Core、Starter、CLI、Zero 生产代码，也没有修改 `packages/shell/package.json`。

### 11.2 唯一一次正式 Electron 验证

代码提交后只执行一次仓库现有正式脚本：

```text
npm run e2e:player-experience:wave5c -w @surdet/shell
```

该次运行重新构建 Core、Renderer、Host、Shell 和《零点之后》，使用正式入口：

```text
E:\surdet\examples\zero-after-midnight\dist
```

使用两个独立 Electron session 和独立临时 userData，没有复用旧 dist、旧 artifact 或旧截图。命令 exit 0；按照任务书，本轮不再重复运行 Electron。

最新正式 artifact：

- 路径：[wave-5c-rollback-restore-atomicity.json](<C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-VVls8U\wave-5c-rollback-restore-atomicity.json>)
- 字节数：`4,314,660`
- SHA-256：`4AC9C59943D27CFDA71AA4C7D5B6775E69E212111FDD0823AF9AEFABC1AB25C9`
- `status=PASSED`
- `ARTIFACT_HEAD=5eb55227fe5b6ff1fdb0578980d32204fb6c3357`
- `execution.actualSessions=2`
- `execution.actualAttempts=14`（Case A=12，Case B=2）
- `execution.regularScreenshots=4`

artifact 的事件总计全部为 0：

```text
pageErrors=0
consoleErrors=0
requestFailures=0
unhandledRejections=0
rendererErrors=0
releaseFailures=0
unexpectedWindowClosed=0
```

### 11.3 Case A 与 Case B 结果

Case A `prologue-rapid-rollback`：

- `ok=true`；12/12 次 `validHistory=true`；
- 每次回退均按历史位置递减；
- 12 次回退没有 black-screen/gradual-dark、背景丢失、立绘丢失或 Fade boundary mismatch；
- 错误通道全部为空。

Case B `common-0017-choice-rollback`：

- `ok=true`；2/2 次 `validHistory=true`；
- 第一次真实 choice 点击：`choice:0`，`page.mouse.click`，坐标 `{x:632,y:351.85}`，时间 `2026-08-12T11:23:29.799Z`；
- 第一次观察型回退：`common_0017 pc=39 → pc=38`；
- 第二次观察型回退：`common_0017 pc=38 → pc=31`；
- 两次回退均满足：`sameScene=true`、`positionChanged=true`、`movedBackward=true`、`stableAfterRestore=true`、`noStaleChoice=true`；
- 两次回退的 `choiceMismatch` 各字段均为 `false`；
- 两次回退的视觉 mismatch 各字段均为 `false`，没有黑屏或显著渐暗；
- 回退后重新通过真实普通文本推进抵达同组三选一，并完成第二次真实 choice 点击：`choice:0`，`page.mouse.click`，坐标 `{x:632,y:351.85}`，时间 `2026-08-12T11:23:32.909Z`；
- 没有使用数字键、Enter、debug action、直接 Interpreter 调用或其他自动选择 shortcut。

四张当前 artifact 截图均已从磁盘核对存在，字节数和 SHA-256 与 artifact 记录一致：

| 截图 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `prologue-rapid-rollback/screenshots/start.png` | 877,859 | `8A6CA5CEE089232B3608A5C8786BF605361251E2746F04F755BD06063240D7C8` |
| `prologue-rapid-rollback/screenshots/end.png` | 878,228 | `752E0B3915648A1A6DDA3C3B95799531433FB12B44F2D573C86155907B4370D1` |
| `common-0017-choice-rollback/screenshots/start.png` | 990,004 | `42594ED7ED49E3E733C0932D41549A4A82AB9B52C6497A888E9FEEF33CA8AA3B` |
| `common-0017-choice-rollback/screenshots/end.png` | 983,307 | `BE0EE39CDAAC35738E0635CE1E6F64B0A6E433B71591953F28F52712B2A234F5` |

### 11.4 三个 HEAD 与资格结论

```text
CODE_EVIDENCE_HEAD=5eb55227fe5b6ff1fdb0578980d32204fb6c3357
ARTIFACT_HEAD=5eb55227fe5b6ff1fdb0578980d32204fb6c3357
DOCUMENT_CLOSURE_HEAD=本次普通文档提交；精确完整 SHA 以提交后 git rev-parse HEAD 为准
```

`CODE_EVIDENCE_HEAD == ARTIFACT_HEAD`，且 Case A/B 均完整完成，因此本轮可以标记：

```text
WAVE_5C_CASE_B_FORMAL_EVIDENCE_QUALIFIED
```

但这不等于玩家黑屏问题已经由自动化彻底证明修复。用户已经在正式游戏中报告过黑屏现象，仍需部署后的人工实机复测，因此继续保留：

```text
PLAYER_BLACK_SCREEN_FIX_AWAITING_MANUAL_VALIDATION
GHOST_CHOICE_FIX_AWAITING_MANUAL_VALIDATION
```

普通 save/quick-save 在 Fade 活动期间的表现快照语义不属于本轮验证范围；本轮也没有修改性能、存档格式、剧情、DSL、资产、音频或发行流程。

### 11.5 本轮 Git 与停止状态

- 代码提交前 HEAD：`5eb55227fe5b6ff1fdb0578980d32204fb6c3357`；相对 `surdet/main=17 0`；
- 文档提交将在本节之后创建一个普通本地提交；其完整 SHA 以提交后只读 `git rev-parse HEAD` 为准；
- 旧的 jhI6dG 失败 artifact 及此前全部失败 artifact 均保留；
- 本轮没有运行根级 `npm run verify:all`，不伪称本轮重新执行；本轮范围内 Shell contract、语法、typecheck、build 和唯一正式 Electron 均通过；
- 未 push、未部署、未发行、未打包、未开始 Wave 5B、未开始 M9、未处理性能。

本轮最终状态：

```text
WAVE_5C_CASE_B_FORMAL_EVIDENCE_QUALIFIED
PLAYER_BLACK_SCREEN_FIX_AWAITING_MANUAL_VALIDATION
GHOST_CHOICE_FIX_AWAITING_MANUAL_VALIDATION
NOT_PUSHED
WAVE_5B_NOT_STARTED
WAITING_FOR_INDEPENDENT_REVIEW
```

## 10. Case B choice 入场稳定判定修正与最后一次有效正式验证

本节是当前执行轮次的最新事实，覆盖第 9 节中关于当前 runner、当前 artifact 和当前代码证据的字段；第 9 节及更早章节的 artifact、截图和失败记录全部保留为历史证据，不删除、不覆盖、不重跑挑绿。本轮仍只修改 Shell runner 与 Shell contract，未修改 Host、Renderer、Core、Starter、CLI、Zero 生产代码。

### 10.1 先红后绿：候选态与稳定态分离

独立复审核实，上一轮 runner 在看到目标 choice 时会继续推进，或者把“刚进入 choice”与“choice 三个卡片均已可见”混成一个等待条件。本轮先增加了正式 contract，要求 runner 明确分离两种状态：

- `isTargetChoiceCandidate(snapshot)` 只确认场景 `common_0017`、Core `awaiting-choice`、Renderer `choice`、三条正式 label 和三个公开 choice bounds；它不把 `visibleChoiceCount === 3` 当作入场瞬间必须成立的条件；
- `waitChoice()` 在 candidate 之后等待稳定投影，另外要求 Core `awaiting-choice`、Renderer `choice`、`visibleChoiceCount === 3`、`choiceBounds.length === 3` 和三条正式 label；
- 所有真实 choice 仍只通过公开 `choice:0` target 与 `page.mouse.click()`，没有新增键盘选择或 debug shortcut。

生产修改前，同一 Shell Wave 5C contract 为 10 项、1 项失败、exit 1；失败原因是 runner 尚无 `isTargetChoiceCandidate()`、`choiceCandidateSnapshot` 与 `choiceSettledSnapshot` 这组稳定入场合同。完成最小 runner 修改后，同一 contract 为 10/10、exit 0。`node --check`、Shell typecheck 和 Shell build 也均为 exit 0。

本轮 runner/contract 普通代码提交为：

```text
CODE_EVIDENCE_HEAD=e5d0d6f3d55fcc9da89c5409fef53a034257d508
fix(shell): wait for settled wave 5c choices
```

本次代码提交实际修改文件仅为：

- `packages/shell/e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs`
- `packages/shell/test/player-experience-wave-5c-e2e-contract.test.ts`

### 10.2 唯一一次正式 Electron 运行

按照本轮授权，只运行了一次仓库现有正式脚本：

```text
npm run e2e:player-experience:wave5c -w @surdet/shell
```

使用正式入口 `E:\surdet\examples\zero-after-midnight\dist`、两个独立 Electron session 和独立临时 `userData`。代码提交后重新构建，没有复用旧 dist、旧 artifact 或旧截图。该命令 exit 1 后立即停止；没有再次修改 runner，也没有再次运行 Electron 寻找绿色结果。旧的 rIKJIY、VnMuGB、wNkaxI 等 artifact 和截图均继续保留。

当前唯一一次有效正式 artifact：

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-5c-jhI6dG\wave-5c-rollback-restore-atomicity.json`
- 字节数：`4,314,660`
- SHA-256：`5D6046F2767492C51FD79FD3C26065AC7C4161B9077C09F3F43EB0757A2593E6`
- `status=FAILED`
- `ARTIFACT_HEAD=e5d0d6f3d55fcc9da89c5409fef53a034257d508`
- `execution.requestedCases=2`
- `execution.actualSessions=2`
- `execution.actualAttempts=13`（Case A=12，Case B=1）
- `execution.regularScreenshots=3`
- `pageErrors=0`、`consoleErrors=0`、`requestFailures=0`、`unhandledRejections=0`、`rendererErrors=0`、`releaseFailures=0`、`unexpectedWindowClosed=0`

artifact 生成后已从磁盘读取并核对字节数与 SHA-256；artifact 内记录的 `head` 与当前被测代码提交完全一致。

### 10.3 Case A 与 Case B 的逐步结果

Case A `prologue-rapid-rollback` 完整通过：

- `ok=true`；12/12 次真实 `rail:rollback`；12/12 `validHistory=true`；2 条观察、2 张截图；
- 没有 visual mismatch，全部错误通道为空；
- 活动 Fade 与稳定 checkpoint 的既有证据仍保留，本轮没有扩大回退次数或截图数量。

本轮 Case A 截图均存在，artifact 记录与磁盘核对一致：

| 截图 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `prologue-rapid-rollback/screenshots/start.png` | 877,848 | `CCA6FEAE9CE5CBB67AB239500BC0F1C4B02300C0DE2710C463E113980493D301` |
| `prologue-rapid-rollback/screenshots/end.png` | 878,233 | `316CA3BB12C01B2385785DD9E85F51563455604639FDA43EF875F0041669B39E` |

Case B `common-0017-choice-rollback` 的实际证据如下：

1. runner 先观察到合法 candidate：`sceneId=common_0017`、`pc=32`、Core=`awaiting-choice`、Renderer=`choice`、3 条正式 label、3 个 bounds，但 `visibleChoiceCount=1`。
2. 随后的稳定等待成功：同一 `pc=32` 上 `visibleChoiceCount=3`，三条 label 和三个 bounds 均满足合同。
3. 第一次真实 choice 已完成：`choice:0`，输入为 `page.mouse.click`，坐标为 `{x:632,y:351.85}`，时间戳为 `2026-08-12T11:00:24.573Z`。
4. 第一次真实回退观察有效：从 `common_0017 pc=39` 回到 `common_0017 pc=38`，`validHistory=true`，没有 choice mismatch 或 visual mismatch。
5. 随后等待第二次回退目标时，在 `runChoiceCase` 的第二次 rollback target 等待处超时（artifact failure stack 指向 runner 第 776 行的 `choice rollback target 1` wait）。最后快照为 `common_0017 pc=38`、Core=`awaiting-advance`、Renderer=`typing`、`visibleChoiceCount=0`、空 label、空 bounds。
6. 因此第二次真实 choice 鼠标点击没有发生，Case B 仅完成 1 次 rollback attempt，`observations=0`、`screenshots=1`，没有形成完整的 Case B 正式验证。

Case B 截图仍原样保留：

| 截图 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `common-0017-choice-rollback/screenshots/start.png` | 990,004 | `42594ED7ED49E3E733C0932D41549A4A82AB9B52C6497A888E9FEEF33CA8AA3B` |

这次运行没有观察到幽灵 choice，但由于回退后的完整交互路径未完成，不能把它解释为幽灵 choice 已被排除，也不能把玩家黑屏或幽灵 choice 根因写成已确认、已修复。失败 artifact 已保留，未通过删异常、放宽稳定条件或再次重跑来取得绿灯。

### 10.4 三个 HEAD 与资格结论

```text
CODE_EVIDENCE_HEAD=e5d0d6f3d55fcc9da89c5409fef53a034257d508
ARTIFACT_HEAD=e5d0d6f3d55fcc9da89c5409fef53a034257d508
DOCUMENT_CLOSURE_HEAD=本次普通文档提交；精确完整 SHA 以提交后 git rev-parse HEAD 为准
```

`CODE_EVIDENCE_HEAD == ARTIFACT_HEAD`，所以代码与最新 artifact 的提交绑定条件满足；但是 Case B 没有完成第二次真实 choice 鼠标点击及其后的完整回退检查，故本轮不得写 `WAVE_5C_FORMAL_EVIDENCE_QUALIFIED`。

必须继续保留以下边界：

```text
ROLLBACK_TRANSIENT_FADE_CHECKPOINTS_BLOCKED
LOAD_RESTORE_INTERACTIVE_TRANSIENTS_CLEARED
PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED
PLAYER_BLACK_SCREEN_AWAITING_MANUAL_VALIDATION
CASE_B_FORMAL_EVIDENCE_BLOCKED
```

普通 save/quick-save 在 Fade 活动期间的表现快照语义不属于本轮已验证范围。`rollback.push(frame)` 的周期边界历史修复仍可写为 `CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED`；`restoring` 仍是 `DEFENSIVE_REENTRY_GUARD_ADDED`，其 mock reentry 测试是防御性 future-invariant 证据，不是真实玩家调用链根因复现。

### 10.5 本轮验证、Git 与停止状态

- Shell Wave 5C contract：先红 10 项中 1 项失败，后绿 10/10；
- `node --check packages/shell/e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs`：exit 0；
- Shell typecheck：exit 0；Shell build：exit 0；
- 正式 Wave 5C Electron E2E：exit 1，失败 artifact 已保留，未重跑；
- 本轮未重新运行根级 `npm run verify:all`，不伪称本轮重新执行；此前生产修复与全量门禁结果继续作为既有证据引用；
- 文档提交前 `git rev-parse HEAD`：`e5d0d6f3d55fcc9da89c5409fef53a034257d508`；`HEAD...surdet/main=15 0`；
- 文档提交前工作树只包含六个受保护未跟踪文件；未修改、暂存、提交、删除或移动任何一个；
- 未 push、未部署、未发行、未打包、未开始 Wave 5B、未开始 M9、未处理性能或其他产品功能。

本轮最终状态：

```text
WAVE_5C_PHASE_2_FINAL_EVIDENCE_ATTEMPT_COMPLETE
NOT_PUSHED
WAVE_5B_NOT_STARTED
WAITING_FOR_INDEPENDENT_REVIEW
```
