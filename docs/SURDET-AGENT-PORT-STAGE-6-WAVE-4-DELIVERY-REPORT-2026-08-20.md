# Surdet Agent Port — Stage 6 / Wave 4 Delivery Report

```ini
RESULT = FAILED
EVIDENCE_CLASS = DIAGNOSTIC
RUN_HEAD = ba22c488f045621909432114d68b4a0ea121aff3
CODE_EVIDENCE_HEAD = ba22c488f045621909432114d68b4a0ea121aff3
REMOTE_MAIN = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
AHEAD_BEHIND = 16/0
PUSH = NOT_PERFORMED
FORMAL = NOT_STARTED
NEXT_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

## 1. 交付边界

本轮按 `docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md` 串行执行 Task 0–10。已实施的 Wave 4 范围是：外部桌面 Agent 使用官方 MCP v2 stdio client 连接真实 `packages/cli/dist/agent-port/main.js`；Authoring registry 是领域语义来源；MCP 只做 typed projection、session/policy 绑定、证据和 delivery capsule 适配。

没有修改 Core、Renderer、Host、Shell、Editor、Starter、Zero 生产逻辑；没有内置 AI、HTTP server、Git 自动化、音频、性能、扩展市场、发行、部署或 Wave 5；没有 push。

Task 1–8 的实现、测试与普通本地提交已完成。Task 9 runner 已提交；Task 10 的历史唯一 `verify:all` 通过，但原有三次 DIAGNOSTIC 均未通过。经本轮独立授权，只对 `object.inspect.details` 的 string/object 输出合同进行了最小修复；新的代码证据提交后 preflight 通过，但恢复预算中的第 1 次 DIAGNOSTIC 在 `stage-connect-and-discover` 首节点失败，因此本报告仍停止在失败状态，未运行 recovery `verify:all` 或 FORMAL，也没有宣布 Wave 4 ready 或 CLOSED。

## 2. 已验证事实

- registry、共享 envelope/error、observe/stage/apply dispatcher、单项目 session/resume/policy、官方 MCP tool projection、invocation ledger、delivery capsule 和安全反向测试均通过各自聚焦合同。
- Task 9 使用官方 `@modelcontextprotocol/client` 与 `StdioClientTransport`，入口固定为 `packages/cli/dist/agent-port/main.js`；通过 `versionNegotiation: { mode: 'auto' }` 与真实 `legacy: 'reject'` launcher 协商。
- preflight 通过：initialize、tools/list、只读 inspect、policy filter、stdout protocol purity、stderr banner 和 child cleanup 均通过。
- Task 10 历史冻结前聚焦回读通过：Authoring 22 files / 132 tests，CLI 20 files / 171 tests，两个 workspace typecheck/build 和 runner syntax 均 exit 0。本轮恢复聚焦回归也通过：Authoring capability-registry 3 tests、CLI agent-port-tools 6 tests，两个 workspace typecheck/build 均 exit 0。
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
npm run test -w @surdet/authoring -- test/capability-registry.test.ts         exit 0; 3 tests
npm run test -w @surdet/cli -- test/agent-port-tools.test.ts                   exit 1; pre-rebuild readback hit stale @surdet/authoring/dist
npm run typecheck -w @surdet/authoring                                             exit 0
npm run build -w @surdet/authoring                                                 exit 0
npm run test -w @surdet/cli -- test/agent-port-tools.test.ts                   exit 0; 6 tests
npm run typecheck -w @surdet/cli                                                 exit 0
npm run build -w @surdet/cli                                                     exit 0
node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight                  exit 0
node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode diagnostic                exit 1; recovery first failed node recorded below
```

历史诊断运行次数为 3；本轮恢复预算只运行 1 次。恢复 DIAGNOSTIC 失败后没有重跑、没有运行 recovery `verify:all`、没有运行 FORMAL，也没有修改 runner 或其它缺陷。

## 4. DIAGNOSTIC 失败证据

### Attempt 1

```ini
RUN_HEAD = 6107a3fe48de9dd619d10f8871d47e78f899a620
EXIT = 1
FIRST_FAILED_NODE = stage-connect-and-discover / surdet_capabilities_describe
FAILURE = MCP output validation rejected registry metadata JSON Schema and the mcpTool field; structuredContent was absent
ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-Wdr0lC\evidence.json
ARTIFACT_BYTES = 740
ARTIFACT_SHA256 = 16E809B9FD2F0CA0277FE822297D281422C5C5B7FEDCFB53628F5CF11537D090
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

这是历史第三次诊断时未解决的 Wave 4 Authoring MCP output-schema 缺口，不是 runner 的协议连接错误。任务书当时规定第三次诊断失败后停止；该历史记录不把未运行的 FORMAL、外部 Agent 或 Owner Editor 验收写成通过。

### 本轮恢复 — `object.inspect.details` schema 合同

```ini
RECOVERY_AUTHORIZATION = OWNER_AUTHORIZED_TASK_10_DETAILS_SCHEMA_ONLY
RECOVERY_ALLOWED_FILES = packages/authoring/src/capability-registry.ts; packages/cli/test/agent-port-tools.test.ts; current Wave 4 taskbook/report
RECOVERY_RED_COMMAND = npm run test -w @surdet/cli -- test/agent-port-tools.test.ts
RECOVERY_RED_EXIT = 1
RECOVERY_RED_RESULT = 6 tests / 1 failed; real MCP config:entryScene scalar details rejected by object-only schema
RECOVERY_GREEN_AUTHORING_FOCUSED = npm run test -w @surdet/authoring -- test/capability-registry.test.ts ; EXIT_CODE=0 ; 3 tests passed
RECOVERY_GREEN_CLI_FOCUSED = npm run test -w @surdet/cli -- test/agent-port-tools.test.ts ; EXIT_CODE=0 ; 6 tests passed
RECOVERY_DETAILS_COVERAGE = config:entryScene string; timeline nested object; scene:start details omitted
RECOVERY_SCHEMA = inspection details oneOf string/object; whole envelope and jsonValueSchema unchanged
RECOVERY_TYPECHECK_AUTHORING = EXIT_CODE=0
RECOVERY_BUILD_AUTHORING = EXIT_CODE=0
RECOVERY_TYPECHECK_CLI = EXIT_CODE=0
RECOVERY_BUILD_CLI = EXIT_CODE=0
RECOVERY_CODE_COMMIT = ba22c488f045621909432114d68b4a0ea121aff3
RECOVERY_CODE_COMMIT_PARENT = 90f413f8bf2539a70eca8ed18bebd816c22cc5f2
RECOVERY_CODE_COMMIT_SCOPE = packages/authoring/src/capability-registry.ts; packages/cli/test/agent-port-tools.test.ts
RECOVERY_PREFLIGHT = node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight ; EXIT_CODE=0
RECOVERY_DIAGNOSTIC_RUN_HEAD = ba22c488f045621909432114d68b4a0ea121aff3
RECOVERY_DIAGNOSTIC_EXIT = 1
RECOVERY_DIAGNOSTIC_LAST_PASSED_NODE = none
RECOVERY_DIAGNOSTIC_FIRST_FAILED_NODE = stage-connect-and-discover / surdet_project_validate
RECOVERY_DIAGNOSTIC_FAILURE = surdet_project_validate returned no structuredContent
RECOVERY_DIAGNOSTIC_ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-DeyCw3\evidence.json
RECOVERY_DIAGNOSTIC_ARTIFACT_BYTES = 730
RECOVERY_DIAGNOSTIC_ARTIFACT_SHA256 = 2CEE0934EE80B0897510E51865C31AD59368074255B5D59947D3477709C3AA61
RECOVERY_DIAGNOSTIC_IDENTITY_READBACK = PASS
RECOVERY_DIAGNOSTIC_BUDGET = 1/3 USED
RECOVERY_VERIFY_ALL = NOT_RUN_AFTER_RECOVERY_FAILURE
RECOVERY_FORMAL = NOT_STARTED
RECOVERY_RUNNER_MODIFIED = NO
RECOVERY_EXTERNAL_AGENT_ACCEPTANCE = NOT_STARTED
RECOVERY_OWNER_ACCEPTANCE = NOT_STARTED
RECOVERY_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

