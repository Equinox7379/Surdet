# Surdet 审阅校对工作台 Frontend Pass 6 设计规格

> 日期：2026-09-02
> 阶段：Post-Wave-6 / Pre-Wave-7 前端重构内部批次 Frontend Pass 6
> 前置：统一壳层 `1990483`、预览舞台与因果记录区 `1e0f551` 已推送并通过 CI
> 边界：只重构 Editor 审阅工作区；不改变 Review Projection、回执、Authority、Agent Port 或 apply 语义

## 1. 结论

本轮采用“任务优先的校对工作台”，而不是只给旧页面换颜色。

桌面仍保留左中右三列，但职责重新固定：左侧只说明任务和待办，中间完成比较、预览与决定，右侧只做对象与因果下钻。比较阶段把“需要你决定”放在安全结果之前；结果阶段把“结果是否可批准、预览和批准/退回”放在计划 ID、指纹和原始 diff 之前。所有终态按钮继续处于普通文档流，不悬浮、不粘滞。

Editor 继续只消费现有 `ReviewWorkspaceState` 与 `HumanReviewProjection`。本轮不增加审阅状态机、不复制 comparison/plan 算法、不直接写回回执文件，也不创建第二套 Preview。

## 2. 方案比较与裁决

### 方案 A：只覆盖旧 CSS

改动最小，但无法解决结果页先展示指纹、长 diff 和证据 ID，主操作被推到页面后部的问题。否决。

### 方案 B：局部重排 DOM，并迁出 Review 专属样式

保留所有稳定 action、receipt、choice 与 Preview 节点，只调整人类阅读顺序、分区语义和视觉层级。Review 由独立样式文件负责，旧规则从 `styles.css` 移除。采用。

### 方案 C：多步向导

可以进一步降低首次使用难度，但会引入新的步骤状态、前进/后退规则和回执恢复边界，不适合本轮视觉重构。留作真实用户反馈证明需要后再评估。

## 3. 当前真实问题

- Review 仍使用旧变量、彩色左竖线、胶囊徽章、嵌套卡片与小号技术字体，和统一壳层不一致；
- comparison 先展示安全结果，真正需要处理的冲突被推到后面；
- result 首屏平铺 planId、fingerprint、workingRevision、tree identity、unitId、原始 diff 和 evidence ID，人的核心任务不突出；
- “检查探索修改”脱离结果操作组，预览、批准、退回、重载与检查缺少统一职责区；
- 两个侧栏缺少清楚的区域语义；
- 窄屏只是把三列依次堆叠，没有给任务、正文和因果下钻建立明确优先级；
- 现有行为测试很强，但缺少针对 Review 专属视觉禁用项和任务顺序的合同。

## 4. 不变量

### 4.1 单一业务真相

- `HumanReviewProjection`、`ReviewWorkspaceState`、决定草稿、回执状态和 Authority 继续是唯一事实；
- Editor 不重算 safe group、conflict、dependency、freshness、plan 或 receipt；
- 选择仍调用现有 `setResolution()`，终态仍调用现有 `writeDecisionReceipt()`、`writeApprovalReceipt()`、`writeReturnReceipt()`；
- File System Access 入口、Review terminal client 和打开工作区流程不变。

### 4.2 稳定交互身份

以下节点和行为必须保留：

- `[data-action="open-review"]`、`[data-editor-mode="review"]`、`#review-view`；
- `[data-choice-unit]`、`[data-choice-exclude]`、`[data-choice-regenerate]`；
- `[data-action="save-decision"]`、`approve-result`、`return-result`、`preview-result`、`reload-official-result`、`refresh-result-tree`；
- `[data-decision-receipt]`、`[data-result-receipt]` 与全部已有回执身份属性；
- `data-action-scope="workspace"`、`aria-pressed`、pending 互斥、authority/fixture/freshness 门；
- `#review-preview-host` 内只挂载一个 `renderPreviewPanel(host, { embedded: true })`。

### 4.3 视觉禁用项

Review 专属样式不得包含彩色单侧线、`999px` 胶囊、渐变、玻璃、卡片墙、浮空或 sticky 主操作。语义状态通过文字、完整表面与克制色彩表达。

## 5. 信息架构

### 5.1 跨列任务标题

三列上方增加同一工作区标题区：

- 任务名称；
- 当前阶段中文状态；
- 比较阶段显示“候选 N 个 · 待决定 N 项 · 自动纳入 N 组”；
- 结果阶段显示“结果已准备/已批准/已退回 · 证据是否齐备”；
- 不在这里显示 fingerprint、revision、tree identity。

### 5.2 左栏：审阅目录

比较阶段：

- 当前待办摘要；
- 验收标准；
- 候选方案简表；
- 方案字母仅为本次排序的说明。

结果阶段：

- 当前结论状态；
- “预览结果、核对变更、作出决定”三步提示；
- 技术身份不在默认左栏平铺。

### 5.3 中栏：人的主要任务

Comparison 顺序固定为：

1. 任务摘要与 Authority/已保存回执；
2. `需要你决定`；
3. 普通文档流中的 `保存我的决定`；
4. `将自动纳入`，每个安全组可用“保留本组 / 排除本组”修改现有 `selectedUnitIds`；
5. `系统自动补全`；
6. 总技术详情。

