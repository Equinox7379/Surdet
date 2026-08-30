# Wave 6 Owner 审阅可理解性修复任务书

> **Task ID:** `W6-OWNER-REVIEW-COMPREHENSIBILITY-1`
> **阶段归属:** Stage 6 Wave 6 / Human-Agent Review Workbench / Owner Comparison Gate Recovery
> **状态:** `READY_FOR_OWNER_DISPATCH`
> **实施授权:** 本任务书生成不等于自动开工；项目所有者将本文件明确交给执行 AI 后，才允许从 Task 0 开始。
> **默认执行方式:** 一个执行 AI 串行施工；本文件不授权创建子 Agent、并行修改或进入 Wave 7。
> **权威运行台账:** `docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md` 的既有 `Execution Ledger`。本轮不得创建第二本运行台账。

## 一、结论先行

Wave 6 的 comparison、决定保存与重开语义已经通过真实外部 Agent、真实 Editor 截图和磁盘回读；本轮不重做 comparison、receipt 或 integration 语义。

当前阻断是一个独立的产品合同缺口：Owner 虽然能够点击并保存决定，却不能只根据默认中文界面理解“每个方案具体会把作品改成什么”。因此，本轮只修复 comparison review 的人类可理解层，使普通创作者无需任务书外部提示、无需阅读 fingerprint、candidateId、unitId 或 JSON，也能分辨冲突选项并做出有内容依据的决定。

目标链路：

~~~text
typed candidate manifest
  -> @surdet/authoring 机械生成可审计的人类摘要
  -> comparison review projection 持久化摘要与稳定来源绑定
  -> surdet-editor 默认中文层显示真实内容差异
  -> 技术 ID 继续留在可展开技术详情
  -> Owner 在全新隔离 review workspace 中保存并重开决定
  -> 停止，等待 Wave 6 外部 Agent 第二阶段的另行授权
~~~

本轮不是 Editor 美术重构、不是 comparison 算法重写、不是新的 Agent 能力，也不是 Wave 7。

---

## 二、为什么现在必须修

### 2.1 已确认事实

以下事实已经由真实外部 Agent 报告、Owner 三张截图和总经理磁盘回读共同确认：

1. comparison review workspace 成功生成并可在 Editor 打开；
2. `scene:wave5_alpha` 的 logical A / D 构成相同结果组，两个 provenance 均保留；
3. `variable:flag.alpha` 的 logical A / D 同样构成相同结果组；
4. logical C 作为 `OBJECT_RESULTS_DIVERGE` 冲突显式出现，没有被静默丢弃；
5. `scene:wave5_beta -> timeline:beta_opening` 作为隐式依赖出现；
6. Owner 能保存决定并重新打开同一决定回执；
7. 已保存的选择是 logical D / display C；它与 logical A 的 scene final fingerprint 相同，因此没有改变预期结果，且不应删除或改写该不可变回执；
8. comparison 阶段没有修改隔离项目或原始 Starter；
9. 当前人工 Editor 服务已从共享端口 `4173` 移到 `http://127.0.0.1:4175/`；`4173` 留给其他项目，本轮不得重新占用。

### 2.2 已确认的人类可理解性缺口

1. 共享投影无候选意图时生成英文标题 `Candidate composition review`，违反 Wave 6 默认中文界面合同；
2. `displayOrdinal` 是按 canonical candidate ref 动态排序得到的本次审阅编号，并不等于 fixture 或任务书里的 logical A/B/C/D；默认 UI 没有解释这一点；
3. 冲突选项默认只显示方案字母、对象引用、处置、证据状态、空影响和技术指纹；Owner 看不到 `Alpha route A.` 与 `Alpha route C.` 的真实内容差异；
4. 当前 `ReviewUnitOutcome` 只保留 object ref / disposition / fingerprint / impact / evidence；candidate manifest 中已有的 typed normalized input 没有进入人类审阅投影；
5. 因此当前界面虽然“可操作”，但不能证明“非技术 Owner 可以基于作品内容做决定”。

### 2.3 合理推断

如果只把英文标题改成中文、或给方案卡片再加一个短哈希，Owner 仍然无法理解冲突内容。这只能改善表面文案，不能关闭本轮缺口。

### 2.4 尚未验证

