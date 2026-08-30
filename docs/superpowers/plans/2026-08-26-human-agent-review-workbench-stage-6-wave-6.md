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
finalHead = d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
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
commit = d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; message = feat(editor): open human review workspaces
 nextStop = TASK_8
 push = NOT_PERFORMED
 ~~~

### 2026-08-27 — Task 8 Editor 审阅 UI、因果下钻与实际 Stage 预览

~~~text
timestamp = 2026-08-27
task = 8_EDITOR_REVIEW_UI_CAUSAL_DRILLDOWN_AND_RESULT_PREVIEW
initialHead = d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
finalHead = deaf74a64024b91e46cc750822295e0f9c2ce739
parent = d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
remoteMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehindBeforeCommit = 9/0
trackedWorktree = TASK_8_FILES_ONLY; Task 7 Ledger correction carried in this taskbook change; known untracked preserved
stagingArea = EMPTY before precise staging
filesCreated = packages/editor/src/panels/review-panel.ts; packages/editor/src/review-preview.ts; packages/editor/test/review-panel.test.ts; packages/editor/test/review-preview.test.ts
filesChanged = packages/editor/src/main.ts; packages/editor/src/state.ts; packages/editor/src/causal-selection.ts; packages/editor/src/panels/right.ts; packages/editor/src/panels/preview-panel.ts; packages/editor/src/styles.css; packages/editor/test/causal-selection.test.ts; packages/editor/test/preview-stage-layout.test.ts; this taskbook Execution Ledger
redCommand = npm run test -w surdet-editor -- review-panel.test.ts review-preview.test.ts causal-selection.test.ts preview-stage-layout.test.ts
redResult = 4 requested files / 8 tests: 2 failed, 6 passed, exit 1; new panel/preview modules were absent and causal/layout contracts were red
artifactRoot = <local-path>
redArtifact = task8-red-editor-tests.log exit=1 bytes=33433 sha256=30417393BC640B3EAC59F9657346965F6528DEC5373134F3BE2B3F5EBD55A0DD runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
greenAttempt1 = required focus exit 1; 8 files / 29 tests: 27 passed, 2 failed; required full Editor exit 0 with 32 files / 190 tests; typecheck exit 2 on browser SHA input and test evidence fixture types
greenAttempt1Artifacts = task8-green-attempt1-editor-focus.log exit=1 bytes=36023 sha256=2F63731761C6421DA9462065A3F4569F339EF099BAD189D2563C6FD4FDB7B06A runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-attempt1-editor-full.log exit=0 bytes=1852 sha256=CB11F6307FA9E28EC52386E0232A2C9484AF28FBE4A71943450B702BE7FDFCB2 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-attempt1-editor-typecheck.log exit=2 bytes=2024 sha256=7DDEEB7C5E1813E6CAFCDE075CAD9CF16CBEAD6E9A3BF110646DBC13EA78CEEC runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
 greenAttempt2 = required focus exit 0; 8 files / 29 tests PASS; typecheck/build exit 0
 greenAttempt2Artifacts = task8-green-attempt2-editor-focus.log exit=0 bytes=884 sha256=E05CB570FACF08E39E91997FE7B34BDDA51BAE3B12CB099F8690D780356F4FB1 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-attempt2-editor-typecheck.log exit=0 bytes=70 sha256=6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-attempt2-editor-build.log exit=0 bytes=1998 sha256=CAD7DBFDB67EE1E8F91E2D09B74E90262A57F7946B2287BF9152F4F368D36B2D runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
 greenAttempt3 = focus exit 0; 8 files / 29 tests PASS; typecheck exit 2 on File System write chunk type
 greenAttempt3Artifacts = task8-green-attempt3-editor-focus.log exit=0 bytes=885 sha256=1C750A4B2872E92E31B55551E46799C896F79114DF8C8B9E073709A6F80EACE6 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-attempt3-editor-typecheck.log exit=2 bytes=993 sha256=C697987D192EA9E8D09955A47592DC5D0EBA469DFB8A8640B44F8E01E9E1661D runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
 greenAttempt4 = typecheck/build exit 0
 greenAttempt4Artifacts = task8-green-attempt4-editor-typecheck.log exit=0 bytes=70 sha256=6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-attempt4-editor-build.log exit=0 bytes=1998 sha256=D75348C960DB12EB23537C909AE86C62D8BC3410AA81B96E0356F57A9799F7D7 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
 finalGreenCommands =
   npm run test -w surdet-editor -- review-panel.test.ts review-preview.test.ts review-workspace.test.ts review-model.test.ts causal-selection.test.ts preview-stage-layout.test.ts preview-causal-trace.test.ts project-io.test.ts
   npm run test -w surdet-editor
   npm run typecheck -w surdet-editor
   npm run build -w surdet-editor
 finalGreenResults = Editor 8 files / 29 tests PASS exit 0; Editor 32 files / 190 tests PASS exit 0; editor typecheck PASS exit 0; editor build PASS exit 0
finalGreenArtifacts = task8-green-final3-editor-focus.log exit=0 bytes=884 sha256=32C8BD073628C5B37A78F8130DBE6F71FE18D719B6D6B34F3C4302D0F73A1B77 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-final3-editor-full.log exit=0 bytes=1852 sha256=A210444D1E48B129BFA5B72722949FB192605EF947EAF407C6BCC9C76DF6DC4D runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-final3-editor-typecheck.log exit=0 bytes=70 sha256=6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-final3-editor-build.log exit=0 bytes=1998 sha256=5D1183C5DC862D833A945A0A0F325712B9FEEFD54BE93F4EE8383D4C7D0C3904 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
supersededFinalGreenArtifacts = task8-green-final2-editor-focus.log exit=0 bytes=884 sha256=1704073149A3EC0029E8297EAEB502244A099E5B86E16D7E5B718B7F7B41E689 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-final2-editor-full.log exit=0 bytes=1851 sha256=C280AA913BECA46CCF1312DD5D7C859E10B01B3F6658AF209794FAB77C2CBA2B runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-final2-editor-typecheck.log exit=0 bytes=70 sha256=6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3 runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1; task8-green-final2-editor-build.log exit=0 bytes=1998 sha256=9B01B906256459D9CE58DF4F93328DF44ADFB721D5AB439BDD1527659654855C runHead=d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
 contract = comparison/result review use human-first Chinese labels with folded technical IDs; safe groups are included by default; only allowed conflict actions are clickable; unresolved or blocking conflicts disable decision sealing; shared review projection alone supplies causal references, potential impact and observed impact; result preview opens result/project through review-fixture mode, preserves explicit scene/choices/timeline request state, hashes sorted relative fixture identities, snapshots official fixture for discard, and disables approval on changed tree; preview/causal/layout contracts keep the center preview usable and independently scrollable
 unresolved = NONE
 formal = NOT_RUN; diagnostic = NOT_RUN
 commit = deaf74a64024b91e46cc750822295e0f9c2ce739; message = feat(editor): render human review workflow
 nextStop = TASK_9
 push = NOT_PERFORMED
~~~

### 2026-08-27 — Task 9 聚焦总门、工作区全量与唯一 verify:all

~~~text
timestamp = 2026-08-27
task = 9_FOCUSED_GATES_FULL_WORKSPACE_AND_UNIQUE_VERIFY_ALL
initialHead = deaf74a64024b91e46cc750822295e0f9c2ce739
finalHead = deaf74a64024b91e46cc750822295e0f9c2ce739 (Task 9 白名单测试修正与本 Ledger 尚未冻结，待 Task 10 code-evidence commit)
parent = d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
remoteMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehindBeforeTask9 = 10/0
trackedWorktreeBeforeTask9 = CLEAN after Task 8 commit; Task 8 Ledger correction then Task 9 four test fixes were the only tracked changes; known untracked preserved
stagingArea = EMPTY before Task 10 freeze
filesChanged = packages/cli/test/agent-port-capsule.test.ts; packages/cli/test/agent-port-composition.test.ts; packages/cli/test/authoring-presentation-wave2.test.ts; packages/cli/test/authoring-project-config-wave3.test.ts; this taskbook Execution Ledger
redCommands = npm run test -w @surdet/cli (first full run); npm run test -w @surdet/cli (second full run after stale-contract fixes)
redResults = first full CLI 34 files / 261 tests: 3 failed, 258 passed, exit 1 (two stale 30-capability expectations and one stale contractVersion expectation); second full CLI 34 files / 261 tests: 2 failed, 259 passed, exit 1 (agent-port-composition 5s timeout and authoring-presentation-wave2 15s timeout under full parallel load)
redArtifacts = <local-path> bytes=19957 sha256=7EC5977C1421EEC2A6F283CE1EEC621252C88EA8FE930B4200A81A285F20A571 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; <local-path> bytes=19928 sha256=95E59F70C36DE2E7064C36506922171C72412BABDF85CA675FECC76586196E4E runHead=deaf74a64024b91e46cc750822295e0f9c2ce739
minimalGreenCommands = npm run test -w @surdet/cli -- agent-port-capsule.test.ts authoring-presentation-wave2.test.ts authoring-project-config-wave3.test.ts; npm run test -w @surdet/cli -- agent-port-composition.test.ts authoring-presentation-wave2.test.ts
minimalGreenResults = 3 files / 15 tests PASS exit 0; 2 files / 16 tests PASS exit 0
minimalGreenArtifacts = <local-path> bytes=2586 sha256=A800F9A156F1C682A8AEF8C734E03CB7C53322B63ED71CC3C45383FBCF15CCBB runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; <local-path> bytes=2661 sha256=69BAE0E30BEDEB2FCC586F1D65640A27730175D7574F9CA05016161E2C0A1E8C runHead=deaf74a64024b91e46cc750822295e0f9c2ce739
step1Artifact = <local-path> bytes=4502 sha256=B70DCD4F56624EB5D850B8F6B55F61B0BF093FAABB7D69BFDA08502E9A9693B8 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739 exit=0; git log/status/diff-check/name-only showed only Wave 6 paths plus the Task 8 Ledger correction and known untracked files
authoringCommands = npm run test -w @surdet/authoring -- working-object-fingerprint.test.ts review-projection.test.ts review-receipts.test.ts integration-plan.test.ts integration-execution.test.ts commit-recovery.test.ts capability-registry.test.ts error-catalog.test.ts; npm run test -w @surdet/authoring; npm run typecheck -w @surdet/authoring; npm run build -w @surdet/authoring
authoringResults = 8 files / 78 tests PASS; 30 files / 240 tests PASS; typecheck PASS; build PASS; all exit 0
authoringArtifacts = <local-path> bytes=1200 sha256=0ED455D2214DDBF31AFE7940FF26D2C25BEB3D7C7F8A53848F3EC10FB6098A51 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; task9-authoring-full.log bytes=1889 sha256=86E85C2F8D8DA3D12B0E7A88E6EF7094499CA8645489E19B07ECC7351BCF0B36 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; task9-authoring-typecheck.log bytes=136 sha256=150AFC8992F232B25F386E01316250231780ED809BB62E97293A1C2F805E53E1 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; task9-authoring-build.log bytes=125 sha256=AFF85A3C293F90A850D65189AD9128A5CE8439019F6BD67288D2BBD5450CCF8B runHead=deaf74a64024b91e46cc750822295e0f9c2ce739
cliCommands = npm run test -w @surdet/cli -- node-review-store.test.ts review-service.test.ts agent-port-review.test.ts composition-service.test.ts authoring-contract.test.ts agent-port-output-contract.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-security.test.ts; npm run test -w @surdet/cli; npm run typecheck -w @surdet/cli; npm run build -w @surdet/cli
cliResults = focus 9 files / 74 tests PASS; full 34 files / 261 tests PASS on final run; typecheck PASS; build PASS; all final commands exit 0
cliArtifacts = <local-path> bytes=5380 sha256=2F7DF89EFA8AB78CE9026BB941AC424F735C5789C9E92CF25BCC7836C3FB9591 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; task9-cli-full-final.log bytes=16198 sha256=BD0AA4FFB1B573C9E2D6789FEC20B230C8BF9564933102ABE548232233720DE3 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; task9-cli-typecheck.log bytes=124 sha256=3E15EC846FC37DA9784D7AF5B07D9D50DABE23B047972DD36DE3A24C354AD07A runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; task9-cli-build.log bytes=113 sha256=02767C408A9DCBE23FD3BFABE1A8E51B93D3CCA5A10B3F755739C8357CB90935 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739
editorCommands = npm run test -w surdet-editor -- review-workspace.test.ts review-model.test.ts review-panel.test.ts review-preview.test.ts causal-selection.test.ts preview-stage-layout.test.ts project-io.test.ts; npm run test -w surdet-editor; npm run typecheck -w surdet-editor; npm run build -w surdet-editor
editorResults = focus 7 files / 27 tests PASS; full 32 files / 190 tests PASS; typecheck PASS; build PASS; all exit 0
editorArtifacts = <local-path> bytes=1020 sha256=ECDA98D6D553BF8FCEAB1B3D7AAC7D5DE87BB7A494E52F8BC9E813A0302ADBEE runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; task9-editor-full.log bytes=1905 sha256=BBF87EB5A8B2C26095E093379501FC552893E4B5FC28810D913AE4500C211DC6 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; task9-editor-typecheck.log bytes=128 sha256=269485B3C83AC867487353562CA4BC5487A8FB43D6858A3BA1C0862A7B82D3CF runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; task9-editor-build.log bytes=2052 sha256=980D08C4AD73EEF6EB3B9D003D4BA9495D6810D38719E69B1CF801CD5F9320A5 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739
starterCommand = npm run simulate -w surdet-starter
starterResult = exit 0; runtime errors=0; pathsExplored=13; pruned=7; choiceCoverage=2/3; saveLoad=25; endings=demo_end (12)
starterArtifact = <local-path> bytes=444 sha256=3F76494C9F6C86EB71CEBD02F9973822BC9EDA9D92ED4E53143F804AD2C336FF runHead=deaf74a64024b91e46cc750822295e0f9c2ce739
verifyCommand = npm run verify:all 2>&1 | Tee-Object -FilePath (Join-Path $task9Root 'task9-verify-all.log')
verifyResult = PASS exit 0; unique verify:all budget consumed 1/1; verify:all final diff-check exit 0
verifyArtifact = <local-path> bytes=70824 sha256=06E9B2FB3C787C0AF936720643FCB8E6196C05626E09484B816BD85FEA8A489B runHead=deaf74a64024b91e46cc750822295e0f9c2ce739 exit=0
unresolved = NONE; existing lint warnings remain warnings only; no starter modification; no e2e/artifacts discovery contamination
formal = NOT_RUN; diagnostic = NOT_RUN
nextStop = TASK_10
push = NOT_PERFORMED
~~~

### 2026-08-27 — Task 10 runner contract、唯一 preflight 与 DIAGNOSTIC budget exhausted

~~~text
timestamp = 2026-08-27
task = 10_UNIQUE_HUMAN_REVIEW_RUNNER_PREFLIGHT_DIAGNOSTIC_FORMAL_GATE
initialHead = deaf74a64024b91e46cc750822295e0f9c2ce739
finalHead = deaf74a64024b91e46cc750822295e0f9c2ce739 (no Task 10 commit; diagnostic budget exhausted)
parent = d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
remoteMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehind = 10/0
trackedWorktree = TASK_9_TEST_FIXES_PLUS_TASK_10_RUNNER_AND_LEDGER; no protected or foreign tracked paths observed
stagingArea = EMPTY
filesCreated = packages/cli/e2e/human-agent-review-wave-6.e2e.mjs; packages/cli/test/human-agent-review-wave-6-runner.test.mjs
filesChanged = packages/cli/test/agent-port-capsule.test.ts; packages/cli/test/agent-port-composition.test.ts; packages/cli/test/authoring-presentation-wave2.test.ts; packages/cli/test/authoring-project-config-wave3.test.ts; this taskbook Execution Ledger
redCommand = node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs (before runner creation)
redExit = 1
redFirstFailure = runner module was absent (ERR_MODULE_NOT_FOUND)
redArtifact = <local-path> bytes=1533 sha256=7ADF56CFCC754F20F03EF6956B62E1E1B909D51DF2FFF6EE2F7AA0C140E6F362 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739
contractGreenCommands = node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs; node --check packages/cli/e2e/human-agent-review-wave-6.e2e.mjs
contractGreenResults = runner contract 3 tests PASS exit 0; syntax check PASS exit 0
contractGreenArtifacts = task10-step7-contract.log bytes=377 sha256=D577E1C9639683BF073D0BC7F5500C4BA077BECBC2D6F47BE34ECF3CDFCBA0F7 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; syntax command exit 0 with no output artifact
preflightCommand = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=preflight
preflightResult = PASS exit 0; modern/legacy protocol PASS; 30 capabilities; contract 2.1.0; observe/stage filter; stdout purity; child cleanup; Editor index/preview build entries; original Starter unchanged
preflightArtifact = <local-path> bytes=1661 sha256=3D88D90A1DA25B427595BD75CC2FCFE004F0A5A900661B27FBF3B633B07C64A runHead=deaf74a64024b91e46cc750822295e0f9c2ce739 runnerSha256=87a10244f9869b129187a1954dacef9d09ab858e51c5c25c3f1c36fdde502a42; identity.json bytes=223 sha256=6275BC440D2E9667D612AF9FCAFA2D38E1507E03189F103B1D97A11FE249F635
diagnosticBudget = 3/3 consumed; no recovery diagnostic authorized
diagnostic1 = node --check ... exit 0; node ... --mode=diagnostic exit 1; lastPassedNode=candidate-fixtures-sealed; firstFailedNode=comparison-prepared; runnerSha256=87a10244f9869b129187a1954dacef9d09ab858e51c5c25c3f1c36fdde502a42
diagnostic1Artifact = <local-path> bytes=10046 sha256=11852ACCA5C3B547A3055BF2C28C0B5E1A465C7041E3AA847F170DEA4E85D189 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; identity.json bytes=225 sha256=F6CC98073204A4F2F87045BEDC6BF589FA840BE5920E5499D5383B8AF6FC10B5; failure=response envelope was unwrapped one level too far
diagnostic2 = runner response/path fix; node --check exit 0; node ... --mode=diagnostic exit 1; lastPassedNode=decision-required-error; firstFailedNode=editor-decision-receipt-visible; runnerSha256=02847414b0e0cc3d1a73ab3126f4a578363625aeb2f9e6dd617405ca24b57987
diagnostic2Artifact = <local-path> bytes=79083 sha256=A73059669C6F9DC35D96D702322DCDDCA38E88751F5294DCD3DC4D8C246E45AD runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; identity.json bytes=225 sha256=8ACDAC5EA088C673C9F05AF1FC1C23344D1CF64A9636CDAE5E5DCA53894A402C; failure=review root used prepared.dataDir instead of prepared.evidence.dataDir
diagnostic3 = runner review-root/explicit-A selection fix; node --check exit 0; node ... --mode=diagnostic exit 1; lastPassedNode=decision-required-error; firstFailedNode=editor-decision-receipt-visible; runnerSha256=f25c128a769d3ac57650b11a8277f26b68af8d0cda86a4a7697dcb33eaca8dcd
diagnostic3Artifact = <local-path> bytes=78937 sha256=086CAC7D71348263BC013CC9C175F0BC4A818B7AD2717B95109FFA57C1B9E777 runHead=deaf74a64024b91e46cc750822295e0f9c2ce739; identity.json bytes=225 sha256=D078DF23E4F9CAF147A16D448C230DE15CEDB9A85ABC4628C37BB8D8978BD1C6; failure=Editor comparison DOM did not expose the asserted A/D identical source text
formal = NOT_RUN; FORMAL_RUN_BUDGET remaining = 1/1
verifyAll = already PASS and consumed before Task 10: 1/1; no rerun
commit = NONE; CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
unresolved = DIAGNOSTIC_BUDGET_EXHAUSTED at editor-decision-receipt-visible; no product conclusion drawn from the failed runner assertion
nextStop = DIAGNOSTIC_BUDGET_EXHAUSTED; stop before code-evidence commit and FORMAL
push = NOT_PERFORMED
~~~

### 2026-08-29 — W6 reopen and persisted decision receipt recovery 3

~~~text
timestamp = 2026-08-29
task = W6_REOPEN_AND_RECEIPT_RECOVERY_3
managerDecision = APPROVED
initialHead = deaf74a64024b91e46cc750822295e0f9c2ce739
finalHead = deaf74a64024b91e46cc750822295e0f9c2ce739 (no recovery commit; the only authorized recovery diagnostic failed)
recoveryDiagnosticBudget = 1/1 consumed; this was a new manager-authorized budget and did not reuse the historical exhausted 3/3 budget
scopeEvolution = 18 paths was the historical snapshot; 23 paths was the authorized current closure before this recovery implementation; actual closure is 24 paths because packages/editor/src/main.ts is required for open -> renderAll -> setStatus lifecycle correctness
scopeAtDiagnostic = 22 tracked Wave 6 diffs plus 2 exact runner files; staging EMPTY
protectedHistoricalArtifact = <local-path> bytes=192722 sha256=F87ACE0E313B2FA0F3F48F7CEE666DB52FF473BB3327180A5309543EC259F2BF runHead=deaf74a64024b91e46cc750822295e0f9c2ce739 runnerSha256=9644460bf1cf1c76361ccea42ebae5ababec34bbb70a38e88caea05078fb4cf9 decisionId=13602c91-7c47-4aa4-9ea8-8c0b3c208567; preserved without delete/move/rewrite
permanentRed = Editor workspace/panel 5 failed and 21 passed, exit 1; runner contract 2 failed and 10 passed, exit 1; deferred receipt-write lock 1 failed, exit 1
permanentRedArtifacts = <local-path> bytes=10030 sha256=9DB61EE538BF7BBCCC1670303EC25572C11710D3FF25671587585333B092B178; runner-contract-red.log bytes=16407 sha256=3DC30BD0DBF9FE4704FE064DDCDB2B1F6F1B7B5BDEFA6100738E40DCC1FBB0F3; editor-pending-write-red.log bytes=2650 sha256=C4CC3429729B5ED59ED37851F986288E5EFA5020332DE6DE6E41D0BA8733668E
focusedGreen = Editor 5 files / 37 tests PASS; Editor typecheck PASS; Editor build PASS; CLI review-service 2/2 PASS; runner contract 12/12 PASS; runner syntax PASS; git diff --check PASS; git diff --cached --check PASS; all exit 0
focusedGreenArtifacts = <local-path> bytes=660 sha256=1DA7D25FE85C4C1C67EEE422AAEEC077937F798D3F367AEAC3CFEBBDAC82651C; editor-typecheck.log bytes=70 sha256=6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3; editor-build.log bytes=1998 sha256=DE1F794293C48E39083BA6B84B9AB7B8E4DF21989145B63569F876C8DC01DAF5; cli-review-service.log bytes=534 sha256=AD46903DB37D81E350FB4E910F3FCEAEC2974F19A35CD742AC9FC8974868BE2E; runner-contract.log bytes=1342 sha256=7B7D259E086B02FD0DCF20E5C32D05B0FBF2C1A61E985A24BF2ED36B81D961A4; runner-syntax.log bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
staticRunnerAudit = fixed 22 milestones retained; no waitForTimeout, fixed 1200ms delay, old 已打开审阅任务 count assertion, or stale comparison-heading reopen proof remains; receipt reopen and official-result reload both wait for the old workbench to detach
diagnosticCommand = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=diagnostic
diagnosticResult = FAILED exit 1; milestones 10 PASSED / 1 FAILED
diagnosticArtifact = <local-path> bytes=200361 sha256=B5716FEDDDDC9ECD88766C6FDBC869D86D751B8299D6F6E92E7E195DD7978266
diagnosticIdentity = <local-path> bytes=226 sha256=D8478E09247E6C4D0125FEC1EA88D0B80FA5B3FCC2397A4DA75D3B65C784F8C9
diagnosticInvocationLog = <local-path> bytes=165016 sha256=73B33E89B62EF37D391AD7F40195DF78F16F70036B0AD7057FB82DE2D2960706
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = c556c0b1e0636135d48494fc5c40107236252d98649ab190f068003d05733be8
lastPassedNode = editor-decision-receipt-visible
receiptReopenProof = PASS; decisionId=cbf89637-01c4-4be9-bc02-0793a4c2feaf; decisionFingerprint=a0da7fabc248cf3d17b0290ba0b35e73280544150d7a876142586098d4675f2b; persistent marker visible; selected choice restored; all 5 decision controls disabled; decision.json bytes=1909 sha256=BD5D559B5AF0D8A07CBAE04014031A9662304213708B259F072A2CB899F81234
firstFailedNode = reviewed-plan-sealed
firstFailure = surdet_composition_plan returned no structuredContent
errorChannels = errors=1; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0; blockingIssueChannels=errors
projectMutation = FALSE; stageProjectMutated=FALSE; applyProjectMutated=FALSE
postFailureActions = no code changes; no diagnostic rerun; no FORMAL; no verify:all; no staging; no commit; no push; no Wave 7
formal = NOT_RUN
commit = NONE
push = NOT_PERFORMED
wave7 = NOT_STARTED
status = W6_REOPEN_RECEIPT_RECOVERY_3_FAILED
nextStop = W6_REOPEN_RECEIPT_RECOVERY_3_FAILED; waiting for manager decision on the new reviewed-plan-sealed failure
~~~

### 2026-08-29 — W6 reviewed composition plan schema recovery 4

~~~text
timestamp = 2026-08-29
task = W6_REVIEWED_PLAN_SCHEMA_RECOVERY_4
status = W6_REVIEWED_PLAN_SCHEMA_RECOVERY_4_FAILED
recoveryDiagnosticBudget = 1/1 consumed; no rerun authorized
diagnosticArtifact = <local-path> bytes=199993 sha256=B9F886E69564A4A06D1B48B26F6BF714FDA284CF66743E2B01DA11E3800ED322
diagnosticIdentity = <local-path> bytes=226 sha256=412111F294687A1592000D1667D965FEF5D591BA7D7C9B70DA6BAB9D0A863082
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = 4f6391a55bf5acaa6fb121ba3aeb01cd5697449446d576c9a5255634ef902454
lastPassedNode = editor-decision-receipt-visible
firstFailedNode = reviewed-plan-sealed
rawMcpErrorSummary = NONE; the reviewed surdet_composition_plan request passed MCP SDK input validation and returned structuredContent, so the artifact contains no MCP SDK/protocol error body
firstFailure = TypeError: Cannot read properties of undefined (reading 'includes') at packages/cli/e2e/human-agent-review-wave-6.e2e.mjs:1199:46
~~~

### 2026-08-29 — Recovery 4 first-failure correction (append-only)

~~~text
timestamp = 2026-08-29
correctionFor = W6_REVIEWED_PLAN_SCHEMA_RECOVERY_4
historicalRecord = PRESERVED; this block corrects the field attribution without rewriting the earlier entry
correctFirstFailure = packages/cli/e2e/human-agent-review-wave-6.e2e.mjs:1199: inspectedPlan.includedUnitIds.includes(sceneUnitB.unitId)
supersededFailureAttribution = inspectedPlan.implicitInclusions.includes(...)
sealedPlanId = pln_efa7b25196ee3fdbf74474a0bfe6f14c
sealedPlanPayload = <local-path> bytes=10919 sha256=53A46B7A92C5E66D324BF36A5449EE2F7132089ED8C52850F3DD53C4D125062D
sealedPlanFacts = selectedUnitIds contains B scene; implicitInclusions contains B timeline; replayOperations contains both with B timeline before B scene; C excluded; reviewState=human-reviewed; dryRun.status=passed; dryRun.finalObjectFingerprints count=4
~~~

### 2026-08-29 — W6 runner projection closure recovery 5 failure

~~~text
timestamp = 2026-08-29
task = W6_RUNNER_PROJECTION_CLOSURE_5
status = W6_RUNNER_PROJECTION_CLOSURE_5_FAILED
recoveryDiagnosticBudget = 1/1 consumed; no rerun authorized
diagnosticArtifact = <local-path> bytes=202475 sha256=34FB93E52B57559E4192B9B1C2DDB16C2A3D313E3EDD0FA294805C922DE91501
diagnosticIdentity = <local-path> bytes=226 sha256=F76EE0BA64FFFD3C0EF547BD81E55BCE2EDCFCC956D54C6B4EB1541E9ADD4087
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = 966ad9a47c512e20e8d7d2d040d942b33d9f0e6c590b861f50ae8e04cb01c76a
milestones = 11 PASSED / 1 FAILED
lastPassedNode = reviewed-plan-sealed
firstFailedNode = integration-stage-ready
firstFailure = composition.execute reviewed failed with CHANGE_STORE_CORRUPT because V2 manifest was missing at candidate-l7Y9Zv/agent-data/9128f1298698963afc75429f5426a65f/reviews/manifest.json; retryDisposition=manual-recovery
errorChannels = errors=1; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0; blockingIssueChannels=errors
projectMutation = FALSE; stageProjectMutated=FALSE; applyProjectMutated=FALSE
postFailureActions = no code changes; no diagnostic rerun; no commit; no FORMAL; no acceptance-prep; no external Agent; no apply; no push; no Wave 7
~~~

### 2026-08-29 — W6 project data namespace recovery 6 failure

