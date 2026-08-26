# Surdet Stage 6 Wave 6：人类审阅与因果交接台设计规格

> 日期：2026-08-26
> 状态：`DESIGN_SPEC_COMPLETE` / `WAITING_FOR_OWNER_FILE_REVIEW`
> 产品方向：A——人类友好的 Agent 候选审阅与因果交接台
> 主交互：A1——以审阅任务为主，对象比较与因果关系作为下钻
> 批准粒度：P1——冲突逐项裁决，最终计划整体批准
> 实现授权：未授予
> Wave 6：未开始施工

---

## 一、结论摘要

Wave 6 将把 Wave 5 已完成的候选比较、安全合成、来源保留和隔离 apply 能力，转化为项目所有者能够真正理解和控制的人类审阅工作流。

本轮不在 Editor 内嵌模型，也不让 Editor 重写候选比较、依赖闭包、冲突判断或 integration plan。共享真相仍在 `@surdet/authoring`；CLI 与 Agent Port 只负责 Node 文件系统适配和类型化工具投影；Editor 只消费共享层生成的审阅投影、展示中文界面、记录人类决定并预览实际 stage 结果。

Wave 6 的最小完整闭环是：

```text
多个外部 Agent 生成 sealed candidate capsules
  -> 共享层比较候选并生成不可变审阅包
  -> 项目所有者在 Editor 中逐项裁决真实冲突
  -> 决定回执绑定 comparisonFingerprint
  -> 共享层生成、dry-run 并执行 integration plan 到隔离 change
  -> 生成包含真实 stage 项目副本、diff、因果与证据的结果审阅包
  -> 项目所有者在 Editor 中预览最终结果并整体批准或退回
  -> 批准回执绑定 plan、change、workingRevision、diff 与证据身份
  -> 项目所有者另行启动 apply/resume
  -> commit gate 拒绝缺失、过期或不匹配的批准回执
```

这使 Surdet 同时保持两种优势：

1. **对 Agent 专业。** Agent 继续读取稳定 ID、schema、fingerprint、provenance、error code 与 repair action；
2. **对人类友好。** 普通用户默认看到中文目标、候选差异、冲突原因、影响对象、预览和清晰按钮，而不是 JSON、英文错误码或工具调用流水。

---

## 二、为什么现在做

### 2.1 Wave 5 已解决机器侧问题

Wave 5 已真实证明：

- 两到八份 sealed candidate capsule 可以在同一项目身份和基线下比较；
- 不相交依赖闭包可以安全组合；
- 相同对象、相同 disposition 与 finalFingerprint 可以形成 identical subgroup；
- A/D 相同结果与 C 不同结果能够同时存在，A/D 来源完整保留，C 进入显式冲突；
- 计划只能从已验证 manifest 构造，调用方不能伪造 replay payload；
- integration change 支持 CAS、精确 resume、fresh evidence 与 commit gate；
- 外部 Agent、isolated apply 和项目所有者真实 Editor/预览路径均已通过。

### 2.2 当前缺口是“人类无法自然审阅”

目前项目所有者仍主要通过聊天报告、技术表格、ID、哈希与人工指令了解候选合成。虽然这些证据适合 Agent 和工程审计，却不适合作为成熟创作产品的主要界面。

当前 Editor 已有块编辑、流程图、时间轴、配置、预览、统计、审计、共享对象索引和因果面板，但没有：

- 审阅任务列表；
- 候选来源与目标摘要；
- identical group 的人类可读折叠；
- selection-required 冲突的中文选择卡；
- 计划的纳入、排除、隐式依赖和来源解释；
- 与实际 stage working files 对齐的预览；
- 绑定精确计划与证据的批准或退回回执；
- 防止“审阅 A、实际提交 B”的审批新鲜度门。

因此 Wave 6 不再扩展更多创作对象，而是把已有 Agent 基础设施变成一个真正可由项目所有者掌控的协作产品。

---

## 三、已批准的产品裁决

### 3.1 A：人类友好的 Agent 候选审阅与因果交接台

Wave 6 的第一用户是项目所有者和普通创作者，不是另一个 Agent。Agent 仍是候选生产者与计划执行者，Editor 是人类审阅与批准入口。

### 3.2 A1：以“审阅任务”为主

用户首先看到一张审阅任务，而不是对象树或 A/B/C/D 原始矩阵。任务首页回答：

- 这批 Agent 想完成什么；
- 一共有几个候选；
- 哪些结果一致且可安全折叠；
- 哪些冲突必须由人决定；
- 是否存在阻断、警告或缺失证据；
- 当前可以做什么，不能做什么。

对象差异、因果关系、来源 capsule、指纹与技术详情作为逐级下钻，不占据首次视图。

### 3.3 P1：冲突逐项裁决，计划整体批准

安全相同结果自动折叠并显示“多个方案得到了同一结果”；真正的 selection-required 冲突逐项由人选择、全部排除或退回重做。所有冲突裁决完成后，系统生成一个整体计划。用户预览实际 stage 结果后，只对完整计划执行一次最终批准。

### 3.4 不把“一键接受整个 Agent 方案”作为主路径

一键接受会浪费 Wave 5 的组合能力，并鼓励用户把 Agent 名称当作正确性来源。Surdet 审阅的是对象结果、依赖、影响与证据，不是模型品牌或聊天表现。

### 3.5 不要求每个安全对象逐项点选

让用户确认每个无冲突对象会制造审阅疲劳。安全 identical group 与无冲突依赖闭包默认纳入，但必须可见、可展开、可排除整组或退回。

---

## 四、不可妥协的不变量