本轮恢复失败节点与 `object.inspect.details` 修复后的能力回归不一致：launcher preflight 已通过，但真实诊断在更早的 `project.validate` 调用处未返回 `structuredContent`。按合同保留 artifact 并停止，不将该证据解释为 runner 修复授权，也不进行第二次筛选或循环重跑。

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

ba22c488f045621909432114d68b4a0ea121aff3  fix(cli): accept scalar inspection details
  packages/authoring/src/capability-registry.ts
  packages/cli/test/agent-port-tools.test.ts
```

此前 Task 1–8 的提交链保留在任务书 Ledger；本轮没有 amend、rebase、squash、reset 或改写历史。历史失败停止时的代码证据 HEAD 是 `0a712640f600c0955579144f045668e822e39896`；本轮恢复代码证据 HEAD 是 `ba22c488f045621909432114d68b4a0ea121aff3`。本轮没有要求在报告正文记录其自身尚未产生的文档提交 hash。

## 6. 停止时 Git 与后续边界

```ini
BRANCH = main
CODE_EVIDENCE_HEAD = ba22c488f045621909432114d68b4a0ea121aff3
CODE_EVIDENCE_PARENT = 90f413f8bf2539a70eca8ed18bebd816c22cc5f2
REMOTE_MAIN = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
AHEAD_BEHIND_AT_CODE_EVIDENCE = 15/0
CODE_WORKTREE = CLEAN
STAGING_AREA = EMPTY
TASKBOOK_AND_REPORT = MODIFIED_FOR_RECOVERY_FAILURE_LEDGER_ONLY
DIAGNOSTIC_ARTIFACTS = PRESERVED_UNTRACKED
PROTECTED_GOVERNANCE_UNTRACKED = PRESERVED_NOT_STAGED
PUSH = NOT_PERFORMED
DEPLOYMENT = NOT_PERFORMED
RELEASE = NOT_PERFORMED
WAVE_5 = NOT_STARTED
REAL_EXTERNAL_AGENT_ACCEPTANCE = NOT_STARTED
OWNER_EDITOR_ACCEPTANCE = NOT_STARTED
WAVE_4_STATUS = BLOCKED_AT_RECOVERY_DIAGNOSTIC_FAILURE
NEXT_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

本报告和任务书 Ledger 的文档提交只用于保留本轮恢复失败事实与停止状态；不会把当前 Wave 4 标记为 `FORMAL_PASSED`、`READY_FOR_ARCHITECT_REVIEW` 或 `CLOSED`。真实外部 Agent 与 Owner Editor 验收均未开始，Wave 5 未开始，且未 push。

## 7. 身份核对历史标记

```ini
PRE_DOCUMENT_CLOSURE_AHEAD_BEHIND = 13/0
PRE_DOCUMENT_CLOSURE_STATUS = HISTORICAL_SNAPSHOT_ONLY
PRE_DOCUMENT_CLOSURE_REPORT_IDENTITY_CORRECTION = Wdr0lC SHA-256 corrected above
DOCUMENT_SELF_COMMIT_HASH = NOT_REQUIRED_BY_OWNER
```

## 8. Task 10 recovery 2 — complete output-schema conformance scan

本轮按授权先建立集中式红灯，再实施一次 registry-only 修复，随后只运行一次恢复 DIAGNOSTIC。既有生产服务、dispatcher、领域返回、envelope、权限策略和 runner 均未修改。

