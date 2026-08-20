# Reliability R2 Post-Replacement Commit Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `commitChange()` 在项目内容已经全部替换并校验成功后，因 stage 清理失败而抛错并让事务保持 `OPEN` 的错误合同，使磁盘事实、API 结果、事务记录和 journal 状态重新一致。

**Architecture:** 唯一内容 commit point 定义为“全部目标文件替换完成且逐文件 SHA-256 回读匹配”。跨过 commit point 后，先把 journal 与 ChangeRecord 持久化为 `COMMITTED`，再逐项 best-effort 清理 stage；清理失败不得逆转内容提交结果，已提交 journal 继续保留 staged identity 作为取证线索。修复只落在共享 `@surdet/authoring`，CLI、Editor 和未来 Agent Port 继续消费同一 `commitChange()` 返回合同。

**Tech Stack:** TypeScript 5.7、Vitest 3、`@surdet/authoring`、`ProjectWriteStorage`、`ChangeRepository`、Node.js ≥ 20、npm workspaces、PowerShell 7。

## Global Constraints

- 本轮唯一主题是 `R2 / TX-COMMIT-POSTREPLACE`；不得顺手处理 R3～R6、Wave 4、M2、N9、音频、性能、发行或文档大整理。
- 生产修改白名单只有 `packages/authoring/src/change-session.ts`；正式测试修改白名单只有 `packages/authoring/test/commit-recovery.test.ts`。
- 不得修改 Core、CLI、Editor、Renderer、Host、Shell、Starter、Zero 或游戏内容；CLI 只运行既有下游测试，不修改实现或合同测试。
- 不得修改 `ChangeStatus`、`ChangeRecord`、`ChangeRepository`、`ProjectWriteStorage`、`commitChange()` 的公开返回类型或现有错误码。
- 不得引入新的 transaction 状态、cleanup warning 公共字段、依赖、配置开关、migration、后台任务或第二套事务管理器。
- 内容 commit point 固定为：所有 `replaceFromStage()` 成功，且每个目标文件经 `readText()` 回读后的 SHA-256 等于对应 `targetSha256`。
- commit point 之前的 replacement 失败继续使用现有恢复算法：完全恢复成功时事务保持 `OPEN`；恢复失败时事务标记 `STALE`。
- commit point 之后必须先持久化 `journal.status='COMMITTED'` 和 `ChangeRecord.status='COMMITTED'`，随后才可执行 stage 清理。
- commit point 之后的 `removeStage()` 是 best-effort housekeeping：每个 staged identity 都必须独立尝试；一个清理失败不得阻止后续清理，也不得让 `commitChange()` 抛错。
- committed journal 中已有的 staged identity 就是清理失败后的取证线索；本轮不新增 journal schema、公开警告接口或自动重试树。
- 不得简单吞掉 replacement、目标哈希不匹配、journal commit 持久化或 ChangeRecord commit 持久化错误；只有已经跨过 commit point 且事务持久化为 `COMMITTED` 后的 `removeStage()` 错误属于本轮 best-effort 边界。
- 不得通过把事务预先标记 `COMMITTED`、删除故障注入、减少 changed paths、放宽哈希校验或让测试不再观察磁盘状态来制造绿灯。
- Fresh Gate 失败 artifact 必须只读保留；本轮新建独立 R2 红/绿证据目录，不覆盖 R1、Fresh Gate 或其他历史证据。
- 正式 RED 只运行一次；修复后的单测试聚焦循环最多 3 次。authoring 全测试、typecheck、build、CLI Node storage 聚焦测试和 `verify:all` 各最多正式运行一次。
- `verify:all` 只在所有聚焦与下游验证通过后运行一次；若失败，记录第一个失败节点并停止，不循环重跑、不扩大范围。
- 不运行 Starter simulation、Electron、浏览器、FORMAL/DIAGNOSTIC 聚合、性能矩阵、pack、部署或发行；这些与本次内部事务尾部合同不匹配。
- 只使用精确路径暂存；禁止 `git add -A`、`git add .`、reset、checkout、clean、stash、amend、rebase、force push。
- 只创建普通本地提交；不得 push。R3～R6 与 Wave 4 在总经理重新授权前保持未开始/暂停。
- 长期路线台账、AGENTS、handoff、`.dsh`、`.learnings` 和受保护文件均不得修改、暂存、提交、删除或移动。
- 网页 Architect 当前由项目所有者明确暂停；不得虚构 `ARCHITECT_PASS`。执行完成后直接交小衡做 Local Audit + Independent Final Review，再由项目所有者把综合结论交总经理。
- 质量优先；在质量不受影响时，额度与验证成本是第二优先级。不得重复已经取得且未失效的证据。

---

## 一、权威依据与当前基线

执行前按顺序完整读取：

1. `AGENTS.md`
2. `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`
3. `docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md`
4. `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md`
5. `docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md`
6. `docs/RELIABILITY-R1-SIMULATION-CONTROL-FLOW-IDENTITY-DELIVERY-REPORT-2026-08-20.md`
7. 本任务书

Fresh Gate 已确认：

```text
TX_COMMIT_POSTREPLACE_REPRODUCED
observedTriple = { threw: true, projectChanged: true, status: 'OPEN' }
fault = removeStage() throws after all replacements already changed project contents
productionFix = NOT_STARTED
```

R1 已独立复审、push 并与远端同步。R2 不重跑 Fresh Gate，也不重新验证 R1。

## 二、事务正确性合同

### 2.1 三阶段边界

`commitChange()` 分为三个不同语义阶段：

```text
PRE_COMMIT
  staging、基线冲突检查、replacement 尚未全部完成

CONTENT_COMMIT_POINT
  所有目标文件 replacement 完成
  AND 每个目标 SHA-256 回读匹配

POST_COMMIT_HOUSEKEEPING
  清理 staged identity / 临时文件 / 临时目录
```

阶段结果必须满足：

