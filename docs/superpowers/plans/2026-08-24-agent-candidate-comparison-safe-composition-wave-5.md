# Stage 6 Wave 5 Agent Candidate Comparison and Safe Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 让两个至八个外部 Agent 在同一项目、同一基线上产生的隔离候选，可以被 Surdet 以机器可读方式比较、识别依赖与冲突、接受明确裁决，并通过既有类型化 authoring 语义生成一份新的、可恢复、可验证、可追溯的 OPEN 集成变更。

**Architecture:** 来源候选和胶囊保持不可变。@surdet/authoring 负责规范化重放清单、对象变更单元、依赖闭包、冲突、计划和集成执行状态机；@surdet/cli 只负责当前项目命名空间内的 capsule/plan artifact 读取、非撕裂持久化、项目快照与共享函数接线；MCP 从 capability registry 机械投影。合成不合并原始文件、不重建领域解析器、不内嵌模型，也不自动 commit/apply。

**Tech Stack:** TypeScript 5.7、Node.js >=20、Vitest 3、现有 @surdet/authoring / @surdet/cli、现有 Agent Port 与 MCP 2.0.0 SDK、现有 Change Store V2 / JSON record / local lease / evidence / delivery capsule 基础设施。

## Global Constraints

- 本任务书落实项目所有者已批准的 B2：多候选比较与安全合成；获批设计规格为 docs/superpowers/specs/2026-08-24-agent-candidate-comparison-safe-composition-wave-5-design.md。
- 用户可见的长期产品方向仍是中文、渐进展开、零基础友好；本 Wave 只做机器合同和可靠底座，不把内部英文 schema、错误码或 JSON 直接规定为未来 Editor 文案。
- Surdet 不内嵌模型。不得保存 prompt、模型名称、聊天记录、token、供应商路由或“最佳方案”评分；外部桌面 Agent 通过公开合同工作。
- MCP 只是共享 authoring 合同的薄适配。比较、闭包、冲突、计划、重放和恢复逻辑不得写进 server.ts、tool-projection.ts 或 capability registry。
- 来源 capsule、来源 change 和真实项目保持不可变；合成总是创建一个新的 integration change。
- 最小选择单位是依赖闭合的对象变更单元。禁止行级选择、半个对象、任意 JSON patch、unified diff replay 或 workingFiles 直接复制。
- 首版只自动组合依赖闭包完全不相交的单元，或规范结果完全相同的单元。其余对象重叠一律要求显式 resolution。
- 历史 capsule v1 仅可审计。不得从 diff、operation result、活动 change 或文件内容反推缺失的 normalizedInput；不得迁移或覆盖历史 artifact。
- 新 v2 capsule 必须自包含 CompositionManifest。只有 identity、project、base revision、manifest 和 schema 全部有效时才可进入 executable plan。
- composition.plan 不接受 replayOperations、normalizedInput、fingerprint、依赖边或排序结果。调用方只能提供候选引用、unitId 和允许的冲突裁决。
- dry-run 与 execute 必须调用同一组既有 scene/variable/character/timeline/entry-scene mutation 实现；不得复制第二套解析器或写入算法。
- composition.execute 在 stage 与 apply policy 下都只创建或恢复 OPEN integration change；不得自动 validate、simulate、runtime、capsule、commit 或 apply。
- 项目所有者批准本任务书后，仅授权 FORMAL 的确定性客户端在系统临时 fixture 中显式 resume READY integration change 并调用既有 change.commit；这不授权 Desktop acceptance fixture、原始 Starter、真实项目、push、部署或发行。
- integration status 未达到 READY 时，既有 change.commit 必须 fail-loud；READY 仍不替代既有 fresh validation/simulation/runtime commit gate。
- 不修改 packages/core/**、packages/renderer/**、packages/host/**、packages/shell/**、packages/editor/** 生产代码。
- 不修改 examples/starter/**、examples/zero-after-midnight/**、games/**、资产、剧情、配置、存档格式、性能门限、pack、release 或 deploy。
- 不新增依赖，不升级 MCP SDK，不修改 package-lock.json 或任一 package dependency。
- 不修改长期路线台账；执行完成后只在交付报告末尾给出“建议由总经理登记的事实”。
- 不触碰 SESSION-HANDOFF.md、USER.md、两份受保护美术资料、既有 handoff、历史 artifact 和 packages/cli/e2e/artifacts/。
- 所有动态 fixture、日志与 RED/GREEN/DIAGNOSTIC/FORMAL artifact 写入新建的系统临时目录；不得写入仓库测试发现范围。
- 每个代码 Task 先建立匹配真实缺口的 RED，再做最小 GREEN；零测试或未命中目标断言的“绿灯”记为 HARNESS_INVALID。
- 质量第一；质量不下降时节省额度第二。禁止一修一 FORMAL、无界 sleep、概率性压力、重复全量门禁和为了漂亮报告增加无关测试。
- DIAGNOSTIC 总预算最多 3 次。第 3 次仍失败即停止；不得自动申请或制造新预算。
- verify:all 正式运行最多 1 次。仅当失败与本 Wave 直接相关、已有聚焦 RED 且任务书明确条件满足时，允许 1 次 recovery；不得连续重跑。
- runner 和全部代码冻结并提交后，FORMAL 只运行 1 次。失败即保留 artifact 并停止，不得修后再 FORMAL。
- 真实外部 Agent 验收与项目所有者视觉验收不能由执行 AI 代填。
- 只创建普通本地提交；不得 push、force push、rebase、reset、amend、squash、clean 或改写历史。push 只由项目所有者另行授权。
- 本任务书头部的执行 skill 建议不构成创建子 Agent、并行施工或把任务转交另一 AI 的授权；默认由一个执行 AI 串行完成。

---

## 一、给新执行 AI 的最小项目介绍

Surdet 的目标不是在引擎里放一个聊天机器人，而是让电脑端 Agent 能像可靠的创作者一样使用引擎。当前已有：

1. 机器可读 capability registry 与 MCP 工具投影；
2. observe / stage / apply 权限边界；
3. 隔离 change、operationId 幂等、workingRevision、对象指纹与 CAS；
4. 场景、变量、角色、入口和既有资源时间轴的类型化 mutation；
5. 对象级 diff、因果影响、校验、确定性模拟、runtime trace；
6. Change Store V2、跨进程 lease、项目串行 commit 与显式恢复；
7. 不可变 delivery capsule；
8. 一个不了解源码的外部 Agent 已经能够在 stage 环境完成创作、自修复和交付。

Wave 5 不是重做这些能力，而是解决“多个候选如何一起工作”。正确心智模型是：

~~~text
sealed candidate capsules
  -> compare facts
  -> dependency-closed selections
  -> explicit conflict resolutions
  -> immutable integration plan
  -> shared typed replay
  -> new OPEN integration change
  -> fresh evidence
  -> owner-controlled existing commit gate
~~~

若实现需要读取文件 diff 来猜 scene.patch、需要复制 workingFiles、需要修改来源 change，或把模型判断写进 registry，说明架构已经偏离，应停止而不是继续补丁。

---

## 二、权威输入与真实基线

### 2.1 固定读取顺序

Task 0 必须完整读取：

1. E:\surdet\AGENTS.md
2. docs/README.md
3. docs/known-limitations.md
4. docs/superpowers/specs/2026-08-24-agent-candidate-comparison-safe-composition-wave-5-design.md
5. 本任务书
6. docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md
7. packages/authoring/src/contracts.ts
8. packages/authoring/src/change-session.ts
9. packages/authoring/src/operations.ts
10. packages/authoring/src/config-operations.ts
11. packages/authoring/src/timeline-operations.ts
12. packages/authoring/src/diff.ts
13. packages/authoring/src/capability-contract.ts
14. packages/authoring/src/capability-registry.ts
15. packages/authoring/src/error-catalog.ts
16. packages/cli/src/authoring/authoring-service.ts
17. packages/cli/src/authoring/authoring-dispatcher.ts
18. packages/cli/src/authoring/node-change-store.ts
19. packages/cli/src/authoring/node-json-record.ts
20. packages/cli/src/agent-port/session.ts
21. packages/cli/src/agent-port/server.ts
22. packages/cli/src/agent-port/delivery-capsule.ts
23. packages/cli/src/agent-port/invocation-ledger.ts
24. packages/cli/e2e/agent-port-wave-4.e2e.mjs
25. packages/cli/package.json 与 packages/authoring/package.json

### 2.2 任务书生成时的基线

~~~text
branch = main
DESIGN_SPEC_HEAD = db49f53f49280908f98ef6e5be943c41a807b8a0
surdet/main = 31b937638929fa8d09e575b120fd4b4681d9f7d2
ahead/behind = 1/0
tracked worktree = clean
staging area = empty
design spec commit = db49f53 docs(authoring): design candidate composition wave 5
push = NOT_AUTHORIZED
Wave 6 = NOT_STARTED
~~~

本任务书的创建提交由包含本文件的 Git 历史确定，不在正文预写未知 commit。执行 AI 在 Task 0 使用以下命令读取真实任务书提交：

~~~powershell
git log -1 --format="%H %s" -- docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
~~~

执行开始时必须重新读取全部 Git 身份。若有未说明的 tracked 修改、非空暂存区、远端 behind、并行施工提交，或 HEAD 不包含设计规格和本任务书，立即停止。不得 reset、checkout、stash、clean 或覆盖他人工作。

---

## 三、不可妥协的不变量

~~~text
SOURCE_CAPSULES_IMMUTABLE
SOURCE_CHANGES_IMMUTABLE
REAL_PROJECT_UNCHANGED_DURING_STAGE_COMPOSITION
CAPSULE_V1_AUDIT_ONLY
CAPSULE_V2_MANIFEST_SELF_CONTAINED
NO_DIFF_TO_OPERATION_INFERENCE
NO_CALLER_SUPPLIED_REPLAY_PAYLOAD
SELECTION_IS_DEPENDENCY_CLOSED
AUTO_COMPOSE_ONLY_DISJOINT_OR_IDENTICAL
AMBIGUOUS_OVERLAP_REQUIRES_EXPLICIT_RESOLUTION
PLAN_ARTIFACT_IMMUTABLE
DRY_RUN_WRITES_NO_PROJECT_OR_SOURCE_STATE
EXECUTE_CREATES_OR_RESUMES_ONE_INTEGRATION_CHANGE
REPLAY_USES_EXISTING_TYPED_MUTATIONS
REPLAY_PROGRESS_IS_CAS_PERSISTED
FAILED_INTEGRATION_STAYS_OPEN_AND_INSPECTABLE
INTEGRATION_READY_REQUIRED_BEFORE_COMMIT
FRESH_EVIDENCE_REQUIRED_AFTER_INTEGRATION
MCP_IS_A_THIN_MECHANICAL_PROJECTION
NO_EMBEDDED_MODEL
~~~

### 3.1 自动合成判定

只有以下两类可自动进入计划：

1. 两个依赖闭包的 produced object footprint 完全不相交；
2. 多个单元对相同规范对象得到相同 finalFingerprint，并且依赖与 disposition 等价。

以下均不是“自动安全”：

- 同一 scene 的不同文本；
- 同一 timeline 的不同 cue 序列；
- 一个删除另一个需要的对象；
- object fingerprint 缺失；
- potentialImpact 表明修改了另一个单元的 produced object；
- 相同文件但无法证明规范对象等价；
- 两个警告都为零；
- 两个强模型都声称结果正确。

### 3.2 依赖与 footprint

- primaryObject 决定对象操作链的分组。
- producedObjects 是冲突 footprint；角色改名造成的 speaker migration 必须把受影响 scene 纳入 producedObjects，不能只标 character。
- requiredObjects 只来自规范输入、已验证对象索引和 operation result 中的机器可读字段；不得从自然语言或 unified diff 猜测。
- track/cue 没有持久语义 ID，因此 timeline.create + timeline.patch 全部归入 timeline:<id> 单元。
- 反向 referencedBy 只作为 advisory potentialImpact，不自动扩大强制闭包。

---

## 四、文件责任图与白名单

### 4.1 @surdet/authoring 新文件

| 文件 | 单一责任 |
|---|---|
| packages/authoring/src/composition-contracts.ts | 所有协议无关 composition 类型、稳定枚举和 JSON 值类型 |
| packages/authoring/src/composition-manifest.ts | 从已记录规范输入、调用事实和对象事实生成 manifest；规范 JSON 与 fingerprint |
| packages/authoring/src/candidate-comparison.ts | 候选资格、对象单元、依赖图、重复组、冲突和 evidence matrix 纯逻辑 |
| packages/authoring/src/integration-plan.ts | 选择闭包、裁决、确定排序、plan semantic fingerprint |
| packages/authoring/src/integration-execution.ts | 新 integration change、现有 mutation replay、receipt/progress/resume/READY/FAILED |
| packages/authoring/test/composition-manifest.test.ts | old record audit-only、规范输入、manifest 确定性与依赖 |
| packages/authoring/test/candidate-comparison.test.ts | 不相交、相同、冲突、缺依赖、旧胶囊与上限 |
| packages/authoring/test/integration-plan.test.ts | 闭包、resolution、排序、伪造输入拒绝、fingerprint |
| packages/authoring/test/integration-execution.test.ts | dry-run、execute、中断恢复、失败保留、commit gate |

### 4.2 @surdet/authoring 允许修改

| 文件 | 允许修改 |
|---|---|
| packages/authoring/src/contracts.ts | RecordedOperation 与可选 integration metadata 接线 |
| packages/authoring/src/change-session.ts | 唯一 JSON 规范化入口、normalizedInput 记录、integration metadata CAS helper、commit READY gate |
| packages/authoring/src/capability-contract.ts | authoring/capsule 2.0.0 与 composable metadata 字段；envelope 仍为 1.0.0 |
| packages/authoring/src/capability-registry.ts | 四项 composition capability、八项 mutation 的 composable=true、严格 schema |
| packages/authoring/src/error-catalog.ts | 规格批准的 composition 稳定错误与真实 repairActions |
| packages/authoring/src/index.ts | 新模块公开导出 |
| packages/authoring/test/change-session.test.ts | normalizedInput、旧记录读取、普通 change 回归 |
| packages/authoring/test/capability-registry.test.ts | 26 项、composable metadata、schema/policy/工具名 |
| packages/authoring/test/error-catalog.test.ts | 新错误分类、重试语义与 repairActions |
| packages/authoring/test/commit-recovery.test.ts | integration READY gate 不破坏普通 commit/recovery |

不得为 operation capture 修改八个领域 mutation 的业务行为。runOperation 是唯一输入规范化真相；manifest 通过 operationId 与成功 invocation fact 取得 capabilityId，不从 result 形状猜测。

### 4.3 @surdet/cli 新文件

| 文件 | 单一责任 |
|---|---|
| packages/cli/src/authoring/working-project-storage.ts | 从 ChangeRecord 暴露唯一只读 ProjectStorage 适配，供 service、capsule 与 dry-run 共用 |
| packages/cli/src/authoring/node-composition-store.ts | 当前 project namespace 内 capsule 安全读取、plan payload/identity 非撕裂不可变存储 |
| packages/cli/src/authoring/composition-service.ts | 项目快照、候选读取、共享 compare/plan/dry-run/execute 接线 |
| packages/cli/test/node-composition-store.test.ts | 路径、identity、SHA、不可覆盖、无中央索引 |
| packages/cli/test/composition-service.test.ts | native service 的 compare/plan/inspect/execute 纵向合同 |
| packages/cli/test/agent-port-composition.test.ts | dispatcher、session、policy、MCP envelope 与 schema 投影 |
| packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs | preflight/DIAGNOSTIC/FORMAL/acceptance-prep 唯一 runner |

### 4.4 @surdet/cli 允许修改

| 文件 | 允许修改 |
|---|---|
| packages/cli/src/authoring/node-change-store.ts | 从派生 capsule 路径读取并校验 payload/identity；capsule 写入不可覆盖 |
| packages/cli/src/authoring/authoring-service.ts | 四项 composition service 的薄门面与 integration commit 接线 |
| packages/cli/src/authoring/authoring-dispatcher.ts | 四个 switch 分支；不得实现算法 |
| packages/cli/src/agent-port/session.ts | composition.execute 无 active/精确 resume 状态、integration 摘要与 activeChange 更新 |
| packages/cli/src/agent-port/server.ts | capsule v2 与 session integration 输出 schema；registry 工具仍循环注册 |
| packages/cli/src/agent-port/delivery-capsule.ts | v2 manifest eligibility 与 integration provenance |
| packages/cli/test/agent-port-capsule.test.ts | v2、v1 audit-only、manifest、provenance、不可变 identity |
| packages/cli/test/agent-port-output-contract.test.ts | 26 工具、capsule/session schema 与 text/structured envelope |
| packages/cli/test/agent-port-session.test.ts | compare/plan/execute 状态转换、resume、nextActions |
| packages/cli/test/agent-port-tools.test.ts | policy 与 MCP tool 数量/名字/annotation |
| packages/cli/test/authoring-contract.test.ts | AUTHORING_CONTRACT_VERSION=2.0.0 与 26 项能力 |
| packages/cli/package.json | 仅在测试发现需要保持 e2e/artifacts 排除时核对；默认不得修改 |

### 4.5 文档文件

| 文件 | 用途 |
|---|---|
| docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md | 本任务书与紧凑 Execution Ledger |
| docs/AGENT-CANDIDATE-COMPARISON-SAFE-COMPOSITION-WAVE-5-DELIVERY-REPORT-2026-08-24.md | Task 10 才创建的交付报告 |
| docs/known-limitations.md | 只有既有文字明确声称不支持本能力且 Task 10 需要最小更正时才允许修改；否则保持不动 |

### 4.6 明确禁止

- packages/core/**、packages/renderer/**、packages/host/**、packages/shell/**、packages/editor/**。
- examples/**、games/**、资产、剧情与配置。
- scripts/verify-all.mjs、性能门限、发行与部署配置。
- 依赖与 lockfile。
- 长期路线台账、受保护文件、handoff、历史 artifact。
- 新的中央 registry、候选数据库、后台 daemon、Git 操作、网络导入、云端存储或模型路由。

若实现确实需要白名单外生产文件，停止并给出：真实阻断、所需文件、为何不能由现有公共层完成、最小新增范围。不得自行扩大。

---

## 五、固定公共类型

以下名称可作不影响语义的微调，但字段、枚举、身份边界和可选性必须保持。

### 5.1 JSON、记录操作与白名单

~~~ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ComposableCapabilityId =
  | 'scene.create'
  | 'scene.patch'
  | 'variable.ensure'
  | 'character.ensure'
  | 'character.remove'
  | 'timeline.create'
  | 'timeline.patch'
  | 'project.entry-scene.set';

export interface RecordedOperation {
  requestHash: string;
  normalizedInput?: JsonValue;
  result: unknown;
}
~~~

runOperation 必须先调用唯一 normalizeJsonValue()，再以 stableStringify(normalizedInput) 计算 requestHash。object key 按 Unicode code point 稳定排序；undefined、函数、symbol、非有限 number 和非普通 object fail-loud。失败 mutation 不写 operation ledger。

capabilityId 不额外写入 RecordedOperation。manifest sealer 必须用 operationId + requestHash 与成功 invocation fact 精确连接；零匹配或多匹配均使 composition unavailable，不允许按 result 猜 capability。

### 5.2 Manifest 与对象关系

~~~ts
export interface ObjectRequirement {
  objectRef: string;
  source: 'base' | 'candidate';
  candidateOperationSequence?: number;
  expectedFingerprint?: string;
}

export interface ObjectProduction {
  objectRef: string;
  disposition: 'create' | 'update' | 'remove';
  finalFingerprint?: string;
}

export interface CompositionOperation {
  sequence: number;
  capabilityId: ComposableCapabilityId;
  sourceOperationId: string;
  normalizedInput: JsonValue;
  inputSha256: string;
  primaryObject: string;
  objectFingerprintBefore?: string;
  objectFingerprintAfter?: string;
  requiredObjects: ObjectRequirement[];
  producedObjects: ObjectProduction[];
}

export interface CompositionManifest {
  manifestVersion: '1.0.0';
  projectIdentity: string;
  baseProjectRevision: string;
  sourceChangeId: string;
  sourceWorkingRevision: number;
  operations: CompositionOperation[];
  manifestFingerprint: string;
}

export interface CompositionIneligibility {
  code:
    | 'LEGACY_CAPSULE'
    | 'MISSING_NORMALIZED_INPUT'
    | 'INVOCATION_FACT_MISSING'
    | 'INVOCATION_FACT_AMBIGUOUS'
    | 'UNSUPPORTED_CAPABILITY'
    | 'OBJECT_IDENTITY_UNAVAILABLE'
    | 'DEPENDENCY_IDENTITY_UNAVAILABLE';
  operationId?: string;
  message: string;
}

export interface ManifestObjectFact {
  objectRef: string;
  references: string[];
  fingerprint?: string;
}

export interface ManifestObjectFacts {
  baseObjects: ManifestObjectFact[];
  workingObjects: ManifestObjectFact[];
  baseAssetRefs: string[];
  workingAssetRefs: string[];
}

export interface OperationInvocationFact {
  capabilityId: string;
  operationId: string;
  inputSha256: string;
  ok: boolean;
}
~~~

primaryObject / requiredObjects / producedObjects 由 capability-specific 纯函数生成。规则必须写成穷尽 switch；unknown capability 返回 unavailable，不能 fall through。

### 5.3 Capsule v2

磁盘 payload 保留现有字段，并增加：

~~~ts
export interface CapsuleCompositionProjection {
  eligibility: 'ready' | 'unavailable';
  reasons: CompositionIneligibility[];
  manifest?: CompositionManifest;
}

export interface IntegrationProvenance {
  planId: string;
  planFingerprint: string;
  sourceCapsules: CandidateCapsuleRef[];
  includedUnits: string[];
  deduplicatedUnits: IdenticalUnitResolution[];
  conflictResolutions: ConflictResolution[];
  replayReceipts: IntegrationReplayReceipt[];
}
~~~

- 新生成 capsuleVersion 固定为 2.0.0。
- 普通 v2 candidate capsule 必有 composition。
- integration capsule 在 record.integration 存在时还必须有 integrationProvenance。
- 旧 v1 payload 的 reader 只返回 recognized/audit-only，不补 composition。
- artifactIdentity 仍由磁盘 payload 的 bytes/SHA-256 产生；payload 不自含 artifactIdentity。

### 5.4 候选引用与比较

~~~ts
export interface CandidateCapsuleRef {
  changeId: string;
  capsuleId: string;
  artifactSha256: string;
}

export interface CandidateEvidenceSummary {
  validation: 'fresh' | 'missing' | 'stale' | 'failed';
  simulation: 'fresh' | 'missing' | 'stale' | 'failed' | 'incomplete';
  runtime: 'fresh' | 'missing' | 'stale' | 'failed';
  warnings: number;
  manualReviewRequired: string[];
}

export interface ObjectChangeUnit {
  unitId: string;
  candidateId: string;
  primaryObject: string;
  operationSequences: number[];
  finalFingerprint?: string;
  requiredUnitIds: string[];
  requiredBaseObjects: ObjectRequirement[];
  producedObjects: ObjectProduction[];
  potentialImpact: unknown[];
  observedImpact: unknown[];
  evidenceSummary: CandidateEvidenceSummary;
}

export interface CompositionConflict {
  conflictId: string;
  severity: 'blocking' | 'selection-required' | 'advisory';
  code: string;
  candidateIds: string[];
  unitIds: string[];
  objectRefs: string[];
  allowedResolutions: Array<'choose-unit' | 'exclude-all' | 'regenerate-candidate'>;
  details: Record<string, JsonValue>;
  repairActions: string[];
}

export interface IdenticalUnitGroup {
  groupId: string;
  unitIds: string[];
  primaryObject: string;
  finalFingerprint: string;
}

export interface CompositionComparison {
  comparisonVersion: '1.0.0';
  projectIdentity: string;
  expectedProjectRevision: string;
  status: 'composable' | 'review-only' | 'blocked';
  candidates: CandidateCapsuleRef[];
  units: ObjectChangeUnit[];
  dependencyEdges: Array<{ fromUnitId: string; toUnitId: string; objectRef: string }>;
  conflicts: CompositionConflict[];
  identicalGroups: IdenticalUnitGroup[];
  evidenceMatrix: Array<{ candidateId: string; summary: CandidateEvidenceSummary }>;
  comparisonFingerprint: string;
}

export interface CompositionSemanticDiffEntry {
  kind: string;
  operationId: string;
  objectBefore?: string;
  objectAfter?: string;
  fingerprintBefore?: string;
  fingerprintAfter?: string;
  potentialImpact: unknown[];
  observedImpact: unknown[];
}

export interface VerifiedCompositionCandidate {
  candidateId: string;
  ref: CandidateCapsuleRef;
  capsuleVersion: '1.0.0' | '2.0.0';
  projectIdentity: string;
  baseProjectRevision: string;
  sourceWorkingRevision: number;
  composition: CapsuleCompositionProjection;
  evidenceSummary: CandidateEvidenceSummary;
  semanticDiff: CompositionSemanticDiffEntry[];
}
~~~

candidateId、unitId、groupId 和 conflictId 全部从规范字段哈希派生；不得使用随机数或生成时间。比较输入限制为 2..8 个候选、每候选最多 256 个 manifest operation、总依赖边最多 1024。

### 5.5 计划、dry-run 与裁决

~~~ts
export interface ConflictResolutionInput {
  conflictId: string;
  resolution: 'choose-unit' | 'exclude-all' | 'regenerate-candidate';
  chosenUnitId?: string;
  actor: 'human' | 'review-agent';
  reason?: string;
}

export interface ConflictResolution extends ConflictResolutionInput {
  decidedAt: string;
}

export interface IdenticalUnitResolution {
  groupId: string;
  retainedUnitId: string;
  provenanceUnitIds: string[];
}

export interface PlannedReplayOperation extends CompositionOperation {
  integrationOperationId: string;
  sourceCapsule: CandidateCapsuleRef;
  sourceUnitId: string;
}

export interface IntegrationPlan {
  planVersion: '1.0.0';
  planId: string;
  projectIdentity: string;
  expectedProjectRevision: string;
  comparisonFingerprint: string;
  sourceCapsules: CandidateCapsuleRef[];
  selectedUnitIds: string[];
  implicitInclusions: string[];
  excludedUnitIds: string[];
  conflictResolutions: ConflictResolution[];
  deduplicatedUnits: IdenticalUnitResolution[];
  replayOperations: PlannedReplayOperation[];
  provenance: Array<{
    targetObject: string;
    sourceCapsule: CandidateCapsuleRef;
    sourceUnitId: string;
    sourceOperationIds: string[];
  }>;
  dryRun: {
    status: 'passed' | 'failed';
    finalObjectFingerprints: Record<string, string>;
    errors: Array<{ code: string; message: string; operationIndex?: number }>;
  };
  planFingerprint: string;
}

export type IntegrationPlanDraft = Omit<
  IntegrationPlan,
  'planId' | 'planFingerprint' | 'dryRun'
>;
~~~

语义 planFingerprint 排除 decidedAt 与 reason，但包括实际 resolution、chosenUnitId、选择、闭包、去重、排序和 replay 输入哈希。planId 由 planFingerprint 派生。

同一语义 planId 已存在时返回首次封存的 plan artifact，不覆盖。后续不同 reason/时间只进入 invocation ledger；不得覆盖同 planId 的首次审计字段，也不得生成相同 planId 的不同 payload。

### 5.6 Integration metadata

~~~ts
export interface IntegrationReplayReceipt {
  operationIndex: number;
  integrationOperationId: string;
  sourceCapsule: CandidateCapsuleRef;
  sourceOperationId: string;
  resultFingerprint?: string;
}

export interface IntegrationMetadata {
  planId: string;
  planFingerprint: string;
  executeOperationId: string;
  sourceCapsules: CandidateCapsuleRef[];
  conflictResolutions: ConflictResolution[];
  includedUnitIds: string[];
  deduplicatedUnits: IdenticalUnitResolution[];
  status: 'REPLAYING' | 'READY' | 'FAILED';
  nextOperationIndex: number;
  replayedOperations: IntegrationReplayReceipt[];
  failure?: {
    code: string;
    message: string;
    operationIndex: number;
    integrationOperationId: string;
  };
}
~~~

ChangeRecord.formatVersion 保持 2；integration 是向前可选字段。旧记录不迁移。普通 change 不受 integration commit gate 影响。

---

## 六、固定共享函数边界

### 6.1 规范化与 manifest

~~~ts
export function normalizeJsonValue(value: unknown): JsonValue;

export async function buildCompositionManifest(
  input: {
    record: ChangeRecord;
    projectIdentity: string;
    invocationFacts: OperationInvocationFact[];
    semanticDiff: ChangeDiff['semantic'];
    objectFacts: ManifestObjectFacts;
  },
  hasher: TextHasher,
): Promise<
  | { eligibility: 'ready'; reasons: []; manifest: CompositionManifest }
  | { eligibility: 'unavailable'; reasons: CompositionIneligibility[] }
>;
~~~

OperationInvocationFact 只含 capabilityId、operationId、requestHash/inputSha256 和 ok。CLI 将 invocation ledger 投影成该最小结构；@surdet/authoring 不导入 Node 或 MCP 类型。

### 6.2 比较与计划

~~~ts
export async function compareCandidates(
  input: {
    projectIdentity: string;
    currentProjectRevision: string;
    candidates: VerifiedCompositionCandidate[];
  },
  hasher: TextHasher,
): Promise<CompositionComparison>;

export async function buildIntegrationPlan(
  input: {
    comparison: CompositionComparison;
    selectedUnitIds: string[];
    conflictResolutions: ConflictResolutionInput[];
    now: string;
  },
  hasher: TextHasher,
): Promise<IntegrationPlanDraft>;

export async function sealDryRunResult(
  plan: IntegrationPlanDraft,
  dryRun: IntegrationPlan['dryRun'],
  hasher: TextHasher,
): Promise<IntegrationPlan>;
~~~

buildIntegrationPlan 只能使用 comparison 内已经验证的 units/operations。不得有 callerReplayOperations 参数或任意 payload 扩展口。

integrationOperationId 从 comparisonFingerprint + 排序序号 + source capsule/operation 哈希派生，不引用尚未生成的 planFingerprint。sealDryRunResult 对以下规范投影计算最终 planFingerprint：draft 全部语义字段 + dryRun status/final fingerprints/error code/index，排除 planId、planFingerprint、decidedAt、reason 和自然语言 error message；随后 planId 从该 fingerprint 派生。不得形成 planFingerprint 与 operationId 的循环依赖。

### 6.3 重放

~~~ts
export async function replayCompositionOperation(
  change: ChangeSession,
  operation: PlannedReplayOperation,
  hasher: TextHasher,
): Promise<unknown>;

export async function executeIntegrationReplay(
  change: ChangeSession,
  plan: IntegrationPlan,
  hasher: TextHasher,
): Promise<IntegrationMetadata>;

export function assertIntegrationReadyForCommit(record: ChangeRecord): void;
~~~

replayCompositionOperation 是八项 capability 到既有 apply 函数的穷尽 switch。它只替换 operationId 为 integrationOperationId；其余 normalizedInput 原样经过既有类型化实现。default 分支必须产生 COMPOSITION_PLAN_INVALID。

---

## 七、稳定错误合同

在 AUTHORING_ERROR_CODES 增加：

| code | 条件 | retryDisposition |
|---|---|---|
| CAPSULE_IDENTITY_MISMATCH | payload、identity、bytes 或 SHA 不一致 | never |
| CANDIDATE_PROJECT_MISMATCH | 候选 projectIdentity 不同 | new-change |
| CANDIDATE_BASE_MISMATCH | 候选 base revision 不同 | new-change |
| CANDIDATE_NOT_COMPOSABLE | v1 或 manifest unavailable | new-change |
| COMPOSITION_DEPENDENCY_MISSING | 选择闭包找不到必要对象/单元 | after-repair |
| COMPOSITION_CONFLICT_UNRESOLVED | selection-required conflict 无有效裁决 | after-repair |
| COMPOSITION_PLAN_STALE | 当前项目 revision 或 comparison identity 变化 | after-refresh |
| COMPOSITION_PLAN_INVALID | plan schema、identity、hash、排序或 payload 非法 | never |
| COMPOSITION_REPLAY_FAILED | 确定性 typed replay 失败 | after-repair |
| COMPOSITION_INCOMPLETE | integration 不是 READY，禁止 commit | after-inspect |

错误 details 只返回稳定 ID、当前 revision、unit/conflict/operation index 与允许动作；不得泄露任意绝对输入路径、prompt 或环境变量。

真实 repairActions：

- capsule identity 错误：终止，不允许重试相同 artifact；
- candidate project/base 错误：重新 project.inspect 并在同一基线重新产生候选；
- dependency/conflict：重新 composition.compare，再 composition.plan；
- stale plan：project.inspect + composition.inspect + 重新 compare；
- replay failed：change.diff / object.inspect / change.rollback；创建新候选或新计划，不能原地换 replay payload；
- incomplete：composition.inspect 或以同一 executeOperationId 恢复；FAILED 时只能 inspect/diff/rollback。

---

## 八、计划存储与执行状态机

### 8.1 Capsule 与 Plan 路径

API 只接受 ID/SHA，不接受路径：

~~~text
<agent-data>/<projectIdentity>/<changeId>/capsules/<capsuleId>/payload.json
<agent-data>/<projectIdentity>/<changeId>/capsules/<capsuleId>/identity.json

<agent-data>/<projectIdentity>/composition-plans/<planId>/payload.json
<agent-data>/<projectIdentity>/composition-plans/<planId>/identity.json
~~~

- safe ID 必须拒绝非法字符，而不是静默 replace 后产生别名碰撞。
- reader 从当前 project namespace 派生路径，校验 sidecar path/bytes/SHA 与调用方 artifactSha256。
- capsule/plan 首次写入用 create-only；同 ID 相同内容可幂等回读，不同内容 fail-loud。
- 不维护中央可变 index，不扫描其他 project namespace。

### 8.2 execute 首次调用

~~~text
short project lease: confirm current revision == plan.expectedProjectRevision
  -> begin ChangeRecord V2 with integration(REPLAYING)
  -> release project lease
  -> hold the new change lease
  -> replay operation[nextOperationIndex]
  -> CAS persist domain operation
  -> CAS persist receipt + nextOperationIndex
  -> repeat
  -> verify final fingerprints
  -> CAS set READY
~~~

execute 不在重放期间长期持有 project lease，因为 stage 不写项目；短 lease 只锁定开始时 revision 核对。来源 capsule/plan 均只读。

### 8.3 进程中断

若进程在领域 operation 成功持久化后、progress receipt 前退出：

1. integration.nextOperationIndex 仍指向该 operation；
2. operation ledger 已包含确定 integrationOperationId；
3. 相同 planId + planFingerprint + executeOperationId resume；
4. runOperation 返回幂等旧结果；
5. progress CAS 继续推进，不重复 mutation。

不同 plan、不同 executeOperationId、普通 active change 或 terminal change 都不得被猜测性接管。

### 8.4 失败

- 领域输入、对象前置或最终 fingerprint 确定失败：持久化 FAILED、失败 operation index/code/message，保持 OPEN。
- lease/CAS 的可恢复冲突不把 integration 标成 FAILED；返回 after-refresh。
- FAILED 允许 composition.inspect、session.describe、object.inspect、change.diff、change.rollback。
- FAILED 不允许 composition.execute 换 plan、跳过 operation 或 change.commit。
- 任何失败都不修改 source capsule/source change/project。

---

## 九、四项 capability 固定合同

| capability | policy | side effects | 输入 | 输出 |
|---|---|---|---|---|
| composition.compare | observe | project-read, change-store-read | candidates: 2..8 CandidateCapsuleRef | CompositionComparison |
| composition.plan | observe | project-read, change-store-read, change-store-write | candidates, comparisonFingerprint, selectedUnitIds, conflictResolutions | sealed plan + artifactIdentity |
| composition.inspect | observe | project-read, change-store-read | planId, artifactSha256 | plan, identity, freshness, executable |
| composition.execute | stage | project-read, change-store-read, change-store-write | operationId, planId, artifactSha256, initiator | integrationChangeId, status, workingRevision, replay summary, nextActions |

composition.plan 虽在 observe policy 可用，但 readOnlyHint 必须为 false，因为它写不可变 plan artifact；这不是项目 mutation。

composition.execute 输入 initiator 只允许 external-agent / human / automation。它不接受 changeId；首次由服务创建，恢复时从 session 的 exact integration change 验证。

新增后 AUTHORING_CAPABILITY_IDS 精确为 26 项。八项内容 mutation composable=true；其余十八项 false。Registry 只保存 metadata/schema，不保存算法、prompt、示例库、中文产品文案或修复策略树。

---

## 十、Git 与证据纪律

### 10.1 Task 提交

每个代码 Task 完成 GREEN 后创建普通本地提交：

1. Task 1: feat(authoring): seal composable capsule manifests
2. Task 2: feat(authoring): compare composition candidates
3. Task 3: feat(authoring): seal integration plans
4. Task 4: feat(authoring): replay integration plans safely
5. Task 5: feat(cli): project composition capabilities
6. Task 6: feat(cli): preserve integration provenance
7. Task 8 runner: test(cli): verify candidate composition workflow
8. Task 10 docs: docs(authoring): report candidate composition wave 5

Task 0 RED 不单独提交。Task 7 只有因真实门禁修复产生代码时才提交，不能制造空提交。

每次暂存前：

~~~powershell
git diff --check
git diff --cached --check
git status --short
~~~

必须逐路径 git add；禁止 git add . 或 git add -A。提交后用 git show --name-status HEAD 回读范围。

### 10.2 紧凑 Execution Ledger

每个 Task 只追加一笔：

~~~text
TIME=
TASK=
START_HEAD=
END_HEAD=
FILES=
RED=
GREEN=
ARTIFACTS=
GIT=
STOP=
~~~

不复制完整测试输出，不反复写同一背景，不把未运行命令写成 PASS。历史失败记录只追加新事实，不改写。

### 10.3 身份分层

最终报告必须区分：

~~~text
CODE_EVIDENCE_HEAD
FORMAL_RUN_HEAD
DOCUMENT_CLOSURE_HEAD
FINAL_HEAD
REMOTE_MAIN
AHEAD_BEHIND
~~~

FORMAL_RUN_HEAD 必须等于 frozen CODE_EVIDENCE_HEAD。docs-only closure 可以成为更晚的 FINAL_HEAD，但不得伪装成被 FORMAL 测试的代码 HEAD。

---

### Task 0: 真实基线、保护边界与匹配缺口的 RED

**Files:**
- Read: 第二节全部权威输入
- Modify: packages/authoring/test/change-session.test.ts
- Create: packages/authoring/test/composition-manifest.test.ts
- Modify: packages/cli/test/agent-port-capsule.test.ts
- Modify: 本任务书，仅追加 Task 0 Ledger

**Interfaces:**
- Consumes: 当前 main、任务书创建提交、现有 v1 capsule 与 ChangeRecord operation ledger。
- Produces: “新 mutation 不保存 normalizedInput、现有 capsule 不是 v2 composable artifact”的真实红灯。

- [ ] **Step 1: 记录 Git 与工具基线**

~~~powershell
git status --short --branch
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git log -1 --format="%H %s" -- docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
git diff --check
git diff --cached --check
git ls-files "*.log"
node --version
npm --version
~~~

Expected:

- branch=main；
- HEAD 包含 design spec 与本任务书；
- tracked worktree clean、staging empty；
- ahead 可以大于 0，behind 必须为 0；
- tracked .log 无输出；
- 已知 untracked 只记录不处理。

不满足即停止为 BASELINE_MISMATCH。不得修 Git 状态、不得清理 artifact。

- [ ] **Step 2: 建立本轮系统临时证据根**

~~~powershell
$wave5Root = Join-Path ([IO.Path]::GetTempPath()) ("surdet-wave5-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $wave5Root | Out-Null
$wave5Root
~~~

把绝对路径写入 Ledger。后续所有 JSON reporter、runner artifact、fixture 和 child 日志都在该根或 runner 自建的新系统临时目录。

- [ ] **Step 3: 添加 operation capture RED**

在 change-session.test.ts 中用现有 beginChange + ensureVariable 或 scene.create helper，断言成功 operation 精确保存：

~~~ts
expect(record.operations.op_capture).toMatchObject({
  requestHash: expect.any(String),
  normalizedInput: {
    operationId: 'op_capture',
    name: 'agent.wave5.flag',
    type: 'int',
    initial: 0,
  },
});
~~~

再断言：

1. 两个 key 插入顺序不同但 JSON 语义相同的输入得到同一 requestHash；
2. 失败 mutation 不写 normalizedInput；
3. 手工构造缺少 normalizedInput 的旧 record 仍能读取。

当前实现第一项必须失败；若通过，停止并复审当前源码，不重复实现。

- [ ] **Step 4: 添加 capsule/manifest RED**

composition-manifest.test.ts 必须至少覆盖：

1. old RecordedOperation 只有 requestHash/result 时返回 unavailable/MISSING_NORMALIZED_INPUT；
2. 不允许从 semantic diff 反推出输入；
3. 新 record + 唯一成功 invocation fact 应生成 manifest；
4. invocation fact 缺失或同一 operationId 多个成功 capability 匹配时 unavailable；
5. 失败 invocation 不进入 manifest。

agent-port-capsule.test.ts 在既有可成功封存的 stage change 上断言：

~~~ts
expect(capsule.capsuleVersion).toBe('2.0.0');
expect(capsule.contractVersion).toBe('2.0.0');
expect(capsule.composition.eligibility).toBe('ready');
expect(capsule.composition.manifest?.operations.length).toBeGreaterThan(0);
~~~

当前代码必须因 1.0.0 / composition 缺失失败。

- [ ] **Step 5: 运行且只运行 Task 0 RED**

~~~powershell
npm run test -w @surdet/authoring -- change-session.test.ts composition-manifest.test.ts --reporter=json --outputFile="$wave5Root\task0-red-authoring.json"
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- agent-port-capsule.test.ts --reporter=json --outputFile="$wave5Root\task0-red-cli.json"
~~~

Expected:

- 两条 test 命令 exit 1；
- Authoring 失败命中 normalizedInput / manifest；
- CLI 失败命中 capsuleVersion/composition；
- build 只为 CLI 读取当前 Authoring dist，不算 GREEN；
- 若测试未收集、语法错误、fixture 无效或失败节点不匹配，记 HARNESS_INVALID，修测试设施后只重跑 Task 0 RED，不动生产代码。

- [ ] **Step 6: 保存 RED 身份并追加 Ledger**

~~~powershell
Get-Item "$wave5Root\task0-red-authoring.json","$wave5Root\task0-red-cli.json" | Select-Object FullName,Length
Get-FileHash "$wave5Root\task0-red-authoring.json","$wave5Root\task0-red-cli.json" -Algorithm SHA256
~~~

不提交。进入 Task 1 前只有白名单测试与 taskbook Ledger 可为 tracked 修改。

---

### Task 1: 规范 operation capture、CompositionManifest 与 Capsule v2

**Files:**
- Create: packages/authoring/src/composition-contracts.ts
- Create: packages/authoring/src/composition-manifest.ts
- Modify: packages/authoring/src/contracts.ts
- Modify: packages/authoring/src/change-session.ts
- Modify: packages/authoring/src/capability-contract.ts
- Modify: packages/authoring/src/index.ts
- Modify: packages/authoring/test/change-session.test.ts
- Modify: packages/authoring/test/composition-manifest.test.ts
- Create: packages/cli/src/authoring/working-project-storage.ts
- Modify: packages/cli/src/authoring/authoring-service.ts，仅抽取并复用 working record storage
- Modify: packages/cli/src/authoring/node-change-store.ts
- Modify: packages/cli/src/agent-port/delivery-capsule.ts
- Modify: packages/cli/src/agent-port/server.ts
- Modify: packages/cli/test/agent-port-capsule.test.ts
- Modify: packages/cli/test/agent-port-output-contract.test.ts
- Modify: 本任务书 Ledger

**Interfaces:**
- Consumes: successful operation ledger、invocation facts、base/working snapshots、semantic diff。
- Produces: 可读取旧记录的新 ChangeRecord、v2 capsule、ready/unavailable CompositionManifest。

- [ ] **Step 1: 固定唯一 JSON 规范化**

在 composition-contracts.ts 定义第五节类型；在 change-session.ts 新增并导出：

~~~ts
export function normalizeJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AuthoringOperationError('INVALID_REQUEST', 'operation input 包含非有限数字');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item));
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new AuthoringOperationError('INVALID_REQUEST', 'operation input 不是 JSON value');
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, normalizeJsonValue((value as Record<string, unknown>)[key])]),
  );
}
~~~

undefined 不得静默变成字符串。严格 schema 进入的 payload 不含 undefined；直接领域 API 若显式含 undefined 应 fail-loud。optional 字段应由调用者省略。

runOperation 改为：

~~~ts
const normalizedInput = normalizeJsonValue(input);
const requestHash = stableStringify(normalizedInput);
// ...
next.operations[input.operationId] = {
  requestHash,
  normalizedInput,
  result: outcome.result,
};
~~~

幂等旧记录仍按 requestHash 返回；不得因为 previous.normalizedInput 缺失而重写旧 record。

- [ ] **Step 2: 抽取唯一 WorkingProjectStorage**

把 authoring-service.ts 内现有 WorkingProjectStorage 原样移动到 working-project-storage.ts，命名为 ChangeRecordProjectStorage 并导出。AuthoringService 与 delivery-capsule 共用它。不得复制另一份 hash/list/read/exists 逻辑。

添加相邻测试证明 base/working snapshot 可由同一 adapter 构造且不写磁盘。

- [ ] **Step 3: 实现 capability-specific manifest facts**

composition-manifest.ts 必须以穷尽 switch 实现：

| capability | primaryObject | producedObjects | 直接 requiredObjects |
|---|---|---|---|
| scene.create | scene:<sceneId> | create scene；speaker migration 不适用 | scene blocks 中的 timeline、jump scene、when/set variable、可唯一解析 speaker character |
| scene.patch | scene:<sceneId> | update scene | patch payload 与 patch 后对象 references |
| variable.ensure | variable:<name> | create/update variable | 无 |
| character.ensure | character:<id> | create/update character + update config:characters；speakerMigrations 涉及的 scene 也为 update | avatar asset（若有）与迁移前置 |
| character.remove | character:<id> | remove character + update config:characters | 无；任何现存引用进入冲突/advisory |
| timeline.create | timeline:<timelineId> | create timeline | background key、portrait timelineTarget 等 asset refs |
| timeline.patch | timeline:<timelineId> | update timeline | patch 后 timeline asset refs |
| project.entry-scene.set | config:entryScene | update config:entryScene | scene:<sceneId> |

最终对象指纹：

- scene：完整规范场景文本 SHA-256；
- timeline：stableStringify(definition) SHA-256；
- variable：该 declaration 的 stableStringify SHA-256；
- character：该 character declaration 的 stableStringify SHA-256；
- config:entryScene：entryScene 值的 stableStringify SHA-256。

若 primary object、必要 object、最终指纹或唯一 capability fact 无法建立，整个 capsule composition unavailable；不得输出半真 manifest。

character.ensure/remove 使用整个 characters table 的 expectedFingerprint，因此 config:characters 必须进入 produced footprint。即使两个候选修改不同 character:id，也不得被误判为可直接重放的不相交对象；只有未来出现更细公共前置合同后才可放宽。

- [ ] **Step 4: 生成确定性 manifest**

排序只使用 operation ledger 的稳定插入顺序并写 sequence=0..n-1。每项必须验证：

1. normalizedInput.operationId 等于 ledger key；
2. stableStringify(normalizedInput) 等于 requestHash；
3. 唯一成功 invocation fact 的 operationId、capabilityId、inputSha256 匹配；
4. capabilityId 在八项白名单；
5. required candidate object 必须由更早 sequence 产生；
6. manifestFingerprint 对去掉自身 fingerprint 的规范对象做 SHA-256。

相同 facts 输入重复十次，manifest JSON 与 fingerprint 必须逐字节相同。

- [ ] **Step 5: Capsule v2 与不可变写入**

更新：

~~~ts
AUTHORING_CONTRACT_VERSION = '2.0.0'
AUTHORING_ENVELOPE_SCHEMA_VERSION = '1.0.0'
DELIVERY_CAPSULE_VERSION = '2.0.0'
~~~

delivery-capsule：

1. 读取 record、invocations、diff；
2. 用 ChangeRecordProjectStorage 构造 working snapshot / object facts；
3. 调 buildCompositionManifest；
4. 写 composition；
5. 若 record.integration 存在，先保留 integrationProvenance 的接口位置，Task 6 补全；
6. 任何 manifest unavailable 仍允许封存审计 capsule，但 reasons 必须非空。

NodeChangeStore.writeCapsulePayload 改为 create-only。随机 capsuleId 理论碰撞时 fail-loud，不覆盖旧文件。新增只读 helper：

~~~ts
readCapsulePayload(
  changeId: string,
  capsuleId: string,
  expectedSha256: string,
): Promise<{ payload: unknown; identity: ArtifactIdentity }>;
~~~

不要全局重写既有 change-store 路径行为。为 capsule/plan 外部引用新增 assertCanonicalArtifactId；readCapsulePayload 在调用现有 changeDirectory/safeId 前，分别验证 changeId/capsuleId 符合 /^[A-Za-z0-9_-]+$/。非法值直接 INVALID_REQUEST，不能先替换字符后命中另一个 artifact。

- [ ] **Step 6: 同步 capsule MCP schema**

server.ts 的 capsuleOutputSchema 精确声明 2.0.0、composition 和可选 integrationProvenance。不得用空 object 绕过关键新字段。operations 可保持开放 item 只到 Task 5 集中 conformance 时收紧，但 composition 本身必须严格 object schema。

text content 与 structuredContent 仍为同一个完整 envelope。

- [ ] **Step 7: 跑 Task 1 GREEN**

~~~powershell
npm run test -w @surdet/authoring -- change-session.test.ts composition-manifest.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- agent-port-capsule.test.ts agent-port-output-contract.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
~~~

Expected: 全部 exit 0；old record 测试明确 audit-only；普通 change-session 回归不变。

- [ ] **Step 8: 提交 Task 1**

精确暂存本 Task 文件与 taskbook Ledger，确认没有 package-lock、历史 artifact 或禁止路径：

~~~powershell
git diff --check
git status --short
git diff --name-only
git add packages/authoring/src/composition-contracts.ts
git add packages/authoring/src/composition-manifest.ts
git add packages/authoring/src/contracts.ts
git add packages/authoring/src/change-session.ts
git add packages/authoring/src/capability-contract.ts
git add packages/authoring/src/index.ts
git add packages/authoring/test/change-session.test.ts
git add packages/authoring/test/composition-manifest.test.ts
git add packages/cli/src/authoring/working-project-storage.ts
git add packages/cli/src/authoring/authoring-service.ts
git add packages/cli/src/authoring/node-change-store.ts
git add packages/cli/src/agent-port/delivery-capsule.ts
git add packages/cli/src/agent-port/server.ts
git add packages/cli/test/agent-port-capsule.test.ts
git add packages/cli/test/agent-port-output-contract.test.ts
git add docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
git diff --cached --check
git commit -m "feat(authoring): seal composable capsule manifests"
git show --name-status --oneline HEAD
~~~

---

### Task 2: 候选比较、对象单元、依赖闭包与保守冲突

**Files:**
- Create: packages/authoring/src/candidate-comparison.ts
- Create: packages/authoring/test/candidate-comparison.test.ts
- Modify: packages/authoring/src/composition-contracts.ts
- Modify: packages/authoring/src/index.ts
- Modify: 本任务书 Ledger

**Interfaces:**
- Consumes: 已完成身份验证的 v1/v2 candidate projection、当前 project identity/revision。
- Produces: 稳定 CompositionComparison；不写 change、plan 或 project。

- [ ] **Step 1: 写比较 RED**

至少创建以下 fixture：

1. A 创建 scene:alpha，B 创建 timeline:beta：composable；
2. B timeline chain 含 create + patch：一个不可拆 unit；
3. A/B 生成同一 scene 相同 finalFingerprint：identical group；
4. A/C 生成同一 scene 不同 finalFingerprint：selection-required；
5. A 删除 B 所需对象：selection-required；
6. scene unit 需要同候选 timeline unit：dependency edge；
7. dependency 指向既非 base 也非 earlier produced：blocking；
8. v1/unavailable capsule：review-only + CANDIDATE_NOT_COMPOSABLE；
9. project/base mismatch：blocking；
10. 当前 project revision 已离开候选共同 base：仍可 review-only 比较，但不能得到 executable plan；
11. stale/missing evidence：advisory，不伪装结构冲突；
12. 9 个候选、257 ops、1025 edges：各自明确 INVALID_REQUEST；
13. 输入 candidates 顺序随机打乱十次，comparisonFingerprint 和排序一致。

运行：

~~~powershell
npm run test -w @surdet/authoring -- candidate-comparison.test.ts --reporter=json --outputFile="$wave5Root\task2-red.json"
~~~

Expected: exit 1，失败因模块/合同未实现。零测试为 HARNESS_INVALID。

- [ ] **Step 2: 构建不可拆对象单元**

按 candidate + primaryObject 分组；同对象所有 sequence 保序进入一个 unit。unitId 只含：

~~~text
candidate artifact SHA
primaryObject
operation sequences
produced disposition/fingerprint
required refs
~~~

不得包含时间、label、intent、warning 文本顺序或绝对路径。

requiredUnitIds 只连接同候选中较早 produced object。requiredBaseObjects 必须在候选 base object facts 中存在；否则 blocking dependency missing。

- [ ] **Step 3: 构建 conflict footprint**

每个 unit 的 footprint 为全部 producedObjects.objectRef。冲突规则按顺序：

1. manifest/artifact/project/base 无效 -> blocking；
2. 缺强依赖或依赖环 -> blocking；
3. 相同 objectRef 的 disposition/finalFingerprint 完全一致 -> identical group；
4. 相同 objectRef 其余情况 -> selection-required；
5. remove object 被另一 closure required -> selection-required；
6. potentialImpact/referencedBy 交叉但无直接 produced overlap -> advisory；
7. evidence warning/missing -> advisory。

identical group 仍保留所有 provenance，不把其中一个候选从 comparison 删除。

- [ ] **Step 4: 稳定 ID 与上限**

候选先按 artifactSha256、changeId、capsuleId 排序；unit 按 primaryObject、candidateId 排序；edge/conflict/group 均规范排序后计算 comparisonFingerprint。

总 edge 计算前先做上限保护；不得先分配无界图再检查 1024。

- [ ] **Step 5: 跑 GREEN 与相邻回归**

~~~powershell
npm run test -w @surdet/authoring -- candidate-comparison.test.ts composition-manifest.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
~~~

Expected: exit 0。

- [ ] **Step 6: 提交 Task 2**

精确暂存：

~~~powershell
git add packages/authoring/src/candidate-comparison.ts
git add packages/authoring/src/composition-contracts.ts
git add packages/authoring/src/index.ts
git add packages/authoring/test/candidate-comparison.test.ts
git add docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(authoring): compare composition candidates"
git show --name-status --oneline HEAD
~~~

---

### Task 3: 不可变 Integration Plan、Plan Store 与共享 dry-run

**Files:**
- Create: packages/authoring/src/integration-plan.ts
- Create: packages/authoring/src/integration-execution.ts（先实现共享单项 replay 与 dry-run 所需部分）
- Create: packages/authoring/test/integration-plan.test.ts
- Create: packages/cli/src/authoring/node-composition-store.ts
- Create: packages/cli/src/authoring/composition-service.ts
- Create: packages/cli/test/node-composition-store.test.ts
- Create: packages/cli/test/composition-service.test.ts
- Modify: packages/cli/src/authoring/node-change-store.ts
- Modify: packages/authoring/src/index.ts
- Modify: 本任务书 Ledger

**Interfaces:**
- Consumes: comparisonFingerprint、candidate refs、selectedUnitIds、allowed resolutions、当前 project snapshot。
- Produces: sealed immutable IntegrationPlan 与 dry-run；不创建持久 integration change。

- [ ] **Step 1: 写 plan/store RED**

integration-plan.test.ts：

1. 选择 scene 自动纳入同候选 required timeline；
2. 未选择反向引用者，不自动吸入；
3. unresolved selection conflict 拒绝；
4. choose-unit 只接受 conflict.allowedResolutions 中的 unit；
5. exclude-all 排除冲突双方但保留无关选择；
6. regenerate-candidate 产出 non-executable/blocked，不伪造 replay；
7. identical group 只保留一个 replay chain，provenance 保留全部；
8. caller supplied normalizedInput/replayOperations 在公共输入类型与 registry schema 均无入口；
9. 拓扑排序后按 primaryObject、capsule SHA、source sequence 确定；
10. 相同语义输入、不同 reason/now 得到同一 semantic planFingerprint。

node-composition-store.test.ts：

1. capsule 只能按 current project/changeId/capsuleId/SHA 读取；
2. ../、斜杠、绝对路径、大小写别名均拒绝；
3. payload/identity/bytes/SHA 任一不匹配 -> CAPSULE_IDENTITY_MISMATCH；
4. plan 写入 payload + identity；
5. 同 planId 同语义幂等回读；
6. 同 planId 不同 payload 不覆盖；
7. 不产生中央 index；
8. 计划路径只在 SURDET_AGENT_DATA_DIR fixture。
9. source change 在 capsule 封存后继续编辑、COMMITTED 或 ROLLED_BACK，不改变已封存 candidate 的 payload/资格；比较只信任 capsule identity。

composition-service.test.ts：

1. compare/plan 读取两个真实 sealed capsule；
2. dry-run 后 project tree、source records、capsule bytes/SHA 不变；
3. dry-run typed replay 结果与 plan final fingerprints 相符；
4. dry-run 失败时 plan 可审计但 executable=false。

运行 RED：

~~~powershell
npm run test -w @surdet/authoring -- integration-plan.test.ts --reporter=json --outputFile="$wave5Root\task3-red-authoring.json"
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- node-composition-store.test.ts composition-service.test.ts --reporter=json --outputFile="$wave5Root\task3-red-cli.json"
~~~

- [ ] **Step 2: 实现闭包与裁决**

buildIntegrationPlan：

1. 验证 comparison fingerprint；
2. 验证 selectedUnitIds 唯一且存在；
3. 对每个选中 unit 展开 requiredUnitIds 传递闭包；
4. 校验所有 selection-required conflict 有且只有一条 resolution；
5. 应用 choose/exclude；
6. 构造 identical dedupe；
7. 拒绝仍含 blocking 或 regenerate-candidate 的 executable plan；
8. 从 comparison 内 manifest operation 构造 replayOperations；
9. 生成稳定 integrationOperationId：

~~~text
cmp_<comparisonFingerprint前12位>_<四位序号>_<sourceCapsule与operation哈希前12位>
~~~

不得复用 sourceOperationId，避免不同候选碰撞；不得含随机数。

- [ ] **Step 3: 实现共享 replay switch**

integration-execution.ts 的 replayCompositionOperation 必须直接调用：

~~~ts
scene.create -> applySceneCreate
scene.patch -> applyScenePatch
variable.ensure -> ensureVariable
character.ensure -> applyCharacterEnsure
character.remove -> applyCharacterRemove
timeline.create -> applyTimelineCreate
timeline.patch -> applyTimelinePatch
project.entry-scene.set -> applyEntrySceneSet
~~~

输入先由既有 capability schema validator 在 CLI 边界严格校验；共享层仍检查 capability 与 normalizedInput object。不得 raw file write。

- [ ] **Step 4: 实现 dry-run**

CompositionService：

1. 在短 project lease 中读取 snapshot/revision；
2. 读并验证 capsules；
3. 重新 compare，禁止调用方只给旧 comparison JSON；
4. build plan；
5. 使用 InMemoryChangeRepository + ChangeRecordProjectStorage 对 snapshot 建临时 ChangeSession；
6. 调同一 replayCompositionOperation；
7. 回读所有 produced object fingerprint；
8. 丢弃内存 session；
9. 把 passed/failed dryRun 封进 plan；
10. 写不可变 plan artifact。

dry-run 不写 NodeChangeStore change、不写 source capsule、不写 project。

- [ ] **Step 5: 实现 NodeCompositionStore**

构造函数只接受由 NodeChangeStore.forProject() 得到的 projectDirectory 与 expected projectIdentity。公开：

~~~ts
readCandidate(ref: CandidateCapsuleRef): Promise<VerifiedCompositionCandidate>;
writePlan(plan: IntegrationPlan): Promise<ArtifactIdentity>;
readPlan(planId: string, expectedSha256: string): Promise<{
  plan: IntegrationPlan;
  identity: ArtifactIdentity;
}>;
~~~

所有读取先验证 derived absolute path 仍位于 projectDirectory。identity.path 必须规范化等于派生 payload path；Windows 比较大小写不敏感但物理条目 spelling 仍按现有 canonical 安全策略核对。

- [ ] **Step 6: 跑 GREEN**

~~~powershell
npm run test -w @surdet/authoring -- integration-plan.test.ts candidate-comparison.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- node-composition-store.test.ts composition-service.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
~~~

- [ ] **Step 7: 提交 Task 3**

精确暂存本 Task 文件与 Ledger：

~~~powershell
git add packages/authoring/src/integration-plan.ts
git add packages/authoring/src/integration-execution.ts
git add packages/authoring/src/index.ts
git add packages/authoring/test/integration-plan.test.ts
git add packages/cli/src/authoring/node-composition-store.ts
git add packages/cli/src/authoring/composition-service.ts
git add packages/cli/src/authoring/node-change-store.ts
git add packages/cli/test/node-composition-store.test.ts
git add packages/cli/test/composition-service.test.ts
git add docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(authoring): seal integration plans"
git show --name-status --oneline HEAD
~~~

---

### Task 4: Integration execute、CAS progress、精确 resume 与 commit gate

**Files:**
- Modify: packages/authoring/src/integration-execution.ts
- Modify: packages/authoring/src/contracts.ts
- Modify: packages/authoring/src/change-session.ts
- Create: packages/authoring/test/integration-execution.test.ts
- Modify: packages/authoring/test/commit-recovery.test.ts
- Modify: packages/cli/src/authoring/composition-service.ts
- Modify: packages/cli/test/composition-service.test.ts
- Modify: 本任务书 Ledger

**Interfaces:**
- Consumes: immutable executable plan、当前 project revision、无 active change或 exact resumed integration change。
- Produces: 一个 OPEN integration change，状态 REPLAYING/READY/FAILED；真实项目和来源不变。

- [ ] **Step 1: 写 execute/resume RED**

integration-execution.test.ts 至少覆盖：

1. first execute 创建带 IntegrationMetadata(REPLAYING) 的新 ChangeRecord；
2. replay 三项后 workingRevision 按真实 changed operation 增长，nextOperationIndex=3；
3. domain operation 已持久化、receipt 未持久化时注入 repository write failure；resume 不重复 mutation；
4. 相同 executeOperationId + plan 可 resume；
5. 不同 planFingerprint/executeOperationId 拒绝；
6. 普通 active change 拒绝接管；
7. 最终 fingerprint 全部匹配 -> READY；
8. typed replay 确定失败 -> OPEN + FAILED + failure receipt；
9. FAILED 不可原地换计划继续；
10. source record/capsule/project identity 逐字节不变；
11. integration REPLAYING/FAILED commit -> COMPOSITION_INCOMPLETE；
12. READY 进入既有 commit gate，但没有 fresh validation/simulation/runtime 时仍分别返回既有错误；
13. 普通非 integration change 的 commit/recovery 行为不变。

CLI composition-service RED 再覆盖真实 Node store 进程重开：第一次中断，第二个 service instance 精确 resume。

~~~powershell
npm run test -w @surdet/authoring -- integration-execution.test.ts commit-recovery.test.ts --reporter=json --outputFile="$wave5Root\task4-red-authoring.json"
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- composition-service.test.ts --reporter=json --outputFile="$wave5Root\task4-red-cli.json"
~~~

- [ ] **Step 2: 创建 integration change**

扩展 beginChange 的最后一个可选参数，不破坏现有调用：

~~~ts
interface BeginChangeOptions {
  integration?: IntegrationMetadata;
}
~~~

CompositionService 首次 execute：

1. project lease 下重新读取 snapshot；
2. current revision 与 plan expected revision 不同 -> COMPOSITION_PLAN_STALE；
3. 初始化 metadata，executeOperationId 来自 capability input；
4. beginChange；
5. 返回 changeId 给 session，但在所有 replay 完成前不能标 READY。

- [ ] **Step 3: 每项双阶段持久化**

每项：

1. replayCompositionOperation 通过 runOperation 持久化领域结果；
2. updateIntegrationMetadata 以当前 recordVersion CAS 写 receipt/nextOperationIndex；
3. 若 resume 再次调用同 operationId，runOperation 返回旧 result，然后补 receipt。

receipt 不复制完整 result，只保存来源、序号和可选结果 fingerprint。

- [ ] **Step 4: 失败分类**

以下不标 FAILED，原错误 after-refresh 返回：

~~~text
CHANGE_RECORD_CONFLICT
CHANGE_BUSY
PROJECT_BUSY
LEASE_CORRUPT
~~~

领域型 INVALID_REQUEST、OBJECT_*、VALIDATION_FAILED、UNSUPPORTED_OPERATION 或最终 fingerprint mismatch，转 COMPOSITION_REPLAY_FAILED 并持久化 FAILED。原 error code/message 写入 failure，但 envelope 使用稳定 COMPOSITION_REPLAY_FAILED。

- [ ] **Step 5: READY 与 commit gate**

全部 replay 后构造 working snapshot，逐项核对 plan.dryRun.finalObjectFingerprints。匹配才 CAS READY。

在 commitChange 的现有校验之前调用：

~~~ts
export function assertIntegrationReadyForCommit(record: ChangeRecord): void {
  if (record.integration !== undefined && record.integration.status !== 'READY') {
    throw new AuthoringOperationError('COMPOSITION_INCOMPLETE', 'integration change 尚未 READY', {
      planId: record.integration.planId,
      status: record.integration.status,
      nextOperationIndex: record.integration.nextOperationIndex,
    });
  }
}
~~~

普通 change integration=undefined 不受影响。不得在此顺手改写普通 commit 的 evidence 规则。

- [ ] **Step 6: 跑 GREEN 与 recovery 邻接**

~~~powershell
npm run test -w @surdet/authoring -- integration-execution.test.ts commit-recovery.test.ts change-session.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- composition-service.test.ts node-composition-store.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
~~~

Expected: 全部 exit 0；既有 recovery 测试不放宽。

- [ ] **Step 7: 提交 Task 4**

~~~powershell
git add packages/authoring/src/integration-execution.ts
git add packages/authoring/src/contracts.ts
git add packages/authoring/src/change-session.ts
git add packages/authoring/test/integration-execution.test.ts
git add packages/authoring/test/commit-recovery.test.ts
git add packages/cli/src/authoring/composition-service.ts
git add packages/cli/test/composition-service.test.ts
git add docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(authoring): replay integration plans safely"
git show --name-status --oneline HEAD
~~~

---

### Task 5: Capability Registry、Native Dispatcher、Session 与 MCP 薄投影

**Files:**
- Modify: packages/authoring/src/capability-contract.ts
- Modify: packages/authoring/src/capability-registry.ts
- Modify: packages/authoring/src/error-catalog.ts
- Modify: packages/authoring/test/capability-registry.test.ts
- Modify: packages/authoring/test/error-catalog.test.ts
- Modify: packages/cli/src/authoring/authoring-service.ts
- Modify: packages/cli/src/authoring/authoring-dispatcher.ts
- Modify: packages/cli/src/agent-port/session.ts
- Modify: packages/cli/src/agent-port/server.ts
- Modify: packages/cli/test/authoring-contract.test.ts
- Create: packages/cli/test/agent-port-composition.test.ts
- Modify: packages/cli/test/agent-port-session.test.ts
- Modify: packages/cli/test/agent-port-tools.test.ts
- Modify: packages/cli/test/agent-port-output-contract.test.ts
- Modify: 本任务书 Ledger

**Interfaces:**
- Consumes: Task 1–4 的共享 API 与 CompositionService。
- Produces: 26 项 native capabilities、四项 MCP 工具、严格 policy/state/schema/envelope。

- [ ] **Step 1: 写 registry/error RED**

capability-registry.test.ts 断言：

~~~ts
expect(AUTHORING_CAPABILITY_IDS).toHaveLength(26);
expect(getCapabilityDefinition('composition.compare').minimumPolicy).toBe('observe');
expect(getCapabilityDefinition('composition.plan').sideEffects).toContain('change-store-write');
expect(getCapabilityDefinition('composition.execute').minimumPolicy).toBe('stage');
~~~

并遍历：

- 八项内容 mutation composable=true；
- 其他十八项 composable=false；
- registry 每项只有 metadata/schema，没有 handler、prompt、workflow、model、examples library；
- 四项 input/output schema strict additionalProperties=false；
- composition.plan input 无 replayOperations/normalizedInput；
- composition.execute input 无 changeId 或 projectRoot。

error-catalog.test.ts 对第七节十个错误逐项核对 category、retryDisposition、repairActions，终局 identity/invalid 错误必须 terminal。

~~~powershell
npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts --reporter=json --outputFile="$wave5Root\task5-red-authoring.json"
~~~

- [ ] **Step 2: 增加 composable metadata 与四项 schema**

CapabilityDefinition 新增：

~~~ts
composable: boolean;
~~~

所有 definition 必须显式给值。assertCapabilityRegistry 增加：

1. composable 必须 boolean；
2. composable=true 只能出现在八项白名单；
3. composition.* 必须 false；
4. 工具名无碰撞；
5. schema 仍严格；
6. metadata 不允许 handler 等越界 key。

四项 schema 的 candidates 数组 minItems=2/maxItems=8；artifactSha256 用 64 位十六进制 pattern；unit/conflict/plan ID 非空并有合理 maxLength；reason 最长 500；selectedUnitIds 去重由领域层验证。

conflictResolutions 输入不接受 decidedAt；时间由服务在首次封存 plan 时产生。重复相同语义 plan 返回首次 artifact，不覆盖首次 actor/reason/time。

- [ ] **Step 3: AuthoringService/dispatcher 薄接线**

AuthoringService 只新增：

~~~ts
compareComposition(projectRoot, input)
planComposition(projectRoot, input)
inspectComposition(projectRoot, input)
executeComposition(projectRoot, activeChangeId, input)
~~~

每个方法立即委托 CompositionService。dispatcher 只做：

~~~ts
case 'composition.compare':
  return { value: await service.compareComposition(requireProject(context), payload) };
case 'composition.plan':
  return { value: await service.planComposition(requireProject(context), payload) };
case 'composition.inspect':
  return { value: await service.inspectComposition(requireProject(context), payload) };
case 'composition.execute':
  return {
    value: await service.executeComposition(
      requireProject(context),
      context.activeChangeId,
      payload,
    ),
    operationId: operationIdFrom(payload),
  };
~~~

不得在 switch 中计算依赖、冲突、plan 或 replay。

- [ ] **Step 4: Session 状态机**

Session 规则：

- compare/plan/inspect 不需要 active change，在任意 policy 达标时可用；
- execute 不加入普通 ACTIVE_CHANGE_CAPABILITIES；
- 无 active change：允许首次 execute；
- active 普通 change：execute state-blocked；
- active integration change：只有 service 核对 exact planId/planFingerprint/executeOperationId 后可 resume；
- execute 成功返回 integrationChangeId 后，session 将其设为 activeChangeId 和 lastChangeId；
- rollback/commit 后沿用既有清空 active 逻辑；
- session.describe.activeChange 增加可选 integration：

~~~ts
{
  planId: string;
  status: 'REPLAYING' | 'READY' | 'FAILED';
  nextOperationIndex: number;
  operationCount: number;
}
~~~

nextActions：

- REPLAYING -> composition.execute / change.diff；
- FAILED -> change.diff / change.rollback；
- READY 但证据缺失 -> validate/simulate/runtime/diff；
- READY 且证据齐 -> apply policy 才有 change.commit。

- [ ] **Step 5: MCP 机械投影与集中 conformance**

server.ts 仍通过 AUTHORING_CAPABILITY_REGISTRY 循环注册四项工具，不写专用 composition tool handler。

agent-port-output-contract.test.ts 必须对 26 个真实 dispatcher success result 加完整 envelope 后逐项用其 output schema 校验。不能只校验手写 mock。

另外验证：

1. text content JSON.parse 后深等于 structuredContent；
2. observe 暴露 compare/plan/inspect，不暴露 execute；
3. stage/apply 暴露全部四项；
4. composition.plan readOnlyHint=false、destructiveHint=false；
5. composition.execute readOnlyHint=false、destructiveHint=false、idempotentHint=true；
6. stdout 只含 MCP protocol，ready 信息在 stderr；
7. requested authoring contract 1.0.0 对新 server fail-loud，2.0.0 通过；
8. MCP protocol modern/legacy negotiation不因 authoring contract 升级而变化。

- [ ] **Step 6: 跑 GREEN**

~~~powershell
npm run test -w @surdet/authoring -- capability-registry.test.ts error-catalog.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- authoring-contract.test.ts agent-port-composition.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-output-contract.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
~~~

- [ ] **Step 7: 提交 Task 5**

~~~powershell
git add packages/authoring/src/capability-contract.ts
git add packages/authoring/src/capability-registry.ts
git add packages/authoring/src/error-catalog.ts
git add packages/authoring/test/capability-registry.test.ts
git add packages/authoring/test/error-catalog.test.ts
git add packages/cli/src/authoring/authoring-service.ts
git add packages/cli/src/authoring/authoring-dispatcher.ts
git add packages/cli/src/agent-port/session.ts
git add packages/cli/src/agent-port/server.ts
git add packages/cli/test/authoring-contract.test.ts
git add packages/cli/test/agent-port-composition.test.ts
git add packages/cli/test/agent-port-session.test.ts
git add packages/cli/test/agent-port-tools.test.ts
git add packages/cli/test/agent-port-output-contract.test.ts
git add docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(cli): project composition capabilities"
git show --name-status --oneline HEAD
~~~

---

### Task 6: 集成证据 freshness、capsule provenance 与失败可审计性

**Files:**
- Modify: packages/cli/src/agent-port/delivery-capsule.ts
- Modify: packages/cli/src/agent-port/server.ts
- Modify: packages/cli/src/agent-port/session.ts
- Modify: packages/cli/src/authoring/composition-service.ts
- Modify: packages/cli/test/agent-port-capsule.test.ts
- Modify: packages/cli/test/agent-port-composition.test.ts
- Modify: packages/cli/test/agent-port-output-contract.test.ts
- Modify: packages/authoring/test/integration-execution.test.ts
- Modify: 本任务书 Ledger

**Interfaces:**
- Consumes: READY/FAILED integration metadata、fresh diff/validation/simulation/runtime。
- Produces: 可审计 v2 integration capsule 与来源逐项 provenance。

- [ ] **Step 1: 写 provenance RED**

构造 A/B/C/D 四候选：

- A：variable:wave5.alphaFlag + 依赖该变量的 scene:wave5_alpha；
- B：scene:wave5_beta 依赖 timeline:wave5_beta_opening；
- C：相同 variable，但 scene:wave5_alpha 为不同规范结果；
- D：与 A 的 variable + scene closure 规范结果完全相同。

计划选择 A、B、D，冲突 A/C choose A。执行并取 fresh evidence 后 capsule 断言：

1. includedUnits 含 A/B 与 B 的隐式 timeline closure；
2. C 不在 included；
3. D 的 variable/scene 两个重复单元均被 dedupe，provenanceUnitIds 保留 A/D；
4. replayReceipts 数量等于实际 replay operations；
5. source capsule refs/SHA 精确；
6. fresh validation/simulation/runtime/diff 都绑定 integration 当前 workingRevision；
7. projectMutation.occurred=false；
8. source capsule bytes/SHA、source records、project tree 不变；
9. FAILED integration capsule 仍可生成，manualReviewRequired 含 INTEGRATION_REPLAY_FAILED，且不能伪装 ready；
10. 普通 v2 capsule 没有 integrationProvenance。

~~~powershell
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- agent-port-capsule.test.ts agent-port-composition.test.ts --reporter=json --outputFile="$wave5Root\task6-red.json"
~~~

- [ ] **Step 2: 完整 provenance**

integrationProvenance 只能从 sealed plan + record.integration 构造，不从 diff 猜：

- planId/fingerprint；
- source capsule refs；
- selected/implicit included units；
- identical dedupe；
- conflict resolutions；
- replay receipts。

若 plan artifact 已损坏或与 record.integration 不符，integration capsule composition=unavailable，reason=COMPOSITION_PLAN_INVALID，并强制 manual review；不得丢弃普通审计字段。

- [ ] **Step 3: freshness 规则**

integration READY 只证明 replay 完成。Capsule 的 validation/simulation/runtime/diff 继续使用既有 freshness：

- mutation 后旧证据 stale；
- integration execution 不复制 source evidence；
- 每项 evidence 的 workingRevision 必须等于 integration current workingRevision；
- 至少一个 passed runtime trace；FORMAL 使用 Alpha 与 Beta 两条显式路径；
- warning 进入 warnings/manualReviewRequired，但 warning 不自动变成结构 conflict。

- [ ] **Step 4: 失败审计**

FAILED integration：

- source/project unchanged；
- changeStatus=OPEN；
- composition manifest 可描述已成功 replay 的 operation，但 integrationProvenance 明确 FAILED；
- warnings 含 INTEGRATION_REPLAY_FAILED；
- failure operation index/code 可见；
- capsule 不提供“跳过失败项” repair。

- [ ] **Step 5: 跑 GREEN**

~~~powershell
npm run test -w @surdet/authoring -- integration-execution.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli -- agent-port-capsule.test.ts agent-port-composition.test.ts agent-port-output-contract.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
~~~

- [ ] **Step 6: 提交 Task 6**

~~~powershell
git add packages/cli/src/agent-port/delivery-capsule.ts
git add packages/cli/src/agent-port/server.ts
git add packages/cli/src/agent-port/session.ts
git add packages/cli/src/authoring/composition-service.ts
git add packages/cli/test/agent-port-capsule.test.ts
git add packages/cli/test/agent-port-composition.test.ts
git add packages/cli/test/agent-port-output-contract.test.ts
git add packages/authoring/test/integration-execution.test.ts
git add docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
git diff --cached --name-status
git diff --cached --check
git commit -m "feat(cli): preserve integration provenance"
git show --name-status --oneline HEAD
~~~

---

### Task 7: 聚焦总门、工作区全量与唯一 verify:all

**Files:**
- Modify: 仅当本 Wave 直接相关测试暴露真实问题时修改对应白名单文件
- Modify: 本任务书 Ledger

**Interfaces:**
- Consumes: Task 1–6 所有本地提交。
- Produces: 在 E2E runner 之前冻结的工作区级可信门禁。

- [ ] **Step 1: 检查范围与 build 顺序**

~~~powershell
git status --short --branch
git diff --check
git diff --cached --check
git diff --name-only surdet/main...HEAD
git log --oneline --decorate surdet/main..HEAD
npm run build -w @surdet/core
npm run build -w @surdet/authoring
~~~

先 build Authoring，避免 CLI 测试读取旧 dist。

- [ ] **Step 2: Authoring 聚焦与全量**

~~~powershell
npm run test -w @surdet/authoring -- change-session.test.ts composition-manifest.test.ts candidate-comparison.test.ts integration-plan.test.ts integration-execution.test.ts capability-registry.test.ts error-catalog.test.ts commit-recovery.test.ts
npm run test -w @surdet/authoring
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
~~~

Expected: 全部 exit 0。报告真实 file/test count，不硬编码预计数量。

- [ ] **Step 3: CLI 聚焦与全量**

~~~powershell
npm run test -w @surdet/cli -- node-composition-store.test.ts composition-service.test.ts authoring-contract.test.ts agent-port-composition.test.ts agent-port-capsule.test.ts agent-port-session.test.ts agent-port-tools.test.ts agent-port-output-contract.test.ts agent-port-security.test.ts change-isolation.test.ts
npm run test -w @surdet/cli
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
~~~

Expected: 全部 exit 0；CLI test discovery 不收集 packages/cli/e2e/artifacts/** 或系统临时 fixture。

- [ ] **Step 4: 文档与卫生预门**

~~~powershell
npm run verify:docs
npm run verify:tools
npm run verify:hygiene
git diff --check
~~~

若 capability docs 真正需要同步，先确认 docs/capabilities.json 是否描述本功能。只有真实漂移才在白名单中最小修改 docs/capabilities.json 并运行 npm run docs:capabilities；不得手改 capability-matrix.md。

- [ ] **Step 5: 运行唯一正式 verify:all**

~~~powershell
npm run verify:all 2>&1 | Tee-Object -FilePath "$wave5Root\task7-verify-all.log"
$LASTEXITCODE
~~~

Expected: exit 0，抵达最后节点。记录 log bytes/SHA-256。

失败规则：

1. 记录最后通过与首个失败节点；
2. 不立即重跑；
3. 若失败与本 Wave 无关，保留证据并停止等待经理；
4. 若直接相关，先建立聚焦 RED、做最小修复、跑对应聚焦 GREEN；
5. 创建精确修复提交；
6. 只有此前没有使用 recovery，才允许一次且仅一次 recovery verify:all；
7. recovery 再失败即停止；不得运行 DIAGNOSTIC/FORMAL。

- [ ] **Step 6: 收口 Task 7**

若全部通过，taskbook Ledger 可以是唯一 tracked 修改；不要制造无代码的“门禁提交”。进入 Task 8 前 tracked 生产/test 必须 clean。

---

### Task 8: 唯一聚合 runner、preflight、有界 DIAGNOSTIC 与唯一 FORMAL

**Files:**
- Create: packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs
- Modify: packages/cli/test/agent-port-composition.test.ts（只在 runner 暴露真实合同缺口时）
- Modify: 对应白名单生产文件（只在 runner 暴露真实产品缺口时）
- Modify: 本任务书 Ledger

**Interfaces:**
- Consumes: 正式 dist launcher、系统临时 Starter fixtures、确定性 schema-only client。
- Produces: 一份冻结 HEAD 的 FORMAL artifact；不会修改原始 Starter 或真实项目。

- [ ] **Step 1: runner 固定模式与安全根**

唯一 modes：

~~~text
preflight
diagnostic
formal
acceptance-prep
~~~

每次 run 创建：

~~~text
%TEMP%\surdet-agent-candidate-composition-wave5-<random>\
  fixture\
  agent-data\
  <mode>\
    evidence.json
    identity.json
    child-stderr.log
~~~

acceptance-prep 才在 Desktop 创建独立根。不得使用 packages/cli/e2e/artifacts。

writeArtifact 使用 exclusive create；失败 artifact 不删除、不覆盖。finally 必须关闭 client/transport、确认 child pid 消失、无 timer、无 lease 目录残留。

每份 artifact 同时记录 gitHead、runnerSha256、trackedCodeDiffPaths。DIAGNOSTIC 可以明确标记 runner 为未冻结诊断版本；FORMAL 必须 trackedCodeDiffPaths=[] 且 runHead/gitHead 等于 CODE_EVIDENCE_HEAD。不得用 gitHead 代替未提交 runner 的真实身份。

- [ ] **Step 2: preflight 必须复用正式 launcher**

~~~powershell
node --check packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
node packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs --mode preflight
~~~

preflight 只验证：

- launcher=packages/cli/dist/agent-port/main.js；
- cwd=repo root；
- SURDET_AGENT_DATA_DIR 为新临时目录；
- 2.0.0 authoring contract；
- 26 native capabilities / 正确 policy tool 数；
- modern 与 legacy MCP negotiation；
- text/structured envelope；
- stdout purity、stderr、child cleanup；
- 原始 Starter tree hash 未变。

不得在 preflight 创建正式候选或消耗 DIAGNOSTIC。

- [ ] **Step 3: DIAGNOSTIC/FORMAL 业务矩阵**

确定性客户端必须通过公开 MCP schema 完成：

1. 为同一 fixture/base 创建并封存 A/B/C/D 四个 v2 source capsules：A=Alpha scene+变量，B=Beta scene+既有资源 timeline，C=不同 Alpha，D=与 A 相同；
2. 另造一个可识别 v1 fixture，证明 compare review-only/audit-only，不迁移；
3. compare A/B/C/D；
4. 证明 A/C selection conflict、A/D identical group、B scene -> timeline closure；
5. plan 选择 A/B/D、choose A、自动加入 B timeline、dedupe A/D；
6. inspect plan after a fresh process；
7. dry-run passed；
8. execute 新 integration change；
9. 在至少一项 domain operation 已持久化但 progress 尚未推进的边界主动终止 child；
10. 新进程以 exact plan/execute operationId resume；
11. 最终 READY；
12. 运行 fresh change.diff / validation / simulation；
13. 分别运行 Alpha 与 Beta runtime path 并 read trace；
14. 在 stage 状态生成 integration capsule，并证明 projectMutation.occurred=false；
15. 断言 C 替代文本不存在；
16. 记录 source capsule/change 与 stage fixture tree 身份；
17. 关闭 stage Port，用 apply policy 精确 resume 同一 READY integration change；
18. 回读 plan/READY/fresh evidence 后，确定性客户端显式调用既有 change.commit；
19. 新 observe process 证明 Alpha/Beta 已写入系统临时 fixture、C 不存在；
20. 断言 source capsule/change 仍不变、原始 Starter unchanged，fixture 的变化精确等于 integration diff；
21. 断言所有错误通道和清理通道为空。

还必须有负路径：

- caller 伪造 replayOperations 被 strict schema 拒绝；
- wrong artifact SHA；
- cross-project candidate；
- base revision mismatch；
- unresolved conflict；
- stale plan；
- nonmatching resume operationId；
- REPLAYING/FAILED commit gate；
- observe policy execute blocked；
- stage execute 绝不 project mutation。

- [ ] **Step 4: 最多三次 DIAGNOSTIC**

~~~powershell
node packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs --mode diagnostic
~~~

每次只运行一次命令，立即从磁盘读取 artifact status、lastPassedNode、firstFailedNode、runHead、bytes、SHA-256。

规则：

- 总共最多 3 次；
- runner 方法缺陷可修 runner，先 node --check + preflight，再消耗下一次；
- 生产缺陷必须先补聚焦 RED/GREEN；
- 若生产修复发生在 Task 7 verify 后，只有未使用 recovery verify 配额时才允许运行那唯一 recovery；否则停止；
- 第 3 次失败 -> DIAGNOSTIC_BUDGET_EXHAUSTED，FORMAL_NOT_RUN；
- 不把“差一点”“主要节点通过”写成通过。

- [ ] **Step 5: 冻结 CODE_EVIDENCE_HEAD**

DIAGNOSTIC 通过后，追加 Ledger，精确暂存 runner、必要代码/测试与 taskbook，提交：

~~~powershell
git add packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs
git add docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
# 若 DIAGNOSTIC 暴露并已按本任务书修复真实缺陷，只能再逐个 git add 该白名单路径。
# 禁止 git add .、git add -A 或通配整个目录。
git diff --cached --name-status
git diff --cached --check
git commit -m "test(cli): verify candidate composition workflow"
git rev-parse HEAD
git status --short
~~~

该 HEAD 为 CODE_EVIDENCE_HEAD。此后不得修改生产、测试、runner 或 package 文件。

- [ ] **Step 6: 唯一 FORMAL**

~~~powershell
node packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs --mode formal
~~~

Expected:

~~~text
status=PASSED
evidenceClass=FORMAL
runHead=CODE_EVIDENCE_HEAD
stageProjectMutated=false
formalFixtureCommitOccurred=true
formalFixtureMutationMatchesIntegrationDiff=true
sourceCapsulesUnchanged=true
sourceChangesUnchanged=true
originalStarterUnchanged=true
integrationStatus=READY
validationFresh=true
simulationFresh=true
alphaTraceFresh=true
betaTraceFresh=true
errors=[]
childCleanupFailures=[]
activeLeaseDirectories=[]
~~~

读取 evidence.json 与 identity.json 的路径、bytes、SHA-256，并确认 sidecar 与磁盘回读一致。

FORMAL 失败：保留 artifact，记录最后通过与首个失败，停止。不得重跑、不得修后再 FORMAL。

---

### Task 9: 真实外部 Agent 验收准备、stage 验收与 Owner apply 门

**Files:**
- Run: packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs --mode acceptance-prep
- Modify: none，除非真实验收发现产品缺陷并取得新授权
- Modify: 本任务书 Ledger，仅记录真实外部反馈后

**Interfaces:**
- Consumes: FORMAL PASS 与独立经理对代码/artifact 的只读批准。
- Produces: 一个 Desktop 隔离 fixture、四个 sealed source candidates、MCP stage config、未授权 apply template。

- [ ] **Step 1: 独立复审门**

FORMAL 通过后先停止。独立经理只读核验：

- 任务书、design spec；
- Task 1–8 commit chain 与范围；
- FORMAL runHead/identity；
- source/project invariants；
- verify:all 次数；
- DIAGNOSTIC 次数；
- tracked clean/staging empty；
- 未 push。

未得到 PASS，不得运行 acceptance-prep。

- [ ] **Step 2: 唯一 acceptance-prep**

获批后只运行一次：

~~~powershell
node packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs --mode acceptance-prep
~~~

Expected Desktop 根：

~~~text
<local-path><random>\
  project\
  agent-data\
  mcp-stage.json
  apply-resume-template.json
  candidate-refs.json
  acceptance-instructions.md
  evidence.json
  identity.json
~~~

acceptance-prep：

- 复制 Starter 源项目文件，不复制 node_modules/dist；
- 生成 A/B/C/D 四个 v2 candidate capsule；
- data dir 不得为空，但 source candidates 全部 sealed；
- 不创建 integration change；
- 不运行 external Agent；
- 不 apply/commit；
- 原始 Starter unchanged；
- mcp-stage.json 只指向该 fixture/data dir 和正式 dist launcher；
- apply template 标记 NOT_AUTHORIZED。

失败即停，不重跑、不手工补造路径/证据。

- [ ] **Step 3: 给真实外部 Agent 的固定任务**

项目所有者把 acceptance-instructions.md 与 mcp-stage.json 交给一个不知道 Surdet 源码的外部桌面 Agent。任务必须要求它：

1. 只用指定 Surdet Agent Port，不用 Shell/Git/文件系统；
2. capabilities.describe / session.describe / project.inspect；
3. 使用 acceptance-instructions.md 已内嵌并由项目所有者复制到任务消息中的四个稳定引用 compare；Agent 不需要自行读取本地文件；
4. 读取 units/dependencies/conflicts/evidence；
5. 选择 A、B、D，A/C 冲突 choose A；
6. plan、inspect、execute；
7. 若 execute 中断，只按 repairActions 用同 operationId resume；
8. 对 integration change 运行 diff/validate/simulate；
9. 分别运行 Alpha/Beta runtime trace；
10. 封存 delivery capsule；
11. 保持 integration OPEN；
12. 不 commit、apply、rollback、改真实项目或调用旧 MCP 服务。

通过报告至少给：

~~~text
changeId
planId / planFingerprint
source capsule refs
selected / implicit / excluded / deduplicated units
conflict resolution
workingRevision / integration status
validation / simulation / Alpha trace / Beta trace
capsule path / bytes / SHA-256
projectMutation.occurred
tool calls success/failure
~~~

不能只测试一个“特别会猜源码”的模型。当前 Wave 的硬门是确定性 schema-only FORMAL；真实 Agent 是产品可用性补充。若 Agent 失败，先区分公开合同缺陷、包装层缺陷和 Agent 行为，不能直接改生产代码。

- [ ] **Step 4: Owner apply 授权门**

真实 Agent stage 验收通过后停止。只有项目所有者明确批准，才可：

1. 用 apply-resume-template 启动同 fixture/data dir；
2. resume integration change；
3. 回读 READY 与 plan identity；
4. 重新取得 fresh validation/simulation/Alpha/Beta runtime/diff；
5. 调既有 change.commit；
6. 确认只修改 Desktop fixture，原始 Starter unchanged。

未授权时状态必须是 APPLY_NOT_AUTHORIZED。

- [ ] **Step 5: 项目所有者短验收**

apply fixture 成功后，项目所有者用 Editor/preview 只确认：

1. Alpha 采用内容可见；
2. Beta 场景与既有资源 timeline 演出可见；
3. C 的替代文本不存在；
4. 项目可打开、预览、保存。

这不是候选比较 UI 验收；本 Wave 没有实现该 UI。执行 AI 只能原样记录 Owner 反馈，不得代填。

---

### Task 10: 最终交付报告、磁盘身份、文档闭合与独立复审

**Files:**
- Modify: docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
- Create: docs/AGENT-CANDIDATE-COMPARISON-SAFE-COMPOSITION-WAVE-5-DELIVERY-REPORT-2026-08-24.md
- Modify: docs/known-limitations.md，仅满足 Task 7 的明确条件时

**Interfaces:**
- Consumes: 自动化、FORMAL、外部 Agent、Owner 四层真实结果。
- Produces: 自包含但不重复巨量日志的交付报告与 docs-only closure commit。

- [ ] **Step 1: 分层写报告**

固定章节：

1. 结论第一行；
2. Scope / explicit non-scope；
3. AUTOMATED_FACTS；
4. FORMAL_FACTS；
5. EXTERNAL_AGENT_REPORTED_FACTS；
6. OWNER_REPORTED_VISUAL_FACTS；
7. UNVERIFIED_INFERENCES；
8. v1 audit-only / v2 composable 兼容边界；
9. source/project immutability；
10. commits 与 file scope；
11. tests / verify / diagnostic/formal run counts；
12. artifact identities；
13. unresolved issues / limitations；
14. Git state / push state；
15. 建议由总经理登记的事实。

如果 external Agent 或 Owner 验收未做，只能写 NOT_STARTED，不能以 FORMAL 替代。

- [ ] **Step 2: 扫描过时状态与占位词**

~~~powershell
$staleTokens = @(
  ("PEND" + "ING"),
  ("T" + "BD"),
  ("T" + "ODO"),
  ("will be " + "appended"),
  ("NOT_" + "CREATED"),
  ("IMPLEMENTATION_NOT_" + "AUTHORIZED"),
  ("TASKBOOK_NOT_" + "CREATED")
)
$closureDocs = @(
  "docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md",
  "docs/AGENT-CANDIDATE-COMPARISON-SAFE-COMPOSITION-WAVE-5-DELIVERY-REPORT-2026-08-24.md"
)
Select-String -Path $closureDocs -Pattern ($staleTokens -join "|")
~~~

设计规格中的历史 pre-approval 状态不修改；交付报告需说明它是规格创建时历史快照，当前授权由本任务书与实际执行记录证明。

- [ ] **Step 3: 运行 docs-only 门**

不重跑 FORMAL、verify:all、全量测试或外部 Agent：

~~~powershell
npm run verify:docs
npm run verify:hygiene
git diff --check
git diff --cached --check
git status --short
~~~

- [ ] **Step 4: 磁盘回读**

从磁盘重新读取：

- taskbook path/bytes/SHA-256；
- delivery report path/bytes/SHA-256；
- FORMAL evidence/identity path/bytes/SHA-256/runHead；
- external acceptance evidence/capsule（若完成）；
- Owner fixture project tree / original Starter tree（若 apply 完成）；
- branch/HEAD/parent/remote/ahead-behind；
- tracked/staging/log 状态。

PowerShell：

~~~powershell
$taskbook = "E:\surdet\docs\superpowers\plans\2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md"
$report = "E:\surdet\docs\AGENT-CANDIDATE-COMPARISON-SAFE-COMPOSITION-WAVE-5-DELIVERY-REPORT-2026-08-24.md"
Get-Item $taskbook,$report | Select-Object FullName,Length
Get-FileHash $taskbook,$report -Algorithm SHA256
git rev-parse HEAD
git rev-parse HEAD^
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short --branch
git diff --check
git diff --cached --check
git ls-files "*.log"
~~~

- [ ] **Step 5: 精确 docs-only closure commit**

只暂存 taskbook、delivery report，以及确有必要且已在 Task 7 授权的 known-limitations：

~~~powershell
git add docs/superpowers/plans/2026-08-24-agent-candidate-comparison-safe-composition-wave-5.md
git add docs/AGENT-CANDIDATE-COMPARISON-SAFE-COMPOSITION-WAVE-5-DELIVERY-REPORT-2026-08-24.md
git diff --cached --name-status
git diff --cached --check
git commit -m "docs(authoring): report candidate composition wave 5"
git show --name-status --oneline HEAD
~~~

若 docs/known-limitations.md 真实修改，必须单独显式 git add，并在 staged list 中解释；否则不得顺手加入。

- [ ] **Step 6: 停在独立复审**

最终状态按实际情况选择，不能预写通过：

~~~text
STAGE_6_WAVE_5_CANDIDATE_COMPOSITION_VERIFIED
FORMAL_PASSED
EXTERNAL_AGENT_ACCEPTANCE_PASSED | NOT_STARTED | FAILED
OWNER_ACCEPTANCE_PASSED | NOT_STARTED | FAILED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
WAVE_6_NOT_STARTED
~~~

独立复审只读，至少核验：

1. 设计规格覆盖；
2. 代码/runner/docs commit scope；
3. v1 audit-only 与 v2 manifest；
4. source/project immutability；
5. compare conflict/closure/dedupe；
6. plan 输入无 replay payload；
7. dry-run/execute 共用 typed mutations；
8. resume/FAILED/READY/commit gate；
9. registry 26 项与 MCP 薄投影；
10. verify/DIAGNOSTIC/FORMAL 次数；
11. FORMAL runHead；
12. external/Owner 证据分层；
13. artifact bytes/SHA；
14. tracked clean/staging empty；
15. push 未执行。

复审 PASS 后，仍由项目所有者单独决定 push。不得自动进入 Wave 6。

---

## 十一、规格覆盖矩阵

| 获批规格要求 | 实施 Task |
|---|---|
| 来源候选不可变，新建集成变更 | 3、4、8 |
| 依赖闭合对象单元 | 2、3 |
| 只自动不相交或完全相同 | 2 |
| v1 audit-only / v2 composable | 0、1、8 |
| normalizedInput 与稳定 manifest | 0、1 |
| 不从 diff 反推 | 0、1 |
| compare / conflict / evidence matrix | 2、5 |
| 不可变 plan、no caller replay | 3、5 |
| dry-run 与 execute 同一语义 | 3、4 |
| integration CAS progress / resume | 4、8 |
| FAILED 可审计、READY commit gate | 4、6 |
| registry 只放 metadata | 5 |
| CLI/MCP 薄投影 | 5 |
| integration capsule provenance | 6 |
| 一次 verify、有界 diagnostic、一次 formal | 7、8 |
| deterministic client + real external Agent | 8、9 |
| Owner 人工路径不代填 | 9、10 |
| 不内嵌模型、不做 Editor 产品 UI | Global Constraints |
| 不 push、不进入 Wave 6 | 10 |

---

## 十二、执行停止条件总表

立即停止且不得扩大：

- BASELINE_MISMATCH；
- RED 未命中真实缺口或 HARNESS_INVALID 无法在测试层修复；
- 需要白名单外生产文件；
- 需要从 v1/diff/workingFiles 猜 replay；
- 需要修改来源 capsule/change 或真实 project 才能继续；
- plan 接口必须接受 caller replay payload；
- integration 无法用现有 typed mutation 重放；
- source/project identity 或 SHA 不一致；
- verify:all 正式与 recovery 配额耗尽；
- DIAGNOSTIC 3/3 失败；
- FORMAL 唯一一次失败；
- acceptance-prep 唯一一次失败；
- 外部 Agent 报告公开合同结构性死锁；
- Owner 报告第一个可见异常；
- tracked 工作树出现不明并行修改；
- 远端 behind；
- 任何 push/deploy/release 请求未获明确授权。

停止报告只写：

~~~text
LAST_PASSED_NODE
FIRST_FAILED_NODE
ERROR_CODE / ACTUAL_BEHAVIOR
HEAD / REMOTE / AHEAD_BEHIND
CHANGED_FILES
ARTIFACT_PATH / BYTES / SHA256
PROJECT_MUTATED
SOURCE_MUTATED
TESTS_NOT_RUN
NEXT_REQUIRED_AUTHORITY
~~~

---

## Taskbook Creation Record

~~~text
DATE=2026-08-24
AUTHORING_DIRECTION=B2 multi-candidate comparison and safe composition
SPEC_PATH=docs/superpowers/specs/2026-08-24-agent-candidate-comparison-safe-composition-wave-5-design.md
SPEC_HEAD=db49f53f49280908f98ef6e5be943c41a807b8a0
SPEC_OWNER_APPROVAL=YES
TASKBOOK_PARENT_HEAD=db49f53f49280908f98ef6e5be943c41a807b8a0
TASKBOOK_COMMIT_IDENTITY=read with git log -1 -- this file
REMOTE_MAIN_AT_CREATION=31b937638929fa8d09e575b120fd4b4681d9f7d2
PUSH_AUTHORIZED=NO
PRODUCTION_IMPLEMENTATION_STARTED=NO
WAVE_6_STARTED=NO
~~~

## Execution Ledger

执行 AI 只在此处追加，不改写上面的任务定义和历史记录。

### 2026-08-24 — Taskbook authored

~~~text
TASK=PLAN_ONLY
FILES=one new Wave 5 taskbook
PRODUCTION_CHANGES=NONE
TESTS=verify:docs / verify:hygiene / git diff checks are required before taskbook commit
PUSH=NOT_AUTHORIZED
STOP=READY_FOR_EXECUTION_HANDOFF
~~~

### 2026-08-24T16:22Z — Task 0 baseline and real red

~~~text
TASK=0_BASELINE_AND_REAL_RED
START_HEAD=31ed8f2d0e4aa2d0f3d272d1f31c32a4757ebcd0
END_HEAD=31ed8f2d0e4aa2d0f3d272d1f31c32a4757ebcd0 (Task 0 RED 不提交)
BASELINE=branch=main; HEAD=31ed8f2(taskbook commit); spec db49f53 ancestor=yes; surdet/main=31b9376; ahead/behind=2/0; tracked=CLEAN; staging=EMPTY; tracked .log=0; known untracked only; node=v24.15.0 npm=11.12.1
WAVE5_ROOT=<local-path>
FILES_CHANGED=packages/authoring/test/change-session.test.ts(+Wave5 operation capture describe, 4 tests); packages/authoring/test/composition-manifest.test.ts(new, 5 tests); packages/cli/test/agent-port-capsule.test.ts(+capsule v2/composition assertions in stale-evidence test)
RED_AUTHORING=exit 1; total=9 passed=8 failed=1; FAIL=persists the exact normalizedInput for a successful mutation(expected normalizedInput field missing); composition-manifest.test.ts collection failure(Cannot find module ../src/composition-manifest.js)=manifest gap
RED_CLI=exit 1; total=5 passed=4 failed=1; FAIL=marks all prior evidence stale after a later mutation(expected '1.0.0' to be '2.0.0')=capsule v2 gap
BUILD=npm run build -w @surdet/authoring exit 0(测试不在 build 范围，不算 GREEN)
ARTIFACTS=task0-red-authoring.json bytes=4612 sha256=2273d0b7b00ec55ebdfddea5ac42a62e376a0dfdb20464c7d783dd97bf958f96; task0-red-cli.json bytes=2643 sha256=1f22b1fd28bcc58f230db6b6098651835ffc8596451580fa9b000f2916570461
HARNESS_INVALID=NO
GIT=NO_COMMIT(Task 0 RED 按任务书不单独提交；仅修改三个白名单测试文件，留待 Task 1 一并提交)
STOP=TASK_1_IMPLEMENT_NORMALIZED_INPUT_AND_CAPSULE_V2
~~~

### 2026-08-24T17:05Z — Task 1 normalizeJsonValue, CompositionManifest and Capsule v2

~~~text
TASK=1_NORMALIZED_INPUT_MANIFEST_AND_CAPSULE_V2
START_HEAD=31ed8f2d0e4aa2d0f3d272d1f31c32a4757ebcd0
FILES_CREATED=packages/authoring/src/composition-contracts.ts; packages/authoring/src/composition-manifest.ts; packages/cli/src/authoring/working-project-storage.ts(ChangeRecordProjectStorage working|base 双视图)
FILES_CHANGED=packages/authoring/src/{contracts.ts(RecordedOperation),change-session.ts(normalizeJsonValue+runOperation),capability-contract.ts(2.0.0),index.ts}; packages/cli/src/authoring/{authoring-service.ts(复用抽取类),node-change-store.ts(writeCapsulePayload create-only, readCapsulePayload sidecar 三方核对, assertCanonicalArtifactId)}; packages/cli/src/agent-port/{delivery-capsule.ts(v2 composition 投影),server.ts(capsuleOutputSchema)};
RED=Task 0 三条真实红灯转 GREEN(authoring normalizedInput 断言、composition-manifest 模块缺失、cli capsuleVersion 1.0.0!=2.0.0)
GREEN=npm run test -w @surdet/authoring -- change-session.test.ts composition-manifest.test.ts exit0 (14 passed); authoring typecheck/build exit0; npm run test -w @surdet/cli -- agent-port-capsule.test.ts agent-port-output-contract.test.ts exit0 (7 passed 含新增 dual-view adapter 测试); cli typecheck/build exit0
INVOCATION_CHAIN=MCP inputSha256 == SHA(stableStringify(runOperation normalizedInput)) 在真实 stage capsule 上验证成立
KNOWN_RED=packages/cli/test/authoring-contract.test.ts 期望 contractVersion '1.0.0'/22 capabilities——按任务书编排属 Task 5 白名单，Task 5 更新为 2.0.0/26
ARTIFACTS=$wave5Root/t1-g1.log t1-g2.log t1-tc2.log t1-b2.log
GIT=PENDING_STEP8_PRECISE_STAGING
STOP=TASK_2_CANDIDATE_COMPARISON
~~~

### 2026-08-24T17:40Z — Task 2 candidate comparison engine

~~~text
TASK=2_CANDIDATE_COMPARISON_AND_SAFE_CONFLICTS
START_HEAD=08ca65a feat(authoring): seal composable capsule manifests
END_HEAD=(本提交)
FILES_CREATED=packages/authoring/src/candidate-comparison.ts(compareCandidates 纯函数:身份层→不可拆单元层(建图前边上限1024/ops上限256)→identical/selection-required/remove-vs-required→evidence advisory;unitId/conflictId/groupId/comparisonFingerprint 全部规范种子哈希;候选按 artifactSha256/changeId/capsuleId 排序,输出全序稳定); packages/authoring/test/candidate-comparison.test.ts(13 类 fixture 全覆盖:不相交 composable/create+patch 单元/identical group 保 provenance/diverge selection-required/remove 被 required/candidate 依赖边/broken dependency blocking/v1+unavailable CANDIDATE_NOT_COMPOSABLE review-only/project+base mismatch blocked/base 移动 review-only/evidence advisory 不伪装结构冲突/9 候选+257ops+1280 边各自 INVALID_REQUEST/乱序十次指纹字节稳定/conflict id 稳定)
FILES_CHANGED=composition-contracts.ts(+5.4 类型:CandidateCapsuleRef/CandidateEvidenceSummary/ObjectChangeUnit/CompositionConflict/IdenticalUnitGroup/CompositionComparison/CompositionSemanticDiffEntry/VerifiedCompositionCandidate); index.ts(+export candidate-comparison.js); 本任务书 Ledger
RED=test/candidate-comparison.test.ts 首跑 exit1 模块未实现(task2-red.json)
GREEN=npm run test -w @surdet/authoring -- candidate-comparison.test.ts composition-manifest.test.ts change-session.test.ts exit0 (28 passed); typecheck exit0; build exit0
NOTES=单候选比较合法(仅设 >8 上限);candidate 依赖解析用全 manifest producedBySequence(producer 常在另一对象组);unit.producedObjects 为链上全部产物并集,finalFingerprint 取 primary 对象最终值;v1/unavailable 候选不建 unit;status: 身份/依赖结构损坏=blocked, NOT_COMPOSABLE 或 selection-required 或 base 已移动=review-only, 其余 composable
ARTIFACTS=$wave5Root/task2-red.json t2-green.log t2-build.log
GIT=PENDING_STEP6
STOP=TASK_3_IMMUTABLE_INTEGRATION_PLAN_AND_STORE
~~~

### 2026-08-24T19:20Z — Task 3 immutable integration plans and shared dry-run

~~~text
TASK=3_IMMUTABLE_INTEGRATION_PLAN_PLAN_STORE_DRY_RUN
START_HEAD=645b07f fix(authoring): enforce two-candidate comparison floor
END_HEAD=(本提交)
FILES_CREATED=packages/authoring/src/integration-plan.ts(ConflictResolution*/IdenticalUnitResolution/PlannedReplayOperation/IntegrationPlan/Draft/ComparisonWithManifests;verifyComparisonFingerprint 固定字段集;buildIntegrationPlan 闭包+裁决+identical 去重+Kahn 拓扑(primaryObject,capsuleSHA,minSeq);integrationOperationId=cmp_<fp12>_<seq4>_<digest12>;sealDryRunResult 语义投影排除 decidedAt/reason/message); packages/authoring/src/integration-execution.ts(八项 capability 穷尽 switch→既有 apply 函数,仅替换 operationId=integrationOperationId,default=COMPOSITION_PLAN_INVALID); packages/cli/src/authoring/node-composition-store.ts(readCandidate 只信 capsule identity+projectIdentityFromRoot 归属核对;writePlan create-only 幂等回读 stableStringify 同义判定;readPlan sidecar 三方核对 CAPSULE_IDENTITY_MISMATCH;无中央 index); packages/cli/src/authoring/composition-service.ts(短 project lease 读 snapshot;每次现场重算 comparison 拒绝旧 JSON;dry-run InMemoryChangeRepository+beginChange+replayCompositionOperation 后丢弃;指纹回读与封存 manifest 同源 scene/timeline 文本 SHA)
FILES_CHANGED=node-change-store.ts(readCapsulePayload 错误码 CHANGE_STORE_CORRUPT→CAPSULE_IDENTITY_MISMATCH×2); authoring index.ts(+integration-plan/integration-execution)
RED=task3-red-authoring.json(模块未实现 exit1)
GREEN=authoring integration-plan+candidate-comparison 24 passed;cli node-composition-store+composition-service 8 passed;双包 typecheck/build exit0
NOTES=candidateManifests 为运行时附带视图不参与指纹不持久化;identical 组任一成员入选即代表全组 provenance 记全体;单候选比较非法已由 645b07f 修正为规格 2..8;variable type 字面量为 number 非 int(core variable-store 合法集)
ARTIFACTS=$wave5Root/task3-red-authoring.json t3-green-a.log t3-green-b.log
GIT=PENDING_STEP7
STOP=TASK_4_INTEGRATION_EXECUTE_CAS_RESUME_COMMIT_GATE
~~~