~~~text
timestamp = 2026-08-29
task = W6_PROJECT_DATA_NAMESPACE_RECOVERY_6
status = W6_PROJECT_DATA_NAMESPACE_RECOVERY_6_FAILED
initialHead = deaf74a64024b91e46cc750822295e0f9c2ce739
finalHead = deaf74a64024b91e46cc750822295e0f9c2ce739 (no recovery commit; the only authorized Recovery-6 diagnostic failed)
scopeAtDiagnostic = 24 tracked Wave 6 diffs plus 2 exact runner files = 26 authorized Wave 6 paths; staging EMPTY; 968 unrelated untracked paths preserved
implementation = listChangeDirectories now enumerates only directory entries in the chg_ change namespace that satisfy the existing safe directory character constraint; no metadata namespace exclusion list and no corrupt-change fallback were added
permanentRedCommand = npm run test -w @surdet/cli -- composition-service.test.ts
permanentRedResult = FAILED exit 1; 1 file / 9 tests: 1 failed, 8 passed; the legal NodeReviewStore reviews namespace was misread as changeId=reviews at reviews/manifest.json, while the corrupt chg_broken_namespace fail-loud preservation test passed
permanentRedArtifact = <local-path> bytes=3220 sha256=D01A01C0997BEA28496F9CDE76CDC27E58C9F434ACF1C0F0E54A1990096D4495
focusedGreenCommands = npm run test -w @surdet/cli -- composition-service.test.ts; npm run test -w @surdet/cli -- composition-service.test.ts review-service.test.ts agent-port-composition.test.ts; npm run typecheck -w @surdet/cli; npm run build -w @surdet/cli; node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs; node --check packages/cli/e2e/human-agent-review-wave-6.e2e.mjs; git diff --check; git diff --cached --check
focusedGreenResults = composition-service 1 file / 9 tests PASS; adjacent CLI 3 files / 19 tests PASS; CLI typecheck PASS; CLI build PASS; runner contract 18/18 PASS; runner syntax PASS; worktree diff check PASS; staged diff check PASS; all exit 0
namespaceRegressionProof = legal reviews/<reviewId> identity remains present without reviews/manifest.json and executePlan reaches READY; chg_broken_namespace without manifest remains CHANGE_STORE_CORRUPT and its directory plus sentinel remain unchanged
recoveryDiagnosticBudget = 1/1 consumed; no rerun authorized
diagnosticCommand = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=diagnostic
diagnosticResult = FAILED exit 1; milestones 16 PASSED / 1 FAILED
diagnosticArtifact = <local-path> bytes=241297 sha256=731622AA49C5BAEC23E7A3CFB282802F768A515B417F7E30BEBEBA152C645C3E
diagnosticIdentity = <local-path> bytes=226 sha256=EA89EF55574B820140171177A3766F0E0723D22C36665DE940B2E56C4DE368A8
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = 966ad9a47c512e20e8d7d2d040d942b33d9f0e6c590b861f50ae8e04cb01c76a
namespaceRecoveryMilestone = integration-stage-ready PASSED; changeId=chg_0001_e59d6872-e8d4-4181-8406-0f4e25b7a1e9; status=READY; operationCount=4
lastPassedNode = approval-required-error
firstFailedNode = editor-result-rendered
firstFailure = locator.waitFor timed out after 7000ms while waiting for iframe[title="剧情预览"] body text Alpha route A. to become visible at human-agent-review-wave-6.e2e.mjs:966:57
browserFailureEvidence = captured for result root; globalStatus=校验通过（9 条警告）; receipt marker absent; approve-result and return-result controls enabled; decision.json, final-approval.json and return-request.json absent in fake-root receipt snapshot
errorChannels = errors=1; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0; blockingIssueChannels=errors
projectMutation = FALSE; stageProjectMutated=FALSE; applyProjectMutated=FALSE
originalStarterFinalIdentity = UNVERIFIED because the workflow stopped before the final identity milestone
postFailureActions = no implementation changes after failure; only this append-only Ledger record; no diagnostic rerun; no staging; no commit; no FORMAL; no acceptance-prep; no external Agent; no Owner acceptance; no apply; no push; no Wave 7
formal = NOT_RUN
commit = NONE; CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
push = NOT_PERFORMED
wave7 = NOT_STARTED
nextStop = W6_PROJECT_DATA_NAMESPACE_RECOVERY_6_FAILED; waiting for independent manager decision on editor-result-rendered
~~~

### 2026-08-29 — W6 canvas preview evidence recovery 7 failure

~~~text
timestamp = 2026-08-29
task = W6_CANVAS_PREVIEW_EVIDENCE_RECOVERY_7
status = W6_CANVAS_PREVIEW_EVIDENCE_RECOVERY_7_FAILED
initialHead = deaf74a64024b91e46cc750822295e0f9c2ce739
finalHead = deaf74a64024b91e46cc750822295e0f9c2ce739 (no recovery commit; the only authorized Recovery-7 diagnostic failed)
scopeAtDiagnostic = 24 tracked Wave 6 diffs plus 2 exact runner files = 26 authorized Wave 6 paths; staging EMPTY; 968 unrelated untracked paths preserved
recovery6FrozenFiles = packages/cli/src/authoring/composition-service.ts bytes=18058 sha256=54E1BCBC1431272C1BF1336FF8A9159D7743AB28356BDD3318231F813CCD4B8C; packages/cli/test/composition-service.test.ts bytes=23863 sha256=F64E39060F2180CEF9DF9DD51462FD7BE321DC43C44F8DE1C596382EABF4E925; unchanged throughout Recovery-7
runnerChange = result preview evidence now installs a bounded parent-window collector for surdet-preview-trace-start/event/complete before preview click, waits on the formal projectionSnapshot canvas semantics, proves canvas geometry plus Alpha A dialogue/speaker/panel and matching Core/presentation text trace, removes frameText, and captures iframe/debug/projection/canvas/trace failure diagnostics
permanentRedCommand = node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs
permanentRedResult = FAILED exit 1; 18 tests: 1 failed, 17 passed; old runner was rejected at frameBody.filter({ hasText: 'Alpha route A.' }) before the remaining semantic-evidence assertions
permanentRedArtifact = <local-path> bytes=8649 sha256=00BBC740CD95C199D10100943A10370BAD1AAB6EC88EAE32D4270BA5F59C7CE5
focusedGreenCommands = node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs; node --check packages/cli/e2e/human-agent-review-wave-6.e2e.mjs; git diff --check; git diff --cached --check
focusedGreenResults = runner contract 18/18 PASS; runner syntax PASS; worktree diff check PASS; staged diff check PASS; all exit 0
runnerAtDiagnostic = packages/cli/e2e/human-agent-review-wave-6.e2e.mjs bytes=88457 sha256=D82B6FC453324F2FD319AB83FDFA8BAAEB06E1DD8AC05735BEA552DF0852E1B1
runnerContractAtDiagnostic = packages/cli/test/human-agent-review-wave-6-runner.test.mjs bytes=22057 sha256=4D5FB5E6B71E2FE0036FDB3E7E1981F502EE076D117538D89205ED056D3ADD26
recoveryDiagnosticBudget = 1/1 consumed; no rerun authorized
diagnosticCommand = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=diagnostic
diagnosticResult = FAILED exit 1; milestones 14 PASSED / 1 FAILED
diagnosticArtifact = <local-path> bytes=211616 sha256=A59BB08F80B1A60F1A32700144DAFD5CEB563C0D405BB5B63EF3E7F8D2E6F7C5
diagnosticIdentity = <local-path> bytes=226 sha256=4AC083D4BD7381F09F4DCB8161C5673075C0B463BA2A523CABB73819E684DF1C
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = d82b6fc453324f2fd319ab83fdfa8baaeb06e1dd8ac05735bea552df0852e1b1
lastPassedNode = fresh-diff-validation-simulation-runtime
firstFailedNode = result-review-prepared
firstFailure = review.prepare-result returned INVALID_REQUEST with retryDisposition=same-request because rmdir of the project lease directory failed with ENOTEMPTY
activeLeaseDirectory = <local-path>
errorChannels = errors=1; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=1; blockingIssueChannels=errors,activeLeaseDirectories
projectMutation = FALSE; stageProjectMutated=FALSE; applyProjectMutated=FALSE
canvasPreviewEvidence = NOT_REACHED; editor-result-rendered did not run, so the new previewEvidence remains contract-GREEN but diagnostic-UNVERIFIED
originalStarterFinalIdentity = UNVERIFIED because the workflow stopped before the final identity milestone
task5CodeEvidenceFreeze = NOT_ENTERED; Recovery-1 through Recovery-7 consolidated budget-history append was conditional on diagnostic 22/22 and was not performed
postFailureActions = no runner or contract changes after failure; only this append-only Ledger record; no diagnostic rerun; no staging; no commit; no FORMAL; no acceptance-prep; no external Agent; no Owner acceptance; no apply; no push; no Wave 7
formal = NOT_RUN; FORMAL budget remains historically unconsumed 1/1
commit = NONE; CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
push = NOT_PERFORMED
wave7 = NOT_STARTED
nextStop = W6_CANVAS_PREVIEW_EVIDENCE_RECOVERY_7_FAILED; waiting for independent manager decision on result-review-prepared lease cleanup failure
~~~

### 2026-08-29 — W6 lease correctness recovery 8 Task 0 baseline

~~~text
timestamp = 2026-08-29
task = W6_LEASE_CORRECTNESS_RECOVERY_8
managerDecision = APPROVED
phase = TASK_0_BASELINE_COMPLETE; permanent RED not yet added; implementation not started
branch = main
head = deaf74a64024b91e46cc750822295e0f9c2ce739
parent = d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1
surdetMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehind = 10/0
trackedWave6Diffs = 24 paths; preserved without reset, checkout, stash, clean, delete, move, or overwrite
untracked = 968 total: 2 exact Wave 6 runner paths plus 966 unrelated paths; all preserved
runner = packages/cli/e2e/human-agent-review-wave-6.e2e.mjs bytes=88457 sha256=D82B6FC453324F2FD319AB83FDFA8BAAEB06E1DD8AC05735BEA552DF0852E1B1
runnerContract = packages/cli/test/human-agent-review-wave-6-runner.test.mjs bytes=22057 sha256=4D5FB5E6B71E2FE0036FDB3E7E1981F502EE076D117538D89205ED056D3ADD26
staging = EMPTY
worktreeDiffCheck = PASS exit 0
stagedDiffCheck = PASS exit 0
recovery7Evidence = <local-path> bytes=211616 sha256=A59BB08F80B1A60F1A32700144DAFD5CEB563C0D405BB5B63EF3E7F8D2E6F7C5
recovery7Identity = <local-path> bytes=226 sha256=4AC083D4BD7381F09F4DCB8161C5673075C0B463BA2A523CABB73819E684DF1C
recovery7ResidualLockDirectory = <local-path> preserved in place
recovery7ResidualLease = lease.json bytes=288 sha256=FFCFE84A432E370859BAD243EDB2AB01D79E34990A6630881EBD63159BAA791F scope=project resourceId=1a13e19dd82179f5a7c596180c10cc02 ownerToken=cd298a31-31f2-421d-aef8-014d1a5b9b3a pid=67508 hostname=EarthLight
recovery7Failure = lastPassedNode=fresh-diff-validation-simulation-runtime; firstFailedNode=result-review-prepared; rmdir project lease directory failed with ENOTEMPTY after prepare-result business side effects; old fixture was not retried or mutated
diagnosticBudget = 1/1 unconsumed
formalBudget = 1/1 unconsumed
externalAgent = NOT_STARTED
ownerAcceptance = NOT_STARTED
apply = NOT_AUTHORIZED
push = NOT_PERFORMED
wave7 = NOT_STARTED
~~~

### 2026-08-29 — W6 lease correctness recovery 8 permanent RED

~~~text
timestamp = 2026-08-29
task = W6_LEASE_CORRECTNESS_RECOVERY_8
phase = PERMANENT_RED_CONFIRMED; production implementation not yet modified
redCommand = npm run test -w @surdet/cli -- node-local-lease.test.ts composition-service.test.ts review-service.test.ts
redResult = FAILED exit 1; 3 files / 26 tests: 6 failed, 20 passed
firstFailedAssertion = packages/cli/test/node-local-lease.test.ts:178; 同一 lease 启动了重叠 heartbeat callback; expected 2 to be 1
heartbeatDrainRed = project and change scope each started two overlapping callbacks under the deterministic barrier
releaseEvidenceRed = unexpected lock occupant produced raw ENOTEMPTY instead of LEASE_CORRUPT with manualRecoveryRequired=true
compositionCanonicalLockRed = currentSnapshot acquired resourceId=<already-hashed projectIdentity> instead of storage.rootIdentity
reviewCanonicalLockRed = canonical Authoring project lease did not contend; prepareResult resolved and created a result review instead of PROJECT_BUSY
reviewLockOrderRed = observed project.acquire -> change.acquire -> change.release -> project.release instead of change -> project nesting
redValidity = failures are contract assertions; no parse error, fixture error, timeout, real 2-second wait, probabilistic polling, old dist, or diagnostic execution
redArtifact = <local-path> bytes=18539 sha256=58FFD71F5FF460195422C3A02D1BDF1DA472730958304698F91A516AD64902FB
diagnosticBudget = 1/1 unconsumed
formalBudget = 1/1 unconsumed
~~~

### 2026-08-29 — W6 lease correctness recovery 8 focused GREEN gate 1

~~~text
command = npm run test -w @surdet/cli -- node-local-lease.test.ts composition-service.test.ts review-service.test.ts
result = PASS exit 0; 3 files / 26 tests passed
contractProof = project/change heartbeat serialization and drain PASS; async cancellation drain PASS; manual-recovery release evidence PASS; canonical Composition and Review contention PASS; rejected prepareResult had no side effects PASS; Review lock order change.acquire -> project.acquire -> project.release -> change.release PASS; exactly one result review and binding PASS; both lock scopes returned free
artifact = <local-path> bytes=2637 sha256=86E44EBFAEA5EA0695BBBABC3CCDC82740B81971328A11FE9EEB88E7EFDD3AB8
diagnosticBudget = 1/1 unconsumed
formalBudget = 1/1 unconsumed
~~~

### 2026-08-29 — W6 lease correctness recovery 8 adjacent gate 2

~~~text
command = npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts agent-port-security.test.ts agent-port-review.test.ts
result = PASS exit 0; 3 files / 23 tests passed
contractProof = cross-process change CAS and project serialization PASS; live canonical project lease returns PROJECT_BUSY without commit side effects PASS; failed recovery is not automatically retried PASS; review MCP surface remains read-only for Agent receipt operations
artifact = <local-path> bytes=2317 sha256=56626997CC7CDEF39E3E73450086E0306625E0D0521A07D0AAA273DAE98B1868
cliFullTest = NOT_RUN; authorized single run remains 1/1
diagnosticBudget = 1/1 unconsumed
formalBudget = 1/1 unconsumed
~~~

### 2026-08-29 — W6 lease correctness recovery 8 CLI full gate failure

~~~text
timestamp = 2026-08-29
task = W6_LEASE_CORRECTNESS_RECOVERY_8
status = W6_LEASE_CORRECTNESS_RECOVERY_8_CLI_FULL_GATE_FAILED
gate = Task 3 step 3; single authorized CLI full test
command = npm run test -w @surdet/cli
runCount = 1/1 consumed; no rerun performed or authorized
result = FAILED exit 1; 35 files: 30 passed, 5 failed; 269 tests: 262 passed, 7 timed out
firstFailedNode = test/authoring-vertical-slice.test.ts full-suite 15000ms timeout was first reported while the run was still active; final failed-test list begins test/agent-port-composition.test.ts:98 at its 5000ms timeout
timeoutFailures = agent-port-composition.test.ts:98 5000ms; agent-port-composition.test.ts:330 5000ms; authoring-presentation-wave2.test.ts:64 30000ms; authoring-project-config-wave3.test.ts:58 15000ms; authoring-vertical-slice.test.ts:42 15000ms; composition-service.test.ts:151 5000ms; composition-service.test.ts:262 5000ms
failureChannels = timeout-only; no functional assertion failure, PROJECT_BUSY/LEASE_CORRUPT failure, parse error, runner failure, process crash, or old-dist failure was reported by this command
contractLevel = CLI_FULL_TEST_TIME_BUDGET_GATE_FAILED under full-suite parallel load
reasonableInference = focused and adjacent gates passed, while the full parallel suite pushed seven existing fixed-time-budget tests past 5/15/30 seconds; current evidence does not distinguish ambient parallel-load saturation from added lease-I/O cost, so no product root cause is claimed
artifact = <local-path> bytes=29039 sha256=E6665373B739A90E18DB53FFA84CC0F7C456145FB1B1FF6B02873C24EAB29AAA
postFailureActions = no code or test changes; no CLI full rerun; no typecheck; no build; no runner contract rerun; no diff gate; no preflight; no diagnostic; no commit; no FORMAL; no push; no cleanup of historical or current fixtures; no external Agent; no Owner acceptance; no apply; no Wave 7
diagnosticBudget = 1/1 unconsumed
formalBudget = 1/1 unconsumed
nextStop = W6_LEASE_CORRECTNESS_RECOVERY_8_CLI_FULL_GATE_FAILED; waiting for independent manager decision
~~~

### 2026-08-29 — W6 lease correctness recovery 8 stopped-state Git audit

~~~text
branch = main
head = deaf74a64024b91e46cc750822295e0f9c2ce739
surdetMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehind = 10/0
trackedDiffs = 26 paths: the preserved 24-path Wave 6 tracked baseline plus packages/cli/src/authoring/node-local-lease.ts and packages/cli/test/node-local-lease.test.ts
untracked = 968 total: 2 preserved Wave 6 runner paths plus 966 unrelated paths
staging = EMPTY
commit = NONE; CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
runnerPreservation = packages/cli/e2e/human-agent-review-wave-6.e2e.mjs bytes=88457 sha256=D82B6FC453324F2FD319AB83FDFA8BAAEB06E1DD8AC05735BEA552DF0852E1B1; packages/cli/test/human-agent-review-wave-6-runner.test.mjs bytes=22057 sha256=4D5FB5E6B71E2FE0036FDB3E7E1981F502EE076D117538D89205ED056D3ADD26
recovery8Files = node-local-lease.ts bytes=19657 sha256=21ADF08D150016B6B2AF7E2C57693C8856557825202455AE41BCDD9C6F4E1D40; node-local-lease.test.ts bytes=22881 sha256=6D38A5E8E4E9FD142E02FC133C7B8193794781B681DFA3788D17C24820CE19F0; composition-service.ts bytes=18471 sha256=75868A104D053AC2E872D98165EA342A308E02020F86D3315321D417687AB7A5; composition-service.test.ts bytes=25881 sha256=FA86A7E86E2AF50FCA6CB69497C1E48918EB25CB83AA4CF4D2A61F116C0E7428; review-service.ts bytes=32745 sha256=FF47D229627AA9A83111BA6D679F90339DC4853F5844774B82286F62D88D4F3E; review-service.test.ts bytes=21978 sha256=F5DF136618D7E2B786AF15B7BE65F978E6BB1459FB485F4886B294CF77B4180E
recovery7EvidencePreserved = evidence.json bytes=211616 sha256=A59BB08F80B1A60F1A32700144DAFD5CEB563C0D405BB5B63EF3E7F8D2E6F7C5; identity.json bytes=226 sha256=4AC083D4BD7381F09F4DCB8161C5673075C0B463BA2A523CABB73819E684DF1C; residual lease.json bytes=288 sha256=FFCFE84A432E370859BAD243EDB2AB01D79E34990A6630881EBD63159BAA791F
finalStop = W6_LEASE_CORRECTNESS_RECOVERY_8_CLI_FULL_GATE_FAILED
~~~

### 2026-08-29 — W6 lease correctness recovery 8 gate recovery 1 baseline

~~~text
timestamp = 2026-08-29
task = W6_LEASE_CORRECTNESS_RECOVERY_8_GATE_RECOVERY_1
managerDecision = APPROVED
phase = BASELINE_CONFIRMED; permanent release-evidence RED not yet added; no limited gate run
branch = main
head = deaf74a64024b91e46cc750822295e0f9c2ce739
surdetMain = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehind = 10/0
trackedDiffs = 26 authorized Wave 6 paths preserved
untracked = 968 total: 2 preserved Wave 6 runner paths plus 966 unrelated paths
staging = EMPTY
defaultParallelCliFullGate = FAILED retained
failureClass = TIMEOUT_ONLY
leaseFunctionalError = NOT_OBSERVED
parallelCapacityContention = STRONGLY_SUPPORTED
leaseExtraIoContribution = NOT_EXCLUDED
preservedParallelFailureArtifact = <local-path> bytes=29039 sha256=E6665373B739A90E18DB53FFA84CC0F7C456145FB1B1FF6B02873C24EAB29AAA
releasePreRedSource = packages/cli/src/authoring/node-local-lease.ts bytes=19657 sha256=21ADF08D150016B6B2AF7E2C57693C8856557825202455AE41BCDD9C6F4E1D40
releasePreRedTest = packages/cli/test/node-local-lease.test.ts bytes=22881 sha256=6D38A5E8E4E9FD142E02FC133C7B8193794781B681DFA3788D17C24820CE19F0
confirmedPreRedBehavior = release verifies owner, drains heartbeat and verifies owner again, then unlinks lease.json before non-recursive rmdir; an extra lock-directory occupant can therefore expose ENOTEMPTY only after lease evidence has already been deleted
serialTargetedGate = NOT_RUN; budget 1/1 available
cliSerialRecoveryGate = NOT_RUN; budget 1/1 available
recovery8Diagnostic = NOT_RUN; budget 1/1 available
formal = NOT_RUN; budget 1/1 available
push = NOT_PERFORMED
~~~

### 2026-08-29 — W6 lease correctness recovery 8 gate recovery 1 permanent RED

~~~text
timestamp = 2026-08-29
task = W6_LEASE_CORRECTNESS_RECOVERY_8_GATE_RECOVERY_1
phase = PERMANENT_RELEASE_EVIDENCE_RED_CONFIRMED; production implementation unchanged
redCommand = npm run test -w @surdet/cli -- node-local-lease.test.ts
redResult = FAILED exit 1; 1 file / 12 tests: 1 failed, 11 passed
firstFailedAssertion = packages/cli/test/node-local-lease.test.ts:238; release rejected as expected but lease.json read rejected with ENOENT instead of resolving to the original bytes
contractFailure = release deleted lease.json before non-recursive rmdir discovered the controlled sentinel and failed; lease evidence bytes/SHA were therefore not preserved
redValidity = deterministic evidence-preservation assertion; no fixture error, parse error, spelling error, timeout, sleep, retry, old dist, diagnostic, or FORMAL execution
redArtifact = <local-path> bytes=3654 sha256=A938C9D744A8E6CEB4183B76FDDFDF7A2AED3B431FF2CF1C78E9A25FB6BF0520
defaultParallelCliFullGate = FAILED retained; timeout-only artifact unchanged
serialTargetedGate = NOT_RUN; budget 1/1 available
cliSerialRecoveryGate = NOT_RUN; budget 1/1 available
recovery8Diagnostic = NOT_RUN; budget 1/1 available
formal = NOT_RUN; budget 1/1 available
~~~

### 2026-08-29 — W6 lease correctness recovery 8 gate recovery 1 focused GREEN failure

~~~text
timestamp = 2026-08-29
task = W6_LEASE_CORRECTNESS_RECOVERY_8_GATE_RECOVERY_1
status = W6_RECOVERY_8_GATE_RECOVERY_1_FOCUSED_GREEN_FAILED
implementation = after heartbeat drain and second owner verification, release reads exact lock-directory Dirents; only one regular file named lease.json permits precise unlink plus non-recursive rmdir; any read failure or extra/non-file entry fails LEASE_CORRUPT before deleting content
implementationBoundaries = no recursive rm, force, cleanup fallback, sleep, retry, timeout change, Vitest configuration change, package change, runner change, or compatibility framework
implementationSource = packages/cli/src/authoring/node-local-lease.ts bytes=20811 sha256=42BCD77DB3E0EC950504FCC2F5BF540EA249BF863830B3AAD34FC8B26406784B
permanentTestSource = packages/cli/test/node-local-lease.test.ts bytes=24168 sha256=CA3D80BA7D5446949757FB021F57E5CC04277FF26807060047C006B177760306
greenCommand = npm run test -w @surdet/cli -- node-local-lease.test.ts
greenResult = FAILED exit 1; 1 file / 12 tests: 1 failed, 11 passed
firstFailedNode = packages/cli/test/node-local-lease.test.ts:244
failureClass = TEST_EXPECTATION_SCHEMA_MISMATCH
failure = test expected inspect().holder.ownerToken, but the public LeaseInspection holder projection contains pid, hostname, acquiredAt and heartbeatAt only; received state=owned and the failure was not a lease functional error or timeout
evidencePreservationBeforeFailure = release failed loud; original lease.json bytes/SHA assertion passed; sentinel bytes/SHA assertion passed; exact lock-directory entries assertion passed; lock directory remained present; wrong-owner release preservation test passed
identifiedUnappliedCorrection = retain the state=owned/not-free assertion without requiring the non-public ownerToken field; not applied and not rerun because this gate orders immediate stop on any GREEN failure
greenFailureArtifact = <local-path> bytes=3545 sha256=7736FBB069879DD3DFEA0FD28DED4773145F686B9FA140DF1079F75D89BDBC67
defaultParallelCliFullGate = FAILED retained
defaultParallelFailureArtifact = <local-path> bytes=29039 sha256=E6665373B739A90E18DB53FFA84CC0F7C456145FB1B1FF6B02873C24EAB29AAA
postFailureActions = no source or test edits after failure; no focused rerun; no adjacent group 2 or group 3; no serial targeted gate; no serial full gate; no typecheck; no build; no runner check; no diff gate; no preflight; no diagnostic; no commit; no FORMAL; no push; no cleanup; no external Agent; no Owner acceptance; no apply; no Wave 7
gitState = branch main; HEAD deaf74a64024b91e46cc750822295e0f9c2ce739; tracked diffs 26; staging EMPTY; untracked 968 preserved
serialTargetedGate = NOT_RUN; budget 1/1 unconsumed
cliSerialRecoveryGate = NOT_RUN; budget 1/1 unconsumed
recovery8Diagnostic = NOT_RUN; budget 1/1 unconsumed
formal = NOT_RUN; budget 1/1 unconsumed
commit = NONE; CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
push = NOT_PERFORMED
nextStop = W6_RECOVERY_8_GATE_RECOVERY_1_FOCUSED_GREEN_FAILED; waiting for new manager authorization
~~~

### 2026-08-29 — W6 Recovery-8 gate recovery 1 test projection correction baseline

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_GATE_RECOVERY_1_TEST_PROJECTION_CORRECTION
managerDecision = APPROVED
phase = TEST_PROJECTION_CORRECTED; replacement GREEN not yet run
allowedFiles = packages/cli/test/node-local-lease.test.ts; this Wave 6 Execution Ledger
productionSource = packages/cli/src/authoring/node-local-lease.ts bytes=20811 sha256=42BCD77DB3E0EC950504FCC2F5BF540EA249BF863830B3AAD34FC8B26406784B; read-only and unchanged
preCorrectionTest = packages/cli/test/node-local-lease.test.ts bytes=24168 sha256=CA3D80BA7D5446949757FB021F57E5CC04277FF26807060047C006B177760306
correction = removed the non-public inspect().holder.ownerToken expectation; retained exact state=owned proof and added direct parsing of preserved lease.json bytes to prove the internal ownerToken still equals handle.ownerToken
publicOwnerTokenExposure = NO; no public type, holder projection, MCP output, production source, runner, timeout, Vitest configuration, or package metadata changed
replacementGreen = NOT_RUN; budget 1/1 available
defaultParallelCliFullGate = FAILED retained
serialTargetedGate = NOT_RUN; budget 1/1 unconsumed
cliSerialRecoveryGate = NOT_RUN; budget 1/1 unconsumed
recovery8Diagnostic = NOT_RUN; budget 1/1 unconsumed
formal = NOT_RUN; budget 1/1 unconsumed
~~~

### 2026-08-29 — W6 Recovery-8 gate recovery 1 replacement GREEN

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_GATE_RECOVERY_1_TEST_PROJECTION_CORRECTION
replacementGreenCommand = npm run test -w @surdet/cli -- node-local-lease.test.ts
replacementGreenRunCount = 1/1 consumed; no rerun performed
replacementGreenResult = PASS exit 0; 1 file / 12 tests passed
leaseEvidencePreservationGreen = PASS
publicOwnerTokenExposure = NO
internalOwnerIdentityPreservedByDiskBytes = YES
contractProof = release returns LEASE_CORRUPT/manual-recovery before deleting any entry when the lock directory contains a sentinel; inspect state remains owned; lease.json bytes/SHA and sentinel bytes/SHA remain unchanged; parsed retained lease.json ownerToken equals handle.ownerToken; wrong-owner release preserves the real owner lease
correctedTest = packages/cli/test/node-local-lease.test.ts bytes=24205 sha256=E6024B1A87C7323ABCCE3522556A6D6480263C166AE5BE48677E907F125E7EBB
productionSource = packages/cli/src/authoring/node-local-lease.ts bytes=20811 sha256=42BCD77DB3E0EC950504FCC2F5BF540EA249BF863830B3AAD34FC8B26406784B; unchanged during test projection correction
artifact = <local-path> bytes=518 sha256=5A5A2F004D0F63C5F312CD9FFE0E4319F1D093A9E162DAEE33EDCDDA853523D7
defaultParallelCliFullGate = FAILED retained
nextGate = focused three-file GREEN
~~~

### 2026-08-29 — W6 Recovery-8 gate recovery 1 focused and adjacent GREEN

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_GATE_RECOVERY_1_TEST_PROJECTION_CORRECTION
focusedCommand = npm run test -w @surdet/cli -- node-local-lease.test.ts composition-service.test.ts review-service.test.ts
focusedResult = PASS exit 0; 3 files / 26 tests passed
focusedArtifact = <local-path> bytes=1880 sha256=618DC3A53867E4C94B03C7EA5BA143999B6DEE5E6D41EA502ED000AE60DE31B5
adjacentCommand = npm run test -w @surdet/cli -- multi-process-change-concurrency.test.ts agent-port-security.test.ts agent-port-review.test.ts
adjacentResult = PASS exit 0; 3 files / 23 tests passed
adjacentArtifact = <local-path> bytes=2333 sha256=5DB625559939510BE1BEF6F263138854FE55D66F19F620B2D4FE16A64F632DCF
defaultParallelCliFullGate = FAILED retained
serialTargetedGate = NOT_RUN; budget 1/1 available
cliSerialRecoveryGate = NOT_RUN; budget 1/1 available
recovery8Diagnostic = NOT_RUN; budget 1/1 available
formal = NOT_RUN; budget 1/1 available
nextGate = unique serial five-file differentiation
~~~

### 2026-08-29 — W6 Recovery-8 serial five-file differentiation

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_GATE_RECOVERY_1_TEST_PROJECTION_CORRECTION
command = npm run test -w @surdet/cli -- --no-file-parallelism --maxWorkers=1 --minWorkers=1 test/agent-port-composition.test.ts test/composition-service.test.ts test/authoring-vertical-slice.test.ts test/authoring-project-config-wave3.test.ts test/authoring-presentation-wave2.test.ts
runCount = 1/1 consumed; no rerun performed
result = PASS exit 0; 5 files / 28 tests passed
timeouts = original 5/15/30 second test timeouts unchanged
parallelCapacityContention = CONFIRMED_FOR_FAILED_FILES
serialTargetedGate = PASSED
defaultParallelFullGateRemainsFailed = YES
artifact = <local-path> bytes=4128 sha256=6612E25736804B5F5B4FF3FE6AB067C17394C79C2ACE254A75FB2406985D56EA
evidenceNote = test command completed exit 0 and wrote the complete artifact; the orchestration wrapper emitted a post-command session-marker serialization notice, so the test was not rerun
cliSerialRecoveryGate = NOT_RUN; budget 1/1 available
recovery8Diagnostic = NOT_RUN; budget 1/1 available
formal = NOT_RUN; budget 1/1 available
nextGate = unique serial CLI full recovery gate
~~~