| 失败位置 | 磁盘事实 | ChangeRecord | API 结果 |
|---|---|---|---|
| staging 失败 | 项目未改变 | `OPEN` | `COMMIT_FAILED_RECOVERED` |
| replacement 失败且恢复成功 | 恢复到原项目 | `OPEN` | `COMMIT_FAILED_RECOVERED` |
| replacement 失败且恢复失败 | 项目状态不可信 | `STALE` | `COMMIT_RECOVERY_FAILED` |
| 全部 replacement + SHA 回读成功 | 新项目已提交 | `COMMITTED` | 返回 `{ status:'COMMITTED' }` |
| 上一行之后的 stage cleanup 失败 | 新项目仍已提交 | `COMMITTED` | 仍返回 `{ status:'COMMITTED' }` |

禁止再次出现：

```text
projectChanged = true
threw = true due only to post-commit removeStage
change.record.status = OPEN
```

### 2.2 持久化顺序

全部文件替换并回读验证完成后，顺序固定为：

```text
1. journal.status = COMMITTED
2. repository.writeJournal(COMMITTED journal)
3. next.status = COMMITTED
4. repository.write(COMMITTED ChangeRecord)
5. Object.assign(change.record, next)
6. 对每个 staged identity 独立执行 best-effort removeStage
7. 返回 COMMITTED result
```

该顺序保证 cleanup 开始前，公共事务状态已经与磁盘事实一致。

### 2.3 本轮不解决的相邻问题

- `repository.writeJournal()` 或 `repository.write()` 自身在 commit point 后失败的耐久化协议，不在当前 Fresh Gate 证据范围内；不得顺手发明 WAL 重放器。
- Windows `rename/copyFile` 替换原子性属于 R3，R2 不修改 `NodeProjectStorage`。
- stage 垃圾的跨进程扫描、后台清理和公开 warning API 不在本轮实现；journal 已保留 staged identity。
- CLI/Editor 的 UI 文案与错误映射不变，因为 `commitChange()` 的公开成功/失败类型不变。

## 三、文件结构与所有权

| 文件 | 本轮责任 | 允许变化 |
|---|---|---|
| `packages/authoring/src/change-session.ts` | 共享 commit point 与 post-commit cleanup 顺序 | 移动 COMMITTED 持久化；把最终 cleanup 改为逐项 best-effort |
| `packages/authoring/test/commit-recovery.test.ts` | 正式事务故障注入回归 | 扩展 fixture；新增一个 post-replacement cleanup 测试 |
| `docs/superpowers/plans/2026-08-20-reliability-r2-post-replacement-commit-contract.md` | 执行步骤与 Ledger | 只追加真实事实，不改写批准合同 |
| `docs/RELIABILITY-R2-POST-REPLACEMENT-COMMIT-CONTRACT-DELIVERY-REPORT-2026-08-20.md` | 最终交付报告 | 验证完成后创建 |

明确不创建：

- 新 transaction 模块；
- 新 ChangeStatus；
- CLI/Editor adapter；
- cleanup retry service；
- migration、feature flag 或 journal reader；
- 仓库内 artifact、日志或临时 fixture。

## 四、验证预算

| 验证 | 正式预算 | 失败时动作 |
|---|---:|---|
| 永久回归 RED | 1 次 | 未命中 `changed + threw + OPEN` 则停止复审测试设计 |
| 永久回归 GREEN | 最多 3 次 | 只修白名单实现；第 3 次仍失败即停止 |
| `commit-recovery.test.ts` | 1 次 | 报告首个相邻事务回归 |
| authoring 全测试 | 1 次 | 报告首个相关失败 |
| authoring typecheck/build | 各 1 次 | 只处理白名单直接问题 |
| CLI `node-project-storage.test.ts` | 1 次 | 验证共享 commit 与真实 Node storage 合同 |
| `verify:all` | 1 次 | 记录第一个失败节点并停止 |

唯一证据目录：

```text
%TEMP%\surdet-r2-postreplace-<unique-id>\
```

建议文件名：

```text
red-postreplace-vitest.json
green-postreplace-vitest.json
commit-recovery-suite.txt
authoring-suite.txt
authoring-typecheck.txt
authoring-build.txt
cli-node-storage.txt
verify-all.txt
```

---

### Task 0: 权威基线、源码身份与 R2 证据目录

**Files:**
- Read: 七份权威文件
- Read: `packages/authoring/src/change-session.ts:182-315`
- Read: `packages/authoring/test/commit-recovery.test.ts`
- Read: `packages/authoring/src/contracts.ts:53-85`
- Modify: 本任务书 `Execution Ledger`

**Interfaces:**
- Consumes: 已批准 Fresh Gate、已 push 的 R1 基线、当前 commit/recovery 实现。
- Produces: `R2_TASK_0=PASSED` 或精确阻断；唯一 `$r2Root`。

- [ ] **Step 1: 完整读取权威文件**

确认：R1 已闭合并 push；R2 是当前唯一授权主题；Fresh Gate 的精确三联态仍为 `changed + threw + OPEN`；R3/Wave 4 未授权。