```text
NO_EMBEDDED_MODEL
AUTHORING_CONTRACT_IS_SINGLE_TRUTH
EDITOR_DOES_NOT_RECOMPUTE_COMPARISON_OR_PLAN
REVIEW_NEVER_MUTATES_SOURCE_CAPSULES
REVIEW_NEVER_MUTATES_THE_REAL_PROJECT
HUMAN_DECISION_BINDS_EXACT_COMPARISON
FINAL_APPROVAL_BINDS_EXACT_PLAN_AND_WORKING_REVISION
STALE_APPROVAL_CAN_NEVER_COMMIT
AGENT_CANNOT_CREATE_OWNER_APPROVAL_THROUGH_AGENT_PORT
APPLY_STILL_REQUIRES_EXPLICIT_OWNER_LAUNCH
PREVIEW_USES_THE_ACTUAL_STAGE_RESULT
CHINESE_FIRST_HUMAN_UI
TECHNICAL_FACTS_REMAIN_AVAILABLE_ON_DEMAND
NO_PROMPT_OR_CHAT_LOG_AS_PROJECT_TRUTH
NO_SECOND_CONFLICT_ENGINE
NO_SECOND_CAUSAL_MODEL
```

### 4.1 人类批准不是普通 Agent 字段

`actor: 'human'` 不能仅靠 Agent 在 MCP 参数中自报。Wave 6 的人类决定和最终批准必须由 Editor 在用户明确操作后写入审阅工作区。Agent Port 可以只读检查和消费回执，但没有创建、改写或代填人类回执的工具。

### 4.2 本地信任边界

首版不做账号、云签名或硬件密钥。信任边界是：

- 审阅工作区位于本机；
- 用户通过浏览器 File System Access 显式选择该目录；
- Editor 只通过用户点击写入固定相对路径；
- Agent Port 无任意文件写能力；
- apply 仍由项目所有者以独立启动参数授权。

这不是对恶意本机管理员的防护，也不得被描述为密码学签名。

---

## 五、Wave 6 范围

### 5.1 必须完成

1. 共享的人类审阅投影合同；
2. 不可变 comparison 审阅包；
3. Editor 新增“审阅”主标签与任务首页；
4. 候选、identical group、冲突、依赖、证据和因果影响的中文展示；
5. 冲突逐项裁决与结构化决定回执；
6. 共享层验证决定回执并生成 reviewed integration plan；
7. 结果审阅包与实际 stage preview fixture；
8. Editor 对最终计划、diff、证据和预览的整体批准或退回；
9. 最终批准回执与 integration commit gate 绑定；
10. scene、timeline、variable、character、config 对象的共享 working fingerprint 解析；
11. 真实外部 Agent 交接、isolated apply 和项目所有者人工验收。

### 5.2 明确不做

- Editor 内置聊天、模型选择、Prompt 编辑或模型 API；
- 云账号、远程协作、多人同时审阅；
- CRDT、OT、分布式锁或网络锁；
- 自动选择冲突、自动批准或自动 apply；
- Agent 自动 Git commit、push、PR 或部署；
- 资产导入、生成、移动、重命名和二进制事务；
- 全项目因果/可达性/孤立对象审计算法；
- 扩展市场、插件签名或权限沙箱；
- 音频生产、发行、性能资格化；
- 完整 Editor 视觉重构；
- 把旧聊天记录或自然语言报告迁入审阅数据模型。

### 5.3 不新增长期兼容层

Surdet 尚未发布 Review Workspace 公共格式。首版只支持 `reviewVersion: '1.0.0'`。开发期的旧实验包直接拒绝并要求重新生成，不增加 migration、fallback 或多版本解析树。

---

## 六、总体架构

```text
@surdet/authoring
  Review contracts
  Review projection
  Decision validation
  Shared working-object fingerprint resolver
  Approval freshness / commit gate
            │
            ├──────────────┐
            ▼              ▼
@surdet/cli / Agent Port   surdet-editor
  NodeReviewStore           Review Workspace reader/writer
  review package builder    Chinese presentation model
  typed capability adapter  conflict decision UI
  stage fixture materializer actual preview + causal drilldown
            │              approval/return receipt writer
            └──── same immutable review workspace ────┘
```

### 6.1 `@surdet/authoring`：唯一语义层

共享层负责：

- 从真实 `CompositionComparison` 生成稳定 Review Projection；
- 把机器对象和错误转为稳定语义分类，而不是中文文案；
- 验证决定回执的 comparison identity、候选身份、允许动作和完整性；
- 从决定回执机械生成现有 `BuildIntegrationPlanInput`；
- 生成最终计划审阅投影；
- 验证批准回执绑定的 plan、change、workingRevision、diff 和 evidence；
- 在 commit gate 前检查批准存在且新鲜；
- 提供所有可组合 produced object 的统一 working fingerprint 解析。

共享层不得：

- 导入 DOM、File System Access、Node `fs` 或 MCP SDK；
- 保存中文 UI 文案；
- 接受调用者提供 replay payload；
- 根据候选作者或模型名称改变冲突语义；
- 自动替人选择。

### 6.2 `@surdet/cli`：本地文件与进程适配

CLI 负责：

- `NodeReviewStore` 的 create-only 写入、身份 sidecar 与磁盘回读；
- 从项目基线与 integration working files 生成隔离 preview fixture；
- 路径、符号链接/reparse point、大小和目录归属防护；
- 将共享 review 能力机械投影到 registry、dispatcher 与 MCP；
- 返回 reviewId、相对身份、bytes 和 SHA-256；
- 清理自己启动的子进程，不删除历史审阅包。

CLI 不生成中文摘要，不复制比较算法，不接受任意输出路径，也不允许 Agent 通过参数切换项目或 dataDir。

### 6.3 `surdet-editor`：中文审阅与预览

Editor 负责：

