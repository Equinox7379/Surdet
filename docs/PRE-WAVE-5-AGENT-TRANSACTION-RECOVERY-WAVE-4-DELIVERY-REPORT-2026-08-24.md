PRE_WAVE_5_AGENT_TRANSACTION_RECOVERY_WAVE_4_VERIFIED — CROSS_PROCESS_CAS_PASSED; LOCAL_LEASES_PASSED; PROJECT_COMMIT_SERIALIZED; EXPLICIT_RECOVERY_PASSED; FORMAL_PASSED; WAITING_FOR_INDEPENDENT_MANAGER_REVIEW; NOT_PUSHED; WAVE_5_NOT_STARTED

# Pre-Wave 5 Agent Transaction Recovery Wave 4 交付报告

日期：2026-08-24
项目：Surdet
范围：本地多 Agent 事务、跨进程并发、lease、提交串行化、显式恢复与 Agent Port 公开合同

## 1. 结论与未声明边界

### AUTOMATED_FACTS

本轮已建立并验证：

- Change Store V2 的 `recordVersion` compare-and-swap；
- 同一 change 的跨进程写入不会静默覆盖成功结果；
- change/project 两级本地 lease，以及 live、orphan、foreign-host、corrupt 边界；
- 不同 change 的 project commit 串行化；
- STAGING、REPLACING、COMMITTED-journal 和 unexpected-bytes 四类显式恢复；
- Agent Port 中可发现、可执行、可审计的恢复能力；
- 一份与冻结代码 HEAD 完全一致的 FORMAL artifact。

唯一一次 Task 10 `verify:all` 和唯一一次 FORMAL 均通过。本轮没有 push、部署、打包、发行或进入 Wave 5。

### REASONABLE_INFERENCES

这些证据支持“当前本地单机、多进程 Agent 创作事务在已覆盖的崩溃与竞争窗口中不会静默丢失成功结果，并能对已知恢复状态采取确定性动作”。它不等价于分布式数据库、网络文件系统或多主机共享目录保证。

### UNVERIFIED_CLAIMS

- 未验证跨主机自动接管；当前合同明确 fail-loud 并要求人工恢复。
- 未验证网络盘、容器共享卷或远程文件系统语义。
- 未进行性能资格化、Electron 矩阵、视觉/声音/交互验收。
- 未声明 Wave 5 已授权或开始。

## 2. 真实 Git 基线与提交链

本轮任务以远端跟踪基线 `00255f64916d412f20b57ba0954eea8c7b63b26e` 为远端锚点。最终代码证据 HEAD：

```text
CODE_EVIDENCE_HEAD=6c3a10230968d6abd8b0da7ca30308b7c95f6c4d
REMOTE_MAIN=00255f64916d412f20b57ba0954eea8c7b63b26e
PRE_DOCUMENT_CLOSURE_AHEAD_BEHIND=22/0
```

关键实现/证据提交：

- `85a13d3` — Change Store V2 与 CAS；
- `7597ac4` — change/project 本地 lease；
- `51a47f6` — 同 change 跨进程写入串行；
- `7751efb` — project commit 边界串行；
- `2ac01e8` — 共享显式事务恢复语义；
- `4b69cbd` — Node fresh-process recovery service；
- `0d3421e` — Agent Port 恢复合同；
- `e193864` — 共享显式 runtime evidence；
- `c42c048` — 隔离事务 runtime fixture；
- `5387c28` — commit conflict 修复动作；
- `fa0a31c` / `6c22115` — recovery fixture 与聚焦取证设施修正；
- `6f61493` — Task 9 证据冻结 Ledger；
- `6c3a102` — 永久 CLI 合同与当前 22 项 capability 对齐。

历史 DIAGNOSTIC 失败均保留，未删除、覆盖或筛选。

## 3. Task 1 RED

旧实现的真实双进程 RED 证明两个 child 都可返回成功，但最终 working change 丢失其中一个成功操作，属于 last-write-wins 静默覆盖。

```text
path=C:\Users\Equinox\AppData\Local\Temp\surdet-agent-transaction-wave4-14691285e1fd4ac584f3d8c38fa63652\task1-red.json
bytes=1278
sha256=A1FDD5FA21CFA50AC86161FEDB2A5EA85FECA67830810FA576FDEA1605750EF8
```

该 RED 与后续 GREEN 使用同一跨进程业务症状：两个真实进程操作同一 change，并核对双方成功结果是否都进入工作快照与事实记录。

## 4. Change Store V2 / CAS

V2 manifest、head 与 change record 引入显式格式和版本字段。写入使用 expected `recordVersion`，冲突返回确定性 `CHANGE_RECORD_CONFLICT`，调用方以相同 `operationId` 重新打开并重试，不会重复增加 workingRevision。

FORMAL 同 change 证据：

```text
operations=runner-same-a,runner-same-b
recordVersions=0,1,2
workingRevision=2
mutationWindowsOverlap=true
```

两项成功 mutation 均保留，调用事实顺序可读。

## 5. Lease 与接管

本轮使用 change/project 两级本地 lease，并验证：

```text
liveBlocked=true
orphanTakenOver=true
foreignHostBlocked=true
corruptBlocked=true
released=true
```

foreign-host 和 corrupt lock 不自动删除或接管；orphan 仅在短测试时钟、同主机且旧 PID 不存活时进入受控 quarantine/接管路径。

## 6. Project commit 串行化

不同 change 可以并行 stage，但 project replacement 由 project lease 串行。FORMAL 中两个 commit 请求窗口重叠：

- winner 最终 `COMMITTED`；
- loser 首次收到 `PROJECT_BUSY`，`retryDisposition=after-refresh`；
- loser 按公开修复动作调用 `session.describe`；
- 唯一一次恢复提交返回 `PROJECT_CHANGED_SINCE_BEGIN`；
- loser 终态 `STALE`；
- 最终项目树只包含 winner 的明确成功结果。