```ini
RECOVERY2_AUTHORIZATION = OWNER_AUTHORIZED_OUTPUT_SCHEMA_CONFORMANCE_SCAN_THEN_ONE_DIAGNOSTIC
RECOVERY2_INITIAL_HEAD = f022a5024c5461cf9b0dbf4a7381d7a37e5f2d48
RECOVERY2_INITIAL_PARENT = ba22c488f045621909432114d68b4a0ea121aff3
RECOVERY2_ALLOWED_CODE_FILES = packages/authoring/src/capability-registry.ts; packages/cli/test/agent-port-output-contract.test.ts
RECOVERY2_CODE_FORBIDDEN_SCOPE = authoring-service; authoring-dispatcher; object-index; runner; Core/Renderer/Host/Shell/Editor/Starter

RECOVERY2_CONFORMANCE_RED_COMMAND = npm run test -w @surdet/cli -- test/agent-port-output-contract.test.ts
RECOVERY2_CONFORMANCE_RED_EXIT = 1
RECOVERY2_CONFORMANCE_RED_RESULT = 7 mismatching cases were aggregated in one scan before repair
RECOVERY2_CONFORMANCE_RED_CASES = project.validate[project], project.validate[working], project.simulate[project], project.simulate[working], runtime.run-from[working], runtime.read-trace[working-nested-events], change.diff[working]
RECOVERY2_CONFORMANCE_RED_MISMATCH_FIELDS = validate.project.view; validate.working.view/scenes/freshness; simulate.project.view; simulate.working.view/entryScene/pathsExplored/choiceBranches/paths/budgetExhausted/runtimeErrors/endings/deadEndScenes/cyclesPruned/saveRoundtrips/freshness; runtime.run-from.freshness; runtime.read-trace.view/events[].source/events[].stateDelta; change.diff.view
RECOVERY2_CONFORMANCE_RED_METHOD = real AuthoringService + dispatcher + registry schema-validator; the scan collected all issues instead of stopping at the first mismatch

RECOVERY2_REGISTRY_REPAIR = PASS
RECOVERY2_REGISTRY_REPAIR_DETAILS = project/working oneOf branches; shared evidenceFreshnessSchema; exact working schemas for run-from/read-trace/diff; explicit nested trace source/stateDelta; closed validation working scenes serialization field
RECOVERY2_DOMAIN_RETURN_MODIFIED = NO
RECOVERY2_ENVELOPE_MODIFIED = NO
RECOVERY2_GLOBAL_JSON_VALUE_SCHEMA_EXPANDED = NO
RECOVERY2_PERMISSIVE_SCHEMA_ESCAPE = NO_EMPTY_ENVELOPE; NO_ADDITIONAL_PROPERTIES_TRUE

RECOVERY2_CONFORMANCE_GREEN_COMMAND = npm run test -w @surdet/cli -- test/agent-port-output-contract.test.ts
RECOVERY2_CONFORMANCE_GREEN_EXIT = 0
RECOVERY2_CONFORMANCE_GREEN_RESULT = 1 file / 1 test passed; 23 real dispatcher cases
RECOVERY2_CONFORMANCE_FORMAL_COVERAGE = capabilities.describe; project.inspect; project.assets; change.begin; variable.ensure; object.inspect string/object/omitted; character.ensure; timeline.create/patch; scene.create; project.entry-scene.set; project.validate project/working; project.simulate project/working; runtime.run-from; runtime.read-trace nested events; change.diff; change.commit
RECOVERY2_AGENT_PORT_TOOLS_COMMAND = npm run test -w @surdet/cli -- test/agent-port-tools.test.ts
RECOVERY2_AGENT_PORT_TOOLS_EXIT = 0
RECOVERY2_AGENT_PORT_TOOLS_RESULT = 1 file / 6 tests passed
RECOVERY2_AUTHORING_REGISTRY_COMMAND = npm run test -w @surdet/authoring -- test/capability-registry.test.ts
RECOVERY2_AUTHORING_REGISTRY_EXIT = 0
RECOVERY2_AUTHORING_REGISTRY_RESULT = 1 file / 3 tests passed
RECOVERY2_AUTHORING_TYPECHECK = EXIT_CODE=0
RECOVERY2_AUTHORING_BUILD = EXIT_CODE=0
RECOVERY2_CLI_TYPECHECK = EXIT_CODE=0
RECOVERY2_CLI_BUILD = EXIT_CODE=0

RECOVERY2_CODE_EVIDENCE_HEAD = d5239d84127552a00918409a28201da5e5aa66dc
RECOVERY2_CODE_EVIDENCE_PARENT = f022a5024c5461cf9b0dbf4a7381d7a37e5f2d48
RECOVERY2_CODE_COMMIT_MESSAGE = fix(cli): align formal output schemas
RECOVERY2_CODE_COMMIT_SCOPE = packages/authoring/src/capability-registry.ts; packages/cli/test/agent-port-output-contract.test.ts
RECOVERY2_CODE_COMMIT_PUSH = NOT_PERFORMED
RECOVERY2_REMOTE_MAIN_AT_CODE_EVIDENCE = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
RECOVERY2_AHEAD_BEHIND_AT_CODE_EVIDENCE = 17/0
```

## 9. Task 10 recovery 2 — bounded DIAGNOSTIC stop

```ini
RECOVERY2_PREFLIGHT_COMMAND = node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight
RECOVERY2_PREFLIGHT_EXIT = 0
RECOVERY2_PREFLIGHT_RESULT = launcher/initialize/tools-list/read-only inspect/stdout purity/child cleanup PASS
RECOVERY2_DIAGNOSTIC_COMMAND = node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode diagnostic
RECOVERY2_DIAGNOSTIC_RUN_HEAD = d5239d84127552a00918409a28201da5e5aa66dc
RECOVERY2_DIAGNOSTIC_EXIT = 1
RECOVERY2_DIAGNOSTIC_LAST_PASSED_NODE = observe-resume-readback
RECOVERY2_DIAGNOSTIC_FIRST_FAILED_NODE = apply-stage-and-resume
RECOVERY2_DIAGNOSTIC_FAILURE = committed project inspect omitted agent_port_intro
RECOVERY2_DIAGNOSTIC_PROJECT_MUTATED = UNKNOWN
RECOVERY2_DIAGNOSTIC_ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-ILJH9c\evidence.json
RECOVERY2_DIAGNOSTIC_ARTIFACT_BYTES = 896
RECOVERY2_DIAGNOSTIC_ARTIFACT_SHA256 = 56B6B15F25AA54FCE6E22F8B4FA02A994F4B4E3D2E24AF1B16E480B8A11B9E73
RECOVERY2_DIAGNOSTIC_IDENTITY_READBACK = PASS
RECOVERY2_DIAGNOSTIC_BUDGET = 2/3 USED; 1 REMAINING; LAST BUDGET NOT USED
RECOVERY2_VERIFY_ALL = NOT_RUN_AFTER_DIAGNOSTIC_FAILURE
RECOVERY2_FORMAL = NOT_STARTED
RECOVERY2_RUNNER_MODIFIED = NO
RECOVERY2_EXTERNAL_AGENT_ACCEPTANCE = NOT_STARTED
RECOVERY2_OWNER_ACCEPTANCE = NOT_STARTED
RECOVERY2_WAVE_5 = NOT_STARTED
RECOVERY2_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

本次诊断不是 schema conformance 的失败：前两个节点已通过，失败发生在 committed project inspect 的内容断言，真实错误为缺少 `agent_port_intro`。按授权，最后一次 DIAGNOSTIC 预算保留；没有运行 recovery `verify:all`，没有运行 FORMAL，没有修改 runner，也没有开始外部 Agent 或 Owner 验收。该失败 artifact 已保留，当前 Wave 4 仍未完成。

## 10. Task 10 recovery 3 — runner 方法收口与最终门禁停止

本轮依据独立总经理授权，只修改了 runner 的断言方法：提交后 `project.inspect` 改为字段级断言，并在关闭 apply Port 后用无 `changeId`/`resumeChangeId` 的 fresh observe Port，通过公开 `object.inspect` 与磁盘 bytes/SHA-256 读取确认已提交 timeline。没有修改生产代码、registry、领域返回、MCP schema、服务、dispatcher 或其它 Wave 4 范围外文件。

```ini
RECOVERY3_AUTHORIZATION = INDEPENDENT_MANAGER_APPROVED_MINIMAL_RUNNER_METHOD_FIX_AND_FINAL_DIAGNOSTIC
RECOVERY3_SCOPE = packages/cli/e2e/agent-port-wave-4.e2e.mjs; current Wave 4 taskbook/report only
RECOVERY3_PRODUCTION_CODE_CHANGED = NO
RECOVERY3_SCHEMA_OR_DOMAIN_CHANGED = NO
RECOVERY3_INITIAL_HEAD = 11dea30aa50b7ec91e17c5e6c80b59e6f9c30e36
RECOVERY3_INITIAL_PARENT = 9f82f79b4beb508a5bf2615ba75645559ac7dd7b
RECOVERY3_CODE_EVIDENCE_HEAD = c959c7c49c2a753bb79d4ee2b7ee8047fc5819f8
RECOVERY3_CODE_EVIDENCE_PARENT = 11dea30aa50b7ec91e17c5e6c80b59e6f9c30e36
RECOVERY3_CODE_COMMIT_MESSAGE = test(cli): verify committed timeline through public object readback
RECOVERY3_CODE_COMMIT_SCOPE = packages/cli/e2e/agent-port-wave-4.e2e.mjs
RECOVERY3_CODE_COMMIT_PUSH = NOT_PERFORMED
RECOVERY3_REMOTE_MAIN_AT_CODE_EVIDENCE = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
RECOVERY3_AHEAD_BEHIND_AT_CODE_EVIDENCE = 20/0

