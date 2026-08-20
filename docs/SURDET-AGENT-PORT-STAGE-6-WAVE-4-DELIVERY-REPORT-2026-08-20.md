# Surdet Agent Port — Stage 6 / Wave 4 Delivery Report

```ini
RESULT = FAILED
EVIDENCE_CLASS = DIAGNOSTIC
RUN_HEAD = 0a712640f600c0955579144f045668e822e39896
CODE_EVIDENCE_HEAD = 0a712640f600c0955579144f045668e822e39896
REMOTE_MAIN = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
AHEAD_BEHIND = 13/0
PUSH = NOT_PERFORMED
FORMAL = NOT_STARTED
NEXT_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

## 1. 交付边界

本轮按 `docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md` 串行执行 Task 0–10。已实施的 Wave 4 范围是：外部桌面 Agent 使用官方 MCP v2 stdio client 连接真实 `packages/cli/dist/agent-port/main.js`；Authoring registry 是领域语义来源；MCP 只做 typed projection、session/policy 绑定、证据和 delivery capsule 适配。

没有修改 Core、Renderer、Host、Shell、Editor、Starter、Zero 生产逻辑；没有内置 AI、HTTP server、Git 自动化、音频、性能、扩展市场、发行、部署或 Wave 5；没有 push。

Task 1–8 的实现、测试与普通本地提交已完成。Task 9 runner 已提交；Task 10 的唯一 `verify:all` 通过，但有界 DIAGNOSTIC 三次均未通过，因此依任务书停止，未运行 FORMAL，也没有宣布 Wave 4 ready 或 CLOSED。

## 2. 已验证事实

- registry、共享 envelope/error、observe/stage/apply dispatcher、单项目 session/resume/policy、官方 MCP tool projection、invocation ledger、delivery capsule 和安全反向测试均通过各自聚焦合同。
- Task 9 使用官方 `@modelcontextprotocol/client` 与 `StdioClientTransport`，入口固定为 `packages/cli/dist/agent-port/main.js`；通过 `versionNegotiation: { mode: 'auto' }` 与真实 `legacy: 'reject'` launcher 协商。
- preflight 通过：initialize、tools/list、只读 inspect、policy filter、stdout protocol purity、stderr banner 和 child cleanup 均通过。
- Task 10 冻结前聚焦回读通过：Authoring 22 files / 132 tests，CLI 20 files / 171 tests，两个 workspace typecheck/build 和 runner syntax 均 exit 0。
- `npm run verify:all` 只运行一次，exit 0。

未验证：真实外部 Agent 的低上下文可用性、Editor/预览可见体验、项目所有者人工判断。由于 DIAGNOSTIC 失败，不能把这些后置门写成通过。

## 3. 真实命令与结果

```text
node --check packages/cli/e2e/agent-port-wave-4.e2e.mjs                         exit 0
node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight              exit 0
npm run test -w @surdet/authoring                                             exit 0; 22 files / 132 tests
npm run test -w @surdet/cli                                                   exit 0; 20 files / 171 tests
npm run typecheck -w @surdet/authoring                                        exit 0
npm run typecheck -w @surdet/cli                                              exit 0
npm run build -w @surdet/authoring                                             exit 0
npm run build -w @surdet/cli                                                   exit 0
npm run verify:all                                                             exit 0; run count = 1
npm run test -w @surdet/cli -- test/agent-port-tools.test.ts                  exit 1; RED for capabilities.describe output schema
npm run test -w @surdet/cli -- test/agent-port-tools.test.ts                  exit 0; 5 tests after first repair
npm run test -w @surdet/cli -- test/agent-port-tools.test.ts                  exit 1; RED for nested timeline details schema
npm run test -w @surdet/cli -- test/agent-port-tools.test.ts                  exit 0; 6 tests after second repair
npm run test -w @surdet/authoring                                             exit 0; 22 files / 132 tests after repairs
npm run typecheck -w @surdet/authoring                                        exit 0
npm run typecheck -w @surdet/cli                                              exit 0
npm run build -w @surdet/authoring                                             exit 0
npm run build -w @surdet/cli                                                   exit 0
```

诊断运行次数严格为 3；第 3 次失败后没有重跑、没有运行 FORMAL、没有修改剩余缺陷。

## 4. DIAGNOSTIC 失败证据

### Attempt 1

```ini
RUN_HEAD = 6107a3fe48de9dd619d10f8871d47e78f899a620
EXIT = 1
FIRST_FAILED_NODE = stage-connect-and-discover / surdet_capabilities_describe
FAILURE = MCP output validation rejected registry metadata JSON Schema and the mcpTool field; structuredContent was absent
ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-Wdr0lC\evidence.json
ARTIFACT_BYTES = 740
ARTIFACT_SHA256 = 16E809B9FD2F0CA0277FE822297D281422C5B7FEDCFB53628F5CF11537D090
IDENTITY_READBACK = PASS
```

证据驱动的最小修复已提交为 `ca1ab808faee0e25b3c51dd44565ca9935d49d3b`，只修改 Authoring capability summary schema 与对应 MCP regression。

### Attempt 2

```ini
RUN_HEAD = ca1ab808faee0e25b3c51dd44565ca9935d49d3b
EXIT = 1
FIRST_FAILED_NODE = stage-connect-and-discover / surdet_object_inspect timeline
FAILURE = MCP output validation rejected nested timeline details; structuredContent was absent
ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-vC7Diz\evidence.json
ARTIFACT_BYTES = 726
ARTIFACT_SHA256 = BB924C244502C72A20D6267237BC4DE36E7CEFECA9F33E9CBCEE5823BE3B610B
IDENTITY_READBACK = PASS
```

证据驱动的最小修复已提交为 `0a712640f600c0955579144f045668e822e39896`，加入复杂 timeline inspection details 的 MCP regression，并将该 metadata 字段放宽为 JSON object。

### Attempt 3 — 最终停止

```ini
RUN_HEAD = 0a712640f600c0955579144f045668e822e39896
EXIT = 1
FIRST_FAILED_NODE = stage-connect-and-discover / surdet_object_inspect config:entryScene
FAILURE = MCP output validation still requires object details, but config:entryScene details is a scalar string
ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-giII4f\evidence.json
ARTIFACT_BYTES = 726
ARTIFACT_SHA256 = A205F9BC2A2E6A78EBF8DE5120A58C08901826E6C564791089FC9BFE450D354B
IDENTITY_READBACK = PASS
DIAGNOSTIC_BUDGET = 3/3
FORMAL = NOT_STARTED
```

这是当前未解决的 Wave 4 Authoring MCP output-schema 缺口，不是 runner 的协议连接错误。任务书规定第三次诊断失败后停止；本报告不把未运行的 FORMAL、外部 Agent 或 Owner Editor 验收写成通过。

## 5. 提交链与范围

```text
6107a3fe48de9dd619d10f8871d47e78f899a620  test(cli): prove agent port vertical slice
  packages/cli/e2e/agent-port-wave-4.e2e.mjs

