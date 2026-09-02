# Surdet 审阅校对工作台 Frontend Pass 6 实施任务书

> **For agentic workers:** 主代理按本任务书连续施工并负责架构、集成、Git 与最终判断；Luna 只做边界清楚的只读复核，不得创建子代理。

**Goal:** 把 Editor Review 从技术报告优先的旧三栏页重建为任务优先的中文校对工作台，同时保留全部回执、Authority、Preview 与稳定 action 合同。

**Architecture:** 继续使用现有 `ReviewWorkspaceState`、`HumanReviewProjection` 与回调。`review-panel.ts` 只重排人类阅读顺序并补足安全组/选项即时 UI；新 `review-workspace.css` 独占 Review 布局，旧 Review 规则从 `styles.css` 删除。

**Tech Stack:** TypeScript、命令式 DOM、CSS Grid/Flex、Vite 6、Vitest 3、现有 Review Workspace/Authority/Preview；不新增依赖。

## Global Constraints

- 本任务是 Post-Wave-6 / Pre-Wave-7 的 Frontend Pass 6，不是主线 Wave 7。
- 只修改 Editor Review 前端和直接测试；不得修改 Authoring Review 合同、CLI、Agent Port、项目格式或 apply 语义。
- 回执写入继续只经过现有 review workspace/terminal client；浏览器不得直接写人类终态文件。
- 保留全部既有 `data-action`、choice、receipt、authority、pending、freshness、fixture 与单 Preview 合同。
- 用户可见内容中文优先；ID、fingerprint、tree identity、evidence ID、JSON 和 diff 默认折叠。
- 不使用彩色单侧线、渐变、玻璃、胶囊、卡片墙、浮空或 sticky 主操作。
- 所有可控临时文件、缓存和构建写入 `D:\surdet-tasks\review-proofreading-workbench-pass-6`。
- 最小充分验证；不建立新浏览器平台、证据包或重复完整测试。
- 精确暂存；不得 `git add .` 或 `git add -A`；完成后普通提交、普通 push 并跟进 CI。

## 文件结构

- Create: `packages/editor/src/styles/review-workspace.css` — Review header、三栏、连续分区、选项、结果、技术折叠与响应式。
- Create: `packages/editor/test/review-workbench-layout.test.ts` — 专属样式、任务顺序、技术折叠、禁用视觉与稳定节点合同。
- Modify: `packages/editor/index.html` — 加载 Review 专属样式。
- Modify: `packages/editor/src/main.ts` — 给 `#review-view` 增加 `data-editor-panel="review"`。
- Modify: `packages/editor/src/panels/review-panel.ts` — 任务 header、冲突优先、安全组开关、即时选择反馈、result 人类优先顺序与折叠技术信息。
- Modify: `packages/editor/src/styles.css` — 删除 Review 专属旧样式，保留共享 causal 基础样式。
- Modify: `packages/editor/test/review-panel.test.ts` — 安全组排除/恢复、即时选中、projection 不变、result 顺序和技术折叠。
- Modify: `packages/editor/test/review-operations-layout.test.ts` — 从新样式读取普通文档流合同。
- Modify: `packages/editor/test/preview-stage-layout.test.ts` — Review 布局断言迁移到新样式文件。
- Create: 本设计规格与本任务书。

---

### Task 1: 建立 Review 工作台 RED

**Interfaces:**

- Consumes: 现有 `renderReviewPanel()`、`ReviewWorkspaceState`、全部稳定 data action/receipt 节点。
- Produces: 新 DOM/CSS、顺序、安全组与即时反馈的失败合同。

- [ ] **Step 1: 新增布局合同测试**

新增 `review-workbench-layout.test.ts`，读取 `index.html`、`main.ts`、`review-panel.ts`、`review-workspace.css`、`styles.css`，断言：

