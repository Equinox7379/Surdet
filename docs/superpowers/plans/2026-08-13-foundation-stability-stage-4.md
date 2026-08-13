# Surdet Stage 4 地基稳定性阶段确认执行计划

> **给执行 AI：** 必须在同一个执行会话中按 Task 0 → Task 6 串行执行并逐项勾选。不得创建子 AI、并行研究、额外 worktree 或高成本矩阵；每个实际结果都写入本文末尾的 `Execution Ledger`。

**Goal:** 用一轮适度、可追溯、无需重复人工验收的综合确认，判断当前 Surdet 地基是否已经足够稳定，可以进入 Stage 5 现有可视化编辑器的最小创作闭环。

**Architecture:** 本轮是只读验证与证据收口任务，不是功能开发。复用 Stage 3 已通过的显式备份恢复 artifact 和项目所有者 11 步人工验收，只补齐跨 Core、Renderer、Host、Shell、Zero 的聚焦门禁、类型检查、一次内容模拟和一个正式 Electron Case F；没有新红灯时不修改生产代码、测试代码或 harness。

**Tech Stack:** Node.js 20+、npm workspaces、TypeScript、Vitest、Electron 43、Playwright、Vite、Surdet Core/Renderer/Host/Shell、《零点之后》。

## Global Constraints

