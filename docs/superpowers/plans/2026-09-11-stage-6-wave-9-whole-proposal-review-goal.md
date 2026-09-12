> 本任务采用 Goal 模式。你得到的是完成整个目标的持续授权，不是只做第一步的微型任务。普通编译错误、测试失败、CI 红灯、选择器失效、夹具问题、实现遗漏和其他可逆问题，都由你在本任务范围内自行诊断、修复、验证和收口，不得因为普通红灯暂停并要求 Owner 转述下一条指令。你应持续工作直到目标真正完成，并在本地验证通过后按本任务授权完成正常提交和普通推送。只有原始数据可能受损、密钥或隐私可能泄露、无关程序可能被伤害、必须执行不可逆操作、远端发生无法安全处理的冲突，或者必要权限客观缺失时，才允许停止并联系 Owner。除这些情况外，不得把 Owner 变成传话筒，不得要求 Owner 在施工期间手工操作、整理证据、盯 CI 或逐步授权。

# Stage 6 Wave 9 正式施工任务书

## 整案优先审阅、保存前真实预览与实际结果一致性

**Task ID：** `SURDET-STAGE6-WAVE9-WHOLE-PROPOSAL-REVIEW`
**状态：** 已获 Owner 派发；当前进度见文末 Execution Ledger
**活动仓库：** `Equinox7379/Surdet`
**活动分支：** `main`
**编写基线：** `69edb50db0bdcc9f997bd82cdd18de60dc98fd07`
**Wave 8 代码闭合基线：** `1a702e8b2542a18cd26718d22e1c33157a8e6ef1`
**前置设计：** Wave 9 R1 云端审计设计
**补充契约：** Wave 9 R2 实现契约
**生产状态：** 本任务书生成不等于开工
**生效方式：** Owner 明确把本任务书交给施工主代理并要求执行后，才获得本 Goal 内的代码修改、正常提交和普通 fast-forward push 授权

---

## 一、目标

把现有候选审阅从“先拆成多个技术冲突逐项选择”改为真正面向创作者的闭环：

```text
用户先阅读完整方案 A 与 B
→ 优先采用整份 A 或整份 B
→ 系统展开低层选择并运行现有组合检查
→ 保存前展示重新计算后的真实组合后果
→ 用户保存决定
→ 正式计划和隔离重放
→ 最终页面依据实际组合结果重新说明
→ 用户核对实际结果后批准或退回
```

Wave 9 必须同时解决：

1. 整案采用保留所选候选全部有效改动；
2. 不执行未选候选的独有内容；
3. 原始创作要求、候选自述、验证事实分层；
4. 保存前权威预览，改选后重新计算；
5. 无循环的预览与正式计划身份；
6. 最终说明只对应实际 integration result；
7. 旧 v1 review 和回执继续可读；
8. 使用真实样本先打通纵向链，最终使用全新候选完成无外部讲解验收。

---

## 二、当前事实与起点

### 2.1 远端事实

任务书编写时：

```text
remote main = 69edb50db0bdcc9f997bd82cdd18de60dc98fd07
```

该提交只把长期台账纳入 Git 并登记 Wave 8 收口。生产代码与测试基线仍为：

```text
1a702e8b2542a18cd26718d22e1c33157a8e6ef1
```

对应 exact-head CI：

```text
34586305112
Linux verify = success
Windows electron = success
```

最新纯文档提交的 CI 在云端准备本包时仍显示运行中。施工开工必须重新读取实际 main 和 CI，不得照抄这个动态状态。

### 2.2 已确认缺口

Q1 的 Owner comparison Review 是在主代理解释、推荐并按 Owner 决定预填五处后完成。它证明现有终态保存链可工作，但不证明陌生候选在无讲解时可独立理解。

### 2.3 不重开的稳定边界

以下合同继续保留：

```text
Wave 8 candidate operation-time facts
candidate dependency guard
composition manifest
comparison identity
依赖闭包与环拒绝
integration replay
review terminal create-only 原子终态
final approval 的 plan/change/revision/evidence/tree 绑定
Frontend Pass 1 至 10 的既有视觉系统
```

除非 Wave 9 的真实红灯证明现有实现不能满足本 Goal，不得顺手重写这些模块。

---

## 三、云端已经完成的工作

施工主代理无需从零研究以下内容。

### 3.1 产品与信息架构

云端已完成：

- 整案优先的人类决策流程；
- 原始要求、候选自述、验证事实三源模型；
- Comparison 与 Result 页面骨架；
- 桌面双列和窄屏切换方案；
- custom mix 的渐进展开方式；
- expected result 与 actual result 的分层；
- fresh unseen Owner 验收方案。

### 3.2 核心领域合同

云端已锁定：

- `ReviewDecisionIntent`；
- 整案候选全 unit 推导；
- 整案计划完整性后置验证；
- `planContentFingerprint`；
- `previewFingerprint`；
- v2 comparison decision receipt；
- 保存时重新计算；
- 正式 plan 内容再次核对；
- 只读 `CompositionService.preparePlan()`；
- 正式 `plan()` 继续作为唯一 plan artifact 写入入口。

### 3.3 可直接采用的关键代码

施工包内已经提供：

```text
cloud-code/packages/authoring/src/review-decision-preview.ts
cloud-code/packages/authoring/src/review-decision-receipt-v2.ts
cloud-code/packages/cli/src/authoring/review-decision-preview-service.ts

cloud-code/packages/authoring/test/review-decision-preview.test.ts
cloud-code/packages/authoring/test/review-decision-receipt-v2.test.ts
cloud-code/packages/cli/test/composition-service-preview.test.ts
```

以及：

```text
patches/0001-integration-plan-content-fingerprint.patch
patches/0002-composition-service-readonly-prepare.patch
patches/0003-wave9-foundation-new-files.patch
patches/0004-authoring-export.patch
```

### 3.4 云端验证边界