### 2026-08-29 — W6 Recovery-8 serial CLI full recovery gate failure

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_GATE_RECOVERY_1_TEST_PROJECTION_CORRECTION
status = W6_RECOVERY_8_CLI_SERIAL_RECOVERY_GATE_FAILED
command = npm run test -w @surdet/cli -- --no-file-parallelism --maxWorkers=1 --minWorkers=1
runCount = 1/1 consumed; no rerun performed or authorized
result = FAILED exit 1; 35 files: 34 passed, 1 failed; 269 tests: 268 passed, 1 timed out
firstFailedNode = packages/cli/test/agent-port-composition.test.ts:330; integration capsule provenance preserves full provenance for a READY integration capsule across A/B/C/D candidates
failure = original 5000ms timeout exceeded; reported test duration 5126ms
failureChannels = TIMEOUT_ONLY; no lease error, PROJECT_BUSY, LEASE_CORRUPT, functional assertion failure, parse failure, runner failure, or process crash reported
targetedComparison = the same provenance test passed in the unique serial five-file differentiation in 2967ms; the serial full-suite order later exceeded the same unchanged 5000ms timeout
parallelCapacityContention = CONFIRMED_FOR_FAILED_FILES by the targeted serial gate, but NOT_SUFFICIENT_TO_EXPLAIN the later serial full-suite timeout
rootCause = UNVERIFIED; cumulative suite-order/resource pressure and lease extra I/O contribution remain unseparated
cliSerialFullGate = FAILED
defaultParallelCliFullGate = FAILED_RETAINED
defaultParallelFailureArtifact = <local-path> bytes=29039 sha256=E6665373B739A90E18DB53FFA84CC0F7C456145FB1B1FF6B02873C24EAB29AAA
serialFullFailureArtifact = <local-path> bytes=18063 sha256=123FAFC59F9EF26A930FDE10F96E12C6B060B44BCD53BAB7B476833C31E65157
productionSource = packages/cli/src/authoring/node-local-lease.ts bytes=20811 sha256=42BCD77DB3E0EC950504FCC2F5BF540EA249BF863830B3AAD34FC8B26406784B; unchanged during projection correction and all gates
correctedTest = packages/cli/test/node-local-lease.test.ts bytes=24205 sha256=E6024B1A87C7323ABCCE3522556A6D6480263C166AE5BE48677E907F125E7EBB
postFailureActions = no timeout/config/package/test/production changes; no rerun; no typecheck; no build; no runner contract; no node check; no diff gate; no preflight; no diagnostic; no commit; no FORMAL; no push; no cleanup; no external Agent; no Owner acceptance; no apply; no Wave 7
gitState = branch main; HEAD deaf74a64024b91e46cc750822295e0f9c2ce739; surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead/behind 10/0; tracked diffs 26; staging EMPTY; untracked 968 preserved
recovery8Diagnostic = NOT_RUN; budget 1/1 unconsumed
formal = NOT_RUN; budget 1/1 unconsumed
commit = NONE; CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
push = NOT_PERFORMED
nextStop = W6_RECOVERY_8_CLI_SERIAL_RECOVERY_GATE_FAILED; waiting for new manager authorization
~~~

### 2026-08-29 — W6 Recovery-8 integration timeout contract recovery 2 baseline

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_INTEGRATION_TIMEOUT_CONTRACT_RECOVERY_2
managerDecision = APPROVED
theme = test-only integration harness timeout contract; not a production repair and not an old-budget reset
allowedFiles = packages/cli/test/agent-port-composition.test.ts; this Wave 6 Execution Ledger
oldBudgets = replacement GREEN 1/1 CONSUMED; focused three-file COMPLETED; adjacent COMPLETED; serial targeted five-file 1/1 CONSUMED; original serial CLI full recovery gate 1/1 CONSUMED_AND_FAILED
newBudgets = TIMEOUT_CONTRACT_EDIT 1; AGENT_PORT_COMPOSITION_FOCUSED_GREEN 1/1; POST_CONTRACT_SERIAL_CLI_FULL_GATE 1/1
preEditTest = packages/cli/test/agent-port-composition.test.ts bytes=29693 sha256=8DE63E759BE519AB8771014035918A6EF0D24810B462F41B146F553710CF4146
contractEdit = only the READY integration provenance test receives timeout=15000; its body and functional assertions remain unchanged; comment now states that four candidates are sealed serially through in-process AgentPortSession and that validate/simulate/runtime/diff/capsule disk evidence make 15 seconds a vertical-integration harness budget, not a product performance qualification line
commentCorrection = the separate selection-contract comment no longer claims multiple CLI subprocesses; it identifies in-process AgentPortSession usage
forbiddenChanges = no production source, other timeout, public type, Vitest config, global testTimeout, package.json, runner, or dependency change
focusedGreen = NOT_RUN; new budget 1/1 available
postContractSerialCliFullGate = NOT_RUN; new budget 1/1 available
defaultParallelCliFullGate = FAILED_RETAINED
originalSerialCliFullGate = FAILED_RETAINED
recovery8Diagnostic = NOT_RUN; budget 1/1 unconsumed
formal = NOT_RUN; budget 1/1 unconsumed
~~~

### 2026-08-29 — W6 Recovery-8 integration timeout focused GREEN

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_INTEGRATION_TIMEOUT_CONTRACT_RECOVERY_2
command = npm run test -w @surdet/cli -- agent-port-composition.test.ts
runCount = 1/1 NEW consumed; no rerun performed
result = PASS exit 0; 1 file / 8 tests passed
targetTest = READY integration provenance PASS in 2944ms under the explicit 15000ms vertical-integration harness budget
functionalAssertions = unchanged and all passed
testFile = packages/cli/test/agent-port-composition.test.ts bytes=29968 sha256=C7923C26CD5F331B456F03C9AAD8E3C4311EC4FD8DE16B7BED3EC40A090D2538
artifact = <local-path> bytes=1158 sha256=582E39B249B7097549D903EE9D485DD05D7307D09251D94CA5EDE20EDC4A95FF
defaultParallelCliFullGate = FAILED_RETAINED
originalSerialCliFullGate = FAILED_RETAINED
postContractSerialCliFullGate = NOT_RUN; new budget 1/1 available
recovery8Diagnostic = NOT_RUN; budget 1/1 unconsumed
formal = NOT_RUN; budget 1/1 unconsumed
nextGate = unique post-contract serial CLI full gate
~~~

### 2026-08-29 — W6 Recovery-8 post-contract serial CLI full gate

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_INTEGRATION_TIMEOUT_CONTRACT_RECOVERY_2
command = npm run test -w @surdet/cli -- --no-file-parallelism --maxWorkers=1 --minWorkers=1
runCount = 1/1 NEW consumed; no rerun performed
result = PASS exit 0; 35 files / 269 tests passed
targetTest = READY integration provenance PASS in 2938ms under explicit timeout=15000
defaultParallelCliFullGate = FAILED_RETAINED
originalSerialCliFullGate = FAILED_RETAINED
postContractSerialCliFullGate = PASSED
artifact = <local-path> bytes=14527 sha256=7DCDD3CBE84D22B2B89076AE75F1370FC79CF474F35A330F945DFF77D5D0DA87
oldParallelArtifact = <local-path> bytes=29039 sha256=E6665373B739A90E18DB53FFA84CC0F7C456145FB1B1FF6B02873C24EAB29AAA
oldSerialArtifact = <local-path> bytes=18063 sha256=123FAFC59F9EF26A930FDE10F96E12C6B060B44BCD53BAB7B476833C31E65157
recovery8Diagnostic = NOT_RUN; budget 1/1 unconsumed
formal = NOT_RUN; budget 1/1 unconsumed
nextGate = CLI typecheck then CLI build
~~~

### 2026-08-29 — W6 Recovery-8 post-contract static and build gates

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_INTEGRATION_TIMEOUT_CONTRACT_RECOVERY_2
cliTypecheck = PASS exit 0; artifact <local-path> bytes=68 sha256=AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917
cliBuild = PASS exit 0; artifact <local-path> bytes=61 sha256=898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E
runnerContract = PASS exit 0; 18/18 tests; artifact <local-path> bytes=1934 sha256=DE35BF3D5EBD0E3D5129359A044862E405F82D675DE09F3222DA0ADF4D378E90
runnerNodeCheck = PASS exit 0; node --check produced no stdout; empty evidence file materialized without rerunning at <local-path> bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
worktreeDiffCheck = PASS exit 0; CRLF conversion warnings only; artifact <local-path> bytes=3598 sha256=06EAEBE0371D2BA98C5F22C35B2A33A7AD47030B1AABC568C916ACCED961E9D4
stagedDiffCheck = PASS exit 0; staging empty; artifact <local-path> bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
verifyAll = NOT_RUN
preflight = NOT_RUN; existing authorization unconsumed
recovery8Diagnostic = NOT_RUN; budget 1/1 unconsumed
formal = NOT_RUN; budget 1/1 unconsumed
nextGate = Wave 6 preflight
~~~

### 2026-08-29 — W6 Recovery-8 preflight

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_INTEGRATION_TIMEOUT_CONTRACT_RECOVERY_2
command = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=preflight
result = PASSED exit 0; launcher-preflight PASSED
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = d82b6fc453324f2fd319ab83fdfa8baaeb06e1dd8ac05735bea552df0852e1b1
trackedCodeDiffPaths = 26
protocol = modern and legacy negotiation PASS; 30 capabilities; stage policy toolCount=30; stdoutPure=true
editorBuildEntries = index and preview present
errorChannels = errors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0
projectMutation = FALSE; stageProjectMutated=FALSE
originalStarterUnchanged = TRUE
commandArtifact = <local-path> bytes=2762 sha256=6F31901BE1421B2725EC95A4A79A6D2B3CFCA79F1AE41B903A35DDD60F18A4AA
preflightEvidence = <local-path> bytes=2701 sha256=AE72C423D24895073EEFA299023A4D6085A7B76A7FD368C353D0CB8DE01C7BC9
preflightIdentity = <local-path> bytes=223 sha256=5D49D9960DC9D026C3FC6A2DA3EAAF14B0E062BF315BE37871B488E9E97567C1
recovery8Diagnostic = NOT_RUN; budget 1/1 unconsumed
formal = NOT_RUN; budget 1/1 unconsumed
nextGate = unique Recovery-8 diagnostic 1/1
~~~

### 2026-08-29 — W6 Recovery-8 integration timeout recovery diagnostic failure

~~~text
timestamp = 2026-08-29
task = W6_RECOVERY_8_INTEGRATION_TIMEOUT_CONTRACT_RECOVERY_2
status = W6_LEASE_CORRECTNESS_RECOVERY_8_DIAGNOSTIC_FAILED
command = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=diagnostic
runCount = 1/1 consumed; no rerun performed or authorized
result = FAILED exit 1; 16 milestones PASSED / 1 FAILED; fixed 22-milestone workflow did not complete
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = d82b6fc453324f2fd319ab83fdfa8baaeb06e1dd8ac05735bea552df0852e1b1
lastPassedNode = approval-required-error
firstFailedNode = editor-result-rendered
firstFailure = frame.waitForFunction timed out after 30000ms at packages/cli/e2e/human-agent-review-wave-6.e2e.mjs:1075 during runEditorResult
browserFailureEvidence = captured; globalStatus=校验通过（9 条警告）; result receipt marker absent; iframeUrl=http://127.0.0.1:12175/preview.html; previewError=null; rendererStatus=awaiting; projection dialogueText=Alpha route A.; speakerText=「lynn」; panelVisible=true; previewTraceMessages=4
errorChannels = errors=1; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0; blockingIssueChannels=errors
recursiveLeaseReadback = zero *.lock directories under the diagnostic root
projectMutation = FALSE; stageProjectMutated=FALSE; applyProjectMutated=FALSE
originalStarterFinalIdentity = UNVERIFIED because the workflow stopped before the final identity milestone; preflight had proved originalStarterUnchanged=true
diagnosticEvidence = <local-path> bytes=250725 sha256=07822A0D10AE3F4616492E47334239B748A0A2E2CB8BB79285E47B6D7B3051AC
diagnosticIdentity = <local-path> bytes=226 sha256=47A293B953A572AF9B2FAF113EB679B9A48AFED2AE743E60BE90B6722476681C
diagnosticCommandLog = <local-path> bytes=198564 sha256=A4812376678087E3AFC79F01386718106EB21EA335D3976BD695C10351CAC861
postFailureActions = no code or test changes; no diagnostic rerun; no staging; no commit; no CODE_EVIDENCE_HEAD; no FORMAL; no push; no cleanup; no external Agent; no Owner acceptance; no apply; no Wave 7
formal = NOT_RUN; budget 1/1 remains unconsumed
commit = NONE; CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
push = NOT_PERFORMED
nextStop = W6_LEASE_CORRECTNESS_RECOVERY_8_DIAGNOSTIC_FAILED; waiting for new manager authorization
~~~

### 2026-08-30 — W6 Recovery-9 speaker identity and preview trace Task 0 baseline

~~~text
timestamp = 2026-08-30
task = W6_SPEAKER_ID_AND_PREVIEW_TRACE_RECOVERY_9
managerDecision = APPROVED
theme = precise cross-layer speaker identity and preview trace evidence recovery; not a general refactor or an old-budget reset
gitBaseline = branch main; HEAD deaf74a64024b91e46cc750822295e0f9c2ce739; surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead/behind 10/0; tracked diffs 26; staging EMPTY; untracked 968 preserved
recovery8DiagnosticEvidence = <local-path> bytes=250725 sha256=07822A0D10AE3F4616492E47334239B748A0A2E2CB8BB79285E47B6D7B3051AC
recovery8DiagnosticIdentity = <local-path> bytes=226 sha256=47A293B953A572AF9B2FAF113EB679B9A48AFED2AE743E60BE90B6722476681C
recovery8RunIdentity = runHead deaf74a64024b91e46cc750822295e0f9c2ce739; runnerSha256 d82b6fc453324f2fd319ab83fdfa8baaeb06e1dd8ac05735bea552df0852e1b1
taskbookPreAppendIdentity = bytes=213694 sha256=BA275064A53E430DC84B91D32EB314B361CCB53EB7903A66FC039F576C55D86E
recovery8Milestones = 16 PASSED / 1 FAILED; lastPassedNode approval-required-error; firstFailedNode editor-result-rendered
recovery8Correction = rendererStatus=awaiting is a satisfied normal post-line state, not a stuck Renderer; the direct unmet composite predicate was projection.dialogue.activeSpeakerId=null instead of lynn
recovery8ObservedProjection = dialogueText "Alpha route A."; speakerText "「lynn」"; panelVisible=true; activeSpeakerId=null; excluded "Alpha route C." absent
recovery8ObservedTrace = sceneId wave5_alpha; same trace carried Core event kind=instruction with source.op=text; coreEmitted=true; presentationApplied=false because the captured world presentation omitted ADV semantic dialogue state
rendererLookup = setSpeakerProfiles indexes only profile.name and showText resolves only that map; legal speaker token lynn therefore remains visible as "「lynn」" but has no activeSpeakerId
authoringContract = buildSpeakerCharacterRefs resolves stable character ID first, then only an unambiguous display name; an ID wins over a colliding display name
coreTraceContract = RuntimeTraceEventPayload kind is instruction for a text operation, with source.op=text; kind=text is not a Core runtime trace event
editorEvidenceContract = captureRuntimeTrace currently compares only queries.presentation.snapshot before/after, so ADV dialogue changes in diagnostics.projectionSnapshot are absent and presentationApplied remains false
runnerLatentDefects = text trace predicate still requires event.kind=text; editor result wait correctly requires rendererStatus=awaiting but cannot pass until stable speaker ID resolves
budgets = Recovery-9 preflight 1/1 unconsumed; Recovery-9 diagnostic 1/1 unconsumed
forbidden = no timeout increase; no fixture token change; no old gate rerun; no FORMAL; no push; no apply; no external Agent; no Owner acceptance; no Wave 7
nextGate = Renderer permanent focused RED
~~~

### 2026-08-30 — W6 Recovery-9 Renderer speaker contract RED

~~~text
timestamp = 2026-08-30
task = W6_SPEAKER_ID_AND_PREVIEW_TRACE_RECOVERY_9
command = npm run test -w @surdet/renderer -- dialogue-layer.test.ts
result = EXPECTED RED exit 1; 2 files: 1 passed, 1 failed; 24 tests: 23 passed, 1 failed
failedContract = resolves dialogue speakers by stable ID first or by an unambiguous display name
observed = showText('lynn') produced activeSpeakerId=null and speakerText="「lynn」"
required = showText('lynn') must resolve activeSpeakerId=lynn and localized speakerText="「凛」"
failureClass = permanent contract assertion; no fixture, compile, spelling, or timeout failure
artifact = <local-path> bytes=3941 sha256=A64B2ED5CFD02EDF02CF3C593C3E40959BEEE3ADABC00A79B950080166706B37
nextGate = minimal Renderer implementation, then focused GREEN
~~~

### 2026-08-30 — W6 Recovery-9 Renderer speaker contract GREEN and gates

~~~text
timestamp = 2026-08-30
task = W6_SPEAKER_ID_AND_PREVIEW_TRACE_RECOVERY_9
implementation = DialogueLayer speaker lookup now recognizes its stable ID namespace first and adds only unambiguous display-name aliases; resolved tokens render the profile display name; unresolved tokens remain unresolved
contract = stable ID lynn and unique name 凛 both resolve activeSpeakerId=lynn and speakerText="「凛」"; unknown and duplicate display names do not bind; an ID wins over another profile's colliding display name
focusedGreen = PASS exit 0; 2 files / 24 tests; artifact <local-path> bytes=442 sha256=EDEFB2EF8334CF80DCE22CF74FDBFF1EB5AC2D7A1CE6FB2733F2CDC34F9C71DE
rendererFullTest = PASS exit 0; 50 files / 413 tests; artifact <local-path> bytes=3592 sha256=4DB0C8AD8E8A6DA07D72EC90ADC3AF561D7E4C03790A0FB2B32288A8C596EA6A
rendererTypecheck = PASS exit 0; artifact <local-path> bytes=73 sha256=0887975148C79BDE3ABFE26F60A0B98452D61E1A207B702149A2F54B307DCE3B
rendererBuild = PASS exit 0; artifact <local-path> bytes=66 sha256=A38A62DF3F9F3E95D3C5EAB05B5B5E53DB3995920B214A062C732A49F9629B91
forbiddenChanges = no fixture token, timeout, Authoring, Core, Host, Shell, Starter, Zero, dependency, package, or lockfile change
nextGate = Editor preview trace evidence permanent focused RED
~~~

### 2026-08-30 — W6 Recovery-9 Editor preview trace evidence RED/GREEN and gates

~~~text
timestamp = 2026-08-30
task = W6_SPEAKER_ID_AND_PREVIEW_TRACE_RECOVERY_9
redCommand = npm run test -w surdet-editor -- preview-causal-trace.test.ts
redResult = EXPECTED RED exit 1; the permanent test could not import preview-trace-evidence because the independently executable combined snapshot helper did not yet exist; no product fixture, timeout, or browser workflow was involved
redArtifact = <local-path> bytes=1603 sha256=46602426E06DA372EC3BE0792485E0C210DBF454F58B1223D604C7DBBFA30F53
implementation = each Core trace event snapshots both queries.presentation.snapshot() and queries.diagnostics.projectionSnapshot() through a pure helper; before/after comparison uses that combined evidence and does not create a second Renderer state machine
permanentBehavior = unchanged world/stage plus changed ADV dialogue/speaker/panel is observable and yields presentationApplied=true; identical combined evidence yields false; existing world presentation remains present in both snapshots
focusedGreen = PASS exit 0; 1 file / 3 tests; artifact <local-path> bytes=379 sha256=4BE253812F0F227FC075E6520345D164A379067E94831600EB46E75177096740
editorFullTest = PASS exit 0; 32 files / 212 tests; artifact <local-path> bytes=1857 sha256=C0D2CB54BB7D487981CD7CAC4C85B83EA16235F821169113B48A60C0BB11F1C4
editorTypecheck = PASS exit 0; artifact <local-path> bytes=70 sha256=6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3
editorBuild = PASS exit 0; 892 modules transformed; artifact <local-path> bytes=1998 sha256=CCB2585408CCFF73EB0AB58C2DA0585DB35D495250CA39F53182008209D0077B
nextGate = runner executable strict preview evidence predicate RED, then minimal runner correction
~~~

### 2026-08-30 — W6 Recovery-9 runner preview evidence RED

~~~text
timestamp = 2026-08-30
task = W6_SPEAKER_ID_AND_PREVIEW_TRACE_RECOVERY_9
command = node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs
result = EXPECTED RED exit 1; 18 tests: 17 passed, 1 failed
failedContract = strict callable reviewed-preview evidence predicate is absent; actual typeof undefined, required function
permanentCoverage = positive awaiting/Alpha-A/lynn/「凛」/panel/canvas/same-trace/same-scene/instruction-op-text/coreEmitted/presentationApplied/projectionAfter case plus negative mutations for every required dimension
artifact = <local-path> bytes=3002 sha256=108709305F8422F6964CDEBD2BFAA22EEE09452C17CA4EB49FEF4E2DCEFC1BED
nextGate = minimal runner event-kind, projection evidence, and strict predicate correction
~~~

### 2026-08-30 — W6 Recovery-9 runner GREEN and static gates

~~~text
timestamp = 2026-08-30
task = W6_SPEAKER_ID_AND_PREVIEW_TRACE_RECOVERY_9
implementation = runner waits for rendererStatus=awaiting plus Alpha A, activeSpeakerId=lynn, localized speakerText=「凛」, visible panel, and no Alpha C; Core text trace is selected as kind=instruction with source.op=text
strictEvidence = exported pure isReviewedPreviewEvidenceSatisfied requires a positive canvas, same traceId and sceneId, Core instruction/op=text, coreEmitted=true, presentationApplied=true, and projectionAfter dialogue Alpha A with activeSpeakerId=lynn
runnerContract = PASS exit 0; 18/18 tests including all required negative mutations; artifact <local-path> bytes=1957 sha256=A544ED8D6831D58693D76BA6DC23DF686FFA86A86818188F9698900DD7A05165
runnerNodeCheck = PASS exit 0; command emitted no output; evidence wrapper then failed only while reading the absent empty log, so the successful check was not rerun and a 0-byte artifact was materialized at <local-path> bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
worktreeDiffCheck = PASS exit 0; CRLF conversion warnings only; artifact <local-path> bytes=4160 sha256=2CE70B9DD7E23006D3FFE2D2E03BBB99AD3657F0B1D6663A3D75E77E8DB1F52A
stagedDiffCheck = PASS exit 0; staging empty; artifact <local-path> bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
timeouts = unchanged; no idle wait introduced; no timeout expansion
oldGates = no CLI full gate or verify:all rerun
nextGate = exact Recovery-9 scope audit, then unique preflight 1/1
~~~

### 2026-08-30 — W6 Recovery-9 preflight scope audit

~~~text
timestamp = 2026-08-30
task = W6_SPEAKER_ID_AND_PREVIEW_TRACE_RECOVERY_9
trackedState = 30 modified tracked paths; exactly the prior 26-path baseline plus packages/editor/src/preview.ts, packages/editor/test/preview-causal-trace.test.ts, packages/renderer/src/layers/dialogue/dialogue-layer.ts, packages/renderer/test/legacy/dialogue-layer.test.ts
staging = EMPTY
untrackedState = 969 paths preserved; Recovery-9 scope contains the pre-existing Wave-6 runner and runner test plus the newly authorized optional pure helper packages/editor/src/preview-trace-evidence.ts; all other untracked paths remain untouched
rendererSource = bytes=50649 sha256=6E31F8322A07948724DB45AAD5CA6CAEB079EC42CD8A38F142CC791F05464741
rendererTest = bytes=29571 sha256=C7B92A934BEC37EF2F1DED383BF51EE27C49EBF3A3DCC356D7D42F21F0E9DDCE
editorPreview = bytes=44589 sha256=E6398AB7A06D682DCB209F55DEAAF022D36E3B32AF4A2C8C335EC60DE3EF73F4
editorTraceTest = bytes=3685 sha256=4C6524F6A8584F4F6FE4FE47BFBB3BABBBEFFA8BB3CEC2F66C065CD397E5FF21
editorTraceHelper = bytes=680 sha256=476940C6ED016476744DE606867FBA66107D92BBF11302E6D49726A54767E616
runner = bytes=90626 sha256=11AA5DCDA4973F7315D3B5FD8B2A5372856AD6911CBB459E6E98DBFF67CA4A40
runnerTest = bytes=24664 sha256=0834E884644C420DCAC7A6DBEB37D89FCD21204418C5758DCDDD5BEBC6615E72
taskbookPreAppend = bytes=224878 sha256=46D6A3BA3DDD771DFC945697465DB0847892C8A5D53F21B87760E7DBDF8EE7CD
untrackedTrailingWhitespace = NONE in runner, runner test, and preview trace helper
scopeDecision = PASS; no unauthorized path introduced or modified; no file removed to manufacture a path count
nextGate = unique Recovery-9 preflight 1/1
~~~

### 2026-08-30 — W6 Recovery-9 unique preflight

~~~text
timestamp = 2026-08-30
task = W6_SPEAKER_ID_AND_PREVIEW_TRACE_RECOVERY_9
command = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=preflight
runCount = 1/1 consumed; no rerun performed
result = PASSED exit 0; launcher-preflight PASSED
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = 11aa5dcda4973f7315d3b5fd8b2a5372856ad6911cbb459e6e98dbff67ca4a40
trackedCodeDiffPaths = 30
protocol = modern and legacy negotiation PASS; 30 capabilities; stage policy toolCount=30; stdoutPure=true
editorBuildEntries = index and preview present
errorChannels = errors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0
projectMutation = FALSE; stageProjectMutated=FALSE
originalStarterUnchanged = TRUE
commandArtifact = <local-path> bytes=2960 sha256=813D51F5C7573DAC53F2B03498E84FFEF918FDA93C630AEB0B0B0F4E440D879B
preflightEvidence = <local-path> bytes=2919 sha256=D28A7935C84E2588D1A09ADE626DC6A9C8939C281ACBFB792515FD4C60DF036B
preflightIdentity = <local-path> bytes=223 sha256=D87388D6C4493365C93325E8A5D15D059643B60F9580CA114309685090FAB956
recovery9Diagnostic = NOT_RUN; new budget 1/1 available
formal = NOT_AUTHORIZED and NOT_RUN
nextGate = unique Recovery-9 diagnostic 1/1
~~~

### 2026-08-30 — W6 Recovery-9 unique diagnostic failure

~~~text
timestamp = 2026-08-30
task = W6_SPEAKER_ID_AND_PREVIEW_TRACE_RECOVERY_9
status = W6_SPEAKER_ID_AND_PREVIEW_TRACE_RECOVERY_9_DIAGNOSTIC_FAILED
command = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=diagnostic
runCount = 1/1 consumed; no rerun performed or authorized
result = FAILED exit 1; 16 milestones PASSED / 1 FAILED; fixed 22-milestone workflow did not complete
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = 11aa5dcda4973f7315d3b5fd8b2a5372856ad6911cbb459e6e98dbff67ca4a40
lastPassedNode = approval-required-error
firstFailedNode = editor-result-rendered
firstFailure = locator.waitFor timed out after 30000ms at packages/cli/e2e/human-agent-review-wave-6.e2e.mjs:1139 while waiting for #review-preview-host #preview-view to be visible
recovery9ContractObserved = rendererStatus=awaiting; final projection dialogueText="Alpha route A."; activeSpeakerId=lynn; speakerText="「凛」"; panelVisible=true; Alpha C absent; canvasBox x=546.5 y=4262.59375 width=267 height=150
coreTraceObserved = traceId preview-1788020511299-d168305e-b114-4e5c-b2ed-99aace3ca4e6; sceneId wave5_alpha; text event sequence=2 kind=instruction source.op=text source.sceneId=wave5_alpha; coreEmitted=true; presentationApplied=true
traceProjectionAfter = text event combined projectionAfter has activeSpeakerId=lynn, speakerText="「凛」", panelVisible=true, but dialogText=""; therefore the required projectionAfter Alpha-A assertion was not reached or proven before the locator failure
browserFailureEvidence = captured; globalStatus="校验通过（9 条警告）"; iframeUrl=http://127.0.0.1:11303/preview.html; previewError=null; debugExists=true; previewTraceMessages=4
errorChannels = errors=1; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0; blockingIssueChannels=errors
projectMutation = FALSE; stageProjectMutated=FALSE; applyProjectMutated=FALSE
originalStarterFinalIdentity = UNVERIFIED because the diagnostic stopped before cleanup-and-identity; the immediately preceding unique preflight proved originalStarterUnchanged=true
diagnosticEvidence = <local-path> bytes=275575 sha256=B9C1A74CAAB6984DE7FB29E83CBDC676CC89CD7E3EA22DC965EBB70D6F2AAF50
diagnosticIdentity = <local-path> bytes=226 sha256=4D3FB0DA45E13C80E0CB83E232B290782201B597C320573252F7759EDE37D598
diagnosticCommandLog = <local-path> bytes=208872 sha256=78E26C5C7DD2C3A3D4C65837E2FE6D5C856AFB3B32322BB031C5278310685F77
taskbookPreFailureAppend = bytes=228205 sha256=33234CC077FBCC91D321C35119825348DC9264F7F734F7D9B0B41C61C0FF6755
gitStateBeforeFailureAppend = branch main; HEAD deaf74a64024b91e46cc750822295e0f9c2ce739; surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead/behind 10/0; tracked diffs 30; staging EMPTY; untracked 969 preserved
postFailureActions = Ledger append only; no code/test change; no diagnostic rerun; no staging; no commit; no CODE_EVIDENCE_HEAD; no FORMAL; no push; no apply; no external Agent; no Owner acceptance; no Wave 7
nextStop = waiting for independent manager review and a new explicit recovery authorization
~~~

### 2026-08-30 — W6 Recovery-10 Runner DOM and typewriter evidence Task 0, RED/GREEN, and focused gates