1. 对所有 composable capability 的人类摘要格式是否都能一次设计到位；
2. 默认并行 `verify:all` 的容量风险是否已经消失；
3. Wave 6 外部 Agent 第二阶段、result review、isolated apply 是否会受本轮新 comparison payload 影响。

这些未知项不得被写成已通过；任务书用最小支持面、兼容回读和新的隔离验收分别处理。

---

## 三、产品与架构裁决

### 3.1 双通道信息结构

Owner 默认层只显示：

- 中文任务目标与当前状态；
- “本次审阅编号”的明确说明；
- 候选声明意图（若确实存在）；
- 每个冲突选项会对作品做什么；
- 能区分选项的台词、选择、变量或演出摘要；
- 证据是否缺失、是否需要谨慎；
- 选择后会纳入、排除和保留哪些来源。

技术详情继续显示：

- candidateId / changeId / capsuleId；
- unitId / conflictId；
- final fingerprint / artifact SHA；
- raw error code 与完整 source binding。

不得把技术详情复制到默认层，也不得为了“更直观”隐藏技术详情。

### 3.2 共享真相落点

人类摘要必须由 `@surdet/authoring` 根据已验证 candidate manifest 的 typed `CompositionOperation.normalizedInput` 机械生成；Editor 只渲染共享摘要。

禁止：

- Editor 重新解析 `.gal` 或 timeline JSON；
- Editor 根据 fingerprint 猜内容；
- CLI/MCP 维护第二套中文摘要算法；
- 把 raw normalized input 或整段 JSON 直接当成人类摘要；
- 调用模型生成文案；
- 保存 Prompt、聊天记录、模型评分或供应商信息。

### 3.3 摘要合同

实现应新增一个小而明确的共享 presentation contract。名称可按现有命名风格调整，但语义必须等价：

~~~ts
interface ReviewUnitPresentation {
  actionLabel: string;       // 例如“新建场景”
  objectLabel: string;       // 例如“场景 wave5_alpha”
  highlights: string[];      // 例如“凛：Alpha route A.”
  completeness: 'content' | 'metadata-only';
  omittedFactCount: number;  // 发生有界折叠时显式记录，不得静默截断
}
~~~

约束：

1. presentation 必须可由 typed manifest 确定性重建；
2. 同一输入数组顺序变化后，输出与 fingerprint 必须稳定；
3. `highlights` 只抽取对创作者有意义的事实，不包含 operationId、绝对路径、Prompt 或任意 raw JSON；
4. 文本过长时允许有界展示，但必须保留完整事实数量，并在 UI 明示“另有 N 项”；
5. 不支持的 capability 必须输出 `metadata-only` 和清楚的中文提示，不得伪造内容摘要；
6. 当前真实验收所需的 `scene.create` 必须达到 `content`，并能区分 `Alpha route A.` 与 `Alpha route C.`；
7. 当前八项 composable mutation 均给出最小 typed 摘要：`scene.create`、`scene.patch`、`variable.ensure`、`character.ensure`、`character.remove`、`timeline.create`、`timeline.patch`、`project.entry-scene.set`；
8. 不得为尚不存在的 capability 建立预防性框架。

### 3.4 审阅编号与来源身份

`displayOrdinal` 继续是 canonical 排序得到的本次审阅编号；不得改回 fixture logical A/B/C/D，不得改变 comparison ordering。

Editor 必须在候选列表上明确显示：

~~~text
方案 A（本次审阅编号）
~~~

并在列表附近给出一次简短说明：

~~~text
方案字母只用于本次审阅排序；请根据内容摘要选择，系统会用稳定来源身份保存决定。
~~~

默认层不得宣称“方案 A 就是 Agent A”或“方案 C 就是任务书 C”。稳定 candidate/unit binding 仍由共享投影与回执负责。

### 3.5 fallback 中文标题

无候选声明意图时，共享投影的默认任务标题改为明确中文，例如：

~~~text
候选创作方案审阅
~~~

若候选确实提供了声明意图，保留原始声明，不擅自翻译或改写；在 UI 标注它是“候选声明目标”，避免把 Agent 文案伪装为引擎结论。

### 3.6 身份与兼容边界