上述代码已在合成严格 TypeScript 环境通过编译，并完成整案 A、外部候选排除、三层指纹和 v2 receipt 的运行 smoke。四份 patch 已通过 `git apply --stat` 语法检查。

这不是当前 Surdet 工作区的真实测试结果。施工主代理必须在真实仓库中接入、适配、运行测试和浏览器路径。

---

## 四、本地剩余工作的客观原因

以下工作依赖 `E:\surdet` 的真实工作树、现有未跟踪资料、Node 24 workspace、Windows Chromium/Electron、真实本机 authority、Git 凭据和远端写权限，云端无法直接完成：

- 将云端模块落盘到当前真实 HEAD；
- 解决真实 TypeScript 调用方和 parser 联动；
- 修改 Review Authority 和 Vite bound launcher；
- 修改 Editor DOM、CSS、焦点和响应式行为；
- 创建真实 v2 review workspace；
- 使用现有 Q1 capsule 跑完整纵向路径；
- 启动全新外部 Agent 生成最终 fresh 候选；
- 让 Owner 在真实页面独立验收；
- 创建 commit；
- 执行获准的普通 fast-forward push；
- 等待并核对 exact-head CI。

施工主代理仍须基于真实源码独立判断。云端代码是经过设计的主要实现起点，不是要求机械复制错误上下文；若当前 HEAD 或真实调用方需要局部调整，应在不改变本任务核心合同的前提下直接修正并验证。

---

## 五、功能范围

### 5.1 必须完成

```text
Review projection v2
Creative brief 独立来源
Candidate claim 独立来源
Verified content/runtime facts
整案 A/B adoption preset
自定义混合渐进展开
只读决定 preview authority
planContentFingerprint
previewFingerprint
comparison decision receipt v2
保存时重新计算
正式 plan 内容再核对
实际 result explanation
Editor 整案优先页面
v1 read-only compatibility
Q1 真实样本纵向链
fresh unseen Owner 独立验收
```

### 5.2 明确不做

```text
不改 Wave 8 candidate 核心语义
不自动重排 candidate operations
不放宽依赖环或 forward reference
不新增 Agent Port capability 或 MCP 工具
不让 Agent 写人类决定或批准回执
不内置模型、聊天 UI 或 prompt 编排器
不做自动审美评分或剧情风格推断
不做音频、配音、素材生成
不重做全 Editor 壳层
不改 Core、Renderer、Host、Shell 的业务语义
不做 pack、release、deployment
不做插件市场、云同步、多人协作
不做性能资格化
不做大规模文档治理
```

---

## 六、强制实现契约

## 6.1 整案采用必须是所选候选的全部 unit

采用候选 A 时：

```ts
selectedUnitIds = all units where candidateId === A
```

不允许从冲突卡片反推范围，也不允许沿用 v1 `defaultSelectedUnitIds` 的跨候选预填。

系统必须遍历所有 `selection-required` conflict：

```text
恰有一个 A unit
→ choose-unit(A unit)

没有 A unit
→ exclude-all

多个 A unit
→ preset blocked
```

多个 A unit 时不能任选其一，因为当前 `choose-unit` 会排除同冲突中的其他非等价单元。

## 6.2 整案后置完整性

计划构造后必须验证：

```text
actual selected == A 的全部 units
A 自身 unit 没有进入 excluded
implicit inclusion 没有其他候选 unit
replay source 没有其他候选 unit
actual provenance source 没有其他候选 unit
每个 A unit 均实际 replay 或被同候选 retained unit 无损去重
```

其他候选的等价来源可以保留在 `deduplicatedUnits.provenanceUnitIds` 中，只作为来源说明。不得成为 retained source 或实际 replay。

`sourceCapsules` 仍可列出所有 comparison 输入，它是审计身份，不等于实际执行来源。

## 6.3 预览不得使用正式计划指纹

正式 `planFingerprint` 继续覆盖 `draft.review`。预览使用独立的：

```text
planContentFingerprint
```

它覆盖稳定组合内容与 dry-run 结果，排除：

```text
review binding
planId
planFingerprint
decidedAt
reason
错误自然语言 message
```

`previewFingerprint` 覆盖：

```text
reviewId
reviewFingerprint
comparisonFingerprint
decisionIntent
planContentFingerprint
```

v2 decision receipt 同时保存：

```text
planContentFingerprint
previewFingerprint
```

保存时重新计算两者。

正式 `composition.plan` 在 human-reviewed draft 和 dry-run 产生后，再计算 `planContentFingerprint` 并与 receipt 相等，之后才 seal 正式 `planFingerprint` 和写 artifact。

## 6.4 只读 preview 使用正确调用层

新增：

```text
CompositionService.preparePlan()
```

只做：

```text
compare
buildIntegrationPlan
in-memory dryRun
```

绝不做：

```text
seal formal plan
writePlan
create change
write receipt
write project
```

正式 `CompositionService.plan()` 复用 `preparePlan()` 后再 seal + write。

Preview authority 不得调用 `plan()` 后删除文件，也不得在 Editor 或 HTTP handler 复制计划器。

## 6.5 三类信息不能串位

### 原始创作要求

来源：

```text
review.prepare-comparison 的 creativeBrief 输入
```

未提供时明确显示缺失，不从 candidate intent 兜底。

### 候选自述

来源：

```text
sealed capsule 的 change intent / acceptance criteria
```

页面标注“候选自述”，不能称为系统验证。

### 验证事实

来源：

```text
sealed manifest
对象变更事实
validation / simulation
精确绑定的 sealed runtime trace
```

不能仅凭对象差异编造“更温暖”“更克制”“节奏更高级”等气质判断。

## 6.6 改选必须使旧预览失效

任何高层意图或混合低层草稿变化：

```text
清空旧 preview
禁用保存
开始新 generation
```

晚到的旧 generation 响应不得覆盖当前选择。

