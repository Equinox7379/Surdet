# Surdet Player Experience Hotfix Wave 2
# Final Remediation Report

日期：2026-08-11
状态：PLAYER_EXPERIENCE_HOTFIX_WAVE_2_FINAL_REMEDIATION_COMPLETE

本文件是 Wave 2 最终微型收口的权威入口。原
ENGINE-PLAYER-EXPERIENCE-HOTFIX-WAVE-2-DELIVERY-REPORT-2026-08-11.md
保留为 Wave 2 历史交付记录，不覆盖本文件。

## 1. 范围与 Git 起点

本轮严格只处理总经理独立复审指出的两个阻断项：

1. host-transaction pending 期间，有效存档/读档槽位重复点击会再次调用宿主 handler；
2. 最终整改报告声称已生成，但文件实际不存在。

没有进入 M9，没有处理性能工作，没有重新采样 Q1–Q5，没有修改性能 artifact 或门限，没有修改存档格式、DSL、剧情、美术、音频、Backlog 架构或公共 PlayerUiSession 设计。

本轮起始复核：

- 起始 HEAD：31fadc6754fbdb7655e91159974f5f767e9de3c1
- 起始 HEAD...surdet/main：22 0
- 起始工作树：只有 SESSION-HANDOFF.md、USER.md 及两份艺术总监交接文档四个受保护未跟踪文件；它们未被修改、暂存、提交、删除或移动。

最终实现/测试提交（报告提交前）：

- a68b8a989da476737113b0d53066b446480a8198 — fix(renderer): guard pending save load selection
- 2078538 — test(renderer): cover save load transaction rollback
- 25014e99dce50a3c6106d60489e3c054d7c2bf9b — test(renderer): align save load selection contract

本报告自身的文档提交会在正文写入后产生新的最终 HEAD；最终完整 SHA、提交后的 ahead/behind、工作树和报告文件校验值以本文件提交后的交付核对为准，并在最终交付回报中逐项列出。

## 2. Task A：pending 期间重复有效槽位点击

### 2.1 修复前红灯

先加入真实有效槽位回归测试，再运行生产代码未修改时的聚焦命令：

    npm run test -w @surdet/renderer -- --run test/legacy/menu-layer.test.ts

红灯事实：

- 测试文件：24 项；23 通过、1 失败；
- 测试场景：同一个真实“空槽位”卡片在 deferred Promise settlement 前连续点击三次；
- 期望：onSelect 一次；
- 实际：onSelect 三次；
- 失败断言：expected "spy" to be called once, but got 3 times。

这证明问题是有效存档/读档槽位 handler 的真实重复调用，而不是只涉及关闭按钮或背景点击。

### 2.2 生产修复

packages/renderer/src/layers/menu/menu-layer.ts 的 host-transaction 路径现在遵守以下顺序：

1. 在调用宿主 onSelect 之前取得 save-load pending 所有权；
2. handler 入口发现已有 pending 时消费当前 pointer、停止事件传播并立即返回；
3. pending 期间不再次调用 onSelect，不关闭 save/load 页面，不恢复 command rail，不改写当前 pending 所有权；
4. Promise resolve 为 true 时只清理一次、关闭一次、调用 onTransactionComplete 一次；
5. Promise resolve 为 false 时清理 pending 但保留页面，允许下一次选择；
6. Promise reject 时清理 pending、报告一次错误、保留页面，允许下一次选择；
7. handler 同步抛错或返回非 Promise 时先回滚 pending，再通过既有错误报告路径报告，错误没有被静默吞掉。

没有使用 debounce、固定延时、hide/show 伪装或临时销毁按钮；RendererFacade 的既有 pending 语义保持不变，MenuLayer 在入口先行取得所有权，因此不会再让宿主状态机收到第二次 begin-operation。

### 2.3 修复后绿灯

最终 packages/renderer/test/legacy/menu-layer.test.ts 聚焦测试为 25/25 通过，覆盖：