冲突选项继续使用真实 button 与 `aria-pressed`，但在点击后必须立即更新同组所有选项的选中状态和“已选择”文案，不等待保存或整页重开。安全组开关和冲突选择都只改现有 `decisionDraft`，不修改 `projection`，不新增领域判断。

Result 顺序固定为：

1. 是否可批准与阻断原因；
2. 实际结果 Preview；
3. `批准这个计划 / 退回修改 / 重新加载正式结果 / 检查探索修改` 统一操作区；
4. 变更摘要；
5. 证据摘要；
6. 执行计划、文件差异、指纹和证据 ID 的折叠详情。

### 5.4 右栏：对象与因果

继续复用 `renderReviewCausalPanel()`。右栏增加 `aria-label`，对象使用连续列表和完整选中表面；当前对象 ref 仍保留，但作为次级技术信息。右栏不得挤压中栏预览。

## 6. 人类可读投影

默认界面显示：

- `还需决定 1 项`、`所有冲突已处理`、`决定已保存`；
- `保留本组`、`排除本组` 与即时可见的 `已选择`；
- `结果可以批准`、`结果暂不能批准`、`证据齐备`、`证据需要更新`；
- `采用 N 项内容，其中 N 项由系统自动补全，排除 N 项`；
- `多个方案得到同一结果，保留 N 个来源`；
- `预览正式结果`、`批准这个计划`、`退回修改`。

以下内容默认折叠：reviewId、decisionId、planId、unitId、candidateId、fingerprint、tree identity、evidence ID、JSON 与 unified diff。折叠只改变呈现，不删除原始事实和测试可读性。

## 7. DOM 与样式职责

- 新建 `src/styles/review-workspace.css`，只使用现有 `--surdet-*` token；
- `index.html` 在 Preview 样式之后加载 Review 样式；
- `#review-view` 增加稳定 `data-editor-panel="review"`；
- `.review-workbench` 使用跨列 header + 三栏 grid；
- `.review-section` 用留白和水平分隔组织，不给每条信息套卡片；
- 冲突选项可以保留明确边框，因为它们是需要点击的比较控件，不作为装饰卡片墙；
- `styles.css` 删除 Review 专属旧规则，避免双重权威；共享 causal 基础样式不在本轮全局重写，Review 范围用专属样式收口。

## 8. 响应式与可达性

- 1280px 以下改为两栏：任务栏 + 主内容，因果栏落在主内容下方；
- 900px 以下改为单列，顺序为标题、任务、主内容、对象与因果；
- 480px 以下操作按钮按内容换行并保持至少现有控制高度；
- 三个滚动区在桌面独立；窄屏由页面主内容滚动，不制造嵌套的短小滚动窗；
- 左右栏补充 `aria-label`，主内容补充 region 名称；
- 选项继续使用真实 button、`aria-pressed` 和完整焦点轮廓；
- 收起技术详情不影响键盘到达主操作。

## 9. 错误与终态

- Authority unavailable/mismatch/corrupt 时内容继续可读，全部写操作仍禁用；
- pending、uncertain response、fixture changed、evidence stale 与 approval/return 互斥行为不变；
- 安全组排除后若移除了冲突已选单元，现有 `canSealDecision()` 必须继续阻止保存；重新保留或选择有效单元后才恢复；
- 已保存决定重开后恢复原选择并锁定全部决定控件；
- 已批准或已退回重开后显示中文终态，禁止再次写终态，但查看、预览或重载能力按现有合同保持；
- 原始错误和身份只进入技术详情或现有状态条，不在默认正文泄露英文传输错误。

## 10. 验证策略

先建立一组最小 RED：专属 CSS 加载、三段任务顺序、结果操作先于长技术详情、技术字段折叠、无彩色左线/胶囊/浮空、响应式、稳定选择器、安全组排除/恢复和冲突选择即时反馈。随后保持现有 Review panel/workspace/preview 测试全绿。

最终只运行一次 Review 聚焦测试、一次 Editor 全量、一次 typecheck 和一次 D 盘 build。实际浏览器检查 1440×900、1280×800 与 390×844 的主任务可达性、无横向溢出和 Preview 高度；若本地无法无损打开真实 Review workspace，则使用现有 Review 行为测试与 Wave 6 runner 合同覆盖回执/Preview 边界，并如实记录视觉检查范围，不建立新测试平台。

## 11. 工程化取舍

专属 `review-workspace.css` 值得做，因为当前真实问题正是旧全局样式与新视觉 token 双重权威；迁出后一个文件拥有 Review 的全部布局，能直接降低回归成本。除此之外不新建通用 Dock、步骤状态机、组件库、浏览器夹具平台、证据包或恢复体系。

## 12. 完成条件

- 人的待办与最终操作先于技术信息；
- comparison/result 两种工作流全部稳定选择器、写入门和回执行为保持；
- 安全组可排除/恢复，冲突选择即时反馈且不改写共享 projection；
- Review 不再包含彩色单侧线、胶囊徽章、旧卡片墙或浮空动作；
- 默认界面中文优先，技术身份完整但折叠；
- Review 内嵌 Preview 继续单实例并保持可用高度；
- 桌面与窄屏无横向溢出；
- 最小充分验证、Luna 复核、普通提交、push 与 CI 完成；
- Frontend Pass 7 与主线 Wave 7 均未启动。
