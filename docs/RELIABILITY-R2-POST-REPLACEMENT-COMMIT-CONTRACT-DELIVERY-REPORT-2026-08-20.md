RELIABILITY_R2_POST_REPLACEMENT_COMMIT_CONTRACT_FIXED — PERMANENT_REGRESSION_PASSED; SHARED_TRANSACTION_VERIFIED; ARCHITECT_REVIEW_WAIVED_BY_OWNER; WAITING_FOR_INDEPENDENT_FINAL_REVIEW; NOT_PUSHED; WAVE_4_PAUSED

# Reliability R2 交付报告：Post-Replacement Commit Contract

## 交付结论

本轮只处理 R2：Authoring 共享 `commitChange()` 在 replacement 和 SHA-256 readback 成功后、staged cleanup 失败时的提交契约。已先取得一次永久 RED，再实施最小共享 Authoring 修复；正式回归、Authoring 全套、CLI Node storage 聚焦、类型检查、构建和唯一一次 `verify:all` 均通过。

网页 Architect 状态按项目所有者明确裁决记录为：

```text
ARCHITECT_REVIEW = WAIVED_BY_OWNER
ARCHITECT_PASS = NOT_CLAIMED
```

本报告只覆盖 R2。R3～R6 未启动，Wave 4 保持暂停；未修改 CLI/Editor/Core/Shell 生产代码，未 push，未执行独立于 `verify:all` 的 Electron、性能、打包、部署或发行流程。

## Git 身份与范围

```text
R2_EXECUTION_INITIAL_HEAD = d423927a1c7e02c49d3fedd463d8afb2f0ea9719
R2_EXECUTION_INITIAL_PARENT = 9261d11e96d5927b15310721e8ce8215657c46ae
R2_CODE_EVIDENCE_HEAD = e2acb7ee444950b06756cf035ff761c0e8e2477b
R2_CODE_EVIDENCE_PARENT = d423927a1c7e02c49d3fedd463d8afb2f0ea9719
R2_CODE_COMMIT_MESSAGE = fix(authoring): close post-replacement commits
REMOTE_MAIN_AT_CODE_COMMIT = d423927a1c7e02c49d3fedd463d8afb2f0ea9719
RAW_REV_LIST_SURDET_MAIN_THREE_DOTS_HEAD_AT_CODE_COMMIT = 0 1
SEMANTIC_AHEAD_BEHIND_AT_CODE_COMMIT = 1 ahead / 0 behind
R2_CODE_COMMIT_PUSHED = NO
```

代码证据提交范围精确为：

```text
A docs/superpowers/plans/2026-08-20-reliability-r2-post-replacement-commit-contract.md
M packages/authoring/src/change-session.ts
M packages/authoring/test/commit-recovery.test.ts
```

代码证据提交后，交付报告是唯一新增的正式文档；Task 6 将只把本报告与任务书作为 docs-only closure 一并提交。既有未跟踪治理、handoff、`.dsh`、`.learnings` 和受保护文件未被整理、删除、暂存或提交。

## 缺陷与最小修复

旧实现的危险顺序是：

```text
replacement loop
SHA-256 reread verification
removeStage(entry 1..N)
journal.status = COMMITTED
repository.writeJournal(...)
repository.write(ChangeRecord COMMITTED)
memory record assignment
```

当 replacement 与 SHA-256 readback 已成功，而 `removeStage()` 抛错时，旧实现会把已经落盘的新内容暴露为 `changed + threw + OPEN`，且不会完成 COMMITTED journal、repository record 和内存 record 的持久化。

本轮只修改 `packages/authoring/src/change-session.ts`：

```text
replacement loop
SHA-256 reread verification
journal.status = COMMITTED
repository.writeJournal(...)
repository.write(ChangeRecord COMMITTED)
memory record assignment
best-effort removeStage(entry 1..N)
return COMMITTED
```

每个 staged identity 仍会被尝试清理；cleanup 失败被吞掉，不会回滚已经完成的 commit point。已提交 journal 保留 staged identity，供后续检查。replacement 失败、恢复成功/失败以及既有 OPEN/STALE 合同未被改变。

## 永久 RED / GREEN

永久回归只新增于 `packages/authoring/test/commit-recovery.test.ts`，包括 post-replacement cleanup fault storage、可注入的 `InMemoryChangeRepository` 和公开的 COMMITTED 状态断言。

```text
RED_RUN_COUNT = 1
RED_EXIT_CODE = 1
RED_FAILURE = Error: injected post-replacement cleanup failure
RED_SUCCESS = FALSE
RED_PASSED = 0
RED_FAILED = 1
RED_CLASSIFICATION = PERMANENT_RED_REPRODUCED
GREEN_RUN_COUNT = 1
GREEN_EXIT_CODE = 0
GREEN_SUCCESS = TRUE
GREEN_PASSED = 1
GREEN_FAILED = 0
GREEN_ASSERTION = atomic commit recovery commits after verified replacements even when staged cleanup fails
```