HISTORICAL_ILJH9C_STATUS = HISTORICAL_FAILED_DIAGNOSTIC
HISTORICAL_ILJH9C_FAILURE_CLASS = HARNESS_CONTRACT_MISMATCH
HISTORICAL_ILJH9C_POST_REVIEW_DISK_DETERMINATION = PROJECT_MUTATED_YES
HISTORICAL_ILJH9C_ARTIFACT = UNCHANGED

RECOVERY3_PREFLIGHT_COMMAND = node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode preflight
RECOVERY3_PREFLIGHT_EXIT = 0
RECOVERY3_PREFLIGHT_RESULT = launcher/initialize/tools-list/read-only inspect/stdout purity/child cleanup PASS
RECOVERY3_DIAGNOSTIC_BUDGET = 3/3 USED; FINAL BUDGET
RECOVERY3_DIAGNOSTIC_COMMAND = node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode diagnostic
RECOVERY3_DIAGNOSTIC_EXIT = 0
RECOVERY3_DIAGNOSTIC_STATUS = PASSED
RECOVERY3_DIAGNOSTIC_RUN_HEAD = c959c7c49c2a753bb79d4ee2b7ee8047fc5819f8
RECOVERY3_DIAGNOSTIC_ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-diagnostic-NmaZOP\evidence.json
RECOVERY3_DIAGNOSTIC_ARTIFACT_BYTES = 227481
RECOVERY3_DIAGNOSTIC_ARTIFACT_SHA256 = BADB7986E1BA37AB94433F403668B59807F3CEC234E88DE4FEEE328ABF6F9FBB
RECOVERY3_DIAGNOSTIC_IDENTITY_READBACK = PASS
RECOVERY3_DIAGNOSTIC_MILESTONES = stage-connect-and-discover; observe-resume-readback; apply-stage-and-resume (all PASS)
RECOVERY3_DIAGNOSTIC_PROJECT_MUTATED = YES
RECOVERY3_DIAGNOSTIC_COMMITTED = YES
RECOVERY3_APPLY_PROJECT_BEFORE_SHA256 = 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
RECOVERY3_APPLY_PROJECT_AFTER_SHA256 = CDB8CCB1DC55063996BFDCB314A5839F5270B9F88ED48F8BE689FF11F50C12B7
RECOVERY3_FRESH_OBSERVE_OBJECT = timeline:agent_port_intro
RECOVERY3_FRESH_OBSERVE_SOURCE = content/timelines/agent_port_intro.json
RECOVERY3_FRESH_OBSERVE_FINGERPRINT = 279CA04F8DFBC1940B9171893517F5B892152E99B99F476C6A516D16E3878719
RECOVERY3_TIMELINE_DISK_PATH = content/timelines/agent_port_intro.json
RECOVERY3_TIMELINE_DISK_BYTES = 1070
RECOVERY3_TIMELINE_DISK_SHA256 = D41AE646896A1FD86926073A7FA7CEF611DC1BF3242F45E5FCAB94181E05A205
RECOVERY3_TIMELINE_DISK_JSON_ID = agent_port_intro
RECOVERY3_STARTER_UNCHANGED = YES
RECOVERY3_ERROR_CHANNELS = protocol=[]; domainUnexpected=[]; stderrUnexpected=[]; unhandledRejections=[]; childCleanupFailures=[]

RECOVERY3_VERIFY_ALL_COMMAND = npm run verify:all
RECOVERY3_VERIFY_ALL_RUN_COUNT = 1
RECOVERY3_VERIFY_ALL_EXIT = 1
RECOVERY3_VERIFY_ALL_LAST_PASSED_NODE = verify:tests before @surdet/cli test discovery failure
RECOVERY3_VERIFY_ALL_FIRST_FAILED_NODE = @surdet/cli test
RECOVERY3_VERIFY_ALL_FAILURE = Vitest discovered 48 fixture suites under preserved diagnostic artifact directories; artifact fixture tsconfig.json extends ../../tsconfig.base.json, which is unresolved from the artifact fixture location
RECOVERY3_VERIFY_ALL_CLI_RESULT = 48 failed suites; 21 passed suites; 173 tests passed before collection failures
RECOVERY3_VERIFY_ALL_PRODUCTION_FAILURE = NOT_ESTABLISHED
RECOVERY3_FORMAL = NOT_STARTED
RECOVERY3_FORMAL_REASON = recovery verify:all exit 1; FORMAL is forbidden after recovery gate failure
RECOVERY3_EXTERNAL_AGENT_ACCEPTANCE = NOT_STARTED
RECOVERY3_OWNER_ACCEPTANCE = NOT_STARTED
RECOVERY3_WAVE_5 = NOT_STARTED
RECOVERY3_PUSH = NOT_PERFORMED
RECOVERY3_TRACKED_WORKTREE_BEFORE_DOCS = CLEAN
RECOVERY3_STAGING_BEFORE_DOCS = EMPTY
RECOVERY3_UNTRACKED_ARTIFACTS = PRESERVED_AND_NOT_STAGED
RECOVERY3_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

