PRE-WAVE_4_RELIABILITY_FRESH_GATE_COMPLETED — FINDINGS_REPRODUCED_5; N7_SOURCE_CONTRACT_CONFIRMED; PRODUCTION_FIXES_NOT_STARTED; WAVE_4_IMPLEMENTATION_PAUSED; WAITING_FOR_INDEPENDENT_MANAGER_REVIEW

# Pre-Wave 4 Reliability Fresh Gate Delivery Report

日期：2026-08-20
范围：严格执行 `docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md` 的 Task 0～Task 9 前置取证链；本报告只陈述 Fresh Gate 证据，不实施任何 finding 修复。

## 一、总裁决

五项动态合同 finding 获得匹配症状的 Fresh Gate 证据：

```text
SIM-STATE-1_REPRODUCED
TX-COMMIT-POSTREPLACE_REPRODUCED
A7_FULL_CHAIN_REPRODUCED
M1_GENERIC_START_REENTRANCY_REPRODUCED
N4_PAIRED_SEMANTIC_GAP_REPRODUCED
```

N7 没有运行概率性 kill/copy 实验；在真实 `win32` 平台、当前 fallback 源码和 Node 官方原语合同三者一致的前提下确认：

```text
N7_SOURCE_CONTRACT_CONFIRMED
N7_FIX_ALGORITHM = NOT_DECIDED_IN_FRESH_GATE
REQUIRES_SEPARATE_WINDOWS_REPLACEMENT_DESIGN = TRUE
PROBABILISTIC_CRASH_TEST = NOT_RUN_BY_DESIGN
REAL_PROJECT_FILES_TOUCHED = NO
```

以上是诊断裁决，不是 `FIXED`、`CLOSED` 或 `FORMAL_PASSED`。生产修复尚未开始，Wave 4 implementation 继续暂停。

## 二、基线与执行边界

```text
BRANCH = main
HEAD_AT_GATE_START = 23c24f85a4de44ce7f6e6dd0f69f6f75dd03b47b
LOCAL_TRACKING_SURDET_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
AHEAD_BEHIND_AT_GATE_START = 3 0
GATE_ROOT = <local-path>
NODE = v24.15.0
NPM = 11.12.1
PWSH = 7.6.5
```

本轮按 Task 0～Task 9 串行推进；报告生成时已完成 Task 0～Task 8，Task 9 仅允许对任务书与本报告做 docs-only 本地提交。没有运行 Wave 4、`verify:all`、Electron、浏览器、性能矩阵、打包、部署、发行或音频聚合。没有修改生产源码、配置、资产、Starter、既有正式测试、长期路线台账或受保护文件。

## 三、逐项 Gate 证据

### SIM-STATE-1

临时测试的合同是：不同 caller 到达相同 position/variables 时，完整控制流状态不能被错误合并，第二条真实错误路径必须被看到。

```text
command = npm run test -w @surdet/authoring -- __fresh-gate-sim-state.test.ts --reporter=json --outputFile="<gateRoot>\sim-state-1-vitest.json"
exitCode = 1
firstFailure = AssertionError: expected 'passed' to be 'failed'
classification = SIM_STATE_1_REPRODUCED
```

实际 simulation report 为 `status = passed`，与预期 `failed` 不同，证明当前状态签名剪枝了第二条错误路径。

### TX-COMMIT-POSTREPLACE

临时测试注入 replacement 完成后的 cleanup/recovery 边界，禁止出现项目已改变、commit 抛错而记录仍为 `OPEN` 的三联态。

```text
command = npm run test -w @surdet/authoring -- __fresh-gate-tx-postreplace.test.ts --reporter=json --outputFile="<gateRoot>\tx-postreplace-vitest.json"
exitCode = 1
firstFailure = AssertionError: expected { threw: true, …(2) } to not deeply equal { threw: true, …(2) }
observedTriple = { threw: true, projectChanged: true, status: 'OPEN' }
classification = TX_COMMIT_POSTREPLACE_REPRODUCED
```

本轮没有选择回滚、完成提交或吞掉 cleanup error 的修复方向。

### N7-WINDOWS-REPLACEMENT