~~~text
timestamp = 2026-08-30
task = W6_RUNNER_DOM_AND_TYPEWRITER_EVIDENCE_RECOVERY_10
managerDecision = APPROVED
theme = Runner evidence contract closure only; no Renderer, Editor, Core, Authoring, or CLI product repair
gitBaseline = branch main; HEAD deaf74a64024b91e46cc750822295e0f9c2ce739; surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead/behind 10/0; tracked diffs 30; staging EMPTY; untracked 969 preserved
recovery9DiagnosticEvidence = <local-path> bytes=275575 sha256=B9C1A74CAAB6984DE7FB29E83CBDC676CC89CD7E3EA22DC965EBB70D6F2AAF50
recovery9DiagnosticIdentity = <local-path> bytes=226 sha256=4D3FB0DA45E13C80E0CB83E232B290782201B597C320573252F7759EDE37D598
recovery9RunIdentity = runHead deaf74a64024b91e46cc750822295e0f9c2ce739; runnerSha256 11aa5dcda4973f7315d3b5fd8b2a5372856ad6911cbb459e6e98dbff67ca4a40
task0Milestone18 = exploration-invalidates-approval uses the real buttons 批准这个计划 and 检查探索修改, writes result/project/content/scenario/exploration.gal, waits for the exact exploration warning, and verifies approval disabled; existing review-panel test covers disable and formal reload
task0Milestone19 = fresh-approval-inspected reloads through 重新加载正式结果, waits for the old workbench to disconnect and the exact status, then verifies final-approval.json reviewerChannel/approvalFingerprint and reads the same approvalId through review.inspect-approval
task0Milestone19Schema = review.inspect-approval is a strict additionalProperties=false object with only resultReviewId and optional approvalId; minimum policy observe; existing registry/output-contract, review-service, and Agent Port review tests cover the projection and fail-loud boundary
task0Milestone20 = isolated-commit-applies-reviewed-result sends only approvalRef with resultReviewId, approvalId, and 64-hex approvalFingerprint; change.commit is strict additionalProperties=false, minimum policy apply, and integration commit re-verifies the receipt through ReviewService before project mutation
task0Milestone21 = original-starter-unchanged compares the final Starter tree identity with the captured baseline
task0Milestone22 = cleanup-and-identity runs only after harness cleanup and fails on any non-empty errors, protocolErrors, consoleErrors, pageErrors, requestFailures, stderrLines, childCleanupFailures, or activeLeaseDirectories channel; runner contract tests cover every blocking channel
task0Decision = PASS; no certain DOM, receipt, MCP schema, policy, or cleanup mismatch found in milestones 18-22; diagnostic may proceed only after remaining gates pass
redCommand = node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs
redResult = EXPECTED RED exit 1; 19 tests: 17 passed, 2 failed
redFailure1 = real three-stage typewriter sample used projectionVersion 1 before, 2 immediately after, and 3 final; the old helper rejected the valid v2 empty dialogText because it required the settled Alpha A text immediately
redFailure2 = selector contract rejected the stale #review-preview-host #preview-view wait; that nested node does not exist in the review preview DOM
redArtifact = <local-path> bytes=20034 sha256=58746B513A9FDFDB86CBDC0C731482FC69FDD477EFC3E7C2B689A19657070449
implementation = runner now requires one visible #review-preview-host, one visible iframe.preview-frame[title="剧情预览"] inside that host, and one visible .preview-trace inside that host; the nonexistent nested #preview-view wait was removed while positive canvas dimensions and all three independent scroll checks remain
typewriterEvidence = final settled projection is awaiting/version 3/Alpha A/lynn/「凛」/panel visible; text event records version 1 before, version 2 after, and the final version; after must establish lynn/「凛」/panel and may contain empty text or a valid Alpha A prefix; versions must strictly increase
causalAttribution = presentationApplied=true is recorded as sync-batch-correlation-not-event-exclusive and is not represented as exclusive event causation
negativeCoverage = non-increasing versions; wrong final/C; wrong final or after speaker/name/panel; dirty before state; non-prefix after text; trace/scene/kind/op mismatch; Core or presentation false; exclusive attribution; invalid canvas; absent, duplicate, hidden, or out-of-host DOM evidence
editorTestProjection = preview-causal-trace sample now records projectionVersion 1 to 2 and a valid empty immediate-after dialogText while retaining combined evidence change coverage; no Editor product code changed
runnerContractGreen = PASS exit 0; 19/19 tests; artifact <local-path> bytes=2052 sha256=DDD70220AA816F8A983478D9158EE026063AE34BEC0D1468122DE3B11DBC1969
editorTraceFocused = PASS exit 0; 1 file / 3 tests; artifact <local-path> bytes=379 sha256=EC24DA036D5C4229209542B462C1D3A10C978B5AE072A6F784840D3D7E5D78E7
editorAdjacentFocused = PASS exit 0; review-panel, review-workspace, review-preview, and preview-stage-layout: 4 files / 33 tests; artifact <local-path> bytes=601 sha256=DDCBDF072F4EB7C076D6F4D247D47C12E6F075A9694CECCE02F04A10F3C80047
runnerNodeCheck = PASS exit 0; command emitted no stdout/stderr, so it was not rerun and a 0-byte evidence file was materialized at <local-path> bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
worktreeDiffCheck = PASS exit 0; CRLF conversion warnings only; artifact <local-path> bytes=4160 sha256=2CE70B9DD7E23006D3FFE2D2E03BBB99AD3657F0B1D6663A3D75E77E8DB1F52A
stagedDiffCheck = PASS exit 0; staging empty; artifact <local-path> bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
runner = bytes=92944 sha256=82922C4C842C04B605D4EA623D270DD51934E3EAE574CB54F88FB5078240E6C3
runnerTest = bytes=29117 sha256=07FB28852A9BAE8F342FA079861D424D4C46CE41B3F2189174F2794A085F86D3
editorTraceTest = bytes=3727 sha256=7BB4F2355808021FD91264FF02122C8627CB82FD30D4668B4089148F000E46F3
taskbookPreAppend = bytes=231695 sha256=6E97812F3805414EF400D3F53C11A9DAAF7E6D2F3E4D343910ABD87E95C5AD23
rendererAndEditorFullGates = NOT_RERUN; Recovery-9 413/413 Renderer and 212/212 Editor results retained
verifyAll = NOT_RUN
formal = NOT_AUTHORIZED and NOT_RUN
recovery10Preflight = NOT_RUN; budget 1/1 unconsumed
recovery10Diagnostic = NOT_RUN; budget 1/1 unconsumed
nextGate = unique Recovery-10 preflight 1/1
~~~

### 2026-08-30 — W6 Recovery-10 unique preflight

~~~text
timestamp = 2026-08-30
task = W6_RUNNER_DOM_AND_TYPEWRITER_EVIDENCE_RECOVERY_10
command = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=preflight
runCount = 1/1 consumed; no rerun performed
result = PASSED exit 0; launcher-preflight PASSED
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = 82922c4c842c04b605d4ea623d270dd51934e3eae574cb54f88fb5078240e6c3
trackedCodeDiffPaths = 30
protocol = modern 2026-07-28 and legacy 2025-11-25 negotiation PASS; 30 capabilities; stage policy toolCount=30 with mutation exposed and commit hidden; stdoutPure=true
editorBuildEntries = index and preview present
errorChannels = errors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0
projectMutation = FALSE; stageProjectMutated=FALSE
originalStarterUnchanged = TRUE
commandArtifact = <local-path> bytes=2960 sha256=CDAE7C0AFB27DB94B9E4553110051C113B2D83EF2DCCDFF5CE7B494949F8F50C
preflightEvidence = <local-path> bytes=2919 sha256=7611122C8E2D8A92E59F03D886F44261D6B12BFA429B1A1447FFD2E7975816F4
preflightIdentity = <local-path> bytes=223 sha256=E383F331560996585548950930528F72CD484B4C5F16471C971B1DC6D868DC3A
formal = NOT_AUTHORIZED and NOT_RUN
recovery10Diagnostic = NOT_RUN; budget 1/1 unconsumed
nextGate = unique Recovery-10 diagnostic 1/1
~~~

### 2026-08-30 — W6 Recovery-10 unique diagnostic failure

~~~text
timestamp = 2026-08-30
task = W6_RUNNER_DOM_AND_TYPEWRITER_EVIDENCE_RECOVERY_10
status = W6_RUNNER_DOM_AND_TYPEWRITER_EVIDENCE_RECOVERY_10_DIAGNOSTIC_FAILED
command = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=diagnostic
runCount = 1/1 consumed; no rerun performed or authorized
result = FAILED exit 1; 16 milestones PASSED / 1 FAILED; fixed 22-milestone workflow did not complete
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = 82922c4c842c04b605d4ea623d270dd51934e3eae574cb54f88fb5078240e6c3
lastPassedNode = approval-required-error
firstFailedNode = editor-result-rendered
firstFailure = strict isReviewedPreviewEvidenceSatisfied returned false at packages/cli/e2e/human-agent-review-wave-6.e2e.mjs:1209 after the final preview and trace data had been collected
domCorrectionObserved = the run passed the host, contained iframe, canvas, and contained trace-panel wait/count assertions before reaching the strict predicate; exact DOM counts were not separately serialized into the failure artifact
finalProjectionObserved = rendererStatus=awaiting; dialogue.projectionVersion=4; dialogText="Alpha route A."; activeSpeakerId=lynn; speakerText="「凛」"; panelVisible=true; canvasBox x=546.5 y=4262.59375 width=267 height=150
managerVersionExpectationCorrection = the authorized expected final projectionVersion=3 was not reproduced in this diagnostic; the actual stable final dialogue projectionVersion was 4, while the required monotonic order still held
textTraceObserved = same trace preview-1788022133329-ff7f4d91-68a0-4825-8dcc-66285a9df484; sequence=2; Core kind=instruction; source.op=text; source.sceneId=wave5_alpha; coreEmitted=true; presentationApplied=true
textBeforeObserved = dialogue.projectionVersion=1; activeSpeakerId=null; speakerText=""; dialogText=""; panelVisible=false
textAfterObserved = dialogue.projectionVersion=2; activeSpeakerId=lynn; speakerText="「凛」"; dialogText=""; panelVisible=true
firstFailedContract = Runner read projectionVersion from presentationBefore/After/final projection.projectionVersion, but the artifact stores it at projection.dialogue.projectionVersion; the three constructed top-level version values were null, so the integer/version predicate failed despite observed dialogue versions 1 < 2 < 4
attributionBoundary = presentationApplied=true remains sync-batch correlation only; no exclusive event causation is claimed
decisionReceiptRegression = NOT_OBSERVED; editor-decision-receipt-visible passed with the persisted marker, original decision identity, restored selection, and 5 readonly decision controls
errorChannels = errors=1; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0; blockingIssueChannels=errors
projectMutation = FALSE; stageProjectMutated=FALSE; applyProjectMutated=FALSE
originalStarterFinalIdentity = UNVERIFIED because the diagnostic stopped before original-starter-unchanged; the immediately preceding unique preflight proved originalStarterUnchanged=true
diagnosticEvidence = <local-path> bytes=275598 sha256=A3B328CC5B57BC1E66560958AA84033D12EA916DF7F74B892F6B51BC018553C3
diagnosticIdentity = <local-path> bytes=226 sha256=B895823CC2C86E3117DB07767E0F08C098CA0E8EEDC15AA7982A2F99D7A62823
diagnosticCommandLog = <local-path> bytes=208895 sha256=C09573C51D691F40486367D039F921ECFAAC40442610B43F672D853144742ABD
taskbookPreFailureAppend = bytes=240751 sha256=CE2D5981941FC31D3E9615E871AA3AD527E7B07262E6C4F44DB1FB0F92E25E0D
gitStateBeforeFailureAppend = branch main; HEAD deaf74a64024b91e46cc750822295e0f9c2ce739; surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead/behind 10/0; tracked diffs 30; staging EMPTY; untracked 969 preserved
postFailureActions = Ledger append only; no code/test change after failure; no diagnostic rerun; no staging; no commit; no CODE_EVIDENCE_HEAD; no FORMAL; no push; no apply; no external Agent; no Owner acceptance; no Wave 7
nextStop = W6_RUNNER_DOM_AND_TYPEWRITER_EVIDENCE_RECOVERY_10_DIAGNOSTIC_FAILED; waiting for independent manager review and a new explicit recovery authorization
~~~

### 2026-08-30 — W6 Recovery-11 preview evidence shape RED/GREEN and focused gates

~~~text
timestamp = 2026-08-30
task = W6_PREVIEW_EVIDENCE_SHAPE_RECOVERY_11
authorization = NEW independent authorization; Recovery-10 remains consumed and failed; Recovery-11 preflight budget 1/1 and diagnostic budget 1/1 were unconsumed at entry
recovery10Evidence = <local-path> bytes=275598 sha256=A3B328CC5B57BC1E66560958AA84033D12EA916DF7F74B892F6B51BC018553C3
recovery10Identity = <local-path> bytes=226 sha256=B895823CC2C86E3117DB07767E0F08C098CA0E8EEDC15AA7982A2F99D7A62823
confirmedVersionShape = presentationBefore.projection.dialogue.projectionVersion=1; presentationAfter.projection.dialogue.projectionVersion=2; finalProjection.dialogue.projectionVersion=4; all projection top-level projectionVersion fields absent
redCommand = node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs
redResult = EXPECTED RED exit 1; 20 tests: 18 passed, 2 failed solely on the evidence-shape contract
redFailure1 = the old predicate rejected the valid real nested 1 < 2 < 4 sample
redFailure2 = the old predicate accepted forged top-level-only projectionVersion values plus a caller-supplied projectionVersions object
redNegativeCoverage = missing, non-integer, and non-strictly-increasing nested dialogue projection versions are rejected; top-level-only forged versions are rejected
redArtifact = <local-path> bytes=4117 sha256=743F442036345C72FE5D6CB9351E13509A25F62E3AE39930FA21DB87A301691E
implementation = exported pure buildReviewedPreviewEvidence derives projectionVersions only from projectionBefore.dialogue.projectionVersion, projectionAfter.dialogue.projectionVersion, and finalProjection.dialogue.projectionVersion; runEditorResult and the strict predicate share that constructor
fallback = NONE; no projection.projectionVersion compatibility path and no caller-supplied projectionVersions
strictEvidenceRetained = strict ordering plus Alpha A present, Alpha C absent, lynn, 「凛」, visible panel, awaiting renderer, positive canvas, unique visible contained host/iframe/trace panel, Core instruction/source.op=text, coreEmitted=true, and presentationApplied=true
editorFixture = preview-causal-trace uses nested dialogue projectionVersion values 1 and 2 with a RendererProjectionSnapshot-derived TypeScript constraint; no Editor product source changed
firstGreenAttempt = exit 1; 20 tests: 19 passed, 1 failed because a residual source-projection assertion still required the caller text to contain projectionVersions although the new contract forbids that manual field
firstGreenArtifact = <local-path> bytes=20183 sha256=A453588B86F85EF8F0CDCFFC82F05098A30623BFF1FF122302F971AD0E602963
testProjectionCorrection = removed only the obsolete caller-field expectation from the runner contract test; runtime derived-version coverage remains; no product or runner implementation change followed the failed GREEN attempt
runnerContractGreen = PASS exit 0; 20/20 tests; artifact <local-path> bytes=2161 sha256=591EF8B1F8AA5F09CAB2C3BB9446F0C2F731F1D380674FFB5A55D1F2130FE29E
editorTraceFocused = PASS exit 0; 1 file / 3 tests; artifact <local-path> bytes=379 sha256=36346D588AADE86396C85AEC59F78C91B660391DFFCB1985CB189B10662A99E5
runnerNodeCheck = PASS exit 0; artifact <local-path> bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
worktreeDiffCheck = PASS exit 0; CRLF conversion warnings only; artifact <local-path> bytes=4160 sha256=2CE70B9DD7E23006D3FFE2D2E03BBB99AD3657F0B1D6663A3D75E77E8DB1F52A
stagedDiffCheck = PASS exit 0; staging empty; artifact <local-path> bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
runner = bytes=93298 sha256=5213D43D988E30EA4C230F42381DD3079F53899AC519F4E7CCE9A0AFA275666A
runnerTest = bytes=30691 sha256=C3376BC53A0FD39ECC70CD72A6EDF46E4D3C1D77EF9519FE289BC2443789DFFA
editorTraceTest = bytes=4420 sha256=86D7E877CBBB36FB4406CC8929DDFB3E5F674466A4ED5880383464B902556139
taskbookPreAppend = bytes=245243 sha256=2A031CDA98AE80FCE2CCBF6F131E0C5B10994C4795425FF09A34E7455F14359A
gitState = branch main; HEAD deaf74a64024b91e46cc750822295e0f9c2ce739; tracked diffs 30; staging EMPTY; untracked 969 preserved
forbiddenGates = verify:all, CLI full, Editor full, Renderer full, and every old diagnostic NOT_RUN
forbiddenActions = no production source, dependency, lockfile, timeout, fixture, milestone-count, historical-artifact, push, apply, external Agent, Owner acceptance, or Wave 7 change/action
nextGate = unique Recovery-11 preflight 1/1
~~~

### 2026-08-30 — W6 Recovery-11 unique preflight

~~~text
timestamp = 2026-08-30
task = W6_PREVIEW_EVIDENCE_SHAPE_RECOVERY_11
command = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=preflight
runCount = 1/1 consumed; no rerun performed
result = PASSED exit 0; launcher-preflight PASSED
runHead = deaf74a64024b91e46cc750822295e0f9c2ce739
runnerSha256 = 5213d43d988e30ea4c230f42381dd3079f53899ac519f4e7cce9a0afa275666a
trackedCodeDiffPaths = 30
protocol = modern 2026-07-28 and legacy 2025-11-25 negotiation PASS; 30 capabilities; stage policy toolCount=30 with mutation exposed and commit hidden; stdoutPure=true
editorBuildEntries = index and preview present
errorChannels = errors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0
projectMutation = FALSE; stageProjectMutated=FALSE
originalStarterUnchanged = TRUE
commandArtifact = <local-path> bytes=2960 sha256=0E9EFFFB85D647202CC79E3DEFF1A6F875B136073864D0298AAF55D0A36429C0
preflightEvidence = <local-path> bytes=2919 sha256=2EA93F485879F9854F947D129D91231B82EB9C7B570DEC5DC2392B72FC343A46
preflightIdentity = <local-path> bytes=223 sha256=AFFCBD6B67A9A5D60FD517A84781F812C206783D867F9272270366CED7A081C5
taskbookPreAppend = bytes=250726 sha256=06EA829C7F332BE0C6998D991EF8770CB3E26FCDD908DD8891879EE292D4FD94
recovery11Diagnostic = NOT_RUN; new budget 1/1 available
formal = NOT_RUN
nextGate = unique Recovery-11 diagnostic 1/1
~~~

### 2026-08-30 — W6 Recovery-11 diagnostic result and manager-criterion stop

~~~text
timestamp = 2026-08-30
task = W6_PREVIEW_EVIDENCE_SHAPE_RECOVERY_11
status = W6_RECOVERY_11_POST_DIAGNOSTIC_MANAGER_GATE_BLOCKED
command = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=diagnostic
runCount = 1/1 consumed; no rerun performed or authorized
runnerResult = PASSED exit 0; 22/22 fixed milestones PASSED; artifact status PASSED
artifactLastPassedNode = cleanup-and-identity
artifactFirstFailedNode = NONE; no milestone failed
previewContract = editor-result-rendered PASSED; derived and nested dialogue projection versions both 1 < 2 < 4; final Alpha route A.; Alpha route C. absent; activeSpeakerId=lynn; speakerText=「凛」; panelVisible=true; rendererStatus=awaiting
traceContract = Core kind=instruction; source.op=text; coreEmitted=true; presentationApplied=true; host/iframe/trace panel each unique, visible, and contained; canvas 267x150
errorChannels = errors=0; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0
projectMutation = occurred=true; stageProjectMutated=false; applyProjectMutated=true
isolatedApplyEvidence = milestone 20 isolated-commit-applies-reviewed-result PASSED by changing only <local-path> from sha256 8218643bb2224c652ef86d896ccf2b09d7d0b1c72e8d5d47ff968a5cfeb74ee6 to 99e6ab700084b3bc608ab7bd43bca0df545b133af3e3af28881580d3a9b5adcc
originalStarter = milestone 21 original-starter-unchanged PASSED; E:/surdet/examples/starter before and after sha256 both 8218643bb2224c652ef86d896ccf2b09d7d0b1c72e8d5d47ff968a5cfeb74ee6; unchanged=true
managerCriterion = authorization requires applyProjectMutated=false as a success condition; actual artifact value is true
contractConflict = the fixed milestone 20 success contract intentionally applies the reviewed result to the isolated temporary project, so a 22/22 run produces applyProjectMutated=true; the execution AI is not authorized to reinterpret the manager criterion or remove/bypass milestone 20
firstFailedNode = POST_DIAGNOSTIC_MANAGER_CRITERION_APPLY_PROJECT_MUTATED; this is a manager continuation-gate mismatch, not an artifact milestone failure
diagnosticEvidence = <local-path> bytes=309238 sha256=C8E2E7CB69863BF3229FCF8C8E2948D79B787FA0959B6CB9D01A94A628405EF4
diagnosticIdentity = <local-path> bytes=226 sha256=737E2D7BA42484510972DC1CE89C0BEDAB17D7CC19582B922E03DDE7D036C9DB
diagnosticCommandLog = <local-path> bytes=235699 sha256=46995DEBE6AEE7E26381EEEF88ABF4C2B13D53ABEBCA3458251416FDC68EBE66
taskbookPreStopAppend = bytes=252484 sha256=CAB516FBA05F0311BD0BFBF32292029414E74C7E1902CDADA8F69B731FB1A072
gitStateBeforeStopAppend = branch main; HEAD deaf74a64024b91e46cc750822295e0f9c2ce739; surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead/behind 10/0; tracked diffs 30; staging EMPTY; untracked 969 preserved
postDiagnosticActions = Ledger append only; no code/test change; no diagnostic rerun; no staging; no commit; no CODE_EVIDENCE_HEAD; no FORMAL; no acceptance-prep; no external Agent; no Owner acceptance; no apply against the original project; no push; no Wave 7
nextStop = waiting for an independent manager clarification or new authorization that resolves the applyProjectMutated success predicate versus fixed milestone 20
~~~

### 2026-08-30 — W6 Recovery-11 post-diagnostic manager correction and freeze authorization

~~~text
timestamp = 2026-08-30
authorization = W6_R11_POST_DIAGNOSTIC_FREEZE_AND_FORMAL_1
managerDecision = RECOVERY_11_DIAGNOSTIC_ACCEPTED_AS_PASSED
diagnosticAcceptance = status PASSED; evidenceClass DIAGNOSTIC; 22/22 milestones PASSED; lastPassedNode cleanup-and-identity; firstFailedNode null
managerCorrection = POST_DIAGNOSTIC_MANAGER_CRITERION_APPLY_PROJECT_MUTATED is not a runner failure node and is withdrawn as a continuation blocker
withdrawnHistoricalCriterion = applyProjectMutated=false; this was a manager-authored erroneous criterion and must not be reused
correctMutationSemantics = stageProjectMutated=false; isolated fixture applyProjectMutated=true; projectMutation.occurred=true; original Starter unchanged=true
isolationBoundary = applyProjectMutated=true refers only to the %TEMP% isolated candidate project and does not mean that E:/surdet/examples/starter, a desktop project, or another real project was applied
diagnosticRerun = NOT_AUTHORIZED and NOT_REQUIRED; Recovery-11 diagnostic 1/1 remains consumed
preflightRerun = NOT_AUTHORIZED; testRerun = NOT_AUTHORIZED
acceptedEvidence = <local-path> bytes=309238 sha256=C8E2E7CB69863BF3229FCF8C8E2948D79B787FA0959B6CB9D01A94A628405EF4
acceptedIdentity = <local-path> bytes=226 sha256=737E2D7BA42484510972DC1CE89C0BEDAB17D7CC19582B922E03DDE7D036C9DB
acceptedRunnerSha256 = 5213D43D988E30EA4C230F42381DD3079F53899AC519F4E7CCE9A0AFA275666A
preStageTrackedSet = PASS; artifact trackedCodeDiffPaths 30 equals current tracked diff set 30 with zero set difference
additionalWave6Files = packages/cli/e2e/human-agent-review-wave-6.e2e.mjs bytes=93298 sha256=5213D43D988E30EA4C230F42381DD3079F53899AC519F4E7CCE9A0AFA275666A; packages/cli/test/human-agent-review-wave-6-runner.test.mjs bytes=30691 sha256=C3376BC53A0FD39ECC70CD72A6EDF46E4D3C1D77EF9519FE289BC2443789DFFA; packages/editor/src/preview-trace-evidence.ts bytes=680 sha256=476940C6ED016476744DE606867FBA66107D92BBF11302E6D49726A54767E616
expectedStagedPathCount = 33 unique paths; forbidden-path intersection empty; staging empty before freeze
taskbookPreCorrectionAppend = bytes=256205 sha256=76813FEE8333A3EE017550D6E013E6C176F0C03C9AF00EF7483B97477F8FA554
formalBudget = 1/1 available only after exact staging, code evidence commit, and clean frozen state
nextGate = exact 33-path staging, code evidence commit, then unique FORMAL 1/1
~~~

### 2026-08-30 — W6 code evidence freeze and unique FORMAL pass

~~~text
timestamp = 2026-08-30
authorization = W6_R11_POST_DIAGNOSTIC_FREEZE_AND_FORMAL_1
status = W6_FORMAL_PASSED; READY_FOR_INDEPENDENT_MANAGER_REVIEW; WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
preCommitScope = diagnostic trackedCodeDiffPaths 30 exactly equaled the current tracked diff set; three authorized untracked Wave 6 files added; final expected/staged/committed set exactly 33 paths with zero set difference
preCommitNameStatus = 30 modified; 3 added; no deleted, renamed, copied, or other status; no unstaged tracked path
preCommitChecks = git diff --check exit 0; git diff --cached --check exit 0; staged path count 33
preStageDiffCheckArtifact = <local-path> bytes=4160 sha256=2CE70B9DD7E23006D3FFE2D2E03BBB99AD3657F0B1D6663A3D75E77E8DB1F52A
postStageDiffCheckArtifact = <local-path> bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
cachedDiffCheckArtifact = <local-path> bytes=0 sha256=E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855
stagedNameStatusArtifact = <local-path> bytes=1626 sha256=377EBD35D7C45918827FE7C68A2CEAEDC667212811450B11C920BDCA16D6635E
commit = 5f796620736a4264f1d65e5baec56f55f76685f8 test(authoring): verify human review workflow
commitParent = deaf74a64024b91e46cc750822295e0f9c2ce739
commitScope = exact 33 paths; 6392 insertions; 286 deletions; runner, runner contract test, and preview-trace-evidence helper are tracked additions
commitArtifact = <local-path> bytes=339 sha256=1C6B3F615578AADDE2B3497C2E20F613B5FDD8984F8EFB53B7ED354D346A8F21
codeEvidenceHead = 5f796620736a4264f1d65e5baec56f55f76685f8
freezeState = before FORMAL, tracked worktree clean; staging empty; 966 unrelated untracked files preserved; frozen runner bytes=93298 sha256=5213D43D988E30EA4C230F42381DD3079F53899AC519F4E7CCE9A0AFA275666A
formalCommand = SURDET_CODE_EVIDENCE_HEAD=5f796620736a4264f1d65e5baec56f55f76685f8 node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=formal
formalRunCount = 1/1 consumed; no rerun performed or authorized
formalResult = PASSED exit 0; evidenceClass FORMAL; mode formal; 22/22 milestones PASSED; lastPassedNode cleanup-and-identity; firstFailedNode null
formalBinding = runHead=5f796620736a4264f1d65e5baec56f55f76685f8 equals CODE_EVIDENCE_HEAD and current HEAD; runnerSha256=5213D43D988E30EA4C230F42381DD3079F53899AC519F4E7CCE9A0AFA275666A; trackedCodeDiffPaths=[]
formalMutationSemantics = projectMutation.occurred=true; stageProjectMutated=false; isolated fixture applyProjectMutated=true
formalErrorChannels = errors=0; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0; blockingIssueChannels=0
formalPreviewEvidence = editor-result-rendered PASSED; projection versions 1 < 2 < 4; final Alpha route A.; activeSpeakerId=lynn; speakerText=「凛」
formalEvidence = <local-path> bytes=304038 sha256=FAA2E2126F7074581965CFD2BE9224937BA381CAA508BBC9430AF142A8E1549F
formalIdentity = <local-path> bytes=222 sha256=FD53FFBDC7294EB4AEBEFDE40727FF80F574224B52058329F024C8F9BD4BFC18
formalCommandLog = <local-path> bytes=231318 sha256=3AC923101610D4440B28CA5CCED9C113C0CCE5D3C686DE7E2CB0D05CC88413CA
keySidecarCleanBaseline = <local-path> bytes=244 sha256=C77D340907B32632B80B8040B2B81C9488FB85F236E32C77A859BF5E398B5015
keySidecarEditorResult = <local-path> bytes=12130 sha256=2E8CF26BB56BEB0705DD8FB0AD20EEA18921977E6A816C60F2AAFE9BEA8B900F
keySidecarIsolatedApply = <local-path> bytes=14897 sha256=0F70BE5D9B8B2206FAEAC0A9F32C4B6D2BC9FE655BEA9497C08155D051F2174C
keySidecarStarter = <local-path> bytes=14084 sha256=4D6A07B1113E6B8F587C58E60577A3E77FC4CFFBECE7ABB750BD34B4CED7CAB7
keySidecarCleanup = <local-path> bytes=513 sha256=1AB676B6FB990C3C78A031252AD901A0CF29F7EA6D26FE131B3D31B20174DC84
isolatedProject = <local-path> changed from Starter baseline sha256=8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6 to reviewed result sha256=99E6AB700084B3BC608AB7BD43BCA0DF545B133AF3E3AF28881580D3A9B5ADCC
isolatedAlpha = content/scenario/wave5_alpha.gal bytes=59 sha256=A1B1EEA22100625DE7E2A8294DA4FA4E87A4DCED45E32AE5B310A411EFE057C9; contains Alpha route A.; does not contain Alpha route C.
isolatedBeta = content/scenario/wave5_beta.gal bytes=88 sha256=74E64A7219BF8C9A2A19B8215FB109BA11124DAAA145CE05A8DD5E3F8C1C57C2; contains wave5_beta and blocking beta_opening timeline
isolatedTimeline = content/timelines/beta_opening.json bytes=303 sha256=857D65E2FC34C6825910768E037E309FBFD1B76243C97ABD67B0ECA24FFD39BF; id=beta_opening; durationMs=400; one track
isolatedConfig = game.config.json bytes=1625 sha256=FAE3B8D312925E1B01C6744178C394CD1A598E298D47C8340164EEA738D123CD; flag.alpha type=string initial=""
originalStarter = E:/surdet/examples/starter before/after sha256=8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6; unchanged=true
taskbookPreFormalAppend = bytes=258849 sha256=5BF9388B54380766A2BDF167D6DB53A1561447543A65509E5452B7BDE9171EE4
postFormalLedger = append-only after FORMAL completion; deliberately not committed; no docs-only commit
prohibitedActions = no diagnostic/preflight/test rerun; no verify:all; no acceptance-prep; no external Agent; no Owner acceptance; no real-project apply; no push; no Wave 7
stopState = W6_FORMAL_PASSED; READY_FOR_INDEPENDENT_MANAGER_REVIEW; WAITING_FOR_INDEPENDENT_MANAGER_REVIEW; EXTERNAL_AGENT_NOT_STARTED; OWNER_ACCEPTANCE_NOT_STARTED; APPLY_NOT_PERFORMED; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~

### 2026-08-30 — W6 result receipt integrity recovery 1 baseline

