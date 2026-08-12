# Surdet Player Experience Wave 5C

## Rollback Restore Atomicity — 诊断交付报告

日期：2026-08-12  
状态：`WAVE_5C_DIAGNOSIS_COMPLETE`  
停止点：`WAITING_FOR_INDEPENDENT_REVIEW`

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

## 2. 代码与提交边界

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

## 6. 最终状态

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