- deferred Promise pending 期间连续点击同一个真实有效槽位至少两次；
- onSelect 恰好一次；
- 实际 PlayerUiSession.beginOperation('saving') 恰好一次；
- save/load overlay 仍保持可见；
- command rail 保持隐藏，未提前 restore；
- resolve true 后页面、完成回调和 command rail restore 各只发生一次；
- resolve false 后页面保留并可再次选择；
- reject 后页面保留、onTransactionError 恰好报告一次并可再次选择；
- 同步抛错后 pending 所有权回滚，页面保留且后续选择可继续；
- 非 Promise 返回被报告为错误，pending 回滚且页面保留。

测试夹具使用 packages/host/src/player-ui.ts 导出的真实 createPlayerUiSession，不是只用一个最终值哨兵。Starter/Zero 的正式玩家路径仍使用同一 @surdet/host PlayerUiSession；本轮没有创建第二套会话状态机。

## 3. Task B：最终报告已真实落盘

已创建本文件：

    E:\surdet\docs\ENGINE-PLAYER-EXPERIENCE-HOTFIX-WAVE-2-FINAL-REMEDIATION-REPORT-2026-08-11.md

创建后将以磁盘文件为对象重新读取、检查字节数并计算 SHA-256。由于把文件自身的 SHA-256 文本写回文件会改变文件本身的摘要，本报告不伪造自引用摘要；最终磁盘字节数与 SHA-256 由创建/提交后的独立核验命令读取，并随最终交付回报记录。

## 4. 已确认的 Wave 2 结构事实

以下内容按整改后的仓库与正式运行时事实记录，不沿用过期文件名或旧描述：

- UX-06 的最终结构是 dialogue content root + dialogue overlay root；
- Backlog 位于 dialogue overlay root，并保持在普通对话内容之上；
- commandRailVisible 来自真实 Renderer projection/query，而不是宿主自行维护的影子布尔值；
- PlayerUiSession 与 PlayerInputGate 均位于 @surdet/host 的 packages/host/src/player-ui.ts；
- examples/zero-after-midnight/src/player-ui-session.ts 不存在；
- examples/zero-after-midnight/src/player-input-gate.ts 不存在；
- 《零点之后》入口通过 @surdet/host 使用共享 PlayerUiSession / PlayerInputGate；
- 本轮没有修改 DialogueLayer、Backlog 层级、Renderer command rail、Host 公共状态机或存读档 API。

## 5. 正式游戏玩家矩阵

### 5.1 本轮新增 A–I 矩阵

新增矩阵由独立 Electron、独立临时 userData 运行，明确加载正式游戏 dist：

- 游戏：《零点之后》
- sourceRoot：E:\surdet\examples\zero-after-midnight
- distRoot：E:\surdet\examples\zero-after-midnight\dist
- 顶层场景数：9（A–I）
- unique userData：9
- 状态：PASSED
- 证据 JSON：C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-D5kEuc\task7-player-experience-matrix.json
- 本轮证据 SHA-256：EF7F15ECF2DF49FAA5A215D69EA8783F3F80E70E29ED7230D31EF973EBC10491

A–I 每一项均为 ok=true，每一项的下列计数均为 0：

- page errors；
- console errors；
- failed requests；
- unhandled rejections；
- runtime errors；
- renderer release failures。

矩阵覆盖了标题/鉴赏、系统菜单/Backlog/设置、rollback、界面隐藏恢复、空读档槽位连点、存读档顺序、读档后回标题/重新开始、已知正常对照路径以及连续十句逐帧采样。受控 deferred 双击的决定性证据来自 Renderer 25/25 直接回归测试，不以普通速度 E2E 替代。

### 5.2 最终权威历史两轮

整改前的 jy037r、Qbo9QI、KkP9lN 只保留为历史证据，不称为最终矩阵。

整改后的两轮权威矩阵为：

- DtjHPd
  - JSON：C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-DtjHPd\task7-player-experience-matrix.json
  - SHA-256：28FFBB1A3FF2EAA5671DE79BD90E03DF80248ECDCD1EDE2176513BA2B737598C