~~~text
timestamp = 2026-08-30
authorization = W6_RESULT_RECEIPT_INTEGRITY_1
theme = result review receipt persistence, mutual exclusion, identity validation, and readonly reopen; no acceptance-prep, external Agent, Owner acceptance, push, or Wave 7
gitBaseline = branch main; HEAD 5f796620736a4264f1d65e5baec56f55f76685f8; parent deaf74a64024b91e46cc750822295e0f9c2ce739; surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead/behind 11/0
workingTreeBaseline = one tracked unstaged path, this Wave 6 taskbook carrying the post-FORMAL append; staging EMPTY; 966 pre-existing unrelated untracked paths preserved; protected-path intersection empty
historicalFormalClassification = IDENTITY_VALID_BUT_RESULT_RECEIPT_REOPEN_COVERAGE_INSUFFICIENT; historical status remains PASSED and is not rewritten as failure
historicalFormalEvidence = <local-path> bytes=304038 sha256=FAA2E2126F7074581965CFD2BE9224937BA381CAA508BBC9430AF142A8E1549F
historicalFormalIdentity = <local-path> bytes=222 sha256=FD53FFBDC7294EB4AEBEFDE40727FF80F574224B52058329F024C8F9BD4BFC18
historicalFormalBinding = status PASSED; evidenceClass FORMAL; 22/22 fixed milestones; runHead 5f796620736a4264f1d65e5baec56f55f76685f8; runnerSha256 5213D43D988E30EA4C230F42381DD3079F53899AC519F4E7CCE9A0AFA275666A; trackedCodeDiffPaths empty; errors and cleanup channels empty; active lease directories empty; stageProjectMutated=false; isolated applyProjectMutated=true; original Starter unchanged
coverageGap = historical fresh-approval-inspected wrote and immediately inspected final-approval.json but did not close and reopen the same result review, did not prove persisted terminal marker/identity/selection/readonly controls, and commit did not compare approvalRef.approvalFingerprint with the verified disk receipt
staticContractGaps = Editor reopen used receipt file presence without shared semantic validation or retained receipt identity; approval and return writers had no shared single-flight; CLI return validation accepted any string reasonCategory and did not recompute returnFingerprint; Node terminal receipt opposite-file checks were not one shared critical section
evidenceRoot = <local-path>
resultFixtureLimitFollowup = file count and size caps remain a non-blocking future reliability candidate and are outside this repair
implementation = NOT_STARTED; permanent RED not yet run
verifyAllRecoveryBudget = 1/1 unconsumed
diagnosticBudget = 1/1 unconsumed
replacementFormalBudget = 1/1 unconsumed
push = NOT_PERFORMED
~~~

### 2026-08-30 — W6 result receipt integrity recovery 1 permanent RED

~~~text
timestamp = 2026-08-30
authorization = W6_RESULT_RECEIPT_INTEGRITY_1
phase = PERMANENT_RED_CONFIRMED; production implementation unchanged
authoringRedCommand = npm run test -w @surdet/authoring -- review-receipts.test.ts
authoringRedResult = EXPECTED RED exit 1; 1 file / 20 tests: 1 failed, 19 passed; missing shared returnFingerprintOf and validateReturnRequest truth; the existing wrong approvalFingerprint rejection contract passed
authoringRedArtifact = <local-path> bytes=3665 sha256=B55419E82AA711C9BD90E72374D547180381DDC129F356BF629E46E5F6F0D3B5
cliRedCommand = npm run test -w @surdet/cli -- node-review-store.test.ts review-service.test.ts
cliRedResult = EXPECTED RED exit 1; 2 files / 23 tests: 4 failed, 19 passed
cliRedFailures = concurrent createFinalApproval/createReturnRequest both fulfilled and both terminal files reached disk; wrong approvalRef.approvalFingerprint resolved; tampered returnFingerprint resolved; unknown reasonCategory with matching bytes fingerprint resolved
cliRedArtifact = <local-path> bytes=9648 sha256=2FD1BE7F63D44EADF9E24FA10906B2E58FDF62D548BC0631FA2930567669CAD1
editorRedCommand = npm run test -w surdet-editor -- review-workspace.test.ts review-panel.test.ts
editorRedResult = EXPECTED RED exit 1; 2 files / 35 tests: 8 failed, 27 passed
editorRedFailures = concurrent approval/return both fulfilled; approved and returned reopen state retained no receipt object; tampered approval fingerprint, return fingerprint, and return reason category were accepted; approved and returned persistent Chinese readonly markers were absent
editorExistingBoundary = corrupt JSON/read failure remained fail-loud; dual approval plus return directory remained REVIEW_IDENTITY_MISMATCH
editorRedArtifact = <local-path> bytes=15330 sha256=92A1A7F57209BA8B6C312674FE84B6CD0EE06CDE30FA1A43A347D72001ABD923
runnerRedCommand = node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs
runnerRedResult = EXPECTED RED exit 1; 21 tests: 1 failed, 20 passed; exported result receipt reopen predicate and its live call site were absent
runnerRedArtifact = <local-path> bytes=3315 sha256=9B3B2E95B7CBAAA1D975FECD1927EA70F564042B71658C6821EA29763BA390D9
redValidity = assertion failures only; no fixture, import, TypeScript compile, spelling, timeout, old dist, preflight, diagnostic, FORMAL, or historical artifact mutation failure
verifyAllRecoveryBudget = 1/1 unconsumed
diagnosticBudget = 1/1 unconsumed
replacementFormalBudget = 1/1 unconsumed
~~~

### 2026-08-30 — W6 result receipt integrity recovery 1 restart-safe checkpoint

~~~text
timestamp = 2026-08-30
authorization = W6_RESULT_RECEIPT_INTEGRITY_1
pauseReason = user requested a restart-safe stop before usage reset; no verification or one-shot budget was consumed after the request
status = W6_RESULT_RECEIPT_INTEGRITY_1_SAFE_PAUSE_FOR_RESTART; IMPLEMENTATION_IN_PROGRESS; NO_COMMIT; NO_STAGING
gitCheckpoint = branch main; HEAD 5f796620736a4264f1d65e5baec56f55f76685f8; parent deaf74a64024b91e46cc750822295e0f9c2ce739; surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead 11 / behind 0
trackedCheckpoint = 14 unstaged tracked paths; staging empty; existing unrelated untracked paths preserved; no reset, checkout, clean, delete, push, apply, acceptance-prep, external Agent, Owner acceptance, or Wave 7
trackedPaths = docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md; packages/authoring/src/review-receipts.ts; packages/authoring/test/review-receipts.test.ts; packages/cli/e2e/human-agent-review-wave-6.e2e.mjs; packages/cli/src/authoring/node-review-store.ts; packages/cli/src/authoring/review-service.ts; packages/cli/test/human-agent-review-wave-6-runner.test.mjs; packages/cli/test/node-review-store.test.ts; packages/cli/test/review-service.test.ts; packages/editor/src/panels/review-panel.ts; packages/editor/src/review-workspace.ts; packages/editor/test/preview-causal-trace.test.ts; packages/editor/test/review-panel.test.ts; packages/editor/test/review-workspace.test.ts
implementationFacts = shared Authoring return fingerprint and validator added; CLI approvalRef fingerprint checked against verified disk approval; CLI return uses shared validator; NodeReviewStore approval/return share one per-review critical section; Editor approval/return share one single-flight, reopen validates and retains exact receipt, terminal UI shows Chinese identity/decision/selection marker and disables both actions; runner fixed node now closes and reopens the same result workspace and records disk/fake-root/readonly evidence without adding a milestone
focusedGreenAuthoring = 20/20 PASS; <local-path> bytes=363 sha256=0A225B4613EFA3AD87CC6D4B6EA779C00CF4FEF03492A612743CC54B976AF57A
authoringTypecheck = PASS; 06-authoring-typecheck.log bytes=74 sha256=9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78
authoringBuild = PASS; 07-authoring-build.log bytes=67 sha256=D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9
focusedGreenCli = 23/23 PASS; 08-cli-green.log bytes=1181 sha256=B016F5FFD3898ECD7EFC27AF256E5D8313526AFDCC7610FC65996B05BC166289
focusedGreenEditor = 35/35 PASS; 09-editor-green.log bytes=447 sha256=4143DAAD5264F07CBA0067F576AF931E22886600E4C102BD852E7CAE4EE95975
authoringFull = 246/246 PASS; 10-authoring-full-test.log bytes=1832 sha256=AED6608AA4226E5B840641549E5A330DACA42D7BAC7B34760D9A00CB895F71B8
defaultParallelCliFull = FAILED exit 1; 266/273 passed, 7 failed; 11-cli-full-test.log bytes=29619 sha256=624A2C0E964B4BF311596DF7DAFB9F7253638732C910C3C5E715D7DD633CD418
defaultParallelCliFullFailureClasses = runner contract was still RED at the time and is now fixed; five parallel-load timeouts; one concurrent loser returned CHANGE_BUSY instead of the test projection CHANGE_RECORD_CONFLICT; this run remains failed and must not be rewritten as full PASS
runnerContractAfterImplementation = 21/21 PASS; 12-runner-green.log bytes=2274 sha256=C1EC7540D0CC892840E1E22A3FDD64CB84CA8069D466809C53D3EEDA3396DD6C
cliTypecheck = PASS; 13-cli-typecheck.log bytes=68 sha256=AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917
cliBuild = PASS; 14-cli-build.log bytes=61 sha256=898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E
editorFull = 220/220 PASS before the later type-only PreviewTraceProjectionFixture correction; 15-editor-full-test.log bytes=1857 sha256=0C9255B0D4A0E1D555A5C393D46A3BE6D44D3038F2FD58178FBA1CE2541E1A94
editorTypecheckFailuresPreserved = 16-editor-typecheck.log exit 2 bytes=847 sha256=69A4357095C3584E32CF99ECFA6EFCF1A3908275FA9213ABDCD517B056CF1A41; 18-editor-typecheck-green.log exit 2 bytes=694 sha256=8823D959BB91D1E2FE4E99A9D4FB811525D3DF793E31420698815876F5649111
editorTypeFixtureCorrection = preview-causal-trace.test.ts now applies NonNullable to nullable Renderer projection branches and locally types runtime-only panelVisible; no Renderer or Editor runtime production code changed for this correction
editorTypecheckFinal = PASS; 20-editor-typecheck-green.log bytes=70 sha256=6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3
editorBuildFinal = PASS; 21-editor-build.log bytes=1998 sha256=065FFE504494C8F194A7796945229FC1F457B4D196A7FB2066F3214D3EC4D295
evidenceRoot = <local-path>
resumeFirstReadOnlyChecks = reread AGENTS.md and this checkpoint; confirm HEAD remains 5f796620736a4264f1d65e5baec56f55f76685f8, the same 14 tracked paths remain unstaged, staging is empty, and evidenceRoot logs retain their recorded identities
resumeNextCommands = first run the focused preview-causal-trace test for the type-only fixture change; then run one strictly serial CLI full workspace test to distinguish current product truth from the retained default-parallel failure; only after green continue node --check, diff checks, launcher preflight, and the still-unconsumed one-shot gates
verifyAllRecoveryBudget = 1/1 UNCONSUMED
preflight = NOT_RUN_FOR_THIS_RECOVERY
diagnosticBudget = 1/1 UNCONSUMED
replacementFormalBudget = 1/1 UNCONSUMED
codeEvidenceHead = NOT_ESTABLISHED
diagnostic = NOT_RUN
replacementFormal = NOT_RUN
historicalFormal = preserved as identity-valid but result-receipt-reopen coverage-insufficient historical FORMAL; artifact unchanged
safeStop = no process or test left running; restart may resume entirely from Git worktree, this Ledger checkpoint, and evidenceRoot
~~~

### 2026-08-30 — W6 result receipt integrity recovery 1 resumed gates and verify-all stop

~~~text
timestamp = 2026-08-30
authorization = W6_RESULT_RECEIPT_INTEGRITY_1
status = W6_RESULT_RECEIPT_INTEGRITY_1_VERIFY_ALL_FAILED; IMMEDIATE_STOP_BEFORE_DIAGNOSTIC
resumeBaseline = exact restart-safe checkpoint restored; branch main; HEAD 5f796620736a4264f1d65e5baec56f55f76685f8; 14 expected unstaged tracked paths; staging empty; protected tracked intersection zero; 15 checkpoint evidence hashes matched with zero mismatch
previewFixtureFocused = PASS 3/3; <local-path> bytes=379 sha256=3E733822DE60C2FEB4F424675B97371512C6E2DDBDDB224B5B6A32FDCF0E7A24
cliSerialFull = PASS 35/35 files and 273/273 tests; <local-path> bytes=14156 sha256=3349B25B46318A7B3AE822CF0B5640CADD7ECD29845845EF5C1FBB71A2EAD56E
defaultParallelCliTruth = the earlier default-parallel full gate remains FAILED and is not rewritten by the serial pass
runnerContractFinal = PASS 21/21; 24-runner-contract-final.log bytes=2278 sha256=2A3BE2EF1F16C6A3D99E43289FEAA5490D0D23A91433082E944A956D7E5AF01B
runnerNodeCheck = PASS exit 0; 25-runner-node-check.log bytes=86 sha256=12D721A4F0364B0A818EDC40EF1668D392EA54D3841B09A918BDCB6EFE39070C
diffChecksBeforePreflight = git diff --check exit 0; 26-git-diff-check.log bytes=1983 sha256=99C6A538DF16CB2710126186B9D2A5D3B7811BFD8A60C2B5DBCA1F80A57EEF25; git diff --cached --check exit 0; 27-git-cached-diff-check.log bytes=48 sha256=918DCA930CFB8B1843D71E1F5D2FFA7DB2A7E833EE467DF85B3AB3F27AFB6E7A
preflight = PASSED exit 0; evidenceClass PRE_FLIGHT; launcher-preflight PASSED; runHead 5f796620736a4264f1d65e5baec56f55f76685f8; runnerSha256 105244D354FD9ACABA2EC4FEBD01CCFB67907F8295562CBC6A64499709CE3246; 14 expected trackedCodeDiffPaths; errors/console/page/request/stderr/cleanup/lease channels empty; original Starter unchanged
preflightLog = <local-path> bytes=2239 sha256=16C59845672FADE21AB3D198BCA5B4F57D0E7E307F181AC0E93AD99FB5392DB5
preflightEvidence = <local-path> bytes=2118 sha256=3C741FBC10C5DF556A9A82C563D5B01C2A77FA21D5BF4FCA9FB617F0D957E142
preflightIdentity = <local-path> bytes=223 sha256=717283C6C6AD3BD435C979B75F6A4691CDAA2DCFF5D9AF14F3C04DD8F9B1785B
verifyAllRecoveryBudget = 1/1 CONSUMED_AND_FAILED; no rerun performed or authorized
verifyAllCommand = npm run verify:all
verifyAllResult = FAILED exit 1 at verify:tests because the default-parallel @surdet/cli workspace test returned 5 timeout failures; all completed tool/boundary/hygiene/typecheck and non-CLI workspace test stages shown in the log passed
verifyAllFirstFailedNode = verify:tests / @surdet/cli / authoring-vertical-slice.test.ts timed out at 15000ms
verifyAllTimeouts = authoring-vertical-slice.test.ts 15000ms; authoring-project-config-wave3.test.ts 15000ms; agent-port-composition.test.ts reviewed selection contract 5000ms; composition-service.test.ts compare-and-plan 5000ms; composition-service.test.ts no-mutation dry-run 5000ms
verifyAllFailureClass = TIMEOUT_ONLY; no functional assertion, receipt contract, typecheck, build, fixture, import, syntax, or cleanup failure was observed in the five failed tests
parallelCapacityInference = STRONGLY_SUPPORTED by the immediately preceding strict serial CLI full 273/273 PASS, but the recovery verify:all gate remains objectively FAILED
verifyAllLog = <local-path> bytes=49433 sha256=4D610AA792722BD1952B8EBDB4379C0BA1BCFE1434899117374D9A1F0414D680
postFailureGit = HEAD unchanged at 5f796620736a4264f1d65e5baec56f55f76685f8; exact same 14 tracked paths; staging empty; unexpected tracked paths zero; missing expected paths zero
diagnosticBudget = 1/1 UNCONSUMED_BUT_BLOCKED_BY_FAILED_VERIFY_ALL
diagnostic = NOT_RUN
codeEvidenceHead = NOT_ESTABLISHED
commit = NOT_CREATED
replacementFormalBudget = 1/1 UNCONSUMED
replacementFormal = NOT_RUN
historicalFormal = preserved unchanged as identity-valid but result-receipt-reopen coverage-insufficient historical evidence
prohibitedActions = no verify:all rerun; no DIAGNOSTIC; no commit; no FORMAL; no acceptance-prep; no external Agent; no Owner acceptance; no apply; no push; no Wave 7
stopState = W6_RESULT_RECEIPT_INTEGRITY_1_VERIFY_ALL_FAILED; WAITING_FOR_NEW_MANAGER_AUTHORIZATION
~~~

### 2026-08-30 — W6 result receipt integrity gate exception 1 diagnostic pass

~~~text
timestamp = 2026-08-30
authorization = W6_RESULT_RECEIPT_INTEGRITY_1_GATE_EXCEPTION_1
managerException = recovery verify:all remains FAILED_TIMEOUT_ONLY; PARALLEL_CAPACITY_RISK_REMAINS_OPEN; no verify:all rerun or replacement performed; manager authorized the existing DIAGNOSTIC 1/1 despite that retained failure
preDiagnosticBaseline = branch main; HEAD 5f796620736a4264f1d65e5baec56f55f76685f8; parent deaf74a64024b91e46cc750822295e0f9c2ce739; exact 14/14 tracked paths with set difference zero; staging empty; 8 recorded failure logs matched bytes/SHA with zero mismatch
diagnosticBudget = 1/1 CONSUMED_AND_PASSED; no rerun performed
diagnosticCommand = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=diagnostic
diagnosticResult = PASSED exit 0; evidenceClass DIAGNOSTIC; mode diagnostic; 22/22 fixed milestones PASSED; lastPassedNode cleanup-and-identity; firstFailedNode null
diagnosticBinding = runHead 5f796620736a4264f1d65e5baec56f55f76685f8; runnerSha256 105244D354FD9ACABA2EC4FEBD01CCFB67907F8295562CBC6A64499709CE3246; trackedCodeDiffPaths exact 14-path whitelist
resultReceiptReopen = fresh-approval-inspected PASSED; approvalId approval_1788066764662; approvalFingerprint ec434c215d9e2662c37e1584c67088eaf33f96228f21b7652bcbea6c8de8699d; decisionId 542de008-48ee-47a8-8d89-f61bcb315705
resultReceiptSelection = 31ee31dc386b0df22420683774bb9edd, 6368cf4defd14473e8e884433eb0e5c4, 7dd69031e1927439306d1ef40554a333, c1c861c2f52bffd98254272f95f56513
resultReceiptMarker = present=true; kind=approval; Chinese text contains 已批准, receipt ID/fingerprint, original decision, and all original selected unit IDs; global status after reopen=已打开审阅任务
resultReceiptReadonly = approve-result disabled=true; return-result disabled=true
resultReceiptDiskIdentity = before bytes=1440 sha256=1DABEFD77E0D1E20A3BF516CB7217F1CE33DE6ABCA6364036CFCD747023BBB35; after bytes=1440 sha256=1DABEFD77E0D1E20A3BF516CB7217F1CE33DE6ABCA6364036CFCD747023BBB35; exact identity equality=true
resultReceiptExclusivity = fake-root final-approval.json exists with exact approvalId/fingerprint; decision.json absent; return-request.json absent; second terminal receipt not generated
diagnosticErrorChannels = errors=0; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0; blockingIssueChannels=0
diagnosticMutationSemantics = projectMutation.occurred=true; stageProjectMutated=false; isolated applyProjectMutated=true
diagnosticStarter = original Starter before/after fileCount=37 bytes=6705750 sha256=8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6; unchanged=true
diagnosticEvidence = <local-path> bytes=310951 sha256=A85A4717DEB2DE37B73D9FE1C550DD9D5EB4D62C9416558A61B12F293D4C4473
diagnosticIdentity = <local-path> bytes=226 sha256=B32544D6595B0312F1525EA41A6473F53394A77AF1A2C19EB61334AF2693F4AE
diagnosticLog = <local-path> bytes=236513 sha256=A89BE077D412E1B88FCCCF9F9646D680FF48C3A41682CBD67BE59E36396B8C58
diagnosticSidecarEditorResult = <local-path> bytes=12138 sha256=795AFDAAA2EF7F206AF94830F5ACA7C615A4D0238301EEE19B48AA96AF274F8F
diagnosticSidecarReceiptReopen = <local-path> bytes=4416 sha256=C33B6EA2E6D62EA6FD3034FDC1F87A8BD34B4B09E21B59ADDDF6B7F114DF4C57
diagnosticSidecarIsolatedApply = <local-path> bytes=14905 sha256=E76DF8F7327DC08070C5C306DA1432DA6F8359533B0D3785D97CFAD679799A47
diagnosticSidecarStarter = <local-path> bytes=14084 sha256=4D6A07B1113E6B8F587C58E60577A3E77FC4CFFBECE7ABB750BD34B4CED7CAB7
diagnosticSidecarCleanup = <local-path> bytes=1324 sha256=C58275F6DF55B7958BACAE42B4BA09A3B555DF88B9B4138AFF33D0191F40FABA
nextGate = exact 14-path set comparison, exact staging without directory adds, local commit fix(authoring): preserve result review receipts, frozen clean CODE_EVIDENCE_HEAD, then replacement FORMAL 1/1
~~~

### 2026-08-30 — W6 result receipt integrity replacement FORMAL pass

~~~text
timestamp = 2026-08-30
authorization = W6_RESULT_RECEIPT_INTEGRITY_1_GATE_EXCEPTION_1
status = W6_RESULT_RECEIPT_INTEGRITY_RESTORED; DIAGNOSTIC_PASSED; REPLACEMENT_FORMAL_PASSED; READY_FOR_INDEPENDENT_MANAGER_REVIEW
recoveryVerifyAll = FAILED_TIMEOUT_ONLY retained; verify:all was not rerun or replaced; PARALLEL_CAPACITY_RISK remains OPEN
codeEvidenceCommit = e6ae69cbadbbae2ac941899a091e9de6bb9e8eda; parent 5f796620736a4264f1d65e5baec56f55f76685f8; subject fix(authoring): preserve result review receipts
codeEvidenceScope = exact 14 authorized paths; whitelist missing=0; whitelist extra=0; commit-path count=14; pre-FORMAL tracked worktree clean; pre-FORMAL staging empty; 966 unrelated untracked paths preserved
codeEvidenceRunner = packages/cli/e2e/human-agent-review-wave-6.e2e.mjs bytes=98051 sha256=105244D354FD9ACABA2EC4FEBD01CCFB67907F8295562CBC6A64499709CE3246
replacementFormalBudget = 1/1 CONSUMED_AND_PASSED; no rerun performed
replacementFormalCommand = SURDET_CODE_EVIDENCE_HEAD=e6ae69cbadbbae2ac941899a091e9de6bb9e8eda node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=formal
replacementFormalResult = PASSED exit 0; evidenceClass FORMAL; mode formal; 22/22 fixed milestones PASSED; lastPassedNode cleanup-and-identity; firstFailedNode null
replacementFormalBinding = runHead=e6ae69cbadbbae2ac941899a091e9de6bb9e8eda equals CODE_EVIDENCE_HEAD; runnerSha256=105244D354FD9ACABA2EC4FEBD01CCFB67907F8295562CBC6A64499709CE3246; trackedCodeDiffPaths=[]
replacementFormalReceipt = fresh-approval-inspected PASSED; approvalId=approval_1788067035551; approvalFingerprint=736f4ed63909ffbb9089d9915f80e559c0d6522ca9ab4793e9db8b45e51f61b8; resultReviewId=review_result_033ebd4e0de640ec8ed46755e6f146df; decisionId=3f0c9b6b-e0fd-4541-80d4-8399f05ab059; decisionFingerprint=c541bceecb8be27a139be4ce6bf8599dd5f00cd9af48b9bec79600f8cfc7118d
replacementFormalSelection = 526f858046f64281e4175fdef2390012, 735e9269f5f32527a5b86e115464f3a3, 94354a1b1bdb9527e46077a111db24d1, c6bb3a5f4cac26abfe85fb9c2cf31dac
replacementFormalReceiptMarker = present=true; kind=approval; Chinese text contains 已批准, receipt ID/fingerprint, original decision, and all original selected unit IDs; global status after reopen=已打开审阅任务
replacementFormalReceiptReadonly = approve-result disabled=true; return-result disabled=true
replacementFormalReceiptDiskIdentity = before bytes=1440 sha256=FBA777901E5EABDA2398FDF3B329C6A931EBC32FD61F0D8B31BBEA29A2760A0A; after bytes=1440 sha256=FBA777901E5EABDA2398FDF3B329C6A931EBC32FD61F0D8B31BBEA29A2760A0A; exact identity equality=true; live disk identity matched evidence
replacementFormalReceiptExclusivity = review receipt directory contains identity.json and final-approval.json; return-request.json absent; no second terminal receipt generated
replacementFormalErrorChannels = errors=0; protocolErrors=0; consoleErrors=0; pageErrors=0; requestFailures=0; stderrLines=0; childCleanupFailures=0; activeLeaseDirectories=0; blockingIssueChannels=0
replacementFormalMutationSemantics = projectMutation.occurred=true; stageProjectMutated=false; isolated applyProjectMutated=true; isolated project before sha256=8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6; after sha256=99E6AB700084B3BC608AB7BD43BCA0DF545B133AF3E3AF28881580D3A9B5ADCC
replacementFormalAppliedFiles = isolated project disk contains content/scenario/wave5_alpha.gal with Alpha route A. and without Alpha route C.; contains content/scenario/wave5_beta.gal with Beta route.; contains content/timelines/beta_opening.json id=beta_opening; game.config.json contains flag.alpha type=string initial empty
replacementFormalStarter = original Starter before/after fileCount=37 bytes=6705750 sha256=8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6; unchanged=true
replacementFormalEvidence = <local-path> bytes=308338 sha256=67F73D6CB80AEDA1683DDD2D572C91B04771FDFC92C74B36393CF790A859CFEF
replacementFormalIdentity = <local-path> bytes=222 sha256=034A7869F9F04F5EE357611C1BF819D7F140B415E015C0C11AAC8D90B95610D5; identity points to the same evidence bytes/SHA
replacementFormalLog = <local-path> bytes=234287 sha256=3181B67E85738A153629531078DC4DBD7217E889CA5B58E71B2BFB6295BC7D97
replacementFormalSidecarEditorResult = <local-path> bytes=12130 sha256=0C679106E6CC426D49D0931C808EA5D6D8812EC8F4BC34FE3551A1A82C6AEB39
replacementFormalSidecarReceiptReopen = <local-path> bytes=4404 sha256=0FD06023E5F0706D69202ACDFAF0079B1181633A45E070BDB55C70EB32E68E60
replacementFormalSidecarIsolatedApply = <local-path> bytes=14897 sha256=9B341677D7E9F55CFAF04C2999777C8A9EFaf444031062C4738989C013DE6207
replacementFormalSidecarStarter = <local-path> bytes=14084 sha256=4D6A07B1113E6B8F587C58E60577A3E77FC4CFFBECE7ABB750BD34B4CED7CAB7
replacementFormalSidecarCleanup = <local-path> bytes=513 sha256=AC2D0D8966B546FB6CFE2517F4848E80CE6239BC9A491EF8116BF7ADFF3F4564
sidecarDiskIdentityCheck = all five selected sidecars matched their recorded bytes/SHA; mismatch count=0
historicalFormal = preserved unchanged as identity-valid but result-receipt-reopen coverage-insufficient historical FORMAL; artifact not deleted, overwritten, or reclassified as failed
postFormalPolicy = this Ledger append is intentionally uncommitted; no docs-only commit; no acceptance-prep; no external Agent; no Owner acceptance; no real-project apply; no push; no Wave 7
stopState = W6_RESULT_RECEIPT_INTEGRITY_RESTORED; DIAGNOSTIC_PASSED; REPLACEMENT_FORMAL_PASSED; READY_FOR_INDEPENDENT_MANAGER_REVIEW; ACCEPTANCE_PREP_NOT_STARTED; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~

### 2026-08-30 — W6 acceptance-prep authorization pre-run path-contract blocker

~~~text
timestamp = 2026-08-30
authorization = W6_ACCEPTANCE_PREP_1
baseline = PASS; HEAD e6ae69cbadbbae2ac941899a091e9de6bb9e8eda; parent 5f796620736a4264f1d65e5baec56f55f76685f8; staging empty; tracked worktree contains only this existing Wave 6 Execution Ledger modification
runnerFreeze = PASS; packages/cli/e2e/human-agent-review-wave-6.e2e.mjs has no diff from CODE_EVIDENCE_HEAD; bytes=98051; sha256=105244D354FD9ACABA2EC4FEBD01CCFB67907F8295562CBC6A64499709CE3246; replacement FORMAL recorded the same runner SHA and runHead
desktopBaseline = zero existing <local-path> directories before any attempt
authorizedRootContract = <local-path><new UUID>; Task 11 states the runner uses crypto.randomUUID()
frozenRunnerCall = human-agent-review-wave-6.e2e.mjs imports prepareAcceptance from agent-candidate-composition-wave-5.e2e.mjs and calls prepareAcceptance({ baseDirectory: desktop, prefix: 'surdet-human-review-acceptance-' })
frozenSharedImplementation = agent-candidate-composition-wave-5.e2e.mjs prepareAcceptance creates root with fs.mkdtempSync(path.join(baseDirectory, prefix)); neither frozen file uses crypto.randomUUID() for the acceptance root
blocker = the only authorized command would create an mkdtemp-suffixed root rather than the explicitly required UUID-suffixed root; executing it would knowingly violate the acceptance-root identity contract
acceptancePrepCommand = NOT_RUN
acceptancePrepAttempts = 0/1
acceptancePrepBudget = 1/1 UNCONSUMED
acceptanceRootCreated = NO
artifact = NOT_CREATED
externalAgent = NOT_STARTED
ownerAcceptance = NOT_STARTED
apply = NOT_AUTHORIZED_AND_NOT_RUN
commit = NOT_CREATED
push = NOT_PERFORMED
wave7 = NOT_STARTED
stopState = W6_ACCEPTANCE_PREP_BLOCKED_BEFORE_ATTEMPT; WAITING_FOR_CORRECTED_MANAGER_AUTHORIZATION
~~~

### 2026-08-30 — W6 acceptance-prep path contract manager correction

~~~text
timestamp = 2026-08-30
authorization = W6_ACCEPTANCE_PREP_PATH_CONTRACT_CORRECTION_1
managerDecision = previous pre-run stop was correct and does not count as an acceptance-prep failure
acceptancePrepAttemptsBeforeRun = 0/1
acceptancePrepBudgetBeforeRun = 1/1 UNCONSUMED
taskbookCorrection = Task 11 line 2279 crypto.randomUUID wording is an over-specific implementation description and is superseded for this Wave 6 acceptance-prep execution by this manager record
authoritativeRootContract = frozen runner must use fs.mkdtempSync for atomic creation under <local-path> basename must start with surdet-human-review-acceptance-; suffix must be nonempty and generated by mkdtempSync; root must not exist before the command; root must be new, outside the repository, and must not reuse FORMAL, DIAGNOSTIC, or historical acceptance directories
acceptedFrozenCall = prepareAcceptance({ baseDirectory: desktop, prefix: 'surdet-human-review-acceptance-' })
acceptedFrozenHelper = fs.mkdtempSync(path.join(baseDirectory, prefix))
runnerChange = NOT_AUTHORIZED_AND_NOT_REQUIRED
formalRerun = NOT_AUTHORIZED_AND_NOT_REQUIRED
nextGate = recheck frozen HEAD, runner SHA, staging, exact tracked Ledger-only diff, and zero pre-existing Desktop roots; then run the sole acceptance-prep attempt once
~~~