1. `comparisonFingerprint`、candidateId、unitId、groupId、conflictId、final fingerprint 的生成算法不得改变；
2. 现有 acceptance review、三张截图和 `decision.json` 均为历史证据，禁止修改、删除、移动或重写；
3. 新 presentation 字段必须是 additive；旧 `reviewVersion='1.0.0'` payload 没有该字段时仍可打开、读取旧决定并显示明确的“旧审阅包缺少内容摘要”；
4. 不创建 migration，不回填旧 payload；
5. presentation 是 Owner 做决定时看到的事实。新 review payload 的 `reviewFingerprint` 必须明确覆盖它，避免摘要变化后旧决定被误认作同一审阅内容；
6. 对旧 payload 重新计算 fingerprint 时，不得因“缺少可选字段”改变其历史 fingerprint；必须有永久回归证明；
7. task fallback 标题是否进入 review fingerprint 维持现有语义，不借本轮扩大 identity 合同。

### 3.7 停止边界

本轮通过后只允许得到：

~~~text
OWNER_COMPARISON_HUMAN_READABILITY_RESTORED
READY_TO_RESUME_WAVE_6_EXTERNAL_AGENT_SECOND_STAGE
~~~

它不自动授权：

- composition.plan；
- composition.execute；
- result review；
- isolated apply/resume；
- push；
- Wave 7。

---

## 四、文件白名单

### 4.1 生产与测试白名单

允许按实际最小需要修改或新增：

~~~text
packages/authoring/src/review-contracts.ts
packages/authoring/src/review-projection.ts
packages/authoring/src/review-presentation.ts              # 仅在独立 helper 确实更清晰时新增
packages/authoring/src/index.ts                            # 仅在新增公共类型尚未被现有 export 覆盖时
packages/authoring/test/review-projection.test.ts
packages/authoring/test/review-receipts.test.ts            # 仅兼容回读/identity 回归

packages/cli/src/authoring/review-service.ts
packages/cli/test/review-service.test.ts

packages/editor/src/review-model.ts
packages/editor/src/panels/review-panel.ts
packages/editor/src/styles.css
packages/editor/test/review-model.test.ts
packages/editor/test/review-panel.test.ts
packages/editor/test/review-workspace.test.ts              # 仅旧 payload/receipt 回读

packages/cli/e2e/owner-review-comprehensibility-wave-6.e2e.mjs
packages/cli/test/owner-review-comprehensibility-wave-6-runner.test.mjs
~~~

不是每个文件都必须修改。能用更小集合完成时，应缩小范围。

### 4.2 治理白名单

~~~text
docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md
docs/superpowers/plans/2026-08-30-wave-6-owner-review-comprehensibility-repair.md
docs/WAVE-6-OWNER-REVIEW-COMPREHENSIBILITY-REPAIR-DELIVERY-REPORT-2026-08-30.md
~~~

运行事实只追加到第一份既有 Wave 6 Execution Ledger。新任务书不建立第二本滚动 Ledger。

### 4.3 明确禁止

- `packages/authoring/src/candidate-comparison.ts`
- `packages/authoring/src/integration-plan.ts`
- `packages/authoring/src/integration-execution.ts`
- receipt sealing / validation 生产语义，除非永久 RED 证明旧 payload additive 兼容确实需要极小改动并先停请示
- Agent Port capability registry、MCP schema、dispatcher、server
- Core、Renderer、Host、Shell 生产代码
- Starter、Zero、游戏内容、资产、存档格式
- dependencies、lockfile、性能门限、发布与部署
- 长期路线台账（Wave 6 未 reviewed closure）
- 受保护文件、历史 handoff、历史 artifact、旧 acceptance 目录

若实现必须越出生产白名单，立即停止并提交静态证据；不得先改后报。

---

## 五、验证预算与成本纪律

本轮是共享 authoring projection + Editor 默认呈现的 C 级边界修复，但不改变引擎运行、存档或 apply 语义。

预算：

~~~text
Focused RED/GREEN: 按任务步骤运行，不限于一次，但每次必须针对真实修改
Affected workspace full tests: Authoring 1 次，Editor 1 次
CLI full tests: NOT AUTHORIZED（只跑 review-service 聚焦）
verify:all: NOT AUTHORIZED（既有并行容量风险仍开放，且与本轮目标不成比例）
Launcher preflight: 1/1
Focused DIAGNOSTIC: 最多 2 次
Focused FORMAL: 1/1，必须在冻结 CODE_EVIDENCE_HEAD 上
Acceptance-prep: 需 Owner 另行批准，1/1
External Agent comparison retry: 需 Owner 另行启动，1 个全新 workspace
Owner short retest: 1 条真实路径；只需报告第一个异常
~~~