- 当前权威基线为 `main`，任务开始时必须重新读取真实 `HEAD`、`surdet/main` 和 ahead/behind；任务书制作时两者均为 `5994ec7bd64b2106da6e47cd86e88fb4df82ed01`、ahead/behind 为 `0 0`。
- 项目所有者已经完成并明确批准正式《零点之后》11 步人工验收；本轮不得要求其重复同一套验收。
- Stage 3 权威自动化 artifact 为 `<local-path>`，`1,097` bytes，SHA-256 `D078476A7379FDFBD80F7147DAABFD8D7BB54068837CB07704B94D9385BC692F`，`status=PASSED`，`runHead=fc82f5cebcdfb84438d10a3b9b6616664e82ba49`，位置为 `prologue:7 → prologue:8 → prologue:7`。该 `runHead` 是生产代码与 runner 证据提交；当前 HEAD 在其后只增加 Stage 3 文档收口提交。
- 本轮没有已知新生产缺陷，不得为了制造“红灯”而新增测试、放宽断言、改 harness、修改剧情或猜测性修改生产代码。
- 若任一聚焦门禁或正式 Electron 路径失败：保留完整输出和 artifact，记录最后通过节点与第一个失败节点，停止为 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`；不得在本轮修复代码、循环重跑、挑选绿色结果或扩大测试矩阵。
- 只允许修改本任务书和 `docs/ENGINE-FOUNDATION-STABILITY-STAGE-4-DELIVERY-REPORT-2026-08-13.md`。除此以外，所有 tracked 文件均为只读。
- `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md` 对执行 AI只读；不得编辑、暂存、提交、删除或移动。需要登记的长期事实只能写在交付报告末尾“建议由总经理登记的事实”。
- 不得触碰或暂存 `AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两个艺术交接文件、handoff 文件及其他原有未跟踪文件。
- 不运行 `verify:all`、性能资格化、Renderer 性能矩阵、多轮 Electron 矩阵、Wave 5A 大截图协议、pack、electron-builder 或发行流程。
- 不启动 Stage 5 编辑器施工、音频生产、美术、演出、性能、Legacy 或文档治理。占位 BGM 已由项目所有者允许作为临时版本进入远端，但艺术质量仍未通过；本轮不测试、不调整、不替换音频资产。
- 本轮完成后只允许创建一个包含本任务书与交付报告的普通本地文档提交；不得 push。最终必须停在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`，不得自动批准进入 Stage 5。

---

## 文件职责与白名单

### 允许修改

- `docs/superpowers/plans/2026-08-13-foundation-stability-stage-4.md`：本任务书、勾选状态和 `Execution Ledger`。
- `docs/ENGINE-FOUNDATION-STABILITY-STAGE-4-DELIVERY-REPORT-2026-08-13.md`：本轮事实、证据边界、artifact 身份、失败或通过结论。

### 只读验证入口

- `packages/core/test/growth.test.ts`
- `packages/core/test/save.test.ts`
- `packages/core/test/audit-fixes.test.ts`
- `packages/core/test/interpreter-save.test.ts`
- `packages/renderer/test/legacy/menu-layer.test.ts`
- `packages/renderer/test/integration/presentation-clear.test.ts`
- `packages/renderer/test/integration/resource-cycles.test.ts`
- `packages/renderer/test/rollback-buffer.test.ts`
- `packages/renderer/test/gallery.test.ts`
- `packages/renderer/test/keybindings.test.ts`
- `packages/host/test/electron-save-storage.test.ts`
- `packages/host/test/player-ui-coordination.test.ts`
- `packages/host/test/rollback-runtime.test.ts`
- `packages/host/test/presentation-connection.test.ts`
- `packages/shell/test/save-store.test.ts`
- `packages/shell/test/player-experience-wave-4-e2e-contract.test.ts`
- `packages/shell/test/player-experience-wave-5c-e2e-contract.test.ts`
- `packages/shell/test/player-experience-gallery-music-e2e-contract.test.ts`
- `examples/zero-after-midnight/test/player-ui-session.test.ts`
- `examples/zero-after-midnight/test/player-input-gate.test.ts`
- `examples/zero-after-midnight/test/player-ui-integration.test.ts`
- `examples/zero-after-midnight/test/gallery-content-contract.test.ts`
- `examples/zero-after-midnight/test/gallery-music-playback.test.ts`
- `packages/shell/e2e/player-experience-wave-4.e2e.mjs`

## 完成判定

只有同时满足以下条件，交付报告才能建议 `STAGE_4_FOUNDATION_STABILITY_VERIFIED`：

1. Task 0 基线与远端关系真实、tracked 工作树和暂存区无修改；
2. Task 1 五组聚焦测试全部 exit `0`；
3. 《零点之后》一次模拟完成全部已声明分支与结局，运行时错误为 `0`；
4. 五个受影响工作区 typecheck 全部 exit `0`；
5. Wave 4 runner 语法与 contract 通过；
6. 正式 Electron 只运行一次 `--case F` 并得到 `PASSED` artifact，artifact `head` 等于运行时 `git rev-parse HEAD`，六类错误通道和窗口意外关闭均为空/false；
7. Stage 3 artifact 和项目所有者 11 步人工通过事实被正确复用，没有冒充本轮重新执行；
8. 没有生产代码、测试代码、harness、音频、编辑器或性能文件变化；
9. 报告、计划、HEAD、工作树、artifact 路径、字节数和 SHA-256 从磁盘重新读取并一致；
10. 仅计划与报告进入一个普通本地文档提交，未 push，停止等待总经理独立复审。

---

### Task 0：读取权威资料并冻结真实基线

- [x] **Step 1：读取项目约束与当前阶段资料**

依次完整读取：

```text
E:\surdet\AGENTS.md
E:\surdet\docs\superpowers\plans\2026-08-13-project-roadmap-and-decision-ledger.md
E:\surdet\docs\superpowers\plans\2026-08-13-save-backup-and-explicit-recovery-wave-1.md
E:\surdet\docs\ENGINE-SAVE-BACKUP-AND-EXPLICIT-RECOVERY-WAVE-1-DELIVERY-REPORT-2026-08-13.md
E:\surdet\docs\superpowers\plans\2026-08-13-foundation-stability-stage-4.md
```

Expected：确认 Stage 3 已完成自动化、总经理复审、部署和项目所有者 11 步人工验收；Stage 4 是只读地基确认，不是新功能开发。

- [x] **Step 2：记录 Git、远端与工作树**

Run：

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
```

Expected：分支为 `main`；任务开始时本地与 `surdet/main` 同步；tracked diff、暂存区和 tracked `.log` 为空。原有未跟踪文件保持原样。

- [x] **Step 3：从磁盘重新读取既有 Stage 3 artifact**

Run：

```powershell
$artifact = '<local-path>'
Get-Item -LiteralPath $artifact | Select-Object FullName,Length,LastWriteTime
Get-FileHash -LiteralPath $artifact -Algorithm SHA256
Get-Content -LiteralPath $artifact -Raw
```

Expected：文件仍存在；`1,097` bytes；SHA-256 为 `D078476A7379FDFBD80F7147DAABFD8D7BB54068837CB07704B94D9385BC692F`；`PASSED`；位置 `prologue:7 → prologue:8 → prologue:7`；错误数组为空。若身份不一致，停止并报告，不重新生成 Stage 3 artifact。

