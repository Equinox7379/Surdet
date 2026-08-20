RELIABILITY_R1_SIMULATION_CONTROL_FLOW_IDENTITY_FIXED — PERMANENT_REGRESSION_PASSED; SHARED_SIMULATION_VERIFIED; ARCHITECT_REVIEW_WAIVED_BY_OWNER; WAITING_FOR_INDEPENDENT_FINAL_REVIEW; NOT_PUSHED; WAVE_4_PAUSED

# R1 Simulation Control-Flow Identity Delivery Report

## 1. Scope and stop state

本报告只覆盖 R1：simulation state-signature 对 `callStack` 身份的保留。没有进入 R2～R6，没有启动 Wave 4，没有执行 Electron/浏览器、性能、打包、部署或发行流程，也没有 push。

最终交接状态：

```text
RELIABILITY_R1_SIMULATION_CONTROL_FLOW_IDENTITY_FIXED
PERMANENT_REGRESSION_PASSED
SHARED_SIMULATION_AND_DOWNSTREAM_VERIFIED
ARCHITECT_REVIEW = WAIVED_BY_OWNER
ARCHITECT_PASS = NOT_CLAIMED
NEXT_STOP = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
NOT_PUSHED
R2_NOT_STARTED
WAVE_4_IMPLEMENTATION_PAUSED
```

## 2. Defect and correctness contract

缺陷是：模拟器过去只用 `position + variables` 作为 `seenSignatures` 身份，两个位置和变量相同但 `callStack` 不同的状态会被错误合并。这样 caller B 的真实 `@check` Runtime error 可能被 caller A 的已通过路径遮蔽。

最小修复在 `packages/authoring/src/simulation.ts` 增加私有 helper：

```ts
JSON.stringify([snapshot.position, snapshot.callStack ?? [], snapshot.variables])
```

choice 检查点继续使用同一个 `SaveSnapshot`，只替换状态签名来源；没有改变 `seenSignatures` 生命周期、路径剪枝、预算限制、SaveSnapshot schema 或下游接口。

已验证：相同 position/variables、不同 callStack 不再合并；caller A 结局与 caller B Runtime error 均被观察。
已验证：既有 state-signature 循环剪枝与路径预算合同保持。
已验证：CLI/Starter 继续消费共享模拟真相。
未验证：R2～R6；Electron/浏览器；Wave 4 Agent Port；性能与发行。

## 3. Commit evidence and exact scope

R1 基线（Task 4 恢复前）：

```text
INITIAL_HEAD = 0052927df0ceb30941cb8b17af479623f23204bc
REMOTE_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
```

R1 生产代码证据提交：

```text
CODE_EVIDENCE_HEAD = dc9c7cd3037e5eb4cef10b93804505bf8e864ef3
CODE_EVIDENCE_PARENT = 0052927df0ceb30941cb8b17af479623f23204bc
COMMIT_MESSAGE = fix(authoring): preserve simulation call stack identity
```

该提交的精确文件范围：

```text
A docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md
M packages/authoring/src/simulation.ts
M packages/authoring/test/simulation.test.ts
```

恢复首次 `verify:all` 的未关联 Shell 类型错误后，按批准的恢复指令另建独立测试提交：

```text
SHELL_GATE_CLEANUP_HEAD = 54e2d73ba7008a9559e50b9aacafac2bae66a350
SHELL_GATE_CLEANUP_PARENT = dc9c7cd3037e5eb4cef10b93804505bf8e864ef3
COMMIT_MESSAGE = test(shell): satisfy slot collision type safety
```

该提交只修改：

```text
M packages/shell/test/save-store-slot-collision.test.ts
```

改动仅为 `metas[0].updatedAt` 改成 `metas[0]?.updatedAt`，用于满足该测试自身的类型安全；没有修改 Shell 生产代码，也没有把该测试改动伪装成 R1 生产修复。

在文档闭合提交前的真实状态：

```text
REPORT_CREATED_AT_HEAD = 54e2d73ba7008a9559e50b9aacafac2bae66a350
REPORT_CREATED_AT_PARENT = dc9c7cd3037e5eb4cef10b93804505bf8e864ef3
REMOTE_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
AHEAD_BEHIND_BEFORE_DOCUMENT_CLOSURE = 0 7
TRACKED_WORKTREE_BEFORE_DOCUMENT_CLOSURE = CLEAN
STAGED_WORKTREE_BEFORE_DOCUMENT_CLOSURE = CLEAN
```

