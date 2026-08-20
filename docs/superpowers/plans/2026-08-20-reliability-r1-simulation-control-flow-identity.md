# Reliability R1 Simulation Control-Flow Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `simulateSnapshot()` 的状态签名遗漏 `callStack` 所造成的错误路径合并，使相同剧情位置和变量、但返回目标不同的两条真实控制流都能被模拟器探索并报告。

**Architecture:** 修复只落在共享 `@surdet/authoring` 模拟器：从同一份 Core `SaveSnapshot` 提取 `position + callStack + variables`，构造最小、确定性的控制流状态签名。CLI、Editor 和未来 Agent Port 继续消费同一 `SimulationReport`，不复制第二套模拟器，不修改 Core 存档结构，也不关闭既有循环剪枝或放宽路径预算。

**Tech Stack:** TypeScript 5.7、Vitest 3、`@surdet/core` `SaveSnapshot`、`@surdet/authoring`、Node.js ≥ 20、npm workspaces、PowerShell 7。

## Global Constraints

- 本轮唯一主题是 `R1 / SIM-STATE-1`；不得顺手处理 R2～R6、Wave 4、M2、N9、音频、性能、发行或文档大整理。
- 生产修改白名单只有 `packages/authoring/src/simulation.ts`；正式测试修改白名单只有 `packages/authoring/test/simulation.test.ts`。
- 不得修改 Core、CLI、Editor、Renderer、Host、Shell、Starter、Zero 或任何游戏内容；CLI 只运行既有下游验证，不修改代码或测试。
- 不得改变 `SaveSnapshot`、`SimulationReport`、`SimulationPath` 或存档 schema；不得新增兼容层、配置开关、依赖或公共导出。
- 状态签名必须至少包含 `position`、规范化的 `callStack` 和 `variables`；三者必须来自同一份 `interpreter.saveSnapshot()` 返回值。
- `callStack: undefined` 只按旧 schema 的空栈语义规范化为 `[]`；不得猜测返回点、修改帧顺序或删除 `sceneHash`。
- 不得把时间戳、槽位 ID、存档类型等与未来控制流无关的元数据纳入签名，避免破坏有效循环剪枝。
- 不得用关闭 `seenSignatures`、清空集合、提高 `maxPaths`、提高 `maxStepsPerPath`、减少断言或把失败路径标为成功等方式制造绿灯。
- 既有 `pathsExplored`、`cyclesPruned`、`termination=pruned`、`prunedReason=state-signature`、路径预算和 Runtime 错误报告语义必须保持。
- Fresh Gate 的失败 artifact 必须只读保留；本轮创建新的 R1 红/绿证据目录，不覆盖旧证据。
- 只允许一次正式 RED 运行；修复后的单测试聚焦循环最多 3 次。全量 authoring 测试、下游 CLI 测试、Starter 模拟和 `verify:all` 各最多正式运行一次。
- `verify:all` 仅在所有聚焦验证通过后运行一次；若失败，记录最后通过节点和第一个失败节点，不循环重跑、不扩大修复范围。
- 不得运行 Electron、浏览器、FORMAL/DIAGNOSTIC 聚合、性能矩阵、pack、部署或发行。
- 只可使用精确路径暂存；禁止 `git add -A`、`git add .`、reset、checkout、clean、stash、amend、rebase、force push。
- 本轮只创建普通本地提交；不得 push。Wave 4 implementation 在总经理重新授权前保持暂停。
- 长期路线台账、AGENTS、handoff、`.learnings` 和受保护文件均不得修改、暂存、提交、删除或移动。
- 质量优先；在质量不受影响时，验证成本与额度消耗是第二优先级。不得为形式完整重复已经取得的相同证据。

---

## 一、权威依据与当前裁决

执行前按顺序完整读取：

1. `AGENTS.md`
2. `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`
3. `docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md`
4. `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md`
5. 本任务书

Fresh Gate 已经确认：

```text
SIM_STATE_1_REPRODUCED
currentSignature = JSON.stringify([base.position, store.snapshot()])
observedResult = caller B 的真实 @check 错误路径被剪枝，report.status 错误地保持 passed
productionFix = NOT_STARTED
```

总经理独立复审已确认 Fresh Gate 的提交范围、7 份 artifact 身份、临时测试清理和零生产修改。R1 只把已经证实的临时红灯升级为正式回归并实施最小修复，不重新执行整个 Fresh Gate。

## 二、正确性合同

### 2.1 状态等价关系

在 `simulateSnapshot()` 的 choice 检查点，两条路径只有同时满足以下三项，才允许被视为同一可剪枝状态：

```text
same(position)
AND same(callStack)
AND same(variables)
```

其中：

- `position` 表示当前场景和下一条指令；
- `callStack` 表示后续 `@return` 的有序返回点，栈顶位于数组末尾；
- `variables` 表示表达式、条件和后续剧情可观察的变量状态。

下列状态必须不同：

```text
position 相同
variables 相同
callStack 不同
```

因为相同的 `@return` 会回到不同 caller，继而产生不同的后续指令、结局或 Runtime 错误。

### 2.2 本轮签名算法

本轮采用以下局部 helper，不导出公共接口：

```ts
function simulationStateSignature(snapshot: SaveSnapshot): string {
  return JSON.stringify([
    snapshot.position,
    snapshot.callStack ?? [],
    snapshot.variables,
  ]);
}
```

选择该形状的理由：

- 三项都来自同一份 `SaveSnapshot`，避免 `base.position` 与另一次 `store.snapshot()` 形成分裂时点；
- 数组顺序保留调用栈语义；
- `undefined -> []` 与 Core 对旧 schema 的空栈迁移语义一致；
- 不纳入 `meta.createdAt`、`updatedAt`、`kind` 等瞬态信息，因此不会让每次快照都成为唯一状态；
- 不引入新的稳定序列化依赖，也不改变现有变量快照的键顺序合同。

### 2.3 必须保护的既有语义

正式测试除新回归外，必须继续证明：

1. 真正相同的循环状态仍会 `state-signature` 剪枝；
2. `cyclesPruned > 0` 的既有循环 fixture 仍然通过；
3. `pathsExplored` 继续独立于 retained `paths.length`；
4. `maxPaths=1` 仍得到 `status=incomplete` 与 `budgetExhausted=true`；
5. 新回归中的 caller B 错误必须进入 `runtimeErrors`，并使总报告为 `failed`；
6. CLI 继续直接映射共享模拟报告，不产生第二套计数或签名逻辑；
7. Starter 仍可完成 headless simulation，既有结局、剪枝和零 Runtime 错误结果不得被本轮意外破坏。

## 三、文件结构与所有权

