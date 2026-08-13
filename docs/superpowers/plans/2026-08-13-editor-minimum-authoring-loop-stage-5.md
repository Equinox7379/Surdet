
# Stage 5 Existing Visual Editor Minimum Authoring Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox ([ ]) syntax for tracking.

**Goal:** 在不重造现有编辑器的前提下，验证并在确有玩家可复现问题时最小修复“改一句台词 → 预览 → 保存 → 重开仍存在”的创作闭环。

**Architecture:** 复用 packages/editor 已有的 File System Access 项目读写、内存编辑状态、块编辑器、预览 iframe 和保存回盘能力。预览必须读取编辑器当前内存文本，因此先验证“未保存修改可预览”，再验证 project-io.ts 的真实文件写盘和页面重开后的重新读取。只有项目所有者实际操作暴露出可重复缺陷时，才在编辑器公共模块内做最小修复；不复制第二套编辑器、预览器或存档系统。

**Tech Stack:** TypeScript、Vite、Vitest、Chrome/Edge File System Access API、现有 @surdet/core 与 @surdet/renderer 预览依赖、PowerShell 临时隔离项目。

## Global Constraints

- 本任务属于路线台账中的 Stage 5，主题只限“现有可视化编辑器最小创作闭环的可信手验收与局部修复”。
- 先读 E:\surdet\AGENTS.md、docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md、Stage 4 任务书和 Stage 4 交付报告，再只读确认真实 HEAD、surdet/main、工作树和暂存区。
- 默认只做验证、隔离临时项目和证据收口；没有项目所有者的真实异常时，不修改生产代码。
- 若确有可复现异常，只能修改 packages/editor/src/** 与对应的 packages/editor/test/**；修改前必须在当轮 Execution Ledger 写出确切文件、症状、红灯和公共层理由。
- 禁止修改或夹带 packages/core/**、packages/renderer/**、packages/host/**、packages/shell/**、examples/zero-after-midnight/**、CI workflow、远端配置、受保护文件和长期路线台账。
- 禁止从零重造项目浏览、场景编辑、预览、保存、撤销/重做或崩溃恢复；禁止提前做角色/Gallery/资产管理、时间轴演出、调试、协作、云同步或插件系统。
- 原始 examples/starter 只读；人工验收必须使用 %TEMP% 下的隔离副本，不能把探针文字写回仓库源文件。
- 视觉、交互手感和“创作起来是否顺手”由项目所有者判断。自动化、DOM 状态、内部 dirty 标志和编辑器启动成功都不能单独代替人工通过结论。
- 不创建新的 Electron/Playwright E2E harness，不循环重跑挑绿，不删除或覆盖失败证据，不把未执行命令写成通过。
- 本轮不 push、force push、rebase、reset、amend、squash、pack、release 或部署到公网；执行 AI 只创建普通本地提交，完成后停止等待独立复审。

## File Map and Ownership

- Read only: packages/editor/src/main.ts、packages/editor/src/state.ts、packages/editor/src/project-io.ts、packages/editor/src/panels/editor.ts、packages/editor/src/panels/preview-panel.ts、packages/editor/src/history.ts、packages/editor/src/autosave.ts 及相关现有测试。
- Create: docs/EDITOR-MINIMUM-AUTHORING-LOOP-STAGE-5-DELIVERY-REPORT-2026-08-13.md（执行 AI 的事实报告；仅在执行阶段创建）。
- Modify conditionally: packages/editor/src/** 和 packages/editor/test/** 中与项目所有者实际异常直接对应的最小文件；不得预防性重构。
- Do not modify: 本任务书之外的计划、长期路线台账、Stage 4 文档、受保护文件、Core/Renderer/Host/Shell/Zero、项目原始内容和任何发行文件。

## Completion Contract

只有以下事实全部具备，才可把最小闭环记为人工通过：

1. 编辑器在真实浏览器中打开隔离项目，项目所有者通过界面把 ch01_01.gal 中的一句台词改为带有唯一探针标记的文本。
2. 未保存时进入“预览”标签页，点击“▶ 播放 / 重载”，预览画面实际显示修改后的探针文本；不能只证明内存对象或 DOM 输入框发生变化。
3. 点击“保存全部 (Ctrl+S)”后，编辑器显示成功状态，磁盘上的隔离副本 content/scenario/ch01_01.gal 实际包含探针文本。
4. 刷新编辑器页面并重新打开同一个隔离项目，界面再次显示探针文本，且该场景没有未保存脏标记。
5. 项目所有者没有报告黑屏、预览错误、保存失败、重开丢失、输入卡住或其他首个异常；若有异常，只记录第一个可复现节点，不宣称通过。

若项目所有者没有完成第 1–4 步，执行 AI 只能报告 HUMAN_ACCEPTANCE_PENDING_OWNER 或失败节点，不能用单元测试替代人工创作结论。

---

### Task 0: 重新读取权威材料并冻结真实基线

Files:
- Read: E:\surdet\AGENTS.md
- Read: E:\surdet\docs\superpowers\plans\2026-08-13-project-roadmap-and-decision-ledger.md
- Read: E:\surdet\docs\superpowers\plans\2026-08-13-foundation-stability-stage-4.md
- Read: E:\surdet\docs\ENGINE-FOUNDATION-STABILITY-STAGE-4-DELIVERY-REPORT-2026-08-13.md
- Modify: none

- [x] Step 1: 读取四份权威材料并记录 Stage 5 目标

确认路线已经批准 Stage 5，目标只限现有编辑器最小闭环；记录不得扩大到其他主题。

- [x] Step 2: 读取真实 Git 基线

Run:

    git status --short
    git rev-parse --abbrev-ref HEAD
    git rev-parse HEAD
    git rev-parse surdet/main
    git rev-list --left-right --count HEAD...surdet/main
    git diff --check
    git diff --cached --check
    git ls-files '*.log'

Expected at task start: 分支 main；本地 HEAD 为 Stage 4 文档提交 a4789271860fa6b82f91803253b2ab2d7ddfe333；surdet/main 为 5994ec7bd64b2106da6e47cd86e88fb4df82ed01；ahead/behind 为 1 0；tracked 工作树没有既有修改，只有已知未跟踪文件和长期路线台账。若发现新的 tracked 修改、远端前进或基线不一致，停止并报告，不覆盖任何文件。

- [x] Step 3: 建立当轮 Execution Ledger 起点

在本任务书中记录时间、HEAD、远端关系、工作树、禁止范围和“默认不改代码、等待项目所有者实机结果”的停止边界。此时不创建测试红灯，不启动服务器。

### Task 1: 盘点现有编辑器闭环，不重新设计架构

Files:
- Read: packages/editor/src/main.ts
- Read: packages/editor/src/state.ts
- Read: packages/editor/src/project-io.ts
- Read: packages/editor/src/panels/editor.ts
- Read: packages/editor/src/panels/preview-panel.ts
- Read: packages/editor/src/history.ts
- Read: packages/editor/src/autosave.ts
- Read: packages/editor/test/project-io.test.ts
- Read: packages/editor/test/preview-scenes.test.ts
- Read: packages/editor/test/preview-runtime-lifecycle.test.ts
- Read: packages/editor/test/history.test.ts
- Modify: none

- [x] Step 1: 对齐实际 UI 入口与数据流

确认以下入口真实存在并记录其代码位置：打开游戏目录、块编辑、预览、▶ 播放 / 重载、保存全部 (Ctrl+S)、场景选择、脏标记、openProject()、saveAll() 和预览向 iframe 发送当前内存文本的路径。

Run:

    rg -n -C 2 '打开游戏目录|块编辑|预览|▶ 播放 / 重载|保存全部|dirty|openProject|saveAll|collectPreviewScenes' packages/editor/src packages/editor/test

Expected: 只得到现有编辑器实现和测试的定位结果，不新增第二套入口或状态机。

- [x] Step 2: 区分验证事实与人工判断

在 Execution Ledger 写明：现有测试只能证明纯函数、项目模型、预览协议/生命周期和读写辅助逻辑的部分契约；“真实浏览器中看到探针文本”和“重开后创作仍存在”必须由项目所有者实机确认。

### Task 2: 运行编辑器现有聚焦门禁

Files:
- Read: packages/editor/package.json
- Test: existing packages/editor/test/**
- Modify: none

- [x] Step 1: 运行编辑器单元/契约测试

Run:

    npm run test -w surdet-editor

Expected: exit 0。把实际测试文件数、测试数和完整命令结果写入 Execution Ledger；不要凭预计数量填写。

- [x] Step 2: 运行编辑器 typecheck

Run:

    npm run typecheck -w surdet-editor

Expected: exit 0，无 TypeScript 错误。

- [x] Step 3: 构建编辑器

Run:

    npm run build -w surdet-editor

Expected: exit 0，产生 E:\surdet\packages\editor\dist。记录构建输出；若只有已知的非阻断 bundle warning，原样记录，不把 warning 写成错误或通过条件之外的结论。

### Task 3: 准备不污染仓库的真实浏览器验收部署

Files:
- Read: E:\surdet\examples\starter\content\**
- Read: E:\surdet\examples\starter\game.config.json
- Create outside repository: %TEMP%\surdet-editor-stage5-<unique>\content\**
- Create outside repository: %TEMP%\surdet-editor-stage5-<unique>\game.config.json
- Modify in repository: none

- [x] Step 1: 创建隔离 Starter 副本

Run in PowerShell, replacing no repository path and not copying node_modules、dist、src 或 test：

    $fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("surdet-editor-stage5-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'content') -Force | Out-Null
    Copy-Item -Path 'E:\surdet\examples\starter\content\*' -Destination (Join-Path $fixtureRoot 'content') -Recurse
    Copy-Item -LiteralPath 'E:\surdet\examples\starter\game.config.json' -Destination $fixtureRoot
    $probe = '[STAGE5-EDITOR-PROBE]'
    $target = Join-Path $fixtureRoot 'content\scenario\ch01_01.gal'
    Write-Output "fixtureRoot=$fixtureRoot"
    Write-Output "target=$target"
    Write-Output "probePresent=$((Get-Content -LiteralPath $target -Raw).Contains($probe))"

Expected: 输出唯一临时目录和 probePresent=False；仓库原始 examples/starter/content/scenario/ch01_01.gal 不变。记录隔离目录路径，不删除失败或验收证据。

- [x] Step 2: 启动仅监听本机的编辑器预览服务器

Run from a separate terminal:

    npm run preview -w surdet-editor -- --host 127.0.0.1 --port 4173

Expected: 服务器在 http://127.0.0.1:4173/ 提供刚构建的编辑器；若 4173 已被占用，只改用固定备用端口 4174 并在报告中记录实际 URL。不要把服务器暴露到局域网或公网。

- [x] Step 3: 只确认入口身份，不宣称创作闭环通过

在 Chrome 或 Edge 打开本机 URL，确认页面标题/应用身份为 Surdet 剧本编辑器，并确认存在打开游戏目录。如果入口无法加载，记录入口失败并停止；不要改 Core、Renderer、Host、Shell 或 Zero 来绕过它。

### Task 4: 项目所有者执行最小真实创作闭环

Files:
- Read/modify only through browser UI: the isolated fixture from Task 3
- Evidence: isolated fixture file before/after bytes and SHA-256; optional owner screenshot
- Modify in repository: none before an owner-reported defect

- [x] Step 1: 打开隔离项目并选中稳定测试场景

项目所有者在 Chrome/Edge 点击打开游戏目录，选择 Task 3 输出的 $fixtureRoot，等待场景列表加载，然后选择 ch01_01。不得选择仓库原始目录作为写盘目标。

- [x] Step 2: 通过块编辑器改一句台词

在包含原文 凛：你终于来了，等了你三个晚上。 的文本块末尾追加唯一标记 [STAGE5-EDITOR-PROBE]，保持场景指令、标点和其它行不变。确认左侧场景出现未保存脏标记；这一点只作为 UI 现象记录，不作为最终通过依据。

- [x] Step 3: 预览未保存修改

切换到预览标签，保持入口为从场景开头，点击 ▶ 播放 / 重载，等待 iframe 剧情预览 就绪。在真实预览画面中确认该句台词实际显示 [STAGE5-EDITOR-PROBE]。若画面没有显示、预览报错、黑屏或卡住，项目所有者立即报告第一个异常，执行 AI 停止，不先保存或猜测修复。

- [x] Step 4: 保存到隔离项目

回到编辑器后点击保存全部 (Ctrl+S)，等待状态文字 全部成功：已保存 ... 项。执行 AI 随后从磁盘读取 $fixtureRoot\content\scenario\ch01_01.gal，确认探针文本存在，并记录保存前后字节数和 SHA-256；不得只读取编辑器内存状态。

- [x] Step 5: 刷新并重新打开，确认创作持久化

刷新编辑器页面，重新点击打开游戏目录并选择同一个 $fixtureRoot。再次选中 ch01_01，确认探针文本仍在且场景没有未保存脏标记。若重开后文本消失、文件无法读取或出现首个可见错误，记录实际路径和现象，停止在 HUMAN_ACCEPTANCE_FAILED_AT_REOPEN。

- [x] Step 6: 人工结果边界

项目所有者只需报告第一个异常及其操作路径，不需要填写形式化逐项通过表。执行 AI 不得把“项目所有者没有及时回复”写成通过；没有人工回复时状态必须保持 HUMAN_ACCEPTANCE_PENDING_OWNER。

### Task 5: 仅在真实异常下做最小编辑器层修复

Files:
- Modify conditionally: one or more exact files under packages/editor/src/**
- Test conditionally: one or more exact files under packages/editor/test/**
- Forbidden: all Core/Renderer/Host/Shell/Zero production files and unrelated editor panels

- [x] Step 1: 先写异常记录和最小红灯（本轮不适用：项目所有者未报告真实异常）

只有项目所有者报告了可重复异常才进入本 Task。先在 Execution Ledger 写出：触发动作、实际可见结果、期望结果、首个失败节点、最小复现输入、确切生产文件和对应测试文件。把失败固化为一个针对该现象的最小测试；测试必须断言实际契约（例如保存后的文件文本、预览收到的内存文本或重开后的模型文本），不能只断言按钮存在或 dirty 布尔值变化。

- [x] Step 2: 做最小局部修复（本轮不适用：项目所有者未报告真实异常）

只改能解释该异常的 packages/editor 文件，保留现有模块边界和接口。不得新增兼容层、迁移层、第二套状态机、第二套预览器或预防性抽象；若证据指向 Core/Renderer/Host/Shell 公共问题，停止本任务并报告边界，不越权修改。

- [x] Step 3: 运行与异常直接匹配的验证（本轮不适用：项目所有者未报告真实异常）

至少运行以下命令及与新增红灯对应的聚焦测试：

    npm run test -w surdet-editor
    npm run typecheck -w surdet-editor
    npm run build -w surdet-editor

Expected: 所有命令 exit 0；随后重启本机预览服务器，让项目所有者只重试一次同一条真实路径。若修复后仍失败，保留失败 artifact/截图和首个失败节点，停止，不循环重跑。

### Task 6: 收口报告、普通本地提交并停在独立复审

Files:
- Modify: docs/superpowers/plans/2026-08-13-editor-minimum-authoring-loop-stage-5.md（仅更新 Execution Ledger、实际状态和证据）
- Create: docs/EDITOR-MINIMUM-AUTHORING-LOOP-STAGE-5-DELIVERY-REPORT-2026-08-13.md
- Conditionally include: exact packages/editor/src/** and packages/editor/test/** files from Task 5
- Do not modify: docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md

- [x] Step 1: 报告已验证事实和未验证边界

交付报告必须分别列出：

1. 真实起始 HEAD、远端关系、工作树和本轮实际修改文件；
2. Task 2 的真实命令及 exit 结果；
3. 隔离 fixture 路径、原始文件与保存后文件的字节数/SHA-256；
4. 项目所有者实际操作路径、预览画面是否显示探针、保存状态和重开后的可见结果；
5. 若有修复，红灯、修复文件、绿灯和唯一一次人工复测结果；
6. 未完成的人工判断、未运行的命令、保留的失败证据和当前阻断点；
7. HUMAN_ACCEPTANCE_PASSED_BY_OWNER、HUMAN_ACCEPTANCE_PENDING_OWNER 或 HUMAN_ACCEPTANCE_FAILED_AT_* 中唯一匹配当前事实的状态。

不得把编辑器启动、单元测试、内存文本或按钮点击写成完整创作闭环通过。

- [x] Step 2: 重新读取文档和 Git 身份

Run:

    git diff --check
    git diff --cached --check
    git status --short
    git rev-parse HEAD
    git rev-parse surdet/main
    git rev-list --left-right --count HEAD...surdet/main
    git ls-files '*.log'

重新读取任务书、交付报告、隔离文件路径和哈希；没有实际运行的命令不得写成通过。

- [x] Step 3: 精确创建普通本地提交

只暂存任务书、交付报告以及 Task 5 实际修改的编辑器源文件/测试文件。不要暂存长期路线台账、AGENTS、受保护文件、handoff、临时 fixture、截图、日志或构建产物。任务书和报告的提交示例：

    git add docs/superpowers/plans/2026-08-13-editor-minimum-authoring-loop-stage-5.md docs/EDITOR-MINIMUM-AUTHORING-LOOP-STAGE-5-DELIVERY-REPORT-2026-08-13.md
    # 仅当 Task 5 实际发生时，再追加确切的 packages/editor 源文件和测试文件
    git commit -m "docs(editor): record stage 5 minimum authoring loop"

Expected: 普通本地提交成功；提交内容与报告逐项一致；不 push、不改写历史。

- [x] Step 4: 停止并等待总经理独立复审

若人工闭环通过，停止状态为：

    STAGE_5_MINIMUM_AUTHORING_LOOP_VERIFIED
    HUMAN_ACCEPTANCE_PASSED_BY_OWNER
    READY_FOR_INDEPENDENT_MANAGER_REVIEW
    WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
    NOT_PUSHED_AFTER_STAGE_5
    STAGE_6_NOT_STARTED

若项目所有者尚未完成实机路径，停止状态为：

    STAGE_5_AUTHORIZED
    HUMAN_ACCEPTANCE_PENDING_OWNER
    NOT_PUSHED_AFTER_STAGE_5
    STAGE_6_NOT_STARTED

若出现异常，停止状态必须包含首个失败节点，例如 HUMAN_ACCEPTANCE_FAILED_AT_PREVIEW 或 HUMAN_ACCEPTANCE_FAILED_AT_REOPEN；保留证据并等待新的明确修复授权，不得自动扩展到下一主题。

## Execution Handoff

执行 AI 接手后必须串行完成 Task 0 → Task 6。它拥有本任务书和当轮交付报告的写权限，但没有长期路线台账的写权限；长期路线台账由总经理在独立复审后更新。执行 AI 不得自行创建子 AI、并发研究、push、部署、打包、发行或进入 Stage 6。

本任务书创建完成后的下一停止点是：等待执行 AI 接手；并非已经通过 Stage 5。真正的 Stage 5 通过必须等项目所有者在真实浏览器中看到探针文本、确认磁盘保存并在重开后再次看到该文本。

## Self-Review

- Spec coverage: Task 0 覆盖权威材料和真实基线；Task 1 覆盖现有模块盘点；Task 2 覆盖聚焦测试/typecheck/build；Task 3 覆盖隔离 fixture 和本机部署；Task 4 覆盖真实编辑—预览—保存—重开路径；Task 5 只允许真实异常下的编辑器层最小修复；Task 6 覆盖报告、身份复核、提交和停止状态。
- Scope check: 本轮只有一个独立主题：现有编辑器最小创作闭环；没有加入新的编辑器子系统或无关阶段。
- Placeholder scan: 任务书没有占位词或空泛的“适当处理”步骤；所有命令、文件边界、人工动作和停止条件均已写明。
- Type/contract check: 计划引用的 UI 文本与现有 packages/editor/src/main.ts、project-io.ts、panels/preview-panel.ts 实际入口一致；保存成功状态使用现有 全部成功：已保存 ... 项 文本；测试命令使用 surdet-editor 工作区脚本。

---

## Execution Ledger

> 以下只记录本轮实际读取、命令和证据；未运行的命令不写成通过。长期路线台账不在本轮写权限内。

### Task 0 — completed (2026-08-13 18:41 +08:00)

- 已完整读取：`E:\surdet\AGENTS.md`、`docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`、Stage 4 任务书、Stage 4 交付报告和本 Stage 5 任务书。确认本轮唯一主题为现有可视化编辑器最小创作闭环；默认只验证，不因猜测修改代码；不进入 Stage 6。
- 已执行真实基线命令：`git status --short`、`git rev-parse --abbrev-ref HEAD`、`git rev-parse HEAD`、`git rev-parse surdet/main`、`git rev-list --left-right --count HEAD...surdet/main`、`git diff --check`、`git diff --cached --check`、`git ls-files '*.log'`；全部命令 exit `0`。
- 真实基线：branch=`main`；`HEAD=a4789271860fa6b82f91803253b2ab2d7ddfe333`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`1 0`；tracked 工作树和暂存区均无修改；tracked `.log` 为空。
- 已知未跟踪文件保持原样：`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份艺术文件、两个 handoff 文件、Stage 5 任务书和长期路线台账；本轮没有修改、暂存或提交长期路线台账及受保护文件。
- 本 Task 0 实际修改文件：仅本任务书；没有修改 editor、Core、Renderer、Host、Shell、Zero、测试、runner 或 harness。下一停止点：Task 1 只读盘点现有编辑器入口与数据流。

### Task 1 — completed (2026-08-13 18:41–18:43 +08:00)

- 已执行任务书指定的入口检索：`rg -n -C 2 '打开游戏目录|块编辑|预览|▶ 播放 / 重载|保存全部|dirty|openProject|saveAll|collectPreviewScenes' packages/editor/src packages/editor/test`，exit `0`。实际定位到 `main.ts:90–112`（打开目录、保存）、`main.ts:131–196`（块编辑/预览标签）、`project-io.ts:33–105`（`openProject` 读取项目）、`project-io.ts:184–309`（`saveAll` 写盘/成功状态）、`editor.ts:141–229`（块输入与 raw 行编辑）、`preview-panel.ts:244–356`（从场景开头、播放/重载、发送预览数据）。
- 已完整只读检查任务书列出的源文件：`packages/editor/src/main.ts`（318 行）、`state.ts`（102 行）、`project-io.ts`（375 行）、`panels/editor.ts`（293 行）、`panels/preview-panel.ts`（364 行）、`history.ts`（138 行）、`autosave.ts`（87 行）；以及测试 `project-io.test.ts`（143 行）、`preview-scenes.test.ts`（70 行）、`preview-runtime-lifecycle.test.ts`（77 行）、`history.test.ts`（187 行）。
- 已确认现有闭环数据流：`openProject()` 清空旧模型、递归读取 `content/scenario/**/*.gal`，以 `dirty=false` 放入 `state.scenes` 后渲染；块编辑器通过 `setCurrentText()` 更新内存文本并置 `dirty=true`；`renderPreviewPanel()` 使用 `collectPreviewScenes(state.scenes)` 将当前内存文本（含未保存修改）发送给 iframe；`saveAll()` 通过文件句柄写盘，全部成功后显示“全部成功：已保存 ... 项”并清除 dirty；刷新重开再次由 `openProject()` 从磁盘读取文本。
- 已区分证据边界：指定测试证明模型/读写辅助、预览场景收集与 iframe 生命周期、撤销栈等局部契约；无法证明真实浏览器预览画面显示探针，也无法证明项目所有者刷新重开后的创作持久化。后两项必须由项目所有者在 Chrome/Edge 中完成。
- 本 Task 1 实际修改文件：仅本任务书；没有修改 editor 源码或测试。下一停止点：Task 2 运行 `npm run test -w surdet-editor`、`npm run typecheck -w surdet-editor`、`npm run build -w surdet-editor`。

### Task 2 — completed with existing test gate red (2026-08-13 18:43–18:44 +08:00)

- `npm run test -w surdet-editor`：exit `1`。Vitest `v3.2.7`；21 个 test files 中 20 passed、1 failed；142 个 tests 中 140 passed、2 failed。首个失败节点为 `test/model-roundtrip.test.ts` 的“零失真往返（真实 starter 剧本）”：`ch01_01.gal` 与 `ch02.gal` 的 `parse → serialize` 逐字节相等断言各失败一次，差异为 CRLF/LF 换行；其余 20 个文件及 140 个测试通过。失败输出已保留在本轮命令回执；没有重跑、没有删除或覆盖证据。
- `npm run typecheck -w surdet-editor`：exit `0`；`tsc -p tsconfig.json --noEmit` 无 TypeScript 错误。
- `npm run build -w surdet-editor`：exit `0`；Vite `6.4.3`，`852 modules transformed`，成功生成 `packages/editor/dist`。输出含已知的 `preview` bundle 大于 `500 kB` 提示（592.90 kB，gzip 175.41 kB），本轮不修改门限、不把 warning 写成错误或性能结论。
- 本 Task 2 没有修改生产代码或测试；没有项目所有者真实异常，因此不进入 Task 5 修复。该既有 test gate 红灯与后续人工预览/保存/重开事实分开记录，不能被 typecheck/build 绿灯掩盖。下一停止点：Task 3 创建隔离 Starter 副本并启动仅监听本机的预览服务器。

### Task 3 — Step 1 completed; Steps 2–3 pending (2026-08-13 18:44–18:45 +08:00)

- 已按任务书在仓库外创建唯一隔离目录：`C:\Users\Equinox\AppData\Local\Temp\surdet-editor-stage5-dfea8432e17f412e9fe0259b9d74945d`。只复制 `examples/starter/content/**` 和 `game.config.json`；fixture 共 23 个文件、总计 6,604,309 bytes，排除路径检查 `node_modules`/`dist`/`src`/`test` 为 `0`，未复制这些目录。
- 隔离目标文件：`C:\Users\Equinox\AppData\Local\Temp\surdet-editor-stage5-dfea8432e17f412e9fe0259b9d74945d\content\scenario\ch01_01.gal`；创建后 `bytes=1,035`，SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`，`probePresent=False`。
- 原始仓库目标 `E:\surdet\examples\starter\content\scenario\ch01_01.gal` 仍为 `1,035` bytes，SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`，Git blob=`50b253ef3b683b4d848d7795b8142ab72fd7a690`，`probePresent=False`；没有写入原始 Starter。
- 本 Task 3 Step 1 实际修改文件：仅本任务书；仓库原始 `examples/starter`、editor 源码和测试均未修改。下一停止点：Task 3 Step 2 启动本机预览服务器并只确认入口身份，不宣称创作闭环通过。

### Task 3 — Step 2 completed; Step 3 and Task 4 pending (2026-08-13 18:45–18:47 +08:00)

- 已检查 4173/4174 在启动前均无监听；按任务书启动 `npm run preview -w surdet-editor -- --host 127.0.0.1 --port 4173`，实际命令由 `npm.cmd` 后台进程执行，监听 PID=`45380`，退出状态未发生，服务地址为 `http://127.0.0.1:4173/`。服务器仅绑定 `127.0.0.1`，没有暴露到局域网或公网。
- 服务器日志保留在仓库外临时目录 `C:\Users\Equinox\AppData\Local\Temp\surdet-editor-stage5-dfea8432e17f412e9fe0259b9d74945d-preview\stdout.log` 与 `stderr.log`；stdout 明确显示 Vite preview 在 4173 启动，stderr 为空。
- 只读 HTTP 入口检查：`http://127.0.0.1:4173/` 返回 `200`，HTML 标题为 `Surdet 剧本编辑器`，Vite 构建输出中包含编辑器身份；动态“打开游戏目录”按钮需由真实 Chrome/Edge 页面确认，不能由 HTTP 静态文本代替。
- 本 Task 3 Step 2 实际修改文件：仅本任务书；未修改 editor 源码/测试、Starter 原始目录或任何其他工作区。Step 3（真实浏览器入口确认）与 Task 4（项目所有者人工闭环）待项目所有者执行。

### Task 3 Step 3 / Task 4 — completed by owner evidence (2026-08-13 19:04 +08:00 record time)

- 项目所有者已在真实 Chrome/Edge 浏览器打开 `http://127.0.0.1:4173/`，通过“打开游戏目录”选择桌面隔离 fixture，并选中 `ch01_01`；本轮不重新运行人工路径。
- 实际人工 fixture：`C:\Users\Equinox\Desktop\surdet-editor-stage5-fixture-20260813-185752`。项目所有者通过块编辑器在原句 `凛：你终于来了，等了你三个晚上。` 末尾追加 `[STAGE5-EDITOR-PROBE]`，确认 dirty 标记出现。
- 项目所有者切换到“预览”，保持“从场景开头”，点击“▶ 播放 / 重载”，在真实“剧情预览”画面中看到了探针文本；这是真实可见画面证据，不以 DOM、内部状态或按钮点击替代。
- 项目所有者返回编辑器执行“保存全部 (Ctrl+S)”，确认保存成功；随后刷新编辑器、重新打开同一个桌面 fixture、再次选择 `ch01_01`，确认探针仍然存在且没有未保存脏标记。
- 项目所有者明确反馈：“正常，完全没问题，验收通过咯。”未报告预览、保存、重开或输入异常；因此本轮没有建立红灯、没有修改 editor 源文件/测试，也没有修复 Task 2 的换行测试红灯。
- 人工事实对应状态：`HUMAN_ACCEPTANCE_PASSED_BY_OWNER`。下一停止点：Task 6 生成报告、重新读取最终身份、精确暂存并创建普通本地提交。

### Task 5 — not entered (2026-08-13 19:04 +08:00 record time)

- 项目所有者没有报告可重复异常；按任务书条件，本轮不进入局部修复，不建立新红灯，不重跑人工路径，不修复 `model-roundtrip.test.ts` 的两个 CRLF/LF 失败，不修改 `packages/editor/src/**` 或 `packages/editor/test/**`。

### Task 6 — Steps 1–2 completed; Steps 3–4 pending commit (2026-08-13 19:04–19:08 +08:00)

- 已记录项目所有者真实人工验收结果：桌面 fixture `C:\Users\Equinox\Desktop\surdet-editor-stage5-fixture-20260813-185752` 完成“编辑 → 真实剧情预览显示 → 保存 → 刷新重开仍存在”；人工状态为 `HUMAN_ACCEPTANCE_PASSED_BY_OWNER`。本次 Task 6 未重跑人工路径。
- 已从磁盘重新读取人工验收文件：`C:\Users\Equinox\Desktop\surdet-editor-stage5-fixture-20260813-185752\content\scenario\ch01_01.gal`，`1061` bytes，SHA-256=`D72F524173C351867C8A350BE8FB21EFE091D7BB44159FE4737933FEDD1311AE`，`probePresent=True`；原始 Starter 为 `1035` bytes，SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`，`probePresent=False`。
- 已创建并从磁盘重新读取交付报告：`docs/EDITOR-MINIMUM-AUTHORING-LOOP-STAGE-5-DELIVERY-REPORT-2026-08-13.md`，`8072` bytes，SHA-256=`47F2807F698977F8A1E988168FFCAB9168B566D398E5EF92197D0926AE570A85`。报告明确区分人工通过、editor 全量测试仍有 2 个换行红灯、typecheck/build 通过、没有 editor 源码/测试修改及 Stage 6 未开始。
- Task 6 前 Git 复核命令全部 exit `0`：`git diff --check`、`git diff --cached --check`；branch=`main`；`HEAD=a4789271860fa6b82f91803253b2ab2d7ddfe333`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`1 0`；tracked `.log` 为空；tracked 工作树和暂存区为空，既有未跟踪文件保持原样。
- 本 Task 6 实际修改文件：仅 Stage 5 任务书和 Stage 5 交付报告；不暂存长期路线台账、AGENTS、受保护文件、handoff、临时 fixture、日志、dist 或 editor 源文件/测试。Step 3/4 按下方精确暂存、提交和最终回读命令完成后，停止在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW` / `NOT_PUSHED_AFTER_STAGE_5` / `STAGE_6_NOT_STARTED`。