ca1ab808faee0e25b3c51dd44565ca9935d49d3b  fix(cli): validate capability metadata output
  packages/authoring/src/capability-registry.ts
  packages/cli/test/agent-port-tools.test.ts

0a712640f600c0955579144f045668e822e39896  fix(cli): preserve structured object inspection
  packages/authoring/src/capability-registry.ts
  packages/cli/test/agent-port-tools.test.ts
```

此前 Task 1–8 的提交链保留在任务书 Ledger；本轮没有 amend、rebase、squash、reset 或改写历史。当前最后代码证据 HEAD 是 `0a712640f600c0955579144f045668e822e39896`，文档闭合提交的 parent 是该 HEAD。

## 6. 停止时 Git 与后续边界

```ini
BRANCH = main
HEAD = 0a712640f600c0955579144f045668e822e39896
HEAD_PARENT = ca1ab808faee0e25b3c51dd44565ca9935d49d3b
REMOTE_MAIN = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
AHEAD_BEHIND = 13/0
CODE_WORKTREE = CLEAN
STAGING_AREA = EMPTY
TASKBOOK = MODIFIED_FOR_FAILURE_LEDGER_ONLY
DIAGNOSTIC_ARTIFACTS = PRESERVED_UNTRACKED
PROTECTED_GOVERNANCE_UNTRACKED = PRESERVED_NOT_STAGED
PUSH = NOT_PERFORMED
DEPLOYMENT = NOT_PERFORMED
RELEASE = NOT_PERFORMED
WAVE_5 = NOT_STARTED
REAL_EXTERNAL_AGENT_ACCEPTANCE = NOT_STARTED
OWNER_EDITOR_ACCEPTANCE = NOT_STARTED
WAVE_4_STATUS = BLOCKED_AT_DIAGNOSTIC_BUDGET_EXHAUSTED
NEXT_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

本报告和任务书 Ledger 的文档提交只用于保留失败事实与停止状态；不会把当前 Wave 4 标记为 `FORMAL_PASSED`、`READY_FOR_ARCHITECT_REVIEW` 或 `CLOSED`。后续若继续，须由独立复审决定是否授权修复 `object.inspect.details` 的 scalar/JSON schema 并开启新的有界诊断预算。