## 6.7 最终说明只从实际结果生成

Result 页面默认说明必须来自：

```text
sealed IntegrationPlan
READY integration change
fresh diff
fresh validation
fresh simulation
fresh runtime traces
actual result tree
```

不得复制 comparison 阶段的预计文字当作实际事实。

实际说明与 source identity 不一致时，批准禁用并 fail loud。

---

## 七、版本合同

推荐并默认采用：

```text
AUTHORING_CONTRACT_VERSION = 2.4.0

REVIEW_PROJECTION:
  1.0.0 继续读取
  2.0.0 用于 Wave 9 新任务

COMPARISON_DECISION_RECEIPT:
  1.0.0 对应 v1 review
  2.0.0 对应 v2 review

FINAL_APPROVAL_RECEIPT = 1.0.0
RETURN_REQUEST_RECEIPT = 1.0.0
REVIEW_TERMINAL_PROTOCOL = 1.0.0
COMPOSITION_COMPARISON = 1.0.0
INTEGRATION_PLAN = 1.0.0
DELIVERY_CAPSULE = 2.0.0
COMPOSITION_MANIFEST = 1.0.0
CHANGE_RECORD = 2
```

能力数量不得因本轮增加：

```text
native capability count unchanged
stage MCP tool count unchanged
```

`review.prepare-comparison` 是既有能力输入扩展，不新增 Agent 能力。决定 preview 是 Editor 本机 authority 的人类 UI 辅助，不投影给 Agent Port。

若真实严格输出合同要求新的 error code 或字段，更新 2.4.0 schema 和对应测试，不借此增加工具数量。

---

## 八、数据合同

## 8.1 Creative brief

```ts
interface CreativeBriefInput {
  title?: string;
  request: string;
  acceptanceCriteria?: string[];
}

interface ReviewCreativeBrief {
  status: 'provided' | 'not-provided';
  source: 'review-preparation-input';
  title?: string;
  request?: string;
  acceptanceCriteria: string[];
  fingerprint?: string;
}
```

限制：

- `request` 原样保留；
- 长度限制沿现有输入安全策略设置；
- 不自动翻译或改写；
- 不宣称一定由 Owner 本人输入；
- source 只证明它是本次 review preparation 的基准。

## 8.2 Candidate claim

```ts
interface ReviewCandidateClaim {
  source: 'candidate-change-intent';
  statement?: string;
  acceptanceCriteria: string[];
}
```

`NodeCompositionStore.projectPayloadToCandidate()` 显式投影 capsule 字段。不得继续依赖 `review-service.ts` 对 unknown 动态探测后又可能被类型投影丢失。

## 8.3 Candidate verified facts

至少包括：

```text
changed objects
scene facts
choice labels and targets
variable declarations and values
timeline tracks and cues
asset references
bounded content excerpts
runtime path summary
limitations
```

事实生成使用共享 Authoring typed data。CLI 只负责读取精确 sealed capsule 和 trace；Editor 只渲染。

### Runtime binding

只接受：

```text
trace 属于 source change
trace workingRevision == capsule sourceWorkingRevision
trace identity 在 sealed capsule evidence 中被引用
trace payload 可读且身份成立
```

之后新生成的 trace 不能倒灌进旧 capsule review。

## 8.4 Review decision intent

以施工包中的 `ReviewDecisionIntent` 为起点。若命名需要适配现有风格可以调整，语义不得变化。

## 8.5 Comparison decision receipt v2

以施工包中的 `ComparisonDecisionReceiptV2` 为起点，并接入：

- Node store runtime parser；
- Review Terminal parser；
- Authority write validation；
- Editor workspace read/write；
- `review.inspect-decision`；
- `composition.plan` reviewed input。

v2 receipt 不包含正式 `planFingerprint`。

---

## 九、页面信息架构

## 9.1 Comparison 页面顺序

```text
1. 这次原本要创作什么
2. 先看两份完整方案
3. 选择整案或展开混合
4. 核对采用后将得到什么
5. 保存这个决定
6. 技术详情
```

### 第一段

明确分别标注：

```text
原始创作要求
候选自述
系统核对到的事实
```

提供一段简短页面内帮助，用户不需要查看任务书理解来源区别。

### 第二段

桌面宽屏可双列：

```text
方案 A | 方案 B
```

不是两张夸张悬浮卡片。使用连续工作面、普通中分线、现有 token 和清楚的标题层级。

每份方案显示：

```text
候选自述
验证内容事实
实际运行路径
证据警告
采用整个方案按钮
```

### 第三段

整案是主动作：

```text
采用整个方案 A
采用整个方案 B
```

混合是次级动作：

```text
需要混合两个方案
```

未进入混合时不显示五项 conflict 操作。

### 第四段

Preview 状态：

```text
未选择
正在重新计算
可以保存
当前组合被阻止
已过期
本机服务不可用
```

Preview 说明：

```text
直接采用
系统自动带入
不会进入
相同结果的来源保留
预计项目变化
内存试运行结果
```

### 动作位置

保存动作保持在正文流中，不 sticky、不 fixed、不漂浮。

## 9.2 Custom mix

进入后先选择：

```text
以 A 为底稿
以 B 为底稿
从空白开始
```

然后按创作对象分组显示差异，不按 `conflictId` 堆列表。

每次低层调整都重新调用 authority preview。

## 9.3 窄屏

在 `390×844` 等窄视口：

- A/B 使用真实 tabs 或语义等价切换；
- 一次只显示一个候选全文；
- 保留关键差异摘要；
- 对象与因果面板后置折叠；
- 不把桌面双列压成两条窄柱；
- 保存动作仍在正文结尾。

## 9.4 Result 页面

默认顺序：

```text
你最终作出的决定
实际采用的内容
实际自动带入与排除
实际项目变化
预览正式结果
实际运行与验证
批准或退回
技术计划、指纹、JSON、文件差异
```

现有技术内容全部保留，但默认折叠。