最终结论：本轮最终 DIAGNOSTIC 已通过并获得真实提交后 timeline 证据；恢复 `verify:all` 在 CLI 测试收集阶段失败，首个失败是诊断 artifact fixture 被全量 Vitest 发现并解析其失效的相对 `tsconfig` 继承路径。按任务书没有运行 FORMAL、没有重跑任何门禁、没有删除 artifact、没有 push，也没有开始外部 Agent 或 Owner 验收。Wave 4 尚未完成，停止等待独立总经理复审。

## 11. Task 10 recovery 4 — CLI artifact discovery isolation and final formal evidence

本轮只修复已确认的 CLI 测试发现污染：在 `packages/cli/package.json` 的 test script 中追加 Vitest 官方 `--exclude "e2e/artifacts/**"`。六个历史 DIAGNOSTIC 目录及其 fixture、历史失败证据均未修改、删除、移动或覆盖；runner、MCP、registry、dispatcher/service、领域逻辑和其它生产代码均未修改。上一轮 `RECOVERY3_VERIFY_ALL` 保留为历史失败事实，不被本轮结果改写。

```ini
RECOVERY4_AUTHORIZATION = OWNER_AUTHORIZED_CLI_TEST_DISCOVERY_MUST_EXCLUDE_PRESERVED_AGENT_PORT_ARTIFACTS
RECOVERY4_INITIAL_HEAD = 59eb4f43ad847fb5836935c465ee9f7bd5558a77
RECOVERY4_INITIAL_PARENT = c959c7c49c2a753bb79d4ee2b7ee8047fc5819f8
RECOVERY4_REMOTE_MAIN = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
RECOVERY4_AHEAD_BEHIND_INITIAL = 21/0
RECOVERY4_PRESERVED_DIAGNOSTIC_DIRECTORIES = 6
RECOVERY4_PRESERVED_FIXTURE_TEST_FILES_PER_DIRECTORY = 8
RECOVERY4_ARTIFACTS_MODIFIED = NO
RECOVERY3_VERIFY_ALL = HISTORICAL_FAILED
RECOVERY3_VERIFY_ALL_REASON = 48 preserved artifact fixture suites were incorrectly discovered by CLI Vitest

RECOVERY4_ALLOWED_PACKAGE_FILE = packages/cli/package.json
RECOVERY4_TEST_SCRIPT = vitest run --passWithNoTests --exclude "e2e/artifacts/**"
RECOVERY4_TEST_DISCOVERY_COMMAND = npm exec -w @surdet/cli -- vitest list --exclude "e2e/artifacts/**"
RECOVERY4_TEST_DISCOVERY_EXIT = 0
RECOVERY4_TEST_DISCOVERY_ARTIFACT_MATCHES = 0
RECOVERY4_TEST_DISCOVERY_FORMAL_CASES = 173
RECOVERY4_CLI_TEST_COMMAND = npm run test -w @surdet/cli
RECOVERY4_CLI_TEST_EXIT = 0
RECOVERY4_CLI_TEST_RESULT = 21 test files; 173 tests; 0 failed suites
RECOVERY4_DIFF_CHECK = EXIT_CODE=0
RECOVERY4_CACHED_DIFF_CHECK = EXIT_CODE=0

DIAGNOSTIC_CODE_EVIDENCE_HEAD = c959c7c49c2a753bb79d4ee2b7ee8047fc5819f8
GATE_HYGIENE_HEAD = ee5f11d3ef6f6750e2bd8f9bce4b79a7e9fad0db
GATE_HYGIENE_PARENT = 59eb4f43ad847fb5836935c465ee9f7bd5558a77
GATE_HYGIENE_COMMIT_MESSAGE = test(cli): exclude preserved agent-port artifacts
GATE_HYGIENE_COMMIT_SCOPE = packages/cli/package.json
GATE_HYGIENE_COMMIT_PUSH = NOT_PERFORMED
DIAGNOSTIC_RERUN = NO
DIAGNOSTIC_BUDGET = 3/3 USED; UNCHANGED
REMOTE_MAIN_AT_GATE_HYGIENE = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
AHEAD_BEHIND_AT_GATE_HYGIENE = 22/0

RECOVERY4_VERIFY_ALL_COMMAND = npm run verify:all
RECOVERY4_VERIFY_ALL_RUN_COUNT = 1
RECOVERY4_VERIFY_ALL_EXIT = 0
RECOVERY4_VERIFY_ALL_RESULT = PASS; workspace type/build/test/starter/editor/formal-build/diff gates completed
FORMAL_COMMAND = node packages/cli/e2e/agent-port-wave-4.e2e.mjs --mode formal
FORMAL_RUN_COUNT = 1
FORMAL_EXIT = 0
FORMAL_EVIDENCE_CLASS = FORMAL
FORMAL_STATUS = PASSED
FORMAL_RUN_HEAD = ee5f11d3ef6f6750e2bd8f9bce4b79a7e9fad0db
FORMAL_PROJECT_MUTATED = YES
FORMAL_COMMITTED = YES
FORMAL_ARTIFACT = E:\surdet\packages\cli\e2e\artifacts\agent-port-wave-4-formal-D8YsXD\evidence.json
FORMAL_ARTIFACT_BYTES = 227425
FORMAL_ARTIFACT_SHA256 = B68352588A8748F0690C85567EB416755CF1425E66E7AC565B915A66D66CBFB1
FORMAL_IDENTITY_READBACK = PASS
FORMAL_FRESH_OBSERVE_OBJECT = timeline:agent_port_intro
FORMAL_FRESH_OBSERVE_SOURCE = content/timelines/agent_port_intro.json
FORMAL_FRESH_OBSERVE_FINGERPRINT = 279CA04F8DFBC1940B9171893517F5B892152E99B99F476C6A516D16E3878719
FORMAL_TIMELINE_DISK_PATH = content/timelines/agent_port_intro.json
FORMAL_TIMELINE_DISK_BYTES = 1070
FORMAL_TIMELINE_DISK_SHA256 = D41AE646896A1FD86926073A7FA7CEF611DC1BF3242F45E5FCAB94181E05A205
FORMAL_TIMELINE_DISK_JSON_ID = agent_port_intro
FORMAL_STARTER_UNCHANGED = YES
FORMAL_ERROR_CHANNELS = protocol=[]; domainUnexpected=[]; stderrUnexpected=[]; unhandledRejections=[]; childCleanupFailures=[]
REAL_EXTERNAL_AGENT_ACCEPTANCE = NOT_STARTED
OWNER_ACCEPTANCE = NOT_STARTED
WAVE_5 = NOT_STARTED
PUSH = NOT_PERFORMED
NEXT_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

本轮恢复门禁与唯一 FORMAL 均通过。没有重跑 DIAGNOSTIC，没有修改历史 artifact，没有 push，也没有开始真实外部 Agent、Owner 验收或 Wave 5。文档将在本轮以一次 docs-only closure commit 收口，文档自身最终 bytes/SHA-256 从磁盘回读后在交接中报告，不制造自指 correction commit。

## 12. W4-MCP-COMPAT-1：真实外部 Agent 握手兼容收口

第一次真实外部 Agent 尝试没有进入 Agent 行为评价：它在 MCP initialize 阶段请求 `2025-11-25`，当前入口的历史配置 `legacy:'reject'` 返回 `-32022 Unsupported protocol version`。因此该次结果只能记为握手失败，`AGENT_BEHAVIOR_NOT_EVALUATED = YES`，不能归因于外部 Agent 的工具使用或创作能力。

本轮将现代专用入口改为官方 SDK 支持的 `legacy:'serve'`。同一个 `createAgentPortServer` factory 同时服务 modern 与官方 2025-era client；没有自建协议转换器、fallback server、第二套领域语义或 MCP schema。任务书中原有 `legacy:'reject'` 代码/合同是历史设计快照，当前实现合同已由本节覆盖为双时代 stdio serving。

```ini
W4_MCP_COMPAT_1_AUTHORIZATION = OWNER_AUTHORIZED_MINIMAL_MCP_HANDSHAKE_COMPATIBILITY_FIX
W4_MCP_COMPAT_1_HISTORICAL_FAILURE_ROOT = <local-path>
W4_MCP_COMPAT_1_HISTORICAL_FAILURE = MCP -32022 Unsupported protocol version: 2025-11-25
W4_MCP_COMPAT_1_AGENT_BEHAVIOR = NOT_EVALUATED
W4_MCP_COMPAT_1_HISTORICAL_PROJECT_TREE_SHA256 = 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
W4_MCP_COMPAT_1_HISTORICAL_AGENT_DATA_FILE_COUNT = 0
W4_MCP_COMPAT_1_HISTORICAL_CHANGE_ID = NOT_CREATED
W4_MCP_COMPAT_1_HISTORICAL_CAPSULE = NOT_CREATED

