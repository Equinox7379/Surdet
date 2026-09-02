# Surdet 预览舞台与因果记录区 Frontend Pass 5 实施任务书

> **For agentic workers:** 主代理按本任务书连续施工并负责最终判断、Git 与推送；Luna 仅承担边界清楚的只读复审，不得创建子代理。

**Goal:** 把 Editor 预览页重建为“最大剧情舞台 + 可折叠连续因果记录”，同时封住旧 iframe 串线与失败 reload 暴露旧会话的生命周期缺口。

**Architecture:** 保留现有唯一 iframe、`PreviewRuntimeLifecycle`、`RendererRuntime`、轨迹消息和共享因果选择状态。`preview-panel.ts` 只增加当前 iframe 来源门、局部 Dock UI 状态和中文投影；`preview.ts` 只在 load 边界使旧解释器引用失效；新 `preview-workspace.css` 拥有本模式布局，不新增通用 Dock 抽象。

**Tech Stack:** TypeScript、命令式 DOM、CSS Grid、Vite 6、Vitest 3、现有 Editor/Renderer 接口；不新增依赖。

## Global Constraints

- 本任务是 Post-Wave-6 / Pre-Wave-7 的 Frontend Pass 5，不是主线 Wave 7。
- 只修改 Editor 前端和直接相关测试；不得修改业务 schema、项目/存档格式、Agent Port 或后端语义。
- 只使用现有单 iframe、单 runtime、单 trace 状态与原因果回调。
- 用户可见内容中文优先；原始 ID、kind、op 和源码位置仅作次级技术信息。
- 不使用彩色单侧线、渐变、玻璃、胶囊堆叠、卡片墙、悬浮动作或装饰性文案。
- 任务输出、缓存、构建和测试临时文件写入 `D:\surdet-tasks\preview-stage-causal-dock`。
- 最小充分验证：一次 RED、一次聚焦 GREEN、一次 Editor 全量、一次 typecheck/build、一次真实浏览器检查；普通红灯在同一 Goal 内修复。
- 精确暂存；不得 `git add .` 或 `git add -A`；普通提交与普通 push 后跟进 CI。

---

## 文件结构

- Create: `packages/editor/src/styles/preview-workspace.css` — Preview 专属 toolbar/stage/status/dock 布局与响应式。
- Modify: `packages/editor/index.html` — 在模式 CSS 序列中加载 Preview 样式。
- Modify: `packages/editor/src/main.ts` — 给现有 `#preview-view` 增加 `data-editor-panel="preview"`，不改分发。
- Modify: `packages/editor/src/panels/preview-panel.ts` — DOM、中文轨迹投影、Dock、焦点/滚动恢复、当前 iframe 来源门。
- Modify: `packages/editor/src/preview.ts` — load 开始时使上一轮可执行会话引用失效。
- Modify: `packages/editor/src/styles.css` — 删除已经迁出的旧 Preview 规则。
- Modify: `packages/editor/test/preview-stage-layout.test.ts` — 工作区结构、CSS、中文投影和响应式合同。
- Modify: `packages/editor/test/preview-causal-trace.test.ts` — 来源/generation/trace/顺序和中文投影合同。
- Modify: `packages/editor/test/preview-runtime-contract.test.ts` — 单 runtime 与失败 reload 失效合同。
- Read/Run: 其他 Preview 测试 — 保持场景、字体、时间轴、诊断与生命周期回归。

---

### Task 1: 建立工作区与生命周期 RED

**Interfaces:**

- Consumes: 现有 `renderPreviewPanel(container)`、`PreviewTraceMessage`、`state.previewTrace`。
- Produces: 测试要求的稳定 DOM/CSS/source/reload 合同；此任务不修改生产代码。

- [x] **Step 1: 扩展布局合同测试**

在 `preview-stage-layout.test.ts` 中读取 `preview-workspace.css`、`index.html`、`main.ts` 与 `preview-panel.ts`，要求：

```ts
expect(indexHtml).toContain('/src/styles/preview-workspace.css');
expect(mainSource).toContain("pvEl.dataset['editorPanel'] = 'preview'");
expect(panelSource).toContain("dockToggle.setAttribute('aria-controls', traceList.id)");
expect(panelSource).toContain("dockToggle.setAttribute('aria-expanded', String(expanded))");
expect(previewStyles).toMatch(/\.preview-workspace\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto/s);
expect(previewStyles).toMatch(/\.preview-causal-list\s*\{[^}]*overflow-y:\s*auto/s);
expect(previewStyles).not.toMatch(/position:\s*(fixed|sticky)/);
```