RED 期间 `packages/authoring/src/change-session.ts` 的 production diff 检查退出码为 0；没有通过删除、覆盖、筛选失败证据或自动循环重跑来制造绿灯。GREEN 在最小修复后只执行一次。

## 验证结果

| 验证 | 结果 |
|---|---|
| `commit-recovery.test.ts` 聚焦 | PASS — 1 file / 3 tests |
| Authoring 全套 | PASS — 20 files / 123 tests |
| Authoring typecheck | PASS |
| Authoring build | PASS |
| CLI `node-project-storage.test.ts` | PASS — 1 file / 5 tests |
| `verify:all` | PASS — 唯一一次运行，最终 `verify:diff-check` PASS |

`verify:all` 中的完整计数为：tools 10/10；renderer boundaries 3/3；renderer legacy 4/4；hygiene 731 paths；Authoring 20/123；CLI 14/129；Core 24/318；Editor 26/172；Host 11/87；Renderer 49/406；Shell 22/195；Starter 4/7；Zero 4/29。Starter lint 为 0 errors / 4 warnings，formal zero lint 为 0 errors / 128 warnings；Starter/Zero simulate、Editor/Starter/formal build 以及最终 diff-check 均通过。

Starter simulate 仅作为这一次 `verify:all` 的内置节点执行，未单独运行；没有执行 Wave 4、Electron、性能、打包、部署或发行命令。

## Artifact 身份

以下路径、字节数和 SHA-256 均在本轮从磁盘回读：

| artifact | bytes | SHA-256 |
|---|---:|---|
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\red-postreplace-vitest.json` | 1965 | `419E109E2233BF45F95A3126A4308E3DC6D02BD271D2F7904699944213390B0D` |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\green-postreplace-vitest.json` | 1472 | `E095EE43EDC3F38595085E8B37556D0F0B294FA36B9362D5765ED9C52165C4DE` |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\commit-recovery-suite.txt` | 360 | `5BFCB1760242EB9DD614BFE9FD13EC1116CA9B5FF00CAD922496FCD114C2B8C6` |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\authoring-suite.txt` | 1288 | `E74869819F5C2497BAAF3019D1D3A8639042F9EF61BD3527C727C2EFAFBD7F1E` |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\authoring-typecheck.txt` | 74 | `9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78` |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\authoring-build.txt` | 67 | `D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9` |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\cli-node-storage.txt` | 376 | `3D2856F5EE1D5AF614B151FAA764D2FF307B88C774F591027EC2812332337064` |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\verify-all.txt` | 56157 | `8544DDFE6E7A66629AA770AC3E79AADC109A82A4A066CFA626AD35A0C812558F` |

## 已验证边界与未覆盖边界

已验证：replacement + SHA readback 成功后，`removeStage` 失败不会产生 `changed+threw+OPEN`。

已验证：API、内存 record、repository record、journal 均为 `COMMITTED`。

已验证：一个 cleanup 失败不阻止后续 staged identity 的 cleanup 尝试。

已验证：replacement 恢复成功/失败的 OPEN/STALE 合同保持。

未验证：R3 Windows replacement 原子性、repository 自身 post-commit 持久化失败、跨进程垃圾扫描。

这些未覆盖项不属于本轮 R2 修复范围，不作为已通过能力声明。

## 停止与交接

```text
ARCHITECT_REVIEW = WAIVED_BY_OWNER
ARCHITECT_PASS = NOT_CLAIMED
R3_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_PERFORMED
NEXT_REVIEW = INDEPENDENT_FINAL_REVIEW_BY_XIAOHENG
STOP_STATE = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
```

请小衡独立复核代码提交 `e2acb7ee444950b06756cf035ff761c0e8e2477b`、本报告与任务书 Ledger、上述 artifact 身份及最终 docs-only closure 提交。未经独立最终复核，不自动进入 R3。

## R2 测试合同补强：M1 / M2

### 历史终审纠正

本次测试合同补强前的独立终审结论为：

```text
R2_PRE_REINFORCEMENT_INDEPENDENT_FINAL_REVIEW = NEEDS_FIX
```

原因不是当前生产实现出现运行错误，而是原永久回归虽然验证了最终 `COMMITTED` 状态和 cleanup 调用次数，却没有证明：

```text
1. journal / ChangeRecord 的持久化完成发生在 cleanup 尝试之前；
2. 第一次失败的 staged identity 仍保留在 committed journal 中，且对应 entry 的 replaced=true。
```