DIAGNOSTIC 第 1 次失败后，只允许在确认 runner 或本轮产品范围内缺陷、建立对应 RED 并完成修复后运行第 2 次。第 2 次失败即停，不申请第 3 次。

Focused FORMAL 失败即停。不得自行 replacement FORMAL。

---

## 六、Task 0 — 接管与真实基线

- [ ] 完整读取 `E:\surdet\AGENTS.md`。
- [ ] 完整读取本任务书。
- [ ] 定向读取既有 Wave 6 任务书的 Global Constraints、Task 11.3 和 Execution Ledger 尾部，不重读无关历史正文。
- [ ] 读取三张 Owner 截图的 Ledger 身份与 acceptance review/decision 磁盘身份；不改写它们。
- [ ] 读取本任务书白名单中的源码和现有测试。
- [ ] 用 Serena/符号索引确认 `buildComparisonReviewProjection`、`projectUnitOutcome`、`reviewFingerprintPayload`、`ReviewUnitOutcome`、`candidateIntent`、`renderComparisonReview` 的真实调用链。
- [ ] 运行只读 Git 基线：HEAD、parent、`surdet/main`、ahead/behind、tracked/staged/untracked。
- [ ] 确认 tracked 既有修改仅为 Wave 6 Execution Ledger，新任务书是本轮治理文件；其他 untracked 均不得触碰。
- [ ] 确认 `4173` 不被 Surdet 占用；若人工 Editor 已在 `4175` 正常运行，不停止或重启。自动 runner 使用 launcher 管理的独立端口。

必须把现场值 append-only 写入既有 Wave 6 Execution Ledger。若代码基线与本任务书不一致，先报告差异；不机械套用旧行号。

Task 0 停止条件：

- HEAD behind remote；
- 出现未授权 tracked 代码修改；
- staging 非空；
- acceptance 历史证据身份变化；
- 需要覆盖或删除已有 decision receipt。

---

## 七、Task 1 — 建立永久 RED

### 7.1 Authoring RED

在 `review-projection.test.ts` 至少建立以下失败合同：

1. 无 candidate intent 时 task title 是中文，不包含 `Candidate composition review`；
2. `scene.create` 的 A/C normalized inputs 能生成不同的内容摘要，分别包含 `Alpha route A.` 与 `Alpha route C.`；
3. A/D 相同结果仍保留两份来源，摘要不会合并掉 provenance；
4. summary 与 candidateId/unitId 精确绑定，数组 shuffle 后 projection 与 reviewFingerprint 稳定；
5. `metadata-only` fallback 不伪造台词；
6. 新 presentation 改变时新 reviewFingerprint 改变；
7. 旧 payload 不含 presentation 时历史 fingerprint 与决定校验保持成立。

### 7.2 CLI RED

在 `review-service.test.ts` 建立一条真实 service 投影合同：

- `prepareComparison` 使用 verified candidate manifest；
- 生成的新 review payload 包含 A/C 内容摘要；
- payload 不包含 raw operationId、绝对路径或整个 normalized input dump；
- comparisonFingerprint 不变，reviewFingerprint 为新 payload 的准确身份。

### 7.3 Editor RED

在 `review-panel.test.ts` / `review-model.test.ts` 建立：

1. 默认中文任务标题；
2. “本次审阅编号”说明可见；
3. A/C 冲突卡片默认层可见真实台词差异；
4. A/D 相同结果显示两来源且不误称为两个不同内容；
5. default layer 不出现 raw `OBJECT_RESULTS_DIVERGE`、candidateId、unitId、fingerprint；
6. 展开技术详情后上述技术身份仍可见；
7. `metadata-only` 选项显示“内容摘要不足”，不显示臆造文案；
8. 保存决定仍写 exact chosenUnitId，关闭重开后 readonly receipt 仍成立；
9. 旧 comparison payload 无 presentation 时仍能打开，并清楚标记旧包摘要不足。

### 7.4 RED 纪律

先只改测试。运行：

~~~powershell
npm run test -w @surdet/authoring -- review-projection.test.ts review-receipts.test.ts
npm run test -w @surdet/cli -- review-service.test.ts
npm run test -w surdet-editor -- review-model.test.ts review-panel.test.ts review-workspace.test.ts
~~~

至少每层与其目标相符的断言失败。零收集、模块找不到、旧 dist 或错误测试文件记为 `HARNESS_INVALID`，不得作为 RED。