- 用户显式选择审阅工作区；
- 校验 manifest/identity 后加载 Review Projection；
- 中文呈现任务、候选、相同结果、冲突、影响和证据；
- 保存尚未提交的本地裁决草稿；
- 用户点击后写入决定或批准回执；
- 打开审阅包内的隔离 project fixture；
- 复用现有预览、对象索引、因果选择和反向定位；
- 显示回执是否已被 Agent 读取、计划是否已更新、批准是否过期。

Editor 不连接模型，不启动 Agent，不读 Git，不重算 comparison/plan，不直接写真实项目。

---

## 七、共享 working fingerprint 收口

### 7.1 当前边界

Wave 5 的 candidate manifest 可以为 variable、character 和 config 产物计算规范 finalFingerprint，但 dry-run 与 READY 回读目前只覆盖 scene/timeline。实际 Wave 5 验收结果正确，但“所有可组合对象均经过最终指纹核对”的一般性保证尚未成立。

### 7.2 Wave 6 前置收口

新增一个共享、纯函数式对象解析入口，例如：

```ts
export async function fingerprintWorkingObject(
  files: Readonly<Record<string, string>>,
  objectRef: string,
  hasher: TextHasher,
): Promise<string | undefined>;
```

它必须与 `composition-manifest.ts` 的规范化语义同源，覆盖：

| 对象 | 指纹语义 |
|---|---|
| `scene:<id>` | 场景工作文本 SHA-256 |
| `timeline:<id>` | 时间轴工作文本 SHA-256 |
| `variable:<name>` | 变量声明 `stableStringify` SHA-256 |
| `character:<id>` | 单个角色声明 `stableStringify` SHA-256 |
| `config:characters` | 整个 characters 表规范 SHA-256 |
| `config:entryScene` | entryScene 规范值 SHA-256 |

删除 CLI 与 execution 内的两份 scene/timeline 私有解析。dry-run 对所有 plan provenance 产物生成 final fingerprint；READY 对 `plan.dryRun.finalObjectFingerprints` 每一项强制回读，不得 `continue` 跳过未知类型。未知或无法解析的已声明产物必须 fail-loud 为 `COMPOSITION_REPLAY_FAILED`。

### 7.3 为什么放在 Wave 6

审阅批准要绑定真实最终对象。若 variable/config 没有最终回读，Editor 会向用户展示比 commit gate 更强的保证。先统一指纹真相，才能让批准回执可信。

---

## 八、审阅工作区

### 8.1 目录布局

每次审阅使用独立、create-only 的本地目录：

```text
review-<reviewId>/
  review.json
  identity.json
  project/
  decisions/
    comparison-decision.json        # 用户完成第一阶段裁决后才出现
    final-approval.json              # 用户最终批准后才出现
    return-request.json              # 用户退回时出现，与 final-approval 互斥
  result/
    plan.json                        # Agent 生成计划后 create-only 写入
    stage-evidence.json              # stage 完成后 create-only 写入
    identity.json
```

`project/` 是只用于审阅和预览的隔离副本：

- comparison 阶段可不存在；
- stage 结果阶段必须等于 integration working files 投影后的真实项目；
- 原始项目树和 source capsules 不得改变；
- Editor 可以编辑该副本用于探索，但任何探索修改都使批准按钮失效，且不能反向写入 integration change。

### 8.2 审阅包身份

`identity.json` 至少包含：

```ts
interface ReviewIdentity {
  reviewVersion: '1.0.0';
  reviewId: string;
  reviewKind: 'comparison' | 'integration-result';
  payloadBytes: number;
  payloadSha256: string;
  projectIdentity: string;
  expectedProjectRevision: string;
  comparisonFingerprint: string;
  planFingerprint?: string;
  integrationChangeId?: string;
  workingRevision?: number;
}
```

所有路径使用 review root 相对路径。稳定 payload 不保存绝对路径、用户名、环境变量、Git remote、Prompt 或聊天记录。

### 8.3 create-only 与历史保留

- 同一 reviewId + 同一 payload 可幂等回读；
- 同一 reviewId + 不同 payload 必须失败；
- 决定和批准文件使用 exclusive create；
- 修改决定必须生成新的 decisionId，不覆盖旧文件；
- result 每次计划或 stage 变化生成新的 result revision；
- 历史失败包不自动删除、覆盖或筛选。

---

## 九、审阅数据合同

### 9.1 Review Projection

Review Projection 是机器事实的人类审阅投影，不是第二套 comparison：

```ts
interface HumanReviewProjection {
  reviewVersion: '1.0.0';
  reviewId: string;
  kind: 'comparison' | 'integration-result';
  projectIdentity: string;
  expectedProjectRevision: string;
  task: ReviewTaskSummary;
  candidates: ReviewCandidate[];
  safeGroups: ReviewSafeGroup[];
  conflicts: ReviewConflict[];
  dependencies: ReviewDependency[];
  evidence: ReviewEvidenceSummary;
  finalResult?: ReviewFinalResult;
  sourceIdentity: ReviewSourceIdentity;
}
```

投影中的每个条目必须保留原始 `candidateId`、`unitId`、`conflictId`、`groupId`、`objectRef` 和 fingerprint；Editor 的中文标题只是显示层。

### 9.2 任务摘要

任务摘要只允许使用 capsule 中已经封存的 bounded intent metadata：

- `title`；
- `goal`；
- `acceptanceCriteria[]`；
- 候选数量、对象数量、冲突数量；
- 当前状态和下一允许动作。

摘要不是 Agent 自证。Agent 提供的 title/goal 必须标记为“候选声明”；validation/simulation/runtime/diff 才是事实证据。

### 9.3 候选显示名

默认显示“方案 A、方案 B、方案 C……”和人类可读目标。模型名称、客户端名称或 initiator 只在“来源详情”中展示，不作为推荐依据。

### 9.4 安全相同组