---

## 十、本机 authority

### 10.1 Preview route

在现有 Review Authority 下增加只读入口，推荐：

```text
POST /__surdet/review-authority/v1/preview-decision
```

保持：

```text
same-origin
token
Content-Type
body size
request timeout
review payload identity
project identity
```

不新增远程开放服务。

### 10.2 Bound launcher

当前 project launcher 已能取得：

```text
SURDET_EDITOR_PROJECT_ROOT
SURDET_EDITOR_ASSET_IMPORT_DATA_ROOT
```

将 `projectRoot` 和相同 data root 传入 review authority plugin，使 preview 能构造 `CompositionService`。

普通未绑定 Vite：

- 可以读取 review；
- v1 已保存回执继续可读；
- v2 动态 preview 和终态保存不可用；
- 页面明确提示从绑定项目入口重新打开；
- 不回退到浏览器文件写入。

### 10.3 写终态

保存 v2 decision 仍经过 Review Terminal 的 create-only 存储和 review-scoped lease。

不要新建第二个回执服务或直接在浏览器写 `decision.json`。

---

## 十一、实施顺序

必须先纵向跑通，再铺满页面。

## Task 0：读取真实基线并接入云端包

1. 读取：

```text
AGENTS.md
长期台账 9.6 和 9.8
Wave 8 最终交付报告
Wave 9 R1
Wave 9 R2
本任务书
施工包 README
```

2. 核对：

```text
branch
HEAD
remote URL
remote-tracking
tracked diff
staged diff
untracked files
latest main
```

3. 保留 Owner 已有修改和未跟踪资料，不 reset、不 checkout 覆盖。

4. 将云端代码作为主要实现起点：

```text
先运行 git apply --check 四份 patch
再复制新模块与测试
再应用 patch
```

若当前 HEAD 已变化，手工将同一语义适配到真实源码，不机械强行应用旧上下文。

5. 不在 Task 0 运行完整测试。

## Task 1：建立无循环的计划内容身份

落点：

```text
packages/authoring/src/integration-plan.ts
packages/authoring/src/review-decision-preview.ts
packages/authoring/src/review-decision-receipt-v2.ts
packages/authoring/src/index.ts
```

完成：

- `integrationPlanContentProjection()`；
- `integrationPlanContentFingerprintOf()`；
- formal `sealDryRunResult()` 继续包含 review；
- preview 不引用 formal plan fingerprint；
- v2 receipt 验证；
- formal plan content binding check；
- 整案全 unit 推导与完整性验证。

先运行施工包中的聚焦测试。普通类型问题在本 Task 内修复。

## Task 2：拆分只读 `preparePlan()`

落点：

```text
packages/cli/src/authoring/composition-service.ts
packages/cli/test/composition-service-preview.test.ts
```

完成：

```text
preparePlan = compare + build + in-memory dryRun
plan = preparePlan + seal + writePlan
```

验证 `preparePlan()` 零计划落盘，`plan()` 仍唯一写入。

不得通过创建临时正式计划再删除来实现预览。

## Task 3：Review projection v2 与三源事实

落点预计：

```text
packages/authoring/src/review-contracts.ts
packages/authoring/src/review-projection.ts
packages/authoring/src/review-presentation.ts
packages/cli/src/authoring/node-composition-store.ts
packages/cli/src/authoring/review-service.ts
```

完成：

- `creativeBrief` 输入和投影；
- candidate claims 显式投影；
- candidate verified facts；
- runtime trace 精确绑定；
- adoption presets；
- v2 review fingerprint；
- v1 projection 和 fingerprint 永久兼容。

严禁：

```text
第一个 candidate intent 作为原始任务
对象差异生成审美判断
后生成 trace 倒灌旧 capsule
```

## Task 4：v2 receipt 与 authority preview

落点预计：

```text
packages/authoring/src/review-receipts.ts
packages/authoring/src/review-terminal.ts
packages/cli/src/authoring/review-terminal-authority.ts
packages/cli/src/authoring/review-decision-preview-service.ts
packages/cli/src/review-authority/http-handler.ts
packages/cli/src/review-authority/vite-plugin.ts
```

完成：

- v1/v2 receipt union；
- runtime parser；
- preview route；
- 保存时重新 preview；
- stale/blocked/error 投影；
- terminal create-only 不变；
- HTTP 不泄露内部路径和 stack；
- preview 不写 plan/change/project/receipt。

## Task 5：正式 plan 与 result explanation

落点预计：

```text
packages/cli/src/authoring/authoring-service.ts
packages/cli/src/authoring/review-service.ts
packages/authoring/src/review-projection.ts
packages/authoring/src/review-contracts.ts
```

完成：

- `review.inspect-decision` 可返回 v2 high-level intent；
- `composition.plan` 构造 human-reviewed draft 后核对 `planContentFingerprint`；
- 正式 plan fingerprint 继续包含 review binding；
- result review 根据实际 plan/diff/evidence/runtime 生成 actual explanation；
- actual explanation 纳入 result review fingerprint；
- expected/actual 不一致时 approval 禁用或 preparation fail loud。

## Task 6：先跑 Q1 真实纵向路径

使用现有 Q1 真实候选和隔离项目副本，创建新的 v2 workspace。

禁止：

```text
覆盖旧 Q1 review
覆盖旧 decision/approval
修改 Owner 现有成品
```

最小真实链：

```text
prepare v2 comparison
→ 选择整案温暖版或另一候选，仅作为开发动作
→ preview ready
→ 保存 v2 decision
→ inspect decision
→ formal composition.plan
→ execute to READY integration change
→ fresh diff/validate/simulate/runtime
→ prepare result review
→ actual explanation
→ final approval contract remains valid
```

此时 UI 可以仍是最低可用骨架，但必须经过正式 production path，不直接写 fixture JSON，不绕过 authority。

## Task 7：Editor 整案优先工作面