保存三份 RED 日志的 path/bytes/SHA-256/exit code/test counts，并追加到既有 Ledger。

---

## 八、Task 2 — 共享 presentation 最小实现

- [ ] 在 `review-contracts.ts` 增加 additive 的 unit presentation 类型与可选字段。
- [ ] 在 `review-presentation.ts` 或 `review-projection.ts` 内实现单一 typed formatter；优先独立小 helper，避免继续膨胀 projection 文件。
- [ ] formatter 以 capabilityId + normalizedInput 为输入，不读磁盘、不解析生成后的文件、不依赖 Editor。
- [ ] 建立 candidateId + operation sequence 到 manifest operation 的确定映射，再映射到 exact ReviewUnitOutcome。
- [ ] 为 `scene.create` 提取场景名、speaker、text、choice 等真正可区分内容；当前 A/C 路径必须产生不同 highlights。
- [ ] 为其他现有 composable capability 实现简单、确定、有限的 typed 摘要；不创建未来框架。
- [ ] 对长列表保留显式 omittedFactCount；不得无提示截断。
- [ ] 无法可靠摘要时生成 `metadata-only`，不回退 raw JSON。
- [ ] fallback task title 改成中文。
- [ ] 更新 `reviewFingerprintPayload`：新 presentation 必须进入新 review identity；旧可选字段缺失时保持旧 identity。
- [ ] 不改 comparisonFingerprint 或 candidate comparison 排序。

实现后先运行 Authoring 聚焦 GREEN。失败只修本 Task 范围，不顺手重构。

---

## 九、Task 3 — CLI 只传递共享真相

- [ ] `review-service.ts` 把已验证 candidate 的 manifest facts 传给共享 projection builder。
- [ ] 不在 CLI 拼中文摘要。
- [ ] 不在 Agent Port schema 增加 presentation 专用能力。
- [ ] 不改变 `review.prepare-comparison` 的调用方式或 Agent policy。
- [ ] 新 payload 继续由 Node review store create-only 写入并由 identity.json 绑定。
- [ ] 旧 workspace 的读取路径不回填、不覆盖。

运行 CLI 聚焦 GREEN 与 typecheck/build；build 必须在后续 E2E 前完成，避免 runner 使用旧 dist。

---

## 十、Task 4 — Editor 默认人类层

- [ ] 左侧任务标题使用共享中文 fallback。
- [ ] 候选列表明确 `方案 X（本次审阅编号）`，并显示一次编号说明。
- [ ] 若有 declared intent，以“候选声明目标”显示；没有时不造意图。
- [ ] 安全相同组默认显示“内容结果相同，保留 N 个来源”，展开后能看到每个来源的摘要。
- [ ] selection-required 冲突选项默认显示 actionLabel、objectLabel、highlights、证据状态和 impact；A/C 台词差异无需展开技术详情即可看见。
- [ ] `metadata-only` 明确显示摘要不足。
- [ ] technical details 继续 lazy；技术 ID 只在展开后出现。
- [ ] 选择按钮可访问名称必须包含人类摘要，不能只读“选择方案 C”。
- [ ] 保存、重开、只读 receipt、exact chosenUnitId 逻辑保持原样。
- [ ] CSS 只做支撑阅读层级和换行的最小改动；不重做整个审阅台布局。
- [ ] 不占用 `4173`，人工复测固定使用 `4175`。

运行 Editor 聚焦 GREEN。

---

## 十一、Task 5 — 兼容与身份回归

必须建立并通过以下永久回归：

1. 新 payload 的 A/C presentation 分别绑定正确 candidateId/unitId/finalFingerprint；
2. A/D presentation 与 provenance 同时保留；
3. 内容摘要变化导致新 reviewFingerprint 变化；
4. 仅 candidate 输入顺序变化不改变 projection/fingerprint；
5. 当前历史 acceptance review 与 decision receipt 不被打开流程改写；
6. 一个测试内构造的旧 v1 payload（无 presentation）仍能读取和重开 receipt；
7. 旧 payload UI 清楚提示摘要不足；
8. 保存决定仍禁止不同 payload 覆盖同一 decisionId；
9. 默认层没有 raw JSON、绝对路径或英文 error code；
10. 技术详情仍保留完整审计身份。

不得在自动测试中修改真实桌面 acceptance 目录；用新的临时 fixture。