每个 identical group 显示：

- 对象中文类型和名称；
- “N 个方案得到相同结果”；
- 最终结果摘要；
- 所有来源；
- 依赖对象；
- potentialImpact 与 observedImpact；
- 是否默认纳入。

默认折叠，但不得隐藏来源数量和 evidence warning。

### 9.5 冲突卡

每个 selection-required 冲突是一张独立卡片：

- “需要你决定”的中文标题；
- 冲突对象；
- 各方案的结果摘要；
- 直接影响和被影响对象；
- 证据状态；
- “选择此结果”“全部不要”“让 Agent 重做”三个允许动作；
- 展开后的技术详情：稳定 ID、fingerprint、source capsule、原始错误 code。

Editor 只能呈现 `allowedResolutions` 中的动作，不能自行创造第四种解决方案。

### 9.6 阻断与建议

- `blocking`：红色，不能生成决定回执；
- `selection-required`：橙色，必须逐项决定；
- `advisory`：黄色，可继续但必须在最终批准前再次汇总；
- `identical`：绿色，但不等于 validation passed；
- evidence missing/stale/failed：不能被颜色或文案弱化。

---

## 十、人类决定回执

### 10.1 第一阶段决定

```ts
interface ComparisonDecisionReceipt {
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
```

不保存自由文本 reason 到 planFingerprint；用户可写本地备注，但备注不改变计划语义。

### 10.2 验证规则

共享层消费回执时必须：

1. 回读 review payload 与 identity；
2. 重新计算 comparisonFingerprint；
3. 核对 project identity 与 revision；
4. 核对 candidate refs 完全相同且顺序规范化；
5. 确认 selectedUnitIds 存在且无重复；
6. 确认每个 selection-required 冲突恰有一个允许裁决；
7. 拒绝 blocking 状态；
8. 重新计算 decisionFingerprint；
9. 机械转换为 `BuildIntegrationPlanInput`；
10. 仍由现有 `buildIntegrationPlan` 做最终语义校验。

Editor 和 Agent 都不能直接提供 replay operations。

### 10.3 退回重做

选择 `regenerate-candidate` 时，回执只记录冲突和需要重做的 candidate identity。自然语言建议保留在人类本地备注中；Agent 根据结构化 repair action 和用户可选备注创建新候选，新候选必须进入新的 comparison，不得替换旧 capsule。

---

## 十一、最终计划与批准回执

### 11.1 结果审阅包

integration change 达到 `READY` 且 fresh validation/simulation/runtime/diff 完整后，CLI 生成结果审阅包。它必须包含：

- exact planId / planFingerprint；
- comparison 与 decision fingerprint；
- integration changeId / workingRevision；
- included、implicit、excluded、deduplicated units；
- replay receipts 与全部 provenance；
- final object fingerprints；
- semantic diff 和 changed files；
- potentialImpact / observedImpact；
- validation、simulation、runtime trace 身份与 freshness；
- warning 和 manualReviewRequired；
- 隔离 `project/` 的文件清单、bytes、SHA-256 与树身份；
- source project/capsule/change unchanged 证明。

### 11.2 最终批准回执

```ts
interface FinalApprovalReceipt {
  receiptVersion: '1.0.0';
  approvalId: string;
  reviewId: string;
  decisionFingerprint: string;
  planId: string;
  planFingerprint: string;
  integrationChangeId: string;
  workingRevision: number;
  diffEvidenceId: string;
  validationEvidenceId: string;
  simulationEvidenceId: string;
  runtimeTraceIds: string[];
  projectTreeSha256: string;
  reviewerChannel: 'surdet-editor-local';
  approvedAt: string;
  approvalFingerprint: string;
}
```

### 11.3 批准新鲜度

以下任一变化都使批准过期：

- planFingerprint 改变；
- integration changeId 改变；
- workingRevision 改变；
- diff/validation/simulation/runtime evidence 改变或 stale；
- preview project tree 改变；
- 项目基线 revision 改变；
- review package identity 不匹配。

### 11.4 commit gate

integration change 的 apply commit 在现有 READY、fresh evidence 和 transaction gate 前后增加 owner approval gate：

```text
assertIntegrationReadyForCommit
assertReviewApprovalPresent
assertReviewApprovalFresh
existing validation/simulation/runtime gates
existing project revision / lease / journal transaction
```

顺序须在实施任务书中按现有 `commitChange` 真实源码确定；无论最终插入点如何，都必须保证审批失败发生在任何项目文件替换之前。

普通非 integration change 不自动要求 Wave 6 approval receipt，避免把一个候选审阅功能扩展为所有 Editor 保存的强制流程。

### 11.5 退回回执

用户可选择“退回修改”。`return-request.json` 与 `final-approval.json` 互斥，绑定相同 result identity，并包含结构化原因类别：

- `CONTENT_NOT_ACCEPTED`；
- `CONFLICT_DECISION_WRONG`；
- `PREVIEW_NOT_ACCEPTED`；
- `EVIDENCE_INSUFFICIENT`；
- `WARNING_REQUIRES_REPAIR`。

自由文本说明可选、限长、仅供人机沟通，不参与领域判断。

---

## 十二、Editor 信息架构

### 12.1 顶层标签

新增主标签：`审阅`。

只有打开普通项目时，该标签显示“暂无审阅任务”；打开 review workspace 时显示任务内容。不得把现有“审计”标签改名或混用：

- **审计**：检查当前项目术语等问题；
- **审阅**：处理外部 Agent 候选、计划和批准。

### 12.2 任务首页

首屏由四块构成：

1. **任务概览**：目标、候选数量、当前阶段、最后更新时间；
2. **需要你决定**：未处理冲突数量与逐项入口；
3. **可安全合并**：identical 与无冲突组摘要；
4. **证据与风险**：校验、模拟、运行、警告和阻断。