- [ ] **Step 2: 记录新鲜 Git 基线**

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
HEAD = d423927a1c7e02c49d3fedd463d8afb2f0ea9719
surdet/main = d423927a1c7e02c49d3fedd463d8afb2f0ea9719
ahead/behind = 0 0
tracked worktree = clean
staging area = empty
```

执行时必须写入新鲜值。允许本任务书以及既有未跟踪治理/受保护文件；若出现额外 tracked 修改、暂存内容或新的未解释提交，停止，不整理他人工作。

- [ ] **Step 3: 回读被测源码身份**

```powershell
$sourceFiles = @(
  'packages/authoring/src/change-session.ts',
  'packages/authoring/test/commit-recovery.test.ts',
  'packages/authoring/src/contracts.ts',
  'packages/cli/src/authoring/node-project-storage.ts'
)
$sourceFiles | ForEach-Object {
  $item = Get-Item -LiteralPath $_
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash
  "$_`t$($item.Length)`t$hash"
}
```

确认当前 `commitChange()` 尾部仍等价于：

```ts
for (const entry of journal.files) await storage.removeStage(entry.stagedIdentity);
journal.status = 'COMMITTED';
await change.repository.writeJournal(change.record.changeId, journal);
const next = clone(change.record);
next.status = 'COMMITTED';
await change.repository.write(next);
Object.assign(change.record, next);
```

若 COMMITTED 持久化已经位于 cleanup 之前，停止并报告 `R2_ALREADY_CHANGED_REQUIRES_REBASE_REVIEW`。

- [ ] **Step 4: 创建唯一证据目录**

```powershell
$runId = [guid]::NewGuid().ToString('N')
$r2Root = Join-Path $env:TEMP "surdet-r2-postreplace-$runId"
New-Item -ItemType Directory -Path $r2Root | Out-Null
Get-Item -LiteralPath $r2Root | Select-Object FullName,CreationTimeUtc
```

将绝对路径写入 Ledger；不得复用 Fresh Gate 或 R1 目录。

- [ ] **Step 5: 写入 Task 0 Ledger**

记录时间、HEAD/remote、ahead/behind、工作树、已知 untracked、源码 bytes/SHA-256、证据目录、授权和停止点。

```text
R2_TASK_0 = PASSED
R2_IMPLEMENTATION = AUTHORIZED_ONLY_AFTER_VALID_RED
ARCHITECT_REVIEW = WAIVED_BY_OWNER
R3_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_AUTHORIZED
```

---

### Task 1: 把 post-replacement cleanup 三联态升级为正式回归

**Files:**
- Modify: `packages/authoring/test/commit-recovery.test.ts`
- Artifact: `<r2Root>/red-postreplace-vitest.json`
- Modify: 本任务书 `Execution Ledger`

**Interfaces:**
- Consumes: `FaultyWriteStorage`、`beginFixture()`、`InMemoryChangeRepository`、`commitChange()`。
- Produces: 永久测试 `commits after verified replacements even when staged cleanup fails`；新鲜 RED。

- [ ] **Step 1: 允许 fixture 注入指定 repository**

将当前：

```ts
async function beginFixture(storage: FaultyWriteStorage) {
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const change = await beginChange(snapshot, new InMemoryChangeRepository(), storage);
```

精确改为：

```ts
async function beginFixture(
  storage: FaultyWriteStorage,
  repository: InMemoryChangeRepository = new InMemoryChangeRepository(),
) {
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const change = await beginChange(snapshot, repository, storage);
```

函数其余部分保持原样；既有两个测试继续使用默认 repository。

- [ ] **Step 2: 新增 post-commit cleanup 故障存储**

在 `FaultyWriteStorage` 后加入：

```ts
class PostReplaceCleanupFaultStorage extends FaultyWriteStorage {
  readonly removeStageCalls: string[] = [];

  constructor(files: Record<string, string>) {
    super(files, Number.POSITIVE_INFINITY, false);
  }

  override async removeStage(stagedIdentity: string): Promise<void> {
    this.removeStageCalls.push(stagedIdentity);
    if (this.removeStageCalls.length === 1) {
      throw new Error('injected post-replacement cleanup failure');
    }
    await super.removeStage(stagedIdentity);
  }
}
```

该 storage 允许所有 replacement 成功，只在第一次最终 `removeStage()` 失败；第二个 identity 必须仍被尝试清理。

- [ ] **Step 3: 新增永久正确性测试**

在 `describe('atomic commit recovery', ...)` 末尾加入：

```ts
it('commits after verified replacements even when staged cleanup fails', async () => {
  const storage = new PostReplaceCleanupFaultStorage({
    'game.config.json': '{"entryScene":"prologue","variables":{}}',
    'content/scenario/prologue.gal': '@scene prologue\n凛：开场。\n@end\n',
  });
  const repository = new InMemoryChangeRepository();
  const change = await beginFixture(storage, repository);

  const committed = await commitChange(change, storage);

  expect(committed).toEqual({
    changeId: change.record.changeId,
    status: 'COMMITTED',
    files: ['content/scenario/branch_a.gal', 'game.config.json'],
  });
  expect(storage.files['content/scenario/branch_a.gal']).toContain('@scene branch_a');
  expect(storage.files['game.config.json']).toContain('"trust"');
  expect(storage.removeStageCalls).toHaveLength(2);
  expect(storage.staged.size).toBe(1);
  expect(change.record.status).toBe('COMMITTED');
  expect((await repository.read(change.record.changeId))?.status).toBe('COMMITTED');
  expect(repository.journals.get(change.record.changeId)).toMatchObject({ status: 'COMMITTED' });
});
```

断言含义：内容确实改变；第一次 cleanup 确实失败并留下一个 stage；第二个 cleanup 仍被调用；API、内存 record、repository record 和 journal 必须全部为 `COMMITTED`。

- [ ] **Step 4: 审阅测试-only diff**

```powershell
git diff -- packages/authoring/test/commit-recovery.test.ts
git diff --check -- packages/authoring/test/commit-recovery.test.ts
```

Expected：只扩展 fixture 并新增一个测试；既有恢复测试与断言未删除或放宽。

- [ ] **Step 5: 正式运行一次 RED**

```powershell
npm run test -w @surdet/authoring -- commit-recovery.test.ts -t "commits after verified replacements even when staged cleanup fails" --reporter=json --outputFile="$r2Root\red-postreplace-vitest.json"
$redExit = $LASTEXITCODE
"R2_RED_EXIT=$redExit"
```

Expected：exit `1`；首个失败来自：

```text
Error: injected post-replacement cleanup failure
```

并且故障发生时磁盘已改变、`change.record.status='OPEN'`。若失败来自 TypeScript、fixture、导入、changed path 数量或 replacement 注入，标记 `R2_RED_HARNESS_INVALID` 并停止；不得用第二次正式 RED 修测试设施。

- [ ] **Step 6: 回读 RED artifact**

```powershell
$redArtifact = Join-Path $r2Root 'red-postreplace-vitest.json'
$item = Get-Item -LiteralPath $redArtifact
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $redArtifact).Hash
$json = Get-Content -Raw -LiteralPath $redArtifact | ConvertFrom-Json
[pscustomobject]@{
  Path = $item.FullName
  Bytes = $item.Length
  SHA256 = $hash
  Success = $json.success
  Passed = $json.numPassedTests
  Failed = $json.numFailedTests
} | Format-List
```

记录首个失败、路径、bytes、SHA-256 和分类：

```text
R2_PERMANENT_REGRESSION_RED = REPRODUCED
PRODUCTION_CODE_CHANGED = NO
```

---

### Task 2: 在 commit point 后先闭合事务，再 best-effort 清理

**Files:**
- Modify: `packages/authoring/src/change-session.ts:304-313`
- Test: `packages/authoring/test/commit-recovery.test.ts`
- Artifact: `<r2Root>/green-postreplace-vitest.json`
- Modify: 本任务书 `Execution Ledger`

**Interfaces:**
- Consumes: `CommitJournal`、`ChangeRecord`、`ProjectWriteStorage.removeStage()`。
- Produces: 磁盘、journal、repository record、内存 record 与返回值一致的 post-commit 合同。

- [ ] **Step 1: 替换 commitChange 尾部顺序**

将当前尾部：

```ts
for (const entry of journal.files) await storage.removeStage(entry.stagedIdentity);
journal.status = 'COMMITTED';
await change.repository.writeJournal(change.record.changeId, journal);
const next = clone(change.record);
next.status = 'COMMITTED';
await change.repository.write(next);
Object.assign(change.record, next);
return { changeId: change.record.changeId, status: 'COMMITTED', files: paths };
```

精确替换为：

```ts
journal.status = 'COMMITTED';
await change.repository.writeJournal(change.record.changeId, journal);
const next = clone(change.record);
next.status = 'COMMITTED';
await change.repository.write(next);
Object.assign(change.record, next);

for (const entry of journal.files) {
  try {
    await storage.removeStage(entry.stagedIdentity);
  } catch {
    // Content and transaction are already COMMITTED. The committed journal
    // retains the staged identity for later inspection; cleanup is best-effort.
  }
}
return { changeId: change.record.changeId, status: 'COMMITTED', files: paths };
```

不得移动或修改 replacement try/catch、恢复循环、哈希回读、`markStale()` 或现有错误码。

- [ ] **Step 2: 审阅最小实现 diff**

```powershell
git diff -- packages/authoring/src/change-session.ts packages/authoring/test/commit-recovery.test.ts
git diff --stat
git diff --check
```

Expected：生产实现仅为 COMMITTED 持久化前移和逐项 best-effort cleanup；不新增接口或状态。

- [ ] **Step 3: 运行 GREEN，最多三次聚焦循环**

```powershell
npm run test -w @surdet/authoring -- commit-recovery.test.ts -t "commits after verified replacements even when staged cleanup fails" --reporter=json --outputFile="$r2Root\green-postreplace-vitest.json"
$greenExit = $LASTEXITCODE
"R2_GREEN_EXIT=$greenExit"
```

Expected：exit `0`，1 个匹配测试通过。

若失败，只能核对持久化顺序、逐项 catch 和 approved test contract；允许白名单内修正后重跑同一 GREEN，累计不超过 3 次。第 3 次仍失败，保留最后输出并停止 `R2_FOCUSED_BUDGET_EXHAUSTED`。

- [ ] **Step 4: 回读 GREEN artifact**

```powershell
$greenArtifact = Join-Path $r2Root 'green-postreplace-vitest.json'
$item = Get-Item -LiteralPath $greenArtifact
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $greenArtifact).Hash
$json = Get-Content -Raw -LiteralPath $greenArtifact | ConvertFrom-Json
[pscustomobject]@{
  Path = $item.FullName
  Bytes = $item.Length
  SHA256 = $hash
  Success = $json.success
  Passed = $json.numPassedTests
  Failed = $json.numFailedTests
} | Format-List
```

Expected：`success=true`、匹配测试 `passed=1`、`failed=0`。

---

### Task 3: 相邻恢复语义、真实 Node storage 与全仓门禁

**Files:**
- Test: `packages/authoring/test/commit-recovery.test.ts`
- Test: `packages/cli/test/node-project-storage.test.ts`
- Artifacts: `<r2Root>/*.txt`
- Modify: 本任务书 `Execution Ledger`

**Interfaces:**
- Consumes: 修正后的共享 `commitChange()`；不变的公开返回和错误合同。
- Produces: authoring 相邻恢复、真实 Node storage、全仓门禁证据。

- [ ] **Step 1: 运行 commit recovery 全文件**

```powershell
npm run test -w @surdet/authoring -- commit-recovery.test.ts 2>&1 |
  Tee-Object -FilePath "$r2Root\commit-recovery-suite.txt"
$commitRecoveryExit = $LASTEXITCODE
"COMMIT_RECOVERY_SUITE_EXIT=$commitRecoveryExit"
```

Expected：exit `0`。必须同时证明：replacement 恢复成功仍 `OPEN`；恢复失败仍 `STALE`；post-commit cleanup 失败为 `COMMITTED`。

- [ ] **Step 2: 运行 authoring 全测试**

```powershell
npm run test -w @surdet/authoring 2>&1 |
  Tee-Object -FilePath "$r2Root\authoring-suite.txt"
$authoringTestExit = $LASTEXITCODE
"AUTHORING_TEST_EXIT=$authoringTestExit"
```

Expected：exit `0`；记录真实文件数和测试数。

- [ ] **Step 3: 运行 authoring typecheck 与 build**

```powershell
npm run typecheck -w @surdet/authoring 2>&1 |
  Tee-Object -FilePath "$r2Root\authoring-typecheck.txt"
$authoringTypecheckExit = $LASTEXITCODE

npm run build -w @surdet/authoring 2>&1 |
  Tee-Object -FilePath "$r2Root\authoring-build.txt"
$authoringBuildExit = $LASTEXITCODE

"AUTHORING_TYPECHECK_EXIT=$authoringTypecheckExit"
"AUTHORING_BUILD_EXIT=$authoringBuildExit"
```

Expected：两者 exit `0`。必须先 build authoring，再运行 CLI 测试，避免 CLI 读取旧 dist。

- [ ] **Step 4: 运行真实 NodeProjectStorage 聚焦测试**

```powershell
npm run test -w @surdet/cli -- node-project-storage.test.ts 2>&1 |
  Tee-Object -FilePath "$r2Root\cli-node-storage.txt"
$cliNodeStorageExit = $LASTEXITCODE
"CLI_NODE_STORAGE_EXIT=$cliNodeStorageExit"
```

Expected：exit `0`。真实 Node storage 的正常 commit、replacement recovery、临时文件清理和路径安全合同保持。

- [ ] **Step 5: 只运行一次 verify:all**

只有 Step 1～4 全绿时执行：

```powershell
npm run verify:all 2>&1 |
  Tee-Object -FilePath "$r2Root\verify-all.txt"
$verifyAllExit = $LASTEXITCODE
"VERIFY_ALL_EXIT=$verifyAllExit"
```

Expected：exit `0`。

若失败：记录最后通过节点、第一个失败节点和与 R2 的相关性；不得重跑、不得修 R3～R6 或其他历史问题；停止等待总经理裁决。

- [ ] **Step 6: 回读全部证据身份**

```powershell
Get-ChildItem -LiteralPath $r2Root -File | Sort-Object Name | ForEach-Object {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
  "$($_.FullName)`t$($_.Length)`t$hash"
}
```

报告每个实际存在文件的绝对路径、bytes、SHA-256 与结果；不得报告预定但未生成的文件。

- [ ] **Step 7: 确认禁止范围没有变化**

```powershell
git status --short --untracked-files=all
git diff --name-only
git diff --check
git diff --cached --check
git ls-files '*.log'
git diff --quiet -- packages/core packages/cli packages/editor packages/renderer packages/host packages/shell examples
"FORBIDDEN_SCOPE_DIFF_EXIT=$LASTEXITCODE"
```

Expected：禁止范围 diff exit `0`；tracked 修改只有两份 authoring 文件和任务书 Ledger。

---

### Task 4: 创建 R2 代码证据提交

**Files:**
- Modify/Stage: `packages/authoring/src/change-session.ts`
- Modify/Stage: `packages/authoring/test/commit-recovery.test.ts`
- Modify/Stage: 本任务书

**Interfaces:**
- Consumes: RED、GREEN、聚焦/下游验证与一次 `verify:all`。
- Produces: 普通本地 `R2_CODE_EVIDENCE_HEAD`。

- [ ] **Step 1: 最终审阅实现合同**

```powershell
git diff -- packages/authoring/src/change-session.ts packages/authoring/test/commit-recovery.test.ts
git diff --stat
git diff --check
```

确认：

```text
content commit point unchanged
target SHA readback unchanged
journal COMMITTED before cleanup
ChangeRecord COMMITTED before cleanup
each removeStage attempted independently
removeStage failure does not throw after commit
pre-commit recovery semantics unchanged
public interfaces unchanged
```

- [ ] **Step 2: 在 Ledger 写入提交前事实**

写入实际命令、exit code、测试数、artifact 身份、工作树和未解决边界；不得预填 commit 哈希。

- [ ] **Step 3: 精确暂存三个文件**

```powershell
git add -- packages/authoring/src/change-session.ts packages/authoring/test/commit-recovery.test.ts docs/superpowers/plans/2026-08-20-reliability-r2-post-replacement-commit-contract.md
git diff --cached --name-status
git diff --cached --check
```

Expected：暂存区只有上述三个文件。

- [ ] **Step 4: 创建普通本地提交**

```powershell
git commit -m "fix(authoring): close post-replacement commits"
```

- [ ] **Step 5: 从 Git 回读代码证据身份**

```powershell
$codeEvidenceHead = git rev-parse HEAD
$codeEvidenceParent = git rev-parse HEAD^
git log --oneline -1
git show --name-status --format=fuller HEAD
git status --short --untracked-files=all
"R2_CODE_EVIDENCE_HEAD=$codeEvidenceHead"
"R2_CODE_EVIDENCE_PARENT=$codeEvidenceParent"
```

Expected：提交只包含批准的两个 authoring 文件和任务书；不得从工具回执猜 hash。

---

### Task 5: 创建 R2 交付报告

**Files:**
- Create: `docs/RELIABILITY-R2-POST-REPLACEMENT-COMMIT-CONTRACT-DELIVERY-REPORT-2026-08-20.md`
- Modify: 本任务书 `Execution Ledger`
- Read: Task 1～4 磁盘证据

**Interfaces:**
- Consumes: RED/GREEN、聚焦/全仓验证、代码提交和 Git 状态。
- Produces: 可独立复审的 R2 交付报告。

- [ ] **Step 1: 按固定结构创建报告**

报告必须包含：

1. 第一行真实停止状态；
2. 原三联态与 commit point 定义；
3. 最小实现及明确未修改项；
4. RED/GREEN 命令、exit code、首个失败/通过；
5. authoring、CLI Node storage、`verify:all` 实际结果；
6. 全部 artifact 路径、bytes、SHA-256；
7. `R2_CODE_EVIDENCE_HEAD/PARENT`；
8. 提交精确范围；
9. R3～R6、Wave 4、push 均未开始；
10. `ARCHITECT_REVIEW=WAIVED_BY_OWNER`、`ARCHITECT_PASS=NOT_CLAIMED`；
11. 下一步为小衡独立复审，不是 R3 自动施工。

全部成功时第一行使用：

```text
RELIABILITY_R2_POST_REPLACEMENT_COMMIT_CONTRACT_FIXED — PERMANENT_REGRESSION_PASSED; SHARED_TRANSACTION_VERIFIED; ARCHITECT_REVIEW_WAIVED_BY_OWNER; WAITING_FOR_INDEPENDENT_FINAL_REVIEW; NOT_PUSHED; WAVE_4_PAUSED
```

任何验证失败时不得保留 `FIXED`。

- [ ] **Step 2: 明确验证边界**

报告必须写明：

```text
已验证：replacement + SHA readback 成功后，removeStage 失败不会产生 changed+threw+OPEN。
已验证：API、内存 record、repository record、journal 均为 COMMITTED。
已验证：一个 cleanup 失败不阻止后续 staged identity 的 cleanup 尝试。
已验证：replacement 恢复成功/失败的 OPEN/STALE 合同保持。
未验证：R3 Windows replacement 原子性、repository 自身 post-commit 持久化失败、跨进程垃圾扫描。
```

- [ ] **Step 3: 回读报告最终身份**

先完成报告正文，再执行：

```powershell
$report = 'docs/RELIABILITY-R2-POST-REPLACEMENT-COMMIT-CONTRACT-DELIVERY-REPORT-2026-08-20.md'
$item = Get-Item -LiteralPath $report
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $report).Hash
"$report`t$($item.Length)`t$hash"
```

把报告 bytes/SHA-256 写入任务书 Ledger；之后不得再修改报告，除非发现磁盘事实不一致。

- [ ] **Step 4: 回读当前 Git 与文档范围**

```powershell
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
git status --short --untracked-files=all
git diff --name-status
git diff --check
git diff --cached --check
git ls-files '*.log'
```

修正任何与磁盘不一致的身份或状态词；只允许修改任务书和交付报告，不回改生产代码。

---

### Task 6: docs-only closure 与小衡审核停止点

**Files:**
- Modify/Stage: 本任务书
- Create/Stage: R2 交付报告

**Interfaces:**
- Consumes: 代码证据提交后的真实 Git 状态与报告身份。
- Produces: docs-only `R2_DOCUMENT_CLOSURE_HEAD`；等待小衡独立复审。

- [ ] **Step 1: 在 Ledger 记录代码提交后身份**

记录：

```text
R2_CODE_EVIDENCE_HEAD
R2_CODE_EVIDENCE_PARENT
surdet/main
ahead/behind
code commit exact scope
tracked/staged state after code commit
report bytes/SHA-256
```

不得预填尚未创建的 docs closure hash。

- [ ] **Step 2: 精确暂存两份文档**

```powershell
git add -- docs/superpowers/plans/2026-08-20-reliability-r2-post-replacement-commit-contract.md docs/RELIABILITY-R2-POST-REPLACEMENT-COMMIT-CONTRACT-DELIVERY-REPORT-2026-08-20.md
git diff --cached --name-status
git diff --cached --check
```

Expected：只有两份 R2 文档。

- [ ] **Step 3: 创建 docs-only 提交**

```powershell
git commit -m "docs(reliability): report post-replacement commit fix"
```

- [ ] **Step 4: 立即回读最终 Git 状态**

```powershell
$documentClosureHead = git rev-parse HEAD
$documentClosureParent = git rev-parse HEAD^
$remoteMain = git rev-parse surdet/main
$aheadBehind = git rev-list --left-right --count surdet/main...HEAD

git log --oneline -2
git show --name-status --format=fuller HEAD
git status --short --untracked-files=all
git diff --check
git diff --cached --check
git ls-files '*.log'

"R2_DOCUMENT_CLOSURE_HEAD=$documentClosureHead"
"R2_DOCUMENT_CLOSURE_PARENT=$documentClosureParent"
"REMOTE_MAIN=$remoteMain"
"AHEAD_BEHIND=$aheadBehind"
```

不要为了把 `R2_DOCUMENT_CLOSURE_HEAD` 写回包含它自身的提交而再次修改文档。该 hash 只在最终交接报告和小衡复审中引用，避免无限 docs 自引用。

- [ ] **Step 5: 输出独立审核交接并停止**

最终交接必须包含：

```text
TASKBOOK
DELIVERY_REPORT
RED/GREEN path, bytes, SHA-256, result
FOCUSED/AUTHORING/CLI/VERIFY_ALL results
R2_CODE_EVIDENCE_HEAD/PARENT
R2_DOCUMENT_CLOSURE_HEAD/PARENT
REMOTE_MAIN
AHEAD_BEHIND
EXACT COMMIT SCOPES
TRACKED/STAGED STATUS
ARCHITECT_REVIEW = WAIVED_BY_OWNER
ARCHITECT_PASS = NOT_CLAIMED
PUSH = NOT_PERFORMED
R3_NOT_STARTED = TRUE
WAVE_4 = PAUSED
```

成功停止状态：

```text
RELIABILITY_R2_POST_REPLACEMENT_COMMIT_CONTRACT_FIXED
PERMANENT_REGRESSION_PASSED
SHARED_TRANSACTION_AND_DOWNSTREAM_VERIFIED
ARCHITECT_REVIEW_WAIVED_BY_OWNER
READY_FOR_INDEPENDENT_FINAL_REVIEW
WAITING_FOR_INDEPENDENT_FINAL_REVIEW
NOT_PUSHED
R3_NOT_STARTED
WAVE_4_PAUSED
```

执行 AI 完整报告直接交小衡。小衡完成 Local Audit + Independent Final Review 后，项目所有者只需把小衡综合结论交总经理。执行 AI 不得自动进入 R3。

---

## 五、独立审核清单

小衡至少核验：

1. 永久测试是否真实跨过全部 replacement 与 SHA readback；
2. 第一次 `removeStage()` 是否确实失败并留下 stage；
3. 第二个 staged identity 是否仍被尝试清理；
4. 返回值、内存 record、repository record、journal 是否均为 `COMMITTED`；
5. COMMITTED 持久化是否发生在 cleanup 之前；
6. 只有 post-commit `removeStage()` 被 best-effort；replacement、哈希、恢复和持久化错误是否仍 fail-loud；
7. 既有 replacement 恢复成功/失败测试是否保持；
8. public interfaces、ChangeStatus 和错误码是否未变；
9. CLI Node storage 聚焦测试与 `verify:all` 是否使用新鲜 authoring build；
10. artifact 是否存在且哈希匹配；
11. 两笔提交范围是否精确；
12. 是否未修改 R3/Wave 4/长期台账/受保护文件，且未 push。

任一项缺少磁盘、Git 或测试证据，不得给出最终 PASS。

## 六、Execution Ledger

### 2026-08-20 任务书生成基线

```text
PLANNING_BASE_BRANCH = main
PLANNING_BASE_HEAD = d423927a1c7e02c49d3fedd463d8afb2f0ea9719
PLANNING_BASE_PARENT = 9261d11e96d5927b15310721e8ce8215657c46ae
LOCAL_TRACKING_SURDET_MAIN = d423927a1c7e02c49d3fedd463d8afb2f0ea9719
AHEAD_BEHIND = 0 0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
R1 = CLOSED_AND_PUSHED
R2_TASKBOOK_AUTHORING = AUTHORIZED
R2_EXECUTION = NOT_AUTHORIZED_AT_TASKBOOK_CREATION
ARCHITECT_REVIEW = WAIVED_BY_OWNER
ARCHITECT_PASS = NOT_CLAIMED
R3_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_AUTHORIZED
```

任务书生成时，只新增本任务书；没有修改生产源码、测试、长期路线台账或 Git 历史。既有未跟踪治理、handoff、`.dsh`、`.learnings` 和受保护文件原样保留。

当前停止状态：

```text
RELIABILITY_R2_POST_REPLACEMENT_COMMIT_CONTRACT_TASKBOOK_COMPLETED
WAITING_FOR_OWNER_EXECUTION_AUTHORIZATION
NO_PRODUCTION_CODE_CHANGED_BY_TASKBOOK_AUTHORING
R3_NOT_STARTED
WAVE_4_PAUSED
NOT_PUSHED_AFTER_R2_TASKBOOK
```

### 2026-08-20 Task 0 执行基线

```text
R2_TASK_0 = PASSED
EXECUTION_AUTHORIZATION = OWNER_APPROVED_R2
BRANCH = main
HEAD = d423927a1c7e02c49d3fedd463d8afb2f0ea9719
HEAD_PARENT = 9261d11e96d5927b15310721e8ce8215657c46ae
REMOTE_MAIN = d423927a1c7e02c49d3fedd463d8afb2f0ea9719
RAW_REV_LIST_SURDET_MAIN_THREE_DOTS_HEAD = 0 0
AHEAD_BEHIND_HEAD_VS_REMOTE = 0 0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
TRACKED_LOGS = NONE
R1_BASELINE = CLOSED_AND_PUSHED_PER_CURRENT_R2_TASKBOOK_AND_TRACKING_REF
R2_IMPLEMENTATION = AUTHORIZED_ONLY_AFTER_VALID_RED
ARCHITECT_REVIEW = WAIVED_BY_OWNER
ARCHITECT_PASS = NOT_CLAIMED
R3_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_AUTHORIZED
R2_ROOT = C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731
R2_ROOT_CREATED_UTC = 2026-08-20T15:29:45.5385631Z
```

Task 0 按任务书顺序读取了 `AGENTS.md`、长期路线台账、Fresh Gate 任务书/报告、R1 任务书/报告、本任务书以及 R2 被测源码/测试/合同文件。既有未跟踪治理、handoff、受保护文件和长期路线台账均原样保留，未被整理、暂存或提交。R1 报告中的历史状态与当前 R2 任务书/本地追踪 ref 的事实边界已区分；本轮不重跑 Fresh Gate 或 R1。

Task 0 被测文件身份（从磁盘回读）：

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `packages/authoring/src/change-session.ts` | 12068 | `EF181C68172482FA7E3A6B88D50779478C02B067C9A88DF92FCC14940FC4C0CE` |
| `packages/authoring/test/commit-recovery.test.ts` | 4731 | `206FD737994394CBEAE5C1E34B0CF4616AA20ECFBAB12C4A6D5BC656BE04AAFE` |
| `packages/authoring/src/contracts.ts` | 7415 | `A981AFA807ACE36755114CEDF2349A26ED983DCB210C4B2272441FE1E05D44D7` |
| `packages/cli/src/authoring/node-project-storage.ts` | 13865 | `615814F547A28DC478F628C31B27FA1B714589B58E4FCAEE01AD924FE90C7CF8` |
```

源码核对确认 `commitChange()` 当前仍先执行 `for (const entry of journal.files) await storage.removeStage(...)`，之后才写入 `journal.status = 'COMMITTED'`、repository journal、`ChangeRecord` 和内存 record；当前尚未实现 R2 修复。Task 0 停止点为：只允许在正式测试白名单内建立 R2 永久回归并执行一次 RED。

### 2026-08-20 Task 1 永久 RED

```text
R2_TASK_1 = COMPLETED
FORMAL_TEST_FILE = packages/authoring/test/commit-recovery.test.ts
FORMAL_TEST_CHANGE = added PostReplaceCleanupFaultStorage; made beginFixture accept an optional InMemoryChangeRepository; added the permanent post-replacement cleanup regression.
RED_RUN_COUNT = 1
RED_COMMAND = npm run test -w @surdet/authoring -- commit-recovery.test.ts -t "commits after verified replacements even when staged cleanup fails" --reporter=json --outputFile=<R2_ROOT>/red-postreplace-vitest.json
RED_EXIT_CODE = 1
RED_SUCCESS = FALSE
RED_PASSED = 0
RED_FAILED = 1
RED_FAILURE = Error: injected post-replacement cleanup failure
RED_FAILURE_LOCATION = PostReplaceCleanupFaultStorage.removeStage; change-session.ts:306
RED_CLASSIFICATION = PERMANENT_RED_REPRODUCED
RED_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\red-postreplace-vitest.json
RED_ARTIFACT_BYTES = 1965
RED_ARTIFACT_SHA256 = 419E109E2233BF45F95A3126A4308E3DC6D02BD271D2F7904699944213390B0D
PRODUCTION_DIFF_DURING_RED = NONE (git diff --quiet -- packages/authoring/src/change-session.ts exited 0)
```

该 RED 直接证明旧实现会在 replacement 与 SHA-256 readback 成功后，因 `removeStage()` 抛错而无法完成 COMMITTED 持久化；未因 exit 1 自动修复或循环重跑。

### 2026-08-20 Task 2 最小共享 Authoring 修复

```text
R2_TASK_2 = COMPLETED
PRODUCTION_FILE = packages/authoring/src/change-session.ts
PRODUCTION_SCOPE = ONLY_SHARED_AUTHORING_CHANGE_SESSION
OLD_ORDER = removeStage for every staged identity -> journal/repository/memory COMMITTED persistence
NEW_ORDER = journal COMMITTED journal persistence -> repository ChangeRecord COMMITTED persistence -> in-memory record assignment -> best-effort per-entry removeStage
CLEANUP_FAILURE_POLICY = swallowed after commit point; committed journal retains staged identity; later entries are still attempted
PRE_COMMIT_RECOVERY = UNCHANGED
PRODUCTION_DIFF_CHECK = PASS
```

GREEN 使用同一条正式聚焦断言，仅执行一次：

```text
GREEN_COMMAND = npm run test -w @surdet/authoring -- commit-recovery.test.ts -t "commits after verified replacements even when staged cleanup fails" --reporter=json --outputFile=<R2_ROOT>/green-postreplace-vitest.json
GREEN_EXIT_CODE = 0
GREEN_SUCCESS = TRUE
GREEN_PASSED = 1
GREEN_FAILED = 0
GREEN_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\green-postreplace-vitest.json
GREEN_ARTIFACT_BYTES = 1472
GREEN_ARTIFACT_SHA256 = E095EE43EDC3F38595085E8B37556D0F0B294FA36B9362D5765ED9C52165C4DE
GREEN_ASSERTION = atomic commit recovery commits after verified replacements even when staged cleanup fails
```

### 2026-08-20 Task 3 验证证据

```text
R2_TASK_3 = COMPLETED
VERIFY_ALL_RUN_COUNT = 1
FORBIDDEN_SCOPE_DIFF_EXIT = 0
TRACKED_LOGS = NONE
GIT_DIFF_CHECK = PASS
GIT_CACHED_DIFF_CHECK = PASS
```

直接验证结果：

| 命令 | 结果 | 关键计数 | artifact | bytes | SHA-256 |
|---|---|---:|---|---:|---|
| `npm run test -w @surdet/authoring -- commit-recovery.test.ts` | PASS | 1 file / 3 tests | `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\commit-recovery-suite.txt` | 360 | `5BFCB1760242EB9DD614BFE9FD13EC1116CA9B5FF00CAD922496FCD114C2B8C6` |
| `npm run test -w @surdet/authoring` | PASS | 20 files / 123 tests | `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\authoring-suite.txt` | 1288 | `E74869819F5C2497BAAF3019D1D3A8639042F9EF61BD3527C727C2EFAFBD7F1E` |
| `npm run typecheck -w @surdet/authoring` | PASS | completed | `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\authoring-typecheck.txt` | 74 | `9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78` |
| `npm run build -w @surdet/authoring` | PASS | completed | `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\authoring-build.txt` | 67 | `D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9` |
| `npm run test -w @surdet/cli -- node-project-storage.test.ts` | PASS | 1 file / 5 tests | `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\cli-node-storage.txt` | 376 | `3D2856F5EE1D5AF614B151FAA764D2FF307B88C774F591027EC2812332337064` |
| `npm run verify:all` | PASS | final `verify:diff-check` passed | `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\verify-all.txt` | 56157 | `8544DDFE6E7A66629AA770AC3E79AADC109A82A4A066CFA626AD35A0C812558F` |

`verify:all` 的完整验证节点均通过：tools 10/10、renderer boundaries 3/3、renderer legacy 4/4、hygiene 731 paths、Authoring 20/123、CLI 14/129、Core 24/318、Editor 26/172、Host 11/87、Renderer 49/406、Shell 22/195、Starter 4/7、Zero 4/29；starter lint 0 errors/4 warnings；formal zero lint 0 errors/128 warnings；Starter 与 Zero simulate、Editor/Starter/formal build 及最终 diff-check 均通过。Starter simulate 仅作为本次唯一 `verify:all` 内置节点执行，未单独运行；未运行 Electron、性能、打包、部署或发行命令。

Task 3 结束时，生产代码与正式测试的 tracked diff 仅为 `packages/authoring/src/change-session.ts`、`packages/authoring/test/commit-recovery.test.ts`；Core/CLI/Editor/Renderer/Host/Shell/Starter 的禁止范围 diff 检查退出码为 0。既有未跟踪治理、handoff、`.dsh`、`.learnings`、受保护文件和本 R2 任务书均未被整理或删除。

### 2026-08-20 Task 4 代码提交前范围审计

```text
R2_TASK_4_PRECOMMIT = PASSED
CODE_PRODUCTION_FILE = packages/authoring/src/change-session.ts
CODE_TEST_FILE = packages/authoring/test/commit-recovery.test.ts
TASKBOOK_FILE = docs/superpowers/plans/2026-08-20-reliability-r2-post-replacement-commit-contract.md
EXPECTED_CODE_COMMIT_SCOPE = exactly the three paths above
EXPECTED_CODE_COMMIT_MESSAGE = fix(authoring): close post-replacement commits
FORBIDDEN_SCOPE_DIFF_EXIT = 0
GIT_DIFF_CHECK = PASS
WORKTREE_TRACKED_SCOPE_BEFORE_STAGE = the two Authoring paths only
UNRELATED_TRACKED_CHANGES = NONE
TASKBOOK_UNTRACKED_GOVERNANCE_FILES = PRESERVED_AND_NOT_STAGED
R3_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_AUTHORIZED
```

差异复核确认：生产改动只有将 `COMMITTED` journal、repository record 和内存 record 提前到 commit point，并将逐 entry `removeStage()` 改为 best-effort；正式测试只增加 post-replacement cleanup fault storage、repository 注入和永久回归断言。未修改 CLI/Editor/Core/Shell/Renderer/Host/Starter/Zero、长期路线台账或受保护文件。下一步仅按精确路径暂存并创建代码证据提交。