replacement 内部最大并发为 1 由 `multi-process-change-concurrency.test.ts` 的事件序列合同证明；聚合 artifact 只声明其真实可观察的外部结果。

## 7. Journal / Recovery

FORMAL 四态矩阵：

| Fixture | Inspect disposition | Execute | 最终状态 |
|---|---|---|---|
| STAGING + base | `REOPEN_OPEN` | 成功 | `OPEN` |
| REPLACING mixed-known | `ROLL_BACK_TO_BASE` | 成功 | `OPEN` |
| COMMITTED journal + OPEN record | `FINALIZE_COMMITTED` | 成功 | `COMMITTED` |
| unexpected bytes | `MANUAL_RECOVERY_REQUIRED` | `RECOVERY_AMBIGUOUS` | `OPEN` |

unexpected-bytes 分支还证明 project bytes 与 recovery state 均未被自动改写；MCP 只追加两条真实 invocation facts（inspect 成功、execute 失败），没有把审计记录误判为恢复状态变化。

## 8. Agent Port / MCP

Capability registry 现在包含 22 项能力，其中恢复能力为：

- `change.recovery.inspect`；
- `change.recovery.execute`。

FORMAL 证明 inspect 对 stage/apply 可见；execute 在 stage policy 下被阻断，在 apply policy 下成功；文本投影与 `structuredContent` 保持完整同值 envelope。`change.commit` 的公开可能错误包含 `CHANGE_BUSY` 与 `PROJECT_BUSY`，并提供可执行的 `session.describe` 修复动作。

## 9. 测试与 verify

Task 10 聚焦总门：

- Authoring 聚焦：5 files / 29 tests PASS；
- Authoring 全量：23 files / 153 tests PASS；
- CLI 事务聚焦：8 files / 45 tests PASS；
- CLI 全量：27 files / 205 tests PASS；
- Authoring/CLI typecheck 与 build：PASS；
- runner `node --check` 与 preflight：PASS。

首次 CLI 全量门发现四个永久测试合同过时：三个仍固定 20 项 capability，另一个把空的 lease 基础目录误当成 change 数据。修正只涉及四个 CLI 测试文件；没有修改事务、lease、commit 或 recovery 生产语义。

唯一 Task 10 全量门：

```text
command=npm run verify:all
exit=0
lastNode=verify:diff-check
log=C:\Users\Equinox\AppData\Local\Temp\surdet-agent-transaction-wave4-task10-b559065574e04c1ba19d359ba3de2015\task10-verify-all.log
bytes=64224
sha256=166FF47DFCF252BFC31C6C016B096F47157D4B06D48EC7CF9DD7B16C87482C73
```

没有运行 recovery `verify:all`。

## 10. DIAGNOSTIC / FORMAL artifact

最终通过 DIAGNOSTIC：

```text
path=C:\Users\Equinox\AppData\Local\Temp\surdet-agent-transaction-wave4-jyMzfy\diagnostic\evidence.json
bytes=101956
sha256=859B1E50B7BDEE0A7B79E417622E5FE3CF2531946D476F1CC251338AC9F4A476
status=PASSED
runHead=6c22115645df537e42722088e5e897cb07398ef8
```

唯一 FORMAL：

```text
evidence=C:\Users\Equinox\AppData\Local\Temp\surdet-agent-transaction-wave4-bEOuOl\formal\evidence.json
evidenceBytes=101963
evidenceSha256=29503F3C718633840ED40CB2DF987F2C19C0D92BB9551F62B4746A847EFDB2D3
identity=C:\Users\Equinox\AppData\Local\Temp\surdet-agent-transaction-wave4-bEOuOl\formal\identity.json
identityBytes=218
identitySha256=7B4E4ADDB6BC7A8D7A9DF584CC34360D81645AB7CA920CD2781CA4B21E07BCC1
status=PASSED
evidenceClass=FORMAL
runHead=6c3a10230968d6abd8b0da7ca30308b7c95f6c4d
```

FORMAL 错误通道为空；14/14 child 退出；timer 停止；活动 lease 为 0；原始 Starter 保持 37 files / 6,705,750 bytes / SHA-256 `8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6`。

## 11. 未解决问题与 out-of-scope

本轮范围内没有已知 Blocker、High 或 Medium 未解决问题。

明确延期：

- 多主机或网络文件系统协调；
- 分布式锁；
- 性能资格化；
- Electron/视觉/声音/手感；
- 发布、部署和 Wave 5。

历史 DIAGNOSTIC 失败反映了 runner fixture、运行时宿主接线、MCP conflict 修复动作与 recovery 取证边界的逐步收敛，均保留在 Taskbook Ledger，不能改写成生产恢复失败。

## 12. 最终 Git 与停止状态

在文档闭合提交前：

```text
branch=main
CODE_EVIDENCE_HEAD=6c3a10230968d6abd8b0da7ca30308b7c95f6c4d
REMOTE_MAIN=00255f64916d412f20b57ba0954eea8c7b63b26e
HEAD_REMOTE_AHEAD_BEHIND=22/0
tracked production/test/runner=clean
staging=empty
push=NOT_PERFORMED
```

现有未跟踪治理、受保护文件、handoff 和 CLI 历史 artifacts 均未暂存、未提交、未删除。

最终停止状态：

```text
PRE_WAVE_5_AGENT_TRANSACTION_RECOVERY_WAVE_4_VERIFIED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
OWNER_ACCEPTANCE_NOT_APPLICABLE_TO_AUTOMATED_TRANSACTION_GATE
NOT_PUSHED
WAVE_5_NOT_STARTED
```