W4_MCP_COMPAT_1_RED_LOG = <local-path>
W4_MCP_COMPAT_1_RED_LOG_BYTES = 1041
W4_MCP_COMPAT_1_RED_LOG_SHA256 = A5BB2A90AEC3C22B7529F68F7EE696B442194B234A3C7F5E8FEC4CB63935178A

W4_MCP_COMPAT_1_CODE_EVIDENCE_HEAD = fa9f7cf4d495eaecf35b66f50698ad839c61df8e
W4_MCP_COMPAT_1_CODE_EVIDENCE_PARENT = 57a6d4db961f042f01994bca21485b96c14a24c6
W4_MCP_COMPAT_1_CODE_SCOPE = packages/cli/e2e/agent-port-wave-4.e2e.mjs; packages/cli/src/agent-port/main.ts
W4_MCP_COMPAT_1_CODE_COMMIT_MESSAGE = fix(cli): serve 2025 MCP clients over stdio
W4_MCP_COMPAT_1_CODE_PUSH = NOT_PERFORMED
FORMAL_RUN_HEAD = ee5f11d3ef6f6750e2bd8f9bce4b79a7e9fad0db
FORMAL_RERUN = NO

W4_MCP_COMPAT_1_NODE_CHECK = PASS; exit=0
W4_MCP_COMPAT_1_TYPECHECK = PASS; command=npm run typecheck -w @surdet/cli
W4_MCP_COMPAT_1_BUILD = PASS; command=npm run build -w @surdet/cli
W4_MCP_COMPAT_1_AGENT_PORT_FOCUSED_TESTS = PASS; 5 files / 32 tests
W4_MCP_COMPAT_1_CLI_TESTS = PASS; 21 files / 173 tests
W4_MCP_COMPAT_1_MODERN_PROTOCOL_PREFLIGHT = PASS; auto; 2026-07-28
W4_MCP_COMPAT_1_LEGACY_2025_11_25_PREFLIGHT = PASS; legacy; 2025-11-25
W4_MCP_COMPAT_1_POLICY_FILTER = PASS
W4_MCP_COMPAT_1_STDOUT_PROTOCOL_PURITY = PASS
W4_MCP_COMPAT_1_CHILD_CLEANUP = PASS

W4_MCP_COMPAT_1_ACCEPTANCE_PREP_HEAD = fa9f7cf4d495eaecf35b66f50698ad839c61df8e
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_ROOT = <local-path>
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_PROJECT = <local-path>
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_DATA_DIR = <local-path>
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_STATUS = PREPARED
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_DATA_FILE_COUNT = 0
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_PROJECT_TREE_SHA256 = 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_STARTER_BEFORE_SHA256 = 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_STARTER_AFTER_SHA256 = 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_STARTER_UNCHANGED = YES
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_PROJECT_EQUALS_STARTER = YES
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_STAGE_PROJECT_AND_APPLY_PROJECT_SAME = YES
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_STAGE_DATA_AND_APPLY_DATA_SAME = YES
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_STAGE_POLICY = stage
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_HAS_RESUME_CHANGE = NO
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_APPLY_STATUS = NOT_AUTHORIZED
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_TOOLS_CALLED = []
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_CHANGE_CREATED = NO
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_STAGE_CONFIG_BYTES = 552
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_STAGE_CONFIG_SHA256 = D8FBC3675FDC1F45206B73E50EBBF441F6232EB3A42F4BB6560E904AC8197476
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_APPLY_TEMPLATE_BYTES = 342
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_APPLY_TEMPLATE_SHA256 = 5C2DF2A473955D326C9697E013A08C932FEA86345E7422D346839942A53955D0
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_EVIDENCE_BYTES = 22872
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_EVIDENCE_SHA256 = 55AE6A7461DA64BBCEDD8DB707A43E6FD0EB3F375A76DAF0F3741468D104FED4
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_IDENTITY_BYTES = 194
W4_MCP_COMPAT_1_ACCEPTANCE_PREP_IDENTITY_SHA256 = 9BC6B1109E1A339202A27A0EEFBE2E6E9027340A7A7AF2D788088E911FF8DE95