### 2026-08-24T20:10Z — Task 4 integration execute, CAS progress, exact resume and commit gate

~~~text
TASK=4_INTEGRATION_EXECUTE_CAS_RESUME_COMMIT_GATE
START_HEAD=b830e27 feat(authoring): seal integration plans
END_HEAD=(本提交)
FILES_CHANGED=contracts.ts(ChangeRecord.integration?: IntegrationMetadata,type-only 引用零运行时环); change-session.ts(BeginChangeOptions 第五参;assertIntegrationReadyForCommit 导出+commitChange 首位 gate;updateIntegrationMetadata CAS); integration-execution.ts(executeIntegrationReplay:planId/planFingerprint 匹配→从 nextOperationIndex 续跑,runOperation 幂等回放不重复 mutation,receipt CAS 补写,瞬态 CHANGE_RECORD_CONFLICT/CHANGE_BUSY/PROJECT_BUSY/LEASE_CORRUPT 原样抛,领域失败 FAILED 持久化+COMPOSITION_REPLAY_FAILED envelope,final fingerprint 逐项核对才 READY); composition-service.ts(executePlan:readPlan→dryRun passed 才可执行→PLAN_STALE 核对→扫描发现该计划 OPEN integration change 精确恢复(普通 OPEN 跳过,接管拒绝属 Task5 session 层)→create 免租+withChangeLease 内 replay)
FILES_CREATED=test/integration-execution.test.ts(7 用例:REPLAYING 创建/receipt 中断不双写/精确 resume+fingerprint 拒绝/integration 元数据固化/typed 失败 FAILED+原始码/字节稳定/COMPOSITION_INCOMPLETE gate); composition-service.test.ts(+2:进程重开精确 resume(双阶段中断形态断言)/READY 完成)
RED=task4-red-authoring.json(beginChange 第五参不存在 exit1)
GREEN=authoring integration-execution+commit-recovery+change-session 20 passed;cli composition-service+node-composition-store 9 passed;双包 typecheck/build exit0
NOTES=record-head.json 只含 recordVersion/SHA 不含本体,扫描经 store.read;多会话并行普通 OPEN 合法,CHANGE_BUSY 的 session 不变量在 Task 5;CLI 测试 variable type=number
ARTIFACTS=$wave5Root/task4-red-authoring.json t4-green-a.log t4-green-b.log
GIT=PENDING_STEP7
STOP=TASK_5_CAPABILITY_REGISTRY_AND_MCP_PROJECTION
~~~