本机身份为 `win32`。当前 `packages/cli/src/authoring/node-project-storage.ts` 在 `rename` 遇到 `EEXIST/EPERM` 后执行覆盖式 `copyFile(staged, target)`，再删除 staged 文件。Node 官方文档规定 `fsPromises.copyFile()` 默认覆盖目标，且不保证 copy 操作的原子性；因此本项是平台原语合同确认，不是动态 crash 损坏复现：[Node.js fsPromises.copyFile documentation](https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode)。

### A7-INVALID-CONFIG

Authoring 与 Editor 两条链均按任务书各运行一次：

```text
authoringExitCode = 1
authoringFirstFailure = Error: promise resolved "{ …(10) }" instead of rejecting
authoringClassification = A7_AUTHORING_REPRODUCED

editorExitCode = 1
editorFirstFailure = AssertionError: expected [Function] to throw an error
editorClassification = A7_EDITOR_REPRODUCED

classification = A7_FULL_CHAIN_REPRODUCED
```

这证明 Authoring 对 syntactically valid 的非 object 顶层配置未 fail-loud，且 Editor 对 array 顶层配置的变量保存入口未 fail-loud。

### M1-GENERIC-START-REENTRANCY

临时测试在 `clear` 回调中 `start()` 新场景，并要求目标场景从 instruction zero 执行。

```text
command = npm run test -w @surdet/core -- __fresh-gate-m1-generic-start.test.ts --reporter=json --outputFile="<gateRoot>\m1-generic-start-vitest.json"
exitCode = 1
firstFailure = AssertionError: expected [ '第二条' ] to deeply equal [ '第一条' ]
classification = M1_GENERIC_START_REENTRANCY_REPRODUCED
```

观察到的是目标场景的第二条文本，符合任务书指定症状。

### N4-SCHEDULED-WHEN-LINT

先运行既有 Runtime oracle，再运行 CLI 临时测试：

```text
runtimeCommand = npm run test -w @surdet/core -- event-scheduler.test.ts -t "条件求值严格策略" --reporter=json --outputFile="<gateRoot>\n4-runtime-oracle.json"
runtimeExitCode = 0
runtimeResult = numPassedTests=1, numFailedTests=0
runtimeClassification = N4_RUNTIME_STRICT_PASS

cliCommand = npm run test -w @surdet/cli -- __fresh-gate-n4-scheduled-when.test.ts --reporter=json --outputFile="<gateRoot>\n4-cli-lint.json"
cliExitCode = 1
cliFirstFailure = AssertionError: expected false to be true // Object.is equality
cliClassification = N4_CLI_LINT_REPRODUCED

classification = N4_PAIRED_SEMANTIC_GAP_REPRODUCED
```

Runtime 对未声明变量保持严格抛错，但 CLI 对 `events.json` 的 `scheduled[].when = "ghost > 0"` 没有产生 V002，构成 paired semantic gap。

## 四、Artifact 身份

所有 artifact 均位于本轮唯一系统临时目录，未删除、未筛选、未进入 Git：

| Artifact | bytes | SHA-256 |
|---|---:|---|
| `<local-path>` | 1283 | `C46774EDE4C4B5DE46AB24D58198BAC7B8D28FF886A5C97F73E3764C21E57223` |
| `<local-path>` | 1309 | `9360BDE7095470B5ADD5C9CB998D6CA16113ABC60C542030DF00D1154E6C2623` |
| `<local-path>` | 1811 | `6C7ACA4D7FD3ADCBA96B3F71C6D56002219A96F44939B960E3CA0748A2DE5974` |
| `<local-path>` | 1848 | `40A661374E12B59D660E99700E5A91DD958E829BBED7785EE3D1136CB98BFDB8` |
| `<local-path>` | 1900 | `B8CAEE1652AEC096969B7FCB24BF1B9A9CFB22E3E175C4AA7353C03E94B9BDF0` |
| `<local-path>` | 2806 | `D117922A0625586DC51AB10F64A0B32CE886BD920D1CA3AC52A6A2D4CCD51B72` |
| `<local-path>` | 1865 | `39BACDA17AFF30CEAB1E5710D6CA4AD3AFC24FA2BD112B6A04AD56F314600793` |

## 五、源码身份