```ts
expect(indexHtml).toContain('/src/styles/review-workspace.css');
expect(mainSource).toContain("reviewEl.dataset['editorPanel'] = 'review'");
expect(reviewSource.indexOf("'需要你决定'"))
  .toBeLessThan(reviewSource.indexOf("'将自动纳入'"));
expect(reviewSource.indexOf("'预览正式结果'"))
  .toBeLessThan(reviewSource.indexOf("'查看执行与技术详情'"));
expect(reviewStyles).not.toMatch(/border-(?:left|inline-start)\s*:\s*3px/);
expect(reviewStyles).not.toMatch(/border-radius\s*:\s*999px/);
expect(reviewStyles).not.toMatch(/position\s*:\s*(?:fixed|sticky)/);
expect(reviewStyles).toMatch(/@media\s*\(max-width:\s*1280px\)/);
expect(reviewStyles).toMatch(/@media\s*\(max-width:\s*900px\)/);
expect(reviewStyles).toMatch(/@media\s*\(max-width:\s*480px\)/);
expect(legacyStyles).not.toMatch(/\.review-workbench\s*\{/);
```

- [ ] **Step 2: 扩展行为合同**

在 `review-panel.test.ts` 增加：

```ts
it('excludes and restores a safe group through the existing decision draft', () => {
  const workspace = comparisonWorkspace();
  renderReviewPanel(container, workspace);
  container.querySelector('[data-safe-group-toggle="group-1"]')!.click();
  expect(workspace.decisionDraft.selectedUnitIds).not.toContain('unit-a');
  expect(workspace.decisionDraft.selectedUnitIds).not.toContain('unit-d');
  container.querySelector('[data-safe-group-toggle="group-1"]')!.click();
  expect(workspace.decisionDraft.selectedUnitIds).toEqual(expect.arrayContaining(['unit-a', 'unit-d']));
});
```

并断言选择 `unit-a` 后同组按钮立即更新 `aria-pressed` 与“已选择”，`projection.state`、`projection.conflicts` 和 `projection.safeGroups` 不变。

- [ ] **Step 3: 运行一次 RED**

```powershell
npm exec vitest run -- packages/editor/test/review-workbench-layout.test.ts packages/editor/test/review-panel.test.ts packages/editor/test/review-operations-layout.test.ts packages/editor/test/preview-stage-layout.test.ts
```

Expected: 只因新 Review DOM/CSS、交互与顺序尚未实现而失败；已有回执/Authority 行为不应出现无关失败。

---

### Task 2: 比较阶段任务优先结构与即时决定

**Interfaces:**

- Consumes: `workspace.decisionDraft`、`canSealDecision()`、`setResolution()`、现有 action/choice data attributes。
- Produces: `review-workspace-header`、`review-section`、`data-safe-group-toggle` 与即时选中投影；不产生新持久状态。

- [ ] **Step 1: 增加工作区标题与三栏语义**

在 comparison/result 创建 shell 后先追加跨列 header；两侧栏设置：

```ts
taskList.setAttribute('aria-label', '审阅目录');
main.setAttribute('aria-label', '审阅正文');
objectPanel.setAttribute('aria-label', '对象与因果');
```

comparison header 显示任务标题、中文状态和 `候选 N 个 · 待决定 N 项 · 自动纳入 N 组`，并显示已有 `task.goal`；不存在的更新时间不得伪造。

- [ ] **Step 2: 把冲突移到安全结果之前**

把 comparison 主区分为：

```text
review-overview
review-conflict-section（标题：需要你决定）
review-decision-actions（保存我的决定）
review-safe-section（标题：将自动纳入）
review-dependency-section（标题：系统自动补全）
technical details
```

原 conflict/safe/dependency 对象、IDs、按钮和回调保持。

- [ ] **Step 3: 实现安全组排除与恢复**

每组增加一个真实 button：