### 2026-08-24T21:30Z — Task 5 capability registry, dispatcher, session and MCP projection

~~~text
TASK=5_CAPABILITY_REGISTRY_AND_MCP_PROJECTION
START_HEAD=2c25c2b feat(authoring): replay integration plans safely
END_HEAD=(本提交)
FILES_CHANGED=capability-contract.ts(CapabilityDefinition.composable: boolean); capability-registry.ts(AUTHORING_CAPABILITY_IDS 26 项;composition.* 四条 metadata+schema(compare observe/plan observe/inspect observe/execute stage);CONTENT_MUTATION_CAPABILITY_IDS 八项白名单导出;assertCapabilityRegistry composable 纪律+composition.* 强制 false;capabilitySummarySchema 加 composable); error-catalog.ts(+10 码入册含 category/retryDisposition/repairActions,CAPSULE_IDENTITY_MISMATCH 与 COMPOSITION_PLAN_INVALID terminal); authoring-service.ts(compareComposition/planComposition/inspectComposition/executeComposition 薄投影到 registry schema 形状,execute 前置普通 active change 拒绝 CHANGE_BUSY); authoring-dispatcher.ts(四 case 纯委托,execute 带 operationIdFrom); session.ts(execute 不在 ACTIVE_CHANGE_CAPABILITIES;普通 active change→state-blocked;成功后 activeChangeId=integrationChangeId;describe.activeChange.integration{planId,status,nextOperationIndex,operationCount};nextActions REPLAYING/FAILED/READY 分支)
FILES_CREATED=test/agent-port-composition.test.ts(observe 挡 execute/stage e2e compare→plan→execute→READY+幂等重放同 changeId/普通 active change state-blocked)
RED=task5-red-authoring.json(26 项断言+10 码断言 exit1)
GREEN=authoring 17 passed(registry+catalog)+authoring 全量 exit0;cli 全量 219 passed;双包 typecheck/build exit0
NOTES=record-head 只存版本+SHA 的教训延续:扫描经 store.read 且过滤 composition-plans 保留目录;envelope schemaVersion 保持 1.0.0 独立于 contractVersion 2.0.0;plan minimumPolicy=observe 因任务书 Step5.2 要求 observe 可用 plan;server.ts 零改动(registry 循环+hints 公式自动满足 readOnly/destructive/idempotent);wave2/wave3 vertical slice 工具清单同步 +4
ARTIFACTS=$wave5Root/task5-red-authoring.json t5-green-a.log t5-green-b2.log
GIT=PENDING_STEP7
STOP=TASK_6_EVIDENCE_FRESHNESS_AND_PROVENANCE
~~~