### 2026-08-30 — W6 unique acceptance-prep pass

~~~text
timestamp = 2026-08-30
authorization = W6_ACCEPTANCE_PREP_PATH_CONTRACT_CORRECTION_1
status = W6_ACCEPTANCE_PREP_PASSED; WAITING_FOR_EXTERNAL_AGENT_COMPARISON_STAGE
acceptancePrepAttempts = 1/1 CONSUMED_AND_PASSED; no rerun performed
command = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=acceptance-prep
commandResult = PREPARED exit 0; evidenceClass ACCEPTANCE_PREP; mode acceptance-prep
acceptanceRoot = <local-path>
acceptanceRootBasename = surdet-human-review-acceptance-jMSfT5
acceptanceRootSuffix = jMSfT5
rootCreationEvidence = pre-run Desktop matching-root count=0 at 2026-08-30T05:33:30.2521287Z; root CreationTimeUtc=2026-08-30T05:33:51.3187554Z; post-run matching-root count=1; new-root set contains exactly this root; ROOT_CREATED_AT_THIS_ATTEMPT=true; ROOT_WAS_ABSENT_BEFORE_RUN=true
rootContract = prefix match=true; suffix nonempty=true; root parent is <local-path> root outside E:/surdet=true; evidence preparationRootOutsideRepository=true; no FORMAL, DIAGNOSTIC, or historical acceptance root reused
projectRoot = <local-path>
dataDir = <local-path>
projectIdentity = 337a7e2f264530c07ee4679a172b2a2d
comparisonReviewRoot = <local-path> NOT_CREATED_BEFORE_EXTERNAL_AGENT as expected
mcpStageConfig = <local-path> bytes=485 sha256=4AF18E88C1CCA944EA187DC38E8926C1BF7C112C8F63F8E4A17717D69003B142; disk identity matches evidence; launcher=E:/surdet/packages/cli/dist/agent-port/main.js; project/dataDir exact; policy=stage
mcpApplyResumeTemplate = <local-path> bytes=346 sha256=5EE09031445077260DDF6DD7C3610E84235E5DB7777D747B36D03B1500E48D3A; disk identity matches evidence; policy=apply; status=NOT_AUTHORIZED; resumeChange=<CHANGE_ID_REQUIRED_AFTER_OWNER_APPROVAL>
evidence = <local-path> bytes=25906 sha256=169559DB17DD5D14FE0A193AC39871046717F1ED1D2834505DDFD7AE4B49C79F
identity = <local-path> bytes=196 sha256=B603CC1E91278DE0CF0392AF558EC10448F0CCCECB3ECEE8A308032D450D33B0; identity path/bytes/SHA exactly match evidence
acceptancePrepLog = <local-path> bytes=801 sha256=08556DE1B494A11DD03BEEEE1B360DEF9988DE24BD622423F2FD76294196D887
projectTree = runner hashTree scope fileCount=37 bytes=6705750 sha256=8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6; fresh disk aggregate matches evidence; missing=0 extra=0 mismatch=0
starterTree = runner hashTree scope fileCount=37 bytes=6705750 sha256=8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6; fresh disk aggregate matches evidence; missing=0 extra=0 mismatch=0; before/after evidence SHA equal
fixtureEquality = PROJECT_FIXTURE_EQUALS_STARTER_AT_PREP=true; fresh project-to-Starter scoped file identity comparison exact=true; ORIGINAL_STARTER_UNCHANGED=true
dataDirFileCountBeforeAgent = 38 exact prep-owned files; disk count matches evidence
prepSourceChanges = four sealed/Open source candidates A/B/C/D; all four are prep-owned and integration=false; non-prep change count=0
toolsCalled = []
changeCreated = NO external/integration change; integrationChangeCreated=false
activeChange = NONE for external/integration stage; the four explicitly reported Open records are prep-owned source candidates, not an Agent-created integration change
comparisonReview = NOT_CREATED_BEFORE_EXTERNAL_AGENT
externalAgent = NOT_STARTED; externalAgentStarted=false; root-bound Node/MCP process count after prep=0
projectMutation = NO; applyAuthorized=false; apply/commit/rollback by external Agent not started or performed
leaseAndErrors = disk lease.json count=0; evidence activeLeaseDirectories=[]; errors=[]; consoleErrors=[]; pageErrors=[]; requestFailures=[]; stderrLines=[]; childCleanupFailures=[]
formalCodeEvidenceHead = e6ae69cbadbbae2ac941899a091e9de6bb9e8eda; outer acceptance runHead and inner prep runHead both equal this HEAD
frozenWave6Runner = bytes=98051 sha256=105244D354FD9ACABA2EC4FEBD01CCFB67907F8295562CBC6A64499709CE3246; outer acceptance runnerSha256 exact match; no diff from CODE_EVIDENCE_HEAD
sharedPrepHelperIdentity = packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs sha256=6A63D4FE415B9190DB8E0CCA9BA06378AA6E7C4B9CA36F00A6041E4E1523E216; inner evidence runnerSha256 identifies this imported helper and is not a Wave 6 runner mismatch
prohibitedActions = no tests, build, preflight, DIAGNOSTIC, FORMAL, verify, code/test edit, commit, push, external Agent, Owner acceptance, isolated apply/resume, or Wave 7
stopState = W6_ACCEPTANCE_PREP_PASSED; ACCEPTANCE_PREP_ATTEMPTS_1_OF_1; WAITING_FOR_EXTERNAL_AGENT_COMPARISON_STAGE; EXTERNAL_AGENT_NOT_STARTED; OWNER_COMPARISON_ACCEPTANCE_NOT_STARTED; OWNER_RESULT_ACCEPTANCE_NOT_STARTED; APPLY_NOT_AUTHORIZED; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~

### 2026-08-30 — W6 external Agent comparison stage pass and manager disk review

~~~text
timestamp = 2026-08-30
stage = EXTERNAL_AGENT_COMPARISON_STAGE
status = PASSED; REVIEW_DECISION_REQUIRED; WAITING_FOR_OWNER_COMPARISON_ACCEPTANCE
serviceReported = Surdet Agent Port (mcp-stage); projectRoot <local-path> policy stage; sessionId agent_00b3125a-cc4a-486e-a6c9-2c8e0bd1a033
agentReportedInitialState = no active change; project and change leases free; manualRecoveryRequired=false
comparisonFingerprint = 1181b28330c67383b1fcdc98d7c180d4726a21a1a7b0d79d876ac7d5a3c7d861
comparisonReviewId = review_comparison_a5eb0885acd3419280ce8807645c8fa9
comparisonReviewRoot = <local-path>
comparisonReviewIdentity = identity.json bytes=539 sha256=FEF67DC901ADA8643EE217E8E486D8F0E5605C224E937555A46E0F459DDA1AD0; identity binds projectIdentity 337a7e2f264530c07ee4679a172b2a2d, expected project revision d63c0e5c32cc9d8d7940a541a2f17d41e1cec7d5c1419e8ab44dce8e9d35ab6f, comparison fingerprint, and payload identity
comparisonReviewPayload = comparison/review.json bytes=69778 sha256=10B2109BEC4946A935A3ECE5BAE5A793FE95C18A034966DD8D83D09336DD4F8C; reviewFingerprint=4ea79d7ef070a611a0838bc5edeef3b508d7d6b84a1637a54a7f886458b2c6ff; state=COMPARISON_PREPARED
sceneIdenticalGroup = groupId 62c7b4112e5efb8cfbe5787e7307110a; object scene:wave5_alpha; finalFingerprint a1b1eea22100625de7e2a8294da4fa4e87a4dced45e32ae5b310a411efe057c9; sourceCount=2; logical A unit 15ed52e1b271a3a90de5ea72fc9f7744 and logical D unit ea4ba4ce0b5502e21f8c50a8e9362052 both retained; includedByDefault=true; collapsedByDefault=true
variableIdenticalGroup = groupId 4a7ebd17a902c58025ca85ec59572ded; object variable:flag.alpha; finalFingerprint c4b8e39708c1350181514172e201d316e6e47e15ef90787022356812cd5afdd1; sourceCount=2; logical A and D sources both retained; includedByDefault=true; collapsedByDefault=true
selectionRequiredConflict = conflictId 7ae0a1c9728b96dd4c8c77a4c6405cfe; code OBJECT_RESULTS_DIVERGE; object scene:wave5_alpha; logical A unit 15ed52e1b271a3a90de5ea72fc9f7744; logical C unit 9cfb1e97c99879c18f09ed943124683e; logical D unit ea4ba4ce0b5502e21f8c50a8e9362052; allowedResolutions choose-unit or exclude-all; canCreateDecision=true
timelineDependency = scene:wave5_beta unit 81d4276321ea05190666bf285c00378c implicitly includes timeline:beta_opening unit fdea2e12ec4dfa301527959cac9c22c4
evidenceBoundary = blockingCount=0; selectionRequiredCount=1; advisoryCount=4; all four source candidates report validation/simulation/runtime missing; this is visible advisory evidence and is not rewritten as fully fresh candidate evidence
displayOrdinalWarning = review workspace canonical display order differs from logical candidate labels: display A=logical B change 32dc8c15; display B=logical C change ae08a4c4; display C=logical D change 96a640a4; display D=logical A change 044dc9a7; Owner decision must anchor on candidateId/unitId, not display letter alone
ownerRecommendedSelectionAnchor = choose logical A scene result by candidateId cand-chg_0001_044dc9a7-da02-4fed-b97e-09c3929d9f9f and unitId 15ed52e1b271a3a90de5ea72fc9f7744; this retains the identical logical D provenance and excludes logical C through an explicit human receipt
managerDiskReview = review payload bytes/SHA and identity binding matched; expected two new review files were present; no decision, approval, return, or receipt file existed; disk lease scan found no active lease directory content
freshMutationReview = isolated project scoped tree remains 37 files / 6705750 bytes with missing=0 extra=0 mismatch=0 against acceptance-prep identity; original examples/starter scoped tree independently remains the same 37 files / 6705750 bytes with missing=0 extra=0 mismatch=0
agentReportedCalls = five MCP calls in order capabilities.describe, session.describe, project.inspect, composition.compare, review.prepare-comparison; final error REVIEW_DECISION_REQUIRED with retryDisposition after-human-review; no composition.plan, composition.execute, integration change, decision, or apply
capabilityReadBoundary = external Agent reported only a visible 2000-character prefix of the large capabilities response; this prevents claiming a full manual reread of that response but does not invalidate the persisted review workspace and downstream semantic evidence used for this stage
gitAfterReview = branch main; HEAD e6ae69cbadbbae2ac941899a091e9de6bb9e8eda; parent 5f796620736a4264f1d65e5baec56f55f76685f8; surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead 12 / behind 0; staging empty; only this append-only Wave 6 Execution Ledger is a tracked worktree modification
prohibitedActions = no decision written by Agent; no plan; no execute; no integration change; no isolated apply/resume; no real-project mutation; no commit; no push; no Wave 7
nextGate = start the Editor entry without changing evidence, then the project owner opens this exact comparison review root, verifies the human-readable comparison, selects logical A by stable candidateId/unitId, saves and reopens the immutable decision receipt, and reports the visual/interaction result
stopState = EXTERNAL_AGENT_COMPARISON_STAGE_PASSED; WAITING_FOR_OWNER_COMPARISON_ACCEPTANCE; OWNER_RESULT_ACCEPTANCE_NOT_STARTED; APPLY_NOT_AUTHORIZED; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~

### 2026-08-30 — W6 Owner Comparison screenshot review: semantic receipt pass, human-readability needs fix

~~~text
timestamp = 2026-08-30
gate = OWNER_COMPARISON_ACCEPTANCE
ownerEvidenceClass = OWNER_REPORTED_REAL_CHROME_OR_EDGE_SCREENSHOTS plus manager disk readback; screenshots are accepted for visible layout and interaction facts but do not replace disk receipt identity checks
screenshotInitial = <local-path> bytes=145534 sha256=FAA04436F05CE027088B767B1E88C1F419F47E05E9C936BC00DAC1215C0D294C
screenshotTechnical = <local-path> bytes=194538 sha256=0930BA68F21262507C4F8292D31D9AA74D006F01FC8A75C486D07B911C72D13F
screenshotReopened = <local-path> bytes=179522 sha256=0CD0D86E8F07CEAF232BCDF0F99AA346BF2CC9FD3519DE67743D6062265C7240
visibleFactsPassed = Editor review tab opened the exact comparison workspace; four candidate buttons are present; scene and variable each show 2 candidates with identical results; scene wave5_beta -> timeline beta_opening appears as an automatic dependency; selection-required conflict presents three choose-unit options plus exclude-all; technical details expose reviewId/codes/fingerprint/source capsule identities; reopened screenshot shows 已读取已保存的决定 and 决定已保存; safe-group expansion preserves two source cards
decisionReceipt = <local-path> bytes=1909 sha256=6FCB288CE32777EC3E01288B4BDFF05B1F1B3321B47D25C48D241FE26907085D
decisionIdentity = decisionId 906870cc-9827-4960-8157-c4eca7a90a96; decisionFingerprint 956d0404ac3411122ed008db19ef5b97b7f8d230f0b898ae034f56483fa32b19; review/comparison/project/revision identities match the frozen comparison workspace
decisionSelection = conflict 7ae0a1c9728b96dd4c8c77a4c6405cfe resolved choose-unit with chosenUnitId ea4ba4ce0b5502e21f8c50a8e9362052, the logical D / display C scene source; logical C divergent unit 9cfb1e97c99879c18f09ed943124683e is not selected
equivalentResultJudgment = chosen logical D has the same scene finalFingerprint a1b1eea22100625de7e2a8294da4fa4e87a4dced45e32ae5b310a411efe057c9 as logical A; the persisted safe group continues to retain both logical A and D provenance, so this does not damage the intended semantic result and does not require deleting or rewriting the immutable receipt
freshDiskSafety = isolated project source tree mismatch count=0; original examples/starter source tree mismatch count=0; only four prep source change directories exist; lease.json count=0; no integration plan/execute/apply evidence exists
ownerVisibleIssue1 = default task title remains English Candidate composition review in the header and task panel, failing Task 11.3 step 4 requirement that the default task goal be presented in Chinese
ownerVisibleIssue2 = canonical display ordinals are remapped relative to the taskbook logical A/B/C/D labels and the default UI does not explain that mapping; a project owner can select an equivalent but differently sourced unit without knowing it, as the persisted choice of display C/logical D demonstrates
ownerVisibleIssue3 = conflict option cards show only ordinal, object ref, disposition, missing evidence, and empty impacts; they do not provide a human-readable content difference between Alpha route A and Alpha route C, so a nontechnical reviewer cannot make an informed creative choice without external instructions or raw technical IDs
managerVerdict = SEMANTIC_DECISION_RECEIPT_AND_REOPEN_PASS; OWNER_COMPARISON_HUMAN_READABILITY_NEEDS_FIX; do not claim full OWNER_COMPARISON_ACCEPTANCE_PASSED
nextGate = bounded Editor/shared-review presentation correction for localized meaningful task wording and stable, human-readable candidate/result identity; preserve the immutable decision and historical screenshots; establish proportional RED/GREEN and rerun only the owner comparison UI path before allowing the external Agent second stage
prohibitedActions = no composition.plan; no composition.execute; no result review; no isolated apply/resume; no push; no Wave 7
stopState = OWNER_COMPARISON_FUNCTIONAL_PATH_PASSED; OWNER_COMPARISON_HUMAN_READABILITY_NEEDS_FIX; EXTERNAL_AGENT_SECOND_STAGE_NOT_AUTHORIZED; OWNER_RESULT_ACCEPTANCE_NOT_STARTED; APPLY_NOT_AUTHORIZED; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~

### 2026-08-30 — W6 manual Editor port isolation correction

~~~text
timestamp = 2026-08-30
trigger = another local project independently proved that TCP 4173 was occupied by E:/surdet Editor Vite after its own process cleanup; the Surdet listener was no longer needed on that shared port
ownershipVerification = TCP 127.0.0.1:4173 PID 84660; command line was E:/surdet/packages/editor/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173
stopAction = stopped only the known Surdet Editor unified execution session; no Jiuan or unrelated process was terminated
postStop = TCP 4173 listener count 0
replacementPort = 4175
replacementCommand = npm run dev -w surdet-editor -- --host 127.0.0.1 --port 4175
replacementVerification = HTTP 200; title Surdet 剧本编辑器; TCP 4175 listener count 1; PID 73132; command line binds E:/surdet/packages/editor Vite to 127.0.0.1:4175
operationalConvention = for the remainder of this Wave 6 manual review, use http://127.0.0.1:4175/; do not assume or reclaim 4173; automated runners retain their own launcher-managed ports and this operational change does not alter production code or frozen evidence
gitAndScope = no production/test/package configuration changed; only this existing append-only Execution Ledger remains modified and unstaged; no commit or push
~~~

### 2026-08-30 — W6 Owner review comprehensibility repair taskbook issued

~~~text
timestamp = 2026-08-30
managerDecision = the comparison semantic path, immutable decision save/reopen, A/D provenance, C explicit conflict, B implicit dependency, project non-mutation, and original Starter non-mutation remain accepted historical facts; full Owner comparison acceptance remains blocked only on human comprehensibility
taskId = W6-OWNER-REVIEW-COMPREHENSIBILITY-1
taskbook = docs/superpowers/plans/2026-08-30-wave-6-owner-review-comprehensibility-repair.md
taskbookPurpose = mechanically project typed candidate manifest content into a shared human-readable review presentation; localize the generated fallback title; explain that display ordinals are review-local; show A/C content differences without requiring technical IDs; preserve technical detail drill-down and exact receipt binding
architectureDecision = @surdet/authoring owns deterministic typed presentation summaries; CLI only passes verified manifest facts; Editor only renders the shared projection; no second parser, raw JSON dump, model-generated prose, or comparison/plan duplication
compatibilityDecision = existing jMSfT5 review workspace, three Owner screenshots, and decision receipt remain immutable historical evidence; new presentation fields are additive; old v1 payloads must stay readable without migration or rewrite
evidenceDecision = use focused Authoring/CLI/Editor RED-GREEN, affected workspace gates, one small dedicated E2E runner, up to two focused DIAGNOSTIC executions, and one frozen-head focused FORMAL; verify:all and default parallel CLI full are not authorized for this bounded repair
acceptanceDecision = after focused FORMAL, a new acceptance-prep and new external Agent comparison stage each require explicit Owner authorization; Owner retest uses http://127.0.0.1:4175/ and Surdet must not reclaim 4173
ledgerDecision = this existing Wave 6 Execution Ledger remains the only rolling ledger; the new repair taskbook must not create a second execution ledger; long-term roadmap remains untouched until reviewed Wave 6 closure
implementationStatus = NOT_STARTED; taskbook is READY_FOR_OWNER_DISPATCH; generating the taskbook is not automatic code authorization
prohibitedActions = no composition.plan, composition.execute, result review, isolated apply/resume, push, Wave 7, receipt rewrite, old acceptance reuse, or protected-file changes
stopState = OWNER_COMPARISON_FUNCTIONAL_PATH_PASSED; OWNER_COMPARISON_HUMAN_READABILITY_NEEDS_FIX; W6_OWNER_REVIEW_COMPREHENSIBILITY_TASKBOOK_READY; EXTERNAL_AGENT_SECOND_STAGE_NOT_AUTHORIZED; APPLY_NOT_AUTHORIZED; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~

### 2026-08-30 — W6 Owner review comprehensibility repair Task 0 baseline

~~~text
timestamp = 2026-08-30
taskId = W6-OWNER-REVIEW-COMPREHENSIBILITY-1
ownerDispatch = APPROVED by direct handoff of docs/superpowers/plans/2026-08-30-wave-6-owner-review-comprehensibility-repair.md and instruction 开工吧
taskbookIdentityBeforeWork = bytes 32022; sha256 67A6E836C12193EF3887E4B4D5D4D8813B08002839A977133DC4406247A4A76C
branch = main
HEAD = e6ae69cbadbbae2ac941899a091e9de6bb9e8eda
HEADParent = 5f796620736a4264f1d65e5baec56f55f76685f8
surdet/main = f8943c293c4537b3867cc8eeea316b19bb4a0b40
aheadBehind = ahead 12 / behind 0
trackedBaseline = only docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md; no tracked code diff
stagingBaseline = empty
untrackedBaseline = 967 files; the new repair taskbook accounts for one file beyond the previously recorded 966-file historical untracked set; all unrelated and protected untracked paths preserved
historicalScreenshots = initial bytes 145534 sha256 FAA04436F05CE027088B767B1E88C1F419F47E05E9C936BC00DAC1215C0D294C; technical bytes 194538 sha256 0930BA68F21262507C4F8292D31D9AA74D006F01FC8A75C486D07B911C72D13F; reopened bytes 179522 sha256 0CD0D86E8F07CEAF232BCDF0F99AA346BF2CC9FD3519DE67743D6062265C7240; all exact Ledger identities preserved
historicalReviewRoot = <local-path>
historicalReviewPayload = comparison/review.json bytes 69778 sha256 10B2109BEC4946A935A3ECE5BAE5A793FE95C18A034966DD8D83D09336DD4F8C; reviewFingerprint 4ea79d7ef070a611a0838bc5edeef3b508d7d6b84a1637a54a7f886458b2c6ff; comparisonFingerprint 1181b28330c67383b1fcdc98d7c180d4726a21a1a7b0d79d876ac7d5a3c7d861
historicalReviewIdentity = identity.json bytes 539 sha256 FEF67DC901ADA8643EE217E8E486D8F0E5605C224E937555A46E0F459DDA1AD0
historicalDecisionReceipt = decision.json bytes 1909 sha256 6FCB288CE32777EC3E01288B4BDFF05B1F1B3321B47D25C48D241FE26907085D; decisionId 906870cc-9827-4960-8157-c4eca7a90a96; decisionFingerprint 956d0404ac3411122ed008db19ef5b97b7f8d230f0b898ae034f56483fa32b19; chosenUnitId ea4ba4ce0b5502e21f8c50a8e9362052
historicalEvidencePolicy = screenshots, review payload, identity, and decision are immutable; no delete, move, rewrite, migration, or acceptance-root reuse
sourceTrace = ReviewService.prepareComparison -> composition.compare returns verified candidates/manifests -> candidateIntent projects only intent/criteria -> buildComparisonReviewProjection -> projectUnitOutcome currently drops manifest normalizedInput -> reviewFingerprintPayload -> NodeReviewStore create-only payload -> Editor openReviewWorkspace -> renderComparisonReview; confirmed human presentation gap is in the authorized shared projection and Editor rendering layers
port4173 = FREE; Surdet listener count 0
port4175 = HTTP 200 title Surdet 剧本编辑器; PID 73132; command line E:/surdet/packages/editor/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175; left running unchanged
task0StopConditions = none observed; remote not behind; staging empty; no unauthorized tracked code; historical evidence identities unchanged; no decision overwrite required
authorizedNext = Task 1 permanent RED only; first code edits must be tests
prohibitedStill = no composition.plan; no composition.execute; no result review; no isolated apply/resume; no acceptance-prep; no external Agent; no Owner retest; no push; no Wave 7
~~~

### 2026-08-30 — W6 Owner review comprehensibility permanent RED

~~~text
timestamp = 2026-08-30
task = Task 1 permanent RED; tests edited before production source
evidenceRoot = <local-path>
authoringRedCommand = npm run test -w @surdet/authoring -- review-projection.test.ts review-receipts.test.ts
authoringRed = exit 1; 33 tests collected; 29 passed / 4 failed; path 02-authoring-red.log; bytes 6094; sha256 69EBF56835BB88C480CC13F1DAEEF0FC51B9DF3ECAA91669DA72CA8A9B7A742C
authoringRedNodes = missing typed A/C presentation; missing metadata-only fallback; presentation changes do not change reviewFingerprint; generated fallback remains Candidate composition review
cliRedCommand = npm run test -w @surdet/cli -- review-service.test.ts
cliRed = exit 1; 8 tests collected; 7 passed / 1 failed; path 04-cli-red.log; bytes 2478; sha256 D2F63E13D466FC26649B8531B30BB9C63C8E2E2B392E7D63F6357B38D91B2B5F
cliRedNode = ReviewService prepared comparison contains no shared A content summary; expected Alpha route A., received empty presentation
editorRedCommand = npm run test -w surdet-editor -- review-model.test.ts review-panel.test.ts review-workspace.test.ts
editorRed = exit 1; 38 tests collected; 35 passed / 3 failed; path 05-editor-red.log; bytes 7852; sha256 83FF627E2711B1B37D385D7ACABE6732066DC8D920F7700F6C434AD72444FD69
editorRedNodes = review-local ordinal explanation absent; conflict option ignores shared action/highlights; legacy payload has no explicit content-summary-insufficient marker
redHarness = VALID; all three workspaces collected the intended files and failed product assertions; no module/import/build/dist/fixture timeout failure
nonAuthoritativeSetupLogs = 01-authoring-red.log and 03-cli-red.log preserved in the same evidence root; each exposed a test-selection/assertion-reporting issue and was corrected before the authoritative RED logs; neither is represented as product RED evidence
unchangedContractsObserved = legacy authoring receipt tests 21/21 passed; Editor review-workspace tests 24/24 passed; exact decision write/reopen and terminal receipt paths remained green during RED
productionSourceStatus = NOT_MODIFIED before RED capture
authorizedNext = minimal shared presentation implementation, CLI manifest pass-through, and Editor rendering within the repair whitelist
~~~

### 2026-08-30 — W6 Owner review comprehensibility minimal GREEN and Task 6 gates

~~~text
timestamp = 2026-08-30
taskId = W6-OWNER-REVIEW-COMPREHENSIBILITY-1
implementation = @surdet/authoring now derives bounded deterministic Chinese ReviewUnitPresentation from the eight typed CompositionOperation normalizedInput contracts; buildComparisonReviewProjection binds that presentation into safe-group sources, conflict options, and reviewFingerprint; CLI only passes each verified manifest; Editor renders shared action/object/highlights, review-local ordinal guidance, lazy technical identity, and an explicit metadata-only legacy marker
architectureBoundary = no second CLI/Editor summary parser; no raw normalizedInput or output-file parsing; no model prose; no comparison/plan/state-machine duplication; no receipt write/reopen behavior change; no migration or rewrite of v1 review payloads
focusedGreen1 = 06-authoring-focused-green.log exit 0; 33/33 tests passed; bytes 442; sha256 F8285EA65EB4D163DCE4053200CD6B075413DB93E9AF8562C99A360C795B4169
focusedCliStaleDistEvidence = 07-cli-focused-green.log exit 1; bytes 2477; sha256 28538882D20FC0F429525992C39F7BEA07C5746186844EDBC06AFCD7DA9AE68E; CLI resolved the pre-build Authoring dist and therefore observed no new presentation; preserved as sequencing evidence, not represented as a production-contract failure
focusedGreen2 = after the required Authoring build, 08-cli-focused-green.log exit 0; 8/8 tests passed; bytes 981; sha256 9FA9BAC626334186F611289E7B00460440FE7E3B2FBEE3A545722C77FF3560F7
focusedEditorFixtureEvidence = 09-editor-focused-green.log exit 1; bytes 3627; sha256 9872F124DE31E95F3E84F9719E6D178712890C0E1FB7295EDE955DD9949CDFBC; one authorized test expected the former D impact text after D was intentionally made A-equivalent; corrected only that stale expectation
focusedGreen3 = 10-editor-focused-green.log exit 0; 38/38 tests passed; bytes 514; sha256 C26F0BEB945D8793526663F11682EE6050A47E345210633F15FD03E981F58CA7
presentationMatrixGreen = 11-authoring-presentation-matrix-green.log exit 0; 43/43 tests passed; bytes 442; sha256 56C99BD3C1F7EF652CBF92ACE4F004BDA6160421CBD17E9AD3B9FB2165840C10; covers all eight capabilities, deterministic ordering, bounded facts with explicit omission count, metadata-only fallback, and legacy fingerprint recomputation
task6AuthoringFocused = 12-task6-authoring-focused.log exit 0; 43/43 tests passed; bytes 442; sha256 98052687A58A61C55E2BE15EA30C59A550F5E4A38DE9B5314022BC013035678F
task6AuthoringTypecheckFirst = 13-task6-authoring-typecheck.log exit 2; bytes 1736; sha256 DF63F5A28ECFE385BD046B516417F1BB920CC91EB8CDDE29B25CEBE0D8F0A818; only failure was a readonly tuple inference in the newly authorized parameterized test, with no production diagnostic
task6AuthoringTypecheckReplacement = 14-task6-authoring-typecheck-green.log exit 0; bytes 74; sha256 9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78; fixed by an explicit mutable CompositionOperation normalizedInput case type without public-contract change
task6AuthoringBuild = 15-task6-authoring-build.log exit 0; bytes 67; sha256 D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9
task6AuthoringFull = 16-task6-authoring-full.log exit 0; 30/30 files and 260/260 tests passed; bytes 1834; sha256 366B7B7F10F799EFC4EA4404F53FDA8653473ADFF839FAF0C2AB63083809D3A9; full-test budget consumed once and passed
task6CliFocused = 17-task6-cli-focused.log exit 0; 8/8 tests passed; bytes 1099; sha256 341C35F93C8FB501B509435143F06D88922894CA99E62C8551FF30DBDB817F08
task6CliTypecheck = 18-task6-cli-typecheck.log exit 0; bytes 68; sha256 AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917
task6CliBuild = 19-task6-cli-build.log exit 0; bytes 61; sha256 898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E
task6EditorFocused = 20-task6-editor-focused.log exit 0; 39/39 tests passed; bytes 514; sha256 E2F34D89C2D9CEA8499350B2699C6C939EA5A711361A2769908D043B57920C9E
task6EditorTypecheck = 21-task6-editor-typecheck.log exit 0; bytes 70; sha256 6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3
task6EditorBuild = 22-task6-editor-build.log exit 0; bytes 1998; sha256 3EFB11EA08363CB3491D044F1BE95568CE4190D50784D03D039D80BA944713CC
task6EditorFull = 23-task6-editor-full.log exit 0; 32/32 files and 222/222 tests passed; bytes 1860; sha256 526469453875A8963A064F0ECD4B9CE5C8C051FC94B8633218E497B012CB81C1; full-test budget consumed once and passed
task6DiffCheck = 24-task6-git-diff-check.log exit 0; bytes 1787; sha256 F5ED52711FB3E951505058455F1511B57235639CDEA608D09FC0FFA4912F77E5; only Git line-ending warnings, no whitespace error
task6CachedDiffCheck = 25-task6-git-diff-cached-check.log exit 0; bytes 48; sha256 918DCA930CFB8B1843D71E1F5D2FFA7DB2A7E833EE467DF85B3AB3F27AFB6E7A; staging remained empty
historicalEvidenceRecheck = jMSfT5 comparison/review.json bytes 69778 sha256 10B2109BEC4946A935A3ECE5BAE5A793FE95C18A034966DD8D83D09336DD4F8C; identity.json bytes 539 sha256 FEF67DC901ADA8643EE217E8E486D8F0E5605C224E937555A46E0F459DDA1AD0; decision.json bytes 1909 sha256 6FCB288CE32777EC3E01288B4BDFF05B1F1B3321B47D25C48D241FE26907085D; all unchanged after implementation
unauthorizedGates = verify:all NOT RUN; default-parallel CLI full NOT RUN; CLI full NOT RUN; acceptance-prep NOT RUN; external Agent NOT STARTED; Owner retest NOT STARTED
authorizedNext = Task 7 dedicated focused runner contract RED, runner implementation, one preflight, then at most two focused DIAGNOSTIC runs under the taskbook budget
~~~