## 4. Test and gate evidence

### R1 permanent regression

```text
RED_COMMAND = npm run test -w @surdet/authoring -- simulation.test.ts -t "distinguishes equal position and variables when call stacks differ" --reporter=json --outputFile="$r1Root\red-sim-state-vitest.json"
RED_EXIT = 1
RED_FIRST_FAILURE = AssertionError: expected 'passed' to be 'failed' // Object.is equality
RED_RESULT = 0 passed / 1 failed

GREEN_COMMAND = npm run test -w @surdet/authoring -- simulation.test.ts -t "distinguishes equal position and variables when call stacks differ" --reporter=json --outputFile="$r1Root\green-sim-state-vitest.json"
GREEN_EXIT = 0
GREEN_RESULT = 1 passed / 0 failed; 11 assertions
```

### Focused and downstream results

```text
SIMULATION_SUITE = PASS; 1 file / 11 tests
AUTHORING_SUITE = PASS; 20 files / 122 tests
AUTHORING_TYPECHECK = PASS; exit 0
AUTHORING_BUILD = PASS; exit 0
CLI_SIMULATE_SUITE = PASS; 1 file / 13 tests
STARTER_SIMULATE = PASS; exit 0; pathsExplored=13; cyclesPruned=7; choiceCoverage=2/3; save/load=25; ending=demo_end (12); runtimeErrors=0

SHELL_TYPECHECK_AFTER_INDEPENDENT_TEST_FIX = PASS; exit 0
SHELL_TESTS_AFTER_INDEPENDENT_TEST_FIX = PASS; 22 files / 195 tests
```

### First full-gate result, preserved

第一次 `verify:all` 只执行一次，原始失败 artifact 没有被覆盖：

```text
VERIFY_ALL_FIRST_COMMAND = npm run verify:all
VERIFY_ALL_FIRST_RUN_COUNT = 1
VERIFY_ALL_FIRST_LAST_PASSED_NODE = verify:hygiene
VERIFY_ALL_FIRST_FAILED_NODE = verify:types
VERIFY_ALL_FIRST_ERROR = packages/shell/test/save-store-slot-collision.test.ts(183,12): error TS2532: Object is possibly 'undefined'.
VERIFY_ALL_FIRST_CHILD_EXIT = 2
VERIFY_ALL_FIRST_OUTER_EXIT = NOT_CAPTURED_BEFORE_30S_EXECUTION_WINDOW_ENDED
VERIFY_ALL_FIRST_RESULT = FAILED_AT_UNMODIFIED_SHELL_TYPECHECK
VERIFY_ALL_FIRST_R1_RELEVANCE = OUT_OF_SCOPE_PRE_EXISTING_UNMODIFIED_SHELL_TEST
```

### Recovery full-gate result

独立 Shell 类型修复提交后，按恢复指令只重新执行了一次新的 `verify:all`，并写入新的 artifact 文件。执行回执为：

```text
VERIFY_ALL_RECOVERY_COMMAND = npm run verify:all
VERIFY_ALL_RECOVERY_RUN_COUNT = 1
VERIFY_ALL_RECOVERY_EXIT = 0
VERIFY_ALL_RECOVERY_RESULT = PASS
VERIFY_ALL_RECOVERY_LAST_NODE = verify:diff-check
```

恢复门中实际通过：tools 10/10；renderer boundaries 3/3；renderer legacy 4/4；hygiene 730 paths；全部 workspace typecheck；authoring 20/122、CLI 14/129、Core 24/318、Editor 26/172、Host 11/87、Renderer 49/406、Shell 22/195、Starter 4/7、Zero 4/29；Starter lint 0 errors/4 warnings；Starter simulate 13 paths、7 cycles pruned、25 save/load、0 runtime errors；Zero simulate 259 paths、9 cycles pruned、23/23 choices、367 save/load、0 runtime errors；editor/starter/formal build 均通过；最后 `git diff --check` 通过。

恢复期间没有重跑 R1 RED/GREEN、Authoring、CLI 或 Starter；只执行了恢复指令明确允许的 Shell typecheck、Shell full tests 与一次新的 `verify:all`。

## 5. Artifact identity

唯一 R1 证据根目录：

`C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d`

以下身份均从磁盘回读：