- [x] **Step 4：写入 Execution Ledger 的 Task 0 事实**

必须记录时间、HEAD、远端关系、工作树、Stage 3 artifact 身份、人工验收已通过事实，以及本轮没有新缺陷红灯。

### Task 1：运行跨层聚焦门禁

- [x] **Step 1：运行 Core 状态、存档与恢复聚焦测试**

Run：

```powershell
npm run test -w @surdet/core -- --run test/growth.test.ts test/save.test.ts test/audit-fixes.test.ts test/interpreter-save.test.ts
```

Expected：exit `0`。记录测试文件数与测试数，不把历史数量凭记忆写入报告。

- [x] **Step 2：运行 Renderer UI、资源、回退与 Gallery 聚焦测试**

Run：

```powershell
npm run test -w @surdet/renderer -- --run test/legacy/menu-layer.test.ts test/integration/presentation-clear.test.ts test/integration/resource-cycles.test.ts test/rollback-buffer.test.ts test/gallery.test.ts test/keybindings.test.ts
```

Expected：exit `0`；不得运行 `test/performance.test.ts`。

- [x] **Step 3：运行 Host 协调、存储与回退聚焦测试**

Run：

```powershell
npm run test -w @surdet/host -- --run test/electron-save-storage.test.ts test/player-ui-coordination.test.ts test/rollback-runtime.test.ts test/presentation-connection.test.ts
```

Expected：exit `0`。

- [x] **Step 4：运行 Shell 存储与既有真实路径合同测试**

Run：

```powershell
npm run test -w @surdet/shell -- --run test/save-store.test.ts test/player-experience-wave-4-e2e-contract.test.ts test/player-experience-wave-5c-e2e-contract.test.ts test/player-experience-gallery-music-e2e-contract.test.ts
```

Expected：exit `0`。这里只验证 runner 合同，不运行 Wave 5C 大型 Electron 协议或 Gallery 音频试听。

- [x] **Step 5：运行 Zero UI、输入、Gallery 与接线聚焦测试**

Run：

```powershell
npm exec -w zero-after-midnight -- vitest run test/player-ui-session.test.ts test/player-input-gate.test.ts test/player-ui-integration.test.ts test/gallery-content-contract.test.ts test/gallery-music-playback.test.ts
```

Expected：exit `0`。不运行 `audio-assets.test.ts`，不把音频艺术质量纳入 Stage 4。

- [x] **Step 6：记录 Task 1 结果或首个失败节点**

若全部通过，记录每条命令的 exit code、文件数和测试数。若任一失败，停止后续测试，不编辑源码；把失败输出、相关性判断、最后通过节点和第一个失败节点写入 Ledger 与交付报告。

### Task 2：确认内容闭环与静态边界

- [x] **Step 1：运行一次《零点之后》内容模拟**

Run：

```powershell
npm run simulate -w zero-after-midnight
```

Expected：exit `0`；记录实际分支、结局、save/load 次数和运行时错误数。不得把旧报告中的数量直接复制为本轮结果。

- [x] **Step 2：运行五个受影响工作区 typecheck**

Run，严格按依赖顺序：

```powershell
npm run typecheck -w @surdet/core
npm run typecheck -w @surdet/renderer
npm run typecheck -w @surdet/host
npm run typecheck -w @surdet/shell
npm run typecheck -w zero-after-midnight
```

Expected：五项均 exit `0`。

- [x] **Step 3：验证唯一正式 runner 的语法与合同**

Run：

```powershell
node --check packages/shell/e2e/player-experience-wave-4.e2e.mjs
npm run test -w @surdet/shell -- --run test/player-experience-wave-4-e2e-contract.test.ts
```

Expected：两项均 exit `0`。若失败，不修改 runner，停止并报告。

### Task 3：只运行一次正式 Electron Case F

- [x] **Step 1：确认没有其他 Electron 验收或执行会话占用窗口**

