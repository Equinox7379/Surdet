# Surdet Player Experience Wave 5C

## Rollback Restore Atomicity

本文件是 Wave 5C 的执行计划与持久化台账。唯一执行顺序为 Task 0 → Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8。任何阶段在聚焦证据、测试和台账未完成前不得进入下一阶段。

## 目标与问题边界

本轮处理《零点之后》真实玩家反馈对应的公共回退恢复问题，保留玩家反馈作为有效红灯，即使固定自动化协议没有复现，也不得据此宣布问题不存在。

必须原样保留的两条症状描述：

1. **渐进型或瞬发型黑屏**：开始游戏后推进到可回退文本，连续快速回退时画面可能逐次变暗或直接黑屏；逻辑、菜单仍可操作，切换场景后画面恢复。
2. **回退后的不可点击幽灵选择枝**：回退跨过选择后，旧选择 UI 可能仍可见但不可点击，点击不产生合法选择变化而对话继续推进；新的真实选择出现后恢复可点击。

本轮的最终结论必须区分：自动化证据、公共层修复证据和玩家黑屏根因是否已被证实。不得把一次未复现写成玩家问题已消失。

## 继承状态（Wave 5A）

以下状态从 Wave 5A 继承，不得被本轮覆盖或弱化：

- \`CYCLE_BOUNDARY_HISTORY_FIX_VERIFIED\`
- \`DEFENSIVE_REENTRY_GUARD_ADDED\`
- \`PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED\`
- Wave 5A 固定 8 session × 20 rollback（160/160）协议未复现黑屏，但不等于真实玩家黑屏已修复。

Wave 5A 历史 artifact 继续保留，不能覆盖、删除或重新标记为 Wave 5C 证据。

## Frozen scope and safety

不得开始 Wave 5B；不得做 M9、性能测量或优化、旧版正式 A/B、音频/美术/剧情、DSL、存档格式、文档治理、EXE 打包、发行或 push。

不得 reset、rebase、checkout、clean、amend、squash、cherry-pick 或历史改写。不得通过延时、debounce、隐藏错误、永久 ticker、强制提亮、Zero 特例、第二套回退算法或新的兼容层伪装修复。

以下文件始终受保护，不得修改、暂存、提交、删除或移动：

- \`AGENTS.md\`
- \`SESSION-HANDOFF.md\`
- \`USER.md\`
- \`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md\`
- \`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md\`
- \`docs/superpowers/plans/2026-08-12-player-experience-wave-5b-layout-polish.md\`

允许的生产范围仅限有直接证据的公共 Host/Renderer 回退恢复实现；Shell 只可增加真实正式入口诊断；Zero 只可做接线或只读诊断，不能创建游戏专属回退算法。

候选文件（不表示全部必须改动）：

- \`packages/host/src/rollback-runtime.ts\`
- \`packages/host/test/rollback-runtime.test.ts\`
- \`packages/renderer/src/runtime/presentation-controller.ts\`
- \`packages/renderer/src/layers/world/world-layer.ts\`
- \`packages/renderer/src/layers/dialogue/dialogue-layer.ts\`
- \`packages/renderer/src/api/renderer-queries.ts\`
- \`packages/renderer/src/pixi-stage-host.ts\`
- \`packages/renderer/test/legacy/presentation-controller.test.ts\`
- \`packages/renderer/test/layers/world-layer.test.ts\`
- \`packages/renderer/test/legacy/dialogue-layer.test.ts\`
- \`packages/renderer/test/integration/presentation-clear.test.ts\`
- \`packages/renderer/test/world-effects-controller.test.ts\`
- \`packages/shell/package.json\`
- \`packages/shell/e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs\`
- \`packages/shell/test/player-experience-wave-5c-e2e-contract.test.ts\`
- \`examples/zero-after-midnight/src/main.ts\`
- \`examples/zero-after-midnight/src/surdet-window.d.ts\`
- \`examples/zero-after-midnight/test/player-ui-integration.test.ts\`
- 本计划与 Wave 5C 交付报告

所有大 JSON、截图和失败证据写入系统临时目录。Wave 5C 正式诊断每次最多保留：开始代表图 1 张、恢复代表图 1 张、每类失败最多额外首个异常图 1 张；不得重新生成 Wave 5A 的 640 张截图，也不得覆盖历史证据。

## Task 0 — 冻结起点、建立台账

### 必做动作

- 只读阅读 Wave 5A report、Wave 5A plan 和受保护的 Wave 5B plan；不得改动它们。
- 记录真实 \`git rev-parse HEAD\`、\`git log -1 --format="%H%n%s"\`、\`git rev-list --left-right --count HEAD...surdet/main\`、\`git status --short\`、\`git diff --check\`、tracked \`.log\` 状态和 \`verify:all\` 结果。
- 基线必须从 \`main\`、HEAD 与远端同步、无 tracked 修改开始。
- 创建本 Wave 5C 计划，保留本节和后续 Execution Ledger。
- 仅精确暂存本计划文件并建立独立普通提交；不得暂存受保护文件。

### Task 0 基线记录

采集时间：2026-08-12（Asia/Shanghai，命令输出时刻约 16:55）。

branch: main
HEAD: a1cf342d31396c67491617a50fd87980a3955d24
top subject: docs(engine): qualify wave 5a rollback evidence
HEAD...surdet/main: 0 0
git diff --check: exit 0
git ls-files '*.log': empty
npm run verify:all: exit 0

Task 0 开始时 \`git status --short\` 仅包含以下六项，均为未跟踪且受保护：

- \`?? AGENTS.md\`
- \`?? SESSION-HANDOFF.md\`
- \`?? USER.md\`
- \`?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md\`
- \`?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md\`
- \`?? docs/superpowers/plans/2026-08-12-player-experience-wave-5b-layout-polish.md\`

基线正式游戏门禁摘要：\`zero-after-midnight\` 11 场景、23/23 choice 分支、3 个结局、44 项资产、运行时错误 0；根级工具、边界、legacy、文档、卫生、类型、测试、正式 lint/simulate/assets/build 均由 \`npm run verify:all\` 通过。

## Task 1 — 正式玩家路径诊断与合法红灯

### 诊断协议

新增 Shell runner 和 contract test，但只能通过正式 \`E:\\surdet\\examples\\zero-after-midnight\\dist\`，每个正式 case 使用独立 Electron 和临时 userData。必须使用真实标题、开始游戏、文本推进、回退绑定和 \`page.mouse.click()\`；禁止 \`titleSelect()\`、\`performRollback()\`、直接解释器定位或 debug action。

仅运行两个独立 case：

- Case A \`prologue-rapid-rollback\`：真实进入含 \`@fadein/@fadeout\` 的路径，固定 12 次有效 rapid rollback，不等待效果完成，记录开始/结束和首个异常。
- Case B \`common-0017-choice-rollback\`：真实到达包含“记录她说的时间”“追问失踪的原因”“先挂断电话”的三项选择，实际点击选择、推进分支、快速跨选择边界回退，检查幽灵选择。

最多 24 次有效回退；最多 4 张常规截图以及每类失败 1 张额外截图。每次回退记录位置、解释器/渲染器/UI 状态、背景、立绘、fade/tint/world alpha、flash/wipe/active transition、选择可见数量和标签、资源/错误状态与短帧样本。

失败判定包括渐进或瞬发变暗、恢复后背景/立绘消失、旧表现写入新快照、资源释放/窗口/错误通道异常，以及无待选却仍有旧选择 UI、点击不产生合法状态变化、choice 状态与投影不一致。

正式诊断只运行一次；没有复现时，必须保存完整诊断 artifact 并写 \`PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED\`，不得追加轮次挑选绿色结果。

### Task 1 入口与出口

- 红灯来自真实正式路径或 artifact 中与玩家症状直接对应的可观察 mismatch。
- 若无因果红灯，保留玩家红灯，进入 Task 2 的诊断测试，不得臆改生产代码。

## Task 2 — 恢复原子性与选择投影测试先行

先写并运行失败/回归测试，再决定是否有生产改动。测试范围：

- Host \`rollback-runtime.test.ts\`：reset/restore 期间的可能重入；若现有防御性 mock 已通过，明确记为 \`DEFENSIVE_FUTURE_INVARIANT\`，不得冒充玩家根因。
- Renderer \`presentation-clear.test.ts\`、\`world-effects-controller.test.ts\`：背景、立绘、fade、tint、transition、wipe、particle 先运行，snapshot → reset/restore/update 后目标视觉一致；旧 effects 不得写入恢复状态；资源不单调增长；失败保留旧状态和错误。
- Choice sequence：真实 choice → 实际选择 → 分支文本 → 快速跨 choice 回退 → 投影、标签、可见数量、点击合法性和下一次真实 choice。

命令：

    npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts
    npm run test -w @surdet/renderer -- --run test/integration/presentation-clear.test.ts test/world-effects-controller.test.ts

至少保留一个真实失败或明确记录聚焦测试全部通过、红灯只来自玩家矩阵/人工路径；不得制造红灯。

## Task 3 — 有证据的最小公共层修复

只有 Task 1 true repro 或能直接映射玩家截图的 causal mismatch 才进入。本阶段不得把 reenterOnReset mock 作为根因。

修复必须保证恢复后只有目标 snapshot/合法目标任务可写入；旧 fade/tint/flash/wipe/transition/timeline/mask/tween 不能修改新场景。只能从以下一种最小策略中择一：

- A：保存运行任务并从目标快照重建；
- B：完成/取消跨快照任务后恢复静态状态；
- C：恢复 generation/epoch，使旧任务写入失效。

禁止 setTimeout、亮度轮询、永久 ticker、Zero 特例、Host 访问 Pixi、debounce、新兼容层。生产修改前必须先有失败测试，随后运行同一路径红→绿并提交：

    fix(renderer): make rollback presentation restore atomic

## Task 4 — 有证据的 Ghost Choice 投影修复

只有 Task 2 证据需要时进入。无 pending choice 时必须满足 \`rendererStatus != choice\`、可见选择数为 0、标签为空且不存在旧卡片/监听器；有 pending choice 时状态、数量、标签和真实点击索引必须一致。

Choice 唯一来源为 Core Interpreter event → PresentationController choice state → DialogueLayer cards/listeners；不得在 Zero 中复制状态。若基线测试已通过，只记录 timing gap，不制造红灯。聚焦命令：

    npm run test -w @surdet/renderer -- --run test/legacy/presentation-controller.test.ts test/legacy/dialogue-layer.test.ts
    npm run test -w @surdet/host -- --run test/rollback-runtime.test.ts

必要时提交：\`fix(renderer): reconcile choice projection after rollback\`。

## Task 5 — 唯一正式 Wave 5C Electron 证据

只在前序需要 runner/contract 修订时修订。正式命令只运行一次：

    npm run e2e:player-experience-wave5c -w @surdet/shell

artifact 必须记录真实 \`head/sourceRoot/distRoot/protocol/actual sessions/attempts\`，每次 rollback 的纯状态与短帧样本、首个异常（若有）、代表截图路径/字节数/SHA、全部错误数组。必须能证明使用 Zero 正式入口、真实输入、合法 scene/pc、无黑屏渐暗、无旧 effect 写入、无 ghost choice、真实选择点击成功，且所有错误通道为 0。不得覆盖旧失败 artifact。

## Task 6 — 全量回归与正式游戏门禁

运行 Renderer、Host、Shell 全量测试、typecheck/build、renderer boundaries/legacy；运行 Zero lint、simulate（\`--max-paths 500 --max-steps 20000\`）、assets、typecheck/build；最后只运行一次根级 \`npm run verify:all\`，并记录 \`git diff --check\`、tracked \`.log\`、status 和远端关系。不得运行任何性能矩阵。

## Task 7 — 交付报告与最终台账

创建：

\`docs/ENGINE-PLAYER-EXPERIENCE-WAVE-5C-ROLLBACK-RESTORE-ATOMICITY-DELIVERY-REPORT-2026-08-12.md\`

报告必须区分有证据根因、已修复行为和未证实玩家问题；包含 CODE_EVIDENCE_HEAD、artifact 路径/HEAD/字节数/SHA、红灯/绿灯命令、截图数量与保留理由、公共层改动、未触碰范围、完整测试、Git 状态和未 push。只有同一路径真实红→绿时才可写 \`ROLLBACK_RESTORE_ATOMICITY_IMPLEMENTED\`；始终保留 \`PLAYER_BLACK_SCREEN_AWAITING_MANUAL_VALIDATION\`，不能宣称玩家黑屏永不发生。

## Task 8 — 停止条件

完成后不 push、不部署、不开始 Wave 5B，停止等待独立复审。若存在真实同路径红→绿，最终状态为：

    ROLLBACK_RESTORE_ATOMICITY_IMPLEMENTED
    ROLLBACK_VISUAL_RESTORE_VERIFIED
    STALE_CHOICE_UI_AFTER_ROLLBACK_VERIFIED
    PLAYER_BLACK_SCREEN_AWAITING_MANUAL_VALIDATION
    WAVE_5B_NOT_STARTED
    NOT_PUSHED
    WAITING_FOR_INDEPENDENT_REVIEW

若没有因果链，最终状态为：

    PLAYER_REPRO_RETAINED
    ROOT_CAUSE_UNCONFIRMED
    WAVE_5C_DIAGNOSIS_COMPLETE
    WAVE_5B_NOT_STARTED
    NOT_PUSHED
    WAITING_FOR_INDEPENDENT_REVIEW

## Execution Ledger

| Task | 状态 | 红灯/绿灯与证据 | 提交 SHA | 下一阶段入口 |
| --- | --- | --- | --- | --- |
| Task 0 | completed | 基线核验完成；\`verify:all\` exit 0；受保护文件未触碰；计划台账校正已完成 | 3d15999c3337f8eeddb620a7aaf9b9d105906d75 | 进入 Task 1 |
| Task 1 | completed | Shell contract 先红后绿：runner/package script 尚不存在时 7/7 失败；加入正式入口 runner 后 7/7 通过。只运行一次有效正式诊断：artifact=<local-path>，bytes=4074802，SHA-256=02FD96027B0C0A762F792DC53238886C75C50D97F1EF293F43F7E667F01B514E，head=3d15999c3337f8eeddb620a7aaf9b9d105906d75；2 sessions，12 attempts（A=12，B=0），3 screenshots，全部错误数组为 0。Case A 12/12 validHistory=true，但黑屏告警来自无效 WebGL canvas.toDataURL 读回，三张实际截图均显示完整场景；Case B 在 common_0017 选择点超时，未形成 ghost-choice 证据。初次 setup artifact 保留：<local-path>，bytes=1803，SHA-256=3F7C53EB0E4F95F0F051AA9940ACBA0EE3BE2AE01566F8E9AF71B17B6303AF89。为修正诊断 probe，visualThumbnail contract 先新增 1/7 红灯，增加只读 WorldQueries 接线后 7/7 通过；未重跑正式矩阵。结论：PLAYER_BLACK_SCREEN_ROOT_CAUSE_UNCONFIRMED，未进入生产修复 | 6331a387bd9b99957e737c1b70fd731d72c2ada3 | 进入 Task 2 |
| Task 2 | completed | Host rollback-runtime 5/5；Renderer presentation-clear/world-effects 3/3；未发现直接因果 mismatch。reenterOnReset 明确为 DEFENSIVE_FUTURE_INVARIANT，不是玩家根因证据。Shell/Zero typecheck 与 build 均 exit 0 | 6331a387bd9b99957e737c1b70fd731d72c2ada3 | 条件停止：不进入 Task 3/4 生产修复 |
| Task 3 | not entered | Task 1 没有真实黑屏或可见 causal mismatch；不修改公共恢复生产代码 | 6331a387bd9b99957e737c1b70fd731d72c2ada3 | 条件分支停止 |
| Task 4 | not entered | Case B 未到达真实 common_0017 选择点；没有 Ghost Choice 证据，不制造红灯 | 6331a387bd9b99957e737c1b70fd731d72c2ada3 | 条件分支停止 |
| Task 5 | completed | 唯一有效正式诊断已保留；不因 probe 修订重跑正式矩阵 | 6331a387bd9b99957e737c1b70fd731d72c2ada3 | 进入诊断报告收口 |
| Task 6 | not entered | 条件停止分支不运行生产修复后的全量门禁；Task 0 baseline verify:all exit 0 已记录 | 6331a387bd9b99957e737c1b70fd731d72c2ada3 | 进入 Task 7 |
| Task 7 | completed | 交付诊断报告真实落盘，含 artifact、红绿测试、错误证据、未解决项和保护边界 | （本次文档收口提交） | 进入 Task 8 |
| Task 8 | completed | 停止在 WAITING_FOR_INDEPENDENT_REVIEW；未 push、未部署、未开始 Wave 5B/M9 | （本次文档收口提交） | 等待独立复审 |
| Task 5 | not started | — | — | — |
| Task 6 | not started | — | — | — |
| Task 7 | not started | — | — | — |
| Task 8 | not started | — | — | 停止在 WAITING_FOR_INDEPENDENT_REVIEW |

## Protected-file audit

本文件创建时，以下六个文件均未被修改、暂存、提交、删除或移动：

- \`AGENTS.md\`
- \`SESSION-HANDOFF.md\`
- \`USER.md\`
- \`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md\`
- \`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md\`
- \`docs/superpowers/plans/2026-08-12-player-experience-wave-5b-layout-polish.md\`