主按钮根据状态只能出现一个：

- `开始审阅`；
- `继续处理 2 个冲突`；
- `保存我的决定`；
- `查看最终结果`；
- `批准这个计划`；
- `退回给 Agent 修改`；
- `审阅已过期，请刷新`。

### 12.3 布局

桌面宽屏采用：

```text
左：审阅目录与冲突列表
中：当前对象/方案差异与实际内容
右：因果、来源和证据
```

每列独立滚动，右侧因果或事件增长不得挤压中央预览。进入预览时，Gal 画面继续在可用区域双轴居中；审阅轨迹放在独立可滚动抽屉，不改变预览舞台尺寸。

窄屏按“列表 -> 详情 -> 因果/证据”切换，不强行三列压缩。

### 12.4 中文优先规则

默认界面不得直接出现：

- `selection-required`；
- `potentialImpact`；
- `observedImpact`；
- `workingRevision`；
- `comparisonFingerprint`；
- 英文完整错误句。

对应默认文案：

| 机器字段 | 默认中文 |
|---|---|
| selection-required | 需要你选择 |
| blocking | 当前无法继续 |
| advisory | 建议留意 |
| identical group | 多个方案结果相同 |
| potentialImpact | 可能影响 |
| observedImpact | 实际运行中观察到 |
| workingRevision | 当前审阅版本 |
| stale | 已过期，需要刷新 |

“技术详情”折叠区保留原始 ID、code、fingerprint 与 JSON 摘要，方便高级用户和 Agent 对照。

### 12.5 未知 code

未知 code 不能导致白屏或显示原始异常堆栈。默认显示：

```text
出现了当前版本尚未翻译的技术问题。
请展开技术详情，或退回给 Agent 根据错误代码修复。
```

原始 code 必须保留，不能翻译成另一个已知含义。

---

## 十三、对象比较与因果下钻

### 13.1 复用共享对象身份

所有审阅条目继续使用 `ObjectIndex` 的 objectRef/semanticId。Editor 不创建 review-only 场景 ID、第二套 timeline ref 或临时因果节点。

### 13.2 对象类型显示

首版覆盖 Wave 5 八项 composable capability 产生的对象：

- 场景；
- 变量；
- 角色；
- 角色表；
- 时间轴；
- 入口场景配置。

track/cue/asset 作为 timeline 的子对象和依赖展示，不成为新的独立候选裁决单位，除非共享 comparison 已经把它们提升为 unit。

### 13.3 差异层级

每个对象提供三层：

1. **摘要**：新增、修改、删除或结果相同；
2. **创作视图**：场景块、变量表、角色、timeline cue 的人类可读差异；
3. **技术详情**：before/after 文本或 JSON、fingerprint、operationId、source capsule。

### 13.4 因果关系

右侧因果区必须区分：

- **直接引用**；
- **直接被引用**；
- **可能影响**：来自静态对象关系和 plan closure；
- **实际观察**：来自 fresh runtime trace；
- **证据缺失**：没有 trace 时明确写“尚未观察”，不得推断为“没有影响”。

点击关系必须复用现有块编辑、timeline cue 和 preview trace 反向定位入口。

---

## 十四、预览设计

### 14.1 必须预览实际 stage 结果

不得根据 diff 在浏览器中猜一个“看起来像结果”的虚拟项目。结果审阅包的 `project/` 必须由 integration working files 覆盖基线副本后生成，并与 stage evidence 的项目树身份一致。

### 14.2 预览路径

- 默认入口：计划影响的第一个可运行场景；
- 可选择明确 sceneId 和 choices；
- timeline 可以独立预览；
- runtime trace 与预览画面一一对应；
- 预览失败显示结构化原因，不把 HTTP 200 或 scene-end 当成成功。

### 14.3 探索性编辑

用户可以在 review fixture 中临时编辑以验证想法，但：

- 一旦 fixture 文件变化，显示“你正在查看探索性修改”；
- 最终批准按钮立即禁用；
- 不写回 integration change；
- 用户只能丢弃探索修改后重新加载正式 result，或退回 Agent 重做。

Wave 6 不实现浏览器把探索性修改反向转换为 Agent patch。

---

## 十五、状态机

```text
COMPARISON_PREPARED
  -> DECISION_DRAFT
  -> DECIDED
  -> PLAN_PREPARED
  -> STAGE_READY
  -> OWNER_APPROVED
  -> APPLY_PENDING
  -> COMMITTED

任意审阅阶段
  -> RETURNED
  -> STALE
  -> INVALID
```

### 15.1 状态含义

| 状态 | 含义 | 允许动作 |
|---|---|---|
| COMPARISON_PREPARED | 候选比较可读 | 开始审阅 |
| DECISION_DRAFT | 本地有未完成选择 | 继续、清空草稿 |
| DECIDED | 决定回执已封存 | Agent 读取并生成计划 |
| PLAN_PREPARED | 计划已 dry-run | Agent 执行到 stage |
| STAGE_READY | 结果和 fresh evidence 完整 | 预览、批准、退回 |
| OWNER_APPROVED | 精确结果已批准 | 项目所有者另行启动 apply |
| APPLY_PENDING | apply Port 已显式 resume | 复核并 commit |
| COMMITTED | 隔离项目写入完成 | 只读回顾 |
| RETURNED | 用户不接受 | 新候选/新 comparison |
| STALE | 身份或 revision 改变 | 重新生成审阅包 |
| INVALID | 包损坏或版本不支持 | fail-loud，不修补原包 |

### 15.2 不自动转换

Editor 打开包、Agent 读取回执或 Port 重启都不得自动批准、apply、commit 或 rollback。每个高风险转换必须有明确调用和可审计结果。