落点预计：

```text
packages/editor/src/review-workspace.ts
packages/editor/src/review-model.ts
packages/editor/src/review-terminal-client.ts
packages/editor/src/review-decision-preview-client.ts
packages/editor/src/panels/review-panel.ts
packages/editor/src/styles/review-workspace.css
packages/editor/vite.config.ts
```

完成：

- v1/v2 workspace union；
- 初始无选择；
- 整案 A/B 主动作；
- custom mix 次级展开；
- preview generation 隔离；
- loading/stale/blocked/unavailable；
- 保存前 current preview gate；
- actual result 默认说明；
- 技术详情折叠；
- 键盘、焦点、ARIA、reduced motion；
- 1792、1280、960、390 主要视口；
- 2 倍页面缩放沿现有方法做一次相关检查。

视觉保持现有 Surdet 设计系统，不引入卡片墙、彩色竖条、胶囊状态墙或浮动主动作。

## Task 8：改选、混合和边界状态

在纵向链稳定后补：

- A preview ready 后改选 B；
- 旧 A 响应晚到不覆盖 B；
- mix base A/B/none；
- 每次混合项变化重新 preview；
- multiple chosen candidate units in one conflict 时 whole preset blocked；
- missing creative brief；
- missing runtime facts；
- authority unavailable；
- project revision stale；
- old v1 read-only；
- corrupt receipt；
- already terminal workspace。

## Task 9：最终 fresh 候选与 Owner 独立验收

### 候选生成

创建两份 Owner 从未见过的 fresh candidates：

```text
同一份自然创作要求
各自独立外部 Agent 会话
两份均 composition-ready
validation fresh
simulation fresh/passed
至少两路 runtime fresh
至少两个有意义的内容差异
不故意制造明显坏方案
```

开发过程不能提前向 Owner展示这两份候选。

### 验收页面

准备新的 v2 comparison review，并从绑定项目入口打开真实 Editor。

### 施工方静默规则

Owner 开始验收后，主代理：

```text
不解释 A/B
不总结差异
不推荐
不预填
不告诉标准答案
不要求 Owner 阅读任务书
```

页面内帮助、来源标签、事实说明和技术详情正常可用。

### Owner 可以自由决定

```text
采用 A
采用 B
自定义混合
```

不以选择某个方案作为通过标准。

### Owner 只需反馈

Owner 完成操作后只需说明：

```text
是否能独立理解
第一个不清楚的位置（若有）
最终结果是否符合预期
```

不要求逐项填写表格、整理日志或证明每一步。

### 主代理自动核对

Owner 保存决定后，主代理核对：

```text
v2 receipt intent
全部 chosen candidate units
无 foreign execution source
previewFingerprint
planContentFingerprint
formal plan fingerprint
actual result explanation
result tree
approval identity
```

## Task 10：最终验证、提交、推送和 CI

### 聚焦验证

至少运行：

```text
Authoring review decision preview/receipt tests
Authoring review projection/receipt compatibility tests
Authoring integration plan regression
CLI composition service preview tests
CLI review service/authority/HTTP tests
Editor review model/workspace/panel tests
Editor review layout contract tests
```

### 类型和构建

```text
@surdet/authoring typecheck + build
@surdet/cli typecheck + build
@surdet/editor typecheck + build
```

按真实根脚本依赖避免重复嵌套构建。

### 真实路径

- 一条 Q1 复用样本的完整正式路径；
- 一条 final fresh Owner review；
- 只在本轮实际涉及 Electron 最终批准或玩家运行时，运行对应最小 Electron 路径；
- 不机械重复无关玩家矩阵。

### 最终整体验证

相关问题收口后运行一次：

```text
npm run verify:all
```

若本轮修改了现有真实浏览器 authority runner，运行一次相应浏览器流程。不要为了“更保险”重复完整套件挑绿。

### 本地复核

按当前 `AGENTS.md`：

- 本地最终审核、质量判断和验收收口由施工主代理亲自完成；
- 不派 Luna 充当审核者或终审者；
- Luna 仅可用于边界清楚且确实节省时间的独立实现任务；
- Luna 不得创建子代理；
- Luna 产出仍由主代理复核。

### Commit

将本 Goal 的相关生产代码、测试和必要文档组成正常提交。允许多个按主题清楚的普通提交，不设单次提交上限，不为证明过程制造空提交或文档循环。

### Push

本任务书被 Owner 明确派发后，授权：

```text
普通 fast-forward push 到 Equinox7379/Surdet main
```

push 前：

- fetch；
- 确认 remote main 是本地 HEAD 的祖先；
- 确认没有无关 tracked 修改；
- 保留未跟踪资料；
- 不 force、不 rebase、不 reset、不 amend、不 squash、不 merge。

远端已变化且不能安全 fast-forward 时是真停止条件。

### CI

普通 push 后等待 exact-head CI。普通 CI 红灯属于本 Goal 内可逆问题，施工主代理自行读取日志、修复、验证、提交并普通推送，直到 exact-head 相关 jobs 成功。

不要求 Owner 盯 CI 或转发日志。

---

## 十二、测试矩阵

## 12.1 整案完整性

必须覆盖：

```text
chosen candidate 有 conflict scene
chosen candidate 有非 conflict timeline
chosen candidate 有非 conflict variable
chosen candidate 有 entry config
other candidate 有完全独有 scene
other candidate 有完全独有 timeline/variable
```

选择 A 后断言：

```text
A 全部 unit selected
A unit 无 excluded
A unit 全部 replay 或 same-candidate dedup
B-only 无 replay
B-only 无 actual provenance
B-only 无 implicit inclusion
```

## 12.2 身份链

必须覆盖：

```text
不同 human decision binding
→ same planContentFingerprint
→ different formal planFingerprint

same preview input
→ same previewFingerprint

intent change
→ previewFingerprint change

dry-run final fingerprint change
→ planContentFingerprint change

reason / decidedAt change
→ planContentFingerprint unchanged

save-time recomputation mismatch
→ REVIEW_DECISION_STALE
```