- zSiTX2
  - JSON：C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-zSiTX2\task7-player-experience-matrix.json
  - SHA-256：38FE8420F2B2B6CAF5CBD0A49B4BE24520D49A27BE9950383875913D880372B2

本次 D5kEuc 是在最终微型修复后的新增确认轮，不覆盖上述两轮历史权威记录。

## 6. 正式游戏静态与无头验收

最终门禁保持：

- 11 个正式场景；
- 23/23 choice 分支；
- 3 个结局；
- 44 项资产；
- 0 个 lint errors；
- 0 个 lint warnings；
- 0 个模拟运行时错误；
- 39 次 save/load smoke 通过。

正式 zero-after-midnight lint、simulate、asset check、typecheck、build 均通过；本轮没有修改任何正式剧情、资产注册或资源路径。

## 7. 最终门禁记录

以下命令在最终代码/测试提交上已重新执行并通过：

    npm run test -w @surdet/renderer -- --run test/legacy/menu-layer.test.ts
    npm run test -w @surdet/renderer
    npm run test -w @surdet/host
    npm run test -w surdet-starter
    npm run test -w zero-after-midnight

    npm run typecheck -w @surdet/renderer
    npm run typecheck -w @surdet/host
    npm run typecheck -w @surdet/shell
    npm run typecheck -w surdet-starter
    npm run typecheck -w zero-after-midnight

    npm run build -w @surdet/renderer
    npm run build -w @surdet/host
    npm run build -w @surdet/shell
    npm run build -w surdet-starter
    npm run build -w zero-after-midnight

    npm run verify:renderer-boundaries
    npm run verify:renderer-legacy
    npm run verify:tools
    npm run verify:hygiene
    npm run verify:all
    npm run e2e -w @surdet/shell
    npm run e2e:renderer-v2 -w @surdet/shell
    npm run e2e:player-experience -w @surdet/shell
    git diff --check
    git ls-files '*.log'

结果摘要：

- npm run verify:all：退出码 0；
- Renderer boundaries：3/3；
- Renderer legacy：4/4；
- tools：10/10；
- tracked hygiene：587 个路径通过；
- Shell 基础 Electron E2E：通过；
- Renderer v2 Electron E2E：通过，视觉截图全部保留为 CANDIDATE，未冒充永久金样；
- Player Experience Electron E2E：通过，正式游戏矩阵 A–I 9/9；
- git diff --check：通过；
- git ls-files '*.log'：空。

## 8. Git 交付闭环

报告提交前的最终实现/测试 HEAD：

    25014e99dce50a3c6106d60489e3c054d7c2bf9b

报告提交前：

    HEAD...surdet/main = 25 0
    git status --short =
    ?? SESSION-HANDOFF.md
    ?? USER.md
    ?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
    ?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md

本文件是唯一新增的交付文档；提交后 git status --short 仍应只保留上述四个受保护未跟踪文件。四个文件不得修改、暂存、提交、删除、移动或推送。

## 9. 最终限制与停止状态

- 未 push；
- 未 force push；
- 未开始 M9；
- 未处理性能工作；
- 未重新采样 Q1–Q5；
- 未修改性能 artifact 或门限；
- 未正式发行；
- 未重新打包正式发行文件；
- 未修改四个受保护文件。

最终状态：

    PLAYER_EXPERIENCE_HOTFIX_WAVE_2_FINAL_REMEDIATION_COMPLETE
    ENGINE_PLAYER_UI_COORDINATION_VERIFIED
    UX_06_VERIFIED
    SAVE_FAILURE_PROPAGATION_VERIFIED
    DUPLICATE_SAVE_LOAD_SELECTION_GUARDED
    FINAL_REPORT_VERIFIED_ON_DISK
    PERFORMANCE_WORK_DEFERRED
    M9_NOT_STARTED
    NOT_PUSHED
    WAITING_FOR_REVIEW
