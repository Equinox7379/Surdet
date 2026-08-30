# Surdet Frontend Editorial Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改 Surdet 业务真相、项目格式、存档、Agent Port 或后端语义的前提下，把 Editor 八个主模式与 Renderer 玩家界面逐波迁移为“创作优先版本案卷”，彻底退出旧 Mirror’s Edge/卡片化/AI 模板视觉，并保持所有现有功能可达、可读、可测试。

**Architecture:** 保留现有单例状态、业务 hooks、Panel renderer、RendererTheme 与 Host/Shell 消费边界；新增纯前端视觉基础层、应用框架层和工作区原语层，再逐模式迁移 DOM 与样式。每波先建立语义 RED，再实现最小 GREEN；已迁移区域只消费 `--surdet-*` 语义 token，未迁移区域临时留在 legacy 样式中，但不复制业务逻辑。Editor 与 Renderer 继续各自投影同一业务状态，不建立跨包主题运行时。

**Tech Stack:** TypeScript、命令式 DOM、CSS、Vite 6、Vitest 3、现有 `@surdet/authoring` / `@surdet/core` / `@surdet/renderer`；不新增依赖，不修改 lockfile。

## Global Constraints

- 设计权威：`docs/superpowers/specs/2026-08-30-surdet-frontend-editorial-workbench-redesign-design.md`。
- 只改前端：允许 `packages/editor`、`packages/renderer` 及其测试；`packages/host`、`packages/shell` 默认只跑消费回归。只有当前代码中已经存在、能证明为纯显示的 seam，才允许另开白名单修改。
- 禁止修改 `packages/authoring`、`packages/core`、`packages/cli` 生产代码、公共 schema、项目/存档/脚本/时间轴格式、文件写入/EOL/备份/恢复/lease/apply/commit 语义、Starter 内容、依赖与 lockfile。
- 保留业务单一真相：新视觉组件只渲染现有前端状态，通过回调调用现有业务函数；不得复制状态机、索引、验证、预览、审阅、保存或素材插入逻辑。
- 保留稳定锚点：仍准确的 ID、`data-*`、对象引用和事件合同原样保留；必须替换时，在同一提交中建立等价永久测试。
- 永久删除所有彩色左竖线及等价横向 inset 色条；选择、当前、焦点、错误、警告、只读改用整面反馈、完整边界、文字、图标与 ARIA。
- 禁止旧默认视觉：装饰渐变、渐变字、玻璃拟态、发光、万能胶囊、卡片海、Bento 填充、卡片套卡片、浮空主动作、无意义副标题、随机编号、悬停漂浮和整站等宽字体。
- 新 CSS 使用设计规格定义的 `--surdet-*` 三层 token；组件不得直接重新发明 accent、panel、shadow 或状态裸色。
- 普通界面中文优先；ID、哈希、fingerprint、error code 与原始 JSON 只在技术详情中出现。
- 全局保存始终位于项目栏并保留 `Ctrl/Cmd+S`；工作区动作位于所属对象或区段正常文档流中，不得争夺相同文案或快捷键。
- Editor 人工服务只使用 `4175`；`4173` 必须保持空闲。启动前后核验标题、项目路径、端口和进程归属。
- 截图、浏览器 trace 和视觉 artifact 写到仓库外 `%TEMP%\surdet-frontend-redesign-*`，不得暂存。
- 项目所有者提供的高密度桌面创作工作台参考图是最终“完成度、层级和协同工作面”基准，不是可照抄字段清单。加载真实项目后的最终页面不得仍停留在空壳骨架；参考图中当前状态没有来源的版本、协作、时长、人物数值等字段必须省略，禁止用假数据或后端扩张补画面。
- 精确暂存；禁止 `git add .`、`git add -A`、amend、reset、rebase、force-push。未经项目所有者明确授权不得 push。
- 每波提交可单独回滚；某波失败时停在该波，不扩散到下一波。
- 每波分别记录：`TECHNICAL_GATES`、`LOCAL_INDEPENDENT_REVIEW`、`OWNER_VISUAL_ACCEPTANCE`、`REMOTE_REVIEW`。施工 AI 不代填 Owner 主观视觉通过。
- 施工期间继续在本任务书的 `Execution Ledger` 追加已验证事实；全重构闭合后，才更新既有长期路线台账，不新建第二本台账。

---

## Task 0: Freeze Baseline and Establish the Execution Ledger

**Files:**
- Modify: `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`
- Read only: `docs/superpowers/specs/2026-08-30-surdet-frontend-editorial-workbench-redesign-design.md`
- Read only: `packages/editor/package.json`
- Read only: `packages/renderer/package.json`

- [x] **Step 1: Record the current identity**

Run:

```powershell
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
git status --short
```

Expected: branch `main`; protected/untracked files remain untracked; no staged paths.

- [x] **Step 2: Record the exact allowed and forbidden production roots**

Append the actual HEAD, remote relation, tracked state, protected untracked paths, authorized roots and forbidden roots to `Execution Ledger` below. Separate confirmed facts from assumptions.

- [x] **Step 3: Capture a non-mutating Editor baseline**

Run:

```powershell
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

Expected: existing Editor suite, typecheck and build pass. If a pre-existing failure appears, record it and stop before visual implementation.

- [x] **Step 4: Commit the taskbook before production work**

Run:

```powershell
git add -- docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(editor): plan editorial workbench redesign"
```

Expected staged set: exactly this taskbook.

---

## Task 1: Wave 1 — Visual Tokens, Application Shell, and Anti-AI Contracts

**Outcome:** 八模式始终可达；项目栏、模式导航和内容宿主迁入新壳层；新壳层完全退出旧渐变、胶囊和浮空模板；所有旧业务 renderer 继续工作。

**Files:**
- Create: `packages/editor/src/shell/editor-modes.ts`
- Create: `packages/editor/src/shell/app-shell.ts`
- Create: `packages/editor/src/styles/tokens.css`
- Create: `packages/editor/src/styles/components.css`
- Create: `packages/editor/src/styles/app-shell.css`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/src/panels/review-panel.ts`
- Modify: `packages/editor/src/panels/timeline-panel.ts`
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/src/state.ts`
- Modify: `packages/editor/src/styles.css`
- Modify: `packages/editor/index.html`
- Create: `packages/editor/test/editor-shell-navigation-contract.test.ts`
- Create: `packages/editor/test/editor-visual-token-contract.test.ts`
- Create: `packages/editor/test/editor-action-scope-contract.test.ts`
- Modify: `packages/editor/test/project-io.test.ts`
- Create: `packages/editor/test/timeline-project-bar-projection.test.ts`
- Read only: `packages/editor/test/review-operations-layout.test.ts`

- [x] **Step 1: Create a real RED for the eight-mode shell**

Add a contract test that imports `EDITOR_MODES` and asserts the exact IDs, Chinese labels, unique panel IDs and exact order:

```ts
expect(EDITOR_MODES.map(({ id }) => id)).toEqual([
  'editor', 'flow', 'timeline', 'config',
  'preview', 'review', 'stats', 'audit',
]);

