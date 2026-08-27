# Stage 6 Wave 6 Human-Agent Review Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Wave 5 已验证的多候选比较与安全合成底座，扩展为一个中文优先、由项目所有者逐项裁决冲突、预览真实 stage 结果并对完整计划做最终批准的人类审阅与因果交接闭环。

**Architecture:** `@surdet/authoring` 继续拥有 working-object fingerprint、review projection、决定/批准回执校验和 integration commit gate 的唯一语义；`@surdet/cli` 只负责 review workspace 的 Node 文件适配、不可变 artifact、preview fixture 和 Agent Port 薄投影；`surdet-editor` 只负责读取共享投影、中文呈现、对象/因果下钻、实际 stage 预览以及在用户明确点击后写入人类回执。Editor 不重算 comparison/plan，Agent Port 不提供写人类回执能力，任何 stale 或不匹配的批准都必须在项目文件替换前 fail-loud。

**Tech Stack:** TypeScript 5.7、Node.js >=20、Vitest 3、Vite 6、现有 File System Access API、现有 `@surdet/authoring` / `@surdet/cli` / `surdet-editor`、现有 MCP 2.0.0 SDK、现有 Change Store V2 / JSON record / local lease / composition plan / evidence / preview 基础设施、仓库已有 Playwright（仅正式 runner 使用）。

## Global Constraints

- 本任务书落实项目所有者已批准的 A / A1 / P1，唯一权威产品规格是 `docs/superpowers/specs/2026-08-26-human-agent-review-workbench-stage-6-wave-6-design.md`。
- 第一用户是项目所有者与普通创作者。默认 Editor 文案必须是清楚的中文；稳定 ID、fingerprint、英文 error code 和 JSON 只放在可展开的“技术详情”。
- Surdet 不内嵌模型。不得保存 Prompt、聊天记录、token、模型评分、供应商路由或“最佳模型”判断。
- MCP 只是共享 authoring 合同的薄适配。review projection、receipt validation、fingerprint、stale、approval gate 或 plan 选择逻辑不得写进 `server.ts`、`tool-projection.ts` 或 registry metadata。
- Editor 不得复制 comparison、dependency closure、conflict resolution、integration plan、fingerprint 或 approval freshness 算法。
- 人类决定和最终批准只能由 Editor 在用户明确操作后写入 review workspace；Agent Port 不得注册 `review.approve`、`review.write-decision`、任意文件写工具或等价后门。
- Wave 5 直接 `composition.plan` 输入继续可用于隔离 stage 探索，但生成的 plan 必须标记 `reviewState='unreviewed'`，不能满足 owner-reviewed integration apply gate。
- 正式 reviewed plan 只能从合法 `ComparisonDecisionReceipt` 机械生成选择；冲突 actor 固定为 `human`，MCP 调用方不能覆盖。
- integration commit 缺少批准、批准过期、review identity 不匹配、result fixture 被探索性修改或 fresh evidence 改变时，必须在 `stageText()` 和 journal 写入之前失败。
- 普通非 integration change 的现有 commit 行为保持不变；不得把 Wave 6 回执强制扩展到 Editor 普通保存或其他 change。
- review payload、decision、result、approval 和 return 文件全部 create-only；同一 ID + 同 payload 可幂等回读，同一 ID + 不同 payload fail-loud，不覆盖历史失败包。
- 所有稳定 payload 使用 review root 相对路径，不保存用户名、绝对项目路径、环境变量、Git remote、Prompt 或聊天记录。
- review result 的 `project/` 必须来自基线项目副本叠加 integration working files；不得根据 diff 在浏览器里虚构结果。
- exploration 只允许发生在 review fixture；一旦 fixture 与正式 result tree identity 不同，最终批准立即失效，且不得反向写回 integration change。
- working fingerprint 必须覆盖 `scene:`、`timeline:`、`variable:`、`character:`、`config:characters`、`config:entryScene`；未知已声明产物必须失败，不得静默跳过。
- `AUTHORING_CONTRACT_VERSION` 从 `2.0.0` 精确升级为 `2.1.0`；envelope 和 delivery capsule 版本保持 `1.0.0` / `2.0.0`。不增加兼容层或双 registry。
- 新增稳定 retry disposition `after-human-review`；它表示等待用户操作，Agent 不得把它解释成重试相同请求。
- 不新增依赖，不修改 `package-lock.json`，不升级 MCP SDK。若施工现场证明必须新增依赖，立即停止在独立复审门，不得自行安装。
- 不修改 `packages/core/**`、`packages/renderer/**`、`packages/host/**`、`packages/shell/**` 生产代码。
- 不修改 `examples/starter/**`、`examples/zero-after-midnight/**`、`games/**`、资产、剧情、配置、存档格式、性能门限、pack、release 或 deploy。
- 不修改长期路线台账；执行 AI 只在最终报告末尾提供“建议由总经理登记的事实”。
- 不触碰 `SESSION-HANDOFF.md`、`USER.md`、两份受保护美术资料、既有 handoff、历史 artifact 和 `packages/cli/e2e/artifacts/`。
- 所有动态 fixture、日志、RED/GREEN/DIAGNOSTIC/FORMAL artifact 写入新的系统临时目录；acceptance-prep 仅在项目所有者授权后写入新的桌面隔离目录。
- 每个代码 Task 必须先建立匹配合同的 RED，再做最小 GREEN。零测试、错误测试文件、旧 dist、错误入口或未命中目标断言的绿灯均记为 `HARNESS_INVALID`。
- 质量第一；质量不下降时节省额度第二。禁止一修一 FORMAL、无界等待、概率性压力、重复全量门禁或为了漂亮报告扩大矩阵。
- `verify:all` 正式预算 1 次。只有它因本 Wave 直接相关问题失败、已有聚焦 RED、修复范围获得总经理书面批准时，才允许 1 次 recovery；否则失败即停。
- DIAGNOSTIC 总预算最多 3 次。三次仍失败即 `DIAGNOSTIC_BUDGET_EXHAUSTED`，不得申请第四次或在未授权时继续。
- runner、生产代码与永久测试冻结并提交后，FORMAL 只运行 1 次。失败即保留 artifact 并停止；不得修后自行 replacement FORMAL。
- 真实外部 Agent、isolated apply 与项目所有者视觉/交互验收不能由执行 AI 代填。
- 只创建普通本地提交；不得 push、force push、rebase、reset、amend、squash、clean 或改写历史。push 只由项目所有者另行授权。
- 本任务书头部的执行 skill 建议不构成创建子 Agent、并行施工或转交另一 AI 的授权；默认一个执行 AI 串行完成 Task 0–12。

---

## 一、给新执行 AI 的最小项目介绍

Surdet 的目标不是在引擎里放一个聊天机器人，而是让电脑端外部 Agent 能可靠地使用引擎完成创作，同时让不懂内部术语的人也能理解、控制并验收结果。

当前已经具备：

1. 现有 26 项机器可读 capability registry 与 MCP 机械投影基础；本 Wave 计划扩展为 30 项；
2. observe / stage / apply 权限边界；
3. 隔离 change、operationId 幂等、workingRevision、对象指纹、CAS、跨进程 lease 与显式恢复；
4. 场景、变量、角色、入口和既有资源 timeline 的类型化 mutation；
5. 对象级 diff、potentialImpact、observedImpact、validation、确定性 simulation 与 runtime trace；
6. 不可变 delivery capsule、候选比较、identical subgroup、依赖闭包、显式冲突裁决和 integration replay；
7. 真实外部 Agent stage、isolated apply/resume 与项目所有者可见验收已通过的 Wave 5 基线；
8. 一个已有块编辑、流程图、时间轴、配置、预览、统计、审计和因果下钻能力的浏览器 Editor。

Wave 6 不是重写 Wave 5，也不是“给 Editor 加一个 JSON 查看器”。正确心智模型是：

~~~text
sealed candidate capsules
  -> shared comparison
  -> immutable comparison review package
  -> human per-conflict decision receipt
  -> reviewed plan + dry-run
  -> integration stage + fresh evidence
  -> immutable result review package + actual project fixture
  -> human whole-plan approval or return receipt
  -> separately authorized apply Port
  -> approval-aware existing commit gate
~~~

若实现需要 Editor 自己判断冲突、Agent 自己写批准、review package 复制任意绝对路径、预览的是另一份项目、或 commit 在检查批准前已经 staging，说明实现已经偏离，应立即停止。

---

## 二、权威输入与执行基线

### 2.1 Task 0 固定读取顺序

执行 AI 必须完整读取：

1. `E:\surdet\AGENTS.md`
2. `docs/README.md`
3. `docs/known-limitations.md`
4. `docs/superpowers/specs/2026-08-26-human-agent-review-workbench-stage-6-wave-6-design.md`
5. 本任务书
6. `docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md`
7. `docs/AGENT-CANDIDATE-COMPARISON-SAFE-COMPOSITION-WAVE-5-DELIVERY-REPORT-2026-08-24.md`
8. `packages/authoring/src/composition-contracts.ts`
9. `packages/authoring/src/candidate-comparison.ts`
10. `packages/authoring/src/integration-plan.ts`
11. `packages/authoring/src/integration-execution.ts`
12. `packages/authoring/src/change-session.ts`
13. `packages/authoring/src/contracts.ts`
14. `packages/authoring/src/capability-contract.ts`
15. `packages/authoring/src/capability-registry.ts`
16. `packages/authoring/src/error-catalog.ts`
17. `packages/cli/src/authoring/composition-service.ts`
18. `packages/cli/src/authoring/node-composition-store.ts`
19. `packages/cli/src/authoring/node-json-record.ts`
20. `packages/cli/src/authoring/authoring-service.ts`
21. `packages/cli/src/authoring/authoring-dispatcher.ts`
22. `packages/cli/src/agent-port/session.ts`
23. `packages/cli/src/agent-port/server.ts`
24. `packages/editor/src/state.ts`
25. `packages/editor/src/main.ts`
26. `packages/editor/src/project-io.ts`
27. `packages/editor/src/authoring-project-storage.ts`
28. `packages/editor/src/panels/right.ts`
29. `packages/editor/src/panels/preview-panel.ts`
30. `packages/editor/src/styles.css`
31. `packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs`
32. 三个工作区 `package.json` 与根 `package.json`

### 2.2 任务书生成时基线

~~~text
branch = main
DESIGN_SPEC_HEAD = 017f7201926a17adbe9a876c3e1500f209c1e9e5
surdet/main = f8943c293c4537b3867cc8eeea316b19bb4a0b40
ahead/behind = 1/0
tracked worktree = clean
staging area = empty
Wave 5 remote closure = f8943c293c4537b3867cc8eeea316b19bb4a0b40
Wave 6 design = approved by project owner
Wave 6 implementation = not started
push = not authorized
~~~

本任务书自己的提交身份不在正文预写。Task 0 必须现场运行：

~~~powershell
git log -1 --format="%H %s" -- docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md
~~~

若执行开始时存在未说明 tracked 修改、非空暂存区、远端 behind、HEAD 不包含规格与任务书、或另一个 AI 正在修改白名单文件，立即停止。不得 reset、checkout、stash、clean 或覆盖他人工作。

---

## 三、不可妥协的不变量

~~~text
AUTHORING_REMAINS_THE_SINGLE_SEMANTIC_TRUTH
EDITOR_NEVER_RECOMPUTES_COMPARISON_OR_PLAN
MCP_REMAINS_A_THIN_PROJECTION
AGENT_PORT_CANNOT_WRITE_HUMAN_RECEIPTS
DIRECT_PLAN_REMAINS_UNREVIEWED
REVIEWED_PLAN_IS_DERIVED_FROM_A_VALID_RECEIPT
HUMAN_ACTOR_IS_NOT_CALLER_SUPPLIED
REVIEW_ARTIFACTS_ARE_CREATE_ONLY
REVIEW_PATHS_ARE_PROJECT_NAMESPACED_AND_RELATIVE
SOURCE_CAPSULES_AND_SOURCE_CHANGES_REMAIN_IMMUTABLE
REAL_PROJECT_UNCHANGED_DURING_COMPARE_STAGE_AND_REVIEW
RESULT_FIXTURE_MATCHES_INTEGRATION_WORKING_FILES
EXPLORATION_NEVER_WRITES_BACK_TO_INTEGRATION_CHANGE
ALL_DECLARED_PRODUCTS_HAVE_FINAL_FINGERPRINTS
UNKNOWN_DECLARED_PRODUCT_FAILS_LOUD
APPROVAL_BINDS_EXACT_PLAN_CHANGE_REVISION_DIFF_EVIDENCE_AND_TREE
STALE_APPROVAL_CAN_NEVER_COMMIT
APPROVAL_CHECK_PRECEDES_STAGING_AND_JOURNAL
NORMAL_NON_INTEGRATION_COMMIT_REMAINS_UNCHANGED
APPLY_REQUIRES_SEPARATE_OWNER_AUTHORIZATION
NO_EMBEDDED_MODEL
~~~

### 3.1 两阶段人类门

第一阶段解决“哪些内容进入计划”：

- identical/disjoint 单元默认纳入但必须可见；
- selection-required 冲突逐项选择一个结果、全部排除或退回重做；
- blocking 冲突不能生成决定回执；
- 决定回执绑定 comparison、project revision 与候选身份。

第二阶段解决“是否接受实际结果”：

- 必须先生成 READY integration change、fresh diff/validation/simulation/runtime 与真实 preview fixture；
- 用户对完整结果批准或退回，不逐文件制造批准疲劳；
- approval 绑定 plan、change、workingRevision、diff、evidence、result tree；
- approval 不等于 apply 授权，apply Port 仍需项目所有者另行启动。

### 3.2 信任边界

Editor 写回执不是恶意本机程序防护。它提供的是产品级职责分离：Agent Port 没有写回执工具，普通 Agent 只能等待用户。任何能直接修改用户磁盘的恶意程序仍可伪造本地文件；本 Wave 不引入签名、账号、密钥或远程身份系统。

---

## 四、文件责任图与施工白名单

### 4.1 `@surdet/authoring` 新文件

| 文件 | 单一责任 |
|---|---|
| `packages/authoring/src/working-object-fingerprint.ts` | 六类可组合对象在 working files/config 上的统一规范指纹解析 |
| `packages/authoring/src/review-contracts.ts` | review package、projection、decision、result、approval、return、identity 的协议无关类型 |
| `packages/authoring/src/review-projection.ts` | comparison 与 integration facts 到人类审阅投影的纯函数 |
| `packages/authoring/src/review-receipts.ts` | 决定/批准/退回回执的规范化、指纹、freshness 与机械转换 |
| `packages/authoring/test/working-object-fingerprint.test.ts` | 六类对象、remove、未知类型、格式稳定性 |
| `packages/authoring/test/review-projection.test.ts` | A/D identical、C conflict、B dependency、证据与来源投影 |
| `packages/authoring/test/review-receipts.test.ts` | create-only payload 语义、决定/批准校验、stale 与 actor 固定 |

### 4.2 `@surdet/authoring` 允许修改

| 文件 | 允许修改 |
|---|---|
| `packages/authoring/src/integration-plan.ts` | `reviewState` / `reviewDecision`，reviewed 与 direct 输入边界，plan fingerprint |
| `packages/authoring/src/integration-execution.ts` | 统一 working fingerprint、review binding、approval binding、READY 回读 |
| `packages/authoring/src/change-session.ts` | approval-aware integration commit gate；必须位于 staging 前 |
| `packages/authoring/src/contracts.ts` | `ChangeRecord.integration` 的 review/approval metadata 类型接线 |
| `packages/authoring/src/capability-contract.ts` | contract `2.1.0` 与 `after-human-review` |
| `packages/authoring/src/capability-registry.ts` | 四项 review capability、严格 schema、30 项总数 |
| `packages/authoring/src/error-catalog.ts` | 11 项 review 错误及 repair action |
| `packages/authoring/src/index.ts` | 新模块公开导出 |
| 既有 authoring tests | 仅更新确受合同变更影响的精确断言 |

### 4.3 `@surdet/cli` 新文件

| 文件 | 单一责任 |
|---|---|
| `packages/cli/src/authoring/node-review-store.ts` | project namespace 内 review workspace 路径安全、create-only JSON、identity 回读 |
| `packages/cli/src/authoring/review-service.ts` | prepare comparison/result、inspect decision/approval、preview fixture 机械生成 |
| `packages/cli/test/node-review-store.test.ts` | 路径逃逸、symlink/junction、create-only、身份与 corrupt |
| `packages/cli/test/review-service.test.ts` | 四能力原生纵向合同、实际 working fixture、stale、commit binding |
| `packages/cli/test/agent-port-review.test.ts` | dispatcher/session/policy/MCP schema 与无写回执能力 |
| `packages/cli/e2e/human-agent-review-wave-6.e2e.mjs` | preflight/DIAGNOSTIC/FORMAL/acceptance-prep 唯一 runner |

### 4.4 `@surdet/cli` 允许修改

| 文件 | 允许修改 |
|---|---|
| `packages/cli/src/authoring/composition-service.ts` | 统一 fingerprint 接线、reviewed plan 输入、result facts |
| `packages/cli/src/authoring/authoring-service.ts` | review facade、commit 前 approval inspection 与 binding |
| `packages/cli/src/authoring/authoring-dispatcher.ts` | 四个机械 switch、commit 可选 approvalRef |
| `packages/cli/src/agent-port/session.ts` | review 等待状态、nextActions、apply commit approvalRef 传递 |
| `packages/cli/src/agent-port/server.ts` | 仅必要的 envelope/output schema 对齐；不得写 review 算法 |
| `packages/cli/test/authoring-contract.test.ts` | 2.1.0、30 项能力 |
| `packages/cli/test/agent-port-output-contract.test.ts` | 四项 output schema conformance |
| `packages/cli/test/agent-port-session.test.ts` | after-human-review、无 active change 的 review read、approval gate |
| `packages/cli/test/agent-port-tools.test.ts` | 30 项工具、policy 与 annotations |
| `packages/cli/test/composition-service.test.ts` | direct/reviewed plan、fingerprint 一般性回归 |
| `packages/cli/test/agent-port-security.test.ts` | Agent 无写回执入口、路径不泄露、commit fail-closed |

### 4.5 `surdet-editor` 新文件