---

## 十二、Task 6 — 受影响工作区门禁

按顺序运行一次：

~~~powershell
npm run test -w @surdet/authoring -- review-projection.test.ts review-receipts.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/authoring

npm run test -w @surdet/cli -- review-service.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli

npm run test -w surdet-editor -- review-model.test.ts review-panel.test.ts review-workspace.test.ts
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
npm run test -w surdet-editor

git diff --check
git diff --cached --check
~~~

预期：全部 PASS。

本轮不运行 `verify:all`，不运行默认并行 CLI 全量，不把既有 capacity 风险改写为已解决。

任一门失败：只允许修与本轮白名单直接相关的真实失败；若属于白名单外生产问题，停止请示。

---

## 十三、Task 7 — Focused E2E 证据

### 13.1 新建小型 runner

新增独立 runner，不修改历史 Wave 6 FORMAL artifact，也不把 22 节点全链重新当作本轮目标。

固定节点建议：

1. `launcher-and-baseline`
2. `comparison-workspace-created`
3. `localized-task-visible`
4. `review-ordinal-explained`
5. `identical-provenance-visible`
6. `conflict-content-distinguishable`
7. `technical-details-lazy`
8. `decision-saved-exact-unit`
9. `decision-reopened-readonly`
10. `project-and-starter-unchanged`
11. `cleanup-and-identity`

Runner 必须：

- 使用正式 CLI dist 与 Editor build entry；
- 创建全新系统临时 fixture；
- 使用 typed candidate manifests 生成 A/D identical、C divergent、B dependency；
- 默认层断言 `Alpha route A.` / `Alpha route C.` 真正可区分；
- 断言技术 ID 默认不可见、展开后可见；
- 保存并重开 exact unit receipt；
- 不 plan、不 execute、不 apply；
- 失败也写 evidence.json / identity.json；
- 记录 runHead、runnerSha256、trackedCodeDiffPaths、error channels、cleanup、lease、project mutation、Starter identity。

### 13.2 Runner RED/GREEN

先建立 runner contract RED，再实现 runner GREEN：

~~~powershell
node --test packages/cli/test/owner-review-comprehensibility-wave-6-runner.test.mjs
node --check packages/cli/e2e/owner-review-comprehensibility-wave-6.e2e.mjs
~~~

### 13.3 唯一 preflight

~~~powershell
node packages/cli/e2e/owner-review-comprehensibility-wave-6.e2e.mjs --mode=preflight
~~~

必须证明 launcher/cwd/dist/entry、Editor build、stdout purity、child cleanup、Starter unchanged。只运行一次。

### 13.4 DIAGNOSTIC

~~~powershell
node packages/cli/e2e/owner-review-comprehensibility-wave-6.e2e.mjs --mode=diagnostic
~~~

最多 2 次，规则见第五节。每次 artifact 身份和节点状态追加到既有 Wave 6 Ledger。

第 2 次仍失败：

~~~text
W6_OWNER_REVIEW_COMPREHENSIBILITY_DIAGNOSTIC_BUDGET_EXHAUSTED
FORMAL_NOT_RUN
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
~~~

---

## 十四、Task 8 — 冻结代码证据与 Focused FORMAL

### 14.1 精确暂存与代码证据提交

DIAGNOSTIC 通过后：

1. 把所有真实运行事实 append-only 写入既有 Wave 6 Execution Ledger；
2. 核对实际 diff 只包含白名单；
3. 精确暂存生产、测试、focused runner、runner test、本任务书和截至冻结点的既有 Wave 6 Ledger；
4. 普通本地提交：

~~~text
fix(editor): make owner review choices understandable
~~~

5. 记录 `CODE_EVIDENCE_HEAD`；
6. 确认 tracked worktree clean、staging empty；
7. 不 push。

### 14.2 唯一 Focused FORMAL

~~~powershell
$env:SURDET_CODE_EVIDENCE_HEAD = (git rev-parse HEAD)
node packages/cli/e2e/owner-review-comprehensibility-wave-6.e2e.mjs --mode=formal
~~~

必须满足：

- 11/11 固定节点 PASS；
- `artifact.runHead === CODE_EVIDENCE_HEAD`；
- `trackedCodeDiffPaths=[]`；
- runner SHA 与冻结文件一致；
- default 中文层通过；
- A/C 内容差异通过；
- A/D provenance 通过；
- 决定保存与重开通过；
- 所有错误、cleanup、lease 通道为空；
- fixture project 和原始 Starter unchanged；
- 无 plan/execute/apply。