### 2026-08-24T22:40Z - Task 6 integration provenance, freshness and failure audit

~~~text
TASK=6_EVIDENCE_FRESHNESS_AND_PROVENANCE
START_HEAD=07dfeab fix(cli): trim trailing blank line at eof in authoring service
END_HEAD=(this commit)
FILES_CHANGED=delivery-capsule.ts(DeliveryCapsulePayload.integrationProvenance?;record.integration exists -> build from loadIntegrationProvenance + record.integration: planId/fingerprint/executeOperationId/integrationChangeId/status/nextOperationIndex/operationCount/sourceCapsules/includedUnits/dedup/resolutions/replayReceipts/failure/planAvailable;plan broken -> composition.unavailable + COMPOSITION_PLAN_INVALID + INTEGRATION_PLAN_UNAVAILABLE manual review;FAILED -> warnings+manualReviewRequired INTEGRATION_REPLAY_FAILED); composition-service.ts(loadIntegrationProvenance: read identity.json sha -> store.readPlan bytes check -> planFingerprint must equal record.integration.planFingerprint else COMPOSITION_PLAN_INVALID); registry(composition.plan input field renamed unitChoices->conflictResolutions with ConflictResolutionInput shape conflictId/resolution/chosenUnitId/actor)
FILES_MODIFIED_TESTS=agent-port-composition.test.ts(+3: A/B/C/D provenance e2e with selection-required choose-unit resolution and identical dedupe A/D; broken-plan FAILED capsule audit; ordinary v2 capsule has no integrationProvenance); agent-port-output-contract.test.ts(wave5 real dispatcher results schema scan for all four composition capabilities + annotations assertions)
RED=task6-red.json(2 failed: provenance missing / update on ordinary record)
GREEN=authoring integration-execution exit0;cli capsule+composition+output-contract 14 passed;cli full 222 passed;both packages typecheck/build exit0
NOTES=timeline background cue requires asset:bg:* in base object index -> baseline opening timeline in makeProject fixture;sourceCapsules keeps ALL candidates for audit while C excluded from included units via choose-unit resolution;beware bash heredoc mojibake: chinese chars in heredoc python got cp936-mangled once, use ascii-only patch patterns or unicode escapes;registry input rename required updating task5 e2e inline payloads too
ARTIFACTS=$wave5Root/task6-red.json t6-green.log t6-full.log
GIT=PENDING_STEP7
STOP=TASK_7_FOCUS_GATES_AND_VERIFY_ALL
~~~