- [x] **Step 2: 扩展因果轨迹合同测试**

要求一个纯投影函数和一个纯来源判断函数：

```ts
export function isCurrentPreviewFrameSource(
  source: MessageEventSource | null,
  currentFrame: WindowProxy | null,
): boolean;

export interface PreviewTraceRowProjection {
  title: string;
  sourceLabel: string;
  technicalLabel: string;
}

export function projectPreviewTraceRow(message: PreviewTraceEventMessage): PreviewTraceRowProjection;
```

测试至少覆盖：

```ts
expect(isCurrentPreviewFrameSource(current, current)).toBe(true);
expect(isCurrentPreviewFrameSource(stale, current)).toBe(false);
expect(projectPreviewTraceRow(textEvent)).toMatchObject({
  title: '显示台词',
  sourceLabel: 'intro 场景 · 第 12 行',
});
expect(projectPreviewTraceRow(choiceEvent).title).toBe('提供选择');
```

并静态要求 ready、diagnostic、trace 三条回调都接收 `source` 后再处理。

- [x] **Step 3: 建立失败 reload 合同**

在 `preview-runtime-contract.test.ts` 要求 load 开始、进入可能失败的编译前清空旧会话引用：

```ts
expect(source).toMatch(/interp\s*=\s*null;[\s\S]*store\s*=\s*null;[\s\S]*registry\s*=\s*null;/);
```

同时继续要求 `createRendererRuntime` 只有现有单例生命周期路径，不新增第二 runtime。

- [x] **Step 4: 运行一次 RED**

```powershell
$env:TEMP='D:\surdet-tasks\preview-stage-causal-dock'
$env:TMP=$env:TEMP
npx vitest run packages/editor/test/preview-stage-layout.test.ts packages/editor/test/preview-causal-trace.test.ts packages/editor/test/preview-runtime-contract.test.ts
```

Expected: 新 Preview DOM/CSS、source gate、中文投影和 reload 失效断言失败；既有 Canvas 与单 runtime 断言继续通过。

---

### Task 2: 封住消息串线与失败 reload 旧会话

**Interfaces:**

- Consumes: 模块级唯一 message listener 与当前 frame `contentWindow`。
- Produces: ready/diagnostic/trace 统一 source gate；失败 load 后 debug probe 不再暴露旧 interpreter。

- [x] **Step 1: 实现纯来源判断**

在 `preview-panel.ts` 增加：

```ts
export function isCurrentPreviewFrameSource(
  source: MessageEventSource | null,
  currentFrame: WindowProxy | null,
): boolean {
  return currentFrame !== null && source === currentFrame;
}
```

把 `notifyPreviewReady`、`notifyPreviewDiagnostic`、`notifyPreviewTrace` 全部带上 `e.source`；当前面板回调首先比较 `frame.contentWindow`，不匹配立即返回。

- [x] **Step 2: 使旧 load 会话失效**

在 `preview.ts` 的 `load()` 获取现有 runtime 并开始新 generation 后、任何 await/编译之前，清空：

```ts
interp = null;
store = null;
registry = null;
calendar = null;
growth = null;
achievements = null;
scheduler = null;
affection = null;
turnResumeSnap = null;
```

保留同一个 `RendererRuntime` 并继续调用现有 `resetSession({ clearAssets: true })`；catch 继续使用现有 error/diagnostic/trace 失败通道。

- [x] **Step 3: 防止轨迹重复追加**

父面板对当前 trace 维护 `lastSequence` 与 `traceCompleted`：start 时重置；event 只接受严格递增 sequence；complete 只接受一次。不得改变 iframe 发出的原消息结构。

- [x] **Step 4: 运行聚焦 GREEN 的生命周期子集**

```powershell
npx vitest run packages/editor/test/preview-causal-trace.test.ts packages/editor/test/preview-diagnostics.test.ts packages/editor/test/preview-runtime-contract.test.ts packages/editor/test/preview-runtime-lifecycle.test.ts
```

Expected: PASS。

---

### Task 3: 重建 Preview DOM 与中文因果投影

**Interfaces:**

- Consumes: 现有 `labelSel`、`fastChk`、`playBtn`、`frame`、`diagnostics`、`currentPreviewTrace`。
- Produces: `.preview-workspace`、`.preview-stage`、`.preview-causal-dock`、可折叠列表和 `projectPreviewTraceRow()`。