W4_MCP_COMPAT_1_DIAGNOSTIC = NOT_RUN
W4_MCP_COMPAT_1_VERIFY_ALL = NOT_RUN
W4_MCP_COMPAT_1_EXTERNAL_AGENT_RETRY = NOT_STARTED
W4_MCP_COMPAT_1_OWNER_EDITOR_ACCEPTANCE = NOT_STARTED
W4_MCP_COMPAT_1_APPLY_RESUME = NOT_AUTHORIZED
W4_MCP_COMPAT_1_WAVE_5 = NOT_STARTED
W4_MCP_COMPAT_1_PUSH = NOT_PERFORMED
DOCUMENT_CLOSURE_HEAD = POST_COMMIT_GIT_READBACK_ONLY; NOT_SELF_EMBEDDED
FINAL_HEAD = POST_COMMIT_GIT_READBACK_ONLY; NOT_SELF_EMBEDDED
NEXT_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

本轮的新 acceptance-prep 只证明了全新的桌面 project、独立空 data dir、可加载 stage MCP 配置和同项目 resume 模板；它不构成真实外部 Agent stage 验收。FORMAL 仍只指向历史 `ee5f11d3…`，没有重跑。文档自身的 `DOCUMENT_CLOSURE_HEAD` 与 `FINAL_HEAD` 不自引用写入，最终以 docs-only commit 后的真实 Git readback 为准，避免产生新的文档身份循环。

## 13. W4-EXTERNAL-AGENT-RECOVERY-2：结果可见性、场景原子性与 rollback 逃生通道

真实外部 Agent 的验收记录显示，失败不是 Agent 能力评价，而是一条可复现的共享故障链：成功 MCP 载荷只出现在 `structuredContent`，text-only host 无法取得 changeId/指纹/结构化结果；非法 typed `scene.create` 候选在校验前写入 working state；随后 poisoned working snapshot 使正式 rollback 也被解析步骤阻断。本轮只修复这三项直接相关合同。

### 历史现场与证据身份

```ini
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_EXTERNAL_AGENT_ACCEPTANCE = FAILED
W4_EXTERNAL_AGENT_RECOVERY_2_OWNER_ACCEPTANCE = NOT_STARTED
W4_EXTERNAL_AGENT_RECOVERY_2_OLD_CHANGE = DO_NOT_RESUME
W4_EXTERNAL_AGENT_RECOVERY_2_FAILURE_RECORD_PATH = <local-path>
W4_EXTERNAL_AGENT_RECOVERY_2_FAILURE_RECORD_KIND = RECONSTRUCTED_TOOL_CALL_RECORD; NOT_RAW_MACHINE_LOG
W4_EXTERNAL_AGENT_RECOVERY_2_FAILURE_RECORD_BYTES = 7753
W4_EXTERNAL_AGENT_RECOVERY_2_FAILURE_RECORD_SHA256 = 9D5B250D0EA88076DE7C634C0E2ACAB7F1DC296484C698C55AF3C98AD93C2A7C
W4_EXTERNAL_AGENT_RECOVERY_2_RAW_MACHINE_LOG = NOT_PROVIDED; RECONSTRUCTION_NOT_RELABELED

W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_ROOT = <local-path>
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_ROOT_MODIFIED = NO
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_PROJECT_FILES = 37
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_PROJECT_BYTES = 6705750
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_PROJECT_TREE_SHA256 = 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_DATA_FILE_COUNT = 0
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_CHANGE_ID = NOT_CREATED
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_CAPSULE = NOT_CREATED
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_EVIDENCE_BYTES = 22872
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_EVIDENCE_SHA256 = 55AE6A7461DA64BBCEDD8DB707A43E6FD0EB3F375A76DAF0F3741468D104FED4
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_IDENTITY_BYTES = 194
W4_EXTERNAL_AGENT_RECOVERY_2_HISTORICAL_ACCEPTANCE_IDENTITY_SHA256 = 9BC6B1109E1A339202A27A0EEFBE2E6E9027340A7A7AF2D788088E911FF8DE95
```

上述 `surdet-tool-call-record.md` 的文件正文自标为“完整重建”，因此本报告将其作为 reconstructed record 记录，未声称它是原始 MCP wire/machine log。旧 acceptance root 已从磁盘重新核对，project tree、空 data directory、prepared evidence/identity 均保持原身份；本轮没有复用或修改它。

### RED 取证

```ini
W4_EXTERNAL_AGENT_RECOVERY_2_INITIAL_HEAD = 52e11e2a5c5efcc14d178a97b656120de3e05bf5
W4_EXTERNAL_AGENT_RECOVERY_2_INITIAL_PARENT = fa9f7cf4d495eaecf35b66f50698ad839c61df8e
W4_EXTERNAL_AGENT_RECOVERY_2_REMOTE_MAIN = f7ab58d67a362fcad7c2d64f5889f95f737ab5dd
W4_EXTERNAL_AGENT_RECOVERY_2_AHEAD_BEHIND_INITIAL = 27/0
W4_EXTERNAL_AGENT_RECOVERY_2_RED_COMMAND = npm exec -w @surdet/cli -- vitest run test/agent-port-tools.test.ts test/agent-port-security.test.ts --reporter=verbose
W4_EXTERNAL_AGENT_RECOVERY_2_RED_EXIT = 1
W4_EXTERNAL_AGENT_RECOVERY_2_RED_RESULT = 2 test files; 3 failed; 18 passed
W4_EXTERNAL_AGENT_RECOVERY_2_RED_FAILURES = text-only envelope parse; invalid scene.create persisted candidate; poisoned rollback blocked by C004 parsing
W4_EXTERNAL_AGENT_RECOVERY_2_RED_LOG_PATH = <local-path>
W4_EXTERNAL_AGENT_RECOVERY_2_RED_LOG_BYTES = 5904
W4_EXTERNAL_AGENT_RECOVERY_2_RED_LOG_SHA256 = 1CA2FB0770AB0D035F66758CDE3EC89AD9A8FF92558BED80A15B837E976B60BD
```