失败即停止，不修改后重跑，不自行申请 replacement FORMAL。

FORMAL 后只允许把磁盘回读事实追加到既有 Ledger；保持为未提交治理差异，等待 acceptance 授权。

---

## 十五、Task 9 — 新 Acceptance 与 Owner 短复测

### 15.1 授权边界

Focused FORMAL 通过后先停：

~~~text
W6_OWNER_REVIEW_COMPREHENSIBILITY_FORMAL_PASSED
WAITING_FOR_OWNER_ACCEPTANCE_PREP_AUTHORIZATION
EXTERNAL_AGENT_NOT_STARTED
~~~

没有项目所有者明确批准，不得运行 acceptance-prep。

### 15.2 唯一 acceptance-prep

获批后，用冻结 Wave 6 acceptance helper 创建一个全新桌面 root；不得复用 `jMSfT5` 或任何历史目录。命名遵循已经更正并验证的 `mkdtempSync` 前缀合同。

必须回读 root/project/dataDir/config/evidence/identity/tree identity，并确认：

- root 在 Desktop、仓库外、运行前不存在；
- project fixture 等于 Starter；
- 原始 Starter unchanged；
- 无 external/integration active change；
- 无工具调用、无决定、无 apply。

失败一次即停，不手工补造。

### 15.3 真实外部 Agent comparison stage

项目所有者把以下文字交给一个不知道 Surdet 源码的新外部 Agent：

~~~text
只使用这次新 acceptance root 的 Surdet Agent Port。读取 capability schema，比较 A/B/C/D sealed candidates，创建 comparison review workspace，然后停止等待人类决定。不得使用 Shell、文件系统、Git 或其他 Surdet 服务；不得写 decision/approval；不得 composition.plan、composition.execute、apply、commit 或 rollback。
~~~

Agent 报告 reviewId、comparisonFingerprint、A/D groups、C conflict、B dependency、工具调用数、project mutation=false 后停止。

### 15.4 Owner 真实短复测

固定使用：

~~~text
http://127.0.0.1:4175/
~~~

不要占用 4173。

Owner 只需验证：

1. 打开新 comparison review root；
2. 默认任务标题为中文；
3. 可见“方案字母是本次审阅编号”的说明；
4. A/D 相同结果保留两来源；
5. C 冲突没有消失；
6. 不展开技术详情时，能直接看出 `Alpha route A.` 与 `Alpha route C.` 的内容差异；
7. 展开技术详情后 candidateId/unitId/fingerprint/source capsule 仍在；
8. 根据内容选择预期 A 结果（选择 A 或与 A 等价的 D 均可，但必须理解为什么等价）；
9. 保存决定成功；
10. 关闭并重新打开，决定可读且控件只读；
11. comparison 阶段 project 和原始 Starter 未变化。

如果任何一点异常，Owner 只报告第一个异常。全部通过时原样回复：

~~~text
Owner 审阅可理解性复测通过：中文任务、审阅编号说明、A/C 内容差异、A/D 来源保留、技术详情与决定重开均正常。
~~~

通过后仍不得自动运行外部 Agent 第二阶段。

---

## 十六、Task 10 — 文档闭合与独立复审

只有 Focused FORMAL 与 Owner 短复测都通过后：

- [ ] 创建交付报告；
- [ ] 区分 `AUTOMATED_FACTS`、`EXTERNAL_AGENT_REPORTED_FACTS`、`OWNER_REPORTED_VISUAL_FACTS`、`UNVERIFIED_ITEMS`；
- [ ] 报告历史 `jMSfT5` review/receipt 只读保留，没有被当作新验收；
- [ ] 报告新的 acceptance root / review / decision identities；
- [ ] 报告 `verify:all=NOT_RUN` 与既有 parallel capacity risk 仍开放；
- [ ] 报告 4175 人工端口约定，4173 未被占用；
- [ ] 把本轮闭合事实精炼追加到既有 Wave 6 Execution Ledger；
- [ ] 回读三份治理文档的 bytes/SHA-256；
- [ ] `git diff --check` / cached check；
- [ ] 精确创建 docs-only 提交：

~~~text
docs(editor): report owner review comprehensibility repair
~~~