```ts
const included = group.unitIds.some((unitId) => workspace.decisionDraft.selectedUnitIds.includes(unitId));
button.setAttribute('data-safe-group-toggle', group.groupId);
button.setAttribute('aria-pressed', String(included));
button.textContent = included ? '排除本组' : '保留本组';
```

点击时只对 `decisionDraft.selectedUnitIds` 做集合增删，清空已封存的本地 decisionId，并重新计算保存按钮禁用状态。若当前冲突选项依赖被排除单元，`canSealDecision()` 继续阻止保存。

- [ ] **Step 4: 即时更新冲突选中态**

选择后同步同一 conflict 的按钮：

```ts
control.setAttribute('aria-pressed', selected ? 'true' : 'false');
control.setAttribute('data-choice-selected', selected ? 'true' : 'false');
control.textContent = `${baseLabel}${selected ? ' · 已选择' : ''}`;
```

不得修改 `projection.state` 来伪造正式退回；`regenerate-candidate` 只更新草稿并保持保存禁用。

- [ ] **Step 5: 运行 comparison GREEN**

```powershell
npm exec vitest run -- packages/editor/test/review-panel.test.ts packages/editor/test/review-model.test.ts packages/editor/test/review-workspace.test.ts
```

Expected: PASS；决定保存、uncertain retry、pending 锁、重开只读和 Authority fail-closed 全部保持。

---

### Task 3: 结果阶段人类摘要、预览与统一操作

**Interfaces:**

- Consumes: 现有 `ReviewFinalResult`、freshness/fixture/terminal locks、Preview/approval/return/reload/refresh 回调。
- Produces: 人类摘要先行的 result DOM；稳定 action 与安全门不变。

- [ ] **Step 1: 首屏只显示可批准结论**

在结果 header/main 最前面显示：

- `结果可以批准` 或 `结果暂不能批准`；
- `证据齐备` 或 `证据需要更新`；
- 新增/修改场景、变量变化和警告数量；
- fixture changed、Authority 与 receipt 中文状态。

planId、workingRevision、tree/fingerprint 不在默认摘要平铺。

- [ ] **Step 2: 把 Preview 与统一操作区提前**

顺序必须是 result overview → `review-preview-shell` → `review-operations`。把 `refresh-result-tree` 移入同一 operations，并把可见文案改为：

- `预览正式结果`；
- `批准这个计划`；
- `退回修改`；
- `重新加载正式结果`；
- `检查探索修改`。

所有 data action 与禁用条件保持原样。

- [ ] **Step 3: 折叠执行计划、证据身份与原始差异**

新增 `details.review-technical-disclosure`，summary 为 `查看执行与技术详情`。默认正文只保留人类变更摘要和 evidence freshness；以下内容移入折叠：

- planId、revision、fingerprints、tree identity；
- selected/included/excluded unit IDs、conflict IDs、dedupe IDs；
- provenance unit IDs、对象指纹；
- evidence IDs；
- semantic JSON、unified diff 与 receipt ID/fingerprint。

原始 DOM 子节点仍保留，现有身份测试可在展开后读取。

- [ ] **Step 4: 运行 result GREEN**

```powershell
npm exec vitest run -- packages/editor/test/review-panel.test.ts packages/editor/test/review-preview.test.ts packages/editor/test/preview-stage-layout.test.ts
```

Expected: PASS；单 embedded Preview、Preview/terminal 互斥、fixture/freshness 门、批准/退回终态和重开回执保持。

---

### Task 4: Review 专属视觉与响应式

**Interfaces:**

- Consumes: 现有 `--surdet-*` token 与 Task 2/3 DOM classes。
- Produces: `review-workspace.css`；`styles.css` 不再拥有 Review 专属规则。

- [ ] **Step 1: 加载并标识专属工作区**

在 `index.html` 加载 `/src/styles/review-workspace.css`；在 `main.ts` 创建 `#review-view` 时设置 `data-editor-panel="review"`。

- [ ] **Step 2: 实现桌面布局**