### 2026-08-30 — W6 Owner review comprehensibility focused runner and preflight

~~~text
timestamp = 2026-08-30
taskId = W6-OWNER-REVIEW-COMPREHENSIBILITY-1
runner = packages/cli/e2e/owner-review-comprehensibility-wave-6.e2e.mjs
runnerTest = packages/cli/test/owner-review-comprehensibility-wave-6-runner.test.mjs
runnerScope = dedicated 11-node comparison-only evidence runner; formal CLI dist plus Editor build; fresh system-temp A/B/C/D fixtures; no modification or reuse of the historical 22-node runner/artifacts
runnerContractRed = 26-focused-runner-contract-red.log exit 1; 5 tests collected / 0 passed / 5 failed at fixed modes and budgets, complete evidence predicate, blocking channel classification, formal product path, and frozen-head assertions; bytes 9056; sha256 4C74AFAE7D4559D1B69BCAEDB2DEEDD982433D75ACD4E1A5A398712FDD76143D
runnerRedQuality = import and syntax were valid; failures were explicit not-implemented evidence contracts rather than missing module, fixture, build artifact, spelling, or timeout
runnerContractGreen = 27-focused-runner-contract-green.log exit 0; 5/5 tests passed; bytes 695; sha256 750CCF2C48B4F356D84ABFD8DC78DF8F4003EDA660E6F228A6F7F6A25C55BF54
runnerNodeCheck = 28-focused-runner-node-check.log exit 0; bytes 98; sha256 FFACEDBF4987A9B673418648D96DA2C85BFF12F423ECA14D85BBCEEE02E7F38E
runnerForbiddenCallAudit = no focused-runner callTool site for composition.plan, composition.execute, or change.commit; only composition.compare and review.prepare-comparison are allowed in the diagnostic/formal workflow
preflightBudget = 1/1 CONSUMED_AND_PASSED; no rerun authorized or performed
preflightCommand = node packages/cli/e2e/owner-review-comprehensibility-wave-6.e2e.mjs --mode=preflight
preflightLog = 29-focused-preflight.log exit 0; bytes 22169; sha256 8CD109B26AD24F1DC1E74BDA212C6C521505F5646A1FE5C002F08FDE200BEAD6
preflightArtifact = <local-path> bytes 30039 sha256 03E01EB12ED32E2C997C5D610F47143D21A8E76C257D200CAD01D591589F1C51
preflightIdentity = <local-path> bytes 236 sha256 093667721CAE592CB524B1A053822E4ABF23E58F1D52DA063EC7160ADFD0814B
preflightRunHead = e6ae69cbadbbae2ac941899a091e9de6bb9e8eda
preflightRunnerSha256 = AF932BB8C5061A12CAED0CC935EFB25C20DFAF53F9CE9F06F8271717AF1ADE1F
preflightProductPaths = E:/surdet/packages/cli/dist/agent-port/main.js; E:/surdet/packages/editor/dist/index.html; E:/surdet/packages/editor/dist/preview.html
preflightLauncher = MCP SDK listed 16 observe-policy tools; contractVersion 2.1.0; comparison and comparison-review tools present; capabilities.describe, session.describe, and project.inspect succeeded through the formal dist launcher
preflightEditor = Vite preview served the built Editor entry with HTTP 200 and the expected Surdet editor title; child stdout 37 bytes was captured and not forwarded into runner stdout
preflightPurityAndCleanup = protocolErrors=[]; consoleErrors=[]; pageErrors=[]; requestFailures=[]; stderrLines=[]; childCleanupFailures=[]; activeLeaseDirectories=[]; blockingIssueChannels=[]
preflightTrees = fixture before/after and original Starter before/after each fileCount 37 bytes 6705750 sha256 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6; fixture unchanged=true; original Starter unchanged=true
preflightGit = staging empty; 13 tracked whitelist paths reported dirty as expected before code-evidence freeze; focused runner/test and repair taskbook remained authorized untracked inputs
diagnosticBudget = 0/2 consumed; up to two focused runs remain, and a second run is permitted only after a first-run failure is statically understood and fixed within the whitelist
prohibitedStill = no verify:all; no CLI full; no acceptance-prep; no external Agent; no Owner retest; no plan; no execute; no apply; no push; no Wave 7
authorizedNext = focused DIAGNOSTIC attempt 1/2
~~~

### 2026-08-30 — W6 Owner review comprehensibility focused DIAGNOSTIC attempt 1

~~~text
timestamp = 2026-08-30
taskId = W6-OWNER-REVIEW-COMPREHENSIBILITY-1
diagnosticBudget = attempt 1/2 CONSUMED_AND_FAILED; at most one attempt remains after a corresponding runner RED/GREEN
command = node packages/cli/e2e/owner-review-comprehensibility-wave-6.e2e.mjs --mode=diagnostic
log = <local-path> exit 1 bytes 20932 sha256 EB0CF1576CCD8C3566271497A62A8CC723DA8F987BACDD6EADB8284CE6091DEB
artifact = <local-path> bytes 22361 sha256 B9822A8B3EA57AF448B18103F54B4B00B3EF709CD72129E119252ABCF8E9FB9A
identity = <local-path> bytes 237 sha256 49B16EBB00BC937667B4DE5B0C7D178EBCD3AC8DF30CB46CA0CAD80A0FA52C1D
runHead = e6ae69cbadbbae2ac941899a091e9de6bb9e8eda
runnerSha256 = AF932BB8C5061A12CAED0CC935EFB25C20DFAF53F9CE9F06F8271717AF1ADE1F
status = FAILED; lastPassedNode review-ordinal-explained; firstFailedNode identical-provenance-visible; milestones 4 PASSED / 1 FAILED / remaining not run
firstFailure = runner expected the safe-group source card exact text 方案 A（本次审阅编号）, while the product correctly renders the candidate-list label with that suffix and the expanded provenance source card with the concise stable display label 方案 A
failureClassification = RUNNER_LOCATOR_PROJECTION_ERROR; not a product presentation, provenance, identity, receipt, lease, timeout, launcher, or cleanup failure
productEvidenceVisibleAtFailure = localized title 候选创作方案审阅 visible; review-local ordinal explanation visible; candidate list contains all four 本次审阅编号 labels; expanded A/D group says 内容结果相同，保留 2 个来源 and visibly contains two source cards with Alpha route A.; A/C conflict options visibly contain distinct Alpha route A. and Alpha route C. text
channels = errors=[single runner assertion]; protocolErrors=[]; consoleErrors=[]; pageErrors=[]; requestFailures=[]; stderrLines=[]; childCleanupFailures=[]; activeLeaseDirectories=[]
toolsCalled = surdet_composition_compare, surdet_review_prepare_comparison only; prohibitedToolCalls=[]
decisionAndMutationBoundary = failure occurred before decision write; no decision/final approval/return receipt in the fresh comparison root; project/Starter unchanged milestones were not reached and therefore are not represented as passed by this artifact
authorizedCorrection = add a permanent pure runner contract for concise provenance source labels, then change only the focused runner locator from candidate-list exact text to the actual source-card label; rerun runner contract and node check before deciding whether attempt 2 is permitted
prohibitedStill = no immediate diagnostic rerun; no FORMAL; no acceptance-prep; no external Agent; no plan; no execute; no apply; no push; no Wave 7
~~~

### 2026-08-30 — W6 focused runner provenance-label correction after DIAGNOSTIC 1

~~~text
timestamp = 2026-08-30
taskId = W6-OWNER-REVIEW-COMPREHENSIBILITY-1
correctionClass = RUNNER_ONLY; no production, shared contract, receipt, fixture, timeout, dependency, or build change
rootCause = candidate-list labels intentionally include （本次审阅编号）, while expanded provenance cards use the concise review-local source label 方案 <displayOrdinal>; DIAGNOSTIC 1 used the candidate-list exact label in the source-card locator
permanentRed = 31-runner-source-label-red.log exit 1; 6 tests collected / 4 passed / 2 failed at missing exported reviewSourceLabel and missing runner use; bytes 25920; sha256 E80B606ECA44FE88CF67CD4E35EAD2027823B52982EF6A8EBBDC93A6CD86127F
minimalFix = export pure reviewSourceLabel(displayOrdinal) => 方案 <displayOrdinal> and use that exact label only inside identical-provenance-visible; candidate-list and ordinal explanation assertions remain unchanged
replacementGreen = 32-runner-source-label-green.log exit 0; 6/6 tests passed; bytes 783; sha256 BAF269519BA44C0BAAE1831273120495A2756BC5D711C21C6EF24534A762FB72
nodeCheck = 33-runner-source-label-node-check.log exit 0; bytes 98; sha256 FFACEDBF4987A9B673418648D96DA2C85BFF12F423ECA14D85BBCEEE02E7F38E
correctedRunnerIdentity = bytes 54721 sha256 7DE80DA41458C0EB985FB1CA9F7921D926C6F2585ADFA707461703CC8A27143B
staticRecheck = git diff --check exit 0; only line-ending warnings; no whitespace failure
preflight = NOT_RERUN; unique 1/1 preflight remains consumed and passed under the prior runner identity, and the correction does not alter launcher/preflight code paths
diagnosticBudget = attempt 1 failed and preserved; attempt 2/2 now authorized by the taskbook because the runner defect has a corresponding permanent RED and GREEN
prohibitedStill = no tests/full gates rerun beyond the runner contract; no FORMAL before attempt 2 passes; no acceptance-prep; no external Agent; no plan; no execute; no apply; no push; no Wave 7
~~~

### 2026-08-30 — W6 Owner review comprehensibility focused DIAGNOSTIC attempt 2 and stop

~~~text
timestamp = 2026-08-30
taskId = W6-OWNER-REVIEW-COMPREHENSIBILITY-1
diagnosticBudget = attempt 2/2 CONSUMED_AND_FAILED; BUDGET_EXHAUSTED; no third run authorized
command = node packages/cli/e2e/owner-review-comprehensibility-wave-6.e2e.mjs --mode=diagnostic
log = <local-path> exit 1 bytes 22314 sha256 8270893E88B9F6B1A463F017187E9654BC1F97946E94272D9FF5FD8DC4585C87
artifact = <local-path> bytes 24075 sha256 558943584B3AE9A25020B1B9B9FE7A31AAF6F30E092F35722CDDBFA4F322702E
identity = <local-path> bytes 237 sha256 E70FD16A5FA8D33258E799A07F9009D77B7C44B7E729D9B8EE3B659500BAE4CE
runHead = e6ae69cbadbbae2ac941899a091e9de6bb9e8eda
runnerSha256 = 7DE80DA41458C0EB985FB1CA9F7921D926C6F2585ADFA707461703CC8A27143B
status = FAILED; lastPassedNode identical-provenance-visible; firstFailedNode conflict-content-distinguishable; milestones 5 PASSED / 1 FAILED / remaining not run
passedEvidence = formal CLI dist created a fresh comparison workspace; localized task title visible; review-local ordinal explanation visible; A/D identical scene group visibly preserved exactly two sources and Alpha route A. content
firstFailure = runner read only the conflict choice button innerText and required Alpha route A./C. there; the button intentionally uses the first bounded highlight 段落标记：start, while the same default-visible option card immediately below contains lynn：Alpha route A. or lynn：Alpha route C.
failureClassification = RUNNER_EVIDENCE_SCOPE_TOO_NARROW is strongly supported by the captured DOM text; the artifact itself shows distinct A/C content in the default-visible option cards, but no further runner correction or execution is authorized after attempt 2
channels = errors=[single runner assertion]; protocolErrors=[]; consoleErrors=[]; pageErrors=[]; requestFailures=[]; stderrLines=[]; childCleanupFailures=[]; activeLeaseDirectories=[]
toolsCalled = surdet_composition_compare, surdet_review_prepare_comparison only; prohibitedToolCalls=[]
receiptBoundary = failure occurred before decision write; browser receipt snapshot count 0; no decision, final approval, or return receipt was generated in this fresh workspace
unverifiedByAttempt2 = technical-details-lazy, exact-unit decision save, decision reopen readonly, project-and-starter-unchanged, and cleanup-and-identity fixed milestones did not execute and cannot be represented as passed by this artifact
gitStop = HEAD e6ae69cbadbbae2ac941899a091e9de6bb9e8eda; parent 5f796620736a4264f1d65e5baec56f55f76685f8; staging empty; no commit created; authorized tracked work remains unstaged; unrelated historical untracked paths preserved
formal = NOT_RUN; formal budget remains unconsumed but is blocked because focused DIAGNOSTIC did not pass
prohibitedActionsObserved = no diagnostic rerun beyond 2/2; no FORMAL; no commit; no acceptance-prep; no external Agent; no Owner retest; no plan; no execute; no apply; no push; no Wave 7
stopState = W6_OWNER_REVIEW_COMPREHENSIBILITY_DIAGNOSTIC_BUDGET_EXHAUSTED; FORMAL_NOT_RUN; WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
~~~

### 2026-08-30 — W6 owner-review runner evidence-scope recovery and DIAGNOSTIC pass

~~~text
timestamp = 2026-08-30
authorizationId = W6-OWNER-REVIEW-COMPREHENSIBILITY-RUNNER-SCOPE-RECOVERY-1
authorizationClass = NEW_INDEPENDENT_RECOVERY; not a reset or rewrite of the original focused DIAGNOSTIC budget
historicalDiagnostics = ORIGINAL_FOCUSED_DIAGNOSTICS 2/2 CONSUMED_AND_FAILED; attempt 1 firstFailedNode identical-provenance-visible; attempt 2 firstFailedNode conflict-content-distinguishable; both artifacts remain immutable and are not reclassified as PASS
historicalArtifactRecheck = diagnostic-zudvms evidence bytes 22361 sha256 B9822A8B3EA57AF448B18103F54B4B00B3EF709CD72129E119252ABCF8E9FB9A and identity bytes 237 sha256 49B16EBB00BC937667B4DE5B0C7D178EBCD3AC8DF30CB46CA0CAD80A0FA52C1D unchanged; diagnostic-jsZX5u evidence bytes 24075 sha256 558943584B3AE9A25020B1B9B9FE7A31AAF6F30E092F35722CDDBFA4F322702E and identity bytes 237 sha256 E70FD16A5FA8D33258E799A07F9009D77B7C44B7E729D9B8EE3B659500BAE4CE unchanged
scope = runner and permanent runner-contract test only; no Authoring, CLI, Editor, fixture, DOM, copy, receipt, fingerprint, timeout, dependency, build, product-test, or other milestone modification
rootCause = conflict-content-distinguishable read only [data-choice-unit] button innerText as full conflict content; the authoritative default-visible dialogue belongs to the exact-unit [data-choice-option-unit] card
nonAuthoritativeCaptureSetup = 35-runner-card-scope-red.log bytes 109 sha256 2611A2F011A5349D41876CD4852AEEEFF14330DCE296391FEDBD9BD26B06F7C6; PowerShell Tee-Object parameter binding failed before any TAP or native exit code was produced; preserved as a logging setup error and not represented as a RED or a test invocation
permanentRed = 36-runner-card-scope-red.log exit 1; 7 tests collected / 5 passed / 2 failed; failures were the old aText/cText evidence predicate and absence of exact-unit card plus nested-button locators; bytes 5340 sha256 C5873056AF9A18E9C847D986A2E963D09F380BB7682FA71B2550645F2E3534CA
redQuality = valid contract RED; module import, syntax, environment, fixture, build output, spelling, and timeout were not failure causes
minimalFix = conflict-content-distinguishable now reads A/C full card text from exact [data-choice-option-unit="<unitId>"] locators, reads nested [data-choice-unit="<unitId>"] button text separately, verifies both buttons visible and enabled with meaningful action copy, and serializes aCardText/cCardText/aButtonText/cButtonText plus stable A/C unitIds and distinguishable=true
runnerContractGreen = 37-runner-card-scope-green.log exit 0; 7/7 tests passed; bytes 903 sha256 31398EC92B2C5DAA4307A34EDBD69DE0AAD924205DAF4D87D29DA415433AE5C8
nodeCheck = 38-runner-card-scope-node-check.log exit 0; bytes 102 sha256 D5B2B2263323AC0974B80864099A454AB7E68E70D2187B3458055FD0C0F6B8A6
diffCheck = 39-runner-card-scope-diff-check.log exit 0; bytes 1830 sha256 27B8BD7DA45E7695B43F42E1B4B6208B7F1F06A64F1176DB438A056680FFFF1D; only Git line-ending warnings
cachedDiffCheck = 40-runner-card-scope-cached-check.log exit 0; bytes 52 sha256 BE65DCF1DB451102289BA4CFA02C556E30B8B87726CA06C4521175022A6E8653; staging remained empty
productAndLauncherGates = NOT_RERUN; no Authoring/CLI/Editor full test, typecheck, build, verify:all, historical Wave 6 runner, or launcher preflight was rerun
recoveryDiagnosticBudget = 1/1 CONSUMED_AND_PASSED; no second recovery diagnostic authorized or performed
diagnosticCommand = node packages/cli/e2e/owner-review-comprehensibility-wave-6.e2e.mjs --mode=diagnostic
diagnosticLog = <local-path> exit 0 bytes 41632 sha256 81919B083405EA6C67EADDE64B80947297BA987F42690C4BDB3B389657C33B98
diagnosticArtifact = <local-path> bytes 57127 sha256 79102E0AB8070C9E185998AC8B9406D968334E508CB7859FC98B48A93D12D5D4
diagnosticIdentity = <local-path> bytes 237 sha256 5688D099584B986135DC76CB263FB1E3D1AA7BF0BB46ADE625E3D0F75B4A69BF
diagnosticRunHead = e6ae69cbadbbae2ac941899a091e9de6bb9e8eda
diagnosticRunnerSha256 = B797D224928B24833781D9EC295023834674F522886679B406C22FB4CD62FE34
diagnosticStatus = PASSED; evidenceClass DIAGNOSTIC; milestones 11/11 PASSED; lastPassedNode cleanup-and-identity; firstFailedNode null
conflictEvidence = A unit d668d09f31efcac33a8f2b9693de43c1 card contains exact lynn：Alpha route A. and excludes Alpha route C.; C unit 16ef1f66b47199d6f5b29a8a124f6ff5 card contains exact lynn：Alpha route C. and excludes Alpha route A.; both nested buttons were visible, enabled, and retained 选择方案 / 新建场景 / 场景 wave5_alpha action copy; distinguishable=true
decisionEvidence = decisionId 648e1bc6-1180-4c49-b047-dd6623f7029f; fingerprint ba98ff163a25cbdff712f567749129cddac76c28a9bda71ed8cb527f5a800260; decision.json before/after bytes 1909 sha256 6A347B0A364D6218509E7D976B2DC55528C679FA5A37C1E2FFA0AAF7BF113785; persistent marker 已读取已保存的决定; exact A selected and C excluded; 5 decision controls readonly; decision receipt count 1
diagnosticChannels = errors=[]; protocolErrors=[]; consoleErrors=[]; pageErrors=[]; requestFailures=[]; stderrLines=[]; childCleanupFailures=[]; activeLeaseDirectories=[]; blockingIssueChannels=[]
diagnosticBoundaries = toolsCalled exactly surdet_composition_compare and surdet_review_prepare_comparison; prohibitedToolCalls=[]; no plan, execute, apply, approval, or return; projectMutation.occurred=false; projectFixtureUnchanged=true; originalStarterUnchanged=true
authorizedNext = compare the exact 17-path Wave 6 code-evidence set, stage only those explicit paths, create fix(editor): make owner review choices understandable, establish CODE_EVIDENCE_HEAD, then run the single focused FORMAL only if tracked worktree is clean and staging is empty
formal = NOT_RUN at this ledger point
prohibitedStill = no acceptance-prep; no external Agent; no Owner retest; no docs-only closure commit; no apply; no push; no Wave 7
~~~

### 2026-08-30 — W6 owner-review code-evidence freeze blocked by staged whitespace check

~~~text
timestamp = 2026-08-30
authorizationId = W6-OWNER-REVIEW-COMPREHENSIBILITY-RUNNER-SCOPE-RECOVERY-1
diagnosticStatus = PASSED 11/11; the single recovery DIAGNOSTIC remains consumed and was not rerun
preStageSetCheck = expected 17; tracked diff 13; authorized untracked 4; actual authorized change set 17; missing=[]; extra=[]; unknownTracked=[]; staging=[]
stagingAction = each of the 17 authorized code-evidence paths was passed explicitly to git add; no git add ., git add -A, directory wildcard, reset, clean, or unrelated-path staging
stagedSetCheck = 17 paths exactly; missing=[]; extra=[]; tracked worktree diff count 0 before this failure-ledger append
freezeDiffCheck = 42-freeze-git-diff-check.log exit 0; bytes 43 sha256 4A3822F9B7C246E43E66BC3E54069CDEAF7A8BE2C8FE9F4755B27006C665425D
freezeCachedDiffCheck = 43-freeze-git-diff-cached-check.log exit 2; bytes 1072 sha256 084CD7DEFD5CA87ED59B75E9F5D9A116247385808329F1C27A882A3C45A469A2
firstFailedNode = staged-diff-check
firstFailure = docs/superpowers/plans/2026-08-30-wave-6-owner-review-comprehensibility-repair.md lines 3-7 each contain pre-existing Markdown trailing whitespace; git diff --cached --check reported five blank-at-eol findings
scopeDecision = that repair taskbook is required in the 17-path commit set but is not in this recovery's three-file modification whitelist; no whitespace edit, ignore configuration, check bypass, or commit was performed
commit = NOT_CREATED
codeEvidenceHead = NOT_ESTABLISHED
formal = NOT_RUN; focused FORMAL 1/1 remains unconsumed and blocked on a manager-authorized path-contract correction plus a passing fresh staged diff check
stagingStop = the exact 17-path index snapshot is preserved; this append-only failure entry is the only new unstaged tracked difference
historicalEvidence = both original failed DIAGNOSTIC artifacts and the passing recovery DIAGNOSTIC artifact remain unchanged
stopState = W6_OWNER_REVIEW_COMPREHENSIBILITY_CODE_EVIDENCE_FREEZE_BLOCKED; WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
prohibitedActionsObserved = no product/source/test edit after the failed check; no commit; no FORMAL; no acceptance-prep; no external Agent; no Owner retest; no apply; no push; no Wave 7
~~~

### 2026-08-30 — W6 owner-review code-evidence freeze-only recovery authorization

~~~text
timestamp = 2026-08-30
authorizationId = W6-OWNER-REVIEW-COMPREHENSIBILITY-CODE-EVIDENCE-FREEZE-RECOVERY-1
authorizationClass = FREEZE_ONLY; does not add, reset, replace, or permit rerun of any DIAGNOSTIC budget
acceptedBaseline = recovery DIAGNOSTIC 1/1 CONSUMED_AND_PASSED with 11/11 milestones; focused FORMAL 0/1 unconsumed; staged set exactly 17 paths; only freeze blocker is two trailing spaces on each of repair-taskbook lines 3-7
authorizedEdit = docs/superpowers/plans/2026-08-30-wave-6-owner-review-comprehensibility-repair.md lines 3-7 only; remove trailing spaces without changing text, punctuation, title, status, boundaries, or any other line
authorizedIndexUpdate = restage only the repair taskbook and this append-only Wave 6 Execution Ledger; preserve the other 15 staged paths unchanged; no git add ., git add -A, or wildcard staging
requiredFreezeGates = staged set exactly 17; missing=[]; extra=[]; unstaged tracked=[]; git diff --check exit 0; git diff --cached --check exit 0; protected files, historical artifacts, packages/cli/e2e/artifacts, and unrelated untracked paths excluded
forbiddenReruns = runner contract, Authoring/CLI/Editor tests, typecheck, build, preflight, DIAGNOSTIC, and verify:all
authorizedCommit = only after every freeze gate passes, create ordinary local commit fix(editor): make owner review choices understandable with parent e6ae69cbadbbae2ac941899a091e9de6bb9e8eda and the exact 17-path scope
authorizedFormal = only after the commit establishes a clean CODE_EVIDENCE_HEAD, consume the existing focused FORMAL 1/1 using the frozen focused runner
prohibitedStill = no acceptance-prep; no external Agent; no Owner retest; no apply; no push; no Wave 7
~~~

### 2026-08-30 — W6 owner-review comprehensibility focused FORMAL pass

~~~text
timestamp = 2026-08-30
authorizationId = W6-OWNER-REVIEW-COMPREHENSIBILITY-CODE-EVIDENCE-FREEZE-RECOVERY-1
formalStatus = PASSED; evidenceClass FORMAL; focused FORMAL 1/1 CONSUMED; milestones 11/11 PASSED; lastPassedNode cleanup-and-identity; firstFailedNode null
formalArtifact = <local-path> bytes 54888 sha256 7B78F7C0654C0251AC2FB5DAC40A109A2B71C5946B6CE93797D44111866A82D4
formalIdentity = <local-path> bytes 233 sha256 E4715581AB06210CEC610342D1ED0D7BC5660AAE467D3E6F58468E64358CAC47
formalRunHead = faf874c0677f6c6a70b38c325ddf228ee46ee828
codeEvidenceHead = faf874c0677f6c6a70b38c325ddf228ee46ee828
formalRunnerSha256 = B797D224928B24833781D9EC295023834674F522886679B406C22FB4CD62FE34
stopState = W6_OWNER_REVIEW_COMPREHENSIBILITY_FORMAL_PASSED; READY_FOR_INDEPENDENT_MANAGER_REVIEW; ACCEPTANCE_PREP_NOT_STARTED; EXTERNAL_AGENT_NOT_STARTED; OWNER_RETEST_NOT_STARTED; APPLY_NOT_PERFORMED; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~

### 2026-08-30 — W6 owner-review comprehensibility acceptance-prep authorization and baseline

~~~text
timestamp = 2026-08-30
taskId = W6-OWNER-REVIEW-COMPREHENSIBILITY-ACCEPTANCE-PREP-1
authorizationClass = one acceptance-prep invocation only; no external Agent, Owner retest, decision write, plan, execute, apply, commit, push, or Wave 7
acceptancePrepBudgetBeforeRun = 0/1 consumed; the budget becomes consumed when the runner creates a new acceptance root; no rerun after command failure or readback-helper failure
baselineHead = faf874c0677f6c6a70b38c325ddf228ee46ee828
baselineRemote = surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead 13; behind 0
baselineGit = staging empty; only tracked diff is this append-only Wave 6 Execution Ledger; unrelated untracked paths preserved
historicalAcceptanceRoots = exactly <local-path> immutable and excluded from reuse
humanReviewRunnerIdentity = packages/cli/e2e/human-agent-review-wave-6.e2e.mjs bytes 98051 sha256 105244D354FD9ACABA2EC4FEBD01CCFB67907F8295562CBC6A64499709CE3246
wave5PrepRunnerIdentity = packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs bytes 76459 sha256 6A63D4FE415B9190DB8E0CCA9BA06378AA6E7C4B9CA36F00A6041E4E1523E216
baselineStatus = MATCHED; unique acceptance-prep invocation authorized next
forbiddenReruns = tests, typecheck, build, preflight, DIAGNOSTIC, FORMAL, and verify:all
~~~

### 2026-08-30 — W6 owner-review comprehensibility acceptance-prep pass

~~~text
timestamp = 2026-08-30
taskId = W6-OWNER-REVIEW-COMPREHENSIBILITY-ACCEPTANCE-PREP-1
acceptancePrepBudget = 1/1 CONSUMED_AND_PASSED; command invoked once; no rerun performed
command = node packages/cli/e2e/human-agent-review-wave-6.e2e.mjs --mode=acceptance-prep
log = <local-path> exit 0 bytes 906 sha256 8E277BAD4D9F6A4E8DD06479333D9DBBA4F8541231C1DC74FDE99E812B1BC10F
acceptanceRoot = <local-path> basename surdet-human-review-acceptance-OPrfDa; mkdtemp suffix OPrfDa non-empty; on Desktop=true; outside repository=true; absent before this invocation=true; distinct from immutable historical root jMSfT5=true
projectRoot = <local-path>
dataDir = <local-path> projectIdentity 3317f3d18461997337eb823fc21b1df7; dataDirFileCountBeforeAgent 38
candidateRefs = <local-path> bytes 1636 sha256 5C9CBADF3297FD5FC233F7F9D58ACF17635130A12CCF2D94B64CB66EE9728A8F
acceptanceInstructions = <local-path> bytes 1970 sha256 66B2C7EEEE012405AC92E1828926D25394101966B334EFBDF223478E877A116D
mcpStageConfig = <local-path> bytes 485 sha256 78E949049B8DA027052A3DB4C2C6A09652113783251C4387FF4673E2650AB41F; launcher E:/surdet/packages/cli/dist/agent-port/main.js; project and SURDET_AGENT_DATA_DIR point only to OPrfDa; policy stage
applyResumeTemplate = <local-path> bytes 346 sha256 22DC3D5C90A4BD16A297C4CCA9F1CE30F548EE3D51A6AA9230EC6D12F5B5EC2D; status NOT_AUTHORIZED; project/dataDir point only to OPrfDa
evidence = <local-path> bytes 25906 sha256 FD5A174E897457CEC03C46B101C8F723D34E111993A5A63539BBAC6CC938BC29
identity = <local-path> bytes 196 sha256 B43532A1B0C07E8E3B8EC79D92BC1823FDCEA630DEC8E162445BEF580439002E
outerHumanReviewRunner = bytes 98051 sha256 105244D354FD9ACABA2EC4FEBD01CCFB67907F8295562CBC6A64499709CE3246; command result runHead faf874c0677f6c6a70b38c325ddf228ee46ee828
prepHelperRunner = evidence runnerSha256 6A63D4FE415B9190DB8E0CCA9BA06378AA6E7C4B9CA36F00A6041E4E1523E216; frozen agent-candidate-composition-wave-5.e2e.mjs bytes 76459
candidateA = change chg_0001_9d11f895-34c5-4cbe-bfa3-5710041d0f3d; capsule 0e486632-ae4b-4c8a-ab06-9d000eb54e98; payload bytes 6545 sha256 8FFF2A96B7EA19A5404961D1D280ED7505AEB1A3E9388C89E6D4E2E9AEB5D407; identity.json bytes 335 sha256 32BFC56C2275EF556BC5E8739EB804FED6F4547241990EE4D54FFE0F8B2EA430; sealed OPEN ready non-integration; projectMutation=false
candidateB = change chg_0001_de78826f-bcb8-4ca0-882a-df221480cbbd; capsule c1f9c98a-467b-4341-9307-f3eba1ad73ac; payload bytes 8590 sha256 19199EB8DDFD35C25D3A1559F8C08E16844FF1111DC1C74541C10679DB4A07AE; identity.json bytes 335 sha256 96AED363C2938EF373E3435AB379669610386B21550B2E48E7BDD0A6D77E2B9E; sealed OPEN ready non-integration; projectMutation=false
candidateC = change chg_0001_96043a28-209b-4ad0-bfbf-8d5d1b7d656d; capsule 331e0b30-095c-4141-9731-40108627e59e; payload bytes 4868 sha256 C856C76C4D11F9542A9F58F1C9240DC6169FB0B2188D8853C95F9D02C79306D1; identity.json bytes 335 sha256 E040D7C8832E4E890E2DCA23EE263678471F4D0D0704F20CB5FA12AC8C702D77; sealed OPEN ready non-integration; projectMutation=false
candidateD = change chg_0001_f3032a91-6c0d-4d55-ad8b-5ab67b0671dc; capsule 162db5ec-e5ad-4fd2-9b06-452e74245841; payload bytes 6545 sha256 12448C146FFAFD045D001EB425E40CBA02E4D690634ED03D1F29B373EF3115E3; identity.json bytes 335 sha256 72C95532129CFDEDBC5324609AF766AC772A9A9D074A308547A6AC24D9114A2A; sealed OPEN ready non-integration; projectMutation=false
sourceChangeBoundary = exactly four chg_* directories matching A/B/C/D; all evidence source records OPEN and integration=false; no external or integration active change; integrationChangeCreated=false
projectAndStarterTrees = project, Starter before, and Starter after each fileCount 37 bytes 6705750 sha256 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6; runner-scope independent disk comparison diff count 0; projectFixtureEqualsStarterAtPrep=true; originalStarterUnchanged=true
purityAndSafety = externalAgentStarted=false; externalAgentToolsCalled=[]; applyAuthorized=false; projectMutation.occurred=false; stageProjectMutated=false; errors=[]; childCleanupFailures=[]; activeLeaseDirectories=[]; .locks contains only empty changes/projects namespace directories and no lease.json
readbackNotes = two post-success helper commands produced no mutation: one used an invalid PowerShell Split-Path parameter set and one initially included runner-excluded node_modules/dist paths; both were corrected with short read-only commands against the same OPrfDa root; acceptance-prep was not rerun
gitAfterPrep = HEAD faf874c0677f6c6a70b38c325ddf228ee46ee828; surdet/main f8943c293c4537b3867cc8eeea316b19bb4a0b40; ahead 13; behind 0; staging empty; only tracked diff is this Execution Ledger; no commit or push
toolsCalled = []
stopState = W6_OWNER_REVIEW_COMPREHENSIBILITY_ACCEPTANCE_PREP PASSED; ACCEPTANCE_PREP_ATTEMPTS 1/1; WAITING_FOR_EXTERNAL_AGENT_COMPARISON_STAGE_AUTHORIZATION; EXTERNAL_AGENT_NOT_STARTED; OWNER_RETEST_NOT_STARTED; APPLY_NOT_AUTHORIZED; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~