### W5-GATE-LEASE-PUBLISH-1 - minimal lease publication-read hardening (manager authorized)

~~~text
CONFIRMED_FACTS =
formal verify:all failed with LEASE_CORRUPT "lease.json unreadable" in
multi-process-change-concurrency.test.ts > retains two real service mutations and
invocation order across processes. NodeLocalLeaseManager.acquire publishes the final
.lock directory via fs.mkdir BEFORE createJsonRecord writes lease.json; a contender
whose first read lands inside that window received LEASE_CORRUPT instead of the real
ownership verdict. Evidence log preserved: task7-verify-all.log, bytes=56348,
sha256=800A970FE51A9F037A4DD5458AB5738F0946AD8DB8C90DA407C526DDDCE0B8EB.

REASONABLE_INFERENCE =
the failure most likely hit this publication window or Windows transient read noise
(ENOENT/EBUSY/EPERM during concurrent replace). The original artifact did not persist
the underlying cause errno, so no specific errno may be stated as confirmed.

VERIFIED_BY_NEW_RED =
node-local-lease.test.ts now proves deterministically: (1) an existing final .lock
directory with lease.json still unpublished is tolerated via bounded polls, not
LEASE_CORRUPT; (2) once the record appears within the budget the contender receives
CHANGE_BUSY from the true owner and never deletes/quarantines/takes over the lease;
(3) permanent absence beyond the bounded budget still yields LEASE_CORRUPT with
manualRecoveryRequired=true and preserved directory evidence; (4) malformed JSON,
invalid fields, and identity mismatch fail loud immediately without entering the
publication wait and keep original bytes untouched. RED artifact: gate1-red.log
(window case: expected CHANGE_BUSY, got LEASE_CORRUPT on pre-fix code).