```css
.review-workbench {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(520px, 1fr) minmax(270px, 340px);
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}
.review-workspace-header { grid-column: 1 / -1; }
.review-task-list,
.review-main,
.review-details { min-height: 0; overflow-y: auto; }
```

分区使用留白、背景层与水平边界；选中态使用完整背景/outline。不得有彩色单侧线、胶囊、渐变或 shadow 卡片墙。

- [ ] **Step 3: 实现两栏与单栏**

- `<=1280px`：两栏，details 落到主内容下方；
- `<=900px`：单列，页面顺序 header → task → main → details；
- `<=480px`：操作按钮宽度按内容折行，选择网格单列，不产生页面横向溢出。

- [ ] **Step 4: 删除旧 Review 规则**

从 `styles.css` 删除 `#review-view` 至 Review media query 的专属区块；保留其他模式和共享 `.causal-*` 规则。更新 `review-operations-layout.test.ts` 与 `preview-stage-layout.test.ts` 从新 CSS 读取。

- [ ] **Step 5: 运行布局 GREEN**

```powershell
npm exec vitest run -- packages/editor/test/review-workbench-layout.test.ts packages/editor/test/review-operations-layout.test.ts packages/editor/test/preview-stage-layout.test.ts
```

Expected: PASS。

---

### Task 5: 最终验证、Luna、提交与远端

- [ ] **Step 1: 运行一次 Review 聚焦**

```powershell
npm exec vitest run -- packages/editor/test/review-workbench-layout.test.ts packages/editor/test/review-panel.test.ts packages/editor/test/review-model.test.ts packages/editor/test/review-workspace.test.ts packages/editor/test/review-preview.test.ts packages/editor/test/review-authority-boundary.test.ts packages/editor/test/review-terminal-client.test.ts packages/editor/test/review-operations-layout.test.ts packages/editor/test/preview-stage-layout.test.ts
```

- [ ] **Step 2: 运行 Editor 全量、typecheck 与 D 盘 build 各一次**

```powershell
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor -- --outDir D:\surdet-tasks\review-proofreading-workbench-pass-6\build
```

- [ ] **Step 3: 实际浏览器检查**

检查 1440×900、1280×800、390×844：人的主任务顺序、Preview 高度、操作可达、技术详情默认折叠、无横向溢出、无彩色左线/胶囊/浮空动作。若无法无损打开真实 Review workspace，明确记录视觉检查只覆盖空态/结构，行为由现有 Review 测试和 Wave 6 runner 合同承担。

- [ ] **Step 4: Luna 只读复核**

分别检查：回执/Authority/Preview 高风险合同；中文与任务层级；桌面/窄屏视觉。主代理只修直接相关 BLOCKER/HIGH 和明确回归。

- [ ] **Step 5: 精确提交、普通 push 与 CI**

仅暂存本规格、任务书与本轮 Editor 文件；运行两类 diff check，提交：

```text
feat(editor): rebuild review proofreading workbench
```

普通 push 当前 `main`，跟进同一提交 CI；普通红灯在本 Goal 内最小修复至绿色。

- [ ] **Step 6: 更新既有长期台账**

在未跟踪 `2026-08-13-project-roadmap-and-decision-ledger.md` 追加实现、验证、commit、CI、已知边界和下一 Frontend Pass；不创建新台账、不提交长期台账、不启动主线 Wave 7。

## 完成条件

- comparison 冲突优先、安全组可排除/恢复、选中即时反馈；
- result 摘要/Preview/操作先于技术详情；
- 全部稳定 action、receipt、Authority、pending、freshness、fixture 与单 Preview 行为保持；
- Review 专属旧卡片墙、彩色左线、胶囊和浮空动作退出；
- 聚焦、Editor 全量、typecheck/build、浏览器和 Luna 复核通过；
- 精确提交已推送且 CI 绿色；
- Frontend Pass 7 与主线 Wave 7 未启动。