| 文件 | 本轮责任 | 允许的变化 |
|---|---|---|
| `packages/authoring/src/simulation.ts` | 共享模拟状态签名 | 新增一个文件内私有 helper；替换一处签名构造 |
| `packages/authoring/test/simulation.test.ts` | 永久回归合同 | 新增 callStack fixture 与一个正式测试；不得删除既有断言 |
| `docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md` | 执行步骤与 Ledger | 只追加真实执行记录，不改写预先批准的合同 |
| `docs/RELIABILITY-R1-SIMULATION-CONTROL-FLOW-IDENTITY-DELIVERY-REPORT-2026-08-20.md` | 最终交付报告 | 验证结束后创建 |

明确不创建：

- 新的模拟器模块；
- CLI 专用签名 helper；
- Core 快照 wrapper；
- feature flag、migration、fallback 或配置项；
- Wave 4 Agent Port 文件；
- 仓库内 artifact、日志或临时 fixture。

## 四、验证预算与失败纪律

| 验证 | 正式预算 | 失败时动作 |
|---|---:|---|
| 新永久回归 RED | 1 次 | 若未命中既有症状，停止并复审测试设计 |
| 新永久回归 GREEN | 最多 3 次 | 只允许修改白名单实现；第 3 次仍失败即停止 |
| `simulation.test.ts` 全文件 | 1 次 | 报告首个相邻回归，不扩大范围 |
| authoring 全测试 | 1 次 | 报告首个相关失败 |
| authoring typecheck/build | 各 1 次 | 只修白名单内直接类型/构建问题 |
| CLI `simulate.test.ts` | 1 次 | 若因旧 dist，确认 authoring build 已真实完成；不得盲目重跑 |
| Starter simulation | 1 次 | 报告实际统计，不修改 Starter |
| `verify:all` | 1 次 | 记录首个失败节点并停止，不循环运行 |

所有 JSON 与文本输出写入新的系统临时目录：

```text
%TEMP%\surdet-r1-sim-state-<unique-id>\
```

建议文件名固定为：

```text
red-sim-state-vitest.json
green-sim-state-vitest.json
simulation-suite.txt
authoring-suite.txt
cli-simulate.txt
starter-simulate.txt
verify-all.txt
```

---

### Task 0: 权威基线、源码身份与证据目录

**Files:**
- Read: `AGENTS.md`
- Read: `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`
- Read: `docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md`
- Read: `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md`
- Read: `packages/authoring/src/simulation.ts:85-250`
- Read: `packages/authoring/test/simulation.test.ts:1-180`
- Modify: 本任务书的 `Execution Ledger`

**Interfaces:**
- Consumes: 已批准的 Fresh Gate 结论、真实 Git 状态、当前共享模拟实现。
- Produces: `R1_BASELINE_ACCEPTED` 或明确的 Task 0 阻断；唯一 `$r1Root`。

- [ ] **Step 1: 按权威顺序读取文件**

逐份完整读取，不只 grep 标题。确认 Fresh Gate 对 R1 的分类仍是 `SIM_STATE_1_REPRODUCED`，且 R1 没有被其他提交提前修复。

- [ ] **Step 2: 记录真实 Git 基线**

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse HEAD^
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
git status --short --untracked-files=all
git diff --check
git diff --cached --check
git ls-files '*.log'
```

Expected planning reference：

```text
branch = main
HEAD = 0052927df0ceb30941cb8b17af479623f23204bc
HEAD_PARENT = 6c55d6c68a1235bf5d5d8f7b4cc07d2dd66e43be
surdet/main = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
ahead/behind = 5 0
tracked worktree = clean
staging area = empty
```

执行时必须记录新鲜值，不得照抄 planning reference。允许存在本任务书以及已知未跟踪治理/受保护文件；若出现未记录的 tracked 源码修改、暂存内容或新的生产提交，停止并报告，不整理他人工作。

- [ ] **Step 3: 回读被测源码身份**

```powershell
$sourceFiles = @(
  'packages/authoring/src/simulation.ts',
  'packages/authoring/test/simulation.test.ts',
  'packages/core/src/save/save-manager.ts',
  'packages/core/src/runtime/interpreter.ts'
)
$sourceFiles | ForEach-Object {
  $item = Get-Item -LiteralPath $_
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash
  "$_`t$($item.Length)`t$hash"
}
```

并核对当前缺陷行仍等价于：

```ts
const signature = JSON.stringify([base.position, store.snapshot()]);
```

若签名已经包含 `base.callStack`，停止并报告 `R1_ALREADY_CHANGED_REQUIRES_REBASE_REVIEW`，不得重复施工。

- [ ] **Step 4: 创建唯一证据目录**

```powershell
$runId = [guid]::NewGuid().ToString('N')
$r1Root = Join-Path $env:TEMP "surdet-r1-sim-state-$runId"
New-Item -ItemType Directory -Path $r1Root | Out-Null
Get-Item -LiteralPath $r1Root | Select-Object FullName,CreationTimeUtc
```

将绝对路径写入 Ledger。后续同一轮命令必须继续使用同一个 `$r1Root`，不得覆盖 Fresh Gate 目录。

- [ ] **Step 5: 写入 Task 0 Ledger**

记录：时间、branch、HEAD、parent、remote、ahead/behind、tracked/staged 状态、已知 untracked、源码 bytes/SHA-256、证据目录、当前授权与停止点。

Expected：

```text
R1_TASK_0 = PASSED
R1_IMPLEMENTATION = AUTHORIZED_BY_TASKBOOK_ONLY_AFTER_RED
WAVE_4_IMPLEMENTATION = PAUSED
PUSH = NOT_AUTHORIZED
```

---

### Task 1: 把 Fresh Gate 临时红灯升级为正式回归测试

**Files:**
- Modify: `packages/authoring/test/simulation.test.ts`
- Read: `packages/authoring/src/project-storage.ts`
- Read: `packages/authoring/src/project-snapshot.ts`
- Artifact: `<r1Root>/red-sim-state-vitest.json`
- Modify: 本任务书 `Execution Ledger`

**Interfaces:**
- Consumes: `ProjectStorage`、`TextHasher`、`loadProjectSnapshot()`、`simulateSnapshot()`。
- Produces: 永久测试 `distinguishes equal position and variables when call stacks differ`；新鲜 RED artifact。

- [ ] **Step 1: 在正式测试文件中加入 callStack fixture**

在 `loopFixtureStorage()` 之后、`describe('simulateSnapshot'...)` 之前加入以下完整 helper；复用文件现有的 `hasher` 和 `ProjectFile`/`ProjectStorage` 类型，不创建第二个测试文件：

```ts
function callStackIdentityFixtureStorage(): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': JSON.stringify({ entryScene: 'entry', variables: {} }),
    'content/scenario/entry.gal': [
      '@scene entry',
      '@choice',
      '  路径 A -> @jump caller_a',
      '  路径 B -> @jump caller_b',
      '@end',
    ].join('\n'),
    'content/scenario/caller_a.gal': [
      '@scene caller_a',
      '@call shared',
      '@clear safe_end',
      '@end',
    ].join('\n'),
    'content/scenario/caller_b.gal': [
      '@scene caller_b',
      '@call shared',
      '@check false',
      '@end',
    ].join('\n'),
    'content/scenario/shared.gal': [
      '@scene shared',
      '@choice',
      '  继续 -> @goto done',
      '@label done',
      '@return',
    ].join('\n'),
  };
  return {
    rootIdentity: 'simulation-call-stack-identity',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error(`missing fixture file: ${path}`);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}