不得将原测试描述为已经证明了上述顺序或取证保留。本轮 `R2_IMPLEMENTATION_CHANGED = NO`，没有修改任何生产实现、生产事件钩子、调试接口或测试专用生产分支。

### R2-M1：持久化完成先于 cleanup 尝试

测试新增共享事件序列和两个测试替身：

```text
PersistedCommitEventRepository.writeJournal:
  await super.writeJournal(...)
  events.push('journal-persisted:COMMITTED')

PersistedCommitEventRepository.write:
  await super.write(...)
  events.push('record-persisted:COMMITTED')

PostReplaceCleanupFaultStorage.removeStage:
  events.push('cleanup-attempt:<stagedIdentity>')
  first attempt throws
  second attempt removes its stage
```

准备阶段完成后，测试执行 `events.length = 0`，再进入 `commitChange()`。通过后的完整事件序列为：

```text
journal-persisted:COMMITTED
record-persisted:COMMITTED
cleanup-attempt:<first staged identity>
cleanup-attempt:<second staged identity>
```

测试同时显式断言 journal persisted index < record persisted index < first cleanup index，并确认两个 staged entry 均发生 cleanup attempt。因此，如果实现改回“先 cleanup、吞掉错误、最后写 COMMITTED”，该精确序列断言将失败。

```text
R2_M1_ORDERING_CONTRACT = PASS
```

### R2-M2：committed journal 保留失败 staged identity

测试取得 `failedStagedIdentity = storage.removeStageCalls[0]`，随后显式断言：

```text
journal.status = COMMITTED
journal.files.map(entry => entry.stagedIdentity) = storage.removeStageCalls
journal.files contains failedStagedIdentity
failedEntry.replaced = true
storage.staged.has(failedStagedIdentity) = true
storage.staged keys = [failedStagedIdentity]
```

这证明第一次 cleanup 失败的 staged entry 没有被测试替身误删，并且 committed journal 保留了可供后续检查的失败 identity 与 replacement 证据；不再只使用 `toMatchObject({ status: 'COMMITTED' })` 作为 journal 证据。

```text
R2_M2_STAGED_IDENTITY_RETENTION = PASS
```

### 本轮测试合同提交

```text
R2_TEST_CONTRACT_HEAD = 855d3d10c29b69d48c3280087da06b69fcdb52a2
R2_TEST_CONTRACT_PARENT = a9b8a5bf12e6c7bec81a75af68d75aedc85b6407
R2_TEST_COMMIT_MESSAGE = test(authoring): prove post-replacement commit ordering
R2_TEST_COMMIT_SCOPE = exactly packages/authoring/test/commit-recovery.test.ts
R2_TEST_COMMIT_PUSHED = NO
```

### 本轮实际验证与新增 artifact

本轮只运行以下验证：

```text
npm run test -w @surdet/authoring -- commit-recovery.test.ts -t "commits after verified replacements even when staged cleanup fails" --reporter=json --outputFile=C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\r2m1m2-focused-vitest.json
EXIT = 0; 1 passed / 2 pending

npm run test -w @surdet/authoring -- commit-recovery.test.ts --reporter=json --outputFile=C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\r2m1m2-commit-recovery-vitest.json
EXIT = 0; 3 passed / 0 failed

npm run typecheck -w @surdet/authoring
EXIT = 0

git diff --check
EXIT = 0

git diff --cached --check
EXIT = 0
```

新增 artifact 使用独立文件名，未覆盖原 RED/GREEN artifact：

| artifact | bytes | SHA-256 |
|---|---:|---|
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\r2m1m2-focused-vitest.json` | 1472 | `6EEF42249464984C10929AACD9574C25FC1874A59F498F59CA36ED77E6F29182` |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\r2m1m2-commit-recovery-vitest.json` | 1530 | `FC04B466B9FADFE21128FFE2AF23605BEBA1746AB2F8A7252274868E34487FBB` |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r2-postreplace-f2b137900c53455ab06f64ab5fd8a731\r2m1m2-authoring-typecheck.txt` | 74 | `9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78` |

原有 RED/GREEN artifact 仍保留在任务书记录的路径中；本轮没有覆盖它们。此前生产代码对应的 `verify:all` 证据继续有效，但本轮没有重跑 `verify:all`、Authoring 全量、CLI、Starter simulate、Electron、FORMAL/DIAGNOSTIC、性能、pack、部署或发行。

```text
R2_IMPLEMENTATION_CHANGED = NO
R2_PRODUCTION_RUNTIME_ERROR_FOUND = NO
R2_TEST_CONTRACT_REINFORCEMENT = COMPLETED
```