Run：

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle,Path
```

Expected：没有项目所有者正在使用的 Electron 窗口。若存在，不关闭、不杀进程，停止并等待总经理协调。

- [x] **Step 2：运行唯一一次正式 Case F，并精确定位本轮新 artifact**

Run exactly once：

```powershell
$beforeRoots = @(Get-ChildItem -LiteralPath ([System.IO.Path]::GetTempPath()) -Directory -Filter 'surdet-player-experience-wave-4-*' | Select-Object -ExpandProperty FullName)
node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case F
$runnerExit = $LASTEXITCODE
$afterRoots = @(Get-ChildItem -LiteralPath ([System.IO.Path]::GetTempPath()) -Directory -Filter 'surdet-player-experience-wave-4-*' | Select-Object -ExpandProperty FullName)
$newRoots = @($afterRoots | Where-Object { $beforeRoots -notcontains $_ })
if ($newRoots.Count -ne 1) { throw "本轮应只生成一个 Wave 4 临时目录，实际为 $($newRoots.Count)：$($newRoots -join ', ')" }
$artifacts = @(Get-ChildItem -LiteralPath $newRoots[0] -File -Filter 'player-experience-wave-4-*.json')
if ($artifacts.Count -ne 1) { throw "本轮应只生成一个 Case F JSON artifact，实际为 $($artifacts.Count)" }
$artifact = $artifacts[0].FullName
Get-Item -LiteralPath $artifact | Select-Object FullName,Length,LastWriteTime
Get-FileHash -LiteralPath $artifact -Algorithm SHA256
Get-Content -LiteralPath $artifact -Raw
git rev-parse HEAD
if ($runnerExit -ne 0) { exit $runnerExit }
```

Expected：runner 自行按顺序构建 Core、Renderer、Host、Shell、Zero；使用正式 `examples/zero-after-midnight/dist`、独立临时 `userData` 和真实 Playwright 鼠标/键盘；Case F 完成多轮 save/load 状态恢复；最终 artifact `status=PASSED`。

禁止：失败后重跑、改 runner、改断言、改生产代码、改剧情、切换到 smoke 或其他 case 挑绿。

- [x] **Step 3：核对同一命令读取出的 artifact 身份**

Expected：Step 2 精确发现一个新临时目录和一个 JSON；`status=PASSED`；只有 Case F 且 `ok=true`；artifact `head` 等于同一命令读取的运行时 HEAD；正式 Zero 路径和隔离目录正确；page、console、request、unhandled、renderer、release 错误数组均为空，`unexpectedWindowClosed=false`；保存状态、扰动状态和两次恢复状态符合 runner 断言。报告必须使用 Step 2 从磁盘输出的真实绝对路径、字节数与 SHA-256。

### Task 4：综合判定，不追加施工

- [x] **Step 1：建立三栏证据表**

在交付报告中分别列出：

1. **本轮新鲜验证：** Task 1/2 命令、Task 3 Case F artifact；
2. **复用的既有证据：** Stage 3 显式恢复 artifact、项目所有者 11 步全部通过；
3. **尚未验证或明确延期：** 占位音乐艺术质量、编辑器创作闭环、性能资格化、正式打包/发行、无真实症状的理论恢复缺口。

- [x] **Step 2：按完成判定得出唯一状态**

全部满足时建议：

```text
STAGE_4_FOUNDATION_STABILITY_VERIFIED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
STAGE_5_NOT_STARTED
NOT_PUSHED_AFTER_STAGE_4
```

任一相关门禁失败时写：

```text
STAGE_4_BLOCKED_BY_FOCUSED_GATE
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
STAGE_5_NOT_STARTED
NOT_PUSHED_AFTER_STAGE_4
```

不得由执行 AI写 `STAGE_5_APPROVED`。

### Task 5：更新计划与交付报告

- [x] **Step 1：创建交付报告**

Create：

```text
E:\surdet\docs\ENGINE-FOUNDATION-STABILITY-STAGE-4-DELIVERY-REPORT-2026-08-13.md
```

报告必须先给“通过 / 阻断”结论，再写：范围、未修改内容、真实基线、逐命令结果、Case F artifact、复用证据、证据缺口、Git 状态、未 push、停止点，以及“建议由总经理登记的事实”。

- [x] **Step 2：更新本文 Execution Ledger 与复选框**

每个 Task 记录实际开始/结束时间、HEAD、命令、exit code、测试数量、artifact 路径/字节数/SHA-256、失败证据、实际修改文件和下一停止点。不得把未运行命令写成通过。

- [x] **Step 3：重新读取两份文档并做结构检查**

Run：

```powershell
git diff --check
Get-Item -LiteralPath 'E:\surdet\docs\superpowers\plans\2026-08-13-foundation-stability-stage-4.md','E:\surdet\docs\ENGINE-FOUNDATION-STABILITY-STAGE-4-DELIVERY-REPORT-2026-08-13.md' | Select-Object FullName,Length
Get-FileHash -LiteralPath 'E:\surdet\docs\superpowers\plans\2026-08-13-foundation-stability-stage-4.md','E:\surdet\docs\ENGINE-FOUNDATION-STABILITY-STAGE-4-DELIVERY-REPORT-2026-08-13.md' -Algorithm SHA256
```

Expected：`git diff --check` exit `0`；从磁盘获得两份文档真实字节数和 SHA-256，并写入 Ledger/报告。

### Task 6：精确提交并停止

- [x] **Step 1：确认只有两份授权文档发生 tracked/untracked 变化**

Run：

```powershell
git status --short
git diff --name-only
git diff --cached --name-only
```

Expected：本轮新增/修改只涉及 Stage 4 计划与交付报告；原有未跟踪文件保持原样。

- [x] **Step 2：只暂存两份 Stage 4 文档**

Run：

```powershell
git add -- docs/superpowers/plans/2026-08-13-foundation-stability-stage-4.md docs/ENGINE-FOUNDATION-STABILITY-STAGE-4-DELIVERY-REPORT-2026-08-13.md
git diff --cached --name-status
git diff --cached --check
```

Expected：暂存区精确只有两份文档。

- [x] **Step 3：创建一个普通本地文档提交**

Run：

```powershell
git commit -m "docs(engine): record foundation stability stage 4"
```

Expected：提交成功；不得 amend、squash、rebase 或 push。

- [x] **Step 4：提交后最终只读核验并停止**

Run：

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
```