## 12.3 只读副作用

必须覆盖：

```text
preparePlan writePlan calls = 0
preview route plan artifacts delta = 0
preview route changes delta = 0
preview route project files delta = 0
preview route receipts delta = 0
formal plan writePlan calls = 1
```

## 12.4 来源分层

必须覆盖：

```text
creativeBrief provided
creativeBrief absent
candidate intent differs from brief
candidate intent absent
verified facts exclude candidate mood claim
runtime trace exact identity
later trace not imported
unavailable trace explicitly labeled
```

## 12.5 v1 兼容

必须覆盖：

```text
old v1 review opens
old v1 reviewFingerprint unchanged
old v1 decision receipt validates
old v1 terminal snapshot reads
v1 workspace does not fabricate brief/facts
v1 workspace clearly explains missing whole-proposal preview
```

## 12.6 Editor

必须覆盖：

```text
initial selection none
A/B mutual exclusivity
whole mode hides low-level conflicts
custom mix reveals them
preview loading aria-live
late response ignored
stale preview disables save
saved terminal locks controls
keyboard operation
focus recovery
narrow view
200% page zoom
reduced motion
technical details default collapsed
```

## 12.7 Result

必须覆盖：

```text
actual explanation comes from actual integration
actual explanation binds decision/plan/change/revision/evidence
expected explanation not reused as actual
actual mismatch disables approval
technical plan remains accessible
```

---

## 十三、预计文件

以下仅用于定位，不是僵硬白名单。为同一 Goal 修复相关调用方、测试、夹具、严格 schema、README 或交付文档可直接处理。

### Authoring

```text
packages/authoring/src/capability-contract.ts
packages/authoring/src/capability-registry.ts
packages/authoring/src/index.ts
packages/authoring/src/integration-plan.ts
packages/authoring/src/review-contracts.ts
packages/authoring/src/review-projection.ts
packages/authoring/src/review-presentation.ts
packages/authoring/src/review-receipts.ts
packages/authoring/src/review-terminal.ts
packages/authoring/src/review-decision-preview.ts
packages/authoring/src/review-decision-receipt-v2.ts
packages/authoring/test/**review**
packages/authoring/test/integration-plan.test.ts
```

### CLI

```text
packages/cli/src/authoring/node-composition-store.ts
packages/cli/src/authoring/composition-service.ts
packages/cli/src/authoring/review-service.ts
packages/cli/src/authoring/review-terminal-authority.ts
packages/cli/src/authoring/authoring-service.ts
packages/cli/src/authoring/review-decision-preview-service.ts
packages/cli/src/review-authority/http-handler.ts
packages/cli/src/review-authority/vite-plugin.ts
packages/cli/test/**review**
packages/cli/test/**composition**
packages/cli/e2e/**review**
```

### Editor

```text
packages/editor/src/review-model.ts
packages/editor/src/review-workspace.ts
packages/editor/src/review-terminal-client.ts
packages/editor/src/review-decision-preview-client.ts
packages/editor/src/panels/review-panel.ts
packages/editor/src/styles/review-workspace.css
packages/editor/vite.config.ts
packages/editor/test/**review**
```

### 文档

```text
当轮 Wave 9 任务书 Execution Ledger
Wave 9 交付报告
长期台账的重要状态更新
```

不要求为普通实现生成哈希清单、证据 ZIP、Git Bundle 或第二本长期台账。

---

## 十四、受保护和禁止范围

保持当前 `AGENTS.md` 中的受保护资料。不得擅自修改、暂存、提交、删除或移动：

```text
SESSION-HANDOFF.md
USER.md
docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
其他 Owner 私有未跟踪资料
```

不得：

```text
清理历史 artifacts
重写 Git 历史
修改仓库设置或 Secrets
新建 release
部署正式游戏
修改正式《零点之后》内容
替换音频
运行无关性能资格化
```

---

## 十五、真正停止条件

仅以下情况允许暂停联系 Owner：

- 原始用户项目或正式内容可能被不可逆覆盖；
- 密钥、隐私或账号资料可能泄露；
- 必须删除或大规模移动 Owner 文件；
- 必须新增依赖、改变公共架构边界或明显扩展本 Goal；
- 远端 main 已变化，无法安全 fast-forward，必须 merge/rebase/force；
- 必要 Git、文件系统、Windows 或浏览器权限客观缺失；
- 当前低层 composition 语义无法表达 Owner 已批准的整案合同，且任何修复都会改变 Wave 8 核心语义；
- 最终 fresh 验收暴露需要 Owner 作新的重大产品取舍。

以下不是停止条件：

```text
TypeScript 错误
测试失败
CI 红灯
fixture 过时
选择器失效
端口被当前任务自己的旧进程占用
局部布局问题
旧测试需要同步
云端补丁上下文漂移
同目标内发现遗漏调用方
```

这些由施工主代理在同一 Goal 内修复收口。

---

## 十六、完成标准

全部满足后才能宣布完成：