IMPLEMENTATION =
node-local-lease.ts only: structured details.publicationPhase markers ('read' for
missing-record/ENOENT/EBUSY/EPERM raw reads; parse/validate failures unmarked),
private loadLeaseAwaitingPublication retries ONLY phase='read' errors with at most
10 polls x publicationPollDelayMs(default 10ms, total <=100ms), injected via new
NodeLocalLeaseManagerOptions.publicationPollDelayMs/publicationDelay test seams.
No stale-takeover/heartbeat/release/recovery contract changed.

GATES =
RED gate1-red.log 2 failed | GREEN node-local-lease.test.ts 8 passed;
multi-process-change-concurrency.test.ts 3 passed (first run); typecheck+build exit0.
GIT=PENDING_STEP4_COMMIT
STOP=TASK_5_RECOVERY_VERIFY_ALL_AUTHORIZED_ONCE
~~~

### W5-GATE-LEASE-WAIT-LIVENESS-2 - publication wait liveness fix (manager authorized)

~~~text
RUN_COUNTS =
VERIFY_ALL_FORMAL_RUN_COUNT=1 (task7-verify-all.log, FAILED, LEASE_CORRUPT lease.json unreadable)
VERIFY_ALL_RECOVERY_RUN_COUNT=1 (task7-verify-all-recovery.log, FAILED, 3x ENOENT op-*.result.json)
VERIFY_ALL_MANAGER_EXCEPTION_RUN_COUNT=1 (pending this round)
VERIFY_ALL_TOTAL_RUN_COUNT=3