- [x] **Step 1: 建立四区工作台**

`renderPreviewPanel` 仍只接收一个 container，但其直接子结构调整为：

```html
<div class="preview-workspace">
  <header class="preview-toolbar">…原入口、速度和播放回调…</header>
  <section class="preview-stage" aria-label="剧情舞台">
    <iframe class="preview-frame" title="剧情预览"></iframe>
  </section>
  <div class="preview-diagnostics" aria-live="polite"></div>
  <section class="preview-causal-dock">…</section>
</div>
```

播放入口增加 `<label>` 可见文字“播放入口”；快进文案改为“跳过逐字显示”；按钮改为“重新播放”。回调和传输 payload 不变。

- [x] **Step 2: 实现中文轨迹投影**

`projectPreviewTraceRow()` 根据 `event.kind` 与 `event.source.op` 产生中文标题；来源显示为“{sceneId} 场景 · 第 {line} 行”；技术行保留 `kind / op / sequence`。DOM 采用一个真实 `<button>` 包含主摘要与次级信息，仍以 sequence 作为选中事实。

- [x] **Step 3: 实现局部 Dock 状态**

只在 `renderPreviewPanel` 闭包内维护：

```ts
let dockExpanded = true;
let lastFocusedSequence: number | null = null;
let savedScrollTop = 0;
```

toggle 更新 `hidden`、`aria-expanded` 和“收起记录 / 展开记录”文案。轨迹重绘前记录 active sequence 与 scrollTop；重绘后恢复 scrollTop，并在匹配按钮存在时 `focus({ preventScroll: true })`。

- [x] **Step 4: 保留因果导航**

每行点击仍原样设置：

```ts
state.selectedTraceStep = message.sequence;
state.selectedObjectRef = selectedRef;
dispatchPreviewTraceSelection({ event: message.event, objectRef: selectedRef, sequence: message.sequence });
```

不得新增第二套导航或对象定位函数。

---

### Task 4: 建立 Preview 专属布局样式

**Interfaces:**

- Consumes: 现有 `--surdet-*` token 和新 DOM class。
- Produces: stage 最大化、Dock 有界独立滚动、800/390 宽度可用。

- [x] **Step 1: 创建并加载 `preview-workspace.css`**

在 `index.html` 的模式 CSS 序列中加入 `/src/styles/preview-workspace.css`。文件核心布局固定为：

```css
#preview-view {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.preview-workspace {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.preview-stage {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.preview-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

.preview-causal-list {
  max-height: clamp(148px, 24vh, 240px);
  overflow-y: auto;
}
```

- [x] **Step 2: 使用连续记录而非卡片墙**

轨迹行之间只使用水平分隔线和表面变化；选中态使用完整背景、完整边框/轮廓与 `aria-pressed`，不得有单侧彩条、阴影浮起或胶囊。

- [x] **Step 3: 完成响应式**

在 `800px` 以下让 toolbar 形成可读两行；在 `480px` 以下让入口组、快进和播放按钮按内容换行，所有控件保持至少 38px 高，技术来源允许换行，不制造页面横向滚动。

- [x] **Step 4: 移除旧规则**

从 `styles.css` 删除旧 `#preview-view`、`.preview-toolbar`、`.preview-frame`、`.preview-trace*` 规则，避免双重权威。不得改动相邻 Review 样式。

---

### Task 5: 聚焦回归与完整 Editor 检查

- [x] **Step 1: 运行 Preview 聚焦测试**

```powershell
npx vitest run packages/editor/test/preview-stage-layout.test.ts packages/editor/test/preview-causal-trace.test.ts packages/editor/test/preview-diagnostics.test.ts packages/editor/test/preview-runtime-contract.test.ts packages/editor/test/preview-runtime-lifecycle.test.ts packages/editor/test/preview-scenes.test.ts packages/editor/test/preview-font-transfer.test.ts packages/editor/test/preview-timeline-replay.test.ts
```

Expected: PASS。

- [x] **Step 2: 运行 Editor 全量一次**

```powershell
npm run test -w surdet-editor
```

Expected: PASS；不重复全量。

- [x] **Step 3: 运行 typecheck 与 D 盘构建一次**

```powershell
npm run typecheck -w surdet-editor
npm run build -w surdet-editor -- --outDir D:\surdet-tasks\preview-stage-causal-dock\build
```

Expected: PASS；仓库内不产生新的 dist 产物。

---

### Task 6: 真实浏览器与 Luna 复审