---

## 十六、能力与工具边界

### 16.1 最小新增能力

正式新增四项协议无关能力，名称和职责固定如下，不得在实施时合并成万能工具：

| 能力 | 最低策略 | 作用 |
|---|---|---|
| `review.prepare-comparison` | observe | 从 fresh comparison 生成不可变审阅工作区 |
| `review.inspect-decision` | observe | 只读验证 Editor 决定回执 |
| `review.prepare-result` | stage | 从 READY integration change 生成结果审阅包和 preview fixture |
| `review.inspect-approval` | observe | 只读验证最终批准或退回回执；apply commit gate 在内部复用同一验证器 |

`composition.plan` 增加受审阅输入引用，而不是把 receipt 的任意 JSON 直接信任为 replay：

```ts
{
  candidateRefs,
  comparisonFingerprint,
  reviewDecision: {
    reviewId,
    decisionId,
    decisionFingerprint
  }
}
```

`composition.plan` 保留两种严格区分的输入路径：

- 既有直接选择输入只用于 Agent 的隔离 stage 探索，生成的 plan 必须标记为 `reviewState='unreviewed'`，不能满足 Wave 6 的 owner-reviewed integration apply gate；
- 上述 `reviewDecision` 输入用于正式人类审阅路径。共享层必须从回执机械生成选择，并把每个冲突裁决的 actor 固定为 `human`；MCP 调用方不能另传 actor 覆盖。

这条边界防止 Agent 绕过 Editor，使用旧的直接 plan 输入制造一个表面上可 apply 的“已审阅”计划。

### 16.2 Agent 不可创建人类回执

registry 不提供 `review.approve`、`review.write-decision` 或任意文件写工具。Agent 能：

- 创建审阅包；
- 告知用户目录；
- 检查回执是否出现和是否合法；
- 根据合法回执继续。

Agent 不能：

- 代替用户选择冲突；
- 写批准文件；
- 把聊天中的“看起来同意”转换成批准；
- 在回执缺失时降级为 review-agent 决定并进入 apply。

### 16.3 Registry 纪律

registry 只保存 contract metadata、schema、错误与短 repair recipe。中文长文案、页面结构、示例库、Prompt 和审阅策略树不得塞入 registry。

本轮默认不引入新依赖。浏览器侧继续使用现有 File System Access 能力，Node 侧复用现有存储、哈希与原子写入设施；若实施时发现确有新增依赖需求，必须先单独记录版本、许可证、Node/ESM 兼容性与体积理由，并停在任务书复审门，不能由执行 AI 顺手引入。

---

## 十七、错误合同

建议增加：

| code | 含义 | retryDisposition |
|---|---|---|
| REVIEW_NOT_FOUND | reviewId 不存在 | after-inspect |
| REVIEW_IDENTITY_MISMATCH | payload/sidecar/项目身份不一致 | never |
| REVIEW_FORMAT_UNSUPPORTED | 版本不支持 | never |
| REVIEW_DECISION_REQUIRED | 尚无人类决定 | after-human-review |
| REVIEW_DECISION_INVALID | 回执字段或允许动作非法 | after-human-review |
| REVIEW_DECISION_STALE | comparison/project 已变化 | after-refresh |
| REVIEW_RESULT_NOT_READY | integration 未 READY 或 evidence 不完整 | after-inspect |
| REVIEW_APPROVAL_REQUIRED | 尚未最终批准 | after-human-review |
| REVIEW_APPROVAL_STALE | plan/change/revision/evidence 已变化 | after-refresh |
| REVIEW_RETURNED | 用户明确退回 | never-same-plan |
| REVIEW_FIXTURE_CHANGED | 审阅副本被探索性修改 | after-refresh |

`after-human-review` 是稳定的新 retry disposition，只表示“等待用户在 Editor 中操作”，不得被 Agent 解读为重试相同工具。

错误 `details` 只返回稳定身份、当前状态、允许动作和相对审阅路径；不得泄露任意绝对输入路径、环境变量或完整项目文本。

---

## 十八、安全与资源限制

### 18.1 路径安全

- review root 由 NodeReviewStore 在绑定 dataDir 下创建；
- reviewId 只允许规范字符；
- 所有 manifest 路径必须是 `/` 分隔的相对路径；
- 拒绝 `..`、绝对路径、盘符、UNC、设备路径；
- Windows 大小写与 canonical spelling 使用现有路径安全原则；
- 拒绝符号链接、junction/reparse point 越界；
- 不跟随项目内指向外部的链接复制文件。

### 18.2 大小上限

首版保持有界：

- 候选 2–8；
- comparison units、依赖边和冲突沿用 Wave 5 上限；
- review JSON 设置明确字节上限；
- 人类备注单项限长；
- changed text 只包含本计划涉及文件；
- 大型二进制资产不嵌入 JSON，preview fixture 通过受控复制复用；
- 不把 runtime 全量无界日志写入包，只保存稳定 trace 与摘要。

### 18.3 内容安全

Agent 提供的 title、goal、summary、备注和项目文本都是不可信内容：

- DOM 一律使用 `textContent`；
- 不解析为 HTML/Markdown 脚本；
- 不执行链接、命令或 Prompt；
- 不允许审阅包改变 Editor 资源加载根；
- preview 仍使用现有隔离 iframe/消息边界。

---

## 十九、验证策略

### 19.1 共享合同测试

至少覆盖：

1. Review Projection 对输入顺序稳定；
2. 相同 A/D + 不同 C 正确显示安全组与冲突；
3. 决定回执缺项、重复、越权动作、错误 fingerprint 全部 fail-loud；
4. blocking comparison 无法生成决定；
5. reviewed plan 与直接构造的合法 plan 语义相同；
6. scene/timeline/variable/character/config 指纹均回读；
7. 任一最终对象指纹不匹配都不能 READY；
8. 批准绑定 workingRevision 与所有 fresh evidence；
9. 批准后发生一次 mutation 即 stale；
10. RETURNED 计划不能 commit。