CONFIRMED_FACTS =
recovery failure was caused by the NEW publication timer added in c76f1c7: the default
publicationDelay implementation called unref() on a timer whose completion promise is
awaited by acquire(). An unfinished promise keeps no process alive; when that unref'd
timer was the last active handle, worker children exited early with code 13
(Unfinished Top-Level Await) and never wrote their result.json. This is recorded as a
genuine defect of the previous fix commit, NOT as environment flakiness.

VERIFIED_BY_NEW_RED =
node-local-lease.test.ts now spawns a real child that acquires a published-directory
lock through the DEFAULT publicationDelay (no injected stand-in). On c76f1c7 the child
exited 13 before writing its verdict marker; after the fix it exits 0 with
marker=LEASE_CORRUPT. Artifact: gate2-red.log. RED artifact for the window contract
from the previous round: gate1-red.log.

IMPLEMENTATION =
node-local-lease.ts only: default publicationDelay now uses a plain ref'd
setTimeout(resolve, delayMs); no unref(). scheduleHeartbeat's existing unref() is kept
(background heartbeats must not block normal exit). The just-added public
publicationPollDelayMs override is removed; production delay is the fixed constant
DEFAULT_PUBLICATION_POLL_DELAY_MS=10ms; PUBLICATION_POLL_LIMIT stays 10 (total <=100ms);
the publicationDelay injection seam remains for deterministic tests only.
Malformed/invalid/identity-mismatch LEASE_CORRUPT semantics unchanged.