Expected：分支仍为 `main`；本地只领先本轮一个文档提交；tracked 工作树与暂存区为空；长期路线台账及受保护文件仍未跟踪、未暂存；tracked `.log` 为空。

最终停止并向总经理提交完整报告：

```text
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED_AFTER_STAGE_4
STAGE_5_NOT_STARTED
```

---

## Execution Ledger

> 由执行 AI按实际运行结果逐 Task 追加。开始施工前不得预填绿灯、测试数、artifact 路径、字节数、SHA-256 或最终提交 HEAD。

### Task 0 — completed (2026-08-13 18:08–18:09)

- 已完整读取本任务要求的五份权威文件；确认 Stage 4 是只读稳定性确认，不是功能开发；复用 Stage 3 自动化 artifact 和项目所有者 11 步人工验收事实，不重复人工验收。
- 真实基线：分支 `main`；`HEAD=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；`git rev-list --left-right --count HEAD...surdet/main = 0 0`。
- `git status --short --untracked-files=all` 仅列出既有未跟踪的 `AGENTS.md`、受保护文件、handoff 文件、Stage 4 任务书和长期路线台账；没有 tracked 修改。`git diff --check`、`git diff --cached --check` 均 exit `0`；`git ls-files '*.log'` 为空。
- Stage 3 artifact 从磁盘重新读取：`<local-path>`，`1,097` bytes，SHA-256 `D078476A7379FDFBD80F7147DAABFD8D7BB54068837CB07704B94D9385BC692F`，`status=PASSED`，`runHead=fc82f5cebcdfb84438d10a3b9b6616664e82ba49`；位置为 `prologue:7 → prologue:8 → prologue:7`，资源 `48/48`、`failed=0`，恢复目标可见，`events` 六类错误数组及 `failures` 均为空。
- 复用的人工事实：项目所有者已在正式《零点之后》开发窗口完成 11 步验收并明确反馈“全部顺利通过”；本轮不把该事实写成重新执行。
- 本 Task 0 没有修改生产代码、测试、runner、harness 或长期路线台账；没有新缺陷红灯。下一停止点：Task 1 五组聚焦门禁。

### Task 1 — completed (2026-08-13 18:09–18:10)

- Core：`npm run test -w @surdet/core -- --run test/growth.test.ts test/save.test.ts test/audit-fixes.test.ts test/interpreter-save.test.ts`，exit `0`；4 files passed，`80` tests passed。
- Renderer：`npm run test -w @surdet/renderer -- --run test/legacy/menu-layer.test.ts test/integration/presentation-clear.test.ts test/integration/resource-cycles.test.ts test/rollback-buffer.test.ts test/gallery.test.ts test/keybindings.test.ts`，exit `0`；6 files passed，`47` tests passed；未运行 performance 测试。
- Host：`npm run test -w @surdet/host -- --run test/electron-save-storage.test.ts test/player-ui-coordination.test.ts test/rollback-runtime.test.ts test/presentation-connection.test.ts`，exit `0`；4 files passed，`33` tests passed。
- Shell：`npm run test -w @surdet/shell -- --run test/save-store.test.ts test/player-experience-wave-4-e2e-contract.test.ts test/player-experience-wave-5c-e2e-contract.test.ts test/player-experience-gallery-music-e2e-contract.test.ts`，exit `0`；4 files passed，`44` tests passed；只运行合同测试，未运行 Wave 5C Electron 协议或音频试听。
- Zero：`npm exec -w zero-after-midnight -- vitest run test/player-ui-session.test.ts test/player-input-gate.test.ts test/player-ui-integration.test.ts test/gallery-content-contract.test.ts test/gallery-music-playback.test.ts`，exit `0`；5 files passed，`29` tests passed；未运行 `audio-assets.test.ts`。
- Task 1 合计：23 test files、`233` tests，全部 exit `0`；没有失败节点，没有修改生产代码、测试、runner 或 harness。下一停止点：Task 2 内容模拟、typecheck、Wave 4 语法与合同。

### Task 2 — completed (2026-08-13 18:11–18:12)

- Zero 内容模拟：`npm run simulate -w zero-after-midnight`，exit `0`；实际报告 11 场景、24 条探索路径、choice 分支 `23/23`、存档往返 `39` 次、结局 `testimony_end` 3 次 / `meeting_end` 2 次 / `silence_end` 3 次、运行时错误 `0`。
- 五个工作区 typecheck 严格按依赖顺序运行，全部 exit `0`：`npm run typecheck -w @surdet/core`、`@surdet/renderer`、`@surdet/host`、`@surdet/shell`、`zero-after-midnight`。
- Wave 4 runner：`node --check packages/shell/e2e/player-experience-wave-4.e2e.mjs` exit `0`。
- Wave 4 合同：`npm run test -w @surdet/shell -- --run test/player-experience-wave-4-e2e-contract.test.ts` exit `0`；1 file passed，`6` tests passed。
- Task 2 没有修改生产代码、测试、runner 或 harness。下一停止点：Task 3 先确认没有项目所有者正在使用的 Electron 窗口，再只运行一次 Case F。

### Task 3 — completed (2026-08-13 18:12–18:14)

- 窗口占用检查：`Get-Process electron -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle,Path` 无输出；没有项目所有者正在使用的 Electron 窗口，未关闭或杀进程。
- 唯一正式运行：按任务书 wrapper 只执行一次 `node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case F`；runner exit `0`。运行前后临时目录差异为唯一新目录 `<local-path>`，其中唯一 JSON artifact 为 `player-experience-wave-4-1786615968531.json`。
- Case F artifact 从磁盘重新读取：`<local-path>`，`60,488` bytes，SHA-256 `929E9552A34456AF2194B01C05C2D47A0A1D27947BF028A60BD7E0D6FC83A339`，顶层 `status=PASSED`，唯一 case `F` 的 `ok=true`。
- artifact 身份：`head=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；`sourceRoot=E:\surdet\examples\zero-after-midnight`；`distRoot=E:\surdet\examples\zero-after-midnight\dist`；独立 `userData=<local-path>`；窗口标题 `零点之后 / AFTER MIDNIGHT`。
- Case F 真实路径：`title:new → story:advance×43→portrait → save→load → world:perturb×19 → save→load → world:perturb×19 → save→load`；初始位置 `prologue:7`，保存/两次加载位置均为 `common_0017:18`；实际包含两轮 world perturb 与三次 save/load 链。
- 资源与错误通道：`total=48`、`completed=48`、`failed=0`、`assetComplete=true`；`pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 均为 0 个；`unexpectedWindowClosed=false`；`screenshots=0`；顶层 `error=null`。
- 末尾状态快照为 `base=game`、`overlay=none`、`operation=idle`、`rendererStatus=awaiting`、资源已完成、`lastRendererError=null`。Case F 完成后没有残留 Electron 进程输出。
- 本 Task 3 没有修改生产代码、测试、runner 或 harness；下一停止点：Task 4 建立三栏证据表并做唯一判定。

### Task 4 — completed (2026-08-13 18:14–18:15)

- **本轮新鲜验证：** Task 1 五组聚焦门禁共 23 files / 233 tests 全部通过；Task 2 Zero 模拟覆盖 23/23 choice 分支、3 类结局、39 次 save/load、运行时错误 0；五工作区 typecheck 全部 exit `0`；Wave 4 runner `node --check` exit `0`、合同测试 1 file / 6 tests 通过；Task 3 Case F 唯一 artifact `PASSED`，60,488 bytes，SHA-256 `929E9552A34456AF2194B01C05C2D47A0A1D27947BF028A60BD7E0D6FC83A339`，正式 dist、独立 userData、真实输入、多轮 save/load、48/48 资源、六类错误通道为空、`unexpectedWindowClosed=false`。
- **复用的既有证据：** Stage 3 显式备份恢复 artifact `PASSED`，1,097 bytes，SHA-256 `D078476A7379FDFBD80F7147DAABFD8D7BB54068837CB07704B94D9385BC692F`，位置 `prologue:7 → prologue:8 → prologue:7`；项目所有者已在正式部署窗口完成 11 步人工验收并反馈“全部顺利通过”，本轮没有重复执行或冒充重新验收。
- **尚未验证或明确延期：** 占位 BGM 的艺术质量、编辑器创作闭环、性能资格化、正式打包/发行、无真实症状的理论恢复缺口和远端 CI 测试结果；这些不属于本轮判定条件。
- 所有 Stage 4 完成判定条件均有本轮命令或既有明确证据支撑；没有生产代码、测试代码、runner、harness、音频、编辑器或性能文件变化。本轮唯一判定为：`STAGE_4_FOUNDATION_STABILITY_VERIFIED` / `READY_FOR_INDEPENDENT_MANAGER_REVIEW` / `STAGE_5_NOT_STARTED` / `NOT_PUSHED_AFTER_STAGE_4`。执行 AI 不写 `STAGE_5_APPROVED`。下一停止点：Task 5 文档收口。

### Task 5 — completed (2026-08-13 18:15–18:18)

- 已创建 `docs/ENGINE-FOUNDATION-STABILITY-STAGE-4-DELIVERY-REPORT-2026-08-13.md`，报告先给出 `STAGE_4_FOUNDATION_STABILITY_VERIFIED`，并完整区分本轮新鲜验证、Stage 3 复用证据、尚未验证事项、Git 边界和“建议由总经理登记的事实”。
- 已更新本计划 Task 0–4 的复选框与 Execution Ledger；报告和计划均明确没有生产代码、测试、runner、harness 或长期路线台账修改。
- `git diff --check` exit `0`。从磁盘重新读取：任务书 `26,372` bytes，SHA-256 `D6C78AE91F7B008494444A5F4908535CA47E73F5F100B40061BBB29B0A01FE68`；交付报告 `12,402` bytes，SHA-256 `3319C31545C60DD1EAF02E81603BF8A54FCEEBC2E29D1DE415B34887BC5EBD6B`。
- Case F artifact 从磁盘重新读取：`<local-path>`，`60,488` bytes，SHA-256 `929E9552A34456AF2194B01C05C2D47A0A1D27947BF028A60BD7E0D6FC83A339`，`status=PASSED`，`head=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`。
- 本 Task 5 没有修改生产代码、测试、runner、harness 或长期路线台账。下一停止点：Task 6 精确暂存两份文档并创建一个普通本地文档提交。

### Task 6 — completed (2026-08-13 18:18–18:20)

- Step 1 已确认：原有未跟踪文件保持原样，本轮只新增 Stage 4 计划和交付报告。
- Step 2 已完成：暂存区严格只有 `docs/superpowers/plans/2026-08-13-foundation-stability-stage-4.md` 与 `docs/ENGINE-FOUNDATION-STABILITY-STAGE-4-DELIVERY-REPORT-2026-08-13.md`；`git diff --cached --check` exit `0`。
- Step 3 按授权创建一个普通本地提交，提交信息为 `docs(engine): record foundation stability stage 4`；不 amend、不 squash、不 rebase、不 push。
- Step 4 在提交后立即重新读取分支、HEAD、`surdet/main`、ahead/behind、工作树、diff check、暂存区 diff check 和 tracked logs；最终停止为 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW` / `NOT_PUSHED_AFTER_STAGE_4` / `STAGE_5_NOT_STARTED`。