expect(EDITOR_MODES.map(({ label }) => label)).toEqual([
  '剧本', '流程', '时间轴', '配置',
  '预览', '审阅', '统计', '审计',
]);
```

The test must also exercise all eight navigation callbacks and assert `data-editor-mode`, `aria-controls`, and `aria-current="page"`.

Run:

```powershell
npx vitest run packages/editor/test/editor-shell-navigation-contract.test.ts
```

Expected: FAIL because the pure contract and semantic navigation do not exist.

- [x] **Step 2: Create a real RED for visual tokens and banned signatures**

Add a small comment-stripping CSS test helper inside `editor-visual-token-contract.test.ts`. Assert that new style files provide the approved primitive and semantic `--surdet-*` tokens and forbid:

```text
radial-gradient(
backdrop-filter:
border-left-color:
border-inline-start-color:
inset 3px 0
border-radius: 999px
```

Do not require unmigrated mode rules in legacy `styles.css` to be fully gone yet. Require the new shell and shared components to be clean, and require old body/header/tabs signatures to be absent from their active selectors.

Run:

```powershell
npx vitest run packages/editor/test/editor-visual-token-contract.test.ts
```

Expected: FAIL because the new files and token namespace do not exist.

- [x] **Step 3: Create a RED for action scope**

The test must require:

```html
<button data-action="save-project" data-action-scope="global">保存全部</button>
```

and preserve workspace actions such as:

```html
<button data-action="save-decision" data-action-scope="workspace">保存我的决定</button>
```

Assert that workspace action containers are normal flow and never `fixed`, `sticky` or bottom-pinned.

Run:

```powershell
npx vitest run packages/editor/test/editor-action-scope-contract.test.ts packages/editor/test/review-operations-layout.test.ts
```

Expected: FAIL on missing global/workspace scope contract while existing review non-floating assertions continue to protect the known fix.

- [x] **Step 4: Implement the pure mode contract**

Create:

```ts
export type EditorModeId =
  | 'editor'
  | 'flow'
  | 'timeline'
  | 'config'
  | 'preview'
  | 'review'
  | 'stats'
  | 'audit';

export interface EditorModeDefinition {
  id: EditorModeId;
  label: string;
  panelId: string;
}

export const EDITOR_MODES: readonly EditorModeDefinition[] = [
  { id: 'editor', label: '剧本', panelId: 'editor-workspace' },
  { id: 'flow', label: '流程', panelId: 'flow-view' },
  { id: 'timeline', label: '时间轴', panelId: 'timeline-view' },
  { id: 'config', label: '配置', panelId: 'config-view' },
  { id: 'preview', label: '预览', panelId: 'preview-view' },
  { id: 'review', label: '审阅', panelId: 'review-view' },
  { id: 'stats', label: '统计', panelId: 'stats-view' },
  { id: 'audit', label: '审计', panelId: 'audit-view' },
] as const;
```

Update `state.mainTab` to `EditorModeId`. Do not move any business state.

- [x] **Step 5: Implement a callback-only application shell**

`app-shell.ts` may create DOM and accept projections/callbacks, but must not import project IO, history, preview or panel modules. Required exports:

```ts
export interface ProjectBarProjection {
  projectName: string;
  objectLabel: string;
  saveState: 'saved' | 'dirty' | 'partial-failure';
  canUndo: boolean;
  canRedo: boolean;
}

export interface ProjectBarActions {
  onOpenProject(): void;
  onOpenReview(): void;
  onUndo(): void;
  onRedo(): void;
  onSaveProject(): void;
}

export function renderProjectBar(
  projection: ProjectBarProjection,
  actions: ProjectBarActions,
): HTMLElement;

export function renderModeNavigation(
  activeMode: EditorModeId,
  onSelect: (mode: EditorModeId) => void,
): HTMLElement;
```

`main.ts` remains the composition root: it passes existing functions into these callbacks and keeps all current conditional behavior, shortcuts, `beforeunload`, status updates and `previewTimelineId = null` routing side effects.

- [x] **Step 6: Establish the new visual foundation**

Create the exact design-spec primitive and semantic tokens in `tokens.css`, including typography, 8/12/16/24/32/48 spacing, 0/2/4 radius, 2px focus ring and 120–200ms motion. Create semantic button, field, rule, empty, status and focus styles in `components.css`; create project bar, left mode rail, main host and responsive mode selector styles in `app-shell.css`.

Load order in `index.html`:

```html
<link rel="stylesheet" href="/src/styles.css" />
<link rel="stylesheet" href="/src/styles/tokens.css" />
<link rel="stylesheet" href="/src/styles/components.css" />
<link rel="stylesheet" href="/src/styles/app-shell.css" />
```

Legacy mode styles stay first only as a temporary compatibility layer. Remove or neutralize the old body/header/project bar/status/tabs rules from active use; new shell DOM must not use their visual classes.

- [x] **Step 7: Preserve current mode mounts and stable IDs**

Keep `#app`, `#main`, `#status`, `#sidebar`, `#search-panel`, `#editor`, `#right`, `#flow-view`, `#timeline-view`, `#config-view`, `#preview-view`, `#review-view`, `#stats-view` and `#audit-view`. The shell may wrap them with semantic regions but must not rename or duplicate them.

- [x] **Step 8: Turn the focused contracts GREEN**

Run:

```powershell
npx vitest run packages/editor/test/editor-shell-navigation-contract.test.ts packages/editor/test/editor-visual-token-contract.test.ts packages/editor/test/editor-action-scope-contract.test.ts packages/editor/test/review-operations-layout.test.ts packages/editor/test/timeline-project-bar-projection.test.ts
```

Expected: all pass.

- [x] **Step 9: Run adjacent Editor gates**

Run:

```powershell
npx vitest run packages/editor/test/project-io.test.ts packages/editor/test/history.test.ts packages/editor/test/preview-stage-layout.test.ts packages/editor/test/review-panel.test.ts packages/editor/test/presentation-asset-catalog.test.ts
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

Expected: all pass. No Authoring/Core/CLI production changes.

- [x] **Step 10: Inspect the real application on port 4175**

Start a disposable Editor process on `4175`, verify `4173` is free, then inspect 1920×1080, 1440×900, 1280×720 and 1024×768. Confirm:

- project bar is a stable command surface, not a banner;
- all eight Chinese modes remain reachable;
- current mode uses full surface/complete boundary and `aria-current`, no colored left line;
- global save is unique and visually distinct from workspace actions;
- existing Editor/Review/Preview functions are still reachable;
- no decorative gradient, glass, glow, giant pill, slogan or floating action appears;
- title and project path identify Surdet, and listening process belongs to this workspace.

Store screenshots under `%TEMP%\surdet-frontend-redesign-wave1-*`.

- [x] **Step 11: Independently review and commit Wave 1**

Review exact diff, selectors adjacent to every edit, test results, screenshot paths, and forbidden production roots. Then:

```powershell
git add -- packages/editor/index.html packages/editor/src/main.ts packages/editor/src/state.ts packages/editor/src/styles.css packages/editor/src/panels/review-panel.ts packages/editor/src/panels/timeline-panel.ts packages/editor/src/project-io.ts packages/editor/src/shell/editor-modes.ts packages/editor/src/shell/app-shell.ts packages/editor/src/styles/tokens.css packages/editor/src/styles/components.css packages/editor/src/styles/app-shell.css packages/editor/test/editor-shell-navigation-contract.test.ts packages/editor/test/editor-visual-token-contract.test.ts packages/editor/test/editor-action-scope-contract.test.ts packages/editor/test/project-io.test.ts packages/editor/test/timeline-project-bar-projection.test.ts
git diff --check
git diff --cached --check
git diff --cached --name-only
git commit -m "feat(editor): establish editorial application shell"
```

Expected: exact allowlist only. Stop for Wave 1 local review; do not push.

---

## Cross-Wave Completion Benchmark — Mature Integrated Authoring Desk

The approved reference is a maturity benchmark for the completed redesign. It does not change the frontend-only boundary and does not authorize invented product data. The following conditions are mandatory across Waves 2, 3 and 5:

- At 1440×900 and above, a loaded project must offer a coordinated scene/asset outline, continuous manuscript, contextual Inspector or live preview, and a collapsible time/causal Dock around the same current scene. The manuscript remains the largest readable region.
- The project bar `objectLabel`, outline `aria-selected`, manuscript object identity, Inspector `objectRef`, preview scene and timeline/causal linkage must consume the same existing selection truth.
- Preview and timeline peeks may reuse existing runtime/model state only. There must never be two live preview iframes, two trace projections, or two timeline edit states in the DOM or application state.
- 1920×1080, 1440×900, 1280×720 and 1024×768 must define deterministic pane folding. Narrow layouts keep the main task and provide keyboard-operable reveal/restore instead of overlaying navigation or creating three competing long scrollbars.
- Screenshots used for full completion must load Starter or another isolated real fixture. Empty-project screenshots prove shell and empty-state behavior only; they cannot prove the final information density.
- Every visible command, time, chapter, status, version, collaboration signal, character value and causal condition must trace to an existing projection/callback. Missing facts are omitted, never fabricated.

Wave 1 is intentionally the structural foundation and must not be presented as the final visual result.

---

## Task 2: Wave 2 — Script and Asset Workspace

**Outcome:** 剧本模式成为真正的连续稿件主工作面；场景/素材目录、中央稿件、上下文 Inspector 与后续可接入的预览/时间 Dock 使用稳定区域协同；技术身份下钻；块类型不再依赖左色条。

**Files:**
- Create: `packages/editor/src/styles/script-workspace.css`
- Create: `packages/editor/src/shell/authoring-workbench.ts`
- Create: `packages/editor/e2e/editorial-script-workspace-wave-2.e2e.mjs`
- Create: `packages/editor/e2e/support/fake-file-system.mjs`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/src/shell/app-shell.ts`
- Modify: `packages/editor/src/panels/editor.ts`
- Modify: `packages/editor/src/panels/sidebar.ts`
- Modify: `packages/editor/src/panels/assets.ts`
- Modify: `packages/editor/src/panels/search-panel.ts`
- Modify: `packages/editor/src/panels/issues.ts`
- Modify: `packages/editor/src/panels/right.ts`
- Modify: `packages/editor/src/styles.css`
- Create: `packages/editor/test/editor-asset-sidebar-contract.test.ts`
- Create: `packages/editor/test/editor-script-workspace-contract.test.ts`
- Create: `packages/editor/test/editor-integrated-authoring-workbench.test.ts`
- Modify: `packages/editor/test/presentation-asset-catalog.test.ts`
- Modify: `packages/editor/test/assets.test.ts`

- [x] **Step 1:** RED: require `data-sidebar-mode="scenes|assets"`, `aria-selected`, `data-editor-region="asset-catalog"`, `data-asset-key`, insert/copy actions and both referenced/unreferenced assets.
- [x] **Step 2:** RED: require `.block[data-line][data-object-ref]`, continuous manuscript hierarchy, real keyboard focus, current block whole-surface feedback and no `.block.t-*` left border color.
- [x] **Step 3:** RED: require named outline/manuscript/context/dock regions, one current scene identity across all rendered projections, manuscript as the largest region, and deterministic 1280/1024 pane folding; forbid duplicate preview iframe/trace/timeline state.
- [x] **Step 4:** Refactor only presentation DOM; keep existing scene edit/history/search/asset insertion/copy callbacks unchanged. Build the integrated region topology without fabricating preview, timeline, chapter, duration or status content that does not yet exist.
- [x] **Step 5:** Move ordinary users’ default view to Chinese content/title/type/use location; stable keys and hashes remain under technical disclosure.
- [x] **Step 6:** Remove scene/block/asset selected left-line signatures and replace them with complete boundary, surface, “当前/已选” text and ARIA.
- [x] **Step 7:** Run focused script/asset/search/history tests, full Editor test, typecheck and build.
- [x] **Step 8:** Inspect a loaded isolated fixture with long Chinese prose, multiple choices, assets, missing preview, dirty/save failure and 1024×768 folding; do not use empty-project appearance as the density acceptance.
- [x] **Step 9:** Commit exact Wave 2 paths as `feat(editor): rebuild script and asset workspace`; no push.

---

## Task 3A: Wave 3A — Flow Canvas

**Outcome:** 流程页成为中文优先、以真实图为主的专业剧情流程工作台；保留现有图构建、导航、平移、缩放、小地图、建链、重命名、删除、dirty/history/undo 路径，不制造章节、时长、状态或运行概率。

**Design authority:** `docs/superpowers/specs/2026-08-30-surdet-flow-canvas-wave-3a-design.md`

**Implementation taskbook:** `docs/superpowers/plans/2026-08-30-surdet-flow-canvas-wave-3a.md`

**Files:**
- Create: `packages/editor/src/styles/flow-workspace.css`
- Create if justified by RED: `packages/editor/src/flow-presentation.ts`
- Modify: `packages/editor/index.html`
- Modify: `packages/editor/src/panels/flow.ts`
- Modify: `packages/editor/src/styles.css` only to remove migrated flow rules
- Create: focused presentation / workspace / interaction tests
- Create: isolated real-Starter browser runner

- [ ] **Step 1:** RED for semantic workbench regions, Chinese display projection, accessible node interaction, complete selected / invalid boundaries and no decorative rainbow / colored selection rail.
- [ ] **Step 2:** Add the smallest pure display projection without changing graph, scene text or serialized values.
- [ ] **Step 3:** Rebuild the flow shell and SVG presentation around the existing graph and view state; every command must be functional.
- [ ] **Step 4:** Preserve click, keyboard open, pan, zoom, minimap, drag-link, rename, delete, dirty and undo behavior.
- [ ] **Step 5:** Run focused tests, full Editor test, typecheck/build and isolated real-Starter browser evidence at desktop, narrow and 200% zoom.
- [ ] **Step 6:** Independent review, exact code commit, Ledger closure; no push.

---

## Task 3B: Wave 3B — Timeline Desk

**Outcome:** 在独立代码证据中重构完整时间轴页；中文显示继续投影稳定英文枚举，先解决真实编辑正确性，再迁移视觉。剧本页 Timeline Dock 暂缓。

**Required correctness before visual closure:**
- timeline-specific undo must not undo scene text;
- destructive track-type replacement / cue deletion must have an explicit recovery contract;
- new tracks and cues must not hardcode Starter-only assets;
- CRLF / LF must be preserved;
- tick overlap and narrow-layout reachability must be corrected;
- serialized `background/portrait/camera/screen/particle/audio` and action enums must remain unchanged.

**Dock deferral contract:**
- define zero / one / multiple timelines referenced by the current scene;
- define the sole timeline and cue selection truth;
- keep compact and full mounts mutually exclusive;
- show an honest empty state when no association exists;
- never display the first timeline as if it were current-scene truth.

- [ ] **Step 1:** Write and review a separate 3B design / taskbook after 3A closes.
- [ ] **Step 2:** Establish correctness RED before visual RED.
- [ ] **Step 3:** Implement the minimum Editor-only correction and full-page Timeline Desk.
- [ ] **Step 4:** Run proportional timeline, Editor and real-browser gates in a separate code-evidence commit.
- [ ] **Step 5:** Revisit the script Dock only after its truth contract exists.

---

## Task 4: Wave 4 — Configuration Ledger

**Outcome:** 配置页成为中文字段分组与可编辑台账，而非通用卡片表单；保存与验证仍走既有 config edit/project IO 路径。

**Files:**
- Create: `packages/editor/src/styles/config-workspace.css`
- Modify: `packages/editor/src/panels/config.ts`
- Modify: `packages/editor/src/panels/calendar-map.ts`
- Modify: `packages/editor/src/config-edit.ts`
- Modify: `packages/editor/src/styles.css`
- Create: `packages/editor/test/editor-config-workspace-contract.test.ts`
- Modify: `packages/editor/test/config-edit.test.ts`
- Modify: `packages/editor/test/calendar-map.test.ts`
- Modify: `packages/editor/test/project-config-display.test.ts`
- Modify: `packages/editor/test/terminology-import.test.ts`

- [ ] **Step 1:** RED: Chinese labels, section grouping, inline help, technical key disclosure and semantic map theme hooks.
- [ ] **Step 2:** Preserve existing config edits, EOL/save behavior and validation; change only render structure/class names and pure display projections.
- [ ] **Step 3:** Replace map inline color values with semantic component variables.
- [ ] **Step 4:** Verify long labels, invalid values, empty config, keyboard focus and 200% zoom.
- [ ] **Step 5:** Run focused tests, full Editor suite, typecheck/build and real save round-trip.
- [ ] **Step 6:** Commit exact Wave 4 paths as `feat(editor): rebuild configuration ledger`; no push.

---

## Task 5: Wave 5 — Preview Stage and Causal Dock

**Outcome:** Gal Canvas remains centered and largest; causal trace becomes independently scrollable, collapsible bottom Dock; no duplicate runtime or projection.

**Files:**
- Create: `packages/editor/src/styles/preview-workspace.css`
- Create: `packages/editor/src/shell/workbench-dock.ts`
- Modify: `packages/editor/src/panels/preview-panel.ts`
- Modify: `packages/editor/src/preview.ts`
- Modify: `packages/editor/src/preview-diagnostics.ts`
- Modify: `packages/editor/src/styles.css`
- Modify: `packages/editor/test/preview-stage-layout.test.ts`
- Modify: `packages/editor/test/preview-causal-trace.test.ts`
- Modify: `packages/editor/test/preview-diagnostics.test.ts`
- Modify: `packages/editor/test/preview-runtime-contract.test.ts`
- Modify: `packages/editor/test/preview-runtime-lifecycle.test.ts`
- Modify: `packages/editor/test/preview-scenes.test.ts`
- Modify: `packages/editor/test/preview-font-transfer.test.ts`

- [ ] **Step 1:** RED: `data-editor-panel="preview"`, centered canvas constraints, independent trace scroll, Dock keyboard collapse/restore and workspace action scope.
- [ ] **Step 2:** Extract only UI-only Dock state; preserve existing preview runtime, iframe, transfer and causal selection state.
- [ ] **Step 3:** Allow the integrated script workbench to host a live preview/context peek only through the same preview runtime and state used by full preview mode. Moving between modes may remount the one host, but must not leave a second iframe or trace projection alive.
- [ ] **Step 4:** Make stage occupy maximum available center area and prevent trace growth from changing stage geometry.
- [ ] **Step 5:** Render trace as continuous evidence rows, not colored chips/cards; preserve line/object jump behavior.
- [ ] **Step 6:** Run all preview tests, full Editor suite, typecheck/build and real 4-size canvas/trace checks, including the loaded integrated script workbench.
- [ ] **Step 7:** Commit exact Wave 5 paths as `feat(editor): rebuild preview stage and causal dock`; no push.

---

## Task 6: Wave 6 — Review Proofreading Workbench

**Outcome:** 审阅页保留完整来源、决定、回执、stage 结果和只读合同，同时把用户内容、裁决动作和技术证据分层；所有动作处于正常文档流。

**Files:**
- Create: `packages/editor/src/styles/review-workspace.css`
- Modify: `packages/editor/src/panels/review-panel.ts`
- Modify: `packages/editor/src/review-model.ts`
- Modify: `packages/editor/src/review-preview.ts`
- Modify: `packages/editor/src/review-workspace.ts`
- Modify: `packages/editor/src/styles.css`
- Create: `packages/editor/test/editor-review-layout-contract.test.ts`
- Modify: `packages/editor/test/review-model.test.ts`
- Modify: `packages/editor/test/review-panel.test.ts`
- Modify: `packages/editor/test/review-workspace.test.ts`
- Modify: `packages/editor/test/review-preview.test.ts`
- Modify: `packages/editor/test/review-operations-layout.test.ts`

- [ ] **Step 1:** RED: all high-risk review `data-*` anchors, complete candidate content, real radio/checkbox semantics, exact-unit choice, normal-flow actions and receipt readonly reopen.
- [ ] **Step 2:** Preserve Authoring review projections and receipt identities exactly; do not recompute conflict, provenance or approval truth in Editor.
- [ ] **Step 3:** Replace warning/safe/conflict/dependency left bars with titled sections, complete borders, symbols and Chinese next actions.
- [ ] **Step 4:** Keep technical IDs/fingerprints in disclosure; ordinary view shows content differences, impacts and explicit decision target.
- [ ] **Step 5:** Verify create/save/failure/reopen/readonly/result preview/approve/return paths and fixed button location.
- [ ] **Step 6:** Run all review tests, full Editor suite, typecheck/build and real review fixture inspection.
- [ ] **Step 7:** Commit exact Wave 6 paths as `feat(editor): rebuild review proofreading workbench`; no push.

---

## Task 7: Wave 7 — Statistics and Audit Records

**Outcome:** 统计成为低噪声作品摘要，审计成为可追溯记录；两者不复制仪表盘卡片墙，技术信息仍完整可查。

**Files:**
- Create: `packages/editor/src/styles/stats-workspace.css`
- Create: `packages/editor/src/styles/audit-workspace.css`
- Modify: `packages/editor/src/panels/stats-panel.ts`
- Modify: `packages/editor/src/panels/audit-panel.ts`
- Modify: `packages/editor/src/stats.ts`
- Modify: `packages/editor/src/styles.css`
- Create: `packages/editor/test/editor-stats-audit-visual-contract.test.ts`
- Modify: `packages/editor/test/stats.test.ts`
- Modify: `packages/editor/test/audit-pairs.test.ts`

- [ ] **Step 1:** RED: continuous summary/record layout, accessible tables/lists, no KPI card grid, no audit status left bars.
- [ ] **Step 2:** Preserve all existing counts, object pairs, location and selection callbacks.
- [ ] **Step 3:** Use typography, columns, rules and disclosure to establish hierarchy; no fabricated advice cards.
- [ ] **Step 4:** Verify empty/large/error datasets, keyboard path and 200% zoom.
- [ ] **Step 5:** Run focused tests, full Editor suite, typecheck/build and real page checks.
- [ ] **Step 6:** Commit exact Wave 7 paths as `feat(editor): rebuild statistics and audit records`; no push.

---

## Task 8: Wave 8 — Renderer Player Interface and Theme Boundary

**Outcome:** 玩家界面使用同一克制语义方向，但不复用 Editor CSS、不改变 presentation/runtime/save 行为；ADV/NVL、菜单、系统面板、回想、画廊和加载状态全部覆盖。

**Files:**
- Modify: `packages/renderer/src/theme.ts`
- Modify: `packages/renderer/src/theme-projection.ts`
- Modify: `packages/renderer/src/ui-views.ts`
- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/src/layers/menu/menu-layer.ts`
- Modify: `packages/renderer/src/layers/system-panel/system-panel-layer.ts`
- Modify: `packages/renderer/src/layers/gallery/gallery-layer.ts`
- Modify: `packages/renderer/src/loading-layer.ts`
- Create: `packages/renderer/src/editorial-theme-map.ts`
- Create: `packages/renderer/test/editorial-theme-map.test.ts`
- Modify: affected Renderer tests listed in the design spec section 17.1

- [ ] **Step 1:** RED: static semantic mapping from Editor meaning to existing `RendererTheme` fields; no cross-package CSS/runtime dependency.
- [ ] **Step 2:** RED: ADV/NVL/dialogue/menu/system/gallery/loading selected/focus/disabled/readability contracts without decorative gradients or color-only signals.
- [ ] **Step 3:** Make the smallest theme/view changes; keep Renderer commands, queries, presentation lifecycle, save snapshot and public types stable.
- [ ] **Step 4:** Run affected layer suites, all Renderer tests, typecheck/build and integration presentation/resource cycles.
- [ ] **Step 5:** Run real player checks for ADV, NVL, backlog, menu, settings, gallery, loading, keyboard and gamepad.
- [ ] **Step 6:** Commit exact Wave 8 paths as `feat(renderer): establish editorial player interface`; no push.

---

## Task 9: Wave 9 — Host/Shell Consumer Regression

**Outcome:** 证明纯前端重构没有破坏 Host/Shell 槽位、窗口、存档和打包消费边界；默认不修改生产代码。

**Files:**
- Test only unless a separately approved pure-display seam is proven:
  - `packages/host/test/player-ui-coordination.test.ts`
  - `packages/host/test/renderer-player-shell-slots.test.ts`
  - `packages/shell/test/player-experience-e2e-contract.test.ts`
  - `packages/shell/test/save-store.test.ts`
  - `packages/shell/test/window-state.test.ts`

- [ ] **Step 1:** Run the five named consumer suites before any Host/Shell edit.
- [ ] **Step 2:** Run Host and Shell typecheck/build.
- [ ] **Step 3:** Run the smallest existing player E2E that exercises the changed Renderer UI without modifying fixtures.
- [ ] **Step 4:** If a failure is a pure selector/display seam, establish RED and request a precise whitelist before editing; if it is business/storage/window semantics, stop and reject scope expansion.
- [ ] **Step 5:** Record `HOST_SHELL_PRODUCTION_CHANGES=NO` unless independently authorized.
- [ ] **Step 6:** Commit only test migrations if necessary as `test(shell): verify editorial frontend consumers`; no push.

---

## Task 10: Wave 10 — Full Consistency, Accessibility, and Closure

**Outcome:** 全部旧视觉签名退出生产样式；八模式、Renderer、四种窗口、缩放、键盘、中文长文本和横切状态完成收口；生成精简交付报告并等待 push 授权。

**Files:**
- Modify: `packages/editor/src/styles.css` (reduce to final imports/reset or remove obsolete legacy rules)
- Modify: all new `packages/editor/src/styles/*.css` only as required by final findings
- Modify: affected Editor/Renderer accessibility tests
- Create: `packages/editor/test/editor-final-visual-system-contract.test.ts`
- Create: `docs/SURDET-FRONTEND-EDITORIAL-WORKBENCH-REDESIGN-DELIVERY-REPORT-2026-08-30.md`
- Modify: `docs/README.md`
- Modify: `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`
- Modify after reviewed closure only: `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`

- [ ] **Step 1:** RED final mechanical contract across all Editor production CSS: no old tokens, radial decorations, universal pills, active colored left bars, status `border-left: 3px`, generic panel shadows, glass or floating primary actions.
- [ ] **Step 2:** Verify all eight modes have distinct semantic root attributes and task-specific layouts while sharing shell/tokens.
- [ ] **Step 3:** Run Editor full test/typecheck/build and Renderer full test/typecheck/build.
- [ ] **Step 4:** Run Host/Shell adjacent consumer suites. Run `verify:all` only if the final diff truly crosses aggregate boundaries and the Execution Ledger explicitly authorizes one fresh aggregate run.
- [ ] **Step 5:** Inspect 1920×1080, 1440×900, 1280×720, 1024×768; Windows 125%/150%; browser 100%/125%/150%/200%; long Chinese, empty, error, dirty, readonly and keyboard focus states. Use both an empty project and a loaded isolated real fixture; confirm the loaded authoring desk reaches the approved maturity/density benchmark without fabricated fields.
- [ ] **Step 6:** Confirm `4173` is free and all artifacts stay outside the repository.
- [ ] **Step 7:** Run a local independent review of exact commits, unchanged forbidden roots, behavior contracts, visual artifacts and evidence boundaries.
- [ ] **Step 8:** Write the delivery report with confirmed facts, reasonable inferences, unverified items, tests, exact commit identities and all four review statuses.
- [ ] **Step 9:** After every visible wave has Owner acceptance and local review, consolidate only the reviewed outcome into the existing long-term ledger and update `docs/README.md` canonical entry.
- [ ] **Step 10:** Create exact docs-only closure commit `docs(editor): close editorial workbench redesign`; stop for explicit push authorization and remote review.

---

## Execution Ledger

### 2026-08-30 — Plan initialization

**CONFIRMED_FACTS**

- Design authority is committed at `docs/superpowers/specs/2026-08-30-surdet-frontend-editorial-workbench-redesign-design.md`.
- Project owner approved the design, requested the taskbook, and authorized direct implementation after the taskbook is created.
- Project owner authorized selective subagents, not delegation for its own sake; core application shell, state composition and review remain owned by the primary implementation agent.
- No push was authorized.
- Baseline HEAD is `012a405fac2077981da04a42b1c1d579c7fa40ce`; local `surdet/main` is `f8943c293c4537b3867cc8eeea316b19bb4a0b40`; the local branch is ahead 20 and behind 0.
- Before this taskbook was staged, tracked worktree and staging were empty. Existing untracked governance, handoff, protected art-direction, `design/`, long-term ledger and CLI artifact paths were preserved.
- Editor baseline passed: 33 test files / 223 tests, typecheck exit 0, build exit 0. Vite emitted only the existing large-chunk advisory.
- Authorized production roots for the complete redesign are `packages/editor` and `packages/renderer`; the current Wave 1 production root is `packages/editor` only. Forbidden production roots are `packages/authoring`, `packages/core`, `packages/cli`, `packages/host`, `packages/shell`, Starter/game content, dependencies and the lockfile.

**REASONABLE_INFERENCES**

- The safest Wave 1 boundary is a callback-only shell plus new CSS files, preserving all current panel renderers and stable IDs.
- New permanent contracts should target semantic anchors and forbidden visual signatures rather than brittle screenshot pixel equality.

**UNVERIFIED_ITEMS**

- Wave 1 RED/GREEN, full Editor regression, typecheck, build and real-page visual evidence have not yet been executed.
- Owner visual acceptance and remote GitHub review have not started.

**STOP_BOUNDARY**

- Begin Task 0, then execute Task 1 only. Do not begin Task 2 until Task 1 technical gates and local independent review are complete.

### 2026-08-30 — Wave 1 application-shell closure

**CONFIRMED_FACTS**

- Wave 1 code evidence is commit `96d1bae6e1afc25b6061500a45e1758fe3dfbf97`, parent `85f6acc7e443c0758040c5d31abe8998552cbd34`, message `feat(editor): establish editorial application shell`.
- The code commit contains exactly 17 authorized Editor paths: the HTML entry, shell/mode modules, project and timeline observation seams, review action scoping, state projection, four style layers and five permanent contract tests. It contains no Authoring, Core, CLI, Host, Shell, Starter, dependency, lockfile or protected-file changes.
- The application shell exposes exactly eight Chinese task modes and one global save action. Project-bar content is derived from the existing scene, timeline, selection, dirty and save-result facts; it does not create a second business state or mutation path.
- Save outcomes distinguish clean, dirty and partial failure. Long status text retains the full accessible `title` while remaining width-bounded in the visible shell. Review actions remain workspace-scoped and the primary decision action is no longer a floating viewport control.
- Focused Wave 1 contracts passed: 5 files / 22 tests. The complete Editor suite passed: 37 files / 237 tests. Editor typecheck and build passed; Vite emitted only the pre-existing large-chunk advisory.
- An independent read-only review passed with no Blocker, High, Medium or Low findings. Its focused verification passed 8 files / 50 tests, Editor typecheck and diff checks.
- Real-browser geometry checks passed without horizontal page overflow at 1920×1080, 1440×900, 1280×720 and 1024×768. At 1024 px, the navigation folds into a row; a 320-character unbroken status remains visually clipped with ellipsis while the complete value remains available through the title attribute.
- Real-browser interaction checks observed mode-aware object labels, a dirty timeline state and an honest partial-save-failure state. These checks used the existing UI and mutation pathways; no duplicate preview runtime, iframe, project writer or timeline writer was introduced.
- Visual artifacts were created outside the repository:
  - `editor-shell-1920x1080.png`: 106331 bytes, SHA-256 `31FE2939FAD56CD3A8919DBF322892DF749C723E6BCEBAF746840605BA2BC1D0`.
  - `editor-shell-1440x900.png`: 106772 bytes, SHA-256 `FEAA1B1C7EFCADFA649330404EE01E9411197FA68FB11F3F44502F9DC94FA89A`.
  - `editor-shell-1280x720.png`: 85702 bytes, SHA-256 `4CE1C8DF57F4909F20A231C2FC9BF90F2FE370AE00DFD49EA247F729791A7939`.
  - `editor-shell-1024x768.png`: 74219 bytes, SHA-256 `4D54FABDC80289C4B172ABA5C76149D5A27F6DCA5DF39EF481A3359AE9292DB6`.
- The approved reference image is now a final cross-wave maturity benchmark in both the design specification and this taskbook: the completed product must converge on one integrated outline/manuscript/context/preview/timeline/causal authoring desk, deterministic responsive folding and a single semantic selection truth, without fabricating reference-only collaboration, version, duration or character-stat data.

**REASONABLE_INFERENCES**

- Wave 1 establishes a stable, non-AI-styled application frame and the projection seams needed by later workspaces. It is a suitable base for Wave 2, but it is not yet the dense integrated authoring desk shown in the final reference.
- The responsive shell and callback-only observation seams reduce the risk that later visual composition will fork business state or silently change save/timeline behavior.

**UNVERIFIED_ITEMS**

- Waves 2–10 have not started. The outline, manuscript canvas, flow, timeline, preview, review, statistics, audit and Renderer workspaces have not yet received their final redesign.
- A loaded isolated real-project fixture has not yet been used to prove the final integrated density benchmark; Wave 1 browser evidence covers the application shell and existing panels only.
- Owner visual acceptance, remote GitHub review, push, deployment and release have not started.

**STOP_BOUNDARY**

- Wave 1 is technically closed. Stop before Task 2 / Wave 2. Do not push, deploy, modify forbidden roots or begin the manuscript workbench without the next explicit authorization.

### 2026-08-30 — Wave 2 narrative-continuity workspace initialization

**CONFIRMED_FACTS**

- The project owner reviewed the Wave 1 page, judged it more modern but still materially short of the mature desktop-authoring benchmark, and explicitly authorized Wave 2 specification, planning and implementation without another intermediate approval pause.
- Wave 2 baseline HEAD is `27361d9269475350ffea1d1ccdf4eb9bd5069148`, parent `96d1bae6e1afc25b6061500a45e1758fe3dfbf97`; local `surdet/main...HEAD` is behind 0 / ahead 23. Tracked worktree and staging were empty before the Wave 2 documents were created.
- Existing untracked governance, handoff, protected art-direction, `design/`, long-term ledger and CLI artifact paths remain preserved and unstaged. No push is authorized.
- The Wave 2 capability audit confirmed that `state.scenes` / `state.current` are the only scene truth, `state.selectedObjectRef` / `state.authoringIndex` are the only authoring-selection truth, and `buildAssetInventory()` is the existing asset projection. Editing, history, search, issue navigation, asset insertion, validation and causal selection already have production callback paths that must be retained.
- The current product does not expose reliable chapter names, chapter hierarchy, scene or chapter durations, production status, version, collaboration, comments, notifications or character-state metrics. Wave 2 will omit these reference-only facts instead of fabricating them.
- The selected desktop architecture is a narrative-continuity desk: real scene / asset outline, one ordered manuscript and real current-object / validation / causal context. A three-column narrative / dialogue / interaction editor was rejected because `.gal` is one ordered editable stream and the split would create ordering, move, selection and undo ambiguity.
- The eight existing task modes will move from the permanent left rail to a horizontal strip below the project bar. Mode IDs, callbacks, focus semantics and application state remain unchanged; this is a frontend layout correction that releases width for outline + manuscript + context.
- Wave 2 production scope is Editor-only. Authoring, Core, CLI, Host, Shell, Renderer, Starter, dependencies and the lockfile remain outside scope. No second preview iframe, trace projection, timeline model, causal model or authoring truth is authorized.
- Read-only port inspection found `4173` owned by an `E:\jiuan\jiuan-frontend` test harness and `4175` owned by the Surdet Editor Vite process. Wave 2 must not stop, claim or reuse `4173`; manual Surdet preview remains on `4175` and automated browser evidence must use its own verified-free strict port.
- Wave 2 design authority is `docs/superpowers/specs/2026-08-30-surdet-editorial-script-workspace-wave-2-design.md`; executable detail is `docs/superpowers/plans/2026-08-30-surdet-editorial-script-workspace-wave-2.md`. This master taskbook remains the single Execution Ledger.

**REASONABLE_INFERENCES**

- A pure DOM workbench topology plus a composition-root scene / object navigation coordinator is the smallest architecture that can align all current projections without moving business logic into presentation modules.
- A loaded isolated Starter fixture is necessary to judge density, hierarchy and responsive folding; an empty project is insufficient evidence for Wave 2 completion.

**UNVERIFIED_ITEMS**

- Wave 2 permanent RED, implementation, regression tests, typecheck, build and real-fixture browser evidence have not yet run.
- The final 1440 / 1280 / 1024 geometry, interaction behavior and visual proximity to the approved benchmark remain unverified until the implementation exists.
- Owner visual acceptance, remote GitHub review, push, deployment and Wave 3 have not started.

**STOP_BOUNDARY**

- Execute Wave 2 through its local technical and visual gates, create exact local commits and stop before Wave 3. Do not push, deploy or modify any backend / shared-engine production package.

### 2026-08-30 — Wave 2 selection-reconciliation scope decision

**CONFIRMED_FACTS**

- Independent review found that real authoring-index rebuilds could leave `state.selectedObjectRef` pointing at an obsolete object identity after an edit, search jump or scene transition. The workbench must keep the existing single selection truth rather than introduce a second UI-only selection.
- Wave 2 therefore explicitly adds `packages/editor/src/causal-selection.ts` and its existing adjacent regression file `packages/editor/test/causal-selection.test.ts` to the authorized Editor-only path set. The implementation may retain a stable indexed ref, remap a uniquely identifiable content-only ref by source line and kind, or clear an ambiguous / missing ref; it may not invent another index, selection store or backend contract.
- This is an explicit scope decision recorded before the code-evidence commit. Authoring, Core, CLI, Host, Shell, Renderer, Starter, dependencies and lockfiles remain unchanged and outside Wave 2 production scope.

**REASONABLE_INFERENCES**

- Centralized reconciliation is the smallest safe correction because every outline, manuscript, search, issue and causal projection already consumes the same `state.selectedObjectRef`.

**UNVERIFIED_ITEMS**

- The final exact code commit and docs-only closure commit have not yet been created at this ledger point.

**STOP_BOUNDARY**

- Complete the fresh browser rerun and final independent review, then create the exact Wave 2 code commit only if no Blocker or High finding remains. Do not push or begin Wave 3.

### 2026-08-30 — Wave 2 narrative-continuity workspace closure

**CONFIRMED_FACTS**

- Wave 2 planning is commit `0caceceb2ae21f2e8b3c7fd21b6fadcabd2d26a9`. Code evidence is commit `0531388ccc703ce603f02eb4d34d5594013ffc89`, parent `0caceceb2ae21f2e8b3c7fd21b6fadcabd2d26a9`, message `feat(editor): build narrative continuity workspace`, with exactly 17 reviewed Editor production, test and browser-runner paths and no staged-set difference.
- Initial RED was 3 files / 15 tests with 12 passing and 3 expected failures for the absent Wave 2 visual/layout contracts. Final focused coverage passed 4 files / 23 tests; the complete Editor suite passed 40 files / 255 tests; Editor typecheck and build passed with only the existing Vite large-chunk advisory.
- The final script workspace uses the real scene / asset outline, one ordered manuscript and real current-object / validation / causal context. Existing scene editing, history, search, issue navigation, asset insertion, validation and selection behavior remain on their original callbacks and state. No backend/shared-engine production package, Starter, dependency or lockfile changed.
- Independent review's first pass found narrow-layout reachability, navigation consistency, selection reconciliation, dirty/asset refresh, row-action placement and tab-keyboard problems. All Blocker / High findings were corrected. The final review returned `PASS` with no Blocker, High or Medium finding, passed an additional 4 files / 38 tests and independently replayed the final runner successfully.
- A runner assertion failure was retained at `C:\Users\Equinox\AppData\Local\Temp\surdet-editorial-script-workspace-wave2-r0VnDj\evidence.json`, 41363 bytes, SHA-256 `0E2A65AAB615CD61AF1A24A0F58D9537C12754DBFD0FFF1B3AC6734F764E7EFF`; it read input `textContent` instead of value and did not identify a product failure.
- Final fresh browser evidence passed 16 / 16 at `C:\Users\Equinox\AppData\Local\Temp\surdet-editorial-script-workspace-wave2-mwDnEl\evidence.json`, 56931 bytes, SHA-256 `F7B70A09C9CE890196AF0930AE044C09D9F8AB393A527DBAC3BBE83DD533E6BC`. It loaded the real Starter through the picker path, proved 1440 / 1280 / 1024 / 800 responsive composition, exercised scene/search/edit/undo/asset insertion paths, found no duplicate preview/trace/timeline state and recorded empty browser error / request / cleanup channels.
- Original Starter remained byte-identical with SHA-256 `8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6`. The runner used and released isolated port 4187; it did not touch 4173 or 4175.

**REASONABLE_INFERENCES**

- The workbench now behaves like a coherent narrative-authoring surface rather than a set of generic cards, while retaining a simple data flow that later preview, timeline and causal workspaces can consume without duplicating truth.
- This materially advances the approved direction but does not make the current Editor pixel-equivalent to the final reference; the missing work is visible and intentionally assigned to later waves.

**UNVERIFIED_ITEMS**

- Preview, timeline, causal graph, flow, statistics, audit, final cross-mode styling and replacement production art remain future waves. Chapter hierarchy, duration, collaboration, comments, version, production state and character metrics remain omitted because the current product has no authoritative facts for them.
- A low-severity existing new-scene edge is deferred: the manuscript's displayed file path may wait for the next full render after the first physical save assigns its final path; save behavior and stored bytes are unaffected.
- The browser artifact records runner hash and disk identity but not a complete application-source hash or `runHead`; two post-edit reruns and exact commit review establish freshness for this B-level UI wave, while a later high-risk wave may strengthen the envelope.
- Owner visual acceptance of the final loaded Wave 2 view, remote GitHub review, push, deployment and release have not occurred.

**STOP_BOUNDARY**

- `WAVE_2_TECHNICAL_VERIFICATION = PASSED`
- `OWNER_VISUAL_ACCEPTANCE = NOT_STARTED`
- `REMOTE_REVIEW = NOT_STARTED`
- `PUSH = NOT_PERFORMED`
- `WAVE_3 = NOT_STARTED`
- Create only the exact docs-only closure commit, then stop. Do not push or begin Wave 3.

### 2026-08-30 — Wave 3 scope correction and Flow Canvas 3A initialization

**CONFIRMED_FACTS**

- The owner explicitly authorized continued implementation toward the mature desktop-authoring reference, with human-friendly Chinese-first language and actual capability taking priority over visual imitation.
- Wave 3A baseline HEAD is `2fdbd59eaa4f00669dc5b8a22c754bcb57949b45`; local `surdet/main...HEAD` is behind 0 / ahead 26. Tracked worktree and staging were empty before the Wave 3A documents were created. Existing protected and unrelated untracked paths remain preserved and unstaged.
- The original combined Task 3 mixed two independent high-interaction surfaces and proposed a script-page Timeline Dock without an authoritative scene-to-timeline selection contract. The current scene may reference zero, one or multiple timelines, while `state.currentTimeline` is only the globally opened timeline. Showing it in the script page would risk presenting the wrong timeline as current-scene truth.
- Flow already has real scene / label / configuration-entry nodes, real flow / goto / jump / call / switch / loop / choice / condition / host connections, in-memory layout, pan, zoom, culling, minimap, click navigation, drag-to-link through scene dirty/history/undo, and rename / delete helpers. Wave 3A can therefore be a presentation and accessibility reconstruction without graph or file-format changes.
- The current product has no authoritative chapter hierarchy, duration, production state, version, collaboration, comments, branch probability or path-coverage facts. Wave 3A will omit them rather than imitate the reference with static data.
- Timeline read-only audit identified separate correctness work: global undo can affect scene history while timeline mode is active, destructive edits lack a recovery contract, default cues hardcode Starter assets, timeline writes normalize EOL to LF, and short timelines can produce overlapping ticks. These findings justify an independent Wave 3B before visual closure.
- Port `4173` remains reserved for the neighbouring Jiuan workspace. Port `4175` remains the existing Surdet Editor manual preview and will not be stopped; automated Wave 3A evidence will use a separate strictly free port.
- Wave 3A design authority is `docs/superpowers/specs/2026-08-30-surdet-flow-canvas-wave-3a-design.md`; its executable taskbook is `docs/superpowers/plans/2026-08-30-surdet-flow-canvas-wave-3a.md`. This master taskbook remains the single Execution Ledger.

**REASONABLE_INFERENCES**

- Splitting Flow 3A from Timeline 3B is the fastest reliable route to the reference-level experience because each surface keeps a small, attributable verification boundary.
- A restrained paper / ink / steel-blue flow canvas with real counts, Chinese labels, real tools and non-color-only states can materially improve the product without inventing backend facts.

**UNVERIFIED_ITEMS**

- Wave 3A permanent RED, production implementation, Editor regression, browser evidence and final independent review have not yet run.
- Final visual proximity, 800 / 1024 / 1440 geometry and 200% zoom behavior remain unverified until the implementation exists.
- Timeline 3B design, correctness fixes and the future scene-associated Dock contract have not started.

**STOP_BOUNDARY**

- Execute Flow Canvas 3A through local technical and browser gates, create exact local commits and stop before Timeline 3B. Do not push, deploy or modify backend / shared-engine production packages.