```text
AUTHORING_CONTRACT_2_4_0 = PASS
REVIEW_PROJECTION_V2 = PASS
CREATIVE_BRIEF_SOURCE_SEPARATED = PASS
CANDIDATE_CLAIM_SOURCE_SEPARATED = PASS
VERIFIED_FACTS_SOURCE_SEPARATED = PASS
INITIAL_SELECTION_NONE = PASS
WHOLE_CANDIDATE_A_ALL_UNITS = PASS
WHOLE_CANDIDATE_B_ALL_UNITS = PASS
FOREIGN_CANDIDATE_EXECUTION = ZERO
CUSTOM_MIX_PROGRESSIVE = PASS
PLAN_CONTENT_FINGERPRINT_NO_CYCLE = PASS
PREVIEW_SAVE_TIME_RECALCULATION = PASS
FORMAL_PLAN_CONTENT_RECHECK = PASS
PREVIEW_PLAN_ARTIFACT_WRITE = ZERO
RESULT_EXPLANATION_FROM_ACTUAL_INTEGRATION = PASS
V1_REVIEW_COMPATIBILITY = PASS
Q1_REAL_VERTICAL_PATH = PASS
FRESH_UNSEEN_OWNER_REVIEW_WITHOUT_EXTERNAL_EXPLANATION = PASS
FOCUSED_TESTS = PASS
TYPECHECKS = PASS
BUILDS = PASS
RISK_MATCHED_REAL_BROWSER = PASS
FINAL_VERIFY_ALL = PASS
LOCAL_MAIN_AGENT_REVIEW = PASS
NORMAL_COMMITS = CREATED
NORMAL_FAST_FORWARD_PUSH = COMPLETED
EXACT_HEAD_CI = SUCCESS
CLOUD_FINAL_REVIEW = PENDING
```

`CLOUD_FINAL_REVIEW = PENDING` 是施工方正确停止状态。施工方不能代填云端终审。

---

## 十七、最终交付

施工完成后只需给 Owner 一段简短说明：

- 实际完成的功能；
- 最终提交与是否已普通推送；
- exact-head CI 状态；
- fresh Owner 验收是否完成；
- 仍有哪个客观未实测项。

不要要求 Owner 转发长报告给云端。Owner 只需告诉云端“已经完成并推送”，云端将自行读取远端代码、diff、测试和 CI。

交付报告应记录必要事实，但不建设证据工程。失败日志只保留当前问题所需的一份关键输出；最终测试不机械重复。

---

## 十八、任务生效前的停止点

当前仅完成云端关键代码和正式施工包准备：

```text
R1 = APPROVED
R2 = PREPARED
CLOUD_KEY_CODE = PREPARED
FORMAL_GOAL_TASKBOOK = READY_FOR_OWNER_DISPATCH
WAVE_9_PRODUCTION = NOT_STARTED
LOCAL_FILES_MODIFIED = NO
REPOSITORY_COMMIT = NO
REPOSITORY_PUSH = NO
```

Owner 明确派发本任务书后，施工主代理从 Task 0 开始持续执行到完整交付。

## Execution Ledger — 本地持续更新

Owner 于 2026-09-11 明确派发桌面 R2 包并要求“没问题再开工”。主代理核对核心合同、实际调用层及补丁后接受施工；本 Goal 的普通提交、fast-forward push 与 CI 修复授权生效。原始设计与代码输入保存在 `<local-path>`。

开工基线：本机与远端 `main` 均为 `69edb50db0bdcc9f997bd82cdd18de60dc98fd07`；已跟踪工作树与暂存区干净，原有未跟踪资料保留。该文档提交 CI `34591060877` 现场仍为 in_progress（verify:all 与 Electron 已成功，asset import browser 步骤尚在运行），未声称完整通过。

| 工作项 | 依赖 / 责任 | 状态与验证 |
| --- | --- | --- |
| Task 0 | 主代理：基线、契约、补丁检查 | 完成；四份 patch 的 apply check 通过。README 的“复制新文件再应用第三份 patch”会重复创建文件，实际只应用补丁一次。 |
| Task 1–2 | Task 0；Authoring 内容身份、整案推导、v2 回执、CLI 内存准备 | 已接通；真实双候选测试确认只读预览、全部所选内容、保存时重算、正式计划内容匹配。 |
| Task 3–5 | Task 1–2；三源 v2 投影、Authority、parser、正式计划 / 实际结果 | 完成；三源投影、封存正文与运行引用、v2 receipt、正式执行结果、批准时说明身份校验已通过真实后端测试和相关回归。 |
| Task 6 | Task 3–5；Q1 真实候选、新隔离 review | 后端真实链通过；沿用原 Q1 cold-start 隔离项目，在其数据目录创建新 v2 review / plan / integration。胶囊绑定绝对来源目录，迁移副本被身份检查拒绝，未改写其身份或旧回执。所选 7 项完整、另案 7 项未纳入、两条实际路线 route 为 1/-1，项目基线未改变。详情在 `<local-path>`。 |
| Task 7–8 | Task 6；Editor 与选择、混合、过期、旧 v1 边界 | 已实现；77 项 Editor 定向测试和 7 项现有布局/authority 检查通过。实际浏览器验证整案、混合、冲突、键盘保存与重开、四种窗口宽度、真实 200% 页面缩放和减少动态效果。最终结果按实际来源说明，并从项目入口试玩。修复了连续配置重载丢失项目绑定，启动器 7 项检查通过。 |
| Task 9 | Task 7–8；全新候选与 Owner 验收 | 两个独立、仅开放 Surdet MCP 的外部创作会话交付 fresh capsule。Owner 在无外部方案讲解的页面中阅读后反馈“A 更自然，B 很别扭，剩下交给你判断”，据此采用 A，并由主代理代保存、核对及批准。正式结果包含 A 的全部 6 项、未纳入 B 的 6 项，两条结局路线分别为 1/-1；正文与来源一致，原项目未变，批准身份有效。此记录不等同于 Owner 本人完成无辅助点击与最终试玩验收。 |
| Task 10 | 实现与实际路径；主代理复核、全量验证、commit / push / CI | 原施工及三笔 CI 修正已普通推送，`fd1fc6e` 的完整 CI 已成功。2026-09-12 收到 Cloud Source Review 1 定向修复包；新增修复及本轮验证见下方记录，Wave 9 尚未正式关闭。 |

当前没有新增依赖、正式内容改动、部署或发行。Owner 的方案选择与后续代理操作已分开记录；本轮结果批准来自 Owner 最新明确委托，不能冒充 Owner 亲自操作。审核由主代理亲自承担。