```

不得从已经删除的临时测试路径读取代码；以上正文就是批准的永久 fixture。

- [ ] **Step 2: 加入一个匹配真实症状的永久测试**

在 `describe('simulateSnapshot', ...)` 内、既有循环剪枝测试之前加入：

```ts
it('distinguishes equal position and variables when call stacks differ', async () => {
  const snapshot = await loadProjectSnapshot(callStackIdentityFixtureStorage(), hasher);
  const report = await simulateSnapshot(snapshot, { maxPaths: 20, maxStepsPerPath: 200 });

  expect(report.status).toBe('failed');
  expect(report.runtimeErrors).toHaveLength(1);
  expect(report.runtimeErrors[0]?.scene).toBe('caller_b');
  expect(report.runtimeErrors[0]?.message).toContain('@check 断言失败');
  expect(report.endings).toEqual([{ ending: 'safe_end', times: 1 }]);
  expect(report.budgetExhausted).toBe(false);
});
```

这些断言共同证明两条 caller 路径都真实执行：A 到达 `safe_end`，B 到达 `@check false`。不得只断言 `cyclesPruned` 数字变化。

- [ ] **Step 3: 检查测试 diff，仅确认测试设施**

```powershell
git diff -- packages/authoring/test/simulation.test.ts
git diff --check -- packages/authoring/test/simulation.test.ts
```

Expected：只新增 fixture 和一个测试；既有测试、断言、预算均未删除或放宽。

- [ ] **Step 4: 正式运行一次 RED**

```powershell
npm run test -w @surdet/authoring -- simulation.test.ts -t "distinguishes equal position and variables when call stacks differ" --reporter=json --outputFile="$r1Root\red-sim-state-vitest.json"
$redExit = $LASTEXITCODE
"RED_EXIT=$redExit"
```

Expected：exit `1`，首个合同失败应为：

```text
expected 'passed' to be 'failed'
```

并且实际报告未观察到 caller B 的 `@check` Runtime error。若失败来自 DSL 编译、fixture 路径、导入或语法错误，标记 `R1_RED_HARNESS_INVALID` 并停止；本任务书不允许为了修测试设施运行第二次正式 RED。

- [ ] **Step 5: 回读 RED artifact**

```powershell
$redArtifact = Join-Path $r1Root 'red-sim-state-vitest.json'
$redItem = Get-Item -LiteralPath $redArtifact
$redHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $redArtifact).Hash
$redJson = Get-Content -Raw -LiteralPath $redArtifact | ConvertFrom-Json
[pscustomobject]@{
  Path = $redItem.FullName
  Bytes = $redItem.Length
  SHA256 = $redHash
  Success = $redJson.success
  Passed = $redJson.numPassedTests
  Failed = $redJson.numFailedTests
} | Format-List
```

把路径、bytes、SHA-256、exit code 和首个失败写入 Ledger。Expected classification：

```text
R1_PERMANENT_REGRESSION_RED = REPRODUCED
PRODUCTION_CODE_CHANGED = NO
```

---

### Task 2: 用同一 SaveSnapshot 构造最小完整状态签名

**Files:**
- Modify: `packages/authoring/src/simulation.ts:85-90`
- Modify: `packages/authoring/src/simulation.ts:235-247`
- Test: `packages/authoring/test/simulation.test.ts`
- Artifact: `<r1Root>/green-sim-state-vitest.json`
- Modify: 本任务书 `Execution Ledger`

**Interfaces:**
- Consumes: Core `SaveSnapshot.position`、`SaveSnapshot.callStack`、`SaveSnapshot.variables`。
- Produces: 私有 `simulationStateSignature(snapshot: SaveSnapshot): string`；修正后的 `seenSignatures` key。

- [ ] **Step 1: 在 clone helper 后加入签名 helper**

紧接 `cloneSnapshot()` 后加入：

```ts
function simulationStateSignature(snapshot: SaveSnapshot): string {
  return JSON.stringify([
    snapshot.position,
    snapshot.callStack ?? [],
    snapshot.variables,
  ]);
}
```

该 helper 保持文件私有，不从 `packages/authoring/src/index.ts` 导出，不新增公共类型。

- [ ] **Step 2: 替换 choice 检查点的一处旧签名**

将：

```ts
const signature = JSON.stringify([base.position, store.snapshot()]);
```

替换为：

```ts
const signature = simulationStateSignature(base);
```

不得修改 `seenSignatures` 的生命周期、`cyclesPruned` 递增、`recordPruned()`、`beginPath()` 或分支恢复顺序。

- [ ] **Step 3: 审阅最小 diff**

```powershell
git diff -- packages/authoring/src/simulation.ts packages/authoring/test/simulation.test.ts
git diff --stat
git diff --check
```

Expected：tracked 代码/测试变化只有上述两个文件；任务书允许另有 Ledger 变化。生产实现不应超过一个私有 helper和一处调用替换。

- [ ] **Step 4: 运行修复后的单测试，最多三次聚焦循环**

第一次运行：

```powershell
npm run test -w @surdet/authoring -- simulation.test.ts -t "distinguishes equal position and variables when call stacks differ" --reporter=json --outputFile="$r1Root\green-sim-state-vitest.json"
$greenExit = $LASTEXITCODE
"GREEN_EXIT=$greenExit"
```

Expected：exit `0`，1 个匹配测试通过。

若失败，只能检查：签名 helper 是否使用 `base`、`callStack` 是否规范化、fixture 是否仍是批准版本。允许在白名单内修正后再次运行同一命令，总计不得超过 3 次；不得切换测试、删断言或改预算。第 3 次仍失败，保留最后输出并停止在 `R1_FOCUSED_BUDGET_EXHAUSTED`。

- [ ] **Step 5: 回读 GREEN artifact**

```powershell
$greenArtifact = Join-Path $r1Root 'green-sim-state-vitest.json'
$greenItem = Get-Item -LiteralPath $greenArtifact
$greenHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $greenArtifact).Hash
$greenJson = Get-Content -Raw -LiteralPath $greenArtifact | ConvertFrom-Json
[pscustomobject]@{
  Path = $greenItem.FullName
  Bytes = $greenItem.Length
  SHA256 = $greenHash
  Success = $greenJson.success
  Passed = $greenJson.numPassedTests
  Failed = $greenJson.numFailedTests
} | Format-List
```

Expected：`success=true`、`numPassedTests=1`、`numFailedTests=0`。记录实际值，不凭终端滚动输出填写。

---

### Task 3: 聚焦验证、下游共享语义与一次全仓门禁

**Files:**
- Read/Test: `packages/authoring/test/simulation.test.ts`
- Read/Test: `packages/cli/test/simulate.test.ts`
- Read-only project path: `examples/starter`
- Artifacts: `<r1Root>/*.txt`
- Modify: 本任务书 `Execution Ledger`

**Interfaces:**
- Consumes: 修正后的 `simulateSnapshot()` 与不变的 `SimulationReport`。
- Produces: authoring 全绿、CLI 下游一致、Starter 真实模拟和最多一次 `verify:all` 结果。

- [ ] **Step 1: 运行 simulation 测试文件**

```powershell
npm run test -w @surdet/authoring -- simulation.test.ts 2>&1 |
  Tee-Object -FilePath "$r1Root\simulation-suite.txt"
$simulationSuiteExit = $LASTEXITCODE
"SIMULATION_SUITE_EXIT=$simulationSuiteExit"
```

Expected：exit `0`。新回归通过；既有循环剪枝、预算、GrowthSystem 和 Timeline 依赖测试全部保持通过。

- [ ] **Step 2: 运行 authoring 全测试**

```powershell
npm run test -w @surdet/authoring 2>&1 |
  Tee-Object -FilePath "$r1Root\authoring-suite.txt"
$authoringTestExit = $LASTEXITCODE
"AUTHORING_TEST_EXIT=$authoringTestExit"
```

Expected：exit `0`。记录实际测试文件数和测试数，不从旧报告抄写。

- [ ] **Step 3: 运行 authoring typecheck 与 build**

```powershell
npm run typecheck -w @surdet/authoring
$authoringTypecheckExit = $LASTEXITCODE
npm run build -w @surdet/authoring
$authoringBuildExit = $LASTEXITCODE
"AUTHORING_TYPECHECK_EXIT=$authoringTypecheckExit"
"AUTHORING_BUILD_EXIT=$authoringBuildExit"
```

Expected：两者 exit `0`。必须先真实完成 authoring build，再运行依赖其 dist 的 CLI 测试，避免读取旧构建。

- [ ] **Step 4: 运行既有 CLI 模拟合同**

```powershell
npm run test -w @surdet/cli -- simulate.test.ts 2>&1 |
  Tee-Object -FilePath "$r1Root\cli-simulate.txt"
$cliTestExit = $LASTEXITCODE
"CLI_SIMULATE_TEST_EXIT=$cliTestExit"
```

Expected：exit `0`。`pathsExplored`、`cyclesPruned` 和 shared report 映射继续一致；不得修改 CLI 文件制造通过。

- [ ] **Step 5: 运行 Starter 真实 headless 模拟**

```powershell
npm run simulate -w surdet-starter 2>&1 |
  Tee-Object -FilePath "$r1Root\starter-simulate.txt"
$starterSimulateExit = $LASTEXITCODE
"STARTER_SIMULATE_EXIT=$starterSimulateExit"
```

Expected：exit `0`，运行时错误为 `0`。记录本轮真实 `pathsExplored`、状态签名剪枝数、choice 覆盖、save/load 次数和可达结局；数字允许因正确签名变严格而变化，不得为了保持旧数字撤销修复。

- [ ] **Step 6: 只运行一次 verify:all**

只有 Step 1～5 全绿时执行：

```powershell
npm run verify:all 2>&1 |
  Tee-Object -FilePath "$r1Root\verify-all.txt"
$verifyAllExit = $LASTEXITCODE
"VERIFY_ALL_EXIT=$verifyAllExit"
```

Expected：exit `0`。

若 exit 非 `0`：记录最后通过节点、第一个失败节点、错误文本和与 R1 的相关性，停止；不得运行第二次 `verify:all`，不得修 R2～R6 或其他历史问题。

- [ ] **Step 7: 回读所有本轮证据身份**

```powershell
Get-ChildItem -LiteralPath $r1Root -File | Sort-Object Name | ForEach-Object {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
  "$($_.FullName)`t$($_.Length)`t$hash"
}
```

记录每个实际存在文件的绝对路径、bytes 和 SHA-256。不得报告不存在的预定文件；失败输出同样保留。

- [ ] **Step 8: 确认仓库范围**

```powershell
git status --short --untracked-files=all
git diff --name-only
git diff --check
git diff --cached --check
git ls-files '*.log'
git diff --quiet -- packages/core packages/cli packages/editor packages/renderer packages/host packages/shell examples
"FORBIDDEN_SCOPE_DIFF_EXIT=$LASTEXITCODE"
```

Expected：禁止范围 diff exit `0`；tracked 修改仅为 authoring 实现、authoring 正式测试和本任务书 Ledger。系统临时证据不得出现在仓库状态中。

---

### Task 4: 创建代码证据提交

**Files:**
- Modify/Stage: `packages/authoring/src/simulation.ts`
- Modify/Stage: `packages/authoring/test/simulation.test.ts`
- Modify/Stage: 本任务书

**Interfaces:**
- Consumes: Task 1 RED、Task 2 GREEN、Task 3 全部验证结果。
- Produces: 一笔普通本地代码证据提交；真实 `CODE_EVIDENCE_HEAD`。

- [ ] **Step 1: 最终审阅代码 diff**

```powershell
git diff -- packages/authoring/src/simulation.ts packages/authoring/test/simulation.test.ts
git diff --stat
git diff --check
```

确认：

```text
signature uses one SaveSnapshot
position included
callStack included and ordered
undefined callStack normalized to []
variables included
no pruning/budget/report contract removed
```

- [ ] **Step 2: 在 Ledger 写入提交前事实**

写入实际命令、exit code、测试计数、Starter 统计、artifact 身份、工作树和未解决问题。不要预填尚未产生的 commit 哈希。

- [ ] **Step 3: 精确暂存三个文件**

```powershell
git add -- packages/authoring/src/simulation.ts packages/authoring/test/simulation.test.ts docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md
git diff --cached --name-status
git diff --cached --check
```

Expected：暂存区只有上述三个文件。若出现其他文件，停止并取消错误路径的暂存，不使用 reset/checkout 清理工作树。

- [ ] **Step 4: 创建普通本地提交**

```powershell
git commit -m "fix(authoring): preserve simulation call stack identity"
```

- [ ] **Step 5: 从 Git 重新读取代码证据身份**

```powershell
git log --oneline -1
$codeEvidenceHead = git rev-parse HEAD
$codeEvidenceParent = git rev-parse HEAD^
git show --name-status --format=fuller HEAD
git status --short --untracked-files=all
"CODE_EVIDENCE_HEAD=$codeEvidenceHead"
"CODE_EVIDENCE_PARENT=$codeEvidenceParent"
```

Expected：提交真实存在，且提交范围只有批准的三个文件。不得从 commit 工具回执或内存填写哈希。

---

### Task 5: 创建交付报告并回读最终文件身份

**Files:**
- Create: `docs/RELIABILITY-R1-SIMULATION-CONTROL-FLOW-IDENTITY-DELIVERY-REPORT-2026-08-20.md`
- Modify: 本任务书 `Execution Ledger`
- Read: Task 1～4 的磁盘证据

**Interfaces:**
- Consumes: RED/GREEN、聚焦测试、Starter、`verify:all`、代码证据提交与 Git 状态。
- Produces: 可独立复审的 R1 交付报告；不包含人工体验或 Wave 4 通过声明。

- [ ] **Step 1: 按固定结构创建报告**

报告正文必须包含：

1. 第一行停止状态；
2. 缺陷与正确性合同；
3. 最小修复说明；
4. RED 与 GREEN 的命令、exit code、首个失败/通过结果；
5. authoring、CLI、Starter、`verify:all` 的真实结果；
6. 每份 artifact 的绝对路径、bytes、SHA-256；
7. `CODE_EVIDENCE_HEAD`、parent、远端与 ahead/behind；
8. 精确提交文件范围；
9. 明确没有修改的模块；
10. 未解决的 R2～R6 与 Wave 4 暂停状态；
11. push、部署、发行均未执行；
12. 下一步为 Architect Review，不是 R2 自动施工。

报告第一行在全部成功时使用：

```text
RELIABILITY_R1_SIMULATION_CONTROL_FLOW_IDENTITY_FIXED — PERMANENT_REGRESSION_PASSED; SHARED_SIMULATION_VERIFIED; WAITING_FOR_ARCHITECT_REVIEW; NOT_PUSHED; WAVE_4_PAUSED
```

若任何验证失败，第一行必须改为真实失败状态，不得保留 `FIXED`。

- [ ] **Step 2: 明确已验证与未验证边界**

报告必须明确写出：

```text
已验证：相同 position/variables、不同 callStack 不再合并；caller A 结局与 caller B Runtime error 均被观察。
已验证：既有 state-signature 循环剪枝与路径预算合同保持。
已验证：CLI/Starter 继续消费共享模拟真相。
未验证：R2～R6；Electron/浏览器；Wave 4 Agent Port；性能与发行。
```

- [ ] **Step 3: 回读报告与任务书身份**

```powershell
$docs = @(
  'docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md',
  'docs/RELIABILITY-R1-SIMULATION-CONTROL-FLOW-IDENTITY-DELIVERY-REPORT-2026-08-20.md'
)
$docs | ForEach-Object {
  $item = Get-Item -LiteralPath $_
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash
  "$_`t$($item.Length)`t$hash"
}
```

把真实 bytes/SHA-256 写入 Ledger。注意：任务书追加 Ledger 后哈希会变化，最终身份只能在最后一次内容修改完成后读取。

- [ ] **Step 4: 核对报告陈述与 Git/磁盘一致**

```powershell
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
git status --short --untracked-files=all
git diff --check
git diff --cached --check
git ls-files '*.log'
```

逐项修正任何与磁盘不一致的哈希、路径、测试数、HEAD 或状态词。只允许修改本任务书和本轮报告；不得为“文档一致”回改生产代码。

---

### Task 6: 文档闭合提交与审核交接

**Files:**
- Modify/Stage: 本任务书
- Create/Stage: `docs/RELIABILITY-R1-SIMULATION-CONTROL-FLOW-IDENTITY-DELIVERY-REPORT-2026-08-20.md`

**Interfaces:**
- Consumes: 真实 code evidence commit 后的 Git 状态与最终文档身份。
- Produces: docs-only closure commit；`WAITING_FOR_ARCHITECT_REVIEW`。

- [ ] **Step 1: 在 Ledger 追加代码提交后的真实基线**

记录：

```text
CODE_EVIDENCE_HEAD
CODE_EVIDENCE_PARENT
surdet/main
ahead/behind
git show --name-status CODE_EVIDENCE_HEAD
tracked worktree after code commit
staging area after code commit
```

不得把即将创建的 docs closure hash 提前写入正文。

- [ ] **Step 2: 精确暂存两份文档**

```powershell
git add -- docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md docs/RELIABILITY-R1-SIMULATION-CONTROL-FLOW-IDENTITY-DELIVERY-REPORT-2026-08-20.md
git diff --cached --name-status
git diff --cached --check
```

Expected：只有两份文档。

- [ ] **Step 3: 创建 docs-only 闭合提交**

```powershell
git commit -m "docs(reliability): report simulation identity fix"
```

- [ ] **Step 4: 立即回读最终 Git 状态**

```powershell
$documentClosureHead = git rev-parse HEAD
git log --oneline -2
git show --name-status --format=fuller HEAD
git status --short --untracked-files=all
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
git diff --check
git diff --cached --check
git ls-files '*.log'
"DOCUMENT_CLOSURE_HEAD=$documentClosureHead"
```

Expected：closure commit 只有任务书和交付报告；tracked 工作树干净、暂存区为空；已知未跟踪治理/受保护文件原样保留；没有 push。

- [ ] **Step 5: 输出审核交接包并停止**

执行 AI 的最终报告必须提供：

```text
TASKBOOK
DELIVERY_REPORT
RED_ARTIFACT path/bytes/SHA-256/result
GREEN_ARTIFACT path/bytes/SHA-256/result
FOCUSED_AND_DOWNSTREAM_TESTS
VERIFY_ALL_RESULT
CODE_EVIDENCE_HEAD/PARENT
DOCUMENT_CLOSURE_HEAD
REMOTE_MAIN
AHEAD_BEHIND
COMMIT_FILE_SCOPES
TRACKED/STAGED STATUS
PUSH = NOT_PERFORMED
WAVE_4 = PAUSED
```

最终成功停止状态：

```text
RELIABILITY_R1_SIMULATION_CONTROL_FLOW_IDENTITY_FIXED
PERMANENT_REGRESSION_PASSED
SHARED_SIMULATION_AND_DOWNSTREAM_VERIFIED
READY_FOR_ARCHITECT_REVIEW
WAITING_FOR_ARCHITECT_REVIEW
NOT_PUSHED
R2_NOT_STARTED
WAVE_4_IMPLEMENTATION_PAUSED
```

审核传递顺序固定为：

```text
执行 AI 完整报告
-> 网页版 GPT Architect Review
-> 小衡 Independent Final Review
-> 项目所有者只把小衡综合报告交给总经理
```

若 Architect 或小衡拒绝、发现 Blocker/High，或两者结论冲突，立即交总经理裁决；执行 AI 不得自行进入 R2。

---

## 五、独立审核清单

Architect 与小衡至少核验：

1. 新测试是否真的构造了相同 `position/variables`、不同 `callStack`；
2. caller A 的 `safe_end` 与 caller B 的 `@check` 错误是否同时可观察；
3. 签名三项是否来自同一 `SaveSnapshot`；
4. 是否规范化 `undefined callStack` 而不改变帧顺序；
5. 是否避免把时间戳、kind 等瞬态字段加入签名；
6. 既有循环剪枝、预算、路径计数和 Runtime 错误合同是否保持；
7. CLI 是否仍只消费共享报告；
8. Starter simulation 是否真实通过，数字是否来自本轮输出；
9. RED/GREEN 与文本 artifact 是否仍在磁盘且哈希一致；
10. 两笔提交范围是否精确；
11. 是否没有修改 Core、CLI、Editor、Shell、Starter 或其他禁止范围；
12. 是否未 push、未进入 R2、未恢复 Wave 4。

任何一项无法从磁盘、Git 或真实输出证明，不得给出最终 PASS。

## 六、Execution Ledger

### 2026-08-20 任务书生成基线

```text
PLANNING_BASE_BRANCH = main
PLANNING_BASE_HEAD = 0052927df0ceb30941cb8b17af479623f23204bc
PLANNING_BASE_PARENT = 6c55d6c68a1235bf5d5d8f7b4cc07d2dd66e43be
LOCAL_TRACKING_SURDET_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
AHEAD_BEHIND = 5 0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
FRESH_GATE = APPROVED_BY_GENERAL_MANAGER
R1_TASKBOOK_AUTHORING = AUTHORIZED
R1_EXECUTION = NOT_AUTHORIZED_AT_TASKBOOK_CREATION
R2_TO_R6 = NOT_STARTED
WAVE_4_IMPLEMENTATION = PAUSED
PUSH = NOT_AUTHORIZED
```

任务书生成时，仓库仅保留既有未跟踪治理、handoff、`.dsh`、`.learnings` 和受保护文件；本轮任务书作者没有修改生产源码、测试、长期路线台账或 Git 历史。

当前停止状态：

```text
RELIABILITY_R1_SIMULATION_CONTROL_FLOW_IDENTITY_TASKBOOK_COMPLETED
WAITING_FOR_OWNER_EXECUTION_AUTHORIZATION
NO_PRODUCTION_CODE_CHANGED_BY_TASKBOOK_AUTHORING
R2_NOT_STARTED
WAVE_4_IMPLEMENTATION_PAUSED
NOT_PUSHED
```

### 2026-08-20 Task 0 执行基线

```text
R1_TASK_0 = PASSED
AUTHORITY_INPUTS = AGENTS + ROADMAP + FRESH_GATE_REPORT + R1_TASKBOOK + TARGET_SOURCE/TEST READ
EXECUTION_AUTHORIZATION = OWNER_APPROVED_R1
PLANNING_BASE_BRANCH = main
GATE_BASE_HEAD = 0052927df0ceb30941cb8b17af479623f23204bc
GATE_BASE_PARENT = 6c55d6c68a1235bf5d5d8f7b4cc07d2dd66e43be
LOCAL_TRACKING_SURDET_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
AHEAD_BEHIND = 5 0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
TRACKED_LOGS = NONE
R1_PRODUCTION_FIX = NOT_STARTED_AT_BASELINE
R1_ALREADY_CHANGED = NO
R1_IMPLEMENTATION = AUTHORIZED_BY_TASKBOOK_ONLY_AFTER_RED
R2_TO_R6 = NOT_STARTED
WAVE_4_IMPLEMENTATION = PAUSED
PUSH = NOT_AUTHORIZED
R1_ROOT = <local-path>
```

Task 0 的 `git status --short --untracked-files=all` 仅显示既有治理、handoff、受保护文件、长期路线台账、本轮任务书及 `.dsh/.learnings` 下的未跟踪内容；没有新的 tracked 源码、正式测试或暂存变化。全部既有未跟踪内容原样保留，未被整理、删除、暂存或提交。

被测文件身份（Task 0 从磁盘回读）：

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `packages/authoring/src/simulation.ts` | 11958 | `ABD8ADA43A1B5682A4B88F2F8311306AF96890911C026881858586A71611AC26` |
| `packages/authoring/test/simulation.test.ts` | 10328 | `AC5FFC626E99A6CA8EACF4D19BC504391AF19180491B888EE58989207D0CD612` |
| `packages/core/src/save/save-manager.ts` | 20024 | `4303EA5CFFB8109B9E85C37786DCC94853019B9B4C35F9EF13BC0DD91820CDF3` |
| `packages/core/src/runtime/interpreter.ts` | 46567 | `EC5FDABCE9A74B5C543A55F43DA633AB58B671B373A4E3BD98CEF7377F0F9679` |

源码核对确认 `packages/authoring/src/simulation.ts` 当前仍使用：

```ts
const signature = JSON.stringify([base.position, store.snapshot()]);
```

当前停止点：Task 0 已通过；下一步只允许在正式测试白名单内创建永久回归并执行一次 RED。生产修复仍未开始，R2～R6、Wave 4 和 push 均保持禁止。

### 2026-08-20 Task 1 正式回归 RED

```text
R1_TASK_1 = COMPLETED
RED_COMMAND = npm run test -w @surdet/authoring -- simulation.test.ts -t "distinguishes equal position and variables when call stacks differ" --reporter=json --outputFile="$r1Root\red-sim-state-vitest.json"
RED_EXIT = 1
RED_EXPECTED_CONTRACT = 相同 position/variables 但不同 callStack 的 caller 路径不得合并；caller B 的真实 @check 错误必须使 report.status=failed
RED_ACTUAL_FIRST_FAILURE = AssertionError: expected 'passed' to be 'failed' // Object.is equality
RED_ARTIFACT = <local-path>
RED_ARTIFACT_BYTES = 4014
RED_ARTIFACT_SHA256 = 5630CE4A708A1EDC8C9932C444265678D47E5E0E3B93F468228D4F84E4C8F668
RED_ARTIFACT_SUCCESS = false
RED_ARTIFACT_PASSED = 0
RED_ARTIFACT_FAILED = 1
RED_CLASSIFICATION = R1_PERMANENT_REGRESSION_RED_REPRODUCED
RED_HARNESS_INVALID = NO
PRODUCTION_CODE_CHANGED = NO
```

Task 1 只在 `packages/authoring/test/simulation.test.ts` 新增批准的 callStack fixture 与一个永久回归测试；测试 diff 与 `git diff --check` 已通过。没有创建第二个临时测试文件，也没有修改生产实现。首个失败已经精确命中当前 Fresh Gate 的状态签名症状，按任务书进入 Task 2。

### 2026-08-20 Task 2 最小完整状态签名修复与 GREEN

```text
R1_TASK_2 = COMPLETED
IMPLEMENTATION_FILE = packages/authoring/src/simulation.ts
IMPLEMENTATION_CHANGE = 私有 simulationStateSignature(snapshot: SaveSnapshot)；choice 检查点改用该 helper
SIGNATURE_CONTRACT = JSON.stringify([snapshot.position, snapshot.callStack ?? [], snapshot.variables])
SINGLE_SNAPSHOT_SOURCE = YES
POSITION_INCLUDED = YES
CALLSTACK_INCLUDED = YES
UNDEFINED_CALLSTACK_NORMALIZED_TO_EMPTY_ARRAY = YES
VARIABLES_INCLUDED = YES
METADATA_INCLUDED = NO
SEEN_SIGNATURE_LIFECYCLE_CHANGED = NO
PRUNING_OR_BUDGET_CONTRACT_CHANGED = NO
GREEN_COMMAND = npm run test -w @surdet/authoring -- simulation.test.ts -t "distinguishes equal position and variables when call stacks differ" --reporter=json --outputFile="$r1Root\green-sim-state-vitest.json"
GREEN_RUN_COUNT = 1
GREEN_EXIT = 0
GREEN_ARTIFACT = <local-path>
GREEN_ARTIFACT_BYTES = 3711
GREEN_ARTIFACT_SHA256 = 75257E0B9A4CAF8FE855044072B64AE316E13859BD1175242A1ECAF1F0EEC6D0
GREEN_ARTIFACT_SUCCESS = true
GREEN_ARTIFACT_PASSED = 1
GREEN_ARTIFACT_FAILED = 0
GREEN_ARTIFACT_TOTAL = 11
GREEN_CLASSIFICATION = PERMANENT_REGRESSION_GREEN
```

Task 2 diff 仅涉及批准的 `packages/authoring/src/simulation.ts` 与 `packages/authoring/test/simulation.test.ts`，`git diff --check` 通过。没有关闭 `seenSignatures`、放宽预算、删除断言或修改 Core `SaveSnapshot` schema。

### 2026-08-20 Task 3 聚焦、下游与 verify:all 验证

```text
R1_TASK_3 = COMPLETED_WITH_VERIFY_ALL_FAILURE
SIMULATION_SUITE_COMMAND = npm run test -w @surdet/authoring -- simulation.test.ts
SIMULATION_SUITE_EXIT = 0
SIMULATION_SUITE_RESULT = 1 file / 11 tests passed
AUTHORING_SUITE_COMMAND = npm run test -w @surdet/authoring
AUTHORING_SUITE_EXIT = 0
AUTHORING_SUITE_RESULT = 20 files / 122 tests passed
AUTHORING_TYPECHECK_EXIT = 0
AUTHORING_BUILD_EXIT = 0
CLI_SIMULATE_COMMAND = npm run test -w @surdet/cli -- simulate.test.ts
CLI_SIMULATE_EXIT = 0
CLI_SIMULATE_RESULT = 1 file / 13 tests passed
STARTER_SIMULATE_COMMAND = npm run simulate -w surdet-starter
STARTER_SIMULATE_EXIT = 0
STARTER_PATHS_EXPLORED = 13
STARTER_CYCLES_PRUNED = 7
STARTER_CHOICE_COVERAGE = 2/3
STARTER_SAVE_LOAD_ROUNDTRIPS = 25
STARTER_ENDINGS = demo_end (12 times)
STARTER_RUNTIME_ERRORS = 0
VERIFY_ALL_COMMAND = npm run verify:all
VERIFY_ALL_RUN_COUNT = 1
VERIFY_ALL_LAST_PASSED_NODE = verify:hygiene
VERIFY_ALL_FIRST_FAILED_NODE = verify:types
VERIFY_ALL_ERROR = packages/shell/test/save-store-slot-collision.test.ts(183,12): error TS2532: Object is possibly 'undefined'.
VERIFY_ALL_CHILD_EXIT = 2
VERIFY_ALL_OUTER_EXIT = NOT_CAPTURED_BEFORE_30S_EXECUTION_WINDOW_ENDED
VERIFY_ALL_RESULT = FAILED_AT_UNMODIFIED_SHELL_TYPECHECK
VERIFY_ALL_R1_RELEVANCE = OUT_OF_SCOPE_PRE_EXISTING_UNMODIFIED_SHELL_TEST
VERIFY_ALL_RERUN = NO
VERIFICATION_STOPPED_AFTER_VERIFY_ALL_FAILURE = YES
FORBIDDEN_SCOPE_DIFF_EXIT = 0
```

`verify:all` 只运行一次；输出在 `verify:types` 的 unmodified Shell test 类型错误处停止。没有修复该错误，没有运行第二次 `verify:all`，也没有进入 R2～R6 或 Wave 4。该失败与本轮 R1 两个白名单文件无关；R1 自身的聚焦、Authoring、CLI 和 Starter 证据均已通过。

Task 3 证据文件（均从本轮唯一 `R1_ROOT` 目录回读）：

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `<local-path>` | 4014 | `5630CE4A708A1EDC8C9932C444265678D47E5E0E3B93F468228D4F84E4C8F668` |
| `<local-path>` | 3711 | `75257E0B9A4CAF8FE855044072B64AE316E13859BD1175242A1ECAF1F0EEC6D0` |
| `<local-path>` | 567 | `A8F9991BFB024FDD67C3ED36546DE11796F882B3823B45102EC769AB709D9822` |
| `<local-path>` | 1502 | `A2C18EDC90BB9F7964C006810681C1562F27217DB9FF0BC41AB62E017F4655C0` |
| `<local-path>` | 569 | `4609073CEA800523931FED4D2E871C3035F63514478C12A16AC8878D5A334525` |
| `<local-path>` | 354 | `B18180406E82D3D45EF8F7E0FC9A3008E9A14BFD5A6D7DFF9AF969D3BAB2477C` |
| `<local-path>` | 7170 | `54173314C526242ED81BEEA5897DA189FA6DBDA3E8A59A111C16ED967820D041` |

Task 3 范围核对：unstaged tracked 修改仅为 `packages/authoring/src/simulation.ts`、`packages/authoring/test/simulation.test.ts`；`git diff --quiet -- packages/core packages/cli packages/editor packages/renderer packages/host packages/shell examples` 返回 0；无 tracked log。系统临时目录未出现在仓库状态中。

### 2026-08-20 Task 4 环境权限阻断

```text
R1_TASK_4 = BLOCKED_BY_GIT_WRITE_PERMISSION
STAGE_COMMAND = git add -- packages/authoring/src/simulation.ts packages/authoring/test/simulation.test.ts docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md
STAGE_EXIT = 128
STAGE_ERROR = fatal: Unable to create 'E:/surdet/.git/index.lock': Permission denied
INDEX_LOCK_EXISTS_AT_CHECK = FALSE
GIT_INDEX_EXISTS_AT_CHECK = TRUE
GIT_DIR_WRITE_PERMISSION = DENIED_TO_CURRENT_EXECUTION_ENVIRONMENT
STAGED_FILES_AFTER_FAILURE = NONE
CODE_EVIDENCE_COMMIT = NOT_CREATED
TASK_5_REPORT = NOT_STARTED
TASK_6_DOCUMENT_CLOSURE = NOT_STARTED
PUSH = NOT_PERFORMED
```

该阻断不是 stale lock；只读 ACL 回读显示当前执行环境不能写入 `.git` 目录或 index。不得删除 lock、修改 ACL、使用 reset/checkout、绕过 Git 或虚构 commit。当前 R1 源码与正式测试改动保留在工作树，等待具备 Git 写权限的执行环境恢复后，从 Task 4 精确暂存继续。

### 2026-08-20 R1 Task 4 恢复、独立 Shell 门清理与 verify:all recovery

```text
R1_RECOVERY_ENVIRONMENT = GIT_METADATA_WRITE_ENABLED
R1_RECOVERY_SCOPE = TASK_4_RESTORE_THEN_TASK_5_6_ONLY
R1_CODE_EVIDENCE_HEAD = dc9c7cd3037e5eb4cef10b93804505bf8e864ef3
R1_CODE_EVIDENCE_PARENT = 0052927df0ceb30941cb8b17af479623f23204bc
R1_CODE_EVIDENCE_COMMIT = fix(authoring): preserve simulation call stack identity
R1_CODE_EVIDENCE_SCOPE = A docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md; M packages/authoring/src/simulation.ts; M packages/authoring/test/simulation.test.ts
R1_CODE_EVIDENCE_STAGE = EXACT_APPROVED_SCOPE
R1_CODE_EVIDENCE_WORKTREE_AFTER_COMMIT = TRACKED_CLEAN
R1_CODE_EVIDENCE_STAGING_AFTER_COMMIT = EMPTY

SHELL_GATE_CLEANUP_HEAD = 54e2d73ba7008a9559e50b9aacafac2bae66a350
SHELL_GATE_CLEANUP_PARENT = dc9c7cd3037e5eb4cef10b93804505bf8e864ef3
SHELL_GATE_CLEANUP_COMMIT = test(shell): satisfy slot collision type safety
SHELL_GATE_CLEANUP_SCOPE = M packages/shell/test/save-store-slot-collision.test.ts
SHELL_GATE_CLEANUP_PRODUCTION_CODE_CHANGED = NO
SHELL_TYPECHECK_AFTER_FIX_EXIT = 0
SHELL_TESTS_AFTER_FIX_EXIT = 0
SHELL_TESTS_AFTER_FIX_RESULT = 22 files / 195 tests passed
SHELL_GATE_CLEANUP_WORKTREE_AFTER_COMMIT = TRACKED_CLEAN
SHELL_GATE_CLEANUP_STAGING_AFTER_COMMIT = EMPTY
```

恢复提交前对目标测试的精确变化为：`expect(metas[0].updatedAt).toBe(9);` 改为 `expect(metas[0]?.updatedAt).toBe(9);`。没有重跑 R1 RED/GREEN、Authoring、CLI 或 Starter；恢复阶段只执行了批准的 Shell typecheck、Shell full tests 和一次新的 `verify:all`。

首次 `verify:all` 的失败 artifact 保留为 `verify-all.txt`，没有覆盖。它在 `verify:types` 首次命中未修改的 `packages/shell/test/save-store-slot-collision.test.ts(183,12): error TS2532: Object is possibly 'undefined'.`；child exit 为 2，外层 exit 在 30 秒执行窗口结束前未捕获。该失败与 R1 两个生产/正式回归文件无关。

恢复后的 `verify:all` 只执行一次，写入新的 `verify-all-after-shell-type-fix.txt`，执行回执为 `VERIFY_ALL_RECOVERY_EXIT=0`。tools 10/10、renderer boundaries 3/3、renderer legacy 4/4、hygiene 730 paths、全部 workspace typecheck、Authoring 20/122、CLI 14/129、Core 24/318、Editor 26/172、Host 11/87、Renderer 49/406、Shell 22/195、Starter 4/7、Zero 4/29、Starter lint 0 errors/4 warnings、Starter simulate 13 paths/7 cycles/25 save-load/0 runtime errors、Zero simulate 259 paths/9 cycles/23/23 choices/367 save-load/0 runtime errors、editor/starter/formal build 以及最后 diff-check 均通过。

恢复阶段唯一 R1 证据根目录仍为：

`<local-path>`

恢复阶段新增 artifact 身份：

| 文件 | bytes | SHA-256 | 结果 |
|---|---:|---|---|
| `<local-path>` | 70 | `C857562C23D33A2D3D9B7269D2DC4EDEFC7483B65EF7903E3C06E4934CC9FA13` | PASS; exit 0 |
| `<local-path>` | 2966 | `16C260CBFF8704E528163B1D60CF923B270D13A3A9D427F62F7F132ACA62D76A` | PASS; 22 files / 195 tests |
| `<local-path>` | 56272 | `D6D1C04009A891EC5E16346C103EDD9C8A890B4C41CE83B4EA49BD44E2891D71` | PASS; recovery exit 0 |
```

恢复后真实 Git 基线：

```text
HEAD = 54e2d73ba7008a9559e50b9aacafac2bae66a350
HEAD_PARENT = dc9c7cd3037e5eb4cef10b93804505bf8e864ef3
REMOTE_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
RAW_REV_LIST_LEFT_RIGHT = 0 7
TRACKED_WORKTREE = CLEAN
STAGED_WORKTREE = EMPTY
KNOWN_UNTRACKED_GOVERNANCE_AND_PROTECTED_FILES = PRESERVED_UNTOUCHED
PUSH = NOT_PERFORMED
R2_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
```

### 2026-08-20 Task 5 交付报告

```text
R1_TASK_5 = COMPLETED
DELIVERY_REPORT = docs/RELIABILITY-R1-SIMULATION-CONTROL-FLOW-IDENTITY-DELIVERY-REPORT-2026-08-20.md
DELIVERY_REPORT_BYTES = 9727
DELIVERY_REPORT_SHA256 = 3D9B12C2F1ECEA55FCCD9FBD8212F678291E2DD12F8583E8E75569188750B4C6
DELIVERY_REPORT_FIRST_LINE = RELIABILITY_R1_SIMULATION_CONTROL_FLOW_IDENTITY_FIXED — PERMANENT_REGRESSION_PASSED; SHARED_SIMULATION_VERIFIED; WAITING_FOR_ARCHITECT_REVIEW; NOT_PUSHED; WAVE_4_PAUSED
DELIVERY_REPORT_SCOPE = R1 evidence, recovery gate, exact artifact identities, negative scope and Architect handoff only
DELIVERY_REPORT_RE_READ = YES
```

Task 5 报告已回读并与磁盘 artifact、代码证据提交、Shell 独立测试提交及恢复 `verify:all` 结果核对一致。Task 6 只允许精确暂存本任务书与交付报告，创建 docs-only closure commit 后立即回读最终 HEAD；不得在此后运行额外测试或进入下一可靠性主题。