| Artifact | bytes | SHA-256 | result |
|---|---:|---|---|
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d\red-sim-state-vitest.json` | 4014 | `5630CE4A708A1EDC8C9932C444265678D47E5E0E3B93F468228D4F84E4C8F668` | RED; 0 passed / 1 failed |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d\green-sim-state-vitest.json` | 3711 | `75257E0B9A4CAF8FE855044072B64AE316E13859BD1175242A1ECAF1F0EEC6D0` | GREEN; 1 passed / 0 failed |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d\simulation-suite.txt` | 567 | `A8F9991BFB024FDD67C3ED36546DE11796F882B3823B45102EC769AB709D9822` | PASS |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d\authoring-suite.txt` | 1502 | `A2C18EDC90BB9F7964C006810681C1562F27217DB9FF0BC41AB62E017F4655C0` | PASS |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d\cli-simulate.txt` | 569 | `4609073CEA800523931FED4D2E871C3035F63514478C12A16AC8878D5A334525` | PASS |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d\starter-simulate.txt` | 354 | `B18180406E82D3D45EF8F7E0FC9A3008E9A14BFD5A6D7DFF9AF969D3BAB2477C` | PASS |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d\verify-all.txt` | 7170 | `54173314C526242ED81BEEA5897DA189FA6DBDA3E8A59A111C16ED967820D041` | FIRST RUN; preserved failure |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d\shell-typecheck-after-fix.txt` | 70 | `C857562C23D33A2D3D9B7269D2DC4EDEFC7483B65EF7903E3C06E4934CC9FA13` | PASS; exit 0 |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d\shell-tests-after-fix.txt` | 2966 | `16C260CBFF8704E528163B1D60CF923B270D13A3A9D427F62F7F132ACA62D76A` | PASS; 22 files / 195 tests |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-r1-sim-state-593556d6957b4ef89c3ed04e6ac2e11d\verify-all-after-shell-type-fix.txt` | 56272 | `D6D1C04009A891EC5E16346C103EDD9C8A890B4C41CE83B4EA49BD44E2891D71` | RECOVERY PASS; exit 0 |

## 6. Scope and negative claims

R1 生产实现只触及 `packages/authoring/src/simulation.ts`；永久回归只触及 `packages/authoring/test/simulation.test.ts`。恢复全仓类型门的独立测试提交只触及 `packages/shell/test/save-store-slot-collision.test.ts`。没有修改 Core、CLI、Editor、Renderer、Host、Shell 生产代码、Starter、长期路线台账或受保护文件；已知治理/handoff 未跟踪文件均原样保留。

`verify:all` 的恢复绿色只证明当前仓库既有验证门通过，不是人工体验、Electron、浏览器、性能、发行或部署结论。R2～R6 与 Wave 4 均未开始；本轮 Architect Review 已由所有者豁免，当前停止在 Independent Final Review，不能由执行 AI 自动施工。

```text
PUSH = NOT_PERFORMED
DEPLOYMENT = NOT_PERFORMED
RELEASE = NOT_PERFORMED
R2_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
ARCHITECT_REVIEW = WAIVED_BY_OWNER
ARCHITECT_PASS = NOT_CLAIMED
NEXT_STOP = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
```

## 7. Post-closure identity and independent review status

```text
DOCUMENT_CLOSURE_HEAD = 9261d11e96d5927b15310721e8ce8215657c46ae
DOCUMENT_CLOSURE_PARENT = 54e2d73ba7008a9559e50b9aacafac2bae66a350
REMOTE_MAIN_AT_DOCUMENT_CLOSURE_REVIEW = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
AHEAD_BEHIND_AT_DOCUMENT_CLOSURE_REVIEW = 8 0
TRACKED_WORKTREE_AT_DOCUMENT_CLOSURE_REVIEW = CLEAN
STAGING_AREA_AT_DOCUMENT_CLOSURE_REVIEW = EMPTY
ARCHITECT_REVIEW = WAIVED_BY_OWNER
ARCHITECT_PASS = NOT_CLAIMED
INDEPENDENT_FINAL_REVIEW = NEEDS_FIX_DOCS_ONLY
R1_IMPLEMENTATION_STATUS = PASS
NEW_PRODUCTION_RELIABILITY_FINDING = NO
PUSH = NOT_PERFORMED
R2_NOT_STARTED = TRUE
WAVE_4 = PAUSED
NEXT_STOP = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
```