| 文件 | 单一责任 |
|---|---|
| `packages/editor/src/review-workspace.ts` | File System Access 读取 review package、写 create-only decision/approval/return |
| `packages/editor/src/review-model.ts` | 纯 UI 状态、中文标签、卡片状态、选择草稿与按钮可用性 |
| `packages/editor/src/panels/review-panel.ts` | 审阅任务首页、冲突卡、结果摘要、技术详情与回执按钮 |
| `packages/editor/src/review-preview.ts` | review `project/` 句柄加载、正式 tree identity 与探索状态监测 |
| `packages/editor/test/review-workspace.test.ts` | JSON/sidecar/identity、create-only、互斥回执、fixture changed |
| `packages/editor/test/review-model.test.ts` | 中文标签、blocking/selection/advisory、草稿与状态机 |
| `packages/editor/test/review-panel.test.ts` | A/D/C/B 可见表达、逐项选择、技术详情、滚动边界 |
| `packages/editor/test/review-preview.test.ts` | actual fixture、居中预览、探索修改禁用批准、重载恢复 |

### 4.6 `surdet-editor` 允许修改

| 文件 | 允许修改 |
|---|---|
| `packages/editor/src/state.ts` | `review` tab、ReviewWorkspaceState 与当前 review object |
| `packages/editor/src/main.ts` | “审阅”顶层标签、打开审阅任务入口、render 路由 |
| `packages/editor/src/project-io.ts` | 提取 `openProjectFromHandle()` 供 review fixture 复用；不改变普通打开/保存语义 |
| `packages/editor/src/authoring-project-storage.ts` | 只读 review fixture tree identity helper；不复制 Node fingerprint 算法 |
| `packages/editor/src/causal-selection.ts` | review objectRef 到既有选择模型的适配 |
| `packages/editor/src/panels/right.ts` | review 模式下显示共享 potential/observed，不改普通编辑器真相 |
| `packages/editor/src/panels/preview-panel.ts` | review result 场景/timeline 入口与探索状态提示 |
| `packages/editor/src/styles.css` | 三栏审阅布局、独立滚动、中文层级、居中预览、窄屏退化 |
| `packages/editor/test/project-io.test.ts` | 句柄复用不破坏普通路径 |
| `packages/editor/test/causal-selection.test.ts` | review 对象下钻与反向定位 |
| `packages/editor/test/preview-stage-layout.test.ts` | review 预览仍双轴居中且不受列表增长挤压 |

### 4.7 文档文件

| 文件 | 用途 |
|---|---|
| `docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md` | 本任务书与紧凑 Execution Ledger |
| `docs/HUMAN-AGENT-REVIEW-WORKBENCH-STAGE-6-WAVE-6-DELIVERY-REPORT-2026-08-26.md` | Task 12 才创建的交付报告 |
| `docs/known-limitations.md` | 只有既有文字与本轮已验证能力直接矛盾时做最小更正 |

### 4.8 明确禁止

- `packages/core/**`、`packages/renderer/**`、`packages/host/**`、`packages/shell/**` 生产代码；
- `examples/**`、`games/**`、资产、剧情、配置；
- `scripts/verify-all.mjs`、性能门限、发行与部署配置；
- 依赖、lockfile、MCP SDK；
- 长期路线台账、受保护文件、handoff、历史 artifacts；
- 新的模型客户端、Prompt 模板、推荐算法、候选评分；
- Wave 7、扩展市场、资产导入、云协作、签名系统。

---

## 五、跨任务固定接口

以下名称和类型是任务之间的合同。执行 AI 不得在后续 Task 私自改名；若现场源码迫使签名变化，必须先在 Ledger 记录原因并停在独立复审门。

### 5.1 Working fingerprint

~~~ts
export type ComposableObjectRef =
  | `scene:${string}`
  | `timeline:${string}`
  | `variable:${string}`
  | `character:${string}`
  | 'config:characters'
  | 'config:entryScene';

export interface WorkingObjectFingerprintResult {
  objectRef: ComposableObjectRef;
  state: 'present' | 'absent';
  fingerprint: string;
}

export async function fingerprintWorkingObject(
  workingFiles: Readonly<Record<string, string>>,
  objectRef: string,
  hasher: TextHasher,
): Promise<WorkingObjectFingerprintResult>;
~~~

`absent` 也必须有稳定 fingerprint，它由规范 `{ objectRef, state: 'absent' }` 哈希生成，使 remove 产物可验证。未知 objectRef 抛 `COMPOSITION_REPLAY_FAILED`。

### 5.2 Review 核心类型

~~~ts
export type ReviewKind = 'comparison' | 'integration-result';
export type ReviewState =
  | 'COMPARISON_PREPARED'
  | 'DECISION_DRAFT'
  | 'DECIDED'
  | 'PLAN_PREPARED'
  | 'STAGE_READY'
  | 'OWNER_APPROVED'
  | 'APPLY_PENDING'
  | 'COMMITTED'
  | 'RETURNED'
  | 'STALE'
  | 'INVALID';

export interface ReviewArtifactIdentity {
  relativePath: string;
  bytes: number;
  sha256: string;
}

export interface ReviewSourceIdentity {
  projectIdentity: string;
  expectedProjectRevision: string;
  comparisonFingerprint: string;
  planFingerprint?: string;
  integrationChangeId?: string;
  workingRevision?: number;
}

export interface ReviewTaskSummary {
  title: string;
  goal?: string;
  acceptanceCriteria: string[];
  candidateCount: number;
  objectCount: number;
  conflictCount: number;
  statementSource: 'candidate-intent' | 'generated-fallback';
}

export interface ReviewObjectSummary {
  objectRef: string;
  kind: string;
  semanticId?: string;
  source?: { path: string; line: number; col: number };
  references: string[];
  referencedBy: string[];
  potentialImpact: unknown[];
  observedImpact: unknown[];
}

export interface HumanReviewProjection {
  reviewVersion: '1.0.0';
  reviewId: string;
  kind: ReviewKind;
  state: ReviewState;
  projectIdentity: string;
  expectedProjectRevision: string;
  task: ReviewTaskSummary;
  candidates: ReviewCandidate[];
  safeGroups: ReviewSafeGroup[];
  conflicts: ReviewConflict[];
  dependencies: ReviewDependency[];
  evidence: ReviewEvidenceSummary;
  objects: ReviewObjectSummary[];
  finalResult?: ReviewFinalResult;
  sourceIdentity: ReviewSourceIdentity;
  reviewFingerprint: string;
}
~~~

`ReviewCandidate`、`ReviewSafeGroup`、`ReviewConflict`、`ReviewDependency`、`ReviewEvidenceSummary` 与 `ReviewFinalResult` 在 Task 2 按规格字段完整定义；不得用 `unknown` 替代它们的结构字段。

### 5.3 决定与计划

~~~ts
export interface ComparisonDecisionReceipt {
  receiptVersion: '1.0.0';
  decisionId: string;
  reviewId: string;
  comparisonFingerprint: string;
  projectIdentity: string;
  expectedProjectRevision: string;
  candidateRefs: CandidateCapsuleRef[];
  selectedUnitIds: string[];
  conflictResolutions: Array<{
    conflictId: string;
    resolution: 'choose-unit' | 'exclude-all' | 'regenerate-candidate';
    chosenUnitId?: string;
  }>;
  reviewerChannel: 'surdet-editor-local';
  decidedAt: string;
  decisionFingerprint: string;
}

export type IntegrationReviewBinding =
  | { reviewState: 'unreviewed' }
  | {
      reviewState: 'human-reviewed';
      reviewId: string;
      decisionId: string;
      decisionFingerprint: string;
    };
~~~

`IntegrationPlan` 与 `IntegrationMetadata` 都加入 `review: IntegrationReviewBinding`，且 plan fingerprint 必须包含这份 binding（不含 `decidedAt`）。

### 5.4 最终批准

~~~ts
export interface ReviewEvidenceBinding {
  diffEvidenceId: string;
  validationEvidenceId: string;
  simulationEvidenceId: string;
  runtimeTraceIds: string[];
}

export interface FinalApprovalReceipt {
  receiptVersion: '1.0.0';
  approvalId: string;
  resultReviewId: string;
  decisionFingerprint: string;
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  projectIdentity: string;
  expectedProjectRevision: string;
  diffFingerprint: string;
  evidence: ReviewEvidenceBinding;
  resultTreeSha256: string;
  reviewerChannel: 'surdet-editor-local';
  approvedAt: string;
  approvalFingerprint: string;
}

export interface ReviewApprovalRef {
  resultReviewId: string;
  approvalId: string;
  approvalFingerprint: string;
}

export interface VerifiedReviewApproval {
  receipt: FinalApprovalReceipt;
  bindingFingerprint: string;
}
~~~

### 5.5 四项公开能力

~~~text
review.prepare-comparison  minimumPolicy=observe
review.inspect-decision    minimumPolicy=observe
review.prepare-result      minimumPolicy=stage
review.inspect-approval    minimumPolicy=observe
~~~

Agent Port 只能创建审阅包和检查回执，不得创建决定、批准或退回文件。

---

## 六、错误合同与重试语义

新增并只新增以下稳定错误：

| code | category | retryDisposition | 必要 repair action |
|---|---|---|---|
| `REVIEW_NOT_FOUND` | not-found | after-inspect | 重新读取 reviewId 与相对路径 |
| `REVIEW_IDENTITY_MISMATCH` | conflict | never | 保留包，重新 prepare，不改写原包 |
| `REVIEW_FORMAT_UNSUPPORTED` | request | never | 使用支持的 reviewVersion |
| `REVIEW_DECISION_REQUIRED` | conflict | after-human-review | 在 Editor 完成人类裁决 |
| `REVIEW_DECISION_INVALID` | request | after-human-review | 在 Editor 修正未完成/非法选择并生成新 decisionId |
| `REVIEW_DECISION_STALE` | conflict | after-refresh | 重新 compare/prepare review |
| `REVIEW_RESULT_NOT_READY` | conflict | after-inspect | 取得 READY + fresh evidence 后再 prepare |
| `REVIEW_APPROVAL_REQUIRED` | conflict | after-human-review | 在 Editor 预览并批准 |
| `REVIEW_APPROVAL_STALE` | conflict | after-refresh | 重新生成 result review 并批准 |
| `REVIEW_RETURNED` | conflict | never | 新候选/新 comparison/new plan |
| `REVIEW_FIXTURE_CHANGED` | conflict | after-refresh | 丢弃探索修改并重新加载正式 result |

`after-human-review` 必须同步进入 `RetryDisposition`、error envelope schema、MCP output schema 与 permanent tests。未知错误仍归一化为 `INVALID_REQUEST`，不得从 message 字符串猜 code。

---

## 七、验证预算、提交纪律与停止规则

### 7.1 普通测试预算

- 聚焦测试可在对应 Task 的 RED/GREEN 周期内运行；同一个没有代码变化的命令不得反复运行。
- 每个工作区全量测试最多在 Task 9 运行一次；早期 Task 只跑列出的聚焦文件。
- typecheck/build 在改动接口或 dist 消费方前后按 Task 指定运行。
- 修改 authoring 后，CLI/runner 前必须先 build authoring，避免 Vitest 读 src、Node runner 读旧 dist。

### 7.2 `verify:all`

正式运行最多一次。若失败：

1. 保留完整日志、bytes、SHA-256；
2. 记录最后通过节点和第一个失败节点；
3. 判断是否与本 Wave 直接相关；
4. 未获总经理书面 recovery 授权前停止；
5. 不得把一次失败后单独通过的子门写成 `verify:all PASS`。

### 7.3 DIAGNOSTIC 与 FORMAL

- preflight 必须复用正式 launcher、cwd、dist、入口和 fixture builder；禁止替身 server。
- DIAGNOSTIC 最多三次，只用于冻结前调试 runner/真实链路；每份失败 artifact 保留。
- 第三次仍失败立即停止，不修改后继续第 4 次。
- 生产代码、永久测试和 runner 全部冻结为 `CODE_EVIDENCE_HEAD` 后，才能运行唯一 FORMAL。
- FORMAL `runHead` 必须等于 `CODE_EVIDENCE_HEAD`，runnerSha256 必须等于冻结文件身份。
- FORMAL 失败即停止；不得筛选失败、覆盖 artifact 或自行运行 replacement FORMAL。

### 7.4 Git 提交

每个 Task 只精确暂存白名单路径：

1. 按该 Task `Files` 清单逐个写出完整相对路径执行 `git add -- ...`；
2. 运行 `git diff --cached --check`；
3. 运行 `git diff --cached --name-status`，确认没有额外文件；
4. 使用该 Task 明列的 commit message 创建普通本地提交。

禁止 `git add .`、`git add -A`、目录通配、amend、reset、rebase、squash 或 push。

FORMAL 自动化仅可在 runner 创建的临时隔离 fixture 中执行一次受控 commit，用来证明“已批准结果可以通过既有提交门”；不得提交、apply 或覆盖桌面 acceptance fixture、原始 Starter 或仓库项目内容。

---

## 八、Task 总览与依赖

| Task | 独立可审阅交付 | 依赖 |
|---:|---|---|
| 0 | 真实基线、保护边界和测试设施有效性 | 无 |
| 1 | 六类 working fingerprint 统一真相 | 0 |
| 2 | comparison review projection | 1 |
| 3 | 人类决定回执与 reviewed plan | 2 |
| 4 | result projection、批准回执与 commit gate | 1–3 |
| 5 | Node review store 与 preview fixture | 2–4 |
| 6 | CLI/registry/dispatcher/session/MCP 薄投影 | 3–5 |
| 7 | Editor review workspace 与状态模型 | 2、5 |
| 8 | Editor 审阅 UI、因果下钻与实际预览 | 7 |
| 9 | 聚焦总门、全工作区与唯一 verify:all | 1–8 |
| 10 | 唯一 runner、preflight、DIAGNOSTIC、FORMAL | 1–9 |
| 11 | acceptance-prep、真实外部 Agent、Owner、isolated apply | 10 |
| 12 | 交付报告、身份回读、文档闭合、独立复审 | 11 |

---

### Task 0: 真实基线、保护边界与测试设施确认

**Files:**
- Read: 第二节全部权威输入
- Modify: 仅本任务书 Execution Ledger
- Create temporary: `$task0Root\task0-baseline.txt`，其中 `$task0Root` 在 Step 2 创建

**Interfaces:**
- Consumes: 当前 Git、规格、Wave 5 远端闭合和既有测试命令
- Produces: `BASELINE_MATCHES=true` 或明确停止报告；后续 Task 不得在未知基线上开始

- [ ] **Step 1: 读取 Git 身份与工作树**

Run:

~~~powershell
git branch --show-current
git rev-parse HEAD
git rev-parse HEAD^
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
~~~

Expected:

- branch=`main`；
- HEAD 包含设计规格和本任务书；
- behind=`0`；
- tracked 工作树干净，staging 为空；
- 只有已知未跟踪治理/受保护文件与历史 CLI artifacts；
- tracked log 无输出。

- [ ] **Step 2: 建立 Task 0 基线文件**

Run:

~~~powershell
$task0Root = Join-Path $env:TEMP ("surdet-human-review-wave6-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $task0Root | Out-Null
$task0Root
~~~

在 `$task0Root\task0-baseline.txt` 写入命令、exit code、HEAD、remote、ahead/behind、tracked/untracked 分类与本任务书提交身份。不得把终端摘要当磁盘证据；写完后重新读取 bytes/SHA-256。不得复用历史 Wave 5/Wave 6 目录。

- [ ] **Step 3: 运行既有最小健康基线**

Run:

~~~powershell
npm run test -w @surdet/authoring -- candidate-comparison.test.ts integration-plan.test.ts integration-execution.test.ts
npm run test -w @surdet/cli -- composition-service.test.ts agent-port-composition.test.ts
npm run test -w surdet-editor -- causal-selection.test.ts preview-stage-layout.test.ts project-io.test.ts
~~~

Expected: 所列既有测试全部 PASS。若失败，先证明是否为当前基线红灯；不得把它写成 Wave 6 新 RED。

- [ ] **Step 4: 核对不存在实施前白名单修改**

Run:

~~~powershell
git diff --name-only
git diff --cached --name-only
~~~

Expected: 两者均无输出。若不满足，停止为 `BASELINE_MISMATCH`。

- [ ] **Step 5: 追加紧凑 Ledger**

记录时间、HEAD/remote、工作树、Task 0 三组命令、artifact 身份和停止状态。Task 0 不提交代码、不创建交付报告。

---

### Task 1: 统一六类 Working Object Fingerprint

**Files:**
- Create: `packages/authoring/src/working-object-fingerprint.ts`
- Create: `packages/authoring/test/working-object-fingerprint.test.ts`
- Modify: `packages/authoring/src/integration-execution.ts`
- Modify: `packages/authoring/src/index.ts`
- Modify: `packages/cli/src/authoring/composition-service.ts`
- Modify: `packages/authoring/test/integration-execution.test.ts`
- Modify: `packages/cli/test/composition-service.test.ts`
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: `TextHasher`, `stableStringify`, `timelinePathFor`, working `Record<string,string>`
- Produces: `fingerprintWorkingObject()` 与 `WorkingObjectFingerprintResult`，供 dry-run、READY、result review 和 approval freshness 共用

- [ ] **Step 1: 写六类对象和未知类型 RED**

在 `working-object-fingerprint.test.ts` 建立以下表格测试：

~~~ts
const cases = [
  ['scene:intro', 'present'],
  ['timeline:intro_opening', 'present'],
  ['variable:flag.alpha', 'present'],
  ['character:lynn', 'present'],
  ['config:characters', 'present'],
  ['config:entryScene', 'present'],
] as const;

it.each(cases)('fingerprints %s as %s', async (objectRef, state) => {
  const result = await fingerprintWorkingObject(workingFiles, objectRef, hasher);
  expect(result.objectRef).toBe(objectRef);
  expect(result.state).toBe(state);
  expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
});

it('gives removals an explicit absent fingerprint', async () => {
  const result = await fingerprintWorkingObject(workingFiles, 'variable:removed', hasher);
  expect(result.state).toBe('absent');
  expect(result.fingerprint).toBe(await hasher.sha256(stableStringify({
    objectRef: 'variable:removed',
    state: 'absent',
  })));
});

it('fails loud for an unknown declared product', async () => {
  await expect(fingerprintWorkingObject(workingFiles, 'asset:bg/night', hasher))
    .rejects.toMatchObject({ code: 'COMPOSITION_REPLAY_FAILED' });
});
~~~

- [ ] **Step 2: 写 dry-run/READY 一般性 RED**

在两个既有 integration tests 中构造同时产生 scene、timeline、variable、character、entryScene 的 plan，断言：

~~~ts
expect(Object.keys(plan.dryRun.finalObjectFingerprints).sort()).toEqual([
  'character:lynn',
  'config:characters',
  'config:entryScene',
  'scene:intro',
  'timeline:intro_opening',
  'variable:flag.alpha',
]);
expect(result.status).toBe('READY');
~~~

另加未知 `targetObject`，断言 dry-run 和 execute 都是 `COMPOSITION_REPLAY_FAILED`，不能 READY。

- [ ] **Step 3: 运行 RED**

Run:

~~~powershell
npm run test -w @surdet/authoring -- working-object-fingerprint.test.ts integration-execution.test.ts
npm run test -w @surdet/cli -- composition-service.test.ts
~~~

Expected: 至少因函数不存在、variable/config 未回读、未知类型被静默跳过而 FAIL。保存 RED 日志与身份。

- [ ] **Step 4: 实现唯一 resolver**

`working-object-fingerprint.ts` 必须采用如下分派，不从 diff/result 猜类型：

~~~ts
export async function fingerprintWorkingObject(
  workingFiles: Readonly<Record<string, string>>,
  objectRef: string,
  hasher: TextHasher,
): Promise<WorkingObjectFingerprintResult> {
  const present = async (value: unknown): Promise<WorkingObjectFingerprintResult> => ({
    objectRef: objectRef as ComposableObjectRef,
    state: 'present',
    fingerprint: await hasher.sha256(stableStringify({ objectRef, state: 'present', value })),
  });
  const absent = async (): Promise<WorkingObjectFingerprintResult> => ({
    objectRef: objectRef as ComposableObjectRef,
    state: 'absent',
    fingerprint: await hasher.sha256(stableStringify({ objectRef, state: 'absent' })),
  });

  if (objectRef.startsWith('scene:')) {
    const id = assertSafeSemanticId(objectRef.slice('scene:'.length));
    const text = workingFiles[`content/scenario/${id}.gal`];
    return text === undefined ? absent() : present(text);
  }
  if (objectRef.startsWith('timeline:')) {
    const id = assertSafeSemanticId(objectRef.slice('timeline:'.length));
    const text = workingFiles[timelinePathFor(id)];
    return text === undefined ? absent() : present(JSON.parse(text));
  }
  const config = parseConfigObject(workingFiles['game.config.json']);
  if (objectRef.startsWith('variable:')) {
    const id = objectRef.slice('variable:'.length);
    return Object.prototype.hasOwnProperty.call(config.variables, id)
      ? present(config.variables[id])
      : absent();
  }
  if (objectRef.startsWith('character:')) {
    const id = objectRef.slice('character:'.length);
    return Object.prototype.hasOwnProperty.call(config.characters, id)
      ? present(config.characters[id])
      : absent();
  }
  if (objectRef === 'config:characters') return present(config.characters);
  if (objectRef === 'config:entryScene') return present(config.entryScene ?? null);
  throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', `不支持的已声明产物：${objectRef}`);
}
~~~

实现中的 `assertSafeSemanticId` 与 `parseConfigObject` 必须是本文件私有小函数；配置顶层非 object 使用现有 `parseConfigDocument`，不得复制第二套 JSON 顶层验证。

- [ ] **Step 5: 删除两份私有 resolver 并接线**

从 `integration-execution.ts` 删除 `workingFingerprint()`，从 `composition-service.ts` 删除 `objectFingerprintFromWorking()` / `requiresFingerprint()`。所有 plan provenance 产物均调用共享 resolver；不再使用 `startsWith(scene/timeline)` continue。

- [ ] **Step 6: 运行 GREEN 与相邻回归**

Run:

~~~powershell
npm run test -w @surdet/authoring -- working-object-fingerprint.test.ts integration-execution.test.ts integration-plan.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- composition-service.test.ts
npm run typecheck -w @surdet/cli
~~~

Expected: 全部 PASS；unknown declared product 永远不能 READY。

- [ ] **Step 7: 精确提交**

Commit message:

~~~text
fix(authoring): unify composition object fingerprints
~~~

提交后记录 `WORKING_FINGERPRINT_HEAD`、范围、测试与 RED/GREEN artifact。

---

### Task 2: Comparison Review Projection 与稳定人类审阅合同

**Files:**
- Create: `packages/authoring/src/review-contracts.ts`
- Create: `packages/authoring/src/review-projection.ts`
- Create: `packages/authoring/test/review-projection.test.ts`
- Modify: `packages/authoring/src/index.ts`
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: `CompositionComparison`、候选 intent/criteria、对象索引、candidate semantic diff
- Produces: `buildComparisonReviewProjection(input, hasher): Promise<HumanReviewProjection>`

- [ ] **Step 1: 写 A/D/C/B projection RED**

固定四候选：

- A 与 D 对 `scene:wave6_alpha`、`variable:flag.alpha` 相同；
- C 对同一 scene 产生不同 fingerprint；
- B 产生 `scene:wave6_beta` 并依赖 `timeline:wave6_beta_opening`；
- A/B/D 证据 fresh，C validation warning 可见。

断言：

~~~ts
expect(projection.kind).toBe('comparison');
expect(projection.state).toBe('COMPARISON_PREPARED');
expect(projection.safeGroups).toEqual(expect.arrayContaining([
  expect.objectContaining({ primaryObject: 'scene:wave6_alpha', sourceCount: 2 }),
  expect.objectContaining({ primaryObject: 'variable:flag.alpha', sourceCount: 2 }),
]));
expect(projection.conflicts).toContainEqual(expect.objectContaining({
  code: 'OBJECT_RESULTS_DIVERGE',
  severity: 'selection-required',
  objectRefs: ['scene:wave6_alpha'],
  allowedResolutions: ['choose-unit', 'exclude-all'],
}));
expect(projection.dependencies).toContainEqual(expect.objectContaining({
  objectRef: 'timeline:wave6_beta_opening',
  inclusion: 'implicit',
}));
expect(projection.candidates.map((item) => item.displayOrdinal)).toEqual(['A', 'B', 'C', 'D']);
~~~

- [ ] **Step 2: 写 blocking 与证据缺失 RED**

断言 blocking conflict 使 `canCreateDecision=false`；missing/stale evidence 显示原状态，不得投影成“无影响”或“通过”。

- [ ] **Step 3: 运行 RED**

Run:

~~~powershell
npm run test -w @surdet/authoring -- review-projection.test.ts
~~~

Expected: FAIL，因为 review contracts/projection 尚不存在。

- [ ] **Step 4: 完整定义 typed projection**

`review-contracts.ts` 中不得把这些字段写成 `unknown`：

~~~ts
export interface ReviewCandidate {
  candidateId: string;
  ref: CandidateCapsuleRef;
  displayOrdinal: string;
  declaredIntent?: string;
  acceptanceCriteria: string[];
  evidence: CandidateEvidenceSummary;
}

export interface ReviewSafeGroup {
  groupId: string;
  primaryObject: string;
  finalFingerprint: string;
  unitIds: string[];
  candidateIds: string[];
  sourceCount: number;
  includedByDefault: true;
}

export interface ReviewConflict {
  conflictId: string;
  severity: CompositionConflict['severity'];
  code: string;
  unitIds: string[];
  candidateIds: string[];
  objectRefs: string[];
  allowedResolutions: CompositionConflict['allowedResolutions'];
  repairActions: string[];
}

export interface ReviewDependency {
  fromUnitId: string;
  toUnitId: string;
  objectRef: string;
  inclusion: 'explicit' | 'implicit';
}

export interface ReviewEvidenceSummary {
  candidateMatrix: CompositionComparison['evidenceMatrix'];
  blockingCount: number;
  selectionRequiredCount: number;
  advisoryCount: number;
  canCreateDecision: boolean;
}
~~~

- [ ] **Step 5: 实现纯 projection**

`buildComparisonReviewProjection` 只做规范排序与投影：

~~~ts
export interface BuildComparisonReviewProjectionInput {
  reviewId: string;
  comparison: CompositionComparison;
  candidates: Array<Pick<VerifiedCompositionCandidate,
    'candidateId' | 'ref' | 'evidenceSummary'> & {
      intent?: string;
      acceptanceCriteria: string[];
    }>;
  objects: AuthoringObject[];
}

export async function buildComparisonReviewProjection(
  input: BuildComparisonReviewProjectionInput,
  hasher: TextHasher,
): Promise<HumanReviewProjection>;
~~~

`reviewFingerprint` 只包含稳定语义字段，不含时间、绝对路径、中文展示文案或候选模型名称。若 intent 缺失，task 使用 `generated-fallback`，不发明 Agent 的目标。

- [ ] **Step 6: 运行 GREEN 与确定性检查**

同一 comparison 打乱 candidates/units/conflicts 输入顺序后投影和 fingerprint 必须相同；candidate ordinal 由规范 candidate 顺序派生。

Run:

~~~powershell
npm run test -w @surdet/authoring -- review-projection.test.ts candidate-comparison.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
~~~

Expected: PASS。

- [ ] **Step 7: 精确提交**

Commit message:

~~~text
feat(authoring): project candidate reviews
~~~

---

### Task 3: 人类决定回执、Reviewed Plan 与 Actor 固定

**Files:**
- Create: `packages/authoring/src/review-receipts.ts`
- Create: `packages/authoring/test/review-receipts.test.ts`
- Modify: `packages/authoring/src/integration-plan.ts`
- Modify: `packages/authoring/test/integration-plan.test.ts`
- Modify: `packages/authoring/src/index.ts`
- Modify: `packages/cli/src/authoring/composition-service.ts`
- Modify: `packages/cli/test/composition-service.test.ts`
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: `HumanReviewProjection`、`ComparisonDecisionReceipt`、fresh comparison
- Produces: `validateComparisonDecision()`、`decisionToPlanSelection()`、`reviewState` plan binding

- [ ] **Step 1: 写合法决定和 stale RED**

~~~ts
it('mechanically turns a valid receipt into human resolutions', async () => {
  const verified = await validateComparisonDecision({ projection, receipt }, hasher);
  const selection = decisionToPlanSelection(verified);
  expect(selection.conflictResolutions.every((item) => item.actor === 'human')).toBe(true);
  expect(selection.review).toEqual({
    reviewState: 'human-reviewed',
    reviewId: receipt.reviewId,
    decisionId: receipt.decisionId,
    decisionFingerprint: receipt.decisionFingerprint,
  });
});

it.each([
  'comparisonFingerprint',
  'projectIdentity',
  'expectedProjectRevision',
  'candidateRefs',
] as const)('rejects stale %s', async (field) => {
  await expect(validateComparisonDecision({
    projection,
    receipt: mutateReceipt(receipt, field),
  }, hasher)).rejects.toMatchObject({ code: 'REVIEW_DECISION_STALE' });
});
~~~

另测缺 conflict、重复 conflict、非法 chosenUnitId、blocking、`regenerate-candidate` 不可继续 plan，错误分别为 `REVIEW_DECISION_INVALID` / `REVIEW_RETURNED`。

- [ ] **Step 2: 写 direct plan 绕过 RED**

现有 direct input 仍能 dry-run，但断言：

~~~ts
expect(directPlan.review).toEqual({ reviewState: 'unreviewed' });
expect(reviewedPlan.review.reviewState).toBe('human-reviewed');
expect(reviewedPlan.conflictResolutions.every((item) => item.actor === 'human')).toBe(true);
~~~

MCP 风格 reviewed input 若额外传 actor、selectedUnitIds 或 replayOperations，必须 schema/领域拒绝。

- [ ] **Step 3: 运行 RED**

Run:

~~~powershell
npm run test -w @surdet/authoring -- review-receipts.test.ts integration-plan.test.ts
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- composition-service.test.ts
~~~

Expected: FAIL 于回执函数、review binding 或绕过断言。

- [ ] **Step 4: 实现规范 decision fingerprint**

~~~ts
export async function decisionFingerprintOf(
  receipt: Omit<ComparisonDecisionReceipt, 'decisionFingerprint'>,
  hasher: TextHasher,
): Promise<string> {
  return hasher.sha256(stableStringify({
    receiptVersion: receipt.receiptVersion,
    decisionId: receipt.decisionId,
    reviewId: receipt.reviewId,
    comparisonFingerprint: receipt.comparisonFingerprint,
    projectIdentity: receipt.projectIdentity,
    expectedProjectRevision: receipt.expectedProjectRevision,
    candidateRefs: normalizeCandidateRefs(receipt.candidateRefs),
    selectedUnitIds: [...receipt.selectedUnitIds].sort(),
    conflictResolutions: normalizeReceiptResolutions(receipt.conflictResolutions),
    reviewerChannel: receipt.reviewerChannel,
  }));
}
~~~

`decidedAt` 和本地备注不进入 fingerprint；decisionId 进入，防止两个互斥决定共用身份。

- [ ] **Step 5: 实现严格校验与机械转换**

`validateComparisonDecision` 必须重新计算 projection/review/comparison identity，并返回不可由调用方伪造 actor 的内部类型：

~~~ts
export interface VerifiedComparisonDecision {
  receipt: ComparisonDecisionReceipt;
  selectedUnitIds: string[];
  conflictResolutions: ConflictResolutionInput[];
  review: Extract<IntegrationReviewBinding, { reviewState: 'human-reviewed' }>;
}
~~~

每个 `selection-required` conflict 恰有一个 resolution；`regenerate-candidate` 抛 `REVIEW_RETURNED`；blocking 永不通过。

- [ ] **Step 6: 扩展 plan 而不破坏 direct stage**

`BuildIntegrationPlanInput` 增加 `review: IntegrationReviewBinding`，direct service 传 `{reviewState:'unreviewed'}`，reviewed service 使用 verified decision。`sealDryRunResult()` 的 semantic fingerprint 包含 `review`。

- [ ] **Step 7: 运行 GREEN**

Run:

~~~powershell
npm run test -w @surdet/authoring -- review-receipts.test.ts integration-plan.test.ts candidate-comparison.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- composition-service.test.ts
npm run typecheck -w @surdet/cli
~~~

Expected: PASS；direct 和 reviewed 两条路径身份不同且都确定性。

- [ ] **Step 8: 精确提交**

Commit message:

~~~text
feat(authoring): validate human review decisions
~~~

---

### Task 4: Result Review、最终批准与 Integration Commit Gate

**Files:**
- Modify: `packages/authoring/src/review-contracts.ts`
- Modify: `packages/authoring/src/review-projection.ts`
- Modify: `packages/authoring/src/review-receipts.ts`
- Modify: `packages/authoring/src/integration-execution.ts`
- Modify: `packages/authoring/src/change-session.ts`
- Modify: `packages/authoring/src/contracts.ts`
- Modify: `packages/authoring/test/review-projection.test.ts`
- Modify: `packages/authoring/test/review-receipts.test.ts`
- Modify: `packages/authoring/test/integration-execution.test.ts`
- Modify: `packages/authoring/test/commit-recovery.test.ts`
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: reviewed `IntegrationPlan`、READY `ChangeRecord`、fresh diff/validation/simulation/runtime facts、result tree identity
- Produces: `buildResultReviewProjection()`、`validateFinalApproval()`、`bindVerifiedApproval()`、approval-aware `commitChange()`

- [ ] **Step 1: 写 result readiness RED**

构造以下矩阵：

| Case | Expected |
|---|---|
| plan unreviewed | `REVIEW_RESULT_NOT_READY` |
| integration REPLAYING/FAILED | `REVIEW_RESULT_NOT_READY` |
| diff missing/stale | `REVIEW_RESULT_NOT_READY` |
| validation missing/stale/failed | `REVIEW_RESULT_NOT_READY` |
| simulation missing/stale/incomplete | `REVIEW_RESULT_NOT_READY` |
| runtime missing/stale/failed | `REVIEW_RESULT_NOT_READY` |
| READY + all fresh | result projection created |

核心断言：

~~~ts
expect(resultProjection.finalResult).toMatchObject({
  planId: reviewedPlan.planId,
  planFingerprint: reviewedPlan.planFingerprint,
  integrationChangeId: change.record.changeId,
  workingRevision: change.record.workingRevision,
  resultTreeSha256,
});
~~~

- [ ] **Step 2: 写 approval freshness RED**

合法 receipt 通过；逐一改变 planFingerprint、changeId、workingRevision、diffFingerprint、任一 evidenceId、runtimeTraceIds、project revision 或 resultTreeSha256，全部 `REVIEW_APPROVAL_STALE`。

~~~ts
const verified = await validateFinalApproval({
  projection: resultProjection,
  receipt: approval,
  current: currentResultFacts,
}, hasher);
expect(verified.receipt.approvalFingerprint).toBe(approval.approvalFingerprint);
~~~

- [ ] **Step 3: 写 commit ordering RED**

使用 recording `ProjectWriteStorage`：

~~~ts
const events: string[] = [];
const storage = recordingStorage(events);
await expect(commitChange(unapprovedIntegration, storage))
  .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_REQUIRED' });
expect(events).toEqual([]);
expect(await repository.readLatestJournal(changeId)).toBeNull();
~~~

stale approval 同样 `events=[]`；普通非 integration change 仍可 commit。已批准 integration 的顺序必须为 `approval-checked` → `stage:*` → `journal:STAGING` → replacement。

- [ ] **Step 4: 运行 RED**

Run:

~~~powershell
npm run test -w @surdet/authoring -- review-projection.test.ts review-receipts.test.ts integration-execution.test.ts commit-recovery.test.ts
~~~

Expected: FAIL 于 result/approval 函数或未批准 integration 仍可进入 commit。

- [ ] **Step 5: 定义 result facts 与 return receipt**

~~~ts
export interface ReviewFinalResult {
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  diffFingerprint: string;
  changedObjects: ReviewObjectSummary[];
  evidence: ReviewEvidenceBinding;
  resultTreeSha256: string;
  warnings: ReviewWarning[];
}

export interface ReturnRequestReceipt {
  receiptVersion: '1.0.0';
  returnId: string;
  resultReviewId: string;
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  reasonCategory: 'content' | 'presentation' | 'causal-impact' | 'validation-warning' | 'other';
  reviewerChannel: 'surdet-editor-local';
  returnedAt: string;
  returnFingerprint: string;
}
~~~

`FinalApprovalReceipt` 与 `ReturnRequestReceipt` 对同一 resultReviewId 互斥；两者同时存在为 `REVIEW_IDENTITY_MISMATCH`，不得挑一个继续。

- [ ] **Step 6: 扩展 integration metadata**

~~~ts
export interface IntegrationReviewMetadata {
  binding: IntegrationReviewBinding;
  resultReview?: {
    reviewId: string;
    resultTreeSha256: string;
    diffFingerprint: string;
    evidence: ReviewEvidenceBinding;
    workingRevision: number;
  };
  approval?: {
    approvalId: string;
    approvalFingerprint: string;
    bindingFingerprint: string;
  };
}
~~~

`IntegrationMetadata` 增加 `review: IntegrationReviewMetadata`。execute 初始化时从 plan 复制 binding；prepare-result 后以 CAS 写入 resultReview；inspect-approval 验证成功后以 CAS 写入 approval。每次 workingRevision mutation 后旧 result/approval 不得继续有效。

- [ ] **Step 7: 实现批准校验与 commit gate**

`commitChange()` 的第一组调用顺序固定为：

~~~ts
assertIntegrationReadyForCommit(change.record);
assertIntegrationOwnerApprovalForCommit(change.record);
assertOpen(change);
~~~

`assertIntegrationOwnerApprovalForCommit` 行为：

~~~ts
export function assertIntegrationOwnerApprovalForCommit(record: ChangeRecord): void {
  const integration = record.integration;
  if (integration === undefined) return;
  if (integration.review.binding.reviewState !== 'human-reviewed') {
    throw new AuthoringOperationError('REVIEW_APPROVAL_REQUIRED', '未审阅 integration plan 不可提交');
  }
  const result = integration.review.resultReview;
  const approval = integration.review.approval;
  if (result === undefined || approval === undefined) {
    throw new AuthoringOperationError('REVIEW_APPROVAL_REQUIRED', '缺少项目所有者最终批准');
  }
  if (result.workingRevision !== record.workingRevision) {
    throw new AuthoringOperationError('REVIEW_APPROVAL_STALE', '批准对应的 workingRevision 已变化');
  }
}
~~~

完整实现还必须核对 approval binding fingerprint；上面代码是最小顺序骨架，不允许省略绑定比较。

- [ ] **Step 8: 运行 GREEN 与普通 commit 回归**

Run:

~~~powershell
npm run test -w @surdet/authoring -- review-projection.test.ts review-receipts.test.ts integration-execution.test.ts commit-recovery.test.ts change-session.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
~~~

Expected: PASS；普通 change 不要求 approval；integration 在任何 staging 之前 fail-closed。

- [ ] **Step 9: 精确提交**

Commit message:

~~~text
feat(authoring): gate reviewed integrations
~~~

---

### Task 5: Node Review Store、不可变 Workspace 与实际 Preview Fixture

**Files:**
- Create: `packages/cli/src/authoring/node-review-store.ts`
- Create: `packages/cli/src/authoring/review-service.ts`
- Create: `packages/cli/test/node-review-store.test.ts`
- Create: `packages/cli/test/review-service.test.ts`
- Modify: `packages/cli/src/authoring/composition-service.ts`
- Modify: `packages/cli/test/composition-service.test.ts`
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: project identity/data root、comparison、reviewed plan、READY change、review projection/receipt validators
- Produces: `NodeReviewStore`、`ReviewService.prepareComparison()`、`inspectDecision()`、`prepareResult()`、`inspectApproval()`

- [ ] **Step 1: 写路径与 create-only RED**

`node-review-store.test.ts` 必须覆盖：

~~~ts
it.each(['../escape', '..\\escape', 'a/b', 'a\\b', '', 'CON', 'name.'])
  ('rejects unsafe review id %s', async (reviewId) => {
    await expect(store.createReview(reviewId, payload)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

it('is idempotent for the same bytes and rejects identity reuse', async () => {
  const first = await store.createReview('rev_safe', payload);
  const second = await store.createReview('rev_safe', payload);
  expect(second).toEqual(first);
  await expect(store.createReview('rev_safe', changedPayload))
    .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
});
~~~

另测：payload/identity 缺失、bytes/SHA 不符、JSON corrupt、symlink/junction 逃逸、另一个 project namespace、绝对路径泄露。

- [ ] **Step 2: 写 result fixture RED**

使用基线项目与 READY workingFiles：

~~~ts
const prepared = await service.prepareResult({
  planId,
  artifactSha256,
  changeId,
});
expect(prepared.projection.finalResult?.resultTreeSha256).toBe(
  await hashProjectTree(prepared.projectDirectory),
);
expect(await readText(prepared.projectDirectory, 'content/scenario/wave6_alpha.gal'))
  .toBe(change.workingFiles['content/scenario/wave6_alpha.gal']);
expect(await hashProjectTree(originalProject)).toBe(originalBefore);
~~~

路径逃逸、symlink、missing file、working deletion 和额外探索文件必须有明确测试。

- [ ] **Step 3: 写四项 service RED**

~~~ts
const comparison = await service.prepareComparison({ candidateRefs });
await expect(service.inspectDecision({
  reviewId: comparison.reviewId,
})).rejects.toMatchObject({ code: 'REVIEW_DECISION_REQUIRED' });

const result = await service.prepareResult({ planId, artifactSha256, changeId });
await expect(service.inspectApproval({
  resultReviewId: result.reviewId,
})).rejects.toMatchObject({ code: 'REVIEW_APPROVAL_REQUIRED' });
~~~

写入合法 fixture receipt 后 inspect 成功；改变项目 revision 或 change workingRevision 后 stale。

- [ ] **Step 4: 运行 RED**

Run:

~~~powershell
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- node-review-store.test.ts review-service.test.ts composition-service.test.ts
~~~

Expected: FAIL，因为 NodeReviewStore/ReviewService 尚不存在。

- [ ] **Step 5: 实现 project-namespaced 路径**

目录固定为：

~~~text
<SURDET_AGENT_DATA_DIR>/<projectIdentity>/reviews/<reviewId>/
  identity.json
  comparison/review.json
  decision.json
  result/review.json
  result/project/
  final-approval.json
  return-request.json
~~~

`NodeReviewStore` 构造器必须验证 basename 等于 expected project identity，并用 `path.relative()`、`lstat()`、`realpath()` 验证每层目录不是 symlink/junction。JSON create-only 复用 `createJsonRecord()`，不得手写另一套临时文件替换。

- [ ] **Step 6: 实现 review identity sidecar**

~~~ts
export interface ReviewWorkspaceIdentity {
  reviewVersion: '1.0.0';
  reviewId: string;
  kind: ReviewKind;
  projectIdentity: string;
  expectedProjectRevision: string;
  comparisonFingerprint: string;
  planFingerprint?: string;
  integrationChangeId?: string;
  workingRevision?: number;
  payload: ReviewArtifactIdentity;
}
~~~

sidecar 的 `payload.relativePath` 必须等于固定路径；读取时重新计算 bytes/SHA，不信任 sidecar 自报。

- [ ] **Step 7: 实现 preview fixture 机械生成**

算法顺序：

1. 创建新的 review result 临时目录；
2. 递归复制项目白名单文件，拒绝 symlink/junction；
3. 对 `ChangeRecord.workingFiles` 覆盖文件；
4. 对 base 存在但 working 不存在的文件执行删除；
5. 重新枚举 tree，拒绝仓库外路径和生成目录；
6. 计算规范 tree identity；
7. 对比原始项目 revision 未变化；
8. 写 result projection 与 identity；
9. 最后将目录 create-only 发布为 reviewId。

tree identity 输入为按相对 POSIX path 排序的 `{path,bytes,sha256}`，不含 mtime、ACL、绝对路径。

- [ ] **Step 8: 实现四项 ReviewService**

~~~ts
export class ReviewService {
  async prepareComparison(input: {
    candidateRefs: CandidateCapsuleRef[];
  }): Promise<PreparedReviewResult>;

  async inspectDecision(input: {
    reviewId: string;
    decisionId?: string;
  }): Promise<VerifiedComparisonDecision>;

  async prepareResult(input: {
    planId: string;
    artifactSha256: string;
    changeId: string;
  }): Promise<PreparedReviewResult>;

  async inspectApproval(input: {
    resultReviewId: string;
    approvalId?: string;
  }): Promise<VerifiedReviewApproval | VerifiedReturnRequest>;
}
~~~

`prepareComparison` 现场重算 comparison；`inspectDecision` 回读 create-only receipt 后现场比较；`prepareResult` 必须持短 change/project lease 取得一致事实；`inspectApproval` 重新读取当前 change 和 result tree。

- [ ] **Step 9: 运行 GREEN**

Run:

~~~powershell
npm run test -w @surdet/cli -- node-review-store.test.ts review-service.test.ts composition-service.test.ts node-json-record.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
~~~

Expected: PASS；fixture 与 working files 一致，原始项目不变。

- [ ] **Step 10: 精确提交**

Commit message:

~~~text
feat(cli): persist human review workspaces
~~~

---

### Task 6: Capability Registry、CLI Dispatcher、Session 与 MCP 薄投影

**Files:**
- Modify: `packages/authoring/src/capability-contract.ts`
- Modify: `packages/authoring/src/capability-registry.ts`
- Modify: `packages/authoring/src/error-catalog.ts`
- Modify: `packages/authoring/test/capability-registry.test.ts`
- Modify: `packages/authoring/test/error-catalog.test.ts`
- Modify: `packages/cli/src/authoring/authoring-service.ts`
- Modify: `packages/cli/src/authoring/authoring-dispatcher.ts`
- Modify: `packages/cli/src/agent-port/session.ts`
- Modify: `packages/cli/src/agent-port/server.ts`
- Create: `packages/cli/test/agent-port-review.test.ts`
- Modify: `packages/cli/test/authoring-contract.test.ts`
- Modify: `packages/cli/test/agent-port-output-contract.test.ts`
- Modify: `packages/cli/test/agent-port-session.test.ts`
- Modify: `packages/cli/test/agent-port-tools.test.ts`
- Modify: `packages/cli/test/agent-port-security.test.ts`
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: `ReviewService` 与四项共享 review contracts
- Produces: contract 2.1.0、30 项 registry、四项 native/MCP 能力、approvalRef commit 接线

- [ ] **Step 1: 写 registry/error RED**

~~~ts
expect(AUTHORING_CONTRACT_VERSION).toBe('2.1.0');
expect(AUTHORING_CAPABILITY_IDS).toHaveLength(30);
expect(AUTHORING_CAPABILITY_IDS.slice(-4)).toEqual([
  'review.prepare-comparison',
  'review.inspect-decision',
  'review.prepare-result',
  'review.inspect-approval',
]);
expect(errorDefinition('REVIEW_DECISION_REQUIRED').retryDisposition)
  .toBe('after-human-review');
~~~

断言四项 `composable=false`、policy 正确、schema `additionalProperties=false`、registry 无中文长文案/Prompt/example library。

- [ ] **Step 2: 写 Agent 不可写回执 RED**

~~~ts
expect(AUTHORING_CAPABILITY_IDS).not.toContain('review.write-decision');
expect(AUTHORING_CAPABILITY_IDS).not.toContain('review.approve');
expect(tools.map((tool) => tool.name)).not.toContain('surdet_review_write_decision');
expect(tools.map((tool) => tool.name)).not.toContain('surdet_review_approve');
~~~

并扫描 capability input schema，禁止出现自由 `receipt` object、`actor`、绝对 `path` 或任意文件内容字段。

- [ ] **Step 3: 写 dispatcher/session/commit RED**

测试四项通过 dispatcher 到 ReviewService；`REVIEW_DECISION_REQUIRED` 和 `REVIEW_APPROVAL_REQUIRED` 返回 structured envelope 与 `after-human-review`；`change.commit` 对 integration 接受：

~~~ts
{
  approvalRef: {
    resultReviewId: 'rev_result_123',
    approvalId: 'apr_123',
    approvalFingerprint: 'a'.repeat(64),
  },
}
~~~

普通 change 可传空 object；integration 未传 approvalRef 失败。Agent Port session 只显示 `waitingFor='human-decision' | 'human-approval'`，不自动重试。

- [ ] **Step 4: 运行 RED**

Run:

~~~powershell
npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- agent-port-review.test.ts authoring-contract.test.ts agent-port-output-contract.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-security.test.ts
~~~

Expected: FAIL 于版本、能力、error、dispatcher 或 commit input。

- [ ] **Step 5: 升级合同并增加 retry disposition**

精确修改：

~~~ts
export const AUTHORING_CONTRACT_VERSION = '2.1.0' as const;

export type RetryDisposition =
  | 'same-request'
  | 'after-inspect'
  | 'after-refresh'
  | 'after-repair'
  | 'after-human-review'
  | 'new-change'
  | 'manual-recovery'
  | 'never';
~~~

同步 output schema enum；不改 envelope/delivery capsule 版本。

- [ ] **Step 6: 增加四项严格 schema**

`review.prepare-comparison` 输入仅 `candidateRefs`；`review.inspect-decision` 仅 `reviewId` 和可选 `decisionId`；`review.prepare-result` 仅 plan identity/changeId；`review.inspect-approval` 仅 resultReviewId 和可选 approvalId。

`composition.plan` 使用 `oneOf`：

1. direct：candidateRefs/comparisonFingerprint/selectedUnitIds/conflictResolutions；
2. reviewed：candidateRefs/comparisonFingerprint/reviewDecision；

两者互斥，reviewed 分支不接受 selectedUnitIds、actor 或 replay payload。

- [ ] **Step 7: 接线 AuthoringService 与 dispatcher**

`AuthoringService` 只做 facade：

~~~ts
async prepareComparisonReview(projectRoot: string, input: PrepareComparisonInput) {
  return (await this.reviewService(projectRoot)).prepareComparison(input);
}

async inspectReviewDecision(projectRoot: string, input: InspectDecisionInput) {
  return (await this.reviewService(projectRoot)).inspectDecision(input);
}
~~~

其余两项同构。dispatcher 增加四个 case，不解析 projection、不计算 fingerprint。

- [ ] **Step 8: 接线 reviewed plan 与 commit approval**

`planComposition` 检测严格 union：reviewed 分支调用 `inspectDecision` 并机械传入 CompositionService；direct 分支明确生成 unreviewed。`commit(changeId, approvalRef?)` 对 integration：

1. 在 project/change lease 内回读 record；
2. 调用 ReviewService.inspectApproval；
3. return receipt → `REVIEW_RETURNED`；
4. verified approval → CAS bind 到 integration metadata；
5. 重新读取 record 后调用 `commitChange`；
6. approval 失败时没有 project staging/journal。

- [ ] **Step 9: Session 状态与 nextActions**

session 输出新增只读摘要：

~~~ts
review?: {
  reviewState: 'unreviewed' | 'awaiting-decision' | 'human-reviewed' | 'awaiting-approval' | 'owner-approved' | 'returned' | 'stale';
  reviewId?: string;
  resultReviewId?: string;
  waitingFor?: 'human-decision' | 'human-approval';
}
~~~

不得暴露本机绝对 review 路径；只给相对路径和稳定 ID。

- [ ] **Step 10: 运行 GREEN 与 MCP 双协议 preflight 单测**

Run:

~~~powershell
npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts review-receipts.test.ts integration-plan.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- agent-port-review.test.ts authoring-contract.test.ts agent-port-output-contract.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-security.test.ts composition-service.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
~~~

Expected: PASS；modern 与 legacy protocol 的具体进程级 preflight 留到 Task 10。

- [ ] **Step 11: 精确提交**

Commit message:

~~~text
feat(cli): expose human review capabilities
~~~

---

### Task 7: Editor Review Workspace、中文模型与回执写入

**Files:**
- Create: `packages/editor/src/review-workspace.ts`
- Create: `packages/editor/src/review-model.ts`
- Create: `packages/editor/test/review-workspace.test.ts`
- Create: `packages/editor/test/review-model.test.ts`
- Modify: `packages/editor/src/state.ts`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/test/project-io.test.ts`
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: shared `HumanReviewProjection` / receipt types、File System Access handles
- Produces: `openReviewWorkspace()`、`writeDecisionReceipt()`、`writeApprovalReceipt()`、`writeReturnReceipt()`、`ReviewWorkspaceState`

- [ ] **Step 1: 写 workspace identity RED**

用内存 File System Access fake 覆盖：

~~~ts
const loaded = await openReviewWorkspace(rootHandle, hasher);
expect(loaded.projection.reviewId).toBe('rev_comparison_1');
expect(loaded.identity.payload.sha256).toBe(await sha256(reviewBytes));
~~~

payload/sidecar mismatch、unsupported reviewVersion、missing project identity、两个互斥 receipt 同时存在分别 fail-loud；不得自动修原包。

- [ ] **Step 2: 写 create-only receipt RED**

~~~ts
const first = await writeDecisionReceipt(workspace, draft, now);
const same = await writeDecisionReceipt(workspace, draft, now);
expect(same).toEqual(first);
await expect(writeDecisionReceipt(workspace, changedDraft, now))
  .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
~~~

不同决定必须由 UI 生成新 decisionId；approval/return 互斥；Editor 不写绝对 path、actor 或 replayOperations。

- [ ] **Step 3: 写中文模型 RED**

~~~ts
expect(labelForObjectKind('scene')).toBe('场景');
expect(labelForObjectKind('timeline')).toBe('时间轴');
expect(labelForReviewState('STAGE_READY')).toBe('结果已准备，请检查');
expect(labelForConflictSeverity('selection-required')).toBe('需要你决定');
expect(labelForUnknownCode('X_NEW')).toBe('未识别的问题（查看技术详情）');
~~~

blocking 时 `canSealDecision=false`；所有 selection-required 已决定时为 true；safe groups 不要求逐项点击。

- [ ] **Step 4: 运行 RED**

Run:

~~~powershell
npm run build -w @surdet/authoring
npm run test -w surdet-editor -- review-workspace.test.ts review-model.test.ts project-io.test.ts
~~~

Expected: FAIL，因为新模块和 `review` tab 尚不存在。

- [ ] **Step 5: 定义 Editor review 状态**

~~~ts
export interface ReviewWorkspaceState {
  rootHandle: FileSystemDirectoryHandle;
  identity: ReviewWorkspaceIdentity;
  projection: HumanReviewProjection;
  decisionDraft: ReviewDecisionDraft;
  selectedReviewObjectRef: string | null;
  projectHandle: FileSystemDirectoryHandle | null;
  officialResultTreeSha256: string | null;
  currentResultTreeSha256: string | null;
  fixtureChanged: boolean;
  receiptStatus: 'none' | 'decision-written' | 'approval-written' | 'returned';
}
~~~

`state.mainTab` 增加 `'review'`，并增加 `reviewWorkspace: ReviewWorkspaceState | null`。关闭/打开普通项目不得静默保留另一个 review 的状态。

- [ ] **Step 6: 实现 File System Access 读取**

`openReviewWorkspace` 必须先读 `identity.json`，再按 kind 读固定 payload；检查 bytes/SHA/relativePath，不接受 payload 内绝对路径。读取 receipt 只用于显示，语义最终仍由共享层/Agent Port验证。

- [ ] **Step 7: 实现 Editor receipt writer**

Editor 使用 shared fingerprint helper 生成 receipt；写入前检查目标不存在。浏览器 API 不提供真正的原子 exclusive create，因此产品边界固定为：

1. 读取目标确认不存在；
2. 写入新文件；
3. 立即回读 bytes/SHA 与内容；
4. 若发现不匹配，显示 `REVIEW_IDENTITY_MISMATCH` 并停止；
5. 最终 Node/Agent inspect 才是权威 create-only 校验。

不得把浏览器检查描述成跨进程强原子。

- [ ] **Step 8: 提取 `openProjectFromHandle()`**

`project-io.ts` 结构调整为：

~~~ts
export async function openProject(): Promise<void> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await openProjectFromHandle(handle);
}

export async function openProjectFromHandle(
  handle: FileSystemDirectoryHandle,
  options: { source?: 'normal' | 'review-fixture' } = {},
): Promise<void>;
~~~

原有普通项目路径、保存句柄、EOL、资产枚举与 preview 行为保持不变；review fixture 只传 `project/` 子句柄。

- [ ] **Step 9: 运行 GREEN 与 Editor 相邻回归**

Run:

~~~powershell
npm run test -w surdet-editor -- review-workspace.test.ts review-model.test.ts project-io.test.ts model-roundtrip.test.ts
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
~~~

Expected: PASS。

- [ ] **Step 10: 精确提交**

Commit message:

~~~text
feat(editor): open human review workspaces
~~~

---

### Task 8: Editor 审阅任务 UI、因果下钻与实际 Stage 预览

**Files:**
- Create: `packages/editor/src/panels/review-panel.ts`
- Create: `packages/editor/src/review-preview.ts`
- Create: `packages/editor/test/review-panel.test.ts`
- Create: `packages/editor/test/review-preview.test.ts`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/src/state.ts`
- Modify: `packages/editor/src/causal-selection.ts`
- Modify: `packages/editor/src/panels/right.ts`
- Modify: `packages/editor/src/panels/preview-panel.ts`
- Modify: `packages/editor/src/styles.css`
- Modify: `packages/editor/test/causal-selection.test.ts`
- Modify: `packages/editor/test/preview-stage-layout.test.ts`
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: Task 7 `ReviewWorkspaceState` 与 shared projection
- Produces: 中文“审阅”页、逐项决定、对象/因果下钻、result preview、approve/return UI

- [ ] **Step 1: 写主信息架构 RED**

渲染 comparison review 后断言：

~~~ts
expect(textOf(container)).toContain('审阅任务');
expect(textOf(container)).toContain('方案 A');
expect(textOf(container)).toContain('2 个方案得到相同结果');
expect(textOf(container)).toContain('需要你决定');
expect(textOf(container)).not.toContain('OBJECT_RESULTS_DIVERGE');
expect(container.querySelector('[data-tech-details]')?.textContent)
  .toContain('OBJECT_RESULTS_DIVERGE');
~~~

默认层不显示原始英文 code；技术详情展开后显示稳定 ID、code、fingerprint、source capsule。

- [ ] **Step 2: 写 P1 交互 RED**

对 A/D/C conflict：

~~~ts
click(choiceForUnit(aUnit));
expect(decisionButton.disabled).toBe(false);
expect(getDecisionDraft().conflictResolutions).toEqual([
  { conflictId, resolution: 'choose-unit', chosenUnitId: aUnit },
]);
~~~

safe identical group 默认纳入但可展开；不要求用户逐项确认。选择“让 Agent 重做”后状态为 RETURNED，不生成 plan-ready decision。

- [ ] **Step 3: 写结果批准与探索失效 RED**

~~~ts
expect(approveButton.disabled).toBe(false);
markReviewFixtureChanged();
expect(approveButton.disabled).toBe(true);
expect(textOf(container)).toContain('你正在查看探索性修改');
reloadOfficialResult();
expect(approveButton.disabled).toBe(false);
~~~

批准和退回按钮互斥；用户点击前不写文件。

- [ ] **Step 4: 写布局与独立滚动 RED**

断言 CSS/DOM：

- `review-task-list`、`review-main`、`review-details` 三栏各有独立滚动容器；
- conflict/causal 列表增长不改变 preview frame 可用高度；
- preview 仍由 `.preview-frame` 占据中心区域并双轴居中；
- 1280px 以下退化为任务列表折叠 + 主区 + drawer，不横向挤没预览；
- 900px 以下可以单列，但批准按钮仍固定可见且不遮挡内容。

- [ ] **Step 5: 写因果反向定位 RED**

点击 review object 后：

~~~ts
expect(state.selectedObjectRef).toBe('scene:wave6_alpha');
expect(causalPanel.textContent).toContain('当前对象');
expect(causalPanel.textContent).toContain('直接引用');
expect(causalPanel.textContent).toContain('直接被引用');
expect(causalPanel.textContent).toContain('可能影响');
expect(causalPanel.textContent).toContain('实际观察');
~~~

点击 scene/timeline/cue/trace event 复用已有块编辑、timeline 和 preview trace 跳转；无 trace 明确显示“尚未观察”。

- [ ] **Step 6: 运行 RED**

Run:

~~~powershell
npm run test -w surdet-editor -- review-panel.test.ts review-preview.test.ts causal-selection.test.ts preview-stage-layout.test.ts
~~~

Expected: FAIL 于新 panel、状态或布局断言。

- [ ] **Step 7: 增加“审阅”顶层入口**

`main.ts` 增加：

~~~ts
const defs: { id: MainTab; label: string }[] = [
  { id: 'editor', label: '块编辑' },
  { id: 'flow', label: '流程图' },
  { id: 'timeline', label: '时间轴' },
  { id: 'config', label: '配置' },
  { id: 'preview', label: '预览' },
  { id: 'review', label: '审阅' },
  { id: 'stats', label: '统计' },
  { id: 'audit', label: '审计' },
];
~~~

Header 增加“打开审阅任务”，与“打开游戏目录”并列但职责不同。打开 review 后默认进入 review tab；普通项目打开不自动制造 review。

- [ ] **Step 8: 实现 comparison 三栏 UI**

左栏：任务、候选、状态；中栏：safe groups、conflicts、plan summary；右栏：当前对象、因果、证据、技术详情。

按钮文案固定：

~~~text
选择这个结果
全部不要
让 Agent 重做
保存我的决定
预览这个结果
批准这个计划
退回修改
重新加载正式结果
查看技术详情
~~~

不得显示 `choose-unit`、`exclude-all`、`regenerate-candidate` 作为默认按钮文案。

- [ ] **Step 9: 实现 result UI 与实际 fixture preview**

`review-preview.ts`：

1. 取得 `result/project/` 句柄；
2. 调用 `openProjectFromHandle(projectHandle,{source:'review-fixture'})`；
3. 默认选择计划影响的第一个可运行 scene；
4. 支持明确 sceneId/choices 和 timeline 独立预览；
5. preview trace 与 result projection evidence 对照；
6. 定时或手动重新计算 tree identity，发现变化即 `fixtureChanged=true`；
7. 不把探索修改回传给 Agent 或 integration change。

- [ ] **Step 10: 实现 shared causal projection 的显示适配**

review 模式下 potential/observed 使用 projection 已携带事实；普通编辑器仍使用 authoring index + current preview trace。右侧组件只选择数据源，不重新推断关系。

- [ ] **Step 11: 实现 CSS 布局**

核心约束：

~~~css
#review-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.review-workbench {
  display: grid;
  grid-template-columns: minmax(210px, 260px) minmax(460px, 1fr) minmax(260px, 340px);
  height: 100%;
  min-height: 0;
}

.review-task-list,
.review-main,
.review-details {
  min-height: 0;
  overflow-y: auto;
}

.review-preview-shell {
  min-height: 360px;
  display: flex;
  flex-direction: column;
}
~~~

媒体查询只改变排列，不缩小 preview 到不可用高度。不得用无限增长的 DOM 把 preview 往下推。

- [ ] **Step 12: 运行 GREEN 与 Editor 全量**

Run:

~~~powershell
npm run test -w surdet-editor -- review-panel.test.ts review-preview.test.ts review-workspace.test.ts review-model.test.ts causal-selection.test.ts preview-stage-layout.test.ts preview-causal-trace.test.ts project-io.test.ts
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
~~~

Expected: 全部 PASS；记录 test file/test count，不能只写 exit 0。

- [ ] **Step 13: 精确提交**

Commit message:

~~~text
feat(editor): render human review workflow
~~~

---

### Task 9: 聚焦总门、工作区全量与唯一 `verify:all`

**Files:**
- Modify: 仅直接暴露真实回归的 Task 1–8 白名单文件
- Create temporary: `$task9Root\task9-*.log`，其中 `$task9Root` 在 Step 1 创建
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: Tasks 1–8 全部本地提交
- Produces: frozen 前完整聚焦/工作区证据与唯一 aggregate gate

- [ ] **Step 1: 核对提交链与工作树**

Run:

~~~powershell
git log --oneline --decorate -12
git status --short
git diff --check
git diff --cached --check
git diff --name-only surdet/main...HEAD
$task9Root = Join-Path $env:TEMP ("surdet-human-review-wave6-task9-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $task9Root | Out-Null
~~~

Expected: 只有任务书与 Wave 6 白名单文件；无保护文件、历史 artifacts、依赖、lockfile、生产禁区。

- [ ] **Step 2: Authoring 聚焦与全量**

Run:

~~~powershell
npm run test -w @surdet/authoring -- working-object-fingerprint.test.ts review-projection.test.ts review-receipts.test.ts integration-plan.test.ts integration-execution.test.ts commit-recovery.test.ts capability-registry.test.ts error-catalog.test.ts
npm run test -w @surdet/authoring
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
~~~

Expected: PASS，记录真实 file/test counts。

- [ ] **Step 3: CLI 聚焦与全量**

Run:

~~~powershell
npm run test -w @surdet/cli -- node-review-store.test.ts review-service.test.ts agent-port-review.test.ts composition-service.test.ts authoring-contract.test.ts agent-port-output-contract.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-security.test.ts
npm run test -w @surdet/cli
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
~~~

Expected: PASS；测试发现不得进入 `e2e/artifacts/**`。

- [ ] **Step 4: Editor 聚焦与全量**

Run:

~~~powershell
npm run test -w surdet-editor -- review-workspace.test.ts review-model.test.ts review-panel.test.ts review-preview.test.ts causal-selection.test.ts preview-stage-layout.test.ts project-io.test.ts
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
~~~

Expected: PASS。

- [ ] **Step 5: 相邻 Starter 模拟**

Run:

~~~powershell
npm run simulate -w surdet-starter
~~~

Expected: 运行时错误 0；记录真实 paths/pruned/save-load/ending 数据。不得修改 Starter 来迎合结果。

- [ ] **Step 6: 唯一正式 `verify:all`**

Run exactly once:

~~~powershell
npm run verify:all 2>&1 | Tee-Object -FilePath (Join-Path $task9Root 'task9-verify-all.log')
~~~

Expected: exit 0，抵达最终 diff-check。若失败，立即按 7.2 停止；不得在本 Step 自行重跑。

- [ ] **Step 7: 核验日志身份**

重新读取正式 log 的 path/bytes/SHA-256/exit；Ledger 记录最后通过节点、首个失败节点（PASS 时为 none）。

- [ ] **Step 8: 停止条件**

若全部通过，进入 Task 10。Task 9 不运行 DIAGNOSTIC/FORMAL，不邀请外部 Agent，不创建桌面 fixture。

---

### Task 10: 唯一聚合 Runner、Preflight、有界 DIAGNOSTIC 与唯一 FORMAL

**Files:**
- Create: `packages/cli/e2e/human-agent-review-wave-6.e2e.mjs`
- Create: `packages/cli/test/human-agent-review-wave-6-runner.test.mjs`
- Modify: `packages/cli/package.json` only if an explicit script is required; do not alter test exclusion
- Modify: 本任务书 Execution Ledger

**Interfaces:**
- Consumes: Tasks 1–9 frozen product contracts and real launchers
- Produces: preflight/DIAGNOSTIC/FORMAL/acceptance-prep artifact with exact identity

- [ ] **Step 1: 写 runner permanent contract RED**

Test must inspect source/execute modes and assert:

~~~js
assert.deepEqual(MODES, ['preflight', 'diagnostic', 'formal', 'acceptance-prep']);
assert.equal(DIAGNOSTIC_BUDGET, 3);
assert.equal(FORMAL_RUN_BUDGET, 1);
assert.match(source, /runHead/);
assert.match(source, /runnerSha256/);
assert.match(source, /trackedCodeDiffPaths/);
assert.match(source, /activeLeaseDirectories/);
assert.match(source, /childCleanupFailures/);
assert.match(source, /stageProjectMutated/);
~~~

还要断言 FORMAL 要求 clean tracked tree、`runHead===CODE_EVIDENCE_HEAD`、artifact exclusive create、浏览器/Vite/MCP child 全部清理。

- [ ] **Step 2: 运行 RED**

Run:

~~~powershell
node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs
~~~

Expected: FAIL，runner 尚不存在。

- [ ] **Step 3: 实现四模式 runner**

命令行：

~~~text
node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=preflight
node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=diagnostic
node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=formal
node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=acceptance-prep
~~~

runner 创建全新 A/B/C/D capsules，不读取历史 artifact：A/D 相同 scene+variable，C 同 scene 不同结果，B scene+timeline 依赖。每一里程碑写入 artifact。

- [ ] **Step 4: 固定 22 个 FORMAL 里程碑**

~~~text
01 launcher-preflight
02 clean-baseline
03 candidate-fixtures-sealed
04 comparison-prepared
05 identical-variable-visible
06 identical-scene-visible
07 divergent-c-visible
08 beta-timeline-dependency-visible
09 decision-required-error
10 editor-decision-receipt-visible
11 reviewed-plan-sealed
12 integration-stage-ready
13 all-product-fingerprints-read-back
14 fresh-diff-validation-simulation-runtime
15 result-review-prepared
16 approval-required-error
17 editor-result-rendered
18 exploration-invalidates-approval
19 fresh-approval-inspected
20 isolated-commit-applies-reviewed-result
21 original-starter-unchanged
22 cleanup-and-identity
~~~

FORMAL 自动化中的 Editor 使用 Playwright 启动真实 Vite build，并通过 runner 注入的 faithful File System Access handle fake 读取与写入同一组 review bytes；artifact 必须明确 `browserFileSystemAccess='harness-backed'`。这不冒充真实系统目录选择器，真实 picker 留给 Owner acceptance。

- [ ] **Step 5: 预览与语义断言**

浏览器必须证明：中文默认层、技术详情折叠、A/D 双来源、C 冲突、B timeline、逐项决定、实际 stage project、preview 居中、因果独立滚动、探索后按钮禁用、重新加载后批准。不能只断言内部 state。

- [ ] **Step 6: 错误通道与清理**

artifact 顶层固定：

~~~js
{
  status,
  evidenceClass,
  runHead,
  runnerSha256,
  trackedCodeDiffPaths,
  milestones,
  projectMutation,
  errors,
  consoleErrors,
  pageErrors,
  requestFailures,
  stderrLines,
  childCleanupFailures,
  activeLeaseDirectories,
}
~~~

所有 child 在 `finally` 清理；失败也必须写 artifact。不得 `unref()` 让 timer/child 脱离清理。

- [ ] **Step 7: GREEN runner contract 与 syntax**

Run:

~~~powershell
node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs
node --check packages/cli/e2e/human-agent-review-wave-6.e2e.mjs
~~~

Expected: PASS。

- [ ] **Step 8: 唯一 preflight**

Run once:

~~~powershell
node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=preflight
~~~

Must prove：formal launcher/cwd/dist/entry 一致、modern 与 legacy protocol、30 capabilities、contract 2.1.0、policy filter、stdout purity、child cleanup、Editor build entry、Starter unchanged。

- [ ] **Step 9: 有界 DIAGNOSTIC**

最多三次。每次运行前必须有实际代码变化和 `node --check`。每份 artifact 记录 path/bytes/SHA/runHead/runnerSha256/lastPassed/firstFailed。第 3 次失败立即停。

- [ ] **Step 10: 冻结代码证据提交**

DIAGNOSTIC 通过后，先把本轮 DIAGNOSTIC 次数、每份 artifact 身份、最后通过节点和首个失败节点追加到 Execution Ledger；再精确暂存 runner、runner test、本轮为诊断修正的白名单代码和这份任务书。提交：

~~~text
test(authoring): verify human review workflow
~~~

提交后记录 `CODE_EVIDENCE_HEAD`，确认 tracked worktree clean、staging empty。不得把未提交 Ledger 留在 FORMAL 前的工作树中，也不得为了“代码提交纯净”而省略已发生的诊断事实。

- [ ] **Step 11: 唯一 FORMAL**

设置冻结 HEAD：

~~~powershell
$env:SURDET_CODE_EVIDENCE_HEAD = (git rev-parse HEAD)
node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=formal
~~~

Expected: exit 0、22/22 milestones、`artifact.runHead===CODE_EVIDENCE_HEAD`、所有错误通道为空、活动 lease 0、原始 Starter unchanged。失败即停止。

- [ ] **Step 12: FORMAL 磁盘回读**

重新读取 `evidence.json` 与 `identity.json` 的 path/bytes/SHA，核对 runnerSha256、project tree、review payload、decision、result、approval、commit journal、before/after project identity。不得依据终端摘要填写。

---

### Task 11: Acceptance-Prep、真实外部 Agent、Owner 审阅与 Isolated Apply

**Files:**
- Read: `packages/cli/e2e/human-agent-review-wave-6.e2e.mjs`; FORMAL 后不得修改 runner
- Create outside repository: runner 使用 `crypto.randomUUID()` 生成的 `<local-path><uuid>\`
- Modify: 本任务书 Execution Ledger only after each owner-reported gate

**Interfaces:**
- Consumes: passed FORMAL code HEAD、同一正式 launcher、Owner explicit authorizations
- Produces: 一个新的桌面 comparison/result review workspace、真实 external Agent 报告、Owner 原始反馈、isolated commit evidence

### 11.1 Acceptance-prep 授权边界

Task 11 不因 Task 10 PASS 自动开始。执行 AI 必须先停在：

~~~text
FORMAL_PASSED
WAITING_FOR_OWNER_ACCEPTANCE_PREP_AUTHORIZATION
EXTERNAL_AGENT_NOT_STARTED
APPLY_NOT_AUTHORIZED
~~~

只有项目所有者明确批准唯一一次 acceptance-prep 后继续。

- [ ] **Step 1: 运行唯一 acceptance-prep**

Run once:

~~~powershell
node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=acceptance-prep
~~~

必须创建新的桌面 root，不复用 FORMAL/DIAGNOSTIC/历史 acceptance 目录。

- [ ] **Step 2: 回读 prep 身份**

必须报告：

~~~text
ACCEPTANCE_ROOT
PROJECT_ROOT
DATA_DIR
COMPARISON_REVIEW_ROOT
MCP_STAGE_CONFIG
MCP_APPLY_RESUME_TEMPLATE
EVIDENCE_PATH / BYTES / SHA256
IDENTITY_PATH / BYTES / SHA256
PROJECT_TREE_SHA256
ORIGINAL_STARTER_UNCHANGED
DATA_DIR_FILE_COUNT_BEFORE_AGENT = 0 or exact prep-owned files only
TOOLS_CALLED = []
CHANGE_CREATED = NO
~~~

若 prep 失败，一次即停；不得手工补造目录或证据。

### 11.2 真实外部 Agent 第一阶段：比较与等待决定

项目所有者把以下目标交给一个不知道 Surdet 源码的新外部 Agent；执行 AI 不得代跑：

~~~text
只使用指定的 Surdet Agent Port。读取 capability schema 后比较提供的 A/B/C/D sealed candidates，创建 comparison review workspace，然后停止等待人类决定。不得调用 Shell、文件系统、Git 或其他 Surdet 服务；不得写 decision/approval 文件；不得 apply、commit、rollback 或触碰真实项目。
~~~

Agent 必须：

1. `capabilities.describe`；
2. `session.describe` / `project.inspect`；
3. `composition.compare`；
4. `review.prepare-comparison`；
5. 收到 `REVIEW_DECISION_REQUIRED / after-human-review`；
6. 停止，不循环重试、不伪造 receipt。

报告：reviewId、comparisonFingerprint、A/D groups、C conflict、B timeline dependency、工具调用数、项目 mutation=false。

### 11.3 Owner Comparison 人工验收

项目所有者用真实 Chrome/Edge：

1. 打开 Editor 根地址；
2. 点击“打开审阅任务”；
3. 选择 comparison review root；
4. 确认默认页面以中文显示任务目标、四个候选和当前状态；
5. 确认 A/D scene 显示“2 个方案得到相同结果”；
6. 确认 A/D variable 同样保留两个来源；
7. 确认 C 被展示为“需要你决定”，不是静默丢弃；
8. 确认 B timeline 显示为依赖自动纳入；
9. 展开技术详情，确认可见 conflictId/unitId/fingerprint/source capsule；
10. 默认层不堆英文错误码；
11. 点击 A 的 scene 结果；
12. 确认决定摘要显示 C 被排除、A/D provenance 保留；
13. 点击“保存我的决定”；
14. 确认生成 decision receipt 成功；
15. 再次点击不得覆盖不同 payload；
16. 关闭并重新打开同一 review root，决定仍可读取；
17. 确认 comparison 阶段没有修改 fixture 项目或原始 Starter。

只接受项目所有者原始反馈；执行 AI 不填“视觉清晰”“布局舒服”。

### 11.4 真实外部 Agent 第二阶段：Reviewed plan、stage、result 与等待批准

项目所有者让同一 Agent 继续：

~~~text
只使用同一 Surdet Agent Port。读取并验证人类 decision，生成 reviewed integration plan，执行到 stage，取得 fresh diff/validation/simulation/runtime，创建 result review workspace，然后停止等待人类最终批准。不得写 approval/return 文件，不得 apply 或 commit。
~~~

Agent 必须：

1. `review.inspect-decision`；
2. `composition.plan` reviewed variant；
3. `composition.inspect`；
4. `composition.execute`；
5. `change.diff`；
6. `project.validate`；
7. `project.simulate`；
8. `runtime.run-from` / `runtime.read-trace` 对 Alpha/Beta；
9. `review.prepare-result`；
10. `review.inspect-approval` 得到 `REVIEW_APPROVAL_REQUIRED / after-human-review`；
11. 停止。

报告 reviewed plan binding、changeId/workingRevision、所有 final fingerprints、fresh evidence IDs、result review ID/tree SHA、项目 mutation=false。

### 11.5 Owner Result 人工验收

项目所有者：

1. 在 Editor 打开 result review root；
2. 确认状态为“结果已准备，请检查”；
3. 查看完整计划摘要，确认 A/D 双来源、C 排除、B timeline 纳入；
4. 点击 scene 对象，右侧出现“当前对象 / 直接引用 / 直接被引用 / 可能影响 / 实际观察”；
5. 点击关系可跳到块编辑或 timeline；
6. 点击 runtime 事件可跳到对应块/cue；
7. 进入预览，确认 Gal 画面位于可用区域中央；
8. 增加对象/轨迹列表内容，确认各区独立滚动且不挤压预览；
9. 运行 Alpha，确认 A 内容可见、C 不存在；
10. 运行 Beta，确认既有资源 timeline 可见；
11. 打开块编辑、时间轴和预览，确认正常；
12. 在 review fixture 做一次临时探索性编辑；
13. 确认出现“你正在查看探索性修改”，批准按钮禁用；
14. 点击“重新加载正式结果”；
15. 确认探索修改消失，正式 tree identity 恢复；
16. 点击“批准这个计划”；
17. 确认 approval receipt 写入成功；
18. 关闭并重新打开，批准仍可读取；
19. 确认没有 apply/commit；
20. 确认原始 Starter 未变化。

Owner 只需报告第一个异常；全部通过时原样回复：

~~~text
Owner 人工验收通过：冲突裁决、计划结果、因果下钻、实际预览、探索失效和最终批准均正常。
~~~

### 11.6 Isolated apply/resume

Owner 人工通过不自动授权 apply。必须再次取得“批准 isolated apply/resume”。获批后：

1. 使用 prep 提供的 apply config；
2. 同一 plan/change/resultReview/approval identity；
3. `review.inspect-approval` 必须 fresh；
4. `change.commit` 显式传 approvalRef；
5. 验证 commit 前 approval gate；
6. 回读项目树与 expected result tree；
7. 回读 journal、record、lease；
8. 原始 Starter 保持不变；
9. 不 push、不部署、不进入 Wave 7。

若 apply 首次失败，按现有 transaction recovery 合同停在明确状态；不得手工覆盖 fixture。

### 11.7 Task 11 停止状态

全部通过后：

~~~text
EXTERNAL_AGENT_REVIEW_ACCEPTANCE_PASSED
OWNER_COMPARISON_ACCEPTANCE_PASSED
OWNER_RESULT_ACCEPTANCE_PASSED
ISOLATED_APPLY_PASSED
ORIGINAL_STARTER_UNCHANGED
WAITING_FOR_TASK_12_DOCUMENT_CLOSURE
~~~

---

### Task 12: 交付报告、磁盘身份、文档闭合与独立复审

**Files:**
- Create: `docs/HUMAN-AGENT-REVIEW-WORKBENCH-STAGE-6-WAVE-6-DELIVERY-REPORT-2026-08-26.md`
- Modify: `docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md`
- Modify: `docs/known-limitations.md` only if a current statement is now factually obsolete

**Interfaces:**
- Consumes: 全部真实命令、artifacts、external Agent 与 Owner 原始反馈
- Produces: 可独立复审的 Wave 6 delivery package；不产生 push 授权

- [ ] **Step 1: 创建报告结构**

交付报告固定章节：

~~~text
1. 结论与停止状态
2. 已验证事实
3. 项目所有者报告的视觉/交互事实
4. 尚未验证或不能外推的结论
5. 共享层/CLI/Editor 架构落点
6. RED -> GREEN 证据
7. verify:all / DIAGNOSTIC / FORMAL 预算与身份
8. 外部 Agent / Owner / isolated apply
9. 文件与提交范围
10. Git / remote / ahead-behind
11. 未解决问题与非阻断建议
12. 建议由总经理登记的事实
~~~

- [ ] **Step 2: 区分证据身份**

必须分别记录：

~~~text
WORKING_FINGERPRINT_HEAD
REVIEW_PROJECTION_HEAD
REVIEW_DECISION_HEAD
REVIEW_APPROVAL_GATE_HEAD
NODE_REVIEW_STORE_HEAD
REVIEW_CAPABILITY_HEAD
EDITOR_REVIEW_WORKSPACE_HEAD
EDITOR_REVIEW_UI_HEAD
CODE_EVIDENCE_HEAD
FORMAL_RUN_HEAD
DOCUMENT_CLOSURE_HEAD
FINAL_HEAD
REMOTE_MAIN
AHEAD_BEHIND
~~~

`FORMAL_RUN_HEAD` 必须等于 `CODE_EVIDENCE_HEAD`；后续 docs-only HEAD 不得冒充被测代码。

- [ ] **Step 3: 回读所有关键 artifact**

至少回读：Task 0 baseline、每个 RED/GREEN、唯一 verify:all、最多三份 DIAGNOSTIC、FORMAL evidence/identity、acceptance-prep evidence/identity、decision/result/approval/return（若未使用 return 则明确不存在）、delivery capsule、apply journal、最终 fixture tree。

每项从磁盘读取 path/bytes/SHA；失败 artifact 全部保留。

- [ ] **Step 4: 复核范围与保护文件**

Run:

~~~powershell
git diff --name-status surdet/main...HEAD
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
~~~

确认无 core/renderer/host/shell 生产修改、Starter/Zero/游戏内容、依赖/lockfile、受保护文件、历史 artifacts、长期台账。

- [ ] **Step 5: 文档门禁**

Run:

~~~powershell
npm run verify:docs
npm run verify:hygiene
git diff --check
git diff --cached --check
~~~

这不是第二次 `verify:all`。

- [ ] **Step 6: 精确文档提交**

只暂存任务书、交付报告和确有必要的 known-limitations：

~~~text
docs(authoring): report wave 6 review workbench
~~~

提交前 `git diff --cached --name-status` 必须精确匹配；提交后立即 `git show --name-status HEAD`。

- [ ] **Step 7: 提交后磁盘回读**

重新读取任务书和报告 bytes/SHA、HEAD/parent/remote/ahead-behind、tracked worktree、staging、tracked logs。若报告仍写旧 `PENDING`、未知 closure HEAD 或旧文件身份，做一次且仅一次 docs-only correction，不重跑代码测试；correction 仍需独立复审。

- [ ] **Step 8: 独立复审门**

最终停止：

~~~text
STAGE_6_WAVE_6_HUMAN_AGENT_REVIEW_WORKBENCH_VERIFIED
AUTOMATED_GATES_PASSED
FORMAL_PASSED
EXTERNAL_AGENT_ACCEPTANCE_PASSED
OWNER_ACCEPTANCE_PASSED
ISOLATED_APPLY_PASSED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
WAVE_7_NOT_STARTED
~~~

执行 AI 不得自行 push、宣布 Wave 7、清理 artifacts 或把非阻断建议扩大成下一轮施工。

---

## 九、永久测试合同矩阵

| 合同 | Authoring | CLI | Editor | FORMAL | Owner |
|---|---:|---:|---:|---:|---:|
| 六类 final fingerprint | ✓ | ✓ | 只读展示 | ✓ | — |
| A/D identical 双来源 | ✓ | ✓ | ✓ | ✓ | ✓ |
| C selection-required | ✓ | ✓ | ✓ | ✓ | ✓ |
| B timeline 隐式依赖 | ✓ | ✓ | ✓ | ✓ | ✓ |
| blocking 不能决定 | ✓ | ✓ | ✓ | ✓ | — |
| Agent 无写人类回执 | ✓ schema | ✓ security | — | ✓ | — |
| 决定 actor 固定 human | ✓ | ✓ | receipt writer | ✓ | ✓ |
| direct plan unreviewed | ✓ | ✓ | 明确显示 | ✓ | — |
| result 必须 READY+fresh | ✓ | ✓ | ✓ | ✓ | ✓ |
| exploration 使批准失效 | ✓ identity | ✓ tree | ✓ | ✓ | ✓ |
| stale approval 不 commit | ✓ | ✓ | ✓ display | ✓ | — |
| approval check 在 staging 前 | ✓ | ✓ | — | ✓ | — |
| 普通 commit 不受影响 | ✓ | ✓ | 普通保存 | ✓ | ✓ |
| actual result fixture | ✓ identity | ✓ copy | ✓ open | ✓ | ✓ |
| preview 居中且列表独立滚动 | — | — | ✓ | ✓ | ✓ |
| 原始 Starter unchanged | — | ✓ | — | ✓ | ✓ |

任何一行不能只靠内部状态或报告文字宣称完成。

---

## 十、执行 AI 每轮报告模板

每个 Task 结束只追加一笔紧凑 Ledger：

~~~text
timestamp =
task =
initialHead =
finalHead =
remoteMain =
aheadBehind =
trackedWorktree =
stagingArea =
filesChanged =
redCommand =
redExit =
redFirstFailure =
redArtifactPath =
redBytes =
redSha256 =
greenCommands =
greenResults =
commit =
unresolved =
nextStop =
push = NOT_PERFORMED
~~~

### 2026-08-27 — Task 1 unified working object fingerprints

~~~text
timestamp = 2026-08-27
task = 1_WORKING_OBJECT_FINGERPRINT
initialHead = b6532739c6a80adb2d9bfd3b4865e76e3c38d8d4
finalHead = 05784d387e5da1d01a3e1cd7eb80c1e5780ef048
parent = b6532739c6a80adb2d9bfd3b4865e76e3c38d8d4
filesCreated = packages/authoring/src/working-object-fingerprint.ts; packages/authoring/test/working-object-fingerprint.test.ts
filesChanged = packages/authoring/src/index.ts; packages/authoring/src/integration-execution.ts; packages/authoring/test/integration-execution.test.ts; packages/cli/src/authoring/composition-service.ts; packages/cli/test/composition-service.test.ts; this taskbook Execution Ledger
redCommands =
  npm run test -w @surdet/authoring -- working-object-fingerprint.test.ts integration-execution.test.ts
  npm run test -w @surdet/cli -- composition-service.test.ts
redResults = Authoring 2 files / 16 tests: 9 failed, 7 passed, exit 1; CLI 1 file / 6 tests: 1 failed, 5 passed, exit 1
redArtifacts = task1-red-authoring.log bytes=6560 sha256=A72541AF076B1C9F727B0BC80C71E84827CC589010C5E5EE039E8E47A7161EB2; task1-red-cli.log bytes=2614 sha256=20F26B74ACDB674FF30C1C969B5CDEC54F31A17F04BA7B86ACC85C70C74041EB
greenAttempt1 = authoring focus exit 1 (6 integration-execution regressions from stale workingFingerprint reference); authoring typecheck exit 2; authoring build exit 2; CLI focus exit 1 (resume regression from same reference); CLI typecheck exit 0
greenAttempt1Artifacts = task1-green-authoring-focus.log bytes=7172 sha256=BB2FDFCB270C789EC880A111AB2122C63950F0012D02749253633DCE3A358AAE; task1-green-authoring-typecheck.log bytes=494 sha256=91E08BEE1FC79A0035E126EC993E2FE04DC17AE6C7727D099ECC62AB91BECA88; task1-green-authoring-build.log bytes=480 sha256=954E8CF6C7E18BFD878E87F7F04C28254AF1E9D3E3AFB7E67832B12226A60B2A; task1-green-cli-focus.log bytes=2423 sha256=FE92F37A2905C980BADCEC8E65DB7BB9AEE6F1C4298627CA1C30E72165223DC8; task1-green-cli-typecheck.log bytes=68 sha256=AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917
greenCommands =
  npm run test -w @surdet/authoring -- working-object-fingerprint.test.ts integration-execution.test.ts integration-plan.test.ts
  npm run typecheck -w @surdet/authoring
  npm run build -w @surdet/authoring
  npm run test -w @surdet/cli -- composition-service.test.ts
  npm run typecheck -w @surdet/cli
greenResults = Authoring 3 files / 27 tests PASS exit 0; authoring typecheck PASS exit 0; authoring build PASS exit 0; CLI 1 file / 6 tests PASS exit 0; CLI typecheck PASS exit 0
greenArtifacts = task1-green2-authoring-focus.log bytes=546 sha256=7E779E5F852C4C603336F672E19078821CD9C40E3FE41292117E256E9FE5CBE8; task1-green2-authoring-typecheck.log bytes=74 sha256=9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78; task1-green2-authoring-build.log bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9; task1-green2-cli-focus.log bytes=994 sha256=1998F5EA775D7BC9837F4CD33857FF867443A1D27AC4AC98998D071D510256E5; task1-green2-cli-typecheck.log bytes=68 sha256=AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917
runHead = b6532739c6a80adb2d9bfd3b4865e76e3c38d8d4
resolverContract = scene/timeline/variable/character/config:characters/config:entryScene all use one working-file resolver; present and absent states are hashed distinctly; unknown declared products fail COMPOSITION_REPLAY_FAILED; private scene/timeline resolvers removed
unresolved = NONE
nextStop = TASK_2
push = NOT_PERFORMED
~~~

### 2026-08-27 — Task 2 comparison review projection

~~~text
timestamp = 2026-08-27
task = 2_COMPARISON_REVIEW_PROJECTION
initialHead = 05784d387e5da1d01a3e1cd7eb80c1e5780ef048
finalHead = 23656e7dc47e0945c56d22dc1432463bf1dc8940
parent = 05784d387e5da1d01a3e1cd7eb80c1e5780ef048
filesCreated = packages/authoring/src/review-contracts.ts; packages/authoring/src/review-projection.ts; packages/authoring/test/review-projection.test.ts
filesChanged = packages/authoring/src/index.ts; this taskbook Execution Ledger
redCommand = npm run test -w @surdet/authoring -- review-projection.test.ts
redResult = 1 file / 4 tests failed, exit 1; buildComparisonReviewProjection was not implemented
redArtifact = task2-red-authoring.log bytes=4055 sha256=CDEAFB930ECC9B0BD3BB24EE1C1EE6382A818988CE078AD3F7036C892E30A731
greenCommands =
  npm run test -w @surdet/authoring -- review-projection.test.ts candidate-comparison.test.ts
  npm run typecheck -w @surdet/authoring
  npm run build -w @surdet/authoring
greenResults = Authoring 2 files / 19 tests PASS exit 0; authoring typecheck PASS exit 0; authoring build PASS exit 0
greenArtifacts = task2-green-authoring-focus.log bytes=451 sha256=6E2A3F4EFCF0A67CA01041320BBCBFDE023F70DFE4F40A9E89B9B157A31A1D11; task2-green-authoring-typecheck.log bytes=74 sha256=9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78; task2-green-authoring-build.log bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9
runHead = 05784d387e5da1d01a3e1cd7eb80c1e5780ef048
projectionContract = typed comparison projection preserves candidate/unit/conflict/group/object identities, canonical candidate ordinals, identical groups, conflict severities/actions, dependencies, evidence states and source identity; reviewFingerprint excludes reviewId/display source fields and uses stable semantic fields
unresolved = NONE
nextStop = TASK_3
push = NOT_PERFORMED
~~~

### Task 0 artifact path readback correction

~~~text
CORRECTION = the preceding Windows path line was rendered with patch-string escape loss; no filesystem path changed
baselineArtifactPathActual = <local-path>
healthArtifactRootActual = <local-path>
~~~

不得复制整段终端输出、重复背景、写未执行命令或把后来的结果覆盖前一次失败记录。

---

## 十一、独立复审重点

独立总经理至少现场核验：

1. Editor 是否真的只消费 shared projection；
2. Agent Port 是否存在任何写 decision/approval 的入口；
3. direct plan 是否被错误标记为 reviewed；
4. A/D/C 子组语义是否仍正确；
5. variable/character/config 指纹是否在 dry-run/READY 回读；
6. result fixture 是否来自 exact working files；
7. approval 是否绑定 exact result；
8. commit 是否在任何 staging/journal 前检查批准；
9. exploration 是否真的使批准失效；
10. 中文 UI 是否隐藏了技术事实或误写 fresh 状态；
11. FORMAL artifact 是否属于 frozen HEAD；
12. Owner 反馈是否由本人提供；
13. 提交是否越界到生产禁区、Starter、依赖或长期台账。

`FORMAL PASS`、漂亮截图和 Owner 一句“看起来正常”都不能替代上述合同检查。

---

## 十二、任务书完成声明与当前停止点

本任务书已经覆盖批准规格的共享语义、Node store、MCP、Editor、实际预览、错误合同、安全、自动化、真实 Agent、Owner 和 isolated apply；没有拆出第二套业务真相，也没有把 Wave 7 夹带进来。

当前仅完成任务书制作：

~~~text
STAGE_6_WAVE_6_DIRECTION_A_SELECTED
REVIEW_TASK_WORKBENCH_A1_SELECTED
CONFLICT_LEVEL_DECISION_AND_PLAN_LEVEL_APPROVAL_P1_SELECTED
WAVE_6_DESIGN_SPEC_APPROVED
WAVE_6_MASTER_TASKBOOK_COMPLETE
WAVE_6_IMPLEMENTATION_NOT_STARTED
FORMAL_NOT_STARTED
EXTERNAL_AGENT_ACCEPTANCE_NOT_STARTED
OWNER_ACCEPTANCE_NOT_STARTED
NOT_PUSHED_AFTER_WAVE_6_TASKBOOK
WAITING_FOR_OWNER_IMPLEMENTATION_AUTHORIZATION
~~~

项目所有者批准本任务书后，执行 AI 才能从 Task 0 串行施工。任务书批准不自动授权 push、部署、发行、Wave 7，亦不授权跳过任何 Owner gate。

---

## Taskbook Creation Record

任务书创建时：

~~~text
DESIGN_SPEC_HEAD = 017f7201926a17adbe9a876c3e1500f209c1e9e5
DESIGN_SPEC_STATUS = APPROVED_BY_OWNER
TASKBOOK_PATH = docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md
TASKBOOK_COMMIT_IDENTITY_SOURCE = git log -1 -- docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md
IMPLEMENTATION = NOT_STARTED
PUSH = NOT_AUTHORIZED
~~~

---

## Execution Ledger

本节由执行 AI 只追加真实事实。任务书创建阶段不预填施工结果。

### 2026-08-26 — Task 0 baseline and health

~~~text
timestamp = 2026-08-26
task = 0_BASELINE_AND_HEALTH
initialHead = b6532739c6a80adb2d9bfd3b4865e76e3c38d8d4
finalHead = b6532739c6a80adb2d9bfd3b4865e76e3c38d8d4
remoteMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehind = 2/0
trackedWorktree = CLEAN
stagingArea = EMPTY
filesChanged = this taskbook Execution Ledger append only; uncommitted
redCommand = NONE (Task 0 baseline health expected green)
redExit = NOT_RUN
redFirstFailure = NONE
redArtifactPath = NONE
redBytes = NONE
redSha256 = NONE
greenCommands =
  npm run test -w @surdet/authoring -- candidate-comparison.test.ts integration-plan.test.ts integration-execution.test.ts
  npm run test -w @surdet/cli -- composition-service.test.ts agent-port-composition.test.ts
  npm run test -w surdet-editor -- causal-selection.test.ts preview-stage-layout.test.ts project-io.test.ts
greenResults = Authoring 3 files / 33 tests PASS exit 0; CLI 2 files / 13 tests PASS exit 0; Editor 3 files / 13 tests PASS exit 0
baselineArtifactPath = C:UsersEquinoxAppDataLocalTempsurdet-human-review-wave6-58c34f917bbf46059984cff0df0d37d9	ask0-baseline.txt
baselineArtifactIdentity = bytes=2835; sha256=68F23198D7016A372C20970B11D53811C5F4AA65D2BCCC39B926E3FBD997D5A4
healthArtifacts = authoring.log bytes=536 sha256=24BFFB1B2ED8174AE528B1B052F5185408B5038C47B6BD8EDB2690FE6A0DD037; cli.log bytes=1835 sha256=C8E815CD8333589340EC49B62B046E9F714262F70C2A1406CC1E1D066B9774E6; editor.log bytes=520 sha256=289FDA6DEF8DBA70D4953EC60197B7B875586584204F01176DDD760E5D88174E
commit = NONE (Task 0 no code commit; Ledger remains for Task 1 precise staging)
unresolved = NONE
nextStop = TASK_1
push = NOT_PERFORMED
~~~

### 2026-08-27 — Task 3 human decision receipts and reviewed plan binding

~~~text
timestamp = 2026-08-27
task = 3_HUMAN_DECISION_RECEIPTS_AND_REVIEWED_PLAN
initialHead = 23656e7dc47e0945c56d22dc1432463bf1dc8940
finalHead = c98e4eadb5c681ec531b5f2e7c66ac5f9f219dc5
parent = 23656e7dc47e0945c56d22dc1432463bf1dc8940
remoteMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehind = 4/0
trackedWorktree = TASK_3_FILES_ONLY; pre-commit known untracked preserved
stagingArea = EMPTY before precise staging
filesCreated = packages/authoring/src/review-receipts.ts; packages/authoring/test/review-receipts.test.ts
filesChanged = packages/authoring/src/integration-plan.ts; packages/authoring/test/integration-plan.test.ts; packages/authoring/src/index.ts; packages/cli/src/authoring/composition-service.ts; packages/cli/test/composition-service.test.ts; this taskbook Execution Ledger
redCommands =
  npm run test -w @surdet/authoring -- review-receipts.test.ts integration-plan.test.ts
  npm run build -w @surdet/authoring
  npm run test -w @surdet/cli -- composition-service.test.ts
redResults = Authoring 2 files / 19 tests: 8 failed, 11 passed, exit 1; authoring build exit 0; CLI 1 file / 7 tests: 1 failed, 6 passed, exit 1
redArtifacts = <local-path> bytes=6570 sha256=4251EA62F57B18D206D98AAF0B0F367A821B6EB78E3716AEBA92ACB2F241FC5; <local-path> bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9; <local-path> bytes=2427 sha256=679A78F65FC839F6DCE1D70C8E158587C932E23299BF5F12327B78779DF487D2
greenAttempt1 = authoring focus exit 1 (1 failed, 33 passed); authoring typecheck exit 2; authoring build exit 2; CLI focus exit 0 (1 file / 7 tests); CLI typecheck exit 0
greenAttempt1Artifacts = task3-green-authoring-focus.log bytes=2660 sha256=730CC831E4F9F2140308C1D2E7062CDCB72B2D76F0F7755C83BA28F4A0512B1F; task3-green-authoring-typecheck.log bytes=1206 sha256=6BAB674FFAAE98273A26360A558600490E64E479FF6EB11AB30FA801EB5817; task3-green-authoring-build.log bytes=635 sha256=E1586C8352180DF4BD1F76602B529FB5E643E695964AE800A36CD5457B9D717F; task3-green-cli-focus.log bytes=1076 sha256=D8FAAC5A38E7F4787224A60BEE480891CC0CFF550D26E1673A4327DB13334501; task3-green-cli-typecheck.log bytes=68 sha256=AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917
greenAttempt2 = authoring focus/typecheck/build exit 0 (2 files / 19 tests); CLI focus exit 0 (1 file / 7 tests); CLI typecheck exit 2 (reviewed.plan.review possibly undefined)
greenAttempt2Artifacts = task3-green2-authoring-focus.log bytes=452 sha256=39E800CF56BF3792D86C7B9FDB85E7A4F4CC6A8CDCEDDAEA6F5A75C7F3092ACA; task3-green2-authoring-typecheck.log bytes=87 sha256=87F97BB34D837FE621E8D4B58288E79B410E7E6E02DFB2C34D489153504D74F5; task3-green2-authoring-build.log bytes=80 sha256=DF88C986327AB338DE3AEE050E8FA71E69E99D5A9B673EAD681769BEDE0FB89E; task3-green2-cli-focus.log bytes=1090 sha256=F7CAB8FDE5347DF00E1EED887996F0F9AF478270C0019F6916E158A314FDD553; task3-green2-cli-typecheck.log bytes=497 sha256=545D89367B4DFA85FBE9B50AC0031BAB115D01A7354AECA3DD63CB2CA777D784
greenAttempt3 = CLI focus/typecheck exit 0 (1 file / 7 tests; typecheck PASS) after explicit test narrowing
greenAttempt3Artifacts = task3-green3-cli-focus.log bytes=1091 sha256=1E0F94F7FD5446869752CE8631F523771FC5895F2AFDFD2A995E81CE42DFF337; task3-green3-cli-typecheck.log bytes=81 sha256=6A849C709D2C8C86168E19FE68FC2AAC390A501DA4E2928C24930050967E5F31
greenCommands =
  npm run test -w @surdet/authoring -- review-receipts.test.ts integration-plan.test.ts candidate-comparison.test.ts
  npm run typecheck -w @surdet/authoring
  npm run build -w @surdet/authoring
  npm run test -w @surdet/cli -- composition-service.test.ts
  npm run typecheck -w @surdet/cli
greenResults = Authoring 3 files / 34 tests PASS exit 0; authoring typecheck PASS exit 0; authoring build PASS exit 0; CLI 1 file / 7 tests PASS exit 0; CLI typecheck PASS exit 0
greenArtifacts = task3-green4-authoring-focus.log bytes=537 sha256=61C65CF8299D4295B147D6CFE7DA6A0BA92471458546F9FB64E79184F52EC35F; task3-green4-authoring-typecheck.log bytes=87 sha256=87F97BB34D837FE621E8D4B58288E79B410E7E6E02DFB2C34D489153504D74F5; task3-green4-authoring-build.log bytes=80 sha256=DF88C986327AB338DE3AEE050E8FA71E69E99D5A9B673EAD681769BEDE0FB89E; task3-green4-cli-focus.log bytes=1089 sha256=B262071773F91261254EA0B258B49850092B1B85DA311FAE90B09FCED6464D6C; task3-green4-cli-typecheck.log bytes=81 sha256=6A849C709D2C8C86168E19FE68FC2AAC390A501DA4E2928C24930050967E5F31
runHead = 23656e7dc47e0945c56d22dc1432463bf1dc8940
contract = decisionFingerprintOf uses exactly the approved semantic fields and excludes decidedAt/local notes; validation enforces fresh identity, one legal resolution per selection-required conflict, human actor, blocking rejection, and REVIEW_RETURNED for regeneration; buildIntegrationPlan requires review and direct CLI plans bind unreviewed; sealDryRunResult includes review in plan fingerprint
compatibilityNote = IntegrationPlan.review remains optional only for existing Wave 5 literal fixtures; builder and CLI outputs always emit the binding
unresolved = NONE
nextStop = TASK_4
push = NOT_PERFORMED
~~~

### 2026-08-27 — Task 4 result review、最终批准与 integration commit gate

~~~text
timestamp = 2026-08-27
task = 4_RESULT_REVIEW_FINAL_APPROVAL_AND_COMMIT_GATE
initialHead = c98e4eadb5c681ec531b5f2e7c66ac5f9f219dc5
finalHead = 1223d7d2e0fbd553abd03e5eac21b5403985183b
parent = c98e4eadb5c681ec531b5f2e7c66ac5f9f219dc5
remoteMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehindBeforeCommit = 5/0
trackedWorktree = TASK_4_FILES_ONLY; pre-commit known untracked preserved
stagingArea = EMPTY before precise staging
filesCreated = NONE
filesChanged = packages/authoring/src/review-contracts.ts; packages/authoring/src/review-projection.ts; packages/authoring/src/review-receipts.ts; packages/authoring/src/integration-execution.ts; packages/authoring/src/change-session.ts; packages/authoring/src/contracts.ts; packages/authoring/test/review-projection.test.ts; packages/authoring/test/review-receipts.test.ts; packages/authoring/test/commit-recovery.test.ts; this taskbook Execution Ledger
filesAllowedButNotModified = packages/authoring/test/integration-execution.test.ts
redCommand = npm run test -w @surdet/authoring -- review-projection.test.ts review-receipts.test.ts integration-execution.test.ts commit-recovery.test.ts
redResult = 4 files / 37 tests: 14 failed, 23 passed, exit 1; 3 test files failed and 1 passed
redArtifact = <local-path> bytes=10122 sha256=233AC35F4D8C1221DEEE69CBDAADE2D6F46E65D0DF2F893B3B37BD1679EB70D2
greenAttempt1 = same 4-file focus command, exit 1; 1 failed, 36 passed
greenAttempt1Artifact = <local-path> bytes=3004 sha256=AB46F2AA691DA0B611B188E3700E4388022198CCA4B9E8A3FE2A8B40F8A8D002
greenAttempt2 = same 4-file focus command, exit 0; 4 files / 37 tests PASS
greenAttempt2Artifact = <local-path> bytes=601 sha256=CFD74DD0B5642BE304A8B115D7C6C4E1B0DF746BDFE92BBB6CD8697BC4D2AC1D
greenAttempt3 = required 5-file focus command, exit 0; 5 files / 46 tests PASS
greenAttempt3Artifact = <local-path> bytes=673 sha256=06890889B6743978643960150BDBDA0EDDE47817A611A9CFFF4665714C312807
greenAttempt3Typecheck = npm run typecheck -w @surdet/authoring, exit 2; test helper readonly tuple type error
greenAttempt3TypecheckArtifact = <local-path> bytes=1130 sha256=5799BBECA65167C588B09B68EAB0CE3596BA551011C9C6BD7DA36816A1FC8E97
greenAttempt4 = required 5-file focus/typecheck/build, all exit 0; focus 46 tests
greenAttempt4Artifacts = task4-green4-authoring-focus.log bytes=673 sha256=7A952676902C5CE29094DFA85322CE88AB399D1D868C06F635B0FE458D769650; task4-green4-authoring-typecheck.log bytes=74 sha256=9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78; task4-green4-authoring-build.log bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9
contractAlignmentAttempt = after the first green sequence, FinalApprovalReceipt was aligned to the Taskbook exact resultReviewId/project identity/evidence structure; prior successful artifacts remain historical and were not overwritten
greenAttempt5 = required 5-file focus exit 0; 5 files / 47 tests PASS
 greenAttempt5Artifact = task4-green5-authoring-focus.log bytes=673 sha256=3F5E9A424BFED579AB890544E0622973DE3483995D9C270C8C6D503CBFA557AC
greenAttempt5Typecheck = npm run typecheck -w @surdet/authoring, exit 2; nested evidence readonly tuple type error in test helper
greenAttempt5TypecheckArtifact = task4-green5-authoring-typecheck.log bytes=552 sha256=CCA8A9C965DB45A3F14CE518F30844234279D87A22027A4C338B7DE064CD228E
 greenCommands =
   npm run test -w @surdet/authoring -- review-projection.test.ts review-receipts.test.ts integration-execution.test.ts commit-recovery.test.ts change-session.test.ts
   npm run typecheck -w @surdet/authoring
   npm run build -w @surdet/authoring
greenResults = Authoring 5 files / 47 tests PASS exit 0; authoring typecheck PASS exit 0; authoring build PASS exit 0
greenArtifacts = task4-green6-authoring-focus.log bytes=673 sha256=10C5A4BF790A71E13F4B77EAC138C456B6871C5881052F1E8BFB9BD1A95C1415; task4-green6-authoring-typecheck.log bytes=74 sha256=9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78; task4-green6-authoring-build.log bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9
 contract = result readiness rejects unreviewed/non-READY/stale or failed evidence; result projection carries exact plan/change/revision/result tree facts; final approval freshness binds plan/change/revision/project identity/diff/evidence/tree; approval and return receipt contracts use taskbook resultReviewId/evidence shape; metadata CAS stores resultReview then approval; commit gate fails before storage activity and checks binding fingerprint; ordinary change remains unaffected
 priorLedgerCorrection = live pre-Task4 rev-list check is ahead/behind 5/0; the earlier Task 3 ledger line recorded 4/0 and is retained as historical text rather than rewritten
unresolved = NONE
commit = (本提交); message = feat(authoring): gate reviewed integrations
nextStop = TASK_5
push = NOT_PERFORMED
~~~

### 2026-08-27 — Task 5 Node review store、ReviewService 与 exact working-tree fixture

~~~text
timestamp = 2026-08-27
task = 5_NODE_REVIEW_STORE_AND_REVIEW_SERVICE
initialHead = 1223d7d2e0fbd553abd03e5eac21b5403985183b
finalHead = 0a9084b0dfc39d8c9f6e1c0269c156672dddf146
parent = 1223d7d2e0fbd553abd03e5eac21b5403985183b
remoteMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehindBeforeCommit = 6/0
trackedWorktree = TASK_5_FILES_ONLY; pre-commit known untracked preserved
stagingArea = EMPTY before precise staging
filesCreated = packages/cli/src/authoring/node-review-store.ts; packages/cli/src/authoring/review-service.ts; packages/cli/test/node-review-store.test.ts; packages/cli/test/review-service.test.ts
filesChanged = packages/cli/src/authoring/composition-service.ts; packages/cli/test/composition-service.test.ts; packages/authoring/src/review-projection.ts; packages/authoring/src/review-receipts.ts; this taskbook Execution Ledger
redCommands =
  npm run build -w @surdet/authoring
  npm run test -w @surdet/cli -- node-review-store.test.ts review-service.test.ts composition-service.test.ts
redResults = authoring build exit 0; CLI 3 files: 2 suites failed during module loading because the new NodeReviewStore module was absent, composition-service 7 tests passed, total 7 passed, exit 1
artifactRoot = <local-path>
redArtifacts = task5-red-authoring-build.log bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b; task5-red-cli-focus.log bytes=3431 sha256=4B69C7AF886A5686EAC4A5E4F86DE94C8CEEEA3EB732EAAB148EBBCE9550A209 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenAttempt1 = CLI focus exit 1; 1 failed, 19 passed, exit 1; subsequent CLI typecheck and build exit 0
greenAttempt1Artifacts = task5-green1-cli-focus.log bytes=2970 sha256=9AA72C9FA0820A1DC2367F7C49BEBDC65410DB5870D4830C9C3FDA249941B8C0 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b; task5-green1-cli-typecheck.log bytes=68 sha256=AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b; task5-green1-cli-build.log bytes=61 sha256=898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenAttempt2 = CLI focus exit 0; 3 files / 20 tests PASS
greenAttempt2Artifact = task5-green2-cli-focus.log bytes=1228 sha256=A4D8406D81FA670B8525B7973430D8919C15C4873C6F0EF08286908984D19AA8 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenAttempt3 = review-service-only exit 1; 1 passed, 1 failed, exit 1; stale authoring dist still enforced old root identity guard
greenAttempt3Artifact = task5-green3-review-service.log bytes=2205 sha256=FA4A6F52BD22EA1D8194D1EB5D8B2E99246E939C037C3B38A67AF506DD3AFD49 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenAttempt3Fix = authoring identity mapping was corrected in the shared result projection and receipt verification, then the authoring package was rebuilt
greenAttempt3FixArtifact = task5-green3-authoring-build-after-identity-fix.log bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenAttempt4 = review-service-only exit 0; 1 file / 2 tests PASS
greenAttempt4Artifact = task5-green4-review-service.log bytes=532 sha256=A7761E62569135442C0F104F976B8289468424F89168E98C37C0521E187E97F6 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenAttempt5 = authoring rebuild exit 0; review-service-only exit 0; 1 file / 2 tests PASS after crypto-compatible result-tree hashing and read-only approval inspection
greenAttempt5Artifacts = task5-green5-authoring-build.log bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b; task5-green5-review-service.log bytes=532 sha256=253EBE65D3B18997F82464EAFB61936807140FDA4BD28F289352A6612B74DDB0 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenAttempt6 = CLI typecheck exit 2; test union narrowing missing approvalId
greenAttempt6Artifact = task5-green6-cli-typecheck.log bytes=594 sha256=B8D1D6553877561A50D6945F9301906066608FE6CA001D322B027F75FD8A8F70 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenAttempt7 = CLI typecheck exit 2; second union narrowing use remained
greenAttempt7Artifact = task5-green7-cli-typecheck.log bytes=810 sha256=B5D8E02A638D3CD66F662123C9671EBD11F2A0A9FC3FED25B93A7CD41B42F041 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenAttempt8 = CLI typecheck exit 0
greenAttempt8Artifact = task5-green8-cli-typecheck.log bytes=68 sha256=AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenAttempt9 = NodeReviewStore + ReviewService focus exit 0; 2 files / 17 tests PASS, including 15 store safety tests and 2 service tests
greenAttempt9Artifact = task5-green9-review-store.log bytes=614 sha256=924923F9726402BAE48C7264822474374D4DA2738385A5B334B99396D7000129 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
greenCommands =
  npm run build -w @surdet/authoring
  npm run test -w @surdet/cli -- node-review-store.test.ts review-service.test.ts composition-service.test.ts node-json-record.test.ts
  npm run typecheck -w @surdet/cli
  npm run build -w @surdet/cli
greenResults = authoring build PASS exit 0; CLI 4 files / 27 tests PASS exit 0; CLI typecheck PASS exit 0; CLI build PASS exit 0
greenArtifacts = task5-green-final-authoring-build.log bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b; task5-green-final-cli-focus.log bytes=1570 sha256=4FEF11E1F1F487821FDFCD49573C95D98F1EC7175DA11AF45FA0982CE5C333F1 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b; task5-green-final-cli-typecheck.log bytes=68 sha256=AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917 runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b; task5-green-final-cli-build.log bytes=61 sha256=898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E runHead=1223d7d2e0fbd553abd03e5eac21b5403985183b
contract = create-only review workspaces use project namespace plus safe review IDs; sidecar payload bytes/SHA are revalidated; comparison/decision/result/approval/return records are kind-gated; result fixture copies only safe base files, deletes base files absent from workingFiles, overlays exact workingFiles, hashes the sorted tree without mtime/ACL/absolute paths, and leaves the original project unchanged; ReviewService rereads live comparison/change/approval state and returns stale or missing receipt failures
crossLayerCorrection = Task 5 real result flow exposed that CLI project identity is a hash of the real project root while authoring records retain the real root path; shared result projection and receipt verification now leave root-to-hash mapping to the CLI boundary instead of comparing unlike representations
unresolved = NONE
formal = NOT_RUN; diagnostic = NOT_RUN
commit = 0a9084b0dfc39d8c9f6e1c0269c156672dddf146; message = feat(cli): persist human review workspaces
nextStop = TASK_6
push = NOT_PERFORMED
~~~

### 2026-08-27 — Task 6 Capability Registry、CLI Dispatcher、Session 与 MCP 薄投影

~~~text
timestamp = 2026-08-27
task = 6_CAPABILITY_REGISTRY_AGENT_PORT_REVIEW_WIRING
initialHead = 0a9084b0dfc39d8c9f6e1c0269c156672dddf146
finalHead = 2e6fd6bc1ff38dc49fb07b973f764097aa9f7028
parent = 0a9084b0dfc39d8c9f6e1c0269c156672dddf146
remoteMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehindBeforeCommit = 7/0
trackedWorktree = TASK_6_FILES_ONLY; Task 5 Ledger correction carried in this taskbook change; known untracked preserved
stagingArea = EMPTY before precise staging
filesCreated = packages/cli/test/agent-port-review.test.ts
filesChanged = packages/authoring/src/capability-contract.ts; packages/authoring/src/capability-registry.ts; packages/authoring/src/error-catalog.ts; packages/authoring/test/capability-registry.test.ts; packages/authoring/test/error-catalog.test.ts; packages/cli/src/authoring/authoring-service.ts; packages/cli/src/authoring/authoring-dispatcher.ts; packages/cli/src/agent-port/session.ts; packages/cli/src/agent-port/server.ts; packages/cli/test/agent-port-review.test.ts; packages/cli/test/authoring-contract.test.ts; packages/cli/test/agent-port-output-contract.test.ts; packages/cli/test/agent-port-session.test.ts; packages/cli/test/agent-port-tools.test.ts; packages/cli/test/agent-port-security.test.ts; this taskbook Execution Ledger
redCommands =
  npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts
  npm run build -w @surdet/authoring
  npm run test -w @surdet/cli -- agent-port-review.test.ts authoring-contract.test.ts agent-port-output-contract.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-security.test.ts
redResults = Authoring 2 files / 20 tests: 7 failed, 13 passed, exit 1; authoring build exit 0; CLI 6 files / 48 tests: 10 failed, 38 passed, exit 1
artifactRoot = <local-path>
redArtifacts = task6-red-authoring-tests.log exit=1 bytes=9072 sha256=73572971CF84207C6D39DDD7E2F9675BB4633216BFC78AF2F1412102C197E192 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-red-authoring-build.log exit=0 bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-red-cli-tests.log exit=1 bytes=16988 sha256=D5EEB8A39CAB2C7A4F6629AB480DCF43867FE5207FC209A80834AEF31E0B5E8F runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146
greenAttempt1 = authoring required focus exit 1 because the review.inspect-approval output is a strict oneOf; CLI required focus exit 0 with 7 files / 55 tests; CLI typecheck/build initially exit 2 on session narrowing and approval union narrowing
greenAttempt1Artifacts = task6-green-authoring-focus.log exit=1 bytes=4410 sha256=DA936A7499BCDF6200E92382D1825ECC9AD7E6467B540B2FD44B074C923DE1D4 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-cli-focus-1.log exit=0 bytes=4821 sha256=98AE0556A527D2FA15EEF0C5B935F34AB597F8509823867CA9EA63D8B3550A15 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-cli-typecheck-1.log exit=2 bytes=1102 sha256=2721C2867866917170C3C48F23329A5DA95A68334D44817C70ECB3431D276ECD runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-cli-build-1.log exit=2 bytes=1088 sha256=B04815CE17F1E935B13174B043080385C3798F230A7F1B73E01FE55E1D7494BE runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146
greenAttempt2 = authoring focus rerun exit 0; typecheck/build exit 0 after schema and union fixes; then final required sequence after envelope and approval-gate tests exit 0
greenAttempt2Artifacts = task6-green-authoring-focus-2.log exit=0 bytes=592 sha256=4559520A01B88F7700AB03FDE9D7992C7529481E87BD6B1A8F55A1DF7407574F1 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-authoring-typecheck.log exit=0 bytes=74 sha256=9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-authoring-build.log exit=0 bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-cli-typecheck-2.log exit=0 bytes=68 sha256=AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-cli-build-2.log exit=0 bytes=61 sha256=898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146
finalGreenCommands =
  npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts review-receipts.test.ts integration-plan.test.ts
  npm run typecheck -w @surdet/authoring
  npm run build -w @surdet/authoring
  npm run test -w @surdet/cli -- agent-port-review.test.ts authoring-contract.test.ts agent-port-output-contract.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-security.test.ts composition-service.test.ts
  npm run typecheck -w @surdet/cli
  npm run build -w @surdet/cli
finalGreenResults = Authoring 4 files / 50 tests PASS exit 0; authoring typecheck PASS exit 0; authoring build PASS exit 0; CLI 7 files / 57 tests PASS exit 0; CLI typecheck PASS exit 0; CLI build PASS exit 0
finalGreenArtifacts = task6-green-final-authoring-focus.log exit=0 bytes=592 sha256=0FFF2A654A4784E08399E8BA5B444AC84E0D55AC7D7FD69986E22A5455791E58 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-final-authoring-typecheck.log exit=0 bytes=74 sha256=9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-final-authoring-build.log exit=0 bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-final-cli-focus.log exit=0 bytes=4946 sha256=46B2526C4E19EE1BAA450CD7114DCCFA549358BAB85AE25CE72C8F894D8EFF5D runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-final-cli-typecheck.log exit=0 bytes=68 sha256=AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917 runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146; task6-green-final-cli-build.log exit=0 bytes=61 sha256=898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E runHead=0a9084b0dfc39d8c9f6e1c0269c156672dddf146
contract = AUTHORING_CONTRACT_VERSION 2.1.0; envelope and delivery capsule versions unchanged; RetryDisposition includes after-human-review; registry reaches 30 capabilities with exactly the four review entries; direct/reviewed composition.plan is strict oneOf; review inputs exclude agent receipt/actor/absolute-path/arbitrary-content fields; dispatcher is a thin facade to ReviewService; reviewed plan mechanically verifies decision and fixes conflict actors to human through shared receipt validation; integration commit accepts approvalRef, rejects missing/returned/stale approval before commit journal, CAS-binds verified approval; session reports review state using stable IDs only; added structured after-human-review envelope and no-receipt-writer/MCP countertests
unresolved = NONE
formal = NOT_RUN; diagnostic = NOT_RUN
commit = 2e6fd6bc1ff38dc49fb07b973f764097aa9f7028; message = feat(cli): expose human review capabilities
 nextStop = TASK_7
 push = NOT_PERFORMED
 ~~~

### 2026-08-27 — Task 7 Editor 审阅工作区、模型与普通项目隔离

~~~text
timestamp = 2026-08-27
task = 7_EDITOR_REVIEW_WORKSPACE_MODEL_AND_PROJECT_ISOLATION
initialHead = 2e6fd6bc1ff38dc49fb07b973f764097aa9f7028
finalHead = (本提交；精确 hash 在后续现场提交核对中记录)
parent = 2e6fd6bc1ff38dc49fb07b973f764097aa9f7028
remoteMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehindBeforeCommit = 8/0
trackedWorktree = TASK_7_FILES_ONLY; Task 6 Ledger hash correction carried in this taskbook change; known untracked preserved
stagingArea = EMPTY before precise staging
filesCreated = packages/editor/src/review-workspace.ts; packages/editor/src/review-model.ts; packages/editor/test/review-workspace.test.ts; packages/editor/test/review-model.test.ts
filesChanged = packages/editor/src/state.ts; packages/editor/src/main.ts; packages/editor/src/project-io.ts; packages/editor/test/project-io.test.ts; this taskbook Execution Ledger
redCommands =
  npm run build -w @surdet/authoring
  npm run test -w surdet-editor -- review-workspace.test.ts review-model.test.ts project-io.test.ts
redResults = authoring build exit 0; Editor requested 3 files failed during module loading for absent review modules, project-io had 7 passed and 1 failed, exit 1
artifactRoot = <local-path>
redArtifacts = task7-red-authoring-build.log exit=0 bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9 runHead=2e6fd6bc1ff38dc49fb07b973f764097aa9f7028; task7-red-editor-tests.log exit=1 bytes=4242 sha256=F96D16BC33E2EB568D72FDA8F7901C991E2670FF52F6F480FDC2FCAF7F5F8BCF runHead=2e6fd6bc1ff38dc49fb07b973f764097aa9f7028
 greenCheck = required focus without model-roundtrip exit 0; 3 files / 13 tests PASS
 greenCheckArtifact = task7-green-editor-focus-check.log exit=0 bytes=578 sha256=9D567C467EB2163D632C15BD86E206424D3A5CF9DB6D423AAB3C2847D5661099 runHead=2e6fd6bc1ff38dc49fb07b973f764097aa9f7028
 greenCommands =
   npm run test -w surdet-editor -- review-workspace.test.ts review-model.test.ts project-io.test.ts model-roundtrip.test.ts
   npm run typecheck -w surdet-editor
   npm run build -w surdet-editor
 greenResults = Editor 4 files / 19 tests PASS exit 0; editor typecheck PASS exit 0; editor build PASS exit 0
 greenArtifacts = task7-green-final-editor-focus.log exit=0 bytes=578 sha256=9D567C467EB2163D632C15BD86E206424D3A5CF9DB6D423AAB3C2847D5661099 runHead=2e6fd6bc1ff38dc49fb07b973f764097aa9f7028; task7-green-final-editor-typecheck.log exit=0 bytes=70 sha256=6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3 runHead=2e6fd6bc1ff38dc49fb07b973f764097aa9f7028; task7-green-final-editor-build.log exit=0 bytes=1998 sha256=DC2BDF3BAFE54E8AC0EB76289BDCDA85E891CE926A94FF88B21B55C50BAA01D8 runHead=2e6fd6bc1ff38dc49fb07b973f764097aa9f7028
 contract = review workspace reads identity before fixed payload, revalidates bytes/SHA/project identity/version and rejects approval-return coexistence; receipts are create-only and reread-verified without actor or absolute paths; ReviewWorkspaceState carries the exact taskbook fields; normal project open clears stale review while review fixture opens under the project subhandle; review model exposes fixed Chinese labels and blocks sealing until evidence and all selection-required conflicts are resolved
 unresolved = NONE
 formal = NOT_RUN; diagnostic = NOT_RUN
 commit = (本提交); message = feat(editor): open human review workspaces
 nextStop = TASK_8
 push = NOT_PERFORMED
~~~