2026-09-12 开发样本补充：从浏览器实际保存的 v2 决定完成新正式链，结果位于 `<local-path>`，两条路线成立，原项目未变。此前早期开发版 v2 因缺少后续补齐的场景操作序号被当前校验明确拒绝，未改写旧包或添加开发格式兼容。PNG 预览问题来自测试文件接口的错误 MIME，已修正该接口并看到真实背景与立绘，未修改 Renderer。以上均不替代 Owner 验收。

最终样本位于 `<local-path>`：`owner-review-ready.json`、`owner-result.json` 和 `owner-approval.json` 对应真实审阅、执行及批准。主代理核对了保存预览、计划内容身份、实际执行来源、结果树和批准身份。三份剧本及项目配置与 A 一致；时间轴 JSON 的格式不同，内容相同。新鲜真实预览显示正常背景、立绘和入口台词。封存正文复用 Core 编译器读取最终文字与选项，修改过程收进展开区，避免旧稿混入主阅读内容。实际启动时的短暂目录绑定探针已正常清理，随后原项目树核对一致。

CI 修正：实现提交 `21a527355e3dc75fd0098c17af233810282b5176` 的 [run 34628303627](https://github.com/Equinox7379/Surdet/actions/runs/34628303627) 中，Electron 在等待剧情输入时超时，错误后的现场状态已为 `awaiting-advance`；同一脚本在本机完整通过。`680eb51178619dc243b2eb5f9288fcca5f3f250e` 仅将该测试脚本的公开状态等待改为 Node 进程轮询，保留原超时、真实输入与精确位置断言，未修改游戏运行代码。更改后本机与新提交的 Windows CI 均完成开局、F5/F9 精确位置回路及结局检查；失败记录保留，未调用 CI rerun。

`680eb51` 的 [run 34629237668](https://github.com/Equinox7379/Surdet/actions/runs/34629237668) 通过全量验证和 Electron，随后资源导入浏览器流程在 24/26 的错误通道检查失败。该运行仅打印失败节点，具体错误留在未上传的临时文件中，无法据此确认根因；本机复验 26/26 通过。`6664923d0cb4a469e89369917ee0e45c1e473cad` 只补充一行失败详情输出，保留所有断言，不将输出改进冒充产品缺陷修复。

`6664923` 的 [run 34630177102](https://github.com/Equinox7379/Surdet/actions/runs/34630177102) 通过 Electron、全量验证、资源导入、Editor 浏览器流程及 Starter 回归，在 Pass 8 等待“跳过本次行动”时超时。独立实际场景复现确认，该提示会被 650 毫秒后的敌方行动替换，晚一秒观察已无法读到。`fd1fc6e92218a6111027c6b63757a01f443fb5a9` 在真实原生点击事件中确认画布提示并立即导航到慢速目标页，保持待执行回调的离开页面检查；另用系统分配的端口避免本机已证实的 5173 保留端口错误。完整 Pass 8 本机回归通过，含真实文件存读档、模式 / 菜单 / 缩放、系统操作、离开页面与长文本滚动。未修改游戏运行代码。

### Cloud Source Review 1 定向修复（2026-09-12）

Owner 派发桌面 `Surdet_Wave9_Cloud_Source_Review1_Targeted_Repair_2026-09-12.zip` 后，主代理沿原 Goal 继续处理来源一致性。现场复核确认 `main` 与 `surdet/main` 均为 `fd1fc6e92218a6111027c6b63757a01f443fb5a9`，其 [run 34633565765](https://github.com/Equinox7379/Surdet/actions/runs/34633565765) 的 Linux verify 与 Windows electron 已全部成功；包内此前尚待 CI 的状态不再适用。

- 真实红灯：在 `change.diff` 后继续修改对白，再补齐 validation / simulation / runtime 并封存 ready capsule；原 v2 页面事实仍包含较早对白。单独 `character.ensure` 改名后，嵌套场景正文被遗漏；先 patch 再改名时只保留一个来源。三条真实 Agent Port → capsule → NodeCompositionStore → ReviewService 路径均复现了缺陷。
- 修复：NodeCompositionStore 保留强类型 objectDiff freshness，仅当 status 为 fresh 且两个工作版本均等于胶囊最终工作版本时传递当前 semantic / file facts。Authoring 再按该身份投影正文，并从实际 `@scene` 与全部 producedObjects 收集稳定、去重的 producerUnitIds。缺正文、过期或无法归属时明确 unavailable，保留候选自述、封存操作和运行事实。v2 shape 与 fingerprint 覆盖状态、限制和来源；v1 序列化与 fingerprint 不受新增字段影响。
- 页面：整案正文按候选场景展示，包含角色改名的场景副产物；当前正文和不可核对状态使用明确的中文来源说明。真实构建页面在 1440 与 390 像素宽度下查看了 fresh / stale 两种真实胶囊，验证了键盘切换、无横向溢出、无页面脚本异常，以及折叠操作记录仍可读取。此处只验证页面阅读，不在静态预览中代签决定。
- 验证：Authoring 59 项、CLI 30 项、Editor 67 项定向检查通过；三个受影响工作区的类型检查与构建通过。最终单次完整 `verify:all` exit 0：全部 2,794 项测试、类型检查、内容验证与构建通过。主代理已复核实际调用方、diff、测试与页面；`W9_R1 = LOCALLY_FIXED`。本修复提交与推送身份由 Git 记录，对应 CI 由该提交的 Actions 记录判定，不把开工基线的成功预签给新提交。
- 边界：未改变 capsule / manifest 格式、composition-ready 条件或 Wave 8 依赖与重放语义；未补写旧胶囊，未重跑 fresh Agent、Owner 验收或本机 Electron。保留此前四笔提交和全部旧候选、回执、失败证据。本轮停止目标为 `WAITING_FOR_CLOUD_SOURCE_REVIEW_2`，`FreshOwnerFinalAcceptance = STILL_PENDING`。