### 19.2 Node store 与安全测试

覆盖：

- create-only 与幂等回读；
- payload/identity 三方核对；
- 路径穿越、大小写变体、reparse point；
- 同时准备两个 review 不互相覆盖；
- preview fixture 与 working files 一致；
- 原项目、source change、capsule 字节不变；
- 失败清理不删除历史包。

### 19.3 Editor 测试

覆盖：

- 中文首屏与状态；
- identical group 折叠但 provenance 可展开；
- 只有 allowedResolutions 可点击；
- 未处理冲突不能封存决定；
- technical details 默认折叠；
- 未知 code 友好降级；
- 右侧因果独立滚动，不挤压中央预览；
- preview 始终双轴居中；
- 探索性编辑立即使批准失效；
- 决定与批准写入固定文件且不触碰 project/；
- 刷新重开后草稿或已封存状态可恢复。

### 19.4 确定性 FORMAL

FORMAL 使用确定性客户端与固定 A/B/C/D fixture：

1. 生成 comparison review workspace；
2. 由测试专用的人类回执 fixture 模拟 Editor 输出，不通过 MCP 创建；
3. Agent Port 只读消费决定；
4. plan/execute/resume 到 READY；
5. 生成 result review workspace；
6. 测试专用批准回执模拟 Editor 输出；
7. apply 前修改 workingRevision，证明 stale approval 被拒绝；
8. 新鲜批准通过 isolated apply；
9. 所有 source 与原 Starter 不变；
10. 错误、子进程、端口、lease 和临时状态为空。

FORMAL 不能代替真实外部 Agent 和项目所有者视觉验收。

### 19.5 成本纪律

- runner 先做静态 schema、fixture 和 launcher preflight；
- 聚焦合同未绿前不得运行聚合；
- DIAGNOSTIC 次数必须在任务书中固定，预算耗尽即停；
- runner 冻结提交后才运行唯一 FORMAL；
- 不再出现“一修一 FORMAL”；
- `verify:all` 是否需要及次数按实际跨工作区风险在任务书中固定；
- 失败 artifact 全部保留。

---

## 二十、真实外部 Agent 验收

一个不了解 Surdet 源码的新外部 Agent，只获得：

- MCP 启动配置；
- 一个隔离项目；
- 两到四份候选任务目标；
- “等待项目所有者在 Editor 审阅”的流程目标。

它必须：

1. 创建候选并封存 capsule；
2. prepare comparison review；
3. 明确停止并给出审阅目录；
4. 不猜测或代填人类决定；
5. 在用户完成决定后 inspect receipt；
6. 生成 reviewed plan 并执行到 stage READY；
7. prepare result review；
8. 再次停止等待人类批准；
9. 获得合法批准后，只在项目所有者另行启动的 apply Port 中 resume；
10. commit 后回读项目与 capsule；
11. 全程不使用 Shell、直接文件编辑、Git 或源码阅读。

如果 Agent 需要超长专用提示词才能知道如何等待人类，应修 capability/schema/repair contract，不把提示词永久作为产品依赖。

---

## 二十一、项目所有者人工验收

项目所有者使用 Chrome/Edge 和隔离 review workspace：

### 21.1 Comparison 阶段

1. 打开 Editor；
2. 点击“打开审阅任务”；
3. 选择 review root，而不是原项目；
4. 首屏能用中文说明任务、候选、安全合并和待决冲突；
5. A/D 相同结果显示为一个安全组，来源 A/D 都可见；
6. C 的不同结果作为冲突显示；
7. 选择 A 后能看到 C 被排除、D 来源仍保留；
8. B timeline 作为依赖自动纳入且解释清楚；
9. 保存决定后生成决定回执；
10. 原始项目未变化。

### 21.2 Result 阶段

11. 刷新同一审阅任务后看到最终计划；
12. 对象差异、纳入、排除、去重和来源与计划一致；
13. 进入预览，Gal 画面保持中央显示；
14. Alpha A 可见、C 不存在、Beta timeline 可见；
15. 点击预览事件能跳回块或 timeline cue；
16. 因果区增长不会压缩预览；
17. validation/simulation/runtime 的通过、警告和缺失状态均诚实；
18. 点击“批准这个计划”生成最终批准回执；
19. 在批准后探索性编辑 fixture，批准立即显示过期；
20. 重新加载正式 result 后再次批准成功；
21. apply 仍需要项目所有者另行授权，Editor 不直接写原项目。

只由项目所有者填写布局、中文可读性、预览、交互和创作判断。自动化不得代填。

---

## 二十二、实施白名单原则

正式任务书应优先限制在：

- `packages/authoring/src/**` 与对应测试；
- `packages/cli/src/authoring/**`；
- `packages/cli/src/agent-port/**` 的机械投影；
- `packages/cli/test/**` 与一个 Wave 6 runner；
- `packages/editor/src/**` 与对应测试；
- 当前 Wave 6 规格、任务书和交付报告。

Core、Renderer、Host、Shell、Starter 和 Zero 生产逻辑默认不修改。若真实聚焦 RED 证明现有公开预览或对象合同缺字段，执行 AI 必须停止申请最小跨层授权，不能在 Editor/CLI 复制替代实现。

---

## 二十三、风险与控制

### 风险 1：Editor 变成第二套 composition engine

控制：Editor 只消费 Review Projection 和 allowedResolutions；决定回执交回共享层验证并调用现有 plan builder。

### 风险 2：Agent 伪造人类批准