### 最小修复与 GREEN 证据

`packages/cli/src/agent-port/server.ts` 现在对成功和失败 envelope 使用同一 `JSON.stringify(fullEnvelope)` text 投影，同时保留同一 envelope 的 `structuredContent`。`packages/authoring/src/operations.ts` 在 `runOperation()` 能够持久化前使用 Core 共享 `compileScene()` 校验 scene.create/scene.patch 的完整候选；校验失败不会写入 workingFiles、workingRevision 或 operation ledger。`packages/cli/src/authoring/authoring-service.ts` 为 rollback 使用仅打开 change record/repository/project identity 的 context，不调用 `loadProjectSnapshot`，因此 poisoned workingFiles 仍可回滚到 baseContents。

新增回归覆盖：text-only host 的 session.describe、change.begin（从 text 取得真实 changeId）和失败 envelope；非法 `@set affinity 2` 的 scene.create 原子拒绝及合法 `@set affinity = 2`；scene.patch 候选同一校验边界；含非法 DSL 的 OPEN change 正式 rollback。所有测试均使用真实 MCP/AuthoringService/NodeChangeStore 路径，未修改真实项目内容。

```ini
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_AUTHORING_COMMAND = npm exec -w @surdet/authoring -- vitest run test/operations.test.ts test/change-session.test.ts --reporter=verbose
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_AUTHORING_EXIT = 0
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_AUTHORING_RESULT = 2 test files; 7 tests passed
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_AUTHORING_LOG_PATH = <local-path>
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_AUTHORING_LOG_BYTES = 1181
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_AUTHORING_LOG_SHA256 = 1211D8BD41DF5B97ABEE85E1AC8E9DA0D0BDA27DBE327F472F5B6DDF737AA1BF
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_CLI_COMMAND = npm exec -w @surdet/cli -- vitest run test/agent-port-output-contract.test.ts test/agent-port-tools.test.ts test/agent-port-session.test.ts test/agent-port-security.test.ts --reporter=verbose
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_CLI_EXIT = 0
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_CLI_RESULT = 4 test files; 30 tests passed
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_CLI_LOG_PATH = <local-path>
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_CLI_LOG_BYTES = 4880
W4_EXTERNAL_AGENT_RECOVERY_2_GREEN_CLI_LOG_SHA256 = 6CD0D857130384FA38BE090C30E04DFF82C20A74011569350E399ADD861D8F36
W4_EXTERNAL_AGENT_RECOVERY_2_AUTHORING_TYPECHECK = PASS; exit=0
W4_EXTERNAL_AGENT_RECOVERY_2_AUTHORING_BUILD = PASS; exit=0
W4_EXTERNAL_AGENT_RECOVERY_2_CLI_TYPECHECK = PASS; exit=0
W4_EXTERNAL_AGENT_RECOVERY_2_CLI_BUILD = PASS; exit=0
W4_EXTERNAL_AGENT_RECOVERY_2_DUAL_ERA_PREFLIGHT = PASS; exit=0
W4_EXTERNAL_AGENT_RECOVERY_2_MODERN_PREFLIGHT = PASS; negotiated=2026-07-28
W4_EXTERNAL_AGENT_RECOVERY_2_LEGACY_2025_11_25_PREFLIGHT = PASS; negotiated=2025-11-25
W4_EXTERNAL_AGENT_RECOVERY_2_POLICY_FILTER = PASS
W4_EXTERNAL_AGENT_RECOVERY_2_STDOUT_PROTOCOL_PURITY = PASS
W4_EXTERNAL_AGENT_RECOVERY_2_CHILD_CLEANUP = PASS
```

### Git 与停止门

```ini
W4_EXTERNAL_AGENT_RECOVERY_2_CODE_EVIDENCE_HEAD = b3ea00749de1dd6638492839d07d518d2af2dc74
W4_EXTERNAL_AGENT_RECOVERY_2_CODE_EVIDENCE_PARENT = 52e11e2a5c5efcc14d178a97b656120de3e05bf5
W4_EXTERNAL_AGENT_RECOVERY_2_CODE_EVIDENCE_COMMIT_MESSAGE = fix(agent-port): restore external acceptance recovery paths
W4_EXTERNAL_AGENT_RECOVERY_2_CODE_EVIDENCE_SCOPE = packages/authoring/src/operations.ts; packages/authoring/test/operations.test.ts; packages/cli/src/agent-port/server.ts; packages/cli/src/authoring/authoring-service.ts; packages/cli/test/agent-port-security.test.ts; packages/cli/test/agent-port-tools.test.ts
W4_EXTERNAL_AGENT_RECOVERY_2_CODE_EVIDENCE_PUSH = NOT_PERFORMED
W4_EXTERNAL_AGENT_RECOVERY_2_DOCUMENT_CLOSURE_HEAD = POST_COMMIT_GIT_READBACK_ONLY; NOT_SELF_EMBEDDED
W4_EXTERNAL_AGENT_RECOVERY_2_DIAGNOSTIC = DO_NOT_RERUN
W4_EXTERNAL_AGENT_RECOVERY_2_FORMAL = DO_NOT_RERUN
W4_EXTERNAL_AGENT_RECOVERY_2_VERIFY_ALL = DO_NOT_RUN_IN_THIS_REPAIR
W4_EXTERNAL_AGENT_RECOVERY_2_EXTERNAL_AGENT_RETRY = NOT_STARTED
W4_EXTERNAL_AGENT_RECOVERY_2_OWNER_ACCEPTANCE = NOT_STARTED
W4_EXTERNAL_AGENT_RECOVERY_2_WAVE_5 = NOT_STARTED
W4_EXTERNAL_AGENT_RECOVERY_2_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

本轮代码修复与直接相关验证完成，但不宣称新的外部 Agent 验收通过，也不宣称 Wave 4 CLOSED。文档只追加本次恢复事实；docs-only 提交后的真实 HEAD、parent、remote、ahead/behind、工作树和文档 bytes/SHA-256 以最终 Git readback 为准，避免为文档自身身份制造自指提交循环。