- [x] **Step 1: 启动隔离 Editor**

使用 D 盘 TEMP/cache 和未占用端口，不终止无关服务。打开真实 Preview 工作区并加载可播放场景。

- [x] **Step 2: 检查三个宽度**

- 1440×900：舞台最大、Dock 展开独立滚动、收起后舞台获得空间；
- 1280×800：控制不覆盖、舞台不被 Dock 挤扁；
- 390×844：无页面横向溢出，播放、入口、Dock 与轨迹行均可达。

实际触发重新播放、Dock 收起/展开、至少一个轨迹定位。检查 console/page/request 错误，但不保存截图包或 trace 包。

- [x] **Step 3: Luna 只读复审**

请 Luna 检查：

- 单 iframe/runtime/trace 与现有因果导航是否保持；
- source gate 与失败 reload 是否真正闭合；
- 中宽与窄宽是否有溢出、焦点丢失或舞台塌缩；
- 是否残留英文主文案、卡片墙、彩色单侧线或浮空动作。

主代理只修直接相关 BLOCKER/HIGH 和明确回归。

---

### Task 7: 精确提交、推送、CI 与台账

- [x] **Step 1: 核对范围**

确认 tracked diff 只包含本任务规格、任务书、Editor Preview 生产文件和直接测试；长期台账仍保持未跟踪，不进入提交；受保护文件不动。

- [ ] **Step 2: 精确暂存并提交**

逐路径 `git add -- <path>`，运行两类 `git diff --check`，再提交：

```text
feat(editor): rebuild preview stage and causal dock
```

- [ ] **Step 3: 普通推送并跟进 CI**

普通 push 当前 `main`；读取该提交对应 CI。普通红灯按首个真实失败做最小修复、普通提交与普通 push，直到同一 Goal 绿色。

- [ ] **Step 4: 更新长期台账并继续**

在既有未跟踪长期台账追加一段简短事实：实现范围、关键验证、commit、push/CI、已知边界与下一阶段 `Frontend Pass 6 — Review Proofreading Workbench`。不创建新台账，不启动主线 Wave 7。

## 实施结果（提交前）

- Preview 继续使用唯一 iframe、唯一运行时和唯一轨迹来源；ready、diagnostic、trace 都只接受当前挂载 iframe，卸载后的旧回调不再写入界面。
- 新一轮 reload 开始前即失效旧解释器；构造或启动失败后也不会暴露半完成会话。轨迹只接受当前 generation/traceId，拒绝重复、倒序和 complete 后事件。
- Preview 已重建为“控制栏—剧情舞台—诊断—因果记录”四区：舞台占据剩余主空间，因果记录处于普通文档流、可收起并独立滚动；中文摘要为主，内部 kind/op 仅保留在次级技术信息中。
- Review 结果页继续复用同一 Preview 渲染器，并显式使用嵌入布局；内嵌舞台保留最小高度，因果记录默认收起。
- Preview 聚焦与相邻回归共 50 项通过；Wave 3B runner 合同 11 项通过；Editor 全量 572 项通过；Editor typecheck 与写入 D 盘的 build 通过。
- 实际浏览器检查覆盖 1440×900、1280×800、390×844：无页面横向溢出，桌面舞台始终大于 Dock；390×844 默认收起记录，舞台约 256px，记录列表即使展开也被限制为 96px。
- 三名 Luna 分别复核生命周期、测试/范围和响应式视觉；所报旧 E2E 文案、未知事件中文回退、旧蓝色按钮和窄屏舞台压缩均已修正，最终无 BLOCKER/HIGH。
- 浏览器视觉检查使用未打开项目的隔离 Editor，因此没有在浏览器里生成真实轨迹；来源过滤、顺序去重、完成边界、轨迹定位与时间轴重播由聚焦测试和既有 E2E runner 合同覆盖。这一边界不替代后续真实项目人工体验。
- 未修改 Core、Renderer、Authoring、CLI 生产逻辑，没有新增第二套运行时、轨迹协议或后端事实源；仓库内误留的空 `dist` 目录已移除。

## 完成条件

- 工作区、source、reload、Dock、中文轨迹和响应式合同全部落地；
- 聚焦、Editor 全量、typecheck/build 与真实浏览器检查通过；
- Luna 无未解决 BLOCKER/HIGH；
- 精确普通提交已推送且 CI 绿色；
- 长期台账已简短更新；
- Frontend Pass 6 尚未启动，主线 Wave 7 未启动。