### 2026-08-30 — OPrfDa comparison stage, Owner decision, and save-action layout repair

~~~text
timestamp = 2026-08-30
comparisonStage = PASSED; external Agent used the OPrfDa Surdet Agent Port session and stopped at the human decision gate without plan, execute, apply, or project mutation
comparisonReview = review_comparison_60ced6b251ba43e6bffa41fc23e76525; state COMPARISON_PREPARED; comparisonFingerprint 507e001233c5806fae37d30c61fb72b91ddc2bee983620edfcb281a6c92eb71e; reviewFingerprint bd89be98a7ce904395d6ea8291517c7328b5eb7454d9e63c3f1b5a6172fd5e74
comparisonPayload = <local-path> bytes 72031 sha256 A65C749AA8038525E4BE1B04B04F87929EBBF38F9B643B542369A8D580E1772F
independentReadback = two A/D identical groups each retain sourceCount=2; C remains OBJECT_RESULTS_DIVERGE selection-required; B scene-to-timeline dependency remains implicit; decision/plan/approval/return receipts were absent before Owner action; fixture and Starter each 37 files / 6705750 bytes with mismatchCount=0; lock namespaces empty
ownerVisualFacts = supplied screenshots show Chinese comparison cards, A/D same-result source cards, C Alpha route C distinction, B automatic dependency, expanded technical identity, a selected Alpha route A result, and the saved-decision terminal marker
ownerDeferredFinding = overall visual language remains strongly machine-generated; explicitly deferred to a later design pass and not mixed into this repair
decisionReceipt = decision.json bytes 1909 sha256 DD0BAC07068F6F7F6E38B6419EA87299FBDCED55CB7C2F6697907EE88D1E5763; decisionId 01706b19-f1a8-410e-8157-f51ad261007e; conflict 802316b444e2a42fcb783d92fae135a9 resolved choose-unit d1ad842bbf9e8494cb43363333e01dc5
decisionMapping = selected display ordinal A maps to original candidate D; its scene finalFingerprint is identical to original candidate A, so the chosen visible Alpha route A result is semantically equivalent; reviewed-plan acceptance must still prove both A/D provenance sources are retained
ownerAcceptanceBoundary = save succeeded and project/Starter mismatchCount remains 0; close-and-reopen receipt persistence is not yet Owner-confirmed, so full Owner comparison acceptance remains OPEN
uiFinding = Owner reported and screenshots confirm that 保存我的决定 stays floated over scrolling review content because .review-operations used position sticky and bottom 0 in both base and narrow-layout CSS
uiRepair = packages/editor/src/styles.css now keeps .review-operations in normal document flow with position static and removes the narrow-layout sticky override; no review semantics, receipt logic, content cards, or broader visual styling changed
permanentRegression = packages/editor/test/review-operations-layout.test.ts rejects sticky/fixed positioning and bottom anchoring for every .review-operations rule
red = npm test -- --run test/review-operations-layout.test.ts exit 1; expected sticky positioning was reproduced
green = npm test -- --run test/review-operations-layout.test.ts test/review-panel.test.ts exit 0; 2 files / 13 tests
editorTypecheck = npm run typecheck exit 0
editorBuild = npm run build exit 0; existing chunk-size advisory only
gitBoundary = no staging, commit, push, apply, external Agent continuation, or Wave 7 action performed; existing unrelated untracked paths preserved
nextStop = OWNER_REOPEN_RECEIPT_RETEST_AND_UI_LAYOUT_RETEST; then reviewed-plan stage may be separately authorized
~~~

### 2026-08-30 — OPrfDa Owner comparison acceptance pass

~~~text
timestamp = 2026-08-30
ownerOriginalFeedback = Owner comparison 验收通过：决定重开可读、原选择保持、控件只读、按钮位置正常。
ownerComparisonAcceptance = PASS
decisionReceiptReopen = PASS; receipt remained readable, original choice remained selected, decision controls remained readonly, and no replacement decision was requested
decisionIdentityReadback = decision.json bytes 1909 sha256 DD0BAC07068F6F7F6E38B6419EA87299FBDCED55CB7C2F6697907EE88D1E5763; decisionId 01706b19-f1a8-410e-8157-f51ad261007e; decisionFingerprint d8fd4c08fa24ca0e0b704727b6bfdb8fc1490ea02359eca4ade6aa48b9803481
decisionBinding = reviewId review_comparison_60ced6b251ba43e6bffa41fc23e76525; comparisonFingerprint 507e001233c5806fae37d30c61fb72b91ddc2bee983620edfcb281a6c92eb71e; projectIdentity 3317f3d18461997337eb823fc21b1df7; expectedProjectRevision d63c0e5c32cc9d8d7940a541a2f17d41e1cec7d5c1419e8ab44dce8e9d35ab6f
decisionResolution = conflict 802316b444e2a42fcb783d92fae135a9 choose-unit d1ad842bbf9e8494cb43363333e01dc5; this display-A unit originates from candidate D but has the same Alpha route A final fingerprint as candidate A
nextStageHardRequirement = reviewed plan and replay must retain provenance for both A/D identical scene sources c047ff34d00b1197769e1e07bb4420bf and d1ad842bbf9e8494cb43363333e01dc5 while excluding C unit 9ed9dffb7dcd01b222819f172662489f and implicitly including B timeline unit 40635853041b79501c5675479f27a12b
uiLayoutRetest = PASS; 保存我的决定 / 决定已保存 remains in its document location and no longer floats with the viewport
projectMutation = NO; no reviewed plan, integration execute, result review, approval, apply, commit, push, or Wave 7 action performed by this Owner gate
nextStop = READY_FOR_EXTERNAL_AGENT_REVIEWED_PLAN_STAGE_AUTHORIZATION
~~~

### 2026-08-30 — OPrfDa reviewed stage and result-review independent manager verdict

~~~text
timestamp = 2026-08-30
externalAgentReviewedStage = PASSED; the bounded second-stage call sequence reached the expected human approval gate without approval, return, commit, apply, rollback, or project mutation
plan = pln_c172eb603f9f593ab48542da850b4be5; planFingerprint c172eb603f9f593ab48542da850b4be55993e4c3006a5e1b3af5aaef3e70ff14; payload.json bytes 10919 sha256 E7DB1A52F7BBB806EEBA090CCF06BCF93EF7AEC0E6309EBC8C805A82F5EE3E57; identity.json bytes 298 sha256 87780C6FBDB58D0C0283BA954583990050F3AFF4C6DCF6058231A936311AD870
reviewBinding = human-reviewed reviewId review_comparison_60ced6b251ba43e6bffa41fc23e76525; decisionId 01706b19-f1a8-410e-8157-f51ad261007e; decisionFingerprint d8fd4c08fa24ca0e0b704727b6bfdb8fc1490ea02359eca4ade6aa48b9803481
compositionContract = scene A/D deduplicated provenance retains c047ff34d00b1197769e1e07bb4420bf and d1ad842bbf9e8494cb43363333e01dc5; variable A/D provenance retains abcf4da450c0f394a76f1d342f29df85 and ea5c999de9c29b9e066e47968e128b8d; C unit 9ed9dffb7dcd01b222819f172662489f excluded; B timeline unit 40635853041b79501c5675479f27a12b implicitly included
integrationChange = chg_0002_a69b23db-55f2-428d-930d-94ad04bb2c26; top-level change status OPEN; integration.status READY; workingRevision 4; nextOperationIndex 4; four replayed operations retained; this corrects the report's shorthand that called the whole change READY and operationCount 4
freshEvidence = diff diff_1788082704237_cced8ceb-82b7-4710-a242-a99fa5319d83; validation validation_1788082709303_acce0535-5239-49d5-bfb2-1d55e5c38086 ok with three known base speaker warnings; simulation simulation_1788082724874_cdb3802f-0c85-4238-a50d-653579e2d2a1 passed 13 paths; Alpha trace trace_1788082731095_ae9edd7b-202b-48e1-8fbd-125f508a6eeb; Beta trace trace_1788082744959_e46ca1b0-40c3-4a7f-9fa6-5086fc6558c9
resultReview = review_result_f1dce4ad9c3a4e0ba1a97e5b9cc3d59a; state STAGE_READY; reviewFingerprint 33903c230559932aef3ff176572267d3a0e397edf01e3c32eeb58d2338dc2eb7; result/review.json bytes 25863 sha256 AC2BE34B84636E0417DC7A0060EE335DFB80F23AE1F56E8076AA03C2CEFC5F70; identity.json bytes 726 sha256 65A0034A38FA0C48003DAF3DE07B08DBCB9D7007A5D21331758EBDFB616BE975
pathCorrection = authoritative result review root is the review_result_f1dce4ad9c3a4e0ba1a97e5b9cc3d59a directory; result/project is its isolated preview project child, not the review root
approvalGate = REVIEW_APPROVAL_REQUIRED with retryDisposition after-human-review; no final-approval.json, return-request.json, or approval receipt exists
projectSafety = OPrfDa fixture project and original Starter remain 37 files each with mismatchCount 0; lock namespaces contain no lease file; stage project is isolated under agent-data
confirmedFinding = diff and result review mark game.config.json unexpectedFormatChange=true; disk readback proves base file bytes 1623 with CRLF=69 and bareLF=0, while isolated stage result bytes 1625 with CRLF=0 and bareLF=73; semantics add only flag.alpha but the entire file's line-ending convention is normalized
managerVerdict = EXTERNAL_AGENT_REVIEWED_STAGE PASS; RESULT_REVIEW PREPARED; INDEPENDENT_RESULT_REVIEW NEEDS_FIX; whole-file line-ending churn is not accepted for final Owner approval or isolated apply
ownerGate = DO_NOT_APPROVE_YET; Owner result acceptance and approval receipt remain NOT_STARTED
nextStop = WAITING_FOR_W6_CONFIG_EOL_PRESERVATION_REPAIR_AUTHORIZATION; no apply, commit, push, or Wave 7
~~~

### 2026-08-30 — W6-CONFIG-EOL-PRESERVATION-1 implementation and replacement result review

~~~text
timestamp = 2026-08-30
authorizationId = W6-CONFIG-EOL-PRESERVATION-1
authorizationBoundary = fix game.config.json original EOL preservation; add permanent CRLF/LF regression; generate fresh stage evidence and a fresh result review; preserve existing evidence; no approval, apply, push, or Wave 7
implementation = packages/authoring/src/config-document.ts now serializes with the first newline convention present in the source document, defaulting to LF only when the source has no newline; variable.ensure, character.ensure, character.remove, and project.entry-scene.set share this serializer
permanentRegression = packages/authoring/test/operations.test.ts exercises the real variable.ensure path with both CRLF and LF source documents, verifies the original style and final newline remain intact, and verifies flag.alpha semantic content
red = npm run test --workspace @surdet/authoring -- operations.test.ts exit 1; CRLF case failed while LF passed; aggregate result 1 failed / 47 passed across 3 files
focusedGreen = npm run test --workspace @surdet/authoring -- operations.test.ts config-operations.test.ts exit 0; 3 files / 48 tests passed
parallelFullBoundary = npm run test --workspace @surdet/authoring exit 1 after 85 passed because Windows returned 19 unhandled spawn UNKNOWN errors while starting Vitest workers; no functional assertion failure observed; this run is not claimed as PASS
serialFullGreen = npm run test --workspace @surdet/authoring -- --maxWorkers=1 --minWorkers=1 exit 0; 30 files / 262 tests passed
authoringTypecheckBuild = PASS / PASS
cliTypecheckBuild = PASS / PASS; rebuilt Agent Port uses the repaired Authoring output
diffChecksBeforeLedger = git diff --check PASS; no staging used
firstFreshAttempt = <local-path> bytes 6636 sha256 05EBCD50BADE605857A689434C77A3572D7A48DCAA6CA1F40604098C12DCF005; identity.json bytes 265 sha256 3E428EAA771C9BF875AF4F92D8B79DE8320642EFD8B8E37FD3D87325F4FE2307; stopped at composition.execute because the existing OPEN integration change is idempotently bound to its original executeOperationId; no new change or review created
relocatedStoreAttempt = <local-path> bytes 9943 sha256 E89C1C18B02679BCCFDBD9C27EF5898B261B92DA6527A40944EE7E0C347A144F; identity.json bytes 271 sha256 2FFE3D40E2B7876E944EA49AF56D37E45DF8C289F839B24392F1B63E87DBE9CC; stopped at composition.inspect because copied plan sidecars bind their absolute artifact paths; classified harness-invalid, not product failure; original evidence remained untouched
retirementAudit = defective stage chg_0002_a69b23db-55f2-428d-930d-94ad04bb2c26 was resumed through the public stage-policy port and transitioned OPEN/READY to ROLLED_BACK by change.rollback; the old result review was not deleted, moved, rewritten, or reused
oldResultReviewPreserved = review_result_f1dce4ad9c3a4e0ba1a97e5b9cc3d59a identity.json, result/review.json, and result/project/game.config.json retained their exact pre-retirement bytes and SHA-256 identities
replacementChange = chg_0001_e2f5fd21-7564-4c2b-bdfd-6e3efd741532; OPEN integration; status READY; workingRevision 4; four replay operations; executeOperationId w6-config-eol-preservation-1-replacement-001
replacementFreshEvidence = diff diff_1788084080622_3920908f-3c54-40c7-8ff4-7609bb572456; validation validation_1788084080674_87512698-0d61-4ea9-a0a4-4975938f908f ok; simulation simulation_1788084080730_f537f82a-bff1-4d55-a15c-9c427ff088c2 passed; Alpha trace trace_1788084080800_5c4a4fe2-1db6-428c-8fda-2e26330f2477 passed with 5 events; Beta trace trace_1788084080842_69266c16-63eb-4e19-80e8-459cec2a9936 passed with 6 events
replacementCapsule = capsule 32ecb915-a039-46bb-b3e4-6fe011aaac77; payload.json bytes 22237 sha256 1D718990028AD38950C75F3AE0784CA455614F678648DAF395C47434D038B129; projectMutation.occurred=false; integration provenance retains both A/D identical groups, excludes C, and includes the B timeline closure
replacementResultReview = review_result_d42f4f17afde4678acd741a962acb9e1; result/review.json bytes 25773 sha256 22943FABB6C226095FADDDA3146AA49DB28DC076EBD270BE6B53D4E771393CF6; identity.json bytes 726 sha256 28B6F4389568DB422B371BEEA265B31E7D38D0A1ACF3A5D1CC45C1A14719959D
replacementConfig = result/project/game.config.json bytes 1698 sha256 65A13CE8B563514E3D89F4C75DBD0A48DC2E616A206A2BD4EDB1C5E2037F7BCC; CRLF count 73; bare LF count 0; endsWithCRLF=true; flag.alpha remains string with initial empty string; unexpectedFormatChange=false in fresh diff, returned projection, and disk review
replacementArtifact = <local-path> bytes 127606 sha256 B8024903483CC632D4112AA3CB4D58B9D48527B37FF20862E80AB74C4C37C752; identity.json bytes 279 sha256 A1D28D475E17B4385E1E6F69A92AB15843BE1CB16AFA8A25D900C91BE78FFE83; eight milestones passed; firstFailedNode null; errors=[]; stderrLines=[]
approvalBoundary = review.inspect-approval returns REVIEW_APPROVAL_REQUIRED; no final-approval.json or return-request.json exists in the replacement review
projectSafety = OPrfDa fixture tree and base game.config.json remain byte-identical before and after replacement stage; projectMutation=false; no apply or commit
gitState = HEAD remains faf874c0677f6c6a70b38c325ddf228ee46ee828; no staging, local commit, or push; pre-existing Editor CSS/test and unrelated untracked paths preserved
stopState = W6_CONFIG_EOL_PRESERVATION_RESTORED; REPLACEMENT_STAGE_READY; REPLACEMENT_RESULT_REVIEW_PREPARED; WAITING_FOR_OWNER_RESULT_REVIEW; APPROVAL_NOT_PERFORMED; APPLY_NOT_PERFORMED; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~

### 2026-08-30 — Surdet Editor local redeployment on the reserved port

~~~text
timestamp = 2026-08-30 18:39 Asia/Shanghai
trigger = Owner reported connection refused while reopening the local Editor
precheck = no process was listening on 127.0.0.1:4175; 4173 also had zero listeners
deploymentCommand = npm run dev -w surdet-editor -- --host 127.0.0.1 --port 4175
launcherPid = 41964
listenerPid = 28772; process node.exe; command line resolves to E:/surdet/packages/editor/node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175
runtimeVerification = http://127.0.0.1:4175/ returned HTTP 200; title was Surdet 剧本编辑器; /@vite/client returned HTTP 200
portBoundary = 4173 remained free with zero listeners; no neighboring-project process was stopped or modified
stdoutLog = <local-path> startup readback 172 bytes; Vite 6.4.3 ready in 696 ms
stderrLog = <local-path> startup readback 0 bytes
scope = local Editor process start only; no source edit beyond this append-only Ledger entry; existing Authoring and Editor worktree changes preserved
gitBoundary = no staging, commit, push, approval, apply, external Agent continuation, or Wave 7 action performed
stopState = LOCAL_EDITOR_REDEPLOYED_ON_4175; WAITING_FOR_OWNER_RESULT_REVIEW
~~~

### 2026-08-30 — delegated replacement result acceptance and approval receipt

~~~text
timestamp = 2026-08-30 18:53 Asia/Shanghai
authorization = project Owner explicitly delegated the pending result-review gate to the manager and requested no further Owner-operated acceptance steps
ownerManualVisualAcceptance = NOT_PERFORMED for replacement review; this is not represented as an Owner visual PASS
managerTechnicalAcceptance = PASS for review_result_d42f4f17afde4678acd741a962acb9e1
reviewStateBeforeApproval = STAGE_READY; no final-approval.json, return-request.json, or decision.json existed in the replacement result review
freshness = diff fresh; validation fresh; simulation fresh; runtime fresh; warnings empty
semanticReadback = Alpha result contains Alpha route A and excludes Alpha route C; Beta scene calls beta_opening and contains Beta route; beta_opening duration 400 ms with one track
compositionReadback = A/D scene provenance retains c047ff34d00b1197769e1e07bb4420bf and d1ad842bbf9e8494cb43363333e01dc5; C unit 9ed9dffb7dcd01b222819f172662489f excluded; B timeline unit 40635853041b79501c5675479f27a12b implicitly included
formatReadback = all four diff files unexpectedFormatChange=false; result game.config.json bytes 1698 sha256 65A13CE8B563514E3D89F4C75DBD0A48DC2E616A206A2BD4EDB1C5E2037F7BCC; CRLF 73; bare LF 0; endsWithCRLF=true
editorFocusedVerification = npm test --workspace surdet-editor -- --run test/review-workspace.test.ts test/review-panel.test.ts test/review-preview.test.ts test/review-operations-layout.test.ts exit 0; 4 files / 40 tests passed
browserBoundary = local Editor returned HTTP 200 on 4175; the in-app automation surface aborted the native showDirectoryPicker request, so no browser-click visual claim is made and the Owner was not asked to intervene
approvalWriter = canonical Editor openReviewWorkspace and writeApprovalReceipt code path, backed by a create-only local FileSystemDirectoryHandle adapter; temporary harness removed after success
approvalId = approval_manager_83b1e787-4dbc-428a-bf39-bd65203150bd
approvalFingerprint = aa59a29139fee3971279b05cab738a58b4cb13a0174057bf50a4749596613418
approvalReceipt = <local-path> bytes 1471 sha256 322AA3E179C0B5F9B9C7E922480E7AA3C0B8A6BF2D645A052D6573A01E06EB83
reopenVerification = canonical Editor openReviewWorkspace returned receiptStatus approval-written with the same approvalId and approvalFingerprint; receipt bytes/SHA remained unchanged; return-request.json remained absent
acceptanceEvidence = <local-path> bytes 4271 sha256 08F08AB31313987190CF299B61624D38F9E416C45B7859E3936BBF698E13B29F
projectSafety = OPrfDa fixture project and original Starter each remained 37 files / 6705750 bytes / sha256 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6 before and after approval
mutationBoundary = approval receipt only; projectMutation=false; apply=false; no commit, push, external Agent continuation, or Wave 7 action
stopState = W6_REPLACEMENT_RESULT_MANAGER_ACCEPTANCE_PASS; APPROVAL_RECEIPT_VERIFIED; READY_FOR_SEPARATE_ISOLATED_APPLY_DECISION
~~~

### 2026-08-30 — delegated isolated apply pass and evidence-refresh correction

~~~text
timestamp = 2026-08-30
authorization = project Owner explicitly delegated the remaining machine-verifiable acceptance and isolated apply work to the manager, requested no further Owner-operated steps, and did not authorize repository push or Wave 7
targetBoundary = only <local-path> may mutate; E:/surdet/examples/starter and the repository worktree must not be used as the apply target
guardAttempt1 = FAILED before MCP startup because the temporary verifier treated a cross-drive path.relative result as if the Desktop project were inside E:/surdet; no service call or project mutation occurred
guardAttempt1Artifact = <local-path> bytes 1696 sha256 69AD0248EAE7C4614468CB223EFEABC6B3A10006ACB752C6D6A8C675CFB59B9F; identity.json bytes 205 sha256 DD5783A2AFBBBBC284E90522C071DD52DEC73B2BC60B18029274E56D15E2E1E1
guardAttempt2 = FAILED fail-closed before commit; the verifier called change.diff before approval inspection, which correctly created fresh diff evidence diff_1788087710504_caf6505c-d8ac-4626-a2bf-a95916ff277b and made the earlier approval stale; fixture project still unchanged
guardAttempt2Artifact = <local-path> bytes 19278 sha256 2BC8850E7035152EC295365F802C44565A710C103608D8EEDBDF0FBB3C15339A; identity.json bytes 206 sha256 4815C9031E97B00618DBD56CBDD93581AA6BC8E01ED29DDE47B1836221A6DD9E
refreshAttempt = created a new create-only result review and approval bound to the refreshed diff evidence, then stopped before commit because the verifier passed an unsupported approvalFingerprint property to review.inspect-approval and the MCP schema rejected it before dispatcher execution; no project mutation occurred
refreshAttemptArtifact = <local-path> bytes 33916 sha256 424C042821E425965A1B8997B28FF93D437C6A6575978BC4E6DAE371A57DFA06; identity.json bytes 212 sha256 C34CD5BF6623E5496C5987F6DCD42F875A368790ED1557043D8E45E16A2AFC92
freshResultReview = review_result_c3899202a53a4a2baaec01fc1fe421cc; STAGE_READY; workingRevision 4; result/review.json bytes 25773 sha256 2BBE16D27592552C8ED254B93F2A0184C1B4256AA0D9D63E2FF9EC30A272B7DA; identity.json bytes 726 sha256 764F3E560839DD47CBC8137C53D377F087E303025DFC0108B17C465EEFBF1BA4
freshResultEvidence = diff diff_1788087710504_caf6505c-d8ac-4626-a2bf-a95916ff277b; validation validation_1788084080674_87512698-0d61-4ea9-a0a4-4975938f908f; simulation simulation_1788084080730_f537f82a-bff1-4d55-a15c-9c427ff088c2; runtime traces trace_1788084080800_5c4a4fe2-1db6-428c-8fda-2e26330f2477 and trace_1788084080842_69266c16-63eb-4e19-80e8-459cec2a9936; resultTreeSha256 f5b359516a36baa2a924ec1e5ac3012070b0e9fc8f5057acf7b51e89fdfd8b0a
delegatedApprovalRefresh = approval_manager_refresh_ac9187a0-7ae9-43f3-90d2-3b974d2260a5; approvalFingerprint 161ae5cdd20d9d1ed4b9565588b93eeeba732fefddf865a045ad470821934e11; canonical authoring approval fingerprint plus NodeReviewStore create-only persistence; the public review.inspect-approval service verified the receipt before commit
freshApprovalReceipt = <local-path> bytes 1479 sha256 31C9476A8C9C27255EF5E109AD29383C24C5CDF91901070CB6890A1540DDDE07; bytes and SHA unchanged after commit
isolatedApply = PASS; change chg_0001_e2f5fd21-7564-4c2b-bdfd-6e3efd741532 transitioned to COMMITTED through the public apply-policy Agent Port with the verified approvalRef
committedFiles = content/scenario/wave5_alpha.gal; content/scenario/wave5_beta.gal; content/timelines/beta_opening.json; game.config.json
semanticReadback = wave5_alpha contains Alpha route A and excludes Alpha route C; wave5_beta references beta_opening; beta_opening durationMs 400 with one track; flag.alpha is string with initial empty string
formatReadback = committed game.config.json bytes 1698 sha256 65A13CE8B563514E3D89F4C75DBD0A48DC2E616A206A2BD4EDB1C5E2037F7BCC; CRLF 73; bare LF 0; endsWithCRLF=true
fixtureAfterApply = 40 files; 6706275 bytes; tree sha256 33887C529073460E4185938573059E77761BC621236B7BFCE8C50599DBD3A17E
starterSafety = E:/surdet/examples/starter remains 37 files; 6705750 bytes; tree sha256 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
cleanup = protocolErrors=[]; stderrLines=[]; childCleanupFailures=[]; activeLeaseDirectories=[]; all three temporary repository-root verifier scripts removed after execution
applyEvidence = <local-path> bytes 8660 sha256 5E9C1CE81F799266A4F842B4146AC89EAA040F003637542041CD14B14DA42690; identity.json bytes 211 sha256 441555409C817F7037C4E65EB8771CCEE9DA90A8378DC5C255B639DCCB3F986F
repositoryBoundary = isolated apply did not modify the repository source set; pre-existing Authoring EOL repair, Editor save-action layout repair, this append-only Ledger, and unrelated protected/untracked paths remain separate; no staging, repository commit, push, deployment, or Wave 7 action occurred
stopState = W6_ISOLATED_APPLY_PASS; ORIGINAL_STARTER_UNCHANGED; READY_FOR_LOCAL_CODE_AND_DOCUMENT_CLOSURE; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~

### 2026-08-30 — local code closure verification and precise commits

~~~text
timestamp = 2026-08-30
scope = close the already-authorized game.config.json EOL repair and review save-action layout repair after the delegated isolated apply pass; no new product scope, no verify:all, no push, and no Wave 7
authoringFocused = npm run test --workspace @surdet/authoring -- operations.test.ts config-operations.test.ts exit 0; 3 files / 48 tests passed
authoringSerialFull = npm run test --workspace @surdet/authoring -- --maxWorkers=1 --minWorkers=1 exit 0; 30 files / 262 tests passed
authoringTypecheckBuild = PASS / PASS
cliTypecheckBuild = PASS / PASS
editorFocused = npm test --workspace surdet-editor -- --run test/review-workspace.test.ts test/review-panel.test.ts test/review-preview.test.ts test/review-operations-layout.test.ts exit 0; 4 files / 40 tests passed
editorSerialFull = npm test --workspace surdet-editor -- --run --maxWorkers=1 --minWorkers=1 exit 0; 33 files / 223 tests passed
editorTypecheckBuild = PASS / PASS; Vite large-chunk warning remains informational and is not introduced by the two-line layout change
configEolCommit = f771848ccb23984d7810487d67a0c623122fa77b; message fix(authoring): preserve config line endings; exact scope four Authoring files; staged diff check passed
reviewLayoutCommit = b2a795e18a3ed97d724acec8c211bb2dc35eb686; message fix(editor): anchor review save action; exact scope styles.css plus permanent layout test; staged diff check passed
protectedBoundary = no protected file, historical artifact, dependency, lockfile, Starter, game content, Core, Renderer, Host, Shell, or unrelated untracked path staged or committed
deliveryReport = docs/HUMAN-AGENT-REVIEW-WORKBENCH-STAGE-6-WAVE-6-DELIVERY-REPORT-2026-08-26.md created for Task 12; its post-commit disk identity will be recorded by readback rather than recursively prewritten
stopState = READY_FOR_DOCUMENT_GATES_AND_PRECISE_DOCS_COMMIT; PUSH_NOT_PERFORMED; WAVE_7_NOT_STARTED
~~~