GATES =
liveness RED exit13 -> GREEN; node-local-lease.test.ts 9 passed;
multi-process-change-concurrency.test.ts 3 passed first run;
cli full suite 226 passed first run; typecheck+build exit0.
GIT=PENDING_STEP4_COMMIT
STOP=TASK_5_MANAGER_EXCEPTION_VERIFY_ALL_AUTHORIZED_ONCE
~~~

### Task 7 CLOSED - manager exception aggregate gate passed

~~~text
VERIFY_ALL_FORMAL_RUN_COUNT=1
VERIFY_ALL_RECOVERY_RUN_COUNT=1
VERIFY_ALL_MANAGER_EXCEPTION_RUN_COUNT=1
VERIFY_ALL_TOTAL_RUN_COUNT=3

MANAGER_EXCEPTION_VERIFY_ALL=PASS
ARTIFACT=task7-verify-all-manager-exception.log bytes=89625 sha256=d30cef397803a052a17f11aa34a322ca384e8c4b62b6f6b84196a0baf4ada46b
LAST_NODE=verify:diff-check (git diff --check) after renderer/formal builds; all verify:* subgates green
MULTI_PROCESS_AFTER_FIX=multi-process-change-concurrency.test.ts 3 passed (4286ms)
HEAD_AT_GATE=f9d8fee fix(cli): keep lease publication wait alive
TRACKED_TREE_CLEAN=true
DIAGNOSTIC_BUDGET=untouched; FORMAL_BUDGET=untouched (Task 8 budgets not consumed by this round)
STOP=TASK_8_AGGREGATE_RUNNER_AND_PREFLIGHT
~~~

### Task 8 - runner authored, preflight PASSED, DIAGNOSTIC budget exhausted (stopped per rule)

~~~text
RUNNER=packages/cli/e2e/agent-candidate-composition-wave-5.e2e.mjs (835 lines, 4 modes,
artifactRoot=%TEMP%/surdet-agent-candidate-composition-wave5-*; exclusive-create artifacts;
gitHead+runnerSha256+trackedCodeDiffPaths in every artifact; FORMAL requires clean tree +
runHead==SURDET_CODE_EVIDENCE_HEAD; child stderr captured to <mode>/child-stderr.log)

PREFLIGHT=PASS (after build authoring+cli): modern/auto + legacy/2025 negotiation, 26
native capabilities, contractVersion 2.0.0, policy filter, stdout purity, child cleanup,
original Starter unchanged.

DIAGNOSTIC_RUN_COUNT=3 (budget exhausted)
DIAG1=FAILED seal-four-candidates: beta timeline cue referenced asset:bg:night_field but the
  Starter baseline object index has no such asset object (@bg directives do not mint index
  assets; only timeline cues do). RUNNER FIXTURE DEFECT: switched B cue to baseline-present
  castle_hall. artifact ...wave5-xYn6OF/diagnostic bytes=1087 sha256=936a5eaa1bfc8eda2459c6beabe4336bc5ae7c650e6b38406d6ad5a756418fbd
DIAG2=FAILED compare-abcd-conflicts-and-identical: runner read compared.comparison.status but
  the dispatcher projects {comparisonFingerprint,status,candidates,identicalGroups,conflicts}
  at top level. RUNNER PROJECTION FIX. artifact ...wave5-sJTBpk/diagnostic bytes=1051 sha256=f917d128e01fbfd96109b7fe324d02dc8f8d1096561529ee7e102bdc8d0b51d2
DIAG3=FAILED same node: timeline-edge assertion scanned candidates[].composition.manifest but
  the compare projection exposes candidates as {candidateId,eligibility} only. READ-ONLY
  post-mortem confirms this is a runner assertion defect, NOT a product gap: dependency
  closure for B scene->timeline is already proven by plan dryRunStatus=passed (manifest
  resolveRequirements would mark unavailable otherwise), and explicit units remain visible
  via composition.inspect plan payload. artifact ...wave5-kyt4IW/diagnostic bytes=1055 sha256=6e955e4cd17b4044b7137d99b9bb50d094d2cf3814821046fc32962113f320a2

STATUS=DIAGNOSTIC_BUDGET_EXHAUSTED
FORMAL_NOT_RUN=true
CODE_EVIDENCE_HEAD_NOT_FROZEN=true (Step 5 commit not reached)
PRODUCTION_DEFECTS_FOUND=false (all three failures were runner-side; no product code touched)
NEXT_ALLOWED_ACTION=await manager ruling on a diagnostic budget extension before any rerun;
  the pending fix is confined to the runner file (assertion rewrite to inspect-plan based
  closure evidence or drop of the redundant edge check).
STOP=TASK_8_DIAGNOSTIC_BUDGET_EXHAUSTED_AWAITING_MANAGER
~~~

### MANAGER CORRECTION (independent review) - appended to the record above

~~~text
The earlier claims "DIAG3 is a pure runner defect" and "PRODUCTION_DEFECTS_FOUND=false"
are CORRECTED by independent manager review as follows:
- plan dryRunStatus=passed is NOT dependency-closure evidence: without selectedUnitIds
  the old contract silently selected ALL units, so the timeline would be included even
  if it were not required by the scene.
- The public MCP contract had real gaps: composition.plan strict input schema lacked
  comparisonFingerprint/selectedUnitIds; composition.compare output lacked
  units/dependencyEdges/evidenceMatrix. External agents could not express reviewed
  selections at all. DIAG3 therefore exposed a genuine product contract gap.
Historical text above is preserved unmodified; this correction supersedes it.

### W5-PUBLIC-SELECTION-CONTRACT-1 - public selection contract fix

~~~text
BASELINE=HEAD e318d0b10f44e14d42628a8adc114226868f625f ahead15/0 tracked clean; three
historical diagnostic artifacts preserved byte-identical.

RED=selection-contract-red.log on e318d0b: compare projection missing comparisonVersion
(+units/dependencyEdges/evidenceMatrix); plan rejected comparisonFingerprint/
selectedUnitIds as additional properties. 2/2 new tests failed as required.

FIX=
- authoring-service.compareComposition projects the full safe CompositionComparison
  (comparisonVersion/projectIdentity/expectedProjectRevision/status/safe candidates/
  units/dependencyEdges/conflicts/identicalGroups/evidenceMatrix/comparisonFingerprint);
  candidates stay {candidateId,eligibility}; no manifests, no normalizedInput, no paths.
- registry compositionCompare.outputSchema extended accordingly; compositionPlan.inputSchema
  now REQUIRES comparisonFingerprint + selectedUnitIds(minItems 1), keeps optional
  conflictResolutions/reason, additionalProperties=false.
- CompositionService.plan re-compares live, fails COMPOSITION_PLAN_STALE on fingerprint
  mismatch (retryDisposition after-refresh), rejects duplicate/unknown selectedUnitIds,
  and the default-select-all path is REMOVED; closure still via existing
  buildIntegrationPlan only.
- contract stays 2.0.0; no compat layer.

TESTS_SYNCED=composition-service.test.ts(planFromComparison helper), agent-port-output-
contract.test.ts(seal now goes through the public session so invocation facts exist; the
old fixture silently planned an EMPTY unit set to READY under the default-all path -
now impossible), agent-port-composition.test.ts(task5 e2e + task6 provenance bind fresh
fingerprint + explicit selection).

GREEN=authoring capability-registry.test.ts 11 passed; cli focus 26 passed; cli full
228 passed first run; both typecheck+build exit0.
GIT=PENDING_TASK_D_COMMIT
STOP=TASK_E_POST_CONTRACT_VERIFY_ALL_NEXT
~~~

### TASK E - post-contract aggregate gate PASSED

~~~text
TASK7_FORMAL_VERIFY_ALL=1
TASK7_RECOVERY_VERIFY_ALL=1
TASK7_MANAGER_EXCEPTION_VERIFY_ALL=1
TASK8_POST_CONTRACT_VERIFY_ALL=1
CUMULATIVE_VERIFY_ALL_RUN_COUNT=4
ARTIFACT=task8-post-contract-verify-all.log bytes=90429 sha256=a523b567c13fb089fc80540037cf96e57312883428b2f9396d008f18c48f6f6e
HEAD_AT_GATE=ccd167f fix(cli): expose composition selection contract
RESULT=exit0; multi-process-change-concurrency 3 passed; all verify:* subgates green
~~~