以下是从磁盘回读的相关源码身份；本轮没有修改这些文件。

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `packages/authoring/src/simulation.ts` | 11958 | `ABD8ADA43A1B5682A4B88F2F8311306AF96890911C026881858586A71611AC26` |
| `packages/authoring/src/change-session.ts` | 12068 | `EF181C68172482FA7E3A6B88D50779478C02B067C9A88DF92FCC14940FC4C0CE` |
| `packages/authoring/src/project-snapshot.ts` | 3471 | `A792131D360473BA50E3AE0F0F5E94E86A01F6908F95176B0718B2189EDFFE19` |
| `packages/authoring/src/config-operations.ts` | 15349 | `9B09AC7F50572D331670655ADF7A5BD2C87F527687E0CBD302061664F3120E70` |
| `packages/core/src/runtime/interpreter.ts` | 46567 | `EC5FDABCE9A74B5C543A55F43DA633AB58B671B373A4E3BD98CEF7377F0F9679` |
| `packages/core/src/systems/event-scheduler.ts` | 4594 | `E7B7BA35590391A68D03DB730D37269C45B3C0C1BF8070C770527502E28AA6D0` |
| `packages/core/test/event-scheduler.test.ts` | 4918 | `E59CD884EF68D2669DC75918A6192551FC0C0BC0EFABC55AD04085D9D8704EAE` |
| `packages/cli/src/lint.ts` | 24336 | `4A607AAE925F18D28DECD926743AFC3C806A494D0964DFD718ED96662EEF7C12` |
| `packages/cli/src/authoring/node-project-storage.ts` | 13865 | `615814F547A28DC478F628C31B27FA1B714589B58E4FCAEE01AD924FE90C7CF8` |
| `packages/editor/src/config-edit.ts` | 26648 | `DEEC923FF465B70944EBACE6572A1594C27C1B486DBDA47D7943913B1AC004A4` |
| `packages/editor/src/project-io.ts` | 16703 | `B091F03915722965913BFD78596F7E977E6E5D250419D19B4AD920FFC6A90AB1` |

## 六、临时文件、范围和 Git 状态

```text
TEMPORARY_DIAGNOSTIC_TESTS = six taskbook paths; all absent after readback
PRODUCTION_SOURCE_CHANGES = NONE
EXISTING_FORMAL_TEST_CHANGES = NONE
STARTER_CHANGES = NONE
ROADMAP_CHANGES = NONE
PROTECTED_FILE_CHANGES = NONE
ARTIFACTS_IN_REPOSITORY = NONE
TRACKED_LOGS = NONE
```

报告生成前的真实 Git 状态为：

```text
HEAD = 23c24f85a4de44ce7f6e6dd0f69f6f75dd03b47b
REMOTE_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
AHEAD_BEHIND = 3 0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
DIFF_CHECK = PASS
CACHED_DIFF_CHECK = PASS
```

本轮最终普通本地提交只允许包含本任务书 Execution Ledger 与本报告；不得包含临时测试、artifact、日志、长期台账、handoff、AGENTS 或受保护文件。`PUSH = NO`。

## 七、后置 backlog 与后续队列

`M2-TINT-RESTORE` 与 `N9-EDITOR-CLI-W007` 本轮不创建测试、不修改 Renderer/Editor 可达性实现，仅保留为 post-backlog。Wave 4 不得因本报告自动启动。

建议由总经理逐项开具独立修复任务书的固定顺序如下；这只是队列，不是本轮或下一步的施工授权：

```text
R1 SIM-STATE-1
R2 TX-COMMIT-POSTREPLACE
R3 N7-WINDOWS-REPLACEMENT（先设计，再实现）
R4 A7-INVALID-CONFIG
R5 M1-GENERIC-START-REENTRANCY
R6 N4-SCHEDULED-WHEN-LINT
```

每个 R 项都应独立完成最小修复、聚焦绿灯、普通本地提交和独立复审；执行 AI 不得自行进入 R1。

## 八、停止点

```text
PRE_WAVE_4_RELIABILITY_FRESH_GATE_COMPLETED
FINDINGS_REPRODUCED_5
N7_SOURCE_CONTRACT_CONFIRMED
PRODUCTION_FIXES_NOT_STARTED
WAVE_4_IMPLEMENTATION_PAUSED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
```