docs-only 提交范围只允许：

1. 既有 Wave 6 taskbook Ledger；
2. 本任务书；
3. 本轮交付报告。

随后停止在独立经理复审：

~~~text
W6_OWNER_REVIEW_COMPREHENSIBILITY_RESTORED
OWNER_COMPARISON_HUMAN_READABILITY_PASSED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
EXTERNAL_AGENT_SECOND_STAGE_NOT_AUTHORIZED
APPLY_NOT_AUTHORIZED
PUSH_NOT_PERFORMED
WAVE_7_NOT_STARTED
~~~

独立复审通过后，才由项目所有者决定是否恢复 Wave 6 Task 11.4。push 仍需项目所有者另行明确批准。

---

## 十七、提交与 Git 纪律

预期最多两笔本地提交：

1. `fix(editor): make owner review choices understandable`
2. `docs(editor): report owner review comprehensibility repair`

每次提交前必须：

- `git status --short`
- `git diff --name-only`
- `git diff --cached --name-only`
- `git diff --check`
- `git diff --cached --check`

禁止：

- `git add .`
- `git add -A`
- `git commit -am`
- amend / rebase / reset / clean / force push
- 暂存 966 个既有 untracked 路径中的任何一项
- 暂存受保护文件、历史 artifact、截图、临时日志

未获得项目所有者明确 push 授权时：

~~~text
PUSH = NOT_PERFORMED
PUSH_AUTHORIZED = NO
~~~

---

## 十八、最终验收矩阵

| 合同 | 自动证据 | 真实 Owner 证据 | 通过条件 |
|---|---|---|---|
| 中文默认目标 | Authoring + Editor test + focused FORMAL | 新 review 截图/反馈 | 无英文 fallback |
| 编号不误导 | Editor test + DOM evidence | Owner 看见说明 | 明确“本次审阅编号” |
| A/C 可区分 | typed projection test + DOM evidence | Owner 无需技术详情即可分辨 | 两条真实台词分别可见 |
| A/D provenance | projection + runner | Owner 展开相同组 | 两来源均保留 |
| 技术详情分层 | Editor test + DOM evidence | Owner 展开详情 | 默认隐藏、展开完整 |
| receipt 精确绑定 | Authoring/Editor tests + runner | 保存并重开 | exact chosenUnitId、只读 |
| 旧包兼容 | legacy fixture tests | 不重写历史包 | 旧 receipt 可读、摘要不足可见 |
| 安全边界 | runner + disk identity | Owner 未执行 apply | project/Starter unchanged |
| 端口隔离 | 只读 listener/HTTP 检查 | 4175 可用 | Surdet 不占 4173 |

---

## 十九、交付报告固定格式

执行 AI 最终只报告：

1. 做了什么；
2. 明确没有做什么；
3. 生产与测试文件范围；
4. RED/GREEN 与受影响工作区门禁；
5. preflight / DIAGNOSTIC / Focused FORMAL 预算与 artifact 身份；
6. 新 acceptance root、external Agent、Owner 原始反馈；
7. 历史 receipt 与原始 Starter 未变化；
8. Git HEAD/parent/remote/ahead-behind/worktree/staging；
9. 未解决项：parallel capacity risk、Wave 6 第二阶段未开始；
10. 唯一下一步停止点。

不得写“页面更舒服”“普通人一定能懂”等未经 Owner 报告的判断。

---

## 二十、任务书生成时基线

以下是任务书生成时的只读事实，不替代执行 AI 的 Task 0 现场核验：

~~~text
branch = main
HEAD = e6ae69cbadbbae2ac941899a091e9de6bb9e8eda
HEAD_PARENT = 5f796620736a4264f1d65e5baec56f55f76685f8
surdet/main = f8943c293c4537b3867cc8eeea316b19bb4a0b40
ahead/behind = 12/0
tracked worktree before this taskbook = only the existing Wave 6 Execution Ledger
staging = empty
historical decision receipt = immutable and preserved
manual Editor port = 4175
shared port 4173 = must remain free of Surdet
composition.plan = NOT_AUTHORIZED
composition.execute = NOT_AUTHORIZED
isolated apply = NOT_AUTHORIZED
push = NOT_AUTHORIZED
Wave 7 = NOT_STARTED
~~~

任务书创建后，预期治理差异为：既有 Wave 6 Ledger + 本任务书；其他现场必须保持原样。