控制：Agent Port 没有写回执能力；Editor 通过用户显式目录权限写入；批准绑定精确 result；apply 仍由 owner launcher 授权。诚实声明这不是对恶意本机程序的密码学防护。

### 风险 3：审阅一个结果、提交另一个结果

控制：approval 绑定 plan/change/workingRevision/diff/evidence/project tree；任何变化立即 stale；commit 在文件替换前拒绝。

### 风险 4：中文界面掩盖技术事实

控制：默认中文摘要，技术详情完整保留稳定 ID 与 code；未知 code 不猜译；warning 不因折叠而消失。

### 风险 5：审阅包夹带任意文件或路径

控制：NodeReviewStore 固定根、相对路径白名单、reparse 防护、大小限制、identity sidecar、create-only。

### 风险 6：预览与 stage 结果不同

控制：preview fixture 从 integration working files 机械生成并核对项目树；探索性改动使批准失效。

### 风险 7：Wave 6 过大

控制：只做一个 A/B/C/D 纵向切片；不做资产导入、项目审计、云协作、市场或完整 UI 重构；新增能力保持四个明确职责。

### 风险 8：验证再次陷入 runner 循环

控制：先永久合同、再 preflight、有界 DIAGNOSTIC、冻结后唯一 FORMAL；方法缺陷与产品缺陷分开记录；预算耗尽必须停。

---

## 二十四、否决方案

### 24.1 直接在 Editor 中连接大模型

否决。违背外部 Agent 友好路线，绑定供应商与 Prompt，制造第二套 AI 工作流。

### 24.2 Editor 自己读取 capsule 后重算冲突和计划

否决。会复制 `@surdet/authoring` 的核心语义，并造成 UI 与 Agent Port 结果漂移。

### 24.3 只展示 JSON diff

否决。技术上最省事，但没有解决零基础用户无法判断候选的真实产品问题。

### 24.4 一键接受某个 Agent 的全部改动

否决。以 Agent 身份替代对象证据，并丢弃安全组合能力。

### 24.5 Editor 直接 apply 真实项目

否决。把预览、决定和高风险写回混在浏览器按钮里；现有显式 apply/resume 是更清晰的安全边界。

### 24.6 本轮同时做全项目审计或资产导入

延期。这两项仍是高价值候选，但会分别引入新算法或二进制事务，不能与人类审批门混成一轮。

---

## 二十五、成功标准

只有同时满足以下事实，才能宣布 Wave 6 完成：

1. 人类审阅投影由共享层生成，Editor 无第二套 comparison/plan；
2. A/D 相同结果、C 冲突和 B 隐式 timeline 在中文 UI 中正确表达；
3. 决定回执能稳定生成 reviewed plan；
4. 所有可组合对象的最终指纹均被 dry-run 与 READY 回读；
5. 实际 stage result 可在 Editor 中预览、因果下钻与反向定位；
6. 人类批准绑定精确 result，任何变化都会 stale；
7. integration commit 缺少或使用过期批准时 fail-loud；
8. Agent 无法通过 MCP 创建人类回执；
9. 原项目在 comparison/stage/review 阶段保持不变；
10. external Agent、isolated apply 和 Owner 人工路径分别通过；
11. 默认界面中文清晰，技术详情可展开；
12. 没有内嵌模型、自动 Git、资产导入、市场、云或 Wave 7 夹带。

---

## 二十六、未来衔接

Wave 6 通过后，后续优先级可重新选择：

1. **全项目因果、可达性与孤立对象审计**：审计结果直接进入同一审阅台；
2. **受控资产接入与来源链**：资产候选也使用同一决定与批准回执；
3. **更人性化的编辑器创作向导**：把常见场景/演出创建做成中文步骤；
4. **扩展市场合同**：建立签名、权限、可复现安装与审阅包；
5. **多用户或远程协作**：必须另行设计身份、认证和网络一致性。

这些不是 Wave 6 的隐藏施工范围。

---

## 二十七、规格自审清单

- [x] Wave 6 第一用户明确为项目所有者；
- [x] A/A1/P1 三项裁决已固定；
- [x] Agent 与人类使用不同呈现层、同一共享语义；
- [x] Editor 不内嵌模型、不重算 comparison/plan；
- [x] 人类决定与最终批准分为两阶段；
- [x] approval 绑定 exact result 并进入 integration commit gate；
- [x] apply 仍需项目所有者另行启动；
- [x] Wave 5 working fingerprint 边界纳入前置收口；
- [x] 中文 UI 与技术详情分层明确；
- [x] preview 居中与因果独立滚动明确；
- [x] 文件、路径、并发、stale 与错误边界明确；
- [x] 自动化、真实 Agent 与人工验收互不冒充；
- [x] 未夹带项目审计、资产导入、市场、音频、性能或发行；
- [x] 无 `TBD`、`TODO`、占位实现或模糊“以后处理”。

---

## 二十八、当前停止点

```text
STAGE_6_WAVE_6_DIRECTION_A_SELECTED
REVIEW_TASK_WORKBENCH_A1_SELECTED
CONFLICT_LEVEL_DECISION_AND_PLAN_LEVEL_APPROVAL_P1_SELECTED
DESIGN_SPEC_COMPLETE
IMPLEMENTATION_TASKBOOK_NOT_CREATED
IMPLEMENTATION_NOT_AUTHORIZED
FORMAL_NOT_STARTED
OWNER_ACCEPTANCE_NOT_STARTED
NOT_PUSHED_AFTER_WAVE_6_DESIGN
WAITING_FOR_OWNER_FILE_LEVEL_REVIEW
```

项目所有者批准本规格后，总经理才可使用 `writing-plans` 方法制作 Wave 6 详细总任务书。规格批准不自动授权生产施工、FORMAL、外部 Agent 验收、apply、push、部署、发行或 Wave 7。
